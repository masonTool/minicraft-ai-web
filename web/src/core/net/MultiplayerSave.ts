/**
 * 联机世界的本地存档 id（联机6）。
 *
 * 为什么必须分开：联机时队友的方块改动、容器内容、时间都会落到本地存档里
 * （`联机4` 起还连未加载区块的改动也一起记）。混在单机档里就是**永久污染**：
 * 退出联机之后，那个单机世界的地形已经变成了队友的世界。
 *
 * 做法是给联机档换一个**库名**（`dbNameFor` 由 world id 派生），加 `@mp:<room>`
 * 后缀即可。这样：
 *  - 删联机档不会碰单机档，反之亦然；
 *  - 同一世界在不同房间的联机档也各自独立（一房一世界，`联机26`）。
 *
 * 该模块不依赖 IndexedDB 与渲染层，可以直接离线断言。
 */

/** 单房间服务端（`联机26` 之前没有房间码）用的默认房间名 */
export const DEFAULT_MULTIPLAYER_ROOM = 'default';

/** 联机档的 world id 后缀分隔符；`isMultiplayerWorldId` 靠它判 */
const MULTIPLAYER_MARK = '@mp:';

/**
 * 单机 world id + 房间名 (+ 房间的世界种子) → 联机档的 world id（`dbNameFor` 据此派生库名）。
 *
 * 为什么第三段是**种子**（L9）：地形由房主的那个世界决定，同一个房间名换一个世界开房，
 * 里面是**另一片大陆**——沿用同一个库就会把上一片大陆的方块增量灌到新地形上
 * （表现为"刚进去就有一堆别人世界的改动"）。带上种子 = 一房一世界一库。
 *
 * 不传 `seed` 时保持老格式（`@mp:<room>`）：那是这一批之前的库名，读不读由调用方决定。
 * 种子可以是负数，原样拼进去（`@mp:room@-5`）；`dbNameFor` 只做前缀拼接，不解析它。
 */
export function multiplayerWorldId(
  worldId: string,
  roomId: string = DEFAULT_MULTIPLAYER_ROOM,
  seed?: number,
): string {
  const base = `${worldId}${MULTIPLAYER_MARK}${roomId}`;
  return seed !== undefined && Number.isInteger(seed) ? `${base}@${seed}` : base;
}

/** 这个 world id 是不是联机档（单机 id 里不可能出现 `@mp:`） */
export function isMultiplayerWorldId(worldId: string): boolean {
  return worldId.includes(MULTIPLAYER_MARK);
}

/** 从联机档 world id 反解出单机 world id（回退单机世界时用） */
export function singlePlayerWorldId(worldId: string): string {
  const at = worldId.indexOf(MULTIPLAYER_MARK);
  return at < 0 ? worldId : worldId.slice(0, at);
}
