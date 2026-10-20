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
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  DEFAULT_SETTINGS,
  PARTICLE_DENSITY,
  PARTICLE_LEVELS,
  PARTICLE_LEVEL_LABELS,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  SETTINGS_VERSION,
  TOUCH_AIM_MODES,
  TOUCH_AIM_MODE_LABELS,
  cycleValue,
  defaultViewDistanceFor,
  loadSettings,
  nextCycleValue,
  saveSettings,
  sensitivityGain,
  legacySensitivityGain,
  sensitivityLevelFromGain,
  type GameSettings,
} from '../src/ui/SettingsScreen.ts';
import { HANDEDNESS_LABELS, HANDEDNESS_MODES, fingerAimPoint } from '../src/ui/TouchControls.ts';
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
  check('自动跳跃默认开（与基岩版一致，老存档缺字段也按开）', DEFAULT_SETTINGS.autoJump === true && fallback.autoJump === true);
  // 批次 219：触摸端没有独立使用键，进食要借用"长按空处"，1.6 秒 + 280ms 太磨
  check('快速进食默认开（老存档缺字段也按开）', DEFAULT_SETTINGS.fastEat === true && fallback.fastEat === true);
  check('默认视距/视野在合理范围', DEFAULT_SETTINGS.viewDistance >= 4 && DEFAULT_SETTINGS.viewDistance <= 16 && DEFAULT_SETTINGS.fov >= 45 && DEFAULT_SETTINGS.fov <= 90);
  // 批次 539：桌面默认视距拉到上限 16（手机进世界时会被换成 6）
  check('桌面默认视距拉满 16', DEFAULT_SETTINGS.viewDistance === 16);
  // 批次 521：视野默认 60°（基岩版同款），范围 45~90
  check('视野默认 60°', DEFAULT_SETTINGS.fov === 60 && fallback.fov === 60, String(DEFAULT_SETTINGS.fov));
  // 批次 522：灵敏度重新定标 —— 默认显示 4，但实际倍率 = 上一版的最快档（4×）
  check(
    '灵敏度默认 4 = 上一版最快档（4×），范围 1~8',
    DEFAULT_SETTINGS.sensitivity === 4 &&
      SENSITIVITY_DEFAULT === 4 &&
      SENSITIVITY_MIN === 1 &&
      SENSITIVITY_MAX === 8 &&
      Math.abs(sensitivityGain(DEFAULT_SETTINGS.sensitivity) - 4) < 1e-9,
    String(sensitivityGain(DEFAULT_SETTINGS.sensitivity)),
  );
  check('默认瞄准方式是手指落点', DEFAULT_SETTINGS.aimMode === 'finger');
  check('默认右手模式（摇杆在左）', DEFAULT_SETTINGS.handedness === 'right');
  // 批次 521 曾把默认改成"跟随手指"；批次 528（用户）又改回"固定"
  check('摇杆默认固定', DEFAULT_SETTINGS.touchStick === 'fixed' && fallback.touchStick === 'fixed');
  check('设置格式版本是 4', DEFAULT_SETTINGS.settingsVersion === SETTINGS_VERSION && SETTINGS_VERSION === 4);
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
      settingsVersion: SETTINGS_VERSION,
      viewDistance: 999,
      fov: -20,
      volume: 5,
      sensitivity: -5,
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
  check('视野被夹回下限', messy.fov === 45, String(messy.fov));
  check('音量被夹回 1', messy.volume === 1, String(messy.volume));
  check('灵敏度档位被夹回 1', messy.sensitivity === 1, String(messy.sensitivity));
  // v2 存的是**旧刻度**的档位（4 = 1×、8 = 4×）：迁移要先换算成实际倍率，
  // 再按新刻度找回最近的一档 —— 直接搬数字会让老存档的手感整体变快
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 2, sensitivity: 9 }));
  check('v2 档位 9 → 夹到 8（旧口径 4×）→ 新刻度 4 档', loadSettings().sensitivity === 4, String(loadSettings().sensitivity));
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 2, sensitivity: 6.7 }));
  check('v2 档位 6.7（2.55×）→ 新刻度 2 档', loadSettings().sensitivity === 2, String(loadSettings().sensitivity));
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 3, sensitivity: 4 }));
  check('v3 的 4 档原样保留（= 4×，不再换算）', loadSettings().sensitivity === 4, String(loadSettings().sensitivity));

  // 批次 521：v2 → v3 的**默认值迁移**——只改"还停在旧默认值"的那两项，
  // 玩家自己调过的值必须留着（迁移默认值 ≠ 覆盖玩家的选择）
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 2, fov: 72, touchStick: 'fixed' }));
  const migrated = loadSettings();
  check('v2 的旧默认视野 72 → 60', migrated.fov === 60, String(migrated.fov));
  check('v2 的旧默认摇杆 fixed 保持 fixed', migrated.touchStick === 'fixed', migrated.touchStick);
  // 批次 528：v3 的出厂值是 dynamic，迁移到 v4 的 fixed；显式选过 fixed 的保持不变
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 3, touchStick: 'dynamic' }));
  check('v3 的旧默认摇杆 dynamic → fixed', loadSettings().touchStick === 'fixed', loadSettings().touchStick);
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 3, touchStick: 'fixed' }));
  check('v3 里玩家选过的 fixed 保持 fixed', loadSettings().touchStick === 'fixed', loadSettings().touchStick);
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 2, fov: 80, touchStick: 'fixed' }));
  check('玩家调过的视野 80 不被迁移覆盖', loadSettings().fov === 80, String(loadSettings().fov));
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 3, fov: 72 }));
  check('v3 存档里的 72 原样保留（不再迁移）', loadSettings().fov === 72, String(loadSettings().fov));

  // v1 存的是**倍率本身**：按"实际倍率不变"迁到新刻度；
  // 低于新下限（2.05×）的一律落到 1 档 —— 新刻度表达不了更慢的，这是锚点选在
  // "上一版最快档"的算术后果，不做假动作（不要偷偷把 0.5× 抬成 2× 还假装没变）
  storage.setItem(KEY, JSON.stringify({ sensitivity: 1 }));
  check('老存档 1× → 新刻度 1 档（下限）', loadSettings().sensitivity === 1, String(loadSettings().sensitivity));
  storage.setItem(KEY, JSON.stringify({ sensitivity: 0.5 }));
  check('老存档 0.5× → 也是 1 档', loadSettings().sensitivity === 1, String(loadSettings().sensitivity));
  storage.setItem(KEY, JSON.stringify({ sensitivity: 4 }));
  check('老存档 4× → 新刻度 4 档（位置不变）', loadSettings().sensitivity === 4, String(loadSettings().sensitivity));
  check('非法视角模式回退第一人称', messy.cameraMode === 'first');
  check('非法粒子档位回退"全部"', messy.particles === 'all');
  check('clouds 不是 false 就当开（缺省友好）', messy.clouds === true);
  check('invertY 必须是严格的 true 才生效', messy.invertY === false);
  check('daylightCycle 缺省为开', messy.daylightCycle === true);
  check('showDebug 不是 false 就当开', messy.showDebug === true);

  storage.setItem(KEY, JSON.stringify({ clouds: false, invertY: true, daylightCycle: false, particles: 'off', autoJump: false }));
  const off = loadSettings();
  check('显式关掉的三项都能读回来', off.clouds === false && off.invertY === true && off.daylightCycle === false && off.particles === 'off');
  check('自动跳跃可以显式关掉', off.autoJump === false);

  // 快速进食（批次 219）：默认开，但必须能显式关回原版的 1.6 秒
  storage.setItem(KEY, JSON.stringify({ fastEat: false }));
  check('快速进食可以显式关掉（回到原版 1.6 秒）', loadSettings().fastEat === false);
  storage.setItem(KEY, JSON.stringify({ fastEat: 'no' }));
  check('脏值不当成关闭（只认严格的 false）', loadSettings().fastEat === true);
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
    sensitivity: 6,
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

// ---------------------------------------------------------------- 3b. 灵敏度 / 瞄准方式 / 左右手（批次 271）

console.log('\n[灵敏度档位 / 瞄准方式 / 左右手（批次 271）]');
{
  // 批次 522：4 档 = 上一版的最快档（4×），每档等比 ×1.25
  check('4 档 = 4×（上一版最快档，用户要求）', Math.abs(sensitivityGain(4) - 4) < 1e-9, String(sensitivityGain(4)));
  check('每档等比 ×1.25（体感均匀）', Math.abs(sensitivityGain(5) / sensitivityGain(4) - 1.25) < 1e-9);
  check('1 档 ≈ 2.05×（新的下限）', Math.abs(sensitivityGain(1) - 4 / 1.25 ** 3) < 1e-9, String(sensitivityGain(1)));
  check('8 档 ≈ 9.77×（真正的加速余量）', Math.abs(sensitivityGain(8) - 4 * 1.25 ** 4) < 1e-9, String(sensitivityGain(8)));
  check(
    '整条滑杆严格递增（拨一格只会更快，不会跳档）',
    [1, 2, 3, 4, 5, 6, 7].every((level) => sensitivityGain(level + 1) > sensitivityGain(level)),
  );
  check('越界档位被夹住', sensitivityGain(-3) === sensitivityGain(1) && sensitivityGain(99) === sensitivityGain(8));

  // 迁移：先用**旧口径**把档位还原成实际倍率，再找最近的新档位
  check('旧档位 8（4×）→ 新档位 4（手感不变）', sensitivityLevelFromGain(legacySensitivityGain(8)) === 4);
  check('旧档位 7（2.83×）→ 新档位 2（2.56×）', sensitivityLevelFromGain(legacySensitivityGain(7)) === 2);
  check('旧档位 4（1×）→ 落到新下限 1 档', sensitivityLevelFromGain(legacySensitivityGain(4)) === 1);
  check('老倍率 4× → 新档位 4', sensitivityLevelFromGain(4) === 4);
  check('老倍率 0.5× → 落到新下限 1 档', sensitivityLevelFromGain(0.5) === 1);

  check('瞄准方式只有两档，且都有中文标签', TOUCH_AIM_MODES.join(',') === 'finger,center' && TOUCH_AIM_MODES.every((mode) => TOUCH_AIM_MODE_LABELS[mode].length > 0));
  check('左右手只有两档，且都有中文标签', HANDEDNESS_MODES.join(',') === 'right,left' && HANDEDNESS_MODES.every((mode) => HANDEDNESS_LABELS[mode].length > 0));

  // ---- 手指瞄准的取点偏移（批次 521）
  //
  // 指肚会盖住目标格，所以右手往**左上**、左手往**右上**各偏 r/√2（45° 圆周点）。
  const radius = 46;
  const edge = (radius * Math.SQRT1_2);
  const right = fingerAimPoint(100, 200, radius, 'right');
  const left = fingerAimPoint(100, 200, radius, 'left');
  check('右手取点：左上边缘', Math.abs(right.x - (100 - edge)) < 1e-9 && Math.abs(right.y - (200 - edge)) < 1e-9, `${right.x},${right.y}`);
  check('左手取点：右上边缘', Math.abs(left.x - (100 + edge)) < 1e-9 && Math.abs(left.y - (200 - edge)) < 1e-9, `${left.x},${left.y}`);
  check('两种手都往上偏（手指总从下方伸上来）', right.y < 200 && left.y < 200);
  check('左右镜像（横向偏移等大反向）', Math.abs((right.x - 100) + (left.x - 100)) < 1e-9);
  check('半径为 0 时原样返回', fingerAimPoint(10, 20, 0, 'right').x === 10 && fingerAimPoint(10, 20, 0, 'right').y === 20);

  const storage = new MemoryStorage();
  useStorage(storage);
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 2, aimMode: 'center', handedness: 'left' }));
  const saved = loadSettings();
  check('瞄准方式 / 左右手能存下来并读回', saved.aimMode === 'center' && saved.handedness === 'left');
  storage.setItem(KEY, JSON.stringify({ settingsVersion: 2, aimMode: '自动锁头', handedness: '双手' }));
  const dirty = loadSettings();
  check('非法瞄准方式回退手指落点', dirty.aimMode === 'finger');
  check('非法左右手回退右手模式', dirty.handedness === 'right');
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

console.log('\n[六组音量（批次 178 / 233）]');
{
  check(
    '四组音效默认都是 1（默认状态下不该比以前轻）',
    DEFAULT_SETTINGS.volumeBlocks === 1 &&
      DEFAULT_SETTINGS.volumeMobs === 1 &&
      DEFAULT_SETTINGS.volumePlayer === 1 &&
      DEFAULT_SETTINGS.volumeUi === 1,
  );
  // 批次 233：环境音默认 1（不额外衰减），音乐默认 0.6（背景不该和挨打一样响）
  check(
    '环境音默认 1、音乐默认 0.6',
    DEFAULT_SETTINGS.volumeAmbient === 1 && DEFAULT_SETTINGS.volumeMusic === 0.6,
  );

  const storage = new MemoryStorage();
  useStorage(storage);
  saveSettings({ ...DEFAULT_SETTINGS, volumeMobs: 0.25, volumeUi: 0, volumeAmbient: 0.4, volumeMusic: 0 });
  const roundTrip = loadSettings();
  check(
    '四项都能存下来并读回',
    roundTrip.volumeMobs === 0.25 && roundTrip.volumeUi === 0 && roundTrip.volumeBlocks === 1,
  );
  check('环境音 / 音乐也能存下来并读回', roundTrip.volumeAmbient === 0.4 && roundTrip.volumeMusic === 0);

  // 脏数据：超范围要夹住（0~1），不是原样吃下去
  storage.setItem(KEY, JSON.stringify({ volumeBlocks: 5, volumePlayer: -3, volumeMobs: 'loud' }));
  const dirty = loadSettings();
  check('超过 1 的夹到 1', dirty.volumeBlocks === 1);
  check('负数夹到 0', dirty.volumePlayer === 0);
  check('不是数字的回退默认 1', dirty.volumeMobs === 1);

  // 老存档里没有这两项 → 回退默认，而不是 undefined
  storage.setItem(KEY, JSON.stringify({ volume: 0.5 }));
  const legacy = loadSettings();
  check('老存档缺这两项时回退默认', legacy.volumeAmbient === 1 && legacy.volumeMusic === 0.6);

  storage.setItem(KEY, JSON.stringify({ volumeAmbient: 9, volumeMusic: -2 }));
  const clamped = loadSettings();
  check('新两项同样夹在 0~1', clamped.volumeAmbient === 1 && clamped.volumeMusic === 0);
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
  // 批次 216：8 → 6（用户愿意让视野，换帧率与画质）
  check(
    '手机视距上限是 6（不是 12）',
    defaultViewDistanceFor(true) === MOBILE_VIEW_DISTANCE_MAX && MOBILE_VIEW_DISTANCE_MAX === 6,
  );
  check(
    '开局仍然只有 5（先给脚下这一片，别让渐进视距一上来就请求满）',
    MOBILE_VIEW_DISTANCE === 5 && MOBILE_VIEW_DISTANCE < defaultViewDistanceFor(true),
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

// ---------------------------------------------------------------- 10. 批次 220：场景亮度

console.log('\n[场景亮度（批次 220）]');
{
  check('默认亮度是 1（= 不滤镜，与加这个设置之前完全一样）', DEFAULT_SETTINGS.brightness === 1);
  check('范围是 50%~200%', BRIGHTNESS_MIN === 0.5 && BRIGHTNESS_MAX === 2);

  const storage = new MemoryStorage();
  useStorage(storage);
  saveSettings({ ...DEFAULT_SETTINGS, brightness: 1.35 });
  check('调过之后能存下来并读回', Math.abs(loadSettings().brightness - 1.35) < 1e-9);

  // 脏数据：超范围要夹住，不是原样吃下去（否则一个坏值能把画面洗成全白/全黑）
  storage.setItem(KEY, JSON.stringify({ brightness: 9 }));
  check('超过 200% 夹到 2', loadSettings().brightness === 2);
  storage.setItem(KEY, JSON.stringify({ brightness: 0.1 }));
  check('低于 50% 夹到 0.5', loadSettings().brightness === 0.5);
  storage.setItem(KEY, JSON.stringify({ brightness: '亮一点' }));
  check('不是数字的回退默认 1', loadSettings().brightness === 1);
}

useStorage(null);
console.log(`\n设置测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
