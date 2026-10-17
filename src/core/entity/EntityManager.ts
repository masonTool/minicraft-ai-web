/**
 * 实体管理器
 *
 * 只负责"持有 + 推进 + 清理"，不关心具体实体类型。
 * 区块卸载时清掉落在该区块内的实体，避免实体在未加载区域无限堆积。
 */

import type { Entity, EntityContext } from './Entity.ts';
import { ItemEntity } from './ItemEntity.ts';
import { XpOrb } from './XpOrb.ts';
import { maxStackOf } from '../registry/items.ts';

/** 掉落物合并的判定半径（平方），约等于原版的 0.5 格 */
const MERGE_RADIUS_SQ = 1;
/** 超过这个数量就不做两两比较，避免 O(n²) 拖慢帧率 */
const MERGE_SCAN_LIMIT = 200;

export class EntityManager {
  private readonly list: Entity[] = [];

  get all(): readonly Entity[] {
    return this.list;
  }

  get count(): number {
    return this.list.length;
  }

  spawn<T extends Entity>(entity: T): T {
    this.list.push(entity);
    return entity;
  }

  update(ctx: EntityContext, dt: number): void {
    // 倒序遍历，方便原地删除
    for (let i = this.list.length - 1; i >= 0; i--) {
      const entity = this.list[i]!;
      entity.tick(ctx, dt);
      if (entity.dead) this.list.splice(i, 1);
    }

    this.mergeItemEntities();
    this.mergeXpOrbs();
  }

  /**
   * 经验球靠近就并成一个（批次 170，I16）。
   *
   * 原版也并；这里更有必要——打一群僵尸能掉二三十个球，不并会让实体表越来越长，
   * 而每个球在渲染层是**一个 sprite**。
   */
  private mergeXpOrbs(): void {
    if (this.list.length < 2 || this.list.length > MERGE_SCAN_LIMIT) return;

    const orbs: XpOrb[] = [];
    for (const entity of this.list) {
      if (entity instanceof XpOrb) orbs.push(entity);
    }
    if (orbs.length < 2) return;

    for (let i = 0; i < orbs.length; i++) {
      const target = orbs[i]!;
      if (target.dead || target.age < 0.5) continue;

      for (let j = i + 1; j < orbs.length; j++) {
        const other = orbs[j]!;
        if (other.dead || other.age < 0.5) continue;

        const dx = target.x - other.x;
        const dy = target.y - other.y;
        const dz = target.z - other.z;
        if (dx * dx + dy * dy + dz * dz > MERGE_RADIUS_SQ) continue;

        target.amount += other.amount;
        other.dead = true;
      }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i]!.dead) this.list.splice(i, 1);
    }
  }

  /**
   * 同类掉落物互相靠近后合并成更大的一堆（对齐原版行为，也顺带减少实体数量）。
   * 刚丢出的 0.5 秒内不参与合并，避免手上的物品瞬间并回一起。
   */
  private mergeItemEntities(): void {
    if (this.list.length < 2 || this.list.length > MERGE_SCAN_LIMIT) return;

    const items: ItemEntity[] = [];
    for (const entity of this.list) {
      if (entity instanceof ItemEntity) items.push(entity);
    }
    if (items.length < 2) return;

    for (let i = 0; i < items.length; i++) {
      const target = items[i]!;
      if (target.dead || target.age < 0.5) continue;

      for (let j = i + 1; j < items.length; j++) {
        const other = items[j]!;
        if (other.dead || other.age < 0.5) continue;
        // ⚠️ 只比 id 会把"改了名的/带附魔的"并进普通那堆，名字与附魔静默丢掉（批次 63）
        if (!other.sameAs(target)) continue;

        const dx = target.x - other.x;
        const dy = target.y - other.y;
        const dz = target.z - other.z;
        if (dx * dx + dy * dy + dz * dz > MERGE_RADIUS_SQ) continue;

        const room = maxStackOf(target.itemId) - target.count;
        if (room <= 0) break;

        const moved = Math.min(room, other.count);
        target.count += moved;
        other.count -= moved;
        if (other.count <= 0) other.dead = true;
      }
    }

    // 合并过程中被标记死亡的实体在这里统一回收
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i]!.dead) this.list.splice(i, 1);
    }
  }

  /** 移除指定区块内的实体 */
  removeInChunk(chunkX: number, chunkZ: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const entity = this.list[i]!;
      if (entity.chunkX === chunkX && entity.chunkZ === chunkZ) this.list.splice(i, 1);
    }
  }

  clear(): void {
    this.list.length = 0;
  }
}
