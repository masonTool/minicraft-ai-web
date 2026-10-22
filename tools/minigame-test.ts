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
