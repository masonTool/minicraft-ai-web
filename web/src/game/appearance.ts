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
 *
 * 批次 333（用户："优化选角色系统……预设 4 个：成年男性 / 成年女性 / 少年男性 /
 * 少年女性……区分角色主要看头发、胡须、眼睛"）：把"像不像"的权重集中到
 * **头发 / 胡须 / 眼睛**三组可编辑项上，并补了两条体型维度（成年/少年、身架）。
 * 眼睛不再是"一块深色方块"，而是「眼型（沉稳/明亮/圆眼）+ 瞳色」两档。
 */

/** 肤色 6 档（浅 → 深）；第 1 档是原来的 `#dc9a6b` */
// 多语言 P2-6：标签表走 `label.*`
import { t } from '../core/i18n/I18n.ts';

export const SKIN_TONES = [0xf0c8a0, 0xdc9a6b, 0xc68642, 0x8d5524, 0xa1662f, 0x5c3317] as const;
/**
 * 外观各档位的显示名（多语言 P2-6）。
 *
 * 十张表全是"下标/枚举 → 名字"，且名字只在设置页出现 —— 所以统一成函数，
 * 切语言（含测试里 `setLanguage()`）之后立刻拿到新文案。
 * ⚠️ 档位下标**只能追加在末尾**：设置里存的是下标，插在中间会让老存档换外观。
 */
export function skinToneLabel(index: number): string {
  return appearanceText(`skinTone.${index}`, index);
}

/** 上衣 6 色；第 0 档是原来的青色 `#00a8a8` */
export const SHIRT_COLORS = [0x00a8a8, 0xb33a3a, 0x3b5bb5, 0x3f8f45, 0xc9a227, 0x7a4bb5] as const;
export function shirtColorLabel(index: number): string {
  return appearanceText(`shirtColor.${index}`, index);
}

/** 裤子 6 色；第 0 档是原来的靛蓝 `#3b4bb5` */
export const PANTS_COLORS = [0x3b4bb5, 0x2f2f38, 0x6b4a2f, 0x2f6b4a, 0x8a8a92, 0x5a2f6b] as const;
export function pantsColorLabel(index: number): string {
  return appearanceText(`pantsColor.${index}`, index);
}

/** 发色 6 档；第 0 档是原来的深棕 `#2f2016` */
export const HAIR_COLORS = [0x2f2016, 0x17171b, 0x5a3a1e, 0xc9a227, 0x9a9a9a, 0xe8e8e8] as const;
export function hairColorLabel(index: number): string {
  return appearanceText(`hairColor.${index}`, index);
}

/**
 * 发型；`short` 是原来的发型（老存档默认）。
 *
 * ⚠️ 新档位只能**追加在末尾**：设置里存的是下标，插在中间会让老存档换发型。
 *  - `bob`：齐耳短发 + 齐刘海（成年女性的第二个选择，也是"不像男生"的强特征）；
 *  - `messy`：翘发（少年男性），与成年人那种服帖的短发一眼分开。
 */
export const HAIR_STYLES = ['short', 'long', 'ponytail', 'bald', 'bob', 'messy'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export function hairStyleLabel(style: HairStyle): string {
  return appearanceText(`hairStyle.${style}`, style);
}

/** 胡须；`none` 是原来的样子。同样只追加，`goatee` 是山羊胡 */
export const BEARD_STYLES = ['none', 'stubble', 'full', 'goatee'] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];
export function beardLabel(style: BeardStyle): string {
  return appearanceText(`beard.${style}`, style);
}

/**
 * 眼型（批次 333）：不再只有"一块深色"，而是眼白 + 虹膜 + 可选睫毛 + 眉形。
 *  - `calm`：细长眼、粗平眉（成年男性）；
 *  - `bright`：大眼 + 上睫毛 + 细拱眉（成年女性 / 少女）；
 *  - `round`：圆眼 + 中等眉（少年）。
 */
export const EYE_STYLES = ['calm', 'bright', 'round'] as const;
export type EyeStyle = (typeof EYE_STYLES)[number];
export function eyeStyleLabel(style: EyeStyle): string {
  return appearanceText(`eyeStyle.${style}`, style);
}

/** 瞳色 4 档（第 0 档是默认的深褐） */
export const EYE_COLORS = [0x3a2a1e, 0x2b4a7a, 0x2f5a45, 0x6a6a72] as const;
export function eyeColorLabel(index: number): string {
  return appearanceText(`eyeColor.${index}`, index);
}

/** 成年 / 少年：只影响横向比例（肩宽、四肢粗细），**不改总高** */
export const BODY_BUILDS = ['adult', 'teen'] as const;
export type BodyBuild = (typeof BODY_BUILDS)[number];
export function bodyBuildLabel(build: BodyBuild): string {
  return appearanceText(`bodyBuild.${build}`, build);
}

/** 身架：标准 / 纤细 / 魁梧（同样只改横向比例） */
export const BODY_FRAMES = ['normal', 'slim', 'broad'] as const;
export type BodyFrame = (typeof BODY_FRAMES)[number];
export function bodyFrameLabel(frame: BodyFrame): string {
  return appearanceText(`bodyFrame.${frame}`, frame);
}

/**
 * 外观名字的查表兜底：查不到就退成下标 / 枚举值的字面量。
 * 单独一个函数是为了**把 `t()` 的键写成模板字面量**（审计靠它认前缀）。
 */
function appearanceText(suffix: string, fallback: string | number): string {
  const key = `label.appearance.${suffix}`;
  const text = t(`label.appearance.${suffix}`);
  return text === key ? String(fallback) : text;
}

/** 设置里存的是**下标**（存档小、加一档不会让旧档失效） */
export interface AppearanceSettings {
  skinTone: number;
  shirtColor: number;
  pantsColor: number;
  hairColor: number;
  hairStyle: number;
  beard: number;
  /** 批次 333：眼型 / 瞳色 / 年龄体型 / 身架 */
  eyes: number;
  eyeColor: number;
  build: number;
  frame: number;
}

/** 解析后的真实颜色 / 款式（渲染层只认这个） */
export interface AppearancePalette {
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  hairStyle: HairStyle;
  beard: BeardStyle;
  eyes: EyeStyle;
  /** 虹膜颜色（已解析成十六进制） */
  eye: number;
  build: BodyBuild;
  frame: BodyFrame;
}

/**
 * 默认外观 = 成年男性预设。
 *
 * ⚠️ 批次 333 起默认胡须是**胡茬**（原来是"无"）：模型这一版整体细化了，
 * 成年男性带一点胡茬才认得出是男性；衣服、发型、肤色、身高都没动。
 * 老存档（没有 beard 字段）会跟到这一档，其余字段回退原值。
 */
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  skinTone: 1,
  shirtColor: 0,
  pantsColor: 0,
  hairColor: 0,
  hairStyle: 0,
  beard: 1,
  eyes: 0,
  eyeColor: 0,
  build: 0,
  frame: 0,
};

/**
 * 角色预设（批次 333）：一键套用一整套"形象"。
 *
 * ⚠️ 它**不是**第二份状态：选中后只是把下面这些下标写进 `AppearanceSettings`，
 * 之后玩家仍可逐项微调；`presetIndexOf()` 会按当前下标反查是不是还等于某个预设，
 * 不相等就显示"自定义"。这样老存档、手动配色、预设三者不会互相打架。
 *
 * 四个预设的区分**主要落在头发 / 胡须 / 眼睛**上（用户点名）：
 *  - 成年男性：短发 + 胡茬 + 沉稳眼；
 *  - 成年女性：长发 + 无胡须 + 明亮眼；
 *  - 少年男性：翘发 + 无胡须 + 圆眼；
 *  - 少年女性：马尾 + 无胡须 + 明亮眼 + 蓝瞳。
 */
export interface CharacterPreset {
  readonly id: 'man' | 'woman' | 'boy' | 'girl';
  readonly skinTone: number;
  readonly shirtColor: number;
  readonly pantsColor: number;
  readonly hairColor: number;
  readonly hairStyle: number;
  readonly beard: number;
  readonly eyes: number;
  readonly eyeColor: number;
  readonly build: number;
  readonly frame: number;
}

export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  // 成年男性：就是默认外观（短发 + 胡茬 + 沉稳眼 + 标准身架）
  {
    id: 'man',
    skinTone: 1,
    shirtColor: 0,
    pantsColor: 0,
    hairColor: 0,
    hairStyle: 0,
    beard: 1,
    eyes: 0,
    eyeColor: 0,
    build: 0,
    frame: 0,
  },
  // 成年女性：栗棕长发 + 无胡须 + 明亮大眼 + 纤细身架
  {
    id: 'woman',
    skinTone: 0,
    shirtColor: 5,
    pantsColor: 2,
    hairColor: 2,
    hairStyle: 1,
    beard: 0,
    eyes: 1,
    eyeColor: 0,
    build: 0,
    frame: 1,
  },
  // 少年男性：乌黑翘发 + 无胡须 + 圆眼 + 少年体型
  {
    id: 'boy',
    skinTone: 1,
    shirtColor: 2,
    pantsColor: 1,
    hairColor: 1,
    hairStyle: 5,
    beard: 0,
    eyes: 2,
    eyeColor: 0,
    build: 1,
    frame: 1,
  },
  // 少年女性：金色马尾 + 无胡须 + 明亮眼 + 蓝瞳 + 少年体型
  {
    id: 'girl',
    skinTone: 0,
    shirtColor: 4,
    pantsColor: 3,
    hairColor: 3,
    hairStyle: 2,
    beard: 0,
    eyes: 1,
    eyeColor: 1,
    build: 1,
    frame: 1,
  },
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

/**
 * 发型下标 → 款式（坏值回退短发）。
 *
 * `fallback` 默认是 0（短发）：`paletteOf` 缺字段时要回退到**默认外观**那一档，
 * 所以它会把 `DEFAULT_APPEARANCE.hairStyle` 传进来。
 */
export function hairStyleOf(index: unknown, fallback = 0): HairStyle {
  return HAIR_STYLES[appearanceIndex(index, HAIR_STYLES.length, fallback)]!;
}

/** 胡须下标 → 款式（坏值默认回退无；`paletteOf` 传默认外观那一档） */
export function beardStyleOf(index: unknown, fallback = 0): BeardStyle {
  return BEARD_STYLES[appearanceIndex(index, BEARD_STYLES.length, fallback)]!;
}

/** 眼型下标 → 款式（坏值回退沉稳） */
export function eyeStyleOf(index: unknown, fallback = 0): EyeStyle {
  return EYE_STYLES[appearanceIndex(index, EYE_STYLES.length, fallback)]!;
}

/** 年龄体型下标 → 成年 / 少年（坏值回退成年） */
export function bodyBuildOf(index: unknown, fallback = 0): BodyBuild {
  return BODY_BUILDS[appearanceIndex(index, BODY_BUILDS.length, fallback)]!;
}

/** 身架下标 → 标准 / 纤细 / 魁梧（坏值回退标准） */
export function bodyFrameOf(index: unknown, fallback = 0): BodyFrame {
  return BODY_FRAMES[appearanceIndex(index, BODY_FRAMES.length, fallback)]!;
}

/** 设置 → 颜色 / 款式。缺字段/坏值都回退到默认档，渲染层不需要再判空 */
export function paletteOf(settings: Partial<AppearanceSettings> | null | undefined): AppearancePalette {
  const skinTone = appearanceIndex(settings?.skinTone, SKIN_TONES.length, DEFAULT_APPEARANCE.skinTone);
  const shirtColor = appearanceIndex(settings?.shirtColor, SHIRT_COLORS.length, DEFAULT_APPEARANCE.shirtColor);
  const pantsColor = appearanceIndex(settings?.pantsColor, PANTS_COLORS.length, DEFAULT_APPEARANCE.pantsColor);
  const hairColor = appearanceIndex(settings?.hairColor, HAIR_COLORS.length, DEFAULT_APPEARANCE.hairColor);
  const eyeColor = appearanceIndex(settings?.eyeColor, EYE_COLORS.length, DEFAULT_APPEARANCE.eyeColor);
  return {
    skin: SKIN_TONES[skinTone],
    shirt: SHIRT_COLORS[shirtColor],
    pants: PANTS_COLORS[pantsColor],
    hair: HAIR_COLORS[hairColor],
    hairStyle: hairStyleOf(settings?.hairStyle, DEFAULT_APPEARANCE.hairStyle),
    beard: beardStyleOf(settings?.beard, DEFAULT_APPEARANCE.beard),
    eyes: eyeStyleOf(settings?.eyes, DEFAULT_APPEARANCE.eyes),
    eye: EYE_COLORS[eyeColor],
    build: bodyBuildOf(settings?.build, DEFAULT_APPEARANCE.build),
    frame: bodyFrameOf(settings?.frame, DEFAULT_APPEARANCE.frame),
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
      preset.beard === settings?.beard &&
      preset.eyes === settings?.eyes &&
      preset.eyeColor === settings?.eyeColor &&
      preset.build === settings?.build &&
      preset.frame === settings?.frame,
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
  settings.eyes = preset.eyes;
  settings.eyeColor = preset.eyeColor;
  settings.build = preset.build;
  settings.frame = preset.frame;
  return true;
}

/**
 * 眼型 → 各零件的目标尺寸（纯函数，渲染层照着套，离线测试能直接断言）。
 *
 * 尺寸单位是"格"，与 `PlayerRenderer` 的方块缩放同一口径。
 */
export interface EyeProfile {
  scleraWidth: number;
  scleraHeight: number;
  irisWidth: number;
  irisHeight: number;
  /** 上睫毛：只有"明亮"眼型有 */
  lash: boolean;
  browWidth: number;
  browHeight: number;
  /** 眉尾倾斜（弧度，左右镜像） */
  browTilt: number;
}

export function eyeProfileOf(style: EyeStyle): EyeProfile {
  switch (style) {
    case 'bright':
      return {
        scleraWidth: 0.115,
        scleraHeight: 0.095,
        irisWidth: 0.06,
        irisHeight: 0.075,
        lash: true,
        browWidth: 0.105,
        browHeight: 0.018,
        browTilt: 0.12,
      };
    case 'round':
      return {
        scleraWidth: 0.11,
        scleraHeight: 0.1,
        irisWidth: 0.07,
        irisHeight: 0.08,
        lash: false,
        browWidth: 0.11,
        browHeight: 0.022,
        browTilt: 0,
      };
    default:
      return {
        scleraWidth: 0.105,
        scleraHeight: 0.075,
        irisWidth: 0.055,
        irisHeight: 0.065,
        lash: false,
        browWidth: 0.13,
        browHeight: 0.028,
        browTilt: 0,
      };
  }
}

/**
 * 体型 → 横向比例（纯函数）。
 *
 * ⚠️ 只返回"宽/深/粗细"，**没有任何高度**：模型总高、脚底 y=0、眼高全部保持不变，
 * 否则第三人称镜头与碰撞盒会跟着歪。
 */
export interface BodyProportions {
  torsoWidth: number;
  torsoDepth: number;
  /** 手臂 / 大腿的粗细倍率 */
  limb: number;
  /** 肩宽（手臂枢轴 x 的倍率） */
  armSpread: number;
}

export function bodyProportions(build: BodyBuild, frame: BodyFrame): BodyProportions {
  const frameWidth = frame === 'slim' ? 0.9 : frame === 'broad' ? 1.12 : 1;
  const frameDepth = frame === 'slim' ? 0.94 : frame === 'broad' ? 1.08 : 1;
  const teen = build === 'teen';
  return {
    torsoWidth: frameWidth * (teen ? 0.93 : 1),
    torsoDepth: frameDepth * (teen ? 0.95 : 1),
    limb: frameWidth * (teen ? 0.9 : 1),
    // 少年肩更窄：躯干与手臂都收细之后，枢轴必须一起往里，否则手臂会"飘"在身体外
    armSpread:
      (frame === 'slim' ? 0.91 : frame === 'broad' ? 1.06 : 1) * (teen ? 0.88 : 1),
  };
}
