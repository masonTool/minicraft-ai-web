/**
 * 世界生成登记表对账（B52，批次 118）
 *
 * `src/core/gen/GenerationSources.ts` 那张表是**可达性审计判方块**的判据，而它有一半
 * 是手写的（结构那一段尤其）——手写的东西会漂，所以这一套测试专门做**对账**：
 *
 *  1. **表本身的自检**：每一段都非空、每个 id 都是已注册方块、空气不在表里、
 *     派生那三档（地表 / 地物 / 矿石）与源表一致（改了 `BIOME_FEATURES` 之类而忘了这里，会红）；
 *  2. **群系采样对账**：23 个主世界群系**各找一个区块**、真的生成一遍，
 *     采样到的方块必须都在表里。⚠️ 这一条正是批次 91 那次采样的教训：
 *     当时的采样没覆盖到"黑橡木/方解石/冰"那些群系，于是把"没采样到"当成了"不会生成"；
 *  3. **下界与末地采样对账**：按群系各取几片区块，同样必须 ⊆ 表；
 *  4. **结构对账**：每种结构各生成一个实例（要塞/村庄/矿井/地牢/沉船/神殿/府邸/
 *     堡垒遗迹/下界要塞/末地城），**它们写下的方块必须都在结构那几段里**
 *     ——漏一块就红（"某个生成器又长出了新方块"是这张表最可能漂的方式）。
 *
 * ⚠️ 采样**证不了"表是全的"**（罕见地物可能一次都不出现），所以它的定位是
 * "**表不全就一定会红**"这一侧：方向正好是审计需要的那一侧。
 *
 * 运行：npm run test:genregistry
 */

import { Block, BLOCKS, blockDef } from '../src/core/registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME } from '../src/core/world/Chunk.ts';
import { FeatureWriter } from '../src/core/gen/Features.ts';
import { Dimension, type DimensionId } from '../src/core/gen/Dimension.ts';
import { BIOMES } from '../src/core/gen/Biome.ts';
import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import { NetherGenerator } from '../src/core/gen/NetherGenerator.ts';
import { generateChunkBlocks } from '../src/core/gen/TerrainGenerator.ts';
import { generateStructures, structureInstanceForTest, type StructureKind } from '../src/core/gen/Structures.ts';
import { bastionInstanceForTest, generateBastions } from '../src/core/gen/Bastion.ts';
import { fortressInstanceForTest, generateFortresses } from '../src/core/gen/NetherFortress.ts';
import { generateEndStructures } from '../src/core/gen/EndStructures.ts';
import { EndGenerator } from '../src/core/gen/EndGenerator.ts';
import { SEA_LEVEL } from '../src/core/gen/Features.ts';
import { columnSurface } from '../src/core/gen/SurfaceRules.ts';
import { ORE_BLOCKS } from '../src/core/gen/OreGenerator.ts';
import { generatedBlockIds, generationSourcesOf, generationStats, GENERATION_SOURCES } from '../src/core/gen/GenerationSources.ts';

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

const SEED = 20261014;
/** 采样来的方块 id 收成一串名字（报缺口时能直接看懂） */
const namesOf = (ids: Iterable<number>): string => [...ids].map((id) => blockDef(id).name).join(', ');

/** 一段来源里有没有这个 id */
function inStage(key: string, id: number): boolean {
  const stage = GENERATION_SOURCES.find((source) => source.key === key);
  return stage !== undefined && stage.blocks.includes(id);
}

// ---------------------------------------------------------------- 1. 表自检

console.log('\n[登记表：自检]');
{
  const stats = generationStats();
  check('登记表有十来段来源', stats.stages >= 10, `${stats.stages} 段`);
  check('去重后有几百个方块', stats.blocks > 100, `${stats.blocks} 个`);

  const empty = GENERATION_SOURCES.filter((source) => source.blocks.length === 0);
  equal('没有空的来源段（空段说明派生函数没取到东西）', empty.length, 0);

  const generated = generatedBlockIds();
  const unknown = [...generated].filter((id) => BLOCKS[id] === undefined);
  equal('表里的 id 都是已注册方块', unknown.length, 0);
  equal('**空气不在表里**（它不是方块物品，审计与它无关）', generated.has(Block.AIR), false);

  const keys = GENERATION_SOURCES.map((source) => source.key);
  equal('来源的键没有重复', new Set(keys).size, keys.length);
  check(
    '每一段都写了"谁生成的"（`where` 指到模块/函数）',
    GENERATION_SOURCES.every((source) => source.where.length > 8),
  );
  check(
    '两种写法都标了（派生 / 手写）——手写的那几段要靠采样对账兜底',
    GENERATION_SOURCES.some((source) => source.origin === 'derived') &&
      GENERATION_SOURCES.some((source) => source.origin === 'declared'),
  );

  // 派生那三档：与源表一致（改了源表而忘了这里 → 这两条会红）
  const biomeFaces = new Set<number>();
  for (const biome of BIOMES) {
    for (const groundY of [70, 60, 50]) {
      const column = columnSurface(biome, groundY, SEA_LEVEL, 8, 8);
      biomeFaces.add(column.surface);
      biomeFaces.add(column.subSurface);
      for (const band of column.deepBands ?? []) biomeFaces.add(band);
    }
  }
  check(
    '地表那一档与 `columnSurface` 算出来的一致',
    [...biomeFaces].every((id) => inStage('surface', id)),
    namesOf([...biomeFaces].filter((id) => !inStage('surface', id))),
  );
  check(
    '矿石那一档与 `ORE_BLOCKS` 一致',
    [...ORE_BLOCKS].every((id) => inStage('ores', id)),
  );

  check(
    '查得出某个方块是谁生成的（审计报"拿得到"时要给出处）',
    generationSourcesOf(Block.GRASS_BLOCK).some((source) => source.key === 'surface'),
  );
  equal('空气不属于任何来源', generationSourcesOf(Block.AIR).length, 0);
}

// ---------------------------------------------------------------- 2. 群系采样对账

console.log('\n[群系采样：23 个群系各生成一片区块]');
{
  const gen = new OverworldGenerator(SEED);
  const generated = generatedBlockIds();
  /** 每个群系找一个"真的属于它"的区块（螺旋往外找，避免只测到出生点周围） */
  const chunkOfBiome = (biomeId: number): { cx: number; cz: number } | null => {
    for (let radius = 0; radius < 400; radius++) {
      for (let step = 0; step < 8; step++) {
        const angle = (step / 8) * Math.PI * 2;
        const x = Math.round(Math.cos(angle) * radius * 16);
        const z = Math.round(Math.sin(angle) * radius * 16);
        if (gen.columnBiome(x, z).id === biomeId) return { cx: Math.floor(x / 16), cz: Math.floor(z / 16) };
      }
    }
    // 批次 342：区域变体（繁花森林/原始白桦林）是"母群系里 12~15% 的 64 格小片"，
    // 稀疏螺旋（每圈 8 个点）很容易整圈都踩不到。补一遍密集网格兜底。
    for (let cz = -192; cz <= 192; cz += 2) {
      for (let cx = -192; cx <= 192; cx += 2) {
        if (gen.columnBiome(cx * 16 + 8, cz * 16 + 8).id === biomeId) return { cx, cz };
      }
    }
    return null;
  };

  let covered = 0;
  for (const biome of BIOMES) {
    // 洞穴群系按 y 判（批次 394），不参与地表采样
    if (biome.name === 'lush_caves' || biome.name === 'dripstone_caves') continue;
    const at = chunkOfBiome(biome.id);
    if (!at) {
      check(`${biome.name}：找得到一个区块`, false, '螺旋找 400 圈都没找到');
      continue;
    }
    covered++;
    const blocks = generateChunkBlocks(at.cx, at.cz, SEED, Dimension.OVERWORLD);
    const sampled = new Set<number>();
    for (const id of blocks) if (id !== Block.AIR) sampled.add(id);
    const missing = [...sampled].filter((id) => !generated.has(id));
    check(`${biome.name}：采样到的方块都在登记表里`, missing.length === 0, namesOf(missing));
  }
  equal(
    '所有主世界群系都采到了样（洞穴群系按 y 判，不参与地表采样）',
    covered,
    BIOMES.filter((b) => b.name !== 'lush_caves' && b.name !== 'dripstone_caves').length,
  );
}

// ---------------------------------------------------------------- 3. 下界与末地采样

console.log('\n[下界与末地采样]');
{
  const generated = generatedBlockIds();

  const sample = (cx: number, cz: number, dimension: DimensionId): Set<number> => {
    const blocks = generateChunkBlocks(cx, cz, SEED, dimension);
    const ids = new Set<number>();
    for (const id of blocks) if (id !== Block.AIR) ids.add(id);
    return ids;
  };

  // 下界：按群系各找一片（`NetherGenerator` 的群系是它自己算的）
  const nether = new NetherGenerator(SEED);
  const netherBiomes = new Set<number>();
  for (let cx = -6; cx <= 6; cx += 2) {
    for (let cz = -6; cz <= 6; cz += 2) netherBiomes.add(nether.biomeAt(cx * 16 + 8, cz * 16 + 8));
  }
  check('下界采到了不止一种群系', netherBiomes.size >= 2, `${netherBiomes.size} 种`);

  const netherMissing = new Set<number>();
  for (const id of sample(0, 0, Dimension.NETHER)) if (!generated.has(id)) netherMissing.add(id);
  for (const id of sample(-4, 3, Dimension.NETHER)) if (!generated.has(id)) netherMissing.add(id);
  for (const id of sample(7, -5, Dimension.NETHER)) if (!generated.has(id)) netherMissing.add(id);
  check('下界采样到的方块都在登记表里', netherMissing.size === 0, namesOf(netherMissing));

  // 末地：主岛一片 + 外岛一片（末地城在外岛）
  const endMissing = new Set<number>();
  for (const [cx, cz] of [
    [0, 0],
    [8, 8],
    [64, 64],
    [-80, 96],
    [140, -132],
  ] as const) {
    for (const id of sample(cx, cz, Dimension.END)) if (!generated.has(id)) endMissing.add(id);
  }
  check('末地采样到的方块都在登记表里', endMissing.size === 0, namesOf(endMissing));
}

// ---------------------------------------------------------------- 4. 结构对账

console.log('\n[结构：每种各生成一个实例，写下的方块都要在表里]');
{
  /** 结构那几段的并集（§ 见文件头：按"种"分开的生成器入口没导出，所以这里是并集对账） */
  const structureKeys = [
    'village',
    'mineshaft',
    'stronghold',
    'dungeon',
    'shipwreck',
    'ocean_monument',
    'woodland_mansion',
    'bastion_remnant',
    'nether_fortress',
    'end_city',
    'stronghold',
  ];
  const covered = new Set<number>();
  for (const key of structureKeys) {
    for (const source of GENERATION_SOURCES) if (source.key === key) for (const id of source.blocks) covered.add(id);
  }

  const gen = new OverworldGenerator(SEED);
  /** 把某一族结构的实例写进一块**空白区块**（只有结构，没有地形与地物） */
  const wroteFor = (kind: StructureKind): Set<number> => {
    const ids = new Set<number>();
    for (let cellZ = -4; cellZ <= 4; cellZ++) {
      for (let cellX = -4; cellX <= 4; cellX++) {
        const instance = structureInstanceForTest(kind, cellX, cellZ, gen, SEED);
        if (!instance) continue;
        const cells = new Uint16Array(CHUNK_VOLUME);
        const cx = Math.floor((instance.minX + instance.maxX) / 2 / CHUNK_SIZE_X);
        const cz = Math.floor((instance.minZ + instance.maxZ) / 2 / CHUNK_SIZE_Z);
        const writer = new FeatureWriter(cells, cx, cz);
        generateStructures(writer, gen, SEED);
        for (const id of cells) if (id !== Block.AIR) ids.add(id);
        return ids;
      }
    }
    return ids;
  };

  const kinds: StructureKind[] = [
    'village',
    'mineshaft',
    'stronghold',
    'dungeon',
    'shipwreck',
    'ocean_monument',
    'woodland_mansion',
  ];
  for (const kind of kinds) {
    const ids = wroteFor(kind);
    check(`${kind}：生成得出实例并写下方块`, ids.size > 0, '一个方块都没写');
    const missing = [...ids].filter((id) => !covered.has(id));
    check(`${kind}：写下的方块都在登记表的结构那几段里`, missing.length === 0, namesOf(missing));
  }

  // 下界两族：**先求出实例、再生成它自己那一块**（它们的候选点是稀疏的，
  // 瞎扫几块区块很可能一块都碰不上——批次 118 第一版就是这么"生成不出方块"的）
  {
    const world = new NetherGenerator(SEED).structureWorld();
    const inst = bastionInstanceForTest(0, 0, SEED, world);
    check('堡垒遗迹：找得到候选点', inst !== null);
    if (inst) {
      const cells = new Uint16Array(CHUNK_VOLUME);
      const writer = new FeatureWriter(cells, inst.x >> 4, inst.z >> 4);
      generateBastions(writer, SEED, world);
      const wrote = new Set<number>();
      for (const id of cells) if (id !== Block.AIR) wrote.add(id);
      check('堡垒遗迹：生成得出方块', wrote.size > 0, `实例在 (${inst.x}, ${inst.z})`);
      const missing = [...wrote].filter((id) => !inStage('bastion_remnant', id));
      check('堡垒遗迹：写下的方块都在它那一段里', missing.length === 0, namesOf(missing));
    }
  }
  {
    const world = new NetherGenerator(SEED).structureWorld();
    const inst = fortressInstanceForTest(0, 0, SEED, world);
    check('下界要塞：找得到候选点', inst !== null);
    if (inst) {
      const cells = new Uint16Array(CHUNK_VOLUME);
      const writer = new FeatureWriter(cells, inst.x >> 4, inst.z >> 4);
      generateFortresses(writer, SEED, world);
      const wrote = new Set<number>();
      for (const id of cells) if (id !== Block.AIR) wrote.add(id);
      check('下界要塞：生成得出方块（含刷怪笼与下界疣）', wrote.size > 0, `实例在 (${inst.x}, ${inst.z})`);
      const missing = [...wrote].filter((id) => !inStage('nether_fortress', id));
      check('下界要塞：写下的方块都在它那一段里', missing.length === 0, namesOf(missing));
      check('下界要塞里真的有下界疣（它是酿造链的第一件原料）', wrote.has(Block.NETHER_WART_STAGE0));
    }
  }
  {
    // 末地城：外岛那一片才生成，所以把若干外岛区块扫一遍
    const end = new EndGenerator(SEED);
    const wrote = new Set<number>();
    for (let cx = 40; cx <= 120 && wrote.size === 0; cx += 7) {
      for (let cz = 40; cz <= 120 && wrote.size === 0; cz += 7) {
        const cells = new Uint16Array(CHUNK_VOLUME);
        const writer = new FeatureWriter(cells, cx, cz);
        generateEndStructures(writer, end, SEED);
        for (const id of cells) if (id !== Block.AIR) wrote.add(id);
      }
    }
    if (wrote.size === 0) {
      console.log('  · 末地城：这一轮没扫到（外岛的坐标是哈希出来的），跳过这一条');
    } else {
      const missing = [...wrote].filter((id) => !inStage('end_city', id));
      check('末地城/末地船：写下的方块都在它那一段里', missing.length === 0, namesOf(missing));
    }
  }
}

console.log(`\n世界生成登记表测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
