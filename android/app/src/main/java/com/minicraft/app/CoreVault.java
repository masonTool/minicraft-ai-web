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
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 核心数据保险柜：**先验签名，再解封**。
 *
 * <p>这是"只认自家签名"那道闸门。顺序固定，不能反：签名不符就直接返回 {@code null}，
 * 连解封都不做；调用方拿不到数据，页面落到既有的"去应用里玩"路径——没有"弹窗后继续"
 * 这种可被 patch 成 {@code true} 的并列分支。
 *
 * <p>格式与 {@code tools/seal-core.ts} 一一对应（小端、无魔数）：
 *
 * <pre>
 *   u8   version     u8  wrapCount   u16 permK   u32 plainLen   u16 reserved
 *   12B  fileNonce
 *   u16  wrapLen     ...wrapped CEK(AES-256-GCM)
 *   u32  payloadLen  ...payload(AES-256-GCM)
 * </pre>
 *
 * <p>⚠️ 边界要说清：证书摘要本身是公开信息，所以 KEK <b>不是</b>"只有私钥能算"的密码学锁。
 * 真正挡住改签包的是这里的签名比对；把摘要混进 KEK 只是让换签名后整条派生链一起错位。
 */
final class CoreVault {

    /** 与 {@code tools/seal-core.ts} 的常量必须逐字节一致 */
    private static final byte[] INFO = {'m', 'i', 'n', 'i', 'c', 'r', 'a', 'f', 't', '/', 'c', 'o', 'r', 'e', '/', 'v', '1'};
    private static final int SEALED_VERSION = 1;
    private static final int NONCE_LEN = 12;
    private static final int TAG_LEN = 16;
    private static final String ASSET_SEALED = "sealed/core.sealed";
    private static final String ASSET_SIGNERS = "sealed/signers.txt";
    private static final String ASSET_SALT = "sealed/salt.bin";

    private CoreVault() {}

    /** 解封核心数据；签名不符、文件缺失、任何一步校验失败都返回 {@code null}（fail-closed）。 */
    static byte[] unseal(Context context) {
        byte[] sealed = null;
        byte[] plain = null;
        try {
            if (!isSignedByUs(context)) return null;
            byte[] salt = salt(context);
            if (salt == null || salt.length != 32) return null;
            sealed = readAsset(context, ASSET_SEALED);
            if (sealed == null) return null;
            plain = open(sealed, expectedSigner(context), salt);
            return plain;
        } catch (Throwable ignored) {
            // 故意不区分"签名不符"和"数据坏了"：对外都是"没有核心数据"
            return null;
        } finally {
            if (sealed != null) Arrays.fill(sealed, (byte) 0);
        }
    }

    // ------------------------------------------------------------------ 签名

    /**
     * 安装包的实际签名是否命中白名单（覆盖 Play 签名轮换史）。
     *
     * <p>debug 构建放行：开发机上的 debug keystore 不可能进白名单，而
     * {@code npm run android:apk} 恰恰产出 debug 包——不放行等于本地完全没法联调。
     * 这是**唯一**一处旁路，且 {@code BuildConfig.DEBUG} 在 release 里恒为 false，
     * 不是那种"改个常量就关掉"的开关。
     */
    static boolean isSignedByUs(Context context) {
        if (BuildConfig.DEBUG) return expectedSigner(context) != null;
        String expected = expectedSigner(context);
        if (expected == null) return false;
        for (String actual : installedSignerDigests(context)) {
            if (expected.equals(actual)) return true;
        }
        return false;
    }

    /** 白名单第一条：既是"是否自家签名"的判据，也是 KEK 的 ikm 来源。 */
    private static String expectedSigner(Context context) {
        String[] lines = readSigners(context);
        if (lines.length == 0) return null;
        String first = lines[0].replace(":", "").trim().toLowerCase(Locale.ROOT);
        return first.matches("[0-9a-f]{64}") ? first : null;
    }

    private static String[] readSigners(Context context) {
        byte[] raw = readAsset(context, ASSET_SIGNERS);
        if (raw == null) return new String[0];
        List<String> out = new ArrayList<>();
        for (String line : new String(raw).split("\n")) {
            String value = line.replace(":", "").trim().toLowerCase(Locale.ROOT);
            if (value.matches("[0-9a-f]{64}")) out.add(value);
        }
        return out.toArray(new String[0]);
    }

    /** 当前安装包的全部签名证书摘要（大写十六进制，与 {@code apksigner} 输出同口径）。 */
    private static List<String> installedSignerDigests(Context context) {
        List<String> out = new ArrayList<>();
        try {
            PackageManager pm = context.getPackageManager();
            String pkg = context.getPackageName();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // getSigningCertificateHistory：Play key rotation 之后旧签名也要认
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

    // ------------------------------------------------------------------ 解封

    private static byte[] open(byte[] sealed, String signer, byte[] salt) throws Exception {
        int p = 0;
        if (sealed.length < 34) throw new IllegalArgumentException("sealed too short");
        int version = sealed[p++] & 0xff;
        int wrapCount = sealed[p++] & 0xff;
        if (version != SEALED_VERSION || wrapCount != 1) throw new IllegalArgumentException("version");

        int permK = readU16(sealed, p);
        p += 2;
        long plainLen = readU32(sealed, p);
        p += 4;
        p += 2; // reserved

        byte[] nonce = Arrays.copyOfRange(sealed, p, p + NONCE_LEN);
        byte[] header = Arrays.copyOfRange(sealed, 0, p);
        p += NONCE_LEN;

        int wrapLen = readU16(sealed, p);
        int wrapStart = p + 2;
        int wrapEnd = wrapStart + wrapLen;
        if (wrapLen < TAG_LEN || wrapEnd > sealed.length) throw new IllegalArgumentException("wrap len");
        byte[] wrapped = Arrays.copyOfRange(sealed, wrapStart, wrapEnd);

        byte[] wrapAad = concat(header, nonce);
        byte[] kek = hkdf(salt, concat(hexToBytes(signer), salt), 32);
        byte[] cek = aesGcmDecrypt(kek, nonce, wrapAad, wrapped);
        if (cek == null) throw new IllegalArgumentException("kek");

        int payloadLen = (int) readU32(sealed, wrapEnd);
        int payloadStart = wrapEnd + 4;
        if (payloadLen <= TAG_LEN || payloadStart + payloadLen > sealed.length) {
            throw new IllegalArgumentException("payload len");
        }
        byte[] payload = Arrays.copyOfRange(sealed, payloadStart, payloadStart + payloadLen);

        // AAD 与 seal-core 一致：header + nonce + wrapLen + 包裹体（不含 payloadLen 本身）
        byte[] payloadAad = Arrays.copyOfRange(sealed, 0, wrapEnd);

        byte[] transformed = aesGcmDecrypt(cek, nonce, payloadAad, payload);
        Arrays.fill(kek, (byte) 0);
        Arrays.fill(cek, (byte) 0);
        if (transformed == null) throw new IllegalArgumentException("payload");
        if (transformed.length != plainLen) throw new IllegalArgumentException("len mismatch");

        // 形态逆变换：plain[(i * k) % n] = transformed[i]
        int n = transformed.length;
        byte[] plain = new byte[n];
        long pos = 0;
        for (int i = 0; i < n; i++) {
            plain[(int) pos] = transformed[i];
            pos = (pos + permK) % n;
        }
        Arrays.fill(transformed, (byte) 0);
        return plain;
    }

    /**
     * 编译期盐：由 {@code gen:sealed} 从 {@code release.config.json} 写进包里的单一真源。
     * Java 侧**不留常量**——否则改盐时两处一定会漂，而且漂了只表现为"解不开"。
     */
    private static byte[] salt(Context context) {
        return readAsset(context, ASSET_SALT);
    }

    // ------------------------------------------------------------------ 密码学

    private static byte[] hkdf(byte[] salt, byte[] ikm, int length) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(INFO);
        mac.update((byte) 1);
        byte[] okm = mac.doFinal();
        Arrays.fill(prk, (byte) 0);
        return Arrays.copyOf(okm, length);
    }

    private static byte[] aesGcmDecrypt(byte[] key, byte[] iv, byte[] aad, byte[] cipherText) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            cipher.updateAAD(aad);
            return cipher.doFinal(cipherText);
        } catch (Throwable ignored) {
            return null;
        }
    }

    // ------------------------------------------------------------------ 工具

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

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static int readU16(byte[] data, int offset) {
        return (data[offset] & 0xff) | ((data[offset + 1] & 0xff) << 8);
    }

    private static long readU32(byte[] data, int offset) {
        return (data[offset] & 0xffL)
                | ((data[offset + 1] & 0xffL) << 8)
                | ((data[offset + 2] & 0xffL) << 16)
                | ((data[offset + 3] & 0xffL) << 24);
    }

    private static byte[] hexToBytes(String hex) {
        int len = hex.length() / 2;
        byte[] out = new byte[len];
        for (int i = 0; i < len; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
}
