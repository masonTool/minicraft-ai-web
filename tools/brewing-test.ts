/**
 * 酿造台与药水离线测试（H10）
 *
 * 覆盖四块：
 *  1. **三档数值表**：普通 / 延长（红石粉）/ 强化（荧石粉）的时长与倍率逐个对照原版，
 *     并钉住"原版没有的档位"（抗火/夜视/虚弱没有 II 级、治疗不能延长）
 *  2. **配方表完整性**：每条配方的材料与产物都是已注册物品、没有重复的 (材料, 原料瓶)、
 *     **24 瓶药水从水瓶出发全部可达**（不然就是"表里有、游戏里酿不出来"）
 *  3. **三条改造链**：延长、强化、腐化（含"改造过的药水不能再改造"这条原版限制）
 *  4. **酿造台容器**：20 秒进度、三槽同时推进、材料与燃料的消耗、条件不满足时归零
 *
 * 另外还测"喝下去效果真的挂上"：把每条药水的效果喂给 `StatusEffects`，
 * 核对时长（tick）与倍率。真正的"按住 1.6 秒才喝"状态机在 `main.ts` 里（依赖 DOM 与输入），
 * 这里测的是它用到的全部纯逻辑。
 *
 * 运行：npm run test:brewing
 */

import { Block } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, itemDef, itemName, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { SPLASH_RADIUS } from '../src/core/survival/SplashPotion.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  BREW_RECIPES,
  BREW_SECONDS,
  BREWS_PER_BLAZE_POWDER,
  brewRecipeFor,
  canBrew,
} from '../src/core/crafting/Brewing.ts';
import {
  BREW_BOTTLE_SLOTS,
  BREW_FUEL_SLOT,
  BREW_INGREDIENT_SLOT,
  BREW_SLOT_COUNT,
  BrewingStand,
} from '../src/core/container/BrewingStand.ts';
import {
  DRINKABLE,
  POTION_IDS,
  POTIONS,
  POTION_VARIANTS,
  SPLASH_ID_OFFSET,
  SPLASH_POTIONS,
  isDrinkable,
  potionById,
  splashIdOf,
  splashOf,
} from '../src/core/registry/potions.ts';
import { recipesForResult } from '../src/core/crafting/RecipeBook.ts';
import { EFFECTS, StatusEffects, type EffectId } from '../src/core/survival/StatusEffects.ts';
import type { ItemStack } from '../src/core/container/Inventory.ts';

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

const TILES = new Set<string>(TILE_ORDER);

// ---------------------------------------------------------------- 1. 三档数值表

console.log('\n[药水三档：时长与倍率对照原版]');

/**
 * 原版酿造表（Java 1.18）：`[时长秒, 倍率]`。
 * `null` / 不写 = **原版也没有这一档**——这一栏是断言的重点：
 * 给抗火加个 II 级、或者给治疗加个延长档，都会在这里露馅。
 */
const VANILLA: Record<
  string,
  {
    readonly effect: EffectId;
    readonly base: readonly [number, number];
    readonly long?: readonly [number, number];
    readonly strong?: readonly [number, number];
    readonly ingredient?: number;
    readonly corruptTo?: string;
  }
> = {
  swiftness: { effect: 'speed', base: [180, 0], long: [480, 0], strong: [90, 1], ingredient: Item.SUGAR, corruptTo: 'slowness' },
  strength: { effect: 'strength', base: [180, 0], long: [480, 0], strong: [90, 1], ingredient: Item.BLAZE_POWDER },
  // 治疗是"瞬间治疗"，原版不能延长（红石粉无效），但能强化
  healing: { effect: 'instant_health', base: [1, 0], strong: [1, 1], ingredient: Item.GLISTERING_MELON },
  regeneration: { effect: 'regeneration', base: [45, 0], long: [90, 0], strong: [22, 1], ingredient: Item.GHAST_TEAR },
  fire_resistance: { effect: 'fire_resistance', base: [180, 0], long: [480, 0], ingredient: Item.MAGMA_CREAM },
  night_vision: { effect: 'night_vision', base: [180, 0], long: [480, 0], ingredient: Item.GOLDEN_CARROT },
  poison: { effect: 'poison', base: [45, 0], long: [90, 0], strong: [21, 1], ingredient: Item.SPIDER_EYE },
  // 缓慢的强化档是 **IV 级**（原版唯一跳级的）：荧石粉给的是缓慢 IV
  slowness: { effect: 'slowness', base: [90, 0], long: [240, 0], strong: [20, 3] },
  weakness: { effect: 'weakness', base: [90, 0], long: [240, 0] },
};

const expectedPotionCount =
  1 + // 粗制
  Object.values(VANILLA).reduce((sum, v) => sum + 1 + (v.long ? 1 : 0) + (v.strong ? 1 : 0), 0);
// 表里是**两半**：饮用型 + 喷溅型（喷溅的 id = 饮用 id + 50，见 `SPLASH_ID_OFFSET`）
equal('饮用型药水条目总数（9 种效果 × 各自有的档位 + 粗制）', DRINKABLE.length, expectedPotionCount);
equal('药水条目总数（饮用 + 喷溅）', POTIONS.length, expectedPotionCount * 2);
equal('喷溅型数量与饮用型一致', SPLASH_POTIONS.length, expectedPotionCount);

for (const [key, vanilla] of Object.entries(VANILLA)) {
  const rows: Array<[string, readonly [number, number] | undefined, string]> = [
    [`${key}`, vanilla.base, 'base'],
    [`${key}_long`, vanilla.long, 'long'],
    [`${key}_strong`, vanilla.strong, 'strong'],
  ];

  for (const [potionKey, expected, tier] of rows) {
    const potion = POTIONS.find((entry) => entry.key === potionKey);
    if (!expected) {
      check(`${potionKey} 原版没有这一档，本项目也不该有`, potion === undefined, potion ? '表里多了一条' : '');
      continue;
    }
    if (!potion) {
      check(`${potionKey} 在药水表里`, false, '缺这条');
      continue;
    }
    equal(`${potionKey} 的档位标记是 ${tier}`, potion.tier, tier);
    equal(`${potionKey} 的变体是 ${key}`, potion.variant, key);
    equal(`${potionKey} 挂 1 条效果`, potion.effects.length, 1);
    equal(`${potionKey} 的效果 id`, potion.effects[0]!.id, vanilla.effect);
    equal(`${potionKey} 的时长（秒）`, potion.effects[0]!.seconds, expected[0]);
    equal(`${potionKey} 的倍率`, potion.effects[0]!.amplifier, expected[1]);
  }
}

// 变体表与药水表必须一一对应（少一条 = 有档位没被展开，多一条 = 展开了不存在的档位）
equal('变体表条数', POTION_VARIANTS.length, Object.keys(VANILLA).length);
for (const variant of POTION_VARIANTS) {
  const vanilla = VANILLA[variant.key];
  check(`变体 ${variant.key} 在原版表里有对照`, vanilla !== undefined);
  check(`变体 ${variant.key} 的基础档 id 与药水表一致`, POTIONS.some((p) => p.id === variant.baseId && p.tier === 'base'));
}

console.log('\n[药水的物品注册]');
for (const potion of POTIONS) {
  const def = itemDef(potion.id);
  check(`${potion.key} 注册进了物品表`, def !== undefined);
  check(`${potion.key} 的图标在图集名单里（${def?.tile}）`, def !== undefined && TILES.has(def.tile));
  check(`${potion.key} 有中文名`, itemLabel(potion.id) !== itemName(potion.id), itemLabel(potion.id));
  check(`${potion.key} 有说明`, hasDescription(potion.id));
  equal(`${potion.key} 不可堆叠（与原版一致，一次一瓶）`, maxStackOf(potion.id), 1);
}
equal('粗制药水的中文名（旧的 10 条名字不能被生成的表改掉）', itemLabel(POTION_IDS.awkward), '粗制药水');
equal('迅捷药水的中文名', itemLabel(POTION_IDS.swiftness), '迅捷药水');
equal('延长档的名字带"延长"', itemLabel(POTION_IDS.swiftness_long), '迅捷药水（延长）');
equal('强化档的名字带级别（力量 II）', itemLabel(POTION_IDS.strength_strong), '力量药水 II');
// 缓慢的强化档是 IV 级（原版跳级），把这条钉死：改口径时最容易在这里顺手写成 III
equal('缓慢的强化档是 IV 级', itemLabel(POTION_IDS.slowness_strong), '缓慢药水 IV');
equal('粗制的说明', itemDescription(POTION_IDS.awkward), '半成品：酿出具体药水之前的中间状态，直接喝没有效果。');
check(
  '说明里的时长与数据表同源（延长档的说明写的是延长后的时长）',
  itemDescription(POTION_IDS.poison_long).includes('1 分 30 秒'),
  itemDescription(POTION_IDS.poison_long),
);
check('粗制药水不可喝（半成品）', !isDrinkable(potionById(POTION_IDS.awkward)));
check('具体药水可喝', isDrinkable(potionById(POTION_IDS.swiftness_long)));

// ---- 喷溅型（K4 尾巴）：id 偏移、配方与"不能喝"

console.log('\n[喷溅型：id 偏移 / 配方 / 只能扔]');

/** 饮用型的 id 集合：喷溅型绝不允许落在这上面 */
const drinkIds = new Set(DRINKABLE.map((potion) => potion.id));

for (const potion of DRINKABLE) {
  const splash = splashOf(potion);
  check(`${potion.key} 有喷溅版（id = 饮用型 + ${SPLASH_ID_OFFSET}）`, splash?.id === splashIdOf(potion.id));
  equal(`${potion.key} + 火药 → 喷溅版`, brewRecipeFor(Item.GUNPOWDER, potion.id)?.to, splashIdOf(potion.id));
  if (!splash) continue;
  check(`${splash.key} 的 id 不与任何饮用型撞车`, !drinkIds.has(splash.id));
  check(`${splash.key} 的名字带"喷溅"`, itemLabel(splash.id).startsWith('喷溅'), itemLabel(splash.id));
  check(
    `${splash.key} 与饮用型挂的效果表完全一致`,
    JSON.stringify(splash.effects) === JSON.stringify(potion.effects),
  );
  check(`${splash.key} 只能扔不能喝`, !isDrinkable(splash));
  // 粗制的喷溅版什么都不做，说明里也就没有"范围"这回事
  if (!splash.base) {
    check(
      `${splash.key} 的说明里写了爆炸半径（与 SPLASH_RADIUS 同源）`,
      itemDescription(splash.id).includes(`${SPLASH_RADIUS} 格`),
      itemDescription(splash.id),
    );
  }
}

for (const potion of SPLASH_POTIONS) {
  if (potion.base) continue;
  check(
    `${potion.key} 不能再改造（红石 / 荧石 / 火药都不行）`,
    brewRecipeFor(Item.REDSTONE_DUST, potion.id) === null &&
      brewRecipeFor(Item.GLOWSTONE_DUST, potion.id) === null &&
      brewRecipeFor(Item.GUNPOWDER, potion.id) === null,
  );
}
check('粗制的喷溅版同样是半成品（不可喝）', !isDrinkable(potionById(splashIdOf(POTION_IDS.awkward))));

// ---------------------------------------------------------------- 2. 配方表完整性

console.log('\n[配方表：完整性]');

const seen = new Set<string>();
for (const recipe of BREW_RECIPES) {
  const tag = `${recipe.ingredient}->${recipe.from}`;
  check(`没有重复的 (材料, 原料瓶)：${tag}`, !seen.has(tag));
  seen.add(tag);
  check(`材料 ${recipe.ingredient} 是已注册物品`, itemDef(recipe.ingredient) !== undefined);
  check(`原料瓶 ${recipe.from} 是已注册物品`, itemDef(recipe.from) !== undefined);
  check(`产物 ${recipe.to} 是已注册物品`, itemDef(recipe.to) !== undefined);
  // 材料必须能在创造物品栏里拿到，否则"表里有配方"等于纸上谈兵
  check(`材料 ${itemName(recipe.ingredient)} 在创造物品栏里`, CREATIVE_ITEMS.includes(recipe.ingredient));
}

/** 从水瓶出发做可达性搜索：只走"煮一次换一瓶"的边 */
function reachablePotions(): Set<number> {
  const reached = new Set<number>();
  const queue: number[] = [Item.WATER_BOTTLE];
  while (queue.length > 0) {
    const bottle = queue.shift()!;
    for (const recipe of BREW_RECIPES) {
      if (recipe.from !== bottle || reached.has(recipe.to)) continue;
      reached.add(recipe.to);
      queue.push(recipe.to);
    }
  }
  return reached;
}

const reached = reachablePotions();
for (const potion of POTIONS) {
  check(`${potion.key} 能从水瓶酿出来`, reached.has(potion.id));
}
check('水瓶本身不用酿（它是起点）', !reached.has(Item.WATER_BOTTLE));
check(
  '玻璃瓶有配方（3 玻璃 → 3 个，否则整条链没有容器）',
  recipesForResult(Item.GLASS_BOTTLE).length > 0,
);
check('世界里存在水方块（装水的对象）', Block.WATER !== undefined);

// ---------------------------------------------------------------- 3. 三条改造链

console.log('\n[改造链：延长 / 强化 / 腐化]');

for (const variant of POTION_VARIANTS) {
  const vanilla = VANILLA[variant.key]!;

  if (vanilla.long) {
    const recipe = brewRecipeFor(Item.REDSTONE_DUST, variant.baseId);
    check(`${variant.key} + 红石粉 → 延长档`, recipe?.to === variant.longId);
  } else {
    check(`${variant.key} 不能延长（红石粉什么都不做）`, brewRecipeFor(Item.REDSTONE_DUST, variant.baseId) === null);
  }

  if (vanilla.strong) {
    const recipe = brewRecipeFor(Item.GLOWSTONE_DUST, variant.baseId);
    check(`${variant.key} + 荧石粉 → 强化档`, recipe?.to === variant.strongId);
  } else {
    check(`${variant.key} 不能强化（荧石粉什么都不做）`, brewRecipeFor(Item.GLOWSTONE_DUST, variant.baseId) === null);
  }

  if (vanilla.ingredient !== undefined) {
    const recipe = brewRecipeFor(vanilla.ingredient, POTION_IDS.awkward);
    check(`粗制 + ${itemName(vanilla.ingredient)} → ${variant.key} 基础档`, recipe?.to === variant.baseId);
  }
}

// 原版限制：红石粉与荧石粉**二选一**——已经改造过的药水不能再改造
for (const variant of POTION_VARIANTS) {
  if (variant.longId === undefined && variant.strongId === undefined) continue;
  const long = variant.longId;
  const strong = variant.strongId;
  if (long !== undefined) {
    check(
      `${variant.key} 的延长档不能再改造（二选一）`,
      brewRecipeFor(Item.REDSTONE_DUST, long) === null && brewRecipeFor(Item.GLOWSTONE_DUST, long) === null,
    );
  }
  if (strong !== undefined) {
    check(
      `${variant.key} 的强化档不能再改造（二选一）`,
      brewRecipeFor(Item.REDSTONE_DUST, strong) === null && brewRecipeFor(Item.GLOWSTONE_DUST, strong) === null,
    );
  }
}

// 腐化：迅捷 → 缓慢（原版）；治疗→伤害、剧毒→伤害、夜视→隐身本项目还没有目标药水，故不登记
equal(
  '迅捷 + 发酵蜘蛛眼 → 缓慢',
  brewRecipeFor(Item.FERMENTED_SPIDER_EYE, POTION_IDS.swiftness)?.to,
  POTION_IDS.slowness,
);
equal(
  '粗制 + 发酵蜘蛛眼 → 虚弱（原版：没有效果的药水被腐化成虚弱）',
  brewRecipeFor(Item.FERMENTED_SPIDER_EYE, POTION_IDS.awkward)?.to,
  POTION_IDS.weakness,
);
equal(
  '水瓶 + 发酵蜘蛛眼 → 虚弱（原版那条最短的路）',
  brewRecipeFor(Item.FERMENTED_SPIDER_EYE, Item.WATER_BOTTLE)?.to,
  POTION_IDS.weakness,
);
for (const key of ['healing', 'poison', 'night_vision'] as const) {
  const variant = POTION_VARIANTS.find((v) => v.key === key)!;
  check(
    `${key} 的腐化目标（伤害/隐身）还没做，因此不登记配方`,
    brewRecipeFor(Item.FERMENTED_SPIDER_EYE, variant.baseId) === null,
  );
}
check(
  '强化档的迅捷不能被腐化（原版 1.9 之后的限制）',
  brewRecipeFor(Item.FERMENTED_SPIDER_EYE, POTION_IDS.swiftness_strong) === null,
);

// ---------------------------------------------------------------- 4. 酿造台容器

console.log('\n[酿造台：20 秒进度与消耗]');

function stack(id: number, count = 1): ItemStack {
  return { id, count };
}

function newStand(): BrewingStand {
  return new BrewingStand();
}

equal('容器是 5 格（3 药水 + 1 材料 + 1 燃料）', BREW_SLOT_COUNT, 5);
equal('三个药水槽是 0/1/2', BREW_BOTTLE_SLOTS.join(','), '0,1,2');
equal('材料槽与燃料槽分开', `${BREW_INGREDIENT_SLOT},${BREW_FUEL_SLOT}`, '3,4');
equal('一次酿造 20 秒', BREW_SECONDS, 20);
equal('一份烈焰粉酿 20 次', BREWS_PER_BLAZE_POWDER, 20);

{
  const stand = newStand();
  stand.set(BREW_BOTTLE_SLOTS[0], stack(Item.WATER_BOTTLE));
  stand.set(BREW_INGREDIENT_SLOT, stack(Item.NETHER_WART, 3));
  stand.set(BREW_FUEL_SLOT, stack(Item.BLAZE_POWDER, 2));

  check('条件齐了就开酿（canBrew）', canBrew(Item.NETHER_WART, [Item.WATER_BOTTLE]));
  check('材料不匹配时不能酿', !canBrew(Item.SUGAR, [Item.WATER_BOTTLE]));

  const first = stand.tick(1);
  check('第 1 个 tick 就吃了一份燃料', first.changed && stand.fuelRemaining === BREWS_PER_BLAZE_POWDER, `fuel=${stand.fuelRemaining}`);
  equal('燃料槽从 2 个减到 1 个', stand.get(BREW_FUEL_SLOT)?.count, 1);
  equal('第 1 秒的进度', stand.brewProgress, 1);
  check('还没到 20 秒，不产出', !first.brewed && stand.get(BREW_BOTTLE_SLOTS[0])?.id === Item.WATER_BOTTLE);

  stand.tick(18.998);
  check('19.998 秒还没好', stand.get(BREW_BOTTLE_SLOTS[0])?.id === Item.WATER_BOTTLE, '提前产出了');

  const done = stand.tick(0.002);
  check('满 20 秒产出一轮', done.brewed);
  equal('药水槽变成粗制药水', stand.get(BREW_BOTTLE_SLOTS[0])?.id, POTION_IDS.awkward);
  equal('材料消耗 1 个（3 → 2）', stand.get(BREW_INGREDIENT_SLOT)?.count, 2);
  equal('进度清零', stand.brewProgress, 0);
  equal('燃料剩 19 次', stand.fuelRemaining, 19);
}

{
  // 三个槽同时推进：放一瓶也是 20 秒，放三瓶一样是 20 秒（原版的特点）
  const stand = newStand();
  for (const slot of BREW_BOTTLE_SLOTS) stand.set(slot, stack(Item.WATER_BOTTLE));
  stand.set(BREW_INGREDIENT_SLOT, stack(Item.NETHER_WART));
  stand.set(BREW_FUEL_SLOT, stack(Item.BLAZE_POWDER));

  stand.tick(20);
  const ids = BREW_BOTTLE_SLOTS.map((slot) => stand.get(slot)?.id);
  check('三瓶同时变成粗制（一轮只花 20 秒）', ids.every((id) => id === POTION_IDS.awkward), ids.join(','));
  equal('一轮只消耗 1 个材料', stand.get(BREW_INGREDIENT_SLOT), null);
  equal('材料没了，下一轮条件不满足', canBrew(undefined, ids), false);
}

{
  // 条件不再满足 → 进度归零（原版不允许"暂停后接着酿"）
  const stand = newStand();
  stand.set(BREW_BOTTLE_SLOTS[0], stack(Item.WATER_BOTTLE));
  stand.set(BREW_INGREDIENT_SLOT, stack(Item.NETHER_WART, 2));
  stand.set(BREW_FUEL_SLOT, stack(Item.BLAZE_POWDER));
  stand.tick(10);
  equal('酿了 10 秒', stand.brewProgress, 10);
  stand.set(BREW_INGREDIENT_SLOT, null);
  stand.tick(1);
  equal('材料被拿走 → 进度归零', stand.brewProgress, 0);
  check('也不再显示正在酿', !stand.brewing);

  stand.set(BREW_INGREDIENT_SLOT, stack(Item.NETHER_WART, 2));
  stand.tick(10);
  equal('材料放回去也只是重新开始', stand.brewProgress, 10);

  for (const slot of BREW_BOTTLE_SLOTS) stand.set(slot, null);
  stand.tick(1);
  equal('药水被拿走 → 进度同样归零', stand.brewProgress, 0);
}

{
  // 没有燃料：什么都不发生（进度不动、材料不消耗）
  const stand = newStand();
  stand.set(BREW_BOTTLE_SLOTS[0], stack(Item.WATER_BOTTLE));
  stand.set(BREW_INGREDIENT_SLOT, stack(Item.NETHER_WART, 2));
  stand.tick(20);
  equal('没燃料 → 进度仍是 0', stand.brewProgress, 0);
  check('没燃料 → 不显示正在酿', !stand.brewing);
  equal('没燃料 → 材料没被扣', stand.get(BREW_INGREDIENT_SLOT)?.count, 2);
  equal('没燃料 → 药水没变', stand.get(BREW_BOTTLE_SLOTS[0])?.id, Item.WATER_BOTTLE);
}

{
  // 燃料槽里放的不是烈焰粉 → 同样不烧（烈焰粉是唯一的燃料）
  const stand = newStand();
  stand.set(BREW_BOTTLE_SLOTS[0], stack(Item.WATER_BOTTLE));
  stand.set(BREW_INGREDIENT_SLOT, stack(Item.NETHER_WART));
  stand.set(BREW_FUEL_SLOT, stack(Item.COAL));
  stand.tick(20);
  equal('煤不是酿造燃料', stand.brewProgress, 0);
  equal('煤没被消耗', stand.get(BREW_FUEL_SLOT)?.count, 1);
}

{
  // 不匹配的配方：水都白放（不消耗、不浪费）
  const stand = newStand();
  stand.set(BREW_BOTTLE_SLOTS[0], stack(Item.WATER_BOTTLE));
  stand.set(BREW_INGREDIENT_SLOT, stack(Item.SUGAR, 2));
  stand.set(BREW_FUEL_SLOT, stack(Item.BLAZE_POWDER));
  stand.tick(20);
  equal('糖配水瓶没有配方 → 进度 0', stand.brewProgress, 0);
  equal('材料没被消耗', stand.get(BREW_INGREDIENT_SLOT)?.count, 2);
  equal('燃料没被消耗', stand.get(BREW_FUEL_SLOT)?.count, 1);
}

{
  // 走完整条改造链：水瓶 → 粗制 → 迅捷 → 迅捷（延长）
  const stand = newStand();
  const run = (ingredient: number, seconds = 20): void => {
    stand.set(BREW_INGREDIENT_SLOT, stack(ingredient, 3));
    stand.set(BREW_FUEL_SLOT, stack(Item.BLAZE_POWDER, 2));
    stand.tick(seconds);
  };

  stand.set(BREW_BOTTLE_SLOTS[0], stack(Item.WATER_BOTTLE));
  run(Item.NETHER_WART);
  equal('第一步：水瓶 → 粗制', stand.get(BREW_BOTTLE_SLOTS[0])?.id, POTION_IDS.awkward);

  run(Item.SUGAR);
  equal('第二步：粗制 + 糖 → 迅捷', stand.get(BREW_BOTTLE_SLOTS[0])?.id, POTION_IDS.swiftness);

  run(Item.REDSTONE_DUST);
  equal('第三步：迅捷 + 红石粉 → 迅捷（延长）', stand.get(BREW_BOTTLE_SLOTS[0])?.id, POTION_IDS.swiftness_long);

  run(Item.GLOWSTONE_DUST);
  equal('第四步：延长档不能再强化（什么都发生不了）', stand.get(BREW_BOTTLE_SLOTS[0])?.id, POTION_IDS.swiftness_long);
  equal('第四步的进度是 0（没有可执行的配方）', stand.brewProgress, 0);

  const ratio = newStand();
  ratio.set(BREW_BOTTLE_SLOTS[0], stack(Item.WATER_BOTTLE));
  ratio.set(BREW_INGREDIENT_SLOT, stack(Item.NETHER_WART));
  ratio.set(BREW_FUEL_SLOT, stack(Item.BLAZE_POWDER));
  ratio.tick(5);
  equal('进度比例 5/20 = 0.25', Math.round(ratio.brewRatio * 100), 25);
}

// ---------------------------------------------------------------- 5. 喝下去

console.log('\n[生效：效果真的挂上（喝下与砸中用的是同一张效果表）]');

for (const potion of POTIONS) {
  if (potion.base) continue;
  const effects = new StatusEffects();
  for (const effect of potion.effects) effects.apply(effect.id, effect.seconds, effect.amplifier);

  const effect = potion.effects[0]!;
  if (effect.id === 'instant_health' || effect.id === 'instant_damage') {
    const instant = effects.takeInstant();
    check(`${potion.key} 是瞬间效果（不进持续列表）`, instant.length === 1 && instant[0]!.amplifier === effect.amplifier);
    continue;
  }
  equal(`${potion.key} 的效果已挂上`, effects.has(effect.id), true);
  equal(`${potion.key} 的时长（tick）`, effects.get(effect.id)?.ticks, Math.round(effect.seconds * 20));
  equal(`${potion.key} 的倍率`, effects.amplifierOf(effect.id), effect.amplifier);
}

{
  // 效果 id 必须是效果系统认识的（拼错会被 tsc 拦住，这里再钉一层运行时）
  check(
    '药水表里的效果 id 都是合法效果',
    POTIONS.every((potion) => potion.effects.every((effect) => (EFFECTS as readonly string[]).includes(effect.id))),
  );
}

console.log(`\n酿造测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
