/**
 * 可疑的炖菜（批次 57，B17 收口）离线测试
 *
 * 原版是**一个物品 + NBT**："用了哪朵花"记在 NBT 里，效果也就跟着那朵花走。
 * 本项目还没有物品 NBT，所以按花分成 **5 个 id**——于是这一批要盯的就是
 * "**花 ↔ 效果 ↔ 配方**三条链各自对得上"：
 *
 *  1. 蒲公英 / 兰花 → 饱和；虞美人 → 夜视；雏菊 → 生命恢复；矢车菊 → 跳跃提升
 *  2. 数值与蘑菇煲同一档：6 饥饿 / 0.6 饱和度修饰值（= 7.2 点饱和度）
 *  3. 配方是**无序**的：碗 + 红蘑菇 + 棕蘑菇 + 那朵花
 *
 * 顺带补上两条一直缺着的"汤类规矩"（原版有、我们之前没有）：
 *  - **喝完退回空碗**（碗是容器，喝完了碗还在）
 *  - **三种汤都不可堆叠**（原版 max stack = 1）
 *
 * 运行：npm run test:stew
 */

import {
  Item,
  categoryOf,
  itemDef,
  type ItemDef,
} from '../src/core/registry/items.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { FOOD_TABLE, foodForName, saturationFrom } from '../src/core/registry/food.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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

/** 五碗：物品 id ↔ 注册名后缀 ↔ 那朵花 ↔ 该有的效果 */
const STEWS: readonly {
  item: number;
  key: string;
  label: string;
  flower: number;
  effect: string;
  seconds: number;
}[] = [
  { item: Item.SUSPICIOUS_STEW_DANDELION, key: 'suspicious_stew_dandelion', label: '可疑的炖菜（蒲公英）', flower: Block.DANDELION, effect: 'saturation', seconds: 0.35 },
  { item: Item.SUSPICIOUS_STEW_POPPY, key: 'suspicious_stew_poppy', label: '可疑的炖菜（虞美人）', flower: Block.POPPY, effect: 'night_vision', seconds: 5 },
  { item: Item.SUSPICIOUS_STEW_BLUE_ORCHID, key: 'suspicious_stew_blue_orchid', label: '可疑的炖菜（兰花）', flower: Block.BLUE_ORCHID, effect: 'saturation', seconds: 0.35 },
  { item: Item.SUSPICIOUS_STEW_OXEYE_DAISY, key: 'suspicious_stew_oxeye_daisy', label: '可疑的炖菜（雏菊）', flower: Block.OXEYE_DAISY, effect: 'regeneration', seconds: 8 },
  { item: Item.SUSPICIOUS_STEW_CORNFLOWER, key: 'suspicious_stew_cornflower', label: '可疑的炖菜（矢车菊）', flower: Block.CORNFLOWER, effect: 'jump_boost', seconds: 6 },
];

// ---------------------------------------------------------------- 1. 注册

console.log('\n[注册：五碗]');
{
  equal('五碗的 id 连续', STEWS.every((stew, i) => stew.item === STEWS[0]!.item + i), true);
  equal('第一碗接在干海带后面（1430 → 1431）', STEWS[0]!.item, 1431);

  const badName: string[] = [];
  const badLabel: string[] = [];
  const badTile: string[] = [];
  const badDesc: string[] = [];
  for (const stew of STEWS) {
    const def: ItemDef | undefined = itemDef(stew.item);
    if (!def || def.name !== `minicraft:${stew.key}`) badName.push(stew.key);
    if (itemLabel(stew.item) !== stew.label) badLabel.push(`${stew.key}→${itemLabel(stew.item)}`);
    if (!def || !TILES.has(def.tile)) badTile.push(stew.key);
    if (!hasDescription(stew.item)) badDesc.push(stew.key);
  }
  check('五个注册名都对（后缀是花名）', badName.length === 0, badName.join(' '));
  check('五个中文名都带花名（原版分不出是哪一碗，这里能分）', badLabel.length === 0, badLabel.join(' '));
  check('五个图标都在图集名单里（汤色按花来）', badTile.length === 0, badTile.join(' '));
  check('五碗都写了说明', badDesc.length === 0, badDesc.join(' '));
  check('五碗都归"食物"页', STEWS.every((s) => categoryOf(s.item) === 'food'));
  check('五碗都不可堆叠（原版 max stack = 1）', STEWS.every((s) => itemDef(s.item)?.maxStack === 1));
}

// ---------------------------------------------------------------- 2. 数值与效果

console.log('\n[数值与效果：花 ↔ 效果对得上]');
{
  const badFood: string[] = [];
  const badEffect: string[] = [];
  for (const stew of STEWS) {
    const food = foodForName(stew.key);
    if (!food || food.hunger !== 6 || food.saturationModifier !== 0.6) {
      badFood.push(stew.key);
      continue;
    }
    const effects = food.effects ?? [];
    const hit = effects.find((e) => e.id === stew.effect);
    if (effects.length !== 1 || !hit || hit.seconds !== stew.seconds || hit.amplifier !== 0) {
      badEffect.push(`${stew.key}: ${effects.map((e) => e.id).join('/')}`);
    }
  }
  check('五碗都是 6 饥饿 / 0.6 饱和度修饰值（与蘑菇煲同档）', badFood.length === 0, badFood.join(' '));
  check('五碗各自带**一个**对应的效果，时长与等级都对', badEffect.length === 0, badEffect.join(' '));

  // 逐个把"原版那张表"抄一遍（写清楚是哪一个，别让失败信息指向一堆）
  for (const stew of STEWS) {
    const food = foodForName(stew.key)!;
    equal(`${stew.label} → ${stew.effect} ${stew.seconds} 秒`, food.effects?.[0]?.id, stew.effect);
    equal(`${stew.label} 的效果时长`, food.effects?.[0]?.seconds, stew.seconds);
    check(`${stew.label} 必定触发（没有概率）`, food.effects?.[0]?.chance === undefined);
  }

  const first = foodForName(STEWS[0]!.key)!;
  // 浮点：6 × 0.6 × 2 会算出 7.199999…，所以比到小数点后 6 位
  check(
    '一碗的饱和度点数是 7.2（与蘑菇煲同一档）',
    Math.abs(saturationFrom(first) - 7.2) < 1e-6,
    `实际 ${saturationFrom(first)}`,
  );
  check('五碗都标记为"喝完退碗"', STEWS.every((s) => foodForName(s.key)?.returnsBowl === true));
}

console.log('\n[顺带补上的两条"汤类规矩"]');
{
  equal('蘑菇煲也退碗', foodForName('mushroom_stew')?.returnsBowl, true);
  equal('甜菜汤也退碗', foodForName('beetroot_soup')?.returnsBowl, true);
  equal('蘑菇煲不可堆叠（原版 max stack = 1）', itemDef(Item.MUSHROOM_STEW)?.maxStack, 1);
  equal('甜菜汤不可堆叠', itemDef(Item.BEETROOT_SOUP)?.maxStack, 1);
  check(
    '其它食物照旧能堆 64（只改了"碗装的东西"）',
    (itemDef(Item.BREAD)?.maxStack ?? 0) === 64 && (itemDef(Item.COOKIE)?.maxStack ?? 0) === 64,
  );
  equal(
    '食物表里"退碗"的一共 7 种（蘑菇煲 + 甜菜汤 + 五碗炖菜）',
    Object.values(FOOD_TABLE).filter((f) => f.returnsBowl === true).length,
    7,
  );
}

// ---------------------------------------------------------------- 3. 配方

console.log('\n[配方：碗 + 两种蘑菇 + 那朵花]');
{
  const badRecipe: string[] = [];
  for (const stew of STEWS) {
    const cells = [Item.BOWL, Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, stew.flower];
    const result = matchRecipe(cells, 2);
    if (result?.id !== stew.item || result.count !== 1) badRecipe.push(stew.key);
  }
  check('五条无序配方都成立（摆哪一格都行）', badRecipe.length === 0, badRecipe.join(' '));

  // 摆成 3×3 也认（无序配方不看位置）
  equal(
    '配方在 3×3 工作台上同样成立',
    matchRecipe([0, Item.BOWL, 0, Block.RED_MUSHROOM, Block.POPPY, 0, 0, Block.BROWN_MUSHROOM, 0], 3)?.id,
    Item.SUSPICIOUS_STEW_POPPY,
  );

  // 换花就换碗：用虞美人做出来的**不是**蒲公英那碗
  const withPoppy = matchRecipe([Item.BOWL, Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Block.POPPY], 2);
  check(
    '换一朵花 → 得到的是那一朵对应的那碗',
    withPoppy?.id === Item.SUSPICIOUS_STEW_POPPY &&
      withPoppy.id !== (Item.SUSPICIOUS_STEW_DANDELION as number),
  );
  equal('缺蘑菇做不出来（对照）', matchRecipe([Item.BOWL, Block.RED_MUSHROOM, Block.POPPY, 0], 2), null);
  equal('缺碗做不出来（对照）', matchRecipe([Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Block.POPPY, 0], 2), null);

  // 树苗/别的花不在表里：用没有花的组合做不出任何一碗
  check(
    '用"甜浆果"这种非花材料做不出（对照）',
    matchRecipe([Item.BOWL, Block.RED_MUSHROOM, Block.BROWN_MUSHROOM, Item.SWEET_BERRIES], 2) === null,
  );
}

console.log(`\n可疑的炖菜测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
