/**
 * 背包点击语义离线测试（INVENTORY_SPEC Phase 2）
 *
 * 断言的每一条都对应 SPEC 里的一个编号（CLICK-00x / TOUCH-00x / CLOSE-00x），
 * 这样改动界面时只要这套还是绿的，规则就没被改坏。
 *
 * 运行：`npm run test:v2-inventory`
 */

import { Block } from '../src/core/registry/blocks.ts';
import { armorItemId } from '../src/core/registry/armor.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { Inventory, ARMOR_START, OFFHAND_SLOT, type ItemStack, type SlotSource } from '../src/core/container/Inventory.ts';
import {
  EMPTY_CURSOR,
  applyClick,
  canPlaceItem,
  reclaimHeld,
  slotResolver,
  type CursorState,
  type SlotBinding,
} from '../src/minigame-v2/inventory-click.ts';
import { InventoryCursor } from '../src/minigame-v2/inventory-state.ts';
import { LONG_PRESS_MS, LONG_PRESS_REPEAT_MS } from '../src/minigame-v2/ui-kit/index.ts';
import { distributeEvenly, gatherSameItems, placeOneEach } from '../src/core/container/CursorActions.ts';
import { canSplitStack, initialSplitCount, splitCountForDrag, splitStack } from '../src/core/container/TouchSplit.ts';
import { quickMove } from '../src/core/container/QuickMove.ts';

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

/** 一个绑在背包某格上的 SlotBinding */
function bag(inventory: Inventory, index: number, extra: Partial<SlotBinding> = {}): SlotBinding {
  return {
    kind: 'inventory',
    index,
    source: inventory,
    singleItem: index >= ARMOR_START,
    ...extra,
  };
}

/** 数组背书的假容器（`gatherSameItems` 要一个 SlotSource） */
function makeContainer(
  size: number,
  fill: (i: number) => ItemStack | null = () => null,
): SlotSource & { set(i: number, s: ItemStack | null): void } {
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
const pick = (inventory: Inventory, index = 0): ItemStack | null => inventory.get(index);

console.log('\n[CLICK-001~004 空手点有物品格]');
{
  const inventory = new Inventory();
  inventory.set(9, stone(30));
  const result = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'left');
  equal('左键拿起整叠', result.state.held?.count, 30);
  equal('来源格变空', pick(inventory, 9), null);
  equal('记录了来源（取消时能回位）', result.state.origin?.index, 9);
  check('标记为"改动过"', result.changed);
}
{
  const inventory = new Inventory();
  inventory.set(9, stone(30));
  const result = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'right');
  equal('右键拿一半（向上取整）', result.state.held?.count, 15);
  equal('原格留下另一半', pick(inventory, 9)?.count, 15);
}
{
  const inventory = new Inventory();
  inventory.set(9, stone(5));
  const result = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'right');
  equal('奇数 5 个：拿 ceil(5/2)=3', result.state.held?.count, 3);
  equal('原格留 2', pick(inventory, 9)?.count, 2);
}
{
  const inventory = new Inventory();
  inventory.set(9, stone(1));
  const result = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'right');
  equal('只有 1 个时右键就是拿走那 1 个', result.state.held?.count, 1);
  equal('原格空了', pick(inventory, 9), null);
}
{
  const inventory = new Inventory();
  const result = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'left');
  check('点空格不改动、也不给光标', !result.changed && result.state.held === null);
}

console.log('\n[CLICK-006/007 手上有物品点空格]');
{
  const inventory = new Inventory();
  const state: CursorState = { held: stone(20), fromCreative: false, origin: { kind: 'inventory', index: 9 } };
  const result = applyClick(state, bag(inventory, 10), 'left');
  equal('左键放下整叠', pick(inventory, 10)?.count, 20);
  equal('光标清空', result.state.held, null);
}
{
  const inventory = new Inventory();
  const state: CursorState = { held: stone(20), fromCreative: false, origin: null };
  const result = applyClick(state, bag(inventory, 10), 'right');
  equal('右键只放 1 个', pick(inventory, 10)?.count, 1);
  equal('剩余 19 仍在手上', result.state.held?.count, 19);
}
{
  const inventory = new Inventory();
  // 单件槽（副手 40）：整叠左键只吃 1 个，剩下的留在手上
  const state: CursorState = { held: stone(20), fromCreative: false, origin: null };
  applyClick(state, bag(inventory, OFFHAND_SLOT), 'left');
  equal('副手槽只吃 1 个（INV-003）', pick(inventory, OFFHAND_SLOT)?.count, 1);
}

console.log('\n[CLICK-009~011 手上有物品点同类格]');
{
  const inventory = new Inventory();
  inventory.set(9, stone(60));
  const state: CursorState = { held: stone(20), fromCreative: false, origin: null };
  const result = applyClick(state, bag(inventory, 9), 'left');
  equal('补满到上限 64', pick(inventory, 9)?.count, 64);
  equal('剩余 16 留在手上', result.state.held?.count, 16);
}
{
  const inventory = new Inventory();
  inventory.set(9, stone(64));
  const state: CursorState = { held: stone(5), fromCreative: false, origin: null };
  const result = applyClick(state, bag(inventory, 9), 'left');
  check('目标已满：不改动', !result.changed);
  equal('手上不动', result.state.held?.count, 5);
}
{
  const inventory = new Inventory();
  inventory.set(9, stone(64));
  const state: CursorState = { held: stone(5), fromCreative: false, origin: null };
  const result = applyClick(state, bag(inventory, 9), 'right');
  check('同类格已满时右键不产生变化（CLICK-011）', !result.changed);
}

console.log('\n[CLICK-012/013 手上有物品点异类格]');
{
  const inventory = new Inventory();
  inventory.set(9, dirt(7));
  const state: CursorState = { held: stone(20), fromCreative: false, origin: { kind: 'inventory', index: 10 } };
  const result = applyClick(state, bag(inventory, 9), 'left');
  equal('目标格换成手上的石头', pick(inventory, 9)?.id, Block.STONE);
  equal('手上的变成原来的泥土', result.state.held?.id, Block.DIRT);
  equal('手上的泥土是原来那 7 个', result.state.held?.count, 7);
  equal('来源改成这一格（取消时放回这里）', result.state.origin?.index, 9);
}
{
  const inventory = new Inventory();
  inventory.set(9, dirt(7));
  const state: CursorState = { held: stone(20), fromCreative: false, origin: null };
  const result = applyClick(state, bag(inventory, 9), 'right');
  check('右键点异类格不交换（原版如此）', !result.changed);
  equal('目标格没变', pick(inventory, 9)?.id, Block.DIRT);
}

console.log('\n[INV-002 / CLICK-008 槽位约束]');
{
  const inventory = new Inventory();
  const helmet = armorItemId('helmet', 'iron');
  const boots = armorItemId('boots', 'iron');
  check('头盔能进 36（头盔槽）', canPlaceItem(bag(inventory, 36), helmet));
  check('靴子不能进 36', !canPlaceItem(bag(inventory, 36), boots));
  check('石头不能进护甲槽', !canPlaceItem(bag(inventory, 37), Block.STONE));
  const state: CursorState = { held: { id: Block.STONE, count: 3 }, fromCreative: false, origin: null };
  const result = applyClick(state, bag(inventory, 37), 'left');
  check('往胸甲槽放石头被拒绝', !result.changed && result.hint.includes('不能'));
}
{
  // 单件槽不接受"一叠换一件"：手上 20 个石头换副手里那 1 个泥土，多的 19 个会没地方去。
  // 用副手槽（40）而不是护甲槽：护甲槽先会被"部位校验"拦掉，测不到这条规则本身
  const inventory = new Inventory();
  inventory.set(OFFHAND_SLOT, dirt(1));
  const state: CursorState = { held: stone(20), fromCreative: false, origin: null };
  const result = applyClick(state, bag(inventory, OFFHAND_SLOT), 'left');
  check('一叠不能换进单件槽（避免凭空销毁）', !result.changed && result.hint.includes('1 件'));
  equal('泥土还在原位', pick(inventory, OFFHAND_SLOT)?.id, Block.DIRT);
  equal('手上仍是 20 个', result.state.held?.count, 20);
}
{
  // 一对一换是可以的（原版：手上拿一件，点已装备的同部位异材质就能换）
  const inventory = new Inventory();
  const iron = armorItemId('helmet', 'iron');
  const diamond = armorItemId('helmet', 'diamond');
  inventory.set(36, { id: iron, count: 1 });
  const state: CursorState = { held: { id: diamond, count: 1 }, fromCreative: false, origin: null };
  const result = applyClick(state, bag(inventory, 36), 'left');
  equal('单件换单件：槽里换成钻石头盔', pick(inventory, 36)?.id, diamond);
  equal('铁头盔回到手上', result.state.held?.id, iron);
}
{
  const takeOnly: SlotBinding = { kind: 'crafting', index: 0, source: { get: () => null, set: () => {} }, takeOnly: true };
  const state: CursorState = { held: stone(3), fromCreative: false, origin: null };
  const result = applyClick(state, takeOnly, 'left');
  check('产物槽只取不放（INV-015 / CLICK-005）', !result.changed && result.hint.includes('产物'));
  const forge = new Inventory();
  forge.set(0, stone(1));
  const empty = applyClick(EMPTY_CURSOR, { kind: 'container', index: 0, source: forge, takeOnly: true }, 'left');
  equal('产物槽允许"拿"', empty.state.held?.count, 1);
}

console.log('\n[CLICK-014 创造复制品覆盖]');
{
  const inventory = new Inventory();
  inventory.set(9, dirt(30));
  const state: CursorState = { held: stone(64), fromCreative: true, origin: null };
  const result = applyClick(state, bag(inventory, 9), 'left');
  equal('创造品覆盖目标格', pick(inventory, 9)?.id, Block.STONE);
  equal('创造品放下后光标清空', result.state.held, null);
  check('清空后不再标记为创造品', !result.state.fromCreative);
}

console.log('\n[INV-005 附加数据跟着走]');
{
  const inventory = new Inventory();
  const sword: ItemStack = { id: toolItemId('sword', 'iron'), count: 1, damage: 12, name: '斩龙' };
  inventory.set(9, sword);
  const result = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'left');
  equal('拿起时保留耐久', result.state.held?.damage, 12);
  equal('拿起时保留改名', result.state.held?.name, '斩龙');
  // 再放回去，耐久与名字都不能丢
  applyClick(result.state, bag(inventory, 10), 'left');
  equal('放下后耐久还在', pick(inventory, 10)?.damage, 12);
  equal('放下后名字还在', pick(inventory, 10)?.name, '斩龙');
}

console.log('\n[TOUCH-002 长按选数量 = 右键]');
{
  const inventory = new Inventory();
  inventory.set(9, stone(64));
  // 长按（右键）拿一半 —— 触摸端唯一"能拿一半"的入口
  const result = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'right');
  equal('长按拿起 32', result.state.held?.count, 32);
  equal('原格留 32', pick(inventory, 9)?.count, 32);
}

console.log('\n[CLOSE-001~004 关闭回收]');
{
  const inventory = new Inventory();
  inventory.set(9, stone(10));
  const taken = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'left');
  const reclaimed = reclaimHeld(taken.state, inventory, slotResolver([bag(inventory, 9)]));
  equal('原位还空着 → 放回原位（CLOSE-002）', pick(inventory, 9)?.count, 10);
  equal('回收后光标清空', reclaimed.state.held, null);
}
{
  const inventory = new Inventory();
  inventory.set(9, stone(10));
  const taken = applyClick(EMPTY_CURSOR, bag(inventory, 9), 'left');
  inventory.set(9, dirt(1)); // 原位被别的操作占了
  const reclaimed = reclaimHeld(taken.state, inventory, slotResolver([bag(inventory, 9)]));
  equal('原位被占 → 塞回背包', inventory.countOf(Block.STONE), 10);
  equal('光标清空', reclaimed.state.held, null);
}
{
  const inventory = new Inventory();
  for (let i = 0; i < 36; i++) inventory.set(i, dirt(64));
  const state: CursorState = { held: stone(5), fromCreative: false, origin: null };
  const reclaimed = reclaimHeld(state, inventory, () => null);
  equal('背包满 → 东西不能凭空消失（CLOSE-004）', reclaimed.state.held?.count, 5);
  check('并且给出提示', reclaimed.hint.includes('背包已满'));
}
{
  const inventory = new Inventory();
  const state: CursorState = { held: stone(5), fromCreative: true, origin: null };
  const reclaimed = reclaimHeld(state, inventory, () => null);
  equal('创造复制品关闭时直接销毁（INV-011）', reclaimed.state.held, null);
  equal('没偷偷塞进背包', inventory.countOf(Block.STONE), 0);
}
{
  const inventory = new Inventory();
  inventory.set(9, stone(60));
  const state: CursorState = { held: stone(4), fromCreative: false, origin: { kind: 'inventory', index: 9 } };
  reclaimHeld(state, inventory, slotResolver([bag(inventory, 9)]));
  equal('原位还叠得下同类 → 并回原位', pick(inventory, 9)?.count, 64);
}

console.log('\n[INV-007 槽位身份不能只看下标]');
{
  const inventory = new Inventory();
  const container = new Inventory();
  inventory.set(9, stone(1));
  container.set(9, dirt(1));
  const resolver = slotResolver([
    bag(inventory, 9),
    { kind: 'container', index: 9, source: container },
  ]);
  equal('背包的 9 号解析到石头', resolver({ kind: 'inventory', index: 9 })?.source.get(9)?.id, Block.STONE);
  equal('容器的 9 号解析到泥土', resolver({ kind: 'container', index: 9 })?.source.get(9)?.id, Block.DIRT);
}

console.log('\n[InventoryCursor 外壳：状态保存与通知]');
{
  const inventory = new Inventory();
  inventory.set(9, stone(30));
  const cursor = new InventoryCursor();
  cursor.click(bag(inventory, 9), 'left');
  equal('外壳把状态存住了', cursor.heldId, Block.STONE);
  equal('数量也一致', cursor.held?.count, 30);
  cursor.clear();
  equal('清空后没有东西', cursor.held, null);
}
{
  const inventory = new Inventory();
  inventory.set(9, stone(30));
  const cursor = new InventoryCursor();
  cursor.click(bag(inventory, 9), 'left');
  cursor.setCount(10);
  equal('setCount 只改数量', cursor.held?.id, Block.STONE);
  equal('改到 10', cursor.held?.count, 10);
  cursor.setCount(0);
  equal('改到 0 等于清空', cursor.held, null);
}

console.log('\n[边界：越界格子一律安全返回]');
{
  const inventory = new Inventory();
  const cursor = new InventoryCursor();
  const before = cursor.snapshot();
  const result = cursor.click(bag(inventory, 999), 'left');
  check('越界下标不改动', !result.changed);
  equal('光标仍是空的', before.held, null);
}

// ===========================================================================
// 第三节：从 Web 版（外部端）抄过来的四条规则
//
// 1. 长按阈值 260ms（`TOUCH_LONG_PRESS_MS`）
// 2. 长按连发 170ms（`TOUCH_REPEAT_MS`）
// 3. 双击收集（`DOUBLE_CLICK_MS = 400`）
// 4. 双击满堆 → 退化成快速移动（`shouldQuickMoveOnDouble`）
// ===========================================================================

console.log('\n[常量：与 Web 版逐项对齐]');
{
  // ⚠️ 这几个数字必须与 `src/ui/InventoryScreen.ts` 一致。
  // v2 之前自己定的是 420ms（比 Web 慢 160ms），手感差别很明显。
  equal('长按阈值 = Web 的 260ms', LONG_PRESS_MS, 260);
  equal('长按连发 = Web 的 170ms', LONG_PRESS_REPEAT_MS, 170);
}

console.log('\n[双击收集：把同一类凑满一堆]');
{
  const chest = makeContainer(27, (i) => (i < 5 ? stone(20) : null));
  const held = gatherSameItems(chest, 27, Block.STONE, null);
  equal('凑满一整堆 64', held?.count, 64);
  equal('第 1 格被拿空', chest.get(0), null);
  equal('第 4 格拿走后留 16', chest.get(3)?.count, 16);
  equal('第 5 格没被碰', chest.get(4)?.count, 20);
}
{
  const chest = makeContainer(27, (i) => (i === 6 ? stone(30) : null));
  const held = gatherSameItems(chest, 27, Block.STONE, stone(10));
  equal('10 + 30 = 40（库里只有这些）', held?.count, 40);
}
{
  // 不同附加数据不能收集到一起（改了名的剑不该并进普通剑）
  const sword = toolItemId('sword', 'iron');
  const chest = makeContainer(27, (i) =>
    i === 0 ? { id: sword, count: 1, name: '斩龙' } : i === 1 ? { id: sword, count: 1 } : null,
  );
  const held = gatherSameItems(chest, 27, sword, null, { name: '斩龙' });
  equal('只收同名的那一把', held?.count, 1);
  check('普通那把还在原处', chest.get(1) !== null);
}

console.log('\n[快速移动：与 core 的 QuickMove 同源]');
{
  const inventory = new Inventory();
  inventory.set(0, stone(30));
  const result = quickMove(inventory, null, 0, inventory, 0);
  check('快捷栏那叠搬走了', result.moved);
  equal('搬了 30 件', result.count, 30);
  check('落到了主背包（9~35）', (result.target?.index ?? 0) >= 9, JSON.stringify(result.target));
  equal('原格空了', pick(inventory, 0), null);
}
{
  const inventory = new Inventory();
  const helmet = armorItemId('helmet', 'iron');
  inventory.set(9, { id: helmet, count: 1 });
  const result = quickMove(inventory, null, 0, inventory, 9);
  equal('穿到 36 号头盔槽', result.target?.index, 36);
  equal('槽里是铁头盔', pick(inventory, 36)?.id, helmet);
}
{
  const inventory = new Inventory();
  inventory.set(20, dirt(5));
  const result = quickMove(inventory, null, 0, inventory, 20);
  check('搬动了', result.moved);
  check('落到了快捷栏（0~8）', (result.target?.index ?? 99) < 9, JSON.stringify(result.target));
}


// ===========================================================================
// 第四节：选数量 / 拖拽分配（基岩版那两条，规则都在 core 的纯函数里）
// ===========================================================================

console.log('\n[选数量：初值取半、划线改数量]');
{
  equal('64 个 → 初值 32', initialSplitCount(64), 32);
  equal('5 个 → 初值 3（向上取整）', initialSplitCount(5), 3);
  equal('1 个 → 初值 1', initialSplitCount(1), 1);
  equal('0 个 → 0', initialSplitCount(0), 0);
  check('手上拿着东西时不能选数量', !canSplitStack(stone(30), true));
  check('空格子不能选数量', !canSplitStack(null, false));
  check('只有 1 个不能选数量', !canSplitStack(stone(1), false));
  check('30 个 + 空手 → 可以选数量', canSplitStack(stone(30), false));
}
{
  // 划动一格宽 = 到底（右划到全部、左划到 1）
  equal('右划一格宽 → 全部 30', splitCountForDrag(30, 15, 46, 46), 30);
  equal('左划一格宽 → 只剩 1', splitCountForDrag(30, 15, -46, 46), 1);
  equal('不划 → 保持初值', splitCountForDrag(30, 15, 0, 46), 15);
  equal('右划半格 → 15 + round(15*0.5) = 23', splitCountForDrag(30, 15, 23, 46), 23);
}
{
  const { taken, rest } = splitStack(stone(30), 12);
  equal('拆出 12 个', taken?.count, 12);
  equal('原处剩 18', rest?.count, 18);
}
{
  // 附加数据要跟着走、且两份不能共用一个对象
  const sword: ItemStack = { id: toolItemId('sword', 'iron'), count: 5, damage: 7, enchants: { sharpness: 2 } };
  const { taken, rest } = splitStack(sword, 2);
  equal('拆出的带耐久', taken?.damage, 7);
  equal('剩下的也带耐久', rest?.damage, 7);
  check('两份的 enchants 不是同一个对象', taken?.enchants !== rest?.enchants);
}

console.log('\n[拖拽分配：左拖平均、右拖每格一个]');
{
  // 10 个分给 3 格 → 3/3/3，余 1 留手上（地板份额，不是轮流发）
  const a = makeContainer(3);
  const b = makeContainer(3);
  const c = makeContainer(3);
  const left = distributeEvenly(stone(10), [
    { source: a, index: 0 },
    { source: b, index: 0 },
    { source: c, index: 0 },
  ]);
  equal('每格 3 个（a）', a.get(0)?.count, 3);
  equal('每格 3 个（b）', b.get(0)?.count, 3);
  equal('每格 3 个（c）', c.get(0)?.count, 3);
  equal('余 1 留在光标上', left?.count, 1);
}
{
  // 件数比槽位少 → 一个都不放（原版也不放）
  const a = makeContainer(3);
  const b = makeContainer(3);
  const held = distributeEvenly(stone(1), [
    { source: a, index: 0 },
    { source: b, index: 0 },
  ]);
  equal('1 个分给 2 格 → 不动', held?.count, 1);
  equal('第一格仍空', a.get(0), null);
}
{
  const a = makeContainer(3);
  const b = makeContainer(3);
  const c = makeContainer(3);
  const left = placeOneEach(stone(5), [
    { source: a, index: 0 },
    { source: b, index: 0 },
    { source: c, index: 0 },
  ]);
  equal('每格放 1 个（a）', a.get(0)?.count, 1);
  equal('每格放 1 个（c）', c.get(0)?.count, 1);
  equal('剩 2 留手上', left?.count, 2);
}

console.log(`\n${failed === 0 ? '✓' : '✗'} 通过 ${passed} / ${passed + failed} 条断言`);
if (failed > 0) process.exit(1);
