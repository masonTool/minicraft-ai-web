/**
 * 熔炉与箱子的离线测试
 *
 * 运行：npm run test:furnace
 */

import { Block, blockDef, blockHardness } from '../src/core/registry/blocks.ts';
import { CREATIVE_ITEMS, Item, categoryOf } from '../src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../src/core/registry/itemNames.ts';
import { harvestRequirement } from '../src/core/registry/tools.ts';
import { Furnace, FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT } from '../src/core/container/Furnace.ts';
import { Chest, CHEST_SIZE } from '../src/core/container/Chest.ts';
import {
  FURNACE_STATIONS,
  cookSeconds,
  fuelSeconds,
  smeltingRecipeFor,
  stationOfBlock,
  stationRejectReason,
  SMELTING_TIME,
} from '../src/core/crafting/Smelting.ts';
import { RECIPES, matchRecipe } from '../src/core/crafting/Recipes.ts';
import { TILE_ORDER } from '../src/render/atlasLayout.ts';
import { BlockEntityStore } from '../src/core/world/BlockEntityStore.ts';
import { restoreContainers, serializeContainers } from '../src/core/save/ContainerSave.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';

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

/** 构造 size×size 的扁平网格，'·' 表示空（合成配方断言用） */
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

// ---------------------------------------------------------------- 烟熏炉与高炉（批次 46）

console.log('\n[三种炉子：站台与它吃的东西]');
{
  // 方块 → 站台（这一份映射同时给"右键打开"与"读档自愈"用）
  equal('熔炉 → furnace', stationOfBlock(Block.FURNACE), 'furnace');
  equal('烟熏炉 → smoker', stationOfBlock(Block.SMOKER), 'smoker');
  equal('高炉 → blast_furnace', stationOfBlock(Block.BLAST_FURNACE), 'blast_furnace');
  equal('石头不是炉子', stationOfBlock(Block.STONE), null);

  // 接受集合：烟熏炉只吃食物、高炉只吃矿物与金属、熔炉什么都吃
  check('烟熏炉能烧生牛肉', smeltingRecipeFor(Item.BEEF, 'smoker') !== undefined);
  equal('烟熏炉不吃粗铁', smeltingRecipeFor(Item.RAW_IRON, 'smoker'), undefined);
  equal('烟熏炉不吃沙子', smeltingRecipeFor(Block.SAND, 'smoker'), undefined);
  equal('烟熏炉不吃圆石', smeltingRecipeFor(Block.COBBLESTONE, 'smoker'), undefined);
  check('高炉能烧粗铁', smeltingRecipeFor(Item.RAW_IRON, 'blast_furnace') !== undefined);
  check('高炉能烧远古残骸（原版最有用的一条）', smeltingRecipeFor(Block.ANCIENT_DEBRIS, 'blast_furnace') !== undefined);
  equal('高炉不吃生牛肉', smeltingRecipeFor(Item.BEEF, 'blast_furnace'), undefined);
  equal('高炉不吃沙子（玻璃是熔炉的活）', smeltingRecipeFor(Block.SAND, 'blast_furnace'), undefined);
  equal('高炉不吃圆石', smeltingRecipeFor(Block.COBBLESTONE, 'blast_furnace'), undefined);
  check('熔炉什么都吃（回归）', smeltingRecipeFor(Block.SAND, 'furnace') !== undefined && smeltingRecipeFor(Item.BEEF) !== undefined);
  // 省略站台 = 普通熔炉（旧的那些调用处一个字没改，这条就是保证）
  equal('不传站台时按普通熔炉处理', smeltingRecipeFor(Block.SAND)?.output.id, Block.GLASS);

  // 速度：烟熏炉与高炉 2 倍速
  equal('熔炉 10 秒', cookSeconds(smeltingRecipeFor(Item.BEEF)!, 'furnace'), 10);
  equal('烟熏炉 5 秒', cookSeconds(smeltingRecipeFor(Item.BEEF, 'smoker')!, 'smoker'), 5);
  equal('高炉 5 秒', cookSeconds(smeltingRecipeFor(Item.RAW_IRON, 'blast_furnace')!, 'blast_furnace'), 5);
  equal('三座炉子的中文名', `${FURNACE_STATIONS.furnace.cn}/${FURNACE_STATIONS.smoker.cn}/${FURNACE_STATIONS.blast_furnace.cn}`, '熔炉/烟熏炉/高炉');

  // 拒绝原因要说人话（界面提示直接显示它）
  check('烟熏炉拒绝粗铁时说明了"只烧食物"', stationRejectReason(Item.RAW_IRON, 'smoker').includes('只烧食物'));
  check('高炉拒绝沙子时说明了"只烧矿物"', stationRejectReason(Block.SAND, 'blast_furnace').includes('只烧矿物'));
  equal('能烧的时候没有意见', stationRejectReason(Item.BEEF, 'smoker'), '');
  equal('熔炉从不挑食', stationRejectReason(Block.STONE, 'furnace'), '');
  // 石头的特殊之处：**它本来就没有烧炼配方**，三种炉子都不该多嘴
  // （提示只在"能烧、但这座炉子不做"的时候出现，否则玩家会以为石头本该能烧）
  equal('石头没有配方，烟熏炉也不多嘴', stationRejectReason(Block.STONE, 'smoker'), '');
}

console.log('\n[烟熏炉：只烧食物、快一倍]');
{
  const smoker = new Furnace('smoker');
  equal('站台记在实例上', smoker.station, 'smoker');
  equal('站台中文名', smoker.stationName, '烟熏炉');
  smoker.set(FURNACE_INPUT, { id: Item.BEEF, count: 3 });
  smoker.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });

  smoker.tick(0.05);
  check('点火成功', smoker.isLit);
  // ⚠️ 燃料时长也减半（80 → 40 秒）：一份煤在烟熏炉里烧得快，但**能烧的次数不变**
  equal('燃烧总时长减半（40 秒）', smoker.burnTimeTotal, 40);

  advance(smoker, 5.2);
  equal('5 秒就出了熟牛肉', smoker.get(FURNACE_OUTPUT)?.id, Item.COOKED_BEEF);
  equal('原料减少', smoker.get(FURNACE_INPUT)?.count, 2);

  // 燃料的"性价比"不该因为换炉子而变：一份煤在两种炉子里都是 8 次
  // （40 秒 ÷ 5 秒 = 80 秒 ÷ 10 秒）——先按设计算一遍，避免只用模拟验算
  equal(
    '一份煤 = 8 次（烟熏炉与熔炉相同）',
    Math.floor((fuelSeconds(Item.COAL) * FURNACE_STATIONS.smoker.timeScale) / cookSeconds(smeltingRecipeFor(Item.BEEF, 'smoker')!, 'smoker')),
    8,
  );

  // 再用模拟数一遍。⚠️ 第 8 个正好卡在燃料烧完那一刻，离散 tick（0.05 秒）下
  // 浮点累加会让它偶尔差一次，所以这里只要求"7 或 8"，并盯住上界——
  // **关键是它绝不能比熔炉多**（多出来就意味着"烟熏炉凭空多烧了东西"）
  const fresh = new Furnace('smoker');
  fresh.set(FURNACE_INPUT, { id: Item.BEEF, count: 9 });
  fresh.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
  advance(fresh, 45);
  const cooked = fresh.get(FURNACE_OUTPUT)?.count ?? 0;
  check(`一份煤在烟熏炉里烧出 ${cooked} 个（7~8，与熔炉的 8 次等价）`, cooked >= 7 && cooked <= 8);
  check('一份煤绝不够烧 9 次', cooked <= 8);
  equal('煤已耗尽', fresh.get(FURNACE_FUEL), null);
  equal('未烧完的原料留在原料槽里', fresh.get(FURNACE_INPUT)?.count, 9 - cooked);
}

console.log('\n[烟熏炉：石头烧不动，而且要说清原因]');
{
  const smoker = new Furnace('smoker');
  // 用**沙子**而不是石头：沙子本来能烧成玻璃（熔炉里能烧），
  // 只是这座炉子不做——这才是"提示该不该出现"的分界
  smoker.set(FURNACE_INPUT, { id: Block.SAND, count: 64 });
  smoker.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
  advance(smoker, 20);
  check('不点火', !smoker.isLit);
  equal('不产出', smoker.get(FURNACE_OUTPUT), null);
  equal('燃料一个都没烧掉', smoker.get(FURNACE_FUEL)?.count, 1);
  check('提示里说明了原因', smoker.rejectReason.includes('只烧食物'));
}

console.log('\n[高炉：只烧矿物与金属]');
{
  const blast = new Furnace('blast_furnace');
  blast.set(FURNACE_INPUT, { id: Item.RAW_IRON, count: 2 });
  blast.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
  advance(blast, 5.2);
  equal('5 秒出铁锭', blast.get(FURNACE_OUTPUT)?.id, Item.IRON_INGOT);
  equal('燃烧也减半', blast.burnTimeTotal, 40);

  // 沙子：高炉不做玻璃
  const blast2 = new Furnace('blast_furnace');
  blast2.set(FURNACE_INPUT, { id: Block.SAND, count: 8 });
  blast2.set(FURNACE_FUEL, { id: Item.COAL, count: 1 });
  advance(blast2, 20);
  check('沙子在高炉里不烧', !blast2.isLit);
  equal('不产出玻璃', blast2.get(FURNACE_OUTPUT), null);
}

console.log('\n[站台进存档]');
{
  const store = new BlockEntityStore();
  const blast = store.getOrCreateFurnace(Dimension.OVERWORLD, 1, 64, 1, 'blast_furnace');
  equal('新建时就带上站台', blast.station, 'blast_furnace');
  blast.set(FURNACE_INPUT, { id: Item.RAW_IRON, count: 4 });

  const data = serializeContainers(store);
  equal('站台写进了存档', data[0]!.furnace?.station, 'blast_furnace');

  const restored = new BlockEntityStore();
  restoreContainers(restored, JSON.parse(JSON.stringify(data)));
  equal('读回来还是高炉（不会变回普通熔炉）', restored.getFurnace(Dimension.OVERWORLD, 1, 64, 1)?.station, 'blast_furnace');

  // 旧存档：没有 station 字段 → 按普通熔炉读（老存档里不可能有烟熏炉/高炉）
  const legacy = new BlockEntityStore();
  const raw = JSON.parse(JSON.stringify(data)) as ReturnType<typeof serializeContainers>;
  delete raw[0]!.furnace!.station;
  restoreContainers(legacy, raw);
  equal('旧存档缺字段时回退普通熔炉', legacy.getFurnace(Dimension.OVERWORLD, 1, 64, 1)?.station, 'furnace');

  // 脏数据（手改坏的库）：也要回退，而不是让 tick 里查到 undefined 再炸
  const dirty = new BlockEntityStore();
  const bad = JSON.parse(JSON.stringify(data)) as ReturnType<typeof serializeContainers>;
  (bad[0]!.furnace as { station?: unknown }).station = 'weird_smelter';
  restoreContainers(dirty, bad);
  equal('不认识的站台回退普通熔炉', dirty.getFurnace(Dimension.OVERWORLD, 1, 64, 1)?.station, 'furnace');

  // 同一个坐标反复取：站台不该被后来的调用改写（只有自愈那一处会改）
  const again = store.getOrCreateFurnace(Dimension.OVERWORLD, 1, 64, 1, 'smoker');
  equal('已存在的实例保留自己的站台', again.station, 'blast_furnace');
}

console.log('\n[烟熏炉与高炉的方块与配方]');
{
  for (const [id, name, cn] of [
    [Block.SMOKER, 'minecraft:smoker', '烟熏炉'],
    [Block.BLAST_FURNACE, 'minecraft:blast_furnace', '高炉'],
  ] as const) {
    equal(`${cn}的注册名`, blockDef(id).name, name);
    equal(`${cn}的中文名`, itemLabel(id), cn);
    equal(`${cn}的硬度与熔炉同档`, blockHardness(id), 3.5);
    equal(`${cn}要镐`, harvestRequirement(id)?.tool, 'pickaxe');
    equal(`${cn}归"功能方块"分类`, categoryOf(id), 'functional');
    check(`${cn}在创造物品栏里`, CREATIVE_ITEMS.includes(id));
    check(`${cn}的贴图都在图集里`, blockDef(id).tiles.every((tile) => TILE_ORDER.includes(tile as never)));
    check(`${cn}有中文说明（写明只烧什么、快一倍）`, hasDescription(id));
  }
  check('烟熏炉与高炉的贴图各不相同（不会长得像熔炉）', blockDef(Block.SMOKER).tiles[2] !== blockDef(Block.BLAST_FURNACE).tiles[2]);

  // 烟熏炉：任意原木 + 熔炉（展开成 6 条：橡木 + `Wood` 表的 5 种木材）
  const smokerRecipes = RECIPES.filter((recipe) => recipe.result.id === Block.SMOKER);
  equal('烟熏炉有 6 条配方（6 种原木各一条）', smokerRecipes.length, 6);
  const legends = smokerRecipes.map((recipe) => (recipe.kind === 'shaped' ? recipe.key.L : undefined));
  check('每条用的是不同的原木（含橡木）', legends.includes(Block.OAK_LOG) && legends.length === new Set(legends).size);
  equal(
    '4 原木 + 熔炉 → 烟熏炉（十字形）',
    matchRecipe(grid(3, ['·L·', 'LFL', '·L·'], { L: Block.OAK_LOG, F: Block.FURNACE }), 3)?.id,
    Block.SMOKER,
  );
  equal(
    '5 铁锭 + 熔炉 + 3 平滑石头 → 高炉',
    matchRecipe(grid(3, ['III', 'IFI', 'SSS'], { I: Item.IRON_INGOT, F: Block.FURNACE, S: Block.SMOOTH_STONE }), 3)?.id,
    Block.BLAST_FURNACE,
  );
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
