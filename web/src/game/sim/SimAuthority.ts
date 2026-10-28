/**
 * 房主侧采集（L8 · MS3）：把**视野内的实体**收成一份快照推给从属端。
 *
 * 为什么是房主采、而不是"谁离得近谁采"（`MobAuthority.pickAuthority` 那套）：
 * MS2 定下"世界只由房主模拟"，生物 AI 只有一份轨迹；再让"最近的人"当权威就等于
 * 把模拟拆回多份，两只手交接时位置必然跳一下。所以这里只有一个视角：**房主自己**。
 *
 * 采集范围与广播同一把尺子：同维度 + 水平**切比雪夫** ≤ `radiusChunks` 个区块
 * （与 `server/node/aoi.mjs` 的 `withinAoi` 同一个口径，房主先筛一遍，服务端还会再筛一遍——
 * 两边同样便宜，但房主这层能少发一半包）。
 *
 * 纯函数、不碰世界与网络：主程序每 100ms 把实体表拍平传进来，得到一份可编码的快照。
 */

import { decodeEntities, encodeEntities, type EntitySnapshot, type WireEntity } from '../../core/net/EntitySnapshot.ts';

/** 采集间隔（毫秒）：与远端玩家位置的近档同频（`AOI_NEAR_INTERVAL_MS`） */
export const ENTITY_SNAPSHOT_INTERVAL_MS = 100;

/** 默认采集半径（区块，切比雪夫）：与 `server/node/aoi.mjs` 的 `AOI_RADIUS_CHUNKS` 一致 */
export const ENTITY_SNAPSHOT_RADIUS_CHUNKS = 8;

/** 一份可采集的实体（调用方从 `EntityManager` 拍平出来） */
export interface SimEntity {
  readonly key: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly health: number;
  readonly flags: number;
  /** 实体所在维度；与房主不同维度的**一律不发**（从属端在那个维度本来也画不出来） */
  readonly dimension: string;
}

/** 房主此刻的观察点 */
export interface SimViewpoint {
  readonly x: number;
  readonly z: number;
  readonly dimension: string;
}

/** 世界坐标 → 区块坐标（与 `World.toChunkCoord` 同一条式子：`>> 4`） */
function chunkCoord(world: number): number {
  return world >> 4;
}

/**
 * 这个实体在不在观察范围内（同维度 + 水平切比雪夫 ≤ 半径）。
 *
 * 用切比雪夫（`max(|dx|, |dz|)`）而不是欧氏距离：服务端的 AOI 用的是这个，
 * 两边口径不一致会出现"房主发了、服务端又按另一条尺子丢掉"的诡异现象。
 */
export function withinEntityAoi(
  entity: { x: number; z: number; dimension: string },
  viewpoint: SimViewpoint,
  radiusChunks: number = ENTITY_SNAPSHOT_RADIUS_CHUNKS,
): boolean {
  if (entity.dimension !== viewpoint.dimension) return false;
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z)) return false;
  const dx = Math.abs(chunkCoord(entity.x) - chunkCoord(viewpoint.x));
  const dz = Math.abs(chunkCoord(entity.z) - chunkCoord(viewpoint.z));
  return Math.max(dx, dz) <= radiusChunks;
}

/**
 * 采集一份快照：只留观察范围内的实体，**近的先留**（超上限时远处的被截掉）。
 *
 * 为什么要按距离排序：一包上限 256 只，村庄里可能有几百只；把远处的丢掉比丢近处的
 * 合理——近处的正在被玩家看着，远处的画错一两秒没人会注意。
 */
export function collectEntitySnapshots(
  entities: readonly SimEntity[],
  viewpoint: SimViewpoint,
  radiusChunks: number = ENTITY_SNAPSHOT_RADIUS_CHUNKS,
): EntitySnapshot[] {
  const inRange: Array<{ entity: SimEntity; distance: number }> = [];
  for (const entity of entities) {
    if (!withinEntityAoi(entity, viewpoint, radiusChunks)) continue;
    const dx = entity.x - viewpoint.x;
    const dz = entity.z - viewpoint.z;
    inRange.push({ entity, distance: dx * dx + dz * dz });
  }
  inRange.sort((a, b) => a.distance - b.distance);
  return inRange.map(({ entity }) => ({
    key: entity.key,
    type: entity.type,
    x: entity.x,
    y: entity.y,
    z: entity.z,
    yaw: entity.yaw,
    health: entity.health,
    flags: entity.flags,
  }));
}

/**
 * 采集并直接编码成线上形态（房主每 100ms 调一次）。
 *
 * 两件事在这里一起做：筛范围 + 编码。分成两步调用容易忘掉其中一步，
 * 而忘了编码的后果是"发出去了但格式不对"，这种错误在日志里看不出来。
 */
export function encodeEntitySnapshots(
  entities: readonly SimEntity[],
  viewpoint: SimViewpoint,
  radiusChunks: number = ENTITY_SNAPSHOT_RADIUS_CHUNKS,
): WireEntity[] {
  return encodeEntities(collectEntitySnapshots(entities, viewpoint, radiusChunks));
}

/** 解码（从属端用）；`maxHealth` 传了就夹血量 */
export function decodeEntitySnapshots(raw: unknown, maxHealth?: number): EntitySnapshot[] {
  return decodeEntities(raw, maxHealth);
}
