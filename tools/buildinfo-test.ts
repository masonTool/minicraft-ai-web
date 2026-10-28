/**
 * 首页构建版本信息（批次 182）
 *
 * 用户要求：首页能看到"当前是哪个版本"（编译时间 + 提交信息）。
 * 这里钉住三件事：
 *  1. 正常构建时两个值都显示；
 *  2. 时间解析失败 / 没有时间时**只显示提交**，不能出现 `构建 Invalid Date`；
 *  3. Node 里没有 Vite 的 `define` 时，`readBuildInfo()` 要安全回退（不抛异常）。
 *
 * 运行：npm run test:buildinfo
 */

import { formatBuildInfo, formatLocalTime, readBuildInfo } from '../web/src/game/buildInfo.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

console.log('\n[一、时间格式化]');
{
  equal('空时间 → 空串（不显示"构建 "）', formatLocalTime(''), '');
  equal('非法时间 → 空串', formatLocalTime('not-a-date'), '');
  const formatted = formatLocalTime('2026-10-18T02:03:00.000Z');
  check('合法 ISO → YYYY-MM-DD HH:mm', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(formatted), formatted);
  // 本地时区不同会得到不同的小时，但"日期是 10-17 或 10-18"是确定的
  check('日期取自构建那一刻（时区偏移最多差一天）', /^2026-10-1[78]/.test(formatted), formatted);
  check('分钟保留、秒被截掉', formatted.endsWith(':03'), formatted);
}

console.log('\n[二、整行文案]');
{
  equal(
    '有时间：构建时间 + 提交',
    formatBuildInfo({ commit: 'abc1234 修背包', buildTime: '2026-10-18T02:03:00.000Z' }),
    `构建 ${formatLocalTime('2026-10-18T02:03:00.000Z')} · abc1234 修背包`,
  );
  equal(
    '没有时间：只显示提交（不能出现 undefined/Invalid Date）',
    formatBuildInfo({ commit: 'abc1234 修背包', buildTime: '' }),
    'abc1234 修背包',
  );
  equal(
    '提交为空：回退 unknown',
    formatBuildInfo({ commit: '   ', buildTime: '' }),
    'unknown',
  );
  check('提交标题原样保留（含中文与空格）', formatBuildInfo({ commit: 'deadbee 首页加版本号', buildTime: '' }).includes('首页加版本号'));
}

console.log('\n[三、没有 Vite define 时的回退]');
{
  const info = readBuildInfo();
  equal('Node 里提交回退 unknown', info.commit, 'unknown');
  equal('Node 里时间为空串', info.buildTime, '');
  check('回退后仍然能格式化', formatBuildInfo(info) === 'unknown');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
