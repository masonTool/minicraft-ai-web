/**
 * 实体管理器
 *
 * 只负责"持有 + 推进 + 清理"，不关心具体实体类型。
 * 区块卸载时清掉落在该区块内的实体，避免实体在未加载区域无限堆积。
 */

import type { Entity, EntityContext } from './Entity.ts';

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
