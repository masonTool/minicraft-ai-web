/**
 * 刷怪笼里旋转的迷你生物（批次 487，E21 收尾）
 *
 * 两层：
 *  ① 纯函数 `collectSpawnerDecorations`（哪些笼子、什么生物、坐标对不对）；
 *  ② 渲染层真的把它们画出来（`usedInstances` 从 0 变成一只有多少部件）。
 *
 * 第 ② 层是这一批唯一能离线验的部分——"看起来在转"没法断言，
 * 但"画了 / 没画"可以：笼子被挖掉之后实例数必须回到 0（否则会留幽灵模型）。
 */

import * as THREE from 'three';
import { Block } from '../src/core/registry/blocks.ts';
import { SPAWNER_DEFS, spawnerDefFor } from '../src/core/registry/spawners.ts';
import { collectSpawnerDecorations, decorationIsActive } from '../src/core/world/SpawnerDecor.ts';
import { createMob } from '../src/core/entity/MobFactory.ts';
import { mobTypeById } from '../src/core/entity/mobs.ts';
import { MobRenderer } from '../src/render/MobRenderer.ts';

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

console.log('\n[收集：哪些笼子该画什么]');
{
  // 用真的刷怪笼方块（僵尸笼）当样本
  const zombieSpawner = SPAWNER_DEFS.find((entry) => entry.mobId === 'zombie')?.block ?? Block.SPAWNER;
  const def = spawnerDefFor(zombieSpawner);
  check('僵尸刷怪笼有定义', def !== null);

  const blocks = new Map<string, number>([
    ['4,64,4', zombieSpawner],
    ['10,30,-2', zombieSpawner],
  ]);
  const blockAt = (x: number, y: number, z: number): number => blocks.get(`${x},${y},${z}`) ?? Block.AIR;

  const list = collectSpawnerDecorations(['4,64,4', '10,30,-2'], blockAt, (id) => spawnerDefFor(id) ?? null);
  equal('两个笼子两条装饰', list.length, 2);
  equal('坐标是格心（x+0.5）', list[0]!.x, 4.5);
  equal('高度稍抬起（y+0.6，模型才不会陷进笼底）', list[0]!.y, 64.6);
  equal('坐标是格心（z+0.5）', list[0]!.z, 4.5);
  equal('生物种类来自刷怪笼定义', list[0]!.mobId, 'zombie');
  equal('激活半径来自刷怪笼定义', list[0]!.activeRadius, def!.activeRadius);

  // 批次 586：玩家靠近才转，边界与刷怪距离同一条三维判定
  const deco = list[0]!;
  check('玩家站在笼子里 → 激活', decorationIsActive(deco, { x: deco.x, y: deco.y, z: deco.z }));
  check(
    '玩家在半径外 → 停止',
    !decorationIsActive(deco, { x: deco.x + def!.activeRadius + 0.1, y: deco.y, z: deco.z }),
  );

  // 笼子被挖掉：方块变成空气 → 不画（否则会留一个幽灵模型）
  blocks.set('4,64,4', Block.AIR);
  equal(
    '被挖掉的笼子不再画',
    collectSpawnerDecorations(['4,64,4'], blockAt, (id) => spawnerDefFor(id) ?? null).length,
    0,
  );

  // 键是手写格式：脏数据要跳过，不能把模型丢到 NaN
  blocks.set('4,64,4', zombieSpawner);
  const dirty = collectSpawnerDecorations(
    ['a,2,3', '4,64'],
    blockAt,
    (id) => spawnerDefFor(id) ?? null,
  );
  equal('脏键全部跳过', dirty.length, 0);

  // 重复键
  const dup = collectSpawnerDecorations(
    ['4,64,4', '4,64,4'],
    blockAt,
    (id) => spawnerDefFor(id) ?? null,
  );
  equal('同一个笼子只出一条', dup.length, 1);

  equal('空集合返回空数组', collectSpawnerDecorations([], blockAt, () => null).length, 0);
}

console.log('\n[渲染：真的画了，也在挖掉后消失]');
{
  const scene = new THREE.Scene();
  const renderer = new MobRenderer(scene, () => 1);
  const camera = new THREE.PerspectiveCamera();
  const light = () => ({ sky: 15, block: 0 });

  renderer.update([], camera, 0.016, light);
  equal('没有装饰时实例数是 0', renderer.usedInstances, 0);

  const type = mobTypeById('zombie');
  check('僵尸种类存在', type !== undefined);
  if (type) {
    const sample = createMob(type, 0, 0, 0);
    renderer.setDecorations([{ sample, x: 4.5, y: 64.6, z: 4.5, phase: 0, active: true }]);
    renderer.update([], camera, 0.016, light);
    check('一只装饰把实例数顶上去了', renderer.usedInstances > 0, `${renderer.usedInstances}`);

    const once = renderer.usedInstances;
    renderer.update([], camera, 0.016, light);
    equal('第二帧数量不变（外观是缓存复用的）', renderer.usedInstances, once);

    renderer.setDecorations([]);
    renderer.update([], camera, 0.016, light);
    equal('清空之后实例数回到 0（不会留幽灵）', renderer.usedInstances, 0);
  }

  renderer.dispose();
}

console.log('\n[刷怪笼方块本身]');
{
  // 这一批不改方块，只确认"笼子 → 定义"这条链没被改坏
  check('刷怪笼定义表不是空的', SPAWNER_DEFS.length > 0, `${SPAWNER_DEFS.length} 种`);
  let resolved = 0;
  for (const entry of SPAWNER_DEFS) {
    if (spawnerDefFor(entry.block) === entry) resolved++;
  }
  equal('每一种笼子的方块都能反查回定义', resolved, SPAWNER_DEFS.length);
  check('空气不是刷怪笼', !spawnerDefFor(Block.AIR));
  check('石头不是刷怪笼', !spawnerDefFor(Block.STONE));
}

console.log(`\n刷怪笼装饰测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
