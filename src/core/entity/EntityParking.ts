/**
 * 生物 / 掉落物的区块寄存（批次 258，J2 第二刀；批次 445 补齐附加数据）
 *
 * 与 `VehicleParking` 同一套思路：区块卸载时把实体记成**纯数据**，
 * 区块重新加载时再造回来。分开两个类而不是塞进一个，是因为两边要存的字段
 * 差别很大（载具只有坐标朝向，生物有血量/驯服/羊毛）。
 *
 * 批次 445 起补齐了三处会让"读档后变样"的字段：
 *  - 幼体（`baby` + 剩余成长秒数）：原版幼体跨存档继续长大，不该读档变成年；
 *  - 状态效果（中毒/缓慢/着火那一套）：跳进去的瞬间不该被治好；
 *  - 掉落物的附加数据（耐久/附魔/改名/潜影盒内容物）：带着附魔的镐掉在地上，
 *    区块卸载再回来不该变成白板。
 *
 * ⚠️ 仍未做：繁殖/求爱计时、马鞍、羊驼的箱子、跨维度转移（另立批次）。
 *  - 纯数据、可离线测试；主程序负责把记录变成真实体。
 */

import type { DroppedExtras } from './Entity.ts';
import { sanitizeMobEquipment, type MobEquipment } from './MobEquipment.ts';
import type { VillagerSavedState } from './Villager.ts';
import { MAX_TRADE_DEMAND } from '../registry/villagerTrades.ts';

/** 存档里的一条状态效果（与 `StatusEffects.serialize()` 同形） */
export interface SavedMobEffect {
  id: string;
  amplifier: number;
  ticks: number;
  ambient: boolean;
}

export interface SavedMob {
  kind: 'mob';
  typeId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  tamed: boolean;
  sitting: boolean;
  leashed: boolean;
  sheared: boolean;
  woolColor: number;
  /** 是不是幼体（批次 445） */
  baby: boolean;
  /** 幼体剩余成长秒数；成年体写 0 */
  growSeconds: number;
  /** 身上的状态效果；没有效果时省略（存档里绝大多数生物都没有） */
  effects?: SavedMobEffect[];
  /** 村民的职业与交易进度（批次 501）；非村民、无业村民都不写这个键 */
  villager?: VillagerSavedState;
  /** 个体装备（J27）：白板生物不写这个键 */
  equipment?: MobEquipment;
  /** 马/驴/骡的鞍（批次 571）：没装鞍不写 */
  saddled?: boolean;
  /** 马铠物品 id（批次 571）：没装不写 */
  horseArmor?: number;
}

export interface SavedItemEntity {
  kind: 'item';
  itemId: number;
  count: number;
  x: number;
  y: number;
  z: number;
  /** 耐久/附魔/改名/潜影盒内容物；白板物品省略 */
  extras?: DroppedExtras;
}

export type SavedEntity = SavedMob | SavedItemEntity;

/** 存档里的一条（带维度；区块坐标由 x/z 反推） */
export type SavedEntityRecord = SavedEntity & { dimension: string };

interface ParkedEntry {
  dimension: string;
  cx: number;
  cz: number;
  entities: SavedEntity[];
}

/** 区块边长 16：负坐标必须用 `Math.floor`（`>> 4` 在负数上会偏一格） */
function chunkOf(value: number): number {
  return Math.floor(value / 16);
}

/**
 * 状态效果的浅校验（批次 445）。
 *
 * 这里**只校验形状**，不校验 id 是否属于本版本的效果表——那是
 * `StatusEffects.restore()` 的职责（它已经有那张表，重复一份必然漂）。
 * 返回 `undefined` 而不是空数组：存档里"没有效果"不该占一个键。
 */
function sanitizeEffects(data: unknown): SavedMobEffect[] | undefined {
  if (!Array.isArray(data)) return undefined;
  const out: SavedMobEffect[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { id?: unknown; amplifier?: unknown; ticks?: unknown; ambient?: unknown };
    if (typeof record.id !== 'string' || record.id.length === 0) continue;
    if (typeof record.ticks !== 'number' || !Number.isFinite(record.ticks) || record.ticks <= 0) continue;
    const amplifier =
      typeof record.amplifier === 'number' && Number.isFinite(record.amplifier)
        ? Math.max(0, Math.floor(record.amplifier))
        : 0;
    out.push({
      id: record.id,
      amplifier,
      ticks: Math.max(1, Math.floor(record.ticks)),
      ambient: record.ambient === true,
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 村民附加数据的浅校验（批次 501）。
 *
 * 与 `sanitizeEffects` 同一条分工：这里**只校验形状**（职业是不是非空字符串、
 * 数字是不是有限数），"这个职业认不认识"交给 `Villager.restoreState`——
 * 它才持有职业表，重复一份必然漂。
 */
function sanitizeVillager(data: unknown): VillagerSavedState | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as {
    profession?: unknown;
    xp?: unknown;
    uses?: unknown;
    demand?: unknown;
    home?: unknown;
    workstation?: unknown;
  };
  if (typeof record.profession !== 'string' || record.profession.length === 0) return undefined;
  const xp =
    typeof record.xp === 'number' && Number.isFinite(record.xp) ? Math.max(0, Math.floor(record.xp)) : 0;
  const uses: number[] = [];
  if (Array.isArray(record.uses)) {
    for (const value of record.uses) {
      uses.push(typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
    }
  }
  // 需求量（批次 509）：与 uses 同形、同长度校验（错位会落到别的交易上）
  const demand: number[] = [];
  if (Array.isArray(record.demand)) {
    for (const value of record.demand) {
      demand.push(
        typeof value === 'number' && Number.isFinite(value)
          ? Math.max(0, Math.min(MAX_TRADE_DEMAND, Math.floor(value)))
          : 0,
      );
    }
  }
  const home = sanitizePoint(record.home);
  const workstation = sanitizePoint(record.workstation);
  return {
    profession: record.profession,
    xp,
    uses,
    ...(demand.length > 0 ? { demand } : {}),
    ...(home ? { home } : {}),
    ...(workstation ? { workstation } : {}),
  };
}

/** 作息坐标的浅校验（批次 510）：三个都必须是有限数，否则整份丢掉 */
function sanitizePoint(raw: unknown): { x: number; y: number; z: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const point = raw as { x?: unknown; y?: unknown; z?: unknown };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return undefined;
  return { x: Math.floor(point.x as number), y: Math.floor(point.y as number), z: Math.floor(point.z as number) };
}

/** 一层附加数据（掉落物本身，或潜影盒里的一格）的浅校验 */
function sanitizeExtrasFields(source: unknown): DroppedExtras | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  const out: DroppedExtras = {};
  if (typeof record.damage === 'number' && Number.isFinite(record.damage) && record.damage > 0) {
    out.damage = Math.floor(record.damage);
  }
  if (record.enchants && typeof record.enchants === 'object') {
    const enchants: Record<string, number> = {};
    for (const [id, level] of Object.entries(record.enchants as Record<string, unknown>)) {
      if (typeof level !== 'number' || !Number.isFinite(level) || level <= 0) continue;
      enchants[id] = Math.floor(level);
    }
    if (Object.keys(enchants).length > 0) out.enchants = enchants;
  }
  if (typeof record.name === 'string' && record.name.length > 0) out.name = record.name;
  if (typeof record.repairCost === 'number' && Number.isFinite(record.repairCost) && record.repairCost > 0) {
    out.repairCost = Math.floor(record.repairCost);
  }
  if (Array.isArray(record.contents)) {
    const contents = record.contents.map((slot) => {
      if (slot === null) return null;
      if (!slot || typeof slot !== 'object') return null;
      const stack = slot as Record<string, unknown>;
      if (typeof stack.id !== 'number' || !Number.isFinite(stack.id)) return null;
      if (typeof stack.count !== 'number' || !Number.isFinite(stack.count) || stack.count <= 0) return null;
      const extras = sanitizeExtrasFields(stack) ?? {};
      return { ...extras, id: Math.floor(stack.id), count: Math.floor(stack.count) };
    });
    if (contents.some((slot) => slot !== null)) out.contents = contents;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeExtras(data: unknown): DroppedExtras | undefined {
  return sanitizeExtrasFields(data) ?? undefined;
}

export class EntityParking {
  private readonly parked = new Map<string, ParkedEntry>();

  private static key(dimension: string, cx: number, cz: number): string {
    return `${dimension}:${cx},${cz}`;
  }

  park(dimension: string, cx: number, cz: number, entity: SavedEntity): void {
    const key = EntityParking.key(dimension, cx, cz);
    const entry = this.parked.get(key);
    if (entry) entry.entities.push(entity);
    else this.parked.set(key, { dimension, cx, cz, entities: [entity] });
  }

  /** 取走这个区块的全部记录（取完即删，避免重复生成） */
  take(dimension: string, cx: number, cz: number): SavedEntity[] {
    const key = EntityParking.key(dimension, cx, cz);
    const entry = this.parked.get(key);
    this.parked.delete(key);
    return entry?.entities ?? [];
  }

  /** 导出全部记录（写存档用） */
  snapshotAll(): SavedEntityRecord[] {
    const records: SavedEntityRecord[] = [];
    for (const entry of this.parked.values()) {
      for (const entity of entry.entities) {
        records.push({ dimension: entry.dimension, ...entity });
      }
    }
    return records;
  }

  /**
   * 从存档恢复（脏数据跳过）。
   *
   * 校验很轻但必要：`typeId` 是字符串、`kind` 只有两种、坐标必须是有限数——
   * 手改过的存档不该让游戏在读档时崩掉。
   */
  restoreAll(records: readonly SavedEntityRecord[] | undefined): void {
    if (!records) return;
    for (const record of records) {
      if (!record) continue;
      if (!Number.isFinite(record.x) || !Number.isFinite(record.y) || !Number.isFinite(record.z)) continue;
      if (record.kind === 'mob') {
        if (typeof record.typeId !== 'string' || record.typeId.length === 0) continue;
        const baby = record.baby === true;
        this.park(record.dimension, chunkOf(record.x), chunkOf(record.z), {
          kind: 'mob',
          typeId: record.typeId,
          x: record.x,
          y: record.y,
          z: record.z,
          yaw: Number.isFinite(record.yaw) ? record.yaw : 0,
          health: Number.isFinite(record.health) ? record.health : 1,
          tamed: record.tamed === true,
          sitting: record.sitting === true,
          leashed: record.leashed === true,
          sheared: record.sheared === true,
          woolColor: Number.isFinite(record.woolColor) ? record.woolColor : 0,
          baby,
          // 成年体的成长计时没有意义：即使存档里残留一个数也归零，
          // 否则"成年生物 + 正数计时"会让读档后的第一帧莫名其妙变小
          growSeconds:
            baby && Number.isFinite(record.growSeconds) ? Math.max(1, record.growSeconds) : 0,
          effects: sanitizeEffects(record.effects),
          villager: sanitizeVillager(record.villager),
          // 个体装备（J27）：与主程序 `spawnSavedEntity` 共用同一个清洗函数，
          // 脏 id 会被剔掉；白板生物仍然不占 `equipment` 这个键
          equipment: sanitizeMobEquipment(record.equipment),
          // 马鞍/马铠（批次 571）：马铠只做数值形状校验，具体物品是否合法
          // 由 `spawnSavedEntity` 的 `horseArmorTier` 再验一次
          saddled: record.saddled === true ? true : undefined,
          horseArmor:
            typeof record.horseArmor === 'number' && Number.isFinite(record.horseArmor)
              ? record.horseArmor
              : undefined,
        });
      } else if (record.kind === 'item') {
        if (!Number.isFinite(record.itemId) || !Number.isFinite(record.count) || record.count <= 0) continue;
        this.park(record.dimension, chunkOf(record.x), chunkOf(record.z), {
          kind: 'item',
          itemId: record.itemId,
          count: Math.floor(record.count),
          x: record.x,
          y: record.y,
          z: record.z,
          extras: sanitizeExtras(record.extras),
        });
      }
    }
  }

  get size(): number {
    let total = 0;
    for (const entry of this.parked.values()) total += entry.entities.length;
    return total;
  }

  clear(): void {
    this.parked.clear();
  }
}
