/**
 * 仙人掌接触判定（批次 222）
 *
 * 为什么单独一个纯函数：这个判定有**一个很容易写错的前提**——
 * 玩家是被碰撞系统挡在**整格边界**上的（`moveX/moveZ` 的推出用的是整格钳制），
 * 而仙人掌的碰撞盒只有 14/16 宽（`blockShapes.ts` 的 `CACTUS_BOX`）。
 * 于是玩家与仙人掌盒之间永远留着 1/16 的缝，直接拿"盒子相交"判定**永远不会触发**，
 * 表现就是"贴着仙人掌走半天也不掉血"。
 *
 * 原版是靠"玩家盒与仙人掌盒刚好贴边（相交含边界）"判的；这里等价地把玩家盒
 * 横向**放大一点**（`PAD`）再判相交——宁可多算 0.04 格，也不要漏掉贴着的那一下。
 *
 * 另外两条：
 *  - 只放大 X/Z，不放大 Y：**站在仙人掌顶上不算贴着**（我们的碰撞盒顶面是满格高的，
 *    站在上面脚底与盒顶贴合，放大 Y 会把"站着"判成"贴着"）；
 *  - 逐格问 `collisionAt` 而不是硬编码 14/16：形状表改了这里不用跟着改。
 */

import { forEachVoxel, intersects, type AABB, type CollisionWorld } from '../physics/AABB.ts';

/** 横向吸附容差（格）：玩家被整格钳制挡下后，与 14/16 盒之间的缝是 1/16 = 0.0625 */
export const CACTUS_PAD = 0.1;

/**
 * 玩家的身体是否贴着仙人掌。
 *
 * @param world    碰撞查询（只要 `collisionAt`，与物理层同一份形状数据）
 * @param box      玩家包围盒
 * @param isCactus 这一格是不是仙人掌（由调用方注入方块 id 判定，本模块不依赖方块表）
 */
export function touchesCactus(
  world: CollisionWorld,
  box: AABB,
  isCactus: (x: number, y: number, z: number) => boolean,
  pad = CACTUS_PAD,
): boolean {
  const grown: AABB = {
    minX: box.minX - pad,
    minY: box.minY,
    minZ: box.minZ - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY,
    maxZ: box.maxZ + pad,
  };

  let touching = false;
  forEachVoxel(grown, (x, y, z) => {
    if (touching || !isCactus(x, y, z)) return;
    const collision = world.collisionAt(x, y, z);
    if (collision === null) return;
    const boxes: ReadonlyArray<readonly [number, number, number, number, number, number]> =
      collision === 'full' ? [[0, 0, 0, 1, 1, 1] as const] : collision;
    for (const local of boxes) {
      if (
        intersects(grown, {
          minX: x + local[0],
          minY: y + local[1],
          minZ: z + local[2],
          maxX: x + local[3],
          maxY: y + local[4],
          maxZ: z + local[5],
        })
      ) {
        touching = true;
        return;
      }
    }
  });
  return touching;
}
