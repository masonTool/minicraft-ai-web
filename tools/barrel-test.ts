/**
 * 木桶离线测试（批次 61，H14 的第四件容器类功能方块）
 *
 * 木桶是"27 格容器"这条线的**第二个实现**（第一个是箱子），所以这一批的断言重点在
 * "两者哪里一样、哪里必须分开"：
 *
 *  1. **注册与外观**：整格方块（走贪心网格化）、三张面各一张贴图、硬度 2.5、
 *     **斧头更快但徒手也能挖**（与箱子同一档）
 *  2. **容器与存档**：`Barrel extends Chest`（子类）——凡按 `Chest` 判定的地方自动覆盖，
 *     但要**区分**两者的地方（`kindOf`）必须先判子类；另外"被战利品表填过的空箱子也要写"
 *     这条特批**不该**波及木桶（木桶不会出现在结构里）
 *  3. **与箱子真正的差别**：原版**头顶压着挡满光的方块时箱子打不开、木桶照样能开**
 *     （这正是"木桶塞进墙里"的用处）。主程序那条判据吃的是 `lightOpacity`，
 *     所以这里断言"石头挡满光、玻璃与树叶不挡"——判据的输入错了，规则就会误伤
 *  4. **配方**：6 木板 + 上下两个**木板台阶**（与箱子的 8 木板是两条不撞车的配方）
 *
 * 运行：npm run test:barrel
 */

import { Block, SHAPED_PARENTS, blockDef, blockHardness, slabId } from '../src/core/registry/blocks.ts';
import { isFullBlockShape } from '../src/core/registry/blockShapes.ts';
import { Item, categoryOf, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, efficientToolType, harvestRequirement } from '../src/core/registry/tools.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import { BARREL_SIZE, Barrel } from '../src/core/container/Barrel.ts';
import { CHEST_SIZE, Chest } from '../src/core/container/Chest.ts';
import { acceptingSlots, containerSlotCount, peekTake, tryInsertOne } from '../src/core/container/Transfer.ts';
import { BlockEntityStore, CONTAINER_BLOCKS } from '../src/core/world/BlockEntityStore.ts';
import {
  SLOT_COUNTS,
  kindOf,
  restoreContainers,
  serializeContainers,
  type SerializedContainer,
} from '../src/core/save/ContainerSave.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { canPush, isRedstoneComponent } from '../src/core/redstone/RedstoneEngine.ts';
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
const BARREL = Block.BARREL;

function one(id: number, count = 1): { id: number; count: number } {
  return { id, count };
}

// ---------------------------------------------------------------- 1. 注册与外观

console.log('\n[注册与外观]');
{
  equal('方块 id 是 479（接在发射器后面）', BARREL, 479);
  equal('id 紧接在发射器之后（478 → 479）', BARREL, Block.DISPENSER + 1);
  equal('注册名', blockDef(BARREL).name, 'minecraft:barrel');
  equal('中文名', itemLabel(BARREL), '木桶');
  check('有物品说明', hasDescription(BARREL));
  equal('是整格方块（走贪心网格化）', blockDef(BARREL).shape, 'cube');
  check('整格方块不透明', blockDef(BARREL).opaque);
  check('碰撞/渲染都是整格', isFullBlockShape(blockDef(BARREL).shape, 0));

  const tiles = blockDef(BARREL).tiles;
  equal('三张面各用一张贴图（顶/底/侧）', new Set(tiles).size, 3);
  equal('顶面是那张带箍的盖子', tiles[0], 'barrel_top');
  equal('侧面是竖板条 + 铁箍那张', tiles[2], 'barrel_side');
  const missing = tiles.filter((tile) => !TILES.has(tile));
  check('三张贴图都在图集里', missing.length === 0, `缺少 ${missing.join(', ')}`);

  const def = itemDef(BARREL);
  check('有对应的物品', def !== undefined);
  equal('物品指向这个方块', def?.block, BARREL);
  equal('可堆叠 64', maxStackOf(BARREL), 64);
  equal('创造分类是"功能方块"', categoryOf(BARREL), 'functional');
  equal('图标用侧面那张', def?.tile, 'barrel_side');

  equal('硬度 2.5（原版木桶）', blockHardness(BARREL), 2.5);
  equal('斧头更快（进加速表）', efficientToolType(BARREL), 'axe');
  equal('但**不强制**工具（与箱子同一档：徒手也能挖下来）', harvestRequirement(BARREL), undefined);
  check('徒手就能采到', canHarvest(BARREL, null));
  equal('它不是红石元件（原版木桶不吃红石）', isRedstoneComponent(BARREL), false);
}

// ---------------------------------------------------------------- 2. 容器与存档

console.log('\n[容器：27 格，与箱子同一套]');
{
  equal('27 格', BARREL_SIZE, 27);
  equal('与箱子同宽', BARREL_SIZE, CHEST_SIZE);
  const barrel = new Barrel();
  check('木桶**就是**箱子（子类）——按 Chest 判定的地方自动覆盖', barrel instanceof Chest);
  equal('格数被认出来', containerSlotCount(barrel), 27);
  equal('27 格全可塞（漏斗灌得进来）', acceptingSlots(barrel).length, 27);
  equal('种类名跟着方块走', kindOf(barrel), 'barrel');
  equal('箱子还是箱子（子类顺序没写反）', kindOf(new Chest()), 'chest');

  // 与别的容器互通
  const feeder = new Barrel();
  check('漏斗能塞进木桶', tryInsertOne(feeder, one(Block.STONE, 1)));
  equal('进的是第一格', feeder.get(0)?.id, Block.STONE);
  equal('也能从木桶里抽一件', peekTake(feeder)?.slot, 0);

  equal('存档里的格数表认识木桶', SLOT_COUNTS.barrel, BARREL_SIZE);

  // ⚠️ 与箱子那条"掏空的战利品箱也要写"的特批互不干扰
  const store = new BlockEntityStore();
  store.getOrCreateBarrel(Dimension.OVERWORLD, 1, 64, 1).set(5, one(Item.IRON_INGOT, 3));
  const lootedChest = store.getOrCreateChest(Dimension.OVERWORLD, 2, 64, 1);
  lootedChest.looted = true;
  store.getOrCreateBarrel(Dimension.OVERWORLD, 3, 64, 1); // 空木桶

  const data = serializeContainers(store);
  equal('装东西的木桶 + 掏空过的箱子 = 两条', data.length, 2);
  const barrelEntry = data.find((entry) => entry.kind === 'barrel');
  check('木桶的种类写成 barrel（不会与箱子混）', barrelEntry !== undefined);
  equal('写的是那一格里的东西', barrelEntry?.stacks[5]?.count, 3);
  check('空木桶不写（它不是战利品箱，没有那条特批）', data.every((entry) => entry.x !== 3));
  check('掏空过但 looted 的箱子照样写', data.some((entry) => entry.kind === 'chest'));

  const restored = new BlockEntityStore();
  equal('读档还原', restoreContainers(restored, JSON.parse(JSON.stringify(data)) as SerializedContainer[]), 2);
  const back = restored.getBarrel(Dimension.OVERWORLD, 1, 64, 1);
  check('还原出来的是木桶实例', back instanceof Barrel);
  equal('内容对得上', back?.get(5)?.count, 3);
}

// ---------------------------------------------------------------- 3. 与箱子的真正差别

console.log('\n[与箱子的差别：箱子怕压、木桶不怕]');
{
  // 原版：箱子头顶若是"挡满光"的方块就打不开（`ChestBlock#isBlockedChestByBlock`），
  // 木桶没有这条限制。主程序那条判据吃的是 `lightOpacity`，所以判据的**输入**必须对：
  // 用 `opaque` 会把树叶（原版只挡 1 级光）也算成"压住"，那箱子就白挨一刀。
  check(`石头挡满光（${blockDef(Block.STONE).lightOpacity}）`, blockDef(Block.STONE).lightOpacity >= 15);
  check(`木板挡满光（${blockDef(Block.OAK_PLANKS).lightOpacity}）`, blockDef(Block.OAK_PLANKS).lightOpacity >= 15);
  check(`玻璃**不**挡满光（${blockDef(Block.GLASS).lightOpacity}）`, blockDef(Block.GLASS).lightOpacity < 15);
  check(`树叶**不**挡满光（${blockDef(Block.OAK_LEAVES).lightOpacity}）`, blockDef(Block.OAK_LEAVES).lightOpacity < 15);
  check(`空气不挡光（${blockDef(Block.AIR).lightOpacity}）`, blockDef(Block.AIR).lightOpacity < 15);

  // 两者的容器实现完全一样（差别全在"打不打得开"这条方块规则上）
  const barrel = new Barrel();
  const chest = new Chest();
  equal('木桶与箱子的格数一致', containerSlotCount(barrel), containerSlotCount(chest));
  equal('可塞格子数也一致', acceptingSlots(barrel).length, acceptingSlots(chest).length);
}

// ---------------------------------------------------------------- 4. 活塞

console.log('\n[活塞：与箱子一样推不动]');
{
  check('在"活塞推不动"的名单里', CONTAINER_BLOCKS.has(BARREL), true);
  check('活塞推不动木桶（推走会把里面的东西留在原地）', !canPush(BARREL));
  check('活塞照样推不动箱子', !canPush(Block.CHEST));
}

// ---------------------------------------------------------------- 5. 配方

console.log('\n[配方：6 木板 + 2 木板台阶]');
{
  const P = Block.OAK_PLANKS;
  // 橡木木板台阶的 id 由 SHAPED_PARENTS 的顺序算出来（配方里也是这么算的；
  // 这里独立算一遍，顺带验证"配方里的那个 id 真的是橡木台阶"）
  const oakSlab = slabId(SHAPED_PARENTS.findIndex(([, name]) => name === 'oak_planks'));
  check('算出来的橡木台阶 id 就是注册表里那个', itemLabel(oakSlab).includes('橡木') && itemLabel(oakSlab).includes('台阶'));
  const cells = [P, oakSlab, P, P, Block.AIR, P, P, oakSlab, P];
  equal('标准图案做出木桶', matchRecipe(cells, 3)?.id, BARREL);
  equal('做出 1 个', matchRecipe(cells, 3)?.count, 1);
  equal('8 块木板做出的还是箱子（两条配方不撞车）', matchRecipe([P, P, P, P, Block.AIR, P, P, P, P], 3)?.id, Block.CHEST);
  equal(
    '少了下面那个台阶做不出（对照）',
    matchRecipe([P, oakSlab, P, P, Block.AIR, P, P, Block.AIR, P], 3),
    null,
  );
  equal(
    '台阶换成木板 = 8 木板 → 那是箱子，不是木桶',
    matchRecipe([P, P, P, P, Block.AIR, P, P, P, P], 3)?.id,
    Block.CHEST,
  );
}

console.log(`\n木桶测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
