package com.minicraft.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.zip.GZIPInputStream;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 整包解密：`assets/rt/libmcrt.so`（伪装成原生库）→ 内存里的"路径 → 字节"表。
 *
 * ## 密钥从哪来
 *
 *   KEK = HKDF-SHA256(盐, **安装包实际签名摘要** ‖ 盐)
 *
 * 摘要是 `PackageManager` 现场取的，不是文件里写死的期望值——所以换成别人的证书重签，
 * 派生出的 KEK 打不开包里任何一份包裹。**把校验代码删掉也没用**：数据本身没给他准备钥匙。
 *
 * ## 为什么整段解密而不是按文件
 *
 * 同一把 CEK，破一个文件等于破整包，逐文件只多了"懒解密"，在这个体积下没有收益；
 * 单段密文的语义更强：**包里任何一处被改，整段 GCM 校验就过不去**。
 *
 * ⚠️ 边界：证书摘要、盐、密文都在包里，读懂格式的人可以离线自己解。这里挡住的是
 * "改包重签后跑起来"，以及"解包后把游戏搬去别的站点"。
 */
final class BundleVault {

    /** 与 `tools/pack-bundle.ts` 必须逐字节一致 */
    private static final byte[] FAKE_ELF = {0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0};
    private static final byte[] INFO =
            {'m', 'i', 'n', 'i', 'c', 'r', 'a', 'f', 't', '/', 'b', 'u', 'n', 'd', 'l', 'e', '/', 'v', '1'};
    private static final int VERSION = 1;
    private static final int CODEC_GZIP = 1;
    private static final int NONCE_LEN = 12;
    private static final int TAG_LEN = 16;
    private static final String ASSET = "rt/libmcrt.so";

    private BundleVault() {}

    /** 解不开就返回 null——调用方一律按"没有游戏内容"处理，没有降级分支。 */
    static Map<String, byte[]> open(Context context) {
        try {
            byte[] pkg = readAsset(context, ASSET);
            if (pkg == null) return null;
            String signer = installedSignerDigest(context);
            if (signer == null) return null;
            return decrypt(pkg, signer);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static Map<String, byte[]> decrypt(byte[] pkg, String signerHex) throws Exception {
        if (pkg.length < 128) return null;
        if (!Arrays.equals(Arrays.copyOfRange(pkg, 0, 8), FAKE_ELF)) return null;

        int p = 8;
        int version = pkg[p] & 0xff;
        int codec = pkg[p + 1] & 0xff;
        int wrapCount = pkg[p + 2] & 0xff;
        p += 4;
        if (version != VERSION || codec != CODEC_GZIP || wrapCount < 1) return null;

        byte[] head = Arrays.copyOfRange(pkg, 8, 12);
        byte[] salt = Arrays.copyOfRange(pkg, p, p + 32);
        p += 32;
        byte[] fileNonce = Arrays.copyOfRange(pkg, p, p + NONCE_LEN);
        p += NONCE_LEN;

        byte[] wrapAad = concat(head, concat(salt, fileNonce));
        byte[] kek = hkdf(salt, concat(hexToBytes(signerHex), salt));

        byte[] cek = null;
        for (int i = 0; i < wrapCount; i++) {
            int len = readU16(pkg, p);
            int start = p + 2;
            int end = start + len;
            if (len < TAG_LEN || end > pkg.length) return null;
            if (cek == null) {
                cek = aesGcmOpen(kek, fileNonce, wrapAad, Arrays.copyOfRange(pkg, start, end));
            }
            p = end;
        }
        if (cek == null) return null;

        int bodyLen = readU32(pkg, p);
        int bodyStart = p + 4;
        if (bodyLen <= TAG_LEN || bodyStart + bodyLen > pkg.length) return null;

        // AAD 覆盖头部与全部包裹（不含假 ELF），与打包端一致
        byte[] payloadAad = Arrays.copyOfRange(pkg, 8, bodyStart - 4);
        byte[] compressed = aesGcmOpen(cek, fileNonce, payloadAad,
                Arrays.copyOfRange(pkg, bodyStart, bodyStart + bodyLen));
        Arrays.fill(kek, (byte) 0);
        Arrays.fill(cek, (byte) 0);
        if (compressed == null) return null;

        byte[] container = gunzip(compressed);
        if (container == null || container.length < 6) return null;
        if (container[0] != 'M' || container[1] != 'C' || container[2] != 'B' || container[3] != '1') return null;

        int count = readU16(container, 4);
        int q = 6;
        String[] paths = new String[count];
        int[] offsets = new int[count];
        int[] lengths = new int[count];
        for (int i = 0; i < count; i++) {
            int pathLen = readU16(container, q);
            q += 2;
            paths[i] = new String(container, q, pathLen, java.nio.charset.StandardCharsets.UTF_8);
            q += pathLen;
            offsets[i] = readU32(container, q);
            q += 4;
            lengths[i] = readU32(container, q);
            q += 4;
        }
        int dataStart = q;

        Map<String, byte[]> files = new HashMap<>(count * 2);
        for (int i = 0; i < count; i++) {
            int from = dataStart + offsets[i];
            int to = from + lengths[i];
            if (from < dataStart || to > container.length) return null;
            files.put(paths[i], Arrays.copyOfRange(container, from, to));
        }
        return files;
    }

    // ------------------------------------------------------------------ 签名

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

    private static byte[] gunzip(byte[] data) {
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(data))) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(data.length * 4);
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            return out.toByteArray();
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static byte[] hkdf(byte[] salt, byte[] ikm) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(ikm);
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));
        mac.update(INFO);
        mac.update((byte) 1);
        byte[] okm = mac.doFinal();
        Arrays.fill(prk, (byte) 0);
        return Arrays.copyOf(okm, 32);
    }

    private static byte[] aesGcmOpen(byte[] key, byte[] iv, byte[] aad, byte[] cipherText) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            cipher.updateAAD(aad);
            return cipher.doFinal(cipherText);
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

    private static int readU16(byte[] d, int o) {
        return (d[o] & 0xff) | ((d[o + 1] & 0xff) << 8);
    }

    private static int readU32(byte[] d, int o) {
        return (d[o] & 0xff) | ((d[o + 1] & 0xff) << 8) | ((d[o + 2] & 0xff) << 16) | ((d[o + 3] & 0xff) << 24);
    }

    private static byte[] hexToBytes(String hex) {
        String clean = hex.replace(":", "").trim();
        byte[] out = new byte[clean.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
}
