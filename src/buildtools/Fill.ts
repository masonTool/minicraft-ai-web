/**
 * 框选填充的**分批执行**（创造2，批次 20261022-1954）
 *
 * 为什么要分批：32³ 是 32768 格，同步写完会让主线程卡住明显一截
 * （每格都要重网格化 + 光照），手机上体感就是"画面顿一下、然后整片出现"。
 * 这里把它切成每帧一批，玩家看到的是"一片一片长出来"——而且**能中断**
 * （关界面、换世界、按取消都不该继续往世界里写）。
 *
 * 三层分工：
 *  - `shouldFillCell`：**某格要不要写**的纯判断（fill / replace / clear 三种模式）；
 *  - `planFill`：盒子 → 按固定顺序切好的批（可断言"批数与顺序"）；
 *  - `FillRunner`：跨帧推进（每帧 `step()` 一次），不依赖世界，写由回调注入。
 *
 * ⚠️ 中断粒度是"一次 `step` 的预算"，不是"每格都可中断"：
 * 预算内会连续写完，因为一格一格的 `setBlockAndUpdate` 之间没有 await。
 * 512 格在手机上约 1~3ms，这个粒度足够（再细就要拆成微任务，反而更慢）。
 */

import {
  selectionCells,
  selectionVolume,
  type BlockPos,
  type SelectionBox,
} from './Selection.ts';

/** 每帧默认写多少格（约 1~3ms；手机上留足余量给渲染） */
export const FILL_BATCH_SIZE = 512;

/** 填充模式：放方块 / 只替换同种 / 清空 */
export type FillMode = 'fill' | 'replace' | 'clear';

/**
 * 这一格要不要写。
 *
 * - `fill`：无条件写（包括把水/草替换掉）；
 * - `replace`：`replaceId` 给了就只换那一种，没给就"换掉所有非空气"；
 * - `clear`：只清非空气（把空气再写一遍空气没有意义，还会白触发一次重网格化）。
 */
export function shouldFillCell(options: {
  readonly mode: FillMode;
  readonly currentId: number;
  readonly replaceId?: number | null;
  readonly airId?: number;
}): boolean {
  const airId = options.airId ?? 0;
  switch (options.mode) {
    case 'fill':
      return true;
    case 'clear':
      return options.currentId !== airId;
    case 'replace': {
      const target = options.replaceId;
      if (target === null || target === undefined) return options.currentId !== airId;
      return options.currentId === target;
    }
  }
}

export interface FillPlan {
  /** 按顺序切好的批；每批不超过 `batchSize` */
  readonly batches: readonly (readonly BlockPos[])[];
  readonly total: number;
  readonly batchSize: number;
}

/** 盒子 → 分批计划（纯函数；测试用它断言"批数 / 每批格数 / 顺序"） */
export function planFill(box: SelectionBox, batchSize: number = FILL_BATCH_SIZE): FillPlan {
  const size = Number.isFinite(batchSize) && batchSize >= 1 ? Math.floor(batchSize) : FILL_BATCH_SIZE;
  const batches: BlockPos[][] = [];
  let current: BlockPos[] = [];
  for (const cell of selectionCells(box)) {
    current.push(cell);
    if (current.length >= size) {
      batches.push(current);
      current = [];
    }
  }
  if (current.length > 0) batches.push(current);
  return { batches, total: selectionVolume(box), batchSize: size };
}

export interface FillProgress {
  readonly done: boolean;
  readonly cancelled: boolean;
  /** 已经访问过的格子（含被 `shouldFillCell` 跳过的） */
  readonly visited: number;
  /** 真正写进世界的格子 */
  readonly written: number;
  readonly total: number;
}

export interface FillRunnerOptions {
  readonly batchSize?: number;
  /** 写一格；返回 false 表示这一格被跳过（replace 没命中 / 已经是目标方块） */
  readonly write: (pos: BlockPos) => boolean;
}

/**
 * 跨帧推进的填充器。
 *
 * 用法：`while (runner.step()) { ... }` **不是**推荐写法（那就等于同步跑完）；
 * 正确用法是主循环每帧调一次 `step()`，直到它返回 false。
 */
export class FillRunner {
  private readonly batches: readonly (readonly BlockPos[])[];
  private readonly write: (pos: BlockPos) => boolean;
  private readonly batchSize: number;
  private readonly total: number;
  private batchIndex = 0;
  private cellIndex = 0;
  private visitedCount = 0;
  private writtenCount = 0;
  private cancelled = false;

  constructor(box: SelectionBox, options: FillRunnerOptions) {
    const plan = planFill(box, options.batchSize ?? FILL_BATCH_SIZE);
    this.batches = plan.batches;
    this.batchSize = plan.batchSize;
    this.total = plan.total;
    this.write = options.write;
  }

  /**
   * 推进一次（默认一整批，可传更小的预算）。
   *
   * @returns 是否还有后续（`false` 表示填完了或已被取消）
   */
  step(maxCells: number = this.batchSize): boolean {
    if (this.cancelled) return false;
    let budget = Number.isFinite(maxCells) ? Math.max(1, Math.floor(maxCells)) : this.batchSize;

    while (budget > 0 && !this.cancelled && this.batchIndex < this.batches.length) {
      const batch = this.batches[this.batchIndex]!;
      const pos = batch[this.cellIndex]!;
      this.cellIndex += 1;
      this.visitedCount += 1;
      budget -= 1;
      if (this.write(pos)) this.writtenCount += 1;
      // 写完这一批立刻换下一批：**不能**等下一轮 while 再发现越界——
      // 那样"最后一格写完了"还要多跑一帧空 step，调用方看到的 `done` 会晚一帧
      if (this.cellIndex >= batch.length) {
        this.batchIndex += 1;
        this.cellIndex = 0;
      }
    }
    return !this.done;
  }

  /** 中断：之后 `step` 一律返回 false（已经写进去的格子不回滚——回滚是撤销的事） */
  cancel(): void {
    this.cancelled = true;
  }

  get done(): boolean {
    return this.cancelled || this.batchIndex >= this.batches.length;
  }

  get progress(): FillProgress {
    return {
      done: this.done,
      cancelled: this.cancelled,
      visited: this.visitedCount,
      written: this.writtenCount,
      total: this.total,
    };
  }
}
