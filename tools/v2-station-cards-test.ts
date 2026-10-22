/**
 * 熔炉左栏"可做列表"的离线断言。
 *
 * 守的是三条：
 *  1. **站台过滤**：烟熏炉只列食物、高炉只列矿物（写错了烟熏炉会开始烤铁矿）；
 *  2. **燃料判定**：炉子里在烧 / 燃料槽有货 / 背包里有煤，三者任一就算"能烧"；
 *  3. **按产物去重**：同一产物不会在列表里出现两次。
 *
 * 运行：`npm run test:v2-station-cards`
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import { SMELTING_RECIPES, fuelSeconds } from '../src/core/crafting/Smelting.ts';
import {
  clampStationPage,
  hasFuelAvailable,
  rejectReasonText,
  stationAccepts,
  stationCardHint,
  stationCards,
  stationPageSize,
} from '../src/minigame-v2/station-cards.ts';

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

/** 造一个"背包里有什么"的查询函数 */
const bagOf = (items: Record<number, number>) => (id: number): number => items[id] ?? 0;

/** 全部熔炼配方里有几类（food / metal / none） */
const kindsPresent = new Set(SMELTING_RECIPES.map((r) => r.kind ?? 'none'));

// ================================================================ 1. 站台过滤

console.log('\n[1] 站台过滤：烟熏炉只吃食物、高炉只烧矿物');

check('普通熔炉吃食物', stationAccepts('furnace', 'food'));
check('普通熔炉吃矿物', stationAccepts('furnace', 'metal'));
check('普通熔炉吃普通烧炼（黏土→陶瓦那类）', stationAccepts('furnace', 'none'));

check('烟熏炉吃食物', stationAccepts('smoker', 'food'));
check('烟熏炉**不吃**矿物（否则会开始烤铁矿）', !stationAccepts('smoker', 'metal'), '烟熏炉把 metal 也吃了');
check('烟熏炉不吃普通烧炼', !stationAccepts('smoker', 'none'));

check('高炉吃矿物', stationAccepts('blast_furnace', 'metal'));
check('高炉**不吃**食物', !stationAccepts('blast_furnace', 'food'), '高炉把 food 也吃了');
check('高炉不吃普通烧炼', !stationAccepts('blast_furnace', 'none'));

check('kind 为 undefined 时按 none 处理', stationAccepts('furnace', undefined));

// 三条站台的"接受集合"必须互不相同（否则界面列出来的东西一样）
{
  const sets = (['furnace', 'smoker', 'blast_furnace'] as const).map((s) =>
    ['food', 'metal', 'none'].filter((k) => stationAccepts(s, k)).join(','),
  );
  check('三种站台的接受集合互不相同', new Set(sets).size === 3, sets.join(' | '));
}

// ================================================================ 2. 燃料判定

console.log('\n[2] 燃料判定：三种来源任一就算有');

check('还在烧（burnTimeLeft > 0）→ 有燃料', hasFuelAvailable(5, 0, []));
check('燃料槽里有煤 → 有燃料', hasFuelAvailable(0, Item.COAL, []));
check('背包里有煤 → 有燃料', hasFuelAvailable(0, 0, [Item.COAL]));
check(
  '三样都没有 → 没燃料',
  !hasFuelAvailable(0, 0, [Block.STONE, Block.DIRT]),
  '把石头当成燃料了',
);
check('燃料槽里放着不可燃物 → 不算（要看背包）', !hasFuelAvailable(0, Block.STONE, []));

{
  // 煤确实可燃（自检：别把常量搞错了）
  check('COAL 可燃（fuelSeconds > 0）', fuelSeconds(Item.COAL) > 0, String(fuelSeconds(Item.COAL)));
  check('原木可燃（真的能当燃料）', fuelSeconds(Block.OAK_LOG) > 0, String(fuelSeconds(Block.OAK_LOG)));
  check('石头不可燃', fuelSeconds(Block.STONE) === 0, String(fuelSeconds(Block.STONE)));
}

// ================================================================ 3. 列表内容

console.log('\n[3] 列表内容：按站台过滤 + 按产物去重');

/** 一条 food 类配方的输入 id */
const foodRecipe = SMELTING_RECIPES.find((r) => (r.kind ?? 'none') === 'food');
/** 一条 metal 类配方的输入 id */
const metalRecipe = SMELTING_RECIPES.find((r) => (r.kind ?? 'none') === 'metal');

check('配方表里有 food 类', !!foodRecipe);
check('配方表里有 metal 类', !!metalRecipe);

if (foodRecipe && metalRecipe) {
  const both = bagOf({ [foodRecipe.input]: 1, [metalRecipe.input]: 1 });

  const furnaceCards = stationCards('furnace', both, true);
  const hasFood = furnaceCards.some((c) => c.resultId === foodRecipe.output.id);
  const hasMetal = furnaceCards.some((c) => c.resultId === metalRecipe.output.id);
  check('普通熔炉同时列出食物与矿物', hasFood && hasMetal, `food=${hasFood} metal=${hasMetal}`);

  const smokerCards = stationCards('smoker', both, true);
  check(
    '烟熏炉只列食物产物的配方',
    smokerCards.some((c) => c.resultId === foodRecipe.output.id),
  );
  check(
    '烟熏炉**不列**矿物',
    !smokerCards.some((c) => c.resultId === metalRecipe.output.id),
    '烟熏炉里出现了矿物配方',
  );

  const blastCards = stationCards('blast_furnace', both, true);
  check(
    '高炉只列矿物',
    blastCards.some((c) => c.resultId === metalRecipe.output.id),
  );
  check(
    '高炉**不列**食物',
    !blastCards.some((c) => c.resultId === foodRecipe.output.id),
    '高炉里出现了食物配方',
  );

  // 去重：同一产物只出现一次
  const ids = furnaceCards.map((c) => c.resultId);
  check('列表里没有重复产物', new Set(ids).size === ids.length, `共 ${ids.length} 条，去重后 ${new Set(ids).size}`);
}

// ================================================================ 4. 缺什么

console.log('\n[4] 缺什么：白底 / 缺原料 / 缺燃料');

if (foodRecipe) {
  const haveInput = bagOf({ [foodRecipe.input]: 1 });

  const noFuel = stationCards('furnace', haveInput, false);
  const target = noFuel.find((c) => c.resultId === foodRecipe.output.id);
  check('有原料没燃料 → 那一条不可用', !!target && target.available === false);
  check('缺的原因是燃料', !!target && target.missing === 'fuel', target?.missing ?? 'null');
  check('底部小字是"缺燃料"', !!target && stationCardHint(target) === '缺燃料', target ? stationCardHint(target) : '');

  const withFuel = stationCards('furnace', haveInput, true);
  const ok = withFuel.find((c) => c.resultId === foodRecipe.output.id);
  check('有原料有燃料 → 可用', !!ok && ok.available === true);
  check('可用时没有缺料小字', !!ok && stationCardHint(ok) === '');

  const noInput = stationCards('furnace', bagOf({}), true);
  const empty = noInput.find((c) => c.resultId === foodRecipe.output.id);
  check('没原料 → 不可用', !!empty && empty.available === false);
  check('缺的原因是原料', !!empty && empty.missing === 'input', empty?.missing ?? 'null');
  check('底部小字是"缺原料"', !!empty && stationCardHint(empty) === '缺原料');
}

// 卡片里的 inputId 必须是这条配方真正的原料（不是随便填的）
if (foodRecipe) {
  const cards = stationCards('furnace', bagOf({ [foodRecipe.input]: 1 }), true);
  const card = cards.find((c) => c.resultId === foodRecipe.output.id);
  check('卡片的 inputId 是配方原料', !!card && card.inputId === foodRecipe.input, String(card?.inputId));
  check('卡片的 resultCount 是产物数量', !!card && card.resultCount === foodRecipe.output.count);
}

// ================================================================ 5. 站台拒绝提示

console.log('\n[5] 站台拒绝提示：说清"该换哪种炉子"');

if (metalRecipe) {
  const text = rejectReasonText('smoker', metalRecipe.input);
  check('烟熏炉塞矿物 → 给提示', text.length > 0);
  check('提示里点名"烟熏炉"', text.includes('烟熏炉'), text);
  check('提示里让他换熔炉', text.includes('熔炉'), text);
  check('提示里说的是矿物', text.includes('矿物'), text);
}

if (foodRecipe) {
  const text = rejectReasonText('blast_furnace', foodRecipe.input);
  check('高炉塞食物 → 给提示', text.length > 0);
  check('提示里点名"高炉"', text.includes('高炉'), text);
  check('提示里说的是食物', text.includes('食物'), text);
}

if (metalRecipe) {
  check('普通熔炉塞矿物 → 不拒绝（它是万能的）', rejectReasonText('furnace', metalRecipe.input) === '');
}
check('空手 → 不提示', rejectReasonText('smoker', 0) === '');
check(
  '完全不能烧的东西 → 说"不能烧"',
  rejectReasonText('furnace', Block.DIRT).includes('不能烧'),
  rejectReasonText('furnace', Block.DIRT),
);

// ================================================================ 6. 分页

console.log('\n[6] 分页：3 列 + 按高度算行数');

equal('高度够 3 行、卡高 40 → 9 张/页', stationPageSize(120, 40), 9);
equal('高度只够 1 行 → 3 张/页', stationPageSize(40, 40), 3);
equal('高度不够一行 → 至少 3 张（不能除出 0）', stationPageSize(10, 40), 3);
equal('卡高 0 → 兜底 1（不除零）', stationPageSize(100, 0), 1);

equal('页码越界（太大）→ 夹到最后一页', clampStationPage(99, 30, 9), 3);
equal('页码越界（负数）→ 夹到 0', clampStationPage(-5, 30, 9), 0);
equal('空列表 → 第 0 页', clampStationPage(3, 0, 9), 0);
equal('刚好一整页 → 第 0 页', clampStationPage(0, 9, 9), 0);
equal('多一张 → 有第 1 页', clampStationPage(1, 10, 9), 1);

// ================================================================ 7. 自检

console.log('\n[7] 自检：配方表与常量');

check('熔炼配方表非空', SMELTING_RECIPES.length > 0, String(SMELTING_RECIPES.length));
check('food / metal 两类都真的存在', kindsPresent.has('food') && kindsPresent.has('metal'), [...kindsPresent].join(','));
check(
  '每条熔炼配方都有 input 与 output',
  SMELTING_RECIPES.every((r) => r.input > 0 && r.output.id > 0),
);
check(
  '列表条数不会超过配方表条数（去重只会变少）',
  (() => {
    const all = stationCards(
      'furnace',
      () => 999, // 每种材料都管够
      true,
    );
    return all.length <= SMELTING_RECIPES.length;
  })(),
);

// ================================================================ 收尾

console.log(`\n${failed === 0 ? '✓' : '✗'} 熔炉可做列表：${passed} 条通过，${failed} 条失败`);
if (failed > 0) process.exit(1);
