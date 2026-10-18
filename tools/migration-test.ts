/**
 * 存档迁移框架离线测试（C8，批次 193）
 *
 * 迁移是"**读档时唯一会动玩家数据的地方**"，所以这一套盯四件事：
 *
 *  1. **链本身是自洽的**：版本号连续、每一步只 +1、说明非空（漏一条的症状是"老存档读不出来"）；
 *  2. **v1 → v2 的那条规则**：`flying === true` → 创造，否则生存；已有 `gameMode` 不动；
 *  3. **不该动的不动**：最新版原样返回、迁移不改入参、幂等（同一份跑两次结果一样）；
 *  4. **明确拒绝**：比自己新的版本、缺步骤、脏数据 → null（调用方按"读不出玩家"处理）。
 *
 * 运行：npm run test:migration
 */

import { PLAYER_MIGRATIONS, SAVE_VERSION, migratePlayer } from '../src/core/save/SaveMigrations.ts';

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

/** 一份最小的"老存档玩家数据"（v1：没有 gameMode） */
function v1Player(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    x: 8,
    y: 66,
    z: -12,
    yaw: 0.5,
    pitch: -0.2,
    dimension: 'overworld',
    flying: false,
    timeOfDay: 1200,
    health: 20,
    food: 20,
    saturation: 5,
    air: 300,
    exhaustion: 0,
    inventory: [],
    selectedSlot: 0,
    dragonDefeated: false,
    ...extra,
  };
}

console.log('\n[版本与迁移链]');
{
  equal('当前存档版本是 2', SAVE_VERSION, 2);
  check('至少有一条迁移规则', PLAYER_MIGRATIONS.length >= 1);

  let contiguous = true;
  for (let i = 0; i < PLAYER_MIGRATIONS.length; i++) {
    const step = PLAYER_MIGRATIONS[i]!;
    if (step.to !== step.from + 1) contiguous = false;
    // 链必须从 1 开始，且中间不断
    if (step.from !== i + 1) contiguous = false;
    if (step.note.trim().length === 0) contiguous = false;
  }
  check('规则从 v1 开始、每条只 +1、说明非空、中间不断', contiguous);
  equal('最后一条刚好升到当前版本', PLAYER_MIGRATIONS[PLAYER_MIGRATIONS.length - 1]?.to, SAVE_VERSION);
}

console.log('\n[v1 → v2：gameMode]');
{
  const creative = migratePlayer(v1Player({ flying: true }), 1);
  check('迁移成功', creative !== null);
  equal('飞着的老存档 → 创造', creative?.player.gameMode, 'creative');
  equal('跑了一次规则', creative?.applied.length, 1);
  equal('起点 / 终点', `${creative?.from}→${creative?.to}`, '1→2');

  const survival = migratePlayer(v1Player({ flying: false }), 1);
  equal('不会飞的老存档 → 生存', survival?.player.gameMode, 'survival');

  const missing = migratePlayer(v1Player(), 1);
  equal('连 flying 都没有 → 生存（缺省值）', missing?.player.gameMode, 'survival');

  const already = migratePlayer(v1Player({ gameMode: 'survival', flying: true }), 1);
  equal('已经有 gameMode 的就不覆盖（哪怕是飞着）', already?.player.gameMode, 'survival');

  // 其余字段一个都不能丢
  const kept = migratePlayer(v1Player({ flying: true, health: 7, x: -30 }), 1);
  equal('血量跟着走', kept?.player.health, 7);
  equal('坐标跟着走', kept?.player.x, -30);
  equal('flying 字段本身也保留（飞行状态还要用）', kept?.player.flying, true);

  // 不改入参
  const original = v1Player({ flying: true });
  migratePlayer(original, 1);
  equal('迁移不改调用方手里那份（没有被塞进 gameMode）', original.gameMode, undefined);
}

console.log('\n[最新版：原样通过]');
{
  const latest = migratePlayer(v1Player({ gameMode: 'creative' }), SAVE_VERSION);
  check('能读', latest !== null);
  equal('一条规则都不用跑', latest?.applied.length, 0);
  equal('gameMode 没被动', latest?.player.gameMode, 'creative');

  // 幂等：迁移过的再迁一次，结果一样
  const once = migratePlayer(v1Player({ flying: true }), 1);
  const twice = migratePlayer(once?.player, SAVE_VERSION);
  equal('再迁一次跑 0 条规则', twice?.applied.length, 0);
  equal('结果一致', twice?.player.gameMode, 'creative');
}

console.log('\n[该拒绝的]');
{
  equal('比程序新的版本 → null', migratePlayer(v1Player(), SAVE_VERSION + 1), null);
  equal('v0 不存在 → null', migratePlayer(v1Player(), 0), null);
  equal('负数版本 → null', migratePlayer(v1Player(), -3), null);
  equal('NaN 版本 → null', migratePlayer(v1Player(), Number.NaN), null);

  equal('玩家数据是 null → null', migratePlayer(null, 1), null);
  equal('玩家数据是字符串 → null', migratePlayer('player', 1), null);
  equal('玩家数据是数组 → null', migratePlayer([], 1), null);
  equal('玩家数据是数字 → null', migratePlayer(42, 1), null);
}

console.log(`\n迁移测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
