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
}

export interface MobHitTarget {
  typeId: string;
  x: number;
  y: number;
  z: number;
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
