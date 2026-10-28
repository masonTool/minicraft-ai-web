/**
 * 远端玩家盔甲 → 模型装备（联机40）
 *
 * 本地甲片颜色是"从背包四槽的物品算出来的"，数据源一直是逐槽 id，缺的只是没告诉队友。
 * 这里钉住转换规则：只写非空槽（空槽必须删，不能写 0——那会被渲染成一层灰）、
 * 坏值跳过、数组短了当空。
 */

import { describe, expect, it } from 'vitest';
import { ARMOR_EQUIPMENT_SLOTS, armorEquipmentPatch, offhandEquipmentPatch } from '../web/src/core/net/RemoteArmor.ts';

describe('armorEquipmentPatch', () => {
  it('四槽齐全时逐槽映射到头/胸/腿/脚', () => {
    expect(armorEquipmentPatch([101, 102, 103, 104])).toEqual({
      head: 101,
      chest: 102,
      legs: 103,
      feet: 104,
    });
  });

  it('空槽不写 0（写了会渲染成一层灰）', () => {
    const patch = armorEquipmentPatch([0, 102, 0, 104]);
    expect(patch).toEqual({ chest: 102, feet: 104 });
    expect('head' in patch).toBe(false);
  });

  it('只有胸甲时也能用（最常见的场景）', () => {
    expect(armorEquipmentPatch([0, 102, 0, 0])).toEqual({ chest: 102 });
  });

  it('数组短了当空：老客户端只发前几位也不崩', () => {
    expect(armorEquipmentPatch([101])).toEqual({ head: 101 });
    expect(armorEquipmentPatch([])).toEqual({});
  });

  it('缺省 / undefined 返回空补丁', () => {
    expect(armorEquipmentPatch(undefined)).toEqual({});
  });

  it('坏值跳过：小数、负数、NaN、非数字都不认', () => {
    expect(armorEquipmentPatch([1.5, -3, Number.NaN, Number.POSITIVE_INFINITY])).toEqual({});
    // @ts-expect-error 故意塞非数字，模拟坏包
    expect(armorEquipmentPatch(['101', null, {}, true])).toEqual({});
  });

  it('超长的数组只取前四格（背上多一格不该被当成脚甲）', () => {
    expect(armorEquipmentPatch([101, 102, 103, 104, 999])).toEqual({
      head: 101,
      chest: 102,
      legs: 103,
      feet: 104,
    });
  });

  it('槽顺序是 头/胸/腿/脚（与 ARMOR_SLOT_BASE 一致）', () => {
    expect([...ARMOR_EQUIPMENT_SLOTS]).toEqual(['head', 'chest', 'legs', 'feet']);
  });
});

describe('offhandEquipmentPatch（联机41 的尾巴）', () => {
  it('有物品就写进 offHand', () => {
    expect(offhandEquipmentPatch(42)).toEqual({ offHand: 42 });
  });

  it('0 / 缺省 = 空补丁（调用方据此删掉 offHand，而不是写 0）', () => {
    expect(offhandEquipmentPatch(0)).toEqual({});
    expect(offhandEquipmentPatch(undefined)).toEqual({});
  });

  it('坏值一律不收', () => {
    expect(offhandEquipmentPatch(-1)).toEqual({});
    expect(offhandEquipmentPatch(1.5)).toEqual({});
    expect(offhandEquipmentPatch(Number.NaN)).toEqual({});
  });
});
