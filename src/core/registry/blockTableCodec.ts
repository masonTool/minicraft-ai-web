/**
 * 方块表二进制编解码（批次 20261025-0329）
 *
 * 为什么要有这份东西：方块表是**核心且恒定**的那部分数据（200+ 条、五千多行），
 * 它占着主包里一大块可读明文，而复制者真正想要的就是这张表。把它从 JS 里拿出来
 * 编码成一个**独立文件**之后，"文件放哪"就决定了形态：
 *
 *   · 放进 APK（宿主经 `shouldInterceptRequest` 读出来）→ 线上 bundle 缺这张表，
 *     浏览器打不开游戏，只能去装 App；
 *   · 放进静态服务器 → 完整前端方案，浏览器照常玩（预览 / 兜底）。
 *
 * 两条路走的是**同一条代码路径**（同一个 URL、同一个解码器），编译期没有分叉，
 * 所以测试测到的就是线上真正跑的那条路。
 *
 * ⚠️ 这不是密码学意义上的加密：文件在 APK 里，`unzip` 就能拿到。它买到的是
 * "复制者必须同时拿到 APK 里的**数据**和线上混淆过的**解码器**，缺一个都没用"，
 * 以及顺手把主包里那几千行明文常量省下来（体积是净减少，不影响首屏）。
 *
 * ---------------------------------------------------------------------------
 * 格式 v1（小端；所有多字节整数都是 DataView 默认的小端）
 *
 *   [0..4)    'M','C','T','B'      魔数
 *   [4]       u8  version          = 1（App 与线上版本不匹配时用来拒绝加载）
 *   [5]       u8  reserved         = 0
 *   [6..8)    u16 blockCount
 *   [8..12)   u32 stringCount
 *   [12..16)  u32 crc32            头部之后所有字节的 CRC32
 *   ...       stringCount 段：u16 byteLen + UTF-8 字节
 *   ...       blockCount 条，每条 14 字节：
 *               u16 nameIdx
 *               u16 tileTop / tileBottom / tileSide
 *               u16 flags               （位序见下面 FLAG_* 常量）
 *               u8  packedLight         （高 4 位 light、低 4 位 lightOpacity）
 *               u16 shapeIdx            （指向字符串表）
 *
 * id **不存**：`buildBlockTable()` 已经强制 id 从 0 连续（有空缺就抛），
 * 所以"第几条"就是 id，存了纯属冗余。
 *
 * 函数字段（`stateTiles` / `faceTile` / `stateLight`）**不进文件**：
 * 二进制里放不下闭包，它们留在代码里按 id 合并（后续那一步的 `BLOCK_BEHAVIORS`）。
 * ---------------------------------------------------------------------------
 */

import type { BlockDef } from './blocks.ts';
import type { BlockShape } from './blockState.ts';

/** 魔数（'MCTB'）：读错文件时第一道拦截 */
export const BLOCK_TABLE_MAGIC = [0x4d, 0x43, 0x54, 0x42] as const;

/**
 * 格式版本。
 *
 * ⚠️ 加字段 / 改位序都必须 +1，并且**不能**让新解码器去猜旧文件：
 * 宿主里的文件是随 APK 走的，更新慢；线上 bundle 换得快。版本号对不上要
 * 走 T5 的"请更新应用"，而不是硬解出半张表（那会变成静默错方块）。
 */
export const BLOCK_TABLE_VERSION = 1;

/** 头部长度：魔数 4 + 版本 1 + 保留 1 + count 2 + stringCount 4 + crc32 4 */
const HEADER_SIZE = 16;

/** crc32 字段在头部的偏移（改头部布局时与 `HEADER_SIZE` 一起改，两处别只动一处） */
const CRC_OFFSET = 12;

/**
 * 头部之后的载荷 CRC32。
 *
 * 为什么需要它：长度对、魔数对、但内容被改坏的文件（截断后被补零、传输损坏、
 * 有人拿十六进制编辑器手改一个字节）**照样能解码**，解出来是一张"贴图空、形状错"的
 * 垃圾表——游戏不会崩，会静默变成一片空白方块。这种失败比直接报错贵得多。
 * 4 个字节换"宁可启动失败"，值得。
 *
 * 注意：它是**完整性**校验，不是防篡改——谁都能重算一遍。防篡改要靠报文签名（P1）。
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 每条方块定长部分（不含字符串表） */
const BLOCK_SIZE = 14;

/** 标志位编号。**加一位就要动 `BLOCK_TABLE_VERSION`** */
const FLAG_SOLID = 1 << 0;
const FLAG_OPAQUE = 1 << 1;
const FLAG_SUFFOCATES = 1 << 2;
const FLAG_LIQUID = 1 << 3;
const FLAG_TRANSLUCENT = 1 << 4;
const FLAG_FACES_PLAYER = 1 << 5;
const FLAG_FACES_SNEAK = 1 << 6;
const FLAG_FACES_NORMAL = 1 << 7;
const FLAG_ITEMLESS = 1 << 8;
const FLAG_WATER_PLANT = 1 << 9;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function flagOf(block: BlockDef): number {
  let flags = 0;
  if (block.solid) flags |= FLAG_SOLID;
  if (block.opaque) flags |= FLAG_OPAQUE;
  if (block.suffocates) flags |= FLAG_SUFFOCATES;
  if (block.liquid) flags |= FLAG_LIQUID;
  if (block.translucent) flags |= FLAG_TRANSLUCENT;
  if (block.facesPlayer === true) flags |= FLAG_FACES_PLAYER;
  if (block.facesSneak === true) flags |= FLAG_FACES_SNEAK;
  if (block.facesNormal === true) flags |= FLAG_FACES_NORMAL;
  if (block.itemless) flags |= FLAG_ITEMLESS;
  if (block.waterPlant) flags |= FLAG_WATER_PLANT;
  return flags;
}

/**
 * 把方块表编码成 v1 二进制。
 *
 * 输入必须是**已经归一化**的 `BlockDef[]`（`buildBlockTable()` 的产物），
 * 而不是 `BlockSpec`——`BlockSpec` 里大量字段是可选的，默认值规则散在
 * `buildBlockTable()` 里；在这里再实现一遍默认值，两边迟早漂。
 */
export function encodeBlockTable(blocks: readonly BlockDef[]): Uint8Array {
  if (blocks.length > 0xffff) throw new Error(`方块数量超出 u16：${blocks.length}`);

  // ---- 第一遍：建字符串表（去重）+ 校验 id 连续
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const intern = (value: string): number => {
    const hit = stringIndex.get(value);
    if (hit !== undefined) return hit;
    const index = strings.length;
    if (index > 0xffff) throw new Error('字符串表超出 u16');
    stringIndex.set(value, index);
    strings.push(value);
    return index;
  };

  const encodedStrings: Uint8Array[] = [];
  for (let id = 0; id < blocks.length; id++) {
    const block = blocks[id]!;
    if (block.id !== id) {
      throw new Error(`方块 id 必须从 0 连续：第 ${id} 项的 id=${block.id}（${block.name}）`);
    }
    intern(block.name);
    intern(block.tiles[0]);
    intern(block.tiles[1]);
    intern(block.tiles[2]);
    intern(block.shape);
  }
  for (const value of strings) {
    const bytes = encoder.encode(value);
    if (bytes.length > 0xffff) throw new Error(`字符串过长（${bytes.length} 字节）：${value.slice(0, 40)}…`);
    encodedStrings.push(bytes);
  }

  // ---- 第二遍：按精确长度分配（不做动态扩容，产物长度可预测）
  let size = HEADER_SIZE;
  for (const bytes of encodedStrings) size += 2 + bytes.length;
  size += blocks.length * BLOCK_SIZE;

  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);
  let offset = 0;

  for (const byte of BLOCK_TABLE_MAGIC) out[offset++] = byte;
  view.setUint8(offset, BLOCK_TABLE_VERSION);
  offset += 1;
  view.setUint8(offset, 0);
  offset += 1;
  view.setUint16(offset, blocks.length, true);
  offset += 2;
  view.setUint32(offset, strings.length, true);
  offset += 4;
  // 校验和占位：载荷写完再回填（`+ 4` 与 `HEADER_SIZE` 对应，别只改一处）
  view.setUint32(offset, 0, true);
  offset += 4;

  for (const bytes of encodedStrings) {
    view.setUint16(offset, bytes.length, true);
    offset += 2;
    out.set(bytes, offset);
    offset += bytes.length;
  }

  for (const block of blocks) {
    // 光照两个字段各占 4 位：超了会被静默截断（16 → 0），那种错只在"这块怎么不亮"时才被发现
    if (block.light < 0 || block.light > 15 || block.lightOpacity < 0 || block.lightOpacity > 15) {
      throw new Error(`光照等级超出 4 位范围：${block.name} light=${block.light} opacity=${block.lightOpacity}`);
    }
    view.setUint16(offset, stringIndex.get(block.name)!, true);
    offset += 2;
    view.setUint16(offset, stringIndex.get(block.tiles[0])!, true);
    offset += 2;
    view.setUint16(offset, stringIndex.get(block.tiles[1])!, true);
    offset += 2;
    view.setUint16(offset, stringIndex.get(block.tiles[2])!, true);
    offset += 2;
    view.setUint16(offset, flagOf(block), true);
    offset += 2;
    view.setUint8(offset, (block.light << 4) | block.lightOpacity);
    offset += 1;
    view.setUint16(offset, stringIndex.get(block.shape)!, true);
    offset += 2;
  }

  view.setUint32(CRC_OFFSET, crc32(out, HEADER_SIZE), true);
  return out;
}

/**
 * 解码 v1 二进制。
 *
 * 返回的定义**只含数据字段**：`stateTiles` / `faceTile` / `stateLight` 一律 undefined，
 * 由 `BLOCK_BEHAVIORS` 按 id 合回去。这样"数据"和"行为"在类型上就分得开，
 * 不会出现"某块的特殊贴图忘了搬"这种半搬状态（那种会静默渲染错面）。
 *
 * 任何越界 / 魔数不对 / 版本不对都**直接抛**：宁可启动失败，也不要拿半张表去生成地形。
 */
export function decodeBlockTable(source: Uint8Array | ArrayBuffer): readonly BlockDef[] {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < HEADER_SIZE) {
    throw new Error(`方块表过短：${bytes.length} 字节（头部就要 ${HEADER_SIZE} 字节）`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < BLOCK_TABLE_MAGIC.length; i++) {
    if (bytes[i] !== BLOCK_TABLE_MAGIC[i]) throw new Error('不是方块表文件（魔数不匹配）');
  }
  const version = view.getUint8(4);
  if (version !== BLOCK_TABLE_VERSION) {
    throw new Error(`方块表版本不支持：文件 v${version}，解码器 v${BLOCK_TABLE_VERSION}`);
  }

  const expectedCrc = view.getUint32(CRC_OFFSET, true);
  const actualCrc = crc32(bytes, HEADER_SIZE);
  if (expectedCrc !== actualCrc) {
    throw new Error(
      `方块表校验和不匹配（文件 ${expectedCrc.toString(16)} / 实际 ${actualCrc.toString(16)}）：文件损坏或被改过`,
    );
  }

  // ⚠️ blockCount / stringCount 在**固定偏移**上，不要拿 `offset` 去读：
  // `offset` 从 HEADER_SIZE 开始是给后面的字符串表用的（踩过：用 offset 读会把
  // 第一段字符串的长度当成 blockCount，然后报"字符串表被截断"这种离谱错误）。
  const blockCount = view.getUint16(6, true);
  const stringCount = view.getUint32(8, true);
  let offset = HEADER_SIZE;

  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    if (offset + 2 > bytes.length) throw new Error(`字符串表被截断（第 ${i} 段）`);
    const length = view.getUint16(offset, true);
    offset += 2;
    if (offset + length > bytes.length) throw new Error(`字符串表被截断（第 ${i} 段内容）`);
    strings.push(decoder.decode(bytes.subarray(offset, offset + length)));
    offset += length;
  }

  if (offset + blockCount * BLOCK_SIZE > bytes.length) {
    throw new Error(`方块区被截断：需要 ${blockCount * BLOCK_SIZE} 字节，只剩 ${bytes.length - offset}`);
  }

  const str = (index: number): string => {
    const value = strings[index];
    if (value === undefined) throw new Error(`字符串下标越界：${index}（共 ${stringCount} 段）`);
    return value;
  };

  const table: BlockDef[] = [];
  for (let id = 0; id < blockCount; id++) {
    const name = str(view.getUint16(offset, true));
    offset += 2;
    const top = str(view.getUint16(offset, true));
    offset += 2;
    const bottom = str(view.getUint16(offset, true));
    offset += 2;
    const side = str(view.getUint16(offset, true));
    offset += 2;
    const flags = view.getUint16(offset, true);
    offset += 2;
    const packed = view.getUint8(offset);
    offset += 1;
    const shape = str(view.getUint16(offset, true)) as BlockShape;
    offset += 2;

    table.push({
      id,
      name,
      tiles: [top, bottom, side] as const,
      solid: (flags & FLAG_SOLID) !== 0,
      opaque: (flags & FLAG_OPAQUE) !== 0,
      suffocates: (flags & FLAG_SUFFOCATES) !== 0,
      light: (packed >> 4) & 0x0f,
      lightOpacity: packed & 0x0f,
      liquid: (flags & FLAG_LIQUID) !== 0,
      translucent: (flags & FLAG_TRANSLUCENT) !== 0,
      shape,
      facesPlayer: (flags & FLAG_FACES_PLAYER) !== 0,
      facesSneak: (flags & FLAG_FACES_SNEAK) !== 0,
      facesNormal: (flags & FLAG_FACES_NORMAL) !== 0,
      itemless: (flags & FLAG_ITEMLESS) !== 0,
      waterPlant: (flags & FLAG_WATER_PLANT) !== 0,
    });
  }
  return table;
}
