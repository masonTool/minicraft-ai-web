/**
 * 物品展示框里挂着的东西（B14，批次 86）
 *
 * 展示框与告示牌是**同一种结构**：它本身是一个方块（"这一格有个框"），
 * 但"框里挂的是什么"是**运行时数据**，塞不进方块状态（状态只有一个字节，
 * 而挂着的是一整件物品：id + 数量 + 耐久 + 附魔 + 名字）。
 *
 * 所以这里照抄 `SignText.ts` 那套：
 *  - 一张**按坐标**存的表，键是 `维度|x,y,z`（三个维度共用一套区块存储，
 *    坐标会重叠，不带维度前缀就会互相顶掉——见 `BlockEntityStore` 文件头那条）；
 *  - **空框不进表**（与"空容器不写存档""空牌子不写存档"同一条口径）：
 *    一个没有物品的框没有任何信息，却会让存档、渲染、联机各多一条要维护的条目；
 *  - 序列化 / 反序列化**逐条校验、坏的跳过**，绝不让一条脏数据把整份读没了。
 *
 * 这个模块不碰 DOM、不碰渲染、不碰世界：旋转档位、几何缩放、脏数据规整
 * 全是纯函数，于是"每点一次转 45°""转到第 8 次回到原位"这些口径都能离线断言。
 */

import { isDimension } from '../gen/Dimension.ts';
import { restoreStack, stackExtras, type ItemStack } from '../container/Inventory.ts';

/** 原版每点一次转 45°，8 档一圈回到原位 */
export const FRAME_ROTATIONS = 8;

/** 一档转多少弧度（渲染层直接用） */
export const FRAME_ROTATION_ANGLE = Math.PI / 4;

/** 一张展示框里挂着的东西 */
export interface FrameEntry {
  dimension: string;
  x: number;
  y: number;
  z: number;
  /** 挂着的物品（表里只存**有东西**的框，所以它一定不是 null） */
  item: ItemStack;
  /** 旋转档位 0~7（0 = 正着挂，每档 45°） */
  rotation: number;
}

/** 存档里的一条（与 `FrameEntry` 同构，单独声明是为了存档格式改名时不影响内存结构） */
export interface SerializedFrame {
  dimension: string;
  x: number;
  y: number;
  z: number;
  item: ItemStack;
  rotation: number;
}

/**
 * 深拷一件"挂在框里"的物品。
 *
 * `stackExtras` 是这一层的唯一出处（它连潜影盒的**内容物**都深拷一层）：
 * 每处各写一遍 spread 的必然结果是"漏了 content 那一层"，
 * 而**共享可变对象**的坑正是"读一次框里的东西，顺手改到了表里那一份"。
 */
function cloneFrameItem(item: ItemStack): ItemStack {
  return { id: item.id, count: item.count, ...stackExtras(item) };
}

/** 表里的键：与容器、牌子文字、区块增量同一套写法（`维度|x,y,z`） */
export function frameKey(dimension: string, x: number, y: number, z: number): string {
  return `${dimension}|${x},${y},${z}`;
}

/**
 * 下一次旋转的档位（右键一次）。
 *
 * 取模之后一定落在 0~7：脏数据（比如 -1 或 99）也被夹回合法范围，
 * 于是"转了 8 次回到原地"这条不会因为一个坏值而永久偏掉。
 */
export function nextFrameRotation(rotation: number): number {
  const value = Number.isFinite(rotation) ? Math.floor(rotation) : 0;
  return ((value % FRAME_ROTATIONS) + FRAME_ROTATIONS) % FRAME_ROTATIONS;
}

/**
 * 斜着挂时物品要缩小多少。
 *
 * ⚠️ 这条不是"顺手美化"：框的洞口只有 8/16，而物品取 7/16 已经接近贴着四边——
 * 转 45° 之后它的**对角**会长出去 √2 倍，直接穿进框的木条里。
 * 原版也是这么做的（斜挂时物品变小一号），所以档位是奇数（45°/135°/…）就乘 1/√2。
 */
export function frameItemScale(rotation: number): number {
  return nextFrameRotation(rotation) % 2 === 1 ? Math.SQRT1_2 : 1;
}

/** 平面内要转多少弧度（渲染层用；档位已经规整过） */
export function frameItemAngle(rotation: number): number {
  return nextFrameRotation(rotation) * FRAME_ROTATION_ANGLE;
}

/**
 * 把外部数据规整成一件"能挂在框里"的物品。
 *
 * **不自己写一遍字段校验**：直接交给 `restoreStack`（容器存档读槽位用的那一支）
 * —— 它是本项目"一件物品的合法形状"的唯一出处（id 要在物品表里、耐久/附魔/改名/
 * 累积惩罚逐项校验、潜影盒的**内容物**嵌一层深拷）。
 * 自己再写一份的下场很清楚：读档之后"挂着的那把附魔剑"变成白板，
 * 或者盒子里的东西不见了，而且不报任何错（这与 `ContainerSave` 那批的教训同源）。
 *
 * 唯一多出来的一条是**数量夹到 1~64**：框里挂着的数量没有别的含义
 * （原版也是挂一件），脏存档里出现 9999 只会让渲染层莫名其妙。
 */
export function normalizeFrameItem(raw: unknown): ItemStack | null {
  const stack = restoreStack(raw, 1);
  if (!stack) return null;
  stack.count = Math.max(1, Math.min(64, Math.floor(stack.count)));
  return stack;
}

/** 规整旋转档位（存进表/存档之前都过一遍） */
export function normalizeFrameRotation(raw: unknown): number {
  return nextFrameRotation(typeof raw === 'number' ? raw : 0);
}

/**
 * 展示框内容表。
 *
 * ⚠️ 与容器、牌子一样，"**空框不进表**"是刻意的（见文件头）。
 */
export class ItemFrameStore {
  private readonly entries = new Map<string, FrameEntry>();

  /**
   * 读一张展示框里挂着的东西；空框（没写过）返回 null。
   *
   * 返回的是**副本**：调用方（渲染、破坏时把东西还回去）拿着它随便用都行，
   * 不会顺手把表里的那一件改掉——这一类"共享可变对象"的坑在本项目栽过好几次
   * （"重建一遍会换布局"那条经验）。
   */
  get(dimension: string, x: number, y: number, z: number): FrameEntry | null {
    const entry = this.entries.get(frameKey(dimension, x, y, z));
    if (!entry) return null;
    return { ...entry, item: cloneFrameItem(entry.item) };
  }

  has(dimension: string, x: number, y: number, z: number): boolean {
    return this.entries.has(frameKey(dimension, x, y, z));
  }

  /**
   * 往框里放一件东西（或改它的旋转）。
   *
   * 传 `null` 表示**把东西取走**（返回 false 表示"这一格现在是个空框"，
   * 调用方据此知道该把条目删掉了）。
   */
  set(
    dimension: string,
    x: number,
    y: number,
    z: number,
    rawItem: unknown,
    rawRotation: number = 0,
  ): boolean {
    const item = normalizeFrameItem(rawItem);
    if (!item) {
      this.entries.delete(frameKey(dimension, x, y, z));
      return false;
    }
    this.entries.set(frameKey(dimension, x, y, z), {
      dimension,
      x,
      y,
      z,
      item,
      rotation: normalizeFrameRotation(rawRotation),
    });
    return true;
  }

  /** 只改旋转（右键空手转一格），返回改完之后的档位；当前是空框则返回 0 */
  rotate(dimension: string, x: number, y: number, z: number): number {
    const entry = this.entries.get(frameKey(dimension, x, y, z));
    if (!entry) return 0;
    entry.rotation = nextFrameRotation(entry.rotation + 1);
    return entry.rotation;
  }

  /** 框被拆掉 / 东西被取走时清掉（返回是否真的清掉了一条） */
  remove(dimension: string, x: number, y: number, z: number): boolean {
    return this.entries.delete(frameKey(dimension, x, y, z));
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  /** 遍历（渲染层按"当前维度 + 区块已加载"筛，见 `render/ItemFrameRenderer.ts`） */
  forEach(visit: (entry: FrameEntry) => void): void {
    for (const entry of this.entries.values()) visit(entry);
  }

  /** 全部条目（测试与调试用；物品**深拷**，免得调用方改到表里的那一件） */
  list(): FrameEntry[] {
    return [...this.entries.values()].map((entry) => ({
      ...entry,
      item: cloneFrameItem(entry.item),
    }));
  }
}

/** 导出成存档格式（整份覆盖，与容器/牌子同一条理由） */
export function serializeFrames(store: ItemFrameStore): SerializedFrame[] {
  const out: SerializedFrame[] = [];
  store.forEach((entry) => {
    out.push({
      dimension: entry.dimension,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      item: cloneFrameItem(entry.item),
      rotation: entry.rotation,
    });
  });
  return out;
}

/**
 * 读存档：**逐条校验、坏的跳过**。
 *
 * 会被跳过的情形（都是"外部数据不可信"的老规矩）：维度不是三个已知值之一、
 * 坐标不是有限数、物品规整之后为空（空框本来就不该在存档里）。
 */
export function restoreFrames(store: ItemFrameStore, raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let restored = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<SerializedFrame>;
    const dimension = typeof record.dimension === 'string' ? record.dimension : '';
    if (!isDimension(dimension)) continue;
    const { x, y, z } = record;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (store.set(dimension, Math.trunc(x), Math.trunc(y), Math.trunc(z), record.item, record.rotation ?? 0)) {
      restored++;
    }
  }
  return restored;
}
