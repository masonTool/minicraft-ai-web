/**
 * 生物生成规则离线测试
 *
 * 运行：npm run test:spawn
 *
 * 用一个"隔层是空气、地表是草方块"的虚拟世界，把规则里的每一条
 * （光照、地面方块、距离、上限）单独拆出来验证。
 */

import { MobSpawner, type SpawnContext } from '../src/core/entity/MobSpawner.ts';
// 史莱姆那条高度线（批次 120）：断言里按它比，别写死 40
import { SLIME_SPAWN_MAX_Y } from '../src/core/world/Slime.ts';
import { MOB_TYPES } from '../src/core/entity/mobs.ts';
import type { MobType } from '../src/core/entity/Mob.ts';
import { Block } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, itemDef } from '../src/core/registry/items.ts';
import {
  SPAWN_EGG_EXCLUDED,
  SPAWN_EGG_SPECS,
  spawnEggItemId,
  spawnEggMobOf,
  spawnEggTile,
} from '../src/core/registry/spawnEggs.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { itemLabel } from '../src/core/registry/itemNames.ts';

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
    /** 当前维度（批次 94）：恶魂只在下界刷 */
    dimension?: 'overworld' | 'nether' | 'end';
    /**
     * 换成"七格高的空腔"地形（批次 94）：恶魂要的 4×4×4 空腔在默认那种
     * "两格空气 + 一格半实心"的分层世界里根本不存在。
     */
    airBox?: boolean;
    /** 调用了多少次世界查询（用来钉住"刷怪不再逐格扫描"，见文件末尾） */
    counts?: { block: number; surface: number };
    /** "这一列在不在某种结构里"（批次 115）：不传就当不在任何区域里 */
    inZone?: (kind: string, x: number, z: number) => boolean;
  },
): SpawnContext {
  return {
    getBlock: (_x, y) => {
      if (options.counts) options.counts.block++;
      if (options.airBox) return ((y % 8) + 8) % 8 === 0 ? Block.STONE : Block.AIR;
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
    dimension: options.dimension,
    ...(options.inZone ? { inZone: options.inZone } : {}),
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

console.log('\n[结构限定：凋灵骷髅只要塞]');
{
  // ⚠️ 用 `airBox`（七格高的空腔）：下界的另一只敌对生物是**恶魂**，
  // 它要 4×4 的空腔，默认那种"两格空气一层石头"的地形里它一只都刷不出来
  // ——不这么铺，这条测试会变成"下界里两只怪都不出"，把结构过滤的功劳记到维度上
  const netherDark = { sky: 0, block: 0, dimension: 'nether' as const, airBox: true };

  // 不在要塞里：一只凋灵骷髅都不许出现，但恶魂照刷
  const outside: Spawned[] = [];
  runCycles(
    new MobSpawner(),
    makeContext({ ...netherDark, spawned: outside, inZone: () => false }),
    60,
  );
  check(
    '不在要塞里 → 一只凋灵骷髅都没有',
    outside.every((s) => s.type.id !== 'wither_skeleton'),
    outside.filter((s) => s.type.id === 'wither_skeleton').length + ' 只',
  );
  check(
    '（前置）别的下界生物照刷（恶魂）',
    outside.some((s) => s.type.id === 'ghast'),
    [...new Set(outside.map((s) => s.type.id))].join(',') || '一只都没有',
  );

  // 在要塞里：会刷出来
  const inside: Spawned[] = [];
  runCycles(
    new MobSpawner(),
    makeContext({ ...netherDark, spawned: inside, inZone: (kind) => kind === 'nether_fortress' }),
    60,
  );
  check('要塞里 → 凋灵骷髅会刷', inside.some((s) => s.type.id === 'wither_skeleton'));
  check('别的下界生物照刷（不是"只刷凋灵骷髅"）', inside.some((s) => s.type.id !== 'wither_skeleton'));

  // 没接钩子（离线、未来的别的调用方）：宁可一只不刷，也不要撒满下界
  const noHook: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ ...netherDark, spawned: noHook }), 60);
  check(
    '没接 inZone 钩子时也不刷（"不传就当不在任何区域里"）',
    noHook.every((s) => s.type.id !== 'wither_skeleton'),
  );

  // 钩子只对"要结构"的生物生效：主世界的怪不该跟着跑到下界来
  check(
    '钩子不影响维度过滤（下界里刷不出来僵尸）',
    [...outside, ...inside].every((s) => s.type.dimension === 'nether'),
    [...new Set([...outside, ...inside].map((s) => s.type.id))].join(','),
  );
}

console.log('\n[史莱姆：史莱姆区块 + y<40 + 不看光照（批次 120）]');
{
  // ⚠️ 白天（天光 15）：普通敌对生物**一只都不该刷**（它们要黑暗），
  // 而史莱姆不看光照——所以这一节只要出现"别的生物"，就说明 ignoreLight 泄漏给了别人
  const bright = { sky: 15, block: 0, dimension: 'overworld' as const, airBox: true };

  const outside: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ ...bright, spawned: outside, inZone: () => false }), 60);
  check('不在史莱姆区块 → 白天一只敌对都不刷', outside.length === 0, `${outside.length} 只`);

  const inside: Spawned[] = [];
  runCycles(
    new MobSpawner(),
    makeContext({ ...bright, spawned: inside, inZone: (kind) => kind === 'slime_chunk' }),
    60,
  );
  check('在史莱姆区块里 → 白天也刷史莱姆（原版如此）', inside.some((s) => s.type.id === 'slime_big'), `${inside.length} 只`);
  check(
    '而且**只**刷史莱姆（光照那一条没被一起放开）',
    inside.length > 0 && inside.every((s) => s.type.id === 'slime_big'),
    [...new Set(inside.map((s) => s.type.id))].join(',') || '一只都没有',
  );
  check(
    `刷出来的都在 y ≤ ${SLIME_SPAWN_MAX_Y}（原版那条高度线）`,
    inside.every((s) => s.y <= SLIME_SPAWN_MAX_Y),
    [...new Set(inside.map((s) => s.y))].join(','),
  );
  check('中/小两档不会自然刷（它们只从分裂里出现）', inside.every((s) => s.type.id !== 'slime' && s.type.id !== 'slime_small'));
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

console.log('\n[维度与空腔（批次 94）]');
{
  // ① 主世界：恶魂写着 `dimension: 'nether'`，不管怎么刷都不该出现
  const overworld: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 5, block: 0, spawned: overworld }));
  check('主世界不刷恶魂', overworld.every((entry) => entry.type.id !== 'ghast'), overworld.map((e) => e.type.id).join(','));
  check('主世界仍然刷僵尸那些（对照组）', overworld.some((entry) => entry.type.id === 'zombie'));

  // ② 下界 + 默认地形（最高只有两格空）：恶魂 4×4 的身子放不下，一只都不该刷出来
  const tight: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 0, block: 0, dimension: 'nether', spawned: tight }));
  check(
    '下界里空间不够时刷不出恶魂（4×4 的身子会卡在岩层里）',
    tight.every((entry) => entry.type.id !== 'ghast'),
    tight.map((e) => e.type.id).join(','),
  );
  check('下界里也不刷主世界的生物（僵尸不会跑到下界来）', tight.every((entry) => entry.type.id !== 'zombie'));

  // ③ 下界 + 七格高的空腔：刷得出来，而且落点自带那片空腔
  const open: Spawned[] = [];
  runCycles(new MobSpawner(), makeContext({ sky: 0, block: 0, dimension: 'nether', airBox: true, spawned: open }));
  check('下界里有一片 4×4 空腔 → 刷得出恶魂', open.some((entry) => entry.type.id === 'ghast'), open.map((e) => e.type.id).join(','));
  // ⚠️ 下界自然刷的敌对生物一路在长：原本只有恶魂 → 批次 121 加了大岩浆怪 →
  // 批次 122 又加了僵尸猪灵。所以这条按**集合**断言（写死一只或两只都会过期）
  const netherKinds = [...new Set(open.map((entry) => entry.type.id))].sort();
  check('大岩浆怪确实会刷（批次 121 起下界的第二只）', open.some((entry) => entry.type.id === 'magma_cube_big'));
  check('僵尸猪灵也会刷（批次 122 起下界的第三只）', open.some((entry) => entry.type.id === 'zombie_piglin'));
  check(
    '下界里只刷下界那三只（主世界的怪一只都不来）',
    netherKinds.length > 0 &&
      netherKinds.every((id) => id === 'ghast' || id === 'magma_cube_big' || id === 'zombie_piglin'),
    netherKinds.join(','),
  );
}

console.log('\n[刷怪蛋（批次 174，J17）：每种生物一枚，创造专属]');
{
  /**
   * 三条口径：
   *  ① 蛋 ↔ 生物**一一对应**（少一枚 = "这只生物没有蛋"；多一枚 = "蛋生不出东西"）；
   *  ② 每枚蛋都能反查出生成哪种生物（`spawnEggMobOf` 是主程序右击时唯一用的那个函数）；
   *  ③ 每枚蛋的贴图都在图集名单里（漏一个就是图集里的紫黑方块）。
   */
  const eggMobs = new Set(SPAWN_EGG_SPECS.map((spec) => spec.mobId));
  const breedable = MOB_TYPES.filter((type) => !SPAWN_EGG_EXCLUDED.includes(type.id));
  check(
    '每只（可刷蛋的）生物都有一枚蛋',
    breedable.every((type) => eggMobs.has(type.id)),
    breedable.filter((type) => !eggMobs.has(type.id)).map((type) => type.id).join(','),
  );
  check(
    '每枚蛋都能对上一只真实存在的生物',
    [...eggMobs].every((mobId) => MOB_TYPES.some((type) => type.id === mobId)),
    [...eggMobs].filter((mobId) => !MOB_TYPES.some((type) => type.id === mobId)).join(','),
  );
  check(
    '尺寸变体与远程玩家被排除（史莱姆/岩浆怪只有一枚中号蛋，与原版一致）',
    SPAWN_EGG_EXCLUDED.every((id) => !eggMobs.has(id)) &&
      SPAWN_EGG_EXCLUDED.includes('slime_big') &&
      SPAWN_EGG_EXCLUDED.includes('remote_player'),
  );

  let roundTrip = true;
  let tileOk = true;
  let idOk = true;
  const seen = new Set<number>();
  for (const [index, spec] of SPAWN_EGG_SPECS.entries()) {
    const id = spawnEggItemId(index);
    if (seen.has(id)) idOk = false;
    seen.add(id);
    if (spawnEggMobOf(id) !== spec.mobId) roundTrip = false;
    const def = itemDef(id);
    if (!def || def.spawnEgg !== spec.mobId) roundTrip = false;
    if (!(TILE_ORDER as readonly string[]).includes(spawnEggTile(spec.mobId))) tileOk = false;
    if (itemLabel(id) !== `${spec.label}刷怪蛋`) roundTrip = false;
  }
  check('蛋的 id 两两不同', idOk);
  check('每枚蛋都能反查出生物、名字也由规格表给', roundTrip);
  check('每枚蛋的贴图都在图集名单里', tileOk);
  check('不是蛋的 id 查不出生物（防止越界读到别的蛋）', spawnEggMobOf(Item.DIAMOND) === undefined);
  check(
    '刷怪蛋都在创造物品栏里（创造模式拿得到才叫"蛋"）',
    SPAWN_EGG_SPECS.every((_spec, index) => CREATIVE_ITEMS.includes(spawnEggItemId(index))),
  );
  check(
    '刷怪蛋没有配方（原版也没有：给了配方就不叫创造专属了）',
    RECIPES.every((recipe) => !SPAWN_EGG_SPECS.some((_spec, index) => recipe.result.id === spawnEggItemId(index))),
  );
}

console.log(`\n生成测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
