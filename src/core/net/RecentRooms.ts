/**
 * 最近连过的服务器/房间（L9）
 *
 * 局域网里就那么一两台服务器、一两个房间，可它们的地址是 `ws://192.168.1.5:25187`
 * 这种东西——每次手输（还是手机上）是纯折磨。这里记住最近几条，点一下就填回去。
 *
 * 三条刻意的做法：
 *  · **不存口令**：口令是进房门槛，不该在列表里长期躺着（面板自己有独立的
 *    `mc.mp.pw` 记着上次填的那个；这里只记"去过哪"）。
 *  · **按 `地址 + 房间` 去重**：同一台服务器的不同房间是两条记录，重复进同一间只挪到最前。
 *  · **清洗**：localStorage 是外部数据（可能被手改、或上个版本写的），坏条目直接丢。
 *
 * 纯函数、不碰 localStorage，`tests/recent-rooms.test.ts` 离线断言。
 */

/** 记忆条数上限：横屏面板只放得下两三颗，多存也没有意义 */
export const RECENT_LIMIT = 4;
/** 地址长度上限（防御 localStorage 里塞了巨型字符串） */
const URL_MAX = 128;
const ROOM_MAX = 24;
const NAME_MAX = 16;

export interface RecentRoom {
  /** 裸地址（`ws://192.168.1.5:25187`） */
  url: string;
  /** 房间名（空 = 默认房间） */
  room: string;
  /** 最近一次用的昵称（空 = 没记） */
  name: string;
  /** 上次连接时刻（毫秒时间戳） */
  at: number;
}

/**
 * 解析 localStorage 里那串 JSON。
 *
 * 返回 `[]` 而不是抛异常：坏数据（不是数组 / 条目不是对象 / 地址为空）一律当没有，
 * 一次手改不该让面板打不开。
 */
export function parseRecentRooms(raw: string | null): RecentRoom[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: RecentRoom[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Partial<RecentRoom>;
    const url = typeof entry.url === 'string' ? entry.url.trim().slice(0, URL_MAX) : '';
    if (url.length === 0) continue;
    const at = Number(entry.at);
    result.push({
      url,
      room: typeof entry.room === 'string' ? entry.room.slice(0, ROOM_MAX) : '',
      name: typeof entry.name === 'string' ? entry.name.slice(0, NAME_MAX) : '',
      at: Number.isFinite(at) ? at : 0,
    });
    if (result.length >= RECENT_LIMIT) break;
  }
  return result;
}

/**
 * 把一条记录放进去：同一 `地址 + 房间` 只留最新的那条、排在**最前面**。
 *
 * @returns 新列表（不改入参）+ 是否真的有变化（决定要不要写回 localStorage）
 */
export function pushRecentRoom(list: readonly RecentRoom[], entry: RecentRoom): RecentRoom[] {
  const url = entry.url.trim().slice(0, URL_MAX);
  if (url.length === 0) return [...list];
  const room = entry.room.slice(0, ROOM_MAX);
  const fresh: RecentRoom = {
    url,
    room,
    name: entry.name.slice(0, NAME_MAX),
    at: entry.at,
  };
  const rest = list.filter((item) => !(item.url === fresh.url && item.room === fresh.room));
  return [fresh, ...rest].slice(0, RECENT_LIMIT);
}

/** 序列化（写 localStorage 用） */
export function serializeRecentRooms(list: readonly RecentRoom[]): string {
  return JSON.stringify(list.slice(0, RECENT_LIMIT));
}
