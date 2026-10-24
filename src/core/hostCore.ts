/**
 * 启动门禁（批次 20261025-0329 · 宿主3 / 宿主4 调整）
 *
 * 顺序很重要，这一份文件的存在就是为了这个顺序：
 *
 *   1. 先取**核心数据** `/__host/core.bin`（方块表）；
 *   2. 解出来装进注册表（`installBlockTable`）；
 *   3. 返回 `true` 之后才允许 `main.ts` 调 `boot()`——`boot()` 会建图集、进菜单。
 *
 * 为什么不能反过来：表没装上就进世界，方块全是空气、地形是一片虚空——而且不会报错。
 *
 * ⚠️ 为什么**不**做成独立入口 + 动态 `import('./main.ts')`（试过，已回退）：
 * 那样 `blocks.ts` 会同时被入口 chunk 与 main chunk 引用，rolldown 在两个 chunk 里
 * **各打一份**（实测主包 2.0 MB / gzip 556 KB，而单入口是 1.2 MB / 338 KB），
 * 顺带还多一次请求。门禁要不要"连 JS 都不给"并不重要——没有核心数据，那份 JS
 * 本来也跑不起来；而体积翻倍是实打实的体验损失。
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

import { BLOCK_TABLE_MAGIC, decodeBlockTable } from './registry/blockTableCodec.ts';
import { installBlockTable } from './registry/blocks.ts';

/** 核心数据路径（相对，跟随 vite `base: './'`，放在子目录也能用） */
const CORE_URL = './__host/core.bin';

/** 等不到就当作"没有核心数据"：宿主里读 assets 是毫秒级，4 秒足够，超时说明宿主有问题 */
const CORE_TIMEOUT_MS = 4000;

/**
 * ⚠️ 上线前填真实包名。留成常量而不是构建期变量，是因为它只在"落地页"这一条路上用到，
 * 不值得为它引一次 `define`。
 */
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.minicraft.game';

/** 站点上的版本清单（静态文件，构建期生成；拿不到就用兜底值，不阻塞启动） */
const VERSION_URL = './version.json';

/**
 * `version.json` 取不到时的兜底下限。
 *
 * 只在"清单文件本身没拿到"（离线 / 老构建 / 被网关改写）时用。必须是**最宽松**的值：
 * 拿不到清单就拒绝启动，等于让一个小文件把整个游戏挡在门外，代价远大于收益。
 */
const CORE_VERSION_FLOOR = 1;

/**
 * 从 UA 里读宿主自报的核心数据版本。
 *
 * 约定形如：`… MinicraftHost/1.0 core/3`（宿主启动时把 `core/<装载的版本>` 拼在 UA 末尾）。
 * 为什么用 UA 而不是 JSBridge：**启动早期**就要判，那时桥还没建好；而 UA 在第一个请求里就有，
 * 多一行代码就能用，也不需要为了一个数字引一套消息通道。
 *
 * 返回 `null` 表示"UA 里没有这个标记"——浏览器就是这种（也包含伪造 UA 的人：
 * 他们最多把自己伪装成"版本未知"，而版本未知的处置是**继续走正常流程**，见 `evaluateHostVersion`）。
 */
export function readHostCoreVersion(userAgent: string): number | null {
  // 只认"宿主标记 + core/N"同时出现，避免把普通浏览器 UA 里的巧合数字当成版本
  const match = /MinicraftHost\/[\d.]+\s+core\/(\d+)/i.exec(userAgent);
  if (match === null) return null;
  const version = Number(match[1]);
  return Number.isInteger(version) && version >= 0 ? version : null;
}

/**
 * 版本判定（纯函数，便于把三种组合钉成测试）。
 *
 *  - `unknown`：UA 里没有宿主标记（浏览器）→ **继续正常流程**，让他去撞 404，
 *    最终看到"去应用里玩"。这里不能直接判"请更新应用"：那对浏览器是错的提示。
 *  - `outdated`：宿主自报的版本低于站点要求的下限 → 提示"请更新应用"。
 *  - `ok`：版本达标（或宿主没自报但站点也没有下限要求）。
 */
export function evaluateHostVersion(
  hostVersion: number | null,
  minSupported: number,
): 'ok' | 'outdated' | 'unknown' {
  if (hostVersion === null) return 'unknown';
  return hostVersion < minSupported ? 'outdated' : 'ok';
}

/**
 * 取站点要求的最低核心数据版本。
 *
 * 任何失败（404 / JSON 坏 / 字段缺失）都回退到兜底值，**不抛**：这个文件是"锦上添花"的
 * 版本闸门，不该成为启动路径上的单点故障。
 */
async function fetchMinSupportedCore(): Promise<number> {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return CORE_VERSION_FLOOR;
    const data = (await response.json()) as { minSupportedCore?: unknown };
    const value = data.minSupportedCore;
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : CORE_VERSION_FLOOR;
  } catch {
    return CORE_VERSION_FLOOR;
  }
}

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

/**
 * 启动前调用：拿到并装好核心数据就返回 true；否则**已经画好提示屏**并返回 false。
 *
 * 调用方（`main.ts`）拿到 false 时必须直接放弃启动，不要"先跑起来再说"——
 * 没有方块表的世界不会报错，只会是一片空白，那种失败比黑屏难查得多。
 */
export async function ensureHostCore(): Promise<boolean> {
  // 两件事并行：核心数据（宿主本地拦截，毫秒级）与版本清单（静态小文件）。
  // 串行会让"读一个 200 字节的 JSON"挡在主包前面，白多一段等待。
  const corePromise = fetchCore();
  const minSupportedPromise = fetchMinSupportedCore();

  // ---- 版本闸门：先判"宿主是不是太老了"，比解一遍二进制更早、也更省
  const hostVersion = readHostCoreVersion(navigator.userAgent);
  const minSupported = await minSupportedPromise;
  if (evaluateHostVersion(hostVersion, minSupported) === 'outdated') {
    // 提前返回之后 corePromise 若 reject 就成了"未处理的 rejection"（控制台冒红，
    // 还会被控制台门禁当成真错误），所以必须先挂一个 catch
    corePromise.catch(() => undefined);
    console.warn(`[boot] 宿主核心数据版本过旧（core/${String(hostVersion)} < ${minSupported}）`);
    showScreen('update');
    return false;
  }

  let core: ArrayBuffer;
  try {
    core = await corePromise;
  } catch (error) {
    // 浏览器打开就是这一条：服务器上没有 `__host/core.bin`
    console.info('[boot] 没有核心数据，显示安装引导', error);
    showScreen('install');
    return false;
  }

  if (!looksLikeCore(core)) {
    // 200 但内容不是方块表（SPA 回退 / 被网关改写 / 静态站上放了个别的文件）
    console.info('[boot] 拿到的不是方块表，按"没有核心数据"处理');
    showScreen('install');
    return false;
  }

  try {
    installBlockTable(decodeBlockTable(core));
  } catch (error) {
    // 文件在、但解不开 / 格式版本不兼容：这是"宿主与线上不同步"，不是"没装应用"
    console.error('[boot] 核心数据无法装载', error);
    showScreen('update');
    return false;
  }
  return true;
}
