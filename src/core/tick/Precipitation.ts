/**
 * 区块级降水刻（K11 收尾，批次 47）
 *
 * 原版的雪有两个来源：**已经在地上的雪层越积越高**（雪层的随机刻，批次 43 已做）
 * 与**空气里凭空长出第一层雪**（区块级降水刻 `ChunkMap#tickChunk`：每个 tick，
 * 在一个区块里随机取几个点，取到"露天 + 空气 + 下方有支撑"就放一层雪）。
 *
 * 这一批补的是后面那一条。为什么不把它写成"给空气登记一个随机刻行为"：
 *  1. 随机刻是**按方块 id** 查行为的，空气格上根本没有行为可查；
 *  2. 空气占了世界的绝大多数体积，给空气登记行为会让**每一次随机刻采样都白跑**
 *     （随机刻本身已经只跑玩家周围 7×7 区块，但每一个采样点里九成以上是空气）。
 *
 * 所以这里用一个**独立的、低频率的**降水刻：默认每 0.5 秒在玩家周围取 6 个点。
 * 6 × 2 = 每秒 12 个点，落雪只在"正在下雪 + 露天"时才会发生，
 * 观感上就是"雪地里慢慢白起来"，而开销是常数。
 *
 * 判定与雪层的随机刻**共用同一条链**：`snowingAt`（降水 + 寒冷群系）+
 * `skyLightAt >= 15`（露天）——所以"屋檐下不会积雪"这条与批次 43 完全一致。
 */

import { Block } from '../registry/blocks.ts';
import { withSnowLayers } from '../registry/blockState.ts';

/** 降水刻的间隔（秒） */
export const PRECIPITATION_INTERVAL = 0.5;
/** 每批取几个点 */
export const PRECIPITATION_ATTEMPTS = 6;
/** 取样半径（格）：横向 ±8、纵向 ±6（玩家上下各一层视野） */
export const PRECIPITATION_RADIUS = 8;
export const PRECIPITATION_HEIGHT = 6;

/** 降水刻看到的世界（与 `TickWorld` 是同一套形状，但只要求这几个方法） */
export interface PrecipitationWorld {
  /** 这一列正在下雪吗（降水 + 寒冷群系；原版按列判） */
  snowingAt(x: number, y: number, z: number): boolean;
  getBlock(x: number, y: number, z: number): number;
  /** 天光（15 = 头顶直接见天） */
  skyLightAt?(x: number, y: number, z: number): number;
  setBlockWithState?(x: number, y: number, z: number, id: number, state: number): boolean;
  setBlock?(x: number, y: number, z: number, id: number): boolean;
}

/** 可以积雪的地面（与 `Features.ts` 的"能种东西"同一份口径：实心或沙类的顶面） */
function canSupportSnow(id: number): boolean {
  if (id === Block.AIR || id === Block.WATER) return false;
  return true;
}

/**
 * 降水刻。持有一个"下次该跑的累计时间"，所以它是**有状态**的小对象。
 *
 * @param world 世界访问器
 * @param random 随机源（套件里传定值就能把行为钉死）
 */
export class PrecipitationTicker {
  private accum = 0;
  /** 累计生成过多少层雪（调试面板与断言用） */
  placed = 0;

  constructor(
    private readonly world: PrecipitationWorld,
    private readonly random: () => number = Math.random,
  ) {}

  /**
   * 推进 dt 秒；到点就取一批样点。
   *
   * @param centerX/centerZ 取样中心（一般传玩家坐标）
   * @param centerY 取样中心高度
   * @returns 本次新放了多少层雪
   */
  tick(dt: number, centerX: number, centerY: number, centerZ: number): number {
    this.accum += dt;
    let placed = 0;
    // while 而不是 if：卡顿一下（dt 很大）时补上该跑的那几批，而不是永远落后
    while (this.accum >= PRECIPITATION_INTERVAL) {
      this.accum -= PRECIPITATION_INTERVAL;
      placed += this.sample(centerX, centerY, centerZ);
    }
    this.placed += placed;
    return placed;
  }

  /** 取一批样点，返回成功放下的雪层数 */
  private sample(centerX: number, centerY: number, centerZ: number): number {
    let placed = 0;
    for (let i = 0; i < PRECIPITATION_ATTEMPTS; i++) {
      const x = Math.floor(centerX + (this.random() * 2 - 1) * PRECIPITATION_RADIUS);
      const z = Math.floor(centerZ + (this.random() * 2 - 1) * PRECIPITATION_RADIUS);
      const y = Math.floor(centerY + (this.random() * 2 - 1) * PRECIPITATION_HEIGHT);
      if (this.trySnowAt(x, y, z)) placed++;
    }
    return placed;
  }

  /**
   * 试着在 (x, y, z) 落一层雪。
   *
   * 四个条件缺一不可（与原版 `SnowAndFreezeFeature` 一致）：
   *  1. 这一格是**空气**（有东西的地方不该被雪盖住）；
   *  2. 下方**有支撑**（悬空的雪看起来像 bug）；
   *  3. **露天**（天光 15）——屋檐与洞里不该积雪；
   *  4. 这一列**正在下雪**（降水 + 寒冷群系）。
   */
  trySnowAt(x: number, y: number, z: number): boolean {
    if (this.world.getBlock(x, y, z) !== Block.AIR) return false;
    if (!canSupportSnow(this.world.getBlock(x, y - 1, z))) return false;
    if ((this.world.skyLightAt?.(x, y, z) ?? 0) < 15) return false;
    if (!this.world.snowingAt(x, y, z)) return false;

    if (this.world.setBlockWithState) return this.world.setBlockWithState(x, y, z, Block.SNOW, withSnowLayers(0, 1));
    return this.world.setBlock?.(x, y, z, Block.SNOW) ?? false;
  }
}
