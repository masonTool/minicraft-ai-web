/**
 * 生物瞄准规则（批次 271）离线测试
 *
 * 覆盖：
 *  1. 哪些方块算"挡视线"（草/雪层/水不挡，玻璃/石头/树叶挡）
 *  2. 眼睛到目标之间被整格方块挡住时返回 true
 *  3. `raycastEntities` 的外扩容差、过滤器与命中点坐标
 *  4. 摇杆死区的圆判据（含阻尼半径随按钮缩放）
 *
 * 运行：npm run test:aim
 */

import { Block, blockDef } from '../src/core/registry/blocks.ts';
import { isSightBlocker, sightBlocked } from '../src/core/interaction/AimTarget.ts';
import { raycastEntities } from '../src/core/interaction/EntityRaycast.ts';
import { Entity } from '../src/core/entity/Entity.ts';
import { STICK_DEAD_ZONE_RATIO, withinStickDeadZone } from '../src/ui/TouchControls.ts';

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

/** 一个没有 AI 的盒子，只用来做射线检测 */
class Box extends Entity {
  tick(): void {
    /* 空 */
  }
}

/** 用一张小表模拟世界：坐标 → 方块 id */
function worldOf(entries: Array<[number, number, number, number]>): (x: number, y: number, z: number) => number {
  const map = new Map(entries.map(([x, y, z, id]) => [`${x},${y},${z}`, id]));
  return (x, y, z) => map.get(`${x},${y},${z}`) ?? Block.AIR;
}

// ---------------------------------------------------------------- 1. 挡视线的方块

console.log('\n[挡视线的方块]');
{
  check('石头挡视线', isSightBlocker(Block.STONE));
  check('玻璃挡视线（不能隔玻璃打怪，与原版一致）', isSightBlocker(Block.GLASS));
  check('树叶挡视线', isSightBlocker(Block.OAK_LEAVES));
  check('雪块挡视线', isSightBlocker(Block.SNOW_BLOCK));
  check('空气不挡', !isSightBlocker(Block.AIR));
  check('水不挡', !isSightBlocker(Block.WATER));
  check('岩浆不挡', !isSightBlocker(Block.LAVA));
  check('草不挡（站在草里的猪能选中）', !isSightBlocker(Block.SHORT_GRASS));
  check('蒲公英不挡', !isSightBlocker(Block.DANDELION));
  check('雪层不挡（半透明矮块）', !isSightBlocker(Block.SNOW));
  check('睡莲不挡', !isSightBlocker(Block.LILY_PAD));
  check(
    '判据不是"只要 solid=false"：玻璃 solid=true 但仍然是整格，必须挡',
    blockDef(Block.GLASS).solid && blockDef(Block.SHORT_GRASS).solid === false,
  );
}

// ---------------------------------------------------------------- 2. 视线遮挡

console.log('\n[视线遮挡]');
{
  // 眼睛在 (0.5, 1.6, 0.5)，目标在 (0.5, 1.6, 5.5)
  const clear = worldOf([]);
  check('空地上视线畅通', !sightBlocked(clear, 0.5, 1.6, 0.5, 0.5, 1.6, 5.5));

  const stone = worldOf([[0, 1, 3, Block.STONE]]);
  check('中间隔一块石头 → 挡住', sightBlocked(stone, 0.5, 1.6, 0.5, 0.5, 1.6, 5.5));

  const glass = worldOf([[0, 1, 3, Block.GLASS]]);
  check('中间隔一块玻璃 → 挡住', sightBlocked(glass, 0.5, 1.6, 0.5, 0.5, 1.6, 5.5));

  const grass = worldOf([[0, 1, 3, Block.SHORT_GRASS]]);
  check('中间隔一株草 → 不挡', !sightBlocked(grass, 0.5, 1.6, 0.5, 0.5, 1.6, 5.5));

  const snow = worldOf([[0, 1, 3, Block.SNOW]]);
  check('中间隔一层雪 → 不挡', !sightBlocked(snow, 0.5, 1.6, 0.5, 0.5, 1.6, 5.5));

  // 墙在目标**后面**：射线在目标处就停了，不能把身后的墙算成遮挡
  const behind = worldOf([[0, 1, 4, Block.STONE]]);
  check('墙在目标后面不算遮挡', !sightBlocked(behind, 0.5, 1.6, 0.5, 0.5, 1.6, 3.5));
}

// ---------------------------------------------------------------- 3. 实体射线

console.log('\n[实体射线]');
{
  const pig = new Box(0.5, 0, 3.5, 0.9, 0.9);
  const drop = new Box(0.5, 0, 2.5, 0.3, 0.3);

  // 从 (0.5, 0.2, 0.5) 朝 +Z（两者都覆盖这个高度）
  const hit = raycastEntities([pig], 0.5, 0.2, 0.5, 0, 0, 1, 5);
  check('正对生物命中', hit?.entity === pig);
  check('命中距离正确（近端面 3.05 - 起点 0.5）', hit !== null && Math.abs(hit.distance - 2.55) < 1e-6, String(hit?.distance));
  check(
    '命中点坐标是射线上的点',
    hit !== null && Math.abs(hit.x - 0.5) < 1e-6 && Math.abs(hit.z - 3.05) < 1e-6,
    `${hit?.x},${hit?.z}`,
  );

  const miss = raycastEntities([pig], 0.5 + 0.6, 0.2, 0.5, 0, 0, 1, 5);
  check('偏离 0.6 格（超过半宽 0.45）打不中', miss === null);
  const inflated = raycastEntities([pig], 0.5 + 0.5, 0.2, 0.5, 0, 0, 1, 5, 0.12);
  check('外扩 0.12 格之后能命中（瞄准容差）', inflated?.entity === pig, String(inflated?.entity.id));

  const filtered = raycastEntities([drop, pig], 0.5, 0.2, 0.5, 0, 0, 1, 5, 0, (entity) => entity === pig);
  check('过滤器跳过前面的掉落物，选中后面的生物', filtered?.entity === pig);
  const noFilter = raycastEntities([drop, pig], 0.5, 0.2, 0.5, 0, 0, 1, 5);
  check('不过滤时先命中更近的掉落物（说明过滤器确实起作用）', noFilter?.entity === drop);
}

// ---------------------------------------------------------------- 4. 摇杆死区

console.log('\n[摇杆死区]');
{
  check('死区比例是 60%（批次 275 从 20% 加大）', STICK_DEAD_ZONE_RATIO === 0.6, String(STICK_DEAD_ZONE_RATIO));
  check('圆心在死区里', withinStickDeadZone(100, 100, 60, 100, 100));
  check('半径内（60）在死区里', withinStickDeadZone(100, 100, 60, 160, 100));
  check('半径 + 60% 的边缘仍在死区里（约 40px 保护区）', withinStickDeadZone(100, 100, 60, 196, 100));
  check('超出 60% 之后不算死区（不会吞掉旁边一大片）', !withinStickDeadZone(100, 100, 60, 199, 100));
  check('按钮变大时死区同比变大', withinStickDeadZone(100, 100, 80, 228, 100) && !withinStickDeadZone(100, 100, 60, 228, 100));
}

console.log(`\n瞄准测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
