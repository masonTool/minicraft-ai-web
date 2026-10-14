/**
 * 程序化纹理图集
 *
 * 为什么不用原版贴图：Mojang 的材质资源受版权保护，不能随项目分发。
 * 因此这里按原版配色风格在运行时用 Canvas 生成 16×16 的像素贴图，
 * 打包成一个横向图集（GPU 只上传 1 张纹理，保证批渲染效率）。
 *
 * P9 会接入资源包（.mcpack）加载，届时官方材质由玩家自行提供。
 */

import * as THREE from 'three';

export const TILE_SIZE = 16;

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
  'cobblestone',
  'bedrock',
  'water',
  'glass',
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

const PAINTERS: Record<string, Painter> = {
  stone: layered(128, 10, 8),
  cobblestone: (x, y, rng) => {
    // 大块鹅卵石：按 4×4 分块取随机灰阶，块间留暗缝
    const key = (y >> 2) * 4 + (x >> 2);
    const g = 100 + (hashString('cob' + key) % 60);
    const edge = x % 4 === 0 || y % 4 === 0 ? -18 : 0;
    const v = g + edge + (rng() * 10 - 5);
    return [clamp255(v), clamp255(v), clamp255(v), 255];
  },
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
  oak_log_side: (x, _y, rng) => {
    const streak = Math.sin(x * 1.7) * 10;
    const v = 108 + streak + (rng() * 14 - 7);
    return [clamp255(v * 1.25), clamp255(v * 0.95), clamp255(v * 0.6), 255];
  },
  oak_log_top: (x, y, rng) => {
    const cx = x - 7.5;
    const cy = y - 7.5;
    const d = Math.sqrt(cx * cx + cy * cy);
    const ring = Math.sin(d * 2.4) * 14;
    const v = 140 + ring + (rng() * 12 - 6);
    return [clamp255(v * 1.2), clamp255(v * 0.92), clamp255(v * 0.58), 255];
  },
  oak_leaves: (x, y, rng) => {
    const v = 112 + (rng() * 40 - 20);
    // 少量"空洞"表现树叶的疏密
    const hole = hashString(`leaf${x},${y}`) % 11 === 0;
    return [clamp255(v * 0.5), clamp255(v * 0.95), clamp255(v * 0.35), hole ? 150 : 255];
  },
  oak_planks: (x, y, rng) => {
    const plankRow = y % 4 === 3 ? -22 : 0;
    const seam = (x + (Math.floor(y / 4) % 2) * 8) % 8 === 0 ? -10 : 0;
    const v = 150 + plankRow + seam + (rng() * 12 - 6);
    return [clamp255(v * 1.05), clamp255(v * 0.82), clamp255(v * 0.5), 255];
  },
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
};

export class TextureAtlas {
  readonly texture: THREE.Texture;
  readonly canvas: HTMLCanvasElement;
  readonly columns: number;

  constructor() {
    const columns = TILE_ORDER.length;
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE * columns;
    canvas.height = TILE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 绘图上下文');

    const image = ctx.createImageData(canvas.width, canvas.height);
    const data = image.data;

    for (let col = 0; col < columns; col++) {
      const name = TILE_ORDER[col]!;
      const painter = PAINTERS[name] ?? noisy(128, 14);
      const rng = makeRng(hashString(name));
      // 每个 tile 独立一份缓存（clustered 用）
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const [r, g, b, a] = painter(x, y, rng);
          const px = (y * canvas.width + col * TILE_SIZE + x) * 4;
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

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.texture = texture;
  }

  /** 返回贴图在图集中的 [u0, v0, u1, v1]，已做半像素内缩以避免图集渗色 */
  uv(tile: string): [number, number, number, number] {
    const index = TILE_INDEX.get(tile) ?? 0;
    const cols = this.columns;
    const insetU = 0.5 / (TILE_SIZE * cols);
    const insetV = 0.5 / TILE_SIZE;
    const u0 = index / cols + insetU;
    const u1 = (index + 1) / cols - insetU;
    const v0 = 0 + insetV;
    const v1 = 1 - insetV;
    return [u0, v0, u1, v1];
  }
}
