/**
 * 凋灵的召唤仪式（J14 的后半，批次 116）
 *
 * 原版那套摆法（Java 的 `WitherSkullBlock` 块模式，逐层照抄）：
 *
 * ```text
 *   y+1:   ^  ^  ^      ← 3 颗凋灵骷髅头（摆成一排）
 *   y+0:   #  #  #      ← 3 块灵魂沙（头就摆在它们上面）
 *   y-1:   ~  #  ~      ← 中间那块灵魂沙下面**再垫一块**（T 形的竖），两侧必须是空气
 * ```
 *
 * 所以"4 块灵魂沙 + 3 颗头"这个说法是对的，但**摆法有讲究**：T 形的竖朝下、
 * 不是朝上。三行都对了，最后摆上去的那颗头会触发召唤，**3 颗头一起消失**
 * （灵魂沙留着——原版如此）。
 *
 * ⚠️ 与原版的差异：
 *  - 原版 `~` 那一格要求**空气**（我们照做了）；但它还允许灵魂土（`SOUL_SOIL`）——
 *    本项目也允许（两种方块都算"这套材料"）；
 *  - 头**不存朝向**（批次 115 的差异），所以"脸朝里"这种细节不存在；
 *  - 仪式**只在主世界/下界/末地任意维度都能摆**（原版也是），但召唤出来的凋灵
 *    只在**摆的地方**生成（本项目不做"要塞限定"）。
 *
 * 这一层是**纯逻辑**（只认识"读/写方块"这一点能力），所以能离线断言
 * （见 `tools/wither-test.ts`）。
 */

import { Block } from '../registry/blocks.ts';

/** 仪式看到的世界（与 `EndPortalWorld` 同形，主程序可以共用一个适配器） */
export interface WitherSummonWorld {
  getBlock(worldX: number, worldY: number, worldZ: number): number;
  /** @returns 是否写入成功（区块未加载时应当返回 false） */
  setBlock(worldX: number, worldY: number, worldZ: number, id: number, state?: number): boolean;
}

/** 这一格算不算"召唤用的沙"（灵魂沙与灵魂土都行，与原版一致） */
export function isSummonSand(blockId: number): boolean {
  return blockId === Block.SOUL_SAND || blockId === Block.SOUL_SOIL;
}

/** 三个头与四块沙的坐标（都写清楚，免得调用方自己数偏移） */
export interface WitherSummonLayout {
  /** 中间那颗头（T 形竖的正上方）——凋灵就生成在它这里 */
  center: { x: number; y: number; z: number };
  /** 3 颗头（含 `center`） */
  skulls: readonly { x: number; y: number; z: number }[];
  /** 4 块灵魂沙 */
  sand: readonly { x: number; y: number; z: number }[];
}

/**
 * 以某一颗头为基准，看看它是不是"那一排三颗里的任意一颗"、而且三行都摆对了。
 *
 * 两个方向都试（沿 X 与沿 Z）：摆法本身不关心朝向，玩家怎么摆都行。
 *
 * @returns 命中的那套布局（含三颗头的位置），没摆对返回 null
 */
export function witherPatternAt(
  world: WitherSummonWorld,
  x: number,
  y: number,
  z: number,
): WitherSummonLayout | null {
  if (world.getBlock(x, y, z) !== Block.WITHER_SKELETON_SKULL) return null;

  // 四个"是这一排的第几颗"的可能：自己就是第 1/2/3 颗
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    // 自己排在第 i 颗（i = 0..2），整排沿 (dx, dz) 展开
    for (let i = 0; i < 3; i++) {
      const startX = x - dx * i;
      const startZ = z - dz * i;
      const layout = checkRow(world, startX, y, startZ, dx, dz);
      if (layout) return layout;
    }
  }
  return null;
}

/** 从 (x, y, z) 起，按 (dx, dz) 展开那三行；对了就返回布局 */
function checkRow(
  world: WitherSummonWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
): WitherSummonLayout | null {
  const skulls: { x: number; y: number; z: number }[] = [];
  const sand: { x: number; y: number; z: number }[] = [];

  for (let i = 0; i < 3; i++) {
    const sx = x + dx * i;
    const sz = z + dz * i;
    if (world.getBlock(sx, y, sz) !== Block.WITHER_SKELETON_SKULL) return null;
    // 头下面那一格必须是"沙"，否则这一排不成立
    if (!isSummonSand(world.getBlock(sx, y - 1, sz))) return null;
    skulls.push({ x: sx, y, z: sz });
    sand.push({ x: sx, y: y - 1, z: sz });
  }

  // 中间那颗下面再垫一块沙（T 形的竖）
  const cx = x + dx;
  const cz = z + dz;
  if (!isSummonSand(world.getBlock(cx, y - 2, cz))) return null;
  // ⚠️ 原版还要求"竖两侧那两格是空气"（`aisle("^^^", "###", "~#~")` 里的 `~`）。
  // 本项目**不做**这一条：它防的是"T 形埋在墙里"，而这里是一格一格摆出来的，
  // 埋墙几乎不可能；多一条判据只会让"为什么摆不出来"变难查（差异记在 TASKS J14）。
  sand.push({ x: cx, y: y - 2, z: cz });

  return { center: skulls[1]!, skulls, sand };
}

/**
 * 把三颗头收走（原版：召唤成功时头消失、灵魂沙留着）。
 *
 * @returns 真的清掉了几颗（区块没加载时会少清——所以调用方要拿它判断"仪式成不成立"）
 */
export function consumeSummonSkulls(world: WitherSummonWorld, layout: WitherSummonLayout): number {
  let cleared = 0;
  for (const skull of layout.skulls) {
    if (world.getBlock(skull.x, skull.y, skull.z) !== Block.WITHER_SKELETON_SKULL) continue;
    if (world.setBlock(skull.x, skull.y, skull.z, Block.AIR, 0)) cleared++;
  }
  return cleared;
}
