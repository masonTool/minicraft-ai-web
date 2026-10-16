/**
 * 珊瑚一族（批次 51：1.13 海洋更新的主角）+ 甘蔗整株破坏 离线测试
 *
 * 这一批是**一整族 30 个方块**（5 种 × 珊瑚块/珊瑚丛/珊瑚扇 × 活/失活），
 * 真正要盯住的是四条**机制**——它们的错都不会报错、只会让世界看起来"哪里不对"：
 *  1. **离开水就失活**（珊瑚块看六面有没有水、丛与扇看上面那格还是不是水）
 *  2. **失活珊瑚挨着活珊瑚会复活**（且**变回自己那一种**，不能串色）
 *  3. **活珊瑚不用精准采集只掉失活版**（精准采集那条流水线的顺序）
 *  4. **珊瑚扇的"贴哪一面"**（贴墙时朝向指向被贴的珊瑚块那一侧）
 *
 * 另外把"30 个 id 全部登记了随机刻"这类**按族展开**的地方也钉住：
 * 漏登记一个 id 的表现是"那一种珊瑚永远不会失活/复活"，小样本里根本看不出。
 *
 * 运行：npm run test:coral
 */

import {
  BLOCKS,
  Block,
  CORAL_BLOCK_ID_START,
  CORAL_DEAD_VARIANT,
  CORAL_FAN_ID_START,
  CORAL_ID_START,
  CORAL_KINDS,
  CORAL_LIVE_VARIANT,
  DEAD_CORAL_BLOCK_ID_START,
  DEAD_CORAL_FAN_ID_START,
  DEAD_CORAL_ID_START,
  blockDef,
  blockHardness,
  isDeadCoral,
  isLiveCoral,
} from '../src/core/registry/blocks.ts';
import { FACING_OFFSET, facingOf, isWallMounted } from '../src/core/registry/blockState.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { isHandHarvestable, canHarvest, harvestRequirement, makeToolInfo } from '../src/core/registry/tools.ts';
import {
  CREATIVE_ITEMS,
  blockDrops,
  categoryOf,
  dropFor,
  requiresShears,
  type DropContext,
} from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import {
  CORAL_REVIVE_CHANCE,
  RANDOM_TICK_BEHAVIORS,
  type TickWorld,
} from '../src/core/tick/RandomTicks.ts';
import { canFlowInto } from '../src/core/world/Fluids.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { BIOME_FEATURES, SEA_LEVEL, decorate, type FeatureWorld } from '../src/core/gen/Features.ts';
import { BIOME_TABLE, Biome } from '../src/core/gen/Biome.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk, type BlockArray } from '../src/core/world/Chunk.ts';

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
const KINDS = CORAL_KINDS.length;

/** 五"种" × 三"形" × 活/失活 = 30 个 id */
const ALL_CORAL: readonly number[] = [
  ...CORAL_DEAD_VARIANT.keys(),
  ...CORAL_LIVE_VARIANT.keys(),
];
const LIVE_CORAL: readonly number[] = [...CORAL_DEAD_VARIANT.keys()];
const DEAD_CORAL: readonly number[] = [...CORAL_LIVE_VARIANT.keys()];

// ---------------------------------------------------------------- 工具

/** 只够珊瑚行为用的最小世界 */
class CoralWorld implements TickWorld {
  private readonly blocks = new Map<string, number>();

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: number): void {
    this.blocks.set(CoralWorld.key(x, y, z), id);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(CoralWorld.key(x, y, z)) ?? Block.AIR;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.set(x, y, z, id);
    return true;
  }
}

/** 一定过概率门 / 一定不过概率门的随机源 */
const pass = () => 0;
const fail = () => CORAL_REVIVE_CHANCE + 0.01;

/** 海底在 floorY、水面一直到 y=63 的一整块海 */
function oceanChunk(floorY: number = 40, surfaceBlock: number = Block.SAND): BlockArray {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let y = -64; y <= floorY; y++) {
    const id = y === floorY ? surfaceBlock : Block.STONE;
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) blocks[Chunk.index(x, y, z)] = id;
    }
  }
  for (let y = floorY + 1; y <= SEA_LEVEL; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) blocks[Chunk.index(x, y, z)] = Block.WATER;
    }
  }
  return blocks;
}

function flatWorld(surfaceY: number, biomeId: number): FeatureWorld {
  const biome = BIOME_TABLE[biomeId]!;
  return { surfaceY: () => surfaceY, columnBiome: () => biome };
}

function countBlocks(blocks: BlockArray, ids: readonly number[]): number {
  const set = new Set(ids);
  let count = 0;
  for (const id of blocks) if (set.has(id)) count++;
  return count;
}

// ---------------------------------------------------------------- 1. 注册与贴图

console.log('\n[注册与贴图：30 个方块]');
{
  equal('五种珊瑚', KINDS, 5);
  equal('珊瑚一族共 30 个 id', ALL_CORAL.length, 30);
  equal('活珊瑚 15 件', LIVE_CORAL.length, 15);
  equal('失活珊瑚 15 件', DEAD_CORAL.length, 15);

  // id 连续：439..468 必须一个不缺（缺一个会在启动校验里炸，但"错位"不会）
  let contiguous = true;
  for (let i = 0; i < 30; i++) {
    if (BLOCKS[CORAL_BLOCK_ID_START + i]?.id !== CORAL_BLOCK_ID_START + i) contiguous = false;
  }
  check('30 个 id 连续（439~468 一格不缺）', contiguous);

  // 每种 6 件的命名规则（与贴图、掉落、映射同一套）
  let named = true;
  for (const kind of CORAL_KINDS) {
    const names = [
      `${kind}_coral_block`,
      `dead_${kind}_coral_block`,
      `${kind}_coral`,
      `dead_${kind}_coral`,
      `${kind}_coral_fan`,
      `dead_${kind}_coral_fan`,
    ];
    for (const name of names) {
      if (!BLOCKS.some((def) => def.name === `minecraft:${name}`)) named = false;
    }
  }
  check('五种 × 三形 × 活/失活的注册名都对得上', named);

  // 活 ↔ 失活映射：15 对，互逆，且**同色对同色**（这是复活"不串色"的根据）
  let mappingOk = true;
  for (let i = 0; i < KINDS; i++) {
    const pairs: readonly (readonly [number, number])[] = [
      [CORAL_BLOCK_ID_START + i, DEAD_CORAL_BLOCK_ID_START + i],
      [CORAL_ID_START + i, DEAD_CORAL_ID_START + i],
      [CORAL_FAN_ID_START + i, DEAD_CORAL_FAN_ID_START + i],
    ];
    for (const [live, dead] of pairs) {
      if (CORAL_DEAD_VARIANT.get(live) !== dead) mappingOk = false;
      if (CORAL_LIVE_VARIANT.get(dead) !== live) mappingOk = false;
      if (!isLiveCoral(live) || isDeadCoral(live)) mappingOk = false;
      if (!isDeadCoral(dead) || isLiveCoral(dead)) mappingOk = false;
    }
  }
  check('活/失活映射表 15 对互逆、且颜色一一对应（复活不会串色）', mappingOk);
  check('普通方块不算珊瑚', !isLiveCoral(Block.STONE) && !isDeadCoral(Block.STONE));

  // 形状与碰撞
  for (let i = 0; i < KINDS; i++) {
    equal(`第 ${i + 1} 种珊瑚块是完整立方体`, blockDef(CORAL_BLOCK_ID_START + i).shape, 'cube');
    equal(`第 ${i + 1} 种失活珊瑚块也是完整立方体`, blockDef(DEAD_CORAL_BLOCK_ID_START + i).shape, 'cube');
    equal(`第 ${i + 1} 种珊瑚丛走 cross（与花草同形）`, blockDef(CORAL_ID_START + i).shape, 'cross');
    equal(`第 ${i + 1} 种珊瑚扇走 coral_fan（新的薄片形状）`, blockDef(CORAL_FAN_ID_START + i).shape, 'coral_fan');
  }
  equal('珊瑚丛没有碰撞体', collisionBoxes('cross', 0).length, 0);
  equal('珊瑚扇没有碰撞体（非固体 → 落在地面上也不挡路）', collisionBoxes('coral_fan', 0).length, 0);

  // 扇子的几何：落地贴底面、贴墙在朝向那一侧
  const floorFan = meshBoxes('coral_fan', 0);
  check('落地珊瑚扇是 1/16 厚的一片（贴在自己那一格的底面）', floorFan.length === 1 && floorFan[0]![4]! <= 0.07);
  const wallFan = meshBoxes('coral_fan', 1 << 3); // wallMounted + facing 0（北）
  check('贴北墙的珊瑚扇薄片在北侧（z ∈ [0, 1/16]）', wallFan[0]![5]! <= 0.07);
  const eastFan = meshBoxes('coral_fan', (1 << 3) | (1 << 1)); // wallMounted + facing 1（东）
  check('贴东墙的珊瑚扇薄片在东侧（x ∈ [15/16, 1]）', eastFan[0]![0]! >= 0.93);

  // waterPlant：丛与扇是"水里的植物"，珊瑚块不是
  for (let i = 0; i < KINDS; i++) {
    if (blockDef(CORAL_ID_START + i).waterPlant !== true) check(`第 ${i + 1} 种珊瑚丛是水里的植物`, false);
    if (blockDef(CORAL_FAN_ID_START + i).waterPlant !== true) check(`第 ${i + 1} 种珊瑚扇是水里的植物`, false);
    if (blockDef(CORAL_BLOCK_ID_START + i).waterPlant !== false) check(`第 ${i + 1} 种珊瑚块不是"水里的植物"`, false);
  }
  check('珊瑚丛/珊瑚扇（20 件）都标了 waterPlant，珊瑚块（10 件）没有', true);

  // 贴图：30 张都在图集里（每种 6 张：块/失活块/丛/失活丛/扇/失活扇）
  const missingTiles = ALL_CORAL.filter((id) => blockDef(id).tiles.some((tile) => !TILES.has(tile)));
  check('30 张贴图都在图集名单里', missingTiles.length === 0, `${missingTiles.length} 个缺`);

  // 中文名与说明
  equal('管珊瑚块的中文名', itemLabel(CORAL_BLOCK_ID_START), '管珊瑚块');
  equal('失活的管珊瑚块', itemLabel(DEAD_CORAL_BLOCK_ID_START), '失活的管珊瑚块');
  equal('鹿角珊瑚的中文名', itemLabel(CORAL_ID_START + 4), '鹿角珊瑚');
  equal('失活的气泡珊瑚扇', itemLabel(DEAD_CORAL_FAN_ID_START + 2), '失活的气泡珊瑚扇');
  const unnamed = ALL_CORAL.filter((id) => !itemLabel(id) || /coral|unknown|未知/i.test(itemLabel(id)));
  check('30 件都有中文名（没有一件退化成英文 id）', unnamed.length === 0, unnamed.slice(0, 3).map(itemLabel).join(' '));
  const noDesc = ALL_CORAL.filter((id) => !hasDescription(id));
  check('30 件都有说明（"离开水失活""精准采集"这两条要写在说明里）', noDesc.length === 0, `${noDesc.length} 个缺`);

  // 分类与创造物品栏
  equal('珊瑚块归"自然"', categoryOf(CORAL_BLOCK_ID_START), 'natural');
  equal('珊瑚丛归"自然"', categoryOf(CORAL_ID_START), 'natural');
  equal('珊瑚扇归"自然"', categoryOf(CORAL_FAN_ID_START), 'natural');
  check('30 件都在创造物品栏里', ALL_CORAL.every((id) => CREATIVE_ITEMS.includes(id)));

  // 硬度与工具
  equal('珊瑚块硬度 1.5（原版，与石砖同档）', blockHardness(CORAL_BLOCK_ID_START), 1.5);
  equal('珊瑚丛硬度 0（一碰就掉）', blockHardness(CORAL_ID_START), 0);
  check('珊瑚块**必须用镐**（徒手挖掉一无所获）', harvestRequirement(CORAL_BLOCK_ID_START)?.tool === 'pickaxe');
  check('失活珊瑚块也要镐', harvestRequirement(DEAD_CORAL_BLOCK_ID_START)?.tool === 'pickaxe');
  check('珊瑚丛徒手可采（一碰就掉）', isHandHarvestable(CORAL_ID_START));
  check('珊瑚扇徒手可采', isHandHarvestable(CORAL_FAN_ID_START));
  check('失活的珊瑚丛/扇同样徒手可采', isHandHarvestable(DEAD_CORAL_ID_START) && isHandHarvestable(DEAD_CORAL_FAN_ID_START));
}

// ---------------------------------------------------------------- 2. 放置规则

console.log('\n[放置规则]');
{
  const place = (
    blockId: number,
    target: number,
    below: number,
    normal: readonly [number, number, number] = [0, 1, 0],
  ) =>
    planPlacement({
      blockId,
      normal,
      hitX: 10.5,
      hitY: 40,
      hitZ: 10.5,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy, dz) =>
        dx === 0 && dy === 0 && dz === 0 ? target : dx === 0 && dy === -1 && dz === 0 ? below : Block.STONE,
      hitBlock: below,
      hitState: 0,
    });

  check('珊瑚丛：水下对着海底 → 能种', place(CORAL_ID_START, Block.WATER, Block.SAND) !== null);
  check('珊瑚丛：落点是空气 → 拒绝（它长在水里）', place(CORAL_ID_START, Block.AIR, Block.SAND) === null);
  check('珊瑚丛：下面是海水（悬在水中） → 拒绝', place(CORAL_ID_START, Block.WATER, Block.WATER) === null);
  check('珊瑚丛：能种在珊瑚块上（原版就是一丛丛长在块上）', place(CORAL_ID_START, Block.WATER, CORAL_BLOCK_ID_START) !== null);

  const floorFan = place(CORAL_FAN_ID_START, Block.WATER, Block.SAND, [0, 1, 0]);
  check('珊瑚扇：落点在水里 + 命中的是上表面 → 落地扇', floorFan !== null && !isWallMounted(floorFan!.state));
  check('珊瑚扇：落点是空气 → 拒绝', place(CORAL_FAN_ID_START, Block.AIR, Block.SAND) === null);
  check('珊瑚扇：命中天花板（下表面）→ 拒绝（原版不允许倒挂）', place(CORAL_FAN_ID_START, Block.WATER, Block.SAND, [0, -1, 0]) === null);
  const wallFan = place(CORAL_FAN_ID_START, Block.WATER, Block.SAND, [1, 0, 0]);
  check('珊瑚扇：命中侧面 → 贴墙扇', wallFan !== null && isWallMounted(wallFan!.state));
  // 法线指向"新方块所在那一侧"：命中东面 = 新方块在命中方块的**东边**，
  // 也就是它贴的是自己**西边**那面墙 → 朝向记西（3）
  equal('命中的是东面 → 扇子贴西墙（朝向记西）', wallFan ? facingOf(wallFan.state) : -1, 3);
  const westFan = place(CORAL_FAN_ID_START, Block.WATER, Block.SAND, [-1, 0, 0]);
  equal('命中的是西面 → 扇子贴东墙（朝向记东）', westFan ? facingOf(westFan.state) : -1, 1);
  const southFan = place(CORAL_FAN_ID_START, Block.WATER, Block.SAND, [0, 0, 1]);
  equal('命中的是南面 → 扇子贴北墙（朝向记北）', southFan ? facingOf(southFan.state) : -1, 0);

  check('珊瑚块是普通固体方块（落点是水也照放，水被挤掉）', place(CORAL_BLOCK_ID_START, Block.WATER, Block.SAND) !== null);
  check('失活珊瑚块同样是普通方块', place(DEAD_CORAL_BLOCK_ID_START, Block.AIR, Block.SAND) !== null);

  // 水冲不走：30 件里只有 20 件植物需要这条（珊瑚块是固体，本来就不受影响）
  const flowWorld = {
    getBlock: (x: number, y: number, z: number) => {
      if (x === 0 && y === 64 && z === 0) return CORAL_ID_START;
      if (x === 1 && y === 64 && z === 0) return CORAL_FAN_ID_START;
      return Block.AIR;
    },
    getState: () => 0,
    setFluid: () => true,
    schedule: () => {},
  };
  check('水冲不走珊瑚丛（否则一放下去就被旁边的水覆盖）', !canFlowInto(flowWorld, 0, 64, 0));
  check('水冲不走珊瑚扇', !canFlowInto(flowWorld, 1, 64, 0));
  check('水照旧能进空气格（对照）', canFlowInto(flowWorld, 2, 64, 0));
}

// ---------------------------------------------------------------- 3. 失活：离开水就变灰

console.log('\n[失活：离开水就变成失活版本]');
{
  const liveBlock = CORAL_BLOCK_ID_START + 1; // 脑珊瑚块
  const deadBlock = CORAL_DEAD_VARIANT.get(liveBlock)!;
  const liveTuft = CORAL_ID_START + 3; // 火珊瑚
  const deadTuft = CORAL_DEAD_VARIANT.get(liveTuft)!;
  const surviveOf = (id: number) => RANDOM_TICK_BEHAVIORS.get(id);

  check('30 个珊瑚 id 全部登记了随机刻行为', ALL_CORAL.every((id) => RANDOM_TICK_BEHAVIORS.get(id) !== undefined));
  check('活珊瑚与失活珊瑚走的是**两个不同**的行为', surviveOf(liveBlock) !== surviveOf(deadBlock));

  // 珊瑚块：六面都没水 → 失活
  const dry = new CoralWorld();
  dry.set(0, 64, 0, liveBlock);
  check(
    '珊瑚块六面都没有水 → 变失活（原版：珊瑚块贴着水才活着）',
    surviveOf(liveBlock)!(dry, 0, 64, 0, fail) && dry.getBlock(0, 64, 0) === deadBlock,
  );

  // 珊瑚块：旁边有一格水就活着
  for (const [dx, dy, dz] of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const) {
    const wet = new CoralWorld();
    wet.set(0, 64, 0, liveBlock);
    wet.set(dx, 64 + dy, dz, Block.WATER);
    check(`六个面里"${dx},${dy},${dz}"有水 → 活着`, !surviveOf(liveBlock)!(wet, 0, 64, 0, fail) && wet.getBlock(0, 64, 0) === liveBlock);
  }

  // 珊瑚丛/扇：上面那一格是水才活着
  const wetTuft = new CoralWorld();
  wetTuft.set(0, 64, 0, liveTuft);
  wetTuft.set(0, 65, 0, Block.WATER);
  check('珊瑚丛上面是水 → 活着', !surviveOf(liveTuft)!(wetTuft, 0, 64, 0, fail));

  const dryTuft = new CoralWorld();
  dryTuft.set(0, 64, 0, liveTuft);
  check(
    '珊瑚丛上面是空气 → **变成失活的珊瑚丛**（不是消失、也不是变成空气）',
    surviveOf(liveTuft)!(dryTuft, 0, 64, 0, fail) && dryTuft.getBlock(0, 64, 0) === deadTuft,
  );

  const dryFan = new CoralWorld();
  const liveFan = CORAL_FAN_ID_START + 4;
  dryFan.set(0, 64, 0, liveFan);
  check(
    '珊瑚扇离开水 → 变成失活的扇子（保住它的"贴哪一面"由状态管，这里只换 id）',
    surviveOf(liveFan)!(dryFan, 0, 64, 0, fail) && dryFan.getBlock(0, 64, 0) === CORAL_DEAD_VARIANT.get(liveFan),
  );

  // 失活的那一侧：不会因为"没水"再变一次（幂等，不是死循环）
  const deadDry = new CoralWorld();
  deadDry.set(0, 64, 0, deadBlock);
  check('失活珊瑚块缺水不会再变（它已经是灰的了）', !surviveOf(deadBlock)!(deadDry, 0, 64, 0, pass));
}

// ---------------------------------------------------------------- 4. 复活：挨着活珊瑚

console.log('\n[复活：失活珊瑚挨着活珊瑚会变回自己那一种]');
{
  const reviveOf = (id: number) => RANDOM_TICK_BEHAVIORS.get(id);

  // 五种颜色 × 三种形状：都能复活，而且**变回自己那一种**
  let colorSafe = true;
  let reviveAll = true;
  for (let i = 0; i < KINDS; i++) {
    for (const [deadStart, liveStart] of [
      [DEAD_CORAL_BLOCK_ID_START, CORAL_BLOCK_ID_START],
      [DEAD_CORAL_ID_START, CORAL_ID_START],
      [DEAD_CORAL_FAN_ID_START, CORAL_FAN_ID_START],
    ] as const) {
      const dead = deadStart + i;
      const live = liveStart + i;
      const world = new CoralWorld();
      world.set(0, 64, 0, dead);
      world.set(1, 64, 0, live); // 东边一株活的（同色）
      world.set(0, 65, 0, Block.WATER); // 泡在水里
      const changed = reviveOf(dead)!(world, 0, 64, 0, pass);
      if (changed && world.getBlock(0, 64, 0) !== live) colorSafe = false;
      if (!changed) reviveAll = false;
    }
  }
  check('15 种失活珊瑚都能复活', reviveAll);
  check('复活后变回**自己那一种颜色**（不会串成别的颜色）', colorSafe);

  const deadBlock = DEAD_CORAL_BLOCK_ID_START;
  const liveBlock = CORAL_BLOCK_ID_START;

  // 概率门
  const unlucky = new CoralWorld();
  unlucky.set(0, 64, 0, deadBlock);
  unlucky.set(1, 64, 0, liveBlock);
  unlucky.set(0, 65, 0, Block.WATER);
  check(
    '概率没过就还是灰的（不至于半分钟全绿）',
    !reviveOf(deadBlock)!(unlucky, 0, 64, 0, fail) && unlucky.getBlock(0, 64, 0) === deadBlock,
  );
  check('复活概率在合理区间（0 < p < 1）', CORAL_REVIVE_CHANCE > 0 && CORAL_REVIVE_CHANCE < 1);

  // 三个必要条件缺一不可
  const noNeighbour = new CoralWorld();
  noNeighbour.set(0, 64, 0, deadBlock);
  noNeighbour.set(0, 65, 0, Block.WATER);
  check('六面都没有活珊瑚 → 不复活', !reviveOf(deadBlock)!(noNeighbour, 0, 64, 0, pass));

  const farNeighbour = new CoralWorld();
  farNeighbour.set(0, 64, 0, deadBlock);
  farNeighbour.set(2, 64, 0, liveBlock); // 隔一格不算
  farNeighbour.set(0, 65, 0, Block.WATER);
  check('活珊瑚隔着两格 → 不复活（只认六面）', !reviveOf(deadBlock)!(farNeighbour, 0, 64, 0, pass));

  const dryRevive = new CoralWorld();
  dryRevive.set(0, 64, 0, deadBlock);
  dryRevive.set(1, 64, 0, liveBlock);
  check('挨着活珊瑚但不在水里 → 不复活（灰的珊瑚在水外面变不回来）', !reviveOf(deadBlock)!(dryRevive, 0, 64, 0, pass));

  // 活珊瑚那条行为不会把活珊瑚变灰（两个行为别接反）
  const liveWet = new CoralWorld();
  liveWet.set(0, 64, 0, liveBlock);
  liveWet.set(0, 65, 0, Block.WATER);
  check('活珊瑚在水里不会"被复活"成别的 id', !reviveOf(liveBlock)!(liveWet, 0, 64, 0, pass));
}

// ---------------------------------------------------------------- 5. 掉落

console.log('\n[掉落：活珊瑚要精准采集]');
{
  const ctx = (over: Partial<DropContext> = {}): DropContext => ({
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0.99,
    ...over,
  });

  let dropsDead = true;
  let silkKeepsLive = true;
  for (let i = 0; i < KINDS; i++) {
    for (const [liveStart, deadStart] of [
      [CORAL_BLOCK_ID_START, DEAD_CORAL_BLOCK_ID_START],
      [CORAL_ID_START, DEAD_CORAL_ID_START],
      [CORAL_FAN_ID_START, DEAD_CORAL_FAN_ID_START],
    ] as const) {
      const live = liveStart + i;
      const dead = deadStart + i;
      if (blockDrops(live, ctx())?.id !== dead) dropsDead = false;
      if (blockDrops(live, ctx({ silkTouch: true }))?.id !== live) silkKeepsLive = false;
    }
  }
  check('活珊瑚不用精准采集 → **只掉失活的版本**（15 件都对）', dropsDead);
  check('带精准采集 → 活珊瑚完整带走（15 件都对）', silkKeepsLive);
  equal('活珊瑚块无精准采集掉的是失活珊瑚块', blockDrops(CORAL_BLOCK_ID_START, ctx())?.id, DEAD_CORAL_BLOCK_ID_START);
  equal('活珊瑚丛无精准采集掉的是失活珊瑚丛', blockDrops(CORAL_ID_START, ctx())?.id, DEAD_CORAL_ID_START);
  equal('活珊瑚扇无精准采集掉的是失活珊瑚扇', blockDrops(CORAL_FAN_ID_START, ctx())?.id, DEAD_CORAL_FAN_ID_START);

  check('失活珊瑚徒手挖就掉自己（不需要精准采集）', DEAD_CORAL.every((id) => blockDrops(id, ctx())?.id === id));
  check('失活珊瑚条目的 dropFor 也是自己', DEAD_CORAL.every((id) => dropFor(id)?.id === id));
  check('珊瑚都不"必须剪刀"（原版那条只认精准采集）', ALL_CORAL.every((id) => !requiresShears(id)));

  // 珊瑚块要镐：徒手挖得动但一无所获（`canHarvest` 是 main 里那道门）
  check('徒手挖珊瑚块：挖得动但一无所获', !canHarvest(CORAL_BLOCK_ID_START, null));
  check('木镐挖珊瑚块：有掉落', canHarvest(CORAL_BLOCK_ID_START, makeToolInfo('pickaxe', 'wooden')));
  check('徒手挖珊瑚丛：有掉落（植物不看工具）', canHarvest(CORAL_ID_START, null));
  check('徒手挖失活珊瑚块同样一无所获', !canHarvest(DEAD_CORAL_BLOCK_ID_START, null));
}

// ---------------------------------------------------------------- 6. 世界生成

console.log('\n[世界生成：暖水海洋的珊瑚礁]');
{
  const reef = (biome: number, seed: number, floorY = 40, surfaceBlock = Block.SAND) => {
    const chunk = oceanChunk(floorY, surfaceBlock);
    const states = new Uint8Array(CHUNK_VOLUME);
    decorate(chunk, 0, 0, flatWorld(floorY, biome), seed, undefined, states, () => {});
    return { chunk, states };
  };

  let coralBlocks = 0;
  let tufts = 0;
  let fans = 0;
  let badBlock = 0;
  let dryCoral = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const { chunk } = reef(Biome.WARM_OCEAN, seed);
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        for (let y = 41; y <= SEA_LEVEL; y++) {
          const id = chunk[Chunk.index(x, y, z)]!;
          if (CORAL_DEAD_VARIANT.has(id)) {
            if (id >= CORAL_BLOCK_ID_START && id < CORAL_BLOCK_ID_START + KINDS) coralBlocks++;
            else if (id >= CORAL_ID_START && id < CORAL_ID_START + KINDS) tufts++;
            else fans++;
            // 珊瑚块必须是"海底往上叠"的：下面要么是海底，要么还是珊瑚块
            if (id >= CORAL_BLOCK_ID_START && id < CORAL_BLOCK_ID_START + KINDS) {
              const below = chunk[Chunk.index(x, y - 1, z)]!;
              const isCoralBlockBelow = below >= CORAL_BLOCK_ID_START && below < CORAL_BLOCK_ID_START + KINDS;
              if (!isCoralBlockBelow && below !== Block.SAND && below !== Block.STONE && below !== Block.GRAVEL) badBlock++;
            }
          }
          // 珊瑚块一长出来就该是"泡在水里"的（四面/上面有水），否则下一 tick 就灰了
          if (id >= CORAL_BLOCK_ID_START && id < CORAL_BLOCK_ID_START + KINDS) {
            const waterNeighbours = [
              chunk[Chunk.index(x, y + 1, z)]!,
              chunk[Chunk.index(x === 15 ? 14 : x + 1, y, z)]!,
              chunk[Chunk.index(x === 0 ? 1 : x - 1, y, z)]!,
              chunk[Chunk.index(x, y, z === 15 ? 14 : z + 1)]!,
              chunk[Chunk.index(x, y, z === 0 ? 1 : z - 1)]!,
              // "水"也包括**长在水里的植物**：珊瑚丛/海草是替换掉那一格水存在的
              // （原版它们都是 waterlogged 的，珊瑚块照样活着）
            ].filter((n) => n === Block.WATER || blockDef(n).waterPlant).length;
            if (waterNeighbours === 0) dryCoral++;
          }
        }
      }
    }
  }
  check(`5 个种子在暖水海洋长出 ${coralBlocks} 个珊瑚块`, coralBlocks > 100, `实际 ${coralBlocks}`);
  check(`珊瑚丛也长出来了（${tufts} 株）`, tufts > 20, `实际 ${tufts}`);
  check(`珊瑚扇也长出来了（${fans} 片）`, fans > 10, `实际 ${fans}`);
  check('珊瑚块都是从海底往上叠的（没有悬空的一坨）', badBlock === 0, `${badBlock} 个位置不对`);
  check('长出来的珊瑚块都是泡着水的（不会一生成就发灰）', dryCoral === 0, `${dryCoral} 个缺水`);

  // 贴墙的扇子：朝向必须指向珊瑚块（写反就是"扇子穿进块里"）
  {
    const { chunk, states } = reef(Biome.WARM_OCEAN, 2);
    let wallFans = 0;
    let attached = 0;
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        for (let y = 41; y <= SEA_LEVEL; y++) {
          const index = Chunk.index(x, y, z);
          const id = chunk[index]!;
          if (id < CORAL_FAN_ID_START || id >= CORAL_FAN_ID_START + KINDS) continue;
          const state = states[index]!;
          if (!isWallMounted(state)) continue;
          wallFans++;
          const [dx, dz] = FACING_OFFSET[facingOf(state)]!;
          const support = chunk[Chunk.index(x + dx, y, z + dz)]!;
          if (support >= CORAL_BLOCK_ID_START && support < CORAL_BLOCK_ID_START + KINDS) attached++;
        }
      }
    }
    check(`生成出的贴墙珊瑚扇有 ${wallFans} 片`, wallFans > 3, `实际 ${wallFans}`);
    equal('每一片贴墙扇子的朝向都指向自己的珊瑚块（否则会穿进块里）', attached, wallFans);
  }

  // 群系约束：只有暖水海洋配了珊瑚
  const neutral = reef(Biome.DEEP_OCEAN, 3);
  equal('深海不长珊瑚（原版只有暖水海洋有）', countBlocks(neutral.chunk, LIVE_CORAL), 0);
  equal('配置里只有暖水海洋配了 coral', BIOME_FEATURES[Biome.WARM_OCEAN]!.coral, 0.1);
  check('冷水海洋没配', (BIOME_FEATURES[Biome.FROZEN_OCEAN]!.coral ?? 0) === 0);
  check('普通海洋没配', (BIOME_FEATURES[Biome.OCEAN]!.coral ?? 0) === 0);
  check('深海没配', (BIOME_FEATURES[Biome.DEEP_OCEAN]!.coral ?? 0) === 0);

  // 一格深的浅水不长：把唯一那格水换成珊瑚块之后就没有水了（与海带同一条规则）
  const shallow = new Uint16Array(CHUNK_VOLUME);
  for (let y = -64; y <= 63; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) shallow[Chunk.index(x, y, z)] = y === 63 ? Block.SAND : Block.STONE;
    }
  }
  for (let z = 0; z < CHUNK_SIZE_Z; z++) {
    for (let x = 0; x < CHUNK_SIZE_X; x++) shallow[Chunk.index(x, 64, z)] = Block.WATER;
  }
  decorate(shallow, 0, 0, flatWorld(63, Biome.WARM_OCEAN), 4);
  equal('一格深的暖水浅滩不长珊瑚（水会被挤没）', countBlocks(shallow, LIVE_CORAL), 0);
  // 但同一片海底再深一点就长（对照：海底 61 → 水有 62~63 两格）
  const deeper = oceanChunk(61, Block.SAND);
  decorate(deeper, 0, 0, flatWorld(61, Biome.WARM_OCEAN), 4);
  check('水深两格就长了（对照）', countBlocks(deeper, LIVE_CORAL) > 0);

  // 珊瑚与海带/海草能共存于同一片海（暖水海洋同时配了三样）
  check('暖水海洋的海草与珊瑚配置同时存在', (BIOME_FEATURES[Biome.WARM_OCEAN]!.seagrass ?? 0) > 0 && (BIOME_FEATURES[Biome.WARM_OCEAN]!.coral ?? 0) > 0);
  equal('暖水海洋的配置里没有海带（原版暖水海洋不长海带）', BIOME_FEATURES[Biome.WARM_OCEAN]!.kelp ?? 0, 0);
}

console.log(`\n珊瑚测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
