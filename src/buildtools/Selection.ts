/**
 * 创造模式的**选区**（创造2，批次 20261022-1954）
 *
 * 纯逻辑：两个方块坐标 → 一个规整的长方体。不碰世界、不碰 DOM，
 * 所以"两个角顺序反过来会怎样""超出世界高度怎么裁""超过上限报什么"都能离线钉住。
 *
 * 四条口径（都有断言守着）：
 *
 *  1. **两端点任意顺序都得到同一个盒子**：先排序再算，永远 `min ≤ max`。
 *  2. **y 越界要裁剪**（夹到世界可建造范围）：玩家从基岩上方向下拉选区，
 *     拉到世界底以下时不该整块拒绝——那是"手抖拉过了"，不是"选区非法"。
 *     裁剪过会在结果里标 `clamped`，界面可以提示一句。
 *  3. **体积超上限直接拒绝，不裁剪**：32³ = 32768 与 `/fill` 的上限一致
 *     （见 `Commands.ts` 的 `fill` 条目）。静默截掉一半比拒绝更糟——
 *     玩家会以为"填完了"，而实际只填了一头。
 *  4. **遍历顺序固定**（y → z → x）：分批执行与断言都依赖它，不能随手换。
 */

import { WORLD_MAX_Y, WORLD_MIN_Y } from '../core/world/Chunk.ts';

/**
 * 界面提示用的参考边长（"最多 32×32×32"）。
 *
 * ⚠️ 真正的拒绝判据是**体积**（见 `SELECTION_MAX_VOLUME`），不是"每条边都 ≤ 32"：
 * 一条 10000×1×1 的长桥只有 10001 格，比 32³ 小得多，没有理由不让填。
 */
export const SELECTION_MAX_SIDE = 32;
/** 体积上限：32³ = 32768（与 `/fill` 同口径） */
export const SELECTION_MAX_VOLUME = SELECTION_MAX_SIDE * SELECTION_MAX_SIDE * SELECTION_MAX_SIDE;

export interface BlockPos {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 闭区间长方体（`min` 与 `max` 都含） */
export interface SelectionBox {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export type SelectionIssue = 'tooLarge' | 'outOfWorld';

export type SelectionResult =
  | {
      readonly ok: true;
      readonly box: SelectionBox;
      readonly volume: number;
      /** y 是否被世界高度裁过（界面据此提示"选区已截到可建造范围"） */
      readonly clamped: boolean;
    }
  | { readonly ok: false; readonly reason: SelectionIssue; readonly volume: number };

/** 体积（闭区间，所以每边 +1） */
export function selectionVolume(box: SelectionBox): number {
  return (
    (box.maxX - box.minX + 1) * (box.maxY - box.minY + 1) * (box.maxZ - box.minZ + 1)
  );
}

/**
 * 两点 → 规整选区。
 *
 * ⚠️ 水平方向**不设边界**（世界是无限大的），只裁剪 y；体积上限单独判。
 */
export function buildSelection(a: BlockPos, b: BlockPos): SelectionResult {
  const ax = Math.floor(a.x);
  const ay = Math.floor(a.y);
  const az = Math.floor(a.z);
  const bx = Math.floor(b.x);
  const by = Math.floor(b.y);
  const bz = Math.floor(b.z);

  const rawMinY = Math.min(ay, by);
  const rawMaxY = Math.max(ay, by);
  const minY = Math.max(WORLD_MIN_Y, rawMinY);
  const maxY = Math.min(WORLD_MAX_Y - 1, rawMaxY);

  // 两端都在世界之外（例如都在基岩下面的虚空里）：没有可填的格子
  if (minY > maxY) {
    return { ok: false, reason: 'outOfWorld', volume: 0 };
  }

  const box: SelectionBox = {
    minX: Math.min(ax, bx),
    minY,
    minZ: Math.min(az, bz),
    maxX: Math.max(ax, bx),
    maxY,
    maxZ: Math.max(az, bz),
  };
  const volume = selectionVolume(box);
  if (volume > SELECTION_MAX_VOLUME) {
    return { ok: false, reason: 'tooLarge', volume };
  }
  return { ok: true, box, volume, clamped: minY !== rawMinY || maxY !== rawMaxY };
}

/** 某一格在不在盒子里（闭区间） */
export function boxContains(box: SelectionBox, x: number, y: number, z: number): boolean {
  return (
    x >= box.minX && x <= box.maxX &&
    y >= box.minY && y <= box.maxY &&
    z >= box.minZ && z <= box.maxZ
  );
}

/**
 * 按**固定顺序**遍历盒子里的每一格：y 外层、z 中层、x 内层。
 *
 * 分批执行靠这个顺序（先填完一层再上一层），断言也靠它——
 * 换成"x 外层"在功能上等价，但"每批填在哪"会变，测试就钉不住了。
 */
export function* selectionCells(box: SelectionBox): Generator<BlockPos> {
  for (let y = box.minY; y <= box.maxY; y++) {
    for (let z = box.minZ; z <= box.maxZ; z++) {
      for (let x = box.minX; x <= box.maxX; x++) {
        yield { x, y, z };
      }
    }
  }
}

/** 盒子的尺寸（界面显示"16×4×16"用） */
export function boxSize(box: SelectionBox): {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
} {
  return {
    width: box.maxX - box.minX + 1,
    height: box.maxY - box.minY + 1,
    depth: box.maxZ - box.minZ + 1,
  };
}
