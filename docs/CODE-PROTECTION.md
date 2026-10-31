# 代码与内容保护

> 一页读完：现在怎么保护、各端怎么落地、能挡住什么、还差什么。
> 最后更新：2026-10-31（Android 解密下沉到 native）

## 1. 一句话

**整个游戏打成一个加密包，壳里用「安装包实际签名」派生的钥匙解开，只放在内存里；
Android 上这一步在 native 里做，Java 侧拿不到整包明文。**
改包重签 → 派生出的钥匙打不开 → 游戏起不来。

## 2. 现在的架构

```
npm run build:web    → web/dist（数据编在包内，约 4.4 MB）
npm run pack         → build/rt/libmcrt.so（gzip 后整段 AES-256-GCM，1.3 MB）
npm run native:vault → native/vault/build/android/<abi>/libminicraft_vault.so（解密器）
                       ↓
Android：Java 读 asset + 取签名摘要 → native 解密 → **明文只留 native 堆**
                       ↓
WebView 加载 http://localhost/index.html，每个请求 nativeRead(path) 取一个文件
```

| 环节 | 位置 |
| --- | --- |
| 打包 | `tools/pack-bundle.ts` |
| 解密核心（C++，无 JNI 依赖） | `native/vault/src/vault.cpp` + `crypto.cpp` |
| 密码学原语 | `native/vault/src/crypto.cpp`（自实现，见 §2.2） |
| Android JNI | `native/vault/src/jni_bridge.cpp` + `BundleVault.java` |
| 读取（桌面/测试） | `desktop/bundle.mjs` |
| iOS | `BundleVault.swift` + `LocalServer.swift`（WKWebView 拦不了 http） |

**磁盘上从来没有明文**：解密结果只存在于进程内存。

### 2.1 Android 的分层（2026-10-31）

| 层 | 做什么 | 不做什么 |
| --- | --- | --- |
| Java `BundleVault` | 读 asset、向 `PackageManager` 要签名摘要、持有句柄 | **不持有明文**，只有 5 个 `native` 声明 |
| `libminicraft_vault.so` | HKDF 派生、解包裹、整段 GCM、gunzip、容器索引、明文缓冲 | 不管签名从哪来（由 Java 传入） |
| Java `shouldInterceptRequest` | 按路径向 native 要一个文件（几 KB ~ 几十 KB） | 看不到其余 24 个文件 |

改造前 Java 侧会拿到 `Map<String, byte[]>`，整包 4~5 MB 明文同时躺在 Java 堆上，
一次内存 dump 就全拿到。现在 dump 需要逐文件抓、按顺序拼。

### 2.2 为什么自己实现密码学

NDK 28 / 29 的 sysroot 里**既没有 `openssl/` 头、也没有 `libcrypto`**（BoringSSL 已从应用可见的 NDK 接口移除）。
host 有 Homebrew OpenSSL，Android 没有——若两端各用一套，"host 测试通过"就不代表设备行为。
所以 `crypto.cpp` 自己实现 SHA-256 / HMAC / HKDF / AES-256-GCM（GCM 只用加密方向，
CTR 解密复用同一 keystream，不需要逆 S-box），两端编同一份源码。

正确性由 `native/vault/test/selftest.cpp` 的标准向量兜底（NIST GCM TC13/14、
RFC 4231、RFC 5869、FIPS 180-4），共 17 条。

### 关键设计

| 决定 | 为什么 |
| --- | --- |
| **整包单段密文**，不逐文件 | 同一把 CEK，破一个文件=破整包；单段语义更强——改任何一处，整包打不开 |
| **先 gzip 再加密** | 密文不可再压；4.4 MB → 1.3 MB，安装包直接省 3 MB |
| **解密在 native，明文不进 Java 堆** | 内存 dump 要逐文件拼；jadx 只看得到 `native` 声明 |
| 命名 `libmcrt.so` + `\x7fELF` 假头 | 让 `unzip` + `file` 的人以为是原生库。⚠️ 放 `assets/` 而**不是** `lib/<abi>/`——那里会被 Android 当原生库、Play 会校验 ELF |
| Android 用 `shouldInterceptRequest` | 能拦任意 URL，不需要起服务，`http://localhost` 还是可信来源 |
| iOS/桌面起 loopback | WKWebView/Electron 拦不了 http(s)，只能在回环上起服务；端口固定，换端口=换 origin=清档 |
| 去掉 Capacitor | 它自装 WebViewClient 且无 getter，提供不了"解密后再给 WebView"这一层 |
| `.so` 静态链接 libc++ | 否则 APK 要多带一份 `libc++_shared.so`，且版本冲突会崩（实测依赖只有 libz/libc/libm/libdl/liblog） |

## 3. 三端的强度不一样

| 平台 | 钥匙从哪来 | 解密在哪 | 强度 |
| --- | --- | --- | --- |
| **Android** | `PackageManager` 取**实际签名** | **native（C++）** | 强：改签包派生的 KEK 打不开任何包裹，**删掉解密代码也没用**；且明文不进 Java 堆 |
| 桌面 | 构建期写死的摘要 | JS（`desktop/bundle.mjs`） | 中：摘要与盐都在壳里，读懂就能离线解 |
| iOS | 同上（`signers.json`） | Swift | 中偏弱：**iOS 没有读自身签名的公开 API**（`SecCodeCopySelf` 是 macOS 的） |

## 4. 发布流程

```bash
npm run build:web          # 全量产物（数据编在包内）
npm run pack               # 打包成 build/rt/libmcrt.so（读 release.config.json 的签名白名单）
npm run native:vault       # 编 libminicraft_vault.so（arm64-v8a + armeabi-v7a，需 NDK）

npm run build:android      # 上面三步 + gradle assembleDebug
npm run release:android    # 正式包（MINICRAFT_RELEASE=1，只封配置里的证书）
npm run build:ios / build:mac / build:win   # 其余三端，见 docs/BUILD-GUIDE.md
```

`release.config.json` 的 `signingCertSha256` 填 **Play App Signing 的应用签名证书**（不是 upload key）。
留空时 `pack` 只封本机 debug keystore 的摘要——本地能跑，正式包解不开，`release:android` 会报错。

## 5. 验证

```bash
npm run test:pack      # 17 条：包形态 + 往返 + 换签名/改字节/改头/截断（走 desktop/bundle.mjs）
npm run test:vault     # 15 条：标准向量 + host 端到端（与 web/dist 逐字节）+ 多签名 + 负面
npm run check          # 全量门禁
```

`test:vault` 会先编 host 版再解真实包，**不需要设备**；环境缺 clang/zlib 时优雅跳过。
它盯的是最容易翻车的地方——三份解密实现（`desktop/bundle.mjs` / `BundleVault.java` /
`native/vault`）漂移，症状是"电脑上正常、手机上白屏"。

实测过的：

- **host**：`vault-cli unpack` 解出 25 个文件，与 `web/dist` **逐字节一致**；1.3 MB 包 0.06s
- **多签名**：`signers[0]`（正式）与 `signers[1]`（debug）都能打开同一个包
- **Android 构建**：`assembleDebug` 通过，APK 内含 `lib/<abi>/libminicraft_vault.so`，
  5 个 JNI 符号导出正确，动态依赖无 `libc++_shared`
- **桌面**：`title=Minicraft 按钮=93 包内=27 文件 / 4573455B`（菜单渲染）
- **Android**（Pixel_3a API34，`-gpu host`）：横屏全屏、进世界渲染、`touch-mode=true`、
  宿主桥可用、`startServer()` → 8887
- **iOS**（iPhone 16 模拟器）：主菜单正常渲染、无 Safari 安装提示

- **Android 真机**（Pixel 2 XL / arm64-v8a）：把同一份源码编成 arm64 可执行后推到
  `/data/local/tmp` 跑——标准向量 **17 条全过**（说明自实现的 AES/SHA 在 ARM 上没有
  字节序或对齐问题）；真实包解出 25 个文件，`index.html` 的 SHA-256 与 host `web/dist`
  **逐字节相同**；正式与 debug 两份签名都能开，错误签名正确拒绝。临时文件已清理。

**没验过**：**装 APK 后 WebView 实际加载**（覆盖安装会动到已安装应用与存档，留给用户确认）；
iOS 横屏下画面右侧疑似有黑边；Windows 从没在真机跑过。

## 6. 能挡住什么

| 攻击 | 结果 |
| --- | --- |
| `unzip` 后直接看内容 | ❌ 只有密文 |
| 改包（改数值/去广告）后重签运行 | ❌ 钥匙对不上，数据打不开 |
| 改一个字节 | ❌ 整包 GCM 校验失败 |
| 解包后把游戏搬去别的站点 | ❌ 没有钥匙 |
| jadx 反编译看解密逻辑 | ❌ 只能看到 5 个 `native` 声明（Java 侧无算法） |
| **改 `installedSignerDigest` 硬编码公开指纹** | ⚠️ **可以**——指纹是公开信息，改一行就绕过了"入口" |
| **读懂格式后离线实现解密** | ⚠️ **可以**——证书摘要是公开信息，盐和密文都在包里 |
| 正版运行时 dump 内存 | ⚠️ 可以（root/frida）；但已不是"一次 dump 拿全量"，要逐文件拼 |

**核心边界**：纯客户端没有后台，钥匙一定能被算出来。这里挡住的是"工具化改包"和"整包搬走"，
**不是"愿意读代码的专业逆向"**。native 化把"改一行"变成"读汇编或离线重实现"，抬高的是成本，
不是可能性——因为指纹这个"唯一的秘密"本来就是公开的。

想再上一档只有两条路：后端授权（密钥由服务器下发），或商业加固壳。

## 7. 还没做

| 项 | 说明 |
| --- | --- |
| APK 真机跑通 | native 库已在设备 arm64 上验证（标准向量 + 真实包逐字节一致），但"装 APK 后 WebView 加载"还需覆盖安装一次——会动到已安装的 debug 包 |
| 指纹不在 native 自校验 | 仍由 Java 传入（见 §6"硬编码指纹"）——在 native 自读 APK 证书只增加 400 行与回归风险，不解决"改代码"这个根本问题 |
| iOS / 桌面接入 native | `native/vault/src/vault.h` 是纯 C++、无 JNI 依赖，可直接复用；本批只接 Android |
| 字符串加密 | R8 已开 `minifyEnabled true`，但 `"AES/GCM/NoPadding"` 等字面量仍在 dex 里，搜到即可定位；Java 侧现在没这些字符串了，收益主要在其它模块 |
| 仓库里的正式指纹 | `release.config.json` 提交了正式证书摘要（`036df64c…`）。它是公开信息，但"贴在门上"没有好处，建议挪到 CI secret |
| 各端正式签名 | 缺 Play 应用签名证书 / Apple Developer / Authenticode |
