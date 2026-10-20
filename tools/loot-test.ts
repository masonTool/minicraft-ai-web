/**
 * 战利品表与结构箱填充（K8 尾巴）离线测试
 *
 * 覆盖四块：
 *  1. **表本身的合法性**：轮次/权重/数量区间、引用的物品都真的存在、张数装得进 4 位状态位
 *  2. **"哪张表"怎么存**：箱子方块状态的 bits 4-7 编解码，且不与其它状态位打架
 *  3. **掷点行为**：轮次与数量都在区间内、只产出表里的物品、权重真的影响分布、空手项会占一轮
 *  4. **填充**（`LootFill.ts`）：只填带表的箱子、只填一次、按坐标确定性、**掏空后不会长回来**
 *
 * 运行：npm run test:loot
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import { chestLootIndex, withChestLoot, withFacing, facingOf } from '../src/core/registry/blockState.ts';
import {
  LOOT_INDEX_MAX,
  LOOT_TABLES,
  lootItemIds,
  lootTableByIndex,
  lootTableIndex,
  rollLoot,
  validateLootTables,
  type LootTable,
} from '../src/core/registry/loot.ts';
import { Item, durabilityOf, itemDef, itemName } from '../src/core/registry/items.ts';
import { fillLootChests, lootDurabilityDamage } from '../src/core/world/LootFill.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { BlockEntityStore, type BlockContainer } from '../src/core/world/BlockEntityStore.ts';
import { CHEST_SIZE, Chest } from '../src/core/container/Chest.ts';
import { SLOT_COUNTS, serializeContainer, restoreContainers } from '../src/core/save/ContainerSave.ts';
import { Chunk } from '../src/core/world/Chunk.ts';
import { PositionalRng } from '../src/core/gen/Features.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import type { ItemStack } from '../src/core/container/Inventory.ts';

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

/** 固定序列的随机源（需要"精确控制掷点结果"的用例用它） */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

// ---------------------------------------------------------------- 1. 表本身

console.log('\n[战利品表：合法性]');
{
  const problems = validateLootTables();
  check(`所有表都合法（共 ${LOOT_TABLES.length} 张）`, problems.length === 0, problems.slice(0, 3).join('；'));
  check(`张数不超过状态位能表示的 ${LOOT_INDEX_MAX} 张`, LOOT_TABLES.length <= LOOT_INDEX_MAX);
  equal('表 id 唯一', new Set(LOOT_TABLES.map((table) => table.key)).size, LOOT_TABLES.length);
  check('每张表都有中文名', LOOT_TABLES.every((table) => table.name.length > 0));
  check(
    '每张表至少有一条能给东西的候选（不是"永远是空箱"）',
    LOOT_TABLES.every((table) => table.entries.some((item) => item.id !== 0)),
  );

  // 引用的物品必须真的存在：写错 id 的表现是"箱子里出现一件空白"
  const ids = lootItemIds();
  const missing = ids.filter((id) => itemDef(id) === undefined);
  check(`表里引用到的 ${ids.length} 种物品都在注册表里`, missing.length === 0, missing.join(','));

  // 序号：1 起，且与数组顺序一致（顺序即 id，不能插在中间）
  for (const table of LOOT_TABLES) {
    equal(`序号：${table.key}`, lootTableIndex(table.key), LOOT_TABLES.indexOf(table) + 1);
  }
  equal('按序号查第 1 张表', lootTableByIndex(1)?.key, LOOT_TABLES[0]!.key);
  equal('序号 0 = 没有表', lootTableByIndex(0), null);
  equal('序号越界 = 没有表', lootTableByIndex(LOOT_TABLES.length + 1), null);
  equal('负序号 = 没有表', lootTableByIndex(-1), null);
  equal('不存在的 key', lootTableIndex('no_such_table'), 0);
}

// ---------------------------------------------------------------- 2. 状态位

console.log('\n[箱子状态位：低 4 位在 bits 4-7、高 1 位在 bit0（批次 459）]');
{
  equal('写入后能读回来', chestLootIndex(withChestLoot(0, 7)), 7);
  equal('默认 0（玩家自己放的箱子）', chestLootIndex(0), 0);
  equal('上限钳制到 31', chestLootIndex(withChestLoot(0, 999)), 31);
  equal('负数钳制到 0', chestLootIndex(withChestLoot(0, -3)), 0);
  equal('小数向下取整', chestLootIndex(withChestLoot(0, 3.9)), 3);
  // 不与其它状态位打架：箱子的低位将来可能给 facing，这里做个对照
  const withFacingBits = withChestLoot(withFacing(0, 2), 5);
  equal('写了表序号后朝向位还在', facingOf(withFacingBits), 2);
  equal('朝向写入后表序号也还在', chestLootIndex(withFacing(withFacingBits, 3)), 5);
  check('箱子是整格方块（贴图取三面 tile）', blockDef(Block.CHEST).shape === 'cube');
}

// ---------------------------------------------------------------- 3. 掷点

console.log('\n[掷点：轮次、数量与权重]');
{
  // 轮次的上下界：用一张"没有空手项"的自造表，才能从输出条数直接读出轮数
  const rollsTable: LootTable = {
    key: 'test_rolls',
    name: '测试用·轮次',
    rollsMin: 2,
    rollsMax: 5,
    entries: [{ id: itemId('coal'), min: 1, max: 1, weight: 1 }],
  };
  equal('掷点 0 → 轮次取到 2 轮', rollLoot(rollsTable, () => 0).length, 2);
  // 交替 0.999（轮次用）/ 0.5（选第 1 项）→ 5 轮
  equal('掷点 0.999 → 5 轮', rollLoot(rollsTable, sequence([0.999, 0.5])).length, 5);

  // 真实表：轮次永远不会越界（跑一批随机源）
  let over = 0;
  for (let i = 0; i < 3000; i++) {
    for (const table of LOOT_TABLES) {
      const out = rollLoot(table, Math.random).length;
      if (out > table.rollsMax) over++;
    }
  }
  equal('3000 次掷点里没有一次超出轮次上限', over, 0);

  // 确定性与"数量/物品都在表里"
  const dungeon = LOOT_TABLES.find((table) => table.key === 'dungeon')!;
  const rngA = new PositionalRng(1, 2, 3);
  const rngB = new PositionalRng(1, 2, 3);
  const a = rollLoot(dungeon, () => rngA.next());
  const b = rollLoot(dungeon, () => rngB.next());
  check('同一个随机源两次结果一致', JSON.stringify(a) === JSON.stringify(b));

  let outOfRange = 0;
  let unknownItem = 0;
  for (let i = 0; i < 3000; i++) {
    for (const stack of rollLoot(dungeon, Math.random)) {
      if (!dungeon.entries.some((item) => item.id === stack.id)) unknownItem++;
      const spec = dungeon.entries.find((item) => item.id === stack.id)!;
      if (stack.count < spec.min || stack.count > spec.max) outOfRange++;
    }
  }
  equal('只会产出表里列出的物品', unknownItem, 0);
  equal('数量都在条目区间内', outOfRange, 0);

  // 权重：骨头（权重 5）应当明显多于钻石（权重 1）
  const boneEntry = dungeon.entries.find((item) => item.id === itemId('bone'))!;
  const diamondEntry = dungeon.entries.find((item) => item.id === itemId('diamond'))!;
  let bones = 0;
  let diamonds = 0;
  for (let i = 0; i < 4000; i++) {
    for (const stack of rollLoot(dungeon, Math.random)) {
      if (stack.id === boneEntry.id) bones++;
      if (stack.id === diamondEntry.id) diamonds++;
    }
  }
  check(
    `权重生效：骨头（权重 ${boneEntry.weight}）比钻石（权重 ${diamondEntry.weight}）多（${bones} vs ${diamonds}）`,
    bones > diamonds * 2,
  );

  // 空手项：自造一张"只有空手"的表，输出必须是空的
  const allEmpty: LootTable = {
    key: 'test_empty',
    name: '测试用·全空手',
    rollsMin: 3,
    rollsMax: 3,
    entries: [
      { id: 0, min: 0, max: 0, weight: 1 },
      { id: itemId('coal'), min: 1, max: 1, weight: 0 },
    ],
  };
  // 权重为 0 的候选排在空手项后面：pick 永远落在空手项上（total 只算正权重）
  equal('权重为 0 的候选永远不会被抽中', rollLoot(allEmpty, () => 0.5).length, 0);
  equal('权重全为 0 的表直接返回空', rollLoot({ ...allEmpty, entries: [{ id: itemId('coal'), min: 1, max: 1, weight: 0 }] }, () => 0.5).length, 0);
  // 半空半实：掷点落在空手项上时，输出条数少于轮次
  const halfEmpty: LootTable = {
    key: 'test_half',
    name: '测试用·一半空手',
    rollsMin: 4,
    rollsMax: 4,
    entries: [
      { id: itemId('coal'), min: 1, max: 1, weight: 1 },
      { id: 0, min: 0, max: 0, weight: 1 },
    ],
  };
  equal('掷点全部落在空手项上 → 什么都不给', rollLoot(halfEmpty, () => 0.9).length, 0);
  equal('掷点全部落在实物上 → 4 轮给 4 件', rollLoot(halfEmpty, sequence([0.1, 0, 0.1, 0, 0.1, 0, 0.1, 0])).length, 4);
}

/** 按注册名找物品 id（免得在断言里写魔法数字） */
function itemId(name: string): number {
  for (const table of LOOT_TABLES) {
    for (const item of table.entries) {
      if (item.id !== 0 && itemName(item.id) === name) return item.id;
    }
  }
  throw new Error(`战利品表里没有 ${name}`);
}

// ---------------------------------------------------------------- 4. 填充

console.log('\n[填充：按表把箱子填上]');
{
  const SEED = 424242;

  /** 造一个只放了几个箱子的区块：带表的 / 玩家放的（状态 0）/ 表序号非法的 */
  function chunkWithChests(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const dungeonIndex = lootTableIndex('dungeon');
    // 三只箱子放在不同的 y，方便断言"竖直方向也参与随机种子"
    chunk.set(1, 40, 1, Block.CHEST, withChestLoot(0, dungeonIndex));
    chunk.set(3, 41, 3, Block.CHEST, withChestLoot(0, dungeonIndex));
    chunk.set(5, 40, 5, Block.CHEST, 0); // 玩家自己放的
    // ⚠️ 批次 345 起表数正好 15 张 = 状态位能表示的最大值，
    // "越界序号"已经**不可能从方块状态里出现**（`withChestLoot` 会夹到 15），
    // 所以不再构造那一格；`lootTableByIndex` 的越界保护仍由纯函数测试覆盖。
    return chunk;
  }

  const store = new BlockEntityStore();
  const stats = fillLootChests(chunkWithChests(0, 0), Dimension.OVERWORLD, SEED, store);
  equal('只填了带表的那两只箱子', stats.chests, 2);
  check(`共放进 ${stats.items} 件物品（一轮一件，应在 4~12 之间）`, stats.items >= 4 && stats.items <= 12, `${stats.items}`);

  const first = asChest(store.get(Dimension.OVERWORLD, 1, 40, 1));
  const second = asChest(store.get(Dimension.OVERWORLD, 3, 41, 3));
  check('第一只箱子有内容', first !== null && !first.isEmpty);
  check('第二只箱子也有内容', second !== null && !second.isEmpty);
  check(
    '两只箱子内容不同（竖直方向也参与种子）',
    first !== null && second !== null && contents(first) !== contents(second),
  );
  if (!first || !second) throw new Error('填充失败：带表的箱子应当被建出来');
  check('玩家的箱子没被碰（连容器都没创建）', store.get(Dimension.OVERWORLD, 5, 40, 5) === undefined);
  check('填过的箱子都置了 looted', (first as Chest).looted === true && (second as Chest).looted === true);

  // 内容必须是这张表里列出的东西
  const dungeon = LOOT_TABLES.find((table) => table.key === 'dungeon')!;
  const ids = new Set(dungeon.entries.map((item) => item.id));
  const allFromTable = slotsOf(first).every((stack) => ids.has(stack.id));
  check('填进去的物品都来自地牢表', allFromTable);
  check(
    '数量都在区间内',
    slotsOf(first).every((stack) => {
      const spec = dungeon.entries.find((item) => item.id === stack.id)!;
      return stack.count >= spec.min && stack.count <= spec.max;
    }),
  );
  check('物品没有重叠放在同一格（每格一个栈）', slotsOf(first).length <= CHEST_SIZE);

  // 幂等：同一个区块再填一次，什么都不该变
  const before = contents(first);
  const again = fillLootChests(chunkWithChests(0, 0), Dimension.OVERWORLD, SEED, store);
  equal('再填一次：没有新箱子被填', again.chests, 0);
  equal('再填一次：内容没变', contents(first), before);

  // 确定性：另起一个干净的容器表，同种子同坐标 → 内容完全一致
  const other = new BlockEntityStore();
  fillLootChests(chunkWithChests(0, 0), Dimension.OVERWORLD, SEED, other);
  const mirrored = asChest(other.get(Dimension.OVERWORLD, 1, 40, 1));
  check('同种子同坐标：内容逐格一致', mirrored !== null && contents(mirrored) === before);

  // 换一片区域：内容应当不同（十几轮掷点，撞上一模一样的概率可以忽略）
  const far = new BlockEntityStore();
  fillLootChests(chunkWithChests(80, 80), Dimension.OVERWORLD, SEED, far);
  const farChest = asChest(far.get(Dimension.OVERWORLD, 80 * 16 + 1, 40, 80 * 16 + 1));
  check('不同位置的箱子内容不同', farChest !== null && contents(farChest) !== before);
}

console.log('\n[掏空之后不会长回来]');
{
  const SEED = 999;
  const dungeonIndex = lootTableIndex('dungeon');
  const chunk = () => {
    const c = new Chunk(0, 0);
    c.set(2, 40, 2, Block.CHEST, withChestLoot(0, dungeonIndex));
    return c;
  };

  // 1) 填上
  const store = new BlockEntityStore();
  fillLootChests(chunk(), Dimension.OVERWORLD, SEED, store);
  const chest = asChest(store.get(Dimension.OVERWORLD, 2, 40, 2));
  if (!chest) throw new Error('填充失败：带表的箱子应当被建出来');
  check('第一次填上了东西', !chest.isEmpty);

  // 2) 玩家把东西全掏空
  for (let i = 0; i < CHEST_SIZE; i++) chest.set(i, null);
  check('掏空后箱子是空的', chest.isEmpty);
  check('但 looted 标记还在', chest.looted);

  // 3) 存档往返（这一步是重点：空箱子原本会被"不写进存档"优化掉）
  const data = serializeContainer(chest, Dimension.OVERWORLD, 2, 40, 2);
  check('被填过的空箱子仍然进存档（否则读档后会重新填）', data !== null);
  equal('存档里记着 looted', data?.chest?.looted, true);

  const restored = new BlockEntityStore();
  equal('读档还原了这只箱子', restoreContainers(restored, data ? [data] : []), 1);

  // 4) 区块再加载一次：绝不能又长出来
  const refilled = fillLootChests(chunk(), Dimension.OVERWORLD, SEED, restored);
  equal('重新加载后没有箱子被填', refilled.chests, 0);
  const after = asChest(restored.get(Dimension.OVERWORLD, 2, 40, 2));
  check('箱子依然是空的（没有"无限刷矿物"）', after !== null && after.isEmpty);

  // 对照：没被填过的箱子（比如这个存档里从没加载过该区块）读档后仍然会被填
  const fresh = new BlockEntityStore();
  const freshStats = fillLootChests(chunk(), Dimension.OVERWORLD, SEED, fresh);
  equal('从没填过的箱子照样会被填上', freshStats.chests, 1);

  // 玩家自己放的箱子：状态 0，永远不填
  const plain = new Chunk(0, 0);
  plain.set(9, 40, 9, Block.CHEST, 0);
  const plainStore = new BlockEntityStore();
  equal('玩家放的箱子不会被填', fillLootChests(plain, Dimension.OVERWORLD, SEED, plainStore).chests, 0);
  check('也不会给它创建容器', plainStore.get(Dimension.OVERWORLD, 9, 40, 9) === undefined);
}

console.log('\n[与存档/容器的衔接]');
{
  equal('箱子的槽位数没变（27 格）', SLOT_COUNTS.chest, CHEST_SIZE);
  // 普通箱子（没被 looted 过、也没东西）依然不写进存档
  const plainChest = new Chest();
  equal('没被填过也没东西的箱子不写存档', serializeContainer(plainChest, Dimension.OVERWORLD, 0, 0, 0), null);

  // 物品种类与图标：表里引用的都能正常显示（不能出现"空白格子"）
  const broken = lootItemIds().filter((id) => itemDef(id)!.tile.length === 0);
  check('表里每种物品都有图标名', broken.length === 0, broken.join(','));
  check('表里没有"空气"（空手项走 id 0，不占物品位）', lootItemIds().every((id) => id !== Block.AIR));
}

/** 把"容器表里取出来的东西"收窄成箱子（`BlockEntityStore.get` 返回的是联合类型） */
function asChest(container: BlockContainer | undefined): Chest | null {
  return container instanceof Chest ? container : null;
}

/** 箱子内容摘要（比较用） */
function contents(chest: Chest): string {
  return slotsOf(chest)
    .map((stack) => `${stack.id}x${stack.count}`)
    .join(',');
}

function slotsOf(chest: Chest): ItemStack[] {
  const out: ItemStack[] = [];
  for (let i = 0; i < CHEST_SIZE; i++) {
    const stack = chest.get(i);
    if (stack) out.push(stack);
  }
  return out;
}

console.log('\n[马铠：K10 最后缺的一类（批次 570）]');
{
  const armors = [Item.LEATHER_HORSE_ARMOR, Item.IRON_HORSE_ARMOR, Item.GOLDEN_HORSE_ARMOR, Item.DIAMOND_HORSE_ARMOR];
  for (const id of armors) {
    check(
      `${itemName(id)}至少在一张结构表里`,
      LOOT_TABLES.some((table) => table.entries.some((entry) => entry.id === id)),
    );
    check(`${itemName(id)}有图标`, (itemDef(id)?.tile.length ?? 0) > 0);
  }
  check('四档马铠都不可堆叠', armors.every((id) => itemDef(id)?.maxStack === 1));
}

console.log('\n[战利品随机耐久（批次 573）]');
{
  const pick = toolItemId('pickaxe', 'iron');
  const low = lootDurabilityDamage(pick, 0);
  const high = lootDurabilityDamage(pick, 1);
  check('装备带正耐久损耗', low > 0 && high > 0, `${low} / ${high}`);
  check('0~1 的随机数映射到 10%~90%', low < high);
  equal('没有耐久的物品不塞损耗', lootDurabilityDamage(Item.STICK, 0.5), 0);
  check('损耗不会直接打满', lootDurabilityDamage(pick, 1) < durabilityOf(pick));
}

console.log(`\n战利品测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
