/**
 * 旗帜（批次 484：从"两片交叉薄片"改成真正的 2 格高旗面）
 *
 * 四块：
 *  ① 16 色方块本身（id 连续、名字对、`isBannerId`）；
 *  ② 上半位（`BANNER_TOP_MASK`）；
 *  ③ 几何（杆 + 布两个盒子、无碰撞）；
 *  ④ 放置（占两格、上方必须是空气、下方要实心）。
 */

import { Block, BANNER_ID_START, bannerPatternTile, blockDef, isBannerId } from '../src/core/registry/blocks.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import {
  BANNER_PATTERNS,
  bannerPatternOf,
  facingOf,
  isBannerTop,
  isWallMounted,
  nextBannerPattern,
  withBannerPattern,
  withBannerTop,
  withFacing,
} from '../src/core/registry/blockState.ts';
import { DYE_COLORS } from '../src/core/registry/colors.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { readFileSync } from 'node:fs';
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
  function place(
    options: {
      below?: number;
      above?: number;
      normal?: [number, number, number];
      pattern?: number;
    } = {},
  ): ReturnType<typeof planPlacement> {
    const below = options.below ?? Block.STONE;
    const above = options.above ?? Block.AIR;
    return planPlacement({
      blockId: Block.WHITE_BANNER,
      normal: options.normal ?? [0, 1, 0],
      hitX: 0.5,
      hitY: 63,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      bannerPattern: options.pattern,
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

  // 图案跟着物品走（批次 502）：上下半格都要带同一份
  const patterned = place({ pattern: 3 });
  equal('图案写进下半格', bannerPatternOf(patterned?.state ?? 0), 3);
  equal('上半格带同一图案', bannerPatternOf(patterned?.extra?.state ?? 0), 3);
  equal('上半位与图案互不干扰', isBannerTop(patterned?.extra?.state ?? 0), true);
  equal('不给图案就是光板', bannerPatternOf(plan?.state ?? 0), 0);

  equal('上方被占住 → 放不下（不剩半面旗）', place({ above: Block.STONE }), null);
  equal('下方是空的 → 放不下（杆立不住）', place({ below: Block.AIR }), null);
}


console.log('\n[挂墙（批次 486）]');
{
  function place(
    options: {
      below?: number;
      above?: number;
      normal?: [number, number, number];
      pattern?: number;
    } = {},
  ): ReturnType<typeof planPlacement> {
    const below = options.below ?? Block.STONE;
    const above = options.above ?? Block.AIR;
    return planPlacement({
      blockId: Block.WHITE_BANNER,
      normal: options.normal ?? [0, 1, 0],
      hitX: 0.5,
      hitY: 63,
      hitZ: 0.5,
      yaw: 0,
      sneaking: false,
      bannerPattern: options.pattern,
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

  // 点北墙的南面（normal 朝南）→ 旗面朝南
  const south = place({ normal: [0, 0, 1] });
  check('点侧面能挂墙', south !== null);
  equal('挂墙标记', isWallMounted(south?.state ?? 0), true);
  equal('旗面朝南', facingOf(south?.state ?? 0), 2);
  equal('上半格也带着挂墙与朝向', isWallMounted(south?.extra?.state ?? 0), true);
  equal('上半格朝向一致', facingOf(south?.extra?.state ?? 0), 2);
  equal('上半格带着上半位', isBannerTop(south?.extra?.state ?? 0), true);

  // 挂墙同样要带图案（批次 502），而且不能把朝向挤掉
  const patternedWall = place({ normal: [0, 0, 1], pattern: 2 });
  equal('挂墙的下半格带图案', bannerPatternOf(patternedWall?.state ?? 0), 2);
  equal('挂墙的上半格带同一图案', bannerPatternOf(patternedWall?.extra?.state ?? 0), 2);
  equal('图案不影响朝向', facingOf(patternedWall?.state ?? 0), 2);
  equal('图案不影响挂墙标记', isWallMounted(patternedWall?.state ?? 0), true);

  equal('点西墙的东面 → 朝东', facingOf(place({ normal: [1, 0, 0] })?.state ?? 0), 1);
  equal('点东墙的西面 → 朝西', facingOf(place({ normal: [-1, 0, 0] })?.state ?? 0), 3);
  equal('点南墙的北面 → 朝北', facingOf(place({ normal: [0, 0, -1] })?.state ?? 0), 0);

  equal('不能挂天花板', place({ normal: [0, -1, 0] }), null);
  equal('上方被占 → 挂不了（不剩半面旗）', place({ normal: [0, 0, 1], above: Block.STONE }), null);

  // 几何：挂墙的杆贴墙、布朝外
  const hangingBoxes = meshBoxes('banner', south!.state);
  equal('挂墙也是两个盒子', hangingBoxes.length, 2);
  const pole = hangingBoxes[0]!;
  const cloth = hangingBoxes[1]!;
  check('杆贴在墙那一侧（z 靠 0）', pole[2]! < 1 / 16 + 1e-6, `z0=${pole[2]}`);
  check('布在杆的外侧（朝南展开）', cloth[5]! > pole[5]!, `布 z1=${cloth[5]} 杆 z1=${pole[5]}`);
  check('布的 z 跨度是 1/16 厚', Math.abs(cloth[5]! - cloth[2]! - 1 / 16) < 1e-6, `${cloth[5]! - cloth[2]!}`);

  // 立地几何不受影响
  const standing = meshBoxes('banner', 0);
  check('立地的杆在格心', Math.abs(standing[0]![0]! - 7 / 16) < 1e-6, `${standing[0]![0]}`);
}


console.log('\n[图案：状态位与循环（批次 497）]');
{
  equal('图案一共 5 档（光板 + 4 种）', BANNER_PATTERNS.length, 5);
  equal('默认是光板', bannerPatternOf(0), 0);
  equal('写第 3 种', bannerPatternOf(withBannerPattern(0, 3)), 3);
  equal('越界会夹到最后一档', bannerPatternOf(withBannerPattern(0, 99)), 4);
  equal('负数夹到 0', bannerPatternOf(withBannerPattern(0, -5)), 0);

  // 转一圈回到光板
  let state = 0;
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    state = nextBannerPattern(state);
    seen.push(bannerPatternOf(state));
  }
  equal('右键五次回到光板', seen.join(','), '1,2,3,4,0');

  // 与"上半格"位互不干扰
  const upper = withBannerTop(withBannerPattern(0, 2), true);
  equal('图案与上半位互不干扰', bannerPatternOf(upper), 2);
  equal('上半位还在', isBannerTop(upper), true);
  equal('改成第 4 种后上半位不变', isBannerTop(withBannerPattern(upper, 4)), true);
  // 批次 502 修掉的撞位：图案原来占 bit0-2，与朝向（bit1-2）重叠
  equal('换图案不碰朝向位（挂墙旗不会转向）', facingOf(withBannerPattern(withFacing(0, 2), 3)), 2);
  equal('换图案不碰挂墙位', isWallMounted(withBannerPattern(0b1000, 4)), true);

  equal('光板用原来那张贴图', bannerPatternTile('white', 0), 'banner_white');
  equal('有图案换成带后缀的', bannerPatternTile('white', 3), 'banner_white_p3');

  // 16 色 × 4 图案 = 64 张，全部要在图集里（漏一张会静默回退成别的图）
  const missing: string[] = [];
  for (const color of DYE_COLORS) {
    for (let index = 1; index <= 4; index++) {
      const tile = bannerPatternTile(color.name, index);
      if (!TILE_ORDER.includes(tile)) missing.push(tile);
    }
  }
  equal('64 张图案贴图全部登记进图集', missing.length, 0);
  check('（缺的是）', missing.length === 0, missing.slice(0, 4).join(' '));

  // 接线守卫
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  // 批次 503：右键免费换图案已删（改由织布机消耗染料），换成两条新守卫
  check('右键旗帜不再免费换图案（否则染料消耗形同虚设）', !mainSrc.includes('cycleBannerPattern'));
  check(
    '右键织布机打开织布机界面',
    /if \(hitBlock === Block\.LOOM\)[\s\S]{0,200}openWith\('loom'/.test(mainSrc),
  );
}

console.log(`\n旗帜测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
