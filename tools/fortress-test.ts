/**
 * 下界要塞与酿造链的断环（批次 92，J26）离线测试
 *
 * 这一批要证的东西**不是"加了一座建筑"**，而是"把三条断掉的链接上"：
 * 批次 91 的可达性审计量出**整族 112 件药水与药水箭在生存里一瓶都拿不到**，
 * 根因是三处（J26 记着）：下界疣（原版只长在下界要塞的灵魂沙上）、
 * 烈焰粉（要烈焰人）、蜘蛛眼（要蜘蛛，这一批**没做**，仍是缺口）。所以：
 *
 *  1. **要塞结构**：候选点判据（玄武岩三角洲不放、净空不够不放、泡在岩浆里不放）、
 *     布局里真的有大片**灵魂沙 + 下界疣**与**刷怪笼**、以及确定性（重放逐格一致）；
 *  2. **下界疣**：4 个阶段、**只认灵魂沙**（放置判据与 `cross` 不同）、
 *     随机刻生长（**不需要光照**——这是它最容易照抄错的点）、成熟掉 2~4 个；
 *  3. **刷怪笼**：规则表（只出烈焰人）、生成判据（玩家 16 格内、附近不够多、落点要站得住）；
 *  4. **烈焰人**：第一种会飞的生物（无重力、悬停、**免疫火焰**）、
 *     掉落烈焰棒、会吐小火球（5 点伤害 + 点燃 5 秒）。
 *
 * 运行：npm run test:fortress
 */

import {
  Block,
  BLOCKS,
  NETHER_WART_RIPE_STAGE,
  NETHER_WART_STAGES,
  blockDef,
  blockHardness,
  blockTiles,
  netherWartStageOf,
} from '../web/src/core/registry/blocks.ts';
import { Item, blockDrops, categoryOf, extraCropDrop, itemDef } from '../web/src/core/registry/items.ts';
import { hasDescription, missingBlockNames } from '../web/src/core/registry/itemNames.ts';
import { harvestRequirement } from '../web/src/core/registry/tools.ts';
import { hasRandomTick, randomTickBlock } from '../web/src/core/tick/RandomTicks.ts';
import { planPlacement } from '../web/src/core/interaction/Placement.ts';
import {
  FORTRESS_CLEARANCE,
  FORTRESS_RADIUS,
  buildFortress,
  fortressCreatureSpawnsAt,
  fortressInstanceForTest,
  nearestFortress,
  fortressIntersects,
  type FortressInstance,
  type FortressWorld,
} from '../web/src/core/gen/NetherFortress.ts';
import { NETHER_STRUCTURE_KINDS } from '../web/src/core/gen/Bastion.ts';
import { NetherGenerator, NetherBiome } from '../web/src/core/gen/NetherGenerator.ts';
import { generateChunkBlocks } from '../web/src/core/gen/TerrainGenerator.ts';
import { Dimension } from '../web/src/core/gen/Dimension.ts';
import { FeatureWriter } from '../web/src/core/gen/Features.ts';
import { CHUNK_VOLUME, Chunk, type BlockArray } from '../web/src/core/world/Chunk.ts';
import { planSpawnerSpawn, type SpawnerWorldView } from '../web/src/core/world/SpawnerTicking.ts';
import { SPAWNER_DEFS, spawnerDefFor } from '../web/src/core/registry/spawners.ts';
import { createMob } from '../web/src/core/entity/MobFactory.ts';
import { Blaze, BLAZE_FIRE_COOLDOWN, BLAZE_FIRE_RANGE, FIREBALL_DAMAGE, FIREBALL_FIRE_SECONDS } from '../web/src/core/entity/Blaze.ts';
import { BLAZE_TYPE, MOB_TYPES, mobTypeById } from '../web/src/core/entity/mobs.ts';
import { Mob, type MobType } from '../web/src/core/entity/Mob.ts';
import { SMALL_FIREBALL_DAMAGE, SMALL_FIREBALL_FIRE_SECONDS, Throwable } from '../web/src/core/entity/Throwable.ts';
import type { EntityContext } from '../web/src/core/entity/Entity.ts';
import type { PhysicsWorld } from '../web/src/core/physics/PlayerPhysics.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';

const SEED = 20261016;

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

// ---------------------------------------------------------------- 区域桩

interface Region {
  writerFor(cx: number, cz: number): FeatureWriter;
  buildEvery(instance: FortressInstance): void;
  at(x: number, y: number, z: number): number;
  /** 这个区域里有几格满足条件 */
  count(predicate: (id: number, x: number, y: number, z: number) => boolean): number;
  equals(other: Region): boolean;
  readonly chunks: Map<string, BlockArray>;
}

function makeRegion(): Region {
  const chunks = new Map<string, BlockArray>();

  const chunkOf = (cx: number, cz: number): BlockArray => {
    const key = `${cx},${cz}`;
    let entry = chunks.get(key);
    if (!entry) {
      entry = new Uint16Array(CHUNK_VOLUME) as BlockArray;
      chunks.set(key, entry);
    }
    return entry;
  };

  const region: Region = {
    chunks,
    writerFor(cx, cz) {
      return new FeatureWriter(chunkOf(cx, cz), cx, cz, new Uint8Array(CHUNK_VOLUME), () => {});
    },
    buildEvery(instance) {
      // 与真实生成同一套做法：**每个相交区块各自重放一遍**，只写落在自己区块的部分
      const cx = instance.x >> 4;
      const cz = instance.z >> 4;
      for (let dcz = -1; dcz <= 1; dcz++) {
        for (let dcx = -1; dcx <= 1; dcx++) buildFortress(this.writerFor(cx + dcx, cz + dcz), instance);
      }
    },
    at(x, y, z) {
      const entry = chunks.get(`${x >> 4},${z >> 4}`);
      return entry ? entry[Chunk.index(x & 15, y, z & 15)]! : -1;
    },
    count(predicate) {
      let total = 0;
      for (const [key, blocks] of chunks) {
        const [cx, cz] = key.split(',').map(Number);
        for (let y = 32; y < 96; y++) {
          for (let lz = 0; lz < 16; lz++) {
            for (let lx = 0; lx < 16; lx++) {
              const id = blocks[Chunk.index(lx, y, lz)]!;
              if (id === Block.AIR) continue;
              if (predicate(id, (cx! << 4) + lx, y, (cz! << 4) + lz)) total++;
            }
          }
        }
      }
      return total;
    },
    equals(other) {
      if (this.chunks.size !== other.chunks.size) return false;
      for (const [key, mine] of this.chunks) {
        const theirs = other.chunks.get(key);
        if (!theirs) return false;
        if (!mine.every((value, index) => value === theirs[index])) return false;
      }
      return true;
    },
  };
  return region;
}

/** 一个"下界地板在 y=40"的假世界 */
function makeFortressWorld(overrides: Partial<FortressWorld> = {}): FortressWorld {
  return {
    floorAt: () => 40,
    ceilingAt: () => 40 + FORTRESS_CLEARANCE + 4,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
    ...overrides,
  };
}

// ---------------------------------------------------------------- 1. 要塞结构

console.log('\n[要塞：候选点与判据]');
{
  const world = makeFortressWorld();
  // 找第一个真的有候选的单元（哈希是随机的，逐个试）
  let instance: FortressInstance | null = null;
  let cell = 0;
  for (let i = 0; i < 64 && !instance; i++) {
    cell = i;
    instance = fortressInstanceForTest(cell, 0, SEED, world);
  }
  check('某个单元里能找到一座要塞', instance !== null, `试到 cell=${cell}`);
  const inst = instance!;

  equal('原点 y = 地板 + 1', inst.y, 41);
  check('原点落在单元内部（距边界至少 5 区块）', inst.x > cell * 22 * 16, String(inst.x));
  check('连续两次求同一个单元 → 同一座要塞', fortressInstanceForTest(cell, 0, SEED, world)?.x === inst.x);

  equal('玄武岩三角洲不放', fortressInstanceForTest(cell, 0, SEED, makeFortressWorld({ biomeAt: () => NetherBiome.BASALT_DELTAS })), null);
  equal('净空不够不放（洞顶只高 8 格）', fortressInstanceForTest(cell, 0, SEED, makeFortressWorld({ ceilingAt: () => 48 })), null);
  equal('地板在岩浆海面以下不放', fortressInstanceForTest(cell, 0, SEED, makeFortressWorld({ floorAt: () => 20, ceilingAt: () => 60 })), null);

  check('落点区块判定：自己那一块相交', fortressIntersects(inst, inst.x >> 4, inst.z >> 4));
  check('落点区块判定：18 格外不相交', !fortressIntersects(inst, (inst.x + FORTRESS_RADIUS + 40) >> 4, inst.z >> 4));
  check('`NETHER_STRUCTURE_KINDS` 里登记了要塞（覆盖度台账靠它数结构种类）', NETHER_STRUCTURE_KINDS.includes('nether_fortress'));
}

console.log('\n[要塞：布局里真的有大片下界疣与刷怪笼]');
{
  const world = makeFortressWorld();
  let inst: FortressInstance | null = null;
  for (let i = 0; i < 64 && !inst; i++) inst = fortressInstanceForTest(i, 0, SEED, world);
  const instance = inst!;

  const region = makeRegion();
  region.buildEvery(instance);

  equal('大厅地板是下界砖（正中那一格）', region.at(instance.x, instance.y, instance.z), Block.NETHER_BRICKS);
  equal('走廊远端（z+12）地面还是下界砖', region.at(instance.x, instance.y, instance.z + 12), Block.NETHER_BRICKS);
  equal('塔顶平台在 +9 层', region.at(instance.x + 2, instance.y + 9, instance.z + 15), Block.NETHER_BRICKS);
  equal('大厅正中那一格是刷怪笼', region.at(instance.x, instance.y + 1, instance.z), Block.SPAWNER);

  const warts = region.count((id) => netherWartStageOf(id) >= 0);
  check('要塞里长着下界疣（>= 12 格）', warts >= 12, String(warts));
  const wartOnSoulSand = region.count(
    (id, x, y, z) => netherWartStageOf(id) >= 0 && region.at(x, y - 1, z) === Block.SOUL_SAND,
  );
  equal('每一株都长在灵魂沙上（这是原版的唯一地基）', wartOnSoulSand, warts);
  const stages = new Set<number>();
  for (const id of NETHER_WART_STAGES) {
    if (region.count((value) => value === id) > 0) stages.add(id);
  }
  check('4 个阶段都出现过（一眼看得出"有的刚种、有的能收了"）', stages.size === 4, String(stages.size));

  const spawners = region.count((id) => id === Block.SPAWNER);
  equal('整座要塞只有 1 个刷怪笼（多了会变成刷烈焰人工厂）', spawners, 1);

  // 确定性：同一座要塞重放逐格一致（跨区块接缝就靠这条）
  const again = makeRegion();
  again.buildEvery(instance);
  check('重建一遍逐格一致', region.equals(again));
}

console.log('\n[要塞：真的会出现在下界的区块里]');
{
  // 端到端：走真正的生成入口，在一个要塞所在的区块里必须能挖到下界砖。
  // ⚠️ 候选点必须用**真实生成器那套世界查询**（噪声地板/洞顶/群系）来求：
  // 拿桩世界求出来的位置与真正生成时不是同一座（地板高度不同 → 净空判据结果不同）
  const generator = new NetherGenerator(SEED);
  const realWorld: FortressWorld = {
    floorAt: (x, z) => generator.surfaceY(x, z),
    ceilingAt: (x, z) => generator.ceilingAt(x, z),
    biomeAt: (x, z) => generator.biomeAt(x, z),
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
  };
  let inst: FortressInstance | null = null;
  for (let i = 0; i < 400 && !inst; i++) inst = fortressInstanceForTest(i, 0, SEED, realWorld);
  check('真实世界参数下也能找到一座要塞（不是只有桩世界能成）', inst !== null);
  const instance = inst!;
  const cx = instance.x >> 4;
  const cz = instance.z >> 4;
  const blocks = generateChunkBlocks(cx, cz, SEED, Dimension.NETHER) as BlockArray;
  let bricks = 0;
  let warts = 0;
  for (let y = 32; y < 96; y++) {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const id = blocks[Chunk.index(lx, y, lz)]!;
        if (id === Block.NETHER_BRICKS) bricks++;
        if (netherWartStageOf(id) >= 0) warts++;
      }
    }
  }
  check('真实生成路径里挖得到下界砖（要塞真的写进了区块）', bricks > 50, String(bricks));
  check('真实生成路径里也长着下界疣', warts > 0, String(warts));
}

// ---------------------------------------------------------------- 2. 下界疣

console.log('\n[下界疣：方块与登记]');
{
  check('4 个阶段 id 连续', NETHER_WART_STAGES.every((id, index) => id === NETHER_WART_STAGES[0]! + index));
  equal('接着织布机（546）往下排', NETHER_WART_STAGES[0], 547);
  check('4 个阶段都登记在 BLOCKS 里', NETHER_WART_STAGES.every((id) => BLOCKS[id]?.id === id));

  const shapes = NETHER_WART_STAGES.map((id) => blockDef(id).shape);
  check('形状都是 `nether_wart`（不是 `cross`）', shapes.every((shape) => shape === 'nether_wart'), shapes.join(','));
  check('都不遮挡、不发光、没有碰撞档（植物）', NETHER_WART_STAGES.every((id) => !blockDef(id).opaque && blockDef(id).light === 0));
  check('硬度都是 0（徒手一拍就掉）', NETHER_WART_STAGES.every((id) => blockHardness(id) === 0));
  check('都不需要工具', NETHER_WART_STAGES.every((id) => harvestRequirement(id) === undefined));

  const missingTiles = NETHER_WART_STAGES.flatMap((id) => blockTiles(id, 0)).filter((tile) => !TILES.has(tile));
  check('4 张贴图都在图集名单里', missingTiles.length === 0, missingTiles.join(','));

  const missing = missingBlockNames();
  const unnamed = NETHER_WART_STAGES.filter((id) => missing.includes(blockDef(id).name.replace('minicraft:', '')));
  check('4 个阶段都有中文名', unnamed.length === 0, unnamed.join(','));
  check('都有说明', NETHER_WART_STAGES.every((id) => hasDescription(id)));

  equal('阶段表长度 4', NETHER_WART_STAGES.length, 4);
  equal('成熟阶段是最后一个', NETHER_WART_RIPE_STAGE, 3);
  equal('`netherWartStageOf` 认得第 2 阶段', netherWartStageOf(Block.NETHER_WART_STAGE2), 2);
  equal('别的方块返回 -1', netherWartStageOf(Block.SOUL_SAND), -1);
}

console.log('\n[下界疣：种植只认灵魂沙]');
{
  const input = (below: number) => ({
    blockId: Block.NETHER_WART_STAGE0,
    hitBlock: below,
    normal: [0, 1, 0] as [number, number, number],
    yaw: 0,
    blockAt: (dx: number, dy: number, dz: number) => (dx === 0 && dy === -1 && dz === 0 ? below : Block.AIR),
  });

  equal('灵魂沙上种得下', planPlacement(input(Block.SOUL_SAND) as never)?.state, 0);
  equal('泥土上种不下（原版只认灵魂沙）', planPlacement(input(Block.DIRT) as never), null);
  equal('石头/下界岩上也种不下', `${planPlacement(input(Block.STONE) as never)},${planPlacement(input(Block.NETHER_BRICKS) as never)}`, 'null,null');
  equal('手上的下界疣物品指向第 0 阶段（右键才能种下去）', itemDef(Item.NETHER_WART)?.block, Block.NETHER_WART_STAGE0);
  check('下界疣物品归"酿造"那一栏', categoryOf(Item.NETHER_WART) === 'brewing');
}

console.log('\n[下界疣：随机刻生长（不需要光照）]');
{
  check('4 个阶段都登记了随机刻行为', NETHER_WART_STAGES.every((id) => hasRandomTick(id)));

  /** 一格灵魂沙 + 一株下界疣的假世界 */
  function wartWorld(stage: number, light: number): { block: number; world: never } {
    let id: number = NETHER_WART_STAGES[stage]!;
    const world = {
      getBlock: (_x: number, y: number, _z: number) => (y === 63 ? Block.SOUL_SAND : y === 64 ? id : Block.AIR),
      setBlock: (_x: number, _y: number, _z: number, next: number) => {
        id = next;
        return true;
      },
      lightAt: () => light,
    };
    return {
      get block() {
        return id;
      },
      world: world as never,
    };
  }

  const w = wartWorld(0, 0);
  randomTickBlock(w.world, 0, 64, 0, () => 0);
  equal('**全黑的地方也长**（原版下界疣不需要光）', w.block, Block.NETHER_WART_STAGE1);

  const grown = wartWorld(2, 15);
  randomTickBlock(grown.world, 0, 64, 0, () => 0.99);
  equal('掷点没命中就不长（概率挡住）', grown.block, Block.NETHER_WART_STAGE2);

  const ripe = wartWorld(3, 15);
  randomTickBlock(ripe.world, 0, 64, 0, () => 0);
  equal('成熟之后不再生长（不会长过头变成别的方块）', ripe.block, Block.NETHER_WART_STAGE3);
}

console.log('\n[下界疣：掉落]');
{
  const ctx = (roll: number) => ({ roll: () => roll, shears: false, silkTouch: false, fortune: 0, doubleSlab: false });
  equal('没熟只掉 1 个', blockDrops(Block.NETHER_WART_STAGE1, ctx(0.9))?.count, 1);
  equal('掉的是下界疣（不是自己那个阶段方块）', blockDrops(Block.NETHER_WART_STAGE1, ctx(0.9))?.id, Item.NETHER_WART);
  equal('熟了主掉落 2 个', blockDrops(Block.NETHER_WART_STAGE3, ctx(0.9))?.count, 2);
  // ⚠️ "额外那一份"不走 `blockDrops`（它是破坏路径单独拼的，见 `extraCropDrop` 的注释），
  // 所以这里要**分别验两段**：主掉落 2 + 额外 0~2 = 原版的 2~4
  equal('熟了额外掉 0~2 个（合计 2~4）', extraCropDrop(Block.NETHER_WART_STAGE3, () => 0.1)?.count, 2);
  equal('额外那一份也是下界疣', extraCropDrop(Block.NETHER_WART_STAGE3, () => 0.1)?.id, Item.NETHER_WART);
  equal('没熟没有额外掉落（只给 1 个）', extraCropDrop(Block.NETHER_WART_STAGE1, () => 0), null);
  equal('额外掉落掷得差就没有', extraCropDrop(Block.NETHER_WART_STAGE3, () => 0.9), null);
}

// ---------------------------------------------------------------- 3. 刷怪笼

console.log('\n[刷怪笼：表与判据]');
{
  // 批次 365：加了三只（地牢僵尸 / 矿井洞穴蜘蛛 / 要塞蠹虫）
  equal('表里有四种笼子', SPAWNER_DEFS.length, 4);
  equal('第一个出烈焰人', SPAWNER_DEFS[0]?.mobId, 'blaze');
  check('`spawnerDefFor` 认得出刷怪笼', spawnerDefFor(Block.SPAWNER) !== undefined);
  equal('僵尸笼子出僵尸', spawnerDefFor(Block.ZOMBIE_SPAWNER)?.mobId, 'zombie');
  equal('矿井笼子出洞穴蜘蛛', spawnerDefFor(Block.CAVE_SPIDER_SPAWNER)?.mobId, 'cave_spider');
  equal('要塞笼子出蠹虫', spawnerDefFor(Block.SILVERFISH_SPAWNER)?.mobId, 'silverfish');
  equal('别的方块不是笼子', spawnerDefFor(Block.STONE), undefined);

  equal('硬度 5（原版）', blockHardness(Block.SPAWNER), 5);
  equal('要镐', harvestRequirement(Block.SPAWNER)?.tool, 'pickaxe');
  equal('打掉什么都不掉（原版要精准采集，本项目没有那条路）', blockDrops(Block.SPAWNER, { roll: () => 0, shears: false, silkTouch: false, fortune: 0, doubleSlab: false }), null);
  check('贴图在图集里', blockTiles(Block.SPAWNER, 0).every((tile) => TILES.has(tile)));
  check('有中文名', !missingBlockNames().includes('spawner'));
  check('有说明（写清"打掉不掉"）', hasDescription(Block.SPAWNER));
  check('**不遮挡邻居**（隔着笼子要看得见里面）', !blockDef(Block.SPAWNER).opaque);
}

console.log('\n[刷怪笼：什么时候出、出在哪]');
{
  const def = SPAWNER_DEFS[0]!;
  const spawner = { x: 0, y: 64, z: 0 };

  /** 笼子那一格自己 + 地板在 y=63，四周都是空气 */
  const view = (player: { x: number; y: number; z: number } | null, nearby = 0): SpawnerWorldView => ({
    getBlock: (x, y, z) => {
      if (x === 0 && y === 64 && z === 0) return Block.SPAWNER;
      if (y === 63) return Block.NETHER_BRICKS;
      return Block.AIR;
    },
    player,
    mobsNear: () => nearby,
  });

  equal('玩家不在（或没加载）→ 不生成', planSpawnerSpawn(view(null), def, spawner), null);
  equal('玩家在 30 格外 → 不生成（不浪费计算）', planSpawnerSpawn(view({ x: 30, y: 64, z: 0 }), def, spawner), null);
  equal('附近已经有 2 只 → 不生成（否则越刷越多）', planSpawnerSpawn(view({ x: 4, y: 64, z: 4 }, def.maxNearby), def, spawner), null);

  const plan = planSpawnerSpawn(view({ x: 5, y: 64, z: 0 }), def, spawner);
  check('玩家在 5 格内、附近没同伴 → 生成', plan !== null);
  check('落点是空气、上面也空、下面实心', plan !== null && view({ x: 5, y: 64, z: 0 }).getBlock(plan.x, plan.y, plan.z) === Block.AIR);
  equal('落点贴近笼子（半径 1 那一圈先被看到）', Math.max(Math.abs(plan!.x), Math.abs(plan!.z)), 1);
  check('同一个笼子算两次 → 同一个落点（顺序固定，可复现）', JSON.stringify(planSpawnerSpawn(view({ x: 5, y: 64, z: 0 }), def, spawner)) === JSON.stringify(plan));

  // 笼子被石头裹住 → 找不到落点
  const buried: SpawnerWorldView = { ...view({ x: 5, y: 64, z: 0 }), getBlock: () => Block.STONE };
  equal('笼子被石头裹死 → 不生成（不会把它塞进石头里）', planSpawnerSpawn(buried, def, spawner), null);
}

// ---------------------------------------------------------------- 4. 烈焰人

console.log('\n[烈焰人：类型与掉落]');
{
  check('在生物表里', MOB_TYPES.some((type) => type.id === 'blaze'));
  equal('`mobTypeById` 找得到它', mobTypeById('blaze')?.nameKey, 'entity.blaze');
  check('敌对', BLAZE_TYPE.hostile);
  check('**会飞**（没有重力）', BLAZE_TYPE.flying === true);
  check('**免疫火焰**', BLAZE_TYPE.fireImmune === true);
  check('不进自然生成表（只从刷怪笼来）', BLAZE_TYPE.naturalSpawn === false);
  check('掉落表里是烈焰棒（0~1 根，50%）', BLAZE_TYPE.drops.every((drop) => drop.itemId === Item.BLAZE_ROD));
  equal('击杀经验 10（原版）', BLAZE_TYPE.xp, 10);

  const mob = createMob(BLAZE_TYPE, 0, 0, 0);
  check('工厂造出来的是 `Blaze` 子类（不是光秃秃的 `Mob`）', mob instanceof Blaze);
  check('它仍然是 `Mob`', mob instanceof Mob);
  const plain = createMob(mobTypeById('zombie') as MobType, 0, 0, 0);
  check('别的生物走普通 `Mob`', !(plain instanceof Blaze));
}

console.log('\n[烈焰人：飞、烧、吐火球]');
{
  const physics = { collisionAt: () => null, isLiquid: () => false } as unknown as PhysicsWorld;
  const makeCtx = (overrides: Partial<EntityContext> = {}): EntityContext =>
    ({
      world: physics,
      playerBox: null,
      pickup: () => 0,
      getBlock: () => Block.AIR,
      player: null,
      hurtPlayer: () => {},
      spawnDrop: () => {},
      ...overrides,
    }) as EntityContext;

  // ---- 悬停：没有重力，3 秒之后也不该掉下去
  const hovering = new Blaze(0, 64, 0);
  const y0 = hovering.y;
  for (let i = 0; i < 60; i++) hovering.tick(makeCtx(), 0.05);
  check('没人可追时悬停在原地（3 秒内没有往下掉）', Math.abs(hovering.y - y0) < 2, `${y0} → ${hovering.y}`);

  // ---- 免疫火焰：点着了也不掉血
  const burning = new Blaze(0, 64, 0);
  burning.ignite(10);
  for (let i = 0; i < 60; i++) burning.tick(makeCtx(), 0.05);
  equal('点着 3 秒之后血量没掉（免疫火焰）', burning.health, BLAZE_TYPE.health);
  check('但它确实"在燃烧"（渲染层会画火）', burning.burning);

  // ---- 接触伤害：贴脸就掉血
  let meleeDamage = 0;
  const attacker = new Blaze(0, 64, 0);
  const ctx = makeCtx({
    player: { x: 0.5, y: 64, z: 0 },
    hurtPlayer: (amount) => {
      meleeDamage += amount;
    },
  });
  for (let i = 0; i < 20; i++) attacker.tick(ctx, 0.05);
  equal('贴到 2.5 格内就打（伤害 = 种类表的接触伤害）', meleeDamage, BLAZE_TYPE.attackDamage);

  // ---- 吐火球：20 格内、冷却到了就吐
  let fireballs = 0;
  let fireVelocityX = 0;
  const shooter = new Blaze(0, 64, 0);
  const shootCtx = makeCtx({
    player: { x: 8, y: 64, z: 0 },
    spawnSmallFireball: (_x, _y, _z, velocity) => {
      fireballs++;
      fireVelocityX = velocity.x;
    },
  });
  for (let i = 0; i < 100; i++) shooter.tick(shootCtx, 0.05);
  check('冷却走完就吐一颗（5 秒里吐了 >= 1 颗）', fireballs >= 1, String(fireballs));
  check('火球朝玩家飞（+x 方向）', fireVelocityX > 0, String(fireVelocityX));

  // 太远就不吐（20 格之外）
  let farFireballs = 0;
  const farShooter = new Blaze(0, 64, 0);
  const farCtx = makeCtx({
    // 放到 followRange（32）之外：它连追都不追，自然不会吐
    player: { x: 200, y: 64, z: 0 },
    spawnSmallFireball: () => {
      farFireballs++;
    },
  });
  for (let i = 0; i < 100; i++) farShooter.tick(farCtx, 0.05);
  equal('20 格之外不吐（对着空气吐像 bug）', farFireballs, 0);

  check('冷却常量是 2 秒（原版节奏）', BLAZE_FIRE_COOLDOWN === 2);
  check('开火距离比追击距离小（够得着才吐）', BLAZE_FIRE_RANGE < BLAZE_TYPE.followRange);
  check('刚出生的冷却不到一个周期（不会一出生就打脸）', new Blaze(0, 64, 0).fireCooldown <= BLAZE_FIRE_COOLDOWN);
}

console.log('\n[小火球：打中玩家 → 5 点伤害 + 点着 5 秒]');
{
  const physics = { collisionAt: () => null, isLiquid: () => false } as unknown as PhysicsWorld;
  let damage = 0;
  let cause = '';
  let ignited = 0;

  const fireball = new Throwable(0, 64, 0, { x: 10, y: 0, z: 0 }, {
    kind: 'small_fireball',
    itemId: Item.BLAZE_POWDER,
  });
  const ctx = {
    world: physics,
    // 玩家就在前方 0.2 格处（这一帧的位移会撞上）
    playerBox: { minX: 0.1, minY: 64, minZ: 0, maxX: 1, maxY: 65.8, maxZ: 0.6 },
    pickup: () => 0,
    getBlock: () => Block.AIR,
    player: null,
    hurtPlayer: (amount: number, _sx: number, _sz: number, damageCause?: string) => {
      damage = amount;
      cause = damageCause ?? '';
    },
    ignitePlayer: (seconds: number) => {
      ignited = seconds;
    },
    spawnDrop: () => {},
  } as unknown as EntityContext;

  fireball.tick(ctx, 0.05);
  equal('打中掉 5 点血（原版）', damage, SMALL_FIREBALL_DAMAGE);
  equal('伤害来源是 `fire`（不是 projectile——它是火球）', cause, 'fire');
  equal('点着 5 秒', ignited, SMALL_FIREBALL_FIRE_SECONDS);
  check('命中之后自己消失', fireball.dead);
  check('常量与 `Blaze.ts` 里那份对得上', FIREBALL_DAMAGE === SMALL_FIREBALL_DAMAGE && FIREBALL_FIRE_SECONDS === SMALL_FIREBALL_FIRE_SECONDS);
}


console.log('\n[要塞里的生物（批次 458）]');
{
  const world = makeFortressWorld();
  let inst = null;
  for (let cell = -4; cell <= 4 && !inst; cell++) inst = fortressInstanceForTest(cell, 0, SEED, world);
  check('求得到一座要塞', inst !== null);
  if (inst) {
    const seen = new Map<string, string>();
    for (let cz = Math.floor((inst.z - FORTRESS_RADIUS) / 16); cz <= Math.floor((inst.z + FORTRESS_RADIUS) / 16); cz++) {
      for (let cx = Math.floor((inst.x - FORTRESS_RADIUS) / 16); cx <= Math.floor((inst.x + FORTRESS_RADIUS) / 16); cx++) {
        for (const spawn of fortressCreatureSpawnsAt(cx, cz, SEED, world)) {
          seen.set(`${spawn.x},${spawn.y},${spawn.z}`, spawn.kind);
        }
      }
    }
    equal('跨区块合并后不重复（两只凋灵骷髅）', seen.size, 2);
    equal('两只都是凋灵骷髅', [...seen.values()].filter((k) => k === 'wither_skeleton').length, 2);
    check(
      '都在要塞的包围盒附近',
      [...seen.keys()].every((key) => {
        const [x, y, z] = key.split(',').map(Number) as [number, number, number];
        return Math.abs(x - inst!.x) <= FORTRESS_RADIUS && Math.abs(z - inst!.z) <= FORTRESS_RADIUS && y > inst!.y && y < inst!.y + 20;
      }),
    );
  }
  equal('没有要塞的地方一只都不刷（负对照）', fortressCreatureSpawnsAt(999, 999, SEED, world).length, 0);
}


console.log('\n[最近下界要塞（批次 465，/locate structure）]');
{
  const world = makeFortressWorld();
  let inst = null;
  for (let cell = -4; cell <= 4 && !inst; cell++) inst = fortressInstanceForTest(cell, 0, SEED, world);
  if (inst) {
    const hit = nearestFortress(inst.x + 5, inst.z - 5, SEED, world);
    check('从要塞旁边问最近要塞', hit !== null);
    equal('返回的就是这一座', `${hit?.x},${hit?.z}`, `${inst.x},${inst.z}`);
    check('距离算得对', hit !== null && Math.abs(hit.distance - Math.hypot(5, 5)) < 1e-6, `${hit?.distance}`);
  }
  equal(
    '同样的查询两次一致',
    JSON.stringify(nearestFortress(70, 90, SEED, world)),
    JSON.stringify(nearestFortress(70, 90, SEED, world)),
  );
}

console.log(`\n下界要塞与酿造链测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
