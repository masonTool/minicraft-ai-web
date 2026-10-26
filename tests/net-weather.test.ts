/**
 * 天气权威的规则一致性（联机35）
 *
 * 服务端是纯 .mjs（不进打包）、客户端是 TS（要过类型检查），两边没有共同的运行时，
 * 所以规则**照抄了一份**。代价是"改规则要改两处"——这里用同一串随机数比对两边的结果，
 * 改漏一处会变红（这是抄一份能接受的唯一理由）。
 */

import { describe, expect, it } from 'vitest';
import {
  nextWeatherKind as serverNextKind,
  tickWeather as serverTick,
  weatherSecondsFor as serverSeconds,
} from '../server/node/weather.mjs';
import {
  nextWeatherKind as clientNextKind,
  tickWeather as clientTick,
  weatherSecondsFor as clientSeconds,
} from '../src/core/world/WeatherState.ts';

/** 固定序列的随机源：两边吃同一串数，结果就该一样 */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('服务端与客户端的天气规则一致', () => {
  it('下一段天气的种类', () => {
    const values = [0.1, 0.2, 0.9, 0.7, 0.5, 0.35, 0.61];
    for (const current of ['clear', 'rain', 'thunder'] as const) {
      expect(serverNextKind(sequence(values), current)).toBe(clientNextKind(sequence(values), current));
    }
  });

  it('一段天气该持续多久', () => {
    for (const kind of ['clear', 'rain', 'thunder'] as const) {
      expect(serverSeconds(sequence([0.25]), kind)).toBe(clientSeconds(sequence([0.25]), kind));
    }
  });

  it('推进：没到点不动、到点才换', () => {
    const values = [0.2, 0.5, 0.1];
    const state = { kind: 'clear' as const, seconds: 10 };
    // 没到点
    expect(serverTick(state, 3, sequence(values))).toEqual(clientTick(state, 3, sequence(values)));
    // 到点
    expect(serverTick(state, 20, sequence(values))).toEqual(clientTick(state, 20, sequence(values)));
  });

  it('雨天/雷暴一律转晴（两边的第一条规则）', () => {
    expect(serverNextKind(sequence([0.0]), 'rain')).toBe('clear');
    expect(serverNextKind(sequence([0.0]), 'thunder')).toBe('clear');
  });
});
