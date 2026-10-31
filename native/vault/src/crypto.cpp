#include "crypto.h"

#include <cstring>
#include <vector>

namespace vault {
namespace {

// ---------------------------------------------------------------------------
// SHA-256（FIPS 180-4）
// ---------------------------------------------------------------------------

constexpr uint32_t K256[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
    0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
    0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
    0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
    0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
    0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

inline uint32_t rotr32(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

void sha256_compress(uint32_t h[8], const uint8_t block[64]) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = (uint32_t(block[i * 4]) << 24) | (uint32_t(block[i * 4 + 1]) << 16) |
           (uint32_t(block[i * 4 + 2]) << 8) | uint32_t(block[i * 4 + 3]);
  }
  for (int i = 16; i < 64; i++) {
    const uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
    const uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }

  uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
  uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];
  for (int i = 0; i < 64; i++) {
    const uint32_t S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    const uint32_t ch = (e & f) ^ (~e & g);
    const uint32_t t1 = hh + S1 + ch + K256[i] + w[i];
    const uint32_t S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    const uint32_t t2 = S0 + maj;
    hh = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  h[0] += a;
  h[1] += b;
  h[2] += c;
  h[3] += d;
  h[4] += e;
  h[5] += f;
  h[6] += g;
  h[7] += hh;
}

// ---------------------------------------------------------------------------
// AES-256（只做加密方向的块函数，GCM/CTR 用不到解密路径）
// ---------------------------------------------------------------------------

inline uint8_t gf8_mul(uint8_t a, uint8_t b) {
  uint8_t p = 0;
  for (int i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const uint8_t hi = uint8_t(a & 0x80);
    a = uint8_t(a << 1);
    if (hi) a ^= 0x1b;
    b = uint8_t(b >> 1);
  }
  return p;
}

/**
 * S-box 由 GF(2^8) 乘法逆元 + 仿射变换**算出来**，而不是抄 256 个常量。
 *
 * 手抄常量表最容易出的错是"某一个字节抄错"，症状是部分向量能过、部分不能，
 * 极难定位。算法生成只有 6 行，且 GF 乘法和仿射都是标准定义，出错面更小。
 */
struct SboxTable {
  uint8_t t[256];
  SboxTable() {
    for (int a = 0; a < 256; a++) {
      // 逆元：a^254（0 的逆元定义为 0）
      uint8_t inv = 1;
      for (int i = 0; i < 254; i++) inv = gf8_mul(inv, uint8_t(a));
      if (a == 0) inv = 0;
      uint8_t s = inv;
      for (int r = 1; r <= 4; r++) s ^= uint8_t((inv << r) | (inv >> (8 - r)));
      s ^= 0x63;
      t[a] = s;
    }
  }
};

const uint8_t* sbox() {
  static const SboxTable table;  // C++11 起局部 static 初始化是线程安全的
  return table.t;
}

inline uint32_t sub_word(uint32_t w) {
  const uint8_t* s = sbox();
  return (uint32_t(s[(w >> 24) & 0xff]) << 24) | (uint32_t(s[(w >> 16) & 0xff]) << 16) |
         (uint32_t(s[(w >> 8) & 0xff]) << 8) | uint32_t(s[w & 0xff]);
}

inline uint8_t xtime(uint8_t a) { return uint8_t((a << 1) ^ ((a & 0x80) ? 0x1b : 0x00)); }

struct Aes256 {
  uint8_t rk[15 * 16];  // 15 轮密钥 × 16 字节（Nr = 14 → 15 组）
};

void aes256_init(Aes256* ctx, const uint8_t key[32]) {
  uint32_t w[60];
  for (int i = 0; i < 8; i++) {
    w[i] = (uint32_t(key[i * 4]) << 24) | (uint32_t(key[i * 4 + 1]) << 16) |
           (uint32_t(key[i * 4 + 2]) << 8) | uint32_t(key[i * 4 + 3]);
  }
  uint8_t rcon = 1;
  for (int i = 8; i < 60; i++) {
    uint32_t temp = w[i - 1];
    if (i % 8 == 0) {
      temp = sub_word((temp << 8) | (temp >> 24)) ^ (uint32_t(rcon) << 24);
      rcon = xtime(rcon);
    } else if (i % 8 == 4) {
      temp = sub_word(temp);
    }
    w[i] = w[i - 8] ^ temp;
  }
  for (int i = 0; i < 60; i++) {
    ctx->rk[i * 4 + 0] = uint8_t(w[i] >> 24);
    ctx->rk[i * 4 + 1] = uint8_t(w[i] >> 16);
    ctx->rk[i * 4 + 2] = uint8_t(w[i] >> 8);
    ctx->rk[i * 4 + 3] = uint8_t(w[i]);
  }
}

/** 状态按**列主序**存放：s[r + 4c] 是第 c 列第 r 行，与输入字节顺序一致。 */
void aes256_encrypt_block(const Aes256* ctx, const uint8_t in[16], uint8_t out[16]) {
  uint8_t s[16];
  std::memcpy(s, in, 16);
  const uint8_t* sboxT = sbox();

  auto add_round_key = [&s, ctx](int round) {
    const uint8_t* k = ctx->rk + round * 16;
    for (int i = 0; i < 16; i++) s[i] ^= k[i];
  };

  add_round_key(0);

  for (int round = 1; round <= 14; round++) {
    // SubBytes
    for (int i = 0; i < 16; i++) s[i] = sboxT[s[i]];

    // ShiftRows：第 r 行左移 r（行 r 的 4 个字节是 s[r], s[r+4], s[r+8], s[r+12]）
    for (int r = 1; r < 4; r++) {
      for (int n = 0; n < r; n++) {
        const uint8_t t = s[r];
        s[r] = s[r + 4];
        s[r + 4] = s[r + 8];
        s[r + 8] = s[r + 12];
        s[r + 12] = t;
      }
    }

    // MixColumns（最后一轮不做）
    if (round != 14) {
      for (int c = 0; c < 4; c++) {
        uint8_t* col = s + c * 4;
        const uint8_t a0 = col[0], a1 = col[1], a2 = col[2], a3 = col[3];
        const uint8_t all = uint8_t(a0 ^ a1 ^ a2 ^ a3);
        col[0] = uint8_t(a0 ^ all ^ xtime(uint8_t(a0 ^ a1)));
        col[1] = uint8_t(a1 ^ all ^ xtime(uint8_t(a1 ^ a2)));
        col[2] = uint8_t(a2 ^ all ^ xtime(uint8_t(a2 ^ a3)));
        col[3] = uint8_t(a3 ^ all ^ xtime(uint8_t(a3 ^ a0)));
      }
    }

    add_round_key(round);
  }

  std::memcpy(out, s, 16);
}

// ---------------------------------------------------------------------------
// GHASH / GCM
// ---------------------------------------------------------------------------

/** X ← X · H（GF(2^128)，MSB-first，reduction 0xE1） */
void gf128_mul(uint8_t x[16], const uint8_t h[16]) {
  uint8_t z[16] = {0};
  uint8_t v[16];
  std::memcpy(v, h, 16);

  for (int i = 0; i < 128; i++) {
    if (x[i / 8] & (0x80 >> (i % 8))) {
      for (int j = 0; j < 16; j++) z[j] ^= v[j];
    }
    const bool lsb = (v[15] & 1) != 0;
    for (int j = 15; j > 0; j--) v[j] = uint8_t((v[j] >> 1) | ((v[j - 1] & 1) << 7));
    v[0] = uint8_t(v[0] >> 1);
    if (lsb) v[0] ^= 0xe1;
  }
  std::memcpy(x, z, 16);
}

/** GHASH(H, AAD, CT) → out[16] */
void ghash(const uint8_t h[16], const uint8_t* aad, size_t aadLen,
           const uint8_t* ct, size_t ctLen, uint8_t out[16]) {
  uint8_t y[16] = {0};

  // 不足 16 字节的尾部补零，与 GCM 规范一致
  auto feed = [&y, h](const uint8_t* data, size_t len) {
    for (size_t off = 0; off < len; off += 16) {
      const size_t n = (len - off < 16) ? (len - off) : 16;
      for (size_t i = 0; i < n; i++) y[i] ^= data[off + i];
      gf128_mul(y, h);
    }
  };
  feed(aad, aadLen);
  feed(ct, ctLen);

  // 长度块：len(A) 与 len(C) 的**比特数**，各 64 位大端
  uint8_t lenBlock[16] = {0};
  const uint64_t aBits = uint64_t(aadLen) * 8;
  const uint64_t cBits = uint64_t(ctLen) * 8;
  for (int i = 0; i < 8; i++) {
    lenBlock[i] = uint8_t(aBits >> (56 - i * 8));
    lenBlock[8 + i] = uint8_t(cBits >> (56 - i * 8));
  }
  for (int i = 0; i < 16; i++) y[i] ^= lenBlock[i];
  gf128_mul(y, h);

  std::memcpy(out, y, 16);
}

void inc32(uint8_t counter[16]) {
  for (int i = 15; i >= 12; i--) {
    if (++counter[i] != 0) break;
  }
}

}  // namespace

// ---------------------------------------------------------------------------

void sha256(const uint8_t* data, size_t len, uint8_t out[32]) {
  uint32_t h[8] = {0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                   0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};

  const size_t fullBlocks = len / 64;
  for (size_t i = 0; i < fullBlocks; i++) sha256_compress(h, data + i * 64);

  // 尾部：剩余字节 + 0x80 + 补零 + 64 位比特长度
  uint8_t tail[128] = {0};
  const size_t rem = len - fullBlocks * 64;
  if (rem > 0) std::memcpy(tail, data + fullBlocks * 64, rem);
  tail[rem] = 0x80;
  const size_t tailLen = (rem + 1 + 8 <= 64) ? 64 : 128;
  const uint64_t bits = uint64_t(len) * 8;
  for (int i = 0; i < 8; i++) tail[tailLen - 1 - i] = uint8_t(bits >> (i * 8));

  sha256_compress(h, tail);
  if (tailLen == 128) sha256_compress(h, tail + 64);

  for (int i = 0; i < 8; i++) {
    out[i * 4 + 0] = uint8_t(h[i] >> 24);
    out[i * 4 + 1] = uint8_t(h[i] >> 16);
    out[i * 4 + 2] = uint8_t(h[i] >> 8);
    out[i * 4 + 3] = uint8_t(h[i]);
  }
}

void hmac_sha256(const uint8_t* key, size_t keyLen,
                 const uint8_t* data, size_t dataLen, uint8_t out[32]) {
  uint8_t k[64] = {0};
  if (keyLen > 64) {
    sha256(key, keyLen, k);  // 超长 key 先哈希，结果占前 32 字节，其余仍是 0
  } else if (keyLen > 0) {
    std::memcpy(k, key, keyLen);
  }

  uint8_t ipad[64], opad[64];
  for (int i = 0; i < 64; i++) {
    ipad[i] = uint8_t(k[i] ^ 0x36);
    opad[i] = uint8_t(k[i] ^ 0x5c);
  }

  uint8_t inner[32];
  {
    // sha256 不做流式，这里手工拼 ipad ‖ data
    std::vector<uint8_t> buf(64 + dataLen);
    std::memcpy(buf.data(), ipad, 64);
    if (dataLen > 0) std::memcpy(buf.data() + 64, data, dataLen);
    sha256(buf.data(), buf.size(), inner);
  }

  uint8_t outer[64 + 32];
  std::memcpy(outer, opad, 64);
  std::memcpy(outer + 64, inner, 32);
  sha256(outer, sizeof(outer), out);

  secure_zero(k, sizeof(k));
  secure_zero(ipad, sizeof(ipad));
  secure_zero(opad, sizeof(opad));
  secure_zero(inner, sizeof(inner));
}

bool hkdf_sha256(const uint8_t* salt, size_t saltLen,
                 const uint8_t* ikm, size_t ikmLen,
                 const uint8_t* info, size_t infoLen, uint8_t out[32]) {
  // Extract：prk = HMAC(salt, ikm)。salt 为空时按 RFC 5869 用全零 key。
  uint8_t zeroSalt[32] = {0};
  uint8_t prk[32];
  if (saltLen == 0) {
    hmac_sha256(zeroSalt, sizeof(zeroSalt), ikm, ikmLen, prk);
  } else {
    hmac_sha256(salt, saltLen, ikm, ikmLen, prk);
  }

  // Expand：T(1) = HMAC(prk, info ‖ 0x01)，L = 32 只需一轮
  std::vector<uint8_t> buf(infoLen + 1);
  if (infoLen > 0) std::memcpy(buf.data(), info, infoLen);
  buf[infoLen] = 0x01;
  hmac_sha256(prk, sizeof(prk), buf.data(), buf.size(), out);

  secure_zero(prk, sizeof(prk));
  return true;
}

bool aes256_gcm_open(const uint8_t key[32], const uint8_t iv[12],
                     const uint8_t* aad, size_t aadLen,
                     const uint8_t* sealed, size_t sealedLen, uint8_t* out) {
  if (sealedLen < 16) return false;
  if (aad == nullptr && aadLen != 0) return false;

  const size_t ctLen = sealedLen - 16;
  const uint8_t* ct = sealed;
  const uint8_t* tag = sealed + ctLen;

  Aes256 ctx;
  aes256_init(&ctx, key);

  // H = E_K(0^128)
  uint8_t zeroBlock[16] = {0};
  uint8_t h[16];
  aes256_encrypt_block(&ctx, zeroBlock, h);

  // J0 = IV ‖ 0x00000001（12 字节 IV 的 GCM 规范）
  uint8_t j0[16] = {0};
  std::memcpy(j0, iv, 12);
  j0[15] = 0x01;

  // 先算 tag 并校验，通过之后才解密 —— 避免把无效明文写进 out
  uint8_t s[16];
  ghash(h, aad, aadLen, ct, ctLen, s);
  uint8_t ek[16];
  aes256_encrypt_block(&ctx, j0, ek);
  uint8_t expected[16];
  for (int i = 0; i < 16; i++) expected[i] = uint8_t(s[i] ^ ek[i]);

  if (!constant_time_equal(expected, tag, 16)) {
    secure_zero(&ctx, sizeof(ctx));
    return false;
  }

  if (out != nullptr && ctLen > 0) {
    uint8_t counter[16];
    std::memcpy(counter, j0, 16);
    uint8_t stream[16];
    for (size_t off = 0; off < ctLen; off += 16) {
      inc32(counter);
      aes256_encrypt_block(&ctx, counter, stream);
      const size_t n = (ctLen - off < 16) ? (ctLen - off) : 16;
      for (size_t i = 0; i < n; i++) out[off + i] = uint8_t(ct[off + i] ^ stream[i]);
    }
    secure_zero(stream, sizeof(stream));
  }

  secure_zero(&ctx, sizeof(ctx));
  return true;
}

bool constant_time_equal(const uint8_t* a, const uint8_t* b, size_t len) {
  uint8_t diff = 0;
  for (size_t i = 0; i < len; i++) diff = uint8_t(diff | (a[i] ^ b[i]));
  return diff == 0;
}

void secure_zero(void* data, size_t len) {
  volatile uint8_t* p = static_cast<volatile uint8_t*>(data);
  while (len-- > 0) *p++ = 0;
}

}  // namespace vault
