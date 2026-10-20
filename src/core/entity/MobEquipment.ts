/**
 * 生物个体装备（J27）
 *
 * 原版里"这只僵尸戴不戴头盔、手里拿不拿剑"是**个体**属性，不是种类属性：
 * 同一批刷出来的僵尸里，有的光着、有的铁头盔 + 铁剑，打死之后按 8.5% 掉装备。
 * 本项目以前只有溺尸的三叉戟做了个体层（`Mob.hasTrident`），其余生物一律白板；
 * 这个模块把"掷什么装备"和"装备怎么影响受击/掉落"收成纯函数，渲染与主程序只消费结果。
 *
 * 三条边界：
 *  1. **只做 1.18 里靠自然生成能出现的搭配**，不给每种生物编一套掉落表；
 *  2. 装备**只影响护甲减伤与掉落**，暂不改攻击伤害（武器伤害另立一批，
 *     否则同一只僵尸的伤害会随难度/随机数漂，现有战斗断言会成片失效）；
 *  3. 环境伤害（摔落/着火/岩浆/爆炸）**不吃护甲**，与玩家那边的 `bypasses_armor` 同口径。
 */

import {
  armorInfoById,
  armorItemId,
  totalDefense,
  totalToughness,
  type ArmorInfo,
} from '../registry/armor.ts';
import { Item, itemDef } from '../registry/items.ts';
import { toolInfoById, toolItemId, type ToolMaterial, type ToolType } from '../registry/tools.ts';

/** 会自然生成的五种盔甲材质（下界合金只靠锻造，不会出现在生物身上） */
type ArmorMaterialName = 'leather' | 'chainmail' | 'iron' | 'golden' | 'diamond';

/** 生物能穿的五个装备位（顺序固定：存档与渲染 key 都按它拼） */
export const MOB_EQUIPMENT_SLOTS = ['mainHand', 'head', 'chest', 'legs', 'feet'] as const;
export type MobEquipmentSlot = (typeof MOB_EQUIPMENT_SLOTS)[number];

/** 一只生物身上的装备；空对象 = 白板（绝大多数自然生成生物都是） */
export interface MobEquipment {
  mainHand?: number;
  head?: number;
  chest?: number;
  legs?: number;
  feet?: number;
}

/** 会穿盔甲的人形生物（原版里这些种类会按难度掷盔甲） */
const ARMOR_WEARERS = new Set([
  'zombie',
  'husk',
  'drowned',
  'zombie_villager',
  'skeleton',
  'stray',
  'wither_skeleton',
  'piglin',
  'piglin_brute',
  'zombified_piglin',
  'vindicator',
  'pillager',
  'evoker',
  'illusioner',
  'vex',
]);

/** 每一件盔甲的独立生成概率（原版普通难度约 15%） */
export const ARMOR_PIECE_CHANCE = 0.15;

/** 盔甲材质与权重：皮革最常见、钻石最稀有（原版 1.18 的生成权重近似） */
const ARMOR_MATERIAL_WEIGHTS: readonly (readonly [ArmorMaterialName, number])[] = [
  ['leather', 40],
  ['chainmail', 25],
  ['iron', 20],
  ['golden', 10],
  ['diamond', 5],
];

const ARMOR_SLOT_TYPES = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
const ARMOR_SLOTS: readonly MobEquipmentSlot[] = ['head', 'chest', 'legs', 'feet'];

/** 一定拿在手里的武器（原版这些种类生成时必带） */
const FIXED_WEAPONS: Readonly<Record<string, number>> = {
  skeleton: Item.BOW,
  stray: Item.BOW,
  illusioner: Item.BOW,
  pillager: Item.CROSSBOW,
  wither_skeleton: toolItemId('sword', 'stone'),
  zombified_piglin: toolItemId('sword', 'golden'),
  piglin: toolItemId('sword', 'golden'),
  piglin_brute: toolItemId('axe', 'golden'),
  vindicator: toolItemId('axe', 'iron'),
  vex: toolItemId('sword', 'iron'),
};

/** 有概率拿的武器（僵尸家族约 5% 拿铁剑；没拿到就空手） */
const OCCASIONAL_WEAPONS: Readonly<Record<string, readonly { id: number; chance: number }[]>> = {
  zombie: [{ id: toolItemId('sword', 'iron'), chance: 0.05 }],
  husk: [{ id: toolItemId('sword', 'iron'), chance: 0.05 }],
  zombie_villager: [{ id: toolItemId('sword', 'iron'), chance: 0.05 }],
};

/** 装备掉落的基础概率（原版 8.5%；每级抢夺 +1%） */
export const EQUIPMENT_DROP_CHANCE = 0.085;
export const EQUIPMENT_DROP_CHANCE_PER_LOOTING = 0.01;

/** 按权重挑一种盔甲材质 */
function pickArmorMaterial(random: () => number): ArmorMaterialName {
  let total = 0;
  for (const [, weight] of ARMOR_MATERIAL_WEIGHTS) total += weight;
  let roll = random() * total;
  for (const [material, weight] of ARMOR_MATERIAL_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return material;
  }
  return 'leather';
}

/**
 * 掷一只生物生成时的装备。
 *
 * @param typeId 生物种类 id
 * @param random 0~1 的随机源（注入是为了离线测试能钉住概率边界）
 * @param options.hasTrident 溺尸个体是否带三叉戟（由 `Mob` 先掷好；带了就渲染在主手）
 */
export function rollMobEquipment(
  typeId: string,
  random: () => number,
  options: { hasTrident?: boolean } = {},
): MobEquipment {
  const equipment: MobEquipment = {};

  if (ARMOR_WEARERS.has(typeId)) {
    for (let i = 0; i < ARMOR_SLOTS.length; i++) {
      if (random() >= ARMOR_PIECE_CHANCE) continue;
      const material = pickArmorMaterial(random);
      equipment[ARMOR_SLOTS[i]!] = armorItemIdFor(ARMOR_SLOT_TYPES[i]!, material);
    }
  }

  const fixed = FIXED_WEAPONS[typeId];
  if (fixed !== undefined) equipment.mainHand = fixed;
  else {
    for (const option of OCCASIONAL_WEAPONS[typeId] ?? []) {
      if (random() < option.chance) {
        equipment.mainHand = option.id;
        break;
      }
    }
  }

  // 溺尸的三叉戟是**个体**属性（`Mob` 里已经掷过一次），这里只把它映射到主手
  if (typeId === 'drowned' && options.hasTrident === true) equipment.mainHand = Item.TRIDENT;

  return equipment;
}

/** 部位 + 材质 → 物品 id（收成一层是为了让调用点只关心"第几格"） */
function armorItemIdFor(type: (typeof ARMOR_SLOT_TYPES)[number], material: ArmorMaterialName): number {
  return armorItemId(type, material);
}

/** 从 `armor.ts` 拿到全部装备的护甲信息（只认头/胸/腿/靴四格） */
export function equipmentArmor(equipment: MobEquipment): (ArmorInfo | undefined)[] {
  return ARMOR_SLOTS.map((slot) => {
    const id = equipment[slot];
    return id === undefined ? undefined : armorInfoById(id);
  });
}

/** 总护甲值（0~20） */
export function mobArmorPoints(equipment: MobEquipment): number {
  return totalDefense(equipmentArmor(equipment));
}

/** 总韧性（只有钻石/下界合金有） */
export function mobArmorToughness(equipment: MobEquipment): number {
  return totalToughness(equipmentArmor(equipment));
}

/**
 * 一次受击经过生物护甲后的伤害。
 *
 * 公式与玩家那边**同一条**（1.9 之后）：`f = 2 + 韧性/4`、
 * `g = clamp(护甲值 - 伤害/f, 护甲值×0.2, 20)`、`实际 = 伤害 × (1 - g/25)`。
 * 直接复用玩家那条公式的收益是"同一套铁甲穿在玩家和僵尸身上减伤一样"，
 * 不会出现两套数值各调各的。
 */
export function applyMobArmor(equipment: MobEquipment, amount: number): number {
  if (!(amount > 0)) return amount;
  const defense = mobArmorPoints(equipment);
  if (defense <= 0) return amount;
  const toughness = mobArmorToughness(equipment);
  const f = 2 + toughness / 4;
  const g = Math.min(Math.max(defense - amount / f, defense * 0.2), 20);
  return amount * (1 - g / 25);
}

/**
 * 死亡时掉哪些装备（只返回物品 id，数量恒为 1）。
 *
 * 原版每件独立掷 8.5%，抢夺每级 +1%。这里保持独立掷，
 * 所以"一套铁甲全掉"虽然少见但确实可能——那正是原版的手感。
 */
export function equipmentDrops(
  equipment: MobEquipment,
  random: () => number,
  looting = 0,
): number[] {
  const chance = EQUIPMENT_DROP_CHANCE + EQUIPMENT_DROP_CHANCE_PER_LOOTING * Math.max(0, Math.floor(looting));
  const drops: number[] = [];
  for (const slot of MOB_EQUIPMENT_SLOTS) {
    const id = equipment[slot];
    if (id === undefined) continue;
    if (random() < chance) drops.push(id);
  }
  return drops;
}

/** 渲染/重建模型用的稳定指纹（装备没变就不重建） */
export function mobEquipmentKey(equipment: MobEquipment | undefined): string {
  if (!equipment) return '';
  // 白板必须返回空串：外观 key 会与 `woolly` / `cleric` 等前缀拼接，
  // 返回 `0,0,0,0,0` 会让"没有装备"也看起来像一种外观，旧断言会当场红
  if (MOB_EQUIPMENT_SLOTS.every((slot) => equipment[slot] === undefined)) return '';
  return MOB_EQUIPMENT_SLOTS.map((slot) => equipment[slot] ?? 0).join(',');
}

/**
 * 存档读回来的装备清洗。
 *
 * 与 `EntityParking.sanitizeEffects` 同一条分工：这里校验"键认识、id 是正整数且
 * 这件物品真的存在"，认不出的整条丢掉。`undefined` 表示"白板"，不占存档键。
 */
export function sanitizeMobEquipment(data: unknown): MobEquipment | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  const out: MobEquipment = {};
  for (const slot of MOB_EQUIPMENT_SLOTS) {
    const value = record[slot];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) continue;
    if (itemDef(value) === undefined) continue;
    out[slot] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 这个物品是不是"武器"（渲染时按工具材质上色；弓/弩/三叉戟单列） */
export function weaponTint(itemId: number): number | undefined {
  if (itemId === Item.BOW) return 0x8a6236;
  if (itemId === Item.CROSSBOW) return 0x5c4326;
  if (itemId === Item.TRIDENT) return 0x3f8f86;
  const tool = toolInfoById(itemId);
  if (!tool) return undefined;
  return TOOL_TINTS[tool.material];
}

/** 工具材质色（只用于装备的小方块，不参与图集） */
const TOOL_TINTS: Record<ToolMaterial, number> = {
  wooden: 0x9c7a4a,
  stone: 0x8a8a8a,
  iron: 0xd8d8d8,
  golden: 0xf0c24a,
  diamond: 0x5decd5,
  netherite: 0x4a4048,
};

/** 盔甲材质色（按 `ArmorInfo.material` 查；查不到按铁色） */
export function armorTint(itemId: number): number {
  const material = armorInfoById(itemId)?.material;
  if (material === undefined) return 0xd8d8d8;
  return ARMOR_TINTS[material] ?? 0xd8d8d8;
}

const ARMOR_TINTS: Record<string, number> = {
  leather: 0xa06540,
  chainmail: 0x8f9499,
  iron: 0xd8d8d8,
  golden: 0xf0c24a,
  diamond: 0x5decd5,
  netherite: 0x4a4048,
};

/** 武器种类（给渲染层决定拿的是剑还是弓；`undefined` = 空手） */
export function weaponKindOf(itemId: number): ToolType | 'bow' | 'crossbow' | undefined {
  if (itemId === Item.BOW) return 'bow';
  if (itemId === Item.CROSSBOW) return 'crossbow';
  if (itemId === Item.TRIDENT) return 'trident';
  return toolInfoById(itemId)?.type;
}
