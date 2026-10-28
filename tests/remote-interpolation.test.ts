/**
 * 远程玩家插值（L4，批次 601）
 *
 * 网络位置是离散到达的；这里钉住四件事：
 *  - 普通更新只走一部分，不瞬移；
 *  - 连续 step 最终收敛到目标；
 *  - 超过 8 格（重生/传送门）直接对齐；
 *  - 朝向走最短角，350° → 10° 不绕一圈。
 */

import { describe, expect, it } from 'vitest';
import {
  REMOTE_SMOOTH_TAU,
  REMOTE_TELEPORT_SNAP,
  RemotePlayerSmoother,
  lerpAngle,
} from '../web/src/core/net/RemoteInterpolation.ts';

describe('远程玩家位置插值', () => {
  it('普通更新不会瞬移，而是逐步逼近', () => {
    const smoother = new RemotePlayerSmoother({ x: 0, y: 64, z: 0, yaw: 0 });
    smoother.setTarget({ x: 1, y: 64, z: 0, yaw: 0 });
    expect(smoother.position.x).toBe(0);
    smoother.step(REMOTE_SMOOTH_TAU);
    expect(smoother.position.x).toBeGreaterThan(0);
    expect(smoother.position.x).toBeLessThan(1);
  });

  it('连续 step 会收敛到目标附近', () => {
    const smoother = new RemotePlayerSmoother({ x: 0, y: 64, z: 0, yaw: 0 });
    smoother.setTarget({ x: 4, y: 65, z: -2, yaw: 1 });
    for (let i = 0; i < 120; i++) smoother.step(1 / 60);
    expect(Math.abs(smoother.position.x - 4)).toBeLessThan(0.02);
    expect(Math.abs(smoother.position.y - 65)).toBeLessThan(0.02);
    expect(Math.abs(smoother.position.z + 2)).toBeLessThan(0.02);
  });

  it('超过瞬移阈值直接对齐，不拖长线', () => {
    const smoother = new RemotePlayerSmoother({ x: 0, y: 64, z: 0, yaw: 0 });
    smoother.setTarget({ x: REMOTE_TELEPORT_SNAP + 1, y: 70, z: 0, yaw: 0 });
    expect(smoother.position.x).toBe(REMOTE_TELEPORT_SNAP + 1);
    expect(smoother.position.y).toBe(70);
  });

  it('yaw 走最短角：350° → 10° 只走 20°', () => {
    const a = (350 * Math.PI) / 180;
    const b = (10 * Math.PI) / 180;
    const mid = lerpAngle(a, b, 0.5);
    // 中点应当在 0° 附近，而不是 180°
    expect(Math.abs(((mid * 180) / Math.PI + 360) % 360)).toBeLessThan(0.001);
  });

  it('dt=0 不改变位置', () => {
    const smoother = new RemotePlayerSmoother({ x: 1, y: 2, z: 3, yaw: 0 });
    smoother.setTarget({ x: 5, y: 2, z: 3, yaw: 0 });
    const before = smoother.position.x;
    smoother.step(0);
    expect(smoother.position.x).toBe(before);
  });
});
