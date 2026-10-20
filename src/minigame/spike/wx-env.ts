/**
 * 微信小游戏最小运行环境垫片（WX-001 spike 专用）
 *
 * ⚠️ 这不是最终的平台层。最终实现要等 WX-011 抽 `src/platform/types.ts` 之后，
 * 把「上屏/离屏 canvas、输入、存储、生命周期」按接口分开；这里只负责回答一个问题：
 *
 *   **three r186（WebGL2-only）在微信小游戏里能不能起来、能不能画出东西、帧率多少。**
 *
 * 之所以要垫片：小游戏只有 JS VM + wx API，没有 `window` / `document` /
 * `HTMLCanvasElement`。three 在创建渲染器时会调用 `canvas.addEventListener`、
 * `canvas.style`、`document.createElementNS('canvas')`，缺一个就抛异常。
 *
 * 这里只在「缺失时」补，不覆盖宿主已有实现，方便同一份代码以后在浏览器里也跑。
 */

/** 只声明本 spike 用到的 wx API，避免引入完整的小游戏类型包 */
declare const wx: {
  createCanvas(): Record<string, unknown>;
  getSystemInfoSync(): {
    screenWidth: number;
    screenHeight: number;
    windowWidth: number;
    windowHeight: number;
    pixelRatio: number;
    platform: string;
  };
  onTouchStart(callback: (event: Record<string, unknown>) => void): void;
  onTouchMove(callback: (event: Record<string, unknown>) => void): void;
  onTouchEnd(callback: (event: Record<string, unknown>) => void): void;
  showModal(options: { title: string; content: string; showCancel?: boolean }): void;
};

type AnyObject = Record<string, any>;

const info = wx.getSystemInfoSync();
const globalObject = globalThis as unknown as AnyObject;

/** 宿主对象上的属性可能是只读的，赋值失败就跳过 */
function ensure(object: AnyObject, key: string, value: unknown): void {
  try {
    if (object[key] === undefined) object[key] = value;
  } catch {
    /* 只读属性：跳过 */
  }
}

/**
 * 给 wx canvas 补上 three 会用到、但小游戏没有的几个成员。
 *
 * three 在 `new WebGLRenderer()` 里会注册 `webglcontextlost` 等事件，
 * 在 `setSize()` 里写 `canvas.style.width/height`；
 * 这些在浏览器里由 DOM 提供，小游戏里要自己补。
 */
function decorateCanvas(canvas: AnyObject): AnyObject {
  ensure(canvas, 'style', {});
  ensure(canvas, 'addEventListener', () => {});
  ensure(canvas, 'removeEventListener', () => {});
  ensure(canvas, 'setAttribute', () => {});
  ensure(canvas, 'getBoundingClientRect', () => ({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width: canvas.width ?? 0,
    height: canvas.height ?? 0,
    right: canvas.width ?? 0,
    bottom: canvas.height ?? 0,
  }));
  return canvas;
}

/** 非 canvas 的 DOM 元素只要“有个对象”即可（three 不会真的挂载它们） */
function makeElementStub(tagName: string): AnyObject {
  return {
    tagName: tagName.toUpperCase(),
    style: {},
    appendChild: () => {},
    removeChild: () => {},
    setAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

/** 逻辑分辨率（CSS px）。小游戏横屏下 windowWidth 已经是横屏后的宽 */
export const screen = {
  width: info.windowWidth || info.screenWidth,
  height: info.windowHeight || info.screenHeight,
  dpr: info.pixelRatio || 1,
};

/** 第一次 `wx.createCanvas()` 拿到的是上屏画布，后续都是离屏画布 */
export const mainCanvas = decorateCanvas(wx.createCanvas());

if (typeof globalObject.window === 'undefined') globalObject.window = globalObject;
if (typeof globalObject.self === 'undefined') globalObject.self = globalObject;
ensure(globalObject, 'devicePixelRatio', screen.dpr);
ensure(globalObject, 'innerWidth', screen.width);
ensure(globalObject, 'innerHeight', screen.height);
ensure(globalObject, 'navigator', {
  userAgent: 'wechat-minigame',
  platform: info.platform,
  maxTouchPoints: 5,
  hardwareConcurrency: 4,
});
ensure(globalObject, 'performance', { now: () => Date.now() });
ensure(globalObject, 'requestAnimationFrame', (callback: (time: number) => void) =>
  setTimeout(() => callback(Date.now()), 16),
);
ensure(globalObject, 'cancelAnimationFrame', (handle: number) => clearTimeout(handle));

if (typeof globalObject.document === 'undefined') {
  const doc: AnyObject = {
    createElement(tagName: string): AnyObject {
      return tagName === 'canvas' ? decorateCanvas(wx.createCanvas()) : makeElementStub(tagName);
    },
    createElementNS(_namespace: string, tagName: string): AnyObject {
      return doc.createElement(tagName);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    body: makeElementStub('body'),
    documentElement: { style: {} },
  };
  globalObject.document = doc;
}

/** 供 main 使用的 wx 句柄（避免每个文件都 declare 一次） */
export const wxApi = wx;
