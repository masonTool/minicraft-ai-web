/**
 * 空闲降帧（批次 20261031，用户 2026-10-31 提出）。
 *
 * 玩家没有任何操作、画面也没在动（相机位姿不变）超过 `IDLE_AFTER_MS`，就把帧率上限压到
 * `IDLE_MAX_FPS`；任何一次触摸 / 鼠标 / 键盘 / 手柄输入，**下一帧**就恢复不限帧。
 *
 * 不降的情形（保证原逻辑速度不变）：
 *  - 手指 / 鼠标键按住不放（挖方块时没有新事件，但玩家在操作）；
 *  - 世界还在加载（区块生成 / 网格化 / 光照每帧有预算，降帧会让加载变慢）——由调用方传 `busy`；
 *  - 相机还在动（坠落、载具、被击退）——由 `afterRender` 比较位姿判出。
 *
 * 只决定"这一帧画不画"，与设置里的 `maxFps` 一样走 `frameIntervalMs`，取两者里更严的那个。
 */

export const IDLE_AFTER_MS = 2500;
export const IDLE_MAX_FPS = 30;
/** 网格队列 + 在途请求超过这么多才算"成批加载"（随机刻零星重刷不算） */
export const IDLE_MESH_BACKLOG = 6;
/** 光照待办格数超过这么多才算"成批补光" */
export const IDLE_LIGHT_BACKLOG = 4096;

/** 位置变化小于 1 毫米、朝向四元数分量变化小于 1e-5 视为没动 */
const POSITION_EPSILON = 1e-3;
const ROTATION_EPSILON = 1e-5;

export interface CameraPose {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}

export class IdleFrameRate {
  private lastActiveAt = Number.NEGATIVE_INFINITY;
  private pointersDown = 0;
  private readonly pose = new Float64Array(7);
  private hasPose = false;
  /** 上一次 `capFor` 是否给出了上限（诊断与自适应采样用） */
  capped = false;

  /** 任意输入事件 */
  noteInput(now: number): void {
    this.lastActiveAt = now;
  }

  pointerDown(now: number): void {
    this.pointersDown++;
    this.lastActiveAt = now;
  }

  pointerUp(now: number): void {
    this.pointersDown = Math.max(0, this.pointersDown - 1);
    this.lastActiveAt = now;
  }

  /** 失焦 / 切后台时按键松开事件可能收不到，清零避免一直"按住" */
  resetPointers(): void {
    this.pointersDown = 0;
  }

  /** 本帧的帧率上限（0 = 不限） */
  capFor(now: number, busy: boolean): number {
    const idle = !busy && this.pointersDown === 0 && now - this.lastActiveAt >= IDLE_AFTER_MS;
    this.capped = idle;
    return idle ? IDLE_MAX_FPS : 0;
  }

  /** 每画完一帧调用：相机位姿和上一帧不同就算"画面在动" */
  afterRender(now: number, camera: CameraPose): void {
    const p = camera.position;
    const q = camera.quaternion;
    const pose = this.pose;
    const moved =
      !this.hasPose ||
      Math.abs(pose[0]! - p.x) > POSITION_EPSILON ||
      Math.abs(pose[1]! - p.y) > POSITION_EPSILON ||
      Math.abs(pose[2]! - p.z) > POSITION_EPSILON ||
      Math.abs(pose[3]! - q.x) > ROTATION_EPSILON ||
      Math.abs(pose[4]! - q.y) > ROTATION_EPSILON ||
      Math.abs(pose[5]! - q.z) > ROTATION_EPSILON ||
      Math.abs(pose[6]! - q.w) > ROTATION_EPSILON;
    if (!moved) return;
    pose[0] = p.x;
    pose[1] = p.y;
    pose[2] = p.z;
    pose[3] = q.x;
    pose[4] = q.y;
    pose[5] = q.z;
    pose[6] = q.w;
    this.hasPose = true;
    this.lastActiveAt = now;
  }
}
