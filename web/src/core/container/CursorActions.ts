/**
 * 光标上的那几件事（批次 128）——双击收集 / 拖拽分配 / 数字键换槽 / 丢出
 *
 * 与 `QuickMove.ts` 同一套路：**规则是纯逻辑、界面只交坐标**。
 * 参照物还是「Minecraft Wiki · Inventory」那张交互表（TASKS H19）：
 *
 *  1. **双击**（光标那一路）：把**容器里所有同种物品**凑满一整堆抓到光标上
 *     （先抓满一整堆，剩下的留在原处）；
 *  2. **按住左键拖过多个槽**：把光标上的那叠**平均分配**到拖过的槽位，余数留在光标；
 *  3. **按住右键拖过多个槽**：在拖过的**每个槽位放 1 个**；
 *  4. **数字键 1-9 / F**：把"鼠标悬停的那一格"与对应**快捷栏 / 副手**格交换
 *     （两边任一为空就是直接移过去）；
 *  5. **Q / Ctrl+Q**：丢 **1 件 / 整叠**（丢进世界由主程序做，这里只回答"丢几件"）。
 *
 * 拖拽还有一条原版限制：**只有空槽或同种物品**才会被分配到（不然会"往石头里塞木头"）。
 */

import { maxStackOf } from '../registry/items.ts';
import {
  HOTBAR_SIZE,
  HOTBAR_START,
  MAIN_SIZE,
  MAIN_START,
  OFFHAND_SLOT,
  type Inventory,
  type ItemStack,
  type SlotSource,
  sameStack,
  stackExtras,
} from './Inventory.ts';
// Shift+双击要按**与快速移动同一套规矩**搬（先并同类、再找空位），
// 所以复用那边的 `transferStack` 与两份顺序表——各写一遍迟早会分叉
import { HOTBAR_ORDER, MAIN_ORDER, PLAYER_FILL_ORDER, transferStack } from './QuickMove.ts';

/** "光标上那一叠"在规则层的表示（`null` = 空手） */
export type HeldStack = ItemStack | null;

/**
 * **双击收集**：把 `source` 里所有同种物品凑满一整堆。
 *
 * @returns 新的"光标那一叠"（收集前后加起来的总数，最多一整堆）
 */
export function gatherSameItems(
  source: SlotSource,
  size: number,
  itemId: number,
  held: HeldStack,
  /** 光标上那叠的"附加数据"必须跟着走（附魔剑收附魔剑） */
  extras: Partial<ItemStack> = {},
): HeldStack {
  const limit = maxStackOf(itemId);
  let total = held && held.id === itemId ? held.count : 0;
  for (let i = 0; i < size; i++) {
    const slot = source.get(i);
    if (!slot || slot.id !== itemId) continue;
    if (!sameStack(slot, { id: itemId, count: 1, ...extras })) continue;
    const room = limit - total;
    if (room <= 0) break;
    const moved = Math.min(room, slot.count);
    total += moved;
    source.set(i, slot.count > moved ? { id: slot.id, count: slot.count - moved, ...stackExtras(slot) } : null);
  }
  return total > 0 ? { id: itemId, count: total, ...extras } : null;
}

/**
 * **按住左键拖过多个槽 → 平均分配**（余数留在光标上）。
 *
 * 只往"空槽或同种物品"里放（原版那条限制）；返回新的光标那一叠。
 */
export function distributeEvenly(
  held: HeldStack,
  slots: readonly { source: SlotSource; index: number }[],
): HeldStack {
  if (!held) return null;
  // 先筛出"能收"的槽位：空槽 + 还能再装的同类槽
  const targets = slots.filter(({ source, index }) => {
    const slot = source.get(index);
    if (!slot) return true;
    return sameStack(slot, held) && slot.count < maxStackOf(held.id);
  });
  if (targets.length === 0) return held;

  const limit = maxStackOf(held.id);
  // ⚠️ 是"**每格拿地板份额、余数留在光标上**"，不是"逐件轮流发"：
  // 10 个分给 3 格 → 3/3/3，光标留 1（原版 `doDrag` 就是这个算法，Wiki 也写着"余数留在光标上"）。
  // 第一版写成了轮流发（4/3/3、光标空）——`test:cursor` 那条"光标只剩 1 个"抓出来的
  const share = Math.floor(held.count / targets.length);
  if (share <= 0) return held; // 件数比槽位还少：一个都放不下（原版也不放）
  let remaining = held.count;
  for (const { source, index } of targets) {
    if (remaining < share) break;
    const slot = source.get(index);
    if (!slot) {
      source.set(index, { id: held.id, count: share, ...stackExtras(held) });
      remaining -= share;
    } else {
      const room = limit - slot.count;
      const moved = Math.min(room, share);
      if (moved <= 0) continue;
      slot.count += moved;
      source.set(index, slot);
      remaining -= moved;
    }
  }
  void limit;
  return remaining > 0 ? { id: held.id, count: remaining, ...stackExtras(held) } : null;
}

/** **按住右键拖过多个槽 → 每个槽位放 1 个**；返回新的光标那一叠 */
export function placeOneEach(
  held: HeldStack,
  slots: readonly { source: SlotSource; index: number }[],
): HeldStack {
  if (!held) return null;
  let remaining = held.count;
  for (const { source, index } of slots) {
    if (remaining <= 0) break;
    const slot = source.get(index);
    if (!slot) {
      source.set(index, { id: held.id, count: 1, ...stackExtras(held) });
      remaining -= 1;
    } else if (sameStack(slot, held) && slot.count < maxStackOf(held.id)) {
      slot.count += 1;
      source.set(index, slot);
      remaining -= 1;
    }
  }
  return remaining > 0 ? { id: held.id, count: remaining, ...stackExtras(held) } : null;
}

/**
 * **数字键 1-9 / F**：把"悬停的那一格"与快捷栏（或副手）那一格**交换**。
 *
 * 两边任一为空就是"搬过去"（原版如此）。**返回是否真的动了**——
 * 界面据此决定要不要刷新。
 *
 * @param key `1`~`9` 对应快捷栏 0~8；`F` 对应副手（`OFFHAND_SLOT`）
 */
export function swapWithSlot(
  inventory: Inventory,
  hovered: { source: SlotSource; index: number },
  key: string,
): boolean {
  const targetIndex = slotForKey(key);
  if (targetIndex === null) return false;
  // 快捷栏那 9 格与副手**都在玩家背包里**；悬停的格子可能属于容器，所以拿 `source.get`
  const hoveredStack = hovered.source.get(hovered.index);
  const targetStack = inventory.get(targetIndex);
  if (!hoveredStack && !targetStack) return false;
  // 盔甲槽等"只吃特定部位"的格子：把别的东西硬塞进去会静默失效（`canPlace` 判过一道）
  if (hoveredStack && !inventory.canPlace(targetIndex, hoveredStack.id)) return false;

  hovered.source.set(hovered.index, targetStack);
  inventory.set(targetIndex, hoveredStack);
  return true;
}

/** 按键 → 目标槽位（快捷栏 0-8 / 副手 40；别的键返回 null） */
export function slotForKey(key: string): number | null {
  if (key.length === 1 && key >= '1' && key <= '9') {
    const index = Number(key) - 1;
    return index < HOTBAR_SIZE ? HOTBAR_START + index : null;
  }
  if (key === 'f' || key === 'F') return OFFHAND_SLOT;
  return null;
}

/**
 * **Q / Ctrl+Q**：这一格该丢几件。
 *
 * 原版：**Q 丢 1 件、Ctrl+Q 丢整叠**（悬停在某一格上时）。
 * @returns 该丢的件数（0 = 没什么可丢）
 */
export function dropCount(stack: HeldStack, wholeStack: boolean): number {
  if (!stack || stack.count <= 0) return 0;
  return wholeStack ? stack.count : 1;
}

/**
 * **Shift+双击**（批次 129）：把点中那一格**所属的那一类东西整批**搬到"另一边"。
 *
 * 原版那两条（Wiki 的 Inventory 表）：开着方块时在**玩家背包 ↔ 方块**之间搬，
 * 没开时在**快捷栏 ↔ 主背包**之间搬。方向由"你点的是哪一侧"决定：
 *  - 点的是**容器**里的东西 → 全部搬进玩家背包（先快捷栏、再主背包）；
 *  - 点的是**玩家背包**里的东西 → 全搬进容器；没开容器时快捷栏 ↔ 主背包互相搬。
 *
 * @returns 一共搬了多少件（0 = 一件都没搬动，界面据此不刷新）
 */
export function moveAllOfTypeBetween(
  inventory: Inventory,
  container: SlotSource | null,
  containerSize: number,
  source: SlotSource,
  index: number,
): number {
  const first = source.get(index);
  if (!first) return 0;
  const itemId = first.id;

  // 目标一侧 + 该按哪个顺序往里放，以及**从哪一段扫**。
  //
  // ⚠️ "扫哪一段"与"放进哪里"必须**互不重叠**：没开容器时两边都在同一个背包里
  // （快捷栏 ↔ 主背包），如果扫的区间包含了刚放进去的那几格，就会**反复搬自己刚搬过去的
  // 东西**——第一版就是这样，`moved` 数出来 114（20+30+64）、东西还被搬乱了。
  let target: SlotSource;
  let order: readonly number[];
  let from: number;
  let to: number;
  if (container !== null && source === container) {
    target = inventory;
    order = PLAYER_FILL_ORDER;
    from = 0;
    to = containerSize - 1;
  } else if (container !== null) {
    target = container;
    order = Array.from({ length: containerSize }, (_u, i) => i);
    from = 0;
    to = MAIN_START + MAIN_SIZE - 1; // 只扫"背包存储"那 36 格（盔甲/副手不参与）
  } else {
    const inHotbar = index >= HOTBAR_START && index < HOTBAR_START + HOTBAR_SIZE;
    const inMain = index >= MAIN_START && index < MAIN_START + MAIN_SIZE;
    target = inventory;
    order = inHotbar ? MAIN_ORDER : inMain ? HOTBAR_ORDER : PLAYER_FILL_ORDER;
    // 点快捷栏 → 扫快捷栏；点主背包 → 扫主背包；点盔甲/副手 → 扫整个存储区
    from = inHotbar ? HOTBAR_START : inMain ? MAIN_START : 0;
    to = inHotbar ? HOTBAR_START + HOTBAR_SIZE - 1 : inMain ? MAIN_START + MAIN_SIZE - 1 : MAIN_START + MAIN_SIZE - 1;
  }

  // 逐格搬：**从后往前**扫（搬空时会写回 null，倒着扫不会跳格）
  let moved = 0;
  for (let i = to; i >= from; i--) {
    const stack = source.get(i);
    if (!stack || stack.id !== itemId) continue;
    const { remaining } = transferStack(source, i, stack, target, order);
    moved += stack.count - remaining;
  }
  return moved;
}
