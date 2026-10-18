/**
 * 指南针 / 时钟离线测试（批次 195，B19）
 *
 * 这两件的价值全在"一个角度"上，所以这一套几乎全是**角度断言**：
 *
 *  1. **指南针**：正前方 = 0°、右手 = 90°、身后 = 180°、左手 = -90°；
 *     玩家转向之后，同一个世界方向要给出新的相对角；
 *  2. **时钟**：正午（0.25）太阳在顶上、午夜（0.75）在下面、日出在左边；
 *  3. **读数文字与距离**；
 *  4. 物品与配方（4 铁/金 + 1 红石）。
 *
 * 运行：npm run test:navigation
 */

import { Item, CREATIVE_ITEMS, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { itemLabel, itemDescription, hasDescription } from '../src/core/registry/itemNames.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { clockAngleDeg, compassAngleDeg, horizontalDistance, timeOfDayLabel } from '../src/core/items/Navigation.ts';

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

/** 角度比较（容忍浮点误差） */
function near(label: string, actual: number, expected: number): void {
  check(label, Math.abs(actual - expected) < 0.001, `实际 ${actual.toFixed(3)}，期望 ${expected}`);
}

const TILES = new Set<string>(TILE_ORDER);
const DEG = Math.PI / 180;

console.log('\n[两件物品]');
{
  equal('指南针的名字', itemLabel(Item.COMPASS), '指南针');
  equal('时钟的名字', itemLabel(Item.CLOCK), '时钟');
  equal('指南针不可堆叠', maxStackOf(Item.COMPASS), 1);
  equal('时钟不可堆叠', maxStackOf(Item.CLOCK), 1);
  check('两个都有图标', TILES.has(itemDef(Item.COMPASS)!.tile) && TILES.has(itemDef(Item.CLOCK)!.tile));
  check('两个都能在创造栏里拿到', CREATIVE_ITEMS.includes(Item.COMPASS) && CREATIVE_ITEMS.includes(Item.CLOCK));
  check('两个都有说明', hasDescription(Item.COMPASS) && hasDescription(Item.CLOCK));
  check('指南针的说明写了"出生点"', itemDescription(Item.COMPASS).includes('出生点'));
  check('时钟的说明写了"正午"', itemDescription(Item.CLOCK).includes('正午'));
}

console.log('\n[配方]');
{
  const compass = RECIPES.find((recipe) => recipe.result.id === Item.COMPASS);
  check('有指南针配方', compass !== undefined);
  equal('指南针是图案配方', compass?.kind, 'shaped');
  const ironCells = [0, Item.IRON_INGOT, 0, Item.IRON_INGOT, Item.REDSTONE, Item.IRON_INGOT, 0, Item.IRON_INGOT, 0];
  equal('4 铁 + 1 红石能合出指南针', matchRecipe(ironCells, 3)?.id, Item.COMPASS);
  equal('没有红石就合不出来', matchRecipe([0, Item.IRON_INGOT, 0, Item.IRON_INGOT, 0, Item.IRON_INGOT, 0, Item.IRON_INGOT, 0], 3)?.id ?? -1, -1);

  const clock = RECIPES.find((recipe) => recipe.result.id === Item.CLOCK);
  check('有时钟配方', clock !== undefined);
  const goldCells = [0, Item.GOLD_INGOT, 0, Item.GOLD_INGOT, Item.REDSTONE, Item.GOLD_INGOT, 0, Item.GOLD_INGOT, 0];
  equal('4 金 + 1 红石能合出时钟', matchRecipe(goldCells, 3)?.id, Item.CLOCK);
  equal('拿铁矿做不出时钟（原版要金）', matchRecipe(ironCells, 3)?.id, Item.COMPASS);
}

console.log('\n[指南针：相对角]');
{
  // yaw = 0：正前方是 -Z（北）
  near('目标在正前方 → 0°', compassAngleDeg(0, 0, -10), 0);
  near('目标在右手边（+X）→ 90°', compassAngleDeg(0, 10, 0), 90);
  near('目标在身后（+Z）→ 180°', compassAngleDeg(0, 0, 10), 180);
  near('目标在左手边（-X）→ -90°', compassAngleDeg(0, -10, 0), -90);
  near('斜前方 45°', compassAngleDeg(0, 10, -10), 45);

  // 转向西（yaw = 90°）：正前方是 -X
  near('面朝西时，出生点也在西边 → 0°', compassAngleDeg(90 * DEG, -10, 0), 0);
  near('面朝西时，北边变成右手边 → 90°', compassAngleDeg(90 * DEG, 0, -10), 90);
  near('面朝西时，东边在身后 → 180°', compassAngleDeg(90 * DEG, 10, 0), 180);

  // 任意角度：目标方向与朝向一致时一定是 0
  for (const yawDeg of [0, 37, 90, 135, -60, 178]) {
    const yaw = yawDeg * DEG;
    const dx = -Math.sin(yaw) * 20;
    const dz = -Math.cos(yaw) * 20;
    near(`yaw=${yawDeg}° 时"正前方"的角度是 0`, compassAngleDeg(yaw, dx, dz), 0);
  }

  // 站在出生点上：方向退化 → 0（界面另有"已到达"语义，这里只保证不炸/不抖）
  near('站在出生点上 → 0°', compassAngleDeg(1.234, 0, 0), 0);
  // 归一化：结果永远落在 [-180, 180]
  for (const dx of [-30, -1, 0, 1, 30]) {
    for (const dz of [-30, -1, 0, 1, 30]) {
      const angle = compassAngleDeg(2.1, dx, dz);
      check(`角度在 [-180,180]（dx=${dx}, dz=${dz}）`, angle >= -180 && angle <= 180);
    }
  }
}

console.log('\n[时钟：表盘角]');
{
  near('正午（0.25）太阳在正上方 → 0°', clockAngleDeg(0.25), 0);
  near('午夜（0.75）在正下方 → 180°', clockAngleDeg(0.75), 180);
  near('日出（0）在左边 → -90°', clockAngleDeg(0), -90);
  near('日落（0.5）在右边 → 90°', clockAngleDeg(0.5), 90);
  near('0.375（下午三点）→ 45°', clockAngleDeg(0.375), 45);
  near('超过一圈会绕回来（1.25 = 0.25）', clockAngleDeg(1.25), 0);
  near('负数也绕回来（-0.75 = 0.25）', clockAngleDeg(-0.75), 0);
  near('NaN 当 0（日出）', clockAngleDeg(Number.NaN), -90);
}

console.log('\n[读数文字与距离]');
{
  equal('0.05 → 清晨', timeOfDayLabel(0.05), '清晨');
  equal('0.25 → 正午', timeOfDayLabel(0.25), '正午');
  equal('0.4 → 午后', timeOfDayLabel(0.4), '午后');
  equal('0.5 → 黄昏', timeOfDayLabel(0.5), '黄昏');
  equal('0.6 → 入夜', timeOfDayLabel(0.6), '入夜');
  equal('0.75 → 午夜', timeOfDayLabel(0.75), '午夜');
  equal('0.9 → 后半夜', timeOfDayLabel(0.9), '后半夜');

  equal('3-4-5 直角三角形的距离是 5', horizontalDistance(0, 0, 3, 4), 5);
  equal('保留一位小数', horizontalDistance(0, 0, 1, 1), 1.4);
  equal('同一个点是 0', horizontalDistance(8, -8, 8, -8), 0);
}

console.log(`\n指南针/时钟测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
