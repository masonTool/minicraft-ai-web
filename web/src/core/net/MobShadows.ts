/**
 * 影子抑制（联机38 的 ③）。
 *
 * 生物是**两端各自生成**的：即使位置同步了，"权威端上报这只狼在 (10,64,3)"之后，
 * 非权威端的本地 AI 仍会自己再刷一只狼——玩家于是看到两只重叠的怪，打其中一只
 * 另一只还在动。
 *
 * 所以收到远端生物时，本地要记一笔"这只归别人管"，并在本地刷怪时跳过它。
 * 记为**最近一次看到的时间**而不是布尔：上报断了（权威端退游戏/走远）之后，
 * 阴影要能自己过期，否则那片区域就永远不刷怪了。
 *
 * 纯逻辑（不含定时器），`now` 由调用方传入——这样能离线断言过期行为。
 */

/** 多久没收到上报就不再算"影子"（毫秒） */
export const SHADOW_TTL_MS = 3000;

export class MobShadows {
  /** 全局键 → 最后一次收到上报的时间 */
  private readonly seen = new Map<string, number>();

  /** 收到某个生物的远端上报（权威端的 `mob-move` / 自己刚加入时的快照） */
  touch(key: string, now: number): void {
    this.seen.set(key, now);
  }

  /**
   * 这个键现在是不是"别人的"（本地不要生成）。
   *
   * 过期的条目顺手删掉——不然一个跑远的狼会在这张表里留一辈子。
   */
  isShadowed(key: string, now: number, ttlMs: number = SHADOW_TTL_MS): boolean {
    const at = this.seen.get(key);
    if (at === undefined) return false;
    if (now - at > ttlMs) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }

  /** 清掉所有过期项（断线、切维度时调；也可以定期调） */
  prune(now: number, ttlMs: number = SHADOW_TTL_MS): number {
    let removed = 0;
    for (const [key, at] of this.seen) {
      if (now - at > ttlMs) {
        this.seen.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** 权威端自己离开后要主动撤掉阴影（不能等 3 秒，那 3 秒里玩家会看到"怪突然变两份"） */
  release(key: string): void {
    this.seen.delete(key);
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}
