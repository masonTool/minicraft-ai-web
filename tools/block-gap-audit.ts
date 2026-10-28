import { BLOCKS, blockDef } from '../web/src/core/registry/blocks.ts';

const names = new Set<string>();
for (let id = 1; id < BLOCKS.length; id++) {
  const def = blockDef(id);
  if (!def) continue;
  const name = def.name.replace('minicraft:', '');
  if (name === 'air') continue;
  names.add(name);
}

const woods = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
/**
 * ⚠️ `wall_sign` **不在这张表里**（批次 452）：本仓库从火把起就是"一个方块 + 状态位"
 * 表达两种摆法（`wallMounted` + `facing`），告示牌也一样——`blockShapes` 的 `sign`
 * 分支已经按 `isWallMounted` 给出"立柱 + 牌面"或"只有牌面"两种形状，
 * 放置侧（`Placement.ts`）也能对着墙挂。原版拆成 `*_sign` / `*_wall_sign` 两个 id
 * 是它的实现选择，不是一条玩法。留着它只会每次审计都报 6 个假缺口。
 */
const shapes = ['planks', 'log', 'wood', 'stripped_log', 'stairs', 'slab', 'fence', 'fence_gate', 'door', 'trapdoor', 'button', 'pressure_plate', 'sign', 'leaves', 'sapling'];
/**
 * ⚠️ 木材族的楼梯/台阶在本仓库叫 `oak_planks_stairs`（不是原版的 `oak_stairs`），
 * 所以"查 `<wood>_<shape>`"会把这些**已有的方块**报成缺失。两边名字都认。
 */
const hasWood = (wood: string, shape: string): boolean =>
  names.has(`${wood}_${shape}`) ||
  names.has(`${wood}_planks_${shape}`) ||
  // 剥皮原木（批次 443）用的是原版命名 `stripped_oak_log`，不是 `oak_stripped_log`。
  // 不认这一条的话审计会一直报"6 种剥皮原木缺失"——而它们早就在了（批次 452 修正）
  (shape === 'stripped_log' && names.has(`stripped_${wood}_log`));

console.log('== 木材族缺口 ==');
for (const shape of shapes) {
  const missing = woods.filter((w) => !hasWood(w, shape));
  if (missing.length > 0) console.log(`  ${shape}: 缺 ${missing.join(', ')}`);
}
console.log('  注：楼梯/台阶已按 `oak_planks_stairs` 这种真实命名核对过（不是原版命名）');

const colors = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
// ⚠️ `concrete` 以前在这张表里写了两次（统计会重复报一行），批次 452 顺手去掉
const colorShapes = ['wool', 'carpet', 'concrete', 'concrete_powder', 'stained_glass', 'stained_glass_pane', 'terracotta', 'glazed_terracotta', 'candle', 'banner', 'bed', 'shulker_box'];
console.log('== 16 色族缺口 ==');
for (const shape of colorShapes) {
  const missing = colors.filter((c) => !names.has(`${c}_${shape}`));
  if (missing.length > 0) console.log(`  ${shape}: 缺 ${missing.length} 个（${missing.join(', ')}）`);
}

console.log('== 其它常见方块逐个查 ==');
const singles = [
  'stone', 'cobblestone', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks',
  'sandstone', 'cut_sandstone', 'chiseled_sandstone', 'smooth_sandstone',
  'diorite', 'polished_diorite', 'andesite', 'polished_andesite', 'granite', 'polished_granite',
  'deepslate_bricks', 'deepslate_tiles', 'polished_deepslate', 'chiseled_deepslate', 'cobbled_deepslate',
  'bricks', 'prismarine', 'dark_prismarine', 'sea_lantern', 'glowstone', 'shroomlight',
  'amethyst_block', 'tinted_glass', 'calcite', 'tuff', 'dripstone_block', 'moss_block', 'mud', 'clay',
  'nether_bricks', 'red_nether_bricks', 'blackstone', 'polished_blackstone', 'gilded_blackstone',
  'basalt', 'polished_basalt', 'smooth_basalt', 'soul_sand', 'soul_soil', 'magma_block', 'obsidian', 'crying_obsidian',
  'end_stone', 'purpur_block', 'purpur_pillar', 'end_stone_bricks', 'chorus_plant',
  'glass', 'glass_pane', 'ice', 'packed_ice', 'blue_ice', 'snow_block', 'hay_block', 'bone_block',
  'sponge', 'wet_sponge', 'slime_block', 'honey_block', 'honeycomb_block', 'cobweb',
  'target', 'lodestone', 'respawn_anchor', 'ancient_debris', 'netherite_block', 'chain',
];
const missingSingles = singles.filter((n) => !names.has(n));
console.log(`  缺 ${missingSingles.length} 个：${missingSingles.join(', ')}`);
console.log('总方块数：', names.size);
