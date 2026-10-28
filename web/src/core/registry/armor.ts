import { enchantLevel } from './enchantments.ts';

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
export type ArmorMaterial = (typeof ARMOR_MATERIALS)[number] | 'netherite';

/**
 * 全部材质（含下界合金），枚举用。
 *
 * ⚠️ `ARMOR_MATERIALS` 是 5 种**可合成**的材质，同时决定物品 id 的排布
 * （`armorItemId` = 起点 + 部位序号 × 5 + 材质序号）。下界合金不能塞进去：
 * 那会让铁盔甲从 1135 变成 1136、钻石靴子从 1149 变成 1154……
 * 而存档里存的就是这些数字。所以它单独一段 id，见 `NETHERITE_ARMOR_ITEM_START`。
 */
export const ALL_ARMOR_MATERIALS: readonly ArmorMaterial[] = [...ARMOR_MATERIALS, 'netherite'];

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

/** 下界合金盔甲的物品 id 起点（1275 起，接在下界合金工具的 1270-1274 之后） */
export const NETHERITE_ARMOR_ITEM_START = 1275;

/** 第 (type, material) 件盔甲的物品 id */
export function armorItemId(type: ArmorSlotType, material: ArmorMaterial): number {
  if (material === 'netherite') return NETHERITE_ARMOR_ITEM_START + ARMOR_TYPES.indexOf(type);
  return ARMOR_ITEM_START + ARMOR_TYPES.indexOf(type) * ARMOR_MATERIALS.length + ARMOR_MATERIALS.indexOf(material);
}

/** 护甲值表：材质 → 头/胸/腿/靴 */
const DEFENSE_TABLE: Record<ArmorMaterial, readonly [number, number, number, number]> = {
  leather: [1, 3, 2, 1],
  chainmail: [2, 5, 4, 1],
  iron: [2, 6, 5, 2],
  golden: [2, 5, 3, 1],
  diamond: [3, 8, 6, 3],
  // 下界合金的护甲值与钻石**完全相同**（原版如此），贵在韧性、耐久与抗火
  netherite: [3, 8, 6, 3],
};

/** 韧性（钻石 2 点/件，下界合金 3 点/件；其余为 0） */
const TOUGHNESS_TABLE: Record<ArmorMaterial, number> = {
  leather: 0,
  chainmail: 0,
  iron: 0,
  golden: 0,
  diamond: 2,
  netherite: 3,
};

/** 耐久基数（头/胸/腿/靴），再乘材质倍率 */
const DURABILITY_BASE = [11, 16, 15, 13] as const;

const DURABILITY_MULTIPLIER: Record<ArmorMaterial, number> = {
  leather: 5,
  chainmail: 15,
  iron: 15,
  golden: 7,
  diamond: 33,
  netherite: 37,
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
 * 全部 24 件盔甲 = 可合成的 20 件（4 部位 × 5 材质）+ 下界合金 4 件。
 *
 * 下界合金和工具一样：id 单独一段、没有合成配方（只能在锻造台上把钻石盔甲升上去）。
 */
export const ARMOR_SPECS: readonly ArmorSpec[] = ARMOR_TYPES.flatMap((type) =>
  ALL_ARMOR_MATERIALS.map((material) => {
    const armor = makeArmorInfo(type, material);
    return {
      id: armorItemId(type, material),
      name: `minicraft:${material}_${type}`,
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
  // 凋零（批次 218）：原版也在 `#bypasses_armor` 里——穿一身钻甲照样被凋零打死
  'wither',
  // 雷击（批次 83）：原版雷击**无视护甲**（`#bypasses_armor` 里有它），
  // 所以穿一身钻石甲站在避雷针旁边也会被劈掉 5 颗心
  'lightning',
  // 冰冻（批次 548）：原版细雪冻伤无视护甲
  'freeze',
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
  enchants?: Record<string, number>;
}

export interface ArmorSlotAccess {
  get(index: number): ArmorSlotStack | null;
  set(index: number, stack: ArmorSlotStack | null): void;
}

/**
 * 第 slotIndex 号背包槽能不能放这件物品。
 * 不是盔甲槽（< 36 或 > 39）时一律返回 true，方便调用方把它当通用判定用。
 */
/**
 * 鞘翅的物品 id（批次 499）。
 *
 * 定义在**这里**而不是 `items.ts`：`armorSlotAccepts` 要用它，而
 * `items.ts` 已经反过来依赖本模块（`ARMOR_SPECS`）——常量放在这边、那边引用，
 * 才不会成环。`items.ts` 的 `Item.ELYTRA` 就是它。
 */
export const ELYTRA_ITEM_ID = 1539;

export function armorSlotAccepts(slotIndex: number, itemId: number): boolean {
  const slot = slotIndex - ARMOR_SLOT_BASE;
  if (slot < 0 || slot >= ARMOR_SLOT_COUNT) return true;
  // 鞘翅（批次 499）：装备在**胸甲槽**，但它不是盔甲（`armorInfoById` 查不到）——
  // 不特判的话，背包里根本放不进胸甲槽，滑翔也就无从谈起
  if (itemId === ELYTRA_ITEM_ID) return slot === 1;
  return armorInfoById(itemId)?.slot === slot;
}

/**
 * 读取已装备的盔甲（空槽为 undefined）。
 *
 * 会校验"槽位与部位一致"：坏存档或误操作把靴子塞进头盔位时，它不该被算成穿上——
 * 否则会出现"看着没戴头盔，护甲值却多了 3 点"这种查不出来的怪事。
 */
/**
 * 附魔保护的"作用范围"：一条附魔能挡哪些伤害类型。
 *
 * 原版里每种保护附魔只对特定伤害来源生效，所以 EPF 要按**本次伤害的类型**挑着加：
 *  - 保护：什么都挡（原版 `getDamageProtection` 对所有来源都返回 level）
 *  - 火焰保护：火焰与岩浆
 *  - 爆炸保护：爆炸
 *  - 弹射物保护：箭矢这类弹射物
 * 一条伤害可能同时被多条附魔覆盖（例如岩浆同时吃"保护"和"火焰保护"），这是原版行为。
 */
const PROTECTION_SCOPE: Record<string, readonly string[]> = {
  protection: ['*'],
  fire_protection: ['fire', 'lava'],
  blast_protection: ['explosion'],
  projectile_protection: ['projectile'],
};

/**
 * 「保护」类附魔的防护点数（原版 EPF）。
 *
 * 原版把减伤分成两步：先用护甲值/韧性算一次，再用 EPF 算一次，**两次是相乘关系**。
 * 每级贡献 1 点 EPF（保护 IV × 4 件 = 16 点），EPF 总和上限 20 点。
 *
 * @param cause 本次伤害的类型；不传或传 `'*'` 时按"全都算"处理
 */
export function protectionPoints(slots: ArmorSlotAccess, cause = '*'): number {
  let epf = 0;
  for (let slot = 0; slot < ARMOR_SLOT_COUNT; slot++) {
    const stack = slots.get(ARMOR_SLOT_BASE + slot);
    const info = stack ? armorInfoById(stack.id) : undefined;
    if (!info || info.slot !== slot) continue;
    for (const [id, scope] of Object.entries(PROTECTION_SCOPE)) {
      if (!scope.includes('*') && !scope.includes(cause)) continue;
      epf += enchantLevel(stack?.enchants, id);
    }
  }
  return Math.min(20, epf);
}

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

/**
 * 扣一件盔甲的耐久；耐久归零就整件消失（与原版一致，不掉残骸）。
 *
 * 「耐久」附魔在这里同样生效：每级有 `level/(level+1)` 的概率跳过这次损耗，
 * 与工具那边共用同一个式子（`main.damageHeldTool`）。
 */
function wearArmorPiece(slots: ArmorSlotAccess, index: number, wear: number): boolean {
  const stack = slots.get(index);
  if (!stack) return false;
  const info = armorInfoById(stack.id);
  if (!info) return false;
  const unbreaking = enchantLevel(stack.enchants, 'unbreaking');
  if (unbreaking > 0 && Math.random() < unbreaking / (unbreaking + 1)) return false;
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
  // EPF 按伤害类型挑：挨炸的时候只有"保护"和"爆炸保护"算数，火焰保护不帮忙
  const epf = protectionPoints(slots, cause);
  if (defense <= 0 && epf <= 0) return result;

  // 先按护甲值/韧性算一次，再按"保护"附魔的 EPF 算一次（原版是两次相乘）
  const afterArmor = damageAfterArmor(amount, defense, totalToughness(equipped));
  result.applied = epf > 0 ? afterArmor * (1 - epf / 25) : afterArmor;
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
