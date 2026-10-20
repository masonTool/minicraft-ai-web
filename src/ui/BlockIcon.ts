/**
 * 方块物品的等轴（iso）图标
 *
 * **为什么要有这个文件**：`ItemIcon` 原来只把图集里的一格放大铺满槽位，而方块物品
 * 在注册表里取的是 `def.tiles[2]`（**侧面**）——于是背包里的泥土/圆石都是一张平面
 * 正方形。原版方块物品的图标是**等轴投影的立方体**：顶面一个菱形 + 左右两个侧面，
 * 逐面亮度不同（顶最亮、左次之、右最暗）。差的就是这一层。
 *
 * 实现上仍然**不需要任何图片素材**：拿 `BlockDef.tiles` 的 [顶, 底, 侧] 三张贴图，
 * 在离屏 canvas 上用三次仿射变换把它们拼到立方体的三个可见面上。
 *
 * ## 性能（这是"会不会变慢"的答案）
 *
 * - 每个方块只拼**一次**，结果按 blockId 缓存在 `cache` 里：
 *   34×34×4B ≈ 4.6KB，且只缓存真正被画过的方块（背包一次只画当前页）。
 * - 绘制热路径仍然只有**一次** `drawImage`（把缓存画布放大到槽位）——
 *   与改造之前逐帧开销完全相同，没有多一次变换、没有多一次采样。
 * - 冷启动代价：一个方块 = 3 次 `drawImage` + 3 次 `fill`，画布 34×34。
 *   一页创造栏约 50 格，全部冷启动也在 1ms 量级，且只发生一次。
 *
 * ## 哪些形状走等轴、哪些走平面
 *
 * 原版只有"看起来是个块"的东西才画成立方体；门、活板门、火把、梯子、植物在物品栏里
 * 本来就是**平面精灵图**。所以这里也给出一份明确的"平面"名单（形状 → null），
 * 而不是硬把所有方块都塞成立方体——否则一扇门会变成一个实心木箱。
 */

import { blockDef } from '../core/registry/blocks.ts';
import type { BlockShape } from '../core/registry/blockState.ts';
import { TILE_SIZE, type TextureAtlas } from '../render/TextureAtlas.ts';

/**
 * 缓存画布的边长（px）。
 *
 * 一个整方块投影出来正好是 32×32（见 `UNIT`），四周各留 1px 边距 → 34。
 * 不做成可变尺寸：图标最后总会被缩放显示，这里统一分辨率反而保证"同一批图标笔触一致"。
 */
export const ISO_ICON_SIZE = 34;

/** 投影单位：1 个方块边长 → 屏上水平 16px、竖直 16px（经典 2:1 等轴） */
const UNIT = 16;

/** 画布中心（= 整方块包围盒的中心） */
const OFFSET = ISO_ICON_SIZE / 2;

/** 逐面明暗：顶面不压暗，+Z（左前）压 18%，+X（右前）压 32% */
const SHADE_TOP = 0;
const SHADE_LEFT = 0.18;
const SHADE_RIGHT = 0.32;

/** 一个按**单位立方体**坐标描述的盒子（0..1 = 整格），用于描述各种方块形状 */
export interface IsoBox {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): IsoBox {
  return { x0, x1, y0, y1, z0, z1 };
}

/**
 * 形状 → 要画的盒子（**按绘制顺序**，后面的压在前面的上面）。
 * 返回 `null` 表示这类形状在物品栏里就该是平面精灵图（与原版一致）。
 *
 * 这里刻意不追求几何精确（楼梯的两个盒子、脚手架的四根柱子都不是原版的真实模型），
 * 只要求"缩到 32px 还认得出来"——原版物品图标也是这个取舍。
 */
export function isoBoxesForShape(shape: BlockShape): readonly IsoBox[] | null {
  switch (shape) {
    case 'cube':
      return [box(0, 1, 0, 1, 0, 1)];

    case 'slab':
      return [box(0, 1, 0, 0.5, 0, 1)];

    /** 下半台阶 + 上半台阶的一半（放在 -Z 那一侧，投出来就在左上，读起来像台阶） */
    case 'stairs':
      return [box(0, 1, 0, 0.5, 0, 1), box(0, 1, 0.5, 1, 0, 0.5)];

    /** 栅栏：两根横杆 + 中间一根立柱（横杆先画，立柱压在它上面） */
    case 'fence':
      return [
        box(0, 1, 0.5625, 0.6875, 0.4375, 0.5625),
        box(0, 1, 0.1875, 0.3125, 0.4375, 0.5625),
        box(0.375, 0.625, 0, 1, 0.375, 0.625),
      ];

    /** 墙：一整片墙板 + 中间加厚的墙柱 */
    case 'wall':
      return [box(0, 1, 0.0625, 1, 0.4375, 0.5625), box(0.375, 0.625, 0, 1, 0.25, 0.75)];

    /** 木桶 / 堆肥桶这类"有边框的桶"：桶身略内缩，顶上压一圈桶沿 */
    case 'composter':
      return [box(0.0625, 0.9375, 0, 0.875, 0.0625, 0.9375), box(0, 1, 0.875, 1, 0, 1)];

    /** 头：8/16 见方、8/16 高，坐在地面上 */
    case 'head':
      return [box(0.25, 0.75, 0, 0.5, 0.25, 0.75)];

    /** 仙人掌：四面向内缩 1px */
    case 'cactus':
      return [box(0.0625, 0.9375, 0, 1, 0.0625, 0.9375)];

    /** 雪层：按 2 层（1/4 格）画，与原版图标高度一致 */
    case 'snow':
      return [box(0, 1, 0, 0.25, 0, 1)];

    /** 营火：7/16 高的一堆柴 */
    case 'campfire':
      return [box(0, 1, 0, 0.4375, 0, 1)];

    /** 蛋糕：半格高、四边内缩 1px */
    case 'cake':
      return [box(0.0625, 0.9375, 0, 0.5, 0.0625, 0.9375)];

    /** 花盆：矮矮的一个小盆 */
    case 'flower_pot':
      return [box(0.25, 0.75, 0, 0.375, 0.25, 0.75)];

    /**
     * 脚手架：四根角柱 + 顶上那块站人的板。
     * 柱子按"远 → 近"排（x+z 小的先画），板最后画，正好压住柱顶。
     */
    case 'scaffolding':
      return [
        box(0, 0.125, 0, 0.9375, 0, 0.125),
        box(0, 0.125, 0, 0.9375, 0.875, 1),
        box(0.875, 1, 0, 0.9375, 0, 0.125),
        box(0.875, 1, 0, 0.9375, 0.875, 1),
        box(0, 1, 0.9375, 1, 0, 1),
      ];

    /** 漏斗：上面一个方斗 + 下面一根细管 */
    case 'hopper':
      return [box(0.25, 0.75, 0, 0.5, 0.25, 0.75), box(0, 1, 0.5, 1, 0, 1)];

    /** 投掷器 / 发射器：整格（铁皮纹路在贴图上，凸口在 32px 下看不出来） */
    case 'dropper':
    case 'dispenser':
      return [box(0, 1, 0, 1, 0, 1)];

    /** 床：9/16 高，顶面是床垫（`tiles[0]`） */
    case 'bed':
      return [box(0, 1, 0, 0.5625, 0, 1)];

    /** 阳光传感器：1/16 薄板，顶面那圈蓝色格子由贴图表达 */
    case 'daylight_detector':
      return [box(0, 1, 0, 0.0625, 0, 1)];

    /** 灯笼（批次 200）：小灯身 + 提环 */
    case 'lantern':
      return [box(0.3125, 0.6875, 0, 0.5625, 0.3125, 0.6875), box(0.4375, 0.5625, 0.5625, 0.6875, 0.4375, 0.5625)];

    // ---- 以下保持平面图标：原版在物品栏里也是精灵图 ----
    // 门/活板门/栅栏门：一整片门板，画成立方体会变成实心木箱
    case 'door':
    case 'trapdoor':
    case 'fence_gate':
    // 火把 / 梯子 / 锁链 / 避雷针：细长条，做成盒子在 32px 下只剩一根糊掉的柱子
    case 'torch':
    case 'ladder':
    case 'chain':
    case 'lightning_rod':
    // 玻璃板：本来就该透
    case 'pane':
    // 告示牌 / 展示框 / 画：一张薄片挂在墙上，原版图标也是精灵图
    case 'sign':
    case 'item_frame':
    case 'painting':
    // 十字植物（草/花/蘑菇/甘蔗/树苗/作物/下界疣）与珊瑚扇、可可豆、藤蔓、绊线、睡莲、红石粉
    // 旗帜（批次 484）/ 钟（批次 490）：物品栏里按平面精灵图
    case 'banner':
    case 'bell':
    case 'cross':
    case 'nether_wart':
    case 'coral_fan':
    case 'cocoa':
    case 'vine':
    case 'tripwire':
    case 'tripwire_hook':
    case 'lily_pad':
    case 'flat':
    // 铁轨（批次 481）：物品栏里按平面精灵图（与原版一致，坡道也是）
    case 'rail':
    // 流体不可能是方块物品（`items.ts` 注册时跳过 `liquid`），这里只是把联合类型收全
    case 'fluid':
      return null;
  }
}

type Pt = { x: number; y: number };

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

const toHex = (rgb: number): string => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;

function facePath(ctx: CanvasRenderingContext2D, o: Pt, e1: Pt, e2: Pt): void {
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + e1.x, o.y + e1.y);
  ctx.lineTo(o.x + e1.x + e2.x, o.y + e1.y + e2.y);
  ctx.lineTo(o.x + e2.x, o.y + e2.y);
  ctx.closePath();
}

/**
 * 画一个面：`o` 是贴图 (0,0) 那一角落在屏幕上的位置，`e1`/`e2` 是贴图两条边
 * 在屏幕上的整条向量（长度对应整张 16px 贴图）。
 */
function drawFace(
  ctx: CanvasRenderingContext2D,
  atlas: TextureAtlas,
  tile: string,
  o: Pt,
  e1: Pt,
  e2: Pt,
  shade: number,
): void {
  // 坐标一律按"画布像素"算，不承接上一个面留下的变换
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // ① **实心面**先用这张贴图的平均色把平行四边形铺满。
  //    为什么：canvas 画斜边一定带抗锯齿，只贴图的话两个面交界会留下半透明的发丝缝，
  //    放大之后就是一道亮线。垫一层同色底，缝里透出来的是"这个方块自己的颜色"。
  //
  //    带透明洞的贴图（玻璃 / 树叶 / 刷怪笼）**不能垫**——垫了就变成实心方块了。
  //    这一档只损失一点点缝隙观感，换来的是"玻璃仍然是玻璃"。
  if (atlas.tileOpacity(tile) >= 0.99) {
    facePath(ctx, o, e1, e2);
    ctx.fillStyle = toHex(atlas.averageColor(tile));
    ctx.fill();
  }

  // ② 把贴图仿射到面上（12 个 texel 一行都不重采样，保持像素风）
  const source = atlas.tileSource(tile);
  ctx.save();
  facePath(ctx, o, e1, e2);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(e1.x / TILE_SIZE, e1.y / TILE_SIZE, e2.x / TILE_SIZE, e2.y / TILE_SIZE, o.x, o.y);
  ctx.drawImage(atlas.canvas, source.x, source.y, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // ③ 逐面压暗（`source-atop` 只作用在已有的不透明像素上，透明区域不会被染黑）
  if (shade > 0) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
    ctx.fillRect(0, 0, ISO_ICON_SIZE, ISO_ICON_SIZE);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/**
 * 三维点 → 屏幕点（**未居中**）。经典 2:1 等轴：
 * +X/+Z 各往右下/左下各 8px，+Y 往上 16px（即 1 个方块边长 = 16px）。
 *
 * 单独导出是为了让离线测试能验证"整方块投影出来正好 32×32"——
 * 这条几何关系错一点（比如竖直用 8 而不是 16），图标就会变成扁的，肉眼很难立刻发现。
 */
export function isoProject(x: number, y: number, z: number): Pt {
  return {
    x: (x - z) * UNIT,
    y: (x + z) * (UNIT / 2) - y * UNIT,
  };
}

/** 一组盒子的投影包围盒（未居中） */
export function isoBounds(boxes: readonly IsoBox[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    for (const x of [b.x0, b.x1]) {
      for (const y of [b.y0, b.y1]) {
        for (const z of [b.z0, b.z1]) {
          const p = isoProject(x, y, z);
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/** 把一个方块的所有可见面画到 `canvas` 上（`canvas` 必须是 ISO_ICON_SIZE 见方） */
function paintIsoIcon(
  atlas: TextureAtlas,
  tiles: readonly [string, string, string],
  boxes: readonly IsoBox[],
  canvas: HTMLCanvasElement,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ISO_ICON_SIZE, ISO_ICON_SIZE);
  ctx.imageSmoothingEnabled = false;

  // ---- ① 先量包围盒：半格高的台阶/薄板不能贴在画布顶上，要跟着形状居中
  const { minX, minY, maxX, maxY } = isoBounds(boxes);
  const dx = OFFSET - (minX + maxX) / 2;
  const dy = OFFSET - (minY + maxY) / 2;
  const project = (x: number, y: number, z: number): Pt => {
    const p = isoProject(x, y, z);
    return { x: p.x + dx, y: p.y + dy };
  };

  // ---- ② 按数组顺序画（盒子已经按"远 → 近"排好），每个盒子画 3 个可见面
  const [topTile, , sideTile] = tiles;
  for (const b of boxes) {
    // 顶面（y = y1）：贴图的 u 沿 +X、v 沿 +Z
    const top = project(b.x0, b.y1, b.z0);
    drawFace(
      ctx,
      atlas,
      topTile,
      top,
      sub(project(b.x1, b.y1, b.z0), top),
      sub(project(b.x0, b.y1, b.z1), top),
      SHADE_TOP,
    );

    // 左前面（z = z1）：贴图的 u 沿 +X、v 沿 -Y
    const left = project(b.x0, b.y1, b.z1);
    drawFace(
      ctx,
      atlas,
      sideTile,
      left,
      sub(project(b.x1, b.y1, b.z1), left),
      sub(project(b.x0, b.y0, b.z1), left),
      SHADE_LEFT,
    );

    // 右前面（x = x1）：贴图的 u 沿 -Z、v 沿 -Y
    const right = project(b.x1, b.y1, b.z1);
    drawFace(
      ctx,
      atlas,
      sideTile,
      right,
      sub(project(b.x1, b.y1, b.z0), right),
      sub(project(b.x1, b.y0, b.z1), right),
      SHADE_RIGHT,
    );
  }
}

/**
 * 图标缓存上限。一个图标 34×34×4B ≈ 4.6KB，512 个约 2.3MB——
 * 只缓存"真的被画过"的方块，正常玩法远远到不了这个数；
 * 到顶就整体丢弃（重建一次也就几毫秒），不做 LRU，省一套容易写错的簿记。
 */
const CACHE_LIMIT = 512;

const cache = new Map<number, HTMLCanvasElement>();
let cacheRevision = -1;

/**
 * 取（必要时现拼）某个方块的等轴图标画布；该形状走平面图标、或在没有 DOM 的环境里
 * 返回 `null`，由调用方回退到原来的单格贴图。
 */
export function blockIconCanvas(atlas: TextureAtlas, blockId: number): HTMLCanvasElement | null {
  // 资源包换过贴图 → 全部作废（判据只能是像素版本号，见 `TextureAtlas.revision`）
  if (cacheRevision !== atlas.revision) {
    cache.clear();
    cacheRevision = atlas.revision;
  }

  const cached = cache.get(blockId);
  if (cached) return cached;

  const def = blockDef(blockId);
  const boxes = isoBoxesForShape(def.shape);
  if (!boxes) return null; // 平面形状：不进缓存（本来就只有一次 drawImage）

  if (typeof document === 'undefined') return null;

  if (cache.size >= CACHE_LIMIT) cache.clear();

  const canvas = document.createElement('canvas');
  canvas.width = ISO_ICON_SIZE;
  canvas.height = ISO_ICON_SIZE;
  paintIsoIcon(atlas, def.tiles, boxes, canvas);
  cache.set(blockId, canvas);
  return canvas;
}

/** 测试用：清空缓存（正常游戏流程里只靠 `atlas.revision` 失效） */
export function clearBlockIconCache(): void {
  cache.clear();
  cacheRevision = -1;
}
