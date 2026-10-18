/**
 * 状态效果（I4）与玩家生存数值（I7 影响面）离线测试
 *
 * 效果系统最容易错的三处，这里都钉住：
 *  1. **时长按 tick 走**（20 tick = 1 秒），且低等级顶不掉高等级
 *  2. **中毒不致死**、凋零致死（原版就这么设计的，写得不对玩家会被毒死）
 *  3. 各项数值倍率（移速/跳跃/挖掘/受伤/吸收）**互相叠加**而不是互相覆盖
 *
 * 运行：npm run test:effects
 */

import {
  EFFECTS,
  EFFECT_LABELS,
  StatusEffects,
  resolveEffect,
  romanLevel,
  type EffectId,
} from '../src/core/survival/StatusEffects.ts';
import { MAX_HEALTH, PlayerStats } from '../src/core/survival/PlayerStats.ts';

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

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

/** 推进 n tick */
function advance(effects: StatusEffects, ticks: number): void {
  for (let i = 0; i < ticks; i++) effects.tick();
}

// ---------------------------------------------------------------- 1. 名称

console.log('\n[效果名解析]');
{
  check(`共 ${EFFECTS.length} 种效果（I4 要求约 30 种）`, EFFECTS.length >= 28, String(EFFECTS.length));
  check('每种都有中文名', EFFECTS.every((id) => EFFECT_LABELS[id]?.length > 0));
  check('英文 id 可解析', resolveEffect('speed') === 'speed');
  check('带命名空间可解析', resolveEffect('minecraft:poison') === 'poison');
  check('中文名可解析', resolveEffect('夜视') === 'night_vision');
  check('别名可解析（swiftness/jump/regen）', resolveEffect('swiftness') === 'speed' && resolveEffect('jump') === 'jump_boost' && resolveEffect('regen') === 'regeneration');
  check('大小写不敏感', resolveEffect('SPEED') === 'speed');
  check('未知名返回 undefined', resolveEffect('飞行') === undefined);
  check('等级罗马数字', romanLevel(0) === 'I' && romanLevel(1) === 'II' && romanLevel(9) === 'X');
}

// ---------------------------------------------------------------- 2. 施加与到期

console.log('\n[施加、覆盖与到期]');
{
  const effects = new StatusEffects();
  check('施加成功', effects.apply('speed', 10, 0));
  check('秒数换算成 tick（10 秒 = 200）', effects.get('speed')?.ticks === 200);
  check('has/amplifierOf 正确', effects.has('speed') && effects.amplifierOf('speed') === 0);

  effects.apply('speed', 5, 2);
  check('更高等级覆盖并刷新时长', effects.amplifierOf('speed') === 2 && effects.get('speed')?.ticks === 100);
  effects.apply('speed', 60, 0);
  check('更低等级顶不掉高等级', effects.amplifierOf('speed') === 2 && effects.get('speed')?.ticks === 100);
  effects.apply('speed', 60, 2);
  check('同等级刷新时长', effects.get('speed')?.ticks === 1200);

  // 上一步把时长刷成了 60 秒（1200 tick），要推进满才会到期
  advance(effects, 1200);
  check('时长递减到 0 后移除', !effects.has('speed'));
  check('还没到期的效果不会被清掉', (() => {
    const keep = new StatusEffects();
    keep.apply('speed', 60, 0);
    advance(keep, 100);
    return keep.has('speed') && keep.get('speed')!.ticks === 1100;
  })());
  check('到期会出现在 tick 结果里', new StatusEffects().apply('speed', 0.05) && true);

  const short = new StatusEffects();
  short.apply('speed', 0.05); // 1 tick
  const expired = short.tick();
  check('tick 结果报告到期效果', expired.expired.includes('speed') && short.count === 0);

  const many = new StatusEffects();
  many.apply('speed', 30);
  many.apply('poison', 30);
  check('可同时存在多种效果', many.count === 2);
  many.clear();
  check('clear 清空全部', many.count === 0);

  check('不认识的效果名被拒绝', !many.apply('nope' as EffectId, 10));
  check('等级会被限制在合理范围', many.apply('speed', 10, 999) && many.amplifierOf('speed') === 255);
}

// ---------------------------------------------------------------- 3. 瞬间效果

console.log('\n[瞬间效果]');
{
  const effects = new StatusEffects();
  effects.apply('instant_health', 0, 1);
  effects.apply('instant_damage', 0, 0);
  const list = effects.takeInstant();
  check('瞬间效果不进持续列表', effects.count === 0 && list.length === 2);
  check('瞬间效果记录等级', list[0]!.id === 'instant_health' && list[0]!.amplifier === 1 && list[1]!.amplifier === 0);
  check('取走后队列清空', effects.takeInstant().length === 0);
}

// ---------------------------------------------------------------- 4. 周期结算

console.log('\n[周期结算：中毒 / 凋零 / 恢复 / 饥饿]');
{
  const poison = new StatusEffects();
  poison.apply('poison', 10, 0);
  let damage = 0;
  for (let i = 0; i < 200; i++) {
    for (const hit of poison.tick().damageHits) damage += hit.amount;
  }
  check('中毒按周期掉血（10 秒约 8 点）', damage >= 7 && damage <= 9, String(damage));

  const wither = new StatusEffects();
  wither.apply('wither', 10, 0);
  let witherDamage = 0;
  let cause: string = '';
  for (let i = 0; i < 200; i++) {
    for (const hit of wither.tick().damageHits) {
      witherDamage += hit.amount;
      cause = hit.cause;
    }
  }
  check('凋零按周期掉血', witherDamage >= 4, String(witherDamage));
  check('凋零的伤害类别是 wither（会致死）', cause === 'wither');

  // 两种同时挂着：**必须各记一条**，不能合并成"一个总数 + 一个 cause"——
  // 合并后凋零会被当成中毒（永远停在半颗心），或者中毒被当成凋零（能打死人）
  const both = new StatusEffects();
  both.apply('poison', 10, 0);
  both.apply('wither', 10, 0);
  let sawPoison = false;
  let sawWither = false;
  for (let i = 0; i < 200; i++) {
    for (const hit of both.tick().damageHits) {
      if (hit.cause === 'poison') sawPoison = true;
      else sawWither = true;
    }
  }
  check('中毒 + 凋零同时挂：两条各自记账，cause 不会互相顶掉', sawPoison && sawWither);

  const regen = new StatusEffects();
  regen.apply('regeneration', 10, 0);
  let heal = 0;
  for (let i = 0; i < 200; i++) heal += regen.tick().heal;
  check('生命恢复按周期回血（10 秒约 4 点）', heal >= 3 && heal <= 5, String(heal));

  const highRegen = new StatusEffects();
  highRegen.apply('regeneration', 10, 1);
  let fastHeal = 0;
  for (let i = 0; i < 200; i++) fastHeal += highRegen.tick().heal;
  check('等级越高回得越快', fastHeal > heal, `${fastHeal} > ${heal}`);

  const hunger = new StatusEffects();
  hunger.apply('hunger', 5, 0);
  let exhaustion = 0;
  for (let i = 0; i < 100; i++) exhaustion += hunger.tick().exhaustion;
  check('饥饿效果持续累积疲劳值', exhaustion > 0, String(exhaustion));

  const saturation = new StatusEffects();
  saturation.apply('saturation', 2, 0);
  let food = 0;
  for (let i = 0; i < 40; i++) food += saturation.tick().food;
  check('饱和效果补饥饿值', food >= 3, String(food));

  const empty = new StatusEffects();
  const emptyTick = empty.tick();
  // 也顺带挡住"`EMPTY_TICK` 的数组被上一轮 push 污染"这类共享引用问题：
  // 上面几段已经跑过中毒/凋零，这里必须是干净的空结果
  check(
    '没有效果时 tick 是空结果（不产生任何副作用，也不带上一轮的伤害）',
    emptyTick.damageHits.length === 0 && emptyTick.heal === 0,
  );
}

// ---------------------------------------------------------------- 5. 数值倍率

console.log('\n[数值倍率]');
{
  const effects = new StatusEffects();
  check('无效果时所有倍率都是 1', effects.moveSpeedMultiplier() === 1 && effects.jumpMultiplier() === 1 && effects.miningSpeedMultiplier() === 1 && effects.incomingDamageMultiplier() === 1);

  effects.apply('speed', 60, 0);
  check('速度 I → 移速 +20%', close(effects.moveSpeedMultiplier(), 1.2));
  effects.apply('speed', 60, 1);
  check('速度 II → +40%', close(effects.moveSpeedMultiplier(), 1.4));
  effects.apply('slowness', 60, 0);
  check('速度与缓慢叠加（1.4 × 0.85）', close(effects.moveSpeedMultiplier(), 1.19, 1e-6), String(effects.moveSpeedMultiplier()));

  const jump = new StatusEffects();
  jump.apply('jump_boost', 60, 0);
  check('跳跃提升抬高起跳速度', jump.jumpMultiplier() > 1);

  const mining = new StatusEffects();
  mining.apply('haste', 60, 1);
  check('急迫 II → 挖掘 +40%', close(mining.miningSpeedMultiplier(), 1.4, 1e-6));
  mining.apply('mining_fatigue', 60, 0);
  check('急迫与挖掘疲劳叠加', close(mining.miningSpeedMultiplier(), 1.4 * 0.7, 1e-6));
  const fatigued = new StatusEffects();
  fatigued.apply('mining_fatigue', 60, 3);
  check('挖掘疲劳最低不会为负', fatigued.miningSpeedMultiplier() > 0);

  const attack = new StatusEffects();
  attack.apply('strength', 60, 0);
  check('力量 I → 伤害 +3', close(attack.attackBonus(), 3));
  attack.apply('weakness', 60, 0);
  check('力量与虚弱抵消', close(attack.attackBonus(), -1));

  const resist = new StatusEffects();
  resist.apply('resistance', 60, 0);
  check('抗性 I → 受伤 -20%', close(resist.incomingDamageMultiplier(), 0.8));
  resist.apply('resistance', 60, 3);
  check('抗性 IV → 免疫', resist.incomingDamageMultiplier() === 0);

  const absorb = new StatusEffects();
  absorb.apply('absorption', 60, 1);
  check('伤害吸收 II → 8 点黄心', absorb.absorption() === 8);
  const boost = new StatusEffects();
  boost.apply('health_boost', 60, 0);
  check('生命提升 → 上限 +4', boost.healthBonus() === 4);

  const flags = new StatusEffects();
  flags.apply('night_vision', 60);
  flags.apply('water_breathing', 60);
  check('布尔查询（夜视/水下呼吸）', flags.nightVision && flags.waterBreathing && !flags.blinded);
  flags.apply('blindness', 60);
  flags.apply('darkness', 60);
  check('失明与黑暗各自独立', flags.blinded && flags.darkened);
  const conduit = new StatusEffects();
  conduit.apply('conduit_power', 60);
  check('潮涌能量也提供水下呼吸', conduit.waterBreathing);
}

// ---------------------------------------------------------------- 6. 描述与存档

console.log('\n[描述与存档]');
{
  const effects = new StatusEffects();
  effects.apply('speed', 65, 1);
  effects.apply('poison', 5, 0);
  const lines = effects.describe();
  check('描述包含中文名与等级', lines[0] === '速度 II 1:05', lines[0]);
  check('描述里倒计时是 mm:ss', lines[1] === '中毒 0:05', lines[1]);

  const data = effects.serialize();
  const restored = new StatusEffects();
  restored.restore(data);
  check('序列化后能还原', restored.count === 2 && restored.get('speed')?.ticks === effects.get('speed')?.ticks);
  check('还原后等级保持', restored.amplifierOf('speed') === 1);

  const messy = new StatusEffects();
  messy.restore([{ id: 'nope', amplifier: 0, ticks: 20 }, { id: 'speed' }, null, 42]);
  check('脏存档数据被逐项丢弃', messy.count === 1 && messy.has('speed'));
  check('缺字段时给安全默认值', messy.get('speed')?.ticks === 20 && messy.get('speed')?.amplifier === 0);
  messy.restore('不是数组');
  check('整体脏数据不抛异常且清空', messy.count === 0);
}

// ---------------------------------------------------------------- 7. 玩家数值联动

console.log('\n[玩家生存数值联动]');
{
  // 中毒不致死
  const stats = new PlayerStats();
  stats.health = 2;
  stats.poisonDamage(1);
  check('中毒不会把玩家打死', stats.health === 1 && !stats.dead);
  stats.poisonDamage(5);
  check('中毒最多打到剩 1 点血', stats.health === 1 && !stats.dead);
  stats.health = 0.5;
  stats.poisonDamage(5);
  check('已经残血时中毒不再扣', stats.health === 0.5);

  // 自然回复受规则控制
  const noRegen = new PlayerStats();
  noRegen.health = 10;
  noRegen.food = 20;
  noRegen.saturation = 5;
  for (let i = 0; i < 200; i++) {
    noRegen.tick({ eyeInWater: false, inLava: false, onCactus: false, suffocating: false, fallDistance: 0, y: 64, creative: false, naturalRegeneration: false });
  }
  check('关掉自然回复后不再回血', noRegen.health === 10, String(noRegen.health));

  const regen = new PlayerStats();
  regen.health = 10;
  regen.food = 20;
  regen.saturation = 5;
  for (let i = 0; i < 200; i++) {
    regen.tick({ eyeInWater: false, inLava: false, onCactus: false, suffocating: false, fallDistance: 0, y: 64, creative: false });
  }
  check('默认（规则开）会自然回血', regen.health > 10, String(regen.health));

  const fast = new PlayerStats();
  fast.health = 10;
  fast.food = 20;
  fast.saturation = 5;
  // 只跑 60 tick：再久两者都会被"疲劳值→饥饿"这条上限压住，看不出差别
  const normalShort = new PlayerStats();
  normalShort.health = 10;
  normalShort.food = 20;
  normalShort.saturation = 5;
  for (let i = 0; i < 60; i++) {
    normalShort.tick({ eyeInWater: false, inLava: false, onCactus: false, suffocating: false, fallDistance: 0, y: 64, creative: false });
  }
  for (let i = 0; i < 60; i++) {
    fast.tick({ eyeInWater: false, inLava: false, onCactus: false, suffocating: false, fallDistance: 0, y: 64, creative: false, regenRate: 0.5 });
  }
  check('和平难度回血更快', fast.health > normalShort.health, `${fast.health} > ${normalShort.health}`);

  // 饿死速率
  const starve = new PlayerStats();
  starve.health = MAX_HEALTH;
  starve.food = 0;
  starve.saturation = 0;
  for (let i = 0; i < 400; i++) {
    starve.tick({ eyeInWater: false, inLava: false, onCactus: false, suffocating: false, fallDistance: 0, y: 64, creative: false });
  }
  check('普通难度饿到 0 会掉血', starve.health < MAX_HEALTH, String(starve.health));

  const peaceful = new PlayerStats();
  peaceful.health = MAX_HEALTH;
  peaceful.food = 0;
  peaceful.saturation = 0;
  for (let i = 0; i < 400; i++) {
    peaceful.tick({ eyeInWater: false, inLava: false, onCactus: false, suffocating: false, fallDistance: 0, y: 64, creative: false, starveRate: 0 });
  }
  check('和平难度（starveRate 0）饿不死', peaceful.health === MAX_HEALTH, String(peaceful.health));

  // 抗性提升的减伤在实际调用方（App.applyIncomingDamage）里乘，这里验证倍率本身
  const resist = new StatusEffects();
  resist.apply('resistance', 60, 1);
  check('抗性 II 把 10 点伤害减到 6', close(10 * resist.incomingDamageMultiplier(), 6));
}

console.log(`\n状态效果测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
