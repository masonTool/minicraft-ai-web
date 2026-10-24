/**
 * 渲染与第一人称体验（E13 粒子 / E15 手持物品 / E16 视野效果）离线测试
 *
 * 覆盖：
 *  1. 图集几何工具：UV 与逐面明暗写对了没有（掉落物与手持物品共用这套）
 *  2. 粒子系统：生成数量、按类型区分、重力方向（碎块落、烟上升）、
 *     寿命淘汰、池子上限、只上传活跃粒子、清空
 *  3. 视野效果：预设映射、平滑过渡与帧率无关性、回到无色、立即到位
 *  4. 手持物品：切物品、挥手动画的时间窗与位移、亮度同步
 *  5. 盔甲外观（E14）：三个部位的甲片独立显隐、换材质换色、亮度不累积；
 *     第一人称只画胸甲袖套（其余三件在镜头盲区）
 *
 * 说明：这些对象在 Node 里可以正常构造 —— `THREE.Points` / `ShaderMaterial` /
 * `BufferGeometry` 都是纯 CPU 对象，只有真正 `render()` 才需要 WebGL 上下文；
 * `HandRenderer` 需要的图集在这里用一个桩对象替代（它只用到 uv 与 texture 两个成员）。
 *
 * 运行：npm run test:render
 */

import * as THREE from 'three';
import { Block, blockDef } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  ATLAS_ANISOTROPY_DESKTOP,
  ATLAS_ANISOTROPY_MOBILE,
  FOLIAGE_DARKEN,
  TILE_SIZE as TILE_PIXELS,
  clampAnisotropy,
  foliage,
  paintedCoverage,
  paintedEdgeOpaque,
  paintedThinColumns,
  type TextureAtlas,
} from '../src/render/TextureAtlas.ts';
import { applyFaceShade, applyFaceUvs, blockFaceTiles, FACE_SHADE } from '../src/render/atlasMesh.ts';
import { PARTICLE_POOL, ParticleSystem } from '../src/render/ParticleSystem.ts';
import { ScreenEffects } from '../src/render/ScreenEffects.ts';
import { HandRenderer } from '../src/render/HandRenderer.ts';
import { PlayerRenderer } from '../src/render/PlayerRenderer.ts';
import { SHEARED_BODY_COLOR, mobBodyColor } from '../src/render/MobRenderer.ts';
import { Mob } from '../src/core/entity/Mob.ts';
import { mobTypeById } from '../src/core/entity/mobs.ts';
import { BlockOverlay, DAMAGE_STAGES, facesWithInwardWinding } from '../src/render/BlockOverlay.ts';
import { buildOutlineGeometry } from '../src/render/BlockOutline.ts';
import { applyBoxFaceShade } from '../src/render/boxShading.ts';
import { MobHealthBar } from '../src/render/MobHealthBar.ts';
import { FLUID_TILE_SLOTS, SHADE_COOL, SHADE_WARM, VoxelMaterial } from '../src/render/VoxelMaterial.ts';
import { ALPHA_DITHER_BAND, ALPHA_LIFT_MAX_LOD, ALPHA_LIFT_PER_LOD, coverageAlpha } from '../src/render/alphaCoverage.ts';
import { GLSL_DITHER } from '../src/render/dither.ts';
import { readFileSync } from 'node:fs';
import { srgbColor } from '../src/render/srgb.ts';
import { tileOriginAt, tileRectAt, tileSpanAt } from '../src/render/atlasCoords.ts';
import { ATLAS_COLUMNS, TILE_ORDER, TILE_PADDING, TILE_SIZE, TILE_STRIDE } from '../src/render/atlasLayout.ts';
import { ChunkRenderer } from '../src/render/ChunkRenderer.ts';
import { createGeometry } from '../src/core/mesh/ChunkMesher.ts';
import type { MeshWorkerPool } from '../src/render/MeshWorkerPool.ts';
import { Chunk } from '../src/core/world/Chunk.ts';
import type { World } from '../src/core/world/World.ts';
import type { MeshResponse } from '../src/worker/chunk.worker.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

// ---------------------------------------------------------------- 区块异步重建不能闪空

console.log('\n[区块网格原子替换]');
{
  const chunk = new Chunk(0, 0);
  chunk.set(0, 64, 0, Block.STONE);
  const world = {
    getChunk: (cx: number, cz: number) => (cx === 0 && cz === 0 ? chunk : undefined),
  } as unknown as World;
  const callbacks: Array<(response: MeshResponse) => void> = [];
  const pool = {
    size: 1,
    request: (
      _cx: number,
      _cz: number,
      _chunks: unknown,
      _transfer: unknown,
      onDone: (response: MeshResponse) => void,
    ) => callbacks.push(onDone),
  } as unknown as MeshWorkerPool;
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const renderer = new ChunkRenderer(
    scene,
    {} as TextureAtlas,
    world,
    material,
    material,
    pool,
  );
  const response = (sections: MeshResponse['sections']): MeshResponse => ({
    type: 'meshed',
    id: 1,
    cx: 0,
    cz: 0,
    sections,
  });
  const triangle = {
    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uv: new Float32Array(6),
    tile: new Float32Array(6),
    light: new Uint8Array(6),
    shade: new Uint8Array(3),
    index: new Uint32Array([0, 1, 2]),
  };

  renderer.onChunkLoaded(0, 0);
  renderer.processQueue(1, 0, 0);
  callbacks.shift()!(response([{ section: 8, solid: triangle, translucent: null }]));
  equal('首版网格已显示', renderer.chunkMeshCount, 1);

  renderer.enqueueAround(1, 1);
  renderer.processQueue(1, 0, 0);
  equal('Worker 重建期间旧网格仍留在场景里（不会整块闪空）', renderer.chunkMeshCount, 1);
  equal('场景里仍有旧网格', scene.children.length, 1);

  callbacks.shift()!(response([]));
  equal('空的新结果就绪后才移除旧网格', renderer.chunkMeshCount, 0);
  equal('旧几何已从场景释放', scene.children.length, 0);
  renderer.disposeAll();
  material.dispose();
}

/** 按贴图名给出固定 UV 的桩图集：石头在 (0,0)-(0.25,0.25)，草方块各面各占一格 */
const TILE_RECTS: Record<string, [number, number, number, number]> = {
  stone: [0, 0, 0.25, 0.25],
  grass_top: [0.25, 0, 0.5, 0.25],
  grass_side: [0.5, 0, 0.75, 0.25],
  dirt: [0.75, 0, 1, 0.25],
  item_stick: [0, 0.25, 0.25, 0.5],
};

/**
 * 桩图集的"不透明内容"包围盒（批次 20261024-1726 起 `HandRenderer` 用它对齐手心）。
 *
 * 棒子故意给一块**不在正中**的内容（左 2 / 上 2 / 右 14 / 下 12），
 * 这样"底边对齐"和"整块居中"两种口径能测出区别。
 */
const TILE_CONTENT: Record<string, { left: number; top: number; right: number; bottom: number }> = {
  item_stick: { left: 2, top: 2, right: 14, bottom: 12 },
};
const FULL_TILE_CONTENT = { left: 0, top: 0, right: 16, bottom: 16 };

/**
 * 桩图集的像素：只给 `item_stick` 画一条**对角线**（从 (2,2) 到 (13,11)），
 * 正好落在 `TILE_CONTENT.item_stick` 的框里。
 *
 * 为什么要给像素：手持扁平物品的 2.5D 贴图要从图标像素烘出来（`heldSprite.ts`）。
 * ⚠️ 但烘贴图要 DOM（canvas），离线测试里没有 → 这条路径在测试里必然退回薄盒子，
 * 所以下面关于扁平物品的断言测的是**退路**（尺寸/对齐/UV 口径），贴图本身靠手测。
 */
function stubTilePixels(tile: string): Uint8ClampedArray {
  const size = 16;
  const data = new Uint8ClampedArray(size * size * 4);
  const paint = (x: number, y: number): void => {
    const index = (y * size + x) * 4;
    data[index] = 200;
    data[index + 1] = 200;
    data[index + 2] = 200;
    data[index + 3] = 255;
  };
  if (tile === 'item_stick') {
    for (let i = 0; i < 10; i++) paint(2 + i, 2 + i);
    for (let i = 10; i < 12; i++) paint(2 + i, 11);
  }
  return data;
}

const stubAtlas = {
  texture: new THREE.Texture(),
  columns: 16,
  rows: 18,
  uv(tile: string): [number, number, number, number] {
    return TILE_RECTS[tile] ?? [0, 0, 0, 0];
  },
  contentBounds(tile: string) {
    return TILE_CONTENT[tile] ?? FULL_TILE_CONTENT;
  },
  readTile(tile: string) {
    return { width: 16, height: 16, data: stubTilePixels(tile) };
  },
  /** 破坏裂纹叠加层要用它换算贴图起点 */
  tileOrigin(tile: string): [number, number] {
    const rect = TILE_RECTS[tile];
    return rect ? [rect[0], rect[1]] : [0, 0];
  },
  /** 破坏裂纹叠加层还要用它算"一张贴图占多大"（批次 520：不能再用 1/columns 手算） */
  tileSpan: [0.25, 0.25] as [number, number],
} as unknown as TextureAtlas;

/** 读某个面第 `corner` 个顶点的 UV */
function faceUv(geometry: THREE.BufferGeometry, face: number, corner: number): [number, number] {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  return [uv.getX(face * 4 + corner), uv.getY(face * 4 + corner)];
}

function colored(geometry: THREE.BufferGeometry, corner: number): number {
  // 批次 567：aShade 可能是归一化字节，`getX` 已经自动还原成 0~1
  return (geometry.getAttribute('aShade') as THREE.BufferAttribute).getX(corner);
}

/** 顶点属性是 Float32，比较明暗值时必须带容差 */
function close(a: number, b: number, epsilon = 1e-5): boolean {
  return Math.abs(a - b) <= epsilon;
}

// ---------------------------------------------------------------- 1. 图集几何工具

console.log('\n[图集几何工具：UV 与逐面明暗]');
{
  const box = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  applyFaceUvs(box, stubAtlas, ['stone', 'stone', 'stone', 'stone', 'stone', 'stone']);

  const [u0, v0, u1, v1] = TILE_RECTS.stone!;
  const corners = [0, 1, 2, 3].map((c) => faceUv(box, 0, c));
  check(
    'UV 写入的四个角与贴图矩形一致（不镜像）',
    corners[0]![0] === u0 && corners[0]![1] === v1 &&
      corners[1]![0] === u1 && corners[1]![1] === v1 &&
      corners[2]![0] === u0 && corners[2]![1] === v0 &&
      corners[3]![0] === u1 && corners[3]![1] === v0,
    corners.map((c) => `(${c[0]},${c[1]})`).join(' '),
  );

  // 每个面都要落在自己的矩形里，不能六个面全用第一张
  applyFaceUvs(box, stubAtlas, ['stone', 'grass_top', 'grass_side', 'dirt', 'stone', 'stone']);
  check('不同面可以取不同贴图', faceUv(box, 2, 0)[0] === TILE_RECTS.grass_side![0], String(faceUv(box, 2, 0)[0]));
  check('第 3 个面取到 grass_top', faceUv(box, 1, 0)[0] === TILE_RECTS.grass_top![0]);

  // ---- 图集坐标（批次 273）：flipY=true 下 v=0 是画布底边
  //
  // 回归点：草方块侧面的画法把草画在画布**顶部**（grass_side 的 y<3）。
  // 侧面几何体的底边顶点 uv.y=0、顶边=1；只有当 v=0 对应画布底边时，
  // 顶边才会采到草。曾经关掉 flipY 之后整张贴图上下颠倒，草长到了脚下。
  const rows = Math.ceil(TILE_ORDER.length / ATLAS_COLUMNS);
  const grassIndex = TILE_ORDER.indexOf('grass_side');
  const grassRow = Math.floor(grassIndex / ATLAS_COLUMNS);
  const [originU, originV] = tileOriginAt(grassIndex, ATLAS_COLUMNS, rows);
  check(
    '草方块侧面的图集原点在贴图底边（不是顶边）',
    grassIndex >= 0 &&
      Math.abs(originU - (grassIndex % ATLAS_COLUMNS) / ATLAS_COLUMNS) < 1e-12 &&
      Math.abs(originV - (1 - (grassRow + 1) / rows)) < 1e-12,
    `origin=${originU},${originV} row=${grassRow}/${rows}`,
  );
  const spanV = 1 / rows;
  check(
    '侧面底边顶点采到贴图底边、顶边顶点采到贴图顶边（草在上）',
    Math.abs(originV + 0 * spanV - (1 - (grassRow + 1) / rows)) < 1e-12 &&
      Math.abs(originV + 1 * spanV - (1 - grassRow / rows)) < 1e-12 &&
      originV < originV + spanV,
  );
  // 内缩用真实量级（半像素 ≈ 0.0005），不能用 0.01——那已经接近半张贴图了
  const rect = tileRectAt(grassIndex, ATLAS_COLUMNS, rows, 0.001, 0.001);
  check(
    'uv() 的矩形是左下 → 右上，且两轴向内收缩',
    rect[1] > 1 - (grassRow + 1) / rows &&
      rect[3] < 1 - grassRow / rows &&
      rect[0] > (grassIndex % ATLAS_COLUMNS) / ATLAS_COLUMNS &&
      rect[2] < (grassIndex % ATLAS_COLUMNS + 1) / ATLAS_COLUMNS &&
      rect[1] < rect[3],
    rect.map((v) => v.toFixed(4)).join(','),
  );

  // ---- 上传图集的**边距**（批次 520）：每格 32 纹素，内容 16 居中
  //
  // 加边距是为了各向异性过滤：取样足迹沿长轴会跨出这张贴图，紧挨着排就会把邻居
  // 的颜色混进来（砖缝处出现彩色细线）。这里钉住三件事：内容区还是 16 纹素宽、
  // 内容区的**中心**与不加边距时完全重合（所以不会整体偏移）、跨度是 16 的整数倍
  // （保证 0~4 级 mip 的纹素边界仍与格子对齐）。
  {
    const pad = TILE_PADDING;
    const [paddedU, paddedV] = tileOriginAt(grassIndex, ATLAS_COLUMNS, rows, pad);
    const [padSpanU, padSpanV] = tileSpanAt(ATLAS_COLUMNS, rows, pad);
    const [plainU, plainV] = tileOriginAt(grassIndex, ATLAS_COLUMNS, rows);
    const [plainSpanU, plainSpanV] = tileSpanAt(ATLAS_COLUMNS, rows);

    check('边距后内容区仍是 16 纹素宽', Math.abs(padSpanU * ATLAS_COLUMNS * TILE_STRIDE - TILE_SIZE) < 1e-9);
    check(
      '内容区中心与不加边距时重合（不会整体偏移）',
      Math.abs(paddedU + padSpanU / 2 - (plainU + plainSpanU / 2)) < 1e-12 &&
        Math.abs(paddedV + padSpanV / 2 - (plainV + plainSpanV / 2)) < 1e-12,
    );
    check(
      '内容区落在自己格子里（边距没跑到邻居那格）',
      paddedU > (grassIndex % ATLAS_COLUMNS) / ATLAS_COLUMNS &&
        paddedU + padSpanU < (grassIndex % ATLAS_COLUMNS + 1) / ATLAS_COLUMNS,
      `${paddedU.toFixed(5)} + ${padSpanU.toFixed(5)}`,
    );
    check('格子跨度是 16 的整数倍（mip 每级都还是整数像素）', TILE_STRIDE % TILE_SIZE === 0);
    // 内缩后仍应严格落在内容区内部（aniso 不会直接采到边距，但保守起见要成立）
    const paddedRect = tileRectAt(grassIndex, ATLAS_COLUMNS, rows, 0.5 / (ATLAS_COLUMNS * TILE_STRIDE), 0.5 / (rows * TILE_STRIDE), pad);
    check(
      '内容区矩形仍向内收缩且顺序正确',
      paddedRect[0] > paddedU && paddedRect[2] < paddedU + padSpanU && paddedRect[1] < paddedRect[3],
      paddedRect.map((v) => v.toFixed(5)).join(','),
    );
  }

  // ---- 各向异性档位（批次 520）
  check('0/负数/NaN 都落到 1（GL 里 0 是非法值）', [0, -3, Number.NaN].every((v) => clampAnisotropy(v) === 1));
  equal('4 原样保留', clampAnisotropy(4), 4);
  equal('过大被夹到 16', clampAnisotropy(999), 16);
  check('手机档不超过桌面档', ATLAS_ANISOTROPY_MOBILE <= ATLAS_ANISOTROPY_DESKTOP);
  // 4× 的足迹约 ±2 纹素、8× 约 ±4：边距必须罩得住，否则侧视时会采到邻居贴图
  check(
    '边距罩得住桌面档的取样足迹（每侧 ≥ 档位/2 纹素）',
    TILE_PADDING * 2 >= ATLAS_ANISOTROPY_DESKTOP,
    `padding ${TILE_PADDING} vs ${ATLAS_ANISOTROPY_DESKTOP}×`,
  );

  check('blockFaceTiles 返回六张贴图且顺序为 [侧,侧,顶,底,侧,侧]', (() => {
    const tiles = blockDef(Block.GRASS_BLOCK).tiles;
    const faces = blockFaceTiles(Block.GRASS_BLOCK);
    return faces.length === 6 && faces[2] === tiles[0] && faces[3] === tiles[1] && faces[0] === tiles[2];
  })());

  applyFaceShade(box, FACE_SHADE);
  check(
    '逐面明暗：顶面最亮、底面最暗、侧面居中（批次 524 加深）',
    close(colored(box, 8), 1) && close(colored(box, 12), 0.42) && close(colored(box, 0), 0.54) && close(colored(box, 20), 0.72),
    `顶 ${colored(box, 8)} / 底 ${colored(box, 12)} / 侧 ${colored(box, 0)}`,
  );

  const plane = new THREE.PlaneGeometry(0.3, 0.3);
  applyFaceShade(plane, [1]);
  check('平面几何体也能写亮度（只有一个面）', close(colored(plane, 0), 1) && close(colored(plane, 3), 1));
}

// ---------------------------------------------------------------- 2. 粒子系统

console.log('\n[粒子系统：生成 / 重力 / 淘汰 / 上限]');
{
  const particles = new ParticleSystem();
  check('初始没有粒子', particles.active === 0);

  particles.spawnBlockBreak(10.5, 64.5, 3.5, 0x7a5a3a, 10);
  check('破坏粒子按数量生成', particles.active === 10, String(particles.active));
  check('破坏粒子被归类为 block', particles.debugSnapshot().byKind.block === 10);

  const spanned = particles.debugSnapshot().positions;
  let inRange = true;
  for (let i = 0; i < 10; i++) {
    if (Math.abs(spanned[i * 3]! - 10.5) > 1 || Math.abs(spanned[i * 3 + 1]! - 64.5) > 1) inRange = false;
  }
  check('粒子生成在破坏点附近（1 格内）', inRange);

  particles.update(0.5);
  const fallen = particles.debugSnapshot().positions;
  let averageY = 0;
  for (let i = 0; i < 10; i++) averageY += fallen[i * 3 + 1]!;
  averageY /= 10;
  check('碎块受重力下落', averageY < 64.5 - 0.2, `0.5 秒后平均 y=${averageY.toFixed(2)}`);

  particles.update(1.0);
  check('寿命耗尽后自动回收', particles.active === 0, String(particles.active));

  // 烟要往上飘（重力为负）。取 0.5 秒：短于最短寿命（0.8），因此这一批必然全部存活
  particles.spawnSmoke(0.5, 70.5, 0.5, 6);
  particles.update(0.5);
  const smoke = particles.debugSnapshot();
  check('烟雾全部存活（寿命比碎块长）', smoke.count === 6, String(smoke.count));
  let smokeY = 0;
  for (let i = 0; i < smoke.count; i++) smokeY += smoke.positions[i * 3 + 1]!;
  if (smoke.count > 0) smokeY /= smoke.count;
  check('烟雾向上飘', smokeY > 70.5, `平均 y=${smokeY.toFixed(2)}`);
  particles.clear();
  check('clear() 清空全部粒子', particles.active === 0 && particles.debugSnapshot().count === 0);

  // 池子上限：超出容量时丢弃新粒子，不会挤掉旧粒子、也不会越界
  for (let i = 0; i < 200; i++) particles.spawnBlockBreak(0.5, 64.5, 0.5, 0xffffff, 14);
  check('粒子数不超过池子容量', particles.active === PARTICLE_POOL, `${particles.active} / ${PARTICLE_POOL}`);
  check('池子满了之后仍需保持 BufferGeometry 与粒子数一致', (() => {
    const points = particles.object.children[0] as THREE.Points;
    const position = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    return position.count === PARTICLE_POOL;
  })());

  particles.clear();
  particles.spawnCrit(1.5, 65.5, 2.5, 4);
  particles.spawnSplash(1.5, 62.5, 2.5);
  particles.spawnFlame(1.5, 40.5, 2.5);
  particles.spawnDigging(1.5, 41.5, 2.5, 0x888888);
  const mixed = particles.debugSnapshot();
  check(
    '五类粒子都能生成并各自归类',
    mixed.byKind.crit === 4 && mixed.byKind.splash === 12 && mixed.byKind.flame === 1 && mixed.byKind.digging === 2,
    JSON.stringify(mixed.byKind),
  );

  // 批次 241：挖掘碎屑必须从**命中面**往外溅——旧版从格心撒，整簇闷在不透明方块里看不见
  particles.clear();
  particles.spawnDigging(10.5, 65, 3.5, 0x888888, 0, 1, 0, 3);
  {
    const snapshot = particles.debugSnapshot();
    let minY = Number.POSITIVE_INFINITY;
    for (let i = 0; i < snapshot.count; i++) minY = Math.min(minY, snapshot.positions[i * 3 + 1]!);
    check(
      '挖掘碎屑全部生成在方块顶面之外（不再闷在方块里）',
      snapshot.byKind.digging === 3 && minY > 65,
      `最低 y=${minY.toFixed(3)}`,
    );
  }

  particles.update(0.016);
  const points = particles.object.children[0] as THREE.Points;
  check(
    '只上传活跃粒子（drawRange = 存活数）',
    points.geometry.drawRange.count === particles.active,
    `drawRange ${points.geometry.drawRange.count} vs ${particles.active}`,
  );

  const colorAttr = points.geometry.getAttribute('aColor') as THREE.BufferAttribute;
  check('颜色与透明度属性都在', colorAttr.count === PARTICLE_POOL && points.geometry.getAttribute('aAlpha') !== undefined);

  // ---- 批次 171（E22）新增的四类：爆炸闪光 / 气泡柱 / 雨滴溅落 / 红石尘
  particles.clear();
  particles.spawnExplosion(0.5, 64.5, 0.5, 3);
  equal('爆炸闪光按威力折算数量（3 → 30 颗）', particles.debugSnapshot().byKind.explosion, 30);
  particles.update(0.1);
  {
    const spread = particles.debugSnapshot().positions;
    let maxDistance = 0;
    for (let i = 0; i < 30; i++) {
      maxDistance = Math.max(maxDistance, Math.hypot(spread[i * 3]! - 0.5, spread[i * 3 + 2]! - 0.5));
    }
    check('爆炸碎片向四周炸开（不是原地冒烟）', maxDistance > 0.3, `最远 ${maxDistance.toFixed(2)} 格`);
  }

  particles.clear();
  particles.spawnBubble(0.5, 60.5, 0.5, 4);
  equal('气泡归到 bubble', particles.debugSnapshot().byKind.bubble, 4);
  particles.update(0.4);
  {
    const bubbleY = particles.debugSnapshot().positions[1]!;
    check('气泡往上窜（负重力）', bubbleY > 60.5, `y=${bubbleY.toFixed(2)}`);
  }

  particles.clear();
  particles.spawnRainSplash(0.5, 65.05, 0.5);
  equal('雨花归到 rain', particles.debugSnapshot().byKind.rain, 3);
  particles.update(0.12);
  check('雨花是"往上弹一下"（有重力，0.12 秒后已经回落）', particles.debugSnapshot().positions[1]! < 65.2);

  particles.clear();
  particles.spawnRedstoneDust(0.5, 64.5, 0.5);
  equal('红石尘归到 dust', particles.debugSnapshot().byKind.dust, 5);
  particles.update(0.2);
  check('红石尘往下掉', particles.debugSnapshot().positions[1]! < 64.5);

  // 密度为 0（设置里"关闭粒子"）时，新四类也一样不能生成
  particles.clear();
  particles.setDensity(0);
  particles.spawnExplosion(0.5, 64.5, 0.5, 3);
  particles.spawnBubble(0.5, 64.5, 0.5);
  particles.spawnRainSplash(0.5, 64.5, 0.5);
  particles.spawnRedstoneDust(0.5, 64.5, 0.5);
  equal('粒子关闭时新四类都不生成', particles.active, 0);
  particles.setDensity(1);

  particles.dispose();
}

// ---------------------------------------------------------------- 2.5 颜色空间

console.log('\n[颜色空间：自定义着色器的平色必须是原始 sRGB]');
{
  const raw = srgbColor(0xdc9a6b);
  check(
    'srgbColor 直接给出原始分量（220/154/107）',
    close(raw.r, 220 / 255, 1e-6) && close(raw.g, 154 / 255, 1e-6) && close(raw.b, 107 / 255, 1e-6),
    `${raw.r.toFixed(3)}/${raw.g.toFixed(3)}/${raw.b.toFixed(3)}`,
  );
  // 对照组：这正是当初手臂被渲染成橙褐色的原因
  const managed = new THREE.Color(0xdc9a6b);
  check('对照组：new THREE.Color 会做 sRGB→线性 转换（所以要绕开）', Math.abs(managed.r - 220 / 255) > 0.05, `r=${managed.r.toFixed(3)}`);

  const hand = new HandRenderer(stubAtlas);
  const arm = hand.scene.getObjectByName('arm') as THREE.Mesh;
  const armColor = (arm.material as THREE.ShaderMaterial).uniforms.uFlatColor!.value as THREE.Color;
  check('手臂材质用的是原始 sRGB 肤色', close(armColor.r, 220 / 255, 1e-6) && close(armColor.b, 107 / 255, 1e-6));

  const effects = new ScreenEffects();
  effects.set('water');
  effects.snap();
  check('水下色罩的蓝色分量是原始值 107', ((effects.state.color & 0xff) === 107), `0x${effects.state.color.toString(16)}`);
  hand.dispose();
  effects.dispose();
}

// ---------------------------------------------------------------- 2.8 破坏裂纹叠加层

console.log('\n[破坏裂纹与命中面高亮（G2/G3）]');
{
  const inward = facesWithInwardWinding();
  // ⚠️ 这条踩过坑：绕序朝内的面会被背面剔除，表现为"顶面看不见裂纹"
  check('六个面的顶点绕序全部朝外', inward.length === 0, `朝内的面下标 ${inward.join(',')}`);
  check('破坏阶段是 10 段（与原版一致）', DAMAGE_STAGES === 10);

  const overlay = new BlockOverlay(stubAtlas);
  check('初始不显示', overlay.damageStage === -1 && !overlay.highlightVisible);
  overlay.showDamage(1, 2, 3, 'cube', 0, 0);
  check('showDamage 之后阶段正确', overlay.damageStage === 0);
  overlay.showDamage(1, 2, 3, 'cube', 0, 9);
  check('阶段会跟着进度走', overlay.damageStage === 9);
  overlay.showDamage(1, 2, 3, 'cube', 0, 42);
  check('超范围的阶段被夹到 9', overlay.damageStage === 9);
  overlay.hideDamage();
  check('hideDamage 之后不显示', overlay.damageStage === -1);

  overlay.showHighlight(1, 2, 3, [0, 1, 0]);
  check('命中面高亮可以单独显示', overlay.highlightVisible && overlay.damageStage === -1);
  check('准星那一路维持很淡（0.08）', Math.abs(overlay.highlightOpacity - 0.08) < 1e-6);
  overlay.showHighlight(1, 2, 3, [5, 0, 0]);
  check('法线只取符号（不必是单位向量）', overlay.highlightVisible);
  // 批次 239：触摸端用手指取目标，没有准星做参考 → 命中面亮一档
  overlay.showHighlight(1, 2, 3, [0, 1, 0], 2);
  check('触摸瞄准亮一档（0.16）', Math.abs(overlay.highlightOpacity - 0.16) < 1e-6);

  overlay.showGlow(1, 2, 3, 'cube', 0);
  check('整块微光可以单独显示', overlay.glowVisible && overlay.damageStage === -1);
  overlay.hideGlow();
  check('微光可以单独收起', !overlay.glowVisible);
  overlay.showGlow(1, 2, 3, 'cube', 0);
  overlay.showDamage(1, 2, 3, 'cube', 0, 3);

  // 批次 241 复查：非满格目标的高亮贴地（而不是整格高度上的悬空方片）
  const highlightY = (): number => {
    const mesh = overlay.object.children[1] as THREE.Mesh;
    return mesh.geometry.getAttribute('position').getY(0);
  };
  check(
    '十字植物：高亮贴在地面（局部 y≈0.003）',
    overlay.showGroundHighlight(1, 2, 3, 'cross', 0, 2, true) && highlightY() < 0.01,
    `y=${highlightY().toFixed(3)}`,
  );
  check(
    '雪层：高亮贴在自己的顶面（1 层 = 0.125）',
    overlay.showGroundHighlight(1, 2, 3, 'snow', 0, 2, true) && Math.abs(highlightY() - 0.128) < 0.005,
    `y=${highlightY().toFixed(3)}`,
  );
  check(
    '台阶：高亮贴在 0.5 的台面上',
    overlay.showGroundHighlight(1, 2, 3, 'slab', 0, 2, true) && Math.abs(highlightY() - 0.503) < 0.005,
    `y=${highlightY().toFixed(3)}`,
  );
  check(
    '悬空且不铺满（墙上藤蔓）：返回 false，交给调用方退回命中面',
    !overlay.showGroundHighlight(1, 2, 3, 'cross', 0, 2, false),
  );

  overlay.hide();
  check('hide 一次性收起三者', !overlay.highlightVisible && !overlay.glowVisible && overlay.damageStage === -1);
  overlay.dispose();
}

// ---------------------------------------------------------------- 2.9 水面动画

console.log('\n[水面动画（E12）]');
{
  check('流体贴图槽位够放水与岩浆', FLUID_TILE_SLOTS >= 2);
  const material = new VoxelMaterial(new THREE.Texture(), { translucent: true });
  const slots = material.material.uniforms.uFluidTiles!.value as THREE.Vector2[];
  check('初始时所有槽位都是空位（-1,-1）', slots.length === FLUID_TILE_SLOTS && slots.every((slot) => slot.x === -1 && slot.y === -1));

  material.setFluidTiles([
    [0.25, 0.5],
    [0.5, 0.5],
  ]);
  check('登记水与岩浆的贴图起点', slots[0]!.x === 0.25 && slots[1]!.x === 0.5);
  check('没登记的槽位保持空位（不然会把别的贴图当成水面）', slots[2]!.x === -1 && slots[3]!.x === -1);

  material.setTime(12.5);
  check('时间写进 uniform', material.material.uniforms.uTime!.value === 12.5);
  // 水面起伏必须随距离衰减：远处是斜着看的，几厘米的起伏在屏幕上是一个像素跨几个
  // 波长的高频信号，每帧都在跳（"远处水面在闪"）。近处观感不受影响。
  check(
    '水面起伏按距离衰减（远处不闪）',
    material.material.vertexShader.includes('waveFade') &&
      material.material.vertexShader.includes('distance(cameraPosition, worldPos)'),
  );
  // VoxelMaterial 没有 dispose（材质由场景持有），这里只释放纹理对象
  material.material.dispose();
}

// ---------------------------------------------------------------- 2.10 半透明层单/双面

console.log('\n[半透明层单/双面（批次 215）]');
{
  // 水/玻璃是 `transparent + depthWrite:false`：没有 early-z，覆盖多少像素就混合多少次。
  // 双面等于把同一片水面再画一遍，而双面只有"从水里往上抬头"时才必需。
  const material = new VoxelMaterial(new THREE.Texture(), { translucent: true });
  equal('默认可双面（水下抬头能看见水面）', material.material.side, THREE.DoubleSide);

  material.setDoubleSided(false);
  equal('岸上切到单面', material.material.side, THREE.FrontSide);
  material.setDoubleSided(true);
  equal('下水切回双面', material.material.side, THREE.DoubleSide);

  // ⚠️ `side` 是 gl.cullFace 的渲染状态、不是着色器宏：设了 needsUpdate 会让每次
  // 上岸/下水都重编译一次着色器（手机上几十毫秒的卡顿）。这条断言就是守这个。
  const version = material.material.version;
  material.setDoubleSided(false);
  material.setDoubleSided(true);
  equal('来回切不触发着色器重编译', material.material.version, version);

  // 实心层（泥土/石头）：本来就该单面，调一下也不能变成双面
  const solid = new VoxelMaterial(new THREE.Texture());
  solid.setDoubleSided(false);
  equal('实心层单面不变', solid.material.side, THREE.FrontSide);

  material.material.dispose();
  solid.material.dispose();
}

// ---------------------------------------------------------------- 2.11 色温与 mip（批次 237）

console.log('\n[光照色温 / mip 层级（批次 237）]');
{
  // 带 image 的纹理：`uAtlasSize` 是从 texture.image 读的（算 mip 层级要用）
  const texture = new THREE.Texture();
  (texture as unknown as { image: { width: number; height: number } }).image = { width: 256, height: 1008 };
  const material = new VoxelMaterial(texture);

  const size = material.material.uniforms.uAtlasSize!.value as THREE.Vector2;
  check('图集像素尺寸进了 uniform', size.x === 256 && size.y === 1008, `${size.x}×${size.y}`);

  const sky = new THREE.Color(0.8, 0.9, 1);
  const block = new THREE.Color(1, 0.85, 0.65);
  material.setLightColors(sky, block);
  const skyUniform = material.material.uniforms.uSkyLightColor!.value as THREE.Color;
  const blockUniform = material.material.uniforms.uBlockLightColor!.value as THREE.Color;
  check('天光色写进 uniform', skyUniform.equals(sky));
  check('块光色写进 uniform', blockUniform.equals(block));
  check('写的是 copy：uniform 不持有调用方的 Color 对象', skyUniform !== sky && skyUniform.equals(sky));

  // 雾色每帧都设：必须是 set 到同一个 Color 上，不能每帧 new（批次 237 顺手省掉的分配）
  const fogBefore = material.material.uniforms.uFogColor!.value as THREE.Color;
  material.setFog(0x123456, 10, 20);
  check('雾色写回同一个 Color 对象', material.material.uniforms.uFogColor!.value === fogBefore);
  equal('雾近端跟着写', material.material.uniforms.uFogNear!.value, 10);
  equal('雾远端跟着写', material.material.uniforms.uFogFar!.value, 20);

  // 着色器结构守卫：这两条是本批次的核心，改回去就会重新出现"远处发碎 / 火把是灰的"
  const frag = material.material.fragmentShader;
  check('用 textureGrad 显式给 mip 梯度（fract 会毁掉隐式求导）', frag.includes('textureGrad('));
  check(
    '片元里按 t² 混色（白天不会被火把染橙）',
    frag.includes('mix(uSkyLightColor, uBlockLightColor, t * t)'),
  );
  check('没有退回"只乘标量亮度"的旧写法', !frag.includes('texel.rgb * brightness;'));
  // 抖色（批次 520）：雾与暗部是大面积平滑渐变，8 bit 输出会出台阶状色带
  check('片元最后加了抖色', frag.includes('ditherColor(color, gl_FragCoord.xy)'));
  check('抖色幅度是一个量化级（1/255，再大就成颗粒了）', GLSL_DITHER.includes('/ 255.0'));
  check(
    '天空穹顶用同一段抖色（不能各写一版）',
    readFileSync(new URL('../src/render/Sky.ts', import.meta.url), 'utf8').includes(
      'ditherColor(color, gl_FragCoord.xy)',
    ),
  );

  material.material.dispose();
}

// ---------------------------------------------------------------- 2.12 镂空贴图的覆盖率补偿
//
// mipmap 的 alpha 是覆盖率平均：43% 覆盖率的草到 mip2 就掉到 0.2~0.4，被 0.5 的
// 阈值整块 discard —— 剪影随距离被啃掉、走动时还在跳（"草的颗粒感"）。

console.log('\n[镂空贴图的覆盖率补偿（批次 520）]');
{
  // 纯函数：alpha=0 必须恒等（空白区域永远空白，不能凭空长出一层绿雾）
  equal('完全透明抬了也是 0', coverageAlpha(0, 3), 0);
  equal('LOD 0 不动（原图就是原图）', coverageAlpha(0.4, 0), 0.4);
  check('LOD 越高抬得越多', coverageAlpha(0.3, 2) > coverageAlpha(0.3, 1));
  check('实心方块（alpha=1）抬了还是 1', coverageAlpha(1, 3) === 1);
  check('每级增益是 0.4（LOD1 的 0.3 → 0.42）', Math.abs(coverageAlpha(0.3, 1) - 0.42) < 1e-9);
  check('封顶在 LOD 3（再远不再抬）', coverageAlpha(0.3, 9) === coverageAlpha(0.3, 3));
  check('负的 LOD（放大）不抬', coverageAlpha(0.3, -2) === 0.3);
  check('NaN 当 LOD 0 处理', coverageAlpha(0.3, Number.NaN) === 0.3);

  // 材质默认值：实心层开补偿、半透明层关（那一层本来就没有 alphaTest）
  const solid = new VoxelMaterial(new THREE.Texture());
  const translucent = new VoxelMaterial(new THREE.Texture(), { translucent: true });
  equal('实心层默认开启补偿', solid.material.uniforms.uAlphaLift!.value, ALPHA_LIFT_PER_LOD);
  equal('半透明层不补偿', translucent.material.uniforms.uAlphaLift!.value, 0);
  // 着色器守卫：常量由 TS 注入（`alphaCoverage.ts` 是唯一口径），不能手抄一份
  check(
    '着色器里的 LOD 上限由常量注入',
    solid.material.fragmentShader.includes(`0.0, ${ALPHA_LIFT_MAX_LOD.toFixed(1)})`),
  );
  check('alphaTest 用的是补偿后的值', solid.material.fragmentShader.includes('float covered = min(1.0, texel.a * (1.0 + uAlphaLift * alphaLod));'));
  // 批次 524：硬阈值 + 屏幕空间抖色（草尖不再整片翻转）
  check(
    '阈值按屏幕空间 4×4 Bayer 打散（草尖不再整片翻）',
    solid.material.fragmentShader.includes('float threshold = uAlphaTest + (bayer4(gl_FragCoord.xy) - 0.5) * uAlphaDither;') &&
      solid.material.fragmentShader.includes('if (covered < threshold) discard;'),
  );
  equal('实心层的抖动幅度 = ALPHA_DITHER_BAND', solid.material.uniforms.uAlphaDither!.value, ALPHA_DITHER_BAND);
  equal('半透明层不抖（那层没有 alphaTest，抖了只是白算）', translucent.material.uniforms.uAlphaDither!.value, 0);

  // ---- 方向化色温（批次 526）：朝上的面掺暖、朝侧/朝下的面掺冷
  check(
    '片元里按 vShade 混暖冷（零成本的"有盏灯照着"）',
    solid.material.fragmentShader.includes('mix(uShadeCool, uShadeWarm') &&
      solid.material.fragmentShader.includes('* sunTint'),
  );
  {
    const warm = solid.material.uniforms.uShadeWarm!.value as THREE.Color;
    const cool = solid.material.uniforms.uShadeCool!.value as THREE.Color;
    check('暖端偏红（红 > 蓝）', warm.r > warm.b && Math.abs(warm.r - SHADE_WARM[0]) < 1e-6, `${warm.r},${warm.b}`);
    check('冷端偏蓝（蓝 > 红）', cool.b > cool.r && Math.abs(cool.b - SHADE_COOL[2]) < 1e-6, `${cool.r},${cool.b}`);
    const warmMean = (warm.r + warm.g + warm.b) / 3;
    const coolMean = (cool.r + cool.g + cool.b) / 3;
    // 亮度不能跟着朝向变：两端均值都得贴近 1（否则就是"全局调色"而不是"色温"）
    check('两端均值都≈1（只改色相，不改亮度）', Math.abs(warmMean - 1) < 0.03 && Math.abs(coolMean - 1) < 0.03, `${warmMean.toFixed(3)},${coolMean.toFixed(3)}`);
  }
  solid.material.dispose();
  translucent.material.dispose();
}

// ---------------------------------------------------------------- 3. 视野效果

console.log('\n[生物头顶生命条（批次 280）]');
{
  /** Node 里没有 DOM：给一个只有方法壳子的 2D context，Sprite 的画布纹理不需要真的画 */
  const fakeContext = new Proxy(
    {},
    {
      get: () => () => undefined,
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => fakeContext,
  } as unknown as HTMLCanvasElement;

  const bar = new MobHealthBar(fakeCanvas);
  check('默认不可见', !bar.object.visible);

  const zombie = {
    id: 7,
    x: 3,
    y: 64,
    z: -5,
    width: 0.9,
    height: 1.4,
    health: 12,
    type: { id: 'zombie', name: '僵尸', health: 20, hostile: true, attackDamage: 3, followRange: 35 },
  } as unknown as Mob;

  bar.show(zombie);
  check('显示后可见', bar.object.visible);
  check(
    '生命条在头顶上方',
    bar.object.position.x === 3 &&
      bar.object.position.z === -5 &&
      bar.object.position.y > 64 + 1.4 &&
      bar.object.position.y < 64 + 1.4 + 1,
  );
  check(
    '宽 0.9 的生物 → 条宽 1.44、高按 40/256 的比例',
    Math.abs(bar.object.scale.x - 1.44) < 1e-9 &&
      Math.abs(bar.object.scale.y - 1.44 * (40 / 256)) < 1e-9,
  );
  const image = (bar.object.material as THREE.SpriteMaterial).map?.image as
    | { width?: number; height?: number }
    | undefined;
  check('画布固定 256×40（不再按敌对/被动改高度）', image?.width === 256 && image?.height === 40);

  // 体型差异只影响世界尺寸，不改变画布分辨率
  const tiny = { ...zombie, width: 0.2 } as unknown as Mob;
  bar.show(tiny);
  check('小体型按最小宽度 1.1 显示', Math.abs(bar.object.scale.x - 1.1) < 1e-9);
  const huge = { ...zombie, width: 16 } as unknown as Mob;
  bar.show(huge);
  check('大体型封顶 2.4（不会挡住半个屏幕）', Math.abs(bar.object.scale.x - 2.4) < 1e-9);

  // 掉血只重画画布，不改变 Sprite 尺寸
  const scaleBefore = bar.object.scale.x;
  bar.show({ ...huge, health: 1 } as unknown as Mob);
  check('掉血后尺寸不变、仍然可见', bar.object.visible && bar.object.scale.x === scaleBefore);

  bar.hide();
  check('hide 之后不可见', !bar.object.visible);
  bar.dispose();
}

console.log('\n[视野效果：预设 / 过渡 / 帧率无关]');
{
  const effects = new ScreenEffects();
  check('初始无色罩且完全透明', effects.effect === 'none' && effects.transparent);

  effects.set('water');
  check('set 立刻更新目标效果', effects.effect === 'water');
  effects.update(0.05);
  const midway = effects.state.alpha;
  check('过渡是渐进的（不是硬切）', midway > 0 && midway < 0.34, `alpha=${midway.toFixed(3)}`);

  for (let i = 0; i < 40; i++) effects.update(0.05);
  const water = effects.state;
  check('水下次态收敛到预设值', Math.abs(water.alpha - 0.34) < 0.01, `alpha=${water.alpha.toFixed(3)}`);
  check('水下是偏蓝的颜色', ((water.color >> 16) & 0xff) < ((water.color & 0xff) + 40) && (water.color & 0xff) > ((water.color >> 16) & 0xff), `0x${water.color.toString(16)}`);
  check('水下有色罩，不再透明', !effects.transparent);

  // 帧率无关：一次大步长与多次小步长结果应当基本一致
  const coarse = new ScreenEffects();
  coarse.set('lava');
  coarse.update(0.5);
  const fine = new ScreenEffects();
  fine.set('lava');
  for (let i = 0; i < 10; i++) fine.update(0.05);
  check(
    '过渡与帧率无关（0.5s 一次 vs 0.05s 十次）',
    Math.abs(coarse.state.alpha - fine.state.alpha) < 0.02,
    `${coarse.state.alpha.toFixed(3)} vs ${fine.state.alpha.toFixed(3)}`,
  );

  coarse.update(3);
  check('岩浆比水更不透明', coarse.state.alpha > 0.6, `alpha=${coarse.state.alpha.toFixed(3)}`);

  const snapped = new ScreenEffects();
  snapped.set('lava');
  snapped.snap();
  check('snap() 立即到位（用于传送/读档）', Math.abs(snapped.state.alpha - 0.68) < 1e-6);

  effects.set('none');
  for (let i = 0; i < 40; i++) effects.update(0.05);
  check('离开水面后色罩完全褪去', effects.transparent, `alpha=${effects.state.alpha.toFixed(4)}`);
  effects.dispose();
}

// ---------------------------------------------------------------- 4. 手持物品

console.log('\n[手持物品：切物品 / 挥手动画 / 亮度]');
{
  const hand = new HandRenderer(stubAtlas);
  check('初始为空手', hand.item === undefined);

  // 节点按**名字**取：批次 20261024-1726 把手拆成了「根 → 手臂组 / 物品组」，
  // 之前按下标取的写法一改结构就全红（之后也不会再因为顺序变而误报）
  const root = hand.scene.getObjectByName('hand') as THREE.Group;
  const armMesh = hand.scene.getObjectByName('arm') as THREE.Mesh;
  const fistMesh = hand.scene.getObjectByName('fist') as THREE.Mesh;
  const cuffMesh = hand.scene.getObjectByName('cuff') as THREE.Mesh;
  const armorSleeve = hand.scene.getObjectByName('armor-sleeve') as THREE.Mesh;
  const itemRig = hand.scene.getObjectByName('item-rig') as THREE.Group;
  const itemMesh = (): THREE.Mesh => itemRig.children[0] as THREE.Mesh;

  hand.setItem(Block.STONE);
  check('手持方块：记录物品 id', hand.item === Block.STONE);
  check('根节点下就是手臂组与物品组', root.children.length === 2 && !!armMesh && !!itemRig);

  // 方块走立方体（24 个顶点）、非方块走**有厚度的薄板**（也是 24 个顶点）
  const blockMesh = itemMesh();
  check('手持方块用立方体几何体', blockMesh.geometry.getAttribute('position').count === 24, String(blockMesh.geometry.getAttribute('position').count));
  check('方块六个面都写了 UV', blockMesh.geometry.getAttribute('uv').count === 24);
  // 批次 20261024-1726：尺寸改成**屏幕高比例**；1912（用户给了基岩版截图对比）再放大一档：
  // 方块 0.34 → 0.37、扁平物品 0.40 → 0.52
  const blockBox = blockMesh.geometry as THREE.BoxGeometry;
  check(
    '手持方块边长按屏幕高比例定义（0.37）',
    close(blockBox.parameters.width, 0.37, 1e-6) && close(blockBox.parameters.height, 0.37, 1e-6),
    `${blockBox.parameters.width}`,
  );

  hand.setItem(Item.STICK);
  const stickMesh = itemMesh();
  // 扁平物品真正上线时是一张**烘好的 2.5D 贴图**（`heldSprite.ts`，边缘平滑 + 画出来的厚度）。
  // ⚠️ 烘贴图要 canvas，离线测试里没有 → 这里测的是**退路**：一块 0.52×0.52×0.03 的薄盒子。
  //    贴图那一路（放大倍率、厚度像素、剪影方向）只能靠手测，别拿这几条断言当它的保证。
  const stickGeo = stickMesh.geometry;
  stickGeo.computeBoundingBox();
  const stickBounds = stickGeo.boundingBox!;
  check(
    '离线环境（没有 canvas）退回薄盒子：尺寸仍是 0.52 屏高、厚度 0.03',
    close(stickBounds.max.x - stickBounds.min.x, 0.52, 1e-6) &&
      close(stickBounds.max.y - stickBounds.min.y, 0.52, 1e-6) &&
      close(stickBounds.max.z - stickBounds.min.z, 0.03, 1e-6),
    `${(stickBounds.max.x - stickBounds.min.x).toFixed(3)}×${(stickBounds.max.y - stickBounds.min.y).toFixed(3)}×${(stickBounds.max.z - stickBounds.min.z).toFixed(3)}`,
  );
  check(
    '方块的几何体仍然居中（握在方块中间）',
    (() => {
      blockMesh.geometry.computeBoundingBox();
      const box = blockMesh.geometry.boundingBox!;
      return Math.abs(box.min.y + box.max.y) < 1e-6;
    })(),
  );
  // 用户："手应该拿到柄的位置"：**图标里不透明那块的底边**落在握点（y=0）上
  stickGeo.computeBoundingBox();
  const content = TILE_CONTENT.item_stick!;
  const contentBottom = ((TILE_PIXELS - content.bottom) * 0.52) / TILE_PIXELS;
  check(
    '扁平物品按"内容底边"对齐握点（手握柄，不是捏在图标正中）',
    close(stickBounds.min.y, -contentBottom, 1e-6) &&
      close(stickBounds.max.y, 0.52 - contentBottom, 1e-6),
    `y ∈ [${stickBounds.min.y.toFixed(3)}, ${stickBounds.max.y.toFixed(3)}]`,
  );
  check(
    '扁平物品有自己的握持姿态（刃朝上偏右，不与方块共用）',
    Math.abs(stickMesh.rotation.z - 0.14) < 1e-6 && Math.abs(blockMesh.rotation.z) < 1e-6,
    `stick.z=${stickMesh.rotation.z} / block.z=${blockMesh.rotation.z}`,
  );
  check(
    '方块是"一个角朝着你"的（绕 Y 45°）+ 顶面朝上',
    close(blockMesh.rotation.y, Math.PI / 4, 1e-6) && blockMesh.rotation.x > 0.2,
    `y=${blockMesh.rotation.y.toFixed(3)} / x=${blockMesh.rotation.x.toFixed(3)}`,
  );

  // 批次 20261024-1152（用户）：手里有东西时**不画手臂**（原版如此），空手才露出来
  check('拿东西时手臂隐藏', !armMesh.visible && !cuffMesh.visible && !fistMesh.visible);
  hand.setArmorColor(0xcdcdd4);
  check('拿东西时胸甲袖套也不露（否则是悬空的袖子）', !armorSleeve.visible);
  hand.setItem(undefined);
  check('切回空手会移除手上的东西', itemRig.children.length === 0);
  check('空手时手臂与袖套回来', armMesh.visible && cuffMesh.visible && fistMesh.visible && armorSleeve.visible);
  hand.setItem(Item.STICK);
  check('再拿起东西手臂又收起来', !armMesh.visible && !armorSleeve.visible);
  hand.setItem(undefined);

  // 批次 241：手臂根部多一段布袖；第一人称的肤色/上衣色要跟着外观走
  check('手臂根部有布袖（也画了逐面明暗）', cuffMesh.isMesh && cuffMesh.geometry.getAttribute('position').count === 24);
  hand.setAppearance({
    skin: 0xff0000,
    shirt: 0x0000ff,
    pants: 0x000000,
    hair: 0x2f2016,
    hairStyle: 'short',
    beard: 'none',
    eyes: 'calm',
    eye: 0x3a2a1e,
    build: 'adult',
    frame: 'normal',
  });
  const armMaterialNow = armMesh.material as THREE.ShaderMaterial;
  const cuffMaterialNow = cuffMesh.material as THREE.ShaderMaterial;
  const skinColor = armMaterialNow.uniforms.uFlatColor!.value as THREE.Color;
  const shirtColor = cuffMaterialNow.uniforms.uFlatColor!.value as THREE.Color;
  check('第一人称手臂跟随肤色设置', skinColor.r === 1 && skinColor.g === 0 && skinColor.b === 0);
  check('布袖跟随上衣色设置', shirtColor.b === 1 && shirtColor.r === 0 && shirtColor.g === 0);

  hand.setBrightness(0.42);
  const armMaterial = armMesh.material as THREE.ShaderMaterial;
  check('亮度同步到材质 uniform', armMaterial.uniforms.uBrightness!.value === 0.42);

  // ---------------------------------------------------------------- 屏幕比例骨架（1726）
  //
  // 这一组是这批的核心：位置/尺寸必须按 **fov 与宽高比**换算，而不是写死世界格数。
  // 之前写死的后果就是"手臂根部离镜头 0.1 格、透视放大成一堵墙"。
  hand.update(0.4, false, 70, 16 / 9);
  const rest = root.position.clone();
  const wideX = Math.abs(rest.x);
  hand.update(0.4, false, 70, 4 / 3);
  check(
    '换宽高比时握点跟着投影走（屏幕比例不变）',
    Math.abs(root.position.x) < wideX - 1e-3,
    `16:9 |x|=${wideX.toFixed(3)} → 4:3 |x|=${Math.abs(root.position.x).toFixed(3)}`,
  );
  check('握点在一个合理的深度上（不会被近裁面撕开）', rest.z > -2 && rest.z < -0.5, rest.z.toFixed(3));
  // 1726 第二轮自测的回归点：手用**自己的**视野（视图模型），世界 fov 怎么调都不变。
  // 曾经让手跟着世界 fov 缩放：90° 下"尺寸/距离"比翻倍，方块近角被透视推到 fov60 的 1.7 倍宽。
  hand.update(0.4, false, 60, 16 / 9);
  const at60 = { scale: root.scale.clone(), pos: root.position.clone() };
  hand.update(0.4, false, 90, 16 / 9);
  check(
    '世界视野变化不影响手（手固定用自己的视图模型视角）',
    root.scale.distanceTo(at60.scale) < 1e-9 && root.position.distanceTo(at60.pos) < 1e-9,
    `fov60 scale=${at60.scale.x.toFixed(3)} / fov90 scale=${root.scale.x.toFixed(3)}`,
  );

  // 挥手：从静止位置出发 → 中途位移不同 → 结束后复位
  hand.update(0.4, false, 72, 1.6);
  const still = root.position.clone();
  check('静止时不在挥动', !hand.swinging);
  hand.swing();
  check('swing() 立刻进入挥动状态', hand.swinging);
  hand.update(0.13, false, 72, 1.6);
  const mid = root.position.clone();
  check('挥动中途位置发生偏移', mid.distanceTo(still) > 0.05, `偏移 ${mid.distanceTo(still).toFixed(3)}`);
  // ⚠️ 1726 的回归点：支点离握点 1.1 个单位，角度给大一点就会把物品甩出画面
  check(
    '挥到一半物品仍在画面内（不被甩出去）',
    mid.y > -2.2 && Math.abs(mid.x) < 2.2,
    `x=${mid.x.toFixed(2)} y=${mid.y.toFixed(2)}`,
  );
  hand.swing();
  hand.update(0.0001, false, 72, 1.6);
  check('挥动中再次 swing() 不会重开（防抖手）', root.position.distanceTo(mid) < 0.2);
  hand.update(0.4, false, 72, 1.6);
  check('挥动结束复位到静止位置', !hand.swinging && root.position.distanceTo(still) < 1e-6, `偏移 ${root.position.distanceTo(still).toFixed(4)}`);

  // 走路时的摆动：动的时候有偏移，站着时归零
  hand.update(0.05, true, 72, 1.6);
  const bobbing = root.position.y;
  hand.update(0.05, false, 72, 1.6);
  check('走路时手臂上下摆动、静止时归零', Math.abs(bobbing - still.y) > 1e-4 && Math.abs(root.position.y - still.y) < 1e-6);

  hand.update(0.016, false, 90, 1.2);
  check(
    '手的相机只跟宽高比，视野固定（不跟着世界 90° 走）',
    hand.camera.fov !== 90 && hand.camera.fov > 60 && Math.abs(hand.camera.aspect - 1.2) < 1e-6,
    `fov=${hand.camera.fov}`,
  );
  hand.dispose();
}

// ---------------------------------------------------------------- 5. 盔甲（E14）

console.log('\n[盔甲：第三人称甲片]');
{
  const scene = new THREE.Scene();
  const player = new PlayerRenderer(scene, () => 1);
  player.setVisible(true);

  const plates = player.armorPlates;
  const visiblePlates = (): number => plates.filter((mesh) => mesh.visible).length;

  // 没穿甲时不该有任何甲片可见（否则身上会多出一层白壳）
  equal('初始没有任何甲片可见', visiblePlates(), 0);
  player.setArmor([null, null, null, null]);
  equal('明确传四个 null 也不显示', visiblePlates(), 0);

  // 只戴头盔：只有头盔的 2 块甲片出现
  player.setArmor([0x5a3a24, null, null, null]);
  equal('只戴头盔时只有头盔甲片可见', visiblePlates(), 2);

  // 满套：2 头盔 + 3 胸甲（含两只护肩）+ 3 护腿 + 2 靴子 = 10
  player.setArmor([0x5a3a24, 0xcdcdd4, 0xcdcdd4, 0xcdcdd4]);
  equal('整套盔甲共 10 块甲片', visiblePlates(), 10);

  // 颜色：甲片材质取到的是"原始色"，且亮度会乘上去
  const helmetPlate = plates.find(
    (mesh) => mesh.visible && (mesh.material as THREE.MeshBasicMaterial).userData.rawColor === 0x5a3a24,
  );
  check('头盔甲片用了传入的颜色', helmetPlate !== undefined);
  const plateMaterial = helmetPlate!.material as THREE.MeshBasicMaterial;

  const pose = { x: 0, y: 70, z: 0, yaw: 0, pitch: 0, walkPhase: 0, walkAmount: 0, swing: 1, flying: false };
  player.update(pose, () => ({ sky: 0, block: 0 }));
  // 注意要取数值快照：material.color 是同一个对象，会被下一次 update 就地改写
  const darkR = plateMaterial.color.r;
  check('甲片跟着亮度变暗（洞里不会只有身体变暗）', darkR < 0x5a / 255, `r=${darkR.toFixed(3)}`);

  player.update(pose, () => ({ sky: 15, block: 0 }));
  check(
    '回到亮处颜色恢复（亮度不会一帧帧累积到变黑）',
    plateMaterial.color.r > darkR && Math.abs(plateMaterial.color.r - 0x5a / 255) < 1e-6,
    `暗处 r=${darkR.toFixed(3)}，亮处 r=${plateMaterial.color.r.toFixed(3)}`,
  );

  // 换材质：颜色跟着换
  player.setArmor([0x60e4e0, null, null, null]);
  check(
    '换成钻石头盔后甲片颜色变了',
    (helmetPlate!.material as THREE.MeshBasicMaterial).userData.rawColor === 0x60e4e0,
  );

  // 脱掉再穿：可见性要能来回切
  player.setArmor([null, null, null, null]);
  equal('脱下后甲片重新隐藏', visiblePlates(), 0);

  player.dispose();
}

console.log('\n[第三人称：手里那件东西]');
{
  const scene = new THREE.Scene();
  const player = new PlayerRenderer(scene, () => 1, stubAtlas);

  check('空手时手里什么都没有', player.heldItem === undefined && !player.heldItemVisible);

  player.setHeldItem(Block.STONE);
  check('拿起方块：记录 id 并显示模型', player.heldItem === Block.STONE && player.heldItemVisible);
  // 主手挂点挂在右臂上（跟着走路摆臂、挥手一起动），而不是钉在躯干上
  const rightArm = player.object.children.find((child) => child.type === 'Group' && child.children.some((c) => c.type === 'Group' && c.position.z < -0.2));
  check('主手挂点在手臂上（会跟着摆臂/挥手动）', !!rightArm, rightArm ? 'ok' : '没找到');
  const heldMesh = (): THREE.Mesh | null => {
    const found = player.object.getObjectByName('held-item');
    return found instanceof THREE.Mesh ? found : null;
  };
  const blockMesh3p = heldMesh();
  check('方块用立方体几何体（六面各自贴图）', !!blockMesh3p && blockMesh3p.geometry.getAttribute('position').count === 24);
  check(
    '手里的方块比第一人称的小一圈（0.34 格）',
    !!blockMesh3p && close((blockMesh3p.geometry as THREE.BoxGeometry).parameters.width, 0.34, 1e-6),
    blockMesh3p ? String((blockMesh3p.geometry as THREE.BoxGeometry).parameters.width) : 'null',
  );

  player.setHeldItem(Item.STICK);
  const spriteMesh3p = heldMesh();
  // ⚠️ 回归点（用户："第三人称看到的是一把交叉的剑"）：材质若开 `DoubleSide`，
  // 背面的**镜像图标**会透过正面的透明区显出来 = 两把剑交叉。
  check(
    '第三人称手持物是单面渲染（否则背面镜像会透出来，剑变成"交叉"的）',
    !!spriteMesh3p && (spriteMesh3p!.material as THREE.MeshBasicMaterial).side === THREE.FrontSide,
    spriteMesh3p ? String((spriteMesh3p!.material as THREE.MeshBasicMaterial).side) : 'null',
  );
  check(
    '离线环境退回薄盒子（有厚度，不是零厚度面片）',
    !!spriteMesh3p &&
      close(
        (spriteMesh3p!.geometry as THREE.BoxGeometry).parameters.depth ?? 0,
        0.04,
        1e-6,
      ),
    spriteMesh3p ? String((spriteMesh3p!.geometry as THREE.BoxGeometry).parameters.depth) : 'null',
  );

  player.setHeldItem(undefined);
  check('切回空手：模型隐藏', player.heldItem === undefined && !player.heldItemVisible);
  check('反复切同一件物品不会重复建网格', (() => {
    player.setHeldItem(Item.STICK);
    const first = heldMesh();
    player.setHeldItem(Item.STICK);
    return heldMesh() === first;
  })());

  // 没给图集时（UI 里的角色预览 / 离线测试）不画手里的东西，也不能崩
  const bare = new PlayerRenderer(new THREE.Scene(), () => 1);
  bare.setHeldItem(Block.STONE);
  check('没有图集时安全降级（不画、不报错）', !bare.heldItemVisible);
  bare.dispose();
  player.dispose();
}

console.log('\n[盔甲：第一人称袖套]');
{
  const hand = new HandRenderer(stubAtlas);
  const sleeve = hand.scene.getObjectByName('armor-sleeve') as THREE.Mesh;
  const sleeveMaterial = sleeve.material as THREE.ShaderMaterial;

  check('初始不显示袖套（没穿胸甲）', !sleeve.visible);
  hand.setArmorColor(0xcdcdd4);
  check('穿上胸甲后袖套出现', sleeve.visible);
  const color = sleeveMaterial.uniforms.uFlatColor!.value as THREE.Color;
  check('袖套颜色与传入的甲片色一致', close(color.r, 0xcd / 255, 1e-6) && close(color.g, 0xcd / 255, 1e-6));
  // 批次 1726：手臂几何体是**单位盒子**，粗细交给 armRig 的缩放，
  // 所以袖套/布袖的"粗"是相对手臂的倍数（写在几何体上 > 1 就是套在外面）
  const armWidth = (hand.scene.getObjectByName('arm') as THREE.Mesh).geometry as THREE.BoxGeometry;
  const sleeveWidth = sleeve.geometry as THREE.BoxGeometry;
  check(
    '袖套比手臂粗（套在外面而不是重叠）',
    sleeveWidth.parameters.width > armWidth.parameters.width,
    `${sleeveWidth.parameters.width} vs ${armWidth.parameters.width}`,
  );

  hand.setArmorColor(null);
  check('脱下胸甲后袖套消失', !sleeve.visible);

  hand.setBrightness(0.35);
  check('袖套亮度也跟着同步', sleeveMaterial.uniforms.uBrightness!.value === 0.35);
  hand.dispose();
}

console.log('\n[剪羊毛的外观（J8）]');
{
  const sheepType = mobTypeById('sheep')!;
  const sheep = new Mob(sheepType, 0, 65, 0);
  equal('没剪过的白羊用羊毛的白色', mobBodyColor(sheep), 0xf9fffe);

  sheep.woolColor = 11;
  check('换了颜色就跟着换（深蓝 0x3c44aa）', mobBodyColor(sheep) === 0x3c44aa, mobBodyColor(sheep).toString(16));

  sheep.woolColor = 0;
  sheep.shear();
  equal('剪过之后换成贴身皮色（一眼能看出已经剪了）', mobBodyColor(sheep), SHEARED_BODY_COLOR);
  check('皮色与羊毛色明显不同', Math.abs(SHEARED_BODY_COLOR - 0xf9fffe) > 0x200000);

  const cow = new Mob(mobTypeById('cow')!, 0, 65, 0);
  equal('牛这种不掉羊毛的生物不受影响', mobBodyColor(cow), cow.type.bodyColor);
}

// ---------------------------------------------------------------- 视距裁剪（批次 203）

console.log('\n[只画视距之内的区块]');
{
  // 真机反馈："自适应把视距降下来了，可画面里的范围还是很大"。
  // 原因是 `rendered` 里留着 `radius + 2` 的缓冲圈，而远裁面被天空穹顶撑着（约 13 区块），
  // 裁不掉它们。`applyViewDistance` 每帧按区块中心到玩家的水平距离切可见性。
  const chunks = new Map<string, Chunk>([
    ['0,0', new Chunk(0, 0)],
    ['3,1', new Chunk(3, 1)],
    ['8,0', new Chunk(8, 0)],
    ['0,-7', new Chunk(0, -7)],
  ]);
  for (const chunk of chunks.values()) chunk.set(0, 64, 0, Block.STONE);
  const world = {
    getChunk: (cx: number, cz: number) => chunks.get(`${cx},${cz}`),
  } as unknown as World;

  const callbacks: Array<(response: MeshResponse) => void> = [];
  const pool = {
    size: 1,
    request: (
      _cx: number,
      _cz: number,
      _chunks: unknown,
      _transfer: unknown,
      onDone: (response: MeshResponse) => void,
    ) => callbacks.push(onDone),
  } as unknown as MeshWorkerPool;
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const renderer = new ChunkRenderer(scene, {} as TextureAtlas, world, material, material, pool);
  const triangle = {
    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uv: new Float32Array(6),
    tile: new Float32Array(6),
    light: new Uint8Array(6),
    shade: new Uint8Array(3),
    index: new Uint32Array([0, 1, 2]),
  };

  for (const [cx, cz] of [[0, 0], [3, 1], [8, 0], [0, -7]]) {
    renderer.onChunkLoaded(cx!, cz!);
    renderer.processQueue(1, 0, 0);
    callbacks.shift()!({
      type: 'meshed',
      id: 1,
      cx: cx!,
      cz: cz!,
      sections: [{ section: 8, solid: triangle, translucent: null }],
    });
  }
  equal('四个区块的网格都在场景里', renderer.chunkMeshCount, 4);

  // 视距 4：中心区块与 (3,1) 在 4.5 格内，(8,0) 与 (0,-9) 应被切掉
  renderer.applyViewDistance(0, 0, 4);
  equal('视距 4 只画 2 个区块', renderer.drawnCount, 2);
  equal('切掉两个 = 场景里 2 个可见', scene.children.filter((child) => child.visible).length, 2);
  check(
    '被切掉的正是远处那两个（几何体没有被删，切的是可见性）',
    scene.children.filter((child) => !child.visible).length === 2 && renderer.chunkMeshCount === 4,
  );

  // 视距涨回 8：四个都回来（缓冲圈不必重新网格化）
  renderer.applyViewDistance(0, 0, 8);
  equal('视距 8 又把它们放回来', renderer.drawnCount, 4);
  equal('场景里 4 个都可见', scene.children.filter((child) => child.visible).length, 4);

  // 跟着玩家走：站在 (3,1) 上看视距 2，(0,0) 与 (3,1) 在范围内，(8,0) 依然在外
  renderer.applyViewDistance(3, 1, 3);
  equal('跟着玩家所在区块重算', renderer.drawnCount, 2);
  check(
    '远处那个仍然被切掉',
    scene.children.filter((child) => !child.visible).length === 2,
  );

  renderer.disposeAll();
  material.dispose();
}

// ---------------------------------------------------------------- 十字植物贴图的覆盖率
//
// 十字薄面没有厚度，侧看时一个像素跨好几个 texel：mipmap 把 alpha 平均到 0.5 以下，
// alphaTest 就把那片剪影整块 discard，剩下的零星像素就是"草的颗粒感"。
// 覆盖率是这件事的**下限**，所以在这里钉住（不需要 canvas，画笔是纯函数）。

console.log('\n[十字植物贴图的覆盖率下限]');
{
  for (const [tile, min] of [
    ['short_grass', 0.35],
    ['fern', 0.35],
    ['sugar_cane', 0.4],
    ['bamboo', 0.35],
  ] as const) {
    const cover = paintedCoverage(tile);
    check(
      `${tile} 覆盖率 ${(cover * 100).toFixed(0)}%（≥ ${(min * 100).toFixed(0)}%）`,
      cover >= min,
      `${(cover * 100).toFixed(1)}%`,
    );
    // 上限也守：整张画满就没有"叶片之间能透过去"的观感了
    check(`${tile} 没有画满（≤ 70%）`, cover <= 0.7, `${(cover * 100).toFixed(1)}%`);
  }
  // 树叶是实心方块（不靠 alphaTest），覆盖率必须是 100% —— 用户眼中"画质好"的对照组
  equal('树叶是不透明整块（覆盖率 100%）', paintedCoverage('oak_leaves'), 1);
}

// ---------------------------------------------------------------- 植物贴图不许有 1 像素宽的竖条（批次 524）
//
// 用户："看矮草的时候……草尖部分有那种极细的细线"。根因是叶尖收了 1 像素宽：
// 那是屏幕上 1~2 px 的一条线，而且 mipmap 第一个把它平均掉（覆盖率 0.25~0.5），
// alphaTest 一啃就断 —— 镜头一平移就时有时无，也就是"草尖在抖"。
// 规矩：十字植物的每一段不透明像素左右至少有一个同伴（≥ 2 像素宽）。

console.log('\n[植物贴图：不许有 1 像素宽的竖条]');
{
  for (const tile of ['short_grass', 'fern', 'dandelion', 'poppy', 'sugar_cane', 'bamboo'] as const) {
    const thin = paintedThinColumns(tile);
    check(`${tile} 没有孤立的 1 像素竖条`, thin === 0, `${thin} 个`);
  }
}

// ---------------------------------------------------------------- 草地/植物压暗（批次 527）

console.log('\n[草地与植物整体压暗]');
{
  // 用户："草方块和植物的亮度太高了" —— 只压这一族（草方块/草/蕨/甘蔗/竹子/花茎/藤/睡莲）
  check('压暗系数在 [0.75, 1) 之间（还在压、但没压成黑）', FOLIAGE_DARKEN >= 0.75 && FOLIAGE_DARKEN < 1, String(FOLIAGE_DARKEN));
  equal('foliage 真的乘上系数（100 → 80）', foliage([100, 100, 100])[0], 80);
  equal('白不会溢出', foliage([255, 255, 255])[0], 204);

  // 结构守卫：这一族必须走 `foliage()` / `FOLIAGE_DARKEN`，否则改回去了也没人发现
  const atlasSrc = readFileSync(new URL('../src/render/TextureAtlas.ts', import.meta.url), 'utf8');
  check(
    '草方块顶面与侧面那圈草边都压了',
    atlasSrc.includes('grass_top: layered(148 * FOLIAGE_DARKEN') && atlasSrc.includes('* FOLIAGE_DARKEN;'),
  );
  check(
    '草/蕨/花的茎叶都走 foliage()',
    atlasSrc.includes('bladesPainter(foliage([104, 158, 66])') &&
      atlasSrc.includes('flowerPainter(foliage([92, 148, 60])'),
  );
  check(
    '甘蔗/竹子/藤/睡莲也在这一族里',
    atlasSrc.includes('stalkPainter(foliage([142, 190, 96])') &&
      atlasSrc.includes('foliage(stem ? [62, 100, 46] : [82, 142, 60])') &&
      atlasSrc.includes('foliage([74, 128, 56])'),
  );
}

// ---------------------------------------------------------------- 植物贴图的四边必须透明（批次 525）
//
// 用户："植物的十字形状上面有一条很细的十字的线"。
// 机制：薄面 UV 是 0~1，着色器用 `fract(平铺坐标)` 映射回贴图 —— **整数处 fract 从 1 掉回 0**，
// 所以落在面**顶边**上的那一行像素采到的是贴图**最下面一行**（不透明的草根），
// 于是两条面的顶边各画出一条线、合起来就是一个极细的十字。
// 只要四边留一纹素透明，这条路径（以及各向异性越界、底边与地面共面）读到的就永远是空。

console.log('\n[植物贴图的四边必须透明]');
{
  for (const tile of ['short_grass', 'fern', 'dandelion', 'poppy', 'sugar_cane', 'bamboo', 'red_mushroom'] as const) {
    const edge = paintedEdgeOpaque(tile);
    check(`${tile} 最外一圈是透明的`, edge === 0, `${edge} 个不透明像素`);
  }
}

// ---------------------------------------------------------------- 选中描边（批次 521）

console.log('\n[选中描边的屏幕空间带（批次 521）]');
{
  // 为什么不再是 1px 的 GL 线段：WebGL 的 `linewidth` 不生效，斜棱会变成阶梯。
  const geometry = buildOutlineGeometry('cube', 0);
  const position = geometry.getAttribute('position');
  const other = geometry.getAttribute('aOther');
  const side = geometry.getAttribute('aSide');
  const end = geometry.getAttribute('aEnd');

  equal('一个立方体 = 12 条棱 × 4 顶点', position.count, 48);
  equal('索引数 = 12 条棱 × 6', geometry.index!.count, 72);
  equal('每条棱的宽度属性是 ±1 交替', `${side.getX(0)},${side.getX(1)}`, '-1,1');
  equal('每条棱的两端 aEnd 是 0,0,1,1', `${end.getX(0)},${end.getX(1)},${end.getX(2)},${end.getX(3)}`, '0,0,1,1');

  // ⚠️ 关键不变式：v0/v1（起点）的 aOther 必须等于 v2/v3 的 position，反之亦然。
  // 写反了那条棱会缩成一个点——画面上只表现为"框缺一条边"，很难联想到是这里。
  let mismatched = 0;
  for (let edge = 0; edge < 12; edge++) {
    const base = edge * 4;
    const at = (index: number): [number, number, number] => [
      position.getX(index), position.getY(index), position.getZ(index),
    ];
    const to = (index: number): [number, number, number] => [
      other.getX(index), other.getY(index), other.getZ(index),
    ];
    const samePoint = (a: [number, number, number], b: [number, number, number]): boolean =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;
    if (!samePoint(to(base), at(base + 2)) || !samePoint(to(base + 2), at(base))) mismatched++;
  }
  equal('每条棱的两端互为 aOther', mismatched, 0);

  // 台阶这种多盒形状：盒子数 × 12 条棱
  const slab = buildOutlineGeometry('slab', 0);
  check('半砖的棱数是 12 的正整数倍', slab.getAttribute('position').count % 48 === 0, String(slab.getAttribute('position').count));
}

// ---------------------------------------------------------------- 逐面明暗（批次 521）

console.log('\n[生物/玩家的逐面明暗（批次 521）]');
{
  const box = new THREE.BoxGeometry(1, 1, 1);
  check('方块几何体刷上了顶点色', applyBoxFaceShade(box));
  const color = box.getAttribute('color');
  equal('24 个顶点都有颜色', color.count, 24);
  // BoxGeometry 的面顺序：+X(0-3) -X(4-7) +Y(8-11) -Y(12-15) +Z(16-19) -Z(20-23)
  equal('顶面最亮（1.0）', color.getX(8), 1);
  check('底面最暗', color.getX(12) < 0.7, String(color.getX(12)));
  check('侧面介于两者之间', color.getX(0) > color.getX(12) && color.getX(0) < 1, String(color.getX(0)));
  check('四个顶点同亮度（逐面而不是逐顶点）', color.getX(8) === color.getX(11));
  check('重复调用不会覆盖（幂等）', applyBoxFaceShade(box) && box.getAttribute('color').count === 24);

  // 非"6 面 × 4 顶点"的几何体不能乱刷：算错面会把顶面涂成暗的
  check('平面几何体不刷（宁可不加也别涂错）', applyBoxFaceShade(new THREE.PlaneGeometry(1, 1)) === false);

  // 属性写了、材质没开 `vertexColors` 的话等于没加——这条是那个失败模式的门禁
  for (const file of ['MobRenderer.ts', 'PlayerRenderer.ts']) {
    const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
    check(
      `${file} 打开了 vertexColors`,
      source.includes('vertexColors: true') && source.includes('applyBoxFaceShade'),
    );
  }
}

console.log('\n[光照收敛后全量重刷（E23 / 批次 565、616）]');
{
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const rendererSrc = readFileSync(new URL('../src/render/ChunkRenderer.ts', import.meta.url), 'utf8');
  check('网格层提供已渲染区块的全量重刷入口', rendererSrc.includes('enqueueAllRendered(): void'));
  check('主程序在光照收敛后调用', mainSrc.includes('enqueueAllRendered()'));
  check('没有网格先不刷，等网格出来再刷', mainSrc.includes('chunkMeshCount > 0'));

  // ---- 批次 616：这里曾经是"只做一次"，那是"方块表面纯黑"的根因。
  // 真机日志里已渲染区块从 62 涨到 182 块，一次性的重刷只覆盖最早那批，
  // 后加载的区块烘进未收敛光照 → 天空正常、方块纯黑。现在必须**可重复**。
  check('不再是"只做一次"（settled 标记已删除）', !mainSrc.includes('lightSettledRemeshDone'));
  check('靠"有新加载区块"的脏标记触发', mainSrc.includes('this.remeshPending'));
  check('区块加载时置脏', /onChunkLoaded[\s\S]{0,1200}this\.remeshPending = true/.test(mainSrc));
  check('刷完清脏（不会每帧都刷）', mainSrc.includes('this.remeshPending = false'));
  check('有节流，避免挖方块时反复全量重排', mainSrc.includes('REMESH_MIN_INTERVAL'));
  check('节流比较用的是帧时间戳', mainSrc.includes('now - this.lastSettleRemeshAt >= REMESH_MIN_INTERVAL'));

  // 去重保证：重复调用不会让队列变长，所以"每秒重刷一次"是安全的
  check('入队自带去重（已在队列里的只升级优先级）', rendererSrc.includes('existing.priority = priority'));

  // 为什么会黑：平滑光照要读**跨区块**的 4 个采样格，邻居不在内存时 World 返回 0。
  // 这条不是"要不要修"的开关，而是修复的**前提事实**——它一旦改成别的语义
  // （例如返回 15），上面"反复重刷"就不再是必需的，那时的结论要重新推。
  const worldSrc = readFileSync(new URL('../src/core/world/World.ts', import.meta.url), 'utf8');
  const skyFn = worldSrc.slice(worldSrc.indexOf('getSkyLight(worldX'));
  check(
    '前提：邻居区块缺失时光照读作 0（所以先到的区块会烘出黑边）',
    skyFn.slice(0, 400).includes('if (!chunk) return 0;'),
  );
  check(
    '前提：网格化确实读跨区块的采样格（平滑光照 4 邻）',
    readFileSync(new URL('../src/core/mesh/ChunkMesher.ts', import.meta.url), 'utf8').includes(
      'originX + nx, worldY + dy, originZ + nz',
    ),
  );
}

console.log('\n[区块几何复用池（N3 / 批次 566）]');
{
  const rendererSrc = readFileSync(new URL('../src/render/ChunkRenderer.ts', import.meta.url), 'utf8');
  check('有按形状分桶的几何池', rendererSrc.includes('geometryPool = new Map'));
  check('重刷时优先从池里取', rendererSrc.includes('this.acquireGeometry('));
  check('卸载时回池而不是直接 dispose', rendererSrc.includes('this.releaseGeometry(mesh.geometry)'));
  check('整体销毁会释放池', rendererSrc.includes('this.disposePool()'));
}

console.log('\n[顶点光照/明暗量化（N1 / 批次 567）]');
{
  const geometry = createGeometry({
    position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uv: new Float32Array(6),
    tile: new Float32Array(6),
    light: new Float32Array([0, 0, 0.5, 0.5, 1, 1]),
    shade: new Float32Array([0, 0.5, 1]),
    index: new Uint32Array([0, 1, 2]),
  });
  const light = geometry.getAttribute('aLight') as THREE.BufferAttribute;
  const shade = geometry.getAttribute('aShade') as THREE.BufferAttribute;
  check('aLight 变成字节数组', light.array instanceof Uint8Array);
  check('aShade 变成字节数组', shade.array instanceof Uint8Array);
  check('字节属性标记为 normalized（着色器仍读 0~1）', light.normalized && shade.normalized);
  check(
    '0/0.5/1 量化成 0/128/255（getX 已还原成 0~1）',
    light.getX(0) === 0 && Math.abs(light.getX(1) - 128 / 255) < 1e-6 && light.getX(2) === 1,
  );
  check('明暗中值量化到 128', Math.abs(shade.getX(1) - 128 / 255) < 1e-6);
  check(
    '每个顶点省下 9 字节（3 个 float → 3 个 byte）',
    light.array.byteLength + shade.array.byteLength === 9,
    `${light.array.byteLength + shade.array.byteLength}`,
  );
}

console.log(`\n渲染测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
