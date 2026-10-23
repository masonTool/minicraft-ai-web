/**
 * 方块广播的出口漏斗（联机12）
 *
 * 两件事值得钉死：**同格只留最后一稿**（水流/红石在 100ms 内会改同一格好几次）与
 * **合帧到点才发**（否则等于没合帧）。上限那条是给爆炸铺的——一次几百格不能塞成一个包。
 */

import { describe, expect, it } from 'vitest';
import {
  BLOCK_FLUSH_INTERVAL_MS,
  BlockFunnel,
  MAX_BLOCKS_PER_FLUSH,
} from '../src/core/net/BlockFunnel.ts';

const edit = (x: number, y: number, z: number, id: number, dimension = 'overworld') => ({
  x,
  y,
  z,
  id,
  state: 0,
  dimension,
});

describe('BlockFunnel 合帧', () => {
  it(`不到 ${BLOCK_FLUSH_INTERVAL_MS}ms 不发`, () => {
    const funnel = new BlockFunnel();
    funnel.push(edit(1, 70, 1, 1));
    expect(funnel.tick(0.05)).toBe(false);
    expect(funnel.size).toBe(1);
  });

  it('攒满一帧就发', () => {
    const funnel = new BlockFunnel();
    funnel.push(edit(1, 70, 1, 1));
    expect(funnel.tick(0.11)).toBe(true);
    const batch = funnel.drain();
    expect(batch).toHaveLength(1);
    expect(funnel.size).toBe(0);
  });

  it('空漏斗到点也不发（不产生空包）', () => {
    const funnel = new BlockFunnel();
    expect(funnel.tick(1)).toBe(false);
  });

  it('多次小步累积也能凑够一帧（不要求单帧 dt > 100ms）', () => {
    const funnel = new BlockFunnel();
    funnel.push(edit(1, 70, 1, 1));
    let fired = false;
    for (let i = 0; i < 10; i++) fired = funnel.tick(0.016) || fired;
    expect(fired).toBe(true);
  });
});

describe('BlockFunnel 同格合并', () => {
  it('同一格改三次只发最后一稿', () => {
    const funnel = new BlockFunnel();
    funnel.push(edit(2, 64, 2, 1));
    funnel.push(edit(2, 64, 2, 2));
    funnel.push(edit(2, 64, 2, 3));
    expect(funnel.size).toBe(1);

    funnel.tick(0.2);
    const batch = funnel.drain();
    expect(batch).toHaveLength(1);
    expect(batch[0]!.id).toBe(3);
  });

  it('同坐标但不同维度是两条（不然下界的改动会被主世界的覆盖）', () => {
    const funnel = new BlockFunnel();
    funnel.push(edit(2, 64, 2, 1, 'overworld'));
    funnel.push(edit(2, 64, 2, 2, 'nether'));
    expect(funnel.size).toBe(2);
  });

  it('push 会复制对象（调用方复用同一个对象也不会串）', () => {
    const funnel = new BlockFunnel();
    const reusable = edit(3, 64, 3, 1);
    funnel.push(reusable);
    reusable.id = 99;
    funnel.tick(0.2);
    expect(funnel.drain()[0]!.id).toBe(1);
  });
});

describe('BlockFunnel 上限与清空', () => {
  it(`一批最多 ${MAX_BLOCKS_PER_FLUSH} 条，剩下的留到下一批`, () => {
    const funnel = new BlockFunnel();
    const total = MAX_BLOCKS_PER_FLUSH + 10;
    for (let i = 0; i < total; i++) funnel.push(edit(i, 64, 0, 1));

    const first = funnel.drain();
    expect(first).toHaveLength(MAX_BLOCKS_PER_FLUSH);
    expect(funnel.size).toBe(10);

    // 不用等下一帧：剩下的已经在表里，再来一次 drain 就能取走
    expect(funnel.drain()).toHaveLength(10);
    expect(funnel.size).toBe(0);
  });

  it('clear 之后什么都不发（断线时用）', () => {
    const funnel = new BlockFunnel();
    funnel.push(edit(1, 70, 1, 1));
    funnel.clear();
    expect(funnel.size).toBe(0);
    expect(funnel.tick(1)).toBe(false);
  });
});
