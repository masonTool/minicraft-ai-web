/**
 * 猪灵以物易物（批次 344，J20）
 *
 * 原版手势是"把金锭丢在猪灵附近"，本项目在触屏上改成**拿金锭点猪灵**
 * （与"拿煤点矿车""拿骨头点狼"同一套交互收口，见 `main.useOnEntity`）。
 *
 * 规则本身是纯数据 + 纯函数：主程序只负责扣金锭、按结果生成掉落物。
 * ⚠️ 与原版的差异：掉落的**具体物品/权重**按本项目已有的物品裁剪过
 * （原版还有火焰弹、哭泣的黑曜石、附魔书、铁靴等，这里没有对应物品就不登记）；
 * 也不做"猪灵收到金锭后跳舞 6 秒"的动画。
 */

import { Block } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';

export interface BarterEntry {
  readonly itemId: number;
  readonly min: number;
  readonly max: number;
  /** 相对权重 */
  readonly weight: number;
}

/**
 * 抽取表（8 项，收敛到本项目真的有的物品）。
 *
 * 权重按原版的量级写：末影珍珠稀有、铁粒/线/石英常见。
 */
export const BARTER_TABLE: readonly BarterEntry[] = [
  { itemId: Item.ENDER_PEARL, min: 2, max: 4, weight: 2 },
  { itemId: Item.IRON_NUGGET, min: 8, max: 24, weight: 10 },
  { itemId: Item.QUARTZ, min: 5, max: 12, weight: 10 },
  { itemId: Item.GLOWSTONE_DUST, min: 2, max: 8, weight: 8 },
  { itemId: Item.MAGMA_CREAM, min: 2, max: 6, weight: 4 },
  { itemId: Item.STRING, min: 3, max: 9, weight: 6 },
  { itemId: Item.GOLD_NUGGET, min: 2, max: 6, weight: 6 },
  // 黑曜石是方块物品（沿用方块 id），没有独立的 `Item.OBSIDIAN`
  { itemId: Block.OBSIDIAN, min: 1, max: 2, weight: 2 },
  { itemId: Block.CRYING_OBSIDIAN, min: 1, max: 3, weight: 2 },
];

/** 表里所有条目的权重和（断言与调试用） */
export const BARTER_TOTAL_WEIGHT = BARTER_TABLE.reduce((sum, entry) => sum + entry.weight, 0);

/**
 * 抽一次。
 *
 * `random` 传 `Math.random` 就是运行时；测试里传固定序列，于是"权重分布"
 * 与"数量区间"都能离线钉住（不依赖真随机）。
 */
export function barterRoll(random: () => number = Math.random): { itemId: number; count: number } {
  let roll = random() * BARTER_TOTAL_WEIGHT;
  let picked = BARTER_TABLE[BARTER_TABLE.length - 1]!;
  for (const entry of BARTER_TABLE) {
    roll -= entry.weight;
    if (roll < 0) {
      picked = entry;
      break;
    }
  }
  const span = picked.max - picked.min + 1;
  const count = picked.min + Math.floor(random() * span);
  return { itemId: picked.itemId, count: Math.min(count, picked.max) };
}
