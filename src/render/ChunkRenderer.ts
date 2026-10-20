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
  cx: number;
  cz: number;
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
  /** 上一帧真正画出来的区块数（见 `applyViewDistance`） */
  private drawnChunks = 0;

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

  /**
   * 把一个区块内各 section 的几何合并成一份。
   *
   * 16 层各自成 mesh 时，37 个区块约 300+ draw calls；合并后每区块最多
   * 实心/透明各 1 个，提交开销大幅下降。position 的 y 直接加上 section 的
   * baseY，合并后 mesh.position.y = 0。
   */
  private mergeSectionGeometries(
    parts: Array<{ geometry: THREE.BufferGeometry; baseY: number }>,
  ): THREE.BufferGeometry | null {
    const valid = parts.filter((part) => part.geometry.index);
    if (valid.length === 0) return null;

    let vertexCount = 0;
    let indexCount = 0;
    for (const part of valid) {
      vertexCount += part.geometry.getAttribute('position').count;
      indexCount += part.geometry.index!.count;
    }

    const position = new Float32Array(vertexCount * 3);
    const uv = new Float32Array(vertexCount * 2);
    const tile = new Float32Array(vertexCount * 2);
    const light = new Float32Array(vertexCount * 2);
    const shade = new Float32Array(vertexCount);
    const index = new Uint32Array(indexCount);

    let vertexOffset = 0;
    let indexOffset = 0;
    for (const part of valid) {
      const geometry = part.geometry;
      const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
      const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute;
      const tileAttr = geometry.getAttribute('aTile') as THREE.BufferAttribute;
      const lightAttr = geometry.getAttribute('aLight') as THREE.BufferAttribute;
      const shadeAttr = geometry.getAttribute('aShade') as THREE.BufferAttribute;
      const sourceIndex = geometry.index!;

      for (let i = 0; i < pos.count; i++) {
        const target = (vertexOffset + i) * 3;
        position[target] = pos.getX(i);
        position[target + 1] = pos.getY(i) + part.baseY;
        position[target + 2] = pos.getZ(i);
        const targetUv = (vertexOffset + i) * 2;
        uv[targetUv] = uvAttr.getX(i);
        uv[targetUv + 1] = uvAttr.getY(i);
        const targetTile = (vertexOffset + i) * 2;
        tile[targetTile] = tileAttr.getX(i);
        tile[targetTile + 1] = tileAttr.getY(i);
        light[targetTile] = lightAttr.getX(i);
        light[targetTile + 1] = lightAttr.getY(i);
        shade[vertexOffset + i] = shadeAttr.getX(i);
      }
      for (let i = 0; i < sourceIndex.count; i++) {
        index[indexOffset + i] = sourceIndex.getX(i) + vertexOffset;
      }
      vertexOffset += pos.count;
      indexOffset += sourceIndex.count;
      geometry.dispose();
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setAttribute('aTile', new THREE.BufferAttribute(tile, 2));
    merged.setAttribute('aLight', new THREE.BufferAttribute(light, 2));
    merged.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
    merged.setIndex(new THREE.BufferAttribute(index, 1));
    return merged;
  }

  /** Worker 结果 → 场景网格 */
  private applyMeshes(key: string, response: MeshResponse): void {
    const offsetX = response.cx * 16;
    const offsetZ = response.cz * 16;
    const solidParts: Array<{ geometry: THREE.BufferGeometry; baseY: number }> = [];
    const translucentParts: Array<{ geometry: THREE.BufferGeometry; baseY: number }> = [];
    let triangles = 0;

    for (const section of response.sections) {
      const baseY = WORLD_MIN_Y + section.section * 16;
      if (section.solid) {
        const geometry = createGeometry(section.solid);
        triangles += geometry.index!.count / 3;
        solidParts.push({ geometry, baseY });
      }
      if (section.translucent) {
        const geometry = createGeometry(section.translucent);
        triangles += geometry.index!.count / 3;
        translucentParts.push({ geometry, baseY });
      }
    }

    const meshes: THREE.Mesh[] = [];
    const solidGeometry = this.mergeSectionGeometries(solidParts);
    if (solidGeometry) {
      const mesh = new THREE.Mesh(solidGeometry, this.solidMaterial);
      mesh.position.set(offsetX, 0, offsetZ);
      mesh.frustumCulled = true;
      meshes.push(mesh);
    }
    const translucentGeometry = this.mergeSectionGeometries(translucentParts);
    if (translucentGeometry) {
      const mesh = new THREE.Mesh(translucentGeometry, this.translucentMaterial);
      mesh.position.set(offsetX, 0, offsetZ);
      mesh.frustumCulled = true;
      meshes.push(mesh);
    }

    this.replaceMeshes(key, response.cx, response.cz, meshes, triangles);
  }

  /** Worker 不可用时的回退：在主线程同步网格化 */
  private buildOnMainThread(cx: number, cz: number, chunk: Chunk): void {
    const key = chunkKey(cx, cz);
    const offsetX = cx * 16;
    const offsetZ = cz * 16;
    const solidParts: Array<{ geometry: THREE.BufferGeometry; baseY: number }> = [];
    const translucentParts: Array<{ geometry: THREE.BufferGeometry; baseY: number }> = [];
    let triangles = 0;

    for (let section = 0; section < SECTION_COUNT; section++) {
      if (chunk.sectionIsEmpty(section)) continue;
      const { solid, translucent } = meshSection(chunk, section, this.atlas, this.world);
      const baseY = WORLD_MIN_Y + section * 16;
      if (solid) {
        triangles += solid.index!.count / 3;
        solidParts.push({ geometry: solid, baseY });
      }
      if (translucent) {
        triangles += translucent.index!.count / 3;
        translucentParts.push({ geometry: translucent, baseY });
      }
    }

    const meshes: THREE.Mesh[] = [];
    const solidGeometry = this.mergeSectionGeometries(solidParts);
    if (solidGeometry) {
      const mesh = new THREE.Mesh(solidGeometry, this.solidMaterial);
      mesh.position.set(offsetX, 0, offsetZ);
      mesh.frustumCulled = true;
      meshes.push(mesh);
    }
    const translucentGeometry = this.mergeSectionGeometries(translucentParts);
    if (translucentGeometry) {
      const mesh = new THREE.Mesh(translucentGeometry, this.translucentMaterial);
      mesh.position.set(offsetX, 0, offsetZ);
      mesh.frustumCulled = true;
      meshes.push(mesh);
    }

    this.replaceMeshes(key, cx, cz, meshes, triangles);
  }

  /**
   * 新网格完整就绪后才原子替换旧网格。
   *
   * 旧实现是在 Worker 开工前就 `dispose`，手机上一次网格化要跨好几帧，于是破坏一格方块会让
   * 整个 16×16 区块暂时消失，邻区块载入时还会连带四块一起闪。现在旧几何一直留到新几何
   * 全部建好；回调期间先挂新网格再拆旧网格，渲染帧永远只会看到“旧”或“新”中的完整一版。
   */
  private replaceMeshes(key: string, cx: number, cz: number, meshes: THREE.Mesh[], triangles: number): void {
    for (const mesh of meshes) this.scene.add(mesh);
    this.dispose(key);
    if (meshes.length > 0) this.rendered.set(key, { meshes, triangles, cx, cz });
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
  applyViewDistance(centerCx: number, centerCz: number, viewChunks: number): void {
    const limit = Math.max(1, viewChunks) + 0.5;
    const limitSq = limit * limit;
    let drawn = 0;
    for (const entry of this.rendered.values()) {
      const dx = entry.cx - centerCx;
      const dz = entry.cz - centerCz;
      const visible = dx * dx + dz * dz <= limitSq;
      if (visible) drawn++;
      for (const mesh of entry.meshes) mesh.visible = visible;
    }
    this.drawnChunks = drawn;
  }

  /** 上一帧真正参与渲染的区块数（诊断用：与 `chunkMeshCount` 的差就是被视距切掉的） */
  get drawnCount(): number {
    return this.drawnChunks;
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
