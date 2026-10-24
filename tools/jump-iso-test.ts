/**
 * 跳一跳的**等距投影与正交取景**离线断言（批次 20261024-0415，`[跳2]`）
 *
 * 运行：`npm run test:jumpiso`
 *
 * 这些断言盯的是"镜头对不对"，不是"画得好不好看"——后者只能靠截图比对。
 * 四条最值钱的：
 *
 *  1. **顶面菱形宽高比 2:1**：这是 30° 俯角的定义式结果，改成 35° 立刻变 1.74；
 *  2. **前进方向朝屏幕上方**：两条世界轴（−x / −z）必须分别投到右上 / 左上。
 *     方位写成 45°（而不是 225°）时画面会左右镜像，只有这条能抓住；
 *  3. **正交**：同尺寸方块放在远近不同的地方，投影尺寸必须一模一样。透视相机会缩小；
 *  4. **横竖屏都能看见 3 块**：用户是手机横屏玩（约 844×390），取景不能只对竖屏成立。
 *
 * 参考图与规格：`.continue/notes/jump-original.md` §1。
 */

import {
  BLOCK_HEIGHT_RATIO,
  ISO_VIEW,
  boxCorners,
  boxesFromBlocks,
  diamondAspect,
  frameBlocks,
  isoBasis,
  projectPoint,
  toFrameSpace,
  type IsoBox,
  type IsoFrame,
  type Vec3,
} from '../src/minigame/games/jump/iso.ts';
import { createRun, currentBlock, jump, targetBlock, type JumpRun } from '../src/minigame/games/jump/logic.ts';

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

function between(label: string, actual: number, min: number, max: number): void {
  check(label, actual >= min && actual <= max, `实际 ${actual}，期望 ${min} ~ ${max}`);
}

const basis = isoBasis();

/** 屏幕上"一块方块顶面的宽度"占视口宽度的比例：取景是否合适的硬指标 */
function blockWidthRatio(frame: IsoFrame, box: IsoBox): number {
  const corners = boxCorners(box).filter((corner) => corner.y === box.height);
  const xs = corners.map((corner) => toFrameSpace(frame, corner, basis).x);
  return (Math.max(...xs) - Math.min(...xs)) / (frame.right - frame.left);
}

/** 方块 8 个角是否都落在视锥里 */
function inside(frame: IsoFrame, box: IsoBox, slack = 0): boolean {
  if (!box) return false;
  return boxCorners(box).every((corner) => {
    const p = toFrameSpace(frame, corner, basis);
    return p.x >= frame.left - slack && p.x <= frame.right + slack && p.y >= frame.bottom - slack && p.y <= frame.top + slack;
  });
}

/** 一块方块从圆心往前几步的那条线上的第 n 块（测试用：不依赖生成器难度曲线） */
function runWithBlocks(seed: number, steps: number): JumpRun {
  let run = createRun(seed);
  for (let i = 0; i < steps; i++) {
    const from = currentBlock(run);
    const to = targetBlock(run);
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const outcome = jump(run, distance);
    if (outcome.over) break;
    run = outcome.run;
  }
  return run;
}

console.log('\n等距正交基');
{
  const { right, up, forward } = basis;
  const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
  near('right 是单位向量', Math.hypot(right.x, right.y, right.z), 1, 1e-9);
  near('up 是单位向量', Math.hypot(up.x, up.y, up.z), 1, 1e-9);
  near('forward 是单位向量', Math.hypot(forward.x, forward.y, forward.z), 1, 1e-9);
  near('right ⟂ up', dot(right, up), 0, 1e-9);
  near('right ⟂ forward', dot(right, forward), 0, 1e-9);
  near('up ⟂ forward', dot(up, forward), 0, 1e-9);
  near('俯角 = 30°（由 forward.y = −sin θ 反解）', Math.asin(-forward.y) / (Math.PI / 180), 30, 1e-9);
  check('视线朝 -x/-z（方位 225°：相机在 +x/+z 一侧）', forward.x < 0 && forward.z < 0);
  near('相机方位与视线相差 180°', Math.atan2(forward.z, forward.x) / (Math.PI / 180), -135, 1e-9);
}

console.log('\n顶面菱形与前进方向');
{
  near('顶面菱形宽高比 = 2.00（30° 俯角）', diamondAspect(basis), 2, 1e-9);

  // 相机站在 +x/+z 一侧，所以世界 −z 投到屏幕右上、−x 投到屏幕左上（两个前进方向）
  const stepX = projectPoint({ x: -1, y: 0, z: 0 }, basis);
  const stepZ = projectPoint({ x: 0, y: 0, z: -1 }, basis);
  check('−z 步进朝右上（dx > 0 且 dy > 0）', stepZ.x > 0 && stepZ.y > 0, `dx=${stepZ.x} dy=${stepZ.y}`);
  check('−x 步进朝左上（dx < 0 且 dy > 0）', stepX.x < 0 && stepX.y > 0, `dx=${stepX.x} dy=${stepX.y}`);
  near('−z 步进的屏幕斜率 = 0.5（tan45° × sin30°）', stepZ.y / stepZ.x, 0.5, 1e-9);
  near('−x 步进的屏幕斜率 = −0.5', stepX.y / stepX.x, -0.5, 1e-9);
  near('两向步进的屏幕长度相同（等距）', Math.hypot(stepX.x, stepX.y), Math.hypot(stepZ.x, stepZ.y), 1e-9);

  const up1 = projectPoint({ x: 0, y: 1, z: 0 }, basis);
  check('世界 +y 投到屏幕正上方', Math.abs(up1.x) < 1e-9 && up1.y > 0, `dx=${up1.x} dy=${up1.y}`);
  near('竖直方向按 cos30° 缩短', up1.y, Math.cos((30 * Math.PI) / 180), 1e-9);
}

console.log('\n正交（不是透视）');
{
  const size = 2;
  const height = size * BLOCK_HEIGHT_RATIO;
  const nearBox: IsoBox = { x: 0, z: 0, size, height };
  // 沿视线方向后退 6 格：透视相机会在这里明显变小
  const dir = basis.forward;
  const farBox: IsoBox = { x: -dir.x * 6, z: -dir.z * 6, size, height };
  const halfNear = 1; // 只要几何，不做取景
  const width = (box: IsoBox): number => {
    const xs = boxCorners(box)
      .filter((corner) => corner.y === box.height)
      .map((corner) => projectPoint(corner, basis).x);
    return (Math.max(...xs) - Math.min(...xs)) / halfNear;
  };
  near('远近两块方块的屏幕宽度完全相同', width(nearBox), width(farBox), 1e-9);
  check('正交投影下不存在"越远越小"', Math.abs(width(nearBox) - width(farBox)) < 1e-9);
  check('取景结果没有 fov 字段（正交 = 用 frustum 不用视场角）', !('fov' in frameBlocks({ boxes: [nearBox], focusIndex: 0, width: 844, height: 390 })));
}

console.log('\n取景：手机横屏 844×390');
{
  const run = runWithBlocks(11, 4);
  const blocks = run.blocks.slice(run.index - 1, run.index + 2);
  const boxes = boxesFromBlocks(blocks);
  const frame = frameBlocks({ boxes, focusIndex: 1, width: 844, height: 390 });
  check('3 块全部在视口内', boxes.every((box) => inside(frame, box)));
  near('视锥是矩形（left = −right、bottom = −top）', frame.left, -frame.right, 1e-9);
  near('视锥比例 = 844/390', frame.right / frame.top, 844 / 390, 1e-6);

  const focus = boxes[1]!;
  const focusScreen = toFrameSpace(frame, { x: focus.x, y: focus.height, z: focus.z }, basis);
  check('当前方块顶面中心在屏幕中线下方', focusScreen.y < 0, `y=${focusScreen.y}`);
  between('当前方块下沉量 = 半高的 8%~20%', -focusScreen.y / frame.top, 0.08, 0.2);

  const ratio = blockWidthRatio(frame, focus);
  between('方块占屏宽在合理区间（不会小到看不见、也不会糊满屏）', ratio, 0.1, 0.45);
  check('方块四周留了边距（不贴边）', Math.abs(focusScreen.x) < frame.right && Math.abs(focusScreen.y) < frame.top);
}

console.log('\n取景：新间距下的一屏 3 块（批次 20261024-1331）');
{
  // 真跑一局生成器（seed 固定），取"上一块 + 当前 + 下一块"这 3 块 —— 与 scene.rebuildBlocks 同口径
  const run = runWithBlocks(20261024, 6);
  const blocks = run.blocks.slice(Math.max(0, run.index - 1), run.index + 2);
  const boxes = boxesFromBlocks(blocks);
  const focusIndex = Math.min(1, boxes.length - 1);
  const frame = frameBlocks({ boxes, focusIndex, width: 844, height: 390 });
  check('3 块都在视口内（间距拉到 4.6~6.0 格之后仍然装得下）', boxes.every((box) => inside(frame, box)));
  between('当前方块仍占屏宽 10%~45%（不会小到看不清）', blockWidthRatio(frame, boxes[focusIndex]!), 0.1, 0.45);

  // 3 块的屏幕包络必须撑满视口**纵向**的 60% 以上：横屏下真正吃紧的是高度，
  // 方块沿前进方向往上排，纵向撑不满就等于把镜头拉远了（"拉大间距"白拉）。
  const corners = boxes.flatMap((box) => boxCorners(box));
  const ys = corners.map((corner) => toFrameSpace(frame, corner, basis).y);
  const spanRatio = (Math.max(...ys) - Math.min(...ys)) / (frame.top - frame.bottom);
  check('3 块纵向撑满视口（≥ 60%）', spanRatio >= 0.6, `${(spanRatio * 100).toFixed(0)}%`);

  // 下一块必须在当前块的"前方"（屏幕上方），否则镜头方向反了
  const focusScreen = toFrameSpace(frame, { x: boxes[focusIndex]!.x, y: boxes[focusIndex]!.height, z: boxes[focusIndex]!.z }, basis);
  const nextBox = boxes[focusIndex + 1] ?? boxes[focusIndex]!;
  const nextScreen = toFrameSpace(frame, { x: nextBox.x, y: nextBox.height, z: nextBox.z }, basis);
  check('下一块在当前块的前方（屏幕更靠上）', nextScreen.y > focusScreen.y, `${nextScreen.y.toFixed(2)} vs ${focusScreen.y.toFixed(2)}`);
}

console.log('\n取景：竖屏 390×844');
{
  const run = runWithBlocks(11, 4);
  const blocks = run.blocks.slice(run.index - 1, run.index + 2);
  const boxes = boxesFromBlocks(blocks);
  const frame = frameBlocks({ boxes, focusIndex: 1, width: 390, height: 844 });
  check('3 块全部在视口内', boxes.every((box) => inside(frame, box)));
  near('视锥比例 = 390/844', frame.right / frame.top, 390 / 844, 1e-6);
  between('方块占屏宽在合理区间', blockWidthRatio(frame, boxes[1]!), 0.1, 0.45);
}

console.log('\n取景：小人与边距');
{
  const run = runWithBlocks(5, 2);
  const boxes = boxesFromBlocks(run.blocks.slice(run.index, run.index + 2));
  const focus = boxes[0]!;
  const withoutHead = frameBlocks({ boxes, focusIndex: 0, width: 844, height: 390 });
  const withHead = frameBlocks({ boxes, focusIndex: 0, width: 844, height: 390, headroom: focus.size * 0.72 });
  check('留头位后半高不小于不留头位', withHead.top >= withoutHead.top);

  const headTop: Vec3 = { x: focus.x, y: focus.height + focus.size * 0.72, z: focus.z };
  const p = toFrameSpace(withHead, headTop, basis);
  check('小人头顶落在视口内', p.y <= withHead.top && p.y >= withHead.bottom, `y=${p.y} top=${withHead.top}`);

  const margin = frameBlocks({ boxes, focusIndex: 0, width: 844, height: 390, view: { ...ISO_VIEW, margin: 1.4 } });
  check('边距调大 → 视锥变大（镜头拉远）', margin.top > withoutHead.top);
}

console.log('\n退化输入不产生 NaN');
{
  const empty = frameBlocks({ boxes: [], focusIndex: 3, width: 844, height: 390 });
  const numbers = [empty.left, empty.right, empty.top, empty.bottom, empty.position.x, empty.position.y, empty.position.z];
  check('空方块列表：所有数都是有限的', numbers.every((v) => Number.isFinite(v)));
  check('空方块列表：视锥不为零', empty.top > 0 && empty.right > 0);

  const zero = frameBlocks({ boxes: [{ x: 0, z: 0, size: 0, height: 0 }], focusIndex: 0, width: 0, height: 0 });
  const zeroNumbers = [zero.left, zero.right, zero.top, zero.bottom];
  check('零尺寸视口/方块：所有数仍是有限的', zeroNumbers.every((v) => Number.isFinite(v)));
  near('零宽视口被夹到 aspect 下限 0.2', zero.aspect, 0.2, 1e-9);

  const bad = frameBlocks({
    boxes: [{ x: Number.NaN, z: 0, size: 2, height: 1 }],
    focusIndex: -5,
    width: 844,
    height: 390,
  });
  check('脏坐标被过滤，不污染取景', Number.isFinite(bad.top) && bad.top > 0);
}

console.log('\n相机位置与目标');
{
  const boxes = boxesFromBlocks(runWithBlocks(3, 1).blocks);
  const frame = frameBlocks({ boxes, focusIndex: 0, width: 844, height: 390 });
  const dir = {
    x: frame.position.x - frame.target.x,
    y: frame.position.y - frame.target.y,
    z: frame.position.z - frame.target.z,
  };
  const length = Math.hypot(dir.x, dir.y, dir.z);
  near('相机在目标的固定距离上（正交下只影响裁剪）', length, frame.distance, 1e-6);
  near('相机在目标右后上方（y > 0）', dir.y / length, Math.sin((30 * Math.PI) / 180), 1e-9);
  check('相机 up 是世界竖直方向', frame.up.x === 0 && frame.up.y === 1 && frame.up.z === 0);
  check('near/far 夹住了所有方块到相机的距离', frame.near > 0 && frame.far > frame.distance);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
