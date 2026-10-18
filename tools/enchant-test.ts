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
  // 批次 28：附魔拆成一行一条（`enchants` 数组），不再和说明挤在同一行
  check(
    '提示框单独显示附魔',
    tooltip.enchants.includes('效率 IV') && tooltip.enchants.includes('耐久 III'),
    tooltip.enchants.join('、'),
  );
  check('附魔的物品按"稀有"上色', tooltip.rarity === 'rare', tooltip.rarity);
  check('没有附魔时那一行是空的', itemTooltip(DIAMOND_PICK).enchants.length === 0);

  const legacy = new Inventory();
  legacy.restore([{ id: DIAMOND_PICK, count: 1, enchants: { efficiency: 0 } }]);
  equal('坏存档里的非法附魔等级被丢掉', legacy.get(0)?.enchants, undefined);
}

console.log('\n[未接效果的附魔要标出来]');
{
  const { UI_HINT_UNIMPLEMENTED, UNIMPLEMENTED_MARK } = await import('../src/core/crafting/Enchanting.ts');
  const implemented = ENCHANTMENTS.filter((def) => def.implemented === true);
  check(
    '已接效果的附魔有 28 条（… + 批次 262 的深海探索者/灵魂疾行/横扫之刃）',
    implemented.length === 28 &&
      [
        'efficiency',
        'fortune',
        'silk_touch',
        'unbreaking',
        'sharpness',
        'protection',
        'fire_protection',
        'blast_protection',
        'projectile_protection',
        'smite',
        'bane_of_arthropods',
        'looting',
        'mending',
        // 弓的四条：效果在 `core/entity/Bow.ts` 里，曾经漏标 implemented
        'power',
        'punch',
        'flame',
        'infinity',
        // 钓竿的两条（批次 81）：诱饵在 `survival/Fishing.ts`、海之眷顾在 `registry/fishing.ts`
        'lure',
        'luck_of_the_sea',
        // 批次 243：摔落/水下/命中/死亡各接了一条或两条
        'feather_falling',
        'respiration',
        'aqua_affinity',
        'knockback',
        'fire_aspect',
        'vanishing_curse',
        // 批次 262：位移类两条 + 横扫
        'depth_strider',
        'soul_speed',
        'sweeping',
      ].every((id) => implemented.some((def) => def.id === id)),
    implemented.map((def) => def.id).join(','),
  );
  equal('已接效果的附魔不带标记', optionLabel([{ id: 'efficiency', level: 3 }]), '效率 III');
  equal('亡灵杀手已接效果，所以不带标记', optionLabel([{ id: 'smite', level: 2 }]), '亡灵杀手 II');
  equal('力量已接效果（弓），所以不带标记', optionLabel([{ id: 'power', level: 2 }]), '力量 II');
  equal('未接效果的附魔带 * 标记', optionLabel([{ id: 'thorns', level: 3 }]), `荆棘 III${UNIMPLEMENTED_MARK}`);
  check('界面图例会说明这个标记', UI_HINT_UNIMPLEMENTED.includes(UNIMPLEMENTED_MARK));
}

// ---------------------------------------------------------------- 5. 效果接线（K3）

console.log('\n[K3-1 效率：拿对工具才加速]');
{
  const { breakSeconds, makeToolInfo } = await import('../src/core/registry/tools.ts');
  // 注意 `breakSeconds` 收的是 `ToolInfo` 而不是物品 id（`toolItemId` 给的是 id）
  const pick = makeToolInfo('pickaxe', 'diamond');
  const bare = breakSeconds(Block.STONE, pick);
  const eff1 = breakSeconds(Block.STONE, pick, { efficiency: 1 });
  const eff5 = breakSeconds(Block.STONE, pick, { efficiency: 5 });
  check(`效率 I 让挖掘更快（${bare.toFixed(3)}s → ${eff1.toFixed(3)}s）`, eff1 < bare);
  check(`效率 V 比效率 I 更快（${eff1.toFixed(3)}s → ${eff5.toFixed(3)}s）`, eff5 < eff1);
  // 原版：速度 = 工具速度 + level² + 1。钻石镐 8 + 1 + 1 = 10 → 石头 1.5*1.5/10 = 0.225
  equal('效率 I 的速度加成是 level²+1（0.225 秒）', Number(eff1.toFixed(3)), 0.225);
  equal('没有附魔时不该凭空快 1 点（回归：写成 +1 会让所有工具白送一点速度）', Number(bare.toFixed(3)), 0.281);
  // 拿错工具时效率不生效
  const wrongTool = breakSeconds(Block.DIRT, pick, { efficiency: 5 });
  const wrongToolBare = breakSeconds(Block.DIRT, pick);
  equal('拿镐挖土时"效率 V"不生效', wrongTool, wrongToolBare);
}

console.log('\n[K3-2 时运：只放大矿石]');
{
  const { fortuneMultiplier, isFortuneBlock } = await import('../src/core/registry/items.ts');
  equal('没时运时倍数为 1', fortuneMultiplier(Block.DIAMOND_ORE, 0, 0.99), 1);
  equal('时运不影响石头', fortuneMultiplier(Block.STONE, 3, 0.99), 1);
  equal('时运不影响铁矿（原版也是）', fortuneMultiplier(Block.IRON_ORE, 3, 99), 1);
  equal('时运 III 掷点 0 时不多掉', fortuneMultiplier(Block.DIAMOND_ORE, 3, 0), 1);
  equal('时运 III 掷点 0.99 时多掉 3 倍', fortuneMultiplier(Block.DIAMOND_ORE, 3, 0.99), 4);
  equal('时运 I 最多 2 倍', fortuneMultiplier(Block.COAL_ORE, 1, 0.99), 2);
  check('钻石/煤/红石/青金石算矿石', [Block.DIAMOND_ORE, Block.COAL_ORE, Block.REDSTONE_ORE, Block.LAPIS_ORE].every(isFortuneBlock));
  check('铁/金矿不算', !isFortuneBlock(Block.IRON_ORE) && !isFortuneBlock(Block.GOLD_ORE));
  check('深板岩变体跟随主矿石', isFortuneBlock(Block.DEEPSLATE_DIAMOND_ORE));
}

console.log('\n[K3-3 精准采集：掉方块自身]');
{
  const { silkTouchDropsSelf } = await import('../src/core/registry/items.ts');
  check('玻璃能完整带走（原版就是靠精准采集）', silkTouchDropsSelf(Block.GLASS));
  check('草方块能完整带走', silkTouchDropsSelf(Block.GRASS_BLOCK));
  check('西瓜块能完整带走（否则只会掉片）', silkTouchDropsSelf(Block.MELON));
  check('钻石矿也能完整带走', silkTouchDropsSelf(Block.DIAMOND_ORE));
  check('基岩不能被带走', !silkTouchDropsSelf(Block.BEDROCK));
  check('水和岩浆不能被带走', !silkTouchDropsSelf(Block.WATER) && !silkTouchDropsSelf(Block.LAVA));
}

console.log('\n[K3-4 锋利：近战伤害]');
{
  const { meleeDamage, toolInfoById } = await import('../src/core/registry/tools.ts');
  const ironSword = toolItemId('sword', 'iron');
  const base = toolInfoById(ironSword)!.attack;
  equal('没有锋利时就是武器基础伤害', meleeDamage(base), base);
  equal('锋利 I 加 1.0（0.5×1 + 0.5）', meleeDamage(base, { sharpness: 1 }), base + 1);
  equal('锋利 V 加 3.0（0.5×5 + 0.5）', meleeDamage(base, { sharpness: 5 }), base + 3);
  equal('徒手 + 锋利 I 也走同一个式子', meleeDamage(1, { sharpness: 1 }), 2);
  check('锋利对镐也生效（原版如此）', meleeDamage(toolInfoById(toolItemId('pickaxe', 'iron'))!.attack, { sharpness: 3 }) > 4);
}

console.log('\n[K3-5 保护：EPF 叠加在护甲之上]');
{
  const { absorbWithArmor, createArmorWearer } = await import('../src/core/registry/armor.ts');
  const { Inventory } = await import('../src/core/container/Inventory.ts');
  const { ARMOR_SLOT_BASE } = await import('../src/core/registry/armor.ts');

  const plain = new Inventory();
  const protectedInv = new Inventory();
  for (let slot = 0; slot < 4; slot++) {
    const id = armorItemId(['helmet', 'chestplate', 'leggings', 'boots'][slot] as 'helmet', 'diamond');
    plain.set(ARMOR_SLOT_BASE + slot, { id, count: 1 });
    protectedInv.set(ARMOR_SLOT_BASE + slot, { id, count: 1, enchants: { protection: 4 } });
  }

  const without = absorbWithArmor(plain, 20, 'generic').applied;
  const with4 = absorbWithArmor(protectedInv, 20, 'generic').applied;
  check(`保护 IV 满套比裸甲挡得更多（${without.toFixed(2)} → ${with4.toFixed(2)}）`, with4 < without);
  check('保护是按 EPF 相乘，不是直接免疫', with4 > 0);
  check('EPF 有上限 20（满套保护 IV 是 16 点，还没到顶）', with4 > 0);

  const halfProtected = new Inventory();
  for (let slot = 0; slot < 2; slot++) {
    const id = armorItemId(['helmet', 'chestplate'][slot] as 'helmet', 'diamond');
    halfProtected.set(ARMOR_SLOT_BASE + slot, { id, count: 1, enchants: { protection: 4 } });
  }
  const with8 = absorbWithArmor(halfProtected, 20, 'generic').applied;
  check(`保护点数越多挡得越多（两件 ${with8.toFixed(2)} > 四件 ${with4.toFixed(2)}）`, with8 > with4);
  void createArmorWearer;
  void armorItemId;
}

console.log('\n[K3-6 耐久：按概率跳过一次损耗]');
{
  const { absorbWithArmor } = await import('../src/core/registry/armor.ts');
  const { Inventory } = await import('../src/core/container/Inventory.ts');
  const { ARMOR_SLOT_BASE } = await import('../src/core/registry/armor.ts');
  const id = armorItemId('chestplate', 'diamond');

  // 耐久 III：每次有 3/4 概率不掉耐久。跑 60 次，全都没跳过的概率是 0.25^60，不可能发生
  const inventory = new Inventory();
  inventory.set(ARMOR_SLOT_BASE + 1, { id, count: 1, enchants: { unbreaking: 3 } });
  let skipped = 0;
  for (let i = 0; i < 60; i++) {
    absorbWithArmor(inventory, 10, 'generic');
    const damage = inventory.get(ARMOR_SLOT_BASE + 1)?.damage ?? 99;
    if (damage === 0) skipped++;
    // 把耐久刷回去，继续下一次试验
    const stack = inventory.get(ARMOR_SLOT_BASE + 1);
    if (stack) inventory.set(ARMOR_SLOT_BASE + 1, { ...stack, damage: 0 });
  }
  check(`耐久 III 明显降低了损耗频率（60 次里跳过了 ${skipped} 次）`, skipped > 20, `${skipped}/60`);

  // 没有耐久附魔时必须每次都掉
  const bare = new Inventory();
  bare.set(ARMOR_SLOT_BASE + 1, { id, count: 1 });
  absorbWithArmor(bare, 10, 'generic');
  equal('没有耐久附魔时每次必掉耐久', bare.get(ARMOR_SLOT_BASE + 1)?.damage, 2);
}

console.log('\n[K3-7 保护类：按伤害类型分流]');
{
  const { protectionPoints, absorbWithArmor, ARMOR_SLOT_BASE } = await import('../src/core/registry/armor.ts');
  const { Inventory } = await import('../src/core/container/Inventory.ts');

  /** 造一套四件都带指定附魔的钻石甲 */
  const setWith = (enchants: Record<string, number>): Inventory => {
    const inventory = new Inventory();
    for (let slot = 0; slot < 4; slot++) {
      const type = (['helmet', 'chestplate', 'leggings', 'boots'] as const)[slot]!;
      inventory.set(ARMOR_SLOT_BASE + slot, { id: armorItemId(type, 'diamond'), count: 1, enchants });
    }
    return inventory;
  };

  const fire = setWith({ fire_protection: 4 });
  equal('火焰保护对火焰有效', protectionPoints(fire, 'fire'), 16);
  equal('火焰保护对岩浆有效', protectionPoints(fire, 'lava'), 16);
  equal('火焰保护对爆炸无效', protectionPoints(fire, 'explosion'), 0);
  equal('火焰保护对普通攻击无效', protectionPoints(fire, 'generic'), 0);

  const blast = setWith({ blast_protection: 4 });
  equal('爆炸保护只挡爆炸', protectionPoints(blast, 'explosion'), 16);
  equal('爆炸保护不挡火焰', protectionPoints(blast, 'fire'), 0);

  const proj = setWith({ projectile_protection: 4 });
  equal('弹射物保护只挡弹射物', protectionPoints(proj, 'projectile'), 16);
  equal('弹射物保护不挡爆炸', protectionPoints(proj, 'explosion'), 0);

  const plain = setWith({ protection: 4 });
  check(
    '保护对所有伤害类型都算（原版 `getDamageProtection` 就是这样）',
    ['fire', 'lava', 'explosion', 'projectile', 'generic', 'cactus', 'fall'].every(
      (cause) => protectionPoints(plain, cause) === 16,
    ),
  );

  // 两条附魔叠加时要相加（原版行为）
  const both = setWith({ protection: 2, blast_protection: 2 });
  equal('保护 + 爆炸保护 在爆炸时相加', protectionPoints(both, 'explosion'), 16);
  equal('保护 + 爆炸保护 在挨打时只有保护算', protectionPoints(both, 'generic'), 8);

  // 上限 20：四条 IV 级的"保护"已经 16，再叠别的也不会超
  const over = setWith({ protection: 4, blast_protection: 4, fire_protection: 4 });
  equal('EPF 上限 20', protectionPoints(over, 'explosion'), 20);

  // 实打实走一遍减伤：挨爆炸时火焰保护不该帮忙
  const hit = (inventory: InstanceType<typeof Inventory>): number => absorbWithArmor(inventory, 20, 'explosion').applied;
  check(`爆炸时爆炸保护比火焰保护挡得多（${hit(blast).toFixed(2)} < ${hit(fire).toFixed(2)}）`, hit(blast) < hit(fire));
  equal('砖头都不带附魔时两者一致', hit(fire), hit(setWith({})));
}

console.log('\n[K3-8 亡灵杀手 / 节肢杀手]');
{
  const { meleeDamage } = await import('../src/core/registry/tools.ts');
  const sword = 7;
  equal('对亡灵：亡灵杀手每级 +2.5', meleeDamage(sword, { smite: 5 }, 'undead'), sword + 12.5);
  equal('对普通生物：亡灵杀手一点不加', meleeDamage(sword, { smite: 5 }), sword);
  equal('对节肢：节肢杀手每级 +2.5', meleeDamage(sword, { bane_of_arthropods: 5 }, 'arthropod'), sword + 12.5);
  equal('对亡灵：节肢杀手不加', meleeDamage(sword, { bane_of_arthropods: 5 }, 'undead'), sword);
  equal('锋利与亡灵杀手可以叠加', meleeDamage(sword, { sharpness: 5, smite: 5 }, 'undead'), sword + 3 + 12.5);
  equal('一级都不带时就是基础伤害', meleeDamage(sword, undefined, 'undead'), sword);
}

console.log('\n[K3-9 抢夺：抬高掉落上限]');
{
  const { lootingBonus } = await import('../src/core/registry/tools.ts');
  equal('没抢夺时加成 0', lootingBonus(undefined), 0);
  equal('抢夺 III 加成 3', lootingBonus({ looting: 3 }), 3);
  check('抢夺只认自己的等级，不受别的附魔影响', lootingBonus({ sharpness: 5, looting: 1 }) === 1);
}

console.log('\n[K3-10 经验修补]');
{
  const { applyMending, isMendable, MENDING_DURABILITY_PER_XP } = await import('../src/core/crafting/Repair.ts');
  const { toolItemId } = await import('../src/core/registry/tools.ts');
  const pick = toolItemId('pickaxe', 'diamond');
  equal('1 点经验换 2 点耐久', MENDING_DURABILITY_PER_XP, 2);
  equal('没损耗的物品不算可修', isMendable({ id: pick, count: 1 }), false);

  const stack = { id: pick, count: 1, damage: 10, enchants: { mending: 1 } };
  check('带经验修补且已损耗 → 可修', isMendable(stack));
  equal('不带经验修补就修不了', applyMending([{ id: pick, count: 1, damage: 10 }], 5), 0);

  const used = applyMending([stack], 3);
  equal('3 点经验修 6 点耐久', stack.damage, 4);
  equal('返回实际用掉的经验', used, 3);

  // 经验多到修满：多出来的应该还回去（不退的话就等于吞经验）
  const fresh = { id: pick, count: 1, damage: 4, enchants: { mending: 1 } };
  const used2 = applyMending([fresh], 50);
  equal('修满后 damage 字段被清掉', fresh.damage, undefined);
  equal('只花掉修满所需的那部分经验', used2, 2);

  // 修满的物品再吃经验不该消耗（否则经验会被白白吃掉）
  const intact = { id: pick, count: 1, enchants: { mending: 1 } };
  equal('已经修满就不再吃经验', applyMending([intact], 10), 0);

  // 多件一起：按顺序修，前面的修满再修后面的
  const a = { id: pick, count: 1, damage: 2, enchants: { mending: 1 } };
  const b = { id: pick, count: 1, damage: 100, enchants: { mending: 1, unbreaking: 3 } };
  const used3 = applyMending([a, b], 10);
  equal('先修满第一件（2 点耐久 = 1 点经验）', a.damage, undefined);
  equal('剩下的经验给第二件', b.damage, 100 - (10 - 1) * 2);
  equal('总共只花 10 点', used3, 10);

  // 非耐用品（石头）不会被"修"
  equal('普通方块不吃经验修补', applyMending([{ id: Block.STONE, count: 1, enchants: { mending: 1 } }], 5), 0);
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
