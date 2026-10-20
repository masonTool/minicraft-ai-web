/**
 * 潮涌核心（批次 547）
 *
 * 覆盖：框架档位（16/30/42 块）、必须泡水、半径、方块/物品/配方接线。
 *
 * 运行：npm run test:conduit
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import { Item, itemDef } from '../src/core/registry/items.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import {
  CONDUIT_RADII,
  conduitRadius,
  conduitTier,
  countConduitFrame,
  isConduitFrameBlock,
  type ConduitWorld,
} from '../src/core/world/Conduit.ts';

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

class FrameWorld implements ConduitWorld {
  private readonly blocks = new Map<string, number>();

  set(x: number, y: number, z: number, id: number): void {
    this.blocks.set(`${x},${y},${z}`, id);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.blocks.get(`${x},${y},${z}`) ?? Block.AIR;
  }
}

/** 在半径 `radius` 的外壳上铺满海晶石（中心与内部保持空气） */
function fillShell(world: FrameWorld, radius: number, id = Block.PRISMARINE): void {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
        world.set(dx, dy, dz, id);
      }
    }
  }
}

console.log('\n[方块与材料]');
{
  equal('潮涌核心亮度 15', blockDef(Block.CONDUIT).light, 15);
  check('海洋之心已注册', itemDef(Item.HEART_OF_THE_SEA) !== undefined);
  check('鹦鹉螺壳已注册', itemDef(Item.NAUTILUS_SHELL) !== undefined);
  equal('海洋之心的中文名', itemLabel(Item.HEART_OF_THE_SEA), '海洋之心');
  equal('鹦鹉螺壳的中文名', itemLabel(Item.NAUTILUS_SHELL), '鹦鹉螺壳');
  check('海晶石/海晶石砖/暗海晶石/海灯都算框架', [
    Block.PRISMARINE,
    Block.PRISMARINE_BRICKS,
    Block.DARK_PRISMARINE,
    Block.SEA_LANTERN,
  ].every(isConduitFrameBlock));
  check('普通石头不算框架', !isConduitFrameBlock(Block.STONE));
}

console.log('\n[框架档位]');
{
  const world = new FrameWorld();
  world.set(0, 0, 0, Block.CONDUIT);
  // 3×3×3 框架会把核心六面全包住，所以水放在框架顶上（+4）
  world.set(0, 4, 0, Block.WATER);

  equal('没有框架 → 未激活', conduitTier(world, 0, 0, 0), 0);

  fillShell(world, 1);
  check('3×3×3 外壳有 26 块海晶石', countConduitFrame(world, 0, 0, 0, 1) === 26);
  equal('≥16 块 → 1 档', conduitTier(world, 0, 0, 0), 1);
  equal('1 档半径 32', conduitRadius(world, 0, 0, 0), CONDUIT_RADII[0]);

  // 更大档位要单独建世界：真实结构只会有**一层**外壳，
  // 把 3×3×3、5×5×5、7×7×7 同时铺满会得到 342 块，当然直接算最高档
  const tier2 = new FrameWorld();
  tier2.set(0, 0, 0, Block.CONDUIT);
  tier2.set(0, 4, 0, Block.WATER);
  fillShell(tier2, 2);
  equal('5×5×5 外壳（98 块）→ 2 档', conduitTier(tier2, 0, 0, 0), 2);
  equal('2 档半径 48', conduitRadius(tier2, 0, 0, 0), CONDUIT_RADII[1]);

  const tier3 = new FrameWorld();
  tier3.set(0, 0, 0, Block.CONDUIT);
  tier3.set(0, 4, 0, Block.WATER);
  fillShell(tier3, 3);
  equal('7×7×7 外壳（218 块）→ 3 档', conduitTier(tier3, 0, 0, 0), 3);
  equal('3 档半径 64', conduitRadius(tier3, 0, 0, 0), CONDUIT_RADII[2]);
}

console.log('\n[必须泡水 + 必须是潮涌核心]');
{
  const dry = new FrameWorld();
  dry.set(0, 0, 0, Block.CONDUIT);
  fillShell(dry, 1);
  equal('框架完整但不在水里 → 未激活', conduitTier(dry, 0, 0, 0), 0);

  const notConduit = new FrameWorld();
  notConduit.set(0, 0, 0, Block.PRISMARINE);
  notConduit.set(1, 0, 0, Block.WATER);
  fillShell(notConduit, 1);
  equal('方块不是潮涌核心 → 未激活', conduitTier(notConduit, 0, 0, 0), 0);
}

console.log('\n[配方与可达性]');
{
  const recipe = RECIPES.find((r) => r.result.id === Block.CONDUIT);
  check('有潮涌核心配方', recipe !== undefined);
  check(
    '配方是“1 海洋之心 + 8 鹦鹉螺壳”',
    recipe !== undefined &&
      recipe.kind === 'shaped' &&
      recipe.result.count === 1 &&
      recipe.pattern.join('|') === 'SSS|SHS|SSS' &&
      recipe.key.S === Item.NAUTILUS_SHELL &&
      recipe.key.H === Item.HEART_OF_THE_SEA,
  );
}

console.log(`\n潮涌核心测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
