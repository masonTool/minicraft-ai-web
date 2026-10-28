/**
 * 远端实体的"分级关注"（联机20）。
 *
 * 联机时队友的位置 100ms 一条，但**远处的队友不值得按这个精度处理**：16 格外
 * 每帧插值、每 100ms 更新目标，纯属把 CPU 花在看不见的地方。
 *
 * 分三档（与条目口径一致）：16 格内 100ms、32 格内 250ms、更远不更新。
 *
 * ⚠️ 这里只解决**接收侧**的成本：真正的带宽节流要在发送侧（服务端按距离决定发给谁），
 * 那是联机27（广播 AOI）。客户端能做的只有"值不值得插值/更新"。
 *
 * 纯逻辑、不碰渲染与网络，`tests/net-aoi.test.ts` 直接断言；`npm run test:perf`
 * 里还有一条"1 秒内的接受次数上限"的操作预算断言。
 */

/** 近档半径（格）：这个范围内按原频率更新 */
export const AOI_NEAR_RANGE = 16;
/** 中档半径（格）：超出近档但没超过这个，降频更新 */
export const AOI_MID_RANGE = 32;
/** 近档更新间隔（毫秒） */
export const AOI_NEAR_INTERVAL_MS = 100;
/** 中档更新间隔（毫秒） */
export const AOI_MID_INTERVAL_MS = 250;

export type AoiLevel = 'near' | 'mid' | 'far';

/** 距离 → 档位。正好落在边界上算近档（边界值偏好"更精细"这一侧） */
export function aoiLevel(distance: number): AoiLevel {
  if (!Number.isFinite(distance) || distance <= AOI_NEAR_RANGE) return 'near';
  if (distance <= AOI_MID_RANGE) return 'mid';
  return 'far';
}

/** 档位 → 更新间隔（毫秒）；`far` 用 `Infinity` 表示"不更新" */
export function aoiIntervalMs(level: AoiLevel): number {
  if (level === 'near') return AOI_NEAR_INTERVAL_MS;
  if (level === 'mid') return AOI_MID_INTERVAL_MS;
  return Number.POSITIVE_INFINITY;
}

/** 距离 → 更新间隔，两步合成的快捷方式 */
export function aoiIntervalForDistance(distance: number): number {
  return aoiIntervalMs(aoiLevel(distance));
}

/**
 * 每个远端实体记住"上次接受更新的时刻"，据此决定这条网络更新要不要采纳。
 *
 * 为什么按 id 分开记：队友 A 在近处、队友 B 在远处时，两边的间隔不同，共用一份
 * 时间戳会让近处那位被远处的降频拖累。
 */
export class RemoteAoiGate {
  private readonly lastAccepted = new Map<number, number>();

  /**
   * 这条更新要不要接受。
   *
   * `far` 档**不接受**（返回值 false）——注意这是"接收侧不接受"：位置不会再传给
   * 插值器，实体停在上一次的位置。真正的"更远不发"在服务端（联机27）。
   */
  accept(id: number, distance: number, nowMs: number): boolean {
    const interval = aoiIntervalForDistance(distance);
    if (!Number.isFinite(interval)) return false;

    const last = this.lastAccepted.get(id);
    if (last !== undefined && nowMs - last < interval) return false;
    this.lastAccepted.set(id, nowMs);
    return true;
  }

  forget(id: number): void {
    this.lastAccepted.delete(id);
  }

  clear(): void {
    this.lastAccepted.clear();
  }

  get size(): number {
    return this.lastAccepted.size;
  }
}
