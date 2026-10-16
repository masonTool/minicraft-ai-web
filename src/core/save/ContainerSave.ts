/**
 * 容器内容的存档序列化（C7 尾巴）
 *
 * `BlockEntityStore` 的文件头一直写着"关卡存档接入时，这里就是序列化的入口"，
 * 但**从来没接**——存档只存了 meta / player / 方块增量，于是箱子、熔炉、附魔台、
 * 铁砧、酿造台里的东西**一关页面就没了**。这不是"少个功能"，而是"玩家的东西凭空消失"，
 * 所以单独一个文件、单独一批把它补上。
 *
 * 三条设计约束：
 *  1. **纯函数、不碰 IndexedDB**：导出的就是普通对象（ItemStack 本身已经是为了进存档
 *     才写成普通对象的，见 `Inventory.ts` 的注解），所以能离线断言往返一致。
 *  2. **完全空的容器不写**：一次玩法能攒出成百上千个"打开过又空着"的容器，
 *     全写进去只会让存档白白变大；读档时它们就是一个不存在、按需新建的容器。
 *  3. **读档时对脏数据逐项跳过**：未知种类、槽位数不符、物品 id 在注册表里不存在
 *     （物品被删过的旧存档）——任何一种都不该让整箱东西被吞掉，更不该抛异常把游戏卡住。
 */

import { CHEST_SIZE, Chest } from '../container/Chest.ts';
import { FURNACE_SIZE, Furnace } from '../container/Furnace.ts';
import type { FurnaceStation } from '../crafting/Smelting.ts';
import { ANVIL_SIZE, Anvil } from '../container/Anvil.ts';
import { EnchantTable } from '../container/EnchantTable.ts';
import { BREW_SLOT_COUNT, BrewingStand } from '../container/BrewingStand.ts';
import { SMITHING_SIZE, SmithingTable } from '../container/SmithingTable.ts';
import { STONECUTTER_SIZE, Stonecutter } from '../container/Stonecutter.ts';
import { CAMPFIRE_SIZE, Campfire } from '../container/Campfire.ts';
import { DROPPER_SIZE, Dropper } from '../container/Dropper.ts';
import { HOPPER_SIZE, Hopper } from '../container/Hopper.ts';
import type { ItemStack } from '../container/Inventory.ts';
import { itemDef } from '../registry/items.ts';
import { Dimension, isDimension, type DimensionId } from '../gen/Dimension.ts';
import type { BlockContainer, BlockEntityStore, ContainerKind } from '../world/BlockEntityStore.ts';

/** 附魔台只有两格（装备 + 青金石），所以没有单独的常量 */
export const ENCHANT_SLOT_COUNT = 2;

/** 每种容器的槽位数（读档时按它截断/补齐） */
export const SLOT_COUNTS: Readonly<Record<ContainerKind, number>> = {
  chest: CHEST_SIZE,
  furnace: FURNACE_SIZE,
  enchanting: ENCHANT_SLOT_COUNT,
  anvil: ANVIL_SIZE,
  brewing: BREW_SLOT_COUNT,
  smithing: SMITHING_SIZE,
  stonecutter: STONECUTTER_SIZE,
  campfire: CAMPFIRE_SIZE,
  hopper: HOPPER_SIZE,
  dropper: DROPPER_SIZE,
};

export interface SerializedContainer {
  kind: ContainerKind;
  /** 维度（键的一部分：三个维度的坐标会重叠，见 `BlockEntityStore` 的文件头） */
  dimension: DimensionId;
  x: number;
  y: number;
  z: number;
  /** 与 `SLOT_COUNTS[kind]` 等长；空格为 null */
  stacks: (ItemStack | null)[];
  /** 熔炉的运转状态（燃烧剩余时长、烧炼进度、攒下的经验） */
  furnace?: {
    burnTimeLeft: number;
    burnTimeTotal: number;
    cookProgress: number;
    cookTimeTotal: number;
    storedExperience: number;
    /**
     * 这是哪一种炉子（批次 46）。**旧存档没有这个字段**，缺省按普通熔炉读
     * （烟熏炉与高炉是这一批才有的方块，老存档里不可能存在需要它们的容器）。
     */
    station?: FurnaceStation;
  };
  /** 营火的运转状态（点没点着、每格的进度） */
  campfire?: {
    lit: boolean;
    /** 4 格的进度秒数（总耗时由配方算出来，所以不存） */
    progress: number[];
  };
  /** 酿造台的运转状态（燃料还能酿几次、当前进度） */
  brewing?: {
    fuelLeft: number;
    brewProgress: number;
  };
  /**
   * 箱子的"已被战利品表填过"标记。
   * 少写这一个布尔值的后果是"掏空的结构箱会自己长回来"（无限刷矿物），见 `Chest#looted`。
   */
  chest?: {
    looted: boolean;
  };
}

/** 容器实例 → 种类 */
export function kindOf(container: BlockContainer): ContainerKind {
  if (container instanceof Chest) return 'chest';
  if (container instanceof Furnace) return 'furnace';
  if (container instanceof EnchantTable) return 'enchanting';
  if (container instanceof Anvil) return 'anvil';
  if (container instanceof SmithingTable) return 'smithing';
  if (container instanceof Stonecutter) return 'stonecutter';
  if (container instanceof Campfire) return 'campfire';
  if (container instanceof Hopper) return 'hopper';
  if (container instanceof Dropper) return 'dropper';
  return 'brewing';
}

/** 按种类新建/取出容器（与 `BlockEntityStore` 的 getOrCreate* 一一对应） */
function containerFor(
  store: BlockEntityStore,
  kind: ContainerKind,
  dimension: DimensionId,
  x: number,
  y: number,
  z: number,
): BlockContainer {
  if (kind === 'chest') return store.getOrCreateChest(dimension, x, y, z);
  if (kind === 'furnace') return store.getOrCreateFurnace(dimension, x, y, z);
  if (kind === 'enchanting') return store.getOrCreateEnchantTable(dimension, x, y, z);
  if (kind === 'anvil') return store.getOrCreateAnvil(dimension, x, y, z);
  if (kind === 'smithing') return store.getOrCreateSmithingTable(dimension, x, y, z);
  if (kind === 'stonecutter') return store.getOrCreateStonecutter(dimension, x, y, z);
  if (kind === 'campfire') return store.getOrCreateCampfire(dimension, x, y, z);
  if (kind === 'hopper') return store.getOrCreateHopper(dimension, x, y, z);
  if (kind === 'dropper') return store.getOrCreateDropper(dimension, x, y, z);
  return store.getOrCreateBrewingStand(dimension, x, y, z);
}

/** 存/读档里的站台字段是不是三个已知值之一 */
function isFurnaceStation(value: unknown): value is FurnaceStation {
  return value === 'furnace' || value === 'smoker' || value === 'blast_furnace';
}

/** 深拷贝一个栈（存档要的是快照，不能与背包里那个对象共用引用） */
function cloneStack(stack: ItemStack): ItemStack {
  const copy: ItemStack = { id: stack.id, count: stack.count };
  if (stack.damage !== undefined) copy.damage = stack.damage;
  if (stack.enchants !== undefined) copy.enchants = { ...stack.enchants };
  if (stack.name !== undefined) copy.name = stack.name;
  return copy;
}

/** 这个栈是不是还能用（id 必须还认得出来；数量至少 1） */
function isValidStack(stack: unknown): stack is ItemStack {
  if (!stack || typeof stack !== 'object') return false;
  const candidate = stack as Partial<ItemStack>;
  if (typeof candidate.id !== 'number' || typeof candidate.count !== 'number') return false;
  if (candidate.count <= 0) return false;
  // 物品被删过的旧存档：留着这个 id 只会让"背包里出现一件空白"，直接丢掉
  return itemDef(candidate.id) !== undefined;
}

function isEmptySlot(stack: ItemStack | null): boolean {
  return stack === null || stack.count <= 0;
}

/** 容器里有没有东西（含机器状态）——空的容器不写进存档 */
function hasContent(container: BlockContainer, kind: ContainerKind): boolean {
  const count = SLOT_COUNTS[kind];
  for (let i = 0; i < count; i++) {
    if (!isEmptySlot(container.get(i))) return true;
  }
  // 被战利品表填过的箱子：即使被玩家掏空了也必须写下来，
  // 否则读档后它会被当成"还没填过"，再走进一次填充逻辑 → 箱子自己长回来（无限刷矿物）
  if (container instanceof Chest && container.looted) return true;
  // 漏斗（批次 58）：**空的也必须写**。tick 循环是按容器表推的——
  // 空漏斗不写进存档，读档后它就不在表里，于是"漏斗链"整条静默停摆
  // （方块还在、看着没坏，就是不搬东西）。数量最多是玩家放的漏斗个数，代价可忽略。
  if (container instanceof Hopper) return true;
  // ⚠️ 投掷器（批次 59）**不需要**上面那条特批：它不被容器表驱动（红石上升沿才吐），
  // 空投掷器不写进存档也不会停摆——信号来时 `getOrCreateDropper` 按需建一个空的即可。
  // 这一行是"故意的缺席"，写在这里免得以后有人照着漏斗抄一遍。
  if (container instanceof Furnace) {
    // 只烧了一半的熔炉即使原料被拿走、也要把"燃烧剩余"留住，否则重新点火的节奏会抖
    return container.burnTimeLeft > 0 || container.cookProgress > 0 || container.storedExperience > 0;
  }
  if (container instanceof Campfire) {
    // 熄灭的营火里只要还有东西，也要写下来（否则读档后"架上的生肉"会消失）
    return container.lit === false;
  }
  if (container instanceof BrewingStand) {
    return container.brewProgress > 0 || container.fuelLeft > 0;
  }
  return false;
}

/** 把一个容器导成可存档的普通对象；没有内容时返回 null（不必写进存档） */
export function serializeContainer(
  container: BlockContainer,
  dimension: DimensionId,
  x: number,
  y: number,
  z: number,
): SerializedContainer | null {
  const kind = kindOf(container);
  if (!hasContent(container, kind)) return null;

  const count = SLOT_COUNTS[kind];
  const stacks: (ItemStack | null)[] = [];
  for (let i = 0; i < count; i++) {
    const stack = container.get(i);
    stacks.push(isEmptySlot(stack) ? null : cloneStack(stack as ItemStack));
  }

  const data: SerializedContainer = { kind, dimension, x, y, z, stacks };
  if (container instanceof Furnace) {
    data.furnace = {
      burnTimeLeft: container.burnTimeLeft,
      burnTimeTotal: container.burnTimeTotal,
      cookProgress: container.cookProgress,
      cookTimeTotal: container.cookTimeTotal,
      storedExperience: container.storedExperience,
      station: container.station,
    };
  }
  if (container instanceof Campfire) {
    data.campfire = { lit: container.lit, progress: [...container.progressSeconds] };
  }
  if (container instanceof BrewingStand) {
    data.brewing = { fuelLeft: container.fuelLeft, brewProgress: container.brewProgress };
  }
  if (container instanceof Chest) {
    data.chest = { looted: container.looted };
  }
  return data;
}

/** 把整个容器表的非空内容导出来 */
export function serializeContainers(store: BlockEntityStore): SerializedContainer[] {
  const out: SerializedContainer[] = [];
  store.forEach((container, x, y, z, dimension) => {
    const data = serializeContainer(container, dimension, x, y, z);
    if (data) out.push(data);
  });
  return out;
}

/**
 * 把存档里的容器还原回世界。
 * @returns 实际还原的容器数量（脏数据会被跳过，所以可能小于输入长度）
 */
export function restoreContainers(store: BlockEntityStore, data: readonly SerializedContainer[] | undefined): number {
  // ⚠️ `Array.isArray` 会把 `readonly T[]` 窄化成 `any[]`，所以这里显式收回类型：
  // 存档是外部数据，运行时确实可能是别的形状（旧版本、手改过的库）
  const list: readonly SerializedContainer[] = Array.isArray(data) ? (data as readonly SerializedContainer[]) : [];

  let restored = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const kind = entry.kind;
    if (!(kind in SLOT_COUNTS)) continue;
    if (typeof entry.x !== 'number' || typeof entry.y !== 'number' || typeof entry.z !== 'number') continue;
    // 旧存档没有维度字段：回退主世界（这是本批新加的字段，正常只会在测试数据里缺）
    const dimension: DimensionId = isDimension(entry.dimension) ? entry.dimension : Dimension.OVERWORLD;

    const container = containerFor(store, kind, dimension, entry.x, entry.y, entry.z);
    const count = SLOT_COUNTS[kind];
    const stacks = Array.isArray(entry.stacks) ? entry.stacks : [];
    for (let i = 0; i < count; i++) {
      const stack = stacks[i];
      container.set(i, isValidStack(stack) ? cloneStack(stack) : null);
    }

    if (container instanceof Furnace && entry.furnace) {
      const state = entry.furnace;
      // 逐项校验：旧存档少字段、或者手改坏了，都不该变成 NaN
      container.burnTimeLeft = numberOr(state.burnTimeLeft, 0);
      container.burnTimeTotal = numberOr(state.burnTimeTotal, 0);
      container.cookProgress = numberOr(state.cookProgress, 0);
      container.cookTimeTotal = numberOr(state.cookTimeTotal, 0);
      container.storedExperience = numberOr(state.storedExperience, 0);
      // 站台必须是三个已知值之一：外部数据里写了个乱七八糟的字符串时回退成普通熔炉，
      // 而不是让 `FURNACE_STATIONS[station]` 在 tick 里变成 undefined 再炸掉
      container.station = isFurnaceStation(state.station) ? state.station : 'furnace';
    }
    if (container instanceof Campfire) {
      container.lit = entry.campfire?.lit !== false; // 旧存档/缺字段 → 点着（原版放下就是着着的）
      const progress = Array.isArray(entry.campfire?.progress) ? entry.campfire!.progress : [];
      for (let i = 0; i < CAMPFIRE_SIZE; i++) container.setProgress(i, numberOr(progress[i], 0));
      // 总耗时是由配方推出来的，读档后重算一次（进度条立刻就是对的）
      container.refreshTotals();
    }
    if (container instanceof BrewingStand && entry.brewing) {
      container.fuelLeft = numberOr(entry.brewing.fuelLeft, 0);
      container.brewProgress = numberOr(entry.brewing.brewProgress, 0);
    }
    if (container instanceof Chest) {
      // 旧存档没有这个字段：缺省 false 是安全的（那只箱子本来就还没被战利品表填过）
      container.looted = entry.chest?.looted === true;
    }

    restored++;
  }
  return restored;
}

/** 有限数字兜底（NaN / Infinity / undefined 一律回退） */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
