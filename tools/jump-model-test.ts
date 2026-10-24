/**
 * 棋子小人的离线断言（批次 20261024-0415，`[跳4]`）
 *
 * 运行：`npm run test:jumpmodel`
 *
 * 小人只由几何 + 顶点色组成，不碰 DOM、不碰 WebGL，所以比例、压扁、空翻、释放
 * 这些都能在 node 里直接量。盯四件事：
 *
 *  1. **脚底在原点**：`min.y ≈ 0`。写错的话"站到方块顶面"就得靠人肉补偿，
 *     换一个方块尺寸就浮空或陷进去——这是最容易在截图里被当成'方块太高'的隐蔽 bug；
 *  2. **比例**：身高 1、头径 0.33、裙摆 0.42（参考图 02 的像素测量）；
 *  3. **压扁 / 空翻**：蓄力极值 y 0.6、xz 1.3，空翻 ±2π 且不污染朝向；
 *  4. **释放**：两个几何 + 两个材质真的 dispose（挂监听数事件，不靠"看起来清了"）。
 */

import * as THREE from 'three';
import { JUMPER_HEIGHT_RATIO } from '../src/minigame/games/jump/iso.ts';
import { JUMPER_COLOR, JumperModel, SQUASH_LIMIT } from '../src/minigame/games/jump/JumperModel.ts';

/** 边长 2 时的身高：比例只有 iso.ts 一处真值，测试跟着它算，不许再手抄 0.72 */
const BIG = 2 * JUMPER_HEIGHT_RATIO;

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

function near(label: string, actual: number, expected: number, tolerance = 1e-6): void {
  check(label, Math.abs(actual - expected) <= tolerance, `实际 ${actual}，期望 ${expected} ±${tolerance}`);
}

function box(model: JumperModel): THREE.Box3 {
  model.object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(model.object);
}

console.log('\n比例（以身高为 1）');
{
  const model = new JumperModel();
  const bounds = box(model);
  near('脚底在原点（min.y = 0）', bounds.min.y, 0, 1e-6);
  near('身高 = 1.00', bounds.max.y - bounds.min.y, 1, 0.02);
  near('裙摆宽度 = 0.42', bounds.max.x - bounds.min.x, 0.42, 1e-3);
  near('左右对称（|min.x| = max.x）', Math.abs(bounds.min.x + bounds.max.x), 0, 1e-6);

  const head = model.object.children.find((child) => child instanceof THREE.Mesh && child.geometry.type === 'SphereGeometry');
  check('有球形的头', Boolean(head));
  if (head) {
    const headBox = new THREE.Box3().setFromObject(head);
    near('头径 = 0.33', headBox.max.x - headBox.min.x, 0.33, 1e-3);
    near('头心在 0.835（头顶 = 1.0）', (headBox.max.y + headBox.min.y) / 2, 0.835, 1e-3);
    near('头顶正好是身高上限', headBox.max.y, 1, 1e-3);
    check('头与颈有重叠（不会看到脖子断层）', headBox.min.y < 0.74);
  }
  model.dispose();
}

console.log('\n尺寸随方块边长缩放');
{
  const model = new JumperModel();
  model.setSize(2);
  const big = box(model);
  near('边长 2 → 身高 = 2 × 比例', big.max.y - big.min.y, BIG, 1e-6);
  near('放大后脚底仍在原点', big.min.y, 0, 1e-6);

  model.setSize(0.9);
  const small = box(model);
  near('边长 0.9 → 身高同比缩小', small.max.y - small.min.y, 0.9 * JUMPER_HEIGHT_RATIO, 1e-6);
  near('尺寸变化只影响比例，不改内部几何', small.max.x / small.max.y, big.max.x / big.max.y, 1e-12);

  model.setSize(0);
  check('非法尺寸不炸（回落到 1 倍）', Number.isFinite(box(model).max.y));
  model.setSize(Number.NaN);
  check('NaN 尺寸不炸', Number.isFinite(box(model).max.y));
  model.dispose();
}

console.log('\n蓄力压扁');
{
  const model = new JumperModel();
  model.setSize(2);
  model.setSquash(0);
  near('不蓄力：y = 身高', model.object.scale.y, BIG, 1e-6);
  near('不蓄力：xz = 身高', model.object.scale.x, BIG, 1e-6);

  model.setSquash(1);
  near('蓄满：y → 0.6 × 基础缩放', model.object.scale.y, BIG * SQUASH_LIMIT.y, 1e-6);
  near('蓄满：xz → 1.3 × 基础缩放', model.object.scale.x, BIG * SQUASH_LIMIT.xz, 1e-6);
  near('压扁时脚底不动（min.y 仍为 0）', box(model).min.y, 0, 1e-6);

  model.setSquash(0.5);
  near('线性中间值', model.object.scale.y, BIG * 0.8, 1e-6);

  model.setSquash(9);
  near('超过 1 被夹住', model.object.scale.y, BIG * SQUASH_LIMIT.y, 1e-6);
  model.setSquash(-3);
  near('负数被夹到 0', model.object.scale.y, BIG, 1e-6);
  model.setSquash(Number.NaN);
  near('NaN 当作 0', model.object.scale.y, BIG, 1e-6);
  model.dispose();
}

console.log('\n空翻与朝向');
{
  const model = new JumperModel();
  model.setFlip(0);
  model.setYaw(Math.PI / 3);
  near('朝向 = 60°', model.object.rotation.y, Math.PI / 3, 1e-9);

  model.setFlip(Math.PI * 2);
  near('空翻 +360°', model.object.rotation.x, Math.PI * 2, 1e-9);
  near('空翻不影响朝向', model.object.rotation.y, Math.PI / 3, 1e-9);

  model.setFlip(-Math.PI * 2);
  near('反向空翻 -360°', model.object.rotation.x, -Math.PI * 2, 1e-9);

  check('旋转顺序是 YXZ（空翻绕自己的左右轴）', model.object.rotation.order === 'YXZ');

  model.resetPose();
  near('落回站姿：空翻归零', model.object.rotation.x, 0, 1e-9);
  near('落回站姿：压扁归零', model.object.scale.y, model.object.scale.x, 1e-9);
  near('落回站姿：朝向保留', model.object.rotation.y, Math.PI / 3, 1e-9);

  model.setFlip(Number.NaN);
  near('NaN 空翻不炸', model.object.rotation.x, 0, 1e-9);
  model.dispose();
}

console.log('\n倾倒（重心出界时朝行进方向扑）');
{
  const model = new JumperModel();
  model.setYaw(Math.PI / 3);
  model.setTilt(Math.PI / 2);
  near('倾倒 90° → 绕左右轴 −90°（朝前扑）', model.object.rotation.x, -Math.PI / 2, 1e-9);
  near('倾倒不改朝向', model.object.rotation.y, Math.PI / 3, 1e-9);

  model.setTilt(0);
  near('归零后站直', model.object.rotation.x, 0, 1e-9);
  model.setTilt(-1);
  near('负角被夹到 0（只会往前倒）', model.object.rotation.x, 0, 1e-9);
  model.setTilt(Number.NaN);
  near('NaN 不炸', model.object.rotation.x, 0, 1e-9);

  model.setTilt(Math.PI / 2);
  model.resetPose();
  near('落回站姿会清掉倾角', model.object.rotation.x, 0, 1e-9);
  model.dispose();
}

console.log('\n站到方块顶面');
{
  const model = new JumperModel();
  model.setPosition(1.5, 1.2, -3);
  near('位置可直接写世界坐标（原点即脚底）', model.object.position.y, 1.2, 1e-9);
  const bounds = box(model);
  near('脚底落在给定高度上', bounds.min.y, 1.2, 1e-6);
  model.dispose();
}

console.log('\n深色高光（顶点色）');
{
  const model = new JumperModel();
  const body = model.object.children
    .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    .find((mesh) => mesh.geometry.type === 'LatheGeometry');
  const colors = body?.geometry.getAttribute('color');
  const position = body?.geometry.getAttribute('position');
  check('身体有顶点色', Boolean(colors && position));
  if (colors && position) {
    let topBrightness = 0;
    let bottomBrightness = Infinity;
    for (let i = 0; i < colors.count; i++) {
      const brightness = colors.getX(i);
      if (position.getY(i) > 0.6) topBrightness = Math.max(topBrightness, brightness);
      if (position.getY(i) < 0.1) bottomBrightness = Math.min(bottomBrightness, brightness);
    }
    check('上面比下面亮（上亮下暗的立体感）', topBrightness > bottomBrightness, `${topBrightness} vs ${bottomBrightness}`);
    check('整体是深色（线性值 < 0.15）', topBrightness < 0.15, `${topBrightness}`);
    check('不是纯黑（有明暗层次）', bottomBrightness > 0.005, `${bottomBrightness}`);
  }
  const tint = new THREE.Color(JUMPER_COLOR);
  check('基色是深蓝紫（蓝 > 红 > 绿）', tint.b > tint.r && tint.r > tint.g);
  model.dispose();
}

console.log('\n释放（不靠肉眼"看起来清了"）');
{
  const model = new JumperModel();
  const disposals: string[] = [];
  model.object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry;
    const material = child.material as THREE.Material;
    geometry.addEventListener('dispose', () => disposals.push(`geometry:${geometry.type}`));
    material.addEventListener('dispose', () => disposals.push('material'));
  });
  check('释放前有子节点', model.object.children.length > 0);
  model.dispose();
  check('两个几何都释放了', disposals.filter((d) => d.startsWith('geometry:')).length === 2, disposals.join(','));
  check('两份材质都释放了', disposals.filter((d) => d === 'material').length === 2, disposals.join(','));
  check('释放后场景图清空', model.object.children.length === 0);
  check('重复释放不炸', (() => {
    try {
      model.dispose();
      return true;
    } catch {
      return false;
    }
  })());
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
