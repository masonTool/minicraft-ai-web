/**
 * 联机协议版本（客户端侧）。
 *
 * ⚠️ **必须与 `server/protocol.mjs` 的 `PROTOCOL_VERSION` 相等**。
 * 两处各写一份是有意的：服务端是直接 `node` 跑的原生 ESM、客户端要经 TS 编译，
 * 为一个数字引入 JSON import attributes 会让服务端在 Node 20.10 以下起不来。
 * 防漂的办法是一条断言——`tests/net-protocol-version.test.ts` 读两份源码比数字。
 *
 * 什么时候 +1：**字段语义变了、旧客户端会理解错**（加一个可选字段不算，删改字段算）。
 * 版本不一致时服务端拒绝连接并回 `error.code = 'version'`，客户端据此**不重连**
 * （否则会每 3 秒撞一次墙）。
 *
 * v2（L8 房主权威）：`join` 带 `host`、`welcome` 下 `isHost` / `hostId`。这不只是"多了
 * 两个可选字段"——旧客户端收不到 `hostId` 就会自己跑模拟，于是**两端各算一遍世界**，
 * 正是这一版要消灭的不一致。所以旧版本由版本位拒连，不做兼容。
 */
export const NET_PROTOCOL_VERSION = 2;

/**
 * 服务端会返回的错误码。
 *
 * `version` / `clientId` / `duplicate` / `host-taken` 是**致命**的：重连也不会变好，
 * 客户端必须停下来；`bad-json` / `unknown` / `joined` 是消息级错误，连接还在，继续用。
 *
 * `host-taken`（L8）：这个房间已经有房主。**算致命**——房主不走，重连一万次也还是他；
 * 每 3 秒撞一次墙只会把日志刷满、把"开不了房"这个事实埋掉。
 */
export type ProtocolErrorCode =
  | 'version'
  | 'clientId'
  | 'duplicate'
  | 'host-taken'
  | 'host-left'
  | 'bad-json'
  | 'unknown'
  | 'joined';

/** 这些错误码出现后不再自动重连（与服务端文档里的口径一致） */
export function isFatalProtocolError(code: string): boolean {
  return (
    code === 'version' ||
    code === 'clientId' ||
    code === 'duplicate' ||
    code === 'host-taken' ||
    // `host-left`（L8 · MS4）：房主退出、房间已关闭。重连只会立刻被同一个理由踢回来
    code === 'host-left'
  );
}
