#!/usr/bin/env node
/**
 * 控制台零错误门禁（Q9）。
 *
 * 用法：
 *   npm run guard                                  # 打开主页跑 20 秒，有任何 console.error / pageerror 就非零退出
 *   npm run guard -- --url http://localhost:5199/ --wait 20000
 *   npm run guard -- --enter-world                 # 顺手点"创建世界"进一局（更接近真实）
 *   npm run guard -- --allow "ResizeObserver"      # 允许某条已知噪音（子串匹配，可重复）
 *
 * 为什么值得单开一个门禁（而不是塞进截图的日志里）：
 *   这次"方块表面纯黑"就是现场能看出问题、但没有东西会去**读**控制台，
 *   于是靠人工截图才发现。控制台的 `pageerror` 恰恰是最早知道"哪里炸了"的信号，
 *   它比截图更早、更准，而且不需要人看。
 *
 * ⚠️ 与截图同一条契约：**没有浏览器时 exit 0**。
 *   环境缺东西不等于页面坏了；把两者混成红灯，门禁很快就会被"习惯性重跑"。
 *   真正的失败只有一种：浏览器起来了、页面加载了、但控制台报错。
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {
    url: 'http://localhost:5173/',
    wait: 20000,
    enterWorld: false,
    allow: [],
    width: 1280,
    height: 720,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).trim();
    if (key === 'enter-world') {
      out.enterWorld = true;
      continue;
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) continue;
    if (key === 'url') out.url = value;
    else if (key === 'wait') out.wait = Number(value);
    else if (key === 'width') out.width = Number(value);
    else if (key === 'height') out.height = Number(value);
    else if (key === 'allow') out.allow.push(value);
  }
  return out;
}

/**
 * 点进一局。
 *
 * 主菜单在全新会话里**没有存档**，所以点"游戏"会进世界列表，那里只有"创建新世界"。
 * 这里的做法尽量宽容：每一步都用可选链 + 多处候选文案，找不到就跳过——
 * 这一步只是为了"多跑一点真实代码"，它失败不该让门禁红（红的原因应来自控制台）。
 */
async function tryEnterWorld(page) {
  const clickByText = async (patterns) => {
    for (const pattern of patterns) {
      const target = page.getByText(pattern, { exact: false }).first();
      try {
        if ((await target.count()) > 0) {
          await target.click({ timeout: 2000 });
          return true;
        }
      } catch {
        /* 下一个候选 */
      }
    }
    return false;
  };

  // 主菜单 → 游戏
  await clickByText([/^游戏$/, /^Play$/, /^Singleplayer$/]);
  await page.waitForTimeout(1200);
  // 世界列表 → 创建新世界（全新会话里没有存档可点）
  await clickByText([/创建新世界/, /^创建$/, /Create New World/i]);
  await page.waitForTimeout(1200);
  // 建世界表单 → 进入
  await clickByText([/^创建并进入$/, /^进入$/, /^创建$/, /^Create$/, /^Play$/]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const opened = await openPage({ viewport: { width: args.width, height: args.height } });
  if (!opened.ok) {
    console.log(`[skip] ${opened.reason}，跳过控制台门禁。`);
    console.log('       装一个浏览器，或设 CHROME_PATH=/path/to/chrome 再来。');
    console.log('       （环境问题，退出码仍然是 0）');
    return 0;
  }

  const { page, problems, close } = opened;
  let fatal = null;

  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(Math.min(3000, args.wait));

    if (args.enterWorld) {
      await tryEnterWorld(page);
    }

    // 剩余等待：让世界真的跑一会儿（区块流式、光照收敛、实体 AI 都在这里发生）
    const rest = Math.max(1000, args.wait - Math.min(3000, args.wait));
    await page.waitForTimeout(rest);
  } catch (error) {
    // goto 都失败说明"页面根本打不开"——这是真失败，不是环境问题
    fatal = error?.message ?? String(error);
  } finally {
    await close();
  }

  if (fatal !== null) {
    console.error(`[fail] 页面打不开：${fatal}`);
    return 1;
  }

  // 过滤掉调用方声明为"已知噪音"的条目
  const real = problems.filter((line) => !args.allow.some((pattern) => line.includes(pattern)));
  const suppressed = problems.length - real.length;

  if (suppressed > 0) {
    console.log(`[info] 按 --allow 放行 ${suppressed} 条已知噪音`);
  }

  if (real.length === 0) {
    console.log(`[ok] 控制台干净：跑 ${Math.round(args.wait / 1000)} 秒，0 条错误${args.enterWorld ? '（含进世界）' : ''}`);
    return 0;
  }

  console.error(`[fail] 控制台有 ${real.length} 条错误：`);
  for (const line of real.slice(0, 30)) console.error(`  · ${line}`);
  if (real.length > 30) console.error(`  … 另有 ${real.length - 30} 条`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('[fail] 门禁脚本自身出错：', error?.message ?? error);
    process.exit(1);
  });
