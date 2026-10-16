/**
 * 堆肥桶离线测试（批次 70，B43 / H14）
 *
 * 这一批是**骨粉的另一半**：骨粉能把作物催熟，堆肥桶把"没用的作物"变回骨粉，
 * 于是"种地 → 收成 → 堆肥 → 骨粉 → 催熟"这条链闭合了。
 *
 * 断言分五块：
 *  1. **方块与外观**：`shape: 'composter'`（四面板条 + 2/16 桶底，网格与碰撞**同一套**）、
 *     四张贴图、满仓时**顶面**换成"堆肥满仓"；
 *  2. **等级状态位**：0~8 存在低 4 位、越界夹取、不动其它位、`8` 才是"满"；
 *  3. **堆肥表**：档位（0.3/0.5/0.65/0.85/1.0）、每个 id 都指向真东西、不重复登记、
 *     不能堆肥的东西（石头/骨头/骨粉）确实不在表里；
 *  4. **掷骰规则**（`compostStep`）：成功涨一级、**失败也照样吃掉这一件**（等级不变但
 *     返回值不是 null）、满桶不再接受、不能堆肥返回 null（调用方不消耗）；
 *  5. **配方与活塞**：7 个木板台阶、在"活塞推不动"名单里。
 *
 * 运行：npm run test:composter
 */

import {
  Block,
  blockDef,
  blockHardness,
  blockTiles,
} from '../src/core/registry/blocks.ts';
import {
  COMPOSTER_MAX_LEVEL,
  composterLevelOf,
  isComposterReady,
  withComposterLevel,
} from '../src/core/registry/blockState.ts';
import { isFullBlockShape, collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { Item, categoryOf, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, efficientToolType, harvestRequirement } from '../src/core/registry/tools.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { SHAPED_PARENTS, slabId } from '../src/core/registry/blocks.ts';
import { compostChanceFor, compostStep, compostTable } from '../src/core/registry/compost.ts';
import { CONTAINER_BLOCKS } from '../src/core/world/BlockEntityStore.ts';
import { canPush } from '../src/core/redstone/RedstoneEngine.ts';
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

function near(label: string, actual: number, expected: number, tol = 0.03): void {
  check(label, Math.abs(actual - expected) <= tol, `实际 ${actual.toFixed(3)}，期望约 ${expected}`);
}

/** 线性同余随机源：同一序列永远同一结果（统计断言既不飘也不假） */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const COMPOSTER = Block.COMPOSTER;
const TILES = new Set<string>(TILE_ORDER);

// ---------------------------------------------------------------- 1. 方块与外观

console.log('\n[方块与外观]');
{
  // ⚠️ 别断言"它是最后一个方块"（`BLOCKS.length - 1`）：每加一个方块都会红（批次 59 的教训）
  equal('方块 id 紧接在木桶之后（479 → 480）', COMPOSTER, Block.BARREL + 1);
  equal('注册名', blockDef(COMPOSTER).name, 'minecraft:composter');
  equal('中文名', itemLabel(COMPOSTER), '堆肥桶');
  check('有物品说明', hasDescription(COMPOSTER));
  equal('分类是"功能方块"（右键可交互）', categoryOf(COMPOSTER), 'functional');
  equal('图标用桶身那张', itemDef(COMPOSTER)?.tile, 'composter_side');
  equal('可堆叠 64', maxStackOf(COMPOSTER), 64);

  // 形状：不是整格（走逐盒通道），网格与碰撞**同一套**
  equal('形状是 composter', blockDef(COMPOSTER).shape, 'composter');
  check('不是整格方块', !isFullBlockShape('composter', 0));
  const mesh = meshBoxes('composter', 0);
  equal('渲染是 5 个盒子（桶底 + 四壁）', mesh.length, 5);
  equal('碰撞也是同 5 个盒子（桶沿能站、桶里也能站）', collisionBoxes('composter', 0).length, 5);
  equal('第一个盒子是桶底（整格宽、2/16 高）', mesh[0]!.join(','), '0,0,0,1,0.125,1');
  const walls = mesh.slice(1);
  equal('另外四个是四壁', walls.length, 4);
  check('每面壁都只有 2/16 厚（板条）', walls.every((box) => box[3] - box[0] === 0.125 || box[5] - box[2] === 0.125));
  check('四壁都是整格高', walls.every((box) => box[1] === 0 && box[4] === 1));
  check('四壁都从桶底顶面（2/16）开始围', walls.every((box) => box[0] === 0 || box[2] === 0 || box[3] === 1 || box[5] === 1));
  check('顶面是敞口的（没有盖住整格顶面的盒子）', !mesh.some((box) => box[4] === 1 && box[1] === 0 && box[3] - box[0] === 1 && box[5] - box[2] === 1));

  const tiles = blockDef(COMPOSTER).tiles;
  equal('三张贴图：顶/底/侧', new Set(tiles).size, 3);
  equal('顶面是"板条框 + 暗口"那张', tiles[0], 'composter_top');
  equal('桶身是板条 + 铁箍那张', tiles[2], 'composter_side');
  const missing = [...tiles, 'composter_ready'].filter((tile) => !TILES.has(tile));
  check('四张贴图都在图集里', missing.length === 0, missing.join(', '));

  // 满仓：**只换顶面**（桶身与桶底不动）
  const full = blockTiles(COMPOSTER, withComposterLevel(0, COMPOSTER_MAX_LEVEL));
  equal('满了以后顶面换成"堆肥满仓"', full[0], 'composter_ready');
  equal('桶底不变', full[1], tiles[1]);
  equal('桶身不变', full[2], tiles[2]);
  equal('没满时还是暗口那张', blockTiles(COMPOSTER, withComposterLevel(0, 7))[0], 'composter_top');

  equal('硬度 0.6（原版）', blockHardness(COMPOSTER), 0.6);
  equal('斧头更快', efficientToolType(COMPOSTER), 'axe');
  equal('不强制工具（与木桶同一条）', harvestRequirement(COMPOSTER), undefined);
  check('徒手就能采到（漏了这一条它会"挖了什么都不掉"，见批次 62）', canHarvest(COMPOSTER, null));
}

// ---------------------------------------------------------------- 2. 等级状态位

console.log('\n[等级：0~8 存在状态位里]');
{
  equal('满级是 8（原版）', COMPOSTER_MAX_LEVEL, 8);
  equal('默认状态等级 0', composterLevelOf(0), 0);
  for (let level = 0; level <= COMPOSTER_MAX_LEVEL; level++) {
    equal(`等级 ${level} 写得进读得出`, composterLevelOf(withComposterLevel(0, level)), level);
  }
  equal('超过满级 → 夹到 8（不是掩码上限 15）', composterLevelOf(withComposterLevel(0, 99)), 8);
  equal('负数 → 夹到 0', composterLevelOf(withComposterLevel(0, -3)), 0);
  equal('小数 → 向下取整', composterLevelOf(withComposterLevel(0, 3.9)), 3);

  // 只动低 4 位（高位是别的形状族在用，绝不能碰）
  const high = 0b10000;
  equal('写等级不会碰高位', withComposterLevel(high, 5), high | 5);
  equal('读等级也不会把高位算进来', composterLevelOf(high | 5), 5);

  check('7 级还不算满', !isComposterReady(withComposterLevel(0, 7)));
  check('8 级才满', isComposterReady(withComposterLevel(0, 8)));
}

// ---------------------------------------------------------------- 3. 堆肥表

console.log('\n[堆肥表：什么能扔、几分概率]');
{
  const table = compostTable();
  equal('分五档', table.length, 5);
  equal('档位是 0.3 / 0.5 / 0.65 / 0.85 / 1', table.map(([chance]) => chance).join(','), '0.3,0.5,0.65,0.85,1');

  const all = table.flatMap(([, list]) => list);
  check(`表里一共 ${all.length} 件东西`, all.length >= 25);
  equal('没有重复登记（同一件东西只出现在一档里）', new Set(all).size, all.length);
  const dangling = all.filter((itemId) => itemDef(itemId) === undefined);
  check('表里没有指向不存在物品的条目', dangling.length === 0, dangling.join(', '));
  const badChance = all.filter((itemId) => {
    const chance = compostChanceFor(itemId) ?? 0;
    return chance <= 0 || chance > 1;
  });
  check('每件的概率都在 (0, 1] 内', badChance.length === 0, badChance.join(', '));

  // 档位关系（原版的分法：种子最低、熟食更高、成品必涨）
  equal('小麦种子是最低档（0.3）', compostChanceFor(Item.WHEAT_SEEDS), 0.3);
  equal('甜菜种子同档', compostChanceFor(Item.BEETROOT_SEEDS), 0.3);
  equal('成熟作物一档（0.65）', compostChanceFor(Item.WHEAT), 0.65);
  for (const [name, itemId] of [
    ['胡萝卜', Item.CARROT],
    ['马铃薯', Item.POTATO],
    ['甜菜根', Item.BEETROOT],
    ['苹果', Item.APPLE],
    ['西瓜片', Item.MELON_SLICE],
    ['甜浆果', Item.SWEET_BERRIES],
    ['可可豆', Item.COCOA_BEANS],
    ['南瓜', Block.PUMPKIN],
    ['仙人掌', Block.CACTUS],
    ['甘蔗', Block.SUGAR_CANE],
    ['蒲公英', Block.DANDELION],
    ['红蘑菇', Block.RED_MUSHROOM],
    ['海带', Block.KELP],
  ] as const) {
    equal(`${name}也在 0.65 那一档`, compostChanceFor(itemId), 0.65);
  }
  equal('面包高一档（0.85）', compostChanceFor(Item.BREAD), 0.85);
  equal('曲奇同档', compostChanceFor(Item.COOKIE), 0.85);
  equal('烤马铃薯同档', compostChanceFor(Item.BAKED_POTATO), 0.85);
  equal('蛋糕是必涨那一档', compostChanceFor(Block.CAKE), 1);
  equal('蘑菇煲也是', compostChanceFor(Item.MUSHROOM_STEW), 1);
  equal('干海带在中间那档（0.5）', compostChanceFor(Item.DRIED_KELP), 0.5);

  equal('石头不能堆肥', compostChanceFor(Block.STONE), undefined);
  equal('钻石不能堆肥', compostChanceFor(Item.DIAMOND), undefined);
  equal('骨头不能堆肥（原版也是）', compostChanceFor(Item.BONE), undefined);
  equal('骨粉也不能堆肥（否则能无限刷）', compostChanceFor(Item.BONE_MEAL), undefined);
  equal('腐肉不能堆肥（原版不在表里）', compostChanceFor(Item.ROTTEN_FLESH), undefined);
}

// ---------------------------------------------------------------- 4. 掷骰规则

console.log('\n[掷骰：成功涨一级、失败也照样吃掉这一件]');
{
  // 必涨档
  equal('蛋糕扔进去必涨一级', compostStep(0, Block.CAKE, () => 0.999), 1);
  // 边界：`random() >= chance` 算失败（原版是 `nextFloat() < chance` 才算成功）
  equal('0.3 档：掷到 0.29 涨一级', compostStep(0, Item.WHEAT_SEEDS, () => 0.29), 1);
  equal('0.3 档：掷到 0.3 整算失败', compostStep(0, Item.WHEAT_SEEDS, () => 0.3), 0);
  equal('0.3 档：掷到 0.31 失败', compostStep(0, Item.WHEAT_SEEDS, () => 0.31), 0);
  check(
    '失败时返回的是**等级本身**（不是 null）——调用方据此照样吃掉这一件',
    compostStep(3, Item.WHEAT_SEEDS, () => 0.99) === 3,
  );

  // 夹取与满桶
  equal('7 级再涨一级 → 8（满）', compostStep(7, Block.CAKE, () => 0), 8);
  equal('已经满了 → null（什么都不接受）', compostStep(8, Block.CAKE, () => 0), null);
  equal('满了时连"必涨档"也不接受', compostStep(8, Item.MUSHROOM_STEW, () => 0), null);

  // 不能堆肥 → null（调用方**不消耗**）
  equal('不能堆肥的东西 → null', compostStep(0, Block.STONE, () => 0), null);
  equal('骨头 → null', compostStep(0, Item.BONE, () => 0), null);
  equal('骨粉 → null（不然能自己喂自己）', compostStep(0, Item.BONE_MEAL, () => 0), null);

  // 概率统计（同一序列永远同一结果）
  const random = lcg(20261016);
  const rate = (itemId: number, level: number, rounds: number): number => {
    let grew = 0;
    let current = level;
    for (let i = 0; i < rounds; i++) {
      const next = compostStep(current, itemId, random);
      if (next !== null && next > current) grew++;
      if (next !== null) current = next >= COMPOSTER_MAX_LEVEL ? 0 : next;
    }
    return grew / rounds;
  };
  near('0.3 档 4000 次的成功率约 30%', rate(Item.WHEAT_SEEDS, 0, 4000), 0.3);
  near('0.5 档约 50%', rate(Item.DRIED_KELP, 0, 4000), 0.5);
  near('0.65 档约 65%', rate(Item.WHEAT, 0, 4000), 0.65);
  near('0.85 档约 85%', rate(Item.BREAD, 0, 4000), 0.85);
  equal('1.0 档每次都涨', rate(Item.MUSHROOM_STEW, 0, 500), 1);

  // 攒满一桶要几次（手感对照：0.65 档平均约 12 次）
  const random2 = lcg(777);
  let uses = 0;
  let level = 0;
  while (level < COMPOSTER_MAX_LEVEL && uses < 500) {
    const next = compostStep(level, Item.WHEAT, random2);
    if (next !== null && next > level) level = next;
    uses++;
  }
  equal('拿小麦反复喂，攒满一桶', level, COMPOSTER_MAX_LEVEL);
  check(`攒满用了 ${uses} 次（0.65 档理论期望约 12 次）`, uses >= 4 && uses <= 30, `${uses}`);
}

// ---------------------------------------------------------------- 5. 配方与活塞

console.log('\n[配方与活塞]');
{
  const OAK_SLAB = slabId(SHAPED_PARENTS.findIndex(([, name]) => name === 'oak_planks'));
  const S = OAK_SLAB;
  equal('7 个木板台阶（围一圈、中间空）→ 1 个堆肥桶', matchRecipe([S, S, S, S, Block.AIR, S, S, S, S], 3)?.id, COMPOSTER);
  equal('做出 1 个', matchRecipe([S, S, S, S, Block.AIR, S, S, S, S], 3)?.count, 1);
  equal('少一个台阶就合不出来（对照）', matchRecipe([S, S, S, S, Block.AIR, S, S, S, Block.AIR], 3), null);
  equal('用 8 块木板合不出堆肥桶（原版要的是台阶）', matchRecipe([Block.OAK_PLANKS, Block.OAK_PLANKS, Block.OAK_PLANKS, Block.OAK_PLANKS, Block.AIR, Block.OAK_PLANKS, Block.OAK_PLANKS, Block.OAK_PLANKS, Block.OAK_PLANKS], 3)?.id, Block.CHEST);

  check('在"活塞推不动"的名单里', CONTAINER_BLOCKS.has(COMPOSTER));
  check('活塞推不动堆肥桶', !canPush(COMPOSTER));
}

console.log(`\n堆肥桶测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
