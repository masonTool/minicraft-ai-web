/**
 * 战利品表（K8 尾巴 / 结构箱内容的来源）
 *
 * 背景：结构里一直有箱子方块，但**从来没填过东西**——`Structures.ts` 的文件头
 * 写着一句"箱内物品由主线程在区块载入后填充（K/L 系列再做）"，一等就是十几批。
 * 结果就是"钻进地牢打开箱子，里面空空如也"，比没有箱子更让人泄气。
 *
 * 模型刻意简化，但保留原版的骨架：
 *  - **若干轮**（`rollsMin`~`rollsMax`）——原版的 `rolls`
 *  - **每一轮按权重抽一项**（`weight` 越大越常见）——原版的 weighted entries
 *  - **数量区间**（`min`~`max`）——原版的 `set_count` function
 *  - **空手权重**（`id: 0` 的项）——原版的 `empty` entry，占一轮但什么都不给
 *
 * 不做的（TASKS 里记着）：附魔/耐久/改名这些 `functions`、按条件筛选（`conditions`）、
 * `LootPool` 的嵌套与"必选池"。原版那套 JSON 表有几百张、上千条，
 * 抄形状不如先把"有东西可拿"这件事做对。
 *
 * 所有表都只用**本项目已有的物品**：原版表里的鞍 / 马铠 / 唱片 / 附魔书 /
 * 铁粒金粒都还没有（见 TASKS B18 / J 系列），用同类替代品顶上，并在下方逐条注明。
 */

import { Block } from './blocks.ts';
import { Item } from './items.ts';
import { armorItemId } from './armor.ts';
import { toolItemId } from './tools.ts';
// 只用类型：`import type` 让运行时完全不牵扯 `container/`，注册表不反向依赖容器
import type { ItemStack } from '../container/Inventory.ts';

/** 一条候选（`id: 0` 表示"这一轮空手"） */
export interface LootEntry {
  id: number;
  /** 数量区间（含端点）；空手项忽略 */
  min: number;
  max: number;
  /** 权重（相对值） */
  weight: number;
}

export interface LootTable {
  /** 稳定的英文 id（断言与调试用；写进方块状态的是它在 `LOOT_TABLES` 里的下标 + 1） */
  key: string;
  /** 中文名（界面/日志用） */
  name: string;
  rollsMin: number;
  rollsMax: number;
  entries: readonly LootEntry[];
}

/** 便捷构造：`entry(物品, 最小, 最大, 权重)` */
function entry(id: number, min = 1, max = min, weight = 1): LootEntry {
  return { id, min, max, weight };
}

/** 空手项（占一轮，什么都没抽到） */
function empty(weight: number): LootEntry {
  return { id: 0, min: 0, max: 0, weight };
}

/**
 * 八张表，与现有结构的箱子一一对应（见 `Structures.ts` / `EndStructures.ts` 的 `fillState`）。
 *
 * ⚠️ **顺序即 id**：写进方块状态的是"下标 + 1"，所以新表只能往后加，
 * 不能插在中间、也不能删（老存档里的箱子状态会被解释成另一张表）。
 *
 * ⚠️ 原版按"建筑的职业"分表（铁匠铺 / 教堂 / 制箭台…），本项目的村庄**只有一种小屋**
 * （见 `buildHouse`），所以这里也只有一张 `village_house`——**不写用不到的表**：
 * 空挂着的表没人会去维护，还会让人以为村庄里有铁匠铺。
 */
export const LOOT_TABLES: readonly LootTable[] = [
  {
    key: 'village_house',
    name: '村庄小屋',
    rollsMin: 3,
    rollsMax: 8,
    entries: [
      entry(Item.BREAD, 1, 3, 6),
      entry(Item.WHEAT, 1, 4, 6),
      entry(Item.APPLE, 1, 3, 5),
      entry(Item.CARROT, 1, 4, 5),
      entry(Item.POTATO, 1, 4, 5),
      entry(Item.COAL, 1, 3, 4),
      entry(Item.STICK, 1, 4, 4),
      entry(Item.PAPER, 1, 3, 3),
      entry(Item.IRON_INGOT, 1, 2, 2),
      entry(Item.EMERALD, 1, 2, 2), // 原版村庄里绿宝石是硬通货
      entry(Item.WHEAT_SEEDS, 1, 3, 3),
      // 甜菜种子（批次 48）：原版村庄的田里就有，这里放进村庄小屋与矿井的箱子
      entry(Item.BEETROOT_SEEDS, 1, 3, 2),
      empty(6),
    ],
  },
  {
    key: 'mineshaft',
    name: '废弃矿井',
    rollsMin: 2,
    rollsMax: 5,
    entries: [
      entry(Item.COAL, 1, 4, 6),
      entry(Item.IRON_INGOT, 1, 3, 5),
      entry(Item.GOLD_INGOT, 1, 2, 3),
      entry(Item.BREAD, 1, 3, 3),
      entry(Item.STRING, 1, 3, 3),
      entry(Item.BONE, 1, 4, 3),
      entry(Item.WHEAT_SEEDS, 1, 3, 3),
      entry(Item.BEETROOT_SEEDS, 1, 3, 2),
      entry(Item.DIAMOND, 1, 1, 1),
      entry(Item.GOLDEN_APPLE, 1, 1, 1),
      entry(toolItemId('pickaxe', 'iron'), 1, 1, 1),
      empty(6),
    ],
  },
  {
    key: 'dungeon',
    name: '地牢',
    rollsMin: 2,
    rollsMax: 6,
    entries: [
      entry(Item.BONE, 1, 4, 5),
      entry(Item.GUNPOWDER, 1, 3, 5),
      entry(Item.STRING, 1, 3, 4),
      entry(Item.IRON_INGOT, 1, 3, 4),
      entry(Item.GOLD_INGOT, 1, 2, 3),
      entry(Item.BREAD, 1, 3, 3),
      entry(Item.BUCKET, 1, 1, 2),
      entry(Item.DIAMOND, 1, 2, 1),
      entry(Item.GOLDEN_APPLE, 1, 1, 1),
      entry(armorItemId('chestplate', 'iron'), 1, 1, 1),
      empty(5),
    ],
  },
  {
    key: 'stronghold_library',
    name: '要塞图书馆',
    rollsMin: 2,
    rollsMax: 7,
    entries: [
      entry(Item.PAPER, 1, 5, 6),
      entry(Item.BOOK, 1, 3, 6),
      entry(Item.LAPIS_LAZULI, 1, 3, 2),
      entry(Item.IRON_INGOT, 1, 3, 2),
      entry(Item.GOLD_INGOT, 1, 3, 2),
      entry(Item.DIAMOND, 1, 1, 1),
      entry(Item.EMERALD, 1, 1, 1),
      empty(4),
    ],
  },
  {
    key: 'shipwreck_supply',
    name: '沉船补给箱',
    rollsMin: 3,
    rollsMax: 9,
    entries: [
      entry(Item.IRON_INGOT, 1, 5, 6),
      entry(Item.COAL, 1, 4, 5),
      entry(Item.WHEAT, 1, 4, 4),
      entry(Item.BREAD, 1, 3, 4),
      entry(Item.PAPER, 1, 4, 3),
      entry(Item.LEATHER, 1, 3, 3),
      entry(Item.CARROT, 1, 4, 3),
      entry(Item.POTATO, 1, 4, 3),
      entry(Item.GOLD_INGOT, 1, 3, 3),
      entry(Item.EMERALD, 1, 2, 2),
      entry(Item.LAPIS_LAZULI, 1, 3, 2),
      entry(Item.DIAMOND, 1, 1, 1),
      empty(5),
    ],
  },
  {
    key: 'shipwreck_treasure',
    name: '沉船宝箱',
    rollsMin: 2,
    rollsMax: 6,
    entries: [
      entry(Item.IRON_INGOT, 1, 5, 5),
      entry(Item.GOLD_INGOT, 1, 5, 5),
      entry(Item.EMERALD, 1, 5, 4),
      entry(Item.LAPIS_LAZULI, 1, 5, 3),
      entry(Item.COAL, 1, 4, 3),
      entry(Item.DIAMOND, 1, 2, 2),
      entry(Item.GOLDEN_APPLE, 1, 1, 1),
      entry(Item.NETHERITE_SCRAP, 1, 1, 1), // 原版沉船没有它；这里是"下界合金唯一的宝箱来源"
      empty(3),
    ],
  },
  {
    key: 'mansion',
    name: '林地府邸',
    rollsMin: 2,
    rollsMax: 6,
    entries: [
      entry(Item.IRON_INGOT, 1, 5, 5),
      entry(Item.GOLD_INGOT, 1, 5, 4),
      entry(Item.BREAD, 1, 3, 3),
      entry(Item.LAPIS_LAZULI, 1, 3, 3),
      entry(Item.EMERALD, 1, 3, 2),
      entry(Item.DIAMOND, 1, 2, 2),
      entry(Item.GOLDEN_APPLE, 1, 1, 1),
      entry(armorItemId('chestplate', 'diamond'), 1, 1, 1),
      empty(3),
    ],
  },
  {
    key: 'end_city',
    name: '末地城',
    rollsMin: 2,
    rollsMax: 6,
    entries: [
      entry(Item.DIAMOND, 1, 4, 5),
      entry(Item.IRON_INGOT, 1, 5, 5),
      entry(Item.GOLD_INGOT, 1, 5, 5),
      entry(Item.EMERALD, 1, 5, 4),
      entry(Item.LAPIS_LAZULI, 1, 4, 3),
      entry(Item.GOLDEN_APPLE, 1, 1, 2),
      entry(toolItemId('sword', 'diamond'), 1, 1, 1),
      empty(3),
    ],
  },
  // ---- 堡垒遗迹（K8 收尾，批次 82）：下界唯一一座"值得为箱子跑一趟"的建筑。
  // 原版它有三张表（treasure / other / bridge），这里两张：本项目的堡垒是**一种**布局，
  // 而"用不到的表不要写"（空挂着的表没人维护，还会让人以为有别的房间）
  {
    key: 'bastion_treasure',
    name: '堡垒遗迹（宝库）',
    rollsMin: 3,
    rollsMax: 4,
    entries: [
      // 原版这张表的主角是**下界合金锭**（1 个、权重极低）与**两个金块**
      entry(Item.NETHERITE_INGOT, 1, 1, 2),
      entry(Item.DIAMOND, 1, 3, 5),
      entry(Item.GOLD_INGOT, 3, 9, 6),
      entry(Item.GOLD_NUGGET, 5, 12, 6),
      entry(Item.QUARTZ, 4, 10, 5),
      entry(Block.GILDED_BLACKSTONE, 1, 3, 4),
      entry(Item.MAGMA_CREAM, 1, 3, 3),
      entry(Item.GOLDEN_APPLE, 1, 1, 3),
      entry(armorItemId('leggings', 'golden'), 1, 1, 2),
      entry(Item.ARROW, 4, 12, 3),
      entry(Block.OBSIDIAN, 1, 3, 2),
      empty(4),
      // ⚠️ 差异：原版这张表还有**附魔金苹果**、**猪灵音乐唱片（Pigstep）**、
      // **下界合金剑**——本项目没有附魔金苹果、没有唱片机/唱片、也没有"带附魔的装备"
      // 这种掉落（`LootEntry` 表达不了附魔），只能少放几样，**不拿别的东西顶替**
    ],
  },
  {
    key: 'bastion_other',
    name: '堡垒遗迹（杂物）',
    rollsMin: 2,
    rollsMax: 3,
    entries: [
      entry(Item.ARROW, 6, 12, 6),
      entry(Item.STRING, 1, 6, 5),
      entry(Item.LEATHER, 1, 3, 4),
      entry(Item.GOLD_NUGGET, 2, 6, 5),
      entry(Item.QUARTZ, 2, 6, 4),
      entry(Item.GLOWSTONE_DUST, 1, 4, 3),
      entry(Item.MAGMA_CREAM, 1, 2, 2),
      entry(armorItemId('chestplate', 'chainmail'), 1, 1, 2),
      entry(Item.GOLD_INGOT, 1, 3, 2),
      entry(Item.BONE, 2, 6, 3),
      entry(Item.IRON_INGOT, 1, 3, 2),
      empty(5),
      // ⚠️ 差异：原版有**灵魂疾行附魔书**、**铁粒/金粒**以外的金属粒、
      // 以及**旗帜图案**，这几样本项目都还没有
    ],
  },
  // ---- 末地正门（K9 收口，批次 111）：**要塞传送门房**的那一个箱子。
  //
  // 珍珠的那一段数量**走过一次"临时放大再压回来"**，值得记一笔：
  // 批次 111 做末地传送门时还没有末影人（J13），而点亮一圈框架要
  // **12 只末影之眼 = 12 颗珍珠**，所以当时把这张表放大到期望 16.5 颗，
  // 并在 `test:endportal` 里留了一条"生物表里没有任何生物掉珍珠"的断言当警铃。
  // **批次 112 末影人落地，铃声一响就把这里压回原版量**（2~3 颗、低权重，
  // 与原版 `stronghold_corridor` 同一档）——珍珠的正经来源回到"打末影人"，
  // 这个箱子只是"跑要塞时的零头"。
  {
    key: 'stronghold_portal',
    name: '要塞传送门房',
    rollsMin: 5,
    rollsMax: 7,
    entries: [
      entry(Item.ENDER_PEARL, 2, 3, 10),
      entry(Item.IRON_INGOT, 1, 5, 8),
      entry(Item.GOLD_INGOT, 1, 3, 6),
      entry(Item.REDSTONE, 4, 9, 5),
      entry(Item.COAL, 3, 8, 5),
      entry(Item.BREAD, 1, 3, 4),
      entry(Item.APPLE, 1, 3, 4),
      entry(Item.DIAMOND, 1, 3, 3),
      entry(toolItemId('pickaxe', 'iron'), 1, 1, 3),
      entry(toolItemId('sword', 'iron'), 1, 1, 3),
      entry(Item.GOLDEN_APPLE, 1, 1, 2),
      empty(6),
    ],
  },
];

/** 序号 1 起的表（0 = 这一格没有战利品表，是玩家自己放的箱子） */
export function lootTableByIndex(index: number): LootTable | null {
  if (!Number.isInteger(index) || index < 1 || index > LOOT_TABLES.length) return null;
  return LOOT_TABLES[index - 1]!;
}

/** 表 → 写进方块状态的序号（1 起） */
export function lootTableIndex(key: string): number {
  const index = LOOT_TABLES.findIndex((table) => table.key === key);
  return index < 0 ? 0 : index + 1;
}

/** 能不能用 4 位状态位装下（`blockState.ts` 给箱子留了 bits 4-7） */
export const LOOT_INDEX_MAX = 15;

/**
 * 掷点：把结果追加进 `out`（一轮一项，**不合并**同类——原版也是这样，
 * 三次都抽到煤炭就是三格煤炭；合并会让箱子的"手感"变样）。
 *
 * @param random 0~1 的随机源（`PositionalRng#next` 或 `Math.random`）
 */
export function rollLoot(table: LootTable, random: () => number, out: ItemStack[] = []): ItemStack[] {
  const total = table.entries.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return out;
  const span = table.rollsMax - table.rollsMin;
  const rolls = table.rollsMin + Math.floor(random() * (span + 1));

  for (let roll = 0; roll < rolls; roll++) {
    let pick = random() * total;
    for (const item of table.entries) {
      pick -= item.weight;
      if (pick >= 0) continue;
      // 空手项：占一轮，什么都不给
      if (item.id === 0) break;
      const count = item.min + Math.floor(random() * (item.max - item.min + 1));
      if (count > 0) out.push({ id: item.id, count });
      break;
    }
  }
  return out;
}

/**
 * 表里的物品/数量是否合法（离线断言用，也顺手防住"手滑写了 0 权重"）。
 * @returns 问题描述数组（空数组 = 全都没问题）
 */
export function validateLootTables(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  if (LOOT_TABLES.length > LOOT_INDEX_MAX) {
    problems.push(`表数量 ${LOOT_TABLES.length} 超过状态位能表示的 ${LOOT_INDEX_MAX} 张`);
  }
  for (const table of LOOT_TABLES) {
    if (seen.has(table.key)) problems.push(`${table.key}: 表 id 重复`);
    seen.add(table.key);
    if (table.rollsMin < 1 || table.rollsMax < table.rollsMin) {
      problems.push(`${table.key}: 轮次区间不合法（${table.rollsMin}~${table.rollsMax}）`);
    }
    if (table.entries.length === 0) problems.push(`${table.key}: 一条候选都没有`);
    const hasReward = table.entries.some((item) => item.id !== 0);
    if (!hasReward) problems.push(`${table.key}: 全是空手项，箱子永远是空的`);
    for (const item of table.entries) {
      if (item.weight <= 0) problems.push(`${table.key}: 权重必须为正（${item.id}）`);
      if (item.id === 0) continue;
      if (item.min < 1 || item.max < item.min) {
        problems.push(`${table.key}: 数量区间不合法（${item.id} ${item.min}~${item.max}）`);
      }
    }
  }
  return problems;
}

/** 表里出现过的物品 id（断言"有没有用不存在的物品"用） */
export function lootItemIds(): number[] {
  const ids = new Set<number>();
  for (const table of LOOT_TABLES) for (const item of table.entries) if (item.id !== 0) ids.add(item.id);
  return [...ids];
}
