#!/usr/bin/env node
/**
 * 跑一遍"进/出小游戏前后帧率与显存对比"（小游戏6 收尾）。
 *
 * 用法：
 *   npm run dev            # 另一个终端先把服务跑起来
 *   node tools/minigame-perf.mjs [--url http://localhost:5173/]
 *
 * 它做的事就是人手动会做的那几步：打开主页 → 点"游戏" → 建一个世界 →
 * 调 `__mc.startMinigameForTest()` 进小游戏、3 秒后退出 →
 * 对比退出前后的 fps / geometries / textures（脚本本体在 `tools/minigame-perf.js`）。
 *
 * ⚠️ 与截图 / 控制台门禁同一条契约：**没有浏览器就 exit 0**（跳过，不算失败）。
 *    真正的失败只有一种：脚本跑完了、有 [FAIL]。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './browser.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { url: 'http://localhost:5173/', width: 1280, height: 720 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).trim();
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) continue;
    if (key === 'url') out.url = value;
    else if (key === 'width') out.width = Number(value);
    else if (key === 'height') out.height = Number(value);
  }
  return out;
}

/** 点进一局（与 console-guard 同一套候选文案；找不到就跳过，不判失败） */
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

  await clickByText([/^游戏$/, /^开始游戏$/, /^Play$/, /^Singleplayer$/]);
  await page.waitForTimeout(1200);
  await clickByText([/新建世界/, /创建新世界/, /^创建$/, /Create New World/i]);
  await page.waitForTimeout(1200);
  await clickByText([/^创建并进入$/, /^进入$/, /^创建$/, /^Create$/, /^Play$/]);
}

/** 进不去时把页面上的文字打出来（比"超时"三个字有用） */
async function dumpText(page) {
  try {
    const text = await page.evaluate('document.body.innerText.slice(0, 600)');
    console.log('[debug] 页面文字：');
    console.log(text);
  } catch {
    /* 页面可能已经挂了 */
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const opened = await openPage({ viewport: { width: args.width, height: args.height } });
  if (!opened.ok) {
    console.log(`[skip] ${opened.reason}，跳过小游戏性能对比。`);
    console.log('       （环境问题，退出码仍然是 0）');
    return 0;
  }

  const { page, problems, close } = opened;
  let result = null;
  let fatal = null;

  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await tryEnterWorld(page);

    // 等 App 真的进世界（`__mc` 挂上去）
    await page.waitForFunction('window.__mc && window.__mc.minigameStateForTest', { timeout: 30000 });
    await page.waitForTimeout(3000);

    const script = readFileSync(resolve(projectRoot, 'tools/minigame-perf.js'), 'utf8');
    await page.evaluate(script);
    await page.waitForFunction('window.__minigamePerfResult !== undefined', { timeout: 90000 });
    result = await page.evaluate('window.__minigamePerfResult');
  } catch (error) {
    fatal = error?.message ?? String(error);
    await dumpText(page);
  } finally {
    await close();
  }

  if (fatal !== null) {
    console.error(`[fail] 脚本没跑完：${fatal}`);
    return 1;
  }
  if (!Array.isArray(result)) {
    console.error('[fail] 没有拿到结果');
    return 1;
  }

  for (const line of result) console.log(line);
  const failed = result.filter((line) => line.startsWith('[FAIL]')).length;
  // 页面上的 console.error 也算失败（与 guard 同一口径）
  const realErrors = problems.filter((line) => !line.includes('ResizeObserver'));
  if (realErrors.length > 0) {
    console.error(`[fail] 期间有 ${realErrors.length} 条控制台错误：`);
    for (const line of realErrors.slice(0, 5)) console.error(`  ${line}`);
    return 1;
  }

  if (failed > 0) {
    console.error(`\n[fail] ${failed} 项未通过`);
    return 1;
  }
  console.log(`\n[ok] ${result.length} 项全过（含进/出小游戏前后的帧率与显存对比）`);
  return 0;
}

process.exitCode = await main();
