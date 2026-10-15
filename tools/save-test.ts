/**
 * 存档（K1）离线测试
 *
 * 存档最容易出错的地方是"下标 ↔ 坐标"的换算（存的是区块内下标，读的时候要还原成方块坐标），
 * 一旦算错就会把方块放到别的格子上，而且看起来"像能用"（改了几个方块都在附近）。
 * 因此这里重点覆盖：
 *  1. `Chunk.index` 与 `Chunk.coordsAt` 在全部方块坐标上是互逆的（随机抽样 + 边界）
 *  2. 修改记录的序列化 / 反序列化往返一致
 *  3. 把增量叠加到"刚生成完的区块"上，结果与玩家当时的操作一致
 *  4. 同一格被改多次时以最后一次为准；状态（朝向/开关）也一并保留
 *
 * 运行：npm run test:save
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Chunk, CHUNK_VOLUME, WORLD_MAX_Y, WORLD_MIN_Y } from '../src/core/world/Chunk.ts';
import { ChunkEdits, packEdit, packEditId, packEditState } from '../src/core/save/ChunkEdits.ts';

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

// ---------------------------------------------------------------- 1. 下标与坐标互逆

console.log('\n[Chunk.index / coordsAt 互逆]');
{
  let mismatches = 0;
  // 边界 + 抽样：每个方向的 0 / 15 / 中间值，以及 Y 的两端
  const xs = [0, 1, 7, 14, 15];
  const zs = [0, 1, 7, 14, 15];
  const ys = [WORLD_MIN_Y, WORLD_MIN_Y + 1, -1, 0, 32, 63, 128, WORLD_MAX_Y - 2, WORLD_MAX_Y - 1];
  for (const y of ys) {
    for (const z of zs) {
      for (const x of xs) {
        const index = Chunk.index(x, y, z);
        if (index < 0 || index >= CHUNK_VOLUME) {
          mismatches++;
          continue;
        }
        const back = Chunk.coordsAt(index);
        if (back.x !== x || back.y !== y || back.z !== z) mismatches++;
      }
    }
  }
  check('边界与抽样坐标全部互逆', mismatches === 0, `不匹配 ${mismatches} 处`);

  // 全量：随意挑 2000 个下标做往返
  let randomMismatch = 0;
  for (let i = 0; i < 2000; i++) {
    const index = Math.floor(Math.random() * CHUNK_VOLUME);
    const { x, y, z } = Chunk.coordsAt(index);
    if (Chunk.index(x, y, z) !== index) randomMismatch++;
  }
  check('随机 2000 个下标往返一致', randomMismatch === 0, `不匹配 ${randomMismatch} 处`);

  check('下标从 0 开始、到 CHUNK_VOLUME-1 结束', Chunk.index(0, WORLD_MIN_Y, 0) === 0 && Chunk.index(15, WORLD_MAX_Y - 1, 15) === CHUNK_VOLUME - 1);
}

// ---------------------------------------------------------------- 2. 打包 / 解包

console.log('\n[方块 id + 状态打包]');
{
  const samples: Array<[number, number]> = [
    [Block.STONE, 0],
    [Block.REDSTONE_LAMP, 8],
    [Block.OAK_DOOR, 0b001011],
    [Block.REPEATER, 0b00110001],
    [271 - 1, 255],
    [0, 0],
  ];
  let bad = 0;
  for (const [id, state] of samples) {
    const packed = packEdit(id, state);
    if (packEditId(packed) !== id || packEditState(packed) !== state) bad++;
  }
  check(`打包往返（含最大 id 与状态）`, bad === 0, `不匹配 ${bad} 处`);
  check('打包后仍是 32 位整数（能放进 Uint32Array）', samples.every(([id, state]) => packEdit(id, state) <= 0xffffffff));
}

// ---------------------------------------------------------------- 3. 增量往返

console.log('\n[增量记录：序列化 → 反序列化 → 叠加]');
{
  const edits = new ChunkEdits();
  // 模拟玩家在区块 (2,-3) 上挖了几个方块、放了一个拉杆
  edits.record('overworld', 2, -3, Chunk.index(3, 70, 4), Block.AIR, 0);
  edits.record('overworld', 2, -3, Chunk.index(4, 70, 4), Block.STONE, 0);
  edits.record('overworld', 2, -3, Chunk.index(5, 70, 4), Block.LEVER, 0b000010);
  edits.record('overworld', 2, -3, Chunk.index(6, 71, 4), Block.REDSTONE_LAMP, 0b000010);

  check('记录了 4 个格子', edits.totalEdits === 4, `${edits.totalEdits}`);
  check('涉及 1 个区块', edits.chunkCount === 1);
  check('区块 (2,-3) 有修改', edits.has('overworld', 2, -3));
  check('其它区块没有修改', !edits.has('overworld', 0, 0));
  check('不同维度互不影响', edits.count('nether', 2, -3) === 0);

  const serialized = edits.serialize('overworld', 2, -3);
  check('序列化产出两条数组', serialized !== null && serialized.indices.length === 4 && serialized.packed.length === 4);

  // 反序列化到新实例（模拟"重启游戏后读档"）
  const restored = new ChunkEdits();
  restored.restore('overworld', 2, -3, serialized!);
  check('反序列化后条数一致', restored.totalEdits === 4, `${restored.totalEdits}`);

  // 叠加到一个"刚生成完、只有石头"的区块上
  const chunk = new Chunk(2, -3);
  for (let y = 60; y <= 80; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) chunk.set(x, y, z, Block.STONE, 0);
    }
  }
  const applied = restored.applyTo('overworld', 2, -3, chunk);
  check('叠加了 4 个格子', applied === 4, `${applied}`);
  check('挖掉的格子变成空气', chunk.get(3, 70, 4) === Block.AIR);
  check('放置的石头还在', chunk.get(4, 70, 4) === Block.STONE);
  check('拉杆连状态一起恢复', chunk.get(5, 70, 4) === Block.LEVER && chunk.getState(5, 70, 4) === 0b000010);
  check(
    '红石灯连亮灭状态一起恢复',
    chunk.get(6, 71, 4) === Block.REDSTONE_LAMP && chunk.getState(6, 71, 4) === 0b000010,
  );
  check('没动过的格子保持原样', chunk.get(8, 70, 4) === Block.STONE);
}

// ---------------------------------------------------------------- 4. 覆盖与清理

console.log('\n[覆盖、脏标记与清理]');
{
  const edits = new ChunkEdits();
  const index = Chunk.index(1, 64, 1);
  edits.record('overworld', 0, 0, index, Block.DIRT, 0);
  edits.record('overworld', 0, 0, index, Block.DIAMOND_ORE, 0);
  const overwritten = edits.serialize('overworld', 0, 0)!;
  check(
    '同一格改两次只留最后一次',
    edits.totalEdits === 1 && packEditId(overwritten.packed[0]!) === Block.DIAMOND_ORE,
    `id=${overwritten ? packEditId(overwritten.packed[0]!) : 'null'} 期望 ${Block.DIAMOND_ORE}`,
  );

  check('脏区块会被登记', edits.dirtyKeys().length === 1);
  edits.markSaved();
  check('标记保存后脏列表清空', edits.dirtyKeys().length === 0);

  // 键的拆解（保存时需要拆出维度与坐标）
  const parsed = ChunkEdits.parseKey('nether|-5,12');
  check('区块键可拆解', parsed.dimension === 'nether' && parsed.cx === -5 && parsed.cz === 12, JSON.stringify(parsed));

  edits.clear();
  check('清空后没有任何记录', edits.totalEdits === 0 && edits.chunkCount === 0);

  // 负数坐标：别被 ">>4" 之类的位运算搞错（-1 右移会保持 -1）
  const negative = new ChunkEdits();
  negative.record('overworld', -1, -1, Chunk.index(15, 5, 15), Block.STONE, 0);
  const chunk = new Chunk(-1, -1);
  negative.applyTo('overworld', -1, -1, chunk);
  check('负数区块坐标正确', chunk.get(15, 5, 15) === Block.STONE);
}

// ---------------------------------------------------------------- 5. 存档体积

console.log('\n[存档体积]');
{
  const edits = new ChunkEdits();
  // 模拟一次真实玩法：挖 200 个、放 100 个
  for (let i = 0; i < 200; i++) edits.record('overworld', i % 4, 0, Chunk.index(i % 16, 64, (i * 7) % 16), Block.AIR, 0);
  for (let i = 0; i < 100; i++) edits.record('overworld', 10 + (i % 3), 5, Chunk.index(i % 16, 70, (i * 3) % 16), Block.STONE, 0);

  let bytes = 0;
  for (const key of edits.dirtyKeys()) {
    const { dimension, cx, cz } = ChunkEdits.parseKey(key);
    const data = edits.serialize(dimension, cx, cz);
    if (data) bytes += data.indices.byteLength + data.packed.byteLength;
  }
  console.log(`  300 次方块改动的增量体积：${bytes} 字节（${(bytes / 1024).toFixed(1)} KB）`);
  check('300 次改动的增量 < 8KB（全量区块是 192KB）', bytes < 8192, `${bytes} 字节`);
  check('每条记录 8 字节（下标 4 + 打包值 4）', bytes === edits.totalEdits * 8, `${bytes} vs ${edits.totalEdits * 8}`);
}

console.log(`\n存档测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
