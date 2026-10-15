/**
 * 经验值与等级离线测试（I5）
 *
 * 覆盖五块：
 *  1. 升级公式：原版那条三段线性函数（2L+7 / 5L-38 / 9L-158），
 *     并用"到 30 级共需 1395 点"这个众所周知的数当交叉验证
 *  2. 进账：进位、一次连升多级（打死末影龙）、熔炼小数经验攒整、非法输入
 *  3. 消耗与清零：`consumeLevels` 不够时一点都不扣、死亡清零
 *  4. 经验来源：7 种生物的击杀经验、挖矿经验表（含"铁矿不给经验"）、熔炉取出
 *  5. 存档往返
 *
 * 运行：npm run test:xp
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Experience, blockXpRange, rollBlockXp, totalXpForLevel, xpToNext } from '../src/core/survival/Experience.ts';
import { MOB_TYPES } from '../src/core/entity/mobs.ts';
import { DRAGON_TYPE, ENDER_DRAGON_XP } from '../src/core/entity/EndBoss.ts';
import { FURNACE_OUTPUT, Furnace } from '../src/core/container/Furnace.ts';
import { Item } from '../src/core/registry/items.ts';

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

// ---------------------------------------------------------------- 1. 升级公式

console.log('\n[升级公式：原版三段线性]');
equal('0 级 → 7 点', xpToNext(0), 7);
equal('1 级 → 9 点', xpToNext(1), 9);
equal('15 级 → 37 点（第一段末）', xpToNext(15), 37);
equal('16 级 → 42 点（换第二段，比 15 级贵得慢一点）', xpToNext(16), 42);
equal('30 级 → 112 点（第二段末）', xpToNext(30), 112);
equal('31 级 → 121 点（换第三段）', xpToNext(31), 121);
check('曲线单调递增', Array.from({ length: 120 }, (_, l) => xpToNext(l)).every((v, i, arr) => i === 0 || v > arr[i - 1]!));

// 交叉验证：原版"从 0 级练到 30 级"共需 1395 点，这个数是社区里众所周知的
equal('练到 30 级共需 1395 点（交叉验证整条曲线）', totalXpForLevel(30), 1395);
equal('练到 1 级只要 7 点', totalXpForLevel(1), 7);

// ---------------------------------------------------------------- 2. 进账

console.log('\n[经验进账]');
{
  const xp = new Experience();
  equal('初始 0 级 0 点', xp.level, 0);
  equal('加 6 点还升不了级', xp.add(6), 6);
  equal('进度攒到 6', xp.progress, 6);
  equal('再加 1 点正好升到 1 级', (xp.add(1), xp.level), 1);
  equal('升级后进度归到 0', xp.progress, 0);
  equal('累计值记录总数', xp.total, 7);

  // 打死末影龙：12000 点要一次连升好多级
  const dragon = new Experience();
  dragon.add(ENDER_DRAGON_XP);
  check('一次给 12000 点能连升多级（不是只升一级）', dragon.level > 20, String(dragon.level));
  check('等级不会超过 12000 点对应的档位', totalXpForLevel(dragon.level) <= ENDER_DRAGON_XP);

  // 熔炼经验是小数：原版攒够 1 点才吐一颗经验球
  const smelt = new Experience();
  equal('0.35 点先攒着，不进账', smelt.add(0.35), 0);
  equal('攒到 0.7 还是不够', smelt.add(0.35), 0);
  equal('攒满 1 点才进账', smelt.add(0.35), 1);
  equal('进账后 progress 是 1', smelt.progress, 1);
  check('浮点误差不会让 0.1+0.2 变成 0.30000000000000004 那种脏数', new Experience().add(0.1 + 0.2) === 0);

  const guard = new Experience();
  equal('0 点不加', guard.add(0), 0);
  equal('负数不加', guard.add(-5), 0);
  equal('NaN 不加', guard.add(Number.NaN), 0);
  equal('Infinity 不加', guard.add(Number.POSITIVE_INFINITY), 0);
  equal('guard 一点经验都没有', guard.total, 0);
}

// ---------------------------------------------------------------- 3. 消耗与清零

console.log('\n[消耗与清零]');
{
  const xp = new Experience();
  xp.add(1395);
  equal('1395 点正好 30 级', xp.level, 30);

  check('扣 3 级成功', xp.consumeLevels(3));
  equal('等级变成 27', xp.level, 27);
  check('等级不够时返回 false', !xp.consumeLevels(999));
  equal('失败时一点都不扣', xp.level, 27);
  check('扣 0 级视为成功', xp.consumeLevels(0));

  xp.reset();
  equal('死亡清零：等级归零', xp.level, 0);
  equal('死亡清零：进度归零', xp.progress, 0);
  equal('死亡清零：累计值保留（那是"赚过多少"，不是"现有多少"）', xp.total, 1395);
  equal('死亡后再加 7 点又是 1 级', (xp.add(7), xp.level), 1);
}

// ---------------------------------------------------------------- 4. 经验来源

console.log('\n[来源一：击杀生物]');
{
  const expected: Record<string, number> = { zombie: 5, skeleton: 5, creeper: 5, cow: 3, pig: 3, sheep: 3, chicken: 3 };
  for (const [id, value] of Object.entries(expected)) {
    const type = MOB_TYPES.find((mob) => mob.id === id);
    check(`生物表里有 ${id}`, type !== undefined);
    equal(`${id} 的击杀经验是 ${value}`, type?.xp, value);
  }
  equal('末影龙 12000 点（原版数值）', DRAGON_TYPE.xp, ENDER_DRAGON_XP);
  check('每种生物都填了 xp（漏填会是 undefined）', MOB_TYPES.every((mob) => typeof mob.xp === 'number' && mob.xp >= 0));
}

console.log('\n[来源二：挖矿]');
{
  equal('煤矿 0~2：掷点 0 至少 0', rollBlockXp(Block.COAL_ORE, 0), 0);
  equal('煤矿 0~2：掷点 0.99 拿到 2', rollBlockXp(Block.COAL_ORE, 0.99), 2);
  equal('钻石矿 3~7：掷点 0 拿到 3', rollBlockXp(Block.DIAMOND_ORE, 0), 3);
  equal('钻石矿 3~7：掷点 0.99 拿到 7', rollBlockXp(Block.DIAMOND_ORE, 0.99), 7);
  equal('深板岩钻石矿同值', blockXpRange(Block.DEEPSLATE_DIAMOND_ORE)?.[1], 7);
  equal('青金石 2~5', rollBlockXp(Block.LAPIS_ORE, 0), 2);
  // 2~5 是四个取值：掷点 0.5 落在第 3 个（2 + ⌊0.5×4⌋ = 4）
  equal('下界石英 2~5', rollBlockXp(Block.NETHER_QUARTZ_ORE, 0.5), 4);
  // 原版铁/铜/金矿不给经验（经验来自熔炼粗矿）
  equal('铁矿不给经验', rollBlockXp(Block.IRON_ORE, 0.5), 0);
  equal('金矿不给经验', rollBlockXp(Block.GOLD_ORE, 0.5), 0);
  equal('石头不给经验', rollBlockXp(Block.STONE, 0.5), 0);
  equal('挖空气不给经验', rollBlockXp(Block.AIR, 0.5), 0);
}

console.log('\n[来源三：熔炉取出产物]');
{
  const furnace = new Furnace();
  equal('新熔炉攒了 0 点', furnace.storedExperience, 0);
  // 直接塞一次产物：走的是"产出时累加经验"那条路（配方经验 0.7）
  furnace.set(FURNACE_OUTPUT, { id: Item.IRON_INGOT, count: 1 });
  furnace.storedExperience = 0.7;
  equal('取走攒下的 0.7 点', furnace.takeExperience(), 0.7);
  equal('取走后清零（不会重复给）', furnace.storedExperience, 0);
  equal('再取一次是 0', furnace.takeExperience(), 0);
}

// ---------------------------------------------------------------- 5. 存档

console.log('\n[存档往返]');
{
  const xp = new Experience();
  xp.add(1395);
  xp.add(0.4);
  const restored = new Experience();
  restored.restore(xp.serialize());
  equal('等级还原', restored.level, xp.level);
  equal('进度还原', restored.progress, xp.progress);
  equal('累计还原', restored.total, xp.total);
  equal('小数余数还原（否则读档后攒了一半的经验会丢）', restored.add(0.6), 1);

  const legacy = new Experience();
  legacy.restore(undefined);
  equal('旧存档（没有 xp 字段）视为 0 级', legacy.level, 0);
  legacy.restore({ level: -5, progress: -3 });
  equal('负数等级被夹到 0', legacy.level, 0);
}

console.log(`\n经验测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
