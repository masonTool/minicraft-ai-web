/**
 * 织布机（批次 503，J25 的最后一台工作站）
 *
 * 三格：**旗帜 + 染料 → 成品**。与原版同构，但本项目的"图案"是**物品数据**
 * （`ItemStack.bannerPattern`，批次 502），不是方块状态——所以这里改的是栈上的一个数，
 * 玩家把成品拿走、放下时由 `Placement` 写回方块状态位。
 *
 * 两条与原版的差异（都记在 TASKS J25）：
 *  1. 图案只有 4 种（原版 20+），也没有"旗帜图案物品"这一层——图案直接在列表里选；
 *  2. **染料只当消耗**：贴图是"16 色底 × 4 图案"预生成的，图案色由底面亮度自动取反色，
 *     不是由染料颜色决定（要做成染料决定颜色得再乘 16 色，图集装不下）。
 *
 * 与切石机不同构的地方：切石机是"输入 → 一列可选产物"，这里是"两样输入 → 一种产物"，
 * 而且**产物槽是算出来的**（`isComputedResultSlot`）：拆织布机时不许把它倒出来，
 * 否则"放一面旗 + 一个染料、点一下、拆机器"就能白拿一面旗（铁砧踩过这个口子）。
 */

import { isBannerId } from '../registry/blocks.ts';
import { BANNER_PATTERN_COUNT } from '../registry/blockState.ts';
import { DYE_COLORS } from '../registry/colors.ts';
import { DYE_ITEM_START } from '../registry/items.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

export const LOOM_BANNER = 0;
export const LOOM_DYE = 1;
export const LOOM_OUTPUT = 2;
export const LOOM_SIZE = 3;

/** 可选的图案编号（0 = 光板不在列表里：织布机不会"把图案洗掉"） */
export const LOOM_PATTERNS: readonly number[] = Array.from(
  { length: BANNER_PATTERN_COUNT - 1 },
  (_value, index) => index + 1,
);

/** 这一件是不是染料（16 种 id 连续，见 `DYE_ITEM_START` 的注释） */
export function isDyeItem(itemId: number): boolean {
  return itemId >= DYE_ITEM_START && itemId < DYE_ITEM_START + DYE_COLORS.length;
}

/**
 * 这次印图案行不行；不行就返回**给人看的原因**（行就返回 null）。
 *
 * 判据顺序按"玩家最可能踩到的那一条"排：先看有没有旗、再看染料、最后看成品格。
 * 顺序会直接出现在界面提示里，所以不要随手调换。
 */
export function loomBlocker(
  banner: ItemStack | null,
  dye: ItemStack | null,
  pattern: number,
  output: ItemStack | null,
): string | null {
  if (!banner) return '先放一面旗帜';
  if (!isBannerId(banner.id)) return '这一格只收旗帜';
  if (!Number.isInteger(pattern) || pattern <= 0 || pattern >= BANNER_PATTERN_COUNT) {
    return '没有这种图案';
  }
  if ((banner.bannerPattern ?? 0) === pattern) return '这面旗帜已经是这个图案了';
  if (!dye) return '还需要 1 个染料';
  if (!isDyeItem(dye.id)) return '染料格里得放染料';
  if (output) {
    // 成品格里只能继续堆"同一面旗的同一个图案"：混着放会让玩家拿错颜色
    if (output.id !== banner.id) return '先把成品格里的东西拿走';
    if ((output.bannerPattern ?? 0) !== pattern) return '成品格里是另一种图案';
    if (output.count >= 64) return '成品格已经满了';
  }
  return null;
}

export class Loom implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(LOOM_SIZE).fill(null);

  onChange: (() => void) | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= LOOM_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= LOOM_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.onChange?.();
  }

  get banner(): ItemStack | null {
    return this.get(LOOM_BANNER);
  }

  get dye(): ItemStack | null {
    return this.get(LOOM_DYE);
  }

  get output(): ItemStack | null {
    return this.get(LOOM_OUTPUT);
  }

  /** 这一项现在能不能印（界面用它在按钮上标灰/提示） */
  blockerFor(pattern: number): string | null {
    return loomBlocker(this.banner, this.dye, pattern, this.output);
  }

  /**
   * 印一次：**消耗 1 面旗 + 1 个染料**，成品进成品格。
   *
   * 顺序照铁砧/切石机那条经验：**先校验、再扣材料**。
   * 扣旗帜是"从那一叠里抽一张"，不是整叠改图案——64 面白旗只花一个染料变成 64 面
   * 带图案的旗，等于白送 63 个染料。
   *
   * @returns 成功时给出成品那一份（界面用来播提示与音效）
   */
  applyPattern(pattern: number): { ok: true; output: ItemStack } | { ok: false; reason: string } {
    const banner = this.banner;
    const dye = this.dye;
    const blocker = loomBlocker(banner, dye, pattern, this.output);
    if (blocker) return { ok: false, reason: blocker };

    // 先算出成品（此时还没动任何一格）
    const product: ItemStack = { ...banner!, count: 1, bannerPattern: pattern };

    // 扣 1 面旗
    banner!.count -= 1;
    if (banner!.count <= 0) this.slots[LOOM_BANNER] = null;
    // 扣 1 个染料
    dye!.count -= 1;
    if (dye!.count <= 0) this.slots[LOOM_DYE] = null;
    // 成品进成品格（同色同图案才堆，`loomBlocker` 已经拦过异类）
    const existing = this.output;
    if (existing) existing.count += 1;
    else this.slots[LOOM_OUTPUT] = product;
    this.onChange?.();
    return { ok: true, output: this.output ?? product };
  }
}
