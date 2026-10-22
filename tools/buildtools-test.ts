/**
 * 创造工具的离线测试（创造1）
 *
 * 运行：npm run test:buildtools
 *
 * 只测 `src/buildtools/UndoStack.ts`：入栈、批量归并、上限裁剪、撤销/重做的顺序，
 * 以及"放了又拆"这类不该占一步的情形。写回世界那部分不在这里（它属于主程序）。
 */

import { readFileSync } from 'node:fs';
import {
  DEFAULT_UNDO_LIMIT,
  UndoStack,
  type BlockEdit,
} from '../src/buildtools/UndoStack.ts';

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

/** 造一条改动（默认主世界、y=64、state=0） */
function edit(
  x: number,
  beforeId: number,
  afterId: number,
  extra: Partial<BlockEdit> = {},
): BlockEdit {
  return {
    dimension: 'overworld',
    x,
    y: 64,
    z: 0,
    beforeId,
    beforeState: 0,
    afterId,
    afterState: 0,
    ...extra,
  };
}

console.log('\n单条撤销与重做');
{
  const stack = new UndoStack();
  check('空栈不能撤销', !stack.canUndo);
  check('空栈不能重做', !stack.canRedo);
  equal('空栈撤销返回 null', stack.undo(), null);

  stack.push([edit(0, 0, 1)]);
  equal('一步入栈', stack.undoCount, 1);
  equal('上限默认 64', stack.maxSteps, DEFAULT_UNDO_LIMIT);

  const undone = stack.undo();
  equal('撤销方向', undone?.direction, 'undo');
  equal('撤销写回 before', undone?.edits[0]?.beforeId, 0);
  check('撤销后可以重做', stack.canRedo);
  equal('撤销后撤销栈空了', stack.undoCount, 0);

  const redone = stack.redo();
  equal('重做方向', redone?.direction, 'redo');
  equal('重做写回 after', redone?.edits[0]?.afterId, 1);
  equal('重做后回到撤销栈', stack.undoCount, 1);
  equal('重做栈空了', stack.redoCount, 0);
}

console.log('\n顺序（后进先出）');
{
  const stack = new UndoStack();
  stack.push([edit(0, 0, 1)]);
  stack.push([edit(1, 0, 1)]);
  equal('先撤最后一步', stack.undo()?.edits[0]?.x, 1);
  equal('再撤前一步', stack.undo()?.edits[0]?.x, 0);
  equal('没有更多可撤', stack.canUndo, false);
}

console.log('\n新动作清空重做栈');
{
  const stack = new UndoStack();
  stack.push([edit(0, 0, 1)]);
  stack.undo();
  equal('撤销后有一份重做', stack.redoCount, 1);
  stack.push([edit(1, 0, 2)]);
  equal('新动作之后重做作废', stack.redoCount, 0);
  check('不能重做', !stack.canRedo);
}

console.log('\n批量事务（一条 entry）');
{
  const stack = new UndoStack();
  stack.begin();
  stack.record(edit(0, 0, 1));
  stack.record(edit(1, 0, 1));
  stack.record(edit(2, 0, 1));
  stack.end();

  equal('三格只算一步', stack.undoCount, 1);
  const step = stack.undo();
  equal('一次吐出三格', step?.edits.length, 3);
  equal('三格都在', step?.edits.map((item) => item.x).sort().join(','), '0,1,2');

  const empty = new UndoStack();
  empty.begin();
  empty.end();
  equal('空事务不占步', empty.undoCount, 0);

  // 未闭合就撤销：先收口，别丢玩家刚做的动作
  const open = new UndoStack();
  open.begin();
  open.record(edit(0, 0, 1));
  const collected = open.undo();
  equal('未闭合事务先收口再撤销', collected?.edits[0]?.beforeId, 0);
  equal('收口后没有待撤', open.canUndo, false);
}

console.log('\n同一格的归并');
{
  const stack = new UndoStack();
  stack.begin();
  stack.record(edit(0, 0, 1));
  stack.record(edit(0, 1, 2));
  stack.end();

  const step = stack.undo();
  equal('同格只留一条', step?.edits.length, 1);
  equal('before 是第一次的', step?.edits[0]?.beforeId, 0);
  equal('after 是最后一次的', step?.edits[0]?.afterId, 2);

  const noop = new UndoStack();
  noop.begin();
  noop.record(edit(0, 0, 1));
  noop.record(edit(0, 1, 0));
  noop.end();
  equal('放了又拆不占一步', noop.undoCount, 0);

  const flat = new UndoStack();
  flat.push([edit(0, 1, 1)]);
  equal('没有变化的改动不入栈', flat.undoCount, 0);
}

console.log('\n维度与坐标');
{
  const stack = new UndoStack();
  stack.push([
    edit(0, 0, 1, { dimension: 'overworld' }),
    edit(0, 0, 2, { dimension: 'nether' }),
  ]);
  equal('不同维度的同坐标不合并', stack.undo()?.edits.length, 2);

  const stack2 = new UndoStack();
  stack2.push([edit(0, 0, 1, { y: 64 })]);
  stack2.push([edit(0, 0, 1, { y: 65 })]);
  equal('同 x/z 不同 y 是两格', stack2.undoCount, 2);
}

console.log('\n上限裁剪');
{
  const stack = new UndoStack(3);
  for (let i = 0; i < 5; i++) stack.push([edit(i, 0, i + 1)]);
  equal('只留最近 3 步', stack.undoCount, 3);
  equal('最先撤的是最后一次动作', stack.undo()?.edits[0]?.x, 4);
  equal('再撤一次', stack.undo()?.edits[0]?.x, 3);
  equal('再撤一次', stack.undo()?.edits[0]?.x, 2);
  equal('最旧的两步已经被丢掉', stack.canUndo, false);

  equal('上限 0 回落到 1', new UndoStack(0).maxSteps, 1);
  equal('上限 NaN 回落到默认', new UndoStack(Number.NaN).maxSteps, DEFAULT_UNDO_LIMIT);

  const one = new UndoStack(1);
  one.push([edit(0, 0, 1)]);
  one.push([edit(1, 0, 1)]);
  equal('上限 1 只留最后一步', one.undoCount, 1);
  equal('留的是最后一步', one.undo()?.edits[0]?.x, 1);
}

console.log('\n重做链');
{
  const stack = new UndoStack();
  stack.push([edit(0, 0, 1)]);
  stack.push([edit(1, 0, 1)]);
  stack.undo();
  stack.undo();
  equal('两次撤销攒了两份重做', stack.redoCount, 2);
  stack.redo();
  equal('重做一步后还剩一份（没有被清空）', stack.redoCount, 1);
  stack.redo();
  equal('重做到底', stack.redoCount, 0);
  equal('全部回到撤销栈', stack.undoCount, 2);

  stack.clear();
  equal('clear 清空撤销栈', stack.undoCount, 0);
  equal('clear 清空重做栈', stack.redoCount, 0);
  check('clear 后不能撤销', !stack.canUndo);
}

console.log('\n主程序接线（静态断言）');
{
  // 守的是"纯逻辑写好了但没接上"：栈本身 48 条全绿也可能一次都没被调用过
  const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  check('撤销只在创造 + 单机可用', mainSrc.includes('return this.isCreative && !this.net.connected;'));
  check('放置接入了撤销（一次动作一步）', mainSrc.includes('this.undoPush('));
  check(
    '单块破坏接入了撤销',
    mainSrc.includes('this.undoRecord(this.hit.x, this.hit.y, this.hit.z'),
  );
  check('门/旗/床/柱用事务合成一步', mainSrc.includes('this.undoBegin();') && mainSrc.includes('this.undoEnd();'));
  check('切维度会清空撤销栈', mainSrc.includes('this.undoStack.clear();'));
  check('Ctrl+Z 接线', mainSrc.includes("e.code === 'KeyZ'"));
  check('Ctrl+Y 接线', mainSrc.includes("e.code === 'KeyY'"));
  check('没有可撤销时给提示', mainSrc.includes("t('buildtools.undo.empty')"));
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
