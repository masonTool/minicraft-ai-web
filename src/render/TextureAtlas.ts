/**
 * 程序化纹理图集
 *
 * 为什么不用原版贴图：Mojang 的材质资源受版权保护，不能随项目分发。
 * 因此这里按原版配色风格在运行时用 Canvas 生成 16×16 的像素贴图，
 * 打包成一个横向图集（GPU 只上传 1 张纹理，保证批渲染效率）。
 *
 * P9/M10 会接入资源包（.mcpack）加载，届时官方材质由玩家自行提供。
 */

import * as THREE from 'three';
import {
  COPPER_COLORS,
  DYE_COLORS,
  TERRACOTTA_BASE,
  WOOD_TYPES,
  terracottaColor,
} from '../core/registry/colors.ts';
import { COPPER_STAGES } from '../core/registry/blocks.ts';
import { POTIONS, TIPPED_ARROWS, potionById, potionColor } from '../core/registry/potions.ts';
import { ARMOR_TYPES, ALL_ARMOR_MATERIALS } from '../core/registry/armor.ts';
import { ALL_TOOL_MATERIALS, TOOL_KINDS } from '../core/registry/tools.ts';
// 刷怪蛋（批次 174）：蛋形只有一副，颜色取自该生物自己的 bodyColor/accentColor ——
// 不为 21 枚蛋各写一份配色（那样"改了僵尸的绿"两边就会分家）
import { SPAWN_EGG_SPECS, spawnEggTile } from '../core/registry/spawnEggs.ts';
import { mobTypeById } from '../core/entity/mobs.ts';

import { ATLAS_COLUMNS, TILE_ORDER, TILE_SIZE } from './atlasLayout.ts';

export { ATLAS_COLUMNS, TILE_SIZE, TILE_ORDER };
export type { TileName } from './atlasLayout.ts';

const TILE_INDEX = new Map<string, number>(TILE_ORDER.map((n, i) => [n, i]));

/** 确定性随机数（xorshift32），保证每次生成的贴图完全一致 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type RGBA = [number, number, number, number];
type Painter = (x: number, y: number, rng: () => number) => RGBA;

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

function noisy(base: number, spread: number, tint: [number, number, number] = [1, 1, 1]): Painter {
  return (_x, _y, rng) => {
    const v = base + (rng() * 2 - 1) * spread;
    return [clamp255(v * tint[0]), clamp255(v * tint[1]), clamp255(v * tint[2]), 255];
  };
}

/**
 * 低频簇的"色相偏移"强度（批次 237）。
 *
 * 原版 16×16 的草地里同时有偏黄的、偏蓝的像素（同一块地里有好几种绿），
 * 而纯 `base × tint` 只能沿一条直线做明暗 —— 近看就是"单色塑料上刷了噪点"。
 * 这里让**亮簇偏暖、暗簇偏冷**，幅度按 tint 自身的彩度缩放：
 * 石头 / 铁块（灰）彩度为 0，一点都不会被染花；草 / 土 / 沙 / 叶则多出一层自然色差。
 */
const CLUSTER_HUE = 0.14;

/**
 * 双尺度噪声：4×4 的粗粒起伏 + 逐像素的细粒噪点。
 * 单用 2×2 聚簇会在草地上形成明显的棋盘格，双尺度叠加才接近原版观感。
 *
 * 批次 237 起，粗粒那一层**同时驱动色相**：亮簇偏黄、暗簇偏蓝（见 `CLUSTER_HUE`）。
 */
function layered(base: number, coarse: number, fine: number, tint: [number, number, number] = [1, 1, 1]): Painter {
  const coarseCache = new Map<number, number>();
  // 彩度只由 tint 决定，逐像素再算一次是白费
  const chroma = Math.max(tint[0], tint[1], tint[2]) - Math.min(tint[0], tint[1], tint[2]);
  return (x, y, rng) => {
    const key = (y >> 2) * 4 + (x >> 2);
    let c = coarseCache.get(key);
    if (c === undefined) {
      c = rng();
      coarseCache.set(key, c);
    }
    const cluster = c * 2 - 1;
    const v = base + cluster * coarse + (rng() * 2 - 1) * fine;
    // 暖 / 冷：红与蓝反向偏，绿只跟一点点（不然会从"黄绿↔青绿"滑到"橙↔紫"）
    const warm = cluster * CLUSTER_HUE * chroma;
    return [
      clamp255(v * tint[0] * (1 + warm)),
      clamp255(v * tint[1] * (1 + warm * 0.15)),
      clamp255(v * tint[2] * (1 - warm * 0.9)),
      255,
    ];
  };
}

/**
 * 矿石贴图：在基岩贴图上按 2×2 小块撒矿点，接近原版"石头里嵌矿粒"的观感。
 */
function oreTexture(base: Painter, spots: readonly (readonly [number, number, number])[], ratio: number, salt: string): Painter {
  return (x, y, rng) => {
    const key = (y >> 1) * 8 + (x >> 1);
    const h = hashString(`${salt}${key}`);
    if (h % 1000 < ratio * 1000) {
      const spot = spots[h % spots.length]!;
      const jitter = rng() * 26 - 13;
      return [clamp255(spot[0] + jitter), clamp255(spot[1] + jitter), clamp255(spot[2] + jitter), 255];
    }
    return base(x, y, rng);
  };
}

const STONE_BASE = () => layered(128, 10, 8);
const DEEPSLATE_BASE = () => layered(84, 7, 7, [1.0, 1.0, 1.06]);

const ORE_SPOTS: Record<string, readonly (readonly [number, number, number])[]> = {
  coal: [
    [34, 34, 36],
    [46, 46, 48],
  ],
  iron: [
    [216, 175, 147],
    [196, 152, 122],
  ],
  copper: [
    [224, 132, 84],
    [178, 100, 62],
  ],
  gold: [
    [252, 220, 80],
    [220, 186, 60],
  ],
  redstone: [
    [200, 30, 30],
    [150, 20, 20],
  ],
  lapis: [
    [40, 70, 190],
    [28, 48, 140],
  ],
  diamond: [
    [95, 235, 230],
    [64, 200, 200],
  ],
  emerald: [
    [60, 220, 110],
    [40, 170, 84],
  ],
};

/**
 * 物品图标：在 16×16 中央画一个边缘不规则的小块（原版物品图标基本都是这种"一块东西"）。
 * 半径外返回全透明，方便 UI 直接叠在槽位上。
 */
function lump(colors: readonly (readonly [number, number, number])[], salt: string, radius = 5.4): Painter {
  return (x, y, rng) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const wobble = 0.78 + (hashString(`${salt}a${Math.round(angle * 10)}`) % 40) / 100;
    if (distance > radius * wobble) return [0, 0, 0, 0];
    const base = colors[hashString(`${salt}p${x},${y}`) % colors.length]!;
    // 边缘压暗，制造轻微立体感
    const shade = 0.72 + 0.4 * (1 - distance / (radius * 1.8));
    const jitter = rng() * 16 - 8;
    return [
      clamp255(base[0] * shade + jitter),
      clamp255(base[1] * shade + jitter),
      clamp255(base[2] * shade + jitter),
      255,
    ];
  };
}

/** 木棍：竖直的细长条 */
const STICK_PAINTER: Painter = (x, y, rng) => {
  const centered = Math.abs(x - 7.5);
  if (centered > 1.6 || y < 1 || y > 14) return [0, 0, 0, 0];
  const v = 150 - centered * 22 + (rng() * 14 - 7);
  return [clamp255(v * 1.1), clamp255(v * 0.78), clamp255(v * 0.42), 255];
};

/** 金属锭：上窄下宽的梯形，顶部更亮、边缘压暗 */
function ingot(colors: readonly (readonly [number, number, number])[], salt: string): Painter {
  return (x, y, rng) => {
    if (y < 5 || y > 10) return [0, 0, 0, 0];
    const t = (y - 5) / 5;
    const halfWidth = 3.8 + t * 2.6;
    const dx = Math.abs(x - 7.5);
    if (dx > halfWidth) return [0, 0, 0, 0];
    const shade = 0.86 + 0.4 * (1 - t) - (dx / halfWidth) * 0.2;
    const base = colors[hashString(`${salt}${x},${y}`) % colors.length]!;
    const jitter = rng() * 14 - 7;
    return [
      clamp255(base[0] * shade + jitter),
      clamp255(base[1] * shade + jitter),
      clamp255(base[2] * shade + jitter),
      255,
    ];
  };
}

/** 羊毛：细密绒面，颜色自带轻微明暗起伏 */
function woolPainter(rgb: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    // 用两个不同粒度的随机叠加，避免出现规则网格
    const grain = (hashString(`w${x >> 1},${y >> 1}`) % 100) / 100;
    const fine = rng();
    const shade = 0.88 + grain * 0.16 + fine * 0.08;
    const jitter = rng() * 12 - 6;
    return [
      clamp255(rgb[0] * shade + jitter),
      clamp255(rgb[1] * shade + jitter),
      clamp255(rgb[2] * shade + jitter),
      255,
    ];
  };
}

/**
 * 地毯：羊毛的织面去掉绒毛起伏，**四周一圈深色包边**。
 *
 * 地毯与羊毛在贴图上必须是**一眼能分开**的两样东西：地毯是 1/16 的薄片、平铺在地上，
 * 照抄羊毛的"细密噪点"会让它看起来像"矮一点的羊毛块"。原版地毯的识别特征就是
 * 边上一圈略深的织边，这里照此实现（外圈 ×0.8，内部只留很轻的织纹）。
 */
function carpetPainter(rgb: readonly [number, number, number]): Painter {
  const woven = woolPainter(rgb);
  return (x, y, rng) => {
    const [r, g, b] = woven(x, y, rng);
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const inner = x === 1 || y === 1 || x === 14 || y === 14;
    const shade = edge ? 0.78 : inner ? 0.93 : 1.0;
    return [clamp255(r * shade), clamp255(g * shade), clamp255(b * shade), 255];
  };
}

/**
 * 床的顶面（批次 79）：一张被子——外圈一圈深色包边，里面按 4 像素一格压线。
 *
 * 床头/床脚**共用这一张**：哪头是床头由几何（枕头凸台，见 `blockShapes.ts`）表达，
 * 所以贴图里刻意不画枕头——一旦画在角上，朝东西的床就会把枕头画到侧面去
 * （本项目没有"按朝向旋转贴图"的能力）。
 */
function bedTopPainter(rgb: readonly [number, number, number]): Painter {
  const woven = woolPainter(rgb);
  return (x, y, rng) => {
    const [r, g, b] = woven(x, y, rng);
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    // 压线：每 4 像素一道（被子上的方格），边框之外再压一道浅影
    const seam = x % 4 === 0 || y % 4 === 0;
    const shade = edge ? 0.72 : seam ? 0.9 : 1.0;
    return [clamp255(r * shade), clamp255(g * shade), clamp255(b * shade), 255];
  };
}

/** 床侧面的木框基色（橡木色，与木板同一档） */
const BED_FRAME: readonly [number, number, number] = [124, 94, 56];

/**
 * 床的侧面（批次 79）：上半是床垫的边（竖条纹），下半是木框与床腿。
 *
 * ⚠️ 床只有 9/16 高，而贴图会**整张压进这 9 像素**——所以木框刻意只占下面 6 像素：
 * 压过之后大约是 3 像素的木头，正好是"床垫底下那圈床架"的观感。
 */
function bedSidePainter(rgb: readonly [number, number, number]): Painter {
  const woven = woolPainter(rgb);
  return (x, y, rng) => {
    if (y <= 8) {
      // 床垫的边：与顶面同源的织面 + 每 4 像素一道竖缝
      const [r, g, b] = woven(x, y, rng);
      const seam = x % 4 === 0;
      const shade = seam ? 0.86 : 1.0;
      return [clamp255(r * shade), clamp255(g * shade), clamp255(b * shade), 255];
    }
    if (y === 9) {
      // 床垫与床架之间的暗缝
      return [clamp255(rgb[0] * 0.4), clamp255(rgb[1] * 0.4), clamp255(rgb[2] * 0.4), 255];
    }
    // 木框：下半段更深一点（腿部的阴影），并留一点木纹起伏
    const v = (y >= 13 ? 0.72 : 1.0) * (0.92 + rng() * 0.16);
    // 两根床腿的位置（x = 1..2 与 13..14）再压暗一档，让"有腿"看得出来
    const leg = (x >= 1 && x <= 2) || (x >= 13 && x <= 14);
    const shade = leg ? v * 0.78 : v;
    return [clamp255(BED_FRAME[0] * shade), clamp255(BED_FRAME[1] * shade), clamp255(BED_FRAME[2] * shade), 255];
  };
}

/** 砖块纹理：按 4×8 交错砌块 + 灰缝 */
function brickPainter(base: [number, number, number]): Painter {
  return (x, y, rng) => {
    const row = y >> 2; // 每 4 像素一行砖
    const offset = (row % 2) * 4;
    const mortar = y % 4 === 3 || (x + offset) % 8 === 7;
    if (mortar) {
      const v = 150 + rng() * 16;
      return [clamp255(v), clamp255(v * 0.98), clamp255(v * 0.94), 255];
    }
    const v = 1 + (rng() * 0.18 - 0.09);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

/** 染料：一小堆粉末（下半部的圆丘，中心偏亮） */
function dyePainter(rgb: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const dx = (x - 7.5) / 5.3;
    const dy = (y - 9.6) / 4.3;
    const distance = Math.hypot(dx, dy);
    if (distance > 1) return [0, 0, 0, 0];
    const shade = 1.1 - distance * 0.3;
    const jitter = rng() * 18 - 9;
    return [
      clamp255(rgb[0] * shade + jitter),
      clamp255(rgb[1] * shade + jitter),
      clamp255(rgb[2] * shade + jitter),
      255,
    ];
  };
}

/** 錾制方块：外圈描边 + 内框 + 中心纹样，模拟原版的雕刻图案 */
function chiseledPainter(base: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const outerBorder = x === 0 || y === 0 || x === 15 || y === 15;
    const innerBorder = x === 3 || y === 3 || x === 12 || y === 12;
    const core = x >= 6 && x <= 9 && y >= 6 && y <= 9;
    const shade = outerBorder ? 0.7 : innerBorder ? 1.12 : core ? 0.82 : 0.97;
    const v = shade + (rng() * 0.1 - 0.05);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

// ---------------------------------------------------------------- 木材贴图

/** 原木侧面：竖直木纹条纹 */
function barkPainter(base: readonly [number, number, number], spotted = false): Painter {
  return (x, _y, rng) => {
    // 白桦的树皮是白底 + 黑色斑块，单独处理
    if (spotted && hashString(`birch${x},${Math.floor(rng() * 3)}`) % 5 === 0) {
      const v = 0.45 + rng() * 0.15;
      return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
    }
    const streak = Math.sin(x * 1.7) * 0.09;
    const v = 1 + streak + (rng() * 0.12 - 0.06);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

/** 原木顶面：同心年轮 */
function logTopPainter(base: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    const v = 1 + Math.sin(d * 2.4) * 0.11 + (rng() * 0.1 - 0.05);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

/** 木板：横向板条 + 交错竖缝 */
function planksPainter(base: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const plankRow = y % 4 === 3 ? -0.15 : 0;
    const seam = (x + (Math.floor(y / 4) % 2) * 8) % 8 === 0 ? -0.07 : 0;
    const v = 1 + plankRow + seam + (rng() * 0.08 - 0.04);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

/**
 * 树叶：颗粒 + 少量镂空（alphaTest 会把这些洞裁掉）
 *
 * 批次 237：在逐像素颗粒之下再压一层 **4×4 一簇** 的色相起伏（亮簇偏黄绿、暗簇偏青绿）。
 * 原版树冠远看"一片叶子里有好几种绿"就是这一层；纯逐像素抖动退到几格以外就糊成一个绿团。
 */
function leavesPainter(base: readonly [number, number, number], alpha = 255): Painter {
  return (x, y, rng) => {
    // 与 `layered` 同一个簇尺度（4×4）；5 档足够把"黄绿/正绿/青绿"分开
    const cluster = (hashString(`leafc${x >> 2},${y >> 2}`) % 5) / 4;
    const v = 1 + (cluster - 0.5) * 0.24 + (rng() * 0.34 - 0.17);
    const warm = (cluster - 0.5) * 0.34;
    const hole = hashString(`leaf${x},${y}`) % 11 === 0;
    return [
      clamp255(base[0] * v * (1 + warm * 0.55)),
      clamp255(base[1] * v * (1 + warm * 0.15)),
      clamp255(base[2] * v * (1 - warm * 0.45)),
      hole ? 150 : alpha,
    ];
  };
}

/** 染色玻璃：中间半透明、边缘更实，形成"镶边玻璃"的观感 */
function stainedGlassPainter(rgb: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    const v = border ? 0.86 : 1.08;
    const jitter = rng() * 10 - 5;
    return [
      clamp255(rgb[0] * v + jitter),
      clamp255(rgb[1] * v + jitter),
      clamp255(rgb[2] * v + jitter),
      border ? 236 : 132,
    ];
  };
}

/** 在已有画笔上叠加苔藓斑块（苔石 / 苔石砖用） */
function mossyPainter(base: Painter): Painter {
  const moss = layered(92, 8, 10, [0.52, 1.0, 0.34]);
  return (x, y, rng) => {
    // 用低频哈希决定苔藓覆盖，形成成片的斑块而不是噪点
    const coverage = hashString(`moss${x >> 1},${y >> 1}`) % 100;
    if (coverage >= 46) return base(x, y, rng);
    const [r, g, b] = moss(x, y, rng);
    const under = base(x, y, rng);
    // 苔藓不完全盖住底材，透出一点石头颜色
    return [clamp255(r * 0.85 + under[0] * 0.15), clamp255(g * 0.85 + under[1] * 0.15), clamp255(b * 0.85 + under[2] * 0.15), 255];
  };
}

/** 在砖纹上叠加裂纹 */
function crackedPainter(base: Painter, salt: string): Painter {
  return (x, y, rng) => {
    const [r, g, b] = base(x, y, rng);
    const crack = hashString(`${salt}${x},${y}`) % 23 === 0 || hashString(`${salt}${x},${y >> 1}`) % 31 === 0;
    if (!crack) return [r, g, b, 255];
    const v = 0.6;
    return [clamp255(r * v), clamp255(g * v), clamp255(b * v), 255];
  };
}

/** 陶瓦：偏土的色调 + 颗粒 + 轻微横向色带（原版陶瓦的层次感就来自这个） */
function terracottaPainter(base: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const band = Math.sin(y * 0.9) * 0.05;
    const v = 1 + band + (rng() * 0.14 - 0.07) - (x % 5 === 0 ? 0.04 : 0);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

/**
 * 混凝土**粉末**（批次 131）：沙砾感的粗颗粒 + 一点染料色。
 *
 * 与混凝土的差别是"颗粒的粗细"：混凝土是纯色 + 极细杂点（几乎看不出颗粒），
 * 粉末则用**更大的斑块**（4×4 分块取随机深浅）——原版那两兄弟也是这么分的，
 * 而这一点在物品栏里（16 色挤在一起）就是"哪个是粉末"的唯一线索。
 */
function concretePowderPainter(base: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    // 每 4×4 一块的深浅，让颗粒看得见（与鹅卵石同一个做法，只是幅度小）
    const key = (y >> 2) * 4 + (x >> 2);
    const grain = (hashString(`powder${key}`) % 20) - 10;
    const v = 1 + grain / 100 + (rng() * 0.1 - 0.05);
    // 往沙色偏一点：粉末比它的成品"土"（原版也是）
    return [
      clamp255((base[0] * 0.9 + 40) * v),
      clamp255((base[1] * 0.9 + 36) * v),
      clamp255((base[2] * 0.9 + 30) * v),
      255,
    ];
  };
}

/** 混凝土：纯色 + 极细杂点，与陶瓦的颗粒感形成对比 */
function concretePainter(base: readonly [number, number, number]): Painter {
  return (_x, _y, rng) => {
    const v = 1 + (rng() * 0.05 - 0.025);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

/** 鹅卵石：按 4×4 分块取随机灰阶，块间留暗缝（熔炉侧面也复用它） */
const cobblestonePainter: Painter = (x, y, rng) => {
  const key = (y >> 2) * 4 + (x >> 2);
  const gray = 100 + (hashString(`cob${key}`) % 60);
  const edge = x % 4 === 0 || y % 4 === 0 ? -18 : 0;
  const v = gray + edge + (rng() * 10 - 5);
  return [clamp255(v), clamp255(v), clamp255(v), 255];
};

/**
 * 破坏裂纹（10 个阶段）。
 *
 * 做法：先摆好一组裂纹线段（每条带一个"第几阶段开始出现"的门槛），
 * 某阶段的贴图只画门槛 ≤ 自己的那些线段；线段附近 1 像素内画成深灰，
 * 其余像素完全透明。这样 10 张贴图是**同一条裂纹逐渐加深**，
 * 而不是 10 个互不相干的随机图案（后者看起来像闪烁）。
 */
const CRACK_SEGMENTS: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; stage: number }> = [
  { x0: 7.5, y0: 7.5, x1: 2.5, y1: 3.5, stage: 0 },
  { x0: 7.5, y0: 7.5, x1: 12.5, y1: 4.5, stage: 0 },
  { x0: 2.5, y0: 3.5, x1: 1.5, y1: 0.5, stage: 1 },
  { x0: 12.5, y0: 4.5, x1: 15.0, y1: 2.0, stage: 2 },
  { x0: 7.5, y0: 7.5, x1: 9.5, y1: 13.5, stage: 3 },
  { x0: 7.5, y0: 7.5, x1: 3.0, y1: 12.0, stage: 4 },
  { x0: 9.5, y0: 13.5, x1: 11.5, y1: 15.0, stage: 5 },
  { x0: 3.0, y0: 12.0, x1: 1.0, y1: 14.5, stage: 6 },
  { x0: 10.5, y0: 5.0, x1: 14.0, y1: 8.5, stage: 7 },
  { x0: 5.0, y0: 10.5, x1: 2.0, y1: 8.0, stage: 8 },
  { x0: 1.5, y0: 0.5, x1: 0.5, y1: 3.0, stage: 9 },
];

/** 点到线段的最短距离 */
function distanceToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSq));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** 生成"第 stage 阶段"的裂纹画师（纯函数，同一阶段每次画都一样） */
function crackPainter(stage: number): Painter {
  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    let nearest = Infinity;
    for (const segment of CRACK_SEGMENTS) {
      if (segment.stage > stage) continue;
      const distance = distanceToSegment(px, py, segment.x0, segment.y0, segment.x1, segment.y1);
      if (distance < nearest) nearest = distance;
    }
    if (nearest > 1.1) return [0, 0, 0, 0];
    // 越靠近裂纹中心越黑、越不透明；边缘 1 像素内做渐变，避免锯齿
    const edge = Math.max(0, 1 - nearest / 1.1);
    const alpha = Math.round(255 * Math.min(1, edge * 1.6) * 0.92);
    const shade = Math.round(18 + (1 - edge) * 34);
    return [shade, shade, shade, alpha];
  };
}

const PAINTERS: Record<string, Painter> = {
  stone: STONE_BASE(),
  cobblestone: cobblestonePainter,
  dirt: layered(134, 8, 9, [1.0, 0.85, 0.68]),
  sand: layered(220, 6, 6, [1.0, 0.96, 0.78]),
  grass_top: layered(148, 7, 10, [0.62, 1.0, 0.42]),
  grass_side: (x, y, rng) => {
    const base = layered(134, 8, 9, [1.0, 0.85, 0.68])(x, y, rng);
    if (y < 3 + (hashString('gs' + x) % 2)) {
      const g = 120 + (rng() * 20 - 10);
      return [clamp255(g * 0.6), clamp255(g), clamp255(g * 0.4), 255];
    }
    return base;
  },
  // ---- 木材：6 种木头的贴图全部由 WOOD_TYPES 批量生成（见文件末尾的循环）
  bedrock: (x, y) => {
    const key = (y >> 2) * 4 + (x >> 2);
    const v = 40 + (hashString('bed' + key) % 70);
    return [clamp255(v), clamp255(v), clamp255(v), 255];
  },
  water: (x, y, rng) => {
    const v = 210 + rng() * 30;
    // 波纹条纹：两束不同频率的斜向正弦叠加，亮度波动 ±16%。
    // 这层不只是为了好看——水面的"流动感"完全靠贴图随时间滚动，
    // 贴图要是纯噪声，滚动起来几乎看不出变化（第一版就是这样，实测像素差仅 1~3）。
    const band = Math.sin((x + y * 1.6) * 0.85) * 0.5 + Math.sin((x - y * 1.2) * 0.6) * 0.5;
    const shade = 1 + band * 0.16;
    // 半透明：让海底纹理透出来（对应原版水的透明度观感）
    return [clamp255(v * 0.3 * shade), clamp255(v * 0.58 * shade), clamp255(v * shade), 168];
  },
  glass: (x, y) => {
    const border = x === 0 || y === 0 || x === TILE_SIZE - 1 || y === TILE_SIZE - 1;
    return border ? [225, 240, 250, 210] : [255, 255, 255, 26];
  },

  // ---- 地下岩石
  deepslate: DEEPSLATE_BASE(),
  granite: layered(154, 9, 9, [1.0, 0.72, 0.62]),
  diorite: layered(198, 9, 9, [1.0, 1.0, 1.03]),
  andesite: layered(132, 9, 8, [1.0, 1.01, 1.0]),
  tuff: layered(108, 8, 8, [1.0, 1.02, 0.94]),
  calcite: layered(224, 6, 5, [1.0, 1.0, 0.98]),
  // 粗金属块：原版的粗铜块偏橙粉、粗铁块偏米黄，都用大颗粒噪点表现"未精炼"的质感
  raw_copper_block: layered(200, 11, 9, [1.0, 0.62, 0.48]),
  raw_iron_block: layered(205, 10, 8, [1.0, 0.85, 0.72]),
  gravel: (x, y, rng) => {
    // 砾石：更粗的颗粒感
    const key = (y >> 1) * 8 + (x >> 1);
    const g = 120 + (hashString('grv' + key) % 50);
    const v = g + (rng() * 14 - 7);
    return [clamp255(v), clamp255(v * 0.98), clamp255(v * 0.95), 255];
  },
  clay: layered(162, 5, 5, [1.0, 1.0, 1.06]),
  sandstone: (_x, y, rng) => {
    // 砂岩侧面：带横向层理
    const band = Math.sin(y * 0.9) * 8;
    const v = 216 + band + (rng() * 8 - 4);
    return [clamp255(v), clamp255(v * 0.94), clamp255(v * 0.76), 255];
  },
  sandstone_top: layered(218, 5, 6, [1.0, 0.95, 0.78]),

  // ---- 寒冷群系
  snow: layered(242, 4, 4, [1.0, 1.0, 1.0]),
  ice: (x, y, rng) => {
    const v = 190 + rng() * 40 + Math.sin((x + y) * 0.8) * 10;
    return [clamp255(v * 0.72), clamp255(v * 0.9), clamp255(v), 190];
  },
  packed_ice: (x, y, rng) => {
    const v = 186 + rng() * 30 + Math.sin((x - y) * 0.7) * 12;
    return [clamp255(v * 0.7), clamp255(v * 0.88), clamp255(v), 236];
  },

  // ---- 特殊
  obsidian: (x, y, rng) => {
    const v = 18 + (rng() * 14);
    const streak = hashString(`obs${x},${y}`) % 7 === 0 ? 18 : 0;
    return [clamp255(v * 1.35 + streak), clamp255(v * 1.05 + streak), clamp255(v * 1.7 + streak), 255];
  },
  lava: (x, y, rng) => {
    const v = 200 + rng() * 55;
    const blob = hashString(`lava${x >> 1},${y >> 1}`) % 5 === 0 ? 40 : 0;
    return [clamp255(v), clamp255(v * 0.42 + blob), clamp255(28), 255];
  },
  glowstone: (x, y, rng) => {
    const v = 190 + rng() * 50;
    const lump = hashString(`glow${x >> 1},${y >> 1}`) % 3 === 0 ? 30 : 0;
    return [clamp255(v), clamp255(v * 0.82 + lump), clamp255(v * 0.45), 255];
  },

  // ---- 矿石
  coal_ore: oreTexture(STONE_BASE(), ORE_SPOTS.coal!, 0.3, 'coal'),
  iron_ore: oreTexture(STONE_BASE(), ORE_SPOTS.iron!, 0.3, 'iron'),
  copper_ore: oreTexture(STONE_BASE(), ORE_SPOTS.copper!, 0.3, 'copper'),
  gold_ore: oreTexture(STONE_BASE(), ORE_SPOTS.gold!, 0.3, 'gold'),
  redstone_ore: oreTexture(STONE_BASE(), ORE_SPOTS.redstone!, 0.32, 'redstone'),
  lapis_ore: oreTexture(STONE_BASE(), ORE_SPOTS.lapis!, 0.3, 'lapis'),
  diamond_ore: oreTexture(STONE_BASE(), ORE_SPOTS.diamond!, 0.3, 'diamond'),
  emerald_ore: oreTexture(STONE_BASE(), ORE_SPOTS.emerald!, 0.28, 'emerald'),
  deepslate_coal_ore: oreTexture(DEEPSLATE_BASE(), ORE_SPOTS.coal!, 0.3, 'dcoal'),
  deepslate_iron_ore: oreTexture(DEEPSLATE_BASE(), ORE_SPOTS.iron!, 0.3, 'diron'),
  deepslate_copper_ore: oreTexture(DEEPSLATE_BASE(), ORE_SPOTS.copper!, 0.3, 'dcopper'),
  deepslate_gold_ore: oreTexture(DEEPSLATE_BASE(), ORE_SPOTS.gold!, 0.3, 'dgold'),
  deepslate_redstone_ore: oreTexture(DEEPSLATE_BASE(), ORE_SPOTS.redstone!, 0.32, 'dredstone'),
  deepslate_lapis_ore: oreTexture(DEEPSLATE_BASE(), ORE_SPOTS.lapis!, 0.3, 'dlapis'),
  deepslate_diamond_ore: oreTexture(DEEPSLATE_BASE(), ORE_SPOTS.diamond!, 0.3, 'ddiamond'),
  deepslate_emerald_ore: oreTexture(DEEPSLATE_BASE(), ORE_SPOTS.emerald!, 0.28, 'demerald'),

  // ---- 物品图标
  item_coal: lump(
    [
      [34, 34, 36],
      [52, 52, 56],
    ],
    'icoal',
    5,
  ),
  item_raw_iron: lump(
    [
      [216, 175, 147],
      [190, 148, 120],
    ],
    'iiron',
  ),
  item_raw_copper: lump(
    [
      [224, 132, 84],
      [186, 104, 64],
    ],
    'icopper',
  ),
  item_raw_gold: lump(
    [
      [252, 220, 80],
      [224, 188, 60],
    ],
    'igold',
  ),
  item_redstone: lump(
    [
      [200, 30, 30],
      [148, 20, 20],
    ],
    'iredstone',
    5,
  ),
  item_lapis: lump(
    [
      [40, 70, 190],
      [28, 48, 140],
    ],
    'ilapis',
  ),
  item_diamond: lump(
    [
      [95, 235, 230],
      [64, 200, 200],
    ],
    'idiamond',
  ),
  item_emerald: lump(
    [
      [60, 220, 110],
      [40, 170, 84],
    ],
    'iemerald',
  ),
  item_stick: STICK_PAINTER,
  item_iron_ingot: ingot(
    [
      [232, 232, 232],
      [205, 205, 205],
    ],
    'iironi',
  ),
  // 铁粒（B11）：比铁锭小一圈的"一粒铁"，锁链的原料
  item_iron_nugget: lump(
    [
      [216, 216, 220],
      [180, 180, 186],
      [140, 140, 148],
    ],
    'inugget',
    3.4,
  ),
  item_gold_ingot: ingot(
    [
      [252, 232, 120],
      [232, 200, 72],
    ],
    'igoldi',
  ),
  item_copper_ingot: ingot(
    [
      [228, 152, 108],
      [190, 116, 78],
    ],
    'icopperi',
  ),
  // ---- 下界合金（K8 尾巴）：深紫灰的金属色，原版那套的观感
  item_netherite_ingot: ingot(
    [
      [126, 108, 118],
      [92, 78, 88],
    ],
    'inetheritei',
  ),
  /** 下界合金碎片：一块带棱角的暗色碎片（比锭更不规则，一眼能与锭区分） */
  item_netherite_scrap: (x, y, rng) => {
    const jitter = rng() * 12 - 6;
    const dx = x - 7.5;
    const dy = y - 8.5;
    // 上窄下宽的多边形碎片：四条边各不相同，看起来是"敲下来的一块"
    if (dy > 5.6 || dy < -5.4) return [0, 0, 0, 0];
    const halfWidth = dy < -1 ? 3.2 : dy < 3 ? 5.2 : 4.0;
    if (Math.abs(dx) > halfWidth) return [0, 0, 0, 0];
    // 斜向的暗色纹理：碎片表面有金属光泽
    const sheen = (x * 2 + y) % 9 < 3;
    const shade = (dy < -1 ? 1.2 : dy < 3 ? 1 : 0.78) * (sheen ? 1.12 : 1);
    return [clamp255(104 * shade + jitter), clamp255(88 * shade + jitter), clamp255(98 * shade + jitter), 255];
  },
  item_charcoal: lump(
    [
      [46, 42, 40],
      [66, 60, 56],
    ],
    'icharcoal',
    5,
  ),

  // ---- 功能方块
  crafting_table_top: (x, y, rng) => {
    const base = layered(150, 8, 8, [1.05, 0.82, 0.5])(x, y, rng);
    // 面板上的九宫格刻线
    const gridLine = x === 0 || y === 0 || x === 15 || y === 15 || x % 5 === 0 || y % 5 === 0;
    if (!gridLine) return base;
    const v = 118 + (rng() * 12 - 6);
    return [clamp255(v * 1.05), clamp255(v * 0.8), clamp255(v * 0.48), 255];
  },
  crafting_table_side: (x, y, rng) => {
    const base = layered(146, 8, 8, [1.05, 0.8, 0.48])(x, y, rng);
    // 侧面画一道工具箱似的横档
    if (y >= 4 && y <= 6) {
      const v = 122 + (rng() * 10 - 5);
      return [clamp255(v * 1.02), clamp255(v * 0.76), clamp255(v * 0.46), 255];
    }
    return base;
  },
  furnace_top: (x, y, rng) => {
    const base = layered(122, 9, 8)(x, y, rng);
    const distance = Math.hypot(x - 7.5, y - 7.5);
    if (distance > 3.4) return base;
    const v = 58 + rng() * 18;
    return [clamp255(v), clamp255(v), clamp255(v), 255];
  },
  furnace_side: (x, y, rng) => {
    const base = cobblestonePainter(x, y, rng);
    // 正面炉口的暗色开口
    if (x >= 3 && x <= 12 && y >= 6 && y <= 12) {
      const v = 46 + rng() * 20;
      return [clamp255(v * 1.1), clamp255(v * 0.9), clamp255(v * 0.8), 255];
    }
    return base;
  },
  chest_top: (x, y, rng) => {
    const base = layered(140, 7, 7, [1.1, 0.78, 0.44])(x, y, rng);
    if (x === 0 || y === 0 || x === 15 || y === 15) {
      return [clamp255(88), clamp255(58), clamp255(30), 255];
    }
    return base;
  },
  chest_side: (x, y, rng) => {
    const base = layered(140, 7, 7, [1.1, 0.78, 0.44])(x, y, rng);
    if (x === 0 || y === 0 || x === 15 || y === 15) {
      return [clamp255(88), clamp255(58), clamp255(30), 255];
    }
    // 中间的金属锁扣
    if (x >= 6 && x <= 9 && y >= 4 && y <= 8) {
      const v = 176 + rng() * 22;
      return [clamp255(v), clamp255(v * 0.92), clamp255(v * 0.62), 255];
    }
    return base;
  },

  // ---- 石材家族
  stone_bricks: brickPainter([124, 124, 124]),
  chiseled_stone_bricks: chiseledPainter([124, 124, 124]),
  smooth_stone: layered(158, 2, 3),
  polished_granite: layered(154, 2, 3, [1.0, 0.74, 0.65]),
  polished_diorite: layered(200, 2, 3, [1.0, 1.0, 1.03]),
  polished_andesite: layered(134, 2, 3),
  deepslate_bricks: brickPainter([88, 88, 92]),
  chiseled_deepslate: chiseledPainter([84, 84, 90]),
  bricks: brickPainter([150, 84, 66]),
  polished_deepslate: layered(90, 2, 3),
  destroy_stage_0: crackPainter(0),
  destroy_stage_1: crackPainter(1),
  destroy_stage_2: crackPainter(2),
  destroy_stage_3: crackPainter(3),
  destroy_stage_4: crackPainter(4),
  destroy_stage_5: crackPainter(5),
  destroy_stage_6: crackPainter(6),
  destroy_stage_7: crackPainter(7),
  destroy_stage_8: crackPainter(8),
  destroy_stage_9: crackPainter(9),
};

// 木材：6 种木头的 4 张贴图统一由 WOOD_TYPES 生成——加一种木头只需往配色表加一行
for (const wood of WOOD_TYPES) {
  PAINTERS[`${wood.name}_log_side`] = barkPainter(wood.bark, wood.name === 'birch');
  PAINTERS[`${wood.name}_log_top`] = logTopPainter(wood.wood);
  PAINTERS[`${wood.name}_planks`] = planksPainter(wood.wood);
  PAINTERS[`${wood.name}_leaves`] = leavesPainter(wood.leaf, wood.leafAlpha ?? 255);
}

// 石材补全：苔石与裂纹变体都是在已有画笔上叠加一层
PAINTERS.mossy_cobblestone = mossyPainter(cobblestonePainter);
PAINTERS.mossy_stone_bricks = mossyPainter(brickPainter([124, 124, 124]));
PAINTERS.cracked_stone_bricks = crackedPainter(brickPainter([124, 124, 124]), 'csb');
PAINTERS.cracked_deepslate_bricks = crackedPainter(brickPainter([88, 88, 92]), 'cdb');
PAINTERS.cobbled_deepslate = (x, y, rng) => {
  const [r, g, b] = cobblestonePainter(x, y, rng);
  return [clamp255(r * 0.62), clamp255(g * 0.62), clamp255(b * 0.68), 255];
};

// 砂岩变体：切割砂岩是整齐的砌块、平滑砂岩无纹路
PAINTERS.chiseled_sandstone = chiseledPainter([218, 210, 158]);
PAINTERS.cut_sandstone = (x, y, rng) => {
  const base = layered(214, 4, 5, [1.0, 0.96, 0.76])(x, y, rng);
  if (x % 8 !== 7 && y % 8 !== 7) return base;
  const v = 0.88 + rng() * 0.06;
  return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
};
PAINTERS.smooth_sandstone = layered(224, 2, 3, [1.0, 0.96, 0.78]);

// ---- 红沙与红砂岩（批次 45）
//
// 三张母方块贴图与普通砂岩**同源**（同一套画笔、只把色调换成红沙那种赭红），
// 这样"砂岩家族"与"红砂岩家族"在观感上是一家的两个颜色——
// 原版正是如此，而且恶地地表换成红沙之后，玩家一眼就知道该来这里挖红砂岩。
//
// 红沙比普通沙**略深、略红**：沙子是 [1.0, 0.96, 0.78] 的偏黄，
// 红沙用 [1.0, 0.66, 0.44]——再红就会像"砖粉"而不是"沙"。
PAINTERS.red_sand = layered(216, 6, 6, [1.0, 0.68, 0.46]);
PAINTERS.red_sandstone = (_x, y, rng) => {
  // 与砂岩侧面同一套横向层理，只是底色偏红
  const band = Math.sin(y * 0.9) * 8;
  const v = 190 + band + (rng() * 8 - 4);
  return [clamp255(v), clamp255(v * 0.68), clamp255(v * 0.5), 255];
};
PAINTERS.red_sandstone_top = layered(192, 5, 6, [1.0, 0.7, 0.5]);
PAINTERS.chiseled_red_sandstone = chiseledPainter([186, 130, 96]);
PAINTERS.cut_red_sandstone = (x, y, rng) => {
  const base = layered(190, 4, 5, [1.0, 0.7, 0.5])(x, y, rng);
  if (x % 8 !== 7 && y % 8 !== 7) return base;
  const v = 0.88 + rng() * 0.06;
  return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
};
PAINTERS.smooth_red_sandstone = layered(198, 2, 3, [1.0, 0.71, 0.51]);

// ---- 烟熏炉与高炉（批次 46）
//
// 三座炉子要"一眼分得开"：熔炉是圆石身（灰），烟熏炉是**木身 + 顶上冒烟口**，
// 高炉是**平滑石与铁的厚实身**。原版也是靠这三套配色区分的。
// ⚠️ 点燃时的火光外观三座炉子都没做（见 TASKS H6）。

/** 烟熏炉侧面：圆石底座 + 木板包边 + 中间那个炉口（比熔炉多一层木头） */
PAINTERS.smoker_side = (x, y, rng) => {
  const base = layered(126, 8, 8)(x, y, rng);
  // 上下两条木板包边（原版烟熏炉的侧面是"石炉 + 木框"）
  if (y <= 2 || y >= 13) {
    const wood = layered(146, 6, 6, [1.0, 0.76, 0.44])(x, y, rng);
    return wood;
  }
  // 中间炉口：比熔炉更方、更小
  if (x >= 4 && x <= 11 && y >= 6 && y <= 11) {
    const v = 52 + rng() * 18;
    return [clamp255(v * 1.15), clamp255(v * 0.92), clamp255(v * 0.76), 255];
  }
  return base;
};

/** 烟熏炉顶面：石顶 + 一块木格栅（"烟从这里出去"） */
PAINTERS.smoker_top = (x, y, rng) => {
  const base = layered(120, 8, 8)(x, y, rng);
  if (x >= 2 && x <= 13 && y >= 2 && y <= 13) {
    const wood = layered(138, 6, 6, [1.0, 0.74, 0.42])(x, y, rng);
    // 格栅：每隔一格一道深缝
    if (x % 4 === 0 || y % 4 === 0) {
      return [clamp255(wood[0] * 0.66), clamp255(wood[1] * 0.66), clamp255(wood[2] * 0.66), 255];
    }
    return wood;
  }
  return base;
};

/** 高炉侧面：平滑石身 + 上下两道铁箍 + 中间的深色炉膛 */
PAINTERS.blast_furnace_side = (x, y, rng) => {
  const base = layered(164, 5, 6)(x, y, rng);
  // 铁箍：上沿与下沿
  if (y === 1 || y === 2 || y === 13 || y === 14) {
    const jitter = rng() * 10 - 5;
    return [clamp255(150 + jitter), clamp255(152 + jitter), clamp255(160 + jitter), 255];
  }
  // 炉膛：比熔炉更宽更矮（高炉是"闷烧"）
  if (x >= 2 && x <= 13 && y >= 6 && y <= 11) {
    const v = 40 + rng() * 16;
    return [clamp255(v * 1.1), clamp255(v * 0.9), clamp255(v * 0.85), 255];
  }
  return base;
};

// ---- 点燃时的火光（批次 47）
//
// 三座炉子共用一套"炉口在燃烧"的画法：**保留原来的炉身**、只把炉口换成
// 由暗到亮的橙黄渐变（最里面最亮）。这样点亮前后的差别一眼能看出来，
// 又不会让方块看起来换了一件东西。
//
// ⚠️ 立方体只有一个侧面贴图槽，所以点亮时**四个侧面一起亮**（原版只亮正面）。

/** 一块"在燃烧的炉口"，由 y 决定亮度（越靠下越亮，像炉膛里的火） */
function burningMouth(x: number, y: number, x0: number, x1: number, y0: number, y1: number, rng: () => number): [number, number, number, number] | null {
  if (x < x0 || x > x1 || y < y0) return null;
  if (y > y1) return null;
  // 内部越靠中心越亮（距离炉口中心的比例）
  const cx = (x0 + x1) / 2;
  const inner = 1 - Math.min(1, Math.abs(x - cx) / Math.max(1, (x1 - x0) / 2));
  const v = 0.55 + inner * 0.45 * (0.75 + (y - y0) / Math.max(1, y1 - y0) * 0.25);
  const flicker = rng() * 0.12;
  return [clamp255(252 * v + flicker * 40), clamp255(150 * v + flicker * 30), clamp255(48 * v), 255];
}

/**
 * 炉口（**未点**，批次 64）：一块暗洞。
 *
 * 原版的炉子在没烧的时候，正脸就是一个黑洞——"有没有火"是它唯一的状态信息。
 * 三个炉子共用这个画法（洞口大小不同），与 `burningMouth` 是同一套几何。
 */
function darkMouth(x: number, y: number, x0: number, x1: number, y0: number, y1: number, rng: () => number, base: RGBA): RGBA {
  if (x < x0 || x > x1 || y < y0 || y > y1) return base;
  const cx = (x0 + x1) / 2;
  const inner = 1 - Math.min(1, Math.abs(x - cx) / Math.max(1, (x1 - x0) / 2));
  // 洞里：靠中心更黑、上沿略有一点反光（看得出是"凹进去"的）
  const v = 0.54 - inner * 0.3 + rng() * 0.06;
  return [clamp255(52 * v), clamp255(48 * v), clamp255(46 * v), 255];
}

PAINTERS.furnace_front = (x, y, rng) =>
  darkMouth(x, y, 3, 12, 6, 12, rng, cobblestonePainter(x, y, rng));

PAINTERS.smoker_front = (x, y, rng) => darkMouth(x, y, 4, 11, 6, 11, rng, PAINTERS.smoker_side(x, y, rng));

PAINTERS.blast_furnace_front = (x, y, rng) =>
  darkMouth(x, y, 2, 13, 6, 11, rng, PAINTERS.blast_furnace_side(x, y, rng));

PAINTERS.furnace_front_on = (x, y, rng) => {
  const mouth = burningMouth(x, y, 3, 12, 6, 12, rng);
  if (mouth) return mouth;
  return cobblestonePainter(x, y, rng);
};

PAINTERS.smoker_front_on = (x, y, rng) => {
  const mouth = burningMouth(x, y, 4, 11, 6, 11, rng);
  if (mouth) return mouth;
  return PAINTERS.smoker_side(x, y, rng);
};

PAINTERS.blast_furnace_front_on = (x, y, rng) => {
  // 高炉是"闷烧"：炉口更亮更白（温度更高）
  const mouth = burningMouth(x, y, 2, 13, 6, 11, rng);
  if (mouth) {
    const hot = 0.75 + rng() * 0.25;
    return [clamp255(252 * hot), clamp255(206 * hot), clamp255(120 * hot), 255];
  }
  return PAINTERS.blast_furnace_side(x, y, rng);
};

// ---- 营火（批次 47）
//
// 营火是"一堆柴"：侧面看到交叠的原木，顶面看到四根原木围成的一圈，
// 点燃时那圈里是火焰。**不画动态**（本项目没有方块动画），但火焰用不规则的
// 三色（白心 / 橙边 / 暗红）画出"在烧"的观感。

/** 一根原木的横截面（顶面用）：深色树皮边 + 浅色木心 */
function logRing(x: number, y: number, cx: number, cy: number, radius: number, rng: () => number): [number, number, number, number] | null {
  const d = Math.hypot(x - cx, y - cy);
  if (d > radius) return null;
  const jitter = rng() * 12 - 6;
  if (d > radius - 1.4) {
    // 树皮
    return [clamp255(112 + jitter), clamp255(78 + jitter), clamp255(42 + jitter), 255];
  }
  // 木心（年轮：中间稍深一点）
  const shade = d < radius * 0.45 ? 0.86 : 1;
  return [clamp255(178 * shade + jitter), clamp255(140 * shade + jitter), clamp255(92 * shade + jitter), 255];
}

PAINTERS.campfire_top = (x, y, rng) => {
  // 四根原木围着一圈（四个角各一根，横竖各两根）
  for (const [cx, cy] of [
    [3.5, 3.5],
    [11.5, 3.5],
    [3.5, 11.5],
    [11.5, 11.5],
  ] as const) {
    const ring = logRing(x, y, cx, cy, 3.6, rng);
    if (ring) return ring;
  }
  // 中间是灰烬
  const v = 62 + rng() * 16;
  return [clamp255(v), clamp255(v * 0.96), clamp255(v * 0.92), 255];
};

PAINTERS.campfire_fire = (x, y, rng) => {
  const center = Math.hypot(x - 7.5, y - 7.5);
  // 火焰只铺在中间那圈（原木仍在四周）
  if (center < 6.2) {
    const t = rng();
    const edge = center / 6.2;
    if (t < 0.34) return [clamp255(252), clamp255(236), clamp255(180), 255]; // 白心
    if (t < 0.72 || edge < 0.55) return [clamp255(250), clamp255(168 - edge * 30), clamp255(46), 255]; // 橙
    return [clamp255(196), clamp255(72), clamp255(24), 255]; // 暗红边
  }
  return PAINTERS.campfire_top(x, y, rng);
};

PAINTERS.campfire_side = (x, y, rng) => {
  // 侧面：两根交叠的原木（上下各一层），中间留一条缝给火。
  // 上下两层各画一道木纹（沿着 x 每隔几格深一点），看着才像"圆木"而不是两条色带
  const grain = x % 4 === 1 ? 0.86 : 1;
  const jitter = rng() * 12 - 6;
  if (y >= 2 && y <= 6) {
    return [clamp255(150 * grain + jitter), clamp255(112 * grain + jitter), clamp255(64 * grain + jitter), 255];
  }
  if (y >= 10 && y <= 14) {
    return [clamp255(124 * grain + jitter), clamp255(88 * grain + jitter), clamp255(48 * grain + jitter), 255];
  }
  // 中间的缝：能看到里面的火光（暗）或灰烬
  const v = 58 + rng() * 14;
  return [clamp255(v * 1.1), clamp255(v * 0.8), clamp255(v * 0.6), 255];
};

/** 高炉顶面：平滑石 + 中间一圈铁环与出气孔 */
PAINTERS.blast_furnace_top = (x, y, rng) => {
  const base = layered(158, 4, 6)(x, y, rng);
  const distance = Math.hypot(x - 7.5, y - 7.5);
  if (distance > 5.2) return base;
  // 铁环
  if (distance > 3.6) {
    const jitter = rng() * 8 - 4;
    return [clamp255(146 + jitter), clamp255(148 + jitter), clamp255(156 + jitter), 255];
  }
  const v = 62 + rng() * 14;
  return [clamp255(v), clamp255(v), clamp255(v * 1.05), 255];
};

// 染色玻璃：16 张由配色表生成（玻璃板复用同一张，靠几何做薄片）
for (const color of DYE_COLORS) {
  PAINTERS[`stained_glass_${color.name}`] = stainedGlassPainter(color.rgb);
}

// 陶瓦与混凝土：33 张贴图由配色表生成
PAINTERS.terracotta = terracottaPainter(TERRACOTTA_BASE);
for (const color of DYE_COLORS) {
  PAINTERS[`terracotta_${color.name}`] = terracottaPainter(terracottaColor(color.rgb));
  PAINTERS[`concrete_${color.name}`] = concretePainter(color.rgb);
  PAINTERS[`concrete_powder_${color.name}`] = concretePowderPainter(color.rgb);
}

// 羊毛与染料：16 色按配色表批量生成，避免手写 32 份几乎相同的代码
for (const color of DYE_COLORS) {
  PAINTERS[`wool_${color.name}`] = woolPainter(color.rgb);
  PAINTERS[`dye_${color.name}`] = dyePainter(color.rgb);
}

// 地毯（批次 37）：同样 16 色批量生成——它是"羊毛族的薄片"，配色与羊毛同源
for (const color of DYE_COLORS) {
  PAINTERS[`carpet_${color.name}`] = carpetPainter(color.rgb);
}

// 床（B13，批次 79）：16 色 × 2 张（顶面 = 被子、侧面 = 床垫边 + 木框），
// 材质与羊毛/地毯同源（原版的床就是羊毛做的），只有花纹不同
for (const color of DYE_COLORS) {
  PAINTERS[`bed_${color.name}_top`] = bedTopPainter(color.rgb);
  PAINTERS[`bed_${color.name}_side`] = bedSidePainter(color.rgb);
}

/** 火把：木柄 + 顶端火焰 */
PAINTERS.torch = (x, y, rng) => {
  const centered = Math.abs(x - 7.5);
  // 火焰（顶部 3 像素）
  if (y <= 3) {
    if (centered > 2.2 - y * 0.4) return [0, 0, 0, 0];
    const v = 200 + rng() * 55;
    return [clamp255(v), clamp255(v * (0.55 + y * 0.1)), clamp255(v * 0.25), 255];
  }
  // 木柄
  if (centered > 1.6 || y > 14) return [0, 0, 0, 0];
  const v = 148 - centered * 20 + (rng() * 12 - 6);
  return [clamp255(v * 1.05), clamp255(v * 0.78), clamp255(v * 0.44), 255];
};

/**
 * 灵魂火把（批次 200）：与普通火把同一个画法，**火焰换成青蓝**（灵魂火那一族）。
 *
 * 形状仍是 `torch`（3/16 粗的细柱），所以贴图也只画中间那几像素。
 */
PAINTERS.soul_torch = (x, y, rng) => {
  const centered = Math.abs(x - 7.5);
  // 火焰（顶部 3 像素）：青蓝，越靠上越白
  if (y <= 3) {
    if (centered > 2.2 - y * 0.4) return [0, 0, 0, 0];
    const v = 190 + rng() * 60;
    return [clamp255(v * 0.42), clamp255(v * 0.86), clamp255(v), 255];
  }
  // 木柄（与普通火把一模一样：区别只在火）
  if (centered > 1.6 || y > 14) return [0, 0, 0, 0];
  const v = 148 - centered * 20 + (rng() * 12 - 6);
  return [clamp255(v * 1.05), clamp255(v * 0.78), clamp255(v * 0.44), 255];
};

/**
 * 灵魂灯笼（批次 200）：**深色铁框 + 青蓝灯芯**——上下一圈更亮的沿口，中间是发光的芯。
 *
 * 方块只有 6/16 见方（`lantern` 形状），贴图画满整张也没关系：六个面都会按盒子裁。
 */
PAINTERS.soul_lantern = (x, y, rng) => {
  const jitter = rng() * 6 - 3;
  // 四边的铁框
  const edge = x <= 1 || x >= 14 || y <= 1 || y >= 14;
  if (edge) return [clamp255(78 + jitter), clamp255(72 + jitter), clamp255(64 + jitter), 255];
  // 上下沿口：比铁框亮一点，让"这是一盏灯"有体积感
  if (y <= 3 || y >= 12) return [clamp255(122 + jitter), clamp255(112 + jitter), clamp255(96 + jitter), 255];
  // 灯芯：中间的青蓝，越靠中心越亮
  const distance = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
  const v = 255 - distance * 16 + jitter;
  return [clamp255(v * 0.40), clamp255(v * 0.84), clamp255(v), 255];
};

/**
 * 锁链（B11）：中间一串铁环，四周透明（alphaTest 会裁掉，看着就是一根细链）。
 *
 * 贴图必须**只画中间那几像素**：方块形状是 3/16 粗的细柱（`chain`），
 * 画满整张贴图会变成一根方柱。
 */
PAINTERS.chain = (x, y, rng) => {
  const dx = Math.abs(x - 7.5);
  const phase = y % 4;
  // 链身：4 像素宽，每 4 像素一个"亮-暗-亮-空"的循环，才像一环扣一环
  if (dx <= 1.6) {
    const shade = phase === 0 ? 0.72 : phase === 3 ? 0.86 : 1.06;
    const v = 122 * shade + (rng() * 10 - 5);
    return [clamp255(v), clamp255(v * 0.98), clamp255(v * 1.04), 255];
  }
  // 环的侧耳：每 4 像素在两侧各点一格，链节才看得出来
  if (dx <= 2.6 && (phase === 1 || phase === 2)) {
    const v = 98 + rng() * 12;
    return [clamp255(v), clamp255(v * 0.98), clamp255(v * 1.04), 255];
  }
  return [0, 0, 0, 0];
};

/**
 * 藤蔓（B11）：一条垂下来的叶串——中间是较深的藤茎，两侧是散开的叶子，背景全透明。
 *
 * 与树叶画笔的差别：树叶是"均匀颗粒"，藤蔓必须是**竖着的一条**，
 * 否则挂在墙上看起来像一丛草。透明度只用 0 / 255（走 alphaTest 的镂空通道）。
 */
PAINTERS.vine = (x, y, rng) => {
  const dist = Math.abs(x - 7.5);
  // 越靠边越稀：边缘列有 85% 的像素被镂空，中间几乎不镂空
  const edge = dist / 7.5;
  if ((hashString(`vineedge${x},${y}`) % 100) / 100 < edge * 0.85) return [0, 0, 0, 0];
  if ((hashString(`vinehole${x},${y}`) % 9) === 0) return [0, 0, 0, 0];
  const stem = dist <= 2;
  const base = stem ? [62, 100, 46] : [82, 142, 60];
  const v = 1 + (rng() * 0.3 - 0.15);
  return [clamp255(base[0]! * v), clamp255(base[1]! * v), clamp255(base[2]! * v), 255];
};

/**
 * 铜块（批次 40）：底色 + 竖直拉丝 + 少量深色斑点，四档只是底色不同。
 *
 * 拉丝用两条不同频率的正弦叠加（1.3 与 0.7），所以拉丝是"横竖都有点"的金属质感，
 * 而不是石头的均匀噪点。
 */
function copperBlockPainter(base: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const streak = Math.sin(x * 1.3) * 0.06 + Math.sin(y * 0.7) * 0.03;
    const speck = hashString(`cu${x},${y}`) % 17 === 0 ? -0.16 : 0;
    const v = 1 + streak + speck + (rng() * 0.08 - 0.04);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

/**
 * 切制铜：2×2 的方形砌块——每 8 像素一道深缝，缝的旁边压一条高光，
 * 于是"这些铜块是被切过的"这件事一眼能看出来（与切制砂岩同一套路）。
 */
function cutCopperPainter(base: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const seam = x % 8 === 7 || y % 8 === 7;
    const highlight = !seam && (x % 8 === 0 || y % 8 === 0);
    const shade = seam ? 0.8 : highlight ? 1.1 : 1;
    const v = shade + (rng() * 0.06 - 0.03);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

for (let stage = 0; stage < COPPER_STAGES.length; stage++) {
  const base = COPPER_COLORS[stage]!;
  PAINTERS[COPPER_STAGES[stage]!.blockTile] = copperBlockPainter(base);
  PAINTERS[COPPER_STAGES[stage]!.cutTile] = cutCopperPainter(base);
}

/** 梯子：两侧立杆 + 若干横档 */
PAINTERS.ladder = (x, y, rng) => {
  const rail = x <= 2 || x >= 13;
  const rung = y % 4 === 1 || y % 4 === 2;
  if (!rail && !rung) return [0, 0, 0, 0];
  const shade = rail ? 1.0 : 0.84;
  const v = (142 + (rng() * 14 - 7)) * shade;
  return [clamp255(v * 1.06), clamp255(v * 0.78), clamp255(v * 0.44), 255];
};

/**
 * 木门 / 活板门 / 栅栏门（批次 30 起，批次 38 扩到全部 6 种木材）。
 *
 * 底色取该木材的**木板色**（直接复用 `planksPainter`），深色横档按同一底色压暗，
 * 金属件（门把手、角铁）用固定灰——所以 6 种木材一套代码生成。
 * 橡木那三张也并了进来：以前是手写的三份 `layered(146, ...)`，
 * 一旦要按木材展开，"同一族的其它木材"就必然漏掉（这个坑在木头家族上踩过一次）。
 */
function woodDarkener(base: readonly [number, number, number]): (v: number) => RGBA {
  return (v) => [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
}

/** 木门：木板底 + 上下横档与左右竖框 + 门把手 */
function doorPainter(base: readonly [number, number, number]): Painter {
  const planks = planksPainter(base);
  const dark = woodDarkener(base);
  return (x, y, rng) => {
    if (y <= 1 || y >= 14 || x <= 1 || x >= 14 || (y >= 5 && y <= 6)) {
      return dark(0.86 + rng() * 0.06);
    }
    // 门把手
    if (x >= 11 && x <= 12 && y >= 8 && y <= 9) {
      const v = 178 + rng() * 24;
      return [clamp255(v), clamp255(v * 0.94), clamp255(v * 0.66), 255];
    }
    return planks(x, y, rng);
  };
}

/** 活板门：木板打底 + 上下两道横档 + 四角铆钉 */
function trapdoorPainter(base: readonly [number, number, number]): Painter {
  const planks = planksPainter(base);
  const dark = woodDarkener(base);
  return (x, y, rng) => {
    if (y <= 1 || y >= 14 || (y >= 7 && y <= 8)) return dark(0.88 + rng() * 0.06);
    // 四角的铁件
    if ((x <= 1 || x >= 14) && (y <= 2 || y >= 13)) {
      const v = 168 + rng() * 20;
      return [clamp255(v), clamp255(v * 0.97), clamp255(v * 0.9), 255];
    }
    return planks(x, y, rng);
  };
}

/** 栅栏门：两根竖柱 + 两道横杆——与栅栏同一套木料，但中间是"门板" */
function fenceGatePainter(base: readonly [number, number, number]): Painter {
  const planks = planksPainter(base);
  const dark = woodDarkener(base);
  return (x, y, rng) => {
    if (x <= 1 || x >= 14) return dark(0.88 + rng() * 0.06);
    if ((y >= 3 && y <= 4) || (y >= 11 && y <= 12)) return dark(0.93 + rng() * 0.06);
    return planks(x, y, rng);
  };
}

for (const wood of WOOD_TYPES) {
  PAINTERS[`${wood.name}_door`] = doorPainter(wood.wood);
  PAINTERS[`${wood.name}_trapdoor`] = trapdoorPainter(wood.wood);
  PAINTERS[`${wood.name}_fence_gate`] = fenceGatePainter(wood.wood);
}

/**
 * 火焰（I12）：三束高低不一的火苗，背景全透明（走 alpha 裁剪）。
 *
 * 渐变方向与原版一致：**底部中心最亮（接近白黄）、越往上越红**。
 * 火苗高度按列取两条正弦叠加，于是边缘是锯齿状的火舌而不是一块方砖——
 * 这张贴图贴在 `cross` 的两片交叉薄面上，所以左右边缘的锯齿会被看得很清楚。
 */
PAINTERS.fire = (x, y, rng) => {
  // 每列的火苗高度（约 8~14 像素）
  const height =
    10 + Math.round(Math.sin(x * 0.8) * 2.2 + Math.sin(x * 2.1) * 1.1) + (hashString(`fire${x}`) % 3);
  const up = 15 - y; // 距底部的行数（0 = 最底一行）
  if (up > height) return [0, 0, 0, 0];

  // 靠中心与靠底部更热：t=0 在底、t=1 在火苗尖
  const t = up / Math.max(1, height);
  const center = 1 - Math.abs(x - 7.5) / 8;
  const heat = Math.max(0, Math.min(1, (1 - t) * (0.55 + center * 0.45)));
  const jitter = rng() * 16 - 8;
  return [
    clamp255(198 + heat * 57 + jitter),
    clamp255(58 + heat * 158 + jitter),
    clamp255(18 + heat * 42),
    255,
  ];
};

PAINTERS.item_clay_ball = lump(
  [
    [168, 168, 178],
    [146, 146, 158],
  ],
  'iclay',
  4.6,
);

// ---- 生物掉落物
PAINTERS.item_rotten_flesh = lump(
  [
    [122, 100, 68],
    [92, 76, 52],
  ],
  'irotten',
  5.2,
);
PAINTERS.item_bone = lump(
  [
    [238, 238, 226],
    [206, 206, 194],
  ],
  'ibone',
  4.4,
);
/**
 * 骨粉（批次 69）：一小堆**细粉**——比骨头矮而散、比火药亮。
 * 用同一个 `lump` 画法，靠"半径更大 + 颜色更浅 + 两色颗粒"区分。
 */
PAINTERS.item_bone_meal = lump(
  [
    [242, 240, 230],
    [214, 212, 200],
    [232, 230, 214],
  ],
  'ibonemeal',
  6.2,
);
PAINTERS.item_gunpowder = lump(
  [
    [112, 112, 118],
    [78, 78, 84],
  ],
  'igunpowder',
  5.4,
);
PAINTERS.item_beef = lump(
  [
    [196, 82, 82],
    [150, 56, 56],
  ],
  'ibeef',
  5.2,
);
PAINTERS.item_porkchop = lump(
  [
    [234, 154, 154],
    [190, 112, 112],
  ],
  'ipork',
  5.2,
);
PAINTERS.item_mutton = lump(
  [
    [186, 96, 92],
    [140, 66, 64],
  ],
  'imutton',
  5.2,
);
PAINTERS.item_chicken = lump(
  [
    [242, 210, 154],
    [206, 170, 118],
  ],
  'ichicken',
  5.2,
);
PAINTERS.item_leather = lump(
  [
    [166, 114, 68],
    [130, 86, 48],
  ],
  'ileather',
  5.0,
);
PAINTERS.item_feather = lump(
  [
    [246, 246, 252],
    [210, 212, 226],
  ],
  'ifeather',
  4.2,
);

// ---- 食物：熟肉就是"颜色更深的同款肉块"，水果用圆球 + 叶子
PAINTERS.item_cooked_beef = lump(
  [
    [148, 84, 52],
    [106, 58, 36],
  ],
  'icbeef',
  5.2,
);
PAINTERS.item_cooked_porkchop = lump(
  [
    [208, 138, 96],
    [162, 100, 66],
  ],
  'icpork',
  5.2,
);
PAINTERS.item_cooked_mutton = lump(
  [
    [150, 92, 60],
    [110, 64, 42],
  ],
  'icmutton',
  5.2,
);
PAINTERS.item_cooked_chicken = lump(
  [
    [196, 142, 82],
    [156, 106, 58],
  ],
  'icchicken',
  5.2,
);

/** 苹果：红色圆球 + 顶部一片绿叶 + 一点高光 */
function applePainter(rgb: readonly [number, number, number], salt: string, shine = 1.42): Painter {
  const base = lump(
    [
      [rgb[0], rgb[1], rgb[2]],
      [Math.round(rgb[0] * 0.74), Math.round(rgb[1] * 0.74), Math.round(rgb[2] * 0.74)],
    ],
    salt,
    5.6,
  );
  return (x, y, rng) => {
    // 高光：左上一小块提亮
    if (Math.hypot(x - 5.4, y - 5.4) < 1.6) {
      const v = shine + (rng() * 0.1 - 0.05);
      return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
    }
    // 果柄与叶子：中上方一竖一斜
    if (x === 8 && (y === 1 || y === 2)) return [92, 62, 34, 255];
    if ((x === 9 && y === 2) || (x === 10 && y === 1) || (x === 10 && y === 2)) return [82, 148, 62, 255];
    return base(x, y, rng);
  };
}
PAINTERS.item_apple = applePainter([212, 54, 48], 'iapple');
PAINTERS.item_golden_apple = applePainter([246, 208, 62], 'igapple', 1.5);

// ---- 附魔台与书架（H9）
/** 附魔台顶面：深色台面 + 中央一本摊开的书（红封皮 + 白书页） */
PAINTERS.enchanting_table_top = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const dx = x - 7.5;
  const dy = y - 7.5;
  // 外圈是黑曜石台面
  if (Math.abs(dx) > 6.5 || Math.abs(dy) > 6.5) return [0, 0, 0, 0];
  const edge = Math.max(Math.abs(dx), Math.abs(dy)) > 5.2;
  if (edge) return [clamp255(28 + jitter), clamp255(24 + jitter), clamp255(40 + jitter), 255];
  // 中央摊开的书：中间一道书脊，两侧书页
  if (Math.abs(dx) < 1) return [clamp255(120 + jitter), clamp255(30 + jitter), clamp255(42 + jitter), 255];
  if (Math.abs(dx) < 4 && Math.abs(dy) < 3.4) return [clamp255(232 + jitter), clamp255(226 + jitter), clamp255(206 + jitter), 255];
  return [clamp255(38 + jitter), clamp255(32 + jitter), clamp255(52 + jitter), 255];
};

/** 附魔台侧面：黑曜石底 + 上半一圈符文石 */
PAINTERS.enchanting_table_side = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  if (y < 4) {
    // 上半：符文石台面，符文用"确定的伪随机"画几道亮线
    const rune = (x * 7 + y * 13) % 11 === 0 || (x * 3 + y * 5) % 17 === 0;
    if (rune) return [clamp255(196 + jitter), clamp255(72 + jitter), clamp255(214 + jitter), 255];
    return [clamp255(96 + jitter), clamp255(74 + jitter), clamp255(118 + jitter), 255];
  }
  // 下半：黑曜石（紫黑 + 少量亮点）
  const sparkle = (x * 5 + y * 11) % 23 === 0;
  if (sparkle) return [clamp255(120 + jitter), clamp255(78 + jitter), clamp255(158 + jitter), 255];
  return [clamp255(26 + jitter), clamp255(20 + jitter), clamp255(38 + jitter), 255];
};

// ---- 剪刀（J8）
/**
 * 剪刀：两片刀刃从左侧的轴向外张开（"<" 形），轴是一小段深色。
 * 16×16 下再画手柄就糊成一团了，所以只保留最好认的那部分轮廓。
 */
const SHEARS_TEMPLATE: readonly string[] = [
  '................',
  '.......MMMM.....',
  '........MMMM....',
  '.........MMMM...',
  '..........MMM...',
  '...........MMM..',
  '............MMM.',
  '.......DD...MMM.',
  '.......DD...MMM.',
  '............MMM.',
  '...........MMM..',
  '..........MMM...',
  '.........MMMM...',
  '........MMMM....',
  '.......MMMM.....',
  '................',
];

PAINTERS.item_shears = (x, y, rng) => {
  const pixel = SHEARS_TEMPLATE[y]?.[x] ?? '.';
  if (pixel === '.') return [0, 0, 0, 0];
  const jitter = rng() * 12 - 6;
  if (pixel === 'D') return [clamp255(70 + jitter), clamp255(70 + jitter), clamp255(76 + jitter), 255];
  // 刀刃：上侧亮、下侧暗，一眼能看出是斜着的金属片
  const shade = y < 8 ? 1.12 : 0.86;
  return [clamp255(216 * shade + jitter), clamp255(216 * shade + jitter), clamp255(224 * shade + jitter), 255];
};

/**
 * 桶：上宽下窄的铁皮小桶（'M' 铁皮、'W' 桶里的白色液体）。
 * 牛奶桶就是把桶里填上白，两种物品共用同一套形状。
 */
const BUCKET_TEMPLATE: readonly string[] = [
  '................',
  '................',
  '....MMMMMMMM....',
  '...MM......MM...',
  '...MM.WWWW.MM...',
  '...MM.WWWW.MM...',
  '...MM.WWWW.MM...',
  '...MM.WWWW.MM...',
  '....MWWWWWWM....',
  '....MWWWWWWM....',
  '....MWWWWWWM....',
  '....MMMMMMMM....',
  '....MMMMMMMM....',
  '................',
  '................',
  '................',
];

/**
 * 桶里的液体颜色（批次 176 起由参数给，而不是"有没有牛奶"这一个布尔）。
 *
 * 三种桶共用同一副铁皮形状：空桶没有 `W` 像素、牛奶是白、水是青蓝、岩浆是橙红。
 * 这样加"细雪桶"时只多一行颜色，不用再抄一份带模板的画笔。
 */
type BucketFill = readonly [number, number, number];

function bucketPainter(fill: BucketFill | null): Painter {
  return (x, y, rng) => {
    const pixel = BUCKET_TEMPLATE[y]?.[x] ?? '.';
    if (pixel === '.') return [0, 0, 0, 0];
    const jitter = rng() * 12 - 6;
    if (pixel === 'W') {
      if (!fill) return [0, 0, 0, 0];
      // 液体也分左右明暗，否则桶里那块颜色是平的、看着像贴纸
      const shade = x < 8 ? 1.1 : 0.9;
      return [clamp255(fill[0] * shade + jitter), clamp255(fill[1] * shade + jitter), clamp255(fill[2] * shade + jitter), 255];
    }
    // 铁皮：左亮右暗，桶才有圆柱感
    const shade = x < 8 ? 1.12 : 0.86;
    return [clamp255(198 * shade + jitter), clamp255(198 * shade + jitter), clamp255(206 * shade + jitter), 255];
  };
}

PAINTERS.item_bucket = bucketPainter(null);
PAINTERS.item_milk_bucket = bucketPainter([246, 246, 240]);
// 水桶 / 岩浆桶（批次 176，G13）：同形状、只换液体颜色
PAINTERS.item_water_bucket = bucketPainter([70, 120, 220]);
PAINTERS.item_lava_bucket = bucketPainter([226, 108, 28]);

// ---- 炼药锅（批次 176，G13）：铁皮桶身 / 桶底 / 空锅口（看得到锅底）/ 水面
/**
 * 炼药锅的四张脸。
 *
 * 与堆肥桶那套板条的区别只在**材质**：锅身是铁的（冷灰 + 上下两道箍），
 * 空锅口是一圈铁沿 + 里面发黑的锅底，有水时顶面换成"水面 + 铁沿"。
 */
function cauldronIron(y: number, rng: () => number, shade = 1): [number, number, number, number] {
  const jitter = rng() * 10 - 5;
  // 上下两道箍（原版炼药锅最明显的特征）
  const band = y === 3 || y === 12 ? 1.14 : 1;
  const base = 132 * shade * band;
  return [clamp255(base + jitter), clamp255(base + 2 + jitter), clamp255(base + 8 + jitter), 255];
}

PAINTERS.cauldron_side = (x, y, rng) => {
  // 左亮右暗（圆柱感）+ 中间一道竖着的接缝
  const shade = x < 8 ? 1.08 : 0.9;
  return cauldronIron(y, rng, x === 7 ? 0.82 : shade);
};
PAINTERS.cauldron_bottom = (_x, y, rng) => cauldronIron(y, rng, 0.78);
/** 空锅：一圈铁沿 + 里面越深越黑（看得出锅是空的） */
PAINTERS.cauldron_top = (x, y, rng) => {
  const inset = x >= 2 && x <= 13 && y >= 2 && y <= 13;
  if (!inset) return cauldronIron(y, rng, 1.1);
  const depth = Math.min(x - 2, 13 - x, y - 2, 13 - y) / 5;
  const v = 0.34 - Math.min(0.2, depth * 0.2) + rng() * 0.04;
  return [clamp255(52 * v), clamp255(56 * v), clamp255(64 * v), 255];
};
/** 装了岩浆（批次 177）：同样的铁沿，里面是橙红的岩浆（比水面亮、带条纹） */
PAINTERS.cauldron_lava = (x, y, rng) => {
  const inset = x >= 2 && x <= 13 && y >= 2 && y <= 13;
  if (!inset) return cauldronIron(y, rng, 1.1);
  const streak = Math.sin((x * 1.7 + y * 0.6) * 1.3) * 18;
  return [clamp255(232 + streak), clamp255(112 + streak * 0.5), clamp255(28 + streak * 0.2), 255];
};

/** 有水：同样的铁沿，里面是青蓝的水面（带一点点波纹） */
PAINTERS.cauldron_water = (x, y, rng) => {
  const inset = x >= 2 && x <= 13 && y >= 2 && y <= 13;
  if (!inset) return cauldronIron(y, rng, 1.1);
  const wave = Math.sin((x + y) * 0.9) * 10;
  return [clamp255(58 + wave), clamp255(108 + wave), clamp255(196 + wave), 255];
};

// ---- 弓与箭（J9）
/** 燧石：深灰的尖锐石块（画成一块带斜面的碎石） */
PAINTERS.item_flint = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  const dx = x - 7.5;
  const dy = y - 8.5;
  // 上尖下宽的三角形，边角切掉一点显得有棱角
  if (dy > 5.5 || dy < -5.5 || Math.abs(dx) > (dy + 5.5) * 0.55 + 1.5) return [0, 0, 0, 0];
  const shade = dy < -1 ? 1.18 : dy < 2.5 ? 1 : 0.8;
  return [clamp255(74 * shade + jitter), clamp255(74 * shade + jitter), clamp255(80 * shade + jitter), 255];
};

/** 线：一团绕起来的白色细线（用交叉的斜线模拟缠绕） */
PAINTERS.item_string = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const dx = x - 7.5;
  const dy = y - 7.5;
  const r = Math.hypot(dx, dy);
  if (r > 5.6) return [0, 0, 0, 0];
  // 三组斜线 + 一圈外环，看起来像缠成一团的线
  const strand = (x + y) % 4 === 0 || (x - y + 16) % 5 === 0 || Math.abs(r - 4.6) < 0.7;
  if (!strand) return [0, 0, 0, 0];
  const shade = r > 3 ? 1 : 0.88;
  return [clamp255(238 * shade + jitter), clamp255(238 * shade + jitter), clamp255(232 * shade + jitter), 255];
};

/** 箭：斜着的木杆 + 右上角的灰色箭头 + 左下角的羽毛 */
/**
 * 箭（`tip` 给了就是**药水箭**：箭头按药水颜色染）。
 *
 * 药水箭必须一眼能分——它与普通箭在背包里挨着放，只有箭头颜色不同，
 * 但"射出去之后挂什么效果"完全取决于它是哪一支（与药水瓶子的配色同源，
 * 见数据层的 `potionColor`）。
 */
function arrowPainter(tip: readonly [number, number, number] | null = null): Painter {
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    // 杆：从左上到右下的斜线（斜着放才像一支箭）
    const along = x - y;
    if (Math.abs(along) > 1.2) return [0, 0, 0, 0];
    if (x < 2 || x > 14 || y < 1 || y > 14) return [0, 0, 0, 0];
    // 箭头在左上（x 小 y 小）
    if (x + y <= 6) {
      if (!tip) return [clamp255(196 + jitter), clamp255(196 + jitter), clamp255(202 + jitter), 255];
      return [clamp255(tip[0] * 1.05 + jitter), clamp255(tip[1] * 1.05 + jitter), clamp255(tip[2] * 1.05 + jitter), 255];
    }
    // 羽毛在右下
    if (x + y >= 22) return [clamp255(236 + jitter), clamp255(236 + jitter), clamp255(230 + jitter), 255];
    // 箭杆中段：药水箭再染一小段，这样"远远扫一眼"也能看出它不是普通箭
    if (tip && x + y >= 12 && x + y <= 16) {
      return [clamp255(tip[0] * 0.85 + jitter), clamp255(tip[1] * 0.85 + jitter), clamp255(tip[2] * 0.85 + jitter), 255];
    }
    return [clamp255(146 + jitter), clamp255(104 + jitter), clamp255(56 + jitter), 255];
  };
}

PAINTERS.item_arrow = arrowPainter();
/**
 * 橡木船图标（批次 244）：俯视的 U 形船体——外圈是木板色、内舱压暗一档。
 * 与原版那枚"从斜上方看的小船"不同，但 16×16 下"两头翘的槽"已经够认。
 */
/**
 * 铁轨（批次 245）：两根纵向钢轨 + 横向枕木。
 *
 * 画法对齐原版那 16×16：轨道沿**纵向**（z）走，枕木每 4 像素一条，
 * 钢轨压在枕木上面（所以先判钢轨，再判枕木）。透明像素留空——
 * 铁轨是 `flat` 非实心方块，空的地方就该透出脚下的地面。
 */
/**
 * 铁轨贴图的画法（批次 245/246）：两根纵向钢轨 + 横向枕木。
 *
 * 参数化的原因：普通 / 动力 / 探测三种轨道只差**颜色与亮度**（金轨、石枕木、
 * 通电发红），形状完全一样——抄三份迟早会改一处漏两处。
 *
 * @param sleeper 枕木颜色
 * @param steel 钢轨颜色
 * @param glow 通电版本：整体提亮一档（一眼看出"这条是热的"）
 */
function railPainter(
  sleeper: readonly [number, number, number],
  steel: readonly [number, number, number],
  glow = false,
): Painter {
  return (x, y) => {
    const onRail = (x >= 2 && x <= 4) || (x >= 11 && x <= 13);
    if (onRail && y > 0) {
      // 中间那一列压一道高光，看起来像有"轨面"
      const shine = (x === 3 || x === 12 ? 1.22 : 1) * (glow ? 1.28 : 1);
      return [
        clamp255(steel[0] * shine),
        clamp255(steel[1] * shine),
        clamp255(steel[2] * shine),
        255,
      ];
    }
    if (y % 4 === 2 && x > 0) {
      const grain = x % 3 === 0 ? 0.84 : 1;
      return [
        clamp255(sleeper[0] * grain),
        clamp255(sleeper[1] * grain),
        clamp255(sleeper[2] * grain),
        255,
      ];
    }
    return [0, 0, 0, 0];
  };
}

PAINTERS.rail = railPainter([104, 80, 56], [176, 176, 184]);
// 动力铁轨：金枕木 + 金轨；通电版整体提亮（原版是"金轨亮起来"）
PAINTERS.powered_rail = railPainter([150, 122, 48], [206, 172, 74]);
PAINTERS.powered_rail_on = railPainter([188, 152, 58], [245, 206, 96], true);
// 探测铁轨：石枕木 + 灰钢轨；通电版压一层红（原版是中间那块板变红）
PAINTERS.detector_rail = railPainter([116, 116, 122], [166, 166, 174]);
PAINTERS.detector_rail_on = railPainter([150, 96, 92], [226, 130, 118], true);

/**
 * 矿车图标（批次 245）：一只开口的铁皮斗 + 两个轮子。
 */
PAINTERS.item_minecart = (x, y) => {
  // 斗身（y 3~10），上宽下窄
  if (y >= 3 && y <= 10) {
    const half = 6.2 - (y - 3) * 0.35;
    if (Math.abs(x - 7.5) <= half) {
      if (y === 3) return [92, 92, 100, 255]; // 斗口压暗，读得出"是开口的"
      const shade = 0.85 + (y - 3) * 0.03;
      return [clamp255(188 * shade), clamp255(190 * shade), clamp255(198 * shade), 255];
    }
  }
  // 轮子
  const wheel = (cx: number): boolean => Math.hypot(x - cx, y - 12.5) <= 1.6;
  if (wheel(4.5) || wheel(10.5)) return [64, 64, 70, 255];
  return [0, 0, 0, 0];
};

PAINTERS.item_oak_boat = (x, y) => {
  const dy = y - 7.5;
  if (y < 4 || y > 12) return [0, 0, 0, 0];
  const half = 5.8 - Math.abs(dy) * 0.22;
  const dx = Math.abs(x - 7.5);
  if (dx > half) return [0, 0, 0, 0];
  // 内舱：中间那条更暗的"槽"，两端各留一格船帮
  if (dx < half - 1.3 && y > 5 && y < 11) return [92, 60, 32, 255];
  const shade = 0.82 + (1 - dx / half) * 0.22;
  return [clamp255(176 * shade), clamp255(124 * shade), clamp255(70 * shade), 255];
};

/**
 * 打火石（I12）：左下角一块燧石、右上角一根铁条，中间几点火星。
 * 三样东西凑在一起才认得出是"打火石"——只画铁条会像铁锭，只画燧石会像燧石。
 */
PAINTERS.item_flint_and_steel = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const dx = x - 5;
  const dy = y - 10;
  // 燧石：左下角的深灰三角
  if (dy > -4 && dy < 4 && Math.abs(dx) < (4 - Math.abs(dy)) * 0.9 + 1) {
    return [clamp255(78 + jitter), clamp255(78 + jitter), clamp255(84 + jitter), 255];
  }
  // 铁条：右上到左下的斜条（原版那把"打火的铁片"）
  const along = x + y;
  if (along >= 15 && along <= 22 && Math.abs(x - y) < 10) {
    const shade = y < 8 ? 1.15 : 0.85;
    return [
      clamp255(186 * shade + jitter),
      clamp255(186 * shade + jitter),
      clamp255(196 * shade + jitter),
      255,
    ];
  }
  // 火星：铁条下端的两三点橙黄
  if (hashString(`flintspark${x},${y}`) % 11 === 0 && x < 9 && y < 12) {
    return [clamp255(246 + jitter), clamp255(186 + jitter), clamp255(72 + jitter), 255];
  }
  return [0, 0, 0, 0];
};

// 药水箭：28 支，箭头颜色与对应的药水瓶子同源
for (const arrow of TIPPED_ARROWS) {
  const potion = potionById(arrow.potionId);
  PAINTERS[`item_${arrow.key}`] = arrowPainter(potion ? potionColor(potion) : null);
}

/** 弓：左侧木弧 + 一条弦 */
PAINTERS.item_bow = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const dx = x - 10.5;
  const dy = y - 7.5;
  const r = Math.hypot(dx, dy);
  // 弓背：一段圆弧（半径 6.5 左右）
  if (Math.abs(r - 6.5) < 1.2) {
    const shade = dy < 0 ? 1.1 : 0.9;
    return [clamp255(150 * shade + jitter), clamp255(106 * shade + jitter), clamp255(58 * shade + jitter), 255];
  }
  // 弦：竖直的一条细线
  if (x === 4 && Math.abs(dy) < 6) {
    return [clamp255(232 + jitter), clamp255(232 + jitter), clamp255(226 + jitter), 255];
  }
  return [0, 0, 0, 0];
};

// ---- 铁砧与铁块（H8）
/** 铁块：抛光金属面，比"粗铁块"平整（粗铁块有那种粗糙的层理） */
PAINTERS.iron_block = (x, y, rng) => {
  const jitter = rng() * 7 - 3.5;
  // 四边压一圈暗边，中间一道很浅的十字抛光痕，避免看起来像一块纯色板
  const edge = x < 1 || x > 14 || y < 1 || y > 14;
  const polish = x === 7 || y === 7;
  const shade = edge ? 0.84 : polish ? 1.05 : 1;
  return [clamp255(212 * shade + jitter), clamp255(212 * shade + jitter), clamp255(218 * shade + jitter), 255];
};

// ---- 睡莲（B16）
/**
 * 睡莲：一片浮在水面的圆叶。
 *
 * 三件事让它一眼就是"睡莲"而不是"一块绿方块"：
 *  1. **四角透明**（圆盘轮廓，靠半透明层做 alpha 混合）
 *  2. 边缘有轻微起伏（不是完美的圆）
 *  3. 右侧切掉一块扇形**缺口** + 从中心放射的深色**叶脉**（原版叶片的招牌特征）
 */
PAINTERS.lily_pad = (x, y, rng) => {
  const dx = x - 7.5;
  const dy = y - 7.5;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  // 边缘起伏：按角度取哈希，做出"叶缘不是正圆"的观感
  const wobble = 0.9 + (hashString(`lp${Math.round((angle + Math.PI) * 4)}`) % 12) / 100;
  if (distance > 7.1 * wobble) return [0, 0, 0, 0];
  // 缺口：右上方切掉一块扇形（原版那片叶子上就有这么个口子）
  if (angle > -0.55 && angle < 0.1 && distance > 3.4) return [0, 0, 0, 0];
  // 叶脉：从中心放射的深色细线；叶片边缘再压暗一圈
  const vein = distance > 2 && Math.abs((angle * 5) % 1) < 0.13;
  const shade = (1.06 - (distance / 8) * 0.32) * (vein ? 0.8 : 1);
  const jitter = rng() * 12 - 6;
  return [clamp255(74 * shade + jitter), clamp255(128 * shade + jitter), clamp255(56 * shade + jitter), 255];
};

// ---- 下界合金（K8 尾巴）
/**
 * 下界合金块：深紫灰的抛光金属面 + 细密的暗纹。
 *
 * 原版这块的观感是"金属上刻着纹路"——所以除了底色，还在 4 像素的格子上压出暗缝，
 * 并加一道斜向的亮纹，否则一整块深色在洞里就是一块糊住的黑板。
 */
PAINTERS.netherite_block = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  const groove = x % 4 === 0 || y % 4 === 0;
  const sheen = (x + y * 2) % 13 < 2;
  const edge = x < 1 || x > 14 || y < 1 || y > 14;
  const shade = edge ? 0.84 : groove ? 0.9 : sheen ? 1.14 : 1;
  return [clamp255(80 * shade + jitter), clamp255(68 * shade + jitter), clamp255(76 * shade + jitter), 255];
};

/** 锻造台顶面：深色木台面 + 中间一条金属带（原版是"砧面嵌在木台里"的样子） */
PAINTERS.smithing_table_top = (x, y, rng) => {
  const base = layered(96, 7, 8, [1.0, 0.86, 0.6])(x, y, rng);
  // 中间一条横向的金属带：y 6~9
  if (y >= 6 && y <= 9) {
    const shade = y === 6 || y === 9 ? 0.82 : 1.06;
    const jitter = rng() * 8 - 4;
    return [clamp255(196 * shade + jitter), clamp255(196 * shade + jitter), clamp255(204 * shade + jitter), 255];
  }
  // 四边压暗一圈，让台面有边框
  if (x < 1 || x > 14 || y < 1 || y > 14) {
    return [clamp255(base[0] * 0.82), clamp255(base[1] * 0.82), clamp255(base[2] * 0.82), 255];
  }
  return base;
};

/**
 * 锻造台侧面：深色木板 + 上沿一圈金属 + 中间一把锤子的剪影。
 *
 * 锤子是这个方块的"招牌"：原版锻造台的侧面就是一把锤子，
 * 远远看一眼就知道这是干什么用的（比只画木板强得多）。
 */
PAINTERS.smithing_table_side = (x, y, rng) => {
  const base = layered(96, 7, 8, [1.0, 0.86, 0.6])(x, y, rng);
  const jitter = rng() * 8 - 4;
  // 上沿的金属包边
  if (y <= 2) {
    const shade = y === 0 ? 0.84 : 1.08;
    return [clamp255(196 * shade + jitter), clamp255(196 * shade + jitter), clamp255(204 * shade + jitter), 255];
  }
  // 锤子：锤头是左上角的一横块，手柄斜向右下
  const head = y >= 5 && y <= 7 && x >= 3 && x <= 9;
  const handle = x - 6 === (y - 8) >> 0 && y >= 7 && y <= 13;
  if (head || handle) {
    const shade = head ? 1.1 : 0.9;
    return [clamp255(178 * shade + jitter), clamp255(178 * shade + jitter), clamp255(186 * shade + jitter), 255];
  }
  return base;
};

// ---- 铁砧（H8）
/** 铁砧顶面：深灰铁面 + 右侧一角是"砧角"（原版那个尖） */
PAINTERS.anvil_top = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const dx = x - 7.5;
  const dy = y - 7.5;
  // 砧角：右上角伸出去一块
  const horn = dx > 5.5 && dy < 0;
  if (horn) return [clamp255(78 + jitter), clamp255(78 + jitter), clamp255(84 + jitter), 255];
  if (Math.abs(dx) > 6.2 || Math.abs(dy) > 6.2) return [0, 0, 0, 0];
  // 中间一条亮面，两侧稍暗，看着像一块被打平过的铁
  const shade = Math.abs(dy) < 2 ? 1.12 : Math.abs(dy) < 4.5 ? 1 : 0.84;
  return [clamp255(96 * shade + jitter), clamp255(96 * shade + jitter), clamp255(102 * shade + jitter), 255];
};

/** 铁砧侧面：上细下粗的砧身 + 底座 */
PAINTERS.anvil_side = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const dx = Math.abs(x - 7.5);
  // 顶沿（y 0~2）最宽
  if (y < 2) return [clamp255(104 + jitter), clamp255(104 + jitter), clamp255(110 + jitter), 255];
  // 砧腰收窄：越往下越宽（原版铁砧是"T"形）
  const waist = y < 8 ? 3.5 : 5.5;
  if (dx > waist) return [0, 0, 0, 0];
  // 底座最后两行最宽、最暗
  if (y > 13) return [clamp255(70 + jitter), clamp255(70 + jitter), clamp255(76 + jitter), 255];
  const shade = 1.06 - (y / 15) * 0.22;
  return [clamp255(92 * shade + jitter), clamp255(92 * shade + jitter), clamp255(98 * shade + jitter), 255];
};

/** 小麦种子：几粒浅黄绿色的种子（小椭圆若干颗） */
PAINTERS.item_wheat_seeds = (x, y, rng) => {
  const jitter = rng() * 14 - 7;
  // 用三行错位的小点阵表示"一小把种子"
  const seeds = [
    [4, 4], [7, 3], [10, 5], [4, 8], [8, 7], [11, 9], [5, 11], [9, 12],
  ];
  for (const [sx, sy] of seeds) {
    if (Math.abs(x - sx!) <= 1 && Math.abs(y - sy!) <= 1) {
      return [clamp255(196 + jitter), clamp255(178 + jitter), clamp255(88 + jitter), 255];
    }
  }
  return [0, 0, 0, 0];
};

/** 小麦：一捆金黄色麦穗（中间用暗色扎起来） */
PAINTERS.item_wheat = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  if (y < 1 || y > 14) return [0, 0, 0, 0];
  // 中间那一段是"扎起来的绳"
  if (y >= 6 && y <= 8 && x >= 4 && x <= 11) {
    return [clamp255(146 + jitter), clamp255(96 + jitter), clamp255(44 + jitter), 255];
  }
  // 上下是散开的麦穗：三束，越靠边越窄
  const dx = Math.abs(x - 7.5);
  const halfWidth = y < 6 ? 2.2 + (6 - y) * 0.5 : 2.2 + (y - 8) * 0.35;
  if (dx > halfWidth) return [0, 0, 0, 0];
  if (x % 3 === 2 && Math.abs(y - 7.5) > 1) return [0, 0, 0, 0];
  return [clamp255(226 + jitter), clamp255(190 + jitter), clamp255(78 + jitter), 255];
};

/** 酿造台顶面：深色石台 + 中间三个放药水的凹槽 */
PAINTERS.brewing_stand_top = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 三个凹槽（原版就是三个药水位）
  for (const sx of [4, 11]) {
    if (Math.abs(x - sx) <= 1 && Math.abs(y - 7.5) <= 1) {
      return [clamp255(58 + jitter), clamp255(56 + jitter), clamp255(62 + jitter), 255];
    }
  }
  if (Math.abs(x - 7.5) <= 1 && Math.abs(y - 10) <= 1) {
    return [clamp255(58 + jitter), clamp255(56 + jitter), clamp255(62 + jitter), 255];
  }
  return [clamp255(126 + jitter), clamp255(124 + jitter), clamp255(120 + jitter), 255];
};

/** 酿造台底面：纯石头 */
PAINTERS.brewing_stand_bottom = (_x, _y, rng) => {
  const jitter = rng() * 12 - 6;
  return [clamp255(122 + jitter), clamp255(120 + jitter), clamp255(116 + jitter), 255];
};

/** 酿造台侧面：下半是圆石座，上半中间一根烈焰棒（原版观感） */
PAINTERS.brewing_stand_side = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  if (y < 5) {
    // 烈焰棒：中间三格宽，橙黄带暗纹
    if (Math.abs(x - 7.5) <= 1.5) {
      const hot = (x * 3 + y * 5) % 7 === 0;
      return hot
        ? [clamp255(252 + jitter), clamp255(206 + jitter), clamp255(96 + jitter), 255]
        : [clamp255(232 + jitter), clamp255(148 + jitter), clamp255(48 + jitter), 255];
    }
    return [0, 0, 0, 0];
  }
  // 石座：上半略亮
  const shade = y < 9 ? 1.1 : 0.92;
  return [clamp255(122 * shade + jitter), clamp255(120 * shade + jitter), clamp255(116 * shade + jitter), 255];
};

/**
 * 药水的三种瓶型（`liquid` 为空就是空瓶子，无色液体）。
 * 液体颜色按药水种类给——这也是玩家分辨药水的唯一线索，所以别都画成同一瓶紫水。
 *
 *  - **饮用型**（`drink`）：细颈 + 直瓶底
 *  - **喷溅型**（`splash`）：圆底烧瓶 + 棕瓶塞（扔出去炸开）
 *  - **滞留型**（`lingering`）：圆底烧瓶 + **敞口** + 顶部两粒气雾（扔出去留一片云）
 *
 * 三种造型必须一眼能分：颜色一样、只有"能不能扔/要不要留云"的区别，
 * 要是形状也一样，玩家就会把该扔的那瓶喝掉。
 */
function bottlePainter(
  liquid: readonly [number, number, number] | null,
  style: 'drink' | 'splash' | 'lingering' = 'drink',
): Painter {
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;

    if (style === 'lingering') {
      const dx = (x - 7.5) / 4.4;
      const dy = (y - 10) / 3.8;
      const inBelly = dx * dx + dy * dy <= 1;
      const inMouth = x >= 6 && x <= 9 && y >= 3 && y <= 6;
      // 瓶口飘出的两粒气雾：把"这一瓶会留下一片云"画在图标上
      const inWisp = (x === 5 || x === 10) && (y === 2 || y === 3);
      if (!inBelly && !inMouth && !inWisp) return [0, 0, 0, 0];
      if (inWisp) return [clamp255(196 + jitter), clamp255(206 + jitter), clamp255(218 + jitter), 190];
      if (liquid && inBelly) {
        const shade = x < 8 ? 1.12 : 0.9;
        return [
          clamp255(liquid[0] * shade + jitter),
          clamp255(liquid[1] * shade + jitter),
          clamp255(liquid[2] * shade + jitter),
          255,
        ];
      }
      const edge = x === 4 || x === 11 || y === 13;
      return [clamp255(214 + jitter), clamp255(226 + jitter), clamp255(232 + jitter), edge ? 255 : 210];
    }

    if (style === 'splash') {
      // 瓶肚：x 4~11、y 6~13，四角削掉做成球状
      const dx = (x - 7.5) / 4.4;
      const dy = (y - 9.5) / 4.2;
      const inBelly = dx * dx + dy * dy <= 1;
      const inNeck = x >= 7 && x <= 8 && y >= 4 && y <= 6;
      const inCork = x >= 6 && x <= 9 && y >= 1 && y <= 3;
      if (!inBelly && !inNeck && !inCork) return [0, 0, 0, 0];
      if (inCork) return [clamp255(132 + jitter), clamp255(96 + jitter), clamp255(58 + jitter), 255];
      if (liquid && inBelly && y >= 8) {
        const shade = x < 8 ? 1.12 : 0.9;
        return [
          clamp255(liquid[0] * shade + jitter),
          clamp255(liquid[1] * shade + jitter),
          clamp255(liquid[2] * shade + jitter),
          255,
        ];
      }
      const edge = x === 4 || x === 11 || y === 13;
      return [clamp255(214 + jitter), clamp255(226 + jitter), clamp255(232 + jitter), edge ? 255 : 210];
    }

    // 瓶身：x 4~11、y 5~14 的圆角矩形
    const inBody = x >= 4 && x <= 11 && y >= 5 && y <= 14;
    // 瓶颈：x 6~9、y 1~4
    const inNeck = x >= 6 && x <= 9 && y >= 1 && y <= 4;
    if (!inBody && !inNeck) return [0, 0, 0, 0];
    const edge = x === 4 || x === 11 || y === 14 || (inNeck && (x === 6 || x === 9));
    // 瓶底留 2 行玻璃（液体装到这儿）
    const liquidTop = 7;
    if (liquid && inBody && y >= liquidTop) {
      const shade = x < 8 ? 1.12 : 0.9;
      return [clamp255(liquid[0] * shade + jitter), clamp255(liquid[1] * shade + jitter), clamp255(liquid[2] * shade + jitter), 255];
    }
    return [clamp255(214 + jitter), clamp255(226 + jitter), clamp255(232 + jitter), edge ? 255 : 210];
  };
}

PAINTERS.item_glass_bottle = bottlePainter(null);
PAINTERS.item_water_bottle = bottlePainter([68, 128, 214]);

// 贴图按 `POTIONS` 生成而不是照着 id 列表手写：加了新药水却忘了画贴图，
// 表现是"背包里一瓶空白"，而这类遗漏在数据表里看不出来。
// 颜色来自 `potionColor()`（数据层），配药水云粒子的那一处也用它，两边不会各配一套色。
for (const potion of POTIONS) {
  const style = potion.lingering === true ? 'lingering' : potion.splash === true ? 'splash' : 'drink';
  PAINTERS[`item_potion_${potion.key}`] = bottlePainter(potionColor(potion), style);
}

/** 龙息（K4 尾巴）：瓶子里一团紫雾——与药水同色系，但明显不是"一瓶能喝的东西" */
PAINTERS.item_dragon_breath = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  // 瓶身：小一号的圆底瓶（原料瓶，不是药水瓶）
  const dx = (x - 7.5) / 5;
  const dy = (y - 9) / 4.4;
  if (dx * dx + dy * dy > 1) return [0, 0, 0, 0];
  const inside = dx * dx + dy * dy <= 0.62;
  if (!inside) return [clamp255(216 + jitter), clamp255(228 + jitter), clamp255(234 + jitter), 210];
  // 里面的雾：上浅下深，像一团翻滚的紫气
  const shade = y < 9 ? 1.2 : 0.85;
  return [clamp255(198 * shade + jitter), clamp255(160 * shade + jitter), clamp255(236 * shade + jitter), 255];
};

/** 雪球：偏冷白的球，左上角一片高光（不然在浅色地面上看不出来） */
PAINTERS.item_snowball = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  const dx = (x - 7.5) / 5.2;
  const dy = (y - 8.5) / 5;
  if (dx * dx + dy * dy > 1) return [0, 0, 0, 0];
  const highlight = (x - 5.5) ** 2 + (y - 6) ** 2 < 3;
  const shade = highlight ? 1.0 : y > 10 ? 0.86 : 0.94;
  return [clamp255(248 * shade + jitter), clamp255(252 * shade + jitter), clamp255(255 * shade + jitter), 255];
};

/** 鸡蛋：竖椭圆 + 几粒褐色斑点 */
PAINTERS.item_egg = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  const dx = (x - 7.5) / 4.4;
  const dy = (y - 8.5) / 5.4;
  // 蛋是"上尖下圆"：越往下越宽
  const taper = 1 - Math.max(0, 7.5 - y) * 0.06;
  if (dx * dx * taper + dy * dy > 1) return [0, 0, 0, 0];
  const speck = (x * 5 + y * 11) % 17 === 0;
  const base = speck ? 178 : 238;
  const shade = x < 7 ? 1.0 : 0.92;
  return [clamp255(base * shade + jitter), clamp255((base - 12) * shade + jitter), clamp255((base - 44) * shade + jitter), 255];
};

/**
 * 酿造材料（H10）：形状分三类（粉末 / 团块 / 脚爪），颜色按材料给。
 * 这十样在原版里也是"同一套形状换个色"，没必要每个手画。
 */
function brewMaterialPainter(color: readonly number[], shape: string): Painter {
  return (px, py, rng) => {
    const jitter = rng() * 14 - 7;
    const dx = px - 7.5;
    const dy = py - 8;
    if (shape === 'dust') {
      // 一小堆粉末：下宽上窄的锥
      const dyy = 14 - py;
      if (dyy > 7) return [0, 0, 0, 0];
      if (Math.abs(dx) > 2.4 + (7 - dyy) * 0.6) return [0, 0, 0, 0];
    } else if (shape === 'foot') {
      // 脚爪/长条：竖着的椭圆 + 上端一个小突起
      const e = (dx / 3.4) ** 2 + (dy / 5.2) ** 2;
      const knob = Math.abs(dx) < 1.6 && py >= 2 && py <= 5;
      if (e > 1 && !knob) return [0, 0, 0, 0];
    } else if (shape === 'slice') {
      // 瓜片：月牙形
      const e = (dx / 5.6) ** 2 + (dy / 4.8) ** 2;
      if (e > 1 || (y2 => y2)(0) === 1) return [0, 0, 0, 0];
    } else {
      const e = (dx / 5) ** 2 + (dy / 4.6) ** 2;
      if (e > 1) return [0, 0, 0, 0];
    }
    const shade = py < 8 ? 1.08 : 0.9;
    return [clamp255(color[0] * shade + jitter), clamp255(color[1] * shade + jitter), clamp255(color[2] * shade + jitter), 255];
  };
}

for (const [n, color, shape] of [
  ['rabbit_foot', [198, 168, 132], 'foot'],
  ['magma_cream', [232, 138, 60], 'blob'],
  ['ghast_tear', [214, 238, 232], 'blob'],
  ['spider_eye', [168, 52, 58], 'blob'],
  ['fermented_spider_eye', [126, 88, 64], 'blob'],
  ['glistering_melon_slice', [246, 206, 72], 'slice'],
  ['pufferfish', [214, 176, 72], 'blob'],
  ['golden_carrot', [246, 206, 72], 'foot'],
  ['redstone_ingredient', [206, 42, 42], 'dust'],
  ['glowstone_dust_ingredient', [246, 222, 140], 'dust'],
] as [string, number[], string][]) {
  PAINTERS[`item_${n}`] = brewMaterialPainter(color, shape);
}

/** 下界疣：暗红色的瘤状小块 */
PAINTERS.item_nether_wart = (x, y, rng) => {
  const jitter = rng() * 14 - 7;
  const dx = (x - 8) / 5.4;
  const dy = (y - 8.5) / 4.6;
  if (dx * dx + dy * dy > 1) return [0, 0, 0, 0];
  const dark = (x * 5 + y * 3) % 11 === 0;
  return dark
    ? [clamp255(92 + jitter), clamp255(24 + jitter), clamp255(36 + jitter), 255]
    : [clamp255(152 + jitter), clamp255(46 + jitter), clamp255(58 + jitter), 255];
};

/** 烈焰粉：一小堆橙黄色粉末 */
PAINTERS.item_blaze_powder = (x, y, rng) => {
  const jitter = rng() * 16 - 8;
  const dy = 14 - y;
  if (dy > 8) return [0, 0, 0, 0];
  const half = 2 + (8 - dy) * 0.7;
  if (Math.abs(x - 7.5) > half) return [0, 0, 0, 0];
  const hot = (x * 7 + y * 5) % 9 === 0;
  return hot
    ? [clamp255(252 + jitter), clamp255(198 + jitter), clamp255(72 + jitter), 255]
    : [clamp255(236 + jitter), clamp255(146 + jitter), clamp255(40 + jitter), 255];
};

/** 糖：一小堆白色细粒 */
PAINTERS.item_sugar = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const dy = 14 - y;
  if (dy > 7) return [0, 0, 0, 0];
  const half = 2.4 + (7 - dy) * 0.7;
  if (Math.abs(x - 7.5) > half) return [0, 0, 0, 0];
  return [clamp255(242 + jitter), clamp255(244 + jitter), clamp255(248 + jitter), 255];
};

/** 胡萝卜：上宽下尖的橙色锥形 + 顶部一小撮绿缨 */
PAINTERS.item_carrot = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  const dy = y - 3;
  if (y < 3) {
    // 绿缨
    if (Math.abs(x - 7.5) > 3 || y < 1) return [0, 0, 0, 0];
    return [clamp255(96 + jitter), clamp255(158 + jitter), clamp255(58 + jitter), 255];
  }
  // 锥体：越往下越窄
  const half = Math.max(1.2, 4.4 - dy * 0.42);
  if (Math.abs(x - 7.5) > half) return [0, 0, 0, 0];
  const shade = x < 7.5 ? 1.1 : 0.88;
  return [clamp255(238 * shade + jitter), clamp255(132 * shade + jitter), clamp255(44 * shade + jitter), 255];
};

/** 马铃薯：土黄色的椭圆，带几个"芽眼"暗点 */
PAINTERS.item_potato = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  const dx = (x - 7.5) / 5.6;
  const dy = (y - 8) / 4.4;
  if (dx * dx + dy * dy > 1) return [0, 0, 0, 0];
  // 芽眼
  if ((x * 3 + y * 5) % 17 === 0) return [clamp255(126 + jitter), clamp255(102 + jitter), clamp255(62 + jitter), 255];
  const shade = y < 8 ? 1.06 : 0.9;
  return [clamp255(206 * shade + jitter), clamp255(174 * shade + jitter), clamp255(92 * shade + jitter), 255];
};

/** 烤马铃薯：颜色更深的"烤过"版本，带一道裂口 */
PAINTERS.item_baked_potato = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  const dx = (x - 7.5) / 5.6;
  const dy = (y - 8) / 4.4;
  if (dx * dx + dy * dy > 1) return [0, 0, 0, 0];
  if ((x + y) % 9 === 4) return [clamp255(158 + jitter), clamp255(108 + jitter), clamp255(52 + jitter), 255];
  const shade = y < 8 ? 1.05 : 0.88;
  return [clamp255(168 * shade + jitter), clamp255(118 * shade + jitter), clamp255(56 * shade + jitter), 255];
};

/** 面包：椭圆形的浅棕面包，上面斜切三道口子 */
PAINTERS.item_bread = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 椭圆：中心 (7.5, 8)，半轴 6 × 4.5
  const dx = (x - 7.5) / 6;
  const dy = (y - 8) / 4.5;
  if (dx * dx + dy * dy > 1) return [0, 0, 0, 0];
  // 三道斜切口（更浅的色）
  if ((x + y) % 7 === 3 && Math.abs(dx) < 0.8) {
    return [clamp255(236 + jitter), clamp255(206 + jitter), clamp255(146 + jitter), 255];
  }
  // 上亮下暗，面包才有鼓起来的感觉
  const shade = y < 8 ? 1.08 : 0.9;
  return [clamp255(198 * shade + jitter), clamp255(146 * shade + jitter), clamp255(78 * shade + jitter), 255];
};

/** 耕地顶面：深色土 + 几道犁沟（横着的暗褐条纹） */
PAINTERS.farmland = (_x, y, rng) => {
  const jitter = rng() * 12 - 6;
  // 每隔 4 像素一道犁沟
  const furrow = y % 4 === 2;
  const base = furrow ? 86 : 128;
  return [clamp255(base * 0.86 + jitter), clamp255(base * 0.6 + jitter), clamp255(base * 0.36 + jitter), 255];
};

/** 耕地侧面：上沿一圈深色土（比泥土暗一档） */
PAINTERS.farmland_side = (_x, y, rng) => {
  const jitter = rng() * 12 - 6;
  const top = y <= 2;
  const base = top ? [104, 72, 42] : [134, 96, 62];
  return [clamp255(base[0] + jitter), clamp255(base[1] + jitter), clamp255(base[2] + jitter), 255];
};

/**
 * 小麦：4 个生长阶段。
 * 用一株"竖着长的草"表示：`stage` 越高越高越金黄，成熟时顶端挂上麦穗。
 */
function wheatPainter(stage: number): Painter {
  const height = 4 + stage * 3; // 4 / 7 / 10 / 13 像素高
  const ripe = stage === 3;
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    const dy = 15 - y; // 从底部往上数
    if (dy > height) return [0, 0, 0, 0];
    // 三株并排：中间那株稍高，两侧稍矮（看起来像一簇）
    const dx = Math.abs(x - 7.5);
    const inStalk = dx < 5.5;
    if (!inStalk) return [0, 0, 0, 0];
    const stalk = x % 3 === 1 || Math.floor(x / 3) === 2;
    if (!stalk) return [0, 0, 0, 0];
    // 成熟的小麦顶端两行画成麦穗（更亮的金黄）
    const ear = ripe && dy > height - 3;
    const color = ear ? [238, 206, 92] : ripe ? [212, 176, 74] : [0, 0, 0];
    if (ripe) return [clamp255(color[0]! + jitter), clamp255(color[1]! + jitter), clamp255(color[2]! + jitter), 255];
    // 未成熟：绿色，越晚越浅
    const green = 120 + stage * 26;
    return [clamp255(green * 0.55 + jitter), clamp255(green + jitter), clamp255(green * 0.45 + jitter), 255];
  };
}

for (let stage = 0; stage < 4; stage++) PAINTERS[`wheat_stage${stage}`] = wheatPainter(stage);

/**
 * 胡萝卜 / 马铃薯：两种地下作物地面上的部分都是"一丛绿叶"，
 * 差别在叶子的形状与成熟时露出的果实颜色（胡萝卜橙、马铃薯土黄带点紫）。
 */
function rootCropPainter(kind: 'carrots' | 'potatoes', stage: number): Painter {
  const height = 3 + stage * 3;
  const ripe = stage === 3;
  const fruit = kind === 'carrots' ? [232, 132, 44] : [206, 172, 92];
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    const dy = 15 - y;
    if (dy > height) return [0, 0, 0, 0];
    // 成熟时底部一行露出果实（土里冒出来的那一截）
    if (ripe && dy <= 2 && x >= 5 && x <= 10) {
      return [clamp255(fruit[0]! + jitter), clamp255(fruit[1]! + jitter), clamp255(fruit[2]! + jitter), 255];
    }
    // 叶子：三束，越往上越窄
    const dx = Math.abs(x - 7.5);
    const half = 1.6 + (height - dy) * 0.22;
    if (dx > half) return [0, 0, 0, 0];
    if (x % 4 === 3 && dy > 2) return [0, 0, 0, 0];
    // 胡萝卜的叶子偏深绿、马铃薯偏灰绿（与原版观感一致）
    const green = (kind === 'carrots' ? 96 : 108) + stage * 18;
    return [clamp255(green * 0.52 + jitter), clamp255(green + jitter), clamp255(green * 0.42 + jitter), 255];
  };
}

for (const kind of ['carrots', 'potatoes'] as const) {
  for (let stage = 0; stage < 4; stage++) PAINTERS[`${kind}_stage${stage}`] = rootCropPainter(kind, stage);
}

/**
 * 甜菜（批次 48）：第 4 种作物。地上部分是**偏红梗的叶丛**（原版甜菜的叶柄是紫红的，
 * 这是它与胡萝卜/马铃薯最容易分辨的地方），成熟时从土里露出一圈深红的根。
 */
function beetrootPainter(stage: number): Painter {
  const height = 3 + stage * 3;
  const ripe = stage === 3;
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    const dy = 15 - y;
    if (dy > height) return [0, 0, 0, 0];
    // 成熟：土面那一行露出一截深红的根
    if (ripe && dy <= 2 && x >= 5 && x <= 10) {
      return [clamp255(150 + jitter), clamp255(48 + jitter), clamp255(52 + jitter), 255];
    }
    const dx = Math.abs(x - 7.5);
    const half = 1.6 + (height - dy) * 0.2;
    if (dx > half) return [0, 0, 0, 0];
    // 中间的叶柄画成紫红（甜菜的招牌色），两侧叶子是深绿
    if (dx < 0.9) {
      return [clamp255(126 + jitter), clamp255(52 + jitter), clamp255(66 + jitter), 255];
    }
    const green = 88 + stage * 16;
    return [clamp255(green * 0.5 + jitter), clamp255(green + jitter), clamp255(green * 0.44 + jitter), 255];
  };
}

for (let stage = 0; stage < 4; stage++) PAINTERS[`beetroots_stage${stage}`] = beetrootPainter(stage);

/**
 * 甜浆果丛（批次 49）：一丛带刺的矮灌木，**越熟越高、果子越多**。
 *
 * 原版甜浆果丛的识别特征是"叶子细、果子红"，而且成熟时能看到一圈红点；
 * 这里就按这两条画：`stage >= 2` 才开始挂果（与"只有成熟才结甜浆果"这条规则对上）。
 */
function berryBushPainter(stage: number): Painter {
  const height = 5 + stage * 3; // 5 / 8 / 11 / 14
  const berryCount = stage >= 2 ? stage - 1 : 0; // 阶段2 一颗、阶段3 两颗
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    const dy = 15 - y;
    if (dy > height) return [0, 0, 0, 0];
    const dx = Math.abs(x - 7.5);
    // 丛形：下面宽、上面窄（越熟越铺得开）
    const half = 2.4 + (height - dy) * 0.18;
    if (dx > half) return [0, 0, 0, 0];
    // 果子：挂在固定的两个位置（左右各一颗），成熟度不够就没有
    if (berryCount > 0) {
      const berryX = berryCount > 1 ? [3, 12] : [4];
      if (berryX.includes(x) && dy >= 3 && dy <= 6) {
        return [clamp255(196 + jitter), clamp255(38 + jitter), clamp255(48 + jitter), 255];
      }
    }
    // 枝叶：深绿，越上面越亮（新芽）
    const green = 86 + stage * 14 + (dy > height - 3 ? 26 : 0);
    return [clamp255(green * 0.42 + jitter), clamp255(green + jitter), clamp255(green * 0.38 + jitter), 255];
  };
}

for (let stage = 0; stage < 4; stage++) PAINTERS[`sweet_berry_bush_stage${stage}`] = berryBushPainter(stage);

/**
 * 可可豆荚（批次 49）：挂在原木侧面的一个椭圆豆荚，**越熟越黄**。
 *
 * 三个阶段的贴图共用一个画法，只有颜色与大小不同——
 * 未熟偏青绿、半熟偏黄绿、成熟偏橙黄（原版就是从绿到橙的那三档）。
 */
function cocoaPainter(stage: number): Painter {
  const colors: readonly (readonly [number, number, number])[] = [
    [104, 140, 62], // 未熟：青绿
    [156, 148, 54], // 半熟：黄绿
    [196, 132, 34], // 成熟：橙黄
  ];
  const [r, g, b] = colors[stage]!;
  const halfWidth = 5 + stage; // 5 / 6 / 7
  return (x, y, rng) => {
    const jitter = rng() * 12 - 6;
    // 椭圆（荚的形状）：中心 (7.5, 8)，横向半轴随成熟变大
    const rx = (x - 7.5) / halfWidth;
    const ry = (y - 8) / 7;
    if (rx * rx + ry * ry > 1) return [0, 0, 0, 0];
    // 中缝：成熟后有一条纵向深色的沟（原版豆荚中间那道棱）
    if (stage === 2 && Math.abs(x - 7.5) < 0.6) {
      return [clamp255(r * 0.62 + jitter), clamp255(g * 0.62 + jitter), clamp255(b * 0.62 + jitter), 255];
    }
    const shade = y < 8 ? 1.1 : 0.9;
    return [clamp255(r * shade + jitter), clamp255(g * shade + jitter), clamp255(b * shade + jitter), 255];
  };
}

for (let stage = 0; stage < 3; stage++) PAINTERS[`cocoa_stage${stage}`] = cocoaPainter(stage);

// ---- 甜浆果 / 可可豆 / 曲奇（批次 49 的物品图标）

/** 甜浆果：几颗红果 + 两片叶子（与"丛上挂的果子"同色，一眼对得上） */
PAINTERS.item_sweet_berries = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 三颗果子：左、中、右
  for (const [cx, cy] of [
    [5, 9.5],
    [10, 9.5],
    [7.5, 6],
  ] as const) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= 2.6) {
      const shade = d < 1.2 ? 1.14 : 0.88;
      return [clamp255(198 * shade + jitter), clamp255(40 * shade + jitter), clamp255(50 * shade + jitter), 255];
    }
  }
  // 叶子：左上角一片
  if (y >= 2 && y <= 5 && x >= 2 && x <= 8 && x - y < 4) {
    return [clamp255(64 + jitter), clamp255(122 + jitter), clamp255(52 + jitter), 255];
  }
  return [0, 0, 0, 0];
};

/** 可可豆：三颗深棕色的豆子（豆荚里剥出来的那种） */
PAINTERS.item_cocoa_beans = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  for (const [cx, cy, rx] of [
    [5.5, 10, 3.2],
    [10.5, 10.5, 3.0],
    [8, 5.5, 2.8],
  ] as const) {
    const d = Math.hypot((x - cx) / rx, (y - cy) / (rx * 0.86));
    if (d <= 1) {
      const shade = d < 0.5 ? 1.16 : 0.9;
      return [clamp255(126 * shade + jitter), clamp255(78 * shade + jitter), clamp255(42 * shade + jitter), 255];
    }
  }
  return [0, 0, 0, 0];
};

/** 曲奇：一块圆饼干 + 几粒深色巧克力豆 */
PAINTERS.item_cookie = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const distance = Math.hypot(x - 7.5, y - 8);
  if (distance > 6.2) return [0, 0, 0, 0];
  // 巧克力豆：固定的几个点
  for (const [cx, cy] of [
    [5, 6],
    [10, 6.5],
    [7, 10.5],
    [11, 10],
  ] as const) {
    if (Math.hypot(x - cx, y - cy) < 1.5) {
      return [clamp255(74 + jitter), clamp255(46 + jitter), clamp255(30 + jitter), 255];
    }
  }
  // 边缘略深（烤过的圈）
  const shade = distance > 5 ? 0.86 : 1;
  return [clamp255(206 * shade + jitter), clamp255(158 * shade + jitter), clamp255(96 * shade + jitter), 255];
};

// ---- 食物与杂物（批次 48）
//
// 三只碗（空碗 / 蘑菇煲 / 甜菜汤）共用同一套"木碗 + 里面一汪汤"的画法，
// 只有汤的颜色不同——这样一眼就能看出它们是同一类东西。

/** 木碗：一个 U 形（外圈木头、里面掏空） */
function bowlPixel(x: number, y: number): boolean {
  const distance = Math.hypot(x - 7.5, y - 7.5);
  if (distance > 6.4) return false;
  // 上半部分只留碗壁（左右两条），下半部分是碗底
  if (y < 7) return distance > 4.6;
  return distance > 3.4;
}

/** 碗壁的木头颜色 */
function bowlWood(y: number, rng: () => number): [number, number, number, number] {
  const jitter = rng() * 10 - 5;
  const shade = y < 8 ? 1.06 : 0.9;
  return [clamp255(162 * shade + jitter), clamp255(120 * shade + jitter), clamp255(66 * shade + jitter), 255];
}

/** 汤：碗里那一汪（`tint` 是汤色） */
function soupPainter(tint: readonly [number, number, number], withBits: boolean): Painter {
  return (x, y, rng) => {
    if (bowlPixel(x, y)) return bowlWood(y, rng);
    const distance = Math.hypot(x - 7.5, y - 7.5);
    // 碗内：y 5~10 的那一汪
    if (distance > 3.6 || y < 5 || y > 10) return [0, 0, 0, 0];
    const jitter = rng() * 10 - 5;
    // 汤面上的料（蘑菇块 / 甜菜块）：几个固定的亮点
    if (withBits && (x % 5 === 2 && y % 4 === 2)) {
      const shade = 1.25;
      return [clamp255(tint[0] * shade + jitter), clamp255(tint[1] * shade + jitter), clamp255(tint[2] * shade + jitter), 255];
    }
    const shade = y < 7 ? 1.1 : 0.92;
    return [clamp255(tint[0] * shade + jitter), clamp255(tint[1] * shade + jitter), clamp255(tint[2] * shade + jitter), 255];
  };
}

/** 空碗：里面什么都没有 */
PAINTERS.item_bowl = (x, y, rng) => (bowlPixel(x, y) ? bowlWood(y, rng) : [0, 0, 0, 0]);
/** 蘑菇煲：棕褐色的汤 + 蘑菇块 */
// 可疑的炖菜（批次 57）：五碗用同一个碗，**汤色按花来**——
// 这样"哪一碗是哪朵花煮的"在背包里一眼能看出来（原版看不出，只能靠 NBT 提示）
for (const [name, tint] of [
  ['dandelion', [214, 196, 96]],
  ['poppy', [198, 62, 58]],
  ['blue_orchid', [96, 150, 216]],
  ['oxeye_daisy', [226, 220, 198]],
  ['cornflower', [78, 96, 190]],
] as const) {
  PAINTERS[`item_suspicious_stew_${name}`] = soupPainter(tint as unknown as readonly [number, number, number], true);
}

// ---------------------------------------------------------------- 钓鱼（批次 81，G11）
/**
 * 鱼的通用画法：身体（椭圆）+ 尾巴（右侧三角）+ 背鳍 + 眼睛。
 *
 * 四种鱼只差三个颜色（身体 / 肚子 / 鳍），所以写成一支带参数的画笔——
 * 手画四张只会让"某一种鱼的颜色画串了"没人发现（珊瑚那批的老教训）。
 */
function fishPainter(
  body: readonly [number, number, number],
  belly: readonly [number, number, number],
  fin: readonly [number, number, number],
): Painter {
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    const dx = x - 7.2;
    const dy = y - 8.2;
    // 尾巴：右侧张开的三角
    if (x >= 11.5 && Math.abs(dy) <= (x - 11.5) * 1.1 + 0.6) {
      return [clamp255(fin[0] * 0.9 + jitter), clamp255(fin[1] * 0.9 + jitter), clamp255(fin[2] * 0.9 + jitter), 255];
    }
    // 背鳍：身体上沿的一小片
    if (dy < -1.6 && Math.abs(dx) < 2.6 && y > 3.5) {
      return [clamp255(fin[0] * 1.05 + jitter), clamp255(fin[1] * 1.05 + jitter), clamp255(fin[2] * 1.05 + jitter), 255];
    }
    // 身体：椭圆（肚子在下半，颜色偏浅）
    if ((dx * dx) / 32 + (dy * dy) / 7.5 > 1) return [0, 0, 0, 0];
    const base = dy > 1 ? belly : body;
    const shade = dy > 1 ? 1.06 : x < 7 ? 1.08 : 0.92;
    // 眼睛（靠左前方）
    if (Math.abs(dx + 4.2) < 1.1 && Math.abs(dy + 0.2) < 1.1) return [26, 26, 32, 255];
    return [clamp255(base[0] * shade + jitter), clamp255(base[1] * shade + jitter), clamp255(base[2] * shade + jitter), 255];
  };
}

/** 生鳕鱼：褐绿色的身体、米白的肚子 */
PAINTERS.item_cod = fishPainter([176, 158, 120], [226, 214, 186], [186, 168, 132]);
/** 生鲑鱼：橙红的身体（熟鲑鱼是同一个色系但更深，见下） */
PAINTERS.item_salmon = fishPainter([196, 108, 82], [232, 176, 148], [168, 84, 66]);
/** 热带鱼：亮橙黄 + 白肚子 + 青色的鳍（原版有很多花纹，这里取最经典那一种） */
PAINTERS.item_tropical_fish = fishPainter([236, 156, 52], [246, 236, 214], [86, 198, 208]);
/** 熟鳕鱼：整体偏棕（烤过的痕迹）+ 侧面几道焦痕 */
PAINTERS.item_cooked_cod = (x, y, rng) => {
  const pixel = fishPainter([156, 122, 78], [206, 176, 132], [150, 116, 74])(x, y, rng);
  if (pixel[3] === 0) return pixel;
  // 焦痕：两条斜线
  if ((x + y) % 9 === 3) return [clamp255(pixel[0] * 0.68), clamp255(pixel[1] * 0.68), clamp255(pixel[2] * 0.68), 255];
  return pixel;
};
/** 熟鲑鱼：更深的红棕 */
PAINTERS.item_cooked_salmon = (x, y, rng) => {
  const pixel = fishPainter([168, 86, 62], [216, 148, 118], [146, 70, 52])(x, y, rng);
  if (pixel[3] === 0) return pixel;
  if ((x + y) % 8 === 2) return [clamp255(pixel[0] * 0.72), clamp255(pixel[1] * 0.72), clamp255(pixel[2] * 0.72), 255];
  return pixel;
};
/**
 * 钓竿：斜着的木杆 + 绕过顶端的线（线在右侧垂下来）。
 *
 * 线用**白灰色**而不是纯白：纯白在浅色背景（背包格子的浅灰）上会看不见。
 */
PAINTERS.item_fishing_rod = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const along = x + y;
  // 竿身：左下到右上的斜条（2 像素宽）
  if (along >= 17 && along <= 21) {
    const shade = x < 6 ? 0.85 : 1.1;
    return [clamp255(150 * shade + jitter), clamp255(108 * shade + jitter), clamp255(62 * shade + jitter), 255];
  }
  if (along >= 22 && along <= 24) {
    return [clamp255(120 + jitter), clamp255(84 + jitter), clamp255(48 + jitter), 255];
  }
  // 线：从竿尖（大约 12,5）往右下绕一圈再垂下来
  const tipX = 13;
  const tipY = 4;
  const ddx = x - tipX;
  const ddy = y - tipY;
  const radius = Math.sqrt(ddx * ddx + ddy * ddy);
  if (radius > 3.2 && radius < 4.4 && y >= tipY && x >= tipX - 1) {
    return [clamp255(228 + jitter), clamp255(228 + jitter), clamp255(236 + jitter), 255];
  }
  // 浮标（右下角的小方块：白 + 红各一半）
  if (x >= 12 && x <= 14 && y >= 11 && y <= 14) {
    const top = y <= 12;
    return top ? [232, 232, 236, 255] : [206, 62, 54, 255];
  }
  return [0, 0, 0, 0];
};

// 避雷针（批次 83）：铜色的细杆——贴图只要"铜的质感"，
// 形状（2/16 × 6/16 的杆）由 `blockShapes` 的 `lightningRodBox` 表达
PAINTERS.lightning_rod = (x, _y, rng) => {
  const jitter = rng() * 10 - 5;
  // 杆身占中间那 6 像素宽的一条（竖着的纹理，看着像一根杆）
  if (x < 5 || x > 10) return [0, 0, 0, 0];
  // 靠左的一侧亮一点（一条高光），靠右压暗，模拟铜的圆杆
  const shade = x <= 6 ? 1.12 : x >= 10 ? 0.84 : 1;
  return [clamp255(196 * shade + jitter), clamp255(120 * shade + jitter), clamp255(72 * shade + jitter), 255];
};

PAINTERS.item_mushroom_stew = soupPainter([154, 106, 62], true);
/** 甜菜汤：深红色的汤 + 甜菜块 */
PAINTERS.item_beetroot_soup = soupPainter([168, 46, 52], true);

/** 金粒：一小块金子（用同一套"碎块"画笔，与铁粒成对） */
PAINTERS.item_gold_nugget = lump(
  [
    [252, 214, 96],
    [230, 178, 58],
    [190, 138, 36],
  ],
  'gnugget',
  4.4,
);

/** 甜菜种子：几粒红褐色的小种子 */
PAINTERS.item_beetroot_seeds = lump(
  [
    [162, 116, 78],
    [132, 92, 58],
    [104, 68, 42],
  ],
  'bseed',
  4.2,
);

/** 甜菜根：上面一丛绿叶 + 底下一颗深红的圆根 + 一根须 */
PAINTERS.item_beetroot = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 根：椭圆，中心 (7.5, 10)，半轴 4.6 × 5.2
  const rx = (x - 7.5) / 4.6;
  const ry = (y - 10) / 5.2;
  if (rx * rx + ry * ry <= 1) {
    const shade = rx * rx < 0.25 ? 1.1 : 0.88;
    return [clamp255(158 * shade + jitter), clamp255(48 * shade + jitter), clamp255(54 * shade + jitter), 255];
  }
  // 须：正下方一根细线
  if (x === 7 || x === 8) {
    if (y > 14) return [clamp255(120 + jitter), clamp255(58 + jitter), clamp255(56 + jitter), 255];
  }
  // 叶：上方左右各一束
  if (y <= 5) {
    const dx = Math.abs(x - 7.5);
    const half = 1.2 + (5 - y) * 0.7;
    if (dx <= half + 1.6 && dx >= half - 1.6) {
      if (dx < 1.0) return [clamp255(122 + jitter), clamp255(50 + jitter), clamp255(64 + jitter), 255];
      return [clamp255(70 + jitter), clamp255(120 + jitter), clamp255(52 + jitter), 255];
    }
  }
  return [0, 0, 0, 0];
};

/** 南瓜派：圆形的派，外圈是酥皮、里面是橙黄的南瓜馅，切了一刀 */
PAINTERS.item_pumpkin_pie = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const distance = Math.hypot(x - 7.5, y - 8.5);
  if (distance > 6.6) return [0, 0, 0, 0];
  // 外圈酥皮
  if (distance > 5.0) {
    return [clamp255(206 + jitter), clamp255(158 + jitter), clamp255(92 + jitter), 255];
  }
  // 切痕：从中心往右上的一条
  if (Math.abs((x - 7.5) - (8.5 - y)) < 0.9 && x > 7.5) {
    return [clamp255(196 + jitter), clamp255(146 + jitter), clamp255(84 + jitter), 255];
  }
  const shade = y < 8 ? 1.08 : 0.94;
  return [clamp255(226 * shade + jitter), clamp255(142 * shade + jitter), clamp255(52 * shade + jitter), 255];
};

/** 纸：略微歪斜的白色薄片 + 一道折角 */
PAINTERS.item_paper = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  // 一个略微旋转的方块（用"x 越大越往下偏"模拟倾斜）
  const skew = Math.round((y - 7.5) * 0.18);
  const dx = x - 7.5 - skew;
  const dy = y - 7.5;
  if (Math.abs(dx) > 5.4 || Math.abs(dy) > 6) return [0, 0, 0, 0];
  // 折角：右上角切掉一块
  if (dx > 3.4 && dy < -3.8) return [0, 0, 0, 0];
  const fold = Math.abs(dx) > 4.4 || Math.abs(dy) > 5;
  const shade = fold ? 0.86 : 1;
  return [clamp255(238 * shade + jitter), clamp255(236 * shade + jitter), clamp255(226 * shade + jitter), 255];
};

/** 书：棕色封皮 + 右侧露出的一叠白页 */
PAINTERS.item_book = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  if (x < 2 || x > 13 || y < 2 || y > 13) return [0, 0, 0, 0];
  // 右侧 3 列是书页
  if (x >= 11) return [clamp255(228 + jitter), clamp255(224 + jitter), clamp255(210 + jitter), 255];
  // 封皮上一条竖着的装订线
  if (x === 3) return [clamp255(96 + jitter), clamp255(56 + jitter), clamp255(30 + jitter), 255];
  return [clamp255(146 + jitter), clamp255(88 + jitter), clamp255(44 + jitter), 255];
};

/** 书架：木板外框 + 中间两层书 */
PAINTERS.bookshelf = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 外框木板
  if (x < 1 || x > 14 || y < 1 || y > 14) return [clamp255(150 + jitter), clamp255(112 + jitter), clamp255(66 + jitter), 255];
  // 每层的"隔板"
  if (y === 5 || y === 10) return [clamp255(132 + jitter), clamp255(98 + jitter), clamp255(56 + jitter), 255];
  // 书脊：颜色按列确定（红/棕/深绿/蓝各几本），中间偶尔留出缝隙
  if (x % 5 === 0) return [clamp255(58 + jitter), clamp255(44 + jitter), clamp255(32 + jitter), 255];
  const spine = ['0xc0392b', '0x8a5a2b', '0x2f6b45', '0x2f4a7a'][(x * 3 + y) % 4]!;
  const r = (parseInt(spine, 16) >> 16) & 0xff;
  const g = (parseInt(spine, 16) >> 8) & 0xff;
  const b = parseInt(spine, 16) & 0xff;
  return [clamp255(r + jitter), clamp255(g + jitter), clamp255(b + jitter), 255];
};

/** 西瓜片：半圆（上面是红瓤、下面是绿皮）+ 几颗黑籽 */
PAINTERS.item_melon_slice = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 圆心在 (7.5, 9)、半径 6.4，只取 y ≤ 12 的上半部分
  if (y < 3 || y > 12) return [0, 0, 0, 0];
  if (Math.hypot(x - 7.5, y - 9) > 6.4) return [0, 0, 0, 0];
  // 最下面两行是瓜皮
  if (y >= 11) return [clamp255(74 + jitter), clamp255(140 + jitter), clamp255(58 + jitter), 255];
  // 瓜籽：按坐标定死几颗。用随机数会让籽在不同帧之间"闪"
  if ((x + y) % 5 === 0 && y > 4 && y < 10) return [46, 40, 32, 255];
  return [clamp255(232 + jitter), clamp255(78 + jitter), clamp255(84 + jitter), 255];
};

PAINTERS.item_brick = (x, y, rng) => {
  // 小砖块：红棕色矩形 + 一点高光
  if (x < 3 || x > 12 || y < 5 || y > 11) return [0, 0, 0, 0];
  const highlight = y <= 6 ? 1.14 : 0.94;
  const v = highlight + (rng() * 0.1 - 0.05);
  return [clamp255(150 * v), clamp255(84 * v), clamp255(66 * v), 255];
};

// ================================================================ 自然装饰贴图
//
// 植物贴图与方块贴图的关键差别：**背景必须透明**（alpha=0），
// 十字形状只输出两片薄面，靠 alphaTest 把背景裁掉才能看到"草叶"的轮廓。

/** 空像素（透明） */
const EMPTY: RGBA = [0, 0, 0, 0];

/**
 * 草丛 / 蕨类：从底部往上长的若干条细叶，叶尖渐窄。
 * @param rgb 叶色
 * @param blades 叶片数量
 * @param tall 叶片最大高度（像素）
 */
function bladesPainter(rgb: readonly [number, number, number], blades: number, tall = 12): Painter {
  return (x, y, rng) => {
    // 每列是否属于某个叶片，以及该叶片的顶端高度：用列号哈希，保证纵向连续
    const column = hashString(`blade${x}`);
    if (column % 100 >= (blades / 16) * 100) return EMPTY;
    const top = 16 - ((column >> 3) % tall) - 3;
    if (y < top) return EMPTY;
    // 叶尖 1 像素宽，往下 2 像素宽（用 x 偏移的哈希模拟"叶片歪斜"）
    const lean = (column >> 7) % 3;
    const width = y < top + 2 ? 1 : 2;
    const inBlade = x % width === lean % width;
    if (!inBlade) return EMPTY;
    const v = 1 + (rng() * 0.3 - 0.15);
    return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
  };
}

/**
 * 花：底部一根 1 像素的茎 + 顶部一团花瓣（中心亮、边缘暗）。
 * 花瓣形状用"到花心的距离 + 角度抖动"画，避免出现方块状的圆。
 */
function flowerPainter(stem: readonly [number, number, number], petal: readonly [number, number, number], salt: string): Painter {
  return (x, y, rng) => {
    // 茎：竖直 1 像素，从 y=15 到 y=7，略微弯曲
    const stemX = 7 + (hashString(`${salt}stem`) % 2);
    if (y >= 7 && Math.abs(x - stemX) <= 0.5) {
      const v = 1 + (rng() * 0.16 - 0.08);
      return [clamp255(stem[0] * v), clamp255(stem[1] * v), clamp255(stem[2] * v), 255];
    }
    // 茎上的一片小叶
    if (y >= 10 && y <= 11 && (x === stemX - 2 || x === stemX + 2)) {
      return [clamp255(stem[0] * 0.9), clamp255(stem[1] * 1.05), clamp255(stem[2] * 0.85), 255];
    }
    // 花瓣：中心 (7.5, 4)，半径随角度抖动
    const dx = x - 7.5;
    const dy = y - 4.5;
    const distance = Math.hypot(dx, dy);
    const angle = Math.round((Math.atan2(dy, dx) * 8) / Math.PI);
    const radius = 2.6 + (hashString(`${salt}${angle}`) % 40) / 40;
    if (distance > radius) return EMPTY;
    const core = distance < 1.2;
    const shade = core ? 1.15 : 0.92 + 0.3 * (1 - distance / radius);
    const jitter = rng() * 14 - 7;
    return [
      clamp255(petal[0] * shade + jitter),
      clamp255(petal[1] * shade + jitter),
      clamp255(petal[2] * shade + jitter),
      255,
    ];
  };
}

/**
 * 蘑菇：下半部一根浅色菌柄，上半部一顶圆伞（伞沿比伞顶暗）。
 */
function mushroomPainter(cap: readonly [number, number, number], stem: readonly [number, number, number], salt: string): Painter {
  return (x, y, rng) => {
    // 菌伞：半椭圆，中心 (7.5, 6)，横向半径 5、纵向半径 4
    const dx = (x - 7.5) / 5;
    const dy = (y - 6.5) / 3.6;
    const inCap = y <= 7 && dx * dx + dy * dy <= 1;
    if (inCap) {
      const rim = dx * dx + dy * dy > 0.72;
      const shade = rim ? 0.82 : 1.06;
      const spot = hashString(`${salt}spot${x},${y}`) % 17 === 0;
      const v = shade + (rng() * 0.12 - 0.06);
      const s = spot ? 1.5 : 1;
      return [clamp255(cap[0] * v * s), clamp255(cap[1] * v * s), clamp255(cap[2] * v * s), 255];
    }
    // 菌柄：两像素宽，位于中央
    if (y > 7 && Math.abs(x - 7.5) < 1.5) {
      const v = 1 + (rng() * 0.1 - 0.05);
      return [clamp255(stem[0] * v), clamp255(stem[1] * v), clamp255(stem[2] * v), 255];
    }
    return EMPTY;
  };
}

/** 甘蔗 / 竹子：若干根竖直的秆，秆上有节点色带（竹子更细更青） */
function stalkPainter(rgb: readonly [number, number, number], stalks: number, nodeColor: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const column = hashString(`stalk${x}`) % stalks;
    if (column !== 0) return EMPTY;
    // 节点：每 5 像素一条横向色带
    const node = y % 5 === 0;
    const base = node ? nodeColor : rgb;
    const v = 1 + (rng() * 0.14 - 0.07);
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), 255];
  };
}

/** 枯木：几根没有叶子的枯枝 */
const DEAD_BUSH_PAINTER: Painter = (x, y, rng) => {
  const column = hashString(`bush${x}`);
  if (column % 100 >= 43) return EMPTY;
  const top = 4 + (column >> 4) % 8;
  if (y < top) return EMPTY;
  const v = 0.72 + (rng() * 0.2 - 0.1) - (y / 16) * 0.18;
  return [clamp255(150 * v), clamp255(126 * v), clamp255(72 * v), 255];
};

/** 南瓜 / 西瓜：竖向瓜棱（两侧压暗形成立体感）；salt 决定瓜棱的相位，两种瓜的纹路不重合 */
function gourdSidePainter(rgb: readonly [number, number, number], salt: string): Painter {
  const phase = hashString(salt) % 4;
  return (x, y, rng) => {
    const ridge = ((x + phase) % 4 === 3 ? -0.22 : 0) + Math.sin((x / 16) * Math.PI) * 0.12;
    const v = 1 + ridge + (rng() * 0.08 - 0.04) + (y < 2 || y > 13 ? -0.12 : 0);
    return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
  };
}

/** 瓜类顶面：中心略亮 + 果柄（南瓜顶有褐色柄） */
function gourdTopPainter(rgb: readonly [number, number, number], stem: readonly [number, number, number] | null): Painter {
  return (x, y, rng) => {
    const distance = Math.hypot(x - 7.5, y - 7.5);
    if (stem && distance < 2.2) {
      const v = 1 + (rng() * 0.12 - 0.06);
      return [clamp255(stem[0] * v), clamp255(stem[1] * v), clamp255(stem[2] * v), 255];
    }
    const radial = 1.08 - (distance / 11) * 0.16;
    const v = radial + (rng() * 0.08 - 0.04);
    return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
  };
}

/** 仙人掌侧面：深绿底 + 竖向棱 + 稀疏白刺 */
const CACTUS_SIDE_PAINTER: Painter = (x, y, rng) => {
  const rib = x % 5 === 0 || x % 5 === 4 ? -0.16 : 0.06;
  const v = 1 + rib + (rng() * 0.08 - 0.04);
  if (hashString(`spike${x},${y}`) % 13 === 0) return [232, 236, 214, 255];
  return [clamp255(58 * v), clamp255(126 * v), clamp255(50 * v), 255];
};

/** 仙人掌顶面：同心棱 + 中心略深 */
const CACTUS_TOP_PAINTER: Painter = (x, y, rng) => {
  const ring = Math.sin(Math.hypot(x - 7.5, y - 7.5) * 1.7) * 0.1;
  const v = 1 + ring + (rng() * 0.07 - 0.035);
  return [clamp255(62 * v), clamp255(132 * v), clamp255(54 * v), 255];
};

// ---- 海晶石家族：青绿色底 + 不同纹理组织
const PRISMARINE_BASE: readonly [number, number, number] = [96, 168, 152];
/** 海晶石：细密的颗粒 + 零星深色晶体 */
const PRISMARINE_PAINTER: Painter = (x, y, rng) => {
  const crystal = hashString(`prism${x >> 1},${y >> 1}`) % 11 === 0;
  const v = crystal ? 0.78 : 1 + (rng() * 0.16 - 0.08);
  return [clamp255(PRISMARINE_BASE[0] * v), clamp255(PRISMARINE_BASE[1] * v), clamp255(PRISMARINE_BASE[2] * v), 255];
};
/** 海晶石砖：整齐砌块 */
const PRISMARINE_BRICKS_PAINTER = brickPainter([104, 176, 160]);
/** 暗海晶石：更暗更均匀 */
const DARK_PRISMARINE_PAINTER = layered(72, 5, 6, [0.92, 1.1, 1.02]);
/** 海灯：明亮的方块 + 内部晶格（自发光 15，画得亮一些） */
const SEA_LANTERN_PAINTER: Painter = (x, y, rng) => {
  const cell = (x % 5 === 0 || y % 5 === 0) && Math.abs(x - 7.5) > 1;
  const center = Math.hypot(x - 7.5, y - 7.5) < 2.4;
  const v = (cell ? 0.86 : 1.14) + (center ? 0.14 : 0) + (rng() * 0.08 - 0.04);
  return [clamp255(196 * v), clamp255(232 * v), clamp255(222 * v), 255];
};

// ---- 下界方块
/** 下界岩：暗红底 + 肉瘤状皴裂 */
const NETHERRACK_PAINTER: Painter = (x, y, rng) => {
  const key = (y >> 1) * 8 + (x >> 1);
  const bump = (hashString(`nr${key}`) % 100) / 100;
  const v = 0.86 + bump * 0.34 + (rng() * 0.1 - 0.05);
  return [clamp255(112 * v), clamp255(52 * v), clamp255(52 * v), 255];
};
/** 灵魂沙：灰褐底 + 一张张"人脸"似的孔洞 */
const SOUL_SAND_PAINTER: Painter = (x, y, rng) => {
  const hole = hashString(`ss${x >> 2},${y >> 2}`) % 3 === 0;
  const inner = x % 4 === 1 && y % 4 >= 1 && y % 4 <= 2;
  if (hole && inner) {
    const v = 0.52 + rng() * 0.08;
    return [clamp255(96 * v), clamp255(84 * v), clamp255(68 * v), 255];
  }
  const v = 1 + (rng() * 0.12 - 0.06);
  return [clamp255(114 * v), clamp255(96 * v), clamp255(76 * v), 255];
};
/** 灵魂土：比灵魂沙更均匀的灰褐色 */
const SOUL_SOIL_PAINTER = layered(96, 6, 7, [1.06, 0.98, 0.84]);
/** 玄武岩侧面：竖直的柱状节理 */
const BASALT_SIDE_PAINTER: Painter = (x, y, rng) => {
  const column = x % 4 === 3 ? -0.2 : 0.04;
  const v = 1 + column + (rng() * 0.1 - 0.05) + Math.sin(y * 0.7) * 0.03;
  return [clamp255(66 * v), clamp255(64 * v), clamp255(70 * v), 255];
};
/** 玄武岩顶面：同心环状的节理截面 */
const BASALT_TOP_PAINTER: Painter = (x, y, rng) => {
  const ring = Math.sin(Math.hypot(x - 7.5, y - 7.5) * 1.1) * 0.14;
  const v = 1 + ring + (rng() * 0.1 - 0.05);
  return [clamp255(78 * v), clamp255(76 * v), clamp255(84 * v), 255];
};
const SMOOTH_BASALT_PAINTER = layered(62, 2, 4);
/** 黑石：接近纯黑的玄武质岩石 + 细密裂纹 */
const BLACKSTONE_PAINTER: Painter = (x, y, rng) => {
  const crack = hashString(`bs${x},${y}`) % 19 === 0;
  const v = 1 + (rng() * 0.12 - 0.06) + (crack ? -0.28 : 0);
  return [clamp255(38 * v), clamp255(32 * v), clamp255(36 * v), 255];
};
/**
 * 磨制黑石（批次 82）：黑石去掉杂纹、磨光之后的平面（比黑石亮一点点、无裂纹）。
 * 与黑石同一套色（38/32/36），差别只有"均匀"这一件事。
 */
const POLISHED_BLACKSTONE_PAINTER: Painter = (x, y, rng) => {
  // 极淡的两条分割线（原版磨制石材靠这个读出来"It's polished"）
  const line = x === 7 || y === 7;
  const v = (line ? 0.88 : 1.04) + (rng() * 0.06 - 0.03);
  return [clamp255(38 * v), clamp255(32 * v), clamp255(36 * v), 255];
};

/**
 * 鎏金黑石（批次 82）：黑石底 + 嵌在里面的金块。
 *
 * 金斑的位置用**位置哈希**而不是随机数：同一个坐标永远同一张图（贴图只画一次，
 * 但"看起来是随机分布的"这件事由哈希保证），而且不同区块的同一块方块长得一样。
 */
const GILDED_BLACKSTONE_PAINTER: Painter = (x, y, rng) => {
  const cell = hashString(`gb${x >> 1},${y >> 1}`) % 100;
  if (cell < 22) {
    // 金斑：1~2 像素的小块，边缘偏暗（金属的立体感）
    const edge = x % 2 === 0 || y % 2 === 0;
    const v = edge ? 0.82 : 1.05;
    return [clamp255(232 * v), clamp255(176 * v), clamp255(52 * v), 255];
  }
  const crack = hashString(`gbc${x},${y}`) % 17 === 0;
  const v = 1 + (rng() * 0.12 - 0.06) + (crack ? -0.26 : 0);
  return [clamp255(40 * v), clamp255(34 * v), clamp255(38 * v), 255];
};

/** 岩浆块：暗色底 + 明亮裂纹（自发光 3） */
const MAGMA_PAINTER: Painter = (x, y, rng) => {
  const key = (y >> 1) * 8 + (x >> 1);
  const glow = (hashString(`magma${key}`) % 100) / 100;
  if (glow > 0.62) {
    const v = 0.9 + rng() * 0.3;
    return [clamp255(238 * v), clamp255(126 * v), clamp255(36 * v), 255];
  }
  const v = 0.9 + rng() * 0.24;
  return [clamp255(66 * v), clamp255(30 * v), clamp255(24 * v), 255];
};
/** 菌岩顶面：下界岩上长满一层彩色"苔" */
function nyliumPainter(rgb: readonly [number, number, number], salt: string): Painter {
  const base = NETHERRACK_PAINTER;
  return (x, y, rng) => {
    const coverage = hashString(`${salt}${x >> 1},${y >> 1}`) % 100;
    if (coverage < 68) {
      const v = 1 + (rng() * 0.22 - 0.11);
      return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
    }
    return base(x, y, rng);
  };
}
/** 菌岩侧面：上半是菌苔、下半是下界岩 */
function nyliumSidePainter(rgb: readonly [number, number, number], salt: string): Painter {
  const top = nyliumPainter(rgb, salt);
  const base = NETHERRACK_PAINTER;
  return (x, y, rng) => (y < 5 + (hashString(`nys${x}`) % 3) ? top(x, y, rng) : base(x, y, rng));
}
/** 菌柄侧面：竖向纤维（比主世界原木更"肉质"） */
function stemSidePainter(rgb: readonly [number, number, number]): Painter {
  return (x, _y, rng) => {
    const fiber = Math.sin(x * 1.3) * 0.1;
    const v = 1 + fiber + (rng() * 0.14 - 0.07);
    return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
  };
}
/** 菌菇：一根细柄 + 一顶扁伞（比主世界蘑菇更鲜艳） */
function fungusPainter(cap: readonly [number, number, number], stem: readonly [number, number, number], salt: string): Painter {
  return (x, y, rng) => {
    if (y >= 11 && Math.abs(x - 7.5) < 1.5) {
      const v = 1 + (rng() * 0.1 - 0.05);
      return [clamp255(stem[0] * v), clamp255(stem[1] * v), clamp255(stem[2] * v), 255];
    }
    const dx = (x - 7.5) / 6;
    const dy = (y - 8) / 4.4;
    if (dx * dx + dy * dy > 1) return EMPTY;
    const rim = dx * dx + dy * dy > 0.62;
    const spot = hashString(`${salt}f${x},${y}`) % 15 === 0;
    const v = (rim ? 0.84 : 1.1) + (rng() * 0.1 - 0.05);
    const s = spot ? 1.45 : 1;
    return [clamp255(cap[0] * v * s), clamp255(cap[1] * v * s), clamp255(cap[2] * v * s), 255];
  };
}
/** 疣块：成团的肉质凸起 */
function wartBlockPainter(rgb: readonly [number, number, number], salt: string): Painter {
  return (x, y, rng) => {
    const key = (y >> 1) * 8 + (x >> 1);
    const bump = (hashString(`${salt}w${key}`) % 100) / 100;
    const v = 0.84 + bump * 0.4 + (rng() * 0.1 - 0.05);
    return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
  };
}
/** 菌光体：橙色发光的肉质团 */
const SHROOMLIGHT_PAINTER: Painter = (x, y, rng) => {
  const key = (y >> 1) * 8 + (x >> 1);
  const bump = (hashString(`sl${key}`) % 100) / 100;
  const v = 0.92 + bump * 0.34 + (rng() * 0.08 - 0.04);
  return [clamp255(240 * v), clamp255(152 * v), clamp255(78 * v), 255];
};
/** 远古残骸：深褐底 + 紫色金属纹路 */
const ANCIENT_DEBRIS_PAINTER: Painter = (x, y, rng) => {
  const vein = hashString(`ad${x},${y}`) % 9 === 0 || hashString(`ad${x >> 1},${y}`) % 7 === 0;
  if (vein) {
    const v = 1 + (rng() * 0.16 - 0.08);
    return [clamp255(148 * v), clamp255(112 * v), clamp255(120 * v), 255];
  }
  const v = 1 + (rng() * 0.16 - 0.08);
  return [clamp255(78 * v), clamp255(56 * v), clamp255(52 * v), 255];
};
/** 下界苗 / 菌索：细小的红色或青色枝蔓 */
function rootsPainter(rgb: readonly [number, number, number], salt: string): Painter {
  return (x, y, rng) => {
    const column = hashString(`${salt}r${x}`);
    if (column % 100 >= 46) return EMPTY;
    const top = 3 + (column >> 4) % 7;
    if (y < top) return EMPTY;
    const v = 1 + (rng() * 0.24 - 0.12);
    return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
  };
}

PAINTERS.short_grass = bladesPainter([104, 158, 66], 7, 12);
PAINTERS.fern = bladesPainter([86, 142, 62], 9, 14);
PAINTERS.dandelion = flowerPainter([92, 148, 60], [250, 226, 74], 'dand');
PAINTERS.poppy = flowerPainter([92, 148, 60], [214, 54, 48], 'poppy');
PAINTERS.blue_orchid = flowerPainter([92, 148, 60], [58, 168, 208], 'orchid');
PAINTERS.oxeye_daisy = flowerPainter([92, 148, 60], [242, 242, 236], 'daisy');
PAINTERS.cornflower = flowerPainter([92, 148, 60], [86, 108, 214], 'corn');
PAINTERS.red_mushroom = mushroomPainter([196, 44, 44], [236, 226, 216], 'rm');
PAINTERS.brown_mushroom = mushroomPainter([154, 112, 78], [222, 212, 198], 'bm');
PAINTERS.sugar_cane = stalkPainter([142, 190, 96], 6, [166, 206, 118]);
PAINTERS.bamboo = stalkPainter([122, 176, 66], 8, [148, 198, 92]);
PAINTERS.dead_bush = DEAD_BUSH_PAINTER;
PAINTERS.pumpkin_side = gourdSidePainter([226, 132, 32], 'pumpkin');
PAINTERS.pumpkin_top = gourdTopPainter([216, 122, 28], [128, 94, 48]);
PAINTERS.melon_side = gourdSidePainter([124, 168, 46], 'melon');
PAINTERS.melon_top = gourdTopPainter([116, 158, 42], null);
PAINTERS.cactus_side = CACTUS_SIDE_PAINTER;
PAINTERS.cactus_top = CACTUS_TOP_PAINTER;

PAINTERS.prismarine = PRISMARINE_PAINTER;
PAINTERS.prismarine_bricks = PRISMARINE_BRICKS_PAINTER;
PAINTERS.dark_prismarine = DARK_PRISMARINE_PAINTER;
PAINTERS.sea_lantern = SEA_LANTERN_PAINTER;

PAINTERS.netherrack = NETHERRACK_PAINTER;
PAINTERS.soul_sand = SOUL_SAND_PAINTER;
PAINTERS.soul_soil = SOUL_SOIL_PAINTER;
PAINTERS.basalt_side = BASALT_SIDE_PAINTER;
PAINTERS.basalt_top = BASALT_TOP_PAINTER;
PAINTERS.smooth_basalt = SMOOTH_BASALT_PAINTER;
PAINTERS.blackstone = BLACKSTONE_PAINTER;
// 黑石家族（K8 收尾，批次 82）：堡垒遗迹的三块建材
PAINTERS.polished_blackstone = POLISHED_BLACKSTONE_PAINTER;
PAINTERS.gilded_blackstone = GILDED_BLACKSTONE_PAINTER;
// ---- 黑石家族的装饰性补齐（批次 85，B50）
/**
 * 通用"砖"画笔：底色的砖 + 更暗的缝（批次 85）。
 *
 * 与批次的砖画笔是同一种画法，只是底色可传——
 * 磨制黑石砖、裂纹磨制黑石砖都要用它，所以抽出来；**没有去改那张老画笔**，
 * 因为它是"黑石砖"这个具体方块的贴图，混用参数会让两处风格漂移。
 */
function bricksPainter(base: readonly [number, number, number], mortar: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const row = y >> 2;
    const offset = (row % 2) * 4;
    const isMortar = y % 4 === 3 || (x + offset) % 8 === 7;
    const tint = isMortar ? mortar : base;
    const v = isMortar ? 0.94 + (rng() * 0.08 - 0.04) : 1 + (rng() * 0.14 - 0.07);
    return [clamp255(tint[0] * v), clamp255(tint[1] * v), clamp255(tint[2] * v), 255];
  };
}

/**
 * 磨制黑石砖：磨制黑石 + 黑石砖的**结合**。
 *
 * 原版的这张贴图与黑石砖用的是同一套砖缝，只是色调更接近磨制黑石（更亮、更平）。
 * 所以这里直接拿砖画笔、把底色换成磨制黑石那一档——**两张贴图看起来是一家人才对**
 * （新画一张风格不同的，"砖"就变成两种东西了）。
 */
PAINTERS.polished_blackstone_bricks = bricksPainter([46, 40, 44], [30, 26, 30]);
/**
 * 錾制磨制黑石：中间一个"图案"（原版是个带缺口的花纹）。
 * 图案用**位置判据**画（十字 + 四角），不掷随机数——"錾"就是工整的意思。
 */
PAINTERS.chiseled_polished_blackstone = (x, _y, rng) => {
  const v = 1 + (rng() * 0.08 - 0.04);
  // 边框 + 中间的十字与四角（工整的几何图案）
  const border = x === 0 || x === 15 || (_y === 0 || _y === 15);
  const pattern =
    (x >= 6 && x <= 9 && _y >= 2 && _y <= 13) ||
    (_y >= 6 && _y <= 9 && x >= 2 && x <= 13) ||
    ((x === 4 || x === 11) && (_y === 4 || _y === 11));
  if (border) return [clamp255(26 * v), clamp255(22 * v), clamp255(25 * v), 255];
  if (pattern) return [clamp255(30 * v), clamp255(26 * v), clamp255(29 * v), 255];
  return [clamp255(44 * v), clamp255(38 * v), clamp255(42 * v), 255];
};
/**
 * 裂纹磨制黑石砖：黑石砖 + 几条裂纹。
 * 裂纹用位置哈希决定走向，所以**每一块砖的裂纹都不一样**，但同一块永远一样。
 */
PAINTERS.cracked_polished_blackstone_bricks = (x, y, rng) => {
  const base = bricksPainter([46, 40, 44], [30, 26, 30])(x, y, rng);
  // 三条斜裂纹：`(x + y) % 7` 之类会画成规整的斜线，这里让每条裂纹自己有个偏移
  const crack = (x * 3 + y * 5 + (hashString(`crack${x >> 3},${y >> 3}`) % 5)) % 11 === 0;
  if (!crack) return base;
  return [clamp255(base[0] * 0.55), clamp255(base[1] * 0.55), clamp255(base[2] * 0.55), 255];
};
// ---------------------------------------------------------------- 墙上挂东西（B14，批次 86）

/**
 * 展示框：**一圈木条 + 中间镂空**（镂空的像素 alpha = 0）。
 *
 * 为什么不是"四个木条盒子"：原版的框就是一圈木边中间一个洞，
 * 一个盒子 + 一张带透明通道的贴图就够了，也不必为 4 个朝向各摆一次木条。
 * 实心层的 alphaTest 会把中间那片直接丢弃（`uAlphaTest = 0.5`），
 * 所以透过框能看到后面的墙——这一档与树叶/藤蔓同一套做法。
 *
 * 环画在 2..13 这一圈（12×12 外框、木条 2 像素、洞口 8×8）：
 * 板子本身占满整格，于是"框"看起来就是墙面正中一个 12/16 的木框。
 */
PAINTERS.item_frame = (x, y, rng) => {
  const inRing = x >= 2 && x <= 13 && y >= 2 && y <= 13;
  const inHole = x >= 4 && x <= 11 && y >= 4 && y <= 11;
  if (!inRing || inHole) return [0, 0, 0, 0];
  const v = 1 + (rng() * 0.1 - 0.05);
  // 外缘一圈亮、贴着洞口那一圈暗：两像素的木条也能看出一点厚度
  const outer = x === 2 || x === 13 || y === 2 || y === 13;
  const inner = x === 4 || x === 11 || y === 4 || y === 11;
  if (outer) return [clamp255(178 * v), clamp255(142 * v), clamp255(94 * v), 255];
  if (inner) return [clamp255(100 * v), clamp255(72 * v), clamp255(42 * v), 255];
  return [clamp255(140 * v), clamp255(108 * v), clamp255(66 * v), 255];
};

/**
 * 画（B14，批次 86）：一幅 16×16 的小画 = **一块底色 + 若干矩形**。
 *
 * 为什么用"矩形清单"而不是逐个像素画：7 幅画各手写 256 个像素不可能维护
 * （改一处颜色要翻半天），而画本来就是"色块叠色块"——
 * 声明成"先铺底色、再按顺序盖矩形"最接近人脑子里那张图。
 * 后写的矩形盖前面的，所以构图按"由远到近"排。
 */
type PaintingRect = readonly [number, number, number, number, readonly [number, number, number]];

function paintingPainter(
  background: readonly [number, number, number],
  rects: readonly PaintingRect[],
): Painter {
  return (x, y) => {
    for (let i = rects.length - 1; i >= 0; i--) {
      const [rx, ry, rw, rh, rgb] = rects[i]!;
      if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) return [rgb[0], rgb[1], rgb[2], 255];
    }
    return [background[0], background[1], background[2], 255];
  };
}

/**
 * ⚠️ **只做了原版 1.18 里 1×1 的 7 幅**（多格拼贴的大画要跨格占用，见 `registry/paintings.ts`）。
 * 这 7 幅的画面是**按原版配色自绘的近似图**（原版素材受版权保护，不能随仓库分发），
 * 所以"像不像原版那一幅"只到"一眼能认出是什么"的程度：
 * 烤肉串是一根串着肉的签子、炸弹是一个带引线的黑球、植物是一盆绿植……
 */
PAINTERS.painting_kebab = paintingPainter([46, 30, 22], [
  [1, 1, 14, 14, [58, 38, 26]],
  [7, 1, 1, 14, [198, 198, 202]],
  [5, 2, 5, 3, [176, 96, 50]],
  [5, 6, 5, 3, [150, 76, 38]],
  [5, 10, 5, 3, [176, 96, 50]],
  [5, 13, 5, 2, [136, 66, 34]],
]);
PAINTERS.painting_aztec = paintingPainter([104, 148, 188], [
  [0, 11, 16, 5, [58, 92, 52]],
  [12, 2, 3, 3, [232, 214, 138]],
  [1, 8, 14, 3, [168, 146, 112]],
  [3, 5, 10, 3, [146, 124, 94]],
  [5, 2, 6, 3, [124, 104, 78]],
  [7, 0, 2, 2, [104, 86, 64]],
]);
PAINTERS.painting_alban = paintingPainter([196, 158, 108], [
  [0, 9, 16, 7, [70, 92, 54]],
  [0, 6, 16, 3, [96, 84, 64]],
  [2, 3, 5, 3, [124, 108, 82]],
  [9, 2, 6, 4, [112, 96, 74]],
  [1, 1, 4, 1, [222, 214, 196]],
  [7, 4, 4, 1, [214, 204, 186]],
]);
PAINTERS.painting_aztec2 = paintingPainter([54, 46, 38], [
  [0, 11, 16, 5, [150, 132, 96]],
  [4, 2, 8, 9, [132, 112, 80]],
  [3, 1, 10, 1, [104, 86, 60]],
  [6, 4, 1, 2, [46, 38, 30]],
  [9, 4, 1, 2, [46, 38, 30]],
  [6, 8, 4, 1, [46, 38, 30]],
  [7, 12, 2, 3, [104, 86, 60]],
]);
PAINTERS.painting_bomb = paintingPainter([168, 40, 40], [
  [5, 5, 6, 1, [30, 30, 34]],
  [4, 6, 8, 1, [26, 26, 30]],
  [3, 7, 10, 4, [20, 20, 24]],
  [4, 11, 8, 1, [26, 26, 30]],
  [5, 12, 6, 1, [30, 30, 34]],
  [6, 7, 2, 2, [76, 76, 84]],
  [9, 3, 1, 3, [214, 176, 84]],
  [10, 2, 3, 1, [240, 200, 96]],
]);
PAINTERS.painting_plant = paintingPainter([122, 100, 70], [
  [0, 0, 16, 2, [96, 78, 54]],
  [2, 12, 12, 4, [176, 96, 58]],
  [1, 11, 14, 1, [198, 116, 72]],
  [7, 3, 2, 9, [72, 118, 54]],
  [3, 5, 4, 2, [92, 148, 62]],
  [9, 4, 4, 2, [92, 148, 62]],
  [5, 2, 6, 2, [112, 172, 74]],
  [6, 1, 4, 1, [132, 190, 86]],
]);
PAINTERS.painting_wasteland = paintingPainter([228, 206, 156], [
  [0, 0, 16, 2, [196, 176, 132]],
  [0, 10, 16, 6, [206, 176, 112]],
  [0, 10, 16, 1, [186, 156, 96]],
  [7, 3, 2, 7, [92, 70, 48]],
  [4, 4, 3, 1, [92, 70, 48]],
  [10, 2, 3, 1, [92, 70, 48]],
  [11, 11, 4, 2, [176, 146, 88]],
]);

// ---- 村民的工作站四件（J23，批次 90）
// 四个都是"木架 + 一件工具"的思路：一眼能分出谁是谁（村里认领职业时靠它认路）。
const WOOD_FRAME: readonly [number, number, number] = [156, 118, 74];
const WOOD_FRAME_DARK: readonly [number, number, number] = [122, 92, 58];
const WOOD_FRAME_LIGHT: readonly [number, number, number] = [186, 148, 100];

/** 讲台：顶面摊开的书（两侧是木台），侧面木框 + 露出来的书脊 */
PAINTERS.lectern_top = paintingPainter(WOOD_FRAME_LIGHT, [
  [0, 0, 16, 3, WOOD_FRAME],
  [0, 13, 16, 3, WOOD_FRAME],
  [2, 3, 12, 10, [242, 238, 228]],
  [2, 3, 12, 1, [214, 208, 196]],
  [7, 3, 1, 10, [198, 190, 178]],
  [4, 5, 3, 1, [96, 96, 104]],
  [4, 7, 5, 1, [96, 96, 104]],
  [4, 9, 4, 1, [96, 96, 104]],
  [10, 5, 3, 1, [96, 96, 104]],
  [10, 7, 5, 1, [96, 96, 104]],
]);
PAINTERS.lectern_side = paintingPainter(WOOD_FRAME_DARK, [
  [0, 0, 16, 4, WOOD_FRAME],
  [0, 10, 16, 6, WOOD_FRAME],
  [0, 4, 16, 1, WOOD_FRAME_LIGHT],
  [4, 4, 8, 7, [242, 238, 228]],
  [4, 4, 1, 7, [214, 208, 196]],
]);

/** 制箭台：顶面是石板 + 燧石 + 羽毛（做箭的两样），侧面木板 + 一列工具 */
PAINTERS.fletching_table_top = paintingPainter(WOOD_FRAME_LIGHT, [
  [0, 0, 16, 16, [176, 176, 172]],
  [1, 1, 14, 14, [156, 156, 152]],
  [3, 3, 5, 6, [72, 72, 78]],
  [3, 3, 5, 1, [102, 102, 110]],
  [10, 2, 3, 6, [238, 238, 232]],
  [9, 8, 6, 3, [206, 152, 72]],
  [9, 8, 6, 1, [232, 186, 108]],
]);
PAINTERS.fletching_table_side = paintingPainter(WOOD_FRAME, [
  [0, 0, 16, 5, WOOD_FRAME_LIGHT],
  [2, 6, 3, 8, [72, 72, 78]],
  [7, 6, 2, 8, [206, 152, 72]],
  [11, 6, 2, 8, [238, 238, 232]],
]);

/** 砂轮：顶面是石转轮（同心圆 + 轴），侧面木架 + 摇柄 */
PAINTERS.grindstone_top = paintingPainter(WOOD_FRAME, [
  [2, 2, 12, 12, [126, 126, 130]],
  [3, 3, 10, 10, [150, 150, 154]],
  [6, 6, 4, 4, [104, 104, 108]],
  [7, 0, 2, 16, WOOD_FRAME_DARK],
  [0, 7, 16, 2, WOOD_FRAME_DARK],
]);
PAINTERS.grindstone_side = paintingPainter(WOOD_FRAME_DARK, [
  [0, 0, 16, 3, WOOD_FRAME],
  [2, 3, 12, 7, [150, 150, 154]],
  [2, 3, 12, 1, [176, 176, 180]],
  [6, 10, 4, 2, WOOD_FRAME_LIGHT],
  [11, 4, 4, 2, WOOD_FRAME_LIGHT],
  [0, 12, 16, 4, WOOD_FRAME],
]);

/** 织布机：顶面绷着经线，侧面立柱 + 线轴，底面实心木板 */
PAINTERS.loom_top = paintingPainter(WOOD_FRAME_LIGHT, [
  [1, 1, 14, 14, WOOD_FRAME],
  [2, 2, 12, 11, [226, 226, 218]],
  [3, 2, 1, 11, [190, 190, 182]],
  [5, 2, 1, 11, [190, 190, 182]],
  [7, 2, 1, 11, [190, 190, 182]],
  [9, 2, 1, 11, [190, 190, 182]],
  [11, 2, 1, 11, [190, 190, 182]],
  [2, 8, 12, 2, [188, 96, 96]],
]);
PAINTERS.loom_bottom = paintingPainter(WOOD_FRAME_DARK, [
  [0, 0, 16, 16, WOOD_FRAME],
  [1, 1, 14, 14, WOOD_FRAME_DARK],
]);
PAINTERS.loom_side = paintingPainter(WOOD_FRAME, [
  [0, 0, 16, 3, WOOD_FRAME_LIGHT],
  [1, 3, 2, 12, WOOD_FRAME_DARK],
  [13, 3, 2, 12, WOOD_FRAME_DARK],
  [4, 4, 8, 8, [226, 226, 218]],
  [5, 5, 6, 1, [190, 190, 182]],
  [5, 7, 6, 1, [190, 190, 182]],
  [5, 9, 6, 1, [190, 190, 182]],
]);

PAINTERS.magma = MAGMA_PAINTER;

/**
 * 下界疣（批次 92）：4 个阶段。
 *
 * 原版是一株**紫红色的小瘤**：矮矮一根茎，上面顶着几颗越来越鼓的疙瘩。
 * 画法与甜浆果丛同一个套路（下宽上窄的"丛形" + 固定的几颗果子），只是颜色走红紫系、
 * 阶段越高**疙瘩越多越大**——玩家一眼就能看出"这株能收了"。
 */
function netherWartPainter(stage: number): Painter {
  const height = 4 + stage * 3; // 4 / 7 / 10 / 13
  const nodules = stage; // 第 0 阶段一颗都没有，越熟越多
  const noduleX = [4, 11, 6, 9];
  return (x, y, rng) => {
    const jitter = rng() * 8 - 4;
    const dy = 15 - y;
    if (dy > height) return [0, 0, 0, 0];
    const dx = Math.abs(x - 7.5);
    // 茎：细，越往上越窄
    const half = 1.5 + (height - dy) * 0.16;
    if (dx > half) return [0, 0, 0, 0];
    // 疙瘩：固定几个位置，阶段越高越多（第 3 阶段四颗全在）
    if (nodules > 0 && dy >= 2 && dy <= 2 + stage * 2 + 1 && noduleX.slice(0, nodules).includes(x)) {
      return [clamp255(178 + jitter), clamp255(42 + jitter), clamp255(58 + jitter), 255];
    }
    // 茎体：暗红紫，顶部略亮（新芽）
    const base = 96 + stage * 10 + (dy > height - 3 ? 20 : 0);
    return [clamp255(base + jitter + 24), clamp255(base * 0.32 + jitter), clamp255(base * 0.42 + jitter), 255];
  };
}

for (let stage = 0; stage < 4; stage++) PAINTERS[`nether_wart_stage${stage}`] = netherWartPainter(stage);

/** 烈焰棒（批次 92）：一根带弧度的金黄棒子，顶端偏橙（原版就是"烧红的棍子"） */
PAINTERS.item_blaze_rod = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 从右下到左上的一条斜棒（3 像素宽），两端收窄
  const center = 14 - (15 - y) * 0.75;
  const dx = Math.abs(x - center);
  if (dx > 1.6 || y < 2) return [0, 0, 0, 0];
  const hot = y < 6; // 顶端更亮更橙
  return hot
    ? [clamp255(250 + jitter), clamp255(186 + jitter), clamp255(70 + jitter), 255]
    : [clamp255(236 + jitter), clamp255(152 + jitter), clamp255(42 + jitter), 255];
};

/**
 * 刷怪笼（批次 92）：一层**镂空**的铁栏杆。
 *
 * 边框 + 横竖各两条栏杆，其余像素透明——走实心层的 alphaTest 丢空（与展示框同一档），
 * 于是隔着笼子能看见里面的方块。原版笼子里还有一只旋转的小生物（没做，见 E14）。
 */
PAINTERS.spawner = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  const onFrame = x <= 1 || x >= 14 || y <= 1 || y >= 14;
  const onBar = x % 5 === 2 || y % 5 === 2;
  if (!onFrame && !onBar) return [0, 0, 0, 0];
  // 栏杆本体偏暗铁色，交点（边框四角与栏杆交叉处）亮一点，看着像立体的架子
  const joint = onFrame && onBar;
  const base = joint ? 92 : 66;
  return [clamp255(base + jitter), clamp255(base + jitter), clamp255(base + 8 + jitter), 255];
};

/**
 * 凋灵骷髅头（批次 115）：炭灰色的头骨，两个黑洞洞的眼窝 + 一排牙。
 *
 * 它同时是**四个侧面**（本项目不存朝向，见 `blocks.ts` 的 `SKULL_SPECS`）：
 * 所以脸要画在正中间、左右留出"后脑勺"的余量——从任何一面看都是一张脸。
 */
PAINTERS.wither_skull = (x, y, rng) => {
  const jitter = rng() * 16 - 8;
  // 眼窝：5~7 行、两侧各三格（黑色，比头骨本身暗得多）
  const eye = y >= 5 && y <= 7 && ((x >= 3 && x <= 5) || (x >= 10 && x <= 12));
  if (eye) return [10, 10, 12, 255];
  // 嘴：10~11 行的一排牙（隔一格留一颗，看着像咬合）
  const mouth = (y === 10 || y === 11) && x >= 4 && x <= 11 && x % 2 === 0;
  if (mouth) return [24, 24, 28, 255];
  // 头骨本体：偏冷灰，边缘（1 格内缩）稍暗，做出一点体积感
  const edge = x <= 1 || x >= 14 || y <= 1 || y >= 14;
  const base = (edge ? 54 : 74) + jitter;
  return [clamp255(base), clamp255(base), clamp255(base + 6), 255];
};

/**
 * 蓝色的凋灵骷髅头（批次 116）：与黑色的同一张脸，只是整颗**染成蓝白**。
 *
 * 它是凋灵半血之后吐的那一颗（伤害更高、凋零更久），所以必须一眼看出区别——
 * 原版也是靠颜色区分的（黑/蓝）。
 */
PAINTERS.wither_skull_blue = (x, y, rng) => {
  const jitter = rng() * 16 - 8;
  const eye = y >= 5 && y <= 7 && ((x >= 3 && x <= 5) || (x >= 10 && x <= 12));
  if (eye) return [16, 30, 54, 255];
  const mouth = (y === 10 || y === 11) && x >= 4 && x <= 11 && x % 2 === 0;
  if (mouth) return [30, 52, 86, 255];
  const edge = x <= 1 || x >= 14 || y <= 1 || y >= 14;
  const base = (edge ? 96 : 132) + jitter;
  return [clamp255(base * 0.62), clamp255(base * 0.86), clamp255(base + 40), 255];
};

/** 下界之星（批次 116）：一颗发白的四角星，中间亮、边缘淡 */
PAINTERS.item_nether_star = (x, y, rng) => {
  const dx = Math.abs(x - 7.5);
  const dy = Math.abs(y - 7.5);
  // 四角星的判据：横向或纵向离中心近，越靠边越窄
  const spike = dx < 1.6 || dy < 1.6;
  const reach = dx + dy;
  if (spike && reach < 7.6) {
    const glow = clamp255(250 - reach * 14 + rng() * 14);
    return [glow, clamp255(glow * 0.97), clamp255(glow * 0.8), 255];
  }
  // 斜向的四个短角：淡一些
  if (Math.abs(dx - dy) < 1.4 && reach < 6.2) {
    return [clamp255(224 + rng() * 16), clamp255(220 + rng() * 16), clamp255(186 + rng() * 16), 255];
  }
  return [0, 0, 0, 0];
};

/**
 * 矿物块（批次 117，K5）：整块同色，但每 4×4 小格有一圈**更亮的边**。
 *
 * 原版的矿物块就是这种**规整**的斑纹（不是噪声），所以这里也不用 `noisy`：
 * 4 的周期正好把 16×16 切成 16 个小格，远看是"一块块压出来的金属"。
 */
function mineralPainter(tint: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const cx = x % 4;
    const cy = y % 4;
    const edge = cx === 0 || cx === 3 || cy === 0 || cy === 3;
    const corner = (cx === 0 || cx === 3) && (cy === 0 || cy === 3);
    const jitter = rng() * 8 - 4;
    const v = (corner ? 182 : edge ? 236 : 206) + jitter;
    return [clamp255(v * tint[0]), clamp255(v * tint[1]), clamp255(v * tint[2]), 255];
  };
}

/**
 * 粘液块（批次 120）：半透明的绿。
 *
 * ⚠️ **不带 alpha**（本项目的方块贴图一旦有 alpha 就要走透明那一套渲染），
 * 所以"果冻感"靠花纹表达：每 4×4 一格深色边（与原版粘液块的花纹同一个意思）。
 */
PAINTERS.slime_block = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const edge = x % 4 === 0 || y % 4 === 0;
  const base = (edge ? 96 : 138) + jitter;
  return [clamp255(base * 0.52), clamp255(base + 22), clamp255(base * 0.68), 255];
};

/** 粘液球（批次 120）：一颗亮绿的球，左上有一点高光（果冻反光的样子） */
PAINTERS.item_slime_ball = (x, y, rng) => {
  const dx = x - 7.5;
  const dy = y - 7.5;
  const distance = Math.hypot(dx, dy);
  if (distance > 6.4) return [0, 0, 0, 0];
  const jitter = rng() * 12 - 6;
  const highlight = Math.hypot(dx + 2.2, dy + 2.2) < 2.1;
  const base = (highlight ? 214 : distance > 5 ? 108 : 160) + jitter;
  return [clamp255(base * 0.5), clamp255(base + 24), clamp255(base * 0.66), 255];
};

PAINTERS.gold_block = mineralPainter([1.0, 0.83, 0.28]);
PAINTERS.diamond_block = mineralPainter([0.52, 0.94, 0.94]);
PAINTERS.emerald_block = mineralPainter([0.32, 0.92, 0.44]);

/**
 * 信标（批次 117，K5）的**侧面**：底下一截黑曜石、上面是玻璃身、中间透出那颗星。
 *
 * 原版是三段实体几何，这里按本项目的画法压进一张贴图（见 `blocks.ts` 的
 * `MINERAL_AND_BEACON_SPECS` 注记）——所以"星"只画在正面那几格上，
 * 从侧面看它就是一颗发亮的核。
 */
PAINTERS.beacon = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  // 底下 4 行：黑曜石底盘
  if (y >= 12) return [clamp255(26 + jitter), clamp255(20 + jitter), clamp255(40 + jitter), 255];
  // 玻璃身的边框（外圈与底盘上沿各深一档）
  const frame = x === 0 || x === 15 || y === 3 || y === 11;
  // 中间那颗星：淡青发亮（原版信标里就是它）
  if (x >= 6 && x <= 9 && y >= 6 && y <= 9) {
    return [clamp255(198 + jitter), clamp255(238 + jitter), clamp255(242 + jitter), 255];
  }
  const base = frame ? 104 : 140;
  return [clamp255(base * 0.7), clamp255(base * 0.9), clamp255(base + 26), 255];
};

/** 信标的**顶面**：一圈玻璃口，正中是那道光的出口 */
PAINTERS.beacon_top = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  const inner = x >= 5 && x <= 10 && y >= 5 && y <= 10;
  if (inner) return [clamp255(216 + jitter), clamp255(246 + jitter), clamp255(250 + jitter), 255];
  const frame = x <= 1 || x >= 14 || y <= 1 || y >= 14;
  const base = frame ? 100 : 136;
  return [clamp255(base * 0.7), clamp255(base * 0.9), clamp255(base + 26), 255];
};

/**
 * 三叉戟（批次 123）：一根深色杆 + 三根亮色的齿。
 *
 * 原版它是"深海青"那种发暗的金属色，所以这里用**深底 + 亮齿**的对比让它一眼认出来
 * （与弓箭那类"细长物件"同一个画法：杆占中间两列、齿在顶上张开）。
 */
PAINTERS.item_trident = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 杆：中间两列、从 y=7 到底（不画满整格，留一点阴影）
  const shaft = x >= 7 && x <= 8 && y >= 7 && y <= 14;
  if (shaft) return [clamp255(58 + jitter), clamp255(96 + jitter), clamp255(104 + jitter), 255];
  // 三根齿：左中右各一根（中间的更高）
  const left = x >= 3 && x <= 4 && y >= 1 && y <= 6;
  const middle = x >= 7 && x <= 8 && y >= 0 && y <= 5;
  const right = x >= 11 && x <= 12 && y >= 1 && y <= 6;
  // 横梁：把三根齿连起来（y = 6 那一行）
  const bar = y === 6 && x >= 3 && x <= 12;
  if (left || middle || right || bar) {
    return [clamp255(126 + jitter), clamp255(196 + jitter), clamp255(202 + jitter), 255];
  }
  return [0, 0, 0, 0];
};

/**
 * 幻翼膜（批次 126）：一片**薄薄的暗青膜**——边缘半透、中间有几道筋。
 *
 * 它没有方块形态，所以四边留空（画成一个"飘着的小片"），
 * 与其它材料物品同一个画法。
 */
PAINTERS.item_phantom_membrane = (x, y, rng) => {
  const dx = x - 7.5;
  const dy = y - 7.5;
  // 一片略扁的椭圆（膜是软的，不是方的）
  const inside = (dx * dx) / 30 + (dy * dy) / 20 <= 1;
  if (!inside) return [0, 0, 0, 0];
  const jitter = rng() * 12 - 6;
  // 几道更深的筋：沿水平方向每 4 行一条
  const rib = y % 4 === 0;
  const base = (rib ? 62 : 104) + jitter;
  return [clamp255(base * 0.72), clamp255(base + 18), clamp255(base + 22), 255];
};

/**
 * 墨囊（批次 189）：一颗**深蓝黑的鼓包**，左上角一点冷光。
 *
 * 画法与幻翼膜相反——它是实心的（墨囊里有墨），所以不留透明边，
 * 只把外圈压暗做出圆润感：一眼能认出"这是 squid 掉的那颗"。
 */
PAINTERS.item_ink_sac = (x, y, rng) => {
  const dx = x - 7.5;
  const dy = y - 8.2;
  const d = Math.hypot(dx, dy * 0.94);
  if (d > 6.3) return [0, 0, 0, 0];
  const jitter = rng() * 10 - 5;
  // 顶部那一小截"扎口"：比身子再暗一档
  if (y <= 2 && Math.abs(dx) < 1.6) return [clamp255(18 + jitter), clamp255(20 + jitter), clamp255(32 + jitter), 255];
  // 左上高光（光源与其它物品图标一致）
  if (Math.hypot(x - 5.4, y - 5.8) < 1.7) return [clamp255(104 + jitter), clamp255(112 + jitter), clamp255(136 + jitter), 255];
  const base = (d > 4.8 ? 18 : 30) + jitter;
  return [clamp255(base * 0.8), clamp255(base * 0.86), clamp255(base + 16), 255];
};

/**
 * 空地图（批次 196）：**卷起来的纸卷**——上下两道深色卷边、中间米色纸面。
 *
 * 与"已填好的地图"的区别要一眼看出：这个没有内容（空白），那个画着绿色地块。
 */
PAINTERS.item_map = (x, y, rng) => {
  const jitter = rng() * 5 - 2.5;
  const left = 3;
  const right = 12;
  if (x < left || x > right) return [0, 0, 0, 0];
  // 上下卷边（比纸面深一档）
  if (y <= 3 || y >= 12) {
    if (y < 2 || y > 13) return [0, 0, 0, 0];
    return [clamp255(150 + jitter), clamp255(122 + jitter), clamp255(72 + jitter), 255];
  }
  // 纸面：左浅右深一点（圆柱感）
  const shade = x >= right - 2 ? 18 : 0;
  return [clamp255(224 - shade + jitter), clamp255(210 - shade + jitter), clamp255(176 - shade + jitter), 255];
};

/**
 * 已填好的地图（批次 196）：**摊开的羊皮纸 + 几块绿色陆地 + 一个红叉**。
 *
 * 红叉是"这里探索过"的象征（真正的玩家标记在阅读界面里画）。
 */
PAINTERS.item_filled_map = (x, y, rng) => {
  const jitter = rng() * 5 - 2.5;
  if (x < 2 || x > 13 || y < 2 || y > 13) return [0, 0, 0, 0];
  // 纸边
  if (x === 2 || x === 13 || y === 2 || y === 13) {
    return [clamp255(150 + jitter), clamp255(126 + jitter), clamp255(84 + jitter), 255];
  }
  // 绿色陆地：两块不规则地块
  const landA = x >= 4 && x <= 8 && y >= 4 && y <= 8 && !(x === 8 && y === 8);
  const landB = x >= 9 && x <= 11 && y >= 8 && y <= 11;
  if (landA || landB) return [clamp255(96 + jitter), clamp255(148 + jitter), clamp255(74 + jitter), 255];
  // 红叉（右上角一点）
  if ((x === 11 && y === 4) || (x === 10 && y === 5) || (x === 11 && y === 5) || (x === 10 && y === 6) || (x === 12 && y === 3)) {
    return [clamp255(196 + jitter), clamp255(56 + jitter), clamp255(48 + jitter), 255];
  }
  // 纸面
  return [clamp255(226 + jitter), clamp255(212 + jitter), clamp255(178 + jitter), 255];
};

/**
 * 指南针（批次 195）：**圆表盘 + 红白指针**。
 *
 * 表盘用一圈深浅交替的金色表现"金属边"，指针是南北两极各一半（红指北、白指南），
 * 与时钟的区别一眼能看出来：时钟里画的是日月，指南针里只有一根针。
 */
PAINTERS.item_compass = (x, y, rng) => {
  const jitter = rng() * 6 - 3;
  const dx = x - 7.5;
  const dy = y - 7.5;
  const r = Math.hypot(dx, dy);
  if (r > 6.4) return [0, 0, 0, 0];
  // 外圈：金属边（右下暗、左上亮，做出一点立体）
  if (r > 4.9) {
    const light = dx + dy < 0 ? 40 : 0;
    return [clamp255(176 + light + jitter), clamp255(150 + light + jitter), clamp255(72 + light + jitter), 255];
  }
  // 盘面：米白
  if (r > 3.9) return [clamp255(226 + jitter), clamp255(222 + jitter), clamp255(206 + jitter), 255];
  // 指针：沿 y = x 的斜线（西北-东南），上半红、下半白；中间留一格深色轴心
  const axis = Math.abs(dx - dy);
  if (axis <= 0.8 && r <= 3.9) {
    if (r < 0.9) return [clamp255(70 + jitter), clamp255(60 + jitter), clamp255(50 + jitter), 255];
    return dy < 0
      ? [clamp255(206 + jitter), clamp255(48 + jitter), clamp255(40 + jitter), 255]
      : [clamp255(238 + jitter), clamp255(236 + jitter), clamp255(228 + jitter), 255];
  }
  return [clamp255(232 + jitter), clamp255(228 + jitter), clamp255(212 + jitter), 255];
};

/**
 * 时钟（批次 195）：**圆表盘 + 日月**——上半太阳（金）、下半月亮（银灰）。
 *
 * 静态图标只表达"这是个表盘"，真正的位置由 HUD 上那个小表盘按 `timeOfDay` 转。
 */
PAINTERS.item_clock = (x, y, rng) => {
  const jitter = rng() * 6 - 3;
  const dx = x - 7.5;
  const dy = y - 7.5;
  const r = Math.hypot(dx, dy);
  if (r > 6.4) return [0, 0, 0, 0];
  if (r > 5.1) {
    const light = dx + dy < 0 ? 36 : 0;
    return [clamp255(150 + light + jitter), clamp255(120 + light + jitter), clamp255(58 + light + jitter), 255];
  }
  // 上半：太阳（金色圆盘）；下半：夜空（深蓝）+ 月亮
  if (dy < 0) {
    const sunR = Math.hypot(dx, dy + 2.2);
    if (sunR < 1.6) return [clamp255(252 + jitter), clamp255(214 + jitter), clamp255(92 + jitter), 255];
    return [clamp255(214 + jitter), clamp255(226 + jitter), clamp255(240 + jitter), 255];
  }
  const moonR = Math.hypot(dx, dy - 2.2);
  if (moonR < 1.5) return [clamp255(238 + jitter), clamp255(240 + jitter), clamp255(228 + jitter), 255];
  return [clamp255(44 + jitter), clamp255(56 + jitter), clamp255(92 + jitter), 255];
};

/**
 * 盾牌（批次 194）：**木面铁边**的圆角盾——上方平、下方收尖，中间一块铁质盾心。
 *
 * 形状靠"逐行收边"画出来（不是矩形），因为物品栏里最能认出盾牌的就是那个下尖的轮廓。
 */
PAINTERS.item_shield = (x, y, rng) => {
  const jitter = rng() * 6 - 3;
  // 越往下越窄：y 11 起每行左右各收 1 格，最后一行收 3 格（收出一个尖）
  const inset = y >= 13 ? 3 : y >= 11 ? 1 : 0;
  const left = 3 + inset;
  const right = 12 - inset;
  if (x < left || x > right || y < 2 || y > 13) return [0, 0, 0, 0];
  // 外圈：铁边（亮一档的冷灰）
  if (x === left || x === right || y === 2 || y === 13) {
    return [clamp255(178 + jitter), clamp255(182 + jitter), clamp255(186 + jitter), 255];
  }
  // 盾心：4×4 的铁块 + 中心高光
  if (x >= 6 && x <= 9 && y >= 6 && y <= 9) {
    if (x === 7 || x === 8) {
      if (y === 7 || y === 8) return [clamp255(226 + jitter), clamp255(228 + jitter), clamp255(232 + jitter), 255];
    }
    return [clamp255(150 + jitter), clamp255(154 + jitter), clamp255(160 + jitter), 255];
  }
  // 木面：竖向木纹（每三列一档深浅）
  const plank = (x - left) % 3 === 0;
  return plank
    ? [clamp255(112 + jitter), clamp255(78 + jitter), clamp255(46 + jitter), 255]
    : [clamp255(138 + jitter), clamp255(98 + jitter), clamp255(58 + jitter), 255];
};

/**
 * 烟火之星（批次 192）：一颗**四角星**——中心白、四角金，周围散几点火星。
 *
 * 为什么不按颜色画：颜色是**每一颗星自己的数据**（`firework.colors`），
 * 图标只有一张，画成金色才不会出现"拿在手里是红的、炸出来是蓝的"那种错位。
 * 原版靠叠加一层颜色贴图区分，我们这里用"名称里带颜色"来表达（见 `itemNames`）。
 */
PAINTERS.item_firework_star = (x, y, rng) => {
  const jitter = rng() * 6 - 3;
  const cx = 7.5;
  const cy = 7.5;
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  // 四角星：|dx| + |dy| 小于半径，且两个轴不能同时太宽（收出尖角）
  const diamond = dx + dy;
  if (diamond <= 2.2) return [clamp255(250 + jitter), clamp255(246 + jitter), clamp255(226 + jitter), 255];
  if (diamond <= 4.6 && (dx < 1.2 || dy < 1.2)) {
    return [clamp255(238 + jitter), clamp255(196 + jitter), clamp255(78 + jitter), 255];
  }
  // 四散的几点火星
  const spark = (x === 2 && y === 3) || (x === 12 && y === 4) || (x === 4 && y === 12) || (x === 11 && y === 11);
  if (spark) return [clamp255(226 + jitter), clamp255(176 + jitter), clamp255(60 + jitter), 255];
  return [0, 0, 0, 0];
};

/**
 * 烟花火箭（批次 192）：**竖着的一枚**——白纸筒 + 红火箭头 + 下方一根木棍。
 *
 * 与"成书"那类图标同一个要求：远远看一眼就知道是哪一类东西。
 */
PAINTERS.item_firework_rocket = (x, y, rng) => {
  const jitter = rng() * 6 - 3;
  // 尾部木棍（下三分之一，两格宽）
  if (y >= 11 && y <= 14 && (x === 7 || x === 8)) return [clamp255(128 + jitter), clamp255(96 + jitter), clamp255(58 + jitter), 255];
  // 纸筒：中间那一段，两侧深一档做圆筒感
  if (x >= 5 && x <= 10 && y >= 4 && y <= 10) {
    if (x === 5 || x === 10) return [clamp255(178 + jitter), clamp255(176 + jitter), clamp255(168 + jitter), 255];
    if (y === 7 || y === 9) return [clamp255(206 + jitter), clamp255(120 + jitter), clamp255(104 + jitter), 255];
    return [clamp255(236 + jitter), clamp255(234 + jitter), clamp255(226 + jitter), 255];
  }
  // 火箭头（尖顶）
  if (y === 1 && (x === 7 || x === 8)) return [clamp255(212 + jitter), clamp255(62 + jitter), clamp255(52 + jitter), 255];
  if (y === 2 && x >= 6 && x <= 9) return [clamp255(212 + jitter), clamp255(62 + jitter), clamp255(52 + jitter), 255];
  if (y === 3 && x >= 5 && x <= 10) return [clamp255(186 + jitter), clamp255(48 + jitter), clamp255(42 + jitter), 255];
  return [0, 0, 0, 0];
};

/**
 * 书与笔（批次 190）：一本**摊开的小棕书** + 右上角一支白羽毛。
 *
 * 画法与告示牌图标同一路数——"看出这是什么"优先，不追原版的像素：
 * 棕色封皮 + 右侧白色书页边 + 几道横线（字），羽毛只用三格白。
 */
PAINTERS.item_book_and_quill = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  const left = 2;
  const right = 13;
  const top = 6;
  const bottom = 14;
  // 羽毛：右上角一支斜着的白色羽（笔杆 + 两侧羽片）
  const feather = Math.abs(y - (2 + (13 - x) * 0.5)) < 1;
  if (x >= 9 && x <= 13 && feather) return [clamp255(244 + jitter), clamp255(246 + jitter), clamp255(240 + jitter), 255];
  if (x >= 11 && x <= 13 && y >= 1 && y <= 4) return [clamp255(226 + jitter), clamp255(228 + jitter), clamp255(220 + jitter), 255];
  if (x < left || x > right || y < top || y > bottom) return [0, 0, 0, 0];
  // 右侧那条是书页（白），其余是封皮（棕）
  if (x >= right - 1) return [clamp255(238 + jitter), clamp255(232 + jitter), clamp255(210 + jitter), 255];
  if (x === left || y === top || y === bottom) return [clamp255(92 + jitter), clamp255(62 + jitter), clamp255(38 + jitter), 255];
  // 三道"字"：比封皮浅一档的横线
  if ((y - top) % 3 === 0) return [clamp255(130 + jitter), clamp255(96 + jitter), clamp255(62 + jitter), 255];
  return [clamp255(166 + jitter), clamp255(122 + jitter), clamp255(74 + jitter), 255];
};

/**
 * 成书（批次 190）：**合上的一本书**——深红封皮 + 白色书口 + 一条金色书脊带。
 *
 * 与书与笔的区别要一眼看出：那本是"摊开的 + 有笔"，这本是"合上的、有书名带"。
 */
PAINTERS.item_written_book = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  const left = 3;
  const right = 12;
  const top = 3;
  const bottom = 13;
  if (x < left || x > right || y < top || y > bottom) return [0, 0, 0, 0];
  // 书口（右侧一列白页）
  if (x === right) return [clamp255(236 + jitter), clamp255(232 + jitter), clamp255(214 + jitter), 255];
  // 封皮边框
  if (x === left || y === top || y === bottom) return [clamp255(84 + jitter), clamp255(30 + jitter), clamp255(30 + jitter), 255];
  // 金色的书名带：靠近书脊的两格
  if (x === left + 2 || x === left + 3) return [clamp255(206 + jitter), clamp255(170 + jitter), clamp255(68 + jitter), 255];
  return [clamp255(140 + jitter), clamp255(44 + jitter), clamp255(44 + jitter), 255];
};

/** 凋灵骷髅头的顶面（批次 115）：几道更深的骨缝，说明"这是个头"而不是一块石头 */
PAINTERS.wither_skull_top = (x, y, rng) => {
  const jitter = rng() * 14 - 7;
  const seam = x === 7 || x === 8 || y === 7 || y === 8;
  const base = (seam ? 46 : 78) + jitter;
  return [clamp255(base), clamp255(base), clamp255(base + 6), 255];
};

/** 烈焰人的小火球（批次 92）：一团中心亮黄、边缘橙红的火（billboard 用） */
PAINTERS.small_fireball = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  const dx = x - 7.5;
  const dy = y - 7.5;
  const d = Math.hypot(dx, dy);
  if (d > 6.5) return [0, 0, 0, 0];
  if (d < 2.2) return [clamp255(254 + jitter), clamp255(238 + jitter), clamp255(150 + jitter), 255];
  if (d < 4.2) return [clamp255(248 + jitter), clamp255(176 + jitter), clamp255(52 + jitter), 255];
  // 外圈：暗一点的橙红，边缘再软一点（半透明收边，飞起来不像一个硬方块）
  const alpha = d > 5.8 ? 140 : 235;
  return [clamp255(206 + jitter), clamp255(82 + jitter), clamp255(28 + jitter), alpha];
};

/**
 * 恶魂的大火球（批次 94）：比小火球**更大更白**（原版那颗是"火球"，
 * 尺寸与亮度都压过烈焰人那颗），所以单独一张贴图而不是把小火球放大——
 * 放大只会让像素变糊，看不出"这是另一种东西"。
 */
PAINTERS.large_fireball = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const dx = x - 7.5;
  const dy = y - 7.5;
  const d = Math.hypot(dx, dy);
  if (d > 7.4) return [0, 0, 0, 0];
  if (d < 3.4) return [clamp255(255), clamp255(246 + jitter), clamp255(206 + jitter), 255];
  if (d < 5.6) return [clamp255(252 + jitter), clamp255(190 + jitter), clamp255(72 + jitter), 255];
  const alpha = d > 6.8 ? 150 : 240;
  return [clamp255(212 + jitter), clamp255(96 + jitter), clamp255(30 + jitter), alpha];
};

PAINTERS.crimson_nylium = nyliumPainter([132, 40, 44], 'crim');
PAINTERS.crimson_nylium_side = nyliumSidePainter([132, 40, 44], 'crims');
PAINTERS.warped_nylium = nyliumPainter([44, 132, 124], 'warp');
PAINTERS.warped_nylium_side = nyliumSidePainter([44, 132, 124], 'warps');
PAINTERS.crimson_stem_side = stemSidePainter([108, 48, 60]);
PAINTERS.crimson_stem_top = logTopPainter([124, 62, 72]);
PAINTERS.warped_stem_side = stemSidePainter([54, 104, 100]);
PAINTERS.warped_stem_top = logTopPainter([68, 126, 120]);
PAINTERS.crimson_planks = planksPainter([112, 54, 66]);
PAINTERS.warped_planks = planksPainter([60, 112, 108]);
PAINTERS.crimson_fungus = fungusPainter([196, 62, 62], [226, 196, 186], 'cf');
PAINTERS.warped_fungus = fungusPainter([62, 152, 156], [206, 214, 196], 'wf');
PAINTERS.nether_wart_block = wartBlockPainter([148, 30, 42], 'nw');
PAINTERS.warped_wart_block = wartBlockPainter([40, 122, 116], 'ww');
PAINTERS.shroomlight = SHROOMLIGHT_PAINTER;
PAINTERS.nether_bricks = brickPainter([52, 26, 32]);
PAINTERS.nether_quartz_ore = oreTexture(NETHERRACK_PAINTER, [
  [236, 232, 226],
  [206, 200, 194],
], 0.28, 'quartz');
PAINTERS.ancient_debris = ANCIENT_DEBRIS_PAINTER;
PAINTERS.crimson_roots = rootsPainter([178, 48, 58], 'cr');
PAINTERS.warped_roots = rootsPainter([54, 168, 160], 'wr');
PAINTERS.nether_sprouts = rootsPainter([78, 156, 132], 'ns');

// ---- 末地方块
/** 末地石：淡黄绿底 + 细密的暗色孔洞（原版是"泛黄的浮石"质感） */
const END_STONE_PAINTER: Painter = (x, y, rng) => {
  const key = (y >> 1) * 8 + (x >> 1);
  const pit = (hashString(`es${key}`) % 100) / 100;
  const v = 0.9 + pit * 0.22 + (rng() * 0.1 - 0.05);
  return [clamp255(222 * v), clamp255(226 * v), clamp255(160 * v), 255];
};
/** 末地石砖：末地石底色上的砖缝 */
const END_STONE_BRICKS_PAINTER = brickPainter([214, 218, 154]);
/** 紫珀块：带紫色星点的暗紫红 */
const PURPUR_PAINTER: Painter = (x, y, rng) => {
  const speck = hashString(`pp${x},${y}`) % 23 === 0;
  const v = 1 + (rng() * 0.12 - 0.06) + (speck ? 0.24 : 0);
  return [clamp255(172 * v), clamp255(122 * v), clamp255(172 * v), 255];
};
/** 紫珀柱侧面：竖向柱纹 */
const PURPUR_PILLAR_SIDE_PAINTER: Painter = (x, _y, rng) => {
  const band = x % 5 === 0 ? -0.16 : x % 5 === 2 ? 0.08 : 0;
  const v = 1 + band + (rng() * 0.1 - 0.05);
  return [clamp255(178 * v), clamp255(126 * v), clamp255(178 * v), 255];
};
/** 紫珀柱顶面：方形截面纹（同心方框） */
const PURPUR_PILLAR_TOP_PAINTER: Painter = (x, y, rng) => {
  const edge = Math.min(x, y, TILE_SIZE - 1 - x, TILE_SIZE - 1 - y);
  const v = 1 + (edge <= 1 ? -0.2 : edge <= 3 ? 0.1 : 0) + (rng() * 0.1 - 0.05);
  return [clamp255(184 * v), clamp255(132 * v), clamp255(184 * v), 255];
};
/** 紫颂植株：一根紫红色肉质细杆，带浅色节点 */
const CHORUS_PLANT_PAINTER: Painter = (x, y, rng) => {
  const dx = Math.abs(x - 7.5);
  if (dx > 2.6) return EMPTY;
  const node = y % 6 < 2;
  const v = (node ? 1.16 : 1) + (rng() * 0.12 - 0.06);
  return [clamp255(146 * v), clamp255(112 * v), clamp255(160 * v), 255];
};
/** 紫颂花：顶部的紫色花簇（花瓣向外翻） */
const CHORUS_FLOWER_PAINTER: Painter = (x, y, rng) => {
  const dx = (x - 7.5) / 7.4;
  const dy = (y - 7.5) / 7.4;
  const r = Math.hypot(dx, dy);
  if (r > 1) return EMPTY;
  const petal = hashString(`cf${x >> 1},${y >> 1}`) % 100 < 58;
  if (!petal && r > 0.55) return EMPTY;
  const v = (r > 0.7 ? 0.86 : 1.1) + (rng() * 0.12 - 0.06);
  return [clamp255(206 * v), clamp255(150 * v), clamp255(212 * v), 255];
};
/** 末地烛：白色细杆 + 顶端的荧光球 */
const END_ROD_PAINTER: Painter = (x, y, rng) => {
  const dx = Math.abs(x - 7.5);
  if (dx > 1.6) return EMPTY;
  if (y < 4) {
    const v = 1 + (rng() * 0.08 - 0.04);
    return [clamp255(246 * v), clamp255(244 * v), clamp255(226 * v), 255];
  }
  const v = 1 + (rng() * 0.08 - 0.04);
  return [clamp255(214 * v), clamp255(204 * v), clamp255(186 * v), 255];
};
/** 龙蛋：黑底 + 紫色斑点与裂纹 */
const DRAGON_EGG_PAINTER: Painter = (x, y, rng) => {
  const blotch = hashString(`de${x >> 1},${y >> 1}`) % 100 < 26;
  const v = 1 + (rng() * 0.14 - 0.07);
  if (blotch) return [clamp255(96 * v), clamp255(42 * v), clamp255(96 * v), 255];
  return [clamp255(24 * v), clamp255(16 * v), clamp255(28 * v), 255];
};
/**
 * 末地传送门框架（**空格子**）：淡绿石框 + 中央那个方形**凹槽**。
 *
 * ⚠️ 批次 111 之前这里画的是一颗**黄眼睛**——于是"什么眼睛都没插"的框架
 * 看起来也像已经插满了（12 格长得一模一样，"还差几只"这件事在画面上读不出来）。
 * 现在按原版拆成两张贴图：空槽（这一张）与插了眼（`end_portal_frame_eye`），
 * 由**方块状态**选，见 `blocks.ts` 的 `stateTiles`。
 */
const END_PORTAL_FRAME_PAINTER: Painter = (x, y, rng) => {
  const inSocket = x >= 4 && x <= 11 && y >= 4 && y <= 11;
  if (inSocket) {
    const rim = x === 4 || x === 11 || y === 4 || y === 11;
    const v = 0.86 + (rng() * 0.1 - 0.05);
    // 凹槽：外圈是阴影边，里面是更暗的空底
    return rim
      ? [clamp255(96 * v), clamp255(106 * v), clamp255(84 * v), 255]
      : [clamp255(124 * v), clamp255(134 * v), clamp255(108 * v), 255];
  }
  const v = 0.94 + (rng() * 0.12 - 0.06);
  return [clamp255(158 * v), clamp255(174 * v), clamp255(132 * v), 255];
};

/** 末地传送门框架（**插了眼**）：同一个凹槽里亮着一颗绿黄色的眼睛（中间是深色瞳孔） */
const END_PORTAL_FRAME_EYE_PAINTER: Painter = (x, y, rng) => {
  if (x >= 5 && x <= 10 && y >= 5 && y <= 10) {
    const pupil = x >= 7 && x <= 8 && y >= 7 && y <= 8;
    const v = 1 + (rng() * 0.1 - 0.05);
    return pupil
      ? [clamp255(64 * v), clamp255(92 * v), clamp255(58 * v), 255]
      : [clamp255(198 * v), clamp255(232 * v), clamp255(122 * v), 255];
  }
  if (x >= 4 && x <= 11 && y >= 4 && y <= 11) {
    const v = 0.88 + (rng() * 0.1 - 0.05);
    return [clamp255(108 * v), clamp255(118 * v), clamp255(94 * v), 255];
  }
  const v = 0.94 + (rng() * 0.12 - 0.06);
  return [clamp255(158 * v), clamp255(174 * v), clamp255(132 * v), 255];
};

/** 末影珍珠（批次 111）：青绿色的球 + 左上角一片高光 */
PAINTERS.item_ender_pearl = (x, y, rng) => {
  const dx = (x - 7.5) / 5.2;
  const dy = (y - 7.8) / 5.2;
  const d = dx * dx + dy * dy;
  if (d > 1) return [0, 0, 0, 0];
  const jitter = rng() * 16 - 8;
  if (x + y < 9) return [clamp255(188 + jitter), clamp255(244 + jitter), clamp255(218 + jitter), 255];
  return d > 0.72
    ? [clamp255(26 + jitter), clamp255(108 + jitter), clamp255(96 + jitter), 255]
    : [clamp255(58 + jitter), clamp255(190 + jitter), clamp255(166 + jitter), 255];
};

/** 末影之眼（批次 111）：珍珠底 + 中间一道竖直的深色瞳孔（原版那颗眼睛的样子） */
PAINTERS.item_ender_eye = (x, y, rng) => {
  const dx = (x - 7.5) / 5.4;
  const dy = (y - 7.8) / 5.4;
  if (dx * dx + dy * dy > 1) return [0, 0, 0, 0];
  const jitter = rng() * 16 - 8;
  if (Math.abs(x - 7.5) < 1.4 && y >= 5 && y <= 11) {
    return [clamp255(28 + jitter), clamp255(76 + jitter), clamp255(70 + jitter), 255];
  }
  if (x + y < 10) return [clamp255(184 + jitter), clamp255(242 + jitter), clamp255(214 + jitter), 255];
  return [clamp255(52 + jitter), clamp255(176 + jitter), clamp255(150 + jitter), 255];
};
/** 末地传送门：深紫黑底 + 星点（自发光 15） */
const END_PORTAL_PAINTER: Painter = (x, y, rng) => {
  const star = hashString(`ep${x},${y}`) % 17 === 0;
  if (star) return [clamp255(226), clamp255(206), clamp255(255), 255];
  const v = 0.9 + (rng() * 0.16 - 0.08);
  return [clamp255(22 * v), clamp255(8 * v), clamp255(38 * v), 255];
};

/**
 * 下界传送门（K8）：深紫底 + 两条反向旋转的螺旋带（"漩涡"是它最标志性的观感）。
 *
 * 贴图本身是静态的，滚动靠材质（`VoxelMaterial` 的 `uPortalTile`）——
 * 与水面动画同一套做法：不逐顶点加属性，也就不必动网格化与 Worker。
 * 半透明（alpha 234）是为了让门后面的东西隐约透出来（原版门面也是半透明的）。
 */
const NETHER_PORTAL_PAINTER: Painter = (x, y, rng) => {
  const dx = x - 7.5;
  const dy = y - 7.5;
  const angle = Math.atan2(dy, dx);
  const radius = Math.hypot(dx, dy);
  // 两条频率与旋向都不同的螺旋叠加：单条会看起来像"放射状条纹"
  const swirl = Math.sin(angle * 3 + radius * 1.5) * 0.5 + Math.sin(radius * 2.7 - angle * 2) * 0.5;
  const t = (swirl + 1) / 2; // 0~1
  const jitter = rng() * 14 - 7;
  return [
    clamp255(66 + t * 112 + jitter),
    clamp255(18 + t * 44 + jitter),
    clamp255(122 + t * 124 + jitter),
    234,
  ];
};

PAINTERS.nether_portal = NETHER_PORTAL_PAINTER;

PAINTERS.end_stone = END_STONE_PAINTER;
PAINTERS.end_stone_bricks = END_STONE_BRICKS_PAINTER;
PAINTERS.purpur_block = PURPUR_PAINTER;
PAINTERS.purpur_pillar_side = PURPUR_PILLAR_SIDE_PAINTER;
PAINTERS.purpur_pillar_top = PURPUR_PILLAR_TOP_PAINTER;
PAINTERS.chorus_plant = CHORUS_PLANT_PAINTER;
PAINTERS.chorus_flower = CHORUS_FLOWER_PAINTER;
PAINTERS.end_rod = END_ROD_PAINTER;
PAINTERS.dragon_egg = DRAGON_EGG_PAINTER;
PAINTERS.end_portal_frame = END_PORTAL_FRAME_PAINTER;
PAINTERS.end_portal_frame_eye = END_PORTAL_FRAME_EYE_PAINTER;
PAINTERS.end_portal = END_PORTAL_PAINTER;

// ---- 红石元件
/** 红石粉：暗红底上一条更亮的"粉末线" */
const REDSTONE_WIRE_PAINTER: Painter = (x, y, rng) => {
  const line = Math.abs(x - 7.5) < 3 || Math.abs(y - 7.5) < 3;
  const v = 1 + (rng() * 0.2 - 0.1);
  if (line) return [clamp255(196 * v), clamp255(36 * v), clamp255(28 * v), 255];
  const dark = 0.72 + (rng() * 0.16 - 0.08);
  return [clamp255(126 * dark), clamp255(24 * dark), clamp255(20 * dark), 255];
};
/** 红石火把：木棍 + 顶端红光 */
const REDSTONE_TORCH_PAINTER: Painter = (x, y, rng) => {
  if (y < 8) return EMPTY;
  const dx = Math.abs(x - 7.5);
  if (dx > 2.2) return EMPTY;
  const core = dx < 1.1 && y >= 11;
  const v = 1 + (rng() * 0.12 - 0.06);
  if (core) return [clamp255(248 * v), clamp255(96 * v), clamp255(72 * v), 255];
  return [clamp255(140 * v), clamp255(66 * v), clamp255(58 * v), 255];
};
/** 红石块：通体暗红 + 细密颗粒 */
const REDSTONE_BLOCK_PAINTER: Painter = (x, y, rng) => {
  const key = (y >> 1) * 8 + (x >> 1);
  const grain = (hashString(`rsb${key}`) % 100) / 100;
  const v = 0.86 + grain * 0.3 + (rng() * 0.1 - 0.05);
  return [clamp255(168 * v), clamp255(32 * v), clamp255(26 * v), 255];
};
/** 拉杆：中间一根木杆 + 底部石座 */
const LEVER_PAINTER: Painter = (x, y, rng) => {
  const dx = Math.abs(x - 7.5);
  if (y < 6) return EMPTY;
  const v = 1 + (rng() * 0.1 - 0.05);
  if (dx < 1.4) return [clamp255(150 * v), clamp255(118 * v), clamp255(78 * v), 255];
  if (dx < 3.4 && y > 12) return [clamp255(122 * v), clamp255(122 * v), clamp255(122 * v), 255];
  return EMPTY;
};
/** 按钮：中央一个小方块 */
function buttonPainter(rgb: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    if (x < 4 || x > 11 || y < 4 || y > 11) return [clamp255(rgb[0] * 0.7), clamp255(rgb[1] * 0.7), clamp255(rgb[2] * 0.7), 255];
    const v = 1 + (rng() * 0.14 - 0.07);
    return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
  };
}
/** 压力板：整片薄板的俯视图 */
function platePainter(rgb: readonly [number, number, number]): Painter {
  return (x, y, rng) => {
    const edge = x < 1 || y < 1 || x > 14 || y > 14;
    const v = (edge ? 0.82 : 1) + (rng() * 0.1 - 0.05);
    return [clamp255(rgb[0] * v), clamp255(rgb[1] * v), clamp255(rgb[2] * v), 255];
  };
}
/** 中继器：石底 + 一条红石线 + 前后两个火把点 */
const REPEATER_PAINTER: Painter = (x, y, rng) => {
  const body = 1 + (rng() * 0.1 - 0.05);
  if (y >= 5 && y <= 10 && Math.abs(x - 7.5) < 2.6) return [clamp255(186 * body), clamp255(40 * body), clamp255(30 * body), 255];
  if ((y <= 3 || y >= 12) && Math.abs(x - 7.5) < 2.2) return [clamp255(214 * body), clamp255(72 * body), clamp255(52 * body), 255];
  return [clamp255(150 * body), clamp255(150 * body), clamp255(150 * body), 255];
};
/** 比较器：与中继器同底，后端三点、前端单点 */
const COMPARATOR_PAINTER: Painter = (x, y, rng) => {
  const body = 1 + (rng() * 0.1 - 0.05);
  if (y >= 5 && y <= 10 && Math.abs(x - 7.5) < 2.6) return [clamp255(178 * body), clamp255(36 * body), clamp255(28 * body), 255];
  if (y <= 3 && (Math.abs(x - 4) < 1.6 || Math.abs(x - 7.5) < 1.6 || Math.abs(x - 11) < 1.6)) {
    return [clamp255(210 * body), clamp255(70 * body), clamp255(50 * body), 255];
  }
  if (y >= 12 && Math.abs(x - 7.5) < 2.2) return [clamp255(210 * body), clamp255(70 * body), clamp255(50 * body), 255];
  return [clamp255(146 * body), clamp255(146 * body), clamp255(146 * body), 255];
};
/** 红石灯（灭 / 亮两套） */
function lampPainter(lit: boolean): Painter {
  return (x, y, rng) => {
    const key = (y >> 2) * 4 + (x >> 2);
    const cell = hashString(`lamp${key}`) % 100;
    const v = 1 + (rng() * 0.12 - 0.06);
    if (lit) {
      const glow = cell < 35 ? 1.35 : 1.05;
      return [clamp255(250 * v * glow * 0.72), clamp255(214 * v * glow * 0.62), clamp255(120 * v * glow * 0.42), 255];
    }
    if (cell < 25) return [clamp255(122 * v), clamp255(66 * v), clamp255(48 * v), 255];
    return [clamp255(96 * v), clamp255(72 * v), clamp255(44 * v), 255];
  };
}
/** 活塞面：木质圆盘 + 金属环 */
const PISTON_TOP_PAINTER: Painter = (x, y, rng) => {
  const r = Math.hypot(x - 7.5, y - 7.5);
  const v = 1 + (rng() * 0.12 - 0.06);
  if (r < 2.4) return [clamp255(206 * v), clamp255(180 * v), clamp255(140 * v), 255];
  if (r < 6.2) return [clamp255(150 * v), clamp255(126 * v), clamp255(96 * v), 255];
  return [clamp255(120 * v), clamp255(98 * v), clamp255(74 * v), 255];
};
/** 活塞侧面：木板 + 上下两条金属箍 */
const PISTON_SIDE_PAINTER: Painter = (_x, y, rng) => {
  const v = 1 + (rng() * 0.12 - 0.06);
  if (y < 3 || y > 12) return [clamp255(138 * v), clamp255(116 * v), clamp255(90 * v), 255];
  return [clamp255(178 * v), clamp255(150 * v), clamp255(116 * v), 255];
};
/** 粘性活塞面：活塞面 + 中央黏液绿 */
const STICKY_PISTON_TOP_PAINTER: Painter = (x, y, rng) => {
  const r = Math.hypot(x - 7.5, y - 7.5);
  const v = 1 + (rng() * 0.12 - 0.06);
  if (r < 4.2) return [clamp255(120 * v), clamp255(178 * v), clamp255(92 * v), 255];
  if (r < 6.2) return [clamp255(150 * v), clamp255(126 * v), clamp255(96 * v), 255];
  return [clamp255(120 * v), clamp255(98 * v), clamp255(74 * v), 255];
};
/** 活塞头面部：金属板 + 四角铆钉 */
const PISTON_HEAD_PAINTER: Painter = (x, y, rng) => {
  const v = 1 + (rng() * 0.12 - 0.06);
  const rivet = (x < 3 || x > 12) && (y < 3 || y > 12);
  if (rivet) return [clamp255(206 * v), clamp255(184 * v), clamp255(148 * v), 255];
  return [clamp255(146 * v), clamp255(124 * v), clamp255(98 * v), 255];
};
/** 侦测器顶面：中间一只"眼" */
const OBSERVER_TOP_PAINTER: Painter = (x, y, rng) => {
  const v = 1 + (rng() * 0.1 - 0.05);
  const r = Math.hypot(x - 7.5, y - 7.5);
  if (r < 3) return [clamp255(206 * v), clamp255(206 * v), clamp255(206 * v), 255];
  if (r < 5) return [clamp255(96 * v), clamp255(96 * v), clamp255(104 * v), 255];
  return [clamp255(126 * v), clamp255(126 * v), clamp255(134 * v), 255];
};
/** 侦测器侧面：深灰石壳 + 一道红石纹 */
const OBSERVER_SIDE_PAINTER: Painter = (x, _y, rng) => {
  const v = 1 + (rng() * 0.1 - 0.05);
  if (Math.abs(x - 7.5) < 2) return [clamp255(178 * v), clamp255(52 * v), clamp255(40 * v), 255];
  return [clamp255(104 * v), clamp255(104 * v), clamp255(112 * v), 255];
};

PAINTERS.redstone_wire = REDSTONE_WIRE_PAINTER;
PAINTERS.redstone_torch = REDSTONE_TORCH_PAINTER;
PAINTERS.redstone_block = REDSTONE_BLOCK_PAINTER;
PAINTERS.lever = LEVER_PAINTER;
PAINTERS.stone_button = buttonPainter([140, 140, 140]);
PAINTERS.oak_button = buttonPainter([168, 132, 84]);
PAINTERS.stone_pressure_plate = platePainter([140, 140, 140]);
PAINTERS.oak_pressure_plate = platePainter([168, 132, 84]);
PAINTERS.repeater = REPEATER_PAINTER;
PAINTERS.comparator = COMPARATOR_PAINTER;
PAINTERS.redstone_lamp = lampPainter(false);
PAINTERS.redstone_lamp_on = lampPainter(true);
PAINTERS.piston_top = PISTON_TOP_PAINTER;
PAINTERS.piston_side = PISTON_SIDE_PAINTER;
PAINTERS.sticky_piston_top = STICKY_PISTON_TOP_PAINTER;
PAINTERS.piston_head = PISTON_HEAD_PAINTER;
/**
 * 侦测器背面（批次 65）：石壳 + 一颗**红点**——那是它的输出面
 * （引擎里 `componentOutput` 给的就是"看的对面"）。
 */
PAINTERS.observer_back = (x, y, rng) => {
  const v = 1 + (rng() * 0.1 - 0.05);
  const r = Math.hypot(x - 7.5, y - 7.5);
  if (r < 2.6) return [clamp255(178 * v), clamp255(52 * v), clamp255(40 * v), 255];
  if (r < 3.6) return [clamp255(120 * v), clamp255(40 * v), clamp255(32 * v), 255];
  return [clamp255(104 * v), clamp255(104 * v), clamp255(112 * v), 255];
};

PAINTERS.observer_top = OBSERVER_TOP_PAINTER;
PAINTERS.observer_side = OBSERVER_SIDE_PAINTER;

// ---------------------------------------------------------------- 工具与武器图标

/**
 * 工具图标的像素模板。用字符画而不是几何公式，是因为 16×16 下手写形状最可控，
 * 一眼也能看出画的是什么：
 *   '.' 透明 · 'M' 金属头 · 'D' 金属头暗部 · 'H' 木柄 · 'h' 木柄暗部
 * 5 种形状 × 5 种材质只需要 5 份模板，材质只影响配色。
 */
const TOOL_TEMPLATES: Record<string, readonly string[]> = {
  pickaxe: [
    '................',
    '.........MMMM...',
    '........MMMMMM..',
    '.......MMM...MM.',
    '......MM......M.',
    '.....MM.........',
    '....HH..........',
    '...HH...........',
    '..HH............',
    '.HH.............',
    'HH..............',
    'H...............',
    '................',
    '................',
    '................',
    '................',
  ],
  axe: [
    '................',
    '.........MMMM...',
    '........MMMMMM..',
    '........MMMMMM..',
    '.......MMMMMM...',
    '.......MMMM.....',
    '....HHH.........',
    '...HH...........',
    '..HH............',
    '.HH.............',
    'HH..............',
    'H...............',
    '................',
    '................',
    '................',
    '................',
  ],
  shovel: [
    '................',
    '.........MMMM...',
    '........MMMMMM..',
    '........MMMMMM..',
    '........MMMMMM..',
    '.........MMMM...',
    '..........HH....',
    '.........HH.....',
    '........HH......',
    '.......HH.......',
    '......HH........',
    '.....HH.........',
    '....HH..........',
    '...HH...........',
    '..HH............',
    '................',
  ],
  hoe: [
    '................',
    '................',
    '.........MMMMM..',
    '.........MMMMMM.',
    '.........MM.....',
    '.........M......',
    '........HH......',
    '.......HH.......',
    '......HH........',
    '.....HH.........',
    '....HH..........',
    '...HH...........',
    '..HH............',
    '.HH.............',
    '................',
    '................',
  ],
  sword: [
    '................',
    '.............MM.',
    '............MMM.',
    '...........MMM..',
    '..........MMM...',
    '.........MMM....',
    '........MMM.....',
    '.......MMM......',
    '......MMM.......',
    '.....MMM........',
    '..DDMMM.........',
    '.DDDDD..........',
    '..HH............',
    '.HH.............',
    '................',
    '................',
  ],
};

/** 工具头的材质配色（贴近原版） */
const TOOL_MATERIAL_RGB: Record<string, readonly [number, number, number]> = {
  wooden: [150, 110, 62],
  stone: [130, 130, 128],
  iron: [205, 205, 212],
  golden: [248, 210, 74],
  diamond: [96, 228, 224],
  // 下界合金：深紫灰（比铁暗、比石头偏紫），在深色槽位上仍然分得出来
  netherite: [118, 100, 110],
};

const TOOL_HANDLE_RGB: readonly [number, number, number] = [150, 108, 58];

/** 按模板取像素：材质只决定头部颜色，木柄所有工具共用 */
function toolPainter(kind: string, material: string): Painter {
  const template = TOOL_TEMPLATES[kind]!;
  const head = TOOL_MATERIAL_RGB[material] ?? [180, 180, 180];
  return (x, y, rng) => {
    const pixel = template[y]?.[x] ?? '.';
    if (pixel === '.') return [0, 0, 0, 0];
    const jitter = rng() * 14 - 7;
    if (pixel === 'H' || pixel === 'h') {
      const shade = pixel === 'h' ? 0.7 : 1;
      return [
        clamp255(TOOL_HANDLE_RGB[0] * shade + jitter),
        clamp255(TOOL_HANDLE_RGB[1] * shade + jitter),
        clamp255(TOOL_HANDLE_RGB[2] * shade + jitter),
        255,
      ];
    }
    const shade = pixel === 'D' ? 0.68 : 1;
    return [clamp255(head[0] * shade + jitter), clamp255(head[1] * shade + jitter), clamp255(head[2] * shade + jitter), 255];
  };
}

// 材质表直接取自注册表：以后加一种材质（比如以后再补"铜工具"）这里自动跟上，
// 不用改渲染层——这一条是上一批"批量生成的地方要问一句有没有例外"的教训
for (const material of ALL_TOOL_MATERIALS) {
  for (const kind of TOOL_KINDS) {
    PAINTERS[`item_${material}_${kind}`] = toolPainter(kind, material);
  }
}

// ---------------------------------------------------------------- 盔甲图标

/** 盔甲图标的像素模板：'M' 是甲片，'.' 透明（四件共用一套配色，形状区分部位） */
const ARMOR_TEMPLATES: Record<string, readonly string[]> = {
  helmet: [
    '................',
    '................',
    '....MMMMMMMM....',
    '...MMMMMMMMMM...',
    '..MMMMMMMMMMMM..',
    '..MMMMMMMMMMMM..',
    '..MM........MM..',
    '..MM........MM..',
    '..MM........MM..',
    '..MM........MM..',
    '..MM........MM..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  chestplate: [
    '................',
    '................',
    '..MMMM....MMMM..',
    '.MMMMMM..MMMMMM.',
    '.MMMMMMMMMMMMMM.',
    '..MMMMMMMMMMMM..',
    '..MMMMMMMMMMMM..',
    '..MMMMMMMMMMMM..',
    '..MMMMMMMMMMMM..',
    '..MMMMMMMMMMMM..',
    '..MMMMMMMMMMMM..',
    '..MMMM....MMMM..',
    '................',
    '................',
    '................',
    '................',
  ],
  leggings: [
    '................',
    '................',
    '..MMMMMMMMMMMM..',
    '..MMMMMMMMMMMM..',
    '..MMMMMMMMMMMM..',
    '..MMMMM..MMMMM..',
    '..MMMM....MMMM..',
    '..MMMM....MMMM..',
    '..MMMM....MMMM..',
    '..MMMM....MMMM..',
    '..MMMM....MMMM..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  boots: [
    '................',
    '................',
    '................',
    '..MMMM....MMMM..',
    '..MMMM....MMMM..',
    '..MMMM....MMMM..',
    '..MMMM....MMMM..',
    '..MMMMM..MMMMM..',
    '..MMMMM..MMMMM..',
    '.MMMMMM..MMMMMM.',
    '.MMMMMMMMMMMMMM.',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};

/** 盔甲材质配色（皮革是棕色、锁链是铁灰，工具那边没有这两种） */
const ARMOR_MATERIAL_RGB: Record<string, readonly [number, number, number]> = {
  leather: [136, 86, 52],
  chainmail: [152, 152, 160],
  iron: [205, 205, 212],
  golden: [248, 210, 74],
  diamond: [96, 228, 224],
  // 与工具头同一个色系（下界合金盔甲与工具是一套东西）
  netherite: [118, 100, 110],
};

function armorPainter(type: string, material: string): Painter {
  const template = ARMOR_TEMPLATES[type]!;
  const base = ARMOR_MATERIAL_RGB[material] ?? [180, 180, 180];
  return (x, y, rng) => {
    if ((template[y]?.[x] ?? '.') !== 'M') return [0, 0, 0, 0];
    // 竖直渐变：上亮下暗，一排甲片才有"厚度"而不像一块色板
    const shade = 1.08 - (y / 15) * 0.26;
    const jitter = rng() * 12 - 6;
    return [
      clamp255(base[0] * shade + jitter),
      clamp255(base[1] * shade + jitter),
      clamp255(base[2] * shade + jitter),
      255,
    ];
  };
}

for (const material of ALL_ARMOR_MATERIALS) {
  for (const type of ARMOR_TYPES) {
    PAINTERS[`item_${material}_${type}`] = armorPainter(type, material);
  }
}

// ================================================================ 石英与更多石材（批次 42）
//
// 石英是"奶白偏暖"的矿物：底色比石砖亮得多、几乎无纹理，只在侧面有一点点竖直的晶纹。
// 这一批的 6 个母方块里有 4 个属于石英家族，它们共用同一套底色与晶纹参数。

/** 石英底色（原版是偏暖的奶白，比白云石/方解石更"暖"一点） */
const QUARTZ_BASE: readonly [number, number, number] = [236, 230, 222];

/** 石英块的顶面：近乎无纹理的奶白，只有极细的颗粒 */
const QUARTZ_TOP_PAINTER: Painter = (_x, _y, rng) => {
  const v = 1 + (rng() * 0.05 - 0.025);
  return [clamp255(QUARTZ_BASE[0] * v), clamp255(QUARTZ_BASE[1] * v), clamp255(QUARTZ_BASE[2] * v), 255];
};

/** 石英块的侧面：顶面底色 + 竖直晶纹（每 5 像素一道浅痕） */
const QUARTZ_SIDE_PAINTER: Painter = (x, _y, rng) => {
  const vein = x % 5 === 0 ? -0.05 : x % 5 === 3 ? 0.04 : 0;
  const v = 1 + vein + (rng() * 0.05 - 0.025);
  return [clamp255(QUARTZ_BASE[0] * v), clamp255(QUARTZ_BASE[1] * v), clamp255(QUARTZ_BASE[2] * v), 255];
};

/** 石英柱侧面：更深更规整的竖槽（"一根柱子"的观感） */
const QUARTZ_PILLAR_SIDE_PAINTER: Painter = (x, _y, rng) => {
  const groove = x % 8 === 0 ? -0.16 : x % 8 === 4 ? 0.08 : 0;
  const v = 1 + groove + (rng() * 0.05 - 0.025);
  return [clamp255(QUARTZ_BASE[0] * v), clamp255(QUARTZ_BASE[1] * v), clamp255(QUARTZ_BASE[2] * v), 255];
};

/** 石英柱顶面：同心方框（原版柱类方块的通用做法） */
const QUARTZ_PILLAR_TOP_PAINTER: Painter = (x, y, rng) => {
  const edge = Math.min(x, y, TILE_SIZE - 1 - x, TILE_SIZE - 1 - y);
  const v = 1 + (edge <= 1 ? -0.14 : edge <= 3 ? 0.06 : 0) + (rng() * 0.05 - 0.025);
  return [clamp255(QUARTZ_BASE[0] * v), clamp255(QUARTZ_BASE[1] * v), clamp255(QUARTZ_BASE[2] * v), 255];
};

/** 錾制石英块：中间两道竖线 + 上下横带的"雕花"图案 */
const CHISELED_QUARTZ_PAINTER: Painter = (x, y, rng) => {
  const band = y < 2 || y > 13 || (x >= 6 && x <= 9);
  const v = 1 + (band ? -0.12 : 0.04) + (rng() * 0.05 - 0.025);
  return [clamp255(QUARTZ_BASE[0] * v), clamp255(QUARTZ_BASE[1] * v), clamp255(QUARTZ_BASE[2] * v), 255];
};

/** 平滑石英：整块几乎纯色（比石英块更"平"，原版由石英块烧出来） */
const SMOOTH_QUARTZ_PAINTER: Painter = (_x, _y, rng) => {
  const v = 1 + (rng() * 0.03 - 0.015);
  return [clamp255(QUARTZ_BASE[0] * v), clamp255(QUARTZ_BASE[1] * v), clamp255(QUARTZ_BASE[2] * v), 255];
};

/** 深板岩瓦：2×2 的方形瓦片 + 深缝（与深板岩砖同一族，但缝更密） */
const DEEPSLATE_TILES_PAINTER: Painter = (x, y, rng) => {
  const seam = x % 8 === 7 || y % 8 === 7;
  const highlight = !seam && (x % 8 === 0 || y % 8 === 0);
  const v = (seam ? 0.72 : highlight ? 1.08 : 1) + (rng() * 0.1 - 0.05);
  return [clamp255(74 * v), clamp255(74 * v), clamp255(78 * v), 255];
};

PAINTERS.quartz_block_top = QUARTZ_TOP_PAINTER;
PAINTERS.quartz_block_side = QUARTZ_SIDE_PAINTER;
PAINTERS.quartz_pillar_top = QUARTZ_PILLAR_TOP_PAINTER;
PAINTERS.quartz_pillar_side = QUARTZ_PILLAR_SIDE_PAINTER;
PAINTERS.chiseled_quartz_block = CHISELED_QUARTZ_PAINTER;
PAINTERS.smooth_quartz = SMOOTH_QUARTZ_PAINTER;
PAINTERS.deepslate_tiles = DEEPSLATE_TILES_PAINTER;
// 红色下界砖：与下界砖同一套砖缝画笔，只是底色换成暗红（原版就是"红砖版下界砖"）
PAINTERS.red_nether_bricks = brickPainter([92, 28, 30]);

// ---- 切石机（批次 44，H11）
//
// 三张图的分工与原版一致：**顶面画锯片**（这是它的招牌：远远看一眼就知道是切石机）、
// 侧面画"石台 + 一道出料槽"，底面就是一块素石（原版底面确实是普通的平滑石）。
// 三张都用同一套石材底色，只是顶面加了一条铁锯片。

/** 石材的底色（切石机的三张图共用，保证"这是个石头做的方块"）。 */
const STONECUTTER_BASE = layered(124, 8, 6);

/**
 * 锯片：一条横贯顶面的铁锯条 + 齿。
 *
 * ⚠️ 齿画在**下沿**（`y === 9`）而不是上沿：从上往下看的时候，
 * 锯条是"压"在石台上的，齿朝下才不会看着像悬空的一根棍。
 */
function sawBlade(x: number, y: number, rng: () => number): [number, number, number, number] {
  const jitter = rng() * 10 - 5;
  // 锯条本体：y 6~8 一条横向铁条，两端留 1 像素
  if (y >= 6 && y <= 8 && x >= 1 && x <= 14) {
    const shade = y === 7 ? 1.12 : 0.92;
    return [clamp255(168 * shade + jitter), clamp255(170 * shade + jitter), clamp255(178 * shade + jitter), 255];
  }
  // 锯齿：下沿每隔一格凸出一颗
  if (y === 9 && x >= 2 && x <= 13 && x % 2 === 0) {
    return [clamp255(150 + jitter), clamp255(152 + jitter), clamp255(160 + jitter), 255];
  }
  return STONECUTTER_BASE(x, y, rng);
}

/** 顶面：石材 + 锯片 + 一条凹槽（原版顶面就是"石台上一把锯"） */
PAINTERS.stonecutter_top = (x, y, rng) => sawBlade(x, y, rng);

/** 底面：素石（不画任何结构） */
PAINTERS.stonecutter_bottom = (x, y, rng) => STONECUTTER_BASE(x, y, rng);

/** 侧面：石材 + 上沿凸出的一条石檐 + 中间一道出料槽 */
PAINTERS.stonecutter_side = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  // 上沿（y 0~1）是台面边缘，亮一点，看着像"有厚度"
  if (y <= 1) return [clamp255(150 + jitter), clamp255(150 + jitter), clamp255(154 + jitter), 255];
  // 出料槽：y 8~10 的横向深色缝（切下来的东西从这里出来）
  if (y >= 8 && y <= 10) {
    const edge = y === 8 || y === 10;
    const shade = edge ? 0.72 : 0.56;
    return [clamp255(124 * shade + jitter), clamp255(124 * shade + jitter), clamp255(128 * shade + jitter), 255];
  }
  return STONECUTTER_BASE(x, y, rng);
};
/** 下界石英（物品图标）：一小堆奶白的碎晶 */
PAINTERS.item_quartz = lump(
  [
    [244, 240, 234],
    [214, 208, 200],
    [178, 172, 166],
  ],
  'iquartz',
  4.2,
);

// ---------------------------------------------------------------- 海带与海草（批次 50）

/**
 * 海带：一根从下往上略微摆动的**深绿长茎**，两侧交替长出细长的叶。
 *
 * 它走 `cross` 形状（两片交叉薄面），所以贴图要**画满整格高度**——
 * 一株海带是由好几格这样的方块叠起来的，接缝处茎要对得上（`x` 固定在中间那 2~3 像素，
 * 于是上下两格的茎连成一条线，看不出是"一节一节的方块"）。
 */
PAINTERS.kelp = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  // 主茎：中间 2 像素宽，略带 S 形摆动（下宽上窄）
  const sway = Math.sin(y * 0.42) * 1.1;
  const halfStem = 1.2 - (15 - y) * 0.03;
  if (Math.abs(x - 7.5 - sway) <= halfStem) {
    const shade = y < 8 ? 0.85 : 1.0;
    return [clamp255(40 * shade + jitter), clamp255(96 * shade + jitter), clamp255(44 * shade + jitter), 255];
  }
  // 叶片：左右交替，每 4 像素一节往外伸
  const leafRow = (15 - y) % 4;
  if (leafRow < 2 && y > 1 && y < 15) {
    const side = ((15 - y) / 4 | 0) % 2 === 0 ? -1 : 1;
    const reach = (2 - leafRow) * 1.6;
    const d = (x - 7.5 - sway) * side;
    if (d > halfStem && d <= halfStem + reach) {
      return [clamp255(58 + jitter), clamp255(126 + jitter), clamp255(56 + jitter), 255];
    }
  }
  return [0, 0, 0, 0];
};

/**
 * 海草：比海带矮得多的一撮细叶（`3~4` 片），最上面断开——
 * 一眼能看出"它不长高"，也就不会被误当成海带的幼苗。
 */
PAINTERS.seagrass = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  const top = 2 + ((x * 7) % 4); // 每片叶子的高度不同
  if (y < top || y > 15) return [0, 0, 0, 0];
  // 四片叶子分布在 x = 3 / 6 / 9 / 12 附近，越靠边的越短
  for (const [cx, len] of [
    [3, 9],
    [6.5, 13],
    [9.5, 12],
    [13, 8],
  ] as const) {
    if (Math.abs(x - cx) > 0.9) continue;
    if (y < 15 - len) continue;
    const shade = y < 8 ? 1.05 : 0.88;
    return [clamp255(52 * shade + jitter), clamp255(118 * shade + jitter), clamp255(50 * shade + jitter), 255];
  }
  return [0, 0, 0, 0];
};

/** 干海带块：晒干的海带压成的一摞——顶面是横竖交错的编织纹 */
PAINTERS.dried_kelp_top = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 编织：每 4 像素一条，横竖各一组，交点更亮
  const weave = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
  const onSeam = x % 4 === 0 || y % 4 === 0;
  const base = weave ? 96 : 74;
  const shade = onSeam ? 0.82 : 1;
  return [clamp255(base * shade * 0.86 + jitter), clamp255(base * shade + jitter), clamp255(base * shade * 0.5 + jitter), 255];
};

/** 干海带块侧面：一层层横着压出来的干海带（原版侧面就是这种"摞起来"的观感） */
PAINTERS.dried_kelp_side = (_x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 每 5 像素一层，层与层之间有一条深缝
  const layer = Math.floor(y / 5);
  const seam = y % 5 === 0;
  const base = 84 + (layer % 2) * 10;
  const shade = seam ? 0.72 : 1;
  return [clamp255(base * shade * 0.86 + jitter), clamp255(base * shade + jitter), clamp255(base * shade * 0.5 + jitter), 255];
};

/** 干海带（物品图标）：一片对折的深绿干叶片，边缘发褐（晒干的样子） */
PAINTERS.item_dried_kelp = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  // 一片斜着的长叶：中心线从左上到右下
  const center = 3.4 + (y / 15) * 8.2;
  const d = Math.abs(x - center);
  if (d > 4.6) return [0, 0, 0, 0];
  if (d > 3.6) {
    // 边缘：发褐（晒焦的那一圈）
    return [clamp255(96 + jitter), clamp255(74 + jitter), clamp255(30 + jitter), 255];
  }
  // 中间：深绿，折线那一侧更深（对折的暗面）
  const fold = x - center;
  const shade = fold < -0.8 ? 0.74 : fold > 1.2 ? 1.06 : 0.92;
  return [clamp255(46 * shade + jitter), clamp255(84 * shade + jitter), clamp255(40 * shade + jitter), 255];
};

// ---------------------------------------------------------------- 珊瑚一族（批次 51）

/**
 * 五种珊瑚的基色（贴图用的近似值，量级对齐原版观感：
 * 管=粉、脑=品红、气泡=紫、火=红、鹿角=黄）。
 */
const CORAL_COLORS: Record<string, readonly [number, number, number]> = {
  tube: [228, 96, 142],
  brain: [206, 88, 182],
  bubble: [158, 100, 212],
  fire: [204, 66, 66],
  horn: [204, 180, 88],
};

/** 失活珊瑚：一律灰白（原版那种"珊瑚骸骨"） */
const DEAD_CORAL_COLOR: readonly [number, number, number] = [152, 150, 146];

function coralColor(kind: string, dead: boolean): readonly [number, number, number] {
  return dead ? DEAD_CORAL_COLOR : (CORAL_COLORS[kind] ?? DEAD_CORAL_COLOR);
}

/** 把基色按亮度缩放、再加一点随机噪点 */
function coralShade(color: readonly [number, number, number], shade: number, jitter: number): RGBA {
  return [clamp255(color[0] * shade + jitter), clamp255(color[1] * shade + jitter), clamp255(color[2] * shade + jitter), 255];
}

/**
 * 珊瑚块：整块的多孔珊瑚（基色 + 一道道深色孔洞）。
 *
 * 失活的版本把颜色换成灰白、**对比度调低**（原版的失活珊瑚就是"灰得看不出原来是什么颜色"），
 * 于是五张失活贴图远看几乎一样——这正是原版的观感。
 */
function coralBlockPainter(kind: string, dead: boolean): Painter {
  return (x, y, rng) => {
    const color = coralColor(kind, dead);
    const jitter = (rng() * 2 - 1) * (dead ? 5 : 9);
    // 孔洞：斜向的格子里挖几个（确定性图案，不是每像素乱撒——珊瑚块是有"骨架"的）
    const pore = ((x * 3 + y * 5) % 11 === 0) || ((x * 5 - y * 3 + 33) % 17 === 0);
    const ridge = (x + y) % 4 === 0;
    const shade = pore ? (dead ? 0.78 : 0.62) : ridge ? 1.08 : 1;
    return coralShade(color, shade, jitter);
  };
}

/**
 * 珊瑚丛（`cross` 形状）：从底部中心往上分叉的一小株，四周透明。
 *
 * 形状画满整格高度（与花草同一档），下面那一格是珊瑚块时看着就是"从块里长出来的"。
 */
function coralTuftPainter(kind: string, dead: boolean): Painter {
  return (x, y, rng) => {
    if (y < 2 || y > 15) return [0, 0, 0, 0];
    // 主干：中下部分；三个分叉：越往上越往两边散
    const stem = Math.abs(x - 7.5) <= 1.4 && y >= 9;
    const left = Math.abs(x - (7.5 - (15 - y) * 0.55)) <= 1.1 && y <= 11;
    const right = Math.abs(x - (7.5 + (15 - y) * 0.55)) <= 1.1 && y <= 11;
    const top = Math.abs(x - 7.5) <= 1.0 && y >= 3;
    if (!stem && !left && !right && !top) return [0, 0, 0, 0];
    const jitter = (rng() * 2 - 1) * (dead ? 6 : 12);
    // 顶端亮、根部暗（有个体积感）
    return coralShade(coralColor(kind, dead), y < 8 ? 1.12 : 0.9, jitter);
  };
}

/**
 * 珊瑚扇（`coral_fan` 形状）：一片扇面（从下边中心往上放射，带放射状的棱）。
 *
 * 透明像素很多（扇面之外都是空的），这也是它走独立形状而不是 `cross` 的原因：
 * 十字形的两片薄面画不出"一片扇子"。
 */
function coralFanPainter(kind: string, dead: boolean): Painter {
  return (x, y, rng) => {
    const dx = x - 7.5;
    const dy = 15 - y;
    const radius = Math.hypot(dx, dy * 1.15);
    if (radius > 7.4) return [0, 0, 0, 0];
    // 扇骨：按角度分条，奇数条亮一点（原版扇面就是一条条放射的棱）
    const angle = Math.atan2(dy, dx) + Math.PI;
    const rib = Math.floor((angle / Math.PI) * 7) % 2 === 0;
    const jitter = (rng() * 2 - 1) * (dead ? 5 : 10);
    const shade = (rib ? 1.1 : 0.88) * (radius > 6.2 ? 0.86 : 1);
    return coralShade(coralColor(kind, dead), shade, jitter);
  };
}

// 30 张贴图按"五种色 × 三个形态工厂 × 活/失活"展开——
// 与方块表（`CORAL_SPECS`）同一套命名规则，加一种颜色时两边一起长
for (const kind of ['tube', 'brain', 'bubble', 'fire', 'horn']) {
  for (const dead of [false, true]) {
    const prefix = dead ? `dead_${kind}` : kind;
    PAINTERS[`${prefix}_coral_block`] = coralBlockPainter(kind, dead);
    PAINTERS[`${prefix}_coral`] = coralTuftPainter(kind, dead);
    PAINTERS[`${prefix}_coral_fan`] = coralFanPainter(kind, dead);
  }
}

// ---------------------------------------------------------------- 蛋糕与花盆（批次 52）

/**
 * 蛋糕顶面：白色奶油 + 几颗红点（原版那种"奶油上摆着樱桃"的样子）。
 * 蛋糕越吃越窄是靠**几何**缩的，贴图只有这一套三张（原版也是这样）。
 */
PAINTERS.cake_top = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  // 四角各内缩一点：蛋糕不是整格方块（这一层看起来要"圆"一点）
  const edge = x < 1 || y < 1;
  // 樱桃：四个固定位置
  for (const [cx, cy] of [
    [5, 5],
    [10, 7],
    [7, 11],
  ] as const) {
    if (Math.hypot(x - cx, y - cy) < 1.6) return [clamp255(196 + jitter), clamp255(58 + jitter), clamp255(58 + jitter), 255];
  }
  const shade = edge ? 0.9 : 1;
  return [clamp255(246 * shade + jitter), clamp255(242 * shade + jitter), clamp255(228 * shade + jitter), 255];
};

/** 蛋糕底面：烤过的深色蛋糕底 */
PAINTERS.cake_bottom = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const shade = (x + y) % 4 === 0 ? 0.86 : 1;
  return [clamp255(166 * shade + jitter), clamp255(124 * shade + jitter), clamp255(78 * shade + jitter), 255];
};

/**
 * 蛋糕侧面：上沿一圈奶油、下面是蛋糕体（原版侧面就是"奶油盖在蛋糕上"）。
 * ⚠️ 贴图的**左侧**是"被切的那一面"（与被吃时从右往左缩的几何约定一致）。
 */
PAINTERS.cake_side = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  if (y < 4) {
    // 顶层的奶油（下沿有一点起伏，看着像流下来）
    const drip = y >= 3 && x % 5 === 2;
    if (!drip) return [clamp255(246 + jitter), clamp255(242 + jitter), clamp255(228 + jitter), 255];
  }
  // 蛋糕体：斜向的孔洞（烤出来的气孔）
  const pore = (x * 3 + y * 5) % 11 === 0;
  const shade = pore ? 0.84 : 1;
  return [clamp255(178 * shade + jitter), clamp255(132 * shade + jitter), clamp255(84 * shade + jitter), 255];
};

/**
 * 花盆（陶土盆）：砖红色 + 上沿一圈厚边。
 * 这一张同时用作**侧面与底面**（盆底在游戏里看不到）。
 */
PAINTERS.flower_pot = (x, y, rng) => {
  const jitter = rng() * 12 - 6;
  // 上沿（y < 3）：亮一圈厚边；下面是被烤出来的盆身
  const rim = y < 3;
  // 竖着的陶纹
  const stripe = x % 4 === 0;
  const shade = rim ? 1.12 : stripe ? 0.9 : 1;
  return [clamp255(150 * shade + jitter), clamp255(88 * shade + jitter), clamp255(66 * shade + jitter), 255];
};

/** 花盆顶面：盆里那一层土（深褐色，带几粒亮色的颗粒） */
PAINTERS.flower_pot_top = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 盆口那一圈陶沿（四周 2 像素）
  if (x < 2 || y < 2 || x > 13 || y > 13) {
    return [clamp255(150 + jitter), clamp255(88 + jitter), clamp255(66 + jitter), 255];
  }
  const grain = (x * 7 + y * 11) % 9 === 0;
  const shade = grain ? 1.25 : 1;
  return [clamp255(104 * shade + jitter), clamp255(72 * shade + jitter), clamp255(46 * shade + jitter), 255];
};

// ---------------------------------------------------------------- 脚手架（批次 53）

/**
 * 脚手架顶面：站人的那块木板（几条纵向竹板拼起来的样子）。
 * 竹子做的建材，所以颜色走**竹黄**那一档。
 */
PAINTERS.scaffolding_top = (x, _y, rng) => {
  const jitter = rng() * 12 - 6;
  // 每 4 像素一条板缝（纵向），缝里深一点
  const seam = x % 4 === 0;
  const shade = seam ? 0.74 : 1;
  return [clamp255(186 * shade + jitter), clamp255(168 * shade + jitter), clamp255(96 * shade + jitter), 255];
};

/** 脚手架底面：从下面看到的木条（比顶面暗一档） */
PAINTERS.scaffolding_bottom = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const seam = (x + y) % 5 === 0;
  const shade = seam ? 0.66 : 0.82;
  return [clamp255(186 * shade + jitter), clamp255(168 * shade + jitter), clamp255(96 * shade + jitter), 255];
};

/**
 * 脚手架侧面：上半段是空的（能看到里面的柱子），下半段是那块板的侧边。
 *
 * ⚠️ 这一张是**整格贴图**（盒子的每个面都用整张），所以"空"只能用透明像素表达：
 * 板以上（y < 12/16 那一带）除了两侧柱子以外都是透明的——
 * 否则从侧面看脚手架会像一个实心方块。
 */
PAINTERS.scaffolding_side = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  // 贴图的 y=0 在**上**：板占最下面 1/8（约 2 像素），上面那一大段只有两侧的柱子
  const plankTop = Math.round(15 * (1 - 0.125));
  if (y >= plankTop) {
    // 板那一截：纵向竹板的侧边
    const seam = x % 4 === 0;
    const shade = seam ? 0.74 : 1;
    return [clamp255(186 * shade + jitter), clamp255(168 * shade + jitter), clamp255(96 * shade + jitter), 255];
  }
  // 板以上：只有两侧的柱子（各 1/16 宽）
  const pillar = x <= 0 || x >= 15;
  if (!pillar) return [0, 0, 0, 0];
  const shade = 0.88;
  return [clamp255(186 * shade + jitter), clamp255(168 * shade + jitter), clamp255(96 * shade + jitter), 255];
};

// ---------------------------------------------------------------- 阳光传感器（批次 54）

/**
 * 阳光传感器顶面：深蓝的"太阳能板"，中间嵌着一格小窗。
 * 由 `daylightPanel(inverted)` 生成两张（正常 / 反向模式的颜色不同）。
 */
function daylightPanel(inverted: boolean): Painter {
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    // 石英边框（外面一圈 1 像素）
    if (x === 0 || y === 0 || x === 15 || y === 15) {
      return [clamp255(232 + jitter), clamp255(228 + jitter), clamp255(216 + jitter), 255];
    }
    // 中间的小窗（左右两侧各留一格深色，中间那条浅色）
    if (x === 7 || x === 8) {
      const shade = inverted ? 1.4 : 0.8;
      return [
        clamp255((inverted ? 96 : 60) * shade + jitter),
        clamp255((inverted ? 60 : 110) * shade + jitter),
        clamp255((inverted ? 140 : 168) * shade + jitter),
        255,
      ];
    }
    // 板面：正常模式是深蓝，反向模式是紫
    const base = inverted ? [104, 62, 132] : [38, 74, 128];
    const shade = (x + y) % 5 === 0 ? 0.86 : 1;
    return [clamp255(base[0]! * shade + jitter), clamp255(base[1]! * shade + jitter), clamp255(base[2]! * shade + jitter), 255];
  };
}

PAINTERS.daylight_detector_top = daylightPanel(false);
PAINTERS.daylight_detector_inverted_top = daylightPanel(true);

/** 侧面：石英的白色 + 底部一条木边（原版就是"石英板压在三块台阶上"的样子） */
PAINTERS.daylight_detector_side = (_x, y, rng) => {
  const jitter = rng() * 10 - 5;
  if (y >= 12) {
    // 木头那一圈
    return [clamp255(162 + jitter), clamp255(128 + jitter), clamp255(78 + jitter), 255];
  }
  const shade = y < 1 ? 0.92 : 1;
  return [clamp255(232 * shade + jitter), clamp255(228 * shade + jitter), clamp255(216 * shade + jitter), 255];
};

// ---------------------------------------------------------------- 绊线与绊线钩（批次 55）

/**
 * 绊线：**贴在盒子底面的一条细线**（盒子里只有 1/16 高、2/16 宽，其余透明）。
 * 线沿着盒子长边走，所以贴图上就是一条横线 + 每隔几像素的"结"。
 */
PAINTERS.tripwire = (_x, y, rng) => {
  const jitter = rng() * 10 - 5;
  if (y > 2) return [0, 0, 0, 0];
  // 线本身（深灰，原版绊线是暗色的细绳）
  const shade = y < 1 ? 0.86 : 1;
  return [clamp255(150 * shade + jitter), clamp255(138 * shade + jitter), clamp255(120 * shade + jitter), 255];
};

/**
 * 绊线钩：一块木底板 + 一个铁环（原版就是"木板 + 铁钩"的样子）。
 * `powered` 那张把铁环画成红色——这样"线接上了没、触发了没"一眼能看出来。
 */
function tripwireHook(inverted: boolean): Painter {
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    // 铁环：中间偏上一圈
    const distance = Math.hypot(x - 7.5, y - 7.5 * 1.0);
    if (distance > 3.6 && distance < 5.6) {
      const red = inverted ? 1 : 0.55;
      return [
        clamp255((inverted ? 196 : 172) * red + jitter),
        clamp255((inverted ? 60 : 168) * red + jitter),
        clamp255((inverted ? 52 : 160) * red + jitter),
        255,
      ];
    }
    // 底板：下半部分的木纹
    if (y >= 9) {
      const stripe = x % 4 === 0;
      const shade = stripe ? 0.82 : 1;
      return [clamp255(162 * shade + jitter), clamp255(126 * shade + jitter), clamp255(78 * shade + jitter), 255];
    }
    // 其它地方透明（钩子是镂空的）
    return [0, 0, 0, 0];
  };
}

PAINTERS.tripwire_hook = tripwireHook(false);
PAINTERS.tripwire_hook_powered = tripwireHook(true);

// ---------------------------------------------------------------- TNT（批次 56）

/**
 * TNT 侧面：一圈红白相间的炸药块（原版就是"红底 + 白字 TNT"）。
 * 这里的"字"用**三条白杠**表示（16×16 画不出清晰的字母，杠比糊字好看）。
 */
function tntSide(primed: boolean): Painter {
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    const base = primed ? [248, 236, 236] : [196, 58, 50];
    // 中间那条白带 + 杠（"TNT" 的样子）
    const band = y >= 4 && y <= 11;
    const bar = band && ((x >= 3 && x <= 5 && y >= 6 && y <= 9) || (x >= 7 && x <= 9 && y >= 6 && y <= 9) || (x >= 11 && x <= 13 && y >= 6 && y <= 9));
    if (band) {
      const white = primed ? [255, 255, 255] : [238, 232, 220];
      const shade = bar ? 0.82 : 1;
      return [clamp255(white[0]! * shade + jitter), clamp255(white[1]! * shade + jitter), clamp255(white[2]! * shade + jitter), 255];
    }
    const shade = (x + y) % 4 === 0 ? 0.9 : 1;
    return [clamp255(base[0]! * shade + jitter), clamp255(base[1]! * shade + jitter), clamp255(base[2]! * shade + jitter), 255];
  };
}

PAINTERS.tnt_side = tntSide(false);
PAINTERS.tnt_primed_side = tntSide(true);

/** 顶面：一圈红边围着中间的白色"引信口" */
function tntTop(primed: boolean): Painter {
  return (x, y, rng) => {
    const jitter = rng() * 10 - 5;
    const center = Math.hypot(x - 7.5, y - 7.5) < 4.2;
    if (center) {
      const shade = primed ? 1 : 0.94;
      return [clamp255(240 * shade + jitter), clamp255(236 * shade + jitter), clamp255(224 * shade + jitter), 255];
    }
    const base = primed ? [246, 230, 230] : [186, 54, 46];
    const shade = (x * 3 + y * 5) % 7 === 0 ? 0.88 : 1;
    return [clamp255(base[0]! * shade + jitter), clamp255(base[1]! * shade + jitter), clamp255(base[2]! * shade + jitter), 255];
  };
}

PAINTERS.tnt_top = tntTop(false);
PAINTERS.tnt_primed_top = tntTop(true);

/** 底面：与侧面同一套配色，但没有白带（原版底面就是纯红） */
PAINTERS.tnt_bottom = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const shade = (x + y) % 5 === 0 ? 0.88 : 1;
  return [clamp255(186 * shade + jitter), clamp255(54 * shade + jitter), clamp255(46 * shade + jitter), 255];
};

// ---------------------------------------------------------------- 铁壳容器（漏斗 / 投掷器）

/**
 * 铁皮基色（原版那套"深灰金属"）：外面亮一点、管道内壁暗一点。
 *
 * 漏斗（批次 58）与投掷器（批次 59）在原版里是同一族的铁壳方块，
 * 所以**共用这一套画笔**——两族的差别只在"哪个位置画什么"。
 */
const METAL_BASE = { r: 118, g: 118, b: 122 };

/** 一小段"金属拉丝"：每 4 像素一条暗线，让大面积平色不至于糊成一块 */
function metalShade(x: number, y: number): number {
  if (x % 4 === 0) return 0.9;
  if (y % 8 === 3) return 0.94;
  return 1;
}

function metalPlate(x: number, y: number, jitter: number, scale: number): [number, number, number, number] {
  const shade = metalShade(x, y) * scale;
  return [
    clamp255(METAL_BASE.r * shade + jitter),
    clamp255(METAL_BASE.g * shade + jitter),
    clamp255(METAL_BASE.b * shade + jitter),
    255,
  ];
}

/** 四角铆钉（铁壳方块共用的"这是金属机械"标记） */
function isRivet(x: number, y: number): boolean {
  return (x === 2 || x === 13) && (y === 2 || y === 13);
}

/**
 * 顶面：碗口那圈铁皮 + 中间一个**黑洞**（原版 `hopper_top` 就是"四周有纹、中间黑"）。
 *
 * 洞的大小按几何来：管子是 4/16 见方，所以洞口取中间 4 像素——玩家俯视时
 * "洞正对着管子"这件事看得出来。
 */
PAINTERS.hopper_top = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const inHole = x >= 6 && x <= 9 && y >= 6 && y <= 9;
  if (inHole) {
    const shade = (x + y) % 3 === 0 ? 0.5 : 1;
    return [clamp255(28 * shade), clamp255(28 * shade), clamp255(32 * shade), 255];
  }
  // 洞口外一圈更暗的"内壁"（视觉上把洞口围出来，不然只是平面上一个方块）
  const nearHole = x >= 5 && x <= 10 && y >= 5 && y <= 10;
  return metalPlate(x, y, jitter, nearHole ? 0.82 : 1);
};

/** 管子内壁：整体暗一档 + 中间 4×4 的口是纯黑（从下往上看就是管子口） */
PAINTERS.hopper_inside = (x, y, rng) => {
  const jitter = rng() * 8 - 4;
  const inHole = x >= 6 && x <= 9 && y >= 6 && y <= 9;
  if (inHole) return [16, 16, 18, 255];
  return metalPlate(x, y, jitter, 0.72);
};

/** 外壳：四条边更暗（原版漏斗外面那圈"铆边"），中间是拉丝铁皮 */
PAINTERS.hopper_side = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const edge = x === 0 || x === 15 || y === 0 || y === 15;
  if (edge) return metalPlate(x, y, jitter, 0.7);
  return metalPlate(x, y, jitter, 1);
};

/**
 * 投掷器顶面（批次 59）：整片铁皮 + 内缩一圈的**铆边** + 中间那圈"投口"。
 *
 * 中间那圈对着几何上的凸口（4/16 见方），俯视时能看出"这是个会吐东西的口"；
 * 顶/底两面都用它（底面看不见，但省一张贴图不值得）。
 */
PAINTERS.dropper_top = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const ring = x === 1 || x === 14 || y === 1 || y === 14;
  if (ring) return metalPlate(x, y, jitter, 0.68);
  const inBore = x >= 6 && x <= 9 && y >= 6 && y <= 9;
  if (inBore) return metalPlate(x, y, jitter * 0.5, 0.62);
  return metalPlate(x, y, jitter, 1);
};

/** 投掷器侧面：拉丝铁皮 + 四角铆钉（与箱子/铁块那种"板"区分开） */
PAINTERS.dropper_side = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  if (isRivet(x, y)) return metalPlate(x, y, jitter, 0.55);
  const edge = x === 0 || x === 15 || y === 0 || y === 15;
  if (edge) return metalPlate(x, y, jitter, 0.72);
  return metalPlate(x, y, jitter, 1);
};

/**
 * 发射器顶/底（批次 60）：与投掷器同一套底子，但中间那圈**大一圈、多两道凹槽**——
 * 两兄弟长得像，靠"口的大小 + 侧面纹路"区分（见 `blocks.ts` 里那段说明）。
 */
PAINTERS.dispenser_top = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const ring = x === 0 || x === 15 || y === 0 || y === 15;
  if (ring) return metalPlate(x, y, jitter, 0.66);
  // 挡板（几何上 7/16 见方）：这里画成"带两道凹槽"的圆盘
  const inPlate = x >= 5 && x <= 10 && y >= 5 && y <= 10;
  if (inPlate) {
    const groove = x === 5 && (y === 6 || y === 9);
    return metalPlate(x, y, jitter * 0.5, groove ? 0.5 : 0.6);
  }
  return metalPlate(x, y, jitter, 1);
};

/** 发射器侧面：拉丝铁皮 + 上下两条加强筋（与投掷器的四角铆钉区分开） */
PAINTERS.dispenser_side = (x, y, rng) => {
  const jitter = rng() * 10 - 5;
  const rib = y === 3 || y === 12;
  if (rib) return metalPlate(x, y, jitter, 0.58);
  const edge = x === 0 || x === 15 || y === 0 || y === 15;
  if (edge) return metalPlate(x, y, jitter, 0.7);
  return metalPlate(x, y, jitter, 1);
};

/**
 * 木桶（批次 61）：三张面都由**橡木木板**那张画法派生（`planksPainter`，与 `oak_planks` 同源），
 * 再叠上"箍"与"竖板条"——这样木桶看起来就是"木板桶"，不会与别的木材串味。
 */
const barrelPlanks = planksPainter(WOOD_TYPES.find((wood) => wood.name === 'oak')?.wood ?? [150, 118, 72]);

function barrelShade(base: RGBA, factor: number): RGBA {
  return [clamp255(base[0] * factor), clamp255(base[1] * factor), clamp255(base[2] * factor), 255];
}

/** 顶面：木板 + **一圈铁箍**（盖子），中间一道横缝 */
PAINTERS.barrel_top = (x, y, rng) => {
  const rim = x <= 1 || x >= 14 || y <= 1 || y >= 14;
  if (rim) return metalPlate(x, y, rng() * 10 - 5, 0.5);
  const base = barrelPlanks(x, y, rng);
  const seam = y === 7 || y === 8;
  return barrelShade(base, seam ? 0.78 : 1);
};

/** 底面：普通木板（原版底面也是木板；看不见，但省一张贴图不值得） */
PAINTERS.barrel_bottom = (x, y, rng) => barrelShade(barrelPlanks(x, y, rng), 0.94);

/** 侧面：**竖板条 + 两道铁箍**——木桶的身份一眼看得出来 */
PAINTERS.barrel_side = (x, y, rng) => {
  const hoop = y === 2 || y === 13;
  if (hoop) return metalPlate(x, y, rng() * 10 - 5, 0.52);
  return barrelShade(barrelPlanks(x, y, rng), x % 4 === 0 ? 0.8 : 1);
};

/**
 * 堆肥桶（批次 70）：桶身 / 桶底 / 顶面 / 满仓。
 *
 * 四张都由**橡木木板**那张画法派生（与木桶同一套底子），靠"箍"和中间那个**暗口**区分：
 *  - 桶身：竖板条 + 上下两道铁箍（原版堆肥桶就是一圈板条箍起来的）；
 *  - 桶底：普通木板（看不见，但省一张贴图不值得）；
 *  - 顶面：外面一圈板条框、**中间是暗口**——从上往下看就能看见"这桶是空的"；
 *  - 满仓：同一圈框，中间换成**棕色的堆肥**（冒不出头，与桶沿齐平）。
 */
const composterPlanks = planksPainter([150, 118, 72]);

/** 桶身上的那两道箍（与木桶同一档颜色，木桶家族看起来才像一家） */
function composterRing(y: number): boolean {
  return y === 2 || y === 13;
}

PAINTERS.composter_side = (x, y, rng) => {
  const base = composterPlanks(x, y, rng);
  if (composterRing(y)) return [clamp255(base[0] * 0.62), clamp255(base[1] * 0.62), clamp255(base[2] * 0.62), 255];
  return [clamp255(base[0] * (x % 4 === 0 ? 0.82 : 1)), clamp255(base[1] * (x % 4 === 0 ? 0.82 : 1)), clamp255(base[2] * (x % 4 === 0 ? 0.82 : 1)), 255];
};

PAINTERS.composter_bottom = (x, y, rng) => {
  const base = composterPlanks(x, y, rng);
  return [clamp255(base[0] * 0.94), clamp255(base[1] * 0.94), clamp255(base[2] * 0.94), 255];
};

/** 顶面：板条框（2 像素）+ 中间暗口；`filled` = 满仓时画棕色堆肥 */
function composterTop(filled: boolean): Painter {
  return (x, y, rng) => {
    const rim = x <= 1 || x >= 14 || y <= 1 || y >= 14;
    if (rim) {
      const base = composterPlanks(x, y, rng);
      return [clamp255(base[0] * 1.06), clamp255(base[1] * 1.06), clamp255(base[2] * 1.06), 255];
    }
    if (!filled) {
      // 暗口：越靠里越黑（看得出是个凹进去的桶）
      const depth = Math.min(x - 1, 14 - x, y - 1, 14 - y) / 6;
      const v = 0.34 - Math.min(0.22, depth * 0.22) + rng() * 0.05;
      return [clamp255(74 * v), clamp255(62 * v), clamp255(48 * v), 255];
    }
    // 满仓：棕色堆肥，带颗粒感（看得出"里面有东西了"）
    const grain = rng();
    const v = 1 + grain * 0.16 - 0.08;
    return [clamp255(96 * v), clamp255(70 * v), clamp255(42 * v), 255];
  };
}

PAINTERS.composter_top = composterTop(false);
PAINTERS.composter_ready = composterTop(true);

/**
 * 音符盒（批次 173）：深色木板底 + 一圈黑框 + 正中一个**浅木色音符**。
 *
 * 与原版那张的差别只有配色：原版是深色橡木 + 暗红音符，而我们的木板底本来就偏暗，
 * 暗红音符在 16×16 里几乎看不见——所以音符取亮木色（那一眼就能认出"这是乐器"）。
 * 音高不改变贴图（原版也是同一张），所以网格化那边不用管状态位。
 */
/**
 * 刷怪蛋（批次 174）：一副蛋形 + 该生物自己的配色。
 *
 * 蛋形用椭圆（横向 9px、纵向 11px），底部两行压暗一点（有体积感）、
 * 外加 3~4 个点缀色斑点——远处一眼能分出"这枚蛋是谁的"。
 * ⚠️ 颜色**从 `MOB_TYPES` 取**（`bodyColor` / `accentColor`），不在这里另抄一份：
 * 以后调僵尸的绿，蛋也跟着变；抄一份的话两边一定会分家。
 */
function spawnEggPainter(base: number, accent: number): (x: number, y: number, rng: () => number) => [number, number, number, number] {
  const channel = (color: number, shift: number): number => (color >> shift) & 0xff;
  const b = [channel(base, 16), channel(base, 8), channel(base, 0)];
  const a = [channel(accent, 16), channel(accent, 8), channel(accent, 0)];
  return (x, y, rng) => {
    // 椭圆：中心 (7.5, 8)，半轴 4.6 / 5.6
    const nx = (x - 7.5) / 4.6;
    const ny = (y - 8) / 5.6;
    const d = nx * nx + ny * ny;
    if (d > 1) return [0, 0, 0, 0];
    // 斑点：用坐标哈希挑几个格子（确定性，刷新图集不会变）
    const spot = hashString(`egg${x},${y}`) % 9 === 0;
    const color = spot ? a : b;
    // 简易明暗：左上亮一点、右下暗一点
    const shade = 1 + (0.12 * (7.5 - x)) / 7 - (0.1 * (y - 8)) / 7 + (rng() * 0.04 - 0.02);
    return [clamp255(color[0]! * shade), clamp255(color[1]! * shade), clamp255(color[2]! * shade), 255];
  };
}

for (const spec of SPAWN_EGG_SPECS) {
  const type = mobTypeById(spec.mobId);
  PAINTERS[spawnEggTile(spec.mobId)] = spawnEggPainter(type?.bodyColor ?? 0x9a9a9a, type?.accentColor ?? 0xf2f2f2);
}

PAINTERS.note_block = (x: number, y: number, rng: () => number): [number, number, number, number] => {
  // 四周 1px 黑框
  if (x === 0 || y === 0 || x === 15 || y === 15) return [32, 21, 12, 255];
  // 音符：圆头（4×3）+ 竖杆，画在正中偏下
  const head = x >= 6 && x <= 9 && y >= 9 && y <= 11;
  const stem = x >= 9 && x <= 10 && y >= 4 && y <= 9;
  if (head || stem) return [236, 218, 180, 255];
  // 木板：横向纹理 + 每 4 行一道暗缝
  const seam = y % 4 === 0 ? 0.78 : 1;
  const grain = (rng() < 0.18 ? 0.88 : 1) * seam;
  return [clamp255(126 * grain), clamp255(86 * grain), clamp255(50 * grain), 255];
};

/**
 * 末影箱（批次 71）：黑洞石底子 + 正面那只**青绿色的眼睛**。
 *
 * 三张共用同一套底（深紫近黑、带一点点颗粒），差异只在**正面**：
 * 中间偏上一只"眼睛"（外圈深青、瞳孔近白青），这是原版末影箱最好认的特征。
 * 顶面再点一颗小的青绿斑，俯视时也能认出来（俯视看不到正面）。
 */
function enderStone(x: number, y: number, rng: () => number): [number, number, number, number] {
  const jitter = rng() * 14 - 7;
  // 稀疏的紫色颗粒（黑曜石那种"里面像有星点"的观感）
  const fleck = hashString(`ender${x},${y}`) % 23 === 0;
  const base = fleck ? [64, 40, 78] : [38, 26, 48];
  return [clamp255(base[0]! + jitter), clamp255(base[1]! + jitter), clamp255(base[2]! + jitter), 255];
}

PAINTERS.ender_chest_top = (x, y, rng) => {
  const base = enderStone(x, y, rng);
  // 俯视时的那点气息：中间一小片青绿
  const r = Math.hypot(x - 7.5, y - 7.5);
  if (r < 3.4) return [clamp255(36 + rng() * 24), clamp255(112 + rng() * 30), clamp255(104 + rng() * 26), 255];
  return base;
};

PAINTERS.ender_chest_side = (x, y, rng) => enderStone(x, y, rng);

PAINTERS.ender_chest_front = (x, y, rng) => {
  // 正面那只眼睛：歪一点比正圆更像原版（原版是杏仁形）
  const dx = (x - 7.5) / 5.4;
  const dy = (y - 7.2) / 3.2;
  const eye = dx * dx + dy * dy;
  if (eye < 0.34) return [clamp255(206 + rng() * 20), clamp255(248), clamp255(238), 255]; // 瞳孔
  if (eye < 1) return [clamp255(28 + rng() * 18), clamp255(120 + rng() * 26), clamp255(112 + rng() * 24), 255];
  return enderStone(x, y, rng);
};

/**
 * 潜影盒（批次 72）：紫贝色的"盒子"，三张面各司其职。
 *
 *  - **顶面**：一圈壳脊（四个斜角的深色棱）+ 中间的圆盖（原版俯视就是这个样子）；
 *  - **底面**：平一些的壳面（带细棱）；
 *  - **侧面**：上下两半的**合缝**（原版潜影盒侧面中间有一道缝，像盖子盖在盒身上），
 *    下半略暗一点，看起来有"盖上"的感觉。
 */
function shulkerShell(
  x: number,
  y: number,
  rng: () => number,
  base: readonly [number, number, number],
  scale: number,
): RGBA {
  const v = (1 + rng() * 0.1 - 0.05) * scale;
  const fleck = hashString(`shulker${x},${y}`) % 17 === 0;
  const tint = fleck ? 0.82 : 1;
  return [
    clamp255(base[0] * v * tint),
    clamp255(base[1] * v * tint),
    clamp255(base[2] * v * tint),
    255,
  ];
}

PAINTERS.shulker_top = (x, y, rng) => {
  const SHELL: readonly [number, number, number] = [150, 108, 158];
  const r = Math.hypot(x - 7.5, y - 7.5);
  // 中间的圆盖（比周围亮一点，像一枚扣在上面的壳）
  if (r < 4.6) return shulkerShell(x, y, rng, SHELL, 1.12);
  // 四条斜棱：壳脊
  const ridge = Math.abs(x - y) <= 1 || Math.abs(x + y - 15) <= 1;
  if (ridge) return shulkerShell(x, y, rng, SHELL, 0.72);
  return shulkerShell(x, y, rng, SHELL, 0.94);
};

PAINTERS.shulker_bottom = (x, y, rng) => shulkerShell(x, y, rng, [138, 100, 146], 0.9);

PAINTERS.shulker_side = (x, y, rng) => {
  const SHELL: readonly [number, number, number] = [150, 108, 158];
  // 中间那道合缝（盖子与盒身的分界）：上下各压暗一像素，看起来是"盖上的"
  if (y === 6 || y === 9) return shulkerShell(x, y, rng, SHELL, 0.62);
  const half = y < 6 ? 1.06 : 0.96;
  const col = x % 8 === 0 ? 0.9 : 1;
  return shulkerShell(x, y, rng, SHELL, half * col);
};

/**
 * 树苗（批次 75）：一小截茎 + 一坨叶色——**同一套画法、六种叶色**。
 *
 * 与花/草共用"十字面片"的渲染路径，所以只要一张图看得出"这是棵小树"就够：
 * 茎取固定的木色，冠按木材的叶色，边缘带一点噪声起伏（免得六张看起来像同一个色块）。
 */
function saplingPainter(leaf: readonly [number, number, number]): Painter {
  return (x, y, rng): RGBA => {
    // 茎：中间两列、下半截
    if (x >= 7 && x <= 8 && y >= 9) return [124, 96, 62, 255];
    const dx = x - 7.5;
    const dy = (y - 6.2) * 1.15;
    const r = Math.hypot(dx, dy);
    const wobble = 0.74 + (hashString(`sap${Math.round(Math.atan2(dy, dx) * 10)}`) % 40) / 100;
    if (r > 4.7 * wobble) return [0, 0, 0, 0];
    const jitter = rng() * 14 - 7;
    const shade = 0.82 + 0.32 * (1 - r / 6);
    return [
      clamp255(leaf[0] * shade + jitter),
      clamp255(leaf[1] * shade + jitter),
      clamp255(leaf[2] * shade + jitter),
      255,
    ];
  };
}

PAINTERS.oak_sapling = saplingPainter([92, 152, 62]);
PAINTERS.birch_sapling = saplingPainter([132, 178, 96]);
PAINTERS.spruce_sapling = saplingPainter([62, 108, 84]);
PAINTERS.jungle_sapling = saplingPainter([104, 168, 52]);
PAINTERS.acacia_sapling = saplingPainter([122, 158, 70]);
PAINTERS.dark_oak_sapling = saplingPainter([64, 106, 50]);

/**
 * 瓜藤（批次 77）：一根**越长越高**的茎，八个阶段一张图（同一套画法，只有高度与卷须不同）。
 *
 * 与甘蔗/竹子那种 `stalkPainter` 的差别：那两位是"一格一节"，而茎是**一株植物**——
 * 所以要有一条主茎、两片叶子，第 7 阶段再点几个小花苞（"它已经能结果了"的唯一提示）。
 * 结果的茎（`attached_*`）再在顶端画一颗**瓜色**的小果，一眼能看出"这株结过果了"。
 */
function stemPainter(tint: readonly [number, number, number], stage: number): Painter {
  return (x, y, rng): RGBA => {
    const stalk = (color: readonly [number, number, number], scale = 1): RGBA => [
      clamp255(color[0] * scale + (rng() * 12 - 6)),
      clamp255(color[1] * scale + (rng() * 12 - 6)),
      clamp255(color[2] * scale + (rng() * 12 - 6)),
      255,
    ];
    // 主茎：从底部往上，高度随阶段长高（第 0 阶段只有两格高）
    const top = 15 - Math.round((stage / 7) * 8);
    if (x >= 7 && x <= 8 && y >= top && y <= 15) return stalk(tint, 0.92);
    // 两侧的叶子：阶段越大越靠上、越大
    const leafTop = top + 2;
    const spread = 1 + Math.round(stage / 3);
    const dy = y - leafTop;
    if (dy >= 0 && dy <= 1 + spread) {
      const dx = Math.abs(x - 7.5);
      if (dx >= 1 && dx <= 1.5 + spread) return stalk([tint[0] * 1.12, tint[1] * 1.12, tint[2] * 1.12], 1);
    }
    // 第 7 阶段点几个花苞（成熟了，随时会结果）
    if (stage === 7 && (y === top || y === top + 1) && Math.abs(x - 7.5) <= 2) {
      if ((x + y) % 3 === 0) return [clamp255(tint[0] * 1.5), clamp255(tint[1] * 1.35), clamp255(tint[2] * 0.7), 255];
    }
    return [0, 0, 0, 0];
  };
}

/** 结果的茎：茎 + 顶端一颗**瓜色**的小果（原版会朝果实弯，这里用"顶上有一颗果"表达同一件事） */
function attachedStemPainter(stemTint: readonly [number, number, number], fruit: readonly [number, number, number]): Painter {
  const base = stemPainter(stemTint, 7);
  return (x, y, rng): RGBA => {
    if (y <= 5) {
      const r = Math.hypot(x - 7.5, y - 3.2);
      if (r < 2.6) {
        const jitter = rng() * 14 - 7;
        return [clamp255(fruit[0] + jitter), clamp255(fruit[1] + jitter), clamp255(fruit[2] + jitter), 255];
      }
      return [0, 0, 0, 0];
    }
    return base(x, y, rng);
  };
}

/** 南瓜藤偏黄绿、西瓜藤偏青绿（原版两张图就是这个差别） */
const PUMPKIN_STEM_TINT: readonly [number, number, number] = [122, 150, 60];
const MELON_STEM_TINT: readonly [number, number, number] = [96, 156, 74];
for (let stage = 0; stage < 8; stage++) {
  PAINTERS[`pumpkin_stem_stage${stage}`] = stemPainter(PUMPKIN_STEM_TINT, stage);
  PAINTERS[`melon_stem_stage${stage}`] = stemPainter(MELON_STEM_TINT, stage);
}
PAINTERS.attached_pumpkin_stem = attachedStemPainter(PUMPKIN_STEM_TINT, [214, 148, 42]);
PAINTERS.attached_melon_stem = attachedStemPainter(MELON_STEM_TINT, [92, 158, 58]);

/** 瓜类种子（批次 77）：与小麦种子同一套"几粒点阵"，只换颜色（南瓜籽奶白、西瓜籽近黑） */
function seedsPainter(color: readonly [number, number, number]): Painter {
  const dots: readonly (readonly [number, number])[] = [
    [4, 4], [7, 3], [10, 5], [4, 8], [8, 7], [11, 9], [5, 11], [9, 12],
  ];
  return (x, y, rng): RGBA => {
    const jitter = rng() * 14 - 7;
    for (const [sx, sy] of dots) {
      if (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1) {
        return [
          clamp255(color[0] + jitter),
          clamp255(color[1] + jitter),
          clamp255(color[2] + jitter),
          255,
        ];
      }
    }
    return [0, 0, 0, 0];
  };
}

PAINTERS.item_pumpkin_seeds = seedsPainter([236, 224, 186]);
PAINTERS.item_melon_seeds = seedsPainter([62, 58, 44]);

export class TextureAtlas {
  readonly texture: THREE.Texture;
  readonly canvas: HTMLCanvasElement;
  readonly columns: number;
  readonly rows: number;
  /** 贴图平均色缓存（`averageColor` 用，懒算） */
  private readonly averageColors = new Map<string, number>();
  /** 贴图不透明像素占比缓存（`tileOpacity` 用，懒算） */
  private readonly opacities = new Map<string, number>();
  /** 画布像素被**外部**改写（资源包替换）的次数，见 `markTextureChanged` */
  private revisionValue = 0;

  constructor() {
    const columns = ATLAS_COLUMNS;
    const rows = Math.ceil(TILE_ORDER.length / columns);
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE * columns;
    canvas.height = TILE_SIZE * rows;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 绘图上下文');

    const image = ctx.createImageData(canvas.width, canvas.height);
    const data = image.data;

    for (let index = 0; index < TILE_ORDER.length; index++) {
      const name = TILE_ORDER[index]!;
      const painter = PAINTERS[name] ?? noisy(128, 14);
      const rng = makeRng(hashString(name));
      const originX = (index % columns) * TILE_SIZE;
      const originY = Math.floor(index / columns) * TILE_SIZE;
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const [r, g, b, a] = painter(x, y, rng);
          const px = ((originY + y) * canvas.width + originX + x) * 4;
          data[px] = r;
          data[px + 1] = g;
          data[px + 2] = b;
          data[px + 3] = a;
        }
      }
    }
    ctx.putImageData(image, 0, 0);

    this.canvas = canvas;
    this.columns = columns;
    this.rows = rows;

    const texture = new THREE.CanvasTexture(canvas);
    // ⚠️ three 的 Texture 默认 flipY = true，上传时会整个垂直翻转，
    // 于是 v=0 对应画布的**最后一行**，与 uv() 里「v=0 是画布顶部」的假设正好相反。
    //
    // 单行图集时这个错位被掩盖了（首行与末行是同一行），只导致每张贴图上下镜像；
    // 改成网格后立刻暴露：石头（第 0 行）采到了最后一行的 stained_glass_yellow，
    // 整片地面变成带边框网格的亮黄色。关掉 flipY 才能让 v=0 真正对应画布顶部。
    texture.flipY = false;
    texture.magFilter = THREE.NearestFilter;
    // 缩小方向走 mipmap（批次 237）：这是"远处干净、走动时不闪"的来源。
    // 放大方向仍然是 Nearest —— 近处方块的像素风不能糊。
    //
    // 图集高度永远是 16 的倍数（`TILE_SIZE * rows`），所以 0~4 级的每张 tile
    // 都还是整数像素（16→8→4→2→1），盒式降采样**不会跨 tile 混色**；
    // 更高层级在着色器里被 LOD 封顶挡住（见 `VoxelMaterial` 的 `textureGrad`）。
    // 内存代价：整条 mip 链只多 1/3（256×1008 ≈ 1.0MB → 1.34MB）。
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // ⚠️ 必须是 NoColorSpace（按原始数据采样），不能标成 SRGBColorSpace。
    //
    // 原因：体素用的是自定义 ShaderMaterial，three 不会替它做
    // 「线性 → 输出色彩空间」的转换。若把贴图标成 sRGB，texture2D() 返回的是
    // **线性化后**的值（0.58 → 0.29），而我们又把这个线性值原样写进 sRGB 帧缓冲，
    // 结果所有方块整体暗一大截——实测草地 148 只渲染出 74、石砖 128 只渲染出 55，
    // 正好是 2.2 次幂的差距。
    //
    // 标成 NoColorSpace 后采样值就是创作者写入的 sRGB 值，光照乘法也在 sRGB 空间进行，
    // 这正是原版体素的做法。这个 bug 靠 tools/pixel-probe.mjs 取像素亮度才定位到，
    // 肉眼只会觉得"整体偏暗"，很容易误判成光照或 AO 的问题。
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    this.texture = texture;
  }

  /**
   * 画布像素的**版本号**：任何外部改写（资源包替换贴图）都必须 +1。
   *
   * UI 侧会按图集像素拼图标（等轴方块图标），拼好的结果要缓存；
   * 缓存失效的判据只能是这个计数器——`texture.needsUpdate` 是给 three 用的，
   * UI 读不到它，也不能拿"画布尺寸没变"当没变（资源包换的就是像素）。
   */
  get revision(): number {
    return this.revisionValue;
  }

  /**
   * 图集像素被外部改写后调用：让 three 重新上传纹理，并让所有"按像素派生"的缓存失效。
   *
   * `averageColors` 也是按像素算的（资源包换完贴图，破坏粒子的颜色必须跟着变），
   * 两者失效的时机一模一样，所以合并在这一处，避免以后加缓存时漏掉某一份。
   */
  markTextureChanged(): void {
    this.revisionValue++;
    this.averageColors.clear();
    this.opacities.clear();
    this.texture.needsUpdate = true;
  }

  /** 贴图在图集中的列号（供 UI 从图集裁切图标） */
  tileIndex(tile: string): number {
    return TILE_INDEX.get(tile) ?? 0;
  }

  /**
   * 贴图在图集中的**完整**起点（未内缩）。
   *
   * 贪心网格化会把多个相邻的同材质面合并成一个大四边形，此时贴图必须沿面
   * 平铺而不是拉伸。顶点属性里带上「完整起点」，着色器再用 `fract(平铺坐标)`
   * 把插值结果映射回这一张贴图内部，就能在不越过贴图边界（不渗色）的前提下
   * 任意次平铺。因此这里返回的是未内缩的起点，内缩交给着色器的 uniform 做。
   */
  tileOrigin(tile: string): [number, number] {
    const index = TILE_INDEX.get(tile) ?? 0;
    const cols = this.columns;
    const rows = this.rows;
    return [(index % cols) / cols, Math.floor(index / cols) / rows];
  }

  /** 单张贴图占图集的 UV 尺寸（所有贴图相同） */
  get tileSpan(): [number, number] {
    return [1 / this.columns, 1 / this.rows];
  }

  /** 归一化的半像素内缩，着色器用它把采样点限制在贴图内部 */
  get tileInset(): number {
    return 0.5 / TILE_SIZE;
  }

  /** 返回贴图在图集中的 [u0, v0, u1, v1]，已做半像素内缩以避免图集渗色 */
  uv(tile: string): [number, number, number, number] {
    const index = TILE_INDEX.get(tile) ?? 0;
    const cols = this.columns;
    const rows = this.rows;
    const col = index % cols;
    const row = Math.floor(index / cols);

    // 半像素内缩，避免相邻贴图渗色
    const insetU = 0.5 / (TILE_SIZE * cols);
    const insetV = 0.5 / (TILE_SIZE * rows);

    const u0 = col / cols + insetU;
    const u1 = (col + 1) / cols - insetU;
    const v0 = row / rows + insetV;
    const v1 = (row + 1) / rows - insetV;
    return [u0, v0, u1, v1];
  }

  /**
   * 贴图的平均色（0xRRGGBB，已缓存）。
   *
   * 破坏粒子用它给碎块染色 —— 挖草是绿的、挖沙是黄的、挖石头是灰的，
   * 不用为每个方块单独维护一份颜色表。透明像素（cross 类贴图有大片透明）不参与平均，
   * 否则草会算出接近黑灰的颜色。
   */
  averageColor(tile: string): number {
    const cached = this.averageColors.get(tile);
    if (cached !== undefined) return cached;

    const index = TILE_INDEX.get(tile) ?? 0;
    const originX = (index % this.columns) * TILE_SIZE;
    const originY = Math.floor(index / this.columns) * TILE_SIZE;

    let color = 0x808080;
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      const data = ctx.getImageData(originX, originY, TILE_SIZE, TILE_SIZE).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! < 8) continue;
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        count++;
      }
      if (count > 0) {
        color = ((Math.round(r / count) << 16) | (Math.round(g / count) << 8) | Math.round(b / count)) >>> 0;
      }
    }

    this.averageColors.set(tile, color);
    return color;
  }

  /**
   * 贴图里"不透明像素"的占比（0..1，已缓存）。
   *
   * 拼等轴方块图标时用它判断**这一面是不是实心的**：实心面要先垫一层平均色，
   * 盖住两个面交界处的抗锯齿细缝；而玻璃 / 树叶 / 刷怪笼这种带透明洞的贴图
   * 一旦垫上平均色就会变成一整块实心方块——那比细缝难看得多。
   */
  tileOpacity(tile: string): number {
    const cached = this.opacities.get(tile);
    if (cached !== undefined) return cached;

    const index = TILE_INDEX.get(tile) ?? 0;
    const originX = (index % this.columns) * TILE_SIZE;
    const originY = Math.floor(index / this.columns) * TILE_SIZE;

    let ratio = 1;
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      const data = ctx.getImageData(originX, originY, TILE_SIZE, TILE_SIZE).data;
      let solid = 0;
      // 判据与 `averageColor` 保持一致（alpha < 8 视为全透明）
      for (let i = 3; i < data.length; i += 4) if (data[i]! >= 8) solid++;
      ratio = solid / (TILE_SIZE * TILE_SIZE);
    }

    this.opacities.set(tile, ratio);
    return ratio;
  }

  /** 贴图在图集画布上的像素左上角（UI 用 drawImage 裁切图标） */
  tileSource(tile: string): { x: number; y: number } {
    const index = TILE_INDEX.get(tile) ?? 0;
    return {
      x: (index % this.columns) * TILE_SIZE,
      y: Math.floor(index / this.columns) * TILE_SIZE,
    };
  }
}
