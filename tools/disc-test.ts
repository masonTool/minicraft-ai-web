/**
 * 唱片机与唱片（批次 489，B19 + G9）
 *
 * 四块：
 *  ① 旋律数据本身（音高频率、时长、包络、三张曲子互不相同）；
 *  ② `discSoundSpec` 交给 AudioEngine 的形状（layer 数 = 旋律 + 低音）；
 *  ③ 方块与物品（唱片机是 cube、三张唱片 maxStack 1、都在注册表里）；
 *  ④ 配方（8 木板 + 1 钻石 → 1 台）。
 *
 * 旋律是**纯数据**，所以"好不好听"测不了，但"是不是一段合法的声音"可以：
 * 频率落在可听范围、时间不为负、包络首尾归零（否则每次播放都会"啪"一声）。
 */

import {
  DISC_TRACK_NAMES,
  discDuration,
  discSoundKind,
  discSoundSpec,
  discTrack,
  midiToHz,
} from '../src/core/audio/DiscMelody.ts';
import { Block, JUKEBOX_ID, blockDef } from '../src/core/registry/blocks.ts';
import { Item, ITEMS, itemDef } from '../src/core/registry/items.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';

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

console.log('\n[旋律数据]');
{
  equal('三张唱片', DISC_TRACK_NAMES.length, 3);
  check('曲名是 13 / cat / ward', ['13', 'cat', 'ward'].every((name) => DISC_TRACK_NAMES.includes(name)), DISC_TRACK_NAMES.join(','));

  equal('A4 = 440Hz', Math.round(midiToHz(69)), 440);
  equal('A3 = 220Hz', Math.round(midiToHz(57)), 220);

  for (const name of DISC_TRACK_NAMES) {
    const track = discTrack(name)!;
    check(`${name} 有旋律`, track.notes.length >= 8, `${track.notes.length} 个音`);
    check(
      `${name} 的音高在可听范围（C2~C7）`,
      track.notes.every((note) => note.midi >= 36 && note.midi <= 96),
      track.notes.map((note) => note.midi).join(','),
    );
    check(
      `${name} 的时间不为负、时长都大于 0`,
      track.notes.every((note) => note.at >= 0 && note.dur > 0) && track.bass.every((note) => note.at >= 0 && note.dur > 0),
    );
    const lastEnd = Math.max(
      ...track.notes.map((note) => note.at + note.dur),
      ...track.bass.map((note) => note.at + note.dur),
    );
    check(
      `${name} 的时长与最后一个音对得上`,
      Math.abs(lastEnd - track.duration) < 0.05,
      `最后 ${lastEnd.toFixed(2)}s / 声明 ${track.duration}s`,
    );
    check(`${name} 至少 8 秒（不是"嘀"一下就没了）`, track.duration >= 8, `${track.duration}s`);
  }

  // 三张旋律不能一样（否则"换一张唱片"听不出区别）
  const signatures = DISC_TRACK_NAMES.map((name) =>
    discTrack(name)!.notes.map((note) => `${note.midi}@${note.at}`).join('|'),
  );
  equal('三张旋律互不相同', new Set(signatures).size, 3);

  equal('不认识的曲名返回 null', discTrack('nope'), null);
  check('原型的键不算曲名（`__proto__` 不能当唱片）', discTrack('__proto__') === null);
}

console.log('\n[交给 AudioEngine 的 spec]');
{
  for (const name of DISC_TRACK_NAMES) {
    const track = discTrack(name)!;
    const spec = discSoundSpec(name);
    check(`${name} 生成得出 spec`, spec !== null);
    equal(`${name} 的 layer 数 = 旋律 + 低音`, spec!.layers.length, track.notes.length + track.bass.length);
    check(
      `${name} 每一层都是"音调"（没有噪声层混进来）`,
      spec!.layers.every((layer) => layer.t === 'tone'),
    );
    check(
      `${name} 的包络首尾都归零（否则每次播放会"啪"一声）`,
      spec!.layers.every((layer) => layer.env[0]![1] === 0 && layer.env[layer.env.length - 1]![1] === 0),
    );
    check(
      `${name} 的频率都落在 20~8000Hz`,
      spec!.layers.every((layer) => layer.t === 'tone' && layer.hz >= 20 && layer.hz <= 8000),
    );
    equal(`${name} 不抖动（唱片不能每次听起来都不一样）`, spec!.pitchJitter, 0);
    check(`${name} 时长可查（${Math.round(discDuration(name))} 秒）`, discDuration(name) > 0);
    equal(`${name} 的声音键带前缀（按曲子节流）`, discSoundKind(name), `disc:${name}`);
  }
  equal('不认识的曲名没有 spec', discSoundSpec('nope'), null);
  equal('不认识的曲名时长为 0', discDuration('nope'), 0);
}

console.log('\n[方块与物品]');
{
  equal('唱片机 id 是 716', JUKEBOX_ID, 716);
  equal('注册名', blockDef(Block.JUKEBOX).name, 'minicraft:jukebox');
  equal('是整格方块（要能站上去）', blockDef(Block.JUKEBOX).shape, 'cube');

  for (const [label, id] of [
    ['13', Item.MUSIC_DISC_13],
    ['cat', Item.MUSIC_DISC_CAT],
    ['ward', Item.MUSIC_DISC_WARD],
  ] as const) {
    const def = itemDef(id);
    check(`唱片 ${label} 注册了`, def !== undefined, `${id}`);
    equal(`唱片 ${label} 不能叠`, def?.maxStack, 1);
    check(`唱片 ${label} 在物品总表里`, ITEMS.some((item) => item?.id === id));
  }
}

console.log('\n[配方：8 木板 + 1 钻石]');
{
  const recipe = RECIPES.find((entry) => entry.result.id === Block.JUKEBOX);
  check('有一条产出唱片机的配方', recipe !== undefined);
  equal('产出 1 台', recipe?.result.count, 1);
  if (recipe && recipe.kind === 'shaped') {
    equal('3×3 的围一圈', recipe.pattern.join('/'), 'PPP/PDP/PPP');
    equal('中间是钻石', recipe.key.D, Item.DIAMOND);
    equal('四周是木板', recipe.key.P, Block.OAK_PLANKS);
  } else {
    check('应该是定形配方', false, recipe?.kind);
  }
}

console.log(`\n唱片机测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
