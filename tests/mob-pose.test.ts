/**
 * 远端玩家的姿势偏移（联机37）
 *
 * 远端玩家在渲染上就是个 `Mob`，所以"蹲下/骑乘"只能靠一个竖直偏移表达。
 * 这里钉住三件事：站着的偏移是 0（不影响所有普通生物）、蹲下沉、骑乘优先于蹲。
 */

import { describe, expect, it } from 'vitest';
import { RIDE_LIFT, SNEAK_SINK, mobPoseOffsetY } from '../src/core/render/MobPose.ts';

describe('mobPoseOffsetY', () => {
  it('站着不动：偏移 0（普通生物不该被这条逻辑碰到）', () => {
    expect(mobPoseOffsetY({ sneaking: false, riding: false })).toBe(0);
  });

  it('下蹲：往下沉', () => {
    expect(mobPoseOffsetY({ sneaking: true, riding: false })).toBe(-SNEAK_SINK);
    expect(mobPoseOffsetY({ sneaking: true, riding: false })).toBeLessThan(0);
  });

  it('骑乘：往上抬', () => {
    expect(mobPoseOffsetY({ sneaking: false, riding: true })).toBe(RIDE_LIFT);
    expect(mobPoseOffsetY({ sneaking: false, riding: true })).toBeGreaterThan(0);
  });

  it('骑乘时按蹲：仍是坐着的（骑乘优先）', () => {
    expect(mobPoseOffsetY({ sneaking: true, riding: true })).toBe(RIDE_LIFT);
  });

  it('下沉量和本地玩家一致（0.12）：自己蹲下时的镜头高度要和队友看到的一致', () => {
    expect(SNEAK_SINK).toBeCloseTo(0.12, 5);
  });
});
