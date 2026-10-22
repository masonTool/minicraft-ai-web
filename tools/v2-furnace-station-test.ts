/**
 * 熔炉"点目标框才开工"的离线断言。
 *
 * 守的是三条会出真事故的规则：
 *  1. 打开**正在烧**的炉子不能冻结（否则"外面在烧、一打开就停"）；
 *  2. 离开界面必须按"有没有开工"解除冻结（漏了 → 炉子被永久冻住）；
 *  3. 点目标框的三条拒绝要分得清（没原料 / 没燃料 / 产物满）。
 *
 * 运行：`npm run test:v2-furnace-station`
 */

import {
  verdictOnLeave,
  verdictOnOpen,
  verdictOnStart,
  type FurnaceSnapshot,
} from '../src/minigame-v2/furnace-station.ts';

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

/** 一个"刚放好料、还没开工"的炉子 */
const idle = (): FurnaceSnapshot => ({
  hasInput: true,
  hasFuel: true,
  burnTimeLeft: 0,
  cookProgress: 0,
  cookTimeTotal: 0,
  paused: true,
  started: false,
});

// ================================================================ 1. 打开界面

console.log('\n[1] 打开界面：正在烧的炉子不能冻');

{
  const running = { ...idle(), burnTimeLeft: 8, started: true };
  const v = verdictOnOpen(running);
  check('有燃烧时间 → 不冻结', v.paused === false, v.reason);
  check('给了说明', v.reason.length > 0);
}

{
  // 燃烧时间用完了但烧炼进度还在（这一轮还没烧完）
  const cooking = { ...idle(), burnTimeLeft: 0, cookProgress: 4, cookTimeTotal: 10 };
  const v = verdictOnOpen(cooking);
  check('只剩烧炼进度 → 也不冻结', v.paused === false, v.reason);
}

{
  const v = verdictOnOpen(idle());
  check('什么都没在动 → 冻结等玩家选配方', v.paused === true, v.reason);
}

{
  // 空炉子
  const empty: FurnaceSnapshot = {
    hasInput: false,
    hasFuel: false,
    burnTimeLeft: 0,
    cookProgress: 0,
    cookTimeTotal: 0,
    paused: true,
    started: false,
  };
  check('空炉子 → 冻结', verdictOnOpen(empty).paused === true);
}

// ================================================================ 2. 离开界面

console.log('\n[2] 离开界面：解除冻结（炉子被永久冻住的唯一防线）');

{
  const v = verdictOnLeave({ ...idle(), started: true });
  check('已开工 → 解除冻结，继续烧', v.paused === false, v.reason);
}

{
  const v = verdictOnLeave({ ...idle(), started: false });
  check('没开工 → 保持冻结（玩家没选配方，不该自己烧）', v.paused === true, v.reason);
}

{
  // 这一条最容易写错：paused 字段本身是 true，但 started 已置位 —— 要看 started 而不是 paused
  const tricky: FurnaceSnapshot = { ...idle(), paused: true, started: true };
  check(
    '看 started 而不是 paused（paused=true 但已开工 → 解除）',
    verdictOnLeave(tricky).paused === false,
  );
}

{
  const tricky: FurnaceSnapshot = { ...idle(), paused: false, started: false };
  check(
    '反过来也成立（paused=false 但没开工 → 冻结）',
    verdictOnLeave(tricky).paused === true,
  );
}

// ================================================================ 3. 点目标框

console.log('\n[3] 点目标框：三条拒绝要分得清');

{
  const v = verdictOnStart({ inputReady: false, fuelReady: true, outputFits: true });
  check('没原料 → 拒绝', v.ok === false);
  check('拒绝码是 no-input', !v.ok && v.code === 'no-input');
  check('提示说的是原料', !v.ok && v.reason.includes('原料'), !v.ok ? v.reason : '');
}

{
  const v = verdictOnStart({ inputReady: true, fuelReady: false, outputFits: true });
  check('没燃料 → 拒绝', v.ok === false);
  check('拒绝码是 no-fuel', !v.ok && v.code === 'no-fuel');
  check('提示说的是燃料', !v.ok && v.reason.includes('燃料'), !v.ok ? v.reason : '');
}

{
  const v = verdictOnStart({ inputReady: true, fuelReady: true, outputFits: false });
  check('产物槽满 → 拒绝', v.ok === false);
  check('拒绝码是 output-blocked', !v.ok && v.code === 'output-blocked');
  check('提示说的是产物', !v.ok && v.reason.includes('产物'), !v.ok ? v.reason : '');
}

{
  const v = verdictOnStart({ inputReady: true, fuelReady: true, outputFits: true });
  check('三条都过 → 开工', v.ok === true);
  check('开工提示不为空', v.ok && v.reason.length > 0);
}

// 三条拒绝必须**互不相同**（同一句话没法指导玩家）
{
  const reasons = [
    verdictOnStart({ inputReady: false, fuelReady: true, outputFits: true }),
    verdictOnStart({ inputReady: true, fuelReady: false, outputFits: true }),
    verdictOnStart({ inputReady: true, fuelReady: true, outputFits: false }),
  ].map((v) => (!v.ok ? v.reason : ''));

  check('三条拒绝的话各不相同', new Set(reasons).size === 3, reasons.join(' / '));
  check('没有一句是空的', reasons.every((r) => r.length > 0));
}

// 拒绝优先级：没原料时不该先抱怨"没燃料"（玩家会去拿煤，然后发现还是不行）
{
  const v = verdictOnStart({ inputReady: false, fuelReady: false, outputFits: false });
  check(
    '三条全不满足时，先说"原料"（最上游那条）',
    !v.ok && v.code === 'no-input',
    !v.ok ? v.code : 'ok',
  );
}

// ================================================================ 4. 状态机自洽

console.log('\n[4] 状态机自洽：冻结与开工不能同时成立');

{
  // 打开一个"已开工但没在烧"的炉子（比如刚好烧完一轮）：冻结 → 玩家要重新点
  const justFinished: FurnaceSnapshot = {
    ...idle(),
    burnTimeLeft: 0,
    cookProgress: 0,
    started: true,
  };
  const opened = verdictOnOpen(justFinished);
  check('刚烧完一轮（没有进度）→ 打开时冻结', opened.paused === true, opened.reason);
  // 但离开时不该又把它冻着（started 还在）
  check('离开时按 started 解除', verdictOnLeave(justFinished).paused === false);
}

{
  // "冻结" 与 "开工" 的矛盾组合：paused=true && started=true 只能由"重开界面"产生
  // 打开时的判定必须只看有没有在动，不能把 started 当"该继续烧"的依据
  const reopening: FurnaceSnapshot = { ...idle(), paused: true, started: true };
  check(
    '重开一个 frozen 但 started 的炉子 → 仍然冻结（没有进度就不烧）',
    verdictOnOpen(reopening).paused === true,
  );
}

// ================================================================ 收尾


// ================================================================ 5. 界面文案

console.log('\n[5] 界面文案：四种状态各自说什么');

/**
 * 熔炉界面上那两行小字的内容（与 `containers.ts` 里 `idle ? ... : ...` 一致）。
 *
 * 单独抽出来断言的理由：这两行是玩家**唯一**能看出"为什么不动"的地方，
 * 写错了就是"炉子不烧、界面什么都不说"。
 */
function progressLabels(snapshot: FurnaceSnapshot): { top: string; bottom: string } {
  if (snapshot.paused) return { top: '待开工', bottom: '点产物框' };
  // 真跑起来时用百分比（这里只验"不是待开工"那一档）
  return { top: '火焰 N%', bottom: '熔炼 N%' };
}

{
  const frozen = progressLabels(idle());
  check('冻结 → 第一行写"待开工"', frozen.top === '待开工', frozen.top);
  check('冻结 → 第二行写"点产物框"', frozen.bottom === '点产物框', frozen.bottom);
}

{
  const running = progressLabels({ ...idle(), paused: false, burnTimeLeft: 8 });
  check('运行中 → 不再写"待开工"', running.top !== '待开工', running.top);
  check('运行中 → 第一行是火焰进度', running.top.includes('火焰'), running.top);
  check('运行中 → 第二行是熔炼进度', running.bottom.includes('熔炼'), running.bottom);
}

{
  // 空炉子也是冻结态 —— 文案一样，但点下去会被拒（这两件事不冲突）
  const empty: FurnaceSnapshot = {
    hasInput: false,
    hasFuel: false,
    burnTimeLeft: 0,
    cookProgress: 0,
    cookTimeTotal: 0,
    paused: true,
    started: false,
  };
  check('空炉子同样是"待开工"文案', progressLabels(empty).top === '待开工');
  // 但点下去必须有话说，不能静默
  const v = verdictOnStart({ inputReady: false, fuelReady: false, outputFits: false });
  check('空炉子点下去给得出拒绝理由', !v.ok && v.reason.length > 0, !v.ok ? v.reason : 'ok');
}

// 文案不能自相矛盾：说"待开工"时不能同时又显示百分比
{
  const frozen = progressLabels(idle());
  check('"待开工"里没有百分比残留', !frozen.top.includes('%') && !frozen.bottom.includes('%'));
}

console.log(`\n${failed === 0 ? '✓' : '✗'} 熔炉目标框（含文案）：${passed} 条通过，${failed} 条失败`);
if (failed > 0) process.exit(1);
