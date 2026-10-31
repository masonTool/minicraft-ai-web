/**
 * 区块内容速查（批次 20261031-0930）：一趟线性扫描回答"这一列里有没有某几类方块"。
 *
 * 为什么要有它：区块一加载，主线程要依次跑五趟"全高度找东西"——
 * 战利品箱、避雷针、刷怪笼、信标、村庄的床。每一趟都是 16×16×384 ≈ 10 万格，
 * 其中刷怪笼和床那两趟还是"三重循环 + 每格一次函数调用（`Array.find` / `world.getBlock`）"。
 * 真机（Pixel 2 XL）飞行前进时，这几趟在 Worker 消息回调里一次吃掉 20~50ms，
 * 恰好落在两帧之间——帧率是满的，画面却在每跨过一个区块边界时顿一下。
 *
 * 而绝大多数区块里**一样都没有**。所以先花一趟（按 section 跳过空段、查表）问清楚
 * "有哪几类"，没有的那几趟整个跳过；有的照旧跑原来的扫描——**结果与原来逐字节一致**。
 */
import { Chunk, SECTION_COUNT } from './Chunk.ts';

/** 一个 section 的格子数（16×16×16），也是扁平数组里相邻两个 section 的下标间距 */
const SECTION_VOLUME = 16 * 16 * 16;

export const CONTAINS_CHEST = 1;
export const CONTAINS_LIGHTNING_ROD = 2;
export const CONTAINS_SPAWNER = 4;
export const CONTAINS_BEACON = 8;
export const CONTAINS_BED = 16;

/**
 * 建一张"方块 id → 类别位"的表（下标覆盖 `Uint16Array` 的全部取值，查表不用判越界）。
 * @param entries 每类一个判定函数；同一个 id 可以同时属于多类
 */
export function buildContentTable(entries: ReadonlyArray<readonly [flag: number, test: (id: number) => boolean]>): Uint8Array {
  const table = new Uint8Array(0x10000);
  for (let id = 0; id < table.length; id++) {
    let flags = 0;
    for (const [flag, test] of entries) if (test(id)) flags |= flag;
    table[id] = flags;
  }
  return table;
}

/**
 * 这一列里出现了哪几类方块（返回类别位的并集）。
 * 空 section 整段跳过；`all`（表里全部类别位）都找到了就提前返回。
 */
export function chunkContents(chunk: Chunk, table: Uint8Array, all: number): number {
  const blocks = chunk.blocks;
  let found = 0;
  for (let section = 0; section < SECTION_COUNT; section++) {
    if (chunk.sectionIsEmpty(section)) continue;
    const from = section * SECTION_VOLUME;
    const to = Math.min(blocks.length, from + SECTION_VOLUME);
    for (let i = from; i < to; i++) {
      const flags = table[blocks[i]!]!;
      if (flags === 0) continue;
      found |= flags;
      if (found === all) return found;
    }
  }
  return found;
}
