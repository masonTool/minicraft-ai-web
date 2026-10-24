/**
 * 跳一跳的**色板与三面明暗**（批次 20261024-0415，`[跳3]`）
 *
 * 原版是「每局一组莫兰迪色」：整屏一个纯色背景（上亮下暗的极轻渐变）+ 3~4 个高饱和
 * 纯色方块，方块本身没有任何贴图。这套东西与 MC 图集（草/雪/沙漠/石头四种群系换皮）
 * 不兼容，所以整块换掉——颜色只在这里定义，渲染层不许再写死色值。
 *
 * 色值全部来自 `.continue/notes/jump-original.md` §3 与 §6，是从参考图上量出来的：
 *
 *  · 背景：6 组（冷灰紫 / 中性灰 / 天蓝 / 橄榄 / 暖橙 / 淡黄），每组给上下两个端点，
 *    因为原版背景不是纯色而是一条很轻的竖直渐变——**很轻**：参考图 02 顶底实测
 *    只差 ~1%（211,215,224 → 209,212,221）。第一版按"顶亮底暗 10~20%"填，
 *    横屏矮屏下整屏看起来像蒙了层灰，与参考图差得最明显。
 *  · 方块：8 个高饱和纯色，每局取 3~4 个轮换使用。
 *  · 三面明暗：顶 1.00 / 左 0.775 / 右 0.93 —— 注意是**左暗右亮**，
 *    交接文档里写的"左 0.86 右 0.72"是反的（`[跳1]` 用两块独立的方块互证过）。
 *
 * 明暗不是用灯光做的：原版方块是完全哑光的纯色，用 `MeshBasicMaterial` + 顶点色直接
 * 烘焙三面亮度更准也更省——省掉一遍阴影贴图，也就不会出现"打光角度差 5° 就变味"。
 */

export interface JumpBackground {
  /** 屏幕顶部的颜色 */
  readonly top: string;
  /** 屏幕底部的颜色 */
  readonly bottom: string;
}

export interface JumpPalette {
  readonly id: string;
  readonly background: JumpBackground;
  /** 这一局轮换使用的方块色（3~4 个） */
  readonly blocks: readonly string[];
}

/**
 * 全部方块色（8 色，色值是从参考图**逐点取样**的，括号里是实测 rgb）。
 *
 * ⚠️ 这里曾经有一个近白 `#F7F6FB`（01 首页的白块）——它被从轮换里拿掉了：
 * 原版那块白方块的背景是**绿色**首页，而在"浅灰紫"的关卡背景上，白方块几乎与背景同亮，
 * 截图里读起来就是"没上色"。取色不能只看色值，要看它与背景的关系。
 */
export const BLOCK_COLORS = [
  '#FCF366', // 黄（02 顶面 rgb(252,243,102)）
  '#F77E3F', // 橙（02 顶面 rgb(247,126,63)）
  '#BEEF46', // 柠檬绿（02 顶面 rgb(190,239,70)）
  '#EE7467', // 珊瑚红（06 魔方红）
  '#6A9BF9', // 天蓝（06 魔方蓝）
  '#659468', // 低饱和绿（03 绿块 rgb(101,148,104)，只出现在少数几局）
  '#717171', // 中性灰（03 灰块附近）
  '#585A60', // 深灰（01 深色块）
] as const;

/**
 * 6 组背景（上下端点 = 参考图里同一条竖线上的两处采样）。
 *
 * **每组至少 3 个高饱和色**：这是"原版观感"最容易被弄丢的一条——只要一局里出现
 * 两个灰/低饱和块，整屏就"洗白"了（实测过：灰 + 近白 + 低饱和绿 + 黄 那一局，
 * 截图与原版差别最大）。中性灰与深灰仍然保留，但每局最多一个。
 */
export const JUMP_PALETTES: readonly JumpPalette[] = [
  {
    id: 'mist',
    background: { top: '#DAD8E3', bottom: '#D3D1DC' },
    blocks: ['#FCF366', '#F77E3F', '#BEEF46', '#717171'],
  },
  {
    id: 'ash',
    background: { top: '#CECED8', bottom: '#C7C7D1' },
    blocks: ['#F77E3F', '#BEEF46', '#EE7467', '#585A60'],
  },
  {
    id: 'sky',
    background: { top: '#D0DDEF', bottom: '#C9D6E8' },
    // 柠檬绿在浅蓝背景上只差 0.037（糊进背景），这一局换成珊瑚红
    blocks: ['#6A9BF9', '#FCF366', '#F77E3F', '#EE7467'],
  },
  {
    id: 'olive',
    background: { top: '#C0C6A0', bottom: '#B9BF99' },
    blocks: ['#BEEF46', '#EE7467', '#FCF366', '#659468'],
  },
  {
    id: 'dusk',
    background: { top: '#FFD799', bottom: '#F8D092' },
    blocks: ['#F77E3F', '#FCF366', '#6A9BF9', '#585A60'],
  },
  {
    id: 'pale',
    background: { top: '#FEF7A6', bottom: '#F7F09F' },
    // 黄块在淡黄背景上只有 0.03 的亮度差（糊进背景），这一局不给黄
    blocks: ['#EE7467', '#6A9BF9', '#BEEF46', '#717171'],
  },
];

/** 三面亮度（顶 / 屏幕左 / 屏幕右），规格表 §3 实测值 */
export const FACE_SHADE = {
  top: 1,
  left: 0.775,
  right: 0.93,
} as const;

/** 阴影：偏冷的紫灰，不是纯黑（04 的暖橙背景上最明显） */
export const SHADOW_COLOR = '#3A3546';
/** 阴影核心浓度（02 实测：背景 209 → 阴影核心 137 ≈ 暗 35%） */
export const SHADOW_OPACITY = 0.32;

const HALF = Math.SQRT1_2;

/**
 * 按法线算三面明暗。
 *
 * 把「顶 / 左 / 右」三个实测亮度反解成一个平滑函数：水平分量按 45° 斜向线性插值，
 * 于是立方体的两个侧面正好落在 0.775 / 0.93 上，圆柱的侧面则是一条从 0.775 到 0.93
 * 的连续渐变（原版的圆柱确实是渐变的，把它当成两个色阶就会看到硬边）。
 *
 * 光源方向因此也被钉死了：**来自世界 +x/−z 一侧**（屏幕右上方偏后），
 * 与阴影投向左下（世界 −x/+z）互为镜像关系。
 */
export function shadeForNormal(nx: number, ny: number, nz: number): number {
  const horizontal = Math.hypot(nx, nz);
  const directional = horizontal > 1e-6 ? (HALF * (nx - nz)) / horizontal : 0;
  const mid = (FACE_SHADE.left + FACE_SHADE.right) / 2;
  // 除以 HALF：让 dot(法线, 光方向) = ±HALF 时正好各差 (right − left) / 2
  const amp = (FACE_SHADE.right - FACE_SHADE.left) / 2 / HALF;
  const top = FACE_SHADE.top - mid;
  const shade = mid + amp * directional + top * Math.max(0, ny);
  return Math.min(1.2, Math.max(0.2, shade));
}

/** 按种子取一局色板（同 seed 同色板：重开一局换色，但截图对比要可复现） */
export function paletteForSeed(seed: number): JumpPalette {
  const index = Math.abs(Math.floor(Number.isFinite(seed) ? seed : 0)) % JUMP_PALETTES.length;
  return JUMP_PALETTES[index]!;
}

/** 第 index 个方块用哪个颜色（轮换；负下标也不越界） */
export function blockColorAt(palette: JumpPalette, index: number): string {
  const list = palette.blocks;
  if (list.length === 0) return BLOCK_COLORS[0];
  const raw = Math.floor(Number.isFinite(index) ? index : 0);
  // 负数也要落在 [0, len) 里：-1 = 最后一个（用取模再取模，不用 abs）
  const safe = ((raw % list.length) + list.length) % list.length;
  return list[safe]!;
}
