/**
 * Electron 主进程（Windows / macOS 共用）。
 *
 * 关键设计：**不用 `file://` 加载页面**。
 * `file://` 是 opaque origin，IndexedDB 会被 Chromium 直接关掉——而本项目的存档
 * 全在 IndexedDB 里，等于"能进游戏但存不了档"。所以注册一个自有 scheme
 * `app://minicraft/`（standard + secure），它既有正常 origin，也顺带给了我们一个
 * 和安卓 `shouldInterceptRequest` 完全等价的拦截点：
 *
 *   app://minicraft/__host/core.bin  →  解封后的方块表（解不开就 404）
 *   app://minicraft/…                →  web/dist 里的静态文件
 *
 * 于是 `web/src/core/hostCore.ts` **一行都不用改**：它本来就是 fetch 这个相对路径，
 * 浏览器里 404 走落地页，桌面端由主进程接住。
 */

import { app, BrowserWindow, protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unsealCore } from './core-vault.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = process.env.MINICRAFT_SMOKE === '1';

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

/** 打包后资源在 `resources/`；开发时读仓库里的目录 */
const webRoot = () => (app.isPackaged ? join(process.resourcesPath, 'web') : resolve(HERE, '../web/dist'));
const sealedDir = () => (app.isPackaged ? join(process.resourcesPath, 'sealed') : resolve(HERE, 'resources/sealed'));

// 必须在 ready 之前注册权限
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function coreResponse() {
  const data = unsealCore({
    dir: sealedDir(),
    packaged: app.isPackaged,
    bundlePath: app.isPackaged ? macBundlePath() : undefined,
  });
  if (data === null) {
    // 与"宿主没装 / 浏览器打开"表现一致：404。没有"提示后继续"的分支
    return new Response('', { status: 404 });
  }
  return new Response(data, {
    status: 200,
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
  });
}

/** 打包后 `app.getAppPath()` 在 `Foo.app/Contents/Resources/app.asar` 里 */
function macBundlePath() {
  if (process.platform !== 'darwin') return process.execPath;
  const marker = `${sep}Contents${sep}`;
  const index = process.execPath.indexOf(marker);
  return index >= 0 ? process.execPath.slice(0, index) : process.execPath;
}

async function serveStatic(pathname) {
  const root = webRoot();
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const target = resolve(root, relative === '' ? 'index.html' : relative);
  // 目录穿越守卫：必须仍在 web 根下
  if (target !== root && !target.startsWith(root + sep)) return new Response('', { status: 403 });
  try {
    const info = await stat(target);
    if (info.isDirectory()) return serveStatic(join(relative, 'index.html'));
    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    return new Response(createReadStream(target), {
      status: 200,
      headers: { 'content-type': type, 'cache-control': 'no-store' },
    });
  } catch {
    return new Response('', { status: 404 });
  }
}

app.whenReady().then(async () => {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/__host/core.bin') return coreResponse();
    return serveStatic(url.pathname);
  });

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
      // 桌面端不需要 Capacitor 桥：核心数据走协议拦截，页面代码与 Web 版完全一致
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith('app://minicraft/')) event.preventDefault();
  });

  await win.loadURL('app://minicraft/index.html');

  if (SMOKE) {
    const verdict = await smokeCheck(win);
    console.log(verdict.ok ? `✓ 桌面端冒烟通过：${verdict.detail}` : `✗ 桌面端冒烟失败：${verdict.detail}`);
    app.exit(verdict.ok ? 0 : 1);
  }
});

/** 冒烟：页面能加载 + 核心数据能取到 + 不是明文 */
async function smokeCheck(win) {
  try {
    const title = await win.webContents.executeJavaScript('document.title');
    const core = await win.webContents.executeJavaScript(
      `fetch('/__host/core.bin', { cache: 'no-store' })
         .then(async (r) => (r.ok ? (await r.arrayBuffer()).byteLength : -r.status))
         .catch(() => -1)`,
    );
    if (core <= 0) return { ok: false, detail: `核心数据不可用（${core}）` };
    return { ok: true, detail: `title=${title} core=${core}B` };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || SMOKE) app.quit();
});
