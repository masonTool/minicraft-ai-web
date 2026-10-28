/**
 * 联机存档隔离（联机6）
 *
 * 联机时队友的方块改动、容器内容都会落进本地存档。混在单机档里就是永久污染：
 * 退出联机后那个单机世界的地形已经变成队友的世界。做法是给联机档换一个**库名**
 * （`dbNameFor` 由 world id 派生），这里断言"两个 id 派生出两个库"这条前提。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MULTIPLAYER_ROOM,
  isMultiplayerWorldId,
  multiplayerWorldId,
  singlePlayerWorldId,
} from '../web/src/core/net/MultiplayerSave.ts';
import { dbNameFor } from '../web/src/core/save/WorldRegistry.ts';

describe('multiplayerWorldId', () => {
  it('默认房间：world id 加 @mp:default 后缀', () => {
    expect(multiplayerWorldId('w1')).toBe(`w1@mp:${DEFAULT_MULTIPLAYER_ROOM}`);
  });

  it('不同房间派生不同 id（一房一世界）', () => {
    expect(multiplayerWorldId('w1', 'room-a')).not.toBe(multiplayerWorldId('w1', 'room-b'));
  });

  it('联机档与单机档落在两个不同的库', () => {
    const soloDb = dbNameFor('w1');
    const mpDb = dbNameFor(multiplayerWorldId('w1'));

    expect(mpDb).not.toBe(soloDb);
    // 前缀仍指向同一套游戏库，只是世界 id 不同（删库按 id 删，不会误伤）
    expect(mpDb.startsWith('bedrock-118-web')).toBe(true);
    expect(soloDb.startsWith('bedrock-118-web')).toBe(true);
  });

  it('同房间重复算出来的 id 稳定（重进联机还是同一个库）', () => {
    expect(multiplayerWorldId('w1', 'room-a')).toBe(multiplayerWorldId('w1', 'room-a'));
  });

  /*
   * 种子指纹（L9）：地形由房主的那个世界决定，所以"同一个房间名、换了世界"必须
   * 换一个库——否则上一片大陆的方块增量会灌到新地形上（表现为刚进去就有一堆
   * 别人世界的改动）。
   */
  it('带种子时 id 多一段指纹，且同房不同种子落两个库', () => {
    const small = multiplayerWorldId('w1', 'room-a', 123);
    const other = multiplayerWorldId('w1', 'room-a', 456);
    expect(small).toBe('w1@mp:room-a@123');
    expect(small).not.toBe(other);
    expect(dbNameFor(small)).not.toBe(dbNameFor(other));
  });

  it('不传种子时仍是老格式（这一批之前的库名照旧算得出来）', () => {
    expect(multiplayerWorldId('w1', 'room-a')).toBe('w1@mp:room-a');
    expect(multiplayerWorldId('w1', 'room-a', undefined)).toBe('w1@mp:room-a');
  });

  it('负种子原样拼进去（种子允许负数）', () => {
    expect(multiplayerWorldId('w1', 'room-a', -5)).toBe('w1@mp:room-a@-5');
  });

  it('带种子也能反解回单机 world id', () => {
    expect(singlePlayerWorldId(multiplayerWorldId('w1', 'room-a', 123))).toBe('w1');
    expect(isMultiplayerWorldId(multiplayerWorldId('w1', 'room-a', 123))).toBe(true);
  });
});

describe('isMultiplayerWorldId / singlePlayerWorldId', () => {
  it('认得出联机档，认不出单机 id', () => {
    expect(isMultiplayerWorldId(multiplayerWorldId('w1'))).toBe(true);
    expect(isMultiplayerWorldId('w1')).toBe(false);
    expect(isMultiplayerWorldId('main')).toBe(false);
  });

  it('反解回单机 world id', () => {
    expect(singlePlayerWorldId(multiplayerWorldId('w1'))).toBe('w1');
    expect(singlePlayerWorldId(multiplayerWorldId('w1', 'room-a'))).toBe('w1');
  });

  it('单机 id 原样返回（不认识的输入不改写）', () => {
    expect(singlePlayerWorldId('w1')).toBe('w1');
    expect(singlePlayerWorldId('')).toBe('');
  });
});
