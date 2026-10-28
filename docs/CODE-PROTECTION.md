# 代码与内容保护

> 一页读完：现在能做到什么、怎么做的、发布前要做什么、还差什么、挡不住什么。
> 最后更新：2026-10-29

## 1. 一句话结论

**别人改包重签后拿不到核心数据，进不了游戏。**
纯客户端项目做不到"任何修改都不能运行"，这一点在 §7 说明。

## 2. 它是怎么工作的

```
构建期  host/core-baseline.bin（明文 41 KB）
          ↓ npm run gen:sealed
        assets/sealed/core.sealed（AES-256-GCM + 形态变换）

运行期  网页启动
          ↓ Capacitor.Plugins.CoreVault.read()
        CoreVault：验签名 → 派生 KEK → 解 CEK → 解载荷 → 逆变换
          ↓ 成功：返回方块表字节
          ↓ 失败：reject → 网页停在"去应用里玩"（没有"提示后继续"）
```

| 文件 | 职责 |
| --- | --- |
| `tools/seal-core.ts` | 构建期封存，一次写 Android 与 iOS 两份产物 |
| `release.config.json` | 签名白名单 + 盐（**唯一真源**） |
| `android/…/SealedCore.java` | 纯 Java 的字节处理（可被 JVM 直接验证） |
| `android/…/CoreVault.java` | 读 assets + 取安装包签名 + 比对白名单 |
| `ios/App/App/CoreVault.swift` | 同一套步骤的 Swift 版（身份判据是 bundle id） |
| `desktop/core-vault.mjs` | 同一套步骤的 Node 版（Windows 比证书指纹 / macOS 比 Team ID） |
| `desktop/main.mjs` | 桌面端用 `app://` 协议拦截 `__host/core.bin`，与安卓的拦截点等价 |

密钥关系：

```
KEK = HKDF-SHA256(salt, 证书摘要 ‖ salt, info="minicraft/core/v1")
CEK = 每次构建随机 32 字节，被 KEK 用 AES-256-GCM 包住
```

## 2.5 已经打开的加固开关

改包重签挡得住之后，剩下的成本在于"读得懂"。下面这些开关都已经打开并实测：

| 平台 | 开关 | 挡的是什么 | 状态 |
| --- | --- | --- | --- |
| Android | `minifyEnabled` + `shrinkResources`（R8） | 反编译后一眼看懂解封链路 | ✅ 实测 release 4.2 MB（debug 7.4 MB），`unsealCore`/`hkdf` 等名字全部消失 |
| Android | `extractNativeLibs=false` | root 后直接替换磁盘上的 `.so` | ✅ 实测 JNI 仍可用（`startServer()` 后 8887 就绪） |
| Android | `allowBackup=false` | `adb backup` 拖走存档 | ✅ |
| Android | release 关 `setWebContentsDebuggingEnabled` | `chrome://inspect` 内存 dump | ✅ |
| iOS | `STRIP_INSTALLED_PRODUCT` + `DEPLOYMENT_POSTPROCESSING` | 符号表/调试信息随包发布 | ✅ Release 编译通过 |
| iOS | `SWIFT_REFLECTION_METADATA_LEVEL=none` | Swift 反射元数据暴露类型与方法名 | ✅ |
| iOS | `ENABLE_TESTABILITY=NO` | 测试钩子残留 | ✅ |
| iOS | release 关 `webView.isInspectable` | Safari Web Inspector 看 JS 变量 | ✅ |
| 桌面 | 生产构建去掉默认菜单、禁导航/开窗 | DevTools 与外部页面注入 | ✅ |

> **不建议再加的**：反调试 / 反 root / 反 frida。它们只提高动态调试门槛，
> 而本项目已经把判定收敛到"数据能不能解开"；每加一层就要在每次系统大版本上重测误伤。

## 3. 发布前必做

| # | 事项 | 怎么做 |
| --- | --- | --- |
| 1 | 填真实签名身份 | `release.config.json`：Android 填 **Play App Signing 的应用签名证书**（`apksigner verify --print-certs`，不是 upload key）；macOS 填 `macTeamId`（`codesign -dv` 的 `TeamIdentifier`）；Windows 填 `winCertThumbprint`（`Get-AuthenticodeSignature` 的 Thumbprint） |
| 2 | 重新封存 | `npm run gen:sealed` |
| 3 | 出包 | Android `npm run android:sync`；iOS `npm run ios:sync`；macOS `npm run mac:dist`；Windows `npm run win:dist` |

> 白名单留空时会用**全零占位**封存：链路能跑通，但真机一定解不开（故意的 fail-closed），
> 而且 `release:audit` 会直接红。这是防止"占位悄悄发出去"的最后一道闸。

## 4. 怎么验证

```bash
npm run test:sealed        # 格式往返：15 条（含 6 条负面）
bash tools/sealed-check.sh # 用真实 JVM 跑 Android 的解封代码：10 条
npm run test:desktop       # 桌面端解封 + 身份判据四象限：11 条
npm run desktop:smoke      # 真起 Electron（隐藏窗口）验页面与解封链路
npm run build:app          # 发布检查：无明文 / 非 MCTB / 白名单非占位 / 有 salt
npm run check              # 全量门禁
```

已验证过的：

- `assembleDebug` 能出包（7.4 MB），包内只有 `assets/sealed/*`，**没有明文 `core.bin`**；
- JVM 跑真实产物能还原出逐字节相同的明文；
- 换签名 / 换盐 / 改任一字节 / 截断 / 空白名单，全部解不开；
- 桌面端：`MacOS/Minicraft` 冒烟 → `title=Minicraft core=41107B`；dmg（arm64/x64）与
  `Minicraft Setup 0.1.0.exe` 都产出了，`Resources/` 里是 `web` + `sealed` 两张皮；
- iOS：iPhone 16 模拟器实跑，日志 `CoreVault read` 返回的 base64 解码是 `MCTB` + 方块名，
  0 条 error——**解封链路在真实运行时跑通了**；
- Android：模拟器（API 37 / arm64）实跑，页面正常启动、无崩溃；顺带用 CDP 直连 WebView
  验了宿主桥与开房链路（`startServer()` 后 8887 端口就绪）。

**最关键的一条（A/B 实验，2026-10-29）**：同一份 release APK（已开 R8），

| 用哪张证书签 | 结果 |
| --- | --- |
| 证书 A（其摘要写进 `signers.txt`） | **正常进游戏**（主包加载、方块表解开） |
| 证书 B（同一个 APK，只重签） | **停在"Get it on Google Play"落地页**，游戏起不来 |

也就是说"改包重签 → 不能运行"不是设计意图，是**实测行为**。复现方式见
`docs/` 里这段记录的命令（生成两张 keystore → `gen:sealed` 用 A 的摘要 →
`assembleRelease` 用 A 签 → `apksigner` 用 B 重签 → 两个都装一遍）。

R8 也确实在生效：release 的 `classes.dex` 里 `unsealCore` / `hkdf` / `isSignedByUs`
**一个都搜不到**，只剩必须保留的插件名 `CoreVault`（JS 侧要按名字找）。

**没验证过**：

- Windows 产物没在 Windows 上装过（生成是在 macOS 上用 wine 完成的）；
- 三个平台的**正式签名**都没验（没有证书 / 没有 Windows 机器）。

## 5. 还没做

| 项 | 为什么没做 |
| --- | --- |
| `androidScheme` 改 `https` | **会清空存量存档**，属于一次性不可逆决策，要你拍板 |
| Windows 实机验证 | 只能在 macOS 上出包，没有 Windows 机器 |
| 各平台正式签名 | 没有 Apple Developer 证书 / Windows 代码签名证书 |
| Play Integrity | 需要服务端验证才有意义，本项目没有后台 |
| 增量通道 / 存档 HMAC / 联机校验 | 尚未开始 |

## 6. 设计取舍

1. **不做"校验失败弹窗"**：失败只表现为数据拿不到。布尔判断可以被 patch 成 `true`，
   "解不开"不行。
2. **解封放在原生而不是 JS**：JS 里的解码器等于把格式说明书一起送出去。
3. **签名参与密钥派生**：换签名后整条派生链错位。但这只是**提高成本**——
   证书摘要本身是公开信息，不是"只有私钥能算"的秘密。
4. **解封用 Java 不用 Rust**（与初版方案不同）：本机没有 cargo，写出的 Rust 无法编译验证，
   等于交付不可运行的代码。Java 走平台自带 `javax.crypto`，安全性质一致。
5. **走 Capacitor 插件不用 `shouldInterceptRequest`**（与初版方案不同）：
   Capacitor 6 的 Bridge 自装 `WebViewClient` 且没有 getter，外层包一层会拆掉它自己的协议处理。
6. **debug 构建放行签名**：开发机的 debug keystore 不可能进白名单，不加这个旁路本地没法联调。
   `BuildConfig.DEBUG` 在 release 里恒为 false，不是改个常量就能关掉的开关。

## 7. 挡不住什么

- **专业逆向**：动态调试、改掉原生校验、直接复用运行时解出来的数据——纯客户端挡不住，
  只能提高成本。
- **iOS 的同 id 换证书重签**：iOS 没有读取自身签名身份的公开 API（`SecCodeCopySelf` 是 macOS 的），
  只能绑 bundle id。那种包要靠越狱或企业证书才能装，系统本身是第一道防线。
- **复制整个游戏另做一个**：数据能加密，玩法逻辑在客户端，拦不住重写。

所以验收口径是**"改签包进不去"**（可测），不是"任何修改都不能运行"（不可保证）。

## 8. 想更严一点的话

按投入产出排序：

1. `androidScheme` 换 `https` + 关混合内容（要在有真实用户之前做，一次性）；
2. 给**资源**也加清单签名（现在只保护了核心数据，JS 被改后重签虽然进不去，
   但"改 JS 再签自己的证书"这条路本身没有二次校验）；
3. 加 `Play Integrity`（必须先有后端，否则客户端自己验证没有意义）；
4. 商业加固壳（对 AI 逆向有效，但按年授权，与"被抄"的动机不匹配）。

已做且**不建议再加码**的：反调试、反 root、反 frida。它们只提高"动态调试"的门槛，
而本项目已经把判定收敛到"数据能不能解开"，再叠军备竞赛的边际收益趋近于零，
还要在每次 Android/iOS 大版本上重测误伤。
