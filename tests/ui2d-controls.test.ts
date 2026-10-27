/**
 * canvas 控件库的离线断言（`src/ui2d/controls.ts`，阶段 1）
 *
 * 只测**"命中 → 状态 → 回调"**这条链里的纯函数部分：滑块拖到哪儿算多少、
 * 下拉什么时候往上翻、列表滚到头会不会滚出空档、提示框会不会被屏幕边切掉。
 * 像素长什么样不测（那要靠预览页截图与真机）。
 *
 * 为什么这些值得钉：它们每一条错了都只是"手感不对"或"偶尔点不到"，
 * 而这类问题**在真机上是间歇性的**——用手指复现十次可能都碰不到那个边界。
 *
 * 运行：`npm run test:unit`（或 `npx vitest run tests/ui2d-controls.test.ts`）
 */
import { describe, expect, it } from 'vitest';
import {
  SLIDER_KNOB,
  clampListScroll,
  controlRegion,
  dropdownIndexAt,
  dropdownMenuRect,
  insetRect,
  listContentHeight,
  listMaxScroll,
  listScrollByWheel,
  listVisibleRange,
  modalRect,
  sliderRatioFromX,
  sliderRatioStep,
  sliderTrackRange,
  tabIndexAt,
  tabRects,
  toggleNext,
  tooltipRect,
} from '../src/ui2d/controls.ts';
import { hitRegionAt } from '../src/ui2d/input.ts';

describe('控件命中区域', () => {
  it('登记的是矩形，圆角不参与命中', () => {
    const region = controlRegion('ok', { x: 10, y: 20, w: 30, h: 10 });
    expect(region).toEqual({ id: 'ok', x: 10, y: 20, w: 30, h: 10, layer: 0 });
    expect(hitRegionAt([region], 10, 20)?.id).toBe('ok');
    expect(hitRegionAt([region], 39, 29)?.id).toBe('ok');
    // 右下边界是开区间：相邻矩形不会同时命中
    expect(hitRegionAt([region], 40, 30)).toBeNull();
  });

  it('insetRect 内缩后仍然非负（描边留位置时不会做出负宽度）', () => {
    expect(insetRect({ x: 0, y: 0, w: 10, h: 10 }, 2)).toEqual({ x: 2, y: 2, w: 6, h: 6 });
    const thin = insetRect({ x: 0, y: 0, w: 4, h: 4 }, 5);
    expect(thin.w).toBe(0);
    expect(thin.h).toBe(0);
  });
});

describe('开关', () => {
  it('点一下翻转（开关只有两态，调用方只存一个 bool）', () => {
    expect(toggleNext(false)).toBe(true);
    expect(toggleNext(true)).toBe(false);
  });
});

describe('滑块', () => {
  const rect = { x: 100, y: 50, w: 200, h: 20 };

  it('可拖动范围两端各留半个钮（0% / 100% 的钮不会被裁）', () => {
    const range = sliderTrackRange(rect);
    expect(range.x).toBe(rect.x + SLIDER_KNOB / 2);
    expect(range.w).toBe(rect.w - SLIDER_KNOB);
  });

  it('指针位置 → 0 / 0.5 / 1，越界夹住', () => {
    const range = sliderTrackRange(rect);
    expect(sliderRatioFromX(rect, range.x)).toBe(0);
    expect(sliderRatioFromX(rect, range.x + range.w / 2)).toBeCloseTo(0.5, 6);
    expect(sliderRatioFromX(rect, range.x + range.w)).toBe(1);
    expect(sliderRatioFromX(rect, 0)).toBe(0);
    expect(sliderRatioFromX(rect, 9999)).toBe(1);
    expect(sliderRatioFromX(rect, Number.NaN)).toBe(0);
  });

  it('键盘步进与拖动共用同一条夹取（不会出现"拖到 1 再按右键变成 1.1"）', () => {
    expect(sliderRatioStep(0, 0.1, 1)).toBeCloseTo(0.1, 6);
    expect(sliderRatioStep(0.95, 0.1, 1)).toBe(1);
    expect(sliderRatioStep(0.05, 0.1, -1)).toBe(0);
    expect(sliderRatioStep(0.5, 0, 1)).toBe(0.5);
  });
});

describe('下拉', () => {
  const field = { x: 100, y: 300, w: 160, h: 26 };

  it('默认向下展开', () => {
    const menu = dropdownMenuRect(field, 4, 22, 800);
    expect(menu).toEqual({ x: 100, y: 326, w: 160, h: 88 });
  });

  it('下面放不下就翻到上方（DOM 版挂 body 就是为了这个，canvas 得自己算）', () => {
    // 视口 400 高，字段在 340 → 下方只剩 34，放不下 88
    const low = { x: 100, y: 340, w: 160, h: 26 };
    const menu = dropdownMenuRect(low, 4, 22, 400);
    expect(menu.y).toBe(340 - 88);
    expect(menu.y + menu.h).toBe(340);
  });

  it('上下都放不下时选空间大的那一侧（不是无脑翻上）', () => {
    // 视口 100 高、字段在 20：上方 20、下方 54 → 仍向下
    const menu = dropdownMenuRect({ x: 0, y: 20, w: 100, h: 26 }, 6, 22, 100);
    expect(menu.y).toBe(46);
    // 字段在 30：上方 30、下方 44 → 仍向下；字段在 60：上方 60、下方 14 → 翻上
    expect(dropdownMenuRect({ x: 0, y: 60, w: 100, h: 26 }, 6, 22, 100).y).toBe(0);
  });

  it('菜单内第几项，越界返回 -1', () => {
    const menu = { x: 100, y: 326, w: 160, h: 88 };
    expect(dropdownIndexAt(menu, 326, 22, 4)).toBe(0);
    expect(dropdownIndexAt(menu, 326 + 21, 22, 4)).toBe(0);
    expect(dropdownIndexAt(menu, 326 + 22, 22, 4)).toBe(1);
    expect(dropdownIndexAt(menu, 326 + 88, 22, 4)).toBe(-1);
    expect(dropdownIndexAt(menu, 325, 22, 4)).toBe(-1);
    expect(dropdownIndexAt(menu, 400, 0, 4)).toBe(-1);
  });
});

describe('页签', () => {
  const bar = { x: 0, y: 0, w: 300, h: 28 };

  it('等分成 n 段，宽度相加等于整条', () => {
    const tabs = tabRects(bar, 3);
    expect(tabs).toHaveLength(3);
    expect(tabs[1]!.x).toBe(100);
    expect(tabs.reduce((sum, tab) => sum + tab.w, 0)).toBeCloseTo(300, 6);
    expect(tabRects(bar, 0)).toEqual([]);
  });

  it('点在哪个页签上：左闭右开，最右边界算最后一个', () => {
    expect(tabIndexAt(bar, 3, 0)).toBe(0);
    expect(tabIndexAt(bar, 3, 99.9)).toBe(0);
    expect(tabIndexAt(bar, 3, 100)).toBe(1);
    expect(tabIndexAt(bar, 3, 299.9)).toBe(2);
    expect(tabIndexAt(bar, 3, 300)).toBe(-1);
    expect(tabIndexAt(bar, 3, -1)).toBe(-1);
  });
});

describe('滚动列表', () => {
  it('内容总高与最大滚动量（内容比视口矮时不许滚）', () => {
    expect(listContentHeight(10, 24)).toBe(240);
    expect(listMaxScroll(10, 100, 24)).toBe(140);
    expect(listMaxScroll(2, 100, 24)).toBe(0);
  });

  it('滚动偏移夹在 0~最大（拖、滚轮、程序设置共用一条）', () => {
    expect(clampListScroll(-50, 10, 100, 24)).toBe(0);
    expect(clampListScroll(9999, 10, 100, 24)).toBe(140);
    expect(clampListScroll(Number.NaN, 10, 100, 24)).toBe(0);
  });

  it('滚轮按整行走（半行滚动看起来最脏）', () => {
    expect(listScrollByWheel(0, 24, 10, 100, 24)).toBe(24);
    expect(listScrollByWheel(0, 11, 10, 100, 24)).toBe(0); // 不足半行 → 不动
    expect(listScrollByWheel(0, 12, 10, 100, 24)).toBe(24); // 恰好半行 → 向上取整，滚一行
    expect(listScrollByWheel(140, 24, 10, 100, 24)).toBe(140); // 到底不越界
    expect(listScrollByWheel(0, -24, 10, 100, 24)).toBe(0);
  });

  it('视口里该画哪几行（滚动到中间时首尾都要算对）', () => {
    expect(listVisibleRange(0, 100, 10, 24)).toEqual({ first: 0, last: 4 });
    const mid = listVisibleRange(48, 100, 10, 24);
    // 48 起 = 第 2 行开始；48+100=148 → ceil(148/24)-1 = 6
    expect(mid).toEqual({ first: 2, last: 6 });
    expect(listVisibleRange(0, 0, 10, 24)).toEqual({ first: 0, last: -1 });
    expect(listVisibleRange(0, 100, 0, 24)).toEqual({ first: 0, last: -1 });
  });
});

describe('提示框位置', () => {
  const anchor = { x: 400, y: 200, w: 40, h: 20 };
  const viewport = { w: 800, h: 400 };

  it('默认贴在锚点下方、水平居中', () => {
    const rect = tooltipRect(anchor, 120, 40, viewport);
    expect(rect).toEqual({ x: 400 + 20 - 60, y: 200 + 20 + 8, w: 120, h: 40 });
  });

  it('下方放不下就翻到上方', () => {
    const low = { x: 400, y: 360, w: 40, h: 20 };
    const rect = tooltipRect(low, 120, 40, viewport);
    expect(rect.y).toBe(360 - 8 - 40);
  });

  it('左右贴边时夹进视口（不会被切掉一半）', () => {
    const left = tooltipRect({ x: 0, y: 100, w: 10, h: 10 }, 120, 30, viewport);
    expect(left.x).toBe(0);
    const right = tooltipRect({ x: 790, y: 100, w: 10, h: 10 }, 120, 30, viewport);
    expect(right.x).toBe(viewport.w - 120);
  });
});

describe('弹窗', () => {
  it('居中', () => {
    expect(modalRect(800, 600, 400, 300)).toEqual({ x: 200, y: 150, w: 400, h: 300 });
  });

  it('小屏时夹进视口（四周至少留 8px）', () => {
    const rect = modalRect(320, 200, 400, 300);
    expect(rect.w).toBe(320 - 16);
    expect(rect.h).toBe(200 - 16);
    expect(rect.x).toBe(8);
    expect(rect.y).toBe(8);
  });
});
