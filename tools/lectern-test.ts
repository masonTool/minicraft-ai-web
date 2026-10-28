/**
 * 讲台离线测试（J25，批次 191）
 *
 * 讲台是"**一格容器 + 一个页码**"，所以断言分四块：
 *
 *  1. **放 / 拿**：只收书（书与笔 / 成书），台面上有书时不再替换，拿走时页码清零；
 *  2. **翻页**：页码夹在 `0 ~ 页数-1`，换书 / 读档之后都不会出现"第 37 / 2 页"；
 *  3. **存档**：书与页码一起往返，空讲台不写存档；
 *  4. **与搬运方的关系**：漏斗塞不进去（`acceptingSlots` 为空），但倒空/槽位计数认得它。
 *
 * 运行：npm run test:lectern
 */

import { Item } from '../web/src/core/registry/items.ts';
import { Block } from '../web/src/core/registry/blocks.ts';
import { itemLabel, itemDescription, hasDescription } from '../web/src/core/registry/itemNames.ts';
import { LECTERN_SLOT, LECTERN_SIZE, Lectern } from '../web/src/core/container/Lectern.ts';
import type { ItemStack } from '../web/src/core/container/Inventory.ts';
import { acceptingSlots, containerSlotCount } from '../web/src/core/container/Transfer.ts';
import { CONTAINER_BLOCKS, BlockEntityStore } from '../web/src/core/world/BlockEntityStore.ts';
import { SLOT_COUNTS, kindOf, restoreContainers, serializeContainers } from '../web/src/core/save/ContainerSave.ts';
import { Dimension } from '../web/src/core/gen/Dimension.ts';

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

function writtenBook(pages: string[], title = '旅途'): ItemStack {
  return { id: Item.WRITTEN_BOOK, count: 1, pages, title };
}

function quillBook(pages: string[] = ['草稿']): ItemStack {
  return { id: Item.BOOK_AND_QUILL, count: 1, pages };
}

console.log('\n[讲台方块]');
{
  check('讲台登记进了"带方块实体的方块"（活塞推不动）', CONTAINER_BLOCKS.has(Block.LECTERN));
  check('有说明', hasDescription(Block.LECTERN));
  check(
    '说明写了"放书 / 翻页 / 潜行收回"',
    ['书', '翻页', '潜行'].every((word) => itemDescription(Block.LECTERN).includes(word)),
    itemDescription(Block.LECTERN),
  );
  equal('名称', itemLabel(Block.LECTERN), '讲台');
}

console.log('\n[放书 / 拿书]');
{
  equal('只有一格', LECTERN_SIZE, 1);
  equal('那一格的下标是 0', LECTERN_SLOT, 0);
  const lectern = new Lectern();
  equal('空讲台没有书', lectern.book, null);
  equal('空讲台的页数是 1（界面不显示 0 / 0）', lectern.pageCount, 1);

  check('收书与笔', lectern.accepts(quillBook()));
  check('收成书', lectern.accepts(writtenBook(['一页'])));
  check('不收普通书', !lectern.accepts({ id: Item.BOOK, count: 1 }));
  check('不收石头', !lectern.accepts({ id: Block.STONE, count: 1 }));

  const book = writtenBook(['第一页', '第二页', '第三页'], '我的书');
  equal('放上去之后手里剩 0 本', lectern.place(book), 0);
  equal('台面上就是那本书', lectern.book?.title, '我的书');
  equal('页码从第一页开始（0）', lectern.page, 0);
  check('放上去的是拷贝（改台面不会改手里那本）', lectern.book !== book);

  equal('台面上已经有书 → 不再替换（返回 -1）', lectern.place(writtenBook(['别的'])), -1);
  equal('原来那本还在', lectern.book?.title, '我的书');

  const taken = lectern.take();
  equal('拿下来的是那本书', taken?.title, '我的书');
  equal('页也跟着回来', taken?.pages?.join('|'), '第一页|第二页|第三页');
  equal('拿完台面就空了', lectern.book, null);
  equal('页码回到 0', lectern.page, 0);
  equal('空讲台拿不出东西', lectern.take(), null);
}

console.log('\n[翻页]');
{
  const lectern = new Lectern();
  lectern.place(writtenBook(['一', '二', '三']));
  equal('三页的书', lectern.pageCount, 3);

  equal('往后翻一页 → 1', lectern.turnPage(1), 1);
  equal('再往后 → 2（最后一页）', lectern.turnPage(1), 2);
  equal('翻过最后一页会停住', lectern.turnPage(1), 2);
  equal('往前翻一页 → 1', lectern.turnPage(-1), 1);
  equal('连续往前会停在 0', lectern.turnPage(-5), 0);

  lectern.setPage(2);
  equal('直接跳页', lectern.page, 2);
  lectern.setPage(99);
  equal('跳到越界位置会被夹住', lectern.page, 2);
  lectern.setPage(-3);
  equal('负数也夹到 0', lectern.page, 0);
  lectern.setPage(1.7);
  equal('小数被抹平', lectern.page, 1);

  // 换一本书（页数变少）：页码要跟着收，不然就是"第 3 / 1 页"
  lectern.setPage(2);
  lectern.set(LECTERN_SLOT, writtenBook(['只剩一页'], '新书'));
  equal('换书之后页码被夹回范围内', lectern.page, 0);
  equal('换书之后页数是新书的', lectern.pageCount, 1);

  // 不能往讲台上塞非书的东西
  lectern.set(LECTERN_SLOT, { id: Block.STONE, count: 5 });
  equal('塞石头进去等于没塞（槽位保持空）', lectern.get(LECTERN_SLOT), null);

  let notified = 0;
  const watched = new Lectern();
  watched.onChange = () => notified++;
  watched.set(LECTERN_SLOT, quillBook());
  check('set 会通知界面', notified > 0);
}

console.log('\n[存档]');
{
  equal('槽位数是 1', SLOT_COUNTS.lectern, 1);
  equal('实例 → 种类', kindOf(new Lectern()), 'lectern');

  const store = new BlockEntityStore();
  const placed = store.getOrCreateLectern(Dimension.OVERWORLD, 3, 64, 7);
  placed.place(writtenBook(['甲', '乙', '丙'], '存档测试'));
  placed.setPage(2);
  equal('同一坐标取回同一个实例', store.getOrCreateLectern(Dimension.OVERWORLD, 3, 64, 7), placed);
  equal('按坐标能查到', store.getLectern(Dimension.OVERWORLD, 3, 64, 7), placed);
  equal('别的维度查不到', store.getLectern(Dimension.NETHER, 3, 64, 7), undefined);

  const data = serializeContainers(store);
  equal('有书的讲台写进存档', data.length, 1);
  equal('写下来的种类是 lectern', data[0]!.kind, 'lectern');
  equal('页码一起写下来', data[0]!.lectern?.page, 2);

  const restored = new BlockEntityStore();
  equal('还原 1 个容器', restoreContainers(restored, JSON.parse(JSON.stringify(data))), 1);
  const back = restored.getLectern(Dimension.OVERWORLD, 3, 64, 7);
  equal('书回来了', back?.book?.title, '存档测试');
  equal('页回来了', back?.book?.pages?.join('|'), '甲|乙|丙');
  equal('页码也回来了', back?.page, 2);

  // 脏数据：页码超出页数 → 夹住
  const dirty = new BlockEntityStore();
  const restoredDirty = restoreContainers(dirty, [
    {
      kind: 'lectern',
      dimension: Dimension.OVERWORLD,
      x: 1,
      y: 70,
      z: 1,
      stacks: [writtenBook(['只有一页'])],
      lectern: { page: 40 },
    },
  ] as never);
  equal('脏页码也会被还原（条目本身有效）', restoredDirty, 1);
  equal('而且被夹到页数范围内', dirty.getLectern(Dimension.OVERWORLD, 1, 70, 1)?.page, 0);

  const empty = new BlockEntityStore();
  empty.getOrCreateLectern(Dimension.OVERWORLD, 0, 64, 0);
  equal('空讲台不写存档（与其它容器同一条规矩）', serializeContainers(empty).length, 0);
}

console.log('\n[与漏斗的关系]');
{
  const lectern = new Lectern();
  equal('槽位计数认得出讲台（拆掉时才会把书掉出来）', containerSlotCount(lectern), 1);
  equal('漏斗塞不进去（讲台没有物品栏界面）', acceptingSlots(lectern).length, 0);
}

console.log(`\n讲台测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
