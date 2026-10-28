# Windows 端（预留）

当前**没有代码**，只是把目录占住，避免以后又长回 `server/` 或仓库根。

## 可能的形态（未定）

本项目是 Three.js / WebGL2 的 Web 应用，桌面端有两条路：

1. **Electron / Tauri 套壳**：直接消费 `web/dist`，与 Android 壳同构；
   `web/src/core/hostCore.ts` 已经有"先问原生保险柜、再退回静态路径"的分支，
   桌面壳只要提供一个同名能力（`Capacitor.Plugins.CoreVault.read`）就能复用。
2. **真正的原生窗口**（WebView2）：等价于 Android 的 Capacitor 方案，但签名闸门的
   做法不同——Windows 上要换成 Authenticode 证书比对。

## 定下来之前的约定

- 不要在这里放临时脚本（放 `tools/`）；
- 不要把 `web/` 的源码复制一份过来，一律通过 `web/dist` 消费。
