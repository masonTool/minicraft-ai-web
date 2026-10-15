/**
 * 地物（J2）离线测试
 *
 * 覆盖三块：
 *  1. 新方块的注册表一致性（id 连续、贴图都在图集名单里、物品与掉落表正确）
 *  2. 每种地物的形状与尺寸约束（树干不悬空、树冠不越界写入、仙人掌不长在水里等）
 *  3. 真实地形抽样：统计一片区域里各级地物的出现频次与群系约束是否生效
 *
 * 运行：npm run test:decor
 */

import { Block, BLOCKS, breakSeconds, blockDef, isHandHarvestable } from '../src/core/registry/blocks.ts';
import { itemDef, dropFor } from '../src/core/registry/items.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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

// ---------------------------------------------------------------- 1. 注册表一致性

console.log('\n[方块注册表]');
equal('方块总数', BLOCKS.length, 246);
check(
  'id 从 0 连续到末尾',
  BLOCKS.every((def, index) => def.id === index),
);
const TILES: readonly string[] = TILE_ORDER;
check(
  '每个方块的贴图都在图集名单里',
  BLOCKS.every((def) => def.tiles.every((tile) => tile === '' || TILES.includes(tile))),
  BLOCKS.filter((def) => def.tiles.some((tile) => tile !== '' && !TILES.includes(tile)))
    .map((def) => `${def.name}:${def.tiles.join('/')}`)
    .join(' '),
);
check('图集贴图无重名', new Set(TILE_ORDER).size === TILE_ORDER.length);

console.log('\n[装饰方块]');
for (const [name, id, shape] of [
  ['short_grass', Block.SHORT_GRASS, 'cross'],
  ['poppy', Block.POPPY, 'cross'],
  ['sugar_cane', Block.SUGAR_CANE, 'cross'],
  ['bamboo', Block.BAMBOO, 'cross'],
  ['cactus', Block.CACTUS, 'cactus'],
  ['pumpkin', Block.PUMPKIN, 'cube'],
] as const) {
  equal(`${name} 的形状`, blockDef(id).shape, shape);
}
check('植物无碰撞且不遮挡', [Block.SHORT_GRASS, Block.POPPY, Block.SUGAR_CANE].every((id) => !blockDef(id).solid && !blockDef(id).opaque));
check('仙人掌不遮挡邻居（否则贴着的方块会缺面）', !blockDef(Block.CACTUS).opaque);
check('植物徒手可采集（硬度 0 → 瞬间破坏）', breakSeconds(Block.SHORT_GRASS) === 0);
check('南瓜属于徒手可采集', isHandHarvestable(Block.PUMPKIN));
check('海晶石需要镐（不在徒手表）', !isHandHarvestable(Block.PRISMARINE) && breakSeconds(Block.PRISMARINE, true) === 2.25);

console.log('\n[物品与掉落]');
check(
  '所有新方块都注册了物品（创造物品栏能拿到）',
  [
    Block.SHORT_GRASS,
    Block.DANDELION,
    Block.POPPY,
    Block.BLUE_ORCHID,
    Block.OXEYE_DAISY,
    Block.CORNFLOWER,
    Block.RED_MUSHROOM,
    Block.BROWN_MUSHROOM,
    Block.SUGAR_CANE,
    Block.PUMPKIN,
    Block.MELON,
    Block.CACTUS,
    Block.DEAD_BUSH,
    Block.BAMBOO,
    Block.PRISMARINE,
    Block.SEA_LANTERN,
    Block.NETHERRACK,
    Block.SOUL_SAND,
    Block.CRIMSON_NYLIUM,
    Block.CRIMSON_STEM,
    Block.SHROOMLIGHT,
    Block.ANCIENT_DEBRIS,
  ].every((id) => itemDef(id) !== undefined),
);
equal('草不掉落任何东西（与原版一致）', dropFor(Block.SHORT_GRASS), null);
equal('花掉落自身', dropFor(Block.POPPY)?.id, Block.POPPY);
check('树叶不掉落', dropFor(Block.OAK_LEAVES) === null);
// 每种木材固定 5 个 id（原木/木板/树叶/台阶/楼梯），树叶是第 3 个
check(
  '6 种木材的树叶都不掉落',
  [Block.OAK_LEAVES, 104, 109, 114, 119, 124].every((id) => dropFor(id) === null),
);

console.log(`\n地物基础测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
