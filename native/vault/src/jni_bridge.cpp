// JNI 胶水（只在 Android 上编）。
//
// ## 为什么明文只放在这里
//
// 目标是让 **Java 堆上永远不存在整包明文**。所以接口刻意做成"打开一次、按路径取单文件"，
// 而不是"打开返回一个 Map"：
//
//   Java: nativeOpen(byte[] pkg, String signerHex) -> boolean
//   Java: nativeRead(String path)                  -> byte[]
//   Java: nativeCount()                            -> int
//   Java: nativeClose()                            -> void
//
// 一次 `shouldInterceptRequest` 只把当前请求的那个文件（几 KB ~ 几十 KB）拷到 Java 堆，
// 内存 dump 想拿到全量内容得逐文件抓、并按顺序拼。
//
// ## 关于加锁
//
// `shouldInterceptRequest` 在 WebView 的 IO 线程上调用，浏览器会并发拉多个资源
// （index.html 之后同时拉 js / css / 贴图），所以读路径必须线程安全。
// 这里用一把全局 mutex 串行化：单文件拷贝只有几微秒，不值得为它做无锁结构。
//
// ⚠️ `nativeRead` 返回的数组是**副本**，调用方随便改；内部缓冲不受影响。

#include <jni.h>

#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "crypto.h"
#include "vault.h"

namespace {

std::mutex gMutex;
std::unique_ptr<vault::Bundle> gBundle;

std::string toUtf8(JNIEnv* env, jstring text) {
  if (text == nullptr) return {};
  const char* chars = env->GetStringUTFChars(text, nullptr);
  if (chars == nullptr) return {};
  std::string out(chars);
  env->ReleaseStringUTFChars(text, chars);
  return out;
}

}  // namespace

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_minicraft_app_BundleVault_nativeOpen(JNIEnv* env, jclass, jbyteArray pkg,
                                              jstring signerHex) {
  if (pkg == nullptr || signerHex == nullptr) return JNI_FALSE;

  const jsize len = env->GetArrayLength(pkg);
  if (len <= 0) return JNI_FALSE;

  // 注意：`vector<uint8_t> bytes(size_t(len))` 会被解析成**函数声明**（most vexing parse），
  // 所以先单独算长度再构造。
  const size_t byteLen = size_t(len);
  std::vector<uint8_t> bytes(byteLen);
  env->GetByteArrayRegion(pkg, 0, len, reinterpret_cast<jbyte*>(bytes.data()));
  if (env->ExceptionCheck()) return JNI_FALSE;  // ArrayIndexOutOfBounds / OOM

  const std::string signer = toUtf8(env, signerHex);

  auto bundle = std::make_unique<vault::Bundle>();
  const bool ok = bundle->open(bytes.data(), bytes.size(), signer.c_str());
  // 包本身是密文，清不清都无所谓；但"用完即擦"是这个模块的纪律，成本是 1 ms 级
  vault::secure_zero(bytes.data(), bytes.size());
  if (!ok) return JNI_FALSE;

  std::lock_guard<std::mutex> lock(gMutex);
  gBundle = std::move(bundle);
  return JNI_TRUE;
}

JNIEXPORT jbyteArray JNICALL
Java_com_minicraft_app_BundleVault_nativeRead(JNIEnv* env, jclass, jstring path) {
  if (path == nullptr) return nullptr;
  const std::string name = toUtf8(env, path);

  std::lock_guard<std::mutex> lock(gMutex);
  if (gBundle == nullptr) return nullptr;

  size_t len = 0;
  const uint8_t* body = gBundle->get(name.c_str(), &len);
  if (body == nullptr) return nullptr;  // 没有这个文件 → Java 侧按 404 处理

  jbyteArray out = env->NewByteArray(jsize(len));
  if (out == nullptr) return nullptr;  // OOM：让 Java 抛，别在这里吞掉
  if (len > 0) {
    env->SetByteArrayRegion(out, 0, jsize(len), reinterpret_cast<const jbyte*>(body));
  }
  return out;
}

JNIEXPORT jint JNICALL
Java_com_minicraft_app_BundleVault_nativeCount(JNIEnv*, jclass) {
  std::lock_guard<std::mutex> lock(gMutex);
  return gBundle == nullptr ? 0 : jint(gBundle->fileCount());
}

JNIEXPORT void JNICALL
Java_com_minicraft_app_BundleVault_nativeClose(JNIEnv*, jclass) {
  std::lock_guard<std::mutex> lock(gMutex);
  if (gBundle != nullptr) {
    gBundle->close();  // 先清零明文
    gBundle.reset();
  }
}

/** 解出来的明文字节总数：只用于日志与"包是不是空的"判断，不参与任何校验。 */
JNIEXPORT jlong JNICALL
Java_com_minicraft_app_BundleVault_nativeTotalBytes(JNIEnv*, jclass) {
  std::lock_guard<std::mutex> lock(gMutex);
  return gBundle == nullptr ? 0 : jlong(gBundle->totalBytes());
}

}  // extern "C"
