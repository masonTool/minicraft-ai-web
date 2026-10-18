/**
 * 构建版本信息（批次 182）
 *
 * 用户要求：首页要能看到"当前版本是哪一个"——编译时间 + 提交信息。
 * 这样在手机上看线上/本地页面时，不必去翻 git 就能确认拿到的是不是最新那一版。
 *
 * 两个值由 `vite.config.ts` 在**构建/启动开发服务器时**注入（`define`）：
 *  - `__BUILD_COMMIT__`：`<短 hash> <commit 标题>`
 *  - `__BUILD_TIME__`：构建时刻的 ISO 时间
 *
 * ⚠️ 这里用 `typeof __BUILD_COMMIT__ === 'string'` 而不是直接读：
 * Node 里的离线测试没有 Vite 的 `define`，直接引用会 ReferenceError；
 * `typeof` 对未声明的标识符是安全的，Vite 又会把两处都替换成字符串字面量。
 */

export interface BuildInfo {
  /** `abc1234 提交标题`；构建环境没有 git 时是 `unknown` */
  commit: string;
  /** ISO 时间；缺失时为空字符串 */
  buildTime: string;
}

export function readBuildInfo(): BuildInfo {
  const commit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'unknown';
  const buildTime = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
  return { commit, buildTime };
}

/**
 * 首页那一行的文案：`构建 2026-10-18 10:32 · abc1234 提交标题`
 *
 * 时间按**看页面这台设备的本地时区**显示（GitHub Actions 的机器是 UTC，
 * 直接印 ISO 会让国内玩家看到早上八小时前的时间，反而更困惑）。
 */
export function formatBuildInfo(info: BuildInfo): string {
  const commit = info.commit.trim().length > 0 ? info.commit.trim() : 'unknown';
  const time = formatLocalTime(info.buildTime);
  return time.length > 0 ? `构建 ${time} · ${commit}` : commit;
}

/** ISO → `YYYY-MM-DD HH:mm`（本地时区）；解析不了就返回空串 */
export function formatLocalTime(iso: string): string {
  if (iso.length === 0) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
