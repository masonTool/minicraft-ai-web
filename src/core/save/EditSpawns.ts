/**
 * 从"区块增量"里挑出需要**立刻建容器实体**的方块（联机33）。
 *
 * 背景：远端方块改动有两种落地方式——区块已加载就当场写（顺带 `ensureBlockEntityAt`），
 * 没加载就只记增量、等区块生成时由 `ChunkEdits.applyTo` 叠上去。后一条路上**没有人**
 * 建容器实体：漏斗/投掷器/发射器只有方块、没有容器表项，表现是"看着是漏斗，就是不搬东西"。
 *
 * 为什么不用"扫整块方块找漏斗"：一个区块 384 层 × 256 格，扫一遍是几万次读；而增量表里
 * 只有**被改过的**那几十格——从增量里挑是常数级的。
 *
 * 纯逻辑，`tests/net-container-spawn.test.ts` 直接断言。
 */

import { Chunk } from '../world/Chunk.ts';
import { packEditId, type SerializedEdits } from './ChunkEdits.ts';

export interface BlockSpawn {
  x: number;
  y: number;
  z: number;
  id: number;
}

/**
 * 挑出这个区块增量里、`isContainer` 认得的方块，换算成世界坐标。
 *
 * @param cx 区块 x（可为负）
 * @param cz 区块 z（可为负）
 * @param data `ChunkEdits.serialize()` 的结果
 * @param isContainer 方块 id → 要不要建容器（漏斗/投掷器/发射器/潜影盒这些"自己会动"的）
 */
export function collectContainerSpawns(
  cx: number,
  cz: number,
  data: SerializedEdits,
  isContainer: (id: number) => boolean,
): BlockSpawn[] {
  const out: BlockSpawn[] = [];
  for (let i = 0; i < data.indices.length; i++) {
    const id = packEditId(data.packed[i]!);
    if (!isContainer(id)) continue;
    // 反解用 `Chunk.coordsAt`：与 `Chunk.index` 是同一处实现的逆运算，不会两处走偏
    const local = Chunk.coordsAt(data.indices[i]!);
    out.push({ x: cx * 16 + local.x, y: local.y, z: cz * 16 + local.z, id });
  }
  return out;
}
