/**
 * 工具、武器与采集等级离线测试（B9 / B10 / G4 / J6）
 *
 * 覆盖四块：
 *  1. 注册表：25 种工具（5 种类 × 5 材质）都注册了、id 连续、图标/中文名齐全、不可堆叠
 *  2. 属性表：等级 / 速度 / 耐久 / 攻击伤害与原版一致（金工具是"快但等级低"的那个特例）
 *  3. 采集等级 G4：等级不够挖得动但一无所获；徒手能采的方块不受影响
 *  4. 挖掘耗时公式 + 工具耐久在背包里的存取 + 提示框显示耐久
 *
 * 运行：npm run test:tool
 */

import { Block, slabId } from '../src/core/registry/blocks.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  Item,
  durabilityOf,
  itemDef,
  maxStackOf,
} from '../src/core/registry/items.ts';
import { itemLabel, itemTooltip } from '../src/core/registry/itemNames.ts';
import { offeringFor } from '../src/core/crafting/Enchanting.ts';
import { efficientToolType, harvestRequirement, toolInfoById } from '../src/core/registry/tools.ts';
import { Block, woolId } from '../src/core/registry/blocks.ts';
import {
  TOOL_ITEM_START,
  TOOL_KINDS,
  TOOL_MATERIALS,
  TOOL_SPECS,
  breakSeconds,
  canHarvest,
  efficientToolType,
  harvestRequirement,
  makeToolInfo,
  toolInfoById,
  toolItemId,
} from '../src/core/registry/tools.ts';
import { itemLabel, itemTooltip } from '../src/core/registry/itemNames.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { recipesForResult } from '../src/core/crafting/RecipeBook.ts';
import { Inventory } from '../src/core/container/Inventory.ts';

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

/** 浮点近似比较（破坏耗时这类除法结果） */
function close(label: string, actual: number, expected: number, epsilon = 1e-9): void {
  check(label, Math.abs(actual - expected) <= epsilon, `实际 ${actual}，期望 ${expected}`);
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

const WOOD_PICK = makeToolInfo('pickaxe', 'wooden');
const STONE_PICK = makeToolInfo('pickaxe', 'stone');
const IRON_PICK = makeToolInfo('pickaxe', 'iron');
const DIAMOND_PICK = makeToolInfo('pickaxe', 'diamond');
const IRON_AXE = makeToolInfo('axe', 'iron');
const IRON_SHOVEL = makeToolInfo('shovel', 'iron');

// ---------------------------------------------------------------- 1. 注册表

console.log('\n[工具注册表]');
equal('工具数量（5 种类 × 5 材质）', TOOL_SPECS.length, TOOL_KINDS.length * TOOL_MATERIALS.length);
equal('工具总数 25', TOOL_SPECS.length, 25);
check(
  'id 从 TOOL_ITEM_START 起连续',
  TOOL_SPECS.every((spec, index) => spec.id === TOOL_ITEM_START + index),
);
check(
  '每个工具都注册进了物品表，且属性一致',
  TOOL_SPECS.every((spec) => itemDef(spec.id)?.tool === spec.tool && toolInfoById(spec.id)?.tier === spec.tool.tier),
);
check(
  '工具不可堆叠（每件一叠，耐久才是"这一件"的）',
  TOOL_SPECS.every((spec) => maxStackOf(spec.id) === 1),
);
const TILES: readonly string[] = TILE_ORDER;
check(
  '每个工具的图标都在图集名单里',
  TOOL_SPECS.every((spec) => TILES.includes(spec.tile)),
  TOOL_SPECS.filter((spec) => !TILES.includes(spec.tile))
    .map((spec) => spec.tile)
    .join(' '),
);
check('图集贴图无重名', new Set(TILE_ORDER).size === TILE_ORDER.length);
check(
  '每个工具都有中文名（没有回退成英文 id）',
  TOOL_SPECS.every((spec) => {
    const label = itemLabel(spec.id);
    return label !== spec.name.replace('minecraft:', '');
  }),
  TOOL_SPECS.filter((spec) => itemLabel(spec.id) === spec.name.replace('minecraft:', ''))
    .map((spec) => spec.name)
    .join(' '),
);

// ---------------------------------------------------------------- 2. 属性表

console.log('\n[属性表]');
equal('木镐等级', WOOD_PICK.tier, 0);
equal('木镐速度', WOOD_PICK.speed, 2);
equal('木镐耐久', WOOD_PICK.durability, 59);
equal('木镐攻击伤害', WOOD_PICK.attack, 2);
equal('石镐等级', STONE_PICK.tier, 1);
equal('铁镐等级', IRON_PICK.tier, 2);
equal('钻石镐等级', DIAMOND_PICK.tier, 3);
equal('钻石镐耐久', DIAMOND_PICK.durability, 1561);
equal('钻石镐攻击伤害', DIAMOND_PICK.attack, 5);
const GOLD_PICK = makeToolInfo('pickaxe', 'golden');
equal('金镐等级只有 0（金工具是"快但挖不动高等级矿"的特例）', GOLD_PICK.tier, 0);
check('金镐速度最快', GOLD_PICK.speed > DIAMOND_PICK.speed);
equal('金镐耐久最低', GOLD_PICK.durability, 32);
equal('铁剑攻击伤害', makeToolInfo('sword', 'iron').attack, 6);
equal('钻石剑攻击伤害', makeToolInfo('sword', 'diamond').attack, 7);
check('斧的单次伤害高于同材质剑', makeToolInfo('axe', 'iron').attack > makeToolInfo('sword', 'iron').attack);
equal('锄的伤害等同徒手', makeToolInfo('hoe', 'diamond').attack, 1);

// ---------------------------------------------------------------- 3. 采集等级（G4）

console.log('\n[采集等级 G4]');
check('徒手挖石头：挖得动但一无所获', !canHarvest(Block.STONE, null));
check('木镐能采石头', canHarvest(Block.STONE, WOOD_PICK));
check('木镐挖不动铁矿（原版要石镐）', !canHarvest(Block.IRON_ORE, WOOD_PICK));
check('石镐能采铁矿', canHarvest(Block.IRON_ORE, STONE_PICK));
check('石镐挖不动钻石矿（原版要铁镐）', !canHarvest(Block.DIAMOND_ORE, STONE_PICK));
check('铁镐能采钻石矿', canHarvest(Block.DIAMOND_ORE, IRON_PICK));
check('深层钻石矿同样要铁镐', canHarvest(Block.DEEPSLATE_DIAMOND_ORE, IRON_PICK));
check('金镐等级低，挖不动钻石矿', !canHarvest(Block.DIAMOND_ORE, GOLD_PICK));
check('铁镐挖不动黑曜石（要钻石镐）', !canHarvest(Block.OBSIDIAN, IRON_PICK));
check('钻石镐能采黑曜石', canHarvest(Block.OBSIDIAN, DIAMOND_PICK));
check('远古残骸要钻石镐', !canHarvest(Block.ANCIENT_DEBRIS, IRON_PICK) && canHarvest(Block.ANCIENT_DEBRIS, DIAMOND_PICK));
check('斧头不能代替镐挖石头', !canHarvest(Block.STONE, IRON_AXE));
check('徒手能采泥土', canHarvest(Block.DIRT, null));
check('徒手能采原木', canHarvest(Block.OAK_LOG, null));
check('徒手能采玻璃', canHarvest(Block.GLASS, null));
// slabId(0) 是石头台阶（SHAPED_PARENTS 第 0 项就是石头）
check('台阶跟随母方块：石头台阶也要镐', !canHarvest(slabId(0), null) && canHarvest(slabId(0), WOOD_PICK));
equal('石头需要镐', harvestRequirement(Block.STONE)?.tool, 'pickaxe');
equal('泥土没有工具要求', harvestRequirement(Block.DIRT), undefined);
equal('木头的加速工具是斧', efficientToolType(Block.OAK_LOG), 'axe');
equal('石头的加速工具是镐', efficientToolType(Block.STONE), 'pickaxe');

// ---------------------------------------------------------------- 4. 挖掘耗时

console.log('\n[挖掘耗时]');
equal('石头徒手 7.5 秒', breakSeconds(Block.STONE, null), 7.5);
equal('石头 + 木镐 1.125 秒', breakSeconds(Block.STONE, WOOD_PICK), 1.125);
equal('石头 + 钻石镐 0.28125 秒', breakSeconds(Block.STONE, DIAMOND_PICK), 0.28125);
equal('黑曜石徒手 250 秒', breakSeconds(Block.OBSIDIAN, null), 250);
equal('黑曜石 + 钻石镐 9.375 秒', breakSeconds(Block.OBSIDIAN, DIAMOND_PICK), 9.375);
equal('泥土徒手 0.75 秒', breakSeconds(Block.DIRT, null), 0.75);
equal('泥土 + 铁锹 0.125 秒', breakSeconds(Block.DIRT, IRON_SHOVEL), 0.125);
equal('原木 + 铁斧 0.5 秒', breakSeconds(Block.OAK_LOG, IRON_AXE), 0.5);
check('不匹配的工具不加速（铁镐挖泥土仍是徒手速度）', breakSeconds(Block.DIRT, IRON_PICK) === breakSeconds(Block.DIRT, null));
check('基岩永远挖不动', !Number.isFinite(breakSeconds(Block.BEDROCK, DIAMOND_PICK)));
equal('硬度 0 的植物瞬间破坏', breakSeconds(Block.SHORT_GRASS, null), 0);

// ---------------------------------------------------------------- 5. 耐久与背包

console.log('\n[工具耐久]');
{
  const inventory = new Inventory();
  const id = toolItemId('pickaxe', 'diamond');
  inventory.add(id, 1);
  equal('工具占用 1 格', inventory.get(0)?.id, id);
  equal('新工具没有 damage 字段', inventory.get(0)?.damage, undefined);

  inventory.set(0, { id, count: 1, damage: 7 });
  const serialized = inventory.serialize();
  equal('存档保留已损耗耐久', serialized[0]?.damage, 7);

  const restored = new Inventory();
  restored.restore(serialized);
  equal('读档还原耐久', restored.get(0)?.damage, 7);

  const taken = restored.take(0, 1);
  equal('取出时耐久跟着走', taken?.damage, 7);
  equal('取走后槽位清空', restored.get(0), null);

  // 旧存档没有 damage 字段：不该凭空多出一个 damage
  const legacy = new Inventory();
  legacy.restore([{ id, count: 1 }]);
  equal('旧存档工具视为崭新', legacy.get(0)?.damage, undefined);

  const tooltip = itemTooltip(id, 1, 7);
  check('提示框显示剩余耐久', tooltip.description.includes('1554/1561'), tooltip.description);
}

// ---------------------------------------------------------------- 6. 配方

console.log('\n[工具配方]');
{
  const toolRecipes = RECIPES.filter((recipe) => TOOL_SPECS.some((spec) => spec.id === recipe.result.id));
  equal('25 条工具配方', toolRecipes.length, TOOL_SPECS.length);
  check(
    '每个工具都能被配方表查到（配方书能一键合成）',
    TOOL_SPECS.every((spec) => recipesForResult(spec.id).length > 0),
  );

  /** 构造 size×size 网格 */
  const grid = (size: 2 | 3, rows: readonly string[], legend: Record<string, number>): number[] => {
    const cells = new Array<number>(size * size).fill(0);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r]!.length; c++) {
        const ch = rows[r]![c]!;
        if (ch === '·') continue;
        cells[r * size + c] = legend[ch] ?? 0;
      }
    }
    return cells;
  };

  const woodPickId = toolItemId('pickaxe', 'wooden');
  const diamondSwordId = toolItemId('sword', 'diamond');
  const stoneAxeId = toolItemId('axe', 'stone');

  equal(
    '3 木板 + 2 木棍（镐形）→ 木镐',
    matchRecipe(grid(3, ['PPP', '·S·', '·S·'], { P: Block.OAK_PLANKS, S: Item.STICK }), 3)?.id,
    woodPickId,
  );
  equal(
    '钻石剑（2 钻石竖排 + 木棍）',
    matchRecipe(grid(3, ['D··', 'D··', 'S··'], { D: Item.DIAMOND, S: Item.STICK }), 3)?.id,
    diamondSwordId,
  );
  equal(
    '石斧（斧头的斜角摆法）',
    matchRecipe(grid(3, ['·CC', '·CS', '··S'], { C: Block.COBBLESTONE, S: Item.STICK }), 3)?.id,
    stoneAxeId,
  );
}

console.log('\n[剪刀（J8）]');
{
  equal('剪刀的耐久是原版的 238', toolInfoById(Item.SHEARS)?.durability, 238);
  equal('剪刀的加速倍率是 15（原版）', toolInfoById(Item.SHEARS)?.speed, 15);
  equal('剪刀的种类是 shears', toolInfoById(Item.SHEARS)?.type, 'shears');
  equal('剪刀不是"5 种类 × 5 材质"的成员（工具表仍是 25 件）', TOOL_SPECS.length, 25);
  equal('剪刀每件一叠', maxStackOf(Item.SHEARS), 1);
  equal('剪刀也算耐用品（走统一入口）', durabilityOf(Item.SHEARS), 238);

  // 加速与采集：羊毛拿剪刀最快，剪刀挖不动石头
  equal('羊毛的加速工具是剪刀', efficientToolType(woolId(0)), 'shears');
  close('徒手拆羊毛 1.2 秒（原版）', breakSeconds(woolId(0), null), 1.2);
  const shears = toolInfoById(Item.SHEARS)!;
  close('剪刀拆羊毛 0.08 秒（原版）', breakSeconds(woolId(0), shears), 0.08);
  check('剪刀挖石头挖不动（不是镐）', !canHarvest(Block.STONE, shears));
  check('剪刀也不需要采集等级（羊毛不设等级门槛）', harvestRequirement(woolId(0)) === undefined);

  // 附魔：剪刀在原版可以附效率/精准采集/耐久
  const shearsEnchants = offeringFor('shears').map((def) => def.id);
  check('剪刀能附效率', shearsEnchants.includes('efficiency'));
  check('剪刀能附精准采集', shearsEnchants.includes('silk_touch'));
  check('剪刀能附耐久', shearsEnchants.includes('unbreaking'));
  check('剪刀附不到锋利', !shearsEnchants.includes('sharpness'));

  // 中文名与说明
  equal('剪刀叫"剪刀"', itemLabel(Item.SHEARS), '剪刀');
  check('说明里写了"不剪就没有"', itemTooltip(Item.SHEARS).description.includes('不剪就没有'), itemTooltip(Item.SHEARS).description);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
process.exit(failed === 0 ? 0 : 1);
