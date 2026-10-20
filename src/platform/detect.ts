import type { PlatformKind } from './types.ts';

/** 只探测“宿主提供了什么”，不 import 任何平台实现（Node 测试可直接用） */
export interface PlatformScope {
  wx?: { createCanvas?: unknown };
  tt?: { createCanvas?: unknown };
  document?: unknown;
}

export type DetectedPlatform = PlatformKind | 'unknown';

/**
 * 判定当前宿主。
 *
 * ⚠️ 顺序：先看小游戏 API，再看 document。
 * 微信小游戏经过适配器之后**也会有** `document`（假 DOM），
 * 如果先看 document 会误判成 web。
 */
export function detectPlatformKind(
  scope: PlatformScope = globalThis as unknown as PlatformScope,
): DetectedPlatform {
  if (scope.wx && typeof scope.wx.createCanvas === 'function') return 'wx';
  if (scope.tt && typeof scope.tt.createCanvas === 'function') return 'tt';
  if (scope.document) return 'web';
  return 'unknown';
}

export function assertPlatformKind(kind: DetectedPlatform): asserts kind is PlatformKind {
  if (kind === 'unknown') {
    throw new Error('无法识别运行平台：既没有 wx/tt 小游戏 API，也没有 document');
  }
}
