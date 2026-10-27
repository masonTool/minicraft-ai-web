/**
 * 背包的**交互逻辑**（纯逻辑，不碰 DOM / canvas）—— 阶段 4 的第二块
 *
 * 用户 2026-10-27：「重点把背包逻辑和界面用 canvas 来复原实现，希望能保持跟 DOM 同样的
 * 风格和交互逻辑……最好能跟 DOM 实现的一模一样」。
 *
 * 要做到"一模一样"，就不能把规则散在绘制代码里。这一层的职责只有一句：
 * **给定"哪个槽位被怎么点了一下"，算出槽位内容怎么变**。它不 import 任何 UI，
 * 也不认识 `ItemStack` 的具体形状（只要求 `{ id, count }`），所以：
 *  - 游戏里可以套在真实的 `Inventory` 上（`get/set` 两个方法就够）；
 *  - 测试里可以套在一个数组上，把原版规则逐条钉住；
 *  - 未来的 canvas 面板与 DOM 面板可以**共用同一份逻辑**（谁都不用抄规则）。
 *
 * 目前覆盖的规则（对齐基岩版「物品管理」）：
 *  1. 左键：空手拿起整叠 / 手上有货放到空格 / 同类合并（受堆叠上限）/ 异类交换；
 *  2. 右键：空手取一半（**向上取整**）/ 手上有货放**一个** / 同类放一个 / 异类不动；
 *  3. Shift+左键：快速移动（先并进同类堆，再占空格）；
 *  4. 拖拽分配：把手上这一叠**均分**到经过的格子（余数给前面的格子）。
 */

/** 只要求"能被搬运"的最小字段（真实的 `ItemStack` 完全满足） */
export interface StackLike {
  readonly id: number;
  readonly count: number;
}

/** 槽位读写（游戏里包一层 `Inventory`，测试里包一个数组） */
export interface SlotAccess {
  get(index: number): StackLike | null;
  set(index: number, stack: StackLike | null): void;
}

/** 搬运规则（由调用方从物品表注入，避免 ui2d 依赖 core） */
export interface MoveRules {
  /** 该物品的堆叠上限（方块/材料 64、工具 1…） */
  readonly limitOf: (id: number) => number;
  /** 两个堆是不是"同一种东西"（含耐久/附魔/改名的比较由 core 决定） */
  readonly sameItem: (a: StackLike, b: StackLike) => boolean;
}

/** 光标上拿着的那一叠（可变持有者：函数直接改它） */
export interface Cursor {
  stack: StackLike | null;
}

/** 造一个新的堆（保留 `count`，其余字段由调用方的 `sameItem`/`limitOf` 决定） */
function withCount<T extends StackLike>(stack: T, count: number): T {
  return { ...stack, count } as T;
}

/** 左键：拿起 / 放下 / 合并 / 交换 */
export function leftClick(slots: SlotAccess, rules: MoveRules, cursor: Cursor, index: number): void {
  const target = slots.get(index);
  const held = cursor.stack;

  // 空手 + 空格：什么都不做
  if (!held && !target) return;
  // 空手 + 有货：整叠拿起
  if (!held && target) {
    cursor.stack = target;
    slots.set(index, null);
    return;
  }
  // 手上有货 + 空格：整叠放下
  if (held && !target) {
    slots.set(index, held);
    cursor.stack = null;
    return;
  }
  if (!held || !target) return;

  // 同类：合并到上限，余数留在手上
  if (rules.sameItem(held, target)) {
    const limit = rules.limitOf(target.id);
    const room = limit - target.count;
    if (room <= 0) {
      // 已满：交换（原版也是"满堆点了没反应"，但把手上这叠换上去更接近直觉；
      // 这里选择"不交换"以对齐 Wiki 的"满堆无法合并"）
      return;
    }
    const moved = Math.min(room, held.count);
    slots.set(index, withCount(target, target.count + moved));
    const rest = held.count - moved;
    cursor.stack = rest > 0 ? withCount(held, rest) : null;
    return;
  }

  // 异类：交换
  slots.set(index, held);
  cursor.stack = target;
}

/** 右键：取一半 / 放一个 / 同类放一个 / 异类不动 */
export function rightClick(slots: SlotAccess, rules: MoveRules, cursor: Cursor, index: number): void {
  const target = slots.get(index);
  const held = cursor.stack;

  if (!held && target) {
    // 取一半：**向上取整**（1 个也拿得起来，原版就是这样）
    const take = Math.ceil(target.count / 2);
    slots.set(index, target.count - take > 0 ? withCount(target, target.count - take) : null);
    cursor.stack = withCount(target, take);
    return;
  }
  if (held && !target) {
    // 放一个
    slots.set(index, withCount(held, 1));
    cursor.stack = held.count > 1 ? withCount(held, held.count - 1) : null;
    return;
  }
  if (!held || !target) return;

  // 同类：放一个（受上限）
  if (rules.sameItem(held, target)) {
    if (target.count >= rules.limitOf(target.id)) return;
    slots.set(index, withCount(target, target.count + 1));
    cursor.stack = held.count > 1 ? withCount(held, held.count - 1) : null;
  }
  // 异类：右键不做交换（原版语义）
}

/**
 * Shift+左键：快速移动。
 *
 * 顺序照原版：**先并进同类堆**（从前往后，填满为止），**再占空格**；
 * 两轮都放不下的部分留在原格。
 */
export function quickMove(
  slots: SlotAccess,
  rules: MoveRules,
  index: number,
  targets: readonly number[],
): void {
  let stack = slots.get(index);
  if (!stack) return;

  // 第一轮：并进同类堆
  for (const targetIndex of targets) {
    if (stack.count <= 0) break;
    if (targetIndex === index) continue;
    const target = slots.get(targetIndex);
    if (!target || !rules.sameItem(stack, target)) continue;
    const room = rules.limitOf(target.id) - target.count;
    if (room <= 0) continue;
    const moved = Math.min(room, stack.count);
    slots.set(targetIndex, withCount(target, target.count + moved));
    stack = withCount(stack, stack.count - moved);
  }

  // 第二轮：占空格
  for (const targetIndex of targets) {
    if (stack.count <= 0) break;
    if (targetIndex === index) continue;
    if (slots.get(targetIndex)) continue;
    slots.set(targetIndex, stack);
    stack = withCount(stack, 0);
  }

  slots.set(index, stack.count > 0 ? stack : null);
}

/**
 * 拖拽分配：把手上的这一叠**均分**到 `indices`。
 *
 * 原版（Wiki「物品管理 → 便捷鼠标操作」）：拖过的每一格各得**均分后的一份**，
 * 余数给前面的格子；只有"同类或空格"才参与。
 */
export function distributeDrag(
  slots: SlotAccess,
  rules: MoveRules,
  cursor: Cursor,
  indices: readonly number[],
): void {
  const held = cursor.stack;
  if (!held || held.count <= 0) return;
  // 去重 + 过滤掉装不下的格子（同类已满 / 异类非空 / 重复经过）
  const eligible: number[] = [];
  for (const index of indices) {
    if (eligible.includes(index)) continue;
    const target = slots.get(index);
    if (!target) {
      eligible.push(index);
      continue;
    }
    if (rules.sameItem(held, target) && target.count < rules.limitOf(target.id)) eligible.push(index);
  }
  if (eligible.length === 0) return;

  const per = Math.floor(held.count / eligible.length);
  let remainder = held.count % eligible.length;
  let placed = 0;
  for (const index of eligible) {
    let amount = per;
    if (remainder > 0) {
      amount += 1;
      remainder -= 1;
    }
    if (amount <= 0) continue;
    const target = slots.get(index);
    if (!target) {
      slots.set(index, withCount(held, amount));
      placed += amount;
      continue;
    }
    const room = rules.limitOf(target.id) - target.count;
    const moved = Math.min(room, amount);
    if (moved <= 0) continue;
    slots.set(index, withCount(target, target.count + moved));
    placed += moved;
  }
  const rest = held.count - placed;
  cursor.stack = rest > 0 ? withCount(held, rest) : null;
}

/**
 * 右键拖拽：每经过一格放**一个**。
 *
 * 与左键拖拽的"均分"不同（Wiki「物品管理」：右键拖过若干格子 = 每格放一个，
 * 手上的东西按格数递减）。空格与"同类且没满"的格子才放。
 */
export function rightDragDistribute(
  slots: SlotAccess,
  rules: MoveRules,
  cursor: Cursor,
  indices: readonly number[],
): void {
  const held = cursor.stack;
  if (!held) return;
  let remaining = held.count;
  const seen: number[] = [];
  for (const index of indices) {
    if (remaining <= 0) break;
    if (seen.includes(index)) continue;
    seen.push(index);
    const target = slots.get(index);
    if (!target) {
      slots.set(index, withCount(held, 1));
      remaining -= 1;
      continue;
    }
    if (!rules.sameItem(held, target)) continue;
    if (target.count >= rules.limitOf(target.id)) continue;
    slots.set(index, withCount(target, target.count + 1));
    remaining -= 1;
  }
  cursor.stack = remaining > 0 ? withCount(held, remaining) : null;
}

/**
 * 双击收集：把容器里的**同类**凑到光标上。
 *
 * 原版（基岩版 Wiki）：双击某一格时，先把那一叠拿到光标上，再把范围内的同类
 * 一格一格并过来，**直到堆叠上限**；上限满了（或根本没有同类可补）时，
 * 调用方应把它退化成"快速移动"（`quickMove`）—— 这个判断留给调用方，
 * 因为这层不知道"哪边算容器"。
 */
export function doubleClickGather(
  slots: SlotAccess,
  rules: MoveRules,
  cursor: Cursor,
  index: number,
  range: readonly number[],
): void {
  let held = cursor.stack;
  const first = slots.get(index);
  if (!held && first) {
    held = first;
    slots.set(index, null);
  }
  if (!held) return;
  const limit = rules.limitOf(held.id);

  for (const targetIndex of range) {
    if (held.count >= limit) break;
    // 不再跳过 `index`：光标上本来就有东西时，被双击的那一格也该并进来
    // （拿起来的分支已经把那一格清空了，这里自然读到 null）
    const target = slots.get(targetIndex);
    if (!target || !rules.sameItem(held, target)) continue;
    const room = limit - held.count;
    if (room <= 0) break;
    const moved = Math.min(room, target.count);
    held = withCount(held, held.count + moved);
    slots.set(targetIndex, target.count - moved > 0 ? withCount(target, target.count - moved) : null);
  }
  cursor.stack = held;
}

/**
 * 长按分堆：从某格取 `count` 个到光标上（触摸端"选数量"的最后一步）。
 *
 * 只做搬运，不碰 UI：绿色占比条、拖动选数量都是**调用方**的事。
 * 光标上已经有别的物品、或同类已满时不动作（与原版一致）。
 */
export function splitTake(
  slots: SlotAccess,
  rules: MoveRules,
  cursor: Cursor,
  index: number,
  count: number,
): void {
  const target = slots.get(index);
  if (!target || count <= 0) return;
  const held = cursor.stack;
  if (held && !rules.sameItem(held, target)) return;
  const limit = rules.limitOf(target.id);
  const room = held ? limit - held.count : limit;
  if (room <= 0) return;
  const take = Math.min(Math.floor(count), target.count, room);
  if (take <= 0) return;
  slots.set(index, target.count - take > 0 ? withCount(target, target.count - take) : null);
  cursor.stack = held ? withCount(held, held.count + take) : withCount(target, take);
}

/**
 * 直接交换两格（数字键 1-9 换到快捷栏、F 换到副手 —— DOM 版的 `swapWithSlot`）。
 *
 * 与"拿在手上再放"不同：它**不经过光标**，所以手上那叠不受影响，也不会触发堆叠逻辑。
 * 返回是否真的换了（同一格、越界都算没换，调用方据此决定要不要重画）。
 */
export function swapSlots(slots: SlotAccess, a: number, b: number): boolean {
  if (a === b || a < 0 || b < 0) return false;
  const left = slots.get(a);
  const right = slots.get(b);
  if (!left && !right) return false;
  slots.set(a, right);
  slots.set(b, left);
  return true;
}

/** 数组版的 `SlotAccess`（测试与预览页用；游戏里换成包着 `Inventory` 的适配器） */
export function arraySlots(stacks: readonly (StackLike | null)[]): SlotAccess & {
  readonly stacks: (StackLike | null)[];
} {
  const copy = [...stacks];
  return {
    stacks: copy,
    get: (index) => copy[index] ?? null,
    set: (index, stack) => {
      copy[index] = stack && stack.count > 0 ? stack : null;
    },
  };
}
