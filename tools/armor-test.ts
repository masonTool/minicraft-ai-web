/**
 * 盔甲、护甲值与减伤离线测试（I3）
 *
 * 覆盖五块：
 *  1. 注册表：20 件（4 部位 × 5 材质）都注册了、id 连续、图标/中文名齐全、不可堆叠
 *  2. 属性表：护甲值 / 韧性 / 耐久与原版一致（钻石的韧性是唯一的非零项）
 *  3. 减伤公式：低伤害接近"每点 4%"、高伤害被压到"护甲值 × 0.2"的保底线
 *  4. 无视护甲的伤害类型（摔落/溺水/饿死/虚空/窒息/中毒）
 *  5. 装备与耐久：部位校验、受击扣耐久、耐久归零消失、存档往返
 *
 * 运行：npm run test:armor
 */

import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import {
  ALL_ARMOR_MATERIALS,
  ARMOR_ITEM_START,
  ARMOR_MATERIALS,
  ARMOR_SLOT_BASE,
  ARMOR_SLOT_COUNT,
  ARMOR_SPECS,
  ARMOR_TYPES,
  NETHERITE_ARMOR_ITEM_START,
  armorInfoById,
  armorItemId,
  armorSlotAccepts,
  armorWearPerHit,
  createArmorWearer,
  damageAfterArmor,
  equippedArmor,
  makeArmorInfo,
  totalDefense,
  totalToughness,
} from '../src/core/registry/armor.ts';
import { itemDef, maxStackOf } from '../src/core/registry/items.ts';
import { itemLabel, itemTooltip } from '../src/core/registry/itemNames.ts';
import { PlayerStats, type DamageCause } from '../src/core/survival/PlayerStats.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { recipesForResult } from '../src/core/crafting/RecipeBook.ts';
import { Inventory } from '../src/core/container/Inventory.ts';
import { Item } from '../src/core/registry/items.ts';
import { Block } from '../src/core/registry/blocks.ts';

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

function close(label: string, actual: number, expected: number, epsilon = 1e-9): void {
  check(label, Math.abs(actual - expected) <= epsilon, `实际 ${actual}，期望 ${expected}`);
}

/** 给背包穿上一整套某材质的盔甲 */
function equipSet(inventory: Inventory, material: (typeof ARMOR_MATERIALS)[number]): void {
  for (const type of ARMOR_TYPES) {
    inventory.set(ARMOR_SLOT_BASE + ARMOR_TYPES.indexOf(type), { id: armorItemId(type, material), count: 1 });
  }
}

// ---------------------------------------------------------------- 1. 注册表

console.log('\n[盔甲注册表]');
// 24 件 = 可合成的 20（4 部位 × 5 材质）+ 下界合金 4（只能由锻造台升级）
equal('盔甲数量（4 部位 × 6 材质）', ARMOR_SPECS.length, ARMOR_TYPES.length * ALL_ARMOR_MATERIALS.length);
equal('盔甲总数 24', ARMOR_SPECS.length, 24);
check(
  '可合成的 20 件 id 从 ARMOR_ITEM_START 起连续',
  ARMOR_TYPES.flatMap((type) => ARMOR_MATERIALS.map((material) => armorItemId(type, material))).every(
    (id, index) => id === ARMOR_ITEM_START + index,
  ),
);
check(
  '下界合金 4 件从 NETHERITE_ARMOR_ITEM_START 起连续（单独一段，不动老 id）',
  ARMOR_TYPES.every((type, index) => armorItemId(type, 'netherite') === NETHERITE_ARMOR_ITEM_START + index),
);
check(
  '每件盔甲都注册进了物品表，且属性一致',
  ARMOR_SPECS.every(
    (spec) => itemDef(spec.id)?.armor === spec.armor && armorInfoById(spec.id)?.defense === spec.armor.defense,
  ),
);
check('盔甲不可堆叠', ARMOR_SPECS.every((spec) => maxStackOf(spec.id) === 1));
const TILES: readonly string[] = TILE_ORDER;
check(
  '每件盔甲的图标都在图集名单里',
  ARMOR_SPECS.every((spec) => TILES.includes(spec.tile)),
  ARMOR_SPECS.filter((spec) => !TILES.includes(spec.tile))
    .map((spec) => spec.tile)
    .join(' '),
);
check(
  '每件盔甲都有中文名（没有回退成英文 id）',
  ARMOR_SPECS.every((spec) => itemLabel(spec.id) !== spec.name.replace('minicraft:', '')),
);
equal('铁头盔的中文名', itemLabel(armorItemId('helmet', 'iron')), '铁头盔');
equal('钻石靴子的中文名', itemLabel(armorItemId('boots', 'diamond')), '钻石靴子');
check(
  '盔甲与工具用的是不同的 id 区间（不会互相覆盖）',
  ARMOR_SPECS.every((spec) => spec.id >= ARMOR_ITEM_START),
);

// ---------------------------------------------------------------- 2. 属性表

console.log('\n[属性表]');
const leatherHelmet = makeArmorInfo('helmet', 'leather');
const ironChest = makeArmorInfo('chestplate', 'iron');
const diamondChest = makeArmorInfo('chestplate', 'diamond');

equal('皮革头盔护甲值 1', leatherHelmet.defense, 1);
equal('皮革头盔耐久 55', leatherHelmet.durability, 55);
equal('铁胸甲护甲值 6', ironChest.defense, 6);
equal('铁胸甲耐久 240', ironChest.durability, 240);
equal('钻石胸甲护甲值 8', diamondChest.defense, 8);
equal('钻石胸甲耐久 528', diamondChest.durability, 528);
equal('钻石胸甲韧性 2', diamondChest.toughness, 2);
equal('皮革没有韧性', leatherHelmet.toughness, 0);
equal('头盔部位编号是 0', leatherHelmet.slot, 0);
equal('胸甲部位编号是 1', ironChest.slot, 1);
equal('护腿部位编号是 2', makeArmorInfo('leggings', 'iron').slot, 2);
equal('靴子部位编号是 3', makeArmorInfo('boots', 'iron').slot, 3);

// 满套护甲值：原版是钻石 20 点为上限
const fullSets: Record<string, number> = {};
for (const material of ARMOR_MATERIALS) {
  fullSets[material] = totalDefense(ARMOR_TYPES.map((type) => makeArmorInfo(type, material)));
}
equal('皮革满套 7 点', fullSets.leather, 7);
equal('锁链满套 12 点', fullSets.chainmail, 12);
equal('铁满套 15 点', fullSets.iron, 15);
equal('金满套 11 点', fullSets.golden, 11);
equal('钻石满套 20 点（刚好等于原版护甲上限）', fullSets.diamond, 20);
equal(
  '只有钻石有韧性，满套 8 点',
  totalToughness(ARMOR_TYPES.map((type) => makeArmorInfo(type, 'diamond'))),
  8,
);

// ---------------------------------------------------------------- 3. 减伤公式

console.log('\n[减伤公式]');
// 低伤害（1 点）：g = 20×0.2 = 4 是保底，实际用 20 - 1/2.5 = 19.6 → 1 × (1 - 19.6/25) = 0.216
close('钻石满套挡 1 点伤害（剩 0.216）', damageAfterArmor(1, 20, 8), 1 * (1 - (20 - 1 / 4) / 25));
close('铁满套挡 10 点伤害（剩 6）', damageAfterArmor(10, 15, 0), 6);
close('钻石满套挡 20 点伤害（剩 8）', damageAfterArmor(20, 20, 8), 8);
// 保底线：伤害极大时 g 落到 护甲值 × 0.2
close('伤害极大时减伤落到保底线（护甲值 ×0.2）', damageAfterArmor(1000, 20, 8), 1000 * (1 - 4 / 25));
check('护甲越高减伤越多', damageAfterArmor(10, 20, 0) < damageAfterArmor(10, 10, 0));
check('韧性让高伤害的减伤更多（韧性 8 比韧性 0 掉血少）', damageAfterArmor(30, 20, 8) < damageAfterArmor(30, 20, 0));
// 伤害再大也不会低于"护甲值 × 0.2"这条保底线，于是两种韧性最终收敛到同一个数
check(
  '伤害大到触底后，韧性不再改变结果（两边都压到保底线）',
  damageAfterArmor(1000, 20, 0) === damageAfterArmor(1000, 20, 8),
);
equal('没穿盔甲时伤害原样通过', damageAfterArmor(7, 0, 0), 7);
equal('0 伤害仍是 0', damageAfterArmor(0, 20, 8), 0);

console.log('\n[盔甲耐久损耗]');
equal('10 点伤害 → 每件掉 2 点耐久', armorWearPerHit(10), 2);
equal('1 点伤害也至少掉 1 点', armorWearPerHit(1), 1);
equal('0 点伤害不掉耐久', armorWearPerHit(0), 0);

// ---------------------------------------------------------------- 4. 无视护甲的伤害

console.log('\n[无视护甲的伤害类型]');
const bypassing: DamageCause[] = ['fall', 'drown', 'starve', 'void', 'suffocate', 'poison', 'wither'];
{
  const inventory = new Inventory();
  equipSet(inventory, 'diamond');
  const wearer = createArmorWearer(inventory);
  for (const cause of bypassing) {
    equal(`${cause} 无视护甲`, wearer.absorb(10, cause), 10);
  }
  check('生物攻击（generic）会被减伤', wearer.absorb(10, 'generic') < 10);
  check('岩浆会被减伤', wearer.absorb(10, 'lava') < 10);
  check('仙人掌会被减伤', wearer.absorb(10, 'cactus') < 10);
}

// ---------------------------------------------------------------- 5. 装备与耐久

console.log('\n[部位校验]');
equal('头盔位（36）只吃头盔', armorSlotAccepts(ARMOR_SLOT_BASE + 0, armorItemId('helmet', 'iron')), true);
equal('头盔位不吃胸甲', armorSlotAccepts(ARMOR_SLOT_BASE + 0, armorItemId('chestplate', 'iron')), false);
equal('靴子位（39）吃靴子', armorSlotAccepts(ARMOR_SLOT_BASE + 3, armorItemId('boots', 'iron')), true);
equal('头盔位不吃石头', armorSlotAccepts(ARMOR_SLOT_BASE + 0, Block.STONE), false);
equal('普通背包槽不限物品', armorSlotAccepts(12, Block.STONE), true);
equal('副手槽不限物品', armorSlotAccepts(ARMOR_SLOT_BASE + ARMOR_SLOT_COUNT, Block.STONE), true);

console.log('\n[装备读取]');
{
  const inventory = new Inventory();
  equal('空背包的护甲值是 0', totalDefense(equippedArmor(inventory)), 0);
  // 放错部位的盔甲在背包里也不该被算作"穿上了"
  inventory.set(ARMOR_SLOT_BASE + 0, { id: armorItemId('boots', 'diamond'), count: 1 });
  equal('靴子放在头盔位不算装备', totalDefense(equippedArmor(inventory)), 0);

  inventory.clear();
  equipSet(inventory, 'iron');
  equal('铁满套护甲值 15', totalDefense(equippedArmor(inventory)), 15);
  equal('护甲提供者读到的点数一致', createArmorWearer(inventory).points, 15);
}

console.log('\n[自动拾取不进装备槽]');
{
  const inventory = new Inventory();
  for (let i = 0; i < 36; i++) inventory.set(i, { id: Block.STONE, count: 64 });
  const leftover = inventory.add(armorItemId('helmet', 'iron'), 1);
  equal('背包塞满时盔甲捡不进来（而不是凭空穿到 36 号槽）', leftover, 1);
  equal('36 号槽仍然是空的', inventory.get(ARMOR_SLOT_BASE), null);
}

console.log('\n[受击扣耐久]');
{
  const inventory = new Inventory();
  equipSet(inventory, 'iron');
  const wearer = createArmorWearer(inventory);
  const reduced = wearer.absorb(10, 'generic');
  close('铁满套挡 10 点伤害（剩 6）', reduced, 6);
  check(
    '四件盔甲各掉 2 点耐久',
    ARMOR_TYPES.every((_, slot) => inventory.get(ARMOR_SLOT_BASE + slot)?.damage === 2),
    ARMOR_TYPES.map((_, slot) => inventory.get(ARMOR_SLOT_BASE + slot)?.damage).join(','),
  );

  // 耐久被打光：整件消失（而不是留在槽里当摆设）
  inventory.set(ARMOR_SLOT_BASE + 0, { id: armorItemId('helmet', 'iron'), count: 1, damage: 164 });
  wearer.absorb(10, 'generic');
  equal('头盔耐久耗尽后整件消失', inventory.get(ARMOR_SLOT_BASE), null);

  // 摔落不掉耐久
  const before = inventory.get(ARMOR_SLOT_BASE + 3)?.damage ?? 0;
  wearer.absorb(20, 'fall');
  equal('摔落不进盔甲耐久结算', inventory.get(ARMOR_SLOT_BASE + 3)?.damage, before);
}

console.log('\n[生存系统接线]');
{
  const inventory = new Inventory();
  equipSet(inventory, 'iron');
  const stats = new PlayerStats();
  equal('没注入护甲时 armPoints 是 0', stats.armorPoints, 0);
  stats.armor = createArmorWearer(inventory);
  equal('注入后读得到护甲值', stats.armorPoints, 15);

  const result = stats.damage(10, 'generic');
  close('PlayerStats 结算后的伤害是减伤后的 6', result.applied, 6);
  equal('生命值按减伤后的数字扣', stats.health, 14);

  // 无敌帧内的第二次伤害应该被挡下（与护甲无关）
  const blocked = stats.damage(4, 'generic');
  equal('无敌帧内不再受伤', blocked.applied, 0);
}

console.log('\n[存档往返]');
{
  const inventory = new Inventory();
  inventory.set(ARMOR_SLOT_BASE + 2, { id: armorItemId('leggings', 'diamond'), count: 1, damage: 40 });
  const restored = new Inventory();
  restored.restore(inventory.serialize());
  equal('读档还原盔甲耐久', restored.get(ARMOR_SLOT_BASE + 2)?.damage, 40);
  const tooltip = itemTooltip(armorItemId('leggings', 'diamond'), 1, 40);
  // 批次 28：耐久与附魔从 `description` 里拆成了结构化字段（界面各自一行）
  check('提示框显示盔甲耐久', tooltip.durability.includes('455/495'), tooltip.durability);
  check('耐久受损时带一条耐久条', tooltip.durabilityBar !== null, JSON.stringify(tooltip.durabilityBar));
}

// ---------------------------------------------------------------- 6. 配方

console.log('\n[盔甲配方]');
{
  const armorRecipes = RECIPES.filter((recipe) => ARMOR_SPECS.some((spec) => spec.id === recipe.result.id));
  const craftable = ARMOR_SPECS.filter(
    (spec) => spec.armor.material !== 'chainmail' && spec.armor.material !== 'netherite',
  );
  equal('可合成的盔甲 16 件（4 部位 × 4 材质）', craftable.length, 16);
  equal('16 条盔甲配方', armorRecipes.length, craftable.length);
  check(
    '下界合金盔甲没有配方（只能由锻造台把钻石盔甲升上去）',
    ARMOR_SPECS.filter((spec) => spec.armor.material === 'netherite').every(
      (spec) => recipesForResult(spec.id).length === 0,
    ),
  );
  check(
    '锁链甲故意没有配方（与原版一致：材料与图案都和铁甲完全相同，写了必然撞车）',
    ARMOR_SPECS.filter((spec) => spec.armor.material === 'chainmail').every(
      (spec) => recipesForResult(spec.id).length === 0,
    ),
  );
  check(
    '每一件可合成的盔甲都能被配方表查到（配方书能一键合成）',
    craftable.every((spec) => recipesForResult(spec.id).length > 0),
  );

  const grid = (size: 3, rows: readonly string[], legend: Record<string, number>): number[] => {
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

  const I = { I: Item.IRON_INGOT };
  equal(
    '5 铁锭（头形）→ 铁头盔',
    matchRecipe(grid(3, ['III', 'I·I'], I), 3)?.id,
    armorItemId('helmet', 'iron'),
  );
  equal(
    '8 铁锭（胸甲形）→ 铁胸甲',
    matchRecipe(grid(3, ['I·I', 'III', 'III'], I), 3)?.id,
    armorItemId('chestplate', 'iron'),
  );
  equal(
    '7 铁锭（护腿形）→ 铁护腿',
    matchRecipe(grid(3, ['III', 'I·I', 'I·I'], I), 3)?.id,
    armorItemId('leggings', 'iron'),
  );
  equal('4 铁锭（靴形）→ 铁靴子', matchRecipe(grid(3, ['I·I', 'I·I'], I), 3)?.id, armorItemId('boots', 'iron'));
  equal(
    '4 皮革（靴形）→ 皮革靴子',
    matchRecipe(grid(3, ['L·L', 'L·L'], { L: Item.LEATHER }), 3)?.id,
    armorItemId('boots', 'leather'),
  );
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
