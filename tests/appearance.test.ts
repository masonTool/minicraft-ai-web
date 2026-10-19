import { describe, expect, it } from 'vitest';
import {
  BEARD_STYLES,
  CHARACTER_PRESETS,
  DEFAULT_APPEARANCE,
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  applyCharacterPreset,
  appearanceIndex,
  beardStyleOf,
  hairStyleOf,
  paletteOf,
  presetIndexOf,
} from '../src/game/appearance.ts';

describe('角色外观（批次 187 / 279）', () => {
  it('默认外观就是原来那套配色（老存档不换人）', () => {
    const palette = paletteOf(DEFAULT_APPEARANCE);
    expect(palette.skin).toBe(0xdc9a6b);
    expect(palette.shirt).toBe(0x00a8a8);
    expect(palette.pants).toBe(0x3b4bb5);
    expect(palette.hair).toBe(0x2f2016);
    expect(palette.hairStyle).toBe('short');
    expect(palette.beard).toBe('none');
  });

  it('坏值/越界/小数一律回退默认档', () => {
    expect(appearanceIndex(undefined, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex('abc', SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(-1, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(99, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(2.9, SKIN_TONES.length, 1)).toBe(2);
    expect(appearanceIndex('3', SKIN_TONES.length, 1)).toBe(3);
  });

  it('下标落在色板里，且三组主色板长度一致（界面按同一组档位排）', () => {
    expect(SKIN_TONES.length).toBe(6);
    expect(SHIRT_COLORS.length).toBe(6);
    expect(PANTS_COLORS.length).toBe(6);
    expect(HAIR_COLORS.length).toBe(6);
    const palette = paletteOf({ skinTone: 5, shirtColor: 4, pantsColor: 3, hairColor: 2 });
    expect(palette.skin).toBe(SKIN_TONES[5]);
    expect(palette.shirt).toBe(SHIRT_COLORS[4]);
    expect(palette.pants).toBe(PANTS_COLORS[3]);
    expect(palette.hair).toBe(HAIR_COLORS[2]);
  });

  it('缺字段时逐项回退（旧存档只有 cape 也合法）', () => {
    expect(paletteOf({})).toEqual(paletteOf(null));
  });

  it('发型/胡须坏值回退短发/无', () => {
    expect(hairStyleOf(undefined)).toBe('short');
    expect(hairStyleOf(99)).toBe('short');
    expect(hairStyleOf('2')).toBe(HAIR_STYLES[2]);
    expect(beardStyleOf(undefined)).toBe('none');
    expect(beardStyleOf(99)).toBe('none');
    expect(beardStyleOf(1)).toBe(BEARD_STYLES[1]);
  });

  it('四个角色预设齐全且互不相同', () => {
    expect(CHARACTER_PRESETS.map((preset) => preset.label)).toEqual(['青壮年', '中年', '老人', '女孩']);
    const signatures = CHARACTER_PRESETS.map((preset) =>
      [preset.skinTone, preset.shirtColor, preset.pantsColor, preset.hairColor, preset.hairStyle, preset.beard].join(','),
    );
    expect(new Set(signatures).size).toBe(CHARACTER_PRESETS.length);
  });

  it('默认外观正好是第一个预设（青壮年）', () => {
    expect(presetIndexOf(DEFAULT_APPEARANCE)).toBe(0);
  });

  it('套用预设会写回全部外观字段；手动改一项就变成自定义', () => {
    const settings = { ...DEFAULT_APPEARANCE };
    expect(applyCharacterPreset(settings, 2)).toBe(true);
    expect(presetIndexOf(settings)).toBe(2);
    expect(paletteOf(settings).beard).toBe('full');
    settings.shirtColor = (settings.shirtColor + 1) % SHIRT_COLORS.length;
    expect(presetIndexOf(settings)).toBe(-1);
    expect(applyCharacterPreset(settings, 99)).toBe(false);
  });

  it('旧存档没有发色/发型/胡须时仍解析成原来的样子', () => {
    const legacy = { skinTone: 1, shirtColor: 0, pantsColor: 0 };
    expect(paletteOf(legacy)).toEqual(paletteOf(DEFAULT_APPEARANCE));
  });
});
