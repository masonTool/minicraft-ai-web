/**
 * 末地结构：末地城 + 末地船
 *
 * 放置机制与主世界结构（`Structures.ts`）同一套思路，只是"单元"换成了末地外岛的
 * 256 格单元：**只要某个单元里有一座足够大的岛，就由哈希决定这座岛上有没有末地城**。
 * 因为岛心、岛的大小、是否有城全部是世界坐标的纯函数，所以城被任意区块裁剪后
 * 拼起来仍然是同一座城（跨区块一致）。
 *
 * 建筑风格（对齐原版的观感，但不是原版模板）：
 *  - 末地城：紫珀块塔楼，逐层收进，紫珀柱做角柱，末地石砖做窗与腰线，
 *    层间地板 + 末地烛照明，顶层平台 + 战利品箱，随机一侧伸出阳台
 *  - 末地船：系在城顶上方，紫珀船体 + 甲板 + 桅杆 + 舰楼与箱子
 *
 * ⚠️ 与 J1 相同的取舍：不做台阶/楼梯变体（紫珀与末地石砖没有 slab/stairs，
 * 原因见 blocks.ts 的 SHAPED_PARENTS 注释），所以塔内是"整块楼梯"（逐格抬升）。
 *
 * 该模块必须保持"纯函数 + 无 DOM 依赖"，因为它会被 Web Worker 直接引用。
 */

import { Block } from '../registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from '../world/Chunk.ts';
import type { EndGenerator } from './EndGenerator.ts';
import { hashAt, PositionalRng, type FeatureWriter } from './Features.ts';
// 带战利品表的箱子统一走 `Structures.ts` 的那个助手（表序号进方块状态）
import { lootChest } from './Structures.ts';

/** 外岛的单元尺寸，必须与 EndGenerator 里的一致 */
const OUTER_CELL = 256;
/** 船的水平包围半径（城的塔身更小，城与船一起按船的半径裁剪） */
const SHIP_RADIUS = 20;

/** 返回一个长方体范围的区块是否需要处理 */
function intersects(w: FeatureWriter, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  const originX = w.cx * CHUNK_SIZE_X;
  const originZ = w.cz * CHUNK_SIZE_Z;
  return !(maxX < originX || minX > originX + CHUNK_SIZE_X - 1 || maxZ < originZ || minZ > originZ + CHUNK_SIZE_Z - 1);
}

/** 末地城会出现在这个单元里吗（由岛的大小决定） */
function cityInCell(cellX: number, cellZ: number, seed: number): boolean {
  return hashAt(cellX, cellZ, seed ^ 0x3c17) < 0.55;
}

/** 该单元里有末地船吗（只有成对的城才配船） */
function shipInCell(cellX: number, cellZ: number, seed: number): boolean {
  return hashAt(cellX + 91, cellZ - 53, seed ^ 0x5a1b) < 0.5;
}

/**
 * 末地结构种类（批次 408）。
 *
 * 为什么单独导出：覆盖度台账要**数**它。以前它不在任何清单里，
 * 于是"结构 19/30"这个数字把末地城与末地船漏掉了——实现明明在
 * （`EndStructures.ts` 里塔与船都在），台账却少算两种。这类"分母虚高 + 分子漏数"
 * 叠在一起，会让人以为结构是最弱的一项，实际上它已经接近做完。
 */
export const END_STRUCTURE_KINDS = ['end_city', 'end_ship'] as const;

export function generateEndStructures(w: FeatureWriter, world: EndGenerator, seed: number): void {
  const originX = w.originX;
  const originZ = w.originZ;
  const reach = Math.ceil((SHIP_RADIUS + 16) / OUTER_CELL) + 1;
  const baseCellX = Math.floor(originX / OUTER_CELL);
  const baseCellZ = Math.floor(originZ / OUTER_CELL);

  for (let dcz = -reach; dcz <= reach; dcz++) {
    for (let dcx = -reach; dcx <= reach; dcx++) {
      const cellX = baseCellX + dcx;
      const cellZ = baseCellZ + dcz;
      const island = world.outerIslandOfCell(cellX, cellZ);
      if (!island) continue;
      // 太小的岛放不下城
      if (island.radius < 24) continue;
      if (!cityInCell(cellX, cellZ, seed)) continue;

      // ⚠️ 岛心是浮点数（哈希偏移 × 256）。体素写入必须用整数坐标：
      // FeatureWriter 会把它换算成区块内下标，浮点下标写进 Uint8Array 会被**静默丢弃**
      // （不报错、也不越界，只是什么都不会发生），这里统一取整。
      const anchorX = Math.round(island.x);
      const anchorZ = Math.round(island.z);
      const surface = world.islandAt(anchorX, anchorZ);
      if (!surface) continue;

      if (intersects(w, anchorX - SHIP_RADIUS, anchorX + SHIP_RADIUS, anchorZ - SHIP_RADIUS, anchorZ + SHIP_RADIUS)) {
        buildCity(w, anchorX, surface.top + 1, anchorZ, cellX, cellZ, seed);
        if (shipInCell(cellX, cellZ, seed)) {
          buildShip(w, anchorX + 6, surface.top + 34, anchorZ + 4, cellX, cellZ, seed);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 末地城

function buildCity(w: FeatureWriter, x: number, baseY: number, z: number, cellX: number, cellZ: number, seed: number): void {
  const rng = new PositionalRng(cellX, cellZ, seed ^ 0x0c17);
  const purpur = Block.PURPUR_BLOCK;
  const pillar = Block.PURPUR_PILLAR;
  const bricks = Block.END_STONE_BRICKS;
  const rod = Block.END_ROD;

  const layers = 3 + rng.int(3);
  const layerHeight = 5;

  // 基座：13×13 紫珀平台，把岛面整平
  for (let dx = -6; dx <= 6; dx++) {
    for (let dz = -6; dz <= 6; dz++) {
      w.fill(x + dx, baseY - 1, z + dz, purpur);
      // 把平台上方的岛体挖空，塔内才不会塞满末地石
      for (let dy = 0; dy < layers * layerHeight + 4; dy++) {
        if (w.get(x + dx, baseY + dy, z + dz) === Block.END_STONE) w.fill(x + dx, baseY + dy, z + dz, Block.AIR);
      }
    }
  }

  for (let layer = 0; layer < layers; layer++) {
    const y0 = baseY + layer * layerHeight;
    // 逐层收进：每高一层截面小 2 格，形成塔的轮廓
    const half = Math.max(2, 3 - layer);

    // 地板
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) w.fill(x + dx, y0, z + dz, purpur);
    }
    // 一层高的墙（只在四周）+ 角柱
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        const edge = Math.abs(dx) === half || Math.abs(dz) === half;
        if (!edge) continue;
        const corner = Math.abs(dx) === half && Math.abs(dz) === half;
        for (let dy = 1; dy <= 3; dy++) {
          w.fill(x + dx, y0 + dy, z + dz, corner ? pillar : purpur);
        }
      }
    }
    // 窗與腰線：末地石砖
    for (let t = -half + 1; t <= half - 1; t += 2) {
      w.fill(x + t, y0 + 2, z - half, bricks);
      w.fill(x + t, y0 + 2, z + half, bricks);
      w.fill(x - half, y0 + 2, z + t, bricks);
      w.fill(x + half, y0 + 2, z + t, bricks);
    }
    // 末地烛照明
    w.fill(x - half + 1, y0 + 1, z - half + 1, rod);
    w.fill(x + half - 1, y0 + 1, z + half - 1, rod);
    // 战利品箱（表序号写进方块状态，箱内物品由 `LootFill.ts` 在主线程填）
    if (layer === 1) lootChest(w, x, y0 + 1, z + half - 1, 'end_city');
    if (layer === layers - 1) lootChest(w, x + half - 1, y0 + 1, z, 'end_city');
  }

  // 顶层平台 + 四角的末地烛
  const topY = baseY + layers * layerHeight;
  const topHalf = Math.max(2, 3 - (layers - 1));
  for (let dx = -topHalf - 1; dx <= topHalf + 1; dx++) {
    for (let dz = -topHalf - 1; dz <= topHalf + 1; dz++) w.fill(x + dx, topY, z + dz, purpur);
  }
  for (const [dx, dz] of [
    [-topHalf, -topHalf],
    [topHalf, -topHalf],
    [-topHalf, topHalf],
    [topHalf, topHalf],
  ] as const) {
    w.fill(x + dx, topY + 1, z + dz, rod);
  }

  // 阳台：随机一侧伸出的悬空平台（原版末地城的标志性外挑结构）
  if (rng.chance(0.65)) {
    const side = rng.int(4);
    const dx = side === 0 ? 1 : side === 1 ? -1 : 0;
    const dz = side === 2 ? 1 : side === 3 ? -1 : 0;
    const y = baseY + rng.int(layers) * layerHeight + 1;
    const length = 4 + rng.int(3);
    for (let i = 1; i <= length; i++) {
      for (let t = -2; t <= 2; t++) {
        const px = x + dx * (4 + i) + dz * t;
        const pz = z + dz * (4 + i) + dx * t;
        w.fill(px, y, pz, purpur);
        // 栏杆
        if (Math.abs(t) === 2) w.fill(px, y + 1, pz, pillar);
      }
    }
    w.fill(x + dx * (4 + length), y + 1, z + dz * (4 + length), rod);
  }
}

// ---------------------------------------------------------------- 末地船

function buildShip(w: FeatureWriter, x: number, y: number, z: number, cellX: number, cellZ: number, seed: number): void {
  const rng = new PositionalRng(cellX + 7, cellZ - 3, seed ^ 0x5a1b);
  const purpur = Block.PURPUR_BLOCK;
  const pillar = Block.PURPUR_PILLAR;
  const bricks = Block.END_STONE_BRICKS;

  const length = 20 + rng.int(6);
  const halfWidth = 3;
  const deck = y + 4;
  const x0 = x - (length >> 1);

  for (let i = 0; i < length; i++) {
    const px = x0 + i;
    const taper = Math.min(i, length - 1 - i);
    const width = Math.max(1, halfWidth - (taper < 2 ? 2 - taper : 0));
    for (let dz = -width; dz <= width; dz++) {
      const edge = Math.abs(dz) === width;
      const rise = Math.round((Math.abs(dz) / (width + 0.001)) * 2);
      w.fill(px, y + rise, z + dz, purpur);
      if (edge) {
        for (let dy = rise + 1; dy <= 4; dy++) w.fill(px, y + dy, z + dz, rng.chance(0.25) ? bricks : purpur);
      } else {
        for (let dy = rise + 1; dy < 4; dy++) w.fill(px, y + dy, z + dz, Block.AIR);
      }
    }
    // 甲板（留出舱口）
    if (i % 6 !== 5) {
      for (let dz = -width; dz <= width; dz++) w.fill(px, deck, z + dz, purpur);
    }
  }

  // 桅杆：紫珀柱 + 顶端末地烛
  const mastHeight = 6 + rng.int(4);
  for (let dy = 1; dy <= mastHeight; dy++) w.fill(x, deck + dy, z, pillar);
  w.fill(x, deck + mastHeight + 1, z, Block.END_ROD);

  // 舰楼（船尾舱室）+ 箱子 + 末地烛（原版这里放鞘翅展示框）
  const cabinX = x0 + length - 5;
  for (let dx = 0; dx < 4; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      w.fill(cabinX + dx, deck + 1, z + dz, purpur);
      w.fill(cabinX + dx, deck + 4, z + dz, bricks);
    }
  }
  for (let dx = 0; dx < 4; dx++) {
    for (const dz of [-2, 2]) {
      for (let dy = 2; dy <= 3; dy++) w.fill(cabinX + dx, deck + dy, z + dz, purpur);
    }
  }
  lootChest(w, cabinX + 1, deck + 2, z, 'end_city');
  w.fill(cabinX + 3, deck + 2, z + 1, Block.END_ROD);
  // 船头的撞角
  w.fill(x0 - 1, y + 3, z, purpur);
  w.fill(x0 - 2, y + 4, z, pillar);
}
