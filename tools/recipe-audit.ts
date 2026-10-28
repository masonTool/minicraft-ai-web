/**
 * 配方缺口审计（`npm run audit:recipes`）
 *
 * 解决的问题很具体：覆盖率里"合成配方 692 / 1000"这个分母很大，但**缺口里有一大半
 * 原版本来就没有配方**（石头、矿石、原木、树叶……）。不把这两类分开，
 * "还差 308 条"会让人以为配方是一条能干完的活。
 *
 * 所以这里不是"列出没配方的方块"就完事，而是**按获得方式分桶**：
 *  1. 矿石类：只能挖（原版没有配方）；
 *  2. 有生成来源（`GENERATION_SOURCES` 覆盖）：地形/地表/地物/结构给的；
 *  3. 生长或生物产物（带 stage / sapling / coral / vine 这类名字的）；
 *  4. **其余 = 真正待查的**（这才是有价值的清单）。
 *
 * ⚠️ 这只是**按名字与来源表做启发式分组**，不是"原版判定"：
 * 第 4 桶里可能仍有原版无配方的方块，第 1~3 桶理论上也可能有漏掉的配方。
 * 它的用途是"把 204 条缩到能一条条看的几十条"，不是替代逐条核对。
 */

import { BLOCKS, blockDef } from '../web/src/core/registry/blocks.ts';
import { RECIPES } from '../web/src/core/crafting/Recipes.ts';
import { SMELTING_RECIPES } from '../web/src/core/crafting/Smelting.ts';
import { GENERATION_SOURCES } from '../web/src/core/gen/GenerationSources.ts';

const made = new Set<number>();
for (const recipe of RECIPES) made.add(recipe.result.id);
for (const smelt of SMELTING_RECIPES) made.add(smelt.output.id);

const generated = new Set<number>();
for (const source of GENERATION_SOURCES) for (const id of source.blocks ?? []) generated.add(id);

const ORE = /(_ore$|^ancient_debris$|^nether_quartz_ore$)/;
const PLANT_OR_CREATURE = /(stage\d|_sapling$|^vine$|coral|kelp|seagrass|wart_block|mushroom|dripleaf|roots$|lichen$|berries|spore_blossom|sugar_cane|bamboo|cactus|lily_pad|tripwire$|spawner$|skull$|chorus|dragon_egg|budding_amethyst|amethyst_cluster)/;
const NEVER_CRAFTED = /^(air|.*lava.*|water$|fire|bubble|portal|light$|barrier|bedrock|farmland|piston_head|redstone_wire|frosted_ice)/;

const buckets = { neverCrafted: [] as string[], ore: [] as string[], generated: [] as string[], plant: [] as string[], unknown: [] as string[] };
const seen = new Set<number>();

for (let id = 1; id < BLOCKS.length; id++) {
  const def = blockDef(id);
  if (!def || seen.has(id) || made.has(id)) continue;
  seen.add(id);
  const name = def.name.replace('minicraft:', '');
  const entry = `${name}#${id}`;
  if (NEVER_CRAFTED.test(name)) buckets.neverCrafted.push(entry);
  else if (ORE.test(name)) buckets.ore.push(entry);
  else if (plant_placeholder(name)) buckets.plant.push(entry);
  else if (generated.has(id)) buckets.generated.push(entry);
  else buckets.unknown.push(entry);
}

function plant_placeholder(name: string): boolean {
  return PLANT_OR_CREATURE.test(name);
}

const total = Object.values(buckets).reduce((sum, list) => sum + list.length, 0);
console.log(`无配方方块共 ${total} 条，按获得方式分组：`);
console.log(`  ① 原版不可能合成（空气/液体/火/耕地/绊线…）  ${buckets.neverCrafted.length}`);
console.log(`  ② 矿石类：只能挖                              ${buckets.ore.length}`);
console.log(`  ③ 有生成来源（地形/地表/地物/结构）           ${buckets.generated.length}`);
console.log(`  ④ 生长或生物产物                              ${buckets.plant.length}`);
console.log(`  ⑤ 其余（真正待查）                            ${buckets.unknown.length}`);
console.log('');
console.log('⑤ 待查清单：');
console.log(buckets.unknown.join(' '));
