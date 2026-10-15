/**
 * 合成系统离线测试
 *
 * 运行：npm run test:crafting
 */

import { Block, WOOL_ID_START, woolId } from '../src/core/registry/blocks.ts';
import { DYE_COLORS } from '../src/core/registry/colors.ts';
import { Item, dyeItemId } from '../src/core/registry/items.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { CraftingGrid } from '../src/core/crafting/CraftingGrid.ts';
import { Inventory } from '../src/core/container/Inventory.ts';

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

const P = Block.OAK_PLANKS;
const LOG = Block.OAK_LOG;
const COBBLE = Block.COBBLESTONE;

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

const L = { P, L: LOG, C: COBBLE };

console.log('\n[有序配方：最小包围盒归一化]');
{
  // 2×2 木板放在 2×2 网格的左上
  const inCorner = grid(2, ['PP', 'PP'], L);
  const result = matchRecipe(inCorner, 2);
  equal('2×2 木板 → 工作台', result?.id, Block.CRAFTING_TABLE);

  // 同样的 2×2 图案放在 3×3 网格的右下角（第 2-3 行 / 第 2-3 列）
  const offset = grid(3, ['···', '·PP', '·PP'], L);
  const offsetResult = matchRecipe(offset, 3);
  equal('3×3 网格右下角的 2×2 图案也能合成工作台', offsetResult?.id, Block.CRAFTING_TABLE);

  // 材料不足
  const incomplete = grid(2, ['PP', 'P·'], L);
  equal('缺一格不匹配', matchRecipe(incomplete, 2), null);

  // 形状不对（摆成一行）
  const line = grid(2, ['PP', '··'], L);
  equal('摆成一行不匹配工作台', matchRecipe(line, 2), null);
}

console.log('\n[有序配方：3×3 环形]');
{
  const chest = grid(3, ['PPP', 'P·P', 'PPP'], L);
  equal('8 木板围一圈 → 箱子', matchRecipe(chest, 3)?.id, Block.CHEST);

  const furnace = grid(3, ['CCC', 'C·C', 'CCC'], L);
  equal('8 圆石围一圈 → 熔炉', matchRecipe(furnace, 3)?.id, Block.FURNACE);

  // 3×3 配方在 2×2 网格里放不下（4 圆石既不是熔炉也不是工作台）
  const tooSmall = grid(2, ['CC', 'CC'], L);
  check('2×2 网格无法完成 3×3 配方', matchRecipe(tooSmall, 2) === null);

  // 中间也填满 → 不再是环形
  const solid = grid(3, ['PPP', 'PPP', 'PPP'], L);
  equal('填满 9 格不匹配箱子', matchRecipe(solid, 3), null);
}

console.log('\n[有序配方：竖直木棍]');
{
  const sticks = grid(2, ['P·', 'P·'], L);
  equal('2 木板竖排 → 4 木棍', matchRecipe(sticks, 2)?.id, Item.STICK);
  equal('木棍产量 4', matchRecipe(sticks, 2)?.count, 4);

  // 木棍的图案是 2 行 1 列，横排是 1 行 2 列，镜像也不会变成竖排
  const horizontal = grid(2, ['PP', '··'], L);
  check('横排木板不匹配木棍配方', matchRecipe(horizontal, 2) === null);
}

console.log('\n[无序配方]');
{
  const single = grid(2, ['L·', '··'], L);
  const result = matchRecipe(single, 2);
  equal('1 原木 → 木板', result?.id, P);
  equal('木板产量 4', result?.count, 4);

  const corner = grid(2, ['··', '·L'], L);
  equal('原木放任意位置都能合成（无序）', matchRecipe(corner, 2)?.id, P);

  const two = grid(2, ['LL', '··'], L);
  equal('2 原木不匹配（配方只吃 1 个）', matchRecipe(two, 2), null);

  const empty = grid(2, ['··', '··'], L);
  equal('空网格无产物', matchRecipe(empty, 2), null);
}

console.log('\n[合成网格：取出产物消耗材料]');
{
  const inventory = new Inventory();
  const gridModel = new CraftingGrid(2);
  gridModel.set(0, { id: P, count: 5 });
  gridModel.set(1, { id: P, count: 5 });
  gridModel.set(2, { id: P, count: 5 });
  gridModel.set(3, { id: P, count: 5 });

  equal('4 格木板 → 工作台', gridModel.result?.id, Block.CRAFTING_TABLE);
  check('取出产物成功', gridModel.takeResult());
  equal('合成一次后每格剩 4 个', gridModel.get(0)?.count, 4);
  equal('产物仍是工作台（材料还够）', gridModel.result?.id, Block.CRAFTING_TABLE);

  // 只放一格木板：不匹配
  const partial = new CraftingGrid(2);
  partial.set(0, { id: P, count: 1 });
  equal('单格木板无产物', partial.result, null);

  gridModel.drainTo(inventory);
  check('收起网格后材料回到背包', gridModel.isEmpty);
  equal('背包中共 16 个木板', inventory.countOf(P), 16);
}

console.log('\n[合成网格：木棍进阶链]');
{
  const table = new CraftingGrid(3);
  // 1 原木 → 4 木板
  table.set(0, { id: LOG, count: 1 });
  equal('第一步：原木 → 木板', table.result?.id, P);
  equal('第一步产量 4', table.result?.count, 4);

  const grid2 = new CraftingGrid(2);
  grid2.set(0, { id: P, count: 1 });
  grid2.set(2, { id: P, count: 1 });
  equal('第二步：2 木板竖排 → 木棍', grid2.result?.id, Item.STICK);

  // 15 基础 + 16 羊毛染色 + 台阶楼梯 24 + 功能 7 + 木材 15 + 玻璃板 17 + 工具 25 + 盔甲 16
  // + 食物 1 + 附魔 4（纸/书/附魔台/书架）+ 铁砧 3（铁砧本体 + 铁块两向）
  // + 弓与箭 3（箭/弓/羊毛拆线）+ 剪刀 1
  // （盔甲 16 而不是 20：锁链甲与原版一样没有配方，见 armor-test；食物目前只有金苹果）
  equal(
    '配方表规模（基础 15 + 羊毛 16 + 台阶楼梯 24 + 功能 7 + 木材 15 + 玻璃板 17 + 工具 25 + 盔甲 16 + 食物 1 + 附魔 4 + 铁砧 3 + 弓与箭 3 + 剪刀 1 + 桶 1 + 面包 1 + 酿造 2 + 酿造台 1 + 投掷物 1 + 药水箭 28 + 活板门与栅栏门 2 + 打火石 1）',
    RECIPES.length,
    184,
  );
}

console.log('\n[石材家族配方]');
{
  const stoneBricks = grid(2, ['SS', 'SS'], { S: Block.STONE });
  equal('4 石头 → 4 石砖', matchRecipe(stoneBricks, 2)?.id, Block.STONE_BRICKS);
  equal('石砖产量 4', matchRecipe(stoneBricks, 2)?.count, 4);

  const chiseled = grid(2, ['S·', 'S·'], { S: Block.STONE_BRICKS });
  equal('2 石砖竖排 → 錾制石砖', matchRecipe(chiseled, 2)?.id, Block.CHISELED_STONE_BRICKS);

  const polished = grid(2, ['GG', 'GG'], { G: Block.GRANITE });
  equal('4 花岗岩 → 4 磨制花岗岩', matchRecipe(polished, 2)?.id, Block.POLISHED_GRANITE);

  const deepslateChain = grid(2, ['DD', 'DD'], { D: Block.DEEPSLATE });
  equal('4 深板岩 → 4 磨制深板岩', matchRecipe(deepslateChain, 2)?.id, Block.POLISHED_DEEPSLATE);

  const deepslateBricks = grid(2, ['DD', 'DD'], { D: Block.POLISHED_DEEPSLATE });
  equal('4 磨制深板岩 → 4 深板岩砖', matchRecipe(deepslateBricks, 2)?.id, Block.DEEPSLATE_BRICKS);

  const bricks = grid(2, ['BB', 'BB'], { B: Item.BRICK });
  equal('4 红砖 → 1 砖块', matchRecipe(bricks, 2)?.id, Block.BRICKS);

  const sandstone = grid(2, ['SS', 'SS'], { S: Block.SAND });
  equal('4 沙 → 1 砂岩', matchRecipe(sandstone, 2)?.id, Block.SANDSTONE);
}

console.log('\n[羊毛染色：16 色]');
{
  let matched = 0;
  for (let index = 0; index < DYE_COLORS.length; index++) {
    const cells = grid(2, ['WD', '··'], { W: woolId(0), D: dyeItemId(index) });
    const result = matchRecipe(cells, 2);
    if (result?.id === woolId(index)) matched++;
  }
  equal('16 种染料都能把白羊毛染成对应颜色', matched, DYE_COLORS.length);

  // 染色是无序的：左右调换也能合成
  const swapped = grid(2, ['DW', '··'], { W: woolId(0), D: dyeItemId(3) });
  equal('染料与羊毛位置调换也成立（无序配方）', matchRecipe(swapped, 2)?.id, woolId(3));

  // 不能直接拿两种染料合成
  const dyeOnly = grid(2, ['DD', '··'], { D: dyeItemId(1) });
  check('两种染料不能合成羊毛', matchRecipe(dyeOnly, 2) === null);

  equal('蓝色羊毛的 id 与起始值一致', woolId(11), WOOL_ID_START + 11);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
