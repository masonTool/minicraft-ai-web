/**
 * 体素射线投射（Amanatides & Woo 算法）
 *
 * 用于方块选取：从相机沿视线方向步进，返回第一个命中的方块、命中面的法线以及距离。
 * 该算法按体素边界推进，不会漏掉细小的方块，也不会重复访问同一格。
 */

export interface RayHit {
  /** 命中方块坐标 */
  x: number;
  y: number;
  z: number;
  /** 命中面法线（指向射线来的一侧） */
  nx: number;
  ny: number;
  nz: number;
  /** 起点到命中面的距离 */
  distance: number;
}

/**
 * @param isTarget 该体素是否阻挡射线（一般是"非空气且非流体"）
 */
export function raycastVoxels(
  isTarget: (x: number, y: number, z: number) => boolean,
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistance: number,
): RayHit | null {
  // 方向归一化，保证 distance 是真实距离
  const length = Math.hypot(dirX, dirY, dirZ);
  if (length === 0) return null;
  const dx = dirX / length;
  const dy = dirY / length;
  const dz = dirZ / length;

  let x = Math.floor(originX);
  let y = Math.floor(originY);
  let z = Math.floor(originZ);

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Number.POSITIVE_INFINITY;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Number.POSITIVE_INFINITY;

  let tMaxX =
    dx > 0 ? (x + 1 - originX) / dx : dx < 0 ? (x - originX) / dx : Number.POSITIVE_INFINITY;
  let tMaxY =
    dy > 0 ? (y + 1 - originY) / dy : dy < 0 ? (y - originY) / dy : Number.POSITIVE_INFINITY;
  let tMaxZ =
    dz > 0 ? (z + 1 - originZ) / dz : dz < 0 ? (z - originZ) / dz : Number.POSITIVE_INFINITY;

  // 起点所在方块也算命中（贴脸放置时需要）
  let nx = -stepX;
  let ny = 0;
  let nz = 0;
  let travelled = 0;

  // 最多步进 maxDistance * 2 次，兜底防止浮点异常导致死循环
  const maxSteps = Math.ceil(maxDistance * 2) + 8;
  for (let step = 0; step < maxSteps; step++) {
    if (isTarget(x, y, z)) {
      return { x, y, z, nx, ny, nz, distance: travelled };
    }

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      x += stepX;
      travelled = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY <= tMaxZ) {
      y += stepY;
      travelled = tMaxY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      travelled = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }

    if (travelled > maxDistance) break;
  }

  return null;
}
