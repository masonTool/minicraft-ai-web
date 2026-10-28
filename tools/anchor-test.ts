/**
 * 重生锚（批次 454）
 *
 * 四条判据都能离线钉住：
 *  ① 充能档位存在状态位低 3 位，0~4，越界夹紧；
 *  ② 发光随档位走（0 → 不亮，4 → 12）；
 *  ③ 方块/物品/中文名注册齐全；
 *  ④ 配方是"6 哭泣的黑曜石 + 3 荧石"（原版图案）。
 *
 * "右键荧石充能 / 右键设重生点"那两半在主程序里（要背包与世界），
 * 这里只钉住它们依赖的纯函数与数据。
 *
 * 运行：npm run test:anchor
 */

import { Block, blockDef } from '../web/src/core/registry/blocks.ts';
import { ITEMS } from '../web/src/core/registry/items.ts';
import { blockLabel } from '../web/src/core/registry/itemNames.ts';
import {
  RESPAWN_ANCHOR_MAX_CHARGE,
  anchorCharge,
  anchorLight,
  withAnchorCharge,
} from '../web/src/core/world/RespawnAnchor.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';

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

console.log('\n[充能档位（纯函数）]');
{
  equal('刚放下是 0 级', anchorCharge(0), 0);
  equal('写 1 级', anchorCharge(withAnchorCharge(0, 1)), 1);
  equal('写 4 级（上限）', anchorCharge(withAnchorCharge(0, 4)), 4);
  equal('超过 4 级夹到 4', anchorCharge(withAnchorCharge(0, 9)), RESPAWN_ANCHOR_MAX_CHARGE);
  equal('负数夹到 0', anchorCharge(withAnchorCharge(0, -3)), 0);
  equal('小数向下取整', anchorCharge(withAnchorCharge(0, 2.9)), 2);
  // 坏存档里被写进 5~7：读的时候也要夹住，不能让"5 级充能"这种状态流进玩法
  equal('坏状态 5 读成 4', anchorCharge(5), 4);
  // 其它位要原样保留（将来若给锚加朝向，不能因为写充能把它清掉）
  equal('只改低 3 位，其余位保留', withAnchorCharge(0b11000, 2), 0b11010);

  equal('0 级不亮', anchorLight(0), 0);
  equal('1 级亮 3', anchorLight(withAnchorCharge(0, 1)), 3);
  equal('4 级亮 12', anchorLight(withAnchorCharge(0, 4)), 12);
  check('越充越亮（单调）', anchorLight(withAnchorCharge(0, 1)) < anchorLight(withAnchorCharge(0, 4)));
}

console.log('\n[注册：方块 / 物品 / 中文名 / 贴图]');
{
  equal('注册名', blockDef(Block.RESPAWN_ANCHOR).name, 'minicraft:respawn_anchor');
  equal('中文名', blockLabel(Block.RESPAWN_ANCHOR), '重生锚');
  check('实心整格', blockDef(Block.RESPAWN_ANCHOR).solid);
  check('方块物品自动注册', ITEMS[Block.RESPAWN_ANCHOR]?.block === Block.RESPAWN_ANCHOR);
  let tiled = true;
  for (const tile of blockDef(Block.RESPAWN_ANCHOR).tiles) {
    if (!TILE_ORDER.includes(tile)) tiled = false;
  }
  check('三张贴图都在图集名单里', tiled, JSON.stringify(blockDef(Block.RESPAWN_ANCHOR).tiles));
  const light = blockDef(Block.RESPAWN_ANCHOR).stateLight;
  check('发光跟着充能走（不是固定值）', typeof light === 'function' && light(0) === 0 && light(4) === 12);
}

console.log('\n[配方：6 哭泣的黑曜石 + 3 荧石]');
{
  // `matchRecipe` 要的是"非空物品 id 的网格"（空槽在界面层用 null，这里三排都是满的）
  const grid = (pattern: string[], key: Record<string, number>): number[] =>
    pattern.flatMap((row) => [...row].map((ch) => key[ch] ?? 0));
  const made = matchRecipe(
    grid(['CCC', 'GGG', 'CCC'], { C: Block.CRYING_OBSIDIAN, G: Block.GLOWSTONE }),
    3,
  );
  equal('标准图案做出重生锚', made?.id, Block.RESPAWN_ANCHOR);
  equal('一次一个', made?.count, 1);

  // 负对照：把荧石换成普通黑曜石 → 不出
  const wrong = matchRecipe(
    grid(['CCC', 'GGG', 'CCC'], { C: Block.CRYING_OBSIDIAN, G: Block.OBSIDIAN }),
    3,
  );
  check('荧石换成普通黑曜石就不出（负对照）', wrong?.id !== Block.RESPAWN_ANCHOR);
}

console.log(`\n重生锚测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
