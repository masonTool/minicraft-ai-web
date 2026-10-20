/**
 * 盾牌离线测试（批次 194，B18）
 *
 * 挡伤害这件事的每一条判据都能单独算，所以全收在 `core/items/Shield.ts` 里，
 * 这一套就盯那几条 + 物品与配方：
 *
 *  1. **物品**：耐久 336、不可堆叠、图标与说明都在；
 *  2. **配方**：6 木板 + 1 铁锭（原版图案），真的能合出来；
 *  3. **能挡什么**：白名单只有近战（generic）与弹射物（projectile）；
 *  4. **正面判定**：正前方挡、背后不挡、正侧面（点乘 0）不挡；
 *  5. **磨损**：`1 + ⌊伤害 / 5⌋`；
 *  6. **退化输入**：贴脸（方向退化）按正面算，避免"站在同一个点就被穿透"。
 *
 * 运行：npm run test:shield
 */

import { readFileSync } from 'node:fs';
import { Item, CREATIVE_ITEMS, itemDef, durabilityOf, maxStackOf } from '../src/core/registry/items.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { itemLabel, itemDescription, hasDescription } from '../src/core/registry/itemNames.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import {
  SHIELD_DISABLE_SECONDS,
  SHIELD_DURABILITY,
  SHIELD_KNOCKBACK,
  SHIELD_SLOWDOWN,
  canBlockDamage,
  isFrontalAttack,
  isShield,
  shieldWear,
} from '../src/core/items/Shield.ts';

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

const TILES = new Set<string>(TILE_ORDER);

console.log('\n[物品]');
{
  equal('中文名', itemLabel(Item.SHIELD), '盾牌');
  equal('耐久上限 336（原版数值）', durabilityOf(Item.SHIELD), SHIELD_DURABILITY);
  equal('不可堆叠', maxStackOf(Item.SHIELD), 1);
  check('图标在图集里', TILES.has(itemDef(Item.SHIELD)!.tile));
  check('创造栏里能拿到', CREATIVE_ITEMS.includes(Item.SHIELD));
  check('有说明', hasDescription(Item.SHIELD));
  check('说明写了"按住右键"与"挡"', itemDescription(Item.SHIELD).includes('右键') && itemDescription(Item.SHIELD).includes('挡'));
  check('说明写了斧头会破防', itemDescription(Item.SHIELD).includes('斧头') && itemDescription(Item.SHIELD).includes('破防'));
}

console.log('\n[配方]');
{
  const recipe = RECIPES.find((entry) => entry.result.id === Item.SHIELD);
  check('有一条盾牌配方', recipe !== undefined);
  equal('有序配方（原版是图案）', recipe?.kind, 'shaped');
  equal('产 1 面', recipe?.result.count, 1);

  // 6 木板 + 1 铁锭：按原版图案摆一次
  const P = Block.OAK_PLANKS;
  const cells = [P, Item.IRON_INGOT, P, P, P, P, 0, P, 0];
  equal('按图案摆能合出来', matchRecipe(cells, 3)?.id, Item.SHIELD);
  equal('少一块木板就合不出来', matchRecipe([P, Item.IRON_INGOT, P, P, P, P, 0, 0, 0], 3), null);
  equal('中间那块必须是铁锭', matchRecipe([P, P, P, P, P, P, 0, P, 0], 3), null);
}

console.log('\n[能挡什么]');
{
  check('近战（generic）能挡', canBlockDamage('generic'));
  check('箭矢（projectile）能挡', canBlockDamage('projectile'));
  check('正面爆炸（explosion）能挡', canBlockDamage('explosion'));
  for (const cause of ['fire', 'fall', 'poison', 'drown', 'lava', 'cactus', 'suffocate', 'starve', 'void', 'lightning', 'nonsense']) {
    check(`${cause} 挡不住`, !canBlockDamage(cause));
  }
  equal('举盾减速到 30%', SHIELD_SLOWDOWN, 0.3);
  equal('斧头破防 5 秒', SHIELD_DISABLE_SECONDS, 5);
}

console.log('\n[正面判定]');
{
  // 朝向 (0,-1)（yaw = 0 时玩家的正前方）
  const fx = 0;
  const fz = -1;
  check('正前方的攻击能挡', isFrontalAttack(fx, fz, 0, -3));
  check('背后的攻击挡不住', !isFrontalAttack(fx, fz, 0, 3));
  check('正侧面（点乘 0）挡不住', !isFrontalAttack(fx, fz, 3, 0));
  check('斜前方（45°）能挡', isFrontalAttack(fx, fz, 3, -3));
  check('斜后方（135°）挡不住', !isFrontalAttack(fx, fz, 3, 3));
  check('贴脸（方向退化）按正面算', isFrontalAttack(fx, fz, 0, 0));
  // 朝向换成 +X（yaw = -90°）：同一批结论要跟着转
  check('转向后同一个方向也能挡', isFrontalAttack(1, 0, 3, 0));
}

console.log('\n[磨损]');
{
  equal('伤害 0 不磨损', shieldWear(0), 0);
  equal('负伤害不磨损', shieldWear(-4), 0);
  equal('NaN 不磨损', shieldWear(Number.NaN), 0);
  equal('1 点伤害磨 1', shieldWear(1), 1);
  equal('4 点伤害磨 1', shieldWear(4), 1);
  equal('5 点伤害磨 2', shieldWear(5), 2);
  equal('9 点伤害磨 2', shieldWear(9), 2);
  equal('10 点伤害磨 3', shieldWear(10), 3);
  check('一处小伤挡 336 次才碎（不夸张）', Math.floor(SHIELD_DURABILITY / shieldWear(3)) > 200);
  check('挡下只有一点点后仰', SHIELD_KNOCKBACK > 0 && SHIELD_KNOCKBACK < 3);
}

console.log('\n[是不是盾牌]');
{
  check('盾牌是盾牌', isShield({ id: Item.SHIELD, count: 1 }));
  check('（对照）木板不是', !isShield({ id: Block.OAK_PLANKS, count: 1 }));
  check('null 不是', !isShield(null));
  check('undefined 不是', !isShield(undefined));
}

console.log('\n[接线守卫（批次 551）]');
{
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('举盾减速接进物理倍率', mainSrc.includes('(this.isShieldUp ? SHIELD_SLOWDOWN : 1)'));
  check('斧头命中写入破防计时', mainSrc.includes('this.shieldDisabled = SHIELD_DISABLE_SECONDS'));
  check('破防期间 `isShieldUp` 为假', mainSrc.includes('this.shieldDisabled > 0'));
}

console.log(`\n盾牌测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
