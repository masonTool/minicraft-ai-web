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
import { POTION_ITEMS, TIPPED_ARROWS, variantBaseId } from '../src/core/registry/potions.ts';
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

/** 整族药水（饮用 / 喷溅 / 滞留）都断在同一处 */
const POTION_CHAIN_BLOCKER =
  '整条酿造链断在"下界疣"上：原版下界疣只长在下界要塞的灵魂沙上，而下界要塞还没做（TASKS 的 J26）';

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
  // ---- ① 酿造链的三个断环：下界要塞 / 烈焰人 / 蜘蛛（本批补上了"配方存在"，来源要内容）
  { id: Item.NETHER_WART, reason: POTION_CHAIN_BLOCKER },
  { id: Item.BLAZE_POWDER, reason: '烈焰人未实现：原版烈焰粉由烈焰棒（烈焰人掉落）拆成，而生物整组里没有烈焰人（J26）' },
  ...many(POTION_ITEMS.map((entry) => entry.id), POTION_CHAIN_BLOCKER),
  ...many(
    TIPPED_ARROWS.map((entry) => entry.id),
    `药水箭 = 滞留药水 + 8 支箭，而滞留药水同样酿不出来：${POTION_CHAIN_BLOCKER}`,
  ),
  { id: Item.SPIDER_EYE, reason: '蜘蛛未实现：原版蜘蛛眼由蜘蛛掉落，而生物整组里没有蜘蛛（J26）' },
  {
    id: Item.FERMENTED_SPIDER_EYE,
    reason: '配方已按原版补上（蜘蛛眼 + 棕色蘑菇 + 糖），但原料蜘蛛眼拿不到（J26）',
  },

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
check('每条白名单都写了理由（≥ 8 字）', EXEMPT.every((entry) => entry.reason.length >= 8));
check('白名单只收非方块物品（方块侧的判据还没做，见文件头）', EXEMPT.every((entry) => entry.id >= BLOCK_ITEM_ID_LIMIT));
check('不拿"反正创造模式能拿"当理由', EXEMPT.every((entry) => !entry.reason.includes('创造')));

// ---------------------------------------------------------------- 五、这批查出来的事

console.log('\n[五、本批查到并修掉/记下的几件事]');

// ① 整条酿造链：配方都在，原料全缺
check(
  `整族药水（${POTION_ITEMS.length} 瓶）在生存里一瓶都酿不出来`,
  POTION_ITEMS.every((entry) => !reach.has(entry.id)),
  `能拿到 ${POTION_ITEMS.filter((entry) => reach.has(entry.id)).length} 瓶`,
);
equal('药水箭 28 支同样一支都拿不到', TIPPED_ARROWS.filter((entry) => reach.has(entry.id)).length, 0);
equal('药水箭的条数是 28（与饮用型一一对应）', TIPPED_ARROWS.length, 28);
check(
  '酿造台也做不出来：配方要烈焰粉，而烈焰粉没有来源',
  RECIPES.some(
    (recipe) =>
      recipe.result.id === Block.BREWING_STAND &&
      recipeIngredients(recipe).some((ingredient) => ingredient.id === Item.BLAZE_POWDER),
  ) && !reach.has(Item.BLAZE_POWDER),
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
