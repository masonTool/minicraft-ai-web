/**
 * `move` 报文里的外观（用户 2026-10-26）。
 *
 * 两轮症状，同一处代码：
 *  ① 最初 `tick()` 组包时**漏了** `appearance.look`——远端只能按昵称派生，"形式都不对"；
 *  ② 补上之后改成"变化才发 + 2 秒兜底"，于是 99% 的 `move` 不带皮肤，配合服务端当年的
 *    "整份覆盖"把对端的皮肤清空又纠正——**每隔几秒闪一次**。
 *
 * 现在的口径：**每条 `move` 都带全量外观**（含 0/false），服务端再合并。
 * 这里用假 socket 直接看报文，把"每条都带、且能表达 0"钉死。
 */
import { describe, expect, it } from 'vitest';
import { NetClient } from '../web/src/net/NetClient.ts';

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

  it('没变化也每条都带（闪烁的根因就是"这条不带"）', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 1000);
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 1100);
    expect(moves()).toHaveLength(2);
    expect(moves()[1]!.look).toEqual(LOOK_A);
  });

  it('改了形象立刻再发一次', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_A }, 1000);
    net.tick(0, 64, 0, 0, 0, 'overworld', { look: LOOK_B }, 1200);
    expect(moves()[1]!.look).toEqual(LOOK_B);
  });

  it('手持/盔甲/布尔也每条都带（0 与 false 必须能表达）', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', {}, 1000);
    net.tick(0, 64, 0, 0, 0, 'overworld', { held: 0, armor: [0, 0, 0, 0], sneak: false }, 1100);
    const second = moves()[1]!;
    // 手上没东西 / 没穿甲 / 没潜行 → 也必须显式发 0，否则对端永远停在上一帧的状态
    expect(second.held).toBe(0);
    expect(second.armor).toEqual([0, 0, 0, 0]);
    expect(second.sneak).toBe(0);
    expect(second.dead).toBe(0);
  });

  it('生命/饥饿随每条 move 带上（0~20 点）', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', { hp: 17, food: 13 }, 1000);
    expect(moves()[0]!.hp).toBe(17);
    expect(moves()[0]!.food).toBe(13);
  });

  it('没有外观数据（老调用方）时不带 look，别的东西照发', () => {
    const { net, moves } = newClient();
    net.tick(0, 64, 0, 0, 0, 'overworld', {}, 1000);
    expect(moves()[0]!.look).toBeUndefined();
    expect(moves()[0]!.hp).toBe(20);
  });
});

/*
 * 下线要说一声（用户 2026-10-26："访客下线，房主这边看不到、也没有消息"）。
 *
 * 服务端的 `bye` 分支早就有了，缺的是**客户端主动断开这条链**：`App.dispose()` 以前
 * 根本不碰 `net`，回主菜单时 socket 没人关——服务端既收不到 `bye` 也等不到 `close`，
 * 房里其他人眼里你永远在线。这里钉住 `disconnect()` 的报文顺序。
 */
describe('NetClient.disconnect', () => {
  it('先发 bye 再关 socket', () => {
    const net = new NetClient({ onStatus: () => {} } as never);
    const frames: Array<{ t?: string }> = [];
    let closed = false;
    (net as unknown as { socket: unknown }).socket = {
      readyState: 1,
      send: (payload: string) => frames.push(JSON.parse(payload) as { t?: string }),
      close: () => {
        closed = true;
      },
    };
    (net as unknown as { selfId: number }).selfId = 3;

    net.disconnect();

    expect(frames.map((f) => f.t)).toEqual(['bye']);
    expect(closed).toBe(true);
  });

  it('没连上时什么都不发（也不抛）', () => {
    const net = new NetClient({ onStatus: () => {} } as never);
    expect(() => net.disconnect()).not.toThrow();
  });
});
