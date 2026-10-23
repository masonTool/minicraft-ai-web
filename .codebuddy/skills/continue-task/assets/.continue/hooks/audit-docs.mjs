#!/usr/bin/env node
/**
 * 文档体量门禁。
 *
 * 为什么存在（挡的是哪次事故）：
 *   入口文档是**每轮都要进上下文**的成本项。`DONE.md` 每收尾一批就长 25~40 行，
 *   一年下来几千行；而 `README.md` 是每次冷启动都要读的。不设上限，
 *   框架自己会变成"读文档花掉一半预算"的那个反模式（README §0 原理 7：认知预算）。
 *
 * 上限从哪来：写在 `LIMITS` 里，**不给手改留空间**——要放宽就改这个文件并说明理由，
 * 而不是在文档里自我安慰"以后注意"。
 *
 * 退出码：0 通过 / 1 超限（可被 `checks.fast` 拦住提交）。
 * 幂等：只读，不写文件（契约 6：检查与写入分离；归档是另一个脚本的事）。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  DOC_BYTE_LIMITS,
  DOC_LIMITS,
  DONE_FILE,
  listQueues,
  OVERVIEW_FILE,
  README_FILE,
  TASKS_FILE,
  TIPS_FILE,
} from './lib.mjs';

/**
 * 上限怎么定的（每一行都写清依据，否则半年后没人敢动）：
 *
 *   · README  —— 机制说明书，冷启动必读。400 行已经够铺满全部规则；
 *                再长说明该拆成"机制"与"实现细节"两份。
 *   · DONE    —— 归档时间线，**不每轮读**，但也不该无限长。300 行 ≈ 8~10 批，
 *                到顶就该把最旧的批次搬进 `DONE.archive.md`。
 *   · OVERVIEW—— 每轮开头要读的那一节，必须短。200 行 ≈ 十几个模块。
 *   · TASKS   —— 需求清单，**不逐条读**（计划层"可大但不逐条读"），按 `T` 号 grep。
 *                600 行 ≈ 几百条需求；再多说明该按分节拆文件了。
 *   · TIPS    —— 按模块 grep，不整份读，可以长一些；但单文件 500 行后
 *                应该按大模块拆开。
 *   · doing/* —— 队列**每轮都要读**，框架约定的硬上限 500 行。
 *                超了说明一批塞了太多条，或完成说明写成了流水账。
 */
const LIMITS = [
  { file: README_FILE, name: 'README.md', max: DOC_LIMITS.README, why: '冷启动必读的机制说明书' },
  {
    file: DONE_FILE,
    name: 'DONE.md',
    max: DOC_LIMITS.DONE,
    why: '归档时间线，超了跑 `node .continue/hooks/archive-done.mjs` 搬到 DONE.archive.md',
  },
  { file: OVERVIEW_FILE, name: 'OVERVIEW.md', max: DOC_LIMITS.OVERVIEW, why: '每轮开头要读的模块总览' },
  { file: TASKS_FILE, name: 'TASKS.md', max: DOC_LIMITS.TASKS, why: '需求清单，按 T 号 grep、不逐条读' },
  { file: TIPS_FILE, name: 'TIPS.md', max: DOC_LIMITS.TIPS, why: '按模块 grep，超了按模块拆分' },
  ...listQueues().map(({ sid, file }) => ({
    file,
    name: `doing/${sid}.md`,
    max: DOC_LIMITS.QUEUE,
    why: '队列每轮都读，拆成多批或精简完成说明',
  })),
];

/**
 * 字节上限：与行数上限同一组文件，查的是"真实上下文成本"而不是行数。
 * 两套都过才算过——行数防"条目太多"，字节防"单行太长（大表格）"。
 */
const BYTE_LIMITS = [
  { file: README_FILE, name: 'README.md', max: DOC_BYTE_LIMITS.README },
  { file: DONE_FILE, name: 'DONE.md', max: DOC_BYTE_LIMITS.DONE },
  { file: OVERVIEW_FILE, name: 'OVERVIEW.md', max: DOC_BYTE_LIMITS.OVERVIEW },
  { file: TASKS_FILE, name: 'TASKS.md', max: DOC_BYTE_LIMITS.TASKS },
  { file: TIPS_FILE, name: 'TIPS.md', max: DOC_BYTE_LIMITS.TIPS },
  ...listQueues().map(({ sid, file }) => ({ file, name: `doing/${sid}.md`, max: DOC_BYTE_LIMITS.QUEUE })),
];

const problems = [];

/** 与 `wc -l` 同口径：末尾换行不算多一行（否则 500 行的文件被数成 501，边界误报）。 */
function countLines(text) {
  if (text.length === 0) return 0;
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

for (const { file, name, max, why } of LIMITS) {
  if (!existsSync(file)) continue; // 缺文件不是本脚本的职责
  const text = readFileSync(file, 'utf8');
  const lines = countLines(text);
  if (lines > max) {
    problems.push(`${name} ${lines} 行 > 上限 ${max} 行（${why}）`);
  }
}

for (const { file, name, max } of BYTE_LIMITS) {
  if (!existsSync(file)) continue; // 缺文件不是本脚本的职责
  const bytes = statSync(file).size;
  if (bytes > max) {
    problems.push(
      `${name} ${(bytes / 1024).toFixed(0)}KB > 上限 ${(max / 1024).toFixed(0)}KB` +
        '（行数之外还要看字节：长表格会绕过行数门禁）',
    );
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\n体量超限。处置（按顺序试）：\n' +
      '  1. 删掉过时的内容——文档体量是成本，不是资产；\n' +
      '  2. `DONE.md` 超限：把最旧的批次整段搬进 `DONE.archive.md`（整段搬，不切半段）；\n' +
      '  3. 大表格/历史清单移到 `notes/`，主文件只留指针；\n' +
      '  4. 确实需要更长的上限：改 `.continue/hooks/lib.mjs` 的 `DOC_LIMITS` / `DOC_BYTE_LIMITS`（唯一来源）并写明理由。',
  );
  process.exit(1);
}

const summary = LIMITS.filter(({ file }) => existsSync(file))
  .map(({ name, file, max }) => {
    const lines = countLines(readFileSync(file, 'utf8'));
    return `${name} ${lines}/${max}`;
  })
  .join(' · ');
const byteSummary = BYTE_LIMITS.filter(({ file }) => existsSync(file))
  .map(({ name, file, max }) => `${name} ${(statSync(file).size / 1024).toFixed(0)}/${(max / 1024).toFixed(0)}KB`)
  .join(' · ');
console.log(`文档体量通过：\n  行数：${summary}\n  字节：${byteSummary}`);
