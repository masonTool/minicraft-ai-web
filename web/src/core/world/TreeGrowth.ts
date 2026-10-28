/**
 * 树苗长成树（批次 75，B47）：把"区块生成时造树"那一套搬到**活世界**里。
 *
 * 做法不是重写一遍树的形状，而是**换一支 writer**：`Features.ts` 里 11 个树种的长法
 * （橡木/白桦/云杉/丛林/金合欢/深色橡木…）早就写好了，它们只要求 writer 提供
 * `put` / `putState` / `fill` / `fillDown` / `groundAbove` / `owns` / `get`（见 `TreeWriter`）。
 * 这里实现的就是"写进活世界"的那一支：
 *
 *  - 写方块走 `setBlockAndUpdate`（光照与网格跟着更新、也会进增量存档）；
 *  - **把写过的每一格记下来**（`changes`）：树是几十格一起变的，联机要把这些格子
 *    广播给队友——只广播"树苗那一格"的话，队友那边看到的是一棵**没长出来的树**；
 *  - `owns` 恒为 true（区块生成里那个判据是为了裁掉写到邻居的部分，活世界没有这回事）。
 *
 * ⚠️ 与区块生成的一处必要差别：**先把树苗那一格清成空气**。树的落点是"这一列地表之上
 * 第一格"（`groundAbove`），而树苗自己正占着那一格——不清掉的话树会长高一格，
 * 表现是"树苗长成的树悬在半空"。
 */

import {
  OUTSIDE,
  isReplaceable,
  plantTreeInto,
  type FeatureWorld,
  type TreeWriter,
} from '../gen/Features.ts';
import type { BiomeDef } from '../gen/Biome.ts';
import type { TreeKind } from '../gen/Features.ts';
import { Block } from '../registry/blocks.ts';
import { woodFor } from '../gen/Features.ts';

/** 种树只需要"读一格、写一格"，外加（可选）查一下群系 */
export interface TreeWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, blockId: number, state?: number): void;
  /** 活世界的群系查询（`OverworldGenerator` 有现成的）；不提供时树长得出来，但**用不到群系的树种**才安全 */
  columnBiome?(x: number, z: number): BiomeDef;
}

/** 一次种树改动了哪些格子（联机广播与断言都用它） */
export interface TreeChange {
  x: number;
  y: number;
  z: number;
  blockId: number;
  state: number;
  /**
   * **想写但写不下去**（那一格被实心方块占着）。
   *
   * 只有在**空跑**那一遍里才会出现：真写那一遍遇到它就直接跳过（`put`/`fill` 返回 false）。
   * 它存在的意义是让"树干列被挡住"这件事**看得见**——不然空跑的结果与真写一样"少了几格"，
   * 根本分不出"这里本来就该是空气"还是"这里被挡住了"。
   */
  blocked?: boolean;
}

/** 把树的写入落到活世界上，并记下每一格 */
class LiveTreeWriter implements TreeWriter {
  readonly changes: TreeChange[] = [];

  constructor(
    private readonly world: TreeWorld,
    /** 树苗下面那一格的 y（树的"地面"） */
    private readonly baseY: number,
    /**
     * 空跑：只把"会写什么"记下来、**一个方块都不动**。
     *
     * 用途是"先看看长出来是什么样，再决定要不要长"：树干那一列如果被挡住，
     * 真写下去会让树冠**浮在半空**（树干被拦、树冠照旧落在空气里，看起来像一棵悬空的树）。
     * 空跑一遍拿到清单、确认树干都放得下，再用同一个随机盐真写一遍——两次结果**逐格一致**
     * （计划器用的是位置决定论随机：`PositionalRng(x, z, salt)`）。
     */
    private readonly dryRun = false,
  ) {}

  get(x: number, y: number, z: number): number {
    return this.world.getBlock(x, y, z);
  }

  owns(): boolean {
    return true;
  }

  groundAbove(_world: FeatureWorld, _x: number, _z: number): number {
    return this.baseY + 1;
  }

  put(x: number, y: number, z: number, id: number): boolean {
    if (y <= -64) return false;
    const current = this.get(x, y, z);
    // 与生成时同一条判据：只盖空气与"可替换"的植物，绝不挖穿地形
    if (current !== OUTSIDE && !isReplaceable(current)) {
      if (this.dryRun) this.changes.push({ x, y, z, blockId: id, state: 0, blocked: true });
      return false;
    }
    return this.fill(x, y, z, id);
  }

  putState(x: number, y: number, z: number, id: number, state: number): boolean {
    const current = this.get(x, y, z);
    if (current !== OUTSIDE && !isReplaceable(current)) return false;
    if (!this.dryRun) this.world.setBlock(x, y, z, id, state);
    this.changes.push({ x, y, z, blockId: id, state });
    return true;
  }

  /**
   * 写一格（树干用 `fill`：生成时它是**强制写入**的，不看里面原本是什么）。
   *
   * ⚠️ 活世界这条路**要拦一道**：不拦的话，在石头天花板下种树会**凿穿石头**长出一柱原木
   * （生成时不存在这个问题——那里本来是刚生成的空气）。拦下之后的代价是
   * "拥挤处的树会被削掉一部分"（原版是干脆不长），这条差异记在 TASKS B47。
   */
  fill(x: number, y: number, z: number, id: number): boolean {
    const current = this.get(x, y, z);
    if (current !== OUTSIDE && !isReplaceable(current)) {
      if (this.dryRun) this.changes.push({ x, y, z, blockId: id, state: 0, blocked: true });
      return false;
    }
    if (!this.dryRun) this.world.setBlock(x, y, z, id, 0);
    this.changes.push({ x, y, z, blockId: id, state: 0 });
    return true;
  }

  fillDown(x: number, y: number, z: number, id: number, depth = 3): void {
    for (let i = 0; i < depth; i++) {
      const current = this.get(x, y - i, z);
      if (current === OUTSIDE) continue;
      if (current === Block.AIR || isReplaceable(current)) {
        this.fill(x, y - i, z, id);
        continue;
      }
      break;
    }
  }
}

/**
 * 让一格树苗长成一棵树。
 *
 * @param saplingId 树苗那一格的方块 id（长不出来时要**放回去**，所以得知道是哪种树苗）
 * @param salt 随机盐（同一格重复种会长出不同的树；调用方用位置或世界随机数都行）
 * @returns 改动过的格子清单；`null` = **没长出来**（树苗原样放回，调用方**不消耗**骨粉）
 */
export function growTreeAt(
  world: TreeWorld,
  x: number,
  y: number,
  z: number,
  saplingId: number,
  kind: TreeKind,
  salt = 1,
): TreeChange[] | null {
  // ① 先清掉树苗自己（见文件头：不清的话树会长高一格、悬在半空）
  world.setBlock(x, y, z, Block.AIR, 0);

  // ② 先空跑一遍：树干那一列放不下就干脆不长（避免"树干被拦、树冠浮在半空"）
  const preview = new LiveTreeWriter(world, y - 1, true);
  plantTreeInto(preview, treeFeatureWorld(world, y - 1), kind, x, z, salt);

  const blocked = preview.changes.some((change) => change.blocked === true && change.blockId === logIdFor(kind));
  if (preview.changes.length === 0 || blocked) {
    world.setBlock(x, y, z, saplingId, 0);
    return null;
  }

  // ③ 真写一遍（同一个盐 → 与空跑的结果逐格一致）
  const writer = new LiveTreeWriter(world, y - 1, false);
  plantTreeInto(writer, treeFeatureWorld(world, y - 1), kind, x, z, salt);
  return writer.changes;
}

/**
 * 种树要的 `FeatureWorld`（计划器只用它的 `groundAbove`，而落点已经由 writer 定死了）。
 *
 * ⚠️ `columnBiome` **故意抛错**：现有树种的计划器都不看群系，真有人加了"按群系长不一样"
 * 的树时，这里会立刻炸出来——比悄悄拿一个默认群系长出错误的树形状好得多。
 */
function treeFeatureWorld(world: TreeWorld, baseY: number): FeatureWorld {
  return {
    surfaceY: () => baseY,
    columnBiome: (x: number, z: number) => {
      const biome = world.columnBiome?.(x, z);
      if (!biome) throw new Error('种树用到了群系查询，但这个世界没有提供 columnBiome');
      return biome;
    },
  };
}

/** 这种树的"原木"是哪个方块（空跑时用来挑出"树干那一列"） */
function logIdFor(kind: TreeKind): number {
  return woodFor(kind).log;
}
