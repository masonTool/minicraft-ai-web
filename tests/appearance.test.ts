import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  appearanceIndex,
  paletteOf,
} from '../src/game/appearance.ts';

describe('角色外观（批次 187）', () => {
  it('默认外观就是原来那套配色（老存档不换人）', () => {
    const palette = paletteOf(DEFAULT_APPEARANCE);
    expect(palette.skin).toBe(0xdc9a6b);
    expect(palette.shirt).toBe(0x00a8a8);
    expect(palette.pants).toBe(0x3b4bb5);
  });

  it('坏值/越界/小数一律回退默认档', () => {
    expect(appearanceIndex(undefined, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex('abc', SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(-1, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(99, SKIN_TONES.length, 1)).toBe(1);
    expect(appearanceIndex(2.9, SKIN_TONES.length, 1)).toBe(2);
    expect(appearanceIndex('3', SKIN_TONES.length, 1)).toBe(3);
  });

  it('下标落在色板里，且三组色板长度一致（界面按同一组档位排）', () => {
    expect(SKIN_TONES.length).toBe(6);
    expect(SHIRT_COLORS.length).toBe(6);
    expect(PANTS_COLORS.length).toBe(6);
    const palette = paletteOf({ skinTone: 5, shirtColor: 4, pantsColor: 3 });
    expect(palette).toEqual({
      skin: SKIN_TONES[5],
      shirt: SHIRT_COLORS[4],
      pants: PANTS_COLORS[3],
    });
  });

  it('缺字段时逐项回退（旧存档只有 cape 也合法）', () => {
    expect(paletteOf({})).toEqual(paletteOf(null));
  });
});
