/**
 * Service Worker（K8：PWA / 离线可用）
 *
 * 策略：
 *   - 导航请求（打开页面）：**网络优先**，失败时回落到缓存里的 index.html。
 *     游戏本体是"要不要更新"的关键，联网时永远拿最新的；断网时也能进游戏。
 *   - 静态资源（JS/CSS/图片/worker）：**缓存优先 + 后台更新**（stale-while-revalidate）。
 *     构建产物带内容哈希，文件名变了自然就是新资源，不必担心拿到旧的。
 *
 * 为什么不用"预缓存清单"：Vite 的产物清单要到构建后才知道，
 * 而这里不想引入 workbox 之类的额外依赖。运行时就地缓存对首屏之外的部分足够好，
 * 代价是"第一次访问之后"才能离线——这是可接受的取舍。
 */

// v2（批次 537）：manifest 改成 iOS 兼容的 standalone，必须换缓存名，
// 否则老用户装到主屏时可能还读到缓存里的 fullscreen（iOS 会忽略）。
const CACHE_NAME = 'bedrock-118-web-v2';
/** 离线兜底：任何导航请求失败都回落到它 */
const APP_SHELL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 只预缓存入口，其余靠运行时缓存（失败也不该让安装挂掉）
      await cache.addAll([APP_SHELL, './manifest.webmanifest', './icon.svg']).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清掉旧版本的缓存：改过程序后不要让老资源残留
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 只处理同源请求：跨域（联机 WebSocket 是 ws:// 协议，本来也不走 fetch）不插手
  if (url.origin !== self.location.origin) return;

  // 核心数据（`__host/core.bin`）**绝对不进缓存**：它由安卓宿主拦截注入、随 APK 版本走。
  // 一旦被 Service Worker 缓存住，应用更新之后页面还会读到旧表——不会报错，
  // 只会静默变成"新方块不存在 / 老方块贴图错"，是这类方案里最难查的一种。
  // 反过来说：浏览器打开时这个路径是 404，也不该被缓存成"永久没有"。
  if (url.pathname.includes('/__host/')) return;

  // ---- 导航：网络优先
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(APP_SHELL, response.clone());
          return response;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(APP_SHELL);
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  // ---- 静态资源：缓存优先 + 后台更新
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          // 只缓存成功的同源响应（避免把 404/500 固化下来）
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    })(),
  );
});

// 允许页面主动触发更新（配合"有新版本"提示，暂未接入 UI）
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});
