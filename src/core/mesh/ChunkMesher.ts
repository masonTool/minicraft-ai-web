/**
 * 区块网格化
 *
 * 当前实现：
 *  - 面剔除：只为与空气/非遮挡方块相邻的面生成三角形
 *  - 环境光遮蔽（AO）：顶点级明暗，还原方块交界处的"阴影缝"
 *  - 平滑光照：每个顶点取周围 4 个格子的光照平均值，消除方块间的硬边
 *  - 方向阴影（shade）：复刻原版各朝向的亮度差（顶面最亮、底面最暗）
 *
 * 输出按渲染层拆分：
 *  - solid       ：不透光方块 + 使用 alphaTest 的镂空方块（树叶）
 *  - translucent ：水、玻璃（需要混合与排序）
 *
 * 顶点属性：position(3) / uv(2) / aLight(2: 天光,方块光 归一化) / aShade(1: 方向阴影 × AO)
 * 亮度由着色器按"光照等级 → 曲线"换算，因此昼夜变化只需改一个 uniform，无需重建网格。
 */

import * as THREE from 'three';
import { Block, blockDef, type BlockDef } from '../registry/blocks.ts';
import {
  canConnectTo,
  canPaneConnectTo,
  meshBoxes,
  type LocalBox,
  type ShapeContext,
} from '../registry/blockShapes.ts';
import { FACING_OFFSET, type Facing } from '../registry/blockState.ts';
import { Chunk, SECTION_HEIGHT, SECTION_COUNT, WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';

export type RenderLayer = 'solid' | 'translucent';

/** 网格化时需要从世界取样的数据 */
export interface MeshContext {
  getBlock(worldX: number, worldY: number, worldZ: number): number;
  /** 邻居的方块状态（楼梯判定转角形状用） */
  getBlockState(worldX: number, worldY: number, worldZ: number): number;
  getSkyLight(worldX: number, worldY: number, worldZ: number): number;
  getBlockLight(worldX: number, worldY: number, worldZ: number): number;
}

/** 完整方块的盒子，供统一的面输出函数使用 */
const UNIT_BOX: LocalBox = [0, 0, 0, 1, 1, 1];

interface FaceCorner {
  pos: readonly [number, number, number];
  uv: readonly [number, number];
  /** 相对本方块的三组 AO 采样偏移：[侧边1, 侧边2, 对角] */
  aoOffsets: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
}

interface Face {
  dir: readonly [number, number, number];
  /** 使用顶面 / 底面 / 侧面 贴图：0=顶 1=底 2=侧 */
  tile: 0 | 1 | 2;
  /** 原版方向阴影系数：顶 1.0 / 侧(南北) 0.8 / 侧(东西) 0.6 / 底 0.5 */
  shade: number;
  corners: readonly [FaceCorner, FaceCorner, FaceCorner, FaceCorner];
}

/** AO 等级 → 亮度系数（两邻边都遮挡 → 最暗） */
const AO_BRIGHTNESS: readonly number[] = [0.55, 0.7, 0.85, 1.0];

/** 由面的法线与顶点位置推导出该顶点的三组 AO 采样偏移 */
function aoOffsetsFor(
  dir: readonly [number, number, number],
  pos: readonly [number, number, number],
): FaceCorner['aoOffsets'] {
  const axis = dir[0] !== 0 ? 0 : dir[1] !== 0 ? 1 : 2;
  const perp: number[] = [0, 1, 2].filter((a) => a !== axis);
  const u = perp[0]!;
  const v = perp[1]!;
  const su = pos[u] === 1 ? 1 : -1;
  const sv = pos[v] === 1 ? 1 : -1;

  const make = (ou: number, ov: number): [number, number, number] => {
    const offset: [number, number, number] = [dir[0], dir[1], dir[2]];
    offset[u] += su * ou;
    offset[v] += sv * ov;
    return offset;
  };

  return [make(1, 0), make(0, 1), make(1, 1)];
}

/**
 * 六个面的顶点顺序保证：三角形 (0,1,2) 与 (2,1,3) 的法线朝外，
 * 与 THREE.FrontSide 的逆时针正面约定一致。
 */
const RAW_FACES: readonly {
  dir: readonly [number, number, number];
  tile: 0 | 1 | 2;
  shade: number;
  corners: readonly { pos: readonly [number, number, number]; uv: readonly [number, number] }[];
}[] = [
  {
    // -X（东/西侧面）
    dir: [-1, 0, 0],
    tile: 2,
    shade: 0.6,
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
    shade: 0.6,
    corners: [
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] },
      { pos: [1, 0, 0], uv: [1, 0] },
    ],
  },
  {
    // -Y（底面，最暗）
    dir: [0, -1, 0],
    tile: 1,
    shade: 0.5,
    corners: [
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] },
      { pos: [0, 0, 0], uv: [0, 1] },
    ],
  },
  {
    // +Y（顶面，最亮）
    dir: [0, 1, 0],
    tile: 0,
    shade: 1.0,
    corners: [
      { pos: [0, 1, 1], uv: [1, 1] },
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 0] },
    ],
  },
  {
    // -Z（北侧面）
    dir: [0, 0, -1],
    tile: 2,
    shade: 0.8,
    corners: [
      { pos: [1, 0, 0], uv: [0, 0] },
      { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 1] },
    ],
  },
  {
    // +Z（南侧面）
    dir: [0, 0, 1],
    tile: 2,
    shade: 0.8,
    corners: [
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] },
      { pos: [1, 1, 1], uv: [1, 1] },
    ],
  },
];

/** 预计算 AO 采样偏移，避免每帧重复推导 */
const FACES: readonly Face[] = RAW_FACES.map((face) => ({
  dir: face.dir,
  tile: face.tile,
  shade: face.shade,
  corners: face.corners.map((corner) => ({
    pos: corner.pos,
    uv: corner.uv,
    aoOffsets: aoOffsetsFor(face.dir, corner.pos),
  })) as unknown as Face['corners'],
}));

function layerOf(id: number): RenderLayer {
  return blockDef(id).translucent ? 'translucent' : 'solid';
}

interface LayerBuffer {
  pos: number[];
  uv: number[];
  light: number[];
  shade: number[];
  idx: number[];
}

function newBuffer(): LayerBuffer {
  return { pos: [], uv: [], light: [], shade: [], idx: [] };
}

export interface MeshResult {
  solid: THREE.BufferGeometry | null;
  translucent: THREE.BufferGeometry | null;
}

interface EmitContext {
  buf: LayerBuffer;
  def: BlockDef;
  isTranslucent: boolean;
  atlas: TextureAtlas;
  ctx: MeshContext;
  originX: number;
  originZ: number;
  sampleBlock: (x: number, y: number, z: number) => number;
}

/**
 * 输出一个面的 4 个顶点。
 *
 * box 是该面所属盒子的局部范围（完整方块为 [0,0,0,1,1,1]），顶点坐标按盒子尺寸插值，
 * 因此同一套面定义既能画完整立方体，也能画台阶 / 楼梯 / 栅栏横杆 / 火把。
 * 顶点顺序与法线方向由 FACES 保证，盒子只缩放不改变绕序。
 */
function emitFace(e: EmitContext, x: number, y: number, z: number, worldY: number, face: Face, box: LocalBox): void {
  const { buf, def, isTranslucent, atlas, ctx, originX, originZ, sampleBlock } = e;
  const [u0, v0, u1, v1] = atlas.uv(def.tiles[face.tile]);
  const [bx0, by0, bz0, bx1, by1, bz1] = box;

  const [dx, dy, dz] = face.dir;
  const nx = x + dx;
  const nz = z + dz;
  const vertexBase = buf.pos.length / 3;

  for (const corner of face.corners) {
    buf.pos.push(
      x + (corner.pos[0] === 0 ? bx0 : bx1),
      y + (corner.pos[1] === 0 ? by0 : by1),
      z + (corner.pos[2] === 0 ? bz0 : bz1),
    );
    buf.uv.push(u0 + corner.uv[0] * (u1 - u0), v0 + corner.uv[1] * (v1 - v0));

    if (isTranslucent) {
      // 流体不做 AO，避免水面出现栅格状阴影
      const sky = ctx.getSkyLight(originX + nx, worldY + dy, originZ + nz);
      const blk = ctx.getBlockLight(originX + nx, worldY + dy, originZ + nz);
      buf.light.push(sky / 15, blk / 15);
      buf.shade.push(face.shade);
      continue;
    }

    const [o1, o2, o3] = corner.aoOffsets;
    const b1 = sampleBlock(x + o1[0], y + o1[1], z + o1[2]);
    const b2 = sampleBlock(x + o2[0], y + o2[1], z + o2[2]);
    const b3 = sampleBlock(x + o3[0], y + o3[1], z + o3[2]);
    const o1o = blockDef(b1).opaque ? 1 : 0;
    const o2o = blockDef(b2).opaque ? 1 : 0;
    const o3o = blockDef(b3).opaque ? 1 : 0;

    // AO 等级：两邻边同时遮挡时取最暗
    const aoIndex = o1o === 1 && o2o === 1 ? 0 : 3 - (o1o + o2o + o3o);
    const ao = AO_BRIGHTNESS[aoIndex]!;

    // 平滑光照：4 个采样格取平均；被遮挡的格子用中心格光照替代，避免硬缝
    const l0 = lightOf(ctx, originX + nx, worldY + dy, originZ + nz);
    const l1 = o1o === 1 ? l0 : lightOf(ctx, originX + x + o1[0], worldY + o1[1], originZ + z + o1[2]);
    const l2 = o2o === 1 ? l0 : lightOf(ctx, originX + x + o2[0], worldY + o2[1], originZ + z + o2[2]);
    const l3 =
      o1o === 1 && o2o === 1
        ? l0
        : o3o === 1
          ? ([Math.min(l1[0], l2[0]), Math.min(l1[1], l2[1])] as const)
          : lightOf(ctx, originX + x + o3[0], worldY + o3[1], originZ + z + o3[2]);

    buf.light.push((l0[0] + l1[0] + l2[0] + l3[0]) / 60, (l0[1] + l1[1] + l2[1] + l3[1]) / 60);
    buf.shade.push(face.shade * ao);
  }

  buf.idx.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase + 2, vertexBase + 1, vertexBase + 3);
}

/**
 * 对一个 section 生成网格。顶点坐标为 section 局部坐标（x/z ∈ [0,16)，y ∈ [0,16)），
 * 由调用方设置 mesh.position 完成定位。
 */
export function meshSection(
  chunk: Chunk,
  section: number,
  atlas: TextureAtlas,
  ctx: MeshContext,
): MeshResult {
  if (section < 0 || section >= SECTION_COUNT) return { solid: null, translucent: null };
  if (chunk.sectionIsEmpty(section)) return { solid: null, translucent: null };

  const buffers: Record<RenderLayer, LayerBuffer> = { solid: newBuffer(), translucent: newBuffer() };

  const baseY = Chunk.sectionMinY(section);
  const originX = chunk.cx * 16;
  const originZ = chunk.cz * 16;

  // AO/光照采样：把 section 局部坐标转成世界坐标后统一走 ctx
  const sampleBlock = (x: number, y: number, z: number): number =>
    ctx.getBlock(originX + x, baseY + y, originZ + z);

  for (let y = 0; y < SECTION_HEIGHT; y++) {
    const worldY = baseY + y;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = chunk.get(x, worldY, z);
        if (id === Block.AIR) continue;

        const def = blockDef(id);
        const emit: EmitContext = {
          buf: buffers[layerOf(id)],
          def,
          isTranslucent: def.translucent,
          atlas,
          ctx,
          originX,
          originZ,
          sampleBlock,
        };

        if (def.shape === 'cube') {
          for (const face of FACES) {
            const [dx, dy, dz] = face.dir;
            const neighborId = sampleBlock(x + dx, y + dy, z + dz);
            // 遮挡剔除：邻居不透明则本面不可见
            if (blockDef(neighborId).opaque) continue;
            // 同种半透明方块（水-水、玻璃-玻璃）之间的内部面也剔除
            if (neighborId === id && def.translucent) continue;
            emitFace(emit, x, y, z, worldY, face, UNIT_BOX);
          }
          continue;
        }

        // ---- 非完整方块：逐个盒子输出
        // 栅栏/墙的连接方向、楼梯的内角外角都按邻居**实时计算**，
        // 因此旁边放一个新方块后它们会自动长出新的一节 / 变成转角，
        // 不需要在方块变动时反过来更新四周方块的状态。
        const needsConnect = def.shape === 'fence' || def.shape === 'wall' || def.shape === 'pane';
        const connectProbe = def.shape === 'pane' ? canPaneConnectTo : canConnectTo;

        const shapeCtx: ShapeContext = needsConnect
          ? {
              connect: (facing: Facing): boolean => {
                const [cx, cz] = FACING_OFFSET[facing]!;
                return connectProbe(sampleBlock(x + cx, y, z + cz));
              },
            }
          : def.shape === 'stairs'
              ? {
                  neighbor: (dx, dy, dz) => {
                    const id = sampleBlock(x + dx, y + dy, z + dz);
                    if (id === Block.AIR) return null;
                    return {
                      id,
                      // 相邻格可能属于别的区块，状态要按世界坐标取
                      state: ctx.getBlockState(originX + x + dx, worldY + dy, originZ + z + dz),
                      stairs: blockDef(id).shape === 'stairs',
                    };
                  },
                }
              : {};

        const boxes = meshBoxes(def.shape, chunk.getState(x, worldY, z), shapeCtx);

        for (const box of boxes) {
          for (const face of FACES) {
            const axis = face.dir[0] !== 0 ? 0 : face.dir[1] !== 0 ? 1 : 2;
            const positive = face.dir[axis]! > 0;
            // 只有贴合体素边界的面才做邻居剔除；盒子内部的面（如台阶顶面）必须保留
            const bound = positive ? box[axis + 3]! : box[axis]!;
            const onBoundary = positive ? bound >= 1 - 1e-6 : bound <= 1e-6;
            if (onBoundary) {
              const [dx, dy, dz] = face.dir;
              if (blockDef(sampleBlock(x + dx, y + dy, z + dz)).opaque) continue;
            }
            emitFace(emit, x, y, z, worldY, face, box);
          }
        }
      }
    }
  }

  return {
    solid: buildGeometry(buffers.solid),
    translucent: buildGeometry(buffers.translucent),
  };
}

function lightOf(ctx: MeshContext, wx: number, wy: number, wz: number): [number, number] {
  if (wy < WORLD_MIN_Y || wy >= WORLD_MAX_Y) return wy >= WORLD_MAX_Y ? [15, 0] : [0, 0];
  return [ctx.getSkyLight(wx, wy, wz), ctx.getBlockLight(wx, wy, wz)];
}

function buildGeometry(buf: LayerBuffer): THREE.BufferGeometry | null {
  if (buf.idx.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.pos), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf.uv), 2));
  geometry.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(buf.light), 2));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(buf.shade), 1));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buf.idx), 1));
  geometry.computeBoundingSphere();
  return geometry;
}
