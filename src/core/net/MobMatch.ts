/**
 * "队友打的那只怪，是我世界里的哪一只"（联机19）。
 *
 * 为什么不用实体 id：两个客户端的生物是**各自随机生成**的（`MobSpawner` 按群系
 * 随机挑种类与位置），服务端也不跑实体模拟、没有全局 id 空间。所以"同一只怪"
 * 只能靠**类型 + 坐标邻域**来认。
 *
 * 又为什么不干脆同步位置：各端 AI 独立跑，位置会各自漂移，同步位置等于两个模拟
 * 互相拉扯（表现为怪物抖动/瞬移），而且接收方若按远端坐标画一份、本地又模拟一份，
 * 玩家会看到**双份怪物**。这一版只同步"伤害与着火"这种**事件**——它不需要两端状态
 * 一致，只需要落到"我这边最近的那只同类怪"身上。
 *
 * 纯函数、不碰网络与实体类，`tests/net-mob-sync.test.ts` 直接断言。
 */

/** 命中匹配的最大距离（格）。AI 各自跑，位置会漂 1~2 格，3 格是经验值 */
export const MOB_HIT_MATCH_DISTANCE = 3;

export interface MobMatchCandidate {
  typeId: string;
  x: number;
  y: number;
  z: number;
  /**
   * 全局键 `ownerId:localId`（L8 · MS3 起由房主分配）。
   *
   * 有它就**优先按身份认**，不再靠"同类型 + 最近"——那套在两只同类怪挨在一起时
   * 会打错人（两个人各自算出来的"最近"可能不是同一只）。
   */
  key?: string;
}

export interface MobHitTarget {
  typeId: string;
  x: number;
  y: number;
  z: number;
  /** 目标动物的全局键（新客户端带；老客户端没有，退回类型 + 邻域） */
  key?: string;
}

/**
 * 在候选里找"这次命中"该落到哪一只：**同类型 + 距离最近 + 不超过 `maxDistance`**。
 *
 * 返回 `null` 表示我这边没有对应的怪（它在我视野外、或者还没生成）——调用方直接忽略，
 * 不要凭空生成一只（那会导致双份怪物）。
 */
export function findMobMatch<T extends MobMatchCandidate>(
  candidates: Iterable<T>,
  hit: MobHitTarget,
  maxDistance: number = MOB_HIT_MATCH_DISTANCE,
): T | null {
  /*
   * 有全局键就按身份认（L8 · MS3 收尾）：这一步**不看距离与类型**——
   * 键本身就代表"那只怪"，坐标只是它的当前值。找不到再退回类型 + 邻域，
   * 这样老客户端（不带键）与"键被我这边还没收到过"这两种情况都不会变哑。
   */
  const wanted = typeof hit.key === 'string' && hit.key.length > 0 ? hit.key : null;
  if (wanted) {
    for (const candidate of candidates) {
      if (candidate.key === wanted) return candidate;
    }
  }
  if (![hit.x, hit.y, hit.z].every((value) => Number.isFinite(value))) return null;
  const limit = Math.max(0, maxDistance);

  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.typeId !== hit.typeId) continue;
    const distance = Math.hypot(candidate.x - hit.x, candidate.y - hit.y, candidate.z - hit.z);
    if (!Number.isFinite(distance) || distance > limit) continue;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
