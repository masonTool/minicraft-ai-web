/**
 * 服务端地址的拆解（联机26）
 *
 * 房间码与口令都放在地址里（`ws://host:8787/red?pw=1234`），所以"拆得对不对"决定了
 * 玩家进的是不是他想进的那个房间。
 */

import { describe, expect, it } from 'vitest';
import { parseServerUrl } from '../src/core/net/ServerUrl.ts';

describe('parseServerUrl', () => {
  it('裸地址：默认房间、无口令', () => {
    expect(parseServerUrl('ws://192.168.1.5:8787')).toEqual({ url: 'ws://192.168.1.5:8787', room: '', password: '' });
  });

  it('带尾斜杠也只当裸地址', () => {
    expect(parseServerUrl('ws://192.168.1.5:8787/').url).toBe('ws://192.168.1.5:8787');
  });

  it('第一段 path 是房间名', () => {
    const parsed = parseServerUrl('ws://192.168.1.5:8787/red');
    expect(parsed.room).toBe('red');
    expect(parsed.url).toBe('ws://192.168.1.5:8787');
  });

  it('`pw` 查询参数是口令', () => {
    const parsed = parseServerUrl('ws://192.168.1.5:8787/red?pw=1234');
    expect(parsed.room).toBe('red');
    expect(parsed.password).toBe('1234');
    // 口令不出现在真正要连的地址里（避免被日志原样记下来）
    expect(parsed.url).toBe('ws://192.168.1.5:8787');
  });

  it('多余层级的 path 不作数（拼出来的房名服务端也不认）', () => {
    expect(parseServerUrl('ws://host:1/a/b').room).toBe('');
  });

  it('非法地址原样返回（真正的校验在界面那一层）', () => {
    expect(parseServerUrl('这不是地址')).toEqual({ url: '这不是地址', room: '', password: '' });
  });
});
