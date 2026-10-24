/**
 * 真入口（批次 20261025-0329 · 宿主3）
 *
 * 顺序很重要，这一份文件的存在就是为了这个顺序：
 *
 *   1. 先取**核心数据** `/__host/core.bin`（方块表）；
 *   2. 解出来装进注册表（`installBlockTable`）；
 *   3. 再动态 `import('./main.ts')`——主包一被执行就会开始建图集、进菜单。
 *
 * 为什么不能反过来：`main.ts` 末尾直接 `void boot()`，静态 import 会**立刻**执行它。
 * 表没装上就进世界，方块全是空气、地形是一片虚空——而且不会报错。
 *
 * ## 门禁怎么成立的
 *
 * `__host/core.bin` 这个路径**在线上服务器上不存在**：它只由安卓宿主在
 * `shouldInterceptRequest` 里拦下来、从 APK 的 assets 读出。所以：
 *   · 宿主打开 → 拦截命中 → 装表 → 进游戏；
 *   · 浏览器打开 → 真的一次 404 → 显示"去 Google Play 下载"落地页，主包一个字节都不下载。
 *
 * 想临时在浏览器里跑完整版（预览 / 兜底），把 `core.bin` 放进静态服务器即可——
 * 同一个文件、同一段代码，**放哪决定形态**。这是本方案刻意保留的双形态。
 *
 * ## 对加载体验的影响
 *
 * 多了一次对 `core.bin` 的请求，但那是**本地拦截**（读 APK assets，毫秒级、不走网络）；
 * 换来的主包体积下降在宿主4 落地。顺序上是"先读 10 KB 本地文件，再下主包"，
 * 而主包本身也要下载，所以用户感知不到这一次串行。
 */

import { BLOCK_TABLE_MAGIC, decodeBlockTable } from './core/registry/blockTableCodec.ts';
import { installBlockTable } from './core/registry/blocks.ts';

/** 核心数据路径（相对，跟随 vite `base: './'`，放在子目录也能用） */
const CORE_URL = './__host/core.bin';

/** 等不到就当作"没有核心数据"：宿主里读 assets 是毫秒级，4 秒足够，超时说明宿主有问题 */
const CORE_TIMEOUT_MS = 4000;

/**
 * ⚠️ 上线前填真实包名。留成常量而不是构建期变量，是因为它只在"落地页"这一条路上用到，
 * 不值得为它引一次 `define`。
 */
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.minicraft.game';

/** 取核心数据；任何失败都抛，由调用方决定显示哪一屏 */
async function fetchCore(): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CORE_TIMEOUT_MS);
  try {
    const response = await fetch(CORE_URL, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`核心数据不可用（HTTP ${response.status}）`);
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}

/** 中文 / 英文两套文案：落地页不引 i18n 模块（那在还没加载的主包里） */
function pickText(): {
  title: string;
  body: string;
  button: string;
  note: string;
  updateTitle: string;
  updateBody: string;
} {
  const lang = (navigator.language || 'zh').toLowerCase();
  if (lang.startsWith('zh')) {
    return {
      title: '请在 Minicraft 应用里游玩',
      body: '这个游戏需要一个安卓应用来提供核心资源。装好之后从应用里启动，就能正常进入世界。',
      button: '前往 Google Play 下载',
      note: '网页版不提供完整游戏。',
      updateTitle: '核心资源版本不匹配',
      updateBody: '应用里的资源版本与本页不兼容，请更新到最新版本后再试。',
    };
  }
  return {
    title: 'Play Minicraft in the app',
    body: 'This game needs its Android app to supply the core data. Install it, launch from the app, and the world will load normally.',
    button: 'Get it on Google Play',
    note: 'The web version does not include the full game.',
    updateTitle: 'Core data version mismatch',
    updateBody: 'The data shipped with your app is incompatible with this page. Please update the app and try again.',
  };
}

/**
 * 全屏提示屏（落地页 / 版本不匹配共用）。
 *
 * 为什么直接拼 DOM 而不用项目里的界面组件：那些组件都在主包里，而这一屏的**唯一场景**
 * 就是"主包还没加载"。用它们会把整条加载链拖回来，门禁就失去意义了。
 */
function showScreen(kind: 'install' | 'update'): void {
  const text = pickText();
  const root = document.createElement('div');
  root.setAttribute('role', 'alertdialog');
  root.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'background:#0b0b0b',
    'color:#e8eaee',
    'font:15px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
    'text-align:center',
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText = 'max-width:520px;display:flex;flex-direction:column;gap:16px;align-items:center';

  const title = document.createElement('h1');
  title.textContent = kind === 'install' ? text.title : text.updateTitle;
  title.style.cssText = 'margin:0;font-size:20px;font-weight:600';

  const body = document.createElement('p');
  body.textContent = kind === 'install' ? text.body : text.updateBody;
  body.style.cssText = 'margin:0;color:#b6bcc6';

  box.append(title, body);

  if (kind === 'install') {
    const link = document.createElement('a');
    link.href = PLAY_STORE_URL;
    link.rel = 'noopener';
    link.textContent = text.button;
    link.style.cssText = [
      'display:inline-block',
      'padding:12px 22px',
      'border-radius:8px',
      'background:#3a7d33',
      'border:2px solid #2b5c26',
      'color:#fff',
      'text-decoration:none',
      'font-weight:600',
    ].join(';');
    const note = document.createElement('p');
    note.textContent = text.note;
    note.style.cssText = 'margin:0;color:#7d848f;font-size:13px';
    box.append(link, note);
  }

  root.append(box);
  document.body.replaceChildren(root);
}

/**
 * 这段字节像不像方块表。
 *
 * ⚠️ 光看 HTTP 状态码不够：静态托管（含 `vite preview`、Cloudflare Pages）对不存在的
 * 路径常常回**SPA 回退**——200 + `index.html`。于是 `fetch` 成功、`response.ok` 为真，
 * 拿到的却是一段 HTML。不先验魔数的话，浏览器里会被判成"核心数据版本不匹配"
 * （因为解码时才发现魔数不对），提示语变成"请更新应用"——完全误导。
 * 所以：**魔数不对 = 没有核心数据 = 安装引导；魔数对但解不开 = 版本不匹配 = 提示更新。**
 */
function looksLikeCore(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 16) return false;
  const head = new Uint8Array(buffer, 0, BLOCK_TABLE_MAGIC.length);
  return BLOCK_TABLE_MAGIC.every((byte, index) => head[index] === byte);
}

async function start(): Promise<void> {
  let core: ArrayBuffer;
  try {
    core = await fetchCore();
  } catch (error) {
    // 浏览器打开就是这一条：服务器上没有 `__host/core.bin`
    console.info('[boot] 没有核心数据，显示安装引导', error);
    showScreen('install');
    return;
  }

  if (!looksLikeCore(core)) {
    // 200 但内容不是方块表（SPA 回退 / 被网关改写 / 静态站上放了个别的文件）
    console.info('[boot] 拿到的不是方块表，按"没有核心数据"处理');
    showScreen('install');
    return;
  }

  try {
    installBlockTable(decodeBlockTable(core));
  } catch (error) {
    // 文件在、但解不开 / 版本不兼容：这是"宿主与线上不同步"，不是"没装应用"
    console.error('[boot] 核心数据无法装载', error);
    showScreen('update');
    return;
  }

  await import('./main.ts');
}

void start().catch((error: unknown) => {
  console.error('[boot] 启动失败', error);
  showScreen('update');
});
