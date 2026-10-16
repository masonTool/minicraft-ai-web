/**
 * 面级贴图（批次 64，O10 的第一步）离线测试
 *
 * 这一批补的是一条**能力**：让"某一面单独一张贴图"成为可能。
 * 在此之前网格化器只会按 `[顶, 底, 侧]` 取贴图，于是：
 *  - 熔炉没有正面（四个侧面还**一起**换点火贴图，"只亮正面"做不到）；
 *  - 投掷器/发射器的凸口只能靠**几何**表示（管子/挡板），凸口那一面看不出管子口；
 *  - 活塞/观察者干脆不表示朝向、木桶盖子只能朝上（后两件留给各自的小批次）。
 *
 * 断言分四块：
 *  1. **能力本身**：`faceTile` 的语义（按面的**外法线**比对朝向）、两个不变量
 *     （"声明正脸朝玩家"必须同时有办法看出朝向、"没有正脸"的方块照旧走三维贴图）；
 *  2. **真正网格化出来的结果**（不是只读注册表）：给每个面灌一个**唯一 UV 的图集桩**，
 *     直接断言"第几号面用了哪张贴图"——这才是"能力真的落地了"的证据；
 *  3. **贪心通道的排除**：有正脸的方块不能被合并（同一面两侧贴图不同就不能合）；
 *  4. **放置**：正脸朝放置者（熔炉家族），与投掷器/发射器的"凸口朝你"同一套。
 *
 * 运行：npm run test:face
 */

import { meshSection, type MeshContext, type TileUvSource } from '../src/core/mesh/ChunkMesher.ts';
import { Chunk } from '../src/core/world/Chunk.ts';
import { Block, BLOCKS, blockDef, blockTiles, blockHardness } from '../src/core/registry/blocks.ts';
import {
  facingOf,
  sixFacingOffset,
  withFacing,
  withLitState,
  withSixFacing,
} from '../src/core/registry/blockState.ts';
import { planPlacement, type PlacementInput } from '../src/core/interaction/Placement.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';

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

/** 贴图名 → 图集里的序号：把它当 UV 灌进去，"哪一面用了哪张"就变成可读的断言 */
const TILE_INDEX = new Map<string, number>(TILE_ORDER.map((name, index) => [name, index]));
const atlasStub: TileUvSource = { tileOrigin: (tile) => [TILE_INDEX.get(tile) ?? -1, 0] };

/** 网格化器 `FACES` 的顺序：-X / +X / -Y / +Y / -Z / +Z */
const FACE_NAMES = ['-X', '+X', '-Y', '+Y', '-Z(北)', '+Z(南)'] as const;
const FACE_OFFSETS: readonly (readonly [number, number, number])[] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

const X = 8;
const Y = 64;
const Z = 8;

/** 把一格方块网格化出来，返回"六个面各自用了哪张贴图"（下标见 FACE_NAMES） */
function meshFaces(id: number, state: number): { tiles: (string | null)[]; triangles: number } {
  const chunk = new Chunk(0, 0);
  chunk.set(X, Y, Z, id);
  const ctx: MeshContext = {
    getBlock: (wx, wy, wz) => {
      if (wx < 0 || wx >= 16 || wz < 0 || wz >= 16) return Block.AIR;
      return chunk.get(wx, wy, wz);
    },
    getBlockState: (wx, wy, wz) => (wx === X && wy === Y && wz === Z ? state : 0),
    getSkyLight: () => 15,
    getBlockLight: () => 0,
  };
  const result = meshSection(chunk, Chunk.sectionOf(Y), atlasStub, ctx);
  const geometry = result.solid!;
  const attribute = geometry.getAttribute('aTile');
  const byIndex = [...TILE_ORDER];
  const tiles: (string | null)[] = [];
  for (let face = 0; face < 6; face++) {
    const value = attribute.getX(face * 4);
    tiles.push(byIndex[value] ?? null);
  }
  return { tiles, triangles: geometry.index!.count / 3 };
}

/** 造一个放置输入（默认：对着石头顶面放、玩家朝北、不潜行） */
function placement(blockId: number, overrides: Partial<PlacementInput>): PlacementInput {
  return {
    blockId,
    normal: [0, 1, 0],
    hitX: 0.5,
    hitY: 1,
    hitZ: 0.5,
    yaw: 0,
    sneaking: false,
    blockAt: () => Block.AIR,
    hitBlock: Block.STONE,
    hitState: 0,
    ...overrides,
  };
}

const FURNACES = [Block.FURNACE, Block.SMOKER, Block.BLAST_FURNACE] as const;

// ---------------------------------------------------------------- 1. 能力本身

console.log('\n[能力：某一面单独一张贴图]');
{
  check('普通方块没有正脸（照旧按 [顶, 底, 侧] 走）', blockDef(Block.STONE).faceTile === undefined);
  check('草地/木头/玻璃也没有', [Block.GRASS_BLOCK, Block.OAK_PLANKS, Block.GLASS].every((id) => blockDef(id).faceTile === undefined));
  equal('它们的三张贴图照旧读得出来', blockTiles(Block.FURNACE, 0).length, 3);

  // 判据是"面的外法线 == 朝向的偏移量"：六个面里**恰好一个**是正脸
  for (const id of [...FURNACES, Block.DROPPER, Block.DISPENSER]) {
    const hits = FACE_OFFSETS.filter((dir) => blockDef(id).faceTile?.(withFacing(0, 2), dir) !== undefined);
    equal(`${blockDef(id).name}：六个面里恰好一个正脸`, hits.length, 1);
    check(
      `${blockDef(id).name}：正脸就是朝向那一面（不是背面）`,
      hits[0] !== undefined && hits[0].join(',') === sixFacingOffset(2).join(','),
    );
  }

  // 不变量：声明"正脸朝玩家"的方块必须同时有办法**看出**朝向
  const lying = [];
  for (let id = 1; id < BLOCKS.length; id++) {
    if (blockDef(id).facesPlayer && blockDef(id).faceTile === undefined) lying.push(blockDef(id).name);
  }
  check('"正脸朝玩家"的方块都有面级贴图（否则朝向看不见）', lying.length === 0, lying.join(', '));
  check('熔炉家族的三个都声明了"正脸朝玩家"', FURNACES.every((id) => blockDef(id).facesPlayer));
}

// ---------------------------------------------------------------- 2. 真正网格化出来

console.log('\n[网格化结果：每个面用的是哪张贴图]');
{
  // ---- 熔炉：朝北（facing 0）、没点着
  const cold = meshFaces(Block.FURNACE, withFacing(0, 0));
  const coldFront = cold.tiles[4]; // -Z 就是北
  equal('朝北的熔炉：北面是 furnace_front（黑洞）', coldFront, 'furnace_front');
  equal('其余四侧是 furnace_side', [cold.tiles[0], cold.tiles[1], cold.tiles[5]].join(','), 'furnace_side,furnace_side,furnace_side');
  equal('顶与底是 furnace_top', `${cold.tiles[2]},${cold.tiles[3]}`, 'furnace_top,furnace_top');
  equal('一共 6 个面都输出了（24 个顶点 / 12 个三角形）', cold.triangles, 12);

  // ---- 熔炉：点着 → **只有北面**换成火光
  const hot = meshFaces(Block.FURNACE, withLitState(withFacing(0, 0), true));
  equal('点着的熔炉：北面是 furnace_front_on', hot.tiles[4], 'furnace_front_on');
  equal(
    '其余面**没有**跟着变（原先四个侧面会一起亮）',
    hot.tiles.filter((tile) => tile === 'furnace_front_on').length,
    1,
  );

  // ---- 换个朝向：正脸跟着 `facing` 走（facing=1 是东 → +X 那一面）
  const east = meshFaces(Block.FURNACE, withFacing(0, 1));
  equal('朝东的熔炉：+X 面是正脸', east.tiles[1], 'furnace_front');
  equal('北面退回普通侧面', east.tiles[4], 'furnace_side');

  // ---- 烟熏炉与高炉同理
  equal('烟熏炉的正脸', meshFaces(Block.SMOKER, withFacing(0, 2)).tiles[5], 'smoker_front');
  equal('烟熏炉点着', meshFaces(Block.SMOKER, withLitState(withFacing(0, 2), true)).tiles[5], 'smoker_front_on');
  equal('高炉的正脸', meshFaces(Block.BLAST_FURNACE, withFacing(0, 0)).tiles[4], 'blast_furnace_front');
  equal('高炉点着', meshFaces(Block.BLAST_FURNACE, withLitState(withFacing(0, 0), true)).tiles[4], 'blast_furnace_front_on');

  // ---- 投掷器：凸口那一面用"管子口"，**包括朝上/朝下**（以前只有几何能看出来）
  const down = meshFaces(Block.DROPPER, withSixFacing(0, 'down'));
  equal('朝下的投掷器：底面是管子口', down.tiles[2], 'dropper_top');
  equal('朝下的投掷器：顶面是外壳', down.tiles[3], 'dropper_side');
  const up = meshFaces(Block.DROPPER, withSixFacing(0, 'up'));
  equal('朝上的投掷器：顶面是管子口', up.tiles[3], 'dropper_top');
  const north = meshFaces(Block.DROPPER, withFacing(0, 0));
  equal('朝北的投掷器：北面是管子口', north.tiles[4], 'dropper_top');
  equal('朝北的投掷器：其余五面都是外壳', north.tiles.filter((tile) => tile === 'dropper_side').length, 5);

  // ---- 发射器：挡板那一面
  equal('朝下的发射器：底面是挡板', meshFaces(Block.DISPENSER, withSixFacing(0, 'down')).tiles[2], 'dispenser_top');
  equal('朝西的发射器：-X 面是挡板', meshFaces(Block.DISPENSER, withFacing(0, 3)).tiles[0], 'dispenser_top');

  // ---- 对照：普通方块六个面都用同一张（没被这项能力影响到）
  const stone = meshFaces(Block.STONE, 0);
  equal('石头的六面都是 stone', new Set(stone.tiles).size, 1);
  equal('石头还是走贪心通道（12 个三角形）', stone.triangles, 12);
}

// ---------------------------------------------------------------- 3. 贪心通道的排除

console.log('\n[贪心通道：有正脸的方块不参与合并]');
{
  /** 2×2 摆同一格方块（同一层，4 个），返回三角形数 */
  function block2x2(id: number, state: number): number {
    const chunk = new Chunk(0, 0);
    for (let z = 4; z < 6; z++) {
      for (let x = 4; x < 6; x++) chunk.set(x, Y, z, id);
    }
    const ctx: MeshContext = {
      getBlock: (wx, wy, wz) => {
        if (wx < 0 || wx >= 16 || wz < 0 || wz >= 16) return Block.AIR;
        return chunk.get(wx, wy, wz);
      },
      getBlockState: () => state,
      getSkyLight: () => 15,
      getBlockLight: () => 0,
    };
    return meshSection(chunk, Chunk.sectionOf(Y), atlasStub, ctx).solid!.index!.count / 3;
  }

  equal('2×2 石头被合并成 6 个大面（12 个三角形）', block2x2(Block.STONE, 0), 12);
  // 熔炉不进贪心通道：4 个方块各输出自己的面、只剔掉内部相邻的那些
  //  → 外层 4+4（四条侧边）+ 4（顶）+ 4（底）= 16 个四边形 = 32 个三角形（石头的 2.7 倍）
  equal('2×2 熔炉**没有**被合并（16 个四边形 / 32 个三角形）', block2x2(Block.FURNACE, 0), 32);
  check(
    '两者的差别就是"有没有被合并"（32 > 12，且石头那边是 6 个整面）',
    block2x2(Block.FURNACE, 0) > block2x2(Block.STONE, 0),
  );
}

// ---------------------------------------------------------------- 4. 放置

console.log('\n[放置：正脸朝放置者]');
{
  // yaw=0 → 玩家看向北、人站在南边 → 正脸朝南（facing 2 = +Z）
  equal('看向北 → 正脸朝南（朝着你）', facingOf(planPlacement(placement(Block.FURNACE, {}))!.state), 2);
  equal('看向东 → 正脸朝西', facingOf(planPlacement(placement(Block.FURNACE, { yaw: -Math.PI / 2 }))!.state), 3);
  equal('看向南 → 正脸朝北', facingOf(planPlacement(placement(Block.FURNACE, { yaw: Math.PI }))!.state), 0);
  equal('看向西 → 正脸朝东', facingOf(planPlacement(placement(Block.FURNACE, { yaw: Math.PI / 2 }))!.state), 1);
  check('烟熏炉与高炉同一套', FURNACES.every((id) => facingOf(planPlacement(placement(id, {}))!.state) === 2));
  check(
    '普通方块不受影响（石头没有朝向，状态仍是 0）',
    planPlacement(placement(Block.STONE, {}))!.state === 0,
  );
  check(
    '正脸朝玩家**与潜行无关**（它不像漏斗那样用潜行指定朝向）',
    facingOf(planPlacement(placement(Block.FURNACE, { sneaking: true }))!.state) === 2,
  );

  // 朝向必须真的落在 0~3（别写进别的位）
  const state = planPlacement(placement(Block.FURNACE, { yaw: Math.PI }))!.state;
  equal('写进去的只有朝向那两位', state, withFacing(0, 0));
  check('且不含点燃位', (state & 0b1000) === 0);
}

// ---------------------------------------------------------------- 5. 贴图登记

console.log('\n[贴图：新加的三张未点火炉口在图集里]');
{
  for (const tile of ['furnace_front', 'smoker_front', 'blast_furnace_front']) {
    check(`${tile} 在图集里`, TILE_ORDER.includes(tile as never));
  }
  for (const id of [...FURNACES, Block.DROPPER, Block.DISPENSER]) {
    const used = FACE_OFFSETS.map((dir) => blockDef(id).faceTile?.(0, dir)).filter((tile) => tile !== undefined);
    check(
      `${blockDef(id).name} 用到的贴图都在图集里（${used.join(', ')}）`,
      used.every((tile) => TILE_ORDER.includes(tile as never)),
    );
  }
  equal('熔炉的硬度没被这一批改到（对照）', blockHardness(Block.FURNACE), 3.5);
}

console.log(`\n面级贴图测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
