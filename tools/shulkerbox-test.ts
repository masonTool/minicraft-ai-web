/**
 * 潜影盒离线测试（批次 72，B45 / H17 的最后一件）
 *
 * 这一件是"**内容物跟着物品走**"的第一块试金石：箱子/木桶/末影箱的内容都住在方块上，
 * 潜影盒**挖下来时把内容一起带走**（装进掉落的物品里）、**放下时再倒回方块**。
 * 于是它同时压到了三条已有的通道：
 *  - 批次 63 的"物品携带附加数据"（`stackExtras` / `DroppedExtras` / `addStack`）；
 *  - 批次 63 的"掉落物带整份栈"（挖下来 → 掉在地上 → 捡起来，内容不能丢）；
 *  - 批次 71 的"容器存档共用的一套槽位读写"（`serializeStacks` / `restoreStacks`）。
 *
 * 断言分五块：方块与外观 / 容器与存档 / 内容跟物品走（两个口 + 深拷）/
 * 合并判定（装了不同东西**不能并堆**）/ 配方与相邻规则。
 *
 * 运行：npm run test:shulkerbox
 */

import { Block, blockDef, blockHardness } from '../src/core/registry/blocks.ts';
import { isFullBlockShape } from '../src/core/registry/blockShapes.ts';
import {
  CHEST_SIZE,
  Chest,
} from '../src/core/container/Chest.ts';
import {
  SHULKER_BOX_SIZE,
  ShulkerBox,
  fillShulkerBox,
  shulkerContentsOf,
} from '../src/core/container/ShulkerBox.ts';
import { Item, categoryOf, itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { canHarvest, harvestRequirement, makeToolInfo } from '../src/core/registry/tools.ts';
import { copyContents, sameStack, stackExtras, Inventory } from '../src/core/container/Inventory.ts';
import { acceptingSlots, containerSlotCount, peekTake, tryInsertOne } from '../src/core/container/Transfer.ts';
import { matchRecipe } from '../src/core/crafting/Recipes.ts';
import {
  SLOT_COUNTS,
  kindOf,
  restoreContainers,
  serializeContainers,
  type SerializedContainer,
} from '../src/core/save/ContainerSave.ts';
import { BlockEntityStore, CONTAINER_BLOCKS } from '../src/core/world/BlockEntityStore.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { canPush } from '../src/core/redstone/RedstoneEngine.ts';
import { ItemEntity } from '../src/core/entity/ItemEntity.ts';
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

const BOX = Block.SHULKER_BOX;
const TILES = new Set<string>(TILE_ORDER);
const WOOD_PICK = makeToolInfo('pickaxe', 'wooden');

/** 一件物品 */
function one(id: number, count = 1): { id: number; count: number } {
  return { id, count };
}

// ---------------------------------------------------------------- 1. 方块与外观

console.log('\n[方块与外观]');
{
  equal('方块 id 紧接在末影箱之后（481 → 482）', BOX, Block.ENDER_CHEST + 1);
  equal('注册名', blockDef(BOX).name, 'minecraft:shulker_box');
  equal('中文名', itemLabel(BOX), '潜影盒');
  check('有物品说明', hasDescription(BOX));
  equal('分类是"功能方块"', categoryOf(BOX), 'functional');
  equal('图标用侧面那张', itemDef(BOX)?.tile, 'shulker_side');
  equal('可堆叠 64（原版潜影盒也能堆 64）', maxStackOf(BOX), 64);
  check('整格方块', isFullBlockShape('cube', 0));

  const tiles = blockDef(BOX).tiles;
  equal('三张贴图：顶/底/侧', new Set(tiles).size, 3);
  const missing = tiles.filter((tile) => !TILES.has(tile));
  check('三张贴图都在图集里', missing.length === 0, missing.join(', '));

  equal('硬度 2（原版）', blockHardness(BOX), 2);
  equal('要镐才掉', harvestRequirement(BOX)?.tool, 'pickaxe');
  equal('木质镐就够（与黑曜石那档不同）', harvestRequirement(BOX)?.tier, 0);
  check('木镐采得到', canHarvest(BOX, WOOD_PICK));
  check('徒手挖得动但一无所获', !canHarvest(BOX, null));
}

// ---------------------------------------------------------------- 2. 容器与存档

console.log('\n[容器：27 格，与箱子同一套]');
{
  const box = new ShulkerBox();
  equal('27 格', SHULKER_BOX_SIZE, CHEST_SIZE);
  check('潜影盒**就是**箱子（子类）——按 Chest 判定的地方自动覆盖', box instanceof Chest);
  equal('格数被认出来', containerSlotCount(box), 27);
  equal('27 格全可塞（漏斗灌得进来，与原版一致）', acceptingSlots(box).length, 27);
  equal('种类名跟着方块走', kindOf(box), 'shulker_box');
  equal('箱子还是箱子（子类顺序没写反）', kindOf(new Chest()), 'chest');
  equal('存档里的格数表认识潜影盒', SLOT_COUNTS.shulker_box, SHULKER_BOX_SIZE);
  equal('⚠️ 而且这个数不能是 undefined（模块互相 import 时读对方顶层 const 会踩到，批次 58/72 各一次）', SLOT_COUNTS.shulker_box, CHEST_SIZE);

  const feeder = new ShulkerBox();
  check('漏斗塞得进潜影盒', tryInsertOne(feeder, one(Block.STONE)));
  equal('也能从它里面抽一件', peekTake(feeder)?.slot, 0);

  const store = new BlockEntityStore();
  store.getOrCreateShulkerBox(Dimension.OVERWORLD, 3, 64, 3).set(4, one(Item.DIAMOND, 5));
  const data = serializeContainers(store);
  const entry = data.find((item) => item.kind === 'shulker_box');
  check('种类写成 shulker_box（不会与箱子/木桶混）', entry !== undefined);
  equal('内容也写下来了', entry?.stacks[4]?.count, 5);

  const restored = new BlockEntityStore();
  restoreContainers(restored, JSON.parse(JSON.stringify(data)) as SerializedContainer[]);
  const back = restored.getShulkerBox(Dimension.OVERWORLD, 3, 64, 3);
  check('读档还原出来的是潜影盒实例', back instanceof ShulkerBox);
  equal('内容对得上', back?.get(4)?.count, 5);
}

// ---------------------------------------------------------------- 3. 内容跟着物品走

console.log('\n[内容跟着物品走：挖下来带走、放下倒回来]');
{
  // ---- 挖下来：容器的内容 → 物品的 contents
  const box = new ShulkerBox();
  box.set(0, one(Item.DIAMOND, 12));
  box.set(7, { id: Item.IRON_INGOT, count: 3, name: '备用料', repairCost: 2 });
  const contents = shulkerContentsOf(box);
  equal('摊成 27 格', contents.length, 27);
  equal('数量带出来了', contents[0]?.count, 12);
  equal('附加数据（改名）也带出来了', contents[7]?.name, '备用料');
  equal('空槽是 null', contents[1], null);

  // 快照是副本：之后改盒子不该改到已经取出的那份
  box.set(0, one(Item.DIAMOND, 1));
  equal('取出的那份是副本（改盒子不影响它）', contents[0]?.count, 12);

  // ---- 放下：物品的 contents → 容器的格子
  const fresh = new ShulkerBox();
  fillShulkerBox(fresh, contents);
  equal('内容倒回来了', fresh.get(0)?.count, 12);
  equal('改名的那份也回来了', fresh.get(7)?.name, '备用料');
  equal('累积惩罚也还在', fresh.get(7)?.repairCost, 2);

  // ---- 宽容：没有容器 / 脏数据都不该炸
  const empty = shulkerContentsOf(undefined);
  equal('容器表里没有这一格时给全空（而不是抛错）', empty.filter((stack) => stack !== null).length, 0);
  const junk = new ShulkerBox();
  fillShulkerBox(junk, { nonsense: true });
  equal('contents 不是数组时当空盒子', junk.get(0), null);
  const dirty = new ShulkerBox();
  fillShulkerBox(dirty, [null, '不是栈', { id: 999999, count: 1 }, { id: Item.DIAMOND, count: 0 }]);
  equal('脏数据一律丢掉', dirty.get(0), null);
  const short = new ShulkerBox();
  fillShulkerBox(short, [one(Item.DIAMOND, 1)]);
  equal('短数组也读得进（长度补齐）', short.get(0)?.id, Item.DIAMOND);
  equal('补出来的格子是空的', short.get(20), null);

  // ---- 端到端：物品里带着内容 → 掉在地上（实体）→ 捡起来还带着
  const carried = { id: BOX, count: 1, contents };
  const entity = new ItemEntity(BOX, 1, 0, 64, 0, { x: 0, y: 0, z: 0 }, { contents });
  const stack = entity.toStack();
  check('掉落物实体把内容也带上了（挖下来掉在地上那一份）', stack.contents !== undefined);
  equal('内容里的数量对', stack.contents?.[0]?.count, 12);

  // 捡起来：进背包时内容要一起进（走 addStack）
  const inventory = new Inventory();
  equal('全部收下', inventory.addStack(carried), 0);
  equal('背包里那一份带着内容', inventory.get(0)?.contents?.[0]?.count, 12);

  // 存档：内容物也要一路存下来（否则"背包里存着盒子、重进游戏空了"）
  const serialized = inventory.serialize();
  const slot = serialized[0] as { contents?: unknown } | null;
  check('背包存档里带着内容字段', slot?.contents !== undefined);
  const restoredInventory = new Inventory();
  restoredInventory.restore(serialized);
  equal('读档后内容还在', restoredInventory.get(0)?.contents?.[0]?.count, 12);
}

// ---------------------------------------------------------------- 4. 合并与比较

console.log('\n[合并：装了不同东西的盒子不能并堆]');
{
  const a = { id: BOX, count: 1, contents: [one(Item.DIAMOND, 1)] };
  const b = { id: BOX, count: 1, contents: [one(Item.DIAMOND, 2)] };
  const aTwin = { id: BOX, count: 1, contents: [one(Item.DIAMOND, 1)] };
  const emptyBox = { id: BOX, count: 1 };
  const emptyBox2 = { id: BOX, count: 1 };

  check('内容不同的两个盒子**不是**同一件东西（不能并堆）', !sameStack(a, b));
  check('内容一样的就是同一件东西（可以并堆）', sameStack(a, aTwin));
  check('"空盒子"与"装了东西的盒子"也不是同一件', !sameStack(a, emptyBox));
  check('两个空盒子是同一件', sameStack(emptyBox, emptyBox2));

  const target = new ShulkerBox();
  target.set(0, { id: BOX, count: 1, contents: [one(Item.DIAMOND, 1)] });
  equal('工具箱往盒子里塞"内容不同的盒子"时不会并堆', tryInsertOne(target, { id: BOX, count: 1, contents: [one(Item.DIAMOND, 9)] }), true);
  equal(
    '占用的是另一格',
    [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((slot) => target.get(slot) !== null).length,
    2,
  );
  equal('第一格的内容没被改', target.get(0)?.contents?.[0]?.count, 1);

  // 深拷：`stackExtras` 走的是 copyContents，改副本不该影响原件
  const original = { id: BOX, count: 1, contents: [one(Item.DIAMOND, 1)] };
  const extras = stackExtras(original);
  const copied = copyContents(original.contents);
  original.contents[0]!.count = 42;
  equal('拷出来的那份不受原件改动影响', copied[0]?.count, 1);
  check('stackExtras 也走深拷', extras.contents?.[0]?.count === 1);
  check('空盒子不带 contents 字段（存档里不会多出一片空数组）', stackExtras(emptyBox).contents === undefined);
}

// ---------------------------------------------------------------- 5. 配方与相邻规则

console.log('\n[配方（与原版的差异）与相邻规则]');
{
  const E = Block.END_STONE;
  const C = Block.CHEST;
  equal('8 末地石 + 1 箱子 → 潜影盒', matchRecipe([E, E, E, E, C, E, E, E, E], 3)?.id, BOX);
  equal('做出 1 个', matchRecipe([E, E, E, E, C, E, E, E, E], 3)?.count, 1);
  equal('只有箱子（没有末地石）做出来的是箱子本身（对照）', matchRecipe([C], 3)?.id, undefined);
  equal('⚠️ 原版要 2 个**潜影贝壳**（末地城的潜影贝），本项目还没有那件物品', itemDef(Block.END_STONE) !== undefined, true);

  check('在"活塞推不动"的名单里', CONTAINER_BLOCKS.has(BOX));
  check('活塞推不动潜影盒', !canPush(BOX));

  // 与末影箱的对照：一个"跟着玩家走"、一个"跟着物品走"
  equal('末影箱不在容器存档的种类里（它跟着玩家走）', 'ender_chest' in SLOT_COUNTS, false);
  check('潜影盒在（它的内容虽然会进物品，但方块上的那份仍要存）', 'shulker_box' in SLOT_COUNTS);
}

console.log(`\n潜影盒测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
