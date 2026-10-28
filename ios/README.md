# iOS 壳

与 [`android/`](../android/README.md) **对等**：消费 `web/dist`，在原生侧完成
「验签名 → 解封核心数据 → 交给 WebView」这一条链。

## 现在有什么

| 文件 | 作用 |
| --- | --- |
| `App/CoreVault.swift` | 解封核心数据：验签名身份 → HKDF 派生 KEK → AES-GCM 解 CEK → 解载荷 → 逆形态变换 |
| `App/CoreVaultPlugin.swift` | Capacitor 插件 `CoreVault.read()`，把解封结果以 base64 交给网页 |

两侧格式与 `tools/seal-core.ts` **逐字节一致**；`tools/sealed-test.ts` 把同一套步骤
在 Node 里跑一遍，格式写错会立刻红。

## 还没有的：Xcode 工程本体

`@capacitor/ios` 未安装，`npx cap add ios` 需要联网装平台包并生成 `.xcodeproj`。
在此之前本目录只有源码，不参与构建。补齐步骤：

```bash
npm i -D @capacitor/ios
npx cap add ios            # 生成 ios/App/App.xcodeproj（会与现有 App/ 源码合并）
npm run gen:sealed         # 产出 ios/App/App/sealed/{core.sealed,salt.bin,signers.txt}
```

生成之后把三份封存产物加进 Xcode 的 **Copy Bundle Resources**（目录结构保持
`sealed/` 不变），`CoreVault.readAsset` 按同样的相对路径取。

## 签名闸门

`CoreVault.isSignedByUs()` 取自身代码签名信息里的 **team identifier**，与
`signers.txt` 里的值逐字比对。这与 Android 的证书摘要不是同一个东西：
Android 比的是证书 SHA-256，iOS 比的是团队标识（对个人开发者够用；
如果以后要求更细，可换成 `kSecCodeInfoUnique` 之类的可执行文件摘要）。

## 验收口径

- App Store 包：能进游戏；
- 改 bundle id 重签：`isSignedByUs()` 为 false → 插件 reject → 停在"请从 App Store 安装"；
- 未签名 / 越狱注入环境：同上（无法证明身份即拒绝）。
