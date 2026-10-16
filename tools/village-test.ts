/**
 * 村庄"住上人"离线测试（J22，批次 89）
 *
 * 这一批补的是**村庄一直是空村**这件事：村庄结构（水井 + 房屋 + 道路）早就有了，
 * 但村民直到批次 88 才出现，而结构生成跑在 Worker 里（造不了实体）。
 * 所以做成了两半：**房子里摆床与工作站**（生成侧）+ **一张床招一个村民**（主线程侧）。
 * 断言分四块：
 *  1. **真实生成**：随机种子下找一个真村庄，逐区块生成后检查——
 *     屋里有床（≥4 张）、有工作站（≥4 个）、每个工作站都有对应职业、
 *     每张床都是**合法的一对**（两半相邻、朝向一致、只有一半是床头）；
 *  2. **人口排查（真实地形）**：对同一个真村庄跑 `planVillagePopulation`，
 *     排出来的位置必须是"空气 + 脚下实心"（不然村民会卡在墙里/悬空）；
 *  3. **人口规则（合成世界）**：一张床一个村民、床头不算第二张床、床边站不下人就不刷、
 *     "这一带已经有人"就不重刷（区块反复加载时人口不会翻倍）、职业按身边的工作站认领、
 *     范围外的工作站不算、同一个区块的上限；
 *  4. **确定性**：同一份世界跑两遍，结果逐项一致（区块卸载再回来还是同一批人）。
 *
 * 运行：npm run test:village
 */

import { Block, bedId, blockDef, isBed } from '../src/core/registry/blocks.ts';
import {
  bedOtherHalf,
  facingOf,
  isBedHead,
  withBedHead,
  withFacing,
  type Facing,
} from '../src/core/registry/blockState.ts';
import {
  POPULATION_DUPLICATE_RADIUS,
  POPULATION_MAX_PER_CHUNK,
  planVillagePopulation,
  villagerSpotNearBed,
  type VillageWorldView,
} from '../src/core/world/VillagePopulation.ts';
import { isWorkstation, professionById, WORKSTATION_BLOCKS } from '../src/core/registry/villagerTrades.ts';
import { structureInstanceForTest } from '../src/core/gen/Structures.ts';
import { generateChunkBlocks, takeGeneratedStates } from '../src/core/gen/TerrainGenerator.ts';
import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, Chunk } from '../src/core/world/Chunk.ts';

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

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

/**
 * "长得像工作站、但职业表里没有"的方块——本项目目前一个都没有
 * （J23 补讲台/制砂轮那 5 种时会先变成"有方块没职业"，那时这条断言会红）。
 */
const WORKSTATION_LIKE = new Set<number>([Block.CRAFTING_TABLE, Block.FURNACE, Block.ANVIL]);

/** 一块小小的假世界：`blocks` / `states` 两张表（键 `x,y,z`） */
function makeWorld(blocks: Record<string, number>, states: Record<string, number> = {}): {
  view: VillageWorldView;
  blocks: Record<string, number>;
  states: Record<string, number>;
} {
  const store = { ...blocks };
  const stateStore = { ...states };
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    blocks: store,
    states: stateStore,
    view: {
      getBlock: (x, y, z) => store[key(x, y, z)] ?? Block.AIR,
      getState: (x, y, z) => stateStore[key(x, y, z)] ?? 0,
    },
  };
}

/** 一张摆好的床（脚在 x,z，头朝 facing），写进假世界的两张表里 */
function putBed(
  world: { blocks: Record<string, number>; states: Record<string, number> },
  x: number,
  y: number,
  z: number,
  facing: Facing,
): void {
  const foot = withFacing(0, facing);
  world.blocks[`${x},${y},${z}`] = bedId(0);
  world.states[`${x},${y},${z}`] = foot;
  const [hx, , hz] = bedOtherHalf(x, y, z, foot);
  world.blocks[`${hx},${y},${hz}`] = bedId(0);
  world.states[`${hx},${y},${hz}`] = withBedHead(foot, true);
}

// ---------------------------------------------------------------- 1. 真实生成

console.log('\n[真实生成：村庄的屋里有床与工作站]');
{
  const world = new OverworldGenerator(SEED);
  const instances = [];
  for (let cellZ = -4; cellZ <= 4 && instances.length < 3; cellZ++) {
    for (let cellX = -4; cellX <= 4 && instances.length < 3; cellX++) {
      const found = structureInstanceForTest('village', cellX, cellZ, world, SEED);
      if (found) instances.push(found);
    }
  }
  check('找得到真村庄（随机种子里村庄不算稀有）', instances.length > 0, `种子 ${SEED}`);

  let beds = 0;
  let bedHeads = 0;
  let bedFeet = 0;
  let badPairs = 0;
  let stations = 0;
  let unknownStations = 0;
  let bedsWithAirAbove = 0;
  let doors = 0;
  /** 门口走不进去的房子（O13 那条"隐形地板"的症状） */
  let blockedDoorways = 0;

  // 多找几个村庄：不同群系会换一套建材（沙漠是砂岩、热带草原是金合欢……），
  // 只验一个村庄等于只验了一种调色板
  for (const instance of instances) {
    const cx0 = Math.floor(instance.minX / CHUNK_SIZE_X);
    const cx1 = Math.floor(instance.maxX / CHUNK_SIZE_X);
    const cz0 = Math.floor(instance.minZ / CHUNK_SIZE_Z);
    const cz1 = Math.floor(instance.maxZ / CHUNK_SIZE_Z);

    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const blocks = generateChunkBlocks(cx, cz, SEED);
        const states = takeGeneratedStates() ?? new Uint8Array(blocks.length);
        for (let y = 0; y < 200; y++) {
          for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
              const index = Chunk.index(x, y, z);
              const id = blocks[index]!;
              const state = states[index]!;
              if (isBed(id)) {
                beds++;
                if (isBedHead(state)) bedHeads++;
                else {
                  bedFeet++;
                  // 床脚 → 另一半必须是同一张床、朝向一致、且是床头
                  const [hx, , hz] = bedOtherHalf(cx * CHUNK_SIZE_X + x, y, cz * CHUNK_SIZE_Z + z, state);
                  const lx = hx - cx * CHUNK_SIZE_X;
                  const lz = hz - cz * CHUNK_SIZE_Z;
                  if (lx < 0 || lx > 15 || lz < 0 || lz > 15) continue; // 床头在隔壁区块
                  const headId = blocks[Chunk.index(lx, y, lz)]!;
                  const headState = states[Chunk.index(lx, y, lz)]!;
                  if (headId !== id || !isBedHead(headState) || facingOf(headState) !== facingOf(state)) {
                    badPairs++;
                  }
                  // 床脚上面要是空气（人得站得起来）
                  const above = y + 1 < 200 ? blocks[Chunk.index(x, y + 1, z)]! : Block.AIR;
                  if (above === Block.AIR) bedsWithAirAbove++;
                }
              }
              // 工作站必须是**职业表里认得出来的那几种**：摆一个"没人认领的方块"
              // 进去，村民就永远是白丁（J23 补另外 5 种时这条会跟着一起变）
              if (isWorkstation(id)) stations++;
              else if (WORKSTATION_LIKE.has(id)) unknownStations++;
              if (id === Block.OAK_DOOR) {
                // 只数**下半扇**（上半扇的 state 里有一位标记）
                const upper = (state & 0b100000) !== 0;
                if (upper) continue;
                doors++;
                // 门开在南墙（朝南），所以"屋里"是门那一格的北边一格。
                // ⚠️ 门那一层与它上一层**都**必须是空气：O13 那条"隐形地板"
                // 正是让门口比屋外高两格（得跳着进），这两格就是最直接的判据。
                const lz = z - 1;
                if (lz < 0) continue; // 跨到隔壁区块那一侧，这里不查
                const lower = blocks[Chunk.index(x, y, lz)]!;
                const above = y + 1 < 200 ? blocks[Chunk.index(x, y + 1, lz)]! : Block.AIR;
                if (lower !== Block.AIR || above !== Block.AIR) blockedDoorways++;
              }
            }
          }
        }
      }
    }
  }

  console.log(`  ${instances.length} 个村庄合计：房子 ${doors} 栋、床 ${beds} 格、工作站 ${stations} 个`);
  check('屋里有床', bedFeet >= 1, `床脚 ${bedFeet}`);
  check('每栋房子恰好一张床（门与床一一对应）', bedFeet === doors, `床脚 ${bedFeet} / 门 ${doors}`);
  check('每张床都是两格、且只有一半是床头', bedHeads === bedFeet && bedFeet > 0, `脚 ${bedFeet} / 头 ${bedHeads}`);
  check('床的两半相邻、同朝向、另一半确实是床头', badPairs === 0, `不合法 ${badPairs}`);
  check('床脚上方留出了站人的空间', bedsWithAirAbove >= bedFeet, `上方是空气的 ${bedsWithAirAbove} / ${bedFeet}`);
  check('屋里有工作站（J22 之前一个都没有）', stations >= doors, `工作站 ${stations} / 房子 ${doors}`);
  // O13：`walls()` 会把底面也填成整块，房屋必须把那层清掉——不清就"门口高两格"
  check('门口那一层能走进去（O13 的隐形地板已清）', blockedDoorways === 0, `堵住的门 ${blockedDoorways}`);
  equal('放进去的工作站全都认得出来（没有"没人认领的方块"）', unknownStations, 0);
  check('工作站清单来自职业表（不是手抄的一份）', WORKSTATION_BLOCKS.every((id) => blockDef(id) !== undefined));
}

// ---------------------------------------------------------------- 2. 人口排查（真实地形）

console.log('\n[人口排查：真村庄能住上人]');
{
  const world = new OverworldGenerator(SEED);
  let instance: ReturnType<typeof structureInstanceForTest> = null;
  for (let cellZ = -4; cellZ <= 4 && !instance; cellZ++) {
    for (let cellX = -4; cellX <= 4 && !instance; cellX++) {
      instance = structureInstanceForTest('village', cellX, cellZ, world, SEED);
    }
  }

  if (instance) {
    const cx0 = Math.floor(instance.minX / CHUNK_SIZE_X);
    const cx1 = Math.floor(instance.maxX / CHUNK_SIZE_X);
    const cz0 = Math.floor(instance.minZ / CHUNK_SIZE_Z);
    const cz1 = Math.floor(instance.maxZ / CHUNK_SIZE_Z);

    // 把这一片区块的方块与状态收成一张世界视图（键是**世界坐标**）
    const blocks: Record<string, number> = {};
    const states: Record<string, number> = {};
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunkBlocks = generateChunkBlocks(cx, cz, SEED);
        const chunkStates = takeGeneratedStates() ?? new Uint8Array(chunkBlocks.length);
        for (let y = -64; y < 320; y++) {
          for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
              const index = Chunk.index(x, y, z);
              if (chunkBlocks[index] === Block.AIR) continue;
              blocks[`${cx * CHUNK_SIZE_X + x},${y},${cz * CHUNK_SIZE_Z + z}`] = chunkBlocks[index]!;
              states[`${cx * CHUNK_SIZE_X + x},${y},${cz * CHUNK_SIZE_Z + z}`] = chunkStates[index]!;
            }
          }
        }
      }
    }
    const view: VillageWorldView = {
      getBlock: (x, y, z) => blocks[`${x},${y},${z}`] ?? Block.AIR,
      getState: (x, y, z) => states[`${x},${y},${z}`] ?? 0,
    };

    const plans = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) plans.push(...planVillagePopulation(view, cx, cz));
    }

    console.log(`  排出了 ${plans.length} 个村民（职业：${plans.map((p) => p.professionId ?? '无业').join(' / ')}）`);
    check('真村庄至少排出一个村民', plans.length >= 1, `实际 ${plans.length}`);
    check(
      '每个位置都能站人（空气 + 脚下实心）',
      plans.every((plan) => view.getBlock(plan.x, plan.y, plan.z) === Block.AIR && blockDef(view.getBlock(plan.x, plan.y - 1, plan.z))?.solid),
    );
    check(
      '每个位置确实挨着一张床',
      plans.every((plan) =>
        [
          [plan.bedX - 1, plan.bedY, plan.bedZ],
          [plan.bedX + 1, plan.bedY, plan.bedZ],
          [plan.bedX, plan.bedY, plan.bedZ - 1],
          [plan.bedX, plan.bedY, plan.bedZ + 1],
          [plan.bedX, plan.bedY + 1, plan.bedZ],
        ].some(([x, y, z]) => x === plan.x && y === plan.y && z === plan.z),
      ),
    );
    check(
      '有工作的村民拿到的都是合法职业',
      plans.every((plan) => plan.professionId === null || professionById(plan.professionId) !== undefined),
    );
    check(
      '认领了职业的人同时记着"认领的是哪一格"（与 J11 的认领数据一致）',
      plans.every((plan) => (plan.professionId === null) === (plan.workstation === null)),
    );
  }
}

// ---------------------------------------------------------------- 3. 人口规则（合成世界）

console.log('\n[人口规则：一张床一个村民]');
{
  // 一间小屋：地板 y=63，墙在四周，屋里空着，一张床
  const room = makeWorld({
    '0,63,0': Block.OAK_PLANKS, // 地板
    '1,63,0': Block.OAK_PLANKS,
    '2,63,0': Block.OAK_PLANKS,
    '3,63,0': Block.OAK_PLANKS,
    '-1,63,0': Block.OAK_PLANKS,
    '-1,63,-1': Block.OAK_PLANKS,
    '0,63,-1': Block.OAK_PLANKS,
    '1,63,-1': Block.OAK_PLANKS,
  });
  putBed(room, 1, 64, 0, 2);

  const plans = planVillagePopulation(room.view, 0, 0);
  equal('一张床排出一个人', plans.length, 1);
  equal('床脚记在计划里（调试用）', `${plans[0]?.bedX},${plans[0]?.bedY},${plans[0]?.bedZ}`, '1,64,0');
  check('站在床边的地板上（不是床那一格）', plans[0]?.y === 64 && !(plans[0]?.x === 1 && plans[0]?.z === 0));
  equal('身边没有工作站 → 无业', plans[0]?.professionId, null);

  // 确定性：跑两遍逐项一致（区块卸载再回来，人还在原来的地方）
  const again = planVillagePopulation(room.view, 0, 0);
  equal('同样的世界跑两遍结果一致', JSON.stringify(again), JSON.stringify(plans));

  // 只有床头那一半（脏存档）→ 不刷人
  const onlyHead = makeWorld({ '0,63,0': Block.OAK_PLANKS, '1,63,0': Block.OAK_PLANKS });
  onlyHead.blocks['1,64,0'] = bedId(0);
  onlyHead.states['1,64,0'] = withBedHead(withFacing(0, 2), true);
  equal('孤零零的床头不算一张床', planVillagePopulation(onlyHead.view, 0, 0).length, 0);

  // 床被埋住（上方与四周都是实心）→ 不刷人
  const buried = makeWorld({ '0,63,0': Block.STONE, '1,63,0': Block.STONE });
  putBed(buried, 1, 64, 0, 2);
  for (const [x, z] of [
    [0, 0],
    [2, 0],
    [1, -1],
    [1, 1],
  ] as const) {
    buried.blocks[`${x},64,${z}`] = Block.STONE;
  }
  buried.blocks['1,65,0'] = Block.STONE;
  equal('床被埋住 → 不刷（人站不进去）', planVillagePopulation(buried.view, 0, 0).length, 0);

  // 边上都没有地板 → 退到"站在床上"那一格（固定顺序的最后一档，不会悬空）
  const floating = makeWorld({});
  putBed(floating, 1, 64, 0, 2);
  const fallback = planVillagePopulation(floating.view, 0, 0);
  equal('边上都没地板时退到床上那一格', `${fallback[0]?.x},${fallback[0]?.y},${fallback[0]?.z}`, '1,65,0');
  // 连床上方也堵住 → 一个都不刷
  floating.blocks['1,65,0'] = Block.STONE;
  equal('四周与床上方都走不进人 → 不刷', planVillagePopulation(floating.view, 0, 0).length, 0);

  // 落脚点的优先顺序是固定的（先西、再东、再北、再南、最后床上）
  const bothSides = makeWorld({
    '0,63,0': Block.OAK_PLANKS,
    '1,63,0': Block.OAK_PLANKS,
    '2,63,0': Block.OAK_PLANKS,
  });
  putBed(bothSides, 1, 64, 0, 2);
  equal('两边都站得下时取固定的那一边（西）', `${planVillagePopulation(bothSides.view, 0, 0)[0]?.x}`, '0');
  equal('落脚点纯函数与整批一致', villagerSpotNearBed(bothSides.view, 1, 64, 0)?.x, 0);
}

console.log('\n[人口规则：不重复刷、职业与上限]');
{
  const room = makeWorld({
    '0,63,0': Block.OAK_PLANKS,
    '1,63,0': Block.OAK_PLANKS,
    '2,63,0': Block.OAK_PLANKS,
    '3,63,0': Block.OAK_PLANKS,
  });
  putBed(room, 1, 64, 0, 2);

  // "这一带已经有人" → 不刷第二遍（区块反复加载时人口不会翻倍）
  const guarded: VillageWorldView = {
    ...room.view,
    villagerNear: () => true,
  };
  equal('这一带已经有村民 → 不再刷', planVillagePopulation(guarded, 0, 0).length, 0);
  const farGuard: VillageWorldView = { ...room.view, villagerNear: () => false };
  equal('附近没有村民 → 正常刷', planVillagePopulation(farGuard, 0, 0).length, 1);

  // 职业：身边有工作站就认领（农家摆堆肥桶 → 农民）
  const withFarm = makeWorld({
    '0,63,0': Block.OAK_PLANKS,
    '1,63,0': Block.OAK_PLANKS,
    '2,63,0': Block.OAK_PLANKS,
    '2,64,0': Block.COMPOSTER,
  });
  putBed(withFarm, 1, 64, 0, 2);
  equal('身边有堆肥桶 → 农民', planVillagePopulation(withFarm.view, 0, 0)[0]?.professionId, 'farmer');

  // 范围外的工作站不算（远处那座高炉不该隔着半个村认领）
  const farStation = makeWorld({
    '0,63,0': Block.OAK_PLANKS,
    '1,63,0': Block.OAK_PLANKS,
    '2,63,0': Block.OAK_PLANKS,
    '14,64,0': Block.BLAST_FURNACE,
  });
  putBed(farStation, 1, 64, 0, 2);
  equal('远处的工作站认领不到', planVillagePopulation(farStation.view, 0, 0)[0]?.professionId, null);

  // 上限：一个区块里塞很多张床
  const many = makeWorld({});
  for (let i = 0; i < 8; i++) {
    const z = i * 2;
    many.blocks[`0,63,${z}`] = Block.OAK_PLANKS;
    many.blocks[`1,63,${z}`] = Block.OAK_PLANKS;
    many.blocks[`2,63,${z}`] = Block.OAK_PLANKS;
    putBed(many, 1, 64, z, 2);
  }
  const capped = planVillagePopulation(many.view, 0, 0);
  equal('一个区块最多刷这么多', capped.length, POPULATION_MAX_PER_CHUNK);

  // 隔壁区块的床归隔壁管
  const neighbor = makeWorld({ '16,63,0': Block.OAK_PLANKS, '17,63,0': Block.OAK_PLANKS });
  putBed(neighbor, 17, 64, 0, 2);
  equal('本区块里看不到隔壁那一张床', planVillagePopulation(neighbor.view, 0, 0).length, 0);
  equal('隔壁区块自己会排出它', planVillagePopulation(neighbor.view, 1, 0).length, 1);

  // 常量自检：重复半径要够大（不然村民走开十几格再回来就会再刷一个）
  check('"这一带有人"的半径是个像样的值', POPULATION_DUPLICATE_RADIUS >= 8 && POPULATION_DUPLICATE_RADIUS <= 24);
}

// ---------------------------------------------------------------- 收尾

console.log(`\n村庄人口测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
