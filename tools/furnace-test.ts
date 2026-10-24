/**
 * 熔炉与箱子的离线测试
 *
 * 运行：npm run test:furnace
 */

import { Block, blockDef, blockHardness, blockTiles, emitLightWithState } from '../src/core/registry/blocks.ts';
import { CAMPFIRE_HEIGHT, collisionBoxes, isFullBlockShape } from '../src/core/registry/blockShapes.ts';
import { isLitState, withLitState, withPowered } from '../src/core/registry/blockState.ts';
import { CAMPFIRE_SIZE, Campfire } from '../src/core/container/Campfire.ts';
import { breakSeconds, canHarvest, makeToolInfo } from '../src/core/registry/tools.ts';
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
// ⚠️ 这一条原本拿**石头**当"没有配方的样本"，而批次 119 按原版补上了
// "石头 → 平滑石头"（方块侧可达性审计量出来的缺口），所以样本换成泥土
equal('泥土没有烧炼配方', smeltingRecipeFor(Block.DIRT), undefined);
equal('石头能烧成平滑石头（批次 119 按原版补的）', smeltingRecipeFor(Block.STONE)?.output.id, Block.SMOOTH_STONE);

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
  equal('熔炉从不挑食', stationRejectReason(Block.DIRT, 'furnace'), '');
  // 泥土的特殊之处：**它本来就没有烧炼配方**，三种炉子都不该多嘴
  // （提示只在"能烧、但这座炉子不做"的时候出现，否则玩家会以为泥土本该能烧）
  // ⚠️ 样本从石头换成泥土：石头在批次 119 有了"→ 平滑石头"这条配方（见上面那条）
  equal('泥土没有配方，烟熏炉也不多嘴', stationRejectReason(Block.DIRT, 'smoker'), '');
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
    [Block.SMOKER, 'minicraft:smoker', '烟熏炉'],
    [Block.BLAST_FURNACE, 'minicraft:blast_furnace', '高炉'],
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

// ---------------------------------------------------------------- 点燃外观（批次 47）

console.log('\n[点燃状态位：贴图与发光都跟着它走]');
{
  // 点燃位与红石元件的"通电位"共用 bit3——沿用项目里"不同形状族共用状态位"的设计
  check('点燃位就是通电位（共用 bit3）', isLitState(withPowered(0, true)) && withLitState(0, true) === withPowered(0, true));
  check('默认状态是"没点燃"', !isLitState(0));
  check('往返读写一致', isLitState(withLitState(0, true)) && !isLitState(withLitState(withLitState(0, true), false)));

  // 贴图：
  //  · 三座炉子（批次 64 起）：**只有正脸那一面**随点燃变化（`faceTile`），其余五面不动；
  //  · 营火：亮的是**顶面**（它是敞口的，没有"正脸"这回事）。
  const litOf = (id: number) => blockTiles(id, withLitState(0, true));
  const unlitOf = (id: number) => blockTiles(id, 0);
  // 朝向朝北（facing=0 → 外法线 [0,0,-1]）时的正脸贴图
  const NORTH: readonly [number, number, number] = [0, 0, -1];
  const front = (id: number, lit: boolean) => blockDef(id).faceTile?.(lit ? withLitState(0, true) : 0, NORTH);
  equal('熔炉点亮 → 正脸是 furnace_front_on', front(Block.FURNACE, true), 'furnace_front_on');
  equal('熔炉没点亮 → 正脸是 furnace_front（黑洞）', front(Block.FURNACE, false), 'furnace_front');
  equal('烟熏炉点亮 → 正脸 smoker_front_on', front(Block.SMOKER, true), 'smoker_front_on');
  equal('高炉点亮 → 正脸 blast_furnace_front_on', front(Block.BLAST_FURNACE, true), 'blast_furnace_front_on');
  equal('侧脸不随点燃变化', front(Block.FURNACE, true) === front(Block.FURNACE, false), false);
  check('背朝北时没有正脸（回退到普通贴图）', blockDef(Block.FURNACE).faceTile?.(0, [0, 0, 1]) === undefined);
  check('顶面也没有正脸', blockDef(Block.FURNACE).faceTile?.(0, [0, 1, 0]) === undefined);
  equal(
    '（锅炉家族的）侧面贴图不再随点燃变（原先四个侧面会一起亮）',
    `${litOf(Block.FURNACE)[2]}/${unlitOf(Block.FURNACE)[2]}`,
    'furnace_side/furnace_side',
  );
  equal('营火点亮 → **顶面**是火焰（它是敞口的）', litOf(Block.CAMPFIRE)[0], 'campfire_fire');
  equal('营火没点亮 → 顶面是柴堆', unlitOf(Block.CAMPFIRE)[0], 'campfire_top');
  check('顶面不随点燃变化（只有炉口那一面变）', litOf(Block.FURNACE)[0] === unlitOf(Block.FURNACE)[0]);
  check('炉子家族没有 `stateTiles`（改走面级贴图了）', [Block.FURNACE, Block.SMOKER, Block.BLAST_FURNACE].every((id) => blockDef(id).stateTiles === undefined));
  for (const id of [Block.FURNACE, Block.SMOKER, Block.BLAST_FURNACE, Block.CAMPFIRE]) {
    const faces = [blockDef(id).faceTile?.(0, NORTH), blockDef(id).faceTile?.(withLitState(0, true), NORTH)];
    check(
      '点火贴图都在图集里',
      faces.every((tile) => tile === undefined || TILE_ORDER.includes(tile as never)) &&
        blockDef(id).tiles.every((tile) => TILE_ORDER.includes(tile as never)),
    );
  }

  // 发光：炉子 13、营火 15（原版），没点燃时 0
  equal('熔炉点燃发光 13', emitLightWithState(Block.FURNACE, withLitState(0, true)), 13);
  equal('烟熏炉点燃发光 13', emitLightWithState(Block.SMOKER, withLitState(0, true)), 13);
  equal('高炉点燃发光 13', emitLightWithState(Block.BLAST_FURNACE, withLitState(0, true)), 13);
  equal('营火点燃发光 15（明火比炉子亮）', emitLightWithState(Block.CAMPFIRE, withLitState(0, true)), 15);
  equal('没点燃不发光', emitLightWithState(Block.FURNACE, 0), 0);
  equal('红石灯那条老规矩没被影响', emitLightWithState(Block.REDSTONE_LAMP, withPowered(0, true)), 15);
}

// ---------------------------------------------------------------- 营火（批次 47）

console.log('\n[营火：不要燃料、一次烤 4 个、烤好弹出来]');
{
  equal('营火站台的中文名', FURNACE_STATIONS.campfire.cn, '营火');
  equal('营火 30 秒一份（熔炉的 3 倍）', cookSeconds(smeltingRecipeFor(Item.BEEF, 'campfire')!, 'campfire'), 30);
  check('营火烤牛肉', smeltingRecipeFor(Item.BEEF, 'campfire') !== undefined);
  equal('营火不烤粗铁', smeltingRecipeFor(Item.RAW_IRON, 'campfire'), undefined);
  equal('营火不烤沙子', smeltingRecipeFor(Block.SAND, 'campfire'), undefined);
  equal('营火不接受"只属于熔炉"的配方', smeltingRecipeFor(Block.COBBLESTONE, 'campfire'), undefined);

  const campfire = new Campfire();
  check('放下就是点着的', campfire.lit);
  equal('4 个格子', CAMPFIRE_SIZE, 4);
  equal('空着时没在烤', campfire.cooking, false);

  campfire.set(0, { id: Item.BEEF, count: 2 });
  campfire.set(2, { id: Item.CHICKEN, count: 1 });
  equal('放了两样东西', campfire.get(0)?.id, Item.BEEF);
  equal('空着的格子还是空的', campfire.get(1), null);

  // 烤 30 秒 → 两格各出一条
  const cooked = campfire.tick(30).cooked;
  equal('一次 tick 里两格都烤好了', cooked.length, 2);
  equal('第 0 格出的是熟牛肉', cooked.find((entry) => entry.slot === 0)?.output.id, Item.COOKED_BEEF);
  equal('第 2 格出的是熟鸡肉', cooked.find((entry) => entry.slot === 2)?.output.id, Item.COOKED_CHICKEN);
  equal('原料各少了一个（牛肉还剩 1）', campfire.get(0)?.count, 1);
  equal('鸡肉烤完就空了', campfire.get(2), null);
  equal('进度清零', campfire.ratio(0), 0);

  // 30 秒之前不会烤好
  const slow = new Campfire();
  slow.set(0, { id: Item.BEEF, count: 1 });
  slow.tick(25);
  equal('25 秒还没好', slow.get(0)?.id, Item.BEEF);
  check('进度条走到 5/6 左右', Math.abs(slow.ratio(0) - 25 / 30) < 0.02, `实际 ${slow.ratio(0).toFixed(3)}`);

  // 换料就重新计时
  slow.set(0, { id: Item.PORKCHOP, count: 1 });
  equal('换料后进度归零', slow.ratio(0), 0);

  // 非食物：不烤，而且要说清楚
  const wrongFood = new Campfire();
  wrongFood.set(1, { id: Block.SAND, count: 8 });
  equal('沙子在营火上不烤', wrongFood.tick(60).cooked.length, 0);
  // 文案由站台的 accepts 推出来：营火是"只烤食物"（不是"只烧"——那是炉子的说法）
  check('提示里说明它只烤食物', wrongFood.rejectReason(1).includes('只烤食物'));
  equal('沙子还在架子上（没被吃掉）', wrongFood.get(1)?.count, 8);

  // 熄灭：停止烤制、进度回退
  const out = new Campfire();
  out.set(0, { id: Item.BEEF, count: 1 });
  out.tick(20);
  out.lit = false;
  const before = out.ratio(0);
  out.tick(2);
  check('熄灭后进度开始回退', out.ratio(0) < before);
  out.tick(60);
  equal('熄灭后一直不产出', out.get(0)?.id, Item.BEEF);
  equal('进度退到 0', out.ratio(0), 0);

  /**
   * 与炉子的关键差别：**不要燃料**。
   * 同一份生肉放在熔炉里（没有燃料）永远烤不出来，放在营火上 30 秒就好——
   * 这是"营火不需要燃料"这个设计的核心断言。
   */
  const emptyFurnace = new Furnace();
  emptyFurnace.set(FURNACE_INPUT, { id: Item.BEEF, count: 1 });
  advance(emptyFurnace, 60);
  equal('没有燃料的熔炉烤不出东西', emptyFurnace.get(FURNACE_OUTPUT), null);
  const noFuelCampfire = new Campfire();
  noFuelCampfire.set(0, { id: Item.BEEF, count: 1 });
  equal('营火不要燃料也能烤出来', noFuelCampfire.tick(30).cooked.length, 1);
}

console.log('\n[营火：方块、配方与存档]');
{
  equal('营火的注册名', blockDef(Block.CAMPFIRE).name, 'minicraft:campfire');
  equal('中文名', itemLabel(Block.CAMPFIRE), '营火');
  equal('形状是 campfire（7/16 高的柴堆，能站上去）', blockDef(Block.CAMPFIRE).shape, 'campfire');
  equal('硬度 2', blockHardness(Block.CAMPFIRE), 2);
  check('徒手就能挖（斧只是更快）', canHarvest(Block.CAMPFIRE, null));
  check('拿斧更快', breakSeconds(Block.CAMPFIRE, makeToolInfo('axe', 'iron')) < breakSeconds(Block.CAMPFIRE, null));
  equal('归"功能方块"分类', categoryOf(Block.CAMPFIRE), 'functional');
  check('在创造物品栏里', CREATIVE_ITEMS.includes(Block.CAMPFIRE));
  check('有中文说明（写明不要燃料、怎么熄灭）', hasDescription(Block.CAMPFIRE));
  check('不是整格（不参与贪心合并）', !isFullBlockShape('campfire', 0));
  equal('能站上去：碰撞盒就是那个 7/16 的柴堆', collisionBoxes('campfire', 0)[0]![4], CAMPFIRE_HEIGHT);

  // 配方：6 种原木 × 2 种燃料 = 12 条
  const campfireRecipes = RECIPES.filter((recipe) => recipe.result.id === Block.CAMPFIRE);
  equal('营火有 12 条配方（6 原木 × 煤炭/木炭）', campfireRecipes.length, 12);
  equal(
    '3 木棍 + 1 煤炭 + 3 原木 → 营火',
    matchRecipe(grid(3, ['·S·', 'SCS', 'LLL'], { S: Item.STICK, C: Item.COAL, L: Block.OAK_LOG }), 3)?.id,
    Block.CAMPFIRE,
  );
  equal(
    '木炭那一份也认（前期最容易拿到的就是它）',
    matchRecipe(grid(3, ['·S·', 'SCS', 'LLL'], { S: Item.STICK, C: Item.CHARCOAL, L: Block.OAK_LOG }), 3)?.id,
    Block.CAMPFIRE,
  );

  // 存档：熄灭的营火也要写下来（否则读档后自己又烧起来了）
  const store = new BlockEntityStore();
  const saved = store.getOrCreateCampfire(Dimension.OVERWORLD, 5, 70, 5);
  saved.set(0, { id: Item.BEEF, count: 3 });
  saved.tick(10);
  saved.lit = false;
  const data = serializeContainers(store);
  equal('营火写进了存档', data.length, 1);
  equal('种类是 campfire', data[0]!.kind, 'campfire');
  equal('熄灭状态也写下来了', data[0]!.campfire?.lit, false);
  equal('4 格都写下来了', data[0]!.stacks.length, 4);

  const restored = new BlockEntityStore();
  restoreContainers(restored, JSON.parse(JSON.stringify(data)));
  const back = restored.getCampfire(Dimension.OVERWORLD, 5, 70, 5);
  equal('读回来还是熄灭的', back?.lit, false);
  equal('架子上的生肉还在', back?.get(0)?.count, 3);
  check('进度也恢复了（不是从 0 开始）', (back?.ratio(0) ?? 0) > 0);

  // 空着但熄灭的营火也要写（否则读档后又自己烧起来了）
  const emptyStore = new BlockEntityStore();
  emptyStore.getOrCreateCampfire(Dimension.OVERWORLD, 1, 64, 1).lit = false;
  equal('空着但熄灭的营火会写存档', serializeContainers(emptyStore).length, 1);
  const litOnlyStore = new BlockEntityStore();
  litOnlyStore.getOrCreateCampfire(Dimension.OVERWORLD, 2, 64, 2);
  equal('空着且点着的营火不写存档（默认就是点着的）', serializeContainers(litOnlyStore).length, 0);
}

console.log(`\n结果：通过 ${passed}，失败 ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
