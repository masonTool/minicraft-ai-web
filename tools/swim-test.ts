/**
 * 生物游泳（J3 收口，批次 517）
 *
 * 只断言纯函数那一半：什么时候推、推多快、什么时候不推。
 * 再加三条源码守卫：`Mob` 真的在水里调它、而且排在 `aquatic` 之后（不抢鱿鱼的逻辑）。
 *
 * 运行：npm run test:swim
 */

import { readFileSync } from 'node:fs';
import { SWIM_FLOAT_SPEED, SWIM_UP_SPEED, swimVerticalSpeed } from '../web/src/core/entity/SwimRules.ts';

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

function base(overrides: Partial<Parameters<typeof swimVerticalSpeed>[0]> = {}) {
  return { submerged: true, headAboveWater: false, targetAbove: false, vy: -3, ...overrides };
}

console.log('\n[什么时候推]');
{
  check('没在水里：原样返回（交给重力）', swimVerticalSpeed(base({ submerged: false })) === -3);
  check('头已经露出水面：不再推（不会跳出水）', swimVerticalSpeed(base({ headAboveWater: true })) === -3);
  check('泡在水里、头在水下、没目标：缓慢上浮', swimVerticalSpeed(base()) === SWIM_FLOAT_SPEED);
  check('追击目标在上方：用更快的上浮', swimVerticalSpeed(base({ targetAbove: true })) === SWIM_UP_SPEED);
  check('上浮速度是正的', SWIM_UP_SPEED > 0 && SWIM_FLOAT_SPEED > 0);
  check('追击上浮比自然上浮快', SWIM_UP_SPEED > SWIM_FLOAT_SPEED);
}

console.log('\n[不硬拽已有速度]');
{
  check('已经在快速上浮（4）：不会被压回 2.6', swimVerticalSpeed(base({ vy: 4, targetAbove: true })) === 4);
  check('正在下沉（-10）：被抬到目标速度', swimVerticalSpeed(base({ vy: -10, targetAbove: true })) === SWIM_UP_SPEED);
  check('缓慢上浮时已有的小速度也保留', swimVerticalSpeed(base({ vy: 1 })) === 1);
  check('刚好等于目标速度：不变', swimVerticalSpeed(base({ vy: SWIM_FLOAT_SPEED })) === SWIM_FLOAT_SPEED);
  check('vy=0 且没目标：抬到自然上浮', swimVerticalSpeed(base({ vy: 0 })) === SWIM_FLOAT_SPEED);
  check('vy=0 且目标在上：抬到追击速度', swimVerticalSpeed(base({ vy: 0, targetAbove: true })) === SWIM_UP_SPEED);
}

console.log('\n[接线守卫]');
{
  const mobSrc = readFileSync(new URL('../web/src/core/entity/Mob.ts', import.meta.url), 'utf8');
  check('Mob 在水里调用纯函数', mobSrc.includes('this.vy = swimVerticalSpeed({ submerged: true, headAboveWater, targetAbove, vy: this.vy })'));
  check('头露出水面的判定取了 0.9 身高', mobSrc.includes('this.y + this.height * 0.9'));
  check('只有追击时才设目标高度', mobSrc.includes('this.swimTargetY = chasing && player ? player.y : null'));
  check(
    '游泳分支排在 aquatic 之后（不抢鱿鱼的上浮）',
    mobSrc.indexOf('this.type.aquatic === true && this.inWater(ctx)') < mobSrc.indexOf('this.vy = swimVerticalSpeed('),
  );
}

console.log(`\n生物游泳测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
