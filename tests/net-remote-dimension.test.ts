/**
 * 远端玩家的维度可见性（联机3）
 *
 * 远端玩家不在 `EntityManager` 里，主程序每帧靠这张表决定画不画；
 * 判错的两种表现都很显眼：队友在下界，你主世界同坐标站着一个"分身"；
 * 或者队友回到你身边了却一直看不见。
 */

import { describe, expect, it } from 'vitest';
import { RemotePresence } from '../src/core/net/RemotePresence.ts';

describe('RemotePresence', () => {
  it('没有记录时按同维度处理（旧服务端不带 dimension）', () => {
    const presence = new RemotePresence();
    expect(presence.visible(7, 'overworld')).toBe(true);
    expect(presence.visible(7, 'nether')).toBe(true);
  });

  it('记录维度后只有同维度可见', () => {
    const presence = new RemotePresence();
    presence.set(1, 'nether');
    expect(presence.visible(1, 'nether')).toBe(true);
    expect(presence.visible(1, 'overworld')).toBe(false);
    expect(presence.visible(1, 'end')).toBe(false);
  });

  it('重复 set 覆盖旧值（玩家走过传送门）', () => {
    const presence = new RemotePresence();
    presence.set(1, 'overworld');
    presence.set(1, 'nether');
    expect(presence.dimensionOf(1)).toBe('nether');
    expect(presence.visible(1, 'overworld')).toBe(false);
    expect(presence.visible(1, 'nether')).toBe(true);
  });

  it('remove 之后回落到"无记录"（可见）', () => {
    const presence = new RemotePresence();
    presence.set(1, 'nether');
    presence.remove(1);
    expect(presence.dimensionOf(1)).toBeUndefined();
    expect(presence.visible(1, 'overworld')).toBe(true);
  });

  it('clear 清空所有记录（断线时用）', () => {
    const presence = new RemotePresence();
    presence.set(1, 'nether');
    presence.set(2, 'end');
    presence.clear();
    expect(presence.dimensionOf(1)).toBeUndefined();
    expect(presence.dimensionOf(2)).toBeUndefined();
  });

  it('按 id 隔离：同一个坐标的两个人互不影响', () => {
    const presence = new RemotePresence();
    presence.set(1, 'nether');
    presence.set(2, 'nether');
    presence.remove(1);
    expect(presence.visible(1, 'overworld')).toBe(true);
    expect(presence.visible(2, 'overworld')).toBe(false);
  });
});
