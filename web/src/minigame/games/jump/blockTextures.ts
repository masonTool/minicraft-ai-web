/**
 * 特殊方块的**程序化贴图**（批次 20261024-0415，`[跳6]`）
 *
 * 原版四类特殊方块（井盖 / 魔方 / 便利店 / 音乐盒）在参考图上都只有小图，
 * 而且没有可用的素材源与授权。这里用 canvas 现画：不引入任何图片文件，
 * 也就不会给包体加东西，同时"像不像"由画法直接决定，改起来是改代码而不是换图。
 *
 * 三条设计约束：
 *
 *  1. **一份图集两格**：左半 = 顶面、右半 = 侧面。这样一块方块只需要**一张贴图 + 一份
 *     几何**，而不是给六个面各配一个材质（那会让 draw call 直接乘 6）。
 *  2. **canvas 工厂注入**：浏览器里传 `document.createElement('canvas')`，离线测试里传
 *     一个记录调用的假 canvas——于是"画了什么"可以被断言，而不是只能靠截图肉眼看。
 *  3. **按种类缓存**：同一局里四类方块各一张图，重复请求返回同一份 canvas，
 *     工厂只被调用一次/一类（`disposeTextureCache()` 清空，测试用）。
 *
 * 色值同样来自 `.continue/notes/jump-original.md` §10：井盖盘 #636468 + 警示黄 #F2C311、
 * 魔方蓝 #6A9BF9 / 红 #EE7467 / 黄 #CCA002、唱盘 #707271。
 */

/** 每格贴图边长（像素） */
export const TEXTURE_CELL = 128;

export const SPECIAL_KINDS = ['well', 'cube', 'store', 'music'] as const;
export type SpecialKind = (typeof SPECIAL_KINDS)[number];

/**
 * 只声明用得到的 2D 上下文方法：这样测试里的假上下文只要实现这几个函数就能通过类型检查，
 * 而浏览器的 `CanvasRenderingContext2D` 天然满足（它是这里的超集）。
 */
export interface Ctx2D {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  rect(x: number, y: number, width: number, height: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  clip(): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void };
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): { addColorStop(offset: number, color: string): void };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): Ctx2D | null;
}

export type CanvasFactory = (width: number, height: number) => CanvasLike;

/** 浏览器里的默认工厂（离线测试不要用它：node 没有 document） */
export const domCanvasFactory: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as CanvasLike;
};

const cache = new Map<SpecialKind, CanvasLike>();

/** 清空贴图缓存（测试用；游戏里不需要） */
export function disposeTextureCache(): void {
  cache.clear();
}

/**
 * 取某一类特殊方块的图集（左半顶面 / 右半侧面）。
 *
 * 同一类只会画一次：`factory` 的调用次数就是"这一局真的画了几张图"，
 * 也是断言里"工厂被调用次数"的来源。
 */
export function createBlockAtlas(kind: SpecialKind, factory: CanvasFactory = domCanvasFactory): CanvasLike {
  const cached = cache.get(kind);
  if (cached) return cached;
  const canvas = factory(TEXTURE_CELL * 2, TEXTURE_CELL);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.save();
    ctx.translate(0, 0);
    PAINTERS[kind](ctx, 'top');
    ctx.restore();
    ctx.save();
    ctx.translate(TEXTURE_CELL, 0);
    PAINTERS[kind](ctx, 'side');
    ctx.restore();
  }
  cache.set(kind, canvas);
  return canvas;
}

/** 图集里每个格子在 UV 上的范围：顶面 `[0, .5]`、侧面 `[.5, 1]`（三面明暗另由顶点色乘上去） */
export const ATLAS_U = { top: [0, 0.5] as const, side: [0.5, 1] as const };

// ------------------------------------------------------------------ 画法

/** 每类方块两幅画：`top` 画在左格、`side` 画在右格（坐标系已平移到各自格子左上角） */
const PAINTERS: Record<SpecialKind, (ctx: Ctx2D, face: 'top' | 'side') => void> = {
  /** 井盖：深灰盘 + 一圈管纹 + 中心小孔；侧面三条警示黄 */
  well(ctx, face) {
    const size = TEXTURE_CELL;
    if (face === 'top') {
      ctx.fillStyle = '#636468';
      ctx.fillRect(0, 0, size, size);
      // 盘沿
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = '#55565A';
      ctx.fill();
      // 内圈管纹（原版是一圈短管，这里画 24 条径向短线）
      ctx.strokeStyle = '#4A4B4F';
      ctx.lineWidth = 3;
      for (let i = 0; i < 24; i++) {
        const angle = (i / 24) * Math.PI * 2;
        const inner = size * 0.2;
        const outer = size * 0.4;
        ctx.beginPath();
        ctx.moveTo(size / 2 + Math.cos(angle) * inner, size / 2 + Math.sin(angle) * inner);
        ctx.lineTo(size / 2 + Math.cos(angle) * outer, size / 2 + Math.sin(angle) * outer);
        ctx.stroke();
      }
      // 中心孔
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = '#3A3B3F';
      ctx.fill();
      return;
    }
    ctx.fillStyle = '#55565A';
    ctx.fillRect(0, 0, size, size);
    // 三条黄黑警示带（原版侧面就是黄条）
    ctx.fillStyle = '#F2C311';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(0, size * (0.18 + i * 0.26), size, size * 0.12);
    }
    ctx.fillStyle = '#3E3F43';
    for (let i = 0; i < 3; i++) {
      const y = size * (0.18 + i * 0.26);
      for (let x = 0; x < 4; x++) ctx.fillRect(size * (x * 0.25 + 0.02), y, size * 0.12, size * 0.12);
    }
  },

  /** 魔方：3×3 彩色格 + 白色格线（顶面与侧面一样，只是配色顺序错开） */
  cube(ctx, face) {
    const size = TEXTURE_CELL;
    const cell = size / 3;
    const colors = face === 'top' ? ['#6A9BF9', '#6A9BF9', '#EE7467', '#CCA002', '#6A9BF9', '#EE7467', '#CCA002', '#6A9BF9', '#EE7467'] : ['#CCA002', '#EE7467', '#6A9BF9', '#EE7467', '#CCA002', '#6A9BF9', '#6A9BF9', '#EE7467', '#CCA002'];
    ctx.fillStyle = '#F6F6F6';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        ctx.fillStyle = colors[row * 3 + col]!;
        ctx.fillRect(col * cell + 3, row * cell + 3, cell - 6, cell - 6);
      }
    }
  },

  /** 便利店：浅灰屋顶；侧面是卷帘门 + 招牌 + 玻璃窗 */
  store(ctx, face) {
    const size = TEXTURE_CELL;
    if (face === 'top') {
      ctx.fillStyle = '#E4E2DD';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#D2D0CA';
      ctx.fillRect(0, 0, size, size * 0.08);
      ctx.fillRect(0, size * 0.92, size, size * 0.08);
      return;
    }
    ctx.fillStyle = '#EDEBE6';
    ctx.fillRect(0, 0, size, size);
    // 招牌
    ctx.fillStyle = '#E05A4F';
    ctx.fillRect(size * 0.06, size * 0.06, size * 0.88, size * 0.16);
    ctx.fillStyle = '#FFF3E8';
    ctx.fillRect(size * 0.14, size * 0.11, size * 0.22, size * 0.06);
    ctx.fillRect(size * 0.42, size * 0.11, size * 0.16, size * 0.06);
    // 玻璃窗
    ctx.fillStyle = '#9CC7D8';
    ctx.fillRect(size * 0.08, size * 0.28, size * 0.5, size * 0.44);
    ctx.fillStyle = '#C7E2EC';
    ctx.fillRect(size * 0.1, size * 0.3, size * 0.46, size * 0.12);
    // 卷帘门
    ctx.fillStyle = '#B9B4AC';
    ctx.fillRect(size * 0.64, size * 0.28, size * 0.28, size * 0.62);
    ctx.strokeStyle = '#A19C93';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(size * 0.64, size * (0.34 + i * 0.09));
      ctx.lineTo(size * 0.92, size * (0.34 + i * 0.09));
      ctx.stroke();
    }
    // 门框
    ctx.fillStyle = '#8C8880';
    ctx.fillRect(size * 0.62, size * 0.26, size * 0.32, size * 0.06);
  },

  /** 音乐盒：深灰唱盘 + 同心纹 + 中心孔；侧面是木色机箱 */
  music(ctx, face) {
    const size = TEXTURE_CELL;
    if (face === 'top') {
      ctx.fillStyle = '#707271';
      ctx.fillRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
      ctx.fillStyle = '#5C5E5D';
      ctx.fill();
      ctx.strokeStyle = '#4A4C4B';
      ctx.lineWidth = 2;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * (0.12 * i), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = '#E9E7E2';
      ctx.fill();
      return;
    }
    ctx.fillStyle = '#A9977E';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#8F7E66';
    ctx.fillRect(0, size * 0.42, size, size * 0.1);
    ctx.fillStyle = '#C0AE93';
    ctx.fillRect(0, size * 0.84, size, size * 0.16);
  },
};
