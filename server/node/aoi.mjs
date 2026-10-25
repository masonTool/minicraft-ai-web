/**
 * 广播的"关注范围"（联机27）。
 *
 * 原来 `broadcast` 把消息发给**同一房间的所有人**：A 在出生点、B 跑到 5000 格外，
 * A 每改一格方块 B 都会收到——B 根本看不见那一格，这份流量纯属浪费（人多时是 O(n²)：
 * n 个玩家各发一条，每条都要发给 n 个玩家）。
 *
 * 现在按"8 区块 + 同维度"过滤（O(n·k)，k 是范围内的玩家数）。范围取 8 区块与
 * `welcome` 的裁剪半径一致——**看得见的范围**才需要实时更新，这是同一条口径。
 *
 * ⚠️ 只过滤**坐标类**消息（方块 / 容器 / 牌子 / 展示框 / TNT / 掉落物 / 生物命中 / 箭）。
 * 玩家位置（`player`）不过滤：那样远处队友会直接从世界里消失（名字牌、模型都没了），
 * 而位置消息本身已经被 `move` 的 100ms 限频压过。聊天与时间也不过（前者是文字、后者全局）。
 *
 * 纯函数，`tests/net-aoi-broadcast.test.ts` 直接断言。
 */

/** 广播关注半径（区块）。与 `welcome` 的裁剪半径同一个数：看得见才需要更新 */
export const AOI_RADIUS_CHUNKS = 8;

/**
 * 这个玩家要不要收到"某一格/某一点"的广播。
 *
 * 判据：**同维度** + 水平**切比雪夫**距离 ≤ 半径（切比雪夫 = 方形视野，与渲染的
 * 区块加载范围一致；用欧氏距离会让对角线方向少发一圈）。
 */
export function withinAoi(player, x, z, dimension, radiusChunks = AOI_RADIUS_CHUNKS) {
  if (!player) return false;
  if (player.dimension !== dimension) return false;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const dx = Math.abs((Math.trunc(player.x) >> 4) - (Math.trunc(x) >> 4));
  const dz = Math.abs((Math.trunc(player.z) >> 4) - (Math.trunc(z) >> 4));
  return Math.max(dx, dz) <= radiusChunks;
}
