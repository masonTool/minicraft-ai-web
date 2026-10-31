# 桌面端运行时（Windows / macOS 共用）

**一份** Electron 代码，两个平台各自打包：平台差异只在 [`windows/`](../windows/README.md)
与 [`mac/`](../mac/README.md) 的配置和资源里。**不要**为两个平台各复制一份 `main.mjs`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `main.mjs` | 主进程：起 loopback HTTP 服务、开窗口、解密取内容 |
| `bundle.mjs` | 整包解密（与 Android/iOS 同一份包格式），纯 Node，可单测 |
| `game-server.mjs` | 联机服务端入口（玩家当房主时才跑） |
| `preload.cjs` | 渲染进程的受限桥 |
| `package.json` | electron-builder 的 app 清单（name / version / main） |

## 关键设计：为什么是 `http://127.0.0.1:18764`

| 方案 | 问题 |
| --- | --- |
| `file://` | opaque origin，Chromium **直接关掉 IndexedDB**——存档全在里面，表现是"能进游戏但存不了档"，且不报错 |
| 自定义 `app://` scheme | 能用，但三端就没法统一到同一个 origin 语义 |
| **`http://127.0.0.1:固定端口`** | 和 Android 壳的 `http://localhost` 同类可信来源；IndexedDB、剪贴板、`ws://` 联机都正常 |

端口固定是**为了存档**：origin 变一次，IndexedDB 就是一个全新的库（等于清档）。

内容来源与 Android 一样：`libmcrt.so` 整段解密后常驻主进程内存，每个请求从内存切一份返回，
**磁盘上从来没有明文**。

## 跑起来

```bash
npm run dev:desktop    # build:web + pack + 开窗口（不热更新）
npm run build:mac      # 出 dmg
npm run build:win      # 出 exe（需 Windows 机器或 wine）
```

想带 HMR 调界面用 `npm run dev`（浏览器）；`dev:desktop` 是验证"壳里跑得对不对"。

冒烟（不开窗口、跑完自动退出）：

```bash
MINICRAFT_SMOKE=1 npx electron desktop/main.mjs
# ✓ 桌面端冒烟通过：title=Minicraft 按钮=95 包内=25 文件 / 4649060B
```

它会真的解密整包、加载页面、等主菜单渲染出来再判定，不是只看"进程没崩"。

## 与移动端的差别

- 移动端解封后在 WebView 里跑；桌面端解封后在主进程里直接喂给 HTTP。
- 四端判据不同，**别互相套用**：Android 比证书摘要、iOS 用 `signers.json`、
  macOS 比 Team ID、Windows 比证书指纹。
- 桌面端能收紧导航与开窗（`will-navigate` + `setWindowOpenHandler`），比 WebView 更容易限死。
- 桌面端的钥匙材料（`signers.json`）**就在安装包里**，所以这一端的强度只到"防随手改包"。
