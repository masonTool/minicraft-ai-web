/**
 * 逐武器攻击冷却与冷却条（G8，批次 506）
 *
 * 纯逻辑两层：`attackCooldownFor`（武器 → 秒）与 `attackChargeProgress`（剩余 → 0~1）。
 * 再加两条源码守卫：主程序真的用了这张表、HUD 真的在 `#hud` 里。
 *
 * 运行：npm run test:attack
 */

import { readFileSync } from 'node:fs';
import {
  HAND_ATTACK_COOLDOWN,
  attackChargeProgress,
  attackCooldownFor,
} from '../web/src/core/combat/AttackSpeed.ts';
import type { ToolMaterial, ToolType } from '../web/src/core/registry/tools.ts';

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

function near(label: string, actual: number, expected: number): void {
  check(label, Math.abs(actual - expected) < 1e-9, `实际 ${actual}，期望 ${expected}`);
}

const ALL_TYPES: readonly ToolType[] = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears', 'trident'];
const ALL_MATERIALS: readonly ToolMaterial[] = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];

console.log('\n[徒手与剑]');
{
  near('徒手 0.25 秒', attackCooldownFor(null), 0.25);
  equalClose('空手常量与函数一致', HAND_ATTACK_COOLDOWN, attackCooldownFor(null));
  near('剑 0.625 秒（原版 1.6 次/秒）', attackCooldownFor({ type: 'sword', material: 'iron' }), 0.625);
  near('剑的冷却与材质无关', attackCooldownFor({ type: 'sword', material: 'wooden' }), 0.625);
}

function equalClose(label: string, a: number, b: number): void {
  check(label, Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
}

console.log('\n[斧：按材质分档]');
{
  near('木斧 1.25 秒', attackCooldownFor({ type: 'axe', material: 'wooden' }), 1.25);
  near('石斧 1.25 秒', attackCooldownFor({ type: 'axe', material: 'stone' }), 1.25);
  near('铁斧 1/0.9 秒', attackCooldownFor({ type: 'axe', material: 'iron' }), 1 / 0.9);
  near('金斧 1 秒', attackCooldownFor({ type: 'axe', material: 'golden' }), 1);
  near('钻石斧 1 秒', attackCooldownFor({ type: 'axe', material: 'diamond' }), 1);
  near('下界合金斧 1 秒', attackCooldownFor({ type: 'axe', material: 'netherite' }), 1);
  check(
    '斧比剑慢（同材质）',
    attackCooldownFor({ type: 'axe', material: 'iron' }) > attackCooldownFor({ type: 'sword', material: 'iron' }),
  );
}

console.log('\n[其它工具与覆盖]');
{
  near('镐 1/1.2 秒', attackCooldownFor({ type: 'pickaxe', material: 'iron' }), 1 / 1.2);
  near('锹 1 秒', attackCooldownFor({ type: 'shovel', material: 'diamond' }), 1);
  near('锄 1 秒', attackCooldownFor({ type: 'hoe', material: 'wooden' }), 1);
  near('剪刀 1 秒', attackCooldownFor({ type: 'shears', material: 'iron' }), 1);
  near('三叉戟 1/1.1 秒', attackCooldownFor({ type: 'trident', material: 'iron' }), 1 / 1.1);

  let bad: string[] = [];
  for (const type of ALL_TYPES) {
    for (const material of ALL_MATERIALS) {
      const seconds = attackCooldownFor({ type, material });
      if (!(seconds > 0) || !Number.isFinite(seconds)) bad.push(`${type}/${material}`);
    }
  }
  equal('所有 种类×材质 组合都有有限且为正的冷却', bad.length, 0);
  check('（缺的是）', bad.length === 0, bad.join(' '));
}

console.log('\n[进度换算]');
{
  near('刚打完是 0', attackChargeProgress(0.625, 0.625), 0);
  near('冷却好了是 1', attackChargeProgress(0, 0.625), 1);
  near('剩一半是 0.5', attackChargeProgress(0.5, 1), 0.5);
  near('负数剩余夹到 1', attackChargeProgress(-3, 1), 1);
  near('超过最大值夹到 0', attackChargeProgress(9, 1), 0);
  near('max=0 直接算满（不除零）', attackChargeProgress(0, 0), 1);

  // 冷却条是按进度画的：单调递增
  let monotonic = true;
  let previous = -1;
  for (let i = 0; i <= 10; i++) {
    const progress = attackChargeProgress(1 - i / 10, 1);
    if (progress < previous) monotonic = false;
    previous = progress;
  }
  check('进度随剩余冷却减少而单调递增', monotonic);
}

console.log('\n[接线守卫]');
{
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  const hudSrc = readFileSync(new URL('../web/src/ui/AttackCooldownHud.ts', import.meta.url), 'utf8');
  const htmlSrc = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

  check('主程序用了逐武器冷却表', mainSrc.includes('attackCooldownFor(this.heldTool)'));
  check('攻击时记下了这次的总冷却', mainSrc.includes('this.attackCooldownMax = this.attackCooldown'));
  check('每帧更新冷却条', mainSrc.includes('this.attackCooldownHud.update('));
  check('HUD 的进度来自纯函数', hudSrc.includes('attackChargeProgress('));
  check('样式里有冷却条', htmlSrc.includes('#attack-cooldown'));
}

console.log(`\n攻击冷却测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
