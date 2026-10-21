/**
 * 背包点击语义（INVENTORY_SPEC Phase 2）
 *
 * 这一段是把"点击一格"从**界面事件**里剥出来的**纯状态机**：
 * 输入是"当前光标状态 + 命中的格子 + 哪个键"，输出是"新的光标状态 + 改了没有 + 提示语"。
 * 界面只负责把坐标换成 `SlotBinding`，然后照着返回值重画。
 *
 * 参照 `WXMINIGAME_V2_INVENTORY_SPEC.md` §4 那张交互表：
 *
 *  | 情形 | 左键 | 右键 |
 *  | --- | --- | --- |
 *  | 空手点有物品格 | 拿起整叠 | 拿起 `ceil(n/2)`，原格留剩余 |
 *  | 手上有物品点空格 | 放下整叠 | 放下 1 个 |
 *  | 手上有物品点同类格 | 补满到堆叠上限，剩余仍在手上 | 放 1 个 |
 *  | 手上有物品点异类格 | 交换 | **不处理**（原版右键不换） |
 *  | 点只取不放的槽（产物） | 只能取，不能放 | 同左 |
 *
 * 触摸端映射（TOUCH-001/002/003）：短按 = 左键、长按 = 右键。
 * 长按的识别在 UI 层（`UiLayer` 里那个 420ms 计时器），这里只收 `'right'`。
 *
 * ⚠️ 不在这里做的事（留给后面的 Phase，写了会掩盖规则本身的错）：
 *  - 快速移动（Shift/双击收集/拖拽分配）→ Phase 4；
 *  - 丢弃（点空白丢手上那叠）→ Phase 4；
 *  - 容器 ↔ 背包的搬运规则（`quickMove` 那套）→ Phase 7。
 */

import { armorSlotAccepts } from '../core/registry/armor.ts';
import { maxStackOf } from '../core/registry/items.ts';
import { splitStack } from '../core/container/TouchSplit.ts';
import {
  sameStack,
  stackExtras,
  type Inventory,
  type ItemStack,
  type SlotSource,
} from '../core/container/Inventory.ts';

/** 这一格属于谁——**不能只存下标**（玩家背包的 9 号与箱子的 9 号是两格，INV-007） */
export type SlotKind = 'inventory' | 'crafting' | 'creative' | 'container';

export type ClickButton = 'left' | 'right';

export interface SlotRef {
  kind: SlotKind;
  index: number;
}

/** 一个可点击的格子：数据源 + 身份 + 两条约束 */
export interface SlotBinding extends SlotRef {
  source: SlotSource;
  /** 只取不放（合成产物、熔炉产物）——INV-015 / FURN-003 */
  takeOnly?: boolean;
  /** 单件槽（盔甲 36~39 / 副手 40）：放下时只放 1 个，不并堆 */
  singleItem?: boolean;
}

/** 光标状态快照（与 `InventoryCursor` 同构，但这里是值对象，便于断言） */
export interface CursorState {
  held: ItemStack | null;
  /** 手上的东西来自创造栏：关界面时直接销毁，不能偷偷塞进背包（INV-011） */
  fromCreative: boolean;
  /** 从哪一格拿起来的：取消/关闭时优先放回原位（CLOSE-002） */
  origin: SlotRef | null;
}

export interface ClickResult {
  state: CursorState;
  /** 有没有真的改动（界面据此决定要不要重画 / 播声音） */
  changed: boolean;
  /** 给玩家的一句话（拒绝的原因也走这里，免得界面自己再编一套措辞） */
  hint: string;
}

export const EMPTY_CURSOR: CursorState = { held: null, fromCreative: false, origin: null };

export function refOf(binding: SlotRef): SlotRef {
  return { kind: binding.kind, index: binding.index };
}

function unchanged(state: CursorState, hint = ''): ClickResult {
  return { state, changed: false, hint };
}

/** 这一格收不收这件东西（产物槽一律不收；盔甲槽只收对应部位） */
export function canPlaceItem(binding: SlotBinding, itemId: number): boolean {
  if (binding.takeOnly) return false;
  if (binding.kind === 'inventory' && binding.index >= 36) return armorSlotAccepts(binding.index, itemId);
  return true;
}

/** 这一格一次能装多少（单件槽是 1，其余看物品自己的堆叠上限） */
function limitOf(binding: SlotBinding, itemId: number): number {
  return binding.singleItem ? 1 : maxStackOf(itemId);
}

/** 从一叠里切出 `count` 个（附加数据跟着走；余数仍在原处） */
function cut(stack: ItemStack, count: number): { taken: ItemStack; rest: ItemStack | null } {
  const { taken, rest } = splitStack(stack, count);
  // `splitStack` 在 count<=0 时返回 taken=null；这里 count 一定 >= 1，兜一下类型
  return { taken: taken ?? { id: stack.id, count: stack.count, ...stackExtras(stack) }, rest };
}

/**
 * **点一下格子**。
 *
 * @param state   点击之前的光标状态
 * @param binding 命中格子的数据源与身份（`takeOnly` / `singleItem` 由调用方按格子性质给）
 * @param button  `'left'` = 短按，`'right'` = 长按
 */
export function applyClick(state: CursorState, binding: SlotBinding, button: ClickButton): ClickResult {
  const slot = binding.source.get(binding.index);

  // ---------------------------------------------------------------- 空手
  if (!state.held) {
    if (!slot) return unchanged(state, '这一格是空的');
    if (button === 'right') {
      // 右键/长按：拿一半（向上取整），原格保留剩余；只有 1 个时就是拿那 1 个
      const take = Math.ceil(slot.count / 2);
      const { taken, rest } = cut(slot, take);
      binding.source.set(binding.index, rest);
      return {
        state: { held: taken, fromCreative: false, origin: refOf(binding) },
        changed: true,
        hint: `拿起 ${taken.count} 个`,
      };
    }
    binding.source.set(binding.index, null);
    return {
      state: { held: { id: slot.id, count: slot.count, ...stackExtras(slot) }, fromCreative: false, origin: refOf(binding) },
      changed: true,
      hint: `拿起 ${slot.count} 个`,
    };
  }

  const held = state.held;

  // ---------------------------------------------------------------- 手上有东西
  if (!canPlaceItem(binding, held.id)) {
    if (binding.takeOnly) return unchanged(state, '产物槽只能取，不能放');
    return unchanged(state, '这件物品不能放进这一格');
  }
  const limit = limitOf(binding, held.id);

  if (button === 'right') {
    // 右键：只放 1 个；目标异类时**不处理**（原版右键不换）
    if (slot && !sameStack(slot, held)) return unchanged(state, '右键只能放进空格或同类格');
    if (slot && slot.count >= limit) return unchanged(state, '这一格已经满了');
    if (!slot) {
      binding.source.set(binding.index, { id: held.id, count: 1, ...stackExtras(held) });
    } else {
      binding.source.set(binding.index, { ...slot, count: slot.count + 1 });
    }
    const rest = held.count - 1;
    return {
      state: {
        held: rest > 0 ? { id: held.id, count: rest, ...stackExtras(held) } : null,
        fromCreative: rest > 0 ? state.fromCreative : false,
        origin: rest > 0 ? state.origin : null,
      },
      changed: true,
      hint: '',
    };
  }

  // 左键
  if (!slot) {
    // 整叠放下；单件槽（盔甲/副手）只吃 1 个，剩下的留在手上
    const place = Math.min(limit, held.count);
    binding.source.set(binding.index, { id: held.id, count: place, ...stackExtras(held) });
    const rest = held.count - place;
    return {
      state: {
        held: rest > 0 ? { id: held.id, count: rest, ...stackExtras(held) } : null,
        fromCreative: rest > 0 ? state.fromCreative : false,
        origin: rest > 0 ? state.origin : null,
      },
      changed: true,
      hint: '',
    };
  }

  // 创造复制品：放下即**覆盖**（原版创造模式就是这样），原物品直接销毁、光标清空（CLICK-014）。
  // 这一条必须排在"同类合并/异类交换"之前——否则"创造 64 个石头盖掉 30 个泥土"会变成
  // "交换"，手上多出 30 个泥土，等于凭空造了一份东西。
  if (state.fromCreative) {
    binding.source.set(binding.index, { id: held.id, count: Math.min(limit, held.count) });
    return { state: EMPTY_CURSOR, changed: true, hint: '' };
  }

  if (sameStack(slot, held) && limitOf(binding, slot.id) > 1) {
    // 同类：补满到上限，剩余仍在手上（CLICK-009/010）
    const room = limit - slot.count;
    if (room <= 0) return unchanged(state, '这一格已经满了');
    const moved = Math.min(room, held.count);
    binding.source.set(binding.index, { ...slot, count: slot.count + moved });
    const rest = held.count - moved;
    return {
      state: {
        held: rest > 0 ? { id: held.id, count: rest, ...stackExtras(held) } : null,
        fromCreative: rest > 0 ? state.fromCreative : false,
        origin: rest > 0 ? state.origin : null,
      },
      changed: true,
      hint: '',
    };
  }

  // 异类：交换。旧的那件到手上，来源改成这一格（取消时放回这里，CLICK-013）。
  // ⚠️ 单件槽（护甲/副手）只能"一对一"换：手上是一叠时换不了——否则那叠里
  // 多出来的部分既没地方放、也不该被这一格吃掉（那等于凭空销毁物品）。
  if (binding.singleItem && held.count > 1) {
    return unchanged(state, '这一格只能放 1 件，请先拆开再放');
  }
  binding.source.set(binding.index, { id: held.id, count: Math.min(limit, held.count), ...stackExtras(held) });
  return {
    state: { held: { id: slot.id, count: slot.count, ...stackExtras(slot) }, fromCreative: false, origin: refOf(binding) },
    changed: true,
    hint: `换成 ${slot.count} 个`,
  };
}

/**
 * **关闭界面时的回收**（CLOSE-001/002/003）。
 *
 * 三条顺序不能换：
 *  1. 创造复制品**直接销毁**（`fromCreative`）——塞进背包等于凭空造物品；
 *  2. 原位还空着就放回原位（"我没想拿走"的情形）；
 *  3. 否则塞进玩家背包；背包也满了**就还留在手上**，绝不凭空丢掉（CLOSE-004）。
 *
 * @param resolve 把 `SlotRef` 变回可写的数据源（界面的槽位表）
 */
export function reclaimHeld(
  state: CursorState,
  inventory: Inventory,
  resolve: (ref: SlotRef) => SlotBinding | null,
): { state: CursorState; changed: boolean; hint: string } {
  const held = state.held;
  if (!held) return { state, changed: false, hint: '' };
  if (state.fromCreative) {
    return { state: EMPTY_CURSOR, changed: true, hint: '创造物品已回收' };
  }

  // 先试原位：原位还空着、或者还叠得下同类，就原样放回去
  if (state.origin) {
    const binding = resolve(state.origin);
    if (binding && canPlaceItem(binding, held.id)) {
      const slot = binding.source.get(binding.index);
      if (!slot) {
        binding.source.set(binding.index, { id: held.id, count: held.count, ...stackExtras(held) });
        return { state: EMPTY_CURSOR, changed: true, hint: '' };
      }
      if (sameStack(slot, held)) {
        const limit = limitOf(binding, held.id);
        const room = limit - slot.count;
        if (room >= held.count) {
          binding.source.set(binding.index, { ...slot, count: slot.count + held.count });
          return { state: EMPTY_CURSOR, changed: true, hint: '' };
        }
      }
    }
  }

  const remaining = inventory.addStack(held);
  if (remaining <= 0) return { state: EMPTY_CURSOR, changed: true, hint: '' };
  return {
    state: { held: { id: held.id, count: remaining, ...stackExtras(held) }, fromCreative: false, origin: null },
    changed: true,
    hint: `背包已满，手上还剩 ${remaining} 个`,
  };
}

/** 把界面上那一串槽位编成一个"能按 ref 查回来"的解析器（界面 + 测试共用） */
export function slotResolver(bindings: readonly SlotBinding[]): (ref: SlotRef) => SlotBinding | null {
  return (ref) => bindings.find((item) => item.kind === ref.kind && item.index === ref.index) ?? null;
}
