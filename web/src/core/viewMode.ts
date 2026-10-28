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
import { t } from './i18n/I18n.ts';


export type CameraMode = 'first' | 'third-back' | 'third-front';

/** `V` 键的循环顺序：第一人称 → 背后 → 正面 → 第一人称 */
export const CAMERA_MODES: readonly CameraMode[] = ['first', 'third-back', 'third-front'];

/** 相机模式的键后缀（`third-back` 这种带连字符的 id 不能直接当键名的一部分） */
const CAMERA_MODE_KEY: Record<CameraMode, string> = {
  first: 'first',
  'third-back': 'thirdBack',
  'third-front': 'thirdFront',
};

/**
 * 相机模式的显示名（批次 20261024-0136）。
 *
 * 原来是一张中文常量表 —— 与 P6-1 修的 `DIFFICULTY_LABELS` / `GAME_MODE_LABELS` 同一个毛病：
 * 设置面板在德语/俄语界面上会直接显示「第一人称」。现在走 `settings.cameraMode.*`。
 *
 * ⚠️ 键写成模板字面量，`audit:i18n` 才认得出这一族被引用了。
 */
export function cameraModeLabel(mode: CameraMode): string {
  return t(`settings.cameraMode.${CAMERA_MODE_KEY[mode]}`);
}

/** 第三人称相机距眼睛的距离（格） */
export const THIRD_PERSON_DISTANCE = 3.8;
/** 相机与方块之间至少留出的空隙，避免贴脸时把镜头卡进方块里 */
export const CAMERA_CLEARANCE = 0.22;
/**
 * 相机被墙压到这个距离以内时，镜头基本已经贴到后脑勺：
 * 玩家模型要藏起来（否则会看到模型的内部），镜头本身继续沿射线靠近眼睛。
 *
 * 它**不是**相机距离的下限——下限会把镜头强行推过撞点、推进墙里，
 * 表现就是"贴着墙时能透视看到墙后的世界"（批次 282 修掉的正是这个）。
 */
export const CLOSE_CAMERA_HIDE_PLAYER = 0.9;

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
  // ⚠️ 这里**不能**再套一个 `Math.max(0.6, …)`：玩家背贴墙时撞点可能只有 0.3，
  // 强行留 0.6 会把镜头推到撞点**后面**（墙里）。方块的面在相邻实心格之间被剔除，
  // 从墙里看出去就是"墙皮后面还有一个世界"的透视。宁可镜头贴到眼睛，也不越过撞点。
  return Math.max(0, Math.min(THIRD_PERSON_DISTANCE, hitDistance - CAMERA_CLEARANCE));
}

/**
 * 算出相机应该摆在哪、朝哪。
 *
 * @param dir 视线方向（单位向量，本项目 `yaw=0` 时是 -Z）
 *
 *  - 第一人称：就架在眼睛上，朝向 = (pitch, yaw)
 *  - 第三人称（背后）：沿视线的**反**方向退 distance 格，朝向仍是 (pitch, yaw)
 *  - 第三人称（正面）：水平方向前移 distance 格、竖直方向与视线相反
 *    （低头时升到前上方、抬头时降到前下方），朝向转 180° 回头看玩家
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
  // 水平：背后往视线反方向退、正面往视线方向前移
  const horizontal = behind ? -1 : 1;
  return {
    x: eye.x + dir.x * distance * horizontal,
    // 竖直：两种第三人称都与视线相反。低头时背后相机升到后上方、正面升到前上方，
    // 这样相机不会钻进地里，玩家也保持在画面中心（批次 532）。
    y: eye.y - dir.y * distance,
    z: eye.z + dir.z * distance * horizontal,
    yaw: behind ? yaw : yaw + Math.PI,
    pitch,
  };
}
