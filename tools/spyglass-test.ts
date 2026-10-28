/**
 * 望远镜（B15 的 1.17 尾巴，批次 518）
 *
 * 三层：物品与配方、FOV 纯函数、主程序接线守卫。
 *
 * 运行：npm run test:spyglass
 */

import { readFileSync } from 'node:fs';
import { Item } from '../web/src/core/registry/items.ts';
import { itemDef, maxStackOf } from '../web/src/core/registry/items.ts';
import { itemLabel } from '../web/src/core/registry/itemNames.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import {
  SPYGLASS_MIN_FOV,
  SPYGLASS_ZOOM,
  isSpyglassZoomed,
  spyglassFov,
} from '../web/src/core/items/Spyglass.ts';

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

function near(label: string, actual: number, expected: number): void {
  check(label, Math.abs(actual - expected) < 1e-9, `实际 ${actual}，期望 ${expected}`);
}

console.log('\n[物品与配方]');
{
  check('物品已注册', itemDef(Item.SPYGLASS) !== undefined);
  equal('注册名', itemDef(Item.SPYGLASS)?.name, 'minicraft:spyglass');
  equal('中文名', itemLabel(Item.SPYGLASS), '望远镜');
  equal('不能叠（原版也是 1）', maxStackOf(Item.SPYGLASS), 1);
  check('图标贴图已登记进图集', TILE_ORDER.includes('item_spyglass'));

  const AIR = 0;
  const made = matchRecipe(
    [AIR, Item.COPPER_INGOT, AIR, AIR, Item.AMETHYST_SHARD, AIR, AIR, Item.COPPER_INGOT, AIR],
    3,
  );
  equal('2 铜锭 + 1 紫水晶碎片 → 望远镜', made?.id, Item.SPYGLASS);
  equal('做出 1 个', made?.count, 1);
  check(
    '三块铜锭不会合成望远镜（那是避雷针的配方）',
    matchRecipe([AIR, Item.COPPER_INGOT, AIR, AIR, Item.COPPER_INGOT, AIR, AIR, Item.COPPER_INGOT, AIR], 3)?.id !==
      Item.SPYGLASS,
  );
}

console.log('\n[FOV 换算]');
{
  near('桌面 70° → 8.4°', spyglassFov(70), 70 * SPYGLASS_ZOOM);
  near('手机 90° → 10.8°', spyglassFov(90), 90 * SPYGLASS_ZOOM);
  near('脏数据（0）按 70 算', spyglassFov(0), 70 * SPYGLASS_ZOOM);
  near('脏数据（NaN）按 70 算', spyglassFov(Number.NaN), 70 * SPYGLASS_ZOOM);
  equal('极小的基础视野夹到下限', spyglassFov(30), SPYGLASS_MIN_FOV);
  check('放大后一定比基础小', spyglassFov(70) < 70 && spyglassFov(90) < 90);

  check('放大中（8.4 / 70）', isSpyglassZoomed(8.4, 70));
  check('没放大（70 / 70）', !isSpyglassZoomed(70, 70));
  check('四成（28 / 70）仍算放大', isSpyglassZoomed(28, 70));
  check('六成（42 / 70）不算放大', !isSpyglassZoomed(42, 70));
}

console.log('\n[接线守卫]');
{
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  check('主程序每帧更新 FOV', mainSrc.includes('this.updateCameraFov(dt);'));
  check('用的是纯函数倍率', mainSrc.includes('spyglassFov(base)'));
  check(
    '只有拿着望远镜 + 按住使用键才放大',
    mainSrc.includes('this.heldItemId === Item.SPYGLASS && this.usingItem && !this.uiOpen && !this.stats.dead'),
  );
  check('进退有缓动', mainSrc.includes('SPYGLASS_EASE_IN') && mainSrc.includes('SPYGLASS_EASE_OUT'));
}

console.log(`\n望远镜测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
