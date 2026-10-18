/**
 * 食物与进食离线测试（B9 / B10 / I2 补完）
 *
 * 覆盖五块：
 *  1. 数值表：饥饿点与"恢复饱和度"与原版 wiki 一致（修饰值 → 点数的换算是重点，
 *     这两个数极容易写混，本轮就写错过一次）
 *  2. 注册：每件食物都挂上了数值、有中文名；**物品 id 无重复**（挡住 id 撞车）
 *  3. 可食性判定：饥饿满时普通食物不能吃，金苹果能吃
 *  4. 获取途径：树叶概率掉苹果、西瓜块掉西瓜片、生肉进熔炉出熟肉、金苹果配方
 *  5. 吃下去的效果：`PlayerStats.eat` 的封顶行为
 *
 * 说明：真正的"按住 1.6 秒才咽下去"状态机在 `main.ts` 里（依赖 DOM 与输入），
 * 这里测的是它用到的全部纯函数：`canEat` / `saturationFrom` / 数值表 / 掉落与配方。
 *
 * 运行：npm run test:food
 */

import { Block, Wood } from '../src/core/registry/blocks.ts';
import {
  CREATIVE_ITEMS,
  Item,
  dropFor,
  foodInfoById,
  itemDef,
  rareDropFor,
} from '../src/core/registry/items.ts';
import {
  EAT_SECONDS,
  EAT_SECONDS_FAST,
  FOOD_TABLE,
  canEat,
  eatSecondsFor,
  foodForName,
  saturationFrom,
} from '../src/core/registry/food.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';
import { MAX_FOOD, MAX_HEALTH, MAX_SATURATION, PlayerStats } from '../src/core/survival/PlayerStats.ts';
import { StatusEffects } from '../src/core/survival/StatusEffects.ts';
import { SMELTING_RECIPES, smeltingRecipeFor } from '../src/core/crafting/Smelting.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { recipesForResult } from '../src/core/crafting/RecipeBook.ts';

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

function close(label: string, actual: number, expected: number, epsilon = 1e-9): void {
  check(label, Math.abs(actual - expected) <= epsilon, `实际 ${actual}，期望 ${expected}`);
}

// ---------------------------------------------------------------- 1. 数值表

console.log('\n[食物数值表：与原版对齐]');
/** 原版 wiki 上的"饥饿点 / 恢复饱和度"（后者就是 `saturationFrom` 应该算出来的数） */
const VANILLA: Record<string, readonly [number, number]> = {
  apple: [4, 2.4],
  golden_apple: [4, 9.6],
  melon_slice: [2, 1.2],
  beef: [3, 1.8],
  porkchop: [3, 1.8],
  mutton: [2, 1.2],
  chicken: [2, 1.2],
  rotten_flesh: [4, 0.8],
  cooked_beef: [8, 12.8],
  cooked_porkchop: [8, 12.8],
  cooked_mutton: [6, 9.6],
  cooked_chicken: [6, 7.2],
  // 面包（3 小麦，原版 5 点饥饿 / 6 点饱和度）
  bread: [5, 6],
  // 胡萝卜 / 马铃薯 / 烤马铃薯（原版数值：生马铃薯只有 1 点，烤过 5 点）
  carrot: [3, 3.6],
  potato: [1, 1.2],
  baked_potato: [5, 6],
  // 牛奶：不回饥饿也不回饱和度，只清效果（J8）——它是"饮品"，不是食物
  milk_bucket: [0, 0],
  // ---- 批次 48 补齐（B17）
  golden_carrot: [6, 14.4],
  mushroom_stew: [6, 7.2],
  beetroot_soup: [6, 7.2],
  pumpkin_pie: [8, 4.8],
  beetroot: [1, 1.2],
  // ---- 批次 49
  sweet_berries: [2, 0.4],
  cookie: [2, 0.4],
  // ---- 批次 50（海带）：1 点饥饿 / 0.6 点饱和度（原版；单吃很亏，压成块当燃料才是它的用处）
  dried_kelp: [1, 0.6],
  // ---- 批次 57（可疑的炖菜）：与蘑菇煲同一档，6 点饥饿 / 7.2 点饱和度；
  // 差别只在"带哪个状态效果"（那张表在 `stew-test` 里逐个对照）
  suspicious_stew_dandelion: [6, 7.2],
  suspicious_stew_poppy: [6, 7.2],
  suspicious_stew_blue_orchid: [6, 7.2],
  suspicious_stew_oxeye_daisy: [6, 7.2],
  suspicious_stew_cornflower: [6, 7.2],
  // ---- 批次 81（钓鱼，G11）：四种生鱼 + 两种熟鱼。
  // 熟鱼的数值翻得比生鱼多一档（原版：鳕鱼 2→5、鲑鱼 2→6），
  // "钓上来先烤再吃"因此是划算的——这条关系在 fishing-test 里另有断言
  cod: [2, 0.4],
  salmon: [2, 0.4],
  tropical_fish: [1, 0.2],
  pufferfish: [1, 0.2],
  cooked_cod: [5, 6],
  cooked_salmon: [6, 9.6],
};

equal('食物种类数', Object.keys(FOOD_TABLE).length, Object.keys(VANILLA).length);
for (const [key, [hunger, saturation]] of Object.entries(VANILLA)) {
  const food = FOOD_TABLE[key];
  check(`数值表里有 ${key}`, food !== undefined);
  if (!food) continue;
  equal(`${key} 的饥饿点`, food.hunger, hunger);
  close(`${key} 的恢复饱和度`, saturationFrom(food), saturation, 1e-9);
}
// 这一条是本轮写错过的那个坑：wiki 写"恢复 2.4 点饱和度"，但代码里要填 0.3
check(
  '修饰值都在 0~1.2 之间（写错成"饱和度点数"会在这里露馅：苹果应是 0.3 而不是 2.4）',
  Object.values(FOOD_TABLE).every((food) => food.saturationModifier >= 0 && food.saturationModifier <= 1.2),
);
// 只有牛奶是 0/0：它靠"清效果"而不是靠回饥饿（J8）
equal('牛奶的饥饿点是 0', FOOD_TABLE.milk_bucket!.hunger, 0);
equal('牛奶的饱和度修饰值也是 0', FOOD_TABLE.milk_bucket!.saturationModifier, 0);
check('牛奶是"饥饿满也能喝"的（原版行为）', FOOD_TABLE.milk_bucket!.alwaysEdible === true);
check('牛奶会清除所有状态效果', FOOD_TABLE.milk_bucket!.clearsEffects === true);
equal('进食耗时与原版一致（1.6 秒）', EAT_SECONDS, 1.6);
// 快速档（批次 219）：默认开，1.0 秒。两个数都钉住——改任何一个都会在这里露馅
equal('快速进食档是 1.0 秒', EAT_SECONDS_FAST, 1.0);
equal('关掉快速进食 → 原版 1.6 秒', eatSecondsFor(false), EAT_SECONDS);
equal('打开快速进食 → 1.0 秒', eatSecondsFor(true), EAT_SECONDS_FAST);
check(
  '快速档确实更快，但没快到"秒吃"（0.8~1.6 秒之间）',
  EAT_SECONDS_FAST < EAT_SECONDS && EAT_SECONDS_FAST >= 0.8,
  `实际 ${EAT_SECONDS_FAST}`,
);
check('熟肉比同种生肉更顶饱', FOOD_TABLE.cooked_beef!.hunger > FOOD_TABLE.beef!.hunger);
equal('腐肉的饱和度修饰值最低（原版 0.1）', FOOD_TABLE.rotten_flesh!.saturationModifier, 0.1);

console.log('\n[牛奶：清除所有状态效果]');
{
  const effects = new StatusEffects();
  effects.apply('poison', 10);
  effects.apply('speed', 10);
  equal('先挂上两个效果', effects.count, 2);
  effects.clear();
  equal('clear() 之后一个都不剩', effects.count, 0);
  equal('清空后再查特定效果也是没有', effects.has('poison'), false);
}

console.log('\n[附加效果]');
equal('腐肉：80% 概率饥饿', FOOD_TABLE.rotten_flesh!.effects?.[0]?.chance, 0.8);
equal('腐肉：饥饿 30 秒', FOOD_TABLE.rotten_flesh!.effects?.[0]?.seconds, 30);
equal('生鸡肉：30% 概率饥饿', FOOD_TABLE.chicken!.effects?.[0]?.chance, 0.3);
check(
  '金苹果：伤害吸收 + 生命恢复 II',
  FOOD_TABLE.golden_apple!.effects?.length === 2 &&
    FOOD_TABLE.golden_apple!.effects[0]!.id === 'absorption' &&
    FOOD_TABLE.golden_apple!.effects[1]!.id === 'regeneration' &&
    FOOD_TABLE.golden_apple!.effects[1]!.amplifier === 1,
);
check('金苹果饥饿满时也能吃', FOOD_TABLE.golden_apple!.alwaysEdible === true);
check(
  '熟肉没有副作用',
  ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken'].every(
    (key) => FOOD_TABLE[key]!.effects === undefined,
  ),
);

// ---------------------------------------------------------------- 2. 注册

console.log('\n[食物都挂上了数值]');
{
  const foodItems = [
    Item.BEEF,
    Item.PORKCHOP,
    Item.MUTTON,
    Item.CHICKEN,
    Item.ROTTEN_FLESH,
    Item.COOKED_BEEF,
    Item.COOKED_PORKCHOP,
    Item.COOKED_MUTTON,
    Item.COOKED_CHICKEN,
    Item.APPLE,
    Item.MELON_SLICE,
    Item.GOLDEN_APPLE,
  ];
  equal('12 件食物', foodItems.filter((id) => foodInfoById(id) !== undefined).length, 12);
  check('非食物没有数值（钻石不能吃）', foodInfoById(Item.DIAMOND) === undefined && foodInfoById(Block.STONE) === undefined);
  equal('牛排的中文名', itemLabel(Item.COOKED_BEEF), '牛排');
  equal('西瓜片的中文名', itemLabel(Item.MELON_SLICE), '西瓜片');
  equal('金苹果的中文名', itemLabel(Item.GOLDEN_APPLE), '金苹果');
  check(
    '食物在创造物品栏里有独立分类',
    CREATIVE_ITEMS.includes(Item.APPLE) && CREATIVE_ITEMS.includes(Item.COOKED_BEEF),
  );
  check('食物的堆叠上限是 64', foodItems.every((id) => itemDef(id)?.maxStack === 64));
}

// ---------------------------------------------------------------- 3. 可食性

console.log('\n[可食性判定]');
check('饿的时候能吃', canEat(FOOD_TABLE.apple!, 10, MAX_FOOD));
check('饥饿满时普通食物不能吃', !canEat(FOOD_TABLE.apple!, MAX_FOOD, MAX_FOOD));
check('饥饿满时金苹果仍能吃', canEat(FOOD_TABLE.golden_apple!, MAX_FOOD, MAX_FOOD));

// ---------------------------------------------------------------- 4. 获取途径

console.log('\n[获取途径]');
{
  equal('西瓜块掉西瓜片', dropFor(Block.MELON)?.id, Item.MELON_SLICE);
  equal('西瓜块掉 5 片（原版 3~7，取中值）', dropFor(Block.MELON)?.count, 5);
  check('石头没有常规掉落，也不会概率掉苹果', dropFor(Block.STONE)?.id !== Item.APPLE && rareDropFor(Block.STONE, 0) === null);
  equal('树叶掷点 0 掉苹果（原版 0.5%）', rareDropFor(Block.OAK_LEAVES, 0)?.id, Item.APPLE);
  equal('树叶掷点 0.0049 仍然掉', rareDropFor(Block.OAK_LEAVES, 0.0049)?.id, Item.APPLE);
  // ⚠️ 批次 75 起这张表是**累计区间**（苹果 0~0.5%、树苗 0.5%~5.5%）：
  // 掷到 0.005 正好跨过苹果那一段，落到**树苗**那一段（不再是"什么都不掉"）
  equal('掷点 0.005 跨过苹果那一段 → 轮到树苗', rareDropFor(Block.OAK_LEAVES, 0.005)?.id, Block.OAK_SAPLING);
  equal('掷点 0.055 及以上 → 什么都不掉（左闭右开）', rareDropFor(Block.OAK_LEAVES, 0.055), null);
  check(
    '6 种追加木材的树叶也能掉苹果',
    Object.values(Wood).every((ids) => rareDropFor(ids.leaves, 0)?.id === Item.APPLE),
  );
  check('树叶本身仍然不掉方块（原版不掉树叶）', dropFor(Block.OAK_LEAVES) === null);

  const meatRecipes = SMELTING_RECIPES.filter(
    (recipe) => recipe.output.id >= Item.COOKED_BEEF && recipe.output.id <= Item.COOKED_CHICKEN,
  );
  equal('4 条生肉 → 熟肉', meatRecipes.length, 4);
  equal('生牛肉烧成牛排', smeltingRecipeFor(Item.BEEF)?.output.id, Item.COOKED_BEEF);
  equal('生鸡肉烧成熟鸡肉', smeltingRecipeFor(Item.CHICKEN)?.output.id, Item.COOKED_CHICKEN);
  check('生肉能烧、熟肉不能反复烧', smeltingRecipeFor(Item.COOKED_BEEF) === undefined);

  const grid = (rows: readonly string[], legend: Record<string, number>): number[] => {
    const cells = new Array<number>(9).fill(0);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r]!.length; c++) {
        const ch = rows[r]![c]!;
        if (ch === '·') continue;
        cells[r * 3 + c] = legend[ch] ?? 0;
      }
    }
    return cells;
  };
  equal(
    '8 金锭围 1 苹果 → 金苹果',
    matchRecipe(grid(['GGG', 'GAG', 'GGG'], { G: Item.GOLD_INGOT, A: Item.APPLE }), 3)?.id,
    Item.GOLDEN_APPLE,
  );
  check('金苹果能被配方书查到', recipesForResult(Item.GOLDEN_APPLE).length > 0);
}

// ---------------------------------------------------------------- 5. 吃下去

console.log('\n[吃下去的效果]');
{
  const stats = new PlayerStats();
  stats.food = 0;
  stats.saturation = 0;
  stats.eat(FOOD_TABLE.cooked_beef!.hunger, saturationFrom(FOOD_TABLE.cooked_beef!));
  equal('吃一块牛排，饥饿 +8', stats.food, 8);
  equal('饱和度按原版封顶（本项目 MAX_SATURATION）', stats.saturation, MAX_SATURATION);
  equal('进食不影响血量', stats.health, MAX_HEALTH);

  const full = new PlayerStats();
  full.food = MAX_FOOD;
  full.eat(FOOD_TABLE.apple!.hunger, saturationFrom(FOOD_TABLE.apple!));
  equal('饥饿满时吃苹果不会溢出', full.food, MAX_FOOD);

  // 一口吃不掉一整格：靠物品数量，纯数值这里只验"多次吃能累加"
  const hungry = new PlayerStats();
  hungry.food = 0;
  hungry.eat(2, 0);
  hungry.eat(2, 0);
  equal('吃两次西瓜片累计 +4', hungry.food, 4);
}

console.log('\n[批次 48 补齐的食物：数值与原版对齐]');
{
  // 原版 1.18 的 (hunger, saturationModifier)
  const expect: readonly (readonly [string, number, number])[] = [
    ['golden_carrot', 6, 1.2],
    ['mushroom_stew', 6, 0.6],
    ['beetroot_soup', 6, 0.6],
    ['pumpkin_pie', 8, 0.3],
    ['beetroot', 1, 0.6],
  ];
  for (const [name, hunger, modifier] of expect) {
    const food = foodForName(name);
    equal(`${name} 的饥饿点`, food?.hunger, hunger);
    equal(`${name} 的饱和度修饰值`, food?.saturationModifier, modifier);
    // 实际补的饱和度 = hunger × modifier × 2（原版 FoodData#eat）
    if (food) {
      equal(
        `${name} 实际补 ${hunger * modifier * 2} 点饱和度`,
        saturationFrom(food),
        hunger * modifier * 2,
      );
    }
  }

  check('蘑菇煲比生蘑菇顶饱得多（这是"做成汤"的意义）', foodForName('mushroom_stew')!.hunger > foodForName('beetroot')!.hunger);
  check('甜菜汤比生甜菜根顶饱得多', foodForName('beetroot_soup')!.hunger > foodForName('beetroot')!.hunger);
  check('金胡萝卜是"饥饿满也能吃"的功能性食物', foodForName('golden_carrot')!.alwaysEdible === true);
  check('汤与派都不是 alwaysEdible（普通食物）', foodForName('mushroom_stew')!.alwaysEdible !== true && foodForName('pumpkin_pie')!.alwaysEdible !== true);

  // 每一样都要能在"饥饿没满"时吃下去
  check(
    '五样新食物都吃得了',
    expect.every(([name]) => canEat(foodForName(name)!, 10, 20)),
  );
  // 可疑的炖菜**故意没做**：原版是"同一样物品、效果看用了哪朵花"（靠物品 NBT），
  // 我们的 ItemStack 只有 damage/附魔/名字，做不了"一个 id 多种效果"
  equal('可疑的炖菜没有登记（要等物品 NBT，见 food.ts 的差异说明）', foodForName('suspicious_stew'), undefined);
}

console.log(`\n食物测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
