package com.minicraft.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

/**
 * 整包解密的入口：`assets/rt/libmcrt.so`（伪装成原生库）→ native 侧的内存文件表。
 *
 * ## 为什么"打开"不再返回 Map（2026-10-31 改造）
 *
 * 之前这里解密完会返回 `Map<String, byte[]>`，于是整包 4~5 MB 明文**同时**躺在 Java 堆上，
 * 一次内存 dump 就把游戏源码、贴图、音频全拿到了。现在真正的解密与明文缓冲都在
 * `libminicraft_vault.so`（源码 `native/vault/`）里，Java 侧每次只取**当前请求的那一个文件**：
 *
 * <pre>
 *   shouldInterceptRequest → vault.read("assets/index-xxx.js") → byte[]（几 KB ~ 几十 KB）
 * </pre>
 *
 * 完整明文不再经过 Java 堆。要 dump 就得逐文件抓、按顺序拼，成本高一个量级。
 *
 * ## 钥匙还是从签名摘要来（没变）
 *
 * <pre>
 *   KEK = HKDF-SHA256(salt, 安装包实际签名摘要 ‖ salt, info="minicraft/bundle/v1")
 * </pre>
 *
 * 摘要是 {@link PackageManager} **现场取的**，不是文件里写死的期望值——换成别人的证书重签，
 * 派生出的 KEK 打不开包里任何一份包裹。**把校验代码删掉也没用**：数据本身没给他准备钥匙。
 *
 * ## 为什么解密代码搬到 native 而不是继续留在 Java
 *
 * 1. 明文不再进 Java 堆（上面那条，这是主要收益）；
 * 2. jadx 打开只能看到 5 个 `native` 声明，HKDF / AES-GCM / 容器解析都在 `.so` 里，
 *    且 release 包已开 R8，`BundleVault` 之后还会被改名成 `a/b`；
 * 3. 顺带把"三份实现"收敛成"一份"：`native/vault` 是纯 C++、不依赖 JNI，
 *    iOS 与桌面后续可以直接复用，不必再让 `BundleVault.swift` 手工跟这份对齐。
 *
 * ⚠️ 边界（这里写清楚，免得下次误判）：证书摘要、salt、密文都在包里，读懂格式的人
 * 可以离线自己解；攻击者也可以把 {@link #installedSignerDigest} 改成硬编码的公开摘要。
 * 这一层挡住的是"改包重签后跑起来"和"内存里没有整包明文"，**不是**专业逆向。
 *
 * ⚠️ JNI 命名约束：native 方法名会被 `proguard-rules.pro` 里的
 * `-keepclasseswithmembernames class * { native <methods>; }` 保留。改名会变成
 * `UnsatisfiedLinkError`，而且报错只说"找不到方法"，不说是名字对不上。
 */
final class BundleVault {

    static {
        // 对应 native/vault/build/android/<abi>/libminicraft_vault.so
        System.loadLibrary("minicraft_vault");
    }

    /** 与 `tools/pack-bundle.ts` 的 OUT_PKG 一致 */
    private static final String ASSET = "rt/libmcrt.so";

    // ---------------------------------------------------------------- JNI

    /** 解密整包并把明文留在 native 堆。false = 解不开（签名不对 / 包被改 / 格式不对）。 */
    private static native boolean nativeOpen(byte[] pkg, String signerHex);

    /** 取一个文件；null = 包里没有这个路径（调用方按 404 处理）。返回的是副本。 */
    private static native byte[] nativeRead(String path);

    /** 当前包里有多少个文件。 */
    private static native int nativeCount();

    /** 容器总字节数（含索引，与 `desktop/bundle.mjs` 的 `bytes` 同口径）。 */
    private static native long nativeTotalBytes();

    /** 释放 native 侧的明文缓冲（可重复调用）。 */
    private static native void nativeClose();

    // ---------------------------------------------------------------- 实例

    private final int fileCount;
    private final long totalBytes;
    private boolean closed;

    private BundleVault(int fileCount, long totalBytes) {
        this.fileCount = fileCount;
        this.totalBytes = totalBytes;
    }

    /**
     * 读 asset → 取安装包签名摘要 → 交给 native 解密。
     *
     * @return null = 解不开。调用方按"没有游戏内容"处理，**没有降级分支**。
     */
    static BundleVault open(Context context) {
        byte[] pkg = readAsset(context, ASSET);
        if (pkg == null) return null;

        String signer = installedSignerDigest(context);
        if (signer == null) return null;  // 拿不到签名 = 不可信

        if (!nativeOpen(pkg, signer)) return null;
        return new BundleVault(nativeCount(), nativeTotalBytes());
    }

    /** 取一个文件的内容；没有就 null。 */
    byte[] read(String path) {
        if (closed) return null;
        return nativeRead(path);
    }

    int fileCount() {
        return fileCount;
    }

    long totalBytes() {
        return totalBytes;
    }

    void close() {
        if (closed) return;
        closed = true;
        nativeClose();
    }

    // ---------------------------------------------------------------- 签名

    /** 当前安装包签名证书的 SHA-256（小写十六进制，与 apksigner 同口径）。 */
    private static String installedSignerDigest(Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            String pkg = context.getPackageName();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo == null ? new Signature[0] : info.signingInfo.getApkContentsSigners();
            } else {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
                signatures = info.signatures == null ? new Signature[0] : info.signatures;
            }
            if (signatures.length == 0) return null;
            byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) sb.append(String.format(Locale.ROOT, "%02x", b));
            return sb.toString();
        } catch (Throwable ignored) {
            // 拿不到签名 = 不可信
            return null;
        }
    }

    // ---------------------------------------------------------------- 工具

    /**
     * 读 asset 到内存。
     *
     * 这里短暂持有一份 1.3 MB 的**密文**（不是明文），传完即被 GC；换成 `mmap` 直接
     * 交给 native 能省这份拷贝，但要处理 AssetFileDescriptor 的关闭时序，
     * 在 1.3 MB 这个量级上不值得。
     */
    private static byte[] readAsset(Context context, String path) {
        try (InputStream in = context.getAssets().open(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, in.available()));
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            return out.toByteArray();
        } catch (Throwable ignored) {
            return null;
        }
    }
}
