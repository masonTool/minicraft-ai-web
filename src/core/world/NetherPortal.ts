/**
 * 下界传送门（K8）
 *
 * 一件纯粹的事：**黑曜石框 + 门方块 + 传送**。这里只有逻辑，世界通过 `PortalWorld`
 * 接口接触（读/写方块 + 方块状态），因此可以离线断言（见 `tools/netherportal-test.ts`）。
 *
 * 对齐原版的地方：
 *  - 框用**洪泛**判定：从点火的那一格空气出发，在同一平面内漫出连通空气，
 *    必须恰好是**一个矩形**（2~21 宽、3~21 高），且矩形外圈一整圈都是黑曜石
 *  - 点火的"两条活路"与原版一致：单击的必须是黑曜石**朝框内**的那一面
 *    （点到框外侧的面上不会亮——原版也是这样）
 *  - **点燃门不消耗打火石耐久**：原版在 `FlintAndSteelItem` 里命中黑曜石就提前
 *    `return SUCCESS`，走不到后面的 `hurtAndBreak`。这是个容易改错的"原版怪癖"，
 *    所以写在这里而不是散在调用处
 *  - 坐标缩放：主世界 ↔ 下界 水平 **÷8 / ×8**，竖直按两个维度的高度比例换算再夹紧
 *  - 站门计时：普通模式 **80 tick（4 秒）**、创造模式 **1 tick**
 *  - 到达时优先**找已有的门**（16 格半径），找不到就**照着原地新建一座 2×3 的门**
 *  - 框被破坏后门随之熄灭（见 `portalClusterAround`）
 *
 * 与原版的差异（写进 TASKS K8）：
 *  - **没有原版那 300 tick（15 秒）传送冷却**：改成"落地时人还站在目的地那扇门里就先不计时，
 *    走出去一次才重新武装"（见 `stepPortalStanding`）。原版那 15 秒会让"进门后想马上折返"
 *    干等 19 秒（15 + 4），手感上就是"传送门没反应"；换成位置锁定后既不会一落地被弹回去，
 *    也不用干等
 *  - 没有 POI 索引，找门的半径两个方向都取 **16 格**（原版主世界侧是 128 格）。
 *    代价：在距原门 16~128 格处单独建的门不会自动连起来（会各自新建一座）
 *  - 门面是一张**整格**的紫色方块（原版是 1 格厚的平面），没有 4 个朝向的模型
 *  - 生物不进传送门（只有玩家会传）
 */

import { Block, blockDef } from '../registry/blocks.ts';
import { portalAxisIsZ, withPortalAxis } from '../registry/blockState.ts';
import { Dimension, type DimensionId } from '../gen/Dimension.ts';

/** 门面沿哪个水平轴展开（'x' = 门面在 X 方向铺开，门是南北向的一堵墙） */
export type PortalAxis = 'x' | 'z';

/** 站门多久会被传送（tick）：普通 80（4 秒）、创造 1（原版 `getPortalWaitTime`） */
export const PORTAL_IGNITE_TICKS = 80;
export const PORTAL_CREATIVE_IGNITE_TICKS = 1;

/** 门的尺寸上限（原版 21×21；新建的门固定 2×3，与原版 `PortalForcer` 一致） */
export const PORTAL_MAX_WIDTH = 21;
export const PORTAL_MAX_HEIGHT = 21;
/** 新建门的内空尺寸 */
export const NEW_PORTAL_WIDTH = 2;
export const NEW_PORTAL_HEIGHT = 3;

/** 水平坐标缩放：主世界 8 格 = 下界 1 格 */
export const NETHER_SCALE = 8;
/** 两个维度的高度（原版 384 / 256）：传送时竖直方向按比例换算 */
export const OVERWORLD_HEIGHT = 384;
export const NETHER_HEIGHT = 256;
/** 竖直方向的可落区间（躲开两个维度各自的基岩与洞顶/虚空） */
export const NETHER_MIN_Y = -54;
export const NETHER_MAX_Y = 104;
export const OVERWORLD_MIN_Y = -60;
export const OVERWORLD_MAX_Y = 300;

/** 找已有门的水平/竖直搜索半径（见文件头"与原版的差异"） */
export const PORTAL_SEARCH_RADIUS = 16;
export const PORTAL_SEARCH_HEIGHT = 24;
/**
 * 新建门时横向找位置的半径。
 *
 * 取 4（81 列）而不是原版的 16：判定一次要读二十来次方块，半径再大会让
 * "目标点整片实心"这种最坏情况变成几百万次读方块（传送时卡半秒）。
 * 4 格已经足够覆盖"脚下有地面"的正常落点。
 */
export const PORTAL_SITE_RADIUS = 4;

/** 门方块自己发的光（原版 11） */
export const PORTAL_LIGHT = 11;

// ---------------------------------------------------------------- 站门计时

/** 站门计时的状态（主循环每 tick 喂一次 `stepPortalStanding`） */
export interface PortalStanding {
  /** 站在门里的累计 tick */
  ticks: number;
  /**
   * 刚穿过门落地、人还站在**目的地那扇门**里：为真时不计时，必须先走出去一次。
   *
   * 这就是替代"传送后 15 秒冷却"的那条规则：目的相同（不会一落地就被弹回去），
   * 但玩家想立刻折返时只要走出门再站回来即可，不用干等。
   */
  locked: boolean;
}

/**
 * 站门计时一步（纯逻辑，见 `tools/netherportal-test.ts`）。
 *
 * - 不在门里：计时清零 + **解除落地锁定**（走出门 = 重新武装）
 * - 落地锁定中：计时保持 0，这一 tick 不会传送（也不会把人弹回去）
 * - 其余：累计 tick，满 `waitTicks` 返回 true
 *
 * @returns 这一 tick 是否该传送（调用方负责复位计时、切维度）
 */
export function stepPortalStanding(state: PortalStanding, inPortal: boolean, waitTicks: number): boolean {
  if (!inPortal) {
    state.ticks = 0;
    state.locked = false;
    return false;
  }
  if (state.locked) {
    state.ticks = 0;
    return false;
  }
  state.ticks++;
  if (state.ticks < waitTicks) return false;
  state.ticks = 0;
  return true;
}

/** 传送门逻辑看到的世界 */
export interface PortalWorld {
  getBlock(worldX: number, worldY: number, worldZ: number): number;
  /** 方块状态（门面沿哪个轴）；不实现就当全 0（沿 X 轴） */
  getState?(worldX: number, worldY: number, worldZ: number): number;
  /** @returns 是否写入成功（区块未加载时应当返回 false） */
  setBlock(worldX: number, worldY: number, worldZ: number, id: number, state?: number): boolean;
}

/** 一座门的框内区域（坐标是最小角） */
export interface PortalShape {
  axis: PortalAxis;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

/** 门框内的所有格子（用于填充门方块、以及断言） */
export function portalInterior(shape: PortalShape): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = [];
  for (let i = 0; i < shape.width; i++) {
    for (let j = 0; j < shape.height; j++) {
      cells.push(
        shape.axis === 'x' ? [shape.x + i, shape.y + j, shape.z] : [shape.x, shape.y + j, shape.z + i],
      );
    }
  }
  return cells;
}

/** 门框（那圈黑曜石）的格子，断言与调试用 */
export function portalFrame(shape: PortalShape): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = [];
  const push = (i: number, j: number) => {
    cells.push(
      shape.axis === 'x' ? [shape.x + i, shape.y + j, shape.z] : [shape.x, shape.y + j, shape.z + i],
    );
  };
  for (let i = -1; i <= shape.width; i++) {
    push(i, -1);
    push(i, shape.height);
  }
  for (let j = 0; j < shape.height; j++) {
    push(-1, j);
    push(shape.width, j);
  }
  return cells;
}

/** 门框内的中心点（玩家从门里出来时站的地方） */
export function portalCenter(shape: PortalShape): { x: number; y: number; z: number } {
  const half = shape.width / 2;
  return {
    x: shape.axis === 'x' ? shape.x + half : shape.x + 0.5,
    y: shape.y,
    z: shape.axis === 'x' ? shape.z + 0.5 : shape.z + half,
  };
}

/** 某格是不是黑曜石（原版还允许哭泣的黑曜石，我们没做那个方块） */
export function isPortalFrameBlock(id: number): boolean {
  return id === Block.OBSIDIAN;
}

// ---------------------------------------------------------------- 框的判定

/** 平面内的局部坐标 → 世界坐标 */
function planeToWorld(origin: readonly [number, number, number], axis: PortalAxis, u: number, dy: number): [number, number, number] {
  return axis === 'x'
    ? [origin[0] + u, origin[1] + dy, origin[2]]
    : [origin[0], origin[1] + dy, origin[2] + u];
}

/**
 * 从一格空气出发，在**同一平面**内洪泛出连通的空气区域。
 * 只在同一个矩形里漫（矩形之外一律视为边界），上限 21×21——超过就放弃，
 * 避免"对着洞口的空气点火"时把整片洞穴都漫进来。
 */
function floodAir(
  world: PortalWorld,
  origin: readonly [number, number, number],
  axis: PortalAxis,
  maxCells: number,
): { cells: Set<number>; minU: number; maxU: number; minDy: number; maxDy: number } | null {
  const key = (u: number, dy: number) => (u + 32) * 64 + (dy + 32);
  const seen = new Set<number>();
  const stack: Array<[number, number]> = [[0, 0]];
  let minU = 0;
  let maxU = 0;
  let minDy = 0;
  let maxDy = 0;

  while (stack.length > 0) {
    const [u, dy] = stack.pop()!;
    if (u < -32 || u > 31 || dy < -32 || dy > 31) continue;
    const [wx, wy, wz] = planeToWorld(origin, axis, u, dy);
    if (world.getBlock(wx, wy, wz) !== Block.AIR) continue;
    const k = key(u, dy);
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > maxCells) return null;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minDy = Math.min(minDy, dy);
    maxDy = Math.max(maxDy, dy);
    stack.push([u + 1, dy], [u - 1, dy], [u, dy + 1], [u, dy - 1]);
  }
  return { cells: seen, minU, maxU, minDy, maxDy };
}

/**
 * 矩形外圈是不是一整圈黑曜石。
 *
 * ⚠️ 上下两行要**连四个角一起**查（`u` 从 `minU-1` 到 `maxU+1`）：
 * 角的黑曜石被敲掉时，门里那 6 格方块其实一格都没挨着被敲的位置
 * （它与门方块只在对角上相邻），只有把角算进"框"里才判得出来。
 * 这个漏判真的发生过：敲角不熄火，门就一直亮着。
 */
function hasObsidianRing(
  world: PortalWorld,
  origin: readonly [number, number, number],
  axis: PortalAxis,
  minU: number,
  maxU: number,
  minDy: number,
  maxDy: number,
): boolean {
  const isFrame = (u: number, dy: number) => {
    const [wx, wy, wz] = planeToWorld(origin, axis, u, dy);
    return isPortalFrameBlock(world.getBlock(wx, wy, wz));
  };
  for (let u = minU - 1; u <= maxU + 1; u++) {
    if (!isFrame(u, minDy - 1)) return false;
    if (!isFrame(u, maxDy + 1)) return false;
  }
  for (let dy = minDy; dy <= maxDy; dy++) {
    if (!isFrame(minU - 1, dy)) return false;
    if (!isFrame(maxU + 1, dy)) return false;
  }
  return true;
}

/** 某个轴向上、以 (x,y,z) 为起点能不能构成一座合法的空门框 */
function emptyShapeOnAxis(
  world: PortalWorld,
  origin: readonly [number, number, number],
  axis: PortalAxis,
): PortalShape | null {
  if (world.getBlock(origin[0], origin[1], origin[2]) !== Block.AIR) return null;
  const region = floodAir(world, origin, axis, PORTAL_MAX_WIDTH * PORTAL_MAX_HEIGHT);
  if (!region) return null;

  const width = region.maxU - region.minU + 1;
  const height = region.maxDy - region.minDy + 1;
  if (width < 2 || width > PORTAL_MAX_WIDTH) return null;
  if (height < 3 || height > PORTAL_MAX_HEIGHT) return null;
  // 区域必须**恰好填满**自己的外接矩形：否则说明框上有洞（空气漫到了框外）
  if (region.cells.size !== width * height) return null;
  if (!hasObsidianRing(world, origin, axis, region.minU, region.maxU, region.minDy, region.maxDy)) return null;

  const [x, y, z] = planeToWorld(origin, axis, region.minU, region.minDy);
  return { axis, x, y, z, width, height };
}

/**
 * 点燃判定：从点火的那一格空气出发，找出它所在的空门框。
 * 两个轴向都试（原版先试 X 再试 Z），都不成立返回 null。
 */
export function findPortalShape(world: PortalWorld, x: number, y: number, z: number): PortalShape | null {
  return (
    emptyShapeOnAxis(world, [x, y, z], 'x') ?? emptyShapeOnAxis(world, [x, y, z], 'z')
  );
}

/** 把框内填满门方块；@returns 填了几格（0 表示一格都没写进去，通常意味着区块没加载） */
export function fillPortalBlocks(world: PortalWorld, shape: PortalShape): number {
  const state = withPortalAxis(0, shape.axis === 'z');
  let count = 0;
  for (const [x, y, z] of portalInterior(shape)) {
    if (world.setBlock(x, y, z, Block.NETHER_PORTAL, state)) count++;
  }
  return count;
}

/** 点燃结果：`lit` = 这一下把门点着了；`exists` = 框里本来就是亮着的门；`none` = 这一格不是门框 */
export type IgniteResult = 'lit' | 'exists' | 'none';

/**
 * 打火石点火（只负责"门"这一半：普通火焰见 `Fire.ts`）。
 *
 * 调用方拿到 `none` 时才应该继续尝试放火焰——原版就是这么分的：
 * 命中黑曜石先试着点门，门成了就 `return SUCCESS`（**不消耗耐久**），
 * 门没成才落到"放一格火"。
 */
export function ignitePortal(world: PortalWorld, x: number, y: number, z: number): IgniteResult {
  const shape = findPortalShape(world, x, y, z);
  if (shape) return fillPortalBlocks(world, shape) > 0 ? 'lit' : 'none';

  // 框里已经填着门方块时，`findPortalShape`（只认空气）必然找不到——
  // 但这一下也不该变成"在框上放火"，所以单独认一次"已经是门了"
  if (shapeAt(world, x, y, z) !== null) return 'exists';
  return 'none';
}

// ---------------------------------------------------------------- 已存在的门

/** 门方块沿平面漫出的连通区域 → 一座门（框不完整时返回 null） */
export function shapeAt(world: PortalWorld, x: number, y: number, z: number): PortalShape | null {
  if (world.getBlock(x, y, z) !== Block.NETHER_PORTAL) return null;
  const axis: PortalAxis = portalAxisIsZ(world.getState?.(x, y, z) ?? 0) ? 'z' : 'x';
  const origin: [number, number, number] = [x, y, z];

  const key = (u: number, dy: number) => (u + 32) * 64 + (dy + 32);
  const seen = new Set<number>();
  const stack: Array<[number, number]> = [[0, 0]];
  let minU = 0;
  let maxU = 0;
  let minDy = 0;
  let maxDy = 0;

  while (stack.length > 0) {
    const [u, dy] = stack.pop()!;
    if (u < -32 || u > 31 || dy < -32 || dy > 31) continue;
    const k = key(u, dy);
    if (seen.has(k)) continue;
    const [wx, wy, wz] = planeToWorld(origin, axis, u, dy);
    if (world.getBlock(wx, wy, wz) !== Block.NETHER_PORTAL) continue;
    seen.add(k);
    if (seen.size > PORTAL_MAX_WIDTH * PORTAL_MAX_HEIGHT) return null;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minDy = Math.min(minDy, dy);
    maxDy = Math.max(maxDy, dy);
    stack.push([u + 1, dy], [u - 1, dy], [u, dy + 1], [u, dy - 1]);
  }

  const width = maxU - minU + 1;
  const height = maxDy - minDy + 1;
  if (seen.size !== width * height) return null;
  if (!hasObsidianRing(world, origin, axis, minU, maxU, minDy, maxDy)) return null;
  const [sx, sy, sz] = planeToWorld(origin, axis, minU, minDy);
  return { axis, x: sx, y: sy, z: sz, width, height };
}

/**
 * 在目标点附近找一座已有的门（取最近的一座）。
 *
 * 扫描范围是 ±`PORTAL_SEARCH_RADIUS` 的立方体（横向）× ±`PORTAL_SEARCH_HEIGHT`（竖直）。
 * 原版靠 POI 索引能扫 128 格，我们没有索引，扫不起那么大的立方体：
 * 立方体边长翻倍，读方块次数是 8 倍。16 格已经覆盖"来回走同一座门"这个主场景
 * （下界坐标是向下取整的，折算回主世界最多偏 7 格）。
 */
export function findPortalNear(
  world: PortalWorld,
  x: number,
  y: number,
  z: number,
  radius = PORTAL_SEARCH_RADIUS,
): PortalShape | null {
  let best: PortalShape | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  // 一座门会被扫到好几次（6 格的门就有 6 次）；判过一次就把它的格子记下来，
  // 否则大门的判定次数是"格数²"，白跑几百倍的活
  const claimed = new Set<string>();

  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -PORTAL_SEARCH_HEIGHT; dy <= PORTAL_SEARCH_HEIGHT; dy++) {
        const bx = Math.floor(x) + dx;
        const by = Math.floor(y) + dy;
        const bz = Math.floor(z) + dz;
        if (claimed.has(`${bx},${by},${bz}`)) continue;
        if (world.getBlock(bx, by, bz) !== Block.NETHER_PORTAL) continue;
        const shape = shapeAt(world, bx, by, bz);
        if (!shape) continue;
        for (const [cx, cy, cz] of portalInterior(shape)) claimed.add(`${cx},${cy},${cz}`);
        const center = portalCenter(shape);
        // 三维距离（原版也是取三维最近的门）
        const distance = Math.hypot(center.x - x, center.y - y, center.z - z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = shape;
        }
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- 新建一座门

/** 该维度里"门可以待着"的竖直区间（躲开两个维度各自的基岩、岩浆海与洞顶） */
export function dimensionYRange(dimension: DimensionId): { min: number; max: number } {
  return dimension === Dimension.NETHER
    ? { min: NETHER_MIN_Y, max: NETHER_MAX_Y }
    : { min: OVERWORLD_MIN_Y, max: OVERWORLD_MAX_Y };
}

/** 门框最下面那一行（含两个底角）：这一行是"坐"在地表上的，可以替换掉地表方块 */
export function portalBottomRow(shape: PortalShape): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = [];
  for (let i = -1; i <= shape.width; i++) {
    const [x, y, z] = planeToWorld([shape.x, shape.y - 1, shape.z], shape.axis, i, 0);
    cells.push([x, y, z]);
  }
  return cells;
}

/**
 * 这个位置能不能新建一座门。
 *
 * 判定分四条，都是从原版 `PortalForcer.createPortal` 的观感倒推出来的：
 *  1. **框内必须全是空气**——门不会去覆盖地形
 *  2. **两根立柱与顶盖必须空着**——否则门是埋在土里的，玩家进去会憋死
 *  3. **底边那一行允许替换普通实心方块**：原版新建的门就是"坐"在地表上的，
 *     底边那行黑曜石会替掉最上面一层泥土。但绝不能盖到别人的门方块上
 *  4. **底边下面要有实心支撑**：不然门会悬在半空、玩家从门里出来直接掉下去
 */
export function canBuildPortalAt(
  world: PortalWorld,
  x: number,
  y: number,
  z: number,
  axis: PortalAxis,
  width = NEW_PORTAL_WIDTH,
  height = NEW_PORTAL_HEIGHT,
): boolean {
  const shape: PortalShape = { axis, x, y, z, width, height };

  for (const [cx, cy, cz] of portalInterior(shape)) {
    if (world.getBlock(cx, cy, cz) !== Block.AIR) return false;
  }
  for (const [cx, cy, cz] of portalFrame(shape)) {
    if (cy === y - 1) continue; // 底边单独判（见第 3 条）
    if (world.getBlock(cx, cy, cz) !== Block.AIR) return false;
  }
  for (const [cx, cy, cz] of portalBottomRow(shape)) {
    if (world.getBlock(cx, cy, cz) === Block.NETHER_PORTAL) return false;
  }
  for (let i = 0; i < width; i++) {
    const [bx, by, bz] = planeToWorld([x, y - 2, z], axis, i, 0);
    if (!blockDef(world.getBlock(bx, by, bz)).solid) return false;
  }
  return true;
}

/** 横向螺旋偏移（按距离从近到远），新建门时按它找位置 */
function spiralOffsets(radius: number): Array<[number, number]> {
  const offsets: Array<[number, number]> = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) > radius) continue;
      offsets.push([dx, dz]);
    }
  }
  return offsets.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
}

/** 竖直扫描顺序：先试目标高度，再一上一下地往外找（原版也尽量贴着目标 y 放门） */
function verticalOffsets(range: number): number[] {
  const offsets: number[] = [0];
  for (let i = 1; i <= range; i++) offsets.push(-i, i);
  return offsets;
}

/**
 * 在目标点附近找一块能新建门的地方。
 *
 * 扫描范围：横向 `radius` 格的螺旋（由近到远）× 竖直 ±`PORTAL_SEARCH_HEIGHT`（由近到远），
 * 命中第一个能放的位置就返回——所以**常见的落地是第一次就命中**，
 * 只有"目标点整片是实心岩层"时才会把预算用满（那也只是几十次读方块级别的开销）。
 *
 * ⚠️ 为什么不"整根柱子从上往下扫"当兜底：净空 160 格的下界 × 81 个横向偏移 × 2 个轴向
 * 是几百万次读方块，会在传送那一瞬间卡住半秒。宁可放弃（调用方把人放在目标坐标上），
 * 也不要为了极少数情况让每次传送都担这个风险。
 */
export function findPortalSite(
  world: PortalWorld,
  x: number,
  y: number,
  z: number,
  preferAxis: PortalAxis,
  dimension: DimensionId = Dimension.OVERWORLD,
  radius = PORTAL_SITE_RADIUS,
): PortalShape | null {
  const axes: PortalAxis[] = preferAxis === 'x' ? ['x', 'z'] : ['z', 'x'];
  const range = dimensionYRange(dimension);

  for (const [dx, dz] of spiralOffsets(radius)) {
    for (const dy of verticalOffsets(PORTAL_SEARCH_HEIGHT)) {
      const by = Math.floor(y) + dy;
      if (by < range.min || by > range.max) continue;
      for (const axis of axes) {
        if (canBuildPortalAt(world, Math.floor(x) + dx, by, Math.floor(z) + dz, axis)) {
          return { axis, x: Math.floor(x) + dx, y: by, z: Math.floor(z) + dz, width: NEW_PORTAL_WIDTH, height: NEW_PORTAL_HEIGHT };
        }
      }
    }
  }
  return null;
}

/** 照着一块地方把门建出来（黑曜石框 + 门方块）；@returns 是否全部写成功 */
export function buildPortal(world: PortalWorld, shape: PortalShape): boolean {
  let ok = true;
  for (const [x, y, z] of portalFrame(shape)) {
    if (!world.setBlock(x, y, z, Block.OBSIDIAN, 0)) ok = false;
  }
  const filled = fillPortalBlocks(world, shape);
  return ok && filled === shape.width * shape.height;
}

// ---------------------------------------------------------------- 传送坐标

export interface PortalTarget {
  dimension: DimensionId;
  x: number;
  y: number;
  z: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 主世界/末地 → 下界：等高线不缩放，横向 ÷8，竖直按高度比例 */
function toNetherY(y: number): number {
  return clamp(Math.round((y * NETHER_HEIGHT) / OVERWORLD_HEIGHT), NETHER_MIN_Y, NETHER_MAX_Y);
}

function toOverworldY(y: number): number {
  return clamp(Math.round((y * OVERWORLD_HEIGHT) / NETHER_HEIGHT), OVERWORLD_MIN_Y, OVERWORLD_MAX_Y);
}

/**
 * 门的另一边在哪。
 *
 * 目标维度与原版 `NetherPortalBlock#getPortalDestination` 一致：
 * **在下界就去主世界，否则都去下界**（所以在末地建的传送门也是通往下界的）。
 */
export function portalTarget(from: DimensionId, x: number, y: number, z: number): PortalTarget {
  if (from === Dimension.NETHER) {
    return { dimension: Dimension.OVERWORLD, x: x * NETHER_SCALE, y: toOverworldY(y), z: z * NETHER_SCALE };
  }
  return { dimension: Dimension.NETHER, x: x / NETHER_SCALE, y: toNetherY(y), z: z / NETHER_SCALE };
}

// ---------------------------------------------------------------- 框被拆掉

/**
 * 框被拆掉之后，把那一片**已经不合法的**门方块清掉。
 *
 * 原版是门方块自己在邻居变化时重算 `canSurvive`；这里反过来做——
 * 玩家敲掉黑曜石时主动查一次相邻的门方块（一次破坏最多几十次读方块，开销可忽略），
 * 逻辑集中在一处，也更好断言。
 *
 * @returns 被清掉的那些格子的坐标（联机时要把这次改动广播出去，因此返回明细而不是数量）
 */
export function clearBrokenPortalsAround(
  world: PortalWorld,
  x: number,
  y: number,
  z: number,
): Array<[number, number, number]> {
  // 取 3×3×3（26 个邻居）而不是 6 个正面邻居：门方块与框的**斜角**
  // 只在对角上相邻——敲掉框的四个底角时，逐个查 6 邻居一个门方块都碰不到，
  // 门就会留在原地（实测踩过：敲角不熄火）
  const removed: Array<[number, number, number]> = [];
  const handled = new Set<string>();

  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const px = x + dx;
        const py = y + dy;
        const pz = z + dz;
        if (world.getBlock(px, py, pz) !== Block.NETHER_PORTAL) continue;
        // 同一片门方块会被多个邻居命中，判过一次就跳过
        const shape = shapeAt(world, px, py, pz);
        if (shape) continue; // 框还完整：这一下拆的不是它的框，门继续亮着
        const axis: PortalAxis = portalAxisIsZ(world.getState?.(px, py, pz) ?? 0) ? 'z' : 'x';
        for (const cell of brokenCluster(world, px, py, pz, axis)) {
          const key = `${cell[0]},${cell[1]},${cell[2]}`;
          if (handled.has(key)) continue;
          handled.add(key);
          const [cx, cy, cz] = cell;
          if (world.setBlock(cx, cy, cz, Block.AIR, 0)) removed.push(cell);
        }
      }
    }
  }
  return removed;
}

/** 从一格门方块出发、漫出整片（已经不合法、待清除的）门方块 */
function brokenCluster(
  world: PortalWorld,
  x: number,
  y: number,
  z: number,
  axis: PortalAxis,
): Array<[number, number, number]> {
  const origin: [number, number, number] = [x, y, z];
  const key = (u: number, dy: number) => (u + 32) * 64 + (dy + 32);
  const seen = new Set<number>();
  const cells: Array<[number, number, number]> = [];
  const stack: Array<[number, number]> = [[0, 0]];

  while (stack.length > 0) {
    const [u, dy] = stack.pop()!;
    if (u < -32 || u > 31 || dy < -32 || dy > 31) continue;
    const k = key(u, dy);
    if (seen.has(k)) continue;
    const [wx, wy, wz] = planeToWorld(origin, axis, u, dy);
    if (world.getBlock(wx, wy, wz) !== Block.NETHER_PORTAL) continue;
    seen.add(k);
    if (seen.size > PORTAL_MAX_WIDTH * PORTAL_MAX_HEIGHT) return cells;
    cells.push([wx, wy, wz]);
    stack.push([u + 1, dy], [u - 1, dy], [u, dy + 1], [u, dy - 1]);
  }
  return cells;
}
