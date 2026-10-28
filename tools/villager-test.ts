/**
 * 村民与交易离线测试（J11，批次 88）
 *
 * 这一批做成的是**第一种"会做生意的生物"**：职业与交易表是纯数据
 * （`registry/villagerTrades.ts`），村民是 `Mob` 的一个子类（多一份职业与交易状态），
 * 界面只负责"点一条"、主程序负责扣与给。断言分八块：
 *  1. **职业表自检**：7 个职业、工作站不撞车、每级都有货、单价都为正、颜色能分辨；
 *  2. **可达性**：每条交易的**收货**都要能在生存里拿到（绿宝石尤其重要——没有它整套交易
 *     就是死数据）；⚠️ 批次 169 起**产物不再要求另有来源**（商店本身就可以是唯一来源，
 *     锁链甲就是这种情况）；
 *  3. **等级**：经验→等级的纯函数（阈值边界）、逐级解锁的交易条数；
 *  4. **成交判定**：材料不够/次数用完/第二样不够，以及"结算数据是副本"；
 *  5. **村民实体**：认领职业、升级解锁、幼体不认领、外观版本随职业变；
 *  6. **工作站扫描**：范围与"取最近的那一个"；
 *  7. **生物表与生成**：村民在 `MOB_TYPES` 里但**不在自然生成表里**、
 *     `createMob` 造出来的确实是 `Villager`（不然会得到"一群不会做生意的村民"）；
 *  8. **外观与进度**：长袍颜色随职业、以及"与村民交易"那条进度确实可达。
 *
 * 运行：npm run test:villager
 */

import { readFileSync } from 'node:fs';
import { Block, blockDef, blockTiles } from '../web/src/core/registry/blocks.ts';
import { Item, dropFor, itemDef, possibleBlockDropIds } from '../web/src/core/registry/items.ts';
import { hasDescription, missingBlockNames } from '../web/src/core/registry/itemNames.ts';
import { efficientToolType, harvestRequirement } from '../web/src/core/registry/tools.ts';
import { armorItemId } from '../web/src/core/registry/armor.ts';
import { TILE_ORDER } from '../web/src/render/atlasLayout.ts';
import { RECIPES } from '../web/src/core/crafting/Recipes.ts';
import { SMELTING_RECIPES } from '../web/src/core/crafting/Smelting.ts';
import { lootItemIds } from '../web/src/core/registry/loot.ts';
import { MOB_TYPES, PASSIVE_MOBS, HOSTILE_MOBS, VILLAGER_TYPE, mobTypeById } from '../web/src/core/entity/mobs.ts';
import { mobEats, Mob } from '../web/src/core/entity/Mob.ts';
import { createMob } from '../web/src/core/entity/MobFactory.ts';
import { Villager } from '../web/src/core/entity/Villager.ts';
import { EntityParking, type SavedEntityRecord } from '../web/src/core/entity/EntityParking.ts';
import { mobAccentColor, mobAppearanceKey, mobBodyColor } from '../web/src/render/MobRenderer.ts';
import { fishingEntryIds } from '../web/src/core/registry/fishing.ts';
import { DRAGON_TYPE } from '../web/src/core/entity/EndBoss.ts';
import { advancementById } from '../web/src/core/progress/advancements.ts';
import { AdvancementTracker } from '../web/src/core/progress/AdvancementTracker.ts';
import {
  VILLAGER_FLEE_DISTANCE,
  VILLAGER_PANIC_RADIUS,
  VILLAGER_PANIC_SECONDS,
  VILLAGER_PANIC_SPEED,
  fleePointFrom,
  isPanicThreat,
  nearestPanicThreat,
} from '../web/src/core/entity/VillagerPanic.ts';
import {
  VILLAGER_ARRIVE_RADIUS,
  VILLAGER_WORK_END,
  VILLAGER_WORK_START,
  normalizeTimeOfDay,
  routineTarget,
  villagerArrived,
  villagerRoutine,
} from '../web/src/core/world/VillagerRoutine.ts';
import {
  PROFESSIONS,
  PROFESSION_COUNT,
  TRADE_XP_THRESHOLDS,
  VILLAGER_FOODS,
  VILLAGER_IDLE_ROBE,
  VILLAGER_LEVELS,
  VILLAGER_SKIN_COLOR,
  WORKSTATION_BLOCKS,
  WORKSTATION_SCAN_RANGE,
  findWorkstationNear,
  isVillagerFood,
  isWorkstation,
  levelForTradeXp,
  levelName,
  offersForLevel,
  offersUnlockedAt,
  professionById,
  professionForWorkstation,
  totalOfferCount,
  MAX_TRADE_DEMAND,
  adjustedTradeCosts,
  recordTradeUse,
  tradeBlocker,
  tradeDemand,
  tradePriceDelta,
  tradeSettlement,
  professionLabel,
} from '../web/src/core/registry/villagerTrades.ts';

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

const TILES = new Set<string>(TILE_ORDER);

/** 假背包：只记"某件东西有几个" */
function bag(counts: Record<number, number>): { countOf(itemId: number): number } {
  return { countOf: (itemId: number) => counts[itemId] ?? 0 };
}

/** 假世界：只有一张坐标→方块的表 */
function world(blocks: Record<string, number>): (x: number, y: number, z: number) => number {
  return (x, y, z) => blocks[`${x},${y},${z}`] ?? Block.AIR;
}

// ---------------------------------------------------------------- 1. 职业表自检

console.log('\n[职业表：工作站已经实现的职业]');
{
  equal('职业数（批次 569 制图师补齐到 13）', PROFESSION_COUNT, 13);
  const ids = PROFESSIONS.map((profession) => profession.id);
  equal('id 不重复', new Set(ids).size, ids.length);
  equal('名字不重复', new Set(PROFESSIONS.map((p) => professionLabel(p.id))).size, PROFESSIONS.length);

  const stations = PROFESSIONS.map((profession) => profession.workstation);
  equal('工作站不撞车（两个职业不能共用一个方块）', new Set(stations).size, stations.length);
  const badStations = PROFESSIONS.filter((p) => !isWorkstation(p.workstation));
  check('每个工作站都认得出来', badStations.length === 0);
  equal('认领反查与表一致（农民 ← 堆肥桶）', professionForWorkstation(Block.COMPOSTER)?.id, 'farmer');
  // 批次 90（J23）补齐的四种：方块与职业是同一批加的，这条断言把"配错对"钉住
  equal('图书管理员 ← 讲台', professionForWorkstation(Block.LECTERN)?.id, 'librarian');
  equal('制箭师 ← 制箭台', professionForWorkstation(Block.FLETCHING_TABLE)?.id, 'fletcher');
  equal('武器匠 ← 砂轮', professionForWorkstation(Block.GRINDSTONE)?.id, 'weaponsmith');
  equal('牧羊人 ← 织布机', professionForWorkstation(Block.LOOM)?.id, 'shepherd');
  // 批次 568：炼药锅落地后补的皮匠
  equal('皮匠 ← 炼药锅', professionForWorkstation(Block.CAULDRON)?.id, 'leatherworker');
  const leatherworker = professionById('leatherworker')!;
  equal('皮匠五级交易都有', leatherworker.levels.length, 5);
  check(
    '皮匠卖皮革盔甲与鞍',
    leatherworker.levels.flat().some((trade) => trade.result.id === armorItemId('chestplate', 'leather')) &&
      leatherworker.levels.flat().some((trade) => trade.result.id === Item.SADDLE),
  );
  // 批次 569：制图台落地后补的制图师
  equal('制图师 ← 制图台', professionForWorkstation(Block.CARTOGRAPHY_TABLE)?.id, 'cartographer');
  const cartographer = professionById('cartographer')!;
  equal('制图师五级交易都有', cartographer.levels.length, 5);
  check(
    '制图师卖空地图与指南针',
    cartographer.levels.flat().some((trade) => trade.result.id === Item.MAP) &&
      cartographer.levels.flat().some((trade) => trade.result.id === Item.COMPASS),
  );
  check('村庄能摆的工作站清单跟着变长（村庄会自动摆上新的四种）', WORKSTATION_BLOCKS.length === PROFESSIONS.length);
  check('清单里没有重复方块', new Set(WORKSTATION_BLOCKS).size === WORKSTATION_BLOCKS.length);
  equal('普通方块不是工作站', professionForWorkstation(Block.STONE), undefined);

  // 四个新方块的"注册表三件套"：贴图在名单里、有中文名与说明、能徒手/按工具采到
  const newBlocks = [Block.LECTERN, Block.FLETCHING_TABLE, Block.GRINDSTONE, Block.LOOM];
  const tiles = newBlocks.flatMap((id) => blockTiles(id, 0));
  check('四个新方块的贴图都在图集名单里', tiles.every((tile) => TILES.has(tile)), tiles.join(','));
  check('四个新方块都有中文名', newBlocks.every((id) => !missingBlockNames().includes(String(blockDef(id).name).replace('minicraft:', ''))));
  check('四个新方块都有说明', newBlocks.every((id) => hasDescription(id)));
  // 工具表：砂轮是石头做的（要镐），三件木制的徒手也能采、斧更快
  equal('砂轮的加速工具是镐', efficientToolType(Block.GRINDSTONE), 'pickaxe');
  equal('讲台的加速工具是斧', efficientToolType(Block.LECTERN), 'axe');
  equal('制箭台的加速工具是斧', efficientToolType(Block.FLETCHING_TABLE), 'axe');
  equal('织布机的加速工具是斧', efficientToolType(Block.LOOM), 'axe');
  check('四件都真的能采到（砂轮要镐、其余三件徒手即可）', harvestRequirement(Block.GRINDSTONE)?.tool === 'pickaxe' && harvestRequirement(Block.LECTERN) === undefined);
  check('isWorkstation 对石头是假', !isWorkstation(Block.STONE));

  const robe = new Set(PROFESSIONS.map((p) => p.robeColor));
  equal('长袍颜色两两不同（一眼能分出谁是谁）', robe.size, PROFESSIONS.length);
  check('没有职业用"无业色"当长袍（否则认不出无业者）', !robe.has(VILLAGER_IDLE_ROBE));

  const missingLevel = PROFESSIONS.filter((p) => p.levels.length !== VILLAGER_LEVELS.length);
  check('每个职业都是 5 级', missingLevel.length === 0, missingLevel.map((p) => professionLabel(p.id)).join(','));

  const emptyLevel: string[] = [];
  const badCost: string[] = [];
  const badNumbers: string[] = [];
  for (const profession of PROFESSIONS) {
    profession.levels.forEach((specs, index) => {
      if (specs.length === 0) emptyLevel.push(`${professionLabel(profession.id)} L${index + 1}`);
      for (const spec of specs) {
        if (spec.cost.length < 1 || spec.cost.length > 2) badCost.push(`${professionLabel(profession.id)} L${index + 1}`);
        for (const cost of spec.cost) {
          if (cost.count <= 0 || !Number.isInteger(cost.count)) badNumbers.push(`${professionLabel(profession.id)}:${cost.id}`);
          if (itemDef(cost.id) === undefined) badNumbers.push(`未知物品 ${cost.id}`);
        }
        if (spec.result.count <= 0 || !Number.isInteger(spec.result.count)) badNumbers.push(profession.id);
        if (itemDef(spec.result.id) === undefined) badNumbers.push(`未知产物 ${spec.result.id}`);
        if (spec.maxUses <= 0 || spec.xp <= 0) badNumbers.push(`${professionLabel(profession.id)} 次数/经验`);
      }
    });
  }
  check('每一级都有交易', emptyLevel.length === 0, emptyLevel.join(','));
  check('每条交易收 1~2 样东西', badCost.length === 0, badCost.join(','));
  check('数量/次数/经验都是正整数、物品都注册过', badNumbers.length === 0, badNumbers.join(','));

  // 买卖两个方向都要有：不然"绿宝石经济"是单向的（只出不进或只进不出）
  const noBuy = PROFESSIONS.filter((p) => !p.levels.some((l) => l.some((s) => s.result.id === Item.EMERALD)));
  const noSell = PROFESSIONS.filter((p) => !p.levels.some((l) => l.some((s) => s.cost.some((c) => c.id === Item.EMERALD))));
  check('每个职业都收东西给绿宝石', noBuy.length === 0, noBuy.map((p) => professionLabel(p.id)).join(','));
  check('每个职业也都卖东西收绿宝石', noSell.length === 0, noSell.map((p) => professionLabel(p.id)).join(','));
}

console.log('\n[职业表：规模]');
{
  const total = PROFESSIONS.reduce((sum, p) => sum + totalOfferCount(p), 0);
  console.log(`  共 ${total} 条交易（${PROFESSIONS.map((p) => `${professionLabel(p.id)} ${totalOfferCount(p)}`).join(' / ')}）`);
  check('每种职业至少 5 条交易', PROFESSIONS.every((p) => totalOfferCount(p) >= 5));
  check('总量至少 60 条', total >= 60, String(total));
}

// ---------------------------------------------------------------- 2. 可达性

console.log('\n[可达性：交易两边的物品都拿得到]');
{
  const obtainable = new Set<number>();
  for (const recipe of RECIPES) obtainable.add(recipe.result.id);
  for (const recipe of SMELTING_RECIPES) obtainable.add(recipe.output.id);
  // 挖方块能掉的（含**稀有掉落**那一张：树叶掉苹果不在 `dropFor` 的答案里）
  for (const id of possibleBlockDropIds()) obtainable.add(id);
  for (const type of [...MOB_TYPES, DRAGON_TYPE]) {
    for (const drop of type.drops) obtainable.add(drop.itemId);
  }
  for (const id of fishingEntryIds()) obtainable.add(id);
  // 结构里的战利品箱（荧石粉就是靠它——它没有方块来源）
  for (const id of lootItemIds()) obtainable.add(id);

  // ⚠️ 批次 169：这里只判**收货**那一侧。产物不必另有来源——
  // 商店**本身就可以是**某件东西的唯一来源（锁链甲就是这样：原版没有配方，
  // 只能靠盔甲匠或穿甲的怪物，而本项目没有个体装备层，见 TASKS B53）。
  // 之前那条"产物也要能拿到"的断言会把"用交易补上一个来源"这件事判成错误。
  const unreachable: string[] = [];
  for (const profession of PROFESSIONS) {
    for (const specs of profession.levels) {
      for (const spec of specs) {
        for (const cost of spec.cost) {
          if (!obtainable.has(cost.id)) unreachable.push(`${professionLabel(profession.id)}:收 ${itemDef(cost.id)?.name ?? cost.id}`);
        }
      }
    }
  }
  check('每条交易的收货都能拿到（卖的可以只有交易这一条来源）', unreachable.length === 0, unreachable.join(','));

  // 锁链甲三件：**交易是它们唯一的来源**，这条断言盯着"别哪天顺手把哪一条交易删了"
  const chainmailPieces = (['helmet', 'leggings', 'boots'] as const).map((type) => armorItemId(type, 'chainmail'));
  check(
    '锁链甲三件都由村民卖（B53：没有配方也没关系，交易就是来源）',
    chainmailPieces.every((id) =>
      PROFESSIONS.some((profession) =>
        profession.levels.some((level) => level.some((spec) => spec.result.id === id)),
      ),
    ),
  );

  // 整套交易的"血液"：绿宝石。它拿不到的话，这一批在生存里一点用都没有
  check('绿宝石矿掉绿宝石（整套交易的前提）', dropFor(Block.EMERALD_ORE)?.id === Item.EMERALD);
  check('村民爱吃的东西都能拿到', VILLAGER_FOODS.every((id) => obtainable.has(id)));
}

// ---------------------------------------------------------------- 3. 等级

console.log('\n[等级：经验是唯一的输入]');
{
  equal('阈值表就是原版那 5 档', TRADE_XP_THRESHOLDS.length, VILLAGER_LEVELS.length);
  equal('0 点还是新手', levelForTradeXp(0), 1);
  equal('9 点还是新手（差一点）', levelForTradeXp(9), 1);
  equal('10 点升学徒', levelForTradeXp(10), 2);
  equal('69 点还是学徒', levelForTradeXp(69), 2);
  equal('70 点升老手', levelForTradeXp(70), 3);
  equal('150 点升专家', levelForTradeXp(150), 4);
  equal('250 点升大师', levelForTradeXp(250), 5);
  equal('9999 点还是大师（封顶）', levelForTradeXp(9999), 5);
  equal('负数当成 0（脏数据不炸）', levelForTradeXp(-5), 1);

  equal('等级名：1', levelName(1), '新手');
  equal('等级名：5', levelName(5), '大师');
  equal('等级名越界也夹得住', levelName(99), '大师');

  const farmer = professionById('farmer')!;
  equal('1 级只有第 1 级那一批', offersForLevel(farmer, 1).length, farmer.levels[0]!.length);
  equal('5 级是全部', offersForLevel(farmer, 5).length, totalOfferCount(farmer));
  check(
    '等级越高交易越多（单调）',
    [1, 2, 3, 4, 5].every((level) => offersForLevel(farmer, level).length >= offersForLevel(farmer, level - 1).length),
  );
  equal('每一级解锁的那一批可以单独取（升级用它）', offersUnlockedAt(farmer, 2).length, farmer.levels[1]!.length);
  equal('第 6 级没有任何新交易', offersUnlockedAt(farmer, 6).length, 0);
  check('建出来的交易都带"第几级解锁"', offersForLevel(farmer, 3).every((offer) => offer.level >= 1 && offer.level <= 3));
}

// ---------------------------------------------------------------- 4. 成交判定

console.log('\n[成交判定]');
{
  const farmer = professionById('farmer')!;
  const [wheatTrade, breadTrade] = offersForLevel(farmer, 1);

  // 小麦 20 个换 1 绿宝石
  equal('缺材料时说清还差几个', tradeBlocker(wheatTrade!, bag({ [Item.WHEAT]: 17 })), '材料不够（还差 3 个）');
  equal('够了就放行', tradeBlocker(wheatTrade!, bag({ [Item.WHEAT]: 20 })), null);

  // 材料不够时给的是"缺的那一件"
  const clericOffer = offersForLevel(professionById('cleric')!, 5).find((offer) => offer.xp === 30)!;
  equal('够的时候放行', tradeBlocker(clericOffer, bag({ [Item.GOLD_INGOT]: 3 })), null);
  check(
    '缺的是哪一件就说哪一件',
    tradeBlocker(clericOffer, bag({ [Item.GOLD_INGOT]: 1 }))?.includes('还差 2') === true,
  );

  // 次数用完
  const used = { ...offersForLevel(farmer, 1)[1]!, uses: 12, maxUses: 12 };
  check('次数用完时提示"用完了"', tradeBlocker(used, bag({ [Item.EMERALD]: 64 }))?.includes('用完') === true);

  // 结算数据必须是副本：**逐项**都是新对象（数组拷了、元素没拷是个老坑）
  const settlement = tradeSettlement(breadTrade!);
  equal('结算里的产物', settlement.give.id, Item.BREAD);
  check('产物对象是副本', settlement.give !== breadTrade!.result);
  check('收货项也是副本', settlement.take[0] !== breadTrade!.cost[0]);
  settlement.give.count = 999;
  equal('改结算结果不影响 offer 里的产物', breadTrade!.result.count, 6);
}

// ---------------------------------------------------------------- 5. 村民实体

console.log('\n[村民实体：认领职业与升级]');
{
  const villager = new Villager(0.5, 64, 0.5);
  check('造出来就是 Villager', villager instanceof Villager && villager instanceof Mob);
  equal('默认无业', villager.professionId, null);
  equal('默认 1 级', villager.level, 1);
  equal('默认没有交易', villager.offers.length, 0);
  equal('默认外观版本是"无业"', villager.appearanceKey, 'idle');

  equal('认领农民成功', villager.assignProfession('farmer'), true);
  equal('职业记下来了', villager.professionId, 'farmer');
  equal('1 级只解锁第 1 级那批', villager.offers.length, professionById('farmer')!.levels[0]!.length);
  equal('重复认领无效', villager.assignProfession('butcher'), false);
  equal('职业没被换掉', villager.professionId, 'farmer');
  equal('外观版本跟着职业走', villager.appearanceKey, 'farmer');

  equal('给 10 点经验正好升一级', villager.addTradeXp(10), 1);
  equal('等级到学徒', villager.level, 2);
  equal(
    '新交易已经追加进来（1 级 + 2 级）',
    villager.offers.length,
    professionById('farmer')!.levels[0]!.length + professionById('farmer')!.levels[1]!.length,
  );
  equal('再给 60 点又升一级（70 到老手）', villager.addTradeXp(60), 1);
  equal('一次给一大笔会连升', villager.addTradeXp(180), 2);
  equal('封顶在大师', villager.level, 5);
  equal('到大使之后给了经验也不升级', villager.addTradeXp(100), 0);
  equal('全部交易都在表里', villager.offers.length, totalOfferCount(professionById('farmer')!));

  const child = new Villager(0, 64, 0);
  child.makeBaby();
  equal('幼体不认领职业', child.assignProfession('farmer'), false);

  const summary = villager.tradeSummary;
  equal('调试视图：职业', summary.profession, 'farmer');
  equal('调试视图：等级', summary.level, 5);
  equal('调试视图：交易条数', summary.offers.length, totalOfferCount(professionById('farmer')!));
}

// ---------------------------------------------------------------- 6. 工作站扫描

console.log('\n[工作站扫描]');
{
  const near = world({ '2,64,0': Block.COMPOSTER });
  const found = findWorkstationNear(near, 0.5, 64, 0.5);
  equal('3 格内能找到', found?.block, Block.COMPOSTER);
  equal('找的是那一格', `${found?.x},${found?.y},${found?.z}`, '2,64,0');

  const far = world({ [`${WORKSTATION_SCAN_RANGE + 4},64,0`]: Block.COMPOSTER });
  equal('超出范围就找不到（不许隔空认领）', findWorkstationNear(far, 0.5, 64, 0.5), null);

  const high = world({ '0,70,0': Block.COMPOSTER });
  equal('高出范围也找不到', findWorkstationNear(high, 0.5, 64, 0.5), null);

  const notStation = world({ '2,64,0': Block.STONE });
  equal('石头不是工作站', findWorkstationNear(notStation, 0.5, 64, 0.5), null);

  // 两个工作站时取近的（结果确定，不看扫描顺序）
  const two = world({ '1,64,0': Block.COMPOSTER, '6,64,0': Block.SMOKER });
  equal('两个工作站时认领最近的那个', findWorkstationNear(two, 0.5, 64, 0.5)?.block, Block.COMPOSTER);
}

// ---------------------------------------------------------------- 7. 生物表与生成

console.log('\n[生物表与生成]');
{
  check('村民在生物表里', MOB_TYPES.includes(VILLAGER_TYPE));
  equal('按 id 查得到', mobTypeById('villager'), VILLAGER_TYPE);
  check('村民是被动生物', !VILLAGER_TYPE.hostile);
  equal('村民不掉落（原版也不掉）', VILLAGER_TYPE.drops.length, 0);
  equal('击杀经验为 0（原版村民也不给经验）', VILLAGER_TYPE.xp, 0);

  // ⚠️ 最容易出错的一条：把村民写进 MOB_TYPES 却没排除自然生成，
  // 它就会被撒在草地上（那是"看起来像 bug"的错）
  check('不在自然生成的被动表里', !PASSIVE_MOBS.includes(VILLAGER_TYPE));
  check('也不在敌对表里', !HOSTILE_MOBS.includes(VILLAGER_TYPE));
  check('其它被动生物照旧在自然生成表里（牛还在）', PASSIVE_MOBS.some((type) => type.id === 'cow'));

  check('村民吃面包', mobEats(VILLAGER_TYPE, Item.BREAD));
  check('村民也吃胡萝卜/马铃薯/甜菜根', VILLAGER_FOODS.every((id) => mobEats(VILLAGER_TYPE, id)));
  check('村民不吃小麦（没做过的原版就不该吃）', !mobEats(VILLAGER_TYPE, Item.WHEAT));
  check('isVillagerFood 与生物表一致', isVillagerFood(Item.BREAD) && !isVillagerFood(Item.WHEAT));
  const cow = mobTypeById('cow')!;
  check('牛羊那种"一样"的写法不受影响', mobEats(cow, cow.feed as number) && !mobEats(cow, Item.BREAD));

  // 工厂：这是"一群不会做生意的村民"的唯一防线
  check('工厂造出来的是 Villager', createMob(VILLAGER_TYPE, 0, 64, 0) instanceof Villager);
  check('工厂造别的还是普通 Mob', !(createMob(mobTypeById('cow')!, 0, 64, 0) instanceof Villager));
}

// ---------------------------------------------------------------- 8. 外观与进度

console.log('\n[外观：颜色跟着职业走]');
{
  const villager = new Villager(0, 64, 0);
  equal('主色是皮肤色（头与手）', mobBodyColor(villager), VILLAGER_SKIN_COLOR);
  equal('无业时长袍是褐色', mobAccentColor(villager), VILLAGER_IDLE_ROBE);
  equal('无业时的外观版本', mobAppearanceKey(villager), 'idle');

  villager.assignProfession('cleric');
  equal('认领牧师后长袍换成紫色', mobAccentColor(villager), professionById('cleric')!.robeColor);
  equal('外观版本跟着变（渲染层据此重建模型）', mobAppearanceKey(villager), 'cleric');

  // 没被带偏的生物：牛的主色还是种类表里的那个
  const cow = new Mob(mobTypeById('cow')!, 0, 64, 0);
  equal('牛的主色不受影响', mobBodyColor(cow), mobTypeById('cow')!.bodyColor);
  equal('牛的点缀色不受影响', mobAccentColor(cow), mobTypeById('cow')!.accentColor);
  equal('普通生物没有外观版本', mobAppearanceKey(cow), '');

  const sheep = new Mob(mobTypeById('sheep')!, 0, 64, 0);
  equal('羊的外观版本是"有毛"', mobAppearanceKey(sheep), 'woolly');
  sheep.shear();
  equal('剪过之后变成"剪了"', mobAppearanceKey(sheep), 'sheared');
}

console.log('\n[进度：与村民交易]');
{
  const def = advancementById('minicraft:adventure/trade');
  check('那条进度在表里', def !== undefined);
  equal('触发条件是"成交一笔"', def?.trigger.kind, 'trade');
  equal('图标是绿宝石', def?.icon, Item.EMERALD);

  const tracker = new AdvancementTracker();
  const before = tracker.handle({ kind: 'trade' });
  equal('父条目没亮时拿不到', before.length, 0);
  tracker.grant('minicraft:adventure/root');
  const after = tracker.handle({ kind: 'trade' });
  check('亮过根条目之后能拿到', after.some((item) => item.id === 'minicraft:adventure/trade'));
}

// ---------------------------------------------------------------- 9. 存档往返

console.log('\n[存档：职业与交易进度（批次 501）]');
{
  const source = new Villager(0.5, 64, 0.5);
  source.assignProfession('librarian');
  source.addTradeXp(80); // 老手 3 级
  source.offers[0]!.uses = 3;
  const saved = {
    profession: source.professionId!,
    xp: source.tradeXp,
    uses: source.offers.map((offer) => offer.uses),
  };

  const restored = new Villager(0, 64, 0);
  equal('恢复成功', restored.restoreState(saved), true);
  equal('职业回来了', restored.professionId, 'librarian');
  equal('经验回来了', restored.tradeXp, 80);
  equal('等级由经验算出来（3 级）', restored.level, 3);
  equal('交易清单按等级重建', restored.offers.length, offersForLevel(professionById('librarian')!, 3).length);
  equal('已交易次数跟着回来', restored.offers[0]!.uses, 3);

  const dirty = new Villager(0, 64, 0);
  equal('不认识的职业：拒绝恢复', dirty.restoreState({ profession: 'astronaut', xp: 10, uses: [] }), false);
  equal('拒绝之后还是无业', dirty.professionId, null);
  equal('没有数据：拒绝恢复', dirty.restoreState(undefined), false);

  const negative = new Villager(0, 64, 0);
  negative.restoreState({ profession: 'farmer', xp: -50, uses: [] });
  equal('负经验夹到 0', negative.tradeXp, 0);
  equal('负经验还是 1 级', negative.level, 1);

  // 次数上限：先按 5 级的交易条数造一份长度正确的 uses，再逐项超限
  const maxed = new Villager(0, 64, 0);
  const overUses = offersForLevel(professionById('farmer')!, 5).map(() => 999);
  maxed.restoreState({ profession: 'farmer', xp: 1e9, uses: overUses });
  equal('经验上限夹住（不会撑成天文数字）', maxed.tradeXp, 1_000_000);
  check('次数不超过 maxUses', maxed.offers.every((offer) => offer.uses <= offer.maxUses));

  const mismatch = new Villager(0, 64, 0);
  mismatch.restoreState({ profession: 'farmer', xp: 0, uses: [5] });
  check(
    'uses 长度对不上时整份丢弃（职业与经验照常恢复）',
    mismatch.professionId === 'farmer' && mismatch.offers.every((offer) => offer.uses === 0),
  );

  const child = new Villager(0, 64, 0);
  child.makeBaby();
  equal('幼体不恢复职业', child.restoreState({ profession: 'farmer', xp: 10, uses: [] }), false);
}

console.log('\n[存档：实体寄存把村民状态带上]');
{
  const parking = new EntityParking();
  parking.restoreAll([{
    dimension: 'overworld',
    kind: 'mob',
    typeId: 'villager',
    x: 2,
    y: 64,
    z: 3,
    yaw: 0,
    health: 20,
    tamed: false,
    sitting: false,
    leashed: false,
    sheared: false,
    woolColor: 0,
    baby: false,
    growSeconds: 0,
    villager: { profession: 'librarian', xp: 80, uses: [3, 1] },
  }]);
  // 走一遍 JSON（存档层就是这么序列化的），确认字段不是"只在内存里"
  const records = JSON.parse(JSON.stringify(parking.snapshotAll())) as SavedEntityRecord[];
  const revived = new EntityParking();
  revived.restoreAll(records);
  const [record] = revived.take('overworld', 0, 0);
  equal(
    '寄存往返保住职业',
    record && record.kind === 'mob' ? record.villager?.profession : undefined,
    'librarian',
  );
  equal(
    '寄存往返保住交易次数',
    record && record.kind === 'mob' ? record.villager?.uses[0] : undefined,
    3,
  );

  // 脏数据：职业不是字符串 → 整个 villager 键丢掉（不能让读档炸掉）
  const dirtyParking = new EntityParking();
  dirtyParking.restoreAll([
    {
      dimension: 'overworld',
      kind: 'mob',
      typeId: 'villager',
      x: 0,
      y: 64,
      z: 0,
      yaw: 0,
      health: 20,
      tamed: false,
      sitting: false,
      leashed: false,
      sheared: false,
      woolColor: 0,
      baby: false,
      growSeconds: 0,
      villager: { profession: 42, xp: 'x', uses: [] },
    },
  ] as unknown as SavedEntityRecord[]);
  const [bad] = dirtyParking.take('overworld', 0, 0);
  equal('脏 villager 字段整个丢掉', bad && bad.kind === 'mob' ? bad.villager : 'kept', undefined);
}


// ---------------------------------------------------------------- 需求与每日补货（批次 509）

console.log('\n[需求与涨价]');
{
  const farmer = professionById('farmer')!;
  const offer = offersForLevel(farmer, 1)[0]!;
  const baseCosts = offer.cost.map((cost) => ({ ...cost }));

  equal('初始需求 0', tradeDemand(offer), 0);
  equal('初始不涨价', tradePriceDelta(offer), 0);
  equal(
    '初始价格就是表价',
    JSON.stringify(adjustedTradeCosts(offer)),
    JSON.stringify(baseCosts),
  );

  recordTradeUse(offer);
  equal('成交一次：次数 +1', offer.uses, 1);
  equal('成交一次：需求 +1', tradeDemand(offer), 1);
  equal('1 点需求还不涨价', tradePriceDelta(offer), 0);

  recordTradeUse(offer);
  equal('2 点需求：+1', tradePriceDelta(offer), 1);
  equal('第一样收货 +1', adjustedTradeCosts(offer)[0]!.count, baseCosts[0]!.count + 1);
  if (baseCosts.length > 1) {
    equal('第二样不涨', adjustedTradeCosts(offer)[1]!.count, baseCosts[1]!.count);
  }
  equal('不改原表（结算必须拿副本）', offer.cost[0]!.count, baseCosts[0]!.count);

  for (let i = 0; i < 12; i++) recordTradeUse(offer);
  equal('需求量封顶', tradeDemand(offer), MAX_TRADE_DEMAND);
  equal('涨价封顶 +3', tradePriceDelta(offer), 3);
  check('成交次数不超过上限', offer.uses <= offer.maxUses, `${offer.uses} / ${offer.maxUses}`);
  for (let i = 0; i < 40; i++) recordTradeUse(offer);
  equal('次数刷到上限就停住', offer.uses, offer.maxUses);

  // 阻塞判据必须按**涨价后**的价格算，否则界面说能做、实际扣不够。
  // 用一条**没用完**的交易（上面那条的次数已经刷满了）
  const priced = offersForLevel(farmer, 1)[0]!;
  priced.demand = 4; // → +2
  const costs = adjustedTradeCosts(priced);
  const justShort: Record<number, number> = {};
  for (const cost of costs) justShort[cost.id] = cost.count;
  justShort[costs[0]!.id] = costs[0]!.count - 1;
  equal('差一个就拦住', tradeBlocker(priced, bag(justShort)), '材料不够（还差 1 个）');

  const enough: Record<number, number> = {};
  for (const cost of costs) enough[cost.id] = cost.count;
  equal('给够就放行', tradeBlocker(priced, bag(enough)), null);

  equal(
    '结算拿的是涨价后的数量',
    tradeSettlement(priced).take[0]!.count,
    costs[0]!.count,
  );
}

console.log('\n[每日补货]');
{
  const villager = new Villager(0, 64, 0);
  villager.assignProfession('farmer');
  const offer = villager.offers[0]!;
  for (let i = 0; i < 4; i++) recordTradeUse(offer);
  const demandBefore = tradeDemand(offer);
  equal('补货前用掉 4 次', offer.uses, 4);

  equal('补货条数 = 交易条数', villager.restock(), villager.offers.length);
  equal('次数清零', offer.uses, 0);
  equal('需求降 1', tradeDemand(offer), demandBefore - 1);

  equal('无业村民没有可补的', new Villager(0, 64, 0).restock(), 0);
}

console.log('\n[需求进存档]');
{
  const source = new Villager(0, 64, 0);
  source.assignProfession('farmer');
  source.offers[0]!.uses = 2;
  source.offers[0]!.demand = 4;

  const restored = new Villager(0, 64, 0);
  restored.restoreState({
    profession: 'farmer',
    xp: 0,
    uses: source.offers.map((offer) => offer.uses),
    demand: source.offers.map((offer) => tradeDemand(offer)),
  });
  equal('需求往返', tradeDemand(restored.offers[0]!), 4);
  equal('价格按需求算回来', tradePriceDelta(restored.offers[0]!), 2);

  const mismatched = new Villager(0, 64, 0);
  mismatched.restoreState({
    profession: 'farmer',
    xp: 0,
    uses: source.offers.map((offer) => offer.uses),
    demand: [9],
  });
  equal('长度不符整份丢弃', tradeDemand(mismatched.offers[0]!), 0);

  const dirty = new Villager(0, 64, 0);
  dirty.restoreState({
    profession: 'farmer',
    xp: 0,
    uses: source.offers.map((offer) => offer.uses),
    demand: source.offers.map(() => 999),
  });
  equal('脏数据夹到上限', tradeDemand(dirty.offers[0]!), MAX_TRADE_DEMAND);

  const missing = new Villager(0, 64, 0);
  missing.restoreState({
    profession: 'farmer',
    xp: 0,
    uses: source.offers.map((offer) => offer.uses),
  });
  equal('老存档没有 demand → 0', tradeDemand(missing.offers[0]!), 0);
}

console.log('\n[需求随实体寄存往返]');
{
  const parking = new EntityParking();
  parking.restoreAll([{
    dimension: 'overworld',
    kind: 'mob',
    typeId: 'villager',
    x: 1,
    y: 64,
    z: 1,
    yaw: 0,
    health: 20,
    tamed: false,
    sitting: false,
    leashed: false,
    sheared: false,
    woolColor: 0,
    baby: false,
    growSeconds: 0,
    villager: { profession: 'farmer', xp: 0, uses: [1], demand: [5] },
  }]);
  const [record] = parking.take('overworld', 0, 0);
  equal(
    '寄存往返保住需求',
    record && record.kind === 'mob' ? record.villager?.demand?.[0] : undefined,
    5,
  );

  const dirtyParking = new EntityParking();
  dirtyParking.restoreAll([{
    dimension: 'overworld',
    kind: 'mob',
    typeId: 'villager',
    x: 1,
    y: 64,
    z: 1,
    yaw: 0,
    health: 20,
    tamed: false,
    sitting: false,
    leashed: false,
    sheared: false,
    woolColor: 0,
    baby: false,
    growSeconds: 0,
    villager: { profession: 'farmer', xp: 0, uses: [1, 2], demand: [999, 'x'] },
  }] as unknown as SavedEntityRecord[]);
  const [dirtyRecord] = dirtyParking.take('overworld', 0, 0);
  const dirtyDemand =
    dirtyRecord && dirtyRecord.kind === 'mob' ? dirtyRecord.villager?.demand : undefined;
  equal('脏需求夹到上限', dirtyDemand?.[0], MAX_TRADE_DEMAND);
  equal('非数字需求归 0', dirtyDemand?.[1], 0);
}


// ---------------------------------------------------------------- 作息（批次 510）

console.log('\n[作息：白天上班、夜里回家]');
{
  equal('日出后上班', villagerRoutine(VILLAGER_WORK_START, true, true), 'work');
  equal('正午上班', villagerRoutine(0.25, true, true), 'work');
  equal('日落前仍上班', villagerRoutine(VILLAGER_WORK_END - 0.001, true, true), 'work');
  equal('日落后回家', villagerRoutine(VILLAGER_WORK_END, true, true), 'home');
  equal('午夜在家', villagerRoutine(0.75, true, true), 'home');
  equal('日出前在家', villagerRoutine(0.001, true, true), 'home');

  equal('无业：白天也不上班', villagerRoutine(0.25, false, true), 'idle');
  equal('没有床：晚上也不回家', villagerRoutine(0.75, true, false), 'idle');
  equal('什么都没有 → idle', villagerRoutine(0.25, false, false), 'idle');

  equal('负时间规整（-0.1 → 0.9）', normalizeTimeOfDay(-0.1), 0.9);
  check('超过 1 规整（1.2 → 0.2）', Math.abs(normalizeTimeOfDay(1.2) - 0.2) < 1e-9);
  equal('NaN 按正午（至少不会全村同时回家）', normalizeTimeOfDay(Number.NaN), 0.25);
  equal('负时间走夜间分支', villagerRoutine(-0.1, true, true), 'home');
  equal('超过 1 的时间也走对分支', villagerRoutine(1.2, true, true), 'work');
}

console.log('\n[作息：目的地与到达判定]');
{
  const home = { x: 10, y: 64, z: 10 };
  const work = { x: 20, y: 64, z: 20 };
  equal('上班去工作站', routineTarget('work', home, work)?.x, 20);
  equal('回家去床边', routineTarget('home', home, work)?.x, 10);
  equal('idle 没有目标', routineTarget('idle', home, work), null);

  check('目标点中心算到达', villagerArrived(20.5, 20.5, work));
  check('差一格也算到达', villagerArrived(21.5, 20.5, work));
  check('差两格不算到达', !villagerArrived(22.5, 20.5, work));
  check('半径与常量一致', VILLAGER_ARRIVE_RADIUS === 1.6);
}

console.log('\n[作息坐标进存档与寄存]');
{
  const source = new Villager(0, 64, 0);
  source.assignProfession('farmer', { x: 5, y: 64, z: 6 });
  source.setHome({ x: 1, y: 64, z: 2 });

  const restored = new Villager(0, 64, 0);
  restored.restoreState({
    profession: 'farmer',
    xp: 0,
    uses: source.offers.map((offer) => offer.uses),
    home: { x: 1, y: 64, z: 2 },
    workstation: { x: 5, y: 64, z: 6 },
  });
  equal('家读回来', restored.home?.x, 1);
  equal('工作站读回来', restored.workstation?.x, 5);

  const dirty = new Villager(0, 64, 0);
  dirty.restoreState({
    profession: 'farmer',
    xp: 0,
    uses: source.offers.map((offer) => offer.uses),
    home: { x: Number.NaN, y: 64, z: 2 },
    workstation: { x: 5, y: 64 },
  } as never);
  equal('坏的家整份丢掉', dirty.home, null);
  equal('坏的工作站整份丢掉', dirty.workstation, null);

  const parking = new EntityParking();
  parking.restoreAll([
    {
      dimension: 'overworld',
      kind: 'mob',
      typeId: 'villager',
      x: 1,
      y: 64,
      z: 1,
      yaw: 0,
      health: 20,
      tamed: false,
      sitting: false,
      leashed: false,
      sheared: false,
      woolColor: 0,
      baby: false,
      growSeconds: 0,
      villager: {
        profession: 'farmer',
        xp: 0,
        uses: [0],
        home: { x: 1, y: 64, z: 2 },
        workstation: { x: 5, y: 64, z: 6 },
      },
    },
  ]);
  const [record] = parking.take('overworld', 0, 0);
  equal(
    '寄存往返保住家',
    record && record.kind === 'mob' ? record.villager?.home?.z : undefined,
    2,
  );
  equal(
    '寄存往返保住工作站',
    record && record.kind === 'mob' ? record.villager?.workstation?.x : undefined,
    5,
  );
}

console.log('\n[接线守卫]');
{
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  check('村庄人口给村民设了家', mainSrc.includes('villager.setHome({ x: plan.bedX'));
  check('主程序每 0.5 秒下发作息指令', mainSrc.includes('this.villagerRoutineTimer = 0.5'));
  check(
    '作息在实体 tick 之前',
    // MS3 之后实体推进改成多行调用（多了 shouldTick 过滤），比对前缀即可
    mainSrc.indexOf('this.tickVillagerRoutine()') < mainSrc.indexOf('this.entities.update('),
  );
}


// ---------------------------------------------------------------- 恐慌（批次 511）

console.log('\n[恐慌：谁会吓到村民]');
{
  const scared = ['zombie', 'husk', 'drowned', 'zombie_villager', 'pillager', 'vindicator', 'evoker', 'illusioner', 'ravager', 'vex'];
  const calm = ['creeper', 'skeleton', 'spider', 'sheep', 'villager', 'iron_golem'];
  check('僵尸系与灾厄系都会吓到村民', scared.every((id) => isPanicThreat(id)), scared.filter((id) => !isPanicThreat(id)).join(','));
  check('苦力怕/骷髅/蜘蛛不会（原版也不恐慌）', calm.every((id) => !isPanicThreat(id)), calm.filter((id) => isPanicThreat(id)).join(','));

  const candidates = [
    { typeId: 'sheep', x: 1, z: 0 },
    { typeId: 'zombie', x: 5, z: 0 },
    { typeId: 'vindicator', x: 3, z: 0 },
  ];
  equal('取最近的威胁（忽略非威胁）', nearestPanicThreat(0, 0, candidates)?.typeId, 'vindicator');
  equal('半径内没有就 null', nearestPanicThreat(0, 0, [{ typeId: 'zombie', x: 9, z: 0 }]), null);
  check('刚好在半径上算看见', nearestPanicThreat(0, 0, [{ typeId: 'zombie', x: VILLAGER_PANIC_RADIUS, z: 0 }]) !== null);
  check('超出半径不算', nearestPanicThreat(0, 0, [{ typeId: 'zombie', x: VILLAGER_PANIC_RADIUS + 0.1, z: 0 }]) === null);
}

console.log('\n[恐慌：往哪跑]');
{
  const point = fleePointFrom(2, 0, 0, 0);
  equal('朝远离威胁的方向', point.x, 2 + VILLAGER_FLEE_DISTANCE);
  equal('z 方向不偏', point.z, 0);
  check('距离等于逃跑距离', Math.abs(Math.hypot(point.x - 2, point.z) - VILLAGER_FLEE_DISTANCE) < 1e-9);
  const same = fleePointFrom(4, 4, 4, 4);
  equal('贴在同一格时朝 +X 跑（不产生 NaN）', same.x, 4 + VILLAGER_FLEE_DISTANCE);
  equal('贴在同一格时 z 不变', same.z, 4);
}

console.log('\n[恐慌：计时与加速]');
{
  const villager = new Villager(0, 64, 0);
  equal('平时速度倍率 1', villager.movementScale, 1);
  check('平时不恐慌', !villager.panicking);

  villager.panicFrom(5, 0);
  check('看到威胁就恐慌', villager.panicking);
  equal('恐慌时长', villager.panicSeconds, VILLAGER_PANIC_SECONDS);
  equal('恐慌时速度倍率', villager.movementScale, VILLAGER_PANIC_SPEED);

  villager.advancePanic(2);
  equal('两秒后还剩三秒', villager.panicSeconds, 3);
  villager.advancePanic(10);
  equal('超时归零', villager.panicSeconds, 0);
  check('归零后不再恐慌', !villager.panicking);
  equal('速度回到 1', villager.movementScale, 1);
  villager.advancePanic(5);
  equal('没有恐慌时递减也不出负数', villager.panicSeconds, 0);
  villager.panicStep();
  check('没有逃跑目标时 panicStep 不抛异常', true);
}

console.log('\n[恐慌：接线守卫]');
{
  const mainSrc = readFileSync(new URL('../web/src/main.ts', import.meta.url), 'utf8');
  check('主程序识别恐慌威胁', mainSrc.includes('isPanicThreat(entity.type.id)'));
  check('恐慌源被记进优先集', mainSrc.includes('this.panicThreats.add(threatened.mob)'));
  check(
    '作息先于守卫结算（优先集要先生成）',
    mainSrc.indexOf('this.tickVillagerRoutine();') < mainSrc.indexOf('this.tickGuardians(context, dt);'),
  );
  check('铁傀儡优先打恐慌源', mainSrc.includes('this.panicThreats.has(mob)'));
  const mobSrc = readFileSync(new URL('../web/src/core/entity/Mob.ts', import.meta.url), 'utf8');
  check('基类留了速度倍率钩子', mobSrc.includes('this.speedMultiplier()'));
}

// ---------------------------------------------------------------- 收尾

console.log(`\n村民与交易测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
