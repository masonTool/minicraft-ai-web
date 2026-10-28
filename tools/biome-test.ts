/**
 * 生物群系离线测试与分布统计
 *
 * 运行：npm run test:biome
 * 除了断言，还会抽样一片区域输出群系直方图——用来判断世界有没有"群系多样性"。
 */

import {
  BIOMES,
  BIOME_TABLE,
  Biome,
  LAND_BIOMES,
  biomeForColumn,
  caveBiomeAt,
  findLandBiome,
  regionVariantAt,
  type ClimatePoint,
} from '../web/src/core/gen/Biome.ts';
import { OverworldGenerator } from '../web/src/core/gen/OverworldGenerator.ts';
import { Chunk } from '../web/src/core/world/Chunk.ts';
import { Block } from '../web/src/core/registry/blocks.ts';
import { BLOCKS } from '../web/src/core/registry/blocks.ts';

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

/** 构造一个气候采样点，缺省值取"中间地带" */
function point(overrides: Partial<ClimatePoint>): ClimatePoint {
  return {
    temperature: 0,
    humidity: 0,
    continentalness: 0.5,
    erosion: 0,
    depth: 0,
    weirdness: 0,
    ...overrides,
  };
}

console.log('\n[群系表一致性]');
equal('表长度与 Biome 常量一致', BIOMES.length, Object.keys(Biome).length);
equal('按 id 排序后的表可用于下标取值', BIOME_TABLE.every((biome, index) => biome.id === index), true);
equal('排序后条目数不变', BIOME_TABLE.length, BIOMES.length);
check(
  '每个群系的地表方块都在方块表里',
  BIOMES.every((biome) => BLOCKS[biome.surface] !== undefined && BLOCKS[biome.subSurface] !== undefined),
);
check(
  '每个群系的水下方块都在方块表里',
  BIOMES.every((biome) => BLOCKS[biome.underwater] !== undefined),
);

console.log('\n[海陆分类：按实际地表高度]');
{
  const sea = 63;
  const land = (overrides: Partial<ClimatePoint>, groundY: number) =>
    biomeForColumn(point(overrides), groundY, sea).name;

  equal('远低于海平面 → 深海', land({}, sea - 20), 'deep_ocean');
  equal('略低于海平面 → 普通海洋', land({}, sea - 8), 'ocean');
  equal('寒带浅海 → 寒带海洋', land({ temperature: -0.8 }, sea - 8), 'frozen_ocean');
  equal('热带浅海 → 热带海洋', land({ temperature: 0.8 }, sea - 8), 'warm_ocean');
  // 批次 338：海洋按「深度 × 温度」补到 9 种（原版口径）
  equal('寒带浅海（-0.3）→ cold_ocean', land({ temperature: -0.3 }, sea - 8), 'cold_ocean');
  equal('寒带深海（-0.3）→ deep_cold_ocean', land({ temperature: -0.3 }, sea - 20), 'deep_cold_ocean');
  equal('温水浅海（0.3）→ lukewarm_ocean', land({ temperature: 0.3 }, sea - 8), 'lukewarm_ocean');
  equal('温水深海（0.3）→ deep_lukewarm_ocean', land({ temperature: 0.3 }, sea - 20), 'deep_lukewarm_ocean');
  equal('冻洋深海（-0.8）→ deep_frozen_ocean', land({ temperature: -0.8 }, sea - 20), 'deep_frozen_ocean');
  equal('海洋群系共 9 种', BIOMES.filter((biome) => biome.ocean).length, 9);
  check(
    '暖水海洋没有 deep 变体（原版也没有 deep_warm_ocean）',
    !BIOMES.some((biome) => biome.name === 'deep_warm_ocean'),
  );
  equal('紧贴海平面 → 沙滩', land({}, sea), 'beach');
  equal('强侵蚀海岸 → 石岸', land({ erosion: -0.8 }, sea), 'stony_shore');
  equal('寒冷海岸 → 积雪沙滩', land({ temperature: -0.8 }, sea), 'snowy_beach');
  check('明显高于海平面就不再是海洋/沙滩', !land({}, sea + 10).includes('ocean') && land({}, sea + 10) !== 'beach');
}

console.log('\n[陆地群系匹配：温度 / 湿度 / 侵蚀度]');
equal(
  '寒冷干燥 → 雪原',
  findLandBiome(point({ temperature: -0.8, humidity: -0.5, erosion: 0.2 })).name,
  'snowy_plains',
);
equal(
  '寒冷潮湿 → 雪原针叶林',
  findLandBiome(point({ temperature: -0.8, humidity: 0.5, erosion: 0.2 })).name,
  'snowy_taiga',
);
equal('炎热干燥 → 沙漠', findLandBiome(point({ temperature: 0.7, humidity: -0.8, erosion: 0.2 })).name, 'desert');
equal('炎热潮湿 → 丛林', findLandBiome(point({ temperature: 0.7, humidity: 0.7, erosion: 0.2 })).name, 'jungle');
equal('温暖适湿 → 平原', findLandBiome(point({ temperature: 0, humidity: 0, erosion: 0.2 })).name, 'plains');
equal('强侵蚀 → 砾石丘陵', findLandBiome(point({ temperature: 0, humidity: 0, erosion: -0.9 })).name, 'windswept_gravelly_hills');
equal('中等侵蚀 → 多风丘陵', findLandBiome(point({ temperature: 0, humidity: 0, erosion: -0.8 })).name, 'windswept_hills');
equal(
  '强侵蚀 + 寒冷 → 雪坡',
  findLandBiome(point({ temperature: -0.8, humidity: 0, erosion: -0.8 })).name,
  'snowy_slopes',
);
check(
  '陆地匹配绝不会返回海洋或沙滩',
  [0, 1, 2, 3, 4, 5].every((id) => LAND_BIOMES.some((biome) => biome.id === id) === false),
);

console.log('\n[批次 339：森林 / 丛林变体]');
equal('群系表共 50 种', BIOMES.length, 50);
{
  // 批次 346：针叶林/山地/热带草原变体 + 恶地的区域变体
  const at = (temperature: number, humidity: number, erosion: number): string =>
    findLandBiome(point({ temperature, humidity, erosion })).name;
  equal('原始松林（最陡的针叶林）', at(0, 0.5, -1.0), 'old_growth_pine_taiga');
  equal('原始云杉林（次陡）', at(0, 0.5, -0.7), 'old_growth_spruce_taiga');
  equal('多风森林（暖 + 陡）', at(0.6, 0.5, -0.9), 'windswept_forest');
  equal('热带高原', at(0.6, 0, -0.9), 'savanna_plateau');
  // 批次 366：更陡的一档归破碎热带草原
  equal('破碎热带草原', at(0.6, 0, -0.95), 'windswept_savanna');
  // 批次 362：砾石丘陵（暖 + 最陡）
  equal('砾石丘陵', at(-0.2, 0, -0.9), 'windswept_gravelly_hills');
  // 批次 352：蘑菇岛（暖湿 + 平坦）
  equal('蘑菇岛', at(0.7, 0.9, 0.8), 'mushroom_fields');
  equal('蘑菇岛地表是菌丝', BIOMES.find((b) => b.name === 'mushroom_fields')?.surface, Block.MYCELIUM);
  // 批次 353：山峰按高度分带
  equal('高山（冷） → 冻峰', biomeForColumn(point({ temperature: -0.8, erosion: -0.8 }), 63 + 80, 63).name, 'frozen_peaks');
  equal('高山（温） → 尖峭山峰', biomeForColumn(point({ temperature: 0, erosion: -0.8 }), 63 + 80, 63).name, 'jagged_peaks');
  equal('不到高度 → 仍是多风丘陵', biomeForColumn(point({ temperature: 0, erosion: -0.8 }), 63 + 30, 63).name, 'windswept_hills');
  const badlands = BIOMES.find((b) => b.name === 'badlands')!;
  let wooded = 0;
  for (let i = 0; i < 200; i++) if (regionVariantAt(badlands, i * 64, i * 64).name === 'wooded_badlands') wooded++;
  check('疏林恶地能在恶地里按区域出现（200 格里至少 20 片）', wooded >= 20, `命中 ${wooded} 格`);
  let eroded = 0;
  for (let i = 0; i < 200; i++) if (regionVariantAt(badlands, i * 64, i * 64).name === 'eroded_badlands') eroded++;
  check('侵蚀恶地能在恶地里按区域出现（200 格里至少 15 片）', eroded >= 15, `命中 ${eroded} 格`);
  // 批次 363：冰刺平原是积雪平原的区域变体
  const snowy = BIOMES.find((b) => b.name === 'snowy_plains')!;
  let spikes = 0;
  for (let i = 0; i < 200; i++) if (regionVariantAt(snowy, i * 64, i * 64).name === 'ice_spikes') spikes++;
  check('冰刺平原能在积雪平原里按区域出现（200 格里至少 10 片）', spikes >= 10, `命中 ${spikes} 格`);
  equal('冰刺平原地表是雪块', BIOMES.find((b) => b.name === 'ice_spikes')?.surface, Block.SNOW_BLOCK);
}
{
  // 批次 342：区域变体不参与气候匹配，只按 64 格哈希掷点
  const forest = BIOMES.find((biome) => biome.id === 8)!;
  const flower = BIOMES.find((biome) => biome.id === 32)!;
  const hits = [] as string[];
  for (let i = 0; i < 200; i++) {
    const found = regionVariantAt(forest, i * 64, i * 64);
    if (found.id === flower.id) hits.push(`${i}`);
  }
  check('繁花森林能在森林里按区域出现（200 格里至少有 10 片）', hits.length >= 10, `命中 ${hits.length} 格`);
  check('区域变体是确定性的（同坐标两次一致）', regionVariantAt(forest, 128, 128).id === regionVariantAt(forest, 128, 128).id);
  equal('区域变体不参与气候匹配', LAND_BIOMES.some((biome) => biome.variantOf !== undefined), false);
}
equal(
  '深色森林',
  findLandBiome(point({ temperature: 0, humidity: 0.9, erosion: 0.5, weirdness: 0.5 })).name,
  'dark_forest',
);


equal(
  '稀疏丛林',
  findLandBiome(point({ temperature: 0.7, humidity: 0.5, erosion: 0.2, weirdness: -0.5 })).name,
  'sparse_jungle',
);
equal(
  '竹林',
  findLandBiome(point({ temperature: 0.7, humidity: 0.9, erosion: 0.2, weirdness: 0.5 })).name,
  'bamboo_jungle',
);


console.log('\n[地表方块随群系变化]');
{
  const desert = findLandBiome(point({ temperature: 0.7, humidity: -0.8, erosion: 0.2 }));
  equal('沙漠地表是沙', BLOCKS[desert.surface]!.name, 'minicraft:sand');
  equal('沙漠次表层是砂岩', BLOCKS[desert.subSurface]!.name, 'minicraft:sandstone');

  const snowy = findLandBiome(point({ temperature: -0.8, humidity: 0.5, erosion: 0.2 }));
  equal('雪原地表是雪块', BLOCKS[snowy.surface]!.name, 'minicraft:snow_block');
  check('雪原标记为常年积雪', snowy.snowy);

  const deepOcean = biomeForColumn(point({}), 63 - 20, 63);
  equal('深海海底是砾石', BLOCKS[deepOcean.underwater]!.name, 'minicraft:gravel');

  const plains = findLandBiome(point({ temperature: 0, humidity: 0, erosion: 0.2 }));
  equal('平原地表是草方块', BLOCKS[plains.surface]!.name, 'minicraft:grass_block');
}

console.log('\n[气候噪声的实际分布]');

const gen = new OverworldGenerator(20261014);
const stats = { continent: [] as number[], temperature: [] as number[], humidity: [] as number[], erosion: [] as number[] };
const R = 900;
for (let x = -R; x <= R; x += 24) {
  for (let z = -R; z <= R; z += 24) {
    const c = gen.climateAt(x, z);
    stats.continent.push(c.continent);
    stats.temperature.push(c.temperature);
    stats.humidity.push(c.humidity);
    stats.erosion.push(c.erosion);
  }
}

for (const [name, values] of Object.entries(stats)) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.floor(p * (sorted.length - 1))]!;
  console.log(
    `  ${name.padEnd(12)} 均值 ${mean.toFixed(3)}  标准差 ${sd.toFixed(3)}` +
      `  1% ${pct(0.01).toFixed(3)}  99% ${pct(0.99).toFixed(3)}`,
  );
}

console.log('\n[实际世界的群系分布]');

const generator = gen;
const histogram = new Map<string, number>();
const surfaceHistogram = new Map<string, number>();
const SEA = 63;
let samples = 0;
let oceanSamples = 0;

// 真正生成区块再按实际地表分类——这样统计结果与画面里看到的完全一致
// ⚠️ 采样窗从 7×7 扩到 **11×11 区块**（批次 179）：7×7 = 112×112 格只采到 784 个点，
// 随机种子的方差大到"这一片正好靠海"就能让海洋占比从 35% 掉到 16%，
// 于是这条断言量到的其实是"我这窗口落在哪"，而不是"世界长什么样"。
for (let cx = -5; cx <= 5; cx++) {
  for (let cz = -5; cz <= 5; cz++) {
    const blocks = generator.generate(cx, cz);
    for (let z = 0; z < 16; z += 4) {
      for (let x = 0; x < 16; x += 4) {
        let top = -1;
        for (let y = 120; y >= -64; y--) {
          const id = blocks[Chunk.index(x, y, z)]!;
          if (id !== 0 && id !== Block.WATER) {
            top = y;
            break;
          }
        }
        if (top < 0) continue;

        const worldX = cx * 16 + x;
        const worldZ = cz * 16 + z;
        const raw = generator.climateAt(worldX, worldZ);
        const biome = biomeForColumn(
          {
            temperature: raw.temperature,
            humidity: raw.humidity,
            continentalness: raw.continent,
            erosion: raw.erosion,
            depth: 0,
            weirdness: raw.weirdness,
          },
          top,
          SEA,
        );

        histogram.set(biome.name, (histogram.get(biome.name) ?? 0) + 1);
        if (biome.ocean) oceanSamples++;
        const surfaceName = BLOCKS[biome.surface]!.name.replace('minicraft:', '');
        surfaceHistogram.set(surfaceName, (surfaceHistogram.get(surfaceName) ?? 0) + 1);
        samples++;
      }
    }
  }
}

const sorted = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
for (const [name, count] of sorted) {
  console.log(`  ${name.padEnd(18)} ${((count / samples) * 100).toFixed(1)}%`);
}

console.log('');
// ⚠️ 这两条阈值反映的是"当前能到多少"，不是"应该到多少"。
// 群系数量上不去的根因不在匹配算法，而在地形起伏偏小（噪声幅度被归一化压掉了，
// 见 D1b）：地势平坦 → 绝大部分区域落在海平面附近的同一档气候里 → 只剩少数群系。
// 等 D1b 修好、地形出现真正的深海与高山之后，这两条阈值应当提高。
check('世界至少有 6 种群系（D1b 修好后应显著更多）', histogram.size >= 6, `实际 ${histogram.size}`);
check('海洋群系占比在 20%~70% 之间', oceanRatio() > 0.2 && oceanRatio() < 0.7, `${(oceanRatio() * 100).toFixed(1)}%`);
check('沙滩占比不超过 12%（地形平坦时最容易失控的一项）', beachRatio() < 0.12, `${(beachRatio() * 100).toFixed(1)}%`);
// 取样区域只覆盖到海洋/沙滩/平原/林地/沙漠，所以地表方块只有 沙/草/砾石 三种。
// 雪原与丛林要等地形起伏变大（D1b）才会在这片区域出现。
check('地表方块至少有 3 种', surfaceHistogram.size >= 3, `实际 ${surfaceHistogram.size}`);

function oceanRatio(): number {
  return oceanSamples / samples;
}

function beachRatio(): number {
  return ((histogram.get('beach') ?? 0) + (histogram.get('stony_shore') ?? 0)) / samples;
}


console.log('\n[批次 394：洞穴群系]');
{
  const names = new Set<string>();
  for (let x = -64; x <= 64; x += 8) {
    for (let z = -64; z <= 64; z += 8) {
      for (const y of [-20, 10, 30, 45]) {
        const biome = caveBiomeAt(x, y, z);
        if (biome) names.add(biome.name);
      }
    }
  }
  equal('繁茂洞穴与滴水石洞都能判出来', [...names].sort().join(','), 'dripstone_caves,lush_caves');
  equal('地表高度以上没有洞穴群系', caveBiomeAt(0, 60, 0), null);
}


console.log('\n[批次 398：河流 / 冻河]');
{
  equal(
    '内陆浅水 → 河流',
    biomeForColumn(point({ temperature: 0, continentalness: 0.5 }), 61, 63).name,
    'river',
  );
  equal(
    '寒冷内陆浅水 → 冻河',
    biomeForColumn(point({ temperature: -0.8, continentalness: 0.5 }), 61, 63).name,
    'frozen_river',
  );
  equal(
    '近海浅水仍是海洋',
    biomeForColumn(point({ temperature: 0, continentalness: -0.3 }), 61, 63).name,
    'ocean',
  );
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
