/**
 * 鞘翅滑翔（批次 499，B18）
 *
 * 四块：
 *  ① 装备槽（鞘翅能进胸甲槽，但进不了头盔/护腿/靴子槽——它**不是盔甲**，
 *     `armorInfoById` 查不到，靠一条特判）；
 *  ② 滑翔物理（垂直速度收敛到 -0.55、不累积摔落高度、水平比走路快）；
 *  ③ 与"走路/自由落体"的对照（同一段时间里滑翔掉的高度远小于自由落体）；
 *  ④ 接线守卫（主程序按"装备 + 空中按下跳跃"判定、落地/入水结束）。
 */

import { ARMOR_SLOT_BASE, ELYTRA_ITEM_ID, armorSlotAccepts, armorInfoById } from '../web/src/core/registry/armor.ts';
import { Item } from '../web/src/core/registry/items.ts';
import { GLIDE_SPEED, PlayerPhysics, WALK_SPEED, type PhysicsWorld } from '../web/src/core/physics/PlayerPhysics.ts';
import { readFileSync } from 'node:fs';

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

console.log('\n[装备槽：鞘翅进胸甲槽]');
{
  equal('鞘翅的 id 是 1539', ELYTRA_ITEM_ID, 1539);
  equal('items.ts 用的是同一个常量', Item.ELYTRA, ELYTRA_ITEM_ID);
  equal('鞘翅不是盔甲（没有护甲值）', armorInfoById(Item.ELYTRA), undefined);

  const chest = ARMOR_SLOT_BASE + 1;
  const helmet = ARMOR_SLOT_BASE + 0;
  const leggings = ARMOR_SLOT_BASE + 2;
  const boots = ARMOR_SLOT_BASE + 3;
  check('胸甲槽收鞘翅', armorSlotAccepts(chest, Item.ELYTRA));
  check('头盔槽不收', !armorSlotAccepts(helmet, Item.ELYTRA));
  check('护腿槽不收', !armorSlotAccepts(leggings, Item.ELYTRA));
  check('靴子槽不收', !armorSlotAccepts(boots, Item.ELYTRA));

  // 正常盔甲不受影响
  const anyHelmet = [1130, 1135, 1140].find((id) => armorInfoById(id)?.slot === 0)!;
  check('普通头盔仍然只进头盔槽', armorSlotAccepts(helmet, anyHelmet) && !armorSlotAccepts(chest, anyHelmet));
  check('非装备槽什么都收（背包格不该被这条影响）', armorSlotAccepts(0, Item.ELYTRA));
}

/** 一片"只有空气、脚下 y<0 是实心"的世界 */
const sky: PhysicsWorld = {
  collisionAt: (_x, y) => (y < 0 ? 'full' : null),
  isLiquid: () => false,
};

const idle = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false } as const;

console.log('\n[滑翔物理]');
{
  const physics = new PlayerPhysics();
  physics.teleport(0.5, 100.5, 0.5);
  physics.onGround = false;

  // 滑 1 秒：垂直速度应当收敛到 -0.55 附近，而不是自由落体
  for (let i = 0; i < 60; i++) physics.update(sky, idle, 0, 1 / 60, false, 1, 1, false, true);
  check('1 秒后仍在缓降（|vy| 在 0.4~0.7 之间）', Math.abs(physics.vy) > 0.4 && Math.abs(physics.vy) < 0.7, `vy=${physics.vy.toFixed(3)}`);
  check('掉下去不到 1 格（自由落体会掉 16 格）', 100.5 - physics.y < 1, `掉了 ${(100.5 - physics.y).toFixed(2)}`);
  equal('滑翔不累积摔落高度', physics.fallStartY, null);

  // 水平：滑翔速度比走路快（同一段时间走得远）
  const glider = new PlayerPhysics();
  glider.teleport(0.5, 100.5, 0.5);
  glider.onGround = false;
  const walker = new PlayerPhysics();
  walker.teleport(0.5, 100.5, 0.5);
  walker.onGround = false;
  const run = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false } as const;
  for (let i = 0; i < 60; i++) {
    glider.update(sky, run, 0, 1 / 60, false, 1, 1, false, true);
    walker.update(sky, run, 0, 1 / 60, false, 1, 1, false, false);
  }
  check('滑翔比走路快', Math.abs(glider.vz) > Math.abs(walker.vz), `滑翔 ${glider.vz.toFixed(2)} / 走 ${walker.vz.toFixed(2)}`);
  check('滑翔速度接近 GLIDE_SPEED', Math.abs(Math.abs(glider.vz) - GLIDE_SPEED) < 1.5, `${glider.vz.toFixed(2)}`);
  check('GLIDE_SPEED 确实大于 WALK_SPEED', GLIDE_SPEED > WALK_SPEED, `${GLIDE_SPEED} vs ${WALK_SPEED}`);
}

console.log('\n[对照：不滑翔就是自由落体]');
{
  const faller = new PlayerPhysics();
  faller.teleport(0.5, 100.5, 0.5);
  faller.onGround = false;
  for (let i = 0; i < 60; i++) faller.update(sky, idle, 0, 1 / 60, false, 1, 1, false, false);
  check('自由落体 1 秒掉 10 格以上', 100.5 - faller.y > 10, `掉了 ${(100.5 - faller.y).toFixed(1)}`);

  // 滑翔会**主动清掉**已有的摔落高度：从高处摔下来、半空中开始滑翔，
  // 落地时不该按"从 fallStartY 掉下来"算伤害（`fallStartY` 的记录在 main，物理层只负责清）
  const rescue = new PlayerPhysics();
  rescue.teleport(0.5, 100.5, 0.5);
  rescue.onGround = false;
  rescue.fallStartY = 120;
  rescue.update(sky, idle, 0, 1 / 60, false, 1, 1, false, true);
  equal('滑翔会清掉已有的摔落高度', rescue.fallStartY, null);
}

console.log('\n[接线守卫]');
{
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  check('每帧在 physics.update 之前更新滑翔状态', /this\.updateGliding\(rawInput\);[\s\S]{0,200}this\.physics\.update\(/.test(mainSrc));
  check('滑翔状态传进了物理层', /this\.gliding,\s*\);\s*\n\s*\/\/ 自动跳跃进诊断日志/.test(mainSrc) || /this\.settings\.autoJump,\s*\n\s*\/\/ 滑翔（批次 499）：鞘翅\s*\n\s*this\.gliding,/.test(mainSrc));
  check('按"这一帧按下"判定（按住起跳不算滑翔）', /const jumpPressed = input\.jump && !this\.jumpWasDown;/.test(mainSrc));
  check('落地结束滑翔', /if \(this\.physics\.onGround\) \{\s*\n\s*this\.gliding = false;/.test(mainSrc));
  check('卸下鞘翅 / 切飞行 / 入水都结束', /if \(!hasElytra \|\| this\.flying \|\| this\.physics\.inWater\) \{\s*\n\s*this\.gliding = false;/.test(mainSrc));
}

console.log(`\n鞘翅测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
