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
 * 核心数据保险柜：**用安装包的实际签名派生密钥，再解封**。
 *
 * <p>顺序固定：拿实际签名摘要 →（白名单快速拒绝）→ 解封。
 * 关键在最后一步：KEK 由**实际**摘要派生，`core.sealed` 里每个允许的签名各有一份包裹。
 * 所以"把某个判断改成 true"没有意义——换证书重签的包派生不出能打开包裹的 KEK。
 *
 * <p>字节处理全在 {@link SealedCore}（纯 Java，可被 JVM 直接验证），这里只做两件
 * 与平台相关的事：读 assets、取安装包签名。
 *
 * <p>⚠️ 边界：证书摘要、盐、密文全在包里，读懂格式的人可以离线自己解。
 * 这里提高的是"改包重签"的成本（从改一个布尔变成必须自己重封），不是数学上的不可破。
 */
final class CoreVault {

    private static final String ASSET_SEALED = "sealed/core.sealed";
    private static final String ASSET_SIGNERS = "sealed/signers.txt";
    private static final String ASSET_SALT = "sealed/salt.bin";

    private CoreVault() {}

    /** 解封核心数据；拿不到签名、签名不在白名单、解封失败，一律返回 {@code null}。 */
    static byte[] unseal(Context context) {
        try {
            String actual = installedSignerDigest(context);
            if (actual == null) return null;
            // 白名单先拒一次：不是为了安全（真正的门在下面），而是让"装了个别的包"
            // 尽快停在明确的分支上，不必走一遍解密
            if (!allowlist(context).contains(actual)) return null;
            byte[] salt = readAsset(context, ASSET_SALT);
            byte[] sealed = readAsset(context, ASSET_SEALED);
            if (salt == null || sealed == null) return null;
            return SealedCore.open(sealed, actual, salt);
        } catch (Throwable ignored) {
            // 故意不区分"签名不符"和"数据坏了"：对外都是"没有核心数据"
            return null;
        }
    }

    // ------------------------------------------------------------------ 签名

    /** 当前安装包签名证书的 SHA-256（小写十六进制，与 {@code apksigner} 同口径）。 */
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
            return sha256Hex(signatures[0].toByteArray());
        } catch (Throwable ignored) {
            // 拿不到签名 = 不可信
            return null;
        }
    }

    /** `signers.txt` 里的允许列表（与 `core.sealed` 的包裹一一对应）。 */
    private static List<String> allowlist(Context context) {
        List<String> out = new ArrayList<>();
        byte[] raw = readAsset(context, ASSET_SIGNERS);
        if (raw == null) return out;
        for (String line : new String(raw).split("\n")) {
            String value = line.replace(":", "").trim().toLowerCase(Locale.ROOT);
            if (value.matches("[0-9a-f]{64}")) out.add(value);
        }
        return out;
    }

    private static String sha256Hex(byte[] data) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
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
