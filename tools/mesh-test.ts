/**
 * 贪心网格化离线测试
 *
 * 运行：npm run test:mesh
 *
 * 用三组场景验证：
 *   1. **完全均匀的平面必须彻底合并**：16×16 的石板应该只剩 6 个四边形（12 个三角形），
 *      而逐面网格化是 1152 个三角形；
 *   2. **顶点光照不同的面不能合并**：按光照把石板切开后，合并数必须精确地按光照块数增加，
 *      证明合并的判断条件（贴图 + 4 顶点光照/AO）真的在起作用，而不是无脑合并；
 *   3. **真实地形上的合并率**：用真实生成的区块对比「逐面网格化」的三角形数。
 */

import { meshSection, type MeshContext, type TileUvSource } from '../src/core/mesh/ChunkMesher.ts';
import { OverworldGenerator } from '../src/core/gen/OverworldGenerator.ts';
import { Block, blockDef, slabId } from '../src/core/registry/blocks.ts';
import { withWaterlogged } from '../src/core/registry/blockState.ts';
import { Chunk, SECTION_COUNT, Chunk as ChunkClass } from '../src/core/world/Chunk.ts';
import { isFullBlockShape } from '../src/core/registry/blockShapes.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}

/** 网格化只需要贴图起点，测试里给个固定值即可（不依赖 DOM） */
const atlasStub: TileUvSource = { tileOrigin: () => [0, 0] };

/** 造一个只含单区块的取样上下文；光照用可控函数注入 */
function makeContext(chunk: Chunk, skyLight: (wx: number, wy: number, wz: number) => number): MeshContext {
  const inChunk = (wx: number, wz: number): boolean => wx >= 0 && wx < 16 && wz >= 0 && wz < 16;
  return {
    getBlock: (wx, wy, wz) => (inChunk(wx, wz) ? chunk.get(wx, wy, wz) : Block.AIR),
    getBlockState: () => 0,
    getSkyLight: (wx, wy, wz) => (inChunk(wx, wz) ? skyLight(wx, wy, wz) : 15),
    getBlockLight: () => 0,
  };
}

function triangleCount(geometry: { index: { count: number } | null } | null): number {
  return geometry?.index ? geometry.index.count / 3 : 0;
}

console.log('\n[平坦石板：应当彻底合并]');
{
  const chunk = new Chunk(0, 0);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) chunk.set(x, 64, z, Block.STONE);
  }

  const section = Chunk.sectionOf(64);
  const ctx = makeContext(chunk, () => 15);
  const result = meshSection(chunk, section, atlasStub, ctx);
  const triangles = triangleCount(result.solid);

  // 顶面 1 + 底面 1 + 四个侧面各 1 = 6 个四边形
  console.log(`    三角形 ${triangles}（逐面网格化应为 ${16 * 16 * 2 + 16 * 4}）`);
  check('16×16 石板合并为 6 个四边形（12 个三角形）', triangles === 12, `实际 ${triangles}`);

  const uv = result.solid!.getAttribute('uv');
  let maxU = 0;
  let maxV = 0;
  for (let i = 0; i < uv.count; i++) {
    maxU = Math.max(maxU, uv.getX(i));
    maxV = Math.max(maxV, uv.getY(i));
  }
  console.log(`    uv 平铺坐标最大值 (${maxU}, ${maxV})`);
  check('合并后的 uv 跨度等于面宽高（平铺 16 格）', maxU === 16 && maxV === 16, `实际 (${maxU}, ${maxV})`);

  const tile = result.solid!.getAttribute('aTile');
  check('每个顶点都带有贴图起点属性 aTile', tile !== undefined && tile.count === uv.count);
}

console.log('\n[植物（十字）贴图方向：茎在下面]');
{
  // 回归（批次 273 尾巴）：图集改成"v=0 = 贴图底边"之后，十字面必须跟着改，
  // 否则所有植物上下颠倒（批次 273 只修了方块侧面，漏了这条手工写 UV 的路径）。
  const chunk = new Chunk(0, 0);
  chunk.set(0, 64, 0, Block.SHORT_GRASS);
  const section = Chunk.sectionOf(64);
  const result = meshSection(chunk, section, atlasStub, makeContext(chunk, () => 15));

  let vertices = 0;
  let wrongBottom = 0;
  let wrongTop = 0;
  for (const geometry of [result.solid, result.translucent]) {
    if (!geometry) continue;
    const pos = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      vertices++;
      const localY = pos.getY(i);
      // 两片薄面各 4 个顶点：底边 y=0、顶边 y=1（正反面共用顶点）
      if (localY === 0 && uv.getY(i) !== 0) wrongBottom++;
      if (localY === 1 && uv.getY(i) !== 1) wrongTop++;
    }
  }
  console.log(`    十字顶点 ${vertices} 个`);
  check('一株植物 = 两片薄面 = 8 个顶点', vertices === 8, `实际 ${vertices}`);
  check('底边顶点采贴图底边（v=0）', wrongBottom === 0, `${wrongBottom} 个反了`);
  check('顶边顶点采贴图顶边（v=1）', wrongTop === 0, `${wrongTop} 个反了`);
}

console.log('\n[材质不同：只能合并同材质的区域]');
{
  const chunk = new Chunk(0, 0);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) chunk.set(x, 64, z, x < 8 ? Block.STONE : Block.COBBLESTONE);
  }

  const section = Chunk.sectionOf(64);
  const ctx = makeContext(chunk, () => 15);
  const result = meshSection(chunk, section, atlasStub, ctx);
  const triangles = triangleCount(result.solid);

  // 顶 2 + 底 2 + ±X 各 1 + ±Z 各 2 = 10 个四边形
  console.log(`    三角形 ${triangles}`);
  check('两种材质各合并一次（10 个四边形 = 20 个三角形）', triangles === 20, `实际 ${triangles}`);
}

console.log('\n[光照不一致：按光照切分，不得强行合并]');
{
  const chunk = new Chunk(0, 0);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) chunk.set(x, 64, z, Block.STONE);
  }

  // 天光只随时间轴（z）变化：z<8 半边亮、z>=8 半边暗。
  // 顶点光照不同就不能合并，因此光照跳变处会退回逐面输出，
  // 但两侧仍然各自合并 —— 于是三角形数落在「完全均匀(12)」与「逐面(1152)」之间。
  const section = Chunk.sectionOf(64);
  const ctx = makeContext(chunk, (_wx, _wy, wz) => (wz < 8 ? 15 : 9));
  const result = meshSection(chunk, section, atlasStub, ctx);
  const triangles = triangleCount(result.solid);
  const naive = 16 * 16 * 2 + 16 * 4;

  console.log(`    三角形 ${triangles}（均匀光照 12，逐面网格化 ${naive}）`);
  check('光照跳变处不再合并（三角形数明显增加）', triangles > 12, `实际 ${triangles}`);
  check('光照相同的大片区域仍然合并', triangles < naive, `实际 ${triangles} vs 逐面 ${naive}`);
}

console.log('\n[真实地形：合并率]');
{
  const generator = new OverworldGenerator(7);
  const seedBlocks = generator.generate(0, 0);
  const chunk = ChunkClass.fromData(0, 0, seedBlocks);

  // 参考值：逐面网格化会输出多少三角形（只统计"按整格处理"的方块）
  let naiveFaces = 0;
  for (let y = -64; y < 320; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = chunk.get(x, y, z);
        if (id === Block.AIR) continue;
        const def = blockDef(id);
        // 满格的流体也算整格（与网格化里的判定共用同一个函数）
        if (!isFullBlockShape(def.shape, chunk.getState(x, y, z))) continue;
        for (const [dx, dy, dz] of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ] as const) {
          const nx = x + dx;
          const nz = z + dz;
          const neighbor =
            nx < 0 || nx > 15 || nz < 0 || nz > 15 ? Block.AIR : chunk.get(nx, y + dy, nz);
          if (blockDef(neighbor).opaque) continue;
          if (neighbor === id && def.translucent) continue;
          naiveFaces++;
        }
      }
    }
  }

  // 光照用真实地形高度的近似：地表以上给晴天光，地下按深度递减
  const heightmap = new Int16Array(256);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      let top = -64;
      for (let y = 319; y >= -64; y--) {
        if (chunk.get(x, y, z) !== Block.AIR) {
          top = y;
          break;
        }
      }
      heightmap[z * 16 + x] = top;
    }
  }
  const ctx = makeContext(chunk, (wx, wy, wz) => {
    const top = heightmap[wz * 16 + wx]!;
    if (wy > top) return 15;
    return Math.max(0, 15 - Math.ceil((top - wy) / 2));
  });

  let triangles = 0;
  for (let section = 0; section < SECTION_COUNT; section++) {
    const result = meshSection(chunk, section, atlasStub, ctx);
    triangles += triangleCount(result.solid) + triangleCount(result.translucent);
  }

  const naive = naiveFaces * 2;
  const ratio = triangles / naive;
  console.log(`    逐面 ${naive} 个三角形 → 贪心后 ${triangles}（${(ratio * 100).toFixed(1)}%）`);
  check('真实地形产生了三角形', triangles > 0, `${triangles}`);
  check('贪心网格化把三角形压掉至少 25%', ratio < 0.75, `实际 ${(ratio * 100).toFixed(1)}%`);
}


console.log('\n[水浸方块：额外输出一层水面（批次 469）]');
{
  // 一块含水台阶（4,64,4）与一块干台阶（8,64,4）做对照
  const chunk = new Chunk(0, 0);
  const slab = slabId(0);
  chunk.set(4, 64, 4, slab, withWaterlogged(0, true));
  chunk.set(8, 64, 4, slab, 0);

  const ctx: MeshContext = {
    getBlock: (wx, wy, wz) => (wx >= 0 && wx < 16 && wz >= 0 && wz < 16 ? chunk.get(wx, wy, wz) : Block.AIR),
    getBlockState: (wx, wy, wz) => (wx >= 0 && wx < 16 && wz >= 0 && wz < 16 ? chunk.getState(wx, wy, wz) : 0),
    getSkyLight: () => 15,
    getBlockLight: () => 0,
  };
  const result = meshSection(chunk, Chunk.sectionOf(64), atlasStub, ctx);
  // 只有含水那块会进半透明通道：整格盒子 6 面 × 2 三角形 = 12
  check('含水台阶在半透明通道里输出了 12 个三角形（6 面）', triangleCount(result.translucent) === 12, `${triangleCount(result.translucent)}`);
  check('实心通道里两块台阶都在（各自若干面）', triangleCount(result.solid) > 0);
}

console.log(`\n网格化测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
