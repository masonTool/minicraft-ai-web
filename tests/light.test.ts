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

  it('新区块加载只播种"真能流过去"的边界格（批次 217）', () => {
    // 两块**一模一样**的地形并排：边界两侧的天光处处相同，光根本无处可流。
    // 旧实现会把邻区整列（高地形下 300+ 行 × 16 列）无条件塞进队列，
    // 一个区块加载就灌进四五千条无用任务；手机每帧预算只有 4000 步，
    // 于是队列只涨不消（真机日志里涨到 820 万格、12fps）。
    const groundY = 200;
    const { chunk: a, world } = makeChunk(0, 0, groundY);
    const b = new Chunk(1, 0);
    for (let y = WORLD_MIN_Y; y <= groundY; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) b.set(x, y, z, Block.STONE, 0);
      }
    }
    world.addChunk(b);

    const engine = new LightEngine(world);
    engine.initChunk(a);
    settle(engine);
    expect(engine.pendingCells).toBe(0);

    engine.initChunk(b);
    // 只剩 b 自己的"地表那一层"（16×16 = 256 格）；旧实现会多出约 5000 格边界任务
    expect(engine.pendingCells).toBeLessThan(1000);
    settle(engine);
    expect(engine.pendingCells).toBe(0);
    // 光照结果仍然是对的：两块都在露天
    expect(world.getSkyLight(16, groundY + 1, 8)).toBe(15);
  });

  it('邻区的光仍然能横向流进新加载的区块（批次 217 的边界过滤不能过头）', () => {
    // A：露天；B：头顶盖了一层石头板 —— B 板下的格子只能靠 A 那一侧的横向渗光。
    // 边界过滤的判据是"邻格 - 1 是否比对面亮"，这条用例保证它不会把**真需要流过去**的格子也滤掉。
    const groundY = 64;
    const { chunk: a, world } = makeChunk(0, 0, groundY);
    const b = new Chunk(1, 0);
    for (let y = WORLD_MIN_Y; y <= groundY; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) b.set(x, y, z, Block.STONE, 0);
      }
    }
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) b.set(x, 80, z, Block.STONE, 0);
    }
    world.addChunk(b);

    const engine = new LightEngine(world);
    engine.initChunk(a);
    settle(engine);
    engine.initChunk(b);
    settle(engine);

    // B 板下的第一列（世界坐标 x=16）应当是 14：从 A 的 15 横向渗进来
    expect(world.getSkyLight(16, 70, 8)).toBe(14);
    // 往里一格是 13（逐格衰减）
    expect(world.getSkyLight(17, 70, 8)).toBe(13);
    // 板子上方仍然露天
    expect(world.getSkyLight(16, 81, 8)).toBe(15);
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

  it('增量任务超过队列上限时丢弃并计数，区块播种不受限（批次 238）', () => {
    // 由来：真机日志里队列涨到 308 万格，`LightEngine.spread()` 的 `Array.push`
    // 抛 `RangeError: Invalid array length`，把渲染主循环一起打死（画面定格）。
    // 上限的意义是"宁可光照暂时不准，也不能拖死主循环"，所以这里把上限调到 8 格来验证。
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world, { maxPendingCells: 8 });
    engine.initChunk(chunk);

    // 播种是"加载一个新区块"的确定性工作量：超过上限也照常入队
    // （否则启动期一旦积压，后面的区块就永远点不亮）
    expect(engine.pendingCells).toBeGreaterThan(8);
    expect(engine.pushStats.dropped).toBe(0);

    // 增量任务（改方块）超限：一格都不进去，但计数要能看出来
    const before = engine.pendingCells;
    chunk.set(4, 70, 4, Block.STONE, 0);
    engine.onBlockChanged(4, 70, 4);
    expect(engine.pendingCells).toBe(before);
    expect(engine.pushStats.dropped).toBeGreaterThan(0);
  });

  it('队列排空后增量任务恢复正常（上限是刹车，不是永久关闭）', () => {
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world, { maxPendingCells: 8 });
    engine.initChunk(chunk);
    settle(engine);
    expect(engine.pendingCells).toBe(0);

    chunk.set(4, 70, 4, Block.STONE, 0);
    engine.onBlockChanged(4, 70, 4);
    expect(engine.pendingCells).toBeGreaterThan(0);
    settle(engine);
    expect(engine.pendingCells).toBe(0);
  });

  it('移除 BFS 超过步数上限时放弃精确移除并计数，队列仍能排空（批次 238）', () => {
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world, { maxUnlightSteps: 2 });
    engine.initChunk(chunk);
    settle(engine);

    chunk.set(4, 70, 4, Block.STONE, 0);
    engine.onBlockChanged(4, 70, 4);
    expect(engine.pushStats.overflow).toBeGreaterThan(0);

    // 超限只影响"这一刻的精度"，不能让队列卡住
    settle(engine);
    expect(engine.pendingCells).toBe(0);
    // 新方块**上方**的露天格子不受影响
    expect(world.getSkyLight(4, 71, 4)).toBe(15);
  });

  it('`spread()` 自己再扩散的入队量单独计数（批次 238）', () => {
    // 批次 238 之前这一路完全没统计：日志里只看得到"种子"（readded），
    // 而真正让队列只涨不消的是种子扩散出去又压进来的那一层。
    const { chunk, world } = makeChunk();
    const engine = new LightEngine(world);
    engine.initChunk(chunk);
    settle(engine);
    expect(engine.pushStats.spread).toBe(0);

    // 埋一个方块 → 下方那一列被挖空 → 边界格重新扩散 → 产生 spread 入队
    chunk.set(4, 70, 4, Block.STONE, 0);
    engine.onBlockChanged(4, 70, 4);
    settle(engine);
    expect(engine.pushStats.spread).toBeGreaterThan(0);
  });
});
