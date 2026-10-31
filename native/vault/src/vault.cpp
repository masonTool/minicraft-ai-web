#include "vault.h"

#include "crypto.h"

#include <cstdio>
#include <cstring>

#include <zlib.h>

namespace vault {
namespace {

// 与 tools/pack-bundle.ts **必须逐字节一致**
constexpr uint8_t FAKE_ELF[8] = {0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0};
constexpr uint8_t INFO[] = {'m', 'i', 'n', 'i', 'c', 'r', 'a', 'f', 't', '/',
                            'b', 'u', 'n', 'd', 'l', 'e', '/', 'v', '1'};
constexpr uint8_t VERSION = 1;
constexpr uint8_t CODEC_GZIP = 1;
constexpr size_t NONCE_LEN = 12;
constexpr size_t TAG_LEN = 16;
constexpr size_t SALT_LEN = 32;
constexpr size_t HEAD_OFFSET = 8;  // 假 ELF 头之后的头部起点

uint16_t readU16(const uint8_t* d, size_t o) {
  return uint16_t(uint16_t(d[o]) | (uint16_t(d[o + 1]) << 8));
}

uint32_t readU32(const uint8_t* d, size_t o) {
  return uint32_t(d[o]) | (uint32_t(d[o + 1]) << 8) | (uint32_t(d[o + 2]) << 16) |
         (uint32_t(d[o + 3]) << 24);
}

/**
 * 十六进制 → 字节。允许冒号分隔（`apksigner` 的输出形态），与 Java 侧
 * `hexToBytes` 的 `replace(":", "")` 对齐。
 *
 * 严格要求**恰好**填满 outLen：少了或多了都算无效签名，避免"截断后仍能解"。
 */
bool hexToBytes(const char* hex, uint8_t* out, size_t outLen) {
  if (hex == nullptr) return false;
  auto nibble = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };

  size_t written = 0;
  for (size_t i = 0; hex[i] != '\0';) {
    if (hex[i] == ':') {
      i++;
      continue;
    }
    if (hex[i + 1] == '\0') return false;
    const int hi = nibble(hex[i]);
    const int lo = nibble(hex[i + 1]);
    if (hi < 0 || lo < 0) return false;
    if (written >= outLen) return false;
    out[written++] = uint8_t((hi << 4) | lo);
    i += 2;
  }
  return written == outLen;
}

/** gzip 解压。`15 + 32` 让 zlib 自动识别 gzip / zlib 头。 */
bool gunzip(const uint8_t* data, size_t len, std::vector<uint8_t>* out) {
  out->clear();
  if (data == nullptr || len == 0) return false;

  z_stream stream{};
  if (inflateInit2(&stream, 15 + 32) != Z_OK) return false;
  stream.next_in = const_cast<Bytef*>(reinterpret_cast<const Bytef*>(data));
  stream.avail_in = uInt(len);

  uint8_t chunk[64 * 1024];
  bool ok = false;
  for (;;) {
    stream.next_out = chunk;
    stream.avail_out = uInt(sizeof(chunk));
    const int ret = inflate(&stream, Z_NO_FLUSH);
    const size_t produced = sizeof(chunk) - stream.avail_out;
    if (produced > 0) out->insert(out->end(), chunk, chunk + produced);
    if (ret == Z_STREAM_END) {
      ok = true;
      break;
    }
    if (ret != Z_OK && ret != Z_BUF_ERROR) break;
    // 既没产出也没输入可消耗 = 卡住了（截断包会走到这里），防止死循环
    if (produced == 0 && stream.avail_in == 0) break;
  }

  inflateEnd(&stream);
  if (!ok) out->clear();
  return ok;
}

}  // namespace

Bundle::~Bundle() { close(); }

bool Bundle::open(const uint8_t* pkg, size_t pkgLen, const char* signerHex) {
  close();
  if (pkg == nullptr || pkgLen < 128) return false;
  if (std::memcmp(pkg, FAKE_ELF, sizeof(FAKE_ELF)) != 0) return false;

  const uint8_t version = pkg[8];
  const uint8_t codec = pkg[9];
  const uint8_t wrapCount = pkg[10];
  if (version != VERSION || codec != CODEC_GZIP || wrapCount < 1) return false;

  // head(4) ‖ salt(32) ‖ nonce(12)
  size_t p = HEAD_OFFSET + 4;
  if (p + SALT_LEN + NONCE_LEN > pkgLen) return false;
  const uint8_t* salt = pkg + p;
  p += SALT_LEN;
  const uint8_t* nonce = pkg + p;
  p += NONCE_LEN;

  // 包裹的 AAD = head ‖ salt ‖ nonce（48 字节）
  uint8_t wrapAad[4 + SALT_LEN + NONCE_LEN];
  std::memcpy(wrapAad, pkg + HEAD_OFFSET, 4);
  std::memcpy(wrapAad + 4, salt, SALT_LEN);
  std::memcpy(wrapAad + 4 + SALT_LEN, nonce, NONCE_LEN);

  uint8_t signer[32];
  if (!hexToBytes(signerHex, signer, sizeof(signer))) return false;

  // KEK = HKDF-SHA256(salt, 摘要 ‖ salt, info="minicraft/bundle/v1")
  uint8_t ikm[64];
  std::memcpy(ikm, signer, sizeof(signer));
  std::memcpy(ikm + sizeof(signer), salt, SALT_LEN);
  uint8_t kek[32];
  hkdf_sha256(salt, SALT_LEN, ikm, sizeof(ikm), INFO, sizeof(INFO), kek);
  secure_zero(signer, sizeof(signer));
  secure_zero(ikm, sizeof(ikm));

  // 按顺序尝试每一份包裹，**直到成功为止**（与 BundleVault.java 的 `if (cek == null)` 一致）。
  //
  // 注意这不是"只解第一份"：第一份解失败时 cek 仍是 null，下一轮会继续尝试。
  // 所以白名单里的多份签名（正式 + debug）都能开同一个包，顺序不影响正确性，
  // 只影响命中的早晚——正式包仍应把正式证书排第一，省一次多余的 GCM 尝试。
  uint8_t cek[32];
  bool haveCek = false;
  bool ok = true;
  for (uint8_t i = 0; i < wrapCount && ok; i++) {
    if (p + 2 > pkgLen) {
      ok = false;
      break;
    }
    const uint16_t len = readU16(pkg, p);
    const size_t start = p + 2;
    if (len < TAG_LEN || start + len > pkgLen) {
      ok = false;
      break;
    }
    if (!haveCek) {
      haveCek = aes256_gcm_open(kek, nonce, wrapAad, sizeof(wrapAad), pkg + start, len, cek);
    }
    p = start + len;
  }
  secure_zero(kek, sizeof(kek));
  if (!ok || !haveCek) {
    secure_zero(cek, sizeof(cek));
    return false;
  }

  // 整段密文
  if (p + 4 > pkgLen) {
    secure_zero(cek, sizeof(cek));
    return false;
  }
  const uint32_t bodyLen = readU32(pkg, p);
  const size_t bodyStart = p + 4;
  if (bodyLen <= TAG_LEN || bodyStart + bodyLen > pkgLen) {
    secure_zero(cek, sizeof(cek));
    return false;
  }

  // body 的 AAD = pkg[8 .. bodyLen 字段之前)，即 head ‖ salt ‖ nonce ‖ 全部包裹
  const size_t payloadAadLen = p - HEAD_OFFSET;
  std::vector<uint8_t> compressed(bodyLen - TAG_LEN);
  const bool bodyOk = aes256_gcm_open(cek, nonce, pkg + HEAD_OFFSET, payloadAadLen,
                                      pkg + bodyStart, bodyLen, compressed.data());
  secure_zero(cek, sizeof(cek));
  if (!bodyOk) return false;

  std::vector<uint8_t> container;
  const bool gzOk = gunzip(compressed.data(), compressed.size(), &container);
  secure_zero(compressed.data(), compressed.size());
  if (!gzOk) return false;

  if (!parseContainer(container)) return false;

  container_ = std::move(container);
  open_ = true;
  return true;
}

bool Bundle::parseContainer(const std::vector<uint8_t>& container) {
  if (container.size() < 6) return false;
  if (container[0] != 'M' || container[1] != 'C' || container[2] != 'B' || container[3] != '1') {
    return false;
  }

  const uint16_t count = readU16(container.data(), 4);
  size_t q = 6;
  entries_.clear();
  entries_.reserve(count);

  for (uint16_t i = 0; i < count; i++) {
    if (q + 2 > container.size()) return false;
    const uint16_t pathLen = readU16(container.data(), q);
    q += 2;
    if (q + pathLen + 8 > container.size()) return false;

    Entry entry;
    entry.path.assign(reinterpret_cast<const char*>(container.data() + q), pathLen);
    q += pathLen;
    entry.offset = readU32(container.data(), q);
    q += 4;
    entry.length = readU32(container.data(), q);
    q += 4;
    entries_.push_back(std::move(entry));
  }

  dataStart_ = q;
  const size_t dataLen = container.size() - dataStart_;
  for (const Entry& entry : entries_) {
    // 用减法避免 size_t 下溢：offset/length 都是包里给的，不可信
    if (size_t(entry.offset) > dataLen) return false;
    if (size_t(entry.length) > dataLen - size_t(entry.offset)) return false;
  }

  index_.clear();
  index_.reserve(entries_.size() * 2);
  for (size_t i = 0; i < entries_.size(); i++) index_[entries_[i].path] = i;
  return true;
}

const uint8_t* Bundle::get(const char* path, size_t* outLen) const {
  if (!open_ || path == nullptr) return nullptr;

  std::string key(path);
  size_t start = 0;
  while (start < key.size() && key[start] == '/') start++;
  key.erase(0, start);
  const size_t query = key.find('?');
  if (query != std::string::npos) key.erase(query);

  const auto it = index_.find(key);
  if (it == index_.end()) return nullptr;
  const Entry& entry = entries_[it->second];
  if (outLen != nullptr) *outLen = entry.length;
  return container_.data() + dataStart_ + entry.offset;
}

const char* Bundle::pathAt(size_t index) const {
  return index < entries_.size() ? entries_[index].path.c_str() : nullptr;
}

size_t Bundle::sizeAt(size_t index) const {
  return index < entries_.size() ? entries_[index].length : 0;
}

void Bundle::close() {
  open_ = false;
  if (!container_.empty()) {
    secure_zero(container_.data(), container_.size());
    container_.clear();
  }
  container_.shrink_to_fit();
  dataStart_ = 0;
  entries_.clear();
  index_.clear();
}

bool readFile(const char* path, std::vector<uint8_t>* out) {
  if (path == nullptr || out == nullptr) return false;
  std::FILE* file = std::fopen(path, "rb");
  if (file == nullptr) return false;

  bool ok = false;
  if (std::fseek(file, 0, SEEK_END) == 0) {
    const long size = std::ftell(file);
    if (size >= 0 && std::fseek(file, 0, SEEK_SET) == 0) {
      out->resize(size_t(size));
      const size_t got = size > 0 ? std::fread(out->data(), 1, size_t(size), file) : 0;
      ok = got == size_t(size);
    }
  }
  std::fclose(file);
  if (!ok) out->clear();
  return ok;
}

}  // namespace vault
