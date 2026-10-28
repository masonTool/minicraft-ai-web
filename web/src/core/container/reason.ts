/**
 * 「为什么做不了」的**引用**（多语言 P2-7）。
 *
 * 逻辑层（`Anvil` / `Loom` / `CartographyTable`…）原来直接返回中文句子，
 * 于是界面只能把中文原样贴到红底那一行 —— 英文用户看到的是一句中文。
 * 现在逻辑层只返回**键 + 参数**，界面层用 `reasonText()` 渲染：
 *   - 逻辑层不依赖 i18n（离线断言、存档、日志里都是一串稳定的键）；
 *   - 界面层可以随意换语言，红底那行跟着变。
 *
 * ⚠️ 站台配方那套红底原因走的是另一条路（`StationRecipeReason` 短码 +
 * `stationReasonLabel()`）—— 它本来就是码，不需要这一层包装。
 */

import { tp } from '../i18n/I18n.ts';

/** 一条「做不了」的原因：键 + 可选占位符 */
export interface ReasonRef {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** 造一条原因（有参数时才带 `params`，让常见的无参情形保持对象最小） */
export function reason(key: string, params?: Record<string, string | number>): ReasonRef {
  return params === undefined ? { key } : { key, params };
}

/** 渲染成当前语言的一句话（界面层只调这个） */
export function reasonText(ref: ReasonRef): string {
  return tp(ref.key, { ...(ref.params ?? {}) });
}
