/**
 * 烧炼配方与燃料
 *
 * 普通熔炉一次烧炼 10 秒（原版 200 tick）。烟熏炉/高炉是 5 秒，等 H6 扩展时再加。
 * 燃料按"可燃烧秒数"表示，与原版比例一致：1 个煤炭 = 80 秒 = 8 次烧炼。
 */

import { Block } from '../registry/blocks.ts';
import { Item, dyeIdByName } from '../registry/items.ts';

/**
 * 这条配方**能进哪种炉子**（批次 46 的烟熏炉与高炉要用）。
 *
 * 原版是两套独立配方表（`smoking` / `blasting`），这里给每条配方标一个归类、
 * 三种炉子按它过滤——**表只有一张**，加配方时不会出现"只给熔炉加了、
 * 烟熏炉那边漏了"这种事（漏了的表现是"烟熏炉里烧不动"，很难一眼看出是数据问题）。
 */
export type SmeltKind = 'food' | 'metal' | 'none';

export interface SmeltingRecipe {
  readonly input: number;
  readonly output: { id: number; count: number };
  /** 单次烧炼耗时（秒，**普通熔炉**的基准；烟熏炉与高炉按 `timeScale` 折算） */
  readonly time: number;
  /** 取出产物时获得的经验（原版量纲，经验球在后续版本接入） */
  readonly experience: number;
  /**
   * 归属：`food` = 烟熏炉专用、`metal` = 高炉专用、`none` = 只有普通熔炉能做。
   * **省略即 `none`**（绝大多数配方本来就只属于熔炉，写满 20 多个 `kind: 'none'`
   * 只会把真正有区别的那几条淹掉）。
   */
  readonly kind?: SmeltKind;
}

/** 普通熔炉的单次烧炼耗时 */
export const SMELTING_TIME = 10;

/**
 * 四种"烤东西的地方"（H6 的烟熏炉与高炉在批次 46 落地，营火在批次 47）。
 *
 * ⚠️ 营火也是**站台**但不是炉子：它不要燃料、一次烤 4 个、烤好直接弹出来。
 * 它之所以能复用这张表，是因为"只烤食物、而且很慢"这两条规则与炉子完全同源
 * （`timeScale: 3` = 原版的 30 秒一个，是熔炉的 3 倍）。
 */
export type FurnaceStation = 'furnace' | 'smoker' | 'blast_furnace' | 'campfire';

export interface StationDef {
  readonly cn: string;
  /**
   * 耗时倍率：烟熏炉与高炉是原版的"2 倍速"（10 秒 → 5 秒）。
   *
   * ⚠️ 燃料的燃烧时长也按同一个倍率缩短：原版一份煤在烟熏炉里只烧 40 秒，
   * 但因为每次烧炼只要一半时间，**一份燃料能烧的次数不变**（8 次）——
   * 燃料的"性价比"不该因为换炉子而变，这是原版的语义。
   */
  readonly timeScale: number;
  /** 吃哪些归类 */
  readonly accepts: readonly SmeltKind[];
}

/** 拒绝提示里"它只吃什么"的文案（按归类拼出来，见 `stationRejectReason`） */
const ACCEPTS_TEXT: Readonly<Record<SmeltKind, string>> = {
  food: '食物（生肉、马铃薯…）',
  metal: '矿物与金属（原矿、远古残骸…）',
  none: '',
};

export const FURNACE_STATIONS: Readonly<Record<FurnaceStation, StationDef>> = {
  furnace: { cn: '熔炉', timeScale: 1, accepts: ['food', 'metal', 'none'] },
  smoker: { cn: '烟熏炉', timeScale: 0.5, accepts: ['food'] },
  blast_furnace: { cn: '高炉', timeScale: 0.5, accepts: ['metal'] },
  // 营火：原版 600 tick = 30 秒一个（熔炉的 3 倍），而且只烤食物
  campfire: { cn: '营火', timeScale: 3, accepts: ['food'] },
};

/** 绿色染料的物品 id（按颜色名查，不写死下标） */
const GREEN_DYE_ID = dyeIdByName('green');

/** 全部熔炼配方（配方书要列出来，所以导出） */

export const SMELTING_RECIPES: readonly SmeltingRecipe[] = [
  // 烤马铃薯（H13 续）：原版 0.35 经验
  // 矿物 → 金属锭
  // 烤马铃薯（H13 续）：原版 0.35 经验
  { input: Item.POTATO, output: { id: Item.BAKED_POTATO, count: 1 }, time: SMELTING_TIME, experience: 0.35, kind: 'food' },
  { input: Item.RAW_IRON, output: { id: Item.IRON_INGOT, count: 1 }, time: SMELTING_TIME, experience: 0.7, kind: 'metal' },
  { input: Item.RAW_GOLD, output: { id: Item.GOLD_INGOT, count: 1 }, time: SMELTING_TIME, experience: 1, kind: 'metal' },
  { input: Item.RAW_COPPER, output: { id: Item.COPPER_INGOT, count: 1 }, time: SMELTING_TIME, experience: 0.7, kind: 'metal' },

  // 沙 → 玻璃
  { input: Block.SAND, output: { id: Block.GLASS, count: 1 }, time: SMELTING_TIME, experience: 0.1 },

  // 圆石 → 石头
  { input: Block.COBBLESTONE, output: { id: Block.STONE, count: 1 }, time: SMELTING_TIME, experience: 0.1 },

  // 原木 → 木炭
  { input: Block.OAK_LOG, output: { id: Item.CHARCOAL, count: 1 }, time: SMELTING_TIME, experience: 0.15 },

  // 远古残骸 → 下界合金碎片（K8 尾巴）：原版 2 点经验，是整个下界合金链的第一环。
  // 归 `metal`：原版高炉**能**烧远古残骸（而且更快），这是高炉最有用的一条
  { input: Block.ANCIENT_DEBRIS, output: { id: Item.NETHERITE_SCRAP, count: 1 }, time: SMELTING_TIME, experience: 2, kind: 'metal' },

  // 黏土球 → 红砖
  { input: Item.CLAY_BALL, output: { id: Item.BRICK, count: 1 }, time: SMELTING_TIME, experience: 0.3 },

  // 仙人掌 → 绿色染料（批次 91）：原版**唯一的绿色染料来源**（熔炼 1 经验）。
  // 归 `none`：烟熏炉只吃食物、高炉只吃矿物，而这是染料
  { input: Block.CACTUS, output: { id: GREEN_DYE_ID, count: 1 }, time: SMELTING_TIME, experience: 1 },

  // 海带 → 干海带（批次 50）：原版 0.1 经验。
  // 归 `none`（只有普通熔炉能做）：原版的烟熏炉只烧**食物**，而海带不是食物——
  // 干海带才是。所以"海带 → 干海带"这条不能进烟熏炉，也不能进营火
  { input: Block.KELP, output: { id: Item.DRIED_KELP, count: 1 }, time: SMELTING_TIME, experience: 0.1 },

  // 石英块 → 平滑石英（批次 42，原版：平滑石英只能这么来）
  { input: Block.QUARTZ_BLOCK, output: { id: Block.SMOOTH_QUARTZ, count: 1 }, time: SMELTING_TIME, experience: 0.1 },

  // 砂岩 → 平滑砂岩 / 红砂岩 → 平滑红砂岩（批次 45，原版：平滑砂岩家族只能这么来）
  // ⚠️ 普通砂岩这一条此前**漏了**（批次 41 做了平滑砂岩方块却没给来源），一并补上
  { input: Block.SANDSTONE, output: { id: Block.SMOOTH_SANDSTONE, count: 1 }, time: SMELTING_TIME, experience: 0.1 },
  { input: Block.RED_SANDSTONE, output: { id: Block.SMOOTH_RED_SANDSTONE, count: 1 }, time: SMELTING_TIME, experience: 0.1 },

  // 生肉 → 熟肉（经验值取自原版：生肉 0.35）。归 `food`：这就是烟熏炉存在的理由
  { input: Item.BEEF, output: { id: Item.COOKED_BEEF, count: 1 }, time: SMELTING_TIME, experience: 0.35, kind: 'food' },
  { input: Item.PORKCHOP, output: { id: Item.COOKED_PORKCHOP, count: 1 }, time: SMELTING_TIME, experience: 0.35, kind: 'food' },
  { input: Item.MUTTON, output: { id: Item.COOKED_MUTTON, count: 1 }, time: SMELTING_TIME, experience: 0.35, kind: 'food' },
  { input: Item.CHICKEN, output: { id: Item.COOKED_CHICKEN, count: 1 }, time: SMELTING_TIME, experience: 0.35, kind: 'food' },
  // 生鱼 → 熟鱼（批次 81，G11）：原版也是 0.35 经验、归 `food`（烟熏炉能烧）。
  // ⚠️ **只有这两种鱼**：原版的热带鱼与河豚**不能烤**（烤了会变成什么？没有那样东西），
  // 断言里专门钉住"它们不在表里"——顺手给它们加一条"看起来合理"的配方是最容易犯的错
  { input: Item.COD, output: { id: Item.COOKED_COD, count: 1 }, time: SMELTING_TIME, experience: 0.35, kind: 'food' },
  { input: Item.SALMON, output: { id: Item.COOKED_SALMON, count: 1 }, time: SMELTING_TIME, experience: 0.35, kind: 'food' },

  // 石头 → 平滑石头 / 深板岩砖 → 裂纹深板岩砖（批次 119）：这两条也是
  // **批次 118 的方块侧审计**量出来的缺口——原版有明确配方（熔炼），本项目漏了。
  // 平滑石头是"平滑石头台阶/楼梯"的母方块，缺了它那一族连着做不出来；
  // 归 `none`：原版的烟熏炉只吃食物、高炉只吃矿物与金属，而这两样是建材
  { input: Block.STONE, output: { id: Block.SMOOTH_STONE, count: 1 }, time: SMELTING_TIME, experience: 0.1 },
  {
    input: Block.DEEPSLATE_BRICKS,
    output: { id: Block.CRACKED_DEEPSLATE_BRICKS, count: 1 },
    time: SMELTING_TIME,
    experience: 0.1,
  },

  // 磨制黑石砖 → 裂纹磨制黑石砖（批次 85，B50）：原版**只有这一条路**
  // （裂纹砖没有合成配方），所以它归 `none`：烟熏炉/高炉都不该接它
  // （它们只吃食物/矿物，而这是建材）
  { input: Block.POLISHED_BLACKSTONE_BRICKS, output: { id: Block.CRACKED_POLISHED_BLACKSTONE_BRICKS, count: 1 }, time: SMELTING_TIME, experience: 0.1 },
];

const RECIPE_BY_INPUT = new Map<number, SmeltingRecipe>(SMELTING_RECIPES.map((recipe) => [recipe.input, recipe]));

/**
 * 某种炉子能不能烧这个物品（batch 46：烟熏炉只吃食物、高炉只吃矿物与金属）。
 *
 * ⚠️ 默认站台是 `furnace`，所以**旧的调用处一个字都不用改**——
 * 只有烟熏炉与高炉这两条新路径需要显式传站台。
 */
export function smeltingRecipeFor(itemId: number, station: FurnaceStation = 'furnace'): SmeltingRecipe | undefined {
  const recipe = RECIPE_BY_INPUT.get(itemId);
  if (!recipe) return undefined;
  return FURNACE_STATIONS[station].accepts.includes(recipe.kind ?? 'none') ? recipe : undefined;
}

/** 这个物品在**普通熔炉**里有没有配方（不管哪种炉子都能用；界面提示用） */
export function isSmeltable(itemId: number): boolean {
  return RECIPE_BY_INPUT.has(itemId);
}

/**
 * 方块 → 它对应哪种炉子（不是炉子返回 null）。
 *
 * 放在这里而不是 `main.ts`：右键打开要按它选界面模式，而套件也要断言
 * "三种炉子的方块 id 与站台一一对应"——同一份映射不该在两个地方各写一遍。
 */
export function stationOfBlock(blockId: number): FurnaceStation | null {
  if (blockId === Block.FURNACE) return 'furnace';
  if (blockId === Block.SMOKER) return 'smoker';
  if (blockId === Block.BLAST_FURNACE) return 'blast_furnace';
  return null;
}

/**
 * 这条配方在这座炉子里要烧多久（秒）。
 * 烟熏炉与高炉是原版的 2 倍速，所以这里不能直接用 `recipe.time`。
 */
export function cookSeconds(recipe: SmeltingRecipe, station: FurnaceStation): number {
  return recipe.time * FURNACE_STATIONS[station].timeScale;
}

/**
 * 这座炉子为什么不干活（界面提示用）。
 * 返回空字符串表示"没有意见"（有配方或没原料都不算问题）。
 */
export function stationRejectReason(itemId: number, station: FurnaceStation): string {
  const def = FURNACE_STATIONS[station];
  if (station === 'furnace' || !isSmeltable(itemId)) return '';
  const recipe = RECIPE_BY_INPUT.get(itemId)!;
  const kind = recipe.kind ?? 'none';
  if (def.accepts.includes(kind)) return '';
  // 说清"它只吃什么"，而不是干巴巴一句"烧不动"。
  // 文案由站台的 `accepts` 推出来：加一种站台就自动有正确的提示语
  const kinds = def.accepts
    .filter((accepted) => accepted !== 'none')
    .map((accepted) => ACCEPTS_TEXT[accepted])
    .join('与');
  const verb = station === 'campfire' ? '烤' : '烧';
  return `${def.cn}只${verb}${kinds}`;
}

export const SMELTING_RECIPE_COUNT = SMELTING_RECIPES.length;

/**
 * 燃料 → 可燃烧秒数。
 * 数值取自原版（原版以 tick 计，这里换算成秒；1 煤炭 = 1600 tick = 80 秒）。
 */
const FUELS = new Map<number, number>([
  [Item.COAL, 80],
  [Item.CHARCOAL, 80],

  [Block.OAK_LOG, 15],
  [Block.OAK_PLANKS, 15],
  [Block.CRAFTING_TABLE, 15],
  [Block.CHEST, 15],
  [Block.OAK_LEAVES, 5],
  [Item.STICK, 5],
  // 干海带块（批次 50）：原版 4001 tick ≈ 200 秒 = **能烧 20 个东西**，
  // 比煤炭（80 秒 = 8 个）还耐烧——这就是"海带农场"在原版里的意义（可再生燃料）
  [Block.DRIED_KELP_BLOCK, 200],
]);

/** 返回该物品作为燃料的可燃烧秒数；0 表示不能当燃料 */
export function fuelSeconds(itemId: number): number {
  return FUELS.get(itemId) ?? 0;
}

export function isFuel(itemId: number): boolean {
  return FUELS.has(itemId);
}
