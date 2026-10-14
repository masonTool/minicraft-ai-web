/**
 * 实体射线检测（近战攻击用）
 *
 * 用经典的 slab 方法求射线与实体 AABB 的交点距离：
 * 对 x/y/z 三个轴分别把射线夹到盒子的范围内，最后取三段的交集；
 * 交集为空说明没穿过盒子，否则交点距离就是 tMin。
 *
 * 之所以不复用体素射线：生物不是格子，而是"中心点 + 宽高"的盒子，
 * 而且有多个实体时还要取最近的那个。
 */

import type { Entity } from '../entity/Entity.ts';

export interface EntityHit {
  entity: Entity;
  /** 相机到命中点的距离 */
  distance: number;
}

/** 射线与盒子相交的距离；不相交返回 null */
export function rayBoxDistance(
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxDistance: number,
): number | null {
  let tMin = 0;
  let tMax = maxDistance;

  const axes: readonly [number, number, number, number][] = [
    [originX, dirX, minX, maxX],
    [originY, dirY, minY, maxY],
    [originZ, dirZ, minZ, maxZ],
  ];

  for (const [origin, dir, min, max] of axes) {
    if (Math.abs(dir) < 1e-8) {
      // 平行于该轴：起点必须已经在夹层之间
      if (origin < min || origin > max) return null;
      continue;
    }
    const inverse = 1 / dir;
    let t1 = (min - origin) * inverse;
    let t2 = (max - origin) * inverse;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  return tMin;
}

/**
 * 在实体列表中找最近的被射线命中的实体。
 * @param maxDistance 攻击距离（原版约 3 格）
 */
export function raycastEntities(
  entities: readonly Entity[],
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  maxDistance: number,
): EntityHit | null {
  const length = Math.hypot(dirX, dirY, dirZ);
  if (length === 0) return null;
  const dx = dirX / length;
  const dy = dirY / length;
  const dz = dirZ / length;

  let best: EntityHit | null = null;

  for (const entity of entities) {
    if (entity.dead) continue;
    const half = entity.width / 2;
    const distance = rayBoxDistance(
      originX,
      originY,
      originZ,
      dx,
      dy,
      dz,
      entity.x - half,
      entity.y,
      entity.z - half,
      entity.x + half,
      entity.y + entity.height,
      entity.z + half,
      maxDistance,
    );
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { entity, distance };
  }

  return best;
}
