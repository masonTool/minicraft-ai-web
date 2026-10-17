/**
 * 世界边界（K12，批次 175）
 *
 * 它是一道**以世界原点附近某个点为中心的正方形边界**（原版就是方的，不是圆的）：
 * 玩家可以走到边上、可以站在边上往外看，但**越过之后开始掉血、再往外就被挡回来**。
 *
 * 口径（都写在这里，主程序与断言共用）：
 *  - **尺寸是边长**（原版 `size` 就是边长，默认 29999984 ≈ 3 千万格）
 *  - 边缘 = `中心 ± size/2`
 *  - 越过边缘：**每秒 1 点伤害**，每多超出 5 格再加 1 点（`borderDamagePerSecond`）
 *  - 越过边缘 **5 格**之后**硬推回**（`clampToBorder`）——原版只伤害不推回，
 *    但"能一直往外走、只是掉血"在手机上体验很差（玩家会以为边界没生效），
 *    所以这里是**软区 5 格 + 硬墙**：先让你站出去看看，再把你挡住。
 *
 * ⚠️ 这个模块是**纯函数**（不引 THREE、不引 DOM），所以边界行为能离线断言；
 * 画那四道蓝墙的事在 `render/BorderRenderer.ts` 里。
 */

/** 默认边长（原版 29999984，约等于世界最大坐标的一倍） */
export const DEFAULT_BORDER_SIZE = 29_999_984;
/** 最小边长（原版 `/worldborder set` 允许到 1） */
export const BORDER_MIN_SIZE = 1;
/** 最大边长（与默认值同一个上限） */
export const BORDER_MAX_SIZE = 29_999_984;
/** 越界之后还能站多远的"软区"（格）：超过这个距离就被硬推回 */
export const BORDER_SOFT_ZONE = 5;
/** 距离边缘多近算"快到边界了"（HUD 与断言用） */
export const BORDER_WARN_DISTANCE = 5;

export interface WorldBorder {
  readonly centerX: number;
  readonly centerZ: number;
  /** 边长（不是半边长） */
  readonly size: number;
}

export function defaultBorder(): WorldBorder {
  return { centerX: 0, centerZ: 0, size: DEFAULT_BORDER_SIZE };
}

/** 边长夹到合法区间（`/worldborder set` 与读档都走它） */
export function clampBorderSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_BORDER_SIZE;
  return Math.max(BORDER_MIN_SIZE, Math.min(BORDER_MAX_SIZE, Math.floor(size)));
}

/**
 * 读档容错：脏数据（少字段、类型不对、NaN）一律回退默认，
 * 与 `restoreWeather` 同一口径——**读档永远不该抛错**。
 */
export function normalizeBorder(raw: unknown): WorldBorder {
  if (typeof raw !== 'object' || raw === null) return defaultBorder();
  const record = raw as Partial<Record<keyof WorldBorder, unknown>>;
  const centerX = Number(record.centerX);
  const centerZ = Number(record.centerZ);
  const size = Number(record.size);
  return {
    centerX: Number.isFinite(centerX) ? Math.floor(centerX) : 0,
    centerZ: Number.isFinite(centerZ) ? Math.floor(centerZ) : 0,
    size: clampBorderSize(size),
  };
}

/** 半边长（边缘到中心的距离） */
export function borderHalf(border: WorldBorder): number {
  return border.size / 2;
}

/**
 * 越界多少格（在里面返回 0）。
 *
 * 正方形边界要取两个方向里**更大的那个超出量**：站在角外侧时两个方向都超了，
 * 按 max 算才是"离边界最远的那个方向有多远"。
 */
export function borderOvershoot(border: WorldBorder, x: number, z: number): number {
  const half = borderHalf(border);
  const dx = Math.abs(x - border.centerX) - half;
  const dz = Math.abs(z - border.centerZ) - half;
  return Math.max(0, dx, dz);
}

/** 离边缘还有多少格（在里面为正；在软区里为负） */
export function borderDistanceToEdge(border: WorldBorder, x: number, z: number): number {
  return -borderOvershoot(border, x, z);
}

/**
 * 越界伤害（点/秒）。
 *
 * 原版是"按超出的距离分段、每 0.5 秒结算一次"，具体数值不好复刻（还受难度影响）；
 * 这里取一条**能读出来的**规则：越界就 1 点/秒，每多超出 5 格再加 1 点。
 * 好处是"贴着边界走"和"冲出很远"的手感明显不同，而且一句话能说清。
 */
export function borderDamagePerSecond(border: WorldBorder, x: number, z: number): number {
  const overshoot = borderOvershoot(border, x, z);
  if (overshoot <= 0) return 0;
  return 1 + Math.floor(overshoot / BORDER_SOFT_ZONE);
}

/** 超过软区就要被推回（原版没有硬墙，这是本项目刻意的差异，见文件头） */
export function borderBlocksMovement(border: WorldBorder, x: number, z: number): boolean {
  return borderOvershoot(border, x, z) > BORDER_SOFT_ZONE;
}

/**
 * 把位置夹回边界（含软区）。返回新的坐标与"是否动过"。
 *
 * ⚠️ 夹的是**坐标本身**，不是速度：物理层每帧都会拿它算碰撞，
 * 而"被一堵看不见的墙挡住"与"被方块挡住"在玩家那边是同一件事。
 */
export function clampToBorder(
  border: WorldBorder,
  x: number,
  z: number,
): { x: number; z: number; clamped: boolean } {
  const half = borderHalf(border) + BORDER_SOFT_ZONE;
  const minX = border.centerX - half;
  const maxX = border.centerX + half;
  const minZ = border.centerZ - half;
  const maxZ = border.centerZ + half;
  // 留一点点余量：正好压在边界上时，下一帧的浮点误差会来回抖
  const inset = 1e-4;
  const clampedX = Math.max(minX + inset, Math.min(maxX - inset, x));
  const clampedZ = Math.max(minZ + inset, Math.min(maxZ - inset, z));
  return { x: clampedX, z: clampedZ, clamped: clampedX !== x || clampedZ !== z };
}

/** 边界的四角（渲染与调试面板用） */
export function borderCorners(border: WorldBorder): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const half = borderHalf(border);
  return {
    minX: border.centerX - half,
    maxX: border.centerX + half,
    minZ: border.centerZ - half,
    maxZ: border.centerZ + half,
  };
}

/** 调试面板那一行（主程序与断言共用同一句话） */
export function describeBorder(border: WorldBorder): string {
  const half = borderHalf(border);
  return `边界 边长 ${border.size} 格 · 中心 (${border.centerX}, ${border.centerZ}) · 边缘 ±${half}`;
}
