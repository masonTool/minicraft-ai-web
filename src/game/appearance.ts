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
 *
 * 批次 279（用户："可以让用户选择角色：老人 / 中年 / 女孩 / 青壮年"）：
 * 在原有三组配色之外补了**发色 / 发型 / 胡须**，并用 `CHARACTER_PRESETS` 把
 * "一键套用一整套形象"与"逐项微调"分开——预设只是快捷方式，最终仍存下标。
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

/** 发色 6 档；第 0 档是原来的深棕 `#2f2016` */
export const HAIR_COLORS = [0x2f2016, 0x17171b, 0x5a3a1e, 0xc9a227, 0x9a9a9a, 0xe8e8e8] as const;
export const HAIR_COLOR_LABELS = ['深棕', '乌黑', '栗棕', '金', '灰', '白'] as const;

/** 发型；`short` 是原来的发型（老存档默认） */
export const HAIR_STYLES = ['short', 'long', 'ponytail', 'bald'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export const HAIR_STYLE_LABELS: Readonly<Record<HairStyle, string>> = {
  short: '短发',
  long: '长发',
  ponytail: '马尾',
  bald: '光头',
};

/** 胡须；`none` 是原来的样子 */
export const BEARD_STYLES = ['none', 'stubble', 'full'] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];
export const BEARD_STYLE_LABELS: Readonly<Record<BeardStyle, string>> = {
  none: '无',
  stubble: '胡茬',
  full: '络腮胡',
};

/** 设置里存的是**下标**（存档小、加一档不会让旧档失效） */
export interface AppearanceSettings {
  skinTone: number;
  shirtColor: number;
  pantsColor: number;
  hairColor: number;
  hairStyle: number;
  beard: number;
}

/** 解析后的真实颜色 / 款式（渲染层只认这个） */
export interface AppearancePalette {
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  hairStyle: HairStyle;
  beard: BeardStyle;
}

/** 默认外观 = 批次 141/185 那个小人的原配色，老存档读进来不会"换个人" */
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  skinTone: 1,
  shirtColor: 0,
  pantsColor: 0,
  hairColor: 0,
  hairStyle: 0,
  beard: 0,
};

/**
 * 角色预设（批次 279）：一键套用一整套"形象"。
 *
 * ⚠️ 它**不是**第二份状态：选中后只是把下面这些下标写进 `AppearanceSettings`，
 * 之后玩家仍可逐项微调；`presetIndexOf()` 会按当前下标反查是不是还等于某个预设，
 * 不相等就显示"自定义"。这样老存档、手动配色、预设三者不会互相打架。
 */
export interface CharacterPreset {
  readonly id: 'youth' | 'adult' | 'elder' | 'girl';
  readonly label: string;
  readonly skinTone: number;
  readonly shirtColor: number;
  readonly pantsColor: number;
  readonly hairColor: number;
  readonly hairStyle: number;
  readonly beard: number;
}

export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  // 青壮年：原来的默认形象
  { id: 'youth', label: '青壮年', skinTone: 1, shirtColor: 0, pantsColor: 0, hairColor: 0, hairStyle: 0, beard: 0 },
  // 中年：深色短发 + 胡茬，衣服换成暗红
  { id: 'adult', label: '中年', skinTone: 1, shirtColor: 1, pantsColor: 1, hairColor: 2, hairStyle: 0, beard: 1 },
  // 老人：灰白头发 + 络腮胡，深蓝上衣
  { id: 'elder', label: '老人', skinTone: 0, shirtColor: 2, pantsColor: 4, hairColor: 4, hairStyle: 0, beard: 2 },
  // 女孩：长发/马尾，紫色上衣
  { id: 'girl', label: '女孩', skinTone: 0, shirtColor: 5, pantsColor: 3, hairColor: 3, hairStyle: 2, beard: 0 },
];

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

/** 发型下标 → 款式（坏值回退短发） */
export function hairStyleOf(index: unknown): HairStyle {
  return HAIR_STYLES[appearanceIndex(index, HAIR_STYLES.length, 0)]!;
}

/** 胡须下标 → 款式（坏值回退无） */
export function beardStyleOf(index: unknown): BeardStyle {
  return BEARD_STYLES[appearanceIndex(index, BEARD_STYLES.length, 0)]!;
}

/** 设置 → 颜色 / 款式。缺字段/坏值都回退到默认档，渲染层不需要再判空 */
export function paletteOf(settings: Partial<AppearanceSettings> | null | undefined): AppearancePalette {
  const skinTone = appearanceIndex(settings?.skinTone, SKIN_TONES.length, DEFAULT_APPEARANCE.skinTone);
  const shirtColor = appearanceIndex(settings?.shirtColor, SHIRT_COLORS.length, DEFAULT_APPEARANCE.shirtColor);
  const pantsColor = appearanceIndex(settings?.pantsColor, PANTS_COLORS.length, DEFAULT_APPEARANCE.pantsColor);
  const hairColor = appearanceIndex(settings?.hairColor, HAIR_COLORS.length, DEFAULT_APPEARANCE.hairColor);
  return {
    skin: SKIN_TONES[skinTone],
    shirt: SHIRT_COLORS[shirtColor],
    pants: PANTS_COLORS[pantsColor],
    hair: HAIR_COLORS[hairColor],
    hairStyle: hairStyleOf(settings?.hairStyle),
    beard: beardStyleOf(settings?.beard),
  };
}

/** 当前下标是否正好等于某个预设；都不等于返回 -1（界面显示"自定义"） */
export function presetIndexOf(settings: Partial<AppearanceSettings> | null | undefined): number {
  return CHARACTER_PRESETS.findIndex(
    (preset) =>
      preset.skinTone === settings?.skinTone &&
      preset.shirtColor === settings?.shirtColor &&
      preset.pantsColor === settings?.pantsColor &&
      preset.hairColor === settings?.hairColor &&
      preset.hairStyle === settings?.hairStyle &&
      preset.beard === settings?.beard,
  );
}

/**
 * 套用第 `index` 个预设（原地写回，设置面板握着同一个对象引用）。
 *
 * 返回 false 表示下标越界（调用方不必提示，循环按钮本来就不会给出越界值）。
 */
export function applyCharacterPreset(settings: AppearanceSettings, index: number): boolean {
  const preset = CHARACTER_PRESETS[index];
  if (!preset) return false;
  settings.skinTone = preset.skinTone;
  settings.shirtColor = preset.shirtColor;
  settings.pantsColor = preset.pantsColor;
  settings.hairColor = preset.hairColor;
  settings.hairStyle = preset.hairStyle;
  settings.beard = preset.beard;
  return true;
}
