/**
 * 视角模式（F7）：第一人称 / 第三人称（背后）/ 第三人称（正面）
 *
 * 单独放一个不依赖任何东西的小模块，有三个原因：
 *  1. 它是**一条设置**（`ui/SettingsScreen.ts` 要存盘与渲染下拉框），
 *     main.ts 也要用；放在 main 里会绕成循环依赖；
 *  2. "相机摆在哪"是纯数学，抽成纯函数才能在离线测试里断言（`tools/viewmode-test.ts`），
 *     不然只能靠肉眼看截图；
 *  3. 正负号很容易写反（背后要用视线的**反**方向），集中在一处不容易改错。
 */

export type CameraMode = 'first' | 'third-back' | 'third-front';

/** `V` 键的循环顺序：第一人称 → 背后 → 正面 → 第一人称 */
export const CAMERA_MODES: readonly CameraMode[] = ['first', 'third-back', 'third-front'];

export const CAMERA_MODE_LABELS: Record<CameraMode, string> = {
  first: '第一人称',
  'third-back': '第三人称（背后）',
  'third-front': '第三人称（正面）',
};

/** 第三人称相机距眼睛的距离（格） */
export const THIRD_PERSON_DISTANCE = 3.8;
/** 相机与方块之间至少留出的空隙，避免贴脸时把镜头卡进方块里 */
export const CAMERA_CLEARANCE = 0.22;
/** 相机被方块顶到时的最近距离（再近就变成"贴着玩家后脑勺"了） */
export const MIN_CAMERA_DISTANCE = 0.6;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPlacement {
  x: number;
  y: number;
  z: number;
  /** 相机的偏航角（第三人称正面要转 180°） */
  yaw: number;
  pitch: number;
}

/** 循环到下一个视角模式 */
export function nextCameraMode(mode: CameraMode): CameraMode {
  const index = CAMERA_MODES.indexOf(mode);
  return CAMERA_MODES[(index + 1) % CAMERA_MODES.length]!;
}

/**
 * 第三人称相机距离。
 *
 * @param hitDistance 从眼睛沿相机方向打出的射线命中距离；没命中传 null
 *
 * 撞到方块时必须提前停下，否则镜头会退进方块内部——玩家看到的是方块的背面，
 * 画面上就是一片黑（贴着墙时尤其明显）。
 */
export function clampedCameraDistance(hitDistance: number | null): number {
  if (hitDistance === null) return THIRD_PERSON_DISTANCE;
  return Math.max(MIN_CAMERA_DISTANCE, Math.min(THIRD_PERSON_DISTANCE, hitDistance - CAMERA_CLEARANCE));
}

/**
 * 算出相机应该摆在哪、朝哪。
 *
 * @param dir 视线方向（单位向量，本项目 `yaw=0` 时是 -Z）
 *
 *  - 第一人称：就架在眼睛上，朝向 = (pitch, yaw)
 *  - 第三人称（背后）：沿视线的**反**方向退 distance 格，朝向仍是 (pitch, yaw)
 *  - 第三人称（正面）：沿视线方向前移 distance 格，朝向转 180° 回头看玩家
 */
export function cameraPlacement(
  eye: Vec3,
  dir: Vec3,
  yaw: number,
  pitch: number,
  mode: CameraMode,
  distance: number,
): CameraPlacement {
  if (mode === 'first') {
    return { x: eye.x, y: eye.y, z: eye.z, yaw, pitch };
  }
  const behind = mode === 'third-back';
  const sign = behind ? -1 : 1;
  return {
    x: eye.x + dir.x * distance * sign,
    y: eye.y + dir.y * distance * sign,
    z: eye.z + dir.z * distance * sign,
    yaw: behind ? yaw : yaw + Math.PI,
    pitch,
  };
}
