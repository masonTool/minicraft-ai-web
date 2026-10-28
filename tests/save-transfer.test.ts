/**
 * 存档导出/导入的纯逻辑测试（L2，批次 591）
 *
 * 重点不是"JSON 能 parse"，而是**区块增量里的 ArrayBuffer 不能丢**：
 * 直接 JSON.stringify 会把 ArrayBuffer 变成 `{}`，导入后地形改动全没；
 * 所以这里专门断言 base64 往返之后还是原来的 Uint32Array。
 */

import { describe, expect, it } from 'vitest';
import {
  SAVE_TRANSFER_FORMAT,
  SAVE_TRANSFER_VERSION,
  buildSaveTransfer,
  parseSaveTransfer,
  transferFileName,
  type SaveTransferFile,
} from '../src/core/save/SaveTransfer.ts';
import { worldNameFromFile } from '../src/core/save/SaveTransfer.ts';
import type { WorldSummary } from '../src/core/save/WorldRegistry.ts';

const world: WorldSummary = {
  id: 'abc',
  name: '测试世界',
  seed: 20261014,
  worldType: 'default',
  createdAt: 1,
  lastPlayed: 2,
  playTime: 120,
  edits: 3,
  difficulty: 'normal',
  gameMode: 'survival',
};

describe('存档导出文件', () => {
  it('ArrayBuffer 以 base64 带走，导入后还原成 Uint32Array 数据', () => {
    const stores = {
      chunks: [
        {
          key: 'overworld|0,0',
          value: {
            indices: new Uint32Array([1, 2, 3]).buffer,
            packed: new Uint32Array([4, 5]).buffer,
            savedAt: 99,
          },
        },
      ],
      meta: [{ key: 'meta', value: { seed: world.seed, version: 2 } }],
    };
    const file = buildSaveTransfer(world, stores, 123456);
    const text = JSON.stringify(file);
    expect(text).toContain('__buffer');

    const parsed = parseSaveTransfer(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(SAVE_TRANSFER_VERSION);
    expect(parsed!.exportedAt).toBe(123456);
    expect(parsed!.world).toMatchObject({
      name: '测试世界',
      seed: 20261014,
      worldType: 'default',
      gameMode: 'survival',
      difficulty: 'normal',
    });

    const chunk = parsed!.stores.chunks![0]!.value as {
      indices: ArrayBuffer;
      packed: ArrayBuffer;
      savedAt: number;
    };
    expect(chunk.indices).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint32Array(chunk.indices))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint32Array(chunk.packed))).toEqual([4, 5]);
    expect(chunk.savedAt).toBe(99);
  });

  it('普通对象/数组/数字原样往返', () => {
    const file = buildSaveTransfer(
      { ...world, hardcore: true },
      { player: [{ key: 'player', value: { health: 20, inventory: [null, { id: 1, count: 2 }] } }] },
    );
    const parsed = parseSaveTransfer(JSON.stringify(file))!;
    expect(parsed.world.hardcore).toBe(true);
    expect(parsed.stores.player![0]!.value).toEqual({
      health: 20,
      inventory: [null, { id: 1, count: 2 }],
    });
  });
});

describe('导入文件校验', () => {
  const valid: SaveTransferFile = buildSaveTransfer(world, {}, 0);

  it('格式/版本不对直接拒绝', () => {
    expect(parseSaveTransfer('not json')).toBeNull();
    expect(parseSaveTransfer(JSON.stringify({ ...valid, format: 'other' }))).toBeNull();
    expect(parseSaveTransfer(JSON.stringify({ ...valid, version: SAVE_TRANSFER_VERSION + 1 }))).toBeNull();
  });

  it('种子不是有限数、世界类型不认识时拒绝', () => {
    expect(
      parseSaveTransfer(JSON.stringify({ ...valid, world: { ...valid.world, seed: Number.NaN } })),
    ).toBeNull();
    expect(
      parseSaveTransfer(JSON.stringify({ ...valid, world: { ...valid.world, worldType: 'moon' } })),
    ).toBeNull();
  });

  it('坏的单条 store 条目被跳过，不影响整份文件', () => {
    const parsed = parseSaveTransfer(
      JSON.stringify({
        ...valid,
        stores: {
          meta: [{ key: 'meta', value: { ok: true } }, { value: { bad: true } }, null],
          chunks: 'not-an-array',
        },
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.stores.meta).toHaveLength(1);
    expect(parsed!.stores.chunks).toBeUndefined();
  });

  it('文件名剔除非法字符、空格转中划线、后缀是 .world', () => {
    // 2026-10-28 用户口径：导入导出统一 `.world`（内部仍是 zip，旧 `.mc` 仍可导入）
    expect(transferFileName('a/b:c*?"<>|')).toBe('a_b_c______.world');
    expect(transferFileName('我的 世界')).toBe('我的-世界.world');
    expect(transferFileName('   ')).toBe('world.world');
  });

  it('导入时中划线还原成空格（仅在没有包内名字时兜底）', () => {
    expect(worldNameFromFile('我的-世界.world')).toBe('我的 世界');
    // 旧后缀的包照样能导入（格式没变过，只是壳的名字改了）
    expect(worldNameFromFile('我的-世界.mc')).toBe('我的 世界');
    expect(worldNameFromFile('.world')).toBe('导入的世界');
  });

  it('格式常量稳定（导出的文件靠它识别）', () => {
    expect(valid.format).toBe(SAVE_TRANSFER_FORMAT);
  });
});
