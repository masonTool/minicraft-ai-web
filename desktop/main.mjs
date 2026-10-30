/**
 * Electron 主进程（Windows / macOS 共用）。
 *
 * ## 为什么起一个 loopback HTTP 服务，而不是 file:// 或自定义协议
 *
 * - `file://` 是 opaque origin，Chromium 会**直接关掉 IndexedDB**——存档全在里面，
 *   表现是"能进游戏但存不了档"，且不报错。
 * - 自定义 scheme（之前的 `app://minicraft`）能用，但三端就没法统一到同一个 origin 语义。
 *
 * 现在统一成 **`http://127.0.0.1:<固定端口>`**：和 Android 壳的 `http://localhost` 是同一类
 * 可信来源，IndexedDB、剪贴板、`ws://` 联机都正常。端口固定是为了存档——origin 变一次，
 * IndexedDB 就是全新的库（等于清档）。
 *
 * ## 内容从哪来
 *
 * 整个游戏产物打成了 `libmcrt.so`（整段 AES-GCM + gzip，伪装成原生库）。
 * 主进程启动时用**签名摘要**派生 KEK、解开 CEK、整段解密并常驻内存，
 * 之后每个 HTTP 请求都从内存里切一份返回——**磁盘上从来没有明文**。
 */

import { app, BrowserWindow, Menu, shell, ipcMain } from 'electron';
import { createGameServer } from './game-server.mjs';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBundle } from './bundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = process.env.MINICRAFT_SMOKE === '1';
/** 固定端口：换了就等于换 origin，IndexedDB 存档全部作废 */
const PORT = 18764;

/**
 * 联机服务端（玩家当房主时才跑）。脚本由 `npm run pack` 用 esbuild 打成单文件，
 * 跟着 `build/rt` 一起进安装包——这样不依赖用户机器上装了 Node。
 */
const GAME_SERVER_SCRIPT = app.isPackaged
  ? join(process.resourcesPath, 'rt', 'minicraft-server.cjs')
  : join(HERE, '..', 'build', 'rt', 'minicraft-server.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** 打包后放 `resources/rt/`；开发时读仓库里的 `build/rt/` */
const rtDir = () => (app.isPackaged ? resolve(process.resourcesPath, 'rt') : resolve(HERE, '../build/rt'));

/**
 * 打开整包。
 *
 * 桌面端拿不到"自身代码签名摘要"（那是 macOS 的 codesign，且不是证书摘要），
 * 所以用构建期写死的摘要——这也是桌面端强度弱于 Android 的根因，
 * 见 `docs/CODE-PROTECTION.md`。
 */
function loadBundle() {
  const dir = rtDir();
  const signers = JSON.parse(readFileSync(resolve(dir, 'signers.json'), 'utf8')).signers;
  const pkg = readFileSync(resolve(dir, 'libmcrt.so'));
  const bundle = openBundle(pkg, String(signers[0]));
  if (bundle === null) {
    throw new Error('整包解密失败：签名摘要对不上，或包被改过');
  }
  return bundle;
}

function startServer(bundle) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const name = decodeURIComponent(path).replace(/^\/+/, '') || 'index.html';
    const body = bundle.get(name);
    if (body === undefined || body === null) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
      // 内容每次启动都可能不同（新包），不让 WebView 缓存旧 JS
      'cache-control': 'no-store',
    });
    res.end(body);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    // 只监听回环，不对局域网暴露
    server.listen(PORT, '127.0.0.1', () => ok(server));
  });
}

// 冒烟模式不抢锁：否则上一次没退干净的实例会让冒烟"直接退出当成功"
const singleInstance = SMOKE ? true : app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win === undefined) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

/**
 * 宿主桥的桌面实现（与 Android 的 `JsHostBridge` 一一对应）。
 *
 * 全部用 `sendSync`：网页侧契约就是同步（见 `HostBridge.ts` —— `hasHostBridge()`
 * 在渲染期就被调用，改异步要翻整条 UI 路径）。
 */
const gameServer = createGameServer({
  scriptPath: GAME_SERVER_SCRIPT,
  dataDir: join(app.getPath('userData'), 'world'),
  log: (message) => console.log(message),
});

ipcMain.on('mc:localIp', (event) => {
  const ip = gameServer.ip();
  event.returnValue = ip === null ? '{"ip":null}' : `{"ip":"${ip}"}`;
});
ipcMain.on('mc:serverPort', (event) => {
  event.returnValue = `{"port":${gameServer.port()}}`;
});
ipcMain.on('mc:startServer', (event) => {
  gameServer.start();
  event.returnValue = '{"started":true}';
});
ipcMain.on('mc:stopServer', (event) => {
  gameServer.stop();
  event.returnValue = '{"stopped":true}';
});

// 关掉应用 = 主机离开游戏，服务端必须跟着走，否则局域网里会留一台连不进的空服务器
app.on('before-quit', () => gameServer.stop());
app.on('will-quit', () => gameServer.stop());

app.whenReady().then(async () => {
  if (app.isPackaged) Menu.setApplicationMenu(null);

  let bundle;
  try {
    bundle = loadBundle();
  } catch (error) {
    console.error(`✗ ${String(error)}`);
    app.exit(1);
    return;
  }

  try {
    await startServer(bundle);
  } catch (error) {
    console.error(`✗ 端口 ${PORT} 无法监听（可能被别的程序占用）：${String(error)}`);
    app.exit(1);
    return;
  }

  const origin = `http://127.0.0.1:${PORT}`;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: !SMOKE,
    backgroundColor: '#0b0f14',
    title: 'Minicraft',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // 与 Android 同形状的宿主导出：`window.MinicraftAndroid`
      preload: join(HERE, 'preload.cjs'),
    },
  });

  // 外链交给系统浏览器；只允许留在本站点内导航
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith(origin)) return;
    event.preventDefault();
    if (/^https?:$/.test(new URL(target).protocol)) void shell.openExternal(target);
  });

  if (SMOKE) {
    // 冒烟时把页面控制台打到 stdout：失败时只知道"没起来"是没法查的
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) console.log(`  [page:${level}] ${message.slice(0, 300)}`);
    });
  }

  await win.loadURL(`${origin}/index.html`);

  if (SMOKE) {
    const verdict = await smokeCheck(win, bundle);
    console.log(verdict.ok ? `✓ 桌面端冒烟通过：${verdict.detail}` : `✗ 桌面端冒烟失败：${verdict.detail}`);
    app.exit(verdict.ok ? 0 : 1);
  }
});

/**
 * 冒烟：页面能加载 + 主菜单真的渲染出来。
 *
 * 不用 `window.__mc` 当判据——它在切世界等路径上会被置空，代表的是"调试实例"，
 * 不是"界面起来了"。这里直接看页面上的按钮数量，更贴近玩家能看到的东西。
 */
async function smokeCheck(win, bundle) {
  try {
    const title = await win.webContents.executeJavaScript('document.title');
    // `loadURL` 只等到 DOMContentLoaded，主包还要异步装表/建菜单，所以轮询而不是睡固定时长
    let buttons = 0;
    for (let i = 0; i < 80; i += 1) {
      buttons = await win.webContents.executeJavaScript("document.querySelectorAll('button').length");
      if (buttons >= 3) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (buttons < 3) {
      const text = await win.webContents.executeJavaScript('document.body.innerText.slice(0, 120)');
      return { ok: false, detail: `主菜单没渲染（button=${buttons}）文字=${JSON.stringify(text)}` };
    }
    return { ok: true, detail: `title=${title} 按钮=${buttons} 包内=${bundle.paths.length} 文件 / ${bundle.bytes}B` };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || SMOKE) app.quit();
});
