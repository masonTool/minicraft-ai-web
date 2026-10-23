/**
 * 稳定的客户端标识（clientId）。
 *
 * 它**不是身份认证**：没有密码、没有签名，服务端只拿它做两件事——
 * ① 挡住"同一个浏览器开两个标签页"互相踢（同一 clientId 同时在线会被拒）；
 * ② 断线重连时把新连接认回原来的玩家（联机8 的 grace 会话）。
 *
 * 存在 localStorage 里，所以刷新页面还是同一个人；隐私模式/存储被禁时退化成
 * "这一次页面会话内有效"的随机 id（读不到也照样能玩，只是重连换个身份）。
 */

/** localStorage 的键。改它等于让所有老玩家换一个身份，非必要别动 */
export const CLIENT_ID_KEY = 'mc.clientId';

/** 与 `server/protocol.mjs` 的 `CLIENT_ID_RE` 同一形状：8~64 位字母/数字/-/_ */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** 只要能读能写这两个方法就够——测试可以塞一个假 storage，不必依赖浏览器 */
export interface ClientIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isValidClientId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ID_RE.test(value);
}

/**
 * 生成 16 位十六进制 id。
 *
 * `random` 可注入（测试要确定性）。故意不用 `crypto.randomUUID()`：
 * 它只在安全上下文里有，`http://192.168.x.x` 的开发联机拿不到。
 */
export function createClientId(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    const value = Math.floor(random() * 16);
    // 夹一下：注入的 random 返回 1 时不能生成 "16"
    out += Math.min(15, Math.max(0, value)).toString(16);
  }
  return out;
}

/**
 * 读出已有的 clientId；没有/形状不对就生成一个新的并写回去。
 *
 * 三种失败都要能继续玩：读抛异常（Safari 隐私模式）、写抛异常（配额满）、
 * 存的是旧格式（`"undefined"` 之类）。后两种最多是"这次会话换了个身份"。
 */
export function ensureClientId(storage: ClientIdStorage | null, random: () => number = Math.random): string {
  if (!storage) return createClientId(random);
  try {
    const existing = storage.getItem(CLIENT_ID_KEY);
    if (isValidClientId(existing)) return existing;
  } catch {
    /* 读不了 → 往下生成一个；写也会单独兜住 */
  }
  const created = createClientId(random);
  try {
    storage.setItem(CLIENT_ID_KEY, created);
  } catch {
    /* 隐私模式：这次会话用内存里的这个 id */
  }
  return created;
}

/** 浏览器入口：拿 localStorage；取不到（Worker / 沙箱 iframe）就退化成内存 id */
export function browserClientId(): string {
  try {
    return ensureClientId(window.localStorage);
  } catch {
    return createClientId();
  }
}
