/**
 * 支撑没了，该掉的就掉（批次 78，B49）。
 *
 * 与**放置侧**成对：`Placement.ts` 早就挡住了"悬空放植物"（`cross` 要求下方是实心方块），
 * 但反过来"支撑被拆掉之后上面那株还挂着"一直没做——TASKS 里只记了藤蔓那一条
 * （"需要方块变动通知邻居这条通道"）。这一批把**地表支撑**这一半补上：
 *
 *  | 形状 | 支撑 | 例子 |
 *  | --- | --- | --- |
 *  | `cross` | 下方是**实心方块**（与放置侧同一条判据） | 花、草、树苗、瓜藤、四种作物、甘蔗 |
 *  | `cactus` | 下方是**实心方块**（原版是沙子） | 仙人掌 |
 *  | `flat` | 下方是**实心方块** | 红石线、铁轨、雪层 |
 *  | 水里的植物（`waterPlant`） | 那一格是水，或下方是水/同一种植物 | 海带、海草、珊瑚丛 |
 *  | 睡莲 | 下方是水 | 睡莲 |
 *  | `torch` / `ladder` | **暂不处理**（贴附面那一类：要看它贴的是哪一面，见 TASKS B49） | 火把、梯子、藤蔓 |
 *
 * 两条设计：
 *  1. **与放置侧共用"什么算支撑"的判据**（`blockDef(below).solid`）——放得下和立得住必须是同一套，
 *     否则会出现"能放上去但站不住"或反过来的怪状态；
 *  2. **往上连锁**（`sweepUnsupported` 会一路检查上去）：拆掉甘蔗下面那格沙子，
 *     整根甘蔗要一节节掉完，而不是只掉最下面那节、上面几节悬在空中。
 *
 * ⚠️ 触发点是"某个方块被移除之后"（破坏、爆炸），**活塞推动与方块变动通知**还没接：
 * 那条更宽的通道（"任何方块变动都通知邻居重算"）留给需要时再做，这里先把最常见的
 * "挖掉脚下那格"接上。
 */

import { Block, blockDef } from '../registry/blocks.ts';

/** 只读一格、写一格（与 `BoneMeal.ts` / `Dispense.ts` 同一路注入方式） */
export interface SupportWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, blockId: number): void;
}

/** 这一类方块的支撑是什么 */
export type SupportKind =
  /** 下方必须是实心方块 */
  | 'solid'
  /** 那一格（或下方）必须是水：海草/珊瑚丛这样长在水里的 */
  | 'water'
  /** 海带：水，或下方是同一节海带（续长的那一节） */
  | 'waterOrSelf'
  /** 睡莲：下方是水 */
  | 'waterBelow'
  /** 不处理（贴附面那一类，见文件头） */
  | 'none';

/**
 * 这个方块要什么样的支撑。
 *
 * 判据顺序与 `Placement.ts` 一致：**先看"水里的植物"，再按形状分**——
 * 海带/海草/珊瑚丛也是 `cross` 形状，但它们的支撑是水而不是实心方块。
 */
export function supportKindOf(id: number): SupportKind {
  if (id === Block.AIR) return 'none';
  const def = blockDef(id);
  if (def.waterPlant) return id === Block.KELP ? 'waterOrSelf' : 'water';
  if (def.shape === 'lily_pad') return 'waterBelow';
  // ⚠️ 仙人掌的形状是 `cactus`（不是 `cross`）：它同样要求下方是实心方块（原版是沙子）。
  // 这一类"形状名与判据不同名"的地方最容易漏——本批就是断言把仙人掌漏掉的那次抓出来的。
  if (def.shape === 'cross' || def.shape === 'flat' || def.shape === 'cactus') return 'solid';
  // `torch` / `ladder` / 其它：**暂不处理**（贴附面那一类要看状态里的朝向）
  return 'none';
}

/** 把某一格当"支撑"看，它够格吗 */
function isSolidSupport(id: number): boolean {
  return id !== Block.AIR && blockDef(id).solid;
}

/**
 * (x, y, z) 这一格**自己**现在立得住吗。
 *
 * ⚠️ 空气永远算"立得住"：这个函数只回答"这一格需不需要支撑、支撑还在不在"，
 * 不需要支撑的方块（石头、箱子…）一律返回 true，调用方不必自己筛。
 */
export function supportIsValid(world: SupportWorld, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  const kind = supportKindOf(id);
  if (kind === 'none') return true;
  const below = world.getBlock(x, y - 1, z);

  if (kind === 'solid') return isSolidSupport(below);
  if (kind === 'waterBelow') return below === Block.WATER;
  if (kind === 'water') {
    // 那一格自己（水草在水里）或下方是水
    return world.getBlock(x, y, z) === Block.WATER || below === Block.WATER;
  }
  // waterOrSelf（海带）：水，或下方还是海带
  return below === Block.WATER || below === Block.KELP;
}

/**
 * 从 (x, y, z) **往上**一路收拾立不住的方块。
 *
 * @param onChange 每移除一格回调一次（掉落物、联机广播、粒子都由调用方决定）；
 *                 不传就当"直接蒸发"（离线断言里常用这个）
 * @returns 移除了几格
 *
 * ⚠️ 起点是"刚被移除的那一格的**上面**那一格"：拆掉脚下的方块之后，
 * 要检查的是站在它上面的东西。连锁往上是因为甘蔗/海带这种是**一柱**，
 * 只检查一格的话上面几节会悬空。
 */
export function sweepUnsupported(
  world: SupportWorld,
  x: number,
  y: number,
  z: number,
  onChange?: (x: number, y: number, z: number, blockId: number) => void,
): number {
  let removed = 0;
  // 上限 64 格：既是"一柱植物"的合理上界，也防止手改存档造出的死循环
  for (let offset = 0; offset < 64; offset++) {
    const cy = y + offset;
    const id = world.getBlock(x, cy, z);
    if (id === Block.AIR) break;
    if (supportIsValid(world, x, cy, z)) break;
    world.setBlock(x, cy, z, Block.AIR);
    onChange?.(x, cy, z, id);
    removed++;
  }
  return removed;
}
