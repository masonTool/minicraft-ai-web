/**
 * 下界传送门（K8）离线测试
 *
 * 覆盖五块：
 *  1. 门方块本身：整格但无碰撞、半透明层、发光 11、**没有物品**、**挖不动**（硬度 -1）
 *  2. 框的判定：洪泛必须漫出**一个矩形**、外圈必须一整圈黑曜石；
 *     框上有洞 / 少一角 / 点到框外侧的面 / 框里已经有门 → 各自的结论
 *  3. 点燃：填满门方块、带上轴向状态、**不消耗耐久**（这一条由 main 保证，这里断言返回值）
 *  4. 传送坐标：÷8 / ×8、竖直按高度比例并夹紧、末地也去下界
 *  5. 目的地：找已有的门 / 新建门的选位（脚下要实心、框外要空）/ 框被拆掉后清门
 *  6. 站门计时：落地宽限（挡住"落地即弹回"，取代原版 15 秒冷却）
 *
 * 运行：npm run test:portal
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import { breakSeconds } from '../src/core/registry/tools.ts';
import { Item, blockDrops, dropFor, itemDef } from '../src/core/registry/items.ts';
import { blockLabel } from '../src/core/registry/itemNames.ts';
import { portalAxis, withPortalAxis } from '../src/core/registry/blockState.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import {
  NETHER_SCALE,
  NEW_PORTAL_HEIGHT,
  NEW_PORTAL_WIDTH,
  PORTAL_CREATIVE_IGNITE_TICKS,
  PORTAL_IGNITE_TICKS,
  PORTAL_LIGHT,
  PORTAL_MAX_HEIGHT,
  PORTAL_MAX_WIDTH,
  PORTAL_REENTRY_GRACE_TICKS,
  PORTAL_SEARCH_RADIUS,
  buildPortal,
  canBuildPortalAt,
  clearBrokenPortalsAround,
  findPortalNear,
  findPortalShape,
  findPortalSite,
  ignitePortal,
  portalFrame,
  portalInterior,
  portalTarget,
  shapeAt,
  stepPortalStanding,
  type PortalShape,
  type PortalStanding,
  type PortalWorld,
} from '../src/core/world/NetherPortal.ts';
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

class FakeWorld implements PortalWorld {
  readonly blocks = new Map<string, number>();
  readonly states = new Map<string, number>();

  set(x: number, y: number, z: number, id: number, state = 0): void {
    const key = `${x},${y},${z}`;
    if (id === Block.AIR) {
      this.blocks.delete(key);
      this.states.delete(key);
      return;
    }
    this.blocks.set(key, id);
    if (state !== 0) this.states.set(key, state);
    else this.states.delete(key);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? Block.AIR;
  }

  getState(x: number, y: number, z: number): number {
    return this.states.get(`${x},${y},${z}`) ?? 0;
  }

  setBlock(x: number, y: number, z: number, id: number, state = 0): boolean {
    this.set(x, y, z, id, state);
    return true;
  }

  /**
   * 在 y 处铺一层石头当"地面"（向下多铺几层）。
   * ⚠️ 必须够厚：门的底边那行黑曜石是**替换掉地表那一层**的，所以真正要支撑的是它下面那一层
   * （只铺一层薄地板的话，`canBuildPortalAt` 会判"底边下面没有实心支撑"）
   */
  floor(x0: number, x1: number, z0: number, z1: number, y: number, depth = 8): void {
    for (let dy = 0; dy < depth; dy++) {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.set(x, y - dy, z, Block.STONE);
    }
  }

  /** 搭一座竖直的门（axis='x' 时门面沿 X 展开，框在 z 固定） */
  buildFrame(shape: PortalShape): void {
    for (const [x, y, z] of portalFrame(shape)) this.set(x, y, z, Block.OBSIDIAN);
  }
}

const FRAME: PortalShape = { axis: 'x', x: 0, y: 64, z: 0, width: 2, height: 3 };

// ---------------------------------------------------------------- 1. 门方块

console.log('\n[门方块]');
{
  const def = blockDef(Block.NETHER_PORTAL);
  equal('名字是 minecraft:nether_portal', def.name, 'minicraft:nether_portal');
  check('没有碰撞体积（能走进去）', !def.solid);
  check('不遮挡邻居', !def.opaque);
  check('走半透明渲染层（紫色门面是半透明的）', def.translucent);
  equal(`自发光 ${PORTAL_LIGHT}（原版数值，比火把暗、比没有强）`, def.light, PORTAL_LIGHT);
  equal('不透光（不衰减光照）', def.lightOpacity, 0);
  check('**挖不动**（硬度 -1 → 破坏耗时无穷大）', breakSeconds(Block.NETHER_PORTAL) === Number.POSITIVE_INFINITY);
  check('门方块**没有物品**（原版也拿不到）', def.itemless && itemDef(Block.NETHER_PORTAL) === undefined);
  equal('破坏门方块不掉落任何东西', dropFor(Block.NETHER_PORTAL), null);
  // 它没有"物品"，所以用方块名去查（`itemLabel` 对没有物品的方块会返回"未知物品"）
  equal('方块的中文名是"下界传送门"', blockLabel(Block.NETHER_PORTAL), '下界传送门');
  const tiles: readonly string[] = TILE_ORDER;
  check('贴图在图集名单里', tiles.includes(def.tiles[0]));
  equal(
    '精准采集也拿不到门方块',
    blockDrops(Block.NETHER_PORTAL, { shears: false, silkTouch: true, fortune: 3, doubleSlab: false, roll: () => 0 }),
    null,
  );
}

console.log('\n[门面轴向状态位]');
{
  equal('默认是 x 轴', portalAxis(0), 'x');
  equal('置位后是 z 轴', portalAxis(withPortalAxis(0, true)), 'z');
  check('不影响其它状态位', withPortalAxis(withPortalAxis(0, true), false) === 0);
}

// ---------------------------------------------------------------- 2. 框的判定

console.log('\n[黑曜石框的判定]');
{
  // 标准的 2×3 空框：从框内任意一格空气点火都成立
  const world = new FakeWorld();
  world.buildFrame(FRAME);
  const shape = findPortalShape(world, 0, 64, 0);
  check('2×3 的空框能被认出来', shape !== null);
  equal('认出的宽度', shape?.width, 2);
  equal('认出的高度', shape?.height, 3);
  equal('认出的轴向', shape?.axis, 'x');
  check('框内每一格都能点火', portalInterior(FRAME).every(([x, y, z]) => findPortalShape(world, x, y, z) !== null));

  // 4×5 的大框（原版最大 21×21）
  const big = new FakeWorld();
  big.buildFrame({ axis: 'x', x: 0, y: 64, z: 0, width: 4, height: 5 });
  equal('4×5 的大框也成立', findPortalShape(big, 1, 66, 0)?.width, 4);

  // 竖直方向的门（门面沿 Z 展开）
  const alongZ = new FakeWorld();
  alongZ.buildFrame({ axis: 'z', x: 0, y: 64, z: 0, width: 2, height: 3 });
  equal('沿 Z 轴的门也能认出来', findPortalShape(alongZ, 0, 64, 0)?.axis, 'z');

  // 少一角 → 不成立
  const broken = new FakeWorld();
  broken.buildFrame(FRAME);
  broken.set(-1, 63, 0, Block.AIR); // 左下角那块黑曜石被敲掉
  check('框少一角就不成立', findPortalShape(broken, 0, 64, 0) === null);

  // 框上有洞（空气漫到框外）→ 不成立
  const hole = new FakeWorld();
  hole.buildFrame(FRAME);
  hole.set(2, 64, 0, Block.AIR); // 右侧框上开一个洞
  check('框上有洞就不成立（空气漫出去了）', findPortalShape(hole, 0, 64, 0) === null);

  // 太小 / 太矮不成立
  const tooSmall = new FakeWorld();
  tooSmall.buildFrame({ axis: 'x', x: 0, y: 64, z: 0, width: 1, height: 3 });
  check('只有 1 格宽不成立', findPortalShape(tooSmall, 0, 64, 0) === null);
  const tooShort = new FakeWorld();
  tooShort.buildFrame({ axis: 'x', x: 0, y: 64, z: 0, width: 2, height: 2 });
  check('只有 2 格高不成立', findPortalShape(tooShort, 0, 65, 0) === null);

  // 点在框外侧的面上（旁边是实心地层）→ 那一格不是空气也不是框内
  const outside = new FakeWorld();
  outside.buildFrame(FRAME);
  outside.set(0, 64, -1, Block.STONE);
  check('框外侧的实心处点不着', findPortalShape(outside, 0, 64, -1) === null);
  // 框外正好是空气时：洪泛出的区域不是矩形（框的背面只有一格宽），也不成立
  check('框背面的空气不构成门', findPortalShape(outside, 0, 64, 1) === null);
}

// ---------------------------------------------------------------- 3. 点燃

console.log('\n[点燃]');
{
  const world = new FakeWorld();
  world.buildFrame(FRAME);
  equal('点火结果是 lit', ignitePortal(world, 0, 64, 0), 'lit');
  check('框内全部填上了门方块', portalInterior(FRAME).every(([x, y, z]) => world.getBlock(x, y, z) === Block.NETHER_PORTAL));
  equal('门方块的数量', portalInterior(FRAME).filter(([x, y, z]) => world.getBlock(x, y, z) === Block.NETHER_PORTAL).length, 6);
  equal('门面轴向写进了状态位（沿 X 展开）', portalAxis(world.getState(0, 64, 0)), 'x');
  check('框自己没被改动', portalFrame(FRAME).every(([x, y, z]) => world.getBlock(x, y, z) === Block.OBSIDIAN));

  // 再点一次：不重复填，也不该变成"放火"
  equal('已经亮着的门再点是 exists', ignitePortal(world, 0, 64, 0), 'exists');

  // 不是黑曜石框的位置
  const nowhere = new FakeWorld();
  nowhere.floor(0, 4, 0, 4, 63);
  equal('对着普通石头点返回 none（调用方会去放火）', ignitePortal(nowhere, 1, 64, 1), 'none');

  // 沿 Z 轴的门：状态位要写 z
  const alongZ = new FakeWorld();
  alongZ.buildFrame({ axis: 'z', x: 0, y: 64, z: 0, width: 2, height: 3 });
  equal('沿 Z 轴的门也能点燃', ignitePortal(alongZ, 0, 64, 0), 'lit');
  equal('沿 Z 轴的门状态位是 z', portalAxis(alongZ.getState(0, 64, 1)), 'z');

  // 尺寸上限：22 宽不成立（原版上限 21）
  const huge = new FakeWorld();
  huge.buildFrame({ axis: 'x', x: 0, y: 64, z: 0, width: PORTAL_MAX_WIDTH + 1, height: 3 });
  check(`超过 ${PORTAL_MAX_WIDTH} 格宽不成立`, findPortalShape(huge, 0, 64, 0) === null);
  const tall = new FakeWorld();
  tall.buildFrame({ axis: 'x', x: 0, y: 64, z: 0, width: 2, height: PORTAL_MAX_HEIGHT + 1 });
  check(`超过 ${PORTAL_MAX_HEIGHT} 格高不成立`, findPortalShape(tall, 0, 64, 0) === null);
}

// ---------------------------------------------------------------- 4. 传送坐标

console.log('\n[传送坐标换算]');
{
  const toNether = portalTarget(Dimension.OVERWORLD, 800, 64, -400);
  equal('主世界 → 下界的维度', toNether.dimension, Dimension.NETHER);
  equal('水平坐标 ÷8', toNether.x, 800 / NETHER_SCALE);
  equal('z 也是 ÷8', toNether.z, -400 / NETHER_SCALE);
  equal('y=64 换算到 43（原版的高度比例）', toNether.y, 43);

  const back = portalTarget(Dimension.NETHER, 100, 43, -50);
  equal('下界 → 主世界的维度', back.dimension, Dimension.OVERWORLD);
  equal('水平坐标 ×8', back.x, 800);
  equal('z 也是 ×8', back.z, -400);
  equal('y=43 换算回 65', back.y, 65);

  check('下界里的超高 y 被夹到可落区间', portalTarget(Dimension.NETHER, 0, 400, 0).y <= 300);
  check('下界里去主世界的 y 不会是 NaN', Number.isFinite(portalTarget(Dimension.NETHER, 0, 0, 0).y));
  check('主世界的 y 落在下界可用区间内', portalTarget(Dimension.OVERWORLD, 0, -60, 0).y >= -54);
  check('主世界最高处也夹在下界洞顶之下', portalTarget(Dimension.OVERWORLD, 0, 300, 0).y <= 104);

  // 末地：原版 `getPortalDestination` 是「在下界就去主世界，**否则都去下界**」
  const fromEnd = portalTarget(Dimension.END, 80, 66, 40);
  equal('末地的传送门也通往下界（原版规则）', fromEnd.dimension, Dimension.NETHER);
  equal('末地 → 下界的水平坐标同样 ÷8', fromEnd.x, 10);
}

// ---------------------------------------------------------------- 5. 目的地

console.log('\n[目的地：找已有的门]');
{
  const world = new FakeWorld();
  world.buildFrame(FRAME);
  ignitePortal(world, 0, 64, 0);

  const found = findPortalNear(world, 4, 64, 4);
  check('附近的门能找到', found !== null);
  equal('找到的门宽度', found?.width, 2);
  check('30 格外找不到（搜索半径 16）', findPortalNear(world, 30, 64, 30) === null);
  check('半径参数可以放宽（调试/大范围搜索）', findPortalNear(world, 30, 64, 30, PORTAL_SEARCH_RADIUS + 20) !== null);

  // 竖直方向太远的也找不到（±24）
  check('竖直超过搜索高度就找不到', findPortalNear(world, 0, 64 + 40, 0) === null);

  // 两座门取更近的那一座
  const two = new FakeWorld();
  two.buildFrame({ axis: 'x', x: 0, y: 64, z: 0, width: 2, height: 3 });
  ignitePortal(two, 0, 64, 0);
  two.buildFrame({ axis: 'x', x: 20, y: 64, z: 0, width: 2, height: 3 });
  ignitePortal(two, 20, 64, 0);
  equal('取更近的那一座门', findPortalNear(two, 18, 64, 0)?.x, 20);
  equal('从另一侧看取到的是左边那座', findPortalNear(two, 2, 64, 0)?.x, 0);

  // 拆掉左边那座的**底角**（与门方块只在对角上相邻，最容易漏判）
  const left: PortalShape = { axis: 'x', x: 0, y: 64, z: 0, width: 2, height: 3 };
  two.set(-1, 63, 0, Block.AIR);
  const cleared = clearBrokenPortalsAround(two, -1, 63, 0);
  equal('敲掉框的底角也能把整片门清掉', cleared.length, 6);
  check('左边那座的框内已经空了', portalInterior(left).every(([x, y, z]) => two.getBlock(x, y, z) === Block.AIR));
  check('左边那座不再被找到', findPortalNear(two, 1, 64, 0) === null);
  equal('右边那座不受影响', findPortalNear(two, 20, 64, 0)?.x, 20);
}

console.log('\n[目的地：新建一座门]');
{
  // 一片石头地面，目标点就在地面上方
  const world = new FakeWorld();
  world.floor(-20, 20, -20, 20, 63);

  check('内空 2×3 且脚下实心时可以放', canBuildPortalAt(world, 0, 64, 0, 'x'));
  const site = findPortalSite(world, 0, 64, 0, 'x', Dimension.OVERWORLD);
  check('能找到一块地方建门', site !== null);
  equal('新建的门是 2 宽', site?.width, NEW_PORTAL_WIDTH);
  equal('新建的门是 3 高', site?.height, NEW_PORTAL_HEIGHT);
  equal('优先贴着目标高度放', site?.y, 64);

  // 建出来之后是一座完整的门
  check('建门成功', site !== null && buildPortal(world, site!));
  check('框是黑曜石', portalFrame(site!).every(([x, y, z]) => world.getBlock(x, y, z) === Block.OBSIDIAN));
  check('框内是门方块', portalInterior(site!).every(([x, y, z]) => world.getBlock(x, y, z) === Block.NETHER_PORTAL));
  check('建好的门能被识别', shapeAt(world, site!.x, site!.y, site!.z) !== null);

  // 底边下面没有实心 → 不能建（门不会悬空、玩家不会从门里掉出去）
  const air = new FakeWorld();
  check('脚下是空气时不能建（门不会浮空）', !canBuildPortalAt(air, 0, 64, 0, 'x'));
  const thin = new FakeWorld();
  thin.floor(-20, 20, -20, 20, 63, 1); // 只有薄薄一层
  check('底边下面只有一层薄地板时不能建', !canBuildPortalAt(thin, 0, 64, 0, 'x'));

  // 原地被占住（框内那一格是石头）→ 换到附近去（通常就是往上挪一格，坐在那块石头上），
  // 且新位置一定是一座合法的门、绝不会把那块石头"包"进门里
  const blocked = new FakeWorld();
  blocked.floor(-20, 20, -20, 20, 63);
  blocked.set(0, 64, 0, Block.STONE);
  const moved = findPortalSite(blocked, 0, 64, 0, 'x', Dimension.OVERWORLD);
  check('原地被占住时会在附近另找一处', moved !== null);
  check(
    '换的地方依然是一座能建的门',
    moved !== null && canBuildPortalAt(blocked, moved.x, moved.y, moved.z, moved.axis),
  );
  check(
    '换的地方没有把那块石头包进门里',
    moved !== null && !portalInterior(moved).some(([x, y, z]) => x === 0 && y === 64 && z === 0),
  );

  // 偏好轴向放不下 → 换另一个轴向（原版也是按"哪边有地方"挑轴向）
  const narrow = new FakeWorld();
  narrow.floor(-2, 2, -2, 2, 63);
  // 在 x=-1 与 x=2 堆起立柱位置上的石头：沿 X 的门放不下，沿 Z 的门不受影响
  for (let y = 64; y <= 66; y++) {
    for (let z = -2; z <= 2; z++) {
      narrow.set(-1, y, z, Block.STONE);
      narrow.set(2, y, z, Block.STONE);
    }
  }
  const otherAxis = findPortalSite(narrow, 0, 64, 0, 'x', Dimension.OVERWORLD);
  equal('沿 X 放不下时会换成长 Z 的门', otherAxis?.axis, 'z');

  // 底边那一行可以替换地表方块（原版的门就是坐在地表上的）
  const onSurface = new FakeWorld();
  onSurface.floor(-4, 4, -4, 4, 63);
  check('底边替换地表方块是允许的（门坐在地表上）', canBuildPortalAt(onSurface, 0, 64, 0, 'x'));
  check('立柱位置被实心占住就不行（门不能埋在土里）', !canBuildPortalAt(onSurface, 0, 63, 0, 'x'));

  // 目标高度埋在实心岩层里 → 兜底扫描也要能找到地方
  const buried = new FakeWorld();
  buried.floor(-20, 20, -20, 20, 63);
  for (let y = 64; y <= 80; y++) for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) buried.set(x, y, z, Block.STONE);
  const fallback = findPortalSite(buried, 0, 70, 0, 'x', Dimension.OVERWORLD);
  check('目标点整片实心时也能退到附近建门', fallback !== null);

  // 根本没有地面 → 放弃（由调用方把人放在目标坐标上）
  const void_ = new FakeWorld();
  check('完全没有落脚点时放弃建门', findPortalSite(void_, 0, 64, 0, 'x', Dimension.OVERWORLD) === null);
}

console.log('\n[框被拆掉之后清门]');
{
  const world = new FakeWorld();
  world.buildFrame(FRAME);
  ignitePortal(world, 0, 64, 0);

  const kept = clearBrokenPortalsAround(world, 5, 64, 5); // 旁边随便敲一块，与门无关
  equal('敲与门无关的方块时门不受影响', kept.length, 0);
  check('门还在', world.getBlock(0, 64, 0) === Block.NETHER_PORTAL);

  // 敲掉框左下角那一块黑曜石（门方块从框内变成"没有框的门"）
  world.set(-1, 63, 0, Block.AIR);
  const removed = clearBrokenPortalsAround(world, -1, 63, 0);
  equal('框破了之后整片门被清掉（6 格）', removed.length, 6);
  check('门内已经没有门方块', portalInterior(FRAME).every(([x, y, z]) => world.getBlock(x, y, z) === Block.AIR));
  check('返回的是被清掉的坐标（联机要广播）', removed.every(([x, y]) => x <= 1 && y >= 64 && y <= 66));

  // 框还完整时不该被清
  const intact = new FakeWorld();
  intact.buildFrame(FRAME);
  ignitePortal(intact, 0, 64, 0);
  equal('框完整时不会被误清', clearBrokenPortalsAround(intact, -1, 63, 0).length, 0);
}

console.log('\n[站门计时：落地宽限]');
{
  const state: PortalStanding = { ticks: 0, locked: false, lockedTicks: 0 };
  check('不在门里时不计时、也不传', !stepPortalStanding(state, false, PORTAL_IGNITE_TICKS) && state.ticks === 0);

  // 普通模式：站满 80 tick 才传（这一条是原来就有的手感，别在改宽限时弄丢）
  let traveledAt = 0;
  for (let i = 1; i <= PORTAL_IGNITE_TICKS; i++) {
    if (stepPortalStanding(state, true, PORTAL_IGNITE_TICKS)) {
      traveledAt = i;
      break;
    }
  }
  equal('普通模式站满 80 tick（4 秒）才传', traveledAt, PORTAL_IGNITE_TICKS);
  equal('传送之后计时归零', state.ticks, 0);

  // 刚落地：宽限期内不会被弹回去（否则一落地就被弹回原维度）
  state.ticks = 0;
  state.locked = true;
  state.lockedTicks = 0;
  let bouncedDuringGrace = false;
  for (let i = 1; i <= PORTAL_REENTRY_GRACE_TICKS; i++) {
    if (stepPortalStanding(state, true, PORTAL_IGNITE_TICKS, PORTAL_REENTRY_GRACE_TICKS)) {
      bouncedDuringGrace = true;
    }
  }
  check('落地宽限内站在门里不会被弹回去', !bouncedDuringGrace);
  check('宽限走完就解除', !state.locked);
  equal('宽限最后一 tick 开始计入站门', state.ticks, 1);

  // ⚠️ 这是批次 329 的回归点：宽限过后**站着不动**也必须能折返，
  // 否则玩家回到主世界后站在门里会以为"传送门坏了"
  let counted = state.ticks;
  while (!stepPortalStanding(state, true, PORTAL_IGNITE_TICKS, PORTAL_REENTRY_GRACE_TICKS)) counted++;
  equal('宽限过后站着不动，站满 80 tick 也能折返', counted + 1, PORTAL_IGNITE_TICKS);

  // 走出去再进来：立刻按正常节奏计时（不吃宽限）
  state.ticks = 0;
  state.locked = true;
  state.lockedTicks = 0;
  stepPortalStanding(state, false, PORTAL_IGNITE_TICKS, PORTAL_REENTRY_GRACE_TICKS);
  check('走出门立刻解除宽限', !state.locked);
  let afterReentry = 0;
  while (!stepPortalStanding(state, true, PORTAL_IGNITE_TICKS, PORTAL_REENTRY_GRACE_TICKS)) afterReentry++;
  equal('再进来直接站满 80 tick（不用再等宽限）', afterReentry + 1, PORTAL_IGNITE_TICKS);

  // 创造模式：1 tick 就传，但落地宽限同样生效
  const creative: PortalStanding = { ticks: 0, locked: false, lockedTicks: 0 };
  check(
    '创造模式 1 tick 就传',
    stepPortalStanding(creative, true, PORTAL_CREATIVE_IGNITE_TICKS, PORTAL_REENTRY_GRACE_TICKS),
  );
  const creativeLocked: PortalStanding = { ticks: 0, locked: true, lockedTicks: 0 };
  check(
    '创造模式落地宽限内同样不会弹回',
    !stepPortalStanding(creativeLocked, true, PORTAL_CREATIVE_IGNITE_TICKS, PORTAL_REENTRY_GRACE_TICKS),
  );
  stepPortalStanding(creativeLocked, false, PORTAL_CREATIVE_IGNITE_TICKS, PORTAL_REENTRY_GRACE_TICKS);
  check(
    '创造模式走出门后只需 1 tick',
    stepPortalStanding(creativeLocked, true, PORTAL_CREATIVE_IGNITE_TICKS, PORTAL_REENTRY_GRACE_TICKS),
  );
}

console.log('\n[常量与手感数值]');
{
  equal('站门 4 秒（80 tick）', PORTAL_IGNITE_TICKS, 80);
  equal('创造模式 1 tick', PORTAL_CREATIVE_IGNITE_TICKS, 1);
  equal('落地宽限 2 秒（40 tick）', PORTAL_REENTRY_GRACE_TICKS, 40);
  equal('水平缩放 1:8', NETHER_SCALE, 8);
  equal('门方块没有对应物品（与 I12 的火焰同一条规矩）', itemDef(Block.NETHER_PORTAL), undefined);
  check('打火石仍然在（点门要用它）', itemDef(Item.FLINT_AND_STEEL) !== undefined);
  // 门框要用黑曜石砌，而黑曜石要钻石镐才挖得动——这两件事一起决定了"做传送门很难"
  check('黑曜石徒手挖要 1 分钟以上', breakSeconds(Block.OBSIDIAN) > 60);
}

console.log(`\n下界传送门测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
