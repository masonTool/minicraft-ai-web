/**
 * 远端方块改动落到本地时的去向判定（联机4）。
 *
 * 为什么需要单独一条判定：服务端的 `block` 广播是不管你视野的——队友在他那边
 * 挖掉一格、改一堆、第 200 格，都会原样发给你。而本地只有"当前维度 + 已加载
 * 区块"能立刻写。原来的写法是 `if (!isLoaded) return`，于是**区块一加载就丢改动**
 * （区块生成是种子重现的，玩家走过去看到的还是没被改过的地形，只有重连能补）。
 *
 * 现在的口径：一律先记进增量表（`world.edits`），区块以后加载时 `World.onGenerated`
 * 会用 `applyTo` 把增量叠回去；只有"同维度 + 已加载"才额外立刻写世界（顺带刷光照与网格）。
 * 不同维度的改动同样只记增量：玩家以后切过去，那批改动自然补上。
 *
 * 越界高度直接丢：`Chunk.index` 对 y 越界会算出别的格子的下标，记进去就是
 * "改了一格不相干的方块"，比丢掉更难查。
 */

import { WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';

/** 收到远端方块改动后该做什么 */
export type RemoteBlockAction =
  /** 同维度且区块已加载：立刻写世界 + 记增量 */
  | 'apply'
  /** 只记增量：等区块加载（或以后切到那个维度）时由 `world.edits.applyTo` 补上 */
  | 'buffer'
  /** y 越界：不记也不写 */
  | 'drop';

export function planRemoteBlock(
  editDimension: string,
  currentDimension: string,
  loaded: boolean,
  y: number,
): RemoteBlockAction {
  // 越界的 y 连"记增量"都不能做：区块内下标会落到别的格子上去
  if (!Number.isFinite(y) || y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return 'drop';
  if (editDimension !== currentDimension) return 'buffer';
  return loaded ? 'apply' : 'buffer';
}

/** 一条远端改动（与协议 `blocks` 数组同形，展开成对象便于阅读） */
export interface RemoteBlockEdit {
  x: number;
  y: number;
  z: number;
  id: number;
  state: number;
  dimension: string;
}

/**
 * 落地时要调用的两件事，**顺序由这里保证**：
 *  · `record`：写进增量表（存档 + 区块以后加载时由 `edits.applyTo` 叠回去）；
 *  · `apply`：立刻写进世界（顺带刷光照/网格，可能触发渲染）。
 *
 * 为什么把顺序收进一个函数：这两个动作的顺序是有语义的——**先记增量再交给渲染**。
 * 反过来的话，"写世界时抛异常 / 区块正好被卸载"这条路径上，改动就只留在内存世界
 * （下一次读档或重进区块就没了）。以前这段顺序写在 `main.onNetBlock` 里，
 * 谁顺手调一下两行就换了位置，改了也不会有测试红。
 */
export interface RemoteBlockSink {
  record(edit: RemoteBlockEdit): void;
  apply(edit: RemoteBlockEdit): void;
}

/**
 * 按 `planRemoteBlock` 的判定落地一条改动。
 *
 * @returns 是否写进了世界（`true` = 立刻可见；`false` = 只记增量等加载 / 被丢弃）
 */
export function applyRemoteBlock(
  action: RemoteBlockAction,
  edit: RemoteBlockEdit,
  sink: RemoteBlockSink,
): boolean {
  if (action === 'drop') return false;
  // ⚠️ 顺序是语义的一部分，别交换（见 `RemoteBlockSink` 的注释）
  sink.record(edit);
  if (action === 'buffer') return false;
  sink.apply(edit);
  return true;
}

/**
 * 把一条 `edit-request` 的载荷读成改动列表（L8 · MS2）。
 *
 * 房主收到的是**别人**发来的东西，形状可能被改过：不是数组、长度不是 6、坐标是字符串、
 * 维度名是垃圾……一律丢那一条，而不是整包丢弃（与 `blocks` 的"坏条目单独丢"同一口径）。
 * 数值范围（y 越界 / 距离）不在这里判——交给 `planRemoteBlock` 与 `blockEditRejection`
 * 那一套，免得两处各判一次、判得还不一样。
 */
export function readEditRequest(payload: { t: string; blocks?: unknown; edit?: unknown }): RemoteBlockEdit[] {
  const raw = payload.t === 'blocks' ? payload.blocks : payload.t === 'block' ? payload.edit : null;
  if (!Array.isArray(raw)) return [];
  // `block` 的载荷是**一条**（`[x,y,z,id,state,dimension]`），`blocks` 是**一组**
  const list: unknown[] = payload.t === 'block' ? [raw] : raw;
  const edits: RemoteBlockEdit[] = [];
  for (const item of list) {
    if (!Array.isArray(item) || item.length < 6) continue;
    const [x, y, z, id, state, dimension] = item as unknown[];
    if (
      typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
      typeof id !== 'number' || typeof state !== 'number' || typeof dimension !== 'string'
    ) {
      continue;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(id) || !Number.isFinite(state)) {
      continue;
    }
    edits.push({ x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z), id: Math.trunc(id), state: Math.trunc(state), dimension });
  }
  return edits;
}
