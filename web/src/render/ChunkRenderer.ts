/**
 * 区块渲染调度
 *
 * 负责把 World 里的区块变成场景中的 Mesh：
 *  - 区块生成完成后排队网格化（每帧限量，避免长卡顿）
 *  - 网格化默认丢给 Worker 池（见 MeshWorkerPool）；Worker 不可用时回退到主线程
 *  - 区块卸载时释放几何体
 *  - 新区块加载后连带重刷 4 个邻居，保证跨区块的边界面正确剔除
 *
 * 异步网格化的两个要点：
 *  1. 每个请求带一个自增序号，结果回来时若序号已经不是最新的就丢弃 ——
 *     否则"玩家改了方块后重刷"的旧结果会把新网格覆盖掉；
 *  2. 限制同时在途的请求数，避免 Worker 池被无上限堆积。
 */

import * as THREE from 'three';
import { createGeometry, meshSection, setOpaqueTiles, type GeometryArrays } from '../core/mesh/ChunkMesher.ts';
import { computeSectionVisibility } from '../core/mesh/SectionVisibility.ts';
import { SECTIONS_ALL, SectionOcclusion } from './SectionOcclusion.ts';
import {
  SECTION_COUNT,
  WORLD_MIN_Y,
  advanceChunkState,
  type Chunk,
} from '../core/world/Chunk.ts';
import { chunkKey, type World } from '../core/world/World.ts';
import type { TextureAtlas } from './TextureAtlas.ts';
import type { MeshWorkerPool } from './MeshWorkerPool.ts';
import type { MeshChunkPayload, MeshResponse } from '../worker/chunk.worker.ts';

interface ChunkMeshes {
  meshes: THREE.Mesh[];
  triangles: number;
  cx: number;
  cz: number;
  /** 每个 section 的六面连通图（没有就按全连通） */
  visibility: Uint16Array | undefined;
  /** 上次套到网格上的可见 section 位图（-1 = 还没套过） */
  applied: number;
}

/** 合并网格里每个 section 的索引区间：`[section, start, count]` 依次排列，顺序即绘制顺序 */
type SectionRanges = number[];

/**
 * 网格化优先级（N2，批次 604）：
 *  - **改方块**最急，玩家正盯着那一格变；
 *  - **区块首次加载**次之，决定视野成型速度；
 *  - **光照收敛后的全量重刷**最后，早一帧晚一帧看不出。
 */
export const MESH_PRIORITY_EDIT = 0;
export const MESH_PRIORITY_LOAD = 1;
export const MESH_PRIORITY_REFRESH = 2;

export interface QueueItem {
  cx: number;
  cz: number;
  distanceSq: number;
  priority: number;
}

/** 先按优先级、再按离玩家的距离；导出成纯函数便于离线钉住顺序 */
export function compareMeshQueue(a: QueueItem, b: QueueItem): number {
  return a.priority - b.priority || a.distanceSq - b.distanceSq;
}

export class ChunkRenderer {
  private readonly rendered = new Map<string, ChunkMeshes>();
  /**
   * 几何体复用池（批次 566，N3）：区块重刷时如果顶点/索引数量完全一样，
   * 直接把数组 `set` 回旧 `BufferGeometry`，避免重新分配属性与 GPU 缓冲。
   *
   * 只按“顶点数:索引数”分桶：同一区块反复改一格（最常见）通常落在同一桶里；
   * 形状不同的区块仍然新建，不会为了复用去做昂贵的扩容/搬迁。
   */
  private readonly geometryPool = new Map<string, THREE.BufferGeometry[]>();
  private pooledGeometryCount = 0;
  private static readonly MAX_POOL_PER_KEY = 4;
  private static readonly MAX_POOL_TOTAL = 64;
  private readonly queue: QueueItem[] = [];
  /** 已在队列里的项（键 → 项），用于把“普通加载”升级成“改方块”优先级 */
  private readonly queued = new Map<string, QueueItem>();
  /** 每个区块最近一次派发的请求序号，用于丢弃过期结果 */
  private readonly pending = new Map<string, number>();
  private requestSeq = 0;
  private inFlight = 0;
  private readonly maxInFlight: number;
  /** 上一帧真正画出来的区块数（见 `applyViewDistance`） */
  private drawnChunks = 0;
  /** 区段遮挡剔除；连通图有增删就加版本号，让它重算 */
  private readonly occlusion = new SectionOcclusion();
  private visibilityRevision = 0;

  /**
   * 调试用：抽样某区块网格顶点里的光照值，以及这段网格覆盖的 Y 区间。
   * 用于把"画面偏暗"这类现象定位到"是顶点数据错了还是着色器/环境色错了"。
   */
  sampleMeshLight(
    cx: number,
    cz: number,
    minWorldY = Number.NEGATIVE_INFINITY,
    maxWorldY = Number.POSITIVE_INFINITY,
  ): {
    count: number;
    sky: number[];
    block: number[];
    shade: number[];
    minY: number;
    maxY: number;
  } | null {
    const entry = this.rendered.get(chunkKey(cx, cz));
    if (!entry || entry.meshes.length === 0) return null;

    const sky: number[] = [];
    const block: number[] = [];
    const shade: number[] = [];
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let count = 0;

    for (const mesh of entry.meshes) {
      const light = mesh.geometry.getAttribute('aLight');
      const shadeAttr = mesh.geometry.getAttribute('aShade');
      const position = mesh.geometry.getAttribute('position');
      if (!light || !shadeAttr || !position) continue;

      // 批次 567：归一化字节属性由 `BufferAttribute.getX` 自动还原成 0~1，
      // 这里不再额外除 255（否则会变成 0~1/255）
      const step = Math.max(1, Math.floor(light.count / 8));
      for (let i = 0; i < light.count; i += step) {
        const y = position.getY(i) + mesh.position.y;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (y < minWorldY || y > maxWorldY) continue;
        sky.push(Number(light.getX(i).toFixed(3)));
        block.push(Number(light.getY(i).toFixed(3)));
        shade.push(Number(shadeAttr.getX(i).toFixed(3)));
        count++;
      }
    }

    return { count, sky, block, shade, minY, maxY };
  }

  constructor(
    private readonly scene: THREE.Scene,
    private readonly atlas: TextureAtlas,
    private readonly world: World,
    private readonly solidMaterial: THREE.Material,
    private readonly translucentMaterial: THREE.Material,
    private readonly meshPool: MeshWorkerPool | null = null,
    /** 全不透明整格面的材质（无 discard，批次 20261030-2316）；不传就和镂空层共用 */
    private readonly opaqueMaterial: THREE.Material | null = null,
  ) {
    this.maxInFlight = Math.max(4, (meshPool?.size ?? 1) * 3);
  }

  /** 已经同步给网格器的"全不透明贴图"版本（与 `atlas.opaqueTilesRevision` 对齐） */
  private opaqueRevision = 0;

  /**
   * 图集的全不透明贴图集合变了（首次铺像素 / 资源包增删）就同步给网格器，
   * 已经画过的区块整批重刷——否则旧网格里该进不透明层的面还留在镂空层（不错，只是慢），
   * 反过来资源包把某张贴图改出洞时，旧网格会把洞画成实心（这个是错）。
   */
  private syncOpaqueTiles(): void {
    if (this.opaqueMaterial === null) return;
    const revision = this.atlas.opaqueTilesRevision;
    if (revision === this.opaqueRevision) return;
    this.opaqueRevision = revision;
    const names = [...this.atlas.opaqueTiles];
    setOpaqueTiles(names);
    this.meshPool?.setOpaqueTiles(names);
    if (this.rendered.size > 0) this.enqueueAllRendered();
  }

  /** 供调试面板显示：当前在途的网格化请求数 */
  get inFlightCount(): number {
    return this.inFlight;
  }

  get triangles(): number {
    let total = 0;
    for (const entry of this.rendered.values()) total += entry.triangles;
    return total;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get chunkMeshCount(): number {
    return this.rendered.size;
  }

  /** 区块生成完成：自身 + 已加载的邻居都要重新网格化 */
  onChunkLoaded(cx: number, cz: number): void {
    this.enqueue(cx, cz);
    if (this.world.getChunk(cx - 1, cz)) this.enqueue(cx - 1, cz);
    if (this.world.getChunk(cx + 1, cz)) this.enqueue(cx + 1, cz);
    if (this.world.getChunk(cx, cz - 1)) this.enqueue(cx, cz - 1);
    if (this.world.getChunk(cx, cz + 1)) this.enqueue(cx, cz + 1);
  }

  onChunkUnloaded(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    this.dispose(key);
    this.queued.delete(key);
    this.pending.delete(key);
  }

  /**
   * 方块被玩家修改后，把受影响的区块重新入队。
   * 改动落在区块边界上时要连带邻居一起重刷，否则交界面的剔除会残留。
   */
  enqueueAround(worldX: number, worldZ: number): void {
    const cx = worldX >> 4;
    const cz = worldZ >> 4;
    this.enqueue(cx, cz, MESH_PRIORITY_EDIT);
    const lx = worldX & 15;
    const lz = worldZ & 15;
    if (lx === 0) this.enqueue(cx - 1, cz, MESH_PRIORITY_EDIT);
    if (lx === 15) this.enqueue(cx + 1, cz, MESH_PRIORITY_EDIT);
    if (lz === 0) this.enqueue(cx, cz - 1, MESH_PRIORITY_EDIT);
    if (lz === 15) this.enqueue(cx, cz + 1, MESH_PRIORITY_EDIT);
  }

  /**
   * 把**所有已经渲染过的区块**重新排进网格队列（批次 565，E23）。
   *
   * 启动期光照还在传播时，先烘出来的网格会带着"当时还没亮"的顶点光照；
   * 光照收敛后如果没人重刷，画面就会一直偏暗（探针却是 15）。
   * 这里只重排已渲染的区块，不碰未加载区域；调用方负责**只做一次**。
   */
  enqueueAllRendered(): void {
    for (const entry of this.rendered.values()) this.enqueue(entry.cx, entry.cz, MESH_PRIORITY_REFRESH);
  }

  private enqueue(cx: number, cz: number, priority: number = MESH_PRIORITY_LOAD): void {
    const key = chunkKey(cx, cz);
    const existing = this.queued.get(key);
    if (existing) {
      // 已在队列里：只允许**升级**优先级（例如加载途中玩家改了方块）
      if (priority < existing.priority) existing.priority = priority;
      return;
    }
    // 已有 Worker 请求在途时，改动一入队就立刻让旧结果失效；否则旧结果可能赶在
    // 新请求派发前回来，把“破坏前”的方块短暂画回去一帧。
    if (this.pending.has(key)) this.pending.set(key, ++this.requestSeq);
    const item: QueueItem = { cx, cz, distanceSq: 0, priority };
    this.queued.set(key, item);
    this.queue.push(item);
  }

  /**
   * 每帧派发若干区块的网格化任务。优先处理离玩家最近的，保证视野中心先成型。
   * @param budget 本帧最多派发的区块数
   */
  processQueue(budget: number, centerCx: number, centerCz: number): void {
    // 每帧都要看一眼（只比一个整数）：资源包改贴图时不一定有区块在排队
    this.syncOpaqueTiles();
    if (this.queue.length === 0) return;

    for (const item of this.queue) {
      item.distanceSq = (item.cx - centerCx) ** 2 + (item.cz - centerCz) ** 2;
    }
    this.queue.sort(compareMeshQueue);

    let processed = 0;
    while (processed < budget && this.queue.length > 0 && this.inFlight < this.maxInFlight) {
      const item = this.queue.shift()!;
      this.queued.delete(chunkKey(item.cx, item.cz));
      this.build(item.cx, item.cz);
      processed++;
    }
  }

  private build(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk) {
      this.dispose(key);
      return;
    }

    if (this.meshPool) {
      const request = this.collectChunkData(cx, cz);
      if (!request) return;
      const seq = ++this.requestSeq;
      this.pending.set(key, seq);
      this.inFlight++;
      this.meshPool.request(cx, cz, request.chunks, request.transfer, (response) => {
        this.inFlight--;
        if (this.pending.get(key) !== seq) return; // 已被更新的请求取代
        this.pending.delete(key);
        this.applyMeshes(key, response);
      });
      return;
    }

    this.buildOnMainThread(cx, cz, chunk);
  }

  /**
   * 把中心区块与周围 8 个邻居复制一份交给 Worker（复制后立刻转移所有权）。
   *
   * ⚠️ 必须是 3×3 而不是"中心 + 4 个正邻居"：AO 与平滑光照的采样点会落在
   * **对角方向**（例如顶面最靠外那个顶点的 AO 采样偏移是 x+1、z+1），
   * 若对角区块缺失就会被当成空气，光照/AO 与主线程不一致 ——
   * 具体表现是同一区块在 Worker 下合并结果不同（实测少 5098 个三角形）。
   * 边缘区块缺邻居时仍然按"空气"处理，与主线程 World 的行为一致。
   */
  private collectChunkData(
    cx: number,
    cz: number,
  ): { chunks: MeshChunkPayload[]; transfer: Transferable[] } | null {
    const center = this.world.getChunk(cx, cz);
    if (!center) return null;

    const chunks: MeshChunkPayload[] = [];
    const transfer: Transferable[] = [];

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.world.getChunk(cx + dx, cz + dz);
        if (!chunk) continue;

        const blocks = chunk.blocks.slice();
        const light = chunk.light.slice();
        const states = chunk.copyStates();
        chunks.push({
          cx: chunk.cx,
          cz: chunk.cz,
          blocks: blocks.buffer as ArrayBuffer,
          light: light.buffer as ArrayBuffer,
          counts: chunk.sectionCounts.slice(),
          states: states ? (states.buffer as ArrayBuffer) : null,
        });
        transfer.push(blocks.buffer, light.buffer);
        if (states) transfer.push(states.buffer);
      }
    }

    return chunks.length > 0 ? { chunks, transfer } : null;
  }

  /**
   * 同材质跨 section 合并（N4，批次 608）。
   *
   * 之前每个 section 各建一张 solid/translucent 网格，一个区块最多 24×2 次 draw call；
   * 合并后每个区块最多两张。位置要把 section 的 baseY 烘进顶点，网格本身放在 y=0。
   * light/shade 在 Worker 里已是 0~255 字节，直接按字节合并。
   */
  private mergeLayer(
    entries: Array<{ section: number; arrays: GeometryArrays }>,
    topFirst: boolean,
    ranges: SectionRanges,
  ): GeometryArrays | null {
    return mergeSectionLayer(entries, topFirst, ranges);
  }

  /** Worker 结果 → 场景网格 */
  private applyMeshes(key: string, response: MeshResponse): void {
    const offsetX = response.cx * 16;
    const offsetZ = response.cz * 16;
    const meshes: THREE.Mesh[] = [];
    let triangles = 0;

    const opaques: Array<{ section: number; arrays: GeometryArrays }> = [];
    const solids: Array<{ section: number; arrays: GeometryArrays }> = [];
    const translucent: Array<{ section: number; arrays: GeometryArrays }> = [];
    for (const section of response.sections) {
      if (section.opaque) opaques.push({ section: section.section, arrays: section.opaque });
      if (section.solid) solids.push({ section: section.section, arrays: section.solid });
      if (section.translucent) translucent.push({ section: section.section, arrays: section.translucent });
    }

    for (const [layer, material] of [
      [opaques, this.opaqueMaterial ?? this.solidMaterial],
      [solids, this.solidMaterial],
      [translucent, this.translucentMaterial],
    ] as const) {
      const ranges: SectionRanges = [];
      const merged = this.mergeLayer(layer, material !== this.translucentMaterial, ranges);
      if (!merged) continue;
      const geometry = this.acquireGeometry(merged);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.sectionRanges = ranges;
      // 顶点里已经烘入 section 的 baseY，网格只放水平偏移
      this.freezeAt(mesh, offsetX, 0, offsetZ);
      mesh.frustumCulled = true;
      meshes.push(mesh);
      triangles += geometry.index!.count / 3;
    }

    this.replaceMeshes(key, response.cx, response.cz, meshes, triangles, response.visibility);
    const chunk = this.world.getChunk(response.cx, response.cz);
    if (chunk) chunk.state = advanceChunkState(chunk.state, 'meshed');
  }

  /** Worker 不可用时的回退：在主线程同步网格化 */
  private buildOnMainThread(cx: number, cz: number, chunk: Chunk): void {
    const key = chunkKey(cx, cz);
    const offsetX = cx * 16;
    const offsetZ = cz * 16;
    const meshes: THREE.Mesh[] = [];
    let triangles = 0;
    const visibility = new Uint16Array(SECTION_COUNT);

    for (let section = 0; section < SECTION_COUNT; section++) {
      visibility[section] = computeSectionVisibility(chunk, section);
      if (chunk.sectionIsEmpty(section)) continue;
      const { opaque, solid, translucent } = meshSection(chunk, section, this.atlas, this.world);
      const baseY = WORLD_MIN_Y + section * 16;
      const first = meshes.length;

      if (opaque) {
        const mesh = new THREE.Mesh(opaque, this.opaqueMaterial ?? this.solidMaterial);
        this.freezeAt(mesh, offsetX, baseY, offsetZ);
        mesh.frustumCulled = true;
        meshes.push(mesh);
        triangles += opaque.index!.count / 3;
      }
      if (solid) {
        const mesh = new THREE.Mesh(solid, this.solidMaterial);
        this.freezeAt(mesh, offsetX, baseY, offsetZ);
        mesh.frustumCulled = true;
        meshes.push(mesh);
        triangles += solid.index!.count / 3;
      }
      if (translucent) {
        const mesh = new THREE.Mesh(translucent, this.translucentMaterial);
        this.freezeAt(mesh, offsetX, baseY, offsetZ);
        mesh.frustumCulled = true;
        meshes.push(mesh);
        triangles += translucent.index!.count / 3;
      }
      for (let i = first; i < meshes.length; i++) {
        meshes[i]!.userData.sectionRanges = [section, 0, meshes[i]!.geometry.index!.count];
      }
    }

    this.replaceMeshes(key, cx, cz, meshes, triangles, visibility);
    chunk.state = advanceChunkState(chunk.state, 'meshed');
  }

  /**
   * 摆好位置并把世界矩阵**冻结**（批次 20261026-0141）。
   *
   * three 每帧的 `scene.updateMatrixWorld()` 会给每个对象做一次 compose（位置/旋转/缩放
   * → 矩阵）并递归子节点。区块 mesh 的 position 只在创建时写这一次，之后最多被
   * `applyViewDistance` 改 `visible`——所以 169 个区块就是 169 次每帧白算。
   *
   * 冻结之后矩阵仍是正确值，视锥剔除与绘制都不变（改 `visible` 不涉及矩阵）。
   * ⚠️ 不要再对这些 mesh 调 `position.set` / `rotation` / `scale`：关了自动更新，
   * 改了也不会生效。要挪位置就重建网格（现在的流程本来就是重建后替换）。
   */
  private freezeAt(mesh: THREE.Mesh, x: number, y: number, z: number): void {
    mesh.position.set(x, y, z);
    mesh.updateMatrix();
    // 父级是 scene（单位矩阵），matrixWorld 就等于本地矩阵。
    // 直接 copy 而不是 `updateMatrixWorld()`：不依赖父级此刻的状态，也不触发递归。
    mesh.matrixWorld.copy(mesh.matrix);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
  }

  /**
   * 新网格完整就绪后才原子替换旧网格。
   *
   * 旧实现是在 Worker 开工前就 `dispose`，手机上一次网格化要跨好几帧，于是破坏一格方块会让
   * 整个 16×16 区块暂时消失，邻区块载入时还会连带四块一起闪。现在旧几何一直留到新几何
   * 全部建好；回调期间先挂新网格再拆旧网格，渲染帧永远只会看到“旧”或“新”中的完整一版。
   */
  private replaceMeshes(
    key: string,
    cx: number,
    cz: number,
    meshes: THREE.Mesh[],
    triangles: number,
    visibility: Uint16Array | undefined,
  ): void {
    for (const mesh of meshes) this.scene.add(mesh);
    this.dispose(key);
    if (meshes.length > 0) this.rendered.set(key, { meshes, triangles, cx, cz, visibility, applied: -1 });
    this.visibilityRevision++;
  }

  /**
   * 只画视距之内的区块（批次 203）。
   *
   * 为什么需要这一步：`rendered` 里留着的区块**比视距多**——`World.update` 卸载时留了
   * `keepRadius = 半径 + 2` 的一圈缓冲（避免边界反复加载卸载）。而远裁面**裁不掉它们**：
   * `cameraFarFor` 取"视距×16+32"与天空穹顶（180+32=212，约 13 区块）的**较大者**，
   * 手机视距 4~8 时它永远是 212。于是"自适应把视距降到 4"只让**加载圈**变小，
   * 画面里的 draw call 与三角形几乎不掉——真机反馈"卡的时候视距看起来还是很大"正是这个。
   *
   * 做法：每帧按区块中心到玩家的**水平**距离切 `.visible`（区块是 16×16 柱，垂直方向
   * 拉满，用水平距离就够）。改的是可见性标志，不动几何体、不触发重新上传；
   * 441 个区块也就是几百次平方距离比较，比省下来的 draw call 便宜得多。
   *
   * ⚠️ 半径取 `视距 + 0.5` 格：区块中心相对玩家最远 8 格（半格 + 半区块），
   * 多一点余量避免边缘区块在两帧之间闪进闪出。多出来的这半圈本来也在雾里。
   */
  applyViewDistance(
    centerCx: number,
    centerCz: number,
    viewChunks: number,
    eye: { x: number; y: number; z: number } | null = null,
  ): void {
    const limit = Math.max(1, viewChunks) + 0.5;
    const limitSq = limit * limit;
    if (eye) {
      // 搜索半径比视距多 2 圈：相机（第三人称）可能不在玩家所在区块
      this.occlusion.update(eye.x, eye.y, eye.z, Math.ceil(limit) + 2, this.visibilityRevision, (cx, cz) =>
        this.rendered.get(chunkKey(cx, cz))?.visibility,
      );
    }
    let drawn = 0;
    for (const entry of this.rendered.values()) {
      const dx = entry.cx - centerCx;
      const dz = entry.cz - centerCz;
      const inRange = dx * dx + dz * dz <= limitSq;
      const sections = !inRange ? 0 : eye ? this.occlusion.sectionsOf(entry.cx, entry.cz) : SECTIONS_ALL;
      if (sections !== entry.applied) {
        entry.applied = sections;
        for (const mesh of entry.meshes) applySections(mesh, sections);
      }
      if (sections !== 0) drawn++;
    }
    this.drawnChunks = drawn;
  }

  /** 上一帧真正参与渲染的区块数（诊断用：与 `chunkMeshCount` 的差就是被视距切掉的） */
  get drawnCount(): number {
    return this.drawnChunks;
  }

  /** 当前池里有多少个可复用的几何体（诊断与断言用） */
  get pooledGeometryCountValue(): number {
    return this.pooledGeometryCount;
  }

  private static geometryPoolKey(arrays: GeometryArrays): string {
    return `${arrays.position.length / 3}:${arrays.index.length}`;
  }

  /** 把 0~1 浮点或 0~255 字节写进归一化字节属性 */
  private static writeUnitBytes(target: Uint8Array, source: Float32Array | Uint8Array): void {
    if (source instanceof Uint8Array) {
      target.set(source);
      return;
    }
    for (let i = 0; i < source.length; i++) {
      const v = source[i]!;
      target[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  }

  private acquireGeometry(arrays: GeometryArrays): THREE.BufferGeometry {
    const key = ChunkRenderer.geometryPoolKey(arrays);
    const bucket = this.geometryPool.get(key);
    const reused = bucket?.pop();
    if (!reused) return createGeometry(arrays);
    this.pooledGeometryCount--;
    // 上一任主人可能被遮挡剔除截过一段
    reused.setDrawRange(0, Infinity);

    const position = reused.getAttribute('position') as THREE.BufferAttribute;
    const uv = reused.getAttribute('uv') as THREE.BufferAttribute;
    const tile = reused.getAttribute('aTile') as THREE.BufferAttribute;
    const light = reused.getAttribute('aLight') as THREE.BufferAttribute;
    const shade = reused.getAttribute('aShade') as THREE.BufferAttribute;
    const index = reused.getIndex()!;
    (position.array as Float32Array).set(arrays.position);
    (uv.array as Float32Array).set(arrays.uv);
    (tile.array as Float32Array).set(arrays.tile);
    ChunkRenderer.writeUnitBytes(light.array as Uint8Array, arrays.light);
    ChunkRenderer.writeUnitBytes(shade.array as Uint8Array, arrays.shade);
    (index.array as Uint32Array).set(arrays.index);
    position.needsUpdate = true;
    uv.needsUpdate = true;
    tile.needsUpdate = true;
    light.needsUpdate = true;
    shade.needsUpdate = true;
    index.needsUpdate = true;
    reused.computeBoundingSphere();
    return reused;
  }

  /** 旧几何不立刻 dispose：形状相同的下一次重刷可以直接写回它 */
  private releaseGeometry(geometry: THREE.BufferGeometry): void {
    if (this.pooledGeometryCount >= ChunkRenderer.MAX_POOL_TOTAL) {
      geometry.dispose();
      return;
    }
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!position || !index) {
      geometry.dispose();
      return;
    }
    const key = `${position.count}:${index.count}`;
    const bucket = this.geometryPool.get(key) ?? [];
    if (bucket.length >= ChunkRenderer.MAX_POOL_PER_KEY) {
      geometry.dispose();
      return;
    }
    bucket.push(geometry);
    this.geometryPool.set(key, bucket);
    this.pooledGeometryCount++;
  }

  /** 只释放池里的几何（`disposeAll` 与测试用） */
  private disposePool(): void {
    for (const bucket of this.geometryPool.values()) {
      for (const geometry of bucket) geometry.dispose();
    }
    this.geometryPool.clear();
    this.pooledGeometryCount = 0;
  }

  private dispose(key: string): void {
    const entry = this.rendered.get(key);
    if (!entry) return;
    for (const mesh of entry.meshes) {
      this.scene.remove(mesh);
      // N3（批次 566）：先回池，池满/形状太偏才真的 dispose
      this.releaseGeometry(mesh.geometry);
    }
    this.rendered.delete(key);
    this.visibilityRevision++;
  }

  disposeAll(): void {
    for (const key of [...this.rendered.keys()]) this.dispose(key);
    this.disposePool();
    this.queue.length = 0;
    this.queued.clear();
    this.pending.clear();
  }
}

/**
 * 把同一材质的多个 section 几何合并成一份（N4，批次 608）。
 * 位置里的 y 会加上 section 的 baseY；索引加上顶点偏移。
 */
export function mergeSectionLayer(
  entries: Array<{ section: number; arrays: GeometryArrays }>,
  topFirst = false,
  ranges: SectionRanges | null = null,
): GeometryArrays | null {
  if (entries.length === 0) return null;
  // 不透明层地表在前：玩家多数时候在地表，先画近处地表写深度，地下面片走 early-Z 直接丢弃
  if (topFirst) entries = [...entries].sort((a, b) => b.section - a.section);
  let vertices = 0;
  let indices = 0;
  for (const entry of entries) {
    vertices += entry.arrays.position.length / 3;
    indices += entry.arrays.index.length;
  }
  if (vertices === 0 || indices === 0) return null;

  const position = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  // ⚠️ `aTile` / `aLight` 都是 **每顶点 2 个分量**（见 `createGeometry` 的
  // `new THREE.BufferAttribute(arrays.tile, 2)` / `(quantizeUnit(arrays.light), 2)`）。
  // 这里曾经写成 `* 3` / `vertexOffset * 3`（批次 608 的笔误）：单 section 时
  // 偏移为 0，前 2N 个元素恰好正确，**测不出来**；一旦一个区块有 2 个以上非空
  // section（山地、洞穴、带树的区块），后面 section 的贴图起点与光照就整体错位，
  // 顶点读到的是上一个 section 的尾巴或 0 —— 表现就是"方块表面纯黑、贴图错乱"。
  const tile = new Float32Array(vertices * 2);
  const index = new Uint32Array(indices);
  const byteLight = entries.every((entry) => entry.arrays.light instanceof Uint8Array);
  const byteShade = entries.every((entry) => entry.arrays.shade instanceof Uint8Array);
  const light = byteLight ? new Uint8Array(vertices * 2) : new Float32Array(vertices * 2);
  const shade = byteShade ? new Uint8Array(vertices) : new Float32Array(vertices);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const entry of entries) {
    const arrays = entry.arrays;
    const count = arrays.position.length / 3;
    const baseY = WORLD_MIN_Y + entry.section * 16;
    position.set(arrays.position, vertexOffset * 3);
    for (let i = 0; i < count; i++) position[(vertexOffset + i) * 3 + 1]! += baseY;
    uv.set(arrays.uv, vertexOffset * 2);
    // 与上面同一处笔误的写入端：`tile` / `light` 每顶点 2 个分量
    tile.set(arrays.tile, vertexOffset * 2);
    light.set(arrays.light, vertexOffset * 2);
    shade.set(arrays.shade, vertexOffset);
    for (let i = 0; i < arrays.index.length; i++) {
      index[indexOffset + i] = arrays.index[i]! + vertexOffset;
    }
    if (ranges && arrays.index.length > 0) ranges.push(entry.section, indexOffset, arrays.index.length);
    vertexOffset += count;
    indexOffset += arrays.index.length;
  }

  return { position, uv, tile, light, shade, index };
}

/**
 * 按可见 section 位图截网格：合并网格里各 section 是连续排的，取第一个到最后一个可见
 * section 之间的整段（中间夹着的不可见 section 也会画，换来只用一次 draw call）。
 */
function applySections(mesh: THREE.Mesh, sections: number): void {
  const ranges = mesh.userData.sectionRanges as SectionRanges | undefined;
  if (sections === 0) {
    mesh.visible = false;
    return;
  }
  if (sections === SECTIONS_ALL || !ranges) {
    mesh.visible = true;
    mesh.geometry.setDrawRange(0, Infinity);
    return;
  }
  let start = -1;
  let end = 0;
  for (let i = 0; i < ranges.length; i += 3) {
    if (!(sections & (1 << ranges[i]!))) continue;
    if (start < 0) start = ranges[i + 1]!;
    end = ranges[i + 1]! + ranges[i + 2]!;
  }
  mesh.visible = start >= 0;
  if (start >= 0) mesh.geometry.setDrawRange(start, end - start);
}
