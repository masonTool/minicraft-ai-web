/**
 * 物品栏里的玩家预览（批次 141，H19 皮肤预览占位）。
 *
 * Wiki：「玩家的皮肤也在此显示」。本项目第三人称是方块拼小人（`PlayerRenderer`），
 * 还没有可换的皮肤贴图（TASKS F7）——所以这里用**同一套色板**画一张正面 2D 剪影，
 * 盔甲槽有东西时用图集平均色盖一层，布局上对得上原版，不假装有真皮肤。
 */

import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { itemIconTile } from '../core/registry/items.ts';

/** 与 `PlayerRenderer` 同源，切换人称时不会"换个人" */
const SKIN = '#dc9a6b';
const HAIR = '#2f2016';
const SHIRT = '#00a8a8';
const PANTS = '#3b4bb5';
const SHOES = '#4a4a52';
const EYE = '#1b2a44';

export interface PlayerPreviewArmor {
  /** 头盔 / 胸甲 / 护腿 / 靴子 的物品 id；空槽为 null */
  helmet: number | null;
  chest: number | null;
  legs: number | null;
  boots: number | null;
}

function hexColor(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

function armorTint(atlas: TextureAtlas | null, itemId: number | null): string | null {
  if (itemId === null || !atlas) return null;
  return hexColor(atlas.averageColor(itemIconTile(itemId)));
}

/**
 * 在 canvas 上画正面玩家剪影。
 * @param widthCss 显示宽度（逻辑像素）；背板按 2× 画以减少糊边
 */
export function drawPlayerPreview(
  canvas: HTMLCanvasElement,
  armor: PlayerPreviewArmor = { helmet: null, chest: null, legs: null, boots: null },
  atlas: TextureAtlas | null = null,
  widthCss = 48,
  /** 外观（批次 187）：不给就用出厂配色，与 3D 预览/第三人称一致 */
  palette: { skin: number; shirt: number; pants: number } | null = null,
): void {
  const skinColor = palette ? hexColor(palette.skin) : SKIN;
  const shirtColor = palette ? hexColor(palette.shirt) : SHIRT;
  const pantsColor = palette ? hexColor(palette.pants) : PANTS;
  const scale = 2;
  const w = Math.max(1, Math.round(widthCss * scale));
  const h = Math.round(w * 2.1);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);

  const u = w / 16; // 16 格宽的虚拟网格
  const fill = (color: string, x: number, y: number, bw: number, bh: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x * u), Math.round(y * u), Math.round(bw * u), Math.round(bh * u));
  };

  // 腿（左 / 右）
  const legColor = armorTint(atlas, armor.legs) ?? pantsColor;
  fill(legColor, 4, 20, 3, 8);
  fill(legColor, 9, 20, 3, 8);
  // 鞋
  const bootColor = armorTint(atlas, armor.boots) ?? SHOES;
  fill(bootColor, 4, 27, 3, 2);
  fill(bootColor, 9, 27, 3, 2);

  // 身
  const bodyColor = armorTint(atlas, armor.chest) ?? shirtColor;
  fill(bodyColor, 4, 10, 8, 10);
  // 臂
  fill(bodyColor, 1, 10, 3, 9);
  fill(bodyColor, 12, 10, 3, 9);
  // 手（露出肤色）
  fill(skinColor, 1, 19, 3, 2);
  fill(skinColor, 12, 19, 3, 2);

  // 头
  fill(skinColor, 5, 2, 6, 6);
  fill(HAIR, 5, 1, 6, 2);
  fill(EYE, 6, 4, 1, 1);
  fill(EYE, 9, 4, 1, 1);
  const helm = armorTint(atlas, armor.helmet);
  if (helm) fill(helm, 4, 1, 8, 4);
}
