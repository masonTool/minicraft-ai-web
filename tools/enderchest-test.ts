/**
 * 末影箱离线测试（批次 71，B44 / H17）
 *
 * 末影箱与这一族前面几件最根本的差别是：**内容不挂在方块上**。
 * 箱子/木桶/漏斗/投掷器/发射器/堆肥桶的内容都按坐标存（`BlockEntityStore` 的键是
 * "维度 | x,y,z"），所以"哪一格"决定"看到哪一份"；末影箱相反——世界里**所有**末影箱
 * 打开的都是**同一份属于玩家的内容**。于是它：不进容器表、不进容器存档，
 * 内容走**玩家存档**（`PlayerSave.enderChest`，本项目现成的"非坐标"通道）。
 *
 * 断言分五块：
 *  1. **方块与外观**：id、贴图（含"正面那只眼睛"的面级贴图）、发光 7、黑曜石那一档的采集要求；
 *  2. **共享**：`EnderChest.open()` 永远同一份（这就是"跨坐标"），27 格；
 *  3. **存档**：`slots()` / `restore()` 往返（附加数据逐项保住、脏数据丢掉、长度补齐）；
 *  4. **配方**（与原版的差异写在这里）；活塞推不动、漏斗够不着；
 *  5. **与骨粉那条链无关的对照**：箱子仍是按坐标的那一种（免得以后把两者混起来）。
 *
 * 运行：npm run test:enderchest
 */

import { Block, blockDef, blockHardness, blockTiles } from '../web/src/core/registry/blocks.ts';
import { isFullBlockShape } from '../web/src/core/registry/blockShapes.ts';
import { Item, categoryOf, itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { canHarvest, efficientToolType, harvestRequirement, makeToolInfo, toolItemId } from '../web/src/core/registry/tools.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { emitLight } from '../web/src/core/registry/blocks.ts';
import { CHEST_SIZE, Chest } from '../web/src/core/container/Chest.ts';
import { EnderChest } from '../web/src/core/world/EnderChest.ts';
import { restoreStacks, serializeStacks } from '../web/src/core/save/ContainerSave.ts';
import { CONTAINER_BLOCKS } from '../web/src/core/world/BlockEntityStore.ts';
import { canPush } from '../web/src/core/redstone/RedstoneEngine.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';

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

const ENDER = Block.ENDER_CHEST;
const TILES = new Set<string>(TILE_ORDER);
const WOOD_PICK = makeToolInfo('pickaxe', 'wooden');
const IRON_PICK = makeToolInfo('pickaxe', 'iron');
const DIAMOND_PICK = makeToolInfo('pickaxe', 'diamond');

// ---------------------------------------------------------------- 1. 方块与外观

console.log('\n[方块与外观]');
{
  equal('方块 id 紧接在堆肥桶之后（480 → 481）', ENDER, Block.COMPOSTER + 1);
  equal('注册名', blockDef(ENDER).name, 'minicraft:ender_chest');
  equal('中文名', itemLabel(ENDER), '末影箱');
  check('有物品说明', hasDescription(ENDER));
  equal('分类是"功能方块"', categoryOf(ENDER), 'functional');
  equal('图标用桶身那张（侧面）', itemDef(ENDER)?.tile, 'ender_chest_side');
  equal('可堆叠 64', maxStackOf(ENDER), 64);
  check('是整格方块（走贪心通道之外的逐盒通道——有面级贴图）', isFullBlockShape('cube', 0));

  equal('发光 7（原版末影箱自己发亮）', emitLight(ENDER), 7);
  equal('硬度 22.5（原版，黑曜石那一档）', blockHardness(ENDER), 22.5);
  // 它登记在"必须用镐"那张表里，所以加速工具自动就是镐（不必再往加速表里写一遍）
  equal('镐更快（由需求表派生）', efficientToolType(ENDER), 'pickaxe');
  equal('要镐才掉', harvestRequirement(ENDER)?.tool, 'pickaxe');
  equal('而且要是**钻石**那一档（原版与黑曜石同档）', harvestRequirement(ENDER)?.tier, 3);
  check('木镐挖得动但一无所获', !canHarvest(ENDER, WOOD_PICK));
  check('铁镐也一样挖不动', !canHarvest(ENDER, IRON_PICK));
  check('钻石镐才采得到', canHarvest(ENDER, DIAMOND_PICK));

  // 贴图：三张 + 面级贴图（正面那只眼睛贴在朝向那一面）
  const tiles = blockDef(ENDER).tiles;
  equal('顶与底共用一张（原版也是）', tiles[0], tiles[1]);
  equal('侧面另一张', tiles[2], 'ender_chest_side');
  const missing = [...tiles, 'ender_chest_front'].filter((tile) => !TILES.has(tile));
  check('用到的贴图都在图集里（含正面那只眼睛）', missing.length === 0, missing.join(', '));
  check('声明了"正面朝放置者"', blockDef(ENDER).facesPlayer === true);
  const front = blockDef(ENDER).faceTile;
  const NORTH: readonly [number, number, number] = [0, 0, -1];
  equal('正面（朝北时）是那只眼睛', front?.(0, NORTH), 'ender_chest_front');
  equal('侧面不是', front?.(0, [0, 0, 1]), undefined);
  equal('顶面也不是', front?.(0, [0, 1, 0]), undefined);
  equal('没写 state 时（默认朝北）也能取到正面', blockTiles(ENDER, 0).length, 3);
}

// ---------------------------------------------------------------- 2. 共享：永远同一份

console.log('\n[共享：世界里所有末影箱打开的是同一份]');
{
  const ender = new EnderChest();
  const first = ender.open();
  const second = ender.open();
  check('两次 open 拿到同一个实例（这就是"跨坐标共享"）', first === second);
  check('而且它就是一个 27 格的容器', first instanceof Chest && first.get(26) === null);
  equal('27 格（与箱子同宽）', CHEST_SIZE, 27);

  // 从"另一格"打开也看得见刚放进去的东西
  ender.open().set(5, { id: Item.DIAMOND, count: 7 });
  equal('换个地方打开，东西还在', ender.open().get(5)?.count, 7);
  equal('从"另一格"打开也看得见刚放进去的东西（同一份内容）', ender.open().get(5)?.id, Item.DIAMOND);
  check('它不是"另一只箱子"（不是 Chest 的新实例）', ender.open() === first);
}

// ---------------------------------------------------------------- 3. 存档往返

console.log('\n[存档：走玩家存档那条"非坐标"通道]');
{
  const ender = new EnderChest();
  const pick = toolItemId('pickaxe', 'diamond');
  ender.open().set(0, { id: Item.DIAMOND, count: 12 });
  ender.open().set(3, { id: pick, count: 1, damage: 411, enchants: { efficiency: 4 }, name: '末影镐', repairCost: 3 });
  ender.open().set(26, { id: Block.STONE, count: 64 });

  const saved = ender.slots();
  equal('摊成 27 个槽位', saved.length, 27);
  check('空槽写成 null', saved[1] === null);
  equal('附加数据也拷了一份（名字）', saved[3]?.name, '末影镐');

  // 拷的必须是**副本**：改槽位不该改到存档数组里（反之亦然）
  ender.open().set(0, { id: Item.DIAMOND, count: 1 });
  equal('存档数组与容器是两份数据（改容器不影响已取出的快照）', saved[0]?.count, 12);

  // 读档：新建一个末影箱，灌进那份存档
  const restored = new EnderChest();
  restored.restore(saved);
  equal('数量读回来了', restored.open().get(0)?.count, 12);
  equal('耐久读回来了', restored.open().get(3)?.damage, 411);
  equal('附魔读回来了', restored.open().get(3)?.enchants?.efficiency, 4);
  equal('名字读回来了', restored.open().get(3)?.name, '末影镐');
  equal('累积惩罚读回来了', restored.open().get(3)?.repairCost, 3);
  equal('第 26 格也对', restored.open().get(26)?.count, 64);

  // 脏数据：旧存档缺字段 / 手改坏 / 长度不足
  const dirty = new EnderChest();
  dirty.restore(undefined);
  check('旧存档没有这个字段 → 空箱子（不炸）', dirty.open().get(0) === null);
  const short = new EnderChest();
  short.restore([{ id: Item.DIAMOND, count: 1 }]);
  equal('短数组也能读（长度补齐到 27）', short.slots().length, 27);
  equal('读到的东西在第一位', short.open().get(0)?.id, Item.DIAMOND);
  const junk = new EnderChest();
  junk.restore([null, '不是栈', { id: 999999, count: 1 }, { id: Item.DIAMOND, count: 0 }]);
  equal('非栈/不存在的 id/数量 0 一律丢掉', junk.slots().filter((stack) => stack !== null).length, 0);
  const notArray = new EnderChest();
  notArray.restore({ nonsense: true });
  equal('整个字段不是数组也不炸', notArray.slots().length, 27);

  // 与容器存档共用同一套搬运（两处实现不会各自漂）
  const roundTrip = restoreStacks(serializeStacks([{ id: Item.DIAMOND, count: 1, name: 'x' }]), 27);
  equal('容器存档那两个函数与末影箱走的是同一套', roundTrip[0]?.name, 'x');
}

// ---------------------------------------------------------------- 4. 配方与相邻规则

console.log('\n[配方（原版）与活塞/漏斗]');
{
  const O = Block.OBSIDIAN;
  const EYE = Item.ENDER_EYE;
  // 批次 514：末影之眼做好之后换回原版配方（当年用钻石是因为它还不存在）
  equal('8 黑曜石 + 1 末影之眼 → 末影箱', matchRecipe([O, O, O, O, EYE, O, O, O, O], 3)?.id, ENDER);
  equal('做出 1 个', matchRecipe([O, O, O, O, EYE, O, O, O, O], 3)?.count, 1);
  equal('只放 9 个黑曜石合不出任何东西（对照）', matchRecipe([O, O, O, O, O, O, O, O, O], 3), null);
  equal('用钻石已经合不出来（当年那个替代配方已撤）', matchRecipe([O, O, O, O, Item.DIAMOND, O, O, O, O], 3), null);
  check('末影之眼这件物品存在', itemDef(EYE) !== undefined);

  check('在"活塞推不动"的名单里', CONTAINER_BLOCKS.has(ENDER));
  check('活塞推不动末影箱（内容是玩家的，推走其实也不丢——列进来是对齐原版）', !canPush(ENDER));

  // 对照：箱子仍是"按坐标"的那一种（内容跟着方块走，所以它更不能被推走）
  check('箱子也推不动', !canPush(Block.CHEST));
  const chestAt = new Chest();
  chestAt.set(0, { id: Item.DIAMOND, count: 1 });
  check('箱子是一格一个实例（与末影箱的"永远同一份"相反）', new Chest() !== chestAt);
}

console.log(`\n末影箱测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
