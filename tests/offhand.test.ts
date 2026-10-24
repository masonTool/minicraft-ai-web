/**
 * 副手交换（联机41）
 *
 * 副手槽本来就在（`OFFHAND_SLOT = 40`），这条补的是"F 键能换"与"上报"。交换只有三行，
 * 但顺序错了会丢东西，所以钉住四种组合。
 */

import { describe, expect, it } from 'vitest';
import { swapOffhand } from '../src/core/container/Offhand.ts';

describe('swapOffhand', () => {
  it('两边都有东西：互换', () => {
    expect(swapOffhand({ held: 'sword', offhand: 'shield' })).toEqual({ held: 'shield', offhand: 'sword' });
  });

  it('副手空：把手持挪过去（玩家最常见的用法）', () => {
    expect(swapOffhand({ held: 'torch', offhand: null })).toEqual({ held: null, offhand: 'torch' });
  });

  it('手持空：把副手取回手上', () => {
    expect(swapOffhand({ held: null, offhand: 'shield' })).toEqual({ held: 'shield', offhand: null });
  });

  it('两边都空：还是空（不该炸）', () => {
    expect(swapOffhand({ held: null, offhand: null })).toEqual({ held: null, offhand: null });
  });

  it('不修改入参（调用方可能还在用原对象）', () => {
    const input = { held: 'a', offhand: 'b' };
    swapOffhand(input);
    expect(input).toEqual({ held: 'a', offhand: 'b' });
  });

  it('交换两次回到原样（按两下 F 不该改变状态）', () => {
    const once = swapOffhand({ held: 'a', offhand: 'b' });
    expect(swapOffhand(once)).toEqual({ held: 'a', offhand: 'b' });
  });
});
