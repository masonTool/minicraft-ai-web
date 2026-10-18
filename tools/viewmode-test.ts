/**
 * 视角模式（F7）离线测试
 *
 * 覆盖：
 *  1. 循环顺序：第一人称 → 背后 → 正面 → 第一人称（`V` 键与设置下拉框共用这一份）
 *  2. 相机摆位：第一人称就架在眼睛上；背后 = 沿视线反方向退；正面 = 沿视线方向前移并回头
 *  3. 视角方向的正负号（yaw=0 时视线是 -Z；背后视角必须落在 +Z 侧）
 *  4. 贴墙时的距离裁剪：撞到方块提前停、太近有下限、没撞到就用满距离
 *  5. 设置往返：`GameSettings.cameraMode` 的默认值、非法值回退
 *  6. 玩家模型摆姿态：走路摆腿（左右腿反相）、挥手叠加在持手侧、俯仰夹紧、亮度衰减
 *
 * 运行：npm run test:viewmode
 */

import * as THREE from 'three';
import {
  CAMERA_MODE_LABELS,
  CAMERA_MODES,
  CAMERA_CLEARANCE,
  MIN_CAMERA_DISTANCE,
  THIRD_PERSON_DISTANCE,
  cameraPlacement,
  clampedCameraDistance,
  nextCameraMode,
  type CameraMode,
} from '../src/core/viewMode.ts';
import { DEFAULT_SETTINGS, loadSettings } from '../src/ui/SettingsScreen.ts';
import { PlayerRenderer, shadeHex } from '../src/render/PlayerRenderer.ts';

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

/** 朝 -Z（yaw = 0）的水平视线，三分量都带一点好验证正负号 */
const DIR = { x: 0, y: 0, z: -1 };
const EYE = { x: 10, y: 70, z: 20 };

// ---------------------------------------------------------------- 1. 循环顺序

console.log('\n[循环与标签]');
{
  check('三种模式齐全且顺序固定', CAMERA_MODES.join('|') === 'first|third-back|third-front');
  check('第一人称的下一个是背后', nextCameraMode('first') === 'third-back');
  check('背后视角的下一个是正面', nextCameraMode('third-back') === 'third-front');
  check('正面视角绕回第一人称', nextCameraMode('third-front') === 'first');

  let mode: CameraMode = 'first';
  const seen: CameraMode[] = [];
  for (let i = 0; i < 3; i++) {
    mode = nextCameraMode(mode);
    seen.push(mode);
  }
  check('连按三次 V 回到原点', mode === 'first', seen.join(' → '));

  check(
    '每种模式都有中文标签',
    CAMERA_MODES.every((entry) => typeof CAMERA_MODE_LABELS[entry] === 'string' && CAMERA_MODE_LABELS[entry].length > 0),
  );
}

// ---------------------------------------------------------------- 2. 相机摆位

console.log('\n[相机摆位]');
{
  const first = cameraPlacement(EYE, DIR, 0.5, -0.2, 'first', 0);
  check(
    '第一人称：相机就在眼睛上，朝向原样',
    first.x === EYE.x && first.y === EYE.y && first.z === EYE.z && first.yaw === 0.5 && first.pitch === -0.2,
    JSON.stringify(first),
  );

  const back = cameraPlacement(EYE, DIR, 0.5, -0.2, 'third-back', THIRD_PERSON_DISTANCE);
  check(
    '背后：往视线的反方向退 3.8 格（yaw=0 时视线 -Z，所以相机落到 +Z 侧）',
    close(back.z, EYE.z + THIRD_PERSON_DISTANCE) && close(back.x, EYE.x) && close(back.y, EYE.y),
    `z=${back.z}（眼睛 z=${EYE.z}）`,
  );
  check('背后：朝向不变（仍看着玩家面对的方向）', back.yaw === 0.5 && back.pitch === -0.2);

  const front = cameraPlacement(EYE, DIR, 0.5, -0.2, 'third-front', THIRD_PERSON_DISTANCE);
  check(
    '正面：往视线方向前移 3.8 格',
    close(front.z, EYE.z - THIRD_PERSON_DISTANCE) && close(front.x, EYE.x),
    `z=${front.z}`,
  );
  check('正面：朝向转 180° 回头看玩家', close(front.yaw, 0.5 + Math.PI));

  // 抬头时相机应该跟着落到下方（背后视角沿视线反向，视线朝上则相机朝下）
  const up = cameraPlacement(EYE, { x: 0, y: 0.5, z: -0.866 }, 0, 0.5236, 'third-back', 4);
  check('抬头时背后相机落到更低处（与原版一致）', up.y < EYE.y, `y=${up.y.toFixed(3)}`);

  // 斜向视线：相机应该在"眼睛 - 视线 × 距离"这条线上
  const diagonal = { x: -0.6, y: 0, z: -0.8 };
  const diagonalCam = cameraPlacement(EYE, diagonal, 0, 0, 'third-back', 2);
  check(
    '斜向视线时相机落在正确的反向延长线上',
    close(diagonalCam.x, EYE.x + 1.2) && close(diagonalCam.z, EYE.z + 1.6),
    `(${diagonalCam.x}, ${diagonalCam.z})`,
  );
}

// ---------------------------------------------------------------- 3. 距离裁剪

console.log('\n[贴墙时的距离裁剪]');
{
  check('没撞到方块 → 用满距离', clampedCameraDistance(null) === THIRD_PERSON_DISTANCE);
  check(
    '撞在 2 格处 → 退到撞点之前（留出空隙）',
    close(clampedCameraDistance(2), 2 - CAMERA_CLEARANCE),
    String(clampedCameraDistance(2)),
  );
  check(
    '撞得比满距离还远 → 仍用满距离（不做"放大"）',
    close(clampedCameraDistance(10), THIRD_PERSON_DISTANCE),
  );
  check(
    '贴脸（命中距离 0.1）→ 夹到最近距离，而不是负数',
    close(clampedCameraDistance(0.1), MIN_CAMERA_DISTANCE),
    String(clampedCameraDistance(0.1)),
  );
  check('相机不会越过撞点', clampedCameraDistance(1.5) < 1.5);
}

// ---------------------------------------------------------------- 4. 设置往返

console.log('\n[设置里的视角]');
{
  check('默认是第一人称', DEFAULT_SETTINGS.cameraMode === 'first');
  // Node 里没有 localStorage：loadSettings 必须安全回退到默认值，而不是抛异常
  const loaded = loadSettings();
  check('无 localStorage 时回退默认（含视角）', loaded.cameraMode === 'first' && loaded.fov === DEFAULT_SETTINGS.fov);
}

// ---------------------------------------------------------------- 5. 玩家模型

console.log('\n[玩家模型]');
{
  const scene = new THREE.Scene();
  let brightness = 1;
  const model = new PlayerRenderer(scene, () => brightness);
  const root = model.object as THREE.Group;
  // 挂点都是 Group（躯干只是一个 Mesh），按加入顺序取出：左腿 / 右腿 / 左臂 / 右臂 / 头
  const groups = root.children.filter((child) => (child as THREE.Group).isGroup) as THREE.Group[];
  const [legL, legR, armL, armR, head] = groups;
  check('模型由 5 个可动挂点组成（双腿 / 双臂 / 头）', groups.length === 5, `实际 ${groups.length}`);

  check('初始不可见（第一人称不该出现玩家模型）', !model.visible);
  model.setVisible(true);
  check('setVisible 后可见', model.visible);

  const light = () => ({ sky: 15, block: 0 });
  const pose = {
    x: 1,
    y: 64,
    z: 2,
    yaw: 0.5,
    pitch: 0,
    walkPhase: Math.PI / 2,
    walkAmount: 1,
    swing: 0,
    flying: false,
  };
  model.update(pose, light);

  check('模型站在玩家脚下位置、朝向与 yaw 一致', root.position.x === 1 && root.position.y === 64 && root.rotation.y === 0.5);
  check(
    '走路时左右腿反相摆动',
    Math.abs(legL!.rotation.x) > 0.5 && close(legL!.rotation.x, -legR!.rotation.x),
    `左 ${legL!.rotation.x.toFixed(3)} / 右 ${legR!.rotation.x.toFixed(3)}`,
  );
  check(
    '手臂与腿反相（左手对着右腿）',
    close(armL!.rotation.x, -legL!.rotation.x * 0.8),
    `左臂 ${armL!.rotation.x.toFixed(3)}`,
  );

  model.update({ ...pose, walkPhase: 0, walkAmount: 0, swing: 0.5 }, light);
  check('停住时双腿归位', close(legL!.rotation.x, 0) && close(legR!.rotation.x, 0));
  check('挥手时持物手向前甩（右臂）', armR!.rotation.x < -0.5, `右臂 ${armR!.rotation.x.toFixed(3)}`);
  check('挥手不影响另一只手', close(armL!.rotation.x, 0));

  model.update({ ...pose, pitch: 3 }, light);
  check('抬头俯仰被夹紧（不会把脖子翻过去）', head!.rotation.x <= 1.1 && head!.rotation.x > 1);
  model.update({ ...pose, pitch: -0.4 }, light);
  check('低头时头跟着低下去', close(head!.rotation.x, -0.4));

  model.update({ ...pose, flying: true, walkPhase: 1, walkAmount: 1 }, light);
  check('飞行时不摆腿、双臂张开', close(legL!.rotation.x, 0) && Math.abs(armL!.rotation.z) > 0.2);

  // 亮度：拿肤色（脸部方块）当样本，它最亮、最容易看出差异
  const skin = (head!.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  brightness = 0;
  model.update({ ...pose, flying: false }, () => ({ sky: 0, block: 0 }));
  check('全黑处模型变暗但有下限（不会纯黑看不见）', skin.color.r > 0 && skin.color.r < 0.2, `r=${skin.color.r.toFixed(3)}`);
  brightness = 1;
  model.update({ ...pose, flying: false }, () => ({ sky: 15, block: 0 }));
  check('正午在地表时恢复原色', skin.color.r > 0.5, `r=${skin.color.r.toFixed(3)}`);

  // 亮度必须每帧从"原始色"重算：连刷两帧不能一帧比一帧暗
  const firstPass = skin.color.r;
  model.update({ ...pose, flying: false }, () => ({ sky: 15, block: 0 }));
  check('连续两帧亮度不衰减（不会被反复相乘变黑）', close(skin.color.r, firstPass, 1e-6));

  // 火把旁（方块光 14）在没有天光的洞里也要亮起来
  model.update({ ...pose, flying: false }, () => ({ sky: 0, block: 14 }));
  check('洞里站在火把旁会被点亮（方块光生效）', skin.color.r > 0.5, `r=${skin.color.r.toFixed(3)}`);

  // 批次 241（用户："组成人物的方块可以更加精细"）：从"几根方棍"拆成更多零件
  let meshCount = 0;
  const shades = new Set<number>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount++;
    shades.add(model.shadeOf(mesh));
  });
  check('模型由 ≥ 30 块零件组成（原来 15 块）', meshCount >= 30, `实际 ${meshCount}`);
  check(
    '头部细节 ≥ 12 块（头 / 头发四片 / 耳 / 眉 / 眼 / 鼻 / 嘴）',
    head!.children.length >= 12,
    `实际 ${head!.children.length}`,
  );
  check(
    '同一部位有明暗分档（正色 + 压暗 + 提亮都在）',
    shades.has(1) && shades.has(0.85) && shades.has(1.06),
    [...shades].join(','),
  );
  check('头本体是正色（外观换颜色的样本块）', model.shadeOf(head!.children[0] as THREE.Mesh) === 1);
  check('shadeHex 压暗一半', shadeHex(0x808080, 0.5) === 0x404040);
  check('shadeHex 提亮 1.06（四舍五入）', shadeHex(0x808080, 1.06) === 0x888888);
  check('shadeHex 提亮封顶 255（不会溢出成别的颜色）', shadeHex(0xffffff, 1.5) === 0xffffff);

  model.dispose();
  check('dispose 后从场景移除', !scene.children.includes(root));
}

console.log(`\n视角测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
