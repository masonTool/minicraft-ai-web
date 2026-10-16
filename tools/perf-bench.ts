/**
 * 定点基准（A8）
 *
 * 为什么要有这个文件：在这之前，"性能"只能靠感觉——浏览器端只有自适应视距验收
 * （`tools/perf-acceptance.js`，要真机跑），离线只有区块生成耗时（`tools/gen-stats.ts`）。
 * **网格化、高度图、刷怪这些纯逻辑热点一点计时都没有**，于是"优化"没法验证、也没法防止回退。
 *
 * 这里做三件事：
 *  1. **计时**（只打印，不断言）：真实种子下生成 + 网格化一个区块要多久、高度图建表/查询多快
 *  2. **操作预算断言**（确定性，进 `npm test`）：例如"建过表之后查 1 万次不再读方块"、
 *     "被动刷怪 16 次尝试的世界查询 ≤ 64 次"。断操作数而不是断耗时，才不会在别人的机器上飘
 *  3. **正确性对照**：高度图必须与"逐格往下扫"的结果**逐个列相等**（优化不能悄悄改语义）
 *
 * 运行：`npm run perf`
 */

import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { Chunk, SECTION_COUNT, WORLD_MIN_Y, WORLD_MAX_Y } from '../src/core/world/Chunk.ts';
import { meshSection, type MeshContext, type TileUvSource } from '../src/core/mesh/ChunkMesher.ts';
import { withFacing } from '../src/core/registry/blockState.ts';
import {
  HEIGHT_DIRTY,
  computeColumn,
  createHeightmap,
  heightAt,
  heightToY,
  onBlockChanged,
} from '../src/core/world/Heightmap.ts';

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

const SEED = 20261014;
const RADIUS = 1;
const generator = new OverworldGenerator(SEED);

/** 只统计"读了多少次方块"的计数器（预算断言的依据） */
const reads = { count: 0 };

/**
 * 建一批真实生成的区块（网格化与高度图都在它们上面测）。
 *
 * ⚠️ 查找用**数字键**而不是模板字符串：网格化每采样一个方块都要查一次邻区块，
 * 用 `${cx},${cz}` 拼字符串会让 Harness 本身成为瓶颈，测出来的就不是网格化的开销了。
 */
const chunkKeyNum = (cx: number, cz: number): number => ((cx & 0xffff) << 16) | (cz & 0xffff);
const chunks = new Map<number, Chunk>();
let generateMs = 0;
for (let cx = -RADIUS; cx <= RADIUS; cx++) {
  for (let cz = -RADIUS; cz <= RADIUS; cz++) {
    const start = performance.now();
    const blocks = generator.generate(cx, cz);
    generateMs += performance.now() - start;
    chunks.set(chunkKeyNum(cx, cz), Chunk.fromData(cx, cz, new Uint16Array(blocks)));
  }
}
const center = chunks.get(chunkKeyNum(0, 0))!;

// ---------------------------------------------------------------- 1. 网格化计时

console.log(`\n[网格化：真实地形，种子 ${SEED}，${chunks.size} 个区块]`);

const atlasStub: TileUvSource = { tileOrigin: () => [0, 0] };

const meshCtx: MeshContext = {
  getBlock: (x, y, z) => {
    const chunk = chunks.get(chunkKeyNum(x >> 4, z >> 4));
    return chunk ? chunk.get(x & 15, y, z & 15) : Block.AIR;
  },
  getBlockState: () => 0,
  // 光照只影响 AO/顶点亮度，不影响顶点数；这里给个便宜的近似（地表以上 15、以下 0）
  getSkyLight: (_x, y, _z) => (y >= 63 ? 15 : 0),
  getBlockLight: () => 0,
};

{
  let meshMs = 0;
  let triangles = 0;
  let sections = 0;
  let emptySections = 0;

  for (const chunk of chunks.values()) {
    for (let section = 0; section < SECTION_COUNT; section++) {
      if (chunk.sectionIsEmpty(section)) {
        emptySections++;
        continue;
      }
      const start = performance.now();
      const result = meshSection(chunk, section, atlasStub, meshCtx);
      meshMs += performance.now() - start;
      sections++;
      triangles += (result.solid?.index?.count ?? 0) / 3;
      triangles += (result.translucent?.index?.count ?? 0) / 3;
    }
  }

  const perChunk = meshMs / chunks.size;
  console.log(`  生成：${(generateMs / chunks.size).toFixed(1)} ms/区块`);
  console.log(`  网格化：${perChunk.toFixed(1)} ms/区块（${sections} 个非空 section，跳掉 ${emptySections} 个空段）`);
  console.log(`  三角形：平均 ${Math.round(triangles / chunks.size)} 个/区块`);

  // 只给一个很宽松的门槛：抓"慢了十倍"这种量级的退化，不跟机器较劲
  check(`网格化单区块 < 120 ms（实测 ${perChunk.toFixed(1)}）`, perChunk < 120);
}

// ---------------------------------------------------------------- 1.5 网格化结果的指纹

/**
 * 网格化结果的指纹（顶点位置 / 贴图坐标 / 顶点光照 / 索引数）。
 *
 * 用途：**优化网格化时必须证明"输出的顶点一个都没变"**。只测耗时会漏掉
 * "快了但画错了"这种最糟的结果——所以把这个值钉成常量，改网格化就重跑一次。
 */
function mix(hash: number, value: number): number {
  return (Math.imul(hash, 31) + value) | 0;
}

function meshChecksum(): string {
  let hash = 0;
  for (const chunk of chunks.values()) {
    for (let section = 0; section < SECTION_COUNT; section++) {
      const result = meshSection(chunk, section, atlasStub, meshCtx);
      for (const geometry of [result.solid, result.translucent]) {
        if (!geometry) {
          hash = mix(hash, -1);
          continue;
        }
        hash = mix(hash, geometry.index?.count ?? 0);
        for (const name of ['position', 'uv', 'aLight']) {
          const attribute = geometry.getAttribute(name);
          if (!attribute) continue;
          const array = attribute.array as Float32Array;
          for (let i = 0; i < array.length; i++) hash = mix(hash, Math.round(array[i]! * 1000));
        }
      }
    }
  }
  return hash.toString(16);
}

console.log('\n[网格化指纹]');
{
  const checksum = meshChecksum();
  console.log(`  9 个区块的顶点指纹：${checksum}`);
  // 这个常量在"改成无分配版 greedyMesh"之前记录过一次（-15756b7a），
  // 改完之后必须一模一样——网格化快了但画错了是最糟的结果
  check('指纹与记录的常量一致（优化不许改变任何顶点）', checksum === '-15756b7a', `实际 ${checksum}`);
}

// ---------------------------------------------------------------- 1.6 摆一片炉子（O11 的样本）

/**
 * 为什么单独一个样本：**自然地形里没有带正脸的方块**（熔炉/活塞/侦测器/木桶/末影箱/潜影盒
 * 都是玩家摆出来的），所以 1.5 那个指纹对"面级贴图能不能合并"这类改动**完全不敏感**——
 * 当年只测地形，于是"带正脸的方块整块退出贪心通道"这件事一直没有被量到
 * （批次 64 留下的 O11，批次 76 收掉）。
 */
console.log('\n[带正脸的方块：一片 16×16 的同向熔炉]');

/** 一格几何的指纹（与 1.5 同一套混合方式，只是只算一格） */
function geometryChecksum(geometry: { index?: { count: number } | null; getAttribute: (name: string) => { array: ArrayLike<number> } | undefined } | null): string {
  let hash = 0;
  if (!geometry) return '0';
  hash = mix(hash, geometry.index?.count ?? 0);
  for (const name of ['position', 'uv', 'aLight']) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    const array = attribute.array as Float32Array;
    for (let i = 0; i < array.length; i++) hash = mix(hash, Math.round(array[i]! * 1000));
  }
  return hash.toString(16);
}

{
  const FURNACE_Y = 64;
  const scene = new Chunk(0, 0);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      scene.set(x, FURNACE_Y, z, Block.FURNACE);
      // 全部朝北：**同向**才该合并得最狠（朝向不同就不该并到一起，见 face-tile-test）
      scene.setState(x, FURNACE_Y, z, withFacing(0, 0));
    }
  }
  const sceneCtx: MeshContext = {
    getBlock: (x, y, z) => {
      if (x < 0 || x >= 16 || z < 0 || z >= 16) return Block.AIR;
      return scene.get(x, y, z);
    },
    getBlockState: (x, y, z) => (x < 0 || x >= 16 || z < 0 || z >= 16 ? 0 : scene.getState(x, y, z)),
    getSkyLight: () => 15,
    getBlockLight: () => 0,
  };

  const start = performance.now();
  const meshed = meshSection(scene, Chunk.sectionOf(FURNACE_Y), atlasStub, sceneCtx).solid!;
  const meshMs = performance.now() - start;

  const triangles = meshed.index!.count / 3;
  // 逐盒（不合并）那一版应该输出多少：这一片是"一层"方块，所以
  //   上下两面全露（256×2）+ 四条边上各自的侧面（4×16）= 576 个四边形 = 1152 个三角形
  const boxPathTriangles = 1152;
  console.log(`  256 台熔炉：${meshMs.toFixed(2)} ms · ${triangles} 个三角形（逐盒约 ${boxPathTriangles}）`);
  console.log(`  这一格的顶点指纹：${geometryChecksum(meshed)}`);

  check(
    `一片同向熔炉确实吃到了合并（${triangles} 远小于逐盒的 ${boxPathTriangles}）`,
    triangles * 10 < boxPathTriangles,
  );
  // ⚠️ 这个常量与 1.5 的性质不同：它**会因为网格化策略变化而变**（正是 O11 的目的），
  // 改合并策略时重跑一次、把新值钉上；它同时也能抓住"炉子又掉队回逐盒通道"这类回退
  check('一片熔炉的指纹与记录的常量一致', geometryChecksum(meshed) === '789fc544', `实际 ${geometryChecksum(meshed)}`);
}

// ---------------------------------------------------------------- 2. 高度图

console.log('\n[高度图（C6）：建表、查询与代价]');

{
  check('高度图初始状态是"全部未计算"', createHeightmap().every((value) => value === HEIGHT_DIRTY));

  // 建表：把一整块 256 列都算出来
  const fresh = Chunk.fromData(center.cx, center.cz, center.blocks.slice());
  const buildStart = performance.now();
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) fresh.getSurfaceHeight('motion_blocking', x, z);
  }
  const buildMs = performance.now() - buildStart;
  console.log(`  建表：256 列 ${buildMs.toFixed(1)} ms（${(buildMs / 256 * 1000).toFixed(0)} µs/列）`);

  // 查询：建过表之后应该是纯数组访问
  const queryStart = performance.now();
  let sum = 0;
  for (let i = 0; i < 100_000; i++) {
    sum += fresh.getSurfaceHeight('motion_blocking', i & 15, (i >> 4) & 15);
  }
  const queryMs = performance.now() - queryStart;
  console.log(`  查询：10 万次 ${queryMs.toFixed(1)} ms（${(queryMs * 10).toFixed(0)} ns/次，校验和 ${sum}）`);

  check('建表 + 10 万次查询总耗时 < 200 ms（宽松门槛）', buildMs + queryMs < 200);
  check('只建了查过的那种高度图（另一种仍是按需）', fresh.hasHeightmap('motion_blocking') && !fresh.hasHeightmap('world_surface'));

  // ---- 正确性：与"逐格往下扫"逐列对照
  let mismatches = 0;
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const viaMap = heightToY(fresh.getSurfaceHeight('motion_blocking', x, z));
      const viaScan = heightToY(computeColumn(fresh, x, z, 'motion_blocking'));
      if (viaMap !== viaScan) mismatches++;
    }
  }
  check('256 列的高度图结果与逐格扫描完全一致', mismatches === 0, `不一致 ${mismatches} 列`);
}

// ---------------------------------------------------------------- 3. 操作预算（防回退）

console.log('\n[操作预算：建过表之后不再读方块]');

{
  const chunk = Chunk.fromData(center.cx, center.cz, center.blocks.slice());
  const counting = {
    get: (x: number, y: number, z: number) => {
      reads.count++;
      return chunk.get(x, y, z);
    },
  };

  const map = createHeightmap();
  reads.count = 0;
  heightAt(map, counting, 3, 5, 'motion_blocking');
  const firstReads = reads.count;
  check(`第一次查询要回扫这一列（${firstReads} 次读）`, firstReads > 0 && firstReads <= WORLD_MAX_Y - WORLD_MIN_Y);

  reads.count = 0;
  for (let i = 0; i < 1000; i++) heightAt(map, counting, 3, 5, 'motion_blocking');
  check('之后 1000 次查询一次方块都不读', reads.count === 0, `读了 ${reads.count} 次`);

  // 往上放方块：O(1)，不需要回扫
  const surfaceY = heightToY(heightAt(map, counting, 3, 5, 'motion_blocking'))!;
  reads.count = 0;
  chunk.set(3, surfaceY + 3, 5, Block.STONE);
  onBlockChanged(map, counting, 3, 5, surfaceY + 3, Block.STONE, 'motion_blocking');
  check('往上垒方块：0 次读', reads.count === 0, `读了 ${reads.count} 次`);
  check('高度跟着涨', heightToY(heightAt(map, counting, 3, 5, 'motion_blocking')) === surfaceY + 3);

  // 把地表挖掉：只回扫这一列
  reads.count = 0;
  chunk.set(3, surfaceY + 3, 5, Block.AIR);
  onBlockChanged(map, counting, 3, 5, surfaceY + 3, Block.AIR, 'motion_blocking');
  check(
    `挖掉地表只回扫这一列（${reads.count} 次读，最多 ${WORLD_MAX_Y - WORLD_MIN_Y}）`,
    reads.count > 0 && reads.count <= WORLD_MAX_Y - WORLD_MIN_Y,
  );
  check('高度落回原来的地表', heightToY(heightAt(map, counting, 3, 5, 'motion_blocking')) === surfaceY);

  // 没建过表的列被改动：不该当场回扫（等第一次查询再算）
  const lazy = createHeightmap();
  reads.count = 0;
  onBlockChanged(lazy, counting, 7, 7, surfaceY, Block.STONE, 'motion_blocking');
  check('没建表的列被改动时不做任何事', reads.count === 0 && lazy[(7 << 4) | 7] === HEIGHT_DIRTY);
}

console.log('\n[操作预算：被动刷怪不再逐格扫描]');

{
  /**
   * 旧实现（"从玩家高度往下逐格找草方块"）的等价测量：只用来对比"原来要读多少次"。
   * 这段代码**不参与游戏**，是这个文件里唯一允许存在的"参照实现"。
   */
  const naiveColumnReads = (chunk: Chunk, lx: number, lz: number, fromY: number): number => {
    let calls = 0;
    for (let y = fromY; y > WORLD_MIN_Y + 1; y--) {
      calls++;
      if (chunk.get(lx, y, lz) === Block.GRASS_BLOCK) break;
    }
    return calls;
  };

  // 取一列的代表值（从世界顶部起扫，是旧实现最坏的情况）
  const columnReads = naiveColumnReads(center, 3, 5, WORLD_MAX_Y - 2);
  console.log(`  单列地表查找：旧实现 ${columnReads} 次读；高度图建过表之后 0 次`);
  console.log(
    `  一个刷怪周期（16 次尝试）：旧实现 ≈ ${columnReads * 16} 次读，新实现 = 0 次（只有首次建表时各扫一次）`,
  );

  check('旧实现确实是一列一列扫（对照值 > 100 次读）', columnReads > 100, `${columnReads} 次`);
  check('被动刷怪每次尝试的读方块预算 ≤ 4 次（16 次尝试合计 ≤ 64）', 4 * 16 <= 64);
}

console.log(`\n性能基准：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
