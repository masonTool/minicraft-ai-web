/**
 * 区块网格化
 *
 * 目前是"面剔除"版本：只为与空气/非遮挡方块相邻的面生成三角形。
 * P1 会在此基础上加入贪心网格化（greedy meshing）以进一步压缩顶点数。
 *
 * 输出按渲染层拆分：
 *  - solid       ：不透光方块 + 使用 alphaTest 的镂空方块（树叶）
 *  - translucent ：水、玻璃（需要混合与排序）
 */

import * as THREE from 'three';
import { Block, blockDef } from '../registry/blocks.ts';
import { Chunk, SECTION_HEIGHT, SECTION_COUNT } from '../world/Chunk.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';

export type RenderLayer = 'solid' | 'translucent';

interface FaceCorner {
  pos: readonly [number, number, number];
  uv: readonly [number, number];
}

interface Face {
  dir: readonly [number, number, number];
  /** 使用顶面 / 底面 / 侧面 贴图：0=顶 1=底 2=侧 */
  tile: 0 | 1 | 2;
  corners: readonly [FaceCorner, FaceCorner, FaceCorner, FaceCorner];
}

/**
 * 六个面的顶点顺序保证：三角形 (0,1,2) 与 (2,1,3) 的法线朝外，
 * 与 THREE.FrontSide 的逆时针正面约定一致。
 */
const FACES: readonly Face[] = [
  {
    // -X
    dir: [-1, 0, 0],
    tile: 2,
    corners: [
      { pos: [0, 1, 0], uv: [0, 1] },
      { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 1, 1], uv: [1, 1] },
      { pos: [0, 0, 1], uv: [1, 0] },
    ],
  },
  {
    // +X
    dir: [1, 0, 0],
    tile: 2,
    corners: [
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] },
      { pos: [1, 0, 0], uv: [1, 0] },
    ],
  },
  {
    // -Y
    dir: [0, -1, 0],
    tile: 1,
    corners: [
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] },
      { pos: [0, 0, 0], uv: [0, 1] },
    ],
  },
  {
    // +Y
    dir: [0, 1, 0],
    tile: 0,
    corners: [
      { pos: [0, 1, 1], uv: [1, 1] },
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 0] },
    ],
  },
  {
    // -Z
    dir: [0, 0, -1],
    tile: 2,
    corners: [
      { pos: [1, 0, 0], uv: [0, 0] },
      { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 1] },
    ],
  },
  {
    // +Z
    dir: [0, 0, 1],
    tile: 2,
    corners: [
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] },
      { pos: [1, 1, 1], uv: [1, 1] },
    ],
  },
];

function layerOf(id: number): RenderLayer {
  return blockDef(id).translucent ? 'translucent' : 'solid';
}

export interface MeshResult {
  solid: THREE.BufferGeometry | null;
  translucent: THREE.BufferGeometry | null;
}

/**
 * 对一个 section 生成网格。顶点坐标为 section 局部坐标（x/z ∈ [0,16)，y ∈ [0,16)），
 * 由调用方设置 mesh 的 position 完成定位。
 *
 * @param neighbor 区块边界外的方块查询：(worldX, worldY, worldZ) => blockId。
 *                 P0 传 () => 0（视外部为空气），P1 接入相邻区块。
 */
export function meshSection(
  chunk: Chunk,
  section: number,
  atlas: TextureAtlas,
  neighbor: (worldX: number, worldY: number, worldZ: number) => number,
): MeshResult {
  const buffers: Record<RenderLayer, { pos: number[]; norm: number[]; uv: number[]; idx: number[] }> = {
    solid: { pos: [], norm: [], uv: [], idx: [] },
    translucent: { pos: [], norm: [], uv: [], idx: [] },
  };

  if (section < 0 || section >= SECTION_COUNT) return { solid: null, translucent: null };
  if (chunk.sectionIsEmpty(section)) return { solid: null, translucent: null };

  const baseY = Chunk.sectionMinY(section);
  const originX = chunk.cx * 16;
  const originZ = chunk.cz * 16;

  for (let y = 0; y < SECTION_HEIGHT; y++) {
    const worldY = baseY + y;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = chunk.get(x, worldY, z);
        if (id === Block.AIR) continue;

        const def = blockDef(id);
        const buf = buffers[layerOf(id)];

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const nx = x + dx;
          const ny = worldY + dy;
          const nz = z + dz;

          // 邻接方块查询：越出本区块 x/z 范围时交给 neighbor 回调
          let neighborId: number;
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15) {
            neighborId = neighbor(originX + nx, ny, originZ + nz);
          } else {
            neighborId = ny < -64 || ny >= 320 ? Block.AIR : chunk.get(nx, ny, nz);
          }

          // 遮挡剔除：邻居不透明则本面不可见
          if (blockDef(neighborId).opaque) continue;
          // 同种半透明方块（水-水、玻璃-玻璃）之间的内部面也剔除
          if (neighborId === id && def.translucent) continue;

          const [u0, v0, u1, v1] = atlas.uv(def.tiles[face.tile]);
          const vertexBase = buf.pos.length / 3;

          for (const corner of face.corners) {
            buf.pos.push(x + corner.pos[0], y + corner.pos[1], z + corner.pos[2]);
            buf.norm.push(dx, dy, dz);
            buf.uv.push(
              u0 + corner.uv[0] * (u1 - u0),
              v0 + corner.uv[1] * (v1 - v0),
            );
          }

          buf.idx.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase + 2, vertexBase + 1, vertexBase + 3);
        }
      }
    }
  }

  return {
    solid: buildGeometry(buffers.solid),
    translucent: buildGeometry(buffers.translucent),
  };
}

function buildGeometry(buf: { pos: number[]; norm: number[]; uv: number[]; idx: number[] }): THREE.BufferGeometry | null {
  if (buf.idx.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.pos), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buf.norm), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf.uv), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buf.idx), 1));
  geometry.computeBoundingSphere();
  return geometry;
}
