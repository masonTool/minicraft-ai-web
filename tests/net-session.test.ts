/**
 * 联机会话状态机（联机7）
 *
 * 这些迁移原来散在 `NetClient` 的 onopen/onclose/onerror 里，每个分支都重复
 * `if (disposed) return; if (fatal) return;`。抽出来的意义就是"要不要重连只有
 * 一个出口"，所以这里逐条钉住：什么情况重连、什么情况停下。
 */

import { describe, expect, it } from 'vitest';
import { NetSession } from '../src/core/net/NetSession.ts';

describe('NetSession', () => {
  it('初始是 idle，connect 进 connecting', () => {
    const session = new NetSession();
    expect(session.state).toBe('idle');
    expect(session.connect()).toBe('connecting');
  });

  it('opened 进 connected 并把失败计数清零', () => {
    const session = new NetSession();
    session.connect();
    session.closed(); // 先失败一次
    session.connect();
    expect(session.opened()).toBe('connected');
    expect(session.retryCount).toBe(0);
  });

  it('已连上时再 connect 不会退回 connecting（重复调用安全）', () => {
    const session = new NetSession();
    session.connect();
    session.opened();
    expect(session.connect()).toBe('connected');
  });

  it('意外断开：进 reconnecting 并要求重连，失败次数累加', () => {
    const session = new NetSession();
    session.connect();
    session.opened();

    expect(session.closed()).toBe('reconnect');
    expect(session.state).toBe('reconnecting');
    expect(session.retryCount).toBe(1);

    session.connect();
    expect(session.closed()).toBe('reconnect');
    expect(session.retryCount).toBe(2);
  });

  it('致命错误不再重连，状态落到 offline', () => {
    const session = new NetSession();
    session.connect();
    session.opened();

    expect(session.closed({ fatal: true })).toBe('stop');
    expect(session.state).toBe('offline');
  });

  it('主动断开不再重连（随后的 onclose 也不会把状态改回 reconnecting）', () => {
    const session = new NetSession();
    session.connect();
    session.opened();
    session.disconnect();

    expect(session.state).toBe('offline');
    expect(session.closed({ intentional: true })).toBe('stop');
    expect(session.state).toBe('offline');
  });

  it('重连计时器被取消：状态回到 offline，且不算一次失败', () => {
    const session = new NetSession();
    session.connect();
    session.closed();
    expect(session.retryCount).toBe(1);

    session.aborted();
    expect(session.state).toBe('offline');
    expect(session.retryCount).toBe(1);
  });

  it('offline 之后仍能重新 connect（玩家手动再连一次）', () => {
    const session = new NetSession();
    session.connect();
    session.disconnect();
    expect(session.state).toBe('offline');

    session.connect();
    expect(session.state).toBe('connecting');
    expect(session.opened()).toBe('connected');
  });
});
