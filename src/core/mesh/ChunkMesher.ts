/**
 * 区块网格化
 *
 * 流程：
 *  1. **贪心网格化**：完整立方体方块的 6 个面按「贴图 + 4 个顶点的光照/AO」分组，
 *     在每一层切片上做二维矩形合并，把 n×m 个面塌成一个四边形。
 *     平坦地形（草地、沙漠、岩石面）因此能省下大量三角形。
 *  2. 非完整方块（台阶 / 楼梯 / 栅栏 / 墙 / 门 / 火把 / 梯子 / 玻璃板）仍逐个盒子输出。
 *
 * 其余特性不变：
 *  - 面剔除：只为与空气/非遮挡方块相邻的面生成三角形
 *  - 环境光遮蔽（AO）：顶点级明暗，还原方块交界处的"阴影缝"
 *  - 平滑光照：每个顶点取周围 4 个格子的光照平均值，消除方块间的硬边
 *  - 方向阴影（shade）：复刻原版各朝向的亮度差（顶面最亮、底面最暗）
 *
 * 输出按渲染层拆分：
 *  - solid       ：不透光方块 + 使用 alphaTest 的镂空方块（树叶）
 *  - translucent ：水、玻璃（需要混合与排序）
 *
 * 顶点属性：position(3) / uv(2: **平铺坐标**) / aTile(2: 图集内贴图起点) /
 *          aLight(2: 天光,方块光 归一化) / aShade(1: 方向阴影 × AO)
 *
 * ⚠️ uv 的语义是「平铺坐标」而不是「图集 UV」：单面时落在 [0,1]，贪心合并出的
 * 大四边形则是 [0,w]×[0,h]。着色器取小数部分再叠加半像素内缩，就能把任何尺寸的
 * 面都正确映射回同一张贴图。这也是为什么这里要额外传一个 aTile。
 */

import * as THREE from 'three';
import { Block, blockDef, blockTiles, faceTileOn, pottedPlantTile, type BlockDef } from '../registry/blocks.ts';
// 水浸（批次 469）：状态位在 blockState 里
import { isWaterlogged } from '../registry/blockState.ts';
import {
  FLOWER_POT_RIM,
  canConnectTo,
  canPaneConnectTo,
  canScaffoldConnectTo,
  canTripwireConnectTo,
  isCrossShape,
  isFullBlockShape,
  meshBoxes,
  type LocalBox,
  type ShapeContext,
} from '../registry/blockShapes.ts';
import { FACING_OFFSET, flowerPotPlant, type Facing } from '../registry/blockState.ts';
import { Chunk, SECTION_HEIGHT, SECTION_COUNT, WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';
/**
 * 网格化只需要「贴图在图集中的起点」这一点信息，所以这里只依赖一个最小接口。
 * 好处是离线测试（无 DOM，造不出 TextureAtlas）也能用假实现跑网格化。
 */
export interface TileUvSource {
  tileOrigin(tile: string): [number, number];
}

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

/** 面法线所在的轴 */
function axisOf(dir: readonly [number, number, number]): 0 | 1 | 2 {
  return dir[0] !== 0 ? 0 : dir[1] !== 0 ? 1 : 2;
}

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

/**
 * AO 等级 → 亮度系数（两邻边都遮挡 → 最暗）。
 *
 * 批次 526：整体再压一档（0.55/0.7/0.85 → 0.48/0.65/0.82）。凹角、墙根、洞口
 * 这些"该暗的地方"压得住，方块才像垒起来的；顶上仍是 1.0，不影响受光面。
 */
export const AO_BRIGHTNESS: readonly number[] = [0.48, 0.65, 0.82, 1.0];

/** 由面的法线与顶点位置推导出该顶点的三组 AO 采样偏移 */
function aoOffsetsFor(
  dir: readonly [number, number, number],
  pos: readonly [number, number, number],
): FaceCorner['aoOffsets'] {
  const axis = axisOf(dir);
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
    shade: 0.54,
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
    shade: 0.54,
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
    shade: 0.42,
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
    shade: 0.72,
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
    shade: 0.72,
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

/** uv 的某个分量对应哪个轴、正向还是反向 */
interface UvAxis {
  axis: 0 | 1 | 2;
  sign: 1 | -1;
}

/**
 * 贪心合并时需要用「轴跨度」缩放 uv，所以必须知道 uv 的两个分量各自沿哪个轴。
 * 这个对应关系在不同面上并不一致（+Y 面的 uv.x 沿 +X，而 -X 面的 uv.x 沿 +Z），
 * 所以不能写死，必须在模块加载时从面定义本身推导出来。
 */
interface FaceLayout {
  axis: 0 | 1 | 2;
  uAxis: 0 | 1 | 2;
  vAxis: 0 | 1 | 2;
  positive: boolean;
  uv0: UvAxis;
  uv1: UvAxis;
}

function deriveUvAxis(face: (typeof RAW_FACES)[number], component: 0 | 1, candidates: readonly (0 | 1 | 2)[]): UvAxis {
  for (const axis of candidates) {
    if (face.corners.every((corner) => corner.uv[component] === corner.pos[axis])) return { axis, sign: 1 };
    if (face.corners.every((corner) => corner.uv[component] === 1 - corner.pos[axis])) return { axis, sign: -1 };
  }
  throw new Error('无法从面定义推导 UV 轴');
}

const LAYOUTS: readonly FaceLayout[] = FACES.map((face, index) => {
  const raw = RAW_FACES[index]!;
  const axis = axisOf(face.dir);
  const perp = [0, 1, 2].filter((a) => a !== axis) as (0 | 1 | 2)[];
  const uAxis = perp[0]!;
  const vAxis = perp[1]!;
  return {
    axis,
    uAxis,
    vAxis,
    positive: face.dir[axis]! > 0,
    uv0: deriveUvAxis(raw, 0, [uAxis, vAxis]),
    uv1: deriveUvAxis(raw, 1, [uAxis, vAxis]),
  };
});

function layerOf(id: number): RenderLayer {
  return blockDef(id).translucent ? 'translucent' : 'solid';
}

interface LayerBuffer {
  pos: number[];
  uv: number[];
  tile: number[];
  light: number[];
  shade: number[];
  idx: number[];
}

function newBuffer(): LayerBuffer {
  return { pos: [], uv: [], tile: [], light: [], shade: [], idx: [] };
}

export interface MeshResult {
  solid: THREE.BufferGeometry | null;
  translucent: THREE.BufferGeometry | null;
}

interface EmitContext {
  buf: LayerBuffer;
  def: BlockDef;
  isTranslucent: boolean;
  atlas: TileUvSource;
  ctx: MeshContext;
  originX: number;
  originZ: number;
  sampleBlock: (x: number, y: number, z: number) => number;
}

/** 一个顶点最终的光照/AO（光照用 4 个采样的**和**表示，便于按整数比较） */
interface CornerLight {
  skySum: number;
  blkSum: number;
  /** AO 等级下标（0 最暗 / 3 最亮）；半透明面固定为 3（不做 AO） */
  ao: number;
}

/**
 * 计算一个面某个顶点的光照与 AO。
 * 单面输出和贪心合并共用这段逻辑，保证两条路径的明暗完全一致。
 */
function cornerLighting(
  ctx: MeshContext,
  originX: number,
  originZ: number,
  sampleBlock: (x: number, y: number, z: number) => number,
  isTranslucent: boolean,
  x: number,
  y: number,
  z: number,
  worldY: number,
  face: Face,
  corner: FaceCorner,
  out?: CornerLight,
): CornerLight {
  const [dx, dy, dz] = face.dir;
  const nx = x + dx;
  const nz = z + dz;

  if (isTranslucent) {
    // 流体不做 AO，避免水面出现栅格状阴影
    const sky = ctx.getSkyLight(originX + nx, worldY + dy, originZ + nz);
    const blk = ctx.getBlockLight(originX + nx, worldY + dy, originZ + nz);
    return writeLight(out, sky * 4, blk * 4, 3);
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

  // 平滑光照：4 个采样格取平均；被遮挡的格子用中心格光照替代，避免硬缝
  const l0 = lightOf(ctx, originX + nx, worldY + dy, originZ + nz);
  const l1 = o1o === 1 ? l0 : lightOf(ctx, originX + x + o1[0], worldY + o1[1], originZ + z + o1[2]);
  const l2 = o2o === 1 ? l0 : lightOf(ctx, originX + x + o2[0], worldY + o2[1], originZ + z + o2[2]);
  const l3 =
    o1o === 1 && o2o === 1
      ? l0
      : o3o === 1
        ? (Math.min(lightSky(l1), lightSky(l2)) << 4) | Math.min(lightBlk(l1), lightBlk(l2))
        : lightOf(ctx, originX + x + o3[0], worldY + o3[1], originZ + z + o3[2]);

  return writeLight(
    out,
    lightSky(l0) + lightSky(l1) + lightSky(l2) + lightSky(l3),
    lightBlk(l0) + lightBlk(l1) + lightBlk(l2) + lightBlk(l3),
    aoIndex,
  );
}

/**
 * 输出一个面的 4 个顶点（非贪心路径）。
 *
 * box 是该面所属盒子的局部范围（完整方块为 [0,0,0,1,1,1]），顶点坐标按盒子尺寸插值，
 * 因此同一套面定义既能画完整立方体，也能画台阶 / 楼梯 / 栅栏横杆 / 火把。
 * 顶点顺序与法线方向由 FACES 保证，盒子只缩放不改变绕序。
 */
function emitFace(
  e: EmitContext,
  x: number,
  y: number,
  z: number,
  worldY: number,
  face: Face,
  box: LocalBox,
  precomputed?: readonly CornerLight[],
): void {
  const { buf, def, isTranslucent, atlas, ctx, originX, originZ, sampleBlock } = e;
  // 贴图按**状态**取，面级贴图优先（两者都在 `faceTileOn` 里，与贪心通道共用同一条判定）
  const state = ctx.getBlockState(originX + x, worldY, originZ + z);
  const tile = faceTileOn(def.id, state, face.dir, face.tile);
  const [tileU, tileV] = atlas.tileOrigin(tile);
  const [bx0, by0, bz0, bx1, by1, bz1] = box;

  const vertexBase = buf.pos.length / 3;

  for (let i = 0; i < 4; i++) {
    const corner = face.corners[i]!;
    buf.pos.push(
      x + (corner.pos[0] === 0 ? bx0 : bx1),
      y + (corner.pos[1] === 0 ? by0 : by1),
      z + (corner.pos[2] === 0 ? bz0 : bz1),
    );
    // 平铺坐标：单个面就是 [0,1]
    buf.uv.push(corner.uv[0], corner.uv[1]);
    buf.tile.push(tileU, tileV);

    // 贪心路径已经把 4 个顶点的光照算过一遍（用来判断能否合并），这里直接复用避免重复采样
    const light =
      precomputed?.[i] ?? cornerLighting(ctx, originX, originZ, sampleBlock, isTranslucent, x, y, z, worldY, face, corner);
    buf.light.push(light.skySum / 60, light.blkSum / 60);
    buf.shade.push(face.shade * AO_BRIGHTNESS[light.ao]!);
  }

  buf.idx.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase + 2, vertexBase + 1, vertexBase + 3);
}

/** `emitCross` 的可选覆盖：贴图与竖直范围（花盆里的植物用到） */
interface CrossOptions {
  tile?: string;
  y0?: number;
  y1?: number;
}

/**
 * 植物（十字形状）：两片沿方块对角线竖立的薄面。
 *
 * 为什么不用盒子：草、花、蘑菇都是"两张交叉的贴图"，用盒子会渲染成实心的；
 * 这里直接输出两片四边形，并且**正反两面都输出**——从背面看过去必须可见，
 * 而且植物是双面可见的（原版用 cull=false 做到这一点，这里用反向绕序实现）。
 */
function emitCross(
  e: EmitContext,
  x: number,
  y: number,
  z: number,
  worldY: number,
  options: CrossOptions = {},
): void {
  const { buf, def, atlas, ctx, originX, originZ } = e;
  // 贴图默认取方块自己的（花草），花盆里那株会显式指定
  const tile =
    options.tile ?? blockTiles(def.id, ctx.getBlockState(originX + x, worldY, originZ + z))[2];
  const y0 = options.y0 ?? 0;
  const y1 = options.y1 ?? 1;
  const [tileU, tileV] = atlas.tileOrigin(tile);
  const sky = ctx.getSkyLight(originX + x, worldY, originZ + z);
  const blk = ctx.getBlockLight(originX + x, worldY, originZ + z);

  // 两片面对角线摆放，四边内缩 1/16，避免与相邻方块的面共面导致闪烁
  const planes: readonly (readonly [number, number, number, number])[] = [
    [0.0625, 0.0625, 0.9375, 0.9375],
    [0.0625, 0.9375, 0.9375, 0.0625],
  ];

  for (const [x0, z0, x1, z1] of planes) {
    const vertexBase = buf.pos.length / 3;
    // 顶点顺序：左下 → 右下 → 右上 → 左上。
    // v 的方向与其它面一致：**v=0 在贴图底边**（批次 273 之后 flipY=true，
    // 图集原点就是"贴图左下角"）。曾经这里按"v=0 在顶部"写，草方块侧面修好之后
    // 所有植物就跟着上下颠倒了。
    const corners: readonly (readonly [number, number, number])[] = [
      [x0, y0, z0],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z0],
    ];
    for (let i = 0; i < 4; i++) {
      const corner = corners[i]!;
      buf.pos.push(x + corner[0], y + corner[1], z + corner[2]);
      // 底边（i=0,1）v=0、顶边（i=2,3）v=1 —— 与 `atlasCoords` 的"v=0=贴图底边"一致
      buf.uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
      buf.tile.push(tileU, tileV);
      // 植物不吃 AO，也不做方向性明暗，直接取所在格的平滑光照（与原版一致）
      buf.light.push(sky / 15, blk / 15);
      buf.shade.push(1);
    }
    buf.idx.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase, vertexBase + 2, vertexBase + 3);
    // 反面：顶点顺序反过来，法线朝另一侧
    buf.idx.push(vertexBase + 2, vertexBase + 1, vertexBase, vertexBase + 3, vertexBase + 2, vertexBase);
  }
}

/** 贪心合并后的大四边形：4 个顶点共享同一份光照 */
function emitQuad(
  buf: LayerBuffer,
  atlas: TileUvSource,
  tile: string,
  face: Face,
  layout: FaceLayout,
  axisPos: number,
  u: number,
  v: number,
  w: number,
  h: number,
  light: CornerLight,
): void {
  const [tileU, tileV] = atlas.tileOrigin(tile);
  const vertexBase = buf.pos.length / 3;
  const spanU = layout.uv0.axis === layout.uAxis ? w : h;
  const spanV = layout.uv1.axis === layout.uAxis ? w : h;
  const pos: [number, number, number] = [0, 0, 0];

  for (const corner of face.corners) {
    pos[layout.axis] = axisPos;
    pos[layout.uAxis] = u + corner.pos[layout.uAxis] * w;
    pos[layout.vAxis] = v + corner.pos[layout.vAxis] * h;
    buf.pos.push(pos[0], pos[1], pos[2]);

    const uv0 = layout.uv0.sign > 0 ? corner.pos[layout.uv0.axis] : 1 - corner.pos[layout.uv0.axis];
    const uv1 = layout.uv1.sign > 0 ? corner.pos[layout.uv1.axis] : 1 - corner.pos[layout.uv1.axis];
    buf.uv.push(uv0 * spanU, uv1 * spanV);
    buf.tile.push(tileU, tileV);

    buf.light.push(light.skySum / 60, light.blkSum / 60);
    buf.shade.push(face.shade * AO_BRIGHTNESS[light.ao]!);
  }

  buf.idx.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase + 2, vertexBase + 1, vertexBase + 3);
}

/** 贪心网格化的合并候选：一个面长什么样（贴图 + 4 顶点光照/AO + 渲染层） */
interface FaceGroup {
  tile: string;
  layer: RenderLayer;
  light: CornerLight;
}

/**
 * 对整个 section 里完整立方体方块的面做贪心网格化。
 *
 * 做法：对每个朝向、每个切片层构建一张 16×16 的"面掩码"，
 * 掩码里存的是「贴图 + 4 顶点光照/AO」完全相同的分组 id；
 * 然后在二维掩码上做矩形扩张，把同组的面塌成一个四边形。
 * 光照不同（洞穴边缘、室内）的面不会被强行合并，因此明暗完全保持原样。
 */
function greedyMesh(
  chunk: Chunk,
  baseY: number,
  originX: number,
  originZ: number,
  atlas: TileUvSource,
  ctx: MeshContext,
  buffers: Record<RenderLayer, LayerBuffer>,
): void {
  const sampleBlock = (x: number, y: number, z: number): number => ctx.getBlock(originX + x, baseY + y, originZ + z);
  const mask = new Int32Array(256);
  const groups: FaceGroup[] = [];
  const groupIds = new Map<string, number>();
  /**
   * 4 个顶点光照的**复用对象**（每次网格化要算几十万个顶点）。
   *
   * ⚠️ 复用的前提是"用完就把值拷走"：合并成一组时要 `copyLight(c0)`，
   * 否则下一次迭代会把数组里已经存好的光照改掉（这种错会表现为"光照偶尔闪一下"，
   * 极难查）。`emitFace` 是同步写缓冲的，所以传复用对象是安全的。
   */
  const lightScratch: CornerLight[] = [
    { skySum: 0, blkSum: 0, ao: 3 },
    { skySum: 0, blkSum: 0, ao: 3 },
    { skySum: 0, blkSum: 0, ao: 3 },
    { skySum: 0, blkSum: 0, ao: 3 },
  ];

  for (let faceIndex = 0; faceIndex < FACES.length; faceIndex++) {
    const face = FACES[faceIndex]!;
    const layout = LAYOUTS[faceIndex]!;
    // 只解构用得上的：v 轴由"另外两个轴"推出来（见下面的摊坐标）
    const { axis, uAxis, positive } = layout;

    for (let layer = 0; layer < SECTION_HEIGHT; layer++) {
      mask.fill(0);
      groups.length = 0;
      groupIds.clear();

      for (let v = 0; v < 16; v++) {
        for (let u = 0; u < 16; u++) {
          // 把 (layer, u, v) 摊回 (x, y, z)：不用数组下标，省掉每次迭代的一次分配
          const x = axis === 0 ? layer : uAxis === 0 ? u : v;
          const y = axis === 1 ? layer : uAxis === 1 ? u : v;
          const z = axis === 2 ? layer : uAxis === 2 ? u : v;
          const worldY = baseY + y;

          const id = chunk.get(x, worldY, z);
          if (id === Block.AIR) continue;
          const def = blockDef(id);
          const state = chunk.getState(x, worldY, z);
          if (!isFullBlockShape(def.shape, state)) continue;
          // 带正脸的方块（熔炉/活塞/侦测器/木桶/末影箱/潜影盒，批次 76）也**进**贪心通道了：
          // 合并键里本来就比了贴图，所以"同一面两侧贴图不同"这件事**自动**不会并到一起
          // （朝北的炉子与朝南的炉子，正面那一面的贴图不同 → 键不同 → 各成一组）。
          // 批次 64 当年是整块跳过它们，那让"摆一片炉子"完全用不上合并——
          // 而炉子恰好是最常被摆成一片的方块之一。

          // 面剔除：邻居不透明则本面不可见；同种半透明方块之间的内部面也剔除
          const neighborId = sampleBlock(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          if (blockDef(neighborId).opaque) continue;
          if (neighborId === id && def.translucent) continue;

          const tile = faceTileOn(id, ctx.getBlockState(originX + x, worldY, originZ + z), face.dir, face.tile);
          const layerId = layerOf(id);
          // 四个角直接写进复用对象，不走 `face.corners.map(...)`（那会每面多分配 1 个数组）
          const corners = face.corners;
          const c0 = cornerLighting(
            ctx, originX, originZ, sampleBlock, def.translucent, x, y, z, worldY, face, corners[0]!, lightScratch[0]!,
          );
          const c1 = cornerLighting(
            ctx, originX, originZ, sampleBlock, def.translucent, x, y, z, worldY, face, corners[1]!, lightScratch[1]!,
          );
          const c2 = cornerLighting(
            ctx, originX, originZ, sampleBlock, def.translucent, x, y, z, worldY, face, corners[2]!, lightScratch[2]!,
          );
          const c3 = cornerLighting(
            ctx, originX, originZ, sampleBlock, def.translucent, x, y, z, worldY, face, corners[3]!, lightScratch[3]!,
          );

          // 只有当 4 个顶点的光照/AO 完全一致时才能合并，所以把 4 组值写进 key。
          // 光照用「4 次采样的和」表示（整数 0~60），shade 由 AO 等级决定，都是整数。
          const uniform =
            c1.skySum === c0.skySum &&
            c2.skySum === c0.skySum &&
            c3.skySum === c0.skySum &&
            c1.blkSum === c0.blkSum &&
            c2.blkSum === c0.blkSum &&
            c3.blkSum === c0.blkSum &&
            c1.ao === c0.ao &&
            c2.ao === c0.ao &&
            c3.ao === c0.ao;
          if (!uniform) {
            // 顶点光照不一致时退回逐面输出（不能合并，否则明暗会变）
            const buf = buffers[layerId];
            const emit: EmitContext = {
              buf,
              def,
              isTranslucent: def.translucent,
              atlas,
              ctx,
              originX,
              originZ,
              sampleBlock,
            };
            // 这一路（顶点光照不一致、不能合并）比较少见，这里才建一个小数组
            emitFace(emit, x, y, z, worldY, face, UNIT_BOX, [c0, c1, c2, c3]);
            continue;
          }

          const key = `${tile}|${layerId}|${c0.skySum},${c0.blkSum},${c0.ao}`;
          let groupId = groupIds.get(key);
          if (groupId === undefined) {
            groupId = groups.length + 1;
            groupIds.set(key, groupId);
            // ⚠️ 必须**拷一份**：`c0` 是复用对象，下一次迭代就被改写了
            groups.push({ tile, layer: layerId, light: { skySum: c0.skySum, blkSum: c0.blkSum, ao: c0.ao } });
          }
          mask[u * 16 + v] = groupId;
        }
      }

      // ---- 二维矩形合并
      const axisPos = layer + (positive ? 1 : 0);
      for (let v = 0; v < 16; v++) {
        for (let u = 0; u < 16; ) {
          const groupId = mask[u * 16 + v]!;
          if (groupId === 0) {
            u++;
            continue;
          }

          let w = 1;
          while (u + w < 16 && mask[(u + w) * 16 + v] === groupId) w++;

          let h = 1;
          grow: while (v + h < 16) {
            for (let k = 0; k < w; k++) {
              if (mask[(u + k) * 16 + (v + h)] !== groupId) break grow;
            }
            h++;
          }

          for (let dv = 0; dv < h; dv++) {
            for (let du = 0; du < w; du++) mask[(u + du) * 16 + (v + dv)] = 0;
          }

          const group = groups[groupId - 1]!;
          emitQuad(buffers[group.layer], atlas, group.tile, face, layout, axisPos, u, v, w, h, group.light);
          u += w;
        }
      }
    }
  }
}

/**
 * 对一个 section 生成网格。顶点坐标为 section 局部坐标（x/z ∈ [0,16)，y ∈ [0,16)），
 * 由调用方设置 mesh.position 完成定位。
 */
export function meshSection(
  chunk: Chunk,
  section: number,
  atlas: TileUvSource,
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

  greedyMesh(chunk, baseY, originX, originZ, atlas, ctx, buffers);

  for (let y = 0; y < SECTION_HEIGHT; y++) {
    const worldY = baseY + y;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = chunk.get(x, worldY, z);
        if (id === Block.AIR) continue;

        const def = blockDef(id);
        // 完整立方体（含满格的流体）已经在上面的贪心网格化里处理过。
        // ⚠️ 批次 76（O11）之后**连带正脸的方块也归贪心通道**（合并键里比了贴图，不会并错），
        // 所以这里的判据回到"整格就跳过"。两条通道的判据必须**成对**改——
        // 只改一处的结果是"这个方块一个面都不输出"（方块直接看不见了，批次 64 的原坑）。
        if (isFullBlockShape(def.shape, chunk.getState(x, worldY, z))) continue;

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

        // ---- 植物（十字）：两片交叉薄面，单独走一条路径
        // （`isCrossShape`：`cross` 与下界疣几何一样，见 `blockShapes.ts`）
        if (isCrossShape(def.shape)) {
          emitCross(emit, x, y, z, worldY);
          continue;
        }

        // ---- 水浸（批次 469）：额外输出一层**整格的水**（走半透明通道）
        //
        // 原版的含水方块就是"水填满这一格的剩余空间"，所以这里用整格盒子再画一遍，
        // 而不是跟着方块自己的形状走（跟着形状画，台阶下面那一半是干的，看着像 bug）。
        // 邻居剔除只做"水/含水方块"——它们会自己画那一面，重复画会让 alpha 叠深。
        if (isWaterlogged(chunk.getState(x, worldY, z))) {
          const waterEmit: EmitContext = {
            ...emit,
            buf: buffers.translucent,
            def: blockDef(Block.WATER),
            isTranslucent: true,
          };
          for (const face of FACES) {
            const [dx, dy, dz] = face.dir;
            const neighborId = sampleBlock(x + dx, y + dy, z + dz);
            if (neighborId === Block.WATER) continue;
            if (isWaterlogged(ctx.getBlockState(originX + x + dx, worldY + dy, originZ + z + dz))) continue;
            emitFace(waterEmit, x, y, z, worldY, face, UNIT_BOX);
          }
        }

        // ---- 非完整方块：逐个盒子输出
        // 栅栏/墙的连接方向、楼梯的内角外角都按邻居**实时计算**，
        // 因此旁边放一个新方块后它们会自动长出新的一节 / 变成转角，
        // 不需要在方块变动时反过来更新四周方块的状态。
        const needsConnect =
          def.shape === 'fence' ||
          def.shape === 'wall' ||
          def.shape === 'pane' ||
          def.shape === 'scaffolding' ||
          def.shape === 'tripwire';
        const connectProbe =
          def.shape === 'pane'
            ? canPaneConnectTo
            : def.shape === 'scaffolding'
              ? canScaffoldConnectTo // 脚手架只与脚手架相连（批次 53）
              : def.shape === 'tripwire'
                ? canTripwireConnectTo // 绊线只与绊线/钩子相连（批次 55）
                : canConnectTo;

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

        // 花盆里种的那株植物（批次 52）：盆身已经在下面按盒子输出，
        // 这里再补两片十字薄面（贴图取 `POTTED_PLANTS`，画在盆沿之上）
        if (def.shape === 'flower_pot') {
          const plant = pottedPlantTile(flowerPotPlant(chunk.getState(x, worldY, z)));
          if (plant !== null) {
            emitCross(emit, x, y, z, worldY, { tile: plant, y0: FLOWER_POT_RIM, y1: 1 });
          }
        }

        for (const box of boxes) {
          for (const face of FACES) {
            const axis = axisOf(face.dir);
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

/**
 * 采样一格光照，**打包成一个整数**：天光在高 4 位、方块光在低 4 位。
 *
 * 为什么不用 `[sky, blk]` 元组：这个函数每个角都要调用两次（平滑光照 4 个采样格），
 * 即每个面 8 次、一个区块几万个面——返回数组意味着几万次分配，全落在 GC 上。
 */
function lightOf(ctx: MeshContext, wx: number, wy: number, wz: number): number {
  if (wy < WORLD_MIN_Y || wy >= WORLD_MAX_Y) return wy >= WORLD_MAX_Y ? 15 << 4 : 0;
  return (ctx.getSkyLight(wx, wy, wz) << 4) | ctx.getBlockLight(wx, wy, wz);
}

const lightSky = (packed: number): number => packed >> 4;
const lightBlk = (packed: number): number => packed & 15;

/** 写进（或新建）一个光照结构：热路径传复用对象，省掉每次分配 */
function writeLight(out: CornerLight | undefined, skySum: number, blkSum: number, ao: number): CornerLight {
  if (out) {
    out.skySum = skySum;
    out.blkSum = blkSum;
    out.ao = ao;
    return out;
  }
  return { skySum, blkSum, ao };
}

/** 一层网格的顶点数组 */
export interface GeometryArrays {
  position: Float32Array;
  uv: Float32Array;
  tile: Float32Array;
  /**
   * 光照与明暗（批次 567，N1）：**0~1 的浮点或 0~255 的字节**都可以。
   * 字节属性用 `normalized: true` 上传，GPU 端仍是 0~1，着色器不用改；
   * 每个顶点因此从 12 字节（3 个 float）降到 3 字节。
   */
  light: Float32Array | Uint8Array;
  shade: Float32Array | Uint8Array;
  index: Uint32Array;
}

/** 0~1 浮点 → 0~255 字节；已经是字节就原样返回（Worker 侧不重复量化） */
function quantizeUnit(values: Float32Array | Uint8Array): Uint8Array {
  if (values instanceof Uint8Array) return values;
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return out;
}

/**
 * 顶点数组 → BufferGeometry。
 * 主线程既用它装配本地网格化的结果，也用它重建 Worker 传回来的顶点数据，
 * 两边共用同一套属性布局，避免属性名/分量数对不上。
 */
export function createGeometry(arrays: GeometryArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(arrays.uv, 2));
  geometry.setAttribute('aTile', new THREE.BufferAttribute(arrays.tile, 2));
  // 光照/明暗用归一化字节上传（批次 567，N1）：GPU 端仍是 0~1，着色器不变
  geometry.setAttribute('aLight', new THREE.BufferAttribute(quantizeUnit(arrays.light), 2, true));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(quantizeUnit(arrays.shade), 1, true));
  geometry.setIndex(new THREE.BufferAttribute(arrays.index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildGeometry(buf: LayerBuffer): THREE.BufferGeometry | null {
  if (buf.idx.length === 0) return null;
  return createGeometry({
    position: new Float32Array(buf.pos),
    uv: new Float32Array(buf.uv),
    tile: new Float32Array(buf.tile),
    light: new Float32Array(buf.light),
    shade: new Float32Array(buf.shade),
    index: new Uint32Array(buf.idx),
  });
}
