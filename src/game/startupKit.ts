/**
 * 开发期初始物资（**批次 101** 从 `src/main.ts` 里搬出来的）
 *
 * 这两张表是"进新世界时背包里塞什么"，**每加一批功能就会往 `STARTING_HOTBAR`
 * 末尾追加几件验收物资**——所以它是全仓库改动最频繁的数据表之一，
 * 单独放一份，改它不必在 8000 行的入口文件里找。
 *
 * ⚠️ 表的顺序有意义：`main.ts` 先填 `DEV_BASE_KIT`，再**从末尾倒着**填
 * `STARTING_HOTBAR`——所以越靠后越优先、被挤掉的永远是中间那几批。见下面 DEV_BASE_KIT 的说明。
 */

import { Block, JUNGLE_LOG_ID, stainedGlassId } from '../core/registry/blocks.ts';
import { ARMOR_TYPES, armorItemId } from '../core/registry/armor.ts';
// 染料一律按**颜色名**查（批次 91 起）：写死下标会在配色表改动时静默做错颜色
import { Item, dyeIdByName } from '../core/registry/items.ts';
import { toolItemId } from '../core/registry/tools.ts';

/**
 * 开发期初始物资：补齐各色基础方块，便于立刻验证玩法。
 * 生存模式（I1）接入后这里应当清空，改为从世界采集。
 */

/**
 * **开发期必备的 12 件**（批次 94 加的）：与下面那张"各批验收物资"的表分开。
 *
 * 为什么要分开：背包只有 36 格，而 `STARTING_HOTBAR` 早就 70+ 件了——
 * 之前靠"倒序填"来保证"最新那一批拿得到"，副作用是**最基础的草/土/石被挤掉了**
 * （它们排在最前面，倒序填时最后才轮到）。那正好把最常用的几件弄丢了。
 *
 * 现在的填法：**先填这 12 件**（后面再从末尾倒着填验收物资时，同 id 会自动并进已占的格子，
 * 所以它们其实被"保护"住了），再倒序填其余——于是"地基"与"最新一批"两头都在，
 * 被牺牲的是中间那几批（旧的可以创造模式或 `/give` 补）。
 */
export const DEV_BASE_KIT: readonly number[] = [
  Block.GRASS_BLOCK,
  Block.DIRT,
  Block.STONE,
  Block.COBBLESTONE,
  Block.OAK_PLANKS,
  Block.OAK_LOG,
  Block.GLASS,
  Block.GLOWSTONE,
  Block.CRAFTING_TABLE,
  toolItemId('pickaxe', 'iron'),
  toolItemId('axe', 'iron'),
  toolItemId('sword', 'iron'),
];

export const STARTING_HOTBAR: readonly number[] = [
  Block.GRASS_BLOCK,
  Block.DIRT,
  Block.STONE,
  Block.COBBLESTONE,
  Block.OAK_PLANKS,
  Block.OAK_LOG,
  Block.OAK_LEAVES,
  Block.GLASS,
  Block.GLOWSTONE,
  // 开发期工具：木镐/石镐/铁镐/钻石镐 + 斧/锹/剑，方便直接验收挖掘等级与伤害
  toolItemId('pickaxe', 'wooden'),
  toolItemId('pickaxe', 'stone'),
  toolItemId('pickaxe', 'iron'),
  toolItemId('pickaxe', 'diamond'),
  toolItemId('axe', 'iron'),
  toolItemId('shovel', 'iron'),
  toolItemId('sword', 'iron'),
  // 开发期盔甲：皮革/铁/钻石各一套，方便对比护甲条的档位与减伤
  ...(['leather', 'iron', 'diamond'] as const).flatMap((material) => ARMOR_TYPES.map((type) => armorItemId(type, material))),
  // 开发期下界合金（K8 尾巴）：锻造台 + 材料 + 远古残骸，配合上面的钻石装备就能走通"升级"这条链
  Block.SMITHING_TABLE,
  Item.NETHERITE_INGOT,
  Block.ANCIENT_DEBRIS,
  Block.NETHERITE_BLOCK,
  // 开发期切石机（H11，批次 44）：本体 + 几种"能切出东西"的石料，
  // 放下就能右键试"一进多选"（石板/楼梯/墙/深板岩瓦都在它的候选里）
  Block.STONECUTTER,
  Block.STONE,
  Block.POLISHED_DEEPSLATE,
  Block.QUARTZ_BLOCK,
  // 开发期红沙与红砂岩（批次 45）：红沙是恶地地表那一层，也是红砂岩家族的唯一起点
  Block.RED_SAND,
  Block.RED_SANDSTONE,
  // 开发期烟熏炉与高炉（批次 46）：旁边就有生肉与粗铁，放下就能对比"2 倍速"与"只吃什么"
  Block.SMOKER,
  Block.BLAST_FURNACE,
  // 开发期营火（批次 47）：放下就点着，塞几块生肉就能看"30 秒弹一个"的节奏
  Block.CAMPFIRE,
  // 开发期食物与作物（批次 48）：种子 + 一碗一锅，落地就能试"种甜菜 → 煮汤"这条链
  Item.BEETROOT_SEEDS,
  Item.BEETROOT,
  Item.BOWL,
  Item.MUSHROOM_STEW,
  Item.PUMPKIN_PIE,
  // 开发期甜浆果与可可豆（批次 49）：对着**草方块**种浆果、对着**丛林原木侧面**种可可豆，
  // 再把手里的曲奇喂给自己——一条链在三步之内能走完
  Item.SWEET_BERRIES,
  Item.COCOA_BEANS,
  Item.COOKIE,
  JUNGLE_LOG_ID,
  // 开发期附魔与铁砧一条链：铁砧本体 + 修它要用的铁块/铁锭 + 附魔台要用的书/青金石
  Block.ANVIL,
  Block.IRON_BLOCK,
  Item.IRON_INGOT,
  Item.BOOK,
  Block.ENCHANTING_TABLE,
  Block.BOOKSHELF,
  Item.LAPIS_LAZULI,
  // 开发期弓与箭（J9）：一拉就能射
  Item.BOW,
  Item.ARROW,
  Item.STRING,
  Item.FLINT,
  // 开发期钓竿（批次 81，G11）：出生点附近多半有水，走两步就能试抛竿
  Item.FISHING_ROD,
  // 开发期村民交易（批次 88，J11）：绿宝石 + 几样"村民收的东西" + 三个工作站方块，
  // 放下工作站（堆肥桶/木桶/酿造台）再把村民叫过来，就能走通"认领职业 → 交易 → 升级"
  Item.EMERALD,
  Item.BREAD,
  Item.WHEAT,
  Item.CARROT,
  Block.COMPOSTER,
  Block.BARREL,
  Block.BREWING_STAND,
  // 开发期铜的四档（批次 40）：四档铜块 + 切制铜，右键几下就能看到氧化与刮锈
  Block.COPPER_BLOCK,
  Block.EXPOSED_COPPER_BLOCK,
  Block.WEATHERED_COPPER_BLOCK,
  Block.OXIDIZED_COPPER_BLOCK,
  Block.CUT_COPPER,
  // 开发期染料与染色族（批次 91）：三原色 + 两块被染过的方块，落地就能试"染料 → 染色"
  dyeIdByName('red'),
  dyeIdByName('blue'),
  dyeIdByName('white'),
  stainedGlassId(0),
  Block.TERRACOTTA,
  // 开发期下界要塞那一条链（批次 92）：灵魂沙 + 下界疣能当场种、刷怪笼能当场刷烈焰人、
  // 烈焰棒/粉是酿造台的燃料与配方原料
  Block.SOUL_SAND,
  Item.NETHER_WART,
  Block.NETHER_BRICKS,
  Block.SPAWNER,
  Item.BLAZE_ROD,
  Item.BLAZE_POWDER,
  // 开发期蜘蛛那一族（批次 93）：蜘蛛眼是"剧毒"唯一的原料，也是发酵蜘蛛眼的起点
  Item.SPIDER_EYE,
];
