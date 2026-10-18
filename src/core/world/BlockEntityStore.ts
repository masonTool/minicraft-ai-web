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
import { Barrel } from '../container/Barrel.ts';
import { Chest } from '../container/Chest.ts';
import { Dispenser } from '../container/Dispenser.ts';
import { ShulkerBox } from '../container/ShulkerBox.ts';
import { Dropper } from '../container/Dropper.ts';
import { EnchantTable } from '../container/EnchantTable.ts';
import { Furnace } from '../container/Furnace.ts';
import { Grindstone } from '../container/Grindstone.ts';
import { Lectern } from '../container/Lectern.ts';
import { Hopper } from '../container/Hopper.ts';
import { SmithingTable } from '../container/SmithingTable.ts';
import { Stonecutter } from '../container/Stonecutter.ts';
import { Campfire } from '../container/Campfire.ts';
import { Block } from '../registry/blocks.ts';
import type { FurnaceStation } from '../crafting/Smelting.ts';
import type { DimensionId } from '../gen/Dimension.ts';

export type BlockContainer =
  | Furnace
  | Chest
  | EnchantTable
  | Anvil
  | BrewingStand
  | SmithingTable
  | Stonecutter
  | Campfire
  | Hopper
  | Dropper
  | Dispenser
  | Barrel
  | Grindstone
  | Lectern;
export type ContainerKind =
  | 'furnace'
  | 'chest'
  | 'enchanting'
  | 'anvil'
  | 'brewing'
  | 'smithing'
  | 'stonecutter'
  | 'campfire'
  | 'hopper'
  | 'dropper'
  | 'dispenser'
  | 'barrel'
  | 'shulker_box'
  | 'grindstone'
  | 'lectern';

/**
 * **带方块实体的方块**（= 装得下东西的方块）的 id 名单。
 *
 * 存在的理由：原版里"活塞推不动任何带方块实体的方块"，而本项目的容器是**按坐标**
 * 存在 `BlockEntityStore` 里的——活塞把箱子推走一格，箱子那一格的容器还留在原地，
 * 表现就是"推一下箱子，里面的钻石全没了"。所以 `canPush` 要认得出这些方块
 * （批次 59 补上；在此之前只有箱子/熔炉/漏斗/投掷器以外的判断——投掷器因为形状不是
 * `cube` 而碰巧推不动，其余几个则一直能被推走）。
 *
 * ⚠️ **加新的容器方块时，这里必须补一行**（另一处是 main 的 `containerOfBlockAt`）。
 * 漏了的表现是"活塞把一整箱东西推到隔壁，箱子空了"——静默、且不可逆。
 */
export const CONTAINER_BLOCKS: ReadonlySet<number> = new Set<number>([
  Block.CHEST,
  Block.HOPPER,
  Block.DROPPER,
  Block.DISPENSER,
  // 堆肥桶（批次 70）：内容物是个**等级**、不是物品栏，所以推走其实不会丢东西
  // （推方块时会连状态一起搬）。列进来是为了对齐原版（带方块实体的方块推不动），
  // 也免得以后有人以为"它能推"是个疏漏
  Block.COMPOSTER,
  // 末影箱（批次 71）：内容是**玩家的**、不在这格方块上，推走其实不会丢东西；
  // 列进来对齐原版（带方块实体的方块推不动），也免得以后被当成疏漏
  Block.ENDER_CHEST,
  // 潜影盒（批次 72）：内容在方块上（被挖走时才进物品），所以活塞一样推不动
  Block.SHULKER_BOX,
  Block.BARREL,
  Block.BREWING_STAND,
  Block.ANVIL,
  Block.SMITHING_TABLE,
  Block.STONECUTTER,
  // 砂轮（批次 188）：两格输入按坐标存（与铁砧同一个理由），所以活塞一样推不动
  Block.GRINDSTONE,
  // 讲台（批次 191）：摊在上面的那本书按坐标存（推走就等于把书弄丢）
  Block.LECTERN,
  Block.ENCHANTING_TABLE,
  Block.CAMPFIRE,
  // 三种炉子：站台不同，但都是按坐标存着的容器
  Block.FURNACE,
  Block.SMOKER,
  Block.BLAST_FURNACE,
]);

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

  /**
   * 取出（或新建）炉子。
   *
   * `station` 只影响**新建**：已经存在的实例保留它自己的站台——这一个入口同时服务
   * 熔炉/烟熏炉/高炉三种方块，而站台是"这台炉子是什么"的一部分，
   * 不该被"谁最后点了它一下"改写（读档恢复站台也是走这条路）。
   */
  getOrCreateFurnace(
    dimension: DimensionId,
    x: number,
    y: number,
    z: number,
    station: FurnaceStation = 'furnace',
  ): Furnace {
    const existing = this.getFurnace(dimension, x, y, z);
    if (existing) return existing;
    const furnace = new Furnace(station);
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

  getSmithingTable(dimension: DimensionId, x: number, y: number, z: number): SmithingTable | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof SmithingTable ? container : undefined;
  }

  /** 锻造台的两格输入也按坐标存（与铁砧同一个理由：放下东西走开再回来还在台面上） */
  getOrCreateSmithingTable(dimension: DimensionId, x: number, y: number, z: number): SmithingTable {
    const existing = this.getSmithingTable(dimension, x, y, z);
    if (existing) return existing;
    const table = new SmithingTable();
    this.put({ dimension, x, y, z, container: table });
    return table;
  }

  getEnchantTable(dimension: DimensionId, x: number, y: number, z: number): EnchantTable | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof EnchantTable ? container : undefined;
  }

  getStonecutter(dimension: DimensionId, x: number, y: number, z: number): Stonecutter | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Stonecutter ? container : undefined;
  }

  getCampfire(dimension: DimensionId, x: number, y: number, z: number): Campfire | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Campfire ? container : undefined;
  }

  /**
   * 取出（或新建）营火。
   *
   * ⚠️ 新建时**默认是点燃的**（原版放下就是点着的营火），
   * 但已经存在的实例保留自己的 `lit` —— 熄灭过的营火重新打开界面不该自己又烧起来。
   */
  getOrCreateCampfire(dimension: DimensionId, x: number, y: number, z: number): Campfire {
    const existing = this.getCampfire(dimension, x, y, z);
    if (existing) return existing;
    const campfire = new Campfire();
    this.put({ dimension, x, y, z, container: campfire });
    return campfire;
  }

  /** 切石机的输入格也按坐标存（与铁砧/锻造台同一个理由） */
  getOrCreateStonecutter(dimension: DimensionId, x: number, y: number, z: number): Stonecutter {
    const existing = this.getStonecutter(dimension, x, y, z);
    if (existing) return existing;
    const cutter = new Stonecutter();
    this.put({ dimension, x, y, z, container: cutter });
    return cutter;
  }

  getGrindstone(dimension: DimensionId, x: number, y: number, z: number): Grindstone | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Grindstone ? container : undefined;
  }

  /**
   * 砂轮的两格输入也按坐标存（H15，批次 188）：
   * 把附魔剑放上去走开再回来，东西还在轮子上——与铁砧/锻造台同一个理由。
   */
  getOrCreateGrindstone(dimension: DimensionId, x: number, y: number, z: number): Grindstone {
    const existing = this.getGrindstone(dimension, x, y, z);
    if (existing) return existing;
    const grindstone = new Grindstone();
    this.put({ dimension, x, y, z, container: grindstone });
    return grindstone;
  }

  getLectern(dimension: DimensionId, x: number, y: number, z: number): Lectern | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Lectern ? container : undefined;
  }

  /**
   * 讲台上摊着的那本书也按坐标存（批次 191，J25）：
   * 放一本书走开再回来，书还在台上、还翻在同一页——与铁砧/砂轮同一个理由。
   */
  getOrCreateLectern(dimension: DimensionId, x: number, y: number, z: number): Lectern {
    const existing = this.getLectern(dimension, x, y, z);
    if (existing) return existing;
    const lectern = new Lectern();
    this.put({ dimension, x, y, z, container: lectern });
    return lectern;
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

  getHopper(dimension: DimensionId, x: number, y: number, z: number): Hopper | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Hopper ? container : undefined;
  }

  /**
   * 取出（或新建）漏斗。
   *
   * ⚠️ 与其它容器不同：漏斗**必须在放下方块时就把容器建出来**
   * （见 main 的放置收尾）。原因有两个：
   *  1. tick 循环是按容器表推的——没建容器就没有任何东西在搬运；
   *  2. 另一个漏斗要往它里面推东西时，得先"看得到"它。
   */
  getOrCreateHopper(dimension: DimensionId, x: number, y: number, z: number): Hopper {
    const existing = this.getHopper(dimension, x, y, z);
    if (existing) return existing;
    const hopper = new Hopper();
    this.put({ dimension, x, y, z, container: hopper });
    return hopper;
  }

  getDropper(dimension: DimensionId, x: number, y: number, z: number): Dropper | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Dropper ? container : undefined;
  }

  /**
   * 取出（或新建）投掷器。
   *
   * ⚠️ 与漏斗的差别：投掷器**不靠容器表自己动**（它是红石上升沿推一下），
   * 所以"空投掷器没进容器表"不会让它停摆——主程序在信号来的时候按需创建即可。
   * 这里仍然提供 getOrCreate，是给"放下方块/界面/断言"三处一个统一入口。
   */
  getOrCreateDropper(dimension: DimensionId, x: number, y: number, z: number): Dropper {
    const existing = this.getDropper(dimension, x, y, z);
    if (existing) return existing;
    const dropper = new Dropper();
    this.put({ dimension, x, y, z, container: dropper });
    return dropper;
  }

  getDispenser(dimension: DimensionId, x: number, y: number, z: number): Dispenser | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Dispenser ? container : undefined;
  }

  /**
   * 取出（或新建）发射器。
   *
   * ⚠️ 与投掷器一样是"放下方块时就建、信号来了直接取"（它也不靠容器表 tick）。
   * 注意 `getDropper` 用 `instanceof Dropper`，**发射器是它的子类所以也认**——
   * 这就是"加子类不会漏掉任何一处按 Dropper 判定的地方"的来源。
   */
  getOrCreateDispenser(dimension: DimensionId, x: number, y: number, z: number): Dispenser {
    const existing = this.getDispenser(dimension, x, y, z);
    if (existing) return existing;
    const dispenser = new Dispenser();
    this.put({ dimension, x, y, z, container: dispenser });
    return dispenser;
  }

  getBarrel(dimension: DimensionId, x: number, y: number, z: number): Barrel | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof Barrel ? container : undefined;
  }

  /**
   * 取出（或新建）木桶。
   *
   * ⚠️ 木桶与箱子一样是**打开界面时按需创建**的（它不 tick、也不靠容器表推进），
   * 所以放下时不必建：`getOrCreateBarrel` 会在"右键"与"别的容器往它里面塞东西"时被调到。
   */
  getOrCreateBarrel(dimension: DimensionId, x: number, y: number, z: number): Barrel {
    const existing = this.getBarrel(dimension, x, y, z);
    if (existing) return existing;
    const barrel = new Barrel();
    this.put({ dimension, x, y, z, container: barrel });
    return barrel;
  }

  getShulkerBox(dimension: DimensionId, x: number, y: number, z: number): ShulkerBox | undefined {
    const container = this.get(dimension, x, y, z);
    return container instanceof ShulkerBox ? container : undefined;
  }

  /**
   * 取出（或新建）潜影盒。
   *
   * ⚠️ 与箱子/木桶一样是**打开界面时按需创建**的；放下方块时也会建一个
   * （因为物品里可能带着内容，见 `main` 的放置路径）。
   */
  getOrCreateShulkerBox(dimension: DimensionId, x: number, y: number, z: number): ShulkerBox {
    const existing = this.getShulkerBox(dimension, x, y, z);
    if (existing) return existing;
    const box = new ShulkerBox();
    this.put({ dimension, x, y, z, container: box });
    return box;
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
