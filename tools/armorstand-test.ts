/**
 * 盔甲架（批次 492，B51）
 *
 * 四块：
 *  ① 槽位判定（`armorSlotForItem` 与 `armor.ts` 同源，不会两处走偏）；
 *  ② 数据层（空架子不进表、深拷、坏数据规整）；
 *  ③ 存读档（往返一致、坏条目逐条跳过）；
 *  ④ 方块与配方（几何 5 个盒子、能站立、6 木棍）。
 *
 * 这一批**不含渲染装备**：架子的几何（底座/立柱/横杆/头）在方块形状里，
 * 穿上去的装备目前只有数据、画不出来（差异记在 TASKS B51）。
 */

import {
  ARMOR_STAND_SLOTS,
  ARMOR_STAND_SLOT_LABELS,
  ArmorStandStore,
  armorSlotForItem,
  armorStandKey,
  filledSlotCount,
  normalizeStandSlots,
  restoreArmorStands,
  serializeArmorStands,
  standSlotsEmpty,
} from '../src/core/world/ArmorStands.ts';
import { ARMOR_SPECS } from '../src/core/registry/armor.ts';
import { Block, ARMOR_STAND_ID, blockDef } from '../src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';
import { Item } from '../src/core/registry/items.ts';

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

/** 从注册表里各取一件头盔/胸甲/护腿/靴（不手抄 id） */
const sample = [0, 1, 2, 3].map((slot) => ARMOR_SPECS.find((spec) => spec.armor.slot === slot)!);
const helmet = sample[0]!.id;
const chest = sample[1]!.id;
const legs = sample[2]!.id;
const boots = sample[3]!.id;

console.log('\n[槽位判定：与 armor.ts 同源]');
{
  equal('槽位一共 4 个', ARMOR_STAND_SLOTS, 4);
  equal('四个槽都有自己的名字', ARMOR_STAND_SLOT_LABELS.length, 4);
  equal('头盔进 0 号槽', armorSlotForItem(helmet), 0);
  equal('胸甲进 1 号槽', armorSlotForItem(chest), 1);
  equal('护腿进 2 号槽', armorSlotForItem(legs), 2);
  equal('靴子进 3 号槽', armorSlotForItem(boots), 3);
  equal('石头不是装备', armorSlotForItem(Block.STONE), null);
  equal('木棍不是装备', armorSlotForItem(Item.STICK), null);

  // 六档材质全部都能上架（不是只认铁/钻石）
  let accepted = 0;
  for (const spec of ARMOR_SPECS) {
    if (armorSlotForItem(spec.id) === spec.armor.slot) accepted++;
  }
  equal('每一件已注册的盔甲都能上架', accepted, ARMOR_SPECS.length);
}

console.log('\n[数据层]');
{
  const empty = normalizeStandSlots(null);
  equal('空数组补成 4 个 null', empty.length, 4);
  equal('全是 null', filledSlotCount(empty), 0);
  check('空架子判定', standSlotsEmpty(empty));

  const partial = normalizeStandSlots([null, { id: chest, count: 7 }, 'oops', undefined]);
  equal('长度恒为 4', partial.length, 4);
  equal('胸甲在第 1 槽', partial[1]?.id, chest);
  equal('数量被夹到 1（架子上不能叠）', partial[1]?.count, 1);
  equal('坏项变成 null', partial[2], null);
  equal('装了两件', filledSlotCount(normalizeStandSlots([{ id: helmet, count: 1 }, { id: boots, count: 1 }])), 2);

  const store = new ArmorStandStore();
  equal('新建时是空的', store.size, 0);
  equal('放一件：返回还剩几件', store.setSlot('overworld', 1, 64, 2, 0, { id: helmet, count: 1 }), 1);
  equal('表里有一条', store.size, 1);
  equal('读得回来', store.get('overworld', 1, 64, 2)?.slots[0]?.id, helmet);
  equal('带维度的键（三个维度坐标会重叠）', armorStandKey('overworld', 1, 64, 2) !== armorStandKey('nether', 1, 64, 2), true);

  // 读出来的是副本：改它不影响表
  const copy = store.get('overworld', 1, 64, 2)!;
  (copy.slots[0] as { count: number }).count = 64;
  equal('读到的是深拷（改副本不动表）', store.get('overworld', 1, 64, 2)?.slots[0]?.count, 1);

  equal('把唯一的装备取走 → 整条删掉（空架子不进表）', store.setSlot('overworld', 1, 64, 2, 0, null), 0);
  equal('表空了', store.size, 0);

  // 四个槽互不干扰
  const full = new ArmorStandStore();
  for (const [slot, id] of [helmet, chest, legs, boots].entries()) {
    full.setSlot('overworld', 5, 70, 5, slot, { id, count: 1 });
  }
  equal('穿满四件', filledSlotCount(full.get('overworld', 5, 70, 5)!.slots), 4);
  equal('替换 0 号槽不会影响别的槽', full.setSlot('overworld', 5, 70, 5, 0, { id: boots, count: 1 }), 4);
  equal('0 号槽换了', full.get('overworld', 5, 70, 5)?.slots[0]?.id, boots);
  equal('1 号槽还在', full.get('overworld', 5, 70, 5)?.slots[1]?.id, chest);
}

console.log('\n[存读档]');
{
  const store = new ArmorStandStore();
  store.setSlot('overworld', 10, 64, 10, 0, { id: helmet, count: 1 });
  store.setSlot('overworld', 10, 64, 10, 3, { id: boots, count: 1 });
  // 维度名与 `Dimension.NETHER` 一致是 `nether`（不是原版的 `the_nether`）
  store.setSlot('nether', 3, 40, 3, 1, { id: chest, count: 1 });

  const saved = serializeArmorStands(store);
  equal('序列化出两条', saved.length, 2);

  const restored = new ArmorStandStore();
  equal('读回两条', restoreArmorStands(restored, JSON.parse(JSON.stringify(saved))), 2);
  equal('头盔读回来', restored.get('overworld', 10, 64, 10)?.slots[0]?.id, helmet);
  equal('靴子读回来', restored.get('overworld', 10, 64, 10)?.slots[3]?.id, boots);
  equal('下界的那条也在', restored.get('nether', 3, 40, 3)?.slots[1]?.id, chest);
  equal('两次序列化完全一致', JSON.stringify(serializeArmorStands(restored)), JSON.stringify(saved));

  // 坏数据逐条跳过
  const broken = [
    { dimension: 'overworld', x: 0, y: 64, z: 0, slots: [{ id: helmet, count: 1 }, null, null, null] },
    { dimension: 'moon', x: 0, y: 64, z: 0, slots: [{ id: helmet, count: 1 }] },
    { dimension: 'overworld', x: 'x', y: 64, z: 0, slots: [{ id: helmet, count: 1 }] },
    { dimension: 'overworld', x: 1, y: 64, z: 1, slots: [null, null, null, null] },
    'nope',
  ];
  const salvage = new ArmorStandStore();
  equal('只有第一条活下来', restoreArmorStands(salvage, broken), 1);
  equal('表里也只有一条', salvage.size, 1);
  equal('不认识格式的输入不算坏条目', restoreArmorStands(salvage, 'oops'), 0);
  equal('null 也不崩', restoreArmorStands(salvage, null), 0);
}

console.log('\n[方块、几何与配方]');
{
  equal('盔甲架 id 是 718', ARMOR_STAND_ID, 718);
  equal('注册名', blockDef(Block.ARMOR_STAND).name, 'minecraft:armor_stand');
  equal('形状是 armor_stand', blockDef(Block.ARMOR_STAND).shape, 'armor_stand');
  equal('中文名', itemLabel(Block.ARMOR_STAND), '盔甲架');
  equal('没有碰撞盒（走得过去）', collisionBoxes('armor_stand', 0).length, 0);

  const boxes = meshBoxes('armor_stand', 0);
  equal('五个盒子（底座/立柱/两根横杆/头）', boxes.length, 5);
  const bottom = Math.min(...boxes.map((box) => box[1]));
  const top = Math.max(...boxes.map((box) => box[4]));
  equal('从地面起', bottom, 0);
  check('高过一格的一半（看得出是个人形）', top > 0.8, `${top}`);
  // 头是最高那个盒子，且比立柱宽
  const head = boxes.reduce((best, box) => (box[4] > best[4] ? box : best), boxes[0]!);
  check('头在最上面', head[4] === top, `${head[4]}`);
  check('头比立柱宽（不然看着是一根柱子）', head[3] - head[0] > 2 / 16, `${head[3] - head[0]}`);

  const recipe = RECIPES.find((entry) => entry.result.id === Block.ARMOR_STAND);
  check('有一条产出盔甲架的配方', recipe !== undefined);
  if (recipe && recipe.kind === 'shaped') {
    equal('形状：6 根木棍', recipe.pattern.join('/'), 'SSS/ S /S S');
    equal('材料是木棍', recipe.key.S, Item.STICK);
  } else {
    check('应该是定形配方', false, recipe?.kind);
  }
}

console.log(`\n盔甲架测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
