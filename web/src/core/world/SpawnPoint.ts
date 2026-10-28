/**
 * 新世界安全出生点选择。
 *
 * 只在已经加载的区域里找：脚下是自然地面、头顶两格可站、周围 5×5 起伏不超过 2 格。
 * 有两段：进世界前用生成器的地表函数**随机**预选一片区域（`planSpawnRegion`），
 * 区块流出来之后再在附近挑一块真正站得住的地（`findSafeSpawn`）。
 *
 * ⚠️ 预选那一段原来按"最平 + 平原群系 + 离原点最近"打分取最优，结果是**任何种子
 * 第一眼都落在离原点最近的平原**（用户反馈"每个世界看起来都差不多"）。
 * 现在改成半径内随机试投，只排掉水面与虚空——森林 / 丘陵 / 雪原 / 沙漠都可能。
 * 但**随机源必须由世界种子派生**：否则同一个种子两次进入的出生点会不同。
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
  // 批次 213：读档/重生的落地校正也会用到这张表，下界与末地各自的地面
  // 不认的话，那两处的校正会找不到任何落脚点。
  Block.NETHERRACK,
  Block.SOUL_SAND,
  Block.BLACKSTONE,
  Block.END_STONE,
  Block.OBSIDIAN,
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
 * 在给定高度附近找该列最高的自然地面（批次 213：读档落地校正用）。
 *
 * 与 `naturalGroundY` 的区别：**不从世界顶开始扫**。读档校正时玩家通常在
 * 地表附近，从顶往下扫一整列（~384 次读方块）× 上百列会很贵；
 * 这里只看 `[y-48, y+8]`，一次校正的开销压到可以忽略。
 */
export function naturalGroundNear(
  world: SpawnSearchWorld,
  x: number,
  z: number,
  fromY: number,
  depth = 48,
): number | null {
  if (!world.isLoaded(x, z)) return null;
  const top = Math.min(WORLD_MAX_Y - 2, Math.floor(fromY) + 8);
  const bottom = Math.max(WORLD_MIN_Y, Math.floor(fromY) - depth);
  for (let y = top; y >= bottom; y--) {
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
  /**
   * 地表高度下限（批次 238）：低于它的列不当候选。
   *
   * 主世界传海平面（64）——那是"不要在海底/海里出生"的判据；超平坦必须传
   * `FLAT_SURFACE_Y`（-61），否则每一列都低于 64 被跳过，出生点永远解析不出来
   * （表现就是加载遮罩不撤、看起来卡死）。
   */
  minGroundY = 64,
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
      if (groundY === null || groundY < minGroundY) continue;

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

/** 随机试投的次数上限：命中一块"够平 + 够高 + 不是水"的就立刻用 */
const SPAWN_TRIES = 48;
/** 试投点的允许起伏（格）：与 `findSafeSpawn` 的 5×5 判据同一量级 */
const SPAWN_ROUGHNESS = 4;
/** 兜底扫描的半径上限（格）：随机试投全军覆没时才走它，别在这里烧噪声 */
const FALLBACK_SCAN_RADIUS = 256;

/**
 * 水/虚空这类"第一眼就不该出生"的群系。
 *
 * ⚠️ 这里**只排掉水与虚空**，不再像旧版那样把非平原都往下压：
 * 用户要的是"不同种子第一眼不一样"（森林 / 丘陵 / 雪原 / 沙漠都行），
 * 而不是每次都被送到最近的一块平原草地。
 */
const UNFIT_BIOMES = new Set(['ocean', 'deep_ocean', 'frozen_ocean', 'deep_frozen_ocean', 'river', 'the_void']);

/** 试投点周围"挪一挪再试"的半径与步长（格）：岸边/岛上的落点靠它找回陆地 */
const SPAWN_NUDGE_RADIUS = 16;
const SPAWN_NUDGE_STEP = 8;

/** 单个点是否够平够高；合格返回该点地表高度 */
function flatSpotAt(
  surfaceAt: (x: number, z: number) => number,
  x: number,
  z: number,
  minGroundY: number,
): number | null {
  const center = surfaceAt(x, z);
  if (!Number.isFinite(center) || center < minGroundY || center >= WORLD_MAX_Y - 4) return null;
  let low = center;
  let high = center;
  for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4]] as const) {
    const y = surfaceAt(x + dx, z + dz);
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return high - low > SPAWN_ROUGHNESS ? null : center;
}

/**
 * 在试投点周围一圈圈地找第一块合格地面（先中心、再 8 格环、再 16 格环）。
 *
 * 为什么要"挪一挪"：试投是**面积均匀**的，落进海里的概率不低；如果只要中心点，
 * 能通过的只剩"本来就高于海平面的高地"，而高地在这个生成器里偏冷 —— 实测
 * 5 个种子全落在雪原/冰刺。先在同一片海域里找最近的岸，就不会把落点推到远处高山。
 */
function flatSpotNear(
  surfaceAt: (x: number, z: number) => number,
  x: number,
  z: number,
  minGroundY: number,
): { x: number; z: number; y: number } | null {
  const center = flatSpotAt(surfaceAt, x, z, minGroundY);
  if (center !== null) return { x, z, y: center };
  for (let r = SPAWN_NUDGE_STEP; r <= SPAWN_NUDGE_RADIUS; r += SPAWN_NUDGE_STEP) {
    for (const [dx, dz] of [
      [r, 0], [-r, 0], [0, r], [0, -r],
      [r, r], [r, -r], [-r, r], [-r, -r],
    ] as const) {
      const y = flatSpotAt(surfaceAt, x + dx, z + dz, minGroundY);
      if (y !== null) return { x: x + dx, z: z + dz, y };
    }
  }
  return null;
}

/**
 * 区块尚未生成时，先用生成器的地表函数挑一片值得加载的陆地。
 * 这是“出生在大海且视距内没有陆地”的兜底；真正落脚仍由 `findSafeSpawn` 对实体方块复核。
 *
 * 两段式（批次 20261024-1152）：
 *  ① **半径内按面积均匀随机试投**（`SPAWN_TRIES` 次）：第一块"够平、高于地表下限、
 *     不在水里"的点就当作出生区域。旧版是"全网格打分取最优"，评分里
 *     `起伏×1000 + 群系偏好×80 + 距离` 会把任何种子都压到**离原点最近的平原**，
 *     于是每个世界第一眼都是"草地 + 树 + 旁边海 + 远处山"（用户反馈）。
 *  ② 试投全部落空（例如半径内几乎全是海）才退回**整片网格扫描**（≤ 256 格），
 *     评分口径与旧版一致——保证"出生在大海"这类极端种子仍然能选出一块陆地。
 *
 * @param radius 随机试投的半径（格）；旧版这里只有 256，现在主世界用 1024
 * @param random [0,1) 随机源。**必须由世界种子派生**（`new Random(seed).nextDouble`），
 *               否则"同一个种子两次进入的出生点不同"，与原版口径不符
 */
export function planSpawnRegion(
  surfaceAt: (x: number, z: number) => number,
  biomeAt: (x: number, z: number) => string | null,
  radius = 1024,
  /** 地表高度下限（批次 238）：与 `findSafeSpawn` 同一个参数，超平坦传 `FLAT_SURFACE_Y` */
  minGroundY = 64,
  random: () => number = Math.random,
): { x: number; z: number; y: number } {
  // ---- ① 随机试投（面积均匀：半径开方，否则会全挤在圆心附近）
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    const x = Math.round(Math.cos(angle) * distance);
    const z = Math.round(Math.sin(angle) * distance);
    const spot = flatSpotNear(surfaceAt, x, z, minGroundY);
    if (spot === null) continue;
    const biome = biomeAt(spot.x, spot.z);
    if (biome !== null && UNFIT_BIOMES.has(biome)) continue;
    return spot;
  }

  // ---- ② 兜底：网格扫描（旧口径：起伏优先、群系其次、距离最后）
  // `y` 一起返回：调用方要先把玩家放在"真实地表上方"等区块流出来，
  // 以前那个位置写死成 y=80（超平坦地表 -61 → 出生点没解析出来就掉 141 格摔死）。
  let best = { x: 0, z: 0, y: surfaceAt(0, 0) };
  let bestScore = Number.POSITIVE_INFINITY;
  const step = 8;
  const scan = Math.min(radius, FALLBACK_SCAN_RADIUS);
  for (let z = -scan; z <= scan; z += step) {
    for (let x = -scan; x <= scan; x += step) {
      const center = flatSpotAt(surfaceAt, x, z, minGroundY);
      if (center === null) continue;
      const rank = biomeRank(biomeAt(x, z));
      const score = rank * 80 + Math.hypot(x, z);
      if (score < bestScore) {
        bestScore = score;
        best = { x, z, y: center };
      }
    }
  }
  return best;
}
