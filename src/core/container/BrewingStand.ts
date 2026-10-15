/**
 * 酿造台：5 格容器（3 药水槽 + 1 材料槽 + 1 燃料槽）+ 酿造进度（H10）
 *
 * 逻辑对齐原版：
 *  - **三个药水槽同时推进**：只要有一个槽能酿，整台就开始走 20 秒；
 *    放一瓶也是 20 秒、放三瓶也是 20 秒（这是原版的特点，不是 bug）
 *  - 格子是 **3 药水 + 1 材料 + 1 燃料**（共 5 格，与原版一致）；
 *    燃料是**烈焰粉**，1 份能酿 **20 次**，每酿一轮消耗 1 个材料
 *  - 中途把材料或药水拿走，进度**归零**（原版：酿造不能暂停后接着来）
 *  - 原料与基础药水不匹配时什么都不发生（不消耗、不浪费）
 *
 * 与 `Furnace` 同构，但不复用它的类：熔炉是"1 进 1 出、有配方耗时差"，
 * 酿造是"N 进 N 出、统一 20 秒"，两者只有外形像。
 */

import type { ItemStack, SlotSource } from './Inventory.ts';
import { BREW_SECONDS, BREWS_PER_BLAZE_POWDER, applyBrew, canBrew } from '../crafting/Brewing.ts';
import { Item } from '../registry/items.ts';

/** 三个药水槽的下标（原版就是 0/1/2） */
export const BREW_BOTTLE_SLOTS = [0, 1, 2] as const;
/**
 * **材料槽**（下界疣之类）与**燃料槽**（烈焰粉）是**两格**。
 *
 * 我一开始把它们合成一格（"烈焰粉既是燃料又能当材料"）——这是错的：
 * 原版是 3 药水 + 1 材料 + 1 燃料共 5 格，合起来之后 `brewRecipeFor` 永远
 * 拿烈焰粉去匹配配方、什么也酿不出来。实测脚本当场抓到了这个（"条件齐了开始酿"失败）。
 */
export const BREW_INGREDIENT_SLOT = 3;
export const BREW_FUEL_SLOT = 4;
export const BREW_SLOT_COUNT = 5;

export interface BrewTickResult {
  /** 数值发生变化（UI 需要重绘） */
  changed: boolean;
  /** 酿成了一轮（方块外观/音效可以据此做反馈） */
  brewed: boolean;
}

export class BrewingStand implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(BREW_SLOT_COUNT).fill(null);

  /** 当前这批燃料还能酿几次 */
  fuelLeft = 0;
  /** 当前这一轮已酿的秒数 */
  brewProgress = 0;
  /** 是否正在酿（UI 用它决定进度条显不显示） */
  brewing = false;

  onChange: (() => void) | null = null;

  get(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    this.slots[index] = stack;
    this.onChange?.();
  }

  /** 三个药水槽里的物品 id（空格为 undefined） */
  private get bottleIds(): (number | undefined)[] {
    return BREW_BOTTLE_SLOTS.map((slot) => this.slots[slot]?.id);
  }

  /** 材料槽里的材料（决定酿成什么） */
  private get material(): number | undefined {
    return this.slots[BREW_INGREDIENT_SLOT]?.id;
  }

  /** 燃料槽里的是不是烈焰粉 */
  private get hasFuel(): boolean {
    return this.slots[BREW_FUEL_SLOT]?.id === Item.BLAZE_POWDER;
  }

  /** 酿成之后要不要扣掉材料（原版每酿一轮消耗 1 个材料） */
  private consumeMaterial(): void {
    const stack = this.slots[BREW_INGREDIENT_SLOT];
    if (!stack) return;
    stack.count -= 1;
    if (stack.count <= 0) this.slots[BREW_INGREDIENT_SLOT] = null;
  }

  /**
   * 推进 dt 秒；由主程序对附近的酿造台调用（与熔炉同一条 tick 通道）。
   * 与熔炉一样**自己通知 `onChange`**：界面靠它知道"进度条该重画了"，
   * 否则开着界面看酿造台会是一条永远不动的进度条。
   */
  tick(dt: number): BrewTickResult {
    const result: BrewTickResult = { changed: false, brewed: false };
    if (!canBrew(this.material, this.bottleIds)) {
      // 条件不满足：进度归零（原版不允许"暂停后接着酿"）
      if (this.brewProgress !== 0) {
        this.brewProgress = 0;
        result.changed = true;
      }
      this.brewing = false;
      return result;
    }

    // 没燃料了就先"吃"一份烈焰粉换 20 次
    if (this.fuelLeft <= 0) {
      if (!this.hasFuel) {
        this.brewing = false;
        return result;
      }
      const fuelStack = this.slots[BREW_FUEL_SLOT]!;
      fuelStack.count -= 1;
      if (fuelStack.count <= 0) this.slots[BREW_FUEL_SLOT] = null;
      this.fuelLeft = BREWS_PER_BLAZE_POWDER;
      result.changed = true;
    }

    this.brewing = true;
    this.brewProgress += dt;
    result.changed = true;
    if (this.brewProgress < BREW_SECONDS) return result;

    // 酿成一轮：三个槽一起换
    this.brewProgress = 0;
    this.fuelLeft -= 1;
    const changed = applyBrew(this.material!, this.bottleIds);
    this.consumeMaterial();
    for (const { index, to } of changed) {
      const stack = this.slots[index]!;
      this.slots[index] = { ...stack, id: to };
    }
    result.brewed = changed.length > 0;
    if (this.fuelLeft <= 0) this.brewing = false;
    this.onChange?.();
    return result;
  }

  /** 酿造进度 0~1（UI 用） */
  get brewRatio(): number {
    return Math.min(1, this.brewProgress / BREW_SECONDS);
  }

  /** 当前燃料还能酿几次（UI 用） */
  get fuelRemaining(): number {
    return this.fuelLeft;
  }
}
