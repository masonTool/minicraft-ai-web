/**
 * 野怪追谁（用户 2026-10-26："野怪只攻击房主，不攻击房客"）
 *
 * 根因不在网络：从属端根本不跑生物 AI（`SimMode`），整场模拟都在房主那边，
 * 而 `EntityContext.player` 只有一个（**本地玩家 = 房主**）——怪物自然看不见房客。
 *
 * 修法是给上下文加一个可选的 `targetFor`：主程序按生物挑"最近的玩家"，
 * 可能是某个远端玩家。这里钉住"指定了就按指定的算、没指定退回本地玩家"这条链，
 * 以及 `hit` 能把伤害导向别处（远端玩家走网络，不能直接改本地血量）。
 */
import { describe, expect, it } from 'vitest';
import { Mob } from '../web/src/core/entity/Mob.ts';
import { mobTypeById } from '../web/src/core/entity/mobs.ts';
import type { EntityContext, PlayerTarget } from '../web/src/core/entity/Entity.ts';

const bareContext = (extra: Partial<EntityContext> = {}): EntityContext =>
  ({
    player: { x: 100, y: 64, z: 0 },
    ...extra,
  }) as unknown as EntityContext;

describe('Mob 的目标选择', () => {
  it('没有 targetFor 时用本地玩家（老行为不变）', () => {
    const zombie = new Mob(mobTypeById('zombie')!, 0, 64, 0);
    // 水平距离 100 格
    expect(zombie.distanceToPlayerSq(bareContext())).toBe(10000);
  });

  it('主程序指定了远端玩家 → 按他算距离', () => {
    const zombie = new Mob(mobTypeById('zombie')!, 0, 64, 0);
    const remote: PlayerTarget = { x: 3, y: 64, z: 4 };
    const ctx = bareContext({ targetFor: () => remote });
    // 3-4-5
    expect(zombie.distanceToPlayerSq(ctx)).toBe(25);
  });

  it('targetFor 返回 null → 退回本地玩家（房主自己更近时就是这个分支）', () => {
    const zombie = new Mob(mobTypeById('zombie')!, 0, 64, 0);
    const ctx = bareContext({ targetFor: () => null });
    expect(zombie.distanceToPlayerSq(ctx)).toBe(10000);
  });

  it('没有本地玩家但有远端目标时也能算出距离（房主观战/未加载的边界）', () => {
    const zombie = new Mob(mobTypeById('zombie')!, 0, 64, 0);
    const ctx = bareContext({ player: null, targetFor: () => ({ x: 0, y: 64, z: 6 }) });
    expect(zombie.distanceToPlayerSq(ctx)).toBe(36);
  });
});
