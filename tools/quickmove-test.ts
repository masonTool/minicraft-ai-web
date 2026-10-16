/**
 * 快速移动（Shift+左键）离线测试（批次 127）
 *
 * 这一批把原版背包界面里**用得最多的一次点击**补上了。它的规则是纯逻辑
 * （`core/container/QuickMove.ts`），而最容易错的恰恰是**顺序**：
 *
 *  1. **并同类优先于找空位**（不然"箱子里两叠半满的石头"会被塞进空格）；
 *  2. **方块 → 玩家背包**时**先快捷栏（0→8）、再主背包（9→35）**；
 *  3. **背包 → 方块**时按方块格子顺序（0 → size-1）；
 *  4. 能塞多少塞多少、**剩下的留在原处**（原版 `moveItemStackTo` 就是部分移动）；
 *  5. **盔甲直接穿上**；换下来的那件**塞不下就不换**；
 *  6. **附加数据不同的不并堆**（同一把剑带不带附魔是两件东西）。
 *
 * 这些每一条都要能断言，所以规则没有写在界面里——界面只负责把"哪一格、
 * 开着哪个容器、容器多少格"交出来。运行：npm run test:quickmove
 */

import { ARMOR_SLOT_BASE } from '../src/core/registry/armor.ts';
import { Block } from '../src/core/registry/blocks.ts';
import {
  HOTBAR_SIZE,
  Inventory,
  MAIN_SIZE,
  MAIN_START,
  OFFHAND_SLOT,
  type ItemStack,
  type SlotSource,
} from '../src/core/container/Inventory.ts';
import { PLAYER_FILL_ORDER, fitCount, quickMove } from '../src/core/container/QuickMove.ts';
import { armorItemId } from '../src/core/registry/armor.ts';
import { toolItemId } from '../src/core/registry/tools.ts';

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

/** 一个数组背书的假容器（箱子/熔炉那一族在规则层只需要 get/set） */
function makeContainer(size: number, fill: (i: number) => ItemStack | null = () => null): SlotSource & { peek(i: number): ItemStack | null } {
  const slots: (ItemStack | null)[] = Array.from({ length: size }, (_u, i) => fill(i));
  return {
    get: (i) => slots[i] ?? null,
    set: (i, stack) => {
      slots[i] = stack;
    },
    peek: (i) => slots[i] ?? null,
  };
}

const stone = (count: number): ItemStack => ({ id: Block.STONE, count });
const dirt = (count: number): ItemStack => ({ id: Block.DIRT, count });

// ---------------------------------------------------------------- 1. 背包内部

console.log('\n[背包内部：快捷栏 ↔ 主背包]');
{
  // 快捷栏 → 主背包
  {
    const inv = new Inventory();
    inv.set(0, stone(64));
    const result = quickMove(inv, null, 0, inv, 0);
    check('快捷栏那一叠搬走了', result.moved);
    equal('搬了 64 个', result.count, 64);
    equal('原格空了', inv.get(0), null);
    equal('落在**主背包第一格**（9）', inv.get(MAIN_START)?.count, 64);
    equal('（对照）快捷栏第 1 格没被碰', inv.get(1), null);
  }

  // 主背包 → 快捷栏
  {
    const inv = new Inventory();
    inv.set(MAIN_START + 5, dirt(3));
    const result = quickMove(inv, null, 0, inv, MAIN_START + 5);
    check('主背包那一叠搬走了', result.moved);
    equal('落在**快捷栏第一格**（0）', inv.get(0)?.id, Block.DIRT);
    equal('原格空了', inv.get(MAIN_START + 5), null);
  }

  // 并同类优先于找空位
  {
    const inv = new Inventory();
    inv.set(0, stone(64)); // 快捷栏：满叠
    inv.set(MAIN_START, stone(10)); // 主背包第一格：半叠同类
    const result = quickMove(inv, null, 0, inv, 0);
    equal('先并进同类那一格（＋54）', inv.get(MAIN_START)?.count, 64);
    equal('剩下的 10 个才去第二格', inv.get(MAIN_START + 1)?.count, 10);
    equal('原格空了', inv.get(0), null);
    equal('一共搬了 64 个', result.count, 64);
  }

  // 空格 → 什么也不做
  {
    const inv = new Inventory();
    const result = quickMove(inv, null, 0, inv, 3);
    equal('空槽位 Shift 什么也不发生', result.moved, false);
    equal('搬了 0 件', result.count, 0);
  }

  // **附加数据不同的不并堆**（带附魔的剑与不带的是两件东西）
  {
    const inv = new Inventory();
    const sword = toolItemId('sword', 'iron');
    const plain: ItemStack = { id: sword, count: 1 };
    const enchanted: ItemStack = { id: sword, count: 1, enchants: { sharpness: 3 } };
    inv.set(0, plain);
    inv.set(MAIN_START, enchanted);
    quickMove(inv, null, 0, inv, 0);
    equal('附魔那把没有被并掉', inv.get(MAIN_START)?.enchants?.sharpness, 3);
    equal('普通的落到了另一个空格', inv.get(MAIN_START + 1)?.count, 1);
    equal('而且它不是附魔的', inv.get(MAIN_START + 1)?.enchants, undefined);
  }
}

// ---------------------------------------------------------------- 2. 与容器之间

console.log('\n[与容器之间：方向决定顺序]');
{
  // 容器 → 玩家背包：先快捷栏
  {
    const inv = new Inventory();
    const chest = makeContainer(27, (i) => (i === 3 ? stone(5) : null));
    const result = quickMove(inv, chest, 27, chest, 3);
    check('搬动了', result.moved);
    equal('落在**快捷栏第一格**（0，不是主背包）', inv.get(0)?.count, 5);
    equal('箱子那一格空了', chest.peek(3), null);
  }

  // 玩家背包 → 容器：先并同类，再按格子顺序找空位
  {
    const inv = new Inventory();
    const chest = makeContainer(27, (i) => (i === 2 ? stone(60) : null));
    inv.set(9, stone(10));
    quickMove(inv, chest, 27, inv, 9);
    equal('先并进第 2 格（＋4，补满）', chest.peek(2)?.count, 64);
    equal('剩下的 6 个去了第 0 格（**最先的空格**）', chest.peek(0)?.count, 6);
    equal('（对照）第 1 格仍然是空的', chest.peek(1), null);
    equal('原格空了', inv.get(9), null);
  }

  // 部分移动：容器只剩一格能放 30 个
  {
    const inv = new Inventory();
    // 前 26 格塞满泥土、最后一格放 34 个石头（还能再放 30 个）
    const chest = makeContainer(27, (i) => (i === 26 ? stone(34) : dirt(64)));
    inv.set(0, stone(64));
    const result = quickMove(inv, chest, 27, inv, 0);
    equal('搬走 30 个（能塞多少塞多少）', result.count, 30);
    equal('容器那一格满了', chest.peek(26)?.count, 64);
    equal('**原处留下 34 个**（不是一点不动）', inv.get(0)?.count, 34);
  }

  // 容器满 → 留在原处（不"顺手塞回自己背包"）
  {
    const inv = new Inventory();
    const chest = makeContainer(27, () => dirt(64));
    inv.set(0, stone(64));
    const result = quickMove(inv, chest, 27, inv, 0);
    equal('容器塞不下就不动', result.moved, false);
    equal('原处还是 64 个', inv.get(0)?.count, 64);
  }
}

// ---------------------------------------------------------------- 3. 盔甲

console.log('\n[盔甲：Shift+左键直接穿上]');
{
  const helmet = armorItemId('helmet', 'iron');
  const leatherHelmet = armorItemId('helmet', 'leather');

  // 空槽 → 直接穿
  {
    const inv = new Inventory();
    inv.set(9, { id: helmet, count: 1 });
    const result = quickMove(inv, null, 0, inv, 9);
    check('穿上了', result.moved);
    equal('落在**头盔槽**（36）', inv.get(ARMOR_SLOT_BASE)?.id, helmet);
    equal('原格空了', inv.get(9), null);
  }

  // 非空槽 → 换穿（旧的那件进背包）
  {
    const inv = new Inventory();
    inv.set(ARMOR_SLOT_BASE, { id: leatherHelmet, count: 1 });
    inv.set(9, { id: helmet, count: 1 });
    quickMove(inv, null, 0, inv, 9);
    equal('头槽换成了铁头盔', inv.get(ARMOR_SLOT_BASE)?.id, helmet);
    check(
      '换下来的皮革帽进了背包（不是凭空消失）',
      inv.serialize().some((stack) => stack?.id === leatherHelmet),
    );
    equal('原格空了', inv.get(9), null);
  }

  // 背包塞不下旧盔甲 → 不换（原版不会把旧盔甲扔在地上）
  {
    const inv = new Inventory();
    inv.set(ARMOR_SLOT_BASE, { id: leatherHelmet, count: 1 });
    // 把 36 个普通格全塞满（盔甲槽与副手不算）
    for (let i = 0; i < HOTBAR_SIZE + MAIN_SIZE; i++) inv.set(i, dirt(64));
    inv.set(20, { id: helmet, count: 1 });
    const result = quickMove(inv, null, 0, inv, 20);
    equal('塞不下就不换（头槽还是皮革帽）', inv.get(ARMOR_SLOT_BASE)?.id, leatherHelmet);
    equal('铁头盔还在原格', inv.get(20)?.id, helmet);
    equal('而且它确实是"没搬动"', result.moved, false);
  }

  // 盔甲槽里的东西 Shift 出来 → 进主背包那一侧（快捷栏 ↔ 主背包的规矩照旧）
  {
    const inv = new Inventory();
    inv.set(ARMOR_SLOT_BASE, { id: helmet, count: 1 });
    quickMove(inv, null, 0, inv, ARMOR_SLOT_BASE);
    equal('头槽空了', inv.get(ARMOR_SLOT_BASE), null);
    equal('头盔落在了**快捷栏第一格**（先快捷栏）', inv.get(0)?.id, helmet);
  }
}

// ---------------------------------------------------------------- 4. fitCount（只算账）

console.log('\n[`fitCount`：只算账、不改动]');
{
  const inv = new Inventory();
  inv.set(0, stone(60));
  const before = inv.serialize().map((stack) => stack?.count ?? 0).join(',');
  const room = fitCount(stone(64), inv, PLAYER_FILL_ORDER);
  const after = inv.serialize().map((stack) => stack?.count ?? 0).join(',');
  // ⚠️ 够放就**封顶在"这一叠有多少件"**（它是"装得下吗"用的，不是"能装多少"）——
  // 想数总容量的话得看下面那条不够放的用例
  equal('够放时返回"这一叠的件数"（64）', room, 64);
  equal('**算的过程中没有改动背包**', after, before);

  // 不够放时返回真实余量（并同类剩下的那点余地）
  const tight = new Inventory();
  tight.set(0, stone(63));
  for (let i = 1; i < HOTBAR_SIZE + MAIN_SIZE; i++) tight.set(i, dirt(64));
  equal('只剩 1 个余地时返回 1', fitCount(stone(64), tight, PLAYER_FILL_ORDER), 1);
}

// ---------------------------------------------------------------- 5. 界面上那几条"守门"规则

console.log('\n[界面调用时的几条守门规则]');
{
  // 空手 Shift 点空格 → 不动（界面据此不刷新、也不播声音）
  const inv = new Inventory();
  equal('空格 → moved=false', quickMove(inv, null, 0, inv, 5).moved, false);
  // 副手槽里的东西 Shift → 进主背包那一侧
  inv.set(OFFHAND_SLOT, dirt(1));
  quickMove(inv, null, 0, inv, OFFHAND_SLOT);
  equal('副手空了', inv.get(OFFHAND_SLOT), null);
  equal('东西进了快捷栏第一格', inv.get(0)?.id, Block.DIRT);
  // 玩家背包那一侧一共 36 格（快捷栏 9 + 主背包 27）
  equal('PLAYER_FILL_ORDER 是 36 格（先快捷栏 9 格，再主背包 27 格）', PLAYER_FILL_ORDER.length, HOTBAR_SIZE + MAIN_SIZE);
  equal('头 9 项就是快捷栏（0~8）', PLAYER_FILL_ORDER.slice(0, 9).join(','), '0,1,2,3,4,5,6,7,8');
  equal('第 10 项起是主背包（9 起）', PLAYER_FILL_ORDER[9], MAIN_START);
}

console.log(`\n快速移动测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
