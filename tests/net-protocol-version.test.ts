/**
 * 协议版本一致性（联机2）
 *
 * 服务端是原生 ESM、客户端要经 TS 编译，版本号只能各写一份。
 * 这条断言就是"两处相等"的唯一防线——改了一边忘了另一边，这里立刻红。
 * 为什么不用共享 JSON：`with { type: 'json' }` 在 Node 20.10 以下会让服务端直接起不来。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NET_PROTOCOL_VERSION, isFatalProtocolError } from '../src/core/net/Protocol.ts';

const serverSource = readFileSync(new URL('../server/protocol.mjs', import.meta.url), 'utf8');

describe('协议版本', () => {
  it('客户端与服务端的版本号相等', () => {
    const match = /export const PROTOCOL_VERSION = (\d+);/.exec(serverSource);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(NET_PROTOCOL_VERSION);
  });

  it('版本号是正整数', () => {
    expect(Number.isInteger(NET_PROTOCOL_VERSION)).toBe(true);
    expect(NET_PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

describe('错误码分类', () => {
  it('版本/身份/重复连接是致命的（重连不会变好）', () => {
    expect(isFatalProtocolError('version')).toBe(true);
    expect(isFatalProtocolError('clientId')).toBe(true);
    expect(isFatalProtocolError('duplicate')).toBe(true);
  });

  it('消息级错误不致命（连接还在）', () => {
    expect(isFatalProtocolError('bad-json')).toBe(false);
    expect(isFatalProtocolError('unknown')).toBe(false);
    expect(isFatalProtocolError('joined')).toBe(false);
  });
});
