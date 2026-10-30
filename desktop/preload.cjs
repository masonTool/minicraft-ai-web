/**
 * 预加载脚本：把「主机服务器」能力暴露成**与 Android 同形状**的同步桥（2026-10-30）。
 *
 * 为什么必须是同步的：网页侧 `HostBridge.ts` 的契约就是同步返回 JSON 字符串
 * （`hasHostBridge()` 用它决定"要不要显示开房入口"，那是个渲染期判断，改异步会把
 * 整条 UI 路径翻一遍）。所以这里用 `ipcRenderer.sendSync`——桌面端是本地进程，
 * 一次往返是微秒级，没有性能问题。
 *
 * 用 `.cjs`：主进程 `sandbox: true` 时预加载脚本只能是 CommonJS。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('MinicraftAndroid', {
  localIp: () => ipcRenderer.sendSync('mc:localIp'),
  serverPort: () => ipcRenderer.sendSync('mc:serverPort'),
  startServer: () => ipcRenderer.sendSync('mc:startServer'),
  stopServer: () => ipcRenderer.sendSync('mc:stopServer'),
});
