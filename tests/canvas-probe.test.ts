/**
 * 画布内容探针（批次 295）
 *
 * 真机现象：切后台近 50 分钟后回来，3D 世界正常、**图标全是空的**。
 * 判断"画布被系统清空"只能靠像素（`contextlost` 事件兼容性有限），
 * 这里把那条判据拆成纯函数逐个边界钉死——判错的方向只有两种，
 * 而且都很贵：误判"丢了"→ 每次回前台白重画一张 25 万像素的图集；
 * 误判"没丢"→ 玩家看到的就是一堆空白图标。
 */

import { describe, expect, it } from 'vitest';
import {
  PROBE_ALPHA_MIN,
  canvasLooksLost,
  is2dContextLost,
  pickOpaqueSamples,
  uploadSampleAt,
  type PixelSample,
} from '../web/src/render/canvasProbe.ts';

/** 造一份 RGBA 数据：`opaque` 里的像素坐标写成不透明，其余全透明 */
function makeData(width: number, height: number, opaque: readonly PixelSample[] = []): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const { x, y } of opaque) {
    const at = (y * width + x) * 4;
    data[at] = 120;
    data[at + 1] = 130;
    data[at + 2] = 140;
    data[at + 3] = 255;
  }
  return data;
}

/** 读某格的 alpha（测试里只关心"读不读得出来一个不透明像素"） */
function readAlpha(data: Uint8ClampedArray, width: number) {
  return (sample: PixelSample): ArrayLike<number> | null => {
    const at = (sample.y * width + sample.x) * 4;
    return data.subarray(at, at + 4);
  };
}

describe('画布探针：取样点', () => {
  it('全透明数据不产生取样点（没法判断时不要瞎重画）', () => {
    expect(pickOpaqueSamples(makeData(4, 4), 4)).toEqual([]);
  });

  it('坐标按行优先换算', () => {
    const samples = pickOpaqueSamples(makeData(4, 4, [{ x: 1, y: 2 }]), 4);
    expect(samples).toEqual([{ x: 1, y: 2 }]);
  });

  it('多个取样点会分散在不同窗口里（不会被一张透明贴图一起废掉）', () => {
    const width = 8;
    // 64 个像素分 4 个窗口（每窗 16 个），各窗第一个不透明像素分别是 index 0 / 24 / 40 / 56
    const data = makeData(width, 8, [
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 0, y: 5 },
      { x: 0, y: 7 },
    ]);
    const samples = pickOpaqueSamples(data, width, 4);
    expect(samples).toHaveLength(4);
    expect(samples).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 0, y: 5 },
      { x: 0, y: 7 },
    ]);
  });

  it('窗口里没有不透明像素时跳过（取样点少于上限是正常的）', () => {
    const data = makeData(8, 8, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(pickOpaqueSamples(data, 8, 4)).toEqual([{ x: 0, y: 0 }]);
  });

  it('alpha 门槛与图集"算不透明"同一个数（8）', () => {
    const data = new Uint8ClampedArray(2 * 4);
    data[3] = PROBE_ALPHA_MIN - 1;
    data[7] = PROBE_ALPHA_MIN;
    const samples = pickOpaqueSamples(data, 2, 1);
    expect(samples).toEqual([{ x: 1, y: 0 }]);
  });

  it('空数据 / 坏宽度 / 零个取样点都安全返回空', () => {
    expect(pickOpaqueSamples(new Uint8ClampedArray(0), 4)).toEqual([]);
    expect(pickOpaqueSamples(makeData(4, 4, [{ x: 0, y: 0 }]), 0)).toEqual([]);
    expect(pickOpaqueSamples(makeData(4, 4, [{ x: 0, y: 0 }]), -4)).toEqual([]);
    expect(pickOpaqueSamples(makeData(4, 4, [{ x: 0, y: 0 }]), 4, 0)).toEqual([]);
  });
});

describe('画布探针：内容还在不在', () => {
  const samples: PixelSample[] = [{ x: 0, y: 0 }, { x: 2, y: 2 }];

  it('没有取样点时不判丢失（宁可不动）', () => {
    expect(canvasLooksLost([], () => null)).toBe(false);
  });

  it('像素还在 → 没丢', () => {
    const data = makeData(4, 4, samples);
    expect(canvasLooksLost(samples, readAlpha(data, 4))).toBe(false);
  });

  it('只剩一个点不透明也算没丢（资源包换掉一张贴图不该触发重画）', () => {
    const data = makeData(4, 4, [{ x: 2, y: 2 }]);
    expect(canvasLooksLost(samples, readAlpha(data, 4))).toBe(false);
  });

  it('被清空成透明 → 丢（这就是安卓切后台回来的样子）', () => {
    const data = makeData(4, 4);
    expect(canvasLooksLost(samples, readAlpha(data, 4))).toBe(true);
  });

  it('读不出来（上下文丢着）→ 当成丢，等 restored 再重画', () => {
    expect(canvasLooksLost(samples, () => null)).toBe(true);
  });
});

describe('画布探针：上下文丢失 API 的兼容处理', () => {
  it('没有 isContextLost 的旧实现按"没丢"处理', () => {
    expect(is2dContextLost({})).toBe(false);
    expect(is2dContextLost(null)).toBe(false);
  });

  it('有该方法时如实返回', () => {
    expect(is2dContextLost({ isContextLost: () => true })).toBe(true);
    expect(is2dContextLost({ isContextLost: () => false })).toBe(false);
  });
});

/**
 * 源画布取样点 → 上传画布同一像素（批次 523）。
 *
 * 这条换算支撑的是"上传画布被单独清空"那个真机 bug：
 * 图集有两张画布，源画布每格 16×16 紧挨着，上传画布每格 32（内容居中 + 四周 8 纹素边距）。
 * 换算错了不会崩，只会让探针读到一个**边上**的像素（可能本来就是透明），
 * 于是日志里永远报 `false`，排查时反而把人带偏。
 */
describe('画布探针：源画布 → 上传画布的坐标换算', () => {
  const COLUMNS = 16;
  const TILE = 16;
  const STRIDE = 32;
  const PAD = 8;
  const at = (x: number, y: number): PixelSample =>
    uploadSampleAt({ x, y }, COLUMNS, TILE, STRIDE, PAD);

  it('第一格左上角落到内容区的左上角（跳过边距）', () => {
    expect(at(0, 0)).toEqual({ x: PAD, y: PAD });
  });

  it('格内偏移保持原地不动（16 纹素内容不会被拉伸）', () => {
    expect(at(5, 7)).toEqual({ x: PAD + 5, y: PAD + 7 });
    expect(at(15, 15)).toEqual({ x: PAD + 15, y: PAD + 15 });
  });

  it('同一行的下一格：横向跳到下一个 stride', () => {
    expect(at(16, 0)).toEqual({ x: STRIDE + PAD, y: PAD });
    expect(at(16 + 3, 9)).toEqual({ x: STRIDE + PAD + 3, y: PAD + 9 });
  });

  it('换行：纵向跳到下一个 stride，列号归零', () => {
    expect(at(0, 16)).toEqual({ x: PAD, y: STRIDE + PAD });
    // 第 2 行第 0 列（按 16 列换行）
    expect(at(16 * COLUMNS, 0)).toEqual({ x: PAD, y: STRIDE + PAD });
    // 第 1 行第 3 列：横向 3 个 stride，纵向 1 个 stride
    expect(at(16 * 3, 16 * 1)).toEqual({
      x: STRIDE * 3 + PAD,
      y: STRIDE + PAD,
    });
  });
});
