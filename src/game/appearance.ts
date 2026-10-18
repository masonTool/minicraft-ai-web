/**
 * 角色外观调色板（批次 187，用户："想创建角色、把他搞得漂亮一点"）
 *
 * 为什么先做"档位"而不是自由取色：
 *  - 这个模型是**方块拼小人 + 平均色**（没有皮肤贴图），自由取色在小尺寸下
 *    很容易调出糊成一片的配色；给几档"预设"既好看又好回滚。
 *  - 以后真做皮肤贴图时，这一层就是"贴图 id"的替身，界面不用改。
 *
 * 这里只有**纯数据 + 纯函数**：设置界面、第三人称模型、背包 3D 预览三处共用，
 * 离线测试也能直接钉住"默认外观与原来完全一致"（老存档不该突然换个人）。
 */

/** 肤色 6 档（浅 → 深）；第 1 档是原来的 `#dc9a6b` */
export const SKIN_TONES = [0xf0c8a0, 0xdc9a6b, 0xc68642, 0x8d5524, 0xa1662f, 0x5c3317] as const;
export const SKIN_TONE_LABELS = ['白皙', '小麦', '古铜', '深棕', '橄榄', '乌木'] as const;

/** 上衣 6 色；第 0 档是原来的青色 `#00a8a8` */
export const SHIRT_COLORS = [0x00a8a8, 0xb33a3a, 0x3b5bb5, 0x3f8f45, 0xc9a227, 0x7a4bb5] as const;
export const SHIRT_COLOR_LABELS = ['青', '红', '蓝', '绿', '黄', '紫'] as const;

/** 裤子 6 色；第 0 档是原来的靛蓝 `#3b4bb5` */
export const PANTS_COLORS = [0x3b4bb5, 0x2f2f38, 0x6b4a2f, 0x2f6b4a, 0x8a8a92, 0x5a2f6b] as const;
export const PANTS_COLOR_LABELS = ['靛蓝', '炭黑', '皮革棕', '墨绿', '石灰', '暗紫'] as const;

/** 设置里存的是**下标**（存档小、加一档不会让旧档失效） */
export interface AppearanceSettings {
  skinTone: number;
  shirtColor: number;
  pantsColor: number;
}

/** 解析后的真实颜色（渲染层只认这个） */
export interface AppearancePalette {
  skin: number;
  shirt: number;
  pants: number;
}

/** 默认外观 = 批次 141/185 那个小人的原配色，老存档读进来不会"换个人" */
export const DEFAULT_APPEARANCE: AppearanceSettings = { skinTone: 1, shirtColor: 0, pantsColor: 0 };

/**
 * 把任意输入夹到合法下标。
 * 存档是用户可改的（也可以被旧版本写坏），这里对 NaN / 越界 / 小数一律回退默认。
 */
export function appearanceIndex(value: unknown, length: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const index = Math.trunc(n);
  if (index < 0 || index >= length) return fallback;
  return index;
}

/** 设置 → 颜色。缺字段/坏值都回退到默认档，渲染层不需要再判空 */
export function paletteOf(settings: Partial<AppearanceSettings> | null | undefined): AppearancePalette {
  const skinTone = appearanceIndex(settings?.skinTone, SKIN_TONES.length, DEFAULT_APPEARANCE.skinTone);
  const shirtColor = appearanceIndex(settings?.shirtColor, SHIRT_COLORS.length, DEFAULT_APPEARANCE.shirtColor);
  const pantsColor = appearanceIndex(settings?.pantsColor, PANTS_COLORS.length, DEFAULT_APPEARANCE.pantsColor);
  return {
    skin: SKIN_TONES[skinTone],
    shirt: SHIRT_COLORS[shirtColor],
    pants: PANTS_COLORS[pantsColor],
  };
}
