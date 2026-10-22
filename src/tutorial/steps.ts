/**
 * 新手引导的**步骤数据**（批次 20261022-1954 · 引导1）
 *
 * 这一层只有数据：每一步叫什么、图标是哪件东西、**什么算完成**。
 * 判定与状态在 `TutorialTracker.ts`（纯逻辑，可离线断言），界面在后续的
 * `ui/TutorialCard.ts`——与成就系统（`core/progress/`）同一条分工：
 * 「能写成数据的别写成 30 处 if」。
 *
 * 三条口径（都有断言守着）：
 *
 *  1. **不做第二套进度系统**：这里只有 12 步手写路标，不往 100 条成就里加条目，
 *     也不复用它的解锁语义（成就的"父没达成子不能拿"不适合教学路径）。
 *  2. **判定按"事实"而不是按界面**：`obtain`（背包里出现过）与
 *     `place`（放下某方块，可带 y）两种事实，足够覆盖这 12 步；
 *     主程序在既有事件点各报一次即可。
 *  3. **元素族用方块名判**，不手抄 6 种原木 / 16 种床的 id：
 *     加一种木材时这里不用回来改（`familyOfItem` 就是那条唯一判据）。
 */

import { Block, blockDef, woolId } from '../core/registry/blocks.ts';
import { toolItemId } from '../core/registry/tools.ts';

/** 两条路径：生存（开荒 4 步）与创造（建造小目标 4 步） */
export type TutorialTrack = 'survival' | 'creative';

/**
 * "家族"只覆盖引导要问的两类：
 *  - `log`：任意原木 / 树皮方块（`*_log` / `*_wood`，含剥皮原木）；
 *  - `door`：门 / 活板门 / 栅栏门（对小朋友不苛求"必须是门"）。
 *
 * ⚠️ 床那一族随"床"这一步一起删掉了（2026-10-22 用户：生存做到石镐就够）。
 */
export type TutorialFamily = 'log' | 'door';

/** 一步的完成条件 */
export type TutorialGoal =
  /** 背包里出现过这件物品（挖到 / 合出 / 烧出 / 捡到都算，与成就同口径） */
  | { readonly kind: 'obtain'; readonly item: number }
  /** 背包里出现过该家族的任意一件 */
  | { readonly kind: 'obtainFamily'; readonly family: TutorialFamily }
  /** 放下过该家族的任意一件 */
  | { readonly kind: 'placeFamily'; readonly family: TutorialFamily }
  /** 累计放下过 `count` 个方块 */
  | { readonly kind: 'placeCount'; readonly count: number }
  /** 放下的方块分布在至少 `layers` 个高度层（"搭起来"的最低要求） */
  | { readonly kind: 'placeLayers'; readonly layers: number }
  /** 放下过至少 `count` 种不同的方块（"换颜色"） */
  | { readonly kind: 'placeKinds'; readonly count: number };

export interface TutorialStep {
  /** 稳定 id（存档里存它；改了就等于让老存档那一步失效） */
  readonly id: string;
  readonly track: TutorialTrack;
  /** 卡片标题的 i18n 键 */
  readonly titleKey: string;
  /** 卡片说明的 i18n 键 */
  readonly descKey: string;
  /** 卡片图标（物品 id；直接用注册表里那件东西，不另画一套） */
  readonly icon: number;
  readonly goal: TutorialGoal;
}

/**
 * 生存 4 步：**从第一棵树到石镐**。
 *
 * ⚠️ 2026-10-22（用户）："基本做到石镐就够了，不用太多"。
 * 原来还有熔炉 / 铁镐 / 床 / 小屋四步，但铁要挖到 y≈16（地表往下 45~50 格）再烧，
 * 对刚上手的人是一整条长链，卡在中间的人只会把卡片关掉。所以**只教到"能挖石头"**，
 * 剩下的留给玩家自己探索（原创世界引导 8 步的决策见 `notes/kids-features.md`，
 * 那份是历史留档，不再作为当前步骤表）。
 *
 * 顺序是教学路径：**当前这一步先满足才进下一步**，不做越级跳过——
 * 否则"第一步撸木头"会在玩家已经拿到石镐时被无声跳过，教学路径就断了。
 * 但"一件事同时满足好几步"时会连续推进（见 `TutorialTracker.advance()`）。
 */
const SURVIVAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'survival/log',
    track: 'survival',
    titleKey: 'tutorial.survival.log.title',
    descKey: 'tutorial.survival.log.desc',
    icon: Block.OAK_LOG,
    goal: { kind: 'obtainFamily', family: 'log' },
  },
  {
    id: 'survival/table',
    track: 'survival',
    titleKey: 'tutorial.survival.table.title',
    descKey: 'tutorial.survival.table.desc',
    icon: Block.CRAFTING_TABLE,
    goal: { kind: 'obtain', item: Block.CRAFTING_TABLE },
  },
  {
    id: 'survival/wood_pickaxe',
    track: 'survival',
    titleKey: 'tutorial.survival.woodPickaxe.title',
    descKey: 'tutorial.survival.woodPickaxe.desc',
    icon: toolItemId('pickaxe', 'wooden'),
    goal: { kind: 'obtain', item: toolItemId('pickaxe', 'wooden') },
  },
  {
    id: 'survival/stone_pickaxe',
    track: 'survival',
    titleKey: 'tutorial.survival.stonePickaxe.title',
    descKey: 'tutorial.survival.stonePickaxe.desc',
    icon: toolItemId('pickaxe', 'stone'),
    goal: { kind: 'obtain', item: toolItemId('pickaxe', 'stone') },
  },
];

/**
 * 创造 4 步：**让第一次进游戏的小朋友先"造点什么"**。
 *
 * 不用"盖一座房子"当目标——那太远；四步都能在 2 分钟内做到，
 * 每完成一步就有一张新卡，节奏比"一个大目标"更适合低龄。
 */
const CREATIVE_STEPS: readonly TutorialStep[] = [
  {
    id: 'creative/place10',
    track: 'creative',
    titleKey: 'tutorial.creative.place10.title',
    descKey: 'tutorial.creative.place10.desc',
    icon: Block.GRASS_BLOCK,
    goal: { kind: 'placeCount', count: 10 },
  },
  {
    id: 'creative/layers',
    track: 'creative',
    titleKey: 'tutorial.creative.layers.title',
    descKey: 'tutorial.creative.layers.desc',
    icon: Block.STONE,
    goal: { kind: 'placeLayers', layers: 3 },
  },
  {
    id: 'creative/colors',
    track: 'creative',
    titleKey: 'tutorial.creative.colors.title',
    descKey: 'tutorial.creative.colors.desc',
    icon: woolId(14),
    goal: { kind: 'placeKinds', count: 3 },
  },
  {
    id: 'creative/door',
    track: 'creative',
    titleKey: 'tutorial.creative.door.title',
    descKey: 'tutorial.creative.door.desc',
    icon: Block.OAK_DOOR,
    goal: { kind: 'placeFamily', family: 'door' },
  },
];

/** 全部步骤（生存 4 + 创造 4；测试与界面都从这里取） */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [...SURVIVAL_STEPS, ...CREATIVE_STEPS];

/** 某条路径的步骤（保持表内顺序） */
export function stepsOf(track: TutorialTrack): readonly TutorialStep[] {
  return TUTORIAL_STEPS.filter((step) => step.track === track);
}

/**
 * 物品/方块属于哪个"家族"。
 *
 * ⚠️ 用**方块名**判，不维护 id 表：`blockDef` 对越界 id 返回空气（`minecraft:air`），
 * 所以铁锭、木镐这类非方块物品会安全地落到 `null`。
 */
export function familyOfItem(itemId: number): TutorialFamily | null {
  const name = blockDef(itemId).name;
  if (name.endsWith('_log') || name.endsWith('_wood')) return 'log';
  if (name.endsWith('_door') || name.endsWith('_trapdoor') || name.endsWith('_fence_gate')) return 'door';
  return null;
}
