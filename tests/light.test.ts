/**
 * 光照传播单元测试（K7，vitest）
 *
 * 这里补的是"现有 esbuild 集成测试没覆盖到"的部分：光照引擎与世界的边界行为——
 * 空区块铺天光、竖直遮挡、火把的方形衰减、下界无天光。
 *
 * 为什么单独用 vitest 而不是继续加 esbuild 脚本：
 * 光照是纯逻辑 + 内存区块，不需要跑生成器，vitest 的 watch 模式改一行就能看到结果；
 * 而耗时的集成测试（生成、结构、联机）继续留在 esbuild 脚本里，两条线各司其职。
 */

import { describe, expect, it } from 'vitest';
import { Block } from '../src/core/registry/blocks.ts';
import { Chunk, WORLD_MAX_Y, WORLD_MIN_Y } from '../src/core/world/Chunk.ts';
import { LightEngine, type LightAccessor } from '../src/core/light/LightEngine.ts';

/** 最小的世界适配器：把区块塞进一张表，光照引擎只需要读写方块与光照等级 */
class WorldStub implements LightAccessor {
  private readonly chunks = new Map<string, Chunk>();

  addChunk(chunk: Chunk): void {
    this.chunks.set(`${chunk.cx},${chunk.cz}`, chunk);
  }

  private chunkAt(x: number, z: number): Chunk | undefined {
    return this.chunks.get(`${x >> 4},${z >> 4}`);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.chunkAt(x, z)?.get(x & 15, y, z & 15) ?? 0;
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunkAt(x, z) !== undefined;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(`${cx},${cz}`);
  }

  getSkyLight(x: number, y: number, z: number): number {
    return this.chunkAt(x, z)?.getSkyLight(x & 15, y, z & 15) ?? 0;
  }

  setSkyLight(x: number, y: number, z: number, value: number): void {
    this.chunkAt(x, z)?.setSkyLight(x & 15, y, z & 15, value);
  }

  getBlockLight(x: number, y: number, z: number): number {
    return this.chunkAt(x, z)?.getBlockLight(x & 15, y, z & 15) ?? 0;
  }

  setBlockLight(x: number, y: number, z: number, value: number): void {
    this.chunkAt(x, z)?.setBlockLight(x & 15, y, z & 15, value);
  }
}

/** 造一个区块：地面以下填石头，地面以上留空气 */
function makeChunk(cx = 0, cz = 0, groundY = 64): { chunk: Chunk; world: WorldStub } {
  const chunk = new Chunk(cx, cz);
  for (let y = WORLD_MIN_Y; y <= groundY; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) chunk.set(x, y, z, Block.STONE, 0);
    }
  }
  const world = new WorldStub();
  world.addChunk(chunk);
  return { chunk, world };
}

/** 把光照队列算干净 */
function settle(engine: LightEngine): void {
  for (let i = 0; i < 200 && engine.hasWork; i++) engine.process(100_000);
}

describe('光照引擎', () => {
  it('地表以上铺满 15 级天光', () => {
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world);
    engine.initChunk(chunk);
    settle(engine);

    expect(world.getSkyLight(8, 70, 8)).toBe(15);
    expect(world.getSkyLight(0, 200, 15)).toBe(15);
  });

  it('盖上一个方块后它下方变暗（走运行时更新路径）', () => {
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world);
    engine.initChunk(chunk);
    settle(engine);

    // 在空气中放一个不透明方块，它下方那一格的天光应当被清掉
    chunk.set(4, 70, 4, Block.STONE, 0);
    engine.onBlockChanged(4, 70, 4);
    settle(engine);

    // ⚠️ 期待的是"变暗"而不是"变 0"：旁边那一列仍在露天，
    // 天光会从侧面渗进来（15 - 1 = 14），这正是原版光照的行为
    expect(world.getSkyLight(4, 69, 4)).toBeLessThan(15);
    expect(world.getSkyLight(4, 69, 4)).toBeGreaterThan(0);
    // 同一高度、旁边那一列不受影响（仍在露天）
    expect(world.getSkyLight(5, 69, 4)).toBe(15);

    // 再把它挖掉，下方应当重新被照亮
    chunk.set(4, 70, 4, Block.AIR, 0);
    engine.onBlockChanged(4, 70, 4);
    settle(engine);
    expect(world.getSkyLight(4, 69, 4)).toBe(15);
  });

  it('露天的格子在天光满级时不会自己变暗', () => {
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world);
    engine.initChunk(chunk);
    settle(engine);

    // 地面正上方与很高处都应该是 15
    expect(world.getSkyLight(8, 65, 8)).toBe(15);
    expect(world.getSkyLight(8, WORLD_MAX_Y - 1, 8)).toBe(15);
  });

  it('发光方块在空气里向四周扩散方块光并逐格衰减', () => {
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world);
    engine.initChunk(chunk);
    settle(engine);

    // 火把要放在**空气**里：光不会进入不透明方块（lightOpacity = 15），
    // 放在石头堆里只能看到竖直方向那一格被照亮
    chunk.set(8, 65, 8, Block.TORCH, 0);
    engine.onBlockChanged(8, 65, 8);
    settle(engine);

    const center = world.getBlockLight(8, 65, 8);
    const near = world.getBlockLight(9, 65, 8);
    const far = world.getBlockLight(11, 65, 8);
    expect(center).toBe(14);
    expect(near).toBe(13);
    // 距离越远越暗，且不该变亮
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);

    // 不透明方块里不该有光（火把埋进石头也照不亮隔壁）
    expect(world.getBlockLight(9, 64, 8)).toBe(0);
  });

  it('挖掉发光方块后光会消失（不会残留）', () => {
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world);
    engine.initChunk(chunk);
    settle(engine);

    chunk.set(8, 65, 8, Block.GLOWSTONE, 0);
    engine.onBlockChanged(8, 65, 8);
    settle(engine);
    expect(world.getBlockLight(9, 65, 8)).toBeGreaterThan(0);

    chunk.set(8, 65, 8, Block.AIR, 0);
    engine.onBlockChanged(8, 65, 8);
    settle(engine);
    expect(world.getBlockLight(8, 65, 8)).toBe(0);
    expect(world.getBlockLight(9, 65, 8)).toBe(0);
  });

  it('关闭天光的维度（下界）里天光恒为 0，但方块光照常工作', () => {
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world);
    engine.setSkyEnabled(false);
    engine.initChunk(chunk);
    settle(engine);

    expect(world.getSkyLight(8, 70, 8)).toBe(0);
    expect(world.getSkyLight(8, 200, 8)).toBe(0);

    chunk.set(8, 65, 8, Block.GLOWSTONE, 0);
    engine.onBlockChanged(8, 65, 8);
    settle(engine);
    expect(world.getBlockLight(8, 65, 8)).toBeGreaterThan(0);
  });
});
