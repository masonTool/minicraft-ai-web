/**
 * 物品注册表与背包模型的离线测试
 *
 * 运行：npm run test:inventory
 * 这些模块都是纯逻辑、无 DOM 依赖，所以可以直接在 Node 里跑断言，
 * 比开浏览器验证快得多，也不必担心渲染干扰。
 */

import { Block, BLOCKS } from '../src/core/registry/blocks.ts';
import {
  ITEMS,
  Item,
  PLACEABLE_ITEMS,
  blockForItem,
  dropFor,
  itemName,
  maxStackOf,
} from '../src/core/registry/items.ts';
import { translateName } from '../src/core/registry/itemNames.ts';
import { HOTBAR_SIZE, Inventory, OFFHAND_SLOT, TOTAL_SLOTS } from '../src/core/container/Inventory.ts';

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

console.log('\n[物品注册表]');

// 动态比对：每种"非空气、非流体"的方块都应该有对应的方块物品，
// 这样后续往方块表里加方块时不会再让这条断言过期。
// 不写成"PLACEABLE_ITEMS.length === 方块数"：`PLACEABLE_ITEMS` 按 `ItemDef.block` 筛，
// 而**小麦种子**（H13）不是方块却也能放置（种到耕地上），所以两者本就不该相等。
// 真正要守的是"每种实心/可放置方块都有对应物品"这条不变量。
const missingBlockItem = BLOCKS.filter(
  (def) => def.id !== Block.AIR && !def.liquid && blockForItem(def.id) === undefined,
);
equal(
  `每种非空气非流体方块都有可放置物品（共 ${BLOCKS.length} 种方块）`,
  missingBlockItem.length,
  0,
);
check('小麦种子这类"可放置的非方块物品"也在 PLACEABLE_ITEMS 里', PLACEABLE_ITEMS.includes(Item.WHEAT_SEEDS));
equal('石头是可放置物品', blockForItem(Block.STONE), Block.STONE);
equal('煤炭不可放置', blockForItem(Item.COAL), undefined);
equal('煤炭名称去掉命名空间', itemName(Item.COAL), 'coal');
equal('石头最大堆叠 64', maxStackOf(Block.STONE), 64);

console.log('\n[物品 id 卫生]');
{
  const definitions = ITEMS.filter((def) => def !== undefined);
  check(
    '每个槽位的 id 与下标一致（没有错位注册）',
    definitions.every((def) => ITEMS[def.id] === def),
  );
  equal(
    '物品 id 无重复（`register` 会在启动时直接抛错，这里是第二道保险）',
    new Set(definitions.map((def) => def.id)).size,
    definitions.length,
  );
  equal(
    '物品注册名无重复',
    new Set(definitions.map((def) => def.name)).size,
    definitions.length,
  );
  check(
    '每件物品都有中文名（id 撞车时名字会被静默顶替，这条能挡住）',
    definitions.every((def) => translateName(def.name) !== def.name.replace('minecraft:', '')),
    definitions
      .filter((def) => translateName(def.name) === def.name.replace('minecraft:', ''))
      .map((def) => def.name)
      .join(' '),
  );

  // 曾经真的发生过：染料区 1020~1035 压住生物掉落的 1030~1035，
  // 于是"腐肉"在物品表里被"紫色染料"顶替——捡起来显示成紫色染料，还能和真染料叠在一格
  equal('腐肉没有被染料顶替', itemName(Item.ROTTEN_FLESH), 'rotten_flesh');
  equal('骨头没有被染料顶替', itemName(Item.BONE), 'bone');
  equal('火药没有被染料顶替', itemName(Item.GUNPOWDER), 'gunpowder');
  equal('生牛肉没有被染料顶替', itemName(Item.BEEF), 'beef');
  equal('生猪排没有被染料顶替', itemName(Item.PORKCHOP), 'porkchop');
  equal('生羊肉没有被染料顶替', itemName(Item.MUTTON), 'mutton');
}

console.log('\n[掉落表]');
equal('草方块掉落泥土', dropFor(Block.GRASS_BLOCK)?.id, Block.DIRT);
equal('石头掉落圆石', dropFor(Block.STONE)?.id, Block.COBBLESTONE);
equal('钻石矿掉落钻石', dropFor(Block.DIAMOND_ORE)?.id, Item.DIAMOND);
equal('深层钻石矿掉落钻石', dropFor(Block.DEEPSLATE_DIAMOND_ORE)?.id, Item.DIAMOND);
equal('铁矿石掉落粗铁', dropFor(Block.IRON_ORE)?.id, Item.RAW_IRON);
equal('红石矿一次掉 4 个', dropFor(Block.REDSTONE_ORE)?.count, 4);
equal('青金石矿一次掉 5 个', dropFor(Block.LAPIS_ORE)?.count, 5);
equal('玻璃无掉落', dropFor(Block.GLASS), null);
equal('树叶无掉落', dropFor(Block.OAK_LEAVES), null);
equal('基岩无掉落', dropFor(Block.BEDROCK), null);
equal('圆石掉落自身', dropFor(Block.COBBLESTONE)?.id, Block.COBBLESTONE);

console.log('\n[背包：堆叠与溢出]');
{
  const inventory = new Inventory();
  const leftover1 = inventory.add(Block.STONE, 64);
  equal('放满 64 个石头后无剩余', leftover1, 0);
  equal('0 号槽是石头', inventory.get(0)?.id, Block.STONE);
  equal('0 号槽数量 64', inventory.get(0)?.count, 64);

  inventory.add(Block.STONE, 64);
  equal('第 2 叠进 1 号槽', inventory.get(1)?.count, 64);

  inventory.add(Block.STONE, 10);
  equal('溢出的 10 个进 2 号槽', inventory.get(2)?.count, 10);
  equal('石头总数 138', inventory.countOf(Block.STONE), 138);
}

console.log('\n[背包：取出与消耗]');
{
  const inventory = new Inventory();
  inventory.add(Block.STONE, 10);
  const taken = inventory.take(0, 4);
  equal('取出 4 个', taken?.count, 4);
  equal('取出后剩 6 个', inventory.get(0)?.count, 6);
  equal('取空后槽位变为空', inventory.take(0, 6) !== null && inventory.get(0), null);

  inventory.add(Block.STONE, 20);
  check('数量不足时 consume 返回 false', inventory.consume(Block.STONE, 999) === false);
  equal('consume 失败后数量不变', inventory.countOf(Block.STONE), 20);
  check('数量足够时 consume 返回 true', inventory.consume(Block.STONE, 20) === true);
  equal('消耗干净后背包为空', inventory.isEmpty, true);
}

console.log('\n[背包：拖拽合并与交换]');
{
  const inventory = new Inventory();
  inventory.add(Block.STONE, 64); // 槽 0
  inventory.add(Block.STONE, 60); // 槽 1
  inventory.take(0, 4); // 槽 0 变 60，槽 1 是 60
  inventory.moveTo(0, 1);
  equal('合并时上限 64，槽 1 应为 64', inventory.get(1)?.count, 64);
  equal('放不下的 56 个留在槽 0', inventory.get(0)?.count, 56);

  const inv2 = new Inventory();
  inv2.add(Block.DIRT, 5);
  inv2.add(Block.STONE, 7);
  inv2.moveTo(0, 1);
  equal('不同物品时交换：槽 0 变石头', inv2.get(0)?.id, Block.STONE);
  equal('不同物品时交换：槽 1 变泥土', inv2.get(1)?.id, Block.DIRT);

  const inv3 = new Inventory();
  inv3.add(Block.DIRT, 5);
  inv3.moveTo(0, 20);
  equal('拖到空槽：目标有物品', inv3.get(20)?.id, Block.DIRT);
  equal('拖到空槽：源槽清空', inv3.get(0), null);
}

console.log('\n[背包：槽位布局]');
equal('快捷栏 9 格', HOTBAR_SIZE, 9);
equal('总槽位 41', TOTAL_SLOTS, 41);
equal('副手槽为 40', OFFHAND_SLOT, 40);
{
  const inventory = new Inventory();
  inventory.add(Block.DIRT, 1);
  equal('优先放入快捷栏 0 号槽', inventory.get(0)?.id, Block.DIRT);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
