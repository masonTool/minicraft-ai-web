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
   * 调前（批次 101，只修了公式分家）→ 调后（批次 102，N9-a 调参）：
   *   default    60.2% → **58.3%**（平均 23.45 → 18.98 格，最大 243 → 234）
   *   amplified  71.8% → **66.0%**（平均 39.10 → 27.48 格）
   */
  roughShare: { default: 60, amplified: 68 },
  /**
   * 判据 1b：**陆地内部**（相邻两侧都在海平面上）相邻列高差的**平均**（格）。**越小越好。**
   * 这是"山碎不碎"的**纯**指标 —— 判据 1 被海岸污染了（见 `splitAdjacentDiffStats`）。
   * 写下这批（批次 106）时的实测：default **16.11** / amplified **21.81**
   */
  landRoughMean: { default: 17, amplified: 23 },
  /**
   * 判据 1c：**海岸**（一侧在海上、一侧在陆上）相邻列高差的**平均**（格）。**越小越好。**
   * 量的是"海有多深、岸有多陡"：批次 105 实测深海列实心只到 y≈-20~-45
   * （比海平面低 80~110 格，原版约 y=30~50），于是岸成了一道墙。
   * 写下这批（批次 106）时的实测：default **40.18** / amplified **65.25**
   * （同一批还量到最低点 y=**-64**，也就是世界底部 —— 深海海床比海平面低 127 格）
   */
  coastMeanDrop: { default: 42, amplified: 68 },
  /**
   * 判据 2：最大连通高地的采样点数。**越大越好（"一整片山"）。**
   * N9-a：default 2787 → 3201、amplified 4456 → 6331。
   *
   * ⚠️ 批次 179（地形正常化）之后**这个绝对值必然变小**：世界改成"平原为主"，
   * 高于 +20 的地块总量从 5843 点掉到 3238 点，最大一块自然也跟着从 3201 掉到 2804。
   * 变的不是"碎不碎"，而是"高地有多少"——所以从这一批起，**这条判据改用占比**
   * （`largestHighlandShare`），绝对点数只留作参考与回归锚点。
   * 实测（批次 179）：default 占 **87%**（批前 54%）、amplified **83%**（批前 93%）。
   */
  largestHighland: { default: 2700, amplified: 2700 },
  /** 判据 2b：最大连通高地**占全部高地**的比例（%）。与"高地有多少"解耦，越大越"成片" */
  largestHighlandShare: { default: 70, amplified: 70 },
  /**
   * 判据 3：最大的**陆地**群系斑块的采样点数。**越大越好（"成片的树林"）。**
   *
   * ⚠️ 批次 106（B105-5）**按陆/海拆开之后才发现这条一直量错了东西**：
   * 原来量的是"全体里最大的那块斑块"，而放大化世界里那一块是**海洋**斑块
   * （deep_ocean 连成一片，**1116** 点），**陆地**最大的只有 **778** 点 ——
   * 也就是说"成片的树林"这个诉求**从来没有被真正量到过**。
   * 现在断言落在陆地上，预算也按陆地的实测值重新校准。
   * 写下这批（批次 106）时的实测：default 陆地 775 / 海洋 642、
   * amplified 陆地 778 / 海洋 1116。
   */
  largestBiomePatch: { default: 750, amplified: 750 },
  /**
   * 判据 4：每一列的平均实心段数（理想 1 段 = 一整块地形）。**越小越好。**
   * N9-b（批次 153）把贴地细节下限 0.5 → 0.35 后：
   * default 陆地 **1.60 → 1.56**、amplified **1.38 → 1.32**（越低越连续）。
   * ⚠️ 批次 106（B105-5）按陆/海拆开后的实测：default 陆地 **1.60**（海洋 1.49）、
   * amplified 陆地 **1.38**（海洋 1.59）—— 放大化反而是**陆地比海洋好**，
   * 所以混在一起量会把两者的走向搅在一起。预算按陆地重新校准。
   *
   * 衰减仍不能封到 0（会造出"死区"、让高地断开）；0.25 的试验也让默认世界最大
   * 连通高地从 3180 跌到 2318，故最终取 0.35，兼顾少碎层与成片山体。
   */
  meanRuns: { default: 1.6, amplified: 1.4 },
  /**
   * 判据 5：能落地（脚下实心 + 头顶有空间）的列占比（%）。**越大越好。**
   * 调前 → 调后：default 45.5% → **46.4%**、amplified 35.4% → **42.4%**
   * （放大化涨得多，因为它的起伏原本更容易把落点甩到空中/山体里）。
   */
  usableLanding: { default: 45, amplified: 41 },
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

/** 一组高差 → 统计量（排序会就地做） */
function statsOf(diffs: number[]): DiffStats {
  diffs.sort((a, b) => a - b);
  let sum = 0;
  let max = 0;
  let rough = 0;
  for (const d of diffs) {
    sum += d;
    if (d > max) max = d;
    if (d >= 8) rough++;
  }
  const samples = diffs.length;
  return {
    mean: samples === 0 ? 0 : sum / samples,
    p95: samples === 0 ? 0 : diffs[Math.floor(samples * 0.95)]!,
    max,
    roughShare: samples === 0 ? 0 : (rough / samples) * 100,
    samples,
  };
}

/** 相邻列（左右 / 前后）高差的分布 */
function adjacentDiffStats(heights: Float32Array, n: number): DiffStats {
  const diffs: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = heights[j * n + i]!;
      if (i + 1 < n) diffs.push(Math.abs(h - heights[j * n + i + 1]!));
      if (j + 1 < n) diffs.push(Math.abs(h - heights[(j + 1) * n + i]!));
    }
  }
  return statsOf(diffs);
}

/**
 * 相邻列高差，**按"两边是陆还是海"拆开**（批次 106，B105-4 / TASKS N10）。
 *
 * 为什么必须拆：判据 1（整体比例）把两件完全不同的东西混在一起量了——
 * 实测（批次 105）海岸只占 14% 的相邻对，却贡献约 **31%** 的幅度
 * （岸 40 格 vs 陆地内部 16 格）。于是照判据 1 调参会把"岸太陡"当成"山太碎"，
 * 调错方向。拆开之后：
 *   · `land`  —— 陆地内部的粗糙度（这才是用户说的"山碎不碎"）
 *   · `coast` —— 海岸坡度（海床 → 陆地的落差，量的是"海有多深、岸有多陡"）
 *   · `sea`   —— 海底自身的起伏
 */
interface SplitDiffStats {
  land: DiffStats;
  sea: DiffStats;
  coast: DiffStats;
  /** 陆地列占比（%） */
  landShare: number;
}

function splitAdjacentDiffStats(heights: Float32Array, n: number, seaLevel: number): SplitDiffStats {
  const landDiffs: number[] = [];
  const seaDiffs: number[] = [];
  const coastDiffs: number[] = [];
  let landCells = 0;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = heights[j * n + i]!;
      if (h >= seaLevel) landCells++;
      const push = (a: number, b: number): void => {
        const d = Math.abs(a - b);
        const landA = a >= seaLevel;
        const landB = b >= seaLevel;
        if (landA && landB) landDiffs.push(d);
        else if (!landA && !landB) seaDiffs.push(d);
        else coastDiffs.push(d);
      };
      if (i + 1 < n) push(h, heights[j * n + i + 1]!);
      if (j + 1 < n) push(h, heights[(j + 1) * n + i]!);
    }
  }

  return {
    land: statsOf(landDiffs),
    sea: statsOf(seaDiffs),
    coast: statsOf(coastDiffs),
    landShare: (landCells / (n * n)) * 100,
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

  // ---- 判据 1b / 1c：把上面那条**拆成"陆地内部"与"海岸"两件事**
  //
  // 判据 1 把"山有多碎"和"海有多深、岸有多陡"混在一起量了：实测海岸只占 14% 的
  // 相邻对、却贡献约 31% 的幅度。不拆开的话，以后照判据 1 调参会**调错方向**
  // （把"岸太陡"当成"山太碎"去削山）。详见 `splitAdjacentDiffStats` 的注释。
  const split = splitAdjacentDiffStats(grid.heights, N, SEA_LEVEL);
  const deepest = Math.min(...grid.heights);
  console.log(
    `  拆开看：陆地列占 ${split.landShare.toFixed(0)}%（最低点 y=${deepest}）· ` +
      `陆地内部 平均 ${split.land.mean.toFixed(2)} / ≥8 格占 ${split.land.roughShare.toFixed(1)}%（${split.land.samples} 对）`,
  );
  console.log(
    `      海岸（陆↔海）平均落差 ${split.coast.mean.toFixed(2)} · p95 ${split.coast.p95} · 最大 ${split.coast.max}` +
      `（${split.coast.samples} 对）· 海底内部 平均 ${split.sea.mean.toFixed(2)}`,
  );
  check(
    `陆地内部的相邻列高差平均 ≤ ${BUDGETS.landRoughMean[worldType]} 格（这才是"山碎不碎"）`,
    split.land.mean <= BUDGETS.landRoughMean[worldType],
    `实测 ${split.land.mean.toFixed(2)} 格`,
  );
  check(
    `海岸（陆↔海）平均落差 ≤ ${BUDGETS.coastMeanDrop[worldType]} 格（量"海有多深、岸有多陡"）`,
    split.coast.mean <= BUDGETS.coastMeanDrop[worldType],
    `实测 ${split.coast.mean.toFixed(2)} 格`,
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
  const connectedShare = highlandCells === 0 ? 0 : (largest / highlandCells) * 100;
  check(
    `最大连通高地占高地 ≥ ${BUDGETS.largestHighlandShare[worldType]}%（与"高地有多少"解耦）`,
    connectedShare >= BUDGETS.largestHighlandShare[worldType],
    `实测 ${connectedShare.toFixed(0)}%`,
  );

  // ---- 判据 3：群系斑块尺寸（**按陆 / 海分开**，批次 106，B105-5）
  //
  // ⚠️ 原来只量"全体里最大的那一块斑块"，而最大的一块**多半是海洋群系**
  // （深海/冻洋能连成一大片）—— 那**不是**用户说的"成片的树林"。
  // 更要紧的是它的**口径受海陆比例影响**：抬深海床会让陆地列从 69% 变成 63%，
  // 斑块大小跟着漂，于是分不清"真变差"与"口径漂移"
  // （批次 106 试的三条治"海太深"的路全撞在这上面，见 TASKS N10）。
  // 拆开之后，断言落在**陆地**那块上（那才对应"树林成片"），海洋那块只打印。
  const landPatches = componentSizes(
    N,
    (i) => grid.heights[i]! >= SEA_LEVEL,
    (i) => grid.biomes[i]!,
  );
  const seaPatches = componentSizes(
    N,
    (i) => grid.heights[i]! < SEA_LEVEL,
    (i) => grid.biomes[i]!,
  );
  const patches = landPatches;
  const frequent = new Map<number, number>();
  for (let i = 0; i < N * N; i++) frequent.set(grid.biomes[i]!, (frequent.get(grid.biomes[i]!) ?? 0) + 1);
  const biomeSummary = [...frequent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([slot, count]) => `${grid.names[slot] ?? '?'} ${((count / (N * N)) * 100).toFixed(0)}%`)
    .join(' · ');
  console.log(
    `  群系斑块（陆地）：${landPatches.length} 块，最大 ${landPatches[0] ?? 0} 点、` +
      `中位数 ${landPatches[Math.floor(landPatches.length / 2)] ?? 0} 点` +
      ` ｜（海洋）：${seaPatches.length} 块，最大 ${seaPatches[0] ?? 0} 点`,
  );
  console.log(`  群系面积前四：${biomeSummary}`);
  check(
    `最大**陆地**群系斑块 ≥ ${BUDGETS.largestBiomePatch[worldType]} 点（"成片"的树林）`,
    (patches[0] ?? 0) >= BUDGETS.largestBiomePatch[worldType],
    `实测陆地最大 ${patches[0] ?? 0} 点（海洋最大 ${seaPatches[0] ?? 0}）`,
  );

  // ---- 判据 4：密度场在**竖直方向**的碎法（每一列有几段互相隔开的实心块）
  //
  // 这一条是这次建判据时**意外量出来**的：判据 1 只看水平高差，看不出竖直方向的问题。
  // 实测一列能有十几段——"一层薄片、空气、再一层"。它有两个直接后果：
  //   ① 地表高度是"从上往下扫到的第一段"推出来的，**扫到哪一段就决定树长在哪**
  //      （所以这个数直接关系到"树浮空 / 埋进山体"）；
  //   ② 那些薄片就是玩家眼里的"浮空碎块"。
  // 理想值是 **1 段**（一整块地形）。段数越多 = 越碎。
  //
  // ⚠️ 与判据 3 同样的问题（批次 106，B105-5）：全体平均里混着**海洋列**，
  // 而海洋列是"水 + 海床"，本来就与陆地的形状不同；更要紧的是口径受**海陆比例**影响。
  // 所以按陆/海分开，断言落在**陆地**上。
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
    const maxOf = (a: number[]): number => (a.length === 0 ? 0 : Math.max(...a));
    const singleShare = (a: number[]): number =>
      a.length === 0 ? 0 : (a.filter((c) => c <= 1).length / a.length) * 100;
    const land = meanOf(landRuns);
    console.log(
      `  每列实心段数（陆地）：平均 ${land.toFixed(2)} 段 · 最多 ${maxOf(landRuns)} 段 · ` +
        `只有 1 段的占 ${singleShare(landRuns).toFixed(0)}%（${landRuns.length} 列）` +
        ` ｜（海洋）：平均 ${meanOf(seaRuns).toFixed(2)} 段（${seaRuns.length} 列）`,
    );
    check(
      `陆地每列实心段数平均 ≤ ${BUDGETS.meanRuns[worldType]} 段（理想 1 段 = 一整块地形）`,
      land <= BUDGETS.meanRuns[worldType],
      `实测陆地平均 ${land.toFixed(2)} / 最多 ${maxOf(landRuns)}`,
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

  // ---- 判据 6：确定性（判据本身必须可复现，否则调参没法比）
  // ⚠️ 原来这里也写着"判据 5"（与上面那条重号），批次 106 顺手改成 6。
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
