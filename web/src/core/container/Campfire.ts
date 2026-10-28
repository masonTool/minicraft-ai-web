/**
 * 营火的容器状态（H11，批次 47）
 *
 * 与三座炉子的三处不同（都对齐原版）：
 *  1. **不要燃料**：点着就一直烤（熄灭后停在原地，进度也停）；
 *  2. **4 个格子同时推进**，每格有**自己的进度**；
 *  3. **没有产物槽**：烤好的东西**直接弹出来**（原版是掉出一件物品实体）。
 *
 * 第 3 条决定了这个类的接口与 `Furnace` 不一样——它不能只提供 `get(OUTPUT)`，
 * 而要在 `tick()` 里把"这一格烤好了"回报给调用方（主循环负责掉物品）。
 * 反过来，**不要把营火硬塞进 `Furnace`**：`Furnace` 的三格布局、燃料与
 * 产物槽语义都很硬（`FURNACE_OUTPUT` 到处都在用），塞进去会到处特判。
 *
 * 复用的是**配方层**：营火在 `FURNACE_STATIONS` 里就是一个站台
 * （`accepts: ['food']`、`timeScale: 3` → 30 秒一个），
 * 于是"营火只烤食物、而且慢 3 倍"这条规则与炉子共用同一份数据。
 */

import { cookSeconds, smeltingRecipeFor, stationRejectReason, type SmeltingRecipe } from '../crafting/Smelting.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

export const CAMPFIRE_SIZE = 4;

/** 一格里"烤好了"的结果 */
export interface CampfireCooked {
  /** 第几格 */
  slot: number;
  /** 烤出来什么（主循环负责把它掉到营火上） */
  output: ItemStack;
}

export interface CampfireTickResult {
  changed: boolean;
  /** 这一 tick 烤好了哪些格（调用方掉物品用） */
  cooked: readonly CampfireCooked[];
  litChanged: boolean;
}

export class Campfire implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(CAMPFIRE_SIZE).fill(null);
  /** 每格自己的进度（秒） */
  private readonly progress = new Array<number>(CAMPFIRE_SIZE).fill(0);
  /** 每格当前配方的总耗时（界面画进度条用；0 表示这一格没在烤） */
  private readonly total = new Array<number>(CAMPFIRE_SIZE).fill(0);

  /** 点着了吗（熄灭后不烤，但格子里的东西留着） */
  lit = true;
  /**
   * UI 选配方期间的暂停（批次 295，不存档）。
   * 与炉子/酿造台同一条口径：摆好材料先冻住，点目标框再恢复；关界面必须恢复。
   */
  paused = false;
  /**
   * 是否已经点过界面上的目标框开工（批次 330，与熔炉/酿造台同构，不存档）。
   *
   * 与 `paused` 分开：手动摆料/关闭界面只改 `paused`，绝不会把 `started` 打开；
   * `tick` 必须同时满足 `!paused && started` 才推进。默认 true 兼容无 UI 的模拟/测试。
   */
  started = true;

  onChange: (() => void) | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= CAMPFIRE_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= CAMPFIRE_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    // 换料就重新计时（原版也是：拿走或换掉就归零）
    this.progress[index] = 0;
    this.total[index] = 0;
    this.onChange?.();
  }

  /** 第几格烤到哪儿了（0~1；没在烤返回 0） */
  ratio(index: number): number {
    const total = this.total[index] ?? 0;
    if (total <= 0) return 0;
    return Math.min(1, (this.progress[index] ?? 0) / total);
  }

  /** 这一格里的东西营火能不能烤（不能烤时界面显示原因） */
  rejectReason(index: number): string {
    const stack = this.slots[index];
    if (!stack) return '';
    return stationRejectReason(stack.id, 'campfire');
  }

  /**
   * 重算每格的总耗时（读档后调用）。
   *
   * 为什么不把 `total` 也存进存档：它是**由配方推出来的**（`cookSeconds(recipe, 'campfire')`），
   * 存一份派生数据只会多一个"存档里的值与当前配方对不上"的坑；
   * 读档后调一次这里，进度条立刻就是对的。
   */
  refreshTotals(): void {
    for (let index = 0; index < CAMPFIRE_SIZE; index++) {
      const recipe = this.recipeFor(index);
      this.total[index] = recipe ? cookSeconds(recipe, 'campfire') : 0;
    }
    this.onChange?.();
  }

  /** 每格的原始进度（存档用） */
  get progressSeconds(): readonly number[] {
    return [...this.progress];
  }

  /** 读档：恢复某格的进度 */
  setProgress(index: number, seconds: number): void {
    if (index < 0 || index >= CAMPFIRE_SIZE) return;
    this.progress[index] = Math.max(0, seconds);
  }

  /** 有没有任何一格在烤 */
  get cooking(): boolean {
    return this.lit && this.slots.some((slot, index) => slot !== null && this.recipeFor(index) !== undefined);
  }

  private recipeFor(index: number): SmeltingRecipe | undefined {
    const stack = this.slots[index];
    if (!stack) return undefined;
    return smeltingRecipeFor(stack.id, 'campfire');
  }

  /**
   * 推进 dt 秒。
   *
   * ⚠️ 四格是**各自独立**推进的（原版如此）：一格烤好弹出去之后，
   * 同一 tick 里其它格不受影响。烤好的一格会**清空该格**并把结果回报给调用方。
   */
  tick(dt: number): CampfireTickResult {
    const cooked: CampfireCooked[] = [];
    const wasLit = this.lit;
    let changed = false;
    // 界面里已摆好配方、还没点目标框（批次 295 / 330）
    if (this.paused || !this.started) return { changed: false, cooked, litChanged: false };

    for (let index = 0; index < CAMPFIRE_SIZE; index++) {
      const recipe = this.lit ? this.recipeFor(index) : undefined;
      if (!recipe) {
        // 熄灭或"这格的东西不能烤"：进度回退（与熔炉同一条：每秒退 2 秒当量）
        if ((this.progress[index] ?? 0) > 0) {
          this.progress[index] = Math.max(0, this.progress[index]! - dt * 2);
          changed = true;
        }
        this.total[index] = 0;
        continue;
      }

      const total = cookSeconds(recipe, 'campfire');
      this.total[index] = total;
      this.progress[index] = (this.progress[index] ?? 0) + dt;
      changed = true;

      if (this.progress[index]! >= total) {
        this.progress[index] = 0;
        this.total[index] = 0;
        // 产出：**不进球、不清空输入**——原版是"少一个原料、掉一个成品"
        const stack = this.slots[index]!;
        cooked.push({ slot: index, output: { id: recipe.output.id, count: recipe.output.count } });
        stack.count -= 1;
        if (stack.count <= 0) this.slots[index] = null;
      }
    }

    const litChanged = wasLit !== this.lit;
    if (changed || litChanged || cooked.length > 0) this.onChange?.();
    return { changed, cooked, litChanged };
  }
}
