/**
 * 可达性审计（批次 91）：**"登记了"不等于"拿得到"**
 *
 * 由来：这个项目为"文档会漂"交过好几次学费（提交总数、路线图状态、方块总数），
 * 但**注册表漂的方式更隐蔽**：一件东西被登记进来、贴在创造物品栏里、配方书里也见得到，
 * 而生存模式里根本拿不到。上一次踩到它是酿造的"第一件原料从哪来"（水瓶只能在创造模式里拿），
 * 当时只在 `test:brewing` 里给 24 瓶药水做了一条 BFS。
 *
 * 这一批把这件事**扩到整张注册表**，做法是"来源闭包"：
 *   ① **种子**：不用动手就有的——方块掉落 / 生物掉落 / 钓鱼 / 战利品箱，
 *      再加**机制型**来源（挤奶、鸡下蛋、空瓶接龙息、空瓶装水、空桶装水/岩浆）：
 *      它们不在任何数据表里，只存在于主程序的交互里，漏掉就会把牛奶桶/鸡蛋误判成拿不到；
 *   ② **传播**：合成 / 熔炼 / 切石机 / 锻造台 / 酿造 / 村民交易，
 *      前提是**原料自己也拿得到**——"配方存在"远不等于"做得出来"
 *      （本批就靠这一条抓出"延长药水要的红石粉没有来源"与"整族药水都断在下界疣上"）；
 *   ③ 跑到不动点，剩下的就是"登记了但拿不到"的。
 *
 * 三条规矩：
 *  - **拿不到的必须写进白名单，并且写明理由**（漏一条这一套就红）；
 *  - **白名单里的每一条都要"仍然拿不到"**：哪天那条链补上了，这条断言会逼着人来删白名单
 *    ——否则白名单会变成永久免罪符，而它本来只是一张待办清单；
 *  - 理由里**能机器判定的部分，都再独立断言一条**（"没有该生物"就去问生物表），
 *    免得理由随代码漂走却没人发现。
 *
 * ⚠️ 两处口径，都是**故意**的：
 *  1. **物品侧把"方块物品"一律当成拿得到**（`possibleBlockDropIds()` 里的自掉也在内）。
 *     不这么假设的话，"甘蔗 → 糖""原木 → 木炭"这些会被误判成不可达。
 *     ——**方块侧不再走这条捷径**（批次 118，TASKS B52 收口）：那一侧换成
 *     "**世界生成 + 配方 + 掉落（不含掉自己）**"，判据是 `core/gen/GenerationSources.ts`
 *     那张登记表（它由 `test:genregistry` 用"每个群系采一片、每种结构生成一个实例"对账）。
 *     于是"染色玻璃/混凝土/红石元件"这类**一个来源都没有**的方块藏不住了：见第七节。
 *  2. **工具等级不影响判定**（"石镐才挖得动钻石矿"不在这套里算）：
 *     那要连工具一起进闭包，而工具本身的材质链是另一棵树，混进来只会让失败信息变糊。
 *
 * 运行：npm run test:reach
 */

import {
  Block,
  BLOCKS,
  blockDef,
  carpetId,
  concreteId,
  copperId,
  stainedGlassId,
  terracottaId,
  woolId,
} from '../src/core/registry/blocks.ts';
import {
  BLOCK_ITEM_ID_LIMIT,
  CREATIVE_ITEMS,
  ITEMS,
  Item,
  dropFor,
  dyeIdByName,
  dyeItemId,
  isLegacyItem,
  itemDef,
  nonSelfBlockDropIds,
  possibleBlockDropIds,
} from '../src/core/registry/items.ts';
import { armorItemId } from '../src/core/registry/armor.ts';
import { RECIPES } from '../src/core/crafting/Recipes.ts';
import { recipeIngredients } from '../src/core/crafting/RecipeBook.ts';
import { SMELTING_RECIPES } from '../src/core/crafting/Smelting.ts';
import { BREW_RECIPES, brewRecipeFor } from '../src/core/crafting/Brewing.ts';
import { netheriteUpgradeOf } from '../src/core/crafting/Smithing.ts';
import { isStonecuttingInput, stonecuttingOffers } from '../src/core/crafting/Stonecutting.ts';
import { POTION_ITEMS, TIPPED_ARROWS, TIPPED_ARROW_ID_OFFSET, variantBaseId } from '../src/core/registry/potions.ts';
import { lootItemIds } from '../src/core/registry/loot.ts';
import { fishingEntryIds } from '../src/core/registry/fishing.ts';
import { DROPPING_MOB_TYPES, MOB_TYPES } from '../src/core/entity/mobs.ts';
// 世界生成登记表（B52，批次 118）：方块侧的"种子"就是它——那张表由 `test:genregistry` 对账
import { generatedBlockIds } from '../src/core/gen/GenerationSources.ts';
import { PROFESSIONS } from '../src/core/registry/villagerTrades.ts';
import { DYE_COLORS } from '../src/core/registry/colors.ts';

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

// ---------------------------------------------------------------- 一、种子

console.log('\n[一、种子：不动手就有的来源]');

/**
 * 机制型来源：**它们不在任何数据表里**，只存在于主程序的交互里。
 * 漏掉这些，牛奶桶 / 鸡蛋 / 龙息 / 水瓶 / 水桶 / 岩浆桶就会被误判成"拿不到"。
 */
const MECHANISM_SOURCES: readonly { id: number; why: string }[] = [
  { id: Item.MILK_BUCKET, why: '挤奶（手持桶对成年牛右键）' },
  { id: Item.EGG, why: '鸡每 5~10 分钟下一个蛋' },
  { id: Item.DRAGON_BREATH, why: '手持空瓶接末影龙吐出的龙息云' },
  { id: Item.WATER_BOTTLE, why: '空玻璃瓶对着水右键装水（也可以从炼药锅里舀，批次 176）' },
  // 桶装水 / 岩浆桶（批次 176，G13）：原版也没有配方——它们是"拿桶去装"装出来的
  { id: Item.WATER_BUCKET, why: '空桶对着**水源**右键装满（流水不行）' },
  { id: Item.LAVA_BUCKET, why: '空桶对着岩浆右键装满' },
];

const reach = new Map<number, string>();
const mark = (id: number, why: string): void => {
  if (!reach.has(id)) reach.set(id, why);
};

/** 每一路种子各收了多少件（通道自检用：某一路突然归零，说明那张表被改坏了） */
const channelHits = new Map<string, number>();
const hit = (channel: string, id: number, why: string): void => {
  channelHits.set(channel, (channelHits.get(channel) ?? 0) + 1);
  mark(id, why);
};

for (const id of possibleBlockDropIds()) hit('方块掉落', id, '方块掉落（含概率替换掉落）');
for (const type of DROPPING_MOB_TYPES) {
  for (const drop of type.drops) hit('生物掉落', drop.itemId, `生物掉落（${type.id}）`);
}
for (const id of fishingEntryIds()) hit('钓鱼', id, '钓鱼');
for (const id of lootItemIds()) hit('战利品箱', id, '战利品箱');
for (const entry of MECHANISM_SOURCES) hit('机制', entry.id, entry.why);

check(
  '五路种子都有货（方块掉落 / 生物掉落 / 钓鱼 / 战利品箱 / 机制）',
  ['方块掉落', '生物掉落', '钓鱼', '战利品箱', '机制'].every((name) => (channelHits.get(name) ?? 0) > 0),
  [...channelHits].map(([name, count]) => `${name}=${count}`).join(' '),
);
check(
  '砂砾掉燧石这条概率掉落没丢（`REPLACE_DROPS` 只在那张表里）',
  reach.has(Item.FLINT),
  '燧石一丢，打火石与两件铁器就整条断掉',
);

// ---------------------------------------------------------------- 二、闭包

console.log('\n[二、传播：原料拿得到，产物才算拿得到]');

let rounds = 0;
for (let changed = true; changed; ) {
  changed = false;
  rounds++;
  const add = (channel: string, id: number, why: string): void => {
    if (reach.has(id)) return;
    hit(channel, id, why);
    changed = true;
  };

  for (const recipe of RECIPES) {
    const ingredients = recipeIngredients(recipe).map((entry) => entry.id);
    if (ingredients.every((id) => reach.has(id))) {
      add('合成', recipe.result.id, `合成（${ingredients.map((id) => itemDef(id)?.name ?? id).join(' + ')}）`);
    }
  }
  for (const recipe of SMELTING_RECIPES) {
    if (reach.has(recipe.input)) {
      add('熔炼', recipe.output.id, `熔炼（${itemDef(recipe.input)?.name ?? recipe.input}）`);
    }
  }
  for (const def of BLOCKS) {
    if (!isStonecuttingInput(def.id) || !reach.has(def.id)) continue;
    for (const offer of stonecuttingOffers(def.id)) add('切石机', offer.output, `切石机（${def.name}）`);
  }
  for (const recipe of BREW_RECIPES) {
    if (reach.has(recipe.ingredient) && reach.has(recipe.from)) {
      add('酿造', recipe.to, `酿造（${itemDef(recipe.ingredient)?.name ?? '?'}）`);
    }
  }
  for (let id = BLOCK_ITEM_ID_LIMIT; id < ITEMS.length; id++) {
    const upgraded = netheriteUpgradeOf(id);
    if (upgraded !== undefined && reach.has(id)) add('锻造台', upgraded, '锻造台（下界合金升级）');
  }
  for (const profession of PROFESSIONS) {
    for (const level of profession.levels) {
      for (const spec of level) {
        if (spec.cost.every((cost) => reach.has(cost.id))) {
          add('村民交易', spec.result.id, `村民交易（${profession.name}）`);
        }
      }
    }
  }
}

check('闭包在有限轮内收敛（没有"越跑越多"的环）', rounds <= 8, `${rounds} 轮`);
check('闭包规模合理（> 600 件）', reach.size > 600, `${reach.size} 件`);
check('铁锭能从熔炼来（传播第一块试金石）', reach.has(Item.IRON_INGOT));
check('木炭能从"原木 → 熔炼"来', reach.has(Item.CHARCOAL));

// ---------------------------------------------------------------- 三、白名单

console.log('\n[三、白名单：拿不到的都要写明理由]');

interface Exempt {
  readonly id: number;
  readonly reason: string;
}

// ⚠️ 批次 169：`many()` 这个"一整族套一条理由"的 helper 随锁链甲那一族一起删掉了——
// 白名单现在只剩四条各自独立的缺口，没有哪一族还共用一条理由（留着会变成"下次顺手再用"的口子）

/**
 * 药水那一族的理由**从酿造图里算出来**，不再手抄 45 个 id（批次 92 改的）。
 *
 * 批次 91 那版是"整族 84 瓶都断在下界疣上"，一整条理由套住全部；
 * 批次 92 把下界疣与烈焰粉接上之后，**同一族里有一半能酿了、另一半仍断在蜘蛛眼上**
 * ——手抄的清单这时候必然写错（要么多列、要么少列，而且都不会报错）。
 * 所以改成：沿着 `BREW_RECIPES` 往回找"第一件拿不到的原料"，按原料给出理由。
 * 哪天某个原料补上了，这一族会**自己**变短；而下面那条"缺口总数"断言会同时变红，
 * 逼着人来看一眼（这就是白名单该有的自清方式）。
 */
const INGREDIENT_BLOCKERS: readonly { item: number; reason: string }[] = [
  // ⚠️ **空表不是"这条机制没用了"**：批次 91 量出"整族 112 件药水拿不到"、
  // 92 接上下界疣与烈焰粉、93 接上蜘蛛眼、94 接上恶魂之泪——到这里**84 瓶全通**。
  // 这张表留着是因为"哪条链断了"这件事随时可能再发生（改一条配方、动一次掉落表），
  // 而机制还在：`potionBlocker()` 会自己把断掉的那些列出来。
];

/** 一瓶药水（含喷溅/滞留）卡在哪件原料上；返回 null 表示这条链整个是通的 */
function potionBlocker(id: number): { item: number; reason: string } | null {
  const seen = new Set<number>();
  const walk = (potion: number): number | null => {
    if (seen.has(potion)) return null;
    seen.add(potion);
    for (const recipe of BREW_RECIPES) {
      if (recipe.to !== potion) continue;
      if (!reach.has(recipe.ingredient)) return recipe.ingredient;
      const upstream = walk(recipe.from);
      if (upstream !== null) return upstream;
    }
    return null;
  };
  const blocker = walk(id);
  if (blocker === null) return null;
  return INGREDIENT_BLOCKERS.find((entry) => entry.item === blocker) ?? null;
}

/** 仍然拿不到的药水 / 药水箭（各自带上"卡在哪"的理由） */
const BLOCKED_POTIONS: Exempt[] = [];
for (const entry of POTION_ITEMS) {
  if (reach.has(entry.id)) continue;
  const blocker = potionBlocker(entry.id);
  BLOCKED_POTIONS.push({
    id: entry.id,
    reason: blocker ? `${entry.key}：${blocker.reason}` : `${entry.key}：酿造链上有一件原料拿不到`,
  });
}
const BLOCKED_TIPPED: Exempt[] = [];
for (const entry of TIPPED_ARROWS) {
  if (reach.has(entry.id)) continue;
  // 药水箭的 id = 对应药水 id + 200（见 `TIPPED_ARROW_ID_OFFSET`），
  // 所以"卡在哪"要问**它对应的那瓶药水**——直接拿箭的 id 去查酿造图什么也查不到
  const blocker = potionBlocker(entry.id - TIPPED_ARROW_ID_OFFSET);
  BLOCKED_TIPPED.push({
    id: entry.id,
    reason: blocker
      ? `药水箭 = 滞留药水 + 8 支箭，而对应的滞留药水酿不出来（${blocker.reason}）`
      : '药水箭 = 滞留药水 + 8 支箭，而对应的滞留药水酿不出来',
  });
}

const BLACK_DYE = dyeIdByName('black');
const GRAY_DYE = dyeIdByName('gray');
const WHITE_DYE = dyeIdByName('white');
const GREEN_DYE = dyeIdByName('green');
const CHAINMAIL_PIECES = [
  armorItemId('helmet', 'chainmail'),
  armorItemId('leggings', 'chainmail'),
  armorItemId('boots', 'chainmail'),
];

const EXEMPT: readonly Exempt[] = [
  // ---- ① 酿造链：下界疣与烈焰粉已在批次 92 接上（要塞 + 烈焰人），
  //         剩下的断环是**原料型**的：蜘蛛眼 / 发酵蜘蛛眼 / 恶魂之泪（理由从酿造图算出来）
  ...BLOCKED_POTIONS,
  ...BLOCKED_TIPPED,

  // ---- ② 染料（批次 189 收口）：鱿鱼做出来之后墨囊就有了，黑色与灰色两族
  //         从白名单删掉（"补上了就真的删掉"——上面那条断言会盯着）

  // ---- ③ 锁链甲（批次 169，B53 收口）：三件现在由**盔甲匠**卖，所以从白名单删掉了。
  //         这里留一段注释而不是空行：**白名单条目被还掉之后必须真的删掉**
  //         （上面那条"每条都仍然拿不到"的断言会立刻变红，逼着人来删）。

  // ---- ③b 成书（批次 190）：它不是"做出来"的，而是**书与笔署名**出来的——
  //         那条路在界面里（`ui/BookScreen`），审计的模型看不到，所以列在这里。
  //         ⚠️ 它与"拿不到"不同：只要有一本写好的书与笔，署名就能得到它
  {
    id: Item.WRITTEN_BOOK,
    reason: '成书由书与笔署名得到（界面里的一步，不是配方/掉落），审计模型看不到这一步',
  },

  // ---- ③c 已填好的地图（批次 196）：不是做出来的，是**空地图右键绑定**出来的——
  //         那一步在界面里（`main.openMapScreen`），审计模型看不到。
  {
    id: Item.FILLED_MAP,
    reason: '已填好的地图由空地图右键绑定得到（界面里的一步，不是配方/掉落）',
  },

  // ---- ④ 没有该生物（恶魂已在批次 94 做掉，这里只剩兔子）
  { id: Item.RABBIT_FOOT, reason: '兔子已在批次 259 落地，但故意不掉兔脚：兔皮/兔脚两件物品都还没做' },

  // ---- ⑤ 旧 id（保留只为存档兼容）
  {
    id: Item.REDSTONE_DUST,
    reason: '已是旧 id：与红石粉（1004）是同一件东西，本批统一到 1004，它只留给存档兼容（见 LEGACY_ITEM_IDS）',
  },
];

// ---------------------------------------------------------------- 四、缺口与白名单对齐

console.log('\n[四、缺口与白名单必须一一对应]');

const nameOf = (id: number): string => (itemDef(id)?.name ?? String(id)).replace('minecraft:', '');

/**
 * **创造专属物品**（批次 174，J17 的刷怪蛋）：它们**本来就不该有生存来源**，
 * 所以既不进"缺口"、也不进白名单。
 *
 * ⚠️ 这不是给白名单开后门：白名单那条规矩（"不拿'反正创造模式能拿'当理由"）
 * 针对的是**本该能拿到的**东西。刷怪蛋在原版里就没有任何生存获取途径，
 * 所以判据换成"它必须**真的**没有任何来源"——下面第三段那两条断言盯着这件事。
 */
const SPAWN_EGG_IDS: number[] = [];
for (const item of ITEMS) {
  if (item?.spawnEgg !== undefined) SPAWN_EGG_IDS.push(item.id);
}

const unreachable: number[] = [];
for (let id = BLOCK_ITEM_ID_LIMIT; id < ITEMS.length; id++) {
  if (ITEMS[id] === undefined || reach.has(id)) continue;
  if (ITEMS[id]!.spawnEgg !== undefined) continue;
  unreachable.push(id);
}

const exemptIds = new Set(EXEMPT.map((entry) => entry.id));
const notInLedger = unreachable.filter((id) => !exemptIds.has(id));
const stale = EXEMPT.filter((entry) => reach.has(entry.id) || ITEMS[entry.id] === undefined).map((entry) => entry.id);

check('拿不到的东西都写进了白名单', notInLedger.length === 0, notInLedger.map(nameOf).join(', '));
check(
  '白名单里的每一条都"仍然拿不到"（哪天那条链补上了，就该把它删掉）',
  stale.length === 0,
  stale.map(nameOf).join(', '),
);
check('白名单没有重复 id', exemptIds.size === EXEMPT.length, `${EXEMPT.length} 条 → ${exemptIds.size} 个 id`);
// 把"缺口总数"钉死：哪天某条链补上了（或又断了一条），这里会当场变红，
// 逼着人回来看白名单——**自清的清单需要一个会响的铃**
// 缺口一路在缩：批次 91 量出来是 124 条 → 92（下界要塞 + 烈焰人）70 条 → 93（蜘蛛）**20 条**。
// 每次变化都从这里开始查（它是这套审计的"总分"）
// 缺口一路在缩：批次 91 是 124 条 → 92（要塞+烈焰人）70 → 93（蜘蛛）20 → 94（恶魂）**7 条**
// → 批次 169（锁链甲改由盔甲匠卖）**4 条**。
// 剩下这 4 条都不是"某条链断在中间"，而是**内容本身还没做**（黑/灰染料要鱿鱼与凋灵、
// 兔子脚要兔子、旧 id 只留存档兼容）
equal('缺口总数（批次 196 之后：4 条 —— 三条"界面里才拿得到"的：成书 / 已填好的地图…）', unreachable.length, 4);
check('每条白名单都写了理由（≥ 8 字）', EXEMPT.every((entry) => entry.reason.length >= 8));
check('白名单只收非方块物品（方块侧的判据还没做，见文件头）', EXEMPT.every((entry) => entry.id >= BLOCK_ITEM_ID_LIMIT));
check('不拿"反正创造模式能拿"当理由', EXEMPT.every((entry) => !entry.reason.includes('创造')));

// ---------------------------------------------------------------- 五、这批查出来的事

console.log('\n[五、本批查到并修掉/记下的几件事]');

// ① 酿造链：批次 91 量出"整族 112 件药水/药水箭一瓶都拿不到"，根因是**三处断环**
//    （下界疣 / 烈焰粉 / 蜘蛛眼）。批次 92 接上前两处（下界要塞 + 烈焰人），
//    批次 93 接上第三处（蜘蛛 → 蜘蛛眼 → 发酵蜘蛛眼）——同一张白名单自己一路变短，
//    这正是它该有的样子：**缺口清单是"当前还缺什么"，不是"曾经缺什么"**
// 从"一瓶都酿不出来"（批次 91）到"整族全通"（批次 94）：中间接上了下界疣、烈焰粉、
// 蜘蛛眼、恶魂之泪四处来源，而白名单每一次都**自己**缩短
const drinkableReachable = POTION_ITEMS.filter((entry) => reach.has(entry.id)).length;
const potionId = (key: string): number => POTION_ITEMS.find((entry) => entry.key === key)!.id;
equal('**整族药水都能酿出来了**（84 / 84 瓶）', drinkableReachable, POTION_ITEMS.length);
check('剩下的都断在**原料**上，而不是断在"第一件原料从哪来"（下界疣已通）', reach.has(Item.NETHER_WART));
check('烈焰棒拿得到（烈焰人掉）', reach.has(Item.BLAZE_ROD));
check('烈焰粉拿得到（1 根棒拆 2 份）', reach.has(Item.BLAZE_POWDER));
check('蜘蛛眼拿得到（蜘蛛掉的，1/3 概率）', reach.has(Item.SPIDER_EYE));
check('发酵蜘蛛眼拿得到（蜘蛛眼 + 棕蘑菇 + 糖）', reach.has(Item.FERMENTED_SPIDER_EYE));
check(
  '**剧毒** 药水能酿了（它的唯一原料就是蜘蛛眼）',
  reach.has(potionId('poison')) && reach.has(potionId('poison_long')),
);
check(
  '**缓慢 / 伤害 / 隐身** 三条线也跟着通了（都走发酵蜘蛛眼）',
  ['slowness', 'harming', 'invisibility'].every((key) => reach.has(potionId(key))),
);
check(
  '**再生**也能酿了（恶魂之泪来自恶魂）——J26 那几条断环至此全部接通',
  reach.has(potionId('regeneration')) && reach.has(Item.GHAST_TEAR) && reach.has(Item.GUNPOWDER),
);
check(
  '酿造台现在做得出来了（3 圆石 + 烈焰粉，配方一直都在，缺的是原料）',
  RECIPES.some(
    (recipe) =>
      recipe.result.id === Block.BREWING_STAND &&
      recipeIngredients(recipe).every((ingredient) => reach.has(ingredient.id)),
  ),
);
equal('药水箭的条数是 30（与饮用型一一对应）', TIPPED_ARROWS.length, 30);
const arrowReachable = TIPPED_ARROWS.filter((entry) => reach.has(entry.id)).length;
equal('药水箭 28 / 28 支全能做（跟着饮用型走）', arrowReachable, TIPPED_ARROWS.length);

// ② 红石粉：同一件东西注册了两份，酿造用的那份没有任何来源
equal('红石矿石掉的是红石粉（1004）', dropFor(Block.REDSTONE_ORE)?.id, Item.REDSTONE);
check('红石粉本身拿得到（延长药水这一环本批才接通）', reach.has(Item.REDSTONE));
check('旧 id 是"旧 id"（界面与 /give 都不再收它）', isLegacyItem(Item.REDSTONE_DUST) && !CREATIVE_ITEMS.includes(Item.REDSTONE_DUST));
check(
  '旧 id 仍然能酿（老存档里躺在酿造台槽里的那一份照旧有用）',
  brewRecipeFor(Item.REDSTONE_DUST, variantBaseId('swiftness')!) !== null,
);
check(
  '旧 id 不再出现在任何配方 / 掉落 / 战利品 / 交易里',
  RECIPES.every(
    (recipe) =>
      recipe.result.id !== Item.REDSTONE_DUST &&
      !recipeIngredients(recipe).some((ingredient) => ingredient.id === Item.REDSTONE_DUST),
  ) &&
    !lootItemIds().includes(Item.REDSTONE_DUST) &&
    !fishingEntryIds().includes(Item.REDSTONE_DUST) &&
    MOB_TYPES.every((type) => type.drops.every((drop) => drop.itemId !== Item.REDSTONE_DUST)) &&
    PROFESSIONS.every((profession) =>
      profession.levels.every((level) =>
        level.every(
          (spec) =>
            spec.result.id !== Item.REDSTONE_DUST && spec.cost.every((cost) => cost.id !== Item.REDSTONE_DUST),
        ),
      ),
    ),
);

// ③ 染料：16 色里 14 色本批接通，黑色那一条原版就没有别的路
const dyeReachable = DYE_COLORS.filter((_color, index) => reach.has(dyeItemId(index))).length;
equal('16 色染料**全部**能拿到（批次 189 补上墨囊之后黑/灰也通了）', dyeReachable, 16);
check(
  '黑色染料来自墨囊（鱿鱼的掉落，原版唯一的两条路之一）',
  RECIPES.some(
    (recipe) => recipe.result.id === BLACK_DYE && recipeIngredients(recipe).some((ingredient) => ingredient.id === Item.INK_SAC),
  ),
);
check(
  '灰色染料是"黑 + 白"（原版唯一的路）',
  RECIPES.some(
    (recipe) =>
      recipe.result.id === GRAY_DYE &&
      recipeIngredients(recipe).some((ingredient) => ingredient.id === BLACK_DYE) &&
      recipeIngredients(recipe).some((ingredient) => ingredient.id === WHITE_DYE),
  ),
);
check(
  '白色染料来自骨粉、绿色染料只有"熔炼仙人掌"这一条（原版口径）',
  RECIPES.some(
    (recipe) =>
      recipe.result.id === WHITE_DYE &&
      recipeIngredients(recipe).length === 1 &&
      recipeIngredients(recipe)[0]!.id === Item.BONE_MEAL,
  ) && SMELTING_RECIPES.some((recipe) => recipe.input === Block.CACTUS && recipe.output.id === GREEN_DYE),
);
const dyeableWool = DYE_COLORS.filter((_color, index) =>
  RECIPES.some(
    (recipe) =>
      recipe.result.id === woolId(index) && recipeIngredients(recipe).every((ingredient) => reach.has(ingredient.id)),
  ),
).length;
equal('羊毛的 16 条染色配方**全部**原料自足（批次 189 起黑/灰也自足）', dyeableWool, 16);

// ③b 刷怪蛋（批次 174，J17）：创造专属，判据是"**真的**没有任何来源"——
//     哪天有人给刷怪蛋接上配方/掉落，这两条会立刻变红（那意味着"创造专属"这个标签该撤了）
check(
  '刷怪蛋有 54 枚（… + 末影螨）',
  SPAWN_EGG_IDS.length === 54,
  String(SPAWN_EGG_IDS.length),
);
check(
  '每一枚刷怪蛋都在创造物品栏里（不然玩家根本拿不到它）',
  SPAWN_EGG_IDS.every((id) => CREATIVE_ITEMS.includes(id)),
);
check(
  '每一枚刷怪蛋都没有配方 / 掉落 / 战利品来源（"创造专属"这句话必须是真的）',
  SPAWN_EGG_IDS.every(
    (id) =>
      !RECIPES.some((recipe) => recipe.result.id === id) &&
      !SMELTING_RECIPES.some((recipe) => recipe.output.id === id) &&
      !lootItemIds().includes(id) &&
      !fishingEntryIds().includes(id) &&
      MOB_TYPES.every((type) => type.drops.every((drop) => drop.itemId !== id)) &&
      PROFESSIONS.every((profession) =>
        profession.levels.every((level) => level.every((spec) => spec.result.id !== id)),
      ),
  ),
);

// ④ 锁链甲（批次 169，B53）：**仍然没有配方**（给了会和铁甲撞车），
//    但三件都由**盔甲匠**卖——交易就是它们唯一的来源，"拿得到"这一侧才闭环
check(
  '三件锁链甲仍然没有配方（原版差异不抹平）',
  CHAINMAIL_PIECES.every((id) => !RECIPES.some((recipe) => recipe.result.id === id)),
);
check(
  '三件锁链甲由盔甲匠卖（B53 的收口：交易是它们唯一的来源）',
  CHAINMAIL_PIECES.every((id) =>
    PROFESSIONS.some((profession) =>
      profession.levels.some((level) => level.some((spec) => spec.result.id === id)),
    ),
  ),
);
check(
  '三件锁链甲不靠怪物掉落与战利品箱（胸甲例外：堡垒遗迹的杂物表里有）',
  CHAINMAIL_PIECES.every((id) => !lootItemIds().includes(id)) &&
    CHAINMAIL_PIECES.every((id) => MOB_TYPES.every((type) => type.drops.every((drop) => drop.itemId !== id))),
);

// ⑤ 兔子脚 / 恶魂之泪：理由要能机器验证——真的没有那种生物在掉它
check(
  '"没有该生物"这条理由仍然成立（生物表里没有任何东西掉兔子脚）',
  DROPPING_MOB_TYPES.every((type) => type.drops.every((drop) => drop.itemId !== Item.RABBIT_FOOT)),
);
check(
  '（批次 94 之后）恶魂之泪有来源了：恶魂在生物表里且掉它',
  MOB_TYPES.some((type) => type.id === 'ghast' && type.drops.some((drop) => drop.itemId === Item.GHAST_TEAR)),
);

// ⑥ 末地正门这一条链（K9，批次 111）：眼睛 → 12 只 → 点亮一圈框架。
// 这里是"全程拿得到"的那一半；"一个要塞的箱子够不够凑一圈"由 `test:endportal` 判
check('末影珍珠拿得到（**末影人**掉落；要到末地正门那一步才用得上，见 K9）', reach.has(Item.ENDER_PEARL));
check('末影之眼拿得到（1 珍珠 + 1 烈焰粉，两件原料都有来源）', reach.has(Item.ENDER_EYE));
check(
  '末影之眼这条配方"真的做得出来"（原料自己都在闭包里，而不是只看配方存不存在）',
  RECIPES.some(
    (recipe) =>
      recipe.result.id === Item.ENDER_EYE &&
      recipeIngredients(recipe).every((ingredient) => reach.has(ingredient.id)),
  ),
);

// ---------------------------------------------------------------- 六、方块侧（只判能判的那一小类）

console.log('\n[六、方块侧：只判"一眼是玩家造的"那两族]');

const hasRecipeFor = (id: number): boolean => RECIPES.some((recipe) => recipe.result.id === id);
check(
  '染色玻璃 16 色都有配方（本批补上；此前只有"染色玻璃板"的配方，等于能做出板、做不出玻璃）',
  DYE_COLORS.every((_color, index) => hasRecipeFor(stainedGlassId(index))),
);
check(
  '彩色陶瓦 16 色都有配方（本批补上；此前 17 色陶瓦一个配方都没有）',
  DYE_COLORS.every((_color, index) => hasRecipeFor(terracottaId(index))),
);
check(
  '混凝土 16 色仍然一个配方都没有（要 16 个"混凝土粉末"方块与遇水凝固，见 TASKS 的 B52）',
  DYE_COLORS.every((_color, index) => !hasRecipeFor(concreteId(index))),
);
check('原色陶瓦不是 `terracottaId(0)`（那是白色——荒地色带差一格就是这里踩的）', blockDef(terracottaId(0)).name === 'minecraft:white_terracotta');

// ---------------------------------------------------------------- 六、方块侧（B52，批次 118）

console.log('\n[七、方块侧：生成 + 配方 + 掉落（不再拿"掉自己"当来源，批次 118）]');

/**
 * 方块侧的白名单（一族一条）。与物品侧同一套规矩：**漏一条就红、补上了就红**。
 *
 * 与上面那份（按 id 逐条）不同，这里按**族**收：缺口多半是"16 色染色玻璃"
 * 这种整族一起缺的，逐条抄 16 遍只会让清单变成噪声。
 */
/**
 * **机制型方块**（不在任何掉落表 / 配方表里，只存在于交互与主循环里）。
 *
 * 与物品侧那四条机制来源（挤奶、鸡下蛋、空瓶接龙息、空瓶装水）是同一个性质：
 * 它们**确实是生存里拿得到的**，只是没有任何一张数据表会写它们——不列在这里，
 * 整套方块侧审计会多出几十条假警报（耕地、作物、铜的氧化档、羊毛……）。
 */
const BLOCK_MECHANISM_SOURCES: readonly { label: string; ids: readonly number[] }[] = [
  {
    label: '耕地与四种作物（种下去就是第 0 阶）',
    ids: [
      Block.FARMLAND,
      ...Array.from({ length: 4 }, (_u, i) => Block.WHEAT_STAGE0 + i),
      ...Array.from({ length: 4 }, (_u, i) => Block.CARROTS_STAGE0 + i),
      ...Array.from({ length: 4 }, (_u, i) => Block.POTATOES_STAGE0 + i),
      ...Array.from({ length: 4 }, (_u, i) => Block.BEETROOTS_STAGE0 + i),
    ],
  },
  {
    label: '瓜藤（南瓜/西瓜，含"结果之后"那一阶——它是单独的 id，不跟在八个阶段后面）',
    ids: [
      ...Array.from({ length: 8 }, (_u, i) => Block.PUMPKIN_STEM_STAGE0 + i),
      ...Array.from({ length: 8 }, (_u, i) => Block.MELON_STEM_STAGE0 + i),
      // "结果之后"的那两阶（它们是单独的 id：`PUMPKIN_STEM_ATTACHED_ID` / `MELON_STEM_ATTACHED_ID`）
      ...BLOCKS.filter(
        (def) =>
          def !== undefined &&
          (def.name === 'minecraft:attached_pumpkin_stem' || def.name === 'minecraft:attached_melon_stem'),
      ).map((def) => def.id),
    ],
  },
  { label: '红石线（红石粉放下就是它）', ids: [Block.REDSTONE_WIRE] },
  {
    label: '混凝土（粉末遇水凝固，批次 131）',
    // ⚠️ 16 色**全部**：粉末都能做出来了（批次 189 补上墨囊之后黑/灰也有染料），
    // 白的这一族留着的唯一原因是"粉末遇水凝固"这条机制审计不建模
    ids: DYE_COLORS.map((_color, i) => concreteId(i)),
  },
  {
    label: '铜的氧化档（`world/Copper.ts` 会自己往下氧化）',
    ids: [
      ...Array.from({ length: 3 }, (_u, stage) => copperId(stage + 1, 0)),
      ...Array.from({ length: 3 }, (_u, stage) => copperId(stage + 1, 1)),
      ...Array.from({ length: 3 }, (_u, stage) => copperId(stage + 1, 2)),
      ...Array.from({ length: 3 }, (_u, stage) => copperId(stage + 1, 3)),
    ],
  },
  {
    label: '羊毛与地毯（羊身上剪/掉，颜色是每只羊自己的——所以它不在 `MobType.drops` 里）',
    ids: [
      ...Array.from({ length: 16 }, (_u, i) => woolId(i)),
      ...Array.from({ length: 16 }, (_u, i) => carpetId(i)),
    ],
  },
];

/** 按方块名取 id（白名单按族写，用名字比用 id 好读也好核对） */
const idsNamed = (...names: string[]): number[] =>
  BLOCKS.filter((def) => def !== undefined && names.includes(def.name.replace('minecraft:', ''))).map((def) => def.id);

/**
 * 方块侧的缺口白名单（一族一条）。每一条都是**这一批量出来的真缺口**，
 * 理由写清楚"原版是怎么拿到的、本项目缺哪一环"——它们是下一批的待办清单。
 */
const BLOCK_EXEMPT: readonly { label: string; ids: readonly number[]; reason: string }[] = [
  // ⚠️ "粘性活塞（只差一件原料）"那一族在**批次 120** 删掉了：史莱姆做出来之后
  // 粘液球有了，"活塞 + 粘液球"那条配方也就成立了——白名单按规矩**补上了就删掉它**
  // ⚠️ "混凝土 16 色"那一族在**批次 131** 删掉了：粉末方块 + 遇水凝固都做出来了，
  // 那一族的 14 种（除灰/黑）现在真的拿得到。**灰与黑两种留在白名单里**，
  // 但它们卡的是**染料**（鱿鱼与凋灵玫瑰），所以并入下面那一族（理由同源）
  {
    label: '生成侧没写的几样',
    // ⚠️ 裂纹深板岩砖**不在**这一族了：批次 119 按原版补上了"深板岩砖 → 熔炼 → 裂纹"那条
    // 批次 351：方解石与平滑玄武岩随紫晶洞一起进了世界生成，从这一族里拿掉
    ids: idsNamed('ice', 'nether_sprouts'),
    reason: '世界生成里没有它们（原版分别在冰原/诡异森林），也没有配方',
  },

  {
    label: '死珊瑚',
    ids: idsNamed(
      'dead_tube_coral_block',
      'dead_brain_coral_block',
      'dead_bubble_coral_block',
      'dead_fire_coral_block',
      'dead_horn_coral_block',
      'dead_tube_coral',
      'dead_brain_coral',
      'dead_bubble_coral',
      'dead_fire_coral',
      'dead_horn_coral',
      'dead_tube_coral_fan',
      'dead_brain_coral_fan',
      'dead_bubble_coral_fan',
      'dead_fire_coral_fan',
      'dead_horn_coral_fan',
    ),
    reason: '原版是活珊瑚离水之后变的，本项目没有"珊瑚死亡"这条机制（放上去永远是活的）',
  },
];

/** 一串方块 id 报成名字（报缺口用；方块名与物品名同源） */
const namesOfBlocks = (ids: readonly number[]): string =>
  ids.map((id) => (blockDef(id)?.name ?? String(id)).replace('minecraft:', '')).join(', ');

const blockGaps: number[] = [];
{
  // ① 种子：**世界生成**（`GenerationSources`，由 `test:genregistry` 对账过）
  //    + 生物/钓鱼/战利品/机制的掉落（**不含"方块掉自己"**——那正是这套要拆掉的那条循环）
  const blockReach = new Set<number>(generatedBlockIds());
  for (const type of DROPPING_MOB_TYPES) for (const drop of type.drops) blockReach.add(drop.itemId);
  for (const id of fishingEntryIds()) blockReach.add(id);
  for (const id of lootItemIds()) blockReach.add(id);
  for (const entry of MECHANISM_SOURCES) blockReach.add(entry.id);
  // **挖方块的替换掉落**（石头 → 圆石、树叶 → 树苗/苹果……，**不含"掉自己"**）
  for (const id of nonSelfBlockDropIds()) blockReach.add(id);
  // **机制型方块**（不在任何表里，只存在于交互/主循环里）：与物品侧那四条同一个性质
  for (const entry of BLOCK_MECHANISM_SOURCES) for (const id of entry.ids) blockReach.add(id);
  const seeded = blockReach.size;

  // ② 传播：配方表与物品侧**同一套**，只是"方块原料"要走方块侧闭包、物品原料走物品侧闭包
  for (let changed = true; changed; ) {
    changed = false;
    const add = (id: number): void => {
      if (blockReach.has(id)) return;
      blockReach.add(id);
      changed = true;
    };
    const have = (id: number): boolean =>
      id >= BLOCK_ITEM_ID_LIMIT ? reach.has(id) : blockReach.has(id);

    for (const recipe of RECIPES) {
      if (recipeIngredients(recipe).every((entry) => have(entry.id))) add(recipe.result.id);
    }
    for (const recipe of SMELTING_RECIPES) if (have(recipe.input)) add(recipe.output.id);
    for (const def of BLOCKS) {
      if (!isStonecuttingInput(def.id) || !blockReach.has(def.id)) continue;
      for (const offer of stonecuttingOffers(def.id)) add(offer.output);
    }
    for (const profession of PROFESSIONS) {
      for (const level of profession.levels) {
        for (const spec of level) {
          if (spec.cost.every((cost) => have(cost.id))) add(spec.result.id);
        }
      }
    }
    for (let id = 0; id < BLOCK_ITEM_ID_LIMIT; id++) {
      const upgraded = netheriteUpgradeOf(id);
      if (upgraded !== undefined && blockReach.has(id)) add(upgraded);
    }
  }

  for (let id = 1; id < BLOCK_ITEM_ID_LIMIT; id++) {
    if (BLOCKS[id] === undefined || ITEMS[id] === undefined) continue;
    if (!blockReach.has(id)) blockGaps.push(id);
  }

  console.log(`  · 种子 ${seeded} 个方块，闭包后 ${blockReach.size} 个（缺口 ${blockGaps.length} 个）`);
  check('方块侧闭包收敛（与物品侧一样不加轮数上限就会跑飞）', blockReach.size > seeded);
  check('**钻石块拿得到**（本批刚补的：生成侧没有，但有配方）', blockReach.has(Block.DIAMOND_BLOCK));
  check('**信标拿得到**（配方：玻璃 + 下界之星 + 黑曜石）', blockReach.has(Block.BEACON));
  check('**深板岩拿得到**（生成侧：地下的主干方块）', blockReach.has(Block.DEEPSLATE));
  check('**磨制黑石拿得到**（堡垒遗迹生成）', blockReach.has(Block.POLISHED_BLACKSTONE));
  check('（对照）空 id 不会被算成缺口', !blockGaps.includes(Block.AIR));
}

{
  const exempted = new Set<number>();
  for (const family of BLOCK_EXEMPT) for (const id of family.ids) exempted.add(id);
  const notInLedger = blockGaps.filter((id) => !exempted.has(id));
  check('方块侧的缺口都写进了白名单', notInLedger.length === 0, namesOfBlocks(notInLedger));
  // "白名单里的每一条都仍然拿不到"由上面那份 `blockGaps` 反过来保证：
  // 把白名单里**已经不算缺口**的挑出来，就是该删的条目
  const stale = [...exempted].filter((id) => !blockGaps.includes(id));
  check('方块侧白名单里没有"其实已经拿得到"的条目（补上了就删掉它）', stale.length === 0, namesOfBlocks(stale));
  check('方块侧白名单没有重复 id', exempted.size === BLOCK_EXEMPT.reduce((sum, f) => sum + f.ids.length, 0));
  check('方块侧每条都写了理由（≥ 8 字）', BLOCK_EXEMPT.every((family) => family.reason.length >= 8));
  // 把缺口总数钉死（与物品侧同一个用法：链一断或一补就会红）。
  // 一路在缩：批次 118 量出来 **77** 条（10 族）→ 119 补配方后 **46** 条（7 族）
  // → 120（史莱姆 → 粘液球 → 粘性活塞）后 45 条（6 族）
  // → **131（混凝土粉末遇水凝固）后 33 条（5 族）**：混凝土那一族 14 种还掉，
  //    但**灰/黑两色的混凝土与粉末**要留在白名单里（它们断在染料上，并入下面那一族）
  // 剩下的每一条都是"缺一整块内容"（鱿鱼与墨囊、珊瑚死亡机制、生成侧没写的几件），
  // 而不是"某条链断在中间"——正是这一栏该有的样子
  // 批次 339：竹林 → 竹子 → 脚手架、深色森林 → 深色橡木树叶，两族从白名单里还掉了（25 → 20）
  equal(
    '方块侧缺口总数（批次 363 之后：17 条）',
    blockGaps.length,
    BLOCK_EXEMPT.reduce((sum, family) => sum + family.ids.length, 0),
  );
}

// ---------------------------------------------------------------- 汇总

console.log('\n[汇总：生存里拿不到的东西（白名单）]');
for (const entry of EXEMPT) console.log(`  · ${nameOf(entry.id)} —— ${entry.reason}`);

console.log(`\n可达性审计：${passed} 通过 / ${failed} 失败  （闭包 ${reach.size} 件，缺口 ${unreachable.length} 件）`);
if (failed > 0) process.exit(1);
