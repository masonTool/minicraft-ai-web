/**
 * 光标交互离线测试（批次 128）——双击收集 / 拖拽分配 / 数字键换槽 / 丢出
 *
 * 与 `test:quickmove`（批次 127 的 Shift 系列）同一套路：**规则在纯模块里、界面只交坐标**。
 * 参照物还是「Minecraft Wiki · Inventory」那张交互表（TASKS H19 的 ④⑤⑥⑦ 条）。
 *
 * 运行：npm run test:cursor
 */

import { Block } from '../src/core/registry/blocks.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import {
  Inventory,
  OFFHAND_SLOT,
  type ItemStack,
  type SlotSource,
} from '../src/core/container/Inventory.ts';
import {
  distributeEvenly,
  dropCount,
  gatherSameItems,
  placeOneEach,
  slotForKey,
  swapWithSlot,
} from '../src/core/container/CursorActions.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

/** 数组背书的假容器 */
function makeContainer(size: number, fill: (i: number) => ItemStack | null = () => null): SlotSource & { set(i: number, s: ItemStack | null): void } {
  const slots: (ItemStack | null)[] = Array.from({ length: size }, (_u, i) => fill(i));
  return {
    get: (i) => slots[i] ?? null,
    set: (i, stack) => {
      slots[i] = stack;
    },
  };
}

const stone = (count: number): ItemStack => ({ id: Block.STONE, count });
const dirt = (count: number): ItemStack => ({ id: Block.DIRT, count });
const slotsAt = (source: SlotSource, ...indexes: number[]) => indexes.map((index) => ({ source, index }));

// ---------------------------------------------------------------- 1. 双击收集

console.log('\n[双击收集：把同一类凑满一整堆]');
{
  const chest = makeContainer(27, (i) => (i < 5 ? stone(20) : null));
  const held = gatherSameItems(chest, 27, Block.STONE, null);
  equal('抓满一整堆（64）', held?.count, 64);
  equal('第一格被拿空', chest.get(0), null);
  equal('第二格被拿空', chest.get(1), null);
  // 20+20+20 = 60，还差 4 个 → 从**第四格**再拿 4 个（前两格被拿空、第三格也空了）
  equal('第三格被拿空', chest.get(2), null);
  equal('第四格拿走 4 个、留 16 个', chest.get(3)?.count, 16);
  equal('第五格没被碰', chest.get(4)?.count, 20);

  // 光标上已经有半叠：凑到满为止
  const chest2 = makeContainer(27, (i) => (i === 6 ? stone(30) : null));
  const held2 = gatherSameItems(chest2, 27, Block.STONE, stone(10));
  // 全库里只有 30 个石头：10 + 30 = 40（没有更多可凑的了）
  equal('把那一格的 30 个全收进来（10 + 30）', held2?.count, 40);
  equal('那一格空了', chest2.get(6), null);

  // 只收**同种**：箱子里的泥土不动
  const mixed = makeContainer(27, (i) => (i === 0 ? stone(5) : i === 1 ? dirt(64) : null));
  const held3 = gatherSameItems(mixed, 27, Block.STONE, null);
  equal('只收到石头 5 个', held3?.count, 5);
  equal('泥土那一格原样不动', mixed.get(1)?.count, 64);

  // 附加数据不同的不并（附魔剑 ≠ 普通剑）
  const sword = toolItemId('sword', 'iron');
  const swords = makeContainer(27, (i) =>
    i === 0
      ? { id: sword, count: 1, enchants: { sharpness: 3 } }
      : i === 1
        ? { id: sword, count: 1 }
        : null,
  );
  const held4 = gatherSameItems(swords, 27, sword, null, { enchants: { sharpness: 3 } });
  equal('附魔剑只收集到它自己那一把', held4?.count, 1);
  equal('普通剑留在原处', swords.get(1)?.count, 1);

  // 库里一个同类都没有 → 返回空（界面据此不做双击）
  const empty = makeContainer(27, () => dirt(1));
  equal('没有同类时什么都不抓', gatherSameItems(empty, 27, Block.STONE, null), null);
}

// ---------------------------------------------------------------- 2. 左键拖拽：均分

console.log('\n[左键拖过多个槽：平均分配（余数留在光标）]');
{
  const inv = new Inventory();
  const held = distributeEvenly(stone(10), slotsAt(inv, 0, 1, 2));
  equal('光标只剩 1 个（余数）', held?.count, 1);
  equal('第 0 格 3 个', inv.get(0)?.count, 3);
  equal('第 1 格 3 个', inv.get(1)?.count, 3);
  equal('第 2 格 3 个', inv.get(2)?.count, 3);

  // 刚好整除 → 光标清空
  const inv2 = new Inventory();
  equal('10 个分给 2 格 → 光标空', distributeEvenly(stone(10), slotsAt(inv2, 5, 6)), null);
  equal('两格各 5 个', `${inv2.get(5)?.count},${inv2.get(6)?.count}`, '5,5');

  // 别种物品的槽**跳过**（原版：只有空槽或同类才会被分配到）
  const inv3 = new Inventory();
  inv3.set(1, dirt(64));
  distributeEvenly(stone(4), slotsAt(inv3, 0, 1, 2));
  equal('第 0 格拿了 2 个', inv3.get(0)?.count, 2);
  equal('第 1 格（泥土）没被塞石头', inv3.get(1)?.id, Block.DIRT);
  equal('第 2 格拿了 2 个', inv3.get(2)?.count, 2);

  // 半叠同类：每格最多拿"地板份额"（10 ÷ 2 = 5），**放不下的份额不会转给下一格**
  // （原版 `doDrag` 就是按槽位平分：一格最多 share 个）
  const inv4 = new Inventory();
  inv4.set(0, stone(62));
  const left = distributeEvenly(stone(10), slotsAt(inv4, 0, 1));
  equal('第 0 格只能补 2 个（到 64）', inv4.get(0)?.count, 64);
  equal('第 1 格拿到它的份额 5 个', inv4.get(1)?.count, 5);
  equal('剩下的 3 个留在光标上', left?.count, 3);

  // 目标没一个能收 → 原样退回
  const inv5 = new Inventory();
  inv5.set(0, dirt(64));
  equal('全放不下时原样退回', distributeEvenly(stone(3), slotsAt(inv5, 0))?.count, 3);
}

// ---------------------------------------------------------------- 3. 右键拖拽：每格一个

console.log('\n[右键拖过多个槽：每个槽位放 1 个]');
{
  const inv = new Inventory();
  const held = placeOneEach(stone(10), slotsAt(inv, 0, 1, 2, 3, 4));
  equal('光标剩 5 个', held?.count, 5);
  equal('每格 1 个', [0, 1, 2, 3, 4].map((i) => inv.get(i)?.count).join(','), '1,1,1,1,1');

  // 别种物品跳过、同类半满 +1
  const inv2 = new Inventory();
  inv2.set(0, dirt(64));
  inv2.set(1, stone(63));
  const left2 = placeOneEach(stone(3), slotsAt(inv2, 0, 1, 2));
  equal('泥土那格没被碰', inv2.get(0)?.id, Block.DIRT);
  equal('同类那一格 +1 到满', inv2.get(1)?.count, 64);
  equal('空格拿到 1 个', inv2.get(2)?.count, 1);
  equal('光标剩 1 个', left2?.count, 1);
}

// ---------------------------------------------------------------- 4. 数字键 / F

console.log('\n[数字键 1-9 / F：与快捷栏、副手交换]');
{
  equal('按键 → 槽位：1 是快捷栏第 0 格', slotForKey('1'), 0);
  equal('按键 → 槽位：9 是快捷栏第 8 格', slotForKey('9'), 8);
  equal('按键 → 槽位：F 是副手', slotForKey('f'), OFFHAND_SLOT);
  equal('别的键不认（返回 null）', slotForKey('0'), null);
  equal('字母键也不认', slotForKey('g'), null);

  // 悬停背包里的东西 + 快捷栏为空 → 搬过去
  {
    const inv = new Inventory();
    inv.set(20, stone(7));
    check('交换成功', swapWithSlot(inv, { source: inv, index: 20 }, '1'));
    equal('进了快捷栏第 0 格', inv.get(0)?.count, 7);
    equal('原格空了', inv.get(20), null);
  }

  // 两边都有东西 → 交换
  {
    const inv = new Inventory();
    inv.set(20, stone(7));
    inv.set(3, dirt(2));
    swapWithSlot(inv, { source: inv, index: 20 }, '4');
    equal('快捷栏那格换成石头', inv.get(3)?.id, Block.STONE);
    equal('背包那格换成泥土', inv.get(20)?.id, Block.DIRT);
  }

  // 悬停的是**容器的格子** → 同样与快捷栏交换
  {
    const inv = new Inventory();
    const chest = makeContainer(27, (i) => (i === 2 ? stone(30) : null));
    swapWithSlot(inv, { source: chest, index: 2 }, '2');
    equal('箱子里的东西进了快捷栏第 1 格', inv.get(1)?.count, 30);
    equal('箱子那一格空了', chest.get(2), null);
  }

  // F：与副手交换
  {
    const inv = new Inventory();
    inv.set(15, stone(1));
    swapWithSlot(inv, { source: inv, index: 15 }, 'f');
    equal('东西进了副手', inv.get(OFFHAND_SLOT)?.count, 1);
    equal('原格空了', inv.get(15), null);
  }

  // 两边都空 → 不动（界面据此不刷新）
  {
    const inv = new Inventory();
    check('两边都空时不动', !swapWithSlot(inv, { source: inv, index: 20 }, '1'));
  }
}

// ---------------------------------------------------------------- 5. 丢出

console.log('\n[Q / Ctrl+Q：丢 1 件 / 丢整叠]');
{
  equal('Q：丢 1 件', dropCount(stone(10), false), 1);
  equal('Ctrl+Q：丢整叠', dropCount(stone(10), true), 10);
  equal('空手时丢 0 件（界面据此什么都不做）', dropCount(null, false), 0);
  equal('空手 + Ctrl+Q 也是 0', dropCount(null, true), 0);
}

console.log(`\n光标交互测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
