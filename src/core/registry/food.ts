/**
 * 食物数值与进食规则
 *
 * 表里保留的是**原版那两个数**（饥饿点 + 饱和度修饰值），而不是直接把饱和度点数写死：
 * 原版 `FoodData#eat` 的实际补量是 `hunger × modifier × 2`，写修饰值才能一眼和 wiki 对上、
 * 也才能在测试里验算这条公式（换算见 `saturationFrom`）。
 *
 * ⚠️ 这两个数**很容易写混**：wiki 上写的是"恢复 2.4 点饱和度"，而代码里要填的是 **0.3**
 * （= 2.4 ÷ (4 × 2)）。最初就是直接把 2.4 填进了 `saturationModifier`，
 * 于是苹果一次补 19.2 点饱和度——离线测试里对了几组原版数值才抓出来。
 *
 * 为什么表以**注册名**为键而不是物品 id：`items.ts` 要依赖本模块来挂数值，
 * 本模块再反向依赖 `items.ts` 就会成环。用名字当键，两边都只说名字，
 * id 由 `items.ts` 单方面持有（`armor.ts` / `tools.ts` 那两套是反向的，
 * 因为它们自己就是 id 的产地；食物这边要复用的都是既有物品，只能反过来）。
 *
 * 与原版的已知差异：
 *  - 没有"进食减速"（原版吃的时候移速减到 1/3）与"吃完的饱嗝音效时长"
 *  - 没有河豚/蜘蛛眼这类带复杂副作用的食物（金胡萝卜已在批次 48 补上）
 *  - **可疑的炖菜没做**：原版是"同一样物品、效果取决于用了哪朵花"（靠物品 NBT 记），
 *    而本项目的 `ItemStack` 只有 damage/附魔/名字三个字段——做不了"一个 id 多种效果"，
 *    硬做只能写成一个固定效果（那就不叫可疑了）。等 H16 的物品 NBT 收尾再接
 *  - 蜂蜜瓶（要玻璃瓶）、蛋糕（要放置逻辑）暂缺
 */

import type { EffectId } from '../survival/StatusEffects.ts';

/** 吃完附加的效果 */
export interface FoodEffect {
  readonly id: EffectId;
  /** 持续秒数 */
  readonly seconds: number;
  /** 等级（0 = I 级） */
  readonly amplifier: number;
  /** 触发概率 0~1；省略即必定触发（原版腐肉 80%、生鸡肉 30%） */
  readonly chance?: number;
}

export interface FoodInfo {
  /** 饥饿点数（满 20） */
  readonly hunger: number;
  /** 原版饱和度修饰值 */
  readonly saturationModifier: number;
  /** 饥饿满时也能吃（原版只有金苹果这类"功能性食物"是这样） */
  readonly alwaysEdible?: boolean;
  readonly effects?: readonly FoodEffect[];
  /**
   * 喝完清除**所有**状态效果（J8 的牛奶）。
   *
   * 牛奶在原版不回饥饿也不回饱和度，纯粹是"洗掉身上的效果"，
   * 所以这条与 `hunger`/`saturationModifier` 是并列关系而不是替代关系。
   */
  readonly clearsEffects?: boolean;
}

/** 吃完一份食物能补的饱和度点数（原版 `FoodData#eat` 的算法） */
export function saturationFrom(food: FoodInfo): number {
  return food.hunger * food.saturationModifier * 2;
}

/**
 * 进食耗时（秒）。原版是 1.6 秒（32 tick），所有食物一样。
 * 放在这里而不是 main 里写死：离线测试要拿它验"吃满 1.6 秒才咽下去"。
 */
export const EAT_SECONDS = 1.6;

/**
 * 食物数值表，键是注册名去掉 `minecraft:` 前缀。
 * 数值取自原版 1.18 的 `Items.java`（食品那一段）。
 */
export const FOOD_TABLE: Readonly<Record<string, FoodInfo>> = {
  // ---- 水果与作物
  // （修饰值 = wiki 上的"恢复饱和度" ÷ (饥饿点 × 2)：苹果 2.4 ÷ 8 = 0.3）
  apple: { hunger: 4, saturationModifier: 0.3 },
  golden_apple: {
    hunger: 4,
    saturationModifier: 1.2,
    alwaysEdible: true,
    // 原版：伤害吸收 I 2:00 + 生命恢复 II 0:05
    effects: [
      { id: 'absorption', seconds: 120, amplifier: 0 },
      { id: 'regeneration', seconds: 5, amplifier: 1 },
    ],
  },
  melon_slice: { hunger: 2, saturationModifier: 0.3 },
  // ---- 批次 48 补齐（B17）
  // 金胡萝卜：数值取自原版（6 饥饿 / 1.2 修饰值），而且**饥饿满时也能吃**
  golden_carrot: { hunger: 6, saturationModifier: 1.2, alwaysEdible: true },
  // 蘑菇煲 / 甜菜汤：原版都是 6 饥饿 / 0.6
  mushroom_stew: { hunger: 6, saturationModifier: 0.6 },
  beetroot_soup: { hunger: 6, saturationModifier: 0.6 },
  // 南瓜派：原版 8 饥饿 / 0.3（南瓜 + 糖 + 蛋）
  pumpkin_pie: { hunger: 8, saturationModifier: 0.3 },
  // 甜菜根：原版 1 饥饿 / 0.6（只适合做汤）
  beetroot: { hunger: 1, saturationModifier: 0.6 },
  // 甜浆果（批次 49）：原版 2 饥饿 / 0.1（吃一把也就垫垫肚子）
  sweet_berries: { hunger: 2, saturationModifier: 0.1 },
  // 曲奇（批次 49）：原版 2 饥饿 / 0.1
  cookie: { hunger: 2, saturationModifier: 0.1 },
  // 干海带（批次 50）：原版 1 饥饿 / 0.6 点饱和度（修饰值 = 0.6 ÷ (1 × 2) = 0.3）。
  // 单吃很亏，但它能**9 个压成一块干海带块当燃料烧 20 个东西**——那才是它的用处
  dried_kelp: { hunger: 1, saturationModifier: 0.3 },
  // 牛奶：不回饥饿也不回饱和度，只清除所有状态效果（原版行为）
  // 面包（3 小麦）：原版 5 点饥饿 / 6 点饱和度
  bread: { hunger: 5, saturationModifier: 0.6 },
  // 胡萝卜 / 马铃薯 / 烤马铃薯（原版数值）
  carrot: { hunger: 3, saturationModifier: 0.6 },
  potato: { hunger: 1, saturationModifier: 0.6 },
  baked_potato: { hunger: 5, saturationModifier: 0.6 },
  milk_bucket: { hunger: 0, saturationModifier: 0, alwaysEdible: true, clearsEffects: true },

  // ---- 生肉（原版生鸡肉 30% 概率给饥饿，腐肉 80%）
  beef: { hunger: 3, saturationModifier: 0.3 },
  porkchop: { hunger: 3, saturationModifier: 0.3 },
  mutton: { hunger: 2, saturationModifier: 0.3 },
  chicken: { hunger: 2, saturationModifier: 0.3, effects: [{ id: 'hunger', seconds: 30, amplifier: 0, chance: 0.3 }] },
  rotten_flesh: {
    hunger: 4,
    saturationModifier: 0.1,
    effects: [{ id: 'hunger', seconds: 30, amplifier: 0, chance: 0.8 }],
  },

  // ---- 熟肉（熔炉烤过，饱食度明显更高）
  cooked_beef: { hunger: 8, saturationModifier: 0.8 },
  cooked_porkchop: { hunger: 8, saturationModifier: 0.8 },
  cooked_mutton: { hunger: 6, saturationModifier: 0.8 },
  cooked_chicken: { hunger: 6, saturationModifier: 0.6 },
};

/** 取某个注册名（可带 `minecraft:` 前缀）的食物数值 */
export function foodForName(name: string): FoodInfo | undefined {
  return FOOD_TABLE[name.replace('minecraft:', '')];
}

/** 这件物品能吃吗（饥饿满时还要看 `alwaysEdible`） */
export function canEat(food: FoodInfo, currentFood: number, maxFood: number): boolean {
  return food.alwaysEdible === true || currentFood < maxFood;
}
