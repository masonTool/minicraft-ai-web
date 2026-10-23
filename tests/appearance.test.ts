import { describe, expect, it } from 'vitest';
import {
  BEARD_STYLES,
  beardLabel,
  BODY_BUILDS,
  BODY_FRAMES,
  CHARACTER_PRESETS,
  DEFAULT_APPEARANCE,
  EYE_COLORS,
  EYE_STYLES,
  eyeStyleLabel,
  HAIR_COLORS,
  HAIR_STYLES,
  hairStyleLabel,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  applyCharacterPreset,
  appearanceIndex,
  beardStyleOf,
  bodyBuildOf,
  bodyFrameOf,
  bodyProportions,
  eyeProfileOf,
  eyeStyleOf,
  hairStyleOf,
  paletteOf,
  presetIndexOf,
} from '../src/game/appearance.ts';

describe('角色外观（批次 187 / 279 / 296）', () => {
  it('默认外观就是原来的配色（老存档不换衣服/发型）', () => {
    const palette = paletteOf(DEFAULT_APPEARANCE);
    expect(palette.skin).toBe(0xdc9a6b);
    expect(palette.shirt).toBe(0x00a8a8);
    expect(palette.pants).toBe(0x3b4bb5);
    expect(palette.hair).toBe(0x2f2016);
    expect(palette.hairStyle).toBe('short');
    // 批次 333：成年男性默认带一点胡茬（模型细化后靠它认男性）
    expect(palette.beard).toBe('stubble');
    expect(palette.eyes).toBe('calm');
    expect(palette.eye).toBe(EYE_COLORS[0]);
    expect(palette.build).toBe('adult');
    expect(palette.frame).toBe('normal');
  });

  it('坏值/越界/小数一律回退默认档', () => {
    expect(appearanceIndex(undefined, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex('abc', SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(-1, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(99, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(2.9, SKIN_TONES.length, 1)).toBe(2);
    expect(appearanceIndex('3', SKIN_TONES.length, 1)).toBe(3);
  });

  it('主色板长度一致（界面按同一组档位排）', () => {
    expect(SKIN_TONES.length).toBe(6);
    expect(SHIRT_COLORS.length).toBe(6);
    expect(PANTS_COLORS.length).toBe(6);
    expect(HAIR_COLORS.length).toBe(6);
    const palette = paletteOf({ skinTone: 5, shirtColor: 4, pantsColor: 3, hairColor: 2, eyeColor: 2 });
    expect(palette.skin).toBe(SKIN_TONES[5]);
    expect(palette.shirt).toBe(SHIRT_COLORS[4]);
    expect(palette.pants).toBe(PANTS_COLORS[3]);
    expect(palette.hair).toBe(HAIR_COLORS[2]);
    expect(palette.eye).toBe(EYE_COLORS[2]);
  });

  it('缺字段时逐项回退（旧存档只有肤色也合法）', () => {
    expect(paletteOf({})).toEqual(paletteOf(null));
    expect(paletteOf({ skinTone: 1, shirtColor: 0, pantsColor: 0 })).toEqual(paletteOf(DEFAULT_APPEARANCE));
  });

  it('发型/胡须/眼型/体型坏值都回退默认档', () => {
    expect(hairStyleOf(undefined)).toBe('short');
    expect(hairStyleOf(99)).toBe('short');
    expect(hairStyleOf('2')).toBe(HAIR_STYLES[2]);
    expect(beardStyleOf(undefined)).toBe('none');
    expect(beardStyleOf(99)).toBe('none');
    expect(beardStyleOf(1)).toBe(BEARD_STYLES[1]);
    expect(eyeStyleOf(undefined)).toBe('calm');
    expect(eyeStyleOf(99)).toBe('calm');
    expect(bodyBuildOf(99)).toBe('adult');
    expect(bodyFrameOf(-1)).toBe('normal');
  });

  it('每个发型/胡须/眼型都有中文名（设置里不会出现空按钮）', () => {
    expect(HAIR_STYLES.every((style) => hairStyleLabel(style).length > 0)).toBe(true);
    expect(BEARD_STYLES.every((style) => beardLabel(style).length > 0)).toBe(true);
    expect(EYE_STYLES.every((style) => eyeStyleLabel(style).length > 0)).toBe(true);
  });

  it('新档位只追加在末尾（老存档下标不会错位）', () => {
    expect(HAIR_STYLES.slice(0, 4)).toEqual(['short', 'long', 'ponytail', 'bald']);
    expect(HAIR_STYLES.slice(4)).toEqual(['bob', 'messy']);
    expect(BEARD_STYLES.slice(0, 3)).toEqual(['none', 'stubble', 'full']);
    expect(BEARD_STYLES[3]).toBe('goatee');
  });

  it('四个角色预设齐全且互不相同', () => {
    // 批次 20261024-0245：`label` 字段已删，文字走 `label.appearance.preset.*`
    expect(CHARACTER_PRESETS.map((preset) => preset.id)).toEqual(['man', 'woman', 'boy', 'girl']);
    const signatures = CHARACTER_PRESETS.map((preset) =>
      [
        preset.skinTone,
        preset.shirtColor,
        preset.pantsColor,
        preset.hairColor,
        preset.hairStyle,
        preset.beard,
        preset.eyes,
        preset.eyeColor,
        preset.build,
        preset.frame,
      ].join(','),
    );
    expect(new Set(signatures).size).toBe(CHARACTER_PRESETS.length);
  });

  it('四个预设靠头发/胡须/眼睛区分', () => {
    const [man, woman, boy, girl] = CHARACTER_PRESETS;
    // 男性有胡茬，女性和少年都没有
    expect(man!.beard).not.toBe(0);
    expect([woman!.beard, boy!.beard, girl!.beard]).toEqual([0, 0, 0]);
    // 头发：短发 / 长发 / 翘发 / 马尾
    expect([man!.hairStyle, woman!.hairStyle, boy!.hairStyle, girl!.hairStyle]).toEqual([0, 1, 5, 2]);
    // 眼睛：成年男性沉稳、少年男性圆眼、两个女性都是明亮眼
    expect([man!.eyes, woman!.eyes, boy!.eyes, girl!.eyes]).toEqual([0, 1, 2, 1]);
  });

  it('默认外观正好是第一个预设（成年男性）', () => {
    expect(presetIndexOf(DEFAULT_APPEARANCE)).toBe(0);
  });

  it('套用预设会写回全部外观字段；手动改一项就变成自定义', () => {
    const settings = { ...DEFAULT_APPEARANCE };
    expect(applyCharacterPreset(settings, 1)).toBe(true);
    expect(presetIndexOf(settings)).toBe(1);
    expect(paletteOf(settings).hairStyle).toBe('long');
    expect(paletteOf(settings).eyes).toBe('bright');
    expect(paletteOf(settings).build).toBe('adult');
    // 手动改瞳色 → 不再等于任何预设
    settings.eyeColor = (settings.eyeColor + 1) % EYE_COLORS.length;
    expect(presetIndexOf(settings)).toBe(-1);
    expect(applyCharacterPreset(settings, 99)).toBe(false);
  });

  it('眼型：明亮眼有睫毛且眼睛更大，沉稳眼眉毛更粗', () => {
    const calm = eyeProfileOf('calm');
    const bright = eyeProfileOf('bright');
    const round = eyeProfileOf('round');
    expect(calm.lash).toBe(false);
    expect(bright.lash).toBe(true);
    expect(round.lash).toBe(false);
    expect(bright.scleraWidth).toBeGreaterThan(calm.scleraWidth);
    expect(bright.scleraHeight).toBeGreaterThan(calm.scleraHeight);
    expect(calm.browWidth).toBeGreaterThan(bright.browWidth);
    expect(bright.browTilt).toBeGreaterThan(calm.browTilt);
    expect(round.irisWidth).toBeGreaterThan(calm.irisWidth);
  });

  it('体型：纤细 < 标准 < 魁梧；少年四肢更细、肩更窄（没有高度项）', () => {
    const slim = bodyProportions('adult', 'slim');
    const normal = bodyProportions('adult', 'normal');
    const broad = bodyProportions('adult', 'broad');
    expect(slim.torsoWidth).toBeLessThan(normal.torsoWidth);
    expect(normal.torsoWidth).toBeLessThan(broad.torsoWidth);
    expect(slim.limb).toBeLessThan(normal.limb);
    expect(normal.limb).toBeLessThan(broad.limb);

    const teen = bodyProportions('teen', 'normal');
    expect(teen.limb).toBeLessThan(normal.limb);
    expect(teen.torsoWidth).toBeLessThan(normal.torsoWidth);
    // 只返回横向比例：没有 height / y 之类的字段（模型总高必须保持不变）
    expect(Object.keys(teen).sort()).toEqual(['armSpread', 'limb', 'torsoDepth', 'torsoWidth']);
    expect(BODY_BUILDS.length).toBe(2);
    expect(BODY_FRAMES.length).toBe(3);
  });
});
