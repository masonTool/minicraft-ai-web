/**
 * 游戏规则（批次 488：两条规则跟上已实现的功能）
 *
 * 三块：
 *  ① 默认值覆盖每一个字段（新加规则忘了给默认值，`normalizeGameRules` 会静默把它变成 undefined）；
 *  ② 两条新规则（`doPatrolSpawning` / `commandBlockOutput`）的默认值与含义；
 *  ③ `shouldEchoCommandResult`（命令方块的输出与玩家手打的输出分开控制）四态。
 *
 * 老存档兼容也在这一层验：`normalizeGameRules` 是按**默认值的键**遍历的，
 * 所以缺字段的旧存档读进来时新规则会保持默认（而不是 undefined）。
 */

import {
  DEFAULT_GAME_RULES,
  normalizeGameRules,
  shouldEchoCommandResult,
  type GameRules,
} from '../web/src/core/world/Rules.ts';

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

console.log('\n[默认值：每个字段都有值]');
{
  const missing = Object.entries(DEFAULT_GAME_RULES).filter(([, value]) => value === undefined);
  equal('没有 undefined 的默认值', missing.length, 0);
  check(
    '默认值只有布尔与数字两种类型',
    Object.values(DEFAULT_GAME_RULES).every((value) => typeof value === 'boolean' || typeof value === 'number'),
  );
  check('规则数量在 20 条以上（1.18 的常用集合）', Object.keys(DEFAULT_GAME_RULES).length >= 20, `${Object.keys(DEFAULT_GAME_RULES).length} 条`);
}

console.log('\n[批次 488 的两条新规则]');
{
  equal('doPatrolSpawning 默认开', DEFAULT_GAME_RULES.doPatrolSpawning, true);
  equal('commandBlockOutput 默认开', DEFAULT_GAME_RULES.commandBlockOutput, true);
  // 与相邻规则的分工（写错会变成"关了一条不相关的"）
  equal('disableRaids 是另一条（管袭击，不管巡逻队）', DEFAULT_GAME_RULES.disableRaids, false);
  equal('sendCommandFeedback 是另一条（管玩家手打）', DEFAULT_GAME_RULES.sendCommandFeedback, true);
}

console.log('\n[命令输出该不该回显]');
{
  const base = { ...DEFAULT_GAME_RULES };
  equal('玩家手打 + 都开 → 回显', shouldEchoCommandResult(base, false), true);
  equal('命令方块 + 都开 → 回显', shouldEchoCommandResult(base, true), true);

  const silentPlayer: GameRules = { ...base, sendCommandFeedback: false };
  equal('关掉 sendCommandFeedback：玩家手打不回显', shouldEchoCommandResult(silentPlayer, false), false);
  equal('关掉 sendCommandFeedback：命令方块**照旧**回显（两条规则互不影响）', shouldEchoCommandResult(silentPlayer, true), true);

  const silentBlock: GameRules = { ...base, commandBlockOutput: false };
  equal('关掉 commandBlockOutput：命令方块不回显', shouldEchoCommandResult(silentBlock, true), false);
  equal('关掉 commandBlockOutput：玩家手打**照旧**回显', shouldEchoCommandResult(silentBlock, false), true);
}

console.log('\n[老存档兼容：缺字段就用默认值]');
{
  // 老存档里没有这两条规则
  const legacy = { keepInventory: true, randomTickSpeed: 5 };
  const normalized = normalizeGameRules(legacy);
  equal('老存档能读进来', normalized.keepInventory, true);
  equal('老存档里的数字规则保留', normalized.randomTickSpeed, 5);
  equal('缺的 doPatrolSpawning 回落到默认（true）', normalized.doPatrolSpawning, true);
  equal('缺的 commandBlockOutput 回落到默认（true）', normalized.commandBlockOutput, true);
  equal('一个字段都不少', Object.keys(normalized).length, Object.keys(DEFAULT_GAME_RULES).length);

  // 脏数据：类型不对就不认，保持默认
  const dirty = normalizeGameRules({ doPatrolSpawning: 'yes', commandBlockOutput: 1 });
  equal('字符串不当布尔', dirty.doPatrolSpawning, true);
  equal('数字不当布尔', dirty.commandBlockOutput, true);

  equal('null 也能读（全默认）', normalizeGameRules(null).doPatrolSpawning, true);
  equal('不是对象也能读（全默认）', normalizeGameRules('oops').commandBlockOutput, true);

  // 数字规则会被夹到 0~100（与既有行为一致）
  equal('数字规则上限 100', normalizeGameRules({ randomTickSpeed: 999 }).randomTickSpeed, 100);
  equal('数字规则下限 0', normalizeGameRules({ randomTickSpeed: -5 }).randomTickSpeed, 0);
}

console.log(`\n游戏规则测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
