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
  drawCanvasBlits,
  drawTextRuns,
  intersectRect,
  inputDisplayText,
  normalizeWeight,
  runBaselineY,
  textRunsSignature,
} from '../src/ui2d/textPanel.ts';
import {
  DIAL_SIZE,
  NEEDLE_HALF_WIDTH,
  NEEDLE_LENGTH,
  dialBorderColor,
  dialCenter,
  dialNeedlePoints,
  dialTickAnchors,
} from '../src/ui2d/ToolDial2D.ts';
import {
  ATTACK_CHARGE_HEIGHT,
  ATTACK_CHARGE_TOP_OFFSET,
  ATTACK_CHARGE_WIDTH,
  EMPTY_TIPS,
  ITEM_NAME_FADE_MS,
  ITEM_NAME_HOLD_MS,
  attackChargePercent,
  attackChargeRect,
  itemNameAlpha,
  tipsVisible,
} from '../src/ui2d/overlays.ts';
import { bubbleIconState, vitalIconState } from '../src/ui2d/vitalsArt.ts';
import {
  VITALS_PULSE_SCALE,
  vitalIconRect,
  vitalsBounds,
  vitalsPulseScale,
  vitalsSignature,
} from '../src/ui2d/Vitals2D.ts';
import {
  XP_LEVEL_HEIGHT,
  XP_LEVEL_PADDING_X,
  xpFillRect,
  xpLevelBadgeRect,
  xpRatioPercent,
  xpSignature,
} from '../src/ui2d/Xp2D.ts';
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

/**
 * 状态栏四行（阶段 2）。
 *
 * 钉三件事：三态判据（半颗心什么时候算半颗）、脉冲曲线（两端斜率为 0 才有"呼吸"感）、
 * 包围盒（快照大小定错 = 边缘被裁掉半个心）。
 */
describe('状态栏几何与三态', () => {
  const icon = (x: number, state: 'full' | 'half' | 'empty' = 'full') => ({
    rect: { x, y: 300, w: 18, h: 18 },
    state,
  });

  it('心/鸡腿/护甲的三态：2 点整颗、1 点半颗、0 点空', () => {
    expect(vitalIconState(2)).toBe('full');
    expect(vitalIconState(3)).toBe('full');
    expect(vitalIconState(1.5)).toBe('half');
    expect(vitalIconState(1)).toBe('half');
    expect(vitalIconState(0.5)).toBe('empty');
    expect(vitalIconState(0)).toBe('empty');
  });

  it('气泡按"每颗多少点氧气"分三态（不是固定 2 点）', () => {
    expect(bubbleIconState(3, 3)).toBe('full');
    expect(bubbleIconState(1.2, 3)).toBe('half');
    expect(bubbleIconState(0, 3)).toBe('empty');
    // 每颗 0 点 = 算不出来，按空处理（不能除零）
    expect(bubbleIconState(5, 0)).toBe('empty');
  });

  it('一行的图标按 (图标 + 间距) 等距排开', () => {
    const row = { x: 100, y: 300, w: 0, h: 18 };
    expect(vitalIconRect(row, 0, 18, 1)).toEqual({ x: 100, y: 300, w: 18, h: 18 });
    expect(vitalIconRect(row, 3, 18, 1)).toEqual({ x: 157, y: 300, w: 18, h: 18 });
  });

  it('包围盒覆盖四行（空的行走忽略）', () => {
    const bounds = vitalsBounds({
      hearts: [icon(100), icon(120)],
      foods: [icon(300)],
      armors: [],
      bubbles: [],
      pulse: false,
    });
    // 最左是 100，最右是鸡腿的右边缘 300+18=318
    expect(bounds).toEqual({ x: 100, y: 300, w: 218, h: 18 });
    expect(vitalsBounds({ hearts: [], foods: [], armors: [], bubbles: [], pulse: false })).toBeNull();
  });

  it('脉冲 1 → 1.06 → 1，一个周期 1 秒，两端斜率为 0', () => {
    expect(vitalsPulseScale(0)).toBeCloseTo(1, 6);
    expect(vitalsPulseScale(0.5)).toBeCloseTo(VITALS_PULSE_SCALE, 6);
    expect(vitalsPulseScale(1)).toBeCloseTo(1, 6);
    // 中点两侧对称（ease-in-out 的观感）
    expect(vitalsPulseScale(0.25)).toBeCloseTo(vitalsPulseScale(0.75), 6);
    expect(vitalsPulseScale(Number.NaN)).toBe(1);
  });

  it('签名只认"会长出不同像素"的东西', () => {
    const base = { hearts: [icon(100)], foods: [icon(300)], armors: [], bubbles: [], pulse: false };
    expect(vitalsSignature(base)).toBe(vitalsSignature({ ...base }));
    // 脉冲不进签名：它是 blit 时的变换，不该触发重建
    expect(vitalsSignature({ ...base, pulse: true })).toBe(vitalsSignature(base));
    // 状态/位置变了才重建
    expect(vitalsSignature({ ...base, hearts: [icon(100, 'half')] })).not.toBe(vitalsSignature(base));
    expect(vitalsSignature({ ...base, hearts: [icon(101)] })).not.toBe(vitalsSignature(base));
  });
});

/** 经验条（阶段 2）：百分比取整、填充宽度、等级牌居中 */
describe('经验条几何', () => {
  const bar = { x: 300, y: 200, w: 182, h: 6 };

  it('进度取整到 1%（与 DOM 版的 Math.round(...)% 同一口径）', () => {
    expect(xpRatioPercent(0.423)).toBe(42);
    expect(xpRatioPercent(1.4)).toBe(100);
    expect(xpRatioPercent(-1)).toBe(0);
    expect(xpRatioPercent(Number.NaN)).toBe(0);
  });

  it('填充宽度 = 轨道宽 × 百分比', () => {
    expect(xpFillRect(bar, 0.5).w).toBeCloseTo(91, 6);
    expect(xpFillRect(bar, 0).w).toBe(0);
    expect(xpFillRect(bar, 2).w).toBe(bar.w);
  });

  it('等级牌压在条的正中间，宽度随文字量', () => {
    const badge = xpLevelBadgeRect(bar, 14);
    expect(badge.w).toBe(14 + XP_LEVEL_PADDING_X * 2);
    expect(badge.h).toBe(XP_LEVEL_HEIGHT);
    expect(badge.x + badge.w / 2).toBeCloseTo(bar.x + bar.w / 2, 6);
    expect(badge.y + badge.h / 2).toBeCloseTo(bar.y + bar.h / 2, 6);
  });

  it('签名：1% 以内不重建，等级/矩形变了要重建', () => {
    const base = { rect: bar, ratio: 0.421, level: 7 };
    expect(xpSignature(base)).toBe(xpSignature({ ...base, ratio: 0.424 }));
    expect(xpSignature(base)).not.toBe(xpSignature({ ...base, ratio: 0.5 }));
    expect(xpSignature(base)).not.toBe(xpSignature({ ...base, level: 8 }));
    expect(xpSignature(base)).not.toBe(xpSignature({ ...base, rect: { ...bar, x: 301 } }));
  });
});

/**
 * 提示条族（阶段 2 收尾）：目标名 / 攻击蓄力条 / 物品名浮标。
 *
 * 三样都是"几十像素、每帧在动"的东西，错了只表现为"看着有点怪"：
 * 蓄力条偏 1px、物品名淡出比 DOM 快一拍 —— 所以几何与时间曲线都钉住。
 */
describe('提示条几何与时间曲线', () => {
  it('蓄力条 44×3，贴在准星正下方 16px', () => {
    expect(attackChargeRect(800, 600)).toEqual({
      x: 400 - ATTACK_CHARGE_WIDTH / 2,
      y: 300 + ATTACK_CHARGE_TOP_OFFSET,
      w: ATTACK_CHARGE_WIDTH,
      h: ATTACK_CHARGE_HEIGHT,
    });
  });

  it('蓄力进度量化到 2%（与 DOM 版同一条口径）', () => {
    expect(attackChargePercent(0)).toBe(0);
    expect(attackChargePercent(0.5)).toBe(50);
    // 0.503 → round(25.15)=25 → 50；0.51 → round(25.5)=26 → 52
    expect(attackChargePercent(0.503)).toBe(50);
    expect(attackChargePercent(0.51)).toBe(52);
    expect(attackChargePercent(1)).toBe(100);
    expect(attackChargePercent(2)).toBe(100);
    expect(attackChargePercent(-1)).toBe(0);
    expect(attackChargePercent(Number.NaN)).toBe(0);
  });

  it('物品名：350ms 淡入 → 保持到 2000ms → 350ms 淡出', () => {
    expect(itemNameAlpha(0)).toBe(0);
    expect(itemNameAlpha(ITEM_NAME_FADE_MS / 2)).toBeCloseTo(0.5, 6);
    expect(itemNameAlpha(ITEM_NAME_FADE_MS)).toBe(1);
    expect(itemNameAlpha(ITEM_NAME_HOLD_MS)).toBe(1);
    expect(itemNameAlpha(ITEM_NAME_HOLD_MS + ITEM_NAME_FADE_MS / 2)).toBeCloseTo(0.5, 6);
    expect(itemNameAlpha(ITEM_NAME_HOLD_MS + ITEM_NAME_FADE_MS)).toBe(0);
    expect(itemNameAlpha(-5)).toBe(0);
    expect(itemNameAlpha(Number.NaN)).toBe(0);
  });

  it('三样全空时不画（覆盖层可以整帧跳过）', () => {
    expect(tipsVisible(EMPTY_TIPS)).toBe(false);
    expect(tipsVisible(null)).toBe(false);
  });

  it('有任何一样就画（物品名过期的除外）', () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(tipsVisible({ ...EMPTY_TIPS, target: { rect, text: '石头' } })).toBe(true);
    expect(tipsVisible({ ...EMPTY_TIPS, charge: { rect, percent: 40 } })).toBe(true);
    const fresh = { rect, text: '钻石剑', shownAtMs: 1000 };
    expect(tipsVisible({ ...EMPTY_TIPS, itemName: fresh }, 1200)).toBe(true);
    // 过了 淡入+保持+淡出 之后就不该再画
    const expired = ITEM_NAME_HOLD_MS + ITEM_NAME_FADE_MS + 100;
    expect(tipsVisible({ ...EMPTY_TIPS, itemName: fresh }, 1000 + expired)).toBe(false);
  });
});

/** 指南针 / 时钟表盘（阶段 2 的最后一样）：角度与刻度位置都是算出来的，必须钉住 */
describe('工具表盘', () => {
  const dial = { x: 100, y: 100, w: DIAL_SIZE, h: DIAL_SIZE };
  const center = dialCenter(dial);

  it('圆心就是矩形中心', () => {
    expect(center).toEqual({ x: 126, y: 126 });
  });

  it('指针 0° 指上、90° 指右、180° 指下、270° 指左（顺时针，与 CSS rotate 同向）', () => {
    const up = dialNeedlePoints(dial, 0);
    expect(up.apex.x).toBeCloseTo(center.x, 6);
    expect(up.apex.y).toBeCloseTo(center.y - NEEDLE_LENGTH, 6);

    const right = dialNeedlePoints(dial, 90);
    expect(right.apex.x).toBeCloseTo(center.x + NEEDLE_LENGTH, 6);
    expect(right.apex.y).toBeCloseTo(center.y, 6);

    const down = dialNeedlePoints(dial, 180);
    expect(down.apex.y).toBeCloseTo(center.y + NEEDLE_LENGTH, 6);

    const left = dialNeedlePoints(dial, 270);
    expect(left.apex.x).toBeCloseTo(center.x - NEEDLE_LENGTH, 6);
  });

  it('底边两端关于指针轴对称（0° 时就是左右各半宽）', () => {
    const up = dialNeedlePoints(dial, 0);
    expect(up.left.x - center.x).toBeCloseTo(NEEDLE_HALF_WIDTH, 6);
    expect(up.right.x - center.x).toBeCloseTo(-NEEDLE_HALF_WIDTH, 6);
    expect(up.left.y).toBeCloseTo(center.y, 6);
  });

  it('角度非法时按 0° 处理（不能让指针飞到 NaN）', () => {
    const pts = dialNeedlePoints(dial, Number.NaN);
    expect(Number.isFinite(pts.apex.x)).toBe(true);
    expect(pts.apex.y).toBeCloseTo(center.y - NEEDLE_LENGTH, 6);
  });

  it('四个方位字母贴在上下左右内缘', () => {
    const anchors = dialTickAnchors(dial);
    expect(anchors.n.x).toBeCloseTo(center.x, 6);
    expect(anchors.n.y).toBeLessThan(center.y);
    expect(anchors.s.y).toBeGreaterThan(center.y);
    expect(anchors.e.x).toBeGreaterThan(center.x);
    expect(anchors.w.x).toBeLessThan(center.x);
    // 都在盘面里面
    for (const point of Object.values(anchors)) {
      expect(point.x).toBeGreaterThanOrEqual(dial.x);
      expect(point.x).toBeLessThanOrEqual(dial.x + dial.w);
      expect(point.y).toBeGreaterThanOrEqual(dial.y);
      expect(point.y).toBeLessThanOrEqual(dial.y + dial.h);
    }
  });

  it('指南针与时钟的边框色不同（铜 / 铁蓝）', () => {
    expect(dialBorderColor('compass')).not.toBe(dialBorderColor('clock'));
  });
});

/** 纯文字 HUD（F3 / 计分板）：字号档位与签名的稳定性 */
describe('纯文字面板', () => {
  it('font-weight 归一到 400 / 600 / 700（uiFont 只认这三档）', () => {
    expect(normalizeWeight('400')).toBe(400);
    expect(normalizeWeight('normal')).toBe(400); // parseInt 失败 → 400
    expect(normalizeWeight('500')).toBe(400);
    expect(normalizeWeight('600')).toBe(600);
    expect(normalizeWeight('bold')).toBe(400); // CSS 关键字：交给浏览器算过了才准，这里按默认
    expect(normalizeWeight('700')).toBe(700);
    expect(normalizeWeight(800)).toBe(700);
  });

  it('基线就是行的竖直中点（多行时由 drawTextRuns 自己分摊）', () => {
    expect(runBaselineY({ x: 0, y: 100, w: 50, h: 20 })).toBe(110);
  });

  it('签名认文字/位置/字号/颜色，不认行高', () => {
    const run = {
      rect: { x: 10, y: 20, w: 120, h: 16 },
      text: 'F3',
      color: '#ffffff',
      fontSize: 12,
      weight: 400 as const,
      align: 'left' as const,
      shadow: true,
    };
    expect(textRunsSignature([run])).toBe(textRunsSignature([{ ...run }]));
    expect(textRunsSignature([run])).not.toBe(textRunsSignature([{ ...run, text: 'F4' }]));
    expect(textRunsSignature([run])).not.toBe(textRunsSignature([{ ...run, color: '#ffd75e' }]));
    expect(textRunsSignature([run])).not.toBe(
      textRunsSignature([{ ...run, rect: { ...run.rect, x: 11 } }]),
    );
  });
});

/**
 * 镜像整页时给 `maxWidth` 留的余量（`drawTextRuns(..., slack)`）。
 *
 * 为什么值得一条断言：DOM 的 `letter-spacing`（标题常写负值）会让元素盒子比
 * canvas 量出来的字**窄**，不给余量就会把 "MINICRAFT" 截成 "MINICRA…" ——
 * 这种错只在长标题上出现，肉眼很容易当成"字体不一样"。
 */
describe('文字面板的 slack', () => {
  /** 只认 measureText / fillText 的假 ctx：每字符固定 7px */
  function fakeCtx(widthPerChar = 7) {
    const drawn: string[] = [];
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      measureText: (text: string) => ({ width: text.length * widthPerChar }),
      set font(_value: string) {},
      set textAlign(_value: string) {},
      set textBaseline(_value: string) {},
      set fillStyle(_value: string) {},
      set globalAlpha(_value: number) {},
      fillText: (text: string) => drawn.push(text),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
  }

  const run = {
    rect: { x: 0, y: 0, w: 50, h: 16 },
    text: 'MINICRAFT',
    color: '#ffffff',
    fontSize: 12,
    weight: 400 as const,
    align: 'left' as const,
    shadow: false,
  };

  it('不给余量时按盒子宽度截断（F3 / 计分板要的就是这个）', () => {
    const fake = fakeCtx();
    drawTextRuns(fake.ctx, [run]);
    expect(fake.drawn.some((text) => text.includes('…'))).toBe(true);
  });

  it('给了余量就完整画出（主菜单那种带 letter-spacing 的标题）', () => {
    const fake = fakeCtx();
    drawTextRuns(fake.ctx, [run], 20);
    expect(fake.drawn).toContain('MINICRAFT');
  });

  it('`widthSlack` 也能补偿（负字距把盒子压窄时，按字数补回来）', () => {
    const fake = fakeCtx();
    // 9 个字 × 7px = 63 > 50，给 14 就画得下
    drawTextRuns(fake.ctx, [{ ...run, widthSlack: 14 }]);
    expect(fake.drawn).toContain('MINICRAFT');
  });

  it('补偿为 0 时行为与之前完全一致（不影响 F3 / 计分板）', () => {
    const fake = fakeCtx();
    drawTextRuns(fake.ctx, [{ ...run, widthSlack: 0 }]);
    expect(fake.drawn.some((text) => text.includes('…'))).toBe(true);
  });
});

/**
 * 输入框在镜像里的显示文本（`inputDisplayText`）。
 *
 * `<input>` 的当前值不在 `textContent` 里 —— 这是"整页镜像"最初绕开新建世界表单的原因。
 * 补上之后要钉两件事：有值就画值、空值画占位提示（并且要标成占位，绘制时降不透明度）。
 */
describe('输入框的显示文本', () => {
  it('有值时画值，不画占位', () => {
    expect(inputDisplayText('我的世界', '世界名称')).toEqual({ text: '我的世界', isPlaceholder: false });
  });

  it('空值画占位提示并标记（绘制时用 0.55 不透明度近似 ::placeholder）', () => {
    expect(inputDisplayText('', '世界名称')).toEqual({ text: '世界名称', isPlaceholder: true });
  });

  it('空值且没有占位就什么都不画', () => {
    expect(inputDisplayText('', '')).toEqual({ text: '', isPlaceholder: false });
  });

  it('只有一个空格也算"有值"（玩家真的敲了一个空格，不该被占位盖掉）', () => {
    expect(inputDisplayText(' ', '名字')).toEqual({ text: ' ', isPlaceholder: false });
  });
});


/**
 * 位图搬运（`readCanvasBlits` / `drawCanvasBlits`）。
 *
 * 背包镜像必须把槽位里的 `<canvas>` 图标一起搬过去，否则画出来是
 * "有边框、有空位、没有图标"的背包 —— 看着像漏了内容，也很难联想到是镜像的事。
 * 这里钉两件：贴图用原矩形、关掉平滑（像素风）。
 */
describe('位图搬运', () => {
  function fakeCtx() {
    const calls: string[] = [];
    let smoothing = true;
    const ctx = {
      set imageSmoothingEnabled(value: boolean) {
        smoothing = value;
        calls.push(`smooth ${value}`);
      },
      get imageSmoothingEnabled() {
        return smoothing;
      },
      drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => calls.push(`draw ${x},${y},${w},${h}`),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it('按原位贴、关平滑', () => {
    const fake = fakeCtx();
    const canvas = { width: 36, height: 36 } as HTMLCanvasElement;
    drawCanvasBlits(fake.ctx, [{ rect: { x: 10, y: 20, w: 32, h: 32 }, canvas }]);
    expect(fake.calls).toEqual(['smooth false', 'draw 10,20,32,32']);
  });

  it('空列表一笔都不画', () => {
    const fake = fakeCtx();
    drawCanvasBlits(fake.ctx, []);
    expect(fake.calls).toEqual([]);
  });
});


/**
 * 裁剪矩形求交（`intersectRect`）。
 *
 * 用户 2026-10-27 报的「点分类后所有物品平铺出来、伸出弹窗」就是缺了这一步：
 * DOM 靠 `overflow` 裁剪，canvas 不裁就会把滚动区外面那几十格也画出来。
 */
describe('裁剪矩形求交', () => {
  it('相交取公共部分', () => {
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({
      x: 5,
      y: 5,
      w: 5,
      h: 5,
    });
  });

  it('包含关系取小的那个', () => {
    const big = { x: 0, y: 0, w: 100, h: 100 };
    const small = { x: 10, y: 10, w: 20, h: 20 };
    expect(intersectRect(big, small)).toEqual(small);
    expect(intersectRect(small, big)).toEqual(small);
  });

  it('只贴边不算相交（宽高退化就返回 null）', () => {
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBeNull();
    expect(intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 20, w: 10, h: 10 })).toBeNull();
  });
});
