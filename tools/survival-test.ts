/**
 * 生存机制离线测试
 *
 * 运行：npm run test:survival
 *
 * 覆盖：摔落伤害、无敌帧、疲劳值与饥饿、自然回复、饿死、溺水、
 * 岩浆 / 虚空伤害、创造模式免疫、死亡与重生。
 * 所有断言都按原版的 20 tick/秒 节奏推导。
 */

import {
  MAX_AIR,
  MAX_FOOD,
  MAX_HEALTH,
  VOID_DAMAGE_Y,
  PlayerStats,
  depthStriderMultiplier,
  fallDamageFor,
  soulSpeedMultiplier,
  type SurvivalEnvironment,
} from '../src/core/survival/PlayerStats.ts';
import { touchesCactus } from '../src/core/world/Cactus.ts';
import { boxAt, type CollisionWorld } from '../src/core/physics/AABB.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}

function env(overrides: Partial<SurvivalEnvironment> = {}): SurvivalEnvironment {
  return {
    eyeInWater: false,
    inLava: false,
    onCactus: false,
    suffocating: false,
    fallDistance: 0,
    y: 64,
    creative: false,
    ...overrides,
  };
}

function runTicks(stats: PlayerStats, count: number, environment: SurvivalEnvironment): void {
  for (let i = 0; i < count; i++) stats.tick(environment);
}

console.log('\n[摔落伤害]');
{
  const stats = new PlayerStats();
  runTicks(stats, 1, env({ fallDistance: 3 }));
  check('下落 3 格以内不受伤', stats.health === MAX_HEALTH, `剩余 ${stats.health}`);

  runTicks(stats, 1, env({ fallDistance: 4 }));
  check('下落 4 格扣 1 点', stats.health === MAX_HEALTH - 1, `剩余 ${stats.health}`);

  const stats2 = new PlayerStats();
  runTicks(stats2, 1, env({ fallDistance: 10 }));
  check('下落 10 格扣 7 点', stats2.health === MAX_HEALTH - 7, `剩余 ${stats2.health}`);

  const stats3 = new PlayerStats();
  runTicks(stats3, 1, env({ fallDistance: 30 }));
  check('致命摔落直接死亡', stats3.dead, `剩余 ${stats3.health}`);
}

console.log('\n[摔落保护附魔（批次 243）]');
{
  const maxed = new PlayerStats();
  runTicks(maxed, 1, env({ fallDistance: 10, featherFalling: 4 }));
  check('摔落保护 IV：10 格只受 3 点（原 7 点）', maxed.health === MAX_HEALTH - 3, `剩余 ${maxed.health}`);

  const mild = new PlayerStats();
  runTicks(mild, 1, env({ fallDistance: 10, featherFalling: 1 }));
  check('摔落保护 I：10 格受 6 点（每级 -12%）', mild.health === MAX_HEALTH - 6, `剩余 ${mild.health}`);

  const short = new PlayerStats();
  runTicks(short, 1, env({ fallDistance: 4, featherFalling: 4 }));
  check('4 格 + 摔落保护 IV 完全免伤', short.health === MAX_HEALTH, `剩余 ${short.health}`);

  check('纯函数：4 格落差 + IV = 0', fallDamageFor(4, 4) === 0);
  check('纯函数：10 格落差 + IV = 3', fallDamageFor(10, 4) === 3);
  check('纯函数：3 格以内恒为 0', fallDamageFor(3, 0) === 0);
  check('纯函数：等级传负数按 0 算', fallDamageFor(10, -2) === 7);
}

console.log('\n[无敌帧]');
{
  const stats = new PlayerStats();
  stats.damage(3, 'generic');
  check('首次伤害立即生效', stats.health === MAX_HEALTH - 3, `剩余 ${stats.health}`);

  const blocked = stats.damage(2, 'generic');
  check('无敌帧内同等或更小的伤害被挡下', blocked.applied === 0 && stats.health === MAX_HEALTH - 3);

  const stronger = stats.damage(5, 'generic');
  check('无敌帧内更高的伤害仍然生效', stronger.applied === 5, `实际 ${stronger.applied}`);

  const stats2 = new PlayerStats();
  // 饥饿压到 18 以下，避免自然回血干扰这项断言
  stats2.food = 17;
  stats2.damage(1, 'generic');
  for (let i = 0; i < 10; i++) stats2.tick(env());
  check('10 tick 后恢复可受伤', !stats2.invulnerable);
  stats2.damage(2, 'generic');
  check('无敌帧结束后再次受伤生效', stats2.health === MAX_HEALTH - 3, `剩余 ${stats2.health}`);
}

console.log('\n[疲劳值与饥饿]');
{
  const stats = new PlayerStats();
  // 走路：每格 0.01，走 300 格只攒 3.0，不足 4 点不扣饥饿
  stats.addExhaustion(3.0);
  runTicks(stats, 1, env());
  check('疲劳值不足 4 点时不扣饥饿', stats.food === MAX_FOOD && stats.saturation === 5, `饥饿 ${stats.food} 饱和 ${stats.saturation}`);

  stats.addExhaustion(1.0);
  check('攒满 4 点后先扣饱和度', stats.saturation === 4 && stats.food === MAX_FOOD, `饥饿 ${stats.food} 饱和 ${stats.saturation}`);

  // 4 点饱和度 + 1 点饥饿 = 5 × 4.0 疲劳值
  stats.addExhaustion(20);
  check('饱和度耗尽后开始扣饥饿值', stats.saturation === 0 && stats.food === MAX_FOOD - 1, `饥饿 ${stats.food} 饱和 ${stats.saturation}`);

  const sprint = new PlayerStats();
  sprint.addExhaustion(40 * 0.1); // 疾跑 40 格 = 4.0 疲劳值
  check('疾跑 40 格扣 1 点饱和度（0.1/格）', sprint.saturation === 4, `饱和 ${sprint.saturation}`);
  const walk = new PlayerStats();
  walk.addExhaustion(400 * 0.01); // 走路 400 格才等于疾跑 40 格
  check('走路 400 格才扣 1 点饱和度（0.01/格）', walk.saturation === 4, `饱和 ${walk.saturation}`);
}

console.log('\n[自然回复与饿死]');
{
  const stats = new PlayerStats();
  stats.health = 10;
  runTicks(stats, 10, env());
  check('有饱和度时每 10 tick 回 1 点生命', stats.health === 11, `生命 ${stats.health}`);

  const slow = new PlayerStats();
  slow.health = 10;
  slow.saturation = 0;
  runTicks(slow, 10, env());
  check('没有饱和度时 10 tick 还回不了血', slow.health === 10, `生命 ${slow.health}`);
  runTicks(slow, 70, env());
  check('没有饱和度时每 80 tick 回 1 点', slow.health === 11, `生命 ${slow.health}`);

  const starving = new PlayerStats();
  starving.food = 0;
  runTicks(starving, 79, env());
  check('饥饿为 0 的前 79 tick 不掉血', starving.health === MAX_HEALTH, `生命 ${starving.health}`);
  runTicks(starving, 1, env());
  check('饥饿为 0 满 80 tick 掉 1 点生命', starving.health === MAX_HEALTH - 1, `生命 ${starving.health}`);

  const fed = new PlayerStats();
  fed.health = 17;
  runTicks(fed, 30, env());
  check('吃饱状态持续回血到满', fed.health === MAX_HEALTH, `生命 ${fed.health}`);

  // 回血本身要消耗疲劳值（原版 6 点/次），所以饥饿总会被耗光
  const drain = new PlayerStats();
  drain.health = 1;
  runTicks(drain, 600, env());
  check('长期回血会把饱和度与饥饿耗掉', drain.saturation === 0 && drain.food < MAX_FOOD, `饥饿 ${drain.food} 饱和 ${drain.saturation}`);
}

console.log('\n[溺水]');
{
  const stats = new PlayerStats();
  check('水下初始氧气为 300', stats.air === MAX_AIR);
  runTicks(stats, 300, env({ eyeInWater: true }));
  check('水下 300 tick 氧气耗尽', stats.air === 0, `氧气 ${stats.air}`);
  check('氧气耗尽当 tick 还没开始掉血', stats.health === MAX_HEALTH, `生命 ${stats.health}`);
  runTicks(stats, 20, env({ eyeInWater: true }));
  check('缺氧 20 tick 后掉 1 点生命', stats.health === MAX_HEALTH - 1, `生命 ${stats.health}`);

  runTicks(stats, 10, env());
  check('出水后氧气每 tick 回复 4 点', stats.air === 40, `氧气 ${stats.air}`);
}

console.log('\n[水下呼吸附魔（批次 243）]');
{
  const stats = new PlayerStats();
  runTicks(stats, 300, env({ eyeInWater: true, respiration: 3 }));
  check(
    '水下呼吸 III：300 tick 只耗掉 120 点氧气（2.5 倍憋气时间）',
    Math.abs(stats.air - (MAX_AIR - 120)) <= 1,
    `氧气 ${stats.air}`,
  );
  check('氧气还没耗尽，所以不掉血', stats.health === MAX_HEALTH, `生命 ${stats.health}`);

  // 出水再入水：小数累积要清零，否则两次潜水会"攒出一次额外消耗"
  runTicks(stats, 1, env());
  const refilled = stats.air;
  runTicks(stats, 2, env({ eyeInWater: true, respiration: 3 }));
  check('出水后重新憋气从整数点开始扣', stats.air <= refilled, `氧气 ${refilled} → ${stats.air}`);
}

console.log('\n[岩浆与虚空]');
{
  const stats = new PlayerStats();
  runTicks(stats, 9, env({ inLava: true }));
  check('岩浆前 9 tick 不结算伤害（10 tick 一次）', stats.health === MAX_HEALTH, `生命 ${stats.health}`);
  runTicks(stats, 1, env({ inLava: true }));
  check('岩浆每 10 tick 扣 4 点', stats.health === MAX_HEALTH - 4, `生命 ${stats.health}`);

  const voided = new PlayerStats();
  runTicks(voided, 3, env({ y: VOID_DAMAGE_Y - 1 }));
  check('虚空每 tick 扣 4 点（无视无敌帧）', voided.health === MAX_HEALTH - 12, `生命 ${voided.health}`);

  const high = new PlayerStats();
  runTicks(high, 5, env({ y: VOID_DAMAGE_Y + 1 }));
  check('虚空高度之上不受伤害', high.health === MAX_HEALTH, `生命 ${high.health}`);

  const suffocating = new PlayerStats();
  runTicks(suffocating, 1, env({ suffocating: true }));
  check('窒息扣 1 点', suffocating.health === MAX_HEALTH - 1, `生命 ${suffocating.health}`);

  // 岩浆块（批次 121）：站在上面每秒 1 点**火焰伤害**。
  // ⚠️ 与岩浆那条的节奏不同（那里是 0.5 秒 4 点），所以前 19 tick 一滴都不掉
  const onMagma = new PlayerStats();
  // ⚠️ 长跑那几条要**关掉自然回血**（`naturalRegeneration: false`）：
  // 吃饱时每 0.5 秒回 1 点，比岩浆块的 1 点/秒还快——不关掉的话，
  // "站三秒扣 4 点"会被回血抵掉，看起来像"只扣了 1 点"（第一版就踩到了）
  const magmaEnv = (extra: Partial<SurvivalEnvironment> = {}): SurvivalEnvironment =>
    env({ onMagma: true, naturalRegeneration: false, ...extra });
  runTicks(onMagma, 19, magmaEnv());
  check('岩浆块前 19 tick 不结算（每秒一次）', onMagma.health === MAX_HEALTH, `生命 ${onMagma.health}`);
  runTicks(onMagma, 1, magmaEnv());
  check('岩浆块每秒扣 1 点', onMagma.health === MAX_HEALTH - 1, `生命 ${onMagma.health}`);
  runTicks(onMagma, 60, magmaEnv());
  check('站三秒就是 4 点（第 1 秒那次也在内）', onMagma.health === MAX_HEALTH - 4, `生命 ${onMagma.health}`);

  // 抗火挡得住（走的是 `'fire'` 那条 source——与岩浆同一个口径）
  const fireProof = new PlayerStats();
  runTicks(fireProof, 100, env({ onMagma: true, fireImmune: true }));
  check('抗火效果能挡住岩浆块（原版也如此）', fireProof.health === MAX_HEALTH, `生命 ${fireProof.health}`);

  // 走开之后计时器归零：否则"站一下、走开、再站上去"会立刻又挨一次
  const stepped = new PlayerStats();
  runTicks(stepped, 19, env({ onMagma: true }));
  runTicks(stepped, 1, env());
  runTicks(stepped, 1, env({ onMagma: true }));
  check('离开岩浆块会重置计时（再站上去要重新数满一秒）', stepped.health === MAX_HEALTH, `生命 ${stepped.health}`);
  runTicks(stepped, 19, env({ onMagma: true }));
  check('数满之后照常扣 1 点', stepped.health === MAX_HEALTH - 1, `生命 ${stepped.health}`);
}

console.log('\n[伤害记录（批次 207）]');
{
  const stats = new PlayerStats();
  stats.damage(3, 'generic', '僵尸');
  // 中毒绕过无敌帧，正好用来验证"同帧多次伤害都会被记下来"
  stats.poisonDamage(1, '中毒效果');
  const log = stats.takeDamageLog();
  check(
    '每次伤害都记下类型与具体来源',
    log.length === 2 &&
      log[0].cause === 'generic' &&
      log[0].source === '僵尸' &&
      log[0].applied === 3 &&
      log[1].cause === 'poison' &&
      log[1].source === '中毒效果',
    JSON.stringify(log),
  );
  check('取走之后队列清空', stats.takeDamageLog().length === 0);
  check('没有伤害时不产生记录', stats.takeDamageLog().length === 0);
}

console.log('\n[创造模式与重生]');
{
  // 创造模式免疫岩浆 / 摔落 / 仙人掌，饥饿与氧气保持满值（虚空单独测，见下）
  const stats = new PlayerStats();
  stats.food = 3;
  stats.health = 5;
  runTicks(stats, 100, env({ creative: true, inLava: true, fallDistance: 20, onCactus: true }));
  check('创造模式不受伤、不消耗饥饿、氧气满', stats.health === 5 && stats.food === MAX_FOOD && stats.air === MAX_AIR,
    `生命 ${stats.health} 饥饿 ${stats.food}`);

  // 虚空是创造模式**唯一**还会受伤的自然伤害（批次 230，原版同口径）：
  // 掉出世界必须有反馈，否则玩家会在虚空里无限下坠、只能靠飞回来
  const voidStats = new PlayerStats();
  runTicks(voidStats, 1, env({ creative: true, y: VOID_DAMAGE_Y - 5 }));
  check('创造模式掉虚空仍受伤（每 tick 4 点）', voidStats.health === MAX_HEALTH - 4, `剩余 ${voidStats.health}`);
  runTicks(voidStats, 10, env({ creative: true, y: VOID_DAMAGE_Y - 5 }));
  check('创造模式掉虚空会死（不会卡在虚空里）', voidStats.dead, `剩余 ${voidStats.health}`);
  check('虚空伤害的原因记为 void', voidStats.lastDamage?.cause === 'void');

  const dead = new PlayerStats();
  dead.damage(100, 'generic');
  check('生命归零即死亡', dead.dead);
  runTicks(dead, 50, env({ inLava: true, eyeInWater: true }));
  check('死亡后不再继续结算', dead.health === 0 && dead.air === MAX_AIR);

  dead.respawn();
  check('重生恢复满状态', dead.health === MAX_HEALTH && dead.food === MAX_FOOD && dead.air === MAX_AIR && !dead.dead);
  check('重生清空疲劳值与累计伤害记录', dead.exhaustion === 0 && dead.lastDamage === null);
  check('重生也清空待播报的伤害记录', dead.takeDamageLog().length === 0);
}

console.log('\n[仙人掌接触（批次 222）]');
{
  // 14/16 宽的仙人掌在 (1, 64, 0)
  const cactus: CollisionWorld = {
    collisionAt(x, y, z) {
      if (x === 1 && y === 64 && z === 0) return [[0.0625, 0, 0.0625, 0.9375, 1, 0.9375]] as const;
      return null;
    },
  };
  const isCactus = (x: number, y: number, z: number): boolean => x === 1 && y === 64 && z === 0;

  // 玩家被整格钳制停在 x=0.6999（右边缘 0.9999），与仙人掌盒还差 1/16
  const beside = boxAt(0.6999, 64, 0.5, 0.6, 1.8);
  check('贴着仙人掌算接触（带 0.1 横向容差）', touchesCactus(cactus, beside, isCactus));

  const far = boxAt(0.2, 64, 0.5, 0.6, 1.8);
  check('隔着一格不算', !touchesCactus(cactus, far, isCactus));

  // 站在仙人掌顶上：横向是重叠的，但脚底与盒顶只剩"贴边"——不能算贴着掉血
  const onTop = boxAt(1.5, 65, 0.5, 0.6, 1.8);
  check('站在顶上不掉血（容差只放大 X/Z）', !touchesCactus(cactus, onTop, isCactus));

  // 方形完整方块（老形状）走 'full' 快路径也要能判
  const fullWorld: CollisionWorld = { collisionAt: () => 'full' as const };
  check('完整方块也走同一条判据', touchesCactus(fullWorld, boxAt(0.0, 64, 0.5, 0.6, 1.8), () => true));
}

console.log('\n[靴子附魔的移速倍率（批次 262）]');
{
  check('深海探索者 0 级 = 1 倍', depthStriderMultiplier(0) === 1);
  check(
    '深海探索者 I 级 ≈ 1.33',
    Math.abs(depthStriderMultiplier(1) - 1.333) < 0.001,
    `${depthStriderMultiplier(1)}`,
  );
  check('深海探索者 III 级封顶 2 倍', depthStriderMultiplier(3) === 2);
  check('深海探索者超过上限按 3 级算', depthStriderMultiplier(5) === 2);
  check('灵魂疾行 0 级 = 1 倍', soulSpeedMultiplier(0) === 1);
  check('灵魂疾行 I 级 = 1.3', Math.abs(soulSpeedMultiplier(1) - 1.3) < 1e-6);
  check('灵魂疾行 III 级 = 1.9', Math.abs(soulSpeedMultiplier(3) - 1.9) < 1e-6);
}

console.log(`\n生存测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
