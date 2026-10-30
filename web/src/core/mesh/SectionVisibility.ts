/**
 * 区段连通图（批次 20261030-2316，区段遮挡剔除的数据侧）。
 *
 * 对一个 16³ section，算出"从哪一面进来、能从哪一面出去"：对所有非不透明格做洪泛，
 * 每个连通块碰到的面两两连通。结果是 15 位掩码（6 个面的 15 个无序对）。
 * 不透明判定与面剔除用的同一个 `blockDef(id).opaque`——两边不一致就会漏画。
 *
 * 面编号：0 -X、1 +X、2 -Y、3 +Y、4 -Z、5 +Z；`f ^ 1` 是对面。
 */

import { blockDef } from '../registry/blocks.ts';
import { WORLD_MIN_Y, type Chunk } from '../world/Chunk.ts';

/** 六个面全部两两连通（空 section / 不透明格太少时直接给它） */
export const VISIBILITY_ALL = 0x7fff;

/** `PAIR_BIT[a * 6 + b]`：面 a 与面 b 连通对应的位（a === b 时为 0） */
export const PAIR_BIT: Uint16Array = (() => {
  const table = new Uint16Array(36);
  let bit = 0;
  for (let a = 0; a < 6; a++) {
    for (let b = a + 1; b < 6; b++) {
      table[a * 6 + b] = 1 << bit;
      table[b * 6 + a] = 1 << bit;
      bit++;
    }
  }
  return table;
})();

const solid = new Uint8Array(4096);
const stack = new Int16Array(4096);

export function computeSectionVisibility(chunk: Chunk, section: number): number {
  if (chunk.sectionIsEmpty(section)) return VISIBILITY_ALL;
  const baseY = WORLD_MIN_Y + section * 16;
  let count = 0;
  for (let y = 0, i = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++, i++) {
        const id = chunk.get(x, baseY + y, z);
        const opaque = id !== 0 && blockDef(id).opaque ? 1 : 0;
        solid[i] = opaque;
        count += opaque;
      }
    }
  }
  // 不到一整层，堵不住任何一个截面
  if (count < 256) return VISIBILITY_ALL;
  if (count === 4096) return 0;

  let mask = 0;
  for (let start = 0; start < 4096; start++) {
    if (solid[start]) continue;
    solid[start] = 1;
    let top = 0;
    stack[top++] = start;
    let faces = 0;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i & 15;
      const z = (i >> 4) & 15;
      const y = i >> 8;
      if (x === 0) faces |= 1;
      else if (!solid[i - 1]) { solid[i - 1] = 1; stack[top++] = i - 1; }
      if (x === 15) faces |= 2;
      else if (!solid[i + 1]) { solid[i + 1] = 1; stack[top++] = i + 1; }
      if (y === 0) faces |= 4;
      else if (!solid[i - 256]) { solid[i - 256] = 1; stack[top++] = i - 256; }
      if (y === 15) faces |= 8;
      else if (!solid[i + 256]) { solid[i + 256] = 1; stack[top++] = i + 256; }
      if (z === 0) faces |= 16;
      else if (!solid[i - 16]) { solid[i - 16] = 1; stack[top++] = i - 16; }
      if (z === 15) faces |= 32;
      else if (!solid[i + 16]) { solid[i + 16] = 1; stack[top++] = i + 16; }
    }
    for (let a = 0; a < 6; a++) {
      if (!(faces & (1 << a))) continue;
      for (let b = a + 1; b < 6; b++) if (faces & (1 << b)) mask |= PAIR_BIT[a * 6 + b]!;
    }
    if (mask === VISIBILITY_ALL) return mask;
  }
  return mask;
}
