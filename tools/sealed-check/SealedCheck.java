package com.minicraft.app;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;

/**
 * 用**真实 JVM** 验证 `SealedCore.open()`（也就是 Android 上跑的那份代码）。
 *
 * <p>为什么值得单独跑一遍：`tools/sealed-test.ts` 验的是"格式自洽"，而它验的是
 * "Java 真的能解开"——两边各自独立实现同一套步骤，只有都对才能还原明文。
 * 不需要设备、不需要 Gradle，只要有 JDK（`tools/sealed-check.sh` 会调它）。
 *
 * <p>v2 起还有一条关键断言：**换成别人的签名摘要解不开**。这正是"patch 掉校验判断"
 * 也不管用的原因——密钥本身对不上。
 */
public final class SealedCheck {

    private static int passed = 0;
    private static int failed = 0;

    public static void main(String[] args) throws Exception {
        Path repo = Path.of(args[0]);
        byte[] plain = Files.readAllBytes(repo.resolve("host/core-baseline.bin"));
        Path sealedDir = repo.resolve("android/app/src/main/assets/sealed");
        byte[] sealed = Files.readAllBytes(sealedDir.resolve("core.sealed"));
        byte[] salt = Files.readAllBytes(sealedDir.resolve("salt.bin"));
        List<String> signers = Files.readAllLines(sealedDir.resolve("signers.txt"));
        String signer = signers.stream().filter(l -> l.matches("[0-9a-fA-F]{64}")).findFirst().orElse("");

        System.out.println("\n[JVM 实测：Java 侧用实际签名解封真实产物]");
        byte[] restored = SealedCore.open(sealed, signer, salt);
        check("解封成功", restored != null);
        check("长度一致", restored != null && restored.length == plain.length);
        check("内容逐字节一致", restored != null && Arrays.equals(restored, plain));
        check("SHA-256 一致", restored != null && Arrays.equals(sha256(restored), sha256(plain)));
        check("还原结果是合法方块表（MCTB）", restored != null && new String(restored, 0, 4).equals("MCTB"));

        System.out.println("\n[负面：任何一处改动都必须解不开]");
        byte[] tampered = sealed.clone();
        tampered[tampered.length - 20] ^= 0xff;
        check("载荷改一个字节 → 解不开", SealedCore.open(tampered, signer, salt) == null);

        check("换签名（别人的证书）→ 解不开", SealedCore.open(sealed, "11".repeat(32), salt) == null);

        byte[] otherSalt = new byte[32];
        Arrays.fill(otherSalt, (byte) 7);
        check("换盐 → 解不开", SealedCore.open(sealed, signer, otherSalt) == null);

        check("截断 → 解不开", SealedCore.open(Arrays.copyOf(sealed, 40), signer, salt) == null);
        check("空输入 → 解不开", SealedCore.open(new byte[0], signer, salt) == null);

        // 模拟"把校验判断改掉"：哪怕调用方放行，数据本身也不能被打开
        byte[] zeroWraps = sealed.clone();
        zeroWraps[1] = 0;
        check("把包裹数改成 0（模拟绕过判断）→ 解不开", SealedCore.open(zeroWraps, signer, salt) == null);

        System.out.println("\nJava 侧解封验证：" + passed + " 通过 / " + failed + " 失败");
        if (failed > 0) System.exit(1);
    }

    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (Exception e) {
            return new byte[0];
        }
    }

    private static void check(String name, boolean ok) {
        if (ok) {
            passed++;
            System.out.println("  ✓ " + name);
        } else {
            failed++;
            System.out.println("  ✗ " + name);
        }
    }
}
