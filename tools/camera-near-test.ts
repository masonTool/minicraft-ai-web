/**
 * 自适应近裁面离线测试（相机贴脸透视）
 *
 * 覆盖：
 *  1. `nearPlaneFor`：三档真实间隙（洞里跳 0.18 / 半砖下蹲 0.23 / 贴墙 0.30）都必须
 *     **严格小于**间隙（否则近裁面切掉那个面 → 用户看到的"透明世界"）；
 *     空场 / 非有限值原样返回 `CAMERA_NEAR`（保住深度精度）
 *  2. `cameraClearance`：用**碰撞盒**而不是"非空气格"，非完整方块按局部盒算距离
 *  3. 埋在实心方块里 → 0（几何上救不了，交给 suffocate 色罩）
 *  4. 邻域半径与三维（对角）距离
 *
 * 运行：npm run test:cameranear
 */

import { CAMERA_NEAR } from '../src/render/Sky.ts';
import {
  CAMERA_NEAR_MIN,
  CAMERA_PROBE_RADIUS,
  NEAR_MARGIN,
  cameraClearance,
  cameraClearanceInfo,
  nearPlaneFor,
  pushCameraOutOfWalls,
} from '../src/render/cameraNear.ts';
import type { CollisionWorld, VoxelCollision } from '../src/core/physics/AABB.ts';

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

function close(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** 只在指定格子给出碰撞的假世界（探针只认 `collisionAt`，不必起真的 `World`） */
function worldOf(specs: readonly { x: number; y: number; z: number; collision: VoxelCollision }[]): CollisionWorld {
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const map = new Map(specs.map((s) => [key(s.x, s.y, s.z), s.collision]));
  return { collisionAt: (x, y, z) => map.get(key(x, y, z)) ?? null };
}

/** 空的（什么都没有）世界 */
const EMPTY = worldOf([]);

// ---------------------------------------------------------------- 1. near 映射

console.log('\n[near 映射]');
{
  check('上限就是 Sky 里的 CAMERA_NEAR（不另抄一份 0.25）', CAMERA_NEAR === 0.25, String(CAMERA_NEAR));
  check('空场（Infinity）保持满 near', nearPlaneFor(Infinity) === CAMERA_NEAR);
  check('NaN 也走上限（探针算出脏值时不至于把画面裁没）', nearPlaneFor(NaN) === CAMERA_NEAR);
  check('间隙很大（100）也是满 near', nearPlaneFor(100) === CAMERA_NEAR);
  check('间隙 0.5（正常站在空地）就已经是满 near', nearPlaneFor(0.5) === CAMERA_NEAR);

  // 用户报的三档真实间隙（见 HANDOFF 交接：resolveVertical 让头顶正好贴住天花板）
  for (const [scene, clearance] of [
    ['两格高洞里跳一下（头撞顶）', 0.18],
    ['蹲在半砖天花板下', 0.23],
    ['贴墙走（AABB 半宽 0.3）', 0.3],
  ] as const) {
    const near = nearPlaneFor(clearance);
    check(`${scene}：near ${near.toFixed(3)} < 间隙 ${clearance}`, near < clearance, `near=${near}`);
  }

  check('洞里跳那档不至于小到没边（≥ 0.1）', nearPlaneFor(0.18) >= 0.1, String(nearPlaneFor(0.18)));
  check(
    '贴墙那档不牺牲深度精度（仍等于 CAMERA_NEAR）',
    nearPlaneFor(0.3) === CAMERA_NEAR,
    String(nearPlaneFor(0.3)),
  );
  check('埋在方块里（0）压到下限', nearPlaneFor(0) === CAMERA_NEAR_MIN, String(nearPlaneFor(0)));
  check('下限比上限小一个量级（只在最坏情况才丢精度）', CAMERA_NEAR_MIN < CAMERA_NEAR * 0.2);

  // 扫一遍：只要间隙有意义，near 就必须严格小于它（这条是"彻底杜绝"的判据）
  const samples = [0.06, 0.08, 0.1, 0.15, 0.18, 0.23, 0.26, 0.3, 0.4, 0.6, 1, 2];
  const bad = samples.filter((c) => nearPlaneFor(c) >= c);
  check('每个采样间隙都满足 near < clearance', bad.length === 0, `不满足：${bad.join(', ')}`);

  let monotonic = true;
  for (let i = 1; i < samples.length; i++) if (nearPlaneFor(samples[i]!) < nearPlaneFor(samples[i - 1]!)) monotonic = false;
  check('near 随间隙单调不减（贴得越近收得越紧）', monotonic);
  check('余量是个小量（不会平白压掉正常帧的精度）', NEAR_MARGIN > 0 && NEAR_MARGIN <= 0.1, String(NEAR_MARGIN));
}

// ---------------------------------------------------------------- 2. 探针：真实场景

console.log('\n[探针 · 三档真实场景]');
{
  // 两格高的洞：脚下 y=0 是地板、y=2 是天花板；头撞顶时脚在 0.2、眼在脚 +1.62 = 1.82
  const tunnel = worldOf([
    { x: 0, y: 0, z: 0, collision: 'full' },
    { x: 0, y: 2, z: 0, collision: 'full' },
  ]);
  const c = cameraClearance(tunnel, 0.5, 1.82, 0.5);
  check('洞里跳起来头贴天花板：间隙 0.18（= 天花板 2.0 − 眼高 1.82）', close(c, 0.18, 1e-9), String(c));
  check('这一档近裁面必须收缩到 0.18 以内', nearPlaneFor(c) < 0.18, `near=${nearPlaneFor(c)}`);

  const standing = cameraClearance(tunnel, 0.5, 1.62, 0.5);
  check('站直时头顶还有 0.38，不收缩', nearPlaneFor(standing) === CAMERA_NEAR, String(standing));

  // 贴墙：墙在 x∈[1,2]，相机在 x=0.7（AABB 半宽 0.3）
  const wall = worldOf([{ x: 1, y: 0, z: 0, collision: 'full' }]);
  const cw = cameraClearance(wall, 0.7, 0.5, 0.5);
  check('贴墙走：间隙 0.30', close(cw, 0.3, 1e-9), String(cw));
  check('贴墙这档 near 仍是 0.25（不动，保住深度精度）', nearPlaneFor(cw) === CAMERA_NEAR, String(nearPlaneFor(cw)));

  // 半砖天花板：上半砖的局部盒是 y∈[2.5,3]，蹲在下面（脚在 1.0、眼在脚 +1.27 = 2.27）
  // 时到盒底只有 0.23 —— 按"整格方块"（盒底 2.0）算会把人判成埋在方块里
  const slab = worldOf([{ x: 0, y: 2, z: 0, collision: [[0, 0.5, 0, 1, 1, 1]] }]);
  const cs = cameraClearance(slab, 0.5, 2.27, 0.5);
  check('半砖天花板下蹲着：间隙 0.23（按局部盒底 2.5 算）', close(cs, 0.23, 1e-9), String(cs));
  check('如果按整格盒底（2.0）算会得到 0 —— 那就误判成"埋在里面"了', cs !== 0, String(cs));
  check('如果按整格顶面（3.0）算会得到 0.73 —— 那就漏判了', close(cs, 0.73, 1e-9) === false, String(cs));
  check('半砖这档 near 也要收缩', nearPlaneFor(cs) < 0.23 && nearPlaneFor(cs) >= 0.1, String(nearPlaneFor(cs)));
}

// ---------------------------------------------------------------- 3. 用碰撞盒，不用"非空气格"

console.log('\n[碰撞盒口径]');
{
  // 水 / 岩浆 / 火 / 藤蔓：有方块但没有碰撞盒 → 不该把 near 拖下来
  const water = worldOf([{ x: 0, y: 0, z: 0, collision: null }]);
  check('水（无碰撞盒）不算数：仍是空场', cameraClearance(water, 0.5, 0.5, 0.5) === Infinity);

  const stone = worldOf([{ x: 0, y: 0, z: 0, collision: 'full' }]);
  check('同一格换成石头就有间隙了', cameraClearance(stone, 0.5, 0.9, 0.5) < 0.2);
  check('空场（什么都不给）是 Infinity', cameraClearance(EMPTY, 0.5, 0.5, 0.5) === Infinity);
}

// ---------------------------------------------------------------- 4. 埋在方块里

console.log('\n[埋在方块里]');
{
  const inside = worldOf([{ x: 0, y: 0, z: 0, collision: 'full' }]);
  check('相机在完整方块内部 → 0', cameraClearance(inside, 0.5, 0.5, 0.5) === 0);
  check('相机在半砖实体那一半里 → 0', cameraClearance(worldOf([{ x: 0, y: 0, z: 0, collision: [[0, 0, 0, 1, 0.5, 1]] }]), 0.5, 0.25, 0.5) === 0);
  check(
    '相机在半砖空着的那一半里 → 到盒顶 0.25（不是 0）',
    close(cameraClearance(worldOf([{ x: 0, y: 0, z: 0, collision: [[0, 0, 0, 1, 0.5, 1]] }]), 0.5, 0.75, 0.5), 0.25, 1e-9),
  );
  check('埋在里面时 near 压到下限（剩下的交给 suffocate 色罩）', nearPlaneFor(0) === CAMERA_NEAR_MIN);
}

// ---------------------------------------------------------------- 5. 邻域与三维距离

console.log('\n[邻域半径与对角距离]');
{
  const far = worldOf([{ x: 3, y: 0, z: 0, collision: 'full' }]);
  check('默认半径 1 探不到 2 格外的方块', cameraClearance(far, 0.5, 0.5, 0.5) === Infinity);
  check('半径放大到 3 就探得到', cameraClearance(far, 0.5, 0.5, 0.5, 3) < Infinity);
  check('默认探针半径是 1（3×3×3，每帧 27 次 collisionAt）', CAMERA_PROBE_RADIUS === 1);

  // 对角：相机在 (0.5,0.5,0.5)，方块占 [1,2]³ → 距离 √(0.5²×3)
  const diagonal = worldOf([{ x: 1, y: 1, z: 1, collision: 'full' }]);
  const d = cameraClearance(diagonal, 0.5, 0.5, 0.5);
  check('对角方向取三维距离（不是某一轴的差）', close(d, Math.sqrt(0.75), 1e-9), String(d));

  // 取最小值：头顶天花板离眼 0.1、脚下地板离眼 0.9，要的是 0.1
  const two = worldOf([
    { x: 0, y: 2, z: 0, collision: 'full' },
    { x: 0, y: 0, z: 0, collision: 'full' },
  ]);
  const nearest = cameraClearance(two, 0.5, 1.9, 0.5);
  check('多个盒子取最近的（0.1 而不是 0.9）', close(nearest, 0.1, 1e-9), String(nearest));
}

// ---------------------------------------------------------------- 6. 相机推出墙面（批次 20261026-0141）

console.log('\n[相机推出墙面]');
{
  // 墙角：后墙在 z=1（相机背后）、侧墙在 x=1。第三人称的射线只朝背后打，
  // 所以相机可能停在离**侧墙**只有 1 厘米的位置 —— 比 near 下限（0.02）还小。
  const corner = worldOf([
    { x: 0, y: 0, z: 1, collision: 'full' },
    { x: 1, y: 0, z: 0, collision: 'full' },
  ]);
  const pos = { x: 0.99, y: 0.5, z: 0.9 };
  const before = cameraClearance(corner, pos.x, pos.y, pos.z);
  check('前提：侧墙只剩 1 厘米（小于 near 下限 0.02）', close(before, 0.01, 1e-6), String(before));

  const info = cameraClearanceInfo(corner, pos.x, pos.y, pos.z);
  check('推出方向朝 -X（远离侧墙）', close(info.nx, -1, 1e-9) && close(info.ny, 0, 1e-9), String(info.nx));

  const pushed = pushCameraOutOfWalls(corner, pos);
  check('推出去有实际位移', pushed > 0, String(pushed));
  check(
    '推完之后离最近面 ≥ NEAR_MARGIN',
    cameraClearance(corner, pos.x, pos.y, pos.z) >= NEAR_MARGIN,
    String(cameraClearance(corner, pos.x, pos.y, pos.z)),
  );
  check('确实往远离侧墙的方向退了（x 变小）', pos.x < 0.99, String(pos.x));
  check('推的距离是小量（≤ 10 厘米，肉眼无感）', pushed <= 0.1, String(pushed));
  check('y/z 不该被这笔推向带偏（只远离最近那一面）', close(pos.z, 0.9, 1e-9));

  // 空场：一个毫米都不该动
  const open = { x: 1.5, y: 2.5, z: 3.5 };
  check('空场不推', pushCameraOutOfWalls(EMPTY, open) === 0 && open.x === 1.5);

  // 相机已经在方块内部：推不出去（方向为零向量），返回 -1 交给 suffocate 色罩
  const inside = worldOf([{ x: 0, y: 0, z: 0, collision: 'full' }]);
  check('相机在方块内部返回 -1（交给色罩兜底）', pushCameraOutOfWalls(inside, { x: 0.5, y: 0.5, z: 0.5 }) === -1);
}

console.log(`\n近裁面测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
