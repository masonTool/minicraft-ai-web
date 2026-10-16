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
 *  - 锁链（B11）：轴向由命中面决定（顶/底 → 竖直，侧面 → 沿那个水平轴）
 *  - 藤蔓（B11）：挂在命中面反方向的邻居那一侧；落在已有藤蔓上时**再挂一面**
 */

import { Block, JUNGLE_LOG_ID, blockDef } from '../registry/blocks.ts';
import {
  MAX_SNOW_LAYERS,
  facingFromYaw,
  snowLayers,
  withAxis,
  withDoorHinge,
  withDoorUpper,
  withFacing,
  withSlabDouble,
  withSnowLayers,
  withTop,
  withVineSide,
  withVineUp,
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
  /** 查询相对位置的方块状态（藤蔓"再挂一面"要用；不提供时按 0 处理） */
  stateAt?(dx: number, dy: number, dz: number): number;
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
  /**
   * 与**落点那一格**已有的同种方块合并（藤蔓"再挂一面"）。
   *
   * 与 `mergeInto` 的差别：`mergeInto` 改的是**命中方块**（台阶叠双层、雪层叠高），
   * 这里改的是命中面外侧那一格——它已经长着同一种藤蔓了，玩家只是想让它多挂一面。
   */
  mergeIntoTarget?: { state: number };
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

  // ---- 水里的植物（批次 50：海带与海草）
  //
  // 判据走方块定义上的 `waterPlant` 而不是某个 id：这一族以后还会加（珊瑚、海龟蛋…）。
  //
  // 与其它植物（`cross`）的区别就在这里：普通植物要求"落点是空气 + 下方是实心"，
  // 而水里的植物**落点必须是水**（它替换掉那一格水），下方可以是实心方块
  // （海底）或**同一种植物**（在已有的海带上再续一节，原版就是这样种出高海带的）。
  if (def.waterPlant) {
    if (input.blockAt(0, 0, 0) !== Block.WATER) return null;
    const below = input.blockAt(0, -1, 0);
    if (!blockDef(below).solid && below !== input.blockId) return null;
    // `cross` 形状（海带/海草/珊瑚丛）没有额外状态，落点定下来就能放；
    // **其余形状要继续走下面的 switch** 求自己的状态——珊瑚扇（批次 51）的
    // "落地还是贴墙、贴哪一面"就在那个 case 里。原先这里一律 `return { state: 0 }`，
    // 表现是"贴墙放珊瑚扇，结果它躺在地上"
    if (def.shape === 'cross') return { state: 0 };
  }

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

    case 'coral_fan': {
      // 珊瑚扇（批次 51）：与火把同一套"落地 / 贴墙"，但落点还要是水
      // （它是水里的植物，占了那一格水——这条由上面的 `waterPlant` 分支管着）
      if (ny > 0) {
        if (input.blockAt(0, -1, 0) === 0) return null;
        return { state: 0 };
      }
      if (ny < 0) return null;
      const facing = facingFromNormal(nx, nz);
      if (facing === null) return null;
      return { state: withWallMounted(withFacing(0, facing), true) };
    }

    case 'cake':
      // 蛋糕（批次 52）：半格高的方块，只能放在实心方块**上面**（原版放不了天花板）
      if (ny <= 0) return null;
      if (!blockDef(input.blockAt(0, -1, 0)).solid) return null;
      return { state: 0 };

    case 'flower_pot':
      // 花盆同理（放下去时是**空盆**，里面的植物靠右键种，见 main 的交互）
      if (ny <= 0) return null;
      if (!blockDef(input.blockAt(0, -1, 0)).solid) return null;
      return { state: 0 };

    case 'ladder': {
      const facing = facingFromNormal(nx, nz);
      if (facing === null) return null;
      // 贴的那一面必须有实心方块
      if (!blockDef(input.blockAt(-nx, 0, -nz)).solid) return null;
      return { state: withFacing(0, facing) };
    }

    case 'chain': {
      // 轴向由"点的是哪一面"决定：顶/底面 → 竖直，侧面 → 沿着那个水平轴横拉
      if (ny !== 0) return { state: withAxis(0, 0) };
      if (nx !== 0) return { state: withAxis(0, 1) };
      return { state: withAxis(0, 2) };
    }

    case 'vine': {
      // 藤蔓挂在**命中的那一面**上：挂面 = 命中面反方向的邻居那一侧
      // （点方块南面 → 藤蔓落到南边那一格、贴在该格的北侧），与梯子同一套朝向语义。
      let side: Facing | null = null;
      let up = false;
      if (ny > 0) return null; // 原版不允许在方块**顶面**上长藤蔓
      if (ny < 0) up = true; // 点底面 → 挂在天花板底下
      else side = facingFromNormal(nx, nz);

      // 被点的那一格必须是实心的（藤蔓要有可附着的面）
      if (!blockDef(input.hitBlock).solid) return null;

      const target = input.blockAt(nx, ny, nz);
      const existingState = input.stateAt?.(nx, ny, nz) ?? 0;

      // 落点已经长着藤蔓 → 只是"再挂一面"（一个藤蔓方块能同时挂好几面）
      if (target === input.blockId) {
        const merged = up ? withVineUp(existingState, true) : withVineSide(existingState, side!, true);
        if (merged === existingState) return null; // 这一面早挂过了，别白扣一个物品
        return { state: 0, mergeIntoTarget: { state: merged } };
      }
      // 其余情况要求落点是空的（或流体）
      if (target !== Block.AIR && !blockDef(target).liquid) return null;
      return { state: up ? withVineUp(0, true) : withVineSide(0, side!, true) };
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

    case 'flat': {
      // 红石粉 / 压力板 / 地毯：原版一律要求"下方有实心方块"，不能贴在墙上或天花板上。
      // 这条以前是漏的（走 default 分支就无条件返回 state 0），于是能在墙上放一片
      // 悬空的红石粉——外观上它就平贴在方块侧面，看着就不对。
      if (!blockDef(input.blockAt(0, -1, 0)).solid) return null;
      return { state: 0 };
    }

    case 'snow': {
      // 雪层：对着**已有雪层的顶面**再放一层 → 叠高（原版最多 8 层）。
      // 这是"同一格越叠越高"，与台阶的"上下半合并"一样属于**改命中方块自身**，
      // 所以走 `mergeInto`（放置目标不是命中面外侧那一格）。
      if (ny > 0 && input.hitBlock === input.blockId) {
        const layers = snowLayers(input.hitState);
        if (layers >= MAX_SNOW_LAYERS) return null; // 已经是整格高度，叠不上去了
        return { state: 0, mergeInto: { state: withSnowLayers(input.hitState, layers + 1) } };
      }
      // 其余情况：与地毯/红石粉同一条规矩——下方要有实心方块，新放的是 1 层
      if (!blockDef(input.blockAt(0, -1, 0)).solid) return null;
      return { state: withSnowLayers(0, 1) };
    }

    case 'cocoa': {
      // 可可豆只能挂在**丛林原木的水平侧面**上（原版如此：丛林树的树干）
      if (ny !== 0) return null;
      const facing = facingFromNormal(nx, nz);
      if (facing === null) return null;
      if (input.hitBlock !== JUNGLE_LOG_ID) return null;
      const target = input.blockAt(nx, ny, nz);
      if (target !== Block.AIR && !blockDef(target).liquid) return null;
      return { state: withFacing(0, facing) };
    }

    case 'cross': {
      // 植物（花 / 草 / 甘蔗 / 竹子 / 甜浆果丛…）要站在**实心方块**上。
      //
      // ⚠️ 这条以前是漏的：`cross` 走 `default` 分支无条件返回状态 0，
      // 于是花可以悬空放在半空里（看着像浮在空中）。原版的判定更细
      // （花只认草/泥土/灰化土那几种），这里先收成"下方是实心方块"——
      // 比原版宽松一点，但把"悬空放植物"这条明显不对的行为挡住了。
      if (!blockDef(input.blockAt(0, -1, 0)).solid) return null;
      return { state: 0 };
    }

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


