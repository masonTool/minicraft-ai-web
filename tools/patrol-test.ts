/**
 * 掠夺者巡逻队（批次 476，J24 最后一块）
 *
 * 只测纯判据：一组几只、谁是队长、要不要生成、落点在哪一圈。
 * 造实体与 90 秒计时都在 main 里。
 */

import {
  PATROL_INTERVAL_SECONDS,
  PATROL_MAX,
  PATROL_MAX_DISTANCE,
  PATROL_MIN,
  PATROL_MIN_DISTANCE,
  patrolSpawnPoint,
  planPatrol,
  shouldTryPatrol,
} from '../src/core/world/Patrol.ts';

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

/** 按顺序吐出给定值的假随机源（循环取用） */
function seq(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

console.log('\n[一组几只、谁是队长]');
{
  for (const roll of [0, 0.34, 0.5, 0.99]) {
    const size = planPatrol(seq(roll, 0.9)).length;
    check(`roll=${roll} → 数量在 ${PATROL_MIN}~${PATROL_MAX}`, size >= PATROL_MIN && size <= PATROL_MAX, `${size}`);
  }
  equal('roll=0 是最小规模', planPatrol(seq(0, 0.9)).length, 3);
  equal('roll=0.99 是最大规模', planPatrol(seq(0.99, 0.9)).length, 5);

  const patrol = planPatrol(seq(0.5, 0.9));
  equal('队长只有一只', patrol.filter((member) => member.leader).length, 1);
  check('队长是第一个成员', patrol[0]?.leader === true);
  check('其余成员都不是队长', patrol.slice(1).every((member) => !member.leader));

  const withVindicator = planPatrol(seq(0.5, 0.1));
  check(
    '有卫道士时它排最后一只',
    withVindicator[withVindicator.length - 1]?.kind === 'vindicator',
    withVindicator.map((m) => m.kind).join(','),
  );
  equal('有卫道士时也只有一只', withVindicator.filter((member) => member.kind === 'vindicator').length, 1);
  check(
    '没抽到卫道士时全是掠夺者',
    planPatrol(seq(0.5, 0.9)).every((member) => member.kind === 'pillager'),
  );
  check('队长永远是掠夺者（旗帜在掠夺者手上）', withVindicator[0]?.kind === 'pillager');
}

console.log('\n[要不要生成]');
{
  const base = { elapsed: PATROL_INTERVAL_SECONDS, interval: PATROL_INTERVAL_SECONDS, peaceful: false, activePatrol: 0 };
  check('条件都满足 → 生成', shouldTryPatrol(base));
  check('和平难度不刷', !shouldTryPatrol({ ...base, peaceful: true }));
  check('已有一组活着不刷（否则会叠成一群）', !shouldTryPatrol({ ...base, activePatrol: 1 }));
  check('间隔没到不刷', !shouldTryPatrol({ ...base, elapsed: PATROL_INTERVAL_SECONDS - 1 }));
  check('间隔恰好到 → 刷', shouldTryPatrol({ ...base, elapsed: PATROL_INTERVAL_SECONDS }));
}

console.log('\n[落点：玩家周围的一圈]');
{
  for (const roll of [0, 0.25, 0.5, 0.75]) {
    const point = patrolSpawnPoint(100, -50, seq(roll, 0.5));
    const distance = Math.hypot(point.x - 100, point.z + 50);
    check(
      `roll=${roll} 的落点在 ${PATROL_MIN_DISTANCE}~${PATROL_MAX_DISTANCE} 之间`,
      distance >= PATROL_MIN_DISTANCE - 1 && distance <= PATROL_MAX_DISTANCE + 1,
      `${distance.toFixed(1)}`,
    );
  }
  // 取整到方块：探针是按整数格查的，不取整会落在两格之间
  const point = patrolSpawnPoint(0, 0, seq(0.3, 0.3));
  check('落点取整到方块', Number.isInteger(point.x) && Number.isInteger(point.z), `${point.x},${point.z}`);
  equal(
    '同样的随机源两次结果一致',
    JSON.stringify(patrolSpawnPoint(0, 0, seq(0.4, 0.6))),
    JSON.stringify(patrolSpawnPoint(0, 0, seq(0.4, 0.6))),
  );
}

console.log(`\n巡逻队测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
