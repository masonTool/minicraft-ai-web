import type { PlatformKind } from './types.ts';

/** 某个平台暂未实现的能力；调用方应捕获并降级，而不是白屏 */
export class PlatformNotImplementedError extends Error {
  readonly feature: string;
  readonly kind: PlatformKind;

  constructor(feature: string, kind: PlatformKind) {
    super(`${feature} 在 ${kind} 上尚未实现`);
    this.name = 'PlatformNotImplementedError';
    this.feature = feature;
    this.kind = kind;
  }
}
