/**
 * 背包数据模型
 *
 * 槽位编号完全对齐原版：
 *   0-8   快捷栏
 *   9-35  主背包（3 行 × 9 列）
 *   36-39 盔甲（头盔/胸甲/护腿/靴子）
 *   40    副手
 *
 * 堆叠用可变对象表示（`{ id, count }`），count 归零即视为空槽，由 set() 统一归一化，
 * 这样 UI 拖拽时不必到处判断"数量为 0 的残留槽位"。
 */

import { ARMOR_SLOT_BASE, armorSlotAccepts } from '../registry/armor.ts';
import { itemDef, maxStackOf } from '../registry/items.ts';
// 书页的规整规则（批次 190）：与编辑界面**同一套**，否则会出现"能打 300 字、读档剩 256 字"
import { BOOK_TITLE_CHARS, isBlankBook, sanitizePages } from '../items/Book.ts';

export interface ItemStack {
  id: number;
  count: number;
  /**
   * 工具/盔甲的已损耗耐久（0 表示崭新）。
   * 普通方块与材料不带这个字段，因此存档里不会多出一堆 `damage: 0`。
   */
  damage?: number;
  /**
   * 附魔（H9）：附魔 id → 等级。
   * 与 `damage` 同样是"可选 + 跟着栈走"，用普通对象而不是 Map 是为了能直接进存档。
   */
  enchants?: Record<string, number>;
  /** 铁砧改过的名字（H8）；没改过就不带这个字段 */
  name?: string;
  /**
   * 铁砧的累积惩罚（原版 `RepairCost`）：每上过一次铁砧就 `2 × 旧值 + 1`，
   * 下次操作要多花这么多级。不带这个字段表示"没用过铁砧"（0）。
   */
  repairCost?: number;
  /**
   * **内容物**（批次 72，潜影盒）：装在物品里的若干格东西（空格为 `null`）。
   *
   * 这是"物品携带数据"里最重的一项——前面几项（耐久/附魔/改名）都是几个数，
   * 而这一项是**一整个容器**：潜影盒被挖下来时把内容一起带走、放下时再倒回方块里。
   * 因此它有两处刻意的限制：
   *  1. **只嵌一层**：原版禁止把潜影盒放进潜影盒，所以不需要递归的嵌套结构，
   *     校验与深拷贝都只做一层（下面是 `copyContents` / `sameContents`）；
   *  2. 与其它附加数据一样走"可选字段"：普通方块/材料不带它，存档里不会多出一片 `contents: []`。
   */
  contents?: (ItemStack | null)[];
  /**
   * **书页**（批次 190，书与笔 / 成书）：每一页一段文字。
   *
   * 与 `contents` 一样是"整块数据"，但它是**纯文本**，所以校验简单得多：
   * 只收字符串、去掉控制字符、每页截到 256 字、最多 50 页（原版是 100 页 / 每页 1023 字，
   * 我们的界面一页装不下那么多，截短之后玩家看到的与实际存的一致）。
   *
   * 空书（还没写过）不带这个字段——存档里不会多出一片 `pages: []`。
   */
  pages?: string[];
  /** 成书的标题（只有成书有；书与笔的"书名"在写过程里由界面自己留着） */
  title?: string;
}

/**
 * 把一份**外部数据**（存档、手改过的库、旧版本）校验着读成一个栈；
 * 认不出来的一律丢掉，返回 `null` 表示"这一格什么都没有"。
 *
 * ⚠️ 这是全项目**唯一**一处"栈的字段白名单"（批次 72 收口）：
 * 以前 `Inventory.restore` 与 `ContainerSave` 各写了一份，于是每次加新字段
 * （耐久 → 附魔 → 改名 → 累积惩罚 → 内容物）都要在**两处**补一遍——
 * 这一批就真的漏了一处：潜影盒的 `contents` 在物品栏读档时被丢掉
 * （表现是"盒子里存着东西，重进游戏空了"，而盒子的其它字段全都正常）。
 *
 * @param depth 允许嵌几层内容物：原版禁止"盒装盒"，所以默认 1 层（内层再带 contents 会被丢掉）
 */
export function restoreStack(raw: unknown, depth = 1): ItemStack | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ItemStack>;
  if (typeof candidate.id !== 'number' || typeof candidate.count !== 'number') return null;
  if (candidate.count <= 0) return null;
  // 物品被删过的旧存档：留着这个 id 只会让"背包里出现一件空白"，直接丢掉
  if (itemDef(candidate.id) === undefined) return null;

  const stack: ItemStack = { id: candidate.id, count: candidate.count };
  // 旧存档没有 damage 字段；顺手夹紧非法值，避免坏存档把工具直接判成"已损坏"
  if (typeof candidate.damage === 'number' && candidate.damage > 0) stack.damage = Math.floor(candidate.damage);
  // 附魔同理：只收"看起来像附魔表"的对象，坏存档不会把整件物品读崩
  if (candidate.enchants && typeof candidate.enchants === 'object') {
    const enchants: Record<string, number> = {};
    for (const [id, level] of Object.entries(candidate.enchants)) {
      if (typeof level === 'number' && level > 0) enchants[id] = Math.floor(level);
    }
    if (Object.keys(enchants).length > 0) stack.enchants = enchants;
  }
  // 改名与累积惩罚同理：只收合法值
  if (typeof candidate.name === 'string' && candidate.name.length > 0) stack.name = candidate.name.slice(0, 64);
  if (typeof candidate.repairCost === 'number' && candidate.repairCost > 0) {
    stack.repairCost = Math.floor(candidate.repairCost);
  }
  // 内容物（潜影盒）：**只嵌一层**；空盒子不带这个字段（存档里不会多出一片空数组）
  if (depth > 0 && Array.isArray(candidate.contents)) {
    const inner = candidate.contents.map((item) => restoreStack(item, depth - 1));
    if (inner.some((item) => item !== null)) stack.contents = inner;
  }
  // 书页与书名（批次 190，书与笔/成书）：只收字符串，逐页规整（与编辑期同一套规则，
  // 免得"界面里能打 300 字、读档回来只剩 256 字"）
  if (Array.isArray(candidate.pages)) {
    const pages = sanitizePages(candidate.pages.filter((page): page is string => typeof page === 'string'));
    if (!isBlankBook(pages)) stack.pages = pages;
  }
  if (typeof candidate.title === 'string' && candidate.title.trim().length > 0) {
    stack.title = candidate.title.trim().slice(0, BOOK_TITLE_CHARS);
  }
  return stack;
}

/**
 * 深拷一份内容物（潜影盒那类"物品里装着东西"的栈要用）。
 *
 * 抽出来的理由与 `stackExtras` 一样：它是**嵌套结构**，每处各写一遍必然会漏一层，
 * 而漏掉的表现是"读档后箱子里空了"或者"改背包顺手改了存档里的那份"。
 */
export function copyContents(contents: readonly (ItemStack | null)[]): (ItemStack | null)[] {
  return contents.map((inner) => (inner ? { id: inner.id, count: inner.count, ...stackExtras(inner) } : null));
}

/** 两份内容物是否完全一样（合并判定用：装了不同东西的两个潜影盒**不能并堆**） */
export function sameContents(
  a: readonly (ItemStack | null)[] | undefined,
  b: readonly (ItemStack | null)[] | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i] ?? null;
    const right = b[i] ?? null;
    if (left === null || right === null) {
      if (left !== right) return false;
      continue;
    }
    // 里面那一层要连**数量**与附加数据一起比：
    // 只比 id 的话，"装着 1 颗钻石"与"装着 2 颗钻石"会被当成同一个盒子
    if (left.count !== right.count) return false;
    if (!sameStack(left, right)) return false;
  }
  return true;
}

/**
 * 槽位数据源：让界面里的拖拽逻辑对"背包"和"合成网格"一视同仁。
 */
export interface SlotSource {
  get(index: number): ItemStack | null;
  set(index: number, stack: ItemStack | null): void;
}

/**
 * 把"可选的栈附加数据"（耐久 / 附魔）拷成一个新对象。
 *
 * 抽成函数的原因：`take`、`serialize`、提示框、附魔台都要搬这几项，
 * 每处各写一遍三元表达式的话，加第三项时必然漏掉一处——
 * 耐久当初就是这么一项项加进来的（并且 `moveTo` 的交换分支也因此漏过一次搬运）。
 */
export function stackExtras(stack: ItemStack): Partial<ItemStack> {
  const extras: Partial<ItemStack> = {};
  if (stack.damage !== undefined) extras.damage = stack.damage;
  if (stack.enchants !== undefined) extras.enchants = { ...stack.enchants };
  if (stack.name !== undefined) extras.name = stack.name;
  if (stack.repairCost !== undefined) extras.repairCost = stack.repairCost;
  // 内容物要**深拷**（潜影盒）：直接交引用的话，改背包里的那份会顺手改到"已经取出的快照"
  if (stack.contents !== undefined) extras.contents = copyContents(stack.contents);
  // 书页同理要拷一份数组（批次 190）：不拷的话"翻页改字"会改到掉落物/箱子里那份
  if (stack.pages !== undefined) extras.pages = [...stack.pages];
  if (stack.title !== undefined) extras.title = stack.title;
  return extras;
}

/**
 * 两份栈的**附加数据**是否一致（耐久 / 附魔 / 改名 / 累积惩罚）。
 *
 * 合并判定必须连它一起比：只比 id 的话，"铁砧改过名的石头"并进普通那堆就把名字弄丢了
 * （自动搬运、掉落物拾取、箱子互拖都踩过同一个坑）。
 *
 * 放在这里而不是 `container/Transfer.ts`：`Inventory` 是这一层的**地基**，
 * 搬运方与掉落物都要用它，而反过来（Inventory 依赖搬运方）会绕成一个环。
 */
export function sameExtras(a: Partial<ItemStack>, b: Partial<ItemStack>): boolean {
  // 内容物（潜影盒）必须先比：只比 id 的话，两个"装着不同东西"的潜影盒会被并堆，
  // 结果是一整箱东西凭空消失（无人值守的自动搬运也会这么做）
  if (!sameContents(a.contents, b.contents)) return false;
  if ((a.damage ?? 0) !== (b.damage ?? 0)) return false;
  if ((a.repairCost ?? 0) !== (b.repairCost ?? 0)) return false;
  if ((a.name ?? '') !== (b.name ?? '')) return false;
  // 书名与页（批次 190）：两本内容不同的书**不能并堆**（原版也不并）
  if ((a.title ?? '') !== (b.title ?? '')) return false;
  const pagesA = a.pages ?? [];
  const pagesB = b.pages ?? [];
  if (pagesA.length !== pagesB.length) return false;
  for (let i = 0; i < pagesA.length; i++) if (pagesA[i] !== pagesB[i]) return false;
  const from = a.enchants ?? {};
  const to = b.enchants ?? {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) if ((from[key] ?? 0) !== (to[key] ?? 0)) return false;
  return true;
}

/** 两份栈是不是**同一件东西**（同 id + 同附加数据）——合并/堆叠判定用它 */
export function sameStack(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && sameExtras(a, b);
}

export const HOTBAR_START = 0;
export const HOTBAR_SIZE = 9;
export const MAIN_START = 9;
export const MAIN_SIZE = 27;
export const ARMOR_START = ARMOR_SLOT_BASE;
export const ARMOR_SIZE = 4;
export const OFFHAND_SLOT = 40;
export const TOTAL_SLOTS = 41;

/** 自动拾取只会用到的槽位区间（[0, 36)）：盔甲槽与副手槽不参与自动填充 */
export const AUTO_FILL_SLOTS = ARMOR_SLOT_BASE;

export class Inventory implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(TOTAL_SLOTS).fill(null);

  /** 槽位内容变化时触发（UI 刷新用） */
  onChange: (() => void) | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= TOTAL_SLOTS) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= TOTAL_SLOTS) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.notify();
  }

  /**
   * 放入物品（优先进已有堆叠，再占空槽）。
   *
   * 只填 0-35（快捷栏与主背包）：盔甲槽与副手槽**不参与自动拾取**——
   * 否则捡到的铁靴子会自己"穿"到 36 号槽上，与原版行为不符（原版只有主动装备才会穿）。
   *
   * @returns 未能放入的剩余数量
   */
  /**
   * 放入若干件物品（**白板**：不带耐久/附魔/改名）。
   *
   * 绝大多数调用点（合成产物、生物掉落、命令给东西）都是这一种，所以留着这个简写。
   */
  add(itemId: number, count: number): number {
    return this.addStack({ id: itemId, count });
  }

  /**
   * 放入**一整份物品栈**（批次 63）：附加数据一起带进背包。
   *
   * 与 `add` 的两点差别：
   *  1. 耐久 / 附魔 / 改名 / 累积惩罚原样带进去；
   *  2. **只与"完全一样的栈"合并**——只比 id 的话，"改了名的石头"并进普通那堆
   *     就把名字弄丢了（掉落物拾取、漏斗搬运、箱子互拖是同一个坑）。
   *
   * @returns 未能放入的剩余数量（0 表示全收下）
   */
  addStack(stack: ItemStack): number {
    const count = stack.count;
    if (count <= 0) return 0;
    const limit = maxStackOf(stack.id);
    let remaining = count;

    for (let i = 0; i < AUTO_FILL_SLOTS && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || !sameStack(slot, stack)) continue;
      const room = limit - slot.count;
      if (room <= 0) continue;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }

    for (let i = 0; i < AUTO_FILL_SLOTS && remaining > 0; i++) {
      if (this.slots[i]) continue;
      const moved = Math.min(limit, remaining);
      this.slots[i] = { ...stackExtras(stack), id: stack.id, count: moved };
      remaining -= moved;
    }

    if (remaining !== count) this.notify();
    return remaining;
  }

  /**
   * 第 index 号槽位能不能放这件物品。
   * 盔甲槽（36-39）只吃对应部位；其余槽位不限——界面在"放下/交换"之前先问一句。
   */
  canPlace(index: number, itemId: number): boolean {
    return armorSlotAccepts(index, itemId);
  }

  /** 从槽位取出指定数量；数量不足时按实际数量取出 */
  take(index: number, count: number): ItemStack | null {
    const slot = this.get(index);
    if (!slot || count <= 0) return null;
    const moved = Math.min(slot.count, count);
    slot.count -= moved;
    const taken: ItemStack = { id: slot.id, count: moved, ...stackExtras(slot) };
    if (slot.count <= 0) this.slots[index] = null;
    this.notify();
    return taken;
  }

  /** 消耗指定物品，数量不足则不做任何改动并返回 false */
  consume(itemId: number, count: number): boolean {
    if (this.countOf(itemId) < count) return false;
    let remaining = count;
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const slot = this.slots[i];
      if (!slot || slot.id !== itemId) continue;
      const moved = Math.min(slot.count, remaining);
      slot.count -= moved;
      remaining -= moved;
      if (slot.count <= 0) this.slots[i] = null;
    }
    this.notify();
    return true;
  }

  /**
   * 导出全部槽位（存档用）。
   * 返回定长的 41 项数组，空槽为 null——不存下标，读档时按下标直接还原。
   */
  serialize(): Array<ItemStack | null> {
    return this.slots.map((slot) => (slot ? { id: slot.id, count: slot.count, ...stackExtras(slot) } : null));
  }

  /** 从存档恢复槽位（长度不符时按能恢复的部分恢复） */
  restore(data: ReadonlyArray<ItemStack | null>): void {
    // 逐格走**唯一**那一处字段白名单（`restoreStack`）：加新字段时不会再漏掉背包这一路
    for (let i = 0; i < TOTAL_SLOTS; i++) this.slots[i] = restoreStack(Array.isArray(data) ? data[i] : null);
    this.notify();
  }

  countOf(itemId: number): number {
    let total = 0;
    for (const slot of this.slots) if (slot && slot.id === itemId) total += slot.count;
    return total;
  }

  /** 背包中第一个该物品的槽位下标，找不到返回 -1 */
  find(itemId: number): number {
    return this.slots.findIndex((slot) => slot !== null && slot.id === itemId);
  }

  /** 拖拽用的合并/交换语义 */
  moveTo(from: number, to: number): void {
    if (from === to) return;
    const source = this.get(from);
    if (!source) return;
    // 目标槽位不收这件东西（例如把石头塞进头盔位）就整次操作作废，不做半途改动
    if (!this.canPlace(to, source.id)) return;
    const target = this.get(to);

    if (!target) {
      this.slots[to] = source;
      this.slots[from] = null;
    } else if (sameStack(target, source) && maxStackOf(target.id) > 1) {
      // 只能堆叠的物品才合并，**而且必须"完全一样"**（批次 63：改了名的栈并进普通那堆
      // 会把名字弄丢）；工具（maxStack 1）走下面的交换分支，
      // 否则两把同款工具互拖会变成"什么都没发生"
      const room = maxStackOf(target.id) - target.count;
      const moved = Math.min(room, source.count);
      target.count += moved;
      source.count -= moved;
      if (source.count <= 0) this.slots[from] = null;
    } else {
      this.slots[from] = target;
      this.slots[to] = source;
    }
    this.notify();
  }

  get isEmpty(): boolean {
    return this.slots.every((slot) => slot === null);
  }

  clear(): void {
    this.slots.fill(null);
    this.notify();
  }

  notify(): void {
    this.onChange?.();
  }
}
