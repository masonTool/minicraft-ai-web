/**
 * 联机协议的共享常量与清洗函数（服务端）。
 *
 * 为什么不是 `.ts`：`server/index.mjs` 是直接 `node` 跑的原生 ESM，不经过打包。
 * 版本号在客户端另有一份（`src/core/net/Protocol.ts`），两处相等由
 * `tests/net-protocol-version.test.ts` 断言——为一个数字引入 JSON import attributes
 * 会让服务端在 Node 20.10 以下直接起不来，不值得。
 */

/**
 * 协议版本。**改字段语义就 +1**；两端不一致时服务端拒绝连接，而不是静默错乱。
 *
 * v2（L8）：`join` 多了 `host`（谁开房 → 谁是唯一模拟者）、`welcome` 多了 `isHost` / `hostId`。
 * 旧客户端没有这两个字段，连上来会当成"房主"或"普通客户端"各算一遍世界——正是要消灭的
 * 不一致，所以**不保留 v1 兼容**，直接由版本位拒连。
 */
export const PROTOCOL_VERSION = 2;

/**
 * 名字最长多少个**字符**（不是字节）。
 *
 * 与命名牌同一口径（`core/entity/NameTag.ts`）：按字节卡会让三个中文名就超。
 */
export const MAX_NAME_LENGTH = 16;

/**
 * 自定义关闭码（4000~4999 是应用段）。
 *
 * 客户端判的是 `error.code`，不是关闭码——关闭码只给日志/抓包看。
 */
export const CLOSE_VERSION = 4001;
export const CLOSE_CLIENT_ID = 4002;
export const CLOSE_DUPLICATE = 4003;

/** clientId 的合法形状：8~64 位字母/数字/下划线/连字符（浏览器生成的是 16 位 hex） */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** 允许的维度名（与客户端 `DimensionId` 的三档一致） */
const DIMENSIONS = new Set(['overworld', 'nether', 'end']);

/**
 * 维度名收口：非法/缺失一律回主世界。
 *
 * 不做原样透传：维度是 `edits` / 容器表的 key 之一，一个拼错的名字会让那一片改动
 * 永远对不上（别人眼里那片地形就是没改过），而且日志里看不出来。
 */
export function sanitizeDimension(value) {
  return typeof value === 'string' && DIMENSIONS.has(value) ? value : 'overworld';
}

/** 数字收口：NaN / 非数字字符串 / undefined 都回落到默认值（join 的坐标用） */
export function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isValidClientId(value) {
  return typeof value === 'string' && CLIENT_ID_RE.test(value);
}

/**
 * 把客户端给的名字洗成一个能安全显示的名字。
 *
 * 三件事，每一件都有具体理由：
 *   · **去掉控制字符与尖括号**：聊天里用 `<名字>` 包，名字带 `>` 就能伪造一段前缀
 *     （`<a> 假消息` 看起来像系统发言）；控制字符会让日志/界面错行。
 *   · **按字符截断**：`slice(0, 16)` 会把 emoji 的代理对切成半个，界面上是乱码方块。
 *   · **空的退回"玩家"**：原版也允许空名字，但空名字在消息栏里看起来像一条系统提示。
 */
export function sanitizeName(value) {
  const raw = typeof value === 'string' ? value : '';
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('');
  return chars.length > 0 ? chars : '玩家';
}

// ---------------------------------------------------------------- 方块/容器消息的校验（联机24）

/**
 * 世界高度范围（与客户端 `core/world/Chunk.ts` 的 `WORLD_MIN_Y` / `WORLD_MAX_Y` 一致）。
 *
 * 越界的 y 在客户端会被 `Chunk.index` 算成**别的格子**的下标，等于"改了一格不相干的
 * 方块"——比拒收更难查，所以在这里就挡掉。
 */
export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 320;

/**
 * 方块 id 的上界。
 *
 * ⚠️ 这不是**精确白名单**：精确白名单要把客户端的注册表（`core/registry/blocks.ts`）
 * 同步到服务端（生成文件或接口），而这份注册表每个版本都在长。这里只挡住"明显不是
 * 方块"的 id（负数、超大数）。上界给到 2000 是当前 id 空间的两倍多，
 * `tests/net-block-validation.test.ts` 会断言真实注册表的最大 id 小于它——注册表长到
 * 超过 2000 时那条测试会红，逼着把上界一起调。
 */
export const MAX_BLOCK_ID = 2000;

/** 方块 state 的位宽上限（客户端按 8 位打包，见 `ChunkEdits.packEdit`） */
export const MAX_BLOCK_STATE = 255;

/**
 * 一次方块/容器改动允许离玩家多远（格）。
 *
 * 没有这条，一个客户端就能"隔空改主城"——服务端连距离都不看，改哪儿都收。
 * 64 格比视距（默认 8 区块 = 128 格）小，正常玩法够用；而且玩家位置本身也是
 * 客户端报的（`move` 没有校验），这道闸只能挡住"完全不相关坐标"，挡不住精心伪造。
 */
export const MAX_EDIT_DISTANCE = 64;

/** `(x, z)` 离玩家多远（水平距离；垂直方向不参与——上下挖矿是常事） */
export function withinEditReach(player, x, z, maxDistance = MAX_EDIT_DISTANCE) {
  if (!player) return false;
  const dx = x - player.x;
  const dz = z - player.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false;
  return Math.hypot(dx, dz) <= maxDistance;
}

/**
 * 一条方块改动是否可信（`block` / `blocks` 共用）。
 *
 * @returns `null` = 通过；否则是拒收原因（只给日志用，不回给客户端）
 */
export function blockEditRejection(player, x, y, z, id, state) {
  if (![x, y, z, id, state].every(Number.isFinite)) return 'not-finite';
  if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 'y-range';
  if (id < 0 || id > MAX_BLOCK_ID) return 'id-range';
  if (state < 0 || state > MAX_BLOCK_STATE) return 'state-range';
  if (!withinEditReach(player, x, z)) return 'distance';
  return null;
}

// ---------------------------------------------------------------- 房间（联机26）

/** 没有指定房间时的默认房间名 */
export const DEFAULT_ROOM = 'default';

/** 房间名：1~24 位字母/数字/`-`/`_`。太宽松会让"房名即 key"那套失效（拼出怪字符） */
const ROOM_RE = /^[A-Za-z0-9_-]{1,24}$/;

/**
 * 房间名收口：非法/缺失一律回默认房间。
 *
 * 房间名是**数据表的 key 前缀**（方块增量、容器、牌子、展示框都按房隔离），
 * 一个带分隔符的名字会让两房的数据在 key 上撞车——所以这里宁可回默认，也不透传。
 */
export function sanitizeRoom(value) {
  return typeof value === 'string' && ROOM_RE.test(value) ? value : DEFAULT_ROOM;
}
