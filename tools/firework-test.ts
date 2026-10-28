/**
 * 烟花离线测试（批次 192，H16 第二片）
 *
 * 烟花这块有两条独立的线，都要钉住：
 *
 *  1. **物品与配方**：星（火药 + 16 种染料）、素火箭（纸 + 火药 1~3）、
 *     带星火箭（颜色由**摆进去的那颗星**决定——配方只能按 id 匹配，所以这一条在 `CraftingGrid` 里）；
 *  2. **实体**：匀速上升 → 引信烧完 → 调 `burstFirework` 报"位置/颜色/威力/伤害"，然后自己死掉。
 *
 * 另外还覆盖附加数据的四处链路（存档/深拷/并堆/漏斗），这是"新字段最容易漏"的地方。
 *
 * 运行：npm run test:firework
 */

import { Item, CREATIVE_ITEMS, dyeItemId, itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { Block } from '../web/src/core/registry/blocks.ts';
import { itemLabel, itemDescription, hasDescription } from '../web/src/core/registry/itemNames.ts';
import { DYE_COLORS } from '../web/src/core/registry/colors.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import {
  DEFAULT_FIREWORK_COLOR,
  FIREWORK_RISE_SPEED,
  MAX_COLORS,
  MAX_FLIGHT,
  fireworkColorsOf,
  fireworkDamage,
  fireworkDataOf,
  fireworkExplosionPower,
  fireworkRiseSeconds,
  isFireworkRocket,
  makeFireworkRocket,
  makeFireworkStar,
  sanitizeFirework,
  withFirework,
} from '../web/src/core/items/Firework.ts';
import { RECIPES, matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { CraftingGrid } from '../web/src/core/crafting/CraftingGrid.ts';
import { restoreStack, sameExtras, stackExtras } from '../web/src/core/container/Inventory.ts';
import { tryInsertOne } from '../web/src/core/container/Transfer.ts';
import { Chest } from '../web/src/core/container/Chest.ts';
import { Firework } from '../web/src/core/entity/Firework.ts';
import type { EntityContext } from '../web/src/core/entity/Entity.ts';

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

/** 只填实体 tick 真正会用到的那几项，其余按类型断言 */
function stubContext(onBurst: (colors: readonly number[], power: number, damage: number, y: number) => void): EntityContext {
  return {
    world: {} as never,
    playerBox: null,
    player: null,
    pickup: () => 0,
    getBlock: () => Block.AIR,
    hurtPlayer: () => {},
    spawnDrop: () => {},
    burstFirework: (_x, y, _z, colors, power, damage) => onBurst(colors, power, damage, y),
  } as EntityContext;
}

console.log('\n[两个物品]');
{
  equal('烟火之星的中文名', itemLabel(Item.FIREWORK_STAR), '烟火之星');
  equal('烟花火箭的中文名', itemLabel(Item.FIREWORK_ROCKET), '烟花火箭');
  equal('星不可堆叠（颜色是数据）', maxStackOf(Item.FIREWORK_STAR), 1);
  equal('火箭不可堆叠（档位与颜色是数据）', maxStackOf(Item.FIREWORK_ROCKET), 1);
  check('两个都有图标', TILES.has(itemDef(Item.FIREWORK_STAR)!.tile) && TILES.has(itemDef(Item.FIREWORK_ROCKET)!.tile));
  check('两个都能在创造栏里拿到', CREATIVE_ITEMS.includes(Item.FIREWORK_STAR) && CREATIVE_ITEMS.includes(Item.FIREWORK_ROCKET));
  check('两个都有说明', hasDescription(Item.FIREWORK_STAR) && hasDescription(Item.FIREWORK_ROCKET));
  check('火箭的说明写了"右键发射"', itemDescription(Item.FIREWORK_ROCKET).includes('右键发射'));
}

console.log('\n[数据规整]');
{
  equal('默认档位是 1', fireworkDataOf({ id: Item.FIREWORK_ROCKET, count: 1 }).flight, 1);
  equal('没写颜色时炸金色', fireworkColorsOf({ id: Item.FIREWORK_ROCKET, count: 1 })[0], DEFAULT_FIREWORK_COLOR);

  equal('档位夹到上限', sanitizeFirework({ flight: 9, colors: [] })?.flight, MAX_FLIGHT);
  equal('负数档位夹到 0', sanitizeFirework({ flight: -3, colors: [] })?.flight, 0);
  equal('小数档位取整', sanitizeFirework({ flight: 2.6, colors: [] })?.flight, 3);
  equal('颜色去重', sanitizeFirework({ flight: 1, colors: [0x112233, 0x112233, 0x445566] })?.colors.length, 2);
  equal('最多 8 种颜色', sanitizeFirework({ flight: 1, colors: Array.from({ length: 20 }, (_v, i) => i) })?.colors.length, MAX_COLORS);

  const quoted = sanitizeFirework({ flight: 1, colors: [0x1000000, -5, 'red'], flightAgain: 3 });
  equal('超范围的颜色被夹到 0xFFFFFF', quoted?.colors[0], 0xffffff);
  check('非数字颜色被丢掉', !quoted?.colors.includes(NaN as unknown as number) && (quoted?.colors.length ?? 0) <= 2);
  equal('乱七八糟的对象 → undefined', sanitizeFirework('nope'), undefined);
  equal('null → undefined', sanitizeFirework(null), undefined);

  equal('1 档飞 1 秒', fireworkRiseSeconds(1), 1);
  equal('2 档飞 1.4 秒', Math.round(fireworkRiseSeconds(2) * 10) / 10, 1.4);
  equal('3 档飞 1.8 秒', Math.round(fireworkRiseSeconds(3) * 10) / 10, 1.8);
  check('档位越高飞得越久', fireworkRiseSeconds(1) < fireworkRiseSeconds(2) && fireworkRiseSeconds(2) < fireworkRiseSeconds(3));
  check('档位越高威力越大', fireworkExplosionPower(1) < fireworkExplosionPower(2) && fireworkExplosionPower(2) < fireworkExplosionPower(3));
  equal('1 档伤害 5', fireworkDamage(1), 5);
  equal('2 档伤害 6', fireworkDamage(2), 6);
  equal('3 档伤害 7', fireworkDamage(3), 7);

  const star = makeFireworkStar(0x3ab3da);
  equal('星的 id', star.id, Item.FIREWORK_STAR);
  equal('星的颜色', star.firework?.colors[0], 0x3ab3da);
  equal('星不飞（档位 0）', star.firework?.flight, 0);
  const rocket = makeFireworkRocket(3, [0x3ab3da]);
  equal('火箭的档位', rocket.firework?.flight, 3);
  equal('火箭的颜色', rocket.firework?.colors[0], 0x3ab3da);
  check('火箭判定', isFireworkRocket(rocket) && !isFireworkRocket(star));

  const kept = withFirework({ id: Item.FIREWORK_ROCKET, count: 2, name: '我的烟花' }, { flight: 2, colors: [0xff0000] });
  equal('改名跟着走', kept.name, '我的烟花');
  equal('档位写进去了', kept.firework?.flight, 2);
  check('颜色数组是新的一份', kept.firework?.colors !== rocket.firework?.colors);
}

console.log('\n[配方]');
{
  const stars = RECIPES.filter((recipe) => recipe.result.id === Item.FIREWORK_STAR);
  equal('16 条星配方（一种染料一条）', stars.length, DYE_COLORS.length);

  // 逐个染料验证颜色换算：星的颜色必须等于那块染料的 rgb
  let mismatched = 0;
  for (let index = 0; index < DYE_COLORS.length; index++) {
    const dye = DYE_COLORS[index]!;
    const rgb = dye.rgb;
    const expected = ((rgb[0] & 0xff) << 16) | ((rgb[1] & 0xff) << 8) | (rgb[2] & 0xff);
    const recipe = stars.find((entry) => entry.kind === 'shapeless' && entry.ingredients.includes(dyeItemId(index)));
    const actual = recipe?.result.extra?.firework?.colors?.[0];
    if (actual !== expected) mismatched++;
  }
  equal('每条星配方的颜色都与染料表对上', mismatched, 0);

  const rockets = RECIPES.filter((recipe) => recipe.result.id === Item.FIREWORK_ROCKET);
  equal('6 条火箭配方（素 3 + 带星 3）', rockets.length, 6);
  const withStar = rockets.filter((recipe) => recipe.kind === 'shapeless' && recipe.ingredients.includes(Item.FIREWORK_STAR));
  equal('带星的 3 条', withStar.length, 3);
  const flights = rockets
    .filter((recipe) => recipe.kind === 'shapeless' && !recipe.ingredients.includes(Item.FIREWORK_STAR))
    .map((recipe) => (recipe.kind === 'shapeless' ? recipe.ingredients.filter((id) => id === Item.GUNPOWDER).length : 0))
    .sort();
  equal('素火箭的档位就是火药份数（1/2/3）', flights.join(','), '1,2,3');

  // 实际摆一次
  const oneGunpowder = matchRecipe([Item.PAPER, Item.GUNPOWDER, 0, 0], 2);
  equal('纸 + 火药 → 火箭', oneGunpowder?.id, Item.FIREWORK_ROCKET);
  equal('1 份火药 → 1 档', oneGunpowder?.firework?.flight, 1);
  const three = matchRecipe([Item.PAPER, Item.GUNPOWDER, Item.GUNPOWDER, Item.GUNPOWDER, 0, 0, 0, 0, 0], 3);
  equal('纸 + 3 份火药 → 3 档', three?.firework?.flight, MAX_FLIGHT);
  // 原版最多 3 份：第 4 份直接合不出来（不是"封顶"而是"这一摆法没有配方"）
  equal('纸 + 4 份火药 → 没有这个配方', matchRecipe([Item.PAPER, Item.GUNPOWDER, Item.GUNPOWDER, Item.GUNPOWDER, Item.GUNPOWDER, 0, 0, 0, 0], 3), null);

  const starRecipe = matchRecipe([Item.GUNPOWDER, dyeItemId(3), 0, 0], 2);
  equal('火药 + 染料 → 星', starRecipe?.id, Item.FIREWORK_STAR);
  equal('星带着染料颜色', starRecipe?.firework?.colors[0] !== undefined, true);
}

console.log('\n[带星火箭：颜色来自那颗星]');
{
  const grid = new CraftingGrid(3);
  grid.set(0, { id: Item.PAPER, count: 1 });
  grid.set(1, makeFireworkStar(0x00aa55));
  grid.set(2, { id: Item.GUNPOWDER, count: 1 });
  grid.set(3, { id: Item.GUNPOWDER, count: 1 });
  equal('合出的是火箭', grid.result?.id, Item.FIREWORK_ROCKET);
  equal('颜色取自摆进去的星', grid.result?.firework?.colors[0], 0x00aa55);
  equal('档位来自火药份数', grid.result?.firework?.flight, 2);

  const plain = new CraftingGrid(2);
  plain.set(0, { id: Item.PAPER, count: 1 });
  plain.set(1, { id: Item.GUNPOWDER, count: 1 });
  equal('素火箭不带颜色', plain.result?.firework?.colors.length, 0);
}

console.log('\n[实体：上升与爆炸]');
{
  const bursts: { colors: readonly number[]; power: number; damage: number; y: number }[] = [];
  const ctx = stubContext((colors, power, damage, y) => bursts.push({ colors, power, damage, y }));
  const rocket = new Firework(0, 64, 0, 2, [0xff0000, 0x00ff00]);
  const startY = rocket.y;

  // 半秒内不该炸
  for (let i = 0; i < 10; i++) rocket.tick(ctx, 0.05);
  equal('半秒时还没炸', bursts.length, 0);
  check('而且确实在上升', rocket.y > startY);
  equal('上升速度就是表里那个值（误差 0.1 格）', Math.abs(rocket.y - startY - FIREWORK_RISE_SPEED * 0.5) < 0.1, true);

  // 再推 2 秒（2 档引信 1.4 秒）；死了之后继续推也不该再炸
  for (let i = 0; i < 40; i++) rocket.tick(ctx, 0.05);
  equal('引信烧完炸一次', bursts.length, 1);
  equal('报出来的颜色是那两种', bursts[0]!.colors.join(','), '16711680,65280');
  equal('报出来的伤害是 2 档的 6', bursts[0]!.damage, fireworkDamage(2));
  check('威力与档位对得上', Math.abs(bursts[0]!.power - fireworkExplosionPower(2)) < 1e-9);
  equal('炸完就死了', rocket.dead, true);

  // 3 档飞得更高才炸
  const high = new Firework(0, 64, 0, 3, []);
  let ticks = 0;
  while (!high.dead && ticks < 1000) {
    high.tick(ctx, 0.05);
    ticks++;
  }
  check('3 档也炸了', high.dead);
  check('3 档比 1 档飞得高', ticks * 0.05 * FIREWORK_RISE_SPEED > fireworkRiseSeconds(1) * FIREWORK_RISE_SPEED);
}

console.log('\n[附加数据：存档 / 并堆 / 搬运]');
{
  const saved = makeFireworkRocket(2, [0xff0000, 0x0000ff]);
  const restored = restoreStack(JSON.parse(JSON.stringify(saved)));
  equal('读档回来档位还在', restored?.firework?.flight, 2);
  equal('读档回来颜色还在', restored?.firework?.colors.join(','), '16711680,255');

  const dirty = restoreStack({ id: Item.FIREWORK_ROCKET, count: 1, firework: { flight: 99, colors: [1, 1, 2] } });
  equal('脏档位被夹住', dirty?.firework?.flight, MAX_FLIGHT);
  equal('重复颜色被去掉', dirty?.firework?.colors.length, 2);

  const extras = stackExtras(saved);
  check('stackExtras 拷了颜色数组', Array.isArray(extras.firework?.colors));
  check('而且是新的一份', extras.firework?.colors !== saved.firework?.colors);

  check('颜色不同 → 不能并堆', !sameExtras({ firework: { flight: 1, colors: [1] } }, { firework: { flight: 1, colors: [2] } }));
  check('档位不同 → 不能并堆', !sameExtras({ firework: { flight: 1, colors: [1] } }, { firework: { flight: 2, colors: [1] } }));
  check('完全一样 → 可以并堆', sameExtras({ firework: { flight: 1, colors: [1] } }, { firework: { flight: 1, colors: [1] } }));

  const chest = new Chest();
  check('能塞进箱子', tryInsertOne(chest, saved));
  const slot = chest.get(0);
  equal('箱子里的那枚还带着档位', slot?.firework?.flight, 2);
  equal('也还带着颜色', slot?.firework?.colors.join(','), '16711680,255');
}

console.log(`\n烟花测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);

