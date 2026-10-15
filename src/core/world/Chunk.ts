/**
 * 区块存储
 *
 * 1.18 世界高度范围为 Y ∈ [-64, 320)，共 384 格，水平方向 16×16。
 * 方块的索引顺序为 y → z → x，保证同层相邻方块内存连续，网格化时缓存友好。
 *
 * ⚠️ 方块 id 数组必须是 **16 位**（Uint16Array），不能用 Uint8Array。
 * 方块种类已经超过 255（末地 246~255、红石 256~270），8 位存储会**静默溢出**：
 * id 256 变成 0（空气）、266 变成 10（水）——不报错、不越界，只是世界里出现了别的方块，
 * 排查成本极高（实测踩过：放红石粉却读出空气）。代价是每区块 96KB → 192KB。
 */

import { createHeightmap, heightAt, onBlockChanged, type HeightmapKind } from './Heightmap.ts';

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;

export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 320;
export const WORLD_HEIGHT = WORLD_MAX_Y - WORLD_MIN_Y; // 384

/** 一个 section（网格化单位）的高度 */
export const SECTION_HEIGHT = 16;
export const SECTION_COUNT = WORLD_HEIGHT / SECTION_HEIGHT; // 24

const XZ = CHUNK_SIZE_X * CHUNK_SIZE_Z;
export const CHUNK_VOLUME = XZ * WORLD_HEIGHT;

/** 方块 id 数组的元素类型（16 位，见文件头的说明） */
export type BlockArray = Uint16Array;

/** 分配一个空的方块数组 */
export function createBlockArray(): BlockArray {
  return new Uint16Array(CHUNK_VOLUME);
}

export class Chunk {
  readonly blocks: BlockArray;
  /**
   * 光照数据：高 4 位为天光等级，低 4 位为方块光等级（各 0-15）。
   * 打包存储可让一次内存访问同时取到两种光照，网格化时缓存友好。
   */
  readonly light: Uint8Array;
  /**
   * 方块状态（朝向 / 上下半 / 开关等），按需分配。
   *
   * 只有真正放了带状态方块的区块才占这份内存——自然生成的地形里没有任何带状态的方块，
   * 因此绝大多数区块的这份开销是 0。这一点对内存很关键：
   * 一个区块的方块数组是 96KB，若每区块都无条件多带一份状态就是翻倍。
   */
  private states: Uint8Array | null = null;
  /**
   * 高度图（C6）：每种一张 `Uint16Array(256)`，**按需分配**（第一次查询时才建）。
   *
   * 与 `states` 同一个思路：自然生成的区块里绝大多数从不被"找地表"的代码碰到，
   * 那就一字节都不占。建表之后由 `Chunk.set` 维护，见 `Heightmap.ts`。
   */
  private worldSurface: Uint16Array | null = null;
  private motionBlocking: Uint16Array | null = null;
  /** 每个 section 的非空气方块计数，用于快速跳过空段 */
  readonly sectionCounts: Int32Array;
  /** 光照是否已初始化 */
  lit = false;
  /** 是否被修改过（P8 存档用） */
  dirty = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {
    this.blocks = createBlockArray();
    this.light = new Uint8Array(CHUNK_VOLUME);
    this.sectionCounts = new Int32Array(SECTION_COUNT);
  }

  // ---------------------------------------------------------------- 方块状态

  get hasStates(): boolean {
    return this.states !== null;
  }

  getState(x: number, y: number, z: number): number {
    if (!this.states) return 0;
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 0;
    return this.states[Chunk.index(x, y, z)]!;
  }

  setState(x: number, y: number, z: number, state: number): void {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    if (state === 0) {
      if (this.states) this.states[Chunk.index(x, y, z)] = 0;
      return;
    }
    if (!this.states) this.states = new Uint8Array(CHUNK_VOLUME);
    this.states[Chunk.index(x, y, z)] = state;
  }

  // ---------------------------------------------------------------- 光照读写

  getSkyLight(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return y >= WORLD_MAX_Y ? 15 : 0;
    return this.light[Chunk.index(x, y, z)]! >>> 4;
  }

  setSkyLight(x: number, y: number, z: number, value: number): void {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    const i = Chunk.index(x, y, z);
    this.light[i] = ((value & 15) << 4) | (this.light[i]! & 15);
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 0;
    return this.light[Chunk.index(x, y, z)]! & 15;
  }

  setBlockLight(x: number, y: number, z: number, value: number): void {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    const i = Chunk.index(x, y, z);
    this.light[i] = (this.light[i]! & 0xf0) | (value & 15);
  }

  static index(x: number, y: number, z: number): number {
    return ((y - WORLD_MIN_Y) * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
  }

  /**
   * index 的逆运算：由区块内下标反解出方块坐标。
   *
   * 放在这里而不是让调用方自己算：存档（K1）只存下标以省空间，
   * 读档时必须精确还原。反解与 index 摆在一起，改一处不会漏掉另一处。
   */
  static coordsAt(index: number): { x: number; y: number; z: number } {
    const y = Math.floor(index / (CHUNK_SIZE_Z * CHUNK_SIZE_X)) + WORLD_MIN_Y;
    const rest = index % (CHUNK_SIZE_Z * CHUNK_SIZE_X);
    return { x: rest % CHUNK_SIZE_X, y, z: Math.floor(rest / CHUNK_SIZE_X) };
  }

  /**
   * 用 Worker 生成的裸数组接管所有权（零拷贝），并重建分段计数。
   * @param counts 已有的分段计数（网格化 Worker 用，省掉一次全量扫描）
   */
  static fromData(cx: number, cz: number, blocks: BlockArray, counts?: Int32Array): Chunk {
    const chunk = new Chunk(cx, cz);
    chunk.blocks.set(blocks);
    if (counts) {
      chunk.sectionCounts.set(counts);
      return chunk;
    }
    for (let section = 0; section < SECTION_COUNT; section++) {
      const start = section * SECTION_HEIGHT * XZ;
      let count = 0;
      for (let i = start; i < start + SECTION_HEIGHT * XZ; i++) if (chunk.blocks[i] !== 0) count++;
      chunk.sectionCounts[section] = count;
    }
    return chunk;
  }

  /** 方块状态数组的副本（网格化 Worker 需要；没有状态时返回 null） */
  copyStates(): Uint8Array | null {
    return this.states ? this.states.slice() : null;
  }

  /** 整体接管一份状态数组（网格化 Worker 还原请求数据用） */
  restoreStates(data: Uint8Array): void {
    this.states = data.slice();
  }

  /** 零拷贝接管状态数组（生成 Worker 回传的状态；调用方之后不得再使用该数组） */
  adoptStates(data: Uint8Array): void {
    // 全是 0 时不必占内存：绝大多数区块没有带状态的方块
    let any = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0) {
        any = true;
        break;
      }
    }
    this.states = any ? data : null;
  }

  get(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 0;
    return this.blocks[Chunk.index(x, y, z)]!;
  }

  set(x: number, y: number, z: number, id: number, state = 0): void {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    const i = Chunk.index(x, y, z);
    const prev = this.blocks[i]!;
    if (prev === id) {
      // 同种方块也要更新状态（例如把台阶从下半翻到上半）
      if (state !== 0 || this.states) this.setState(x, y, z, state);
      return;
    }
    this.blocks[i] = id;
    // 换方块时旧状态一律作废
    if (this.states) this.states[i] = 0;
    if (state !== 0) this.setState(x, y, z, state);
    const section = (y - WORLD_MIN_Y) >> 4;
    if (prev === 0 && id !== 0) this.sectionCounts[section]!++;
    else if (prev !== 0 && id === 0) this.sectionCounts[section]!--;
    this.dirty = true;

    // 高度图（C6）：只维护"已经建过表"的列，没建过的等第一次查询再算。
    // 两个 if 都是廉价的空判断（`null` + 一次比较），而这里是生成期最热的写路径
    if (this.worldSurface) onBlockChanged(this.worldSurface, this, x, z, y, id, 'world_surface');
    if (this.motionBlocking) onBlockChanged(this.motionBlocking, this, x, z, y, id, 'motion_blocking');
  }

  /**
   * 某一列的高度（C6）：返回"存进去的值"（见 `Heightmap.ts`），
   * 第一次查询当场建表，之后 O(1)。
   */
  getSurfaceHeight(kind: HeightmapKind, x: number, z: number): number {
    const map = this.heightmap(kind);
    return heightAt(map, this, x, z, kind);
  }

  /** 这张高度图建过表没有（调试与断言用） */
  hasHeightmap(kind: HeightmapKind): boolean {
    return (kind === 'world_surface' ? this.worldSurface : this.motionBlocking) !== null;
  }

  private heightmap(kind: HeightmapKind): Uint16Array {
    if (kind === 'world_surface') {
      this.worldSurface ??= createHeightmap();
      return this.worldSurface;
    }
    this.motionBlocking ??= createHeightmap();
    return this.motionBlocking;
  }

  sectionIsEmpty(section: number): boolean {
    return this.sectionCounts[section] === 0;
  }

  /** 该 section 在网格化时使用的底面 Y 坐标 */
  static sectionMinY(section: number): number {
    return WORLD_MIN_Y + section * SECTION_HEIGHT;
  }

  /** 世界坐标 → 所在 section 序号 */
  static sectionOf(y: number): number {
    return (y - WORLD_MIN_Y) >> 4;
  }
}
