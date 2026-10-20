/**
 * 区块 Worker：地形生成 + 网格化
 *
 * 两种请求：
 *  - `generate`：生成区块方块数据，零拷贝回传（P0/P1 就在用）
 *  - `mesh`    ：对某个区块做网格化（含贪心合并），把顶点数据零拷贝回传
 *
 * 为什么网格化也要搬到这里：一个区块要处理 24 个 section × 6 个朝向 × 每层 256 格的
 * 面剔除、AO、光照采样与矩形合并，是纯计算。放在主线程会和渲染抢时间（表现为移动掉帧）。
 *
 * Worker 不缓存状态：主线程每次请求时把「中心区块 + 4 个邻居」的方块/光照/状态数组
 * 复制一份并转移所有权过来。复制的数据量（每区块约 200KB）远小于网格化的计算量。
 *
 * 贴图位置换算只依赖 atlasLayout 的常量，因此这里不会引入任何 DOM 依赖。
 */

import type { DimensionId } from '../core/gen/Dimension.ts';
import type { WorldType } from '../core/gen/WorldType.ts';
import { CHUNK_BLOCK_COUNT, generateChunkBlocks, takeGeneratedStates } from '../core/gen/TerrainGenerator.ts';
import { meshSection, type MeshContext, type TileUvSource } from '../core/mesh/ChunkMesher.ts';
import { Chunk, SECTION_COUNT, WORLD_MAX_Y, WORLD_MIN_Y } from '../core/world/Chunk.ts';
import { ATLAS_COLUMNS, TILE_ORDER, TILE_PADDING } from '../render/atlasLayout.ts';
import { tileOriginAt } from '../render/atlasCoords.ts';

// ---------------------------------------------------------------- 消息类型

export interface GenerateRequest {
  type: 'generate';
  id: number;
  cx: number;
  cz: number;
  seed: number;
  /** 维度（主世界 / 下界 / 末地） */
  dimension: DimensionId;
  /** 世界类型（默认 / 超平坦 / 放大化） */
  worldType: WorldType;
}

export interface GenerateResponse {
  type: 'generated';
  id: number;
  cx: number;
  cz: number;
  blocks: ArrayBuffer;
  /**
   * 方块状态（朝向/开关）。自然地形全是 0，只有结构生成的门、楼梯才会用到，
   * 因此这里允许为 null —— 避免每个区块都白白多传 96KB。
   */
  states: ArrayBuffer | null;
}

/** 一个区块的网格化输入数据 */
export interface MeshChunkPayload {
  cx: number;
  cz: number;
  blocks: ArrayBuffer;
  light: ArrayBuffer;
  counts: Int32Array;
  states: ArrayBuffer | null;
}

export interface MeshRequest {
  type: 'mesh';
  id: number;
  cx: number;
  cz: number;
  chunks: MeshChunkPayload[];
}

/** 一个渲染层的顶点数据 */
export interface GeometryPayload {
  position: Float32Array;
  uv: Float32Array;
  tile: Float32Array;
  light: Float32Array;
  shade: Float32Array;
  index: Uint32Array;
}

export interface MeshSectionPayload {
  section: number;
  solid: GeometryPayload | null;
  translucent: GeometryPayload | null;
}

export interface MeshResponse {
  type: 'meshed';
  id: number;
  cx: number;
  cz: number;
  sections: MeshSectionPayload[];
}

export type WorkerRequest = GenerateRequest | MeshRequest;
export interface PongResponse {
  type: 'pong';
  id: number;
}

export type WorkerResponse = GenerateResponse | MeshResponse | PongResponse;

/** 只依赖几何体的读取接口，避免 Worker 里引入 three 的类型 */
interface GeometryLike {
  getAttribute(name: string): { array: ArrayLike<number> };
  getIndex(): { array: ArrayLike<number> } | null;
}

// ---------------------------------------------------------------- 贴图位置

const TILE_INDEX = new Map<string, number>(TILE_ORDER.map((name, index) => [name, index]));
const ATLAS_ROWS = Math.ceil(TILE_ORDER.length / ATLAS_COLUMNS);

/**
 * 与 TextureAtlas.tileOrigin 必须完全一致。
 * 这里只用常量算，不创建 canvas —— 顶点只需要「贴图在图集里的起点」。
 *
 * ⚠️ `TILE_PADDING` 不能漏（批次 520）：上传图集每格四周有 8 纹素的外扩边距，
 * 顶点里的起点是**内容区**的左下角。这里少传一个参数，整张图的 UV 就会偏移
 * 半个格子（所有方块贴图错位）。两边的一致性由 `test:mesh` 的 UV 断言守着。
 */
const tileUv: TileUvSource = {
  tileOrigin(tile: string): [number, number] {
    return tileOriginAt(TILE_INDEX.get(tile) ?? 0, ATLAS_COLUMNS, ATLAS_ROWS, TILE_PADDING);
  },
};

// ---------------------------------------------------------------- 取样上下文

/** Worker 侧的区块数据（只保留本次请求带来的 5 个区块） */
class MeshWorld implements MeshContext {
  private readonly chunks = new Map<string, Chunk>();
  /** 单条目缓存：网格化会沿 X/Z 连续取样，命中率很高 */
  private lastCx = Number.NaN;
  private lastCz = Number.NaN;
  private last: Chunk | undefined;

  constructor(payloads: readonly MeshChunkPayload[], private readonly centerCx: number, private readonly centerCz: number) {
    for (const payload of payloads) {
      const chunk = Chunk.fromData(payload.cx, payload.cz, new Uint16Array(payload.blocks), payload.counts);
      if (payload.light.byteLength > 0) chunk.light.set(new Uint8Array(payload.light));
      if (payload.states && payload.states.byteLength > 0) chunk.restoreStates(new Uint8Array(payload.states));
      this.chunks.set(`${payload.cx},${payload.cz}`, chunk);
    }
  }

  /** 本次要网格化的中心区块 */
  get center(): Chunk | undefined {
    return this.at(this.centerCx, this.centerCz);
  }

  private at(cx: number, cz: number): Chunk | undefined {
    if (cx === this.lastCx && cz === this.lastCz) return this.last;
    this.lastCx = cx;
    this.lastCz = cz;
    this.last = this.chunks.get(`${cx},${cz}`);
    return this.last;
  }

  getBlock(worldX: number, worldY: number, worldZ: number): number {
    if (worldY < WORLD_MIN_Y || worldY >= WORLD_MAX_Y) return 0;
    const chunk = this.at(worldX >> 4, worldZ >> 4);
    if (!chunk) return 0;
    return chunk.get(worldX & 15, worldY, worldZ & 15);
  }

  getBlockState(worldX: number, worldY: number, worldZ: number): number {
    const chunk = this.at(worldX >> 4, worldZ >> 4);
    if (!chunk) return 0;
    return chunk.getState(worldX & 15, worldY, worldZ & 15);
  }

  getSkyLight(worldX: number, worldY: number, worldZ: number): number {
    const chunk = this.at(worldX >> 4, worldZ >> 4);
    if (!chunk) return 0;
    return chunk.getSkyLight(worldX & 15, worldY, worldZ & 15);
  }

  getBlockLight(worldX: number, worldY: number, worldZ: number): number {
    const chunk = this.at(worldX >> 4, worldZ >> 4);
    if (!chunk) return 0;
    return chunk.getBlockLight(worldX & 15, worldY, worldZ & 15);
  }
}

// ---------------------------------------------------------------- 网格化

function meshChunk(req: MeshRequest): { response: MeshResponse; transfer: Transferable[] } {
  const world = new MeshWorld(req.chunks, req.cx, req.cz);
  const sections: MeshSectionPayload[] = [];
  const transfer: Transferable[] = [];
  const chunk = world.center;

  const collect = (geometry: GeometryLike | null): GeometryPayload | null => {
    if (!geometry) return null;
    const payload: GeometryPayload = {
      position: geometry.getAttribute('position').array as Float32Array,
      uv: geometry.getAttribute('uv').array as Float32Array,
      tile: geometry.getAttribute('aTile').array as Float32Array,
      light: geometry.getAttribute('aLight').array as Float32Array,
      shade: geometry.getAttribute('aShade').array as Float32Array,
      index: geometry.getIndex()!.array as Uint32Array,
    };
    transfer.push(
      payload.position.buffer,
      payload.uv.buffer,
      payload.tile.buffer,
      payload.light.buffer,
      payload.shade.buffer,
      payload.index.buffer,
    );
    return payload;
  };

  if (chunk) {
    for (let section = 0; section < SECTION_COUNT; section++) {
      if (chunk.sectionIsEmpty(section)) continue;
      const { solid, translucent } = meshSection(chunk, section, tileUv, world);
      const solidPayload = collect(solid);
      const translucentPayload = collect(translucent);
      if (solidPayload || translucentPayload) {
        sections.push({ section, solid: solidPayload, translucent: translucentPayload });
      }
    }
  }

  return { response: { type: 'meshed', id: req.id, cx: req.cx, cz: req.cz, sections }, transfer };
}

// ---------------------------------------------------------------- 入口

/** 避免依赖 WebWorker lib（会与 DOM lib 冲突），只声明用到的接口 */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

/**
 * 纯消息处理：Worker 入口与主线程降级共用。
 *
 * 这是 additive 平台 seam：Web Worker 行为不变，平台层可以 import 本函数
 * 在主线程执行同一套生成/网格化逻辑。
 */
export function handleWorkerRequest(req: WorkerRequest): {
  response: WorkerResponse;
  transfer: Transferable[];
} {
  if (!req || typeof req !== 'object' || typeof req.type !== 'string') {
    return { response: { type: 'pong', id: 0 }, transfer: [] };
  }

  if (req.type === 'generate') {
    const blocks = generateChunkBlocks(
      req.cx,
      req.cz,
      req.seed,
      req.dimension,
      req.worldType,
      new Uint16Array(CHUNK_BLOCK_COUNT),
    );
    const states = takeGeneratedStates();
    const response: GenerateResponse = {
      type: 'generated',
      id: req.id,
      cx: req.cx,
      cz: req.cz,
      blocks: blocks.buffer as ArrayBuffer,
      states: states ? (states.buffer as ArrayBuffer) : null,
    };
    const transfer: Transferable[] = [response.blocks];
    if (response.states) transfer.push(response.states);
    return { response, transfer };
  }

  if (req.type === 'mesh') {
    return meshChunk(req);
  }

  return { response: { type: 'pong', id: 0 }, transfer: [] };
}

// 只有真正的 Worker 作用域才注册监听：
// - Web Worker / wx worker 里没有 document；
// - 主线程（Web 或小游戏 fake DOM）有 document，不能在这里注册。
const ctx =
  typeof self !== 'undefined' && typeof document === 'undefined'
    ? (self as unknown as WorkerScope)
    : null;

if (ctx) {
  ctx.addEventListener('message', (event) => {
    const { response, transfer } = handleWorkerRequest(event.data);
    ctx.postMessage(response, transfer);
  });
}
