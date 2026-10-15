/**
 * PWA（K8）验收：manifest 有效、Service Worker 注册并接管、资源已进缓存
 *
 * 必须在**构建产物**上跑（`npm run build` + `vite preview`），
 * 因为 Service Worker 只在生产模式注册。
 *
 * 用法：见 tools/pwa-check.sh
 */
(async function pwaAcceptance() {
  const lines = [];
  const check = (label, ok, detail) => lines.push(`${ok ? '[OK]  ' : '[FAIL]'} ${label}${detail ? `  ->  ${detail}` : ''}`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---- manifest
  const link = document.querySelector('link[rel="manifest"]');
  check('manifest is linked', !!link, link?.getAttribute('href') ?? 'missing');
  if (link) {
    const response = await fetch(link.href);
    const manifest = await response.json();
    check('manifest served', response.ok, `${response.status}`);
    check('manifest has name + standalone display', Boolean(manifest.name) && manifest.display === 'standalone', `${manifest.name} / ${manifest.display}`);
    check('manifest declares icons', Array.isArray(manifest.icons) && manifest.icons.length > 0, `${manifest.icons?.length ?? 0} 个`);
    check('theme + background color set', Boolean(manifest.theme_color && manifest.background_color), `${manifest.theme_color}/${manifest.background_color}`);
  }

  // ---- service worker
  check('serviceWorker API available', 'serviceWorker' in navigator);
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    check('service worker registered', registrations.length > 0, `scope=${registrations[0]?.scope ?? '-'}`);

    // 首次注册的页面还没被接管，等一会儿（activate 后会 clients.claim()）
    let controlled = navigator.serviceWorker.controller !== null;
    for (let i = 0; i < 20 && !controlled; i++) {
      await sleep(250);
      controlled = navigator.serviceWorker.controller !== null;
    }
    check('page is controlled by the service worker', controlled, controlled ? 'yes' : '首次访问需再刷新一次（正常现象）');
  }

  // ---- 缓存内容（离线可用的直接证据）
  if ('caches' in window) {
    const names = await caches.keys();
    check('cache storage created', names.length > 0, names.join(','));
    let total = 0;
    const samples = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      total += requests.length;
      for (const request of requests.slice(0, 3)) samples.push(new URL(request.url).pathname);
    }
    check('assets cached for offline use', total > 0, `${total} 条：${samples.join(' / ')}`);

    // 入口页必须能被缓存命中（断网时靠它启动）
    const shellHit = await caches.match('./index.html');
    check('app shell cached (offline entry point)', Boolean(shellHit), shellHit ? 'hit' : 'miss');
  }

  return lines.join('\n');
})();
