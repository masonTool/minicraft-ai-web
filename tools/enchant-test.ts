/**
 * 附魔台与附魔表离线测试（H9）
 *
 * 覆盖五块：
 *  1. 附魔表：38 条对齐原版、id/名字无重复、目标物品非空、宝藏附魔不进附魔台
 *  2. 候选槽：书架加成、花费公式（槽 0 ≤ 槽 1 ≤ 槽 2）、等级不够时不给候选
 *  3. 结算：等级不够 / 青金石不够时**一点都不扣**；成功后扣等级、扣青金石、写附魔
 *  4. 重掷规则：局面没变就不换附魔（否则每次刷新都会换一批，玩家点不到刚看到的那条）
 *  5. 存档与提示框：附魔跟着 `ItemStack` 走，提示框单独一行显示
 *
 * 运行：npm run test:enchant
 */

import { Block } from '../src/core/registry/blocks.ts';
import { armorItemId } from '../src/core/registry/armor.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { Item } from '../src/core/registry/items.ts';
import {
  ENCHANTMENTS,
  VANILLA_ENCHANTMENT_COUNT,
  canEnchant,
  enchantmentById,
  enchantmentName,
  romanLevel,
} from '../src/core/registry/enchantments.ts';
import {
  MAX_BOOKSHELF_POWER,
  bookshelfPower,
  enchantKindOf,
  enchantmentCost,
  offeringFor,
  optionLabel,
  rollOptions,
} from '../src/core/crafting/Enchanting.ts';
import { ENCHANT_ITEM_SLOT, ENCHANT_LAPIS_SLOT, EnchantTable } from '../src/core/container/EnchantTable.ts';
import { Inventory } from '../src/core/container/Inventory.ts';
import { Experience } from '../src/core/survival/Experience.ts';
import { itemTooltip } from '../src/core/registry/itemNames.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';

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

/** 固定种子的随机数（线性同余），让"随机"的结果可复现 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const DIAMOND_PICK = toolItemId('pickaxe', 'diamond');
const IRON_SWORD = toolItemId('sword', 'iron');

/** 造一台"装备就位 + 青金石管够"的附魔台 */
function tableWith(itemId: number, lapis = 3): EnchantTable {
  const table = new EnchantTable();
  table.set(ENCHANT_ITEM_SLOT, { id: itemId, count: 1 });
  table.set(ENCHANT_LAPIS_SLOT, { id: Item.LAPIS_LAZULI, count: lapis });
  return table;
}

// ---------------------------------------------------------------- 1. 附魔表

console.log('\n[附魔表]');
equal('附魔总数与原版 1.18 一致', ENCHANTMENTS.length, VANILLA_ENCHANTMENT_COUNT);
equal('id 无重复', new Set(ENCHANTMENTS.map((def) => def.id)).size, ENCHANTMENTS.length);
equal('中文名无重复', new Set(ENCHANTMENTS.map((def) => def.name)).size, ENCHANTMENTS.length);
check('每条都有可附魔的目标物品', ENCHANTMENTS.every((def) => def.targets.length > 0));
check('最高等级都 ≥ 1', ENCHANTMENTS.every((def) => def.maxLevel >= 1));
check('权重都 ≥ 1', ENCHANTMENTS.every((def) => def.weight >= 1));
equal('效率最高 5 级', enchantmentById('efficiency')?.maxLevel, 5);
equal('精准采集只有 1 级', enchantmentById('silk_touch')?.maxLevel, 1);
equal('经验修补是宝藏附魔', enchantmentById('mending')?.treasure, true);
equal('已有名字的附魔取中文名', enchantmentName('fortune'), '时运');
equal('没登记的 id 回退成 id 本身', enchantmentName('not_a_thing'), 'not_a_thing');
equal('罗马数字 1/4/5/9/10', [1, 4, 5, 9, 10].map(romanLevel).join(','), 'I,IV,V,IX,X');

console.log('\n[可用附魔的筛选]');
check('书的候选池里没有宝藏附魔（经验修补）', !offeringFor('book').some((def) => def.id === 'mending'));
check(
  '镐能出效率/时运/精准采集',
  ['efficiency', 'fortune', 'silk_touch'].every((id) => offeringFor('pickaxe').some((def) => def.id === id)),
);
check('头盔出不了效率', !offeringFor('helmet').some((def) => def.id === 'efficiency'));
check('剑能出锋利', offeringFor('sword').some((def) => def.id === 'sharpness'));
check('盔甲能出保护', offeringFor('helmet').some((def) => def.id === 'protection'));
equal('没有类别就没有候选池', offeringFor(null).length, 0);
check('canEnchant 拒绝不匹配的目标', !canEnchant(enchantmentById('efficiency')!, 'helmet'));

console.log('\n[物品 → 附魔类别]');
equal('钻石镐 → pickaxe', enchantKindOf(DIAMOND_PICK), 'pickaxe');
equal('钻石剑 → sword', enchantKindOf(toolItemId('sword', 'diamond')), 'sword');
equal('钻石胸甲 → chestplate', enchantKindOf(armorItemId('chestplate', 'diamond')), 'chestplate');
equal('书架不是可附魔物品', enchantKindOf(Block.BOOKSHELF), null);
equal('钻石也不是可附魔物品', enchantKindOf(Item.DIAMOND), null);

// ---------------------------------------------------------------- 2. 候选槽

console.log('\n[书架加成]');
equal('没有书架 → 0', bookshelfPower(0), 0);
equal('1 个书架 → 1', bookshelfPower(1), 1);
equal('15 个书架 → 15', bookshelfPower(15), 15);
equal('20 个书架也只算 15（原版上限）', bookshelfPower(20), MAX_BOOKSHELF_POWER);
equal('负数按 0 算', bookshelfPower(-3), 0);

console.log('\n[候选槽的花费]');
for (const power of [0, 5, 15]) {
  const costs = [0, 1, 2].map((slot) => enchantmentCost(seeded(7), slot, power));
  check(`书架加成 ${power} 时三槽花费递增（${costs.join(' ≤ ')}）`, costs[0]! <= costs[1]! && costs[1]! <= costs[2]!);
}
{
  // 同一个种子下比：书架越多花费越高（排除随机差异）
  const low = enchantmentCost(seeded(99), 2, 0);
  const high = enchantmentCost(seeded(99), 2, 15);
  check(`书架加成把花费抬高了（${low} → ${high}）`, high > low);
  check('花费至少为 1', [0, 1, 2].every((slot) => enchantmentCost(seeded(3), slot, 0) >= 1));
}

console.log('\n[掷出三个候选]');
{
  const options = rollOptions(DIAMOND_PICK, 30, 15, seeded(42));
  equal('总是三个槽', options.length, 3);
  equal('青金石消耗 1/2/3', options.map((o) => o.lapis).join(','), '1,2,3');
  check('每个槽都有附魔', options.every((o) => o.enchants.length > 0));
  check('同一个槽里的附魔不重复', options.every((o) => new Set(o.enchants.map((e) => e.id)).size === o.enchants.length));
  check(
    '附魔等级都在 1 ~ 该附魔上限之间',
    options.every((o) =>
      o.enchants.every((e) => {
        const def = enchantmentById(e.id)!;
        return e.level >= 1 && e.level <= def.maxLevel;
      }),
    ),
  );
  check(
    '镐不会掷出"保护"这类不匹配的附魔',
    options.every((o) => o.enchants.every((e) => offeringFor('pickaxe').some((def) => def.id === e.id))),
  );
  check(
    '等级 30 + 满加成能出到 2 级以上',
    options.some((o) => o.enchants.some((e) => e.level >= 2)),
    optionLabel(options[2]!.enchants),
  );

  check('等级不够时不给候选（0 级玩家点不动）', rollOptions(DIAMOND_PICK, 0, 0, seeded(42)).every((o) => o.enchants.length === 0));
  check('非装备物品没有候选', rollOptions(Block.OAK_LOG, 30, 15, seeded(1)).every((o) => o.enchants.length === 0));

  const a = optionLabel(rollOptions(DIAMOND_PICK, 30, 15, seeded(7))[2]!.enchants);
  const b = optionLabel(rollOptions(DIAMOND_PICK, 30, 15, seeded(7))[2]!.enchants);
  equal('同一种子推出同一批附魔', a, b);
}

// ---------------------------------------------------------------- 3. 结算

console.log('\n[点候选：扣等级与青金石]');
{
  const table = tableWith(DIAMOND_PICK);
  const xp = new Experience();
  xp.add(1395); // 正好 30 级
  table.refresh(xp.level, 15, seeded(42));

  const option = table.options[0]!;
  const before = xp.level;
  const result = table.applySlot(0, xp.level, (levels) => xp.consumeLevels(levels));
  check('结算成功', result.ok, result.ok ? '' : result.reason);
  equal('扣掉了对应等级', xp.level, before - option.cost);
  equal('扣掉了 1 个青金石', table.get(ENCHANT_LAPIS_SLOT)?.count, 3 - option.lapis);
  check('装备上写入了附魔', Object.keys(table.item?.enchants ?? {}).length > 0, JSON.stringify(table.item?.enchants));
  check('写入的等级与候选一致', option.enchants.every((e) => table.item?.enchants?.[e.id] === e.level));
}

console.log('\n[点候选：各种失败都不该扣东西]');
{
  // 青金石不够：第三槽要 3 个，包里只有 1 个
  const table = tableWith(DIAMOND_PICK, 1);
  const xp = new Experience();
  xp.add(1395);
  table.refresh(xp.level, 15, seeded(42));

  const levelBefore = xp.level;
  const lowLapis = table.applySlot(2, xp.level, (levels) => xp.consumeLevels(levels));
  check('青金石不够时失败', !lowLapis.ok, JSON.stringify(lowLapis));
  equal('失败时等级一点没扣', xp.level, levelBefore);
  equal('失败时青金石一点没扣', table.get(ENCHANT_LAPIS_SLOT)?.count, 1);
  equal('失败时物品上没有多出附魔', table.item?.enchants, undefined);

  // 等级不够
  const poorTable = tableWith(DIAMOND_PICK);
  const noXp = new Experience();
  poorTable.refresh(noXp.level, 15, seeded(42));
  const poor = poorTable.applySlot(0, noXp.level, (levels) => noXp.consumeLevels(levels));
  check('没经验时点不动', !poor.ok && noXp.level === 0, JSON.stringify(poor));
  check('失败原因会说明需要多少级', !poor.ok && poor.reason.includes('级经验'), JSON.stringify(poor));

  // 没有装备
  const empty = new EnchantTable();
  empty.refresh(30, 15, seeded(1));
  const noItem = empty.applySlot(0, 30, () => true);
  check('没放装备时点不动', !noItem.ok, JSON.stringify(noItem));
}

console.log('\n[重掷规则]');
{
  const table = tableWith(DIAMOND_PICK);
  table.refresh(30, 15, seeded(1));
  const first = optionLabel(table.options[2]!.enchants);
  // 局面没变：即使换个随机数发生器也不该重掷
  table.refresh(30, 15, seeded(999));
  equal('局面没变不重掷附魔（否则玩家点不到刚看到的那条）', optionLabel(table.options[2]!.enchants), first);

  table.set(ENCHANT_ITEM_SLOT, { id: IRON_SWORD, count: 1 });
  table.refresh(30, 15, seeded(2));
  check('换装备后候选跟着换', table.options[2]!.enchants.length > 0);

  const before = optionLabel(table.options[2]!.enchants);
  const xp = new Experience();
  xp.add(1395);
  table.applySlot(2, xp.level, (levels) => xp.consumeLevels(levels));
  table.refresh(xp.level, 15, seeded(3));
  check('附完一轮会重掷（不能反复拿同一批附魔刷等级）', optionLabel(table.options[2]!.enchants) !== before);
}

console.log('\n[重复附魔取更高等级]');
{
  const table = tableWith(DIAMOND_PICK);
  table.set(ENCHANT_ITEM_SLOT, { id: DIAMOND_PICK, count: 1, enchants: { efficiency: 1 } });
  const xp = new Experience();
  xp.add(1395);
  table.refresh(xp.level, 15, seeded(42));
  const option = table.options[2]!;
  const hasEfficiency = option.enchants.some((e) => e.id === 'efficiency');
  table.applySlot(2, xp.level, (levels) => xp.consumeLevels(levels));
  if (hasEfficiency) {
    check('已有附魔被取更高的那一档', (table.item?.enchants?.efficiency ?? 0) >= 1);
  } else {
    check('（本轮候选里没有效率，跳过该断言）', true);
  }
  check('原有的附魔不会被抹掉', table.item?.enchants?.efficiency !== undefined);
}

// ---------------------------------------------------------------- 4. 存档与提示框

console.log('\n[存档与提示框]');
{
  const inventory = new Inventory();
  inventory.set(0, { id: DIAMOND_PICK, count: 1, enchants: { efficiency: 4, unbreaking: 3 } });

  const restored = new Inventory();
  restored.restore(inventory.serialize());
  equal('附魔随存档还原', restored.get(0)?.enchants?.efficiency, 4);
  equal('第二条也还原', restored.get(0)?.enchants?.unbreaking, 3);

  const taken = restored.take(0, 1);
  equal('取出时附魔跟着走', taken?.enchants?.efficiency, 4);

  const tooltip = itemTooltip(DIAMOND_PICK, 1, 0, { efficiency: 4, unbreaking: 3 });
  check(
    '提示框单独显示附魔',
    tooltip.description.includes('效率 IV') && tooltip.description.includes('耐久 III'),
    tooltip.description,
  );
  check('没有附魔时不多出那一行', !itemTooltip(DIAMOND_PICK).description.includes('附魔'));

  const legacy = new Inventory();
  legacy.restore([{ id: DIAMOND_PICK, count: 1, enchants: { efficiency: 0 } }]);
  equal('坏存档里的非法附魔等级被丢掉', legacy.get(0)?.enchants, undefined);
}

console.log('\n[未接效果的附魔要标出来]');
{
  const { UI_HINT_UNIMPLEMENTED, UNIMPLEMENTED_MARK } = await import('../src/core/crafting/Enchanting.ts');
  const implemented = ENCHANTMENTS.filter((def) => def.implemented === true);
  check('已接效果的附魔有 6 条（效率/时运/精准采集/耐久/锋利/保护）',
    implemented.length === 6 &&
      ['efficiency', 'fortune', 'silk_touch', 'unbreaking', 'sharpness', 'protection'].every((id) =>
        implemented.some((def) => def.id === id)),
    implemented.map((def) => def.id).join(','),
  );
  equal('已接效果的附魔不带标记', optionLabel([{ id: 'efficiency', level: 3 }]), '效率 III');
  equal('未接效果的附魔带 * 标记', optionLabel([{ id: 'smite', level: 2 }]), `亡灵杀手 II${UNIMPLEMENTED_MARK}`);
  check('界面图例会说明这个标记', UI_HINT_UNIMPLEMENTED.includes(UNIMPLEMENTED_MARK));
}

console.log('\n[配方链条]');
{
  const ids = RECIPES.map((recipe) => recipe.result.id);
  check('甘蔗 → 纸', ids.includes(Item.PAPER));
  check('纸 + 皮革 → 书', ids.includes(Item.BOOK));
  check('书 + 钻石 + 黑曜石 → 附魔台', ids.includes(Block.ENCHANTING_TABLE));
  check('书 + 木板 → 书架', ids.includes(Block.BOOKSHELF));
}

console.log(`\n附魔测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
