/**
 * 跳一跳的**等距投影与正交取景**（批次 20261024-0415，`[跳2]`）
 *
 * 只做三件事，而且都是纯函数（不 import three、不碰 DOM，能离线断言）：
 *
 *  1. `isoBasis()`：由「俯角 + 方位」算出相机的正交基（right / up / forward）；
 *  2. `projectPoint()`：把世界坐标投到屏幕平面上（**仍用世界单位**，方便断言比例）；
 *  3. `frameBlocks()`：给一批方块和视口尺寸，算出正交相机的 position / target / frustum。
 *
 * 数值来源是 `.continue/notes/jump-original.md` §1。俯角 30° 不是随手挑的：
 * 它让「顶面正方形」投到屏幕上正好是宽高比 2:1 的菱形，与参考图实测的 249×130 对得上
 * （sin 30° = 0.5）。改成 35° 会变成 1.74:1，一眼就与原版不同。
 *
 * 三条最容易写错、也都有断言守着的地方：
 *
 *  · **方位 225° 指视线方向**（相机站在 45° 那一侧），不是相机位置。写反了画面左右镜像，
 *    而且镜像之后仍然"看起来正常"，只有拿前进方向去断言才能发现；
 *  · **正交的硬判据**是"同一个方块放在远近不同的位置，屏幕尺寸完全一样"。这条断言比
 *    `instanceof OrthographicCamera` 有意义——它抓的是"几何算成了透视"这种真实退化；
 *  · 取景以**当前方块顶面中心在屏幕略偏下**为基准（原版 0.57H），否则小人站在正中，
 *    下一块的方向上没地方了。
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 等距投影的四个可调项（改这里 = 改整套镜头的性格，不要散落到各文件） */
export interface IsoView {
  /** 俯角（度）：30° → 顶面菱形宽高比 2:1 */
  readonly elevationDeg: number;
  /** 视线方位（度，世界 xz 平面上从 +x 转向 +z）：225° = 从左前上方看 */
  readonly azimuthDeg: number;
  /** 取景边距：1.15 = 四周各留 15% 空 */
  readonly margin: number;
  /** 当前方块顶面中心落在屏幕竖向哪里（0 = 正中，正数 = 偏下） */
  readonly focusBias: number;
}

export const ISO_VIEW: IsoView = {
  elevationDeg: 30,
  azimuthDeg: 225,
  margin: 1.15,
  focusBias: 0.12,
};

/** 方块高度 / 边长（规格表 §2：实测 0.60） */
export const BLOCK_HEIGHT_RATIO = 0.6;
/** 小人高度 / 边长（规格表 §4：实测 0.72） */
export const JUMPER_HEIGHT_RATIO = 0.72;

const DEG = Math.PI / 180;
/** 正交相机离目标的距离：只影响裁剪，不影响缩放 */
const CAMERA_DISTANCE = 24;
/** 取景半高的下限（世界单位）：方块退化成一个点时也不把镜头贴到脸上 */
const MIN_HALF_HEIGHT = 0.5;

export interface IsoBasis {
  /** 屏幕向右的单位向量（世界坐标） */
  readonly right: Vec3;
  /** 屏幕向上的单位向量 */
  readonly up: Vec3;
  /** 视线方向（相机 → 目标）的单位向量 */
  readonly forward: Vec3;
}

/**
 * 由俯角/方位算正交基。
 *
 * 约定与 three 的 `Object3D.lookAt` 完全一致（`z = eye - target`、`x = normalize(up × z)`、
 * `y = z × x`），这样把这里的 `position/up/target` 直接喂给 `camera.lookAt()` 就是同一套基，
 * 不需要在渲染层再补一个抵消旋转。
 */
export function isoBasis(view: IsoView = ISO_VIEW): IsoBasis {
  const az = view.azimuthDeg * DEG;
  const el = view.elevationDeg * DEG;
  const forward: Vec3 = {
    x: Math.cos(el) * Math.cos(az),
    y: -Math.sin(el),
    z: Math.cos(el) * Math.sin(az),
  };
  // three 里的 z 轴 = eye - target = -forward
  const zAxis: Vec3 = { x: -forward.x, y: -forward.y, z: -forward.z };
  const right = normalize({ x: zAxis.z, y: 0, z: -zAxis.x });
  const up = normalize(cross(zAxis, right));
  return { right, up, forward };
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** 世界坐标 → 屏幕平面（世界单位，x 向右、y 向上；未除以视口大小） */
export function projectPoint(point: Vec3, basis: IsoBasis = isoBasis()): ScreenPoint {
  return { x: dot(point, basis.right), y: dot(point, basis.up) };
}

/** 世界 xz 平面上边长 1 的正方形顶面，投到屏幕后的「宽 / 高」：30° → 正好 2 */
export function diamondAspect(basis: IsoBasis = isoBasis()): number {
  const corners: ScreenPoint[] = [
    { x: -0.5, z: -0.5 },
    { x: 0.5, z: -0.5 },
    { x: 0.5, z: 0.5 },
    { x: -0.5, z: 0.5 },
  ].map((c) => projectPoint({ x: c.x, y: 0, z: c.z }, basis));
  const width = Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x));
  const height = Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y));
  return width / Math.max(1e-9, height);
}

/** 一块方块（底面贴 y = 0 的平面） */
export interface IsoBox {
  readonly x: number;
  readonly z: number;
  /** 边长 */
  readonly size: number;
  /** 高度（顶面的 y 坐标） */
  readonly height: number;
}

/** 把逻辑层的方块（只有 x/z/size）补成带高度的盒子 */
export function boxesFromBlocks(blocks: readonly { x: number; z: number; size: number }[]): IsoBox[] {
  return blocks.map((b) => ({
    x: b.x,
    z: b.z,
    size: b.size,
    height: Math.max(0.05, b.size * BLOCK_HEIGHT_RATIO),
  }));
}

/** 方块 8 个角（底面 4 + 顶面 4） */
export function boxCorners(box: IsoBox): Vec3[] {
  const half = Math.max(0, box.size) / 2;
  const corners: Vec3[] = [];
  for (const y of [0, box.height]) {
    for (const dx of [-half, half]) {
      for (const dz of [-half, half]) {
        corners.push({ x: box.x + dx, y, z: box.z + dz });
      }
    }
  }
  return corners;
}

/** 取景结果：直接能喂给 `OrthographicCamera` 的一组数 */
export interface IsoFrame {
  readonly position: Vec3;
  /** 相机注视点 = 正交视锥的中心 */
  readonly target: Vec3;
  /** 相机 up（永远是世界上方向：本作不滚转） */
  readonly up: Vec3;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
  readonly distance: number;
  /** 参与取景的视口比例（已夹住下限，避免 0 宽视口算出 Infinity） */
  readonly aspect: number;
}

export interface FrameOptions {
  /** 这一帧要画的方块（通常 3~4 块：上一块、当前块、下一块、下下块） */
  readonly boxes: readonly IsoBox[];
  /** 当前站着的方块在这批里的下标 */
  readonly focusIndex: number;
  readonly width: number;
  readonly height: number;
  /** 当前方块顶面以上还要留多少世界高度（给小人留头位），默认 0 */
  readonly headroom?: number;
  readonly view?: IsoView;
}

/**
 * 定正交视锥。
 *
 * 做法是"先量再定"而不是猜一个距离：
 *  1. 以当前方块**顶面中心**为锚点，把所有方块角点投到屏幕平面，量出上下左右各有多少；
 *  2. 半高取「上边够放 / 下边够放 / 水平方向够放」三者的最大值（再乘边距）；
 *  3. 竖直锚点整体上移 `focusBias × 半高`，于是当前方块落在屏幕中线偏下。
 *
 * 因为是正交投影，`distance` 只影响裁剪面，不影响画面大小——缩放全在 frustum 里。
 */
export function frameBlocks(options: FrameOptions): IsoFrame {
  const view = options.view ?? ISO_VIEW;
  const basis = isoBasis(view);
  const aspect = clamp(options.width / Math.max(1e-6, options.height), 0.2, 5);
  const boxes = options.boxes.filter((box) => Number.isFinite(box.x) && Number.isFinite(box.z));
  const focus = boxes[clampIndex(options.focusIndex, boxes.length)];

  // 退化输入（还没生成方块 / 视口为 0）：给一个"看住原点"的帧，绝不返回 NaN
  if (!focus) {
    return frameAround({ x: 0, y: 0, z: 0 }, aspect, view, 0);
  }

  const anchor: Vec3 = { x: focus.x, y: focus.height, z: focus.z };
  const anchorScreen = projectPoint(anchor, basis);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    for (const corner of boxCorners(box)) {
      const p = projectPoint(corner, basis);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return frameAround(anchor, aspect, view, 0);
  }

  // 相对锚点的四个方向各有多少（世界单位）
  const upExtent = maxY - anchorScreen.y;
  const downExtent = anchorScreen.y - minY;
  // 小人头顶：世界竖直高度 h 在屏幕上按 cos(俯角) 缩短
  const headroom = Math.max(0, Number.isFinite(options.headroom ?? 0) ? (options.headroom ?? 0) : 0);
  const upWithHead = Math.max(upExtent, headroom * Math.cos(view.elevationDeg * DEG));

  // bbox 的水平中点相对锚点有多少（minX/maxX 是世界投影的**绝对值**，必须先减锚点）
  const midX = (minX + maxX) / 2 - anchorScreen.x;
  const halfWidthNeed = (maxX - minX) / 2;
  const bias = clamp(view.focusBias, -0.6, 0.6);
  const margin = Math.max(1, view.margin);

  // 锚点被放在中线偏下 bias×halfH 处 → 上方可用 (1+bias)×halfH、下方 (1−bias)×halfH
  const halfHeight = Math.max(
    MIN_HALF_HEIGHT,
    (upWithHead * margin) / (1 + bias),
    (downExtent * margin) / (1 - bias),
    (halfWidthNeed * margin) / aspect,
  );
  const halfWidth = halfHeight * aspect;

  const target: Vec3 = {
    x: anchor.x + basis.right.x * midX + basis.up.x * (bias * halfHeight),
    y: anchor.y + basis.right.y * midX + basis.up.y * (bias * halfHeight),
    z: anchor.z + basis.right.z * midX + basis.up.z * (bias * halfHeight),
  };

  return {
    position: {
      x: target.x - basis.forward.x * CAMERA_DISTANCE,
      y: target.y - basis.forward.y * CAMERA_DISTANCE,
      z: target.z - basis.forward.z * CAMERA_DISTANCE,
    },
    target,
    up: { x: 0, y: 1, z: 0 },
    left: -halfWidth,
    right: halfWidth,
    top: halfHeight,
    bottom: -halfHeight,
    near: 0.1,
    far: CAMERA_DISTANCE * 2 + Math.max(4, halfHeight * 2),
    distance: CAMERA_DISTANCE,
    aspect,
  };
}

/**
 * 屏幕空间坐标（相对视锥中心，世界单位）。
 *
 * 渲染层不用它（three 自己会投），但断言要用："这块方块在不在视口里""占屏宽多少"都靠它。
 */
export function toFrameSpace(frame: IsoFrame, point: Vec3, basis: IsoBasis = isoBasis()): ScreenPoint {
  const rel: Vec3 = {
    x: point.x - frame.target.x,
    y: point.y - frame.target.y,
    z: point.z - frame.target.z,
  };
  return { x: dot(rel, basis.right), y: dot(rel, basis.up) };
}

// ------------------------------------------------------------------ 内部

function frameAround(anchor: Vec3, aspect: number, view: IsoView, headroom: number): IsoFrame {
  const basis = isoBasis(view);
  const halfHeight = Math.max(MIN_HALF_HEIGHT, headroom / 2 + 1);
  const halfWidth = halfHeight * aspect;
  const target: Vec3 = { ...anchor };
  return {
    position: {
      x: target.x - basis.forward.x * CAMERA_DISTANCE,
      y: target.y - basis.forward.y * CAMERA_DISTANCE,
      z: target.z - basis.forward.z * CAMERA_DISTANCE,
    },
    target,
    up: { x: 0, y: 1, z: 0 },
    left: -halfWidth,
    right: halfWidth,
    top: halfHeight,
    bottom: -halfHeight,
    near: 0.1,
    far: CAMERA_DISTANCE * 2 + Math.max(4, halfHeight * 2),
    distance: CAMERA_DISTANCE,
    aspect,
  };
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(index)));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (!(length > 1e-9)) return { x: 0, y: 1, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
