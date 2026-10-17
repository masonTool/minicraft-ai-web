/**
 * 新世界安全出生点选择。
 *
 * 只在已经加载的区域里找：脚下是自然地面、头顶两格可站、周围 5×5 起伏不超过 2 格。
 * 候选同时偏向平原 / 草甸 / 森林 / 丛林，让玩家第一次进入看到的是草、花与树林，
 * 而不是海面、树冠或裸露山尖。
 */

import { Block } from '../registry/blocks.ts';
import { WORLD_MAX_Y, WORLD_MIN_Y } from './Chunk.ts';

export interface SpawnSearchWorld {
  getBlock(x: number, y: number, z: number): number;
  isSolid(x: number, y: number, z: number): boolean;
  isLoaded(x: number, z: number): boolean;
}

export interface SafeSpawnPoint {
  x: number;
  y: number;
  z: number;
  groundY: number;
  roughness: number;
  biome: string | null;
}

const LUSH_BIOME_RANK: Readonly<Record<string, number>> = {
  plains: 0,
  sunflower_plains: 0,
  meadow: 0,
  forest: 1,
  birch_forest: 1,
  jungle: 1,
  savanna: 2,
  taiga: 2,
  grove: 3,
};

function biomeRank(name: string | null): number {
  return name ? (LUSH_BIOME_RANK[name] ?? 6) : 6;
}

const NATURAL_FLOORS = new Set<number>([
  Block.GRASS_BLOCK,
  Block.DIRT,
  Block.STONE,
  Block.SAND,
  Block.GRAVEL,
  Block.SNOW_BLOCK,
  Block.TERRACOTTA,
]);

function openForPlayer(world: SpawnSearchWorld, x: number, y: number, z: number): boolean {
  const feet = world.getBlock(x, y, z);
  const head = world.getBlock(x, y + 1, z);
  if (feet === Block.WATER || feet === Block.LAVA || head === Block.WATER || head === Block.LAVA) return false;
  return !world.isSolid(x, y, z) && !world.isSolid(x, y + 1, z);
}

/** 该列最高的自然、可站立地面；树冠与植物不会被误当成地面。 */
export function naturalGroundY(world: SpawnSearchWorld, x: number, z: number): number | null {
  if (!world.isLoaded(x, z)) return null;
  for (let y = WORLD_MAX_Y - 2; y >= WORLD_MIN_Y; y--) {
    const id = world.getBlock(x, y, z);
    if (!NATURAL_FLOORS.has(id) || !world.isSolid(x, y, z)) continue;
    if (!openForPlayer(world, x, y + 1, z)) continue;
    return y;
  }
  return null;
}

/**
 * 从已加载区域挑一个安全出生点。候选按 2 格采样；平整度的权重高于距离与群系，
 * 所以不会为了“出生在森林”把玩家放到陡坡上。
 */
export function findSafeSpawn(
  world: SpawnSearchWorld,
  biomeAt: (x: number, z: number) => string | null,
  centerX = 0,
  centerZ = 0,
  radius = 48,
): SafeSpawnPoint | null {
  const heightCache = new Map<string, number | null>();
  const groundAt = (x: number, z: number): number | null => {
    const key = `${x},${z}`;
    if (heightCache.has(key)) return heightCache.get(key)!;
    const value = naturalGroundY(world, x, z);
    heightCache.set(key, value);
    return value;
  };

  let best: SafeSpawnPoint | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let z = centerZ - radius; z <= centerZ + radius; z += 2) {
    for (let x = centerX - radius; x <= centerX + radius; x += 2) {
      const groundY = groundAt(x, z);
      if (groundY === null || groundY < 64) continue;

      let low = groundY;
      let high = groundY;
      let complete = true;
      // 5×5 足印：不仅玩家脚下平，出生后往任意方向走两步也不会直接跌下悬崖。
      for (const dz of [-2, 0, 2]) {
        for (const dx of [-2, 0, 2]) {
          const nearby = groundAt(x + dx, z + dz);
          if (nearby === null) {
            complete = false;
            break;
          }
          low = Math.min(low, nearby);
          high = Math.max(high, nearby);
        }
        if (!complete) break;
      }
      if (!complete) continue;
      const roughness = high - low;
      if (roughness > 2) continue;

      const biome = biomeAt(x, z);
      const rank = biomeRank(biome);
      const distance = Math.hypot(x - centerX, z - centerZ);
      const score = roughness * 1000 + rank * 40 + distance;
      if (score >= bestScore) continue;
      bestScore = score;
      best = { x: x + 0.5, y: groundY + 1.01, z: z + 0.5, groundY, roughness, biome };
    }
  }
  return best;
}

/**
 * 区块尚未生成时，先用生成器的地表函数挑一片值得加载的陆地。
 * 这是“出生在大海且视距内没有陆地”的兜底；真正落脚仍由 `findSafeSpawn` 对实体方块复核。
 */
export function planSpawnRegion(
  surfaceAt: (x: number, z: number) => number,
  biomeAt: (x: number, z: number) => string | null,
  radius = 256,
): { x: number; z: number } {
  let best = { x: 0, z: 0 };
  let bestScore = Number.POSITIVE_INFINITY;
  const step = 8;
  for (let z = -radius; z <= radius; z += step) {
    for (let x = -radius; x <= radius; x += step) {
      const center = surfaceAt(x, z);
      if (center < 64 || center >= WORLD_MAX_Y - 4) continue;
      let low = center;
      let high = center;
      for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4]] as const) {
        const y = surfaceAt(x + dx, z + dz);
        low = Math.min(low, y);
        high = Math.max(high, y);
      }
      const roughness = high - low;
      if (roughness > 4) continue;
      const rank = biomeRank(biomeAt(x, z));
      const score = roughness * 1000 + rank * 80 + Math.hypot(x, z);
      if (score < bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
  }
  return best;
}
