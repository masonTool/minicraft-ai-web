/**
 * 铁傀儡召唤（批次 472，J24 的前半）
 *
 * 判据是"南瓜 + 一竖一横 4 块铁块"。这里只测**形状判定**（纯函数）：
 * 摆法、缺块、方向、以及"村庄守卫"的 3 村民门槛。
 */

import { Block } from '../web/src/core/registry/blocks.ts';
import { ironGolemPatternAt, shouldSpawnVillageGolem } from '../web/src/core/world/GolemSummon.ts';
import { GUARD_RANGE, nearestHostileTarget } from '../web/src/core/world/GuardAI.ts';

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

/** 用一张 Map 当世界：没写的格子都是空气 */
function worldOf(cells: Array<[number, number, number, number]>): (x: number, y: number, z: number) => number {
  const map = new Map<string, number>();
  for (const [x, y, z, id] of cells) map.set(`${x},${y},${z}`, id);
  return (x, y, z) => map.get(`${x},${y},${z}`) ?? Block.AIR;
}

/** 一竖一横的标准摆法；`axis` 决定底下那排朝哪边 */
function golemCells(axis: 'x' | 'z', sign = 1): Array<[number, number, number, number]> {
  const dx = axis === 'x' ? sign : 0;
  const dz = axis === 'z' ? sign : 0;
  return [
    [0, 10, 0, Block.PUMPKIN], // 头
    [0, 9, 0, Block.IRON_BLOCK], // 中间
    [-dx, 8, -dz, Block.IRON_BLOCK], // 左
    [0, 8, 0, Block.IRON_BLOCK], // 中
    [dx, 8, dz, Block.IRON_BLOCK], // 右
  ];
}

console.log('\n[铁傀儡的四种摆法]');
{
  for (const axis of ['x', 'z'] as const) {
    for (const sign of [1, -1]) {
      const pattern = ironGolemPatternAt(worldOf(golemCells(axis, sign)), 0, 10, 0, Block.PUMPKIN, Block.IRON_BLOCK);
      equal(`${axis} 方向（${sign > 0 ? '正' : '负'}）能认出来`, pattern?.axis, axis);
      equal('返回的坐标就是头那一格', `${pattern?.x},${pattern?.y},${pattern?.z}`, '0,10,0');
    }
  }
}

console.log('\n[不成立的摆法]');
{
  // 缺底部侧边一块
  const missingSide = golemCells('x').filter((_cell, index) => index !== 2);
  equal(
    '缺一块铁块不召唤',
    ironGolemPatternAt(worldOf(missingSide as Array<[number, number, number, number]>), 0, 10, 0, Block.PUMPKIN, Block.IRON_BLOCK),
    null,
  );

  // 缺中间那块（y-1）
  const missingMiddle = [
    [0, 10, 0, Block.PUMPKIN],
    [-1, 8, 0, Block.IRON_BLOCK],
    [0, 8, 0, Block.IRON_BLOCK],
    [1, 8, 0, Block.IRON_BLOCK],
  ] as Array<[number, number, number, number]>;
  equal(
    '头下面没有铁块不召唤',
    ironGolemPatternAt(worldOf(missingMiddle), 0, 10, 0, Block.PUMPKIN, Block.IRON_BLOCK),
    null,
  );

  // 只有三块（最上面是铁块不是南瓜）
  const ironOnTop = golemCells('x').map((cell) => [cell[0], cell[1], cell[2], Block.IRON_BLOCK]) as Array<
    [number, number, number, number]
  >;
  equal(
    '顶上不是南瓜不召唤',
    ironGolemPatternAt(worldOf(ironOnTop), 0, 10, 0, Block.PUMPKIN, Block.IRON_BLOCK),
    null,
  );

  // 底部那排被一块石头断掉
  const brokenRow: Array<[number, number, number, number]> = [
    [0, 10, 0, Block.PUMPKIN],
    [0, 9, 0, Block.IRON_BLOCK],
    [-1, 8, 0, Block.IRON_BLOCK],
    [0, 8, 0, Block.STONE],
    [1, 8, 0, Block.IRON_BLOCK],
  ];
  equal(
    '底排中间是石头不召唤',
    ironGolemPatternAt(worldOf(brokenRow), 0, 10, 0, Block.PUMPKIN, Block.IRON_BLOCK),
    null,
  );

  equal(
    '全空的世界不召唤',
    ironGolemPatternAt(worldOf([]), 0, 10, 0, Block.PUMPKIN, Block.IRON_BLOCK),
    null,
  );
}

console.log('\n[村庄守卫的门槛]');
{
  check('3 个村民、没有傀儡 → 生成', shouldSpawnVillageGolem(3, 0));
  check('4 个村民也行', shouldSpawnVillageGolem(4, 0));
  check('只有 2 个村民 → 不生成', !shouldSpawnVillageGolem(2, 0));
  check('已经有一只傀儡 → 不再生成（否则每加载一次多一只）', !shouldSpawnVillageGolem(6, 1));
  check('傀儡上限可以调（测试/以后做多村庄时用）', shouldSpawnVillageGolem(6, 1, 2));
  check('一个村民都没有 → 不生成', !shouldSpawnVillageGolem(0, 0));
}


console.log('\n[守卫的目标选择（批次 474）]');
{
  /** 造一个候选：只要 x/z/type.id/dead 四样（Mob 天然满足这个形状） */
  const at = (id: string, x: number, z: number, dead = false) => ({ x, y: 64, z, type: { id }, dead });
  const hostile = (m: { type: { id: string } }): boolean => m.type.id !== 'villager';

  const near = at('zombie', 3, 0);
  const far = at('skeleton', 10, 0);
  equal('最近的优先', nearestHostileTarget({ x: 0, y: 64, z: 0 }, [far, near], GUARD_RANGE, hostile)?.target.type.id, 'zombie');
  equal(
    '超出半径的不算',
    nearestHostileTarget({ x: 0, y: 64, z: 0 }, [at('zombie', 20, 0)], GUARD_RANGE, hostile),
    null,
  );
  equal(
    '死的不算',
    nearestHostileTarget({ x: 0, y: 64, z: 0 }, [at('zombie', 2, 0, true)], GUARD_RANGE, hostile),
    null,
  );
  equal(
    '非敌对（村民）不算',
    nearestHostileTarget({ x: 0, y: 64, z: 0 }, [at('villager', 2, 0)], GUARD_RANGE, hostile),
    null,
  );
  equal('一个候选都没有 → null', nearestHostileTarget({ x: 0, y: 64, z: 0 }, [], GUARD_RANGE, hostile), null);

  // 距离并列 → 按 type.id 定序（否则守卫会在两只僵尸之间来回抖）
  const a = at('zombie', 4, 0);
  const b = at('creeper', 0, 4);
  const first = nearestHostileTarget({ x: 0, y: 64, z: 0 }, [a, b], GUARD_RANGE, hostile);
  const second = nearestHostileTarget({ x: 0, y: 64, z: 0 }, [b, a], GUARD_RANGE, hostile);
  equal('并列时按 type.id 定序（与遍历顺序无关）', first?.target.type.id, 'creeper');
  equal('换个顺序结果一致', second?.target.type.id, first?.target.type.id);

  // 水平距离：目标在半空不该被算得更远
  const overhead = { x: 2, y: 90, z: 0, type: { id: 'zombie' }, dead: false };
  equal('按水平距离算（半空的不吃亏）', nearestHostileTarget({ x: 0, y: 64, z: 0 }, [overhead], GUARD_RANGE, hostile)?.distance, 2);
}

console.log(`\n铁傀儡测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
