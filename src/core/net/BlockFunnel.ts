/**
 * 方块改动的出口漏斗（联机12）。
 *
 * 原来广播散在 40 处手动 `net.sendBlock(...)` 上——挖、放、耕地、脱皮、堆肥、骨粉、
 * 甜浆果…每加一种玩法都要记得补一句。**补漏的代价是静默的**：少写一句，队友那边就
 * 看不到这个方块变了，而且不报错。反过来，红石/流体/火焰/作物/漏斗/爆炸这些自己改
 * 方块的路径一条都没广播过。
 *
 * 现在收成两条路：`World.events.onBlockChanged` 是**唯一的真相来源**（任何写入都会
 * 触发它），散点的 `sendBlock` 也都进这个漏斗。漏斗做两件事：
 *
 *  1. **同格只留最后一稿**：100ms 内水流动三次、红石翻两次，中间值没有意义；
 *  2. **合帧**：满 100ms 发一批，而不是每改一格发一包（红石连锁一响就是几十格）。
 *
 * 上限保护（`MAX_BLOCKS_PER_FLUSH`）是给爆炸/大范围红石留的：一次炸掉几百格时宁可
 * 分两批发，也不要塞出一个几十 KB 的包。
 *
 * 纯逻辑、不碰网络，`tests/net-block-funnel.test.ts` 直接断言。
 */

/** 合帧间隔：100ms 内攒的改动一起发 */
export const BLOCK_FLUSH_INTERVAL_MS = 100;

/** 一批最多多少条（超过的留到下一批） */
export const MAX_BLOCKS_PER_FLUSH = 256;

export interface PendingBlockEdit {
  x: number;
  y: number;
  z: number;
  id: number;
  state: number;
  dimension: string;
}

export class BlockFunnel {
  /** key = `维度|x,y,z`；同一格后写覆盖前写 */
  private readonly pending = new Map<string, PendingBlockEdit>();
  private elapsedMs = 0;

  /** 待发条数（调试面板用） */
  get size(): number {
    return this.pending.size;
  }

  push(edit: PendingBlockEdit): void {
    // 复制一份：调用方可能复用同一个对象（红石那类批量循环），不复制会被下一次覆盖
    this.pending.set(`${edit.dimension}|${edit.x},${edit.y},${edit.z}`, { ...edit });
  }

  /**
   * 推进一帧。到点且确实有东西时才返回 `true`（调用方据此 `drain()` 发包）。
   *
   * 到点但没东西也把计时清零：否则空漏斗会把计时一直攒着，下一条改动会立刻被发出去
   * （本来合帧是为了"攒一会儿"，不是"发得越快越好"）。
   */
  tick(dtSeconds: number): boolean {
    this.elapsedMs += Math.max(0, dtSeconds) * 1000;
    if (this.elapsedMs < BLOCK_FLUSH_INTERVAL_MS) return false;
    this.elapsedMs = 0;
    return this.pending.size > 0;
  }

  /** 取走最多 `limit` 条（默认 `MAX_BLOCKS_PER_FLUSH`），剩下的留到下一批 */
  drain(limit: number = MAX_BLOCKS_PER_FLUSH): PendingBlockEdit[] {
    const batch: PendingBlockEdit[] = [];
    for (const [key, edit] of this.pending) {
      if (batch.length >= limit) break;
      batch.push(edit);
      this.pending.delete(key);
    }
    return batch;
  }

  /** 断开联机时清空：那些改动不该在重连之后发过去（服务端状态可能已经不同了） */
  clear(): void {
    this.pending.clear();
    this.elapsedMs = 0;
  }
}
