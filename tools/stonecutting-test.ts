/**
 * 切石机离线断言（H11，批次 44）
 *
 * 覆盖四块，都是"看界面看不出错"的地方：
 *  1. **方块与配方**：注册一致、要镐、中文名/说明/分类、合成配方
 *  2. **切石表**：规模、每条产物都在注册表里、没有"自己切自己"、数量语义（台阶 2、其余 1）
 *  3. **容器语义**：放进输入 → 列候选 → 切一次扣 1 个、切到空、非法产物被拒（不吞东西）
 *  4. **存档**：输入格随存档走（1 格），旧存档没有这个 kind 时不炸
 *
 * 运行：npm run test:stonecutter
 */

import {
  Block,
  BLOCKS,
  blockDef,
  slabId,
  stairsId,
} from '../web/src/core/registry/blocks.ts';
import { isHandHarvestable, breakSeconds, canHarvest, makeToolInfo } from '../web/src/core/registry/tools.ts';
import { RECIPES, matchRecipe } from '../web/src/core/crafting/Recipes.ts';
import {
  isStonecuttingInput,
  stonecuttingConversionCount,
  stonecuttingInputCount,
  stonecuttingOffers,
  stonecuttingRecipeCount,
  stonecuttingYield,
} from '../web/src/core/crafting/Stonecutting.ts';
import { stoneVariantId } from '../web/src/core/registry/blocks.ts';
import {
  STONECUTTER_SIZE,
  Stonecutter,
} from '../web/src/core/container/Stonecutter.ts';
import { CREATIVE_ITEMS, Item, categoryOf } from '../web/src/core/registry/items.ts';
import { hasDescription, itemLabel } from '../web/src/core/registry/itemNames.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { BlockEntityStore } from '../web/src/core/world/BlockEntityStore.ts';
import { SLOT_COUNTS, kindOf, restoreContainers, serializeContainers } from '../web/src/core/save/ContainerSave.ts';
import { Dimension } from '../web/src/core/gen/Dimension.ts';

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

const WOOD_PICK = makeToolInfo('pickaxe', 'wooden');
const DIAMOND_PICK = makeToolInfo('pickaxe', 'diamond');

/** 名字列表（断言里比名字比比 id 更好读，失败信息一眼能看懂） */
function names(ids: readonly number[]): string {
  return ids.map((id) => blockDef(id).name.replace('minicraft:', '')).join(',');
}

// ---------------------------------------------------------------- 1. 方块与配方

console.log('\n[切石机方块]');
{
  equal('注册名', blockDef(Block.STONECUTTER).name, 'minicraft:stonecutter');
  equal('中文名', itemLabel(Block.STONECUTTER), '切石机');
  equal('形状是整格（没有朝向、没有状态）', blockDef(Block.STONECUTTER).shape, 'cube');
  check('id 在表里且与常量一致', BLOCKS[Block.STONECUTTER]?.id === Block.STONECUTTER);
  check('三张贴图都在图集名单里', blockDef(Block.STONECUTTER).tiles.every((tile) => TILE_ORDER.includes(tile as never)));
  check('顶面与侧面是两张不同的贴图（锯片必须在顶面）', blockDef(Block.STONECUTTER).tiles[0] !== blockDef(Block.STONECUTTER).tiles[2]);

  // 工具：原版与石头同档（要镐、不限等级）
  check('徒手挖不动（要镐）', !isHandHarvestable(Block.STONECUTTER));
  check('木镐就能采到', canHarvest(Block.STONECUTTER, WOOD_PICK));
  check('徒手挖虽然慢但一无所得', !canHarvest(Block.STONECUTTER, null));
  check('钻石镐当然也能', canHarvest(Block.STONECUTTER, DIAMOND_PICK));
  check('用镐比徒手快得多', breakSeconds(Block.STONECUTTER, DIAMOND_PICK) < breakSeconds(Block.STONECUTTER, null));

  // 物品：创造栏 / 分类 / 说明
  check('在创造物品栏里', CREATIVE_ITEMS.includes(Block.STONECUTTER));
  equal('归"功能方块"分类', categoryOf(Block.STONECUTTER), 'functional');
  check('有中文说明（写明怎么用）', hasDescription(Block.STONECUTTER));

  // 配方：1 铁锭 + 3 石头（原版图案）
  const grid = (cells: readonly number[]) => matchRecipe(cells, 3);
  equal(
    '3 石头 + 1 铁锭 → 切石机',
    grid([0, Item.IRON_INGOT, 0, Block.STONE, Block.STONE, Block.STONE, 0, 0, 0])?.id,
    Block.STONECUTTER,
  );
  equal('产物 1 个', grid([0, Item.IRON_INGOT, 0, Block.STONE, Block.STONE, Block.STONE, 0, 0, 0])?.count, 1);
  check(
    '配方在 RECIPES 里（配方书也翻得到）',
    RECIPES.some((recipe) => recipe.result.id === Block.STONECUTTER),
  );
}

// ---------------------------------------------------------------- 2. 切石表

console.log('\n[切石表：规模与不变量]');
{
  check(`输入种数 ≥ 35（实测 ${stonecuttingInputCount()}）`, stonecuttingInputCount() >= 35);
  check(`配方条数 ≥ 100（实测 ${stonecuttingRecipeCount()}）`, stonecuttingRecipeCount() >= 100);
  check(`手工转换那一段 ≥ 20 条（实测 ${stonecuttingConversionCount()}）`, stonecuttingConversionCount() >= 20);

  // 不变量：产物必须在注册表里、不能是自己、同一输入下不重复、数量只能是 1 或 2
  const badOutput: string[] = [];
  const selfCut: string[] = [];
  const duplicated: string[] = [];
  const badCount: string[] = [];
  let total = 0;
  for (const input of BLOCKS.map((def) => def.id)) {
    const offers = stonecuttingOffers(input);
    const seen = new Set<number>();
    for (const offer of offers) {
      total++;
      if (!blockDef(offer.output) || blockDef(offer.output).id !== offer.output) badOutput.push(`${blockDef(input).name}→${offer.output}`);
      if (offer.output === input) selfCut.push(blockDef(input).name);
      if (seen.has(offer.output)) duplicated.push(`${blockDef(input).name}→${blockDef(offer.output).name}`);
      seen.add(offer.output);
      if (offer.count !== 1 && offer.count !== 2) badCount.push(`${blockDef(input).name}→${blockDef(offer.output).name} x${offer.count}`);
    }
  }
  equal('遍历全部方块的产物条数与表规模一致', total, stonecuttingRecipeCount());
  check('每条产物都是已注册的方块', badOutput.length === 0, badOutput.slice(0, 3).join(' '));
  check('没有"自己切自己"', selfCut.length === 0, selfCut.slice(0, 3).join(' '));
  check('同一输入下没有重复产物', duplicated.length === 0, duplicated.slice(0, 3).join(' '));
  check('数量只有 1 与 2（台阶 2、其余 1）', badCount.length === 0, badCount.slice(0, 3).join(' '));

  check('每种输入都至少能切出一样东西', BLOCKS.every((def) => !isStonecuttingInput(def.id) || stonecuttingOffers(def.id).length > 0));
  equal('非石料（钻石）切不出东西', stonecuttingOffers(Item.DIAMOND).length, 0);
  equal('橡木木板不进切石机（木材没有"切"这一说）', stonecuttingOffers(Block.OAK_PLANKS).length, 0);
}

console.log('\n[几个代表性输入]');
{
  equal(
    '石头 → 石板×2 / 楼梯 / 石砖 / 錾制石砖',
    names(stonecuttingOffers(Block.STONE).map((offer) => offer.output)),
    'stone_slab,stone_stairs,stone_bricks,chiseled_stone_bricks',
  );
  // ⚠️ 台阶/楼梯**没有** `Block.STONE_SLAB` 这样的常量（它们是 `SHAPED_PARENTS` 批量生成的，
  // 只有 `slabId(index)` / `stairsId(index)` 两个入口）——写测试时最容易在这里写成不存在的常量，
  // 而 `undefined` 查不出产物只会表现成"数量是 0"
  equal('石板的产量是 2', stonecuttingYield(Block.STONE, slabId(0)), 2);
  equal('楼梯的产量是 1', stonecuttingYield(Block.STONE, stairsId(0)), 1);

  // ⚠️ 这一条是批次 42 留下的尾巴：深板岩瓦在合成台里被"深板岩砖"挡住（同输入同图案），
  // 切石机是它**唯一确定的来源**——本批把它解开了
  equal('1 磨制深板岩 → 1 深板岩瓦（批次 42 记下的那条正门）', stonecuttingYield(Block.POLISHED_DEEPSLATE, Block.DEEPSLATE_TILES), 1);
  check(
    '磨制深板岩还能切出深板岩砖、錾制深板岩与它自己的三件套',
    ['deepslate_bricks', 'chiseled_deepslate', 'polished_deepslate_slab', 'polished_deepslate_stairs', 'polished_deepslate_wall'].every(
      (name) => stonecuttingOffers(Block.POLISHED_DEEPSLATE).some((offer) => blockDef(offer.output).name === `minicraft:${name}`),
    ),
  );

  // 深板岩那条四级链
  check(
    '深板岩能一路切到深板岩瓦（圆石深板岩 → 磨制 → 砖 → 瓦）',
    ['cobbled_deepslate', 'polished_deepslate', 'deepslate_bricks', 'deepslate_tiles', 'chiseled_deepslate'].every(
      (name) => stonecuttingOffers(Block.DEEPSLATE).some((offer) => blockDef(offer.output).name === `minicraft:${name}`),
    ),
  );
  // 花岗岩：三件套 + 磨制（"变细"那一档排在后面，与登记顺序一致）
  equal(
    '花岗岩 → 台阶/楼梯/墙 + 磨制花岗岩',
    names(stonecuttingOffers(Block.GRANITE).map((o) => o.output)),
    'granite_slab,granite_stairs,granite_wall,polished_granite',
  );
  check('闪长岩 → 磨制闪长岩', stonecuttingOffers(Block.DIORITE).some((offer) => offer.output === Block.POLISHED_DIORITE));

  // 铜：四档都要能切（批次 40 的四种形状正好用上）
  for (let stage = 0; stage < 4; stage++) {
    const blockId = 335 + stage * 4;
    check(`第 ${stage + 1} 档铜块能切出切制铜与它的台阶楼梯`, stonecuttingOffers(blockId).length === 3);
  }

  // 石英 / 海晶石 / 末地石
  check('石英块 → 石英柱 / 錾制石英块', stonecuttingOffers(Block.QUARTZ_BLOCK).some((offer) => offer.output === Block.QUARTZ_PILLAR));
  // 红砂岩（批次 45）：与砂岩那一对同构——两个家族在切石机里也该一模一样
  equal(
    '红砂岩能切出的东西与砂岩一一对应（三件套 + 切制 + 錾制）',
    names(stonecuttingOffers(Block.RED_SANDSTONE).map((offer) => offer.output)).replace(/red_/g, ''),
    names(stonecuttingOffers(Block.SANDSTONE).map((offer) => offer.output)),
  );
  equal('红砂岩石板也是 2 份', stonecuttingYield(Block.RED_SANDSTONE, stoneVariantId('red_sandstone', 'slab')!), 2);
  check('海晶石 → 三件套 + 海晶石砖 + 暗海晶石', stonecuttingOffers(Block.PRISMARINE).length === 5);
  check('末地石 → 末地石砖', stonecuttingOffers(Block.END_STONE).some((offer) => offer.output === Block.END_STONE_BRICKS));
  check('紫珀块 → 紫珀柱', stonecuttingOffers(Block.PURPUR_BLOCK).some((offer) => offer.output === Block.PURPUR_PILLAR));
}

// ---------------------------------------------------------------- 3. 容器语义

console.log('\n[切石机容器]');
{
  equal('只有 1 格（原版就是一个输入格）', STONECUTTER_SIZE, 1);

  const cutter = new Stonecutter();
  equal('空着的时候没有候选', cutter.offers.length, 0);
  check('空着切不动', !cutter.cut(slabId(0)).ok);

  cutter.set(0, { id: Block.STONE, count: 3 });
  equal('放进 3 个石头 → 4 个候选', cutter.offers.length, 4);
  equal('候选的顺序是"台阶在前"（与原版列表一致）', blockDef(cutter.offers[0]!.output).name, 'minicraft:stone_slab');

  // 切一次：扣 1 个输入、给出 2 个台阶
  const first = cutter.cut(slabId(0));
  check('切一次成功', first.ok);
  equal('产出 2 个台阶', first.ok ? first.output.count : 0, 2);
  equal('输入还剩 2 个', cutter.input?.count, 2);

  // 非法产物：不在候选里 → 拒绝，且**不能扣掉输入**（"东西没了又没拿到产物"是最恼人的 bug）
  const illegal = cutter.cut(Item.DIAMOND);
  check('切成石头切不出的东西会被拒绝', !illegal.ok);
  equal('被拒绝时不扣输入', cutter.input?.count, 2);

  // 切到空
  cutter.cut(stairsId(0));
  cutter.cut(Block.STONE_BRICKS);
  equal('切完输入格自动变空', cutter.input, null);
  equal('空输入后候选清空', cutter.offers.length, 0);

  // 放进去不能切的东西：不炸、候选为空
  cutter.set(0, { id: Item.DIAMOND, count: 1 });
  equal('放钻石进去候选为空', cutter.offers.length, 0);
  check('钻石切不出东西', !cutter.cut(slabId(0)).ok);

  // 换输入要能重算
  cutter.set(0, { id: Block.POLISHED_DEEPSLATE, count: 1 });
  equal('换成磨制深板岩后候选变成 6 项', cutter.offers.length, 6);

  // 变更通知（界面靠它重画）
  let notified = 0;
  cutter.onChange = () => notified++;
  cutter.set(0, null);
  check('set 会通知界面', notified > 0);
}

// ---------------------------------------------------------------- 4. 存档

console.log('\n[切石机的存档]');
{
  equal('容器种类的槽位数是 1', SLOT_COUNTS.stonecutter, 1);
  const cutter = new Stonecutter();
  equal('实例 → 种类', kindOf(cutter), 'stonecutter');

  const store = new BlockEntityStore();
  const placed = store.getOrCreateStonecutter(Dimension.OVERWORLD, 4, 70, 9);
  placed.set(0, { id: Block.STONE, count: 7 });
  equal('同一个坐标取回的是同一个实例', store.getOrCreateStonecutter(Dimension.OVERWORLD, 4, 70, 9), placed);
  equal('按坐标能查到', store.getStonecutter(Dimension.OVERWORLD, 4, 70, 9), placed);
  equal('别的维度查不到（键带维度）', store.getStonecutter(Dimension.NETHER, 4, 70, 9), undefined);

  const data = serializeContainers(store);
  equal('有东西的切石机写进存档', data.length, 1);
  equal('写下来的种类是 stonecutter', data[0]!.kind, 'stonecutter');
  equal('写下来 1 格', data[0]!.stacks.length, 1);

  const restored = new BlockEntityStore();
  equal('还原 1 个容器', restoreContainers(restored, JSON.parse(JSON.stringify(data))), 1);
  const back = restored.getStonecutter(Dimension.OVERWORLD, 4, 70, 9);
  equal('输入格里的石头原样回来', back?.input?.id, Block.STONE);
  equal('数量也对', back?.input?.count, 7);
  equal('还原后候选表也重算出来了', back?.offers.length, 4);

  // 空的切石机不占存档
  const empty = new BlockEntityStore();
  empty.getOrCreateStonecutter(Dimension.OVERWORLD, 0, 64, 0);
  equal('空着就不写存档（与其它容器同一条规矩）', serializeContainers(empty).length, 0);
}

console.log(`\n切石机测试：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
