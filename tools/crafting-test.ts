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

  // 形状不对（摆成一行）：不匹配工作台——但**匹配橡木压力板**。
  // ⚠️ 这一条原本断言"什么都不匹配"，批次 119 按原版补上"2 木板 → 1 压力板"之后
  // 它就有了正确答案：**一行两块木板本来就是压力板**（原版如此，见 `REDSTONE_RECIPES`）
  const line = grid(2, ['PP', '··'], L);
  check('摆成一行不匹配工作台', matchRecipe(line, 2)?.id !== Block.CRAFTING_TABLE);
  equal('而它匹配的是橡木压力板（原版就是"两块木板 → 一块压力板"）', matchRecipe(line, 2)?.id, Block.OAK_PRESSURE_PLATE);
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
  // （横排那两块木板在批次 119 之后匹配的是**橡木压力板**，见上面那条注释）
  const horizontal = grid(2, ['PP', '··'], L);
  check('横排木板不匹配木棍配方', matchRecipe(horizontal, 2)?.id !== Item.STICK);
  equal('横排木板匹配的是橡木压力板', matchRecipe(horizontal, 2)?.id, Block.OAK_PRESSURE_PLATE);
  // 同一族的另一种（顺带确认图例没串）：两块**石头**横排 → 石质压力板。
  // ⚠️ 这里自己给一份图例（上面的 `L` 里 'C' 是圆石，不是石头）
  const stoneLine = grid(2, ['CC', '··'], { C: Block.STONE });
  equal('两块石头横排 → 石质压力板', matchRecipe(stoneLine, 2)?.id, Block.STONE_PRESSURE_PLATE);
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

  // 只放一格木板：**有产物**（一块木板 → 一个按钮，批次 119 按原版补的），
  // 但**不是工作台**——这一条原本断言"什么都不匹配"，它守的是"一格凑不出工作台"
  const partial = new CraftingGrid(2);
  partial.set(0, { id: P, count: 1 });
  equal('单格木板 → 橡木按钮（原版如此），而不是工作台', partial.result?.id, Block.OAK_BUTTON);
  check('（对照）一格木板确实不是工作台', partial.result?.id !== Block.CRAFTING_TABLE);

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

  // 15 基础 + 16 羊毛染色 + 16 地毯 + 台阶楼梯 24 + 功能 7 + 木材 15 + 玻璃板 17 + 工具 25 + 盔甲 16
  // + 食物 1 + 附魔 4（纸/书/附魔台/书架）+ 铁砧 3（铁砧本体 + 铁块两向）
  // + 弓与箭 3（箭/弓/羊毛拆线）+ 剪刀 1
  // （盔甲 16 而不是 20：锁链甲与原版一样没有配方，见 armor-test；食物目前只有金苹果）
  //
  // 木制方块族（批次 38）：橡木那四条（栅栏/栅栏门/门/活板门）原先手写在配方表里，
  // 现在整族由 `WoodShaped` 展开成 **6 种木材 × 4 件 = 24 条**，
  // 所以规模 = 205（旧明细） − 4（撤掉手写的橡木四条） + 24（整族） = 225
  //
  // 锁链与铁粒（批次 39）：+3 条（锁链 1、9 铁粒 ↔ 1 铁锭 2）→ 228
  // 铜的氧化（批次 40）：+17 条（新铜块 1 + 每档拆回铜锭 4 + 每档切制 4 + 台阶 4 + 楼梯 4）→ 245
  // 石材家族的台阶/楼梯/墙（批次 41）：+36 条（每个变体一条）→ 281
  // 石英与更多石材（批次 42）：+22 条（17 个新变体 + 石英链 5 条）→ 303
  // 切石机（批次 44）：+1 条（1 铁锭 + 3 石头）→ 304
  //   ⚠️ 切石机**自己那 120 条切石配方不算在这里**：它们不是合成台配方，
  //   住在 `core/crafting/Stonecutting.ts` 里（由 `test:stonecutter` 盯着规模）
  // 红砂岩家族（批次 45）：+11 条 → 315
  //   = 砂岩家族补齐 2 条（切制 / 錾制砂岩，原版一直有、此前只有切石机那条路）
  //   + 红砂岩链 3 条（红沙 → 红砂岩、红砂岩 → 切制红砂岩、2 红砂岩台阶 → 錾制红砂岩）
  //   + 红砂岩变体 6 条（由 `STONE_VARIANT_PARENTS` 自动展开：3 + 1 + 2）
  // 烟熏炉与高炉（批次 46）：+7 条 → 322
  //   = 烟熏炉 6 条（原版是"任意原木"的标签配方，按 6 种原木各展开一条）
  //   + 高炉 1 条（5 铁锭 + 熔炉 + 3 平滑石头）
  // 营火（批次 47）：+12 条 → 334
  //   = 6 种原木 × 2 种燃料（煤炭 / 木炭）——原版是标签配方，两种燃料都得认，
  //     否则"手里只有木炭"的玩家会看着配方书发呆
  // 食物与杂物（批次 48，B17）：+7 条 → 341
  //   = 金粒两向 2 + 碗 1 + 蘑菇煲 1 + 甜菜汤 1 + 南瓜派 1 + 金胡萝卜 1
  // 甜浆果与可可豆（批次 49）：+2 条 → 343（曲奇 1 + 棕色染料 1）
  // 海带与干海带（批次 50）：+2 条 → 345（9 个干海带 ↔ 1 块干海带块）
  // 蛋糕与花盆（批次 52）：+2 条 → 347（蛋糕 1 + 花盆 1）
  // 脚手架（批次 53）：+1 条 → 348
  // 阳光传感器（批次 54）：+1 条 → 349
  // 绊线钩（批次 55）：+1 条 → 350
  // TNT（批次 56）：+1 条 → 351
  // 可疑的炖菜（批次 57）：+5 条 → 356（五朵花各一条）
  // 漏斗（批次 58）：+1 条 → 357（5 铁锭围 1 个箱子）
  // 投掷器（批次 59）：+1 条 → 358（7 圆石围 1 个红石粉）
  // 发射器（批次 60）：+1 条 → 359（7 圆石围 1 张弓，与投掷器只差中间那格）
  // 木桶（批次 61）：+1 条 → 360（6 木板 + 上下两个木板台阶）
  // 骨粉（批次 69）：+1 条 → 361（1 根骨头 → 3 份骨粉）
  // 堆肥桶（批次 70）：+1 条 → 362（7 个木板台阶围一圈）
  // 末影箱（批次 71）：+1 条 → 363（8 黑曜石 + 1 钻石；原版要末影之眼，本项目还没有）
  // 潜影盒（批次 72）：+1 条 → 364（8 末地石 + 1 箱子；原版要潜影贝壳，本项目还没有）
  // 瓜类种子（批次 77）：+2 条 → 366（1 南瓜 → 4 南瓜籽、1 西瓜片 → 1 西瓜籽）
  // 床（批次 79）：+16 条 → 382（3 同色羊毛 + 3 橡木木板，16 色按配色表展开）
  // 告示牌（批次 80）：+6 条 → 388（6 同种木板 + 1 木棍 → 3 个，6 种木材各一条）
  // 钓竿（批次 81）：+1 条 → 389（3 木棍 + 2 线）
  // 黑石家族（批次 82）：+2 条 → 391（4 黑石 → 磨制黑石、4 磨制 → 黑石砖）
  // 避雷针（批次 83）：+1 条 → 392（3 个铜锭竖排）
  // 黑石家族补齐（批次 85，B50）：+7 条 → 399（磨制黑石/磨制黑石砖各 3 个变体 + 錾制 1 条）
  // 展示框与画（批次 86，B14）：+17 条 → 416（展示框 1 条 + 画 16 条——
  // 画在原版是"任意羊毛"的标签配方，本项目按既有做法展开成 16 种羊毛各一条）
  // 村民的工作站四件（批次 90，J23）：+4 条 → 420（讲台/制箭台/砂轮/织布机）
  // 史莱姆那条链（批次 120）：+3 条 → 500（粘性活塞 + 粘液块两向）
  // 红石元件与三件补漏（批次 119）：+19 条 → 497（可达性审计量出来的缺口）
  // 矿物块与信标（批次 117，K5）：+7 条 → 478
  // （金/钻石/绿宝石块各两条"压紧 + 拆回"，信标一条）
  // 末影之眼（批次 111，K9）：+1 条 → 471（1 末影珍珠 + 1 烈焰粉）
  // 烈焰粉（批次 92，J26）：+1 条 → 470（1 根烈焰棒 → 2 份，酿造台的燃料与配方原料）
  // 染料来源与染色族（批次 91）：+49 条 → 469
  //   —— 染料来源 15（5 种花 + 甜菜根 + 青金石 + 骨粉 + 7 条混合）、
  //      酿造材料 2（发酵蜘蛛眼、闪烁的西瓜片）、
  //      染色玻璃 16 + 彩色陶瓦 16（此前这两族一个配方都没有）
  equal(
    '配方表规模（旧明细 205 − 手写橡木 4 + 木制族 24 + 锁链与铁粒 3 + 铜 17 + 石材变体 53 + 石英链 5 + 切石机 1 + 砂岩家族 11 + 烟熏炉与高炉 7 + 营火 12 + 食物与杂物 7 + 甜浆果与可可豆 2 + 干海带 2 + 蛋糕与花盆 2 + 脚手架 1 + 阳光传感器 1 + 绊线钩 1 + TNT 1 + 可疑的炖菜 5 + 漏斗 1 + 投掷器 1 + 发射器 1 + 木桶 1 + 骨粉 1 + 堆肥桶 1 + 末影箱 1 + 潜影盒 1 + 瓜类种子 2 + 床 16 + 告示牌 6 + 钓竿 1 + 黑石家族 2 + 避雷针 1 + 黑石变体 7 + 展示框与画 17 + 工作站四件 4 + 染料与染色族 49 + 烈焰粉 1 + 末影之眼 1 + 矿物块与信标 7 + 红石元件与补漏 19 + 史莱姆 3 + 岩浆怪 2；明细见上）',
    RECIPES.length,
    502,
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
