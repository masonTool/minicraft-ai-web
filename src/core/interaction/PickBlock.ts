/**
 * 中键拾取方块（Pick Block）——批次 129
 *
 * 原版最常用的交互之一：**中键点准星指着的方块，把它塞进快捷栏**。规则三条
 * （「Minecraft Wiki · Inventory」那张表 + 原版行为）：
 *
 *  1. 这个东西**已经在快捷栏里** → 直接**切到那一格**（不动任何物品）；
 *  2. 它在**主背包里** → 把它和**当前选中的快捷栏格交换**
 *     （原版就是把那一叠"拽"到手上，被换下来的那叠回到原来那一格）；
 *  3. 两边都没有 → **创造模式**（本项目的口径：能飞 = 创造，见 `main.isCreative`）直接给一份；
 *     生存模式里**什么也不做**（原版也如此——你没见过的东西不能凭空捡）。
 *
 * 为什么单独一个纯模块：这三条**全是"改动玩家背包"的操作**，写错一条的症状都很轻
 * （"东西怎么挪了位置""怎么没反应"），而它在真机上要反复按中键才看得出来。
 * 抽成纯函数之后三条各有一条断言（`test:pickblock`）。
 *
 * ⚠️ 与原版的差异（记在 TASKS H19）：
 *  - **不做"中键点生物拿刷怪蛋"**（本项目没有刷怪蛋这件东西）；
 *  - **作物这一类拾取的是"方块本身"而不是作物物品**：原版中键点成熟的小麦给的是**小麦**，
 *    而本项目给的是那个作物方块（`WHEAT_STAGE3`）——因为本项目**每种方块都有物品形态**
 *    （创造物品栏要用），于是 `pickItemFor` 的第一步就命中了。这是数据模型的直接后果，
 *    不是判据写错；真要跟原版一致，得给"作物方块"加一条"拾取时用掉落"的标记；
 *  - **拾取时不播放任何提示**（原版也没有提示音；UI 音效见 M21）。
 */

import {
  HOTBAR_SIZE,
  HOTBAR_START,
  MAIN_SIZE,
  MAIN_START,
  type Inventory,
} from '../container/Inventory.ts';
import { dropFor, itemDef } from '../registry/items.ts';

/** 拾取的三种去向（`null` = 什么也不做） */
export type PickPlan =
  /** 它已经在快捷栏那一格 → 只是切过去 */
  | { kind: 'select'; slot: number }
  /** 它在主背包那一格 → 与当前选中的快捷栏格交换 */
  | { kind: 'swap'; from: number; to: number }
  /** 两边都没有，但可以凭空给（创造） → 放进当前选中的那一格 */
  | { kind: 'give'; to: number; itemId: number }
  | null;

/**
 * 这一格方块"拾取出来"是哪件物品（`null` = 拾不了）。
 *
 * 两步：**先看这个方块自己有没有物品形态**（绝大多数方块有，`stone` 的 id 就是 `stone`），
 * 没有就退到它的**掉落**（小麦、耕地、火这些只有掉落甚至什么都没有）。
 *
 * ⚠️ 顺序不能反：先看掉落的话，**石头会拾取成圆石**（掉落是圆石），
 * 而原版中键拾取石头给的是石头本身。
 */
export function pickItemFor(blockId: number): number | null {
  if (itemDef(blockId) !== undefined) return blockId;
  return dropFor(blockId)?.id ?? null;
}

/** 快捷栏（0~8）里有没有这件东西 → 返回那一格 */
function findInHotbar(inventory: Inventory, itemId: number): number | null {
  for (let i = HOTBAR_START; i < HOTBAR_START + HOTBAR_SIZE; i++) {
    if (inventory.get(i)?.id === itemId) return i;
  }
  return null;
}

/** 主背包（9~35）里有没有这件东西 → 返回那一格 */
function findInMain(inventory: Inventory, itemId: number): number | null {
  for (let i = MAIN_START; i < MAIN_START + MAIN_SIZE; i++) {
    if (inventory.get(i)?.id === itemId) return i;
  }
  return null;
}

/**
 * 按上面那三条规则算出"这次中键该做什么"（纯函数，不改动任何东西）。
 *
 * @param hotbarIndex 当前选中的快捷栏格（`main.hotbarIndex`）
 * @param creative 是不是创造模式（本项目的口径：能飞 = 创造）
 */
export function planPickBlock(
  inventory: Inventory,
  itemId: number,
  hotbarIndex: number,
  creative: boolean,
): PickPlan {
  const to = HOTBAR_START + Math.max(0, Math.min(HOTBAR_SIZE - 1, hotbarIndex));

  // ① 已经在快捷栏 → 切过去
  const inHotbar = findInHotbar(inventory, itemId);
  if (inHotbar !== null) {
    if (inHotbar === to) return null; // 手上就是它：什么都不用做（不必刷一次界面）
    return { kind: 'select', slot: inHotbar };
  }

  // ② 在主背包 → 与选中的那一格交换
  const inMain = findInMain(inventory, itemId);
  if (inMain !== null) {
    if (to === inMain) return null;
    return { kind: 'swap', from: inMain, to };
  }

  // ③ 都没有：创造模式给一份，生存什么也不做
  if (creative) return { kind: 'give', to, itemId };
  return null;
}

/**
 * 把 `planPickBlock` 的结果落到背包上（主程序与测试都走这一条）。
 *
 * ⚠️ `'select'` 这一档**在这里不落地**：它改的是"选中格"（`main.hotbarIndex`），
 * 而选中格不在背包数据里——调用方看到 `moved === false` 且 `plan.kind === 'select'`
 * 就知道"该切格子了"（主程序那边一句 `selectSlot`）。
 */
export function applyPickBlock(inventory: Inventory, plan: PickPlan): boolean {
  if (!plan) return false;
  switch (plan.kind) {
    case 'select':
      return false;
    case 'swap': {
      const from = inventory.get(plan.from);
      const to = inventory.get(plan.to);
      inventory.set(plan.to, from ?? null);
      inventory.set(plan.from, to ?? null);
      return true;
    }
    case 'give': {
      // 手上那一格已经有别的东西时**不动它**（原版是盖在上面、把原来那叠丢在地上，
      // 这里选择"什么都不做"：丢东西是最不可逆的一类操作，宁可少做）
      if (inventory.get(plan.to)) return false;
      inventory.set(plan.to, { id: plan.itemId, count: 1 });
      return true;
    }
  }
}
