/**
 * 火焰与打火石（I12）离线测试
 *
 * 覆盖四块：
 *  1. 火焰方块本身：形状（cross）、无碰撞、发光 15、**没有物品**、硬度 0（一拍即灭）
 *  2. 可燃方块表与"能不能放火"的判定（打火石的两条活路）
 *  3. 随机刻：蔓延 / 烧掉燃料 / 没燃料熄灭 / 被水浇灭 / 被雨浇灭
 *  4. 玩家侧：站在火里被点燃 → 每 20 tick 掉 1 点、离开后继续烧、抗火免疫、重生清空
 *
 * 运行：npm run test:fire
 */

import { Block, blockDef } from '../web/src/core/registry/blocks.ts';
import { breakSeconds } from '../web/src/core/registry/tools.ts';
import { Item, blockDrops, dropFor, itemDef, maxStackOf, durabilityOf } from '../web/src/core/registry/items.ts';
import { itemLabel } from '../web/src/core/registry/itemNames.ts';
import { PlayerStats, type SurvivalEnvironment } from '../web/src/core/survival/PlayerStats.ts';
import { randomTickBlock, hasRandomTick, type TickWorld } from '../web/src/core/tick/RandomTicks.ts';
import {
  FIRE_CONSUME_CHANCE,
  FIRE_DAMAGE_INTERVAL_TICKS,
  FIRE_IGNITE_SECONDS,
  FIRE_SPREAD_CHANCE,
  canPlaceFire,
  fireBehavior,
  soulFireBehavior,
  hasFuelAround,
  igniteAt,
  isFlammable,
  isTouchingWater,
  flammableCount,
  CAMPFIRE_IGNITE_SECONDS,
  burnsOnContact,
} from '../web/src/core/world/Fire.ts';
import { withLitState } from '../web/src/core/registry/blockState.ts';
import { RECIPES } from '../web/src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';

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

/** 确定性随机序列（测试里不该有真随机） */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

class FakeWorld implements TickWorld {
  readonly blocks = new Map<string, number>();
  skyLight = 15;
  raining = false;

  constructor() {
    // 一个小的"游戏世界"：y=63 铺一层石头当地面
    for (let x = -4; x <= 4; x++) {
      for (let z = -4; z <= 4; z++) this.set(x, 63, z, Block.STONE);
    }
  }

  set(x: number, y: number, z: number, id: number): void {
    const key = `${x},${y},${z}`;
    if (id === Block.AIR) this.blocks.delete(key);
    else this.blocks.set(key, id);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? Block.AIR;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.set(x, y, z, id);
    return true;
  }

  skyLightAt(): number {
    return this.skyLight;
  }
}

// ---------------------------------------------------------------- 1. 方块本身

console.log('\n[火焰方块]');
{
  const def = blockDef(Block.FIRE);
  equal('名字是 minecraft:fire', def.name, 'minicraft:fire');
  equal('形状是 cross（借用植物那套两片交叉薄面）', def.shape, 'cross');
  check('没有碰撞体积', !def.solid);
  check('不遮挡邻居（否则贴着火的方块会缺面）', !def.opaque);
  equal('发光 15（比火把的 14 更亮）', def.light, 15);
  equal('不透光（不影响光传播）', def.lightOpacity, 0);
  check('硬度 0 → 徒手一拍即灭', breakSeconds(Block.FIRE) === 0);
  check('火焰**没有物品**（原版也只能靠打火石点燃）', def.itemless && itemDef(Block.FIRE) === undefined);
  equal('破坏火焰不掉落任何东西', dropFor(Block.FIRE), null);
  check('火焰登记了随机刻行为（否则只会亮着不动）', hasRandomTick(Block.FIRE));
}

// ---------------------------------------------------------------- 2. 可燃与点火判定

console.log('\n[可燃方块]');
{
  check('橡木木板可燃', isFlammable(Block.OAK_PLANKS));
  check('橡木原木可燃', isFlammable(Block.OAK_LOG));
  check('橡木树叶可燃', isFlammable(Block.OAK_LEAVES));
  check('橡木栅栏可燃', isFlammable(Block.OAK_FENCE));
  check('白色羊毛可燃', isFlammable(46));
  check('矮草可燃', isFlammable(Block.SHORT_GRASS));
  check('石头不可燃', !isFlammable(Block.STONE));
  check('玻璃不可燃', !isFlammable(Block.GLASS));
  check('泥土不可燃', !isFlammable(Block.DIRT));
  check('水不可燃', !isFlammable(Block.WATER));

  // 6 种木材的木板/原木/树叶都要可燃（只登记橡木会漏掉其余 5 种）
  const woodIds = [104, 109, 114, 119, 124]; // 其余 5 种木材的原木（每种连续 5 个，原木在首位）
  check('其余 5 种木材的原木也可燃', woodIds.every((id) => isFlammable(id)));
  check(`可燃方块清单非空（共 ${flammableCount()} 种）`, flammableCount() > 40);
}

console.log('\n[打火石：能不能点着]');
{
  const world = new FakeWorld();
  // 石头地面（y=63）上方是空气
  check('石头上方的空气格能点着（下方是实心顶面）', canPlaceFire(world, 0, 64, 0));

  const empty = new FakeWorld();
  // 悬空（下方空气、周围也没有燃料）→ 点不着
  equal('悬空那一格本身是空气', empty.getBlock(0, 70, 0), Block.AIR);
  check('悬空的空气格点不着', !canPlaceFire(empty, 0, 70, 0));

  // 一堆木头中间：下面是空气，但旁边有可燃方块 → 能点着
  const wood = new FakeWorld();
  wood.set(1, 70, 0, Block.OAK_PLANKS);
  check('旁边有可燃方块时（下方是空气）也能点着', canPlaceFire(wood, 0, 70, 0));

  // 已经有方块的格子放不下火
  check('已经有方块的格子点不着', !canPlaceFire(world, 0, 63, 0));

  // 有燃料就"活得下去"
  const fuel = new FakeWorld();
  fuel.set(0, 64, 0, Block.FIRE);
  fuel.set(0, 63, 0, Block.OAK_PLANKS);
  check('下方有木板时火焰有燃料', hasFuelAround(fuel, 0, 64, 0));
  check('3×3×3 内没有任何燃料时判为无燃料', !hasFuelAround(new FakeWorld(), 0, 70, 0));

  // 点火成功 / 失败
  const ignite = new FakeWorld();
  equal('在石头上点火成功', igniteAt(ignite, 0, 64, 0), true);
  equal('点火后那一格是火焰', ignite.getBlock(0, 64, 0), Block.FIRE);
  const fail = new FakeWorld();
  equal('悬空处点火失败', igniteAt(fail, 0, 70, 0), false);
  equal('点火失败不改动世界', fail.getBlock(0, 70, 0), Block.AIR);
}

// ---------------------------------------------------------------- 3. 随机刻行为

console.log('\n[随机刻：燃烧与熄灭]');
{
  // 没有燃料 → 自己熄灭（原版"没得烧了就灭"）
  const lonely = new FakeWorld();
  lonely.set(0, 70, 0, Block.FIRE);
  check('孤立的火焰会熄灭', fireBehavior(lonely, 0, 70, 0, sequence([0.5])));
  equal('熄灭后那一格是空气', lonely.getBlock(0, 70, 0), Block.AIR);

  // 旁边有水 → 浇灭
  const wet = new FakeWorld();
  wet.set(0, 70, 0, Block.FIRE);
  wet.set(0, 63, 0, Block.OAK_PLANKS);
  wet.set(1, 70, 0, Block.WATER);
  check('旁边有水的火焰会被浇灭', isTouchingWater(wet, 0, 70, 0));
  check('被水浇灭', fireBehavior(wet, 0, 70, 0, sequence([0.5])) && wet.getBlock(0, 70, 0) === Block.AIR);

  // 下雨 + 露天 → 浇灭
  const rain = new FakeWorld();
  rain.raining = true;
  rain.set(0, 70, 0, Block.FIRE);
  rain.set(0, 63, 0, Block.OAK_PLANKS);
  check('雨天的露天火焰被浇灭', fireBehavior(rain, 0, 70, 0, sequence([0.5])) && rain.getBlock(0, 70, 0) === Block.AIR);

  // 下雨但在洞里（天光 0）→ 不浇灭。燃料要放在**3×3×3 邻域内**（下面一格），
  // 放到 7 格以外就成了"没燃料自己熄灭"，测的就不是"雨在不在"了
  const indoor = new FakeWorld();
  indoor.raining = true;
  indoor.skyLight = 0;
  indoor.set(0, 70, 0, Block.FIRE);
  indoor.set(0, 69, 0, Block.OAK_PLANKS);
  check('雨天的洞内火焰不会被浇灭', !fireBehavior(indoor, 0, 70, 0, sequence([0.5, 0.5, 0.5, 0.5])));
  equal('洞内的火还在', indoor.getBlock(0, 70, 0), Block.FIRE);

  // 蔓延：随机数小 → 命中概率；偏移取 (dx=1, dy=0, dz=0) → 木板上
  const spread = new FakeWorld();
  spread.set(0, 64, 0, Block.FIRE);
  spread.set(0, 63, 0, Block.OAK_PLANKS);
  spread.set(1, 64, 0, Block.OAK_PLANKS);
  // 序列：蔓延掷点（<0.25 命中）、dx（0.9→+1）、dy（0.34→0）、dz（0.34→0）、烧掉掷点（<0.6 命中）
  const changed = fireBehavior(spread, 0, 64, 0, sequence([0.1, 0.9, 0.34, 0.34, 0.1]));
  check('火焰会烧掉旁边的可燃方块', changed && spread.getBlock(1, 64, 0) === Block.FIRE);

  // 往上烧：偏移取 (dx=0, dy=1, dz=0)，上方是可燃方块 → 烧掉它（原版火也是这样啃上树干的）
  const up = new FakeWorld();
  up.set(0, 64, 0, Block.FIRE);
  up.set(0, 65, 0, Block.OAK_PLANKS);
  // 序列：蔓延命中、dx(0.5→0)、dy(0.9→+1)、dz(0.5→0)、烧掉命中
  const spreadUp = fireBehavior(up, 0, 64, 0, sequence([0.1, 0.5, 0.9, 0.5, 0.1]));
  check('火焰会往上蔓延（烧掉上方的可燃方块）', spreadUp && up.getBlock(0, 65, 0) === Block.FIRE);

  // 蔓延进空气：偏移取 (dx=1, dy=0, dz=0)，目标格下方是石头 → 立得住
  const side = new FakeWorld();
  side.set(0, 64, 0, Block.FIRE);
  side.set(0, 65, 0, Block.OAK_PLANKS); // 燃料（保证源火焰不熄灭）
  // 序列：蔓延命中、dx(0.9→+1)、dy(0.34→0)、dz(0.34→0)
  const spreadSide = fireBehavior(side, 0, 64, 0, sequence([0.1, 0.9, 0.34, 0.34]));
  check('火焰会往旁边的空气格蔓延（那一格下方是实心方块）', spreadSide && side.getBlock(1, 64, 0) === Block.FIRE);

  // 蔓延掷点不命中 → 什么都不做
  const idle = new FakeWorld();
  idle.set(0, 64, 0, Block.FIRE);
  idle.set(0, 63, 0, Block.OAK_PLANKS);
  check('蔓延掷点不命中时不动（只是继续烧着）', !fireBehavior(idle, 0, 64, 0, sequence([FIRE_SPREAD_CHANCE + 0.01])));
  equal('火还在原地', idle.getBlock(0, 64, 0), Block.FIRE);

  // 不烧自己脚下的支撑方块：偏移正好是 (0,-1,0) 时直接跳过
  const support = new FakeWorld();
  support.set(0, 64, 0, Block.FIRE);
  support.set(0, 63, 0, Block.OAK_PLANKS);
  // 序列：蔓延命中、dx(0.5→0)、dy(0.0→-1)、dz(0.5→0) —— 正好指向脚下的木板
  check(
    '不会烧掉脚下的支撑方块（否则火焰会浮在空中）',
    !fireBehavior(support, 0, 64, 0, sequence([0.1, 0.5, 0.0, 0.5, 0.1])) &&
      support.getBlock(0, 63, 0) === Block.OAK_PLANKS,
  );

  // 烧掉掷点不命中 → 燃料保留
  const keep = new FakeWorld();
  keep.set(0, 64, 0, Block.FIRE);
  keep.set(0, 63, 0, Block.OAK_PLANKS);
  keep.set(1, 64, 0, Block.OAK_PLANKS);
  check(
    '烧掉掷点不命中时燃料留着（火不是瞬间吞噬一切）',
    !fireBehavior(keep, 0, 64, 0, sequence([0.1, 0.9, 0.34, 0.34, FIRE_CONSUME_CHANCE + 0.01])) &&
      keep.getBlock(1, 64, 0) === Block.OAK_PLANKS,
  );

  // 通过统一入口（randomTickBlock）也能跑到火的行为
  const viaEntry = new FakeWorld();
  viaEntry.set(0, 70, 0, Block.FIRE);
  equal(
    'randomTickBlock 能找到火焰的行为',
    randomTickBlock(viaEntry, 0, 70, 0, sequence([0.5])),
    true,
  );
}

// ---------------------------------------------------------------- 4. 玩家侧：点燃与伤害

console.log('\n[玩家：站在火里]');
{
  /**
   * 一次 tick 的环境快照。
   *
   * ⚠️ 默认关掉自然回复：否则"着火每秒掉 1 点"会被**饱食度回血**抵消掉
   * （饥饿满时每 10 tick 回 1 点，比火焰还快），测出来的就是"血没掉"这种假结论。
   */
  function env(patch: Partial<SurvivalEnvironment> = {}): SurvivalEnvironment {
    return {
      eyeInWater: false,
      inLava: false,
      inFire: false,
      onCactus: false,
      suffocating: false,
      fallDistance: 0,
      y: 64,
      creative: false,
      naturalRegeneration: false,
      ...patch,
    };
  }

  // 站在火里：立刻被点燃 8 秒
  const stats = new PlayerStats();
  stats.tick(env({ inFire: true }));
  check('站在火里会被点燃', stats.burning);
  check('着火时长接近 8 秒（原版数值）', Math.abs(stats.fireSeconds - FIRE_IGNITE_SECONDS) < 0.15, `${stats.fireSeconds}`);

  // 每 20 tick 掉 1 点血
  const burning = new PlayerStats();
  for (let i = 0; i < FIRE_DAMAGE_INTERVAL_TICKS; i++) burning.tick(env({ inFire: true }));
  equal('着火满 1 秒掉 1 点血', burning.health, 19);
  for (let i = 0; i < FIRE_DAMAGE_INTERVAL_TICKS; i++) burning.tick(env({ inFire: true }));
  equal('第 2 秒再掉 1 点（不受无敌帧影响）', burning.health, 18);

  // 离开火之后还会继续烧
  const left = new PlayerStats();
  left.tick(env({ inFire: true }));
  for (let i = 0; i < 20; i++) left.tick(env()); // 离开火，走 1 秒
  equal('离开火之后仍在燃烧（每秒继续掉血）', left.health, 19);
  check('着火计时器在递减', left.fireSeconds < FIRE_IGNITE_SECONDS);

  // 抗火免疫
  const immune = new PlayerStats();
  immune.tick(env({ inFire: true, fireImmune: true }));
  check('抗火效果下不会被点燃', !immune.burning);
  equal('抗火下站在火里不掉血', immune.health, 20);

  // 创造模式不烧
  const creative = new PlayerStats();
  creative.tick(env({ inFire: true, creative: true }));
  check('创造模式不会被点燃', !creative.burning);

  // 重生清空
  const respawn = new PlayerStats();
  respawn.tick(env({ inFire: true }));
  respawn.respawn();
  check('重生后火焰被清空', !respawn.burning && respawn.fireSeconds === 0);
  equal('重生后满血', respawn.health, 20);

  // 重复被点燃取"更长的那个"（不会越点越短）
  const again = new PlayerStats();
  again.ignite(3);
  again.ignite(8);
  equal('重复点燃取更长的时长', again.fireSeconds, 8);
}

// ---------------------------------------------------------------- 5. 打火石物品与配方

console.log('\n[打火石]');
{
  const def = itemDef(Item.FLINT_AND_STEEL);
  check('打火石已注册', def !== undefined);
  equal('打火石的英文 id', def?.name, 'minicraft:flint_and_steel');
  equal('中文名是"打火石"', itemLabel(Item.FLINT_AND_STEEL), '打火石');
  equal('不可堆叠（maxStack 1）', maxStackOf(Item.FLINT_AND_STEEL), 1);
  equal('耐久 64（原版）', durabilityOf(Item.FLINT_AND_STEEL), 64);
  const tiles: readonly string[] = TILE_ORDER;
  check('图标在图集名单里', tiles.includes(def!.tile));

  const recipe = RECIPES.find(
    (entry) => entry.result.id === Item.FLINT_AND_STEEL,
  );
  check('存在打火石的配方', recipe !== undefined);
  check('配方是 1 铁锭 + 1 燧石（原版无序）', recipe?.kind === 'shapeless' &&
    recipe.ingredients.length === 2 &&
    recipe.ingredients.includes(Item.IRON_INGOT) &&
    recipe.ingredients.includes(Item.FLINT));
  equal('一次合成 1 个', recipe?.result.count, 1);

  // 火焰方块没有物品，不该出现在创造物品栏的方块物品里
  const fireDrops = blockDrops(Block.FIRE, {
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0,
  });
  equal('精准采集也拿不到火焰', fireDrops, null);
}

console.log('\n[营火也会烫人（批次 48）]');
{
  equal('站在点着的营火上被点燃 5 秒（原版）', CAMPFIRE_IGNITE_SECONDS, 5);
  check('火方块会点着贴着它的实体', burnsOnContact(Block.FIRE, 0));
  check('岩浆也会', burnsOnContact(Block.LAVA, 0));
  check('**点着的**营火会', burnsOnContact(Block.CAMPFIRE, withLitState(0, true)));
  check('熄灭的营火不会（同一个方块的两种状态）', !burnsOnContact(Block.CAMPFIRE, 0));
  check('石头不会', !burnsOnContact(Block.STONE, 0));
  check('水不会', !burnsOnContact(Block.WATER, 0));
  check('三座炉子都不会（烧的是里面，不是炉壳）', [Block.FURNACE, Block.SMOKER, Block.BLAST_FURNACE].every((id) => !burnsOnContact(id, withLitState(0, true))));
  // 与"火方块被水浇灭"那套规则不冲突：营火是独立方块，判据只有"点着没点着"
  check('营火点着时与火方块走同一条路（都是"贴上去就烧"）', burnsOnContact(Block.CAMPFIRE, withLitState(0, true)) === burnsOnContact(Block.FIRE, 0));
}

console.log('\n[灵魂火（批次 546）]');
{
  const world = new FakeWorld();
  const def = blockDef(Block.SOUL_FIRE);
  equal('灵魂火亮度是 10（普通火 15）', def.light, 10);
  check('灵魂火没有物品形态', def.itemless === true);
  check('灵魂火走植物那套 cross 形状', def.shape === 'cross');
  check('灵魂火会被随机刻处理（不蔓延，但要检查支撑/水/雨）', hasRandomTick(Block.SOUL_FIRE));

  // 灵魂沙上点出来的是灵魂火
  world.set(0, 63, 0, Block.SOUL_SAND);
  check('灵魂沙上打火石 → 灵魂火', igniteAt(world, 0, 64, 0) && world.getBlock(0, 64, 0) === Block.SOUL_FIRE);
  check('灵魂火会点燃贴着它的实体', burnsOnContact(Block.SOUL_FIRE, 0));

  // 普通石头上还是普通火
  world.set(2, 63, 2, Block.STONE);
  check('普通石头上打火石 → 普通火', igniteAt(world, 2, 64, 2) && world.getBlock(2, 64, 2) === Block.FIRE);

  // 支撑还在：随机刻什么都不做
  check('脚下是灵魂沙时不熄灭', !soulFireBehavior(world, 0, 64, 0, sequence([0])) && world.getBlock(0, 64, 0) === Block.SOUL_FIRE);

  // 支撑没了：随机刻把它清掉
  world.set(0, 63, 0, Block.STONE);
  check('脚下换成石头后随机刻熄灭', soulFireBehavior(world, 0, 64, 0, sequence([0])) && world.getBlock(0, 64, 0) === Block.AIR);

  // 下雨：露天灵魂火被浇灭
  world.set(0, 63, 0, Block.SOUL_SAND);
  world.set(0, 64, 0, Block.SOUL_FIRE);
  world.raining = true;
  world.skyLight = 15;
  check('雨天露天的灵魂火被浇灭', soulFireBehavior(world, 0, 64, 0, sequence([0])) && world.getBlock(0, 64, 0) === Block.AIR);

  // 水贴着火：浇灭
  world.raining = false;
  world.set(0, 64, 0, Block.SOUL_FIRE);
  world.set(1, 64, 0, Block.WATER);
  check('贴着水时灵魂火被浇灭', soulFireBehavior(world, 0, 64, 0, sequence([0])) && world.getBlock(0, 64, 0) === Block.AIR);
  check('灵魂火不会烧掉灵魂沙（没有蔓延逻辑）', world.getBlock(0, 63, 0) === Block.SOUL_SAND);
}

console.log(`\n火焰测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
