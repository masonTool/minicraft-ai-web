/**
 * 钓鱼的战利品表（批次 81，G11）
 *
 * 原版的钓鱼表长这样：**三个池子**（fish 85% / junk 10% / treasure 5%），
 * 抽中哪个池子之后再按池内权重抽具体东西；"海之眷顾"只影响**池子**的选择
 * （junk 上限降、treasure 上限升），不改变池内的权重。
 *
 * 为什么**不**塞进 `loot.ts` 的 `LOOT_TABLES`：
 *  1. 那张表的序号是**写进箱子方块状态**的（`下标 + 1`），钓鱼根本不是箱子；
 *  2. 结构表是"若干轮 + 一张加权表"，而钓鱼是"先选池、再选条目"——两层权重。
 * 但 `LootEntry` 的形状（id / 数量区间 / 权重）完全一样，所以直接复用它的类型：
 * 同一个概念不该有两套写法。
 *
 * ⚠️ 只用本项目**已有**的物品。原版 junk 里的"墨囊"、treasure 里的
 * **命名牌 / 鹦鹉螺壳 / 鞍**本项目都还没有那件物品，**不拿别的东西顶替**——
 * 顶替会让"钓鱼能钓到什么"变成一句谎话（原版的宝藏池因此只有 3 项）。
 */

import { Block } from './blocks.ts';
import { armorItemId } from './armor.ts';
import { Item } from './items.ts';
import type { LootEntry } from './loot.ts';

/** 钓鱼池里的一条（比结构表的条目多一个"附魔书"标记） */
export interface FishingEntry extends LootEntry {
  /**
   * 附魔书：钓上来时**现掷一条附魔**装进书里（原版宝藏池里就有它）。
   *
   * 为什么用标记而不是"直接给某本附魔书"：附魔是**随机的**，
   * 而表里只能写死一个 id。掷骰交给主程序（它拿着 `pickEnchants`），
   * 这里只负责说"这一条是书"。
   */
  readonly enchantedBook?: boolean;
}

/** 一个池子 */
export interface FishingPool {
  readonly key: 'fish' | 'junk' | 'treasure';
  readonly name: string;
  /** 基准权重（原版 85 / 10 / 5，合计 100） */
  readonly weight: number;
  /** 海之眷顾每级对**这个池子**的权重修正（原版 wiki：junk −2.5、treasure +2.5） */
  readonly luckPerLevel: number;
  readonly entries: readonly FishingEntry[];
}

/** 池内条目（权重相对值） */
function entry(id: number, weight: number, enchantedBook = false): FishingEntry {
  return { id, min: 1, max: 1, weight, ...(enchantedBook ? { enchantedBook } : {}) };
}

export const FISHING_POOLS: readonly FishingPool[] = [
  {
    key: 'fish',
    name: '鱼',
    weight: 85,
    luckPerLevel: 0,
    // 原版权重 60 / 25 / 13 / 2（合计 100）
    entries: [
      entry(Item.COD, 60),
      entry(Item.SALMON, 25),
      entry(Item.PUFFERFISH, 13),
      entry(Item.TROPICAL_FISH, 2),
    ],
  },
  {
    key: 'junk',
    name: '杂物',
    weight: 10,
    luckPerLevel: -2.5,
    // 原版 junk 池（权重合计 100）：睡莲 17 / 皮革靴 10 / 皮革 10 / 骨头 10 /
    // 水瓶 10 / 线 5 / 钓竿 2 / 碗 10 / 木棍 5 / 绊线钩 10 / 腐肉 10
    // ⚠️ 原版还有"墨囊 1"（章鱼没做），这里**没有替代品**，于是少了那 1 点权重
    entries: [
      entry(Block.LILY_PAD, 17),
      entry(armorItemId('boots', 'leather'), 10),
      entry(Item.LEATHER, 10),
      entry(Item.BONE, 10),
      entry(Item.WATER_BOTTLE, 10),
      entry(Item.STRING, 5),
      entry(Item.FISHING_ROD, 2),
      entry(Item.BOWL, 10),
      entry(Item.STICK, 5),
      entry(Block.TRIPWIRE_HOOK, 10),
      entry(Item.ROTTEN_FLESH, 10),
    ],
  },
  {
    key: 'treasure',
    name: '宝藏',
    weight: 5,
    luckPerLevel: 2.5,
    // 原版宝藏池是 6 项（弓 / 附魔书 / 钓竿 / 命名牌 / 鹦鹉螺壳 / 鞍），
    // 后三件本项目都还没有那件物品 → **只留能诚实给出的三项**
    entries: [entry(Item.BOW, 1), entry(Item.BOOK, 1, true), entry(Item.FISHING_ROD, 1)],
  },
];

/** 一次收获 */
export interface FishingCatch {
  /** 物品 id */
  id: number;
  count: number;
  /** 来自哪个池子（调试/文案用） */
  pool: FishingPool['key'];
  /** 要不要变成附魔书（现掷一条附魔） */
  enchantedBook: boolean;
}

/** 海之眷顾的等级 → 池子权重（原版那套"降杂物、涨宝藏"） */
export function poolWeightWithLuck(pool: FishingPool, luck: number): number {
  return Math.max(0, pool.weight + pool.luckPerLevel * Math.max(0, Math.floor(luck)));
}

/** 按权重抽一条（`random` 必须注入，离线才能断言分布） */
function pickWeighted<T extends { weight: number }>(items: readonly T[], random: () => number): T {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total <= 0) return items[0]!;
  let roll = random() * total;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll < 0) return item;
  }
  return items[items.length - 1]!;
}

/**
 * 掷一次收获。
 *
 * `luck` 是"海之眷顾"的等级（0~3）：它只改**池子**的权重，池内权重不变——
 * 与原版一致（所以"钓到鱼的种类分布"不受附魔影响）。
 */
export function rollFishing(random: () => number, luck = 0): FishingCatch {
  const pool = pickWeighted(
    FISHING_POOLS.map((item) => ({ ...item, weight: poolWeightWithLuck(item, luck) })),
    random,
  );
  const chosen = pickWeighted(pool.entries, random);
  return {
    id: chosen.id,
    count: chosen.min === chosen.max ? chosen.min : chosen.min + Math.floor(random() * (chosen.max - chosen.min + 1)),
    pool: pool.key,
    enchantedBook: chosen.enchantedBook === true,
  };
}

/** 池子里所有可能钓到的东西（断言用：每一项都要指向真的存在的东西） */
export function fishingEntryIds(): number[] {
  return FISHING_POOLS.flatMap((pool) => pool.entries.map((item) => item.id));
}
