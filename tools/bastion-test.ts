/**
 * 堡垒遗迹离线测试（批次 82，K8 收尾）
 *
 * 这一批是**第一座下界结构**，所以要证的东西比"加了一座建筑"多：
 *  1. **三块新建材**：磨制黑石 / 黑石砖 / 鎏金黑石（id 529~531，接着告示牌往下排）；
 *  2. **鎏金黑石的掉落**（这一批唯一的"新机制"）：2~5 个金粒、带精准采集掉它自己、
 *     且**时运不改它**（它不在时运表里）；
 *  3. **两张战利品表**：`bastion_treasure` / `bastion_other`（追加在表尾——序号是写进
 *     箱子方块状态的，插在中间会让老存档的箱子变成另一张表）；
 *  4. **结构本身**：候选点判据（玄武岩三角洲不放、净空不够不放、泡在岩浆里不放）、
 *     桥面/宝库/箱子/鎏金黑石的数量，以及**确定性**（同一个单元重放逐格一致）；
 *  5. **下界第一次写方块状态**：箱子那格的 bits 4-7 必须写着"宝库"那张表的序号——
 *     这条通道以前根本没接（`states` 都不传），"写了也不报错、只是静默丢掉"
 *     是批次 37 雪层踩过的同一个坑，所以这里**从 `generateChunkBlocks` 一路端到端验**。
 *
 * 运行：npm run test:bastion
 */

import { Block, BLOCKS, blockDef, blockHardness, blockTiles } from '../src/core/registry/blocks.ts';
import { chestLootIndex, withChestLoot } from '../src/core/registry/blockState.ts';
import { Item, categoryOf, dropFor, fortuneMultiplier, itemDef, rangeDropFor } from '../src/core/registry/items.ts';
import { hasDescription, missingBlockNames } from '../src/core/registry/itemNames.ts';
import { canHarvest, efficientToolType, harvestRequirement } from '../src/core/registry/tools.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { LOOT_TABLES, lootTableByIndex, lootTableIndex, rollLoot, validateLootTables } from '../src/core/registry/loot.ts';
import {
  BASTION_CLEARANCE,
  BASTION_RADIUS,
  bastionCreatureSpawnsAt,
  bastionInstanceForTest,
  nearestBastion,
  bastionIntersects,
  NETHER_STRUCTURE_KINDS,
  netherFossilCandidate,
  buildBastion,
  buildBastionHousing,
  bastionVariant,
  generateBastions,
  type BastionInstance,
  type BastionWorld,
} from '../src/core/gen/Bastion.ts';
import { NetherGenerator, NetherBiome } from '../src/core/gen/NetherGenerator.ts';
import { nearbyStandingSpot } from '../src/core/gen/StructureCreatures.ts';
import { generateChunkBlocks, takeGeneratedStates } from '../src/core/gen/TerrainGenerator.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { FeatureWriter } from '../src/core/gen/Features.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk, type BlockArray } from '../src/core/world/Chunk.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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

/** 线性同余随机源（分布断言用，同一序列永远同一结果） */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Region {
  /** 3×3 个区块各自一份数组——与真实生成同一条路径（结构在每个相交区块里各自重放） */
  readonly chunks: Map<string, { blocks: BlockArray; states: Uint8Array }>;
  writerFor(cx: number, cz: number): FeatureWriter;
  /** 把一座堡垒建进它覆盖的 3×3 个区块 */
  buildEvery(instance: BastionInstance): void;
  at(x: number, y: number, z: number): number;
  stateAt(x: number, y: number, z: number): number;
  stateWrites(): number;
  equals(other: Region): boolean;
}

function makeRegion(): Region {
  const chunks = new Map<string, { blocks: BlockArray; states: Uint8Array }>();
  let stateWrites = 0;

  const chunkOf = (cx: number, cz: number): { blocks: BlockArray; states: Uint8Array } => {
    const key = `${cx},${cz}`;
    let entry = chunks.get(key);
    if (!entry) {
      entry = { blocks: new Uint16Array(CHUNK_VOLUME) as BlockArray, states: new Uint8Array(CHUNK_VOLUME) };
      chunks.set(key, entry);
    }
    return entry;
  };

  return {
    chunks,
    writerFor(cx, cz) {
      const entry = chunkOf(cx, cz);
      return new FeatureWriter(entry.blocks, cx, cz, entry.states, () => {
        stateWrites++;
      });
    },
    buildEvery(instance) {
      const cx = instance.x >> 4;
      const cz = instance.z >> 4;
      // ⚠️ 这正是真实生成的做法：**每个相交区块各自重放一遍**（只写落在自己区块的部分）
      // 批次 522：按形制分派，与 `generateBastions` 走同一条路
      const build = bastionVariant(instance) === 'housing' ? buildBastionHousing : buildBastion;
      for (let dcz = -1; dcz <= 1; dcz++) {
        for (let dcx = -1; dcx <= 1; dcx++) build(this.writerFor(cx + dcx, cz + dcz), instance);
      }
    },
    at(x, y, z) {
      const entry = chunks.get(`${x >> 4},${z >> 4}`);
      return entry ? entry.blocks[Chunk.index(x & 15, y, z & 15)]! : -1;
    },
    stateAt(x, y, z) {
      const entry = chunks.get(`${x >> 4},${z >> 4}`);
      return entry ? entry.states[Chunk.index(x & 15, y, z & 15)]! : 0;
    },
    stateWrites() {
      return stateWrites;
    },
    equals(other) {
      if (this.chunks.size !== other.chunks.size) return false;
      for (const [key, mine] of this.chunks) {
        const theirs = other.chunks.get(key);
        if (!theirs) return false;
        if (!mine.blocks.every((value, index) => value === theirs.blocks[index])) return false;
        if (!mine.states.every((value, index) => value === theirs.states[index])) return false;
      }
      return true;
    },
  };
}

const TILES = new Set<string>(TILE_ORDER);
const NEW_BLOCKS = [Block.POLISHED_BLACKSTONE, Block.POLISHED_BLACKSTONE_BRICKS, Block.GILDED_BLACKSTONE];

// ---------------------------------------------------------------- 1. 三块建材

console.log('\n[三块建材：注册表]');
{
  const contiguous = NEW_BLOCKS.every((id, index) => id === Block.POLISHED_BLACKSTONE + index);
  check('三个 id 连续', contiguous, NEW_BLOCKS.join(','));
  equal('接着告示牌（6 种木材到 528）往下排', Block.POLISHED_BLACKSTONE, Block.OAK_SIGN + 6);

  const names = NEW_BLOCKS.map((id) => blockDef(id).name);
  equal('注册名与顺序一致（磨制黑石 / 黑石砖 / 鎏金黑石）', names.join(','), 'minecraft:polished_blackstone,minecraft:polished_blackstone_bricks,minecraft:gilded_blackstone');

  const cubes = NEW_BLOCKS.filter((id) => blockDef(id).shape !== undefined && blockDef(id).shape !== 'cube');
  check('三块都是整块方块（没有形状特例）', cubes.length === 0, cubes.join(','));

  const missingTiles = NEW_BLOCKS.flatMap((id) => blockTiles(id, 0)).filter((tile) => !TILES.has(tile));
  check('三张贴图都在图集名单里', missingTiles.length === 0, missingTiles.join(','));

  // ⚠️ 用 `missingBlockNames()` 而不是"`itemLabel` 里没有'未知物品'"：
  // 名字没登记时 `itemLabel` 会回退成英文注册名（也不含"未知物品"），
  // 所以那种写法**根本抓不到漏登记**（这一批第一次跑就是被它骗过去的）
  const missingNames = missingBlockNames();
  const unnamed = NEW_BLOCKS.filter((id) => missingNames.includes(blockDef(id).name.replace('minecraft:', '')));
  check('三块都有中文名（`missingBlockNames` 里没有它们）', unnamed.length === 0, unnamed.join(','));
  const undescribed = NEW_BLOCKS.filter((id) => !hasDescription(id));
  check('三块都有说明', undescribed.length === 0, undescribed.join(','));
  check('三块都有对应物品', NEW_BLOCKS.every((id) => itemDef(id)?.block === id));
  check('三块都归"建筑"分类', NEW_BLOCKS.every((id) => categoryOf(id) === 'building'));

  const hardness = NEW_BLOCKS.map((id) => blockHardness(id));
  check('硬度都是 1.5（与黑石同档）', hardness.every((value) => value === 1.5), hardness.join(','));
  check('三块都要镐（原版如此）', NEW_BLOCKS.every((id) => harvestRequirement(id)?.tool === 'pickaxe'));
  check('三块徒手都挖不动（要工具）', NEW_BLOCKS.every((id) => !canHarvest(id, null)));
  check('镐是它们的加速工具', NEW_BLOCKS.every((id) => efficientToolType(id) === 'pickaxe'));

  // 三块都在 BLOCKS 表里（"加方块就自动有物品"的前提是它真的被登记了）
  check('三块都在 BLOCKS 表里', NEW_BLOCKS.every((id) => BLOCKS[id]?.id === id));
}

console.log('\n[鎏金黑石：掉 2~5 个金粒]');
{
  const drop = (roll: number): ReturnType<typeof rangeDropFor> => rangeDropFor(Block.GILDED_BLACKSTONE, roll);
  equal('掷 0 → 下限 2 个', drop(0)?.count, 2);
  equal('掷 0.99 → 上限 5 个', drop(0.99)?.count, 5);
  equal('掉的是金粒', drop(0)?.id, Item.GOLD_NUGGET);
  equal('另外两块没有区间掉落（走"掉自己"的默认规则）',
    `${rangeDropFor(Block.POLISHED_BLACKSTONE, 0)},${rangeDropFor(Block.POLISHED_BLACKSTONE_BRICKS, 0)}`, 'null,null');

  const items = new Map<number, number>();
  const rolls = lcg(7);
  for (let i = 0; i < 4000; i++) {
    const entry = drop(rolls())!;
    items.set(entry.count, (items.get(entry.count) ?? 0) + 1);
  }
  check('四种数量（2/3/4/5）都出现过', items.size === 4, [...items.keys()].join(','));
  const even = [...items.values()].every((count) => Math.abs(count / 4000 - 0.25) < 0.02);
  check('四种数量各占约 1/4', even, [...items.values()].map((c) => (c / 4000).toFixed(3)).join(','));

  check('时运**不改**鎏金黑石（它不在时运表里）', fortuneMultiplier(Block.GILDED_BLACKSTONE, 3, 0.5) === 1);
  check('另外两块掉自己（`dropFor` 的默认规则）',
    dropFor(Block.POLISHED_BLACKSTONE)?.id === Block.POLISHED_BLACKSTONE &&
      dropFor(Block.POLISHED_BLACKSTONE_BRICKS)?.id === Block.POLISHED_BLACKSTONE_BRICKS);
}

console.log('\n[配方：两块建材各一条，鎏金黑石没有配方]');
{
  /** 构造 size×size 的扁平网格（`matchRecipe` 的第二参数必须与它一致） */
  const grid = (size: 2 | 3, rows: readonly string[], legend: Record<string, number>): number[] => {
    const cells = new Array<number>(size * size).fill(0);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r]!.length; c++) {
        const ch = rows[r]![c]!;
        if (ch !== '·') cells[r * size + c] = legend[ch] ?? 0;
      }
    }
    return cells;
  };

  const polished = grid(2, ['BB', 'BB'], { B: Block.BLACKSTONE });
  equal('4 黑石 → 4 磨制黑石', matchRecipe(polished, 2)?.id, Block.POLISHED_BLACKSTONE);
  equal('产量 4', matchRecipe(polished, 2)?.count, 4);
  equal('4 磨制黑石 → 4 黑石砖', matchRecipe(grid(2, ['PP', 'PP'], { P: Block.POLISHED_BLACKSTONE }), 2)?.id, Block.POLISHED_BLACKSTONE_BRICKS);

  // "没有任何配方产出鎏金黑石"——原版也没有，它只能在下界的堡垒里挖到
  const gildedRecipes = RECIPES.filter((recipe) => recipe.result.id === Block.GILDED_BLACKSTONE);
  check('鎏金黑石没有任何合成配方（原版也没有）', gildedRecipes.length === 0);
  const crafted = grid(2, ['GG', 'GG'], { G: Block.GILDED_BLACKSTONE });
  check('拿鎏金黑石去合成也合不出别的（它只是原料的死路）', matchRecipe(crafted, 2) === null);
}

// ---------------------------------------------------------------- 2. 战利品表

console.log('\n[两张战利品表：追加在表尾]');
{
  // 批次 111（K9）在表尾追加了第 11 张（要塞传送门房），所以这里跟着 +1
  // 批次 341 追加沙漠神殿/丛林神庙两张 → 13；批次 345 到 15（当时是 4 位上限）；
  // 批次 459 把状态位扩到 5 位（bit0 当高位）后追加 5 张 → 20
  equal('表的总数是 22（批次 473 又补了 2 张）', LOOT_TABLES.length, 22);
  equal('宝库表在倒数第二位', LOOT_TABLES[8]?.key, 'bastion_treasure');
  equal('杂物表是最后一张', LOOT_TABLES[9]?.key, 'bastion_other');
  equal('序号从 1 起（宝库 = 9）', lootTableIndex('bastion_treasure'), 9);
  equal('杂物 = 10', lootTableIndex('bastion_other'), 10);
  equal('序号查得回来', lootTableByIndex(9)?.key, 'bastion_treasure');

  const problems = validateLootTables();
  check('两张新表通过校验（权重/数量区间/空手项都合法）', problems.length === 0, problems.join('；'));

  const treasure = lootTableByIndex(9)!;
  const ids = treasure.entries.map((entry) => entry.id);
  check('宝库里有下界合金锭（原版这张表的主角）', ids.includes(Item.NETHERITE_INGOT));
  check('宝库里有钻石 / 金锭 / 金粒', ids.includes(Item.DIAMOND) && ids.includes(Item.GOLD_INGOT) && ids.includes(Item.GOLD_NUGGET));
  check('宝库里有鎏金黑石本身（可以把"撬金"这件事延长到家里）', ids.includes(Block.GILDED_BLACKSTONE));
  check('宝库里有空手项（不是每一轮都给东西）', treasure.entries.some((entry) => entry.id === 0));

  // 每一轮抽出来的东西都必须是**已注册**的物品
  const rolls = lcg(99);
  const sampled = new Set<number>();
  for (let i = 0; i < 400; i++) for (const stack of rollLoot(treasure, rolls)) sampled.add(stack.id);
  const broken = [...sampled].filter((id) => itemDef(id) === undefined && blockDef(id).id !== id);
  check('抽出来的每一样都指向已注册的物品/方块', broken.length === 0, broken.join(','));
  check('宝库抽得出来东西（不是一张空表）', sampled.size >= 5, `只抽到 ${sampled.size} 种`);

  // 杂物表也要能抽
  const junk = lootTableByIndex(10)!;
  const junkRolls = lcg(1234);
  const junkIds = new Set<number>();
  for (let i = 0; i < 200; i++) for (const stack of rollLoot(junk, junkRolls)) junkIds.add(stack.id);
  check('杂物表抽得出来东西', junkIds.size >= 4, `只抽到 ${junkIds.size} 种`);
  check('杂物表里没有下界合金锭（那是宝库的东西）', !junkIds.has(1156));
}

// ---------------------------------------------------------------- 3. 候选点判据

console.log('\n[候选点：三种情况不放]');
{
  const world = (overrides: Partial<BastionWorld> = {}): BastionWorld => ({
    floorAt: () => 40,
    ceilingAt: () => 90,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
    ...overrides,
  });

  const found = bastionInstanceForTest(0, 0, SEED, world());
  check('正常条件下能求出候选点', found !== null);
  if (found) {
    equal('原点高度 = 地板 + 1', found.y, 41);
    equal('单元号带在实例上', `${found.cellX},${found.cellZ}`, '0,0');
    const again = bastionInstanceForTest(0, 0, SEED, world());
    check('同一个单元求两次完全一样（纯函数）',
      !!again && again.x === found.x && again.y === found.y && again.z === found.z);
    // 换个种子应该换一个落点（哈希真的参与了）
    const other = bastionInstanceForTest(0, 0, SEED + 1, world());
    check('换种子会换落点', !!other && (other.x !== found.x || other.z !== found.z));
  }

  check('玄武岩三角洲不放（原版也不放）',
    bastionInstanceForTest(0, 0, SEED, world({ biomeAt: () => NetherBiome.BASALT_DELTAS })) === null);
  check(`净空不够不放（洞顶只高 ${BASTION_CLEARANCE - 4} 格）`,
    bastionInstanceForTest(0, 0, SEED, world({ floorAt: () => 40, ceilingAt: () => 40 + BASTION_CLEARANCE - 4 })) === null);
  check('泡在岩浆海里不放（地板低于岩浆面）',
    bastionInstanceForTest(0, 0, SEED, world({ floorAt: () => 20 })) === null);

  // 扫描一片单元，看看"出现频率"是否合理（70% 概率 × 上面三条判据）
  let hits = 0;
  for (let cellZ = -6; cellZ <= 6; cellZ++) {
    for (let cellX = -6; cellX <= 6; cellX++) {
      if (bastionInstanceForTest(cellX, cellZ, SEED, world())) hits++;
    }
  }
  const rate = hits / 169;
  check(`13×13 个单元里出现 ${hits} 座（约 ${(rate * 100).toFixed(0)}%，概率是 70%）`, hits > 90 && hits < 150);
}

console.log('\n[实例与区块的相交判定]');
{
  const instance = bastionInstanceForTest(0, 0, SEED, {
    floorAt: () => 40,
    ceilingAt: () => 90,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
  })!;
  const cx = instance.x >> 4;
  const cz = instance.z >> 4;
  check('原点所在区块一定相交', bastionIntersects(instance, cx, cz));
  check('半径内的邻居区块相交', bastionIntersects(instance, cx + 1, cz));
  check('远到半径之外就不相交', !bastionIntersects(instance, cx + 4, cz) && !bastionIntersects(instance, cx, cz + 4));
  check('半径常量够覆盖建筑（桥长 25 格 → 半径 ≥ 13）', BASTION_RADIUS >= 13);
}

// ---------------------------------------------------------------- 4. 布局

console.log('\n[布局：桥 + 宝库 + 箱子 + 鎏金黑石]');
{
  const world: BastionWorld = {
    floorAt: () => 40,
    ceilingAt: () => 90,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
  };
  // 批次 522：布局断言只针对**桥形**（居住区在下面单独验），所以要挑一座桥形的
  let treasure: BastionInstance | null = null;
  for (let cellZ = -6; cellZ <= 6 && !treasure; cellZ++) {
    for (let cellX = -6; cellX <= 6 && !treasure; cellX++) {
      const candidate = bastionInstanceForTest(cellX, cellZ, SEED, world);
      if (candidate && bastionVariant(candidate) === 'treasure') treasure = candidate;
    }
  }
  check('找得到一座桥形堡垒', treasure !== null);
  const instance = treasure!;

  // ⚠️ 一座堡垒横跨 3 个区块（桥长 25 格），所以测试要**按区块切片**看，
  // 单个区块的数组装不下它（这正是"结构要在每个相交区块里各自重放"的由来）
  const region = makeRegion();
  region.buildEvery(instance);

  const at = region.at;
  const deckIds = new Set<number>([Block.BLACKSTONE, Block.POLISHED_BLACKSTONE, Block.GILDED_BLACKSTONE]);
  const deckOk = [-2, -1, 0, 1, 2].every((dz) => deckIds.has(at(instance.x, instance.y, instance.z + dz)));
  check('原点那一列的桥面是黑石家族', deckOk);
  equal('桥面正中是磨制黑石（那条"中缝"）', at(instance.x, instance.y, instance.z), Block.POLISHED_BLACKSTONE);
  equal('桥面靠边是黑石', at(instance.x, instance.y, instance.z + 2), Block.BLACKSTONE);

  // 栏杆：两侧各 2 格高
  equal('栏杆是黑石砖', at(instance.x + 1, instance.y + 1, instance.z + 3), Block.POLISHED_BLACKSTONE_BRICKS);
  check('栏杆有 2 格高', at(instance.x + 1, instance.y + 2, instance.z + 3) === Block.POLISHED_BLACKSTONE_BRICKS);

  // 宝库：地板磨制黑石、墙体黑石砖、门洞是空气
  equal('宝库地板是磨制黑石', at(instance.x + 10, instance.y, instance.z), Block.POLISHED_BLACKSTONE);
  equal('宝库墙体是黑石砖', at(instance.x + 12, instance.y + 2, instance.z), Block.POLISHED_BLACKSTONE_BRICKS);
  equal('宝库门洞是空气（能走进去）', at(instance.x + 7, instance.y + 2, instance.z), Block.AIR);

  // 箱子：位置与状态
  const chestX = instance.x + 10;
  const chestY = instance.y + 1;
  equal('宝库正中有一个箱子', at(chestX, chestY, instance.z), Block.CHEST);
  const lootIndex = chestLootIndex(region.stateAt(chestX, chestY, instance.z));
  equal('箱子状态里写着"宝库"那张表的序号', lootIndex, lootTableIndex('bastion_treasure'));
  equal('那张表确实是宝库', lootTableByIndex(lootIndex)?.key, 'bastion_treasure');
  check('写状态时回调了（区块会被标记成"有状态"）', region.stateWrites() > 0);

  // 鎏金黑石：四角上下各一块 + 桥面零星 2~4 块 = 10~12 块
  let gilded = 0;
  for (let y = 0; y < 14; y++) {
    for (let z = -8; z <= 8; z++) {
      for (let x = -12; x <= 12; x++) {
        if (at(instance.x + x, instance.y + y, instance.z + z) === Block.GILDED_BLACKSTONE) gilded++;
      }
    }
  }
  check(`鎏金黑石 10~12 块（实测 ${gilded}）`, gilded >= 10 && gilded <= 12);
  check('四角一层有鎏金黑石', at(instance.x + 8, instance.y + 1, instance.z + 4) === Block.GILDED_BLACKSTONE);
  check('天花板四角也有', at(instance.x + 8, instance.y + 5, instance.z - 4) === Block.GILDED_BLACKSTONE);

  // 净空：结构上方不该被写坏（y+14 以上仍是原来的空气）
  equal('建筑顶端之上没有被写东西', at(instance.x, instance.y + 14, instance.z), Block.AIR);
}

console.log('\n[确定性：同一座堡垒重放逐格一致]');
{
  const world: BastionWorld = {
    floorAt: () => 40,
    ceilingAt: () => 90,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
  };
  const instance = bastionInstanceForTest(0, 0, SEED, world)!;

  const first = makeRegion();
  first.buildEvery(instance);
  const second = makeRegion();
  second.buildEvery(instance);
  check('两次重放逐格一致（同一份实例建两遍）', first.equals(second));

  // 重新求一遍实例（模拟"区块被重新生成"）也必须一致：
  // ⚠️ 随机源**不能挂在实例上**，否则第二遍会接着上一遍的随机序列走
  const again = bastionInstanceForTest(0, 0, SEED, world)!;
  const third = makeRegion();
  third.buildEvery(again);
  check('重新求实例再建，结果仍然一致（随机源没有留在实例上）', first.equals(third));

  // 只写落在本区块的部分：不含原点的区块不该被写到
  const cx = instance.x >> 4;
  const cz = instance.z >> 4;
  const farBlocks: BlockArray = new Uint16Array(CHUNK_VOLUME) as BlockArray;
  generateBastions(new FeatureWriter(farBlocks, cx + 40, cz + 40), SEED, world);
  check('远处区块一个方块都没被写（结构只属于它自己的单元）', farBlocks.every((value) => value === 0));

  // 走一遍真正的入口（`generateBastions`）：3×3 个区块各自重放，结果必须一致
  const viaEntry = makeRegion();
  for (let dcz = -1; dcz <= 1; dcz++) {
    for (let dcx = -1; dcx <= 1; dcx++) {
      generateBastions(viaEntry.writerFor(cx + dcx, cz + dcz), SEED, world);
    }
  }
  check('经由 generateBastions 生成的结果与直接建一致', viaEntry.equals(first));
}

// ---------------------------------------------------------------- 5. 与真实下界生成拼接

console.log('\n[真实下界：状态通道端到端]');
{
  const nether = new NetherGenerator(SEED);
  const world: BastionWorld = {
    floorAt: (x, z) => nether.surfaceY(x, z),
    ceilingAt: (x, z) => nether.ceilingAt(x, z),
    biomeAt: (x, z) => nether.biomeAt(x, z),
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
  };

  // 在真实下界里找一座堡垒（单元网格 24 区块，扫 9×9 个单元足够碰上）
  let instance = null as ReturnType<typeof bastionInstanceForTest> | null;
  for (let cellZ = -4; cellZ <= 4 && !instance; cellZ++) {
    for (let cellX = -4; cellX <= 4 && !instance; cellX++) {
      instance = bastionInstanceForTest(cellX, cellZ, SEED, world);
    }
  }
  check('真实下界里能求出堡垒候选点', instance !== null);

  if (instance) {
    const cx = instance.x >> 4;
    const cz = instance.z >> 4;

    // 真跑一遍区块生成（走的是 TerrainGenerator 的下界分支）
    const blocks = generateChunkBlocks(cx, cz, SEED, Dimension.NETHER);
    takeGeneratedStates(); // 丢掉这次的状态（下面按"箱子自己所在的区块"再生成一次）

    const at = (x: number, y: number, z: number): number =>
      blocks[Chunk.index(x - cx * CHUNK_SIZE_X, y, z - cz * CHUNK_SIZE_Z)]!;

    // 批次 522：两种形制共用"基座是黑石/磨制黑石"这条判据
    const deck = at(instance.x, instance.y, instance.z);
    check(
      '真实生成出来的基座是黑石/磨制黑石/黑石砖',
      deck === Block.BLACKSTONE || deck === Block.POLISHED_BLACKSTONE || deck === Block.POLISHED_BLACKSTONE_BRICKS,
      String(deck),
    );

    // 箱子可能落在相邻区块，所以**按箱子自己所在的区块**再生成一次，
    // 这才是"下界第一次写方块状态"真正要走的那条路。
    // 桥形：宝库正中（+10, +1, 0）挂 `bastion_treasure`；居住区：一楼角落挂 `bastion_other`。
    const variant = bastionVariant(instance);
    const chestX = variant === 'housing' ? instance.x - 3 : instance.x + 10;
    const chestY = instance.y + 1;
    const chestZ = variant === 'housing' ? instance.z - 3 : instance.z;
    const chestCx = chestX >> 4;
    const chestCz = chestZ >> 4;
    const chestBlocks = generateChunkBlocks(chestCx, chestCz, SEED, Dimension.NETHER);
    const chestStates = takeGeneratedStates();
    const chestLocalX = chestX - chestCx * CHUNK_SIZE_X;
    const chestLocalZ = chestZ - chestCz * CHUNK_SIZE_Z;

    equal('容器那一格真的是箱子', chestBlocks[Chunk.index(chestLocalX, chestY, chestLocalZ)], Block.CHEST);
    check('箱子所在的区块把状态一起交了出来（下界第一次写状态）', chestStates !== null);
    if (chestStates) {
      const index = chestLootIndex(chestStates[Chunk.index(chestLocalX, chestY, chestLocalZ)]!);
      equal(
        '状态里写着对应战利品表的序号',
        index,
        lootTableIndex(variant === 'housing' ? 'bastion_other' : 'bastion_treasure'),
      );
    }
    // 对照：同一个区块在**没有堡垒**时不该有任何状态（状态是"按需分配"的）
    const plainCx = cx + 200;
    generateChunkBlocks(plainCx, cz + 200, SEED, Dimension.NETHER);
    check('没有堡垒的区块不产生状态（不会白占 96KB）', takeGeneratedStates() === null);

    // 生成顺序无关：先跑一个远处的区块再回来，结果必须一样
    generateChunkBlocks(cx - 3, cz + 2, SEED, Dimension.NETHER);
    takeGeneratedStates();
    const again = generateChunkBlocks(cx, cz, SEED, Dimension.NETHER);
    check('重新生成同一个区块逐格一致', again.every((value, index) => value === blocks[index]));
  }
}

console.log('\n[与"玩家自己放的箱子"不冲突]');
{
  // 状态 0 = 没有战利品表（玩家自己放的箱子）；堡垒的箱子必须是非 0
  const state = withChestLoot(0, lootTableIndex('bastion_treasure'));
  check('宝库箱子的战利品序号不为 0（不会被当成玩家放的箱子）', chestLootIndex(state) > 0);
  equal('读出来的就是宝库', lootTableByIndex(chestLootIndex(state))?.key, 'bastion_treasure');
  // 状态位装得下（批次 459 扩到 5 位：低 4 位 bits 4-7 + 高 1 位 bit0 → 31 张）
  check('表数在状态位能表示的范围内（31 张）', LOOT_TABLES.length <= 31);
}

console.log('\n[下界化石（批次 410）]');
{
  // 本块自己造一个假世界（上面那个 `world()` 在别的块里，出了作用域就没了）
  const makeWorld = (overrides: Partial<BastionWorld> = {}): BastionWorld => ({
    floorAt: () => 40,
    ceilingAt: () => 90,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
    ...overrides,
  });

  check('下界结构清单里登记了化石（三种）', NETHER_STRUCTURE_KINDS.length === 3 && NETHER_STRUCTURE_KINDS.includes('nether_fossil'), NETHER_STRUCTURE_KINDS.join(','));

  const soul = makeWorld({ biomeAt: () => NetherBiome.SOUL_SAND_VALLEY });
  let found: ReturnType<typeof netherFossilCandidate> = null;
  let foundCell: [number, number] = [0, 0];
  for (let cx = 0; cx < 40 && !found; cx++) {
    for (let cz = 0; cz < 40 && !found; cz++) {
      const inst = netherFossilCandidate(cx, cz, SEED, soul);
      if (inst) {
        found = inst;
        foundCell = [cx, cz];
      }
    }
  }
  check('灵魂沙峡谷里能找到化石', found !== null);

  if (found) {
    const again = netherFossilCandidate(foundCell[0], foundCell[1], SEED, soul);
    check(
      '同一个单元两次求值完全一致（世界坐标的纯函数，能跨区块重放）',
      again !== null && again.x === found.x && again.z === found.z && again.y === found.y,
    );
    check('埋在地表下 1 格（露头一格，否则永远找不到）', found.y === 39, `y=${found.y}`);
  }

  // 负面：其它群系一格都不该有
  const wastes = makeWorld();
  let inWastes = 0;
  for (let cx = 0; cx < 40; cx++) {
    for (let cz = 0; cz < 40; cz++) {
      if (netherFossilCandidate(cx, cz, SEED, wastes)) inWastes++;
    }
  }
  check('非灵魂沙峡谷一个都不生成', inWastes === 0, `实际 ${inWastes} 个`);
}

console.log('\n[堡垒里的生物（批次 458）]');
{
  const world: BastionWorld = {
    floorAt: () => 40,
    ceilingAt: () => 90,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
  };
  const inst = bastionInstanceForTest(0, 0, SEED, world);
  check('求得到这座堡垒', inst !== null);
  if (inst) {
    // 跨它覆盖的所有区块合并（与主线程的调用方式一致）
    const seen = new Map<string, string>();
    for (let cz = Math.floor((inst.z - BASTION_RADIUS) / 16); cz <= Math.floor((inst.z + BASTION_RADIUS) / 16); cz++) {
      for (let cx = Math.floor((inst.x - BASTION_RADIUS) / 16); cx <= Math.floor((inst.x + BASTION_RADIUS) / 16); cx++) {
        for (const spawn of bastionCreatureSpawnsAt(cx, cz, SEED, world)) {
          seen.set(`${spawn.x},${spawn.y},${spawn.z}`, spawn.kind);
        }
      }
    }
    equal('跨区块合并后不重复（1 蛮兵 + 2 猪灵）', seen.size, 3);
    equal('猪灵蛮兵恰好一只', [...seen.values()].filter((k) => k === 'piglin_brute').length, 1);
    equal('猪灵两只', [...seen.values()].filter((k) => k === 'piglin').length, 2);
    check(
      '都在堡垒的包围盒附近',
      [...seen.keys()].every((key) => {
        const [x, y, z] = key.split(',').map(Number) as [number, number, number];
        return Math.abs(x - inst.x) <= BASTION_RADIUS && Math.abs(z - inst.z) <= BASTION_RADIUS && y > inst.y && y < inst.y + 20;
      }),
    );
  }
  equal('没有堡垒的地方一只都不刷（负对照）', bastionCreatureSpawnsAt(999, 999, SEED, world).length, 0);
  equal(
    '同一区块调两次结果一致',
    JSON.stringify(bastionCreatureSpawnsAt(0, 0, SEED, world)),
    JSON.stringify(bastionCreatureSpawnsAt(0, 0, SEED, world)),
  );
}


console.log('\n[堡垒生物锚点在真实生成里有空间（批次 458）]');
{
  const world: BastionWorld = {
    floorAt: () => 40,
    ceilingAt: () => 90,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
  };
  const inst = bastionInstanceForTest(0, 0, SEED, world);
  if (!inst) {
    check('求得到堡垒（否则这条断言没意义）', false);
  } else {
    const cx0 = Math.floor((inst.x - BASTION_RADIUS) / 16) - 1;
    const cx1 = Math.floor((inst.x + BASTION_RADIUS) / 16) + 1;
    const cz0 = Math.floor((inst.z - BASTION_RADIUS) / 16) - 1;
    const cz1 = Math.floor((inst.z + BASTION_RADIUS) / 16) + 1;
    const blocks = new Map<string, number>();
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ids = generateChunkBlocks(cx, cz, SEED, Dimension.NETHER);
        takeGeneratedStates();
        for (let y = 20; y < 120; y++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              blocks.set(`${cx * 16 + x},${y},${cz * 16 + z}`, ids[Chunk.index(x, y, z)]!);
            }
          }
        }
      }
    }
    const spawns = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) spawns.push(...bastionCreatureSpawnsAt(cx, cz, SEED, world));
    }
    check('真实实例里有锚点', spawns.length > 0, `${spawns.length}`);
    let placed = 0;
    for (const spawn of spawns) {
      const spot = nearbyStandingSpot(
        (x, y, z) => blocks.get(`${x},${y},${z}`) === Block.AIR,
        spawn.x,
        spawn.y,
        spawn.z,
        3,
      );
      if (spot) placed++;
    }
    equal('每个锚点 3 格内都有空气（不会把猪灵卡进黑石）', placed, spawns.length);
  }
}


console.log('\n[第二种形制：居住区（批次 522）]');
{
  // 形制由坐标哈希决定：同一座永远同一形制，整体上两种都会出现
  const variants = new Set<string>();
  for (let i = 0; i < 64; i++) {
    variants.add(bastionVariant({ cellX: 0, cellZ: 0, x: i * 37, y: 40, z: i * 53, seed: SEED }));
  }
  equal('两种形制都会出现', variants.size, 2);

  const inst: BastionInstance = { cellX: 0, cellZ: 0, x: 0, y: 40, z: 0, seed: SEED };
  equal('同一座问两次形制不变', bastionVariant(inst), bastionVariant({ ...inst }));

  const region = makeRegion();
  for (let dcz = -1; dcz <= 1; dcz++) {
    for (let dcx = -1; dcx <= 1; dcx++) buildBastionHousing(region.writerFor(dcx, dcz), inst);
  }
  let bricks = 0;
  let gilded = 0;
  let chests = 0;
  let torches = 0;
  for (let y = 40; y <= 56; y++) {
    for (let z = -9; z <= 9; z++) {
      for (let x = -9; x <= 9; x++) {
        const id = region.at(x, y, z);
        if (id === Block.POLISHED_BLACKSTONE_BRICKS) bricks++;
        if (id === Block.GILDED_BLACKSTONE) gilded++;
        if (id === Block.CHEST) chests++;
        if (id === Block.TORCH) torches++;
      }
    }
  }
  check('主楼墙体 > 150 格', bricks > 150, String(bricks));
  equal('鎏金黑石 12 块（四角上下 + 四座角楼顶）', gilded, 12);
  equal('屋里两只箱子', chests, 2);
  equal('门口两支火把', torches, 2);
}

console.log('\n[最近堡垒遗迹（批次 465，/locate structure）]');
{
  const world: BastionWorld = {
    floorAt: () => 40,
    ceilingAt: () => 90,
    biomeAt: () => NetherBiome.NETHER_WASTES,
    basaltBiome: NetherBiome.BASALT_DELTAS,
    soulSandBiome: NetherBiome.SOUL_SAND_VALLEY,
  };
  const found = bastionInstanceForTest(0, 0, SEED, world);
  if (found) {
    const hit = nearestBastion(found.x + 8, found.z + 8, SEED, world);
    check('从堡垒旁边问最近堡垒', hit !== null);
    equal('返回的就是这一座（不会指到隔壁单元）', `${hit?.x},${hit?.z}`, `${found.x},${found.z}`);
    check('距离算得对', hit !== null && Math.abs(hit.distance - Math.hypot(8, 8)) < 1e-6, `${hit?.distance}`);
  }
  equal(
    '同样的查询两次一致',
    JSON.stringify(nearestBastion(100, -200, SEED, world)),
    JSON.stringify(nearestBastion(100, -200, SEED, world)),
  );
}

console.log(`\n堡垒遗迹测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
