# iOS 壳

与 [`android/`](../android/README.md) **对等**：消费 `web/dist`，在原生侧完成
「验身份 → 解封核心数据 → 交给 WebView」。

## 出包

```bash
npm run ios:sync     # gen:sealed → build:app → cap sync ios
open ios/App/App.xcworkspace
```

> 需要 CocoaPods（`pod --version`）。本机目前**没有装**，所以 iOS 侧只做到
> "工程结构 + 源码通过 `swiftc -typecheck`"，运行时行为还没在设备上验过。

## 文件

| 文件 | 作用 |
| --- | --- |
| `App/App/CoreVault.swift` | 解封：验身份 → HKDF 派生 KEK → AES-GCM 解 CEK → 解载荷 → 逆形态变换 |
| `App/App/CoreVaultPlugin.swift` | Capacitor 插件 `CoreVault.read()`，base64 交给网页 |
| `App/App/MinicraftViewController.swift` | 把插件注册进桥（`capacitorDidLoad`） |
| `App/App/sealed/` | 封存产物（gitignore，由 `npm run gen:sealed` 写入） |

`App.xcodeproj` 里已经把 `sealed` 作为**文件夹引用**加进 Copy Bundle Resources，
所以它在包里是 `App.app/sealed/…`——**不在** `public/` 下，WebView 读不到。

## 一个必须说清的限制

**iOS 没有读取自身代码签名身份的公开 API**（`SecCodeCopySelf` 那套是 macOS 的）。
所以 iOS 侧的身份判据只能绑 `bundle id`：

- 挡住：改包名重新打包再分发；
- 挡不住：同一个 bundle id 换证书重签——但那种包只能靠越狱/企业证书安装，
  系统本身已经是第一道防线。

Android 那边是真正的证书摘要比对，两者强度不同，别混为一谈。

## 验收口径

- App Store 包：能进游戏；
- `bundle.txt` 与 `Info.plist` 的 bundle id 不一致：插件 reject，停在落地页；
- 越狱改包：同上（`isSignedByUs()` 失败即无数据）。
