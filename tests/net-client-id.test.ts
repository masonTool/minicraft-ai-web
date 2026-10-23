/**
 * 客户端标识（联机2）
 *
 * 这一层要保证的只有一件事：**同一个浏览器刷新后还是同一个人**，
 * 而"存储不可用"（隐私模式、沙箱 iframe）不能把联机变成不可用。
 */

import { describe, expect, it } from 'vitest';
import {
  CLIENT_ID_KEY,
  createClientId,
  ensureClientId,
  isValidClientId,
  type ClientIdStorage,
} from '../src/core/net/ClientId.ts';

/** 假 storage：可预置内容、记录写入、按需抛异常 */
function memoryStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  const writes: string[] = [];
  const storage: ClientIdStorage = {
    getItem: (key) => (key in store ? store[key]! : null),
    setItem: (key, value) => {
      store[key] = value;
      writes.push(value);
    },
  };
  return { storage, store, writes };
}

/** 固定序列的 random：让生成结果可断言 */
function fixedRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe('clientId 形状', () => {
  it('8~64 位字母/数字/-/_ 合法', () => {
    expect(isValidClientId('abcdefgh')).toBe(true);
    expect(isValidClientId('AbC-123_xyz')).toBe(true);
    expect(isValidClientId('a'.repeat(64))).toBe(true);
  });

  it('太短、太长、带空格或中文都不合法', () => {
    expect(isValidClientId('short')).toBe(false);
    expect(isValidClientId('a'.repeat(65))).toBe(false);
    expect(isValidClientId('bad id 123')).toBe(false);
    expect(isValidClientId('中文中文中文')).toBe(false);
    expect(isValidClientId(null)).toBe(false);
    expect(isValidClientId(12345678)).toBe(false);
  });
});

describe('createClientId', () => {
  it('16 位十六进制，且通过合法性校验', () => {
    // createClientId 里是 floor(random() * 16)，所以注入 0/16 … 15/16 才得到 0…f
    const id = createClientId(fixedRandom(Array.from({ length: 16 }, (_, i) => i / 16)));
    expect(id).toBe('0123456789abcdef');
    expect(isValidClientId(id)).toBe(true);
  });

  it('random 返回 1 也不会生成 "16"', () => {
    const id = createClientId(() => 1);
    expect(id).toBe('f'.repeat(16));
  });
});

describe('ensureClientId', () => {
  it('已有合法 id 就直接复用，不写盘', () => {
    const { storage, writes } = memoryStorage({ [CLIENT_ID_KEY]: 'existing1234' });
    expect(ensureClientId(storage)).toBe('existing1234');
    expect(writes).toEqual([]);
  });

  it('没有/形状不对就生成一个并写回去', () => {
    for (const bad of [undefined, '', 'short', 'bad id']) {
      const { storage, store, writes } = memoryStorage(bad === undefined ? {} : { [CLIENT_ID_KEY]: bad });
      const id = ensureClientId(storage, fixedRandom([0, 1, 2, 15]));
      expect(isValidClientId(id)).toBe(true);
      expect(store[CLIENT_ID_KEY]).toBe(id);
      expect(writes).toEqual([id]);
    }
  });

  it('存储读写抛异常时也不抛（隐私模式还能玩）', () => {
    const broken: ClientIdStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const id = ensureClientId(broken, fixedRandom([0, 1]));
    expect(isValidClientId(id)).toBe(true);
    expect(id).toHaveLength(16);
  });

  it('没有 storage 时退化成内存 id', () => {
    const id = ensureClientId(null, fixedRandom([15]));
    expect(id).toBe('f'.repeat(16));
  });
});
