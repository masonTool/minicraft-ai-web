/**
 * 区块 Worker：地形生成 + 网格化。
 *
 * ## 为什么是"一个文件、经典 worker"
 *
 * 整包加密之后方块表就编在包里（不再有 `SPECS_STUB`），Worker 里 `BLOCKS` 在模块求值时
 * 已经是完整的，不需要再由主线程注入——所以这里不需要 bootstrap + 动态 import。
 *
 * 而 `{ type: 'module' }` 这种 ESM worker **在老 WebView 上直接不支持**（实测 WebView 72:
 * `Failed to construct 'Worker': Module scripts are not supported on DedicatedWorker yet`），
 * 构造即抛错 → 世界永远卡在"正在生成世界"。所以构建格式用 `iife`（见 vite.config.ts 的 worker.format）。
 */

import '../polyfill.ts';
import type { DimensionId } from '../core/gen/Dimension.ts';
import type { WorldType } from '../core/gen/WorldType.ts';
import { CHUNK_BLOCK_COUNT, generateChunkBlocks, takeGeneratedStates } from '../core/gen/TerrainGenerator.ts';
import { meshSection, setOpaqueTiles, type MeshContext, type TileUvSource } from '../core/mesh/ChunkMesher.ts';
import { computeSectionVisibility, VISIBILITY_ALL } from '../core/mesh/SectionVisibility.ts';
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
  /** 世界类型（默认 / 超平坦 / 大型群系 / 放大化 / 单一群系） */
  worldType: WorldType;
  /** 单一群系世界的群系注册名 */
  singleBiome?: string;
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
  /**
   * 只重烘这几段（挖/放方块引起的重烘，批次 20261031-1300）。
   *
   * 不给就是整列重烘（加载、重刷）。给了的话 Worker 会拿上一次这个区块的结果当底，
   * 只把这几段重新算一遍——挖方块一次只动 16³ 的一小片，没必要整列都算。
   */
  sections?: number[];
  /** 整列重烘但**保留**可供局部重烘的底（挖方块攒了太多段时的兜底，见 `ChunkRenderer.build`） */
  keep?: boolean;
  /** 全不透明贴图名（只在变化后的第一条请求上带，见 MeshWorkerPool） */
  opaqueTiles?: string[];
}

/** 一个渲染层的顶点数据 */
export interface GeometryPayload {
  position: Float32Array;
  uv: Float32Array;
  tile: Float32Array;
  light: Uint8Array;
  shade: Uint8Array;
  index: Uint32Array;
}

export interface MeshSectionPayload {
  section: number;
  opaque: GeometryPayload | null;
  solid: GeometryPayload | null;
  translucent: GeometryPayload | null;
}

export interface MeshResponse {
  type: 'meshed';
  id: number;
  cx: number;
  cz: number;
  sections: MeshSectionPayload[];
  /** 每个 section 的六面连通图（区段遮挡剔除用，见 SectionVisibility） */
  visibility?: Uint16Array;
  /** Worker 侧各阶段耗时（诊断用，毫秒；批次 20261031-1300 找"挖方块多久才消失"用） */
  perf?: { parse: number; mesh: number; clone: number; sections: number };
}

export type WorkerRequest = GenerateRequest | MeshRequest;
export type WorkerResponse = GenerateResponse | MeshResponse;

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

/**
 * 上一次"重烘"留下的各段顶点数据，供下一次只重算少数几段时复用（批次 20261031-1300）。
 *
 * 只留最近 2 个区块：挖方块永远发生在脚边那一两个区块里，留多了只是白占内存
 * （一个区块的顶点数据约 1MB）。
 */
interface CachedMesh {
  sections: MeshSectionPayload[];
  visibility: Uint16Array;
}

const sectionCache = new Map<string, CachedMesh>();
const SECTION_CACHE_LIMIT = 2;

/** 深拷贝一份顶点数据（缓存里的要留着，发出去的那份会被 transfer 走） */
function cloneGeometry(payload: GeometryPayload | null): GeometryPayload | null {
  if (!payload) return null;
  return {
    position: payload.position.slice(),
    uv: payload.uv.slice(),
    tile: payload.tile.slice(),
    light: payload.light.slice(),
    shade: payload.shade.slice(),
    index: payload.index.slice(),
  };
}

function cloneSections(sections: readonly MeshSectionPayload[]): MeshSectionPayload[] {
  return sections.map((s) => ({
    section: s.section,
    opaque: cloneGeometry(s.opaque),
    solid: cloneGeometry(s.solid),
    translucent: cloneGeometry(s.translucent),
  }));
}

function rememberSections(key: string, sections: MeshSectionPayload[], visibility: Uint16Array): void {
  sectionCache.delete(key);
  sectionCache.set(key, { sections: cloneSections(sections), visibility: visibility.slice() });
  while (sectionCache.size > SECTION_CACHE_LIMIT) {
    const oldest = sectionCache.keys().next().value as string;
    sectionCache.delete(oldest);
  }
}

function meshChunk(req: MeshRequest): { response: MeshResponse; transfer: Transferable[] } {
  const tStart = performance.now();
  const world = new MeshWorld(req.chunks, req.cx, req.cz);
  const sections: MeshSectionPayload[] = [];
  const transfer: Transferable[] = [];
  const chunk = world.center;
  const visibility = new Uint16Array(SECTION_COUNT).fill(VISIBILITY_ALL);
  transfer.push(visibility.buffer);
  const key = `${req.cx},${req.cz}`;
  const parseMs = performance.now() - tStart;

  const collect = (geometry: GeometryLike | null): GeometryPayload | null => {
    if (!geometry) return null;
    return {
      position: geometry.getAttribute('position').array as Float32Array,
      uv: geometry.getAttribute('uv').array as Float32Array,
      tile: geometry.getAttribute('aTile').array as Float32Array,
      light: geometry.getAttribute('aLight').array as Uint8Array,
      shade: geometry.getAttribute('aShade').array as Uint8Array,
      index: geometry.getIndex()!.array as Uint32Array,
    };
  };

  /**
   * 所有要发回去的顶点 buffer 统一登记进 transfer（零拷贝）。
   * ⚠️ 必须**最后只走这一遍**：`sections` 里既有刚烘的、也有从缓存拷来的，
   * 两处各自 push 一遍会让同一个 buffer 在 transfer 列表里出现两次（postMessage 会抛错）。
   */
  const takeAll = (list: readonly MeshSectionPayload[]): void => {
    for (const s of list) {
      for (const p of [s.opaque, s.solid, s.translucent]) {
        if (!p) continue;
        transfer.push(p.position.buffer, p.uv.buffer, p.tile.buffer, p.light.buffer, p.shade.buffer, p.index.buffer);
      }
    }
  };

  /** 只重烘 `req.sections` 这几段，其余段沿用缓存 */
  const cached = req.sections ? sectionCache.get(key) : undefined;
  if (chunk && req.sections && cached) {
    const meshStart = performance.now();
    // 连通图也复用：它只在"这一段的不透明度变了"时才需要重算，而重算它（每段一次 BFS）
    // 原来在每次重烘时对**所有**段都跑一遍，是"局部重烘"省不下时间的主因
    visibility.set(cached.visibility);
    const byId = new Map<number, MeshSectionPayload>();
    for (const s of cached.sections) {
      byId.set(s.section, {
        section: s.section,
        opaque: cloneGeometry(s.opaque),
        solid: cloneGeometry(s.solid),
        translucent: cloneGeometry(s.translucent),
      });
    }
    for (const section of req.sections) {
      if (section < 0 || section >= SECTION_COUNT) continue;
      if (chunk.sectionIsEmpty(section)) {
        byId.delete(section);
        visibility[section] = VISIBILITY_ALL;
        continue;
      }
      visibility[section] = computeSectionVisibility(chunk, section);
      const { opaque, solid, translucent } = meshSection(chunk, section, tileUv, world);
      const opaquePayload = collect(opaque);
      const solidPayload = collect(solid);
      const translucentPayload = collect(translucent);
      if (opaquePayload || solidPayload || translucentPayload) {
        byId.set(section, { section, opaque: opaquePayload, solid: solidPayload, translucent: translucentPayload });
      } else {
        byId.delete(section);
      }
    }
    for (const s of byId.values()) sections.push(s);
    sections.sort((a, b) => a.section - b.section);
    const meshMs = performance.now() - meshStart;
    const cloneStart = performance.now();
    takeAll(sections);
    rememberSections(key, sections, visibility);
    const cloneMs = performance.now() - cloneStart;
    return {
      response: {
        type: 'meshed',
        id: req.id,
        cx: req.cx,
        cz: req.cz,
        sections,
        visibility,
        perf: { parse: parseMs, mesh: meshMs, clone: cloneMs, sections: sections.length },
      },
      transfer,
    };
  }

  if (chunk) {
    for (let section = 0; section < SECTION_COUNT; section++) {
      if (chunk.sectionIsEmpty(section)) continue;
      visibility[section] = computeSectionVisibility(chunk, section);
      const { opaque, solid, translucent } = meshSection(chunk, section, tileUv, world);
      const opaquePayload = collect(opaque);
      const solidPayload = collect(solid);
      const translucentPayload = collect(translucent);
      if (opaquePayload || solidPayload || translucentPayload) {
        sections.push({ section, opaque: opaquePayload, solid: solidPayload, translucent: translucentPayload });
      }
    }
  }

  const meshMs = performance.now() - tStart - parseMs;
  const cloneStart = performance.now();
  takeAll(sections);
  // 整列重烘：给了 `sections` 说明是编辑引起的（下次还要复用），留一份底；
  // 没给是加载/重刷，缓存作废（区块可能已经换了一份数据）
  if (req.sections) rememberSections(key, sections, visibility);
  else sectionCache.delete(key);
  const cloneMs = performance.now() - cloneStart;
  return {
    response: {
      type: 'meshed',
      id: req.id,
      cx: req.cx,
      cz: req.cz,
      sections,
      visibility,
      perf: { parse: parseMs, mesh: meshMs, clone: cloneMs, sections: sections.length },
    },
    transfer,
  };
}

// ---------------------------------------------------------------- 入口

/** 避免依赖 WebWorker lib（会与 DOM lib 冲突），只声明用到的接口 */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const ctx = self as unknown as WorkerScope;

/**
 * 处理一条请求（由 `chunk.worker.ts` 那个 bootstrap 在**装完方块表之后**调用）。
 *
 * 原来是本模块自己在顶层 `addEventListener` 监听；改成导出函数是因为：
 * app 形态下方块表要等 bootstrap 收到才装得上，而本模块的依赖链里有
 * `items.ts` 的模块级注册循环，**必须在装表之后才能求值**。
 * 于是唯一能保证顺序的办法是——bootstrap 先装表，再 `import()` 本模块。
 */
ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type === 'generate') {
    const blocks = generateChunkBlocks(
      req.cx,
      req.cz,
      req.seed,
      req.dimension,
      req.worldType,
      new Uint16Array(CHUNK_BLOCK_COUNT),
      undefined,
      req.singleBiome,
    );
    const states = takeGeneratedStates();
    const response: GenerateResponse = {
      type: 'generated',
      id: req.id,
      cx: req.cx,
      cz: req.cz,
      // 转移所有权：零拷贝交给主线程
      blocks: blocks.buffer as ArrayBuffer,
      states: states ? (states.buffer as ArrayBuffer) : null,
    };
    const transfer: Transferable[] = [response.blocks];
    if (response.states) transfer.push(response.states);
    ctx.postMessage(response, transfer);
    return;
  }

  if (req.type === 'mesh') {
    if (req.opaqueTiles) setOpaqueTiles(req.opaqueTiles);
    const { response, transfer } = meshChunk(req);
    ctx.postMessage(response, transfer);
  }
});
