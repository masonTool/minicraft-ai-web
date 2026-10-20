/**
 * 末地维度（J4）离线测试
 *
 * 覆盖：
 *  1. 主岛：钟形岛体、岛面高度、悬空（岛下方是空气）
 *  2. 黑曜石柱：10 根、环绕岛心、柱顶基岩
 *  3. 中央返回传送门：基岩基座 + 3×3 末地传送门 + 四角火把
 *  4. 外岛与紫颂树、末地城 / 末地船
 *  5. 六种末地群系都出现
 *  6. 确定性 + 跨区块一致（同一座城被区块裁开时拼得回去）
 *  7. 与主世界 / 下界是两套地形
 *
 * 运行：npm run test:end
 */

import { Block } from '../src/core/registry/blocks.ts';
import { chestLootIndex } from '../src/core/registry/blockState.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { END_BIOME_NAMES, EndGenerator } from '../src/core/gen/EndGenerator.ts';
import { generateChunkBlocks, takeGeneratedStates } from '../src/core/gen/TerrainGenerator.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_VOLUME, Chunk, type BlockArray } from '../src/core/world/Chunk.ts';
import { endCityCreatureSpawnsAt } from '../src/core/gen/EndStructures.ts';
import { nearbyStandingSpot } from '../src/core/gen/StructureCreatures.ts';

const SEED = 20261014;

let passed = 0;
let failed = 0;

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

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

const gen = new EndGenerator(SEED);
// ---------------------------------------------------------------- 1. 主岛

console.log('\n[主岛与黑曜石柱]');
{
  // 主岛半径 64 → 覆盖 ±6 个区块足够
  let endStone = 0;
  let obsidian = 0;
  let bedrock = 0;
  let portal = 0;
  let torch = 0;
  let airBelowIsland = 0;
  const tops: number[] = [];

  const start = Date.now();
  for (let cz = -5; cz <= 5; cz++) {
    for (let cx = -5; cx <= 5; cx++) {
      const blocks = generateChunkBlocks(cx, cz, SEED, Dimension.END);
      endStone += countBlocks(blocks, Block.END_STONE);
      obsidian += countBlocks(blocks, Block.OBSIDIAN);
      bedrock += countBlocks(blocks, Block.BEDROCK);
      portal += countBlocks(blocks, Block.END_PORTAL);
      torch += countBlocks(blocks, Block.TORCH);
    }
  }
  const elapsed = Date.now() - start;

  // 岛面高度与"岛下方是空气"：直接问生成器
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
    for (const radius of [0, 16, 32, 48, 60]) {
      const x = Math.round(Math.cos(angle) * radius);
      const z = Math.round(Math.sin(angle) * radius);
      const island = gen.islandAt(x, z);
      if (!island) continue;
      tops.push(island.top);
      const blocks = generateChunkBlocks(Math.floor(x / 16), Math.floor(z / 16), SEED, Dimension.END);
      const localX = x & 15;
      const localZ = z & 15;
      // 岛底再往下 6 格应当是空气（悬空岛）
      if (blocks[Chunk.index(localX, island.bottom - 6, localZ)] === Block.AIR) airBelowIsland++;
    }
  }

  console.log(`  11×11 区块耗时 ${elapsed}ms`);
  console.log(`  末地石 ${endStone} · 黑曜石 ${obsidian} · 基岩 ${bedrock} · 传送门 ${portal} · 火把 ${torch}`);
  console.log(`  岛面高度 ${Math.min(...tops)}~${Math.max(...tops)}`);

  check('主岛由末地石构成', endStone > 100000, `末地石 ${endStone}`);
  check('岛面高度在 48~68 之间', Math.min(...tops) >= 48 && Math.max(...tops) <= 68, `${Math.min(...tops)}~${Math.max(...tops)}`);
  check('岛心比岛缘高（钟形剖面）', (gen.islandAt(0, 0)?.top ?? 0) > (gen.islandAt(58, 0)?.top ?? 999));
  check('岛下方是空气（悬空岛）', airBelowIsland > 20, `${airBelowIsland} 列`);
  check('有黑曜石柱', obsidian > 500, `黑曜石 ${obsidian}`);
  check('柱顶有基岩', bedrock > 40, `基岩 ${bedrock}`);
  check('中央有末地传送门', portal === 9, `传送门方块 ${portal}`);

  // 黑曜石柱：应环绕在半径 42 的圆上
  const pillarPositions: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    pillarPositions.push([Math.round(Math.cos(angle) * 42), Math.round(Math.sin(angle) * 42)]);
  }
  let found = 0;
  for (const [px, pz] of pillarPositions) {
    const blocks = generateChunkBlocks(Math.floor(px / 16), Math.floor(pz / 16), SEED, Dimension.END);
    // 柱高 76~103，所以 y=72（岛面 66 之上）处一定有柱体
    if (blocks[Chunk.index(px & 15, 72, pz & 15)] === Block.OBSIDIAN) found++;
  }
  check('10 根黑曜石柱都在岛上（y=72 处有柱体）', found === 10, `命中 ${found}/10`);
}

// ---------------------------------------------------------------- 2. 外岛与紫颂树

console.log('\n[外岛、紫颂树与末地城]');

// 找到外岛单元（后面的跨区块测试也要用）
const cells: Array<{ cellX: number; cellZ: number; radius: number }> = [];
for (let cellZ = -4; cellZ <= 4; cellZ++) {
  for (let cellX = -4; cellX <= 4; cellX++) {
    const island = gen.outerIslandOfCell(cellX, cellZ);
    if (island && island.radius >= 24) cells.push({ cellX, cellZ, radius: island.radius });
  }
}
{
  check('外岛单元里有足够大的岛', cells.length > 0, `${cells.length} 座`);

  let chorusPlant = 0;
  let chorusFlower = 0;
  let purpur = 0;
  let endRod = 0;
  let chest = 0;
  let islandBlocks = 0;
  const visited = new Set<string>();

  for (const cell of cells.slice(0, 6)) {
    const center = gen.outerIslandOfCell(cell.cellX, cell.cellZ)!;
    const cx = Math.floor(center.x / 16);
    const cz = Math.floor(center.z / 16);
    // 岛半径最大 ~42 → 附近 3 格区块足够覆盖结构与地物
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const key = `${cx + dx},${cz + dz}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const blocks = generateChunkBlocks(cx + dx, cz + dz, SEED, Dimension.END);
        chorusPlant += countBlocks(blocks, Block.CHORUS_PLANT);
        chorusFlower += countBlocks(blocks, Block.CHORUS_FLOWER);
        purpur += countBlocks(blocks, Block.PURPUR_BLOCK) + countBlocks(blocks, Block.PURPUR_PILLAR);
        endRod += countBlocks(blocks, Block.END_ROD);
        chest += countBlocks(blocks, Block.CHEST);
        islandBlocks += countBlocks(blocks, Block.END_STONE);
      }
    }
  }

  console.log(`  外岛：末地石 ${islandBlocks} · 紫颂杆 ${chorusPlant} · 紫颂花 ${chorusFlower}`);
  console.log(`  末地城/船：紫珀 ${purpur} · 末地烛 ${endRod} · 箱子 ${chest}`);

  check('外岛由末地石构成', islandBlocks > 20000, `末地石 ${islandBlocks}`);
  check('外岛上长出了紫颂树（主干）', chorusPlant > 50, `紫颂杆 ${chorusPlant}`);
  check('紫颂树开花', chorusFlower > 10, `紫颂花 ${chorusFlower}`);
  check('主岛没有紫颂树（原版只长在外岛）', (() => {
    const blocks = generateChunkBlocks(0, 0, SEED, Dimension.END);
    return countBlocks(blocks, Block.CHORUS_PLANT) === 0;
  })());
  check('外岛上有末地城/末地船（紫珀块）', purpur > 200, `紫珀 ${purpur}`);
  check('末地城里有末地烛照明', endRod > 5, `末地烛 ${endRod}`);

  // 末地船：应当浮在岛面上方（船体在 top+34，桅杆更高）—— 遍历所有单元直到找到
  let ships = 0;
  const shipScanned = new Set<string>();
  for (const cell of cells) {
    const center = gen.outerIslandOfCell(cell.cellX, cell.cellZ)!;
    const surface = gen.islandAt(center.x, center.z);
    if (!surface) continue;
    const cx = Math.floor(center.x / 16);
    const cz = Math.floor(center.z / 16);
    let above = 0;
    let seen = 0;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dx = 0; dx <= 1; dx++) {
        const key = `${cx + dx},${cz + dz}`;
        if (shipScanned.has(key)) continue;
        shipScanned.add(key);
        seen++;
        const blocks = generateChunkBlocks(cx + dx, cz + dz, SEED, Dimension.END);
        // 岛面上方 20~60 格：那里只可能有末地船（岛体只在地面以下）
        for (let y = surface.top + 20; y <= surface.top + 60; y++) {
          for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
              if (blocks[Chunk.index(x, y, z)] !== Block.AIR) above++;
            }
          }
        }
      }
    }
    if (above > 50) ships++;
    void seen;
  }
  console.log(`  岛面上方有建筑（末地船）的岛：${ships} / ${cells.length}`);
  check('至少有一座末地船浮在外岛上空', ships > 0, `${ships} 座`);
}

// ---------------------------------------------------------------- 3. 群系

console.log('\n[末地群系]');
{
  const histogram = new Map<string, number>();
  for (let x = -1200; x <= 1200; x += 37) {
    for (let z = -1200; z <= 1200; z += 37) {
      const name = END_BIOME_NAMES[gen.biomeAt(x, z)]!;
      histogram.set(name, (histogram.get(name) ?? 0) + 1);
    }
  }
  console.log(`  群系分布：${[...histogram.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(' · ')}`);
  check('the_end（主岛）出现', (histogram.get('the_end') ?? 0) > 0);
  check('end_highlands 出现', (histogram.get('end_highlands') ?? 0) > 0);
  check('end_midlands 出现', (histogram.get('end_midlands') ?? 0) > 0);
  check('end_barrens 出现', (histogram.get('end_barrens') ?? 0) > 0);
  check('the_void 出现（主岛与外岛之间的空区）', (histogram.get('the_void') ?? 0) > 0);
}

// ---------------------------------------------------------------- 4. 确定性与跨区块

console.log('\n[确定性与跨区块]');
{
  const a = generateChunkBlocks(58, 3, SEED, Dimension.END);
  const b = generateChunkBlocks(58, 3, SEED, Dimension.END);
  let identical = true;
  for (let i = 0; i < CHUNK_VOLUME; i++) {
    if (a[i] !== b[i]) {
      identical = false;
      break;
    }
  }
  check('同一区块生成两遍逐方块一致', identical);

  // 跨区块：同一座城的紫珀块应当分布在多个区块里（说明每个区块都各自重放了同一份结构）
  const cell = cells.find((entry) => {
    const center = gen.outerIslandOfCell(entry.cellX, entry.cellZ)!;
    const blocks = generateChunkBlocks(Math.floor(center.x / 16), Math.floor(center.z / 16), SEED, Dimension.END);
    return countBlocks(blocks, Block.PURPUR_BLOCK) > 0;
  });
  if (!cell) {
    check('找到含末地城的单元', false);
  } else {
    const center = gen.outerIslandOfCell(cell.cellX, cell.cellZ)!;
    const cx = Math.floor(center.x / 16);
    const cz = Math.floor(center.z / 16);
    let chunksWithPurpur = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const blocks = generateChunkBlocks(cx + dx, cz + dz, SEED, Dimension.END);
        if (countBlocks(blocks, Block.PURPUR_BLOCK) > 0) chunksWithPurpur++;
      }
    }
    check('末地城跨区块（落在 ≥2 个区块）', chunksWithPurpur >= 2, `${chunksWithPurpur} 个区块含紫珀`);
  }
}

// ---------------------------------------------------------------- 5. 维度隔离

console.log('\n[维度之间互不干扰]');
{
  const end = generateChunkBlocks(0, 0, SEED, Dimension.END);
  const overworld = generateChunkBlocks(0, 0, SEED, Dimension.OVERWORLD);
  const nether = generateChunkBlocks(0, 0, SEED, Dimension.NETHER);

  check('末地有末地石', countBlocks(end, Block.END_STONE) > 1000);
  check('主世界没有末地石', countBlocks(overworld, Block.END_STONE) === 0);
  check('下界没有末地石', countBlocks(nether, Block.END_STONE) === 0);
  check('末地没有草方块与下界岩', countBlocks(end, Block.GRASS_BLOCK) === 0 && countBlocks(end, Block.NETHERRACK) === 0);
  check('末地全部方块类型可读', end.length === CHUNK_VOLUME);
  check('Dimension 有三个维度', Object.keys(Dimension).length === 3, Object.keys(Dimension).join(','));
}

// ---------------------------------------------------------------- 6. 末地城/末地船的战利品箱（K8 尾巴）

console.log('\n[末地城的战利品箱都挂着表]');
{
  let chests = 0;
  const untagged: string[] = [];
  for (const entry of cells) {
    const center = gen.outerIslandOfCell(entry.cellX, entry.cellZ);
    if (!center) continue;
    const cx = Math.floor(center.x / 16);
    const cz = Math.floor(center.z / 16);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const blocks = generateChunkBlocks(cx + dx, cz + dz, SEED, Dimension.END);
        const states = takeGeneratedStates();
        for (let y = -64; y < 320; y++) {
          for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
              if (blocks[Chunk.index(x, y, z)] !== Block.CHEST) continue;
              chests++;
              const state = states ? (states[Chunk.index(x, y, z)] ?? 0) : 0;
              if (chestLootIndex(state) <= 0) untagged.push(`${(cx + dx) * 16 + x},${y},${(cz + dz) * 16 + z}`);
            }
          }
        }
      }
    }
    if (chests > 0) break; // 找到一座有箱子的城就够了
  }
  check(`末地城/末地船里有战利品箱（${chests} 只）`, chests > 0);
  check('每一只都写了战利品表', untagged.length === 0, untagged.slice(0, 3).join(' '));
}


console.log('\n[末地城的生物（批次 458）]');
{
  // 先按**外岛单元**找岛（cell 256 格），再算岛心所在区块去取锚点——
  // 直接遍历区块会漏掉"城在更远处"的情形（±40 区块只覆盖 ±2.5 个 cell）
  let found: { cx: number; cz: number; spawns: { kind: string; x: number; y: number; z: number }[] } | null = null;
  for (let cellZ = -10; cellZ <= 10 && !found; cellZ++) {
    for (let cellX = -10; cellX <= 10 && !found; cellX++) {
      const island = gen.outerIslandOfCell(cellX, cellZ);
      if (!island || island.radius < 24) continue;
      const cx = Math.floor(Math.round(island.x) / 16);
      const cz = Math.floor(Math.round(island.z) / 16);
      const spawns = [];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          spawns.push(...endCityCreatureSpawnsAt(cx + dx, cz + dz, SEED, gen));
        }
      }
      if (spawns.length > 0) found = { cx, cz, spawns };
    }
  }
  check('找得到一座有潜影贝的末地城', found !== null, `种子 ${SEED}`);
  if (found) {
    const seen = new Map<string, string>();
    for (const spawn of found.spawns) seen.set(`${spawn.x},${spawn.y},${spawn.z}`, spawn.kind);
    equal('合并后是两只（不重复）', seen.size, 2);
    equal('都是潜影贝', [...seen.values()].filter((k) => k === 'shulker').length, 2);
  }
  // 负对照：绝大多数区块没有城，锚点数应该是 0（不是"随便哪个区块都有"）
  let emptyChunks = 0;
  for (let cz = 0; cz < 8; cz++) {
    for (let cx = 0; cx < 8; cx++) {
      if (endCityCreatureSpawnsAt(cx, cz, SEED, gen).length === 0) emptyChunks++;
    }
  }
  check('大多数区块没有城（锚点不是到处都有）', emptyChunks >= 60, `${emptyChunks} / 64`);
}


console.log('\n[末地城生物锚点在真实生成里有空间（批次 458）]');
{
  let target: { cx: number; cz: number; spawns: { kind: string; x: number; y: number; z: number }[] } | null = null;
  for (let cellZ = -10; cellZ <= 10 && !target; cellZ++) {
    for (let cellX = -10; cellX <= 10 && !target; cellX++) {
      const island = gen.outerIslandOfCell(cellX, cellZ);
      if (!island || island.radius < 24) continue;
      const cx = Math.floor(Math.round(island.x) / 16);
      const cz = Math.floor(Math.round(island.z) / 16);
      const spawns = [];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) spawns.push(...endCityCreatureSpawnsAt(cx + dx, cz + dz, SEED, gen));
      }
      if (spawns.length > 0) target = { cx, cz, spawns };
    }
  }
  if (!target) {
    check('找得到末地城（否则这条断言没意义）', false);
  } else {
    const blocks = new Map<string, number>();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = target.cx + dx;
        const cz = target.cz + dz;
        const ids = generateChunkBlocks(cx, cz, SEED, Dimension.END);
        takeGeneratedStates();
        for (let y = 0; y < 160; y++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              blocks.set(`${cx * 16 + x},${y},${cz * 16 + z}`, ids[Chunk.index(x, y, z)]!);
            }
          }
        }
      }
    }
    let placed = 0;
    for (const spawn of target.spawns) {
      const spot = nearbyStandingSpot(
        (x, y, z) => blocks.get(`${x},${y},${z}`) === Block.AIR,
        spawn.x,
        spawn.y,
        spawn.z,
        3,
      );
      if (spot) placed++;
    }
    equal('每个锚点 3 格内都有空气（不会把潜影贝卡进紫珀）', placed, target.spawns.length);
  }
}

console.log(`\n末地测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
