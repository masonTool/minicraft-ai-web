/**
 * 区块渲染调度
 *
 * 负责把 World 里的区块变成场景中的 Mesh：
 *  - 区块生成完成后排队网格化（每帧限量，避免长卡顿）
 *  - 区块卸载时释放几何体
 *  - 新区块加载后连带重刷 4 个邻居，保证跨区块的边界面正确剔除
 */

import * as THREE from 'three';
import { meshSection } from '../core/mesh/ChunkMesher.ts';
import { SECTION_COUNT, WORLD_MIN_Y } from '../core/world/Chunk.ts';
import { chunkKey, type World } from '../core/world/World.ts';
import type { TextureAtlas } from './TextureAtlas.ts';

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

  constructor(
    private readonly scene: THREE.Scene,
    private readonly atlas: TextureAtlas,
    private readonly world: World,
    private readonly solidMaterial: THREE.Material,
    private readonly translucentMaterial: THREE.Material,
  ) {}

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
    this.queued.add(key);
    this.queue.push({ cx, cz, distanceSq: 0 });
  }

  /**
   * 每帧处理若干区块。优先处理离玩家最近的，保证视野中心先成型。
   * @param budget 本帧最多网格化的区块数
   */
  processQueue(budget: number, centerCx: number, centerCz: number): void {
    if (this.queue.length === 0) return;

    for (const item of this.queue) {
      item.distanceSq = (item.cx - centerCx) ** 2 + (item.cz - centerCz) ** 2;
    }
    this.queue.sort((a, b) => a.distanceSq - b.distanceSq);

    let processed = 0;
    while (processed < budget && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.queued.delete(chunkKey(item.cx, item.cz));
      this.build(item.cx, item.cz);
      processed++;
    }
  }

  private build(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    this.dispose(key);

    const chunk = this.world.getChunk(cx, cz);
    if (!chunk) return;

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
        this.scene.add(mesh);
        meshes.push(mesh);
        triangles += solid.index!.count / 3;
      }
      if (translucent) {
        const mesh = new THREE.Mesh(translucent, this.translucentMaterial);
        mesh.position.set(offsetX, baseY, offsetZ);
        mesh.frustumCulled = true;
        this.scene.add(mesh);
        meshes.push(mesh);
        triangles += translucent.index!.count / 3;
      }
    }

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
  }
}
