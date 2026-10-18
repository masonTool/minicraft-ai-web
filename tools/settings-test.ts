/**
 * 设置项（K3）离线测试
 *
 * 覆盖：
 *  1. 默认值齐全，且每种设置都在合法范围内
 *  2. `loadSettings` 的容错：没有 localStorage、JSON 损坏、字段是脏数据 → 逐项回退
 *  3. `saveSettings` 往返：存进去再读出来要一模一样
 *  4. 粒子档位 → 生成密度倍率的映射，以及它真的会改变粒子数量（关掉就是 0）
 *  5. 云的开关会真的改到天空那层网格的可见性
 *  6. 视角模式下拉框、粒子下拉框的取值集合与标签一一对应
 *
 * 运行：npm run test:settings
 */

import {
  AUTOSAVE_LABELS,
  AUTOSAVE_OPTIONS,
  DEFAULT_SETTINGS,
  PARTICLE_DENSITY,
  PARTICLE_LEVELS,
  PARTICLE_LEVEL_LABELS,
  cycleValue,
  defaultViewDistanceFor,
  loadSettings,
  nextCycleValue,
  saveSettings,
  type GameSettings,
} from '../src/ui/SettingsScreen.ts';
import { CAMERA_MODES, CAMERA_MODE_LABELS } from '../src/core/viewMode.ts';
import {
  FRAME_TIME_DROP,
  MOBILE_VIEW_DISTANCE,
  MOBILE_VIEW_DISTANCE_MAX,
  initialPerfState,
  viewDistanceCapFor,
} from '../src/core/world/PerfPolicy.ts';
import { ParticleSystem } from '../src/render/ParticleSystem.ts';

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

/** 内存版 localStorage */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const KEY = 'bedrock-settings';

/** 把假的 localStorage 装到全局：loadSettings/saveSettings 都读它 */
function useStorage(storage: MemoryStorage | null): void {
  if (storage) (globalThis as { localStorage?: unknown }).localStorage = storage;
  else delete (globalThis as { localStorage?: unknown }).localStorage;
}

// ---------------------------------------------------------------- 1. 默认值

console.log('\n[默认设置]');
{
  useStorage(null);
  const fallback = loadSettings();
  check('没有 localStorage 时也能拿到一份完整设置', typeof fallback.fov === 'number' && fallback.cameraMode === 'first');
  check('默认视角是第一人称', DEFAULT_SETTINGS.cameraMode === 'first');
  check('默认粒子是全部、云是开、昼夜循环是开', DEFAULT_SETTINGS.particles === 'all' && DEFAULT_SETTINGS.clouds && DEFAULT_SETTINGS.daylightCycle);
  check('默认不反转上下视角', DEFAULT_SETTINGS.invertY === false);
  check('默认视距/视野在合理范围', DEFAULT_SETTINGS.viewDistance >= 4 && DEFAULT_SETTINGS.viewDistance <= 16 && DEFAULT_SETTINGS.fov >= 60 && DEFAULT_SETTINGS.fov <= 110);
}

// ---------------------------------------------------------------- 2. 容错

console.log('\n[设置的容错]');
{
  const storage = new MemoryStorage();
  useStorage(storage);

  storage.setItem(KEY, '{ 这不是 JSON');
  check('JSON 损坏 → 整份回退默认', loadSettings().fov === DEFAULT_SETTINGS.fov);

  storage.setItem(
    KEY,
    JSON.stringify({
      viewDistance: 999,
      fov: -20,
      volume: 5,
      sensitivity: 0,
      cameraMode: '从没见过',
      particles: 'super',
      clouds: 'yes',
      invertY: 1,
      daylightCycle: null,
      showDebug: 'nope',
    }),
  );
  const messy = loadSettings();
  check('视距被夹回上限', messy.viewDistance === 16, String(messy.viewDistance));
  check('视野被夹回下限', messy.fov === 60, String(messy.fov));
  check('音量被夹回 1', messy.volume === 1, String(messy.volume));
  check('灵敏度被夹回 0.5', messy.sensitivity === 0.5, String(messy.sensitivity));
  check('非法视角模式回退第一人称', messy.cameraMode === 'first');
  check('非法粒子档位回退"全部"', messy.particles === 'all');
  check('clouds 不是 false 就当开（缺省友好）', messy.clouds === true);
  check('invertY 必须是严格的 true 才生效', messy.invertY === false);
  check('daylightCycle 缺省为开', messy.daylightCycle === true);
  check('showDebug 不是 false 就当开', messy.showDebug === true);

  storage.setItem(KEY, JSON.stringify({ clouds: false, invertY: true, daylightCycle: false, particles: 'off' }));
  const off = loadSettings();
  check('显式关掉的三项都能读回来', off.clouds === false && off.invertY === true && off.daylightCycle === false && off.particles === 'off');
}

// ---------------------------------------------------------------- 3. 往返

console.log('\n[保存与读取]');
{
  const storage = new MemoryStorage();
  useStorage(storage);
  const custom: GameSettings = {
    ...DEFAULT_SETTINGS,
    viewDistance: 8,
    fov: 90,
    volume: 0.25,
    sensitivity: 1.75,
    cameraMode: 'third-front',
    particles: 'reduced',
    clouds: false,
    invertY: true,
    daylightCycle: false,
    showDebug: false,
    adaptiveViewDistance: false,
  };
  saveSettings(custom);
  check('保存后读回来完全一致', JSON.stringify(loadSettings()) === JSON.stringify(custom));
}

// ---------------------------------------------------------------- 4. 粒子档位

console.log('\n[粒子效果档位]');
{
  check('三档都有标签', PARTICLE_LEVELS.every((level) => PARTICLE_LEVEL_LABELS[level].length > 0));
  check('关闭档密度是 0', PARTICLE_DENSITY.off === 0);
  check('减少档介于中间', PARTICLE_DENSITY.reduced > 0 && PARTICLE_DENSITY.reduced < 1);
  check('全部档是 1', PARTICLE_DENSITY.all === 1);

  const particles = new ParticleSystem();
  particles.spawnBlockBreak(0, 0, 0, 0xffffff);
  const full = particles.active;
  particles.clear();
  particles.setDensity(PARTICLE_DENSITY.reduced);
  particles.spawnBlockBreak(0, 0, 0, 0xffffff);
  const reduced = particles.active;
  particles.clear();
  particles.setDensity(PARTICLE_DENSITY.off);
  particles.spawnBlockBreak(0, 0, 0, 0xffffff);
  particles.spawnSplash(0, 0, 0);
  particles.spawnCrit(0, 0, 0);
  const off = particles.active;

  check('全部档生成了粒子', full > 0, String(full));
  check('减少档比全部档少', reduced > 0 && reduced < full, `${reduced} < ${full}`);
  check('关闭档一个都不生成（连水花和暴击也不生成）', off === 0, String(off));
  particles.dispose();
}

// ---------------------------------------------------------------- 5. 云的开关
//
// 这里**不能**离线测 `Sky`：它构造时要画一张 canvas 贴图（`document`），Node 里没有。
// 于是只保证"设置项能存能读"（上面已经覆盖），开关是否真的作用到云层由浏览器实测确认。

console.log('\n[云]');
{
  check('云是布尔设置且默认开启', DEFAULT_SETTINGS.clouds === true);
  const storage = new MemoryStorage();
  useStorage(storage);
  saveSettings({ ...DEFAULT_SETTINGS, clouds: false });
  check('关掉云之后能存下来并读回', loadSettings().clouds === false);
}

// ---------------------------------------------------------------- 6. 选项集合

console.log('\n[下拉框的选项]');
{
  check('视角选项与标签一一对应', CAMERA_MODES.every((mode) => typeof CAMERA_MODE_LABELS[mode] === 'string'));
  check('粒子选项与标签一一对应', PARTICLE_LEVELS.every((level) => typeof PARTICLE_LEVEL_LABELS[level] === 'string'));
  check('视角选项数量是 3', CAMERA_MODES.length === 3);
  check('粒子选项数量是 3', PARTICLE_LEVELS.length === 3);
  check(
    '每个设置项都有默认值（新增字段忘了给默认值会在这里暴露）',
    Object.keys(DEFAULT_SETTINGS).every(
      (key) => (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key] !== undefined,
    ),
  );
}

// ---------------------------------------------------------------- 7. 批次 172：天气效果与自动保存

console.log('\n[天气效果 / 自动保存间隔（批次 172，M20）]');
{
  check('天气效果默认开（不然玩家会以为雨坏了）', DEFAULT_SETTINGS.weatherEffects === true);
  check('自动保存默认 30 秒', DEFAULT_SETTINGS.autosaveSeconds === 30);
  check(
    '自动保存只给三档，且每档都有中文标签',
    AUTOSAVE_OPTIONS.length === 3 && AUTOSAVE_OPTIONS.every((value) => typeof AUTOSAVE_LABELS[String(value)] === 'string'),
  );

  const storage = new MemoryStorage();
  useStorage(storage);
  saveSettings({ ...DEFAULT_SETTINGS, weatherEffects: false, autosaveSeconds: 120 });
  const roundTrip = loadSettings();
  check('两项都能存下来并读回', roundTrip.weatherEffects === false && roundTrip.autosaveSeconds === 120);

  // 脏数据：不在那三档里的间隔一律回到 30（45 秒这种"看着合理"的值也不行，
  // 否则"改了一个不存在的档位"会让界面显示 A、实际按 B 跑）
  storage.setItem(KEY, JSON.stringify({ autosaveSeconds: 45, weatherEffects: 'no' }));
  const dirty = loadSettings();
  check('脏的间隔回退到 30 秒', dirty.autosaveSeconds === 30);
  check('weatherEffects 只有显式 false 才算关（缺省友好）', dirty.weatherEffects === true);

  // ⚠️ 循环按钮的"数字 vs 字符串"bug（批次 130 潜伏到 172）：
  //   设置里存的是数字，而选项表是字符串；老写法 `values.includes(30)` 永远为假，
  //   于是按钮永远显示第一档、点一次之后再也换不动。
  check('帧率上限：数字 30 能对上字符串档位', cycleValue(['0', '30', '60'], 30) === '30');
  check('帧率上限：30 点一下 → 60（不再是"卡在 30"）', nextCycleValue(['0', '30', '60'], 30) === '60');
  check('帧率上限：60 点一下 → 回到不限', nextCycleValue(['0', '30', '60'], 60) === '0');
  check('自动保存：120 点一下 → 回到 30', nextCycleValue(AUTOSAVE_OPTIONS.map(String), 120) === '30');
  check('非法值一律显示第一档', cycleValue(['0', '30', '60'], 999) === '0');
}

// ---------------------------------------------------------------- 8. 批次 178：四组音量

console.log('\n[四组音量（批次 178）]');
{
  check(
    '四组默认都是 1（默认状态下不该比以前轻）',
    DEFAULT_SETTINGS.volumeBlocks === 1 &&
      DEFAULT_SETTINGS.volumeMobs === 1 &&
      DEFAULT_SETTINGS.volumePlayer === 1 &&
      DEFAULT_SETTINGS.volumeUi === 1,
  );

  const storage = new MemoryStorage();
  useStorage(storage);
  saveSettings({ ...DEFAULT_SETTINGS, volumeMobs: 0.25, volumeUi: 0 });
  const roundTrip = loadSettings();
  check(
    '四项都能存下来并读回',
    roundTrip.volumeMobs === 0.25 && roundTrip.volumeUi === 0 && roundTrip.volumeBlocks === 1,
  );

  // 脏数据：超范围要夹住（0~1），不是原样吃下去
  storage.setItem(KEY, JSON.stringify({ volumeBlocks: 5, volumePlayer: -3, volumeMobs: 'loud' }));
  const dirty = loadSettings();
  check('超过 1 的夹到 1', dirty.volumeBlocks === 1);
  check('负数夹到 0', dirty.volumePlayer === 0);
  check('不是数字的回退默认 1', dirty.volumeMobs === 1);
}

// ---------------------------------------------------------------- 9. 批次 202 / 203：视距口径

console.log('\n[视距口径：设备上限与恢复默认（批次 202 / 203）]');
{
  // 真机反馈："在设置里恢复默认都没用，还是卡"。三个原因各自断言一条：
  //  ① 恢复默认把**桌面**的 12 原样写回去 → 手机上等于请求 489 个区块；
  //  ② 自适应已经降下去的分辨率/装饰层不在 settings 里，恢复默认碰不到它们；
  //  ③ `main.applySettings` 直接赋值 `settings.viewDistance`，绕过了手机上限。
  check(
    '桌面视距上限还是 12 区块',
    defaultViewDistanceFor(false) === DEFAULT_SETTINGS.viewDistance,
  );
  // 批次 203：玩家已经没有视距滑块，这个值就是"自适应允许涨到哪"
  check(
    '手机视距上限是 8（不是 12）',
    defaultViewDistanceFor(true) === MOBILE_VIEW_DISTANCE_MAX && MOBILE_VIEW_DISTANCE_MAX === 8,
  );
  check(
    '开局仍然只有 6（先给脚下这一片，别让渐进视距一上来就请求满）',
    MOBILE_VIEW_DISTANCE === 6 && MOBILE_VIEW_DISTANCE < defaultViewDistanceFor(true),
  );

  // `main.applySettings` 现在走的这条夹紧：滑块上写 12 → 实际只按 8 请求区块
  check('手机把 12 夹到 8（不再一口气请求 489 个区块）',
    viewDistanceCapFor(12, true) === MOBILE_VIEW_DISTANCE_MAX);
  check('桌面夹紧不改变玩家的 12', viewDistanceCapFor(12, false) === 12);

  // ②：恢复默认要把运行时那一份也复位——`initialPerfState` 就是"满分辨率 + 装饰层全开"
  const fresh = initialPerfState(defaultViewDistanceFor(true));
  check('复位后渲染分辨率回到 1.0', fresh.resolutionScale === 1);
  check('复位后装饰层回到 0（云与粒子回来）', fresh.decorLevel === 0);
  check('复位后帧时间假定值不再"卡"（否则会立刻再降一轮）', fresh.frameTimeAvg < FRAME_TIME_DROP);
}

useStorage(null);
console.log(`\n设置测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
