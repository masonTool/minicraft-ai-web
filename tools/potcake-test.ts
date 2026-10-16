/**
 * 蛋糕（能吃的方块）与花盆（种花/取花）离线测试（批次 52）
 *
 * 这一批两件东西的共同点是"**方块本身带一段小状态**"：
 *  - 蛋糕：吃掉的片数写在状态里（0~6，共 7 片），宽度随片数变窄
 *  - 花盆：里面种的是第几种植物写在状态里（0 = 空盆）
 *
 * 要盯住的四条"错了也不报错"的地方：
 *  1. **蛋糕的物品不是食物**——一旦把 cake 登记进 `FOOD_TABLE`，
 *     "手持蛋糕长按"就会啃掉自己，与"放下去大家分着吃"完全不同
 *  2. **宽度与碰撞同源**：蛋糕越吃越小，碰撞盒也必须跟着小（否则"看着空了却撞墙"）
 *  3. **花盆索引是写进存档的**：表只能往后追加，且索引 ↔ 贴图/物品必须一一对上
 *  4. 花盆的**渲染分支**：空盆不能画出植物（`pottedPlantTile(0) === null`）
 *
 * 运行：npm run test:potcake
 */

import {
  BLOCKS,
  Block,
  CAKE_ID,
  FLOWER_POT_ID,
  POTTED_PLANTS,
  blockDef,
  blockHardness,
  flowerPotIndexFor,
  isHandHarvestable,
  pottedPlantItem,
  pottedPlantName,
  pottedPlantTile,
} from '../src/core/registry/blocks.ts';
import {
  CAKE_SLICES,
  cakeBites,
  flowerPotPlant,
  withCakeBites,
  withFlowerPotPlant,
} from '../src/core/registry/blockState.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import {
  CREATIVE_ITEMS,
  Item,
  blockDrops,
  categoryOf,
  dropFor,
  foodInfoById,
  itemDef,
  type DropContext,
} from '../src/core/registry/items.ts';
import { CAKE_SLICE_FOOD, canEat, foodForName, saturationFrom } from '../src/core/registry/food.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
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
const CAKE = Block.CAKE;
const POT = Block.FLOWER_POT;

/** 3×3 网格（合成断言用，'·' 表示空） */
function grid(rows: readonly string[], legend: Record<string, number>): number[] {
  const cells = new Array<number>(9).fill(0);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]!.length; c++) {
      const ch = rows[r]![c]!;
      if (ch === '·') continue;
      cells[r * 3 + c] = legend[ch] ?? 0;
    }
  }
  return cells;
}

// ---------------------------------------------------------------- 1. 注册与形状

console.log('\n[注册与形状]');
{
  equal('蛋糕的注册名', blockDef(CAKE).name, 'minecraft:cake');
  equal('花盆的注册名', blockDef(POT).name, 'minecraft:flower_pot');
  equal('蛋糕与花盆的 id 紧挨着（连着上一批的最后一个）', FLOWER_POT_ID, CAKE_ID + 1);
  equal('蛋糕的中文名', itemLabel(CAKE), '蛋糕');
  equal('花盆的中文名', itemLabel(POT), '花盆');
  check('两件都有说明（"怎么吃""怎么种"要写清楚）', hasDescription(CAKE) && hasDescription(POT));
  check('两件都在创造物品栏里', CREATIVE_ITEMS.includes(CAKE) && CREATIVE_ITEMS.includes(POT));
  equal('蛋糕归"食物"页（它是能吃的方块）', categoryOf(CAKE), 'food');
  equal('花盆归"功能方块"页（右键往里种花）', categoryOf(POT), 'functional');

  equal('蛋糕的形状是 cake（半格高、越吃越窄）', blockDef(CAKE).shape, 'cake');
  equal('花盆的形状是 flower_pot', blockDef(POT).shape, 'flower_pot');
  check('两者都不遮挡邻居', !blockDef(CAKE).opaque && !blockDef(POT).opaque);
  equal('两者都不挡光', blockDef(CAKE).lightOpacity + blockDef(POT).lightOpacity, 0);

  equal('蛋糕硬度 0.5（原版）', blockHardness(CAKE), 0.5);
  equal('花盆硬度 0（一碰就掉）', blockHardness(POT), 0);
  check('两者都徒手可采', isHandHarvestable(CAKE) && isHandHarvestable(POT));

  const tiles = [blockDef(CAKE).tiles, blockDef(POT).tiles].flat();
  check('五张贴图都在图集名单里', tiles.every((tile) => TILES.has(tile)), tiles.filter((t) => !TILES.has(t)).join(' '));
  equal('蛋糕确实是三张（顶面奶油/底面/侧面）', blockDef(CAKE).tiles.length, 3);
}

// ---------------------------------------------------------------- 2. 蛋糕：状态与几何

console.log('\n[蛋糕：7 片，越吃越窄]');
{
  equal('一个蛋糕 7 片（原版）', CAKE_SLICES, 7);

  for (let bites = 0; bites < CAKE_SLICES; bites++) {
    const state = withCakeBites(0, bites);
    if (cakeBites(state) !== bites) check(`吃 ${bites} 片的状态能读回来`, false);
  }
  check('0~6 片的片数都能往返', true);
  equal('片数越界会夹到 7 以内', cakeBites(withCakeBites(0, 99)), CAKE_SLICES - 1);
  equal('负数也会夹到 0', cakeBites(withCakeBites(0, -3)), 0);

  // 宽度：从整格缩到 1/7（吃满 7 片时方块本该消失，留 1/7 只是兜底）
  const full = meshBoxes('cake', 0)[0]!;
  const half = meshBoxes('cake', withCakeBites(0, 3))[0]!;
  const last = meshBoxes('cake', withCakeBites(0, CAKE_SLICES - 1))[0]!;
  equal('没吃过的蛋糕是整格宽', full[3], 1);
  check('吃了一半就窄了一些（剩下靠西的那一端）', half[3]! < full[3]! && half[3]! > 0.5, `实际 ${half[3]}`);
  check('只剩一片时最窄（约 1/7）', last[3]! < 0.2, `实际 ${last[3]}`);
  equal('蛋糕高度是半格（原版）', full[4], 0.5);
  equal('切的那一面固定在 x=0（贴图约定左侧是被切面）', half[0], 0);

  // 碰撞与渲染必须同源：否则"看着吃完了却撞在半格墙上"
  let sameBox = true;
  for (let bites = 0; bites < CAKE_SLICES; bites++) {
    const state = withCakeBites(0, bites);
    const render = meshBoxes('cake', state)[0]!;
    const collide = collisionBoxes('cake', state)[0]!;
    if (render.join(',') !== collide.join(',')) sameBox = false;
  }
  check('7 个阶段的碰撞盒与渲染盒完全一致', sameBox);

  // 蛋糕物品**不是**食物
  equal('cake 不在食物数值表里', foodForName('cake'), undefined);
  equal('蛋糕物品查不到食物信息（长按不会啃掉自己）', foodInfoById(CAKE), undefined);
  equal('一片蛋糕的饥饿点数', CAKE_SLICE_FOOD.hunger, 2);
  equal('饱和度修饰值 0.1（原版）', CAKE_SLICE_FOOD.saturationModifier, 0.1);
  equal('换算成饱和度点数 = 0.4', saturationFrom(CAKE_SLICE_FOOD), 0.4);
  equal('整个蛋糕 7 片一共 14 点饥饿', CAKE_SLICE_FOOD.hunger * CAKE_SLICES, 14);
  check('饥饿满时吃不下（与原版一致）', !canEat(CAKE_SLICE_FOOD, 20, 20));
  check('饥饿没满时吃得下', canEat(CAKE_SLICE_FOOD, 19, 20));
  check('一片蛋糕不能"满了也能吃"（它不是金苹果）', CAKE_SLICE_FOOD.alwaysEdible !== true);
}

// ---------------------------------------------------------------- 3. 花盆：植物表

console.log('\n[花盆：能种什么、索引怎么对上]');
{
  check(`能种 ${POTTED_PLANTS.length} 种植物`, POTTED_PLANTS.length === 18, `实际 ${POTTED_PLANTS.length}`);
  equal('花盆的状态能放下这些（5 位 = 31 种）', POTTED_PLANTS.length <= 31, true);

  // 每一项都要"有物品、有贴图"，否则玩家能拿到却种不进去（或种进去看不见）
  const badItems = POTTED_PLANTS.filter((entry) => itemDef(entry.itemId) === undefined);
  check('表里每个植物都有对应物品', badItems.length === 0, badItems.map((e) => e.name).join(' '));
  const badTiles = POTTED_PLANTS.filter((entry) => !TILES.has(entry.tile));
  check('表里每个植物的贴图都在图集里', badTiles.length === 0, badTiles.map((e) => e.name).join(' '));

  // 索引 ↔ 物品 ↔ 贴图 三向都对得上
  let roundTrip = true;
  for (let i = 0; i < POTTED_PLANTS.length; i++) {
    const entry = POTTED_PLANTS[i]!;
    const index = i + 1;
    if (flowerPotIndexFor(entry.itemId) !== index) roundTrip = false;
    if (pottedPlantItem(index) !== entry.itemId) roundTrip = false;
    if (pottedPlantTile(index) !== entry.tile) roundTrip = false;
    if (pottedPlantName(index) !== entry.name) roundTrip = false;
  }
  check('18 种植物：物品/贴图/名字与索引三向都对得上', roundTrip);
  const dupItems = new Set(POTTED_PLANTS.map((e) => e.itemId)).size;
  equal('表里没有重复物品（同一种植物只能有一行）', dupItems, POTTED_PLANTS.length);

  equal('空盆的索引是 0', flowerPotPlant(0), 0);
  equal('空盆不画植物（渲染分支就是靠这个 null）', pottedPlantTile(0), null);
  equal('空盆名字也是"空盆"', pottedPlantName(0), '空盆');
  equal('石头种不进花盆（返回 0）', flowerPotIndexFor(Block.STONE), 0);
  equal('钻石也种不进花盆', flowerPotIndexFor(Item.DIAMOND), 0);
  check('蒲公英能种进去', flowerPotIndexFor(Block.DANDELION) > 0);
  check('五色珊瑚扇都能种进去（原版 1.13 起花盆能放珊瑚扇）', [459, 460, 461, 462, 463].every((id) => flowerPotIndexFor(id) > 0));
  check('甜浆果丛也能种', flowerPotIndexFor(Block.SWEET_BERRY_BUSH_STAGE3) > 0);
  equal('越界索引取不到贴图（脏存档兜底）', pottedPlantTile(99), null);
  equal('越界索引取不到物品', pottedPlantItem(99), undefined);

  // 状态往返
  for (const plant of [0, 1, 5, 18]) {
    const state = withFlowerPotPlant(0, plant);
    if (flowerPotPlant(state) !== plant) check(`索引 ${plant} 能往返`, false);
  }
  check('索引 0/1/5/18 都能往返', true);
  equal('索引越界夹到 31 以内', flowerPotPlant(withFlowerPotPlant(0, 99)), 31);

  // 花的几何：矮盆（不能是整格，否则穿模）
  const potBox = meshBoxes('flower_pot', 0)[0]!;
  check('盆身只有 6/16 高', potBox[4]! > 0.3 && potBox[4]! < 0.4, `实际 ${potBox[4]}`);
  check('盆身四周内缩（不然看不出是个盆）', potBox[0]! > 0 && potBox[2]! > 0, `实际 ${potBox[0]},${potBox[2]}`);
  equal('盆身有碰撞（能站上去，原版如此）', collisionBoxes('flower_pot', 0).length, 1);
}

// ---------------------------------------------------------------- 4. 放置规则

console.log('\n[放置规则]');
{
  const place = (
    blockId: number,
    target: number,
    below: number,
    normal: readonly [number, number, number] = [0, 1, 0],
  ) =>
    planPlacement({
      blockId,
      normal,
      hitX: 10.5,
      hitY: 64,
      hitZ: 10.5,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy, dz) =>
        dx === 0 && dy === 0 && dz === 0 ? target : dx === 0 && dy === -1 && dz === 0 ? below : Block.AIR,
      hitBlock: below,
      hitState: 0,
    });

  check('蛋糕：放在实心方块上 → 可放', place(CAKE, Block.AIR, Block.STONE) !== null);
  check('蛋糕放下时是"没吃过"的状态', place(CAKE, Block.AIR, Block.STONE)!.state === 0);
  check('蛋糕：悬空（下方是空气）→ 拒绝', place(CAKE, Block.AIR, Block.AIR) === null);
  check('蛋糕：下方是水 → 拒绝', place(CAKE, Block.AIR, Block.WATER) === null);
  check('蛋糕：命中侧面 → 拒绝（半格高，只能往地上放）', place(CAKE, Block.AIR, Block.STONE, [1, 0, 0]) === null);
  check('蛋糕：命中天花板 → 拒绝', place(CAKE, Block.AIR, Block.STONE, [0, -1, 0]) === null);

  check('花盆：放在实心方块上 → 可放', place(POT, Block.AIR, Block.STONE) !== null);
  check('花盆放下时是空盆', flowerPotPlant(place(POT, Block.AIR, Block.STONE)!.state) === 0);
  check('花盆：悬空 → 拒绝', place(POT, Block.AIR, Block.AIR) === null);
  check('花盆：命中侧面 → 拒绝', place(POT, Block.AIR, Block.STONE, [1, 0, 0]) === null);
  check('蛋糕能放在泥土上、也能放在石头上（只要实心）', place(CAKE, Block.AIR, Block.DIRT) !== null);
}

// ---------------------------------------------------------------- 5. 配方与掉落

console.log('\n[配方与掉落]');
{
  // 蛋糕：一排牛奶 + 糖蛋糖 + 一排小麦
  const cake = matchRecipe(
    grid(['MMM', 'SES', 'WWW'], { M: Item.MILK_BUCKET, S: Item.SUGAR, E: Item.EGG, W: Item.WHEAT }),
    3,
  );
  equal('3 牛奶桶 + 2 糖 + 1 蛋 + 3 小麦 → 蛋糕', cake?.id, CAKE);
  equal('一次只出 1 个蛋糕（原版）', cake?.count, 1);
  equal(
    '蛋糕配方**只用牛奶桶**（原版那 3 个桶不退还，换成空桶会白送玩家 3 个桶）',
    matchRecipe(
      grid(['MMM', 'SES', 'WWW'], { M: Item.BUCKET, S: Item.SUGAR, E: Item.EGG, W: Item.WHEAT }),
      3,
    ),
    null,
  );

  // 花盆：3 个红砖摆 V 形
  const pot = matchRecipe(grid(['B·B', '·B·'], { B: Item.BRICK }), 3);
  equal('3 个红砖摆 V 形 → 花盆', pot?.id, POT);
  equal('一次出 1 个（原版）', pot?.count, 1);

  const ctx = (over: Partial<DropContext> = {}): DropContext => ({
    shears: false,
    silkTouch: false,
    fortune: 0,
    doubleSlab: false,
    roll: () => 0.99,
    ...over,
  });
  equal('蛋糕破坏掉自身', blockDrops(CAKE, ctx())?.id, CAKE);
  equal('花盆破坏掉自身', blockDrops(POT, ctx())?.id, POT);
  equal('dropFor 也是自身（两个都必须手工掰）', dropFor(CAKE)?.id === CAKE && dropFor(POT)?.id === POT, true);

  // 花盆里那株植物在破坏时会额外掉（main 的破坏分支；这里验"取回物品"这一半的数据链）
  const planted = withFlowerPotPlant(0, flowerPotIndexFor(Block.POPPY));
  equal('种着虞美人的花盆，取出来给回虞美人', pottedPlantItem(flowerPotPlant(planted)), Block.POPPY);
}

console.log(`\n蛋糕与花盆测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
