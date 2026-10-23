/**
 * 信标离线测试（K5，批次 117）
 *
 * 信标这一批做了四件互相咬合的事，这里按它们的**依赖顺序**断言：
 *
 *  1. **三种矿物块**（金块 / 钻石块 / 绿宝石块）：它们是金字塔的底座材料，
 *     在此之前本项目连这三种储物方块都没有（也没有 9 锭换 1 块的配方）；
 *  2. **信标方块本身**：完整立方体、发光 15、木镐可挖、中文名与说明都在；
 *  3. **方块状态里那两行选择**（主效果 0~5 与"生命恢复"那一位）——
 *     玩家的选择会跟着存档走，所以位布局本身要有断言盯着；
 *  4. **金字塔与效果**（纯逻辑 `world/Beacon.ts`）：等级 0~4、各级半径、
 *     主效果等级（1~2 级 I、3~4 级 II）、生命恢复要三级、混着摆也算数。
 *
 * 运行：npm run test:beacon
 */

import { Block, blockDef, blockHardness, blockTiles } from '../src/core/registry/blocks.ts';
import { effectLabel } from '../src/core/survival/StatusEffects.ts';
import { CREATIVE_ITEMS, Item, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, makeToolInfo } from '../src/core/registry/tools.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { recipeIngredients } from '../src/core/crafting/RecipeBook.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  beaconPrimary,
  beaconRegen,
  beaconSecondary,
  withBeaconPrimary,
  withBeaconRegen,
  withBeaconSecondary,
} from '../src/core/registry/blockState.ts';
import {
  BEACON_BASE_BLOCKS,
  BEACON_EFFECT_SECONDS,
  BEACON_MAX_LEVEL,
  BEACON_POWERS,
  BEACON_RANGE_BY_LEVEL,
  BEACON_REGEN_MIN_LEVEL,
  beaconEffects,
  beaconLevel,
  beaconPrimaryAmplifier,
  beaconRange,
  beaconSummary,
  type BeaconWorld,
} from '../src/core/world/Beacon.ts';

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

/** 配方表里那一份信标配方（"按表读"那条断言用；界面/配方书读的就是它） */
const BEACON_RECIPE = RECIPES.find((recipe) => recipe.result.id === Block.BEACON);

/** 一个由 `Map` 撑起来的假世界（信标只读方块，见 `BeaconWorld`） */
function makeWorld(cells: Map<string, number>): BeaconWorld {
  return { getBlock: (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.AIR };
}

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/**
 * 在 (0, y, 0) 摆一座信标 + 它下面的金字塔。
 *
 * @param levels 金字塔几级（0 = 只有信标、没有底座）
 * @param base 底座用哪种方块（默认铁块）
 */
function buildPyramid(levels: number, base: number = Block.IRON_BLOCK): Map<string, number> {
  const cells = new Map<string, number>();
  cells.set(key(0, 0, 0), Block.BEACON);
  for (let layer = 1; layer <= levels; layer++) {
    const r = layer;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) cells.set(key(dx, -layer, dz), base);
    }
  }
  return cells;
}

// ---------------------------------------------------------------- 1. 三种矿物块

console.log('\n[矿物块：信标底座要用的那三种]');
{
  const cases: Array<{ id: number; name: string; label: string; tile: string; hardness: number; tier: number }> = [
    { id: Block.GOLD_BLOCK, name: 'minecraft:gold_block', label: '金块', tile: 'gold_block', hardness: 3, tier: 1 },
    {
      id: Block.DIAMOND_BLOCK,
      name: 'minecraft:diamond_block',
      label: '钻石块',
      tile: 'diamond_block',
      hardness: 5,
      tier: 2,
    },
    {
      id: Block.EMERALD_BLOCK,
      name: 'minecraft:emerald_block',
      label: '绿宝石块',
      tile: 'emerald_block',
      hardness: 5,
      tier: 2,
    },
  ];
  for (const entry of cases) {
    const def = blockDef(entry.id);
    equal(`${entry.label}的注册名`, def.name, entry.name);
    check(`${entry.label}的贴图在图集里`, blockTiles(entry.id, 0).every((tile) => TILES.has(tile)), entry.tile);
    equal(`${entry.label}的硬度（原版）`, blockHardness(entry.id), entry.hardness);
    equal(`${entry.label}的中文名`, itemLabel(entry.id), entry.label);
    check(`${entry.label}有说明（写明能做信标底座）`, hasDescription(entry.id) && itemDescription(entry.id).includes('底座'));
    check(`${entry.label}在创造物品栏里拿得到`, CREATIVE_ITEMS.includes(entry.id));
    // 开采档位：矿物块跟随它那种矿石（金块要石镐、钻石/绿宝石块要铁镐）
    equal(
      `${entry.label}要 ${entry.tier} 级镐（与它那种矿石同档）`,
      canHarvest(entry.id, makeToolInfo('pickaxe', entry.tier === 1 ? 'stone' : 'iron')),
      true,
    );
    check(`${entry.label}用木质镐挖不动（原版如此）`, !canHarvest(entry.id, makeToolInfo('pickaxe', 'wooden')));
  }
  check('铁块仍然要石镐（这一批顺带把它也归了档）', canHarvest(Block.IRON_BLOCK, makeToolInfo('pickaxe', 'stone')));
}

// ---------------------------------------------------------------- 2. 信标方块

console.log('\n[信标方块]');
{
  const def = blockDef(Block.BEACON);
  equal('注册名', def.name, 'minecraft:beacon');
  equal('形状是完整立方体（能用"格子"的方式理解它）', def.shape, 'cube');
  equal('**是光源**（原版亮度 15）', def.light, 15);
  equal('不遮挡邻居（那圈玻璃）', def.opaque, false);
  equal('不挡光', def.lightOpacity, 0);
  check('两张贴图都在图集里（侧面 + 顶面）', blockTiles(Block.BEACON, 0).every((tile) => TILES.has(tile)));
  equal('硬度 3（原版）', blockHardness(Block.BEACON), 3);
  check('木质镐就能挖下来（原版如此）', canHarvest(Block.BEACON, makeToolInfo('pickaxe', 'wooden')));
  equal('中文名', itemLabel(Block.BEACON), '信标');
  check(
    '说明写了"金字塔 + 主效果五选一 + 生命恢复"',
    itemDescription(Block.BEACON).includes('金字塔') &&
      itemDescription(Block.BEACON).includes('生命恢复') &&
      itemDescription(Block.BEACON).includes('半径'),
  );
}

// ---------------------------------------------------------------- 3. 配方

console.log('\n[配方：三种矿物块 + 信标]');
{
  const nine = (item: number): number[] => Array.from({ length: 9 }, () => item);
  const blockCases: Array<{ item: number; block: number; label: string }> = [
    { item: Item.GOLD_INGOT, block: Block.GOLD_BLOCK, label: '金块' },
    { item: Item.DIAMOND, block: Block.DIAMOND_BLOCK, label: '钻石块' },
    { item: Item.EMERALD, block: Block.EMERALD_BLOCK, label: '绿宝石块' },
  ];
  for (const entry of blockCases) {
    equal(`9 个原料能压出 1 个${entry.label}`, matchRecipe(nine(entry.item), 3)?.id, entry.block);
    equal(`${entry.label}能拆回 9 个（无序配方）`, matchRecipe([entry.block], 2)?.count, 9);
    equal(`拆回来的是原原料`, matchRecipe([entry.block], 2)?.id, entry.item);
  }

  // 信标：5 玻璃 + 1 下界之星 + 3 黑曜石（原版图案）
  const beaconRecipe = matchRecipe(
    [Block.GLASS, Block.GLASS, Block.GLASS, Block.GLASS, Item.NETHER_STAR, Block.GLASS, Block.OBSIDIAN, Block.OBSIDIAN, Block.OBSIDIAN],
    3,
  );
  equal('信标有配方（5 玻璃 + 1 下界之星 + 3 黑曜石）', beaconRecipe?.id, Block.BEACON);
  equal('产出 1 个', beaconRecipe?.count, 1);
  // 三块黑曜石不能换成别的东西（原版是**有序**配方）
  equal(
    '黑曜石换成石头 → 配不出来',
    matchRecipe(
      [Block.GLASS, Block.GLASS, Block.GLASS, Block.GLASS, Item.NETHER_STAR, Block.GLASS, Block.STONE, Block.STONE, Block.STONE],
      3,
    ),
    null,
  );
  // 再按**配方表本身**对一遍（上面那份是手写进 `matchRecipe` 的格位，
  // 万一表的图案与这里写的不一致，这条会红）
  {
    const fromTable = BEACON_RECIPE;
    check('配方表里有一份信标配方', fromTable !== undefined);
    equal('它的原料是三样（玻璃 / 下界之星 / 黑曜石）', recipeIngredients(fromTable!).length, 3);
    check(
      '原料清单就是这三样',
      recipeIngredients(fromTable!)
        .map((entry) => entry.id)
        .sort((a, b) => a - b)
        .join(',') === [Block.GLASS, Item.NETHER_STAR, Block.OBSIDIAN].sort((a, b) => a - b).join(','),
    );
  }
  equal('下界之星能堆 64（做信标要占一格）', maxStackOf(Item.NETHER_STAR), 64);
  equal('信标的物品堆叠是 64（方块物品的默认）', maxStackOf(Block.BEACON), 64);
}

// ---------------------------------------------------------------- 4. 方块状态里那两行选择

console.log('\n[方块状态：选中的效果记在信标那一格里]');
{
  equal('默认状态：还没选主效果', beaconPrimary(0), 0);
  equal('默认状态：没有生命恢复', beaconRegen(0), false);
  for (let index = 0; index <= 5; index++) {
    equal(`主效果下标 ${index} 写得进读得出`, beaconPrimary(withBeaconPrimary(0, index)), index);
  }
  equal('生命恢复那一位读写往返', beaconRegen(withBeaconRegen(0, true)), true);
  equal('次级主效果默认没选', beaconSecondary(0), 0);
  equal('次级主效果读写往返', beaconSecondary(withBeaconSecondary(0, 3)), 3);
  check(
    '次级主效果不碰主效果/生命恢复',
    beaconPrimary(withBeaconSecondary(0, 3)) === 0 && !beaconRegen(withBeaconSecondary(0, 3)),
  );
  check(
    '两位互不干扰（写了主效果再开生命恢复，主效果还在）',
    beaconPrimary(withBeaconRegen(withBeaconPrimary(0, 3), true)) === 3,
  );
  check(
    '反过来也一样',
    beaconRegen(withBeaconPrimary(withBeaconRegen(0, true), 5)) === true,
  );
  // 位宽：7 位（0b111）之外的下标会被截断，但不该冒到别的位上去
  equal('下标 7 只会落在自己那三位里（0b111 截断后是 7）', beaconPrimary(withBeaconPrimary(0, 7)), 7);
  equal('生命恢复那一位没被下标写脏', beaconRegen(withBeaconPrimary(0, 7)), false);
}

// ---------------------------------------------------------------- 5. 金字塔与等级

console.log('\n[金字塔：几级、多大范围]');
{
  equal('最多四级（原版）', BEACON_MAX_LEVEL, 4);
  for (let level = 1; level <= 4; level++) {
    const world = makeWorld(buildPyramid(level));
    equal(`${level} 级金字塔认得出来`, beaconLevel(world, 0, 0, 0), level);
  }
  equal('没有底座 → 0 级（不工作）', beaconLevel(makeWorld(buildPyramid(0)), 0, 0, 0), 0);
  equal('那一格不是信标 → 0 级', beaconLevel(makeWorld(new Map([[key(0, 0, 0), Block.STONE]])), 0, 0, 0), 0);

  // 缺一层：只算到缺的那一层的**下面**
  {
    const cells = buildPyramid(4);
    // 把第 3 层（半径 3）挖掉一个角 → 四级降成二级
    cells.delete(key(3, -3, 3));
    equal('第 3 层缺一块 → 降成 2 级', beaconLevel(makeWorld(cells), 0, 0, 0), 2);
  }
  // 最上面那一层（贴着信标的 3×3）缺一块 → 一级都没有
  {
    const cells = buildPyramid(2);
    cells.delete(key(1, -1, 1));
    equal('贴着信标的 3×3 缺一块 → 一级都没有', beaconLevel(makeWorld(cells), 0, 0, 0), 0);
  }
  // 混着摆也算数（原版就是可以混）
  {
    const cells = buildPyramid(1, Block.IRON_BLOCK);
    cells.set(key(1, -1, 1), Block.GOLD_BLOCK);
    cells.set(key(-1, -1, -1), Block.DIAMOND_BLOCK);
    equal('铁块/金块/钻石块混着摆，照样算一级', beaconLevel(makeWorld(cells), 0, 0, 0), 1);
  }
  // 用错方块：石头不行
  {
    const cells = buildPyramid(1, Block.STONE);
    equal('石头摆的"金字塔"不算数', beaconLevel(makeWorld(cells), 0, 0, 0), 0);
  }
  check(
    '底座材料表就是原版那五种（可以混着摆，所以是一张表）',
    BEACON_BASE_BLOCKS.length === 5 &&
      [Block.IRON_BLOCK, Block.GOLD_BLOCK, Block.DIAMOND_BLOCK, Block.EMERALD_BLOCK, Block.NETHERITE_BLOCK].every((id) =>
        BEACON_BASE_BLOCKS.includes(id),
      ),
  );
}

// ---------------------------------------------------------------- 6. 范围与效果

console.log('\n[范围与效果]');
{
  equal('0 级没有范围', beaconRange(0), 0);
  equal('一级 20 格（原版）', beaconRange(1), 20);
  equal('二级 30 格', beaconRange(2), 30);
  equal('三级 40 格', beaconRange(3), 40);
  equal('四级 50 格', beaconRange(4), 50);
  equal('表本身也写对了', `${BEACON_RANGE_BY_LEVEL.join('/')}`, '0/20/30/40/50');

  equal('1~2 级的主效果是 I（amplifier 0）', beaconPrimaryAmplifier(1), 0);
  equal('2 级同样是 I', beaconPrimaryAmplifier(2), 0);
  equal('3 级换成 II（amplifier 1）', beaconPrimaryAmplifier(3), 1);
  equal('4 级也是 II', beaconPrimaryAmplifier(4), 1);

  equal('五条主效果（原版就是这个数）', BEACON_POWERS.length, 5);
  check(
    '主效果就是原版那五条，且顺序固定（顺序 = 方块状态里的下标）',
    BEACON_POWERS.map((power) => power.key).join(',') === 'speed,haste,resistance,jump_boost,strength',
    BEACON_POWERS.map((power) => power.key).join(','),
  );
  // 批次 20261024-0245：`label` 字段删了，按钮文字改由 `effectLabel(power.effect)` 取
  // （复用状态效果的 `label.effect.*`）；所以这里验"每个 power 都有可解析的效果 id"。
  check(
    '每条都有效果 id（按钮文字由 effectLabel() 取）',
    BEACON_POWERS.every((power) => power.effect.length > 0 && effectLabel(power.effect) !== `label.effect.${power.effect}`),
  );
  equal('生命恢复要三级（原版）', BEACON_REGEN_MIN_LEVEL, 3);

  equal('0 级挂不了任何效果', beaconEffects(0, 1, true).length, 0);
  equal('没选主效果 → 什么都不挂', beaconEffects(4, 0, false).length, 0);
  equal('选了"速度" → 一条', beaconEffects(1, 1, false).length, 1);
  equal('挂的是速度', beaconEffects(1, 1, false)[0]?.effect, 'speed');
  equal('一级金字塔给 I 级', beaconEffects(1, 1, false)[0]?.amplifier, 0);
  equal('四级金字塔给 II 级', beaconEffects(4, 1, false)[0]?.amplifier, 1);
  equal('时长按表来（离开范围后还能留一会儿）', beaconEffects(1, 1, false)[0]?.seconds, BEACON_EFFECT_SECONDS);
  equal('二级要生命恢复 → 给不了（原版三级起）', beaconEffects(2, 1, true).length, 1);
  equal('三级要生命恢复 → 给两条', beaconEffects(3, 1, true).length, 2);
  equal('第二条就是生命恢复', beaconEffects(3, 1, true)[1]?.effect, 'regeneration');
  equal('生命恢复永远是 I 级（原版如此）', beaconEffects(4, 1, true)[1]?.amplifier, 0);
  equal('力量那条也在表里（下标 5）', beaconEffects(1, 5, false)[0]?.effect, 'strength');
  equal(
    '三级还选不了次级主效果（原版四级起）',
    beaconEffects(3, 1, false, BEACON_EFFECT_SECONDS, 2).length,
    1,
  );
  equal(
    '四级能再选一条主效果',
    beaconEffects(4, 1, false, BEACON_EFFECT_SECONDS, 2).length,
    2,
  );
  equal(
    '次级那条是急迫、固定 I 级',
    beaconEffects(4, 1, false, BEACON_EFFECT_SECONDS, 2)[1]?.effect,
    'haste',
  );
  equal(
    '次级主效果不会升到 II 级',
    beaconEffects(4, 1, false, BEACON_EFFECT_SECONDS, 2)[1]?.amplifier,
    0,
  );

  equal('文案：没有底座时说的是"没有底座、摆 3×3 才工作"', beaconSummary(0).includes('没有金字塔底座'), true);
  check('文案：有底座时写清了几级与半径', beaconSummary(3).includes('3 级') && beaconSummary(3).includes('40'));
}

console.log(`\n信标测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
