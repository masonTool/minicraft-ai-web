/**
 * `move` 报文要不要带皮肤下标（用户 2026-10-26）。
 *
 * 症状两条：进世界后"人物形式都不对"、改形象对方也看不到。根因是 `tick()` 组包时
 * 把 `appearance.look` 漏了——服务端白名单里有、远端渲染也早就支持，唯独没发。
 * 这里用假 socket 直接看报文，把"发没发、什么时候发"钉死。
 */
import { describe, expect, it } from 'vitest';
import { NetClient } from '../src/net/NetClient.ts';

const LOOK_A = [1, 2, 3, 4, 5, 0, 1, 2, 0, 1];
const LOOK_B = [2, 2, 3, 4, 5, 0, 1, 2, 1, 0];

const newClient = () => {
  const net = new NetClient({} as never);
  const sent: Array<Record<string, unknown>> = [];
  // 只替换 socket 与 selfId：`connected` 是 getter，靠这两样成立
  (net as unknown as { socket: unknown }).socket = {
    readyState: 1,
    send: (payload: string) => sent.push(JSON.parse(payload) as Record<string, unknown>),
  };
  (net as unknown as { selfId: number }).selfId = 7;
  /** 只看 `move`（`tick` 每 2 秒还会发一条 ping） */
  const moves = () => sent.filter((payload) => payload.t === 'move');
  return { net, moves };
};

describe('NetClient.tick 的 move 报文', () => {
  it('带上皮肤下标（变化时）', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 1000);
    expect(moves()).toHaveLength(1);
    expect(moves()[0]!.look).toEqual(LOOK_A);
  });

  it('没变化就不重复发（省带宽）', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 1000);
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 1100);
    expect(moves()).toHaveLength(2);
    expect(moves()[1]!.look).toBeUndefined();
  });

  it('改了形象立刻再发一次', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 1000);
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_B }, 1200);
    expect(moves()[1]!.look).toEqual(LOOK_B);
  });

  it('2 秒兜底：先改形象、后进房的人也能拿到', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 1000);
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 2000);
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 3500);
    // 1000 → 2000 之间是"没变化不发"；3500 距上次 2500ms，命中兜底
    expect(moves()[2]!.look).toEqual(LOOK_A);
  });

  it('没有外观数据时不带这个字段（老行为不变）', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', {}, 1000);
    expect(moves()[0]!.look).toBeUndefined();
  });
});
