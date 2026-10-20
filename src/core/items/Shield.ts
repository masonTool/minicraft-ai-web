/**
 * 盾牌（批次 194，B18）
 *
 * 规则本身很小，但**每一条都能单独断言**，所以收成一个纯模块，
 * 主程序那边只负责"问三个问题"：
 *
 *  1. 手里是不是盾牌？（主手或副手）
 *  2. 这一下**能不能挡**？（伤害来源 + 是不是从正面来）
 *  3. 挡下来要**磨损多少**？
 *
 * 挡的判据（与原版对齐的部分）：
 *  - **挡近战、弹射物与正面爆炸**：火、掉落、毒、溺水、仙人掌、窒息、饥饿、虚空、雷击都不挡
 *    （批次 551 补上爆炸：只要爆炸来源在正面，盾牌就吃下这一下）；
 *  - **只挡正面来的**：以玩家视线为轴，来源方向点乘 > 0 就算正面（约 ±90°）；
 *  - **每挡一下磨损 `1 + ⌊伤害 / 5⌋`**：与原版同一个式子（重击更伤盾）。
 *
 * 批次 551 补齐了三处长尾：**举盾减速到 30%**、**正面爆炸也能挡**、
 * **斧头命中会禁用盾牌 5 秒**。斧头那条由主程序读攻击者的主手装备后传给盾牌层，
 * 盾牌层本身仍然只认"这一下能不能挡"。
 */

import { Item } from '../registry/items.ts';
import type { ItemStack } from '../container/Inventory.ts';

/** 耐久上限（原版 336） */
export const SHIELD_DURABILITY = 336;

/**
 * 能挡的伤害来源。
 *
 * 用**白名单**而不是黑名单：将来加一种新伤害时，默认行为是"挡不住"——
 * 那比"新伤害被旧盾牌默默吃掉"容易发现得多（前者玩家会报，后者只会觉得怪）。
 */
const BLOCKABLE_CAUSES: ReadonlySet<string> = new Set(['generic', 'projectile', 'explosion']);

/** 这一叠是不是盾牌 */
export function isShield(stack: ItemStack | null | undefined): boolean {
  return stack !== undefined && stack !== null && stack.id === Item.SHIELD;
}

/** 这种伤害能不能被盾牌挡 */
export function canBlockDamage(cause: string): boolean {
  return BLOCKABLE_CAUSES.has(cause);
}

/**
 * 攻击是不是来自**正面**。
 *
 * @param forwardX 玩家朝向（单位向量，X）——本项目的朝向是 `(-sin yaw, -cos yaw)`
 * @param forwardZ 玩家朝向（单位向量，Z）
 * @param dx 攻击者相对玩家的方向（未归一化也可以）
 * @param dz 同上
 */
export function isFrontalAttack(forwardX: number, forwardZ: number, dx: number, dz: number): boolean {
  const length = Math.hypot(dx, dz);
  // 贴脸（方向退化）时按"正面"算：原版也不会因为站在同一个点就无视盾牌
  if (length < 1e-6) return true;
  const dot = (forwardX * dx + forwardZ * dz) / length;
  return dot > 0;
}

/** 挡下这一下要磨损多少耐久（原版：`1 + ⌊伤害 / 5⌋`） */
export function shieldWear(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return 1 + Math.floor(amount / 5);
}

/** 挡下之后玩家被推动的初速（格/秒）：原版会轻微后仰，但不至于把人推飞 */
export const SHIELD_KNOCKBACK = 1.4;

/** 举盾时的移速倍率（原版 30%，批次 551） */
export const SHIELD_SLOWDOWN = 0.3;
/** 被斧头命中后盾牌失效的秒数（原版 5 秒，批次 551） */
export const SHIELD_DISABLE_SECONDS = 5;
