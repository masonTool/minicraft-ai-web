/**
 * 村民恐慌（J11 收尾，批次 511）
 *
 * 原版村民看到僵尸/灾厄村民会**举手逃跑**（并冒出愤怒/恐慌粒子），同时把铁傀儡引过来。
 * 本项目没有"愤怒值/ gossip"那一套，只做两件玩家看得见的事：
 *
 *  1. **逃跑**：8 格内出现威胁 → 朝**远离威胁**的方向跑 5 秒（速度 ×1.35）；
 *  2. **联动铁傀儡**：恐慌源会被记成"优先目标"，16 格内的铁傀儡先打它
 *     （原本只是"打最近的敌对生物"，现在会优先处理正在威胁村民的那一只）。
 *
 * 纯函数在这里：谁算威胁、最近的那只是谁、往哪跑。实体与主程序只负责执行。
 *
 * ⚠️ 与原版的差异：没有"恐慌粒子"与"举手"动画（`Villager` 没有独立模型姿态），
 * 也没有 gossip/声望——恐慌只影响走位与铁傀儡的目标优先级。
 */

/** 多远内有威胁就开始跑（原版约 8 格） */
export const VILLAGER_PANIC_RADIUS = 8;
/** 跑多久（秒）：威胁走开后还要再跑一会儿，不然会原地抖 */
export const VILLAGER_PANIC_SECONDS = 5;
/** 恐慌时的速度倍率（原版村民会加速） */
export const VILLAGER_PANIC_SPEED = 1.35;
/** 逃跑目标离自己多远（格） */
export const VILLAGER_FLEE_DISTANCE = 6;

/**
 * 会吓到村民的生物。
 *
 * 只收"原版村民真的会怕"的那几族：僵尸系（含尸壳/溺尸/僵尸村民）与灾厄村民系
 * （掠夺者/卫道士/唤魔者/幻术师/劫掠兽/恼鬼）。骷髅、苦力怕、蜘蛛不在内——
 * 原版村民对它们不恐慌（苦力怕靠猫，不靠逃跑）。
 */
const PANIC_THREAT_IDS: ReadonlySet<string> = new Set([
  'zombie',
  'husk',
  'drowned',
  'zombie_villager',
  'pillager',
  'vindicator',
  'evoker',
  'illusioner',
  'ravager',
  'vex',
]);

export function isPanicThreat(typeId: string): boolean {
  return PANIC_THREAT_IDS.has(typeId);
}

export interface PanicCandidate {
  typeId: string;
  x: number;
  z: number;
}

/**
 * 半径内最近的威胁；没有就 null。
 *
 * 并列时取**先出现的**：调用方传的是实体表顺序，稳定即可（不做 `typeId` 定序——
 * 这里不需要"两只之间不抖"，因为威胁一走开恐慌就结束）。
 */
export function nearestPanicThreat<T extends PanicCandidate>(
  x: number,
  z: number,
  candidates: readonly T[],
  radius = VILLAGER_PANIC_RADIUS,
): T | null {
  let best: T | null = null;
  let bestDistance = radius;
  for (const candidate of candidates) {
    if (!isPanicThreat(candidate.typeId)) continue;
    const distance = Math.hypot(candidate.x - x, candidate.z - z);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * 逃跑目标点：从威胁指向自己的方向再往前 `distance` 格。
 *
 * 两者重合（同一格）时朝 +X 跑——返回 NaN 会让 `guardToward` 静默不动，
 * 那种"村民被僵尸贴脸却站着不动"最难查。
 */
export function fleePointFrom(
  x: number,
  z: number,
  threatX: number,
  threatZ: number,
  distance = VILLAGER_FLEE_DISTANCE,
): { x: number; z: number } {
  const dx = x - threatX;
  const dz = z - threatZ;
  const length = Math.hypot(dx, dz);
  if (length < 1e-4) return { x: x + distance, z };
  return { x: x + (dx / length) * distance, z: z + (dz / length) * distance };
}
