// 整包解密 + 内存文件表（纯 C++，不依赖 JNI / Android / 平台类型）。
//
// ## 这一层的职责
//
// 把 `libmcrt.so` 那一坨密文变成"路径 → 字节"的可查询表，**并且把明文留在这里**。
//
// 为什么这是一次安全改进：在此之前，`BundleVault.java` 解密后会返回一个
// `Map<String, byte[]>`，整包 4~5 MB 的明文同时躺在 Java 堆上，dump 一次就全拿到了。
// 现在 Java 侧只有一个 `native` 声明，每次只取当前请求的那一个文件（几 KB ~ 几十 KB），
// 完整明文只存在于 native 堆里。
//
// ## 不复用 `BundleVault.java` 的原因
//
// 不是"翻译一遍更安全"，而是**这次要顺手消掉一份实现漂移**：`BundleVault.swift`
// 与 `BundleVault.java` 目前必须手工保持一致（注释里写着"与 tools/pack-bundle.ts
// 必须逐字节一致"），改一次格式要同时改 Java / Swift / TS 三处。这一份是纯 C++、
// 无平台依赖，将来 iOS 与桌面都能直接链接。
//
// ⚠️ 边界（写在这里以免下次误判）：钥匙仍然来自"安装包签名摘要"，而摘要是公开信息。
// 本层挡住的是"内存里没有整包明文"，不是"懂格式的人解不开"——后者纯客户端做不到。
//
// 包格式（小端，详见 tools/pack-bundle.ts）：
//   "\x7fELF" + 4B 占位
//   u8 version | u8 codec | u8 wrapCount | u8 reserved
//   32B salt | 12B nonce
//   wrapCount × (u16 len + AES-GCM(CEK))
//   u32 cipherLen
//   整段密文 = AES-GCM( gzip( "MCB1" 容器 ) )

#ifndef MINICRAFT_VAULT_VAULT_H
#define MINICRAFT_VAULT_VAULT_H

#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace vault {

class Bundle {
 public:
  Bundle() = default;
  ~Bundle();
  Bundle(const Bundle&) = delete;
  Bundle& operator=(const Bundle&) = delete;

  /**
   * 解析并解密整包。
   *
   * @param pkg        `libmcrt.so` 的全部字节
   * @param signerHex  64 位小写十六进制（安装包签名证书的 SHA-256）
   * @return false = 版本/格式不对、签名对不上、tag 校验失败、gzip 坏、容器坏
   *
   * 失败时内部状态保持为空，调用方按"没有游戏内容"处理即可（没有降级分支）。
   */
  bool open(const uint8_t* pkg, size_t pkgLen, const char* signerHex);

  /** 清空并尽力清零明文缓冲。可重复调用。 */
  void close();

  bool isOpen() const { return open_; }
  size_t fileCount() const { return entries_.size(); }

  /**
   * 查一个文件。
   *
   * @return 指向内部缓冲的指针（**生命周期与 Bundle 相同，不要 free**）；
   *         nullptr = 没有这个路径
   */
  const uint8_t* get(const char* path, size_t* outLen) const;

  /** 遍历用（CLI / 测试）。越界返回 nullptr。 */
  const char* pathAt(size_t index) const;
  size_t sizeAt(size_t index) const;

  /**
   * 解压后容器的总长度（**含索引区**）。
   *
   * 刻意与 `desktop/bundle.mjs` 的 `bytes` 取同一口径，这样跨端测试可以直接比对；
   * 想知道"纯文件内容有多少字节"，用 `sizeAt()` 求和。
   */
  size_t totalBytes() const { return open_ ? container_.size() : 0; }

 private:
  struct Entry {
    std::string path;
    uint32_t offset = 0;
    uint32_t length = 0;
  };

  bool parseContainer(const std::vector<uint8_t>& container);

  bool open_ = false;
  std::vector<uint8_t> container_;  // gunzip 之后的完整容器（含索引与数据区）
  size_t dataStart_ = 0;            // 数据区在 container_ 里的起点
  std::vector<Entry> entries_;
  std::unordered_map<std::string, size_t> index_;
};

/** 读整个文件到内存（CLI / JNI 共用）。 */
bool readFile(const char* path, std::vector<uint8_t>* out);

}  // namespace vault

#endif  // MINICRAFT_VAULT_VAULT_H
