/**
 * 海带与海草（批次 50，B17 的最后一样"要地物"的食物）离线测试
 *
 * 这一批真正新增的机制是"**水里能长的植物**"：本项目的水是流体方块（水占着那一格），
 * 所以"种在水里"意味着植物**替换掉那一格水**——三处判定都跟着这条走：
 *  1. 放置：落点那一格必须是水（`Placement.ts`）
 *  2. 不被冲走：`Fluids.canFlowInto` 见到它就返回 false（否则旁边的水当它可替换，一放就没）
 *  3. 生成：`FeatureWriter#putInWater` 只认水（海底没水的地方自然长不出来）
 *
 * 断言按七块组织：注册与贴图 / 放置 / 流体 / 生长与枯萎 / 掉落 / 加工链 / 世界生成。
 *
 * 运行：npm run test:kelp
 */

import { isHandHarvestable } from '../web/src/core/registry/tools.ts';
import {
  Block,
  KELP_MAX_HEIGHT,
  blockDef,
} from '../web/src/core/registry/blocks.ts';
import { collisionBoxes } from '../web/src/core/registry/blockShapes.ts';
import {
  CREATIVE_ITEMS,
  Item,
  blockDrops,
  categoryOf,
  dropFor,
  foodInfoById,
  itemDef,
  requiresShears,
  type DropContext,
} from '../web/src/core/registry/items.ts';
import { FOOD_TABLE, saturationFrom } from '../web/src/core/registry/food.ts';
import { hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { RANDOM_TICK_BEHAVIORS, KELP_GROW_CHANCE, type TickWorld } from '../web/src/core/tick/RandomTicks.ts';
import { canFlowInto, fluidTick, type FluidWorld } from '../web/src/core/world/Fluids.ts';
import { planPlacement } from '../web/src/core/interaction/Placement.ts';
import { SMELTING_RECIPES, fuelSeconds, isFuel, smeltingRecipeFor } from '../web/src/core/crafting/Smelting.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { BIOME_FEATURES, SEA_LEVEL, decorate, type FeatureWorld } from '../web/src/core/gen/Features.ts';
import { BIOME_TABLE, Biome } from '../web/src/core/gen/Biome.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk, type BlockArray } from '../web/src/core/world/Chunk.ts';

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

const KELP = Block.KELP;
const SEAGRASS = Block.SEAGRASS;
const DRIED_BLOCK = Block.DRIED_KELP_BLOCK;
const TILES = TILE_ORDER as readonly string[];

// ---------------------------------------------------------------- 工具

/** 只够海带生长用的最小世界：方块 + 掉落记录（海带不看光照、不看状态） */
class KelpWorld implements TickWorld {
  private readonly blocks = new Map<string, number>();
  readonly drops: { id: number; count: number }[] = [];

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: number): void {
    this.blocks.set(KelpWorld.key(x, y, z), id);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(KelpWorld.key(x, y, z)) ?? Block.AIR;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.set(x, y, z, id);
    return true;
  }

  drop(id: number, count: number): void {
    this.drops.push({ id, count });
  }
}

/** 一定过概率门 / 一定不过概率门的随机源 */
const pass = () => 0;
const fail = () => KELP_GROW_CHANCE + 0.01;

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

/** 固定高度、固定群系的测试世界 */
function flatWorld(surfaceY: number, biomeId: number): FeatureWorld {
  const biome = BIOME_TABLE[biomeId]!;
  return { surfaceY: () => surfaceY, columnBiome: () => biome };
}

function countBlocks(blocks: BlockArray, ids: readonly number[]): number {
  let count = 0;
  for (const id of blocks) if (ids.includes(id)) count++;
  return count;
}

// ---------------------------------------------------------------- 1. 注册与贴图

console.log('\n[注册与贴图]');
{
  equal('海带的注册名', blockDef(KELP).name, 'minicraft:kelp');
  equal('海草的注册名', blockDef(SEAGRASS).name, 'minicraft:seagrass');
  equal('干海带块的注册名', blockDef(DRIED_BLOCK).name, 'minicraft:dried_kelp_block');
  equal('海带的 id 接着最大 id（连续）', blockDef(KELP + 1).id, KELP + 1);
  equal('海草的 id 接着海带', SEAGRASS, KELP + 1);
  equal('干海带块的 id 接着海草', DRIED_BLOCK, SEAGRASS + 1);

  check('海带被标成"水里的植物"', blockDef(KELP).waterPlant === true);
  check('海草被标成"水里的植物"', blockDef(SEAGRASS).waterPlant === true);
  check('干海带块**不是**水里的植物（它是普通方块）', blockDef(DRIED_BLOCK).waterPlant === false);

  equal('海带走 cross 形状（两片交叉薄面）', blockDef(KELP).shape, 'cross');
  equal('海草走 cross 形状', blockDef(SEAGRASS).shape, 'cross');
  equal('海带没有碰撞体（游过去不会被挡）', collisionBoxes(blockDef(KELP).shape, 0).length, 0);
  equal('海草没有碰撞体', collisionBoxes(blockDef(SEAGRASS).shape, 0).length, 0);
  check('海带不遮挡邻居（否则会剔掉旁边水面的面）', !blockDef(KELP).opaque);
  check('海草不遮挡邻居', !blockDef(SEAGRASS).opaque);

  check(
    '五张贴图都在图集名单里',
    ['kelp', 'seagrass', 'dried_kelp_top', 'dried_kelp_side', 'item_dried_kelp'].every((tile) => TILES.includes(tile)),
  );
  equal('海带的中文名', itemLabel(KELP), '海带');
  equal('海草的中文名', itemLabel(SEAGRASS), '海草');
  equal('干海带的中文名', itemLabel(Item.DRIED_KELP), '干海带');
  equal('干海带块的中文名', itemLabel(DRIED_BLOCK), '干海带块');
  check(
    '四件东西都有说明',
    [KELP, SEAGRASS, Item.DRIED_KELP, DRIED_BLOCK].every((id) => hasDescription(id)),
  );

  check('海带徒手可采（硬度 0，一碰就掉）', isHandHarvestable(KELP));
  check('海草徒手可采（挖得动，但徒手不掉东西）', isHandHarvestable(SEAGRASS));
  check('干海带块徒手可采', isHandHarvestable(DRIED_BLOCK));

  check(
    '三件都在创造物品栏里',
    [KELP, SEAGRASS, DRIED_BLOCK].every((id) => CREATIVE_ITEMS.includes(id)),
  );
  equal('海带归"自然"分类', categoryOf(KELP), 'natural');
  equal('海草归"自然"分类', categoryOf(SEAGRASS), 'natural');
  equal('干海带块归"自然"分类', categoryOf(DRIED_BLOCK), 'natural');
  equal('干海带归"食物"分类', categoryOf(Item.DRIED_KELP), 'food');
  equal('干海带能堆 64', itemDef(Item.DRIED_KELP)?.maxStack, 64);
}

// ---------------------------------------------------------------- 2. 放置规则

console.log('\n[放置规则：落点必须是水]');
{
  /** 造一个"落点那一格是 water、下面一块是 floor"的放置上下文 */
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
      blockAt: (dx, dy, dz) => (dx === 0 && dy === 0 && dz === 0 ? target : dx === 0 && dy === -1 && dz === 0 ? below : Block.AIR),
      hitBlock: below,
      hitState: 0,
    });

  check('海带：水下对着海底右键 → 能种（落点是水、下面是实心）', place(KELP, Block.WATER, Block.SAND) !== null);
  check('海草：同样能种', place(SEAGRASS, Block.WATER, Block.SAND) !== null);
  check('海带：落点是空气 → 拒绝（它长在水里，不是在岸上）', place(KELP, Block.AIR, Block.SAND) === null);
  check('海带：落点是水但下面是水（悬在水中） → 拒绝', place(KELP, Block.WATER, Block.WATER) === null);
  check('海带：落点是石头 → 拒绝', place(KELP, Block.STONE, Block.SAND) === null);
  check(
    '海带：落点是水、下面是**已有的海带** → 能种（在原株上续一节，原版就是这样种高海带的）',
    place(KELP, Block.WATER, KELP) !== null,
  );
  check(
    '干海带块是普通方块：走通用放置（落点是空气也能放）',
    place(DRIED_BLOCK, Block.AIR, Block.STONE) !== null,
  );
}

// ---------------------------------------------------------------- 3. 流体：冲不走

console.log('\n[流体：水不会把海带冲掉]');
{
  /** 最小的 FluidWorld：一格固定的方块表 */
  class FlowWorld implements FluidWorld {
    readonly blocks = new Map<string, { id: number; state: number }>();
    readonly scheduled: string[] = [];

    private static k(x: number, y: number, z: number): string {
      return `${x},${y},${z}`;
    }
    set(x: number, y: number, z: number, id: number, state = 0): void {
      this.blocks.set(FlowWorld.k(x, y, z), { id, state });
    }
    getBlock(x: number, y: number, z: number): number {
      return this.blocks.get(FlowWorld.k(x, y, z))?.id ?? Block.AIR;
    }
    getState(x: number, y: number, z: number): number {
      return this.blocks.get(FlowWorld.k(x, y, z))?.state ?? 0;
    }
    setFluid(x: number, y: number, z: number, id: number, state: number): boolean {
      this.set(x, y, z, id, state);
      return true;
    }
    schedule(x: number, y: number, z: number): void {
      this.scheduled.push(FlowWorld.k(x, y, z));
    }
  }

  const world = new FlowWorld();
  world.set(0, 64, 0, KELP);
  world.set(1, 64, 0, Block.WATER, 0); // 旁边一格水源
  check('水**进不去**海带那一格（canFlowInto = false）', !canFlowInto(world, 0, 64, 0));
  check('水**进得去**空气那一格（对照）', canFlowInto(world, 0, 65, 0));

  // 让旁边那格水流动一刻——它不该动海带这一格
  world.set(1, 64, 0, Block.WATER, 0);
  world.set(1, 63, 0, Block.STONE);
  world.set(1, 65, 0, Block.STONE);
  world.set(0, 63, 0, Block.STONE);
  world.set(2, 64, 0, Block.STONE);
  fluidTick(world, 1, 64, 0);
  equal('旁边的水流过之后，海带还在原地', world.getBlock(0, 64, 0), KELP);
}

// ---------------------------------------------------------------- 4. 生长与枯萎

console.log('\n[生长：只由顶端往上长]');
{
  const kelpBehavior = RANDOM_TICK_BEHAVIORS.get(KELP)!;
  check('海带登记了随机刻行为', kelpBehavior !== undefined);
  check('海草**没有**随机刻行为（它是不生长的草丛）', RANDOM_TICK_BEHAVIORS.get(SEAGRASS) === undefined);

  /** 一株立在海面上的海带：海底在 `floorY`、往上 `segments` 节海带、再往上到 63 全是水 */
  const planted = (segments: number, floorY = 40) => {
    const world = new KelpWorld();
    world.set(0, floorY, 0, Block.SAND);
    for (let i = 0; i < segments; i++) world.set(0, floorY + 1 + i, 0, KELP);
    for (let y = floorY + 1 + segments; y <= SEA_LEVEL; y++) world.set(0, y, 0, Block.WATER);
    return world;
  };
  /** 够《26 节 + 顶上还有水》的深海底（用来单独验封顶那条，别被"顶到水面"抢先拦住） */
  const DEEP_FLOOR = SEA_LEVEL - KELP_MAX_HEIGHT - 2;

  const one = planted(1);
  const grew = kelpBehavior(one, 0, 41, 0, pass);
  check('顶端上面是水 → 长高一节', grew && one.getBlock(0, 42, 0) === KELP);
  equal('长高不掉东西', one.drops.length, 0);

  const noLuck = planted(1);
  check(
    '概率没过就不长（随机刻该有的稀疏感）',
    !kelpBehavior(noLuck, 0, 41, 0, fail) && noLuck.getBlock(0, 42, 0) === Block.WATER,
  );

  // 中间那一节不负责生长：上面还有海带 → 直接返回 false
  const two = planted(2);
  check(
    '中间那一节不长（上方是同种方块 → 我不是顶端）',
    !kelpBehavior(two, 0, 41, 0, pass) && two.getBlock(0, 43, 0) === Block.WATER,
  );
  check('顶端那一节才长', kelpBehavior(two, 0, 42, 0, pass) && two.getBlock(0, 43, 0) === KELP);

  // 长到水面：上方只有一格水时不许长（否则长出去立刻枯死，一长一死来回抖）
  const surface = planted(1);
  surface.set(0, 42, 0, Block.WATER);
  surface.set(0, 43, 0, Block.AIR);
  check(
    '上方只有一格水（长出去就顶到水面）→ 不长',
    !kelpBehavior(surface, 0, 41, 0, pass) && surface.getBlock(0, 42, 0) === Block.WATER,
  );

  // 封顶 26（用深海：这株长满之后顶上还有水，"顶到水面"那条不会抢先拦它）
  const tall = planted(KELP_MAX_HEIGHT, DEEP_FLOOR);
  check(
    `已经 ${KELP_MAX_HEIGHT} 格（原版封顶）就不再长`,
    !kelpBehavior(tall, 0, DEEP_FLOOR + KELP_MAX_HEIGHT, 0, pass),
  );
  const belowMax = planted(KELP_MAX_HEIGHT - 1, DEEP_FLOOR);
  check(
    `${KELP_MAX_HEIGHT - 1} 格时还能长最后一节`,
    kelpBehavior(belowMax, 0, DEEP_FLOOR + KELP_MAX_HEIGHT - 1, 0, pass) &&
      belowMax.getBlock(0, DEEP_FLOOR + KELP_MAX_HEIGHT, 0) === KELP,
  );
}

console.log('\n[枯萎：离开水就毁掉]');
{
  const kelpBehavior = RANDOM_TICK_BEHAVIORS.get(KELP)!;
  // 一株顶端露在水面外面的海带（水被放干 / 被方块填掉）
  const dried = new KelpWorld();
  dried.set(0, 40, 0, Block.SAND);
  dried.set(0, 41, 0, KELP);
  dried.set(0, 42, 0, Block.AIR);
  check(
    '顶端不在水里 → 整格枯萎（原版：海带离开水就毁）',
    kelpBehavior(dried, 0, 41, 0, fail) && dried.getBlock(0, 41, 0) === Block.AIR,
  );
  equal('枯萎会掉 1 个海带（不是白毁）', dried.drops.length, 1);
  equal('掉的是海带', dried.drops[0]?.id, KELP);
  equal('掉 1 个', dried.drops[0]?.count, 1);

  // 被方块压住也算离开水
  const blocked = new KelpWorld();
  blocked.set(0, 40, 0, Block.SAND);
  blocked.set(0, 41, 0, KELP);
  blocked.set(0, 42, 0, Block.STONE);
  check('上方被实心方块占住 → 同样枯萎', kelpBehavior(blocked, 0, 41, 0, fail));

  // 一格一格地倒：拆掉最上面那节后，下面那节自己也会枯萎
  const stacked = new KelpWorld();
  stacked.set(0, 40, 0, Block.SAND);
  stacked.set(0, 41, 0, KELP);
  stacked.set(0, 42, 0, KELP);
  stacked.set(0, 43, 0, Block.AIR);
  kelpBehavior(stacked, 0, 42, 0, fail);
  equal('上面那节先枯', stacked.getBlock(0, 42, 0), Block.AIR);
  check('下面那节等自己的随机刻也会枯（不会留下悬空的一截）', kelpBehavior(stacked, 0, 41, 0, fail));
  equal('最终整株都没了', stacked.getBlock(0, 41, 0), Block.AIR);
  equal('两节各掉 1 个海带', stacked.drops.length, 2);
}

// ---------------------------------------------------------------- 5. 掉落

console.log('\n[掉落]');
{
  const ctx = (over: Partial<DropContext> = {}): DropContext => ({
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0.99,
    ...over,
  });

  equal('海带破坏掉自身', dropFor(KELP)?.id, KELP);
  equal('海带一次掉 1 个', dropFor(KELP)?.count, 1);
  equal('干海带块破坏掉自身', dropFor(DRIED_BLOCK)?.id, DRIED_BLOCK);

  check('海草"必须用剪刀"（徒手一无所有）', requiresShears(SEAGRASS));
  check('海带**不**要求剪刀（徒手就能拔）', !requiresShears(KELP));
  equal('海草徒手破坏 → 什么都不掉', blockDrops(SEAGRASS, ctx()), null);
  equal('海草用剪刀 → 掉 1 个海草', blockDrops(SEAGRASS, ctx({ shears: true }))?.id, SEAGRASS);
  equal(
    '海草精准采集 → **也**不给（原版掉落判定只认剪刀）',
    blockDrops(SEAGRASS, ctx({ silkTouch: true })),
    null,
  );
  equal('海带徒手破坏 → 掉海带', blockDrops(KELP, ctx())?.id, KELP);
}

// ---------------------------------------------------------------- 6. 加工链

console.log('\n[加工链：海带 → 干海带 → 干海带块 / 燃料]');
{
  const recipe = smeltingRecipeFor(KELP);
  equal('海带能烧成干海带', recipe?.output.id, Item.DRIED_KELP);
  equal('一次出 1 个', recipe?.output.count, 1);
  equal('经验 0.1（原版）', recipe?.experience, 0.1);
  equal('只有普通熔炉能做（海带不是食物，烟熏炉不收）', smeltingRecipeFor(KELP, 'smoker'), undefined);
  equal('营火也只能烤食物（同样不收海带）', smeltingRecipeFor(KELP, 'campfire'), undefined);
  equal(
    '普通熔炉那条在表里（对照）',
    SMELTING_RECIPES.some((r) => r.input === KELP),
    true,
  );

  equal('干海带块是燃料', isFuel(DRIED_BLOCK), true);
  equal('干海带块能烧 200 秒（原版 20 个东西）', fuelSeconds(DRIED_BLOCK), 200);
  equal('干海带本身**不是**燃料（原版只有块能烧）', fuelSeconds(Item.DRIED_KELP), 0);
  check('干海带块比煤炭更耐烧（原版 20 个 vs 8 个）', fuelSeconds(DRIED_BLOCK) > fuelSeconds(Item.COAL));

  const asBlock = matchRecipe([Item.DRIED_KELP, Item.DRIED_KELP, Item.DRIED_KELP, Item.DRIED_KELP, Item.DRIED_KELP, Item.DRIED_KELP, Item.DRIED_KELP, Item.DRIED_KELP, Item.DRIED_KELP], 3);
  equal('9 个干海带 → 1 块干海带块', asBlock?.id, DRIED_BLOCK);
  equal('数量是 1', asBlock?.count, 1);
  const back = matchRecipe([DRIED_BLOCK, 0, 0, 0], 2);
  equal('1 块干海带块 → 9 个干海带', back?.id, Item.DRIED_KELP);
  equal('拆出来是 9 个', back?.count, 9);

  const food = foodInfoById(Item.DRIED_KELP);
  equal('干海带能当食物', food !== undefined, true);
  equal('饥饿 1 点（原版）', food?.hunger, 1);
  equal('饱和度修饰值 0.3（= 0.6 ÷ (1 × 2)）', food?.saturationModifier, 0.3);
  equal('换算成饱和度点数 = 0.6', saturationFrom(FOOD_TABLE.dried_kelp!), 0.6);
}

// ---------------------------------------------------------------- 7. 世界生成

console.log('\n[世界生成：海底的海带林与海草]');
{
  const ocean = (biome: number, seed: number, floorY = 40) => {
    const chunk = oceanChunk(floorY);
    decorate(chunk, 0, 0, flatWorld(floorY, biome), seed);
    return chunk;
  };

  let kelpBlocks = 0;
  let columns = 0;
  const badPlacement: string[] = [];
  const badColumns: string[] = [];
  for (let seed = 1; seed <= 5; seed++) {
    const chunk = ocean(Biome.DEEP_OCEAN, seed);
    const seenColumns = new Set<string>();
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        // 从海底往上逐格看：海带的每一格都要"贴着一株连续的海带"
        let prev = chunk[Chunk.index(x, 40, z)]!;
        for (let y = 41; y <= SEA_LEVEL; y++) {
          if (chunk[Chunk.index(x, y, z)] !== KELP) {
            prev = chunk[Chunk.index(x, y, z)]!;
            continue;
          }
          kelpBlocks++;
          seenColumns.add(`${x},${z}`);
          // 海带只能长在水里（那一格本来就是水），且下方必须是海底或上一节海带
          if (prev !== KELP && prev !== Block.SAND && prev !== Block.STONE && prev !== Block.GRAVEL) {
            badPlacement.push(`${x},${y},${z} 下方是 ${blockDef(prev).name}`);
          }
          if (y < 41 || y > SEA_LEVEL) badPlacement.push(`${x},${y},${z} 不在水里`);
          prev = KELP;
        }
        // 顶端上方必须是水（"长出去就顶到水面"那条规则）
        const top = chunk[Chunk.index(x, SEA_LEVEL, z)]!;
        if (top === KELP && chunk[Chunk.index(x, SEA_LEVEL - 1, z)] !== KELP) {
          badColumns.push(`${x},${z}`);
        }
      }
    }
    columns += seenColumns.size;
  }
  check(`5 个种子在深海里长出 ${kelpBlocks} 格海带（期望 100+）`, kelpBlocks > 100, `实际 ${kelpBlocks}`);
  check(`覆盖 ${columns} 列（海带是成片长的，不是零星几根）`, columns > 40, `实际 ${columns}`);

  // 每一株都从海底开始（不允许悬空的一株）
  let floatingColumns = 0;
  {
    const chunk = ocean(Biome.DEEP_OCEAN, 3);
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        if (chunk[Chunk.index(x, 41, z)] !== KELP) continue;
        const below = chunk[Chunk.index(x, 40, z)]!;
        if (below === KELP || below === Block.AIR || below === Block.WATER) floatingColumns++;
      }
    }
  }
  equal('每株海带都从海底长起（没有悬空的一株）', floatingColumns, 0);
  check('海带不会长到水面之上（顶端停在水面下）', badColumns.length === 0, badColumns.slice(0, 3).join(' '));
  check('海带的落点全部合法（水里 + 有支撑）', badPlacement.length === 0, badPlacement.slice(0, 3).join(' '));

  let sea = 0;
  for (let seed = 1; seed <= 5; seed++) sea += countBlocks(ocean(Biome.DEEP_OCEAN, seed), [SEAGRASS]);
  check(`海草也长出来了（5 个种子共 ${sea} 丛）`, sea > 50, `实际 ${sea}`);

  // 海草不生长、也不悬空：每一丛下面都是实心海底
  const chunk = ocean(Biome.DEEP_OCEAN, 2);
  let floatingSeagrass = 0;
  for (let z = 0; z < CHUNK_SIZE_Z; z++) {
    for (let x = 0; x < CHUNK_SIZE_X; x++) {
      for (let y = 41; y <= SEA_LEVEL; y++) {
        if (chunk[Chunk.index(x, y, z)] !== SEAGRASS) continue;
        const below = chunk[Chunk.index(x, y - 1, z)]!;
        if (below !== Block.SAND && below !== Block.STONE && below !== Block.GRAVEL) floatingSeagrass++;
      }
    }
  }
  equal('每一丛海草都贴着自己的海底', floatingSeagrass, 0);

  // 群系约束：冷水海洋没有海带（原版如此），但海草照长
  const frozen = ocean(Biome.FROZEN_OCEAN, 3);
  equal('冷水海洋里没有海带（原版如此）', countBlocks(frozen, [KELP]), 0);
  check('冷水海洋仍有海草（原版四海皆有）', countBlocks(frozen, [SEAGRASS]) > 0);
  equal(
    '配置里确实只给冷水海洋配了海草',
    BIOME_FEATURES[Biome.FROZEN_OCEAN]!.kelp ?? 0,
    0,
  );
  check('深海配了海带', (BIOME_FEATURES[Biome.DEEP_OCEAN]!.kelp ?? 0) > 0);
  check('暖水海洋没有海带（原版那里是珊瑚）', (BIOME_FEATURES[Biome.WARM_OCEAN]!.kelp ?? 0) === 0);

  // 群系约束：同样是"海底 + 一海水"，平原群系一点都不长（只有海洋与沼泽配了它）
  const plains = oceanChunk(40, Block.GRASS_BLOCK);
  decorate(plains, 0, 0, flatWorld(40, Biome.PLAINS), 7);
  equal('平原群系（哪怕地形是海底 + 一海水）不长海带', countBlocks(plains, [KELP]), 0);
  equal('平原群系也不长海草', countBlocks(plains, [SEAGRASS]), 0);

  // 一格深的浅水不种：不然整格水会被换成植物，睡莲那种"下方要是水"的东西就没法共存
  const shallow = new Uint16Array(CHUNK_VOLUME);
  for (let y = -64; y <= 63; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) shallow[Chunk.index(x, y, z)] = y === 63 ? Block.GRASS_BLOCK : Block.STONE;
    }
  }
  // 只在中间挖一格深的水坑（y=64 是水，上面是空气）
  for (let z = 4; z < 12; z++) {
    for (let x = 4; x < 12; x++) {
      shallow[Chunk.index(x, 64, z)] = Block.WATER;
      shallow[Chunk.index(x, 63, z)] = Block.SAND;
    }
  }
  decorate(shallow, 0, 0, flatWorld(63, Biome.SWAMP), 3);
  equal('一格深的沼泽水坑里不种海草（上方没有水）', countBlocks(shallow, [SEAGRASS]), 0);
  check('但沼泽的配置里确实开了海草', (BIOME_FEATURES[Biome.SWAMP]!.seagrass ?? 0) > 0);
}

console.log(`\n海带与海草测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
