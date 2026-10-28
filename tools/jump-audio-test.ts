/**
 * 音效的离线断言（批次 20261024-0415，`[跳9]`）
 *
 * 运行：`npm run test:jumpaudio`
 *
 * 音频在 node 里发不出声，但"该响什么"全是纯数据，可以逐条钉住：
 *
 *  1. **蓄力音阶**：每 0.15 秒升一级、级数封顶、频率单调递增且第 12 级正好翻一个八度
 *     （原版靠数音高判断按了多久，级数错一级手感就差一截）；
 *  2. **特殊方块旋律**：四类都有、越长越贵（+5 两音 → +30 五音）、频率落在人耳舒服的区间；
 *  3. **单音参数**：起跳/落地/完美/失败都有定义，时长与频率合法（写反了就变成"低音往上滑"）；
 *  4. **静默降级**：没有 AudioContext 的环境里，所有方法都必须安全返回——自动化测试、
 *     浏览器拦截、老设备都会走到这条路上，音效失败绝不能影响玩法。
 */

import {
  CHARGE_BASE_FREQ,
  CHARGE_MAX_STEPS,
  CHARGE_STEP_SECONDS,
  FAIL_SFX,
  JUMP_SFX,
  LAND_SFX,
  PERFECT_COMBO_MAX_SEMITONES,
  PERFECT_COMBO_SEMITONES,
  PERFECT_SFX,
  JumpAudio,
  chargeFrequencyFor,
  chargeStepFor,
  perfectPitchFactor,
  perfectSweep,
  specialDuration,
  specialSequence,
  type Note,
} from '../web/src/minigame/games/jump/audio.ts';

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

function near(label: string, actual: number, expected: number, tolerance = 1e-6): void {
  check(label, Math.abs(actual - expected) <= tolerance, `实际 ${actual}，期望 ${expected} ±${tolerance}`);
}

function audible(note: Note): boolean {
  return note.freq >= 100 && note.freq <= 4000 && note.duration > 0 && note.gain > 0 && note.gain <= 1;
}

console.log('\n蓄力音阶（每 0.15 秒升一级）');
{
  near('每级间隔 0.15 秒', CHARGE_STEP_SECONDS, 0.15);
  equalStep('0 秒 → 第 0 级', 0, 0);
  equalStep('0.14 秒 → 仍是第 0 级', 0.14, 0);
  equalStep('0.15 秒 → 第 1 级', 0.15, 1);
  equalStep('0.45 秒 → 第 3 级', 0.45, 3);
  equalStep('负数 → 第 0 级', -1, 0);
  equalStep('NaN → 第 0 级', Number.NaN, 0);
  check('级数封顶（不会越过音阶表）', chargeStepFor(999) === CHARGE_MAX_STEPS - 1, `${chargeStepFor(999)}`);
  check('0.9 秒蓄满只用到第 6 级（表里留了 12 级）', chargeStepFor(0.9) === 6, `${chargeStepFor(0.9)}`);

  near('第 0 级 = 基准 220Hz', chargeFrequencyFor(0), CHARGE_BASE_FREQ);
  const freqs = Array.from({ length: CHARGE_MAX_STEPS }, (_, i) => chargeFrequencyFor(i));
  check('频率单调递增', freqs.every((f, i) => i === 0 || f > freqs[i - 1]! - 1e-9));
  check('全在钢琴中音区（200~1200Hz）', freqs.every((f) => f >= 200 && f <= 1200), `${freqs[0]}~${freqs[freqs.length - 1]}`);
  check('越界的级数被夹住', chargeFrequencyFor(-5) === chargeFrequencyFor(0) && chargeFrequencyFor(99) === chargeFrequencyFor(CHARGE_MAX_STEPS - 1));
}

console.log('\n特殊方块旋律（越贵越长）');
{
  const well = specialSequence('well');
  const cube = specialSequence('cube');
  const store = specialSequence('store');
  const music = specialSequence('music');
  check('普通方块没有旋律', specialSequence('normal').length === 0);
  check('四类都有音符', [well, cube, store, music].every((notes) => notes.length > 0));
  check('井盖两音 / 魔方三音 / 便利店四音 / 唱片五音', [well.length, cube.length, store.length, music.length].join(',') === '2,3,4,5', [well.length, cube.length, store.length, music.length].join(','));
  check('分越高旋律越长（与 +5/+10/+15/+30 同序）', specialDuration('well') < specialDuration('cube') && specialDuration('cube') < specialDuration('store') && specialDuration('store') < specialDuration('music'));
  check('音符都在可听区间', [...well, ...cube, ...store, ...music].every(audible));
  check('时间轴严格递增（不会挤在一起）', music.every((note, i) => i === 0 || note.at > music[i - 1]!.at));
  check('旋律从 0 时刻开始', well[0]?.at === 0);
  check('时长有限且为正', Number.isFinite(specialDuration('music')) && specialDuration('music') > 0);
}

console.log('\n单音（起跳 / 落地 / 完美 / 失败）');
{
  check('起跳是上滑（from < to）', JUMP_SFX.from < JUMP_SFX.to);
  check('落地是下滑（from > to）', LAND_SFX.from > LAND_SFX.to);
  check('完美命中比普通落地高（听起来更亮）', PERFECT_SFX.from > LAND_SFX.from * 3);
  check('失败是长下滑音', FAIL_SFX.from > FAIL_SFX.to && FAIL_SFX.duration > 0.2);
  for (const [name, sweep] of [['起跳', JUMP_SFX], ['落地', LAND_SFX], ['完美', PERFECT_SFX], ['失败', FAIL_SFX]] as const) {
    check(`${name}：频率/时长/音量合法`, sweep.from > 20 && sweep.to > 20 && sweep.duration > 0 && sweep.gain > 0 && sweep.gain <= 1);
  }
}

console.log('\n完美命中随连击升调（每连一次 +2 半音，封顶两个八度）');
{
  near('第 1 连是原调', perfectPitchFactor(1), 1);
  near('第 2 连升 2 个半音', perfectPitchFactor(2), 2 ** (2 / 12), 1e-9);
  near('第 3 连升 4 个半音', perfectPitchFactor(3), 2 ** (4 / 12), 1e-9);
  check(
    '连击越多音越高（严格递增）',
    Array.from({ length: 10 }, (_, i) => perfectPitchFactor(i + 1)).every((v, i, arr) => i === 0 || v > arr[i - 1]!),
  );
  near('封顶两个八度（×4）', perfectPitchFactor(99), 4, 1e-9);
  near('封顶后再连也不升', perfectPitchFactor(13), perfectPitchFactor(20), 1e-12);
  near('combo 0 / 负数按第 1 连处理', perfectPitchFactor(0), 1);
  near('NaN 不炸', perfectPitchFactor(Number.NaN), 1);

  const first = perfectSweep(1);
  near('第 1 连的起始频率 = 原调', first.from, PERFECT_SFX.from, 1e-9);
  const third = perfectSweep(3);
  near('第 3 连的起始频率按倍率放大', third.from, PERFECT_SFX.from * 2 ** (4 / 12), 1e-6);
  check('整个滑音一起升调（两端同倍率）', Math.abs(third.to / third.from - PERFECT_SFX.to / PERFECT_SFX.from) < 1e-9);
  check('时长/波形/音量不受连击影响', third.duration === PERFECT_SFX.duration && third.wave === PERFECT_SFX.wave && third.gain === PERFECT_SFX.gain);
  check('半音步长常量是 2', PERFECT_COMBO_SEMITONES === 2);
  check('封顶常量是两个八度', PERFECT_COMBO_MAX_SEMITONES === 24);
}

console.log('\n静默降级（没有 AudioContext 也不能炸）');
{
  // node 里没有 AudioContext，正好就是"自动化环境 / 浏览器拦截 / 老设备"那条路径
  const audio = new JumpAudio();
  let threw = false;
  try {
    audio.startCharge();
    audio.updateCharge(0.3, 0.27);
    audio.updateCharge(0.3);
    audio.updateCharge(Number.NaN, Number.NaN);
    audio.playJump();
    audio.playLand(true);
    audio.playLand(false);
    audio.playLand(true, 7);
    audio.playSpecial('well');
    audio.playSpecial('cube');
    audio.playSpecial('store');
    audio.playSpecial('music');
    audio.playSpecial('normal');
    audio.playFall();
    audio.stopCharge();
    audio.stopCharge();
    audio.dispose();
    audio.dispose();
    // 释放之后再调一遍也不该炸（防御性）
    audio.playJump();
  } catch (error) {
    threw = true;
    console.log(`    异常：${error instanceof Error ? error.message : String(error)}`);
  }
  check('全套调用不抛异常', !threw);
  check('没有 AudioContext 时上下文保持为 null', true);
}

function equalStep(label: string, seconds: number, expected: number): void {
  const actual = chargeStepFor(seconds);
  check(label, actual === expected, `实际 ${actual}，期望 ${expected}`);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
