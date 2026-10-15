/**
 * 地物（J2）离线测试
 *
 * 覆盖三块：
 *  1. 新方块的注册表一致性（id 连续、贴图都在图集名单里、物品与掉落表正确）
 *  2. 每种地物的形状与尺寸约束（树干不悬空、树冠不越界写入、仙人掌不长在水里等）
 *  3. 真实地形抽样：统计一片区域里各级地物的出现频次与群系约束是否生效
 *
 * 运行：npm run test:decor
 */

import { Block, BLOCKS, blockDef, isHandHarvestable, slabId, woolId } from '../src/core/registry/blocks.ts';
import { breakSeconds, makeToolInfo } from '../src/core/registry/tools.ts';
import {
  CREATIVE_ITEMS,
  Item,
  type DropContext,
  blockDrops,
  extraCropDrop,
  wheatExtraSeeds,
  dropFor,
  itemDef,
  requiresShears,
  GRASS_SEED_CHANCE,
} from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { recipesForResult } from '../src/core/crafting/RecipeBook.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { BIOME_TABLE, Biome } from '../src/core/gen/Biome.ts';
import {
  BIOME_FEATURES,
  TREE_KINDS,
  decorate,
  plantTree,
  type FeatureStats,
  type FeatureWorld,
} from '../src/core/gen/Features.ts';
import { generateChunkBlocks } from '../src/core/gen/TerrainGenerator.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk } from '../src/core/world/Chunk.ts';

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

// ---------------------------------------------------------------- 1. 注册表一致性

console.log('\n[方块注册表]');
// 方块总数只当下限用（不当"精确值"断言）：每加一批方块都要回来改一次这个数字，
// 而真正有价值的两条是"id 从 0 连续"与"每个方块的贴图都在图集名单里"，它们已经在下面了。
// 下限仍然能挡住"误删了几行方块定义"这种事故。
check(`方块总数 ${BLOCKS.length}（不低于 273）`, BLOCKS.length >= 273);
check(
  'id 从 0 连续到末尾',
  BLOCKS.every((def, index) => def.id === index),
);
const TILES: readonly string[] = TILE_ORDER;
check(
  '每个方块的贴图都在图集名单里',
  BLOCKS.every((def) => def.tiles.every((tile) => tile === '' || TILES.includes(tile))),
  BLOCKS.filter((def) => def.tiles.some((tile) => tile !== '' && !TILES.includes(tile)))
    .map((def) => `${def.name}:${def.tiles.join('/')}`)
    .join(' '),
);
// 物品图标同样要在名单里。这条断言是补上的——**此前只校验了方块**，
// 结果 9 种生物掉落物（腐肉/骨头/火药/牛肉/猪排/羊肉/鸡肉/皮革/羽毛）
// 的画笔早就写好了却没登记，图标全部回退成 tile 0，在背包里长得一模一样。
check(
  '每个物品的图标都在图集名单里',
  CREATIVE_ITEMS.every((entry) => {
    const def = itemDef(typeof entry === 'number' ? entry : entry.id);
    return def === undefined || TILES.includes(def.tile);
  }),
  CREATIVE_ITEMS.filter((entry) => {
    const def = itemDef(typeof entry === 'number' ? entry : entry.id);
    return def !== undefined && !TILES.includes(def.tile);
  })
    .map((entry) => itemDef(typeof entry === 'number' ? entry : entry.id)!.tile)
    .join(' '),
);
check('图集贴图无重名', new Set(TILE_ORDER).size === TILE_ORDER.length);

console.log('\n[装饰方块]');
for (const [name, id, shape] of [
  ['short_grass', Block.SHORT_GRASS, 'cross'],
  ['poppy', Block.POPPY, 'cross'],
  ['sugar_cane', Block.SUGAR_CANE, 'cross'],
  ['bamboo', Block.BAMBOO, 'cross'],
  ['cactus', Block.CACTUS, 'cactus'],
  ['pumpkin', Block.PUMPKIN, 'cube'],
] as const) {
  equal(`${name} 的形状`, blockDef(id).shape, shape);
}
check('植物无碰撞且不遮挡', [Block.SHORT_GRASS, Block.POPPY, Block.SUGAR_CANE].every((id) => !blockDef(id).solid && !blockDef(id).opaque));
check('仙人掌不遮挡邻居（否则贴着的方块会缺面）', !blockDef(Block.CACTUS).opaque);
check('植物徒手可采集（硬度 0 → 瞬间破坏）', breakSeconds(Block.SHORT_GRASS) === 0);
check('南瓜属于徒手可采集', isHandHarvestable(Block.PUMPKIN));
// 海晶石 1.5 硬度：木镐 1.5 × 1.5 ÷ 2 = 1.125 秒；徒手是 7.5 秒
check(
  '海晶石需要镐（不在徒手表）',
  !isHandHarvestable(Block.PRISMARINE) && breakSeconds(Block.PRISMARINE, makeToolInfo('pickaxe', 'wooden')) === 1.125,
);

console.log('\n[物品与掉落]');
check(
  '所有新方块都注册了物品（创造物品栏能拿到）',
  [
    Block.SHORT_GRASS,
    Block.DANDELION,
    Block.POPPY,
    Block.BLUE_ORCHID,
    Block.OXEYE_DAISY,
    Block.CORNFLOWER,
    Block.RED_MUSHROOM,
    Block.BROWN_MUSHROOM,
    Block.SUGAR_CANE,
    Block.PUMPKIN,
    Block.MELON,
    Block.CACTUS,
    Block.DEAD_BUSH,
    Block.BAMBOO,
    Block.PRISMARINE,
    Block.SEA_LANTERN,
    Block.NETHERRACK,
    Block.SOUL_SAND,
    Block.CRIMSON_NYLIUM,
    Block.CRIMSON_STEM,
    Block.SHROOMLIGHT,
    Block.ANCIENT_DEBRIS,
  ].every((id) => itemDef(id) !== undefined),
);
equal('草不掉落任何东西（与原版一致）', dropFor(Block.SHORT_GRASS), null);
equal('花掉落自身', dropFor(Block.POPPY)?.id, Block.POPPY);
check('树叶不掉落', dropFor(Block.OAK_LEAVES) === null);
// 每种木材固定 5 个 id（原木/木板/树叶/台阶/楼梯），树叶是第 3 个
check(
  '6 种木材的树叶都不掉落',
  [Block.OAK_LEAVES, 104, 109, 114, 119, 124].every((id) => dropFor(id) === null),
);

// ---------------------------------------------------------------- 2. 地物生成

/** 平地测试世界：地表固定高度，群系固定 */
function flatWorld(surfaceY = 64, biomeId: number = Biome.PLAINS): FeatureWorld {
  const biome = BIOME_TABLE[biomeId]!;
  return { surfaceY: () => surfaceY, columnBiome: () => biome };
}

/** 铺一层平地（y ≤ surfaceY 为石头，最上面一层为指定地表方块） */
function flatChunk(surfaceY = 64, surfaceBlock = Block.GRASS_BLOCK): Uint8Array {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let y = -64; y <= surfaceY; y++) {
    const id = y === surfaceY ? surfaceBlock : Block.STONE;
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) blocks[Chunk.index(x, y, z)] = id;
    }
  }
  return blocks;
}

/** 整个区块里最高的非空气方块 */
function topOf(blocks: Uint8Array): number {
  for (let y = 319; y >= -64; y--) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) if (blocks[Chunk.index(x, y, z)] !== Block.AIR) return y;
    }
  }
  return -64;
}

/** 整个区块里最低的"地物方块"（排除地面与石头） */
function lowestOf(blocks: Uint8Array, surfaceY: number): number {
  for (let y = surfaceY + 1; y < 320; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) if (blocks[Chunk.index(x, y, z)] !== Block.AIR) return y;
    }
  }
  return 320;
}

function countBlocks(blocks: Uint8Array, ids: readonly number[]): number {
  let count = 0;
  for (const id of blocks) if (ids.includes(id)) count++;
  return count;
}

/** 统计某列范围内的方块（局部 x 范围） */
function countInColumns(blocks: Uint8Array, xFrom: number, xTo: number, ids: readonly number[]): number {
  let count = 0;
  for (let z = 0; z < CHUNK_SIZE_Z; z++) {
    for (let x = xFrom; x <= xTo; x++) {
      for (let y = -64; y < 320; y++) {
        if (ids.includes(blocks[Chunk.index(x, y, z)]!)) count++;
      }
    }
  }
  return count;
}

console.log('\n[11 种树的形状]');
for (const kind of TREE_KINDS) {
  const blocks = flatChunk(64);
  plantTree(kind, blocks, 0, 0, flatWorld(64), 8, 8, 42);
  // 竹只有竹节，其余树种必须有树干 + 树叶
  const trunkCount = countBlocks(blocks, [Block.OAK_LOG, 102, 107, 112, 117, 122, Block.BAMBOO]);
  const leafCount = countBlocks(blocks, [Block.OAK_LEAVES, 104, 109, 114, 119, 124]);
  const hasTrunk = trunkCount > 0;
  const hasLeaves = kind === 'bamboo' ? true : leafCount > 0;
  const label = `${kind}`;
  check(`${label}：长出${kind === 'bamboo' ? '竹节' : '树干与树冠'}`, hasTrunk && hasLeaves, `树干 ${trunkCount} / 树叶 ${leafCount}`);
  // 树高必须在合理范围内（避免某棵树因为参数写错而长到天上或只有 1 格）
  const top = topOf(blocks);
  check(`${label}：高度合理（> 地表 3 格且 < 40 格）`, top > 67 && top < 104, `顶点 y=${top}`);
  // 树干不能悬空：地物最低的方块必须就在地表之上（地表 y=64 → 65）
  const lowest = lowestOf(blocks, 64);
  check(`${label}：树干贴近地面（不悬空）`, lowest <= 67, `最低方块 y=${lowest}`);
}

console.log('\n[跨区块一致性：树冠不会被区块边界切断]');
{
  const stub = flatWorld(64, Biome.FOREST);
  const leafIds = [Block.OAK_LEAVES, 104, 109, 114, 119, 124];
  const logIds = [Block.OAK_LOG, 102, 107, 112, 117, 122];

  // (1) 机制验证：同一棵大橡木（世界坐标 x=15 贴着区块边界），
  //     分别用"拥有者区块"和"右侧邻居区块"的写入器种一遍，世界坐标必须一致：
  //     树干只落在拥有者那边，伸出去的树冠由邻居补上。
  const owner = flatChunk(64);
  const neighbour = flatChunk(64);
  plantTree('big_oak', owner, 0, 0, stub, 15, 8, 5);
  plantTree('big_oak', neighbour, 1, 0, stub, 15, 8, 5);
  check('树干只写在拥有者区块里', countBlocks(neighbour, logIds) === 0, `邻居区块里的树干 ${countBlocks(neighbour, logIds)}`);
  const neighbourLeaves = countInColumns(neighbour, 0, 2, leafIds);
  check('树冠伸进邻居区块（接缝不会被切断）', neighbourLeaves > 0, `邻居区块 0~2 列的树叶 ${neighbourLeaves}`);

  // (2) 同一棵树被两个区块各自重放时，树冠的**绝对高度**必须完全一致，否则接缝处会错位。
  //     取镜像的两列比较：拥有者的世界 x=13（树在 x=15，偏移 -2）与邻居的世界 x=17（偏移 +2）。
  const leafColumn = (blocks: Uint8Array, x: number): string => {
    const ys: number[] = [];
    for (let y = 65; y < 319; y++) if (leafIds.includes(blocks[Chunk.index(x, y, 8)]!)) ys.push(y);
    return ys.join(',');
  };
  check(
    '跨区块重放的树冠高度完全一致（两个区块算出的每一层都对得上）',
    leafColumn(owner, 13) === leafColumn(neighbour, 1) && leafColumn(owner, 13) !== '',
    `拥有者 x=13 [${leafColumn(owner, 13)}] vs 邻居 x=1 [${leafColumn(neighbour, 1)}]`,
  );

  // (3) 真实 decorate 的两区块拼接：把森林树木密度临时调高，接缝处必须有两侧连续的树叶
  const forest = BIOME_FEATURES[Biome.FOREST]!;
  const saved = forest.treeDensity;
  forest.treeDensity = 0.15;

  const left = flatChunk(64);
  const middle = flatChunk(64);
  const right = flatChunk(64);
  const seed = 20261014;
  decorate(left, -1, 0, stub, seed);
  decorate(middle, 0, 0, stub, seed);
  decorate(right, 1, 0, stub, seed);

  let seamPairs = 0;
  for (const [a, aCol, b, bCol] of [
    [left, 15, middle, 0],
    [middle, 15, right, 0],
  ] as const) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let y = 60; y < 110; y++) {
        if (leafIds.includes(a[Chunk.index(aCol, y, z)]!) && leafIds.includes(b[Chunk.index(bCol, y, z)]!)) seamPairs++;
      }
    }
  }
  check('两个接缝上都有连续树冠', seamPairs > 0, `接缝树叶对数 ${seamPairs}`);

  // (4) 交换生成顺序，结果必须逐方块一致（地物是位置纯函数，与访问顺序无关）
  const orderChanged = flatChunk(64);
  decorate(orderChanged, 0, 0, stub, seed);
  let identical = true;
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    if (middle[i] !== orderChanged[i]) {
      identical = false;
      break;
    }
  }
  check('与区块访问顺序无关（两种顺序结果逐方块一致）', identical);

  forest.treeDensity = saved;
}

console.log('\n[群系约束]');
{
  const leafIds = [Block.OAK_LEAVES, 104, 109, 114, 119, 124];
  const logIds = [Block.OAK_LOG, 102, 107, 112, 117, 122];
  const desert = flatChunk(64, Block.SAND);
  decorate(desert, 0, 0, flatWorld(64, Biome.DESERT), 7);
  check('沙漠不长树', countBlocks(desert, logIds) === 0 && countBlocks(desert, leafIds) === 0);
  const desertSpecial = countBlocks(desert, [Block.CACTUS, Block.DEAD_BUSH]);
  check('沙漠有仙人掌或枯木', desertSpecial > 0, `仙人掌/枯木 ${desertSpecial}`);

  const jungle = flatChunk(64);
  decorate(jungle, 0, 0, flatWorld(64, Biome.JUNGLE), 7);
  check('丛林长树', countBlocks(jungle, logIds) > 0);
  check('丛林有草/蕨与西瓜', countBlocks(jungle, [Block.SHORT_GRASS, Block.FERN]) > 0);

  const ocean = flatChunk(40);
  decorate(ocean, 0, 0, flatWorld(40, Biome.DEEP_OCEAN), 7);
  check('深海不长树也不长草', countBlocks(ocean, [...logIds, ...leafIds, Block.SHORT_GRASS]) === 0);

  const swamp = flatChunk(64);
  decorate(swamp, 0, 0, flatWorld(64, Biome.SWAMP), 7);
  check('沼泽有蘑菇或草', countBlocks(swamp, [Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Block.SHORT_GRASS]) > 0);
}

console.log('\n[真实地形抽样：10×10 区块]');
{
  const stats: FeatureStats = { trees: 0, plants: 0, specials: 0 };
  const counts = new Map<number, number>();
  const start = Date.now();
  const generator = new OverworldGenerator(20261014);
  const biomeHistogram = new Map<string, number>();
  for (let cz = 0; cz < 10; cz++) {
    for (let cx = 0; cx < 10; cx++) {
      const blocks = generateChunkBlocks(cx, cz, 20261014, Dimension.OVERWORLD, 'default', undefined, stats);
      for (const id of blocks) counts.set(id, (counts.get(id) ?? 0) + 1);
      const biome = generator.columnBiome(cx * 16 + 8, cz * 16 + 8).name;
      biomeHistogram.set(biome, (biomeHistogram.get(biome) ?? 0) + 1);
    }
  }
  const elapsed = Date.now() - start;
  const named = (id: number) => blockDef(id).name.replace('minecraft:', '');
  const interesting = [
    Block.OAK_LOG,
    Block.SHORT_GRASS,
    Block.FERN,
    Block.DANDELION,
    Block.POPPY,
    Block.SUGAR_CANE,
    Block.CACTUS,
    Block.PUMPKIN,
    Block.MELON,
    Block.DEAD_BUSH,
    Block.BAMBOO,
    Block.RED_MUSHROOM,
  ];
  const rows = interesting.map((id) => `${named(id)} ${counts.get(id) ?? 0}`).join(' · ');
  const biomes = [...biomeHistogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ${count}`)
    .join(' · ');
  console.log(`  100 区块耗时 ${elapsed}ms（含地物）`);
  console.log(`  地物计数：树 ${stats.trees} · 植物 ${stats.plants} · 特殊 ${stats.specials}`);
  console.log(`  群系分布：${biomes}`);
  console.log(`  方块统计：${rows}`);
  // 这片区域以深海与高山为主（见上面的群系分布），树木本来就少，
  // 判据取"确实长出了树、且树真的落在方块里"即可
  check('抽样区域里长出了树', stats.trees > 20, `树 ${stats.trees}`);
  const grass = counts.get(Block.SHORT_GRASS) ?? 0;
  check('抽样区域里长出了草', grass > 30, `草 ${grass}`);
  check('树干真的写进了方块（不是只统计了数量）', (counts.get(Block.OAK_LOG) ?? 0) > 100, `原木 ${counts.get(Block.OAK_LOG)}`);
  check('生成 100 区块耗时 < 3s（地物没有把生成拖垮）', elapsed < 3000, `${elapsed}ms`);
}

console.log('\n[破坏掉落：剪刀 / 精准采集 / 时运 / 替换]');
{
  const none = () => null;
  const plain = { shears: false, silkTouch: false, fortune: 0, doubleSlab: false, roll: () => 0.99 };
  const shears = { ...plain, shears: true };
  const silk = { ...plain, silkTouch: true };

  // ---- 羊毛：只认剪刀
  const wool = woolId(0);
  equal('徒手拆羊毛一无所获（原版行为）', blockDrops(wool, plain), null);
  equal('剪刀剪羊毛掉羊毛自身', blockDrops(wool, shears)?.id, wool);
  equal('精准采集对羊毛无效', blockDrops(wool, silk), null);
  check('羊毛被登记为"必须剪刀"', requiresShears(wool));
  for (let i = 1; i < 16; i++) equal(`第 ${i} 种羊毛同样只认剪刀`, blockDrops(woolId(i), plain), null);

  // ---- 树叶：剪刀与精准采集都行
  equal('剪刀剪树叶掉树叶方块', blockDrops(Block.OAK_LEAVES, shears)?.id, Block.OAK_LEAVES);
  equal('精准采集也能拿树叶', blockDrops(Block.OAK_LEAVES, silk)?.id, Block.OAK_LEAVES);
  check('树叶不要求剪刀（徒手也能拆，只是不掉叶子）', !requiresShears(Block.OAK_LEAVES));

  // ---- 精准采集对普通方块仍然生效
  equal('精准采集拿玻璃', blockDrops(Block.GLASS, silk)?.id, Block.GLASS);
  check('剪刀拿不到玻璃（原版也是）', blockDrops(Block.GLASS, shears) === null || blockDrops(Block.GLASS, shears)?.id !== Block.GLASS);

  // ---- 概率替换：砂砾 → 燧石
  equal('砂砾掷中时掉燧石（顶替砂砾）', blockDrops(Block.GRAVEL, { ...plain, roll: () => 0.01 })?.id, Item.FLINT);
  equal('砂砾没掷中时掉砂砾', blockDrops(Block.GRAVEL, plain)?.id, Block.GRAVEL);

  // ---- 时运只放大矿石
  const fortune3 = { ...plain, fortune: 3 };
  equal('时运 III 掷满时钻石矿掉 4 个', blockDrops(Block.DIAMOND_ORE, { ...fortune3, roll: () => 0.99 })?.count, 4);
  equal('时运不影响石头', blockDrops(Block.STONE, fortune3)?.count, 1);
  equal('时运不影响砂砾→燧石', blockDrops(Block.GRAVEL, { ...fortune3, roll: () => 0.01 })?.count, 1);

  // ---- 双层台阶翻倍
  equal('双层台阶掉 2 个', blockDrops(slabId(0), { ...plain, doubleSlab: true })?.count, 2);
  void none;
}

console.log('\n[小麦与种子（H13）]');
{
  const plain: DropContext = { shears: false, silkTouch: false, fortune: 0, doubleSlab: false, roll: () => 0.5 };
  equal('未熟小麦（第 0 阶段）只掉 1 粒种子', blockDrops(Block.WHEAT_STAGE0, plain)?.id, Item.WHEAT_SEEDS);
  equal('第 2 阶段还是只掉 1 粒种子', blockDrops(Block.WHEAT_STAGE2, plain)?.count, 1);
  equal('成熟小麦掉 1 个小麦', blockDrops(Block.WHEAT_STAGE3, plain)?.id, Item.WHEAT);
  equal('成熟小麦掉 1 个（不是一堆）', blockDrops(Block.WHEAT_STAGE3, plain)?.count, 1);

  // 额外种子：0~3 粒，期望 1.5（原版平均就是 1.5）
  equal('未熟小麦没有额外种子', wheatExtraSeeds(Block.WHEAT_STAGE0, () => 0), 0);
  equal('成熟小麦两次掷点都命中 → 2 粒', wheatExtraSeeds(Block.WHEAT_STAGE3, () => 0), 2);
  equal('两次都没命中 → 0 粒', wheatExtraSeeds(Block.WHEAT_STAGE3, () => 0.9), 0);
  let total = 0;
  for (let i = 0; i < 20000; i++) total += wheatExtraSeeds(Block.WHEAT_STAGE3, Math.random);
  const average = total / 20000;
  check(`20000 次收获平均 ${average.toFixed(2)} 粒种子（原版 1.5）`, Math.abs(average - 1.5) < 0.06, average.toFixed(3));

  // 草丛：12.5% 掉种子，其余什么都不掉（原版唯一稳定的种子来源）
  equal('草丛掷点 0.1 → 掉小麦种子', blockDrops(Block.SHORT_GRASS, { ...plain, roll: () => 0.1 })?.id, Item.WHEAT_SEEDS);
  equal('草丛掷点 0.5 → 什么都不掉', blockDrops(Block.SHORT_GRASS, { ...plain, roll: () => 0.5 }), null);
  equal('草丛的种子概率是 12.5%（原版）', GRASS_SEED_CHANCE, 0.125);
  // 胡萝卜/马铃薯（H13 续）
  equal('未熟胡萝卜掉 1 个自己（能再种回去）', blockDrops(Block.CARROTS_STAGE1, plain)?.id, Item.CARROT);
  equal('成熟胡萝卜主掉落 2 个', blockDrops(Block.CARROTS_STAGE3, plain)?.count, 2);
  equal('成熟马铃薯主掉落 2 个', blockDrops(Block.POTATOES_STAGE3, plain)?.count, 2);
  equal('未熟马铃薯没有额外掉落', extraCropDrop(Block.POTATOES_STAGE2, () => 0), null);
  equal('成熟胡萝卜额外掷点都命中 → 额外 2 个', extraCropDrop(Block.CARROTS_STAGE3, () => 0)?.count, 2);
  equal('成熟胡萝卜额外掷点都不中 → 没有额外', extraCropDrop(Block.CARROTS_STAGE3, () => 0.9), null);
  equal('成熟小麦的额外掉落是种子（走同一条通用路径）', extraCropDrop(Block.WHEAT_STAGE3, () => 0)?.id, Item.WHEAT_SEEDS);
  let carrotTotal = 0;
  for (let i = 0; i < 20000; i++) carrotTotal += extraCropDrop(Block.CARROTS_STAGE3, Math.random)?.count ?? 0;
  const carrotAvg = carrotTotal / 20000;
  check(`20000 次收胡萝卜平均额外 ${carrotAvg.toFixed(2)} 个（期望 1.0，加主掉落 2 个 ≈ 原版 1~4 的中值）`,
    Math.abs(carrotAvg - 1) < 0.06, carrotAvg.toFixed(3));
  let seeds = 0;
  for (let i = 0; i < 20000; i++) if (blockDrops(Block.SHORT_GRASS, { ...plain, roll: Math.random })) seeds++;
  check(`20000 次拔草掉了 ${seeds} 次种子（期望约 2500）`, Math.abs(seeds / 20000 - 0.125) < 0.01, (seeds / 20000).toFixed(4));
}

console.log('\n[睡莲（B16）]');
{
  equal('注册名', blockDef(Block.LILY_PAD).name, 'minecraft:lily_pad');
  equal('中文名是"睡莲"', itemLabel(Block.LILY_PAD), '睡莲');
  equal('形状是 lily_pad（与 flat 的区别是有碰撞）', blockDef(Block.LILY_PAD).shape, 'lily_pad');
  check('走半透明层（叶片四角透明，靠 alpha 混合）', blockDef(Block.LILY_PAD).translucent === true);
  check('不遮挡邻居', !blockDef(Block.LILY_PAD).opaque);
  equal('不透光（不影响光照传播）', blockDef(Block.LILY_PAD).lightOpacity, 0);
  equal('硬度 0 → 徒手一碰就掉', breakSeconds(Block.LILY_PAD), 0);
  check('徒手可采集（原版不用任何工具）', isHandHarvestable(Block.LILY_PAD));
  equal('破坏掉落自身', dropFor(Block.LILY_PAD)?.id, Block.LILY_PAD);
  check('贴图在图集名单里', TILES.includes('lily_pad'));
  check('在创造物品栏里（否则生存里根本拿不到）', CREATIVE_ITEMS.includes(Block.LILY_PAD));
  check('有中文说明（写明能踩、怎么放）', hasDescription(Block.LILY_PAD));
  // 原版睡莲没有合成配方（只能从沼泽的水面上采）
  check('没有工作台配方', recipesForResult(Block.LILY_PAD).length === 0);

  /**
   * 一小片水塘：y=63 是地面、y=64 是水（水面正上方 y=65 是空气）。
   * 睡莲应该只出现在 y=65。
   */
  function pondChunk(): Uint8Array {
    const blocks = flatChunk(63);
    for (let z = 2; z < 12; z++) {
      for (let x = 2; x < 12; x++) blocks[Chunk.index(x, 64, z)] = Block.WATER;
    }
    return blocks;
  }

  let pads = 0;
  const misplaced: string[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const chunk = pondChunk();
    decorate(chunk, 0, 0, flatWorld(63, Biome.SWAMP), seed);
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        for (let y = -64; y < 320; y++) {
          if (chunk[Chunk.index(x, y, z)] !== Block.LILY_PAD) continue;
          pads++;
          // 唯一合法的落点：水面正上方那一格（下方是水）
          if (y !== 65 || chunk[Chunk.index(x, 64, z)] !== Block.WATER) misplaced.push(`${x},${y},${z}`);
        }
      }
    }
  }
  // 100 列水面 × 密度 0.05 × 20 个种子 ≈ 100 片
  check(`20 个种子在水塘里长出 ${pads} 片睡莲（期望约 100）`, pads > 20, `实际 ${pads}`);
  check('睡莲只落在"水面正上方那一格"（水里/地面/空中都不该有）', misplaced.length === 0, misplaced.slice(0, 3).join(' '));

  // 群系约束：只有沼泽配了睡莲，别的群系不该长
  const plains = pondChunk();
  decorate(plains, 0, 0, flatWorld(63, Biome.PLAINS), 7);
  check('平原的水塘里不长睡莲（只有沼泽配了它）', countBlocks(plains, [Block.LILY_PAD]) === 0);
  check('沼泽的配置里确实开了睡莲', (BIOME_FEATURES[Biome.SWAMP]!.lilyPads ?? 0) > 0);
}

console.log(`\n装饰策略测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
