/**
 * 世界管理（世界列表 / 世界类型 / 超平坦地形）离线测试
 *
 * 覆盖：
 *  1. 世界类型表：三种类型都有中文标签、`isWorldType` 认得出脏数据、随机种子在合法范围内
 *  2. 世界清单：增删改查、排序、默认命名、持久化往返、清单损坏时回退、字段缺失时补默认
 *  3. 库名映射：旧版单存档沿用旧库名（升级不搬数据），新世界各自一个库
 *  4. 超平坦地形：基岩层在最底、泥土三层、草方块地表、之上全是空气；且只影响主世界
 *  5. 放大化地形：起伏幅度明显比默认世界大，且不会顶出世界高度
 *
 * 运行：npm run test:world
 */

import {
  AMPLIFIED_RELIEF_SCALE,
  FLAT_LAYERS,
  FLAT_SURFACE_Y,
  WORLD_SURFACE_Y,
  WORLD_TYPES,
  WORLD_TYPE_LABELS,
  isWorldType,
  randomSeed,
} from '../src/core/gen/WorldType.ts';
import { generateChunkBlocks } from '../src/core/gen/TerrainGenerator.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import { OverworldGenerator, SEA_LEVEL } from '../src/core/gen/OverworldGenerator.ts';
import { Chunk, CHUNK_SIZE_X, CHUNK_SIZE_Z, WORLD_MAX_Y } from '../src/core/world/Chunk.ts';
import {
  findSafeSpawn,
  naturalGroundNear,
  naturalGroundY,
  planSpawnRegion,
  type SpawnSearchWorld,
} from '../src/core/world/SpawnPoint.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { LEGACY_WORLD_ID, WorldRegistry, dbNameFor } from '../src/core/save/WorldRegistry.ts';
import { readFileSync } from 'node:fs';
import { relativeTime } from '../src/ui/WorldScreen.ts';

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

/** 内存版 localStorage（Node 里没有真的），只实现用到的几个方法 */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  /** 测试用：直接塞一段原文（模拟清单损坏） */
  raw(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const SEED = 20261014;

// ---------------------------------------------------------------- 1. 世界类型

console.log('\n[世界类型]');
{
  check('三种类型齐全', WORLD_TYPES.join('|') === 'default|flat|amplified');
  check(
    '每种类型都有中文标签',
    WORLD_TYPES.every((type) => typeof WORLD_TYPE_LABELS[type] === 'string' && WORLD_TYPE_LABELS[type].length > 0),
  );
  check('isWorldType 认得合法值', isWorldType('flat') && isWorldType('amplified') && isWorldType('default'));
  check('isWorldType 拒绝脏数据', !isWorldType('nope') && !isWorldType(3) && !isWorldType(null));

  let inRange = true;
  for (let i = 0; i < 200; i++) {
    const seed = randomSeed();
    if (!Number.isInteger(seed) || seed < 0 || seed > 0x7fffffff) inRange = false;
  }
  check('随机种子都是 32 位正整数（能在界面上手输）', inRange);
  check('超平坦地表高度就是草方块那一层', FLAT_SURFACE_Y === FLAT_LAYERS.grassY);
}

// ---------------------------------------------------------------- 2. 世界清单

console.log('\n[世界清单]');
{
  const storage = new MemoryStorage();
  const registry = new WorldRegistry(storage);
  check('初始没有任何世界', registry.count === 0 && registry.list().length === 0);

  const first = registry.create();
  check('新建世界有 id 与非零种子', first.id.length > 0 && Number.isInteger(first.seed));
  check('默认地形是 default', first.worldType === 'default');
  check('默认名字带编号', first.name === '新的世界 1', first.name);

  const flat = registry.create({ worldType: 'flat', seed: 42 });
  check('按类型自动命名', flat.name === '超平坦世界 1', flat.name);
  check('种子用传入的值', flat.seed === 42);

  const named = registry.create({ name: '  我的存档  ', worldType: 'amplified' });
  check('自定义名字会去掉首尾空格', named.name === '我的存档', `[${named.name}]`);
  check('id 不重复', new Set([first.id, flat.id, named.id]).size === 3);

  check('list 按上次游玩倒序', registry.list()[0]!.id === named.id || registry.list()[0]!.lastPlayed >= first.lastPlayed);

  registry.update(flat.id, { playTime: 120, edits: 7, lastPlayed: Date.now() + 1000 });
  check('update 能写回统计', registry.get(flat.id)!.playTime === 120 && registry.get(flat.id)!.edits === 7);
  check('刚玩过的世界排到最前', registry.list()[0]!.id === flat.id);

  registry.rename(flat.id, '  平坦乐园 ');
  check('重命名生效', registry.get(flat.id)!.name === '平坦乐园');
  registry.rename(flat.id, '   ');
  check('重命名成空白时回退成"未命名世界"', registry.get(flat.id)!.name === '未命名世界');

  // 持久化：换一个 registry 读同一个 storage
  const reloaded = new WorldRegistry(storage);
  check('清单会持久化（重新加载后还在）', reloaded.count === 3 && reloaded.get(first.id)!.name === first.name);

  reloaded.remove(flat.id);
  check('删除后清单里没有了', reloaded.count === 2 && reloaded.get(flat.id) === undefined);
  check('删除也写回了存储', new WorldRegistry(storage).count === 2);

  // 清单损坏 / 字段缺失
  const broken = new MemoryStorage();
  broken.raw('bedrock-worlds', '{ 这不是 JSON');
  check('清单损坏时回退成空列表（而不是让游戏打不开）', new WorldRegistry(broken).count === 0);

  const messy = new MemoryStorage();
  messy.raw('bedrock-worlds', JSON.stringify([{ id: 'a' }, { id: '' }, 'nonsense', { id: 'b', worldType: 'flat', seed: 5 }]));
  const healed = new WorldRegistry(messy);
  check('缺字段的条目被补齐（名字/种子/类型/时间）', healed.count === 2 && healed.get('a')!.name === '未命名世界');
  check('没有 id 的条目被丢掉', healed.get('') === undefined);
  check('合法的 worldType 保留下来', healed.get('b')!.worldType === 'flat');
  check('非法 worldType 回退成 default', healed.get('a')!.worldType === 'default');

  // 认领旧存档
  const legacyRegistry = new WorldRegistry(new MemoryStorage());
  const adopted = legacyRegistry.adopt(LEGACY_WORLD_ID, 777, { name: '我的世界' });
  check('认领旧存档会建出条目', adopted.seed === 777 && legacyRegistry.count === 1);
  check('重复认领同一个 id 不会建出第二个', legacyRegistry.adopt(LEGACY_WORLD_ID, 999).seed === 777);
}

// ---------------------------------------------------------------- 3. 库名映射

console.log('\n[存档库名]');
{
  check('旧版单存档沿用旧库名（升级不搬数据）', dbNameFor(LEGACY_WORLD_ID) === 'bedrock-118-web');
  check('新世界各自一个库', dbNameFor('w123') === 'bedrock-118-web:w123');
  check('两个世界不会共用一个库', dbNameFor('w1') !== dbNameFor('w2'));
}

// ---------------------------------------------------------------- 4. 超平坦地形

console.log('\n[超平坦世界]');
{
  const blocks = generateChunkBlocks(0, 0, SEED, Dimension.OVERWORLD, 'flat');
  const blockAt = (x: number, y: number, z: number): number => blocks[Chunk.index(x, y, z)]!;

  check('最底下是基岩（防掉出世界）', blockAt(0, FLAT_LAYERS.bedrockY, 0) !== 0 && blockAt(15, FLAT_LAYERS.bedrockY, 15) !== 0);
  // 基岩就在世界的底面（再往下越界了，不能取样）：这一层必须是实心的
  check('基岩层就是世界底面', FLAT_SURFACE_Y > FLAT_LAYERS.bedrockY && FLAT_LAYERS.dirtFrom === FLAT_LAYERS.bedrockY + 1);
  check('泥土层是实心的', blockAt(3, FLAT_LAYERS.dirtFrom, 7) !== 0 && blockAt(3, FLAT_LAYERS.dirtTo, 7) !== 0);
  check('地表那一层是草方块', blockAt(3, FLAT_LAYERS.grassY, 7) !== 0);
  check('地表之上全是空气', blockAt(3, FLAT_LAYERS.grassY + 1, 7) === 0 && blockAt(8, 100, 8) === 0);

  let solidAbove = 0;
  for (let y = FLAT_LAYERS.grassY + 1; y < WORLD_MAX_Y; y++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        if (blockAt(x, y, z) !== 0) solidAbove++;
      }
    }
  }
  check('草地上方一个方块都没有（没有树、没有洞穴）', solidAbove === 0, `多出 ${solidAbove} 个方块`);

  // 每个区块都一模一样：平坦世界不依赖坐标
  const far = generateChunkBlocks(37, -12, SEED, Dimension.OVERWORLD, 'flat');
  let identical = true;
  for (let i = 0; i < blocks.length; i++) if (blocks[i] !== far[i]) identical = false;
  check('不同区块的地形完全相同', identical);

  // 只影响主世界：下界与末地照旧
  const netherFlat = generateChunkBlocks(0, 0, SEED, Dimension.NETHER, 'flat');
  const netherNormal = generateChunkBlocks(0, 0, SEED, Dimension.NETHER, 'default');
  let same = true;
  for (let i = 0; i < netherFlat.length; i++) if (netherFlat[i] !== netherNormal[i]) same = false;
  check('超平坦不影响下界', same);

  const endFlat = generateChunkBlocks(0, 0, SEED, Dimension.END, 'flat');
  const endNormal = generateChunkBlocks(0, 0, SEED, Dimension.END, 'default');
  same = true;
  for (let i = 0; i < endFlat.length; i++) if (endFlat[i] !== endNormal[i]) same = false;
  check('超平坦不影响末地', same);
}

// ---------------------------------------------------------------- 5. 放大化地形

console.log('\n[放大化世界]');
{
  const normal = new OverworldGenerator(SEED, 'default');
  const amplified = new OverworldGenerator(SEED, 'amplified');

  let normalMax = -Infinity;
  let amplifiedMax = -Infinity;
  let normalDeviation = 0;
  let amplifiedDeviation = 0;
  let landSamples = 0;
  const SAMPLES = 40;
  for (let i = 0; i < SAMPLES; i++) {
    const x = i * 37 - 300;
    const z = i * 53 - 400;
    const heightN = normal.surfaceY(x, z);
    const heightA = amplified.surfaceY(x, z);
    normalMax = Math.max(normalMax, heightN);
    amplifiedMax = Math.max(amplifiedMax, heightA);
    // ⚠️ 只在**陆地**上比"起伏被放大"。批次 179 起，水下的起伏按设计**不再随
    // relief 放大**（放大化只该放大山，不该把海也放大成无底洞），而这条采样线
    // 的 40 个点里有相当一部分落在海里 —— 混着量会把 2 倍的差异稀释成 1.01 倍。
    if (heightN >= SEA_LEVEL) {
      landSamples++;
      normalDeviation += heightN - SEA_LEVEL;
      amplifiedDeviation += heightA - SEA_LEVEL;
    }
  }

  check('放大化世界确实更高（最高点超过默认）', amplifiedMax > normalMax, `默认 ${normalMax} / 放大 ${amplifiedMax}`);
  check(
    '陆地上起伏被放大（偏离海平面的幅度更大）',
    landSamples >= 8 && amplifiedDeviation > normalDeviation * 1.2,
    `陆地样本 ${landSamples} 个：默认 ${normalDeviation} / 放大 ${amplifiedDeviation}`,
  );
  check(
    '倍率就是配置里那个数',
    AMPLIFIED_RELIEF_SCALE > 1 && AMPLIFIED_RELIEF_SCALE < 4,
    String(AMPLIFIED_RELIEF_SCALE),
  );

  // 极值也不能顶出世界高度：夹紧之后仍要能正常生成。
  //
  // ⚠️ N9-a 调参时把这个判据**拆成两件事**：**真出界**（会被切平，绝对不行）与
  // **逼近上限**（留一点余量预算）。原来只量后者、且要求"一列都不许"——
  // 而 N9-a 把大尺度起伏抬上来之后必然多几座高峰，那条判据会把"地形改对了"当成失败。
  // 真正的要求只有一条：**不能顶出世界高度**。
  let outside = 0;
  let atCeiling = 0;
  for (let i = 0; i < 200; i++) {
    const height = amplified.surfaceY(i * 11 - 1000, i * 17 - 1000);
    if (height >= WORLD_MAX_Y) outside++;
    if (height >= WORLD_MAX_Y - 4) atCeiling++;
  }
  check('没有一列顶出世界高度（顶出去会被切平）', outside === 0, `${outside} 列出界`);
  check(
    `逼近上限的列很少（N9-a 实测 1/200）`,
    atCeiling <= 5,
    `${atCeiling}/200 列 ≥ ${WORLD_MAX_Y - 4}`,
  );

  const amplifiedChunk = generateChunkBlocks(0, 0, SEED, Dimension.OVERWORLD, 'amplified');
  const normalChunk = generateChunkBlocks(0, 0, SEED, Dimension.OVERWORLD, 'default');
  let different = false;
  for (let i = 0; i < amplifiedChunk.length; i++) {
    if (amplifiedChunk[i] !== normalChunk[i]) {
      different = true;
      break;
    }
  }
  check('同一个种子的默认与放大化生成出不同的地形', different);

  // 生成器缓存不能把两种世界类型串在一起
  const again = generateChunkBlocks(0, 0, SEED, Dimension.OVERWORLD, 'default');
  let sameAsNormal = true;
  for (let i = 0; i < again.length; i++) if (again[i] !== normalChunk[i]) sameAsNormal = false;
  check('切回默认类型拿到的还是默认地形（缓存没串）', sameAsNormal);
}

// ---------------------------------------------------------------- 6. 安全出生点

console.log('\n[安全出生点]');
{
  const heights = new Map<string, number>();
  const extras = new Map<string, number>();
  for (let z = -16; z <= 16; z++) {
    for (let x = -16; x <= 16; x++) heights.set(`${x},${z}`, 70);
  }
  // 原点附近造一条陡沟；它离中心最近，但不应该胜过稍远的平地。
  heights.set('0,0', 76);
  heights.set('2,0', 68);
  // 树冠是固体，但不能被识别成自然地面。
  extras.set('8,79,8', Block.OAK_LEAVES);

  const mock: SpawnSearchWorld = {
    isLoaded: (x, z) => Math.abs(x) <= 16 && Math.abs(z) <= 16,
    getBlock: (x, y, z) => extras.get(`${x},${y},${z}`) ?? (y <= (heights.get(`${x},${z}`) ?? -65) ? Block.GRASS_BLOCK : Block.AIR),
    isSolid(x, y, z) {
      const id = this.getBlock(x, y, z);
      return id !== Block.AIR && id !== Block.WATER && id !== Block.LAVA;
    },
  };

  check('树冠不会被当成出生地面', naturalGroundY(mock, 8, 8) === 70);
  const spawn = findSafeSpawn(mock, (x) => (x >= 6 ? 'plains' : 'desert'), 0, 0, 14);
  check('能在已加载区域找到出生点', spawn !== null);
  check('拒绝中心陡沟并优先植被丰富的平地', spawn !== null && spawn.roughness === 0 && spawn.biome === 'plains');
  check('出生高度恰在地表上方', spawn !== null && spawn.groundY === 70 && Math.abs(spawn.y - 71.01) < 1e-6);

  // 批次 213：读档落地校正只扫玩家高度附近（不从世界顶翻整列）
  check('读档校正：取玩家高度附近的自然地面', naturalGroundNear(mock, 8, 8, 80) === 70);
  const ocean: SpawnSearchWorld = {
    isLoaded: () => true,
    getBlock: (_x, y, _z) => (y <= 66 ? Block.STONE : y <= 70 ? Block.WATER : Block.AIR),
    isSolid(x, y, z) {
      const id = this.getBlock(x, y, z);
      return id !== Block.AIR && id !== Block.WATER && id !== Block.LAVA;
    },
  };
  check('读档校正不会把玩家放到水底（水面之上无法站立）', naturalGroundNear(ocean, 0, 0, 80) === null);

  const region = planSpawnRegion(
    (x) => (Math.abs(x) < 12 ? 40 : 72),
    (x) => (x >= 16 ? 'forest' : 'desert'),
    32,
  );
  check('原点在海里时会预选附近的植被陆地', region.x >= 16);
}

// ---------------------------------------------------------------- 6b. 超平坦出生点

console.log('\n[超平坦世界的出生点（批次 238）]');
{
  // 超平坦：整片世界只有 y<=-61 的三层地面（基岩/泥土/草），其余全是空气
  const flat: SpawnSearchWorld = {
    isLoaded: () => true,
    getBlock: (_x, y, _z) => (y <= FLAT_SURFACE_Y ? Block.GRASS_BLOCK : Block.AIR),
    isSolid(x, y, z) {
      const id = this.getBlock(x, y, z);
      return id !== Block.AIR;
    },
  };

  check('超平坦地表就在 -61', FLAT_SURFACE_Y === -61);
  check(
    '用海平面判据（64）一列都选不出来 —— 这正是旧版本"进入卡死"的原因',
    findSafeSpawn(flat, () => 'plains', 0, 0, 8) === null,
  );

  const flatSpawn = findSafeSpawn(flat, () => 'plains', 0, 0, 8, WORLD_SURFACE_Y.flat);
  check('按世界类型给下限就能解析出出生点', flatSpawn !== null);
  check('出生地面是 -61', flatSpawn !== null && flatSpawn.groundY === FLAT_SURFACE_Y);
  check(
    '出生高度是地表上一格',
    flatSpawn !== null && Math.abs(flatSpawn.y - (FLAT_SURFACE_Y + 1.01)) < 1e-6,
  );

  const flatRegion = planSpawnRegion(() => FLAT_SURFACE_Y, () => 'plains', 32, WORLD_SURFACE_Y.flat);
  check('出生区域规划带出真实地表高度（临时落点不再写死 80）', flatRegion.y === FLAT_SURFACE_Y);

  // 默认/放大化世界的判据不能被放宽：整片都在海平面以下时仍然一个都不选
  const underwater = planSpawnRegion(() => 40, () => 'plains', 32);
  check('默认世界整片低于海平面时不选列（判据没被放宽）', underwater.x === 0 && underwater.y === 40);

  // 旧存档停在 y=80，而地面在 -61：局部扫描够不到，靠近整列扫描兜底
  check('局部扫描（48 格）够不到超平坦地表', naturalGroundNear(flat, 0, 0, 80) === null);
  check(
    '整列扫描能找到（`nearestNaturalGround` 的 r=0 兜底靠这一条）',
    naturalGroundY(flat, 0, 0) === FLAT_SURFACE_Y,
  );
}

// ---------------------------------------------------------------- 7. 时间文案

console.log('\n[相对时间]');
{
  const now = Date.now();
  check('刚刚', relativeTime(now - 5_000, now) === '刚刚');
  check('分钟', relativeTime(now - 3 * 60_000, now) === '3 分钟前');
  check('小时', relativeTime(now - 5 * 3_600_000, now) === '5 小时前');
  check('天', relativeTime(now - 3 * 86_400_000, now) === '3 天前');
  check('未来时间不会显示负数', relativeTime(now + 60_000, now) === '刚刚');
}

console.log('\n[光照快路径：写入侧的接线（批次 282）]');
{
  // 判据本身在 `tests/light.test.ts` 里逐条断言；这里只保证 `World` 的两条写入路径
  // 真的用了它，而且 `onBlockChanged` 没有被漏在分支外面（漏一处就等于没做）。
  const src = readFileSync(new URL('../src/core/world/World.ts', import.meta.url), 'utf8');
  check('两条写入路径都用 lightNeedsUpdate 判定', (src.match(/lightNeedsUpdate\(/g) ?? []).length === 2);
  check('onBlockChanged 全部在 lightChanged 分支里', (src.match(/if \(lightChanged\) this\.light\.onBlockChanged/g) ?? []).length === 2);
  check('跳过光照的写入单独计数（诊断）', src.includes('this.lightSkipped++'));
}

console.log(`\n世界测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
