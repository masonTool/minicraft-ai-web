/**
 * 方块容器存储
 *
 * 熔炉、箱子这类"带内容的方块"需要按坐标保存状态，不能塞进方块的 1 字节 id 里。
 * 用世界坐标作为键存在一张表里，方块被破坏或替换时移除对应条目。
 *
 * 关卡存档（K1）接入时，这里就是序列化的入口：`forEach` 可完整导出状态
 * （C7 尾巴已经接上：见 `core/save/ContainerSave.ts`）。
 *
 * ⚠️ **键必须带维度**：三个维度共用同一套区块存储，坐标却会重叠——
 * 主世界 (0,64,0) 放的箱子与下界 (0,64,0) 放的熔炉如果没有维度前缀，
 * 后者会把前者**顶掉**（前者的东西就凭空没了）。
 */

import { Anvil } from '../container/Anvil.ts';
import { BrewingStand } from '../container/BrewingStand.ts';
import { Chest } from '../container/Chest.ts';
import { EnchantTable } from '../container/EnchantTable.ts';
import { Furnace } from '../container/Furnace.ts';
import type { DimensionId } from '../gen/Dimension.ts';

export type BlockContainer = Furnace | Chest | EnchantTable | Anvil | BrewingStand;
export type ContainerKind = 'furnace' | 'chest' | 'enchanting' | 'anvil' | 'brewing';

interface Entry {
  dimension: DimensionId;
  x: number;
  y: number;
  z: number;
  container: BlockContainer;
}

export class BlockEntityStore {
  private readonly entries = new Map<string, Entry>();

  /** 键的格式与区块增量一致：`维度|x,y,z` */
  private static key(dimension: DimensionId, x: number, y: number, z: number): string {
    return `${dimension}|${x},${y},${z}`;
  }

  private put(entry: Entry): void {
    this.entries.set(BlockEntityStore.key(entry.dimension, entry.x, entry.y, entry.z), entry);
  }

  get(dimension: DimensionId, x: number, y: number, z: number): BlockContainer | undefined {
    return this.entries.get(BlockEntityStore.key(dimension, x, y, z))?.container;
  }

  getFurnace(dimension: DimensionId, x: number, y: number, z: number): Furnace | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Furnace ? container : undefined;
  }

  getChest(dimension: DimensionId, x: number, y: number, z: number): Chest | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Chest ? container : undefined;
  }

  getOrCreateFurnace(dimension: DimensionId, x: number, y: number, z: number): Furnace {
    const existing = this.getFurnace(dimension, x, y, z);
    if (existing) return existing;
    const furnace = new Furnace();
    this.put({ dimension, x, y, z, container: furnace });
    return furnace;
  }

  getOrCreateChest(dimension: DimensionId, x: number, y: number, z: number): Chest {
    const existing = this.getChest(dimension, x, y, z);
    if (existing) return existing;
    const chest = new Chest();
    this.put({ dimension, x, y, z, container: chest });
    return chest;
  }

  getAnvil(dimension: DimensionId, x: number, y: number, z: number): Anvil | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Anvil ? container : undefined;
  }

  /** 铁砧的两格输入也按坐标存：放下东西走开再回来，东西还在台面上 */
  getOrCreateAnvil(dimension: DimensionId, x: number, y: number, z: number): Anvil {
    const existing = this.getAnvil(dimension, x, y, z);
    if (existing) return existing;
    const anvil = new Anvil();
    this.put({ dimension, x, y, z, container: anvil });
    return anvil;
  }

  getEnchantTable(dimension: DimensionId, x: number, y: number, z: number): EnchantTable | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof EnchantTable ? container : undefined;
  }

  /**
   * 附魔台的容器也按坐标存：玩家把装备与青金石放在台子上走开再回来，东西还在原处
   * （候选槽是每次打开重掷的，所以不存在"走开再回来还是同一批附魔"的问题）。
   */
  getOrCreateEnchantTable(dimension: DimensionId, x: number, y: number, z: number): EnchantTable {
    const existing = this.getEnchantTable(dimension, x, y, z);
    if (existing) return existing;
    const table = new EnchantTable();
    this.put({ dimension, x, y, z, container: table });
    return table;
  }

  /**
   * 酿造台的容器按坐标存：三个药水槽 + 材料 + 燃料放在台上走开再回来，还在原处
   * （与熔炉/附魔台同一个理由——否则"放下材料去拿瓶子"就等于白放）。
   */
  getBrewingStand(dimension: DimensionId, x: number, y: number, z: number): BrewingStand | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof BrewingStand ? container : undefined;
  }

  getOrCreateBrewingStand(dimension: DimensionId, x: number, y: number, z: number): BrewingStand {
    const existing = this.getBrewingStand(dimension, x, y, z);
    if (existing) return existing;
    const stand = new BrewingStand();
    this.put({ dimension, x, y, z, container: stand });
    return stand;
  }

  remove(dimension: DimensionId, x: number, y: number, z: number): void {
    this.entries.delete(BlockEntityStore.key(dimension, x, y, z));
  }

  /** 遍历所有容器（熔炉/酿造台 tick、存档导出都用它） */
  forEach(fn: (container: BlockContainer, x: number, y: number, z: number, dimension: DimensionId) => void): void {
    for (const entry of this.entries.values()) {
      fn(entry.container, entry.x, entry.y, entry.z, entry.dimension);
    }
  }

  /** 某个维度的容器数量（调试与断言用） */
  countIn(dimension: DimensionId): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.dimension === dimension) count++;
    }
    return count;
  }

  get size(): number {
    return this.entries.size;
  }

  /** 卸载区块时清理该区块内所有容器，并返回被清理的内容（由调用方决定是否掉落） */
  removeInChunk(
    dimension: DimensionId,
    chunkX: number,
    chunkZ: number,
    onRemove?: (container: BlockContainer, x: number, y: number, z: number) => void,
  ): void {
    const minX = chunkX * 16;
    const maxX = minX + 15;
    const minZ = chunkZ * 16;
    const maxZ = minZ + 15;

    for (const [key, entry] of [...this.entries]) {
      if (entry.dimension !== dimension) continue;
      if (entry.x < minX || entry.x > maxX || entry.z < minZ || entry.z > maxZ) continue;
      this.entries.delete(key);
      onRemove?.(entry.container, entry.x, entry.y, entry.z);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
