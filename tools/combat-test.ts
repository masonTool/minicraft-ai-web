/**
 * 近战攻击的实体射线测试
 *
 * 运行：npm run test:combat
 *
 * 覆盖：正对命中与距离、擦边、取最近实体、超出攻击距离、
 * 实体在射线起点后方、以及"平行于盒面"的退化情形。
 */

import { Mob } from '../src/core/entity/Mob.ts';
import { mobTypeById } from '../src/core/entity/mobs.ts';
import { rayBoxDistance, raycastEntities } from '../src/core/interaction/EntityRaycast.ts';
import { sweepDamage } from '../src/core/registry/tools.ts';

let passed = 0;
let failed = 0;

/** 数值断言（与其他套件同名同义） */
function equal(name: string, actual: number, expected: number): void {
  const ok = Math.abs(actual - expected) < 1e-6;
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}  →  ${actual}（期望 ${expected}）`);
  }
}

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}

const zombie = mobTypeById('zombie')!; // 宽 0.6、高 1.95

console.log('\n[射线与盒子]');
{
  // 盒子 [0,1]×[0,1]×[0,1]，从 (-2, 0.5, 0.5) 朝 +X
  const hit = rayBoxDistance(-2, 0.5, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1, 10);
  check('正对盒子命中，距离正确（2）', hit !== null && Math.abs(hit - 2) < 1e-6, `${hit}`);

  const miss = rayBoxDistance(-2, 3, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1, 10);
  check('偏离盒子的射线不命中', miss === null, `${miss}`);

  const behind = rayBoxDistance(3, 0.5, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1, 10);
  check('盒子在射线起点后方时不命中', behind === null, `${behind}`);

  const tooFar = rayBoxDistance(-20, 0.5, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1, 5);
  check('超出最大距离不命中', tooFar === null, `${tooFar}`);

  const inside = rayBoxDistance(0.5, 0.5, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1, 10);
  check('起点在盒子内部时距离为 0', inside === 0, `${inside}`);

  // 平行轴：射线沿 +X，y 恰好贴着盒子边缘（y=1 属于盒内）
  const edge = rayBoxDistance(-2, 1, 0.5, 1, 0, 0, 0, 0, 0, 1, 1, 1, 10);
  check('贴着盒子边界仍然命中', edge !== null && Math.abs(edge - 2) < 1e-6, `${edge}`);
}

console.log('\n[实体列表取最近]');
{
  const near = new Mob(zombie, 2, 64, 0);
  const far = new Mob(zombie, 6, 64, 0);

  const hit = raycastEntities([far, near], 0, 64.9, 0, 1, 0, 0, 10);
  check('同时命中多个实体时取最近的那个', hit !== null && hit.entity === near, hit ? `${hit.entity.x}` : 'null');
  check('命中距离取盒子前沿', hit !== null && Math.abs(hit.distance - 1.7) < 1e-6, `${hit?.distance}`);

  // 超出攻击距离（3 格）
  const short = raycastEntities([far], 0, 64.9, 0, 1, 0, 0, 3);
  check('攻击距离之外不命中', short === null, `${short?.distance}`);
}

console.log('\n[实际瞄准场景]');
{
  const mob = new Mob(zombie, 0, 64, 3); // 在玩家正前方 3 格（+Z 方向）
  const player = { x: 0, y: 64, z: 0, eyeY: 65.62 };

  // 玩家 yaw=π 时朝 +Z（与游戏里 yaw=0 朝 -Z 相对）
  const yaw = Math.PI;
  const dirX = -Math.sin(yaw);
  const dirZ = -Math.cos(yaw);
  const centered = raycastEntities([mob], player.x, player.eyeY, player.z, dirX, 0, dirZ, 3.2);
  check('准星对准生物时命中', centered !== null && centered.entity === mob, `${centered?.distance}`);

  // 抬高视线（pitch 30°）后会从生物头顶掠过
  const pitch = Math.PI / 6;
  const cosPitch = Math.cos(pitch);
  const high = raycastEntities(
    [mob],
    player.x,
    player.eyeY,
    player.z,
    -Math.sin(yaw) * cosPitch,
    Math.sin(pitch),
    -Math.cos(yaw) * cosPitch,
    3.2,
  );
  check('抬高视线后打不中脚边的生物', high === null || high.distance > centered!.distance, `${high?.distance}`);

  // 高度对齐：视线抬到生物躯干高度则能命中
  const level = raycastEntities([mob], player.x, 64 + zombie.height * 0.5, player.z, dirX, 0, dirZ, 3.2);
  check('视线与躯干同高时命中', level !== null, `${level?.distance}`);
}

console.log('\n[横扫之刃的溅射伤害（批次 262）]');
{
  equal('0 级不溅射', sweepDamage(7, 0), 0);
  equal('I 级：1 + 7×1/2 = 4.5', sweepDamage(7, 1), 4.5);
  equal('III 级：1 + 7×3/4 = 6.25', sweepDamage(7, 3), 6.25);
  equal('超过 III 级按 III 级算', sweepDamage(7, 9), 6.25);
  equal('武器伤害 0 时只剩基础 1 点', sweepDamage(0, 3), 1);
}

console.log(`\n战斗测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
