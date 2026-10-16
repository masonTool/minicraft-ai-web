/**
 * 成就 / 进度的**判定与状态**（M7，批次 87）
 *
 * 这一层不碰 DOM、不碰世界：给它一个"发生了什么"，它告诉你"新达成了哪几条"。
 * 于是"父没达成时子不能解锁""计数型要几个不同的目标""读档时脏数据怎么处理"
 * 这些口径都能离线断言（`tools/advancement-test.ts`）。
 *
 * 三条关键规则（都有断言守着）：
 *
 *  1. **父条目没达成，子条目一定拿不到**（原版如此）。判断用"父在不在已达成集合里"，
 *     不另存一份"可见性"——派生值不要存（月相那批的教训）。
 *  2. **同一件事只报一次**：`handle` 返回的是"这一次新达成的"，
 *     重复触发（背包里一直有那块石头）不会重复报，界面也就不会重复弹。
 *  3. **计数型记的是"命中过哪些不同的目标"**，不是次数：两天各杀一只僵尸只算一种。
 *     这份进度集**随存档走**（原版也是这样，否则"打了一半的挑战"读档就归零）。
 */

import {
  ADVANCEMENTS,
  advancementById,
  type AdvancementDef,
  type ProgressEvent,
  type AdvancementTrigger,
} from './advancements.ts';

/** 界面要用的三种状态 */
export type AdvancementState =
  /** 已达成 */
  | 'earned'
  /** 可以达成：自己没达成、但父条目已达成（原版把这种画成"框架"） */
  | 'available'
  /** 还没轮到：父条目没达成（界面画成一片灰） */
  | 'locked';

/** 存档里的一条（与容器/牌子同一条口径：整份读写、逐条校验） */
export interface SerializedAdvancements {
  earned: string[];
  /** 计数型的进度：`条目 id → 已经命中过的目标值` */
  progress: Record<string, string[]>;
}

export class AdvancementTracker {
  /** 已达成（用 Set：界面与判定都是"有没有"） */
  private readonly earnedIds = new Set<string>();
  /** 计数型的进度集 */
  private readonly progress = new Map<string, Set<string>>();

  constructor(readonly defs: readonly AdvancementDef[] = ADVANCEMENTS) {}

  // ---------------------------------------------------------------- 判定

  /**
   * 报一件事，返回**这一次新达成**的条目（按表的顺序，父在前）。
   *
   * 一趟遍历就能解锁整条链：`ADVANCEMENTS` 是拓扑序，而"这一件事同时满足父子两条"
   * 的情形是存在的（原版也是这样：击杀一只僵尸会同时点亮"冒险"与它下面的条目）。
   */
  handle(event: ProgressEvent): AdvancementDef[] {
    const earned: AdvancementDef[] = [];
    for (const def of this.defs) {
      if (this.earnedIds.has(def.id)) continue;
      if (!this.isAvailable(def)) continue;
      if (def.trigger.kind !== event.kind) continue;
      const key = this.matchKey(def.trigger, event);
      if (key === null) continue;

      const need = def.trigger.needCount ?? 1;
      if (need <= 1) {
        this.earnedIds.add(def.id);
        earned.push(def);
        continue;
      }
      let seen = this.progress.get(def.id);
      if (!seen) {
        seen = new Set<string>();
        this.progress.set(def.id, seen);
      }
      seen.add(key);
      if (seen.size >= need) {
        this.earnedIds.add(def.id);
        earned.push(def);
      }
    }
    return earned;
  }

  /**
   * 父条目达成的才可以拿。
   *
   * 根条目（`parent === null`）随时可以——但根条目基本都带条件
   * （"进入下界"这种），真正"白给"的只有 `story/root`（`kind: 'auto'`，
   * 由主程序在进世界时显式授予）。
   */
  private isAvailable(def: AdvancementDef): boolean {
    return def.parent === null || this.earnedIds.has(def.parent);
  }

  /**
   * 这一件事算不算命中，命中就把"用来去重的键"返回。
   *
   * 键的含义按种类不同（物品 id / 生物 id / 维度 id / 固定值），
   * 但都只用于**计数型的去重**：`needCount` 数的是"不同的键有几个"。
   */
  private matchKey(trigger: AdvancementTrigger, event: ProgressEvent): string | null {
    switch (event.kind) {
      case 'obtain': {
        if (trigger.enchanted === true && event.enchanted !== true) return null;
        // 不带 `ids` 的 obtain 表示"任意一件物品"（本批只用在"附魔师"上，
        // 它靠 `enchanted` 把范围收窄）
        if (!trigger.ids) return String(event.item);
        return trigger.ids.includes(event.item) ? String(event.item) : null;
      }
      case 'eat':
        return !trigger.ids || trigger.ids.includes(event.item) ? String(event.item) : null;
      case 'place':
        return !trigger.ids || trigger.ids.includes(event.block) ? String(event.block) : null;
      case 'fish':
        return !trigger.ids || trigger.ids.includes(event.item) ? String(event.item) : null;
      case 'trade':
        return '';
      case 'kill':
        return !trigger.mobs || trigger.mobs.includes(event.mob) ? event.mob : null;
      case 'breed':
        return !trigger.mobs || trigger.mobs.includes(event.mob) ? event.mob : null;
      case 'dimension':
        return !trigger.dimensions || trigger.dimensions.includes(event.dimension) ? event.dimension : null;
      // 这三件事没有"是哪一种"的差别，去重键固定
      case 'sleep':
      case 'dragon':
      case 'auto':
        return 'done';
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------- 查询

  /** 显式授予（`kind: 'auto'` 的根条目、以及调试接口用）；已达成过返回 false */
  grant(id: string): boolean {
    if (!advancementById(id)) return false;
    if (this.earnedIds.has(id)) return false;
    this.earnedIds.add(id);
    return true;
  }

  isEarned(id: string): boolean {
    return this.earnedIds.has(id);
  }

  stateOf(id: string): AdvancementState {
    const def = advancementById(id);
    if (!def) return 'locked';
    if (this.earnedIds.has(id)) return 'earned';
    return this.isAvailable(def) ? 'available' : 'locked';
  }

  /** 计数型的进度（界面显示"3 / 10"用；非计数型返回 need = 1） */
  countFor(id: string): { seen: number; need: number } {
    const def = advancementById(id);
    const need = def?.trigger.needCount ?? 1;
    return { seen: this.progress.get(id)?.size ?? 0, need };
  }

  get earnedCount(): number {
    return this.earnedIds.size;
  }

  get totalCount(): number {
    return this.defs.length;
  }

  /** 全清（换世界时用） */
  clear(): void {
    this.earnedIds.clear();
    this.progress.clear();
  }

  // ---------------------------------------------------------------- 存档

  /**
   * 导出：按**表的顺序**写（存档的 diff 才稳定——Set 的插入顺序会随玩法变）。
   */
  serialize(): SerializedAdvancements {
    const earned: string[] = [];
    const progress: Record<string, string[]> = {};
    for (const def of this.defs) {
      if (this.earnedIds.has(def.id)) earned.push(def.id);
      const seen = this.progress.get(def.id);
      // 已经达成的条目不必再写进度（它已经没有意义了）
      if (seen && seen.size > 0 && !this.earnedIds.has(def.id)) progress[def.id] = [...seen];
    }
    return { earned, progress };
  }

  /**
   * 读存档：**逐条校验 + 剪掉断链**，返回读进来多少条。
   *
   * 三道校验（外部数据不可信的常规做法）：
   *  1. 结构不对（不是对象、`earned` 不是数组）→ 一条都不读；
   *  2. id 不在表里（旧版本删过条目）→ 跳过；
   *  3. **父没达成的子条目一律丢掉**——手改坏的存档里"只有子条目"会让界面画出一棵
   *     断掉的树；剪掉之后自己会长回来（条件满足时判定会再授予一次），
   *     这也与"读档不该崩、该宽容"的老规矩一致。
   *
   * ⚠️ 剪枝按**表的顺序**做（父在前），所以一趟就够。
   */
  restore(raw: unknown): number {
    this.clear();
    if (!raw || typeof raw !== 'object') return 0;
    const record = raw as Partial<SerializedAdvancements>;
    const earnedSet = new Set<string>(Array.isArray(record.earned) ? record.earned : []);

    let restored = 0;
    for (const def of this.defs) {
      if (!earnedSet.has(def.id)) continue;
      if (def.parent !== null && !this.earnedIds.has(def.parent)) continue;
      this.earnedIds.add(def.id);
      restored++;
    }

    // 进度集：只收表里认识的条目、且只收字符串目标（脏数据一律丢）
    if (record.progress && typeof record.progress === 'object') {
      for (const [id, values] of Object.entries(record.progress)) {
        const def = advancementById(id);
        if (!def || (def.trigger.needCount ?? 1) <= 1) continue;
        if (!Array.isArray(values)) continue;
        const seen = new Set<string>();
        for (const value of values) if (typeof value === 'string') seen.add(value);
        if (seen.size > 0) this.progress.set(id, seen);
      }
    }
    return restored;
  }
}
