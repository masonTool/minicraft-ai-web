/**
 * 生物目标规则（J3 第一批，批次 512）
 *
 * 这一批把"谁打谁"从 `main.tickGuardians` 里写死的铁傀儡分支抽成规则表，
 * 并接上第二种消费者（狼）。断言分三层：
 *  ① 表本身：哪些生物有规则、参数是多少；
 *  ② `ruleAccepts`：野狼只捕猎小动物、驯服狼只打敌对、铁傀儡只打敌对；
 *  ③ 与 `nearestHostileTarget` 合起来的选择结果（最近 / 并列 / 半径 / 尸体）。
 *
 * 运行：npm run test:target
 */

import { readFileSync } from 'node:fs';
import {
  SNOW_GOLEM_THROW_ARC,
  SNOW_GOLEM_THROW_SPEED,
  ruleAccepts,
  targetRuleFor,
} from '../web/src/core/entity/TargetRules.ts';
import {
  GUARD_ATTACK_COOLDOWN,
  GUARD_ATTACK_RANGE,
  GUARD_DAMAGE,
  GUARD_RANGE,
  nearestHostileTarget,
} from '../web/src/core/world/GuardAI.ts';

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

interface Candidate {
  type: { id: string; hostile: boolean };
  x: number;
  y: number;
  z: number;
  dead: boolean;
}

function mob(id: string, x: number, z: number, hostile = false, dead = false): Candidate {
  return { type: { id, hostile }, x, y: 64, z, dead };
}

// ---------------------------------------------------------------- 1. 规则表

console.log('\n[规则表：谁有攻击规则]');
{
  check('铁傀儡有规则', targetRuleFor('iron_golem', false) !== null);
  check('野狼有规则', targetRuleFor('wolf', false) !== null);
  check('驯服的狼有规则', targetRuleFor('wolf', true) !== null);
  equal('羊没有规则', targetRuleFor('sheep', false), null);
  equal('僵尸没有规则（它追玩家走 Mob.tick）', targetRuleFor('zombie', false), null);
  check('雪傀儡有规则（批次 513）', targetRuleFor('snow_golem', false) !== null);
}

console.log('\n[规则表：参数]');
{
  const golem = targetRuleFor('iron_golem', false)!;
  equal('铁傀儡索敌半径', golem.range, GUARD_RANGE);
  equal('铁傀儡触及', golem.attackRange, GUARD_ATTACK_RANGE);
  equal('铁傀儡出手间隔', golem.cooldown, GUARD_ATTACK_COOLDOWN);
  equal('铁傀儡伤害', golem.damage, GUARD_DAMAGE);
  check('铁傀儡只打敌对', golem.hostileOnly && golem.ids === null);

  const wild = targetRuleFor('wolf', false)!;
  check('野狼不是"只打敌对"', !wild.hostileOnly);
  check('野狼有猎物白名单', wild.ids !== null && wild.ids.has('sheep') && wild.ids.has('rabbit') && wild.ids.has('chicken'));
  check('野狼不把牛算猎物', !wild.ids!.has('cow'));

  const tamed = targetRuleFor('wolf', true)!;
  check('驯服狼只打敌对', tamed.hostileOnly && tamed.ids === null);
  check('驯服狼比野狼快（间隔更短或相同）', tamed.cooldown <= wild.cooldown + 1e-9);

  const snow = targetRuleFor('snow_golem', false)!;
  equal('雪傀儡射程', snow.range, 10);
  equal('雪傀儡出手间隔', snow.cooldown, 1.5);
  equal('雪傀儡不靠雪球造成伤害（原版 0 点，只有击退）', snow.damage, 0);
  check('雪傀儡是远程', snow.ranged && snow.hostileOnly);
  check('雪傀儡的初速与抬升是正数', SNOW_GOLEM_THROW_SPEED > 0 && SNOW_GOLEM_THROW_ARC > 0);
}

// ---------------------------------------------------------------- 2. 目标判定

console.log('\n[ruleAccepts：谁能打谁]');
{
  const golem = targetRuleFor('iron_golem', false)!;
  check('铁傀儡打僵尸', ruleAccepts(golem, mob('zombie', 0, 0, true)));
  check('铁傀儡不打羊', !ruleAccepts(golem, mob('sheep', 0, 0)));
  check('铁傀儡不打狼', !ruleAccepts(golem, mob('wolf', 0, 0)));

  const wild = targetRuleFor('wolf', false)!;
  check('野狼打羊', ruleAccepts(wild, mob('sheep', 0, 0)));
  check('野狼打兔', ruleAccepts(wild, mob('rabbit', 0, 0)));
  check('野狼打鸡', ruleAccepts(wild, mob('chicken', 0, 0)));
  check('野狼不打牛', !ruleAccepts(wild, mob('cow', 0, 0)));
  check('野狼不打僵尸', !ruleAccepts(wild, mob('zombie', 0, 0, true)));
  check('野狼不打其它狼', !ruleAccepts(wild, mob('wolf', 0, 0)));

  const snow = targetRuleFor('snow_golem', false)!;
  check('雪傀儡打僵尸', ruleAccepts(snow, mob('zombie', 0, 0, true)));
  check('雪傀儡不打羊', !ruleAccepts(snow, mob('sheep', 0, 0)));

  const tamed = targetRuleFor('wolf', true)!;
  check('驯服狼打僵尸', ruleAccepts(tamed, mob('zombie', 0, 0, true)));
  check('驯服狼打骷髅', ruleAccepts(tamed, mob('skeleton', 0, 0, true)));
  check('驯服狼不打羊（主人没让它打）', !ruleAccepts(tamed, mob('sheep', 0, 0)));
}

// ---------------------------------------------------------------- 3. 选择结果

console.log('\n[选择：最近 / 并列 / 半径 / 尸体]');
{
  const golem = targetRuleFor('iron_golem', false)!;
  const accept = (candidate: Candidate): boolean => ruleAccepts(golem, candidate);

  const one = nearestHostileTarget({ x: 0, y: 64, z: 0 }, [mob('zombie', 5, 0, true)], golem.range, accept);
  equal('五格外的僵尸会被选中', one?.target.type.id, 'zombie');
  equal('距离是水平距离', one?.distance, 5);

  const nearest = nearestHostileTarget(
    { x: 0, y: 64, z: 0 },
    [mob('zombie', 8, 0, true), mob('skeleton', 3, 0, true)],
    golem.range,
    accept,
  );
  equal('取最近的那只', nearest?.target.type.id, 'skeleton');

  const tie = nearestHostileTarget(
    { x: 0, y: 64, z: 0 },
    [mob('zombie', 4, 0, true), mob('skeleton', -4, 0, true)],
    golem.range,
    accept,
  );
  equal('距离并列按 id 定序（不会来回抖）', tie?.target.type.id, 'skeleton');

  const far = nearestHostileTarget({ x: 0, y: 64, z: 0 }, [mob('zombie', 20, 0, true)], golem.range, accept);
  equal('超出半径不选', far, null);

  const dead = nearestHostileTarget({ x: 0, y: 64, z: 0 }, [mob('zombie', 1, 0, true, true)], golem.range, accept);
  equal('尸体不选', dead, null);

  const own = mob('iron_golem', 1, 0, false);
  const self = nearestHostileTarget(
    { x: 0, y: 64, z: 0 },
    [own],
    golem.range,
    (candidate) => candidate !== own && ruleAccepts(golem, candidate),
  );
  equal('不会把自己选成目标', self, null);

  const wild = targetRuleFor('wolf', false)!;
  const prey = nearestHostileTarget(
    { x: 0, y: 64, z: 0 },
    [mob('sheep', 6, 0), mob('cow', 1, 0), mob('rabbit', 4, 0)],
    wild.range,
    (candidate) => ruleAccepts(wild, candidate),
  );
  equal('野狼穿过牛去追兔子', prey?.target.type.id, 'rabbit');
}

// ---------------------------------------------------------------- 4. 接线守卫

console.log('\n[接线守卫]');
{
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  check('主程序用规则表拿参数', mainSrc.includes('targetRuleFor(entity.type.id, entity.tamed === true)'));
  check('不再写死 iron_golem 分支', !mainSrc.includes("entity.type.id !== 'iron_golem'"));
  check('伤害/冷却来自规则', mainSrc.includes('entity.guardCooldown = rule.cooldown') && mainSrc.includes('rule.damage'));
  check('恐慌优先只给"打敌对"的规则', mainSrc.includes('rule.hostileOnly ? hostiles.filter'));

  const rulesSrc = readFileSync(new URL('../web/src/core/entity/TargetRules.ts', import.meta.url), 'utf8');
  check('规则表里有狼', rulesSrc.includes("typeId === 'wolf'"));
  check('规则表里有雪傀儡', rulesSrc.includes("typeId === 'snow_golem'"));
  check('主程序给远程规则单独一条分支', mainSrc.includes('if (rule.ranged)'));
  check('雪球走共用投掷通道', mainSrc.includes("'snowball'") && mainSrc.includes('throwSnowballFrom'));
}

console.log(`\n目标规则测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
