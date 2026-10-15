/**
 * 生成确定性与存档编解码单元测试（K7，vitest）
 *
 * 这两件事是"世界能不能被正确重现"的地基：
 *  - 生成器必须是纯函数（同种子同区块必然一致），否则存档只存增量、联机只发种子都会失效
 *  - 存档的下标/坐标换算是双向的，否则读档会把方块放到别的格子上
 */

import { describe, expect, it } from 'vitest';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import { NetherGenerator } from '../src/core/gen/NetherGenerator.ts';
import { generateChunkBlocks } from '../src/core/gen/TerrainGenerator.ts';
import { Chunk, CHUNK_VOLUME, WORLD_MAX_Y, WORLD_MIN_Y } from '../src/core/world/Chunk.ts';
import { ChunkEdits, packEdit, packEditId, packEditState } from '../src/core/save/ChunkEdits.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { breakSoundFor } from '../src/core/audio/AudioEngine.ts';

const SEED = 20261014;

describe('生成的确定性', () => {
  it('主世界同一区块生成两遍逐方块一致', () => {
    const first = generateChunkBlocks(3, -7, SEED, Dimension.OVERWORLD);
    const second = generateChunkBlocks(3, -7, SEED, Dimension.OVERWORLD);
    expect(first.length).toBe(CHUNK_VOLUME);
    let diff = 0;
    for (let i = 0; i < CHUNK_VOLUME; i++) if (first[i] !== second[i]) diff++;
    expect(diff).toBe(0);
  });

  it('不同种子生成的世界不同', () => {
    const a = generateChunkBlocks(0, 0, SEED, Dimension.OVERWORLD);
    const b = generateChunkBlocks(0, 0, SEED + 1, Dimension.OVERWORLD);
    let same = 0;
    for (let i = 0; i < CHUNK_VOLUME; i++) if (a[i] === b[i]) same++;
    expect(same).toBeLessThan(CHUNK_VOLUME * 0.95);
  });

  it('地表高度是纯函数（同坐标多次调用一致）', () => {
    const generator = new OverworldGenerator(SEED);
    for (const [x, z] of [
      [0, 0],
      [123, -456],
      [-789, 321],
    ] as const) {
      const first = generator.surfaceY(x, z);
      const second = generator.surfaceY(x, z);
      expect(first).toBe(second);
    }
  });

  it('下界地板高度跨过岩浆海面（28~46）', () => {
    const nether = new NetherGenerator(SEED);
    let min = Infinity;
    let max = -Infinity;
    for (let x = -200; x <= 200; x += 17) {
      for (let z = -200; z <= 200; z += 17) {
        const floor = nether.floorAt(x, z);
        min = Math.min(min, floor);
        max = Math.max(max, floor);
      }
    }
    expect(min).toBeGreaterThanOrEqual(24);
    expect(max).toBeLessThanOrEqual(50);
    // 一定要有低于海面的列，否则不会出现岩浆海
    expect(min).toBeLessThan(32);
  });
});

describe('区块下标与坐标换算', () => {
  it('index 是双射：任意下标的坐标再算回下标得到同一个值', () => {
    for (let i = 0; i < 3000; i++) {
      const index = Math.floor(Math.random() * CHUNK_VOLUME);
      const { x, y, z } = Chunk.coordsAt(index);
      expect(Chunk.index(x, y, z)).toBe(index);
    }
  });

  it('坐标边界正确（第一个与最后一个）', () => {
    expect(Chunk.index(0, WORLD_MIN_Y, 0)).toBe(0);
    expect(Chunk.index(15, WORLD_MAX_Y - 1, 15)).toBe(CHUNK_VOLUME - 1);
    expect(Chunk.coordsAt(0)).toEqual({ x: 0, y: WORLD_MIN_Y, z: 0 });
    expect(Chunk.coordsAt(CHUNK_VOLUME - 1)).toEqual({ x: 15, y: WORLD_MAX_Y - 1, z: 15 });
  });
});

describe('存档增量编解码', () => {
  it('id 与状态打包往返一致', () => {
    for (const [id, state] of [
      [Block.STONE, 0],
      [Block.REDSTONE_LAMP, 8],
      [Block.REPEATER, 0b00110001],
      [270, 255],
    ] as const) {
      const packed = packEdit(id, state);
      expect(packEditId(packed)).toBe(id);
      expect(packEditState(packed)).toBe(state);
    }
  });

  it('序列化 → 反序列化 → 叠加回区块，结果与玩家操作一致', () => {
    const edits = new ChunkEdits();
    edits.record('overworld', 1, 2, Chunk.index(3, 70, 4), Block.AIR, 0);
    edits.record('overworld', 1, 2, Chunk.index(4, 70, 4), Block.LEVER, 0b000010);

    const serialized = edits.serialize('overworld', 1, 2);
    expect(serialized).not.toBeNull();

    const restored = new ChunkEdits();
    restored.restore('overworld', 1, 2, serialized!);

    const chunk = new Chunk(1, 2);
    for (let y = 60; y <= 80; y++) {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.set(x, y, z, Block.STONE, 0);
    }
    expect(restored.applyTo('overworld', 1, 2, chunk)).toBe(2);
    expect(chunk.get(3, 70, 4)).toBe(Block.AIR);
    expect(chunk.get(4, 70, 4)).toBe(Block.LEVER);
    expect(chunk.getState(4, 70, 4)).toBe(0b000010);
    // 没动过的格子保持原样
    expect(chunk.get(5, 70, 4)).toBe(Block.STONE);
  });

  it('同一格改多次只保留最后一次，且负数区块坐标可用', () => {
    const edits = new ChunkEdits();
    const index = Chunk.index(1, 64, 1);
    edits.record('overworld', -1, -1, index, Block.DIRT, 0);
    edits.record('overworld', -1, -1, index, Block.STONE, 0);
    expect(edits.totalEdits).toBe(1);
    expect(packEditId(edits.serialize('overworld', -1, -1)!.packed[0]!)).toBe(Block.STONE);

    const chunk = new Chunk(-1, -1);
    edits.applyTo('overworld', -1, -1, chunk);
    expect(chunk.get(1, 64, 1)).toBe(Block.STONE);
  });

  it('不同维度的同坐标改动互不干扰', () => {
    const edits = new ChunkEdits();
    edits.record('overworld', 0, 0, Chunk.index(0, 64, 0), Block.STONE, 0);
    edits.record('nether', 0, 0, Chunk.index(0, 64, 0), Block.NETHERRACK, 0);
    expect(edits.count('overworld', 0, 0)).toBe(1);
    expect(edits.count('nether', 0, 0)).toBe(1);

    const overworldChunk = new Chunk(0, 0);
    edits.applyTo('overworld', 0, 0, overworldChunk);
    expect(overworldChunk.get(0, 64, 0)).toBe(Block.STONE);
  });
});

describe('音效材质映射', () => {
  it('石头/木头/草/沙/玻璃/羊毛能被区分开', () => {
    expect(breakSoundFor('minecraft:stone')).toBe('break_stone');
    expect(breakSoundFor('minecraft:oak_planks')).toBe('break_wood');
    expect(breakSoundFor('minecraft:short_grass')).toBe('break_grass');
    expect(breakSoundFor('minecraft:sand')).toBe('break_sand');
    expect(breakSoundFor('minecraft:glass')).toBe('break_glass');
    expect(breakSoundFor('minecraft:white_wool')).toBe('break_wool');
  });

  it('未知方块回落到石头音（不会静默）', () => {
    expect(breakSoundFor('minecraft:whatever_this_is')).toBe('break_stone');
  });
});
