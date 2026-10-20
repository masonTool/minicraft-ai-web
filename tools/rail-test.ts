/**
 * 铁轨形状与弯道（批次 478，G12）
 *
 * 四块：
 *  ① 状态位（形状只占 bit0-2，`powered` 在 bit3 不受影响）；
 *  ② 放置时的自动连接（四邻 → 直轨 / 弯道）；
 *  ③ 弯道的出口方向（矿车转向的判据）；
 *  ④ 矿车真的会被掰过去（一次 tick 看速度方向）。
 */

import { Block } from '../src/core/registry/blocks.ts';
import { railTileFor } from '../src/core/registry/blocks.ts';
import { withPowered } from '../src/core/registry/blockState.ts';
import {
  RAIL_SHAPES,
  isSlopeRail,
  pickRailShape,
  pickRailSlope,
  railDirections,
  railExitDirection,
  railRiseDirection,
  railShapeOf,
  railSlopeHeight,
  withRailShape,
} from '../src/core/world/RailShape.ts';
import { meshBoxes } from '../src/core/registry/blockShapes.ts';
import { Minecart } from '../src/core/entity/Minecart.ts';
import type { EntityContext } from '../src/core/entity/Entity.ts';
import type { PhysicsWorld } from '../src/core/physics/PlayerPhysics.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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

console.log('\n[状态位：形状只占 bit0-2]');
{
  equal('默认（老存档的 state=0）读成南北向直轨', railShapeOf(0), 'north_south');
  for (const shape of RAIL_SHAPES) {
    equal(`写 ${shape} 再读回来`, railShapeOf(withRailShape(0, shape)), shape);
  }
  equal('写形状不会动 powered 位', withPowered(withRailShape(0, 'south_east'), true) & 0b1000, 0b1000);
  equal('powered 位保留时形状还在', railShapeOf(withPowered(withRailShape(0, 'south_east'), true)), 'south_east');
  // 编号 0~9 都合法（批次 481 加了 4 条坡道），真正越界的是 15（低 3 位全 1 + 高位 1）
  equal('越界的编号读成南北向（不崩）', railShapeOf(0b10111), 'north_south');
}

console.log('\n[放置时的自动连接]');
{
  const none = { north: false, south: false, east: false, west: false };
  equal('没有邻居、面朝南北 → 南北直轨', pickRailShape(none, 'z'), 'north_south');
  equal('没有邻居、面朝东西 → 东西直轨', pickRailShape(none, 'x'), 'east_west');

  equal('只有北边有轨 → 南北直轨', pickRailShape({ ...none, north: true }, 'x'), 'north_south');
  equal('只有东西两边 → 东西直轨', pickRailShape({ ...none, east: true, west: true }, 'z'), 'east_west');
  equal('南北两边 → 南北直轨', pickRailShape({ ...none, north: true, south: true }, 'x'), 'north_south');

  equal('北 + 东 → 弯道', pickRailShape({ ...none, north: true, east: true }, 'z'), 'north_east');
  equal('北 + 西 → 弯道', pickRailShape({ ...none, north: true, west: true }, 'z'), 'north_west');
  equal('南 + 东 → 弯道', pickRailShape({ ...none, south: true, east: true }, 'z'), 'south_east');
  equal('南 + 西 → 弯道', pickRailShape({ ...none, south: true, west: true }, 'z'), 'south_west');

  // 十字（四邻都有）：原版没有十字轨，这里退回直轨（之后玩家再放一格就能改）
  const cross = { north: true, south: true, east: true, west: true };
  equal('四邻都有、面朝南北 → 南北直轨（不做十字）', pickRailShape(cross, 'z'), 'north_south');
  equal('四邻都有、面朝东西 → 东西直轨', pickRailShape(cross, 'x'), 'east_west');
}

console.log('\n[弯道的出口方向]');
{
  // 弯道 se（南 + 东）：从南边进格（速度朝北）→ 往东拐
  equal('se：从南进 → 往东出', railExitDirection('south_east', 0, -1)?.dx, 1);
  equal('se：从南进 → 不出南边', railExitDirection('south_east', 0, -1)?.dz, 0);
  equal('se：从东进（速度朝西）→ 往南出', railExitDirection('south_east', -1, 0)?.dz, 1);
  equal('nw：从北进（速度朝南）→ 往西出', railExitDirection('north_west', 0, 1)?.dx, -1);
  equal('ne：从北进 → 往东出', railExitDirection('north_east', 0, 1)?.dx, 1);
  equal('sw：从南进 → 往西出', railExitDirection('south_west', 0, -1)?.dx, -1);
  equal('直轨不转向', railExitDirection('north_south', 0, -1), null);

  // 稳定性：掰过去之后再算一次，应该还是同一条边（不然矿车会在两条边之间抖）
  const first = railExitDirection('south_east', 0, -1)!;
  const second = railExitDirection('south_east', first.dx, first.dz)!;
  equal('掰过去之后再算一次仍是同一条边（不会抖）', `${second.dx},${second.dz}`, `${first.dx},${first.dz}`);
}

console.log('\n[形状 → 贴图]');
{
  equal('南北直轨用 rail', railTileFor(0), 'rail');
  equal('东西直轨用 rail_east_west', railTileFor(withRailShape(0, 'east_west')), 'rail_east_west');
  equal('弯道用各自的图', railTileFor(withRailShape(0, 'south_east')), 'rail_se');
  equal('四张弯道图都不重复', new Set(['south_east', 'south_west', 'north_east', 'north_west'].map((shape) => railTileFor(withRailShape(0, shape as never)))).size, 4);
}

console.log('\n[矿车在弯道上真的会拐]');
{
  const flatWorld: PhysicsWorld = {
    collisionAt: (_x, y) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  };
  const makeCtx = (state: number): EntityContext => ({
    world: flatWorld,
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x, y) => (y === 0 ? Block.RAIL : Block.AIR),
    getState: () => state,
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
  });

  // 从南往北开进 se 弯道：应该在**这一帧**就被掰成向东
  const cart = new Minecart(0.5, 0.05, 0.5);
  cart.vx = 0;
  cart.vz = -3;
  cart.tick(makeCtx(withRailShape(0, 'south_east')), 0.05);
  check('速度被掰到 +x（向东）', cart.vx > 0.5, `vx=${cart.vx.toFixed(2)}`);
  check('原来朝北的分量被清掉', Math.abs(cart.vz) < 0.2, `vz=${cart.vz.toFixed(2)}`);

  // 直轨上不做任何掰动
  const straight = new Minecart(0.5, 0.05, 0.5);
  straight.vx = 0;
  straight.vz = -3;
  straight.tick(makeCtx(withRailShape(0, 'north_south')), 0.05);
  check('直轨上保持南北向', Math.abs(straight.vx) < 0.2 && straight.vz < -0.5, `vx=${straight.vx.toFixed(2)} vz=${straight.vz.toFixed(2)}`);

  // 速度太小时不掰（还没开动的车不该自己转向）
  const idle = new Minecart(0.5, 0.05, 0.5);
  idle.vx = 0;
  idle.vz = 0;
  idle.tick(makeCtx(withRailShape(0, 'south_east')), 0.05);
  equal('静止的车不会被掰（速度 0）', Math.hypot(idle.vx, idle.vz) < 0.05, true);
}

console.log('\n[方向表]');
{
  const dirs = railDirections('south_east');
  equal('se 弯连接两条相邻边', dirs.length, 2);
  check('两条边不共线', dirs[0]!.dx * dirs[1]!.dx + dirs[0]!.dz * dirs[1]!.dz === 0);
  const straight = railDirections('east_west');
  check('直轨两条边相反', straight[0]!.dx * straight[1]!.dx + straight[0]!.dz * straight[1]!.dz === -1);
}


console.log('\n[坡道（批次 481）]');
{
  // ① 十种形状都能编码/解码，且 powered 位不被挤掉
  equal('一共十种形状', RAIL_SHAPES.length, 10);
  for (const shape of RAIL_SHAPES) {
    equal(`写 ${shape} 再读回来`, railShapeOf(withRailShape(0, shape)), shape);
  }
  equal(
    '坡道与 powered 共存',
    railShapeOf(withPowered(withRailShape(0, 'ascending_north'), true)),
    'ascending_north',
  );
  equal('坡道不会被读成平面形状', isSlopeRail(railShapeOf(withRailShape(0, 'ascending_east'))), true);
  equal('平面形状不是坡道', isSlopeRail(railShapeOf(withRailShape(0, 'south_east'))), false);

  // ② 抬升方向
  equal('ascending_north 朝北抬', railRiseDirection('ascending_north')?.dz, -1);
  equal('ascending_east 朝东抬', railRiseDirection('ascending_east')?.dx, 1);
  equal('平面形状没有抬升方向', railRiseDirection('east_west'), null);

  // ③ 格内高度：低端 0、高端 1、中点 0.5
  equal('坡道低端高度 0', railSlopeHeight('ascending_east', 0, 0.5), 0);
  equal('坡道高端高度 1', railSlopeHeight('ascending_east', 1, 0.5), 1);
  equal('坡道中点 0.5', railSlopeHeight('ascending_east', 0.5, 0.5), 0.5);
  equal('朝西抬：东边是低端', railSlopeHeight('ascending_west', 0, 0.5), 1);
  equal('平面形状高度恒 0', railSlopeHeight('north_south', 0.7, 0.3), 0);

  // ④ 放置时的坡道判定
  const none = { north: false, south: false, east: false, west: false };
  equal('北侧高一格 → 朝北的坡道', pickRailSlope({ ...none, north: true }, 'z'), 'ascending_north');
  equal('西侧高一格 → 朝西的坡道', pickRailSlope({ ...none, west: true }, 'x'), 'ascending_west');
  equal('没有高差 → 不是坡道', pickRailSlope(none, 'z'), null);
  equal('两侧都高（夹在沟里）→ 不是坡道', pickRailSlope({ ...none, north: true, south: true }, 'z'), null);
  equal('南北都高、东西单侧高 → 取东西那侧', pickRailSlope({ north: true, south: true, east: true, west: false }, 'x'), 'ascending_east');

  // ⑤ 几何：平面 1 个盒子、坡道 4 段且逐段抬高
  const flatBoxes = meshBoxes('rail', withRailShape(0, 'north_south'));
  equal('平面铁轨仍是 1 个薄盒', flatBoxes.length, 1);
  check('平面盒高 1/16', Math.abs(flatBoxes[0]![4] - 1 / 16) < 1e-6, `${flatBoxes[0]![4]}`);
  const slopeBoxes = meshBoxes('rail', withRailShape(0, 'ascending_east'));
  equal('坡道是 4 段阶梯', slopeBoxes.length, 4);
  check(
    '阶梯逐段抬高（东端最高）',
    slopeBoxes.every((box, index) => Math.abs(box[4] - (index + 1) / 4) < 1e-6),
    slopeBoxes.map((box) => box[4].toFixed(2)).join(','),
  );

  // ⑥ 矿车会被抬到坡面上
  const flatWorld: PhysicsWorld = {
    collisionAt: (_x, y) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  };
  const slopeCtx: EntityContext = {
    world: flatWorld,
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x, y) => (y === 0 ? Block.RAIL : Block.AIR),
    getState: () => withRailShape(0, 'ascending_east'),
    player: null,
    hurtPlayer: () => {},
    spawnDrop: () => {},
  };
  const climber = new Minecart(0.2, 0.05, 0.5);
  climber.vx = 2;
  climber.vz = 0;
  climber.tick(slopeCtx, 0.05);
  check('向东开上坡：车被抬起来', climber.y > 0.2, `y=${climber.y.toFixed(2)}`);
  check('抬升量跟着格内位置走（≈ 0.3）', Math.abs(climber.y - Math.max(0, Math.min(1, climber.x))) < 0.12, `y=${climber.y.toFixed(2)} x=${climber.x.toFixed(2)}`);
}


console.log('\n[特殊铁轨的形状贴图（批次 482）]');
{
  const prefixes = ['powered_rail', 'detector_rail', 'activator_rail'] as const;
  for (const prefix of prefixes) {
    const eastWest = railTileFor(withRailShape(0, 'east_west'), prefix);
    const corner = railTileFor(withRailShape(0, 'south_east'), prefix);
    equal(`${prefix} 东西向用 ${prefix}_east_west`, eastWest, `${prefix}_east_west`);
    equal(`${prefix} 弯道用 ${prefix}_se`, corner, `${prefix}_se`);
    equal(`${prefix} 直轨还是原图`, railTileFor(0, prefix), prefix);
  }

  // ⚠️ 每条贴图都必须在图集名单里：漏一张不会报错，只会静默回退成"没贴图"
  const missing: string[] = [];
  for (const prefix of ['rail', ...prefixes]) {
    for (const shape of RAIL_SHAPES) {
      const key = railTileFor(withRailShape(0, shape), prefix);
      if (!TILE_ORDER.includes(key)) missing.push(`${prefix}/${shape} → ${key}`);
    }
  }
  equal('四种铁轨 × 十种形状的贴图都在图集名单里', missing.length, 0);
  check('（缺的是）', missing.length === 0, missing.slice(0, 4).join(' '));

  // 坡道用直轨贴图（几何是阶梯，贴图会被拉伸成斜面）
  equal('坡道回落到直轨贴图', railTileFor(withRailShape(0, 'ascending_east')), 'rail');
}

console.log(`\n铁轨测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
