/**
 * canvas 界面（`src/ui2d/`）的离线断言（阶段 0）
 *
 * 界面本身要靠真机看，但这一层里**能离线钉死**的恰好是最容易悄悄退化的部分：
 *  - **分词/折行/截断**：6 种语言里 CJK 按码点、拉丁按词，写错就整段不换行或把
 *    单词拆成两截；而且退化的样子很"正常"（只是排版丑），不跑断言没人会发现；
 *  - **命中测试**：层号与"后来者居上"的顺序错了，表现是"点得到下面的按钮、
 *    点不到上面的"——这类 bug 在真机上极难复现；
 *  - **几何换算**：Boss 条与进度条的位置是照抄 CSS 的，抄错一个 `bottom`
 *    就会把进度条画到屏幕外面去。
 *
 * 运行：`npm run test:unit`（或 `npx vitest run tests/ui2d.test.ts`）
 */
import { describe, expect, it } from 'vitest';
import {
  ELLIPSIS,
  isCjkCodePoint,
  tokenize,
  truncateToWidth,
  uiFont,
  wrapToWidth,
  type Measure,
} from '../src/ui2d/text.ts';
import { hitRegionAt, type HitRegion } from '../src/ui2d/input.ts';
import {
  BOSS_BAR_HEIGHT,
  BOSS_BAR_MAX_WIDTH,
  BOSS_BAR_TOP,
  PROGRESS_BREAK_BOTTOM,
  PROGRESS_HEIGHT,
  PROGRESS_WIDTH,
  bossBarWidth,
  progressBarRect,
} from '../src/ui2d/Hud2D.ts';

/**
 * 假测量：CJK/全角按 14px、其余按 7px。
 *
 * 不引 canvas —— 真实 `measureText` 要浏览器，而这里要验的是**排版决策**
 * （在哪断行、留几个字），与字体实际宽度无关。
 */
const measure: Measure = (text) => {
  let width = 0;
  for (const ch of text) width += isCjkCodePoint(ch) ? 14 : 7;
  return width;
};

describe('文字分词', () => {
  it('拉丁词整体成一个 token（不拆下划线）', () => {
    expect(tokenize('diamond_sword')).toEqual(['diamond_sword']);
  });

  it('CJK 每个字一个 token（可以在任意位置断行）', () => {
    expect(tokenize('你好')).toEqual(['你', '好']);
  });

  it('空格跟着前一个 token 走，拼回去与原串一致', () => {
    const tokens = tokenize('你好 world');
    expect(tokens.join('')).toBe('你好 world');
    expect(tokens).toEqual(['你', '好 ', 'world']);
  });

  it('全角标点也算可断位', () => {
    expect(isCjkCodePoint('，')).toBe(true);
    expect(isCjkCodePoint('a')).toBe(false);
  });
});

describe('截断到宽度', () => {
  it('放得下就原样返回', () => {
    expect(truncateToWidth(measure, 'abc', 'f', 100)).toBe('abc');
  });

  it('放不下就补省略号，且宽度不超', () => {
    const out = truncateToWidth(measure, 'abcdefghij', 'f', 49);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
    expect(measure(out, 'f')).toBeLessThanOrEqual(49);
  });

  it('宽度不够放省略号时返回空串（不画一个溢出屏幕的 …）', () => {
    expect(truncateToWidth(measure, 'abcdef', 'f', 3)).toBe('');
  });
});

describe('折行', () => {
  it('拉丁按词折行，不把词拆开', () => {
    // 每字 7px、行宽 70px ⇒ 一行 10 个字符
    expect(wrapToWidth(measure, 'aaa bbb ccc ddd', 'f', 70)).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('CJK 按码点折行', () => {
    expect(wrapToWidth(measure, '你好世界', 'f', 28)).toEqual(['你好', '世界']);
  });

  it('显式换行符一定断行', () => {
    expect(wrapToWidth(measure, 'ab\ncd', 'f', 140)).toEqual(['ab', 'cd']);
  });

  it('超过 maxLines 时最后一行用省略号收尾', () => {
    const lines = wrapToWidth(measure, 'aaa bbb ccc ddd', 'f', 70, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith(ELLIPSIS)).toBe(true);
  });

  it('超长单词按码点硬切（不会溢出整行）', () => {
    const lines = wrapToWidth(measure, 'abcdefghijklmnop', 'f', 35);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, 'f')).toBeLessThanOrEqual(35);
    expect(lines.join('')).toBe('abcdefghijklmnop');
  });

  it('maxWidth 非法时返回空（不抛）', () => {
    expect(wrapToWidth(measure, 'abc', 'f', 0)).toEqual([]);
    expect(wrapToWidth(measure, 'abc', 'f', 100, 0)).toEqual([]);
  });
});

describe('命中测试', () => {
  const base: HitRegion = { id: 'base', x: 0, y: 0, w: 100, h: 100 };

  it('没命中返回 null', () => {
    expect(hitRegionAt([base], 200, 200)).toBeNull();
  });

  it('同层时后加的在上面（与 DOM 的绘制顺序一致）', () => {
    const top: HitRegion = { id: 'top', x: 0, y: 0, w: 50, h: 50 };
    expect(hitRegionAt([base, top], 10, 10)?.id).toBe('top');
  });

  it('层号大的压过"后加的"', () => {
    const modal: HitRegion = { id: 'modal', x: 0, y: 0, w: 50, h: 50, layer: 10 };
    expect(hitRegionAt([modal, base], 10, 10)?.id).toBe('modal');
  });

  it('禁用区域仍然挡住下层（返回它自己，由调用方决定不派发）', () => {
    const disabled: HitRegion = { id: 'disabled', x: 0, y: 0, w: 50, h: 50, disabled: true };
    expect(hitRegionAt([base, disabled], 10, 10)?.id).toBe('disabled');
  });

  it('右/下边界是开区间（相邻按钮不会同时命中）', () => {
    const left: HitRegion = { id: 'left', x: 0, y: 0, w: 50, h: 50 };
    const right: HitRegion = { id: 'right', x: 50, y: 0, w: 50, h: 50 };
    expect(hitRegionAt([left, right], 50, 10)?.id).toBe('right');
  });
});

describe('几何换算（照抄 CSS 的那几个数）', () => {
  it('Boss 条宽 = min(420, 68vw)', () => {
    expect(bossBarWidth(1000)).toBe(BOSS_BAR_MAX_WIDTH);
    expect(bossBarWidth(400)).toBeCloseTo(272, 5);
  });

  it('Boss 条高与顶部间距与 CSS 一致', () => {
    expect(BOSS_BAR_HEIGHT).toBe(38);
    expect(BOSS_BAR_TOP).toBe(10);
  });

  it('破坏进度条贴底居中（bottom: 74px）', () => {
    const rect = progressBarRect(800, 600, PROGRESS_BREAK_BOTTOM);
    expect(rect).toEqual({
      x: (800 - PROGRESS_WIDTH) / 2,
      y: 600 - PROGRESS_BREAK_BOTTOM - PROGRESS_HEIGHT,
      w: PROGRESS_WIDTH,
      h: PROGRESS_HEIGHT,
    });
  });

  it('字体串带等宽+中文回退', () => {
    expect(uiFont(12)).toContain('PingFang SC');
    expect(uiFont(12, 700).startsWith('700 12px')).toBe(true);
  });
});
