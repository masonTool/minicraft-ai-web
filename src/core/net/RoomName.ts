/**
 * 房间名（L9）。
 *
 * 房间名是**服务端数据表的 key 前缀**（`房名|维度|x,y,z`），而且现在还会拼进地址的
 * path（`ws://host:8887/<room>?pw=…`）——所以它只能是 ASCII 的
 * `[A-Za-z0-9_-]`、最长 24 字。这条规则与服务端 `server/protocol.mjs` 的
 * `ROOM_RE` 是**同一条**，客户端在这里先校验一遍只是为了当场给反馈，
 * 真正的收口仍在服务端（不可信输入一律回落默认房间）。
 *
 * 但玩家要输入的是"世界名"（很可能是「草原小屋」），所以这里做一件小事：
 * **从世界名派生一个合法房间名**——保留其中的 ASCII 字母数字，其余当作分隔符，
 * 一个合法字符都没有时退回 `w<种子>`。这样"开房"的默认值就是可用的，
 * 而不是让人对着一句"只能英文"重新起名字。
 */

/** 房间名长度上限（与服务端 `ROOM_RE` 一致） */
export const ROOM_NAME_MAX = 24;

/** 合法房间名：1~24 位字母/数字/`-`/`_` */
const ROOM_RE = /^[A-Za-z0-9_-]{1,24}$/;

/** 这个字符串能不能直接当房间名（服务端认不认） */
export function isValidRoomName(value: string): boolean {
  return ROOM_RE.test(value);
}

/**
 * 世界名 → 默认房间名。
 *
 * 规则：ASCII 字母数字保留；其它字符（空格、中文、标点）当成分隔符折成**一个** `-`；
 * 去掉首尾 `-`；截到 24 字。全是非法字符（纯中文世界名）时退回 `w<seed>` ——
 * 种子是这个世界自己的身份，同世界重开还是同一个房间。
 */
export function roomFromWorldName(name: string, seed: number): string {
  const ascii = [...name]
    .map((char) => (/[A-Za-z0-9]/.test(char) ? char : '-'))
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, ROOM_NAME_MAX);
  if (ascii.length > 0) return ascii;
  // 纯中文/纯符号的世界名：用种子的绝对值，负数也能拼出合法名字
  return `w${Math.abs(Math.trunc(seed))}`.slice(0, ROOM_NAME_MAX);
}

/**
 * 输入框里的房间名收口。
 *
 * 与 `roomFromWorldName` 不同：这是**用户自己打的字**，非法字符直接删掉而不是折成 `-`
 * （他打 `red room` 想要的显然是 `redroom` 或 `red-room` 里的一个，不该由我们猜）。
 * 删空了就用 `fallback`，再空就 `default`——永远给服务端一个它认的值。
 */
export function sanitizeRoomName(input: string, fallback = 'default'): string {
  const cleaned = [...input]
    .filter((char) => /[A-Za-z0-9_-]/.test(char))
    .join('')
    .slice(0, ROOM_NAME_MAX);
  if (cleaned.length > 0) return cleaned;
  const fallbackClean = [...fallback].filter((char) => /[A-Za-z0-9_-]/.test(char)).join('');
  return fallbackClean.length > 0 ? fallbackClean.slice(0, ROOM_NAME_MAX) : 'default';
}
