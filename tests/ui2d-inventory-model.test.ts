/**
 * 背包交互逻辑（`src/ui2d/inventoryModel.ts`）
 *
 * 这一层是"用 canvas 复原背包"的地基：它不画任何像素，只回答
 * "点了某格之后，槽位与光标上的东西怎么变"。所以测试就是**规则的台账** ——
 * 每一条都对应 Wiki「物品管理」里的一句话，改坏了这里会立刻红。
 *
 * 用的是"数组 + 假物品表"（石头 64 上限、剑 1 上限），完全不碰 DOM/canvas。
 */
import { describe, expect, it } from 'vitest';
import {
  arraySlots,
  distributeDrag,
  doubleClickGather,
  leftClick,
  quickMove,
  rightClick,
  rightDragDistribute,
  splitTake,
  type Cursor,
  type MoveRules,
  type StackLike,
} from '../src/ui2d/inventoryModel.ts';

const RULES: MoveRules = {
  limitOf: (id) => (id === 2 ? 1 : 64), // 2 = 剑（不可堆叠），其余 64
  sameItem: (a, b) => a.id === b.id,
};

const stone = (count: number): StackLike => ({ id: 1, count });
const sword = (count = 1): StackLike => ({ id: 2, count });
const emptyCursor = (): Cursor => ({ stack: null });

describe('左键', () => {
  it('空手点有货的格子：整叠拿起', () => {
    const slots = arraySlots([stone(12)]);
    const cursor = emptyCursor();
    leftClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toBeNull();
    expect(cursor.stack).toEqual(stone(12));
  });

  it('手上有货点空格：整叠放下', () => {
    const slots = arraySlots([null]);
    const cursor: Cursor = { stack: stone(5) };
    leftClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toEqual(stone(5));
    expect(cursor.stack).toBeNull();
  });

  it('同类合并：装得下就全并进去', () => {
    const slots = arraySlots([stone(10)]);
    const cursor: Cursor = { stack: stone(20) };
    leftClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toEqual(stone(30));
    expect(cursor.stack).toBeNull();
  });

  it('同类合并：装不下时余数留在手上', () => {
    const slots = arraySlots([stone(60)]);
    const cursor: Cursor = { stack: stone(10) };
    leftClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toEqual(stone(64));
    expect(cursor.stack).toEqual(stone(6));
  });

  it('同类已满：不动（原版"满堆无法合并"）', () => {
    const slots = arraySlots([stone(64)]);
    const cursor: Cursor = { stack: stone(5) };
    leftClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toEqual(stone(64));
    expect(cursor.stack).toEqual(stone(5));
  });

  it('异类交换', () => {
    const slots = arraySlots([sword()]);
    const cursor: Cursor = { stack: stone(3) };
    leftClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toEqual(stone(3));
    expect(cursor.stack).toEqual(sword());
  });

  it('空手点空格：什么都不做', () => {
    const slots = arraySlots([null]);
    const cursor = emptyCursor();
    leftClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toBeNull();
    expect(cursor.stack).toBeNull();
  });
});

describe('右键', () => {
  it('空手点有货：拿一半（奇数向上取整）', () => {
    const slots = arraySlots([stone(7)]);
    const cursor = emptyCursor();
    rightClick(slots, RULES, cursor, 0);
    expect(cursor.stack).toEqual(stone(4));
    expect(slots.get(0)).toEqual(stone(3));
  });

  it('空手点只有 1 个的格子：整叠拿起', () => {
    const slots = arraySlots([stone(1)]);
    const cursor = emptyCursor();
    rightClick(slots, RULES, cursor, 0);
    expect(cursor.stack).toEqual(stone(1));
    expect(slots.get(0)).toBeNull();
  });

  it('手上有货点空格：只放一个', () => {
    const slots = arraySlots([null]);
    const cursor: Cursor = { stack: stone(9) };
    rightClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toEqual(stone(1));
    expect(cursor.stack).toEqual(stone(8));
  });

  it('同类右键：往格里放一个（受上限）', () => {
    const slots = arraySlots([stone(63)]);
    const cursor: Cursor = { stack: stone(2) };
    rightClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toEqual(stone(64));
    expect(cursor.stack).toEqual(stone(1));
  });

  it('异类右键：不动（原版不做交换）', () => {
    const slots = arraySlots([sword()]);
    const cursor: Cursor = { stack: stone(2) };
    rightClick(slots, RULES, cursor, 0);
    expect(slots.get(0)).toEqual(sword());
    expect(cursor.stack).toEqual(stone(2));
  });
});

describe('Shift+左键（快速移动）', () => {
  it('先并进同类堆，再占空格', () => {
    // 0 号 30 个石头，目标区：1 号有 20 个石头、2 号空
    const slots = arraySlots([stone(30), stone(20), null]);
    quickMove(slots, RULES, 0, [1, 2]);
    expect(slots.get(0)).toBeNull();
    expect(slots.get(1)).toEqual(stone(50));
    expect(slots.get(2)).toBeNull();
  });

  it('同类装不下时剩下的占空格', () => {
    const slots = arraySlots([stone(30), stone(60), null]);
    quickMove(slots, RULES, 0, [1, 2]);
    expect(slots.get(1)).toEqual(stone(64));
    expect(slots.get(2)).toEqual(stone(26));
    expect(slots.get(0)).toBeNull();
  });

  it('目标区塞满时留在原格', () => {
    const slots = arraySlots([stone(10), stone(64), stone(64)]);
    quickMove(slots, RULES, 0, [1, 2]);
    expect(slots.get(0)).toEqual(stone(10));
  });
});

describe('拖拽分配', () => {
  it('均分到经过的格子，余数给前面的', () => {
    const slots = arraySlots([null, null, null]);
    const cursor: Cursor = { stack: stone(10) };
    distributeDrag(slots, RULES, cursor, [0, 1, 2]);
    expect(slots.get(0)).toEqual(stone(4));
    expect(slots.get(1)).toEqual(stone(3));
    expect(slots.get(2)).toEqual(stone(3));
    expect(cursor.stack).toBeNull();
  });

  it('重复经过同一格只算一次', () => {
    const slots = arraySlots([null, null]);
    const cursor: Cursor = { stack: stone(4) };
    distributeDrag(slots, RULES, cursor, [0, 0, 1]);
    expect(slots.get(0)).toEqual(stone(2));
    expect(slots.get(1)).toEqual(stone(2));
  });

  it('跳过装不下的格子（同类已满 / 异类非空）', () => {
    const slots = arraySlots([stone(64), sword(), null]);
    const cursor: Cursor = { stack: stone(6) };
    distributeDrag(slots, RULES, cursor, [0, 1, 2]);
    expect(slots.get(0)).toEqual(stone(64));
    expect(slots.get(1)).toEqual(sword());
    expect(slots.get(2)).toEqual(stone(6));
    expect(cursor.stack).toBeNull();
  });

  it('一个格子都装不下时原样留在手上', () => {
    const slots = arraySlots([sword()]);
    const cursor: Cursor = { stack: stone(3) };
    distributeDrag(slots, RULES, cursor, [0]);
    expect(cursor.stack).toEqual(stone(3));
  });
});

describe('右键拖拽（每格放一个）', () => {
  it('拖过 3 格各放一个，手上的递减', () => {
    const slots = arraySlots([null, null, null]);
    const cursor: Cursor = { stack: stone(5) };
    rightDragDistribute(slots, RULES, cursor, [0, 1, 2]);
    expect(slots.get(0)).toEqual(stone(1));
    expect(slots.get(1)).toEqual(stone(1));
    expect(slots.get(2)).toEqual(stone(1));
    expect(cursor.stack).toEqual(stone(2));
  });

  it('手上不够时按格数停下（不会凭空多出物品）', () => {
    const slots = arraySlots([null, null, null]);
    const cursor: Cursor = { stack: stone(2) };
    rightDragDistribute(slots, RULES, cursor, [0, 1, 2]);
    expect(slots.get(0)).toEqual(stone(1));
    expect(slots.get(1)).toEqual(stone(1));
    expect(slots.get(2)).toBeNull();
    expect(cursor.stack).toBeNull();
  });

  it('跳过异类与已满的同类格', () => {
    const slots = arraySlots([sword(), stone(64), null]);
    const cursor: Cursor = { stack: stone(3) };
    rightDragDistribute(slots, RULES, cursor, [0, 1, 2]);
    expect(slots.get(0)).toEqual(sword());
    expect(slots.get(1)).toEqual(stone(64));
    expect(slots.get(2)).toEqual(stone(1));
    expect(cursor.stack).toEqual(stone(2));
  });

  it('重复经过同一格只放一个', () => {
    const slots = arraySlots([null]);
    const cursor: Cursor = { stack: stone(4) };
    rightDragDistribute(slots, RULES, cursor, [0, 0, 0]);
    expect(slots.get(0)).toEqual(stone(1));
    expect(cursor.stack).toEqual(stone(3));
  });
});

describe('双击收集', () => {
  it('先拿起那一格，再把同类凑到上限', () => {
    // 0 号 10 个（被双击），1 号 20 个，2 号 40 个
    const slots = arraySlots([stone(10), stone(20), stone(40)]);
    const cursor = emptyCursor();
    doubleClickGather(slots, RULES, cursor, 0, [0, 1, 2]);
    // 10 + 20 + 34 = 64（上限），2 号剩 6
    expect(cursor.stack).toEqual(stone(64));
    expect(slots.get(0)).toBeNull();
    expect(slots.get(1)).toBeNull();
    expect(slots.get(2)).toEqual(stone(6));
  });

  it('跳过异类，不碰不可堆叠的东西', () => {
    const slots = arraySlots([stone(10), sword(), stone(5)]);
    const cursor = emptyCursor();
    doubleClickGather(slots, RULES, cursor, 0, [0, 1, 2]);
    expect(cursor.stack).toEqual(stone(15));
    expect(slots.get(1)).toEqual(sword());
  });

  it('光标上已有一叠时，先并进它再收集', () => {
    const slots = arraySlots([stone(10), stone(10)]);
    const cursor: Cursor = { stack: stone(50) };
    doubleClickGather(slots, RULES, cursor, 0, [0, 1]);
    // 50 + 10（0 号）+ 4（1 号补到 64）= 64，1 号剩 6
    expect(cursor.stack).toEqual(stone(64));
    expect(slots.get(1)).toEqual(stone(6));
  });

  it('双击空格且空手：什么都不做', () => {
    const slots = arraySlots([null, stone(10)]);
    const cursor = emptyCursor();
    doubleClickGather(slots, RULES, cursor, 0, [0, 1]);
    expect(cursor.stack).toBeNull();
    expect(slots.get(1)).toEqual(stone(10));
  });
});

describe('长按分堆（取指定数量）', () => {
  it('取指定的 3 个到光标', () => {
    const slots = arraySlots([stone(10)]);
    const cursor = emptyCursor();
    splitTake(slots, RULES, cursor, 0, 3);
    expect(cursor.stack).toEqual(stone(3));
    expect(slots.get(0)).toEqual(stone(7));
  });

  it('数量超过格里的就全取走', () => {
    const slots = arraySlots([stone(2)]);
    const cursor = emptyCursor();
    splitTake(slots, RULES, cursor, 0, 9);
    expect(cursor.stack).toEqual(stone(2));
    expect(slots.get(0)).toBeNull();
  });

  it('光标上有同类时并进去（受上限）', () => {
    const slots = arraySlots([stone(10)]);
    const cursor: Cursor = { stack: stone(60) };
    splitTake(slots, RULES, cursor, 0, 8);
    expect(cursor.stack).toEqual(stone(64));
    expect(slots.get(0)).toEqual(stone(6));
  });

  it('光标上有异类时拒绝（与原版一致）', () => {
    const slots = arraySlots([stone(10)]);
    const cursor: Cursor = { stack: sword() };
    splitTake(slots, RULES, cursor, 0, 5);
    expect(cursor.stack).toEqual(sword());
    expect(slots.get(0)).toEqual(stone(10));
  });
});
