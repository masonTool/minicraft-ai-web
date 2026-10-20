/**
 * 攻击冷却（G8，批次 506）
 *
 * 原版每种武器有自己的**攻击速度**（每秒能打几下），换算成冷却就是 `1 / 速度`：
 *  - 徒手 4.0 → 0.25 秒（空手连打最快）
 *  - 剑 1.6 → 0.625 秒
 *  - 镐 1.2 → 0.833 秒
 *  - 锹 / 锄 1.0 → 1.0 秒
 *  - 斧 0.8~1.0 → 1.25 / 1.11 / 1.0 秒（材质越好越顺手）
 *  - 三叉戟 1.1 → 0.909 秒；剪刀 1.0 → 1.0 秒
 *
 * ⚠️ 与本项目旧实现的差异：以前所有武器统一 0.5 秒（`tuning.ts` 的
 * `ATTACK_COOLDOWN`），斧头因此比原版快一倍多。现在按表来，手感与原版一致。
 *
 * ⚠️ **没有做"未满蓄力的伤害折扣"**：本项目的攻击是"冷却没到就不出手"，
 * 玩家点不出"半蓄力的一下"，所以那条 `0.2 + 0.8 × 进度²` 的曲线在这里没有触发点。
 * 要做就得允许冷却期间也出手、再按进度打折——那是另一套输入语义，记在 TASKS G8。
 */

import type { ToolMaterial, ToolType } from '../registry/tools.ts';

/** 徒手的冷却（秒） */
export const HAND_ATTACK_COOLDOWN = 0.25;

/** 剑 / 镐 / 锹 / 锄 / 剪刀 / 三叉戟（斧按材质另算） */
const BASE_COOLDOWNS: Readonly<Record<Exclude<ToolType, 'axe'>, number>> = {
  sword: 0.625,
  pickaxe: 1 / 1.2,
  shovel: 1,
  hoe: 1,
  shears: 1,
  trident: 1 / 1.1,
};

/** 斧头的冷却（原版 attack speed：木/石 0.8、铁 0.9、金/钻石/下界合金 1.0） */
const AXE_COOLDOWNS: Readonly<Record<ToolMaterial, number>> = {
  wooden: 1.25,
  stone: 1.25,
  iron: 1 / 0.9,
  golden: 1,
  diamond: 1,
  netherite: 1,
};

/**
 * 这一件工具的攻击冷却（秒）。
 *
 * @param tool 手上的工具；`null` = 空手（按徒手算）
 */
export function attackCooldownFor(tool: { type: ToolType; material: ToolMaterial } | null): number {
  if (!tool) return HAND_ATTACK_COOLDOWN;
  if (tool.type === 'axe') return AXE_COOLDOWNS[tool.material];
  return BASE_COOLDOWNS[tool.type];
}

/**
 * 冷却进度 0~1（1 = 可以再打）。
 *
 * 界面用它画那根小条；`max <= 0` 时直接当 1（避免除零与"永远半格"）。
 */
export function attackChargeProgress(cooldown: number, max: number): number {
  if (!(max > 0)) return 1;
  const remaining = Math.max(0, Math.min(max, cooldown));
  return 1 - remaining / max;
}
