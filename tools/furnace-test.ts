/**
 * 熔炉与箱子的离线测试
 *
 * 运行：npm run test:furnace
 */

import { Block } from '../src/core/registry/blocks.ts';
import { Item } from '../src/core/registry/items.ts';
import { Furnace, FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT } from '../src/core/container/Furnace.ts';
import { Chest, CHEST_SIZE } from '../src/core/container/Chest.ts';
import { fuelSeconds, smeltingRecipeFor, SMELTING_TIME } from '../src/core/crafting/Smelting.ts';

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

/** 推进 n 秒，按 0.05 秒步长模拟真实帧循环 */
function advance(furnace: Furnace, seconds: number): void {
  const step = 0.05;
  for (let t = 0; t < seconds; t += step) furnace.tick(step);
}

console.log('\n[配方与燃料表]');
equal('沙 → 玻璃', smeltingRecipeFor(Block.SAND)?.output.id, Block.GLASS);
equal('圆石 → 石头', smeltingRecipeFor(Block.COBBLESTONE)?.output.id, Block.STONE);
equal('原木 → 木炭', smeltingRecipeFor(Block.OAK_LOG)?.output.id, Item.CHARCOAL);
equal('粗铁 → 铁锭', smeltingRecipeFor(Item.RAW_IRON)?.output.id, Item.IRON_INGOT);
equal('烧炼耗时 10 秒', SMELTING_TIME, 10);
equal('煤炭可燃 80 秒', fuelSeconds(Item.COAL), 80);
equal('木棍可燃 5 秒', fuelSeconds(Item.STICK), 5);
equal('木板可燃 15 秒', fuelSeconds(Block.OAK_PLANKS), 15);
equal('石头不能当燃料', fuelSeconds(Block.STONE), 0);
equal('石头没有烧炼配方', smeltingRecipeFor(Block.STONE), undefined);

console.log('\n[熔炉：空炉不工作]');
{
  const furnace = new Furnace();
  advance(furnace, 5);
  check('空炉不燃烧', !furnace.isLit);
  equal('空炉进度为 0', furnace.cookProgress, 0);
}

console.log('\n[熔炉：完整烧炼一次]');
{
  const furnace = new Furnace();
  furnace.set(FURNACE_INPUT, { id: Item.RAW_IRON, count: 3 });
  furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });

  furnace.tick(0.05);
  check('点火成功', furnace.isLit);
  equal('燃烧总时长 80 秒', furnace.burnTimeTotal, 80);

  advance(furnace, 5);
  check('烧炼进行中（进度约 5 秒）', Math.abs(furnace.cookProgress - 5) < 0.3, `实际 ${furnace.cookProgress.toFixed(2)}`);
  equal('产物槽仍为空', furnace.get(FURNACE_OUTPUT), null);

  advance(furnace, 5.2);
  equal('10 秒后产出铁锭', furnace.get(FURNACE_OUTPUT)?.id, Item.IRON_INGOT);
  equal('原料减少到 2 个', furnace.get(FURNACE_INPUT)?.count, 2);
  // 10 秒时产出并清零，之后立刻接着烧下一个，所以此刻进度是"新一次"的起始值
  check('产出后进度重新开始计时', furnace.cookProgress < 0.5, `实际 ${furnace.cookProgress.toFixed(2)}`);
  check('累计了经验', furnace.storedExperience > 0.6);

  // 再烧一次
  advance(furnace, 10.2);
  equal('第二次产出叠加到同一槽', furnace.get(FURNACE_OUTPUT)?.count, 2);
  equal('原料剩 1 个', furnace.get(FURNACE_INPUT)?.count, 1);
}

console.log('\n[熔炉：燃料耗尽后停止]');
{
  const furnace = new Furnace();
  furnace.set(FURNACE_INPUT, { id: Block.SAND, count: 64 });
  furnace.set(FURNACE_FUEL, { id: Item.STICK, count: 1 }); // 只够 5 秒，烧不完一次

  advance(furnace, 6);
  check('木棍烧完后熄灭', !furnace.isLit);
  equal('没烧满 10 秒所以没有产物', furnace.get(FURNACE_OUTPUT), null);
  check('进度开始回退', furnace.cookProgress < 5, `实际 ${furnace.cookProgress.toFixed(2)}`);

  advance(furnace, 7);
  equal('进度回退到 0', furnace.cookProgress, 0);

  // 补燃料后继续
  furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
  advance(furnace, 10.5);
  equal('补燃料后能烧出玻璃', furnace.get(FURNACE_OUTPUT)?.id, Block.GLASS);
}

console.log('\n[熔炉：一个煤炭能烧 8 次]');
{
  const furnace = new Furnace();
  furnace.set(FURNACE_INPUT, { id: Item.RAW_COPPER, count: 8 });
  furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
  advance(furnace, 80.5);
  equal('产出 8 个铜锭', furnace.get(FURNACE_OUTPUT)?.count, 8);
  equal('煤炭已耗尽', furnace.get(FURNACE_FUEL), null);
  check('燃料耗尽后熄灭', !furnace.isLit);
}

console.log('\n[熔炉：产物槽满/异类时不再烧炼]');
{
  const furnace = new Furnace();
  furnace.set(FURNACE_INPUT, { id: Block.SAND, count: 4 });
  furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
  furnace.set(FURNACE_OUTPUT, { id: Block.STONE, count: 1 }); // 异类产物占位

  advance(furnace, 12);
  check('产物槽被异类占用时不点火', !furnace.isLit);
  equal('没有产出', furnace.get(FURNACE_OUTPUT)?.id, Block.STONE);

  // 清空后恢复正常
  furnace.set(FURNACE_OUTPUT, null);
  advance(furnace, 10.5);
  equal('清空产物槽后能正常烧出玻璃', furnace.get(FURNACE_OUTPUT)?.id, Block.GLASS);
}

console.log('\n[熔炉：原料不足时进度回退]');
{
  const furnace = new Furnace();
  furnace.set(FURNACE_INPUT, { id: Item.RAW_GOLD, count: 1 });
  furnace.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
  advance(furnace, 6);
  check('已烧到一半以上', furnace.cookProgress > 5);

  furnace.set(FURNACE_INPUT, null);
  advance(furnace, 4);
  equal('原料撤走后进度归零', furnace.cookProgress, 0);
  check('仍然在燃烧（燃料还在）', furnace.isLit);
}

console.log('\n[箱子]');
{
  const chest = new Chest();
  equal('箱子 27 格', CHEST_SIZE, 27);

  equal('放入 64 个石头无剩余', chest.add(Block.STONE, 64), 0);
  equal('再放 10 个溢到下一格', chest.add(Block.STONE, 10), 0);
  equal('0 号格 64 个', chest.get(0)?.count, 64);
  equal('1 号格 10 个', chest.get(1)?.count, 10);

  chest.set(0, null);
  equal('清空 0 号格后 entries 只剩一条', chest.entries().length, 1);
  check('箱子非空', !chest.isEmpty);

  const chest2 = new Chest();
  check('新箱子为空', chest2.isEmpty);
  equal('27 格全部填满后仍放不下', chest2.add(Block.DIRT, 27 * 64 + 5), 5);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
