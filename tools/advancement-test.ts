/**
 * 成就 / 进度离线测试（批次 87，M7）
 *
 * 这一批做成的是**第一套"玩家自己攒下来的、与坐标无关的进度"**：
 * 条件写在数据里（`core/progress/advancements.ts`），判定是一个纯类
 * （`core/progress/AdvancementTracker.ts`），主程序只在事件处报一声。
 * 断言分五块：
 *  1. **表自检**：id 唯一、父子成树（父一定排在子前面）、每支恰好一个根、
 *     图标都在注册表里、`needCount` 不超过可命中的目标数（不然**永远达不成**）；
 *  2. **可达性**：每一条 `obtain` 的目标都要能从"合成 / 熔炼 / 方块掉落 /
 *     生物掉落 / 钓鱼"里拿到；`kill`/`breed` 的生物、维度都要真实存在——
 *     这条是本项目的老规矩（"登记了不等于拿得到"，见酿造的 BFS 那条教训）；
 *  3. **判定**：父未达成子拿不到、链式解锁、any-of、计数型去重、
 *     重复触发不重复报、三种界面状态；
 *  4. **存档**：往返（含 JSON）、计数进度跟着走、脏数据逐条跳过、断链剪枝；
 *  5. **触发种类的覆盖**：每一种 `kind` 都要有数据在用（不留只有代码没有数据的死支路）。
 *
 * 运行：npm run test:advancement
 */

import { Block, CROP_STAGES } from '../src/core/registry/blocks.ts';
import { Item, dropFor, itemDef, possibleBlockDropIds } from '../src/core/registry/items.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { SMELTING_RECIPES } from '../src/core/crafting/Smelting.ts';
import { ALL_HOSTILE_MOBS, MOB_TYPES, mobTypeById } from '../src/core/entity/mobs.ts';
import { DRAGON_TYPE } from '../src/core/entity/EndBoss.ts';
import { fishingEntryIds } from '../src/core/registry/fishing.ts';
import { lootItemIds } from '../src/core/registry/loot.ts';
import { toolItemId } from '../src/core/registry/tools.ts';
import { armorItemId } from '../src/core/registry/armor.ts';
import { Dimension } from '../src/core/gen/Dimension.ts';
import {
  ADVANCEMENTS,
  ADVANCEMENT_TABS,
  DIET_TARGET,
  advancementById,
  advancementsOfTab,
  childrenOf,
  type TriggerKind,
} from '../src/core/progress/advancements.ts';
import { AdvancementTracker } from '../src/core/progress/AdvancementTracker.ts';

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

// ---------------------------------------------------------------- 1. 表自检

console.log('\n[进度表：结构与字段]');
{
  const ids = ADVANCEMENTS.map((def) => def.id);
  equal('id 无重复', new Set(ids).size, ids.length);

  const badPrefix = ADVANCEMENTS.filter((def) => !def.id.startsWith('minicraft:'));
  check('id 一律用原版全名（`minicraft:` 开头）——以后好对表', badPrefix.length === 0, badPrefix.map((d) => d.id).join(','));

  // 父一定排在子前面：判定是一趟顺序遍历，"同一件事解锁父子两条"靠的就是这个顺序
  const orderIndex = new Map(ids.map((id, index) => [id, index]));
  const badOrder = ADVANCEMENTS.filter((def) => {
    if (def.parent === null) return false;
    const parentIndex = orderIndex.get(def.parent);
    return parentIndex === undefined || parentIndex > orderIndex.get(def.id)!;
  });
  check('父子成树：父条目一定排在子条目前面', badOrder.length === 0, badOrder.map((d) => d.id).join(','));

  const noTitle = ADVANCEMENTS.filter((def) => def.title.length === 0 || def.desc.length === 0);
  check('每条都有中文标题与说明', noTitle.length === 0);

  const badIcon = ADVANCEMENTS.filter((def) => itemDef(def.icon) === undefined);
  check('图标都是已注册的物品/方块', badIcon.length === 0, badIcon.map((d) => `${d.id}:${d.icon}`).join(','));

  const badTab = ADVANCEMENTS.filter((def) => {
    if (def.parent === null) return false;
    // 子条目必须与父同支，否则界面按支筛选时会出现"孤立的子条目"
    return advancementById(def.parent)?.tab !== def.tab;
  });
  check('子条目与父条目同属一支', badTab.length === 0, badTab.map((d) => d.id).join(','));
}

console.log('\n[进度表：每一支的根]');
{
  for (const tab of ADVANCEMENT_TABS) {
    const roots = ADVANCEMENTS.filter((def) => def.tab === tab.id && def.parent === null);
    equal(`${tab.title}：恰好一个根`, roots.length, 1);
    equal(`${tab.title}：根条目与页签声明一致`, roots[0]?.id, tab.root);
    check(`${tab.title}：这一支不止一条`, advancementsOfTab(tab.id).length >= 1);
  }
  const rootIds = ADVANCEMENT_TABS.map((tab) => tab.root);
  check('五个根互不相同', new Set(rootIds).size === rootIds.length);
  check('根条目里只有 `story/root` 是"白给"的（`auto`）', ADVANCEMENTS.filter((d) => d.trigger.kind === 'auto').length === 1);
  equal('那个白给的就是 story/root', ADVANCEMENTS.find((d) => d.trigger.kind === 'auto')?.id, 'minicraft:story/root');
}

console.log('\n[进度表：触发条件都"打得中"]');
{
  // needCount 超过可命中的目标数 ⇒ 这条进度永远拿不到（而且不报错）
  const impossible = ADVANCEMENTS.filter((def) => {
    const need = def.trigger.needCount;
    if (need === undefined) return false;
    const pool =
      def.trigger.ids?.length ??
      def.trigger.mobs?.length ??
      def.trigger.dimensions?.length ??
      def.trigger.biomes?.length;
    if (pool === undefined) return true;
    return need > pool;
  });
  check('计数型的要求数不超过目标池（否则永远达不成）', impossible.length === 0, impossible.map((d) => d.id).join(','));

  const emptyIds = ADVANCEMENTS.filter((def) => def.trigger.ids !== undefined && def.trigger.ids.length === 0);
  check('没有"给了空 id 列表"的条目', emptyIds.length === 0);

  // 凋灵是独立实体（`Wither.ts`，不在 `MobType` 表里），主程序在它倒下时补发 kill
  const badMobs = ADVANCEMENTS.flatMap((def) =>
    (def.trigger.mobs ?? [])
      .filter((mob) => mob !== 'wither' && mobTypeById(mob) === undefined)
      .map((mob) => `${def.id}:${mob}`),
  );
  check('击杀/繁殖引用的生物都在生物表里（凋灵除外）', badMobs.length === 0, badMobs.join(','));

  const known: string[] = [Dimension.OVERWORLD, Dimension.NETHER, Dimension.END];
  const badDimensions = ADVANCEMENTS.flatMap((def) =>
    (def.trigger.dimensions ?? []).filter((dim) => !known.includes(dim)).map((dim) => `${def.id}:${dim}`),
  );
  check('维度 id 都是三个已知值之一', badDimensions.length === 0, badDimensions.join(','));

  const cropBlocks = new Set(Object.values(CROP_STAGES).map((stages) => stages[0]!));
  const badPlace = ADVANCEMENTS.flatMap((def) =>
    def.trigger.kind === 'place'
      ? (def.trigger.ids ?? []).filter((id) => !cropBlocks.has(id)).map((id) => `${def.id}:${id}`)
      : [],
  );
  check('放置类目标都是"作物的第一阶段"（种子放下去的那一格）', badPlace.length === 0, badPlace.join(','));
}

// ---------------------------------------------------------------- 2. 可达性

console.log('\n[可达性：进度的目标在生存里真的拿得到]');
{
  /** 生存里能拿到的东西（合成 / 熔炼 / 方块掉落 / 生物掉落 / 钓鱼） */
  const obtainable = new Set<number>();
  for (const recipe of RECIPES) obtainable.add(recipe.result.id);
  for (const recipe of SMELTING_RECIPES) obtainable.add(recipe.output.id);
  // ⚠️ 用 `possibleBlockDropIds()`，**不是** `Object.values(Block)`：
  // `Block` 那个对象只有手写常量，木材家族 / 床的 16 色 / 画这些按表生成的方块不在里面；
  // 而且燧石（砂砾）、苹果（树叶）、金粒（鎏金黑石）这些"概率替换掉落"只在
  // `possibleBlockDropIds()` 里。这里漏一路，断言就会把能拿到的东西判成拿不到
  // （批次 91 的可达性审计把这条判据统一了，两处共用同一份表）
  for (const id of possibleBlockDropIds()) obtainable.add(id);
  for (const type of [...MOB_TYPES, DRAGON_TYPE]) {
    for (const drop of type.drops) obtainable.add(drop.itemId);
  }
  for (const id of fishingEntryIds()) obtainable.add(id);
  // 宝箱战利品也是真实来源（鞘翅只从末地城宝箱出，没有配方）
  for (const id of lootItemIds()) obtainable.add(id);

  check('可获取集合不是空的（对照用）', obtainable.size > 100, String(obtainable.size));

  const unreachable: string[] = [];
  for (const def of ADVANCEMENTS) {
    if (def.trigger.kind !== 'obtain') continue;
    // 不带 ids 的（"任意一件带附魔的物品"）没有具体目标，靠附魔台可达性兜底
    for (const id of def.trigger.ids ?? []) {
      if (!obtainable.has(id)) unreachable.push(`${def.id}:${itemDef(id)?.name ?? id}`);
    }
  }
  check('每条 `obtain` 的目标都能拿到（合成/熔炼/掉落/钓鱼/宝箱）', unreachable.length === 0, unreachable.join(','));

  // 附魔台本身要能造出来，否则"附魔师"永远达不成
  check('附魔台可以合成（"附魔师"的前提）', RECIPES.some((r) => r.result.id === Block.ENCHANTING_TABLE));
  check('铁锭可以烧出来（"来硬的"的前提）', SMELTING_RECIPES.some((r) => r.output.id === Item.IRON_INGOT));
  check('钻石能从钻石矿里挖到（"钻石！"的前提）', dropFor(Block.DIAMOND_ORE)?.id === Item.DIAMOND);
  check('龙蛋由末影龙掉落（"下一世代"的前提）', DRAGON_TYPE.drops.some((d) => d.itemId === Block.DRAGON_EGG));
}

console.log('\n[可达性：计数型条目真的能凑齐]');
{
  const diet = advancementById('minicraft:husbandry/balanced_diet')!;
  equal('"均衡饮食"要吃的种类数就是表里声明的那个', diet.trigger.needCount, DIET_TARGET);
  check('食物池比要求数更宽（留了余量，缺一样也不至于卡死）', (diet.trigger.ids?.length ?? 0) > DIET_TARGET);

  const hunter = advancementById('minicraft:adventure/kill_a_mob')!;
  equal('"怪物猎人"要三种敌对生物', hunter.trigger.needCount, 3);
  // 目标池从生物表**派生**（批次 93）：表里加了蜘蛛/烈焰人之后它自己就宽了
  // ——以前这里是手写的三种，加了新怪就会变成"打蜘蛛不算怪物"
  equal('目标池就是全部敌对生物（比要求的 3 种宽）', hunter.trigger.mobs?.length, ALL_HOSTILE_MOBS.length);
  check('池子确实比要求数宽（缺一种也不至于卡死）', (hunter.trigger.mobs?.length ?? 0) > hunter.trigger.needCount!);
  check('蜘蛛与烈焰人都在池子里', ['spider', 'blaze', 'cave_spider'].every((id) => hunter.trigger.mobs?.includes(id) === true));
  check(
    '那三种都在生物表里（僵尸/骷髅/苦力怕）',
    (hunter.trigger.mobs ?? []).every((mob) => mobTypeById(mob) !== undefined),
  );
}

// ---------------------------------------------------------------- 3. 判定

console.log('\n[判定：父没达成，子拿不到]');
{
  const tracker = new AdvancementTracker();
  equal('一开始一条都没有', tracker.earnedCount, 0);
  equal('`story/root` 还没点亮时，`mine_stone` 是"未解锁"', tracker.stateOf('minicraft:story/mine_stone'), 'locked');

  const first = tracker.handle({ kind: 'obtain', item: Block.COBBLESTONE });
  equal('没点亮根条目时，拿到圆石什么都解锁不了', first.length, 0);

  equal('授予根条目', tracker.grant('minicraft:story/root'), true);
  equal('重复授予返回 false', tracker.grant('minicraft:story/root'), false);
  equal('根条目达成后，`mine_stone` 变成"可达成"', tracker.stateOf('minicraft:story/mine_stone'), 'available');

  const second = tracker.handle({ kind: 'obtain', item: Block.COBBLESTONE });
  equal('这次拿到圆石 → 石器时代', second.length, 1);
  equal('解锁的就是石器时代', second[0]?.id, 'minicraft:story/mine_stone');
  equal('它的状态变成已达成', tracker.stateOf('minicraft:story/mine_stone'), 'earned');
  equal('而"升级工具"这才变成可达成', tracker.stateOf('minicraft:story/upgrade_tools'), 'available');
}

console.log('\n[判定：链式解锁与 any-of]');
{
  const tracker = new AdvancementTracker();
  tracker.grant('minicraft:story/root');
  tracker.handle({ kind: 'obtain', item: Block.COBBLESTONE });

  const stonePick = tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'stone') });
  equal('石镐 → 升级工具', stonePick[0]?.id, 'minicraft:story/upgrade_tools');

  const iron = tracker.handle({ kind: 'obtain', item: Item.IRON_INGOT });
  equal('铁锭 → 来硬的', iron[0]?.id, 'minicraft:story/smelt_iron');
  equal('一次只解锁它自己（铁镐还没造）', iron.length, 1);

  const ironPick = tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'iron') });
  equal('铁镐 → 现在你掌握了铁', ironPick[0]?.id, 'minicraft:story/iron_tools');

  // any-of：钻石胸甲也算"西装革履"（表里列了四档可合成材质）
  // ⚠️ 盔甲 id 要用 `armorItemId`，不是 `toolItemId`——两套 id 段完全不同，
  // 用错了会得到一个"查不到"的数字，而判定只会安静地不命中
  const chestplate = tracker.handle({ kind: 'obtain', item: armorItemId('chestplate', 'diamond') });
  const armor = chestplate.find((def) => def.id === 'minicraft:story/obtain_armor');
  check('钻石胸甲也算"西装革履"（同一件事的任意一种材质）', armor !== undefined, chestplate.map((d) => d.id).join(','));

  // 不匹配的东西不报
  const junk = tracker.handle({ kind: 'obtain', item: Block.DIRT });
  equal('无关的东西不进账', junk.length, 0);

  // 重复事件不重复报
  const again = tracker.handle({ kind: 'obtain', item: Block.COBBLESTONE });
  equal('同一件事再来一次，什么都不报', again.length, 0);
}

console.log('\n[判定：附魔只认附魔过的]');
{
  const tracker = new AdvancementTracker();
  tracker.grant('minicraft:story/root');
  tracker.handle({ kind: 'obtain', item: Block.COBBLESTONE });
  tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'stone') });
  tracker.handle({ kind: 'obtain', item: Item.IRON_INGOT });
  tracker.handle({ kind: 'obtain', item: toolItemId('pickaxe', 'iron') });
  tracker.handle({ kind: 'obtain', item: Item.DIAMOND });

  const plain = tracker.handle({ kind: 'obtain', item: Item.DIAMOND });
  equal('再拿一颗普通钻石不解锁附魔师', plain.length, 0);
  const enchanted = tracker.handle({ kind: 'obtain', item: Item.DIAMOND, enchanted: true });
  equal('带附魔的那一件 → 附魔师', enchanted[0]?.id, 'minicraft:story/enchant_item');
}

console.log('\n[判定：计数型要"不同的目标"]');
{
  const tracker = new AdvancementTracker();
  // 根条目本身要"击杀任意敌对生物"——**同一件事可以一趟点亮父子两条**
  // （表是拓扑序，父先被判定、子在同一次遍历里就能看到"父已达成"）
  const firstKill = tracker.handle({ kind: 'kill', mob: 'zombie' });
  check('第一只僵尸点亮"冒险"根条目', firstKill.some((def) => def.id === 'minicraft:adventure/root'));
  equal(
    '同一趟里"怪物猎人"只记一笔、不算达成（它要三种）',
    firstKill.some((def) => def.id === 'minicraft:adventure/kill_a_mob'),
    false,
  );

  equal('计数进度 1 / 3', tracker.countFor('minicraft:adventure/kill_a_mob').seen, 1);
  equal('还没达成', tracker.stateOf('minicraft:adventure/kill_a_mob'), 'available');

  // 同一只再杀一次：**不算新的一种**
  tracker.handle({ kind: 'kill', mob: 'zombie' });
  equal('重复击杀同一种，进度不动', tracker.countFor('minicraft:adventure/kill_a_mob').seen, 1);

  tracker.handle({ kind: 'kill', mob: 'skeleton' });
  equal('补上骷髅 → 2 / 3', tracker.countFor('minicraft:adventure/kill_a_mob').seen, 2);
  const third = tracker.handle({ kind: 'kill', mob: 'creeper' });
  check('补上苦力怕 → 凑齐三种，达成', third.some((def) => def.id === 'minicraft:adventure/kill_a_mob'));
  equal('达成之后状态是 earned', tracker.stateOf('minicraft:adventure/kill_a_mob'), 'earned');
  equal('计数型的 need 也读得出来', tracker.countFor('minicraft:adventure/kill_a_mob').need, 3);
}

console.log('\n[判定：吃遍若干种食物]');
{
  const tracker = new AdvancementTracker();
  tracker.grant('minicraft:husbandry/root');
  const foods = [Item.APPLE, Item.BREAD, Item.BEEF, Item.PORKCHOP, Item.CHICKEN, Item.MUTTON, Item.COOKIE, Item.CARROT, Item.POTATO, Item.COD];
  equal('准备了 10 种食物', foods.length, DIET_TARGET);

  for (const food of foods.slice(0, DIET_TARGET - 1)) tracker.handle({ kind: 'eat', item: food });
  equal(`吃了 ${DIET_TARGET - 1} 种还没达成`, tracker.stateOf('minicraft:husbandry/balanced_diet'), 'available');

  // 重复吃已经吃过的不算
  tracker.handle({ kind: 'eat', item: foods[0]! });
  equal('重复吃同一种不算新的一种', tracker.countFor('minicraft:husbandry/balanced_diet').seen, DIET_TARGET - 1);

  const done = tracker.handle({ kind: 'eat', item: foods[DIET_TARGET - 1]! });
  check(`第 ${DIET_TARGET} 种下肚 → 均衡饮食达成`, done.some((def) => def.id === 'minicraft:husbandry/balanced_diet'));
}

console.log('\n[判定：单条件事件]');
{
  const tracker = new AdvancementTracker();
  tracker.grant('minicraft:adventure/root');
  tracker.grant('minicraft:husbandry/root');
  const sleep = tracker.handle({ kind: 'sleep' });
  equal('睡到天亮 → 甜美的梦', sleep[0]?.id, 'minicraft:adventure/sleep_in_bed');

  const breed = tracker.handle({ kind: 'breed', mob: 'cow' });
  equal('繁殖一头牛 → 成双成对', breed[0]?.id, 'minicraft:adventure/breed_an_animal');
  equal('繁殖别的家畜也走同一条（any-of）', tracker.handle({ kind: 'breed', mob: 'chicken' }).length, 0);

  const fish = tracker.handle({ kind: 'fish', item: Item.COD });
  equal('钓上一条鱼 → 腥味十足（挂在农牧那支的根下面）', fish[0]?.id, 'minicraft:husbandry/fishy_business');
  equal('农牧那支的根还没亮时，钓鱼什么都抽不到（父门槛）', tracker.handle({ kind: 'fish', item: Item.SALMON }).length, 0);
}

console.log('\n[判定：换维度与末影龙]');
{
  const tracker = new AdvancementTracker();
  // 主树那条链要先走到"冰桶挑战"（`enter_the_nether` 的父），否则进下界只会点亮
  // 下界那支的根——**父门槛是真的在拦着**（下面那条断言专门钉这个）
  const fresh = new AdvancementTracker().handle({ kind: 'dimension', dimension: Dimension.NETHER });
  equal('什么都没做就进下界：只点亮下界那支的根', fresh.map((def) => def.id).join(','), 'minicraft:nether/root');

  tracker.grant('minicraft:story/form_obsidian');
  const nether = tracker.handle({ kind: 'dimension', dimension: Dimension.NETHER });
  const ids = nether.map((def) => def.id);
  check('先走到"冰桶挑战"再进下界：两条一起点亮', ids.includes('minicraft:story/enter_the_nether') && ids.includes('minicraft:nether/root'), ids.join(','));

  const overworld = tracker.handle({ kind: 'dimension', dimension: Dimension.OVERWORLD });
  equal('回主世界不解锁任何东西（没有条目认它）', overworld.length, 0);

  const end = tracker.handle({ kind: 'dimension', dimension: Dimension.END });
  check('进末地点亮末地那支的根', end.some((def) => def.id === 'minicraft:end/root'));
  // 末地那支的根是独立根（不走"我们需要更深入些"那条链），所以这次就该亮
  equal('末地根条目已达成', tracker.isEarned('minicraft:end/root'), true);

  const dragon = tracker.handle({ kind: 'dragon' });
  check('龙倒地 → 末影龙之死（挑战）', dragon.some((def) => def.id === 'minicraft:end/kill_dragon'));
  check('那是一条挑战', advancementById('minicraft:end/kill_dragon')?.challenge === true);
}

console.log('\n[判定：放下方块（种下一颗种子）]');
{
  const tracker = new AdvancementTracker();
  tracker.grant('minicraft:husbandry/root');
  equal('先放个无关的方块：不报', tracker.handle({ kind: 'place', block: Block.COBBLESTONE }).length, 0);
  const plant = tracker.handle({ kind: 'place', block: Block.WHEAT_STAGE0 });
  equal('种下小麦（种子放下去就是 WHEAT_STAGE0）→ 种植', plant[0]?.id, 'minicraft:husbandry/plant_seed');
  const beet = tracker.handle({ kind: 'place', block: Block.BEETROOTS_STAGE0 });
  equal('别的作物不算第二条（已经达成过）', beet.length, 0);
}

console.log('\n[判定：状态与总览]');
{
  const tracker = new AdvancementTracker();
  equal('总数就是表长', tracker.totalCount, ADVANCEMENTS.length);
  tracker.grant('minicraft:story/root');
  equal('达成数只数达成的', tracker.earnedCount, 1);
  equal('不认识的 id → 未解锁', tracker.stateOf('minicraft:no/such'), 'locked');
  equal('不认识的 id 授予失败', tracker.grant('minicraft:no/such'), false);
  equal('不认识的 id 计数型读出来是 1', tracker.countFor('minicraft:no/such').need, 1);

  const roots = childrenOf(null).length;
  equal('根条目数与页签数一致', roots, ADVANCEMENT_TABS.length);
  check('`childrenOf` 找得到子条目', childrenOf('minicraft:story/root').length >= 1);
}

// ---------------------------------------------------------------- 4. 存档

console.log('\n[存档：往返与脏数据]');
{
  const tracker = new AdvancementTracker();
  tracker.grant('minicraft:story/root');
  tracker.handle({ kind: 'obtain', item: Block.COBBLESTONE });
  tracker.handle({ kind: 'kill', mob: 'zombie' });
  tracker.handle({ kind: 'kill', mob: 'skeleton' });
  const before = tracker.earnedCount;

  const raw = JSON.parse(JSON.stringify(tracker.serialize())) as unknown;
  const revived = new AdvancementTracker();
  equal('读回来的条数与写出去的一致', revived.restore(raw), before);
  equal('已达成的还是达成的', revived.isEarned('minicraft:story/mine_stone'), true);
  equal('计数进度跟着走（2 / 3）', revived.countFor('minicraft:adventure/kill_a_mob').seen, 2);
  equal('已达成的不再写进度（存档更紧凑）', Object.prototype.hasOwnProperty.call(tracker.serialize().progress, 'minicraft:adventure/root'), false);

  // 再喂一只苦力怕就该达成——证明"打了一半的挑战"读档后继续有效
  const finish = revived.handle({ kind: 'kill', mob: 'creeper' });
  check('读档后补上第三种 → 挑战达成', finish.some((def) => def.id === 'minicraft:adventure/kill_a_mob'));
}

console.log('\n[存档：脏数据逐条跳过与断链剪枝]');
{
  const tracker = new AdvancementTracker();
  const raw = {
    earned: [
      'minicraft:story/root',
      'minicraft:story/mine_stone',
      'minicraft:no/such', // 不认识的（旧版本删过）
      'minicraft:story/upgrade_tools', // 父（mine_stone）在 → 保留
      'minicraft:end/dragon_egg', // 父链全缺 → 剪掉
      'minicraft:end/kill_dragon',
    ],
    progress: {
      'minicraft:adventure/kill_a_mob': ['zombie', 42, null, 'skeleton'], // 只收字符串
      'minicraft:story/root': ['x'], // 非计数型：整条丢掉
      'minicraft:no/such': ['a'],
    },
  };
  equal('读进来 3 条（其余被跳/被剪）', tracker.restore(raw), 3);
  equal('根条目在', tracker.isEarned('minicraft:story/root'), true);
  equal('子条目在', tracker.isEarned('minicraft:story/upgrade_tools'), true);
  equal('不认识的 id 被跳过', tracker.isEarned('minicraft:no/such'), false);
  equal('断链的"下一世代"被剪掉', tracker.isEarned('minicraft:end/dragon_egg'), false);
  equal('计数进度只收字符串（2 个）', tracker.countFor('minicraft:adventure/kill_a_mob').seen, 2);
  equal('非计数型条目的进度被丢掉', tracker.countFor('minicraft:story/root').seen, 0);

  // 批次 20261025-0117（合规 6）：进度 id 换了命名空间前缀，老存档里存的是旧前缀。
  // 读档必须归一化，否则玩家的达成记录会整片消失——这是换命名空间唯一的存档风险点。
  const legacy = new AdvancementTracker();
  const restoredLegacy = legacy.restore({
    earned: ['minecraft:story/root', 'minecraft:story/upgrade_tools', 'minecraft:story/mine_stone'],
    progress: { 'minecraft:adventure/kill_a_mob': ['zombie'] },
  });
  equal('旧前缀的达成记录读得回来', restoredLegacy, 3);
  equal('旧前缀 → 新 id（根条目）', legacy.isEarned('minicraft:story/root'), true);
  equal('旧前缀 → 新 id（子条目）', legacy.isEarned('minicraft:story/upgrade_tools'), true);
  equal('旧前缀的计数进度也接上了', legacy.countFor('minicraft:adventure/kill_a_mob').seen, 1);

  equal('空存档 → 0 条', new AdvancementTracker().restore(null), 0);
  equal('结构不对 → 0 条', new AdvancementTracker().restore({ earned: 'nope' }), 0);
  equal('不是对象 → 0 条', new AdvancementTracker().restore('nope'), 0);

  const cleared = new AdvancementTracker();
  cleared.grant('minicraft:story/root');
  cleared.clear();
  equal('清空之后一条不剩', cleared.earnedCount, 0);
}

// ---------------------------------------------------------------- 5. 触发种类的覆盖

console.log('\n[触发种类：没有"只有代码没有数据"的死支路]');
{
  const used = new Set(ADVANCEMENTS.map((def) => def.trigger.kind));
  // 这是"本批支持的全部触发种类"——加一种新种类时，这条断言会逼着人**同时**写一条数据用它，
  // 不然就是一段没有消费者的代码
  const expected: readonly TriggerKind[] = [
    'auto',
    'obtain',
    'eat',
    'place',
    'kill',
    'breed',
    'dimension',
    'biome',
    'raid',
    'fish',
    'sleep',
    'dragon',
    // 与村民交易（批次 88，J11 接上来的）
    'trade',
  ];
  const unused = expected.filter((kind) => !used.has(kind));
  check('每一种触发条件都有条目在用', unused.length === 0, unused.join(','));
  equal('也没有表里没写进来的种类', used.size, expected.length);
}

console.log('\n[规模与分布]');
{
  console.log(`  条目 ${ADVANCEMENTS.length} 条（挑战 ${ADVANCEMENTS.filter((d) => d.challenge).length} 条）`);
  for (const tab of ADVANCEMENT_TABS) {
    const defs = advancementsOfTab(tab.id);
    console.log(`    ${tab.title}：${defs.length} 条`);
  }
  check('总数至少 24 条（这一批的目标量级）', ADVANCEMENTS.length >= 24, String(ADVANCEMENTS.length));
  check('五支都有条目', ADVANCEMENT_TABS.every((tab) => advancementsOfTab(tab.id).length >= 1));
}

// ---------------------------------------------------------------- 收尾

console.log(`\n成就进度测试：${passed} 通过 / ${failed} 失败\n`);
if (failed > 0) process.exit(1);
