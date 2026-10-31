# Android 壳

WebView 跑游戏 + Rust 联机服务端（同一进程）。工程由 Capacitor 生成，但**运行时已经不用 Capacitor**——
整包是加密的，必须"解密后再交给 WebView"，而 Capacitor 6 的 Bridge 自装 `WebViewClient` 且没有 getter。

## 出包

见 [`docs/BUILD-GUIDE.md`](../docs/BUILD-GUIDE.md)。一句话：

```bash
npm run build:android    # 开发版 APK（debug 签名，无需配置）
npm run release:android  # 正式版 AAB（需上传密钥 + 正式指纹，见指南 §2）
```

产物：`app/build/outputs/apk/debug/app-debug.apk`、`app/build/outputs/bundle/release/app-release.aab`

## 这个工程里我们改了什么

| 位置 | 改动 |
| --- | --- |
| `build.gradle` | 去掉 Capacitor 依赖；`copyRustLibs` / `copyPackedBundle` / `copyVaultLib` 三个拷贝任务，**缺产物直接报错**（不编白屏包） |
| `MainActivity.java` | 自研壳：横屏全屏、`shouldInterceptRequest` 从内存取文件、外链一律不跳 |
| `BundleVault.java` | 只有 5 个 `native` 声明；解密与明文都在 `libminicraft_vault.so`，Java 堆上没有整包明文 |
| `assets/rt/libmcrt.so` | 加密包（伪装成 `.so`），构建期从 `build/rt` 拷入 |
| `jniLibs/` | `libminicraft_server.so`（Rust 服务端）+ `libminicraft_vault.so`（解密），**都不进仓库** |

## 约定

- 只打 `arm64-v8a` + `armeabi-v7a`：改 ABI 要同时动 `rustTriples` 与 `ndk.abiFilters`
- `useLegacyPackaging = false`：原生库不释放到磁盘，root 环境里没有可替换的副本
- release 开 R8：解密链路的类名方法名会被打散
- JDK：实测 21 可用；报 `Unsupported class file major version` 就切 17
