/**
 * `/data` 的读写子集（批次 623 / Q21）。
 *
 * 原版的 `/data` 是"按 NBT 路径读写"的通用工具：`/data get entity @s Health`、
 * `/data merge block 0 64 0 {Items:[…]}`。本项目**没有一棵可写的 NBT 树**——
 * 实体是强类型字段（x/y/z/health/customName），方块实体是按坐标存的容器实例。
 *
 * 所以这里的做法是：**只暴露真实存在的那几项**，用同一种"路径"写法把它们点出来。
 * 造一棵假的 NBT 树（能读能写但不落回真实字段）比不做更坏：玩家改了半天，
 * 游戏里什么都没变，还以为命令坏了。
 *
 * 路径白名单：
 *   · 方块实体 —— 根（`Slots` 全表）、`Slots[i]`（第 i 格）
 *   · 实体     —— 根（汇总）、`Health`、`CustomName`
 *
 * ⚠️ 这个文件**不 import 任何运行时模块**（`ItemStack` / `ContainerKind` 都是 type-only）：
 * 它要能在 Node 里被命令测试直接跑，而 `BlockEntityStore` 一边 import 十几个容器类、
 * 一边 import 方块注册表 —— 真引进来会拖出一大片与"解析一个路径"无关的东西。
 */

import type { ItemStack } from '../container/Inventory.ts';
import type { ContainerKind } from '../world/BlockEntityStore.ts';

// ---------------------------------------------------------------- 方块实体的快照

/**
 * 一格方块实体的**只读快照**。
 *
 * 为什么不让命令层直接摸容器实例：命令层是纯逻辑层，容器类里有 tick 状态
 * （烧炼进度、酿造燃料…），随手能拿到就会有人顺手改——那是不该从命令层产生的副作用。
 */
export interface BlockEntityData {
  readonly kind: ContainerKind;
  /** 逐格内容，长度 = 这种容器的槽位数，空格为 null */
  readonly slots: readonly (ItemStack | null)[];
}

/** 实体身上可读的那几项（读不到就是 undefined，不是 0 / 空串） */
export interface EntityData {
  /** 当前生命值；没有血量概念的实体（掉落物/箭/矿车）不带这一项 */
  readonly health?: number;
  /** 生命上限（与 `health` 成对出现） */
  readonly maxHealth?: number;
  /** 命名牌起的名字；没起过就不带这一项 */
  readonly customName?: string;
}

// ---------------------------------------------------------------- 路径解析

export type DataPath =
  | { readonly kind: 'root' }
  | { readonly kind: 'health' }
  | { readonly kind: 'customName' }
  | { readonly kind: 'slot'; readonly index: number };

/** 命令回执里列出的合法路径（读错时报错用，也是 `/help` 与文档的唯一出处） */
export const BLOCK_PATHS = ['Slots', 'Slots[<i>]'] as const;
export const ENTITY_PATHS = ['Health', 'CustomName'] as const;

/**
 * 解析一个路径。
 *
 * 大小写不敏感（原版 NBT 是大小写敏感的，但玩家手打 `/data get entity @s health`
 * 时十有八九是想读血量——为此报一条"路径不存在"只是在考拼写，不是在防错）。
 *
 * @returns null = 认不出来（调用方报错并列出白名单）
 */
export function parseDataPath(raw: string | undefined): DataPath | null {
  if (raw === undefined) return { kind: 'root' };
  const text = raw.trim();
  if (text.length === 0) return { kind: 'root' };
  const lower = text.toLowerCase();
  if (lower === 'health') return { kind: 'health' };
  if (lower === 'customname') return { kind: 'customName' };
  if (lower === 'slots') return { kind: 'root' };
  const slot = /^slots\[(\d+)\]$/.exec(lower);
  if (slot) {
    const index = Number(slot[1]);
    return Number.isSafeInteger(index) && index >= 0 ? { kind: 'slot', index } : null;
  }
  return null;
}

/** 这条路径能不能用在方块实体上 */
export function pathFitsBlock(path: DataPath): boolean {
  return path.kind === 'root' || path.kind === 'slot';
}

/** 这条路径能不能用在实体上 */
export function pathFitsEntity(path: DataPath): boolean {
  return path.kind === 'root' || path.kind === 'health' || path.kind === 'customName';
}

// ---------------------------------------------------------------- 读取辅助

export interface SlotEntry {
  readonly index: number;
  readonly id: number;
  readonly count: number;
}

/**
 * 有东西的那几格（空格不列）。
 *
 * 为什么不列满 27 行：一条箱子里往往只有两三格有东西，列 27 行会把回执刷满屏幕，
 * 真正的内容反而看不见。总数在标题句里给（"共 27 格，3 格有东西"）。
 */
export function filledSlots(data: BlockEntityData): SlotEntry[] {
  const out: SlotEntry[] = [];
  for (let i = 0; i < data.slots.length; i++) {
    const stack = data.slots[i];
    if (!stack || stack.count <= 0) continue;
    out.push({ index: i, id: stack.id, count: stack.count });
  }
  return out;
}

/** 取某一格（越界返回 null —— 与容器自己的 `get` 同口径） */
export function slotAt(data: BlockEntityData, index: number): SlotEntry | null {
  if (index < 0 || index >= data.slots.length) return null;
  const stack = data.slots[index];
  if (!stack || stack.count <= 0) return null;
  return { index, id: stack.id, count: stack.count };
}

/**
 * 一条 `Slots[i]` 路径的**可写性**判据。
 *
 * 单独一个函数是为了让"越界"和"空格"两种失败在命令层能被分开说：
 * 越界是玩家算错了格号，空格是"这里本来就什么都没有"——后者不该报错级别。
 */
export function canWriteSlot(data: BlockEntityData, index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0 && index < data.slots.length;
}

/**
 * 把 `/data merge entity … Health <值>` 的原始文本解析成一个合法血量。
 *
 * 三个必须拒的情况（都要断言）：
 *  ① 不是数字（`Health abc`）——直接报错，不要"静默当成 0"，
 *     那会把一只怪悄悄弄死，玩家还以为命令没生效；
 *  ② 超出上限——**夹到上限**而不是报错：原版 NBT 允许写超上限的值，
 *     游戏下一 tick 自己会夹；我们这里写进 `Mob.health` 之后没有那道夹取，
 *     留着超上限会让血条画到框外；
 *  ③ 负数——夹到 0（= 死）。
 */
export function parseHealthValue(raw: string | undefined, max: number): number | null {
  if (raw === undefined) return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return null;
  const ceiling = Number.isFinite(max) && max > 0 ? max : Infinity;
  return Math.min(ceiling, Math.max(0, value));
}
