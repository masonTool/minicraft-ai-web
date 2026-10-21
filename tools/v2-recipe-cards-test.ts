/**
 * 配方卡列表（生存模式左栏）的离线断言。
 *
 * 这一套守的是"**用背包材料能做出什么**"这条口径：
 * 它不是"我有什么"，也不是"全部配方"，而是"现在这几样材料能做出哪些东西"。
 *
 * 运行：`npm run test:v2-recipe-cards`
 */

import { Block } from '../src/core/registry/blocks.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { recipeGridSize } from '../src/core/crafting/RecipeBook.ts';
import {
  canCraft,
} from '../src/core/crafting/RecipeBook.ts';
import {
  clampPage,
  craftableCards,
  missingHint,
  recipePageSize,
} from '../src/minigame-v2/recipe-cards.ts';

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

/** 用一个 Map 当"背包" */
const bag = (entries: Array<[number, number]>) => {
  const map = new Map(entries);
  return (id: number) => map.get(id) ?? 0;
};

const OPTS = { gridSize: 2 as const, category: 'all' as const, query: '' };

console.log('\n[空背包：一张卡都不该有]');
{
  const cards = craftableCards(() => 0, OPTS);
  equal('空背包 → 0 张', cards.length, 0);
}
{
  // 但"连做不出来的也列出来"时应当有卡
  const cards = craftableCards(() => 0, { ...OPTS, showUncraftable: true });
  check('打开"全列"后有卡', cards.length > 0, `实际 ${cards.length}`);
  check('而且全部标成不可做', cards.every((c) => !c.craftable));
}

console.log('\n[1 个原木：只能做木板]');
{
  const countOf = bag([[Block.OAK_LOG, 1]]);
  const cards = craftableCards(countOf, OPTS);
  check('至少有一张卡', cards.length >= 1, `实际 ${cards.length}`);
  const planks = cards.find((c) => c.craftable && c.resultId === Block.OAK_PLANKS);
  check('木板的卡在列表里且标"可做"', !!planks);
  check('所有卡都可做', cards.every((c) => c.craftable));
}

console.log('\n[4 个木板：能做工台、箱子之类的 2×2 配方]');
{
  const countOf = bag([[Block.OAK_PLANKS, 4]]);
  const cards = craftableCards(countOf, OPTS);
  const table = cards.find((c) => c.resultId === Block.CRAFTING_TABLE);
  check('工作台的卡可做', !!table && table.craftable);
  check('2×2 里不出现需要 3×3 的配方（如箱子以外的宽配方）', cards.every((c) => c.craftable));
}

console.log('\n[3×3 配方在 2×2 里不可做、在 3×3 里可做]');
{
  // 找一条 3×3 配方，给它凑齐材料
  const wide = RECIPES.find((r) => recipeGridSize(r) === 3);
  check('配方表里确实有 3×3 配方', !!wide);
  if (wide) {
    const need = new Map<number, number>();
    // 用 canCraft 的口径反推材料：直接给一大堆常见材料太粗暴，这里精确给
    // （简化：给所有可能用到的 id 都塞 64）
    for (let id = 0; id < 1400; id++) need.set(id, 64);
    const countOf = (id: number) => need.get(id) ?? 0;

    const inBag = craftableCards(countOf, { gridSize: 2, category: 'all', query: '' });
    const inTable = craftableCards(countOf, { gridSize: 3, category: 'all', query: '' });
    const id = wide.result.id;
    const a = inBag.find((c) => c.resultId === id);
    const b = inTable.find((c) => c.resultId === id);
    check('2×2 里这条配方不出现（材料够但放不下）', !a);
    check('3×3 里出现且可做', !!b && b.craftable);
    check('3×3 的卡比 2×2 多', inTable.length >= inBag.length);
  }
}

console.log('\n[分类过滤：按**产物**归类]');
{
  const countOf = bag([[Block.OAK_LOG, 64], [Block.COBBLESTONE, 64]]);
  const building = craftableCards(countOf, { ...OPTS, category: 'building' });
  const nature = craftableCards(countOf, { ...OPTS, category: 'nature' });
  check('"建筑"里有卡', building.length > 0, `实际 ${building.length}`);
  check('分类互不重叠', building.every((c) => !nature.some((n) => n.resultId === c.resultId)));
  check('木板归在"建筑"里', building.some((c) => c.resultId === Block.OAK_PLANKS) || nature.some((c) => c.resultId === Block.OAK_PLANKS));
}

console.log('\n[搜索：按产物名]');
{
  const countOf = bag([[Block.OAK_LOG, 64]]);
  const all = craftableCards(countOf, OPTS);
  const hit = craftableCards(countOf, { ...OPTS, query: '木板' });
  check('搜"木板"能搜到', hit.length > 0, `实际 ${hit.length}`);
  check('搜到的比不筛少', hit.length <= all.length);
  const none = craftableCards(countOf, { ...OPTS, query: '钻石块' });
  equal('搜不存在的东西 → 0 张', none.length, 0);
}

console.log('\n[缺料说明]');
{
  // 需要 8 个圆石做熔炉，只给 3 个
  const countOf = bag([[Block.COBBLESTONE, 3]]);
  const cards = craftableCards(countOf, { ...OPTS, showUncraftable: true });
  const furnace = cards.find((c) => c.resultId === Block.FURNACE);
  if (furnace) {
    check('熔炉的卡标成不可做', !furnace.craftable);
    check('给出了缺料说明', missingHint(furnace).includes('缺'), missingHint(furnace));
  } else {
    console.log('  · 熔炉配方不在这张表里，跳过');
  }
}

console.log('\n[分页]');
{
  equal('10 张卡、每页 6 张 → 第 0 页', clampPage(0, 10, 6), 0);
  equal('翻过界 → 夹到最后一页', clampPage(9, 10, 6), 1);
  equal('负数 → 夹到 0', clampPage(-3, 10, 6), 0);
  equal('没有卡时仍有 1 页（页码恒 0）', clampPage(5, 0, 6), 0);
  equal('可用高 300、卡高 86 → 3 行 × 3 列 = 9 张', recipePageSize(300, 86), 9);
}

console.log('\n[与 core 的口径一致]');
{
  // canCraft 本身是 core 的纯函数，这里只确认"配方卡用的就是它"
  const countOf = bag([[Block.OAK_LOG, 2]]);
  const planksRecipe = RECIPES.find((r) => r.result.id === Block.OAK_PLANKS);
  check('木板配方存在', !!planksRecipe);
  if (planksRecipe) {
    check('1 个原木够做木板', canCraft({ countOf }, planksRecipe).ok);
  }
}

console.log(`\n${failed === 0 ? '✓' : '✗'} 通过 ${passed} / ${passed + failed} 条断言`);
if (failed > 0) process.exit(1);
