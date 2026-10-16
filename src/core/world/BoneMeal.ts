/**
 * 骨粉（批次 69，B42 / H13）：把一格**作物**往前催几个阶段。
 *
 * 为什么单独一个模块、而不是写在 `main.ts` 的右键分支里：判定本身（催几阶、截到成熟、
 * 什么不该被催）是这一批真正要断言的的东西，而它只需要"读一格、写一格"两件事。
 * 照 `TickWorld` / `Dispense.ts` 的惯例，把这两件事收成一个最小接口注入进来，
 * 于是它能在离线测试里用假世界逐条钉住（`Math.random` 也从参数进，序列可复现）。
 *
 * 与原版对齐的两条（都容易被想当然写错）：
 *  1. **一次推进 2~5 个阶段**（`CropBlock#performBonemeal` 里是
 *     `Math.min(maxAge, age + random.nextInt(2, 5))`，即 2~5 闭区间）——不是"一阶"。
 *     所以骨粉对早期作物效果明显、对快成熟的作物常常一步到位。
 *  2. **不检查光照、也不检查下方是不是耕地**：原版施肥只看"这一格是不是能施肥的作物、
 *     是不是还没成熟"。耕地被挖掉的作物照样能被催熟（它会在下一次随机刻里自然掉掉）。
 *
 * ⚠️ 没接上的部分（原版骨粉还能做的，记在 TASKS B42）：树苗/竹子/甘蔗/海带/甜浆果丛/
 * 可可豆/草与花的催熟——这些要么对应方块还没做（树苗），要么各自有独立的生长逻辑，
 * 留到需要时再一条条接（本批只做四种耕地作物）。
 */

import { CROP_STAGES, cropOf } from '../registry/blocks.ts';

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
 * 给 (x, y, z) 那一格施一次肥。
 *
 * @param random 注入的随机源（只用来决定"推 2~5 阶"里的那个数）
 * @returns 施肥成功了吗（`false` = 这一格不能催：不是作物，或者已经成熟）——
 *          调用方据此决定**要不要消耗**这一份骨粉（原版失败不消耗）
 */
export function fertilizeAt(
  world: BoneMealWorld,
  x: number,
  y: number,
  z: number,
  random: () => number,
): boolean {
  const crop = cropOf(world.getBlock(x, y, z));
  if (!crop || crop.ripe) return false;

  const stages = CROP_STAGES[crop.crop]!;
  const span = BONE_MEAL_MAX_STAGES - BONE_MEAL_MIN_STAGES + 1;
  const step = BONE_MEAL_MIN_STAGES + Math.floor(random() * span);
  // 截到最后一个阶段：成熟的停在成熟，不会"长过头"
  const next = Math.min(stages.length - 1, crop.stage + step);
  world.setBlock(x, y, z, stages[next]!);
  return true;
}
