/**
 * 游戏模式与旁观者（批次 491，M22）
 *
 * 三块：
 *  ① 三种模式本身（名字、标签、`isGameMode` 的容错、循环顺序）；
 *  ② **能力矩阵**（每种模式 × 六项能力）——这是这一批的核心：
 *     旁观与创造在三件事上不同（穿墙、不能交互、不吃伤害），
 *     用 `isCreative` 顶替旁观就会在这三件事上全错；
 *  ③ 源码守卫：`physics.update` 真的换了"不碰撞的世界"、三个交互入口真的挡住了。
 */

import {
  GAME_MODES,
  gameModeLabel,
  canBreakBlocks,
  canFly,
  canInteract,
  canPlaceBlocks,
  canTakeDamage,
  hasBlockCollision,
  isAdventureMode,
  isCreativeMode,
  isGameMode,
  isSpectatorMode,
  nextGameMode,
  normalizeGameMode,
  type GameMode,
} from '../web/src/core/world/GameMode.ts';
// 极限模式的唯一判据（2026-10-28）：这一节直接断言纯函数，不再靠源码字符串猜
import {
  canChangeGameMode,
  effectiveDifficulty,
  effectiveGameMode,
  restoredGameMode,
} from '../web/src/core/world/Hardcore.ts';
import { readFileSync } from 'node:fs';

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

console.log('\n[四种模式]');
{
  equal('一共四种', GAME_MODES.length, 4);
  equal('顺序是 生存 → 创造 → 冒险 → 旁观', GAME_MODES.join(','), 'survival,creative,adventure,spectator');
  for (const mode of GAME_MODES) {
    check(`${mode} 有中文名`, (gameModeLabel(mode) ?? '').length > 0, gameModeLabel(mode));
    check(`isGameMode 认得 ${mode}`, isGameMode(mode));
  }
  check('拼错的不认', !isGameMode('spectater') && !isGameMode('SPECTATOR') && !isGameMode(1));
  equal('不认识的模式回落到生存', normalizeGameMode('nope'), 'survival');
  equal('不认识的模式按指定值回落', normalizeGameMode(null, 'creative'), 'creative');

  equal('生存 → 创造', nextGameMode('survival'), 'creative');
  equal('创造 → 冒险', nextGameMode('creative'), 'adventure');
  equal('冒险 → 旁观', nextGameMode('adventure'), 'spectator');
  equal('旁观 → 生存（四态循环，不会卡在最后一种）', nextGameMode('spectator'), 'survival');
}

console.log('\n[能力矩阵]');
{
  // 每一行：模式 → [创造? 冒险? 旁观? 能飞? 能交互? 能破坏? 能放置? 有碰撞? 会受伤?]
  const table: readonly {
    mode: GameMode;
    creative: boolean;
    adventure: boolean;
    spectator: boolean;
    fly: boolean;
    interact: boolean;
    breakBlocks: boolean;
    placeBlocks: boolean;
    collide: boolean;
    damage: boolean;
  }[] = [
    { mode: 'survival', creative: false, adventure: false, spectator: false, fly: false, interact: true, breakBlocks: true, placeBlocks: true, collide: true, damage: true },
    { mode: 'creative', creative: true, adventure: false, spectator: false, fly: true, interact: true, breakBlocks: true, placeBlocks: true, collide: true, damage: false },
    // 冒险：能走能打能交互，但破坏/放置一律不行
    { mode: 'adventure', creative: false, adventure: true, spectator: false, fly: false, interact: true, breakBlocks: false, placeBlocks: false, collide: true, damage: true },
    // 旁观与创造的三处不同：穿墙、不能交互（能飞与免伤相同）
    { mode: 'spectator', creative: false, adventure: false, spectator: true, fly: true, interact: false, breakBlocks: false, placeBlocks: false, collide: false, damage: false },
  ];

  for (const row of table) {
    equal(`${row.mode}：是创造`, isCreativeMode(row.mode), row.creative);
    equal(`${row.mode}：是冒险`, isAdventureMode(row.mode), row.adventure);
    equal(`${row.mode}：是旁观`, isSpectatorMode(row.mode), row.spectator);
    equal(`${row.mode}：能飞`, canFly(row.mode), row.fly);
    equal(`${row.mode}：能交互`, canInteract(row.mode), row.interact);
    equal(`${row.mode}：能破坏方块`, canBreakBlocks(row.mode), row.breakBlocks);
    equal(`${row.mode}：能放置方块`, canPlaceBlocks(row.mode), row.placeBlocks);
    equal(`${row.mode}：会被方块挡住`, hasBlockCollision(row.mode), row.collide);
    equal(`${row.mode}：会受伤`, canTakeDamage(row.mode), row.damage);
  }

  // 写清楚"为什么不能用 isCreative 顶替旁观"
  check(
    '旁观 ≠ 创造（否则会穿墙失败、还能破坏方块）',
    isCreativeMode('spectator') === false && hasBlockCollision('spectator') === false,
  );
  check(
    '生存与冒险会受伤（创造与旁观都免伤）',
    canTakeDamage('survival') && canTakeDamage('adventure') && !canTakeDamage('creative') && !canTakeDamage('spectator'),
  );
}

console.log('\n[源码守卫：真接上了没有]');
{
  // 这一层测的是"接线"，不是能力——能力矩阵已经在上面的纯函数里测完了
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  check(
    '物理层在旁观时换了"不碰撞的世界"（否则穿墙是假的）',
    /hasBlockCollision\(this\.gameMode\) \? this\.world : this\.spectatorWorld/.test(mainSrc),
  );
  const guards = mainSrc.match(/if \(!canInteract\(this\.gameMode\)\) return;/g) ?? [];
  equal('三个交互入口都挡住了（破坏 / 攻击 / 放置）', guards.length, 3);
  check(
    '旁观模式强制飞行（不强制的话"穿墙 + 重力"会一直往下掉）',
    /if \(next === 'spectator' && !this\.flying\) this\.setFlying\(true\);/.test(mainSrc),
  );
  check(
    '`setFlying` 用的是 `canFly` 而不是 `isCreative`（否则旁观飞不起来）',
    /if \(value && !canFly\(this\.gameMode\)\)/.test(mainSrc),
  );
  check('冒险模式的破坏入口被挡住', mainSrc.includes('if (!canBreakBlocks(this.gameMode)) return;'));
  check('冒险模式的放方块入口被挡住', mainSrc.includes('if (!canPlaceBlocks(this.gameMode)) return;'));
  check('切到冒险/生存时强制落地', /if \(!canFly\(next\) && this\.flying\)/.test(mainSrc));
  // 极限模式（批次 550 / 2026-10-28）：死亡转旁观、难度与模式都锁死
  check('极限模式死亡后转旁观（走 internal 放行）', mainSrc.includes("this.setGameMode('spectator', true);"));
  check('极限模式锁住难度修改', mainSrc.includes('if (this.hardcore) return;'));
  check('极限模式锁住模式修改', mainSrc.includes('canChangeGameMode(this.hardcore)'));
  check('极限世界不把"死亡转旁观"写回世界清单', mainSrc.includes('if (!this.hardcore) this.onGameModeChanged?.(next);'));
  // 纯函数口径（`core/world/Hardcore.ts`）：创建/读档/展示三处必须走同一套判定
  equal('极限创建恒为生存', effectiveGameMode(true, 'creative'), 'survival');
  equal('普通世界保留创造', effectiveGameMode(false, 'creative'), 'creative');
  equal('极限读档保住旁观（死亡状态要跨重启）', restoredGameMode(true, 'spectator'), 'spectator');
  equal('极限读档把创造拉回生存', restoredGameMode(true, 'creative'), 'survival');
  equal('极限难度恒为困难', effectiveDifficulty(true, 'peaceful'), 'hard');
  check('极限不允许玩家改模式', canChangeGameMode(true) === false && canChangeGameMode(false) === true);
}

console.log(`\n游戏模式测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
