/**
 * 单机小游戏的离线测试（小游戏1）
 *
 * 运行：npm run test:minigame
 *
 * 小游戏的宿主与小游戏本身都依赖 DOM / WebGL，离线只能做**静态断言**：
 * 接线在不在、异常兜底在不在、退出有没有清舞台、dt 有没有夹住。
 * 真正的"进入→退出→无残留"在浏览器里用 `__mc.minigameStateForTest` 验
 * （`geometries` / `textures` 前后对比）。
 *
 * 后续推箱子 / 打砖块的**规则**是纯逻辑，会作为同一套件里的独立小节加进来。
 */

import { readFileSync } from 'node:fs';
import { Block } from '../src/core/registry/blocks.ts';
import { buildBlockGroups, groupInstanceCount } from '../src/minigame/blockGroups.ts';
import { levelBlocks, parseLevel } from '../src/minigame/level.ts';
import { MINIGAME_CATALOG, miniGameEntry } from '../src/minigame/catalog.ts';
import {
  createSokobanState,
  isSokobanDeadlocked,
  isSokobanWon,
  moveSokoban,
  undoSokoban,
  type SokobanDirection,
  type SokobanState,
} from '../src/minigame/games/sokoban/logic.ts';
import { SOKOBAN_LEVELS, sokobanLevel } from '../src/minigame/games/sokoban/levels.ts';
import {
  EMPTY_PROGRESS,
  MINIGAME_PROGRESS_KEY,
  bestSteps,
  clearedCount,
  isCleared,
  loadProgress,
  recordClear,
  saveProgress,
} from '../src/minigame/progress.ts';

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

// ------------------------------------------------------------------ 关卡格式

console.log('\n关卡格式：合法关卡');
{
  const raw = {
    id: 'test-1',
    width: 4,
    height: 2,
    depth: 3,
    stepLimit: 50,
    rows: [
      ['####', '#P.#', '#G.#'],
      ['    ', '    ', '    '],
    ],
  };
  const result = parseLevel(raw);
  check('解析成功', result.ok, result.ok ? '' : result.errors.join('; '));
  if (result.ok) {
    equal('格子数 = 4×2×3', result.level.cells.length, 24);
    equal('起点坐标', `${result.level.start.x},${result.level.start.y},${result.level.start.z}`, '1,0,1');
    equal('目标 1 个', result.level.goals.length, 1);
    equal('目标坐标', `${result.level.goals[0]!.x},${result.level.goals[0]!.y},${result.level.goals[0]!.z}`, '1,0,2');
    equal('步数上限', result.level.stepLimit, 50);
    equal('墙是石头', result.level.cells.find((cell) => cell.x === 0 && cell.y === 0 && cell.z === 0)?.blockId, Block.STONE);
    equal('目标是金块', result.level.cells.find((cell) => cell.kind === 'goal')?.blockId, Block.GOLD_BLOCK);
    equal('空格不渲染', result.level.cells.find((cell) => cell.kind === 'empty')?.blockId, null);
    equal('要渲染的方块数（上层 12 格全空）', levelBlocks(result.level).length, 12);
    equal('步数上限为 0 时保持 0（不限）', parseLevel({ ...raw, stepLimit: 0 }).ok, true);
  }
}

console.log('\n关卡格式：非法输入逐条报错');
{
  const base = { id: 'x', width: 3, height: 1, depth: 1, stepLimit: 10, rows: [['P.G']] as string[][] };

  const expectError = (label: string, raw: typeof base, fragment: string): void => {
    const result = parseLevel(raw);
    check(
      label,
      !result.ok && result.errors.some((error) => error.includes(fragment)),
      result.ok ? '解析居然成功了' : result.errors.join('; '),
    );
  };

  check('基准关卡是合法的', parseLevel(base).ok);
  expectError('层数不符', { ...base, height: 2 }, '应有 2 层');
  expectError('行数不符', { ...base, depth: 2 }, '应有 2 行');
  expectError('行长度不符', { ...base, rows: [['P.']] }, '应有 3 个字符');
  expectError('未知字符', { ...base, rows: [['PXG']] }, '未知字符');
  expectError('没有起点', { ...base, rows: [['..G']] }, '起点');
  expectError('两个起点', { ...base, rows: [['PPG']] }, '起点');
  expectError('没有目标', { ...base, rows: [['P..']] }, '目标');
  expectError('宽度为 0', { ...base, width: 0 }, '宽度非法');
  expectError('层数为负', { ...base, height: -1 }, '层数非法');
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

// ------------------------------------------------------------------ 进度与目录

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

console.log('\n通关进度：纯函数');
{
  let progress = EMPTY_PROGRESS;
  equal('初始没通关', isCleared(progress, 'sokoban', 0), false);
  equal('初始最佳步数为 null', bestSteps(progress, 'sokoban', 0), null);

  progress = recordClear(progress, 'sokoban', 0, 42);
  equal('记一次通关', isCleared(progress, 'sokoban', 0), true);
  equal('最佳步数 42', bestSteps(progress, 'sokoban', 0), 42);

  equal('步数更多不覆盖', bestSteps(recordClear(progress, 'sokoban', 0, 99), 'sokoban', 0), 42);
  equal('步数更少会覆盖', bestSteps(recordClear(progress, 'sokoban', 0, 30), 'sokoban', 0), 30);
  equal('NaN 步数按 1 记', bestSteps(recordClear(EMPTY_PROGRESS, 'sokoban', 1, Number.NaN), 'sokoban', 1), 1);
  equal('0 步按 1 记', bestSteps(recordClear(EMPTY_PROGRESS, 'sokoban', 1, 0), 'sokoban', 1), 1);
  equal('不同游戏的同号关卡互不影响', isCleared(progress, 'breakout', 0), false);

  const counted = recordClear(recordClear(EMPTY_PROGRESS, 'sokoban', 0, 10), 'sokoban', 2, 20);
  equal('已通关计数', clearedCount(counted, 'sokoban', 10), 2);
}

console.log('\n通关进度：存储容错');
{
  const storage = new MemoryStorage();
  const asStorage = storage as unknown as Storage;
  equal('空存储读到空进度', Object.keys(loadProgress(asStorage).cleared).length, 0);

  saveProgress(recordClear(EMPTY_PROGRESS, 'sokoban', 3, 55), asStorage);
  equal('存了能读回来', bestSteps(loadProgress(asStorage), 'sokoban', 3), 55);

  storage.setItem(MINIGAME_PROGRESS_KEY, '{not json');
  equal('坏 JSON 当空进度', Object.keys(loadProgress(asStorage).cleared).length, 0);

  storage.setItem(MINIGAME_PROGRESS_KEY, JSON.stringify({ version: 2, cleared: {} }));
  equal('版本不对当空进度', Object.keys(loadProgress(asStorage).cleared).length, 0);

  storage.setItem(
    MINIGAME_PROGRESS_KEY,
    JSON.stringify({
      version: 1,
      cleared: { 'sokoban:1': 12, 'bad key': 3, 'sokoban:2': 'x', 'sokoban:3': -1, 'sokoban:4': 7.9 },
    }),
  );
  const filtered = loadProgress(asStorage);
  equal('正常键读得回来', bestSteps(filtered, 'sokoban', 1), 12);
  equal('字符串值被丢掉', isCleared(filtered, 'sokoban', 2), false);
  equal('负值被丢掉', isCleared(filtered, 'sokoban', 3), false);
  equal('小数取整', bestSteps(filtered, 'sokoban', 4), 7);
  equal('坏键被丢掉（不计入总数）', Object.keys(filtered.cleared).length, 2);
}

console.log('\n小游戏目录');
{
  equal('目录里有 2 个游戏', MINIGAME_CATALOG.length, 2);
  equal('id 唯一', new Set(MINIGAME_CATALOG.map((entry) => entry.id)).size, MINIGAME_CATALOG.length);
  check('每个都是 10 关', MINIGAME_CATALOG.every((entry) => entry.levelCount === 10));
  check(
    '每个都有标题与说明键',
    MINIGAME_CATALOG.every(
      (entry) => entry.titleKey.startsWith('minigame.') && entry.descKey.startsWith('minigame.'),
    ),
  );
  equal('按 id 找得到推箱子', miniGameEntry('sokoban')?.id, 'sokoban');
  equal('找不到返回 null', miniGameEntry('nope'), null);
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
  check('选择页返回逐级', mainSrc.includes('miniGameMenu.back()'));
  check('退出时释放 renderer', mainSrc.includes('renderer.dispose()'));
}

// ------------------------------------------------------------------ 推箱子

console.log('\n推箱子：推动、胜利与步数');
{
  const parsed = parseLevel(sokobanLevel(0));
  check('第 1 关解析成功', parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  if (!parsed.ok) {
    // 后面的断言都依赖它
  } else {
    const initial = createSokobanState(parsed.level);
    equal('初始步数 0', initial.steps, 0);
    equal('初始推动次数 0', initial.pushes, 0);
    equal('初始不胜利', isSokobanWon(initial), false);

    const up = moveSokoban(initial, 'up');
    check('向上推一步成功', up.ok);
    if (up.ok) {
      equal('推了箱子', up.pushed, true);
      equal('立刻胜利（教学关）', up.won, true);
      equal('步数 1', up.state.steps, 1);
      equal('推动次数 1', up.state.pushes, 1);
    }

    // 撞墙：玩家初始在 (3,4)，往下走两格到 (3,6) 是边界墙
    const down1 = moveSokoban(initial, 'down');
    check('往下走一格成功', down1.ok);
    if (down1.ok) {
      const down2 = moveSokoban(down1.state, 'down');
      equal('撞墙整步不生效', down2.ok, false);
      if (!down2.ok) equal('原因 wall', down2.reason, 'wall');
    }
  }
}

console.log('\n推箱子：推不动（两箱挡住）');
{
  const packed = parseLevel({
    id: 'packed',
    width: 5,
    height: 1,
    depth: 3,
    stepLimit: 50,
    rows: [['#####', '#PBB#', '#..G#']],
  });
  check('两箱关卡解析成功', packed.ok, packed.ok ? '' : packed.errors.join('; '));
  if (packed.ok) {
    const state = createSokobanState(packed.level);
    const blocked = moveSokoban(state, 'right');
    equal('箱子后面还有一个箱子：推不动', blocked.ok, false);
    if (!blocked.ok) equal('原因 blocked', blocked.reason, 'blocked');
    equal('推动失败不改变状态', state.pushes, 0);
  }
}

console.log('\n推箱子：撤销');
{
  const parsed = parseLevel(sokobanLevel(0));
  if (parsed.ok) {
    const initial = createSokobanState(parsed.level);
    equal('初始状态撤销返回 null', undoSokoban(initial), null);

    const step = moveSokoban(initial, 'up');
    if (step.ok) {
      const back = undoSokoban(step.state);
      equal('撤销回到原位', `${back?.playerX},${back?.playerZ}`, `${initial.playerX},${initial.playerZ}`);
      equal(
        '撤销后箱子回到原位',
        [...(back?.boxes ?? [])].sort().join(';'),
        [...initial.boxes].sort().join(';'),
      );
      equal('撤销后步数归零', back?.steps, 0);
      equal('撤销后推动次数归零', back?.pushes, 0);

      const again = back ? undoSokoban(back) : null;
      equal('再撤一步就没有了', again, null);
    }
  }
}

console.log('\n推箱子：胜利判定（不在目标不判胜）');
{
  const parsed = parseLevel(sokobanLevel(0));
  if (parsed.ok) {
    const initial = createSokobanState(parsed.level);
    const onGoal: SokobanState = { ...initial, boxes: new Set(['3,2']) };
    const notYet: SokobanState = { ...initial, boxes: new Set(['3,3']) };
    equal('箱子在目标上判胜', isSokobanWon(onGoal), true);
    equal('箱子不在目标不判胜', isSokobanWon(notYet), false);
  }
}

console.log('\n推箱子：死锁识别');
{
  const parsed = parseLevel(sokobanLevel(0));
  if (parsed.ok) {
    const initial = createSokobanState(parsed.level);
    equal('角落里的箱子算死锁', isSokobanDeadlocked({ ...initial, boxes: new Set(['1,1']) }), true);
    equal('目标上的箱子不算死锁', isSokobanDeadlocked({ ...initial, boxes: new Set(['3,2']) }), false);
    equal('开阔地不算死锁', isSokobanDeadlocked({ ...initial, boxes: new Set(['2,2']) }), false);
  }
}

console.log('\n推箱子：步数上限');
{
  const tight = parseLevel({ ...sokobanLevel(0), stepLimit: 1 });
  if (tight.ok) {
    const state = createSokobanState(tight.level);
    const first = moveSokoban(state, 'left');
    check('第 1 步没超上限', first.ok && !first.limitReached);
    if (first.ok) {
      const second = moveSokoban(first.state, 'left');
      check('第 2 步超过上限', second.ok && second.limitReached);
    }
  }
}

console.log('\n推箱子：10 关全部可解（BFS）');
{
  const encode = (state: SokobanState): string =>
    `${state.playerX},${state.playerZ}|${[...state.boxes].sort().join(';')}`;

  /** 宽度优先找一条解（只用于测试；状态空间很小） */
  const solve = (start: SokobanState, maxStates = 200_000): SokobanDirection[] | null => {
    const seen = new Set([encode(start)]);
    const queue: Array<{ state: SokobanState; path: SokobanDirection[] }> = [{ state: start, path: [] }];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++]!;
      if (isSokobanWon(current.state)) return current.path;
      if (current.path.length >= 150) continue;
      for (const direction of ['up', 'down', 'left', 'right'] as const) {
        const result = moveSokoban(current.state, direction);
        if (!result.ok) continue;
        const key = encode(result.state);
        if (seen.has(key)) continue;
        seen.add(key);
        if (seen.size > maxStates) return null;
        queue.push({ state: result.state, path: [...current.path, direction] });
      }
    }
    return null;
  };

  for (let index = 0; index < SOKOBAN_LEVELS.length; index++) {
    const parsed = parseLevel(SOKOBAN_LEVELS[index]!);
    if (!parsed.ok) {
      check(`第 ${index + 1} 关解析`, false, parsed.errors.join('; '));
      continue;
    }
    const solution = solve(createSokobanState(parsed.level));
    check(`第 ${index + 1} 关可解`, solution !== null, solution ? `${solution.length} 步` : '不可解');
    if (solution) {
      check(
        `第 ${index + 1} 关在上限内可解（${solution.length} ≤ ${parsed.level.stepLimit}）`,
        parsed.level.stepLimit === 0 || solution.length <= parsed.level.stepLimit,
      );
    }
  }
}

console.log('\n推箱子：接线静态断言');
{
  const sokobanSrc = readFileSync(new URL('../src/minigame/games/sokoban/scene.ts', import.meta.url), 'utf8');
  check('滑动阈值存在', sokobanSrc.includes('SWIPE_THRESHOLD'));
  check('轻点按位置判方向', sokobanSrc.includes('directionOf(pointer.x - 0.5'));
  check('键盘方向键与 WASD', sokobanSrc.includes('ArrowUp') && sokobanSrc.includes('KeyW'));
  check('过关回调写进度', sokobanSrc.includes('onCleared?.(result.state.steps)'));
  check('死锁只提示（不判负）', sokobanSrc.includes("t('minigame.sokoban.deadlock')"));
  check('过关相机庆祝', sokobanSrc.includes('private celebrate('));
  check('主菜单按 gameId 进推箱子', mainSrc.includes('new SokobanGame(level, { onCleared })'));
  check('过关写进度', mainSrc.includes('recordClear(loadProgress(), gameId, level, steps)'));
  check('主菜单路径 Esc 退出', mainSrc.includes('activeMenuMiniGame?.stop()'));
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
