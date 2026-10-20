/**
 * 重生锚（批次 454，B54 方块族的最后一件）
 *
 * 原版规则（1.16+）：
 *  - 放下时充能 **0**；
 *  - 手持**荧石**右键 → 充能 +1，最多 **4** 级（每级亮一档）；
 *  - 右键已充能的锚（不拿荧石）→ **设置重生点**，并消耗 1 级充能；
 *  - 充能为 0 时右键只给一句提示，不设点；
 *  - 锚被拆掉、或充能耗到 0 之后死亡 → 重生点失效，回世界出生点。
 *
 * 这里只放**状态位的读写**（纯函数，离线可断言）；"右键时做什么"在主程序里，
 * 因为它要改背包、播报、发联机包。
 */

/** 最多 4 级充能（原版 `RESPAWN_ANCHOR_MAX_CHARGE`） */
export const RESPAWN_ANCHOR_MAX_CHARGE = 4;

/** 状态位里存充能用的是低 3 位（0~4 需要 3 个比特，2 位装不下第 4 档） */
const CHARGE_MASK = 0b111;

/** 这一格的充能档位（0~4）；坏状态（存档里被写进 5~7）夹到 4 */
export function anchorCharge(state: number): number {
  return Math.min(state & CHARGE_MASK, RESPAWN_ANCHOR_MAX_CHARGE);
}

/** 写回充能档位（其余位原样保留）；越界值夹紧，不抛错——坏存档不该让游戏崩 */
export function withAnchorCharge(state: number, charge: number): number {
  const clamped = Math.max(0, Math.min(RESPAWN_ANCHOR_MAX_CHARGE, Math.floor(charge)));
  return (state & ~CHARGE_MASK) | clamped;
}

/** 充能对应的发光等级（0 → 不亮；4 → 12，比荧石暗一档） */
export function anchorLight(state: number): number {
  return anchorCharge(state) * 3;
}
