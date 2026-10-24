/**
 * 洞穴藤蔓（批次 496，D23）
 *
 * 五块：
 *  ① 方块与状态位（有浆果 / 没浆果）；
 *  ② 支撑判据（**上方**支撑，一节串一节）——它与"下方支撑"那一族正好相反；
 *  ③ 往下扫（拆上面一节，下面跟着掉）——`sweepUnsupported` 是往上扫的，够不到；
 *  ④ 放置（上方必须实心、浆果五五开）；
 *  ⑤ 贴图与"不掉自己"（只掉浆果）。
 */

import { Block, CAVE_VINES_ID, blockDef } from '../src/core/registry/blocks.ts';
import { dropFor } from '../src/core/registry/items.ts';
import {
  caveVinesHaveBerries,
  withCaveVinesBerries,
} from '../src/core/registry/blockState.ts';
import { collisionBoxes, meshBoxes } from '../src/core/registry/blockShapes.ts';
import { supportIsValid, supportKindOf, sweepCaveVinesBelow, type SupportWorld } from '../src/core/world/Support.ts';
import { planPlacement } from '../src/core/interaction/Placement.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { readFileSync } from 'node:fs';

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

console.log('\n[方块与状态位]');
{
  equal('id 是 719', CAVE_VINES_ID, 719);
  equal('注册名', blockDef(Block.CAVE_VINES).name, 'minicraft:cave_vines');
  equal('形状是 cave_vines', blockDef(Block.CAVE_VINES).shape, 'cave_vines');
  equal('没有碰撞（走得过去）', collisionBoxes('cave_vines', 0).length, 0);

  equal('默认没有浆果', caveVinesHaveBerries(0), false);
  equal('打上浆果位', caveVinesHaveBerries(withCaveVinesBerries(0, true)), true);
  equal('去掉浆果位', caveVinesHaveBerries(withCaveVinesBerries(withCaveVinesBerries(0, true), false)), false);

  const plain = blockDef(Block.CAVE_VINES).stateTiles!(0);
  const berried = blockDef(Block.CAVE_VINES).stateTiles!(withCaveVinesBerries(0, true));
  equal('没浆果用光秃那张', plain[0], 'cave_vines');
  equal('有浆果换一张', berried[0], 'cave_vines_berries');
  check('两张图都登记进图集了', TILE_ORDER.includes('cave_vines') && TILE_ORDER.includes('cave_vines_berries'));

  // 藤蔓本身不掉（只掉浆果）
  equal('挖掉不掉藤蔓自己', dropFor(Block.CAVE_VINES), null);

  const boxes = meshBoxes('cave_vines', 0);
  equal('几何是两条交叉薄片', boxes.length, 2);
  check('从半格左右开始垂（下半格留空）', boxes.every((box) => box[1] > 0), boxes.map((box) => box[1]).join(','));
}

console.log('\n[支撑：上方支撑、一节串一节]');
{
  equal('支撑类型是 ceiling', supportKindOf(Block.CAVE_VINES), 'ceiling');

  function world(blocks: Record<string, number>): SupportWorld {
    return {
      getBlock: (x, y, z) => blocks[`${x},${y},${z}`] ?? Block.AIR,
      // 支撑判定只读不写；给个空实现是为了满足 `SupportWorld` 的形状
      setBlock: () => {},
    };
  }

  check(
    '上方是实心 → 立得住',
    supportIsValid(world({ '0,65,0': Block.STONE, '0,64,0': Block.CAVE_VINES }), 0, 64, 0),
  );
  check(
    '上方还是藤蔓 → 也立得住（垂下来的一串）',
    supportIsValid(world({ '0,65,0': Block.CAVE_VINES, '0,64,0': Block.CAVE_VINES }), 0, 64, 0),
  );
  check(
    '上方是空气 → 立不住',
    !supportIsValid(world({ '0,64,0': Block.CAVE_VINES }), 0, 64, 0),
  );
  check(
    '上方是水 → 立不住（水不算支撑）',
    !supportIsValid(world({ '0,65,0': Block.WATER, '0,64,0': Block.CAVE_VINES }), 0, 64, 0),
  );
}

console.log('\n[往下扫：拆上面一节，下面的跟着掉]');
{
  const blocks: Record<string, number> = {
    '0,66,0': Block.STONE,
    '0,65,0': Block.CAVE_VINES,
    '0,64,0': Block.CAVE_VINES,
    '0,63,0': Block.CAVE_VINES,
    '0,62,0': Block.STONE, // 到底了：扫描要在这里停下
  };
  const removed: string[] = [];
  const count = sweepCaveVinesBelow(
    {
      getBlock: (x, y, z) => blocks[`${x},${y},${z}`] ?? Block.AIR,
      setBlock: (x, y, z) => {
        blocks[`${x},${y},${z}`] = Block.AIR;
        removed.push(`${x},${y},${z}`);
      },
    },
    0,
    65,
    0,
    (x, y, z) => removed.push(`cb:${x},${y},${z}`),
  );
  equal('拆掉 65 之后下面两节被清掉', count, 2);
  equal('回调也收到了两次', removed.filter((entry) => entry.startsWith('cb:')).length, 2);
  equal('碰到石头就停（没有把石头当藤蔓清掉）', blocks['0,62,0'], Block.STONE);
  equal('再扫一次没有可清的了', sweepCaveVinesBelow({ getBlock: () => Block.AIR, setBlock: () => {} }, 0, 65, 0), 0);
}

console.log('\n[放置]');
{
  function place(above: number, random: number): ReturnType<typeof planPlacement> {
    return planPlacement({
      blockId: Block.CAVE_VINES,
      normal: [0, 1, 0],
      hitX: 0.5,
      hitY: 63,
      hitZ: 0.5,
      yaw: 0,
      random: () => random,
      sneaking: false,
      blockAt: (dx, dy, dz) => {
        if (dx === 0 && dz === 0 && dy === 1) return above;
        return Block.AIR;
      },
      hitBlock: above,
      hitState: 0,
    });
  }

  // `random() < 0.5` 才带浆果：0.1 落在前半段（有）、0.9 落在后半段（没有）
  const berried = place(Block.STONE, 0.1);
  check('上方实心 → 放得下', berried !== null);
  equal('随机数偏低（0.1）→ 有浆果', caveVinesHaveBerries(berried?.state ?? 0), true);
  const plain = place(Block.STONE, 0.9);
  equal('随机数偏高（0.9）→ 没浆果', caveVinesHaveBerries(plain?.state ?? 0), false);
  equal('上方是空气 → 放不下（藤要挂在洞顶）', place(Block.AIR, 0.5), null);
}

console.log('\n[地物接线（源码守卫）]');
{
  const generator = readFileSync(new URL('../src/core/gen/OverworldGenerator.ts', import.meta.url), 'utf8');
  check(
    '繁茂洞穴的洞顶会垂藤（判据看的是上方）',
    /lush && stoneLike\(above\)[\s\S]{0,400}Block\.CAVE_VINES/.test(generator),
  );
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('破坏有浆果的那节会掉发光浆果', /caveVinesHaveBerries\(brokenState\)[\s\S]{0,120}spawnDrop\(Block\.GLOW_BERRIES/.test(mainSrc));
  check('破坏时往下扫', /sweepCaveVinesBelow\(/.test(mainSrc));
}

console.log(`\n洞穴藤蔓测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
