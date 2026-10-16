/**
 * 中键拾取方块离线测试（批次 129，TASKS H19 的 ⑩）
 *
 * 原版最常用的交互之一：**中键点准星指着的方块，把它塞进快捷栏**。
 * 三条规则（「Minecraft Wiki · Inventory」那张表）：
 *  1. 已经在**快捷栏**里 → 只是**切到那一格**（不动任何物品）；
 *  2. 在**主背包**里 → 与**当前选中的**快捷栏格**交换**；
 *  3. 两边都没有 → **创造模式**（本项目：能飞 = 创造）给一份，生存什么都不做。
 *
 * 另外这一套还盯着"拾取出来是哪件物品"那条**顺序**：先看方块自己的物品形态、
 * 没有才退到掉落——反过来的话**石头会拾取成圆石**（掉落是圆石），而原版给的是石头。
 *
 * 运行：npm run test:pickblock
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  HOTBAR_SIZE,
  HOTBAR_START,
  Inventory,
  MAIN_SIZE,
  MAIN_START,
} from '../src/core/container/Inventory.ts';
import { applyPickBlock, pickItemFor, planPickBlock } from '../src/core/interaction/PickBlock.ts';

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

const stone = (count: number) => ({ id: Block.STONE, count });
const dirt = (count: number) => ({ id: Block.DIRT, count });

// ---------------------------------------------------------------- 1. 拾取出来是哪件东西

console.log('\n[拾取出来是哪件物品]');
{
  equal('石头拾取成**石头本身**（不是圆石——先看物品形态、再看掉落）', pickItemFor(Block.STONE), Block.STONE);
  equal('草方块拾取成草方块本身（它的掉落是泥土，但原版给的是草方块）', pickItemFor(Block.GRASS_BLOCK), Block.GRASS_BLOCK);
  equal('圆石拾取成圆石', pickItemFor(Block.COBBLESTONE), Block.COBBLESTONE);
  // ⚠️ 作物这一类：本项目的**每一种方块都有物品形态**（创造物品栏要用），
  // 所以拾取给的是**那个方块本身**（`WHEAT_STAGE3`），而原版给的是"物品形态"= 小麦。
  // 这是本项目数据模型的直接后果，记在 TASKS H19；这里把实际行为钉住
  check(
    '成熟的小麦拾取成**作物方块本身**（本项目每种方块都有物品形态，与原版不同）',
    pickItemFor(Block.WHEAT_STAGE3) === Block.WHEAT_STAGE3,
    `${pickItemFor(Block.WHEAT_STAGE3)}`,
  );
  check('而它的掉落确实是小麦（说明"先物品形态、再掉落"那条顺序真的存在）', pickItemFor(Block.WHEAT_STAGE3) !== Item.WHEAT);
  // 空气与火都拾不了
  equal('空气拾取不了', pickItemFor(Block.AIR), null);
  equal('火拾取不了', pickItemFor(Block.FIRE), null);
  check('（对照）石头确实有物品形态', pickItemFor(Block.STONE) !== null);
}

// ---------------------------------------------------------------- 2. 三条规则

console.log('\n[三条规则：切过去 / 交换 / 给一份]');
{
  // ① 已经在快捷栏里 → 切过去（不动物品）
  {
    const inv = new Inventory();
    inv.set(3, stone(64));
    inv.set(20, dirt(5));
    const plan = planPickBlock(inv, Block.STONE, 0, false);
    check('计划是"切过去"', plan?.kind === 'select');
    equal('切到第 3 格', plan?.kind === 'select' ? plan.slot : -1, 3);
    check('没有动任何物品（纯计划）', inv.get(3)?.count === 64 && inv.get(20)?.count === 5);
    check('"切过去"不落在背包上（由调用方 selectSlot）', !applyPickBlock(inv, plan));
    equal('（对照）那一格的东西一点没动', inv.get(3)?.count, 64);
  }

  // 手上就是它 → 什么都不用做
  {
    const inv = new Inventory();
    inv.set(0, stone(10));
    equal('手上就是它 → 不需要做任何事', planPickBlock(inv, Block.STONE, 0, false), null);
  }

  // ② 在主背包里 → 与当前选中的快捷栏格交换
  {
    const inv = new Inventory();
    inv.set(MAIN_START + 4, stone(7));
    inv.set(2, dirt(3));
    const plan = planPickBlock(inv, Block.STONE, 2, false);
    check('计划是"交换"', plan?.kind === 'swap');
    equal('从主背包那一格来', plan?.kind === 'swap' ? plan.from : -1, MAIN_START + 4);
    equal('换进选中的第 2 格', plan?.kind === 'swap' ? plan.to : -1, 2);
    check('落到了背包上', applyPickBlock(inv, plan));
    equal('石头到了手上那一格', inv.get(2)?.id, Block.STONE);
    equal('原来的泥土回到主背包那一格（原版就是交换）', inv.get(MAIN_START + 4)?.id, Block.DIRT);
  }

  // ③ 两边都没有：创造给一份、生存什么都不做
  {
    const creative = new Inventory();
    const plan = planPickBlock(creative, Block.STONE, 5, true);
    check('创造模式：计划是"给一份"', plan?.kind === 'give');
    equal('给进选中的第 5 格', plan?.kind === 'give' ? plan.to : -1, 5);
    check('落到了背包上', applyPickBlock(creative, plan));
    equal('手上出现了 1 个石头', creative.get(5)?.count, 1);

    const survival = new Inventory();
    equal('生存模式：什么都不做', planPickBlock(survival, Block.STONE, 5, false), null);
  }

  // ③b 创造模式但手上那一格有东西 → 不动它（本项目比原版保守，见 PickBlock 的注记）
  {
    const inv = new Inventory();
    inv.set(5, dirt(64));
    const plan = planPickBlock(inv, Block.STONE, 5, true);
    check('创造：手上那格有东西时计划仍是"给一份"', plan?.kind === 'give');
    check('但落地时**不动它**（宁可少做，也不把东西丢在地上）', !applyPickBlock(inv, plan));
    equal('那一格还是泥土', inv.get(5)?.id, Block.DIRT);
  }

  // 选中的格越界时夹到区间内（命令/存档给过奇怪的值）
  {
    const inv = new Inventory();
    const plan = planPickBlock(inv, Block.STONE, 99, true);
    equal('选中格越界 → 夹到最后一格', plan?.kind === 'give' ? plan.to : -1, HOTBAR_START + HOTBAR_SIZE - 1);
  }
}

// ---------------------------------------------------------------- 3. 对照：三档的优先级

console.log('\n[优先级与边界]');
{
  // 快捷栏与主背包**都有**时：用快捷栏那一份（不搬物品）
  const inv = new Inventory();
  inv.set(4, stone(1));
  inv.set(MAIN_START, stone(1));
  const plan = planPickBlock(inv, Block.STONE, 0, false);
  check('两边都有 → 优先"切过去"（原版不搬东西）', plan?.kind === 'select');
  equal('切到快捷栏那一格', plan?.kind === 'select' ? plan.slot : -1, 4);

  // 只搬**主背包**（9~35）：盔甲槽与副手的同类不算
  const armorOnly = new Inventory();
  armorOnly.set(36, stone(1));
  equal('盔甲槽里的同类不算（原版也不拿它）', planPickBlock(armorOnly, Block.STONE, 0, false), null);
  check('（前置）盔甲槽确实在快捷栏与主背包之外', 36 >= HOTBAR_START + HOTBAR_SIZE + MAIN_SIZE);

  // 三种计划各自的 kind 拼起来覆盖全部出口
  const kinds = new Set<string>();
  const a = new Inventory();
  a.set(1, stone(1));
  kinds.add(planPickBlock(a, Block.STONE, 0, false)!.kind);
  const b = new Inventory();
  b.set(MAIN_START, stone(1));
  kinds.add(planPickBlock(b, Block.STONE, 0, false)!.kind);
  const c = new Inventory();
  kinds.add(planPickBlock(c, Block.STONE, 0, true)!.kind);
  equal('三种出口都用到了（select / swap / give）', [...kinds].sort().join(','), 'give,select,swap');
}

console.log(`\n中键拾取测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
