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
import { DYE_COLORS, TERRACOTTA_BASE, WOOD_TYPES, terracottaColor } from '../core/registry/colors.ts';

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
 * 双尺度噪声：4×4 的粗粒起伏 + 逐像素的细粒噪点。
 * 单用 2×2 聚簇会在草地上形成明显的棋盘格，双尺度叠加才接近原版观感。
 */
function layered(base: number, coarse: number, fine: number, tint: [number, number, number] = [1, 1, 1]): Painter {
  const coarseCache = new Map<number, number>();
  return (x, y, rng) => {
    const key = (y >> 2) * 4 + (x >> 2);
    let c = coarseCache.get(key);
    if (c === undefined) {
      c = rng();
      coarseCache.set(key, c);
    }
    const v = base + (c * 2 - 1) * coarse + (rng() * 2 - 1) * fine;
    return [clamp255(v * tint[0]), clamp255(v * tint[1]), clamp255(v * tint[2]), 255];
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

/** 树叶：颗粒 + 少量镂空（alphaTest 会把这些洞裁掉） */
function leavesPainter(base: readonly [number, number, number], alpha = 255): Painter {
  return (x, y, rng) => {
    const v = 1 + (rng() * 0.34 - 0.17);
    const hole = hashString(`leaf${x},${y}`) % 11 === 0;
    return [clamp255(base[0] * v), clamp255(base[1] * v), clamp255(base[2] * v), hole ? 150 : alpha];
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
  water: (_x, _y, rng) => {
    const v = 210 + rng() * 30;
    // 半透明：让海底纹理透出来（对应原版水的透明度观感）
    return [clamp255(v * 0.3), clamp255(v * 0.58), clamp255(v), 168];
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

// 染色玻璃：16 张由配色表生成（玻璃板复用同一张，靠几何做薄片）
for (const color of DYE_COLORS) {
  PAINTERS[`stained_glass_${color.name}`] = stainedGlassPainter(color.rgb);
}

// 陶瓦与混凝土：33 张贴图由配色表生成
PAINTERS.terracotta = terracottaPainter(TERRACOTTA_BASE);
for (const color of DYE_COLORS) {
  PAINTERS[`terracotta_${color.name}`] = terracottaPainter(terracottaColor(color.rgb));
  PAINTERS[`concrete_${color.name}`] = concretePainter(color.rgb);
}

// 羊毛与染料：16 色按配色表批量生成，避免手写 32 份几乎相同的代码
for (const color of DYE_COLORS) {
  PAINTERS[`wool_${color.name}`] = woolPainter(color.rgb);
  PAINTERS[`dye_${color.name}`] = dyePainter(color.rgb);
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

/** 梯子：两侧立杆 + 若干横档 */
PAINTERS.ladder = (x, y, rng) => {
  const rail = x <= 2 || x >= 13;
  const rung = y % 4 === 1 || y % 4 === 2;
  if (!rail && !rung) return [0, 0, 0, 0];
  const shade = rail ? 1.0 : 0.84;
  const v = (142 + (rng() * 14 - 7)) * shade;
  return [clamp255(v * 1.06), clamp255(v * 0.78), clamp255(v * 0.44), 255];
};

/** 木门：木板底 + 竖边框 + 门把手 */
PAINTERS.oak_door = (x, y, rng) => {
  const base = layered(146, 6, 7, [1.05, 0.8, 0.48])(x, y, rng);
  // 上下横档与左右竖框
  if (y <= 1 || y >= 14 || x <= 1 || x >= 14 || (y >= 5 && y <= 6)) {
    const v = 128 + (rng() * 10 - 5);
    return [clamp255(v * 1.02), clamp255(v * 0.74), clamp255(v * 0.42), 255];
  }
  // 门把手
  if (x >= 11 && x <= 12 && y >= 8 && y <= 9) {
    const v = 178 + rng() * 24;
    return [clamp255(v), clamp255(v * 0.94), clamp255(v * 0.66), 255];
  }
  return base;
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
PAINTERS.magma = MAGMA_PAINTER;
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
/** 末地传送门框架：淡绿石框 + 中央的黄色"眼睛" */
const END_PORTAL_FRAME_PAINTER: Painter = (x, y, rng) => {
  const eye = x >= 5 && x <= 10 && y >= 5 && y <= 10;
  if (eye) {
    const v = 1 + (rng() * 0.1 - 0.05);
    return [clamp255(226 * v), clamp255(212 * v), clamp255(96 * v), 255];
  }
  const v = 0.94 + (rng() * 0.12 - 0.06);
  return [clamp255(158 * v), clamp255(174 * v), clamp255(132 * v), 255];
};
/** 末地传送门：深紫黑底 + 星点（自发光 15） */
const END_PORTAL_PAINTER: Painter = (x, y, rng) => {
  const star = hashString(`ep${x},${y}`) % 17 === 0;
  if (star) return [clamp255(226), clamp255(206), clamp255(255), 255];
  const v = 0.9 + (rng() * 0.16 - 0.08);
  return [clamp255(22 * v), clamp255(8 * v), clamp255(38 * v), 255];
};

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
PAINTERS.observer_top = OBSERVER_TOP_PAINTER;
PAINTERS.observer_side = OBSERVER_SIDE_PAINTER;

export class TextureAtlas {
  readonly texture: THREE.Texture;
  readonly canvas: HTMLCanvasElement;
  readonly columns: number;
  readonly rows: number;
  /** 贴图平均色缓存（`averageColor` 用，懒算） */
  private readonly averageColors = new Map<string, number>();

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
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
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

  /** 贴图在图集画布上的像素左上角（UI 用 drawImage 裁切图标） */
  tileSource(tile: string): { x: number; y: number } {
    const index = TILE_INDEX.get(tile) ?? 0;
    return {
      x: (index % this.columns) * TILE_SIZE,
      y: Math.floor(index / this.columns) * TILE_SIZE,
    };
  }
}
