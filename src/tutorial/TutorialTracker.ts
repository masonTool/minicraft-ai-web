/**
 * 新手引导的**判定与状态**（批次 20261022-1954 · 引导1）
 *
 * 与 `core/progress/AdvancementTracker.ts` 同一条分工：这一层不碰 DOM、不碰世界，
 * 给它一个"发生了什么"，它告诉你"这一下推进了哪几步"。
 *
 * 四条口径（都有断言守着）：
 *
 *  1. **严格按表推进**：当前步骤满足了才进下一步，不做"越级跳过"——
 *     否则玩家已经有铁镐时，"去撸木头"会被无声跳掉，教学路径就断了。
 *     但**一件事同时满足好几步**时会连续推进（第 10 块方块可能同时让
 *     "放 10 块"与"搭 3 层"成立），`advance()` 一次返回多步；
 *     不把他卡在"请先合成木镐"上——低龄玩家的失败感主要来自这种无意义的阻塞。
 *  2. **同一件事只算一次**：`obtain` 反复上报（背包里一直有那块木头）不会重复推进。
 *     注意 `place` **不是**幂等的：放两块石头就是两块，这是计数，不是事件去重。
 *  3. **存档只存"已完成到哪"**：`completed` 是连续前缀，`index` 由此推出来，
 *     不另存一份 index（派生值存两份必然漂）。计数一并存，读档后能接着数。
 *  4. **读档是外部数据**：未知 id、坏版本、NaN 计数一律跳过，绝不让它们把 index 推亂。
 */

import {
  TUTORIAL_STEPS,
  familyOfItem,
  type TutorialFamily,
  type TutorialStep,
  type TutorialTrack,
} from './steps.ts';

/** 主程序报上来的"发生了什么"（最小集，不造通用事件总线） */
export type TutorialFact =
  /** 背包里出现过某件物品（挖到 / 合出 / 烧出 / 捡到 / 从箱子取出都算） */
  | { readonly kind: 'obtain'; readonly item: number }
  /** 放下一个方块；`y` 用来判"搭起来"，缺省时不计高度层 */
  | { readonly kind: 'place'; readonly block: number; readonly y?: number };

/** 存档里的一份引导状态（放在世界存档的 `tutorial` 对象仓里） */
export interface SerializedTutorial {
  readonly version: 1;
  readonly track: TutorialTrack;
  /** 已完成的步骤 id（按表顺序的连续前缀） */
  readonly completed: readonly string[];
  /** 计数进度：读档后接着数，而不是从 0 开始 */
  readonly counters: {
    readonly placed: number;
    readonly kinds: readonly number[];
    readonly minY: number | null;
    readonly maxY: number | null;
  };
}

/** 记多少种"放过的方块"：正常世界最多 700 多种，这个上限只是防脏事件把 Set 撑大 */
export const MAX_TRACKED_KINDS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class TutorialTracker {
  private track: TutorialTrack;
  /** 当前步骤在 `steps` 里的下标；等于长度表示已走完 */
  private index = 0;

  private readonly obtainedItems = new Set<number>();
  private readonly obtainedFamilies = new Set<TutorialFamily>();
  private readonly placedFamilies = new Set<TutorialFamily>();
  private placed = 0;
  private readonly kinds = new Set<number>();
  private minY: number | null = null;
  private maxY: number | null = null;

  constructor(
    track: TutorialTrack = 'survival',
    private readonly allSteps: readonly TutorialStep[] = TUTORIAL_STEPS,
  ) {
    this.track = track;
  }

  /** 当前路径的步骤（保持表内顺序） */
  get steps(): readonly TutorialStep[] {
    return this.allSteps.filter((step) => step.track === this.track);
  }

  /** 当前该做的那一步；已走完为 null */
  get current(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  /** 当前路径是否已经全部走完 */
  get finished(): boolean {
    return this.index >= this.steps.length;
  }

  /** 进度（0-based 下标 + 总数），界面画"3/8"用 */
  get position(): { readonly index: number; readonly total: number } {
    const total = this.steps.length;
    return { index: Math.min(this.index, total), total };
  }

  /** 当前路径 */
  get trackId(): TutorialTrack {
    return this.track;
  }

  /**
   * 报一件事，返回**这一次新完成**的步骤（可能一步都没有，也可能连续好几步）。
   *
   * ⚠️ 越级时一次返回多步：界面应该只弹最后那一步（前面几步是"顺手也做到了"）。
   */
  handle(fact: TutorialFact): readonly TutorialStep[] {
    this.record(fact);
    return this.advance();
  }

  /** 换一条路径并清空（新世界 / 切换模式后用） */
  reset(track: TutorialTrack = this.track): void {
    this.track = track;
    this.index = 0;
    this.obtainedItems.clear();
    this.obtainedFamilies.clear();
    this.placedFamilies.clear();
    this.placed = 0;
    this.kinds.clear();
    this.minY = null;
    this.maxY = null;
  }

  serialize(): SerializedTutorial {
    return {
      version: 1,
      track: this.track,
      completed: this.steps.slice(0, this.index).map((step) => step.id),
      counters: {
        placed: this.placed,
        kinds: [...this.kinds],
        minY: this.minY,
        maxY: this.maxY,
      },
    };
  }

  /**
   * 从存档恢复，返回**真正认下来的连续完成步数**。
   *
   * 逐项跳过：未知 id / 不属于当前路径 / 坏计数都不会让进度跳步或抛错。
   * 版本不是 1 时按"没有引导存档"处理（返回 0，路径回落生存）。
   */
  restore(value: unknown): number {
    if (!isRecord(value) || value.version !== 1) {
      this.reset('survival');
      return 0;
    }

    const track: TutorialTrack = value.track === 'creative' ? 'creative' : 'survival';
    this.reset(track);

    const counters = isRecord(value.counters) ? value.counters : {};
    const placed = finiteOrNull(counters.placed);
    if (placed !== null && placed >= 0) this.placed = Math.floor(placed);

    if (Array.isArray(counters.kinds)) {
      for (const kind of counters.kinds) {
        if (this.kinds.size >= MAX_TRACKED_KINDS) break;
        if (typeof kind === 'number' && Number.isInteger(kind) && kind >= 0 && kind < 0x10000) {
          this.kinds.add(kind);
        }
      }
    }

    const minY = finiteOrNull(counters.minY);
    const maxY = finiteOrNull(counters.maxY);
    // 两个都得有效、且顺序说得通才认；否则都当"没放过"（只坏一半时更危险）
    if (minY !== null && maxY !== null && minY <= maxY) {
      this.minY = minY;
      this.maxY = maxY;
    }

    const known = new Set(this.steps.map((step) => step.id));
    const completed = Array.isArray(value.completed)
      ? value.completed.filter((id): id is string => typeof id === 'string' && known.has(id))
      : [];
    const done = new Set(completed);

    // 只认**连续前缀**：存档里出现"第 3 步完成、第 2 步没完成"时，从第 2 步接着做
    let index = 0;
    while (index < this.steps.length && done.has(this.steps[index]!.id)) index += 1;
    this.index = index;
    return index;
  }

  // ---------------------------------------------------------------- 内部

  private record(fact: TutorialFact): void {
    if (fact.kind === 'obtain') {
      this.obtainedItems.add(fact.item);
      const family = familyOfItem(fact.item);
      if (family !== null) this.obtainedFamilies.add(family);
      return;
    }

    this.placed += 1;
    if (this.kinds.size < MAX_TRACKED_KINDS) this.kinds.add(fact.block);
    const family = familyOfItem(fact.block);
    if (family !== null) this.placedFamilies.add(family);
    if (typeof fact.y === 'number' && Number.isFinite(fact.y)) {
      this.minY = this.minY === null ? fact.y : Math.min(this.minY, fact.y);
      this.maxY = this.maxY === null ? fact.y : Math.max(this.maxY, fact.y);
    }
  }

  private advance(): readonly TutorialStep[] {
    const steps = this.steps;
    const done: TutorialStep[] = [];
    while (this.index < steps.length && this.satisfied(steps[this.index]!)) {
      done.push(steps[this.index]!);
      this.index += 1;
    }
    return done;
  }

  private satisfied(step: TutorialStep): boolean {
    const goal = step.goal;
    switch (goal.kind) {
      case 'obtain':
        return this.obtainedItems.has(goal.item);
      case 'obtainFamily':
        return this.obtainedFamilies.has(goal.family);
      case 'placeFamily':
        return this.placedFamilies.has(goal.family);
      case 'placeCount':
        return this.placed >= goal.count;
      case 'placeLayers':
        return this.layerSpan() >= goal.layers;
      case 'placeKinds':
        return this.kinds.size >= goal.count;
    }
  }

  /** 放过的方块跨了几个高度层（一次都没带 y 时为 0） */
  private layerSpan(): number {
    if (this.minY === null || this.maxY === null) return 0;
    return Math.max(0, Math.floor(this.maxY) - Math.floor(this.minY) + 1);
  }
}
