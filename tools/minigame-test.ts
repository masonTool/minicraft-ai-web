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

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
