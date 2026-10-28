/**
 * 载具被敲坏（批次 435）+ `/gamerule doEntityDrops`。
 *
 * 为什么单独一个纯模块：船与矿车在本仓库里**是纯物理实体**（`Boat` / `Minecart`
 * 里连 `hurt` 都没有），所以"敲几下会坏、坏了掉什么"这两件事没有天然的家。
 * 把它们写成纯函数，就能离线验"第 6 点伤害坏、第 5 点不坏"这种边界，
 * 而不是靠在游戏里数点击次数。
 *
 * 三条与原版对齐的口径：
 *  1. **船与矿车都是 6 点耐久**（原版 `Boat`/`Minecart` 的 `MAX_HEALTH` 都是 6）；
 *  2. 坏掉时掉落**它自己那件物品**（船 → 橡木船、漏斗矿车 → 漏斗矿车…），
 *     并且**受 `doEntityDrops` 控制**——这条规则在原版里管的就是"实体类的掉落"；
 *  3. 创造模式一击必坏（原版也是"创造模式打一下就碎"）。
 */

import { Item } from '../registry/items.ts';

/** 载具的种类（决定掉什么、也决定日志与音效用哪一套） */
export type VehicleKind = 'boat' | 'minecart' | 'hopper_minecart' | 'furnace_minecart';

/** 船与矿车的耐久都是 6（原版 `MAX_HEALTH`） */
export const VEHICLE_MAX_HEALTH = 6;

export interface VehicleDamageResult {
  /** 剩下的耐久（不会小于 0） */
  health: number;
  /** 这一下是不是把它敲坏了 */
  broken: boolean;
}

/**
 * 结算一次伤害。
 *
 * @param health 当前耐久（调用方用 WeakMap 之类自己存，实体本身不背这个状态）
 * @param damage 这一下的伤害（创造模式传 `VEHICLE_MAX_HEALTH` 就是一击必坏）
 */
export function applyVehicleDamage(health: number, damage: number): VehicleDamageResult {
  const next = Math.max(0, health - Math.max(0, damage));
  return { health: next, broken: next <= 0 };
}

/**
 * 坏掉时掉哪件物品。
 *
 * @param doEntityDrops `/gamerule doEntityDrops`；关掉时**什么都不掉**（返回 null）
 *   ——注意"关闭"与"这类载具没有对应物品"是两种不同的 null，
 *   调用方据此决定要不要打日志，不要合并成一种。
 */
export function vehicleDropFor(kind: VehicleKind, doEntityDrops: boolean): number | null {
  if (!doEntityDrops) return null;
  switch (kind) {
    case 'boat':
      return Item.OAK_BOAT;
    case 'minecart':
      return Item.MINECART;
    case 'hopper_minecart':
      return Item.HOPPER_MINECART;
    case 'furnace_minecart':
      return Item.FURNACE_MINECART;
    default:
      return null;
  }
}

/**
 * 敲一下的伤害：创造模式一击必坏，生存按手上的工具（徒手 1）。
 *
 * 单独一个函数是为了让"创造模式"这条规则只写一遍——
 * 之前类似的判断（挖方块）在两处各写了一遍，改一处漏一处就会表现成
 * "创造模式挖某些方块要挖半天"。
 */
export function vehicleHitDamage(weaponDamage: number, creative: boolean): number {
  if (creative) return VEHICLE_MAX_HEALTH;
  return Math.max(1, weaponDamage);
}
