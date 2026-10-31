// 密码学原语的标准向量自测。
//
// 为什么必须有这一份：`crypto.cpp` 里的 AES / SHA-256 / HKDF 是自己实现的
// （NDK 不再提供 BoringSSL，见 crypto.h 的注释）。自己实现密码学的风险是
// "看起来能跑、结果全错"，而错误症状会是"包解不开"，很容易被误判成格式问题。
//
// 这里用的向量都来自公开标准：
//   · SHA-256：FIPS 180-4 附录 B / 常用测试串
//   · HMAC-SHA256：RFC 4231 Test Case 1、2
//   · HKDF-SHA256：RFC 5869 Test Case 1
//   · AES-256-GCM：NIST GCM 规范里的 Test Case 13、14（全零 key/IV）
//
// 运行：`bash native/vault/build-host.sh && native/vault/build/host/vault-selftest`

#include "../src/crypto.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

int gPassed = 0;
int gFailed = 0;

std::string hex(const uint8_t* data, size_t len) {
  static const char* kDigits = "0123456789abcdef";
  std::string out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out.push_back(kDigits[data[i] >> 4]);
    out.push_back(kDigits[data[i] & 0x0f]);
  }
  return out;
}

std::vector<uint8_t> unhex(const char* text) {
  std::vector<uint8_t> out;
  auto nibble = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (size_t i = 0; text[i] != '\0' && text[i + 1] != '\0'; i += 2) {
    out.push_back(uint8_t((nibble(text[i]) << 4) | nibble(text[i + 1])));
  }
  return out;
}

void expect(const char* name, const std::string& actual, const char* expected) {
  if (actual == expected) {
    gPassed++;
    std::printf("  ok   %s\n", name);
  } else {
    gFailed++;
    std::printf("  FAIL %s\n    实际 %s\n    期望 %s\n", name, actual.c_str(), expected);
  }
}

void expectTrue(const char* name, bool value) {
  if (value) {
    gPassed++;
    std::printf("  ok   %s\n", name);
  } else {
    gFailed++;
    std::printf("  FAIL %s\n", name);
  }
}

// ---------------------------------------------------------------- SHA-256

void testSha256() {
  std::printf("\n[SHA-256]\n");
  uint8_t out[32];

  vault::sha256(reinterpret_cast<const uint8_t*>("abc"), 3, out);
  expect("空→\"abc\"", hex(out, 32),
         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  vault::sha256(reinterpret_cast<const uint8_t*>(""), 0, out);
  expect("空串", hex(out, 32),
         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  // 55/56/64 是补位分支的边界：55 走得下 64 字节块，56 必须溢到两块
  std::vector<uint8_t> block(64, 'a');
  vault::sha256(block.data(), 55, out);
  const std::string at55 = hex(out, 32);
  vault::sha256(block.data(), 56, out);
  const std::string at56 = hex(out, 32);
  expectTrue("55 字节与 56 字节结果不同（补位边界）", at55 != at56);

  // 超过一个块的长输入：用 Node 侧结果交叉核对（tests 里由 JS 再算一次）
  std::vector<uint8_t> longInput(1000, 'b');
  vault::sha256(longInput.data(), longInput.size(), out);
  std::printf("      1000×'b' = %s\n", hex(out, 32).c_str());
}

// ---------------------------------------------------------------- HMAC

void testHmac() {
  std::printf("\n[HMAC-SHA256 · RFC 4231]\n");
  uint8_t out[32];

  {
    const auto key = unhex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b");
    const char* data = "Hi There";
    vault::hmac_sha256(key.data(), key.size(),
                       reinterpret_cast<const uint8_t*>(data), std::strlen(data), out);
    expect("TestCase 1", hex(out, 32),
           "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  }

  {
    const char* key = "Jefe";
    const char* data = "what do ya want for nothing?";
    vault::hmac_sha256(reinterpret_cast<const uint8_t*>(key), std::strlen(key),
                       reinterpret_cast<const uint8_t*>(data), std::strlen(data), out);
    expect("TestCase 2", hex(out, 32),
           "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  }

  {
    // key 超过 64 字节时必须先哈希，这条专门盯那个分支
    std::vector<uint8_t> longKey(131, 0xaa);
    const char* data = "Test Using Larger Than Block-Size Key - Hash Key First";
    vault::hmac_sha256(longKey.data(), longKey.size(),
                       reinterpret_cast<const uint8_t*>(data), std::strlen(data), out);
    expect("TestCase 6（131 字节 key）", hex(out, 32),
           "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  }
}

// ---------------------------------------------------------------- HKDF

void testHkdf() {
  std::printf("\n[HKDF-SHA256 · RFC 5869 TestCase 1]\n");
  const auto ikm = unhex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b");
  const auto salt = unhex("000102030405060708090a0b0c");
  const auto info = unhex("f0f1f2f3f4f5f6f7f8f9");

  uint8_t okm[32];
  expectTrue("派生成功",
             vault::hkdf_sha256(salt.data(), salt.size(), ikm.data(), ikm.size(),
                                info.data(), info.size(), okm));
  // RFC 5869 的 L=42，我们只要前 32 字节
  expect("OKM[0..32)", hex(okm, 32),
         "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf");
}

// ---------------------------------------------------------------- AES-GCM

void testGcm() {
  std::printf("\n[AES-256-GCM · NIST Test Case 13 / 14]\n");

  const uint8_t zeroKey[32] = {0};
  const uint8_t zeroIv[12] = {0};

  {
    // Test Case 13：空明文、无 AAD，只有 tag
    const uint8_t sealed[16] = {0x53, 0x0f, 0x8a, 0xfb, 0xc7, 0x45, 0x36, 0xb9,
                                0xa9, 0x63, 0xb4, 0xf1, 0xc4, 0xcb, 0x73, 0x8b};
    expectTrue("TC13 空明文 tag 校验通过",
               vault::aes256_gcm_open(zeroKey, zeroIv, nullptr, 0, sealed, sizeof(sealed),
                                      nullptr));

    uint8_t tampered[16];
    std::memcpy(tampered, sealed, 16);
    tampered[3] ^= 0x01;
    expectTrue("TC13 改一个 tag 位 → 拒绝",
               !vault::aes256_gcm_open(zeroKey, zeroIv, nullptr, 0, tampered, 16, nullptr));
  }

  {
    // Test Case 14：16 字节全零明文
    const auto sealed = unhex("cea7403d4d606b6e074ec5d3baf39d18"
                              "d0d1c8a799996bf0265b98b5d48ab919");
    uint8_t plain[16];
    expectTrue("TC14 解密成功",
               vault::aes256_gcm_open(zeroKey, zeroIv, nullptr, 0, sealed.data(),
                                      sealed.size(), plain));
    expect("TC14 明文全是 0", hex(plain, 16), "00000000000000000000000000000000");
  }

  {
    // AAD 必须参与认证：同一个 (key, iv, 密文) 换掉 AAD 就得失败
    const auto sealed = unhex("cea7403d4d606b6e074ec5d3baf39d18"
                              "d0d1c8a799996bf0265b98b5d48ab919");
    const uint8_t aad[4] = {1, 2, 3, 4};
    expectTrue("TC14 加 AAD → 拒绝（AAD 被绑定）",
               !vault::aes256_gcm_open(zeroKey, zeroIv, aad, sizeof(aad), sealed.data(),
                                       sealed.size(), nullptr));
  }

  {
    // 截断：短于一个 tag 的输入必须直接拒绝，不能越界读
    const uint8_t shortInput[8] = {0};
    expectTrue("短于 tag → 拒绝",
               !vault::aes256_gcm_open(zeroKey, zeroIv, nullptr, 0, shortInput,
                                       sizeof(shortInput), nullptr));
  }
}

// ---------------------------------------------------------------- 工具函数

void testUtilities() {
  std::printf("\n[工具]\n");
  const uint8_t a[4] = {1, 2, 3, 4};
  const uint8_t b[4] = {1, 2, 3, 4};
  const uint8_t c[4] = {1, 2, 3, 5};
  expectTrue("常量时间比较：相等", vault::constant_time_equal(a, b, 4));
  expectTrue("常量时间比较：不等", !vault::constant_time_equal(a, c, 4));

  uint8_t buf[8];
  std::memset(buf, 0xaa, sizeof(buf));
  vault::secure_zero(buf, sizeof(buf));
  bool allZero = true;
  for (uint8_t v : buf) allZero = allZero && v == 0;
  expectTrue("secure_zero 清零", allZero);
}

}  // namespace

int main() {
  std::printf("vault 密码学自测\n");
  testSha256();
  testHmac();
  testHkdf();
  testGcm();
  testUtilities();

  std::printf("\n自测：%d 通过 / %d 失败\n", gPassed, gFailed);
  return gFailed > 0 ? 1 : 0;
}
