/**
 * 钓鱼离线测试（批次 81，G11）
 *
 * 这一批做成的是**第一种"随机给东西"的玩法**（前面所有产物都是确定的配方），
 * 所以断言的重点在"随机分布"与"表里的每一项都站得住"：
 *  1. **物品与食物**：钓竿（耐久 64、附魔接线）+ 四种鱼 + 两种熟鱼；
 *     河豚的三条副作用逐项对齐原版；
 *  2. **附魔接线**：注册名必须是 `minicraft:fishing_rod`（附魔表按名字登记目标）、
 *     `SPECIAL_ITEMS` 让它能附魔、`enchantKindOf` 认得出；
 *  3. **战利品表**：三个池子（85/10/5）、池内权重、每一项都指向真东西、
 *     **海之眷顾只改池子不改池内**；
 *  4. **掷点分布**：用固定的 LCG 跑两万次，三个池子的占比逐条对上（±1%），
 *     并且运气 3 级时宝藏明显变多——"随机"必须有确定的接口，否则断言只能靠运气；
 *  5. **规则**：等待时间（100~600 tick、诱饵每级 −100、下限 20）、咬钩窗口 2 秒、
 *     抛竿速度方向、以及状态机的每一条转移；
 *  6. **配方与熔炼**：钓竿 = 3 木棍 + 2 线；两种鱼能烤、**热带鱼与河豚不能烤**。
 *
 * 运行：npm run test:fishing
 */

import { Block, blockDef } from '../web/src/core/registry/blocks.ts';
import { Item, categoryOf, durabilityOf, itemDef } from '../web/src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { foodForName } from '../web/src/core/registry/food.ts';
import { enchantKindOf, offeringFor } from '../web/src/core/crafting/Enchanting.ts';
import { matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import { smeltingRecipeFor } from '../web/src/core/crafting/Smelting.ts';
import {
  FISHING_POOLS,
  fishingEntryIds,
  poolWeightWithLuck,
  rollFishing,
} from '../web/src/core/registry/fishing.ts';
import {
  BITE_WINDOW_SECONDS,
  CAST_GRAVITY,
  CAST_SPEED,
  FLOOR_WAIT_TICKS,
  IDLE_FISHING,
  LURE_TICKS_PER_LEVEL,
  MAX_CAST_DISTANCE,
  MAX_WAIT_TICKS,
  MIN_WAIT_TICKS,
  advanceFishing,
  beginCast,
  castVelocity,
  fishingBonuses,
  reelFishing,
  waitSecondsFor,
} from '../web/src/core/survival/Fishing.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';

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

function near(label: string, actual: number, expected: number, tol = 1e-6): void {
  check(label, Math.abs(actual - expected) <= tol, `实际 ${actual}，期望约 ${expected}`);
}

/** 线性同余随机源：同一序列永远同一结果（统计断言既不飘也不假） */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 构造 size×size 的扁平网格，'·' 表示空 */
function grid(size: 2 | 3, rows: readonly string[], legend: Record<string, number>): number[] {
  const cells = new Array<number>(size * size).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (ch === '·') continue;
      cells[r * size + c] = legend[ch] ?? 0;
    }
  }
  return cells;
}

const TILES = new Set<string>(TILE_ORDER);
const FISH_ITEMS = [Item.COD, Item.SALMON, Item.TROPICAL_FISH, Item.COOKED_COD, Item.COOKED_SALMON];

// ---------------------------------------------------------------- 1. 物品与食物

console.log('\n[物品：钓竿与六种鱼]');
{
  const ids = [Item.FISHING_ROD, ...FISH_ITEMS];
  const contiguous = ids.every((id, index) => id === Item.FISHING_ROD + index);
  check('六个 id 连续（1436 起）', contiguous, ids.join(','));

  const registered = ids.filter((id) => itemDef(id) === undefined);
  check('六件都注册了', registered.length === 0, registered.join(','));

  // ⚠️ 注册名必须是 `minicraft:fishing_rod`：附魔表的 targets 是按这个名字登记的
  equal('钓竿的注册名是 minicraft:fishing_rod', itemDef(Item.FISHING_ROD)?.name, 'minicraft:fishing_rod');
  equal('钓竿不可堆叠', itemDef(Item.FISHING_ROD)?.maxStack, 1);
  equal('钓竿耐久 64（原版）', durabilityOf(Item.FISHING_ROD), 64);
  equal('钓竿归"工具"分类', categoryOf(Item.FISHING_ROD), 'tools');
  check('四种鱼与两种熟鱼都归"食物"分类', FISH_ITEMS.every((id) => categoryOf(id) === 'food'));
  equal('河豚也是食物（它以前只是酿造材料）', categoryOf(Item.PUFFERFISH), 'food');

  const unnamed = [Item.FISHING_ROD, ...FISH_ITEMS].filter((id) => itemLabel(id).includes('未知物品'));
  check('六件都有中文名', unnamed.length === 0, unnamed.join(','));
  const undescribed = [Item.FISHING_ROD, ...FISH_ITEMS].filter((id) => !hasDescription(id));
  check('六件都有说明', undescribed.length === 0, undescribed.join(','));

  const missingTiles = [Item.FISHING_ROD, ...FISH_ITEMS].filter((id) => {
    const tile = itemDef(id)?.tile;
    return tile === undefined || !TILES.has(tile);
  });
  check('六张图标都在图集名单里', missingTiles.length === 0, missingTiles.join(','));
}

console.log('\n[食物数值：与 wiki 对齐]');
{
  const table: readonly (readonly [string, number, number])[] = [
    ['fishing_rod', 0, 0],
    ['cod', 2, 0.1],
    ['salmon', 2, 0.1],
    ['tropical_fish', 1, 0.1],
    ['pufferfish', 1, 0.1],
    ['cooked_cod', 5, 0.6],
    ['cooked_salmon', 6, 0.8],
  ];
  for (const [name, hunger, modifier] of table.slice(1)) {
    const info = foodForName(name);
    check(`${name}：${hunger} 饥饿 / 修饰值 ${modifier}`, info?.hunger === hunger && info?.saturationModifier === modifier, JSON.stringify(info ?? null));
  }
  check('钓竿不是食物', foodForName('fishing_rod') === undefined);

  // 河豚：三条效果**必定触发**（没有 chance 字段），等级按原版
  const puffer = foodForName('pufferfish')!;
  const effects = puffer.effects ?? [];
  equal('河豚有三条效果', effects.length, 3);
  const byId = new Map(effects.map((effect) => [effect.id, effect]));
  equal('剧毒 II 60 秒', `${byId.get('poison')?.amplifier},${byId.get('poison')?.seconds}`, '1,60');
  equal('饥饿 III 15 秒', `${byId.get('hunger')?.amplifier},${byId.get('hunger')?.seconds}`, '2,15');
  equal('反胃 II 15 秒', `${byId.get('nausea')?.amplifier},${byId.get('nausea')?.seconds}`, '1,15');
  check('三条都必定触发（不像腐肉那样掷概率）', effects.every((effect) => effect.chance === undefined));
  check('熟鱼没有任何副作用', (foodForName('cooked_cod')?.effects ?? []).length === 0);
}

// ---------------------------------------------------------------- 2. 附魔接线

console.log('\n[附魔：钓竿必须能被附到诱饵与海之眷顾]');
{
  equal('enchantKindOf 认得出钓竿', enchantKindOf(Item.FISHING_ROD), 'fishing_rod');
  const offerings = offeringFor('fishing_rod').map((def) => def.id);
  check('附魔台能给钓竿出"诱饵"', offerings.includes('lure'), offerings.join(','));
  check('附魔台能给钓竿出"海之眷顾"', offerings.includes('luck_of_the_sea'));
  check('钓竿也能附耐久', offerings.includes('unbreaking'));
  check('钓竿附不到剑的附魔（锋利不在候选里）', !offerings.includes('sharpness'));
  check('石头这类没有耐久的方块物品附不了魔', enchantKindOf(Block.STONE) === null);
  // 这两条附魔以前只是"登记了但没效果"，批次 81 接线之后要在表里标成已实现
  const implemented = new Set(offeringFor('fishing_rod').filter((def) => def.implemented === true).map((def) => def.id));
  check('诱饵已标记"效果已接线"', implemented.has('lure'));
  check('海之眷顾已标记"效果已接线"', implemented.has('luck_of_the_sea'));
}

// ---------------------------------------------------------------- 3. 战利品表

console.log('\n[战利品表：三个池子]');
{
  equal('三个池子', FISHING_POOLS.length, 3);
  equal('池子顺序是 鱼 / 杂物 / 宝藏', FISHING_POOLS.map((pool) => pool.key).join(','), 'fish,junk,treasure');
  equal('基准权重 85 / 10 / 5', FISHING_POOLS.map((pool) => pool.weight).join(','), '85,10,5');

  const fishPool = FISHING_POOLS.find((pool) => pool.key === 'fish')!;
  equal('鱼池四条的权重 60/25/13/2（原版）', fishPool.entries.map((entry) => entry.weight).join(','), '60,25,13,2');
  equal('鱼池顺序 鳕鱼/鲑鱼/河豚/热带鱼', fishPool.entries.map((entry) => entry.id).join(','), [Item.COD, Item.SALMON, Item.PUFFERFISH, Item.TROPICAL_FISH].join(','));

  // 每一项都必须指向真的存在的东西（"表里指向空气"是历史坑）
  const broken = fishingEntryIds().filter((id) => itemDef(id) === undefined && blockDef(id).id !== id);
  check('表里每一项都指向已注册的物品/方块', broken.length === 0, broken.join(','));
  const zeroCounts = FISHING_POOLS.flatMap((pool) => pool.entries).filter((entry) => entry.min < 1 || entry.max < entry.min);
  check('每一项的数量区间合法（至少 1 个）', zeroCounts.length === 0, JSON.stringify(zeroCounts));

  const bookEntries = FISHING_POOLS.flatMap((pool) => pool.entries).filter((entry) => entry.enchantedBook === true);
  equal('只有宝藏池里那本书是"附魔书"', `${bookEntries.length},${bookEntries[0]?.id}`, `${1},${Item.BOOK}`);
  const treasure = FISHING_POOLS.find((pool) => pool.key === 'treasure')!;
  equal(
    '宝藏池五项：弓 / 附魔书 / 钓竿 / 命名牌 / 鹦鹉螺壳（批次 615 补命名牌）',
    treasure.entries.map((entry) => entry.id).join(','),
    [Item.BOW, Item.BOOK, Item.FISHING_ROD, Item.NAME_TAG, Item.NAUTILUS_SHELL].join(','),
  );
  check('杂物池里有睡莲与绊线钩（原版 junk 的招牌）', treasure !== undefined && fishingEntryIds().includes(Block.LILY_PAD) && fishingEntryIds().includes(Block.TRIPWIRE_HOOK));
}

console.log('\n[海之眷顾：只改池子，不改池内]');
{
  const junk = FISHING_POOLS.find((pool) => pool.key === 'junk')!;
  const treasure = FISHING_POOLS.find((pool) => pool.key === 'treasure')!;
  const fish = FISHING_POOLS.find((pool) => pool.key === 'fish')!;
  near('0 级：杂物还是 10', poolWeightWithLuck(junk, 0), 10);
  near('3 级：杂物降到 2.5', poolWeightWithLuck(junk, 3), 2.5);
  near('3 级：宝藏涨到 12.5', poolWeightWithLuck(treasure, 3), 12.5);
  near('3 级：鱼不变', poolWeightWithLuck(fish, 3), 85);
  near('10 级也不会把杂物压成负数', poolWeightWithLuck(junk, 10), 0);

  // 池内权重与运气无关：把"钓到的鱼种分布"钉住
  const rolls = lcg(7);
  const counts = new Map<number, number>();
  for (let i = 0; i < 4000; i++) {
    const caught = rollFishing(rolls, 0);
    counts.set(caught.id, (counts.get(caught.id) ?? 0) + 1);
  }
  const codShare = (counts.get(Item.COD) ?? 0) / 4000;
  // 鱼池占 85%，池内鳕鱼 60% → 期望 51%
  check('鳕鱼占比约 51%（= 85% × 60%）', Math.abs(codShare - 0.51) < 0.03, codShare.toFixed(3));
}

console.log('\n[掷点：三个池子的真实占比]');
{
  const rolls = lcg(20261016);
  const totals = { fish: 0, junk: 0, treasure: 0 };
  const runs = 20000;
  for (let i = 0; i < runs; i++) totals[rollFishing(rolls, 0).pool]++;
  const share = (key: keyof typeof totals): number => totals[key] / runs;
  check(`鱼约 85%（实测 ${(share('fish') * 100).toFixed(1)}%）`, Math.abs(share('fish') - 0.85) < 0.01);
  check(`杂物约 10%（实测 ${(share('junk') * 100).toFixed(1)}%）`, Math.abs(share('junk') - 0.1) < 0.01);
  check(`宝藏约 5%（实测 ${(share('treasure') * 100).toFixed(1)}%）`, Math.abs(share('treasure') - 0.05) < 0.01);

  // 3 级运气：宝藏明显变多、杂物明显变少（wiki 那条 ±2.5% / 级）
  const lucky = lcg(20261016);
  const luckyTotals = { fish: 0, junk: 0, treasure: 0 };
  for (let i = 0; i < runs; i++) luckyTotals[rollFishing(lucky, 3).pool]++;
  const luckyShare = (key: keyof typeof luckyTotals): number => luckyTotals[key] / runs;
  check(`3 级运气：宝藏约 12.5%（实测 ${(luckyShare('treasure') * 100).toFixed(1)}%）`, Math.abs(luckyShare('treasure') - 0.125) < 0.012);
  check(`3 级运气：杂物约 2.5%（实测 ${(luckyShare('junk') * 100).toFixed(1)}%）`, Math.abs(luckyShare('junk') - 0.025) < 0.012);
  check('3 级运气：鱼的比例几乎没变（附魔只挪池子）', Math.abs(luckyShare('fish') - 0.85) < 0.02);

  // 固定随机源的两条边界：掷 0 一定是鱼池第一条，掷到最大一定是宝藏池
  // 池子的顺序是 鱼(85) / 杂物(10) / 宝藏(5)，所以 0.87 → 落在杂物那一段
  equal('随机数 0 → 鳕鱼', rollFishing(() => 0, 0).id, Item.COD);
  equal('随机数 0.87 → 杂物池', rollFishing(() => 0.87, 0).pool, 'junk');
  equal('随机数 0.96 → 宝藏池', rollFishing(() => 0.96, 0).pool, 'treasure');
  equal('随机数 0.9999 → 宝藏池', rollFishing(() => 0.9999, 0).pool, 'treasure');
  // 3 级运气：杂物被压到 2.5、宝藏涨到 12.5，所以 85~87.5 是杂物、87.5 之后是宝藏
  equal('运气 3 且随机数 0.84 → 鱼池', rollFishing(() => 0.84, 3).pool, 'fish');
  equal('运气 3 且随机数 0.87 → 杂物池（那一段被压窄了）', rollFishing(() => 0.87, 3).pool, 'junk');
  equal('运气 3 且随机数 0.92 → 宝藏池（这一段被加宽了）', rollFishing(() => 0.92, 3).pool, 'treasure');
}

// ---------------------------------------------------------------- 4. 规则

console.log('\n[等待时间：100~600 tick、诱饵每级 −5 秒]');
{
  equal('下限常量 100 tick', MIN_WAIT_TICKS, 100);
  equal('上限常量 600 tick', MAX_WAIT_TICKS, 600);
  near('随机数 0 → 最短 5 秒', waitSecondsFor(() => 0, 0), 5);
  near('随机数 0.999 → 最长约 30 秒', waitSecondsFor(() => 0.999, 0), 30, 0.06);
  near('诱饵 I 级：−5 秒', waitSecondsFor(() => 0.999, 1), 25, 0.06);
  near('诱饵 III 级：−15 秒', waitSecondsFor(() => 0.999, 3), 15, 0.06);
  near('诱饵 III 级 + 最短等待：压到 1 秒下限', waitSecondsFor(() => 0, 3), FLOOR_WAIT_TICKS / 20);
  near('诱饵等级非法（负数）按 0 算', waitSecondsFor(() => 0.5, -2), 17.55, 0.06);
  equal('诱饵每级减 100 tick', LURE_TICKS_PER_LEVEL, 100);
}

console.log('\n[抛竿与状态机]');
{
  near('咬钩窗口 2 秒', BITE_WINDOW_SECONDS, 2);
  equal('浮标初速与投掷物一致（30 格/秒）', CAST_SPEED, 30);
  equal('浮标重力与投掷物一致（12 格/秒²）', CAST_GRAVITY, 12);
  equal('最远飞 33 格', MAX_CAST_DISTANCE, 33);

  // 朝向：yaw 0 = 看向北（-Z）
  const level = castVelocity(0, 0);
  near('朝北平视：水平速度 -30 格/秒', level.z, -CAST_SPEED);
  near('朝北平视：竖直速度为 0', level.y, 0);
  const up = castVelocity(0, Math.PI / 2);
  near('抬头 90°：竖直速度 30', up.y, CAST_SPEED);
  const east = castVelocity(-Math.PI / 2, 0);
  near('朝东平视：x 速度 +30', east.x, CAST_SPEED);
  const west = castVelocity(Math.PI / 2, 0);
  near('朝西平视：x 速度 -30', west.x, -CAST_SPEED);

  // 状态机
  const cast = beginCast(() => 0, 0);
  equal('抛竿后是 flying', cast.phase, 'flying');
  near('这一竿要等 5 秒（随机数 0）', cast.waitFor, 5);

  equal('还在飞（没碰到东西）→ 继续飞', advanceFishing(cast, 0.05, null).phase, 'flying');
  equal('撞到岸上 → 直接收回来', advanceFishing(cast, 0.05, 'blocked').phase, 'idle');
  const inWater = advanceFishing(cast, 0.05, 'water');
  equal('落水 → 进入等待', inWater.phase, 'waiting');
  near('等待时间带过来', inWater.waitFor, 5);

  const stillWaiting = advanceFishing(inWater, 1, null);
  equal('等 1 秒还没咬钩', stillWaiting.phase, 'waiting');
  const biting = advanceFishing({ ...inWater, timer: 4.9 }, 0.2, null);
  equal('等够了 → 咬钩', biting.phase, 'biting');
  near('咬钩计时从 0 开始', biting.timer, 0);

  equal('窗口内收杆：钓上来了', reelFishing(biting).caught, true);
  equal('收杆之后回到 idle', reelFishing(biting).next.phase, 'idle');
  equal('等太久（超过 2 秒）→ 鱼跑了', advanceFishing({ ...biting, timer: 1.9 }, 0.2, null).phase, 'idle');
  equal('没咬钩就收杆：空手而归', reelFishing(stillWaiting).caught, false);
  equal('idle 收杆也不会钓到东西', reelFishing(IDLE_FISHING).caught, false);
  equal('idle 状态怎么推都不动', advanceFishing(IDLE_FISHING, 1, 'water').phase, 'idle');

  // 附魔读取
  const bonuses = fishingBonuses({ lure: 2, luck_of_the_sea: 3 });
  equal('诱饵等级读得出来', bonuses.lure, 2);
  equal('海之眷顾等级读得出来', bonuses.luck, 3);
  equal('没附魔时都是 0', `${fishingBonuses(undefined).lure},${fishingBonuses(undefined).luck}`, '0,0');
  equal('非法值（负数）当 0', `${fishingBonuses({ lure: -1 }).lure}`, '0');
  equal('其他附魔不影响钓鱼', `${fishingBonuses({ sharpness: 5 }).lure},${fishingBonuses({ sharpness: 5 }).luck}`, '0,0');
}

// ---------------------------------------------------------------- 5. 配方与熔炼

console.log('\n[配方：3 木棍 + 2 线]');
{
  const rod = grid(3, ['··S', '·S#', 'S·#'], { S: Item.STICK, '#': Item.STRING });
  equal('3 木棍 + 2 线 → 1 根钓竿', matchRecipe(rod, 3)?.id, Item.FISHING_ROD);
  equal('数量 1', matchRecipe(rod, 3)?.count, 1);

  const noString = grid(3, ['··S', '·S·', 'S··'], { S: Item.STICK, '#': Item.STRING });
  check('只有木棍 → 合不出钓竿', matchRecipe(noString, 3)?.id !== Item.FISHING_ROD);
  const wrongLine = grid(3, ['··S', '·S#', 'S·#'], { S: Item.STICK, '#': Item.LEATHER });
  check('用皮革代替线 → 合不出钓竿', matchRecipe(wrongLine, 3)?.id !== Item.FISHING_ROD);
}

console.log('\n[熔炼：两种鱼能烤，热带鱼与河豚不能]');
{
  const cod = smeltingRecipeFor(Item.COD);
  equal('生鳕鱼 → 熟鳕鱼', cod?.output.id, Item.COOKED_COD);
  equal('归"食物"（烟熏炉能做）', cod?.kind, 'food');
  const salmon = smeltingRecipeFor(Item.SALMON);
  equal('生鲑鱼 → 熟鲑鱼', salmon?.output.id, Item.COOKED_SALMON);
  equal('烟熏炉里也能烤鲑鱼', smeltingRecipeFor(Item.SALMON, 'smoker')?.output.id, Item.COOKED_SALMON);
  check('热带鱼**不能**烤（原版也没有熟热带鱼）', smeltingRecipeFor(Item.TROPICAL_FISH) === undefined);
  check('河豚**不能**烤', smeltingRecipeFor(Item.PUFFERFISH) === undefined);
  check('熟鱼不能再烤一次（不循环）', smeltingRecipeFor(Item.COOKED_COD) === undefined);
}

console.log(`\n钓鱼测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
