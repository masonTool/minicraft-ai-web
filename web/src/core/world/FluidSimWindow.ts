/**
 * 流体模拟窗口（批次 283）
 *
 * ## 为什么需要它
 *
 * 真机日志（792×360 / Adreno 829）里，流体每秒造成 3000+ 次方块写入，
 * 占全部写入的 95%；每次写入都要跑一趟光照 BFS（≈55 格），
 * 折算 19.5 万格/秒，正好吃满手机 4000 格/帧的光照预算。
 *
 * 而玩家真正看得见的水，只在他周围一小圈。我们把**加载范围**当成了**模拟范围**：
 * 视距 4 时 81 个区块全在 20Hz 推进流体，视距 6 时 169 个 —— 这是原版没有的。
 * 原版有独立的 simulation distance（模拟距离 ≤ 视距），随机刻我们已经这么做了
 * （`RANDOM_TICK_RADIUS = 3`，见 `main.tickWorldBlocks`），流体是唯一漏掉的那一个。
 *
 * ## 语义
 *
 *  - **窗口内**（玩家所在区块 ± 3，切比雪夫，即 7×7 = 49 个区块）的流体刻照常执行；
 *  - **窗口外**的流体刻**直接丢弃**（不是推迟）——远处的水保持静止。
 *
 * 为什么丢弃是安全的：`Fluids.desiredFluidState` 每次都从"上邻 / 四邻 / 两个水源"
 * 重新推导，不依赖历史。所以"冻结"只意味着这次没推进，不会把世界写坏；
 * 玩家回到附近、又动了一格水，同一个格子的下一刻会按当前世界重新算。
 *
 * ## 每 tick 上限
 *
 * `TickScheduler.advance()` 一次会把**所有到期**的任务交出来（容量 4096），
 * 一 tick 内有上千个流体刻全压在同一帧时就是一个 30ms 长帧（日志里 26.1ms 那一下）。
 * 所以这里再给一个每 tick 上限：超出的**推迟一格**（`schedule(..., 1)`），
 * 让水流慢一点，但帧时间不被单个 tick 撕开。
 *
 * 该模块是纯函数，离线可断言（`test:tick`）。
 */

/**
 * 流体模拟半径（区块，切比雪夫）。
 *
 * 与 `RANDOM_TICK_RADIUS` 对齐：随机刻跑 7×7，流体也跑 7×7，
 * 于是"看得见的世界"与"活着的世界"是同一个范围，不会再出现
 * "视距越大、卡得越狠"的恶性循环（视距 4 → 49/81，视距 6 → 49/169）。
 */
export const FLUID_SIM_RADIUS_CHUNKS = 3;

/**
 * 一次逻辑 tick（20Hz）最多执行多少个流体刻。
 *
 * 20 × 256 = 5120 刻/秒，高于真机观测到的 3000~4300 次状态变化/秒，
 * 所以正常水流不会被这个上限拖慢；它只在"一 tick 突然到期上千个"时兜底。
 */
export const FLUID_TICKS_PER_TICK = 256;

/** 这个方块位置是否落在流体模拟窗口里（按区块的切比雪夫距离，竖直方向不限） */
export function isWithinFluidSim(
  playerX: number,
  playerZ: number,
  x: number,
  z: number,
  radius = FLUID_SIM_RADIUS_CHUNKS,
): boolean {
  const pcx = Math.floor(playerX / 16);
  const pcz = Math.floor(playerZ / 16);
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  return Math.abs(cx - pcx) <= radius && Math.abs(cz - pcz) <= radius;
}
