/**
 * 望远镜（B15 的 1.17 尾巴，批次 518）
 *
 * 原版：**按住使用键**把视野压到约 1/10，松手恢复；镜筒本身不消耗。
 * 这里只做纯函数那一半（"目标 FOV 是多少"），相机缓动与输入判定在主程序。
 *
 * 为什么单独抽一个函数：
 *  - 手机与桌面的基础 FOV 不同（90 / 70），倍率必须乘在**当前基础视野**上，
 *    不能写死一个 8——否则手机上一放大就只剩一条缝；
 *  - 夹一个下限（6°），避免玩家把视野拉到 30° 之后放大到不可用的程度。
 */

/** 放大倍率（原版约 0.1；这里取 0.12，桌面 70° → 8.4°） */
export const SPYGLASS_ZOOM = 0.12;
/** 放大后的最小视野（度） */
export const SPYGLASS_MIN_FOV = 6;
/** 进入/退出的缓动速度（每秒收敛比例，越大越快） */
export const SPYGLASS_EASE_IN = 12;
export const SPYGLASS_EASE_OUT = 9;

/** 这个基础视野下，举起望远镜的目标 FOV */
export function spyglassFov(baseFov: number): number {
  // 脏数据（0 / NaN）按桌面默认 70 算——不能返回 NaN，那会让投影矩阵整块失效
  const base = Number.isFinite(baseFov) && baseFov > 0 ? baseFov : 70;
  return Math.max(SPYGLASS_MIN_FOV, base * SPYGLASS_ZOOM);
}

/** 放大中还是没放大（界面/音效以后要用同一判据） */
export function isSpyglassZoomed(fov: number, baseFov: number): boolean {
  return fov < baseFov * 0.5;
}
