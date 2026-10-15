/**
 * 物品名称与配方书（数据层）离线测试
 *
 * 覆盖：
 *  1. 中文名：**每个方块都有名字**（`missingBlockNames` 必须为空）、规则生成的 96 条染料系
 *     与矿石/台阶/楼梯抽样、查不到时的英文回退、物品与方块同名
 *  2. 说明：有专门写的（煤是燃料、矿石层级）与兜底的（类别 + 堆叠上限）
 *  3. 配方材料：形状配方按 pattern 数、无序配方按数组数、同类合并
 *  4. 能不能做 / 最多做几次（含"材料分散在多个槽位"的情形）
 *  5. 一键合成：扣材料 + 给产物；材料不足时**一个材料都不扣**
 *  6. 列表排序（能做的排前面）与搜索（中文名 / 英文 id / 材料名）
 *
 * 运行：npm run test:recipebook
 */

import { Block, woolId } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  blockLabel,
  hasDescription,
  itemDescription,
  itemLabel,
  itemTooltip,
  knownNameCount,
  missingBlockNames,
  translateName,
} from '../src/core/registry/itemNames.ts';
import { RECIPES, type Recipe } from '../src/core/crafting/Recipes.ts';
import { recipeLayout, stationLabel, trimPattern } from '../src/core/crafting/RecipeLayout.ts';
import { SMELTING_RECIPES } from '../src/core/crafting/Smelting.ts';
import {
  buildRecipeEntries,
  canCraft,
  craftFromInventory,
  matchesRecipe,
  maxCraftable,
  recipeGridSize,
  recipeIngredients,
  recipesForResult,
} from '../src/core/crafting/RecipeBook.ts';
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

/** 断言两个值相等（摆放位置这一段用得多） */
function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

/** 只实现 countOf 的桩背包 */
function stubInventory(counts: Record<number, number>): { countOf(id: number): number } {
  return { countOf: (id: number) => counts[id] ?? 0 };
}

const craftingTable = RECIPES.find((r) => r.result.id === Block.CRAFTING_TABLE)!;
const chest = RECIPES.find((r) => r.result.id === Block.CHEST)!;

// ---------------------------------------------------------------- 1. 中文名

console.log('\n[物品中文名]');
{
  const missing = missingBlockNames();
  check(`每个方块都有中文名（共 ${knownNameCount()} 条词条）`, missing.length === 0, missing.slice(0, 8).join(', '));

  check('草方块', blockLabel(Block.GRASS_BLOCK) === '草方块', blockLabel(Block.GRASS_BLOCK));
  check('石头', blockLabel(Block.STONE) === '石头');
  check('空气', blockLabel(0) === '空气');
  check('橙色羊毛（规则生成）', translateName('minecraft:orange_wool') === '橙色羊毛', translateName('orange_wool'));
  check('淡蓝色混凝土（规则生成）', translateName('light_blue_concrete') === '淡蓝色混凝土');
  check('淡灰色染色玻璃板（规则生成）', translateName('light_gray_stained_glass_pane') === '淡灰色染色玻璃板');
  check('黄绿色染料（规则生成）', translateName('lime_dye') === '黄绿色染料');
  check('云杉木板（木质规则）', translateName('spruce_planks') === '云杉木板');
  check('深色橡木原木', translateName('dark_oak_log') === '深色橡木原木');
  check('石头台阶', translateName('stone_slab') === '石头台阶', translateName('stone_slab'));
  check('深板岩砖楼梯', translateName('deepslate_bricks_stairs') === '深板岩砖楼梯');
  check('煤矿石', translateName('coal_ore') === '煤矿石');
  check('深层钻石矿石（矿石规则）', translateName('deepslate_diamond_ore') === '深层钻石矿石');
  check('红石元件（单独小表）', translateName('repeater') === '红石中继器' && translateName('sticky_piston') === '黏性活塞');
  check('查不到时回退成英文 id', translateName('some_unknown_block') === 'some_unknown_block');
  check('带命名空间也能查', translateName('minecraft:diamond') === '钻石');
  check('物品名与方块名同源', itemLabel(Block.GRASS_BLOCK) === '草方块' && itemLabel(Item.DIAMOND) === '钻石');
}

// ---------------------------------------------------------------- 2. 说明

console.log('\n[物品说明]');
{
  check('煤的说明提到燃料', itemDescription(Item.COAL).includes('燃料'));
  check('钻石矿石的说明提到挖矿层级', itemDescription(Block.DIAMOND_ORE).includes('铁镐'));
  check('深层铁矿有专门说明', hasDescription(Block.DEEPSLATE_IRON_ORE) && itemDescription(Block.DEEPSLATE_IRON_ORE).includes('深板岩'));
  check('工作台说明提到合成', itemDescription(Block.CRAFTING_TABLE).includes('合成'));
  // 普通建材没有专门说明：说明是空串，信息交给提示框的"类别 / 堆叠"那一行（避免两行重复）
  check('普通建材不写说明，交给类别行兜底', !hasDescription(Block.GRANITE) && itemDescription(Block.GRANITE) === '');

  const tooltip = itemTooltip(Item.COAL, 12);
  check('提示框：标题是中文名', tooltip.title === '煤炭', tooltip.title);
  check('提示框：副标题是英文 id', tooltip.subtitle === 'minecraft:coal', tooltip.subtitle);
  check('提示框：带数量', tooltip.count === 12 && tooltip.maxStack === 64);
  check('提示框：专门写过说明时不再重复显示类别行', tooltip.showMeta === false);

  const plain = itemTooltip(Block.GRANITE);
  check('提示框：没写过说明的只显示类别行，说明为空', plain.showMeta === true && plain.description === '');
}

// ---------------------------------------------------------------- 3. 材料清单

console.log('\n[配方材料]');
{
  const tableIngredients = recipeIngredients(craftingTable);
  check(
    '工作台 = 4 个木板（同类合并成一条）',
    tableIngredients.length === 1 && tableIngredients[0]!.count === 4,
    JSON.stringify(tableIngredients),
  );
  check('工作台是 2×2 配方', recipeGridSize(craftingTable) === 2);
  check('箱子是 3×3 配方', recipeGridSize(chest) === 3);

  const chestIngredients = recipeIngredients(chest);
  check('箱子 = 8 个木板（中间那格是空的，不能算 9）', chestIngredients[0]!.count === 8, JSON.stringify(chestIngredients));

  const shapeless = RECIPES.find((r) => r.kind === 'shapeless')!;
  check(
    '无序配方的材料来自 ingredients 数组',
    recipeIngredients(shapeless).length === 1 && recipeIngredients(shapeless)[0]!.count === 1,
  );

  let badCount = 0;
  for (const recipe of RECIPES) {
    const total = recipeIngredients(recipe).reduce((sum, ingredient) => sum + ingredient.count, 0);
    if (total <= 0) badCount++;
  }
  check('每条配方都至少需要 1 个材料（没有算错的空配方）', badCount === 0, `${badCount} 条异常`);
}

// ---------------------------------------------------------------- 4. 能不能做

console.log('\n[能不能做 / 最多做几次]');
{
  const planks = recipeIngredients(craftingTable)[0]!.id;
  const empty = stubInventory({});
  check('空背包做不了', !canCraft(empty, craftingTable).ok);
  check('空背包缺 4 个木板', canCraft(empty, craftingTable).missing[0]!.need === 4);

  const some = stubInventory({ [planks]: 2 });
  const partial = canCraft(some, craftingTable);
  check('只有 2 个木板 → 缺 2 个（并报出"有 2"）', !partial.ok && partial.missing[0]!.have === 2);

  const enough = stubInventory({ [planks]: 4 });
  check('刚好 4 个 → 能做', canCraft(enough, craftingTable).ok);
  check('刚好 4 个 → 只能做 1 次', maxCraftable(enough, craftingTable) === 1);
  check('9 个木板 → 能做 2 次（余 1 个）', maxCraftable(stubInventory({ [planks]: 9 }), craftingTable) === 2);
  check('材料不足时最多做 0 次', maxCraftable(stubInventory({ [planks]: 3 }), craftingTable) === 0);
}

// ---------------------------------------------------------------- 5. 一键合成

console.log('\n[一键合成]');
{
  const inventory = new Inventory();
  const planks = recipeIngredients(craftingTable)[0]!.id;

  check('材料不足时直接返回 null', craftFromInventory(inventory, craftingTable) === null);

  inventory.add(planks, 9);
  const result = craftFromInventory(inventory, craftingTable);
  check('合成成功返回产物', result !== null && result.id === Block.CRAFTING_TABLE && result.count === 1);
  check('扣掉 4 个木板', inventory.countOf(planks) === 5, String(inventory.countOf(planks)));
  check('得到 1 个工作台', inventory.countOf(Block.CRAFTING_TABLE) === 1);

  // 材料分散在多个槽位：先把木板摊到两个槽里再合
  inventory.clear();
  inventory.add(planks, 2);
  inventory.add(planks, 2);
  check(
    '材料分散在多个槽位时也算够（4 = 2 + 2）',
    canCraft(inventory, craftingTable).ok,
    JSON.stringify(canCraft(inventory, craftingTable).missing),
  );
  check('合成成功且清空两个槽', craftFromInventory(inventory, craftingTable) !== null && inventory.countOf(planks) === 0);

  // 失败时不留下"扣了一半"的脏状态
  const messy = new Inventory();
  const stone = recipeIngredients(RECIPES.find((r) => r.result.id === Block.STONE_BRICKS)!)![0]!.id;
  messy.add(stone, 1); // 石砖要 4 个石头
  const before = messy.countOf(stone);
  check('材料不够时一个都不扣', craftFromInventory(messy, RECIPES.find((r) => r.result.id === Block.STONE_BRICKS)!) === null && messy.countOf(stone) === before);
}

// ---------------------------------------------------------------- 6. 列表与搜索

console.log('\n[配方书列表]');
{
  const inventory = new Inventory();
  const planks = recipeIngredients(craftingTable)[0]!.id;
  inventory.add(planks, 4);

  const entries = buildRecipeEntries(inventory);
  check(`列出全部配方（${RECIPES.length} 条）`, entries.length === RECIPES.length, String(entries.length));
  check('能做的那条排在最前面', entries[0]!.craftable === true && entries[0]!.result.id === Block.CRAFTING_TABLE);
  check('材料是随条目一起给出的（界面不用再算）', entries[0]!.ingredients.length === 1 && entries[0]!.ingredients[0]!.count === 4);
  // 4 个木板除了工作台还能做木棍（2 个木板），所以这里只检查"没材料的配方做不了"
  const stickEntry = entries.find((entry) => entry.result.id === Item.STICK)!;
  check('同一种材料能做出来的配方都标成能做', stickEntry.craftable);
  check(
    '材料不够的配方标成做不了',
    buildRecipeEntries(new Inventory()).every((entry) => !entry.craftable),
  );

  const withMaterials = buildRecipeEntries(new Inventory());
  check('空背包时全部做不了', withMaterials.every((entry) => !entry.craftable && entry.maxCraftable === 0));

  check('按产物反查配方', recipesForResult(Block.CRAFTING_TABLE).length === 1);
  // 羊毛 id 是批量生成的（没有单独的常量），这里用 woolId(1) = 橙色羊毛
  check('染色配方能被反查到（以橙色羊毛为例）', recipesForResult(woolId(1)).length === 1, String(recipesForResult(woolId(1)).length));

  check('搜索：中文产物名', matchesRecipe(craftingTable, '工作台'));
  check('搜索：英文 id', matchesRecipe(craftingTable, 'crafting_table'));
  check('搜索：材料名也能匹配', matchesRecipe(chest, '橡木木板'));
  check('搜索：部分中文也算命中', matchesRecipe(chest, '木板'));
  check('搜索：不匹配时返回 false', !matchesRecipe(craftingTable, '钻石'));
  check('搜索：空串匹配全部', matchesRecipe(craftingTable, '  '));

  // 熔炼表也要能被界面列出来
  check(`熔炼配方可枚举（${SMELTING_RECIPES.length} 条）`, SMELTING_RECIPES.length > 0);
  check('每条熔炼配方都有输入与产物', SMELTING_RECIPES.every((recipe) => recipe.input > 0 && recipe.output.id > 0));

  // 所有配方的产物与材料都必须有中文名（否则界面会出现英文 id）
  const unknown: string[] = [];
  for (const recipe of RECIPES as readonly Recipe[]) {
    if (itemLabel(recipe.result.id).startsWith('未知')) unknown.push(String(recipe.result.id));
    for (const ingredient of recipeIngredients(recipe)) {
      if (labelOfUnknown(ingredient.id)) unknown.push(String(ingredient.id));
    }
  }
  check('配方里出现的物品都能查到中文名', unknown.length === 0, [...new Set(unknown)].slice(0, 6).join(', '));
}

// ---------------------------------------------------------------- 摆放位置（批次 29）

console.log('\n[摆放位置：每条配方都画得出来，而且画得对]');
{
  // ---- 具体几条：手工核对格子
  const torch = RECIPES.find((recipe) => recipe.result.id === Block.TORCH)!;
  const torchLayout = recipeLayout(torch);
  equal('火把是形状配方', torchLayout.kind, 'shaped');
  equal('火把只占 2×2（背包就能做）', torchLayout.grid, 2);
  equal('火把在背包里做', stationLabel(torchLayout.station), '背包 2×2');
  if (torchLayout.kind === 'shaped') {
    equal('火把：第 1 格是煤炭（上面）', torchLayout.cells[0], Item.COAL);
    equal('火把：第 2 格空着', torchLayout.cells[1], null);
    equal('火把：第 3 格是木棍（下面）', torchLayout.cells[2], Item.STICK);
    equal('火把：第 4 格空着', torchLayout.cells[3], null);
    check('火把的说明写了"第 1 行"', torchLayout.text.includes('第 1 行'), torchLayout.text);
    check('火把的说明写了"空"（空格也是配方的一部分）', torchLayout.text.includes('空'), torchLayout.text);
  }

  // 镐子：第 1 行三格材料、中间列两根棍（3×3，要工作台）
  const pick = RECIPES.find(
    (recipe) => recipe.kind === 'shaped' && itemLabel(recipe.result.id).includes('镐'),
  )!;
  const pickLayout = recipeLayout(pick);
  equal('三行图案的配方占 3×3', pickLayout.grid, 3);
  equal('3×3 需要工作台', stationLabel(pickLayout.station), '工作台 3×3');
  if (pickLayout.kind === 'shaped') {
    const filled = pickLayout.cells.filter((id) => id !== null).length;
    equal('3×3 的格子里正好放下 5 个材料', filled, 5);
    // 镐子的形状：上面三格同一种材料、中间那一列竖着两根棍，其余四格空着。
    // 这条断言专门盯"按列摆"这件事——按顺序平铺也能凑够 5 个材料，但位置就错了
    equal('第 1 行三格是同一种材料', pickLayout.cells[0] === pickLayout.cells[1] && pickLayout.cells[1] === pickLayout.cells[2], true);
    equal('第 2 行中间是木棍', pickLayout.cells[4], Item.STICK);
    equal('第 3 行中间也是木棍', pickLayout.cells[7], Item.STICK);
    const holes = [3, 5, 6, 8].map((index) => pickLayout.cells[index]);
    equal('其余四格都是空的', holes.every((id) => id === null), true);
  }

  // 无序配方：不画格子，只说明"摆哪都行"
  const shapeless = RECIPES.find((recipe) => recipe.kind === 'shapeless')!;
  const shapelessLayout = recipeLayout(shapeless);
  equal('无序配方不画网格', shapelessLayout.kind, 'shapeless');
  check('无序配方写明"摆哪一格都行"', shapelessLayout.text.includes('无序'), shapelessLayout.text);
  if (shapelessLayout.kind === 'shapeless') {
    equal('无序配方的材料逐个列出（数量与材料数一致）', shapelessLayout.items.length, shapeless.ingredients.length);
  }

  // ---- 全表不变量：181 条配方逐条过
  let wrongLength = 0;
  let wrongCount = 0;
  let outOfKey = 0;
  let wrongStation = 0;
  let emptyText = 0;
  for (const recipe of RECIPES as readonly Recipe[]) {
    const layout = recipeLayout(recipe);
    if (!layout.text || layout.text.length === 0) emptyText++;
    if (layout.grid === 2 !== (layout.station === 'inventory')) wrongStation++;
    if (layout.kind === 'shapeless') {
      if (layout.items.length !== recipe.ingredients.length) wrongCount++;
      continue;
    }
    // 格子数 = grid²（空格也占位）
    if (layout.cells.length !== layout.grid * layout.grid) wrongLength++;
    // 格子里的东西必须是这条配方真的会用到的东西，且数量与材料表一致
    const used = new Map<number, number>();
    for (const id of layout.cells) {
      if (id === null) continue;
      used.set(id, (used.get(id) ?? 0) + 1);
    }
    const expected = new Map<number, number>();
    for (const ingredient of recipeIngredients(recipe)) {
      expected.set(ingredient.id, (expected.get(ingredient.id) ?? 0) + ingredient.count);
    }
    const same =
      used.size === expected.size && [...expected].every(([id, count]) => used.get(id) === count);
    if (!same) wrongCount++;
    if ([...used.keys()].some((id) => ![...expected.keys()].includes(id))) outOfKey++;
  }
  equal('每条形状配方的格子数都是 grid²', wrongLength, 0);
  equal('每条配方的格子内容与材料表完全一致（不重不漏）', wrongCount, 0);
  equal('格子里的物品都来自这条配方的 key', outOfKey, 0);
  equal('2×2 一定对应"背包"、3×3 一定对应"工作台"', wrongStation, 0);
  equal('每条配方都有摆放说明', emptyText, 0);

  // ---- 裁剪包围盒：与合成匹配器的口径一致（2×2 图案放 3×3 任意角落都能合成）
  equal('整行整列的空白会被裁掉', trimPattern(['   ', ' A ', '   ']).join('|'), 'A');
  equal('保留内部空格', trimPattern(['AB', ' B']).join('|'), 'AB| B');
  equal('全空图案裁成空数组', trimPattern(['  ', '  ']).length, 0);
}

function labelOfUnknown(id: number): boolean {
  const label = itemLabel(id);
  return label.startsWith('未知物品') || /^[a-z_]+$/.test(label);
}

console.log(`\n配方书测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
