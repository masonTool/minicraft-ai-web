/**
 * 容器变更回调（L4，批次 611）
 *
 * `onMutate` 只应在真正写入时触发；`restore` 是远端同步/读档路径，
 * 不能触发，否则会“收到内容 → 再广播 → 形成回环”。
 */

import { describe, expect, it } from 'vitest';
import { Chest } from '../src/core/container/Chest.ts';
import { Block } from '../src/core/registry/blocks.ts';

describe('Chest.onMutate', () => {
  it('set 与 add 会触发', () => {
    const chest = new Chest(15);
    let count = 0;
    chest.onMutate = () => count++;
    chest.set(0, { id: Block.STONE, count: 2 });
    chest.add(Block.DIRT, 3);
    expect(count).toBe(2);
  });

  it('restore 不触发（防止远端同步回环）', () => {
    const chest = new Chest(15);
    let count = 0;
    chest.onMutate = () => count++;
    chest.restore([{ id: Block.STONE, count: 1 }]);
    expect(count).toBe(0);
  });

  it('写入空槽也会触发（清空同样需要广播）', () => {
    const chest = new Chest(15);
    chest.set(0, { id: Block.STONE, count: 1 });
    let count = 0;
    chest.onMutate = () => count++;
    chest.set(0, null);
    expect(count).toBe(1);
  });
});
