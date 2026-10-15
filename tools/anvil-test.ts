/**
 * 铁砧离线测试（H8）
 *
 * 覆盖六块：
 *  1. 累积惩罚：`2 × 旧值 + 1` 的序列，以及"惩罚高到一定程度就修不动了"
 *  2. 重命名：固定 1 级、名字没变不算、空名字不算
 *  3. 材料修复：每单位修 25% 耐久上限、每单位 1 级；石工具用圆石（不是石头）
 *  4. 合并同种装备：耐久相加 + 12% 奖励、附魔取更高、同级升一级
 *  5. 附魔书：把书上的附魔并到装备上，代价按附魔的稀有度（权重）算
 *  6. 容器：产物由左右两格算出来、取产物才扣等级与材料、失败一点都不扣
 *
 * 运行：npm run test:anvil
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import { armorItemId } from '../src/core/registry/armor.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import {
  COMBINE_COST,
  MAX_ANVIL_COST,
  RENAME_COST,
  anvilHint,
  combineOnAnvil,
  enchantCostOnAnvil,
  maxDurabilityOf,
  nextRepairCost,
  repairMaterialOf,
} from '../src/core/crafting/Anvil.ts';
import { ANVIL_LEFT, ANVIL_RESULT, ANVIL_RIGHT, Anvil } from '../src/core/container/Anvil.ts';
import { Inventory, type ItemStack } from '../src/core/container/Inventory.ts';
import { Experience } from '../src/core/survival/Experience.ts';
import { itemTooltip } from '../src/core/registry/itemNames.ts';
import { enchantmentById } from '../src/core/registry/enchantments.ts';
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

const PICK = toolItemId('pickaxe', 'diamond');
const PICK_MAX = maxDurabilityOf(PICK);
const SWORD = toolItemId('sword', 'iron');

/** 造一格物品 */
function stack(id: number, extra: Partial<ItemStack> = {}): ItemStack {
  return { id, count: 1, ...extra };
}

// ---------------------------------------------------------------- 1. 累积惩罚

console.log('\n[累积惩罚]');
equal('第一次用铁砧后的惩罚是 1', nextRepairCost(0), 1);
equal('第二次是 3', nextRepairCost(1), 3);
check('序列是 1 / 3 / 7 / 15 / 31（原版 `2 × 旧值 + 1`）', [0, 1, 3, 7, 15].map(nextRepairCost).join(',') === '1,3,7,15,31');
equal('负数与非法值按 0 处理', nextRepairCost(-5), 1);
equal('小数被抹平成整数', nextRepairCost(1.9), 3);

// ---------------------------------------------------------------- 2. 重命名

console.log('\n[重命名]');
{
  const outcome = combineOnAnvil(stack(PICK), null, '我的镐子');
  check('只改名也能出结果', outcome !== null);
  equal('改名固定 1 级', outcome?.cost, RENAME_COST);
  equal('名字写进了产物', outcome?.output.name, '我的镐子');
  equal('改名不消耗右格，所以左格物品本身不动', outcome?.output.id, PICK);
  equal('产物带着新的累积惩罚', outcome?.output.repairCost, 1);

  equal('名字与原名一样（没填）→ 没有结果', combineOnAnvil(stack(PICK), null, ''), null);
  equal('名字两边都是空白 → 没有结果', combineOnAnvil(stack(PICK), null, '   '), null);
  check('已经叫这个名字了就不再算一次改名', combineOnAnvil(stack(PICK, { name: '我的镐子' }), null, '我的镐子') === null);
}

// ---------------------------------------------------------------- 3. 材料修复

console.log('\n[修复材料]');
equal('钻石镐用钻石修', repairMaterialOf(PICK), Item.DIAMOND);
equal('铁剑用铁锭修', repairMaterialOf(SWORD), Item.IRON_INGOT);
equal('石镐用圆石修（不是石头）', repairMaterialOf(toolItemId('pickaxe', 'stone')), Block.COBBLESTONE);
equal('木镐用木板修', repairMaterialOf(toolItemId('pickaxe', 'wooden')), Block.OAK_PLANKS);
equal('皮革头盔用皮革修', repairMaterialOf(armorItemId('helmet', 'leather')), Item.LEATHER);
equal('锁链胸甲用铁锭修', repairMaterialOf(armorItemId('chestplate', 'chainmail')), Item.IRON_INGOT);
equal('钻石胸甲用钻石修', repairMaterialOf(armorItemId('chestplate', 'diamond')), Item.DIAMOND);
equal('普通方块没有修复材料', repairMaterialOf(Block.STONE), undefined);

console.log('\n[材料修复的代价与效果]');
{
  const perUnit = Math.floor(PICK_MAX * 0.25);
  const damaged = stack(PICK, { damage: PICK_MAX });
  const outcome = combineOnAnvil(damaged, stack(Item.DIAMOND, { count: 3 }), '');
  check('3 个钻石能修 3 次', outcome !== null);
  equal('修 3 次花 3 级', outcome?.cost, 3);
  equal(`每个材料修 ${perUnit} 点耐久`, outcome?.output.damage, PICK_MAX - perUnit * 3);
  equal('修复不会动左格的耐久（产出的是新物品）', damaged.damage, PICK_MAX);
  equal('修复不会消耗掉名字', outcome?.output.name, undefined);

  // 耐久缺口小于一个材料的修复量时，只花 1 级
  const almost = stack(PICK, { damage: 1 });
  equal('只坏 1 点也只花 1 级', combineOnAnvil(almost, stack(Item.DIAMOND, { count: 5 }), '')?.cost, 1);
  equal('而且直接修满（damage 字段被清掉）', combineOnAnvil(almost, stack(Item.DIAMOND, { count: 5 }), '')?.output.damage, undefined);

  equal('拿错材料（铁锭修钻石镐）→ 没有结果', combineOnAnvil(stack(PICK, { damage: 10 }), stack(Item.IRON_INGOT), ''), null);
  equal('崭新的工具拿去修 → 没有结果', combineOnAnvil(stack(PICK), stack(Item.DIAMOND, { count: 3 }), ''), null);
}

// ---------------------------------------------------------------- 4. 合并同种装备

console.log('\n[合并两件同种装备]');
{
  // 左边还剩 500 点耐久、右边是一把用废了的（0 点）
  const a = stack(PICK, { damage: PICK_MAX - 500 });
  const b = stack(PICK, { damage: PICK_MAX });
  const outcome = combineOnAnvil(a, b, '');
  check('两把一样的镐能合并', outcome !== null);
  // 剩余 500 + 0，再送 12% 的上限
  const repaired = 500 + Math.floor(PICK_MAX * 0.12);
  equal('耐久相加再送 12%', PICK_MAX - (outcome?.output.damage ?? 0), repaired);
  equal(`固定 ${COMBINE_COST} 级`, outcome?.cost, COMBINE_COST);

  // 耐久不会超过上限
  const full = combineOnAnvil(stack(PICK, { damage: 10 }), stack(PICK, { damage: 10 }), '');
  equal('加起来超过上限时封顶（damage 清空）', full?.output.damage, undefined);

  console.log('\n[合并时的附魔规则]');
  const enchA = combineOnAnvil(stack(PICK, { enchants: { efficiency: 3 } }), stack(PICK, { enchants: { fortune: 2 } }), '');
  equal('两条不同的附魔都保留', Object.keys(enchA?.output.enchants ?? {}).sort().join(','), 'efficiency,fortune');
  equal('效率 3 保持 3', enchA?.output.enchants?.efficiency, 3);
  // 只有**从右边并过来**的附魔才计代价：左边的效率本来就是它的，不算钱；
  // 右边的时运（权重 2 → 倍率 4）Ⅱ 级 = 8 点
  equal('附魔的代价只算"从右边并过来"的那些（时运权重 2 → 4×2=8）', enchA?.cost, COMBINE_COST + 8);

  const same = combineOnAnvil(stack(PICK, { enchants: { efficiency: 3 } }), stack(PICK, { enchants: { efficiency: 3 } }), '');
  equal('同级附魔合成后升一级（3 → 4）', same?.output.enchants?.efficiency, 4);

  const higher = combineOnAnvil(stack(PICK, { enchants: { efficiency: 2 } }), stack(PICK, { enchants: { efficiency: 4 } }), '');
  equal('不同级取更高的那个', higher?.output.enchants?.efficiency, 4);

  const maxed = combineOnAnvil(
    stack(PICK, { enchants: { efficiency: 5 } }),
    stack(PICK, { enchants: { efficiency: 5 } }),
    '',
  );
  equal('已经满级（效率 5）时不再往上加', maxed?.output.enchants?.efficiency, 5);
}

console.log('\n[附魔的代价按权重算]');
{
  equal('效率（权重 10）I 级 1 点', enchantCostOnAnvil(enchantmentById('efficiency')!, 1), 1);
  equal('耐久（权重 5）I 级 2 点', enchantCostOnAnvil(enchantmentById('unbreaking')!, 1), 2);
  equal('时运（权重 2）I 级 4 点', enchantCostOnAnvil(enchantmentById('fortune')!, 1), 4);
  equal('精准采集（权重 1）I 级 8 点', enchantCostOnAnvil(enchantmentById('silk_touch')!, 1), 8);
}

// ---------------------------------------------------------------- 5. 附魔书

console.log('\n[附魔书]');
{
  const book = stack(Item.BOOK, { enchants: { efficiency: 3 } });
  const outcome = combineOnAnvil(stack(PICK), book, '');
  check('书上的附魔能并到装备上', outcome !== null);
  equal('装备拿到了效率 3', outcome?.output.enchants?.efficiency, 3);
  equal('代价 = 附魔代价（效率 1×3）', outcome?.cost, 3);
  equal('合出来的还是那把镐，不是书', outcome?.output.id, PICK);

  const two = stack(Item.BOOK, { enchants: { efficiency: 2, unbreaking: 3 } });
  const both = combineOnAnvil(stack(PICK), two, '');
  equal('一本书带两条附魔也一起并过来', Object.keys(both?.output.enchants ?? {}).sort().join(','), 'efficiency,unbreaking');

  // 书上全是"已经更高"的附魔 → 什么都不会变 → 没有结果
  const worse = combineOnAnvil(stack(PICK, { enchants: { efficiency: 5 } }), stack(Item.BOOK, { enchants: { efficiency: 2 } }), '');
  equal('书上的附魔更低时没有任何变化', worse, null);

  // 白书（没附魔）
  equal('没有附魔的书合不出东西', combineOnAnvil(stack(PICK), stack(Item.BOOK), ''), null);
}

// ---------------------------------------------------------------- 6. 上限与无意义组合

console.log('\n[上限与无意义组合]');
{
  equal('上限是原版的 40 级', MAX_ANVIL_COST, 40);
  // 惩罚 31 的物品再改名：1 + 31 = 32，还没到 40
  check('惩罚很高但还没爆表时仍可用', combineOnAnvil(stack(PICK, { repairCost: 31 }), null, '名字') !== null);
  equal('惩罚 39 + 改名 1 = 40，刚好卡在上限（原版是"≥40 就过于昂贵"）', combineOnAnvil(stack(PICK, { repairCost: 39 }), null, '名字')?.cost, 40);
  equal('惩罚 40 就已经修不动了', combineOnAnvil(stack(PICK, { repairCost: 40 }), null, '名字'), null);
  check('两件高惩罚物品合并也会爆表（31+31=62 远超 40）', combineOnAnvil(stack(PICK, { repairCost: 31 }), stack(PICK, { repairCost: 31 }), '') === null);

  equal('左边是空的 → 没有结果', combineOnAnvil(null, stack(Item.DIAMOND), '名字'), null);
  equal('什么都没放 → 没有结果', combineOnAnvil(null, null, ''), null);
  equal('放一块石头什么也做不了', combineOnAnvil(stack(Block.STONE), null, ''), null);
  equal('石头 + 石头合不出东西（没有耐久）', combineOnAnvil(stack(Block.STONE), stack(Block.STONE), ''), null);
  equal('镐 + 剑（两者无法组合）→ 没有结果', combineOnAnvil(stack(PICK), stack(SWORD), ''), null);

  check('提示文案会说明"要放东西"', anvilHint(null, null, '').includes('放入'));
  check('提示文案会说明"右格或改名"', anvilHint(stack(PICK), null, '').includes('右侧'));
  check('可行时提示写明需要多少级', anvilHint(stack(PICK, { damage: 100 }), stack(Item.DIAMOND, { count: 1 }), '').includes('级'));
  // 完好物品配修复材料：要说"不需要修"，而不是含糊的"过于昂贵"
  check(
    '完好的物品配修复材料 → 提示"不需要修复"',
    anvilHint(stack(PICK), stack(Item.DIAMOND, { count: 1 }), '').includes('不需要修复'),
    anvilHint(stack(PICK), stack(Item.DIAMOND, { count: 1 }), ''),
  );
  check(
    '惩罚爆表时提示"过于昂贵"',
    anvilHint(stack(PICK, { repairCost: 40 }), null, '名字').includes('过于昂贵'),
    anvilHint(stack(PICK, { repairCost: 40 }), null, '名字'),
  );
  check(
    '同名时提示"名字没有变化"',
    anvilHint(stack(PICK, { name: '甲' }), null, '甲').includes('没有变化'),
    anvilHint(stack(PICK, { name: '甲' }), null, '甲'),
  );
}

// ---------------------------------------------------------------- 7. 容器

console.log('\n[容器：产物由两格算出来]');
{
  const anvil = new Anvil();
  equal('初始没有产物', anvil.get(ANVIL_RESULT), null);

  anvil.set(ANVIL_LEFT, stack(PICK, { damage: PICK_MAX }));
  equal('只放左格时产物还是空的（没材料也没改名）', anvil.get(ANVIL_RESULT), null);

  anvil.set(ANVIL_RIGHT, stack(Item.DIAMOND, { count: 2 }));
  check('放上材料后自动算出产物', anvil.get(ANVIL_RESULT) !== null);
  equal('产物是修过的镐', anvil.get(ANVIL_RESULT)?.id, PICK);
  equal('代价 2 级', anvil.outcome?.cost, 2);

  anvil.setName('挖矿专用');
  equal('改名字后代价多 1 级', anvil.outcome?.cost, 3);
  equal('产物带上了新名字', anvil.get(ANVIL_RESULT)?.name, '挖矿专用');

  anvil.set(ANVIL_RIGHT, null);
  equal('拿掉材料后只剩改名，代价回到 1 级', anvil.outcome?.cost, 1);
  anvil.setName('');
  equal('名字也清掉后就没有产物了', anvil.get(ANVIL_RESULT), null);
}

console.log('\n[容器：取产物才扣等级与材料]');
{
  const anvil = new Anvil();
  const xp = new Experience();
  xp.add(1395); // 30 级
  anvil.set(ANVIL_LEFT, stack(Item.DIAMOND, { count: 3 }));
  anvil.set(ANVIL_RIGHT, stack(Item.IRON_INGOT, { count: 1 }));
  void anvil.left;
  void anvil.right;

  // 换成一次合法操作：钻石镐 + 1 个钻石
  anvil.set(ANVIL_LEFT, stack(PICK, { damage: PICK_MAX }));
  anvil.set(ANVIL_RIGHT, stack(Item.DIAMOND, { count: 1 }));
  const before = xp.level;
  const result = anvil.take(xp.level, (levels) => xp.consumeLevels(levels));
  check('取产物成功', result.ok, result.ok ? '' : result.reason);
  equal('扣了 1 级', xp.level, before - 1);
  equal('材料 -1', anvil.get(ANVIL_RIGHT), null);
  equal('左格物品被消耗', anvil.get(ANVIL_LEFT), null);
  check('产物给出的是修过的镐', result.ok && result.output.id === PICK);
  equal('取走后产物槽空了（前提是输入也没了）', anvil.get(ANVIL_RESULT), null);
}

console.log('\n[容器：失败一点都不扣]');
{
  const anvil = new Anvil();
  const xp = new Experience(); // 0 级
  anvil.set(ANVIL_LEFT, stack(PICK, { damage: PICK_MAX }));
  anvil.set(ANVIL_RIGHT, stack(Item.DIAMOND, { count: 2 }));

  const result = anvil.take(xp.level, (levels) => xp.consumeLevels(levels));
  check('等级不够时取不走', !result.ok, JSON.stringify(result));
  check('失败原因是"需要 N 级经验"', !result.ok && result.reason.includes('级经验'));
  equal('等级没被扣（本来就是 0）', xp.level, 0);
  equal('材料一点没少', anvil.get(ANVIL_RIGHT)?.count, 2);
  check('左格物品也还在', anvil.get(ANVIL_LEFT) !== null);
  check('产物还在（可以等有经验了再取）', anvil.get(ANVIL_RESULT) !== null);

  // 什么都没有时也没有结果
  const empty = new Anvil();
  check('空铁砧取不出东西', !empty.take(30, () => true).ok);
}

// ---------------------------------------------------------------- 8. 存档与提示框

console.log('\n[存档与提示框]');
{
  const inventory = new Inventory();
  inventory.set(0, { id: PICK, count: 1, damage: 40, name: '挖矿专用', repairCost: 3, enchants: { efficiency: 4 } });

  const restored = new Inventory();
  restored.restore(inventory.serialize());
  equal('名字随存档还原', restored.get(0)?.name, '挖矿专用');
  equal('累积惩罚随存档还原', restored.get(0)?.repairCost, 3);
  equal('附魔也还在', restored.get(0)?.enchants?.efficiency, 4);

  const taken = restored.take(0, 1);
  equal('取出时名字跟着走', taken?.name, '挖矿专用');
  equal('取出时惩罚跟着走', taken?.repairCost, 3);

  const tooltip = itemTooltip(PICK, 1, 40, { efficiency: 4 }, '挖矿专用');
  equal('提示框用改过的名字当标题', tooltip.title, '挖矿专用');
  check('副标题里保留原名', tooltip.subtitle.includes('钻石镐'), tooltip.subtitle);
  equal('没改过名字时标题就是物品名', itemTooltip(PICK).title, '钻石镐');

  const legacy = new Inventory();
  legacy.restore([{ id: PICK, count: 1, name: '', repairCost: -3 }]);
  equal('坏存档里的空名字被丢掉', legacy.get(0)?.name, undefined);
  equal('坏存档里的负惩罚被丢掉', legacy.get(0)?.repairCost, undefined);
}

// ---------------------------------------------------------------- 9. 配方链条

console.log('\n[配方链条]');
{
  const anvilRecipe = RECIPES.find((recipe) => recipe.result.id === Block.ANVIL);
  check('有铁砧的配方', anvilRecipe !== undefined);
  check('铁砧配方要铁块与铁锭', anvilRecipe?.kind === 'shaped' && Object.values(anvilRecipe.key).includes(Block.IRON_BLOCK));
  const toBlock = RECIPES.find((recipe) => recipe.result.id === Block.IRON_BLOCK);
  check('9 铁锭 → 铁块', toBlock?.result.count === 1);
  const toIngot = RECIPES.find((recipe) => recipe.result.id === Item.IRON_INGOT && recipe.kind === 'shapeless');
  check('铁块 → 9 铁锭（能拆回来，不然铁块是单向陷阱）', toIngot?.result.count === 9);
}

console.log(`\n铁砧测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
