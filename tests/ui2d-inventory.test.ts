/**
 * 背包槽位的几何与签名（`src/ui2d/Inventory2D.ts`）
 *
 * 只测算得出来的部分：内容盒、图标居中、数量与耐久条的锚点、签名。
 * 图标位图与 `.inv-slot` 的读取要靠真 DOM，由预览页 `tools/preview/inventory.html` 验。
 *
 * 为什么值得钉：42×42 的格子只差 1~2px 时，肉眼几乎看不出，但一换到平板/横屏就明显；
 * 而"数量被格子边裁掉"这种错误只在数量是两位数时才出现。
 */
import { describe, expect, it } from 'vitest';
import {
  INV_DURABILITY_HEIGHT,
  INV_SLOT_DEFAULT_SKIN,
  invContentRect,
  invCountAnchor,
  invDurabilityRect,
  invIconRect,
  invSignature,
  type InvSlotState,
} from '../src/ui2d/Inventory2D.ts';

const slot = { x: 100, y: 200, w: 42, h: 42 };

describe('背包槽位几何', () => {
  it('内容盒扣掉 2px 边框', () => {
    expect(invContentRect(slot)).toEqual({ x: 102, y: 202, w: 38, h: 38 });
  });

  it('图标 32px 在内容盒里居中', () => {
    const icon = invIconRect(slot);
    expect(icon).toEqual({ x: 105, y: 205, w: 32, h: 32 });
    // 左右、上下留白都相等
    expect(icon.x - slot.x).toBe(slot.x + slot.w - (icon.x + icon.w));
    expect(icon.y - slot.y).toBe(slot.y + slot.h - (icon.y + icon.h));
  });

  it('格子比图标小时图标自动收窄（不会溢出）', () => {
    const small = { x: 0, y: 0, w: 20, h: 20 };
    const icon = invIconRect(small);
    expect(icon.w).toBe(16); // 20 - 2*2
    expect(icon.x).toBe(2);
  });

  it('数量贴内容盒右下角', () => {
    const anchor = invCountAnchor(slot);
    expect(anchor.x).toBe(102 + 38 - 2);
    expect(anchor.y).toBe(202 + 38 - 1);
  });

  it('耐久条贴底、左右各留 3px、高 3px', () => {
    const bar = invDurabilityRect(slot);
    expect(bar).toEqual({ x: 105, y: 202 + 38 - INV_DURABILITY_HEIGHT - 2, w: 32, h: INV_DURABILITY_HEIGHT });
    expect(bar.x - slot.x).toBe(slot.x + slot.w - (bar.x + bar.w));
  });

  it('自定义边框宽度会影响所有派生几何（皮肤是读 CSS 来的）', () => {
    const wide = { ...INV_SLOT_DEFAULT_SKIN, borderWidth: 4 };
    expect(invContentRect(slot, wide.borderWidth)).toEqual({ x: 104, y: 204, w: 34, h: 34 });
    expect(invIconRect(slot, wide).w).toBe(32);
    expect(invDurabilityRect(slot, wide).w).toBe(28);
  });
});

describe('背包签名', () => {
  const base: InvSlotState = {
    rect: slot,
    icon: null,
    count: 1,
    durability: null,
    hovered: false,
    pressed: false,
    locked: false,
    held: false,
  };

  it('同状态同签名（稳态不会白重画）', () => {
    expect(invSignature({ slots: [base] })).toBe(invSignature({ slots: [{ ...base }] }));
  });

  it('数量 / 悬停 / 锁定 / 选择 / 耐久 / 位置任一变化都换签名', () => {
    const original = invSignature({ slots: [base] });
    expect(invSignature({ slots: [{ ...base, count: 12 }] })).not.toBe(original);
    expect(invSignature({ slots: [{ ...base, hovered: true }] })).not.toBe(original);
    expect(invSignature({ slots: [{ ...base, locked: true }] })).not.toBe(original);
    expect(invSignature({ slots: [{ ...base, held: true }] })).not.toBe(original);
    expect(invSignature({ slots: [{ ...base, durability: { ratio: 0.5, level: 'mid' } }] })).not.toBe(original);
    expect(invSignature({ slots: [{ ...base, rect: { ...slot, x: 101 } }] })).not.toBe(original);
  });

  it('耐久只看档位与百分比（1% 内不重画）', () => {
    const a = invSignature({ slots: [{ ...base, durability: { ratio: 0.501, level: 'high' } }] });
    const b = invSignature({ slots: [{ ...base, durability: { ratio: 0.504, level: 'high' } }] });
    expect(a).toBe(b);
  });
});
