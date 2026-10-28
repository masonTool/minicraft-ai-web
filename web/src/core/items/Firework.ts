/**
 * 烟花（批次 192，H16 的第二片）
 *
 * 两个物品共用同一份数据：
 *
 *   火药 + 染料  → **烟火之星**（一种颜色）
 *   纸 + 火药 ×N + [星] → **烟花火箭**（飞行档 1~3，带星就有颜色，不带星就是金色）
 *
 * 数据放在 `ItemStack.firework`：`{ flight, colors }`。
 *  - `flight` **1~3**：原版就是"几份火药"，决定飞多高、多久后炸；
 *  - `colors` **最多 8 个**：原版一颗星可以带 8 种颜色的列表，我们的合成只给一种，
 *    但读档时允许更多（数据能表达就得能读回）。
 *
 * 星作为**原料**放在配方里时 `flight` 是 0（它自己不会飞），合成火箭时才被抬到 1~3。
 *
 * ⚠️ 与原版的差异（写进 TASKS H16）：
 *  1. **只有圆球一种爆开形状**：原版的"星形 / 爆裂 / 苦力怕脸"要额外原料（金粒 / 羽毛 / 头），
 *     而且形状要另一张粒子表——先不做，颜色已经能玩；
 *  2. **不做"烟花之星"的闪烁与拖尾**（`trail` / `twinkle` 两个布尔）；
 *  3. 爆开的伤害按档位 5 / 6 / 7 点（与原版一致），但**不点燃**方块。
 */

import { Item } from '../registry/items.ts';
import type { ItemStack } from '../container/Inventory.ts';

/** 飞行档上限（原版最多 3 份火药） */
export const MAX_FLIGHT = 3;
/** 一颗星最多带几种颜色（原版 8） */
export const MAX_COLORS = 8;
/** 没写颜色时炸出来的金色（与 TNT 的爆炸闪光同一档） */
export const DEFAULT_FIREWORK_COLOR = 0xffd27a;

/**
 * 火箭上升的速度（格/秒）。
 *
 * 原版是"初速约 0.5 格/tick、逐渐减速"，我们取**匀速 10 格/秒**：
 * 三档分别在 10 / 14 / 18 格上下炸开，与"大概两层楼 / 三层楼 / 四五层楼"的观感对得上。
 */
export const FIREWORK_RISE_SPEED = 10;

export interface FireworkData {
  /** 飞行档：星是 0，火箭是 1~3 */
  flight: number;
  /** 爆炸颜色（0xRRGGBB）；空数组 = 用默认金色 */
  colors: number[];
}

/** 某一档飞多少秒才炸（索引 = flight；0 档给星用，不会真的飞） */
export function fireworkRiseSeconds(flight: number): number {
  const f = Math.max(1, Math.min(MAX_FLIGHT, Math.round(flight)));
  // 1 → 1.0s / 2 → 1.4s / 3 → 1.8s
  return 0.6 + f * 0.4;
}

/** 爆开的威力（决定了粒子的数量与扩散半径） */
export function fireworkExplosionPower(flight: number): number {
  return 1 + Math.max(1, Math.min(MAX_FLIGHT, Math.round(flight))) * 0.4;
}

/** 火箭爆炸的伤害（原版 5 / 6 / 7） */
export function fireworkDamage(flight: number): number {
  return 4 + Math.max(1, Math.min(MAX_FLIGHT, Math.round(flight)));
}

/**
 * 校验并规整一份烟花数据（存档/合成两头共用）。
 * @returns 认不出来就返回 undefined（"没有这个字段"）
 */
export function sanitizeFirework(raw: unknown): FireworkData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as { flight?: unknown; colors?: unknown };
  const flight = typeof candidate.flight === 'number' && Number.isFinite(candidate.flight) ? Math.round(candidate.flight) : 0;
  const colors: number[] = [];
  if (Array.isArray(candidate.colors)) {
    for (const value of candidate.colors) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const color = Math.max(0, Math.min(0xffffff, Math.round(value)));
      if (!colors.includes(color)) colors.push(color);
      if (colors.length >= MAX_COLORS) break;
    }
  }
  return {
    flight: Math.max(0, Math.min(MAX_FLIGHT, flight)),
    colors,
  };
}

/** 这一叠的烟花数据（没有就返回默认：1 档、无颜色） */
export function fireworkDataOf(stack: ItemStack): FireworkData {
  return stack.firework ?? { flight: 1, colors: [] };
}

/** 这一叠炸开时用哪几种颜色（没写颜色 → 金色） */
export function fireworkColorsOf(stack: ItemStack): number[] {
  const data = fireworkDataOf(stack);
  return data.colors.length > 0 ? [...data.colors] : [DEFAULT_FIREWORK_COLOR];
}

/** 把烟花数据写回一份**新的**栈（不改原对象，与 `withPages` 同一个理由） */
export function withFirework(stack: ItemStack, data: FireworkData): ItemStack {
  const next: ItemStack = { id: stack.id, count: stack.count };
  for (const key of Object.keys(stack) as (keyof ItemStack)[]) {
    if (key === 'id' || key === 'count' || key === 'firework') continue;
    (next as unknown as Record<string, unknown>)[key] = stack[key];
  }
  const cleaned = sanitizeFirework(data);
  if (cleaned) next.firework = cleaned;
  return next;
}

/** 造一颗星（合成结果用；染料颜色由配方决定） */
export function makeFireworkStar(color: number): ItemStack {
  return { id: Item.FIREWORK_STAR, count: 1, firework: { flight: 0, colors: [color & 0xffffff] } };
}

/** 造一枚火箭（合成结果用） */
export function makeFireworkRocket(flight: number, colors: readonly number[]): ItemStack {
  return {
    id: Item.FIREWORK_ROCKET,
    count: 1,
    firework: { flight: Math.max(1, Math.min(MAX_FLIGHT, Math.round(flight))), colors: [...colors].slice(0, MAX_COLORS) },
  };
}

/** 这一叠是不是烟花火箭 */
export function isFireworkRocket(stack: ItemStack | null | undefined): boolean {
  return stack !== undefined && stack !== null && stack.id === Item.FIREWORK_ROCKET;
}
