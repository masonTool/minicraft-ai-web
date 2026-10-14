/**
 * 体素 A* 寻路
 *
 * 生物要在方块世界里绕开障碍、跳上一格台阶、从不超过 3 格的高度跳下去，
 * 所以搜索的"节点"不是任意格子，而是**可站立位置**：
 * 脚下是实心方块，且身体所占的 1~2 格空间是通行的。
 *
 * 邻接代价做了与原版近似的手感加权：
 *   水平 1、斜向 1.414、向上跳 +0.6、向下落每格 +0.4
 * 这样生物会优先走平地、其次绕路，最后才选择跳跃或跳崖。
 *
 * 该模块不依赖 DOM，也不依赖 World 具体类型（只要求一个 getBlock），
 * 方便离线测试与在 Worker/主线程两处复用。
 */

import { blockDef } from '../registry/blocks.ts';

export interface BlockSampler {
  getBlock(x: number, y: number, z: number): number;
}

export interface PathPoint {
  x: number;
  y: number;
  z: number;
}

export interface PathOptions {
  /** 生物高度占的格数：1 给鸡这类矮生物，其余用 2 */
  heightBlocks?: number;
  /** 允许的最大下落格数 */
  maxFall?: number;
  /** 单次搜索扩展的最大节点数（防止极端地形下卡住） */
  maxNodes?: number;
}

const WORLD_BOTTOM = -64;

/** 8 个水平方向（先四正后四斜） */
const HORIZONTAL: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

interface SearchNode {
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  parent: SearchNode | null;
}

interface Neighbor {
  x: number;
  y: number;
  z: number;
  cost: number;
}

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** 欧氏距离 + 高度差惩罚（与原版一样用可采纳的启发式，保证 A* 最优性） */
function heuristic(x: number, y: number, z: number, goal: PathPoint): number {
  const dx = Math.abs(x - goal.x);
  const dz = Math.abs(z - goal.z);
  const dy = Math.abs(y - goal.y);
  // 八向移动的经典下界
  return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz) + dy * 0.8;
}

export class Pathfinder {
  private readonly neighborBuffer: Neighbor[] = [];

  constructor(private readonly world: BlockSampler) {}

  private isSolid(x: number, y: number, z: number): boolean {
    if (y < WORLD_BOTTOM) return true;
    return blockDef(this.world.getBlock(x, y, z)).solid;
  }

  private isPassable(x: number, y: number, z: number, height: number): boolean {
    for (let i = 0; i < height; i++) {
      if (this.isSolid(x, y + i, z)) return false;
    }
    return true;
  }

  /** 该位置能否站立：脚下有实心支撑，且身体空间通行 */
  canStandAt(x: number, y: number, z: number, height = 2): boolean {
    if (!this.isSolid(x, y - 1, z)) return false;
    return this.isPassable(x, y, z, height);
  }

  /**
   * 把任意坐标吸附到最近的可站立位置（先向上找，再向下找）。
   * 玩家/生物常常悬空（骑乘、被击退、站在树叶上），范围给到 ±6 格够用。
   */
  snapToGround(x: number, y: number, z: number, height = 2): PathPoint | null {
    for (let dy = 0; dy <= 6; dy++) {
      if (this.canStandAt(x, y + dy, z, height)) return { x, y: y + dy, z };
      if (dy > 0 && this.canStandAt(x, y - dy, z, height)) return { x, y: y - dy, z };
    }
    return null;
  }

  /**
   * 搜索从 (sx,sy,sz) 到 (tx,ty,tz) 的路径。
   * @returns 不含起点的路径点数组；不可达时返回 null
   */
  find(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, options: PathOptions = {}): PathPoint[] | null {
    const height = options.heightBlocks ?? 2;
    const maxFall = options.maxFall ?? 3;
    const maxNodes = options.maxNodes ?? 900;

    const start = this.snapToGround(Math.floor(sx), Math.floor(sy), Math.floor(sz), height);
    const goal = this.snapToGround(Math.floor(tx), Math.floor(ty), Math.floor(tz), height);
    if (!start || !goal) return null;
    if (start.x === goal.x && start.y === goal.y && start.z === goal.z) return [];

    const openList: SearchNode[] = [];
    const openMap = new Map<string, SearchNode>();
    const closed = new Set<string>();

    const startNode: SearchNode = {
      x: start.x,
      y: start.y,
      z: start.z,
      g: 0,
      f: heuristic(start.x, start.y, start.z, goal),
      parent: null,
    };
    openList.push(startNode);
    openMap.set(keyOf(start.x, start.y, start.z), startNode);

    let expanded = 0;
    while (openList.length > 0 && expanded < maxNodes) {
      // 节点数不多（一般几百），线性取最小值比维护堆更省代码也够快
      let bestIndex = 0;
      for (let i = 1; i < openList.length; i++) {
        if (openList[i]!.f < openList[bestIndex]!.f) bestIndex = i;
      }
      const current = openList.splice(bestIndex, 1)[0]!;
      const currentKey = keyOf(current.x, current.y, current.z);
      openMap.delete(currentKey);
      closed.add(currentKey);
      expanded++;

      // 到达：水平重合且高度差 ≤ 1 就算到了（生物不需要精确站到目标的同一格）
      if (
        current.x === goal.x &&
        current.z === goal.z &&
        Math.abs(current.y - goal.y) <= 1
      ) {
        return this.reconstruct(current);
      }

      this.collectNeighbors(current, height, maxFall);
      for (const neighbor of this.neighborBuffer) {
        const neighborKey = keyOf(neighbor.x, neighbor.y, neighbor.z);
        if (closed.has(neighborKey)) continue;

        const g = current.g + neighbor.cost;
        const existing = openMap.get(neighborKey);
        if (existing && existing.g <= g) continue;

        if (existing) {
          existing.g = g;
          existing.f = g + heuristic(neighbor.x, neighbor.y, neighbor.z, goal);
          existing.parent = current;
          continue;
        }

        const node: SearchNode = {
          x: neighbor.x,
          y: neighbor.y,
          z: neighbor.z,
          g,
          f: g + heuristic(neighbor.x, neighbor.y, neighbor.z, goal),
          parent: current,
        };
        openList.push(node);
        openMap.set(neighborKey, node);
      }
    }

    return null;
  }

  private collectNeighbors(node: SearchNode, height: number, maxFall: number): void {
    const out = this.neighborBuffer;
    out.length = 0;

    for (const [dx, dz] of HORIZONTAL) {
      const nx = node.x + dx;
      const nz = node.z + dz;
      const diagonal = dx !== 0 && dz !== 0;
      const stepCost = diagonal ? Math.SQRT2 : 1;

      if (diagonal) {
        // 不允许从两个实心方块的夹角斜穿过去
        const blockedA = this.isSolid(nx, node.y, node.z) && this.isSolid(nx, node.y + 1, node.z);
        const blockedB = this.isSolid(node.x, node.y, nz) && this.isSolid(node.x, node.y + 1, nz);
        if (blockedA || blockedB) continue;
      }

      // 1) 同一层直接走
      if (this.canStandAt(nx, node.y, nz, height)) {
        out.push({ x: nx, y: node.y, z: nz, cost: stepCost });
        continue;
      }
      // 2) 上一层（跳一格的台阶）
      if (this.canStandAt(nx, node.y + 1, nz, height)) {
        out.push({ x: nx, y: node.y + 1, z: nz, cost: stepCost + 0.6 });
        continue;
      }
      // 3) 往下落（最多 maxFall 格）
      for (let drop = 1; drop <= maxFall; drop++) {
        if (this.canStandAt(nx, node.y - drop, nz, height)) {
          out.push({ x: nx, y: node.y - drop, z: nz, cost: stepCost + drop * 0.4 });
          break;
        }
      }
    }
  }

  private reconstruct(node: SearchNode): PathPoint[] {
    const path: PathPoint[] = [];
    let current: SearchNode | null = node;
    while (current) {
      path.push({ x: current.x, y: current.y, z: current.z });
      current = current.parent;
    }
    path.reverse();
    path.shift(); // 去掉起点
    return path;
  }
}
