/**
 * 凋灵骷髅与它的头离线测试（批次 115，J14 的前置）
 *
 * 凋灵（boss）本身是下一批的事，但**没有这一批就没有凋灵的入口**：
 * 召唤要 3 颗凋灵骷髅头，而头只有凋灵骷髅掉。所以这里要钉住的是"那条链能不能走通"：
 *
 *  1. **凋灵骷髅的数据**：20 血 / 接触 8 / 追击 16 / 亡灵家族 /
 *     **命中让对方凋零 10 秒**（`venom` 的第一个 `wither` 使用者）；
 *  2. **它的掉落**：煤炭 0~1、骨头 0~2、**头 1 个 / 2.5%**、石剑 1 把 / 8.5%——
 *     概率项写成 `min:1,max:1,chance` 而不是 `min:0,max:1`（蜘蛛眼那条坑）；
 *  3. **只在要塞里刷**（`spawnStructure: 'nether_fortress'` + `fortressAt` 与真生成一致）；
 *  4. **凋灵骷髅头这个方块**：`head` 形状（8/16 立方体，能站上去也能从旁边走过）、
 *     只能放在实心方块上面、破坏掉自己、中文名与说明都在；
 *  5. **凋零与中毒的差别**：凋零能致死、中毒停在 1 点血（下一批的凋灵会靠它）；
 *  6. **召唤材料齐不齐**：灵魂沙（方块）与头（方块）都存在——这是下一批的前提。
 *
 * 运行：npm run test:wither
 */

import { Block, blockDef, blockHardness, blockTiles } from '../src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { Item, dropFor, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, toolItemId } from '../src/core/registry/tools.ts';
import { planPlacement, type PlacementInput } from '../src/core/interaction/Placement.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { WITHER_SKELETON_TYPE, HOSTILE_MOBS, MOB_TYPES, mobTypeById } from '../src/core/entity/mobs.ts';
import { Mob } from '../src/core/entity/Mob.ts';
import { StatusEffects } from '../src/core/survival/StatusEffects.ts';
import { NetherBiome, NetherGenerator } from '../src/core/gen/NetherGenerator.ts';
import { fortressAt, fortressInstanceForTest } from '../src/core/gen/NetherFortress.ts';
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
  equal('名字', WITHER_SKELETON_TYPE.name, '凋灵骷髅');
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
  equal('而且**只要塞里面**刷', WITHER_SKELETON_TYPE.spawnStructure, 'nether_fortress');
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
    const result = effects.tick();
    if (result.damage > 0) {
      total += result.damage;
      if (result.damageCause === 'wither') killer = true;
    }
  }
  check('凋零会持续掉血', total > 0, `${total} 点`);
  check('而且它的 `damageCause` 是 `wither`（**能致死**，不像中毒会停在 1 点血）', killer);

  const poison = new StatusEffects();
  poison.apply('poison', 10, 0);
  let poisonCause = false;
  for (let i = 0; i < 300; i++) {
    const result = poison.tick();
    if (result.damage > 0 && result.damageCause === 'poison') poisonCause = true;
  }
  check('对照：中毒的 `damageCause` 是 `poison`（生物那一层据此"停在 1 点血"）', poisonCause);
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

console.log('\n[召唤凋灵的 4 + 3 是不是都在]');
{
  check('灵魂沙是方块', blockDef(Block.SOUL_SAND).id === Block.SOUL_SAND);
  check('灵魂土也是方块（原版两者都能用）', blockDef(Block.SOUL_SOIL).id === Block.SOUL_SOIL);
  check('凋灵骷髅头是方块（要能摆在灵魂沙上）', blockDef(Block.WITHER_SKELETON_SKULL).shape === 'head');
  check('凋灵骷髅在生物表里（头只能从它身上掉）', MOB_TYPES.some((type) => type.id === 'wither_skeleton'));
  check('**仪式本身还没做**（那是下一批：摆成 T + 3 颗头时生成凋灵）', true);
}

console.log(`\n凋灵骷髅测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
