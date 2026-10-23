/**
 * 投掷器（批次 59，H14 的第二件"传输型"容器）
 *
 * 与漏斗是**同一条路的两种驱动方式**——这正是把它们排成相邻两批的原因：
 *
 *   | | 漏斗（批次 58） | 投掷器（批次 59） |
 *   | --- | --- | --- |
 *   | 什么时候动 | **自己按节奏**：每 0.4 秒一轮 | **被信号推**：红石上升沿来一次吐一件 |
 *   | 朝哪儿 | 被点的那个方块（5 向：没有朝上） | **玩家**（6 向，手持放置只给水平四向） |
 *   | 干什么 | 推一件 + 拉一件（先推后拉） | **吐一件**（随机挑一格） |
 *   | 红石的作用 | 通电就**锁定**（不推也不吸） | 通电脉冲就是**动作本身** |
 *
 * 所以这个类里**没有 `tick`、也没有冷却**：它只暴露一个 `serve(env)`，
 * 由主程序在"红石上升沿"那一刻调一次。往哪边吐、吐成什么（塞进容器 / 掉在地上）
 * 都由 `env` 回答——与 `HopperEnv` 同一套分工：容器只认规则，世界在主程序那侧。
 *
 * 一条完整的 `serve` 对齐原版 `DropperBlock#dispenseFrom`：
 *  1. **随机**挑一个非空槽（原版是蓄水池抽样：混装时每一件被挑中的概率相同）；
 *  2. 朝向那一格是容器 → 塞一件进去。**塞不进就什么都不发生**（原版也是：
 *     对面是容器但收不下时会"卡住"，不会改吐到地上）；
 *  3. 不是容器 → 吐成掉落物（由 `env.eject` 主程序生成实体）。
 */

import type { ItemStack, SlotSource } from './Inventory.ts';
import { tryInsertOne } from './Transfer.ts';
import type { SixFacing } from '../registry/blockState.ts';
import { maxStackOf } from '../registry/items.ts';
import type { BlockContainer } from '../world/BlockEntityStore.ts';

/** 投掷器的 9 格（原版投掷器/发射器都是 3×3） */
export const DROPPER_SIZE = 9;

/** 吐一次需要问外界的两个问题（"哪一格是什么容器"只有主程序知道） */
export interface DropperEnv {
  /** 朝向那一格的容器；**不是容器就返回 null**（此时走"吐成掉落物"那条路） */
  target(): BlockContainer | null;
  /** 把这一件吐成掉落物；落点与初速由主程序按朝向算 */
  eject(stack: ItemStack): void;
}

export interface DropperServeResult {
  /** 这一轮真正出去的那一件（什么都没做时是 null） */
  served: ItemStack | null;
  /** 出去的那一件是**塞进对面容器**的（false 且 `served` 非空 = 吐成了掉落物） */
  intoContainer: boolean;
  /** 朝向那一格是容器，但**塞不进去**（原版会卡住：不吐到地上） */
  blocked: boolean;
}

export class Dropper implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(DROPPER_SIZE).fill(null);

  onChange: (() => void) | null = null;
  /**
   * 槽位内容被改动（联机15）：与 `onChange` 分开。
   *
   * `onChange` 是界面刷新，`tick` 里"点燃状态变了"也会调它；联机只关心内容，
   * 而且远端恢复（逐格 `set` 写回）不该触发它——抑制由调用方做（`main.ts` 的 `applyingRemoteBlock`）。
   */
  onMutate: (() => void) | null = null;

  /**
   * 朝哪儿吐（由主程序按方块状态写进来）。
   *
   * 为什么缓存在实例上：与 `Hopper.locked` 同一个理由——界面拿到的只有一个容器实例，
   * 而"这一格朝哪边"在方块状态里。存一份是为了界面能写出"朝北 / 朝下"，
   * 而不用让界面层反向依赖方块表（吐东西本身**不读**这个字段：`env` 已经算好了偏移）。
   */
  facing: SixFacing = 'down';

  /**
   * 随机源（默认 `Math.random`）。
   *
   * 抽成参数只有一个理由：**断言要确定性**——"9 格里混装时挑哪一格"这件事
   * 必须能在离线测试里钉死（原版自己也是可注入的 `RandomSource`）。
   */
  constructor(private readonly random: () => number = Math.random) {}

  /** 这辈子吐出去多少件（调试面板与断言用） */
  servedCount = 0;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= DROPPER_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= DROPPER_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.onMutate?.();
    this.onChange?.();
  }

  get isEmpty(): boolean {
    return this.slots.every((slot) => slot === null);
  }

  get isFull(): boolean {
    return this.slots.every((slot) => slot !== null && slot.count >= maxStackOf(slot.id));
  }

  /** 有几格装着东西（界面提示与断言用） */
  get usedSlots(): number {
    return this.slots.filter((slot) => slot !== null).length;
  }

  get size(): number {
    return DROPPER_SIZE;
  }

  /**
   * 随机挑一格**但不取走**（批次 60：发射器要先看看是什么，才知道该做什么）。
   *
   * 投掷器用不到它——它闭着眼吐；发射器必须"先看再决定"：箭要射、TNT 要点、
   * 打火石要"用一下但不吐出去"。所以这里把"随机挑格子"这一步单独开出来，
   * 与 `serve` 共用同一个蓄水池抽样（不会有第二套"随机"悄悄漂移）。
   */
  peekRandom(): { slot: number; stack: ItemStack } | null {
    const slot = this.randomSlot();
    if (slot < 0) return null;
    return { slot, stack: this.slots[slot]! };
  }

  /**
   * 取走指定格的一件（返回副本，与 `serve` 交给外面的东西逐字段一致）。
   *
   * 空格返回 null —— 调用方不用自己判"这一格还在不在"。
   */
  takeAt(slot: number): ItemStack | null {
    const stack = this.slots[slot];
    if (!stack) return null;
    const taken: ItemStack = { id: stack.id, count: 1, ...extrasOf(stack) };
    stack.count -= 1;
    if (stack.count <= 0) this.slots[slot] = null;
    this.onChange?.();
    return taken;
  }

  /**
   * 消耗指定格那件东西的**耐久**（批次 60：打火石这类"用了但没吐出去"的行为）。
   *
   * @param durability 这件东西的耐久上限（由调用方从物品表取，容器不必认识工具表）
   * @returns 这件东西还在不在（归零就是整件消失）
   */
  wearAt(slot: number, amount: number, durability: number): boolean {
    const stack = this.slots[slot];
    if (!stack) return false;
    const damage = (stack.damage ?? 0) + amount;
    if (damage >= durability) {
      this.slots[slot] = null;
      this.onChange?.();
      return false;
    }
    stack.damage = damage;
    this.onChange?.();
    return true;
  }

  /**
   * 随机挑一个非空槽（**蓄水池抽样**，与原版 `DispenserBlock#getRandomSlot` 同一套）。
   *
   * 为什么不是"在非空槽里均匀取一个下标"：那种写法要先数一遍非空槽、再取第二个随机数，
   * 而蓄水池抽样一趟扫完、每个非空槽被选中的概率都是 1/n——混装时"哪一件先出去"
   * 才是公平的（原版就是靠这个让混装的投掷器看起来"什么都有可能吐出来"）。
   */
  private randomSlot(): number {
    let picked = -1;
    let seen = 1;
    for (let index = 0; index < DROPPER_SIZE; index++) {
      if (!this.slots[index]) continue;
      if (this.random() * seen < 1) picked = index;
      seen++;
    }
    return picked;
  }

  /**
   * 吐一件（红石上升沿调一次）。
   *
   * ⚠️ 三条"不能凭空造东西/丢东西"的次序：
   *  1. 先确认**有东西**（空投掷器通电什么也不发生，原版连音效都没有）；
   *  2. 对面是容器时，塞进去用 `tryInsertOne`（它是"能塞才改"的：失败时目标容器
   *     没有任何副作用）。塞不进就整件事取消——不能"先扣掉自己的、再发现塞不进去"；
   *  3. 吐成掉落物这条路**先扣自己的**再交给 `eject`（生成实体不会失败）。
   */
  serve(env: DropperEnv): DropperServeResult {
    const result: DropperServeResult = { served: null, intoContainer: false, blocked: false };
    const pick = this.peekRandom();
    if (!pick) return result;
    const target = env.target();

    if (target) {
      // `tryInsertOne` 是"能塞才改"的：它返回 false 时目标容器没有任何副作用，
      // 所以"塞不进"这一支不需要先问一遍、也不需要回滚
      if (!tryInsertOne(target, pick.stack)) {
        // 对面是容器但收不下：卡住（原版不会改吐到地上，得玩家自己去腾地方）
        result.blocked = true;
        return result;
      }
      result.served = this.takeAt(pick.slot);
      this.servedCount++;
      result.intoContainer = true;
      return result;
    }

    // 对面不是容器：吐成掉落物（先扣自己的，再交给外面生成实体——生成不会失败）
    const ejected = this.takeAt(pick.slot);
    if (!ejected) return result;
    this.servedCount++;
    env.eject(ejected);
    result.served = ejected;
    return result;
  }
}

/** 附加数据副本（耐久 / 附魔 / 改名 / 累积惩罚）——吐出去的东西不该被洗成白板 */
function extrasOf(stack: ItemStack): Partial<ItemStack> {
  const extras: Partial<ItemStack> = {};
  if (stack.damage !== undefined) extras.damage = stack.damage;
  if (stack.enchants !== undefined) extras.enchants = { ...stack.enchants };
  if (stack.name !== undefined) extras.name = stack.name;
  if (stack.repairCost !== undefined) extras.repairCost = stack.repairCost;
  return extras;
}
