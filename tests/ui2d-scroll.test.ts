/**
 * 镜像里的滚动条几何与惯性衰减（`src/ui2d/menuScreen.ts` 的两个纯函数）。
 *
 * 这两样都是"手感"问题：滚动条算错 → 拇指跳或越界；衰减算错 → 松手后一路滑到底
 * 或者根本不动。它们都只在真机滑动时暴露，所以必须离线钉住。
 */
import { describe, expect, it } from 'vitest';
import {
  SCROLLBAR_MIN_THUMB,
  SCROLL_STOP,
  decayVelocity,
  scrollBarRects,
} from '../src/ui2d/menuScreen.ts';

describe('滚动条几何', () => {
  const track = { x: 100, y: 50, w: 4, h: 200 };

  it('装得下就没有滚动条（返回 null）', () => {
    expect(scrollBarRects(track, 0, 200, 200)).toBeNull();
    expect(scrollBarRects(track, 0, 201, 200)).toBeNull(); // +2 的容差内不算
  });

  it('拇指长度按 视口/内容 比例，顶部时贴顶', () => {
    const bars = scrollBarRects(track, 0, 400, 200)!;
    expect(bars.thumb.h).toBe(100); // 200/400 × 200
    expect(bars.thumb.y).toBe(track.y);
    expect(bars.thumb.x).toBe(track.x);
    expect(bars.thumb.w).toBe(track.w);
  });

  it('滚到底时拇指贴底（右端不越界）', () => {
    const bars = scrollBarRects(track, 200, 400, 200)!;
    expect(bars.thumb.y + bars.thumb.h).toBeCloseTo(track.y + track.h, 6);
  });

  it('内容极长时拇指不小于最小长度（否则抓不住）', () => {
    const bars = scrollBarRects(track, 0, 100000, 200)!;
    expect(bars.thumb.h).toBe(SCROLLBAR_MIN_THUMB);
  });

  it('scrollTop 越界/NaN 时夹在两端（不能让拇指飞出轨道）', () => {
    const top = scrollBarRects(track, -999, 400, 200)!;
    expect(top.thumb.y).toBe(track.y);
    const bottom = scrollBarRects(track, 99999, 400, 200)!;
    expect(bottom.thumb.y + bottom.thumb.h).toBeCloseTo(track.y + track.h, 6);
    const nan = scrollBarRects(track, Number.NaN, 400, 200)!;
    expect(nan.thumb.y).toBe(track.y);
  });
});

describe('惯性衰减', () => {
  it('按 0.94 每帧衰减（一帧 16.67ms）', () => {
    expect(decayVelocity(10, 16.67)).toBeCloseTo(9.4, 2);
  });

  it('掉帧时按帧数归一，不会突然冲很远', () => {
    const oneFrame = decayVelocity(10, 16.67);
    const threeFrames = decayVelocity(10, 50);
    expect(threeFrames).toBeLessThan(oneFrame);
    // 最多按 3 帧算，再长的间隔也不额外放大
    expect(decayVelocity(10, 200)).toBeCloseTo(Math.pow(0.94, 3) * 10, 4);
  });

  it('速度小到阈值以下就归零（停止滑动）', () => {
    expect(decayVelocity(SCROLL_STOP / 2, 16.67)).toBe(0);
    expect(decayVelocity(0, 16.67)).toBe(0);
  });

  it('方向保留（负速度仍然是负的），非法输入归零', () => {
    expect(decayVelocity(-10, 16.67)).toBeCloseTo(-9.4, 2);
    expect(decayVelocity(Number.NaN, 16.67)).toBe(0);
  });
});
