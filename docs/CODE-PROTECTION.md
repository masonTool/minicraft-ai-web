# 代码与内容保护

> 一页读完：现在怎么保护、各端怎么落地、能挡住什么、还差什么。
> 最后更新：2026-10-30

## 1. 一句话

**整个游戏打成一个加密包，壳里用「安装包实际签名」派生的钥匙解开，只放在内存里。**
改包重签 → 派生出的钥匙打不开 → 游戏起不来。

## 2. 现在的架构

```
npm run build:web   → web/dist（数据编在包内，约 4.4 MB）
npm run pack        → build/rt/libmcrt.so（gzip 后整段 AES-256-GCM，1.3 MB）
                       ↓
壳：读包 → 用签名摘要派生 KEK → 开 CEK → 整段解密 → gunzip → 内存文件表
                       ↓
WebView 加载 http://localhost/index.html，每个请求从内存切一份返回
```

| 环节 | 位置 |
| --- | --- |
| 打包 | `tools/pack-bundle.ts` |
| 读取（桌面/测试） | `desktop/bundle.mjs` |
| Android | `BundleVault.java` + `MainActivity.shouldInterceptRequest` |
| iOS | `BundleVault.swift` + `LocalServer.swift`（WKWebView 拦不了 http） |

**磁盘上从来没有明文**：解密结果只存在于进程内存。

### 关键设计

| 决定 | 为什么 |
| --- | --- |
| **整包单段密文**，不逐文件 | 同一把 CEK，破一个文件=破整包；单段语义更强——改任何一处，整包打不开 |
| **先 gzip 再加密** | 密文不可再压；4.4 MB → 1.3 MB，安装包直接省 3 MB |
| 命名 `libmcrt.so` + `\x7fELF` 假头 | 让 `unzip` + `file` 的人以为是原生库。⚠️ 放 `assets/` 而**不是** `lib/<abi>/`——那里会被 Android 当原生库、Play 会校验 ELF |
| Android 用 `shouldInterceptRequest` | 能拦任意 URL，不需要起服务，`http://localhost` 还是可信来源 |
| iOS/桌面起 loopback | WKWebView/Electron 拦不了 http(s)，只能在回环上起服务；端口固定，换端口=换 origin=清档 |
| 去掉 Capacitor | 它自装 WebViewClient 且无 getter，提供不了"解密后再给 WebView"这一层 |

## 3. 三端的强度不一样

| 平台 | 钥匙从哪来 | 强度 |
| --- | --- | --- |
| **Android** | `PackageManager` 取**实际签名** | **强**：改签包派生的 KEK 打不开任何包裹，**删掉校验代码也没用** |
| 桌面 | 构建期写死的摘要 | 中：摘要与盐都在壳里，读懂壳就能离线解 |
| iOS | 同上（`signers.json`） | 中偏弱：**iOS 没有读自身签名的公开 API**（`SecCodeCopySelf` 是 macOS 的） |

## 4. 发布流程

```bash
npm run build:web          # 全量产物（数据编在包内）
npm run pack               # 打包成 build/rt/libmcrt.so（读 release.config.json 的签名白名单）

npm run android:apk        # 上面两步 + gradle assembleDebug
npm run android:aab        # 正式包（MINICRAFT_RELEASE=1，只封配置里的证书）
npm run mac:dist / win:dist / ios 走各自工程
```

`release.config.json` 的 `signingCertSha256` 填 **Play App Signing 的应用签名证书**（不是 upload key）。
留空时 `pack` 只封本机 debug keystore 的摘要——本地能跑，正式包解不开，`android:aab` 会报错。

## 5. 验证

```bash
npm run test:pack     # 17 条：往返 + 换签名/改字节/改头/截断/空包
npm run check         # 全量门禁
```

实测过的：

- **桌面**：`title=Minicraft 按钮=93 包内=27 文件 / 4573455B`（菜单渲染）
- **Android**（Pixel_3a API34，`-gpu host`）：横屏全屏、进世界渲染、`touch-mode=true`、
  宿主桥可用、`startServer()` → 8887
- **iOS**（iPhone 16 模拟器）：主菜单正常渲染、无 Safari 安装提示

**没验过**：iOS 横屏下画面右侧疑似有黑边（模拟器截图如此），需真机复核；Windows 从没在真机跑过。

## 6. 能挡住什么

| 攻击 | 结果 |
| --- | --- |
| `unzip` 后直接看内容 | ❌ 只有密文 |
| 改包重签后运行 | ❌ 钥匙对不上，数据打不开 |
| 改一个字节 | ❌ 整包 GCM 校验失败 |
| 解包后把游戏搬去别的站点 | ❌ 没有钥匙 |
| **读懂格式后离线实现解密** | ⚠️ **可以**——证书摘要是公开信息，盐和密文都在包里 |
| 正版运行时 dump 内存 | ⚠️ 可以，root/frida 挡不住 |

**核心边界**：纯客户端没有后台，钥匙一定能被算出来。这里挡住的是"工具化改包"和"整包搬走"，
不是"愿意读代码的专业逆向"。想再上一档只有两条路：后端授权，或商业加固壳。

## 7. 还没做

| 项 | 说明 |
| --- | --- |
| iOS 真机验证 | 模拟器上画面疑似未铺满 |
| Windows 真机验证 | 只能在 macOS 上出包 |
| 各端正式签名 | 缺 Play 应用签名证书 / Apple Developer / Authenticode |
| R8 / 混淆 | release 仍 `minifyEnabled false`（换新壳后可重新评估） |
