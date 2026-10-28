/**
 * 堆肥（批次 70，B43 / H14）：什么能扔进堆肥桶、扔进去有几成机会涨一级。
 *
 * 纯数据 + 一个纯函数（`compostStep`），所以"哪件东西几分概率"能在离线测试里逐条钉住——
 * 概率数值是玩家手感（攒骨粉的快慢），写错不会报错、只会让手感走样。
 *
 * 概率分五档，取自原版 `ComposterBlock.COMPOSTABLES` 的分法：
 *  **0.3** 种子（最小的东西）→ **0.5** 干海带这类半成品 → **0.65** 成熟作物与植物
 *  → **0.85** 熟食与面包 → **1.0** 蛋糕/蘑菇煲这类成品。
 * ⚠️ 逐条数值**没有真机核对**（本项目没有那条渠道），但档位关系按原版的分法写；
 * 表里**只放本项目真的有的东西**（原版那张表里还有一堆我们没有的物品）。
 *
 * 与原版一致的规矩：
 *  - 一次只吃**一件**，涨不涨**当场掷**（不是"攒够几次必涨"）；
 *  - 桶满（8 级）之后**不再接受**任何东西，只能先收走这一份骨粉；
 *  - 不能堆肥的东西扔进去**什么都不会发生**（原版连音效都没有），调用方也不该消耗它。
 */

import { Block } from './blocks.ts';
import { COMPOSTER_MAX_LEVEL } from './blockState.ts';
import { Item } from './items.ts';

// ⚠️ `COMPOSTER_MAX_LEVEL` 的**唯一定义**在 `blockState.ts`（等级存在状态位里，
// 夹取也在那边做）——这里只引用，不再写一份（同一个数字写两处必然会漂）

/** 档位表：`[概率, 这一档的物品]`。⚠️ 加东西只要往对应的那一档里塞 id */
const RAW_TABLE: readonly (readonly [number, readonly number[]])[] = [
  // ---- 0.3：种子类（最便宜、也最慢）
  [0.3, [Item.WHEAT_SEEDS, Item.BEETROOT_SEEDS]],
  // ---- 0.5：半成品
  [0.5, [Item.DRIED_KELP]],
  // ---- 0.65：成熟作物与植物（原版这一档最大）
  [
    0.65,
    [
      Item.WHEAT,
      Item.CARROT,
      Item.POTATO,
      Item.BEETROOT,
      Item.APPLE,
      Item.MELON_SLICE,
      Item.SWEET_BERRIES,
      Item.COCOA_BEANS,
      Block.KELP,
      Block.PUMPKIN,
      Block.MELON,
      Block.SEAGRASS,
      Block.CACTUS,
      Block.SUGAR_CANE,
      Block.DANDELION,
      Block.POPPY,
      Block.BLUE_ORCHID,
      Block.OXEYE_DAISY,
      Block.CORNFLOWER,
      Block.RED_MUSHROOM,
      Block.BROWN_MUSHROOM,
      Block.VINE,
    ],
  ],
  // ---- 0.85：熟食与面包
  [0.85, [Item.BREAD, Item.COOKIE, Item.BAKED_POTATO, Item.PUMPKIN_PIE]],
  // ---- 1.0：成品（扔一个必涨一级）
  [1, [Block.CAKE, Item.MUSHROOM_STEW]],
];

const CHANCE = new Map<number, number>();

for (const [chance, list] of RAW_TABLE) {
  for (const itemId of list) {
    const existing = CHANCE.get(itemId);
    // ⚠️ 重复登记**抛错**（而不是默默覆盖）：概率是手感数值，同一件东西出现在两档里
    // 说明表在长大时被重复写了一遍，那种错查起来很费劲（配方表也定过同样的规矩）
    if (existing !== undefined && existing !== chance) {
      throw new Error(`compost: 物品 ${itemId} 被登记了两次（${existing} 与 ${chance}）`);
    }
    CHANCE.set(itemId, chance);
  }
}

/** 这个物品能不能堆肥（能则返回概率，不能则 undefined） */
export function compostChanceFor(itemId: number): number | undefined {
  return CHANCE.get(itemId);
}

/** 全表（按档位分组；测试与将来的界面都读它，不手抄第二份） */
export function compostTable(): readonly (readonly [number, readonly number[]])[] {
  return RAW_TABLE;
}

/** 给玩家看的一句话（界面/提示用） */
export function describeChance(chance: number): string {
  if (chance >= 1) return '扔一个必涨一级';
  return `${Math.round(chance * 100)}% 涨一级`;
}

/**
 * 往堆肥桶里塞**一件**：掷一次，成功就涨一级。
 *
 * @returns 新的等级；返回 `null` 表示"这件东西不该被吃掉"——调用方**不要消耗物品**
 *          （两种原因：这东西不能堆肥、或者桶已经满了）
 */
export function compostStep(level: number, itemId: number, random: () => number): number | null {
  if (level >= COMPOSTER_MAX_LEVEL) return null;
  const chance = compostChanceFor(itemId);
  if (chance === undefined) return null;
  // 掷一次：成功涨一级（100% 档必涨）。失败时**等级不变**——但东西照样被吃掉（原版如此）
  if (random() >= chance) return level;
  return Math.min(COMPOSTER_MAX_LEVEL, level + 1);
}
