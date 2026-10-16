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
 *      再加四条**机制型**来源（挤奶、鸡下蛋、空瓶接龙息、空瓶装水）：
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
 *  1. **方块物品一律当成拿得到**（`possibleBlockDropIds()` 里的自掉也在内）。
 *     不这么假设的话，"甘蔗 → 糖""原木 → 木炭"这些会被误判成不可达。
 *     代价是**方块侧基本没判**：方块"掉自己"就是一条来源，于是任何方块都能自证拿得到——
 *     染色玻璃、混凝土、彩色陶瓦这些**一个配方都没有**的方块就是这么被放过的。
 *     要用"世界生成"当判据，而本项目**没有一张世界生成登记表**；用 `generateChunkBlocks`
 *     采样只能当线索（实测 196 个区块漏掉了黑橡木、方解石、冰这些确实会生成的方块，
 *     拿它当判据会得到 142 条假警报）。所以本批只判能判的那一小类
 *     （染色玻璃 / 彩色陶瓦 16 色必须有配方），其余交给 TASKS 的 B52。
 *  2. **工具等级不影响判定**（"石镐才挖得动钻石矿"不在这套里算）：
 *     那要连工具一起进闭包，而工具本身的材质链是另一棵树，混进来只会让失败信息变糊。
 *
 * 运行：npm run test:reach
 */

import {
  Block,
  BLOCKS,
  blockDef,
  concreteId,
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
import { MOB_TYPES } from '../src/core/entity/mobs.ts';
import { DRAGON_TYPE } from '../src/core/entity/EndBoss.ts';
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
 * 漏掉这四条，牛奶桶 / 鸡蛋 / 龙息 / 水瓶就会被误判成"拿不到"。
 */
const MECHANISM_SOURCES: readonly { id: number; why: string }[] = [
  { id: Item.MILK_BUCKET, why: '挤奶（手持桶对成年牛右键）' },
  { id: Item.EGG, why: '鸡每 5~10 分钟下一个蛋' },
  { id: Item.DRAGON_BREATH, why: '手持空瓶接末影龙吐出的龙息云' },
  { id: Item.WATER_BOTTLE, why: '空玻璃瓶对着水右键装水' },
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
for (const type of [...MOB_TYPES, DRAGON_TYPE]) {
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

const many = (ids: readonly number[], reason: string): Exempt[] => ids.map((id) => ({ id, reason }));

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
  {
    // 批次 93 把蜘蛛眼接上了（蜘蛛 → 蜘蛛眼；发酵蜘蛛眼 → 缓慢/伤害/隐身），
    // 这里只剩恶魂之泪一处——**这张表是"当前还缺什么"，不是"曾经缺什么"**
    item: Item.GHAST_TEAR,
    reason: '恶魂没做：原版恶魂之泪由恶魂掉落——它挡住再生（J26），而恶魂在 J15 的敌对生物清单里',
  },
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

  // ---- ② 染料里只剩黑色一条断链，灰色依赖它
  {
    id: BLACK_DYE,
    reason: '原版黑色染料只从墨囊（鱿鱼）与凋零玫瑰（凋灵）来，两样都没有；不给替代品（J26）',
  },
  {
    id: GRAY_DYE,
    reason: '原版灰色染料唯一的路是"黑 + 白"，黑色断了，于是灰色也跟着断（J26）',
  },

  // ---- ③ 原版就没有配方，只能靠"怪物掉落"或"与盔甲匠交易"
  ...many(
    CHAINMAIL_PIECES,
    '锁链甲原版没有配方（材料与图案都与铁甲完全相同，给了配方就会和铁甲撞车），只能靠穿甲的怪物掉落或与盔甲匠交易；本项目两样都没有（TASKS 的 B53）',
  ),

  // ---- ④ 没有该生物
  { id: Item.RABBIT_FOOT, reason: '兔子未实现：原版兔子脚由兔子掉落（J26）' },
  { id: Item.GHAST_TEAR, reason: '恶魂未实现：原版恶魂之泪由恶魂掉落（J26）' },

  // ---- ⑤ 旧 id（保留只为存档兼容）
  {
    id: Item.REDSTONE_DUST,
    reason: '已是旧 id：与红石粉（1004）是同一件东西，本批统一到 1004，它只留给存档兼容（见 LEGACY_ITEM_IDS）',
  },
];

// ---------------------------------------------------------------- 四、缺口与白名单对齐

console.log('\n[四、缺口与白名单必须一一对应]');

const nameOf = (id: number): string => (itemDef(id)?.name ?? String(id)).replace('minecraft:', '');

const unreachable: number[] = [];
for (let id = BLOCK_ITEM_ID_LIMIT; id < ITEMS.length; id++) {
  if (ITEMS[id] === undefined || reach.has(id)) continue;
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
equal('缺口总数（批次 93 之后：20 条 —— 只剩再生线、黑灰染料、锁链甲与两件没做的生物掉落）', unreachable.length, 20);
check('每条白名单都写了理由（≥ 8 字）', EXEMPT.every((entry) => entry.reason.length >= 8));
check('白名单只收非方块物品（方块侧的判据还没做，见文件头）', EXEMPT.every((entry) => entry.id >= BLOCK_ITEM_ID_LIMIT));
check('不拿"反正创造模式能拿"当理由', EXEMPT.every((entry) => !entry.reason.includes('创造')));

// ---------------------------------------------------------------- 五、这批查出来的事

console.log('\n[五、本批查到并修掉/记下的几件事]');

// ① 酿造链：批次 91 量出"整族 112 件药水/药水箭一瓶都拿不到"，根因是**三处断环**
//    （下界疣 / 烈焰粉 / 蜘蛛眼）。批次 92 接上前两处（下界要塞 + 烈焰人），
//    批次 93 接上第三处（蜘蛛 → 蜘蛛眼 → 发酵蜘蛛眼）——同一张白名单自己一路变短，
//    这正是它该有的样子：**缺口清单是"当前还缺什么"，不是"曾经缺什么"**
const drinkableReachable = POTION_ITEMS.filter((entry) => reach.has(entry.id)).length;
const potionId = (key: string): number => POTION_ITEMS.find((entry) => entry.key === key)!.id;
check(
  `整族药水里已经能酿出 ${drinkableReachable} / ${POTION_ITEMS.length} 瓶`,
  drinkableReachable > 0 && drinkableReachable < POTION_ITEMS.length,
  String(drinkableReachable),
);
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
  '**再生** 仍然酿不出来——它还缺恶魂之泪（恶魂在 J15 的清单里，这是白名单的自清留下的最后一条药水线）',
  !reach.has(potionId('regeneration')),
);
check(
  '酿造台现在做得出来了（3 圆石 + 烈焰粉，配方一直都在，缺的是原料）',
  RECIPES.some(
    (recipe) =>
      recipe.result.id === Block.BREWING_STAND &&
      recipeIngredients(recipe).every((ingredient) => reach.has(ingredient.id)),
  ),
);
equal('药水箭的条数是 28（与饮用型一一对应）', TIPPED_ARROWS.length, 28);
const arrowReachable = TIPPED_ARROWS.filter((entry) => reach.has(entry.id)).length;
check(
  `药水箭能做出 ${arrowReachable} / ${TIPPED_ARROWS.length} 支（跟着饮用型走）`,
  arrowReachable > 0 && arrowReachable < TIPPED_ARROWS.length,
  String(arrowReachable),
);

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
equal('16 色染料里 14 种能拿到（本批补的花/骨粉/青金石/仙人掌/混合）', dyeReachable, 14);
check('黑色染料拿不到（墨囊与凋零玫瑰都没有）', !reach.has(BLACK_DYE));
check(
  '灰色染料一个配方都没有：原版唯一的路是"黑 + 白"，而黑色断了——我们没给它安排别的路',
  !reach.has(GRAY_DYE) && !RECIPES.some((recipe) => recipe.result.id === GRAY_DYE),
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
equal('羊毛的 16 条染色配方里 14 条原料自足（黑/灰那两条不是）', dyeableWool, 14);

// ④ 锁链甲：原版就没有配方，本项目连"替代来源"都没有
check(
  '三件锁链甲既没有配方、也没有任何掉落（胸甲例外：堡垒遗迹的战利品箱里有）',
  CHAINMAIL_PIECES.every((id) => !RECIPES.some((recipe) => recipe.result.id === id)) &&
    CHAINMAIL_PIECES.every((id) => !lootItemIds().includes(id)) &&
    CHAINMAIL_PIECES.every((id) => MOB_TYPES.every((type) => type.drops.every((drop) => drop.itemId !== id))),
);

// ⑤ 兔子脚 / 恶魂之泪：理由要能机器验证——真的没有那种生物在掉它
check(
  '"没有该生物"这条理由仍然成立（生物表里没有任何东西掉兔子脚 / 恶魂之泪）',
  [...MOB_TYPES, DRAGON_TYPE].every(
    (type) =>
      type.drops.every((drop) => drop.itemId !== Item.RABBIT_FOOT && drop.itemId !== Item.GHAST_TEAR),
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

// ---------------------------------------------------------------- 汇总

console.log('\n[汇总：生存里拿不到的东西（白名单）]');
for (const entry of EXEMPT) console.log(`  · ${nameOf(entry.id)} —— ${entry.reason}`);

console.log(`\n可达性审计：${passed} 通过 / ${failed} 失败  （闭包 ${reach.size} 件，缺口 ${unreachable.length} 件）`);
if (failed > 0) process.exit(1);
