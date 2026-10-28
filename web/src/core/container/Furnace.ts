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
import {
  FURNACE_STATIONS,
  cookSeconds,
  fuelSeconds,
  smeltingRecipeFor,
  stationRejectReason,
  type FurnaceStation,
  type SmeltingRecipe,
} from '../crafting/Smelting.ts';

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

  /**
   * 这是哪一种炉子（批次 46）：普通熔炉 / 烟熏炉 / 高炉。
   *
   * ⚠️ **站台存在实例上，而不是靠方块 id 现查**：tick 循环是按容器实例推进的，
   * 它手里只有 `Furnace`，拿不到"脚下那一格是哪个方块"；而"这炉子只吃食物"
   * 这条规则必须参与每次 tick 的判定。站台同时也进存档，所以读档后不会变回普通熔炉。
   */
  station: FurnaceStation;

  burnTimeLeft = 0;
  /** 当前这批燃料的总时长，供 UI 计算火焰高度 */
  burnTimeTotal = 0;
  cookProgress = 0;
  cookTimeTotal = 0;
  storedExperience = 0;
  /**
   * UI 选配方期间的暂停（批次 295，不存档）。
   *
   * 用户要求"点目标框才开始制作"：把原料+燃料摆好后先冻住，
   * 点目标框再 `paused = false`。关界面/切容器时必须恢复，避免炉子被永久冻住。
   */
  paused = false;
  /**
   * 是否已经点过界面上的目标框开工（批次 328）。
   *
   * 与 `paused` 分开：手动摆料/关闭界面只改 `paused`，绝不会把 `started` 打开；
   * `tick` 必须同时满足 `!paused && started` 才推进，避免任何刷新路径让炉子自动烧。
   * 默认 true 兼容无 UI 的模拟/测试；界面打开空闲炉子时会显式设回 false。
   */
  started = true;

  onChange: (() => void) | null = null;
  /**
   * 槽位内容被改动（联机15）：与 `onChange` 分开。
   *
   * `onChange` 是界面刷新，`tick` 里"点燃状态变了"也会调它；联机只关心内容，
   * 而且远端恢复（逐格 `set` 写回）不该触发它——抑制由调用方做（`main.ts` 的 `applyingRemoteBlock`）。
   */
  onMutate: (() => void) | null = null;

  constructor(station: FurnaceStation = 'furnace') {
    this.station = station;
  }

  /** 这座炉子的中文名（界面标题与提示用） */
  get stationName(): string {
    return FURNACE_STATIONS[this.station].cn;
  }

  get(index: number): ItemStack | null {
    if (index < 0 || index >= FURNACE_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= FURNACE_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.onMutate?.();
    this.onChange?.();
  }

  get isLit(): boolean {
    return this.burnTimeLeft > 0;
  }

  /** 当前配方（只看原料槽；**按站台过滤**：烟熏炉只吃食物、高炉只吃矿物与金属） */
  private recipe(): SmeltingRecipe | undefined {
    const input = this.slots[FURNACE_INPUT];
    if (!input) return undefined;
    return smeltingRecipeFor(input.id, this.station);
  }

  /**
   * 原料槽里那件东西**这座炉子吃不吃**（界面提示用）。
   * 返回空字符串表示"能吃或者没意见"，否则是要显示给玩家的一句话。
   */
  get rejectReason(): string {
    const input = this.slots[FURNACE_INPUT];
    if (!input) return '';
    return stationRejectReason(input.id, this.station);
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
    // 界面里已摆好配方、还没点目标框：燃料不烧、进度不走（批次 295 / 328）
    if (this.paused || !this.started) return { changed: false, litChanged: false };
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
        // ⚠️ 燃烧时长也按站台的倍率缩短：一份煤在烟熏炉里只烧 40 秒，
        // 但每次烧炼只要一半时间，所以**一份燃料能烧的次数不变**（与熔炉一样是 8 次）
        const burn = seconds * FURNACE_STATIONS[this.station].timeScale;
        this.burnTimeLeft = burn;
        this.burnTimeTotal = burn;
        changed = true;
      }
    }

    if (this.burnTimeLeft > 0 && recipe) {
      const cookTime = cookSeconds(recipe, this.station);
      this.cookTimeTotal = cookTime;
      this.cookProgress += dt;
      changed = true;
      if (this.cookProgress >= cookTime) {
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
