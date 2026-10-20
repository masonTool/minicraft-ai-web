/**
 * 盔甲架上的装备（B51，批次 492）
 *
 * 与展示框（`ItemFrame.ts`）、告示牌（`SignText.ts`）是**同一种结构**：
 * 方块本身只说"这一格有个架子"，"架子上穿了什么"是运行时数据——
 * 四个槽各是一整件物品（id + 数量 + 耐久 + 附魔 + 名字），塞不进一个字节的状态位。
 *
 * 所以照抄那一套：
 *  - 按坐标存表，键 `维度|x,y,z`（三个维度共用一套区块存储，坐标会重叠）；
 *  - **空架子不进表**（与"空框不进表""空容器不写存档"同一条口径）；
 *  - 序列化/反序列化逐条校验、坏的跳过，绝不让一条脏数据把整份读没了。
 *
 * 槽位编号与 `armor.ts` 的 `ArmorInfo.slot` **完全一致**（0 头 / 1 胸 / 2 腿 / 3 靴），
 * 这样"从背包穿到架子"只是搬一个下标，不需要再做一次映射
 * （两套编号各写一遍是这类模块最常见的错源）。
 */

import { isDimension } from '../gen/Dimension.ts';
import { armorInfoById } from '../registry/armor.ts';
import { restoreStack, stackExtras, type ItemStack } from '../container/Inventory.ts';

/** 盔甲架的槽位数（= `ARMOR_SLOT_COUNT`） */
export const ARMOR_STAND_SLOTS = 4;

/** 四个槽位的中文名（顺序与 `ArmorInfo.slot` 一致） */
export const ARMOR_STAND_SLOT_LABELS: readonly string[] = ['头盔', '胸甲', '护腿', '靴子'];

/** 架子上的一件装备 */
export interface ArmorStandEntry {
  dimension: string;
  x: number;
  y: number;
  z: number;
  /** 长度恒为 4 的槽位数组（空槽是 null） */
  slots: readonly (ItemStack | null)[];
}

/** 存档里的一条（与 `ArmorStandEntry` 同构；单独声明是为了格式改名时不影响内存结构） */
export interface SerializedArmorStand {
  dimension: string;
  x: number;
  y: number;
  z: number;
  slots: readonly (ItemStack | null)[];
}

/** 深拷一件装备（`stackExtras` 是这一层的唯一出处：它连潜影盒内容都深拷一层） */
function cloneStack(item: ItemStack): ItemStack {
  return { id: item.id, count: item.count, ...stackExtras(item) };
}

/** 表里的键：与容器、牌子、展示框同一套写法（`维度|x,y,z`） */
export function armorStandKey(dimension: string, x: number, y: number, z: number): string {
  return `${dimension}|${x},${y},${z}`;
}

/**
 * 这件物品该放进哪个槽（**不是装备就是 null**）。
 *
 * 只看 `armor.ts` 的注册表：皮革/锁链/铁/金/钻石/下界合金六档全都登记在那里，
 * 所以"能不能放到架子上"与"能不能穿"天然是同一条判据，不会两处走偏。
 */
export function armorSlotForItem(itemId: number): 0 | 1 | 2 | 3 | null {
  const info = armorInfoById(itemId);
  return info ? info.slot : null;
}

/**
 * 把外部数据规整成"长度 4、每项要么是合法物品要么是 null"。
 *
 * 这一层挡住三类脏数据：数组长度不对（补 null / 截断）、某一项不是物品
 * （`restoreStack` 返回 null）、以及数量离谱（夹到 1）。
 */
export function normalizeStandSlots(raw: unknown): (ItemStack | null)[] {
  const out: (ItemStack | null)[] = [null, null, null, null];
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < ARMOR_STAND_SLOTS; i++) {
    const stack = restoreStack(raw[i], 1);
    if (!stack) continue;
    // 架子上的一件装备永远是"一个"：原版也不能在架子上叠
    stack.count = 1;
    out[i] = stack;
  }
  return out;
}

/** 全是空槽（这种架子不进表） */
export function standSlotsEmpty(slots: readonly (ItemStack | null)[]): boolean {
  return slots.every((slot) => slot === null);
}

/** 这个架子上穿了几件 */
export function filledSlotCount(slots: readonly (ItemStack | null)[]): number {
  return slots.filter((slot) => slot !== null).length;
}

/**
 * 盔甲架的表。
 *
 * 与其他几个"按坐标存"的表一样，**读出来的都是副本**：调用方（渲染、取下装备）
 * 拿着随便用，不会顺手把表里那一件改掉。
 */
export class ArmorStandStore {
  private readonly entries = new Map<string, ArmorStandEntry>();

  get(dimension: string, x: number, y: number, z: number): ArmorStandEntry | null {
    const entry = this.entries.get(armorStandKey(dimension, x, y, z));
    if (!entry) return null;
    return { ...entry, slots: entry.slots.map((slot) => (slot ? cloneStack(slot) : null)) };
  }

  has(dimension: string, x: number, y: number, z: number): boolean {
    return this.entries.has(armorStandKey(dimension, x, y, z));
  }

  /**
   * 写某个槽（传 null = 把这个槽清空）。
   *
   * 四个槽都空了就**整条删掉**（空架子不进表那条口径的落点）。
   * @returns 写完之后架子上还剩几件
   */
  setSlot(
    dimension: string,
    x: number,
    y: number,
    z: number,
    slot: number,
    item: ItemStack | null,
  ): number {
    const key = armorStandKey(dimension, x, y, z);
    const existing = this.entries.get(key);
    const slots = existing ? existing.slots.map((entry) => (entry ? cloneStack(entry) : null)) : [null, null, null, null];
    if (slot < 0 || slot >= ARMOR_STAND_SLOTS) return filledSlotCount(slots);
    slots[slot] = item ? cloneStack(item) : null;
    const filled = filledSlotCount(slots);
    if (filled === 0) {
      this.entries.delete(key);
      return 0;
    }
    this.entries.set(key, { dimension, x, y, z, slots });
    return filled;
  }

  /** 清掉整个架子（架子被拆掉时） */
  remove(dimension: string, x: number, y: number, z: number): boolean {
    return this.entries.delete(armorStandKey(dimension, x, y, z));
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  forEach(visit: (entry: ArmorStandEntry) => void): void {
    for (const entry of this.entries.values()) visit(entry);
  }

  /** 全部条目（测试与渲染筛选用；物品**深拷**） */
  list(): ArmorStandEntry[] {
    return [...this.entries.values()].map((entry) => ({
      ...entry,
      slots: entry.slots.map((slot) => (slot ? cloneStack(slot) : null)),
    }));
  }
}

/** 导出成存档格式（整份覆盖，与容器/牌子/展示框同一条理由） */
export function serializeArmorStands(store: ArmorStandStore): SerializedArmorStand[] {
  const out: SerializedArmorStand[] = [];
  store.forEach((entry) => {
    out.push({
      dimension: entry.dimension,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      slots: entry.slots.map((slot) => (slot ? cloneStack(slot) : null)),
    });
  });
  return out;
}

/**
 * 读存档：逐条校验、坏的跳过。
 *
 * 会被跳过的情形（外部数据不可信的老规矩）：维度不认识、坐标不是有限数、
 * 规整之后一件装备都不剩（空架子本来就不该在存档里）。
 */
export function restoreArmorStands(store: ArmorStandStore, raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let restored = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<SerializedArmorStand>;
    const dimension = typeof record.dimension === 'string' ? record.dimension : '';
    if (!isDimension(dimension)) continue;
    const x = typeof record.x === 'number' ? record.x : NaN;
    const y = typeof record.y === 'number' ? record.y : NaN;
    const z = typeof record.z === 'number' ? record.z : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const slots = normalizeStandSlots(record.slots);
    if (standSlotsEmpty(slots)) continue;
    store.setSlot(dimension, Math.round(x), Math.round(y), Math.round(z), 0, slots[0] ?? null);
    for (let slot = 1; slot < ARMOR_STAND_SLOTS; slot++) {
      store.setSlot(dimension, Math.round(x), Math.round(y), Math.round(z), slot, slots[slot] ?? null);
    }
    restored++;
  }
  return restored;
}
