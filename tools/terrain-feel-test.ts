/**
 * 地形观感判据（N9，**批次 101**）
 *
 * 由来：用户反馈"山很**碎**，不像一整座山，也缺少平坦树林"。上一批（批次 100）只做到
 * **诊断**——`densityAt()` 的竖直细节项幅度按"山"的尺度（±35 格）、频率按"4 格"的尺度
 * （采样粗网格只有 4×8×4），两者凑在一起就是尖刺。当时的结论是
 * **"不要盲调，先建判据"**：改噪声参数正是"凭感觉改完更碎"的典型。
 *
 * 这份文件就是那三条判据。它们全部**离线可算、可断言**，于是调参变成
 * "改完看这几个数有没有变好"，而不是"看着像不像"。
 *
 *   判据 1 **相邻列高差分布** —— "碎" = 大量 > 8 格的跳变。
 *          在这一步上量（步长 = 地形粗网格的 4 格），因为**地形网格比方块粗**：
 *          两个相邻网格节点差 30 格、中间靠插值过渡，观感就已经是"尖"的了。
 *   判据 2 **山体连通面积** —— "整片山" = 高于阈值的地块**连成一大块**，
 *          碎山则是很多小碎块。所以看的是**最大连通块的面积**，不是"最高点"。
 *   判据 3 **群系斑块尺寸** —— "平坦树林" = 森林群系成片；碎点则是一格一换。
 *          同时看**最大斑块占采样区多少**，避免"1 格斑块很多、大斑块没有"。
 *
 * 另有一条**正确性**判据（修 N9 的 b 项用的守门人）：
 *   判据 4 **两条高度路径必须一致** —— 地物落点用的 `surfaceY(x,z)` 与
 *          **真正生成出来的地表**不能分家。分家的后果是树浮在半空 / 埋进山体，
 *          而它**只在放大化世界（`reliefScale != 1`）会踩到**——这类"只在某个世界类型
 *          下错"的 bug 最难查，所以这里两种世界类型都跑。
 *
 * 运行：`npm run test:terrain`
 */

import { isSolid } from '../src/core/registry/blocks.ts';
import { Chunk, CHUNK_SIZE_X, CHUNK_SIZE_Z } from '../src/core/world/Chunk.ts';
import { OverworldGenerator, SEA_LEVEL } from '../src/core/gen/OverworldGenerator.ts';

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

/** 采样步长 = 地形粗网格的水平步长（`CELL_XZ`）。比它更密只是在量插值，量不到"碎" */
const STEP = 4;
/** 每边采样点数 → 采样区 = N × STEP 格 */
const N = 112;
const SPAN = N * STEP;

/** "山"的判据：比海平面高这么多格才算高地 */
const HIGH_GROUND = SEA_LEVEL + 20;

/**
 * 判据的**预算**（写法照 `tools/bundle-budget.mjs`：**实测值 + 一点余量**，
 * 并把写预算时的实测值留在注释里）。
 *
 * ⚠️ 它是**一道"不许变差"的闸门，不是性能目标**：调参只能让这些数变好
 * （跳变变少、连通块变大）。
 * ⚠️ 这也是为什么它必须随 N9 的 a 项（真正调地形）一起改：
 * 调完要**主动把实测值改小**并在这里留一行"调前 → 调后"，
 * 否则"改好了"这件事没有任何证据。
 */
const BUDGETS = {
  /**
   * 判据 1：相邻网格节点高差 ≥ 8 格的比例（%）。**越小越好。**
   * 写下这批时的实测：default 60.2 / amplified 71.8（平均 23.45 / 39.10 格，最大 243 / 343）
   */
  roughShare: { default: 62, amplified: 74 },
  /**
   * 判据 2：最大连通高地的采样点数。**越大越好（"一整片山"）。**
   * 写下这批时的实测：default 2787 / amplified 4456
   */
  largestHighland: { default: 2700, amplified: 4300 },
  /**
   * 判据 3：最大群系斑块的采样点数。**越大越好（"成片的树林"）。**
   * 写下这批时的实测：default 512 / amplified 659
   */
  largestBiomePatch: { default: 500, amplified: 640 },
  /**
   * 判据 4：每一列的平均实心段数（理想 1 段 = 一整块地形）。**越小越好。**
   * 写下这批时的实测：default 1.57（最多 4 段）/ amplified 1.45（最多 3 段）
   */
  meanRuns: { default: 1.65, amplified: 1.55 },
  /**
   * 判据 5：能落地（脚下实心 + 头顶有空间）的列占比（%）。**越大越好。**
   * 写下这批时的实测：default 45.5 / amplified 35.4 —— **一半以上站不住**，
   * 这正是"树浮在半空 / 埋进山体"的来源，也是 N9 的 a/b 两项要一起抬上去的数。
   */
  usableLanding: { default: 44, amplified: 34 },
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

interface DiffStats {
  mean: number;
  p95: number;
  max: number;
  /** |Δ| ≥ 8 格 所占比例（%） */
  roughShare: number;
  samples: number;
}

/** 相邻列（左右 / 前后）高差的分布 */
function adjacentDiffStats(heights: Float32Array, n: number): DiffStats {
  const diffs: number[] = [];
  let sum = 0;
  let max = 0;
  let rough = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = heights[j * n + i]!;
      if (i + 1 < n) {
        const d = Math.abs(h - heights[j * n + i + 1]!);
        diffs.push(d);
        sum += d;
        if (d > max) max = d;
        if (d >= 8) rough++;
      }
      if (j + 1 < n) {
        const d = Math.abs(h - heights[(j + 1) * n + i]!);
        diffs.push(d);
        sum += d;
        if (d > max) max = d;
        if (d >= 8) rough++;
      }
    }
  }
  diffs.sort((a, b) => a - b);
  return {
    mean: sum / diffs.length,
    p95: diffs[Math.floor(diffs.length * 0.95)] ?? 0,
    max,
    roughShare: (rough / diffs.length) * 100,
    samples: diffs.length,
  };
}

/**
 * 四邻连通块的大小（从大到小）。
 * `isTarget(i)` 决定这一格算不算；`sameAs` 给出"换一个起始格"时需要比较的值。
 */
function componentSizes(n: number, isTarget: (i: number) => boolean, groupOf: (i: number) => number): number[] {
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

// ---------------------------------------------------------------- 逐世界类型跑

/** 只跑这两种：`flat` 是超平坦（没有噪声地形），这些判据对它没有意义 */
const worldTypes: Array<'default' | 'amplified'> = ['default', 'amplified'];

for (const worldType of worldTypes) {
  const gen = new OverworldGenerator(SEED, worldType);
  const grid = sampleGrid(gen, N);

  console.log(`\n[${worldType}｜${SPAN}×${SPAN} 格，每 ${STEP} 格采一个点（${N}×${N}）]`);

  // ---- 判据 1：相邻列高差分布
  const stats = adjacentDiffStats(grid.heights, N);
  console.log(
    `  相邻列高差：平均 ${stats.mean.toFixed(2)} · p95 ${stats.p95} · 最大 ${stats.max} · ` +
      `≥8 格占 ${stats.roughShare.toFixed(1)}%（${stats.samples} 个相邻对）`,
  );
  check(
    `相邻列高差 ≥8 格的比例 ≤ ${BUDGETS.roughShare[worldType]}%（越少越"像山脊"）`,
    stats.roughShare <= BUDGETS.roughShare[worldType],
    `实测 ${stats.roughShare.toFixed(1)}%（预算按"不许变差"设，见 BUDGETS 注释）`,
  );

  // ---- 判据 2：山体连通面积
  const highland = componentSizes(
    N,
    (i) => grid.heights[i]! >= HIGH_GROUND,
    () => 0,
  );
  const highlandCells = highland.reduce((a, b) => a + b, 0);
  const largest = highland[0] ?? 0;
  console.log(
    `  高地（≥${HIGH_GROUND}）共 ${highlandCells} 个采样点、${highland.length} 块连通；` +
      `最大一块 ${largest} 点（占高地 ${highlandCells ? ((largest / highlandCells) * 100).toFixed(0) : 0}%）；` +
      `前 5 大 ${highland.slice(0, 5).join(', ')}`,
  );
  check(
    `最大连通高地 ≥ ${BUDGETS.largestHighland[worldType]} 点（碎山会退化成很多小块）`,
    largest >= BUDGETS.largestHighland[worldType],
    `实测 ${largest}`,
  );

  // ---- 判据 3：群系斑块尺寸
  const patches = componentSizes(
    N,
    () => true,
    (i) => grid.biomes[i]!,
  );
  const frequent = new Map<number, number>();
  for (let i = 0; i < N * N; i++) frequent.set(grid.biomes[i]!, (frequent.get(grid.biomes[i]!) ?? 0) + 1);
  const biomeSummary = [...frequent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([slot, count]) => `${grid.names[slot] ?? '?'} ${((count / (N * N)) * 100).toFixed(0)}%`)
    .join(' · ');
  console.log(
    `  群系：${patches.length} 个斑块，最大 ${patches[0] ?? 0} 点、` +
      `中位数 ${patches[Math.floor(patches.length / 2)] ?? 0} 点；面积前四 ${biomeSummary}`,
  );
  check(
    `最大群系斑块 ≥ ${BUDGETS.largestBiomePatch[worldType]} 点（"成片"的树林）`,
    (patches[0] ?? 0) >= BUDGETS.largestBiomePatch[worldType],
    `实测 ${patches[0] ?? 0}`,
  );

  // ---- 判据 4：密度场在**竖直方向**的碎法（每一列有几段互相隔开的实心块）
  //
  // 这一条是这次建判据时**意外量出来**的：判据 1 只看水平高差，看不出竖直方向的问题。
  // 实测一列能有十几段——"一层薄片、空气、再一层"。它有两个直接后果：
  //   ① 地表高度是"从上往下扫到的第一段"推出来的，**扫到哪一段就决定树长在哪**
  //      （所以这个数直接关系到"树浮空 / 埋进山体"）；
  //   ② 那些薄片就是玩家眼里的"浮空碎块"。
  // 理想值是 **1 段**（一整块地形）。段数越多 = 越碎。
  {
    const runCounts: number[] = [];
    for (let j = 0; j <= N; j += 8) {
      for (let i = 0; i <= N; i += 8) {
        runCounts.push(gen.densityRunsAt(i * STEP, j * STEP).length);
      }
    }
    const mean = runCounts.reduce((a, b) => a + b, 0) / runCounts.length;
    const maxRuns = Math.max(...runCounts);
    const single = (runCounts.filter((c) => c <= 1).length / runCounts.length) * 100;
    console.log(
      `  每列实心段数：平均 ${mean.toFixed(2)} 段 · 最多 ${maxRuns} 段 · 只有 1 段的占 ${single.toFixed(0)}%（${runCounts.length} 列）`,
    );
    check(
      `每列实心段数平均 ≤ ${BUDGETS.meanRuns[worldType]} 段（理想 1 段 = 一整块地形）`,
      mean <= BUDGETS.meanRuns[worldType],
      `实测平均 ${mean.toFixed(2)} / 最多 ${maxRuns}`,
    );
  }

  // ---- 判据 5：地物落点**真的能站得住**
  //
  // 这条直接对应玩家看到的现象：落点若落在空气或薄片上 → 树浮在半空；
  // 落点上方若还是石头 → 树埋进山体。判据是"落点那一格（容 1 格）是实心，
  // 且它上面两格不是实心"。
  //
  // ⚠️ 必须用 `gen.generate()` 而不是 `generateChunkBlocks()`：后者会把**地物**（树、草）
  // 一起写进去，而树叶与原木都是实心方块——量到的是"树梢"不是"地表"
  // （实测能差出 20+ 格，看起来像 bug，其实是测错了东西）。
  {
    let usable = 0;
    let total = 0;
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
      }
    }
    const share = (usable / total) * 100;
    console.log(`  可落地的列：${share.toFixed(1)}%（${usable}/${total}）`);
    check(
      `地物落点能站住（脚下实心 + 头顶有空间）≥ ${BUDGETS.usableLanding[worldType]}%`,
      share >= BUDGETS.usableLanding[worldType],
      `实测 ${share.toFixed(1)}%`,
    );
  }

  // ---- 判据 5：确定性（判据本身必须可复现，否则调参没法比）
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

console.log(`\n地形观感判据：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
