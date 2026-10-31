# 构建与分发指南

> **一句话**：开发版一条命令就能出；正式版只需要配四样东西（每个平台一样），配完就不用再管。
> 本文以**当前 `package.json` 里真实存在的命令**为准。各端 README 里有几条失效命令，见 §6。
> 最后核对：2026-10-31。

## 0. 我要干什么 → 跑哪条

| 我想… | 命令 | 产物 |
| --- | --- | --- |
| 本地改代码看效果 | `npm run dev` | http://localhost:5173 |
| 出一版给浏览器玩 | `npm run build:web` | `web/dist/` |
| **装到自己手机上玩** | `npm run android:apk` | `android/app/build/outputs/apk/debug/app-debug.apk` |
| **发给别人手机装** | 同上，然后把那个 apk 发过去 | 同上 |
| 上架 Google Play | `npm run android:aab` | `android/app/build/outputs/bundle/release/app-release.aab` |
| 上 iPhone | Xcode 打开 `ios/App/App.xcodeproj` | 见 §3.2 |
| 出 Mac / Windows 安装包 | 见 §3.3（**当前仓库缺依赖，需先装**） | — |
| 发布网页版 | 见 §3.5 | Cloudflare Pages |

## 1. 开发版 vs 正式版：唯一区别

**不是"两个不同的游戏"，是同一份代码 + 两种签名。**

| | 开发版（debug） | 正式版（release） |
| --- | --- | --- |
| 谁签名 | 本机自动生成的 `~/.android/debug.keystore` | 你的上传密钥（AAB）/ 你自签的密钥（APK） |
| 能装到别人手机吗 | **能**（同机可覆盖安装，别人手机需允许"未知来源"） | 能（自己分发 APK 时）；AAB **不能直接装**，见 §4 |
| 加密包里封了谁的指纹 | debug + 正式（两份都封） | **只封正式的**（防后门） |
| 怎么触发 | `npm run android:apk` | `MINICRAFT_RELEASE=1`（`android:aab` 已自带） |

> ⚠️ **`MINICRAFT_RELEASE=1` 不是可选项**。不加它，`pack` 会把本机 debug 证书的摘要也封进包里——
> 等于给"拿到你开发机 keystore 的人"留了一把钥匙。正式发布必须走 `npm run android:aab`。

## 2. 一次性配置：按平台看这一张表

配完就永久生效，以后只需要跑命令。

| 平台 | 要配的东西 | 配在哪 | 什么时候必须配 |
| --- | --- | --- | --- |
| **Android 开发版** | 什么都不用配 | — | — |
| **Android 正式版** | ① 上传密钥文件 + 3 个口令 | 环境变量 `MINICRAFT_KEYSTORE` / `_PASSWORD` / `_KEY_ALIAS` / `_KEY_PASSWORD` | 出 AAB 前 |
| | ② **正式证书的 SHA-256** | `release.config.json` → `signingCertSha256` | 出 AAB 前 |
| **iOS** | Apple 开发团队（Team）+ 证书 | Xcode → Signing & Capabilities | 装真机 / 上传 App Store 前 |
| **macOS** | ① 代码签名证书 p12 ② Team ID | `CSC_LINK` + `CSC_KEY_PASSWORD`；Team ID 填 `release.config.json` → `macTeamId` | 对外分发前 |
| **Windows** | ① 代码签名 pfx ② 证书指纹 | `CSC_LINK` + `CSC_KEY_PASSWORD`；指纹填 `release.config.json` → `winCertThumbprint` | 对外分发前 |
| **Web** | Cloudflare Pages 项目 + token | GitHub Actions secrets | 首次发布 |

### 2.1 Android 正式证书指纹：你到底该填哪个？

**这是最容易填错的一项。分两种情况：**

**情况 A：走 Google Play（推荐）**

Play 会替你保管"应用签名证书"（玩家装到的那个包的签名），和你上传用的 upload key **不是同一张证书**。

1. 生成 upload key（只做一次）：

```bash
keytool -genkeypair -v -keystore ~/.keys/minicraft-upload.jks \
  -alias minicraft -keyalg RSA -keysize 2048 -validity 10000
```

2. 把四个环境变量写进 `~/.zshrc`（或 CI secret）：

```bash
export MINICRAFT_KEYSTORE="$HOME/.keys/minicraft-upload.jks"
export MINICRAFT_KEYSTORE_PASSWORD='你的口令'
export MINICRAFT_KEY_ALIAS='minicraft'
export MINICRAFT_KEY_PASSWORD='你的口令'
```

3. 第一次上传 AAB 后，进 **Play Console → 应用完整性 → 应用签名**，复制证书的 **SHA-256**。
4. 填进 `release.config.json`：

```json
{ "signingCertSha256": ["AB:CD:...（去掉冒号后的小写 64 位十六进制也可以）"] }
```

**情况 B：自己分发 APK，不上 Play**

那就填**你自己那张密钥**的摘要：

```bash
keytool -list -v -keystore ~/.keys/minicraft-upload.jks -alias minicraft | grep SHA256
```

> 填错的后果：包能编出来，但装到手机上开机会提示「游戏内容校验失败」。
> 因为解密的钥匙是从**实际安装签名**派生的，对不上就打不开——这是设计如此，不是 bug。

### 2.2 macOS / Windows 的 Team ID 与证书指纹

| 平台 | 怎么拿到值 |
| --- | --- |
| macOS Team ID | `codesign -dv --verbose=4 Minicraft.app` 里的 `TeamIdentifier=XXXX` |
| Windows 指纹 | PowerShell：`(Get-AuthenticodeSignature 'Minicraft.exe').SignerCertificate.Thumbprint` |

**不填的判定规则（两端一致）**：

| 配置 | 签名 | 结果 |
| --- | --- | --- |
| 没填 | 没签（本地自用） | ✅ 能开 |
| 没填 | 有别人的签名 | ❌ 拒绝（等于改包重签） |
| 填了 | 没签 | ❌ 拒绝（正式包被剥了签名） |
| 填了 | 一致 | ✅ 正常 |

拒绝的表现是**拿不到核心数据**（停在"请去应用里玩"），不是弹窗报错。

## 3. 各平台怎么编

### 3.1 Android

```bash
# 开发版 → APK（约 2~3 分钟）
npm run android:apk
# 内部串了：build:web → pack → native:vault → gradle assembleDebug

# 正式版 → AAB
npm run android:aab
```

产物：

| 版本 | 路径 |
| --- | --- |
| 开发 APK | `android/app/build/outputs/apk/debug/app-debug.apk` |
| 正式 AAB | `android/app/build/outputs/bundle/release/app-release.aab` |

**前置环境**（第一次跑才需要）：

- Android SDK（`android/local.properties` 里的 `sdk.dir` 或 `ANDROID_HOME`）
- **NDK**（`native/vault` 与 `server/rust` 都要它。脚本会自己找 `$ANDROID_HOME/ndk` 下最新版）
- JDK：实测 **JDK 21 可用**（Gradle 8.2.1 + AGP 8.2.1）。若报
  `Unsupported class file major version`，切回 17：`export JAVA_HOME=$(/usr/libexec/java_home -v 17)`
- Rust 服务端的 `.so`：`bash server/rust/build-android.sh`（**只需在 Rust 改动后跑**）

### 3.2 iOS

**没有命令行出包脚本，全靠 Xcode。** 步骤：

1. 生成加密包（`pack` 会把 `libmcrt.so` 和 `signers.json` 写到 `build/rt/`）：

```bash
npm run build:web && npm run pack
```

2. 把 `build/rt/libmcrt.so` 和 `build/rt/signers.json` 拖进 Xcode（**Copy Bundle Resources**）。
   `BundleVault.swift` 是按 `Bundle.main` 里的 `libmcrt.so` / `signers.json` 找的。
3. Xcode → 选中 target → **Signing & Capabilities** → Team 选你的 Apple 开发团队。
4. 开发版：选模拟器或真机，直接 Run。
5. 正式版：Product → **Archive** → 上传 App Store Connect。

> iOS 的结构性短板：**没有公开 API 读自己的签名**，所以只能用 `signers.json` 里写死的公开摘要。
> 这条防线实际由"系统签名 + App Store 审核"承担，客户端补不了。

### 3.3 macOS / Windows（Electron）

> ⚠️ **当前仓库跑不起来**：`electron` 与 `electron-builder` 未安装，`mac:dist` / `win:dist`
> 这两个 npm 脚本也已经不存在（`mac/README.md`、`windows/README.md` 里写的命令已失效）。
> 下面是按 `electron-builder.yml` 还原出来的手动路径，**本批没有实际验证过**。

```bash
# 一次性：装依赖（在仓库根）
npm i -D electron electron-builder

# 先出加密包（两个平台的 extraResources 都从 build/rt 取）
npm run build:web && npm run pack

# macOS
npx electron-builder -c mac/electron-builder.yml --mac
# → dist/mac/Minicraft-0.1.0-arm64.dmg 等

# Windows（要在 Windows 机器或 Windows CI 上跑，macOS 上出 NSIS 需要 wine）
npx electron-builder -c windows/electron-builder.yml --win
# → dist/windows/Minicraft Setup 0.1.0.exe
```

签名时先设 `CSC_LINK` / `CSC_KEY_PASSWORD` 再跑同一条命令。

### 3.4 Web

```bash
npm run build:web      # → web/dist/
```

发布流程见 [`DEPLOY-CLOUDFLARE.md`](./DEPLOY-CLOUDFLARE.md)。
注意该文档顶部已声明：**"只出前端产物"现在只剩一条线**，文中所有 `build:app` / A 站的内容都已下线。

## 4. 产物怎么给别人

| 产物 | 怎么给 | 说明 |
| --- | --- | --- |
| **开发 APK** | 直接把这个文件发给对方（微信/网盘/数据线都行） | 对方需允许"未知来源安装" |
| | 或 `adb install -r app-debug.apk` | `-r` = 覆盖安装，**同签名不丢存档** |
| **正式 AAB** | **不能直接装！** 上传 Play，用"内部测试"发给测试员 | AAB 是上架格式，不是安装格式 |
| | 要装成 APK：`bundletool build-apks --bundle=app-release.aab --output=x.apks --mode=universal` 再解出 universal.apk | 需要 [bundletool](https://github.com/google/bundletool) |
| **自己签的正式 APK** | 直接发，或 `adb install -r` | 记得 §2.1 情况 B |
| **dmg / exe** | 直接发 | 未签名/未公证的包，macOS 首次要右键「打开」 |
| **web/dist** | 整目录上传到任意静态托管 | 自足形态，浏览器直接能玩 |

**装到别的手机前要确认架构**：只打了 `arm64-v8a` 和 `armeabi-v7a`（无 x86_64）。
现在市面上的手机基本都是 arm64，没问题；**Android 模拟器**如果跑 x86_64 镜像则装不上。

## 5. 我改完代码后，最少要跑什么

| 改动 | 最少验证 |
| --- | --- |
| 只改 `web/src` | `npm run check:fast` |
| 改加密/打包（`tools/pack-bundle.ts`、`native/vault`） | `npm run test:pack && npm run test:vault` |
| 提交前 | `npm run check`（约 40s，含 182 套离线测试） |
| 出包前 | 至少装一次 `android:apk` 到真机 |

## 6. 已知失效的文档（别照着做）

这些是核查时发现的漂移，已在此记录，**不要按它们操作**：

| 文档 | 失效内容 | 现在该用什么 |
| --- | --- | --- |
| `android/README.md` | `npm run android:sync`、`gen:sealed`、`build:app`、JDK 17 必需、x86_64、`release.config.json 故意是空的` | `npm run android:apk` / `android:aab`；JDK 21 实测可用；只打两个 ARM ABI |
| `mac/README.md` | `npm run mac:dist`、`npm run gen:sealed` | 不存在，见 §3.3 |
| `windows/README.md` | `npm run win:dist` | 不存在，见 §3.3 |
| `ios/README.md` | 空文件 | 见 §3.2 |
| `docs/CODE-PROTECTION.md` | `npm run mac:dist / win:dist` | 同上 |
| `release.config.json` | `saltHex` 字段**已无任何引用**（`pack` 用随机 salt） | 忽略它，改了也不会生效 |
| `ios/App/App/public/` | 有明文 `index.html`（旧 Capistrano/Capacitor 同步残留） | 确认它没被打进包；iOS 应走 `libmcrt.so` + `signers.json` |

## 7. 三个最常踩的坑

1. **AAB 装不上手机** —— 它就不是安装格式。走 Play 内部测试或 bundletool。
2. **正式包开起来提示「内容校验失败」** —— `signingCertSha256` 填的不是**实际安装那个包的**签名证书。走 Play 时是「应用签名证书」，不是 upload key。
3. **忘了 `MINICRAFT_RELEASE=1`** —— 包里会多封一份 debug 摘要。只用 `npm run android:aab` 就不会漏。
