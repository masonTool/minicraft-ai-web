/**
 * 音效离线测试（K5；批次 232 重写）
 *
 * 引擎本身要 AudioContext（只有浏览器有），因此这里测的是**纯逻辑部分**：
 *  1. 材质 → 音效的映射（破坏 / 脚步 / 放置三套，各按材质分类）
 *  2. 音效表本身的合法性（层/包络/频率/共振峰都在可合成的范围内）
 *  3. 随机化（变体 + 音高抖动）与“表里不许有两份完全一样的配方”
 *  4. 生物声音档案（每一种生物都要能解析出三条，永远不静默）
 *  5. 引擎在无 AudioContext 环境下的安全性
 *
 * 运行：npm run test:audio
 */

import {
  AudioEngine,
  soundGroupLabel,
  SOUND_GROUPS,
  SOUND_KINDS,
  UNDERWATER_GAIN,
  UNDERWATER_LOWPASS_HZ,
  breakSoundFor,
  digSoundFor,
  doorSoundFor,
  layersDuration,
  minecartLevelForSpeed,
  pickLayers,
  placeSoundFor,
  soundGroupOf,
  soundSpec,
  specDuration,
  stepSoundFor,
  underwaterGain,
  type SoundSpec,
} from '../web/src/core/audio/AudioEngine.ts';
import { MUSIC_SCALES, MusicDirector } from '../web/src/core/audio/Music.ts';
import {
  MOB_VOICES,
  MOB_VOICE_IDS,
  ambientIntervalFor,
  mobVoiceFor,
  mobVoicePitchFor,
  mobVoiceSpec,
} from '../web/src/core/audio/MobVoices.ts';
import { BLOCKS } from '../web/src/core/registry/blocks.ts';
import { DROPPING_MOB_TYPES, REMOTE_PLAYER_TYPE } from '../web/src/core/entity/mobs.ts';

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

/**
 * 一条声音的结构合法性。返回问题清单（空 = 合法）。
 *
 * ⚠️ 这里故意查得比“能播”更细：包络**首尾都必须是 0**。
 * 首点不是 0 → 起音会“啪”一下（爆音）；末点不是 0 → 声音被硬切断，同样会咔。
 */
function specProblems(spec: SoundSpec | undefined): string[] {
  const problems: string[] = [];
  if (!spec) return ['无参数'];
  if (!(spec.gain > 0 && spec.gain <= 1)) problems.push(`gain=${spec.gain}`);
  const layerSets = [spec.layers, ...(spec.variants ?? [])];
  if (layerSets.length === 0 || spec.layers.length === 0) problems.push('没有任何层');
  for (const layers of layerSets) {
    if (layers.length === 0) problems.push('空变体');
    for (const layer of layers) {
      if (!(layer.dur > 0 && layer.dur < 3)) problems.push(`dur=${layer.dur}`);
      if (!(layer.at >= 0 && layer.at < 3)) problems.push(`at=${layer.at}`);
      if (!(layer.gain > 0 && layer.gain <= 1)) problems.push(`layer.gain=${layer.gain}`);
      if (layer.env.length < 2) problems.push('包络点数不足');
      let previous = -1;
      for (const [ratio, level] of layer.env) {
        if (!(ratio >= 0 && ratio <= 1)) problems.push(`env ratio=${ratio}`);
        if (ratio < previous) problems.push('包络时间倒流');
        if (!(level >= 0 && level <= 1)) problems.push(`env level=${level}`);
        previous = ratio;
      }
      if (layer.env[0]?.[1] !== 0) problems.push('包络首点不是 0（会爆音）');
      if (layer.env[layer.env.length - 1]?.[1] !== 0) problems.push('包络末点不是 0（会咔一声）');
      if (layer.tremolo) {
        if (!(layer.tremolo.hz > 0 && layer.tremolo.hz < 60)) problems.push(`tremolo.hz=${layer.tremolo.hz}`);
        if (!(layer.tremolo.depth > 0 && layer.tremolo.depth <= 1)) problems.push(`tremolo.depth=${layer.tremolo.depth}`);
      }
      if (layer.t === 'tone') {
        if (!(layer.hz >= 20 && layer.hz <= 12000)) problems.push(`hz=${layer.hz}`);
        for (const [ratio, mult] of layer.pitch ?? []) {
          if (!(ratio >= 0 && ratio <= 1)) problems.push(`pitch ratio=${ratio}`);
          if (!(mult > 0.1 && mult < 8)) problems.push(`pitch mult=${mult}`);
        }
        if (layer.vibrato) {
          if (!(layer.vibrato.hz > 0 && layer.vibrato.hz < 40)) problems.push(`vibrato.hz=${layer.vibrato.hz}`);
          if (!(layer.vibrato.cents > 0 && layer.vibrato.cents <= 200)) problems.push(`vibrato.cents=${layer.vibrato.cents}`);
        }
        for (const formant of layer.formants ?? []) {
          if (!(formant.hz >= 60 && formant.hz <= 12000)) problems.push(`formant.hz=${formant.hz}`);
          if (!(formant.q > 0 && formant.q <= 40)) problems.push(`formant.q=${formant.q}`);
          if (!(formant.gain > 0 && formant.gain <= 1)) problems.push(`formant.gain=${formant.gain}`);
        }
      } else {
        if (!(layer.hz >= 20 && layer.hz <= 12000)) problems.push(`noise.hz=${layer.hz}`);
        if (!(layer.q > 0 && layer.q <= 40)) problems.push(`noise.q=${layer.q}`);
        for (const [ratio, mult] of layer.sweep ?? []) {
          if (!(ratio >= 0 && ratio <= 1)) problems.push(`sweep ratio=${ratio}`);
          if (!(mult > 0.1 && mult < 8)) problems.push(`sweep mult=${mult}`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- 1. 材质映射

console.log('\n[方块材质 → 破坏音效]');
{
  const cases: Array<[string, string]> = [
    ['minicraft:stone', 'break_stone'],
    ['minicraft:cobblestone', 'break_stone'],
    ['minicraft:deepslate', 'break_stone'],
    ['minicraft:oak_planks', 'break_wood'],
    ['minicraft:oak_log', 'break_wood'],
    ['minicraft:crafting_table', 'break_wood'],
    ['minicraft:crimson_stem', 'break_wood'],
    ['minicraft:oak_door', 'break_wood'],
    ['minicraft:short_grass', 'break_grass'],
    ['minicraft:oak_leaves', 'break_grass'],
    ['minicraft:crimson_nylium', 'break_grass'],
    ['minicraft:sand', 'break_sand'],
    ['minicraft:gravel', 'break_sand'],
    ['minicraft:soul_soil', 'break_sand'],
    ['minicraft:glass', 'break_glass'],
    ['minicraft:ice', 'break_glass'],
    ['minicraft:white_wool', 'break_wool'],
    ['minicraft:nether_wart_block', 'break_wool'],
  ];

  let bad = 0;
  for (const [name, expected] of cases) {
    const actual = breakSoundFor(name);
    if (actual !== expected) {
      bad++;
      console.log(`      ${name} → ${actual}（期望 ${expected}）`);
    }
  }
  check(`${cases.length} 种方块的破坏音分类正确`, bad === 0, `不匹配 ${bad} 种`);

  const kinds = new Set(cases.map(([name]) => breakSoundFor(name)));
  check('至少覆盖 5 类材质音效', kinds.size >= 5, [...kinds].join(','));
  check('未知方块回落到石头音（不会静默）', breakSoundFor('minicraft:unknown_block') === 'break_stone');
  check('带/不带命名空间前缀结果一致', breakSoundFor('stone') === breakSoundFor('minicraft:stone'));
}

console.log('\n[方块材质 → 脚步 / 放置音效（批次 232）]');
{
  // 脚步：每一种材质都要有自己的声音（以前全借破坏音，走路像在挖方块）
  const steps: Array<[string, string]> = [
    ['minicraft:grass_block', 'step_grass'],
    ['minicraft:short_grass', 'step_grass'],
    ['minicraft:oak_leaves', 'step_grass'],
    ['minicraft:stone', 'step_stone'],
    ['minicraft:deepslate', 'step_stone'],
    ['minicraft:oak_planks', 'step_wood'],
    ['minicraft:oak_log', 'step_wood'],
    ['minicraft:sand', 'step_sand'],
    ['minicraft:gravel', 'step_gravel'],
    ['minicraft:snow_block', 'step_snow'],
    ['minicraft:powder_snow', 'step_snow'],
    ['minicraft:white_wool', 'step_wool'],
    ['minicraft:oak_carpet', 'step_wool'],
  ];
  let badSteps = 0;
  for (const [name, expected] of steps) {
    if (stepSoundFor(name) !== expected) {
      badSteps++;
      console.log(`      ${name} → ${stepSoundFor(name)}（期望 ${expected}）`);
    }
  }
  check(`${steps.length} 种方块的脚步音分类正确`, badSteps === 0, `不匹配 ${badSteps} 种`);
  check('脚步音不会落回破坏音（两套是分开的）', !stepSoundFor('minicraft:stone').startsWith('break_'));
  check('未知方块回落到石头脚步（不会静默）', stepSoundFor('minicraft:unknown_block') === 'step_stone');
  check('砂砾优先于沙子（颗粒感不能被吞掉）', stepSoundFor('minicraft:gravel') === 'step_gravel');

  const places: Array<[string, string]> = [
    ['minicraft:stone', 'place_stone'],
    ['minicraft:oak_planks', 'place_wood'],
    ['minicraft:grass_block', 'place_grass'],
    ['minicraft:sand', 'place_sand'],
    ['minicraft:glass', 'place_glass'],
    ['minicraft:white_wool', 'place_wool'],
  ];
  let badPlaces = 0;
  for (const [name, expected] of places) {
    if (placeSoundFor(name) !== expected) {
      badPlaces++;
      console.log(`      ${name} → ${placeSoundFor(name)}（期望 ${expected}）`);
    }
  }
  check(`${places.length} 种方块的放置音分类正确`, badPlaces === 0, `不匹配 ${badPlaces} 种`);
  check('未知方块回落到石头放置音', placeSoundFor('minicraft:unknown_block') === 'place_stone');

  // 挖掘中的摩擦（批次 233）：只有四档，但石头/木头/松软/玻璃必须分得开
  const digs: Array<[string, string]> = [
    ['minicraft:stone', 'dig_stone'],
    ['minicraft:deepslate', 'dig_stone'],
    ['minicraft:oak_planks', 'dig_wood'],
    ['minicraft:oak_log', 'dig_wood'],
    ['minicraft:grass_block', 'dig_soft'],
    ['minicraft:sand', 'dig_soft'],
    ['minicraft:white_wool', 'dig_soft'],
    ['minicraft:glass', 'dig_glass'],
  ];
  let badDigs = 0;
  for (const [name, expected] of digs) {
    if (digSoundFor(name) !== expected) {
      badDigs++;
      console.log(`      ${name} → ${digSoundFor(name)}（期望 ${expected}）`);
    }
  }
  check(`${digs.length} 种方块的挖掘音分类正确`, badDigs === 0, `不匹配 ${badDigs} 种`);
  const digKinds = new Set(digs.map(([name]) => digSoundFor(name)));
  check('挖掘音覆盖 4 档材质（不会全落到石头）', digKinds.size === 4, [...digKinds].join(','));
}

// ---------------------------------------------------------------- 2. 覆盖真实方块表

console.log('\n[真实方块表覆盖检查]');
{
  const missing: string[] = [];
  const stepKinds = new Map<string, number>();
  const placeKinds = new Map<string, number>();
  const digKinds = new Map<string, number>();
  for (const def of BLOCKS) {
    if (!def || !def.name) continue;
    const kind = breakSoundFor(def.name);
    if (!soundSpec(kind)) missing.push(`break:${def.name}→${kind}`);
    const step = stepSoundFor(def.name);
    if (!soundSpec(step)) missing.push(`step:${def.name}→${step}`);
    const place = placeSoundFor(def.name);
    if (!soundSpec(place)) missing.push(`place:${def.name}→${place}`);
    const dig = digSoundFor(def.name);
    if (!soundSpec(dig)) missing.push(`dig:${def.name}→${dig}`);
    stepKinds.set(step, (stepKinds.get(step) ?? 0) + 1);
    placeKinds.set(place, (placeKinds.get(place) ?? 0) + 1);
    digKinds.set(dig, (digKinds.get(dig) ?? 0) + 1);
  }
  console.log(`  脚步音分布：${[...stepKinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  放置音分布：${[...placeKinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  挖掘音分布：${[...digKinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  check('全部方块的破坏/脚步/放置/挖掘音都真实存在', missing.length === 0, missing.slice(0, 3).join(' / '));
  check('脚步音至少覆盖 6 种材质', stepKinds.size >= 6, `${stepKinds.size} 种`);
  check('放置音至少覆盖 6 种材质', placeKinds.size >= 6, `${placeKinds.size} 种`);
  check('挖掘音四档都有真实方块用', digKinds.size === 4, `${digKinds.size} 种`);
}

// ---------------------------------------------------------------- 3. 引擎行为

console.log('\n[引擎行为]');
{
  const engine = new AudioEngine();
  engine.setListener(0, 64, 0, Math.PI / 3);
  // 没有 AudioContext（node 里没有）：play 应当是安全的空操作，而不是抛错
  let threw = false;
  try {
    engine.play('break_stone');
    engine.play('explode', { x: 100, y: 64, z: 100 });
    engine.playStepForBlock('minicraft:grass_block');
    engine.playPlaceForBlock('minicraft:glass', { x: 1, y: 64, z: 1 });
    engine.playVoice('zombie:ambient', mobVoiceSpec('undead', 'ambient'), { x: 1, y: 64, z: 1 });
    // 批次 233：环境音与音乐在无 AudioContext 时也必须是安全空操作
    engine.setAmbience(0.7);
    engine.playMusicNote(220, { duration: 2, velocity: 0.8, delay: 0.5 });
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

console.log('\n[音效表：每种都要有能合成出来的参数]');
{
  check('种类清单非空', SOUND_KINDS.length >= 45, `${SOUND_KINDS.length} 种`);
  const bad: string[] = [];
  for (const kind of SOUND_KINDS) {
    const problems = specProblems(soundSpec(kind));
    if (problems.length > 0) bad.push(`${kind}: ${problems.slice(0, 3).join(',')}`);
  }
  check(`${SOUND_KINDS.length} 种音效参数都合法`, bad.length === 0, bad.slice(0, 3).join(' / '));

  // 变体：有就至少两个，而且内容不同（两个一样的变体等于白写）
  const badVariants: string[] = [];
  for (const kind of SOUND_KINDS) {
    const spec = soundSpec(kind);
    if (!spec?.variants) continue;
    if (spec.variants.length < 2) badVariants.push(`${kind}: 只有 ${spec.variants.length} 个`);
    const seen = new Set(spec.variants.map((layers) => JSON.stringify(layers)));
    if (seen.size !== spec.variants.length) badVariants.push(`${kind}: 有重复变体`);
  }
  check('变体音效都至少两个且互不相同', badVariants.length === 0, badVariants.join(' / '));

  // 同一份常数表里不该出现“两个音效完全一样”
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const kind of SOUND_KINDS) {
    const key = JSON.stringify(soundSpec(kind));
    const other = seen.get(key);
    if (other) dup.push(`${other}=${kind}`);
    else seen.set(key, kind);
  }
  check('没有两种音效的参数完全相同', dup.length === 0, dup.join(','));

  check('时长能算出来（用于并发计数）', SOUND_KINDS.every((kind) => specDuration(soundSpec(kind)!) > 0));
  check('单条音效不超过 3 秒（不能霸占并发名额）', SOUND_KINDS.every((kind) => specDuration(soundSpec(kind)!) < 3));
}

console.log('\n[随机化：变体挑选]');
{
  const spec = soundSpec('step_grass')!;
  const first = pickLayers(spec, () => 0);
  const last = pickLayers(spec, () => 0.999);
  check('随机取 0 拿到第一个变体', first === spec.variants?.[0]);
  check('随机取 0.999 拿到最后一个变体', last === spec.variants?.[spec.variants.length - 1]);
  check('两个变体确实不同', JSON.stringify(first) !== JSON.stringify(last));
  check('没有变体时回落到 layers', pickLayers({ gain: 0.2, layers: spec.layers }) === spec.layers);
  check('时长按最长变体算', specDuration(spec) >= layersDuration(first));
  check('脚步/破坏/吃都有抖动（连踩不会一模一样）', (soundSpec('step')!.pitchJitter ?? 0) > 0 && (soundSpec('eat')!.pitchJitter ?? 0) > 0);
}

// ---------------------------------------------------------------- 5. 水下闷响

console.log('\n[水下闷响（批次 138）]');
{
  check('水下低通在“闷”的频段（300~1200Hz）', UNDERWATER_LOWPASS_HZ >= 300 && UNDERWATER_LOWPASS_HZ <= 1200, String(UNDERWATER_LOWPASS_HZ));
  check('水下音量要明显更小', UNDERWATER_GAIN > 0 && UNDERWATER_GAIN < 0.8, String(UNDERWATER_GAIN));
  check('折算后仍大于 0（不是静音）', underwaterGain(0.5) > 0.1);
  check('折算比原值小', underwaterGain(0.5) < 0.5);
  const engine = new AudioEngine();
  check('默认不在水下', engine.underwater === false);
  engine.underwater = true;
  let threw = false;
  try {
    engine.play('item_move');
  } catch {
    threw = true;
  }
  check('水下播放不抛错', !threw);
}

// ---------------------------------------------------------------- 6. 音量分组

console.log('\n[音量分组：六组各自可调]');
{
  const missing = SOUND_KINDS.filter((kind) => SOUND_GROUPS[kind] === undefined);
  check('每个音效都归到了某一组', missing.length === 0, missing.join(','));
  check(
    '六组都有中文名（设置界面直接用）',
    (['blocks', 'mobs', 'player', 'ui', 'ambient', 'music'] as const).every(
      (group) => typeof soundGroupLabel(group) === 'string',
    ),
  );

  check('破坏音效归“方块”', soundGroupOf('break_stone') === 'blocks' && soundGroupOf('break_wood') === 'blocks');
  check('门/活板门也归“方块”', soundGroupOf('door') === 'blocks' && soundGroupOf('trapdoor') === 'blocks');
  check('脚步与受伤归“玩家”', soundGroupOf('step') === 'player' && soundGroupOf('hurt') === 'player');
  check('落地与打击感也归“玩家”', soundGroupOf('land_hard') === 'player' && soundGroupOf('hit_flesh') === 'player');
  check('按钮/达成/交易归“界面”', soundGroupOf('click') === 'ui' && soundGroupOf('achievement') === 'ui' && soundGroupOf('trade') === 'ui');

  // 生物/环境/音乐三组没有固定的 SOUND_KIND：前者按"种类档案"播，
  // 后两者是**循环/预约**音源（雨声、背景音乐），不走一次性 `play()`
  check(
    '生物/环境/音乐不占用普通音效表',
    SOUND_KINDS.every((kind) => {
      const group = soundGroupOf(kind);
      return group !== 'mobs' && group !== 'ambient' && group !== 'music';
    }),
  );

  for (const group of ['blocks', 'player', 'ui'] as const) {
    const count = SOUND_KINDS.filter((kind) => SOUND_GROUPS[kind] === group).length;
    check(`「${soundGroupLabel(group)}」这一组不为空`, count > 0, `${count} 条`);
  }

  const engine = new AudioEngine();
  check(
    '六组默认都是 1（默认状态下不该悄悄变轻）',
    (['blocks', 'mobs', 'player', 'ui', 'ambient', 'music'] as const).every((group) => engine.groupVolumeOf(group) === 1),
  );
  engine.setGroupVolume('mobs', 0);
  check('调到 0 就是这一组全静音', engine.groupVolumeOf('mobs') === 0);
  engine.setGroupVolume('mobs', 3);
  check('超过 1 被夹住', engine.groupVolumeOf('mobs') === 1);
  engine.setGroupVolume('mobs', -2);
  check('负数被夹到 0', engine.groupVolumeOf('mobs') === 0);
  engine.setGroupVolume('mobs', 0.35);
  check('正常值原样保留', Math.abs(engine.groupVolumeOf('mobs') - 0.35) < 1e-9);
  engine.setGroupVolume('ambient', 0.4);
  engine.setGroupVolume('music', 0.2);
  check('雨声与音乐可各自调（批次 233）', engine.groupVolumeOf('ambient') === 0.4 && engine.groupVolumeOf('music') === 0.2);
}

// ---------------------------------------------------------------- 7. 开关类方块

console.log('\n[开关类方块 → 音效（批次 138）]');
{
  check('开门是“吱呀”，关门是“咔嗒”', doorSoundFor('door', true) === 'door' && doorSoundFor('door', false) === 'door_close');
  check('活板门有自己的声音（开关同一套）', doorSoundFor('trapdoor', true) === 'trapdoor' && doorSoundFor('trapdoor', false) === 'trapdoor');
  check('栅栏门也有自己的声音', doorSoundFor('fence_gate', false) === 'fence_gate');
  check('未知形状回落到门（不会静默）', doorSoundFor('nothing', false) === 'door_close');
  const three = new Set([doorSoundFor('door', true), doorSoundFor('trapdoor', true), doorSoundFor('fence_gate', true)]);
  check('三种门的音效互不相同', three.size === 3, [...three].join(','));
}

// ---------------------------------------------------------------- 8. 生物声音档案

console.log('\n[生物声音档案：每一种生物都要有环境叫/受伤/死亡]');
{
  check('档案数量够多（21 种以上）', MOB_VOICE_IDS.length >= 21, `${MOB_VOICE_IDS.length} 套`);

  const bad: string[] = [];
  for (const voice of MOB_VOICE_IDS) {
    for (const event of ['ambient', 'hurt', 'death'] as const) {
      const problems = specProblems(MOB_VOICES[voice][event]);
      if (problems.length > 0) bad.push(`${voice}.${event}: ${problems.slice(0, 2).join(',')}`);
    }
  }
  check('每一套档案的三条声音都合法', bad.length === 0, bad.slice(0, 3).join(' / '));

  // 真实生物表：除远程玩家外，每一只都必须解析出一个非空档案
  const unresolved: string[] = [];
  for (const type of [...DROPPING_MOB_TYPES, REMOTE_PLAYER_TYPE]) {
    const voice = mobVoiceFor(type.id, type.family);
    if (type.id === 'remote_player') {
      if (voice !== null) unresolved.push(`${type.id} 不该有动物叫声`);
      continue;
    }
    if (voice === null) unresolved.push(type.id);
  }
  check(
    `${DROPPING_MOB_TYPES.length} 种生物都能解析出声音档案（远程玩家除外）`,
    unresolved.length === 0,
    unresolved.join(','),
  );

  // 每一条都真的取得到 spec（`mobVoiceSpec` 永远不返回 undefined）
  const missingSpec = DROPPING_MOB_TYPES.filter((type) => {
    const voice = mobVoiceFor(type.id, type.family);
    if (!voice) return true;
    return (['ambient', 'hurt', 'death'] as const).some((event) => !mobVoiceSpec(voice, event));
  });
  check('每一只的三条声音都取得到', missingSpec.length === 0, missingSpec.map((type) => type.id).join(','));

  // 家族兜底：不在表里的新生物，也要落到某一套（亡灵/节肢/其它）
  check('未知亡灵落到亡灵档案', mobVoiceFor('future_zombie', 'undead') === 'undead');
  check('未知节肢落到蜘蛛档案', mobVoiceFor('future_bug', 'arthropod') === 'spider');
  check('未知普通生物落到 passive（永远不静默）', mobVoiceFor('future_bunny') === 'passive');

  // 音高：幼体更高、洞穴蜘蛛比蜘蛛尖、小史莱姆比大史莱姆高
  check('幼体比成年高', mobVoicePitchFor('cow', true) > mobVoicePitchFor('cow', false));
  check('洞穴蜘蛛比蜘蛛高', mobVoicePitchFor('cave_spider') > mobVoicePitchFor('spider'));
  check('小史莱姆比大史莱姆高', mobVoicePitchFor('slime_small') > mobVoicePitchFor('slime_big'));
  check('音高倍率在合理区间（0.5~2）', DROPPING_MOB_TYPES.every((type) => {
    const adult = mobVoicePitchFor(type.id, false);
    const baby = mobVoicePitchFor(type.id, true);
    return adult >= 0.5 && adult <= 2 && baby >= 0.5 && baby <= 2;
  }));

  // 环境叫的间隔：min < max，且不能密到变成噪音
  const badIntervals = MOB_VOICE_IDS.filter((voice) => {
    const [min, max] = ambientIntervalFor(voice);
    return !(min > 0 && min < max && min >= 6);
  });
  check('环境叫间隔合法且不过密', badIntervals.length === 0, badIntervals.join(','));

  // 档案之间不能“听起来完全一样”（否则等于只有几种生物）
  const signatures = new Set(MOB_VOICE_IDS.map((voice) => JSON.stringify(MOB_VOICES[voice])));
  check('不同档案的配方互不相同', signatures.size === MOB_VOICE_IDS.length, `${signatures.size}/${MOB_VOICE_IDS.length}`);
}

// ---------------------------------------------------------------- 9. 背景音乐（批次 233）

console.log('\n[背景音乐：程序化生成]');
{
  // 固定随机数：只验证"结构与范围"，不验证"好不好听"
  const first = new MusicDirector(() => 0.5);
  check('第一段不会开局就响（12~26 秒后）', first.nextIn >= 12 && first.nextIn <= 26, String(first.nextIn));
  check('暂停（dt = 0）时不推进、也不产生音符', first.update(0, { dimension: 'overworld', night: false }).length === 0);

  const notes = first.update(30, { dimension: 'overworld', night: false });
  check('到点会生成一小段（4~16 个音，含叠音）', notes.length >= 4 && notes.length <= 16, `${notes.length} 个`);
  check(
    '每个音符的时值/力度合法',
    notes.every((note) => note.hz >= 20 && note.hz <= 4000 && note.duration >= 0.2 && note.velocity >= 0 && note.velocity <= 1),
  );
  check('音符按时间先后排列（可以按 delay 预约）', notes.every((note, i) => i === 0 || note.delay >= notes[i - 1]!.delay));
  check('两段之间留白 ≥ 30 秒（背景音乐必须能被忘掉）', first.nextIn >= 30, String(first.nextIn));

  // 音阶：主世界白天的音必须落在 A 小调五声里（允许铺底降八度、五度叠音）
  const dayScale = new Set(MUSIC_SCALES.day);
  check(
    '主世界白天的音都在五声音阶里（含降八度铺底 / 五度叠音）',
    notes.every((note) => dayScale.has(note.hz) || dayScale.has(note.hz * 2) || dayScale.has(note.hz / 2) || dayScale.has(note.hz / 1.5)),
    notes.map((note) => note.hz.toFixed(1)).join(','),
  );

  // 夜里整段降八度（最高的音也不该超过 330Hz）
  const nightNotes = new MusicDirector(() => 0.5).update(30, { dimension: 'overworld', night: true });
  check('夜里的音更低沉', nightNotes.every((note) => note.hz <= 330), nightNotes.map((note) => note.hz.toFixed(0)).join(','));

  // 下界/末地各有自己的音阶
  const netherNotes = new MusicDirector(() => 0.5).update(30, { dimension: 'nether', night: false });
  const netherScale = new Set(MUSIC_SCALES.nether);
  check(
    '下界用自己的音阶（含增四度）',
    netherNotes.length > 0 &&
      netherNotes.every(
        (note) => netherScale.has(note.hz) || netherScale.has(note.hz * 2) || netherScale.has(note.hz / 1.5),
      ),
  );
  const endNotes = new MusicDirector(() => 0.5).update(30, { dimension: 'end', night: false });
  check('末地的音更高（440Hz 起）', endNotes.some((note) => note.hz >= 440));

  // 只有铺底的那种段落：random 恒为 0.1 → 有三成概率"只留一个和弦"
  const quiet = new MusicDirector(() => 0.1).update(30, { dimension: 'overworld', night: false });
  check('安静段落可以只有铺底（不是每次都写旋律）', quiet.length === 1 && quiet[0]!.duration >= 6, `${quiet.length} 个`);

  const resettable = new MusicDirector(() => 0.5);
  resettable.update(30, { dimension: 'overworld', night: false });
  resettable.reset();
  check('reset 后重新从 12~26 秒开始', resettable.nextIn >= 12 && resettable.nextIn <= 26);
}

// ---------------------------------------------------------------- 10. 兼容性：旧音效还在

console.log('\n[旧音效兼容（验收脚本与控制台还在用这些名字）]');
{
  const legacy = [
    'break_stone',
    'break_wood',
    'break_grass',
    'break_sand',
    'break_glass',
    'break_wool',
    'place',
    'step',
    'hurt',
    'death',
    'fall',
    'door',
    'explode',
    'splash',
    'click',
    'eat',
    'bow_shoot',
    'arrow_hit',
    'shear',
    'flint',
    'thunder',
    'portal',
    'fuse',
    'achievement',
    'trade',
    'item_move',
    'door_close',
    'trapdoor',
    'fence_gate',
    'shield_block',
  ] as const;
  const missing = legacy.filter((kind) => !soundSpec(kind));
  check(`${legacy.length} 个旧音效名字都还在`, missing.length === 0, missing.join(','));
  check('新增的脚步/落地有独立种类', !!soundSpec('step_grass') && !!soundSpec('land_soft') && !!soundSpec('land_hard'));
}

console.log('\n[矿车滚动声（批次 576）]');
{
  check('停着不响', minecartLevelForSpeed(0) === 0);
  check('低速只给一点点', minecartLevelForSpeed(0.5) > 0 && minecartLevelForSpeed(0.5) < 0.2);
  check('中速约半音量', Math.abs(minecartLevelForSpeed(4) - 0.5) < 1e-9);
  check('8 格/秒拉满', minecartLevelForSpeed(8) === 1);
  check('再快也不超过 1', minecartLevelForSpeed(100) === 1);
}

console.log(`\n音效测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
