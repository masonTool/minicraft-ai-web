/**
 * "要不要追玩家"的判据（J3 第三批，批次 515）
 *
 * 六个维度各来一条：敌对性 / 亮处中立 / 记仇 / 隐身 / 距离 / 玩家在不在场。
 * 再补三条接线守卫：`Mob.updateAi` 真的调了纯函数、记仇由 `hurt()` 按来源置位。
 *
 * 运行：npm run test:chase
 */

import { readFileSync } from 'node:fs';
import { isPacified, shouldChasePlayer, type ChaseInput } from '../src/core/entity/ChaseRules.ts';

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

function base(overrides: Partial<ChaseInput> = {}): ChaseInput {
  return {
    hostile: true,
    neutral: false,
    neutralInLight: undefined,
    angerRemaining: 0,
    lightLevel: 15,
    playerPresent: true,
    playerInvisible: false,
    distanceSq: 4,
    followRange: 16,
    ...overrides,
  };
}

console.log('\n[基础：敌对 + 近 → 追]');
{
  check('敌对生物两格外会追', shouldChasePlayer(base()));
  check('16 格（等于索敌半径）仍会追', shouldChasePlayer(base({ distanceSq: 16 * 16 })));
  check('16.1 格就不追了', !shouldChasePlayer(base({ distanceSq: 16.1 * 16.1 })));
  check('被动生物不追', !shouldChasePlayer(base({ hostile: false })));
  check('玩家不在场不追', !shouldChasePlayer(base({ playerPresent: false })));
  check('隐身玩家不追（K4 尾巴）', !shouldChasePlayer(base({ playerInvisible: true })));
  check('隐身 + 记仇也不追（隐身优先，与原版一致）', !shouldChasePlayer(base({ playerInvisible: true, angerRemaining: 9 })));
}

console.log('\n[中立：蜘蛛的亮处行为]');
{
  const spider = base({ neutralInLight: 11, lightLevel: 15 });
  check('亮处（15 ≥ 11）的蜘蛛不主动', !shouldChasePlayer(spider));
  check('暗处（10 < 11）的蜘蛛会主动', shouldChasePlayer(base({ neutralInLight: 11, lightLevel: 10 })));
  check('刚好等于阈值（11）也算亮处', !shouldChasePlayer(base({ neutralInLight: 11, lightLevel: 11 })));
  check(
    '被打过之后压过亮处中立（记仇优先）',
    shouldChasePlayer(base({ neutralInLight: 11, lightLevel: 15, angerRemaining: 5 })),
  );
  check('记仇只剩 0.1 秒还在追', shouldChasePlayer(base({ neutralInLight: 11, lightLevel: 15, angerRemaining: 0.1 })));
  check('记仇归零就恢复中立', !shouldChasePlayer(base({ neutralInLight: 11, lightLevel: 15, angerRemaining: 0 })));
}

console.log('\n[中立：猪灵的"打死不从" / 僵尸猪灵]');
{
  check('neutral 族平时不主动', !shouldChasePlayer(base({ neutral: true })));
  check('neutral 族被打过会还手', shouldChasePlayer(base({ neutral: true, angerRemaining: 5 })));
  check(
    'neutral 与 neutralInLight 同时设了也以 neutral 为准',
    isPacified(base({ neutral: true, neutralInLight: 11, lightLevel: 0 })),
  );
}

console.log('\n[isPacified 单独看]');
{
  check('敌对 + 无中立 + 无记仇 → 不 pacified', !isPacified(base()));
  check('neutral → pacified', isPacified(base({ neutral: true })));
  check('亮处中立 → pacified', isPacified(base({ neutralInLight: 5, lightLevel: 15 })));
  check('暗处中立 → 不 pacified', !isPacified(base({ neutralInLight: 5, lightLevel: 4 })));
  check('有记仇 → 永不 pacified', !isPacified(base({ neutral: true, angerRemaining: 1 })));
  check('被动生物本身不 pacified（它只是不 hostile）', !isPacified(base({ hostile: false })));
}

console.log('\n[接线守卫]');
{
  const mobSrc = readFileSync(new URL('../src/core/entity/Mob.ts', import.meta.url), 'utf8');
  check('updateAi 用纯函数判追击', mobSrc.includes('const chasing = shouldChasePlayer(chaseInput)'));
  check('不再自己拼 pacified', !mobSrc.includes('const pacified ='));
  check('六个维度都传进去了', mobSrc.includes('neutralInLight: this.type.neutralInLight') && mobSrc.includes('playerInvisible: ctx.playerInvisible === true'));
  check(
    '记仇只在"非环境"来源时置位（批次 471）',
    mobSrc.includes("const provoked = source !== undefined && source.kind !== 'environment'") &&
      mobSrc.includes('this.angerTimer = ANGER_SECONDS'),
  );
}

console.log(`\n追击判据测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
