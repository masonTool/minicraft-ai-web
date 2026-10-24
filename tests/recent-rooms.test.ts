/**
 * 最近连接记忆（L9）
 *
 * localStorage 是**外部数据**（可能被手改、被上个版本写过），而这里读出来的东西会直接
 * 填进地址与房间输入框——所以坏条目一律当没有。另外两条硬要求：
 *  · **不存口令**（口令不进这个列表）；
 *  · 同一「地址 + 房间」只留最新一条，重复进同一间只挪到最前。
 */

import { describe, expect, it } from 'vitest';
import {
  RECENT_LIMIT,
  parseRecentRooms,
  pushRecentRoom,
  serializeRecentRooms,
  type RecentRoom,
} from '../src/core/net/RecentRooms.ts';

const entry = (url: string, room: string, at = 1, name = ''): RecentRoom => ({ url, room, name, at });

describe('parseRecentRooms', () => {
  it('正常数组原样读出', () => {
    expect(parseRecentRooms(JSON.stringify([entry('ws://h:8787', 'red')]))).toEqual([
      { url: 'ws://h:8787', room: 'red', name: '', at: 1 },
    ]);
  });

  it('坏数据一律当没有（不是数组 / 不是 JSON / null）', () => {
    expect(parseRecentRooms(null)).toEqual([]);
    expect(parseRecentRooms('{')).toEqual([]);
    expect(parseRecentRooms('"text"')).toEqual([]);
    expect(parseRecentRooms('{"url":"ws://h"}')).toEqual([]);
  });

  it('地址为空的条目丢掉（填不回输入框就是没用的记录）', () => {
    const list = parseRecentRooms(JSON.stringify([{ room: 'red' }, { url: '  ' }, entry('ws://h', 'x')]));
    expect(list.map((item) => item.url)).toEqual(['ws://h']);
  });

  it(`最多保留 ${RECENT_LIMIT} 条`, () => {
    const many = Array.from({ length: 10 }, (_unused, index) => entry(`ws://h${index}`, `r${index}`));
    expect(parseRecentRooms(JSON.stringify(many))).toHaveLength(RECENT_LIMIT);
  });

  it('字段超长与时间戳脏值都被收口', () => {
    const list = parseRecentRooms(
      JSON.stringify([{ url: 'ws://' + 'a'.repeat(300), room: 'r'.repeat(60), name: 'n'.repeat(60), at: 'abc' }]),
    );
    expect(list[0]?.url.length).toBeLessThanOrEqual(128);
    expect(list[0]?.room.length).toBeLessThanOrEqual(24);
    expect(list[0]?.name.length).toBeLessThanOrEqual(16);
    expect(list[0]?.at).toBe(0);
  });
});

describe('pushRecentRoom', () => {
  it('新条目排最前', () => {
    const list = pushRecentRoom([entry('ws://a', 'x', 1)], entry('ws://b', 'y', 2));
    expect(list.map((item) => item.room)).toEqual(['y', 'x']);
  });

  it('同一地址 + 房间去重并挪到最前（不改入参）', () => {
    const before = [entry('ws://a', 'x', 1), entry('ws://b', 'y', 2)];
    const after = pushRecentRoom(before, entry('ws://b', 'y', 3));
    expect(after.map((item) => item.room)).toEqual(['y', 'x']);
    expect(before.map((item) => item.room)).toEqual(['x', 'y']);
  });

  it('同服务器不同房间是两条记录', () => {
    const after = pushRecentRoom([entry('ws://a', 'x')], entry('ws://a', 'y'));
    expect(after.map((item) => item.room)).toEqual(['y', 'x']);
  });

  it(`超出 ${RECENT_LIMIT} 条时丢最旧的`, () => {
    let list: RecentRoom[] = [];
    for (let index = 0; index < RECENT_LIMIT + 3; index += 1) {
      list = pushRecentRoom(list, entry('ws://h', `r${index}`, index));
    }
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]?.room).toBe(`r${RECENT_LIMIT + 2}`);
  });

  it('空地址不记（写坏了不如不写）', () => {
    expect(pushRecentRoom([], entry('   ', 'x'))).toEqual([]);
  });
});

describe('serializeRecentRooms', () => {
  it('能原样读回来', () => {
    const list = [entry('ws://h', 'red'), entry('ws://h2', 'blue')];
    expect(parseRecentRooms(serializeRecentRooms(list))).toEqual(list);
  });

  it('序列化时不带口令字段（列表里根本没有这个字段）', () => {
    const raw = serializeRecentRooms([entry('ws://h', 'red')]);
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('pw');
  });
});
