/**
 * 远程玩家位置插值（L4，批次 601）
 *
 * 网络位置是**离散到达**的（服务端一个 tick 发一次），直接赋值会让模型每次更新
 * 跳一小步。这里维护一个渲染位置，向最新目标做指数逼近：
 *
 *  - 正常移动：`1 - exp(-dt / tau)` 逼近，帧率无关；
 *  - 瞬移（重生/传送门）：距离超过 `TELEPORT_SNAP` 直接对齐，不拖一条长线；
 *  - 朝向：按**最短角**插值，350° → 10° 不会绕一整圈。
 *
 * 纯类，不碰 Three.js，也不读时钟（dt 由调用方给），因此可离线断言。
 */

export interface RemotePoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** 收敛时间常数（秒）：越小越"跟手"，越大越平滑 */
export const REMOTE_SMOOTH_TAU = 0.08;
/** 超过这个距离认为是瞬移，直接对齐 */
export const REMOTE_TELEPORT_SNAP = 8;

/** 最短角插值：结果在 (-π, π] */
export function lerpAngle(from: number, to: number, t: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
}

export class RemotePlayerSmoother {
  private target: RemotePoint;
  private current: RemotePoint;

  constructor(initial: RemotePoint) {
    this.target = { ...initial };
    this.current = { ...initial };
  }

  /** 收到一条网络位置；瞬移直接对齐，普通移动只更新目标 */
  setTarget(next: RemotePoint): void {
    this.target = { ...next };
    const distance = Math.hypot(next.x - this.current.x, next.y - this.current.y, next.z - this.current.z);
    if (distance > REMOTE_TELEPORT_SNAP) {
      this.current = { ...next };
    }
  }

  /** 推进一帧，返回这一帧应该渲染的位置（同一个对象，调用方只读） */
  step(dt: number): RemotePoint {
    if (!(dt > 0)) return this.current;
    const t = 1 - Math.exp(-dt / REMOTE_SMOOTH_TAU);
    this.current.x += (this.target.x - this.current.x) * t;
    this.current.y += (this.target.y - this.current.y) * t;
    this.current.z += (this.target.z - this.current.z) * t;
    this.current.yaw = lerpAngle(this.current.yaw, this.target.yaw, t);
    return this.current;
  }

  get position(): RemotePoint {
    return this.current;
  }

  get goal(): RemotePoint {
    return this.target;
  }
}
