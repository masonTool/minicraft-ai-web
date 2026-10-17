/**
 * 地形"正常度"判据（批次 179）
 *
 * 由来：用户反馈"山不像山、很碎、很陡，陡的下面就是海水，海水里面又是很陡的东西"。
 * 他要的不是"全是平原"，而是**元素齐全（山 / 平地 / 海 / 山洞都有）且各自符合常理**。
 *
 * 与 `terrain-feel-test.ts`（N9"碎不碎"）的分工：
 *   · 那份量的是**代理指标**（相邻高差、连通面积），预算写的是"不许比上一批更差"；
 *   · 这份量的是**"像不像一个正常世界"**：各元素占比是否合理、海底与海岸是不是缓的、
 *     有没有浮空碎片、树能不能落地、山是不是一整片、洞穴还在不在、高度场是不是
 *     由大尺度主导。它的预算是**绝对目标**（来自用户的口径），不是"不许变差"。
 *
 * 为什么必须两条判据都在：调"正常"很容易把"成片的山"调没了（把山削平最省事），
 * 所以这里的元素占比有**下限**——海要有、丘陵与山地要有，不能靠"全平"作弊。
 *
 * 运行：`npm run test:terrain:normal`
 */

import { isSolid } from '../src/core/registry/blocks.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk, WORLD_MIN_Y } from '../src/core/world/Chunk.ts';
import { OverworldGenerator, SEA_LEVEL } from '../src/core/gen/OverworldGenerator.ts';
import { findSafeSpawn, type SpawnSearchWorld } from '../src/core/world/SpawnPoint.ts';
import type { WorldType } from '../src/core/gen/WorldType.ts';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

const SEED = 20261014;
/** 采样步长 = 地形粗网格的水平步长 */
const STEP = 4;
const N = 112;
const SPAN = N * STEP;

/** 各元素的高度分档（相对海平面 63） */
const RANGES = {
  sea: [Number.NEGATIVE_INFINITY, SEA_LEVEL],
  plain: [SEA_LEVEL, SEA_LEVEL + 20],
  hill: [SEA_LEVEL + 20, SEA_LEVEL + 40],
  mountain: [SEA_LEVEL + 40, SEA_LEVEL + 80],
  peak: [SEA_LEVEL + 80, Number.POSITIVE_INFINITY],
} as const;

type Element = keyof typeof RANGES;

/**
 * 目标（"正常世界"该有的样子）。这些是**绝对目标**，不是"不许变差"。
 * 写下来的口径：用户说的"元素齐全 + 符合常理"。
 */
const TARGETS = {
  /** 各元素占比（%） */
  share: {
    sea: [25, 45],
    plain: [38, 62],
    hill: [8, 22],
    // 山不能没有（否则就成了"全平"，那是作弊），也不能太多
    mountain: [1.5, 10],
    peak: [0, 2],
  },
  /** 陆地内部相邻列（4 格步长）高差 */
  landDiffMean: 3.5,
  landDiffP95: 8,
  landDiffMax: 50,
  /** 海底内部相邻列高差（"海水里面不能有很陡的东西"） */
  seaDiffMean: 3,
  seaDiffMax: 30,
  /** 海岸（陆↔海）平均落差 */
  coastMeanDrop: 12,
  coastMaxDrop: 40,
  /** 世界最低点（海床最深处；原版深海约 y=30~50） */
  lowestY: 33,
  /** 每列互相隔开的实心段数（浮空碎片的代理） */
  meanRuns: 1.2,
  /** 地物落点能站住的比例（%）：树能不能长在地上 */
  usableLanding: 92,
  /** 最大连通高地占全部高地的比例（%）：山要"一整片" */
  highlandConnected: 70,
  /** 最大陆地群系斑块（采样点数）与中位数 */
  largestBiomePatch: 2000,
  medianBiomePatch: 15,
  /** 空间尺度谱：|Δ|(64 格) / |Δ|(4 格)，越大越"大尺度主导" */
  scaleRatio64: 3,
  /** 地下空气占比（%）：洞穴还在不在（雕刻器挖出来的） */
  caveShare: [2, 12],
};

interface Grid {
  heights: Float32Array;
  biomes: Int16Array;
  names: string[];
}

function sampleGrid(gen: OverworldGenerator, n: number): Grid {
  const heights = new Float32Array(n * n);
  const biomes = new Int16Array(n * n);
  const names: string[] = [];
  const ids = new Map<number, number>();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * STEP;
      const z = j * STEP;
      heights[j * n + i] = gen.surfaceY(x, z);
      const biome = gen.columnBiome(x, z);
      let slot = ids.get(biome.id);
      if (slot === undefined) {
        slot = names.length;
        ids.set(biome.id, slot);
        names.push(biome.name);
      }
      biomes[j * n + i] = slot;
    }
  }
  return { heights, biomes, names };
}

function elementOf(h: number): Element {
  if (h < RANGES.plain[0]) return 'sea';
  if (h < RANGES.hill[0]) return 'plain';
  if (h < RANGES.mountain[0]) return 'hill';
  if (h < RANGES.peak[0]) return 'mountain';
  return 'peak';
}

interface Diffs {
  mean: number;
  p95: number;
  max: number;
  count: number;
}

function statsOf(values: number[]): Diffs {
  if (values.length === 0) return { mean: 0, p95: 0, max: 0, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  let max = 0;
  for (const v of sorted) {
    sum += v;
    if (v > max) max = v;
  }
  return {
    mean: sum / sorted.length,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
    max,
    count: sorted.length,
  };
}

interface SplitDiffs {
  land: Diffs;
  sea: Diffs;
  coast: Diffs;
  landShare: number;
}

function splitDiffs(heights: Float32Array, n: number, step: number): SplitDiffs {
  const land: number[] = [];
  const sea: number[] = [];
  const coast: number[] = [];
  let landCells = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = heights[j * n + i]!;
      if (h >= SEA_LEVEL) landCells++;
      const push = (a: number, b: number): void => {
        const d = Math.abs(a - b);
        const landA = a >= SEA_LEVEL;
        const landB = b >= SEA_LEVEL;
        if (landA && landB) land.push(d);
        else if (!landA && !landB) sea.push(d);
        else coast.push(d);
      };
      // 只取**正好 step 距离**的对，才能做"尺度谱"（相邻对会混进不同距离）
      if (i + step < n) push(h, heights[j * n + i + step]!);
      if (j + step < n) push(h, heights[(j + step) * n + i]!);
    }
  }
  return {
    land: statsOf(land),
    sea: statsOf(sea),
    coast: statsOf(coast),
    landShare: (landCells / (n * n)) * 100,
  };
}

function componentSizes(
  n: number,
  isTarget: (i: number) => boolean,
  groupOf: (i: number) => number,
): number[] {
  const seen = new Uint8Array(n * n);
  const stack = new Int32Array(n * n);
  const sizes: number[] = [];
  for (let start = 0; start < n * n; start++) {
    if (seen[start] === 1 || !isTarget(start)) continue;
    const group = groupOf(start);
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let size = 0;
    while (top > 0) {
      const cur = stack[--top]!;
      size++;
      const ci = cur % n;
      const cj = (cur / n) | 0;
      const neighbours = [
        ci > 0 ? cur - 1 : -1,
        ci + 1 < n ? cur + 1 : -1,
        cj > 0 ? cur - n : -1,
        cj + 1 < n ? cur + n : -1,
      ];
      for (const nb of neighbours) {
        if (nb < 0 || seen[nb] === 1) continue;
        if (!isTarget(nb) || groupOf(nb) !== group) continue;
        seen[nb] = 1;
        stack[top++] = nb;
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

/**
 * 最小可用的世界探针：只给 `findSafeSpawn` 需要的三个方法。
 * 用它量"出生点到底选不选得出来"——这是玩家第一眼看到什么的关键，
 * 而它此前从没被量过。
 */
class ProbeWorld implements SpawnSearchWorld {
  private readonly chunks = new Map<string, Uint16Array>();

  constructor(private readonly gen: OverworldGenerator) {}

  private ensure(cx: number, cz: number): Uint16Array {
    const key = `${cx},${cz}`;
    let blocks = this.chunks.get(key);
    if (!blocks) {
      blocks = this.gen.generate(cx, cz);
      this.chunks.set(key, blocks);
    }
    return blocks;
  }

  isLoaded(x: number, z: number): boolean {
    const cx = Math.floor(x / CHUNK_SIZE_X);
    const cz = Math.floor(z / CHUNK_SIZE_Z);
    return this.chunks.has(`${cx},${cz}`);
  }

  preload(radiusChunks: number): void {
    for (let cz = -radiusChunks; cz <= radiusChunks; cz++) {
      for (let cx = -radiusChunks; cx <= radiusChunks; cx++) this.ensure(cx, cz);
    }
  }

  getBlock(x: number, y: number, z: number): number {
    const cx = Math.floor(x / CHUNK_SIZE_X);
    const cz = Math.floor(z / CHUNK_SIZE_Z);
    const blocks = this.chunks.get(`${cx},${cz}`);
    if (!blocks) return 0;
    const lx = x - cx * CHUNK_SIZE_X;
    const lz = z - cz * CHUNK_SIZE_Z;
    return blocks[Chunk.index(lx, y, lz)]!;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return isSolid(this.getBlock(x, y, z));
  }
}

const worldTypes: readonly WorldType[] = ['default', 'amplified'];

for (const worldType of worldTypes) {
  const gen = new OverworldGenerator(SEED, worldType);
  const grid = sampleGrid(gen, N);

  console.log(`\n[${worldType}｜${SPAN}×${SPAN} 格，每 ${STEP} 格采一点]`);

  // ---- 1. 元素占比：海 / 平原 / 丘陵 / 山地 / 高山
  const counts: Record<Element, number> = { sea: 0, plain: 0, hill: 0, mountain: 0, peak: 0 };
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < N * N; i++) {
    const h = grid.heights[i]!;
    counts[elementOf(h)]++;
    if (h < lowest) lowest = h;
    if (h > highest) highest = h;
  }
  const share = (k: Element): number => (counts[k] / (N * N)) * 100;
  console.log(
    `  元素占比：海 ${share('sea').toFixed(0)}% · 平原 ${share('plain').toFixed(0)}% · ` +
      `丘陵 ${share('hill').toFixed(0)}% · 山地 ${share('mountain').toFixed(0)}% · 高山 ${share('peak').toFixed(1)}%` +
      `（最低 y=${lowest} · 最高 y=${highest}）`,
  );
  for (const key of ['sea', 'plain', 'hill', 'mountain', 'peak'] as const) {
    const [lo, hi] = TARGETS.share[key];
    const actual = share(key);
    check(
      `${key} 占比 ${lo}~${hi}%`,
      actual >= lo && actual <= hi,
      `实测 ${actual.toFixed(1)}%`,
    );
  }

  // ---- 2. 陆地 / 海底 / 海岸的相邻列高差（4 格步长）
  const near = splitDiffs(grid.heights, N, 1);
  console.log(
    `  陆地内部（4 格）：平均 ${near.land.mean.toFixed(2)} · p95 ${near.land.p95} · 最大 ${near.land.max}（${near.land.count} 对）`,
  );
  check(
    `陆地内部相邻高差平均 ≤ ${TARGETS.landDiffMean} 格`,
    near.land.mean <= TARGETS.landDiffMean,
    `实测 ${near.land.mean.toFixed(2)}`,
  );
  check(
    `陆地内部相邻高差 p95 ≤ ${TARGETS.landDiffP95} 格`,
    near.land.p95 <= TARGETS.landDiffP95,
    `实测 ${near.land.p95}`,
  );
  check(
    `陆地内部相邻高差最大 ≤ ${TARGETS.landDiffMax} 格（没有断崖式跳变）`,
    near.land.max <= TARGETS.landDiffMax,
    `实测 ${near.land.max}`,
  );

  console.log(
    `  海底内部（4 格）：平均 ${near.sea.mean.toFixed(2)} · 最大 ${near.sea.max}（${near.sea.count} 对）`,
  );
  check(
    `海底内部相邻高差平均 ≤ ${TARGETS.seaDiffMean} 格（"海水里面没有很陡的东西"）`,
    near.sea.mean <= TARGETS.seaDiffMean,
    `实测 ${near.sea.mean.toFixed(2)}`,
  );
  check(
    `海底内部相邻高差最大 ≤ ${TARGETS.seaDiffMax} 格`,
    near.sea.max <= TARGETS.seaDiffMax,
    `实测 ${near.sea.max}`,
  );

  console.log(
    `  海岸（陆↔海）：平均落差 ${near.coast.mean.toFixed(2)} · 最大 ${near.coast.max}（${near.coast.count} 对）`,
  );
  check(
    `海岸平均落差 ≤ ${TARGETS.coastMeanDrop} 格（岸是缓坡，不是墙）`,
    near.coast.mean <= TARGETS.coastMeanDrop,
    `实测 ${near.coast.mean.toFixed(2)}`,
  );
  check(
    `海岸最大落差 ≤ ${TARGETS.coastMaxDrop} 格`,
    near.coast.max <= TARGETS.coastMaxDrop,
    `实测 ${near.coast.max}`,
  );
  check(
    `世界最低点 ≥ y=${TARGETS.lowestY}（海床不能深到世界底）`,
    lowest >= TARGETS.lowestY,
    `实测 y=${lowest}`,
  );

  // ---- 3. 空间尺度谱：高度场是不是由大尺度主导
  const scales = [1, 2, 4, 8, 16, 32, 64];
  const spectrum = scales.map((d) => (d < N ? splitDiffs(grid.heights, N, d).land : { mean: 0 }));
  const ratio = spectrum[0]!.mean === 0 ? 0 : spectrum[6]!.mean / spectrum[0]!.mean;
  console.log(
    `  空间尺度谱（陆地，平均高差）：${scales
      .map((d, i) => `${d * STEP}格 ${spectrum[i]!.mean.toFixed(1)}`)
      .join(' · ')}`,
  );
  check(
    `尺度谱比值 |Δ|(256格)/|Δ|(4格) ≥ ${TARGETS.scaleRatio64}（大尺度主导，不是噪点）`,
    ratio >= TARGETS.scaleRatio64,
    `实测 ${ratio.toFixed(2)}`,
  );

  // ---- 4. 山体连通：最大一块占全部高地的比例
  {
    const sizes = componentSizes(
      N,
      (i) => grid.heights[i]! >= SEA_LEVEL + 20,
      () => 0,
    );
    const total = sizes.reduce((a, b) => a + b, 0);
    const connected = total === 0 ? 0 : ((sizes[0] ?? 0) / total) * 100;
    console.log(
      `  高地（≥+20）共 ${total} 点、${sizes.length} 块；最大一块 ${sizes[0] ?? 0} 点（占 ${connected.toFixed(0)}%）`,
    );
    check(
      `最大连通高地占高地 ≥ ${TARGETS.highlandConnected}%（山是"一整片"而不是很多碎块）`,
      connected >= TARGETS.highlandConnected,
      `实测 ${connected.toFixed(0)}%`,
    );
  }

  // ---- 5. 群系斑块（陆地）：成片的树林
  {
    const patches = componentSizes(
      N,
      (i) => grid.heights[i]! >= SEA_LEVEL,
      (i) => grid.biomes[i]!,
    );
    const median = patches.length === 0 ? 0 : patches[Math.floor(patches.length / 2)]!;
    console.log(`  陆地群系斑块：${patches.length} 块，最大 ${patches[0] ?? 0} 点、中位数 ${median} 点`);
    check(
      `最大陆地群系斑块 ≥ ${TARGETS.largestBiomePatch} 点`,
      (patches[0] ?? 0) >= TARGETS.largestBiomePatch,
      `实测 ${patches[0] ?? 0}`,
    );
    check(
      `陆地群系斑块中位数 ≥ ${TARGETS.medianBiomePatch} 点（不是一格一换）`,
      median >= TARGETS.medianBiomePatch,
      `实测 ${median}`,
    );
  }

  // ---- 6. 每列实心段数（浮空碎片）
  {
    const landRuns: number[] = [];
    const seaRuns: number[] = [];
    for (let j = 0; j <= N; j += 8) {
      for (let i = 0; i <= N; i += 8) {
        const x = i * STEP;
        const z = j * STEP;
        const runs = gen.densityRunsAt(x, z).length;
        if (gen.surfaceY(x, z) >= SEA_LEVEL) landRuns.push(runs);
        else seaRuns.push(runs);
      }
    }
    const meanOf = (a: number[]): number => (a.length === 0 ? 0 : a.reduce((p, q) => p + q, 0) / a.length);
    console.log(
      `  每列实心段数：陆地平均 ${meanOf(landRuns).toFixed(2)} · 海洋平均 ${meanOf(seaRuns).toFixed(2)}`,
    );
    check(
      `陆地每列实心段数 ≤ ${TARGETS.meanRuns}`,
      meanOf(landRuns) <= TARGETS.meanRuns,
      `实测 ${meanOf(landRuns).toFixed(2)}`,
    );
    check(
      `海洋每列实心段数 ≤ ${TARGETS.meanRuns}`,
      meanOf(seaRuns) <= TARGETS.meanRuns,
      `实测 ${meanOf(seaRuns).toFixed(2)}`,
    );
  }

  // ---- 7. 地物落点能站住 + 洞穴还在 + 出生点选得出来
  {
    let usable = 0;
    let total = 0;
    let caveAir = 0;
    let underground = 0;
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const blocks = gen.generate(cx, cz);
        for (let lz = 0; lz < CHUNK_SIZE_Z; lz += 2) {
          for (let lx = 0; lx < CHUNK_SIZE_X; lx += 2) {
            const wx = cx * CHUNK_SIZE_X + lx;
            const wz = cz * CHUNK_SIZE_Z + lz;
            const y = Math.round(gen.surfaceY(wx, wz));
            const ground = isSolid(blocks[Chunk.index(lx, y, lz)]!) || isSolid(blocks[Chunk.index(lx, y - 1, lz)]!);
            const headroom =
              !isSolid(blocks[Chunk.index(lx, y + 1, lz)]!) && !isSolid(blocks[Chunk.index(lx, y + 2, lz)]!);
            total++;
            if (ground && headroom) usable++;
          }
        }
        // 洞穴：地表以下 5 格起、到世界底之间的空气占比
        for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
            const wx = cx * CHUNK_SIZE_X + lx;
            const wz = cz * CHUNK_SIZE_Z + lz;
            const y = Math.round(gen.surfaceY(wx, wz)) - 5;
            for (let wy = Math.max(WORLD_MIN_Y + 1, y - 48); wy <= y; wy++) {
              underground++;
              if (blocks[Chunk.index(lx, wy, lz)] === 0) caveAir++;
            }
          }
        }
      }
    }
    const landing = (usable / total) * 100;
    console.log(`  可落地的列：${landing.toFixed(1)}%（${usable}/${total}）`);
    check(
      `地物落点能站住 ≥ ${TARGETS.usableLanding}%（树不该浮在半空）`,
      landing >= TARGETS.usableLanding,
      `实测 ${landing.toFixed(1)}%`,
    );

    const caveShare = (caveAir / underground) * 100;
    console.log(`  地下空气占比（洞穴）：${caveShare.toFixed(1)}%（${underground} 格）`);
    check(
      `洞穴体积占比 ${TARGETS.caveShare[0]}~${TARGETS.caveShare[1]}%（雕刻器挖的洞还在）`,
      caveShare >= TARGETS.caveShare[0] && caveShare <= TARGETS.caveShare[1],
      `实测 ${caveShare.toFixed(1)}%`,
    );

    // 出生点：模拟"已加载 7×7 区块、半径 48"的真实搜索
    const probe = new ProbeWorld(gen);
    probe.preload(3);
    const spawn = findSafeSpawn(
      probe,
      (x, z) => gen.columnBiome(x, z).name,
      0,
      0,
      48,
    );
    console.log(
      spawn
        ? `  出生点：找到 (${spawn.x.toFixed(0)}, ${spawn.y.toFixed(0)}, ${spawn.z.toFixed(0)}) 起伏 ${spawn.roughness} · 群系 ${spawn.biome}`
        : '  出生点：**没找到**（玩家会停在 y=80 的悬空位置）',
    );
    check('出生点能在已加载区域里选出来', spawn !== null);
  }

  // ---- 8. 确定性
  {
    const again = new OverworldGenerator(SEED, worldType);
    let same = true;
    for (let i = 0; i < 40 && same; i++) {
      const x = i * 61;
      const z = i * 43;
      if (again.surfaceY(x, z) !== gen.surfaceY(x, z)) same = false;
    }
    check('同一坐标两次采样结果一致（判据可复现）', same);
  }
}

console.log(`\n地形正常度判据：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
