/**
 * 实体快照的线上格式（L8 · MS3）
 *
 * 房主每 100ms 把视野内的实体推给从属端，从属端据此画"影子实体"。这一层只管**编解码**：
 *
 *   · 紧凑：一条一个数组（`[key, type, x, y, z, yaw, health, flags]`），字段名不进包；
 *   · 坐标按 0.01 取整：100ms 一次的快照，毫米级精度没有意义，反而让每条多十几个字节；
 *   · **外部数据一律当不可信**：键必须能反解、数字必须有限、类型名非空，
 *     坏条目**单独丢**（与 `blocks` 同一口径，一条坏的不该让整包作废）。
 *
 * 不做的事（留给调用方）：AOI 裁剪、按房间/维度分组、排序。那些需要世界状态，
 * 纯函数里做不了，也就测不了。
 */

import { parseMobKey } from './MobAuthority.ts';

/** 一条实体状态的快照 */
export interface EntitySnapshot {
  /** 全局键 `ownerId:localId`（见 `MobAuthority.mobKey`） */
  key: string;
  /** 生物类型 id（`MobType.id`，如 `zombie`） */
  type: string;
  x: number;
  y: number;
  z: number;
  /** 朝向（弧度）；渲染只需要它 */
  yaw: number;
  health: number;
  /** 状态位，见 `ENTITY_FLAGS` */
  flags: number;
}

/** 状态位：只放"从属端画得出来"的布尔量，数量少所以塞进一个整数 */
export const ENTITY_FLAGS = {
  /** 幼体：体型缩小 */
  baby: 1,
  /** 着火：身上有火苗 */
  onFire: 2,
  /** 受击闪：刚被打过（红闪由本地计时，见 `RemoteAppearance` 的同一套做法） */
  hurt: 4,
  /** 已驯服：项圈/坐姿需要 */
  tamed: 8,
} as const;

/** 一位快照（线上形态）：`[key, type, x, y, z, yaw, health, flags]` */
export type WireEntity = [string, string, number, number, number, number, number, number];

/** 坐标/朝向/血量的精度（小数位）：100ms 一次，两位小数足够 */
const PRECISION = 2;

/** 一条快照最多带多少实体（防止一包大得离谱；真正的裁剪在 AOI 那层） */
export const MAX_SNAPSHOT_ENTITIES = 256;

function round(value: number): number {
  const factor = 10 ** PRECISION;
  return Math.round(value * factor) / factor;
}

/** 把一组快照编成线上形态（坐标取整；超过上限的部分截掉） */
export function encodeEntities(list: readonly EntitySnapshot[]): WireEntity[] {
  const out: WireEntity[] = [];
  for (const entity of list) {
    if (out.length >= MAX_SNAPSHOT_ENTITIES) break;
    // 键不合法的条目在这里就丢掉：两端对不上身份的数据没有任何用处
    if (parseMobKey(entity.key) === null) continue;
    if (entity.type.length === 0) continue;
    if (
      !Number.isFinite(entity.x) || !Number.isFinite(entity.y) || !Number.isFinite(entity.z) ||
      !Number.isFinite(entity.yaw) || !Number.isFinite(entity.health)
    ) {
      continue;
    }
    out.push([
      entity.key,
      entity.type,
      round(entity.x),
      round(entity.y),
      round(entity.z),
      round(entity.yaw),
      round(entity.health),
      entity.flags | 0,
    ]);
  }
  return out;
}

/**
 * 解码：坏条目**单独丢**，不整包作废。
 *
 * 血量夹到 `[0, maxHealth]`（传 `maxHealth` 时）——一口 -5 血的僵尸会让从属端画出
 * 一条负长度的血条，那是渲染层的麻烦，不如在入口夹住。
 */
export function decodeEntities(raw: unknown, maxHealth?: number): EntitySnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: EntitySnapshot[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 8) continue;
    const [key, type, x, y, z, yaw, health, flags] = item as unknown[];
    if (typeof key !== 'string' || parseMobKey(key) === null) continue;
    if (typeof type !== 'string' || type.length === 0) continue;
    if (
      typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
      typeof yaw !== 'number' || typeof health !== 'number' || typeof flags !== 'number'
    ) {
      continue;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(yaw) || !Number.isFinite(health)) {
      continue;
    }
    const clamped = maxHealth === undefined ? health : Math.min(Math.max(health, 0), maxHealth);
    out.push({ key, type, x, y, z, yaw, health: clamped, flags: flags | 0 });
    if (out.length >= MAX_SNAPSHOT_ENTITIES) break;
  }
  return out;
}

/** 读一位状态（`flags` 里有没有这一位） */
export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}

/** 往 `flags` 里置一位 */
export function withFlag(flags: number, flag: number, on: boolean): number {
  return on ? flags | flag : flags & ~flag;
}
