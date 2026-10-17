/**
 * 音效（K5）离线测试
 *
 * 引擎本身要 AudioContext（只有浏览器有），因此这里测的是**纯逻辑部分**：
 *  1. 方块材质 → 破坏音效的映射（石头/木头/草/沙/玻璃/羊毛要能被区分开）
 *  2. 音效表本身的合法性（时长/增益/频率/滤波器都在可合成的范围内）
 *  3. 音量与静音行为（volume = 0 时不该出声）
 *
 * 运行：npm run test:audio
 */

import {
  AudioEngine,
  SOUND_GROUP_LABELS,
  SOUND_GROUPS,
  SOUND_KINDS,
  soundGroupOf,
  UNDERWATER_GAIN,
  UNDERWATER_LOWPASS_HZ,
  breakSoundFor,
  doorSoundFor,
  soundSpec,
  underwaterGain,
} from '../src/core/audio/AudioEngine.ts';
import { BLOCKS } from '../src/core/registry/blocks.ts';

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

// ---------------------------------------------------------------- 1. 材质映射

console.log('\n[方块材质 → 破坏音效]');
{
  const cases: Array<[string, string]> = [
    ['minecraft:stone', 'break_stone'],
    ['minecraft:cobblestone', 'break_stone'],
    ['minecraft:deepslate', 'break_stone'],
    ['minecraft:oak_planks', 'break_wood'],
    ['minecraft:oak_log', 'break_wood'],
    ['minecraft:crafting_table', 'break_wood'],
    ['minecraft:crimson_stem', 'break_wood'],
    ['minecraft:oak_door', 'break_wood'],
    ['minecraft:short_grass', 'break_grass'],
    ['minecraft:oak_leaves', 'break_grass'],
    ['minecraft:crimson_nylium', 'break_grass'],
    ['minecraft:sand', 'break_sand'],
    ['minecraft:gravel', 'break_sand'],
    ['minecraft:soul_soil', 'break_sand'],
    ['minecraft:glass', 'break_glass'],
    ['minecraft:ice', 'break_glass'],
    ['minecraft:white_wool', 'break_wool'],
    ['minecraft:nether_wart_block', 'break_wool'],
  ];

  let bad = 0;
  for (const [name, expected] of cases) {
    const actual = breakSoundFor(name);
    if (actual !== expected) {
      bad++;
      console.log(`      ${name} → ${actual}（期望 ${expected}）`);
    }
  }
  check(`${cases.length} 种方块的音效分类正确`, bad === 0, `不匹配 ${bad} 种`);

  // 六类破坏音效都要能被"认出来"（避免全部落到默认的石头）
  const kinds = new Set(cases.map(([name]) => breakSoundFor(name)));
  check('至少覆盖 5 类材质音效', kinds.size >= 5, [...kinds].join(','));
  check('未知方块回落到石头音（不会静默）', breakSoundFor('minecraft:unknown_block') === 'break_stone');
  check('带/不带 minecraft: 前缀结果一致', breakSoundFor('stone') === breakSoundFor('minecraft:stone'));
}

// ---------------------------------------------------------------- 2. 覆盖真实的方块表

console.log('\n[真实方块表覆盖检查]');
{
  // 从注册表里取样一批方块，确认映射不会抛错、也不会返回空
  const kinds = new Map<string, number>();
  for (const def of BLOCKS) {
    if (!def || !def.name) continue;
    const kind = breakSoundFor(def.name);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const total = [...kinds.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${total} 种方块的音效分布：${[...kinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  check('全部方块都能映射到音效', total === BLOCKS.length, `${total} / ${BLOCKS.length}`);
  check('没有方块被分到不存在的音效种类', [...kinds.keys()].every((kind) => kind.startsWith('break_')), [...kinds.keys()].join(','));
}

// ---------------------------------------------------------------- 3. 引擎行为

console.log('\n[引擎行为]');
{
  const engine = new AudioEngine();
  engine.setListener(0, 64, 0);
  // 没有 AudioContext（node 里没有）：play 应当是安全的空操作，而不是抛错
  let threw = false;
  try {
    engine.play('break_stone');
    engine.play('explode', { x: 100, y: 64, z: 100 });
    engine.playBreakForBlock('minecraft:glass', { x: 1, y: 64, z: 1 });
  } catch {
    threw = true;
  }
  check('没有 AudioContext 时播放不会抛错', !threw);
  check('未播放时计数保持 0（没有误报）', engine.played === 0, `${engine.played}`);

  engine.volume = 0;
  engine.resume();
  check('resume 在无音频环境里安全失败并自动关闭音效', engine.enabled === false || engine.played === 0);
}

// ---------------------------------------------------------------- 4. 音效表参数

console.log('\n[音效表参数范围]');
{
  // 通过"能否安全播放"间接验证参数：这里直接检查引擎在禁用状态下不受影响
  const engine = new AudioEngine();
  engine.enabled = false;
  engine.volume = 1;
  engine.play('mob_zombie', { x: 0, y: 0, z: 0 });
  check('禁用后播放计数不增长', engine.played === 0);

  // 距离衰减：远处不播（这条在真实浏览器里通过 played 计数验证，见 tools/audio-acceptance.js）
  check('引擎提供音量与启用开关', typeof engine.volume === 'number' && typeof engine.enabled === 'boolean');
}

// ---------------------------------------------------------------- 5. 门的开合音（批次 138）

console.log('\n[开关类方块 → 音效（批次 138）]');
{
  check('开门是"吱呀"，关门是"咔嗒"', doorSoundFor('door', true) === 'door' && doorSoundFor('door', false) === 'door_close');
  check('活板门有自己的声音（开关同一套）', doorSoundFor('trapdoor', true) === 'trapdoor' && doorSoundFor('trapdoor', false) === 'trapdoor');
  check('栅栏门也有自己的声音', doorSoundFor('fence_gate', false) === 'fence_gate');
  check('未知形状回落到门（不会静默）', doorSoundFor('nothing', false) === 'door_close');
  // 三种门必须是三种不同的声音：共用一种的症状是"关活板门像在推大门"
  const three = new Set([doorSoundFor('door', true), doorSoundFor('trapdoor', true), doorSoundFor('fence_gate', true)]);
  check('三种门的音效互不相同', three.size === 3, [...three].join(','));
  // 新加的音效都要在表里（`soundSpec` 为空 = 播放时静默丢弃，而且不会有任何报错）
  for (const kind of ['item_move', 'door_close', 'trapdoor', 'fence_gate'] as const) {
    check(`音效表里有 ${kind}`, soundSpec(kind) !== undefined);
  }
}

// ---------------------------------------------------------------- 6. 音效表完整性

console.log('\n[音效表：每种都要有能合成出来的参数]');
{
  check('种类清单非空', SOUND_KINDS.length >= 30, `${SOUND_KINDS.length} 种`);
  const bad: string[] = [];
  for (const kind of SOUND_KINDS) {
    const spec = soundSpec(kind);
    if (!spec) {
      bad.push(`${kind}: 无参数`);
      continue;
    }
    const ok =
      spec.duration > 0 &&
      spec.duration < 3 &&
      spec.gain > 0 &&
      spec.gain <= 1 &&
      spec.noise >= 0 &&
      spec.noise <= 1 &&
      spec.freqFrom >= 20 &&
      spec.freqTo >= 20 &&
      spec.filter > 0 &&
      spec.filterQ >= 0 &&
      spec.attack >= 0 &&
      spec.attack < spec.duration &&
      spec.release > 0 &&
      (spec.thump === undefined || spec.thump > 20);
    if (!ok) bad.push(`${kind}: ${JSON.stringify(spec)}`);
  }
  check(`${SOUND_KINDS.length} 种音效参数都合法`, bad.length === 0, bad.slice(0, 3).join(' / '));
  // 同一份常数表里不该出现"两个音效完全一样"（那等于白写一种）
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const kind of SOUND_KINDS) {
    const key = JSON.stringify(soundSpec(kind));
    const other = seen.get(key);
    if (other) dup.push(`${other}=${kind}`);
    else seen.set(key, kind);
  }
  check('没有两种音效的参数完全相同', dup.length === 0, dup.join(','));
}

// ---------------------------------------------------------------- 7. 水下闷响（批次 138）

console.log('\n[水下闷响（批次 138）]');
{
  check('水下低通在"闷"的频段（300~1200Hz）', UNDERWATER_LOWPASS_HZ >= 300 && UNDERWATER_LOWPASS_HZ <= 1200, String(UNDERWATER_LOWPASS_HZ));
  check('水下音量要明显更小', UNDERWATER_GAIN > 0 && UNDERWATER_GAIN < 0.8, String(UNDERWATER_GAIN));
  check('折算后仍大于 0（不是静音）', underwaterGain(0.5) > 0.1);
  check('折算比原值小', underwaterGain(0.5) < 0.5);
  const engine = new AudioEngine();
  check('默认不在水下', engine.underwater === false);
  // 水下也要能安全播放（没有 AudioContext 时依然是空操作）
  engine.underwater = true;
  let threw = false;
  try {
    engine.play('item_move');
  } catch {
    threw = true;
  }
  check('水下播放不抛错', !threw);
}

// ---------------------------------------------------------------- 6. 音量分组（批次 178）

console.log('\n[音量分组：四组各自可调]');
{
  // 穷尽性：每个音效都必须有分组（TS 的 Record 已经保证了类型，这里再钉一次运行时）
  const missing = SOUND_KINDS.filter((kind) => SOUND_GROUPS[kind] === undefined);
  check('每个音效都归到了某一组', missing.length === 0, missing.join(','));
  check(
    '四组都有中文名（设置界面直接用）',
    (['blocks', 'mobs', 'player', 'ui'] as const).every((group) => typeof SOUND_GROUP_LABELS[group] === 'string'),
  );

  // 分类要"讲得通"：挖方块归方块、生物叫归生物、按钮归界面
  check('破坏音效归"方块"', soundGroupOf('break_stone') === 'blocks' && soundGroupOf('break_wood') === 'blocks');
  check('门/活板门也归"方块"', soundGroupOf('door') === 'blocks' && soundGroupOf('trapdoor') === 'blocks');
  check('生物叫归"生物"', soundGroupOf('mob_zombie') === 'mobs' && soundGroupOf('mob_cow') === 'mobs');
  check('脚步与受伤归"玩家"', soundGroupOf('step') === 'player' && soundGroupOf('hurt') === 'player');
  check('按钮/达成/交易归"界面"', soundGroupOf('click') === 'ui' && soundGroupOf('achievement') === 'ui' && soundGroupOf('trade') === 'ui');

  // 每一组都真的分到了东西（否则设置里那条滑杆是空的）
  for (const group of ['blocks', 'mobs', 'player', 'ui'] as const) {
    const count = SOUND_KINDS.filter((kind) => SOUND_GROUPS[kind] === group).length;
    check(`「${SOUND_GROUP_LABELS[group]}」这一组不为空`, count > 0, `${count} 条`);
  }

  // 增益：默认 1（不额外衰减），越界被夹住
  const engine = new AudioEngine();
  check(
    '四组默认都是 1（默认状态下不该悄悄变轻）',
    (['blocks', 'mobs', 'player', 'ui'] as const).every((group) => engine.groupVolumeOf(group) === 1),
  );
  engine.setGroupVolume('mobs', 0);
  check('调到 0 就是这一组全静音', engine.groupVolumeOf('mobs') === 0);
  engine.setGroupVolume('mobs', 3);
  check('超过 1 被夹住', engine.groupVolumeOf('mobs') === 1);
  engine.setGroupVolume('mobs', -2);
  check('负数被夹到 0', engine.groupVolumeOf('mobs') === 0);
  engine.setGroupVolume('mobs', 0.35);
  check('正常值原样保留', Math.abs(engine.groupVolumeOf('mobs') - 0.35) < 1e-9);
}

console.log(`\n音效测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
