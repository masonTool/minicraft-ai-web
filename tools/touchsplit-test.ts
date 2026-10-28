/**
 * 触摸端"长按选数量"离线测试（批次 137）
 *
 * 规则在 `core/container/TouchSplit.ts` 里（纯逻辑），界面只交像素。
 * 参照物：`references/物品栏 - 中文 Minecraft Wiki.mhtml`「触摸操作 [仅基岩版]」原文——
 * **一开始选半数（向上取整）、向左划减少（至少 1 个）、向右划增加（直至全部）**。
 *
 * 这几条都属于"写差一点也没人报 bug"的那一类：差一格、少一个、划到头不回弹，
 * 玩家只会觉得"手滑"。所以这里逐条钉住。
 *
 * 运行：npm run test:touchsplit
 */

import {
  SPLIT_DRAG_SPAN_CELLS,
  SPLIT_MIN_TOTAL,
  canSplitStack,
  initialSplitCount,
  splitCountForDrag,
  splitFraction,
  splitStack,
} from '../web/src/core/container/TouchSplit.ts';
import type { ItemStack } from '../web/src/core/container/Inventory.ts';

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

const CELL = 42;

// ---------------------------------------------------------------- 1. 什么格子能选数量

console.log('\n[能不能选数量：空格 / 1 个 / 手上拿着东西都不走这一支]');
{
  equal('门槛是 2 个', SPLIT_MIN_TOTAL, 2);
  check('空格不能选', !canSplitStack(null, false));
  check('只有 1 个不能选（选一半与选全部是同一个数）', !canSplitStack({ id: 1, count: 1 }, false));
  check('2 个可以选', canSplitStack({ id: 1, count: 2 }, false));
  check('一整叠可以选', canSplitStack({ id: 1, count: 64 }, false));
  check('手上拿着东西时不走这一支（那是"连续放一个"）', !canSplitStack({ id: 1, count: 64 }, true));
}

// ---------------------------------------------------------------- 2. 初始数量

console.log('\n[初始选中数量：半数向上取整]');
{
  equal('64 → 32', initialSplitCount(64), 32);
  equal('32 → 16', initialSplitCount(32), 16);
  equal('65 → 33（向上取整）', initialSplitCount(65), 33);
  equal('3 → 2', initialSplitCount(3), 2);
  equal('2 → 1', initialSplitCount(2), 1);
  equal('1 → 1（不越界）', initialSplitCount(1), 1);
  equal('0 → 0', initialSplitCount(0), 0);
  equal('负数 → 0（防御）', initialSplitCount(-5), 0);
  equal('16 个的那一叠（末影珍珠）→ 8', initialSplitCount(16), 8);
}

// ---------------------------------------------------------------- 3. 划动映射

console.log('\n[左右划：一格宽度刚好走到两端]');
{
  const total = 64;
  const start = initialSplitCount(total); // 32
  equal('没动 → 还是半数', splitCountForDrag(total, start, 0, CELL), 32);
  equal(
    '向右划满一格宽度 → 全部',
    splitCountForDrag(total, start, CELL * SPLIT_DRAG_SPAN_CELLS, CELL),
    total,
  );
  equal(
    '向左划满一格宽度 → 减到 1 个（不是 0）',
    splitCountForDrag(total, start, -CELL * SPLIT_DRAG_SPAN_CELLS, CELL),
    1,
  );
  equal('向右划半格 → 补掉一半的余量', splitCountForDrag(total, start, CELL / 2, CELL), 32 + 16);
  equal('向左划半格 → 减掉一半的可减量', splitCountForDrag(total, start, -CELL / 2, CELL), 32 - 16);
  equal('向右划过头 → 夹在总数', splitCountForDrag(total, start, CELL * 10, CELL), total);
  equal('向左划过头 → 夹在 1', splitCountForDrag(total, start, -CELL * 10, CELL), 1);
  equal('划出去再划回原点 → 回到半数（可逆）', splitCountForDrag(total, start, 0, CELL), 32);
  check(
    '格子更宽时，同样的位移改得更少（映射按格宽归一）',
    splitCountForDrag(total, start, 20, CELL * 2) < splitCountForDrag(total, start, 20, CELL),
  );
  equal('格宽为 0 时不除零', splitCountForDrag(total, start, 1, 0) > 0, true);
}

console.log('\n[小堆与边界：2 个 / 3 个 / 已经选到底]');
{
  equal('2 个的那一叠：向右划一格 → 2', splitCountForDrag(2, 1, CELL, CELL), 2);
  equal('2 个的那一叠：向左划 → 1（至少 1 个）', splitCountForDrag(2, 1, -CELL, CELL), 1);
  // 3 个的那一叠：初始 2（向上取整），再向右只剩 1 个余量，划半格就该到 3
  equal('3 个的那一叠：向右划半格 → 3（余量只有 1 个）', splitCountForDrag(3, 2, CELL / 2, CELL), 3);
  equal('5 个的那一叠：初始 3，向右划半格 → 4', splitCountForDrag(5, 3, CELL / 2, CELL), 4);
  equal('已经选中全部时再向右划 → 还是全部', splitCountForDrag(64, 64, CELL, CELL), 64);
  equal('已经只选 1 个时再向左划 → 还是 1', splitCountForDrag(64, 1, -CELL, CELL), 1);
  equal('1 个的格子（不该进来，但防御）→ 1', splitCountForDrag(1, 1, CELL, CELL), 1);
  equal('0 个的格子 → 0', splitCountForDrag(0, 0, CELL, CELL), 0);
}

console.log('\n[划动是单调的：一路向右不会忽大忽小]');
{
  let previous = 0;
  let monotonic = true;
  for (let dx = -CELL * 2; dx <= CELL * 2; dx += 1) {
    const count = splitCountForDrag(64, 32, dx, CELL);
    if (count < previous) monotonic = false;
    previous = count;
  }
  check('从 -2 格划到 +2 格，选中数量只会增不会减', monotonic);
  equal('划到最左端是 1', splitCountForDrag(64, 32, -CELL * 2, CELL), 1);
  equal('划到最右端是 64', splitCountForDrag(64, 32, CELL * 2, CELL), 64);
}

// ---------------------------------------------------------------- 4. 指示条的占比

console.log('\n[指示条：绿色部分 = 选中数 / 总数]');
{
  equal('32 / 64 = 50%', splitFraction(32, 64), 0.5);
  equal('1 / 64', splitFraction(1, 64), 1 / 64);
  equal('64 / 64 = 100%', splitFraction(64, 64), 1);
  equal('空槽（0 / 0）→ 0', splitFraction(0, 0), 0);
  equal('越界（比总数还多）→ 条填满', splitFraction(99, 64), 1);
  equal('负数 → 夹到 0', splitFraction(-3, 64), 0);
}

// ---------------------------------------------------------------- 5. 拆开这一格

console.log('\n[松手结算：拆成"拿走的"与"留下的"两份]');
{
  const stack: ItemStack = { id: 7, count: 64 };
  const half = splitStack(stack, 32);
  equal('拿走 32', half.taken?.count, 32);
  equal('留下 32', half.rest?.count, 32);
  equal('原对象没被改（纯函数）', stack.count, 64);

  const all = splitStack(stack, 64);
  equal('拿满 → 留下 null', all.rest, null);
  equal('拿满 → 拿走 64', all.taken?.count, 64);

  const over = splitStack(stack, 999);
  equal('超过总数 → 只能拿 64', over.taken?.count, 64);

  const none = splitStack(stack, 0);
  equal('拿 0 → 没拿走东西', none.taken, null);
  check('拿 0 → 原样留下（同一个对象）', none.rest === stack);

  // 附加数据必须跟着走：不然铁砧改过名的剑拆一半之后，留下的那把会"变回默认名字"
  const named: ItemStack = { id: 300, count: 5, damage: 12, name: '老王', enchants: { sharpness: 3 } };
  const piece = splitStack(named, 2);
  equal('改名跟着走', piece.taken?.name, '老王');
  equal('耐久跟着走', piece.taken?.damage, 12);
  equal('附魔跟着走（等级）', piece.taken?.enchants?.sharpness, 3);
  equal('留下的那份也带着', piece.rest?.name, '老王');
  equal('留下的那份数量对', piece.rest?.count, 3);
  check(
    '附魔是深拷贝（改一份不会动另一份）',
    (() => {
      if (!piece.taken?.enchants || !piece.rest?.enchants) return false;
      piece.taken.enchants.sharpness = 5;
      return piece.rest.enchants.sharpness === 3;
    })(),
  );
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
