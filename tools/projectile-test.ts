/**
 * 弹射物与弓离线测试（J9）
 *
 * 覆盖：
 *  1. 物品数据层：弓/箭/燧石/线的注册、耐久、贴图、名字
 *  2. 燧石的来源（砂砾 10% 的"概率替换"掉落）
 *  3. 配方：箭 4 支、弓（镜像）、羊毛拆线
 *  4. 弓参与附魔与铁砧的方式（附魔类别 bow、用木板修）
 *
 * 运行：npm run test:projectile
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item, itemDef, maxStackOf, replaceDropFor, durabilityOf, SPECIAL_ITEMS } from '../src/core/registry/items.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { itemLabel, itemTooltip } from '../src/core/registry/itemNames.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { enchantKindOf, offeringFor } from '../src/core/crafting/Enchanting.ts';
import { maxDurabilityOf, repairMaterialOf } from '../src/core/crafting/Anvil.ts';

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

const TILES: readonly string[] = TILE_ORDER;

// ---------------------------------------------------------------- 1. 物品数据层

console.log('\n[弓与箭的物品]');
equal('弓有注册名', itemDef(Item.BOW)?.name, 'minecraft:bow');
equal('箭有注册名', itemDef(Item.ARROW)?.name, 'minecraft:arrow');
equal('燧石有注册名', itemDef(Item.FLINT)?.name, 'minecraft:flint');
equal('线有注册名', itemDef(Item.STRING)?.name, 'minecraft:string');

equal('弓每件一叠（它是耐用品）', maxStackOf(Item.BOW), 1);
equal('箭可以堆 64 支', maxStackOf(Item.ARROW), 64);
equal('燧石可以堆 64 个', maxStackOf(Item.FLINT), 64);
equal('线可以堆 64 根', maxStackOf(Item.STRING), 64);

equal('弓的耐久是原版的 384', durabilityOf(Item.BOW), 384);
equal('铁砧那边读到的弓耐久一致', maxDurabilityOf(Item.BOW), 384);
equal('箭没有耐久（不是耐用品）', durabilityOf(Item.ARROW), 0);
equal('钻石镐的耐久仍然走工具表', durabilityOf(1000) >= 0, true);

check(
  '四件新物品的图标都在图集名单里',
  [Item.BOW, Item.ARROW, Item.FLINT, Item.STRING].every((id) => TILES.includes(itemDef(id)!.tile)),
  [Item.BOW, Item.ARROW, Item.FLINT, Item.STRING].map((id) => itemDef(id)!.tile).join(' '),
);

console.log('\n[中文名与说明]');
equal('弓叫"弓"', itemLabel(Item.BOW), '弓');
equal('箭叫"箭"', itemLabel(Item.ARROW), '箭');
equal('燧石叫"燧石"', itemLabel(Item.FLINT), '燧石');
equal('线叫"线"', itemLabel(Item.STRING), '线');
check('弓的说明提到蓄力与耐久', itemTooltip(Item.BOW).description.includes('蓄力'), itemTooltip(Item.BOW).description);
check('箭的说明写明配方数量', itemTooltip(Item.ARROW).description.includes('4 支'), itemTooltip(Item.ARROW).description);

// ---------------------------------------------------------------- 2. 燧石的来源

console.log('\n[砂砾 10% 掉燧石（概率替换）]');
{
  equal('掷点 0.05（<10%）时变成燧石', replaceDropFor(Block.GRAVEL, 0.05)?.id, Item.FLINT);
  equal('掷点 0 也是燧石', replaceDropFor(Block.GRAVEL, 0)?.id, Item.FLINT);
  equal('掷点 0.5 时还是砂砾（没有替换）', replaceDropFor(Block.GRAVEL, 0.5), null);
  equal('刚好 0.1 不算命中（边界是左闭右开）', replaceDropFor(Block.GRAVEL, 0.1), null);
  equal('替换掉的是 1 个', replaceDropFor(Block.GRAVEL, 0.01)?.count, 1);
  equal('石头不会被替换成别的东西', replaceDropFor(Block.STONE, 0.01), null);
  equal('沙子也不会', replaceDropFor(Block.SAND, 0.01), null);
}

// ---------------------------------------------------------------- 3. 配方

console.log('\n[配方]');
{
  const grid = (size: 3, rows: readonly string[], legend: Record<string, number>): number[] => {
    const cells = new Array<number>(size * size).fill(0);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r]!.length; c++) {
        const ch = rows[r]![c]!;
        if (ch === '·') continue;
        cells[r * size + c] = legend[ch] ?? 0;
      }
    }
    return cells;
  };

  const arrowRecipe = RECIPES.find((recipe) => recipe.result.id === Item.ARROW);
  check('有箭的配方', arrowRecipe !== undefined);
  equal('一次出 4 支', arrowRecipe?.result.count, 4);
  check('箭的配方是无序的（燧石/木棍/羽毛随便摆）', arrowRecipe?.kind === 'shapeless');

  const bowRecipe = RECIPES.find((recipe) => recipe.result.id === Item.BOW);
  check('有弓的配方', bowRecipe !== undefined);
  equal('弓一次出 1 把', bowRecipe?.result.count, 1);

  equal(
    '弓：3 木棍 + 3 线（原版图案）',
    matchRecipe(grid(3, ['·ST', 'S·T', '·ST'], { S: Item.STRING, T: Item.STICK }), 3)?.id,
    Item.BOW,
  );
  equal(
    '弓：镜像摆法也能合成',
    matchRecipe(grid(3, ['TS·', 'T·S', 'TS·'], { S: Item.STRING, T: Item.STICK }), 3)?.id,
    Item.BOW,
  );

  const stringRecipe = RECIPES.find((recipe) => recipe.result.id === Item.STRING);
  check('有羊毛拆线的配方（替代还没做的蜘蛛）', stringRecipe !== undefined);
  equal('1 个羊毛拆 4 根线', stringRecipe?.result.count, 4);
}

// ---------------------------------------------------------------- 4. 弓的附魔与修复

console.log('\n[弓参与附魔与铁砧]');
{
  equal('弓的附魔类别是 bow', enchantKindOf(Item.BOW), 'bow');
  equal('箭不能附魔', enchantKindOf(Item.ARROW), null);
  const bowEnchants = offeringFor('bow').map((def) => def.id);
  check('弓能附到力量', bowEnchants.includes('power'));
  check('弓能附到冲击', bowEnchants.includes('punch'));
  check('弓能附到火矢', bowEnchants.includes('flame'));
  check('弓能附到无限', bowEnchants.includes('infinity'));
  check('弓能附到耐久（全装备通用）', bowEnchants.includes('unbreaking'));
  check('弓附不到效率这种工具附魔', !bowEnchants.includes('efficiency'));

  equal('弓用木板修', repairMaterialOf(Item.BOW), Block.OAK_PLANKS);
  equal('弓在特殊物品表里登记了', SPECIAL_ITEMS[Item.BOW]?.kind, 'bow');
}

console.log(`\n弹射物测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
