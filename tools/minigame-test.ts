/**
 * 单机小游戏的离线测试（J0，批次 20261022-2220）
 *
 * 运行：`npm run test:minigame`
 *
 * 覆盖三块：
 *  1. **宿主与接线**：小游戏的宿主、游戏本身依赖 DOM / WebGL，离线只能做静态断言
 *     （接线在不在、异常兜底在不在、退出有没有清舞台、dt 有没有夹住）。
 *     真正的"进入→退出→无残留"在浏览器里用 `minigame:perf` 验（前后比对 `renderer.info.memory`）。
 *  2. **共享渲染的纯逻辑**：按图集 tile 分组（draw call = 方块种类数），5000 格压测。
 *  3. **目录与最高分**：纯函数 + 存储容错。
 *
 * 跳一跳的规则断言（生成器 / 蓄力距离 / 落点 / 连击）在 [跳跳2] 加进本文件。
 */

import { readFileSync } from 'node:fs';
import { MINIGAME_CATALOG, miniGameEntry } from '../src/minigame/catalog.ts';
import {
  BLOCK_COLORS,
  JUMP_PALETTES,
  blockColorAt,
  paletteForSeed,
  shadeForNormal,
} from '../src/minigame/games/jump/palette.ts';
import {
  EMPTY_PROGRESS,
  MINIGAME_PROGRESS_KEY,
  bestScore,
  loadProgress,
  recordScore,
  saveProgress,
} from '../src/minigame/progress.ts';
import { JUMP_CONFIG } from '../src/minigame/games/jump/config.ts';
import {
  blockOverhang,
  blockSizeForScore,
  createRun,
  currentBlock,
  distanceForCharge,
  gapCurveForScore,
  gapFloorFor,
  gapForScore,
  gapRangeForScore,
  jitteredSize,
  jump,
  maxReachableGap,
  nextBlock,
  resolveLanding,
  scoreForLanding,
  shapeFor,
  specialBonus,
  specialKindFor,
  targetBlock,
  type JumpBlock,
} from '../src/minigame/games/jump/logic.ts';

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

function almost(label: string, actual: number, expected: number, tolerance = 1e-6): void {
  check(
    label,
    Math.abs(actual - expected) <= tolerance,
    `实际 ${actual}，期望 ${expected} ±${tolerance}`,
  );
}

const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hostSrc = readFileSync(new URL('../src/minigame/MiniGameHost.ts', import.meta.url), 'utf8');
const smokeSrc = readFileSync(new URL('../src/minigame/games/smoke.ts', import.meta.url), 'utf8');
const jumpSrc = readFileSync(new URL('../src/minigame/games/jump/scene.ts', import.meta.url), 'utf8');
const menuSrc = readFileSync(new URL('../src/ui/MiniGameMenu.ts', import.meta.url), 'utf8');
const blockSceneSrc = readFileSync(new URL('../src/minigame/games/jump/BlockScene.ts', import.meta.url), 'utf8');
const audioSrc = readFileSync(new URL('../src/minigame/games/jump/audio.ts', import.meta.url), 'utf8');
const htmlSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

console.log('\n小游戏框架：主程序接线');
{
  check('宿主在主程序里构造', mainSrc.includes('new MiniGameHost(document.body'));
  check('主循环有早退分支', mainSrc.includes('if (this.miniGame.active)'));
  check('分支里只跑小游戏帧', mainSrc.includes('this.miniGame.update(gameDt)'));
  check('分支在排队下一帧后返回（不会停死）', /this\.miniGame\.update\(gameDt\);\s*\n\s*schedule\(\);\s*\n\s*return;/.test(mainSrc));
  check('进入时收起触摸层', mainSrc.includes('this.touch?.setEnabled(false)'));
  check('进入时清掉主输入', mainSrc.includes("this.touch?.resetInput('minigame')"));
  check('退出时恢复触摸层', mainSrc.includes('this.touch?.setEnabled(!this.uiOpen)'));
  check('退出时重置帧计时', mainSrc.includes('this.lastTime = performance.now()'));
  check('Esc 退出', mainSrc.includes('this.miniGame.stop()'));
  check('退出世界时拆掉小游戏层', mainSrc.includes('this.miniGame.dispose()'));
  check('不再引用已删除的旧游戏', !/sokoban|breakout/i.test(mainSrc));
}

console.log('\n小游戏框架：宿主契约');
{
  check('mount 走 context', hostSrc.includes('game.mount(this.context())'));
  check('mount 异常兜底', hostSrc.includes('this.fail(error)'));
  check('unmount 包了 try/catch', hostSrc.includes('game.unmount()'));
  check('退出清空舞台 DOM', hostSrc.includes('this.stage.replaceChildren()'));
  check('退出隐藏整层', hostSrc.includes("this.layer.classList.add('hidden')"));
  check('指针坐标归一化', hostSrc.includes('(event.clientX - rect.left) / rect.width'));
  check('dt 夹到 0.1 秒', hostSrc.includes('Math.min(0.1'));
  check('重复 stop 是空操作', /stop\(notify = true\): void \{\s*\n\s*const game = this\.game;\s*\n\s*if \(!game\) return;/.test(hostSrc));
  check('转场不阻塞挂载（同步 mount）', !hostSrc.includes('setTimeout(() => game.mount'));
  check('渲染状态每帧重置', hostSrc.includes('renderer.autoClear = true') && hostSrc.includes('renderer.setScissorTest(false)'));
}

console.log('\n小游戏框架：自检游戏的资源释放');
{
  check('释放几何', smokeSrc.includes('this.cube.geometry.dispose()'));
  check('释放材质', smokeSrc.includes('this.cube.material.dispose()'));
  check('从场景里摘掉', smokeSrc.includes('this.scene?.remove(this.cube)'));
  check('清空场景', smokeSrc.includes('this.scene?.clear()'));
  check('移除 HUD DOM', smokeSrc.includes('this.hint?.remove()'));
  check('每帧自己渲染', smokeSrc.includes('renderer.render(this.scene, this.camera)'));
}

console.log('\n跳一跳：场景与流程（静态断言）');
{
  check('id 是 jump', jumpSrc.includes("readonly id = 'jump'"));
  check('场景是等距纯色方块 BlockScene', jumpSrc.includes('new BlockScene('));
  check('不再有 MC 图集柱子', !jumpSrc.includes('PillarScene') && !jumpSrc.includes('themes.ts'));
  check('小人是棋子 JumperModel（不再用 MC 玩家模型）', jumpSrc.includes('new JumperModel(') && !jumpSrc.includes('PlayerRenderer'));
  check('卸载时释放小人', jumpSrc.includes('this.jumper?.dispose()'));
  check('卸载时释放场景', jumpSrc.includes('this.blocks?.dispose()'));
  check('卸载时移除 HUD', jumpSrc.includes('this.hud?.remove()'));
  check('HUD 只有一个分数（没有最高分行）', !jumpSrc.includes('jump-best') && !jumpSrc.includes('bestEl'));
  check('没有底部提示', !jumpSrc.includes('jump-hint') && !jumpSrc.includes('hintEl'));
  check('结算面板是"大数字 + 最高分 + 两颗按钮"', jumpSrc.includes('jump-over-score') && jumpSrc.includes('jump-over-best'));
  // 分数挂在 stage 上，而宿主顶栏（退出 + 标题，z-index 4）也在左上角：
  // 用百分比贴顶会被盖住，而"看不看得见"这类问题离线断言查不到，只能钉住定位写法。
  check(
    '分数让开宿主顶栏（top 用 56px + 安全区，不是百分比）',
    /\.jump-hud\s*\{[^}]*top:\s*calc\(56px\s*\+\s*env\(safe-area-inset-top/.test(htmlSrc),
  );
  check('分数左边留出安全区', /\.jump-hud\s*\{[^}]*left:[^;]*env\(safe-area-inset-left/.test(htmlSrc));
  check('每帧自己渲染', jumpSrc.includes('blocks.render(context.renderer)'));
  check('蓄力压扁小人', jumpSrc.includes('jumper.setSquash(ratio)'));
  check('蓄力压缩方块', jumpSrc.includes('setSquash'));
  check('空中翻转 360°（Sinusoidal.InOut）', jumpSrc.includes('setFlip(-Math.PI * 2 * flipProgress(progress))'));
  check('站高按方块高度算（方块会随分数变矮）', jumpSrc.includes('standHeight('));
  check('最高分落盘', jumpSrc.includes('recordScore(') && jumpSrc.includes('saveProgress('));
  check('特殊方块停留加分', jumpSrc.includes('specialHoldSeconds') && jumpSrc.includes('specialBonus('));
  check('音效抽到 audio.ts（场景里不再有 WebAudio 调用）', !jumpSrc.includes('createOscillator') && jumpSrc.includes("from './audio.ts'"));
  check('特殊方块按种类播放各自音色', jumpSrc.includes('playSpecial(block.kind)'));
  check('落地换小人尺寸（方块会随分数变小）', jumpSrc.includes('this.jumper?.setSize('));
  check('一跳固定 400ms（与跳多远无关）', jumpSrc.includes('JUMP_TIMING.totalMs / 1000'));
  check('弧线与空翻走 motion.ts', jumpSrc.includes('jumpArc(') && jumpSrc.includes('flipProgress('));
  check('落地压缩 100ms 回弹', jumpSrc.includes('landingSquash('));
  check('完美命中出同心圆 + 飘字', jumpSrc.includes('playRipple(') && jumpSrc.includes('jump-float'));
  check('被踩的方块回弹', jumpSrc.includes('.punch('));
  // debugState 是给 `jump:e2e` 用的只读契约，而 E2E 不在 CI 里跑（要浏览器）——
  // 字段被改名的话，线上没人会发现，只有离线这条还能立刻变红。
  check(
    'debugState 暴露 E2E 依赖的字段',
    ['gap', 'gapRatio', 'axis', 'kind', 'nextKind', 'orthographic', 'phase', 'score', 'index', 'best'].every(
      (field) => new RegExp(`\\b${field}:`).test(jumpSrc.replace(/\/\/[^\n]*/g, '')),
    ),
  );
  check('退出按钮走宿主 exit', jumpSrc.includes('context.exit()'));
  check('重开不退出宿主', jumpSrc.includes('this.restart()'));
}

console.log('\n音效模块（audio.ts）');
{
  check('蓄力每 0.15 秒升一级', audioSrc.includes('CHARGE_STEP_SECONDS = 0.15'));
  check('蓄力是"阶梯音阶"不是连续滑音', audioSrc.includes('chargeStepFor(') && audioSrc.includes('chargeFrequencyFor('));
  check('四类特殊方块各有旋律', audioSrc.includes('well: [') && audioSrc.includes('music: ['));
  check('起跳/落地/完美/失败四种单音', audioSrc.includes('JUMP_SFX') && audioSrc.includes('LAND_SFX') && audioSrc.includes('PERFECT_SFX') && audioSrc.includes('FAIL_SFX'));
  check('拿不到 AudioContext 时静默降级', audioSrc.includes('catch') && audioSrc.includes('return null'));
}

console.log('\nBlockScene 的渲染前提（正交 / 不打灯 / 无雾 / 不借 MC 图集）');
{
  check('相机是正交的', blockSceneSrc.includes('new THREE.OrthographicCamera('));
  check('不打灯（三面明暗靠顶点色，不靠灯）', !blockSceneSrc.includes('DirectionalLight') && !blockSceneSrc.includes('AmbientLight'));
  check('没有雾', !blockSceneSrc.includes('scene.fog'));
  check('不再读主世界图集', !blockSceneSrc.includes('TextureAtlas'));
  check('三面明暗与方块色都来自 palette', blockSceneSrc.includes('shadeForNormal(') && blockSceneSrc.includes('blockColorAt('));
  check('阴影是不写深度的透明贴片', blockSceneSrc.includes('depthWrite: false'));
  check('特殊方块用程序化图集', blockSceneSrc.includes('createBlockAtlas('));
  check('方块动画每帧推进', blockSceneSrc.includes('tick(dt: number)'));
  // 顶面白点是原版唯一的落点提示（参考图 02/03 每块都有），漏了只有截图能发现
  check('普通方块顶面有白点', blockSceneSrc.includes('DOT_RADIUS_RATIO') && blockSceneSrc.includes("spec.kind === 'normal'"));
  check('白点随方块高度/缩放同步', blockSceneSrc.includes('entry.dot.position.set(') && blockSceneSrc.includes('entry.dot.scale.set('));
  check('白点随卸载释放', blockSceneSrc.includes('this.dotGeometry.dispose()') && blockSceneSrc.includes('this.dotMaterial.dispose()'));
  check('入场进度跨重建保留（按位置键）', blockSceneSrc.includes('ages.set(entry.key'));
  check('掉队的方块淡出而不是直接消失', blockSceneSrc.includes('this.fading.push(entry)'));
  // 配色必须跟"方块身份"走，不能跟"这一屏列表里的下标"走——后者会让每跳一次全世界重新上色
  check('方块配色按身份取（不是按列表下标）', blockSceneSrc.includes('blockColorAt(this.palette, spec.colorIndex)'));
  check('每帧渲染走正交相机', blockSceneSrc.includes('renderer.render(this.scene, this.camera)'));
  check('释放时清空贴图与几何', blockSceneSrc.includes('specialTextures') && blockSceneSrc.includes('dispose()'));
}

// ------------------------------------------------------------------ 色板与明暗

/** sRGB 相对亮度（0~1）：只用于断言"方块不能糊进背景" */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

console.log('\n色板与三面明暗（原版观感的两个硬指标）');
{
  equal('背景色板 6 组', JUMP_PALETTES.length, 6);
  equal('方块色 8 个', BLOCK_COLORS.length, 8);
  const unknown = JUMP_PALETTES.flatMap((p) => p.blocks.filter((c) => !(BLOCK_COLORS as readonly string[]).includes(c)));
  equal('每局的方块色都登记在 BLOCK_COLORS 里', unknown.length, 0);
  check(
    '每组 3~4 个方块色（一屏就是 3~4 块）',
    JUMP_PALETTES.every((p) => p.blocks.length >= 3 && p.blocks.length <= 4),
  );
  check(
    '背景一律"上亮下暗"（原版是一条很轻的竖直渐变）',
    JUMP_PALETTES.every((p) => luminance(p.background.top) > luminance(p.background.bottom)),
  );
  check(
    '渐变不过分（ΔL ≤ 0.25，原版最明显的 mist 实测 0.18）',
    JUMP_PALETTES.every((p) => luminance(p.background.top) - luminance(p.background.bottom) <= 0.25),
  );
  const worst = Math.min(
    ...JUMP_PALETTES.flatMap((p) => {
      const mid = (luminance(p.background.top) + luminance(p.background.bottom)) / 2;
      return p.blocks.map((c) => Math.abs(luminance(c) - mid));
    }),
  );
  check('没有方块糊进背景（|ΔL| ≥ 0.04）', worst >= 0.04, `最小差 ${worst.toFixed(3)}`);

  // "洗白"防线：每局至少 3 个高饱和色（HSL 饱和度 ≥ 0.3）。
  // 这条是"看着不对"翻译成数字的那一步——灰 + 近白 + 低饱和绿 那一局就是这么被抓住的。
  const saturation = (hex: string): number => {
    const channel = (offset: number): number => parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const r = channel(1);
    const g = channel(3);
    const b = channel(5);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 1e-9) return 0;
    const l = (max + min) / 2;
    return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  };
  check(
    '每局至少 3 个高饱和方块色（饱和度 ≥ 0.3）',
    JUMP_PALETTES.every((p) => p.blocks.filter((c) => saturation(c) >= 0.3).length >= 3),
    JUMP_PALETTES.map((p) => `${p.id}:${p.blocks.filter((c) => saturation(c) >= 0.3).length}`).join(' '),
  );
  check(
    '每局最多 1 个无彩/灰色方块（灰块不能成对出现，否则整屏发灰）',
    JUMP_PALETTES.every((p) => p.blocks.filter((c) => saturation(c) < 0.12).length <= 1),
  );

  const ids = new Set(JUMP_PALETTES.map((p) => p.id));
  equal('色板 id 唯一', ids.size, JUMP_PALETTES.length);
  equal('同 seed 同色板（截图对比要可复现）', paletteForSeed(7).id, paletteForSeed(7).id);
  equal('seed 0~5 覆盖 6 组', new Set([0, 1, 2, 3, 4, 5].map((i) => paletteForSeed(i).id)).size, 6);
  const palette = JUMP_PALETTES[0]!;
  equal('方块色按序号轮换', blockColorAt(palette, 0), blockColorAt(palette, palette.blocks.length));
  equal('负下标不越界', blockColorAt(palette, -1), blockColorAt(palette, palette.blocks.length - 1));
  equal('空色板回落到默认色', blockColorAt({ id: 'x', background: { top: '#fff', bottom: '#fff' }, blocks: [] }, 3), BLOCK_COLORS[0]);
}

console.log('\n三面明暗（顶 1.00 / 左 0.775 / 右 0.93，实测值）');
{
  almost('顶面 = 1.00', shadeForNormal(0, 1, 0), 1, 1e-9);
  almost('+X 面（屏幕右）= 0.93', shadeForNormal(1, 0, 0), 0.93, 1e-9);
  almost('+Z 面（屏幕左）= 0.775', shadeForNormal(0, 0, 1), 0.775, 1e-9);
  check(
    '右面比左面亮（交接文档曾经写反，这条钉住方向）',
    shadeForNormal(1, 0, 0) > shadeForNormal(0, 0, 1),
  );
  almost('法线取反不改变亮度（-X 面不会更亮）', shadeForNormal(-1, 0, 0), 0.775, 1e-9);
  almost('底面（永远看不见）不为负', shadeForNormal(0, -1, 0), (0.775 + 0.93) / 2, 1e-9);

  // 圆柱侧面：64 段圆环。判据不是"落在两个色阶之间"，而是**没有台阶**——
  // 把圆柱当成两面色来贴，相邻顶点会跳 0.15；连续渐变时每 5.6° 只差 0.01 量级。
  const ring = Array.from({ length: 64 }, (_, i) => {
    const angle = (i / 64) * Math.PI * 2;
    return shadeForNormal(Math.cos(angle), 0, Math.sin(angle));
  });
  const steps = ring.map((v, i) => Math.abs(v - ring[(i + 1) % ring.length]!));
  check('圆柱侧面没有台阶（相邻 5.6° 差 < 0.02）', Math.max(...steps) < 0.02, `最大 ${Math.max(...steps).toFixed(3)}`);
  // 相机在 +x/+z 一侧，看得见的那半边法线满足 nx + nz > 0
  const visible = ring.filter((_, i) => {
    const angle = (i / 64) * Math.PI * 2;
    return Math.cos(angle) + Math.sin(angle) > 0;
  });
  // 圆柱的可见半边是从 0.74 到 0.96 的**连续延伸**（三个面值是插值的支点，不是天花板）：
  // 正对 +x/−z 那条对角线的一小段最亮，正对 −x/+z 的收进暗部。方块永远只用三个轴法线，
  // 所以仍精确落在 1.00 / 0.775 / 0.93 上。
  check(
    '圆柱可见半边的亮度落在 0.74~0.97（连续外延，不是新色阶）',
    Math.min(...visible) > 0.74 && Math.max(...visible) < 0.97,
    `${Math.min(...visible).toFixed(3)}~${Math.max(...visible).toFixed(3)}`,
  );
  check('任何法线都不会算出负数或过曝', [shadeForNormal(0, -1, 0), shadeForNormal(0, 1, 0), shadeForNormal(0, 0, 0)].every((v) => v > 0.2 && v <= 1));
}

// ------------------------------------------------------------------ 最高分

/** 内存版 Storage（node 里没有 localStorage） */
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
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

// ------------------------------------------------------------------ 跳一跳规则

console.log('\n跳一跳：蓄力 → 距离（线性、夹紧）');
{
  equal('0 秒 → 0 格', distanceForCharge(0), 0);
  check('蓄满 → maxDistance', Math.abs(distanceForCharge(JUMP_CONFIG.maxCharge) - JUMP_CONFIG.maxDistance) < 1e-9);
  check('超过蓄满不超上限', Math.abs(distanceForCharge(99) - JUMP_CONFIG.maxDistance) < 1e-9);
  equal('负数按 0', distanceForCharge(-1), 0);
  equal('NaN 按 0', distanceForCharge(Number.NaN), 0);
  check('单调递增', distanceForCharge(0.3) < distanceForCharge(0.6));
  check(
    '半程正好一半距离',
    Math.abs(distanceForCharge(JUMP_CONFIG.maxCharge / 2) - JUMP_CONFIG.maxDistance / 2) < 1e-9,
  );
}

console.log('\n跳一跳：难度曲线（分数越高越难，但永远可达）');
{
  check('0 分边长为起始值', Math.abs(blockSizeForScore(0) - JUMP_CONFIG.blockSizeStart) < 1e-9);
  check(
    '封顶分边长到最小',
    Math.abs(blockSizeForScore(JUMP_CONFIG.shrinkScore) - JUMP_CONFIG.blockSizeMin) < 1e-9,
  );
  const scores = [0, 10, 20, 30, 40, 50, 60, 80, 100, 120];
  check(
    '边长随分数单调不增',
    scores.every((score, i) => i === 0 || blockSizeForScore(scores[i - 1]!) >= blockSizeForScore(score) - 1e-9),
  );
  check(
    '间距范围永远 from ≤ to',
    scores.every((score) => {
      const range = gapRangeForScore(score);
      return range.from <= range.to + 1e-9;
    }),
  );
  check(
    '间距上限永远可达（≤ maxDistance − margin）',
    [0, 10, 30, 60, 200, 9999].every((score) => gapRangeForScore(score).to <= maxReachableGap() + 1e-9),
  );

  // 这一轮把间距从"边长倍数"改回"绝对格数"：方块变小不该让绝对距离跟着缩水。
  const low = gapCurveForScore(0);
  const high = gapCurveForScore(JUMP_CONFIG.gapGrowScore);
  almost('开局间距下限 = 4.6 格', low.from, 4.6);
  almost('开局间距上限 = 5.4 格', low.to, 5.4);
  almost('封顶间距下限 = 4.8 格', high.from, 4.8);
  almost('封顶间距上限 = 6.0 格', high.to, 6.0);
  check(
    '分数越高中心距绝对变大（from 与 to 都单调不减）',
    scores.every((score, i) => {
      if (i === 0) return true;
      const prev = gapRangeForScore(scores[i - 1]!, blockSizeForScore(scores[i - 1]!));
      const next = gapRangeForScore(score, blockSizeForScore(score));
      return next.from >= prev.from - 1e-9 && next.to >= prev.to - 1e-9;
    }),
  );
  check('封顶时中心距严格大于开局', high.from > low.from && high.to > low.to);

  // 间距下限不是难度参数，是"倾倒动画有没有地方演"的几何约束
  check('间距下限 = 上一块边长 × 2.12 + 0.1', Math.abs(gapFloorFor(2) - (2 * 2.12 + 0.1)) < 1e-9, `${gapFloorFor(2)}`);
  check('上一块越大，间距下限越大', gapFloorFor(2) > gapFloorFor(JUMP_CONFIG.blockSizeMin));
  check('间距下限永远大于一个边长（两块不会贴合）', gapRangeForScore(0).from > blockSizeForScore(0));
  check(
    '随机值被夹在范围内',
    [-1, 0, 0.5, 1, 2].every((rand) => {
      const gap = gapForScore(30, rand);
      const range = gapRangeForScore(30);
      return gap >= range.from - 1e-9 && gap <= range.to + 1e-9;
    }),
  );
  // 用户口径："横屏下间距太小，要激进一点"——开局就得是边长的 2.3~2.7 倍
  const openRatio = { from: low.from / JUMP_CONFIG.blockSizeStart, to: low.to / JUMP_CONFIG.blockSizeStart };
  check(
    '开局间距是边长的 2.3~2.7 倍（旧版 1.15~1.9）',
    openRatio.from >= 2.3 - 1e-9 && openRatio.to <= 2.7 + 1e-9,
    `${openRatio.from.toFixed(2)}~${openRatio.to.toFixed(2)}`,
  );
}

console.log('\n跳一跳：生成器（三方向、确定性、可达）');
{
  const run = createRun(12345);
  equal('开局有当前 + 下一个两个方块', run.blocks.length, 2);
  equal('开局站在 0 号', run.index, 0);
  equal('开局 0 分', run.score, 0);

  const seq = (seed: number): string =>
    createRun(seed)
      .blocks.map(
        (block) => `${block.x.toFixed(6)},${block.z.toFixed(6)},${block.kind},${block.size.toFixed(6)},${block.shape}`,
      )
      .join('|');
  check('同 seed 生成同一条序列', seq(777) === seq(777));
  check('不同 seed 生成不同序列', seq(777) !== seq(778));

  let current: JumpBlock = createRun(1).blocks[0]!;
  let seed = 999;
  let score = 0;
  const angles = new Set<number>();
  let allDirections = true;
  let allReachable = true;
  let idsMonotonic = true;
  for (let i = 0; i < 200; i++) {
    const { block, seed: nextSeed } = nextBlock(current, score, seed);
    const deg = Math.round((Math.atan2(-(block.x - current.x), -(block.z - current.z)) * 180) / Math.PI);
    angles.add(deg);
    // 原版只有等距两向：世界 −Z（屏幕右上）与 −X（屏幕左上）
    if (!(deg === 0 || deg === 90)) allDirections = false;
    if (block.id !== current.id + 1) idsMonotonic = false;

    const gap = Math.hypot(block.x - current.x, block.z - current.z);
    const range = gapRangeForScore(score, current.size);
    if (gap > maxReachableGap() + 1e-6 || gap < range.from - 1e-6 || gap > range.to + 1e-6) allReachable = false;

    current = block;
    seed = nextSeed;
    score = Math.min(200, score + 1);
  }
  check('200 次生成只出现 0°/90° 两个方向（等距两向）', allDirections);
  check('两个方向都会出现', angles.size === 2);
  check('步进只沿一条世界轴（没有斜角）', (() => {
    let current2 = createRun(3).blocks[0]!;
    let seed2 = 4242;
    for (let i = 0; i < 200; i++) {
      const { block, seed: nextSeed } = nextBlock(current2, i, seed2);
      const dx = Math.abs(block.x - current2.x);
      const dz = Math.abs(block.z - current2.z);
      if (Math.min(dx, dz) > 1e-9) return false;
      current2 = block;
      seed2 = nextSeed;
    }
    return true;
  })());
  check('间距始终落在该分数的范围内且可达', allReachable);
  check('方块 id 单调递增', idsMonotonic);
}

console.log('\n跳一跳：底座形状（方形 / 内切圆）与尺寸抖动');
{
  check('10 分前一律方形', [0, 5, 9].every((score) => shapeFor(score, 0) === 'square'));
  check(
    '10 分后按 35% 概率出圆形',
    shapeFor(10, 0) === 'round' && shapeFor(10, JUMP_CONFIG.roundChance - 1e-6) === 'round' && shapeFor(10, JUMP_CONFIG.roundChance) === 'square',
  );
  check('圆形概率是 35%', Math.abs(JUMP_CONFIG.roundChance - 0.35) < 1e-9);

  // 内切圆：半径 = 边长 / 2。有效面积必须正好是方形的 π/4（≈ 78.5%），
  // 「圆更难」不是感觉，是这 21.5% 的差。用 40000 点网格采样估算。
  const square: JumpBlock = { id: 0, x: 0, z: 0, size: 2, kind: 'normal', shape: 'square' };
  const round: JumpBlock = { id: 1, x: 0, z: 0, size: 2, kind: 'normal', shape: 'round' };
  const half = square.size / 2;
  const steps = 200;
  let insideRound = 0;
  for (let ix = 0; ix < steps; ix++) {
    for (let iz = 0; iz < steps; iz++) {
      const x = -half + ((ix + 0.5) / steps) * square.size;
      const z = -half + ((iz + 0.5) / steps) * square.size;
      if (blockOverhang(round, x, z) <= 0) insideRound += 1;
    }
  }
  const roundAreaRatio = insideRound / (steps * steps);
  check(
    '圆形有效面积 = 方形的 π/4（78.5%）',
    Math.abs(roundAreaRatio - Math.PI / 4) < 0.01,
    `${(roundAreaRatio * 100).toFixed(1)}%`,
  );
  check('正中心两种形状都站得住', blockOverhang(square, 0, 0) <= 0 && blockOverhang(round, 0, 0) <= 0);
  check('轴向边界两者一致（半径都是半边）', Math.abs(blockOverhang(round, half, 0)) < 1e-9 && Math.abs(blockOverhang(square, half, 0)) < 1e-9);
  check('方形四角站得住', blockOverhang(square, half - 0.01, half - 0.01) <= 0);
  check('圆形四角是空的（内切圆外）', blockOverhang(round, half - 0.01, half - 0.01) > 0);

  // 判定必须真的按形状分支：同一个落点，方形站得住、圆形掉下去。
  // （斜向落点只在"上一跳没跳正 + 这跳转向"时出现，所以拿 from 偏一格来构造）
  const offAxis: JumpBlock = { id: 9, x: 2, z: 0, size: 2, kind: 'normal', shape: 'square' };
  const targetAt = (shape: JumpBlock['shape']): JumpBlock => ({ id: 10, x: 0, z: -2, size: 2, kind: 'normal', shape });
  const diag = Math.hypot(2, 2);
  const landDistance = diag - 0.75 * Math.SQRT2; // 落点偏移 (0.75, 0.75)：方形内、圆形外
  const squareLanding = resolveLanding(offAxis, targetAt('square'), landDistance);
  const roundLanding = resolveLanding(offAxis, targetAt('round'), landDistance);
  check('同一落点：方形站得住、圆形站不住', squareLanding.kind === 'hit' && roundLanding.kind !== 'hit', `${squareLanding.kind}/${roundLanding.kind}`);

  // 尺寸抖动：确定性、±6%、只影响观感
  almost('抖动下限 = 边长 × 0.94', jitteredSize(2, 0), 2 * 0.94);
  almost('抖动上限 = 边长 × 1.06', jitteredSize(2, 1), 2 * 1.06);
  almost('中值不抖', jitteredSize(2, 0.5), 2);
  check('抖动幅度是 6%', Math.abs(JUMP_CONFIG.sizeJitter - 0.06) < 1e-9);
  check(
    '同 seed 抖动与形状完全一致（可重放）',
    (() => {
      const a = createRun(4242);
      const b = createRun(4242);
      return a.blocks.every((block, i) => block.size === b.blocks[i]?.size && block.shape === b.blocks[i]?.shape);
    })(),
  );
  check(
    '生成器产出的边长都在 ±6% 内',
    (() => {
      let current = createRun(7).blocks[0]!;
      let seed = 31;
      for (let i = 0; i < 200; i++) {
        const generated = nextBlock(current, i * 2, seed);
        const base = blockSizeForScore(i * 2);
        if (Math.abs(generated.block.size / base - 1) > JUMP_CONFIG.sizeJitter + 1e-9) return false;
        current = generated.block;
        seed = generated.seed;
      }
      return true;
    })(),
  );
  check(
    '特殊方块永远是方形（顶面是直角图集贴图）',
    (() => {
      let current = createRun(11).blocks[0]!;
      let seed = 505;
      for (let i = 0; i < 300; i++) {
        const generated = nextBlock(current, 60, seed);
        if (generated.block.kind !== 'normal' && generated.block.shape !== 'square') return false;
        current = generated.block;
        seed = generated.seed;
      }
      return true;
    })(),
  );
  check(
    '10 分前生成器不产圆形、之后会产圆形',
    (() => {
      let current = createRun(13).blocks[0]!;
      let seed = 77;
      let early = true;
      let lateRound = false;
      for (let i = 0; i < 300; i++) {
        const score = i < 100 ? 0 : 60;
        const generated = nextBlock(current, score, seed);
        if (score === 0 && generated.block.shape !== 'square') early = false;
        if (score === 60 && generated.block.shape === 'round') lateRound = true;
        current = generated.block;
        seed = generated.seed;
      }
      return early && lateRound;
    })(),
  );
}

console.log('\n跳一跳：特殊方块');
{
  check('10 分前不出特殊方块', [0, 5, 9].every((score) => specialKindFor(score, 0, 'normal') === 'normal'));
  check('概率未命中时是普通方块', specialKindFor(50, JUMP_CONFIG.specialChance + 0.01, 'normal') === 'normal');
  check(
    '四类特殊方块都会出现',
    new Set([0.01, 0.06, 0.1, 0.115].map((rand) => specialKindFor(50, rand, 'normal'))).size === 4,
    [0.01, 0.06, 0.1, 0.115].map((rand) => specialKindFor(50, rand, 'normal')).join(','),
  );
  check(
    '上一个已经是特殊方块时不连续出',
    ['well', 'cube', 'store', 'music'].every((kind) => specialKindFor(50, 0, kind as JumpBlock['kind']) === 'normal'),
  );
  equal('井盖 +5', specialBonus('well'), 5);
  equal('魔方 +10', specialBonus('cube'), 10);
  equal('便利店 +15', specialBonus('store'), 15);
  equal('音乐盒 +30', specialBonus('music'), 30);
  equal('普通方块不加分', specialBonus('normal'), 0);
  equal('奖励分数严格递增（稀有度与分值一致）', [5, 10, 15, 30].every((v, i, arr) => i === 0 || v > arr[i - 1]!), true);
  almost('停留 3 秒才加分（原版口径）', JUMP_CONFIG.specialHoldSeconds, 3, 1e-9);
}

console.log('\n跳一跳：落点判定与计分');
{
  const from: JumpBlock = { id: 0, x: 0, z: 0, size: 1.8, kind: 'normal', shape: 'square' };
  const to: JumpBlock = { id: 1, x: 0, z: -2, size: 1.8, kind: 'normal', shape: 'square' };
  const half = to.size / 2;

  const perfect = resolveLanding(from, to, 2);
  check('正中心 → hit + center', perfect.kind === 'hit' && perfect.center);
  const edge = resolveLanding(from, to, 2 + half * 0.5);
  check('偏半格 → hit 但非中心', edge.kind === 'hit' && !edge.center);
  equal('偏过头（> 半边长）→ miss', resolveLanding(from, to, 2 + half * 1.2).kind, 'miss');
  equal('跳不够（差 > 半边长）→ miss', resolveLanding(from, to, 2 - half * 1.2).kind, 'miss');
  equal('0 距离 → miss', resolveLanding(from, to, 0).kind, 'miss');
  equal('刚好压边（= 半边长）→ hit', resolveLanding(from, to, 2 + half).kind, 'hit');

  equal('非中心 +1 且断连击', JSON.stringify(scoreForLanding(5, false)), JSON.stringify({ points: 1, combo: 0 }));
  equal('第 1 次中心 +2', JSON.stringify(scoreForLanding(0, true)), JSON.stringify({ points: 2, combo: 1 }));
  equal('第 2 次中心 +4', JSON.stringify(scoreForLanding(1, true)), JSON.stringify({ points: 4, combo: 2 }));
  equal('第 3 次中心 +6', JSON.stringify(scoreForLanding(2, true)), JSON.stringify({ points: 6, combo: 3 }));
  equal('封顶 +32', scoreForLanding(40, true).points, JUMP_CONFIG.comboMax);
  equal('封顶后 combo 仍继续累加（只是分数不涨）', scoreForLanding(40, true).combo, 41);
}

console.log('\n跳一跳：一局推进（成功后自动生成下一个）');
{
  const run = createRun(20261022);
  const from = currentBlock(run);
  const to = targetBlock(run);
  const exact = Math.hypot(to.x - from.x, to.z - from.z);

  const outcome = jump(run, exact);
  check('正中心跳 → 不结束', !outcome.over);
  equal('分数 +2', outcome.run.score, 2);
  equal('索引 +1', outcome.run.index, 1);
  equal('连击 1', outcome.run.combo, 1);
  equal('方块数 +1（保证总有下一个）', outcome.run.blocks.length, run.blocks.length + 1);

  const fell = jump(run, 0);
  check('跳空 → 本局结束', fell.over && fell.run.status === 'over');
  equal('失败不加分', fell.run.score, 0);
  check('结束后再跳仍是 over（可重入）', jump(fell.run, exact).over);
}

console.log('\n最高分：纯函数');
{
  equal('初始 0 分', bestScore(EMPTY_PROGRESS, 'jump'), 0);

  const first = recordScore(EMPTY_PROGRESS, 'jump', 12);
  equal('记一局 12 分', bestScore(first, 'jump'), 12);
  equal('更低的分数不覆盖', bestScore(recordScore(first, 'jump', 5), 'jump'), 12);
  equal('更高的分数覆盖', bestScore(recordScore(first, 'jump', 30), 'jump'), 30);
  equal('0 分（开局就掉）不覆盖', bestScore(recordScore(first, 'jump', 0), 'jump'), 12);
  equal('NaN 不覆盖', bestScore(recordScore(first, 'jump', Number.NaN), 'jump'), 12);
  equal('小数取整', bestScore(recordScore(EMPTY_PROGRESS, 'jump', 9.8), 'jump'), 9);
  equal('不同游戏互不影响', bestScore(first, 'other'), 0);
  check('原对象不被改写（纯函数）', bestScore(EMPTY_PROGRESS, 'jump') === 0);
}

console.log('\n最高分：存储容错');
{
  const storage = new MemoryStorage();
  const asStorage = storage as unknown as Storage;
  equal('空存储读到 0 分', bestScore(loadProgress(asStorage), 'jump'), 0);

  saveProgress(recordScore(EMPTY_PROGRESS, 'jump', 55), asStorage);
  equal('存了能读回来', bestScore(loadProgress(asStorage), 'jump'), 55);

  storage.setItem(MINIGAME_PROGRESS_KEY, '{not json');
  equal('坏 JSON 当空进度', bestScore(loadProgress(asStorage), 'jump'), 0);

  storage.setItem(MINIGAME_PROGRESS_KEY, JSON.stringify({ version: 1, best: { jump: 9 } }));
  equal('旧版本 v1（关卡进度）当空', bestScore(loadProgress(asStorage), 'jump'), 0);

  storage.setItem(
    MINIGAME_PROGRESS_KEY,
    JSON.stringify({
      version: 2,
      best: { jump: 7, 'bad key': 3, other: 'x', neg: -1, frac: 7.9 },
    }),
  );
  const filtered = loadProgress(asStorage);
  equal('正常键读得回来', bestScore(filtered, 'jump'), 7);
  equal('负数被丢掉', bestScore(filtered, 'neg'), 0);
  equal('字符串值被丢掉', bestScore(filtered, 'other'), 0);
  equal('小数取整', bestScore(filtered, 'frac'), 7);
  equal('坏键被丢掉（只留 2 个合法键）', Object.keys(filtered.best).length, 2);
}

console.log('\n小游戏目录');
{
  equal('目录里只有 1 个游戏', MINIGAME_CATALOG.length, 1);
  equal('就是跳一跳', MINIGAME_CATALOG[0]?.id, 'jump');
  check('标题与说明键都是 minigame.*', MINIGAME_CATALOG.every(
    (entry) => entry.titleKey.startsWith('minigame.') && entry.descKey.startsWith('minigame.'),
  ));
  const retired = ['sokoban', 'breakout'];
  check('旧游戏已从目录移除', !MINIGAME_CATALOG.some((entry) => retired.includes(entry.id as string)));
  equal('按 id 找得到跳一跳', miniGameEntry('jump')?.id, 'jump');
  equal('找不到返回 null', miniGameEntry('nope'), null);
}

console.log('\n小游戏选择页（一层）');
{
  check('有 onStart(action) 且不带关卡参数', menuSrc.includes('readonly onStart: (gameId: MiniGameId) => void;'));
  check('卡片点击直接开局', menuSrc.includes('this.actions.onStart(entry.id)'));
  check('没有关卡网格', !menuSrc.includes('levelGrid') && !menuSrc.includes('levelCount'));
  check('back 直接关面板', menuSrc.includes('this.actions.onClose()'));
  check('显示最高分', menuSrc.includes("tp('minigame.menu.best'"));
}

console.log('\n主菜单入口（静态断言）');
{
  const worldSrc = readFileSync(new URL('../src/ui/WorldScreen.ts', import.meta.url), 'utf8');
  check('主菜单有小游戏 action', worldSrc.includes('onMiniGames?: () => void;'));
  check('入口按钮是 secondary', worldSrc.includes("miniGames.className = 'world-secondary';"));
  check('入口按钮有稳定 id', worldSrc.includes("miniGames.id = 'world-minigames-button';"));
  check(
    '第一颗 primary 仍是"开始游戏"（浏览器验收脚本依赖）',
    worldSrc.indexOf("play.className = 'world-primary'") >= 0 &&
      worldSrc.indexOf("play.className = 'world-primary'") < worldSrc.indexOf("miniGames.className = 'world-secondary'"),
  );
  check('主程序把入口接到选择页', mainSrc.includes('onMiniGames: openMiniGames'));
  check('主菜单跑小游戏会先铺图集', mainSrc.includes('atlas.ensureUploaded()'));
  check('返回键先退小游戏', mainSrc.includes('activeMenuMiniGame.stop()'));
  check('退出时释放 renderer', mainSrc.includes('renderer.dispose()'));
  check('主菜单按 gameId 进跳一跳', mainSrc.includes('new JumpGame()'));
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
