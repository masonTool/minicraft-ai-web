/**
 * 启动期的**渐进视距**（批次 100）
 *
 * 问题：开新世界时 `World.update(cx, cz, viewDistance)` 是**一次性**把整个视距
 * （默认 12 → 半径 12 的圆 ≈ 440 个区块）全派给地形 worker 的。
 * 那 440 个区块要真的生成出来，是几秒到十几秒的 CPU（手机更久），
 * 而玩家在"创建世界"那一刻想看到的其实只有**脚下这一片**。
 *
 * 做法：开局先只请求 3 格半径（≈ 29 个区块，几百毫秒内就能出地形），
 * 之后每 0.5 秒往外涨一格，涨到玩家设定的视距为止。
 * 于是"第一帧可玩"与"视距最终拉满"分成两件事——**总工作量没变，但玩家的等待变短了**，
 * 而且涨的过程中如果帧率掉下去（自适应视距那一套），它会停在当时的位置等一等。
 *
 * 为什么单独一个文件：这是一段**纯逻辑**（时间 → 半径），可以离线断言，
 * 而"什么时候该涨"这件事最容易写成散落在主循环里的 `if`。
 */

/** 开局先请求的半径（区块） */
export const STARTUP_RADIUS = 3;
/** 每隔多久往外涨一格 */
export const STARTUP_STEP_SECONDS = 0.5;

export class StartupRamp {
  private current: number;
  private timer = 0;
  /** 已经涨到目标了吗（到了之后主循环就不该再改视距） */
  private finished = false;

  constructor(initial: number = STARTUP_RADIUS) {
    this.current = initial;
  }

  get radius(): number {
    return this.current;
  }

  get done(): boolean {
    return this.finished;
  }

  /** 回到起点（换世界 / 换维度时调） */
  reset(): void {
    this.current = STARTUP_RADIUS;
    this.timer = 0;
    this.finished = false;
  }

  /**
   * 推进计时，返回**这一帧该用的半径**。
   *
   * @param dt 秒
   * @param target 玩家设定的视距（区块）；比开局半径还小时直接就位
   * @param paused 帧率吃紧时传 true：**停一停**，不要一边卡一边往外扩
   */
  advance(dt: number, target: number, paused = false): number {
    if (!this.finished && this.current >= target) {
      this.finished = true;
      this.current = target;
      return this.current;
    }
    if (this.finished || paused) return this.current;

    this.timer += dt;
    while (this.timer >= STARTUP_STEP_SECONDS && this.current < target) {
      this.timer -= STARTUP_STEP_SECONDS;
      this.current++;
    }
    if (this.current >= target) {
      this.current = target;
      this.finished = true;
    }
    return this.current;
  }
}
