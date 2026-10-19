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
import { Item } from '../src/core/registry/items.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { Chunk, CHUNK_VOLUME, WORLD_MAX_Y, WORLD_MIN_Y } from '../src/core/world/Chunk.ts';
import { BlockEntityStore } from '../src/core/world/BlockEntityStore.ts';
import {
  SLOT_COUNTS,
  restoreContainers,
  serializeContainers,
} from '../src/core/save/ContainerSave.ts';
import { ChunkEdits, packEdit, packEditId, packEditState } from '../src/core/save/ChunkEdits.ts';
import { BREW_SECONDS, BREWS_PER_BLAZE_POWDER } from '../src/core/crafting/Brewing.ts';

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

function close(label: string, actual: number, expected: number, epsilon = 1e-9): void {
  check(label, Math.abs(actual - expected) <= epsilon, `实际 ${actual}，期望 ${expected}`);
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

// ---------------------------------------------------------------- 5. 容器内容的往返（C7 尾巴）

console.log('\n[容器内容：序列化 → 反序列化]');
{
  const store = new BlockEntityStore();

  // 五种容器各放点东西：这里刻意混上 damage / enchants / name，
  // 因为"工具活下来了但耐久没了"这种半丢状态最难发现
  // 工具 id 不在 `Item` 枚举里（它们在 tools.ts 按"种类 × 材质"算出来）
  const pickaxe = toolItemId('pickaxe', 'diamond');
  const sword = toolItemId('sword', 'diamond');

  const chest = store.getOrCreateChest('overworld', 10, 64, 10);
  chest.set(0, { id: Item.DIAMOND, count: 32 });
  // ⚠️ 四项附加数据全都要有（批次 63 补齐 repairCost）：漏了累积惩罚，
  // 读档后同一件装备在铁砧上会**变便宜**——"只漏了最后加进来的那一项"是这类字段的典型坑
  chest.set(26, {
    id: pickaxe,
    count: 1,
    damage: 517,
    enchants: { efficiency: 3 },
    name: '挖挖挖',
    repairCost: 9,
  });

  const furnace = store.getOrCreateFurnace('overworld', 11, 64, 10);
  furnace.set(0, { id: Item.RAW_IRON, count: 7 });
  furnace.set(1, { id: Item.COAL, count: 3 });
  furnace.set(2, { id: Item.IRON_INGOT, count: 2 });
  furnace.burnTimeLeft = 42.5;
  furnace.burnTimeTotal = 80;
  furnace.cookProgress = 3.25;
  furnace.cookTimeTotal = 10;
  furnace.storedExperience = 1.5;

  const table = store.getOrCreateEnchantTable('overworld', 12, 64, 10);
  table.set(0, { id: sword, count: 1 });
  table.set(1, { id: Item.LAPIS_LAZULI, count: 8 });

  const anvil = store.getOrCreateAnvil('overworld', 13, 64, 10);
  anvil.set(0, { id: sword, count: 1, damage: 10, enchants: { sharpness: 2 } });
  anvil.set(1, { id: sword, count: 1, enchants: { sharpness: 3 } });
  anvil.set(2, { id: sword, count: 1, enchants: { sharpness: 3 } });

  const stand = store.getOrCreateBrewingStand('overworld', 14, 64, 10);
  stand.set(0, { id: Item.WATER_BOTTLE, count: 1 });
  stand.set(3, { id: Item.NETHER_WART, count: 4 });
  stand.set(4, { id: Item.BLAZE_POWDER, count: 2 });
  stand.fuelLeft = 17;
  stand.brewProgress = 6.5;

  const data = serializeContainers(store);
  equal('五个容器都被导出', data.length, 5);
  equal('每个容器都记住了自己的种类与坐标', data.every((entry) => typeof entry.kind === 'string'), true);

  // 走一遍 JSON 往返：IndexedDB 用的是结构化克隆，但存档里**绝不能出现函数/类实例**，
  // JSON 是最严的检查（`undefined` 与类方法都会在这里露馅）
  const cloned = JSON.parse(JSON.stringify(data)) as typeof data;

  const restored = new BlockEntityStore();
  equal('全部还原成功', restoreContainers(restored, cloned), 5);

  const chest2 = restored.getChest('overworld', 10, 64, 10)!;
  equal('箱子的第 0 格还在', chest2.get(0)?.id, Item.DIAMOND);
  equal('箱子的物品数量还在', chest2.get(0)?.count, 32);
  equal('箱子那格的耐久还在', chest2.get(26)?.damage, 517);
  equal('箱子那格的附魔还在', chest2.get(26)?.enchants?.efficiency, 3);
  equal('箱子那格的自定义名字还在', chest2.get(26)?.name, '挖挖挖');
  equal('箱子那格的累积惩罚还在（否则修一次会变便宜）', chest2.get(26)?.repairCost, 9);
  equal('没放东西的格子还是空的', chest2.get(5), null);

  const furnace2 = restored.getFurnace('overworld', 11, 64, 10)!;
  equal('熔炉的原料还在', furnace2.get(0)?.id, Item.RAW_IRON);
  equal('熔炉的燃料还在', furnace2.get(1)?.count, 3);
  equal('熔炉的产物还在', furnace2.get(2)?.id, Item.IRON_INGOT);
  close('熔炉的燃烧剩余时长还在', furnace2.burnTimeLeft, 42.5);
  close('熔炉的烧炼进度还在（半途关页面不白烧）', furnace2.cookProgress, 3.25);
  close('熔炉攒下的经验还在', furnace2.storedExperience, 1.5);

  const stand2 = restored.getBrewingStand('overworld', 14, 64, 10)!;
  equal('酿造台的药水还在', stand2.get(0)?.id, Item.WATER_BOTTLE);
  equal('酿造台的材料还在', stand2.get(3)?.id, Item.NETHER_WART);
  equal('酿造台剩下的燃料次数还在', stand2.fuelLeft, 17);
  close('酿造台的酿造进度还在', stand2.brewProgress, 6.5);

  // 批次 330：外部数据被手改过时，燃料次数与进度都要夹回合法区间
  // （进度 > 20 会让界面进度条溢出；次数 > 20 等于凭空多酿）
  const dirtyBrew = JSON.parse(JSON.stringify(data)) as typeof data;
  const brewingEntry = dirtyBrew.find((entry) => entry.kind === 'brewing')!;
  brewingEntry.brewing = { fuelLeft: 999, brewProgress: 999 };
  const dirtyStore = new BlockEntityStore();
  restoreContainers(dirtyStore, dirtyBrew);
  const clamped = dirtyStore.getBrewingStand('overworld', 14, 64, 10)!;
  equal('越界的燃料次数被夹到上限', clamped.fuelLeft, BREWS_PER_BLAZE_POWDER);
  equal('越界的酿造进度被夹到上限', clamped.brewProgress, BREW_SECONDS);

  brewingEntry.brewing = { fuelLeft: -5, brewProgress: -3 };
  const negativeStore = new BlockEntityStore();
  restoreContainers(negativeStore, dirtyBrew);
  const clampedNegative = negativeStore.getBrewingStand('overworld', 14, 64, 10)!;
  equal('负数燃料次数被夹到 0', clampedNegative.fuelLeft, 0);
  equal('负数酿造进度被夹到 0', clampedNegative.brewProgress, 0);

  equal('附魔台的装备还在', restored.getEnchantTable('overworld', 12, 64, 10)?.get(0)?.id, sword);
  equal('铁砧两格的附魔还在', restored.getAnvil('overworld', 13, 64, 10)?.get(1)?.enchants?.sharpness, 3);
  equal('铁砧的产物还在', restored.getAnvil('overworld', 13, 64, 10)?.get(2)?.enchants?.sharpness, 3);

  // 再序列化一次应该完全一致（往返稳定，不是"读一次就变样"）
  const again = serializeContainers(restored);
  equal('再导出一次与第一次一致（往返稳定）', JSON.stringify(again), JSON.stringify(cloned));
}

console.log('\n[容器：维度是键的一部分]');
{
  // 同坐标、不同维度必须互不干扰：否则"在下界放个熔炉"会把主世界同坐标的箱子顶掉
  const store = new BlockEntityStore();
  store.getOrCreateChest('overworld', 0, 64, 0).set(0, { id: Item.DIAMOND, count: 9 });
  store.getOrCreateFurnace('nether', 0, 64, 0).set(0, { id: Item.COAL, count: 3 });

  equal('同坐标的两个维度各算一个容器', store.size, 2);
  equal('主世界的箱子还在', store.getChest('overworld', 0, 64, 0)?.get(0)?.count, 9);
  equal('下界的熔炉也在', store.getFurnace('nether', 0, 64, 0)?.get(0)?.id, Item.COAL);
  equal('主世界那边没有熔炉', store.getFurnace('overworld', 0, 64, 0), undefined);
  equal('没放过东西的维度什么都没有', store.get('end', 0, 64, 0), undefined);
  equal('countIn 能按维度数', store.countIn('nether'), 1);

  // 存档往返也要带着维度回原处
  const data = JSON.parse(JSON.stringify(serializeContainers(store))) as ReturnType<typeof serializeContainers>;
  const back = new BlockEntityStore();
  equal('还原两个容器', restoreContainers(back, data), 2);
  equal('箱子的内容回到主世界', back.getChest('overworld', 0, 64, 0)?.get(0)?.count, 9);
  equal('熔炉的内容回到下界', back.getFurnace('nether', 0, 64, 0)?.get(0)?.id, Item.COAL);

  // 移除也要按维度
  store.remove('overworld', 0, 64, 0);
  equal('移除主世界的容器后下界的还在', store.getFurnace('nether', 0, 64, 0)?.get(0)?.id, Item.COAL);
  equal('主世界那边被清掉了', store.getChest('overworld', 0, 64, 0), undefined);
}

console.log('\n[容器内容：空容器与脏数据]');
{
  // 空容器不写进存档（一次玩法能攒出成百上千个"打开过又空着"的容器）
  const store = new BlockEntityStore();
  store.getOrCreateChest('overworld', 0, 64, 0);
  store.getOrCreateFurnace('overworld', 1, 64, 0);
  equal('完全空的容器一个都不写', serializeContainers(store).length, 0);

  const withItem = new BlockEntityStore();
  withItem.getOrCreateChest('overworld', 0, 64, 0).set(3, { id: Block.STONE, count: 1 });
  equal('有东西的容器才写', serializeContainers(withItem).length, 1);

  // 只烧了一半的熔炉：即使三格都空了，"燃烧剩余"也要留住（否则重新点火的节奏会抖）
  const burning = new BlockEntityStore();
  burning.getOrCreateFurnace('overworld', 5, 64, 5).burnTimeLeft = 30;
  equal('空槽但还在燃烧的熔炉要写进去', serializeContainers(burning).length, 1);

  // ---- 脏数据：一条坏记录不该把整份存档吞掉
  const target = new BlockEntityStore();
  const dirty = [
    { kind: 'nope', dimension: 'overworld', x: 0, y: 0, z: 0, stacks: [] },
    null,
    { kind: 'chest', dimension: 'overworld', x: 1, y: 64, z: 1, stacks: null },
    { kind: 'chest', dimension: 'overworld', x: 2, y: 64, z: 2, stacks: [{ id: Item.DIAMOND, count: 4 }] },
    { kind: 'chest', dimension: 'overworld', x: 3, y: 64, z: 3, stacks: [{ id: 999999, count: 1 }] },
    { kind: 'furnace', dimension: 'overworld', x: 4, y: 64, z: 4, stacks: [{ id: Item.COAL, count: 1 }], furnace: { burnTimeLeft: Number.NaN } },
  ] as unknown as Parameters<typeof restoreContainers>[1];

  const restored = restoreContainers(target, dirty);
  equal('未知种类与空记录被跳过（其余四条照还原）', restored, 4);
  equal('栈数组是 null 也不炸（按空格处理）', target.getChest('overworld', 1, 64, 1)?.get(0), null);
  equal('正常的那条照常还原', target.getChest('overworld', 2, 64, 2)?.get(0)?.count, 4);
  equal('不存在的物品 id 被丢掉（不留"空白物品"）', target.getChest('overworld', 3, 64, 3)?.get(0), null);
  equal('状态里的 NaN 回退成 0（不是 NaN）', target.getFurnace('overworld', 4, 64, 4)?.burnTimeLeft, 0);

  equal('传 undefined 返回 0', restoreContainers(new BlockEntityStore(), undefined), 0);
  equal(
    '传一个不是数组的东西也返回 0',
    restoreContainers(new BlockEntityStore(), { kind: 'chest' } as unknown as Parameters<typeof restoreContainers>[1]),
    0,
  );

  // 槽位被截断（老版本 8 格箱子的存档）：缺的当空格，多的丢掉
  const short = new BlockEntityStore();
  restoreContainers(short, [
    { kind: 'chest', dimension: 'overworld', x: 9, y: 64, z: 9, stacks: [{ id: Item.DIAMOND, count: 2 }] },
  ]);
  equal('槽位不足时补空格，长度补齐到 27', SLOT_COUNTS.chest, 27);
  equal('截断存档里的那格仍然读得出来', short.getChest('overworld', 9, 64, 9)?.get(0)?.count, 2);
  equal('补出来的格子是空的', short.getChest('overworld', 9, 64, 9)?.get(20), null);
}

console.log(`\n存档测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
