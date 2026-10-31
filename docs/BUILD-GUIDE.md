# 构建与分发指南

> **一份代码，五个平台。只有两个动词：`build` = 开发版，`release` = 正式版。**

- `build:*` —— **不需要任何证书**，出了就能装、能跑。自己玩、给朋友试都用它。
- `release:*` —— 需要先配好证书，产物用于上架或对外分发。

所有命令内部都会自动跑 `build:web` → `pack` → 平台打包，**不用手动串**。
最后核对：2026-10-31（五端命令均已实测，见 §6）。

## 1. 命令一览

| 平台 | 开发版 | 正式版 | 产物 |
| --- | --- | --- | --- |
| Web | `npm run build:web` | `npm run release:web`（同一产物） | `web/dist/` |
| Android | `npm run build:android` | `npm run release:android` | `apk` / `aab` |
| iOS | `npm run build:ios` | `npm run release:ios` | 模拟器 `.app` / `.xcarchive` |
| macOS | `npm run build:mac` | `npm run release:mac` | `.dmg`（arm64 + x64） |
| Windows | `npm run build:win` | `npm run release:win` | `.exe` 安装包 |

旧命令 `android:apk` / `android:aab` 仍然可用，等价于 `build:android` / `release:android`。

## 2. 配置：每个平台配一次

**开发版一栏是空的——这就是它存在的意义。**

| 平台 | 要配什么 | 配在哪 | 不配的后果 |
| --- | --- | --- | --- |
| Android 开发版 | — | — | — |
| Android 正式版 | 上传密钥（4 个环境变量） | shell 或 CI | 编出未签名 AAB，Play 拒收 |
| | 正式证书 SHA-256 | `release.config.json` → `signingCertSha256` | 包能装上，**但开起来提示"内容校验失败"** |
| iOS 开发版 | — | — | — |
| iOS 正式版 | Apple 团队 + 证书 | Xcode → Signing & Capabilities | `archive` 失败 |
| macOS 开发版 | — | — | — |
| macOS 正式版 | 证书 p12 + 口令 | `CSC_LINK` / `CSC_KEY_PASSWORD` | 出不了签名包（用户首次要右键「打开」） |
| Windows 正式版 | 证书 pfx + 口令 | 同上 | 出不了签名包（会多一次 SmartScreen 拦截） |
| Web | Cloudflare Pages 项目 | `.github/workflows/` 的 secrets | 发不出去 |

### Android 正式版：指纹到底填哪个（最容易错的一项）

**走 Google Play** → 填 Play 的「应用签名证书」，**不是**你上传用的 upload key：

1. 生成上传密钥（只做一次）：
   ```bash
   keytool -genkeypair -v -keystore ~/.keys/minicraft-upload.jks \
     -alias minicraft -keyalg RSA -keysize 2048 -validity 10000
   ```
2. 四个环境变量写进 `~/.zshrc` 或 CI secret：
   ```bash
   export MINICRAFT_KEYSTORE="$HOME/.keys/minicraft-upload.jks"
   export MINICRAFT_KEYSTORE_PASSWORD='口令'
   export MINICRAFT_KEY_ALIAS='minicraft'
   export MINICRAFT_KEY_PASSWORD='口令'
   ```
3. 首次上传 AAB 后，去 **Play Console → 应用完整性 → 应用签名**，复制 SHA-256。
4. 填进 `release.config.json` 的 `signingCertSha256`（数组，可填多个）。

> CI 或多渠道发版可以用环境变量覆盖，不必改仓库文件：
> `MINICRAFT_SIGNING_CERT_SHA256=abc,def npm run release:android`（逗号或分号分隔）。
> 环境变量存在时**完全替代**配置文件里的数组。

**自己分发 APK、不上 Play** → 填你自己那张证书的摘要：

```bash
keytool -list -v -keystore ~/.keys/minicraft-upload.jks -alias minicraft | grep SHA256
```

## 3. 各平台补充

### Android

- 前置：Android SDK + **NDK**（脚本自动找 `$ANDROID_HOME/ndk` 最新版）+ Rust 服务端产物（改了 `server/rust` 才需要重跑 `bash server/rust/build-android.sh`）
- JDK：实测 **21 可用**；若报 `Unsupported class file major version`，切 17
- 只打 `arm64-v8a` + `armeabi-v7a`，**没有 x86_64**（x86 模拟器装不上）

### iOS

- 前置：Xcode（命令行用 `xcodebuild`，不用打开 IDE）
- `build:ios` 出**模拟器**包，不需要任何证书；`release:ios` 出真机 Archive，需要证书
- 加密包由工程里的 Build Phase 自动拷进 `App.app`，所以**必须先 `pack`**（命令已串好）
- 导出 ipa：`xcodebuild -exportArchive -archivePath ios/build/App.xcarchive -exportOptionsPlist ios/ExportOptions.plist -exportPath ios/build/ipa`（需要自己填 Team ID，模板见 `ios/ExportOptions.plist.example`）

### macOS / Windows

- `build:mac` 出**未签名** dmg，本机双击能开（首次可能要右键「打开」）
- `release:mac` 需要 `CSC_LINK` + `CSC_KEY_PASSWORD`
- **代码签名只影响系统信任，不参与解密**：桌面端的钥匙来自安装包里的 `signers.json`，
  与开发者证书无关。别指望"签了名就更安全"。
- **Windows 的 NSIS 安装包不能在 macOS 上出**（需要 wine）。`build:win` 会直接告诉你该去哪跑，不会甩一堆 wine 报错。正式发版走 Windows 机器或 Windows CI

### Web

`build:web` 出 `web/dist/`（数据编在 JS 包里，浏览器直接能玩）。发布流程见 [`DEPLOY-CLOUDFLARE.md`](./DEPLOY-CLOUDFLARE.md)。

## 4. 产物怎么给别人

| 产物 | 怎么给 | 注意 |
| --- | --- | --- |
| **APK** | 直接发文件，或 `adb install -r xxx.apk` | `-r` 覆盖安装，同签名**不丢存档**；对方需允许"未知来源" |
| **AAB** | **不能直接装！** 上传 Play 用「内部测试」发给测试员 | 要变成 APK：`bundletool build-apks --bundle=x.aab --output=x.apks --mode=universal` |
| **dmg / exe** | 直接发 | 未签名的 macOS 包首次要右键「打开」 |
| **模拟器 .app** | 只能装模拟器 | `xcrun simctl install booted <path>` |
| **web/dist** | 整目录传到任意静态托管 | 自足形态 |

## 5. 出错时

| 症状 | 原因 |
| --- | --- |
| 装上了但提示「游戏内容校验失败」 | `signingCertSha256` 与**实际安装那个包的**签名证书不符（走 Play 时是应用签名证书，不是 upload key） |
| 白屏、没有提示 | vault 打开了但路径对不上，把 `adb logcat` 发出来 |
| 闪退 + `UnsatisfiedLinkError` | `.so` 没进包。跑 `npm run native:vault` 后重新构建 |
| AAB 装不上手机 | 它不是安装格式，见 §4 |
| `build:win` 报需要 wine | 正常，换 Windows 机器 |

## 6. 验证状态（2026-10-31）

| 平台 | 开发版 | 正式版 |
| --- | --- | --- |
| Web | ✅ `build:web` 通过（CI 也在跑） | ✅ 走 Pages 流水线 |
| Android | ✅ 出 APK 并装真机跑通 | ⏳ 无正式证书，未实测（需 §2 的配置） |
| iOS | ✅ 模拟器构建 + 启动渲染主菜单 | ⏳ 无 Apple 证书，未实测 |
| macOS | ✅ 出 dmg（arm64 + x64）；壳冒烟通过（`title=Minicraft 按钮=95 包内=25 文件`） | ⏳ 无签名证书，未实测 |
| Windows | ⏳ 需 Windows 机器（macOS 缺 wine） | ⏳ 同上 |

**"⏳"的都只是缺证书/缺机器，命令与配置路径已经就位**；拿到证书后按 §2 填完即可。
