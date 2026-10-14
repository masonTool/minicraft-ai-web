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

export const TILE_SIZE = 16;
/**
 * 图集列数。
 *
 * 贴图数量已经超过 160，单行排布在 256 张时会撞上移动 GPU 常见的 4096 纹理上限，
 * 所以改成 16 列的网格；新增贴图只会让画布变高，不会变宽。
 */
const ATLAS_COLUMNS = 16;

/** 图集中的贴图顺序（索引即图集列号，必须稳定） */
export const TILE_ORDER = [
  'stone',
  'dirt',
  'grass_top',
  'grass_side',
  'sand',
  'oak_log_side',
  'oak_log_top',
  'oak_leaves',
  'oak_planks',
  'spruce_log_side',
  'spruce_log_top',
  'spruce_leaves',
  'spruce_planks',
  'birch_log_side',
  'birch_log_top',
  'birch_leaves',
  'birch_planks',
  'jungle_log_side',
  'jungle_log_top',
  'jungle_leaves',
  'jungle_planks',
  'acacia_log_side',
  'acacia_log_top',
  'acacia_leaves',
  'acacia_planks',
  'dark_oak_log_side',
  'dark_oak_log_top',
  'dark_oak_leaves',
  'dark_oak_planks',
  'cobblestone',
  'bedrock',
  'water',
  'glass',
  'deepslate',
  'granite',
  'diorite',
  'andesite',
  'tuff',
  'calcite',
  'gravel',
  'clay',
  'sandstone',
  'sandstone_top',
  'snow',
  'ice',
  'packed_ice',
  'obsidian',
  'lava',
  'glowstone',
  'coal_ore',
  'iron_ore',
  'copper_ore',
  'gold_ore',
  'redstone_ore',
  'lapis_ore',
  'diamond_ore',
  'emerald_ore',
  'deepslate_coal_ore',
  'deepslate_iron_ore',
  'deepslate_copper_ore',
  'deepslate_gold_ore',
  'deepslate_redstone_ore',
  'deepslate_lapis_ore',
  'deepslate_diamond_ore',
  'deepslate_emerald_ore',
  'item_coal',
  'item_raw_iron',
  'item_raw_copper',
  'item_raw_gold',
  'item_redstone',
  'item_lapis',
  'item_diamond',
  'item_emerald',
  'item_stick',
  'crafting_table_top',
  'crafting_table_side',
  'furnace_top',
  'furnace_side',
  'chest_top',
  'chest_side',
  'item_iron_ingot',
  'item_gold_ingot',
  'item_copper_ingot',
  'item_charcoal',
  'wool_white',
  'wool_orange',
  'wool_magenta',
  'wool_light_blue',
  'wool_yellow',
  'wool_lime',
  'wool_pink',
  'wool_gray',
  'wool_light_gray',
  'wool_cyan',
  'wool_purple',
  'wool_blue',
  'wool_brown',
  'wool_green',
  'wool_red',
  'wool_black',
  'stone_bricks',
  'chiseled_stone_bricks',
  'smooth_stone',
  'polished_granite',
  'polished_diorite',
  'polished_andesite',
  'deepslate_bricks',
  'chiseled_deepslate',
  'bricks',
  'polished_deepslate',
  'dye_white',
  'dye_orange',
  'dye_magenta',
  'dye_light_blue',
  'dye_yellow',
  'dye_lime',
  'dye_pink',
  'dye_gray',
  'dye_light_gray',
  'dye_cyan',
  'dye_purple',
  'dye_blue',
  'dye_brown',
  'dye_green',
  'dye_red',
  'dye_black',
  'item_brick',
  'item_clay_ball',
  'torch',
  'ladder',
  'oak_door',
  'terracotta',
  'terracotta_white',
  'terracotta_orange',
  'terracotta_magenta',
  'terracotta_light_blue',
  'terracotta_yellow',
  'terracotta_lime',
  'terracotta_pink',
  'terracotta_gray',
  'terracotta_light_gray',
  'terracotta_cyan',
  'terracotta_purple',
  'terracotta_blue',
  'terracotta_brown',
  'terracotta_green',
  'terracotta_red',
  'terracotta_black',
  'concrete_white',
  'concrete_orange',
  'concrete_magenta',
  'concrete_light_blue',
  'concrete_yellow',
  'concrete_lime',
  'concrete_pink',
  'concrete_gray',
  'concrete_light_gray',
  'concrete_cyan',
  'concrete_purple',
  'concrete_blue',
  'concrete_brown',
  'concrete_green',
  'concrete_red',
  'concrete_black',
  'mossy_cobblestone',
  'mossy_stone_bricks',
  'cracked_stone_bricks',
  'cracked_deepslate_bricks',
  'cobbled_deepslate',
  'chiseled_sandstone',
  'cut_sandstone',
  'smooth_sandstone',
  'stained_glass_white',
  'stained_glass_orange',
  'stained_glass_magenta',
  'stained_glass_light_blue',
  'stained_glass_yellow',
  'stained_glass_lime',
  'stained_glass_pink',
  'stained_glass_gray',
  'stained_glass_light_gray',
  'stained_glass_cyan',
  'stained_glass_purple',
  'stained_glass_blue',
  'stained_glass_brown',
  'stained_glass_green',
  'stained_glass_red',
  'stained_glass_black',
] as const;

export type TileName = (typeof TILE_ORDER)[number];

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

PAINTERS.item_brick = (x, y, rng) => {
  // 小砖块：红棕色矩形 + 一点高光
  if (x < 3 || x > 12 || y < 5 || y > 11) return [0, 0, 0, 0];
  const highlight = y <= 6 ? 1.14 : 0.94;
  const v = highlight + (rng() * 0.1 - 0.05);
  return [clamp255(150 * v), clamp255(84 * v), clamp255(66 * v), 255];
};

export class TextureAtlas {
  readonly texture: THREE.Texture;
  readonly canvas: HTMLCanvasElement;
  readonly columns: number;
  readonly rows: number;

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

  /** 贴图在图集画布上的像素左上角（UI 用 drawImage 裁切图标） */
  tileSource(tile: string): { x: number; y: number } {
    const index = TILE_INDEX.get(tile) ?? 0;
    return {
      x: (index % this.columns) * TILE_SIZE,
      y: Math.floor(index / this.columns) * TILE_SIZE,
    };
  }
}
