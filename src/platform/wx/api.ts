/** 微信小游戏 API 的最小访问层；具体方法按需在调用处取，避免维护一份巨大的类型表 */
export type WxApi = Record<string, any>;

export function getWxApi(): WxApi {
  const api = (globalThis as unknown as { wx?: WxApi }).wx;
  if (!api) {
    throw new Error('wx API 不可用：请先 import src/platform/wx/bootstrap.ts');
  }
  return api;
}
