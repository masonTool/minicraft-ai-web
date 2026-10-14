/**
 * 区块存储
 *
 * 1.18 世界高度范围为 Y ∈ [-64, 320)，共 384 格，水平方向 16×16。
 * 存储采用单块 Uint8Array（方块 id），索引顺序为 y → z → x，保证同层相邻方块内存连续，
 * 网格化时缓存友好。
 */

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

export class Chunk {
  readonly blocks: Uint8Array;
  /** 每个 section 的非空气方块计数，用于快速跳过空段 */
  readonly sectionCounts: Int32Array;
  /** 是否被修改过（P8 存档用） */
  dirty = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
  ) {
    this.blocks = new Uint8Array(CHUNK_VOLUME);
    this.sectionCounts = new Int32Array(SECTION_COUNT);
  }

  static index(x: number, y: number, z: number): number {
    return ((y - WORLD_MIN_Y) * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
  }

  get(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 0;
    return this.blocks[Chunk.index(x, y, z)]!;
  }

  set(x: number, y: number, z: number, id: number): void {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    const i = Chunk.index(x, y, z);
    const prev = this.blocks[i]!;
    if (prev === id) return;
    this.blocks[i] = id;
    const section = (y - WORLD_MIN_Y) >> 4;
    if (prev === 0 && id !== 0) this.sectionCounts[section]!++;
    else if (prev !== 0 && id === 0) this.sectionCounts[section]!--;
    this.dirty = true;
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
