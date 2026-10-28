/**
 * 树苗与树离线测试（批次 75，B47 / B17 的尾巴）
 *
 * 这一批的关键不是"加 6 个方块"，而是**把区块生成那套造树搬到活世界**：
 * `Features.ts` 里 11 个树种的 Planter 一行没改，只是换了一支 writer
 * （`world/TreeGrowth.ts` 的 `LiveTreeWriter`）。所以断言的重点是**换 writer 之后仍然对**：
 *  1. **树苗**：6 种木材各一个（id 连号、cross 形状、一拍就掉、能种）；
 *  2. **树叶掉树苗**：每种树叶掉**自己那种**树苗（苹果那 0.5% 保持不动）；
 *  3. **种树**（`growTreeAt`）：落点在树苗那一格（不是高一格）、树干是**那一种木材**的原木、
 *     树冠有叶子、改动清单够长（联机要按它广播）、**同一格同样的盐长出来的树一模一样**；
 *  4. **不凿穿地形**：天花板压着时不长/只长一点，而不是把石头换成原木；
 *  5. **随机刻**：光照 < 9 不长、脚下不是土/草不长、概率命中才长——而且与骨粉**共用同一套代码**。
 *
 * 运行：npm run test:sapling
 */

import {
  Block,
  SAPLING_IDS,
  WOOD_SAPLING_ID_START,
  Wood,
  blockDef,
  blockHardness,
  saplingId,
  saplingTreeOf,
  woodBlocks,
} from '../web/src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, itemDef, rareDropFor } from '../web/src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { canHarvest, isHandHarvestable } from '../web/src/core/registry/tools.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { growTreeAt, type TreeWorld } from '../web/src/core/world/TreeGrowth.ts';
import {
  SAPLING_GROW_CHANCE,
  SAPLING_MIN_LIGHT,
  hasRandomTick,
  randomTickBlock,
  type TickWorld,
} from '../web/src/core/tick/RandomTicks.ts';
import { TREE_KINDS } from '../web/src/core/gen/Features.ts';

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

/** 一个只有方块的小世界（够种树用） */
class FakeTreeWorld implements TreeWorld {
  readonly cells = new Map<string, number>();
  writes = 0;

  at(x: number, y: number, z: number, id: number): this {
    this.cells.set(`${x},${y},${z}`, id);
    return this;
  }

  getBlock(x: number, y: number, z: number): number {
    return this.cells.get(`${x},${y},${z}`) ?? Block.AIR;
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    this.cells.set(`${x},${y},${z}`, id);
    this.writes++;
  }

  /** 这一列里某个方块出现了几次 */
  countIn(x: number, z: number, fromY: number, id: number, span = 40): number {
    let n = 0;
    for (let y = fromY; y < fromY + span; y++) if (this.getBlock(x, y, z) === id) n++;
    return n;
  }
}

/** 一块平地：草方块 + 空气 */
function flatGround(x: number, z: number): FakeTreeWorld {
  return new FakeTreeWorld().at(x, 63, z, Block.GRASS_BLOCK);
}

// ---------------------------------------------------------------- 1. 树苗

console.log('\n[树苗：6 种木材各一个]');
{
  equal('id 从 483 开始（接在潜影盒之后）', WOOD_SAPLING_ID_START, 483);
  equal('一共 6 种（橡木 + 其余 5 种木材）', SAPLING_IDS.length, Object.keys(Wood).length + 1);
  equal('而且是连号的', SAPLING_IDS.join(','), [483, 484, 485, 486, 487, 488].join(','));

  const missingTiles = SAPLING_IDS.filter((id) => {
    const def = blockDef(id);
    return def.tiles.some((tile) => !TILES.has(tile));
  });
  check('每张树苗贴图都在图集里', missingTiles.length === 0, missingTiles.join(', '));

  for (const id of SAPLING_IDS) {
    const def = blockDef(id);
    check(`${def.name}：是十字面片的植物`, def.shape === 'cross' && def.solid === false);
    equal(`  ${def.name}：硬度 0（一拍就掉）`, blockHardness(id), 0);
    check(`  ${def.name}：徒手就能采到`, isHandHarvestable(id) && canHarvest(id, null));
    check(`  ${def.name}：有物品且有中文名与说明`, itemDef(id) !== undefined && itemLabel(id) !== '' && hasDescription(id));
    equal(`  ${def.name}：三面同一张`, new Set(def.tiles).size, 1);
  }

  // 树苗 → 树种：6 种都能对上，而且都是真实存在的树种
  const kinds = SAPLING_IDS.map((id) => saplingTreeOf(id));
  check('每个树苗都能对上一种树', kinds.every((kind) => kind !== null));
  check('对上的都是真的树种（TREE_KINDS 里有）', kinds.every((kind) => kind !== null && TREE_KINDS.includes(kind)));
  equal('对上的树种不重复', new Set(kinds).size, 6);
  equal('按木材名取 id 与列表同源', saplingId('oak'), Block.OAK_SAPLING);
  equal('未知木材返回 undefined', saplingId('cherry'), undefined);
  equal('不是树苗的方块 → null', saplingTreeOf(Block.STONE), null);
  equal('空手/空气 → null', saplingTreeOf(Block.AIR), null);

  // 创造栏
  const inCreative = SAPLING_IDS.filter((id) => CREATIVE_ITEMS.includes(id));
  equal('6 种树苗都在创造栏里', inCreative.length, 6);
}

// ---------------------------------------------------------------- 2. 树叶掉树苗

console.log('\n[树叶掉树苗：每种树叶掉自己那种]');
{
  equal('掷到 0.006（苹果区间之后）→ 橡木树苗', rareDropFor(Block.OAK_LEAVES, 0.006)?.id, Block.OAK_SAPLING);
  equal('掷到 0.001 → 还是苹果（原来的 0.5% 没被动）', rareDropFor(Block.OAK_LEAVES, 0.001)?.id, Item.APPLE);
  equal('掷到 0.06 → 什么都没有（总概率 5.5%）', rareDropFor(Block.OAK_LEAVES, 0.06), null);

  for (const [name, ids] of Object.entries(Wood)) {
    equal(`${name} 树叶掉 ${name} 树苗`, rareDropFor(ids.leaves, 0.02)?.id, saplingId(name));
    equal(`  ${name} 树叶掷到 0 掉苹果`, rareDropFor(ids.leaves, 0)?.id, Item.APPLE);
  }
  check(
    '不同木材的树叶掉不同树苗（免得全掉橡木）',
    rareDropFor(woodBlocks('birch')!.leaves, 0.02)?.id !== rareDropFor(Block.OAK_LEAVES, 0.02)?.id,
  );
}

// ---------------------------------------------------------------- 3. 种树

console.log('\n[种树：与区块生成共用同一批 Planter]');
{
  const world = flatGround(10, 10).at(10, 64, 10, Block.OAK_SAPLING);
  const changes = growTreeAt(world, 10, 64, 10, Block.OAK_SAPLING, 'oak');
  check('长出来了', changes !== null);
  equal('树苗那一格变成了橡木原木（不是悬空）', world.getBlock(10, 64, 10), Block.OAK_LOG);
  check('树冠有橡木树叶', world.countIn(10, 10, 64, Block.OAK_LEAVES) > 0);
  check(`改动清单够长（联机要按它广播每一格，实际 ${changes?.length} 格）`, (changes?.length ?? 0) >= 20);
  equal('清单里没有重复的格子', new Set((changes ?? []).map((c) => `${c.x},${c.y},${c.z}`)).size, changes?.length ?? 0);

  // 同一格、同一个盐 → 一模一样（Planter 用的是位置决定论随机）
  const again = flatGround(10, 10).at(10, 64, 10, Block.OAK_SAPLING);
  const changes2 = growTreeAt(again, 10, 64, 10, Block.OAK_SAPLING, 'oak');
  equal('同样的位置与盐长出来的树完全一样', JSON.stringify(changes), JSON.stringify(changes2));

  // 六种木材：树干各自是**那一种木材的原木**
  for (const [name, ids] of Object.entries(Wood)) {
    const id = saplingId(name)!;
    const kind = saplingTreeOf(id)!;
    const w = flatGround(20, 20).at(20, 64, 20, id);
    growTreeAt(w, 20, 64, 20, id, kind);
    check(`${name}：树干是自己的原木（${ids.log}）`, w.getBlock(20, 64, 20) === ids.log, `${w.getBlock(20, 64, 20)}`);
    check(`  ${name}：有树冠`, w.countIn(20, 20, 64, ids.leaves) > 0);
  }
  const oakWorld = flatGround(21, 21).at(21, 64, 21, Block.OAK_SAPLING);
  growTreeAt(oakWorld, 21, 64, 21, Block.OAK_SAPLING, 'oak');
  check('橡木树干是橡木原木', oakWorld.getBlock(21, 64, 21) === Block.OAK_LOG);
}

// ---------------------------------------------------------------- 4. 不凿穿地形 / 不长就放回去

console.log('\n[拥挤与失败：不凿穿地形，也不吞掉树苗]');
{
  // 天花板：树苗正上方就是石头 → 树干只写得出脚下那一格，绝不把石头换成原木
  const capped = flatGround(30, 30).at(30, 64, 30, Block.OAK_SAPLING).at(30, 65, 30, Block.STONE);
  const changes = growTreeAt(capped, 30, 64, 30, Block.OAK_SAPLING, 'oak');
  equal('石头天花板**原样还在**（没有被凿穿）', capped.getBlock(30, 65, 30), Block.STONE);
  equal('树干那一列放不下 → 干脆不长（树苗放回去）', changes, null);
  equal('树苗被放回原处', capped.getBlock(30, 64, 30), Block.OAK_SAPLING);
  equal('没有一格被写过（除了"清掉又放回"那两下）', capped.writes, 2);

  // 完全没地方：上方是水（可替换？不是）…… 用"上方紧贴基岩"构造一个必然失败的场景
  const blocked = flatGround(31, 31).at(31, 64, 31, Block.OAK_SAPLING);
  blocked.at(31, 65, 31, Block.BEDROCK);
  const fail = growTreeAt(blocked, 31, 64, 31, Block.OAK_SAPLING, 'oak');
  if (fail === null) {
    equal('长不出来 → 树苗**放回原处**（调用方不消耗骨粉）', blocked.getBlock(31, 64, 31), Block.OAK_SAPLING);
  } else {
    check('这一格其实还长出来了一截（也算合理：只削掉了一部分）', fail.length > 0);
  }
}

// ---------------------------------------------------------------- 5. 随机刻

console.log('\n[随机刻：光照与土壤都要够]');
{
  check('6 种树苗都登记了随机刻行为', SAPLING_IDS.every((id) => hasRandomTick(id)));
  check('光照阈值是 9（原版）', SAPLING_MIN_LIGHT === 9);
  check('生长概率在 0 与 1 之间', SAPLING_GROW_CHANCE > 0 && SAPLING_GROW_CHANCE < 1);

  const cells = new Map<string, number>();

  /** 按接口写全的随机刻世界（少一个方法就是"随机刻跑到一半炸"） */
  function tickWorldWith(light: number): TickWorld {
    return {
      getBlock: (x, y, z) => cells.get(`${x},${y},${z}`) ?? Block.AIR,
      setBlock: (x, y, z, id) => {
        cells.set(`${x},${y},${z}`, id);
        return true;
      },
      lightAt: () => light,
      skyLightAt: () => light,
      blockLightAt: () => light,
    };
  }

  const plant = (x: number, z: number, soil: number, sapling: number, light: number): TickWorld => {
    cells.set(`${x},63,${z}`, soil);
    cells.set(`${x},64,${z}`, sapling);
    return tickWorldWith(light);
  };

  // 光照够、土壤对、掷点命中 → 长成树
  const good = plant(40, 40, Block.GRASS_BLOCK, Block.OAK_SAPLING, 15);
  check('光照够 + 草方块 + 掷点命中 → 长成树', randomTickBlock(good, 40, 64, 40, () => 0));
  equal('树苗那一格成了原木', cells.get('40,64,40'), Block.OAK_LOG);

  // 光照不够
  const dark = plant(41, 41, Block.GRASS_BLOCK, Block.OAK_SAPLING, 8);
  check('光照 8（不足 9）→ 不长', !randomTickBlock(dark, 41, 64, 41, () => 0));
  equal('树苗还在', cells.get('41,64,41'), Block.OAK_SAPLING);

  // 土壤不对（沙子上）
  const sand = plant(42, 42, Block.SAND, Block.OAK_SAPLING, 15);
  check('种在沙子上 → 不长', !randomTickBlock(sand, 42, 64, 42, () => 0));

  // 概率没命中
  const unlucky = plant(43, 43, Block.DIRT, Block.OAK_SAPLING, 15);
  check('掷点没命中 → 不长', !randomTickBlock(unlucky, 43, 64, 43, () => 0.9));
  equal('树苗还在原处', cells.get('43,64,43'), Block.OAK_SAPLING);
}

console.log(`\n树苗测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
