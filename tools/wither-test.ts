/**
 * 凋灵那一族离线测试（J14：批次 115 的前置 + 批次 116 的本体）
 *
 * 这一条链是"玩家自己召唤出一个 boss"：
 * **下界要塞打凋灵骷髅 → 3 颗头 + 4 块灵魂沙摆 T 形 → 凋灵 → 下界之星**。
 * 所以断言分两大半：
 *
 *  1~5. **前置（批次 115）**：凋灵骷髅的数据（20 血 / 接触 8 / **命中挂凋零 10 秒**）、
 *     掉落（含 **头 2.5%** 那条概率写法）、**只在要塞里刷**（`fortressAt` 与真生成一致）、
 *     凋灵骷髅头这个方块（`head` 形状 + 放置规则）、凋零与中毒的差别；
 *  6. **召唤仪式（批次 116）**：4 块灵魂沙摆 T + 3 颗头 → 认出布局、收走三颗头留沙；
 *     两个方向都认、少一颗头/少了那一竖/头底下不是沙都**不认**；
 *  7. **凋灵本体**：300 血 / 会飞 / 免疫火 / **是 boss（不因玩家跑远而消失）** / 掉下界之星；
 *     三阶段（>50% 黑骷髅头、≤50% 护盾 + 蓝色骷髅头、≤25% 更勤）、
 *     **护盾期免疫一切伤害**、倒下时爆炸 + 掉星 + 给经验；
 *  8. **下界之星**：中文名、说明（写明"信标还没做"）、贴图、创造栏。
 *
 * 运行：npm run test:wither
 */

import { Block, blockDef, blockHardness, blockTiles } from '../src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { CREATIVE_ITEMS, Item, dropFor, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, toolItemId } from '../src/core/registry/tools.ts';
import { planPlacement, type PlacementInput } from '../src/core/interaction/Placement.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  WITHER_SKELETON_TYPE,
  DROPPING_MOB_TYPES,
  HOSTILE_MOBS,
  MOB_TYPES,
  mobTypeById,
} from '../src/core/entity/mobs.ts';
import { Mob, mobLabel } from '../src/core/entity/Mob.ts';
import {
  Wither,
  WITHER_SHIELD_SECONDS,
  WITHER_TYPE,
} from '../src/core/entity/Wither.ts';
import {
  BLUE_WITHER_SKULL_DAMAGE,
  BLUE_WITHER_SKULL_WITHER_SECONDS,
  Throwable,
  WITHER_SKULL_DAMAGE,
  WITHER_SKULL_WITHER_SECONDS,
  isWitherSkull,
} from '../src/core/entity/Throwable.ts';
import { StatusEffects } from '../src/core/survival/StatusEffects.ts';
import {
  consumeSummonSkulls,
  witherPatternAt,
  type WitherSummonWorld,
} from '../src/core/world/WitherSummon.ts';
import { NetherBiome, NetherGenerator } from '../src/core/gen/NetherGenerator.ts';
import { fortressAt, fortressInstanceForTest } from '../src/core/gen/NetherFortress.ts';
import { describeMobModel } from '../src/render/MobRenderer.ts';
import { boxAt } from '../src/core/physics/AABB.ts';
import type { EntityContext } from '../src/core/entity/Entity.ts';
import type { PhysicsWorld } from '../src/core/physics/PlayerPhysics.ts';

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

function close(label: string, actual: number, expected: number, epsilon = 1e-9): void {
  check(label, Math.abs(actual - expected) <= epsilon, `实际 ${actual}，期望 ${expected}`);
}

const TILES = new Set<string>(TILE_ORDER);
const SEED = 20261014;

/** 一片平地（物理与方块查询必须同源，否则"AI 以为站得住、物理却让它掉下去"） */
function flatPhysics(): PhysicsWorld {
  return {
    collisionAt: (_x: number, y: number) => (y < 0 ? 'full' : null),
    isLiquid: () => false,
  } as unknown as PhysicsWorld;
}

/** 一个只记录"谁被施加了什么效果"的上下文（近战那一路用） */
function makeCombatCtx(): { afflict: [string, number][]; damage: number; ctx: EntityContext } {
  const record = { afflict: [] as [string, number][], damage: 0, ctx: null as unknown as EntityContext };
  record.ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: (_x: number, y: number) => (y < 0 ? Block.STONE : Block.AIR),
    player: { x: 1, y: 0, z: 0.5 },
    hurtPlayer: (amount: number) => {
      record.damage += amount;
    },
    afflictPlayer: (effect: string, seconds: number) => {
      record.afflict.push([effect, seconds]);
    },
    spawnDrop: () => {},
  } as unknown as EntityContext;
  return record;
}

/** 放置输入（与 `dispenser-test` 同一套写法） */
function placement(overrides: Partial<PlacementInput>): PlacementInput {
  return {
    blockId: Block.WITHER_SKELETON_SKULL,
    normal: [0, 1, 0],
    hitX: 0.5,
    hitY: 1,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    // 默认：落点**下方那一格**是石头（头要点在实心方块上面，这一条与投掷器那类不同）
    blockAt: (_x, y) => (y < 0 ? Block.STONE : Block.AIR),
    hitBlock: Block.STONE,
    hitState: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------- 1. 数据

console.log('\n[凋灵骷髅：类型与数据]');
{
  equal('在生物表里', mobTypeById('wither_skeleton'), WITHER_SKELETON_TYPE);
  equal('名字', mobLabel(WITHER_SKELETON_TYPE), '凋灵骷髅');
  equal('生命 20（原版）', WITHER_SKELETON_TYPE.health, 20);
  equal('接触伤害 8（原版普通难度，石剑加成已含在内）', WITHER_SKELETON_TYPE.attackDamage, 8);
  equal('追击范围 16 格（原版）', WITHER_SKELETON_TYPE.followRange, 16);
  equal('击杀经验 5', WITHER_SKELETON_TYPE.xp, 5);
  equal('**亡灵家族**（亡灵杀手的第二个目标）', WITHER_SKELETON_TYPE.family, 'undead');
  check('**没有远程**（原版它拿剑贴身砍，不像骷髅那样射箭）', WITHER_SKELETON_TYPE.ranged === undefined);

  // 命中附带凋零
  equal('命中让对方凋零', WITHER_SKELETON_TYPE.venom?.effect, 'wither');
  equal('凋零 10 秒（原版）', WITHER_SKELETON_TYPE.venom?.seconds, 10);

  // 掉落
  const drops = WITHER_SKELETON_TYPE.drops;
  equal('掉落 4 样（煤炭 / 骨头 / 头 / 石剑）', drops.length, 4);
  const skull = drops.find((drop) => drop.itemId === Block.WITHER_SKELETON_SKULL);
  check('表里有凋灵骷髅头', skull !== undefined);
  check(
    '头写成 `min:1,max:1,chance:0.025`（写成 0~1 会被"数量也掷一次"砍成 1/80）',
    skull !== undefined && skull.min === 1 && skull.max === 1 && Math.abs((skull.chance ?? 0) - 0.025) < 1e-9,
    JSON.stringify(skull),
  );
  const sword = drops.find((drop) => drop.itemId === toolItemId('sword', 'stone'));
  check('表里有石剑（原版它掉手里那把，8.5%）', sword !== undefined && Math.abs((sword.chance ?? 0) - 0.085) < 1e-9);
  check('煤炭与骨头都是原版那两样', drops.some((d) => d.itemId === Item.COAL) && drops.some((d) => d.itemId === Item.BONE));

  // 生成口径
  check('进"会自然刷的敌对生物"表（否则一只都不会出现）', HOSTILE_MOBS.some((type) => type.id === 'wither_skeleton'));
  equal('只在下界刷', WITHER_SKELETON_TYPE.dimension, 'nether');
  equal('而且**只要塞里面**刷', WITHER_SKELETON_TYPE.spawnZone, 'nether_fortress');
}

// ---------------------------------------------------------------- 2. 命中真的挂凋零

console.log('\n[凋灵骷髅：命中挂凋零]');
{
  const mob = new Mob(WITHER_SKELETON_TYPE, 2, 0, 0.5);
  const record = makeCombatCtx();
  // 贴到 2 格内打一下（近战判定在 `distanceSq < 4`）
  mob.tick(record.ctx, 0.05);
  check('打到了玩家（伤害 8 + 虚弱也在这一层算）', record.damage > 0, `伤害 ${record.damage}`);
  equal('并且挂了一次凋零', record.afflict.length, 1);
  equal('挂的是凋零', record.afflict[0]?.[0], 'wither');
  equal('10 秒', record.afflict[0]?.[1], 10);
}

// ---------------------------------------------------------------- 3. 凋零能致死

console.log('\n[凋零与中毒的差别]');
{
  const effects = new StatusEffects();
  effects.apply('wither', 10, 0);
  let total = 0;
  let killer = false;
  for (let i = 0; i < 300; i++) {
    for (const hit of effects.tick().damageHits) {
      total += hit.amount;
      if (hit.cause === 'wither') killer = true;
    }
  }
  check('凋零会持续掉血', total > 0, `${total} 点`);
  check('而且它的伤害类别是 `wither`（**能致死**，不像中毒会停在 1 点血）', killer);

  const poison = new StatusEffects();
  poison.apply('poison', 10, 0);
  let poisonCause = false;
  for (let i = 0; i < 300; i++) {
    for (const hit of poison.tick().damageHits) {
      if (hit.cause === 'poison') poisonCause = true;
    }
  }
  check('对照：中毒的伤害类别是 `poison`（生物那一层据此"停在 1 点血"）', poisonCause);
}

// ---------------------------------------------------------------- 4. 只在要塞里刷

console.log('\n[只在要塞里刷：fortressAt]');
{
  const gen = new NetherGenerator(SEED);
  const world = gen.structureWorld();
  equal('锚点里的玄武岩群系取自下界群系表', world.basaltBiome, NetherBiome.BASALT_DELTAS);
  check('生成器自己就能给出这套锚点（主线程不必另起一套）', typeof world.floorAt === 'function');

  // 在 ±2 个单元里找一座真实存在（地形条件都满足）的要塞
  let instance = null as ReturnType<typeof fortressInstanceForTest>;
  for (let cellZ = -2; cellZ <= 2 && !instance; cellZ++) {
    for (let cellX = -2; cellX <= 2 && !instance; cellX++) {
      instance = fortressInstanceForTest(cellX, cellZ, SEED, world);
    }
  }
  check('找得到一座要塞', instance !== null);

  if (instance) {
    const hit = fortressAt(instance.x, instance.z, SEED, world);
    check('要塞正中：判定命中', hit !== null);
    check(
      '命中的就是那一座（同一条 `fortressCandidate` 公式）',
      hit !== null && hit.x === instance.x && hit.z === instance.z && hit.y === instance.y,
      `判定 (${hit?.x},${hit?.z})，实例 (${instance.x},${instance.z})`,
    );
    check('半径内偏一点仍然命中', fortressAt(instance.x + 15, instance.z - 15, SEED, world) !== null);
    check('出了半径就不命中', fortressAt(instance.x + 40, instance.z, SEED, world) === null);
    check('离得很远更不命中', fortressAt(instance.x + 2000, instance.z + 2000, SEED, world) === null);
  }
}

// ---------------------------------------------------------------- 5. 凋灵骷髅头

console.log('\n[凋灵骷髅头：方块与物品]');
{
  const id = Block.WITHER_SKELETON_SKULL;
  const def = blockDef(id);
  equal('注册名', def.name, 'minecraft:wither_skeleton_skull');
  equal('形状是 `head`（不是整格）', def.shape, 'head');
  check('三张贴图都在图集名单里', blockTiles(id, 0).every((tile) => TILES.has(tile)), blockTiles(id, 0).join(' '));
  check('不遮挡邻居（透明方块那一档）', def.opaque === false);
  equal('硬度 1（原版，徒手一秒多）', blockHardness(id), 1);
  check('徒手就能挖（这颗头没登记"需要工具"）', canHarvest(id, null));

  // 碰撞与渲染同源：8/16 立方体
  const boxes = collisionBoxes('head', 0);
  equal('碰撞盒 1 个', boxes.length, 1);
  equal('长宽是 8/16', `${boxes[0]![0]},${boxes[0]![2]},${boxes[0]![3]},${boxes[0]![5]}`, '0.25,0.25,0.75,0.75');
  equal('高 8/16', boxes[0]![4], 0.5);
  equal('渲染盒与碰撞盒一致', meshBoxes('head', 0).length, 1);

  // 物品那一边
  equal('中文名', itemLabel(id), '凋灵骷髅头');
  check('有说明', hasDescription(id));
  check('说明写了"放地上当装饰"与"半格高"', itemDescription(id).includes('装饰') && itemDescription(id).includes('半格'));
  equal('64 个一叠（方块物品的默认）', maxStackOf(id), 64);
  equal('挖掉掉自己', dropFor(id)?.id, id);
  check('它是个物品（创造栏里拿得到）', itemDef(id) !== undefined);
}

console.log('\n[凋灵骷髅头：放置]');
{
  check('点在方块**顶面** + 下方实心 → 放得下', planPlacement(placement({})) !== null);
  check('点侧面 → 放不下（原版能挂墙上，本项目不做朝向）', planPlacement(placement({ normal: [1, 0, 0] })) === null);
  check('点底面 → 放不下', planPlacement(placement({ normal: [0, -1, 0] })) === null);
  check(
    '下方不是实心 → 放不下',
    planPlacement(placement({ blockAt: () => Block.AIR, hitBlock: Block.AIR })) === null,
  );
  check(
    '下方是灵魂沙 → 放得下（这是召唤仪式的第一颗头）',
    planPlacement(
      placement({ blockAt: (_x, y) => (y < 0 ? Block.SOUL_SAND : Block.AIR), hitBlock: Block.SOUL_SAND }),
    ) !== null,
  );
}

// ---------------------------------------------------------------- 6. 召唤材料齐不齐

console.log('\n[召唤仪式：4 块灵魂沙摆 T + 3 颗头]');
{
  /** 一个只记方块的假世界（仪式那一层只认识读写方块） */
  const makeSummonWorld = (): WitherSummonWorld & { set(x: number, y: number, z: number, id: number): void } => {
    const cells = new Map<string, number>();
    return {
      getBlock: (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.AIR,
      setBlock: (x, y, z, id) => {
        cells.set(`${x},${y},${z}`, id);
        return true;
      },
      set: (x, y, z, id) => {
        cells.set(`${x},${y},${z}`, id);
      },
    };
  };

  // 正确的 T 形：横向三块沙（y-1）+ 中间下面一块（y-2）+ 顶上三颗头（y）
  const buildAltar = (world: ReturnType<typeof makeSummonWorld>, axis: 'x' | 'z', baseX = 0, baseZ = 0): void => {
    for (let i = -1; i <= 1; i++) {
      const sx = axis === 'x' ? baseX + i : baseX;
      const sz = axis === 'z' ? baseZ + i : baseZ;
      world.set(sx, -1, sz, Block.SOUL_SAND);
      world.set(sx, 0, sz, Block.WITHER_SKELETON_SKULL);
    }
    world.set(baseX, -2, baseZ, Block.SOUL_SAND);
  };

  {
    const world = makeSummonWorld();
    buildAltar(world, 'x');
    const layout = witherPatternAt(world, 0, 0, 0);
    check('沿 X 摆的一排：认出来了', layout !== null);
    equal('3 颗头', layout?.skulls.length, 3);
    equal('4 块沙', layout?.sand.length, 4);
    equal('中心是**中间那颗头**（凋灵就生成在那）', `${layout?.center.x},${layout?.center.y},${layout?.center.z}`, '0,0,0');
    check(
      '从**两侧**任意一颗头问，也认得出来（离线测试与玩家都可能从旁边那颗摆起）',
      witherPatternAt(world, -1, 0, 0) !== null && witherPatternAt(world, 1, 0, 0) !== null,
    );

    // 清掉三颗头 → 灵魂沙留着
    equal('仪式成立时收走 3 颗头', consumeSummonSkulls(world, layout!), 3);
    equal('头没了', world.getBlock(0, 0, 0), Block.AIR);
    equal('**灵魂沙留着**（原版如此）', world.getBlock(0, -1, 0), Block.SOUL_SAND);
    equal('再问一次就不再成立了（头已经收走）', witherPatternAt(world, 0, 0, 0), null);
  }

  {
    // 沿 Z 摆（另一个方向）也要认
    const world = makeSummonWorld();
    buildAltar(world, 'z');
    check('沿 Z 摆的一排：同样认得出', witherPatternAt(world, 0, 0, 0) !== null);
  }

  {
    // 少一颗头
    const world = makeSummonWorld();
    buildAltar(world, 'x');
    world.set(1, 0, 0, Block.AIR);
    equal('只有 2 颗头 → 不成立', witherPatternAt(world, 0, 0, 0), null);
  }

  {
    // 头底下不是沙
    const world = makeSummonWorld();
    buildAltar(world, 'x');
    world.set(1, -1, 0, Block.STONE);
    equal('有一颗头不是摆在灵魂沙上 → 不成立', witherPatternAt(world, 0, 0, 0), null);
  }

  {
    // 少了 T 形的那一竖
    const world = makeSummonWorld();
    buildAltar(world, 'x');
    world.set(0, -2, 0, Block.AIR);
    equal('少了中间下面那块沙 → 不成立（T 形不是"三块平沙"）', witherPatternAt(world, 0, 0, 0), null);
  }

  {
    // 灵魂土也算（原版两种都能用）
    const world = makeSummonWorld();
    buildAltar(world, 'x');
    world.set(0, -2, 0, Block.SOUL_SOIL);
    world.set(-1, -1, 0, Block.SOUL_SOIL);
    check('灵魂土也能当材料（与原版一致）', witherPatternAt(world, 0, 0, 0) !== null);
  }

  {
    // 不是头就什么都不该发生
    const world = makeSummonWorld();
    buildAltar(world, 'x');
    world.set(0, 0, 0, Block.STONE);
    equal('那一格不是头 → 不成立', witherPatternAt(world, 0, 0, 0), null);
  }

  // 材料都还在（这一条是"下一批"的前提，留着当护栏）
  check('灵魂沙是方块', blockDef(Block.SOUL_SAND).id === Block.SOUL_SAND);
  check('灵魂土也是方块', blockDef(Block.SOUL_SOIL).id === Block.SOUL_SOIL);
  check('凋灵骷髅在生物表里（头只能从它身上掉）', MOB_TYPES.some((type) => type.id === 'wither_skeleton'));
}

// ---------------------------------------------------------------- 6b. 凋灵本体

console.log('\n[凋灵：数据与阶段]');
{
  equal('名字', mobLabel(WITHER_TYPE), '凋灵');
  equal('300 点生命（原版）', WITHER_TYPE.health, 300);
  check('**会飞**', WITHER_TYPE.flying === true);
  check('**免疫火焰**（原版）', WITHER_TYPE.fireImmune === true);
  check('**是 boss**（不会因为玩家跑远而消失）', WITHER_TYPE.boss === true);
  check('**不近战**（伤害全在骷髅头上，与恶魂同一个取舍）', WITHER_TYPE.attackDamage === 0);
  equal('掉落只有一样：下界之星', WITHER_TYPE.drops.length, 1);
  equal('掉的就是下界之星', WITHER_TYPE.drops[0]!.itemId, Item.NETHER_STAR);
  equal('掉落 1 颗（原版）', `${WITHER_TYPE.drops[0]!.min}~${WITHER_TYPE.drops[0]!.max}`, '1~1');
  equal('击杀经验 50', WITHER_TYPE.xp, 50);
  check(
    '**在"会掉东西的生物"那份清单里**（`DROPPING_MOB_TYPES`）——不在的话下界之星会被判成拿不到',
    DROPPING_MOB_TYPES.some((type) => type.id === 'wither'),
  );

  // 渲染：三颗头的骨架
  const model = describeMobModel(WITHER_TYPE);
  equal('模型骨架是凋灵（三颗头 + 肋骨笼）', model.kind, 'wither');
  equal('没有可摆动的腿（它整体在飘）', model.legs, 0);
  check('部件够多（三颗头 + 六只眼睛 + 肋骨）', model.parts >= 12, `${model.parts} 个`);
}

console.log('\n[凋灵：三阶段与护盾]');
{
  const wither = new Wither(0, 20, 0);
  equal('满血是第一阶段', wither.phase, 1);

  const events = { explodes: 0, skulls: 0, blue: 0, drops: [] as number[], xp: 0 };
  const ctx = {
    world: flatPhysics(),
    playerBox: null,
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: { x: 0, y: 20, z: 12 },
    hurtPlayer: () => {},
    spawnDrop: (itemId: number) => events.drops.push(itemId),
    awardXp: (amount: number) => {
      events.xp += amount;
    },
    explode: () => {
      events.explodes++;
    },
    spawnWitherSkull: (_x: number, _y: number, _z: number, _v: unknown, blue: boolean) => {
      events.skulls++;
      if (blue) events.blue++;
    },
  } as unknown as EntityContext;

  // 吐骷髅头：跑 2 秒应当至少吐一颗（黑色）
  for (let t = 0; t < 4; t += 0.05) wither.tick(ctx, 0.05);
  check('第一阶段会吐骷髅头', events.skulls > 0, `${events.skulls} 颗`);
  equal('第一阶段吐的是**黑色**那颗', events.blue, 0);

  // 掉到一半：护盾 + 爆炸（原版那个"护盾阶段"）
  wither.hurt(wither.health - WITHER_TYPE.health * 0.5, 0, 0, ctx);
  equal('阶段变成 2', wither.phase, 2);
  // ⚠️ 阶段转换是在 `tick` 里判定的（"这一帧掉到一半了"），所以这里必须推一帧
  wither.tick(ctx, 0.05);
  check('掉到 50% 触发护盾', wither.shielded);
  check('同时炸了一下', events.explodes === 1, `${events.explodes} 次`);

  // 护盾期免伤
  const healthInShield = wither.health;
  check('护盾期打它不掉血', !wither.hurt(50, 0, 0, ctx));
  equal('血量没变', wither.health, healthInShield);

  // 护盾结束后掉血，并且改吐蓝色骷髅头
  for (let t = 0; t < WITHER_SHIELD_SECONDS + 0.2; t += 0.05) wither.tick(ctx, 0.05);
  check('护盾到期', !wither.shielded);
  check('护盾结束后打得动了', wither.hurt(10, 0, 0, ctx));
  const before = events.blue;
  for (let t = 0; t < 4; t += 0.05) wither.tick(ctx, 0.05);
  check('第二阶段开始吐**蓝色**骷髅头', events.blue > before, `蓝 ${events.blue} 颗 / 共 ${events.skulls} 颗`);

  // 掉到 25% 以下：阶段 3
  wither.hurt(wither.health - WITHER_TYPE.health * 0.2, 0, 0, ctx);
  equal('掉到 20% 是第三阶段', wither.phase, 3);

  // 打死：掉下界之星 + 经验 + 炸一下
  const explodesBefore = events.explodes;
  check('最后一击打得动', wither.hurt(9999, 0, 0, ctx));
  check('死了', wither.dead);
  check('掉了下界之星', events.drops.includes(Item.NETHER_STAR));
  equal('给了 50 点经验', events.xp, 50);
  check('倒下时炸了一下（原版如此）', events.explodes > explodesBefore);
}

console.log('\n[凋灵的骷髅头：投掷物那一档]');
{
  equal('黑色：5 点伤害（原版）', WITHER_SKULL_DAMAGE, 5);
  equal('黑色：凋零 10 秒（原版）', WITHER_SKULL_WITHER_SECONDS, 10);
  equal('蓝色：8 点伤害（原版）', BLUE_WITHER_SKULL_DAMAGE, 8);
  equal('蓝色：凋零 40 秒（原版）', BLUE_WITHER_SKULL_WITHER_SECONDS, 40);
  check('两档都认得出来', isWitherSkull('wither_skull') && isWitherSkull('wither_skull_blue'));
  check('别的档不是它', !isWitherSkull('snowball') && !isWitherSkull('ender_pearl'));

  // 命中玩家：伤害 + 凋零（真打一下）
  const hits: { damage: number; wither: number } = { damage: 0, wither: 0 };
  const skull = new Throwable(0, 20, 0, { x: 20, y: 0, z: 0 }, {
    kind: 'wither_skull_blue',
    itemId: Block.WITHER_SKELETON_SKULL,
  });
  const hitCtx = {
    world: flatPhysics(),
    playerBox: boxAt(0, 20, 0.2, 0.6, 1.8),
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: { x: 0, y: 20, z: 0 },
    hurtPlayer: (amount: number) => {
      hits.damage += amount;
    },
    afflictPlayer: (effect: string, seconds: number) => {
      if (effect === 'wither') hits.wither = seconds;
    },
    spawnDrop: () => {},
  } as unknown as EntityContext;
  skull.tick(hitCtx, 0.02);
  check('蓝色骷髅头打中玩家就消失', skull.dead);
  close('伤害是 8', hits.damage, BLUE_WITHER_SKULL_DAMAGE);
  close('并且挂上 40 秒凋零', hits.wither, BLUE_WITHER_SKULL_WITHER_SECONDS);

  // 不受重力（原版它是一条直线飞出去的）
  const flying = new Throwable(0, 20, 0, { x: 20, y: 0, z: 0 }, {
    kind: 'wither_skull',
    itemId: Block.WITHER_SKELETON_SKULL,
  });
  const skyCtx = makeCombatCtx().ctx;
  for (let t = 0; t < 0.5; t += 0.05) flying.tick(skyCtx, 0.05);
  close('不受重力（竖直速度一直是 0）', flying.vy, 0);
  check('水平飞出去了', flying.x > 8, `x=${flying.x.toFixed(1)}`);
}

console.log('\n[下界之星]');
{
  equal('中文名', itemLabel(Item.NETHER_STAR), '下界之星');
  check('有说明（写明"信标还没做"）', hasDescription(Item.NETHER_STAR) && itemDescription(Item.NETHER_STAR).includes('信标'));
  equal('64 个一叠（原版）', maxStackOf(Item.NETHER_STAR), 64);
  check('图标在图集名单里', TILES.has(itemDef(Item.NETHER_STAR)!.tile), itemDef(Item.NETHER_STAR)!.tile);
  check('创造物品栏里拿得到', CREATIVE_ITEMS.includes(Item.NETHER_STAR));
}

console.log(`\n凋灵测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
