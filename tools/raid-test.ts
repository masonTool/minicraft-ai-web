/**
 * 村庄袭击（批次 475，J24 后半）
 *
 * 只测状态机：波次推进、击杀计数、超时、胜利、以及"这次击杀算不算袭击的"。
 * 生成实体、发效果、HUD 都在 main 里，不在这一层。
 */

import {
  RAID_RADIUS,
  RAID_TIMEOUT_SECONDS,
  RAID_TOTAL_WAVES,
  RAID_WAVE_DELAY,
  Raid,
  countsAsRaidKill,
  raidWaveSpec,
  waveSize,
} from '../web/src/core/world/Raid.ts';

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

/** 把当前波全部打死 */
function clearWave(raid: Raid): void {
  while (raid.remaining > 0) raid.onRaiderKilled();
}

console.log('\n[波次与清单]');
{
  equal('一共 3 波', RAID_TOTAL_WAVES, 3);
  equal('第 1 波 3 只', waveSize(raidWaveSpec(1)), 3);
  equal('第 2 波 4 只（3 掠夺者 + 1 卫道士）', waveSize(raidWaveSpec(2)), 4);
  equal('第 3 波 4 只（含 1 唤魔者）', waveSize(raidWaveSpec(3)), 4);
  check(
    '第 3 波里有唤魔者',
    raidWaveSpec(3).some((spec) => spec.kind === 'evoker'),
  );

  const raid = new Raid(0, 0);
  const first = raid.start();
  equal('start 返回第 1 波', waveSize(first), 3);
  equal('波数从 1 开始', raid.wave, 1);
  equal('剩余数 = 本波总数', raid.remaining, 3);
}

console.log('\n[推进：清空 → 间隔 → 下一波]');
{
  const raid = new Raid(0, 0);
  raid.start();
  clearWave(raid);
  equal('清空后剩余 0', raid.remaining, 0);
  equal('清空当帧还不开下一波', raid.tick(0.1), null);
  equal('间隔未到（4 秒）', raid.tick(RAID_WAVE_DELAY - 1.1), null);
  equal('间隔到了 → 该开下一波', raid.tick(1.2), 'spawn-next');
  const second = raid.nextWave();
  equal('第二波 4 只', waveSize(second), 4);
  equal('波数推进到 2', raid.wave, 2);
  equal('剩余数重置为本波总数', raid.remaining, 4);
}

console.log('\n[胜利与失败]');
{
  // 三波全清 → 胜利
  const raid = new Raid(0, 0);
  raid.start();
  for (let wave = 1; wave <= RAID_TOTAL_WAVES; wave++) {
    clearWave(raid);
    const step = raid.tick(wave < RAID_TOTAL_WAVES ? RAID_WAVE_DELAY : 0);
    if (wave < RAID_TOTAL_WAVES) {
      equal(`第 ${wave} 波后提示下一波`, step, 'spawn-next');
      raid.nextWave();
    } else {
      equal('最后一波清空 → 胜利', step, 'won');
    }
  }
  equal('状态是 won', raid.state, 'won');
  equal('三波一共打死 11 只', raid.kills, 3 + 4 + 4);
  raid.onRaiderKilled();
  equal('胜利之后再死人也不计数', raid.kills, 11);

  // 超时 → 失败
  const slow = new Raid(0, 0);
  slow.start();
  equal('时限内还在打', slow.tick(RAID_TIMEOUT_SECONDS - 1), null);
  equal('超时 → 失败', slow.tick(2), 'lost');
  equal('状态是 lost', slow.state, 'lost');
  equal('失败后 tick 不再返回东西', slow.tick(10), null);

  // 主动放弃
  const abandoned = new Raid(0, 0);
  abandoned.start();
  abandoned.abandon();
  equal('放弃 → lost', abandoned.state, 'lost');

  // HUD 用到的两个读数
  const timer = new Raid(0, 0);
  timer.start();
  timer.tick(30);
  equal('剩余秒数递减', Math.round(timer.remainingSeconds), RAID_TIMEOUT_SECONDS - 30);
}

console.log('\n[哪些击杀算袭击的]');
{
  const raid = new Raid(100, 100);
  raid.start();
  check('半径内的掠夺者算', countsAsRaidKill('pillager', 100 + RAID_RADIUS - 1, 100, raid));
  check('半径外的掠夺者不算（别处的顺手一击不该让袭击少一只）', !countsAsRaidKill('pillager', 100 + RAID_RADIUS + 1, 100, raid));
  check('半径内的僵尸不算', !countsAsRaidKill('zombie', 100, 100, raid));
  check('半径内的卫道士算', countsAsRaidKill('vindicator', 100, 100, raid));
  check('半径内的唤魔者算', countsAsRaidKill('evoker', 100, 100, raid));
  check('没有袭击时不算', !countsAsRaidKill('pillager', 100, 100, null));

  const done = new Raid(100, 100);
  done.start();
  clearWave(done);
  done.tick(RAID_TIMEOUT_SECONDS + 1); // 让它变成 lost
  check('袭击结束后不再算', !countsAsRaidKill('pillager', 100, 100, done));
}

console.log(`\n袭击测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
