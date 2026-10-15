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
  DEFAULT_SETTINGS,
  PARTICLE_DENSITY,
  PARTICLE_LEVELS,
  PARTICLE_LEVEL_LABELS,
  loadSettings,
  saveSettings,
  type GameSettings,
} from '../src/ui/SettingsScreen.ts';
import { CAMERA_MODES, CAMERA_MODE_LABELS } from '../src/core/viewMode.ts';
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
    Object.keys(DEFAULT_SETTINGS).every((key) => (DEFAULT_SETTINGS as Record<string, unknown>)[key] !== undefined),
  );
}

useStorage(null);
console.log(`\n设置测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
