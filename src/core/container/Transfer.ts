/**
 * 容器之间"搬一件"的通用规则（批次 58，漏斗与投掷器的地基）
 *
 * 漏斗要往**任何**容器里塞东西、也要从**任何**容器里拿东西，投掷器（批次 59）
 * 同样要"往朝向那一格的容器里塞一件"，而"哪些格子能塞"恰恰是各容器自己的事：
 *  - 熔炉**不能往产物槽里塞**（塞进去的东西会被当成烧出来的，还能顺手刷经验）；
 *  - 切石机只有一格输入；营火只吃食物；酿造台是"3 瓶 + 材料 + 燃料"；
 *  - 铁砧 / 锻造台有产物槽，同样不能塞。
 *
 * 这些规则写成**一张表 + 几个纯函数**，而不是在搬运方那边 `instanceof` 一串：
 * 搬运逻辑因此只认 `BlockContainer`，新增一种容器时只改这里的表
 * （漏改的表现很隐蔽：漏斗把东西塞进了不该塞的格子）。
 *
 * ⚠️ 与本模块相互引用：`Hopper.ts` / `Dropper.ts` 要调用这里的
 * `tryInsertOne` / `peekTake`，这里也要认出它们的类型。因此**本模块顶层不能读
 * 那两个模块的任何值**（`HOPPER_SIZE` / `DROPPER_SIZE` 都只在函数体里用），
 * 否则两个模块谁先加载就会把谁读成 undefined——这是 ESM 循环里最隐蔽的一种坑。
 *
 * ⚠️ 与原版的差异（记在 TASKS H14）：
 *  1. 附魔台**不接受**自动输入（原版对漏斗是关着的）；
 *  2. 从**炉子**里取件只取产物槽。原版按"第一个非空槽"取（连原料、燃料都抽得走），
 *     这里刻意收紧：不然"漏斗摆在炉子下面自动收成品"会先把刚放进去的矿石抽回来。
 */

import { ANVIL_LEFT, ANVIL_RESULT, ANVIL_RIGHT, ANVIL_SIZE, Anvil } from './Anvil.ts';
import {
  BREW_BOTTLE_SLOTS,
  BREW_FUEL_SLOT,
  BREW_INGREDIENT_SLOT,
  BREW_SLOT_COUNT,
  BrewingStand,
} from './BrewingStand.ts';
import { CAMPFIRE_SIZE, Campfire } from './Campfire.ts';
import { CHEST_SIZE, Chest } from './Chest.ts';
import { DROPPER_SIZE, Dropper } from './Dropper.ts';
import { EnchantTable } from './EnchantTable.ts';
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, FURNACE_SIZE, Furnace } from './Furnace.ts';
import { HOPPER_SIZE, Hopper } from './Hopper.ts';
import { SMITHING_EQUIPMENT, SMITHING_MATERIAL, SMITHING_RESULT, SMITHING_SIZE, SmithingTable } from './SmithingTable.ts';
import {
  GRINDSTONE_LEFT,
  GRINDSTONE_RESULT,
  GRINDSTONE_RIGHT,
  GRINDSTONE_SIZE,
  Grindstone,
} from './Grindstone.ts';
import { STONECUTTER_INPUT, STONECUTTER_SIZE, Stonecutter } from './Stonecutter.ts';
import { sameExtras, type ItemStack } from './Inventory.ts';
import { fuelSeconds, smeltingRecipeFor } from '../crafting/Smelting.ts';
import { maxStackOf } from '../registry/items.ts';
import type { BlockContainer } from '../world/BlockEntityStore.ts';

/** 附魔台的格数（它没有导出的尺寸常量——原版就是"装备 + 青金石"两格） */
const ENCHANT_SLOT_COUNT = 2;

const EMPTY_SLOTS: readonly number[] = [];
const ALL_CHEST_SLOTS: readonly number[] = range(CHEST_SIZE);
const ALL_CAMPFIRE_SLOTS: readonly number[] = range(CAMPFIRE_SIZE);
const BREWING_SLOTS: readonly number[] = [...BREW_BOTTLE_SLOTS, BREW_INGREDIENT_SLOT, BREW_FUEL_SLOT];

/** [0, count) 的整数列表（`Array.from` 的简写，避免每处各写一遍回调） */
function range(count: number): readonly number[] {
  return Array.from({ length: count }, (_value, index) => index);
}

/**
 * 这个容器**允许被塞进东西**的格子（顺序就是"先往哪塞"的优先级）。
 *
 * ⚠️ 空数组表示"完全不接受"（附魔台）：漏斗推不进去，也不会把东西吃掉。
 */
export function acceptingSlots(container: BlockContainer): readonly number[] {
  if (container instanceof Chest) return ALL_CHEST_SLOTS;
  // ⚠️ 这一行是函数体里读 `HOPPER_SIZE`（见文件头关于相互引用的说明）
  if (container instanceof Hopper) return range(HOPPER_SIZE);
  // 投掷器（批次 59）：9 格全可塞（原版漏斗往投掷器里灌就是往第一个空格灌）
  if (container instanceof Dropper) return range(DROPPER_SIZE);
  if (container instanceof Furnace) return [FURNACE_INPUT, FURNACE_FUEL];
  if (container instanceof Campfire) return ALL_CAMPFIRE_SLOTS;
  if (container instanceof BrewingStand) return BREWING_SLOTS;
  if (container instanceof SmithingTable) return [SMITHING_EQUIPMENT, SMITHING_MATERIAL];
  if (container instanceof Stonecutter) return [STONECUTTER_INPUT];
  if (container instanceof Anvil) return [ANVIL_LEFT, ANVIL_RIGHT];
  // 砂轮（批次 188）：两格输入可塞，**产物槽不能塞**（与铁砧同一个理由）
  if (container instanceof Grindstone) return [GRINDSTONE_LEFT, GRINDSTONE_RIGHT];
  // 剩下的就是附魔台：原版对漏斗是关着的（见文件头的差异说明）
  return EMPTY_SLOTS;
}

/**
 * 这一格是不是"**算出来的**产物槽"（铁砧 / 锻造台 / 砂轮）。
 *
 * 这类格子里的东西是**输入两格算出来的**，不是玩家放进去的：
 *  - 搬运方（漏斗 / 投掷器）不许往里塞（见上面 `acceptingSlots`）；
 *  - 拆掉方块时也**不许倒出来**——否则"放两把附魔剑、把铁砧拆了"就能白拿一把
 *    洗过附魔的剑（批次 188 才发现铁砧与锻造台一直有这个刷物品的口子：
 *    `dropContainerContents` 是按下标全倒的）。
 */
export function isComputedResultSlot(container: BlockContainer, slot: number): boolean {
  if (container instanceof Anvil) return slot === ANVIL_RESULT;
  if (container instanceof SmithingTable) return slot === SMITHING_RESULT;
  if (container instanceof Grindstone) return slot === GRINDSTONE_RESULT;
  return false;
}

/** 某容器一共几格（倒空、断言、调试用；**含**产物槽，所以不能用 `acceptingSlots` 的长度） */
export function containerSlotCount(container: BlockContainer): number {
  if (container instanceof Chest) return CHEST_SIZE;
  if (container instanceof Hopper) return HOPPER_SIZE;
  if (container instanceof Dropper) return DROPPER_SIZE;
  if (container instanceof Furnace) return FURNACE_SIZE;
  if (container instanceof Campfire) return CAMPFIRE_SIZE;
  if (container instanceof BrewingStand) return BREW_SLOT_COUNT;
  if (container instanceof SmithingTable) return SMITHING_SIZE;
  if (container instanceof Stonecutter) return STONECUTTER_SIZE;
  if (container instanceof Anvil) return ANVIL_SIZE;
  if (container instanceof Grindstone) return GRINDSTONE_SIZE;
  if (container instanceof EnchantTable) return ENCHANT_SLOT_COUNT;
  return 0;
}

/** 这一格还塞得下这个栈吗（空槽可以、同 id 且附加数据一致且未满也可以，其它不行） */
function slotHasRoom(container: BlockContainer, slot: number, stack: ItemStack): boolean {
  const current = container.get(slot);
  if (!current) return true;
  if (current.id !== stack.id) return false;
  if (!sameExtras(current, stack)) return false;
  return current.count < maxStackOf(stack.id);
}

/**
 * 除了"塞得下"，还有**这一格认不认这个物品**的品类规则（对齐原版 `isValid`）：
 *  - **营火只吃食物**：判据是"有没有营火配方"（`smeltingRecipeFor`），
 *    与营火自己 tick 用的是同一份数据，所以"界面上显示不能烤、漏斗却塞了进去"不会发生。
 *    ⚠️ 不能用 `stationRejectReason` 判：它对"根本没有配方的东西"返回空串（那是给界面用的
 *    "没意见"，不是"能烤"）——石头就会因此被塞进营火。
 *  - **熔炉的燃料槽只吃燃料**：不拦的话漏斗会把挖到的石头一把把塞进燃料槽，炉子再也点不着。
 *    原料槽**什么都收**（原版也是：炉子的输入校验发生在烧炼时，所以玩家能往原料槽放泥巴）。
 */
function kindAccepts(container: BlockContainer, slot: number, itemId: number): boolean {
  if (container instanceof Campfire) return smeltingRecipeFor(itemId, 'campfire') !== undefined;
  if (container instanceof Furnace && slot === FURNACE_FUEL) return fuelSeconds(itemId) > 0;
  return true;
}

/**
 * 试着往目标容器里塞**一件**（`stack` 只取它的物品与附加数据，数量截成 1）；
 * **能塞才改**（塞不下原样返回 false，不留副作用）。
 *
 * ⚠️ 附加数据要一起带过去：漏斗不该把"改了名的镐 / 附了魔的工具"洗成白板。
 */
export function tryInsertOne(container: BlockContainer, stack: ItemStack): boolean {
  for (const slot of acceptingSlots(container)) {
    if (!slotHasRoom(container, slot, stack)) continue;
    if (!kindAccepts(container, slot, stack.id)) continue;
    const current = container.get(slot);
    container.set(slot, current ? { ...current, count: current.count + 1 } : { ...cloneExtras(stack), count: 1 });
    return true;
  }
  return false;
}

/** 只保留附加数据的副本（数量由调用方补） */
function cloneExtras(stack: ItemStack): ItemStack {
  const copy: ItemStack = { id: stack.id, count: 1 };
  if (stack.damage !== undefined) copy.damage = stack.damage;
  if (stack.enchants !== undefined) copy.enchants = { ...stack.enchants };
  if (stack.name !== undefined) copy.name = stack.name;
  if (stack.repairCost !== undefined) copy.repairCost = stack.repairCost;
  return copy;
}

/**
 * 从来源容器里"看"要取哪一件（**不产生副作用**）。
 * 取件顺序见文件头的差异说明：炉子只取产物槽，其余按槽位顺序取第一个非空的。
 */
export function peekTake(container: BlockContainer): { slot: number; stack: ItemStack } | null {
  if (container instanceof Furnace) {
    const output = container.get(FURNACE_OUTPUT);
    return output ? { slot: FURNACE_OUTPUT, stack: output } : null;
  }
  for (const slot of acceptingSlots(container)) {
    const stack = container.get(slot);
    if (stack) return { slot, stack };
  }
  return null;
}

/** 真的取走一件（调用方必须先 `peekTake` 确认有东西可取） */
export function takeOne(container: BlockContainer, slot: number): ItemStack | null {
  const stack = container.get(slot);
  if (!stack) return null;
  const taken: ItemStack = { ...stack, count: 1 };
  stack.count -= 1;
  if (stack.count <= 0) container.set(slot, null);
  else container.onChange?.();
  return taken;
}
