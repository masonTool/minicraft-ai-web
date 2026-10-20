/**
 * 海绵（批次 449）
 *
 * 这一批有四条**判据很硬**的规则，全部能离线钉住：
 *  ① 半径 3 的 7×7×7 立方体；
 *  ② 最多 65 格（比范围更早生效）；
 *  ③ 只吸水，不吸岩浆；附近没水就一格都不吸（干海绵保持干海绵）；
 *  ④ 湿海绵只能靠熔炉烤干变回海绵（这是整条链的闭环）。
 *
 * 剩下"放下时自动吸水并变湿"那一半在 `main.absorbWithSponge`（要真世界），
 * 这里只钉住它依赖的纯逻辑与注册表。
 *
 * 运行：npm run test:sponge
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import { ITEMS } from '../src/core/registry/items.ts';
import { blockLabel } from '../src/core/registry/itemNames.ts';
import { SPONGE_MAX_ABSORB, SPONGE_RADIUS, absorbWater, type SpongeWorld } from '../src/core/world/Sponge.ts';
import { smeltingRecipeFor } from '../src/core/crafting/Smelting.ts';

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

/** 一小块只认"读一格 / 写一格"的假世界 */
class Pool implements SpongeWorld {
  readonly blocks = new Map<string, number>();

  private static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  set(x: number, y: number, z: number, id: number): void {
    this.blocks.set(Pool.key(x, y, z), id);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(Pool.key(x, y, z)) ?? Block.AIR;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    this.blocks.set(Pool.key(x, y, z), id);
    return true;
  }
}

console.log('\n[注册：方块 / 物品 / 中文名]');
{
  equal('海绵的注册名', blockDef(Block.SPONGE).name, 'minecraft:sponge');
  equal('湿海绵的注册名', blockDef(Block.WET_SPONGE).name, 'minecraft:wet_sponge');
  check('两个都是实心整格', blockDef(Block.SPONGE).solid && blockDef(Block.WET_SPONGE).solid);
  check(
    '六个面同一张贴图（原版也是如此）',
    blockDef(Block.SPONGE).tiles.length === 3 && new Set(blockDef(Block.SPONGE).tiles).size === 1,
    JSON.stringify(blockDef(Block.SPONGE).tiles),
  );
  check('方块物品自动注册（id 与方块相同）', ITEMS[Block.SPONGE]?.block === Block.SPONGE);
  equal('中文名', blockLabel(Block.SPONGE), '海绵');
  equal('湿海绵中文名', blockLabel(Block.WET_SPONGE), '湿海绵');
}

console.log('\n[吸水：范围 / 上限 / 只吸水]');
{
  // 7×7×7 全灌满水（中心那一格放海绵自己）
  const pool = new Pool();
  for (let dy = -SPONGE_RADIUS; dy <= SPONGE_RADIUS; dy++) {
    for (let dx = -SPONGE_RADIUS; dx <= SPONGE_RADIUS; dx++) {
      for (let dz = -SPONGE_RADIUS; dz <= SPONGE_RADIUS; dz++) {
        pool.set(dx, dy, dz, Block.WATER);
      }
    }
  }
  pool.set(0, 0, 0, Block.SPONGE);

  const absorbed = absorbWater(pool, 0, 0, 0);
  equal('一次最多吸 65 格', absorbed, SPONGE_MAX_ABSORB);
  check('身边那一圈被吸空（近处优先）', pool.getBlock(1, 0, 0) === Block.AIR);
  check('立方体角落还剩水（范围之外/上限之外都不动）', pool.getBlock(3, 3, 3) === Block.WATER);
  check('海绵自己那格没被改掉', pool.getBlock(0, 0, 0) === Block.SPONGE);

  // 只剩 3 格水：吸 3 格，不虚报
  const tiny = new Pool();
  tiny.set(0, 0, 0, Block.SPONGE);
  tiny.set(1, 0, 0, Block.WATER);
  tiny.set(0, 1, 0, Block.WATER);
  tiny.set(0, 0, 1, Block.WATER);
  equal('有多少吸多少', absorbWater(tiny, 0, 0, 0), 3);

  // 附近没水 → 0（调用方据此保持干海绵）
  const dry = new Pool();
  dry.set(0, 0, 0, Block.SPONGE);
  equal('附近没水就一格都不吸', absorbWater(dry, 0, 0, 0), 0);

  // 岩浆不吸
  const lava = new Pool();
  lava.set(0, 0, 0, Block.SPONGE);
  lava.set(1, 0, 0, Block.LAVA);
  lava.set(0, 0, 1, Block.LAVA);
  equal('岩浆不算水', absorbWater(lava, 0, 0, 0), 0);
  check('岩浆还在原地', lava.getBlock(1, 0, 0) === Block.LAVA);
}

console.log('\n[闭环：湿海绵烤干 → 海绵]');
{
  const recipe = smeltingRecipeFor(Block.WET_SPONGE);
  check('湿海绵有熔炼配方', recipe !== undefined, JSON.stringify(recipe));
  equal('产物是干海绵', recipe?.output.id, Block.SPONGE);
  equal('一次烤出一个', recipe?.output.count, 1);
}

console.log(`\n海绵测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
