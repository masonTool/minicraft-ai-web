/**
 * 石材家族的台阶 / 楼梯 / 墙（批次 41，B16 的 A 档批量）离线测试
 *
 * 这一批是"表驱动批量补方块"的样板：**16 个母方块 × 原版有的变体 = 36 个新方块**，
 * 但形状（`slab`/`stairs`/`wall`）与贴图（母方块那三张）**全部复用**，
 * 所以真正新增的只有"一条表项 + 它派生出的七处登记"。
 *
 * 因为七处登记（方块表 / 贴图 / 硬度 / 工具 / 分类 / 中文名 / 配方）都要跟着走，
 * 这一套断言就是逐处验收：
 *  1. 表与注册（id 连续、母方块名对得上——防手抄 id 写错）
 *  2. 形状与几何（三种变体的形状、都不遮挡）
 *  3. 贴图复用（变体不新开图）
 *  4. 硬度与工具**跟随母方块**
 *  5. 分类、中文名（不重复、不回退成英文 id）
 *  6. 配方（每种变体一条，材料是它自己的母方块）
 *  7. **原版不该有的变体一个都不许存在**（多造比少造更难查）
 *
 * 运行：npm run test:stone
 */

import {
  BLOCKS,
  Block,
  MORE_STONE_ID_START,
  STONE_VARIANT_ID_START,
  STONE_VARIANT_IDS,
  STONE_VARIANT_PARENTS,
  blockDef,
  blockHardness,
  slabId,
  stoneVariantId,
  type StoneVariantKind,
} from '../src/core/registry/blocks.ts';
import { harvestRequirement } from '../src/core/registry/tools.ts';
import { CREATIVE_ITEMS, Item, blockDrops, categoryOf, itemDef } from '../src/core/registry/items.ts';
import { itemLabel, resolveItemId } from '../src/core/registry/itemNames.ts';
import { SMELTING_RECIPES } from '../src/core/crafting/Smelting.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { isFullBlockShape } from '../src/core/registry/blockShapes.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';

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

/** 构造 size×size 的扁平网格，'·' 表示空 */
function grid(size: 2 | 3, rows: readonly string[], legend: Record<string, number>): number[] {
  const cells = new Array<number>(size * size).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (ch === '·') continue;
      cells[r * size + c] = legend[ch] ?? 0;
    }
  }
  return cells;
}

/** 掉落判定的上下文（素手、无精准采集、无时运、不叠双层台阶） */
function dropCtx() {
  return { shears: false, silkTouch: false, fortune: 0, doubleSlab: false, roll: () => 0.99 };
}

const TILES = new Set<string>(TILE_ORDER);
/** 变体总数（表里所有 kinds 的和） */
const VARIANT_COUNT = STONE_VARIANT_PARENTS.reduce((sum, [, , kinds]) => sum + kinds.length, 0);

// ---------------------------------------------------------------- 1. 表与注册

console.log('\n[表：23 个母方块 / 53 个变体]');
{
  // 批次 41 立表时是 16 个母方块 / 36 个变体；批次 42 追加了 7 个母方块 / 17 个变体
  equal('家族数', STONE_VARIANT_PARENTS.length, 23);
  equal('变体总数', VARIANT_COUNT, 53);
  equal('变体 id 数', STONE_VARIANT_IDS.length, 53);
  // 变体段不许溢进母方块段（母方块 id 是写死的常量，溢了就会撞 id）
  check(
    `变体段（351~${STONE_VARIANT_ID_START + VARIANT_COUNT - 1}）没有越过母方块段起点 ${MORE_STONE_ID_START}`,
    STONE_VARIANT_ID_START + VARIANT_COUNT <= MORE_STONE_ID_START,
  );

  // 母方块名对得上（表里只能写数字 id，这一条专门防"数字抄错")
  for (const [parent, name] of STONE_VARIANT_PARENTS) {
    equal(`${name} 的母方块 id 指向自己`, blockDef(parent).name, `minecraft:${name}`);
  }

  // id 连续、追加式
  const expected = Array.from({ length: VARIANT_COUNT }, (_v, i) => STONE_VARIANT_ID_START + i);
  equal('id 从 351 连续排下来', STONE_VARIANT_IDS.join(','), expected.join(','));
  check(
    '每个 id 都能在方块表里按下标取到',
    STONE_VARIANT_IDS.every((id) => BLOCKS[id] !== undefined && BLOCKS[id]!.id === id),
  );
  check(
    '最后一个变体之后没有断号',
    BLOCKS[STONE_VARIANT_ID_START + VARIANT_COUNT] === undefined ||
      BLOCKS[STONE_VARIANT_ID_START + VARIANT_COUNT]!.id === STONE_VARIANT_ID_START + VARIANT_COUNT,
  );
  check('全部在旧的最大 id 之后（追加式，不打乱老编号）', STONE_VARIANT_IDS.every((id) => id >= STONE_VARIANT_ID_START));

  // 查表 API
  equal('查表：花岗岩台阶', stoneVariantId('granite', 'slab'), STONE_VARIANT_ID_START);
  check('查表：原版没有的变体返回 undefined', stoneVariantId('purpur_block', 'wall') === undefined);
  check('查表：未知母方块返回 undefined', stoneVariantId('not_a_block', 'slab') === undefined);
}

// ---------------------------------------------------------------- 2. 形状

console.log('\n[形状与几何]');
{
  const shapeOf: Record<StoneVariantKind, string> = { slab: 'slab', stairs: 'stairs', wall: 'wall' };
  for (const [, name, kinds] of STONE_VARIANT_PARENTS) {
    for (const kind of kinds) {
      const id = stoneVariantId(name, kind)!;
      equal(`${name}_${kind} 的形状`, blockDef(id).shape, shapeOf[kind]);
    }
  }
  check(
    '全部变体都不遮挡邻居（否则上方方块的面会被剔掉）',
    STONE_VARIANT_IDS.every((id) => !blockDef(id).opaque && blockDef(id).lightOpacity === 0),
  );
  check(
    '全部不是整格（不参与贪心合并）',
    STONE_VARIANT_IDS.every((id) => !isFullBlockShape(blockDef(id).shape, 0)),
  );
  check('墙确实用了 wall 形状（横幅连接要它）', blockDef(stoneVariantId('granite', 'wall')!).shape === 'wall');
}

// ---------------------------------------------------------------- 3. 贴图

console.log('\n[贴图：全部复用母方块，不新开图]');
{
  for (const [parent, name, kinds] of STONE_VARIANT_PARENTS) {
    const parentTiles = blockDef(parent).tiles.join(',');
    for (const kind of kinds) {
      const id = stoneVariantId(name, kind)!;
      equal(`${name}_${kind} 用母方块的贴图`, blockDef(id).tiles.join(','), parentTiles);
    }
  }
  check(
    '变体的贴图都在图集里（复用母方块，所以本来就在）',
    STONE_VARIANT_IDS.every((id) => blockDef(id).tiles.every((tile) => TILES.has(tile))),
  );
}

// ---------------------------------------------------------------- 4. 硬度与工具

console.log('\n[硬度与工具：跟随母方块]');
{
  for (const [parent, name, kinds] of STONE_VARIANT_PARENTS) {
    for (const kind of kinds) {
      const id = stoneVariantId(name, kind)!;
      equal(`${name}_${kind} 硬度 = 母方块`, blockHardness(id), blockHardness(parent));
    }
  }
  check(
    '全部需要镐（这些母方块原版都要镐）',
    STONE_VARIANT_IDS.every((id) => harvestRequirement(id)?.tool === 'pickaxe'),
  );
  check(
    '镐的等级与母方块一致',
    STONE_VARIANT_PARENTS.every(([parent, name, kinds]) =>
      kinds.every(
        (kind) => harvestRequirement(stoneVariantId(name, kind)!)?.tier === harvestRequirement(parent)?.tier,
      ),
    ),
  );
  // 顺手核对几只"母方块硬度写错会让 5 个变体一起错"的
  equal('花岗岩 1.5（变体跟着 1.5）', blockHardness(stoneVariantId('granite', 'wall')!), 1.5);
  equal('圆石类 2 → 苔石墙 2', blockHardness(stoneVariantId('mossy_cobblestone', 'wall')!), 2);
  equal('深板岩圆石 3.5（本批把母方块从 3 修正）', blockHardness(stoneVariantId('cobbled_deepslate', 'stairs')!), 3.5);
  equal('下界砖 2', blockHardness(stoneVariantId('nether_bricks', 'wall')!), 2);
  equal('末地石砖 3', blockHardness(stoneVariantId('end_stone_bricks', 'slab')!), 3);
  equal('紫珀 1.5', blockHardness(stoneVariantId('purpur_block', 'stairs')!), 1.5);
}

// ---------------------------------------------------------------- 5. 分类与中文名

console.log('\n[分类与中文名]');
{
  check('全部在创造物品栏里', STONE_VARIANT_IDS.every((id) => CREATIVE_ITEMS.includes(id)));
  check('全部归"建筑"分类', STONE_VARIANT_IDS.every((id) => categoryOf(id) === 'building'));

  const labels = STONE_VARIANT_IDS.map((id) => itemLabel(id));
  equal('53 个中文名两两不同', new Set(labels).size, 53);
  // 失败时把"哪几个没名字"直接打出来（漏一条中文名是靠肉眼看不出来的）
  const missingLabel = STONE_VARIANT_IDS.filter((id) => {
    const label = itemLabel(id);
    return /^[a-z_]+$/.test(label) || label.startsWith('未知');
  }).map((id) => blockDef(id).name);
  check(
    '没有回退成英文 id 的（回退的表现是名字里全是小写字母与下划线）',
    missingLabel.length === 0,
    missingLabel.join(', '),
  );
  equal('花岗岩台阶', itemLabel(stoneVariantId('granite', 'slab')!), '花岗岩台阶');
  equal('苔石砖墙', itemLabel(stoneVariantId('mossy_stone_bricks', 'wall')!), '苔石砖墙');
  equal('切制砂岩台阶', itemLabel(stoneVariantId('cut_sandstone', 'slab')!), '切制砂岩台阶');
  equal('平滑砂岩楼梯', itemLabel(stoneVariantId('smooth_sandstone', 'stairs')!), '平滑砂岩楼梯');
  equal('深板岩圆石墙', itemLabel(stoneVariantId('cobbled_deepslate', 'wall')!), '深板岩圆石墙');
  equal('磨制深板岩墙', itemLabel(stoneVariantId('polished_deepslate', 'wall')!), '磨制深板岩墙');
  equal('末地石砖楼梯', itemLabel(stoneVariantId('end_stone_bricks', 'stairs')!), '末地石砖楼梯');
  equal('紫珀块台阶', itemLabel(stoneVariantId('purpur_block', 'slab')!), '紫珀块台阶');
}

// ---------------------------------------------------------------- 6. 配方

console.log('\n[配方：每种变体一条，材料是它自己的母方块]');
{
  for (const [parent, name, kinds] of STONE_VARIANT_PARENTS) {
    for (const kind of kinds) {
      const id = stoneVariantId(name, kind)!;
      const cells =
        kind === 'slab'
          ? grid(3, ['PPP'], { P: parent })
          : kind === 'stairs'
            ? grid(3, ['P··', 'PP·', 'PPP'], { P: parent })
            : grid(3, ['PPP', 'PPP'], { P: parent });
      equal(`${name}_${kind} 能用自己的母方块合出来`, matchRecipe(cells, 3)?.id, id);
      equal(`${name}_${kind} 产量`, matchRecipe(cells, 3)?.count, kind === 'stairs' ? 4 : 6);
    }
  }

  // 材料必须是**它自己的**母方块：同样摆 3 个，花岗岩出花岗岩台阶、圆石出圆石台阶
  equal(
    '花岗岩台阶用的是花岗岩',
    matchRecipe(grid(3, ['PPP'], { P: Block.GRANITE }), 3)?.id,
    stoneVariantId('granite', 'slab'),
  );
  equal(
    '圆石不会串到花岗岩台阶',
    matchRecipe(grid(3, ['PPP'], { P: Block.COBBLESTONE }), 3)?.id,
    slabId(1),
  );
  equal(
    '苔石砖墙用的是苔石砖',
    matchRecipe(grid(3, ['PPP', 'PPP'], { P: Block.MOSSY_STONE_BRICKS }), 3)?.id,
    stoneVariantId('mossy_stone_bricks', 'wall'),
  );

  equal(
    '53 个变体各有且只有 1 条配方',
    RECIPES.filter((recipe) => STONE_VARIANT_IDS.includes(recipe.result.id)).length,
    53,
  );
}

// ---------------------------------------------------------------- 7. 不该存在的变体

console.log('\n[原版没有的变体，一个都不许造]');
{
  // 原版对"錾制 / 裂纹"类不出变体；`stone` / `purpur` / 平滑与切制砂岩没有墙；
  // `cut_sandstone` 连楼梯都没有
  const forbidden = [
    'stone_wall',
    'chiseled_stone_bricks_slab',
    'chiseled_stone_bricks_wall',
    'cracked_stone_bricks_slab',
    'cracked_stone_bricks_wall',
    'chiseled_sandstone_slab',
    'chiseled_sandstone_stairs',
    'chiseled_sandstone_wall',
    'cut_sandstone_stairs',
    'cut_sandstone_wall',
    'smooth_sandstone_wall',
    'purpur_wall',
    'purpur_pillar_slab',
    'purpur_pillar_wall',
    'polished_granite_wall',
    'polished_diorite_wall',
    'polished_andesite_wall',
    'smooth_stone_wall',
    'quartz_wall',
    'smooth_quartz_wall',
    'prismarine_bricks_wall',
    'dark_prismarine_wall',
    'chiseled_quartz_block_slab',
    'quartz_pillar_stairs',
  ];
  // ⚠️ 批次 41 曾把 `prismarine_wall` 与 `deepslate_tiles_wall` 也列进"不该存在"——
  // 那是**记错了**：两者原版都有（海晶石墙是 1.14 加的，深板岩瓦是 1.17 加的），
  // 批次 42 已经把这两个补上了，它们现在属于"应该存在"的那一组。

  check(
    `这些方块都不该存在（${forbidden.length} 个）`,
    forbidden.every((name) => resolveItemId(name) === undefined),
    forbidden.filter((name) => resolveItemId(name) !== undefined).join(', '),
  );
  // 反向对照：原版确实有的几个要存在
  check(
    '对照：原版有的那些确实存在',
    [
      'granite_wall',
      'cobbled_deepslate_stairs',
      'end_stone_bricks_slab',
      'smooth_sandstone_stairs',
      // 批次 42 补上的两个（批次 41 曾误判成"不该存在"）
      'prismarine_wall',
      'deepslate_tiles_wall',
    ].every((name) => resolveItemId(name) !== undefined),
  );
}

// ---------------------------------------------------------------- 8. 第二批母方块与石英链

console.log('\n[第二批母方块：石英家族 / 深板岩瓦 / 红色下界砖]');
{
  const newParents: readonly (readonly [number, string, string])[] = [
    [Block.QUARTZ_BLOCK, 'quartz_block', '石英块'],
    [Block.CHISELED_QUARTZ_BLOCK, 'chiseled_quartz_block', '錾制石英块'],
    [Block.QUARTZ_PILLAR, 'quartz_pillar', '石英柱'],
    [Block.SMOOTH_QUARTZ, 'smooth_quartz', '平滑石英'],
    [Block.DEEPSLATE_TILES, 'deepslate_tiles', '深板岩瓦'],
    [Block.RED_NETHER_BRICKS, 'red_nether_bricks', '红色下界砖'],
  ];

  check('6 个母方块的 id 从 404 连续排下来', newParents.every(([id], i) => id === MORE_STONE_ID_START + i));
  check('都注册进了方块表', newParents.every(([id]) => BLOCKS[id]?.id === id));
  check('注册名正确', newParents.every(([id, name]) => blockDef(id).name === `minecraft:${name}`));
  check('中文名正确', newParents.every(([id, , cn]) => itemLabel(id) === cn));
  check('都在创造物品栏里且归"建筑"', newParents.every(([id]) => CREATIVE_ITEMS.includes(id) && categoryOf(id) === 'building'));
  check('都要镐', newParents.every(([id]) => harvestRequirement(id)?.tool === 'pickaxe'));
  check(
    '贴图都在图集里（本批新画了石英 6 张 + 深板岩瓦 + 红色下界砖）',
    newParents.every(([id]) => blockDef(id).tiles.every((tile) => TILES.has(tile))),
  );
  equal('石英块硬度 0.8', blockHardness(Block.QUARTZ_BLOCK), 0.8);
  equal('深板岩瓦 3.5（与深板岩砖同档）', blockHardness(Block.DEEPSLATE_TILES), 3.5);
  equal('红色下界砖 2（与下界砖同档）', blockHardness(Block.RED_NETHER_BRICKS), 2);

  // 錾制石英块与石英柱**没有**任何变体（原版如此）
  check('錾制石英块没有变体', stoneVariantId('chiseled_quartz_block', 'slab') === undefined);
  check('石英柱没有变体', stoneVariantId('quartz_pillar', 'stairs') === undefined);
  // 石英的台阶/楼梯叫"石英台阶"（母方块却叫"石英块"）
  equal('石英台阶的中文名', itemLabel(stoneVariantId('quartz_block', 'slab')!), '石英台阶');
  equal('石英楼梯的中文名', itemLabel(stoneVariantId('quartz_block', 'stairs')!), '石英楼梯');
  equal('海晶石墙的中文名', itemLabel(stoneVariantId('prismarine', 'wall')!), '海晶石墙');
  equal('暗海晶石楼梯的中文名', itemLabel(stoneVariantId('dark_prismarine', 'stairs')!), '暗海晶石楼梯');
}

console.log('\n[石英链：下界石英 → 石英块 → 石英柱 / 錾制石英 / 平滑石英]');
{
  // 原料来源：下界石英矿石掉 1 个下界石英（此前漏了这条覆盖，掉的是方块本身）
  equal('下界石英矿石掉下界石英', blockDrops(Block.NETHER_QUARTZ_ORE, dropCtx())?.id, Item.QUARTZ);
  equal('一次掉 1 个', blockDrops(Block.NETHER_QUARTZ_ORE, dropCtx())?.count, 1);
  equal('下界石英的中文名', itemLabel(Item.QUARTZ), '下界石英');
  check('下界石英在创造物品栏里', CREATIVE_ITEMS.includes(Item.QUARTZ));
  check('下界石英的图标在图集里', TILES.has(itemDef(Item.QUARTZ)!.tile));

  // 合成链
  equal(
    '4 下界石英（2×2）→ 石英块',
    matchRecipe(grid(2, ['QQ', 'QQ'], { Q: Item.QUARTZ }), 2)?.id,
    Block.QUARTZ_BLOCK,
  );
  equal(
    '2 石英块竖排 → 2 石英柱',
    matchRecipe(grid(2, ['Q·', 'Q·'], { Q: Block.QUARTZ_BLOCK }), 2)?.count,
    2,
  );
  equal(
    '2 石英台阶竖排 → 錾制石英块',
    matchRecipe(grid(2, ['S·', 'S·'], { S: stoneVariantId('quartz_block', 'slab')! }), 2)?.id,
    Block.CHISELED_QUARTZ_BLOCK,
  );
  // ⚠️ 深板岩瓦在原版与"深板岩砖"**同输入同图案**（4 磨制深板岩 → 4 个），
  // 而本项目的合成匹配是**单结果模型**（`matchRecipe` 取首个匹配），所以现在合出来的是深板岩砖。
  // 数据两条都在表里；等 H11 的切石机（或"一格多结果"的匹配）落地后，这条断言会失败并提醒回来改
  // （深板岩瓦的正当来源本来就是切石机：1 个磨制深板岩 → 1 个深板岩瓦）。
  equal(
    '4 磨制深板岩合出的是深板岩砖（同输入的深板岩瓦配方被挡住）',
    matchRecipe(grid(2, ['DD', 'DD'], { D: Block.POLISHED_DEEPSLATE }), 2)?.id,
    Block.DEEPSLATE_BRICKS,
  );
  check(
    '深板岩瓦的配方数据仍在表里（等切石机/多结果匹配来解锁）',
    RECIPES.some((recipe) => recipe.result.id === Block.DEEPSLATE_TILES),
  );
  equal(
    '2 下界砖 + 2 下界疣（棋盘）→ 红色下界砖',
    matchRecipe(grid(2, ['NW', 'WN'], { N: Block.NETHER_BRICKS, W: Item.NETHER_WART }), 2)?.id,
    Block.RED_NETHER_BRICKS,
  );
  // 平滑石英只能靠熔炼（原版）
  const smelt = SMELTING_RECIPES.find((recipe) => recipe.input === Block.QUARTZ_BLOCK);
  equal('平滑石英由石英块熔炼而来', smelt?.output.id, Block.SMOOTH_QUARTZ);
  check('石英块没有合成配方（只能熔炼出平滑石英，不能反过来合）', matchRecipe(grid(2, ['QQ', 'QQ'], { Q: Block.QUARTZ_BLOCK }), 2)?.id !== Block.SMOOTH_QUARTZ);
}

console.log(`\n石材家族变体测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
