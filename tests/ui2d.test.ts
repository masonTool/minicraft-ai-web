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
import { DEBUG_TINT_COLOR, applyDebugTint } from '../src/ui2d/debug.ts';
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
import {
  HOTBAR_ACTIVE_LIFT,
  HOTBAR_ACTIVE_SCALE,
  HOTBAR_DURABILITY_HEIGHT,
  HOTBAR_ICON_SIZE,
  HOTBAR_SNAPSHOT_PAD,
  hotbarActiveRect,
  hotbarContentRect,
  hotbarCountAnchor,
  hotbarDurabilityFillRect,
  hotbarDurabilityRect,
  hotbarIconRect,
  hotbarIndexAnchor,
  hotbarSignature,
  hotbarSnapshotOrigin,
  type HotbarState,
} from '../src/ui2d/Hotbar2D.ts';

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

/**
 * 快捷栏（阶段 1.5）。
 *
 * 这里钉的是**相对偏移**：格子 42×42、边框 2px、图标 32px、数量贴右下、耐久条贴底
 * —— 都是照抄 `index.html` 那几个 `px` 的。抄错了在真机上只是"图标偏 1px、数字压到边"，
 * 肉眼几乎看不出，但一旦换到平板/横屏就明显了。
 */
describe('快捷栏几何', () => {
  // 一个 42×42 的格子，左上角放在 (100, 200)
  const slot = { x: 100, y: 200, w: 42, h: 42 };

  it('内容盒扣掉 2px 边框', () => {
    expect(hotbarContentRect(slot)).toEqual({ x: 102, y: 202, w: 38, h: 38 });
  });

  it('图标 32px 在内容盒里居中', () => {
    const icon = hotbarIconRect(slot);
    expect(icon).toEqual({ x: 105, y: 205, w: HOTBAR_ICON_SIZE, h: HOTBAR_ICON_SIZE });
    // 左右留白相等（居中）
    expect(icon.x - slot.x).toBe(slot.x + slot.w - (icon.x + icon.w));
  });

  it('序号贴左上（top: 0 / left: 3px，相对内容盒）', () => {
    expect(hotbarIndexAnchor(slot)).toEqual({ x: 105, y: 202 });
  });

  it('数量贴右下（right: 2px / bottom: 1px，相对内容盒）', () => {
    expect(hotbarCountAnchor(slot)).toEqual({ x: 138, y: 239 });
  });

  it('耐久条贴底居中（left/right: 3px、bottom: 2px、高 3px）', () => {
    const track = hotbarDurabilityRect(slot);
    expect(track).toEqual({ x: 105, y: 235, w: 32, h: HOTBAR_DURABILITY_HEIGHT });
    // 低端与高端留白相等
    expect(track.x - slot.x).toBe(slot.x + slot.w - (track.x + track.w));
  });

  it('耐久填充按比例，并夹在 0~1', () => {
    expect(hotbarDurabilityFillRect(slot, 0.5).w).toBeCloseTo(16, 5);
    expect(hotbarDurabilityFillRect(slot, 0).w).toBe(0);
    expect(hotbarDurabilityFillRect(slot, 3).w).toBeCloseTo(32, 5);
    expect(hotbarDurabilityFillRect(slot, Number.NaN).w).toBe(0);
  });

  it('选中格绕中心放大 1.08 再上抬 2px', () => {
    const active = hotbarActiveRect(slot);
    expect(active.w).toBeCloseTo(slot.w * HOTBAR_ACTIVE_SCALE, 5);
    expect(active.h).toBeCloseTo(slot.h * HOTBAR_ACTIVE_SCALE, 5);
    // 中心仍在原中心的正上方 2px（缩放不改中心，位移只改 y）
    expect(active.x + active.w / 2).toBeCloseTo(slot.x + slot.w / 2, 5);
    expect(active.y + active.h / 2).toBeCloseTo(slot.y + slot.h / 2 - HOTBAR_ACTIVE_LIFT, 5);
  });

  it('快照比面板多留一圈（选中格的柔光在面板外面）', () => {
    const panel = { x: 50, y: 500, w: 412, h: 50 };
    expect(hotbarSnapshotOrigin(panel)).toEqual({ x: 50 - HOTBAR_SNAPSHOT_PAD, y: 500 - HOTBAR_SNAPSHOT_PAD });
  });
});

describe('快捷栏快照签名', () => {
  const slotState = {
    rect: { x: 100, y: 200, w: 42, h: 42 },
    active: false,
    count: 1,
    index: 0,
    icon: null,
    durability: null,
  };

  const make = (over: Partial<HotbarState['slots'][number]> = {}, revision = 1): HotbarState => ({
    panel: { x: 50, y: 200, w: 412, h: 50 },
    slots: [{ ...slotState, ...over }],
    revision,
  });

  it('同状态同签名（稳态不会白重建快照）', () => {
    expect(hotbarSignature(make())).toBe(hotbarSignature(make()));
  });

  it('版本号变了就重建（图标是同一个 canvas 反复重绘的，引用看不出变化）', () => {
    expect(hotbarSignature(make({}, 1))).not.toBe(hotbarSignature(make({}, 2)));
  });

  it('数量 / 选中 / 耐久 / 矩形任一变化都换签名', () => {
    const base = hotbarSignature(make());
    expect(hotbarSignature(make({ count: 5 }))).not.toBe(base);
    expect(hotbarSignature(make({ active: true }))).not.toBe(base);
    expect(hotbarSignature(make({ durability: { ratio: 0.5, level: 'mid' } }))).not.toBe(base);
    expect(hotbarSignature(make({ rect: { x: 101, y: 200, w: 42, h: 42 } }))).not.toBe(base);
  });

  it('耐久只看档位与百分比（1% 以内不重建）', () => {
    const a = hotbarSignature(make({ durability: { ratio: 0.501, level: 'high' } }));
    const b = hotbarSignature(make({ durability: { ratio: 0.504, level: 'high' } }));
    expect(a).toBe(b);
  });
});

/**
 * 调试遮罩（`?ui2dtint=1`）。
 *
 * 它只做两件事：把合成模式切成 `source-atop`、整块刷一层黄。
 * 这两件都不能"差不多"——模式写错就染到透明区域（屏幕全黄而不是只有 canvas 的那几块），
 * 忘了还原就会污染后续所有绘制。
 */
describe('调试遮罩', () => {
  /** 只记调用序列的假 ctx：真 canvas 要浏览器，这里验的是"怎么下笔" */
  function fakeContext() {
    const log: string[] = [];
    let composite = 'source-over';
    const ctx = {
      save: () => log.push('save'),
      restore: () => log.push('restore'),
      fillRect: (x: number, y: number, w: number, h: number) => log.push(`fillRect ${x},${y},${w},${h}`),
      get globalCompositeOperation() {
        return composite;
      },
      set globalCompositeOperation(value: string) {
        composite = value;
        log.push(`op ${value}`);
      },
      set fillStyle(value: string) {
        log.push(`fill ${value}`);
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, log, composite: () => composite };
  }

  it('用 source-atop 刷满整层（只染 canvas 已经画过的地方）', () => {
    const fake = fakeContext();
    applyDebugTint(fake.ctx, 844, 390);
    expect(fake.log).toContain(`fill ${DEBUG_TINT_COLOR}`);
    expect(fake.log).toContain('fillRect 0,0,844,390');
    // 顺序：先 save、再切模式、刷完立刻 restore（否则后续绘制全被 source-atop 污染）
    expect(fake.log).toEqual([
      'save',
      'op source-atop',
      `fill ${DEBUG_TINT_COLOR}`,
      'fillRect 0,0,844,390',
      'restore',
    ]);
    expect(fake.composite()).toBe('source-atop'); // 假 ctx 不模拟 save/restore 的栈，只证明它被设过
  });

  it('尺寸非法时一笔都不画（没有覆盖层尺寸就别刷整屏）', () => {
    const fake = fakeContext();
    applyDebugTint(fake.ctx, 0, 300);
    applyDebugTint(fake.ctx, 300, Number.NaN);
    expect(fake.log).toEqual([]);
  });
});
