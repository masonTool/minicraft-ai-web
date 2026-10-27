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
import { layoutInventoryPanel, splitCountFromDrag } from '../src/ui2d/InventoryPanel2D.ts';
import { itemTooltipRect } from '../src/ui2d/itemTooltip.ts';
import {
  arraySlots,
  distributeDrag,
  doubleClickGather,
  leftClick,
  quickMove,
  rightClick,
  rightDragDistribute,
  splitTake,
  swapSlots,
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

/**
 * 长按选数量：拖动距离 → 数量（`splitCountFromDrag`）。
 *
 * DOM 版那条滑条就是"往右拉得越多、取得越多"，1 格 ≈ 12px；这里把它钉成纯函数，
 * 免得以后调手感时改坏了却没人发现（错了的表现是"怎么拉都只取一个"）。
 */
describe('长按选数量', () => {
  it('不动就是 1 个', () => {
    expect(splitCountFromDrag(0, 64)).toBe(1);
  });

  it('往右每 12px 多一个', () => {
    expect(splitCountFromDrag(12, 64)).toBe(2);
    expect(splitCountFromDrag(36, 64)).toBe(4);
    expect(splitCountFromDrag(120, 64)).toBe(11);
  });

  it('夹在 1..max 之间（不会取 0，也不会超过这一叠）', () => {
    expect(splitCountFromDrag(-500, 64)).toBe(1);
    expect(splitCountFromDrag(99999, 64)).toBe(64);
  });

  it('空格（max=0）返回 0；非法输入退回 1', () => {
    expect(splitCountFromDrag(50, 0)).toBe(0);
    expect(splitCountFromDrag(Number.NaN, 64)).toBe(1);
  });
});

/**
 * 工作站布局（`layoutInventoryPanel` 的 `extra`）：合成台的 3×3 + 结果格。
 *
 * 顺序是硬约定：**先工作站那几格（含结果格），再主背包 27，最后快捷栏 9** ——
 * 调用方按这个顺序接 `SlotAccess`，顺序错了就会出现"拖进合成格、东西跑到背包"。
 */
describe('工作站布局', () => {
  const base = { mainRows: 3, hotbarRows: 1 };

  it('纯背包时是 36 格，没有额外分组', () => {
    const layout = layoutInventoryPanel(0, 0, base);
    expect(layout.slots.length).toBe(36);
    expect(layout.groups.extra.length).toBe(0);
    expect(layout.groups.result).toBeNull();
    expect(layout.groups.main.length).toBe(27);
    expect(layout.groups.hotbar.length).toBe(9);
  });

  it('合成台：9 + 结果 1 + 36 = 46，且顺序固定', () => {
    const layout = layoutInventoryPanel(0, 0, { ...base, extra: { cols: 3, rows: 3, result: true } });
    expect(layout.slots.length).toBe(46);
    expect(layout.groups.extra.length).toBe(9);
    // 结果格排在第 10 个（extra 之后、主背包之前）
    expect(layout.slots[9]).toEqual(layout.groups.result);
    expect(layout.slots[10]).toEqual(layout.groups.main[0]);
  });

  it('结果格在网格右侧、竖直居中，中间留出箭头的位置', () => {
    const layout = layoutInventoryPanel(0, 0, { ...base, extra: { cols: 3, rows: 3, result: true } });
    const result = layout.groups.result!;
    const extra = layout.groups.extra;
    const rightmost = Math.max(...extra.map((r) => r.x + r.w));
    expect(result.x - rightmost).toBe(28);
    const extraTop = Math.min(...extra.map((r) => r.y));
    const extraBottom = Math.max(...extra.map((r) => r.y + r.h));
    expect(result.y + result.h / 2).toBeCloseTo((extraTop + extraBottom) / 2, 6);
  });

  it('额外槽位块在面板里居中（不是靠左）', () => {
    const layout = layoutInventoryPanel(0, 0, { ...base, extra: { cols: 3, rows: 3, result: true } });
    const extra = layout.groups.extra;
    const blockLeft = Math.min(...extra.map((r) => r.x));
    const blockRight = layout.groups.result!.x + layout.groups.result!.w;
    const leftGap = blockLeft - (layout.panel.x + 14);
    const rightGap = layout.panel.x + layout.panel.w - 14 - blockRight;
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
  });

  it('玩家网格被推到额外槽位下面（不会重叠）', () => {
    const layout = layoutInventoryPanel(0, 0, { ...base, extra: { cols: 3, rows: 3 } });
    const extraBottom = Math.max(...layout.groups.extra.map((r) => r.y + r.h));
    const mainTop = Math.min(...layout.groups.main.map((r) => r.y));
    expect(mainTop).toBeGreaterThan(extraBottom);
  });
});

/**
 * 物品提示框的位置（`itemTooltipRect`）。
 *
 * 自绘面板接管指针之后，DOM 的 `#item-tooltip` 就再也收不到 hover 了，所以提示框得自己画。
 * 位置规则很简单但很容易写错：默认右下、右边放不下翻左、下面放不下翻上、最后夹进视口。
 */
describe('提示框位置', () => {
  const size = { w: 150, h: 60 };
  const viewport = { w: 400, h: 300 };

  it('空间够时在指针右下方（偏移 14px）', () => {
    expect(itemTooltipRect({ x: 50, y: 50 }, size, viewport)).toEqual({ x: 64, y: 64, w: 150, h: 60 });
  });

  it('右边放不下就翻到左边', () => {
    const rect = itemTooltipRect({ x: 380, y: 50 }, size, viewport);
    expect(rect.x).toBe(380 - 14 - 150);
    expect(rect.x + rect.w).toBeLessThan(380);
  });

  it('下面放不下就翻到上面', () => {
    const rect = itemTooltipRect({ x: 50, y: 290 }, size, viewport);
    expect(rect.y).toBe(290 - 14 - 60);
  });

  it('屏幕太小时夹进视口（不会出现负坐标）', () => {
    const tiny = { w: 120, h: 40 };
    const rect = itemTooltipRect({ x: 2, y: 2 }, { w: 200, h: 100 }, tiny);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });
});

/**
 * 数字键换槽（`swapSlots`）：DOM 版的 `swapWithSlot`。
 *
 * 与"拿手再放"不同：它**不经过光标**，所以手上那叠不受影响，也不做堆叠合并 —— 是纯粹的换位。
 */
describe('换槽', () => {
  const stone = (count: number) => ({ id: 1, count });

  it('两格互换（含空格）', () => {
    const slots = arraySlots([stone(64), null, { id: 2, count: 5 }]);
    expect(swapSlots(slots, 0, 1)).toBe(true);
    expect(slots.get(0)).toBeNull();
    expect(slots.get(1)).toEqual(stone(64));
    expect(swapSlots(slots, 1, 2)).toBe(true);
    expect(slots.get(1)).toEqual({ id: 2, count: 5 });
    expect(slots.get(2)).toEqual(stone(64));
  });

  it('同一格 / 两格都空 / 越界 都不算换了', () => {
    const slots = arraySlots([stone(64), null]);
    expect(swapSlots(slots, 0, 0)).toBe(false);
    expect(swapSlots(slots, 1, 5)).toBe(false);
    expect(swapSlots(slots, -1, 0)).toBe(false);
    const empty = arraySlots([null, null]);
    expect(swapSlots(empty, 0, 1)).toBe(false);
  });
});
