/**
 * 熔炉：3 格容器（原料 / 燃料 / 产物）+ 燃烧与烧炼进度。
 *
 * 逻辑对齐原版：
 *  - 有原料且有可用配方、且产物槽能容纳时才会点火；
 *  - 点火消耗 1 个燃料，换取该燃料对应的可燃烧时长；
 *  - 燃烧期间累加烧炼进度，达到配方耗时产出一次并清零；
 *  - 不满足烧炼条件时进度会**回退**（每秒回退 2 秒当量，即原版每 tick 回退 2）；
 *  - 产物取出时结算经验（经验球系统未实现，先累计在 storedExperience）。
 */

import type { ItemStack, SlotSource } from './Inventory.ts';
import { maxStackOf } from '../registry/items.ts';
import { fuelSeconds, smeltingRecipeFor, type SmeltingRecipe } from '../crafting/Smelting.ts';

export const FURNACE_INPUT = 0;
export const FURNACE_FUEL = 1;
export const FURNACE_OUTPUT = 2;
export const FURNACE_SIZE = 3;

export interface FurnaceTickResult {
  /** 数值发生变化（UI 需要重绘） */
  changed: boolean;
  /** 燃烧状态发生变化（方块外观可能需要重刷） */
  litChanged: boolean;
}

export class Furnace implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(FURNACE_SIZE).fill(null);

  burnTimeLeft = 0;
  /** 当前这批燃料的总时长，供 UI 计算火焰高度 */
  burnTimeTotal = 0;
  cookProgress = 0;
  cookTimeTotal = 0;
  storedExperience = 0;

  onChange: (() => void) | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= FURNACE_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= FURNACE_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.onChange?.();
  }

  get isLit(): boolean {
    return this.burnTimeLeft > 0;
  }

  /** 当前配方（只看原料槽） */
  private recipe(): SmeltingRecipe | undefined {
    const input = this.slots[FURNACE_INPUT];
    if (!input) return undefined;
    return smeltingRecipeFor(input.id);
  }

  /** 产物槽能否容纳该配方的产出 */
  private canAcceptOutput(recipe: SmeltingRecipe): boolean {
    const output = this.slots[FURNACE_OUTPUT];
    if (!output) return true;
    if (output.id !== recipe.output.id) return false;
    return output.count + recipe.output.count <= maxStackOf(output.id);
  }

  private canSmelt(): boolean {
    const recipe = this.recipe();
    if (!recipe) return false;
    return this.canAcceptOutput(recipe);
  }

  /** 推进 dt 秒 */
  tick(dt: number): FurnaceTickResult {
    let changed = false;
    const wasLit = this.isLit;

    if (this.burnTimeLeft > 0) {
      this.burnTimeLeft = Math.max(0, this.burnTimeLeft - dt);
      changed = true;
    }

    const recipe = this.canSmelt() ? this.recipe() : undefined;

    // 需要点火：没在烧 + 有可烧炼的活 + 燃料够
    if (this.burnTimeLeft <= 0 && recipe) {
      const fuel = this.slots[FURNACE_FUEL];
      const seconds = fuel ? fuelSeconds(fuel.id) : 0;
      if (seconds > 0) {
        fuel!.count -= 1;
        if (fuel!.count <= 0) this.slots[FURNACE_FUEL] = null;
        this.burnTimeLeft = seconds;
        this.burnTimeTotal = seconds;
        changed = true;
      }
    }

    if (this.burnTimeLeft > 0 && recipe) {
      this.cookTimeTotal = recipe.time;
      this.cookProgress += dt;
      changed = true;
      if (this.cookProgress >= recipe.time) {
        this.cookProgress = 0;
        this.produce(recipe);
      }
    } else if (this.cookProgress > 0) {
      // 条件不满足时进度回退（原版每 tick 回退 2，即每秒回退 2 秒当量）
      this.cookProgress = Math.max(0, this.cookProgress - dt * 2);
      changed = true;
    }

    const litChanged = wasLit !== this.isLit;
    if (changed || litChanged) this.onChange?.();
    return { changed, litChanged };
  }

  private produce(recipe: SmeltingRecipe): void {
    const output = this.slots[FURNACE_OUTPUT];
    if (output) output.count += recipe.output.count;
    else this.slots[FURNACE_OUTPUT] = { id: recipe.output.id, count: recipe.output.count };

    const input = this.slots[FURNACE_INPUT];
    if (input) {
      input.count -= 1;
      if (input.count <= 0) this.slots[FURNACE_INPUT] = null;
    }
    this.storedExperience += recipe.experience;
  }

  /**
   * 取走攒下的烧炼经验（返回并清零）。
   * 由界面在"产物槽被取空"时调用——原版也是整槽取走才结算。
   */
  takeExperience(): number {
    const amount = this.storedExperience;
    this.storedExperience = 0;
    return amount;
  }

  get isEmpty(): boolean {
    return this.slots.every((slot) => slot === null);
  }

  /** 燃料是否还在燃烧（UI 火焰动画用） */
  get burnRatio(): number {
    if (this.burnTimeTotal <= 0) return 0;
    return Math.max(0, Math.min(1, this.burnTimeLeft / this.burnTimeTotal));
  }

  get cookRatio(): number {
    if (this.cookTimeTotal <= 0) return 0;
    return Math.max(0, Math.min(1, this.cookProgress / this.cookTimeTotal));
  }
}
