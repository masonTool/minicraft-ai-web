/**
 * 把一个区块的增量快照转成联机用的 `blocks` 条目（用户 2026-10-26 懒上行）。
 *
 * 服务端不再自己存世界，队友走进"没被确认过"的区块时它会回头问房主：
 * "这一块你改过什么？" 房主从本地 `world.edits`（区块增量表）取那一块的快照回过去。
 *
 * 为什么不做成"逐格读世界"：一块是 16×384×16 ≈ 9.8 万格，逐格读要把整块加载起来；
 * 而增量表里只有玩家真正动过的那几十/几百格——这也正是"零带宽区块同步"的前提
 * （地形由种子重现，联机只传差异）。
 *
 * 抽成纯函数是为了能离线断言：`tests/net-chunk-snapshot.test.ts` 直接喂一份
 * 增量快照，检查解出来的坐标/方块 id/状态与写进去的那几格逐条相等。
 */

import { packEditId, packEditState, type SerializedEdits } from '../save/ChunkEdits.ts';
import { Chunk } from '../world/Chunk.ts';

/** 线上一条 `blocks` 条目：`[x, y, z, id, state, dimension]`（与协议逐项对齐） */
export type ChunkSnapshotEntry = [number, number, number, number, number, string];

/**
 * @param data 某个区块的增量快照（`ChunkEdits.serialize()` 的返回值；没有改动时是 null）
 * @param dimension 这一块的维度名（协议里每个条目都带，接收端据此判"是不是我这一界"）
 * @param cx 区块坐标（`x >> 4`）
 * @param cz 区块坐标（`z >> 4`）
 * @returns 线上格式的条目：`[x, y, z, id, state, dimension]`（与 `blocks` 消息完全一致）
 *
 * ⚠️ `Chunk.coordsAt()` 解出来的是**区块内**的 x/z（0..15）和**世界坐标**的 y：
 * y 在 `Chunk.index` 里就已经乘过 `WORLD_MIN_Y` 了，而 x/z 是局部的，必须自己加
 * `cx * 16` / `cz * 16`。漏加这一步的表现是"所有补发的方块都堆在区块西北角"，
 * 而且只在远处（cx/cz ≠ 0）才看得出来——原点附近的房间会一切正常。
 */
export function chunkSnapshotBlocks(
  data: SerializedEdits | null,
  dimension: string,
  cx: number,
  cz: number,
): ChunkSnapshotEntry[] {
  if (!data) return [];
  const out: ChunkSnapshotEntry[] = [];
  for (let i = 0; i < data.indices.length; i++) {
    const index = data.indices[i];
    const packed = data.packed[i];
    if (index === undefined || packed === undefined) continue;
    // 反解走 `Chunk.coordsAt`：与 `Chunk.index` 是同一处实现的逆运算，不会两处走偏
    const local = Chunk.coordsAt(index);
    out.push([
      cx * 16 + local.x,
      local.y,
      cz * 16 + local.z,
      packEditId(packed),
      packEditState(packed),
      dimension,
    ]);
  }
  return out;
}
