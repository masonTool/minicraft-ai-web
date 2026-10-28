/**
 * 海绵吸水（批次 449，B54 里"要行为"的四件之一）
 *
 * 原版规则（1.18）：
 *  - 干海绵放下时吸收**以它为中心的 7×7×7 立方体**（半径 3）里的水，
 *    最多吸 **65 格**（不是 343 格——这个上限比范围更早生效）；
 *  - 只要吸到了至少一格水，**自己就变成湿海绵**；附近没水则保持干海绵；
 *  - 湿海绵不做任何事，要在熔炉里烤干才变回海绵（配方见 `Smelting.ts`）。
 *
 * 纯逻辑：世界只要求"读一格 / 写一格"。吸水顺序按**到中心的距离**从近到远，
 * 这样"只剩 65 格的上限"时吸掉的是身边那一圈，而不是立方体某个角。
 */

import { Block } from '../registry/blocks.ts';

export interface SpongeWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, state: number): boolean;
}

/** 吸水立方体的半径（3 → 7×7×7） */
export const SPONGE_RADIUS = 3;
/** 一次最多吸多少格水（原版 65） */
export const SPONGE_MAX_ABSORB = 65;

/**
 * 按到中心的距离排好的偏移表。
 *
 * 模块加载时算一次（343 项）；排序的比较器里带 y/x/z 只是为了让"同样距离"的顺序
 * 在每次运行里都一致——否则上限截断时吸掉哪 65 格会随机，离线断言写不了。
 */
const OFFSETS: readonly (readonly [number, number, number])[] = (() => {
  const list: Array<[number, number, number, number]> = [];
  for (let dy = -SPONGE_RADIUS; dy <= SPONGE_RADIUS; dy++) {
    for (let dx = -SPONGE_RADIUS; dx <= SPONGE_RADIUS; dx++) {
      for (let dz = -SPONGE_RADIUS; dz <= SPONGE_RADIUS; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        list.push([dx, dy, dz, dx * dx + dy * dy + dz * dz]);
      }
    }
  }
  list.sort((a, b) => a[3] - b[3] || a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  return list.map(([dx, dy, dz]) => [dx, dy, dz] as const);
})();

/**
 * 以 (x,y,z) 为中心吸一次水。
 *
 * @returns 吸掉了几格水（0 = 附近没水，调用方据此决定要不要变成湿海绵）
 */
export function absorbWater(
  world: SpongeWorld,
  x: number,
  y: number,
  z: number,
  max: number = SPONGE_MAX_ABSORB,
): number {
  let absorbed = 0;
  for (const [dx, dy, dz] of OFFSETS) {
    if (absorbed >= max) break;
    const bx = x + dx;
    const by = y + dy;
    const bz = z + dz;
    // 水源与流动水一起吸（原版也是）；岩浆不吸
    if (world.getBlock(bx, by, bz) !== Block.WATER) continue;
    if (!world.setBlock(bx, by, bz, Block.AIR, 0)) continue;
    absorbed++;
  }
  return absorbed;
}
