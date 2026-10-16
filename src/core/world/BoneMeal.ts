/**
 * 骨粉（批次 69 起，B42 / B46）：把一格**能长东西的方块**往前催一程。
 *
 * 为什么单独一个模块、而不是写在 `main.ts` 的右键分支里：判定本身（催几阶、截到成熟、
 * 什么不该被催）是这几批真正要断言的东西，而它只需要"读一格、写一格"两件事。
 * 照 `TickWorld` / `Dispense.ts` 的惯例，把这两件事收成一个最小接口注入进来，
 * 于是它能在离线测试里用假世界逐条钉住（随机源也从参数进，序列可复现）。
 *
 * **一批一条规则往表里加**（B42 做作物、B46 补齐其余）：
 *
 * | 对着什么用 | 原版行为 | 这里 |
 * | --- | --- | --- |
 * | 耕地作物（小麦/胡萝卜/马铃薯/甜菜根） | 年龄 +2~5（截到成熟） | ✅ 同一算法 |
 * | 甜浆果丛 / 可可豆 | 阶段 +1 | ✅ |
 * | 竹子 | 往上长 1~2 节（有高度上限） | ✅ 长 1 节（与原版同一个上限常量） |
 * | 草方块 | 在附近随机长出一株草或花 | ✅ 附近 3×3×2 里随机挑一格 |
 * | 树苗 | 长成一棵树 | ❌ 树苗这件物品本身还没有 |
 * | 甘蔗 / 海带 / 仙人掌 / 藤蔓 / 蘑菇 | 原版**不响应**（别想当然给它们也加） | ✅ 也返回失败 |
 *
 * 三条与原版对齐、且都容易被想当然写错的：
 *  1. **作物一次推进 2~5 个阶段**（`CropBlock#performBonemeal` 的 `nextInt(2, 5)`，闭区间）
 *     ——不是"一阶"；所以骨粉对早期作物效果明显、对快成熟的常常一步到位。
 *  2. **不检查光照、也不检查下方是不是耕地**：原版施肥只看"这一格能不能施肥、是不是还没到头"。
 *     耕地被挖掉的作物照样能被催熟（它会在下一次随机刻里自然掉掉）。
 *  3. **失败不消耗**：任何一条不满足就返回 `null`，调用方据此**不吃掉**这一份骨粉。
 */

import {
  BERRY_STAGES,
  Block,
  COCOA_STAGES,
  CROP_STAGES,
  berryStageOf,
  cocoaStageOf,
  cropOf,
} from '../registry/blocks.ts';
import { BAMBOO_MAX_HEIGHT } from '../tick/RandomTicks.ts';

/** 施肥只需要"读一格、写一格" */
export interface BoneMealWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, blockId: number): void;
}

/** 一次施肥**至少**推进几个阶段（原版 `nextInt(2, 5)` 的下界） */
export const BONE_MEAL_MIN_STAGES = 2;
/** 一次施肥**至多**推进几个阶段（闭区间上界） */
export const BONE_MEAL_MAX_STAGES = 5;

/**
 * 草方块上能"撒"出来的植物（原版 `BoneMealItem` 的那张表）。
 *
 * ⚠️ 原版里**矮草的概率明显更高**（其余几种花等概率）：这里用"矮草在表里出现三次"
 * 来近似那个权重，而不是另写一张概率表——权重只有一处、而且一眼看得出谁更常见。
 */
export const BONE_MEAL_PLANTS: readonly number[] = [
  Block.SHORT_GRASS,
  Block.SHORT_GRASS,
  Block.SHORT_GRASS,
  Block.DANDELION,
  Block.POPPY,
  Block.BLUE_ORCHID,
  Block.OXEYE_DAISY,
  Block.CORNFLOWER,
];

/** 草方块催草的扫描范围：水平 ±1、竖直 0~1（对齐原版那圈 3×3×2） */
const GRASS_RADIUS = 1;

/** 施肥改动了哪一格（调用方要用它做粒子、音效与联机广播——催草改的是**旁边**那一格） */
export interface FertilizeResult {
  x: number;
  y: number;
  z: number;
  /** 写成什么方块（粒子颜色按它取） */
  blockId: number;
}

/**
 * 给 (x, y, z) 那一格施一次肥。
 *
 * @param random 注入的随机源（催几阶 / 挑哪一格草 / 长什么植物都用它）
 * @returns 改动的那一格；`null` = 这一格不能催（调用方**不要消耗**这一份骨粉）
 */
export function fertilizeAt(
  world: BoneMealWorld,
  x: number,
  y: number,
  z: number,
  random: () => number,
): FertilizeResult | null {
  const id = world.getBlock(x, y, z);

  // ---- ① 耕地作物：年龄 +2~5（截到成熟）
  const crop = cropOf(id);
  if (crop) {
    if (crop.ripe) return null;
    const stages = CROP_STAGES[crop.crop]!;
    const span = BONE_MEAL_MAX_STAGES - BONE_MEAL_MIN_STAGES + 1;
    const step = BONE_MEAL_MIN_STAGES + Math.floor(random() * span);
    // 截到最后一个阶段：成熟的停在成熟，不会"长过头"
    const next = Math.min(stages.length - 1, crop.stage + step);
    const blockId = stages[next]!;
    world.setBlock(x, y, z, blockId);
    return { x, y, z, blockId };
  }

  // ---- ② 甜浆果丛 / 可可豆：阶段 +1（它们不在 `CROP_STAGES` 里，判定与掉落都不一样）
  const berry = berryStageOf(id);
  if (berry >= 0) {
    if (berry >= BERRY_STAGES.length - 1) return null;
    const blockId = BERRY_STAGES[berry + 1]!;
    world.setBlock(x, y, z, blockId);
    return { x, y, z, blockId };
  }
  const cocoa = cocoaStageOf(id);
  if (cocoa >= 0) {
    if (cocoa >= COCOA_STAGES.length - 1) return null;
    const blockId = COCOA_STAGES[cocoa + 1]!;
    world.setBlock(x, y, z, blockId);
    return { x, y, z, blockId };
  }

  // ---- ③ 竹子：往上长 1 节（高度上限与原版一致，用的是甘蔗/竹子共用那个常量）
  if (id === Block.BAMBOO) {
    // 往上找到这一柱的顶端（正上方是空气的那一节）
    let top = y;
    while (world.getBlock(x, top + 1, z) === Block.BAMBOO) top++;
    if (world.getBlock(x, top + 1, z) !== Block.AIR) return null;
    let height = 1;
    while (height < 64 && world.getBlock(x, top - height, z) === Block.BAMBOO) height++;
    if (height >= BAMBOO_MAX_HEIGHT) return null;
    world.setBlock(x, top + 1, z, Block.BAMBOO);
    return { x: x, y: top + 1, z, blockId: Block.BAMBOO };
  }

  // ---- ④ 草方块：在旁边随机长一株草或花（**改的是邻居那一格**，所以返回值一定要带上坐标）
  if (id === Block.GRASS_BLOCK) {
    const spots: { x: number; y: number; z: number }[] = [];
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = -GRASS_RADIUS; dx <= GRASS_RADIUS; dx++) {
        for (let dz = -GRASS_RADIUS; dz <= GRASS_RADIUS; dz++) {
          const gx = x + dx;
          const gy = y + dy;
          const gz = z + dz;
          if (world.getBlock(gx, gy, gz) !== Block.GRASS_BLOCK) continue;
          if (world.getBlock(gx, gy + 1, gz) !== Block.AIR) continue;
          spots.push({ x: gx, y: gy, z: gz });
        }
      }
    }
    if (spots.length === 0) return null;
    const spot = spots[Math.min(spots.length - 1, Math.floor(random() * spots.length))]!;
    const blockId = BONE_MEAL_PLANTS[Math.min(BONE_MEAL_PLANTS.length - 1, Math.floor(random() * BONE_MEAL_PLANTS.length))]!;
    world.setBlock(spot.x, spot.y + 1, spot.z, blockId);
    return { x: spot.x, y: spot.y + 1, z: spot.z, blockId };
  }

  // ---- 其余一律不行（**包括原版也不响应的**：甘蔗、海带、仙人掌、藤蔓、蘑菇…）
  return null;
}
