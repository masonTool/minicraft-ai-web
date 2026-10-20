/**
 * 物品注册表与背包模型的离线测试
 *
 * 运行：npm run test:inventory
 * 这些模块都是纯逻辑、无 DOM 依赖，所以可以直接在 Node 里跑断言，
 * 比开浏览器验证快得多，也不必担心渲染干扰。
 */

import { Block, BLOCKS, blockDef } from '../src/core/registry/blocks.ts';
import { blockLabel } from '../src/core/registry/itemNames.ts';
import { restoreStack, sameExtras, stackExtras } from '../src/core/container/Inventory.ts';
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
import { DEV_KIT_ITEMS, devKitRequested, grantDevKit } from '../src/game/startupKit.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { Chest } from '../src/core/container/Chest.ts';
import { tryInsertOne } from '../src/core/container/Transfer.ts';

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
// `itemless`（火焰）是**故意没有物品**的方块：原版火焰也不能被拿在手里，
// 只能靠打火石/岩浆点燃，所以它要从这条不变量里排除
const missingBlockItem = BLOCKS.filter(
  (def) => def.id !== Block.AIR && !def.liquid && !def.itemless && blockForItem(def.id) === undefined,
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


console.log('\n[背包：整栈存入（批次 63）]');
{
  // 附加数据要一起进背包
  const inventory = new Inventory();
  const pick = { id: Block.STONE, count: 1, name: '地基', damage: 3, enchants: { efficiency: 2 } };
  equal('全部收下（剩余 0）', inventory.addStack(pick), 0);
  equal('名字带进来了', inventory.get(0)?.name, '地基');
  equal('耐久带进来了', inventory.get(0)?.damage, 3);
  equal('附魔带进来了', inventory.get(0)?.enchants?.efficiency, 2);

  // 只与"完全一样"的栈合并
  const mixer = new Inventory();
  mixer.addStack({ id: Block.STONE, count: 1 });
  mixer.addStack({ id: Block.STONE, count: 1, name: '地基' });
  equal('改过名的另占一格', mixer.get(1)?.name, '地基');
  equal('普通那堆没被改名', mixer.get(0)?.name, undefined);
  const plain = new Inventory();
  plain.addStack({ id: Block.STONE, count: 1 });
  plain.addStack({ id: Block.STONE, count: 2 });
  equal('两份一样的会合并', plain.get(0)?.count, 3);
  // ⚠️ 这里原来写的是 `plain.findFirstEmpty?.() ?? 1`：**方法根本不存在**，
  // 于是 `?.()` 静默短路、`?? 1` 兜底，断言永远成立（O6 扫出来的空断言）。
  // 真要问的是"合并之后只用了一格"——直接看第二格是不是空的
  equal('只用一格（第二格还是空的）', plain.get(1), null);

  // 装不下时留在手上（返回值 = 剩余）
  const small = new Inventory();
  for (let i = 0; i < 36; i++) small.set(i, { id: Block.DIRT, count: 64 });
  equal('一格都塞不下时全部剩着', small.addStack({ id: Block.STONE, count: 5 }), 5);
  equal('背包没被改坏', small.get(0)?.id, Block.DIRT);

  // 大堆要分摊到多个格子
  const split = new Inventory();
  split.addStack({ id: Block.STONE, count: 100 });
  equal('100 个分成 64 + 36', `${split.get(0)?.count} + ${split.get(1)?.count}`, '64 + 36');

  // moveTo 的合并也一样：改了名的不并进普通那堆
  const drag = new Inventory();
  drag.set(0, { id: Block.STONE, count: 1 });
  drag.set(1, { id: Block.STONE, count: 1, name: '地基' });
  drag.moveTo(1, 0);
  equal('改名的那份没被并掉（换位）', drag.get(0)?.name, '地基');
  equal('普通那份还在原处', drag.get(1)?.name, undefined);
}

console.log('\n[开发期物资：开关 / 去重 / 非堆叠发放（批次 181）]');
{
  equal('清单去重后没有重复 id', new Set(DEV_KIT_ITEMS).size, DEV_KIT_ITEMS.length);
  check('清单里确实有铁镐（这条断言才有意义）', DEV_KIT_ITEMS.includes(toolItemId('pickaxe', 'iron')));

  check('?devkit=1 打开开关', devKitRequested('?devkit=1', null));
  check('不带问号也认', devKitRequested('devkit=1', null));
  check('localStorage 标记也认', devKitRequested('', '1'));
  check('默认关闭（URL 与存储都没开）', !devKitRequested('', null));
  check('其它参数不会误触发', !devKitRequested('?foo=1', null));

  // 旧 bug 的"底噪"：`add(非堆叠, 64)` 本来就会逐格填满 36 格。
  // 把这条钉住，是为了防止以后有人把"发放数量"改回 64 又以为是 Inventory 坏了。
  const raw = new Inventory();
  raw.add(toolItemId('pickaxe', 'iron'), 64);
  const rawPicks = Array.from({ length: TOTAL_SLOTS }, (_, i) => raw.get(i)).filter(
    (stack) => stack?.id === toolItemId('pickaxe', 'iron'),
  );
  equal('add(铁镐, 64) 会占满 36 格（这是 Inventory 的正常语义）', rawPicks.length, 36);

  const kit = new Inventory();
  const result = grantDevKit(kit);
  const pick = toolItemId('pickaxe', 'iron');
  const pickSlots = Array.from({ length: TOTAL_SLOTS }, (_, i) => kit.get(i)).filter(
    (stack) => stack?.id === pick,
  );
  equal('开局发放只占 1 格铁镐', pickSlots.length, 1);
  equal('铁镐数量就是 1 把', pickSlots[0]?.count, 1);

  // 所有非堆叠物品都不该出现"同一件占两格"
  const nonStackable = DEV_KIT_ITEMS.filter((id) => maxStackOf(id) === 1);
  const duplicated = nonStackable.filter((id) => {
    const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => kit.get(i)).filter((stack) => stack?.id === id);
    return slots.length > 1;
  });
  equal('非堆叠物品没有一件占两格', duplicated.length, 0);

  check('清单比 36 格多（所以确实会有放不下的）', DEV_KIT_ITEMS.length > TOTAL_SLOTS);
  check('放不下时如实报告（控制台用）', result.skipped.length > 0);
  equal('放进去的件数 = 36 - 跳过的件数', result.granted + result.skipped.length, DEV_KIT_ITEMS.length);
}

console.log('\n[磁石与指南针绑定（批次 453）]');
{
  // ① 方块本身
  equal('磁石的注册名', blockDef(Block.LODESTONE).name, 'minecraft:lodestone');
  equal('磁石中文名', blockLabel(Block.LODESTONE), '磁石');
  check('磁石是实心整格', blockDef(Block.LODESTONE).solid);

  // ② 绑定数据：进存档、读回来还在
  const raw = { id: Item.COMPASS, count: 1, lodestone: { x: 12, y: 64, z: -3, dimension: 'overworld' } };
  const restored = restoreStack(raw);
  equal('坐标读回来', restored?.lodestone?.x, 12);
  equal('维度读回来', restored?.lodestone?.dimension, 'overworld');
  check('整数化（小数坐标被 floor）', restoreStack({ ...raw, lodestone: { x: 12.9, y: 64, z: -3, dimension: 'nether' } })?.lodestone?.x === 12);
  check('坏维度被丢掉，指南针本身还在', restoreStack({ ...raw, lodestone: { x: 1, y: 2, z: 3, dimension: 'moon' } })?.lodestone === undefined);
  check('坏坐标被丢掉', restoreStack({ ...raw, lodestone: { x: Number.NaN, y: 2, z: 3, dimension: 'end' } })?.lodestone === undefined);

  // ③ 搬运要深拷：改一件不能动到另一件
  const original = { id: Item.COMPASS, count: 1, lodestone: { x: 1, y: 2, z: 3, dimension: 'overworld' } };
  const copy = { id: Item.COMPASS, count: 1, ...stackExtras(original) };
  if (copy.lodestone) copy.lodestone.x = 99;
  equal('拷出去的那份改了，原件不变', original.lodestone.x, 1);

  // ④ 并堆判定：绑在不同磁石上的两枚指南针不能并成一堆
  check(
    '绑不同磁石 → 不能并堆',
    !sameExtras(
      { lodestone: { x: 1, y: 2, z: 3, dimension: 'overworld' } },
      { lodestone: { x: 9, y: 2, z: 3, dimension: 'overworld' } },
    ),
  );
  check(
    '绑同一块磁石 → 可以并堆',
    sameExtras(
      { lodestone: { x: 1, y: 2, z: 3, dimension: 'overworld' } },
      { lodestone: { x: 1, y: 2, z: 3, dimension: 'overworld' } },
    ),
  );
  check('一枚绑了、一枚没绑 → 不能并堆', !sameExtras({ lodestone: { x: 1, y: 2, z: 3, dimension: 'overworld' } }, {}));
}

console.log('\n[旗帜图案跟着物品走（批次 502）]');
{
  const banner = { id: Block.RED_BANNER, count: 1, bannerPattern: 2 };
  equal('图案读回来', restoreStack(banner)?.bannerPattern, 2);
  equal('第 4 种图案（上限）读回来', restoreStack({ ...banner, bannerPattern: 4 })?.bannerPattern, 4);
  equal('0 当光板（不写字段）', restoreStack({ ...banner, bannerPattern: 0 })?.bannerPattern, undefined);
  equal('越界当光板', restoreStack({ ...banner, bannerPattern: 9 })?.bannerPattern, undefined);
  equal('小数当光板', restoreStack({ ...banner, bannerPattern: 1.5 })?.bannerPattern, undefined);
  equal('字符串当光板', restoreStack({ ...banner, bannerPattern: '2' })?.bannerPattern, undefined);
  equal('没有这个字段就是光板', restoreStack({ id: Block.RED_BANNER, count: 1 })?.bannerPattern, undefined);
  equal(
    '非旗帜带着这个字段也丢掉（石头不该有图案）',
    restoreStack({ id: Block.STONE, count: 1, bannerPattern: 2 })?.bannerPattern,
    undefined,
  );

  equal('stackExtras 带上图案', stackExtras(banner).bannerPattern, 2);
  check('光板与带图案不能并堆', !sameExtras({ bannerPattern: 1 }, {}));
  check('同一图案可以并堆', sameExtras({ bannerPattern: 1 }, { bannerPattern: 1 }));
  check('不同图案不能并堆', !sameExtras({ bannerPattern: 1 }, { bannerPattern: 2 }));

  // 第四处链路：漏斗/搬运的 cloneExtras（漏了这一处，搬一趟图案就没了）
  const chest = new Chest();
  check('漏斗塞得进去', tryInsertOne(chest, banner));
  equal('搬过去图案还在', chest.get(0)?.bannerPattern, 2);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
