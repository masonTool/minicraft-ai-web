/**
 * 砂轮离线测试（H15 / J25，批次 188）
 *
 * 覆盖五块：
 *  1. **洗附魔**：单件带附魔 → 洗完没有附魔、名字保留、累积惩罚归零、按附魔折算经验
 *  2. **拼耐久**：两件同种装备 → 剩余耐久相加 + 5%、附魔一起洗掉、不超过上限
 *  3. **该拒绝的**：单件没附魔 / 两件不同的东西 / 空着 —— 都不能出产物
 *  4. **附魔书**：洗完变普通书
 *  5. **容器与存档**：产物由两格算出来、取产物才扣输入、经验数字报出去、
 *     容器按坐标存且随存档往返、空容器不写存档
 *
 * 运行：npm run test:grindstone
 */

import { Block } from '../web/src/core/registry/blocks.ts';
import { Item } from '../web/src/core/registry/items.ts';
import { toolItemId } from '../web/src/core/registry/tools.ts';
import { maxDurabilityOf } from '../web/src/core/crafting/Anvil.ts';
import {
  GRINDSTONE_DURABILITY_BONUS,
  grindExperience,
  grindOnGrindstone,
  grindstoneHint,
} from '../web/src/core/crafting/Grindstone.ts';
import {
  GRINDSTONE_LEFT,
  GRINDSTONE_RESULT,
  GRINDSTONE_RIGHT,
  GRINDSTONE_SIZE,
  Grindstone,
} from '../web/src/core/container/Grindstone.ts';
import type { ItemStack } from '../web/src/core/container/Inventory.ts';
import { Anvil } from '../web/src/core/container/Anvil.ts';
import { Chest } from '../web/src/core/container/Chest.ts';
import { SmithingTable } from '../web/src/core/container/SmithingTable.ts';
import {
  acceptingSlots,
  containerSlotCount,
  isComputedResultSlot,
} from '../web/src/core/container/Transfer.ts';
import { BlockEntityStore } from '../web/src/core/world/BlockEntityStore.ts';
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

function stack(id: number, extra: Partial<ItemStack> = {}): ItemStack {
  return { id, count: 1, ...extra };
}

const PICK = toolItemId('pickaxe', 'diamond');
const PICK_MAX = maxDurabilityOf(PICK);
const SWORD = toolItemId('sword', 'iron');

// ---------------------------------------------------------------- 1. 洗附魔

console.log('\n[洗掉附魔]');
{
  // 效率 III（权重 10 → 每级 1）= 3，耐久 II（权重 5 → 每级 2）= 4，一共 7
  const enchanted = stack(PICK, { enchants: { efficiency: 3, unbreaking: 2 }, name: '老伙计', repairCost: 7 });
  equal('经验按权重 × 等级折算', grindExperience(enchanted), 7);

  const outcome = grindOnGrindstone(enchanted, null);
  check('带附魔的单件能洗', outcome !== null);
  equal('产物还是那把镐', outcome?.output.id, PICK);
  equal('附魔被洗掉了', outcome?.output.enchants, undefined);
  equal('名字保留（原版砂轮也只洗附魔）', outcome?.output.name, '老伙计');
  equal('累积惩罚归零（下次上铁砧不再按老价钱）', outcome?.output.repairCost, undefined);
  equal('返还经验 = 7', outcome?.xp, 7);
  equal('产物数量是 1', outcome?.output.count, 1);

  // 单件**没有附魔**：砂轮修不了（原版也一样，修耐久要两件）
  equal('干干净净的单件 → 没有结果', grindOnGrindstone(stack(PICK, { damage: 200 }), null), null);
  equal('空着 → 没有结果', grindOnGrindstone(null, null), null);
  // 空栈（count 0）视同空
  equal('数量为 0 的栈视同空', grindOnGrindstone(stack(PICK, { count: 0, enchants: { efficiency: 1 } }), null), null);

  // 诅咒也是附魔：一起洗掉
  const cursed = grindOnGrindstone(stack(PICK, { enchants: { vanishing_curse: 1 } }), null);
  equal('诅咒附魔也会被洗掉', cursed?.output.enchants, undefined);
  equal('诅咒附魔按权重折算（权重 1 → 每级 8）', cursed?.xp, 8);
}

// ---------------------------------------------------------------- 2. 拼耐久

console.log('\n[两件同种装备拼耐久]');
{
  const a = stack(PICK, { damage: PICK_MAX - 500, enchants: { efficiency: 2 } });
  const b = stack(PICK, { damage: PICK_MAX, enchants: { fortune: 1, efficiency: 1 } });
  const outcome = grindOnGrindstone(a, b);
  check('两件一样的镐能拼', outcome !== null);

  const bonus = Math.floor(PICK_MAX * GRINDSTONE_DURABILITY_BONUS);
  const total = 500 + 0 + bonus;
  equal('剩余耐久相加 + 5%', PICK_MAX - (outcome?.output.damage ?? 0), total);
  check('5% 比铁砧的 12% 少（原版数值）', GRINDSTONE_DURABILITY_BONUS < 0.12);
  equal('两件的附魔都洗掉（砂轮不是铁砧，不合并附魔）', outcome?.output.enchants, undefined);
  equal('经验是两件之和：效率 II = 2，时运 I = 4，效率 I = 1', outcome?.xp, 2 + 4 + 1);

  const full = grindOnGrindstone(stack(PICK, { damage: 5 }), stack(PICK, { damage: 5 }));
  equal('加起来超过上限时封顶（damage 清空）', full?.output.damage, undefined);

  const different = grindOnGrindstone(stack(PICK), stack(SWORD, { enchants: { sharpness: 2 } }));
  equal('两格不是同一种东西 → 没有结果', different, null);
  equal(
    '提示语说清"两格必须是同一种物品"',
    grindstoneHint(stack(PICK), stack(SWORD)),
    '两格必须是同一种物品',
  );

  // 原版也允许"两件完好的一起放"——产物仍是一件满耐久的，纯属浪费，所以界面只提示不拦
  const undamaged = grindOnGrindstone(stack(PICK), stack(PICK));
  check('两件完好无损的同种装备也能出产物（原版如此）', undamaged !== null);
  equal('产物是满耐久的', undamaged?.output.damage, undefined);
  equal('没有耐久的东西拼不起来（两块石头）', grindOnGrindstone(stack(Block.STONE), stack(Block.STONE)), null);
}

// ---------------------------------------------------------------- 3. 附魔书

console.log('\n[附魔书]');
{
  const book = stack(Item.BOOK, { enchants: { sharpness: 5 } });
  const outcome = grindOnGrindstone(book, null);
  check('带附魔的书能洗', outcome !== null);
  equal('洗完是一本普通书', outcome?.output.id, Item.BOOK);
  equal('书上的附魔没了', outcome?.output.enchants, undefined);
  equal('锋利 V（权重 10 → 每级 1）= 5 点经验', outcome?.xp, 5);

  equal('普通书放进去没有结果', grindOnGrindstone(stack(Item.BOOK), null), null);
}

// ---------------------------------------------------------------- 4. 容器

console.log('\n[砂轮容器]');
{
  equal('三格（左 / 右 / 产物）', GRINDSTONE_SIZE, 3);
  const stone = new Grindstone();
  equal('初始没有产物', stone.get(GRINDSTONE_RESULT), null);
  equal('初始提示语是"放东西进来"', grindstoneHint(stone.left, stone.right).startsWith('放入'), true);

  stone.set(GRINDSTONE_LEFT, stack(PICK, { enchants: { efficiency: 3 } }));
  equal('放进左格就有产物了', stone.get(GRINDSTONE_RESULT)?.id, PICK);
  equal('产物与输入是两份对象（改产物不会改输入）', stone.get(GRINDSTONE_RESULT) === stone.get(GRINDSTONE_LEFT), false);

  stone.set(GRINDSTONE_RIGHT, stack(PICK, { damage: PICK_MAX - 100 }));
  check('右格放了同种装备 → 提示里出现耐久', grindstoneHint(stone.left, stone.right).includes('耐久'));

  const result = stone.take();
  check('取产物成功', result.ok);
  equal('扣掉了两格各 1 件', [stone.get(GRINDSTONE_LEFT), stone.get(GRINDSTONE_RIGHT)].filter(Boolean).length, 0);
  equal('取完之后产物槽也空了', stone.get(GRINDSTONE_RESULT), null);
  equal('经验数字报出来了（效率 III = 3 + 100 耐久那件没附魔）', result.ok ? result.xp : -1, 3);

  const empty = new Grindstone();
  const failedTake = empty.take();
  check('空砂轮取不出东西', !failedTake.ok);

  // 失败时一点都不改：左格里放一件没附魔的东西
  const useless = new Grindstone();
  useless.set(GRINDSTONE_LEFT, stack(PICK, { damage: 100 }));
  const rejected = useless.take();
  check('没附魔的单件取不出产物', !rejected.ok);
  equal('取不到时左格的东西还在', useless.get(GRINDSTONE_LEFT)?.damage, 100);

  let notified = 0;
  const watched = new Grindstone();
  watched.onChange = () => notified++;
  watched.set(GRINDSTONE_LEFT, null);
  check('set 会通知界面', notified > 0);
}

// ---------------------------------------------------------------- 5. 存档

console.log('\n[砂轮的存档]');
{
  equal('容器种类的槽位数是 3', SLOT_COUNTS.grindstone, 3);
  equal('实例 → 种类', kindOf(new Grindstone()), 'grindstone');

  const store = new BlockEntityStore();
  const placed = store.getOrCreateGrindstone(Dimension.OVERWORLD, 8, 70, 3);
  placed.set(GRINDSTONE_LEFT, stack(PICK, { enchants: { efficiency: 3, unbreaking: 1 } }));
  placed.set(GRINDSTONE_RIGHT, stack(PICK, { damage: 50 }));
  equal('同一个坐标取回的是同一个实例', store.getOrCreateGrindstone(Dimension.OVERWORLD, 8, 70, 3), placed);
  equal('按坐标能查到', store.getGrindstone(Dimension.OVERWORLD, 8, 70, 3), placed);
  equal('别的维度查不到（键带维度）', store.getGrindstone(Dimension.NETHER, 8, 70, 3), undefined);

  const data = serializeContainers(store);
  equal('有东西的砂轮写进存档', data.length, 1);
  equal('写下来的种类是 grindstone', data[0]!.kind, 'grindstone');
  equal('写下来 3 格', data[0]!.stacks.length, 3);

  const restored = new BlockEntityStore();
  equal('还原 1 个容器', restoreContainers(restored, JSON.parse(JSON.stringify(data))), 1);
  const back = restored.getGrindstone(Dimension.OVERWORLD, 8, 70, 3);
  equal('左格的附魔原样回来', back?.left?.enchants?.efficiency, 3);
  equal('右格的耐久损耗原样回来', back?.right?.damage, 50);
  check('还原后产物也重算出来了', back?.get(GRINDSTONE_RESULT) !== null && back?.get(GRINDSTONE_RESULT) !== undefined);

  const emptyStore = new BlockEntityStore();
  emptyStore.getOrCreateGrindstone(Dimension.OVERWORLD, 0, 64, 0);
  equal('空着就不写存档（与其它容器同一条规矩）', serializeContainers(emptyStore).length, 0);
}

// ---------------------------------------------------------------- 6. 与搬运 / 倒空的关系

console.log('\n[漏斗与拆方块]');
{
  const stone = new Grindstone();
  equal('一共 3 格（含产物）', containerSlotCount(stone), 3);
  equal('漏斗只能塞两格输入', acceptingSlots(stone).join(','), `${GRINDSTONE_LEFT},${GRINDSTONE_RIGHT}`);
  equal('产物槽是"算出来的"', isComputedResultSlot(stone, GRINDSTONE_RESULT), true);
  equal('输入槽不是算出来的', isComputedResultSlot(stone, GRINDSTONE_LEFT), false);

  // 顺手钉住这一条修的是**旧口子**：铁砧与锻造台的产物槽一直会被"拆方块倒出来"白送
  equal('铁砧的产物槽同样不许倒', isComputedResultSlot(new Anvil(), 2), true);
  equal('锻造台的产物槽同样不许倒', isComputedResultSlot(new SmithingTable(), 2), true);
  equal('箱子没有"算出来的"产物槽', isComputedResultSlot(new Chest(), 0), false);
}

console.log(`\n砂轮测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
