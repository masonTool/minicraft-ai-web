/**
 * 远端玩家的外观派生（本轮修复：所有人长得一样）
 *
 * 判据只有一条：**同一个昵称在任何一端都必须得到同一套外观**——否则队友在
 * 你的屏幕上和在他自己屏幕上不是同一个人。
 */

import { describe, expect, it } from 'vitest';
import { remotePaletteFromLook, remotePaletteFromName } from '../web/src/core/net/RemoteSkin.ts';
import { SKIN_TONES, SHIRT_COLORS, PANTS_COLORS, HAIR_COLORS, EYE_COLORS, HAIR_STYLES, BEARD_STYLES, EYE_STYLES, BODY_BUILDS, BODY_FRAMES } from '../web/src/game/appearance.ts';

describe('remotePaletteFromName', () => {
  it('同名两次结果完全一致（跨端一致的前提）', () => {
    expect(remotePaletteFromName('小明')).toEqual(remotePaletteFromName('小明'));
    expect(remotePaletteFromName('Steve')).toEqual(remotePaletteFromName('Steve'));
  });

  it('名字两端的空白不影响结果', () => {
    expect(remotePaletteFromName('  小明  ')).toEqual(remotePaletteFromName('小明'));
  });

  it('空名字落到默认外观，且不抛', () => {
    const palette = remotePaletteFromName('');
    expect(palette.skin).toBe(SKIN_TONES[1]);
    expect(palette.shirt).toBe(SHIRT_COLORS[0]);
    expect(remotePaletteFromName('   ')).toEqual(palette);
  });

  it('所有档位都落在合法范围内', () => {
    for (const name of ['a', '小明', 'Steve', 'Player_01', '很长很长的名字'.repeat(4), '🙂']) {
      const palette = remotePaletteFromName(name);
      expect(SKIN_TONES).toContain(palette.skin);
      expect(SHIRT_COLORS).toContain(palette.shirt);
      expect(PANTS_COLORS).toContain(palette.pants);
      expect(HAIR_COLORS).toContain(palette.hair);
      expect(EYE_COLORS).toContain(palette.eye);
      expect(HAIR_STYLES).toContain(palette.hairStyle);
      expect(BEARD_STYLES).toContain(palette.beard);
      expect(EYE_STYLES).toContain(palette.eyes);
      expect(BODY_BUILDS).toContain(palette.build);
      expect(BODY_FRAMES).toContain(palette.frame);
    }
  });

  it('常见的几个名字不会全撞成同一个人', () => {
    const names = ['小明', '小红', 'Steve', 'Alex', '张三', '李四', '玩家1', 'Player2'];
    const keys = new Set(names.map((name) => JSON.stringify(remotePaletteFromName(name))));
    // 8 个名字至少要有 6 种不同组合：允许偶然碰撞，但不允许"全都一样"
    expect(keys.size).toBeGreaterThanOrEqual(6);
  });

  it('各字段不同步变化（每个字段用不同的盐）', () => {
    // 如果所有字段都直接 `hash % n`，会出现"肤色一档、上衣就固定"的强相关：
    // 40 个名字里头发只会出现一两种。这里要求发型确实分散开。
    const names = Array.from({ length: 40 }, (_, i) => `player${i}`);
    const styles = new Set(names.map((name) => remotePaletteFromName(name).hairStyle));
    expect(styles.size).toBeGreaterThanOrEqual(3);
  });
});

describe('remotePaletteFromLook（真实皮肤同步）', () => {
  it('按对端发来的下标还原成同一套外观', () => {
    const palette = remotePaletteFromLook([0, 1, 2, 3, 4, 2, 1, 3, 1, 2]);
    expect(palette).not.toBeNull();
    expect(palette?.skin).toBe(SKIN_TONES[0]);
    expect(palette?.shirt).toBe(SHIRT_COLORS[1]);
    expect(palette?.pants).toBe(PANTS_COLORS[2]);
    expect(palette?.hair).toBe(HAIR_COLORS[3]);
    expect(palette?.hairStyle).toBe(HAIR_STYLES[4]);
    expect(palette?.beard).toBe(BEARD_STYLES[2]);
    expect(palette?.eyes).toBe(EYE_STYLES[1]);
    expect(palette?.eye).toBe(EYE_COLORS[3]);
    expect(palette?.build).toBe(BODY_BUILDS[1]);
    expect(palette?.frame).toBe(BODY_FRAMES[2]);
  });

  it('下标越界回退默认档（不让渲染层拿到 undefined）', () => {
    const palette = remotePaletteFromLook([99, 99, 99, 99, 99, 99, 99, 99, 99, 99]);
    expect(palette).not.toBeNull();
    expect(palette?.skin).toBe(SKIN_TONES[1]);
    expect(palette?.shirt).toBe(SHIRT_COLORS[0]);
    expect(palette?.build).toBe(BODY_BUILDS[0]);
  });

  it('长度不够 / 不是数组 → null（调用方回退昵称派生）', () => {
    expect(remotePaletteFromLook(null)).toBeNull();
    expect(remotePaletteFromLook([])).toBeNull();
    expect(remotePaletteFromLook([0, 1, 2])).toBeNull();
    expect(remotePaletteFromLook('0,1,2,3,4,5,6,7,8,9')).toBeNull();
  });

  it('坏值（NaN/字符串）落 0 而不是崩', () => {
    const palette = remotePaletteFromLook([NaN, 'x', 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(palette?.skin).toBe(SKIN_TONES[0]);
    expect(palette?.shirt).toBe(SHIRT_COLORS[0]);
  });
});
