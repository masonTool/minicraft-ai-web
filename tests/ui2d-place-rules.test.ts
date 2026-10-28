/**
 * 放置规则（`MoveRules.canPlace`）—— 装备列拦面包的那道闸。
 *
 * 为什么规则要放进模型层而不是绘制层：**所有**放置路径（左键放/合并/交换、右键放一个、
 * Shift 快速移动、拖拽均分）都要过同一道闸。散在宿主里就得写五遍，漏一处就会出现
 * "拖拽能塞进头盔格、点一下不能"这种自相矛盾。
 */
import { describe, expect, it } from 'vitest';
import {
  arraySlots,
  distributeDrag,
  leftClick,
  quickMove,
  rightClick,
  type Cursor,
  type MoveRules,
} from '../src/ui2d/inventoryModel.ts';
import { canPlaceInSideSlot, sideSlotAt } from '../src/ui2d/armorRules.ts';

/** 装备列占 0..4，其余随便放 —— 与游戏里的下标顺序一致 */
const rules: MoveRules = {
  limitOf: () => 64,
  sameItem: (a, b) => a.id === b.id,
  canPlace: (index, stack) => {
    const slot = sideSlotAt(index, 0);
    if (!slot) return true;
    // 演示用映射：id 1 = 头盔、6 = 靴子、其它当"不是装备"
    const kind = stack.id === 1 ? 'helmet' : stack.id === 6 ? 'boots' : null;
    return canPlaceInSideSlot(slot, kind);
  },
};

const stone = (count: number) => ({ id: 1, count }); // helmet
const torch = (count: number) => ({ id: 7, count }); // 非装备

describe('放置规则闸门', () => {
  it('左键：放进盔甲格要过规则（头盔进头盔格 OK，靴子格拒绝）', () => {
    const slots = arraySlots([null, null, null, null, null]);
    const cursor: Cursor = { stack: stone(5) };
    leftClick(slots, rules, cursor, 0); // helmet 格
    expect(slots.get(0)).toEqual(stone(5));
    expect(cursor.stack).toBeNull();
  });

  it('被拒时什么都不变（东西还在手上，不是消失）', () => {
    const slots = arraySlots([null, null, null, null, null]);
    const cursor: Cursor = { stack: torch(3) };
    leftClick(slots, rules, cursor, 0); // 面包/火把进头盔格 → 拒
    expect(slots.get(0)).toBeNull();
    expect(cursor.stack).toEqual(torch(3));
  });

  it('右键"放一个"也过同一道闸', () => {
    const slots = arraySlots([null, null, null, null, null]);
    const cursor: Cursor = { stack: torch(3) };
    rightClick(slots, rules, cursor, 1);
    expect(slots.get(1)).toBeNull();
    expect(cursor.stack).toEqual(torch(3));
  });

  it('Shift 快速移动会跳过不收的格子（不会把东西塞错）', () => {
    // 目标只给四个盔甲格：手雷（非装备）一格都不收，原地不动
    const slots = arraySlots([null, null, null, null, null, torch(9)]);
    quickMove(slots, rules, 5, [0, 1, 2, 3]);
    expect(slots.get(5)).toEqual(torch(9));
    // 但给了副手格就收（副手什么都收）
    quickMove(slots, rules, 5, [4]);
    expect(slots.get(4)).toEqual(torch(9));
    expect(slots.get(5)).toBeNull();
  });

  it('拖拽均分也跳过不收的格子', () => {
    const slots = arraySlots([null, null, null, null, null]);
    const cursor: Cursor = { stack: torch(6) };
    distributeDrag(slots, rules, cursor, [0, 1, 2]);
    expect(slots.get(0)).toBeNull();
    expect(slots.get(1)).toBeNull();
    expect(cursor.stack).toEqual(torch(6));
  });

  it('没配规则时一切照旧（默认全放行）', () => {
    const plain: MoveRules = { limitOf: () => 64, sameItem: (a, b) => a.id === b.id };
    const slots = arraySlots([null]);
    const cursor: Cursor = { stack: torch(2) };
    leftClick(slots, plain, cursor, 0);
    expect(slots.get(0)).toEqual(torch(2));
  });
});
