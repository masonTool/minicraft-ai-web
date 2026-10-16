/**
 * 下界维度（J3）离线测试
 *
 * 覆盖：
 *  1. 地形形态：岩浆海、洞顶、地板高度分布、洞穴空气占比
 *  2. 五个下界群系都成片出现，且地表方块与群系对得上
 *  3. 地物：菌菇树、荧光石簇、玄武岩柱、灵魂沙、石英矿、远古残骸
 *  4. 跨区块一致性：同区块重复生成一致、邻域重放的菌菇树在接缝处高度对齐
 *  5. 与主世界确实是两套地形（同坐标完全不同）
 *
 * 运行：npm run test:nether
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { NETHER_BIOME_NAMES, NetherBiome, NetherGenerator } from '../src/core/gen/NetherGenerator.ts';
import { generateChunkBlocks } from '../src/core/gen/TerrainGenerator.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk, type BlockArray } from '../src/core/world/Chunk.ts';

const SEED = 20261014;

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

function countBlocks(blocks: BlockArray, id: number): number {
  let count = 0;
  for (const value of blocks) if (value === id) count++;
  return count;
}

function heightRangeCount(blocks: BlockArray, y0: number, y1: number, ids: readonly number[]): number {
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        if (ids.includes(blocks[Chunk.index(x, y, z)]!)) count++;
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------- 1. 地形形态

console.log('\n[地形形态：岩浆海 / 洞顶 / 洞窟]');
{
  const SIZE = 12;
  let lava = 0;
  let air = 0;
  let roofSolid = 0;
  let roofTotal = 0;
  let bedrockTop = 0;
  const floors: number[] = [];
  const biomeHistogram = new Map<string, number>();
  const surfaceHistogram = new Map<number, number>();
  const markers = new Map<number, number>();

  /**
   * ⚠️ 生成器**在循环外建一次**（批次 103，B103-5 顺手修的）：原来写在最内层，
   * 144 个区块就构造 144 次（每次都要建一堆噪声表），而那些构造时间被算进了"生成耗时"
   * ——这条断言原来量到的东西里有一半是它自己造出来的噪声。
   * `biomeAt` / `floorAt` / `ceilingAt` 都是只读查询，复用同一个实例是安全的。
   */
  const generator = new NetherGenerator(SEED);

  /**
   * ⚠️ 三个数**按行交替**量（批次 103，B103-5），不是"先跑完 A 再跑完 B"：
   * 并行跑测试集时 CPU 争用是**随时间波动**的，"先后量"会让两边吃到不同的争用，
   * 比值照样会飘（`decor` 就是这么踩到的：空载 1.5 倍、负载下 3.26 倍）。
   */
  let elapsed = 0;
  let terrainOnlyMs = 0;
  let overworldMs = 0;
  for (let cz = 0; cz < SIZE; cz++) {
    const rowStart = performance.now();
    for (let cx = 0; cx < SIZE; cx++) {
      const blocks = generateChunkBlocks(cx, cz, SEED, Dimension.NETHER);
      lava += countBlocks(blocks, Block.LAVA);
      air += heightRangeCount(blocks, 33, 117, [Block.AIR]);
      // 洞顶：y ∈ [118, 126) 必须全是实心（不含空气）
      roofSolid += (16 * 16 * 8 - heightRangeCount(blocks, 118, 125, [Block.AIR]));
      roofTotal += 16 * 16 * 8;
      // 底部基岩
      bedrockTop += heightRangeCount(blocks, -64, -60, [Block.BEDROCK]);

      for (let z = 0; z < CHUNK_SIZE_Z; z += 4) {
        for (let x = 0; x < CHUNK_SIZE_X; x += 4) {
          const wx = cx * 16 + x;
          const wz = cz * 16 + z;
          const biome = generator.biomeAt(wx, wz);
          biomeHistogram.set(NETHER_BIOME_NAMES[biome]!, (biomeHistogram.get(NETHER_BIOME_NAMES[biome]!) ?? 0) + 1);
          floors.push(generator.floorAt(wx, wz));
        }
      }

      for (const id of [
        Block.NETHERRACK,
        Block.SOUL_SAND,
        Block.SOUL_SOIL,
        Block.BASALT,
        Block.BLACKSTONE,
        Block.CRIMSON_NYLIUM,
        Block.WARPED_NYLIUM,
        Block.CRIMSON_STEM,
        Block.WARPED_STEM,
        Block.NETHER_WART_BLOCK,
        Block.WARPED_WART_BLOCK,
        Block.GLOWSTONE,
        Block.SHROOMLIGHT,
        Block.NETHER_QUARTZ_ORE,
        Block.ANCIENT_DEBRIS,
        Block.MAGMA_BLOCK,
      ]) {
        markers.set(id, (markers.get(id) ?? 0) + countBlocks(blocks, id));
      }
      // 地表方块统计：取每个生成器列的地板那一格
      for (let z = 0; z < CHUNK_SIZE_Z; z += 4) {
        for (let x = 0; x < CHUNK_SIZE_X; x += 4) {
          const wx = cx * 16 + x;
          const wz = cz * 16 + z;
          const floor = generator.floorAt(wx, wz);
          const id = blocks[Chunk.index(x, floor, z)]!;
          surfaceHistogram.set(id, (surfaceHistogram.get(id) ?? 0) + 1);
        }
      }
    }
    elapsed += performance.now() - rowStart;

    // ① 纯地形（下界，不含菌菇树/荧石/堡垒遗迹）——只打印，见下面的说明
    const terrainStart = performance.now();
    for (let cx = 0; cx < SIZE; cx++) generator.generate(cx, cz);
    terrainOnlyMs += performance.now() - terrainStart;

    // ② 同一片区块的主世界生成——**断言用的基准**
    const overworldStart = performance.now();
    for (let cx = 0; cx < SIZE; cx++) generateChunkBlocks(cx, cz, SEED, Dimension.OVERWORLD);
    overworldMs += performance.now() - overworldStart;
  }

  /**
   * **两个参考数**（批次 103，B103-5）。原来的判据是"12×12 区块耗时 < 5s"，
   * 那种绝对秒数在并行跑测试集时会因 CPU 争用偶发变红（同一套实测 3.3s / 10.4s）。
   *
   * ① **纯地形**（`NetherGenerator.generate`，不含菌菇树/荧石/堡垒遗迹）：只打印。
   *    它是"下界地形本身有多便宜"的参照——实测只要 ~1.5ms/区块，
   *    所以下界的开销几乎全在地物与结构上。**只打印不断言**：6~7 倍是它的正常水平，
   *    拿它当预算没有意义（没有"应该几倍"这回事）。
   * ② **同一片区块的主世界生成**：**这才是断言用的基准**。
   *    "下界生成不该比主世界慢一个量级"是个有意义的说法，
   *    而两个数在同一进程、同一台机器上前后脚量出来，比值与机器快慢无关。
   */
  const ratio = elapsed / Math.max(overworldMs, 1);

  const named = (id: number) => blockDef(id).name.replace('minecraft:', '');
  console.log(
    `  ${SIZE}×${SIZE} 区块耗时 ${elapsed.toFixed(0)}ms（含地物与结构）· 纯地形 ${terrainOnlyMs.toFixed(0)}ms` +
      `（地物占 ${(elapsed / Math.max(terrainOnlyMs, 1)).toFixed(1)} 倍，正常）` +
      ` · 同片主世界 ${overworldMs.toFixed(0)}ms → 下界 ÷ 主世界 = ${ratio.toFixed(2)} 倍`,
  );
  console.log(`  岩浆 ${lava} · 洞窟空气 ${air} · 地板高度 ${Math.min(...floors)}~${Math.max(...floors)}（均值 ${(floors.reduce((a, b) => a + b, 0) / floors.length).toFixed(1)}）`);
  console.log(
    `  群系分布：${[...biomeHistogram.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join(' · ')}`,
  );
  console.log(
    `  群系地表方块：${[...surfaceHistogram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) => `${named(id)} ${count}`).join(' · ')}`,
  );
  console.log(
    `  建材统计：${[...markers.entries()].map(([id, count]) => `${named(id)} ${count}`).join(' · ')}`,
  );

  check('岩浆海存在（y ≤ 32 的空气被灌成岩浆）', lava > 1000, `岩浆 ${lava}`);
  check('洞顶是一整层实心岩层', roofSolid === roofTotal, `${roofSolid}/${roofTotal}`);
  check('底部有基岩层', bedrockTop > 16 * 16 * 4, `基岩 ${bedrockTop}`);
  check('洞窟是空的（y 33~117 有大量空气）', air > 200000, `空气 ${air}`);
  check('地板高度跨过岩浆海面（28~46）', Math.min(...floors) < 33 && Math.max(...floors) > 40, `${Math.min(...floors)}~${Math.max(...floors)}`);
  check('五个下界群系都会出现', biomeHistogram.size === 5, [...biomeHistogram.keys()].join(','));

  const surfaceIds = new Set(surfaceHistogram.keys());
  check(
    '地表方块与群系对得上（菌岩/灵魂沙/玄武岩/黑石/下界岩）',
    surfaceIds.has(Block.NETHERRACK) &&
      (surfaceIds.has(Block.CRIMSON_NYLIUM) || surfaceIds.has(Block.WARPED_NYLIUM)) &&
      surfaceIds.has(Block.SOUL_SAND) &&
      (surfaceIds.has(Block.BASALT) || surfaceIds.has(Block.BLACKSTONE)),
    [...surfaceIds].map(named).join(','),
  );

  check('有菌菇树（菌柄）', (markers.get(Block.CRIMSON_STEM) ?? 0) + (markers.get(Block.WARPED_STEM) ?? 0) > 100);
  check('有荧石与菌光体（洞里的光源）', (markers.get(Block.GLOWSTONE) ?? 0) > 20 || (markers.get(Block.SHROOMLIGHT) ?? 0) > 20);
  check('有石英矿', (markers.get(Block.NETHER_QUARTZ_ORE) ?? 0) > 100, `石英 ${markers.get(Block.NETHER_QUARTZ_ORE)}`);
  check('有远古残骸（稀有）', (markers.get(Block.ANCIENT_DEBRIS) ?? 0) > 0, `远古残骸 ${markers.get(Block.ANCIENT_DEBRIS)}`);
  // 判据是**跨维度比值**（批次 103，B103-5）：见上面那两个参考数的说明。
  // 要挡的是"下界生成慢到比主世界高一个量级"这种退化。
  check(
    `下界生成 ≤ 主世界的 3 倍（实测 ${ratio.toFixed(2)} 倍）`,
    ratio <= 3,
    `下界 ${elapsed.toFixed(0)}ms / 主世界 ${overworldMs.toFixed(0)}ms`,
  );
}

// ---------------------------------------------------------------- 2. 群系地表正确性

console.log('\n[群系与地表方块的一致性]');
{
  const generator = new NetherGenerator(SEED);
  const expectations: Array<[number, number, string]> = [
    [NetherBiome.CRIMSON_FOREST, Block.CRIMSON_NYLIUM, '绯红森林 → 绯红菌岩'],
    [NetherBiome.WARPED_FOREST, Block.WARPED_NYLIUM, '诡异森林 → 诡异菌岩'],
    [NetherBiome.SOUL_SAND_VALLEY, Block.SOUL_SAND, '灵魂沙峡谷 → 灵魂沙'],
  ];

  for (const [biome, expected, label] of expectations) {
    // 找一片属于该群系的区域
    let hits = 0;
    let matched = 0;
    for (let x = -2000; x <= 2000 && hits < 40; x += 17) {
      for (let z = -2000; z <= 2000 && hits < 40; z += 17) {
        if (generator.biomeAt(x, z) !== biome) continue;
        const floor = generator.floorAt(x, z);
        // 直接用生成结果验证（单列所在区块）
        const cx = x >> 4;
        const cz = z >> 4;
        const blocks = generateChunkBlocks(cx, cz, SEED, Dimension.NETHER);
        const id = blocks[Chunk.index(x & 15, floor, z & 15)]!;
        hits++;
        if (id === expected) matched++;
      }
    }
    check(`${label}（采样 ${hits} 列）`, hits > 0 && matched / hits > 0.5, `命中 ${matched}/${hits}`);
  }
}

// ---------------------------------------------------------------- 3. 跨区块一致性

console.log('\n[跨区块一致性与确定性]');
{
  const a = generateChunkBlocks(3, -5, SEED, Dimension.NETHER);
  const b = generateChunkBlocks(3, -5, SEED, Dimension.NETHER);
  let identical = true;
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    if (a[i] !== b[i]) {
      identical = false;
      break;
    }
  }
  check('同一区块生成两遍逐方块一致', identical);

  // 同一棵菌菇树（世界坐标 x=15 贴着区块边界）分别用"拥有者"和"右侧邻居"的写入器种一遍：
  // 树干只落在拥有者那边，树冠由邻居补上，且两侧算出的高度必须一致。
  const stemIds = [Block.CRIMSON_STEM, Block.WARPED_STEM];
  const wartIds: readonly number[] = [Block.NETHER_WART_BLOCK, Block.WARPED_WART_BLOCK];
  const generator = new NetherGenerator(SEED);

  const ownerChunk = new Uint16Array(CHUNK_VOLUME);
  const neighbourChunk = new Uint16Array(CHUNK_VOLUME);
  generator.plantFungusTreeForTest(ownerChunk, 0, 0, 15, 8, true, 77);
  generator.plantFungusTreeForTest(neighbourChunk, 1, 0, 15, 8, true, 77);

  check('树干只写在拥有者区块里', heightRangeCount(neighbourChunk, 33, 100, stemIds) === 0);
  check(
    '树冠伸进邻居区块（接缝不会被切断）',
    heightRangeCount(neighbourChunk, 33, 100, wartIds) > 0,
    `邻居区块疣块 ${heightRangeCount(neighbourChunk, 33, 100, wartIds)}`,
  );

  const wartColumn = (blocks: BlockArray, x: number): string => {
    const ys: number[] = [];
    for (let y = 33; y < 120; y++) if (wartIds.includes(blocks[Chunk.index(x, y, 8)]!)) ys.push(y);
    return ys.join(',');
  };
  check(
    '跨区块重放的树冠高度完全一致（镜像列逐格对得上）',
    wartColumn(ownerChunk, 14) === wartColumn(neighbourChunk, 0) && wartColumn(ownerChunk, 14) !== '',
    `拥有者 x=14 [${wartColumn(ownerChunk, 14)}] vs 邻居 x=0 [${wartColumn(neighbourChunk, 0)}]`,
  );
}

// ---------------------------------------------------------------- 4. 与主世界不同

console.log('\n[维度之间互不干扰]');
{
  const overworld = generateChunkBlocks(0, 0, SEED, Dimension.OVERWORLD);
  const nether = generateChunkBlocks(0, 0, SEED, Dimension.NETHER);
  // 只比较下界真正有内容的竖直范围（-64~128）：再往上下界全是空气，
  // 而主世界地形之上也是空气，那部分相同并不说明"两个维度长得一样"。
  let same = 0;
  let total = 0;
  for (let y = -64; y <= 128; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        total++;
        if (overworld[Chunk.index(x, y, z)] === nether[Chunk.index(x, y, z)]) same++;
      }
    }
  }
  check('同坐标的主世界与下界方块数据完全不同', same / total < 0.25, `y ∈ [-64,128] 内相同比例 ${((same / total) * 100).toFixed(1)}%`);
  check('主世界无下界岩', countBlocks(overworld, Block.NETHERRACK) === 0);
  check('下界无草方块与石头', countBlocks(nether, Block.GRASS_BLOCK) === 0 && countBlocks(nether, Block.STONE) === 0);
  check('Dimension 常量登记了三个维度', Object.keys(Dimension).length === 3, Object.keys(Dimension).join(','));
}

console.log(`\n下界测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
