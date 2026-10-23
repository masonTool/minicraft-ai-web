/**
 * 快照裁剪与容量策略（联机14）。
 *
 * 两个问题，原来都是"没有策略"：
 *
 *  1. **`welcome` 把全服所有方块改动一次发完**。跑久了的房间能攒到十几万条，
 *     新玩家一进来就要收几 MB 的 JSON，手机直接卡住（而这个玩家真正能看到的
 *     可能只是其中几百格）。
 *  2. **`MAX_EDITS` 满了静默丢弃新改动**。写入方（客户端）完全不知道，队友那边
 *     就是"我改的东西不见了"，日志里也看不出来。
 *
 * 现在的口径：
 *  - `welcome` 只发**玩家附近**（同维度 + 切比雪夫距离 ≤ 半径）的改动；
 *  - 满了之后淘汰**最旧的一条**（Map 的插入顺序就是新旧顺序）并打日志告警。
 *
 * ⚠️ 裁剪的代价：远处（半径外）的改动新玩家收不到，要等他走过去才知道——
 * 那需要"按视野补发"，是联机27（广播 AOI）的事。这里先把"一次发几 MB"按住。
 *
 * 纯函数、无副作用，`tests/net-snapshot-policy.test.ts` 直接断言。
 */

/** 快照里带的改动半径（区块）。8 区块 = 128 格，比默认视距还大一圈，足够覆盖"看得见的范围" */
export const SNAPSHOT_RADIUS_CHUNKS = 8;

/** 方块增量的默认上限 */
export const DEFAULT_MAX_EDITS = 200_000;

/** 两个世界坐标之间的切比雪夫距离（按区块算，与"方形视距"一致） */
export function chunkDistance(ax, az, bx, bz) {
  const dx = Math.abs((ax >> 4) - (bx >> 4));
  const dz = Math.abs((az >> 4) - (bz >> 4));
  return Math.max(dx, dz);
}

/**
 * 挑出该发给这个玩家的方块改动。
 *
 * @param {Iterable<{x:number,y:number,z:number,id:number,state:number,dimension:string}>} list
 * @param {{x:number, z:number, dimension:string}} player
 * @param {number} [radiusChunks]
 */
export function selectSnapshotEdits(list, player, radiusChunks = SNAPSHOT_RADIUS_CHUNKS) {
  const out = [];
  for (const edit of list) {
    // 维度先判：别的维度的改动对这个玩家当前世界毫无意义（客户端也会按 planRemoteBlock 丢掉）
    if (edit.dimension !== player.dimension) continue;
    if (chunkDistance(edit.x, edit.z, player.x, player.z) > radiusChunks) continue;
    out.push(edit);
  }
  return out;
}

/**
 * 记一条方块改动，满了就淘汰最旧的一条。
 *
 * 用 Map 的插入顺序当新旧顺序：重新 set 同一个 key **不会**改变它的位置（这是
 * ECMAScript 的语义），所以"最近被改过"的格子不会被误当成最旧的淘汰掉。
 *
 * @param {Map<string, object>} map
 * @param {string} key
 * @param {object} value
 * @param {number} max
 * @param {(evicted: string) => void} [onEvict] 淘汰回调（调用方用来打告警日志）
 * @returns {'stored'|'evicted'}
 */
export function rememberEdit(map, key, value, max, onEvict = () => {}) {
  // 覆盖已有 key 不增加条目数：先判 has 再判容量，否则"已经满了但这条只是更新"会被误淘汰
  const existed = map.has(key);
  let evicted = false;
  if (!existed && map.size >= max) {
    const oldest = map.keys().next();
    if (!oldest.done) {
      map.delete(oldest.value);
      onEvict(oldest.value);
      evicted = true;
    }
  }
  map.set(key, value);
  return evicted ? 'evicted' : 'stored';
}
