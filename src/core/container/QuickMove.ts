/**
 * 快速移动（Shift+左键）——批次 127
 *
 * 这是原版背包界面里**用得最多的一次点击**：Shift+左键把一叠东西在
 * "玩家背包 ↔ 打开的方块界面"之间搬，或者在"快捷栏 ↔ 主背包"之间搬。
 * 在此之前本项目**完全没有它**（全仓库搜不到 `shiftKey`）——所以这一批按
 * 「Minecraft Wiki · Inventory」那张交互表把它补齐。
 *
 * 原版那几条规则（这里逐条落实，`test:quickmove` 逐条钉住）：
 *
 *  1. 搬的是**整叠**（不是一件），而且**能塞多少塞多少、剩下的留在原处**
 *     （原版 `moveItemStackTo` 就是部分移动：箱子里有半叠同类时会先并进去）；
 *  2. 目标是**方块容器**时，按容器格子的自然顺序（0 → size-1）**先并同类、再找空位**；
 *  3. 目标是**玩家背包**时，**先快捷栏（0→8）、再主背包（9→35）**——原版就是这个顺序，
 *     所以"从箱子里 Shift 一叠石头"会先落在第一格快捷栏；
 *  4. **盔甲** Shift+左键会**直接穿上**（进对应的那个盔甲槽），换下来的那件塞回背包
 *     （**塞不下就不换**——原版不会把旧盔甲扔在地上）；
 *  5. 目标装不下时**不换地方**（不会"顺手塞进别的槽"）。
 *
 * 为什么单独一个模块：这几条优先级是**纯规则**（不碰 DOM、不碰主循环），
 * 而它们最容易踩的恰恰是"顺序写反了"——那种错在真机上要按几十次才看得出来
 * （玩家只会觉得"东西怎么跑到那儿去了"）。写成纯函数之后每条都能断言。
 *
 * ⚠️ 与原版的差异（记在 TASKS H19）：
 *  - **不做"Shift+双击 = 把同一类的所有物品整批搬过去"**（那条要光标上先拿着东西，
 *    属于"双击收集"那一档，见 H19 的待办）；
 *  - 副手槽（40）只当普通格子（Shift 出来进主背包），**不做 F 键那一套**（同属待办）。
 */

import { armorInfoById } from '../registry/armor.ts';
import { maxStackOf } from '../registry/items.ts';
import {
  ARMOR_SIZE,
  ARMOR_START,
  HOTBAR_SIZE,
  HOTBAR_START,
  MAIN_SIZE,
  MAIN_START,
  type Inventory,
  type ItemStack,
  type SlotSource,
  sameStack,
  stackExtras,
} from './Inventory.ts';

/** 一次快速移动的结果（给界面播声音、给测试断言用） */
export interface QuickMoveResult {
  /** 有没有真的搬动（空格 / 装不下时是 false） */
  moved: boolean;
  /** 搬了多少件 */
  count: number;
  /** 落在了哪一格（`source` 是哪个容器 + 下标；没搬动时是 null） */
  target: { source: SlotSource; index: number } | null;
}

/** 主背包的顺序（9 → 35） */
const MAIN_ORDER: readonly number[] = Array.from({ length: MAIN_SIZE }, (_u, i) => MAIN_START + i);
/** 快捷栏的顺序（0 → 8） */
const HOTBAR_ORDER: readonly number[] = Array.from({ length: HOTBAR_SIZE }, (_u, i) => HOTBAR_START + i);
/** **方块 → 玩家背包**：先快捷栏、再主背包（原版顺序） */
export const PLAYER_FILL_ORDER: readonly number[] = [...HOTBAR_ORDER, ...MAIN_ORDER];

/**
 * 这一叠东西**能塞进 `order` 里多少件**（不改动任何数据——只算账）。
 *
 * 存在的理由很具体：盔甲换穿要**先问能不能装下旧的那件**，装得下才换
 * （"先试后做"）。用真移动去试的话，装不下时旧盔甲的副本已经落在背包里了——
 * 那是一件装备白白多出来一件（第一版就是这么写的）。
 */
export function fitCount(stack: ItemStack, target: SlotSource, order: readonly number[]): number {
  const limit = maxStackOf(stack.id);
  let room = 0;
  for (const slot of order) {
    const existing = target.get(slot);
    if (!existing) room += limit;
    else if (sameStack(existing, stack)) room += Math.max(0, limit - existing.count);
    if (room >= stack.count) return stack.count;
  }
  return room;
}

/**
 * 把 `from[index]` 那一叠**尽量并进** `to` 的 `order` 里（先并同类、再找空位）。
 *
 * @returns 还剩下多少件没放下（0 = 全放下了）
 */
function fillInto(
  from: SlotSource,
  index: number,
  stack: ItemStack,
  to: SlotSource,
  order: readonly number[],
): { remaining: number; landing: number | null } {
  let remaining = stack.count;
  const limit = maxStackOf(stack.id);
  let landing: number | null = null;

  // 第一趟：并进**同类**的格子（先并完再找空位——反过来的话，
  // "箱子里有两叠半满的石头"会被塞进空格而不是并起来）
  for (const slot of order) {
    if (remaining <= 0) break;
    const existing = to.get(slot);
    if (!existing || !sameStack(existing, stack)) continue;
    const room = limit - existing.count;
    if (room <= 0) continue;
    const moved = Math.min(room, remaining);
    existing.count += moved;
    remaining -= moved;
    to.set(slot, existing);
    if (landing === null) landing = slot;
  }

  // 第二趟：找空位
  for (const slot of order) {
    if (remaining <= 0) break;
    if (to.get(slot)) continue;
    const moved = Math.min(limit, remaining);
    remaining -= moved;
    to.set(slot, { id: stack.id, count: moved, ...stackExtras(stack) });
    if (landing === null) landing = slot;
  }

  if (remaining !== stack.count) {
    from.set(
      index,
      remaining > 0 ? { id: stack.id, count: remaining, ...stackExtras(stack) } : null,
    );
  }
  return { remaining, landing };
}

/** 这一叠东西**该穿到哪个盔甲槽**（不是盔甲就返回 null；只按部位匹配，与 `armorSlotAccepts` 同源） */
export function armorSlotFor(itemId: number): number | null {
  const info = armorInfoById(itemId);
  if (!info) return null;
  const slot = ARMOR_START + info.slot;
  return slot >= ARMOR_START && slot < ARMOR_START + ARMOR_SIZE ? slot : null;
}

/**
 * **Shift+左键**：把 `source[index]` 那一叠搬到"它该去的地方"。
 *
 * 三条去向（按原版）：
 *  - 源是**打开的容器** → 搬进玩家背包（先快捷栏、再主背包）；
 *  - 源是**玩家背包**且开着容器 → 搬进容器（按格子顺序）；装不下就**留在原处**；
 *  - 源是**玩家背包**且没开容器 → 快捷栏 ↔ 主背包互相搬（盔甲槽/副手槽往主背包搬）。
 *
 * @param containerSize 打开的容器有多少格（`SlotSource` 不暴露格数，由界面给）
 */
export function quickMove(
  inventory: Inventory,
  container: SlotSource | null,
  containerSize: number,
  source: SlotSource,
  index: number,
): QuickMoveResult {
  const stack = source.get(index);
  if (!stack || stack.count <= 0) return { moved: false, count: 0, target: null };

  // ---- ① 源是容器的格子：搬进玩家背包
  if (container !== null && source === container) {
    const { remaining, landing } = fillInto(source, index, stack, inventory, PLAYER_FILL_ORDER);
    return settled(stack.count, remaining, inventory, landing);
  }

  // ---- ② 源是玩家背包
  // ②.1 **盔甲优先穿上**（原版 Shift+左键会直接穿）。
  //      空槽直接穿；非空槽时**只有旧的那件塞得回背包才换**（塞不下就不换）
  const armorSlot = armorSlotFor(stack.id);
  if (armorSlot !== null) {
    const worn = inventory.get(armorSlot);
    // 空槽 → 直接穿；非空槽 → **只有旧的那件塞得回背包才换**；
    // 同一件（两顶一样的帽子）→ 不换（原版不叠盔甲，让它走下面"塞进背包"那条路）
    let canWear = worn === null;
    if (worn && !sameStack(worn, stack)) {
      canWear = fitCount(worn, inventory, PLAYER_FILL_ORDER) >= worn.count;
    }
    if (canWear) {
      if (worn) {
        const { remaining } = fillInto(dummy(worn), 0, worn, inventory, PLAYER_FILL_ORDER);
        // 上面那一步已经确认装得下，所以 `remaining` 一定是 0（留一条断言给测试）
        if (remaining !== 0) return { moved: false, count: 0, target: null };
      }
      inventory.set(armorSlot, { id: stack.id, count: 1, ...stackExtras(stack) });
      source.set(
        index,
        stack.count > 1 ? { id: stack.id, count: stack.count - 1, ...stackExtras(stack) } : null,
      );
      inventory.notify();
      return { moved: true, count: 1, target: { source: inventory, index: armorSlot } };
    }
  }

  // ②.2 开着容器：搬进容器（按格子自然顺序）；装不下就留在原处（不"顺手塞回自己背包"）
  if (container !== null) {
    const order = Array.from({ length: containerSize }, (_u, i) => i);
    const { remaining, landing } = fillInto(source, index, stack, container, order);
    return settled(stack.count, remaining, container, landing);
  }

  // ②.3 没开容器：快捷栏 ↔ 主背包 互相搬；盔甲槽与副手槽一律搬进主背包
  const inHotbar = index >= HOTBAR_START && index < HOTBAR_START + HOTBAR_SIZE;
  const inMain = index >= MAIN_START && index < MAIN_START + MAIN_SIZE;
  let order: readonly number[];
  if (inHotbar) order = MAIN_ORDER;
  else if (inMain) order = HOTBAR_ORDER;
  else order = PLAYER_FILL_ORDER;
  const { remaining, landing } = fillInto(source, index, stack, inventory, order);
  return settled(stack.count, remaining, inventory, landing);
}

/** 搬完之后整理结果 */
function settled(
  before: number,
  remaining: number,
  target: SlotSource,
  landing: number | null,
): QuickMoveResult {
  const moved = before - remaining;
  if (moved <= 0 || landing === null) return { moved: false, count: 0, target: null };
  return { moved: true, count: moved, target: { source: target, index: landing } };
}

/**
 * 一个"只看不改"的假来源（把一件已经拿在手上的东西交给 `fillInto` 去放）。
 *
 * ⚠️ 只在"旧盔甲塞回背包"那一处用：那件东西**已经在背包外面**了
 * （它在盔甲槽里），所以放好之后再把它从盔甲槽清掉——见调用处。
 */
function dummy(stack: ItemStack): SlotSource {
  return {
    get: () => stack,
    set: () => {
      /* 假来源：不写回（真正要清的是盔甲槽，由调用处做） */
    },
  };
}
