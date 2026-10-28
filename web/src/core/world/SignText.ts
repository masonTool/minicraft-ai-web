/**
 * 告示牌上的文字（B12，批次 80）
 *
 * 牌子的"内容"与箱子那一族不一样：它**不是物品栏**，而是**几行文字**。
 * 所以它没有走 `BlockEntityStore`（那是"按坐标存容器"），而是自己一张表——
 * 但**键的规则完全一样**（`维度|x,y,z`），理由也一样：三个维度共用一套区块存储，
 * 坐标会重叠，不带维度前缀就会互相顶掉（见 `BlockEntityStore` 文件头那条）。
 *
 * 为什么不做成"方块状态里塞文字"：状态是一字节，而且文字是**任意长度的外部数据**。
 * 原版也是把牌子做进方块实体（`SignBlockEntity`），道理相同。
 *
 * 这个模块**不碰 DOM、不碰渲染、不碰世界**：它只是一张表 + 几条校验规则，
 * 于是"最多 4 行、每行最多 15 字、空牌子不写进存档"这些口径都能离线断言。
 */

import { isDimension } from '../gen/Dimension.ts';

/** 原版牌子的四行 */
export const SIGN_LINES = 4;

/** 原版每行最多 15 个字符（1.18 base） */
export const SIGN_LINE_LENGTH = 15;

/** 一张牌子上写的东西 */
export interface SignEntry {
  dimension: string;
  x: number;
  y: number;
  z: number;
  /** 四行文字（不足四行时后面补空串；全空视为"没写过"） */
  lines: readonly string[];
}

/** 存档里的一条（与 `SignEntry` 同构，单独声明是为了存档格式改名时不影响内存结构） */
export interface SerializedSign {
  dimension: string;
  x: number;
  y: number;
  z: number;
  lines: string[];
}

/** 表里的键：与容器、区块增量同一套写法（`维度|x,y,z`） */
export function signKey(dimension: string, x: number, y: number, z: number): string {
  return `${dimension}|${x},${y},${z}`;
}

/**
 * 把任意输入**规整**成一份合法的四行文字（读档/联机消息都要过这一关）。
 *
 * 规则（三道，缺一条就会出现"读档之后写不上字"或"牌子上出现半截乱码"）：
 *  1. 逐行取字符串、**掐到 15 字**——超长的旧数据不该让整份存档读不出来；
 *  2. 去掉行尾空白（原版编辑框里敲完的空格不会被保留）；
 *  3. 不足四行补空串；**四行全空返回 null**（表示"这张牌子没内容"），
 *     这样空牌子既不会占用存档，也不会在世界上留一块空文字平面。
 */
export function normalizeSignLines(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const lines: string[] = [];
  for (let i = 0; i < SIGN_LINES; i++) {
    const value = raw[i];
    const text = typeof value === 'string' ? value.slice(0, SIGN_LINE_LENGTH).replace(/\s+$/, '') : '';
    lines.push(text);
  }
  return lines.some((line) => line.length > 0) ? lines : null;
}

/**
 * 牌子文字的读写表。
 *
 * ⚠️ 与容器一样，"**空牌子不进表**"是刻意的：一条 `4 × ""` 的记录没有任何信息，
 * 却会在世界里留下一块要渲染、要广播、要写进存档的空平面。
 */
export class SignTextStore {
  private readonly entries = new Map<string, { x: number; y: number; z: number; dimension: string; lines: string[] }>();

  /** 读一张牌子上的字；没写过（或写的是空的）返回 null */
  get(dimension: string, x: number, y: number, z: number): readonly string[] | null {
    return this.entries.get(signKey(dimension, x, y, z))?.lines ?? null;
  }

  has(dimension: string, x: number, y: number, z: number): boolean {
    return this.entries.has(signKey(dimension, x, y, z));
  }

  /**
   * 写一张牌子上的字。
   *
   * 传进来的内容经 `normalizeSignLines` 规整：
   * **写空白 = 擦掉**（返回 false 表示"这一格现在没字了"，调用方据此拆掉文字平面）。
   */
  set(dimension: string, x: number, y: number, z: number, rawLines: unknown): boolean {
    const lines = normalizeSignLines(rawLines);
    if (!lines) {
      this.entries.delete(signKey(dimension, x, y, z));
      return false;
    }
    this.entries.set(signKey(dimension, x, y, z), { dimension, x, y, z, lines });
    return true;
  }

  /** 牌子被拆掉时清掉内容（返回是否真的清掉了一条） */
  remove(dimension: string, x: number, y: number, z: number): boolean {
    return this.entries.delete(signKey(dimension, x, y, z));
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /** 遍历（渲染层按"当前维度 + 区块已加载"筛，见 `render/SignRenderer.ts`） */
  forEach(visit: (entry: SignEntry) => void): void {
    for (const entry of this.entries.values()) visit(entry);
  }

  /** 全部条目（测试与调试用） */
  list(): SignEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry, lines: [...entry.lines] }));
  }
}

/** 导出成存档格式（整份覆盖，与容器同一条理由：条数不多、增量要额外维护一张脏表） */
export function serializeSigns(store: SignTextStore): SerializedSign[] {
  const out: SerializedSign[] = [];
  store.forEach((entry) => {
    out.push({
      dimension: entry.dimension,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      lines: [...entry.lines],
    });
  });
  return out;
}

/**
 * 读存档：**逐条校验、坏的跳过**，绝不让一条脏数据把整份牌子读没了。
 *
 * 会被跳过的情形（都是"外部数据不可信"的老规矩）：
 *  - 维度不是三个已知值之一（以后的版本删过维度）；
 *  - 坐标不是有限数（NaN / 字符串）；
 *  - 文字规整之后为空（空牌子本来就不该在存档里）。
 */
export function restoreSigns(store: SignTextStore, raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let restored = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<SerializedSign>;
    const dimension = typeof record.dimension === 'string' ? record.dimension : '';
    if (!isDimension(dimension)) continue;
    const { x, y, z } = record;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (store.set(dimension, Math.trunc(x), Math.trunc(y), Math.trunc(z), record.lines)) restored++;
  }
  return restored;
}
