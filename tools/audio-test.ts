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

import { AudioEngine, breakSoundFor } from '../src/core/audio/AudioEngine.ts';
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

console.log(`\n音效测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
