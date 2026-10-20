/**
 * 旗帜（批次 484：从"两片交叉薄片"改成真正的 2 格高旗面）
 *
 * 四块：
 *  ① 16 色方块本身（id 连续、名字对、`isBannerId`）；
 *  ② 上半位（`BANNER_TOP_MASK`）；
 *  ③ 几何（杆 + 布两个盒子、无碰撞）；
 *  ④ 放置（占两格、上方必须是空气、下方要实心）。
 */

import { Block, BANNER_ID_START, blockDef, isBannerId } from '../src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { isBannerTop, withBannerTop } from '../src/core/registry/blockState.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';

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

console.log('\n[16 色旗帜方块]');
{
  equal('id 从 640 起', BANNER_ID_START, 640);
  check('白色旗帜是旗帜', isBannerId(Block.WHITE_BANNER));
  check('黑色旗帜是旗帜', isBannerId(Block.BLACK_BANNER));
  check('石头不是旗帜', !isBannerId(Block.STONE));
  check('边界外不是旗帜', !isBannerId(BANNER_ID_START - 1) && !isBannerId(BANNER_ID_START + 16));

  let named = 0;
  for (let i = 0; i < 16; i++) {
    const id = BANNER_ID_START + i;
    if (blockDef(id).name.endsWith('_banner')) named++;
  }
  equal('16 种都注册成 *_banner', named, 16);
  equal('白色旗帜的中文名', itemLabel(Block.WHITE_BANNER), '白色旗帜');
  equal('所有旗帜都是 banner 形状', blockDef(Block.RED_BANNER).shape, 'banner');
}

console.log('\n[上半格标记]');
{
  equal('默认是下半', isBannerTop(0), false);
  equal('打上上半位', isBannerTop(withBannerTop(0, true)), true);
  equal('去掉上半位', isBannerTop(withBannerTop(withBannerTop(0, true), false)), false);
  equal('打上半位不影响其它位', withBannerTop(0b101, true) & 0b111, 0b101);
}

console.log('\n[几何：一根杆 + 一面布]');
{
  const boxes = meshBoxes('banner', 0);
  equal('两个盒子（杆 + 布）', boxes.length, 2);
  const pole = boxes[0]!;
  const cloth = boxes[1]!;
  check('杆是细立柱（1/16 宽）', Math.abs(pole[3]! - pole[0]! - 2 / 16) < 1e-6, `${pole[3]! - pole[0]!}`);
  check('布比杆宽得多', cloth[3]! - cloth[0]! > pole[3]! - pole[0]!, `${cloth[3]! - cloth[0]!}`);
  check('布很薄（1/16 厚）', Math.abs(cloth[5]! - cloth[2]! - 1 / 16) < 1e-6, `${cloth[5]! - cloth[2]!}`);
  check('杆与布都是整格高（上下半叠起来才有 2 格）', Math.abs(pole[4]! - 1) < 1e-6 && Math.abs(cloth[4]! - 1) < 1e-6);
  equal('旗帜没有碰撞盒（能从旗子里走过去）', collisionBoxes('banner', 0).length, 0);
}

console.log('\n[放置：占两格]');
{
  function place(options: { below?: number; above?: number } = {}): ReturnType<typeof planPlacement> {
    const below = options.below ?? Block.STONE;
    const above = options.above ?? Block.AIR;
    return planPlacement({
      blockId: Block.WHITE_BANNER,
      normal: [0, 1, 0],
      hitX: 0.5,
      hitY: 63,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      blockAt: (dx, dy, dz) => {
        if (dx !== 0 || dz !== 0) return Block.AIR;
        if (dy === -1) return below;
        if (dy === 1) return above;
        return Block.AIR;
      },
      hitBlock: below,
      hitState: 0,
    });
  }

  const plan = place();
  check('下方实心 + 上方空气 → 放得下', plan !== null);
  equal('下半格没有上半位', isBannerTop(plan?.state ?? 0), false);
  check('上半格由 extra 一起放下去', plan?.extra !== undefined, JSON.stringify(plan?.extra));
  equal('上半格是同一面旗帜', plan?.extra?.id, Block.WHITE_BANNER);
  equal('上半格带着上半位', isBannerTop(plan?.extra?.state ?? 0), true);
  equal('上半格在这一格的正上方', `${plan?.extra?.dx},${plan?.extra?.dy},${plan?.extra?.dz}`, '0,1,0');

  equal('上方被占住 → 放不下（不剩半面旗）', place({ above: Block.STONE }), null);
  equal('下方是空的 → 放不下（杆立不住）', place({ below: Block.AIR }), null);
}

console.log(`\n旗帜测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
