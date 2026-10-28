/**
 * 村庄守卫的目标选择（批次 474，J24 的第二半）
 *
 * 铁傀儡原本只有"站在村庄里"这一半：`type.hostile` 是 false，`Mob.tick` 走游荡分支，
 * 谁打它它才还手。这一批给它一条**独立的目标选择**，不塞进 `Mob.tick` 那套
 * "追玩家"的分支里——那套逻辑为了玩家写死了视线、隐身、宠物跟随、求偶等十几条，
 * 硬插会让每条分支都要多判一次。
 *
 * 这里的判据是纯函数，所以"选谁、多远、并列怎么办"都能离线断言：
 *  - 只选**敌对**生物（僵尸/骷髅/苦力怕…，不含村民/动物/其他铁傀儡）；
 *  - 半径 16 格（原版铁傀儡的索敌距离约 16）；
 *  - **最近的优先**；距离并列时按 `id` 字典序——不是"看谁先遍历到"，
 *    否则同样的局面每帧可能换目标，守卫会在两只僵尸之间来回抖。
 */

/** 索敌半径（格）：原版铁傀儡约 16 */
export const GUARD_RANGE = 16;
/** 近战触及（格）：铁傀儡手臂长，原版约 2.2 */
export const GUARD_ATTACK_RANGE = 2.2;
/** 出手间隔（秒）：原版约 1.2 */
export const GUARD_ATTACK_COOLDOWN = 1.2;
/** 一次伤害（点）：原版铁傀儡 7~21，这里取中位 */
export const GUARD_DAMAGE = 7;

export interface GuardCandidate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 生物类型（并列排序用 `type.id`；`Mob` 天然满足这个形状，不需要包一层） */
  readonly type: { readonly id: string };
  readonly dead: boolean;
}

export interface GuardTarget<T extends GuardCandidate> {
  readonly target: T;
  readonly distance: number;
}

/**
 * 从候选里挑一个最近的敌对目标。
 *
 * @param from 守卫自己的位置（不参与筛选，调用方负责把"自己"从候选里去掉）
 * @param candidates 视野内的生物
 * @param range 索敌半径（格）
 * @param isHostile 判"这一只是不是敌人"（由调用方按 `MobType.hostile` 决定）
 */
export function nearestHostileTarget<T extends GuardCandidate>(
  from: { x: number; y: number; z: number },
  candidates: readonly T[],
  range: number,
  isHostile: (candidate: T) => boolean,
): GuardTarget<T> | null {
  let best: GuardTarget<T> | null = null;
  for (const candidate of candidates) {
    if (candidate.dead || !isHostile(candidate)) continue;
    // 用水平距离：守卫站在地上，目标可能在半空（比如刚被击退），
    // 按三维距离算会让"头顶那只"永远比"对面那只"远，选目标的直觉就乱了
    const distance = Math.hypot(candidate.x - from.x, candidate.z - from.z);
    if (distance > range) continue;
    if (best === null || distance < best.distance) {
      best = { target: candidate, distance };
      continue;
    }
    // 距离并列（浮点相等在网格化世界里很常见：两只僵尸并排走过来）→ 按 id 定序
    if (distance === best.distance && candidate.type.id < best.target.type.id) {
      best = { target: candidate, distance };
    }
  }
  return best;
}
