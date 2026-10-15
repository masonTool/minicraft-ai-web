/**
 * 区块的"玩家修改"增量记录（K1 存档的基础）
 *
 * 为什么不整块存：一个区块的方块数据是 16×384×16 × 2 字节 = 192KB，
 * 一片视距就是几百个区块（几十 MB），每 30 秒全量写一遍显然不可行。
 * 而世界里真正被玩家改过的方块，一个存档周期里通常只有几十到几百个——
 * 因此这里只记录"玩家动过的格子"，存档时写这些增量，读档时在地形生成之后叠加回去。
 *
 * 这就是原版"区块增量保存"的思路：**地形由种子 + 算法重现，存档只存差异**。
 * 副作用是存档很小（一次玩法通常几十 KB），代价是读档需要重新生成一遍地形
 * （生成是纯函数，同种子同区块必然得到同样的结果，所以叠加是安全的）。
 *
 * 该模块不依赖 DOM 与 IndexedDB，可以直接离线测试。
 */

import { Chunk } from '../world/Chunk.ts';

/** 一个格子打包后的值：高 16 位方块 id、低 8 位状态 */
const PACK_STATE_MASK = 0xff;

export function packEdit(id: number, state: number): number {
  return (id << 8) | (state & PACK_STATE_MASK);
}

export function packEditId(packed: number): number {
  return packed >>> 8;
}

export function packEditState(packed: number): number {
  return packed & PACK_STATE_MASK;
}

/** 区块的键：维度 + 区块坐标（不同维度的同坐标区块是两份数据） */
export function chunkEditKey(dimension: string, cx: number, cz: number): string {
  return `${dimension}|${cx},${cz}`;
}

/** 序列化后的区块增量（可直接塞进 IndexedDB） */
export interface SerializedEdits {
  /** 区块内下标（`Chunk.index` 的取值） */
  indices: Uint32Array;
  /** 打包后的 id + 状态 */
  packed: Uint32Array;
}

export class ChunkEdits {
  /** key → (区块内下标 → 打包值) */
  private readonly byChunk = new Map<string, Map<number, number>>();
  /** 自上次保存以来被改动过的区块键 */
  private readonly dirty = new Set<string>();

  /** 记录一次修改 */
  record(dimension: string, cx: number, cz: number, localIndex: number, id: number, state: number): void {
    const key = chunkEditKey(dimension, cx, cz);
    let map = this.byChunk.get(key);
    if (!map) {
      map = new Map();
      this.byChunk.set(key, map);
    }
    map.set(localIndex, packEdit(id, state));
    this.dirty.add(key);
  }

  /** 把某个区块的修改叠加回它（区块刚生成完时调用） */
  applyTo(dimension: string, cx: number, cz: number, chunk: Chunk): number {
    const map = this.byChunk.get(chunkEditKey(dimension, cx, cz));
    if (!map) return 0;

    let applied = 0;
    for (const [index, packed] of map) {
      // 反解用 Chunk.coordsAt：与 Chunk.index 是同一处实现的逆运算，不会两处走偏
      const { x, y, z } = Chunk.coordsAt(index);
      chunk.set(x, y, z, packEditId(packed), packEditState(packed));
      applied++;
    }
    return applied;
  }

  /** 该区块有没有玩家修改 */
  has(dimension: string, cx: number, cz: number): boolean {
    return this.byChunk.has(chunkEditKey(dimension, cx, cz));
  }

  /** 某个区块的修改条数（调试用） */
  count(dimension: string, cx: number, cz: number): number {
    return this.byChunk.get(chunkEditKey(dimension, cx, cz))?.size ?? 0;
  }

  /** 总共记录了多少个格子的修改 */
  get totalEdits(): number {
    let total = 0;
    for (const map of this.byChunk.values()) total += map.size;
    return total;
  }

  /** 有多少区块被改过 */
  get chunkCount(): number {
    return this.byChunk.size;
  }

  /** 序列化某个区块的修改（没有则返回 null） */
  serialize(dimension: string, cx: number, cz: number): SerializedEdits | null {
    const map = this.byChunk.get(chunkEditKey(dimension, cx, cz));
    if (!map || map.size === 0) return null;
    const indices = new Uint32Array(map.size);
    const packed = new Uint32Array(map.size);
    let i = 0;
    for (const [index, value] of map) {
      indices[i] = index;
      packed[i] = value;
      i++;
    }
    return { indices, packed };
  }

  /** 反序列化（读档时调用）：把存档里的增量装回记录表 */
  restore(dimension: string, cx: number, cz: number, data: SerializedEdits): void {
    const key = chunkEditKey(dimension, cx, cz);
    let map = this.byChunk.get(key);
    if (!map) {
      map = new Map();
      this.byChunk.set(key, map);
    }
    for (let i = 0; i < data.indices.length; i++) {
      map.set(data.indices[i]!, data.packed[i]!);
    }
  }

  /** 自上次保存以来被改动过的区块键（保存后调用 markSaved 清空） */
  dirtyKeys(): string[] {
    return [...this.dirty];
  }

  markSaved(): void {
    this.dirty.clear();
  }

  /** 清空全部（"删除存档"用） */
  clear(): void {
    this.byChunk.clear();
    this.dirty.clear();
  }

  /** 拆开区块键（保存时需要拆出坐标） */
  static parseKey(key: string): { dimension: string; cx: number; cz: number } {
    const [dimension, coords] = key.split('|') as [string, string];
    const [cx, cz] = coords.split(',').map(Number) as [number, number];
    return { dimension, cx, cz };
  }
}
