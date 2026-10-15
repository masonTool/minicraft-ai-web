/**
 * 方块容器存储
 *
 * 熔炉、箱子这类"带内容的方块"需要按坐标保存状态，不能塞进方块的 1 字节 id 里。
 * 用世界坐标作为键存在一张表里，方块被破坏或替换时移除对应条目。
 *
 * 关卡存档（K1）接入时，这里就是序列化的入口：entries() 可完整导出状态。
 */

import { Anvil } from '../container/Anvil.ts';
import { Chest } from '../container/Chest.ts';
import { EnchantTable } from '../container/EnchantTable.ts';
import { Furnace } from '../container/Furnace.ts';

export type BlockContainer = Furnace | Chest | EnchantTable | Anvil;
export type ContainerKind = 'furnace' | 'chest' | 'enchanting' | 'anvil';

interface Entry {
  x: number;
  y: number;
  z: number;
  container: BlockContainer;
}

export class BlockEntityStore {
  private readonly entries = new Map<string, Entry>();

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  get(x: number, y: number, z: number): BlockContainer | undefined {
    return this.entries.get(BlockEntityStore.key(x, y, z))?.container;
  }

  getFurnace(x: number, y: number, z: number): Furnace | undefined {
    const container = this.get(x, y, z);
    return container instanceof Furnace ? container : undefined;
  }

  getChest(x: number, y: number, z: number): Chest | undefined {
    const container = this.get(x, y, z);
    return container instanceof Chest ? container : undefined;
  }

  getOrCreateFurnace(x: number, y: number, z: number): Furnace {
    const existing = this.getFurnace(x, y, z);
    if (existing) return existing;
    const furnace = new Furnace();
    this.entries.set(BlockEntityStore.key(x, y, z), { x, y, z, container: furnace });
    return furnace;
  }

  getOrCreateChest(x: number, y: number, z: number): Chest {
    const existing = this.getChest(x, y, z);
    if (existing) return existing;
    const chest = new Chest();
    this.entries.set(BlockEntityStore.key(x, y, z), { x, y, z, container: chest });
    return chest;
  }

  getAnvil(x: number, y: number, z: number): Anvil | undefined {
    const container = this.get(x, y, z);
    return container instanceof Anvil ? container : undefined;
  }

  /** 铁砧的两格输入也按坐标存：放下东西走开再回来，东西还在台面上 */
  getOrCreateAnvil(x: number, y: number, z: number): Anvil {
    const existing = this.getAnvil(x, y, z);
    if (existing) return existing;
    const anvil = new Anvil();
    this.entries.set(BlockEntityStore.key(x, y, z), { x, y, z, container: anvil });
    return anvil;
  }

  getEnchantTable(x: number, y: number, z: number): EnchantTable | undefined {
    const container = this.get(x, y, z);
    return container instanceof EnchantTable ? container : undefined;
  }

  /**
   * 附魔台的容器也按坐标存：玩家把装备与青金石放在台子上走开再回来，东西还在原处
   * （候选槽是每次打开重掷的，所以不存在"走开再回来还是同一批附魔"的问题）。
   */
  getOrCreateEnchantTable(x: number, y: number, z: number): EnchantTable {
    const existing = this.getEnchantTable(x, y, z);
    if (existing) return existing;
    const table = new EnchantTable();
    this.entries.set(BlockEntityStore.key(x, y, z), { x, y, z, container: table });
    return table;
  }

  remove(x: number, y: number, z: number): void {
    this.entries.delete(BlockEntityStore.key(x, y, z));
  }

  /** 遍历所有容器（熔炉 tick 用） */
  forEach(fn: (container: BlockContainer, x: number, y: number, z: number) => void): void {
    for (const entry of this.entries.values()) fn(entry.container, entry.x, entry.y, entry.z);
  }

  get size(): number {
    return this.entries.size;
  }

  /** 卸载区块时清理该区块内所有容器，并返回被清理的内容（由调用方决定是否掉落） */
  removeInChunk(chunkX: number, chunkZ: number, onRemove?: (container: BlockContainer, x: number, y: number, z: number) => void): void {
    const minX = chunkX * 16;
    const maxX = minX + 15;
    const minZ = chunkZ * 16;
    const maxZ = minZ + 15;

    for (const [key, entry] of [...this.entries]) {
      if (entry.x < minX || entry.x > maxX || entry.z < minZ || entry.z > maxZ) continue;
      this.entries.delete(key);
      onRemove?.(entry.container, entry.x, entry.y, entry.z);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
