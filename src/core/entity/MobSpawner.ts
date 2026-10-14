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
import { HOSTILE_MOBS, PASSIVE_MOBS } from './mobs.ts';
import type { MobType } from './Mob.ts';

export interface SpawnContext {
  getBlock: (x: number, y: number, z: number) => number;
  getSkyLight: (x: number, y: number, z: number) => number;
  getBlockLight: (x: number, y: number, z: number) => number;
  /** 玩家位置；未加载时为 null（此时不生成） */
  player: { x: number; y: number; z: number } | null;
  spawn: (type: MobType, x: number, y: number, z: number) => void;
  /** 当前生物数量（用于上限控制） */
  hostileCount: number;
  passiveCount: number;
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

      if (!this.canSpawnAt(ctx, x, y, z)) continue;
      // 光照条件：方块光 0（完全黑暗）且天光 ≤ 7（洞里或夜里）
      if (ctx.getBlockLight(x, y, z) > 0) continue;
      if (ctx.getSkyLight(x, y, z) > 7) continue;

      const type = this.pick(HOSTILE_MOBS);
      ctx.spawn(type, x + 0.5, y, z + 0.5);
      this.spawnedHostile++;
      spawned++;
      if (spawned >= 3) break; // 一个周期最多刷 3 只，避免瞬间刷一堆
    }
    return spawned;
  }

  private trySpawnPassive(ctx: SpawnContext): number {
    const player = ctx.player!;

    for (let attempt = 0; attempt < 16; attempt++) {
      const { x, z } = this.randomAround(player, PASSIVE_MIN_DISTANCE, PASSIVE_MAX_DISTANCE);
      // 从上方往下找**草方块**（不能只找"第一个落脚点"——那可能是地下岩壁上的平台，
      // 原版被动生物只在地表草地上生成）
      const top = Math.min(WORLD_MAX_Y - 2, Math.floor(player.y) + 12);
      for (let y = top; y > WORLD_MIN_Y + 1; y--) {
        if (ctx.getBlock(x, y, z) !== Block.GRASS_BLOCK) continue;
        if (!this.canSpawnAt(ctx, x, y + 1, z)) break;
        // 光照条件：白天户外（天光 ≥ 9）
        if (ctx.getSkyLight(x, y + 1, z) < 9) break;

        const type = this.pick(PASSIVE_MOBS);
        ctx.spawn(type, x + 0.5, y + 1, z + 0.5);
        this.spawnedPassive++;
        return 1;
      }
    }
    return 0;
  }

  /** 该列地表（草方块）的高度，找不到返回 null */
  surfaceHeight(ctx: SpawnContext, x: number, fromY: number, z: number): number | null {
    const top = Math.min(WORLD_MAX_Y - 2, fromY);
    for (let y = top; y > WORLD_MIN_Y + 1; y--) {
      if (ctx.getBlock(x, y, z) === Block.GRASS_BLOCK) return y;
    }
    return null;
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
