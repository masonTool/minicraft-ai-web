/**
 * 房间名（L9）
 *
 * 房间名是服务端数据表的 key 前缀，还会拼进地址 path，所以只能是
 * `[A-Za-z0-9_-]{1,24}`。但玩家手里的是世界名（很可能是「草原小屋」），
 * 所以这一层做的事是：**给出一个一定能用的默认值**，并且把用户手打的字收口干净。
 */

import { describe, expect, it } from 'vitest';
import {
  ROOM_NAME_MAX,
  isValidRoomName,
  roomFromWorldName,
  sanitizeRoomName,
} from '../src/core/net/RoomName.ts';

describe('roomFromWorldName', () => {
  it('ASCII 世界名：空格折成一个 -，其余原样保留', () => {
    expect(roomFromWorldName('My World 2', 1)).toBe('My-World-2');
  });

  it('纯中文世界名：退回 w<种子>（同世界重开还是同一个房间）', () => {
    expect(roomFromWorldName('草原小屋', 424242)).toBe('w424242');
  });

  it('负种子用绝对值，房名里不出现减号（引号/地址里更好念）', () => {
    expect(roomFromWorldName('世界', -7)).toBe('w7');
  });

  it('中英混排：中文当分隔符，英文保留', () => {
    expect(roomFromWorldName('我的 world #1', 9)).toBe('world-1');
  });

  it(`超长名字截到 ${ROOM_NAME_MAX} 字`, () => {
    const long = 'a'.repeat(40);
    expect(roomFromWorldName(long, 1)).toHaveLength(ROOM_NAME_MAX);
  });

  it('派生出来的名字一定是服务端认的', () => {
    for (const name of ['草原小屋', 'My World', '***', 'a'.repeat(40), '混排 mixed 2']) {
      expect(isValidRoomName(roomFromWorldName(name, 123))).toBe(true);
    }
  });
});

describe('sanitizeRoomName', () => {
  it('非法字符直接删掉（不是折成 -）', () => {
    expect(sanitizeRoomName('red room')).toBe('redroom');
  });

  it('删空了就用 fallback', () => {
    expect(sanitizeRoomName('草原', 'w42')).toBe('w42');
  });

  it('fallback 自己也不合法时退到 default', () => {
    expect(sanitizeRoomName('', '草原')).toBe('default');
  });

  it('超长截断', () => {
    expect(sanitizeRoomName('b'.repeat(40))).toHaveLength(ROOM_NAME_MAX);
  });
});

describe('isValidRoomName', () => {
  it('合法：字母 / 数字 / - / _', () => {
    expect(isValidRoomName('room-a_1')).toBe(true);
    expect(isValidRoomName('a')).toBe(true);
  });

  it('非法：空、带 `|`、带空格、超长', () => {
    expect(isValidRoomName('')).toBe(false);
    expect(isValidRoomName('a|b')).toBe(false);
    expect(isValidRoomName('a b')).toBe(false);
    expect(isValidRoomName('a'.repeat(ROOM_NAME_MAX + 1))).toBe(false);
  });
});
