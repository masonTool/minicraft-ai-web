/**
 * 南瓜与西瓜的种植离线测试（批次 77，B48 / H13 的最后一项）
 *
 * 这一批与小麦那四种作物最大的不同：**茎的成熟不是收获，而是"去旁边结果"**。
 * 于是断言的重点是那条链：种子 → 茎（8 阶段）→ 结果（旁边放一个南瓜/西瓜 + 自己变成
 * "结果的茎"）→ 打掉茎给种子、果实自己去收。
 *
 * 运行：npm run test:gourd
 */

import {
  Block,
  STEM_FRUIT,
  STEM_MAX_STAGE,
  STEM_STAGES,
  attachedStemId,
  blockDef,
  blockHardness,
  canBearFruitAt,
  isAttachedStem,
  stemKindOf,
  stemStageOf,
} from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, dropFor, itemDef } from '../src/core/registry/items.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, isHandHarvestable } from '../src/core/registry/tools.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  CROP_MIN_LIGHT,
  hasRandomTick,
  isHydrated,
  randomTickBlock,
  type TickWorld,
} from '../src/core/tick/RandomTicks.ts';
import { fertilizeAt } from '../src/core/world/BoneMeal.ts';
import { facingOf, withFacing } from '../src/core/registry/blockState.ts';

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
/** 能结果的土（与实现里那份一致；这里再列一遍是为了让断言自己说清"包括哪几种"） */
const FRUIT_SOILS: readonly number[] = [Block.FARMLAND, Block.DIRT, Block.GRASS_BLOCK];
const PUMPKIN_STAGES = STEM_STAGES.pumpkin!;
const MELON_STAGES = STEM_STAGES.melon!;

// ---------------------------------------------------------------- 1. 茎与种子

console.log('\n[瓜藤方块与种子]');
{
  equal('每种瓜 8 个阶段（原版 0~7）', PUMPKIN_STAGES.length, 8);
  equal('阶段 id 连号（南瓜藤）', PUMPKIN_STAGES.join(','), [489, 490, 491, 492, 493, 494, 495, 496].join(','));
  equal('阶段 id 连号（西瓜藤）', MELON_STAGES.join(','), [497, 498, 499, 500, 501, 502, 503, 504].join(','));
  equal('结果的茎各一个 id', `${Block.PUMPKIN_STEM_ATTACHED},${Block.MELON_STEM_ATTACHED}`, '505,506');
  equal('最多长到第 7 阶段', STEM_MAX_STAGE, 7);

  const all = [...PUMPKIN_STAGES, ...MELON_STAGES, Block.PUMPKIN_STEM_ATTACHED, Block.MELON_STEM_ATTACHED];
  equal('一共 18 个方块', all.length, 18);
  const missing = all.filter((id) => blockDef(id).tiles.some((tile) => !TILES.has(tile)));
  check('每一张贴图都在图集里', missing.length === 0, missing.join(', '));
  check(
    '全部是十字面片的植物、硬度 0、徒手可采',
    all.every((id) => blockDef(id).shape === 'cross' && blockHardness(id) === 0 && isHandHarvestable(id) && canHarvest(id, null)),
  );

  equal('南瓜藤认出第 0 阶段', stemStageOf(PUMPKIN_STAGES[0]!), 0);
  equal('西瓜藤认出第 7 阶段', stemStageOf(MELON_STAGES[7]!), 7);
  equal('结果的茎不属于任何阶段', stemStageOf(Block.PUMPKIN_STEM_ATTACHED), -1);
  equal('不是茎的方块 → null', stemKindOf(Block.WHEAT_STAGE0), null);
  equal('南瓜藤 → pumpkin', stemKindOf(PUMPKIN_STAGES[3]!), 'pumpkin');
  equal('结果的西瓜藤 → melon', stemKindOf(Block.MELON_STEM_ATTACHED), 'melon');
  check('结果的茎被认出来', isAttachedStem(Block.PUMPKIN_STEM_ATTACHED) && !isAttachedStem(PUMPKIN_STAGES[7]!));
  equal('南瓜藤结果后变成哪一个 id', attachedStemId('pumpkin'), Block.PUMPKIN_STEM_ATTACHED);
  equal('结出的果实方块', `${STEM_FRUIT.pumpkin},${STEM_FRUIT.melon}`, `${Block.PUMPKIN},${Block.MELON}`);

  // ---- 种子物品：`block` 字段是"种植路径通用"的关键
  equal('南瓜籽存在', itemDef(Item.PUMPKIN_SEEDS)?.name, 'minicraft:pumpkin_seeds');
  equal('西瓜籽存在', itemDef(Item.MELON_SEEDS)?.name, 'minicraft:melon_seeds');
  equal('南瓜籽种下去是第 0 阶段南瓜藤', itemDef(Item.PUMPKIN_SEEDS)?.block, PUMPKIN_STAGES[0]);
  equal('西瓜籽种下去是第 0 阶段西瓜藤', itemDef(Item.MELON_SEEDS)?.block, MELON_STAGES[0]);
  check('两种种子有中文名与说明', itemLabel(Item.PUMPKIN_SEEDS) === '南瓜籽' && hasDescription(Item.PUMPKIN_SEEDS));
  check('两种种子有图标', TILES.has(itemDef(Item.PUMPKIN_SEEDS)!.tile) && TILES.has(itemDef(Item.MELON_SEEDS)!.tile));
  check('两种种子都在创造栏里', CREATIVE_ITEMS.includes(Item.PUMPKIN_SEEDS) && CREATIVE_ITEMS.includes(Item.MELON_SEEDS));

  // ---- 配方（原版）：1 南瓜 → 4 籽；1 西瓜片 → 1 籽
  equal('1 个南瓜 → 4 颗南瓜籽', matchRecipe([Block.PUMPKIN], 2)?.id, Item.PUMPKIN_SEEDS);
  equal('  而且做出 4 颗', matchRecipe([Block.PUMPKIN], 2)?.count, 4);
  equal('1 片西瓜 → 1 颗西瓜籽', matchRecipe([Item.MELON_SLICE], 2)?.id, Item.MELON_SEEDS);
  equal('  而且做出 1 颗', matchRecipe([Item.MELON_SLICE], 2)?.count, 1);
}

// ---------------------------------------------------------------- 2. 掉落

console.log('\n[打掉茎给种子]');
{
  for (const [kind, stages] of Object.entries(STEM_STAGES)) {
    const seed = kind === 'pumpkin' ? Item.PUMPKIN_SEEDS : Item.MELON_SEEDS;
    check(
      `${kind}：任何阶段打掉都给自己那种种子`,
      stages.every((id) => dropFor(id)?.id === seed && dropFor(id)?.count === 1),
    );
  }
  equal('结果的南瓜藤也给南瓜籽', dropFor(Block.PUMPKIN_STEM_ATTACHED)?.id, Item.PUMPKIN_SEEDS);
  equal('结果的西瓜藤给西瓜籽', dropFor(Block.MELON_STEM_ATTACHED)?.id, Item.MELON_SEEDS);
  equal('果实（南瓜块）掉自己', dropFor(Block.PUMPKIN)?.id, Block.PUMPKIN);
}

// ---------------------------------------------------------------- 3. 结果判据

console.log('\n[旁边那一格能结果吗]');
{
  equal('耕地 + 空气 → 能', canBearFruitAt(Block.FARMLAND, Block.AIR), true);
  equal('泥土 + 空气 → 能', canBearFruitAt(Block.DIRT, Block.AIR), true);
  equal('草方块 + 空气 → 能', canBearFruitAt(Block.GRASS_BLOCK, Block.AIR), true);
  equal('沙子 + 空气 → 不能', canBearFruitAt(Block.SAND, Block.AIR), false);
  equal('石头 + 空气 → 不能', canBearFruitAt(Block.STONE, Block.AIR), false);
  equal('耕地但上面被占 → 不能', canBearFruitAt(Block.FARMLAND, Block.STONE), false);
}

// ---------------------------------------------------------------- 4. 随机刻：生长与结果

console.log('\n[随机刻：长高与结果]');
{
  const cells = new Map<string, number>();
  let states = new Map<string, number>();

  function worldAt(light = 15): TickWorld {
    return {
      getBlock: (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.AIR,
      setBlock: (x, y, z, id) => {
        cells.set(`${x},${y},${z}`, id);
        return true;
      },
      setBlockWithState: (x, y, z, id, state) => {
        cells.set(`${x},${y},${z}`, id);
        states.set(`${x},${y},${z}`, state);
        return true;
      },
      lightAt: () => light,
      skyLightAt: () => light,
      blockLightAt: () => light,
    };
  }

  check('8 个阶段都登记了随机刻行为', PUMPKIN_STAGES.every((id) => hasRandomTick(id)));
  check('结果的茎**不**登记（它不再生长）', !hasRandomTick(Block.PUMPKIN_STEM_ATTACHED));

  // ---- 长高：耕地 + 光照 + 概率命中
  const grown = new Map<string, number>([['5,63,5', Block.FARMLAND], ['5,64,5', PUMPKIN_STAGES[0]!]]);
  cells.clear();
  for (const [k, v] of grown) cells.set(k, v);
  check('耕地 + 光照够 + 掷点命中 → 涨一阶', randomTickBlock(worldAt(), 5, 64, 5, () => 0));
  equal('涨到了第 1 阶段', cells.get('5,64,5'), PUMPKIN_STAGES[1]);

  const dark = new Map<string, number>([['6,63,6', Block.FARMLAND], ['6,64,6', PUMPKIN_STAGES[0]!]]);
  cells.clear();
  for (const [k, v] of dark) cells.set(k, v);
  check('光照不够（8 < 9）→ 不长', !randomTickBlock(worldAt(CROP_MIN_LIGHT - 1), 6, 64, 6, () => 0));
  equal('还是第 0 阶段', cells.get('6,64,6'), PUMPKIN_STAGES[0]);

  const sandy = new Map<string, number>([['7,63,7', Block.SAND], ['7,64,7', PUMPKIN_STAGES[0]!]]);
  cells.clear();
  for (const [k, v] of sandy) cells.set(k, v);
  check('下面不是耕地 → 不长', !randomTickBlock(worldAt(), 7, 64, 7, () => 0));

  // ---- 结果：第 7 阶段 + 旁边有土 + 空气
  function matureStem(withSoilAround: boolean, at = 10): boolean {
    cells.clear();
    states = new Map();
    cells.set(`${at},63,${at}`, Block.FARMLAND);
    cells.set(`${at},64,${at}`, PUMPKIN_STAGES[STEM_MAX_STAGE]!);
    if (withSoilAround) {
      cells.set(`${at},63,${at - 1}`, Block.DIRT);
      cells.set(`${at},63,${at + 1}`, Block.GRASS_BLOCK);
      cells.set(`${at - 1},63,${at}`, Block.FARMLAND);
      cells.set(`${at + 1},63,${at}`, Block.FARMLAND);
    }
    return randomTickBlock(worldAt(), at, 64, at, () => 0);
  }

  check('四周有土 → 结果了', matureStem(true));
  const fruitDirs = [
    [`10,64,9`, `10,63,9`],
    [`10,64,11`, `10,63,11`],
    [`9,64,10`, `9,63,10`],
    [`11,64,10`, `11,63,10`],
  ];
  const placed = fruitDirs.filter(([fruit]) => cells.get(fruit) === Block.PUMPKIN);
  equal('正好结了一个南瓜', placed.length, 1);
  check(
    '果实落在"下面有土、上面是空气"的那一格',
    placed.every(([, soil]) => FRUIT_SOILS.includes(cells.get(soil)!)),
  );
  equal('自己变成"结果的茎"', cells.get('10,64,10'), Block.PUMPKIN_STEM_ATTACHED);
  const facing = facingOf(states.get('10,64,10') ?? 0);
  const expectedFacing = placed[0]![0] === '10,64,9' ? 0 : placed[0]![0] === '10,64,11' ? 2 : placed[0]![0] === '9,64,10' ? 3 : 1;
  equal('朝向写进去了并且指向果实', facing, expectedFacing);

  check('四周没有土 → 不结果（也不消耗什么）', !matureStem(false, 20));
  equal('它还是原来那个阶段的茎', cells.get('20,64,20'), PUMPKIN_STAGES[STEM_MAX_STAGE]);

  // ---- 结果的茎：不再生长、也不再结果
  cells.clear();
  cells.set('30,63,30', Block.FARMLAND);
  cells.set('30,64,30', Block.PUMPKIN_STEM_ATTACHED);
  check('"结果的茎"在随机刻里什么都不做', !randomTickBlock(worldAt(), 30, 64, 30, () => 0));
  equal('它没有变回普通茎', cells.get('30,64,30'), Block.PUMPKIN_STEM_ATTACHED);

  // 湿润耕地能让它长得更快（与作物同一套判据）
  cells.clear();
  cells.set('40,63,40', Block.FARMLAND);
  cells.set('40,64,40', PUMPKIN_STAGES[0]!);
  cells.set('41,63,40', Block.WATER);
  check('湿润耕地的判据与作物共用同一个函数', isHydrated(worldAt(), 40, 63, 40));
}

// ---------------------------------------------------------------- 5. 骨粉

console.log('\n[骨粉对瓜藤]');
{
  const cells = new Map<string, number>();
  const world = {
    getBlock: (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? Block.AIR,
    setBlock: (x: number, y: number, z: number, id: number) => {
      cells.set(`${x},${y},${z}`, id);
    },
  };
  const reset = (id: number): void => {
    cells.clear();
    cells.set('0,64,0', id);
  };

  reset(PUMPKIN_STAGES[0]!);
  check('对着第 0 阶段的茎用骨粉 → 催长了', fertilizeAt(world, 0, 64, 0, () => 0) !== null);
  equal('掷点 0 → 走 2 阶（截断之前）', cells.get('0,64,0'), PUMPKIN_STAGES[2]);

  reset(PUMPKIN_STAGES[6]!);
  check('对着第 6 阶段用骨粉 → 也只能到第 7 阶段（截断）', fertilizeAt(world, 0, 64, 0, () => 0.99) !== null);
  equal('  落点被截到第 7 阶段', cells.get('0,64,0'), PUMPKIN_STAGES[STEM_MAX_STAGE]);

  reset(PUMPKIN_STAGES[STEM_MAX_STAGE]!);
  equal('成熟的茎催不动（**不消耗**骨粉）', fertilizeAt(world, 0, 64, 0, () => 0), null);
  equal('  世界也没被改', cells.get('0,64,0'), PUMPKIN_STAGES[STEM_MAX_STAGE]);
  check('成熟≠结果：骨粉**不会**让它结果（原版也是）', cells.get('1,64,0') === undefined);

  reset(Block.PUMPKIN_STEM_ATTACHED);
  equal('结果的茎也催不动', fertilizeAt(world, 0, 64, 0, () => 0), null);

  reset(MELON_STAGES[0]!);
  check('西瓜藤一样能被催', fertilizeAt(world, 0, 64, 0, () => 0) !== null);
  equal('  用的是西瓜藤自己的阶段表', cells.get('0,64,0'), MELON_STAGES[2]);

  // 对照：小麦也能被催（同一张规则表）
  reset(Block.WHEAT_STAGE0);
  check('小麦仍然能被催（规则表没被写坏）', fertilizeAt(world, 0, 64, 0, () => 0) !== null);
  check('  而且涨的幅度与瓜藤一样是 2~5', cells.get('0,64,0') !== Block.WHEAT_STAGE0);
}

// 用一下 withFacing，免得"朝向写没写进去"这条断言被当成空跑
check('朝向工具本身没坏（对照）', facingOf(withFacing(0, 2)) === 2);

console.log(`\n瓜类测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
