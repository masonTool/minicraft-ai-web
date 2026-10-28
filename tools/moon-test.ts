/**
 * 月相离线测试（批次 84，I15）
 *
 * 这一批做成的是"**时间的一个新刻度**"：世界过了几天 → 8 天一轮的月相 → 天空里月亮的形状。
 * 断言分四块：
 *  1. **周期与映射**：8 天一轮、第 0 天满月、负数/大数/非法值都能取模；
 *  2. **8 个相的定义**：中文名、亮面比例、亮的是哪半边（亏在左、盈在右）；
 *  3. **画法几何**（`moonShape`）：椭圆横半径与"加/减"两条边界——
 *     满月加了整个盘、新月减了整个盘、两个弦月的椭圆半径是 0（正好一半）；
 *  4. **玩法影响**：月光强度**不随月相变化**（原版如此，恒为 4）、
 *     史莱姆系数按原版那张表（本项目还没有史莱姆，所以只是数据）。
 *
 * 运行：npm run test:moon
 */

import {
  MOON_BRIGHTNESS,
  MOON_PHASE_COUNT,
  MOON_PHASES,
  moonPhaseFor,
  moonPhaseInfo,
  moonPhaseName,
  moonShape,
  moonlightLevel,
  slimeSpawnFactor,
} from '../web/src/core/world/MoonPhase.ts';

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

function near(label: string, actual: number, expected: number, tol = 1e-9): void {
  check(label, Math.abs(actual - expected) <= tol, `实际 ${actual}，期望约 ${expected}`);
}

// ---------------------------------------------------------------- 1. 周期

console.log('\n[周期：8 天一轮，第 0 天满月]');
{
  equal('一个循环 8 天', MOON_PHASE_COUNT, 8);
  equal('表里有 8 个相', MOON_PHASES.length, 8);
  equal('第 0 天是满月', moonPhaseName(0), '满月');
  equal('第 1 天是亏凸月', moonPhaseName(1), '亏凸月');
  equal('第 4 天是新月', moonPhaseName(4), '新月');
  equal('第 7 天是盈凸月', moonPhaseName(7), '盈凸月');
  equal('第 8 天回到满月（取模）', moonPhaseName(8), '满月');
  equal('第 15 天 = 第 7 天', moonPhaseName(15), moonPhaseName(7));
  equal('第 80 天 = 第 0 天', moonPhaseFor(80), 0);

  // 负数与小数：都不该抛错，也不该给出表外的相
  equal('负数取模（-1 天 = 第 7 相）', moonPhaseFor(-1), 7);
  equal('负数取模（-8 天 = 满月）', moonPhaseFor(-8), 0);
  equal('小数向下取整', moonPhaseFor(3.9), 3);
  equal('NaN → 满月', moonPhaseFor(Number.NaN), 0);
  equal('Infinity → 满月', moonPhaseFor(Number.POSITIVE_INFINITY), 0);

  const all = new Set<number>();
  for (let day = 0; day < 100; day++) all.add(moonPhaseFor(day));
  equal('100 天里 8 个相都出现过', all.size, 8);
  check('相号都在 0~7', [...all].every((phase) => phase >= 0 && phase < MOON_PHASE_COUNT));
  // 表里每一项的 phase 字段必须与下标一致（表驱动最容易错的一处）
  check('表里每一项的 phase 与下标一致', MOON_PHASES.every((info, index) => info.phase === index));
  // 越界的相号会被**取模**（99 → 第 3 相），只有 NaN 才回退满月
  equal('越界相号按取模算', moonPhaseInfo(99).phase, moonPhaseFor(99));
  equal('NaN 才回退满月', moonPhaseInfo(Number.NaN).cn, '满月');
}

// ---------------------------------------------------------------- 2. 八个相

console.log('\n[8 个相：亮面比例与亮的方向]');
{
  const expected: readonly (readonly [number, string, number, 'left' | 'right'])[] = [
    [0, '满月', 1, 'right'],
    [1, '亏凸月', 0.75, 'left'],
    [2, '下弦月', 0.5, 'left'],
    [3, '残月', 0.25, 'left'],
    [4, '新月', 0, 'left'],
    [5, '娥眉月', 0.25, 'right'],
    [6, '上弦月', 0.5, 'right'],
    [7, '盈凸月', 0.75, 'right'],
  ];
  for (const [phase, cn, lit, half] of expected) {
    const info = moonPhaseInfo(phase);
    equal(`第 ${phase} 相：名字`, info.cn, cn);
    near(`第 ${phase} 相：亮面比例`, info.lit, lit);
    equal(`第 ${phase} 相：亮的方向`, info.litHalf, half);
  }

  // 亏（1~4）之后是盈（5~7）：这条边界最容易写反
  check('亏的四个相亮面在左', [1, 2, 3, 4].every((phase) => moonPhaseInfo(phase).litHalf === 'left'));
  check('盈的三个相亮面在右', [5, 6, 7].every((phase) => moonPhaseInfo(phase).litHalf === 'right'));
  // 亮面比例必须从满月单调降到新月、再升回来（"8 张图"最容易画串的地方）
  const lits = MOON_PHASES.map((info) => info.lit);
  check('亮面比例一路降（0→4）', lits[0]! > lits[1]! && lits[1]! > lits[2]! && lits[2]! > lits[3]! && lits[3]! > lits[4]!);
  check('亮面比例一路升（4→7）', lits[4]! < lits[5]! && lits[5]! < lits[6]! && lits[6]! < lits[7]!);
  check('两两对称（第 1 天与第 7 天、第 2 天与第 6 天、第 3 天与第 5 天）', lits[1] === lits[7] && lits[2] === lits[6] && lits[3] === lits[5]);
}

console.log('\n[画法几何：椭圆的半径与"加/减"]');
{
  const full = moonShape(0);
  near('满月：椭圆半径 1', full.ellipseRx, 1);
  equal('满月：是"加"', full.ellipseMode, 'add');
  near('满月：亮面 1', full.lit, 1);

  const fresh = moonShape(4);
  near('新月：椭圆半径 1', fresh.ellipseRx, 1);
  equal('新月：是"减"（整个盘都被挖掉）', fresh.ellipseMode, 'subtract');
  near('新月：亮面 0', fresh.lit, 0);

  near('下弦月：椭圆半径 0（正好一半）', moonShape(2).ellipseRx, 0);
  near('上弦月：椭圆半径 0', moonShape(6).ellipseRx, 0);
  near('亏凸月：半径 0.5 且是加', moonShape(1).ellipseRx, 0.5);
  equal('亏凸月：加', moonShape(1).ellipseMode, 'add');
  near('残月：半径 0.5 且是减', moonShape(3).ellipseRx, 0.5);
  equal('残月：减', moonShape(3).ellipseMode, 'subtract');

  // 半径公式就是 |2·lit − 1|，逐相验一遍（这条式子写反了画出来就是"反着的月亮"）
  for (let phase = 0; phase < MOON_PHASE_COUNT; phase++) {
    const info = moonPhaseInfo(phase);
    near(`第 ${phase} 相的半径 = |2×亮面 − 1|`, moonShape(phase).ellipseRx, Math.abs(2 * info.lit - 1));
  }
  check('半径始终在 0~1', MOON_PHASES.every((info) => {
    const rx = moonShape(info.phase).ellipseRx;
    return rx >= 0 && rx <= 1;
  }));
  // 满/新月的"加/减"边界：lit 正好 0.5 时取减（上下弦本来就画不出椭圆，方向无所谓）
  equal('亮面正好一半时取"减"（半径 0，画不出东西）', moonShape(2).ellipseMode, 'subtract');
}

// ---------------------------------------------------------------- 3. 玩法影响

console.log('\n[月光强度不随月相变化]');
{
  for (let phase = 0; phase < MOON_PHASE_COUNT; phase++) {
    equal(`第 ${phase} 相：夜里地表天光仍是 4`, moonlightLevel(), 4);
  }
  check('月光强度是个不接参数的函数（防止有人"顺手"让它随月相变亮）', moonlightLevel.length === 0);
}

console.log('\n[史莱姆系数：原版那张表（本项目还没有史莱姆）]');
{
  equal('表里有 8 个数', MOON_BRIGHTNESS.length, 8);
  near('满月最高（1）', slimeSpawnFactor(0), 1);
  near('新月最低（0）', slimeSpawnFactor(4), 0);
  near('两个弦月各 0.5', slimeSpawnFactor(2) + slimeSpawnFactor(6), 1);
  check('系数都在 0~1', MOON_BRIGHTNESS.every((value) => value >= 0 && value <= 1));
  check('对称（第 1 天 = 第 7 天）', slimeSpawnFactor(1) === slimeSpawnFactor(7) && slimeSpawnFactor(3) === slimeSpawnFactor(5));
  // 与相位表同序：亏凸月（1）比下弦月（2）亮
  check('亏凸月比下弦月亮', slimeSpawnFactor(1) > slimeSpawnFactor(2));
}

console.log(`\n月相测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
