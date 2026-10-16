/**
 * 生物生成规则离线测试
 *
 * 运行：npm run test:spawn
 *
 * 用一个"隔层是空气、地表是草方块"的虚拟世界，把规则里的每一条
 * （光照、地面方块、距离、上限）单独拆出来验证。
 */

import { MobSpawner, type SpawnContext } from '../src/core/entity/MobSpawner.ts';
import { MOB_TYPES } from '../src/core/entity/mobs.ts';
import type { MobType } from '../src/core/entity/Mob.ts';
import { Block } from '../src/core/registry/blocks.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  →  ${detail}` : ''}`);
  }
}

interface Spawned {
  type: MobType;
  x: number;
  y: number;
  z: number;
}

/**
 * 虚拟世界按 4 格一个周期分层：y≡0 是实心、y≡1 与 y≡2 是空气、y≡3 是实心。
 * 于是 y≡1 处正好是"脚下实心 + 身体两格空"的合法落脚点；
 * 其中 y=64 那一层换成草方块，用来验证被动生物的地面规则。
 */
function makeContext(
  options: {
    sky: number;
    block: number;
    player?: { x: number; y: number; z: number };
    spawned: Spawned[];
    hostile?: number;
    passive?: number;
    /** 调用了多少次世界查询（用来钉住"刷怪不再逐格扫描"，见文件末尾） */
    counts?: { block: number; surface: number };
  },
): SpawnContext {
  return {
    getBlock: (_x, y) => {
      if (options.counts) options.counts.block++;
      const phase = ((y % 4) + 4) % 4;
      if (phase === 0) return y === 64 ? Block.GRASS_BLOCK : Block.STONE;
      if (phase === 1 || phase === 2) return Block.AIR;
      return Block.STONE;
    },
    getSkyLight: () => options.sky,
    getBlockLight: () => options.block,
    /**
     * 这个虚拟世界一路实心到 y=320，没有"自然地表"可言，
     * 所以直接把它声明成草地那一层（64）——测试意图就是"地表是草方块"。
     */
    getSurfaceBlockY: () => {
      if (options.counts) options.counts.surface++;
      return 64;
    },
    player: options.player ?? { x: 0.5, y: 65, z: 0.5 },
    spawn: (type, x, y, z) => options.spawned.push({ type, x, y, z }),
    hostileCount: options.hostile ?? 0,
    passiveCount: options.passive ?? 0,
  };
}

/** 跑若干个生成周期 */
function runCycles(spawner: MobSpawner, ctx: SpawnContext, cycles = 30): void {
  for (let i = 0; i < cycles; i++) spawner.update(2.0, ctx);
}

console.log('\n[敌对生物：光照规则]');
{
  const dark: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 5, block: 0, spawned: dark }));
  check('黑暗处（方块光 0、天光 5）会刷敌对生物', dark.length > 0, `${dark.length} 只`);

  // 注意：一次 update 会同时尝试敌对与被动，所以这里要按类型过滤
  const bright: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 15, block: 0, spawned: bright }));
  check('露天（天光 15）不刷敌对生物', bright.every((s) => !s.type.hostile), `其中敌对 ${bright.filter((s) => s.type.hostile).length} 只`);

  const lit: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 5, block: 8, spawned: lit }));
  check('方块光 > 0（如火把旁）不刷敌对生物', lit.every((s) => !s.type.hostile), `其中敌对 ${lit.filter((s) => s.type.hostile).length} 只`);

  const boundary: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 7, block: 0, spawned: boundary }));
  check('天光恰好 7 仍然可以刷', boundary.length > 0, `${boundary.length} 只`);

  const above: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 8, block: 0, spawned: above }));
  check('天光 8 就不再刷敌对生物', above.every((s) => !s.type.hostile), `其中敌对 ${above.filter((s) => s.type.hostile).length} 只`);

  check('刷出的都是敌对生物', dark.every((s) => s.type.hostile), [...new Set(dark.map((s) => s.type.id))].join(','));
}

console.log('\n[被动生物：地面与光照规则]');
{
  const grass: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 15, block: 0, spawned: grass }));
  check('白天草方块上会刷被动生物', grass.length > 0, `${grass.length} 只`);
  check('刷出的都是被动生物', grass.every((s) => !s.type.hostile), [...new Set(grass.map((s) => s.type.id))].join(','));
  check('全部落在草方块那一层（y=65）', grass.every((s) => s.y === 65), grass.map((s) => s.y).join(','));

  const night: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 4, block: 0, spawned: night }));
  check('天黑（天光 4）不刷被动生物', night.every((s) => s.type.hostile), `其中被动 ${night.filter((s) => !s.type.hostile).length} 只`);

  // 把地表换成石头 → 不应再有被动生物
  const stony: Spawned[] = [];
  const ctx = makeContext({ sky: 15, block: 0, spawned: stony });
  const originalGetBlock = ctx.getBlock;
  ctx.getBlock = (x, y, z) => (((y % 4) + 4) % 4 === 0 && y === 64 ? Block.STONE : originalGetBlock(x, y, z));
  runCycles(new MobSpawner(), ctx);
  check('非草方块地表不刷被动生物', stony.length === 0, `${stony.length} 只`);
}

console.log('\n[距离限制]');
{
  const spawned: Spawned[] = [];
  const ctx = makeContext({ sky: 5, block: 0, spawned });
  runCycles(new MobSpawner(), ctx, 40);
  const distances = spawned.map((s) => Math.hypot(s.x - 0.5, s.z - 0.5));
  check('敌对生物不会刷在玩家 16 格以内', distances.every((d) => d >= 16 - 1.5), `最近 ${Math.min(...distances).toFixed(1)}`);
  check('敌对生物不会刷在玩家 48 格以外', distances.every((d) => d <= 48 + 1.5), `最远 ${Math.max(...distances).toFixed(1)}`);

  const passive: Spawned[] = [];
  const passiveCtx = makeContext({ sky: 15, block: 0, spawned: passive });
  runCycles(new MobSpawner(), passiveCtx, 40);
  const passiveDistances = passive.map((s) => Math.hypot(s.x - 0.5, s.z - 0.5));
  check('被动生物刷在 8~32 格之间', passiveDistances.every((d) => d >= 8 - 1.5 && d <= 32 + 1.5),
    `${Math.min(...passiveDistances).toFixed(1)} ~ ${Math.max(...passiveDistances).toFixed(1)}`);
}

console.log('\n[生成上限]');
{
  const spawned: Spawned[] = [];
  const full = makeContext({ sky: 5, block: 0, spawned, hostile: 24 });
  runCycles(new MobSpawner(), full, 50);
  check('敌对生物达到上限 24 后不再生成', spawned.every((s) => !s.type.hostile), `其中敌对 ${spawned.filter((s) => s.type.hostile).length} 只`);

  const passiveFull: Spawned[] = [];
  const passiveCtx = makeContext({ sky: 15, block: 0, spawned: passiveFull, passive: 16 });
  runCycles(new MobSpawner(), passiveCtx, 50);
  check('被动生物达到上限 16 后不再生成', passiveFull.length === 0, `${passiveFull.length} 只`);
}

console.log('\n[没有玩家时不生成]');
{
  const spawned: Spawned[] = [];
  const ctx = makeContext({ sky: 5, block: 0, spawned });
  ctx.player = null;
  runCycles(new MobSpawner(), ctx, 30);
  check('玩家未加载时不生成任何生物', spawned.every((s) => !s.type.hostile) && spawned.every((s) => s.type.hostile), `${spawned.length} 只`);
}

console.log('\n[节流]');
{
  const spawned: Spawned[] = [];
  const spawner = new MobSpawner();
  const ctx = makeContext({ sky: 5, block: 0, spawned });
  // 每帧 0.05 秒，40 帧 = 2 秒 → 只应该触发一次生成周期
  for (let i = 0; i < 40; i++) spawner.update(0.05, ctx);
  // 一个生成周期最多刷 3 只敌对（实现里的上限）
  check('2 秒内只触发一次生成周期（最多 3 只）', spawned.length <= 3, `${spawned.length} 只`);
}

console.log('\n[性能：被动刷怪不再逐格扫描（C6 高度图）]');
{
  // hostileCount 先顶满，这样一次 update 里只剩被动那条路，计数才干净
  const spawned: Spawned[] = [];
  const counts = { block: 0, surface: 0 };
  new MobSpawner().update(2.0, makeContext({ sky: 15, block: 0, spawned, counts, hostile: 24 }));

  check('地表高度走的是高度图', counts.surface > 0, `surface=${counts.surface} 次`);
  check('16 次尝试里的世界查询很少（原来要往下扫几十~几百格）', counts.block <= 64, `实际 ${counts.block} 次 getBlock`);
  check('而且照样刷得出来（优化没把功能优化没）', spawned.some((s) => !s.type.hostile), `${spawned.length} 只`);
}

console.log('\n[生物表覆盖]');
{
  const ids = new Set(MOB_TYPES.map((t) => t.id));
  check('包含 3 种敌对生物', ['zombie', 'skeleton', 'creeper'].every((id) => ids.has(id)));
  check('包含 4 种被动生物', ['cow', 'pig', 'sheep', 'chicken'].every((id) => ids.has(id)));
}

console.log(`\n生成测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
