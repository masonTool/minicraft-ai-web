/**
 * 洞穴雕刻器（对齐 1.18 的三类洞穴）
 *
 *  1. 奶酪洞穴（cheese caves）：三维噪声超过阈值形成的大型空腔。阈值随高度升高而增大，
 *     因此洞穴集中在地表以下，越往上越难生成（对应原版的"挤压"处理）。
 *  2. 意大利面洞穴（spaghetti caves）：两组三维噪声同时接近 0 的位置形成细长隧道，
 *     等价于两张等值面的交线，天然连成蜿蜒的通道网络。
 *  3. 峡谷（canyon）：二维噪声接近 0 形成狭长深沟，从上往下收窄。
 *
 * 雕刻顺序：地形 → 地表规则 → 灌水 → 雕刻 → 矿石。
 * 这样洞穴可以真正破开地表形成入口；被破开的列会在雕刻后重新铺一次地表方块，
 * 避免出现悬空的草皮。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk, WORLD_HEIGHT, WORLD_MIN_Y } from '../world/Chunk.ts';
import { NormalNoise } from './noise/PerlinNoise.ts';
import type { Random } from './noise/Random.ts';

/** 熔岩湖高度（原版 y=-54 以下洞穴会被岩浆填充） */
export const LAVA_LEVEL = -54;

/** 可被雕刻的方块（排除空气/水/岩浆/基岩） */
function isCarvable(id: number): boolean {
  return id !== Block.AIR && id !== Block.WATER && id !== Block.LAVA && id !== Block.BEDROCK;
}

export class CaveCarver {
  /** 奶酪洞穴：两组八度形成大空腔 */
  private readonly cheese: NormalNoise;
  /** 意大利面洞穴的两张等值面 */
  private readonly tunnelA: NormalNoise;
  private readonly tunnelB: NormalNoise;
  /** 细管洞穴：更小的阈值，形成 1 格宽的窄道 */
  private readonly noodleA: NormalNoise;
  private readonly noodleB: NormalNoise;
  /** 峡谷 */
  private readonly canyon: NormalNoise;

  private readonly heights = new Int16Array(CHUNK_SIZE_X * CHUNK_SIZE_Z);
  private readonly broken = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Z);

  constructor(random: Random) {
    this.cheese = new NormalNoise(random, -5, [1, 1]);
    this.tunnelA = new NormalNoise(random, -5, [1]);
    this.tunnelB = new NormalNoise(random, -5, [1]);
    this.noodleA = new NormalNoise(random, -3, [1]);
    this.noodleB = new NormalNoise(random, -3, [1]);
    this.canyon = new NormalNoise(random, -7, [1]);
  }

  /** 就地雕刻一个区块的方块数组 */
  carve(blocks: Uint8Array, originX: number, originZ: number): void {
    this.buildHeightMap(blocks);
    this.broken.fill(0);

    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const columnIndex = z * CHUNK_SIZE_X + x;
        const top = this.heights[columnIndex]!;
        if (top <= WORLD_MIN_Y) continue;

        const worldX = originX + x;
        const worldZ = originZ + z;

        // 峡谷只跟水平坐标有关，按列算一次即可
        const canyonValue = Math.abs(this.canyon.getValue(worldX, 0, worldZ));
        const isCanyonColumn = canyonValue < 0.06;

        const yMax = Math.min(top, WORLD_HEIGHT + WORLD_MIN_Y - 1);
        // 从基岩层之上开始：熔岩湖高度以下的洞穴会被岩浆填满（对齐原版 y<=-54 为岩浆层）
        const yMin = WORLD_MIN_Y + 5;
        for (let y = yMin; y <= yMax; y++) {
          const id = blocks[Chunk.index(x, y, z)]!;
          if (!isCarvable(id)) continue;

          if (this.shouldCarve(worldX, y, worldZ, isCanyonColumn, top)) {
            blocks[Chunk.index(x, y, z)] = y <= LAVA_LEVEL ? Block.LAVA : Block.AIR;
            if (y >= top - 1) this.broken[columnIndex] = 1;
          }
        }
      }
    }

    this.repairSurface(blocks);
  }

  private shouldCarve(worldX: number, y: number, worldZ: number, isCanyonColumn: boolean, top: number): boolean {
    // ---- 峡谷：从地表往下延伸，越深越窄
    if (isCanyonColumn && y < top - 6) {
      const canyonTop = Math.min(top - 6, 60);
      if (y <= canyonTop) {
        const depth = canyonTop - Math.max(y, LAVA_LEVEL);
        // 顶部最宽，向下收缩
        const width = 1 - depth / 90;
        if (width > 0.15) return true;
      }
    }

    // ---- 奶酪洞穴：阈值随高度升高，洞穴集中在地表以下
    // 阈值是按「噪声标准差 ≈ 1」标定的（见 PerlinNoise.PERLIN_VARIANCE）。
    // 早先噪声幅度被压小 10 倍时这里写的是 0.58，归一化修正后必须同步放大，
    // 否则 P(噪声 > 阈值) 会从"几乎为零"跳到 28%，洞穴直接淹没整个地下。
    const cheeseThreshold = 2.4 + Math.max(0, (y - 16) / 96) * 1.6;
    if (this.cheese.getValue(worldX, y, worldZ) > cheeseThreshold) return true;

    // ---- 意大利面隧道：两张等值面的交线附近才是隧道，阈值决定隧道宽度
    // 隧道宽度 ≈ 阈值 / |∇噪声|，噪声幅度放大 10 倍后阈值也要放大 10 倍才能保持同样的洞宽
    const a = this.tunnelA.getValue(worldX, y, worldZ);
    if (Math.abs(a) < 0.28) {
      const b = this.tunnelB.getValue(worldX, y, worldZ);
      if (Math.abs(b) < 0.28) return true;
    }

    // ---- 细管洞穴（1 格宽的窄道）
    const na = this.noodleA.getValue(worldX, y, worldZ);
    if (Math.abs(na) < 0.09) {
      const nb = this.noodleB.getValue(worldX, y, worldZ);
      if (Math.abs(nb) < 0.09) return true;
    }

    return false;
  }

  private buildHeightMap(blocks: Uint8Array): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        let top = WORLD_MIN_Y;
        for (let y = WORLD_MIN_Y + WORLD_HEIGHT - 1; y >= WORLD_MIN_Y; y--) {
          if (blocks[Chunk.index(x, y, z)] !== Block.AIR) {
            top = y;
            break;
          }
        }
        this.heights[z * CHUNK_SIZE_X + x] = top;
      }
    }
  }

  /**
   * 被洞穴破开地表的列，需要重新铺地表方块。
   * 否则草皮会悬在洞口上方，看起来像是地形生成出错。
   */
  private repairSurface(blocks: Uint8Array): void {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        const columnIndex = z * CHUNK_SIZE_X + x;
        if (this.broken[columnIndex] === 0) continue;

        // 重新找最高非空气方块
        let top = WORLD_MIN_Y - 1;
        for (let y = WORLD_HEIGHT + WORLD_MIN_Y - 1; y >= WORLD_MIN_Y; y--) {
          const id = blocks[Chunk.index(x, y, z)]!;
          if (id !== Block.AIR) {
            top = y;
            break;
          }
        }
        if (top < WORLD_MIN_Y) continue;
        if (blocks[Chunk.index(x, top, z)] === Block.WATER) continue;

        // 洞口敞开处铺石头，保持"洞口是岩壁"的观感
        blocks[Chunk.index(x, top, z)] = top <= -8 ? Block.DEEPSLATE : Block.STONE;
      }
    }
  }
}
