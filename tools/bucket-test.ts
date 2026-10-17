/**
 * 桶装水与炼药锅离线测试（G13，批次 176）
 *
 * 这一批真正容易写错的是**规则**，不是渲染：
 * "只装水源"、"空桶只能舀满锅"、"一瓶掉一级"、"倒出去永远是源头"——
 * 四条规矩各自都能单独钉住，所以它们都写成了 `world/Cauldron.ts` 里的纯函数。
 *
 * 运行：npm run test:bucket
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import {
  CAULDRON_MAX_LEVEL,
  cauldronLevelOf,
  withCauldronLevel,
  withFluidLevel,
  withFallingFluid,
} from '../src/core/registry/blockState.ts';
import { Item, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import {
  CAULDRON_RAIN_CHANCE,
  bucketFluidAt,
  cauldronAcceptsRain,
  describeCauldron,
  drainCauldronToBottle,
  drainCauldronToBucket,
  fillCauldron,
  isBucketSource,
  isCauldronFull,
} from '../src/core/world/Cauldron.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';

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

// ---------------------------------------------------------------- 1. 水源判定

console.log('\n[桶只能装水源（流水装不起来）]');
{
  equal('水（源头，状态 0）能装', isBucketSource(Block.WATER, 0), true);
  check('流水（液面 1）装不起来', !isBucketSource(Block.WATER, withFluidLevel(0, 1)));
  check('瀑布那一节也不行（有下落标记）', !isBucketSource(Block.WATER, withFallingFluid(withFluidLevel(0, 0))));
  equal('岩浆也能装（岩浆桶）', isBucketSource(Block.LAVA, 0), true);
  check('空气/石头不是液体', !isBucketSource(Block.AIR, 0) && !isBucketSource(Block.STONE, 0));

  equal('水对应水桶', bucketFluidAt(Block.WATER), 'water');
  equal('岩浆对应岩浆桶', bucketFluidAt(Block.LAVA), 'lava');
  equal('别的方块没有对应的桶', bucketFluidAt(Block.STONE), null);
}

// ---------------------------------------------------------------- 2. 炼药锅水位

console.log('\n[炼药锅：0~3 级水位]');
{
  equal('上限是 3（原版）', CAULDRON_MAX_LEVEL, 3);
  equal('空锅是 0 级', cauldronLevelOf(0), 0);
  equal('写 3 级能读回', cauldronLevelOf(withCauldronLevel(0, 3)), 3);
  equal('超过 3 被夹住', cauldronLevelOf(withCauldronLevel(0, 9)), CAULDRON_MAX_LEVEL);
  equal('负数被夹到 0', cauldronLevelOf(withCauldronLevel(0, -2)), 0);
  equal('写水位不动其它状态位', withCauldronLevel(0b1100, 2) & 0b1100, 0b1100);

  check('3 级才算满', isCauldronFull(withCauldronLevel(0, 3)) && !isCauldronFull(withCauldronLevel(0, 2)));

  // 倒一桶 → 直接满（不是 +1）
  equal('一桶水灌满锅', cauldronLevelOf(fillCauldron(withCauldronLevel(0, 1))), 3);
  // 满锅舀一桶 → 空
  equal('满锅能舀回一桶（舀完是空的）', cauldronLevelOf(drainCauldronToBucket(withCauldronLevel(0, 3))!), 0);
  equal('半锅舀不出一桶（返回 null）', drainCauldronToBucket(withCauldronLevel(0, 2)), null);
  // 瓶子：一级一瓶
  equal('舀一瓶掉一级', cauldronLevelOf(drainCauldronToBottle(withCauldronLevel(0, 3))!), 2);
  equal('只剩一级时舀完是空锅', cauldronLevelOf(drainCauldronToBottle(withCauldronLevel(0, 1))!), 0);
  equal('空锅舀不出瓶子', drainCauldronToBottle(0), null);

  check('下雨只往露天的不满的锅里接', cauldronAcceptsRain(0, 15) && !cauldronAcceptsRain(withCauldronLevel(0, 3), 15));
  check('洞里（天光不足）接不到雨', !cauldronAcceptsRain(0, 7));
  check('接雨概率在 0~1 之间', CAULDRON_RAIN_CHANCE > 0 && CAULDRON_RAIN_CHANCE < 1);
  check('描述文案看得出几级', describeCauldron(withCauldronLevel(0, 2)).includes('2'));
}

// ---------------------------------------------------------------- 3. 注册与贴图

console.log('\n[方块 / 物品 / 贴图 / 配方]');
{
  const def = blockDef(Block.CAULDRON);
  check('炼药锅已注册', def !== undefined && def.name === 'minecraft:cauldron');
  equal('形状借堆肥桶那一副（四面板条 + 薄底）', def.shape, 'composter');
  equal('中文名', itemLabel(Block.CAULDRON), '炼药锅');
  check('有说明（写明三级、瓶子、下雨接水与差异）', hasDescription(Block.CAULDRON));

  equal('水桶的中文名', itemLabel(Item.WATER_BUCKET), '水桶');
  equal('岩浆桶的中文名', itemLabel(Item.LAVA_BUCKET), '岩浆桶');
  equal('水桶不可堆叠（里面装着东西）', maxStackOf(Item.WATER_BUCKET), 1);
  equal('岩浆桶不可堆叠', maxStackOf(Item.LAVA_BUCKET), 1);
  check('两种桶都有说明', hasDescription(Item.WATER_BUCKET) && hasDescription(Item.LAVA_BUCKET));

  const tiles = TILE_ORDER as readonly string[];
  check(
    '炼药锅的四张脸都在图集里（漏一张就是紫黑方块）',
    def.tiles.every((tile) => tiles.includes(tile)),
    def.tiles.join(','),
  );
  check(
    '两种桶的图标都在图集里',
    [Item.WATER_BUCKET, Item.LAVA_BUCKET].every((id) => tiles.includes(itemDef(id)!.tile)),
  );

  // 配方：7 个铁锭（U 形）
  const shape: number[] = [];
  for (const row of ['I I', 'I I', 'III']) {
    for (const char of row) shape.push(char === 'I' ? Item.IRON_INGOT : 0);
  }
  equal('7 铁锭能做出炼药锅', matchRecipe(shape, 3)?.id, Block.CAULDRON);
  const short: number[] = [];
  for (const row of ['I I', 'I I', 'II ']) {
    for (const char of row) short.push(char === 'I' ? Item.IRON_INGOT : 0);
  }
  equal('少一个铁锭就做不出来', matchRecipe(short, 3), null);
  check(
    '只有一条炼药锅配方',
    RECIPES.filter((recipe) => recipe.result.id === Block.CAULDRON).length === 1,
  );
  check(
    '两种桶都没有配方（原版也没有：桶只能装，不能合）',
    RECIPES.every((recipe) => recipe.result.id !== Item.WATER_BUCKET && recipe.result.id !== Item.LAVA_BUCKET),
  );
}

console.log(`\n桶与炼药锅测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
