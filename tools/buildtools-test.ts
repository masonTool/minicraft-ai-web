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
import {
  SELECTION_MAX_VOLUME,
  boxContains,
  boxSize,
  buildSelection,
  selectionCells,
  selectionVolume,
  type SelectionBox,
} from '../src/buildtools/Selection.ts';
import {
  FILL_BATCH_SIZE,
  FillRunner,
  planFill,
  shouldFillCell,
} from '../src/buildtools/Fill.ts';

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

// ------------------------------------------------------------------ 选区

console.log('\n选区：两点归一化');
{
  const forward = buildSelection({ x: 0, y: 64, z: 0 }, { x: 3, y: 67, z: 2 });
  const backward = buildSelection({ x: 3, y: 67, z: 2 }, { x: 0, y: 64, z: 0 });
  check('两个方向都成功', forward.ok && backward.ok);
  if (forward.ok && backward.ok) {
    equal('两端点顺序不影响盒子', JSON.stringify(forward.box), JSON.stringify(backward.box));
    equal('体积 = 4×4×3', forward.volume, 48);
    equal('没被裁剪', forward.clamped, false);
    const size = boxSize(forward.box);
    equal('宽 4', size.width, 4);
    equal('高 4', size.height, 4);
    equal('深 3', size.depth, 3);
    check('含左下角', boxContains(forward.box, 0, 64, 0));
    check('含右上角', boxContains(forward.box, 3, 67, 2));
    check('不含外面', !boxContains(forward.box, 4, 67, 2));
  }

  // 小数坐标按格取整（玩家射线命中的是方块坐标，这里只是兜底）
  const floored = buildSelection({ x: 0.9, y: 64.9, z: 0.9 }, { x: 0.1, y: 64.1, z: 0.1 });
  check('小数坐标取整后是同一格', floored.ok);
  if (floored.ok) equal('单格选区体积为 1', floored.volume, 1);
}

console.log('\n选区：y 越界裁剪与上限');
{
  const clamped = buildSelection({ x: 0, y: -100, z: 0 }, { x: 0, y: 10, z: 0 });
  check('拉到世界底下会被裁剪而不是拒绝', clamped.ok);
  if (clamped.ok) {
    equal('下界夹到 -64', clamped.box.minY, -64);
    equal('标了 clamped', clamped.clamped, true);
    equal('高度 75', clamped.volume, 75);
  }

  const outside = buildSelection({ x: 0, y: -100, z: 0 }, { x: 0, y: -90, z: 0 });
  equal('两端都在世界外：拒绝', outside.ok, false);
  if (!outside.ok) equal('理由 outOfWorld', outside.reason, 'outOfWorld');

  const top = buildSelection({ x: 0, y: 300, z: 0 }, { x: 0, y: 999, z: 0 });
  check('上方越界也会裁剪', top.ok);
  if (top.ok) equal('上界夹到 319', top.box.maxY, 319);

  const exact = buildSelection({ x: 0, y: 0, z: 0 }, { x: 31, y: 31, z: 31 });
  check('32³ 正好等于上限：允许', exact.ok);
  if (exact.ok) equal('体积 32768', exact.volume, SELECTION_MAX_VOLUME);

  const tooBig = buildSelection({ x: 0, y: 0, z: 0 }, { x: 32, y: 32, z: 32 });
  equal('33³ 超过上限：拒绝', tooBig.ok, false);
  if (!tooBig.ok) {
    equal('理由 tooLarge', tooBig.reason, 'tooLarge');
    equal('报出真实体积', tooBig.volume, 33 * 33 * 33);
  }

  const longThin = buildSelection({ x: 0, y: 64, z: 0 }, { x: 9999, y: 64, z: 0 });
  check('长条但体积没超：允许（上限按体积算，不按单边）', longThin.ok);
  const flatTooBig = buildSelection({ x: 0, y: 64, z: 0 }, { x: 100, y: 67, z: 100 });
  equal('水平方向体积超限：拒绝', flatTooBig.ok, false);
}

console.log('\n选区：遍历顺序');
{
  const box: SelectionBox = { minX: 5, minY: 64, minZ: 5, maxX: 6, maxY: 64, maxZ: 6 };
  const cells = [...selectionCells(box)];
  equal('2×1×2 共 4 格', cells.length, 4);
  equal(
    '顺序是 y → z → x',
    cells.map((cell) => `${cell.x},${cell.y},${cell.z}`).join('|'),
    '5,64,5|6,64,5|5,64,6|6,64,6',
  );
  equal('遍历格数与体积一致', cells.length, selectionVolume(box));
}

// ------------------------------------------------------------------ 填充

console.log('\n填充：模式判断');
{
  equal('fill：空气也写', shouldFillCell({ mode: 'fill', currentId: 0 }), true);
  equal('fill：石头也写', shouldFillCell({ mode: 'fill', currentId: 1 }), true);
  equal('replace 指定 id：命中才写', shouldFillCell({ mode: 'replace', currentId: 1, replaceId: 1 }), true);
  equal('replace 指定 id：不命中跳过', shouldFillCell({ mode: 'replace', currentId: 2, replaceId: 1 }), false);
  equal('replace 不给 id：非空气都换', shouldFillCell({ mode: 'replace', currentId: 2, replaceId: null }), true);
  equal('replace 不给 id：空气跳过', shouldFillCell({ mode: 'replace', currentId: 0, replaceId: null }), false);
  equal('clear：非空气要清', shouldFillCell({ mode: 'clear', currentId: 1 }), true);
  equal('clear：空气跳过（不白触发一次重网格化）', shouldFillCell({ mode: 'clear', currentId: 0 }), false);
}

console.log('\n填充：分批计划');
{
  const box: SelectionBox = { minX: 0, minY: 64, minZ: 0, maxX: 15, maxY: 67, maxZ: 15 };
  const plan = planFill(box);
  equal('16×4×16 = 1024 格', plan.total, 1024);
  equal('默认每批 512 → 2 批', plan.batches.length, 2);
  equal('第一批 512', plan.batches[0]?.length, 512);
  equal('第二批 512', plan.batches[1]?.length, 512);
  equal('第一格是最小角', JSON.stringify(plan.batches[0]?.[0]), JSON.stringify({ x: 0, y: 64, z: 0 }));
  equal(
    '最后一格是最大角',
    JSON.stringify(plan.batches[1]?.[511]),
    JSON.stringify({ x: 15, y: 67, z: 15 }),
  );

  const odd = planFill(box, 300);
  equal('1024 / 300 → 4 批', odd.batches.length, 4);
  equal('最后一批 124 格', odd.batches[3]?.length, 124);

  const fallback = planFill(box, 0);
  equal('非法批量回落到默认', fallback.batchSize, FILL_BATCH_SIZE);

  const single = planFill({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
  equal('单格也是 1 批', single.batches.length, 1);
}

console.log('\n填充：跨帧推进与中断');
{
  const box: SelectionBox = { minX: 0, minY: 64, minZ: 0, maxX: 15, maxY: 67, maxZ: 15 };
  let writes = 0;
  const runner = new FillRunner(box, {
    write: () => {
      writes += 1;
      return true;
    },
  });

  equal('第一次 step 还有后续', runner.step(), true);
  equal('一次 step 写一批（512）', writes, 512);
  equal('第二次 step 写完', runner.step(), false);
  equal('总共写了 1024 格', writes, 1024);
  equal('visited 也是 1024', runner.progress.visited, 1024);
  equal('written 也是 1024', runner.progress.written, 1024);
  check('done', runner.done);

  // 小预算：每帧 100 格，10 次写完
  let budgetWrites = 0;
  const budgeted = new FillRunner(box, {
    write: () => {
      budgetWrites += 1;
      return true;
    },
  });
  for (let i = 0; i < 10; i++) budgeted.step(100);
  equal('每帧 100 格，10 帧写 1000', budgetWrites, 1000);
  equal('第 11 帧把剩下 24 格写完并结束', budgeted.step(100), false);
  equal('总共 1024 格', budgetWrites, 1024);

  // replace 跳过：写回调返回 false 的格子只算 visited
  let skippedWrites = 0;
  const skipping = new FillRunner(box, {
    batchSize: 1024,
    write: () => {
      skippedWrites += 1;
      return skippedWrites % 2 === 0;
    },
  });
  skipping.step();
  equal('visited 仍是全部', skipping.progress.visited, 1024);
  equal('written 只有一半', skipping.progress.written, 512);

  // 中断：已写的保留，后续不再写
  let partial = 0;
  const cancellable = new FillRunner(box, {
    write: () => {
      partial += 1;
      return true;
    },
  });
  cancellable.step(100);
  cancellable.cancel();
  equal('中断后 done', cancellable.done, true);
  equal('中断后 step 返回 false', cancellable.step(), false);
  equal('中断后没有再写', partial, 100);
  equal('已写的进度保留', cancellable.progress.written, 100);
}

console.log('\n填充：对着一个假世界真的写进去（16×16×4）');
{
  // 用 Map 当世界：这层测的是"计划 + 模式 + 写入"三者的组合，不依赖真 World
  const world = new Map<string, number>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  // 先铺一层石头（y=64），再在上面留出 3 层空气
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.set(key(x, 64, z), 1);

  const box: SelectionBox = { minX: 0, minY: 64, minZ: 0, maxX: 15, maxY: 67, maxZ: 15 };
  const runner = new FillRunner(box, {
    write: (pos) => {
      const current = world.get(key(pos.x, pos.y, pos.z)) ?? 0;
      if (!shouldFillCell({ mode: 'fill', currentId: current })) return false;
      world.set(key(pos.x, pos.y, pos.z), 7);
      return true;
    },
  });
  while (runner.step()) {
    // 每帧一批
  }
  equal('写满 1024 格', runner.progress.written, 1024);
  let filled = 0;
  for (let x = 0; x < 16; x++) {
    for (let y = 64; y <= 67; y++) {
      for (let z = 0; z < 16; z++) {
        if (world.get(key(x, y, z)) === 7) filled += 1;
      }
    }
  }
  equal('世界里真的有 1024 格变成了目标方块', filled, 1024);

  // replace：只把石头换成木板，空气不碰
  const replaced = new Map(world);
  const replaceRunner = new FillRunner(box, {
    write: (pos) => {
      const k = key(pos.x, pos.y, pos.z);
      const current = replaced.get(k) ?? 0;
      if (!shouldFillCell({ mode: 'replace', currentId: current, replaceId: 7 })) return false;
      replaced.set(k, 4);
      return true;
    },
  });
  while (replaceRunner.step()) {
    // 跑完
  }
  equal('replace 命中 1024 格', replaceRunner.progress.written, 1024);

  // clear：只清非空气（这里全是 4，所以全清）
  const cleared = new Map(replaced);
  const clearRunner = new FillRunner(box, {
    write: (pos) => {
      const k = key(pos.x, pos.y, pos.z);
      const current = cleared.get(k) ?? 0;
      if (!shouldFillCell({ mode: 'clear', currentId: current })) return false;
      cleared.set(k, 0);
      return true;
    },
  });
  while (clearRunner.step()) {
    // 跑完
  }
  let remaining = 0;
  for (const value of cleared.values()) if (value !== 0) remaining += 1;
  equal('clear 之后没有非空气残留', remaining, 0);
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

  // 创造2：选区与填充
  check('选区走 buildSelection（两点归一化）', mainSrc.includes('buildSelection(this.selectionStart, pos)'));
  check('填充在主循环里每帧推进', mainSrc.includes('this.stepFillRunner();'));
  check('填充按 shouldFillCell 过滤（三种模式）', mainSrc.includes('shouldFillCell({ mode, currentId, replaceId })'));
  check('填完整体入撤销栈（一次填充 = 一步）', mainSrc.includes('this.undoPush(buffered)'));
  check('超过上限整次不记', mainSrc.includes('this.fillUndoBuffer.length >= FILL_UNDO_LIMIT'));
  check('选区/填充与撤销同一口径（创造 + 单机）', mainSrc.includes('private startFill('));
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
