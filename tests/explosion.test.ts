/**
 * 爆炸抗性（B5，批次 597）
 *
 * 钉住“哪些方块该留下”：
 *  - 黑曜石/铁砧/附魔台/基岩在普通爆炸下必须留下；
 *  - 石头/玻璃/泥土在 TNT/苦力怕量级下必须炸得掉；
 *  - 空气永远不算“被炸掉”（否则主循环会白跑一次 setBlock）。
 */

import { describe, expect, it } from 'vitest';
import { Block, blastResistanceOf, explosionBreaksBlock } from '../src/core/registry/blocks.ts';

describe('爆炸抗性', () => {
  it('基岩/黑曜石/铁砧/附魔台扛得住普通爆炸', () => {
    for (const id of [Block.BEDROCK, Block.OBSIDIAN, Block.ANVIL, Block.ENCHANTING_TABLE]) {
      expect(blastResistanceOf(id)).toBeGreaterThanOrEqual(1200);
      expect(explosionBreaksBlock(id, 10)).toBe(false);
    }
  });

  it('石头在 TNT 量级下会炸掉，玻璃在更小的爆炸下也会', () => {
    expect(explosionBreaksBlock(Block.STONE, 4)).toBe(true);
    expect(explosionBreaksBlock(Block.GLASS, 1)).toBe(true);
    expect(explosionBreaksBlock(Block.DIRT, 4)).toBe(true);
  });

  it('空气永远不参与破坏', () => {
    expect(explosionBreaksBlock(Block.AIR, 100)).toBe(false);
  });

  it('没显式登记的方块走硬度兜底，量级在 0.2~20 之间', () => {
    const resistance = blastResistanceOf(Block.CHEST);
    expect(resistance).toBeGreaterThanOrEqual(0.2);
    expect(resistance).toBeLessThanOrEqual(20);
  });
});
