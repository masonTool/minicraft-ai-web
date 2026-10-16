#!/usr/bin/env node
/**
 * 任务清单自检（TASKS.md / HANDOFF.md）
 *
 * 为什么要有这个脚本：`TASKS.md` 是"做到哪了"的唯一锚点，提交信息、队列文件、
 * 交接文档都靠它的 id 互相对照。它会随着每批工作不断被追加，于是很容易出现：
 *
 *   - **编号撞车**：新增条目随手写了个已经用过的号（本轮就发生过：新写的 M6/M7/M8
 *     与既有的"死亡界面/成就/i18n"重号）
 *   - **编号跳号**：删条目或插条目时漏号
 *   - **数字漂移**：HANDOFF 里写"已完成 78"，实际早就 85 了
 *
 * 所以这里做五件事，任何一个不过就以非 0 退出（方便挂到 CI 或提交前手动跑）：
 *   1. 报告 已完成 / 进行中 / 待办 的条数（HANDOFF 的数字要与它一致）
 *   2. 检查 id 是否重复、每段编号是否连续
 *   3. 核对 HANDOFF 的"进度口径"那一行
 *   4. 用本表**自动重写 README 的路线图状态列**（README 里那张表是手写的，
 *      已经漂过一次：P1~P9 全部标着"未开始"，而实际早就完成大半）
 *   5. 核对 HANDOFF 的"提交总数"与 `git rev-list --count HEAD`
 *
 * 用法：`npm run audit:tasks`
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const TASK_FILE = new URL('../TASKS.md', import.meta.url);
const HANDOFF_FILE = new URL('../HANDOFF.md', import.meta.url);
const README_FILE = new URL('../README.md', import.meta.url);

/** 【原规格】那条只是锚点，与详细条目共用 id 是允许的 */
const SPEC_MARK = '【原规格】';

const text = readFileSync(TASK_FILE, 'utf8');
const lines = text.split('\n');

const counts = { done: 0, doing: 0, todo: 0, dropped: 0 };
const ids = [];
/** @type {Map<string, string[]>} 段落字母 → 出现的编号 */
const byPrefix = new Map();
/** @type {Map<string, {done: number, doing: number, todo: number}>} 段落字母 → 完成情况（README 路线图用） */
const bySection = new Map();

let section = '';
for (const line of lines) {
  const head = /^## ([0-9A-O])\./.exec(line);
  if (head) section = head[1];

  const item = /^- \[([ x~-])\] ([A-Z]+)(\d+[a-z]?)\b(.*)$/.exec(line);
  if (!item) continue;

  const [, mark, prefix, number, rest] = item;
  if (mark === 'x') counts.done++;
  else if (mark === '~') counts.doing++;
  else if (mark === '-') counts.dropped++;
  else counts.todo++;

  if (section) {
    const stat = bySection.get(section) ?? { done: 0, doing: 0, todo: 0, dropped: 0 };
    if (mark === 'x') stat.done++;
    else if (mark === '~') stat.doing++;
    else if (mark === '-') stat.dropped++;
    else stat.todo++;
    bySection.set(section, stat);
  }

  // 原规格锚点行不参与重号检查
  if (rest.includes(SPEC_MARK)) continue;

  const id = `${prefix}${number}`;
  ids.push({ id, section, line });
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(Number(number));
}

const total = counts.done + counts.doing + counts.todo + counts.dropped;
console.log(`TASKS.md 共 ${total} 项：已完成 ${counts.done} / 进行中 ${counts.doing} / 待办 ${counts.todo}${
  counts.dropped > 0 ? ` / 放弃 ${counts.dropped}` : ''
}`);

let failed = false;

// ---- 1. 重号
const seen = new Map();
const duplicates = [];
for (const entry of ids) {
  if (seen.has(entry.id)) duplicates.push(`${entry.id}（第 ${seen.get(entry.id)} 行 与 第 ${entry.line} 行）`);
  else seen.set(entry.id, entry.line);
}
if (duplicates.length > 0) {
  failed = true;
  console.log(`\n✗ 编号重复 ${duplicates.length} 处：`);
  for (const dup of duplicates) console.log(`    ${dup}`);
} else {
  console.log('✓ 编号无重复');
}

// ---- 2. 跳号
const gaps = [];
for (const [prefix, numbers] of [...byPrefix.entries()].sort()) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const missing = [];
  for (let n = sorted[0]; n <= sorted[sorted.length - 1]; n++) {
    if (!sorted.includes(n)) missing.push(n);
  }
  if (missing.length > 0) gaps.push(`${prefix}: 缺 ${missing.join(', ')}`);
}
if (gaps.length > 0) {
  failed = true;
  console.log(`\n✗ 编号不连续：`);
  for (const gap of gaps) console.log(`    ${gap}`);
} else {
  console.log('✓ 各段编号连续');
}

// ---- 3. HANDOFF 的进度口径
const handoff = readFileSync(HANDOFF_FILE, 'utf8');
const claim = /已完成 \*\*(\d+)\*\*、进行中 \*\*(\d+)\*\*、待办 (\d+)/.exec(handoff);
if (!claim) {
  failed = true;
  console.log('\n✗ HANDOFF.md 里找不到"进度口径：已完成 **N**、进行中 **M**、待办 K"这一行');
} else {
  const [, done, doing, todo] = claim.map(Number);
  const ok = done === counts.done && doing === counts.doing && todo === counts.todo;
  if (ok) {
    console.log('✓ HANDOFF 的进度口径与本表一致');
  } else {
    failed = true;
    console.log(
      `\n✗ HANDOFF 的进度口径过期：写着 已完成 ${done} / 进行中 ${doing} / 待办 ${todo}，` +
        `实际是 ${counts.done} / ${counts.doing} / ${counts.todo}`,
    );
  }
}

// ---- 4. README 路线图：状态列由本表算出来，不手写
/**
 * README 的阶段 ↔ TASKS 的段落。表是手写的、内容列写的是"这一阶段的范围"，
 * 但**状态列必须是算出来的**——之前它整体停留在"未开始"，而实际早已完成大半。
 */
const PHASE_SECTIONS = {
  P0: ['A'],
  P1: ['B', 'C', 'E'],
  P2: ['D'],
  P3: ['F', 'G'],
  P4: ['H'],
  P5: ['I'],
  P6: ['J'],
  P7: ['K'],
  P8: ['L'],
  P9: ['M'],
};

function phaseStatus(phase) {
  let done = 0;
  let total = 0;
  for (const letter of PHASE_SECTIONS[phase] ?? []) {
    const stat = bySection.get(letter);
    if (!stat) continue;
    done += stat.done;
    total += stat.done + stat.doing + stat.todo + stat.dropped;
  }
  return { done, total };
}

const readme = readFileSync(README_FILE, 'utf8');
let readmeOut = readme;
let rewrote = 0;
for (const [phase] of Object.entries(PHASE_SECTIONS)) {
  const { done, total } = phaseStatus(phase);
  const status = done === total && total > 0 ? `✅ 全部完成（${total} 项）` : `🔶 已完成 ${done} / 共 ${total}`;
  // 三格的行：阶段+名称 | 内容 | 状态。只换第三格，前两格原样保留
  const row = new RegExp(`^(\\| \\*\\*${phase}\\*\\* .*? \\| .*? \\| )[^|]*(\\|)$`, 'm');
  const match = row.exec(readmeOut);
  if (!match) {
    failed = true;
    console.log(`\n✗ README 里找不到阶段行 **${phase}**（路线图表格被改过？）`);
    continue;
  }
  const next = `${match[1]}${status} ${match[2]}`;
  if (next !== match[0]) {
    readmeOut = readmeOut.replace(match[0], next);
    rewrote++;
  }
}
if (rewrote > 0) {
  writeFileSync(README_FILE, readmeOut);
  failed = true;
  console.log(`\n✗ README 的路线图状态列已按 TASKS 自动重写（${rewrote} 行），请重新暂存后提交`);
} else {
  console.log('✓ README 路线图状态与本表一致');
}

// ---- 5. HANDOFF 的提交总数
const claimCommits = /提交总数 (\d+)/.exec(handoff);
if (!claimCommits) {
  failed = true;
  console.log('\n✗ HANDOFF.md 里找不到"提交总数 N"这一行');
} else {
  let actual = null;
  try {
    actual = Number(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim());
  } catch {
    // 不在 git 仓库里（例如把源码解压出来单独跑）时跳过这一项，不该因此判失败
    console.log('· 跳过提交总数核对（当前不在 git 仓库里）');
  }
  if (actual !== null) {
    const claimed = Number(claimCommits[1]);
    // 容差 2：一个批次通常是"内容一条 + 文档一条"，更新这一句时那两条都还没落盘
    if (Math.abs(actual - claimed) <= 2) {
      console.log(`✓ HANDOFF 的提交总数与实际一致（写着 ${claimed}，实际 ${actual}）`);
    } else {
      failed = true;
      console.log(`\n✗ HANDOFF 的提交总数过期：写着 ${claimed}，实际 ${actual}（差 ${actual - claimed}）`);
    }
  }
}

// ---- 6. README/HANDOFF 里的"离线测试套数"与 package.json 的实际脚本数
{
  let declared = 0;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const names = Object.keys(pkg.scripts ?? {}).filter((key) => key.startsWith('test:'));
    // `test:unit` 是 vitest，`test:unit:watch` 是它的监视模式，都不算"自建离线测试"
    declared = names.filter((key) => key !== 'test:unit' && key !== 'test:unit:watch').length;
  } catch {
    declared = 0;
  }

  const claimTests = /vitest \+ (\d+) 套自建离线测试/.exec(readmeOut);
  /**
   * HANDOFF 里也写着同一个数（`npm test` 那一行的"**N 套**"）。
   *
   * ⚠️ 这条是补上的：批次 57 之前这里**只查了 README**，于是 HANDOFF 那个数从
   * 56 一路漂到 62 都没人发现（列表长了、数字没跟着走）。**同一个事实写在两处，
   * 自检就得查两处**——否则"锚点文档不会漂"这句话本身就在漂。
   */
  const claimHandoff = /\*\*(\d+) 套\*\*自建离线测试/.exec(handoff);
  if (declared === 0) {
    console.log('· 跳过离线测试套数核对（读不到 package.json）');
  } else if (!claimTests) {
    failed = true;
    console.log('\n✗ README 里找不到"vitest + N 套自建离线测试"这一句');
  } else if (Number(claimTests[1]) !== declared) {
    failed = true;
    console.log(`\n✗ README 的离线测试套数过期：写着 ${claimTests[1]} 套，package.json 里实际 ${declared} 套`);
  } else if (!claimHandoff) {
    failed = true;
    console.log('\n✗ HANDOFF 里找不到"**N 套**自建离线测试"这一句');
  } else if (Number(claimHandoff[1]) !== declared) {
    failed = true;
    console.log(`\n✗ HANDOFF 的离线测试套数过期：写着 ${claimHandoff[1]} 套，package.json 里实际 ${declared} 套`);
  } else {
    console.log(`✓ README 与 HANDOFF 的离线测试套数都与 package.json 一致（${declared} 套）`);
  }
}

if (failed) {
  console.log('\n自检未通过：修好上面几项再提交（别让锚点文档自己先漂了）');
  process.exit(1);
}
console.log('\n任务清单自检通过');
