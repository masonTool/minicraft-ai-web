// host 侧的命令行工具（**只用于测试与调试，不进 APK**）。
//
// 存在的理由：`vault.cpp` 里那套解密逻辑，在设备上跑之前必须先证明它和
// `tools/pack-bundle.ts` 打出来的包、以及 `desktop/bundle.mjs` 的解出来的内容
// 完全一致。否则"手机上白屏"要付出真机 + logcat 的代价才能发现。
//
// 用法：
//   vault-cli info   <pkg> <signer-hex>             → "ok <文件数> <明文字节>"
//   vault-cli list   <pkg> <signer-hex>             → 每行 "<字节数>\t<路径>"
//   vault-cli unpack <pkg> <signer-hex> <outdir>    → 解到目录，输出 "ok <文件数>"
//   vault-cli read   <pkg> <signer-hex> <path>      → 原始字节写到 stdout
//
// 失败一律退出码 1 并打印 "fail"（不要依赖 stderr 文案做断言）。

#include "vault.h"

#include <cstdio>
#include <cstring>
#include <string>

#include <sys/stat.h>
#include <sys/types.h>

namespace {

/** 逐级 mkdir（不依赖 C++17 filesystem，避免旧 NDK / 旧 SDK 的兼容问题）。 */
bool makeDirs(const std::string& path) {
  if (path.empty()) return false;
  std::string current;
  for (size_t i = 0; i <= path.size(); i++) {
    if (i == path.size() || path[i] == '/') {
      if (!current.empty()) {
        struct stat st{};
        if (stat(current.c_str(), &st) != 0) {
          if (mkdir(current.c_str(), 0755) != 0) return false;
        } else if (!S_ISDIR(st.st_mode)) {
          return false;
        }
      }
      if (i < path.size()) current.push_back('/');
    } else {
      current.push_back(path[i]);
    }
  }
  return true;
}

bool writeFile(const std::string& path, const uint8_t* data, size_t len) {
  std::FILE* file = std::fopen(path.c_str(), "wb");
  if (file == nullptr) return false;
  const bool ok = len == 0 || std::fwrite(data, 1, len, file) == len;
  std::fclose(file);
  return ok;
}

int usage() {
  std::fprintf(stderr,
               "用法:\n"
               "  vault-cli info   <pkg> <signer-hex>\n"
               "  vault-cli list   <pkg> <signer-hex>\n"
               "  vault-cli unpack <pkg> <signer-hex> <outdir>\n"
               "  vault-cli read   <pkg> <signer-hex> <path>\n");
  return 2;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 4) return usage();

  const std::string command = argv[1];
  const std::string pkgPath = argv[2];
  const std::string signer = argv[3];

  std::vector<uint8_t> pkg;
  if (!vault::readFile(pkgPath.c_str(), &pkg)) {
    std::fprintf(stderr, "读不到包：%s\n", pkgPath.c_str());
    return 1;
  }

  vault::Bundle bundle;
  if (!bundle.open(pkg.data(), pkg.size(), signer.c_str())) {
    std::printf("fail\n");
    return 1;
  }

  if (command == "info") {
    std::printf("ok %zu %zu\n", bundle.fileCount(), bundle.totalBytes());
    return 0;
  }

  if (command == "list") {
    for (size_t i = 0; i < bundle.fileCount(); i++) {
      std::printf("%zu\t%s\n", bundle.sizeAt(i), bundle.pathAt(i));
    }
    return 0;
  }

  if (command == "unpack") {
    if (argc < 5) return usage();
    const std::string outDir = argv[4];
    if (!makeDirs(outDir)) {
      std::fprintf(stderr, "建不了目录：%s\n", outDir.c_str());
      return 1;
    }
    for (size_t i = 0; i < bundle.fileCount(); i++) {
      const char* relative = bundle.pathAt(i);
      if (relative == nullptr) continue;
      size_t len = 0;
      const uint8_t* body = bundle.get(relative, &len);
      if (body == nullptr) return 1;

      const std::string full = outDir + "/" + relative;
      const size_t slash = full.find_last_of('/');
      if (slash != std::string::npos && !makeDirs(full.substr(0, slash))) return 1;
      if (!writeFile(full, body, len)) {
        std::fprintf(stderr, "写不了：%s\n", full.c_str());
        return 1;
      }
    }
    std::printf("ok %zu\n", bundle.fileCount());
    return 0;
  }

  if (command == "read") {
    if (argc < 5) return usage();
    size_t len = 0;
    const uint8_t* body = bundle.get(argv[4], &len);
    if (body == nullptr) {
      std::fprintf(stderr, "包里没有：%s\n", argv[4]);
      return 1;
    }
    if (len > 0 && std::fwrite(body, 1, len, stdout) != len) return 1;
    return 0;
  }

  return usage();
}
