/**
 * 方块注册表
 *
 * 设计说明：
 * - 方块以数字 id 存储在世界数据里（Uint8Array），注册表负责 id ↔ 定义 的映射。
 * - `tiles` 为 [顶面, 底面, 侧面] 三个图集贴图名。
 * - 完整 1.18 方块集（含 block state）会在 B3/B4 逐步补齐；当前覆盖地形生成所需部分。
 */

import { DYE_COLORS, WOOD_TYPES } from './colors.ts';
import { railShapeOf } from '../world/RailShape.ts';
import { BLOCK_BEHAVIORS } from './blockBehaviors.ts';
import { isWaterlogged, type BlockShape, withWaterlogged } from './blockState.ts';
// 画（B14，批次 86）：贴图按"哪一幅"换，而"哪一幅"的表在 `paintings.ts` 里
// （那是纯数据、不引任何模块，所以这里引它不会成环）
// 方块 id 的分配表是叶子模块（见 `blockIds.ts` 头注释：依赖方向必须是单向的）。
// 既要**再导出**（224 个引用方不用改），也要**本地导入**（`export *` 不会把名字带进本模块作用域）。

export * from './blockIds.ts';
import {
  WOOL_ID_START,
  TERRACOTTA_ID_START,
  CONCRETE_ID_START,
  CONCRETE_POWDER_ID_START,
  STAINED_GLASS_ID_START,
  GLASS_PANE_ID,
  STAINED_GLASS_PANE_ID_START,
  SLAB_ID_START,
  STAIRS_ID_START,
  SOUL_FIRE_ID,
  CONDUIT_ID,
  POWDER_SNOW_ID,
  CARPET_ID_START,
  SNOW_LAYER_ID,
  BANNER_ID_START,
  STONECUTTER_ID,
  SMOKER_ID,
  BLAST_FURNACE_ID,
  CAMPFIRE_ID,
  SWEET_BERRY_BUSH_ID_START,
  COCOA_ID_START,
  KELP_ID,
  SEAGRASS_ID,
  DRIED_KELP_BLOCK_ID,
  CORAL_BLOCK_ID_START,
  DEAD_CORAL_BLOCK_ID_START,
  CORAL_ID_START,
  DEAD_CORAL_ID_START,
  CORAL_FAN_ID_START,
  DEAD_CORAL_FAN_ID_START,
  CAKE_ID,
  FLOWER_POT_ID,
  SCAFFOLDING_ID,
  DAYLIGHT_DETECTOR_ID,
  TRIPWIRE_ID,
  TRIPWIRE_HOOK_ID,
  TNT_ID,
  HOPPER_ID,
  DROPPER_ID,
  DISPENSER_ID,
  BARREL_ID,
  COMPOSTER_ID,
  NOTE_BLOCK_ID,
  CAULDRON_ID,
  ENDER_CHEST_ID,
  SHULKER_BOX_ID,
  SPONGE_ID,
  WET_SPONGE_ID,
  HONEY_BLOCK_ID,
  LODESTONE_ID,
  SHULKER_BOX_COLOR_START,
  RESPAWN_ANCHOR_ID,
  JUKEBOX_ID,
  BELL_ID,
  ARMOR_STAND_ID,
  CAVE_VINES_ID,
  COMMAND_BLOCK_ID,
  WOOD_SAPLING_ID_START,
  PUMPKIN_STEM_ID_START,
  MELON_STEM_ID_START,
  PUMPKIN_STEM_ATTACHED_ID,
  MELON_STEM_ATTACHED_ID,
  RAIL_ID,
  POWERED_RAIL_ID,
  DETECTOR_RAIL_ID,
  ACTIVATOR_RAIL_ID,
  LIGHT_WEIGHTED_PRESSURE_PLATE_ID,
  HEAVY_WEIGHTED_PRESSURE_PLATE_ID,
  TARGET_ID,
  FROSTED_ICE_ID,
  BED_ID_START,
  SIGN_ID_START,
  POLISHED_BLACKSTONE_ID,
  POLISHED_BLACKSTONE_BRICKS_ID,
  GILDED_BLACKSTONE_ID,
  CHISELED_POLISHED_BLACKSTONE_ID,
  CRACKED_POLISHED_BLACKSTONE_BRICKS_ID,
  LIGHTNING_ROD_ID,
  ITEM_FRAME_ID,
  PAINTING_ID,
  LECTERN_ID,
  FLETCHING_TABLE_ID,
  GRINDSTONE_ID,
  LOOM_ID,
  CARTOGRAPHY_TABLE_ID,
  NETHER_WART_ID_START,
  SPAWNER_ID,
  WITHER_SKELETON_SKULL_ID,
  GOLD_BLOCK_ID,
  DIAMOND_BLOCK_ID,
  EMERALD_BLOCK_ID,
  BEACON_ID,
  SLIME_BLOCK_ID,
  SOUL_TORCH_ID,
  SOUL_LANTERN_ID,
  Wood,
  WoodShaped,
  SAPLING_IDS,
  STONE_VARIANT_PARENTS,
  stoneVariantId,
  BED_IDS,
  SIGN_IDS,
  SHAPED_PARENTS,
  COPPER_STAGES,
  copperId,
  CORAL_KINDS,
  STEM_STAGES,
} from './blockIds.ts';

// 方块表的**数据**在单独模块里（依赖单向：blockIds → blockSpecs → blocks）
import { SPECS } from './blockSpecs.ts';

export interface BlockDef {
  readonly id: number;
  readonly name: string;
  /** [顶面, 底面, 侧面]，值为图集贴图名 */
  readonly tiles: readonly [string, string, string];
  /** 参与碰撞 */
  readonly solid: boolean;
  /** 完全遮挡：剔除相邻面 + 阻挡光照 */
  readonly opaque: boolean;
  /**
   * 头卡在这一格里会不会**窒息**（批次 218）。
   *
   * 与 `opaque` 分开写：树叶为了渲染优化是**不透明**的（要剔除相邻面），
   * 但原版**钻进树叶里不掉血**——之前直接拿 `opaque` 当判据，导致站在树冠里
   * 会被"窒息"判定持续扣血。默认值跟 `opaque` 一致（绝大多数方块两者相同）。
   */
  readonly suffocates: boolean;
  /** 自发光等级 0-15 */
  readonly light: number;
  /** 光照衰减（0-15）：光穿过该方块时减少的等级，≥15 视为完全阻挡 */
  readonly lightOpacity: number;
  /** 是否为液体 */
  readonly liquid: boolean;
  /** 半透明：走独立的透明渲染层（水、玻璃、冰） */
  readonly translucent: boolean;
  /** 几何形状族：完整立方体 / 台阶 / 楼梯 / 栅栏 / 墙 / 门 / 火把 / 梯子 */
  readonly shape: BlockShape;
  /** 按状态取贴图（红石灯亮/灭这类）；不填则一律用 tiles */
  readonly stateTiles?: (state: number) => readonly [string, string, string];
  /**
   * **面级贴图**（批次 64）：给指定朝向的那一面单独一张，其它面回退到 `tiles`。
   *
   * 参数给的是**面的外法线**（与网格化器 `FACES` 的 `dir` 一致），
   * 而不是面的下标——这样"哪一面是正面"这件事不必让调用方知道 FACES 的排列顺序
   * （顺序一改，按下标写的那份映射就会静默错位）。
   * 返回 `undefined` 表示"这一面没有特殊，用普通贴图"。
   */
  readonly faceTile?: (state: number, faceDir: readonly [number, number, number]) => string | undefined;
  /**
   * 放置时**正脸朝放置者**（原版熔炉家族就是取玩家朝向的反方向）。
   * 用它的方块同时应当有 `faceTile`，否则"朝向"看不出来。
   *
   * ⚠️ **只给水平四向**：熔炉/活塞/侦测器这些方块的逻辑读的是水平朝向
   * （`facingOf` 只读那两位，`FACING_OFFSET` 也只有四向），写成六向会让它们静默读错。
   */
  readonly facesPlayer?: boolean;
  /**
   * 朝向：默认**朝放置者**（水平四向），**潜行**时改成沿命中面法线（**六向**：点顶面 → 朝上）。
   *
   * 活塞 / 侦测器用（它们的默认朝向与"被点的那个方块"无关）。
   * ⚠️ 投掷器 / 发射器那一族的口径是**相反**的——"凸口朝被点的那个方块"，
   * 它们的潜行分支写在自己的形状 case 里（`Placement.ts`），刻意不合并到这里。
   */
  readonly facesSneak?: boolean;
  /**
   * 放置时正脸**沿命中面的法线**（**六向**：点顶面 → 朝上、点底面 → 朝下）。
   *
   * 木桶用它（原版木桶的盖子朝向是"最近看向方向的反面"，而"点在哪个面上"
   * 在常见手势下给出的结果一致，且不需要俯仰角）。与 `facesPlayer` 互斥使用：
   * 一个要六向、一个要四向，混用正是上面那条警告的来源。
   */
  readonly facesNormal?: boolean;
  /** 按状态取发光等级（红石灯亮时 15）；不填则一律用 light */
  readonly stateLight?: (state: number) => number;
  /**
   * 不生成对应物品（原版火焰就没有物品：只能靠打火石/岩浆点燃）。
   *
   * 方块物品是**批量注册**的（见 `items.ts` 里那段循环），不显式排除的话
   * 会自动多出一件"可放置的火焰"，玩家能在背包里拿到它——与 I12 的设计不符。
   */
  readonly itemless: boolean;
  /**
   * 长在水里的植物（批次 50 的海带与海草）。
   *
   * 本项目的水是**流体方块**（`Block.WATER` 占着那一格），所以"水里的植物"
   * 必须是"把水那一格换成植物"——这就是它需要的两条特殊待遇：
   *  1. **放置**：落点那一格必须是水（而不是空气），见 `Placement.ts`
   *  2. **不许被水冲走**：`Fluids.canFlowInto` 见到它就返回 false
   *     （否则旁边一格水会把它当"可替换方块"直接覆盖掉，海带一放下去就没了）
   */
  readonly waterPlant: boolean;
}





// ---------------------------------------------------------------- 木材家族







// ---------------------------------------------------------------- 木制方块族（栅栏 / 栅栏门 / 门 / 活板门）







// ---------------------------------------------------------------- 陶瓦与混凝土



/**
 * 第 index 种颜色的陶瓦 id（与 `concreteId` / `woolId` 同一套 0-based 口径）。
 *
 * ⚠️ **原色陶瓦是 `Block.TERRACOTTA`，不是 `terracottaId(0)`**：原色那一格排在
 * 16 种颜色**之前**（127），所以 `terracottaId(0)` = 128 = **白色**陶瓦。
 * 上一版这里是 `TERRACOTTA_ID_START + colorIndex`（把原色当成了下标 0），
 * 于是荒地的色带按颜色名写的那几行整体差一格——"橙"画出的是白色、
 * "黄"画出的是浅蓝色（批次 91 修；`SurfaceRules` 的注释一直是对的，错的是下标）。
 */
export function terracottaId(colorIndex: number): number {
  return TERRACOTTA_ID_START + 1 + colorIndex;
}

/** 第 index 种颜色的混凝土 id */
export function concreteId(colorIndex: number): number {
  return CONCRETE_ID_START + colorIndex;
}

/** 第 index 种颜色的**混凝土粉末** id（与 `concreteId` 同色同序，见 `concreteForPowder`） */
export function concretePowderId(colorIndex: number): number {
  return CONCRETE_POWDER_ID_START + colorIndex;
}

// ---------------------------------------------------------------- 石材补全 / 玻璃


/** 第 index 种颜色的染色玻璃 id */
export function stainedGlassId(colorIndex: number): number {
  return STAINED_GLASS_ID_START + colorIndex;
}

/** 第 index 种颜色的染色玻璃板 id */
export function stainedGlassPaneId(colorIndex: number): number {
  return STAINED_GLASS_PANE_ID_START + colorIndex;
}


// ---------------------------------------------------------------- 台阶 / 楼梯



export function slabId(parentIndex: number): number {
  return SLAB_ID_START + parentIndex;
}

export function stairsId(parentIndex: number): number {
  return STAIRS_ID_START + parentIndex;
}



// ---------------------------------------------------------------- 栅栏 / 墙 / 门 / 火把 / 梯子


// ---------------------------------------------------------------- 自然装饰（地物）
//
// 植物统一用 `cross` 形状（两片交叉薄面、无碰撞），仙人掌用 `cactus` 形状（内缩 1 像素的立方体）。
// 它们都是**不遮挡**的（opaque=false）——否则长在草方块上的花会把脚下的草地剔掉一面。





// ---------------------------------------------------------------- 下界
//
// 下界方块全部走同一竖列 id，下界地形生成器按这些 id 直接写方块。
// 菌柄（stem）与主世界原木结构一致，只是配色偏紫红 / 青蓝。


// ---------------------------------------------------------------- 末地
//
// 末地的方块数不多（末地石 / 末地石砖 / 紫珀家族 / 紫颂 / 末地烛 / 龙蛋 / 传送门），
// 但紫颂植株与紫颂花是末地独有的"树"，末地城与末地船则全靠紫珀和末地石砖搭。
//
// ⚠️ 紫珀与末地石砖**没有台阶/楼梯变体**：SHAPED_PARENTS 的 slab/stairs id 区间
// 与后面的栅栏/装饰 id 紧挨着，追加母方块会撞 id（见 blocks.ts 里 SHAPED_PARENTS 的注释）。
// 末地城因此用整块搭建，已在 TASKS.md 记录这个取舍。


// ---------------------------------------------------------------- 红石元件
//
// 红石方块分两类：
//  - **电源与传输**：红石粉（贴地薄板）、红石火把、红石块、拉杆、按钮、压力板、中继器、比较器
//  - **执行器**：红石灯（亮/灭两套贴图 + 发光等级）、活塞 / 粘性活塞（伸出时在前方放一个活塞头）
//
// 信号强度**不存在方块状态里**，而是由 `core/redstone/RedstoneEngine.ts` 在运行时维护
// （方块状态只有 8 位，还要留给朝向与延迟；强度是易变的中间量，没必要落盘）。
// 状态位只用来记"元件的持久状态"：通电/按下（bit3）、朝向（bit1-2）、中继器延迟（bit4-5）。




/**
 * 全部方块定义。
 * ⚠️ 必须按 id 升序排列：BLOCKS 是按数组下标索引的，顺序错位会让 blockDef(id) 取到别的方块。
 */








// ---------------------------------------------------------------- 地毯与雪层（批次 37）
//
// 这一批是"方块族批量推进"（B16）的第一块：地毯按 16 色配色表生成，
// 雪层则给"雪原＝一片白"这件事补上真正的地表装饰（D14 / K11 的尾巴）。







// ---------------------------------------------------------------- 锁链与藤蔓（B11 收口）



// ---------------------------------------------------------------- 铜的氧化（批次 40）







/**
 * 旗帜的贴图名（批次 497）：光板用 `banner_<color>`，有图案用 `banner_<color>_p<n>`。
 *
 * 为什么不做"图层叠加"：方块渲染一条路径只采样一张瓦片；而 16 色 × 4 图案
 * 一共 64 张图，图集完全放得下——比给渲染管线加一层混合便宜得多。
 */
export function bannerPatternTile(colorName: string, pattern: number): string {
  if (pattern <= 0) return `banner_${colorName}`;
  return `banner_${colorName}_p${Math.min(4, pattern)}`;
}

/** 这一块是不是旗帜（放置/破坏/掉落都认它） */
export function isBannerId(id: number): boolean {
  return id >= BANNER_ID_START && id < BANNER_ID_START + DYE_COLORS.length;
}


// ---------------------------------------------------------------- 石英与更多石材（批次 42）



// ---------------------------------------------------------------- 切石机（批次 44）



// ---------------------------------------------------------------- 红沙与红砂岩（批次 45）



// ---------------------------------------------------------------- 烟熏炉与高炉（批次 46）




// ---------------------------------------------------------------- 甜浆果丛与可可豆（批次 49）



// ---------------------------------------------------------------- 海带与海草（批次 50）





// ---------------------------------------------------------------- 珊瑚一族（批次 51）


export type CoralKind = (typeof CORAL_KINDS)[number];

/** 五种珊瑚的中文译名（方块名与物品名共用同一套） */
export const CORAL_KIND_CN: Record<CoralKind, string> = {
  tube: '管',
  brain: '脑',
  bubble: '气泡',
  fire: '火',
  horn: '鹿角',
};



/** 珊瑚一族的"活 ↔ 失活"对照（掉落要用、失活与复活两条机制也要用） */
export const CORAL_DEAD_VARIANT = new Map<number, number>();
export const CORAL_LIVE_VARIANT = new Map<number, number>();
for (const [liveStart, deadStart] of [
  [CORAL_BLOCK_ID_START, DEAD_CORAL_BLOCK_ID_START],
  [CORAL_ID_START, DEAD_CORAL_ID_START],
  [CORAL_FAN_ID_START, DEAD_CORAL_FAN_ID_START],
] as const) {
  for (let i = 0; i < CORAL_KINDS.length; i++) {
    CORAL_DEAD_VARIANT.set(liveStart + i, deadStart + i);
    CORAL_LIVE_VARIANT.set(deadStart + i, liveStart + i);
  }
}

/**
 * 这一格是不是"活珊瑚"（变色都用它）。
 *
 * ⚠️ 判据是"**在活珊瑚那张表里**"，而不是"是珊瑚族但不是失活的"：
 * 后者要求先判断"是不是珊瑚族"，那就得再维护一张族表——两张表迟早会不一样。
 */
export function isLiveCoral(id: number): boolean {
  return CORAL_DEAD_VARIANT.has(id);
}

/** 这一格是不是"失活珊瑚"（同样只看表） */
export function isDeadCoral(id: number): boolean {
  return CORAL_LIVE_VARIANT.has(id);
}

// ---------------------------------------------------------------- 蛋糕与花盆（批次 52）



// ---------------------------------------------------------------- 脚手架（批次 53）



























/** 全部潜影盒（无色 + 16 色）：容器登记、掉落带内容、活塞推不动都认这一张表 */
export const SHULKER_BOX_IDS: readonly number[] = [
  SHULKER_BOX_ID,
  // ⚠️ 用算术算，不要去查 `COLORED_SHULKER_SPECS`：那张表是**数据**（已搬进 `blockSpecs.ts`，
  //    生产构建里根本不加载），而这张 id 表运行时要一直可用。
  ...DYE_COLORS.map((_color, index) => SHULKER_BOX_COLOR_START + index),
];














const SHULKER_BOX_ID_SET = new Set<number>(SHULKER_BOX_IDS);

/** 这一块是不是潜影盒（任意颜色）。容器/掉落/活塞那几处特判都改问它 */
export function isShulkerBox(id: number): boolean {
  return SHULKER_BOX_ID_SET.has(id);
}

/** 某种颜色的潜影盒 id（颜色名与 `DYE_COLORS` 同序）；无色返回 482 */
export function shulkerBoxId(colorName: string): number | undefined {
  const index = DYE_COLORS.findIndex((color) => color.name === colorName);
  return index < 0 ? undefined : SHULKER_BOX_COLOR_START + index;
}


// ---------------------------------------------------------------- 树苗（批次 75，B47）









// ---------------------------------------------------------------- 瓜藤与果实（批次 77，B48）




/** 结果的茎 → 它属于哪种瓜 */
const ATTACHED_STEMS = new Map<number, string>([
  [PUMPKIN_STEM_ATTACHED_ID, 'pumpkin'],
  [MELON_STEM_ATTACHED_ID, 'melon'],
]);


/** 这个 id 是茎的哪个阶段（不是则 -1）；结果的茎返回 -1（它不长了） */
export function stemStageOf(id: number): number {
  for (const stages of Object.values(STEM_STAGES)) {
    const stage = stages.indexOf(id);
    if (stage >= 0) return stage;
  }
  return -1;
}

/** 这个 id 是哪种茎（`pumpkin` / `melon`；不是茎返回 null）——**结果的茎也算** */
export function stemKindOf(id: number): string | null {
  for (const [kind, stages] of Object.entries(STEM_STAGES)) {
    if (stages.includes(id)) return kind;
  }
  return ATTACHED_STEMS.get(id) ?? null;
}

/** 这是不是"已经结果的茎"（不再生长，但打掉仍给种子） */
export function isAttachedStem(id: number): boolean {
  return ATTACHED_STEMS.has(id);
}

/** 这种茎结果之后变成哪个 id */
export function attachedStemId(kind: string): number | undefined {
  for (const [attachedId, attachedKind] of ATTACHED_STEMS) {
    if (attachedKind === kind) return attachedId;
  }
  return undefined;
}









// ---------------------------------------------------------------- 石材家族的变体（批次 41）



/**
 * 铁轨形状对应的贴图名（批次 478）。
 *
 * 弯道四张、直轨两张；`stateTiles` 返回的必须是图集里注册过的 key。
 */
export function railTileFor(state: number, prefix = 'rail'): string {
  switch (railShapeOf(state)) {
    case 'east_west':
      return `${prefix}_east_west`;
    case 'north_east':
      return `${prefix}_ne`;
    case 'north_west':
      return `${prefix}_nw`;
    case 'south_east':
      return `${prefix}_se`;
    case 'south_west':
      return `${prefix}_sw`;
    default:
      // 直轨（南北）与坡道都用直轨那张：坡道的几何是 4 段阶梯，
      // 贴图按面拉伸之后本来就看着像斜的
      return prefix;
  }
}

/** 四种铁轨（形状判定、矿车转向、红石元件表都认这一张） */
export const RAIL_IDS: readonly number[] = [RAIL_ID, POWERED_RAIL_ID, DETECTOR_RAIL_ID, ACTIVATOR_RAIL_ID];

/** 这一块是不是铁轨（批次 478：放置时按邻居自动接成直/弯） */
export function isRailId(id: number): boolean {
  return RAIL_IDS.includes(id);
}


/**
 * 测重压力板（批次 247）：与普通压力板同样几何，区别只在**输出强度随实体数量变化**
 * （轻质 1 个/点、重质 10 个/点），所以它们走红石引擎里"可变强度电源"那条路。
 */













// ---------------------------------------------------------------- 床（B13，批次 79）






/** 这张床是第几种颜色；不是床返回 -1（存档里出现越界 id 时也返回 -1） */
export function bedColorIndex(blockId: number): number {
  const index = blockId - BED_ID_START;
  return index >= 0 && index < DYE_COLORS.length ? index : -1;
}

/** 这一格是不是床 */
export function isBed(blockId: number): boolean {
  return bedColorIndex(blockId) >= 0;
}


// ---------------------------------------------------------------- 告示牌（B12，批次 80）





/** 这一格是不是告示牌（落地 / 挂墙都算） */
export function isSign(blockId: number): boolean {
  const index = blockId - SIGN_ID_START;
  return index >= 0 && index < WOOD_TYPES.length;
}


// ---------------------------------------------------------------- 黑石家族（K8 收尾，批次 82）

/**
 * 堡垒遗迹要用的三个黑石家族方块（原版的堡垒遗迹就是这套建材）：
 * **磨制黑石**（墙与地面）、**黑石砖**（主墙体）、**鎏金黑石**（点缀，拆了掉金粒）。
 *
 * ⚠️ 本项目的黑石本身（`Block.BLACKSTONE`，id 227）**早就在**（恶地/石料家族那批），
 * 连它的台阶/楼梯/墙都有——缺的只是"更精细的三块"。所以这一批只加这三个，
 * 而不是再补一整套变体（原版还有磨制黑石砖、錾制/裂纹磨制黑石、以及它们的三件套，
 * 那些属于"装饰性补齐"，记在 TASKS B50）。
 */
// ⚠️ 起点是 **529**：告示牌占了 523~528（6 种木材），接着往下排才是对的。
// 挑 id 时踩过"靠印象选一个空档"的坑（批次 48），所以这里写明了它接着谁
















/**
 * 粘液块（批次 120）：绿色半透明的一整块，**落在上面会被弹起来**（弹跳那一段在
 * `world/Slime.ts` + 主程序的落地判定里）。
 *
 * ⚠️ 与原版的差异：**活塞推它不会带走相邻方块**（原版那套"粘性方块"要活塞推动时
 * 连带检查六个面，本项目还没做——记在 TASKS J16）。所以它的说明里只写了"能弹跳"。
 */





/** 方块 id 常量，避免代码里出现魔法数字 */
export const Block = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS_BLOCK: 3,
  SAND: 4,
  OAK_LOG: 5,
  OAK_LEAVES: 6,
  OAK_PLANKS: 7,
  COBBLESTONE: 8,
  BEDROCK: 9,
  WATER: 10,
  GLASS: 11,
  DEEPSLATE: 12,
  GRANITE: 13,
  DIORITE: 14,
  ANDESITE: 15,
  TUFF: 16,
  CALCITE: 17,
  GRAVEL: 18,
  CLAY: 19,
  SANDSTONE: 20,
  SNOW_BLOCK: 21,
  ICE: 22,
  PACKED_ICE: 23,
  OBSIDIAN: 24,
  LAVA: 25,
  GLOWSTONE: 26,
  COAL_ORE: 27,
  IRON_ORE: 28,
  COPPER_ORE: 29,
  GOLD_ORE: 30,
  REDSTONE_ORE: 31,
  LAPIS_ORE: 32,
  DIAMOND_ORE: 33,
  EMERALD_ORE: 34,
  DEEPSLATE_COAL_ORE: 35,
  DEEPSLATE_IRON_ORE: 36,
  DEEPSLATE_COPPER_ORE: 37,
  DEEPSLATE_GOLD_ORE: 38,
  DEEPSLATE_REDSTONE_ORE: 39,
  DEEPSLATE_LAPIS_ORE: 40,
  DEEPSLATE_DIAMOND_ORE: 41,
  DEEPSLATE_EMERALD_ORE: 42,
  CRAFTING_TABLE: 43,
  FURNACE: 44,
  CHEST: 45,
  // 陷阱箱（批次 249）：id 585（现有最大 584 之后）
  TRAPPED_CHEST: 585,
  STONE_BRICKS: 62,
  CHISELED_STONE_BRICKS: 63,
  SMOOTH_STONE: 64,
  POLISHED_GRANITE: 65,
  POLISHED_DIORITE: 66,
  POLISHED_ANDESITE: 67,
  DEEPSLATE_BRICKS: 68,
  CHISELED_DEEPSLATE: 69,
  BRICKS: 70,
  POLISHED_DEEPSLATE: 71,
  OAK_FENCE: 96,
  COBBLESTONE_WALL: 97,
  STONE_BRICK_WALL: 98,
  /** 原色陶瓦（恶地地表用），id 与 TERRACOTTA_ID_START 同源 */
  TERRACOTTA: TERRACOTTA_ID_START,
  MOSSY_COBBLESTONE: 160,
  MOSSY_STONE_BRICKS: 161,
  CRACKED_STONE_BRICKS: 162,
  CRACKED_DEEPSLATE_BRICKS: 163,
  COBBLED_DEEPSLATE: 164,
  CHISELED_SANDSTONE: 165,
  CUT_SANDSTONE: 166,
  SMOOTH_SANDSTONE: 167,
  OAK_DOOR: 99,
  TORCH: 100,
  LADDER: 101,
  /** 大矿脉的伴生稀有方块 */
  RAW_COPPER_BLOCK: 201,
  RAW_IRON_BLOCK: 202,

  // ---- 自然装饰（地物）
  SHORT_GRASS: 203,
  FERN: 204,
  DANDELION: 205,
  POPPY: 206,
  BLUE_ORCHID: 207,
  OXEYE_DAISY: 208,
  CORNFLOWER: 209,
  RED_MUSHROOM: 210,
  BROWN_MUSHROOM: 211,
  SUGAR_CANE: 212,
  PUMPKIN: 213,
  MELON: 214,
  CACTUS: 215,
  DEAD_BUSH: 216,
  BAMBOO: 217,

  // ---- 海晶石家族
  PRISMARINE: 218,
  PRISMARINE_BRICKS: 219,
  DARK_PRISMARINE: 220,
  SEA_LANTERN: 221,

  // ---- 下界
  NETHERRACK: 222,
  SOUL_SAND: 223,
  SOUL_SOIL: 224,
  BASALT: 225,
  SMOOTH_BASALT: 226,
  BLACKSTONE: 227,
  MAGMA_BLOCK: 228,
  CRIMSON_NYLIUM: 229,
  WARPED_NYLIUM: 230,
  CRIMSON_STEM: 231,
  WARPED_STEM: 232,
  CRIMSON_PLANKS: 233,
  WARPED_PLANKS: 234,
  CRIMSON_FUNGUS: 235,
  WARPED_FUNGUS: 236,
  NETHER_WART_BLOCK: 237,
  WARPED_WART_BLOCK: 238,
  SHROOMLIGHT: 239,
  NETHER_BRICKS: 240,
  NETHER_QUARTZ_ORE: 241,
  ANCIENT_DEBRIS: 242,
  CRIMSON_ROOTS: 243,
  WARPED_ROOTS: 244,
  NETHER_SPROUTS: 245,

  // ---- 末地
  END_STONE: 246,
  END_STONE_BRICKS: 247,
  PURPUR_BLOCK: 248,
  PURPUR_PILLAR: 249,
  CHORUS_PLANT: 250,
  CHORUS_FLOWER: 251,
  END_ROD: 252,
  DRAGON_EGG: 253,
  END_PORTAL_FRAME: 254,
  END_PORTAL: 255,

  // ---- 红石
  REDSTONE_WIRE: 256,
  // 铁轨（批次 245）：id 578，在现有最大 id（577）之后追加
  RAIL: RAIL_ID,
  // 动力/探测铁轨（批次 246）：继续往后追加
  POWERED_RAIL: POWERED_RAIL_ID,
  DETECTOR_RAIL: DETECTOR_RAIL_ID,
  // 激活轨与测重压力板（批次 247）
  ACTIVATOR_RAIL: ACTIVATOR_RAIL_ID,
  LIGHT_WEIGHTED_PRESSURE_PLATE: LIGHT_WEIGHTED_PRESSURE_PLATE_ID,
  HEAVY_WEIGHTED_PRESSURE_PLATE: HEAVY_WEIGHTED_PRESSURE_PLATE_ID,
  // 标靶（批次 248）与霜冰（批次 263，冰霜行者踩出来的）
  TARGET: TARGET_ID,
  FROSTED_ICE: FROSTED_ICE_ID,
  REDSTONE_TORCH: 257,
  REDSTONE_BLOCK: 258,
  LEVER: 259,
  STONE_BUTTON: 260,
  OAK_BUTTON: 261,
  STONE_PRESSURE_PLATE: 262,
  OAK_PRESSURE_PLATE: 263,
  REPEATER: 264,
  COMPARATOR: 265,
  REDSTONE_LAMP: 266,
  PISTON: 267,
  PISTON_HEAD: 268,
  STICKY_PISTON: 269,
  OBSERVER: 270,
  ENCHANTING_TABLE: 271,
  BOOKSHELF: 272,
  ANVIL: 273,
  IRON_BLOCK: 274,
  FARMLAND: 275,
  WHEAT_STAGE0: 276,
  WHEAT_STAGE1: 277,
  WHEAT_STAGE2: 278,
  WHEAT_STAGE3: 279,
  CARROTS_STAGE0: 280,
  CARROTS_STAGE1: 281,
  CARROTS_STAGE2: 282,
  CARROTS_STAGE3: 283,
  POTATOES_STAGE0: 284,
  POTATOES_STAGE1: 285,
  POTATOES_STAGE2: 286,
  POTATOES_STAGE3: 287,
  BREWING_STAND: 288,
  /** 活板门与栅栏门（批次 30）：id 接在最大 id 之后，SPECS 会按 id 排序 */
  OAK_TRAPDOOR: 289,
  OAK_FENCE_GATE: 290,
  /** 火焰（I12）：没有物品，只能靠打火石点燃 */
  FIRE: 291,
  SOUL_FIRE: SOUL_FIRE_ID,
  CONDUIT: CONDUIT_ID,
  POWDER_SNOW: POWDER_SNOW_ID,
  /** 下界传送门（K8）：黑曜石框点燃后填满框内的那 2×3 格 */
  NETHER_PORTAL: 292,
  /** 下界合金（K8 尾巴）：储物方块与锻造台 */
  NETHERITE_BLOCK: 293,
  SMITHING_TABLE: 294,
  /** 锁链（B11）：3/16 粗的细柱，可攀爬；悬挂式告示牌以后会挂在它上面 */
  CHAIN: 333,
  /** 藤蔓（B11）：可攀爬、能蔓延，一个方块能同时挂 5 面 */
  VINE: 334,
  // ---- 铜的氧化（批次 40）：四档 × 四种形状，顺序即氧化顺序（见 COPPER_STAGES）
  COPPER_BLOCK: 335,
  CUT_COPPER: 336,
  CUT_COPPER_SLAB: 337,
  CUT_COPPER_STAIRS: 338,
  EXPOSED_COPPER_BLOCK: 339,
  EXPOSED_CUT_COPPER: 340,
  EXPOSED_CUT_COPPER_SLAB: 341,
  EXPOSED_CUT_COPPER_STAIRS: 342,
  WEATHERED_COPPER_BLOCK: 343,
  WEATHERED_CUT_COPPER: 344,
  WEATHERED_CUT_COPPER_SLAB: 345,
  WEATHERED_CUT_COPPER_STAIRS: 346,
  OXIDIZED_COPPER_BLOCK: 347,
  OXIDIZED_CUT_COPPER: 348,
  OXIDIZED_CUT_COPPER_SLAB: 349,
  OXIDIZED_CUT_COPPER_STAIRS: 350,
  // ---- 石英与更多石材的母方块（批次 42，见 `MORE_STONE_ID_START`）
  QUARTZ_BLOCK: 404,
  CHISELED_QUARTZ_BLOCK: 405,
  QUARTZ_PILLAR: 406,
  SMOOTH_QUARTZ: 407,
  DEEPSLATE_TILES: 408,
  RED_NETHER_BRICKS: 409,
  /** 睡莲（B16）：水面上的平铺叶片，id 接在最大 id 之后 */
  LILY_PAD: 295,
  /** 雪层（B11）：层数在状态里（1~8 层），id 单独一个 */
  SNOW: SNOW_LAYER_ID,
  /** 切石机（H11）：整块方块，没有状态；右键打开"一进多选"的界面 */
  STONECUTTER: STONECUTTER_ID,
  // ---- 红沙与红砂岩（批次 45，见 `RED_SAND_ID_START`）
  RED_SAND: 411,
  RED_SANDSTONE: 412,
  CHISELED_RED_SANDSTONE: 413,
  CUT_RED_SANDSTONE: 414,
  SMOOTH_RED_SANDSTONE: 415,
  // ---- 熔炉的两个变体（批次 46，见 `SMOKER_ID` / `BLAST_FURNACE_ID`）
  SMOKER: SMOKER_ID,
  BLAST_FURNACE: BLAST_FURNACE_ID,
  /** 营火（批次 47）：不要燃料、一次烤 4 个、只烤食物、烤好直接弹出来 */
  CAMPFIRE: CAMPFIRE_ID,
  // ---- 甜菜（批次 48，B17 的第四种作物）
  BEETROOTS_STAGE0: 425,
  BEETROOTS_STAGE1: 426,
  BEETROOTS_STAGE2: 427,
  BEETROOTS_STAGE3: 428,
  // ---- 甜浆果丛与可可豆（批次 49）
  SWEET_BERRY_BUSH_STAGE0: SWEET_BERRY_BUSH_ID_START,
  SWEET_BERRY_BUSH_STAGE1: 430,
  SWEET_BERRY_BUSH_STAGE2: 431,
  SWEET_BERRY_BUSH_STAGE3: 432,
  COCOA_STAGE0: COCOA_ID_START,
  COCOA_STAGE1: 434,
  COCOA_STAGE2: 435,
  // ---- 海带与海草（批次 50，见 `KELP_SPECS`）：方块本身**替换掉那一格水**
  KELP: KELP_ID,
  SEAGRASS: SEAGRASS_ID,
  DRIED_KELP_BLOCK: DRIED_KELP_BLOCK_ID,
  // ---- 珊瑚（批次 51，见 `CORAL_SPECS`）：每个常量是那一族的**第一个**（管珊瑚），
  // 其余四种用 `+ i` 取（i = 0..4，顺序见 `CORAL_KINDS`）
  CORAL_BLOCK: CORAL_BLOCK_ID_START,
  DEAD_CORAL_BLOCK: DEAD_CORAL_BLOCK_ID_START,
  CORAL: CORAL_ID_START,
  DEAD_CORAL: DEAD_CORAL_ID_START,
  CORAL_FAN: CORAL_FAN_ID_START,
  DEAD_CORAL_FAN: DEAD_CORAL_FAN_ID_START,
  // ---- 蛋糕与花盆（批次 52，见 `CAKE_AND_POT_SPECS`）
  CAKE: CAKE_ID,
  FLOWER_POT: FLOWER_POT_ID,
  // ---- 脚手架（批次 53，见 `SCAFFOLDING_SPECS`）
  SCAFFOLDING: SCAFFOLDING_ID,
  // ---- 阳光传感器（批次 54，见 `DAYLIGHT_DETECTOR_SPECS`）
  DAYLIGHT_DETECTOR: DAYLIGHT_DETECTOR_ID,
  // ---- 绊线与绊线钩（批次 55，见 `TRIPWIRE_SPECS`）
  TRIPWIRE: TRIPWIRE_ID,
  TRIPWIRE_HOOK: TRIPWIRE_HOOK_ID,
  // ---- TNT（批次 56，见 `TNT_SPECS`）
  TNT: TNT_ID,
  // ---- 漏斗（批次 58，见 `HOPPER_SPECS`）：会自己搬东西的容器方块
  HOPPER: HOPPER_ID,
  // ---- 投掷器（批次 59，见 `DROPPER_SPECS`）：通电就朝朝向吐一件
  DROPPER: DROPPER_ID,
  // ---- 发射器（批次 60，见 `DISPENSER_SPECS`）：通电就朝朝向"用"一件
  DISPENSER: DISPENSER_ID,
  // ---- 木桶（批次 61，见 `BARREL_SPECS`）：27 格容器，上面压着方块就打不开
  BARREL: BARREL_ID,
  // ---- 堆肥桶（批次 70，见 `COMPOSTER_SPECS`）：等级存在状态位里，满了收骨粉
  COMPOSTER: COMPOSTER_ID,
  // ---- 音符盒（批次 173，见 `NOTE_BLOCK_SPECS`）：音高存在状态位里，右击响一声
  NOTE_BLOCK: NOTE_BLOCK_ID,
  // ---- 炼药锅（批次 176，见 `CAULDRON_SPECS`）：水位 0~3 存在状态位里
  CAULDRON: CAULDRON_ID,
  // ---- 末影箱（批次 71，见 `ENDER_CHEST_SPECS`）：27 格，内容跟着玩家走
  ENDER_CHEST: ENDER_CHEST_ID,
  // ---- 潜影盒（批次 72，见 `SHULKER_BOX_SPECS`）：27 格，内容跟着**物品**走
  SHULKER_BOX: SHULKER_BOX_ID,
  // ---- 海绵 / 湿海绵（批次 449）：只有干海绵会吸水，见 `world/Sponge.ts`
  SPONGE: SPONGE_ID,
  WET_SPONGE: WET_SPONGE_ID,
  // ---- 蜂蜜块（批次 450）：粘住实体（跳跃取消 / 贴面下滑限速 / 摔落减伤）
  HONEY_BLOCK: HONEY_BLOCK_ID,
  // ---- 磁石（批次 453）：手持指南针右键它，指南针就改指这里
  LODESTONE: LODESTONE_ID,
  // ---- 重生锚（批次 454）：充能 0~4 存在状态位里，右键设重生点
  RESPAWN_ANCHOR: RESPAWN_ANCHOR_ID,
  // ---- 命令方块（批次 477）：红石上升沿执行一格命令
  COMMAND_BLOCK: COMMAND_BLOCK_ID,
  // ---- 唱片机（批次 489）：右键放唱片、自己播旋律
  JUKEBOX: JUKEBOX_ID,
  // ---- 钟（批次 490）：右键敲响
  BELL: BELL_ID,
  // ---- 盔甲架（批次 492）：右键穿脱装备
  ARMOR_STAND: ARMOR_STAND_ID,
  // ---- 洞穴藤蔓（批次 496）：从洞顶垂下，有浆果的那节会掉发光浆果
  CAVE_VINES: CAVE_VINES_ID,
  // ---- 16 色旗帜（批次 484）：占两格、无碰撞
  WHITE_BANNER: BANNER_ID_START + 0,
  ORANGE_BANNER: BANNER_ID_START + 1,
  MAGENTA_BANNER: BANNER_ID_START + 2,
  LIGHT_BLUE_BANNER: BANNER_ID_START + 3,
  YELLOW_BANNER: BANNER_ID_START + 4,
  LIME_BANNER: BANNER_ID_START + 5,
  PINK_BANNER: BANNER_ID_START + 6,
  GRAY_BANNER: BANNER_ID_START + 7,
  LIGHT_GRAY_BANNER: BANNER_ID_START + 8,
  CYAN_BANNER: BANNER_ID_START + 9,
  PURPLE_BANNER: BANNER_ID_START + 10,
  BLUE_BANNER: BANNER_ID_START + 11,
  BROWN_BANNER: BANNER_ID_START + 12,
  GREEN_BANNER: BANNER_ID_START + 13,
  RED_BANNER: BANNER_ID_START + 14,
  BLACK_BANNER: BANNER_ID_START + 15,
  // ---- 16 色旗帜（批次 484）：占两格、无碰撞，纯装饰
  // ---- 瓜藤（批次 77，见 `STEM_SPECS`）：8 阶段 + 结果的茎
  PUMPKIN_STEM_STAGE0: PUMPKIN_STEM_ID_START,
  MELON_STEM_STAGE0: MELON_STEM_ID_START,
  PUMPKIN_STEM_ATTACHED: PUMPKIN_STEM_ATTACHED_ID,
  MELON_STEM_ATTACHED: MELON_STEM_ATTACHED_ID,
  // ---- 树苗（批次 75，见 `SAPLING_SPECS`）：一格就能长成一棵树
  // ---- 床（B13，批次 79，见 `BED_SPECS`）：每个常量是**白色床**那一个，
  // 其余 15 色用 `+ i` 取（i 与 `DYE_COLORS` 同序），或用 `bedId(i)`
  BED: BED_ID_START,
  /** 告示牌（B12，批次 80）：6 种木材依次排列，橡木是第一个（见 `SIGN_IDS`） */
  OAK_SIGN: SIGN_ID_START,
  // ---- 黑石家族（K8 收尾，批次 82）：堡垒遗迹的建材
  POLISHED_BLACKSTONE: POLISHED_BLACKSTONE_ID,
  POLISHED_BLACKSTONE_BRICKS: POLISHED_BLACKSTONE_BRICKS_ID,
  GILDED_BLACKSTONE: GILDED_BLACKSTONE_ID,
  LIGHTNING_ROD: LIGHTNING_ROD_ID,
  CHISELED_POLISHED_BLACKSTONE: CHISELED_POLISHED_BLACKSTONE_ID,
  // ---- 墙上挂东西（B14，批次 86）：展示框 + 画（只做 1×1 的 7 幅）
  ITEM_FRAME: ITEM_FRAME_ID,
  PAINTING: PAINTING_ID,
  // ---- 村民的工作站（J23，批次 90）：给另外四种职业开门
  LECTERN: LECTERN_ID,
  FLETCHING_TABLE: FLETCHING_TABLE_ID,
  GRINDSTONE: GRINDSTONE_ID,
  LOOM: LOOM_ID,
  // ---- 制图台（批次 505）：复制 / 放大 / 锁定地图
  CARTOGRAPHY_TABLE: CARTOGRAPHY_TABLE_ID,
  // ---- 下界疣（批次 92）：长在灵魂沙上的作物，酿造链的第一件原料
  NETHER_WART_STAGE0: NETHER_WART_ID_START,
  NETHER_WART_STAGE1: NETHER_WART_ID_START + 1,
  NETHER_WART_STAGE2: NETHER_WART_ID_START + 2,
  NETHER_WART_STAGE3: NETHER_WART_ID_START + 3,
  // 刷怪笼（批次 92）：下界要塞里出烈焰人的那一格
  SPAWNER: SPAWNER_ID,
  // 凋灵骷髅头（批次 115）：战利品 + 召唤材料，形状是 `head`
  WITHER_SKELETON_SKULL: WITHER_SKELETON_SKULL_ID,
  // 矿物块与信标（批次 117，K5）
  GOLD_BLOCK: GOLD_BLOCK_ID,
  DIAMOND_BLOCK: DIAMOND_BLOCK_ID,
  EMERALD_BLOCK: EMERALD_BLOCK_ID,
  BEACON: BEACON_ID,
  // 粘液块（批次 120）：史莱姆掉的那条链的终点
  SLIME_BLOCK: SLIME_BLOCK_ID,
  SOUL_TORCH: SOUL_TORCH_ID,
  SOUL_LANTERN: SOUL_LANTERN_ID,
  CRACKED_POLISHED_BLACKSTONE_BRICKS: CRACKED_POLISHED_BLACKSTONE_BRICKS_ID,
  OAK_SAPLING: WOOD_SAPLING_ID_START,
  BIRCH_SAPLING: WOOD_SAPLING_ID_START + 1,
  SPRUCE_SAPLING: WOOD_SAPLING_ID_START + 2,
  JUNGLE_SAPLING: WOOD_SAPLING_ID_START + 3,
  ACACIA_SAPLING: WOOD_SAPLING_ID_START + 4,
  DARK_OAK_SAPLING: WOOD_SAPLING_ID_START + 5,
  /** 骨块（批次 349）：化石的建材，也是 9 骨粉的压缩块 */
  BONE_BLOCK: 587,
  /** 蜡烛（批次 382） */
  CANDLE: 607,
  /** 16 色带釉陶瓦从 624 起 */
  GLAZED_TERRACOTTA_ID_START: 624,
  /** 16 色旗帜从 640 起 */
  BANNER_ID_START: 640,
  TINTED_GLASS: 656,
  CRYING_OBSIDIAN: 657,
  GLOW_LICHEN: 658,
  GLOW_BERRIES: 659,
  POINTED_DRIPSTONE: 660,
  DRIPSTONE_BLOCK: 661,
  SPORE_BLOSSOM: 662,
  HANGING_ROOTS: 663,
  ROOTED_DIRT: 664,
  SMALL_DRIPLEAF: 665,
  BIG_DRIPLEAF: 666,
  /** 16 色蜡烛从 608 起，顺序与 DYE_COLORS 一致 */
  CANDLE_ID_START: 608,
  /** 紫水晶族（批次 351）：紫晶洞的三层壳 + 晶簇 */
  AMETHYST_BLOCK: 588,
  BUDDING_AMETHYST: 589,
  AMETHYST_CLUSTER: 590,
  /** 蘑菇岛族（批次 352） */
  MYCELIUM: 591,
  MUSHROOM_STEM: 592,
  BROWN_MUSHROOM_BLOCK: 593,
  RED_MUSHROOM_BLOCK: 594,
  /** 分物种刷怪笼（批次 365） */
  ZOMBIE_SPAWNER: 595,
  CAVE_SPIDER_SPAWNER: 596,
  SILVERFISH_SPAWNER: 597,
  MOSS_BLOCK: 598,
  MOSS_CARPET: 599,
  AZALEA: 600,
  FLOWERING_AZALEA: 601,
  BEE_NEST: 602,
  /** 干草块（批次 437）：9 小麦压成一块，可反过来拆回 9 小麦 */
  HAY_BLOCK: 667,
  /**
   * 六面树皮的"木头"（批次 438）：与同种原木共用**侧面**贴图，四个面都是树皮。
   *
   * 原版这六个方块的意义是"建筑时不想露出年轮"——只用原木的话，柱子顶端那一面
   * 一定是年轮。所以它既不新画贴图，也不新增形状，纯粹是"把侧面贴图铺满六面"。
   */
  OAK_WOOD: 668,
  SPRUCE_WOOD: 669,
  BIRCH_WOOD: 670,
  JUNGLE_WOOD: 671,
  ACACIA_WOOD: 672,
  DARK_OAK_WOOD: 673,
  /** 磨制玄武岩（批次 439）：4 块玄武岩 2×2 → 4 块 */
  POLISHED_BASALT: 674,
  /** 蓝冰（批次 439）：9 块浮冰 3×3 → 1 块（原版比例） */
  BLUE_ICE: 675,
  /** 蜜脾块（批次 440）：4 个蜜脾 2×2 → 1 块，纯装饰 */
  HONEYCOMB_BLOCK: 676,
  /**
   * 蛛网（批次 441）：**能穿过去但会把人粘住**（不是实心方块）。
   * 所以它是 `solid: false` —— 碰撞上当作空气，减速靠 `isCobwebBlock` 逐帧问。
   */
  COBWEB: 677,
  /** 六种剥皮原木（批次 443）：斧头右键原木得到（原版行为，不是合成） */
  STRIPPED_OAK_LOG: 678,
  STRIPPED_SPRUCE_LOG: 679,
  STRIPPED_BIRCH_LOG: 680,
  STRIPPED_JUNGLE_LOG: 681,
  STRIPPED_ACACIA_LOG: 682,
  STRIPPED_DARK_OAK_LOG: 683,
  /**
   * 其余五种木材的按钮 / 压力板（批次 444）：橡木的那两个早就有，
   * 但 `RedstoneEngine` 里是按 id 逐个 `case` 的，所以加方块必须先把判定收敛成集合
   * （见该文件顶部的 `isButtonId` / `isPlateId`）——否则会出现"三种木材能用、两种按不动"。
   */
  SPRUCE_BUTTON: 684,
  BIRCH_BUTTON: 685,
  JUNGLE_BUTTON: 686,
  ACACIA_BUTTON: 687,
  DARK_OAK_BUTTON: 688,
  SPRUCE_PRESSURE_PLATE: 689,
  BIRCH_PRESSURE_PLATE: 690,
  JUNGLE_PRESSURE_PLATE: 691,
  ACACIA_PRESSURE_PLATE: 692,
  DARK_OAK_PRESSURE_PLATE: 693,
  WAXED_COPPER_BLOCK: 603,
  WAXED_EXPOSED_COPPER: 604,
  WAXED_WEATHERED_COPPER: 605,
  WAXED_OXIDIZED_COPPER: 606,
} as const;

/** 花盆里能种的一株植物：物品（种进去时手里拿的）+ 贴图（渲染用）+ 中文名 */
export interface PottedPlant {
  readonly itemId: number;
  readonly tile: string;
  readonly name: string;
}

/**
 * 花盆能种的植物表（**顺序就是状态里的索引**，只能往后追加、不能插队）。
 *
 * ⚠️ 索引会写进存档与联机消息里：中间插一项会让老存档里"种着第 3 种"的花盆
 * 突然变成另一种植物（玩家只会觉得"我的花被换了"）。所以新植物一律**追加到表尾**。
 *
 * 这一批与原版花盆能放的那批对齐：两种草、五朵花、两种蘑菇、枯木、仙人掌、竹子、
 * 甜浆果丛，以及**五色珊瑚扇**（原版 1.13 起花盆也能放珊瑚扇——正好给水族箱用）。
 * 树苗不在内（我们还没有树苗物品，见 TASKS B17）。
 */
export const POTTED_PLANTS: readonly PottedPlant[] = [
  { itemId: Block.SHORT_GRASS, tile: 'short_grass', name: '矮草' },
  { itemId: Block.FERN, tile: 'fern', name: '蕨' },
  { itemId: Block.DANDELION, tile: 'dandelion', name: '蒲公英' },
  { itemId: Block.POPPY, tile: 'poppy', name: '虞美人' },
  { itemId: Block.BLUE_ORCHID, tile: 'blue_orchid', name: '兰花' },
  { itemId: Block.OXEYE_DAISY, tile: 'oxeye_daisy', name: '雏菊' },
  { itemId: Block.CORNFLOWER, tile: 'cornflower', name: '矢车菊' },
  { itemId: Block.RED_MUSHROOM, tile: 'red_mushroom', name: '红蘑菇' },
  { itemId: Block.BROWN_MUSHROOM, tile: 'brown_mushroom', name: '棕蘑菇' },
  { itemId: Block.DEAD_BUSH, tile: 'dead_bush', name: '枯木' },
  { itemId: Block.CACTUS, tile: 'cactus_side', name: '仙人掌' },
  { itemId: Block.BAMBOO, tile: 'bamboo', name: '竹子' },
  // 甜浆果丛的代表阶段（成熟那一个）：4 个 id 里挑一个最像"一丛"的
  { itemId: Block.SWEET_BERRY_BUSH_STAGE3, tile: 'sweet_berry_bush_stage3', name: '甜浆果丛' },
  ...CORAL_KINDS.map((kind, i) => ({
    itemId: CORAL_FAN_ID_START + i,
    tile: `${kind}_coral_fan`,
    name: `${CORAL_KIND_CN[kind]}珊瑚扇`,
  })),
];

/**
 * 花盆里的植物该用哪张贴图（0 = 空盆 → null）。
 * 渲染层（`ChunkMesher`）只认这一张表，不自己列第二份植物名单。
 */
export function pottedPlantTile(plant: number): string | null {
  return POTTED_PLANTS[plant - 1]?.tile ?? null;
}

/** 这个物品能不能种进花盆（返回要写进状态的索引；不能种返回 0） */
export function flowerPotIndexFor(itemId: number): number {
  const index = POTTED_PLANTS.findIndex((entry) => entry.itemId === itemId);
  return index < 0 ? 0 : index + 1;
}

/** 空手取出一株植物时该给回什么物品 */
export function pottedPlantItem(plant: number): number | undefined {
  return POTTED_PLANTS[plant - 1]?.itemId;
}

/** 花盆里的植物叫什么（提示框与聊天用） */
export function pottedPlantName(plant: number): string {
  return POTTED_PLANTS[plant - 1]?.name ?? '空盆';
}

/** 第 index 种颜色的羊毛方块 id（顺序与 DYE_COLORS 一致） */
export function woolId(colorIndex: number): number {
  return WOOL_ID_START + colorIndex;
}

/** 第 index 种颜色的地毯方块 id（顺序与 DYE_COLORS 一致） */
export function carpetId(colorIndex: number): number {
  return CARPET_ID_START + colorIndex;
}

/** 按 id 索引的方块定义表 */
/**
 * 构造按 id 索引的方块表。
 *
 * 这里强制校验 id 从 0 开始连续——BLOCKS 是数组下标索引，一旦有空缺或错位，
 * blockDef(id) 就会静默地返回错误的方块。宁可启动时报错也不要让这种问题潜伏下去。
 *
 * ⚠️ 对外只给**构建工具与测试**用（`tools/gen-hostcore.ts` 用它生成二进制、
 * `tools/hostcore-test.ts` 用它做往返比对）。运行时要方块表请用 `BLOCKS`/`blockDef()`：
 * 线上那条路是从二进制解码来的（见 `blockTableCodec.ts`），两者必须逐字段一致，
 * 一致性由 `npm run test:hostcore` 兜住。
 */
export function buildBlockTable(): readonly BlockDef[] {
  const table: BlockDef[] = [];
  for (const spec of SPECS) {
    if (spec.id !== table.length) {
      throw new Error(
        `方块 id 必须从 0 开始连续：第 ${table.length} 项期望 id=${table.length}，实际 id=${spec.id}（${spec.name}）`,
      );
    }
    table.push({
      id: spec.id,
      name: spec.name,
      tiles: spec.tiles ?? ['stone', 'stone', 'stone'],
      solid: spec.solid ?? true,
      opaque: spec.opaque ?? true,
      // 默认与 `opaque` 一致；只有树叶这类"挡光但不该闷死人"的方块会单独关掉
      suffocates: spec.suffocates ?? (spec.opaque ?? true),
      light: spec.light ?? 0,
      // 默认：不透光方块完全阻挡光照，透明方块不衰减
      lightOpacity: spec.lightOpacity ?? ((spec.opaque ?? true) ? 15 : 0),
      liquid: spec.liquid ?? false,
      translucent: spec.translucent ?? false,
      shape: spec.shape ?? 'cube',
      facesPlayer: spec.facesPlayer ?? false,
      facesSneak: spec.facesSneak ?? false,
      facesNormal: spec.facesNormal ?? false,
      itemless: spec.itemless ?? false,
      waterPlant: spec.waterPlant ?? false,
    });
  }
  return applyBehaviors(table);
}

/**
 * 把行为表按**方块名**合到数据上（宿主3）。
 *
 * 为什么是"按名字查一次"而不是在 SPECS 里留个标记：二进制里承载的是数据，
 * 数据不知道自己"有没有行为"——但名字一定在，所以装表时对每个方块查一次表就够了
 * （724 次 Map 查询，微秒级）。这样二进制格式不需要为行为加任何字段，
 * 也就不会有"标记与行为表不一致"这种状态。
 *
 * 纯函数：不改入参，返回新数组（解码出来的那份表要原样保留，方便排查）。
 */
export function applyBehaviors(defs: readonly BlockDef[]): readonly BlockDef[] {
  return defs.map((def) => {
    const behavior = BLOCK_BEHAVIORS.get(def.name);
    return behavior === undefined ? def : { ...def, ...behavior };
  });
}

/**
 * 按 id 索引的方块定义表。
 *
 * ⚠️ 是 `let` 而不是 `const`：**表是可以被换掉的**。线上那条路（宿主化）走的是
 * "从 `/__host/core.bin` 解出数据 → `installBlockTable()` 装上"，而 `blocks.ts`
 * 里的 `SPECS` 只留给构建工具与测试用。为了让两条路共用同一份代码，表就只能是可替换的。
 *
 * ⚠️ 因此**任何读取都必须发生在装表之后**。目前的顺序是：`boot.ts` 先装表，
 * 再动态 `import('./main.ts')`，所以 `main.ts` 及其依赖图里的模块级代码一定看得见表
 * （已核对：全仓 0 处模块顶层读 `BLOCKS[...]`；新增模块请保持这个约定）。
 */
export let BLOCKS: readonly BlockDef[] = buildBlockTable();

/**
 * 表是否被"装"过。
 *
 * ⚠️ 用**布尔标记**而不是"BLOCKS 是不是当初那个数组"：后者会被
 * "装进来一份内容相同的新数组"骗过（测试里还原表时就撞上了）。
 */
let tableInstalled = false;

/**
 * 装表（覆盖当前表）。
 *
 * 校验比"信任调用方"重要：这张表决定世界里每一个方块的行为，装错一个 id 就是
 * 静默的错方块——校验很便宜（724 次下标比对），漏检的代价很贵。
 *
 * 允许重复调用（测试里需要还原、将来热重载也要用），不做"只能装一次"的限制。
 */
export function installBlockTable(table: readonly BlockDef[]): void {
  if (table.length === 0) {
    throw new Error('方块表不能是空的：装表失败时应当保持旧表，而不是把世界变成一片空气');
  }
  for (let id = 0; id < table.length; id++) {
    const block = table[id]!;
    if (block.id !== id) {
      throw new Error(`方块表 id 必须从 0 连续：第 ${id} 项 id=${block.id}（${block.name}）`);
    }
    if (block.name.length === 0) {
      throw new Error(`方块表第 ${id} 项没有名字`);
    }
  }
  BLOCKS = applyBehaviors(table);
  tableInstalled = true;
}

/** 表是否被装过（诊断用：区分"SPECS 建的表"与"二进制解出来的表"） */
export function isInstalledBlockTable(): boolean {
  return tableInstalled;
}

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[0]!;
}

/**
 * 这个 id 在当前注册表里存在吗（批次 20261025-0117，合规 5）。
 *
 * `blockDef` 对不认识的 id 会**回退成空气**——渲染与碰撞都需要一个答案，这是对的；
 * 但读档时不能拿这个回退去写世界（那等于把玩家那一片房子挖空），所以读档路径要先问这一句。
 */
export function isKnownBlockId(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < BLOCKS.length;
}

export function isOpaque(id: number): boolean {
  return blockDef(id).opaque;
}

export function isSolid(id: number): boolean {
  return blockDef(id).solid;
}

/** 光照衰减：≥15 表示完全阻挡，0 表示完全透过 */
export function lightOpacity(id: number): number {
  return blockDef(id).lightOpacity;
}

export function emitLight(id: number): number {
  return blockDef(id).light;
}

/**
 * 按状态取贴图。绝大多数方块与状态无关；红石灯这类需要按状态换贴图的走 stateTiles。
 * 网格化器统一走这个入口，于是"新增一个会变色的方块"不需要改网格化器。
 */
export function blockTiles(id: number, state: number): readonly [string, string, string] {
  const def = BLOCKS[id] ?? BLOCKS[0]!;
  return def.stateTiles ? def.stateTiles(state) : def.tiles;
}

/**
 * 某一面到底用哪张贴图（批次 76，O11）：**唯一一处判定**。
 *
 * 顺序是"先问面级贴图、再回退到按状态取的通用贴图"——
 *  - 熔炉家族（面级贴图）：**朝向那一面**是正脸，其余面回退；
 *  - 红石灯这类：`stateTiles` 按状态换整套贴图（与面无关）。
 *
 * ⚠️ 抽出来的原因：这条规则同时被**贪心通道**与**逐盒通道**用到，
 * 两处各写一遍的话，"面级贴图"这个能力以后加新用法时必然只改一处
 * （批次 64 已经栽过一次：只改了贪心通道，熔炉一个面都不输出、整块看不见了）。
 */
export function faceTileOn(
  id: number,
  state: number,
  faceDir: readonly [number, number, number],
  faceIndex: number,
): string {
  const def = BLOCKS[id] ?? BLOCKS[0]!;
  return def.faceTile?.(state, faceDir) ?? blockTiles(id, state)[faceIndex] ?? def.tiles[0]!;
}

/** 按状态取发光等级（红石灯亮时为 15） */
export function emitLightWithState(id: number, state: number): number {
  const def = BLOCKS[id] ?? BLOCKS[0]!;
  return def.stateLight ? def.stateLight(state) : def.light;
}

// ---------------------------------------------------------------- 挖掘属性

/** 方块硬度（原版量纲）；-1 表示不可破坏 */
const HARDNESS = new Map<number, number>([
  [Block.AIR, 0],
  [Block.BEDROCK, -1],
  [Block.WATER, -1],
  [Block.LAVA, -1],

  [Block.STONE, 1.5],
  [Block.COBBLESTONE, 2],
  [Block.DEEPSLATE, 3],
  [Block.GRANITE, 1.5],
  [Block.DIORITE, 1.5],
  [Block.ANDESITE, 1.5],
  [Block.TUFF, 1.5],
  [Block.CALCITE, 0.75],
  [Block.OBSIDIAN, 50],

  [Block.DIRT, 0.5],
  [Block.GRASS_BLOCK, 0.6],
  [Block.SAND, 0.5],
  // 红沙与沙子同档 0.5（原版如此；挖起来与沙子一模一样）
  [Block.RED_SAND, 0.5],
  [Block.GRAVEL, 0.6],
  [Block.CLAY, 0.6],
  [Block.SANDSTONE, 0.8],
  [Block.SNOW_BLOCK, 0.2],

  [Block.OAK_LOG, 2],
  [Block.OAK_PLANKS, 2],
  [Block.OAK_LEAVES, 0.2],

  [Block.GLASS, 0.3],
  [Block.ICE, 0.5],
  [Block.PACKED_ICE, 0.5],
  [Block.GLOWSTONE, 0.3],

  [Block.CRAFTING_TABLE, 2.5],
  [Block.FURNACE, 3.5],
  // 烟熏炉 3.5、高炉 3.5（原版三者同档，都要镐）
  [Block.SMOKER, 3.5],
  [Block.BLAST_FURNACE, 3.5],
  // 营火 2（原版）：斧最快，徒手也能采
  [Block.CAMPFIRE, 2],
  [Block.CHEST, 2.5],
  [Block.TRAPPED_CHEST, 2.5],

  [Block.STONE_BRICKS, 1.5],
  [Block.CHISELED_STONE_BRICKS, 1.5],
  [Block.SMOOTH_STONE, 2],
  [Block.POLISHED_GRANITE, 1.5],
  [Block.POLISHED_DIORITE, 1.5],
  [Block.POLISHED_ANDESITE, 1.5],
  [Block.DEEPSLATE_BRICKS, 3.5],
  [Block.CHISELED_DEEPSLATE, 3.5],
  [Block.BRICKS, 2],
  [Block.POLISHED_DEEPSLATE, 3.5],
]);

// 羊毛：16 种颜色硬度相同
for (let i = 0; i < DYE_COLORS.length; i++) HARDNESS.set(woolId(i), 0.8);

// 地毯：比羊毛薄得多，原版硬度 0.1（一拍就掉）；雪层同样是 0.1
for (let i = 0; i < DYE_COLORS.length; i++) HARDNESS.set(carpetId(i), 0.1);
HARDNESS.set(Block.SNOW, 0.1);
// 铁轨（批次 245/246）：原版 0.7（镐/徒手都挖得动，但比压力板结实）
HARDNESS.set(Block.RAIL, 0.7);
HARDNESS.set(Block.POWERED_RAIL, 0.7);
HARDNESS.set(Block.DETECTOR_RAIL, 0.7);
HARDNESS.set(Block.ACTIVATOR_RAIL, 0.7);
// 测重压力板：原版 0.5（徒手可挖）
HARDNESS.set(Block.LIGHT_WEIGHTED_PRESSURE_PLATE, 0.5);
HARDNESS.set(Block.HEAVY_WEIGHTED_PRESSURE_PLATE, 0.5);
// 标靶（批次 248）：原版 1.5（木头 + 红石）
HARDNESS.set(Block.TARGET, 1.5);
// 霜冰（批次 263）：原版 0.5，且挖掉不掉东西（没有物品形态）
HARDNESS.set(Block.FROSTED_ICE, 0.5);

// 台阶 / 楼梯的硬度跟随母方块（原版行为）
for (let index = 0; index < SHAPED_PARENTS.length; index++) {
  const parentId = SHAPED_PARENTS[index]![0];
  const hardness = HARDNESS.get(parentId) ?? 1.5;
  HARDNESS.set(slabId(index), hardness);
  HARDNESS.set(stairsId(index), hardness);
}

// 石材家族的变体（批次 41）：硬度同样**跟随母方块**——但这一条必须写在
// **全部母方块硬度登记完之后**（见文件末尾那一处，写在前面会拿到"还没登记 → 回退 1.5"）

HARDNESS.set(Block.OAK_FENCE, 2);
HARDNESS.set(Block.COBBLESTONE_WALL, 2);
HARDNESS.set(Block.STONE_BRICK_WALL, 1.5);
HARDNESS.set(Block.OAK_DOOR, 3);
// 活板门 3（与门同档）、栅栏门 2（与栅栏同档）——都是木头，原版如此
HARDNESS.set(Block.OAK_TRAPDOOR, 3);
HARDNESS.set(Block.OAK_FENCE_GATE, 2);

// 木制方块族（批次 38）：其余 5 种木材的栅栏/栅栏门/门/活板门与橡木同档
// （栅栏门与栅栏 2、活板门与门 3）——按族批量登记，不逐个手抄
for (const ids of Object.values(WoodShaped)) {
  HARDNESS.set(ids.fence, 2);
  HARDNESS.set(ids.fenceGate, 2);
  HARDNESS.set(ids.door, 3);
  HARDNESS.set(ids.trapdoor, 3);
}
// 告示牌（批次 80）：原版 1（木头档里最软的一批，徒手一拍就掉）
for (const id of SIGN_IDS) HARDNESS.set(id, 1);
// 展示框与画（B14，批次 86）：原版**一拍就掉**（两者都不是"挖"下来的，
// 打一下整件掉出来），所以硬度 0 与火把/绊线同一档
HARDNESS.set(Block.ITEM_FRAME, 0);
HARDNESS.set(Block.PAINTING, 0);
HARDNESS.set(Block.TORCH, 0);
HARDNESS.set(Block.LADDER, 0.4);
// 锁链 5（原版，必须用镐）；藤蔓 0.2（原版，徒手一拍就掉，但只有剪刀/精准采集会掉下来）
HARDNESS.set(Block.CHAIN, 5);
HARDNESS.set(Block.VINE, 0.2);
// 甜浆果丛与可可豆（批次 49）：原版都是"一碰就掉"（甜浆果丛 0、可可果 0.2）
HARDNESS.set(Block.SWEET_BERRY_BUSH_STAGE0, 0);
HARDNESS.set(Block.SWEET_BERRY_BUSH_STAGE1, 0);
HARDNESS.set(Block.SWEET_BERRY_BUSH_STAGE2, 0);
HARDNESS.set(Block.SWEET_BERRY_BUSH_STAGE3, 0);
HARDNESS.set(Block.COCOA_STAGE0, 0.2);
HARDNESS.set(Block.COCOA_STAGE1, 0.2);
HARDNESS.set(Block.COCOA_STAGE2, 0.2);
// 下界疣、刷怪笼（批次 92）
HARDNESS.set(Block.SPAWNER, 5);
// 凋灵骷髅头（批次 115）：原版硬度 1（徒手一秒多就能挖下来）
HARDNESS.set(Block.WITHER_SKELETON_SKULL, 1);
// 矿物块与信标（批次 117，K5）：硬度按原版（金块 3 / 钻石块与绿宝石块 5 / 信标 3）
HARDNESS.set(Block.GOLD_BLOCK, 3);
HARDNESS.set(Block.DIAMOND_BLOCK, 5);
HARDNESS.set(Block.EMERALD_BLOCK, 5);
HARDNESS.set(Block.BEACON, 3);
HARDNESS.set(Block.CONDUIT, 3);
// 细雪原版 0.25 秒（铲子更快，但不是必需工具）
HARDNESS.set(Block.POWDER_SNOW, 0.25);
// 粘液块（批次 120）：原版硬度 **0**（徒手一拍就碎，只是碎得"黏"）
HARDNESS.set(Block.SLIME_BLOCK, 0);
HARDNESS.set(Block.BONE_BLOCK, 2);
HARDNESS.set(Block.AMETHYST_BLOCK, 1.5);
HARDNESS.set(Block.BUDDING_AMETHYST, 1.5);
HARDNESS.set(Block.AMETHYST_CLUSTER, 1.5);
HARDNESS.set(Block.CANDLE, 0.1);
for (let i = 0; i < 16; i++) HARDNESS.set(624 + i, 1.25);
for (let i = 0; i < 16; i++) HARDNESS.set(640 + i, 1);
HARDNESS.set(Block.TINTED_GLASS, 0.3);
HARDNESS.set(Block.CRYING_OBSIDIAN, 50);
HARDNESS.set(Block.GLOW_LICHEN, 0.2);
HARDNESS.set(Block.GLOW_BERRIES, 0.2);
HARDNESS.set(Block.POINTED_DRIPSTONE, 1.5);
HARDNESS.set(Block.DRIPSTONE_BLOCK, 1.5);
HARDNESS.set(Block.SPORE_BLOSSOM, 0.2);
HARDNESS.set(Block.HANGING_ROOTS, 0.2);
HARDNESS.set(Block.ROOTED_DIRT, 0.5);
HARDNESS.set(Block.SMALL_DRIPLEAF, 0.2);
HARDNESS.set(Block.BIG_DRIPLEAF, 0.2);
for (let i = 0; i < 16; i++) HARDNESS.set(608 + i, 0.1);
HARDNESS.set(Block.MYCELIUM, 0.6);
HARDNESS.set(Block.MUSHROOM_STEM, 0.2);
HARDNESS.set(Block.BROWN_MUSHROOM_BLOCK, 0.2);
HARDNESS.set(Block.RED_MUSHROOM_BLOCK, 0.2);
HARDNESS.set(Block.MOSS_BLOCK, 0.1);
HARDNESS.set(Block.MOSS_CARPET, 0.1);
HARDNESS.set(Block.AZALEA, 0.1);
HARDNESS.set(Block.BEE_NEST, 0.3);
HARDNESS.set(Block.HAY_BLOCK, 0.5);
// 木头：与原木同级（斧头挖得快）
for (const id of [Block.OAK_WOOD, Block.SPRUCE_WOOD, Block.BIRCH_WOOD, Block.JUNGLE_WOOD, Block.ACACIA_WOOD, Block.DARK_OAK_WOOD]) {
  HARDNESS.set(id, 2);
}
HARDNESS.set(Block.POLISHED_BASALT, 1.25);
// 蓝冰比浮冰硬得多（原版 2.8）
HARDNESS.set(Block.BLUE_ICE, 2.8);
HARDNESS.set(Block.HONEYCOMB_BLOCK, 0.6);
// 蛛网：剑挖得快（原版 4，且只有剑/剪刀效率正常）；这里统一 4
HARDNESS.set(Block.COBWEB, 4);
// 按钮 / 压力板（批次 444）：木制统一 0.5
for (const id of [Block.SPRUCE_BUTTON, Block.BIRCH_BUTTON, Block.JUNGLE_BUTTON, Block.ACACIA_BUTTON, Block.DARK_OAK_BUTTON, Block.SPRUCE_PRESSURE_PLATE, Block.BIRCH_PRESSURE_PLATE, Block.JUNGLE_PRESSURE_PLATE, Block.ACACIA_PRESSURE_PLATE, Block.DARK_OAK_PRESSURE_PLATE]) {
  HARDNESS.set(id, 0.5);
}
// 剥皮原木：与原木同级
for (const id of [Block.STRIPPED_OAK_LOG, Block.STRIPPED_SPRUCE_LOG, Block.STRIPPED_BIRCH_LOG, Block.STRIPPED_JUNGLE_LOG, Block.STRIPPED_ACACIA_LOG, Block.STRIPPED_DARK_OAK_LOG]) {
  HARDNESS.set(id, 2);
}
HARDNESS.set(Block.WAXED_COPPER_BLOCK, 3);
HARDNESS.set(Block.WAXED_EXPOSED_COPPER, 3);
HARDNESS.set(Block.WAXED_WEATHERED_COPPER, 3);
HARDNESS.set(Block.WAXED_OXIDIZED_COPPER, 3);
HARDNESS.set(Block.FLOWERING_AZALEA, 0.1);
// 灵魂火把 / 灵魂灯笼：与普通火把同级（一碰就掉）
HARDNESS.set(Block.SOUL_TORCH, 0);
HARDNESS.set(Block.SOUL_LANTERN, 3.5);
// 混凝土粉末（批次 131）：原版硬度 0.5（比混凝土的 1.8 软得多，徒手也能挖）
for (let i = 0; i < 16; i++) HARDNESS.set(concretePowderId(i), 0.5);
// 下界疣：原版徒手一拍就掉（硬度 0），四个阶段都要登记
// （不登记的话 `blockHardness` 的兜底是 3 —— 收个下界疣要挖 4.5 秒，见 `isHardnessRegistered`）
// ⚠️ 这里按 id 算术展开，不能引用 `NETHER_WART_STAGES`：那张表在本文件**后面**才定义，
// 而这一段是模块加载期执行的（`const` 的暂时性死区会当场抛）
HARDNESS.set(Block.NETHER_WART_STAGE0, 0);
HARDNESS.set(Block.NETHER_WART_STAGE1, 0);
HARDNESS.set(Block.NETHER_WART_STAGE2, 0);
HARDNESS.set(Block.NETHER_WART_STAGE3, 0);
// 海带与海草（批次 50）：都是"一碰就掉"（硬度 0）；干海带块 0.5（原版，徒手可拆）
HARDNESS.set(Block.KELP, 0);
HARDNESS.set(Block.SEAGRASS, 0);
HARDNESS.set(Block.DRIED_KELP_BLOCK, 0.5);
// 珊瑚（批次 51）：珊瑚块 1.5（原版，与石砖同档），珊瑚丛/珊瑚扇 0（一碰就掉）
for (const start of [CORAL_BLOCK_ID_START, DEAD_CORAL_BLOCK_ID_START]) {
  for (let i = 0; i < CORAL_KINDS.length; i++) HARDNESS.set(start + i, 1.5);
}
for (const start of [CORAL_ID_START, DEAD_CORAL_ID_START, CORAL_FAN_ID_START, DEAD_CORAL_FAN_ID_START]) {
  for (let i = 0; i < CORAL_KINDS.length; i++) HARDNESS.set(start + i, 0);
}
// 蛋糕与花盆（批次 52）：蛋糕 0.5（原版，徒手拆得动）、花盆 0（一碰就掉）
HARDNESS.set(Block.CAKE, 0.5);
HARDNESS.set(Block.FLOWER_POT, 0);
// 脚手架（批次 53）：0（原版一碰就掉——所以搭高之后拆底下一节会哗啦一下全掉）
HARDNESS.set(Block.SCAFFOLDING, 0);
// 阳光传感器（批次 54）：0.2（原版）
HARDNESS.set(Block.DAYLIGHT_DETECTOR, 0.2);
// 绊线与绊线钩（批次 55）：都是 0（原版一碰就掉）
HARDNESS.set(Block.TRIPWIRE, 0);
HARDNESS.set(Block.TRIPWIRE_HOOK, 0);
// TNT（批次 56）：0（原版徒手一碰就掉）
HARDNESS.set(Block.TNT, 0);
// 漏斗（批次 58）：3（原版与铁块同一档，必须用镐）
HARDNESS.set(Block.HOPPER, 3);
// 投掷器（批次 59）：3.5（原版与熔炉/发射器同一档，必须用镐但**不限等级**）
HARDNESS.set(Block.DROPPER, 3.5);
HARDNESS.set(Block.DISPENSER, 3.5);
// 木桶（批次 61）：原版 2.5，比箱子"难挖一点"但一样**徒手就能挖掉**（只进加速表）
HARDNESS.set(Block.BARREL, 2.5);
// 堆肥桶（批次 70）：原版 0.6，斧头更快但**徒手就能挖**（与木桶同一条）
HARDNESS.set(Block.COMPOSTER, 0.6);
// 音符盒（批次 173）：原版 0.8，斧头更快、徒手也能挖（与木桶/堆肥桶同一条）
HARDNESS.set(Block.NOTE_BLOCK, 0.8);
// 炼药锅（批次 176）：原版 2，要**镐**（铁皮做的，这个进需求表而不只是加速表）
HARDNESS.set(Block.CAULDRON, 2);
// 末影箱（批次 71）：原版 22.5（黑曜石那一档，挖起来很慢）+ 要**钻石镐**才掉（见 tools）
HARDNESS.set(Block.ENDER_CHEST, 22.5);
// 潜影盒（批次 72）：原版 2（要镐，但木质镐就够——见 tools.ts）
// 16 色同硬度（批次 451）
for (const id of SHULKER_BOX_IDS) HARDNESS.set(id, 2);
// 海绵 / 湿海绵（批次 449）：原版 0.6，徒手就能拆（锄更快，但不强制）
HARDNESS.set(Block.SPONGE, 0.6);
HARDNESS.set(Block.WET_SPONGE, 0.6);
// 蜂蜜块（批次 450）：原版硬度 0（徒手一拍就掉，但挖起来黏糊糊的慢）
HARDNESS.set(Block.HONEY_BLOCK, 0);
// 磁石（批次 453）：原版 3.5，**必须用镐**（徒手挖得动但一无所获）
HARDNESS.set(Block.LODESTONE, 3.5);
// 重生锚（批次 454）：原版 5，**要钻石镐**（黑曜石那一档）
HARDNESS.set(Block.RESPAWN_ANCHOR, 5);
// 命令方块（批次 477）：原版 -1（基岩级、挖不掉）；这里给 5 并**不设挖掘等级**，
// 方便玩家拆掉重摆（原版只能靠创造模式）
HARDNESS.set(Block.COMMAND_BLOCK, 5);
// 唱片机（批次 489）：原版 2.0，木镐就能挖
HARDNESS.set(Block.JUKEBOX, 2);
// 钟（批次 490）：原版 5.0，要木镐
HARDNESS.set(Block.BELL, 5);
// 盔甲架（批次 492）：原版 1.0，徒手拆
HARDNESS.set(Block.ARMOR_STAND, 1);
// 洞穴藤蔓（批次 496）：原版 0.2，徒手就能揪
HARDNESS.set(Block.CAVE_VINES, 0.2);

// 树苗（批次 75）：与草/花一样是"一拍就掉"的东西
for (const id of SAPLING_IDS) HARDNESS.set(id, 0);
// 瓜藤（批次 77）：与作物一样一碰就掉（茎与结果的茎都是）
for (const stages of Object.values(STEM_STAGES)) for (const id of stages) HARDNESS.set(id, 0);
HARDNESS.set(PUMPKIN_STEM_ATTACHED_ID, 0);
HARDNESS.set(MELON_STEM_ATTACHED_ID, 0);
// 床（批次 79）：原版 0.2（徒手一拍就能拆，木色家具里最软的）
for (const id of BED_IDS) HARDNESS.set(id, 0.2);
// 铜的四档 × 四种形状：硬度 3（原版铜块就是 3.0，台阶与楼梯同档）
for (let stage = 0; stage < COPPER_STAGES.length; stage++) {
  for (let kind = 0; kind < 4; kind++) HARDNESS.set(copperId(stage, kind as 0 | 1 | 2 | 3), 3);
}
// 附魔台 5（必须钻石镐）、书架 1.5（斧更快，徒手也能采）
HARDNESS.set(Block.FARMLAND, 0.6);
HARDNESS.set(Block.BREWING_STAND, 0.5);
// 火焰硬度 0：徒手一拍即灭（`breakSeconds` 直接返回 0，不做任何计时）
HARDNESS.set(Block.FIRE, 0);
HARDNESS.set(Block.SOUL_FIRE, 0);
// 下界传送门硬度 -1：**挖不动**（`breakSeconds` 返回 Infinity）。
// 原版就是这样——想熄门只能敲框，敲一下门就整片灭掉（见 `NetherPortal.ts`）
HARDNESS.set(Block.NETHER_PORTAL, -1);
HARDNESS.set(Block.ENCHANTING_TABLE, 5);
HARDNESS.set(Block.BOOKSHELF, 1.5);
// 铁砧 5（原版 5.0，也砸得动）
HARDNESS.set(Block.ANVIL, 5);
// 铁块 5（原版），必须用镐
HARDNESS.set(Block.IRON_BLOCK, 5);
// 下界合金块 50（原版 50，比黑曜石还硬；必须钻石镐以上）
HARDNESS.set(Block.NETHERITE_BLOCK, 50);
// 锻造台 2.5（原版），斧最快、徒手也能采
HARDNESS.set(Block.SMITHING_TABLE, 2.5);
// 工作站四件（J23，批次 90）：讲台/制箭台/织布机 2.5（木头档，斧最快）、
// 砂轮 2.0（石头档，要镐——见 tools.ts 的 REQUIRED_TOOL）
HARDNESS.set(Block.LECTERN, 2.5);
HARDNESS.set(Block.FLETCHING_TABLE, 2.5);
HARDNESS.set(Block.GRINDSTONE, 2);
HARDNESS.set(Block.LOOM, 2.5);
// 制图台 2.5（木头档，斧最快）
HARDNESS.set(Block.CARTOGRAPHY_TABLE, 2.5);
// 切石机 3.5（原版与石头同档），要镐
HARDNESS.set(Block.STONECUTTER, 3.5);

// 木材家族：原木与木板 2.0、树叶 0.2，台阶楼梯跟随木板
for (const ids of Object.values(Wood)) {
  HARDNESS.set(ids.log, 2);
  HARDNESS.set(ids.planks, 2);
  HARDNESS.set(ids.leaves, 0.2);
  HARDNESS.set(ids.slab, 2);
  HARDNESS.set(ids.stairs, 2);
}

// 陶瓦 1.25、混凝土 1.8（都需要镐，不进徒手可采集表）
// ⚠️ 原色陶瓦单独设：它是 `Block.TERRACOTTA`，不在 `terracottaId(i)` 的范围内（见那个函数的注释）
HARDNESS.set(Block.TERRACOTTA, 1.25);
for (let i = 0; i < DYE_COLORS.length; i++) {
  HARDNESS.set(terracottaId(i), 1.25);
  HARDNESS.set(concreteId(i), 1.8);
}

// 石材补全与砂岩变体（批次 41 顺手把这里的**魔法数字**换成了 `Block` 常量，
// 并把 cobbled_deepslate 的硬度从 3 修成原版的 3.5——变体的硬度由它推出来，
// 母方块错一档，五个变体会跟着一起错）
HARDNESS.set(Block.MOSSY_COBBLESTONE, 2);
HARDNESS.set(Block.MOSSY_STONE_BRICKS, 1.5);
HARDNESS.set(Block.CRACKED_STONE_BRICKS, 1.5);
HARDNESS.set(Block.CRACKED_DEEPSLATE_BRICKS, 3.5);
HARDNESS.set(Block.COBBLED_DEEPSLATE, 3.5);
HARDNESS.set(Block.CHISELED_SANDSTONE, 0.8);
HARDNESS.set(Block.CUT_SANDSTONE, 0.8);
HARDNESS.set(Block.SMOOTH_SANDSTONE, 0.8);

// 红砂岩家族（批次 45）：与砂岩家族同档 0.8（原版两个家族是一套数值）
HARDNESS.set(Block.RED_SANDSTONE, 0.8);
HARDNESS.set(Block.CHISELED_RED_SANDSTONE, 0.8);
HARDNESS.set(Block.CUT_RED_SANDSTONE, 0.8);
HARDNESS.set(Block.SMOOTH_RED_SANDSTONE, 0.8);
// 末地建材（此前没登记，一律落到默认的 3；紫珀实际是 1.5）
HARDNESS.set(Block.END_STONE, 3);
HARDNESS.set(Block.END_STONE_BRICKS, 3);
HARDNESS.set(Block.PURPUR_BLOCK, 1.5);
HARDNESS.set(Block.PURPUR_PILLAR, 1.5);
// 石英家族 0.8（原版）、深板岩瓦 3.5（与深板岩砖同档）、红色下界砖 2（与下界砖同档）
HARDNESS.set(Block.QUARTZ_BLOCK, 0.8);
HARDNESS.set(Block.CHISELED_QUARTZ_BLOCK, 0.8);
HARDNESS.set(Block.QUARTZ_PILLAR, 0.8);
HARDNESS.set(Block.SMOOTH_QUARTZ, 0.8);
HARDNESS.set(Block.DEEPSLATE_TILES, 3.5);
HARDNESS.set(Block.RED_NETHER_BRICKS, 2);

// 粗金属块：硬度 5（原版），必须用镐
HARDNESS.set(Block.RAW_COPPER_BLOCK, 5);
HARDNESS.set(Block.RAW_IRON_BLOCK, 5);

// 玻璃与玻璃板：0.3，徒手可采集（徒手可采集表在下面统一维护）
HARDNESS.set(GLASS_PANE_ID, 0.3);
for (let i = 0; i < DYE_COLORS.length; i++) {
  HARDNESS.set(stainedGlassId(i), 0.3);
  HARDNESS.set(stainedGlassPaneId(i), 0.3);
}

// 自然装饰：植物一律"一碰就掉"（硬度 0），南瓜/西瓜/仙人掌按原版
for (const plant of [
  Block.SHORT_GRASS,
  Block.FERN,
  Block.DANDELION,
  Block.POPPY,
  Block.BLUE_ORCHID,
  Block.OXEYE_DAISY,
  Block.CORNFLOWER,
  Block.RED_MUSHROOM,
  Block.BROWN_MUSHROOM,
  Block.SUGAR_CANE,
  Block.DEAD_BUSH,
  Block.BAMBOO,
  Block.CRIMSON_FUNGUS,
  Block.WARPED_FUNGUS,
  Block.CRIMSON_ROOTS,
  Block.WARPED_ROOTS,
  Block.NETHER_SPROUTS,
  // 睡莲也是"一碰就掉"（原版硬度 0）
  Block.LILY_PAD,
]) {
  HARDNESS.set(plant, 0);
}
HARDNESS.set(Block.PUMPKIN, 1);
HARDNESS.set(Block.MELON, 1);
HARDNESS.set(Block.CACTUS, 0.4);

// 海晶石家族（原版都需要镐）
HARDNESS.set(Block.PRISMARINE, 1.5);
HARDNESS.set(Block.PRISMARINE_BRICKS, 1.5);
HARDNESS.set(Block.DARK_PRISMARINE, 1.5);
HARDNESS.set(Block.SEA_LANTERN, 0.3);

// 下界方块
HARDNESS.set(Block.NETHERRACK, 0.4);
HARDNESS.set(Block.SOUL_SAND, 0.5);
HARDNESS.set(Block.SOUL_SOIL, 0.5);
HARDNESS.set(Block.BASALT, 1.25);
HARDNESS.set(Block.SMOOTH_BASALT, 1.25);
HARDNESS.set(Block.BLACKSTONE, 1.5);
// 黑石家族（批次 82）：原版三块都是 1.5（与黑石同一档）
HARDNESS.set(Block.POLISHED_BLACKSTONE, 1.5);
HARDNESS.set(Block.POLISHED_BLACKSTONE_BRICKS, 1.5);
HARDNESS.set(Block.GILDED_BLACKSTONE, 1.5);
// 避雷针（批次 83）：原版硬度 3、徒手挖不动（要镐）
HARDNESS.set(Block.LIGHTNING_ROD, 3);
// 黑石家族的两块装饰（批次 85）：与黑石同档 1.5
HARDNESS.set(Block.CHISELED_POLISHED_BLACKSTONE, 1.5);
HARDNESS.set(Block.CRACKED_POLISHED_BLACKSTONE_BRICKS, 1.5);
HARDNESS.set(Block.MAGMA_BLOCK, 0.5);
HARDNESS.set(Block.CRIMSON_NYLIUM, 0.4);
HARDNESS.set(Block.WARPED_NYLIUM, 0.4);
HARDNESS.set(Block.CRIMSON_STEM, 2);
HARDNESS.set(Block.WARPED_STEM, 2);
HARDNESS.set(Block.CRIMSON_PLANKS, 2);
HARDNESS.set(Block.WARPED_PLANKS, 2);
HARDNESS.set(Block.NETHER_WART_BLOCK, 1);
HARDNESS.set(Block.WARPED_WART_BLOCK, 1);
HARDNESS.set(Block.SHROOMLIGHT, 1);
HARDNESS.set(Block.NETHER_BRICKS, 2);
HARDNESS.set(Block.NETHER_QUARTZ_ORE, 3);
HARDNESS.set(Block.ANCIENT_DEBRIS, 30);

// 石材家族的变体（批次 41）：硬度**跟随母方块**（花岗岩台阶 = 花岗岩 = 1.5、
// 苔石墙 = 苔石 = 2、深板岩圆石楼梯 = 3.5）。
//
// ⚠️ 这一条必须放在**所有母方块的硬度都登记完之后**：它读的是 `HARDNESS.get(parent)`，
// 而 160~167 / 227 / 240 / 247 / 248 这些母方块是在本文件后半段才登记的
// （踩过一次：循环写早了，变体全部拿到 `undefined → 1.5`，于是"苔石墙比苔石软"）。
// 正确性由 `tools/stone-variant-test.ts` 的"硬度 = 母方块"逐条断言兜住。
for (const [parentId, name, kinds] of STONE_VARIANT_PARENTS) {
  const hardness = HARDNESS.get(parentId) ?? 1.5;
  for (const kind of kinds) HARDNESS.set(stoneVariantId(name, kind)!, hardness);
}

// ---------------------------------------------------------------- 硬度补登（批次 62 / O9 收尾）
//
// 为什么要有这一段：`blockHardness` 的兜底是 **3**，于是"没登记"与"登记成 3"从外面看
// 一模一样。批次 61 写木桶时顺手用探针扫了一遍，发现**一批方块静默地拿到了 3**：
//   · 成熟作物徒手要 **4.5 秒**才掉（原版硬度 0：一碰就掉）——农业那条链基本没法用；
//   · 红石粉 / 拉杆 / 活塞这些徒手要 **15 秒**（原版 0~1.5 秒），而且当时**什么都掉不出来**。
// 下面把"落回默认值"的方块按原版**逐族补上**，并留一条断言（`tools/harvest-test.ts`）
// 遍历全表盯着"每个有物品的方块都显式登记过硬度"——以后加方块忘了写，测试就会红。

// ---- 地下：深板岩与矿石（原版：深板岩 3，**深板岩矿 4.5**，其余矿石 3，下界石英矿 3）
HARDNESS.set(Block.DEEPSLATE, 3);
for (const id of [
  Block.COAL_ORE,
  Block.IRON_ORE,
  Block.COPPER_ORE,
  Block.GOLD_ORE,
  Block.REDSTONE_ORE,
  Block.LAPIS_ORE,
  Block.DIAMOND_ORE,
  Block.EMERALD_ORE,
  Block.NETHER_QUARTZ_ORE,
]) {
  HARDNESS.set(id, 3);
}
for (const id of [
  Block.DEEPSLATE_COAL_ORE,
  Block.DEEPSLATE_IRON_ORE,
  Block.DEEPSLATE_COPPER_ORE,
  Block.DEEPSLATE_GOLD_ORE,
  Block.DEEPSLATE_REDSTONE_ORE,
  Block.DEEPSLATE_LAPIS_ORE,
  Block.DEEPSLATE_DIAMOND_ORE,
  Block.DEEPSLATE_EMERALD_ORE,
]) {
  HARDNESS.set(id, 4.5);
}

// ---- 末地一族（原版：末地石与末地石砖 3，紫颂 0.4，末地烛 0.1，龙蛋 3，
//      传送门框与传送门**挖不动**（-1，创造模式物品））
for (const id of [Block.END_STONE, Block.END_STONE_BRICKS]) HARDNESS.set(id, 3);
for (const kind of ['slab', 'stairs', 'wall'] as const) {
  HARDNESS.set(stoneVariantId('end_stone_bricks', kind)!, 3);
}
HARDNESS.set(Block.CHORUS_PLANT, 0.4);
HARDNESS.set(Block.CHORUS_FLOWER, 0.4);
HARDNESS.set(Block.END_ROD, 0.1);
HARDNESS.set(Block.DRAGON_EGG, 3);
HARDNESS.set(Block.END_PORTAL_FRAME, -1);
HARDNESS.set(Block.END_PORTAL, -1);

// ---- 红石元件（原版：粉/火把/中继器/比较器 **0**（一碰就掉），
//      拉杆/按钮/压力板 0.5，红石灯 0.3，活塞 1.5，红石块 5，侦测器 3）
for (const id of [Block.REDSTONE_WIRE, Block.REDSTONE_TORCH, Block.REPEATER, Block.COMPARATOR]) {
  HARDNESS.set(id, 0);
}
for (const id of [
  Block.LEVER,
  Block.STONE_BUTTON,
  Block.OAK_BUTTON,
  Block.STONE_PRESSURE_PLATE,
  Block.OAK_PRESSURE_PLATE,
]) {
  HARDNESS.set(id, 0.5);
}
HARDNESS.set(Block.REDSTONE_LAMP, 0.3);
HARDNESS.set(Block.PISTON, 1.5);
HARDNESS.set(Block.STICKY_PISTON, 1.5);
HARDNESS.set(Block.PISTON_HEAD, 1.5);
HARDNESS.set(Block.OBSERVER, 3);
HARDNESS.set(Block.REDSTONE_BLOCK, 5);
// 漏斗（批次 58）：原版与铁块同档
HARDNESS.set(Block.HOPPER, 3);

// ---- 作物（原版硬度 0：一碰就能收，这是"种地"手感的前提）
for (let stage = 0; stage < 4; stage++) {
  HARDNESS.set(Block.WHEAT_STAGE0 + stage, 0);
  HARDNESS.set(Block.CARROTS_STAGE0 + stage, 0);
  HARDNESS.set(Block.POTATOES_STAGE0 + stage, 0);
  HARDNESS.set(Block.BEETROOTS_STAGE0 + stage, 0);
}

// ---- 门与活板门（原版木门/活板门 3；含橡木——它的 id 是历史值但这一族要一起走）
for (const ids of Object.values(WoodShaped)) {
  HARDNESS.set(ids.door, 3);
  HARDNESS.set(ids.trapdoor, 3);
}

// ---- 铜（4 档氧化 × 4 种形状，原版都是 3）
for (let stage = 0; stage < 4; stage++) {
  for (const kind of [0, 1, 2, 3] as const) HARDNESS.set(copperId(stage, kind), 3);
}


/**
 * 作物的生长阶段表（按顺序）。
 *
 * 作物生长就是"把当前阶段换成下一个 id"，所以这几张表是唯一的事实来源。
 * 三种作物共用同一套生长行为，只是 id 区间与掉落不同（见 `cropOf`）。
 */
// ⚠️ 下面这一段必须在 `Block` 声明**之后**：它要用 `Block.PUMPKIN` 这些常量，
// 而 `Block` 是个 `as const` 对象（在块作用域里，提前读会直接抛 TDZ）。
// 同一份文件里也会踩这条坑——与"两个模块互相 import 时顶层读对方 const"是同一件事。

/** 结出的果实方块 */
export const STEM_FRUIT: Readonly<Record<string, number>> = {
  pumpkin: Block.PUMPKIN,
  melon: Block.MELON,
};

/**
 * 结果能扎在哪：耕地、泥土、草方块（原版如此——果实长在**旁边**那一格的"地里"，
 * 而不是茎自己那一格）。种子仍然只能种在**耕地**上（与小麦一致，见种植路径）。
 */
const FRUIT_SOIL = new Set<number>([Block.FARMLAND, Block.DIRT, Block.GRASS_BLOCK]);

/** 旁边那一格能结果吗（那一格是空气、它下面是可以扎根的土） */
export function canBearFruitAt(soilBelow: number, above: number): boolean {
  return FRUIT_SOIL.has(soilBelow) && above === Block.AIR;
}

export const CROP_STAGES: Readonly<Record<string, readonly number[]>> = {
  wheat: [Block.WHEAT_STAGE0, Block.WHEAT_STAGE1, Block.WHEAT_STAGE2, Block.WHEAT_STAGE3],
  carrots: [Block.CARROTS_STAGE0, Block.CARROTS_STAGE1, Block.CARROTS_STAGE2, Block.CARROTS_STAGE3],
  potatoes: [Block.POTATOES_STAGE0, Block.POTATOES_STAGE1, Block.POTATOES_STAGE2, Block.POTATOES_STAGE3],
  beetroots: [Block.BEETROOTS_STAGE0, Block.BEETROOTS_STAGE1, Block.BEETROOTS_STAGE2, Block.BEETROOTS_STAGE3],
};

/**
 * 甜浆果丛与可可豆的生长阶段表（批次 49）。
 *
 * 它们**不进 `CROP_STAGES`**：那张表是"种在耕地上的作物"，
 * `cropOf` / `growCrop` / `extraCropDrop` 三处都假设"下面是耕地、收获给种子"。
 * 甜浆果丛长在草上、可可豆挂在原木上，判定与掉落都不一样，各自一张表更清楚。
 */
export const BERRY_STAGES: readonly number[] = [
  Block.SWEET_BERRY_BUSH_STAGE0,
  Block.SWEET_BERRY_BUSH_STAGE1,
  Block.SWEET_BERRY_BUSH_STAGE2,
  Block.SWEET_BERRY_BUSH_STAGE3,
];
export const COCOA_STAGES: readonly number[] = [Block.COCOA_STAGE0, Block.COCOA_STAGE1, Block.COCOA_STAGE2];

/**
 * 下界疣的生长阶段表（批次 92）。
 *
 * 同样**不进 `CROP_STAGES`**：那张表的判定建立在"下面是耕地、旁边有水长得快"上，
 * 而下界疣长在灵魂沙上、不看水也不看光照（原版在下界的洞里照样长）。
 * 但它的**形状**要单独一套判定（下方必须是灵魂沙），所以连形状都单开了一个
 * （见 `blockShapes.ts` 与 `interaction/Placement.ts`）。
 */
export const NETHER_WART_STAGES: readonly number[] = [
  Block.NETHER_WART_STAGE0,
  Block.NETHER_WART_STAGE1,
  Block.NETHER_WART_STAGE2,
  Block.NETHER_WART_STAGE3,
];

/** 成熟（可收获）的那一阶段 */
export const NETHER_WART_RIPE_STAGE = NETHER_WART_STAGES.length - 1;

/** 这个 id 是下界疣的第几阶段（不是则 -1） */
export function netherWartStageOf(id: number): number {
  return NETHER_WART_STAGES.indexOf(id);
}

/** 这个 id 是甜浆果丛的第几阶段（不是则 -1） */
export function berryStageOf(id: number): number {
  return BERRY_STAGES.indexOf(id);
}

/** 这个 id 是可可豆的第几阶段（不是则 -1） */
export function cocoaStageOf(id: number): number {
  return COCOA_STAGES.indexOf(id);
}

/** 丛林原木的 id（可可豆只能挂在它上面；丛林树与巨型丛林树共用同一种原木） */
export const JUNGLE_LOG_ID: number = Wood.jungle!.log;

/** 小麦的阶段表（保留这个名字：调用点很多，而且它是最常用的一张） */
export const WHEAT_STAGES: readonly number[] = CROP_STAGES.wheat!;

export interface CropAt {
  readonly crop: string;
  /** 第几个阶段（0 起） */
  readonly stage: number;
  /** 是不是最后一阶段（成熟） */
  readonly ripe: boolean;
}

/** 这个 id 属于哪种作物的哪个阶段；不是作物返回 null */
export function cropOf(id: number): CropAt | null {
  for (const [crop, stages] of Object.entries(CROP_STAGES)) {
    const stage = stages.indexOf(id);
    if (stage >= 0) return { crop, stage, ripe: stage === stages.length - 1 };
  }
  return null;
}

/** 这个 id 是小麦的某个阶段吗（不是则 -1） */
export function wheatStageOf(id: number): number {
  return WHEAT_STAGES.indexOf(id);
}

export function blockHardness(id: number): number {
  return HARDNESS.get(id) ?? 3;
}

/**
 * 爆炸抗性（B5，批次 597）。
 *
 * 原版每个方块都有自己的 `blastResistance`；这里不抄 700 行，只把**关键档位**写死：
 *  -  bedrock 3.6e6（绝对炸不掉）；
 *  -  黑曜石/铁砧/附魔台/远古残骸/下界合金块/重生锚 1200；
 *  -  末影箱 600；水/岩浆 100（炸不掉，但也不该被当成"硬方块"）；
 *  -  石头/圆石/深板岩/砖 6；木头约 3；泥土 0.5；玻璃 0.3；植物 0。
 * 其余走 `blockHardness(id) * 4` 兜底，并夹到 [0.2, 20]——
 * 这个兜底只为"没登记的方块也有个合理量级"，不追求与原版逐个一致。
 */
const BLAST_RESISTANCE = new Map<number, number>([
  [Block.BEDROCK, 3_600_000],
  [Block.OBSIDIAN, 1200],
  [Block.CRYING_OBSIDIAN, 1200],
  [Block.ANVIL, 1200],
  [Block.ENCHANTING_TABLE, 1200],
  [Block.ANCIENT_DEBRIS, 1200],
  [Block.NETHERITE_BLOCK, 1200],
  [Block.RESPAWN_ANCHOR, 1200],
  [Block.ENDER_CHEST, 600],
  [Block.WATER, 100],
  [Block.LAVA, 100],
  [Block.STONE, 6],
  [Block.COBBLESTONE, 6],
  [Block.DEEPSLATE, 6],
  [Block.BRICKS, 6],
  [Block.NETHER_BRICKS, 6],
  [Block.IRON_BLOCK, 6],
  [Block.GOLD_BLOCK, 6],
  [Block.DIAMOND_BLOCK, 6],
  [Block.EMERALD_BLOCK, 6],
  [Block.DIRT, 0.5],
  [Block.GRASS_BLOCK, 0.6],
  [Block.SAND, 0.5],
  [Block.GRAVEL, 0.6],
  [Block.GLASS, 0.3],
  [Block.TNT, 0],
]);

export function blastResistanceOf(id: number): number {
  const explicit = BLAST_RESISTANCE.get(id);
  if (explicit !== undefined) return explicit;
  return Math.max(0.2, Math.min(20, blockHardness(id) * 4));
}

/**
 * 这一格会不会被这次爆炸炸掉（B5）。
 *
 * 原版的射线衰减比 `power * 8` 复杂，这里用一个**单调阈值**近似：
 * 抗性高于 `power * 8` 就留下。普通 TNT（power 4）能炸石头（6 ≤ 32），
 * 炸不掉黑曜石/铁砧（1200 > 32）；苦力怕（power 3）同理。
 */
export function explosionBreaksBlock(id: number, power: number): boolean {
  if (id === Block.AIR) return false;
  return blastResistanceOf(id) <= power * 8;
}

/**
 * 这个方块的硬度**显式登记过**吗（批次 62）。
 *
 * 存在的理由：`blockHardness` 的兜底是 3，而"没登记"与"登记成 3"从外面看一模一样——
 * 结果是一批方块静默地拿到了 3（成熟作物 4.5 秒才能收、红石粉 15 秒……）。
 * 现在由 `tools/harvest-test.ts` 遍历全表断言"每个有物品的方块都登记过"，
 * 这条兜底就只用于"真的忘了登记"时给出一个不至于崩掉的值。
 */
export function isHardnessRegistered(id: number): boolean {
  return HARDNESS.has(id);
}

/**
 * 这一格能不能攀爬（B11）：梯子 / 藤蔓 / 锁链。
 *
 * 锁链可攀爬是**基岩版**特性（本项目复刻的正是基岩版；Java 版不行）。
 * 按**形状**判定而不是列方块 id：加一种木材、以后加铁梯子都自动跟上——
 * 这正是"同族方块的行为一律按形状判定"那条经验（批次 38 踩过）。
 */
/**
 * 这一格是不是蛛网（批次 441）。
 *
 * 物理层每帧都问一次，所以它必须是"一次查表"的便宜操作——
 * 与 `isClimbableBlock` 同一个口径，别在这里写 `blockDef(...).name === 'minicraft:cobweb'`。
 */
/**
 * 原木 → 剥皮原木（批次 443）。
 *
 * 原版是用斧头右键原木"刮掉一层树皮"，**不是合成**。所以这张表放在方块注册表里、
 * 由 `main` 的右键交互读，而不是写成配方——写成配方会让玩家能在工作台里
 * 凭空剥皮，与原版手感差得很远。
 */
const STRIPPED_VARIANT = new Map<number, number>([
  [5, 678], // oak_log → stripped_oak_log（5 是橡木原木的固定 id）
  [102, 679], // spruce_log
  [107, 680], // birch_log
  [112, 681], // jungle_log
  [117, 682], // acacia_log
  [122, 683], // dark_oak_log
]);

/** 这个方块能不能被斧头剥皮；不能就返回 undefined */
export function stripResult(id: number): number | undefined {
  return STRIPPED_VARIANT.get(id);
}

export function isCobwebBlock(id: number): boolean {
  return id === Block.COBWEB;
}

/**
 * 甜浆果丛（四个生长阶段共用一个判据，批次 581）。
 *
 * 阶段 id 是连续的（`SWEET_BERRY_BUSH_STAGE0..3`），所以按区间判，
 * 不必每加一个阶段就往这里补一行。
 */
export function isSweetBerryBushBlock(id: number): boolean {
  return id >= SWEET_BERRY_BUSH_ID_START && id <= SWEET_BERRY_BUSH_ID_START + 3;
}

/**
 * 这一块能不能"含水"（批次 469）。
 *
 * 判据是**形状**而不是白名单：原版能含水的全是非整格方块（台阶/楼梯/栅栏/墙/
 * 活板门/玻璃板/门/栅栏门/告示牌）。整格方块（石头、泥土）与植物、雪层都不行。
 *
 * ⚠️ 雪层虽然也是非整格，但它的 bits5-7 全被层数占了，不能含水（原版也不行）——
 * 它的 shape 是 `snow`，不在这张表里，天然被排除。
 */
export function canBeWaterlogged(id: number): boolean {
  const shape = blockDef(id).shape;
  return (
    shape === 'slab' ||
    shape === 'stairs' ||
    shape === 'fence' ||
    shape === 'wall' ||
    shape === 'trapdoor' ||
    shape === 'pane' ||
    shape === 'door' ||
    shape === 'fence_gate' ||
    shape === 'sign'
  );
}

/**
 * 放置时的水浸判定（批次 469，纯函数）：
 * 落点原本是**水**、且这个方块能含水 → 返回带 waterlogged 的状态。
 *
 * 抽到这里是为了能离线断言：主程序只负责"读落点、写方块"，判定本身没有世界依赖。
 */
export function waterloggedPlacementState(blockId: number, state: number, existingBlock: number): number {
  return existingBlock === Block.WATER && canBeWaterlogged(blockId) ? withWaterlogged(state, true) : state;
}

/**
 * 挖掉一格之后应该留下什么（批次 469，纯函数）：
 * 含水方块 → 水；其余 → 空气。
 *
 * ⚠️ 顺序要紧：先看**挖之前**的 id/state（调用方传进来），
 * 不是"挖完之后再读"——那时这一格已经是空气了。
 */
export function blockAfterBreak(blockId: number, state: number): number {
  return canBeWaterlogged(blockId) && isWaterlogged(state) ? Block.WATER : Block.AIR;
}

/** 这一块是不是蜂蜜块（批次 450）：物理层的"跳不起来 / 下滑限速"与摔落减伤共用 */
export function isHoneyBlock(id: number): boolean {
  return id === Block.HONEY_BLOCK;
}

export function isClimbableBlock(id: number): boolean {
  const shape = blockDef(id).shape;
  // 脚手架（批次 53）：原版能顺着它往上爬——加一个形状，攀爬就自动跟上了
  return shape === 'ladder' || shape === 'vine' || shape === 'chain' || shape === 'scaffolding';
}

// 注：破坏耗时的计算在 `tools.ts` 的 `breakSeconds`（需要工具的等级与速度），
// 这里只提供硬度与「徒手可采集」这两份原始数据。

/** 石材类方块（深板岩变体的判定基准） */
export function deepslateVariantOf(id: number): number {
  switch (id) {
    case Block.COAL_ORE:
      return Block.DEEPSLATE_COAL_ORE;
    case Block.IRON_ORE:
      return Block.DEEPSLATE_IRON_ORE;
    case Block.COPPER_ORE:
      return Block.DEEPSLATE_COPPER_ORE;
    case Block.GOLD_ORE:
      return Block.DEEPSLATE_GOLD_ORE;
    case Block.REDSTONE_ORE:
      return Block.DEEPSLATE_REDSTONE_ORE;
    case Block.LAPIS_ORE:
      return Block.DEEPSLATE_LAPIS_ORE;
    case Block.DIAMOND_ORE:
      return Block.DEEPSLATE_DIAMOND_ORE;
    case Block.EMERALD_ORE:
      return Block.DEEPSLATE_EMERALD_ORE;
    default:
      return id;
  }
}
