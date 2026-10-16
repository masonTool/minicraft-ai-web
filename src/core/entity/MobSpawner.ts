/**
 * 生物生成规则
 *
 * 按原版的两套规则分开处理：
 *
 *  **敌对生物**（僵尸 / 骷髅 / 苦力怕）
 *   - 位置：玩家周围 16~48 格（太近会"眼前刷怪"）
 *   - 光照：方块光 = 0 且天光 ≤ 7 —— 也就是"夜里或洞里"才会刷
 *   - 支撑：脚下是实心方块，身体占的两格是空的
 *   - 上限：每个玩家 24 只
 *
 *  **被动生物**（牛 / 猪 / 羊 / 鸡）
 *   - 位置：玩家周围 8~32 格
 *   - 地面：草方块，天光 ≥ 9（白天、户外）
 *   - 上限：16 只
 *
 * 另外负责**自然消失**：敌对生物离玩家超过 96 格就移除，避免远处无限堆积
 * （被动生物不移除，符合原版"动物不会自然消失"的行为）。
 *
 * 该模块不依赖 DOM，可以离线测试。
 */

import { Block } from '../registry/blocks.ts';
import { HOSTILE_MOBS, PASSIVE_MOBS, mobSpawnsIn } from './mobs.ts';
import type { MobType } from './Mob.ts';

export interface SpawnContext {
  getBlock: (x: number, y: number, z: number) => number;
  getSkyLight: (x: number, y: number, z: number) => number;
  getBlockLight: (x: number, y: number, z: number) => number;
  /**
   * 这一列**会挡住移动的最高方块**的 y（C6 高度图）；没有或未加载时 null。
   *
   * 被动刷怪拿它代替"从玩家高度往下逐格找草方块"——后者的开销是
   * `16 列 × 最多 330 格 ≈ 5000 次 getBlock`／每 2 秒，是当时最大的一个纯逻辑热点。
   */
  getSurfaceBlockY: (x: number, z: number) => number | null;
  /** 玩家位置；未加载时为 null（此时不生成） */
  player: { x: number; y: number; z: number } | null;
  spawn: (type: MobType, x: number, y: number, z: number) => void;
  /** 当前生物数量（用于上限控制） */
  hostileCount: number;
  passiveCount: number;
  /**
   * 当前维度（批次 94）。不填按主世界算。
   *
   * 加这一条之前，"自然刷怪"根本没有维度概念——`ctx` 拿的就是当前维度那份世界，
   * 于是**任何**写进 `HOSTILE_MOBS` 的生物都会在主世界的夜里冒出来
   * （恶魂这种"只在下界"的就会跑到草地上）。现在按 `MobType.dimension` 过滤。
   */
  dimension?: 'overworld' | 'nether' | 'end';
  /**
   * 这一列**在不在某个"区域"里**（批次 115：凋灵骷髅只要塞；批次 120：史莱姆只要
   * 史莱姆区块）。
   *
   * 实体层不知道结构在哪、也不知道哪个区块是史莱姆区块（两者都是"算出来的"，
   * 见 `gen/NetherFortress.ts` 与 `world/Slime.ts`），所以由主程序回答。
   * 不传就当"不在任何区域里"——于是带 `spawnZone` 的生物在没接这个钩子的地方
   * （离线测试、未来的别的调用方）一只都不会刷，而不是被撒得到处都是。
   */
  inZone?: (kind: string, x: number, z: number) => boolean;
  /**
   * 这一列的**群系名**（批次 124，尸壳与流浪者用；`gen/Biome.ts` 里的 `desert` 这种）。
   *
   * 与 `inZone` 同一分工：实体层不认识世界，只写"要哪几种群系"。
   * 不接钩子时带 `spawnBiomes` 的生物**一只都不刷**（宁可少刷，也不要撒到全世界）。
   */
  biomeAt?: (x: number, z: number) => string | null;
  /**
   * 这一种生物此刻的**刷怪权重倍率**（批次 120，史莱姆的月亮相位用）。
   *
   * 刷怪是"先按种类均匀抽一次、再验位置"，所以想让某种生物**变稀**，
   * 最省事的做法是抽中之后再丢一次骰子：`random() > scale` 就跳过。
   * 不传按 1 算（不影响任何现有生物）。
   */
  spawnWeightScale?: (type: MobType) => number;
}

/** 生成尝试间隔（秒） */
const SPAWN_INTERVAL = 2;
const HOSTILE_LIMIT = 24;
const PASSIVE_LIMIT = 16;

const HOSTILE_MIN_DISTANCE = 16;
const HOSTILE_MAX_DISTANCE = 48;
/** 敌对生物只在地表以下刷（原版主世界刷怪高度上限约 y=70） */
const HOSTILE_MAX_Y = 70;

const PASSIVE_MIN_DISTANCE = 8;
const PASSIVE_MAX_DISTANCE = 32;
/** 敌对生物离玩家超过这个距离就消失 */
const DESPAWN_DISTANCE = 96;

const WORLD_MIN_Y = -64;
const WORLD_MAX_Y = 320;



export class MobSpawner {
  private timer = SPAWN_INTERVAL;

  /** 随机源可注入，便于离线测试用确定性序列复现 */
  constructor(private readonly random: () => number = Math.random) {}

  /** 累计生成的生物数（调试 / 测试用） */
  spawnedHostile = 0;
  spawnedPassive = 0;

  /**
   * 每帧调用。
   * @returns 本次实际生成的生物数
   */
  update(dt: number, ctx: SpawnContext): number {
    this.timer -= dt;
    if (this.timer > 0) return 0;
    this.timer = SPAWN_INTERVAL;

    if (!ctx.player) return 0;

    let spawned = 0;
    if (ctx.hostileCount < HOSTILE_LIMIT) spawned += this.trySpawnHostile(ctx);
    if (ctx.passiveCount < PASSIVE_LIMIT) spawned += this.trySpawnPassive(ctx);
    return spawned;
  }

  /**
   * 敌对生物：先随机挑一个区块，再**逐列**找可生成的位置。
   *
   * ⚠️ 早期版本是在环形范围里"随机撒点"，在真实地形里命中率低得几乎刷不出怪
   * （实测：地下挖好洞穴后 30 秒 0 只）。原因是一列 128 格高度里往往只有几格
   * 是可站立的空洞，随机撒点的命中率约万分之二。原版也是按区块逐列扫描的，
   * 改成 256 列扫描后每次尝试都能覆盖整个区块，实测 2 秒内就能刷出。
   */
  private trySpawnHostile(ctx: SpawnContext): number {
    const player = ctx.player!;
    // 只挑"这个维度会刷"的（`MobType.dimension`，批次 94）
    const candidates = HOSTILE_MOBS.filter((type) => mobSpawnsIn(type, ctx.dimension));
    if (candidates.length === 0) return 0;
    // 在 16~48 格的环形范围里挑一个区块（太近会"眼前刷怪"，太远玩家看不到）
    const { x: sampleX, z: sampleZ } = this.randomAround(player, HOSTILE_MIN_DISTANCE, HOSTILE_MAX_DISTANCE);
    const chunkX = sampleX >> 4;
    const chunkZ = sampleZ >> 4;

    const startY = WORLD_MIN_Y + 6;
    const span = HOSTILE_MAX_Y - startY;
    let spawned = 0;

    for (let column = 0; column < 256; column++) {
      const x = (chunkX << 4) + (column & 15);
      const z = (chunkZ << 4) + (column >> 4);
      // 逐列扫描会覆盖整个区块，边界列可能落到期望距离之外，这里按实际坐标再筛一次
      const distance = Math.hypot(x + 0.5 - player.x, z + 0.5 - player.z);
      if (distance < HOSTILE_MIN_DISTANCE || distance > HOSTILE_MAX_DISTANCE) continue;
      const y = startY + Math.floor(this.random() * span);

      // 先挑种类，再按**它自己的**规矩验位置（批次 94）：
      // 走地生物要求"脚下实心 + 两格空"，会飞的只要"空腔够大"
      //（恶魂是飘在岩浆上方的，脚下有没有方块与它无关）
      const type = this.pick(candidates);
      if (!type) continue;
      // 区域限定（批次 115 凋灵骷髅只要塞；批次 120 史莱姆只要史莱姆区块）：
      // 不接钩子就一只都不刷，理由见 `SpawnContext.inZone` 的注释
      if (type.spawnZone !== undefined && !(ctx.inZone?.(type.spawnZone, x, z) ?? false)) continue;
      // 群系限定（批次 124 尸壳只要沙漠；批次 125 流浪者要三种雪原）：不接钩子一只都不刷，
      // 理由与 `spawnZone` 那条一样——宁可少刷，也不要撒到全世界
      if (type.spawnBiomes !== undefined) {
        const biome = ctx.biomeAt?.(x, z) ?? null;
        if (biome === null || !type.spawnBiomes.includes(biome)) continue;
      }
      // 高度限定（批次 120，史莱姆 y<40；原版就是这条把它压在地下）
      if (type.spawnMaxY !== undefined && y > type.spawnMaxY) continue;
      // 按种类丢一次骰子（批次 120）：月亮越满，史莱姆越密——不接钩子按 1 算
      const scale = ctx.spawnWeightScale?.(type) ?? 1;
      if (scale <= 0 || (scale < 1 && this.random() > scale)) continue;
      // 水生生物（批次 123，溺尸）：**脚与头都是水**就算合格——
      // `canSpawnAt`（要脚下实心）与 `canFitBox`（要空气）两条对它都不适用，
      // 所以这里是一分为二而不是"再加一条判据"
      if (type.spawnInWater === true) {
        if (!this.canSpawnInWater(ctx, x, y, z)) continue;
      } else {
        if (!type.flying && !this.canSpawnAt(ctx, x, y, z)) continue;
        if (!this.canFitBox(ctx, type, x, y, z)) continue;
      }
      // 光照条件：方块光 0（完全黑暗）且天光 ≤ 7（洞里或夜里）。
      // ⚠️ `ignoreLight` 的生物（史莱姆）不走这一条：原版它在史莱姆区块里白天也刷
      if (type.ignoreLight !== true) {
        if (ctx.getBlockLight(x, y, z) > 0) continue;
        if (ctx.getSkyLight(x, y, z) > 7) continue;
      }

      ctx.spawn(type, x + 0.5, y, z + 0.5);
      this.spawnedHostile++;
      spawned++;
      if (spawned >= 3) break; // 一个周期最多刷 3 只，避免瞬间刷一堆
    }
    return spawned;
  }

  /**
   * 被动生物：随机撒点后先问**高度图**（C6）。
   *
   * ⚠️ 这一处是上一版的性能热点：原来是"从玩家高度往下逐格找草方块"，
   * 一次尝试最多 16 列 × 330 格 ≈ **5000 次 `getBlock`**（每 2 秒跑一次）。
   * 现在地表高度是 O(1) 查表，只对查到的那一格做一次 `getBlock` 复核。
   *
   * 语义**有一处细微变化**（更接近原版）：原来会顺带找到"地表下方"的草地
   * （例如悬崖下的草地只露出一点），现在严格按"最高的会挡住移动的方块"判定，
   * 与原版用 MOTION_BLOCKING 高度图的做法一致。
   */
  private trySpawnPassive(ctx: SpawnContext): number {
    const player = ctx.player!;
    const candidates = PASSIVE_MOBS.filter((type) => mobSpawnsIn(type, ctx.dimension));
    if (candidates.length === 0) return 0;
    const top = Math.min(WORLD_MAX_Y - 2, Math.floor(player.y) + 12);

    for (let attempt = 0; attempt < 16; attempt++) {
      const { x, z } = this.randomAround(player, PASSIVE_MIN_DISTANCE, PASSIVE_MAX_DISTANCE);
      // 地表（= 最高的"会挡住移动"的方块）够不到玩家附近就不试：
      // 原来的逐格扫描也是从玩家高度往下找，所以够不到就等于扫不到
      const surfaceY = ctx.getSurfaceBlockY(x, z);
      if (surfaceY === null || surfaceY > top) continue;
      // 只在地表**草地**上生成（不能只找"第一个落脚点"——那可能是地下岩壁上的平台）
      if (ctx.getBlock(x, surfaceY, z) !== Block.GRASS_BLOCK) continue;
      if (!this.canSpawnAt(ctx, x, surfaceY + 1, z)) continue;
      // 光照条件：白天户外（天光 ≥ 9）
      if (ctx.getSkyLight(x, surfaceY + 1, z) < 9) continue;

      const type = this.pick(candidates);
      if (!type) continue;
      ctx.spawn(type, x + 0.5, surfaceY + 1, z + 0.5);
      this.spawnedPassive++;
      return 1;
    }
    return 0;
  }

  /**
   * 这种生物要的**空腔**够不够（批次 94）。
   *
   * 默认 1×2（就是"两格高的空气"，与 `canSpawnAt` 的老判据一致）；
   * 宽体生物（恶魂 4×4）要查周围那几列——不然它有一半会卡在岩层里。
   * 以"这一格"为中心向四周展开：偶数宽度时中心偏一格，够用即可。
   */
  /**
   * 水生生物的落点（批次 123，溺尸）：**脚与头所在的两格都是水**。
   *
   * 为什么不像 `canSpawnAt` 那样要求"脚下一格实心"：原版的溺尸在水柱中间、
   * 甚至在**水面附近**就会生成（不是贴着海床走），要求脚下实心会把绝大多数水下位置排除掉
   * （深海里"脚下实心"往往是几十格以下）。
   */
  private canSpawnInWater(ctx: SpawnContext, x: number, y: number, z: number): boolean {
    if (y <= WORLD_MIN_Y + 1 || y + 1 >= WORLD_MAX_Y) return false;
    return ctx.getBlock(x, y, z) === Block.WATER && ctx.getBlock(x, y + 1, z) === Block.WATER;
  }

  private canFitBox(ctx: SpawnContext, type: MobType, x: number, y: number, z: number): boolean {
    const space = type.spawnSpace ?? { width: 1, height: 2 };
    const half = Math.floor((space.width - 1) / 2);
    for (let dy = 0; dy < space.height; dy++) {
      for (let dz = -half; dz <= half; dz++) {
        for (let dx = -half; dx <= half; dx++) {
          if (ctx.getBlock(x + dx, y + dy, z + dz) !== Block.AIR) return false;
        }
      }
    }
    return true;
  }

  /**
   * 该列地表（草方块）的高度，找不到返回 null。
   * 与 `trySpawnPassive` 一样走高度图：先查到"会挡住移动的最高方块"，再复核它是不是草方块。
   */
  surfaceHeight(ctx: SpawnContext, x: number, fromY: number, z: number): number | null {
    const top = Math.min(WORLD_MAX_Y - 2, fromY);
    const surfaceY = ctx.getSurfaceBlockY(x, z);
    if (surfaceY === null || surfaceY > top) return null;
    return ctx.getBlock(x, surfaceY, z) === Block.GRASS_BLOCK ? surfaceY : null;
  }

  /** 该位置是否适合生成：脚下实心、身体两格空、且在世界范围内 */
  private canSpawnAt(ctx: SpawnContext, x: number, y: number, z: number): boolean {
    if (y <= WORLD_MIN_Y + 1 || y + 1 >= WORLD_MAX_Y) return false;
    const below = ctx.getBlock(x, y - 1, z);
    if (below === Block.AIR || below === Block.WATER || below === Block.LAVA) return false;
    const feet = ctx.getBlock(x, y, z);
    const head = ctx.getBlock(x, y + 1, z);
    return feet === Block.AIR && head === Block.AIR;
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.random() * list.length)]!;
  }

  private randomAround(
    center: { x: number; z: number },
    minDistance: number,
    maxDistance: number,
  ): { x: number; z: number } {
    const angle = this.random() * Math.PI * 2;
    const distance = minDistance + this.random() * (maxDistance - minDistance);
    return {
      x: Math.floor(center.x + Math.cos(angle) * distance),
      z: Math.floor(center.z + Math.sin(angle) * distance),
    };
  }
}

/** 敌对生物的自然消失距离（供实体层判断） */
export const MOB_DESPAWN_DISTANCE = DESPAWN_DISTANCE;
