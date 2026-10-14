/**
 * 轴对齐包围盒（AABB）与体素求交
 *
 * 玩家、实体、方块的碰撞体都用 AABB 表示。碰撞解析采用"逐轴移动 + 立即推出"的
 * 经典做法：每次只沿一个轴移动并解决碰撞，三次之后自然得到沿墙滑动的效果，
 * 这是与原版手感最接近且数值稳定的方案。
 */

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** 浮点误差容限：避免"刚好贴边"被判定为重叠 */
export const EPSILON = 1e-7;

export function makeAABB(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): AABB {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** 以中心点 + 尺寸构造 */
export function boxAt(cx: number, feetY: number, cz: number, width: number, height: number): AABB {
  const half = width / 2;
  return {
    minX: cx - half,
    minY: feetY,
    minZ: cz - half,
    maxX: cx + half,
    maxY: feetY + height,
    maxZ: cz + half,
  };
}

export function translate(box: AABB, dx: number, dy: number, dz: number): AABB {
  return {
    minX: box.minX + dx,
    minY: box.minY + dy,
    minZ: box.minZ + dz,
    maxX: box.maxX + dx,
    maxY: box.maxY + dy,
    maxZ: box.maxZ + dz,
  };
}

export function intersects(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX - EPSILON &&
    a.maxX > b.minX + EPSILON &&
    a.minY < b.maxY - EPSILON &&
    a.maxY > b.minY + EPSILON &&
    a.minZ < b.maxZ - EPSILON &&
    a.maxZ > b.minZ + EPSILON
  );
}

/**
 * 枚举与盒子重叠的所有体素坐标。
 * 用 `max - EPSILON` 取整，保证"刚好贴合边界"不会多算一格。
 */
export function forEachVoxel(box: AABB, fn: (x: number, y: number, z: number) => void): void {
  const x0 = Math.floor(box.minX);
  const x1 = Math.floor(box.maxX - EPSILON);
  const y0 = Math.floor(box.minY);
  const y1 = Math.floor(box.maxY - EPSILON);
  const z0 = Math.floor(box.minZ);
  const z1 = Math.floor(box.maxZ - EPSILON);

  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        fn(x, y, z);
      }
    }
  }
}

/** 局部碰撞盒：[x0, y0, z0, x1, y1, z1]，坐标在 0-1 的方块局部空间内 */
export type BoxTuple = readonly [number, number, number, number, number, number];

/** 体素碰撞查询结果 */
export type VoxelCollision = null | 'full' | readonly BoxTuple[];

/**
 * 世界碰撞查询能力（由 World 实现，接口化以避免循环依赖）。
 *
 * 返回 'full' 是快路径：绝大多数方块是完整立方体，一次判断即可，
 * 不必构造盒子。只有台阶/楼梯这类非完整方块才走精确相交检测。
 */
export interface CollisionWorld {
  collisionAt(x: number, y: number, z: number): VoxelCollision;
}

/** 盒子是否与任何方块的碰撞体重叠 */
export function collides(world: CollisionWorld, box: AABB): boolean {
  let hit = false;

  forEachVoxel(box, (x, y, z) => {
    if (hit) return;
    const collision = world.collisionAt(x, y, z);
    if (collision === null) return;
    if (collision === 'full') {
      hit = true;
      return;
    }
    for (const local of collision) {
      if (
        intersects(box, {
          minX: x + local[0],
          minY: y + local[1],
          minZ: z + local[2],
          maxX: x + local[3],
          maxY: y + local[4],
          maxZ: z + local[5],
        })
      ) {
        hit = true;
        return;
      }
    }
  });

  return hit;
}
