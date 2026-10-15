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
import type { TextureAtlas } from '../src/render/TextureAtlas.ts';
import { applyFaceShade, applyFaceUvs, blockFaceTiles, FACE_SHADE } from '../src/render/atlasMesh.ts';
import { PARTICLE_POOL, ParticleSystem } from '../src/render/ParticleSystem.ts';
import { ScreenEffects } from '../src/render/ScreenEffects.ts';
import { HandRenderer } from '../src/render/HandRenderer.ts';
import { PlayerRenderer } from '../src/render/PlayerRenderer.ts';
import { SHEARED_BODY_COLOR, mobBodyColor } from '../src/render/MobRenderer.ts';
import { Mob } from '../src/core/entity/Mob.ts';
import { mobTypeById } from '../src/core/entity/mobs.ts';
import { BlockOverlay, DAMAGE_STAGES, facesWithInwardWinding } from '../src/render/BlockOverlay.ts';
import { FLUID_TILE_SLOTS, VoxelMaterial } from '../src/render/VoxelMaterial.ts';
import { srgbColor } from '../src/render/srgb.ts';

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

/** 按贴图名给出固定 UV 的桩图集：石头在 (0,0)-(0.25,0.25)，草方块各面各占一格 */
const TILE_RECTS: Record<string, [number, number, number, number]> = {
  stone: [0, 0, 0.25, 0.25],
  grass_top: [0.25, 0, 0.5, 0.25],
  grass_side: [0.5, 0, 0.75, 0.25],
  dirt: [0.75, 0, 1, 0.25],
  item_stick: [0, 0.25, 0.25, 0.5],
};

const stubAtlas = {
  texture: new THREE.Texture(),
  columns: 16,
  rows: 18,
  uv(tile: string): [number, number, number, number] {
    return TILE_RECTS[tile] ?? [0, 0, 0, 0];
  },
  /** 破坏裂纹叠加层要用它换算贴图起点 */
  tileOrigin(tile: string): [number, number] {
    const rect = TILE_RECTS[tile];
    return rect ? [rect[0], rect[1]] : [0, 0];
  },
} as unknown as TextureAtlas;

/** 读某个面第 `corner` 个顶点的 UV */
function faceUv(geometry: THREE.BufferGeometry, face: number, corner: number): [number, number] {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  return [uv.getX(face * 4 + corner), uv.getY(face * 4 + corner)];
}

function colored(geometry: THREE.BufferGeometry, corner: number): number {
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

  check('blockFaceTiles 返回六张贴图且顺序为 [侧,侧,顶,底,侧,侧]', (() => {
    const tiles = blockDef(Block.GRASS_BLOCK).tiles;
    const faces = blockFaceTiles(Block.GRASS_BLOCK);
    return faces.length === 6 && faces[2] === tiles[0] && faces[3] === tiles[1] && faces[0] === tiles[2];
  })());

  applyFaceShade(box, FACE_SHADE);
  check(
    '逐面明暗：顶面最亮、底面最暗、侧面居中',
    close(colored(box, 8), 1) && close(colored(box, 12), 0.5) && close(colored(box, 0), 0.8) && close(colored(box, 20), 0.62),
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

  particles.update(0.016);
  const points = particles.object.children[0] as THREE.Points;
  check(
    '只上传活跃粒子（drawRange = 存活数）',
    points.geometry.drawRange.count === particles.active,
    `drawRange ${points.geometry.drawRange.count} vs ${particles.active}`,
  );

  const colorAttr = points.geometry.getAttribute('aColor') as THREE.BufferAttribute;
  check('颜色与透明度属性都在', colorAttr.count === PARTICLE_POOL && points.geometry.getAttribute('aAlpha') !== undefined);

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
  const arm = (hand.scene.children[0] as THREE.Group).children[0] as THREE.Mesh;
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
  overlay.showHighlight(1, 2, 3, [5, 0, 0]);
  check('法线只取符号（不必是单位向量）', overlay.highlightVisible);
  overlay.hide();
  check('hide 一次性收起两者', !overlay.highlightVisible && overlay.damageStage === -1);
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
  // VoxelMaterial 没有 dispose（材质由场景持有），这里只释放纹理对象
  material.material.dispose();
}

// ---------------------------------------------------------------- 3. 视野效果

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

  hand.setItem(Block.STONE);
  check('手持方块：记录物品 id', hand.item === Block.STONE);
  const group = hand.scene.children[0] as THREE.Group;
  check('空手时也画手臂（手臂恒在）', group.children.length >= 1);

  // 方块走立方体（24 个顶点）、非方块走平面（4 个顶点）
  const blockMesh = (group.children[1] as THREE.Group).children[0] as THREE.Mesh;
  check('手持方块用立方体几何体', blockMesh.geometry.getAttribute('position').count === 24, String(blockMesh.geometry.getAttribute('position').count));
  check('方块六个面都写了 UV', blockMesh.geometry.getAttribute('uv').count === 24);

  hand.setItem(Item.STICK);
  const stickMesh = (group.children[1] as THREE.Group).children[0] as THREE.Mesh;
  check('手持物品换成平面贴图', stickMesh.geometry.getAttribute('position').count === 4, String(stickMesh.geometry.getAttribute('position').count));

  hand.setItem(undefined);
  check('切回空手会移除手上的东西', (group.children[1] as THREE.Group).children.length === 0);

  hand.setBrightness(0.42);
  const armMaterial = (group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
  check('亮度同步到材质 uniform', armMaterial.uniforms.uBrightness!.value === 0.42);

  // 挥手：从静止位置出发 → 中途位移不同 → 结束后复位
  const rest = group.position.clone();
  check('静止时不在挥动', !hand.swinging);
  hand.swing();
  check('swing() 立刻进入挥动状态', hand.swinging);
  hand.update(0.13, false, 72, 1.6);
  const mid = group.position.clone();
  check('挥动中途位置发生偏移', mid.distanceTo(rest) > 0.05, `偏移 ${mid.distanceTo(rest).toFixed(3)}`);
  hand.swing();
  hand.update(0.0001, false, 72, 1.6);
  check('挥动中再次 swing() 不会重开（防抖手）', group.position.distanceTo(mid) < 0.2);
  hand.update(0.4, false, 72, 1.6);
  check('挥动结束复位到静止位置', !hand.swinging && group.position.distanceTo(rest) < 1e-6, `偏移 ${group.position.distanceTo(rest).toFixed(4)}`);

  // 走路时的摆动：动的时候有偏移，站着时归零
  hand.update(0.05, true, 72, 1.6);
  const bobbing = group.position.y;
  hand.update(0.05, false, 72, 1.6);
  check('走路时手臂上下摆动、静止时归零', Math.abs(bobbing - rest.y) > 1e-4 && Math.abs(group.position.y - rest.y) < 1e-6);

  hand.update(0.016, false, 90, 1.2);
  check('相机会跟着视野设置走', hand.camera.fov === 90 && Math.abs(hand.camera.aspect - 1.2) < 1e-6);
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

console.log('\n[盔甲：第一人称袖套]');
{
  const hand = new HandRenderer(stubAtlas);
  const group = hand.scene.children[0] as THREE.Group;
  const sleeve = group.children[2] as THREE.Mesh;
  const sleeveMaterial = sleeve.material as THREE.ShaderMaterial;

  check('初始不显示袖套（没穿胸甲）', !sleeve.visible);
  hand.setArmorColor(0xcdcdd4);
  check('穿上胸甲后袖套出现', sleeve.visible);
  const color = sleeveMaterial.uniforms.uFlatColor!.value as THREE.Color;
  check('袖套颜色与传入的甲片色一致', close(color.r, 0xcd / 255, 1e-6) && close(color.g, 0xcd / 255, 1e-6));
  // 手臂与袖套都用自己的几何体（不是缩放出来的），所以比的是几何体宽度
  const armWidth = (group.children[0] as THREE.Mesh).geometry as THREE.BoxGeometry;
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

console.log(`\n渲染测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
