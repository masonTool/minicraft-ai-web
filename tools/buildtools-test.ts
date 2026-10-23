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
import {
  PASTE_BATCH_SIZE,
  PasteRunner,
  createSnapshot,
  defaultPasteTarget,
  mirrorCell,
  planPaste,
  snapshotCellCount,
  type ClipboardSnapshot,
} from '../src/buildtools/Clipboard.ts';
import {
  TEMPLATES,
  checkTemplatePlacement,
  templateById,
  templateCells,
  validateTemplate,
  type BuildTemplate,
} from '../src/buildtools/templates.ts';
import {
  BUILD_BUTTON_SIZE,
  buildCellSize,
  buildDrawerBox,
  buildDrawerSize,
  buildToggleBox,
  drawerFits,
  pauseBarBottom,
  toggleOverlapsPauseBar,
} from '../src/ui/buildToolbarLayout.ts';

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

// ------------------------------------------------------------------ 建筑模板

console.log('\n建筑模板：数据自检');
{
  equal('内置 4 个模板', TEMPLATES.length, 4);
  equal('id 不重复', new Set(TEMPLATES.map((item) => item.id)).size, TEMPLATES.length);

  for (const template of TEMPLATES) {
    equal(`${template.id} 坐标自检通过`, validateTemplate(template).join('; '), '');
    check(`${template.id} 至少 10 格`, template.blocks.length >= 10, `实际 ${template.blocks.length}`);
    check(`${template.id} 有名字键`, template.nameKey.startsWith('template.'));
  }

  const broken: BuildTemplate = {
    id: 'bad',
    nameKey: 'template.bad',
    width: 2,
    height: 2,
    depth: 2,
    blocks: [{ dx: 2, dy: 0, dz: 0, id: 1 }],
    requiresSupport: false,
  };
  check('越界坐标会被抓住', validateTemplate(broken).some((item) => item.includes('dx 越界')));

  const duplicated: BuildTemplate = {
    id: 'dup',
    nameKey: 'template.dup',
    width: 2,
    height: 2,
    depth: 2,
    blocks: [
      { dx: 0, dy: 0, dz: 0, id: 1 },
      { dx: 0, dy: 0, dz: 0, id: 2 },
    ],
    requiresSupport: false,
  };
  check('重复坐标会被抓住', validateTemplate(duplicated).some((item) => item.includes('重复')));

  equal('按 id 找得到小屋', templateById('small_house')?.id, 'small_house');
  equal('找不到的 id 返回 null', templateById('nope'), null);
}

console.log('\n建筑模板：落位检查');
{
  const house = templateById('small_house')!;
  // 一张 y=63 的地面，其余是空气
  const world = new Map<string, number>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  for (let x = -10; x <= 20; x++) {
    for (let z = -10; z <= 20; z++) world.set(key(x, 63, z), 1);
  }
  const read = (x: number, y: number, z: number): number => world.get(key(x, y, z)) ?? 0;
  const isSolid = (id: number): boolean => id !== 0 && id !== 10;

  const ok = checkTemplatePlacement(house, { x: 0, y: 64, z: 0 }, read, { isSolid });
  equal('空地上放得下', ok.ok, true);
  equal('没有挡路', ok.blocked, 0);
  equal('没有悬空', ok.unsupported, 0);

  // 挡路：在墙角预放一块石头
  world.set(key(0, 65, 0), 1);
  const blocked = checkTemplatePlacement(house, { x: 0, y: 64, z: 0 }, read, { isSolid });
  equal('有方块挡着：拒绝', blocked.ok, false);
  equal('理由 blocked', blocked.reason, 'blocked');
  equal('数出被挡的格数', blocked.blocked, 1);
  world.delete(key(0, 65, 0));

  // 悬空：抬到空中
  const floating = checkTemplatePlacement(house, { x: 0, y: 100, z: 0 }, read, { isSolid });
  equal('半空中放房子：拒绝', floating.ok, false);
  equal('理由 unsupported', floating.reason, 'unsupported');
  equal('底层 25 格都悬空', floating.unsupported, 25);

  // 越界：屋顶顶到世界之上
  const tooHigh = checkTemplatePlacement(house, { x: 0, y: 318, z: 0 }, read, { isSolid });
  equal('超出世界高度：拒绝', tooHigh.ok, false);
  equal('理由 outOfWorld', tooHigh.reason, 'outOfWorld');
  check('数出越界的层', tooHigh.outOfWorld > 0);

  // 桥是悬空的：不查支撑
  const bridge = templateById('small_bridge')!;
  const bridgeCheck = checkTemplatePlacement(bridge, { x: 0, y: 100, z: 0 }, read, { isSolid });
  equal('桥在半空中也放得下（本来就不需要支撑）', bridgeCheck.ok, true);
  equal('桥的悬空计数为 0', bridgeCheck.unsupported, 0);

  // 水不算支撑：把地面换成水
  const waterWorld = new Map<string, number>();
  for (let x = -10; x <= 20; x++) {
    for (let z = -10; z <= 20; z++) waterWorld.set(key(x, 63, z), 10);
  }
  const waterRead = (x: number, y: number, z: number): number => waterWorld.get(key(x, y, z)) ?? 0;
  const onWater = checkTemplatePlacement(house, { x: 0, y: 64, z: 0 }, waterRead, { isSolid });
  equal('水面上放房子：拒绝（水不是支撑）', onWater.ok, false);
  equal('理由 unsupported', onWater.reason, 'unsupported');
}

console.log('\n建筑模板：格子映射');
{
  const house = templateById('small_house')!;
  const cells = templateCells(house, { x: 10, y: 64, z: 10 });
  equal('格数等于模板方块数', cells.length, house.blocks.length);

  const occupied = new Set(cells.map((cell) => `${cell.x},${cell.y},${cell.z}`));
  check('正面门洞留空（y=1）', !occupied.has('12,65,10'));
  check('正面门洞留空（y=2）', !occupied.has('12,66,10'));
  check('地板铺满', occupied.has('10,64,10') && occupied.has('14,64,14'));
  check('屋顶铺满', occupied.has('10,67,10') && occupied.has('14,67,14'));
  check('窗户是玻璃', cells.some((cell) => cell.x === 10 && cell.y === 66 && cell.z === 12 && cell.id === 11));

  const tower = templateById('stone_tower')!;
  const towerCells = templateCells(tower, { x: 0, y: 0, z: 0 });
  check('塔内部中空', !towerCells.some((cell) => cell.x === 1 && cell.z === 1 && cell.y > 0 && cell.y < 6));
  check('塔正面有门洞', !towerCells.some((cell) => cell.x === 1 && cell.y === 1 && cell.z === 0));
  check('塔顶封住', towerCells.some((cell) => cell.x === 1 && cell.y === 6 && cell.z === 1));
}

// ------------------------------------------------------------------ 剪贴板

console.log('\n复制：快照只存非空气');
{
  const storage = new Map<string, { id: number; state: number }>();
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  storage.set(key(2, 64, 2), { id: 1, state: 0 });
  storage.set(key(2, 65, 2), { id: 45, state: 2 });
  storage.set(key(2, 66, 2), { id: 1, state: 0 });

  const box: SelectionBox = { minX: 2, minY: 64, minZ: 2, maxX: 4, maxY: 66, maxZ: 4 };
  const snap = createSnapshot(box, (x, y, z) => storage.get(key(x, y, z)) ?? null);

  equal('尺寸 3×3×3', `${snap.width}×${snap.height}×${snap.depth}`, '3×3×3');
  equal('只存了 3 格非空气', snapshotCellCount(snap), 3);
  equal('有空洞标 masked', snap.masked, true);
  equal('锚点是盒子最小角', `${snap.origin.x},${snap.origin.y},${snap.origin.z}`, '2,64,2');
  equal('第一格偏移 0,1,0 之前先是最小角', `${snap.cells[0]!.dx},${snap.cells[0]!.dy},${snap.cells[0]!.dz}`, '0,0,0');
  equal('第二格往上偏移 1', snap.cells[1]!.dy, 1);
  equal('方块 id 原样带过来', snap.cells[1]!.id, 45);
  equal('状态也带过来', snap.cells[1]!.state, 2);

  const restored = snap.cells
    .map((cell) => `${cell.dx + snap.origin.x},${cell.dy + snap.origin.y},${cell.dz + snap.origin.z}`)
    .sort();
  equal('快照往返坐标一致', restored.join('|'), [...storage.keys()].sort().join('|'));

  const full = new Map<string, { id: number; state: number }>();
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      for (let z = 0; z < 2; z++) full.set(key(x, y, z), { id: 1, state: 0 });
    }
  }
  const fullSnap = createSnapshot(
    { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    (x, y, z) => full.get(key(x, y, z)) ?? null,
  );
  equal('满区域 8 格', snapshotCellCount(fullSnap), 8);
  equal('满区域不标 masked', fullSnap.masked, false);

  const emptySnap = createSnapshot(box, () => null);
  equal('全空快照 0 格', snapshotCellCount(emptySnap), 0);
  equal('全空也标 masked', emptySnap.masked, true);
}

console.log('\n镜像：只翻偏移');
{
  // 一个 3×1×3 的"两边墙"：x=0 与 x=2
  const shape = createSnapshot(
    { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 0, maxZ: 2 },
    (x, _y, _z) => (x === 0 || x === 2 ? { id: 5, state: 0 } : null),
  );
  const left = shape.cells.find((cell) => cell.dx === 0)!;
  const right = shape.cells.find((cell) => cell.dx === 2)!;

  equal('X 镜像：左墙挪到右边', mirrorCell(left, shape, 'x').dx, 2);
  equal('X 镜像：右墙挪到左边', mirrorCell(right, shape, 'x').dx, 0);
  equal('X 镜像：方块不变', mirrorCell(left, shape, 'x').id, 5);
  equal('镜像两次回到原样', mirrorCell(mirrorCell(left, shape, 'x'), shape, 'x').dx, 0);

  const front = shape.cells.find((cell) => cell.dz === 0)!;
  equal('Z 镜像：前后对调', mirrorCell(front, shape, 'z').dz, 2);
  equal('Z 镜像不碰 x', mirrorCell(front, shape, 'z').dx, front.dx);
}

console.log('\n粘贴：落点与越界裁剪');
{
  const shape = createSnapshot(
    { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 0, maxZ: 2 },
    (x, _y, _z) => (x === 0 || x === 2 ? { id: 5, state: 0 } : null),
  );

  const plain = planPaste(shape, { x: 10, y: 64, z: 10 });
  equal('粘贴格数不变', plain.cells.length, shape.cells.length);
  equal('没裁剪', plain.clamped, false);
  check(
    '每个格子都落在目标偏移上',
    plain.cells.every((cell) => cell.x >= 10 && cell.x <= 12 && cell.z >= 10 && cell.z <= 12),
  );
  equal('默认落点在原件右边一格宽', defaultPasteTarget(shape).x, 3);

  const mirrored = planPaste(shape, { x: 10, y: 64, z: 10 }, { mirror: 'x' });
  const leftWall = mirrored.cells.filter((cell) => cell.x === 12).length;
  equal('镜像后左墙贴到最右边', leftWall, 3);

  // 一列 3 格，贴着世界顶粘贴：只贴进 2 格
  const column = createSnapshot(
    { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 2, maxZ: 0 },
    () => ({ id: 1, state: 0 }),
  );
  const clipped = planPaste(column, { x: 0, y: 318, z: 0 });
  equal('只贴世界内的两层', clipped.cells.length, 2);
  equal('裁掉 1 格', clipped.skipped, 1);
  equal('标了 clamped', clipped.clamped, true);
  equal('贴到的是 318/319', clipped.cells.map((cell) => cell.y).join(','), '318,319');

  const allOut = planPaste(column, { x: 0, y: 500, z: 0 });
  equal('全部越界：0 格', allOut.cells.length, 0);
  equal('全部越界：skipped 3', allOut.skipped, 3);

  const empty = planPaste(createSnapshot({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }, () => null), { x: 0, y: 0, z: 0 });
  equal('空快照粘贴 0 格', empty.cells.length, 0);
  equal('空快照不算裁剪', empty.clamped, false);
}

console.log('\n粘贴：跨帧推进与中断');
{
  const solid = createSnapshot(
    { minX: 0, minY: 0, minZ: 0, maxX: 15, maxY: 3, maxZ: 15 },
    () => ({ id: 1, state: 0 }),
  );
  const plan = planPaste(solid, { x: 0, y: 0, z: 0 });
  equal('1024 格待贴', plan.cells.length, 1024);

  let writes = 0;
  const runner = new PasteRunner(plan.cells, {
    write: () => {
      writes += 1;
      return true;
    },
  });
  equal('第一次 step 写一批', runner.step(), true);
  equal('一批 512', writes, 512);
  equal('第二次 step 写完', runner.step(), false);
  equal('总共 1024', writes, 1024);
  equal('total 1024', runner.progress.total, 1024);

  let budgetWrites = 0;
  const budgeted = new PasteRunner(plan.cells, {
    write: () => {
      budgetWrites += 1;
      return true;
    },
  });
  for (let i = 0; i < 10; i++) budgeted.step(100);
  equal('每帧 100 格，10 帧写 1000', budgetWrites, 1000);
  equal('第 11 帧收尾', budgeted.step(100), false);
  equal('总共 1024', budgetWrites, 1024);

  let partial = 0;
  const cancellable = new PasteRunner(plan.cells, {
    write: () => {
      partial += 1;
      return true;
    },
  });
  cancellable.step(100);
  cancellable.cancel();
  equal('中断后 step 返回 false', cancellable.step(), false);
  equal('中断后不再写', partial, 100);
  equal('已写的进度保留', cancellable.progress.written, 100);

  let skipCount = 0;
  const skipping = new PasteRunner(plan.cells, {
    batchSize: 1024,
    write: () => {
      skipCount += 1;
      return skipCount % 2 === 0;
    },
  });
  skipping.step();
  equal('visited 是全部', skipping.progress.visited, 1024);
  equal('written 只有一半', skipping.progress.written, 512);

  equal('默认批量 512', PASTE_BATCH_SIZE, 512);
}

console.log('\n复制一座小房并镜像（假世界）');
{
  // 5×3×5 的房子：四面墙，内部中空
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const house = new Map<string, number>();
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 3; y++) {
      for (let z = 0; z < 5; z++) {
        if (x === 0 || x === 4 || z === 0 || z === 4) house.set(key(x, 64 + y, z), 5);
      }
    }
  }
  const box: SelectionBox = { minX: 0, minY: 64, minZ: 0, maxX: 4, maxY: 66, maxZ: 4 };
  const snapshot: ClipboardSnapshot = createSnapshot(box, (x, y, z) =>
    house.has(key(x, y, z)) ? { id: 5, state: 0 } : null,
  );
  equal('墙共 48 格', snapshotCellCount(snapshot), 48);
  equal('中空 27 格被标 masked', snapshot.masked, true);

  // 镜像后贴到另一个位置
  const plan = planPaste(snapshot, { x: 20, y: 64, z: 20 }, { mirror: 'x' });
  const mirroredHouse = new Map<string, number>();
  const runner = new PasteRunner(plan.cells, {
    write: (cell) => {
      mirroredHouse.set(key(cell.x, cell.y, cell.z), cell.id);
      return true;
    },
  });
  while (runner.step()) {
    // 每帧一批
  }
  equal('贴进 48 格', runner.progress.written, 48);

  // 镜像后：原来的左墙（dx=0）跑到 x=24，右墙（dx=4）跑到 x=20
  equal('镜像后的左墙在 x=24', [...mirroredHouse.keys()].filter((k) => k.startsWith('24,')).length, 15);
  equal('镜像后的右墙在 x=20', [...mirroredHouse.keys()].filter((k) => k.startsWith('20,')).length, 15);

  // 中空的部分不该被填上（复制的是墙，不是一整块实心）
  let filledInside = 0;
  for (let x = 21; x <= 23; x++) {
    for (let y = 64; y <= 66; y++) {
      for (let z = 21; z <= 23; z++) {
        if (mirroredHouse.has(key(x, y, z))) filledInside += 1;
      }
    }
  }
  equal('内部仍然中空', filledInside, 0);
}

// ------------------------------------------------------------------ 工具条几何

console.log('\n建造工具条几何（抽屉不出界 / 不压暂停条 / 热区 ≥44）');
{
  check('格子热区下限不小于 44px（平台下限）', BUILD_BUTTON_SIZE >= 44);

  // ---- 基准尺寸：360×196 是"4 列 × 2 行 + 头部 + 内边距"算出来的，不是拍的
  const base = buildDrawerSize(1);
  equal('基准抽屉宽 = 4×84 + 3×4 + 2×6', base.width, 360);
  equal('基准抽屉高 = 2×68 + 3×4 + 头部 40 + 2×6', base.height, 196);
  equal('暂停条下沿 = 8 + 22×1', pauseBarBottom(1), 30);
  equal('暂停条下沿 @1.4x = 8 + 22×1.4', pauseBarBottom(1.4), 39);

  // ---- 折叠态总开关：贴右缘 8px、垂直居中、含 9px 标签后 56 高
  const toggle = buildToggleBox(844, 390);
  equal('844×390 开关右边界 836', toggle.right, 836);
  equal('844×390 开关左边界 792', toggle.left, 792);
  equal('844×390 开关顶边 167（垂直居中）', toggle.top, 167);
  equal('开关高 56（44 图标 + 标签行）', toggle.height, 56);
  check('844×390 开关不压顶部暂停三键', !toggleOverlapsPauseBar(toggle, 844));
  check('640×360 开关也不压暂停三键', !toggleOverlapsPauseBar(buildToggleBox(640, 360), 640));

  // ---- 抽屉：五种视口 × 三种触摸缩放，逐个量四边、暂停条、格子下限
  const viewports: Array<[string, number, number]> = [
    ['844×390 主力横屏', 844, 390],
    ['640×360 小横屏', 640, 360],
    ['932×430 横屏', 932, 430],
    ['430×932 竖屏', 430, 932],
    ['320×480 窄竖屏', 320, 480],
  ];
  for (const [label, width, height] of viewports) {
    for (const scale of [0.8, 1, 1.4]) {
      const box = buildDrawerBox(width, height, scale);
      const cell = buildCellSize(width, height, scale);
      check(
        `${label} @${scale}x：四边不出界`,
        box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height,
        `left ${box.left} top ${box.top} right ${box.right} bottom ${box.bottom}`,
      );
      check(
        `${label} @${scale}x：顶边不压顶部暂停条`,
        box.top >= pauseBarBottom(scale),
        `top ${box.top} < ${pauseBarBottom(scale)}`,
      );
      check(
        `${label} @${scale}x：格子热区 ≥44`,
        cell.width >= BUILD_BUTTON_SIZE && cell.height >= BUILD_BUTTON_SIZE,
        `${cell.width}×${cell.height}`,
      );
    }
  }

  // ---- 844×390 @1x 的具体落点（旧的"左 744 / 顶 77"口径已随形态变化失效）
  const main = buildDrawerBox(844, 390);
  equal('844×390 抽屉宽 360', main.width, 360);
  equal('844×390 左边界 242（水平居中）', main.left, 242);
  equal('844×390 顶边 97（垂直居中）', main.top, 97);
  equal('844×390 底边 293（在快捷栏之上）', main.bottom, 293);

  const mainCell = buildCellSize(844, 390);
  equal('844×390 格子宽 84（上限）', mainCell.width, 84);
  equal('844×390 格子高 68（上限）', mainCell.height, 68);

  // ---- 装不下时压小而不是越界：格子先缩，缩到 44 还不行就交给 drawerFits 判 false
  const cramped = buildDrawerBox(320, 480);
  equal('320×480 抽屉压到 304 宽（视口 − 2×8）', cramped.width, 304);
  const crampedCell = buildCellSize(320, 480);
  check('压小后格子仍 ≥44', crampedCell.width >= 44 && crampedCell.height >= 44);

  check('844×390 能完整装下', drawerFits(844, 390));
  check('640×360 @1.4x 也能完整装下', drawerFits(640, 360, 1.4));
  check('320×240 装不下（宽度不足 360）', !drawerFits(320, 240));
  check('844×200 装不下（高度不足，暂停条之下只剩 162）', !drawerFits(844, 200));
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

  // 创造3：复制 / 粘贴 / 镜像
  check('复制走 createSnapshot（只存非空气）', mainSrc.includes('createSnapshot(this.selectionBox'));
  check('粘贴走 planPaste（带镜像轴）', mainSrc.includes('planPaste(snapshot, landing, { mirror })'));
  check('粘贴在主循环里每帧推进', mainSrc.includes('this.stepPasteRunner();'));
  check('粘贴整体入撤销栈（一次粘贴 = 一步）', mainSrc.includes('this.pasteUndoBuffer'));
  check('默认落点在原件旁边', mainSrc.includes('defaultPasteTarget(snapshot)'));
  check('粘贴超过上限整次不记', mainSrc.includes('this.pasteUndoBuffer.length >= FILL_UNDO_LIMIT'));

  // 创造4：建筑模板
  check('落位前跑 checkTemplatePlacement', mainSrc.includes('checkTemplatePlacement(template, landing'));
  check('模板转成格子走 templateCells', mainSrc.includes('templateCells(template, landing)'));
  check('模板与粘贴共用 startPasteCells', mainSrc.includes('this.startPasteCells(templateCells('));
  check('放不下时按原因提示', mainSrc.includes("t(`buildtools.template.${check.reason"));

  // 创造5：工具条与输入互斥
  check('工具条接进主程序', mainSrc.includes('new BuildToolbar(document.body'));
  check('建造模式下左键改发一次性请求', mainSrc.includes('if (this.buildMode) this.buildRequest = true;'));
  check('建造模式下不攻击', mainSrc.includes('if (this.buildMode) return;'));
  check('建造模式下左键改成选区角', mainSrc.includes('this.selectCorner({ x: this.hit.x, y: this.hit.y, z: this.hit.z })'));
  check('工具条按创造模式显隐', mainSrc.includes('this.buildToolbar.setAvailable(this.isCreative)'));
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
