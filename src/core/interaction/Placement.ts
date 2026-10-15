/**
 * 放置规则
 *
 * 由「要放的方块 + 命中面 + 玩家朝向 + 周围方块」推导出该方块的状态，
 * 以及是否合法（例如火把不能悬空、门需要两格高）。
 *
 * 各形状的判定对齐原版：
 *  - 台阶：命中方块的上表面 → 下半砖；命中下表面 → 上半砖；
 *          命中侧面时看准星落在方块的哪一半（与原版一致）
 *  - 楼梯：朝向取玩家水平朝向的相反方向；命中下表面时倒置
 *  - 火把：命中上表面 → 落地火把；命中侧面 → 挂墙火把（朝墙那一侧）；
 *          命中下表面（天花板）→ 不允许
 *  - 梯子：只能贴在有支撑的侧面
 *  - 门：需要下方有支撑 + 上方两格空间，朝外一侧朝向玩家
 */

import { Block, blockDef } from '../registry/blocks.ts';
import {
  facingFromYaw,
  withDoorHinge,
  withDoorUpper,
  withFacing,
  withSlabDouble,
  withTop,
  withWallMounted,
  type Facing,
} from '../registry/blockState.ts';

export interface PlacementInput {
  /** 要放置的方块 id */
  blockId: number;
  /** 命中面的法线（指向放置位置一侧） */
  normal: readonly [number, number, number];
  /** 命中点的精确世界坐标（用于判断准星落在方块的哪一半 / 门的门轴位置） */
  hitX: number;
  hitY: number;
  hitZ: number;
  /** 玩家水平朝向（弧度） */
  yaw: number;
  /** 玩家是否潜行（潜行时不做"点击方块打开界面"之类的交互，但这里不影响形状） */
  sneaking: boolean;
  /** 查询相对位置的方块 id */
  blockAt(dx: number, dy: number, dz: number): number;
  /** 射线命中的那个方块 id（台阶合并成双层时要用） */
  hitBlock: number;
  /** 命中方块当前的状态（判断它是不是已经叠了一层的台阶） */
  hitState: number;
}

export interface PlacementPlan {
  /** 主方块的状态 */
  state: number;
  /** 需要额外放置的方块（门的上半部分） */
  extra?: { dx: number; dy: number; dz: number; id: number; state: number };
  /**
   * 与命中方块合并（台阶叠成双层）。
   * 出现这个字段时，放置目标是**命中方块自身**而不是命中面外侧那一格。
   */
  mergeInto?: { state: number };
}

/** 水平法线 → 朝向（朝向指向法线的反方向，即"朝向墙壁"） */
function facingFromNormal(normalX: number, normalZ: number): Facing | null {
  if (normalX > 0) return 3; // 法线朝 +X，墙在 -X 侧 → 面向西
  if (normalX < 0) return 1; // 墙在 +X 侧 → 面向东
  if (normalZ > 0) return 0; // 墙在 -Z 侧 → 面向北
  if (normalZ < 0) return 2; // 墙在 +Z 侧 → 面向南
  return null;
}

export function planPlacement(input: PlacementInput): PlacementPlan | null {
  const def = blockDef(input.blockId);
  const [nx, ny, nz] = input.normal;

  switch (def.shape) {
    case 'slab': {
      // 命中同一个台阶的竖直面 → 合并成双层（原版行为）
      if (ny !== 0 && input.hitBlock === input.blockId) {
        return { state: 0, mergeInto: { state: withSlabDouble(input.hitState, true) } };
      }

      // 命中顶面 → 下半砖；命中底面 → 上半砖；命中侧面 → 按准星高度决定
      let top: boolean;
      if (ny > 0) top = false;
      else if (ny < 0) top = true;
      else top = input.hitY - Math.floor(input.hitY) > 0.5;
      return { state: withTop(0, top) };
    }

    case 'stairs': {
      const facing = facingFromYaw(input.yaw);
      // 命中底面时倒置楼梯（与原版一致）
      const top = ny < 0;
      return { state: withTop(withFacing(0, facing), top) };
    }

    case 'fence':
    case 'wall':
      // 连接方向在网格化时按邻居实时计算，不需要状态
      return { state: 0 };

    case 'torch': {
      if (ny > 0) {
        // 落地火把：下方必须有支撑
        if (input.blockAt(0, -1, 0) === 0) return null;
        return { state: 0 };
      }
      if (ny < 0) return null; // 原版不允许把火把挂在天花板上
      const facing = facingFromNormal(nx, nz);
      if (facing === null) return null;
      return { state: withWallMounted(withFacing(0, facing), true) };
    }

    case 'ladder': {
      const facing = facingFromNormal(nx, nz);
      if (facing === null) return null;
      // 贴的那一面必须有实心方块
      if (!blockDef(input.blockAt(-nx, 0, -nz)).solid) return null;
      return { state: withFacing(0, facing) };
    }

    case 'door': {
      // 需要脚下有支撑、上方一格是空气
      if (!blockDef(input.blockAt(0, -1, 0)).solid) return null;
      if (input.blockAt(0, 1, 0) !== 0) return null;

      const facing = facingFromYaw(input.yaw);
      // 门轴：看准星落在门宽度的哪一半。门宽方向与朝向垂直
      // （朝南/北时门沿 X 展开，朝东/西时门沿 Z 展开）
      const alongX = facing === 0 || facing === 2;
      const fraction = alongX
        ? input.hitX - Math.floor(input.hitX)
        : input.hitZ - Math.floor(input.hitZ);
      const hinge: 0 | 1 = fraction > 0.5 ? 1 : 0;

      const lower = withDoorHinge(withFacing(0, facing), hinge);
      return {
        state: lower,
        extra: { dx: 0, dy: 1, dz: 0, id: input.blockId, state: withDoorUpper(lower, true) },
      };
    }

    case 'trapdoor': {
      // 朝向：水平面按玩家面对的方向；命中顶面 → 贴地（下半），命中底面 → 贴天花板（上半）
      const facing = facingFromYaw(input.yaw);
      const top = ny < 0;
      return { state: withTop(withFacing(0, facing), top) };
    }

    case 'fence_gate':
      // 栅栏门只有朝向：门板横在朝向的**垂直方向**上（与栅栏连成一线）
      return { state: withFacing(0, facingFromYaw(input.yaw)) };

    case 'lily_pad': {
      // 睡莲必须"浮在水面上"：自己那一格是空气、下面那一格是水。
      //
      // 为什么自己那一格也要求空气（原版允许替换水）：本项目的睡莲叶片贴在格子**底部**
      // （见 `blockShapes.ts` 的 1/16 薄板），要是让它替换掉水面那一格的水，
      // 叶片就会被同一个格子里的水面盖住——看起来像没放上去。
      // 所以只在"水面正上方那一格空气"里放，`main.ts` 负责把落点算到那一格（见 `onWaterSurface`）。
      if (input.blockAt(0, 0, 0) !== Block.AIR) return null;
      if (input.blockAt(0, -1, 0) !== Block.WATER) return null;
      return { state: 0 };
    }

    default:
      return { state: 0 };
  }
}


