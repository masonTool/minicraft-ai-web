/**
 * 触控按钮图标的**唯一真源**（24×24 视口）
 *
 * 这六个图标原来只存在于 `ui/TouchIcons.ts` 的 HTML 字符串里（`<path d="…"/>` +
 * `<rect>` + `<circle>`），canvas 拿不到 —— 而"照着眼睛抄一份路径"是最容易悄悄画歪的做法
 * （歪了也不会报错，只是看起来不像那个东西）。所以按 `vitalsArt.ts` 的老办法：
 * **把图形数据上移到这里**，DOM 由它拼 `<svg>`，canvas 由它拼 `Path2D`。
 *
 * 依赖方向：`ui/ → ui2d/`（`ui/TouchIcons.ts` 反过来 import 这里）。
 */

export const TOUCH_ICON_NAMES = ['jump', 'sneak', 'inventory', 'chat', 'pause', 'view'] as const;
export type TouchIconName = (typeof TOUCH_ICON_NAMES)[number];

/**
 * 一个图标的组成（只画**填充色块**，不用描边：24px 里描边容易糊成一团）。
 *
 * `alpha` 是给"次要部件"用的（背包的前袋压到 0.6，与原 SVG 的 `opacity` 一致）。
 */
export type TouchIconShape =
  | { readonly kind: 'path'; readonly d: string; readonly evenodd?: boolean; readonly alpha?: number }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly rx?: number;
      readonly alpha?: number;
    }
  | {
      readonly kind: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly alpha?: number;
    };

/** 24×24 视口里的图标形状（与 `index.html` 里的 `.touch-button svg` 尺寸约定一致） */
export const TOUCH_ICON_SHAPES: Readonly<Record<TouchIconName, readonly TouchIconShape[]>> = {
  // 跳跃：向上的箭头 + 脚下的地面线（"往上跳"而不是"向上"）
  jump: [
    { kind: 'path', d: 'M12 3l6.5 7.5H15V16H9v-5.5H5.5z' },
    { kind: 'rect', x: 4, y: 18, w: 16, h: 2.4, rx: 1.2 },
  ],
  // 潜行：向下的箭头 + 地面线（蹲下）
  sneak: [
    { kind: 'path', d: 'M12 21l-6.5-7.5H9V8h6v5.5h3.5z' },
    { kind: 'rect', x: 4, y: 3.6, w: 16, h: 2.4, rx: 1.2 },
  ],
  // 背包：包体 + 双肩带 + 前袋（前袋半透明）
  inventory: [
    {
      kind: 'path',
      d: 'M6 8h12a2.4 2.4 0 0 1 2.4 2.4v7.2A2.4 2.4 0 0 1 18 20H6a2.4 2.4 0 0 1-2.4-2.4v-7.2A2.4 2.4 0 0 1 6 8z',
    },
    { kind: 'path', d: 'M9 8V6.4a3 3 0 0 1 6 0V8h-2.2V6.6a.8.8 0 0 0-1.6 0V8z' },
    { kind: 'rect', x: 8, y: 13, w: 8, h: 2.2, rx: 1.1, alpha: 0.6 },
  ],
  // 聊天 / 命令：对话气泡
  chat: [
    {
      kind: 'path',
      d: 'M4 5.4A2.4 2.4 0 0 1 6.4 3h11.2A2.4 2.4 0 0 1 20 5.4v7.2a2.4 2.4 0 0 1-2.4 2.4H9.6L4 20z',
    },
  ],
  // 暂停 / 设置：两条竖杠
  pause: [
    { kind: 'rect', x: 6, y: 4.4, w: 4.2, h: 15.2, rx: 1.4 },
    { kind: 'rect', x: 13.8, y: 4.4, w: 4.2, h: 15.2, rx: 1.4 },
  ],
  // 视角：一只眼睛（evenodd 挖出虹膜 + 实心瞳孔）
  view: [
    {
      kind: 'path',
      evenodd: true,
      d: 'M12 4.4C6.4 4.4 2.6 8.5 1.2 12c1.4 3.5 5.2 7.6 10.8 7.6S21.4 15.5 22.8 12C21.4 8.5 17.6 4.4 12 4.4zm0 3.2a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z',
    },
    { kind: 'circle', cx: 12, cy: 12, r: 2.1 },
  ],
};

/** 图标在按钮里占多大（按钮直径的比例，与原 CSS 的 `svg` 尺寸一致） */
export const TOUCH_ICON_SCALE = 0.5;

/** 把一个形状拼回 SVG 片段（`ui/TouchIcons.ts` 用） */
export function shapeToSvgMarkup(shape: TouchIconShape): string {
  const alpha = shape.alpha !== undefined ? ` opacity="${shape.alpha}"` : '';
  if (shape.kind === 'path') {
    const rule = shape.evenodd ? ' fill-rule="evenodd"' : '';
    return `<path${rule}${alpha} d="${shape.d}"/>`;
  }
  if (shape.kind === 'rect') {
    const rx = shape.rx !== undefined ? ` rx="${shape.rx}"` : '';
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}"${rx}${alpha}/>`;
  }
  return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"${alpha}/>`;
}

/** 图标的完整 `<svg>` 串（24×24，`fill="currentColor"` 让颜色跟着文字走） */
export function touchIconSvgMarkup(name: TouchIconName): string {
  const body = TOUCH_ICON_SHAPES[name].map(shapeToSvgMarkup).join('');
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
}
