/**
 * 命令方块（批次 477）
 *
 * 三块：
 *  ① 文本规整（去斜杠、限长、坏数据）；
 *  ② 存储表（读写、删除、快照往返、坏条目跳过）；
 *  ③ 红石上升沿（拉杆合上 → 执行一次；通着电不再执行；断开再合 → 再执行一次）。
 *
 * 执行本身（`executeCommand`）在 main 里，这一层只保证"该执行的时候回调了、且只回调一次"。
 */

import { Block } from '../web/src/core/registry/blocks.ts';
import { COMMAND_MAX_LENGTH, CommandBlockStore, commandKey, normalizeCommand } from '../web/src/core/world/CommandBlocks.ts';
import { RedstoneEngine, type RedstoneWorld } from '../web/src/core/redstone/RedstoneEngine.ts';

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

console.log('\n[文本规整]');
{
  equal('去掉开头的斜杠', normalizeCommand('/give @s diamond 1'), 'give @s diamond 1');
  equal('多个斜杠也只去开头', normalizeCommand('//tp @s 0 64 0'), 'tp @s 0 64 0');
  equal('两侧空白裁掉', normalizeCommand('  time set day  '), 'time set day');
  equal('换行折成空格（单行输入框敲不出来，但存档可能是手改的）', normalizeCommand('say\na'), 'say a');
  equal('空串是合法值（表示清空）', normalizeCommand(''), '');
  equal('只有斜杠也等于清空', normalizeCommand('/'), '');
  equal('非字符串不可用', normalizeCommand(42), null);
  equal('null 不可用', normalizeCommand(null), null);
  equal('超长被截断', normalizeCommand('x'.repeat(COMMAND_MAX_LENGTH + 20))?.length, COMMAND_MAX_LENGTH);
}

console.log('\n[存储表]');
{
  const store = new CommandBlockStore();
  store.set('overworld', 1, 64, 2, '/time set day');
  equal('写进去能读回来（且已去斜杠）', store.get('overworld', 1, 64, 2), 'time set day');
  equal('维度不同就是另一格', store.get('nether', 1, 64, 2), undefined);
  equal('条数', store.size, 1);

  store.set('overworld', 1, 64, 2, '');
  equal('写空串 = 删除', store.get('overworld', 1, 64, 2), undefined);
  equal('删完条数是 0', store.size, 0);

  store.set('overworld', 3, 70, 4, 'say hi');
  equal('remove 返回 true', store.remove('overworld', 3, 70, 4), true);
  equal('remove 不存在的返回 false', store.remove('overworld', 3, 70, 4), false);

  // 快照往返
  store.set('overworld', 5, 60, 6, 'weather clear');
  store.set('nether', 7, 30, 8, 'say nether');
  const roundTrip = new CommandBlockStore();
  const skipped = roundTrip.restore(JSON.parse(JSON.stringify(store.serialize())));
  equal('往返不丢条数', roundTrip.size, store.size);
  equal('往返没有跳过', skipped, 0);
  equal('内容一致', roundTrip.get('nether', 7, 30, 8), 'say nether');

  // 坏数据
  const broken = new CommandBlockStore();
  const bad = broken.restore([
    { dimension: 'overworld', x: 1, y: 2, z: 3, command: 'say ok' },
    { dimension: 'overworld', x: 1, y: 2, z: 3, command: 42 },
    { dimension: 7, x: 1, y: 2, z: 3, command: 'say bad' },
    { dimension: 'overworld', x: Number.NaN, y: 2, z: 3, command: 'say nan' },
    { dimension: 'overworld', x: 4, y: 5, z: 6, command: '   ' },
  ]);
  equal('只活下来一条', broken.size, 1);
  equal('四条坏数据被跳过', bad, 4);
  equal('没有存档时跳过量 0', new CommandBlockStore().restore(null), 0);
  check('键的格式与方块实体一致', commandKey('overworld', 1, 2, 3) === 'overworld|1,2,3');
}

console.log('\n[红石上升沿：只执行一次]');
{
  class Stub implements RedstoneWorld {
    private readonly blocks = new Map<string, number>();
    private readonly states = new Map<string, number>();
    private static key(x: number, y: number, z: number): string {
      return `${x},${y},${z}`;
    }
    set(x: number, y: number, z: number, id: number, state = 0): void {
      this.blocks.set(Stub.key(x, y, z), id);
      this.states.set(Stub.key(x, y, z), state);
    }
    getBlock(x: number, y: number, z: number): number {
      return this.blocks.get(Stub.key(x, y, z)) ?? Block.AIR;
    }
    getState(x: number, y: number, z: number): number {
      return this.states.get(Stub.key(x, y, z)) ?? 0;
    }
    setBlock(x: number, y: number, z: number, id: number, state: number): boolean {
      this.set(x, y, z, id, state);
      return true;
    }
    setState(x: number, y: number, z: number, state: number): boolean {
      this.states.set(Stub.key(x, y, z), state);
      return true;
    }
    isLoaded(): boolean {
      return true;
    }
    hasEntityAt(): boolean {
      return false;
    }
  }

  const world = new Stub();
  // 命令方块在 (0,64,0)，拉杆在 (1,64,0)（拉杆贴着它）
  world.set(0, 64, 0, Block.COMMAND_BLOCK);
  world.set(1, 64, 0, Block.LEVER);

  const engine = new RedstoneEngine();
  let fired = 0;
  engine.onCommandBlock = () => {
    fired++;
  };

  engine.toggleLever(world, 1, 64, 0);
  equal('拉杆合上 → 执行一次', fired, 1);

  engine.recompute(world, 1, 64, 0);
  engine.recompute(world, 1, 64, 0);
  equal('通着电反复重算不会连发（上升沿判定）', fired, 1);

  engine.toggleLever(world, 1, 64, 0);
  engine.toggleLever(world, 1, 64, 0);
  equal('断开再合 → 再执行一次', fired, 2);
}

console.log(`\n命令方块测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
