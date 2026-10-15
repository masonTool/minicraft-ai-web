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
import { ANVIL_SIZE, Anvil } from '../container/Anvil.ts';
import { EnchantTable } from '../container/EnchantTable.ts';
import { BREW_SLOT_COUNT, BrewingStand } from '../container/BrewingStand.ts';
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
  };
  /** 酿造台的运转状态（燃料还能酿几次、当前进度） */
  brewing?: {
    fuelLeft: number;
    brewProgress: number;
  };
}

/** 容器实例 → 种类 */
export function kindOf(container: BlockContainer): ContainerKind {
  if (container instanceof Chest) return 'chest';
  if (container instanceof Furnace) return 'furnace';
  if (container instanceof EnchantTable) return 'enchanting';
  if (container instanceof Anvil) return 'anvil';
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
  return store.getOrCreateBrewingStand(dimension, x, y, z);
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
  if (container instanceof Furnace) {
    // 只烧了一半的熔炉即使原料被拿走、也要把"燃烧剩余"留住，否则重新点火的节奏会抖
    return container.burnTimeLeft > 0 || container.cookProgress > 0 || container.storedExperience > 0;
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
    };
  }
  if (container instanceof BrewingStand) {
    data.brewing = { fuelLeft: container.fuelLeft, brewProgress: container.brewProgress };
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
    }
    if (container instanceof BrewingStand && entry.brewing) {
      container.fuelLeft = numberOr(entry.brewing.fuelLeft, 0);
      container.brewProgress = numberOr(entry.brewing.brewProgress, 0);
    }

    restored++;
  }
  return restored;
}

/** 有限数字兜底（NaN / Infinity / undefined 一律回退） */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
