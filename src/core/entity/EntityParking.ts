/**
 * 生物 / 掉落物的区块寄存（批次 258，J2 第二刀）
 *
 * 与 `VehicleParking` 同一套思路：区块卸载时把实体记成**纯数据**，
 * 区块重新加载时再造回来。分开两个类而不是塞进一个，是因为两边要存的字段
 * 差别很大（载具只有坐标朝向，生物有血量/驯服/羊毛）。
 *
 * ⚠️ 范围（写进 TASKS J2）：
 *  - 生物只存**一眼能看见的状态**：种类、坐标、朝向、血量、驯服、坐下、被牵、剪毛、羊毛色。
 *    不存：幼体（读档按成年算）、状态效果、繁殖/生长计时、马鞍、羊驼的箱子。
 *  - 掉落物只存 `id + 数量 + 坐标`：**附加数据（耐久/附魔/改名）不存**——
 *    与漏斗矿车那条差异同一个取舍。
 *  - 纯数据、可离线测试；主程序负责把记录变成真实体。
 */

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
}

export interface SavedItemEntity {
  kind: 'item';
  itemId: number;
  count: number;
  x: number;
  y: number;
  z: number;
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
