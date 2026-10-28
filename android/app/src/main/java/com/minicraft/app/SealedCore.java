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
 * <p>格式与 `tools/seal-core.ts` 一一对应（小端、无魔数）：
 *
 * <pre>
 *   u8 version   u8 wrapCount   u16 permK   u32 plainLen   u16 reserved
 *   12B nonce
 *   u16 wrapLen  ...wrapped CEK(AES-256-GCM)
 *   u32 payloadLen ...payload(AES-256-GCM)
 * </pre>
 */
final class SealedCore {

    /** 与 `tools/seal-core.ts` 的 INFO 必须逐字节一致 */
    private static final byte[] INFO =
            {'m', 'i', 'n', 'i', 'c', 'r', 'a', 'f', 't', '/', 'c', 'o', 'r', 'e', '/', 'v', '1'};
    private static final int VERSION = 1;
    private static final int NONCE_LEN = 12;
    private static final int TAG_LEN = 16;

    private SealedCore() {}

    /**
     * 解封。返回 `null` 表示"打不开"——签名不对、数据被改、版本不符，一律同一个结果。
     *
     * @param sealed    封存体字节
     * @param signerHex 期望的签名证书摘要（十六进制，大小写不敏感）
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
        if (version != VERSION || wrapCount != 1) return null;

        int permK = readU16(sealed, p);
        p += 2;
        int plainLen = readU32(sealed, p);
        p += 4;
        p += 2; // reserved

        byte[] header = Arrays.copyOfRange(sealed, 0, p);
        byte[] nonce = Arrays.copyOfRange(sealed, p, p + NONCE_LEN);
        p += NONCE_LEN;

        int wrapLen = readU16(sealed, p);
        int wrapStart = p + 2;
        int wrapEnd = wrapStart + wrapLen;
        if (wrapLen < TAG_LEN || wrapEnd > sealed.length) return null;
        byte[] wrapped = Arrays.copyOfRange(sealed, wrapStart, wrapEnd);

        byte[] kek = hkdf(salt, concat(hexToBytes(signerHex), salt));
        byte[] cek = aesGcmOpen(kek, nonce, concat(header, nonce), wrapped);
        if (cek == null) return null;

        int payloadLen = readU32(sealed, wrapEnd);
        int payloadStart = wrapEnd + 4;
        if (payloadLen <= TAG_LEN || payloadStart + payloadLen > sealed.length) return null;
        byte[] payload = Arrays.copyOfRange(sealed, payloadStart, payloadStart + payloadLen);

        // AAD 与 seal-core 一致：header + nonce + wrapLen + 包裹体（不含 payloadLen 本身）
        byte[] transformed = aesGcmOpen(cek, nonce, Arrays.copyOfRange(sealed, 0, wrapEnd), payload);
        if (transformed == null || transformed.length != plainLen) return null;

        // 形态逆变换：plain[(i * k) % n] = transformed[i]
        int n = transformed.length;
        byte[] plain = new byte[n];
        int position = 0;
        for (int i = 0; i < n; i++) {
            plain[position] = transformed[i];
            position = (position + permK) % n;
        }
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
