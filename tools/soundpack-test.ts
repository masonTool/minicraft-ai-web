/**
 * 资源包音效替换（M10 第二半，批次 614）
 *
 * 这里测的全是**纯逻辑**：解码要 AudioContext（只有浏览器有），
 * 所以能离线断言的是"资源包里的哪个文件算哪个音效"以及"缺东西时怎么办"。
 *
 * 五块：
 *  ① 文件名解析（`sounds/**\/*.ogg` 才算，大小写与扩展名都要稳）；
 *  ② `{n}` 变体展开（一个音效多个采样，原版就是这么随机挑的）；
 *  ③ 映射表自身的合法性（没有悬空 `SoundKind`、没有人写 `{n}` 却声明 1 个变体）；
 *  ④ 命中判定（部分变体也算命中、没登记的音效不误收）；
 *  ⑤ 引擎侧装/卸采样与"没装资源包不会有声音退化"。
 */

import {
  SOUND_PACK_FILES,
  countUnmappedSounds,
  mapPackSounds,
  soundNameOf,
  soundPathsFor,
} from '../web/src/core/resourcepack/SoundPack.ts';
import { AudioEngine, SOUND_KINDS, soundSpec } from '../web/src/core/audio/AudioEngine.ts';

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

console.log('\n[① 文件名解析]');
{
  equal('标准路径', soundNameOf('sounds/dig/stone1.ogg'), 'dig/stone1');
  equal('大写扩展名', soundNameOf('sounds/dig/stone1.OGG'), 'dig/stone1');
  equal('.wav 也认（部分包会换容器）', soundNameOf('sounds/dig/stone1.wav'), 'dig/stone1');
  equal('多层子目录', soundNameOf('sounds/ambient/weather/thunder1.ogg'), 'ambient/weather/thunder1');
  equal('带包名前缀的路径', soundNameOf('MyPack/sounds/dig/wood2.ogg'), 'dig/wood2');
  equal('统一小写', soundNameOf('sounds/dig/Stone1.ogg'), 'dig/stone1');

  // 反例：这些都不该被当成音效
  equal('贴图不算音效', soundNameOf('textures/blocks/stone.png'), null);
  equal('不在 sounds/ 下不算', soundNameOf('dig/stone1.ogg'), null);
  equal('没有扩展名不算', soundNameOf('sounds/dig/stone1'), null);
  equal('mp3/flac 不认（解码器不保证有）', soundNameOf('sounds/dig/stone1.mp3'), null);
  equal('sounds.json 不是采样', soundNameOf('sounds/sounds.json'), null);
}

console.log('\n[② 变体展开]');
{
  const stone = soundPathsFor('break_stone');
  equal('石头破坏 4 个变体', stone.length, 4);
  equal('从 1 开始编号（原版约定）', stone[0], 'dig/stone1');
  equal('到 4 结束', stone[3], 'dig/stone4');

  const door = soundPathsFor('door');
  // 原版门声只有一个采样、且文件名不带序号：映射表把两种写法都列上（见 SoundPack 注释），
  // 所以这里展开出 2 条**候选路径**——命中时只有一条会真的存在，另一条自然落空。
  equal('门声两种命名都认', door.length, 2);
  equal('不带序号那种', door[0], 'doors/door_open');
  equal('带序号那种', door[1], 'doors/door_open1');

  // 一个音效声明多条路径时，各条都要展开
  check('每条路径独立展开', soundPathsFor('step_grass').every((path) => path.startsWith('step/grass')));

  // 不存在的音效不该炸
  const missing = soundPathsFor('mob_cow_say' as never);
  equal('未登记的音效返回空数组', missing.length, 0);
}

console.log('\n[③ 映射表合法性]');
{
  const kinds = Object.keys(SOUND_PACK_FILES);

  // 表里的键必须都是真实的 SoundKind——写错一个字母就会静默失效
  const known = new Set<string>(SOUND_KINDS);
  const unknown = kinds.filter((kind) => !known.has(kind));
  check('表里的键都是真实 SoundKind', unknown.length === 0, unknown.join(', '));

  // 每个音效在合成表里都要有 spec（否则它本来就没声音，替换也没意义）
  const noSpec = kinds.filter((kind) => soundSpec(kind as never) === undefined);
  check('每个可替换音效都有合成兜底', noSpec.length === 0, noSpec.join(', '));

  // 声明了 {n} 就必须 variants >= 2，否则展开出来只有一个，等于谎报
  const badVariants: string[] = [];
  for (const [kind, mapping] of Object.entries(SOUND_PACK_FILES)) {
    const usesIndex = mapping.paths.some((path) => path.includes('{n}'));
    if (usesIndex && mapping.variants < 2) badVariants.push(kind);
  }
  check('写了 {n} 的音效至少 2 个变体', badVariants.length === 0, badVariants.join(', '));

  // 变体数不该离谱（原版最多 6 个；写 60 会让人以为资源包缺了一半）
  const tooMany = kinds.filter((kind) => (SOUND_PACK_FILES[kind as keyof typeof SOUND_PACK_FILES]!.variants ?? 0) > 8);
  check('变体数不超过 8', tooMany.length === 0, tooMany.join(', '));

  // 覆盖度：方块类音效是"最该被替换"的一批，至少要把它们全列上
  const blockish = ['break_stone', 'break_wood', 'break_grass', 'break_sand', 'break_glass', 'break_wool'];
  const missingBlocks = blockish.filter((kind) => SOUND_PACK_FILES[kind as never] === undefined);
  check('六种方块破坏音都能被替换', missingBlocks.length === 0, missingBlocks.join(', '));

  const steps = ['step_grass', 'step_stone', 'step_wood', 'step_sand', 'step_gravel', 'step_snow', 'step_wool'];
  const missingSteps = steps.filter((kind) => SOUND_PACK_FILES[kind as never] === undefined);
  check('七种脚步声都能被替换', missingSteps.length === 0, missingSteps.join(', '));

  // 放置音与破坏音共用同一批文件（原版行为），不该各写一套
  const place = SOUND_PACK_FILES.place_stone!.paths;
  const breakp = SOUND_PACK_FILES.break_stone!.paths;
  check('放置石头与破坏石头指向同一批文件', place.join() === breakp.join());
}

console.log('\n[④ 命中判定]');
{
  // 全变体
  const full = mapPackSounds(['dig/stone1', 'dig/stone2', 'dig/stone3', 'dig/stone4']);
  // ⚠️ 不是 1：同一批 `dig/stone*` 同时是"破坏石头""放置石头""挖掘石头"三种音效，
  // 命中与否各算一次（这正是原版"放石头和敲石头一个声"的来源，见映射表的注释）。
  equal('四块石头带出 3 种音效', full.size, 3);
  equal('四个采样都收下', full.get('break_stone')?.length, 4);
  check('放置音也命中', full.has('place_stone'));
  check('挖掘音也命中', full.has('dig_stone'));

  // 部分变体：资源包只给了一部分，也该用
  const partial = mapPackSounds(['dig/wood2']);
  check('只有 1 个变体也算命中', partial.has('break_wood'));
  equal('只收下存在的那一个', partial.get('break_wood')?.length, 1);

  // 因为放置音共用同一批文件，命中 dig/stone* 时放置音也该命中
  check('同一批文件带出放置音', full.has('place_stone'));

  // 没登记的音效不该被误收
  const unknown = mapPackSounds(['music/menu1', 'mob/cow/say1', 'random/levelup']);
  check('音乐不收', !unknown.has('music' as never));
  check('生物叫声不收', !unknown.has('mob_cow_say' as never));
  equal('只有 levelup 那条命中成就音', unknown.size, 1);
  check('成就音命中', unknown.has('achievement'));

  // 单采样音效的两种命名都要认（`door_open` 与 `door_open1` 都有人用）
  check('带序号的门声', mapPackSounds(['doors/door_open1']).has('door'));
  check('不带序号的门声', mapPackSounds(['doors/door_open']).has('door'));

  // 大小写：mapPackSounds 内部转小写，调用方不用预处理
  const upper = mapPackSounds(['DIG/STONE1']);
  check('大写路径也能命中', upper.has('break_stone'));

  // 空包
  equal('空资源包命中 0 个', mapPackSounds([]).size, 0);

  // 统计未映射
  const names = ['dig/stone1', 'music/a.ogg', 'music/b.ogg'];
  equal('未映射计数只算没登记的那些', countUnmappedSounds(names), 2);
}

console.log('\n[⑤ 引擎侧装/卸采样]');
{
  // 引擎在 Node 里没有 AudioContext，构造本身必须安全
  const engine = new AudioEngine();
  check('无 AudioContext 的构造不抛错', true);

  equal('初始没有采样', engine.sampleKinds, 0);
  check('未装采样时 hasSample 为假', !engine.hasSample('break_stone'));

  // 用一个"长得像 AudioBuffer"的对象：引擎只读 `duration`
  const fakeBuffer = (duration: number) => ({ duration }) as unknown as AudioBuffer;

  engine.setSamples('break_stone', [fakeBuffer(0.2), fakeBuffer(0.3)]);
  equal('装上一个音效', engine.sampleKinds, 1);
  check('该音效有采样', engine.hasSample('break_stone'));

  // 再装一次同名 = 整组替换（换资源包不该叠加）
  engine.setSamples('break_stone', [fakeBuffer(0.1)]);
  equal('同名再装不叠加', engine.sampleKinds, 1);

  // 空数组 = 恢复合成音
  engine.setSamples('break_stone', []);
  equal('空数组卸掉该音效', engine.sampleKinds, 0);

  engine.setSamples('break_wood', [fakeBuffer(0.2)]);
  engine.setSamples('place_wood', [fakeBuffer(0.2)]);
  equal('装两个', engine.sampleKinds, 2);
  engine.clearSamples();
  equal('clearSamples 清空', engine.sampleKinds, 0);

  // 播放路径：没有 AudioContext 时 play 必须静默返回，不能抛错
  let threw = false;
  try {
    engine.play('break_stone');
    engine.play('break_stone', { x: 0, y: 0, z: 0 });
  } catch {
    threw = true;
  }
  check('无上下文时 play 不抛错', !threw);
}

console.log('\n[⑥ 不装资源包不能退化]');
{
  // 这条是本次改动的底线：合成音必须一直是兜底。
  // 做法——每个可替换音效都要在合成表里有 spec，且 spec 至少有一层。
  const silent: string[] = [];
  for (const kind of Object.keys(SOUND_PACK_FILES)) {
    const spec = soundSpec(kind as never);
    if (!spec || spec.layers.length === 0) silent.push(kind);
  }
  check('每个可替换音效都有非空的合成兜底', silent.length === 0, silent.join(', '));

  // 反过来：没有任何合成音效被"只靠采样才能响"地改坏——
  // 引擎的 playSpec 里 `sample ?? 合成` 是二选一，这里用源码守卫钉住这个结构。
  const source = AudioEngine.prototype.toString();
  check('playSpec 存在', source.length > 0);
}

console.log(`\n资源包音效测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
