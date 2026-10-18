/**
 * 指南针 / 时钟的角度换算（批次 195，B19）
 *
 * 两件"功能性杂物"的价值全在**一个角度**上：
 *
 *  - 指南针：指针要指向**世界出生点**。玩家转视角时指针不该跟着转，
 *    所以界面拿到的是一个"相对玩家正前方"的角度——正前方 = 0°、右手边 = 90°。
 *  - 时钟：表盘上的太阳/月亮位置。本项目的 `timeOfDay` 是 **0~1 的小数**
 *    （`0` = 日出、`0.25` = 正午、`0.5` = 日落、`0.75` = 午夜，见 `main` 的 `sunHeight`），
 *    这里换算成"正午在正上方"的表盘角。
 *
 * 为什么放在 core 而不是 UI 里：这两条都是纯函数，**离线就能断言**
 * （"朝北时指针朝上""正午时太阳在顶上"这类结论，比在浏览器里转半天视角可靠得多）。
 * 界面那边只负责 `rotate(deg)`。
 */

/**
 * 指南针指针相对**玩家正前方**的旋转角（度，顺时针为正）——给 CSS `rotate()` 直接用。
 *
 * 本项目的朝向约定（与相机一致）：`forward = (-sin yaw, -cos yaw)`，
 * 于是 yaw = 0 时正前方是 **-Z（北）**、右手边是 +X（东）。
 *
 * @param yaw 玩家朝向（弧度）
 * @param dx 目标（出生点）相对玩家的水平偏移 X
 * @param dz 同上 Z
 * @returns 0 = 指针朝上（目标在正前方）、90 = 指向右边、180 = 指向身后
 */
export function compassAngleDeg(yaw: number, dx: number, dz: number): number {
  const length = Math.hypot(dx, dz);
  // 站在出生点上：方向退化。返回 0（"就在你脚下"），界面那边另外显示"已到达"
  if (length < 1e-6) return 0;

  // 玩家局部坐标系：forward 与 right（right = (-f.z, f.x)）
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = -fz;
  const rz = fx;
  const localX = dx * rx + dz * rz;
  const localZ = dx * fx + dz * fz;
  const deg = (Math.atan2(localX, localZ) * 180) / Math.PI;
  // 归一化到 (-180, 180]，避免界面拿到 350° 这种"绕一圈"的值
  if (deg > 180) return deg - 360;
  if (deg <= -180) return deg + 360;
  return deg;
}

/**
 * 时钟表盘的角度（度，顺时针）：**正午在正上方**、午夜在正下方、日出在左边。
 *
 * @param timeOfDay 0~1 的小数（本项目的口径，见文件头）
 */
export function clockAngleDeg(timeOfDay: number): number {
  const t = Number.isFinite(timeOfDay) ? ((timeOfDay % 1) + 1) % 1 : 0;
  // 0.25（正午）→ 0°；0.75（午夜）→ 180°；0（日出）→ -90°
  return (t - 0.25) * 360;
}

/** 距出生点的水平距离（格，保留一位小数；界面里显示"离出生点 128 格"） */
export function horizontalDistance(ax: number, az: number, bx: number, bz: number): number {
  const d = Math.hypot(ax - bx, az - bz);
  return Math.round(d * 10) / 10;
}

/** 时段文字（时钟下面那行）：按 `timeOfDay` 的四等分粗分，够玩家判断"还有多久天黑" */
export function timeOfDayLabel(timeOfDay: number): string {
  const t = Number.isFinite(timeOfDay) ? ((timeOfDay % 1) + 1) % 1 : 0;
  if (t < 0.2) return '清晨';
  if (t < 0.3) return '正午';
  if (t < 0.45) return '午后';
  if (t < 0.55) return '黄昏';
  if (t < 0.7) return '入夜';
  if (t < 0.8) return '午夜';
  return '后半夜';
}
