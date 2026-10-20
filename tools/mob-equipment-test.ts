/**
 * 生物个体装备（J27）
 *
 * 只断言纯函数那一半：生成概率、护甲值/减伤、掉落概率、存档清洗；
 * 再加三条源码守卫，确认 `Mob` / `main` 真的接上了，而不是只写了模块没人用。
 *
 * 运行：npm run test:equipment
 */

import { readFileSync } from 'node:fs';
import {
  ARMOR_PIECE_CHANCE,
  EQUIPMENT_DROP_CHANCE,
  applyMobArmor,
  armorTint,
  equipmentDrops,
  mobArmorPoints,
  mobEquipmentKey,
  rollMobEquipment,
  sanitizeMobEquipment,
  weaponKindOf,
  weaponTint,
} from '../src/core/entity/MobEquipment.ts';
import { armorInfoById, armorItemId } from '../src/core/registry/armor.ts';
import { Item } from '../src/core/registry/items.ts';
import { toolItemId } from '../src/core/registry/tools.ts';

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

/** 固定返回同一个值的随机源（用于边界） */
function constant(value: number): () => number {
  return () => value;
}

const IRON_HELMET = armorItemId('helmet', 'iron');
const IRON_CHEST = armorItemId('chestplate', 'iron');
const IRON_LEGS = armorItemId('leggings', 'iron');
const IRON_BOOTS = armorItemId('boots', 'iron');
const IRON_SWORD = toolItemId('sword', 'iron');

console.log('\n[生成：谁会拿到什么]');
{
  const all = rollMobEquipment('zombie', constant(0));
  check('random=0 时四件盔甲全掷中', Boolean(all.head && all.chest && all.legs && all.feet));
  check('四件都是合法的盔甲物品', [all.head, all.chest, all.legs, all.feet].every((id) => armorInfoById(id!) !== undefined));
  check('僵尸约 5% 拿铁剑：random=0 时拿到', all.mainHand === IRON_SWORD, `实际 ${String(all.mainHand)}`);

  const none = rollMobEquipment('zombie', constant(0.99));
  check('random=0.99 时白板（没有盔甲、没有武器）', Object.keys(none).length === 0, JSON.stringify(none));

  const skeleton = rollMobEquipment('skeleton', constant(0.99));
  check('骷髅必带弓（盔甲可以不穿）', skeleton.mainHand === Item.BOW, JSON.stringify(skeleton));

  const piglin = rollMobEquipment('piglin', constant(0.99));
  check('猪灵必带金剑', piglin.mainHand === toolItemId('sword', 'golden'), JSON.stringify(piglin));

  const brute = rollMobEquipment('piglin_brute', constant(0.99));
  check('猪灵蛮兵必带金斧', brute.mainHand === toolItemId('axe', 'golden'), JSON.stringify(brute));

  const plain = rollMobEquipment('cow', constant(0));
  check('牛不穿装备（不是 ARMOR_WEARERS）', Object.keys(plain).length === 0, JSON.stringify(plain));

  const drownedTrident = rollMobEquipment('drowned', constant(0.99), { hasTrident: true });
  check('带三叉戟的溺尸主手是三叉戟', drownedTrident.mainHand === Item.TRIDENT, JSON.stringify(drownedTrident));
  const drownedBare = rollMobEquipment('drowned', constant(0.99), { hasTrident: false });
  check('不带三叉戟的溺尸可以空手', drownedBare.mainHand === undefined, JSON.stringify(drownedBare));
}

console.log('\n[装备部位概率是独立的]');
{
  let withArmor = 0;
  for (let i = 0; i < 4000; i++) {
    const eq = rollMobEquipment('zombie', Math.random);
    if (eq.head) withArmor++;
  }
  const rate = withArmor / 4000;
  check(
    `头盔生成率接近 ${ARMOR_PIECE_CHANCE}（实测 ${(rate * 100).toFixed(1)}%）`,
    Math.abs(rate - ARMOR_PIECE_CHANCE) < 0.03,
  );
}

console.log('\n[护甲值与减伤]');
{
  const iron = { head: IRON_HELMET, chest: IRON_CHEST, legs: IRON_LEGS, feet: IRON_BOOTS };
  check('全铁套护甲值 = 15（原版）', mobArmorPoints(iron) === 15, String(mobArmorPoints(iron)));
  check('白板护甲值 = 0', mobArmorPoints({}) === 0);
  check('全铁套挨 10 点：伤害被压低', applyMobArmor(iron, 10) < 10, String(applyMobArmor(iron, 10)));
  check('白板挨 10 点：原样 10', applyMobArmor({}, 10) === 10);
  check('高伤害时减伤有下限（不是完全免伤）', applyMobArmor(iron, 100) > 0);
  check('0 伤害仍是 0', applyMobArmor(iron, 0) === 0);

  const diamond = {
    head: armorItemId('helmet', 'diamond'),
    chest: armorItemId('chestplate', 'diamond'),
    legs: armorItemId('leggings', 'diamond'),
    feet: armorItemId('boots', 'diamond'),
  };
  check('全钻石套护甲值 = 20', mobArmorPoints(diamond) === 20, String(mobArmorPoints(diamond)));
  check('钻石套比铁套更能扛', applyMobArmor(diamond, 10) < applyMobArmor(iron, 10));
}

console.log('\n[掉落概率]');
{
  const full = { mainHand: IRON_SWORD, head: IRON_HELMET, chest: IRON_CHEST, legs: IRON_LEGS, feet: IRON_BOOTS };
  check('random=0 时五件全掉', equipmentDrops(full, constant(0)).length === 5);
  check('random=0.99 时一件都不掉', equipmentDrops(full, constant(0.99)).length === 0);
  check(
    `基础概率 = ${EQUIPMENT_DROP_CHANCE}`,
    equipmentDrops({ head: IRON_HELMET }, constant(EQUIPMENT_DROP_CHANCE - 0.001)).length === 1 &&
      equipmentDrops({ head: IRON_HELMET }, constant(EQUIPMENT_DROP_CHANCE + 0.001)).length === 0,
  );
  check('抢夺每级 +1%：looting=10 时 0.1 也掉', equipmentDrops({ head: IRON_HELMET }, constant(0.1), 10).length === 1);
  check('白板不掉任何东西', equipmentDrops({}, constant(0)).length === 0);
}

console.log('\n[存档清洗]');
{
  const clean = sanitizeMobEquipment({ head: IRON_HELMET, mainHand: 999999, nope: 1 });
  check('合法装备保留', clean?.head === IRON_HELMET);
  check('不存在的物品 id 丢掉', clean?.mainHand === undefined);
  check('不认识的键丢掉', clean !== undefined && !('nope' in clean));
  check('空对象 → undefined（白板不占存档键）', sanitizeMobEquipment({}) === undefined);
  check('非对象 → undefined', sanitizeMobEquipment('oops') === undefined && sanitizeMobEquipment(null) === undefined);
}

console.log('\n[渲染辅助]');
{
  check('装备指纹随装备变化', mobEquipmentKey({ head: IRON_HELMET }) !== mobEquipmentKey({}));
  check('装备指纹稳定', mobEquipmentKey({ head: IRON_HELMET }) === mobEquipmentKey({ head: IRON_HELMET }));
  check('铁头盔有颜色', armorTint(IRON_HELMET) !== armorTint(armorItemId('helmet', 'diamond')));
  check('铁剑有颜色', weaponTint(IRON_SWORD) !== undefined);
  check('铁剑识别为 sword', weaponKindOf(IRON_SWORD) === 'sword');
  check('弓识别为 bow', weaponKindOf(Item.BOW) === 'bow');
  check('三叉戟识别为 trident', weaponKindOf(Item.TRIDENT) === 'trident');
}

console.log('\n[接线守卫]');
{
  const mobSrc = readFileSync(new URL('../src/core/entity/Mob.ts', import.meta.url), 'utf8');
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('Mob 受击走 applyMobArmor', mobSrc.includes('applyMobArmor(this.equipment, amount)'));
  check('Mob 死亡走 equipmentDrops', mobSrc.includes('equipmentDrops(this.equipment, Math.random, looting)'));
  check('Mob 构造时掷装备', mobSrc.includes('rollMobEquipment(type.id, Math.random'));
  check('main 读档时清洗装备', mainSrc.includes('sanitizeMobEquipment(record.equipment)'));
}

console.log(`\n生物个体装备测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
