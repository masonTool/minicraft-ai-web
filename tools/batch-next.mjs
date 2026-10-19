#!/usr/bin/env node
/**
 * 批次编号分配器（批次 337）
 *
 * 痛点：已有三次撞号（272~283 / 295~296 / 303 被并发会话占用），
 * 原因是编号靠人记、两条会话各写各的。
 * 这里把"下一个号"收进 `.codebuddy/batch-seq` 一个自增文件：
 *
 *   npm run batch:next          # 分配下一个号（自增并写回）
 *   npm run batch:next -- --peek  # 只看当前号，不自增
 *
 * ⚠️ 分配之后**立即**把号写进提交信息与批次记录；如果中途放弃，
 * 把 batch-seq 改回去即可（只有一个数字，不存在冲突合并）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../.codebuddy/batch-seq', import.meta.url);
const peek = process.argv.includes('--peek');

/** 上一批的正式编号（仓库内已知最大值）。首次运行且没有 seq 文件时用它当起点 */
const FALLBACK_LAST = 333;

let last = FALLBACK_LAST;
if (existsSync(FILE)) {
  const raw = Number(readFileSync(FILE, 'utf8').trim());
  if (Number.isFinite(raw) && raw > 0) last = raw;
}

const next = peek ? last + 1 : last + 1;
if (!peek) writeFileSync(FILE, `${next}\n`);
console.log(`${next}`);
