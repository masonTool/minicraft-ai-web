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
import { Block } from '../src/core/registry/blocks.ts';
import { buildBlockGroups, groupInstanceCount } from '../src/minigame/blockGroups.ts';
import { MINIGAME_CATALOG, miniGameEntry } from '../src/minigame/catalog.ts';
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
  blockSizeForScore,
  createRun,
  currentBlock,
  distanceForCharge,
  gapForScore,
  gapRangeForScore,
  jump,
  maxReachableGap,
  nextBlock,
  resolveLanding,
  scoreForLanding,
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

const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hostSrc = readFileSync(new URL('../src/minigame/MiniGameHost.ts', import.meta.url), 'utf8');
const smokeSrc = readFileSync(new URL('../src/minigame/games/smoke.ts', import.meta.url), 'utf8');
const jumpSrc = readFileSync(new URL('../src/minigame/games/jump/scene.ts', import.meta.url), 'utf8');
const menuSrc = readFileSync(new URL('../src/ui/MiniGameMenu.ts', import.meta.url), 'utf8');

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

console.log('\n跳一跳：占位场景（J0）');
{
  check('id 是 jump', jumpSrc.includes("readonly id = 'jump'"));
  check('用 BlockScene 画方块', jumpSrc.includes('new BlockScene('));
  check('用 PlayerRenderer 画小人', jumpSrc.includes('new PlayerRenderer('));
  check('卸载时释放人物', jumpSrc.includes('this.player?.dispose()'));
  check('卸载时释放场景', jumpSrc.includes('this.blocks?.dispose()'));
  check('卸载时移除 HUD', jumpSrc.includes('this.hud?.remove()'));
  check('每帧自己渲染', jumpSrc.includes('blocks.render(context.renderer)'));
  check('占位阶段不写分数（J2 才接）', !jumpSrc.includes('recordScore'));
}

// ------------------------------------------------------------------ 方块分组

console.log('\n方块分组（InstancedMesh 的组数 = draw call 数）');
{
  const blocks = [
    { x: 0, y: 0, z: 0, blockId: Block.STONE },
    { x: 1, y: 0, z: 0, blockId: Block.STONE },
    { x: 2, y: 0, z: 0, blockId: Block.OAK_PLANKS },
    { x: 3, y: 0, z: 0, blockId: Block.GOLD_BLOCK },
  ];
  const result = buildBlockGroups(blocks);
  equal('3 种方块 → 3 组', result.groups.length, 3);
  equal('没有跳过', result.skipped, 0);
  equal('实例总数', groupInstanceCount(result), 4);
  equal(
    '组顺序按首次出现',
    result.groups.map((group) => group.tile).join(','),
    'stone,oak_planks,gold_block',
  );
  check('每组都有有效的 tileIndex', result.groups.every((group) => group.tileIndex >= 0));
  equal('石头组里有 2 格', result.groups.find((group) => group.tile === 'stone')?.positions.length, 2);

  const withAir = buildBlockGroups([{ x: 0, y: 0, z: 0, blockId: Block.AIR }]);
  equal('空气没有图集贴图：跳过', withAir.skipped, 1);
  equal('空气不产生组', withAir.groups.length, 0);
}

console.log('\n5000 方块的分组耗时（单帧预算）');
{
  const ids = [Block.STONE, Block.OAK_PLANKS, Block.GOLD_BLOCK, Block.GLASS];
  const blocks = [];
  for (let i = 0; i < 5000; i++) {
    blocks.push({
      x: i % 32,
      y: Math.floor(i / 1024) % 8,
      z: Math.floor(i / 32) % 32,
      blockId: ids[i % ids.length]!,
    });
  }
  const started = performance.now();
  const result = buildBlockGroups(blocks);
  const elapsed = performance.now() - started;
  equal('5000 格全部被分组', groupInstanceCount(result), 5000);
  equal('只有 4 组（4 个 draw call）', result.groups.length, 4);
  check('分组耗时 < 100ms', elapsed < 100, `${elapsed.toFixed(1)}ms`);
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
  const scores = [0, 10, 20, 30, 40, 50, 60, 120];
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
  const low = gapRangeForScore(0);
  const high = gapRangeForScore(JUMP_CONFIG.growScore);
  check('间距随分数单调不减', high.from >= low.from - 1e-9 && high.to >= low.to - 1e-9);
  check(
    '随机值被夹在范围内',
    [-1, 0, 0.5, 1, 2].every((rand) => {
      const gap = gapForScore(30, rand);
      const range = gapRangeForScore(30);
      return gap >= range.from - 1e-9 && gap <= range.to + 1e-9;
    }),
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
      .blocks.map((block) => `${block.x.toFixed(6)},${block.z.toFixed(6)},${block.kind}`)
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
    if (!(deg === -30 || deg === 0 || deg === 30)) allDirections = false;
    if (block.id !== current.id + 1) idsMonotonic = false;

    const gap = Math.hypot(block.x - current.x, block.z - current.z);
    const range = gapRangeForScore(score);
    if (gap > maxReachableGap() + 1e-6 || gap < range.from - 1e-6 || gap > range.to + 1e-6) allReachable = false;

    current = block;
    seed = nextSeed;
    score = Math.min(200, score + 1);
  }
  check('200 次生成只出现 −30/0/+30 三个方向', allDirections);
  check('三个方向都会出现', angles.size === 3);
  check('间距始终落在该分数的范围内且可达', allReachable);
  check('方块 id 单调递增', idsMonotonic);
}

console.log('\n跳一跳：特殊方块');
{
  check('10 分前不出特殊方块', [0, 5, 9].every((score) => specialKindFor(score, 0, 'normal') === 'normal'));
  check('概率命中时出音乐盒或魔方', ['music', 'cube'].includes(specialKindFor(50, 0, 'normal')));
  check('上一个已经是特殊方块时不连续出', specialKindFor(50, 0, 'music') === 'normal');
  check('概率未命中时是普通方块', specialKindFor(50, JUMP_CONFIG.specialChance + 0.01, 'normal') === 'normal');
}

console.log('\n跳一跳：落点判定与计分');
{
  const from: JumpBlock = { id: 0, x: 0, z: 0, size: 1.8, kind: 'normal' };
  const to: JumpBlock = { id: 1, x: 0, z: -2, size: 1.8, kind: 'normal' };
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
  check('旧游戏已从目录移除', !MINIGAME_CATALOG.some((entry) => entry.id === 'sokoban' || entry.id === 'breakout'));
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
