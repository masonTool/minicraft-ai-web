/**
 * 水浸（批次 469）
 *
 * 四条判据：
 *  ① **状态位**：bit7 单独存"含水"，不与台阶的双层（bit6）、朝向（bit1-2）、门的
 *     六个位打架；
 *  ② **谁可以含水**：只有非整格形状族（台阶/楼梯/栅栏/墙/活板门/玻璃板/门/栅栏门/告示牌）；
 *     整格方块、水、雪层都不行；
 *  ③ **放置**：落点原本是水 → 打标记；不是水 → 原样；
 *  ④ **破坏**：含水方块挖掉变回水，其余变空气。
 *
 * 运行：npm run test:waterlogged
 */

import {
  Block,
  blockAfterBreak,
  canBeWaterlogged,
  slabId,
  stairsId,
  waterloggedPlacementState,
} from '../src/core/registry/blocks.ts';
import { GLASS_PANE_ID } from '../src/core/registry/blocks.ts';
import {
  isSlabDouble,
  isWaterlogged,
  withFacing,
  withSlabDouble,
  withWaterlogged,
} from '../src/core/registry/blockState.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

// 石头台阶 / 石头楼梯：形状分别是 slab / stairs，足够验证"非整格可以含水"
const slab = slabId(0);
const stairs = stairsId(0);

console.log('\n[状态位：bit7 单独存水浸]');
{
  equal('默认不是含水', isWaterlogged(0), false);
  equal('打上标记', isWaterlogged(withWaterlogged(0, true)), true);
  equal('去掉标记', isWaterlogged(withWaterlogged(withWaterlogged(0, true), false)), false);

  // 台阶：朝向（bit1-2）+ 双层（bit6）+ 水浸（bit7）三者共存
  const stairsState = withWaterlogged(withSlabDouble(withFacing(0, 2), true), true);
  equal('朝向还在', (stairsState & 0b110) >> 1, 2);
  equal('双层还在', isSlabDouble(stairsState), true);
  equal('水浸还在', isWaterlogged(stairsState), true);
  // 反过来：清掉水浸之后，另两位仍原样
  const cleared = withWaterlogged(stairsState, false);
  equal('清掉水浸后朝向还在', (cleared & 0b110) >> 1, 2);
  equal('清掉水浸后双层还在', isSlabDouble(cleared), true);

  // 老存档（bit7 = 0）读出来就是"不含水"
  equal('老存档的 state 读作不含水', isWaterlogged(0b0111_1111), false);
}

console.log('\n[谁可以含水]');
{
  check('台阶可以', canBeWaterlogged(slab));
  check('楼梯可以', canBeWaterlogged(stairs));
  check('栅栏可以', canBeWaterlogged(Block.OAK_FENCE));
  check('栅栏门可以', canBeWaterlogged(Block.OAK_FENCE_GATE));
  check('玻璃板可以', canBeWaterlogged(GLASS_PANE_ID));
  check('活板门可以', canBeWaterlogged(Block.OAK_TRAPDOOR));
  check('门可以', canBeWaterlogged(Block.OAK_DOOR));
  check('告示牌可以', canBeWaterlogged(Block.OAK_SIGN));

  check('石头不行（整格）', !canBeWaterlogged(Block.STONE));
  check('木板不行（整格）', !canBeWaterlogged(Block.OAK_PLANKS));
  check('水自己不行', !canBeWaterlogged(Block.WATER));
  // 雪层的 bits5-7 全被层数占了，这一位不能借给它
  check('雪层不行（它的高位被层数占了）', !canBeWaterlogged(Block.SNOW));
}

console.log('\n[放置与破坏]');
{
  // 放置：水里放台阶 → 打标记；空气里放 → 不打
  equal('水里放台阶会打上水浸标记', isWaterlogged(waterloggedPlacementState(slab, 0, Block.WATER)), true);
  equal('空气里放台阶不打标记', isWaterlogged(waterloggedPlacementState(slab, 0, Block.AIR)), false);
  equal('水里放石头不打标记（整格不能含水）', waterloggedPlacementState(Block.STONE, 0, Block.WATER), 0);
  equal('水里放台阶保留原本的朝向', waterloggedPlacementState(slab, withFacing(0, 3), Block.WATER) & 0b110, withFacing(0, 3) & 0b110);

  // 破坏：含水 → 水；干 → 空气
  equal('挖掉含水台阶 → 变回水', blockAfterBreak(slab, withWaterlogged(0, true)), Block.WATER);
  equal('挖掉干台阶 → 空气', blockAfterBreak(slab, 0), Block.AIR);
  equal('挖掉含水台阶的**双层**形态也变回水', blockAfterBreak(slab, withWaterlogged(withSlabDouble(0, true), true)), Block.WATER);
  equal('挖掉石头 → 空气（与含水无关）', blockAfterBreak(Block.STONE, 0), Block.AIR);
  // 负对照：整格方块即使被人为打上 bit7，也不该变成水
  equal('整格方块上的脏 bit7 不会让破坏变成水', blockAfterBreak(Block.STONE, withWaterlogged(0, true)), Block.AIR);
}

console.log(`\n水浸测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
