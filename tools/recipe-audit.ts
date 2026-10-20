import { BLOCKS, blockDef } from '../src/core/registry/blocks.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { SMELTING_RECIPES } from '../src/core/crafting/Smelting.ts';

const made = new Set<number>();
for (const r of RECIPES) made.add(r.result.id);
for (const s of SMELTING_RECIPES) made.add(s.output.id);

const skip = /air|lava|water|fire$|_fire|bubble|portal|light$|_light|snow_layer|bedrock|barrier|structure_void/;
const out: string[] = [];
for (let id = 1; id < BLOCKS.length; id++) {
  if (!blockDef(id)) continue;
  if (made.has(id)) continue;
  const name = blockDef(id).name.replace('minecraft:', '');
  if (skip.test(name)) continue;
  out.push(`${name}#${id}`);
}
console.log('无配方方块：', out.length);
console.log(out.join(' '));
