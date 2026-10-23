/**
 * 特殊方块贴图的离线断言（批次 20261024-0415，`[跳6]`）
 *
 * 运行：`npm run test:jumptex`
 *
 * 贴图是 canvas 画出来的，没法在 node 里"看"，但可以问清楚三件事：
 *
 *  1. **画了几张、多大**：一类方块一张图集（左半顶面 / 右半侧面），工厂调用次数与尺寸
 *     是硬指标——多画一张就是多一份显存，画小了会糊；
 *  2. **四类画法确实不同**：把 2D 调用序列当指纹，四类撞车说明某两类在画同一张图
 *     （这类 bug 在截图里只是"看起来都是深灰"，很难发现）；
 *  3. **关键图元在**：井盖有同心圆、魔方是 3×3 网格、便利店有招牌红、唱片有多圈纹。
 *
 * 假 canvas 只实现 `blockTextures.ts` 声明的那几个方法，所以断言的是"我们自己的画法"，
 * 不依赖浏览器的真实渲染。
 */

import {
  ATLAS_U,
  SPECIAL_KINDS,
  TEXTURE_CELL,
  createBlockAtlas,
  disposeTextureCache,
  type CanvasFactory,
  type CanvasLike,
  type Ctx2D,
} from '../src/minigame/games/jump/blockTextures.ts';

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

class StubCtx implements Ctx2D {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  readonly ops: string[] = [];
  readonly fills: string[] = [];
  readonly fillsAt: Array<{ x: number; w: number; h: number }> = [];
  readonly arcs: Array<{ r: number }> = [];
  private offsetX = 0;
  readonly savedX: number[] = [];

  save(): void {
    this.ops.push('save');
    this.savedX.push(this.offsetX);
  }
  restore(): void {
    this.ops.push('restore');
    this.offsetX = this.savedX.pop() ?? 0;
  }
  beginPath(): void {
    this.ops.push('beginPath');
  }
  closePath(): void {
    this.ops.push('closePath');
  }
  moveTo(): void {
    this.ops.push('moveTo');
  }
  lineTo(): void {
    this.ops.push('lineTo');
  }
  arc(_x: number, _y: number, radius: number): void {
    this.ops.push('arc');
    this.arcs.push({ r: radius });
  }
  rect(): void {
    this.ops.push('rect');
  }
  fill(): void {
    this.ops.push('fill');
    this.fills.push(this.fillStyle);
  }
  stroke(): void {
    this.ops.push('stroke');
  }
  fillRect(x: number, _y: number, w: number, h: number): void {
    this.ops.push('fillRect');
    this.fills.push(this.fillStyle);
    this.fillsAt.push({ x: x + this.offsetX, w, h });
  }
  strokeRect(): void {
    this.ops.push('strokeRect');
  }
  translate(x: number): void {
    this.ops.push('translate');
    this.offsetX += x;
  }
  rotate(): void {
    this.ops.push('rotate');
  }
  clip(): void {
    this.ops.push('clip');
  }
  createLinearGradient(): { addColorStop(): void } {
    this.ops.push('linearGradient');
    return { addColorStop: (): void => undefined };
  }
  createRadialGradient(): { addColorStop(): void } {
    this.ops.push('radialGradient');
    return { addColorStop: (): void => undefined };
  }
}

interface StubCanvas extends CanvasLike {
  readonly ctx: StubCtx;
}

function makeFactory(): { factory: CanvasFactory; canvases: StubCanvas[] } {
  const canvases: StubCanvas[] = [];
  const factory: CanvasFactory = (width, height) => {
    const ctx = new StubCtx();
    const canvas: StubCanvas = { width, height, ctx, getContext: () => ctx };
    canvases.push(canvas);
    return canvas;
  };
  return { factory, canvases };
}

console.log('\n图集尺寸与缓存');
{
  disposeTextureCache();
  const { factory, canvases } = makeFactory();
  const atlases = SPECIAL_KINDS.map((kind) => createBlockAtlas(kind, factory));
  check('四类各画一张', canvases.length === SPECIAL_KINDS.length, `${canvases.length}`);
  check(
    '图集尺寸 = 2 格宽 × 1 格高',
    canvases.every((canvas) => canvas.width === TEXTURE_CELL * 2 && canvas.height === TEXTURE_CELL),
    canvases.map((c) => `${c.width}x${c.height}`).join(','),
  );
  check('同类第二次请求复用缓存（不重画）', (() => {
    const again = createBlockAtlas('well', factory);
    return again === atlases[0] && canvases.length === SPECIAL_KINDS.length;
  })());
  check('四类各自独立（不是同一张图被复用）', new Set(atlases).size === SPECIAL_KINDS.length);
  check(
    'UV 两格不重叠且拼满 0~1',
    ATLAS_U.top[0] === 0 && ATLAS_U.top[1] === ATLAS_U.side[0] && ATLAS_U.side[1] === 1,
  );
  check('disposeTextureCache 之后会重画', (() => {
    disposeTextureCache();
    createBlockAtlas('well', factory);
    return canvases.length === SPECIAL_KINDS.length + 1;
  })());
}

console.log('\n顶面画左格、侧面画右格');
{
  disposeTextureCache();
  const { factory, canvases } = makeFactory();
  createBlockAtlas('well', factory);
  const ctx = canvases[0]!.ctx;
  const translates = ctx.ops.filter((op) => op === 'translate').length;
  check('两次 save/restore + 两次 translate（顶面/侧面各一次）', translates === 2 && ctx.savedX.length === 0);
  const xs = new Set(ctx.fillsAt.map((fill) => fill.x >= TEXTURE_CELL));
  check('侧面的图元落在右半格（x ≥ 128）', xs.has(true));
  check('顶面的图元落在左半格（x < 128）', xs.has(false));
}

console.log('\n四类画法互不相同');
{
  disposeTextureCache();
  const { factory, canvases } = makeFactory();
  for (const kind of SPECIAL_KINDS) createBlockAtlas(kind, factory);
  const signatures = canvases.map((canvas) => canvas.ctx.ops.join(',') + '|' + canvas.ctx.fills.join(','));
  check('四类指纹两两不同', new Set(signatures).size === SPECIAL_KINDS.length, `${new Set(signatures).size}`);
  check(
    '每类都真的画了东西（> 20 次 2D 调用）',
    canvases.every((canvas) => canvas.ctx.ops.length > 20),
    canvases.map((c) => c.ctx.ops.length).join(','),
  );
}

console.log('\n关键图元（像不像的底线）');
{
  disposeTextureCache();
  const { factory, canvases } = makeFactory();
  const well = createBlockAtlas('well', factory);
  const cube = createBlockAtlas('cube', factory);
  const store = createBlockAtlas('store', factory);
  const music = createBlockAtlas('music', factory);
  check('井盖/魔方/便利店/唱片都拿到图集', Boolean(well && cube && store && music));

  const wellCtx = canvases[0]!.ctx;
  check('井盖顶面有圆盘（arc）', wellCtx.arcs.length >= 2, `${wellCtx.arcs.length}`);
  check('井盖侧面用警示黄 #F2C311', wellCtx.fills.includes('#F2C311'));

  const cubeCtx = canvases[1]!.ctx;
  const tiles = cubeCtx.fillsAt.filter((fill) => fill.w < TEXTURE_CELL / 2 && fill.h < TEXTURE_CELL / 2);
  check('魔方是 3×3 分格（18 个小格：两面各 9 个）', tiles.length === 18, `${tiles.length}`);
  check('魔方三色齐全', ['#6A9BF9', '#EE7467', '#CCA002'].every((color) => cubeCtx.fills.includes(color)));

  const storeCtx = canvases[2]!.ctx;
  check('便利店招牌是红色', storeCtx.fills.includes('#E05A4F'));
  check('便利店有玻璃窗', storeCtx.fills.includes('#9CC7D8'));

  const musicCtx = canvases[3]!.ctx;
  check('唱片顶面至少 4 圈纹', musicCtx.arcs.length >= 4, `${musicCtx.arcs.length}`);
  check('唱片中心孔是浅色', musicCtx.fills.includes('#E9E7E2'));
}

console.log('\n脏输入');
{
  disposeTextureCache();
  const { factory } = makeFactory();
  for (const kind of SPECIAL_KINDS) {
    const canvas = createBlockAtlas(kind, factory);
    check(`${kind} 的图集尺寸有限且为正`, Number.isFinite(canvas.width) && canvas.width > 0);
  }
  const broken: CanvasFactory = () => ({ width: 0, height: 0, getContext: () => null }) as CanvasLike;
  disposeTextureCache();
  let threw = false;
  try {
    createBlockAtlas('well', broken);
  } catch {
    threw = true;
  }
  check('拿不到 2D 上下文时不抛异常（静默降级）', !threw);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
