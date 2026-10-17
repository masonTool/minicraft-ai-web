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
import { createGeometry, meshSection } from '../core/mesh/ChunkMesher.ts';
import { SECTION_COUNT, WORLD_MIN_Y, type Chunk } from '../core/world/Chunk.ts';
import { chunkKey, type World } from '../core/world/World.ts';
import type { TextureAtlas } from './TextureAtlas.ts';
import type { MeshWorkerPool } from './MeshWorkerPool.ts';
import type { MeshChunkPayload, MeshResponse } from '../worker/chunk.worker.ts';

interface ChunkMeshes {
  meshes: THREE.Mesh[];
  triangles: number;
}

interface QueueItem {
  cx: number;
  cz: number;
  distanceSq: number;
}

export class ChunkRenderer {
  private readonly rendered = new Map<string, ChunkMeshes>();
  private readonly queue: QueueItem[] = [];
  private readonly queued = new Set<string>();
  /** 每个区块最近一次派发的请求序号，用于丢弃过期结果 */
  private readonly pending = new Map<string, number>();
  private requestSeq = 0;
  private inFlight = 0;
  private readonly maxInFlight: number;

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
  ) {
    this.maxInFlight = Math.max(4, (meshPool?.size ?? 1) * 3);
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
    this.enqueue(cx, cz);
    const lx = worldX & 15;
    const lz = worldZ & 15;
    if (lx === 0) this.enqueue(cx - 1, cz);
    if (lx === 15) this.enqueue(cx + 1, cz);
    if (lz === 0) this.enqueue(cx, cz - 1);
    if (lz === 15) this.enqueue(cx, cz + 1);
  }

  private enqueue(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.queued.has(key)) return;
    // 已有 Worker 请求在途时，改动一入队就立刻让旧结果失效；否则旧结果可能赶在
    // 新请求派发前回来，把“破坏前”的方块短暂画回去一帧。
    if (this.pending.has(key)) this.pending.set(key, ++this.requestSeq);
    this.queued.add(key);
    this.queue.push({ cx, cz, distanceSq: 0 });
  }

  /**
   * 每帧派发若干区块的网格化任务。优先处理离玩家最近的，保证视野中心先成型。
   * @param budget 本帧最多派发的区块数
   */
  processQueue(budget: number, centerCx: number, centerCz: number): void {
    if (this.queue.length === 0) return;

    for (const item of this.queue) {
      item.distanceSq = (item.cx - centerCx) ** 2 + (item.cz - centerCz) ** 2;
    }
    this.queue.sort((a, b) => a.distanceSq - b.distanceSq);

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

  /** Worker 结果 → 场景网格 */
  private applyMeshes(key: string, response: MeshResponse): void {
    const offsetX = response.cx * 16;
    const offsetZ = response.cz * 16;
    const meshes: THREE.Mesh[] = [];
    let triangles = 0;

    for (const section of response.sections) {
      const baseY = WORLD_MIN_Y + section.section * 16;

      if (section.solid) {
        const geometry = createGeometry(section.solid);
        const mesh = new THREE.Mesh(geometry, this.solidMaterial);
        mesh.position.set(offsetX, baseY, offsetZ);
        mesh.frustumCulled = true;
        meshes.push(mesh);
        triangles += geometry.index!.count / 3;
      }
      if (section.translucent) {
        const geometry = createGeometry(section.translucent);
        const mesh = new THREE.Mesh(geometry, this.translucentMaterial);
        mesh.position.set(offsetX, baseY, offsetZ);
        mesh.frustumCulled = true;
        meshes.push(mesh);
        triangles += geometry.index!.count / 3;
      }
    }

    this.replaceMeshes(key, meshes, triangles);
  }

  /** Worker 不可用时的回退：在主线程同步网格化 */
  private buildOnMainThread(cx: number, cz: number, chunk: Chunk): void {
    const key = chunkKey(cx, cz);
    const offsetX = cx * 16;
    const offsetZ = cz * 16;
    const meshes: THREE.Mesh[] = [];
    let triangles = 0;

    for (let section = 0; section < SECTION_COUNT; section++) {
      if (chunk.sectionIsEmpty(section)) continue;
      const { solid, translucent } = meshSection(chunk, section, this.atlas, this.world);
      const baseY = WORLD_MIN_Y + section * 16;

      if (solid) {
        const mesh = new THREE.Mesh(solid, this.solidMaterial);
        mesh.position.set(offsetX, baseY, offsetZ);
        mesh.frustumCulled = true;
        meshes.push(mesh);
        triangles += solid.index!.count / 3;
      }
      if (translucent) {
        const mesh = new THREE.Mesh(translucent, this.translucentMaterial);
        mesh.position.set(offsetX, baseY, offsetZ);
        mesh.frustumCulled = true;
        meshes.push(mesh);
        triangles += translucent.index!.count / 3;
      }
    }

    this.replaceMeshes(key, meshes, triangles);
  }

  /**
   * 新网格完整就绪后才原子替换旧网格。
   *
   * 旧实现是在 Worker 开工前就 `dispose`，手机上一次网格化要跨好几帧，于是破坏一格方块会让
   * 整个 16×16 区块暂时消失，邻区块载入时还会连带四块一起闪。现在旧几何一直留到新几何
   * 全部建好；回调期间先挂新网格再拆旧网格，渲染帧永远只会看到“旧”或“新”中的完整一版。
   */
  private replaceMeshes(key: string, meshes: THREE.Mesh[], triangles: number): void {
    for (const mesh of meshes) this.scene.add(mesh);
    this.dispose(key);
    if (meshes.length > 0) this.rendered.set(key, { meshes, triangles });
  }

  private dispose(key: string): void {
    const entry = this.rendered.get(key);
    if (!entry) return;
    for (const mesh of entry.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.rendered.delete(key);
  }

  disposeAll(): void {
    for (const key of [...this.rendered.keys()]) this.dispose(key);
    this.queue.length = 0;
    this.queued.clear();
    this.pending.clear();
  }
}
