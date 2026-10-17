/**
 * 结构生成（J1）离线测试
 *
 * 覆盖四块：
 *  1. 七种结构都能在**真实地形**里生成，且每种都**跨区块**——判据是"结构落在 ≥2 个不同区块里"，
 *     这是"结构必须在每个相交区块里各自重放同一份实例"的直接证据；
 *     若只在原点区块生成，包围盒会被截断在 16 格内、涉及的区块数只能是 1。
 *  2. 确定性：同一种子重复生成逐方块一致，与区块生成顺序无关。
 *  3. 村庄集成测试：门方块与**方块状态**（朝向/开关）都要正确落到区块里。
 *  4. 定义表自检：结构用到的方块都在注册表里。
 *
 * 运行：npm run test:structure
 */

import { Block, BLOCKS, blockDef } from '../src/core/registry/blocks.ts';
import { chestLootIndex } from '../src/core/registry/blockState.ts';
import { FeatureWriter, type FeatureWorld } from '../src/core/gen/Features.ts';
import {
  STRUCTURE_KINDS,
  generateStructures,
  nearestStronghold,
  structureInstanceForTest,
  type StructureKind,
} from '../src/core/gen/Structures.ts';
import { generateChunkBlocks, takeGeneratedStates } from '../src/core/gen/TerrainGenerator.ts';
import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import {
  type BlockArray,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  CHUNK_VOLUME,
  Chunk,
} from '../src/core/world/Chunk.ts';

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

// ---------------------------------------------------------------- 工具

/** 6 种木板（沉船的船体会混用不同木材） */
const ALL_PLANKS = [Block.OAK_PLANKS, 103, 108, 113, 118, 123];

interface RegionResult {
  count: number;
  /** 材料出现在几个不同的区块里 */
  chunks: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * 用真实地形生成覆盖给定范围的区块，并统计某种材料。
 * 区域是**按结构的包围盒**开的：如果结构只在原点区块生成，
 * 区域里其它区块就是空的（chunks 计数 = 1），一眼看得出来。
 */
function buildReal(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  ids: readonly number[],
): RegionResult {
  const cx0 = Math.floor(minX / CHUNK_SIZE_X);
  const cx1 = Math.floor(maxX / CHUNK_SIZE_X);
  const cz0 = Math.floor(minZ / CHUNK_SIZE_Z);
  const cz1 = Math.floor(maxZ / CHUNK_SIZE_Z);

  let count = 0;
  const touched = new Set<string>();
  let bMinX = Infinity;
  let bMaxX = -Infinity;
  let bMinY = Infinity;
  let bMaxY = -Infinity;
  let bMinZ = Infinity;
  let bMaxZ = -Infinity;

  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const blocks = generateChunkBlocks(cx, cz, SEED);
      const originX = cx * CHUNK_SIZE_X;
      const originZ = cz * CHUNK_SIZE_Z;
      for (let y = -64; y < 320; y++) {
        for (let z = 0; z < CHUNK_SIZE_Z; z++) {
          for (let x = 0; x < CHUNK_SIZE_X; x++) {
            const id = blocks[Chunk.index(x, y, z)]!;
            if (!ids.includes(id)) continue;
            count++;
            touched.add(`${cx},${cz}`);
            const wx = originX + x;
            const wz = originZ + z;
            if (wx < bMinX) bMinX = wx;
            if (wx > bMaxX) bMaxX = wx;
            if (wz < bMinZ) bMinZ = wz;
            if (wz > bMaxZ) bMaxZ = wz;
            if (y < bMinY) bMinY = y;
            if (y > bMaxY) bMaxY = y;
          }
        }
      }
    }
  }

  return { count, chunks: touched.size, minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY, minZ: bMinZ, maxZ: bMaxZ };
}

/**
 * 找一个真实会生成的结构实例。
 * 大间距结构的单元宽达 1536 格，"生成一片区域碰一个"要铺 96×96 个区块，
 * 因此这里用 structureInstanceForTest 逐个单元求解候选点。
 */
function findInstance(kind: StructureKind, world: FeatureWorld): NonNullable<ReturnType<typeof structureInstanceForTest>> | null {
  for (let cellZ = -4; cellZ <= 4; cellZ++) {
    for (let cellX = -4; cellX <= 4; cellX++) {
      const instance = structureInstanceForTest(kind, cellX, cellZ, world, SEED);
      if (instance) return instance;
    }
  }
  return null;
}

const gen = new OverworldGenerator(SEED);

// ---------------------------------------------------------------- 1. 七种结构

console.log('\n[七种结构：都能在真实地形里生成，且都跨区块]');
{
  const cases: Array<{
    kind: StructureKind;
    label: string;
    ids: readonly number[];
    minChunks: number;
    minSpan: number;
  }> = [
    { kind: 'village', label: '村庄（砾石道路）', ids: [Block.GRAVEL], minChunks: 4, minSpan: 20 },
    { kind: 'mineshaft', label: '废弃矿井（木支撑栅栏）', ids: [Block.OAK_FENCE], minChunks: 2, minSpan: 16 },
    { kind: 'stronghold', label: '要塞（石砖走廊）', ids: [Block.STONE_BRICKS], minChunks: 3, minSpan: 32 },
    { kind: 'dungeon', label: '地牢（苔石墙）', ids: [Block.MOSSY_COBBLESTONE], minChunks: 1, minSpan: 6 },
    { kind: 'shipwreck', label: '沉船（船体木板）', ids: ALL_PLANKS, minChunks: 2, minSpan: 14 },
    { kind: 'ocean_monument', label: '海底神殿（海晶石）', ids: [Block.PRISMARINE], minChunks: 4, minSpan: 24 },
    { kind: 'woodland_mansion', label: '林地府邸（深色橡木板）', ids: [123], minChunks: 2, minSpan: 20 },
  ];

  for (const testCase of cases) {
    const instance = findInstance(testCase.kind, gen);
    if (!instance) {
      check(`${testCase.label}：能生成`, false, '在 ±4 个单元里一个候选都没有');
      continue;
    }

    const result = buildReal(instance.minX, instance.maxX, instance.minZ, instance.maxZ, testCase.ids);
    const spanX = result.maxX - result.minX;
    const spanZ = result.maxZ - result.minZ;
    const span = Math.max(spanX, spanZ);
    const detail = `原点 (${instance.x},${instance.y},${instance.z}) · 方块 ${result.count} · 跨 ${result.chunks} 个区块 · 跨度 X ${spanX} / Z ${spanZ} · y ${result.minY}~${result.maxY}`;

    check(`${testCase.label}：生成出材料`, result.count > 0, detail);
    check(`${testCase.label}：跨区块（落在 ≥${testCase.minChunks} 个区块）`, result.chunks >= testCase.minChunks, detail);
    check(`${testCase.label}：水平跨度 ≥ ${testCase.minSpan} 格`, span >= testCase.minSpan, detail);
  }
}

// ---------------------------------------------------------------- 2. 确定性

console.log('\n[确定性与顺序无关]');
{
  const region: Array<[number, number]> = [];
  for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) region.push([cx, cz]);

  const build = (order: Array<[number, number]>): Map<string, BlockArray> => {
    const out = new Map<string, BlockArray>();
    for (const [cx, cz] of order) out.set(`${cx},${cz}`, generateChunkBlocks(cx, cz, SEED));
    return out;
  };

  const first = build(region);
  const second = build(region);
  let identical = true;
  for (const [key, blocks] of first) {
    const other = second.get(key)!;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (blocks[i] !== other[i]) {
        identical = false;
        break;
      }
    }
    if (!identical) break;
  }
  check('同一片区域生成两遍逐方块一致', identical);

  const reversed = build([...region].reverse());
  let orderIndependent = true;
  for (const [key, blocks] of first) {
    const other = reversed.get(key)!;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (blocks[i] !== other[i]) {
        orderIndependent = false;
        break;
      }
    }
    if (!orderIndependent) break;
  }
  check('与区块生成顺序无关（逆序生成结果一致）', orderIndependent);
}

// ---------------------------------------------------------------- 3. 村庄集成测试

console.log('\n[村庄：门方块与方块状态]');
{
  const village = findInstance('village', gen);
  if (!village) {
    check('找到村庄实例', false);
  } else {
    let doors = 0;
    let glass = 0;
    let stateSamples = 0;
    let statesReturned = 0;
    for (let cz = Math.floor(village.minZ / 16); cz <= Math.floor(village.maxZ / 16); cz++) {
      for (let cx = Math.floor(village.minX / 16); cx <= Math.floor(village.maxX / 16); cx++) {
        const blocks = generateChunkBlocks(cx, cz, SEED);
        const states = takeGeneratedStates();
        if (states) {
          statesReturned++;
          for (const value of states) if (value !== 0) stateSamples++;
        }
        for (let y = 0; y < 200; y++) {
          for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
              const id = blocks[Chunk.index(x, y, z)]!;
              if (id === Block.OAK_DOOR) doors++;
              else if (id === Block.GLASS) glass++;
            }
          }
        }
      }
    }
    check('村庄里有门', doors > 0, `门 ${doors}`);
    check('村庄里有玻璃窗', glass > 0, `玻璃 ${glass}`);
    check('门/楼梯的方块状态随区块回传（朝向没有丢）', stateSamples > 0, `非 0 状态 ${stateSamples} 个，返回状态的区块 ${statesReturned} 个`);

    // 门的朝向必须是"贴着墙"的合法值（0-3），且上下半成对出现
    const chunkCx = Math.floor(village.x / 16);
    const chunkCz = Math.floor(village.z / 16);
    const blocks = generateChunkBlocks(chunkCx, chunkCz, SEED);
    const states = takeGeneratedStates();
    let paired = true;
    if (states) {
      for (let y = 0; y < 200; y++) {
        for (let z = 0; z < CHUNK_SIZE_Z; z++) {
          for (let x = 0; x < CHUNK_SIZE_X; x++) {
            if (blocks[Chunk.index(x, y, z)] !== Block.OAK_DOOR) continue;
            const upper = (states[Chunk.index(x, y, z)]! & 0b100000) !== 0;
            const below = y > 0 ? blocks[Chunk.index(x, y - 1, z)] : 0;
            // ⚠️ 批次 179 修：这里原来写的是 `!upper`（查**下半**扇下方有没有门）——
            // 下半扇下面当然是地板，于是它只可能"通过"，实际查的是不存在的情形。
            // 真正要查的是**上半扇**下方必须有它的下半扇（否则就是悬空的门）。
            // 这条断言以前一直没执行到：`states` 为 null 时整段被跳过，而村庄中心
            // 那个区块此前正好没有房子；地形一变、中心区块有了门，它就红了。
            if (upper && below !== Block.OAK_DOOR) paired = false;
          }
        }
      }
    }
    check('门以两格高成对出现（下半的门下方不会悬空）', paired);
  }
}

// ---------------------------------------------------------------- 4. 真实地形抽样

console.log('\n[真实地形抽样：16×16 区块]');
{
  const counts = new Map<number, number>();
  const size = 16;

  /**
   * ⚠️ 判据改成**相对量**（批次 103，B103-6；套路见 B103-5）。
   *
   * 原来写的是"16×16 区块耗时 < 10s"，但它量到的东西里**大头不是生成**——
   * 那个 `counts` 统计要对 256 个区块、每个 98304 格做一遍 `Map.set`（约 2500 万次），
   * 它自己就能吃掉几秒。绝对秒数在并行跑测试集时还会因 CPU 争用偶发变红。
   *
   * 现在：
   *  · **只量生成**（统计扫描挪到计时之外）；
   *  · 纯地形对照**紧跟在同一格之后**量（连续两行取样），
   *    这样争用对两边的影响几乎相同——"先后量"的比值在负载下会飘，见 B103-5。
   */
  let generateMs = 0;
  let terrainMs = 0;
  let terrainSamples = 0;
  for (let cz = -8; cz < size - 8; cz++) {
    for (let cx = -8; cx < size - 8; cx++) {
      const genStart = performance.now();
      const blocks = generateChunkBlocks(cx, cz, SEED);
      generateMs += performance.now() - genStart;
      for (const id of blocks) counts.set(id, (counts.get(id) ?? 0) + 1);

      // 纯地形对照（`OverworldGenerator.generate`：地形 + 地表规则 + 雕刻 + 含水层 + 矿石，
      // 结构与地物是 `generateChunkBlocks` 里额外那一步）。
      // ⚠️ 取样**跨整个区域间隔取**（每 4 行一行），不要只取最前面两行：
      // 那两行恰好没有结构，比值恒等于 1.00 —— 一条永远绿的判据等于没有判据。
      // 注意"结构没落在这里"不代表没花钱：`generateStructures` 对**每个区块**都要跑一遍
      // 放置判定，所以放置逻辑的退化会体现在每一个区块上。
      if (((cz + 8) & 3) === 0) {
        const terrainStart = performance.now();
        gen.generate(cx, cz);
        terrainMs += performance.now() - terrainStart;
        terrainSamples++;
      }
    }
  }
  const perChunk = generateMs / (size * size);
  const terrainPerChunk = terrainMs / Math.max(terrainSamples, 1);
  const ratio = perChunk / Math.max(terrainPerChunk, 0.001);

  const markers: Array<readonly [string, number]> = [
    ['矿井栅栏', Block.OAK_FENCE],
    ['地牢苔石', Block.MOSSY_COBBLESTONE],
    ['要塞石砖', Block.STONE_BRICKS],
    ['海底神殿海晶石', Block.PRISMARINE],
    ['要塞黑曜石', Block.OBSIDIAN],
    ['村庄门', Block.OAK_DOOR],
  ];
  console.log(
    `  ${size}×${size} 区块生成 ${generateMs.toFixed(0)}ms（${perChunk.toFixed(1)} ms/区块）` +
      ` · 纯地形 ${terrainPerChunk.toFixed(1)} ms/区块（${terrainSamples} 区块抽样，每 4 行一行）` +
      ` → 结构与地物占 ${ratio.toFixed(2)} 倍`,
  );
  console.log(`  结构建材：${markers.map(([name, id]) => `${name} ${counts.get(id) ?? 0}`).join(' · ')}`);

  const mineshaft = counts.get(Block.OAK_FENCE) ?? 0;
  check('真实世界里出现了废弃矿井', mineshaft > 20, `栅栏 ${mineshaft}`);
  const kindsSeen = markers.filter(([, id]) => (counts.get(id) ?? 0) > 0).length;
  console.log(`  这片区域里出现的结构种类（按建材判定）：${kindsSeen}`);
  // 判据是**比值**（批次 103，B103-6）：见上面那段说明。
  // 要挡的是"结构生成把地形拖垮"这种退化（例如每个结构都去扫一遍全区块）。
  check(
    `结构与地物的开销 ≤ 纯地形的 3 倍（实测 ${ratio.toFixed(2)} 倍）`,
    ratio <= 3,
    `${perChunk.toFixed(1)} ms/区块 vs 纯地形 ${terrainPerChunk.toFixed(1)} ms/区块`,
  );
}

// ---------------------------------------------------------------- 5. 定义表自检

console.log('\n[结构定义表]');
check('七种结构全部登记', STRUCTURE_KINDS.length === 7, STRUCTURE_KINDS.join(','));
check('结构建材名可读（调试面板会用到）', blockDef(Block.PRISMARINE).name === 'minecraft:prismarine');
check(
  '结构用到的方块都在注册表里',
  [
    Block.GRAVEL,
    Block.PRISMARINE,
    Block.PRISMARINE_BRICKS,
    Block.DARK_PRISMARINE,
    Block.SEA_LANTERN,
    Block.OAK_FENCE,
    Block.OBSIDIAN,
    Block.MOSSY_STONE_BRICKS,
    Block.CRACKED_STONE_BRICKS,
    Block.MOSSY_COBBLESTONE,
    Block.CUT_SANDSTONE,
    Block.SMOOTH_SANDSTONE,
    Block.STONE_BRICKS,
    123,
  ].every((id) => BLOCKS[id] !== undefined),
);

// ---------------------------------------------------------------- 7b. 最近的要塞（批次 114）
//
// 末影之眼要找的就是这个点，而它是**主线程**算出来的（`nearestStronghold`，不看地形）。
// 所以这里要盯死一件事：**那一份"不看地形"的公式与真生成用的公式是同一个**
// （`structureCellOrigin`）——两边一旦错开，眼睛就会指着空地，而两边都"没错"。

console.log('\n[最近的要塞：末影之眼的导航点]');
{
  const stronghold = findInstance('stronghold', gen);
  check('在 ±4 个单元里找得到一座要塞', stronghold !== null);

  if (stronghold) {
    const cellSize = 96 * 16; // 要塞：间距 96 区块
    const cellX = Math.floor(stronghold.x / cellSize);
    const cellZ = Math.floor(stronghold.z / cellSize);
    // 从要塞旁边偏一点问"最近的要塞"：答案必须是它
    const qx = stronghold.x + 40;
    const qz = stronghold.z + 40;
    const near = nearestStronghold(SEED, qx, qz);
    check('问得出最近的要塞', near !== null);
    check(
      '坐标与 `structureInstanceForTest` 逐位一致（同一条 `structureCellOrigin`）',
      near !== null && near.x === stronghold.x && near.z === stronghold.z,
      `眼睛指 (${near?.x},${near?.z})，实际在 (${stronghold.x},${stronghold.z})`,
    );
    check(
      '高度也用结构表里那一个（不是另一套算法）',
      near !== null && near.y === stronghold.y,
      `眼睛给 y=${near?.y}，实例是 y=${stronghold.y}`,
    );

    // "扫 ±1 个单元就够"这条论证要验：把 ±2 的 25 个单元都算一遍，不许有更近的
    let best: { x: number; y: number; z: number; distance: number } | null = null;
    let count = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const instance = structureInstanceForTest('stronghold', cellX + dx, cellZ + dz, gen, SEED);
        if (!instance) continue;
        count++;
        const distance = Math.hypot(instance.x - qx, instance.z - qz);
        if (!best || distance < best.distance) {
          best = { x: instance.x, y: instance.y, z: instance.z, distance };
        }
      }
    }
    check('±2 个单元里每个单元都有一座要塞（chance: 1）', count === 25, `实际 ${count} 座`);
    check(
      '扫 ±1 与扫 ±2 得到的是同一座（"候选点落在单元中间那一半"这条论证）',
      best !== null && near !== null && best.x === near.x && best.z === near.z,
      `±1 → (${near?.x},${near?.z})，±2 → (${best?.x},${best?.z})`,
    );
    check('报出来的距离与手算一致', best !== null && near !== null && Math.abs(near.distance - best.distance) < 1e-9);

    // 换几个问点再验一遍（不能只在"恰好是它"的那一个点成立）
    let mismatches = 0;
    for (const offset of [0, 300, 600, -300, -600, 1200]) {
      const probe = nearestStronghold(SEED, qx + offset, qz + offset);
      if (!probe) {
        mismatches++;
        continue;
      }
      // 问点所在的单元里那座要塞，必须与返回的一致
      const probeCellX = Math.floor(probe.x / cellSize);
      const probeCellZ = Math.floor(probe.z / cellSize);
      const instance = structureInstanceForTest('stronghold', probeCellX, probeCellZ, gen, SEED);
      if (!instance || instance.x !== probe.x || instance.z !== probe.z || instance.y !== probe.y) mismatches++;
    }
    check('换 6 个问点，答案都与真生成的要塞对得上', mismatches === 0, `${mismatches} 个对不上`);
  }
}

// FeatureWriter 也要能脱离 Worker 独立使用：拿一个已知的地牢实例，手工生成它所在的区块
{
  const dungeon = findInstance('dungeon', gen);
  if (dungeon) {
    const cx = Math.floor(dungeon.x / 16);
    const cz = Math.floor(dungeon.z / 16);
    const blocks = new Uint16Array(CHUNK_VOLUME);
    generateStructures(new FeatureWriter(blocks, cx, cz), gen, SEED);
    let count = 0;
    for (const id of blocks) if (id !== 0) count++;
    check(
      'FeatureWriter 可以脱离 Worker 独立生成结构',
      count > 50,
      `区块 (${cx},${cz}) 写入 ${count} 个方块`,
    );
  } else {
    check('找到地牢实例', false);
  }
}

// ---------------------------------------------------------------- 8. 战利品箱（K8 尾巴）

console.log('\n[结构箱都挂着战利品表]');
{
  /**
   * 扫一片区域里的箱子，并检查每一只的状态里都写了战利品表序号。
   *
   * 这条断言盯的是"漏写一个箱子"——那种箱子打开是空的，
   * 而且因为其它箱子都有东西，玩家只会觉得"运气差"。见 `Structures.ts#lootChest`。
   */
  function scanChests(minX: number, maxX: number, minZ: number, maxZ: number): { chests: number; untagged: string[] } {
    const cx0 = Math.floor(minX / CHUNK_SIZE_X);
    const cx1 = Math.floor(maxX / CHUNK_SIZE_X);
    const cz0 = Math.floor(minZ / CHUNK_SIZE_Z);
    const cz1 = Math.floor(maxZ / CHUNK_SIZE_Z);
    let chests = 0;
    const untagged: string[] = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const blocks = generateChunkBlocks(cx, cz, SEED);
        const states = takeGeneratedStates();
        for (let y = -64; y < 320; y++) {
          for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
              if (blocks[Chunk.index(x, y, z)] !== Block.CHEST) continue;
              chests++;
              const state = states ? (states[Chunk.index(x, y, z)] ?? 0) : 0;
              if (chestLootIndex(state) <= 0) untagged.push(`${cx * CHUNK_SIZE_X + x},${y},${cz * CHUNK_SIZE_Z + z}`);
            }
          }
        }
      }
    }
    return { chests, untagged };
  }

  const kinds: StructureKind[] = ['village', 'mineshaft', 'stronghold', 'dungeon', 'shipwreck', 'woodland_mansion'];
  const perKind: string[] = [];
  const untagged: string[] = [];
  let total = 0;
  for (const kind of kinds) {
    const instance = findInstance(kind, gen);
    if (!instance) {
      check(`${kind}：找得到可以扫的实例`, false);
      continue;
    }
    const scanned = scanChests(instance.minX, instance.maxX, instance.minZ, instance.maxZ);
    total += scanned.chests;
    perKind.push(`${kind} ${scanned.chests}`);
    untagged.push(...scanned.untagged);
  }
  console.log(`  各类结构的箱子数：${perKind.join(' · ')}`);
  check(`六种结构里都有战利品箱（共 ${total} 只）`, total >= 6, perKind.join(' · '));
  check('每一只箱子都写了战利品表（没有"打开是空的"箱子）', untagged.length === 0, untagged.slice(0, 3).join(' '));
}

console.log(`\n结构测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
