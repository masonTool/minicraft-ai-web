package com.minicraft.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 核心数据保险柜：**先验签名，再解封**。
 *
 * <p>这是"只认自家签名"那道闸门。顺序固定，不能反：签名不符就直接返回 {@code null}，
 * 连解封都不做；调用方拿不到数据，页面落到既有的"去应用里玩"路径——没有"弹窗后继续"
 * 这种可被 patch 成 {@code true} 的并列分支。
 *
 * <p>字节处理全在 {@link SealedCore}（纯 Java，可被 JVM 直接验证），这里只做两件
 * 与平台相关的事：读 assets、取安装包签名。
 *
 * <p>⚠️ 边界要说清：证书摘要本身是公开信息，所以 KEK <b>不是</b>"只有私钥能算"的密码学锁。
 * 真正挡住改签包的是这里的签名比对；把摘要混进 KEK 只是让换签名后整条派生链一起错位。
 */
final class CoreVault {

    private static final String ASSET_SEALED = "sealed/core.sealed";
    private static final String ASSET_SIGNERS = "sealed/signers.txt";
    private static final String ASSET_SALT = "sealed/salt.bin";

    private CoreVault() {}

    /** 解封核心数据；签名不符、文件缺失、任何一步校验失败都返回 {@code null}（fail-closed）。 */
    static byte[] unseal(Context context) {
        try {
            if (!isSignedByUs(context)) return null;
            String signer = expectedSigner(context);
            byte[] salt = readAsset(context, ASSET_SALT);
            byte[] sealed = readAsset(context, ASSET_SEALED);
            if (signer == null || salt == null || sealed == null) return null;
            return SealedCore.open(sealed, signer, salt);
        } catch (Throwable ignored) {
            // 故意不区分"签名不符"和"数据坏了"：对外都是"没有核心数据"
            return null;
        }
    }

    // ------------------------------------------------------------------ 签名

    /**
     * 安装包的实际签名是否命中白名单。
     *
     * <p>debug 构建放行：开发机上的 debug keystore 不可能进白名单，而
     * {@code npm run android:apk} 恰恰产出 debug 包——不放行等于本地完全没法联调。
     * 这是**唯一**一处旁路，且 {@code BuildConfig.DEBUG} 在 release 里恒为 false。
     */
    static boolean isSignedByUs(Context context) {
        String expected = expectedSigner(context);
        if (expected == null) return false;
        if (BuildConfig.DEBUG) return true;
        for (String actual : installedSignerDigests(context)) {
            if (expected.equals(actual)) return true;
        }
        return false;
    }

    /** 白名单第一条：既是"是否自家签名"的判据，也是 KEK 的 ikm 来源。 */
    private static String expectedSigner(Context context) {
        byte[] raw = readAsset(context, ASSET_SIGNERS);
        if (raw == null) return null;
        for (String line : new String(raw).split("\n")) {
            String value = line.replace(":", "").trim().toLowerCase(Locale.ROOT);
            if (value.matches("[0-9a-f]{64}")) return value;
        }
        return null;
    }

    /** 当前安装包的全部签名证书摘要（小写十六进制，与 {@code apksigner} 输出同口径）。 */
    private static List<String> installedSignerDigests(Context context) {
        List<String> out = new ArrayList<>();
        try {
            PackageManager pm = context.getPackageManager();
            String pkg = context.getPackageName();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // signingInfo 覆盖 Play key rotation：换过密钥的旧签名也要认
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo == null ? new Signature[0] : info.signingInfo.getApkContentsSigners();
            } else {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
                signatures = info.signatures == null ? new Signature[0] : info.signatures;
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (Signature signature : signatures) {
                byte[] hash = digest.digest(signature.toByteArray());
                StringBuilder sb = new StringBuilder(hash.length * 2);
                for (byte b : hash) sb.append(String.format(Locale.ROOT, "%02x", b));
                out.add(sb.toString());
            }
        } catch (Throwable ignored) {
            // 拿不到签名 = 不可信；返回空列表让上层 fail-closed
        }
        return out;
    }

    // ------------------------------------------------------------------ 资产

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
