/**
 * 地图（批次 196，H16 的"地图数据"那一项）
 *
 * 数据模型与"探索"的粒度是本批最要紧的两个决定：
 *
 *  1. **一个格子 = 一个 16×16 的区块**，整张图 **32×32 格**（覆盖 512×512 格方块）。
 *     原版是按**方块像素**记的（128×128），存下来是 2KB 的位图；
 *     这里用区块粒度，位图只有 **128 字节**——base64 之后 172 个字符，
 *     放进物品附加数据、每次存档写一遍都不心疼。代价是"地图上一格 = 一大片"，
 *     对"我在哪、哪片去过"这个用途够用（本项目的视距也就 8~12 个区块）。
 *  2. **中心不随玩家移动**：第一次用空地图时把中心钉在当前所在格，之后一直以它为准。
 *     原版也是"地图一张对应一片区域"，走太远只会出界，不会自己拉远。
 *
 * 位图的位序：**行优先**（先 z 后 x），下标 `(dz + 16) * 32 + (dx + 16)`；
 * base64 是为了能直接塞进 `ItemStack` 的普通对象里（存档那边只认 JSON 形状）。
 */

/** 地图一格覆盖多少方块（= 一个区块的边长） */
export const MAP_CHUNK_SPAN = 16;
/** 地图有多少格（32×32） */
export const MAP_GRID = 32;
/** 中心到边缘有多少格 */
export const MAP_HALF = MAP_GRID / 2;
/** 整张图覆盖多少格方块（512） */
export const MAP_COVER_BLOCKS = MAP_GRID * MAP_CHUNK_SPAN;
/** 位图字节数（32×32 / 8） */
export const MAP_BIT_BYTES = (MAP_GRID * MAP_GRID) / 8;

export interface MapData {
  /** 地图中心（世界坐标，取整到方块） */
  originX: number;
  originZ: number;
  /** 已探索位图（base64，128 字节） */
  bits: string;
}

/** 新建一张空地图，中心钉在 (x, z) 所在的那一格（向下取整） */
export function emptyMapData(x: number, z: number): MapData {
  return {
    originX: Math.floor(Number.isFinite(x) ? x : 0),
    originZ: Math.floor(Number.isFinite(z) ? z : 0),
    bits: encodeBits(new Uint8Array(MAP_BIT_BYTES)),
  };
}

/** 世界坐标 → 地图格下标；出界返回 -1 */
export function mapCellIndex(data: MapData, x: number, z: number): number {
  const cx = Math.floor((x - data.originX) / MAP_CHUNK_SPAN) + MAP_HALF;
  const cz = Math.floor((z - data.originZ) / MAP_CHUNK_SPAN) + MAP_HALF;
  if (cx < 0 || cx >= MAP_GRID || cz < 0 || cz >= MAP_GRID) return -1;
  return cz * MAP_GRID + cx;
}

/** 这一格方块在地图上探索过没有 */
export function isExplored(data: MapData, x: number, z: number): boolean {
  const index = mapCellIndex(data, x, z);
  if (index < 0) return false;
  const bytes = decodeBits(data.bits);
  const byte = bytes[index >> 3] ?? 0;
  return (byte & (1 << (index & 7))) !== 0;
}

/**
 * 把"玩家走到了 (x, z)"记进地图。
 *
 * @returns 新的地图数据；**已经记过 / 出界**时返回 null（调用方据此跳过写回）
 */
export function markExplored(data: MapData, x: number, z: number): MapData | null {
  const index = mapCellIndex(data, x, z);
  if (index < 0) return null;
  const bytes = decodeBits(data.bits);
  const mask = 1 << (index & 7);
  const before = bytes[index >> 3] ?? 0;
  if ((before & mask) !== 0) return null;
  bytes[index >> 3] = before | mask;
  return { ...data, bits: encodeBits(bytes) };
}

/** 已探索多少格（界面可以显示"探索度 12%"） */
export function exploredCount(data: MapData): number {
  const bytes = decodeBits(data.bits);
  let count = 0;
  for (const byte of bytes) {
    for (let bit = 0; bit < 8; bit++) if ((byte & (1 << bit)) !== 0) count++;
  }
  return count;
}

/**
 * 校验并规整一份地图数据（存档/合成两头共用）。
 * @returns 认不出来就返回 undefined（"没有这个字段"）
 */
export function sanitizeMap(raw: unknown): MapData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = raw as { originX?: unknown; originZ?: unknown; bits?: unknown };
  const originX = typeof candidate.originX === 'number' && Number.isFinite(candidate.originX) ? Math.floor(candidate.originX) : 0;
  const originZ = typeof candidate.originZ === 'number' && Number.isFinite(candidate.originZ) ? Math.floor(candidate.originZ) : 0;
  // 位图长度不对（旧版本、手改过）就换成一张全空的：宁可"这一片没探索"，
  // 也不要让界面在 decode 时拿到半截数据。
  // ⚠️ 不能只看 `decodeBits` 的结果长度——它永远补齐到 128，所以这里要问 base64
  // 解出来的**原始字节数**。
  const bytes = new Uint8Array(MAP_BIT_BYTES);
  if (typeof candidate.bits === 'string') {
    try {
      const raw = atob(candidate.bits);
      if (raw.length === MAP_BIT_BYTES) {
        for (let i = 0; i < MAP_BIT_BYTES; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
      }
    } catch {
      // 坏 base64：保持全零
    }
  }
  return { originX, originZ, bits: encodeBits(bytes) };
}

/** base64 → 位图（长度永远补齐到 `MAP_BIT_BYTES`；坏数据给全零） */
export function decodeBits(bits: string): Uint8Array {
  const out = new Uint8Array(MAP_BIT_BYTES);
  if (bits.length === 0) return out;
  let raw: string;
  try {
    raw = atob(bits);
  } catch {
    return out;
  }
  for (let i = 0; i < MAP_BIT_BYTES && i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xff;
  return out;
}

/** 位图 → base64（固定长度，所以同一片区域是否"探索过"可以直接比较字符串） */
export function encodeBits(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < MAP_BIT_BYTES; i++) raw += String.fromCharCode(bytes[i] ?? 0);
  return btoa(raw);
}

/** 地图中心那一格方块坐标（界面画玩家位置时用） */
export function mapCenter(data: MapData): { x: number; z: number } {
  return { x: data.originX, z: data.originZ };
}

/** 玩家在地图上相对中心的偏移（格方块），界面直接加在画布中心 */
export function mapOffset(data: MapData, x: number, z: number): { dx: number; dz: number } {
  return { dx: x - data.originX, dz: z - data.originZ };
}
