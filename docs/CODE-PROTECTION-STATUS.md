# 代码与内容保护 · 落地状态

> 方案原文见 [`ANDROID-CODE-PROTECTION.md`](./ANDROID-CODE-PROTECTION.md)。
> 这一份只记**哪些已经落地、哪些还没、以及为什么**——避免把"设计里写过"当成"现在有"。
> 最后更新：2026-10-29（批次 20261029-1600）

## 一句话

**已经做到：改签名重打包的包拿不到核心数据，进不了游戏。**
没有做到、也不打算承诺：专业逆向者改掉原生校验后仍无法运行（纯客户端不存在这种保证）。

## 已落地

| 项 | 位置 | 验证方式 |
| --- | --- | --- |
| 多产品目录（web / android / ios / server / windows / mac） | 仓库根 | `npm run check` |
| 核心数据**不再以明文进 APK** | `tools/seal-core.ts` → `android/app/src/main/assets/sealed/` | `npm run gen:sealed` 后 `unzip` 找不到 `core.bin` |
| AES-256-GCM 封存 + 形态变换（步长与长度互质） | 同上 | `npm run test:sealed`（15 条，含 6 条负面断言） |
| 只认自家签名：`signers.txt` 白名单 + `CoreVault.isSignedByUs()` | `android/.../CoreVault.java` | 改签包 → `read()` reject |
| 签名不符 = 没有数据（fail-closed，无"提示后继续"分支） | `CoreVaultPlugin.java` / `hostCore.ts` | 同上 |
| debug 构建唯一旁路（`BuildConfig.DEBUG`，release 恒 false） | `CoreVault.java` | 代码审查 + release 包实测 |
| 键与签名的绑定：`KEK = HKDF(salt, 证书摘要 ‖ salt)` | `seal-core.ts` / `CoreVault.java` | 换签名 → 换 KEK → 解开失败 |
| Gradle / 发布检查拒绝明文与占位白名单 | `android/app/build.gradle` · `tools/release-check.mjs` | `npm run build:app` |
| iOS 对等实现（Swift，CryptoKit） | `ios/App/CoreVault.swift` | 待 Xcode 工程补齐后实测 |

## 未落地（按优先级）

1. **`release.config.json` 还是空白名单。** 现在 `gen:sealed` 会用全零占位，
   真机一定解不开（这是故意的）；`release:audit` 见到占位会直接红。
   发布前必须填 **Play App Signing 的应用签名证书** SHA-256。
2. **`R8` / 资源压缩**：`android/app/build.gradle` 的 release 仍是 `minifyEnabled false`。
3. **WebView 加固**：`capacitor.config.json` 还是 `androidScheme: http` + 允许混合内容；
   切 `https` 会清空存量存档，必须在有真实用户之前做，属于一次性决策。
4. **iOS Xcode 工程**：`@capacitor/ios` 未安装，`ios/` 目前只有 Swift 源码。
5. **Play Integrity / Anti-tamper**：纯客户端项目没有自己的后端，Play Integrity 的判定
   需要服务端验证才有意义，因此**不作为本方案的防线**；Anti-tamper 是否能启用取决于
   Play Console 的资格，属于额外收益。
6. **增量通道（`core-delta`）、存档 HMAC、联机校验**：见方案 N / S 组，尚未开始。

## 与方案原文的两处偏离

1. **解封在 Java 而不是 Rust。** 原文 R3 要求 Rust 解封。当前构建机没有 `cargo`，
   写出来的 Rust 无法编译验证，等于交付不可运行的代码。Java 侧用平台自带的
   `javax.crypto`（AES/GCM + HmacSHA256）实现，**同样不在 JS 里**，安全性质一致，
   且能用 `tools/sealed-test.ts` 把格式钉死。等 Rust 工具链进 CI 后可平移。
2. **走 Capacitor 插件而不是 `shouldInterceptRequest`。** Capacitor 6 的 `Bridge`
   内部自装 `WebViewClient`，而 `WebView` 没有 getter；外层再包一层就得整块替换，
   会拆掉 Capacitor 自己的协议处理。插件拿到的是同一份字节，省掉的是那处侵入。

## 这套东西的真实强度

- 挡住"改包 / 换图标 / 换签名后重打包"这类工具化攻击：**有效**。
- 挡住专业逆向者动态调试、改掉校验后继续跑：**做不到**，只能提高成本。
- 加密算法本身不可暴破；真正的弱点始终是"解密结果必须在进程里出现"。

所以验收口径是：**改签包进不去**（可测），而不是"任何修改都不能运行"（不可保证）。
