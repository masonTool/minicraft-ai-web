// 自包含的密码学原语（SHA-256 / HMAC-SHA256 / HKDF / AES-256-GCM）。
//
// ## 为什么自己实现，而不链接 openssl/boringssl
//
// 实测 NDK 28 与 29 的 sysroot 里**既没有 `openssl/` 头、也没有 `libcrypto`**
// （BoringSSL 已从应用可见的 NDK 接口里移除）。host 上有 Homebrew OpenSSL，
// Android 上没有——如果 Android 用 BoringSSL、host 用 OpenSSL 做测试，测的就
// 不是同一份代码，"host 上通过"不能代表设备行为。
//
// 自己实现让两端编**同一份源码**，host 上跑标准向量即可代表设备。
//
// ## GCM 只需要"加密方向"的 AES 块函数
//
// GCM 的解密 = CTR 模式异或同一个 keystream，而 CTR 只用 AES 的加密路径。
// 所以这里**不需要逆 S-box、不需要 InvMixColumns**，代码量和出错面都减半。
//
// 正确性由 `test/selftest.cpp` 里的标准向量兜底：
//   · AES-256-GCM：NIST GCM 测试向量（空明文 / 单块 / 多块 / AAD）
//   · SHA-256：FIPS 180-4 的 "abc" / 空串 / 长串
//   · HKDF：RFC 5869 Test Case 1~3
//
// ⚠️ 这里刻意不用 C++ 异常（NDK 默认 -fno-exceptions 更省体积），一律返回 bool。

#ifndef MINICRAFT_VAULT_CRYPTO_H
#define MINICRAFT_VAULT_CRYPTO_H

#include <cstddef>
#include <cstdint>

namespace vault {

/** SHA-256。out 必须是 32 字节。 */
void sha256(const uint8_t* data, size_t len, uint8_t out[32]);

/** HMAC-SHA256。out 必须是 32 字节。 */
void hmac_sha256(const uint8_t* key, size_t keyLen,
                 const uint8_t* data, size_t dataLen,
                 uint8_t out[32]);

/**
 * HKDF-SHA256（RFC 5869），只取前 32 字节输出。
 *
 * 与 `tools/pack-bundle.ts` 的 `hkdfSync('sha256', ikm, salt, info, 32)` 逐字节一致，
 * 也与 `BundleVault.java` 里手写的两轮 HMAC 一致。
 */
bool hkdf_sha256(const uint8_t* salt, size_t saltLen,
                 const uint8_t* ikm, size_t ikmLen,
                 const uint8_t* info, size_t infoLen,
                 uint8_t out[32]);

/**
 * AES-256-GCM 解密。
 *
 * @param key           32 字节
 * @param iv            12 字节（GCM 标准 nonce 长度，与打包端一致）
 * @param aad           附加认证数据，可为 nullptr（aadLen 必须为 0）
 * @param sealed        密文 ‖ 16 字节 tag
 * @param sealedLen     ≥ 16
 * @param out           明文输出，长度 = sealedLen - 16；可为 nullptr 表示只校验 tag
 * @return false = tag 不匹配或参数非法（此时 out 内容无意义）
 *
 * ⚠️ tag 校验通过之前**不向 out 写入任何字节**：先解到临时缓冲再整体拷贝，
 * 避免"校验失败但明文已经落到调用方缓冲里"。
 */
bool aes256_gcm_open(const uint8_t key[32], const uint8_t iv[12],
                     const uint8_t* aad, size_t aadLen,
                     const uint8_t* sealed, size_t sealedLen,
                     uint8_t* out);

/** 常量时间比较：长度不等直接 false，相等时耗时与"第几字节不同"无关。 */
bool constant_time_equal(const uint8_t* a, const uint8_t* b, size_t len);

/** 尽力清零（用 volatile 写，避免被优化掉）。 */
void secure_zero(void* data, size_t len);

}  // namespace vault

#endif  // MINICRAFT_VAULT_CRYPTO_H
