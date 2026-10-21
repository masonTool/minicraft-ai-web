/**
 * 网格化队列优先级（N2，批次 604）
 *
 * 只钉住排序口径：改方块 > 区块首次加载 > 光照全量重刷；
 * 同优先级内仍按离玩家的距离近的优先。
 */

import { describe, expect, it } from 'vitest';
import {
  MESH_PRIORITY_EDIT,
  MESH_PRIORITY_LOAD,
  MESH_PRIORITY_REFRESH,
  compareMeshQueue,
  type QueueItem,
} from '../src/render/ChunkRenderer.ts';

function item(cx: number, cz: number, distanceSq: number, priority: number): QueueItem {
  return { cx, cz, distanceSq, priority };
}

describe('网格化队列排序', () => {
  it('改方块优先于新区块加载，哪怕它更远', () => {
    const editFar = item(10, 10, 400, MESH_PRIORITY_EDIT);
    const loadNear = item(0, 0, 1, MESH_PRIORITY_LOAD);
    expect([loadNear, editFar].sort(compareMeshQueue)[0]).toBe(editFar);
  });

  it('同优先级按距离近的优先', () => {
    const near = item(0, 0, 4, MESH_PRIORITY_LOAD);
    const far = item(3, 0, 100, MESH_PRIORITY_LOAD);
    expect([far, near].sort(compareMeshQueue)[0]).toBe(near);
  });

  it('全量重刷排最后', () => {
    const refreshNear = item(0, 0, 0, MESH_PRIORITY_REFRESH);
    const loadFar = item(8, 0, 999, MESH_PRIORITY_LOAD);
    expect([refreshNear, loadFar].sort(compareMeshQueue)[0]).toBe(loadFar);
  });

  it('同位置同优先级时顺序稳定为 0', () => {
    expect(compareMeshQueue(item(1, 2, 9, 1), item(1, 2, 9, 1))).toBe(0);
  });
});
