package com.minicraft.app;

import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 封存体的解析与解密：**纯 Java，不碰 Android API**。
 *
 * <p>为什么从这里切一刀：`CoreVault` 要读 assets、查签名，全是 Android 的东西，于是它
 * 在普通 JVM 上跑不起来——而"格式对不对"恰恰是最该被验证的一件事。把纯粹的字节处理
 * 抽出来之后，同一份代码可以被 javac 编译、被 JVM 直接跑真实产物（见
 * `tools/sealed-check.sh`），不需要设备、不需要 Gradle。
 *
 * <p>格式 v2 与 `tools/seal-core.ts` 一一对应（小端、无魔数）：
 *
 * <pre>
 *   u8 version   u8 wrapCount   u16 permK   u32 plainLen   u16 reserved
 *   12B nonce
 *   wrapCount × (u16 wrapLen + 包裹后的 CEK)
 *   u32 payloadLen ...payload
 * </pre>
 *
 * <p>关键点：传入的 {@code signerHex} 必须是**安装包实际签名**的摘要。
 * KEK 由它派生，只有与之一致的包裹体能打开——于是"把校验判断 patch 成 true"没有意义，
 * 换证书重签的包拿不到 CEK。
 */
final class SealedCore {

    /** 与 `tools/seal-core.ts` 的 INFO 必须逐字节一致 */
    private static final byte[] INFO =
            {'m', 'i', 'n', 'i', 'c', 'r', 'a', 'f', 't', '/', 'c', 'o', 'r', 'e', '/', 'v', '1'};
    private static final int VERSION = 2;
    private static final int NONCE_LEN = 12;
    private static final int TAG_LEN = 16;

    private SealedCore() {}

    /**
     * 解封。返回 `null` 表示"打不开"——签名不对、数据被改、版本不符，一律同一个结果。
     *
     * @param sealed    封存体字节
     * @param signerHex **实际**签名证书摘要（十六进制，大小写不敏感）
     * @param salt      编译期盐（32 字节）
     */
    static byte[] open(byte[] sealed, String signerHex, byte[] salt) {
        if (sealed == null || salt == null || salt.length != 32 || signerHex == null) return null;
        try {
            return decrypt(sealed, signerHex, salt);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static byte[] decrypt(byte[] sealed, String signerHex, byte[] salt) throws Exception {
        int p = 0;
        if (sealed.length < 34) return null;
        int version = sealed[p++] & 0xff;
        int wrapCount = sealed[p++] & 0xff;
        if (version != VERSION || wrapCount < 1) return null;

        int permK = readU16(sealed, p);
        p += 2;
        int plainLen = readU32(sealed, p);
        p += 4;
        p += 2; // reserved

        byte[] header = Arrays.copyOfRange(sealed, 0, p);
        byte[] nonce = Arrays.copyOfRange(sealed, p, p + NONCE_LEN);
        p += NONCE_LEN;
        int wrapBlockStart = p;

        // 用**实际**签名派生一次 KEK；只有与之匹配的那份包裹体能打开
        byte[] kek = hkdf(salt, concat(hexToBytes(signerHex), salt));
        byte[] wrapAad = concat(header, nonce);

        byte[] cek = null;
        for (int i = 0; i < wrapCount; i++) {
            int len = readU16(sealed, p);
            int start = p + 2;
            int end = start + len;
            if (len < TAG_LEN || end > sealed.length) return null;
            if (cek == null) {
                cek = aesGcmOpen(kek, nonce, wrapAad, Arrays.copyOfRange(sealed, start, end));
            }
            p = end;
        }
        if (cek == null) return null;

        int wrapBlockLen = p - wrapBlockStart;
        int payloadLen = readU32(sealed, p);
        int payloadStart = p + 4;
        if (payloadLen <= TAG_LEN || payloadStart + payloadLen > sealed.length) return null;

        // AAD 绑上"全部包裹体"：少一份、改一份，载荷都解不开
        byte[] payloadAad = new byte[header.length + NONCE_LEN + wrapBlockLen];
        System.arraycopy(header, 0, payloadAad, 0, header.length);
        System.arraycopy(nonce, 0, payloadAad, header.length, NONCE_LEN);
        System.arraycopy(sealed, wrapBlockStart, payloadAad, header.length + NONCE_LEN, wrapBlockLen);

        byte[] transformed = aesGcmOpen(
                cek, nonce, payloadAad, Arrays.copyOfRange(sealed, payloadStart, payloadStart + payloadLen));
        Arrays.fill(kek, (byte) 0);
        Arrays.fill(cek, (byte) 0);
        if (transformed == null || transformed.length != plainLen) return null;

        // 形态逆变换：plain[(i * k) % n] = transformed[i]
        int n = transformed.length;
        byte[] plain = new byte[n];
        int position = 0;
        for (int i = 0; i < n; i++) {
            plain[position] = transformed[i];
            position = (position + permK) % n;
        }
        Arrays.fill(transformed, (byte) 0);
        return plain;
    }

    // ------------------------------------------------------------------ 密码学

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

    // ------------------------------------------------------------------ 工具

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static int readU16(byte[] data, int offset) {
        return (data[offset] & 0xff) | ((data[offset + 1] & 0xff) << 8);
    }

    private static int readU32(byte[] data, int offset) {
        return (data[offset] & 0xff)
                | ((data[offset + 1] & 0xff) << 8)
                | ((data[offset + 2] & 0xff) << 16)
                | ((data[offset + 3] & 0xff) << 24);
    }

    static byte[] hexToBytes(String hex) {
        String clean = hex.replace(":", "").trim();
        if (clean.length() % 2 != 0) return new byte[0];
        byte[] out = new byte[clean.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }
}
