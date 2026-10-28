# 桌面端运行时（Windows / macOS 共用）

一份 Electron 代码，两个平台各自打包：平台差异只在 [`windows/`](../windows/README.md)
与 [`mac/`](../mac/README.md) 的配置和资源里。**不要**为两个平台各复制一份 main.mjs。

## 三个文件

| 文件 | 作用 |
| --- | --- |
| `main.mjs` | 主进程：注册 `app://` 协议、开窗口、拦截核心数据 |
| `core-vault.mjs` | 解封 + 身份校验（纯 Node，可单测） |
| `package.json` | electron-builder 的 app 清单（name/version/main） |

## 关键设计：为什么不用 `file://`

`file://` 是 opaque origin，Chromium 会**直接关掉 IndexedDB**——而本项目的存档全在里面，
表现是"能进游戏但存不了档"，且不报错。

所以注册了一个自有 scheme `app://minicraft/`（standard + secure）。它顺带成了一个和安卓
`shouldInterceptRequest` 完全等价的拦截点：

```
app://minicraft/__host/core.bin  →  解封后的方块表（解不开就 404）
app://minicraft/…                →  web/dist 里的静态文件
```

于是 `web/src/core/hostCore.ts` **一行都不用改**：它本来就是 fetch 这个相对路径，
浏览器里 404 走落地页，桌面端由主进程接住。

## 跑起来

```bash
npm run desktop:dev     # gen:sealed → web:app → electron desktop（开窗口）
npm run desktop:smoke   # 同上但隐藏窗口，跑完自动退出（CI 用）
npm run test:desktop    # 只测解封与身份判据，不需要 Electron
```

`desktop:smoke` 通过时的输出长这样：

```
✓ 桌面端冒烟通过：title=Minicraft core=41107B
```

## 身份判据

见 `core-vault.mjs` 里的四象限表。要点：**没配置签名时，未签名的构建能开**
（否则没有证书就完全没法用）；一旦配置了，未签名或被别人签名的副本都解不开数据。

## 与移动端的差别

- 移动端解封后在 WebView 里跑；桌面端解封后由主进程直接喂给 `fetch`。
- Android 比证书摘要、iOS 比 bundle id、macOS 比 Team ID、Windows 比证书指纹——
  四个平台的判据不同，别互相套用。
- 桌面端**能**限制导航与开窗（`will-navigate` + `setWindowOpenHandler`），比 WebView 更容易收紧。
