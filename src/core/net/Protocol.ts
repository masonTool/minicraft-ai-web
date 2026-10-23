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
 */
export const NET_PROTOCOL_VERSION = 1;

/**
 * 服务端会返回的错误码。
 *
 * `version` / `clientId` / `duplicate` 是**致命**的：重连也不会变好，客户端必须停下来；
 * `bad-json` / `unknown` / `joined` 是消息级错误，连接还在，继续用。
 */
export type ProtocolErrorCode = 'version' | 'clientId' | 'duplicate' | 'bad-json' | 'unknown' | 'joined';

/** 这些错误码出现后不再自动重连（与服务端文档里的口径一致） */
export function isFatalProtocolError(code: string): boolean {
  return code === 'version' || code === 'clientId' || code === 'duplicate';
}
