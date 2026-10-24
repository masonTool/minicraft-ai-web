/**
 * 下界合金装备（K8 尾巴）离线测试
 *
 * 覆盖六块：
 *  1. 材料链：远古残骸烧成碎片（熔炼表）→ 4 碎片 + 4 金锭 = 1 锭（无序配方）→ 9 锭 ↔ 1 块
 *  2. 装备本体：5 件工具 + 4 件盔甲，数值逐条对齐原版（等级 4、耐久 2031、
 *     盔甲护甲值与钻石相同但韧性 3、耐久倍率 37）
 *  3. **没有合成配方**：下界合金的工具/盔甲只能由锻造台升级而来
 *  4. 锻造逻辑：钻石 9 件都能升、附魔/耐久损耗/自定义名字/累积惩罚**原样保留**（不修耐久）、
 *     非钻石装备与错的材料一律拒绝、一次只消耗 1 个锭
 *  5. 锻造台容器：两格输入 + 只读产物、取走时扣材料（左格整件 + 右格 1 个）、
 *     走存档往返还在台面上
 *  6. 方块与周边：下界合金块（硬度 50、要钻石镐）、锻造台（要镐）、配方、分类、稀有度
 *
 * 运行：npm run test:netherite
 */

import { Block, blockDef, blockHardness } from '../src/core/registry/blocks.ts';
import { breakSeconds, harvestRequirement, toolItemId } from '../src/core/registry/tools.ts';
import {
  Item,
  MATERIAL_REPAIR_ITEM,
  categoryOf,
  itemDef,
  itemName,
  maxStackOf,
} from '../src/core/registry/items.ts';
import { hasDescription, itemLabel, itemTooltip } from '../src/core/registry/itemNames.ts';
import { rarityOf } from '../src/core/registry/itemVisuals.ts';
import { ARMOR_SPECS, armorItemId, armorInfoById } from '../src/core/registry/armor.ts';
import { TOOL_SPECS, toolInfoById } from '../src/core/registry/tools.ts';
import { SMELTING_RECIPES, smeltingRecipeFor } from '../src/core/crafting/Smelting.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { recipesForResult } from '../src/core/crafting/RecipeBook.ts';
import {
  SMITHING_INGOT_COST,
  combineOnSmithing,
  isNetheriteUpgradable,
  netheriteUpgradeCount,
  netheriteUpgradeOf,
  smithingHint,
} from '../src/core/crafting/Smithing.ts';
import { SMITHING_EQUIPMENT, SMITHING_MATERIAL, SMITHING_RESULT, SMITHING_SIZE, SmithingTable } from '../src/core/container/SmithingTable.ts';
import { SLOT_COUNTS, kindOf, serializeContainer, restoreContainers } from '../src/core/save/ContainerSave.ts';
import { BlockEntityStore } from '../src/core/world/BlockEntityStore.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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

/** 浮点比较（挖掘耗时这类除法结果不能直接用 ===） */
function close(label: string, actual: number, expected: number, epsilon = 1e-6): void {
  check(label, Math.abs(actual - expected) <= epsilon, `实际 ${actual}，期望 ${expected}`);
}

const TILES: readonly string[] = TILE_ORDER;

/** 造一个 size×size 网格（与 crafting-test 同一套写法） */
function grid(size: 2 | 3, rows: readonly string[], legend: Record<string, number>): number[] {
  const cells = new Array<number>(size * size).fill(0);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]!.length; c++) {
      const ch = rows[r]![c]!;
      if (ch === '·') continue;
      cells[r * size + c] = legend[ch] ?? 0;
    }
  }
  return cells;
}

// ---------------------------------------------------------------- 1. 材料链

console.log('\n[材料：远古残骸 → 碎片 → 锭 → 块]');
{
  equal('下界合金碎片已注册', itemDef(Item.NETHERITE_SCRAP) !== undefined, true);
  equal('下界合金锭已注册', itemDef(Item.NETHERITE_INGOT) !== undefined, true);
  equal('碎片的英文 id', itemName(Item.NETHERITE_SCRAP), 'netherite_scrap');
  equal('中文名：下界合金碎片', itemLabel(Item.NETHERITE_SCRAP), '下界合金碎片');
  equal('中文名：下界合金锭', itemLabel(Item.NETHERITE_INGOT), '下界合金锭');
  equal('碎片可堆 64', maxStackOf(Item.NETHERITE_SCRAP), 64);
  equal('锭可堆 64', maxStackOf(Item.NETHERITE_INGOT), 64);
  check('碎片有说明（写明怎么来的）', hasDescription(Item.NETHERITE_SCRAP));
  check('锭有说明（写明怎么合的、怎么做装备）', hasDescription(Item.NETHERITE_INGOT));
  check(
    '两个图标都在图集名单里',
    [Item.NETHERITE_SCRAP, Item.NETHERITE_INGOT].every((id) => TILES.includes(itemDef(id)!.tile)),
  );

  // 熔炼：远古残骸 → 1 碎片，10 秒、2 点经验（原版）
  const smelt = smeltingRecipeFor(Block.ANCIENT_DEBRIS);
  check('远古残骸有熔炼配方', smelt !== undefined);
  equal('烧出来是 1 个碎片', smelt?.output.id, Item.NETHERITE_SCRAP);
  equal('一次 1 个', smelt?.output.count, 1);
  equal('耗时 10 秒', smelt?.time, 10);
  equal('经验 2 点（原版）', smelt?.experience, 2);
  check(
    '熔炼表里只有这一条产出碎片（不会有第二条路）',
    SMELTING_RECIPES.filter((recipe) => recipe.output.id === Item.NETHERITE_SCRAP).length === 1,
  );

  // 合成：4 碎片 + 4 金锭（无序：两种摆法都要能合出来）
  const scrap = Item.NETHERITE_SCRAP;
  const gold = Item.GOLD_INGOT;
  const shapeA = grid(3, ['GGG', 'SG·', 'SSS'], { G: gold, S: scrap }); // 4 金 + 4 碎片
  const shapeB = grid(3, ['SSS', 'GS·', 'GGG'], { G: gold, S: scrap }); // 同样的 4+4，换个摆法
  check(
    '两种摆法都合得出锭（无序配方）',
    matchRecipe(shapeA, 3)?.id === Item.NETHERITE_INGOT && matchRecipe(shapeB, 3)?.id === Item.NETHERITE_INGOT,
  );
  equal('4 碎片 + 4 金锭 → 1 锭', matchRecipe(shapeA, 3)?.count, 1);
  // 3 个碎片合成不出来（配比不能少）
  const tooFew = grid(3, ['GGG', 'GSS', 'S··'], { G: gold, S: scrap }); // 4 金 + 3 碎片
  // ⚠️ `matchRecipe` 匹配不上时返回的是 **null**（不是 undefined）
  equal('碎片不够 4 个时合不出锭', matchRecipe(tooFew, 3), null);

  // 块 ↔ 锭
  const blockGrid = grid(3, ['III', 'III', 'III'], { I: Item.NETHERITE_INGOT });
  equal('9 锭 → 1 个下界合金块', matchRecipe(blockGrid, 3)?.id, Block.NETHERITE_BLOCK);
  equal('1 块 → 9 锭', matchRecipe(grid(2, ['I·', '··'], { I: Block.NETHERITE_BLOCK }), 2)?.count, 9);
}

// ---------------------------------------------------------------- 2. 装备本体

console.log('\n[下界合金工具]');
{
  const netheriteTools = TOOL_SPECS.filter((spec) => spec.tool.material === 'netherite');
  equal('5 件（镐斧锹锄剑）', netheriteTools.length, 5);
  check(
    '每件都注册进了物品表且属性一致',
    netheriteTools.every((spec) => itemDef(spec.id)?.tool === spec.tool),
  );
  check('每件都不可堆叠', netheriteTools.every((spec) => maxStackOf(spec.id) === 1));
  check('图标都在图集名单里', netheriteTools.every((spec) => TILES.includes(spec.tile)));
  check('中文名都是"下界合金…"', netheriteTools.every((spec) => itemLabel(spec.id).startsWith('下界合金')));
  check('都有说明', netheriteTools.every((spec) => hasDescription(spec.id)));

  const pick = toolItemId('pickaxe', 'netherite');
  const info = toolInfoById(pick)!;
  equal('采集等级 4（比钻石高一级）', info.tier, 4);
  equal('挖掘速度 9（原版）', info.speed, 9);
  equal('耐久 2031（原版）', info.durability, 2031);
  equal('镐攻击 6', info.attack, 6);
  equal('剑攻击 8', toolInfoById(toolItemId('sword', 'netherite'))?.attack, 8);
  equal('斧攻击 10', toolInfoById(toolItemId('axe', 'netherite'))?.attack, 10);
  equal('锹攻击 6.5', toolInfoById(toolItemId('shovel', 'netherite'))?.attack, 6.5);
  equal('锄攻击 1', toolInfoById(toolItemId('hoe', 'netherite'))?.attack, 1);

  // 等级 4 意味着黑曜石也挖得动（钻石镐是 3，正好够），且比钻石镐更快。
  // 数值：50 硬度 × 1.5 ÷ 9 = 8.33 秒（钻石镐 50 × 1.5 ÷ 8 = 9.375 秒）
  const netheriteObsidian = breakSeconds(Block.OBSIDIAN, info);
  const diamondObsidian = breakSeconds(Block.OBSIDIAN, toolInfoById(toolItemId('pickaxe', 'diamond')));
  close('下界合金镐挖黑曜石 8.33 秒', netheriteObsidian, 50 * 1.5 / 9);
  check('挖黑曜石比钻石镐更快', netheriteObsidian < diamondObsidian, `${netheriteObsidian} vs ${diamondObsidian}`);
  equal('提示框写明采集等级"下界合金"', itemTooltip(pick, 1, 0).description.includes('下界合金'), true);
  check('提示框里有耐久 2031', itemTooltip(pick, 1, 0).description.includes('2031'));
}

console.log('\n[下界合金盔甲]');
{
  const set = ARMOR_SPECS.filter((spec) => spec.armor.material === 'netherite');
  equal('4 件（头胸腿靴）', set.length, 4);
  check('每件都注册进了物品表', set.every((spec) => itemDef(spec.id)?.armor === spec.armor));
  check('图标都在图集名单里', set.every((spec) => TILES.includes(spec.tile)));
  check('中文名都是"下界合金…"', set.every((spec) => itemLabel(spec.id).startsWith('下界合金')));

  // 护甲值与钻石**完全相同**（原版如此），贵在韧性与耐久
  for (const type of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
    const netherite = armorInfoById(armorItemId(type, 'netherite'))!;
    const diamond = armorInfoById(armorItemId(type, 'diamond'))!;
    equal(`${type} 护甲值与钻石相同`, netherite.defense, diamond.defense);
    equal(`${type} 韧性 3（钻石是 2）`, netherite.toughness, 3);
    check(`${type} 耐久比钻石高`, netherite.durability > diamond.durability);
  }
  equal('整套护甲值 20（与钻石套一样满）', set.reduce((sum, spec) => sum + spec.armor.defense, 0), 20);
  equal('整套韧性 12', set.reduce((sum, spec) => sum + spec.armor.toughness, 0), 12);
  equal('头盔耐久 407', armorInfoById(armorItemId('helmet', 'netherite'))?.durability, 407);
  equal('胸甲耐久 592', armorInfoById(armorItemId('chestplate', 'netherite'))?.durability, 592);
  equal('护腿耐久 555', armorInfoById(armorItemId('leggings', 'netherite'))?.durability, 555);
  equal('靴子耐久 481', armorInfoById(armorItemId('boots', 'netherite'))?.durability, 481);
}

console.log('\n[修复材料与稀有度]');
{
  equal('下界合金装备用下界合金锭修（原版）', MATERIAL_REPAIR_ITEM.netherite, Item.NETHERITE_INGOT);
  check(
    '9 件下界合金装备的修复材料都是下界合金锭',
    [
      ...TOOL_SPECS.filter((spec) => spec.tool.material === 'netherite'),
      ...ARMOR_SPECS.filter((spec) => spec.armor.material === 'netherite'),
    ].every(() => MATERIAL_REPAIR_ITEM['netherite'] === Item.NETHERITE_INGOT),
  );
  // 稀有度：这一族在原版里是"稀有"档（青色名字）
  check(
    '下界合金工具是稀有档',
    TOOL_SPECS.filter((spec) => spec.tool.material === 'netherite').every(
      (spec) => rarityOf(spec.id) === 'rare',
    ),
  );
  check(
    '下界合金盔甲是稀有档',
    ARMOR_SPECS.filter((spec) => spec.armor.material === 'netherite').every(
      (spec) => rarityOf(spec.id) === 'rare',
    ),
  );
  equal('碎片与锭也是稀有档', rarityOf(Item.NETHERITE_SCRAP), 'rare');
  equal('下界合金块也是稀有档', rarityOf(Block.NETHERITE_BLOCK), 'rare');
}

// ---------------------------------------------------------------- 3. 没有合成配方

console.log('\n[没有合成配方：只能锻造]');
{
  const all = [
    ...TOOL_SPECS.filter((spec) => spec.tool.material === 'netherite').map((spec) => spec.id),
    ...ARMOR_SPECS.filter((spec) => spec.armor.material === 'netherite').map((spec) => spec.id),
  ];
  equal('9 件下界合金装备', all.length, 9);
  check(
    '一件都没有工作台配方',
    all.every((id) => recipesForResult(id).length === 0),
    all.filter((id) => recipesForResult(id).length > 0).map(itemName).join(','),
  );
  check(
    '配方表里没有任何一条以它们为产物',
    RECIPES.every((recipe) => !all.includes(recipe.result.id)),
  );
}

// ---------------------------------------------------------------- 4. 锻造逻辑

console.log('\n[锻造：钻石 → 下界合金]');
{
  equal('对照表共 9 条（5 工具 + 4 盔甲）', netheriteUpgradeCount(), 9);

  const ingot = { id: Item.NETHERITE_INGOT, count: 1 };
  for (const kind of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'] as const) {
    equal(`${kind}：钻石 → 下界合金`, netheriteUpgradeOf(toolItemId(kind, 'diamond')), toolItemId(kind, 'netherite'));
  }
  for (const type of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
    equal(`${type}：钻石 → 下界合金`, netheriteUpgradeOf(armorItemId(type, 'diamond')), armorItemId(type, 'netherite'));
  }

  // 一次升级：产物是 1 件、消耗 1 个锭
  const sword = { id: toolItemId('sword', 'diamond'), count: 1, damage: 137 };
  const outcome = combineOnSmithing(sword, ingot);
  check('能算出产物', outcome !== null);
  equal('产物是下界合金剑', outcome?.output.id, toolItemId('sword', 'netherite'));
  equal('产物数量 1', outcome?.output.count, 1);
  equal('消耗 1 个锭', outcome?.cost, SMITHING_INGOT_COST);

  // ⚠️ 最容易被做错的一条：原版**不修耐久**，磨损程度原样带过去
  equal('耐久损耗原样保留（不修满）', outcome?.output.damage, 137);
  const pristine = combineOnSmithing({ id: toolItemId('pickaxe', 'diamond'), count: 1 }, ingot);
  equal('崭新装备升级后依然崭新', pristine?.output.damage, undefined);

  // 附魔、自定义名字、累积惩罚都要带过去
  const enchanted = {
    id: armorItemId('chestplate', 'diamond'),
    count: 1,
    damage: 41,
    enchants: { protection: 4, unbreaking: 3, mending: 1 },
    name: '我的胸甲',
    repairCost: 7,
  };
  const upgraded = combineOnSmithing(enchanted, ingot);
  equal('附魔保留', Object.keys(upgraded?.output.enchants ?? {}).length, 3);
  equal('保护 IV 保留', upgraded?.output.enchants?.protection, 4);
  equal('自定义名字保留', upgraded?.output.name, '我的胸甲');
  equal('累积惩罚保留', upgraded?.output.repairCost, 7);
  check('产物与输入不是同一个对象（不会互相串改）', upgraded?.output !== enchanted);
  check('输入物品没有被改动', enchanted.damage === 41 && enchanted.name === '我的胸甲');

  // 拒绝各种非法输入
  check('非钻石装备（铁镐）拒绝', combineOnSmithing({ id: toolItemId('pickaxe', 'iron'), count: 1 }, ingot) === null);
  check('已经是下界合金的拒绝（不能二次升级）', combineOnSmithing({ id: toolItemId('pickaxe', 'netherite'), count: 1 }, ingot) === null);
  check('剪刀拒绝', combineOnSmithing({ id: Item.SHEARS, count: 1 }, ingot) === null);
  check('材料错了（金锭）拒绝', combineOnSmithing(sword, { id: Item.GOLD_INGOT, count: 64 }) === null);
  check('材料位置放反了拒绝', combineOnSmithing({ id: Item.NETHERITE_INGOT, count: 1 }, sword) === null);
  check('左格空拒绝', combineOnSmithing(null, ingot) === null);
  check('右格空拒绝', combineOnSmithing(sword, null) === null);
  check('isNetheriteUpgradable 对下界合金本身返回 false', !isNetheriteUpgradable(toolItemId('sword', 'netherite')));

  // 提示文案
  equal('空台面的提示', smithingHint(null, null), '左边放装备、右边放下界合金锭');
  equal('只放装备的提示', smithingHint(sword, null), '右格放入下界合金锭');
  check('放铁装备的提示说明"只有钻石"', smithingHint({ id: toolItemId('sword', 'iron'), count: 1 }, ingot).includes('钻石'));
  check('材料放反时提示能指出来', smithingHint(ingot, sword).includes('反'));
}

// ---------------------------------------------------------------- 5. 锻造台容器

console.log('\n[锻造台容器]');
{
  const table = new SmithingTable();
  equal('3 个格子（装备 / 材料 / 产物）', SMITHING_SIZE, 3);
  equal('初始没有产物', table.get(SMITHING_RESULT), null);

  table.set(SMITHING_EQUIPMENT, { id: toolItemId('axe', 'diamond'), count: 1, damage: 12 });
  table.set(SMITHING_MATERIAL, { id: Item.NETHERITE_INGOT, count: 3 });
  check('两格齐了就有产物', table.get(SMITHING_RESULT) !== null);
  equal('产物是下界合金斧', table.get(SMITHING_RESULT)?.id, toolItemId('axe', 'netherite'));
  equal('产物保留耐久损耗', table.get(SMITHING_RESULT)?.damage, 12);

  // 拿错了东西去换材料：产物消失
  table.set(SMITHING_MATERIAL, { id: Item.DIAMOND, count: 3 });
  equal('材料不对时没有产物', table.get(SMITHING_RESULT), null);

  // 换回正确的材料再取走
  table.set(SMITHING_MATERIAL, { id: Item.NETHERITE_INGOT, count: 3 });
  const taken = table.take();
  check('取走成功', taken.ok);
  equal('拿到的是下界合金斧', taken.ok ? taken.output.id : 0, toolItemId('axe', 'netherite'));
  equal('左格被消耗（升级是改造，不是复制）', table.get(SMITHING_EQUIPMENT), null);
  equal('右格只扣 1 个（还剩 2 个）', table.get(SMITHING_MATERIAL)?.count, 2);
  equal('取走后产物槽清空', table.get(SMITHING_RESULT), null);

  // 材料只剩 0 个时整叠消失（不该留下 count=0 的幽灵格）
  const last = new SmithingTable();
  last.set(SMITHING_EQUIPMENT, { id: armorItemId('boots', 'diamond'), count: 1 });
  last.set(SMITHING_MATERIAL, { id: Item.NETHERITE_INGOT, count: 1 });
  check('最后一个锭也能升级', last.take().ok);
  equal('材料格变空（不是 count=0）', last.get(SMITHING_MATERIAL), null);
  equal('空台面再取失败', last.take().ok, false);
}

console.log('\n[锻造台存档往返]');
{
  const store = new BlockEntityStore();
  const table = store.getOrCreateSmithingTable(Dimension.OVERWORLD, 4, 64, 8);
  table.set(SMITHING_EQUIPMENT, {
    id: armorItemId('helmet', 'diamond'),
    count: 1,
    damage: 30,
    enchants: { protection: 2 },
    name: '旧头盔',
  });
  table.set(SMITHING_MATERIAL, { id: Item.NETHERITE_INGOT, count: 5 });

  const data = serializeContainer(table, Dimension.OVERWORLD, 4, 64, 8);
  check('锻造台能被序列化', data !== null);
  equal('存的是 smithing 这一种容器', data?.kind, 'smithing');
  equal('格数按 SMITHING_SIZE 记', data?.stacks.length, SLOT_COUNTS.smithing);

  const target = new BlockEntityStore();
  equal('读档还原了 1 个容器', restoreContainers(target, data ? [data] : []), 1);
  const restored = target.getOrCreateSmithingTable(Dimension.OVERWORLD, 4, 64, 8);
  equal('装备格还在', restored.equipment?.id, armorItemId('helmet', 'diamond'));
  equal('耐久损耗还在', restored.equipment?.damage, 30);
  equal('附魔还在', restored.equipment?.enchants?.protection, 2);
  equal('自定义名字还在', restored.equipment?.name, '旧头盔');
  equal('材料格还在', restored.material?.count, 5);
  check('kindOf 认得锻造台', kindOf(restored) === 'smithing');
  check(
    '空锻造台不写进存档（打开过又空着的台子不该让存档变大）',
    serializeContainer(new SmithingTable(), Dimension.OVERWORLD, 0, 0, 0) === null,
  );
}

// ---------------------------------------------------------------- 6. 方块与周边

console.log('\n[下界合金块与锻造台]');
{
  const blockDefNetherite = blockDef(Block.NETHERITE_BLOCK);
  const blockDefTable = blockDef(Block.SMITHING_TABLE);
  equal('下界合金块的注册名', blockDefNetherite.name, 'minicraft:netherite_block');
  equal('锻造台的注册名', blockDefTable.name, 'minicraft:smithing_table');
  check('两者都是整格方块', blockDefNetherite.shape === 'cube' && blockDefTable.shape === 'cube');
  check(
    '贴图都在图集名单里',
    [...blockDefNetherite.tiles, ...blockDefTable.tiles].every((tile) => TILES.includes(tile)),
  );
  check('中文名都在', itemLabel(Block.NETHERITE_BLOCK) === '下界合金块' && itemLabel(Block.SMITHING_TABLE) === '锻造台');
  equal('下界合金块硬度 50（原版，比黑曜石更硬）', blockHardness(Block.NETHERITE_BLOCK), 50);
  equal('锻造台硬度 2.5（原版）', blockHardness(Block.SMITHING_TABLE), 2.5);
  check('下界合金块要钻石镐（徒手挖要很久）', harvestRequirement(Block.NETHERITE_BLOCK)?.tier === 3);
  check('锻造台要镐但不要等级', harvestRequirement(Block.SMITHING_TABLE)?.tool === 'pickaxe' &&
    harvestRequirement(Block.SMITHING_TABLE)?.tier === 0);
  check('锻造台徒手也能挖动（只是慢）', Number.isFinite(breakSeconds(Block.SMITHING_TABLE)));
  check('下界合金块徒手也能挖动（只是极慢，掉不掉另说）', Number.isFinite(breakSeconds(Block.NETHERITE_BLOCK)));

  // 锻造台的配方：2 铁锭 + 4 木板
  const tableRecipe = grid(3, ['II·', 'PP·', 'PP·'], { I: Item.IRON_INGOT, P: Block.OAK_PLANKS });
  equal('2 铁锭 + 4 木板 → 锻造台', matchRecipe(tableRecipe, 3)?.id, Block.SMITHING_TABLE);
  check('锻造台能查到配方（配方书里有）', recipesForResult(Block.SMITHING_TABLE).length > 0);

  // 分类
  equal('锻造台归在"功能方块"', categoryOf(Block.SMITHING_TABLE), 'functional');
  equal('下界合金块归在"矿石与材料"（与铁块一致）', categoryOf(Block.NETHERITE_BLOCK), 'ores');
  equal('碎片归在"矿石与材料"', categoryOf(Item.NETHERITE_SCRAP), 'ores');
  equal('下界合金工具归在"工具与武器"', categoryOf(toolItemId('sword', 'netherite')), 'tools');
  equal('下界合金盔甲归在"盔甲"', categoryOf(armorItemId('helmet', 'netherite')), 'armor');
  check('下界合金块的方块物品可放置', itemDef(Block.NETHERITE_BLOCK)?.block === Block.NETHERITE_BLOCK);
  check('锻造台可放置', itemDef(Block.SMITHING_TABLE)?.block === Block.SMITHING_TABLE);
  // 物品 id 不和别的撞车（register 会在启动时抛错，这里再挡一道）
  check('碎片/锭的 id 与其他物品不冲突', ITEMS_UNIQUE([Item.NETHERITE_SCRAP, Item.NETHERITE_INGOT]));
}

/** 这几个 id 在注册表里各自只出现一次（防止手滑写成同一个数字） */
function ITEMS_UNIQUE(ids: readonly number[]): boolean {
  return new Set(ids).size === ids.length && ids.every((id) => itemDef(id) !== undefined);
}

/** 远古残骸本身也要还在（整条链的起点） */
console.log('\n[链条起点：远古残骸]');
{
  equal('远古残骸这个方块还在（整条链的起点）', blockDef(Block.ANCIENT_DEBRIS).name, 'minicraft:ancient_debris');
  equal('远古残骸硬度 30（原版）', blockHardness(Block.ANCIENT_DEBRIS), 30);
  check('远古残骸要钻石镐', harvestRequirement(Block.ANCIENT_DEBRIS)?.tier === 3);
  check('远古残骸有说明（写明在哪里挖）', hasDescription(Block.ANCIENT_DEBRIS));
  check('徒手挖远古残骸要 2 分钟以上（原版 150 秒）', breakSeconds(Block.ANCIENT_DEBRIS) > 120);
}

console.log(`\n下界合金测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
