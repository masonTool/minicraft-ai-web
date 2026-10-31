# iOS 版

WKWebView 跑游戏 + 本地回环服务（WKWebView 拦不了 `http`，只能起 loopback）；联机服务端用同一份 Rust 静态库。

## 出包

见 [`docs/BUILD-GUIDE.md`](../docs/BUILD-GUIDE.md)。一句话：

```bash
npm run build:ios     # 模拟器版 .app（不需要任何证书）
npm run release:ios   # 真机 Archive（需要 Apple 证书）
```

脚本 `ios/build.sh`，内部调 `xcodebuild`，**不用打开 Xcode**。

## 加密包怎么进 App

`App.xcodeproj` 里有一个名为 **Copy encrypted bundle** 的 Build Phase，每次构建把
`build/rt/libmcrt.so` 与 `build/rt/signers.json` 拷进 App 的 Resources。
所以必须先 `pack`——npm 命令已经串好了。

> ⚠️ 2026-10-31 从工程里移除了 `public/` 的引用。那是 Capacitor 时代的残留目录，里面是**明文**，
> 之前会和加密包一起被打进 App，等于这一端的加密白做。现在 App 里只有密文。

## 已知限制

- iOS **没有公开 API 读自身签名**（`SecCodeCopySelf` 是 macOS 的），所以只能用 `signers.json`
  里写死的公开摘要。这一端的防线实际由系统签名 + App Store 审核承担，客户端补不了。
- 横屏下画面右侧疑似有黑边（模拟器截图如此，需真机复核）。
- 导出 ipa 需要 `ios/ExportOptions.plist`（填你自己的 Team ID，模板见 `ExportOptions.plist.example`）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `build.sh` | 出包脚本（模拟器 / Archive） |
| `App/App/BundleVault.swift` | 整包解密（与 Android/iOS/桌面同一份包格式） |
| `App/App/LocalServer.swift` | 内存文件表 → 回环 HTTP 服务 |
| `App/App/public/` | **Capacitor 残留，不进包**，可忽略 |
