/**
 * 联机角色状态机（L8）
 *
 * 钉三件事：
 *   1. **单机是默认**——没进联机之前就是 `solo`，回归基线不靠"记得设回去"；
 *   2. 角色只由服务端给的 `isHost` 决定，且**严格等于 `true`**（`'false'` / `1` 都不算），
 *      宽松一次就是"两端都在模拟"，而这种 bug 不报错；
 *   3. 任何角色都能直接收到任何事件（`host` 重新加入别人的房间 → `client`），
 *      不做"必须先回 solo"的假约束——现实里它就是直接发生的。
 */

import { describe, expect, it } from 'vitest';
import { INITIAL_ROLE, nextRole, roleFromWelcome, type NetRole } from '../src/core/net/NetRole.ts';

describe('NetRole', () => {
  it('初始角色是 solo（单机行为是回归基线）', () => {
    expect(INITIAL_ROLE).toBe('solo');
  });

  it('加入当房主 → host', () => {
    expect(nextRole('solo', { type: 'joined', isHost: true })).toBe('host');
  });

  it('加入当从属 → client', () => {
    expect(nextRole('solo', { type: 'joined', isHost: false })).toBe('client');
  });

  it('离开 → 回到 solo', () => {
    expect(nextRole('host', { type: 'left' })).toBe('solo');
    expect(nextRole('client', { type: 'left' })).toBe('solo');
  });

  it('角色可以直接横跳（房主重新加入别人的房间 → client）', () => {
    expect(nextRole('host', { type: 'joined', isHost: false })).toBe('client');
    expect(nextRole('client', { type: 'joined', isHost: true })).toBe('host');
  });

  it('重复同一条事件是幂等的', () => {
    expect(nextRole('client', { type: 'joined', isHost: false })).toBe('client');
    expect(nextRole('solo', { type: 'left' })).toBe('solo');
  });

  it('迁移表覆盖任意角色 × 任意事件（不会漏出一种 undefined）', () => {
    const roles: NetRole[] = ['solo', 'host', 'client'];
    const events = [
      { type: 'joined', isHost: true } as const,
      { type: 'joined', isHost: false } as const,
      { type: 'left' } as const,
    ];
    const valid = new Set<string>(['solo', 'host', 'client']);
    for (const role of roles) {
      for (const event of events) {
        const next = nextRole(role, event);
        expect(valid.has(next)).toBe(true);
      }
    }
  });
});

describe('roleFromWelcome', () => {
  it('isHost 严格为 true 才是房主', () => {
    expect(roleFromWelcome({ isHost: true })).toBe('host');
  });

  it('缺字段 / false / 字符串 "false" / 数字 1 都算从属（宽松度与服务端一致）', () => {
    expect(roleFromWelcome({})).toBe('client');
    expect(roleFromWelcome({ isHost: false })).toBe('client');
    expect(roleFromWelcome({ isHost: 'false' })).toBe('client');
    expect(roleFromWelcome({ isHost: 'true' })).toBe('client');
    expect(roleFromWelcome({ isHost: 1 })).toBe('client');
    expect(roleFromWelcome(null)).toBe('client');
    expect(roleFromWelcome(undefined)).toBe('client');
  });
});
