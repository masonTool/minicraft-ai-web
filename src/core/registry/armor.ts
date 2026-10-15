/**
 * 盔甲、护甲值与减伤结算
 *
 * 和工具模块（`tools.ts`）同一个理由把三件事放在一起：**减伤公式同时用到护甲值与韧性，
 * 耐久损耗也发生在同一次受击里**。拆成两个文件最容易改一边忘一边。
 *
 * 与原版对齐的部分：
 *  - 护甲值（原版 1.18，顺序都是 头/胸/腿/靴）：
 *      皮革 1/3/2/1 · 锁链 2/5/4/1 · 铁 2/6/5/2 · 金 2/5/3/1 · 钻石 3/8/6/3
 *  - 韧性：只有钻石有 2 点/件（满套 8 点），其余为 0；
 *  - 耐久：基数 11/16/15/13 × 材质倍率（皮革 5 · 锁链与铁 15 · 金 7 · 钻石 33），
 *    于是铁胸甲 240、钻石胸甲 528，与原版一致；
 *  - 减伤公式是 1.9 之后的那条（**不是**简单的"每点护甲 4%"）：
 *      f = 2 + 韧性 / 4
 *      g = clamp(护甲值 - 伤害 / f, 护甲值 × 0.2, 20)
 *      实际伤害 = 伤害 × (1 - g / 25)
 *    低伤害时接近"每点护甲 4%"，高伤害时减伤被压到"护甲值 × 0.2"的保底线——
 *    这正是"铁套能抗小怪、抗不住末影龙一口"的手感来源；
 *  - 每件盔甲每次受击掉 `max(1, ⌊伤害 / 4⌋)` 点耐久（原版 `LivingEntity#damageArmor`）；
 *  - 摔落 / 溺水 / 饿死 / 虚空 / 窒息 / 中毒**无视护甲**（对齐原版 `#bypasses_armor`）。
 *
 * 与原版的已知差异：
 *  - 只有 5 种材质（没有下界合金），也没有盔甲纹饰；
 *  - 没有保护/爆炸保护等附魔，也没有"盔甲韧性来自下界合金"这档；
 *  - 副手槽可以放任何东西，但**盾牌不存在**，所以副手暂时只是"多一格背包"。
 */

/**
 * 盔甲槽在背包里的基址：36/37/38/39 = 头/胸/腿/靴。
 *
 * 这里定义而不是写在 `Inventory.ts`：`Inventory` 依赖 `items`，`items` 依赖本模块，
 * 反过来让本模块依赖 `Inventory` 会成环。方向定成 `armor → items → Inventory` 单向。
 */
export const ARMOR_SLOT_BASE = 36;
export const ARMOR_SLOT_COUNT = 4;

/** 部位顺序（决定物品 id，不要改动顺序） */
export const ARMOR_TYPES = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
export type ArmorSlotType = (typeof ARMOR_TYPES)[number];

/** 材质顺序（决定物品 id，不要改动顺序） */
export const ARMOR_MATERIALS = ['leather', 'chainmail', 'iron', 'golden', 'diamond'] as const;
export type ArmorMaterial = (typeof ARMOR_MATERIALS)[number];

/** 盔甲部位编号 0 头 / 1 胸 / 2 腿 / 3 靴 */
export type ArmorSlot = 0 | 1 | 2 | 3;

export interface ArmorInfo {
  /** 部位编号，同时也是"背包槽位 - ARMOR_SLOT_BASE" */
  readonly slot: ArmorSlot;
  readonly type: ArmorSlotType;
  readonly material: ArmorMaterial;
  /** 护甲值（满 20 点） */
  readonly defense: number;
  /** 盔甲韧性（只影响高伤害时的减伤上限） */
  readonly toughness: number;
  /** 耐久 */
  readonly durability: number;
}

/** 盔甲物品 id 起点（接在 25 种工具的 1100-1124 之后） */
export const ARMOR_ITEM_START = 1130;

/** 第 (type, material) 件盔甲的物品 id */
export function armorItemId(type: ArmorSlotType, material: ArmorMaterial): number {
  return ARMOR_ITEM_START + ARMOR_TYPES.indexOf(type) * ARMOR_MATERIALS.length + ARMOR_MATERIALS.indexOf(material);
}

/** 护甲值表：材质 → 头/胸/腿/靴 */
const DEFENSE_TABLE: Record<ArmorMaterial, readonly [number, number, number, number]> = {
  leather: [1, 3, 2, 1],
  chainmail: [2, 5, 4, 1],
  iron: [2, 6, 5, 2],
  golden: [2, 5, 3, 1],
  diamond: [3, 8, 6, 3],
};

/** 韧性（只有钻石有） */
const TOUGHNESS_TABLE: Record<ArmorMaterial, number> = {
  leather: 0,
  chainmail: 0,
  iron: 0,
  golden: 0,
  diamond: 2,
};

/** 耐久基数（头/胸/腿/靴），再乘材质倍率 */
const DURABILITY_BASE = [11, 16, 15, 13] as const;

const DURABILITY_MULTIPLIER: Record<ArmorMaterial, number> = {
  leather: 5,
  chainmail: 15,
  iron: 15,
  golden: 7,
  diamond: 33,
};

/** 组装一件盔甲的完整属性 */
export function makeArmorInfo(type: ArmorSlotType, material: ArmorMaterial): ArmorInfo {
  const slot = ARMOR_TYPES.indexOf(type) as ArmorSlot;
  return {
    slot,
    type,
    material,
    defense: DEFENSE_TABLE[material][slot],
    toughness: TOUGHNESS_TABLE[material],
    durability: DURABILITY_BASE[slot] * DURABILITY_MULTIPLIER[material],
  };
}

/** 一件待注册的盔甲：id / 注册名 / 图集贴图 / 属性 */
export interface ArmorSpec {
  readonly id: number;
  readonly name: string;
  readonly tile: string;
  readonly armor: ArmorInfo;
}

/**
 * 图集里的盔甲图标名（`item_<材质>_<部位>`）。
 *
 * 命名规则只有这一处：注册物品（`ARMOR_SPECS`）、2D 图标、玩家模型上的甲片配色
 * 全都走这个函数，避免"改了命名规则但漏改某一处"。
 */
export function armorTile(armor: Pick<ArmorInfo, 'material' | 'type'>): string {
  return `item_${armor.material}_${armor.type}`;
}

/**
 * 全部 20 件盔甲（4 部位 × 5 材质）。
 * 加一种材质只需要往 DEFENSE_TABLE / DURABILITY_MULTIPLIER / ARMOR_MATERIALS 各加一行。
 */
export const ARMOR_SPECS: readonly ArmorSpec[] = ARMOR_TYPES.flatMap((type) =>
  ARMOR_MATERIALS.map((material) => {
    const armor = makeArmorInfo(type, material);
    return {
      id: armorItemId(type, material),
      name: `minecraft:${material}_${type}`,
      tile: armorTile(armor),
      armor,
    };
  }),
);

const ARMOR_BY_ID = new Map<number, ArmorInfo>(ARMOR_SPECS.map((spec) => [spec.id, spec.armor]));

/** 按物品 id 反查盔甲属性（非盔甲返回 undefined） */
export function armorInfoById(itemId: number): ArmorInfo | undefined {
  return ARMOR_BY_ID.get(itemId);
}

// ---------------------------------------------------------------- 减伤公式

/** 一次受击让每件盔甲掉多少耐久 */
export function armorWearPerHit(amount: number): number {
  if (amount <= 0) return 0;
  return Math.max(1, Math.floor(amount / 4));
}

/** 护甲减伤后的实际伤害（原版 `CombatRules#getDamageAfterAbsorb`） */
export function damageAfterArmor(amount: number, defense: number, toughness: number): number {
  if (amount <= 0) return 0;
  if (defense <= 0) return amount;
  const f = 2 + toughness / 4;
  const g = Math.min(20, Math.max(defense - amount / f, defense * 0.2));
  return amount * (1 - g / 25);
}

/** 无视护甲的伤害类型（原版 `#bypasses_armor`，这里用本项目的 `DamageCause` 字符串） */
export const ARMOR_BYPASS_CAUSES: ReadonlySet<string> = new Set([
  'fall',
  'drown',
  'starve',
  'void',
  'suffocate',
  'poison',
]);

// ---------------------------------------------------------------- 背包访问

/**
 * 盔甲槽的最小访问接口。
 * 故意**不 import `Inventory`**（那会让 armor ← items ← Inventory ← armor 成环），
 * 而是用结构类型：`Inventory` 天然满足它。
 */
export interface ArmorSlotStack {
  id: number;
  count: number;
  damage?: number;
}

export interface ArmorSlotAccess {
  get(index: number): ArmorSlotStack | null;
  set(index: number, stack: ArmorSlotStack | null): void;
}

/**
 * 第 slotIndex 号背包槽能不能放这件物品。
 * 不是盔甲槽（< 36 或 > 39）时一律返回 true，方便调用方把它当通用判定用。
 */
export function armorSlotAccepts(slotIndex: number, itemId: number): boolean {
  const slot = slotIndex - ARMOR_SLOT_BASE;
  if (slot < 0 || slot >= ARMOR_SLOT_COUNT) return true;
  return armorInfoById(itemId)?.slot === slot;
}

/**
 * 读取已装备的盔甲（空槽为 undefined）。
 *
 * 会校验"槽位与部位一致"：坏存档或误操作把靴子塞进头盔位时，它不该被算成穿上——
 * 否则会出现"看着没戴头盔，护甲值却多了 3 点"这种查不出来的怪事。
 */
export function equippedArmor(slots: ArmorSlotAccess): (ArmorInfo | undefined)[] {
  const result: (ArmorInfo | undefined)[] = [];
  for (let slot = 0; slot < ARMOR_SLOT_COUNT; slot++) {
    const stack = slots.get(ARMOR_SLOT_BASE + slot);
    const info = stack ? armorInfoById(stack.id) : undefined;
    result.push(info && info.slot === slot ? info : undefined);
  }
  return result;
}

export function totalDefense(infos: readonly (ArmorInfo | undefined)[]): number {
  let total = 0;
  for (const info of infos) if (info) total += info.defense;
  return total;
}

export function totalToughness(infos: readonly (ArmorInfo | undefined)[]): number {
  let total = 0;
  for (const info of infos) if (info) total += info.toughness;
  return total;
}

// ---------------------------------------------------------------- 装备提供者

/**
 * 一次受击的完整结算：减伤 → 扣每件盔甲的耐久 → 返回实际伤害。
 * 由 `main` 注入给 `PlayerStats`，这样**环境伤害（岩浆/仙人掌）也能被护甲减伤**，
 * 不必在每个伤害来源各写一遍。
 */
export interface ArmorAbsorbResult {
  /** 实际造成的伤害 */
  applied: number;
  /** 被护甲挡下的伤害 */
  blocked: number;
  /** 是否有盔甲破损 */
  broke: boolean;
}

export interface ArmorWearer {
  /** 当前总护甲值（HUD 与调试面板用） */
  readonly points: number;
  absorb(amount: number, cause: string): number;
}

/** 扣一件盔甲的耐久；耐久归零就整件消失（与原版一致，不掉残骸） */
function wearArmorPiece(slots: ArmorSlotAccess, index: number, wear: number): boolean {
  const stack = slots.get(index);
  if (!stack) return false;
  const info = armorInfoById(stack.id);
  if (!info) return false;
  const damage = (stack.damage ?? 0) + wear;
  if (damage >= info.durability) {
    slots.set(index, null);
    return true;
  }
  slots.set(index, { ...stack, damage });
  return false;
}

/**
 * 结算一次受击。
 * @param amount 减伤前的伤害
 * @param cause  伤害类型（见 `DamageCause`）；无视护甲的类型原样返回
 */
export function absorbWithArmor(slots: ArmorSlotAccess, amount: number, cause: string): ArmorAbsorbResult {
  const result: ArmorAbsorbResult = { applied: amount, blocked: 0, broke: false };
  if (amount <= 0) return result;
  if (ARMOR_BYPASS_CAUSES.has(cause)) return result;

  const equipped = equippedArmor(slots);
  const defense = totalDefense(equipped);
  if (defense <= 0) return result;

  result.applied = damageAfterArmor(amount, defense, totalToughness(equipped));
  result.blocked = amount - result.applied;

  // 每件盔甲掉耐久（按"减伤前"的伤害算，与原版一致）
  const wear = armorWearPerHit(amount);
  for (let slot = 0; slot < ARMOR_SLOT_COUNT; slot++) {
    if (wearArmorPiece(slots, ARMOR_SLOT_BASE + slot, wear)) result.broke = true;
  }
  return result;
}

/** 把背包当作"护甲提供者"接给 `PlayerStats` */
export function createArmorWearer(slots: ArmorSlotAccess): ArmorWearer {
  return {
    get points(): number {
      return totalDefense(equippedArmor(slots));
    },
    absorb(amount: number, cause: string): number {
      return absorbWithArmor(slots, amount, cause).applied;
    },
  };
}
