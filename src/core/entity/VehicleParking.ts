/**
 * 载具停车记录（批次 257，J2「实体持久化」第一刀）
 *
 * 要解决的问题：区块卸载时 `EntityManager.removeInChunk` 会把区块里的实体
 * **直接 splice 掉**，于是玩家把船停在岸边走远再回来，船就没了。
 *
 * 做法：卸载前把**载具**（船 / 三种矿车）记成一条纯数据（种类 + 坐标 + 朝向），
 * 按「维度 + 区块坐标」存起来；区块重新加载时再原样造回来。
 *
 * ⚠️ 范围（写进 TASKS J2）：
 *  - 只管**载具**。生物与掉落物仍然卸载即消失（那是另一套"生物种群"的持久化，
 *    要做就得连血量/驯服状态/背包一起存，不是这一批的量）；
 *  - 只存在**内存**里：退出游戏（存档重开）之后仍然会丢——存档序列化是 J2 的下一步。
 *
 * 抽成独立类而不是塞进 `EntityManager` 的原因：它需要"维度"这个信息，
 * 而实体管理器是纯三维坐标的（不知道维度）；放在主程序里又不好离线测试。
 */
export type VehicleKind = 'boat' | 'minecart' | 'hopper' | 'furnace';

/** 读档时校验种类：存档可以被手改，别让 `kind: 'ufo'` 造出一个 undefined 实体 */
const KINDS: ReadonlySet<string> = new Set<VehicleKind>(['boat', 'minecart', 'hopper', 'furnace']);

export interface ParkedVehicle {
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** 存档里的一条（批次 258：多了维度，区块坐标由 x/z 反推） */
export interface SavedVehicle extends ParkedVehicle {
  dimension: string;
}

interface ParkedEntry {
  dimension: string;
  cx: number;
  cz: number;
  vehicles: ParkedVehicle[];
}

/** 区块边长（16）：`x >> 4` 与 `Math.floor(x / 16)` 对负数不一致，统一用后者 */
function chunkOf(value: number): number {
  return Math.floor(value / 16);
}

export class VehicleParking {
  /** key = `${dimension}:${chunkX},${chunkZ}` */
  private readonly parked = new Map<string, ParkedEntry>();

  private static key(dimension: string, cx: number, cz: number): string {
    return `${dimension}:${cx},${cz}`;
  }

  /** 记一条（同一区块可以停多辆，按顺序恢复） */
  park(dimension: string, cx: number, cz: number, vehicle: ParkedVehicle): void {
    const key = VehicleParking.key(dimension, cx, cz);
    const entry = this.parked.get(key);
    if (entry) entry.vehicles.push(vehicle);
    else this.parked.set(key, { dimension, cx, cz, vehicles: [vehicle] });
  }

  /** 取走这个区块的全部记录（取完即删，避免重复生成） */
  take(dimension: string, cx: number, cz: number): ParkedVehicle[] {
    const key = VehicleParking.key(dimension, cx, cz);
    const entry = this.parked.get(key);
    this.parked.delete(key);
    return entry?.vehicles ?? [];
  }

  /**
   * 导出全部停放记录（批次 258：写存档用）。
   *
   * 区块坐标不进存档——恢复时按 x/z 重新算，少一个可能对不上的字段。
   */
  snapshotAll(): SavedVehicle[] {
    const records: SavedVehicle[] = [];
    for (const entry of this.parked.values()) {
      for (const vehicle of entry.vehicles) {
        records.push({ dimension: entry.dimension, ...vehicle });
      }
    }
    return records;
  }

  /** 从存档恢复（批次 258）：脏数据跳过，不让一条坏记录把读档带崩 */
  restoreAll(records: readonly SavedVehicle[] | undefined): void {
    if (!records) return;
    for (const record of records) {
      if (!record || !KINDS.has(record.kind)) continue;
      if (!Number.isFinite(record.x) || !Number.isFinite(record.y) || !Number.isFinite(record.z)) continue;
      this.park(record.dimension, chunkOf(record.x), chunkOf(record.z), {
        kind: record.kind,
        x: record.x,
        y: record.y,
        z: record.z,
        yaw: Number.isFinite(record.yaw) ? record.yaw : 0,
      });
    }
  }

  /** 现在一共停着几辆（验收/调试用） */
  get size(): number {
    let total = 0;
    for (const entry of this.parked.values()) total += entry.vehicles.length;
    return total;
  }

  clear(): void {
    this.parked.clear();
  }
}
