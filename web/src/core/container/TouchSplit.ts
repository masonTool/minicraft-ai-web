/**
 * 触摸端"长按选数量"（批次 137）——基岩版物品栏里长按一格时出现的那个指示条。
 *
 * 参照物：`references/物品栏 - 中文 Minecraft Wiki.mhtml`「触摸操作 [仅基岩版]」那一条，
 * 原文（逐字）：
 *
 * > 长按带有物品的格子作为来源格，会出现一个指示条，显示当前选中物品的数量，
 * > 指示条的绿色部分代表选中数量占该格该物品总数的占比。
 * > 一开始会选中半数物品（向上取整），保持长按向左划会减少选中数量（至少1个），
 * > 向右划则增加选中数量（直至选中全部物品）。松手后，可以点击一个空格子或放有同类物品的格子
 * > 作为目标格，将选中数量的物品移动到目标格中。
 * > 目标格的物品堆叠数目达到上限后，超出部分会留在来源格中。
 *
 * 本项目之前的长按是"右键语义（取一半）+ 连发"——**取一半这一步碰巧对了**，
 * 但玩家没法改那个数量，也无法在松手前看清"到底拿了几个"。
 *
 * 这一份只管规则（初值 / 划动的映射 / 指示条占比 / 拆分结果），界面只交像素：
 * 那几条"写错了也没人报 bug"的映射（差一格、少一个、划到头不回弹）都靠离线断言钉住。
 */

import { type ItemStack, stackExtras } from './Inventory.ts';

/** 只有 2 个以上的格子里才有"选数量"可言（1 个的长按应当是别的语义） */
export const SPLIT_MIN_TOTAL = 2;

/**
 * 划动一整个**格子宽度**刚好走完"到两端"的距离。
 *
 * ⚠️ 用"整格宽度"而不是固定像素：格子尺寸在手机横屏/竖屏/桌面三档都不一样
 * （CSS 里是 42px / 46px / 34px），写死像素就会在某一档上"划一寸就到底"。
 */
export const SPLIT_DRAG_SPAN_CELLS = 1;

/**
 * 这一格现在能不能进入"长按选数量"。
 *
 * 三种情形不行：
 *  - 空格子（没有东西可选）；
 *  - 只有 1 个（"选一半"= 1，"选全部"= 1，指示条毫无意义）；
 *  - **手上已经拿着东西**（那时长按是"放下一个 / 连续放"，与选数量是两件事）。
 *
 * 只取不放的槽位（合成结果、熔炉产物）由调用方另行排除：那些槽位没有"来源格"的身份。
 */
export function canSplitStack(stack: ItemStack | null, holding: boolean): boolean {
  if (holding) return false;
  return !!stack && stack.count >= SPLIT_MIN_TOTAL;
}

/** 一开始选中的数量：**半数向上取整**（Wiki 原文），且至少 1 个 */
export function initialSplitCount(total: number): number {
  if (total <= 0) return 0;
  if (total < SPLIT_MIN_TOTAL) return total;
  return Math.min(total, Math.ceil(total / 2));
}

/**
 * 按住划动之后的数量。
 *
 * 映射按"到那一端的剩余量"算，而不是按"总数"算：
 *  - 向右划：`剩下多少就分多少给这一格宽度` —— 划满一格宽度 = 选中**全部**；
 *  - 向左划：同理划满一格宽度 = 减到 **1 个**。
 * 这样两个方向都是"一寸到底"，不会出现"64 个要划三寸、2 个划一下就越界"。
 *
 * @param total     这一格原本的总数
 * @param start     按下那一刻选中的数量（`initialSplitCount`）
 * @param dx        手指相对按下位置的横向位移（像素，向右为正）
 * @param cellWidth 一格的实际宽度（像素，取 `getBoundingClientRect().width`）
 */
export function splitCountForDrag(total: number, start: number, dx: number, cellWidth: number): number {
  if (total <= 0) return 0;
  if (total < SPLIT_MIN_TOTAL) return total;
  const base = clampCount(start, total);
  const width = Math.max(1, cellWidth) * SPLIT_DRAG_SPAN_CELLS;
  if (dx > 0) {
    const remaining = total - base;
    return clampCount(base + Math.round((dx / width) * remaining), total);
  }
  if (dx < 0) {
    const movable = base - 1;
    return clampCount(base - Math.round((-dx / width) * movable), total);
  }
  return base;
}

/** 指示条的绿色部分占多少（0~1）：Wiki 原文"绿色部分代表选中数量占该格该物品总数的占比" */
export function splitFraction(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, count / total));
}

/**
 * 把一格拆成"手上拿走的"与"留在原处的"两份。
 *
 * ⚠️ 附加数据（耐久 / 附魔 / 改名）必须**跟着走**：不然铁砧改过名的剑拆一半之后，
 * 留在原处的那把会突然变回默认名字。
 */
export function splitStack(stack: ItemStack, count: number): { taken: ItemStack | null; rest: ItemStack | null } {
  // ⚠️ 这里**允许 0**（"一个都不拿"），所以不能复用 `clampCount`（它下限是 1）
  const take = Number.isFinite(count) ? Math.min(stack.count, Math.max(0, Math.round(count))) : 0;
  if (take <= 0) return { taken: null, rest: stack };
  const taken: ItemStack = { id: stack.id, count: take, ...stackExtras(stack) };
  // 两份各拿一份附加数据的副本：共用同一个 `enchants` 对象的话，改一份会顺手改到另一份
  const rest: ItemStack | null =
    stack.count - take > 0 ? { id: stack.id, count: stack.count - take, ...stackExtras(stack) } : null;
  return { taken, rest };
}

function clampCount(count: number, total: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(total, Math.max(1, Math.round(count)));
}
