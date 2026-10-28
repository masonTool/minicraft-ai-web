/**
 * 房间列表清洗（L9）
 *
 * `GET /rooms` 的响应是**外部数据**：同网段里可能是别的版本、甚至不是本项目的服务端。
 * 而这里出来的每一项都会直接进 DOM（房名还会拼进地址），所以坏数据必须当不存在。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CAPACITY, parseRoomsResponse } from '../web/src/core/net/RoomList.ts';

describe('parseRoomsResponse', () => {
  it('正常响应：房间名 / 人数 / 房主标记 / 世界名与种子', () => {
    const result = parseRoomsResponse({
      passwordRequired: false,
      maxPlayers: 12,
      rooms: [
        { room: 'hostroom', players: 2, hasHost: true, world: { name: '草原小屋', seed: 424242 } },
      ],
    });
    expect(result).toEqual({
      passwordRequired: false,
      maxPlayers: 12,
      rooms: [{ room: 'hostroom', players: 2, hasHost: true, worldName: '草原小屋', worldSeed: 424242 }],
    });
  });

  it('老服务端不带 maxPlayers → 退回默认容量（界面不会显示 4/undefined）', () => {
    expect(parseRoomsResponse({ rooms: [] })?.maxPlayers).toBe(DEFAULT_ROOM_CAPACITY);
  });

  it('maxPlayers 脏数据（0 / 负数 / 非数字）一律退回默认容量', () => {
    for (const bad of [0, -3, 'many', null, undefined]) {
      expect(parseRoomsResponse({ rooms: [], maxPlayers: bad })?.maxPlayers).toBe(DEFAULT_ROOM_CAPACITY);
    }
  });

  it('人多的排前面（局域网里"去热闹那间"是唯一依据）', () => {
    const result = parseRoomsResponse({
      rooms: [
        { room: 'a', players: 1 },
        { room: 'b', players: 3 },
      ],
    });
    expect(result?.rooms.map((entry) => entry.room)).toEqual(['b', 'a']);
  });

  it('根本不像我们的服务端（不是对象 / 没有 rooms 数组）→ null', () => {
    expect(parseRoomsResponse(null)).toBeNull();
    expect(parseRoomsResponse('oops')).toBeNull();
    expect(parseRoomsResponse({ rooms: 'no' })).toBeNull();
    expect(parseRoomsResponse({})).toBeNull();
  });

  it('房名不合规的行直接丢掉（它会拼进地址）', () => {
    const result = parseRoomsResponse({
      rooms: [
        { room: 'a|b', players: 2 },
        { room: '', players: 2 },
        { room: 'x'.repeat(40), players: 2 },
        { room: 'ok-1', players: 2 },
      ],
    });
    expect(result?.rooms.map((entry) => entry.room)).toEqual(['ok-1']);
  });

  it('人数脏数据当 1（列表里不会出现 0 人 / NaN 人）', () => {
    const result = parseRoomsResponse({
      rooms: [
        { room: 'a', players: '三人' },
        { room: 'b', players: -5 },
        { room: 'c' },
      ],
    });
    expect(result?.rooms.map((entry) => entry.players)).toEqual([1, 1, 1]);
  });

  it('世界缺失时给空名与 0 种子，不抛异常', () => {
    const result = parseRoomsResponse({ rooms: [{ room: 'a', players: 1 }] });
    expect(result?.rooms[0]).toMatchObject({ worldName: '', worldSeed: 0 });
  });

  it('世界名超长截到 32（不撑破那一行）', () => {
    const result = parseRoomsResponse({
      rooms: [{ room: 'a', players: 1, world: { name: '长'.repeat(80), seed: 1 } }],
    });
    expect(result?.rooms[0]?.worldName).toHaveLength(32);
  });

  it('passwordRequired 只认严格的 true', () => {
    expect(parseRoomsResponse({ rooms: [], passwordRequired: 'true' })?.passwordRequired).toBe(false);
    expect(parseRoomsResponse({ rooms: [], passwordRequired: true })?.passwordRequired).toBe(true);
  });
});
