/**
 * 物品的中文名与说明
 *
 * 注册表里的名字是英文 id（`grass_block`），玩家在界面上看到的应该是"草方块"。
 * 分两层：
 *
 *  1. **中文名**：能给规则的就用规则批量生成（16 种染料 × 羊毛/陶瓦/混凝土/染色玻璃/玻璃板/染料
 *     就有 96 条；台阶/楼梯 24 条；矿石主世界 8 + 深层 8），剩下的写成一张显式表。
 *     查不到的**回退成英文 id**——宁可显示 `warped_nylium` 也不要显示空白。
 *  2. **说明**：只给"有信息量"的东西写（矿石在哪挖、燃料能烧几个、功能方块怎么用），
 *     普通建材不写，由 `describe` 兜底成"类别 + 堆叠上限"。
 *
 * 为什么不塞进 `items.ts`：注册表是给逻辑用的（id / 掉落 / 堆叠），
 * 文案是给界面用的，两者改动的理由和频率都不一样。
 */

import { BLOCKS } from './blocks.ts';
import {
  CATEGORY_LABELS,
  categoryOf,
  CREATIVE_ITEMS,
  itemDef,
  maxStackOf,
  type ItemCategory,
} from './items.ts';

// ---------------------------------------------------------------- 规则生成

/** 16 种染料色（原版顺序），羊毛/陶瓦/混凝土/染色玻璃/玻璃板/染料都按它拼 */
const COLORS_CN: Record<string, string> = {
  white: '白色',
  orange: '橙色',
  magenta: '品红色',
  light_blue: '淡蓝色',
  yellow: '黄色',
  lime: '黄绿色',
  pink: '粉红色',
  gray: '灰色',
  light_gray: '淡灰色',
  cyan: '青色',
  purple: '紫色',
  blue: '蓝色',
  brown: '棕色',
  green: '绿色',
  red: '红色',
  black: '黑色',
};

/** 木质名称 */
const WOODS_CN: Record<string, string> = {
  oak: '橡木',
  spruce: '云杉',
  birch: '白桦',
  jungle: '丛林',
  acacia: '金合欢',
  dark_oak: '深色橡木',
};

/** 有"台阶 / 楼梯"两种变体的建材 */
const STRUCTURE_BASES_CN: Record<string, string> = {
  stone: '石头',
  cobblestone: '圆石',
  oak_planks: '橡木木板',
  spruce_planks: '云杉木板',
  birch_planks: '白桦木板',
  jungle_planks: '丛林木板',
  acacia_planks: '金合欢木板',
  dark_oak_planks: '深色橡木木板',
  sandstone: '砂岩',
  stone_bricks: '石砖',
  smooth_stone: '平滑石头',
  polished_granite: '磨制花岗岩',
  polished_diorite: '磨制闪长岩',
  polished_andesite: '磨制安山岩',
  deepslate_bricks: '深板岩砖',
  bricks: '红砖块',
  polished_deepslate: '磨制深板岩',
};

/**
 * 矿石：主世界的 8 种 + 深层的 8 种。
 * 注意矿石名不是"材料名 + 矿石"：煤炭 → **煤矿石**、红石 → **红石矿石**、青金石 → **青金石矿石**，
 * 所以单列一张表，不要拿材料名去拼。
 */
const ORE_NAMES_CN: Record<string, string> = {
  coal: '煤矿石',
  iron: '铁矿石',
  copper: '铜矿石',
  gold: '金矿石',
  redstone: '红石矿石',
  lapis: '青金石矿石',
  diamond: '钻石矿石',
  emerald: '绿宝石矿石',
};


const NAMES = new Map<string, string>();

function put(id: string, name: string): void {
  NAMES.set(id, name);
}

// 染料系：16 × 6 = 96 条
for (const [color, cn] of Object.entries(COLORS_CN)) {
  put(`${color}_dye`, `${cn}染料`);
  put(`${color}_wool`, `${cn}羊毛`);
  put(`${color}_terracotta`, `${cn}陶瓦`);
  put(`${color}_concrete`, `${cn}混凝土`);
  put(`${color}_stained_glass`, `${cn}染色玻璃`);
  put(`${color}_stained_glass_pane`, `${cn}染色玻璃板`);
}
put('terracotta', '陶瓦');
put('glass', '玻璃');
put('glass_pane', '玻璃板');

// 木头系：原木 / 木板 / 树叶
for (const [wood, cn] of Object.entries(WOODS_CN)) {
  put(`${wood}_log`, `${cn}原木`);
  put(`${wood}_planks`, `${cn}木板`);
  put(`${wood}_leaves`, `${cn}树叶`);
}

// 台阶 / 楼梯
for (const [base, cn] of Object.entries(STRUCTURE_BASES_CN)) {
  put(`${base}_slab`, `${cn}台阶`);
  put(`${base}_stairs`, `${cn}楼梯`);
}

// 矿石：`coal_ore` = 煤矿石，`deepslate_coal_ore` = 深层煤矿石
for (const [ore, cn] of Object.entries(ORE_NAMES_CN)) {
  put(`${ore}_ore`, cn);
  put(`deepslate_${ore}_ore`, `深层${cn}`);
}

// ---------------------------------------------------------------- 显式表

const EXPLICIT: Record<string, string> = {
  // 自然方块
  stone: '石头',
  dirt: '泥土',
  grass_block: '草方块',
  sand: '沙子',
  cobblestone: '圆石',
  bedrock: '基岩',
  deepslate: '深板岩',
  granite: '花岗岩',
  diorite: '闪长岩',
  andesite: '安山岩',
  tuff: '凝灰岩',
  calcite: '方解石',
  gravel: '砂砾',
  clay: '黏土块',
  sandstone: '砂岩',
  snow_block: '雪块',
  ice: '冰',
  packed_ice: '浮冰',
  obsidian: '黑曜石',
  raw_copper_block: '粗铜块',
  raw_iron_block: '粗铁块',
  // 流体与光
  water: '水',
  lava: '岩浆',
  glowstone: '荧石',
  // 建材
  stone_bricks: '石砖',
  chiseled_stone_bricks: '錾制石砖',
  smooth_stone: '平滑石头',
  polished_granite: '磨制花岗岩',
  polished_diorite: '磨制闪长岩',
  polished_andesite: '磨制安山岩',
  deepslate_bricks: '深板岩砖',
  chiseled_deepslate: '錾制深板岩',
  bricks: '红砖块',
  polished_deepslate: '磨制深板岩',
  mossy_cobblestone: '苔石',
  mossy_stone_bricks: '苔石砖',
  cracked_stone_bricks: '裂纹石砖',
  cracked_deepslate_bricks: '裂纹深板岩砖',
  cobbled_deepslate: '深板岩圆石',
  chiseled_sandstone: '錾制砂岩',
  cut_sandstone: '切制砂岩',
  smooth_sandstone: '平滑砂岩',
  // 功能方块
  crafting_table: '工作台',
  furnace: '熔炉',
  chest: '箱子',
  torch: '火把',
  ladder: '梯子',
  oak_door: '橡木门',
  oak_fence: '橡木栅栏',
  cobblestone_wall: '圆石墙',
  stone_brick_wall: '石砖墙',
  // 植物与装饰
  short_grass: '矮草',
  fern: '蕨',
  dandelion: '蒲公英',
  poppy: '虞美人',
  blue_orchid: '兰花',
  oxeye_daisy: '雏菊',
  cornflower: '矢车菊',
  red_mushroom: '红色蘑菇',
  brown_mushroom: '棕色蘑菇',
  sugar_cane: '甘蔗',
  pumpkin: '南瓜',
  melon: '西瓜',
  cactus: '仙人掌',
  dead_bush: '枯萎的灌木',
  bamboo: '竹子',
  // 海底
  prismarine: '海晶石',
  prismarine_bricks: '海晶石砖',
  dark_prismarine: '暗海晶石',
  sea_lantern: '海晶灯',
  // 下界
  netherrack: '下界岩',
  soul_sand: '灵魂沙',
  soul_soil: '灵魂土',
  basalt: '玄武岩',
  smooth_basalt: '平滑玄武岩',
  blackstone: '黑石',
  magma_block: '岩浆块',
  crimson_nylium: '绯红菌岩',
  warped_nylium: '诡异菌岩',
  crimson_stem: '绯红菌柄',
  warped_stem: '诡异菌柄',
  crimson_planks: '绯红木板',
  warped_planks: '诡异木板',
  crimson_fungus: '绯红菌',
  warped_fungus: '诡异菌',
  nether_wart_block: '下界疣块',
  warped_wart_block: '诡异疣块',
  shroomlight: '菌光体',
  nether_bricks: '下界砖',
  nether_quartz_ore: '下界石英矿石',
  ancient_debris: '远古残骸',
  crimson_roots: '绯红菌索',
  warped_roots: '诡异菌索',
  nether_sprouts: '下界苗',
  // 末地
  end_stone: '末地石',
  end_stone_bricks: '末地石砖',
  purpur_block: '紫珀块',
  purpur_pillar: '紫珀柱',
  chorus_plant: '紫颂植物',
  chorus_flower: '紫颂花',
  end_rod: '末地烛',
  dragon_egg: '龙蛋',
  end_portal_frame: '末地传送门框架',
  end_portal: '末地传送门',
  // 物品
  coal: '煤炭',
  charcoal: '木炭',
  raw_iron: '粗铁',
  raw_copper: '粗铜',
  raw_gold: '粗金',
  redstone: '红石粉',
  lapis_lazuli: '青金石',
  diamond: '钻石',
  emerald: '绿宝石',
  stick: '木棍',
  iron_ingot: '铁锭',
  gold_ingot: '金锭',
  copper_ingot: '铜锭',
  brick: '红砖',
  clay_ball: '黏土球',
  chicken: '生鸡肉',
  leather: '皮革',
  feather: '羽毛',
};

for (const [id, name] of Object.entries(EXPLICIT)) put(id, name);

/** 红石元件的中文名（它们由红石系统注册，单独一张小表） */
const REDSTONE_CN: Record<string, string> = {
  redstone_wire: '红石线',
  redstone_torch: '红石火把',
  redstone_block: '红石块',
  lever: '拉杆',
  stone_button: '石头按钮',
  oak_button: '橡木按钮',
  stone_pressure_plate: '石质压力板',
  oak_pressure_plate: '橡木压力板',
  repeater: '红石中继器',
  comparator: '红石比较器',
  redstone_lamp: '红石灯',
  piston: '活塞',
  piston_head: '活塞头',
  sticky_piston: '黏性活塞',
  observer: '侦测器',
  iron_door: '铁门',
  iron_trapdoor: '铁活板门',
  oak_trapdoor: '橡木活板门',
  note_block: '音符盒',
  dispenser: '发射器',
  dropper: '投掷器',
  hopper: '漏斗',
  target: '标靶',
  daylight_detector: '阳光探测器',
  tripwire: '绊线',
  tripwire_hook: '绊线钩',
  slime_block: '黏液块',
  honey_block: '蜂蜜块',
  rail: '铁轨',
  powered_rail: '动力铁轨',
  detector_rail: '探测铁轨',
  activator_rail: '激活铁轨',
};
for (const [id, name] of Object.entries(REDSTONE_CN)) put(id, name);

// ---------------------------------------------------------------- 说明

/**
 * 说明文案。
 *
 * 只写"光看图标看不出来"的信息：矿石在哪一层、这个能当燃料、右键能打开什么界面。
 * 普通建材不写（写"一种方块"没有意义）。
 */
const DESCRIPTIONS: Record<string, string> = {
  coal: '燃料：能烧炼 8 个物品；也是火把的主要材料。',
  charcoal: '燃料：能烧炼 8 个物品；用原木在熔炉里烧出来，去不了煤矿时的替代品。',
  stick: '合成材料：工具手柄、火把、梯子、栅栏都要它。',
  raw_iron: '铁矿石直接挖出来的原矿，放进熔炉烧成铁锭。',
  raw_copper: '铜矿石的原矿，熔炼后得到铜锭。',
  raw_gold: '金矿石的原矿，熔炼后得到金锭。',
  iron_ingot: '由粗铁或铁矿石熔炼而来；工具、铁轨、铁门的材料。',
  gold_ingot: '由粗金或金矿石熔炼而来；可以做动力铁轨与金苹果。',
  copper_ingot: '由粗铜熔炼而来；还能做成铜块。',
  diamond: '珍贵的矿物，能做最强的工具与盔甲。',
  emerald: '珍贵的矿物，主要用来和村民交易。',
  lapis_lazuli: '附魔台要用的宝石，也能做蓝色染料。',
  redstone: '红石电路的"电"；也用来做红石火把、中继器、比较器。',
  brick: '由黏土球烧制，4 个合成 1 块红砖块。',
  clay_ball: '由黏土块挖出，可烧制成红砖。',
  leather: '牛的掉落物，可以做书与盔甲。',
  feather: '鸡的掉落物，可以做箭与书。',
  chicken: '生鸡肉：可以吃，但生的会闹肚子，烤熟更安全。',
  torch: '照明方块：放在地面或墙上，夜里也能看清周围。',
  crafting_table: '右键打开 3×3 合成台（背包里只有 2×2）。',
  furnace: '右键打开熔炉：烧炼矿石、烤食物，需要燃料。',
  chest: '右键打开 27 格存储空间，多个箱子可以并排摆放。',
  ladder: '贴在墙上可以上下攀爬。',
  oak_door: '两格高的门，右键开关；放上方块需要留出空间。',
  glowstone: '明亮的照明方块，比火把亮得多。',
  lava: '碰到会持续掉血，也会点燃附近的可燃方块。',
  water: '可以在里面游泳，会缓慢恢复氧气以外的状态。',
  bedrock: '世界底部的基岩，挖不动。',
  obsidian: '需要钻石镐才能挖动；要塞的传送门房用它搭成。',
  sugar_cane: '长在水边的植物：可以做纸，也能做糖。',
  cactus: '碰到会掉血；可烧成绿色染料。',
  melon: '西瓜片：吃下能恢复饥饿值。',
  pumpkin: '可以做成雕刻南瓜，也能做南瓜派。',
  coal_ore: '用镐挖出煤炭；深层也有分布。',
  iron_ore: '用石镐以上才能挖动，掉落粗铁。',
  copper_ore: '用石镐以上才能挖动，掉落粗铜。',
  gold_ore: '用铁镐以上才能挖动，掉落粗金。',
  diamond_ore: '用铁镐以上才能挖动，是最有价值的矿石之一。',
  redstone_ore: '用铁镐以上才能挖动，掉落红石粉。',
  lapis_ore: '用石镐以上才能挖动，掉落青金石。',
  emerald_ore: '只在山地群系生成，掉落绿宝石。',
  prismarine: '海底神殿的建材，也由守卫者掉落。',
  sea_lantern: '海晶石做的光源，亮度很高。',
  netherrack: '下界最常见的岩石，用镐能很快挖开。',
  soul_sand: '踩上去会陷进去；也能种下界疣。',
  magma_block: '站在上面会掉血，但可以作为无限岩浆源的一部分。',
  bamboo: '丛林中大量生长，可以做成木棍与脚手架。',
  short_grass: '用剪刀能剪下来当装饰。',
  red_mushroom: '能做蘑菇煲，也能种成巨型蘑菇。',
  brown_mushroom: '能做蘑菇煲，在暗处生长。',
  dead_bush: '沙漠与恶地的枯木，可以当燃料。',
  snow_block: '雪做的方块，会融化（附近有热源时）。',
  ice: '光滑的冰面，走在上面会打滑。',
  gravel: '会掉落的方块；也是村庄道路的铺装材料。',
  sand: '会掉落的方块，能烧成玻璃。',
  redstone_wire: '红石线：把信号从电源传到元件上，最多传 15 格。',
  redstone_torch: '持续输出 15 级信号，也能反过来给红石线充能。',
  lever: '手动开关：右键切换通断。',
  stone_button: '按一下短暂通电，之后自动弹回。',
  repeater: '中继信号（可以延长到 15 格外）、也能做延迟与单向传输。',
  comparator: '比较两路信号的强度，也能读取箱子这类方块的状态。',
  redstone_lamp: '通电就亮，断电就灭。',
  piston: '通电时把前面的方块推出去，最多推 12 格。',
  sticky_piston: '通电推出、断电拉回。',
  observer: '侦测前方方块的变化，并从背面发出一个脉冲。',
  dispenser: '通电时把里面的物品"发射"出去。',
  dropper: '通电时把里面的物品倒进对面的容器。',
  hopper: '自动把上方容器的物品搬到下方容器里。',
  note_block: '在上面放乐器演奏会发出不同的声音。',
  rail: '铁轨：矿车在上面行驶。',
  powered_rail: '动力铁轨：通电后给矿车加速。',
  slime_block: '能弹跳，也能粘住方块一起被活塞推动。',
  honey_block: '能粘住方块，但不会让人弹跳。',
};

// 深层矿石统一补一句
for (const [ore, cn] of Object.entries(ORE_NAMES_CN)) {
  DESCRIPTIONS[`deepslate_${ore}_ore`] = `深层（深板岩层）的${cn}，掉落与普通${cn}相同。`;
}

// ---------------------------------------------------------------- 对外接口

/** 由英文 id（可带命名空间）取中文名；查不到就回退成英文 id */
export function translateName(id: string): string {
  const key = id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
  return NAMES.get(key) ?? key;
}

/** 方块的中文名 */
export function blockLabel(blockId: number): string {
  const def = BLOCKS[blockId];
  if (!def || def.id === 0) return '空气';
  return translateName(def.name);
}

/** 物品的中文名（方块物品与方块同名） */
export function itemLabel(itemId: number): string {
  const def = itemDef(itemId);
  if (!def) return `未知物品(${itemId})`;
  // 方块物品走方块那张表：`Block.GRASS_BLOCK` 的注册名就是 grass_block
  return translateName(def.name);
}

/** 中文类别名 */
export function categoryLabel(itemId: number): string {
  const category: ItemCategory = categoryOf(itemId);
  return CATEGORY_LABELS[category] ?? category;
}

/**
 * 物品说明。
 *
 * 只返回**专门写过**的文案；没写过的返回空串——
 * 这种物品的信息量就是"类别 + 堆叠上限"，交给提示框的 meta 那一行显示即可，
 * 在这里再拼一遍会出现两行几乎一样的内容。
 */
export function itemDescription(itemId: number): string {
  const def = itemDef(itemId);
  if (!def) return '';
  const key = def.name.startsWith('minecraft:') ? def.name.slice('minecraft:'.length) : def.name;
  return DESCRIPTIONS[key] ?? '';
}

/** 是否有专门写过的说明（界面用它决定要不要额外显示"类别/堆叠"那行） */
export function hasDescription(itemId: number): boolean {
  const def = itemDef(itemId);
  if (!def) return false;
  const key = def.name.startsWith('minecraft:') ? def.name.slice('minecraft:'.length) : def.name;
  return key in DESCRIPTIONS;
}

/** 提示框要显示的全部内容 */
export interface ItemTooltip {
  /** 主标题：中文名 */
  title: string;
  /** 副标题：英文 id（方便对照 wiki 与配方数据） */
  subtitle: string;
  /** 说明正文 */
  description: string;
  /** 是否显示"类别 / 堆叠"那一行 */
  showMeta: boolean;
  category: string;
  maxStack: number;
  /** 数量（>1 时才显示） */
  count: number;
}

export function itemTooltip(itemId: number, count = 1): ItemTooltip {
  const def = itemDef(itemId);
  const rawName = def?.name ?? 'unknown';
  return {
    title: itemLabel(itemId),
    subtitle: rawName,
    description: itemDescription(itemId),
    showMeta: !hasDescription(itemId),
    category: categoryLabel(itemId),
    maxStack: maxStackOf(itemId),
    count,
  };
}

/** 供测试与调试：所有有中文名的条目数 */
export function knownNameCount(): number {
  return NAMES.size;
}

/** 供测试用：方块表里还没翻译的条目（应当为空） */
export function missingBlockNames(): string[] {
  const missing: string[] = [];
  for (const def of BLOCKS) {
    if (!def || def.id === 0) continue;
    const key = def.name.replace('minecraft:', '');
    if (!NAMES.has(key)) missing.push(key);
  }
  return missing;
}

// ---------------------------------------------------------------- 名字 → id

/** 物品名索引：英文全名 / 英文短名 / 中文名 / 数字 id 都指向同一个 id */
let itemIndex: Map<string, number> | null = null;
/** 方块名索引：只有方块（放置类命令用） */
let blockIndex: Map<string, number> | null = null;

function buildItemIndex(): Map<string, number> {
  const index = new Map<string, number>();
  for (const id of CREATIVE_ITEMS) {
    const def = itemDef(id);
    if (!def) continue;
    const full = def.name;
    const short = full.startsWith('minecraft:') ? full.slice('minecraft:'.length) : full;
    index.set(full.toLowerCase(), id);
    index.set(short.toLowerCase(), id);
    index.set(itemLabel(id), id);
    index.set(String(id), id);
  }
  return index;
}

function buildBlockIndex(): Map<string, number> {
  const index = new Map<string, number>();
  for (const def of BLOCKS) {
    if (!def || def.id === 0) continue;
    const short = def.name.replace('minecraft:', '');
    index.set(short.toLowerCase(), def.id);
    index.set(def.name.toLowerCase(), def.id);
    index.set(blockLabel(def.id), def.id);
  }
  return index;
}

/**
 * 按名字找物品 id。
 * 接受 `minecraft:stone` / `stone` / `石头` / 数字 id 四种写法——
 * 命令与创造物品栏搜索共用同一套解析，玩家不用记英文。
 */
export function resolveItemId(query: string): number | undefined {
  const raw = query.trim();
  if (raw.length === 0) return undefined;
  if (!itemIndex) itemIndex = buildItemIndex();
  return itemIndex.get(raw.toLowerCase()) ?? itemIndex.get(raw);
}

/** 按名字找方块 id（只含方块；空气用 `air` 或 0） */
export function resolveBlockId(query: string): number | undefined {
  const raw = query.trim();
  if (raw.length === 0) return undefined;
  if (raw === 'air' || raw === 'minecraft:air' || raw === '空气' || raw === '0') return 0;
  if (!blockIndex) blockIndex = buildBlockIndex();
  return blockIndex.get(raw.toLowerCase()) ?? blockIndex.get(raw);
}

/** 供测试与调试：索引规模 */
export function nameIndexSize(): { items: number; blocks: number } {
  if (!itemIndex) itemIndex = buildItemIndex();
  if (!blockIndex) blockIndex = buildBlockIndex();
  return { items: itemIndex.size, blocks: blockIndex.size };
}
