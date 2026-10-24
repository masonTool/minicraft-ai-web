/**
 * 房间列表（L9）：把 `GET /rooms` 的响应洗成界面能直接画的东西。
 *
 * 为什么单独一个模块：响应是**外部数据**（同网段里可能是别的版本、甚至不是本项目
 * 的服务端），而这里的每个字段都会直接进 DOM。清洗规则与读存档同一条思路——
 * 坏的那一项当不存在，绝不让 `undefined` / `NaN` / 超长房名流进界面。
 *
 * 纯函数、不碰 fetch：面板负责发请求，这里只负责"信不信、怎么信"，
 * `tests/room-list.test.ts` 离线断言。
 */

/** 列表里的一行 */
export interface RoomListEntry {
  /** 房间名（已按服务端规则校验过，可以直接拼进地址） */
  room: string;
  /** 在线人数（≥1，空房间服务端不会列出来） */
  players: number;
  /** 有没有房主（没有房主的房，进去之后没人跑模拟） */
  hasHost: boolean;
  /** 房主的世界名（可能是空串：房主没上报世界名） */
  worldName: string;
  /** 房主的世界种子（0 也可能是合法种子） */
  worldSeed: number;
}

/** 一次列表响应的清洗结果 */
export interface RoomListResult {
  /** 这台服务器要不要口令（服务端级，不是每房一套） */
  passwordRequired: boolean;
  rooms: RoomListEntry[];
}

/** 服务端只认这个字符集（与 `server/protocol.mjs` 的 `ROOM_RE` 一致） */
const ROOM_RE = /^[A-Za-z0-9_-]{1,24}$/;

/**
 * 清洗 `/rooms` 的响应。
 *
 * 返回 `null` = **这份响应根本不像我们的服务端**（不是对象 / 没有 `rooms` 数组），
 * 界面据此提示"列不出来，手填房间名"，而不是画一个空列表让人以为服务器上没人。
 */
export function parseRoomsResponse(raw: unknown): RoomListResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as { rooms?: unknown; passwordRequired?: unknown };
  if (!Array.isArray(payload.rooms)) return null;

  const rooms: RoomListEntry[] = [];
  for (const item of payload.rooms) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as {
      room?: unknown;
      players?: unknown;
      hasHost?: unknown;
      world?: unknown;
    };
    const room = typeof entry.room === 'string' ? entry.room : '';
    // 房名不合规的行直接丢：它会拼进地址，宁可不显示也不能拼出怪东西
    if (!ROOM_RE.test(room)) continue;
    const players = Number(entry.players);
    const world = (entry.world ?? {}) as { name?: unknown; seed?: unknown };
    const worldSeed = Number(world.seed);
    rooms.push({
      room,
      players: Number.isFinite(players) && players > 0 ? Math.trunc(players) : 1,
      hasHost: entry.hasHost === true,
      worldName: typeof world.name === 'string' ? world.name.slice(0, 32) : '',
      worldSeed: Number.isInteger(worldSeed) ? worldSeed : 0,
    });
  }
  // 人多的排前面：局域网里"去热闹那间"是唯一的选择依据
  rooms.sort((a, b) => b.players - a.players || a.room.localeCompare(b.room));
  return { passwordRequired: payload.passwordRequired === true, rooms };
}
