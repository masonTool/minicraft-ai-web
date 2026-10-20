/**
 * 方块注册表
 *
 * 设计说明：
 * - 方块以数字 id 存储在世界数据里（Uint8Array），注册表负责 id ↔ 定义 的映射。
 * - `tiles` 为 [顶面, 底面, 侧面] 三个图集贴图名。
 * - 完整 1.18 方块集（含 block state）会在 B3/B4 逐步补齐；当前覆盖地形生成所需部分。
 */

import { DYE_COLORS, WOOD_TYPES } from './colors.ts';
import type { TreeKind } from '../gen/Features.ts';
import {
  cauldronLevelOf,
  hasEndPortalEye,
  isLavaCauldron,
  isComposterReady,
  isFlash,
  isInverted,
  isLitState,
  isPowered,
  paintingVariantOf,
  sixFacingOf,
  sixFacingOpposite,
  sixFacingOffset,
  type BlockShape,
} from './blockState.ts';
// 画（B14，批次 86）：贴图按"哪一幅"换，而"哪一幅"的表在 `paintings.ts` 里
// （那是纯数据、不引任何模块，所以这里引它不会成环）
import { paintingTile } from './paintings.ts';

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

interface BlockSpec {
  id: number;
  name: string;
  tiles?: readonly [string, string, string];
  solid?: boolean;
  opaque?: boolean;
  /** 头卡住会窒息（不填 = 跟 `opaque` 一致；树叶显式写 false） */
  suffocates?: boolean;
  light?: number;
  lightOpacity?: number;
  liquid?: boolean;
  translucent?: boolean;
  shape?: BlockShape;
  stateTiles?: (state: number) => readonly [string, string, string];
  faceTile?: (state: number, faceDir: readonly [number, number, number]) => string | undefined;
  facesPlayer?: boolean;
  facesSneak?: boolean;
  facesNormal?: boolean;
  stateLight?: (state: number) => number;
  itemless?: boolean;
  waterPlant?: boolean;
}

/**
 * 木桶的两个端面（批次 65）：**盖子**在朝向那一面、**桶底**在它的对面，其余四面是桶身。
 *
 * 只给"盖子"一张是不够的：盖子朝侧面时，对面那一面在原版里是桶底（不是桶身），
 * 而"哪一面是桶底"靠 `tiles` 的固定槽位表达不出来（槽位是"顶/底/侧"，不是"朝向的对面"）。
 */
function barrelFace(state: number, faceDir: readonly [number, number, number]): string | undefined {
  const facing = sixFacingOf(state);
  const lid = sixFacingOffset(facing);
  if (faceDir[0] === lid[0] && faceDir[1] === lid[1] && faceDir[2] === lid[2]) return 'barrel_top';
  const bottom = sixFacingOffset(sixFacingOpposite(facing));
  if (faceDir[0] === bottom[0] && faceDir[1] === bottom[1] && faceDir[2] === bottom[2]) return 'barrel_bottom';
  return undefined;
}

/**
 * 侦测器的三张面（批次 65）：**看的那一面**是眼、**输出那一面**是红点、其余四面是石壳。
 *
 * 这张贴图分工与引擎里的语义严格对应：`facing` = 看的那一面（`componentOutput` 用
 * `FACING_OFFSET[facing]` 判定"被观察的方块"），而输出给的是 `facing + 2`（对面）。
 * 所以"眼 / 红点"绝不能贴反——贴反了玩家会以为它看反了。
 */
function observerFace(state: number, faceDir: readonly [number, number, number]): string | undefined {
  const facing = sixFacingOf(state);
  const front = sixFacingOffset(facing);
  if (faceDir[0] === front[0] && faceDir[1] === front[1] && faceDir[2] === front[2]) return 'observer_top';
  const back = sixFacingOffset(sixFacingOpposite(facing));
  if (faceDir[0] === back[0] && faceDir[1] === back[1] && faceDir[2] === back[2]) return 'observer_back';
  return undefined;
}

/**
 * 凸口/挡板那一面的贴图（批次 64）：朝向那一面用 `nozzle`，其余五面返回 undefined。
 * 与 `frontTile` 同一套判据，只是不随"点着没点着"变化。
 */
function nozzleTile(nozzle: string) {
  return (state: number, faceDir: readonly [number, number, number]): string | undefined => {
    // ⚠️ 用**六向**朝向：投掷器/发射器朝上/朝下时，"上下"记在另一个位上
    // （`facingOf` 只读水平那两位，朝下的凸口会被算成"朝北"）
    const offset = sixFacingOffset(sixFacingOf(state));
    return faceDir[0] === offset[0] && faceDir[1] === offset[1] && faceDir[2] === offset[2]
      ? nozzle
      : undefined;
  };
}

/**
 * "正脸"贴图（批次 64）：只有**朝向那一面**用 `front`（点着时用 `frontLit`），
 * 其余五面返回 undefined（由网格化器回退到普通贴图）。
 *
 * 判据用的是面的**外法线**与朝向的偏移量比对——朝向 `facing` 指的就是"正脸朝哪边"
 * （与投掷器/发射器的"凸口朝哪边"同一套语义）。
 */
function frontTile(front: string, frontLit: string) {
  return (state: number, faceDir: readonly [number, number, number]): string | undefined => {
    const offset = sixFacingOffset(sixFacingOf(state));
    if (faceDir[0] !== offset[0] || faceDir[1] !== offset[1] || faceDir[2] !== offset[2]) return undefined;
    return isLitState(state) ? frontLit : front;
  };
}

const BASE_SPECS: readonly BlockSpec[] = [
  { id: 0, name: 'minecraft:air', tiles: ['', '', ''], solid: false, opaque: false },

  // ---- 基础建筑与地形方块
  { id: 1, name: 'minecraft:stone', tiles: ['stone', 'stone', 'stone'] },
  { id: 2, name: 'minecraft:dirt', tiles: ['dirt', 'dirt', 'dirt'] },
  { id: 3, name: 'minecraft:grass_block', tiles: ['grass_top', 'dirt', 'grass_side'] },
  { id: 4, name: 'minecraft:sand', tiles: ['sand', 'sand', 'sand'] },
  { id: 5, name: 'minecraft:oak_log', tiles: ['oak_log_top', 'oak_log_top', 'oak_log_side'] },
  // 树叶：不透明（渲染要剔除相邻面）但**不致窒息**，原版钻进树叶里不掉血
  { id: 6, name: 'minecraft:oak_leaves', tiles: ['oak_leaves', 'oak_leaves', 'oak_leaves'], lightOpacity: 1, suffocates: false },
  { id: 7, name: 'minecraft:oak_planks', tiles: ['oak_planks', 'oak_planks', 'oak_planks'] },
  { id: 8, name: 'minecraft:cobblestone', tiles: ['cobblestone', 'cobblestone', 'cobblestone'] },
  { id: 9, name: 'minecraft:bedrock', tiles: ['bedrock', 'bedrock', 'bedrock'] },

  // ---- 流体与透明方块
  {
    id: 10,
    name: 'minecraft:water',
    tiles: ['water', 'water', 'water'],
    solid: false,
    opaque: false,
    liquid: true,
    shape: 'fluid',
    translucent: true,
    lightOpacity: 1,
  },
  { id: 11, name: 'minecraft:glass', tiles: ['glass', 'glass', 'glass'], opaque: false, translucent: true, lightOpacity: 0 },

  // ---- 1.18 地下岩石
  { id: 12, name: 'minecraft:deepslate', tiles: ['deepslate', 'deepslate', 'deepslate'] },
  { id: 13, name: 'minecraft:granite', tiles: ['granite', 'granite', 'granite'] },
  { id: 14, name: 'minecraft:diorite', tiles: ['diorite', 'diorite', 'diorite'] },
  { id: 15, name: 'minecraft:andesite', tiles: ['andesite', 'andesite', 'andesite'] },
  { id: 16, name: 'minecraft:tuff', tiles: ['tuff', 'tuff', 'tuff'] },
  // 干草块（批次 437）：六个面同一张贴图（原版只有顶面/侧面之分，这里不细分）
  { id: 667, name: 'minecraft:hay_block', tiles: ['hay_block', 'hay_block', 'hay_block'] },
  // 六面树皮的木头（批次 438）：复用原木侧面的贴图，不新画
  { id: 668, name: 'minecraft:oak_wood', tiles: ['oak_log_side', 'oak_log_side', 'oak_log_side'] },
  { id: 669, name: 'minecraft:spruce_wood', tiles: ['spruce_log_side', 'spruce_log_side', 'spruce_log_side'] },
  { id: 670, name: 'minecraft:birch_wood', tiles: ['birch_log_side', 'birch_log_side', 'birch_log_side'] },
  { id: 671, name: 'minecraft:jungle_wood', tiles: ['jungle_log_side', 'jungle_log_side', 'jungle_log_side'] },
  { id: 672, name: 'minecraft:acacia_wood', tiles: ['acacia_log_side', 'acacia_log_side', 'acacia_log_side'] },
  { id: 673, name: 'minecraft:dark_oak_wood', tiles: ['dark_oak_log_side', 'dark_oak_log_side', 'dark_oak_log_side'] },
  // 磨制玄武岩 / 蓝冰（批次 439）：复用已有贴图（玄武岩侧面、浮冰），不新画
  { id: 674, name: 'minecraft:polished_basalt', tiles: ['basalt_side', 'basalt_side', 'basalt_side'] },
  { id: 675, name: 'minecraft:blue_ice', tiles: ['packed_ice', 'packed_ice', 'packed_ice'] },
  // 蜜脾块（批次 440）：纯装饰方块，没有行为
  { id: 676, name: 'minecraft:honeycomb_block', tiles: ['honeycomb_block', 'honeycomb_block', 'honeycomb_block'] },
  // 蛛网（批次 441）：能穿过、会减速；渲染用一张带透明感的贴图
  { id: 677, name: 'minecraft:cobweb', tiles: ['cobweb', 'cobweb', 'cobweb'], solid: false, opaque: false, lightOpacity: 0 },
  // 剥皮原木（批次 443）：颜色比原木浅一档，贴图由 TextureAtlas 现画
  { id: 678, name: 'minecraft:stripped_oak_log', tiles: ['stripped_oak_log', 'stripped_oak_log', 'stripped_oak_log'] },
  { id: 679, name: 'minecraft:stripped_spruce_log', tiles: ['stripped_spruce_log', 'stripped_spruce_log', 'stripped_spruce_log'] },
  { id: 680, name: 'minecraft:stripped_birch_log', tiles: ['stripped_birch_log', 'stripped_birch_log', 'stripped_birch_log'] },
  { id: 681, name: 'minecraft:stripped_jungle_log', tiles: ['stripped_jungle_log', 'stripped_jungle_log', 'stripped_jungle_log'] },
  { id: 682, name: 'minecraft:stripped_acacia_log', tiles: ['stripped_acacia_log', 'stripped_acacia_log', 'stripped_acacia_log'] },
  { id: 683, name: 'minecraft:stripped_dark_oak_log', tiles: ['stripped_dark_oak_log', 'stripped_dark_oak_log', 'stripped_dark_oak_log'] },
  // 其余五种木材的按钮 / 压力板（批次 444）：贴图复用同种木板，形状与橡木那两个一致
  { id: 684, name: 'minecraft:spruce_button', tiles: ['spruce_planks', 'spruce_planks', 'spruce_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 685, name: 'minecraft:birch_button', tiles: ['birch_planks', 'birch_planks', 'birch_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 686, name: 'minecraft:jungle_button', tiles: ['jungle_planks', 'jungle_planks', 'jungle_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 687, name: 'minecraft:acacia_button', tiles: ['acacia_planks', 'acacia_planks', 'acacia_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 688, name: 'minecraft:dark_oak_button', tiles: ['dark_oak_planks', 'dark_oak_planks', 'dark_oak_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 689, name: 'minecraft:spruce_pressure_plate', tiles: ['spruce_planks', 'spruce_planks', 'spruce_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 690, name: 'minecraft:birch_pressure_plate', tiles: ['birch_planks', 'birch_planks', 'birch_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 691, name: 'minecraft:jungle_pressure_plate', tiles: ['jungle_planks', 'jungle_planks', 'jungle_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 692, name: 'minecraft:acacia_pressure_plate', tiles: ['acacia_planks', 'acacia_planks', 'acacia_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  { id: 693, name: 'minecraft:dark_oak_pressure_plate', tiles: ['dark_oak_planks', 'dark_oak_planks', 'dark_oak_planks'], shape: 'flat', solid: false, opaque: false, lightOpacity: 0 },
  // 海绵 / 湿海绵（批次 449）：干海绵放下去吸水（半径 3、最多 65 格，见 `world/Sponge.ts`），
  // 吸饱了变成湿海绵；湿海绵在熔炉里烤干才会变回来（原版就是这么一条闭环）
  { id: 694, name: 'minecraft:sponge', tiles: ['sponge', 'sponge', 'sponge'] },
  { id: 695, name: 'minecraft:wet_sponge', tiles: ['wet_sponge', 'wet_sponge', 'wet_sponge'] },
  // 蜂蜜块（批次 450）：站在上面**跳不起来**、贴着侧面下滑被限速、摔上去只受 20% 伤害。
  // 原版还有"被活塞推动时粘走相邻方块"——本项目没有"活塞推方块实体"那条路，记在差异里
  { id: 696, name: 'minecraft:honey_block', tiles: ['honey_block', 'honey_block', 'honey_block'] },
  { id: 17, name: 'minecraft:calcite', tiles: ['calcite', 'calcite', 'calcite'] },
  { id: 18, name: 'minecraft:gravel', tiles: ['gravel', 'gravel', 'gravel'] },
  { id: 19, name: 'minecraft:clay', tiles: ['clay', 'clay', 'clay'] },
  { id: 20, name: 'minecraft:sandstone', tiles: ['sandstone_top', 'sandstone_top', 'sandstone'] },

  // ---- 寒冷群系
  { id: 21, name: 'minecraft:snow_block', tiles: ['snow', 'snow', 'snow'] },
  { id: 22, name: 'minecraft:ice', tiles: ['ice', 'ice', 'ice'], opaque: false, translucent: true, lightOpacity: 1 },
  {
    id: 23,
    name: 'minecraft:packed_ice',
    tiles: ['packed_ice', 'packed_ice', 'packed_ice'],
    opaque: false,
    translucent: true,
    lightOpacity: 2,
  },

  // ---- 特殊
  { id: 24, name: 'minecraft:obsidian', tiles: ['obsidian', 'obsidian', 'obsidian'] },
  {
    id: 25,
    name: 'minecraft:lava',
    tiles: ['lava', 'lava', 'lava'],
    solid: false,
    opaque: false,
    liquid: true,
    shape: 'fluid',
    light: 15,
    lightOpacity: 1,
  },
  { id: 26, name: 'minecraft:glowstone', tiles: ['glowstone', 'glowstone', 'glowstone'], light: 15 },

  // ---- 主世界矿石（1.18 共 8 种主世界矿石 + 深层变体）
  { id: 27, name: 'minecraft:coal_ore', tiles: ['coal_ore', 'coal_ore', 'coal_ore'] },
  { id: 28, name: 'minecraft:iron_ore', tiles: ['iron_ore', 'iron_ore', 'iron_ore'] },
  { id: 29, name: 'minecraft:copper_ore', tiles: ['copper_ore', 'copper_ore', 'copper_ore'] },
  { id: 30, name: 'minecraft:gold_ore', tiles: ['gold_ore', 'gold_ore', 'gold_ore'] },
  {
    id: 31,
    name: 'minecraft:redstone_ore',
    tiles: ['redstone_ore', 'redstone_ore', 'redstone_ore'],
    // 踩上去会亮（批次 248）：原版是"被打扰时发光 9 级"，状态位与红石灯同一条 `powered`
    stateTiles: (state) =>
      isPowered(state)
        ? ['redstone_ore_lit', 'redstone_ore_lit', 'redstone_ore_lit']
        : ['redstone_ore', 'redstone_ore', 'redstone_ore'],
    stateLight: (state) => (isPowered(state) ? 9 : 0),
  },
  { id: 32, name: 'minecraft:lapis_ore', tiles: ['lapis_ore', 'lapis_ore', 'lapis_ore'] },
  { id: 33, name: 'minecraft:diamond_ore', tiles: ['diamond_ore', 'diamond_ore', 'diamond_ore'] },
  { id: 34, name: 'minecraft:emerald_ore', tiles: ['emerald_ore', 'emerald_ore', 'emerald_ore'] },
  { id: 35, name: 'minecraft:deepslate_coal_ore', tiles: ['deepslate_coal_ore', 'deepslate_coal_ore', 'deepslate_coal_ore'] },
  { id: 36, name: 'minecraft:deepslate_iron_ore', tiles: ['deepslate_iron_ore', 'deepslate_iron_ore', 'deepslate_iron_ore'] },
  {
    id: 37,
    name: 'minecraft:deepslate_copper_ore',
    tiles: ['deepslate_copper_ore', 'deepslate_copper_ore', 'deepslate_copper_ore'],
  },
  { id: 38, name: 'minecraft:deepslate_gold_ore', tiles: ['deepslate_gold_ore', 'deepslate_gold_ore', 'deepslate_gold_ore'] },
  {
    id: 39,
    name: 'minecraft:deepslate_redstone_ore',
    tiles: ['deepslate_redstone_ore', 'deepslate_redstone_ore', 'deepslate_redstone_ore'],
    stateTiles: (state) =>
      isPowered(state)
        ? ['deepslate_redstone_ore_lit', 'deepslate_redstone_ore_lit', 'deepslate_redstone_ore_lit']
        : ['deepslate_redstone_ore', 'deepslate_redstone_ore', 'deepslate_redstone_ore'],
    stateLight: (state) => (isPowered(state) ? 9 : 0),
  },
  { id: 40, name: 'minecraft:deepslate_lapis_ore', tiles: ['deepslate_lapis_ore', 'deepslate_lapis_ore', 'deepslate_lapis_ore'] },
  {
    id: 41,
    name: 'minecraft:deepslate_diamond_ore',
    tiles: ['deepslate_diamond_ore', 'deepslate_diamond_ore', 'deepslate_diamond_ore'],
  },
  {
    id: 42,
    name: 'minecraft:deepslate_emerald_ore',
    tiles: ['deepslate_emerald_ore', 'deepslate_emerald_ore', 'deepslate_emerald_ore'],
  },

  // ---- 功能方块
  { id: 43, name: 'minecraft:crafting_table', tiles: ['crafting_table_top', 'oak_planks', 'crafting_table_side'] },
  {
    id: 44,
    name: 'minecraft:furnace',
    tiles: ['furnace_top', 'furnace_top', 'furnace_side'],
    // 正面（批次 64，O10 的第一步）：未点 = 炉口黑洞、点着 = 有火光，**只亮正面**。
    // 在此之前四个侧面会一起亮（那时立方体只有一个"侧面"贴图槽），
    // 现在靠面级贴图 + `facing` 状态区分正反面（放置时正脸朝你）。
    faceTile: frontTile('furnace_front', 'furnace_front_on'),
    facesPlayer: true,
    stateLight: (state) => (isLitState(state) ? 13 : 0),
  },
  { id: 45, name: 'minecraft:chest', tiles: ['chest_top', 'chest_top', 'chest_side'] },
  /**
   * 陷阱箱（批次 249）：外观与箱子同款（红锁扣区分），**打开时向相邻红石输出 15**。
   *
   * 它没有额外的状态位：开箱/关箱由主程序写 `powered` 位（与拉杆同一个口径），
   * 红石引擎把它当电源读。容器本身与箱子共用 `getOrCreateChest`（按坐标存）。
   */
  { id: 585, name: 'minecraft:trapped_chest', tiles: ['trapped_chest_top', 'trapped_chest_top', 'trapped_chest_side'] },

  // ---- 石材家族
  { id: 62, name: 'minecraft:stone_bricks', tiles: ['stone_bricks', 'stone_bricks', 'stone_bricks'] },
  { id: 63, name: 'minecraft:chiseled_stone_bricks', tiles: ['chiseled_stone_bricks', 'chiseled_stone_bricks', 'chiseled_stone_bricks'] },
  { id: 64, name: 'minecraft:smooth_stone', tiles: ['smooth_stone', 'smooth_stone', 'smooth_stone'] },
  { id: 65, name: 'minecraft:polished_granite', tiles: ['polished_granite', 'polished_granite', 'polished_granite'] },
  { id: 66, name: 'minecraft:polished_diorite', tiles: ['polished_diorite', 'polished_diorite', 'polished_diorite'] },
  { id: 67, name: 'minecraft:polished_andesite', tiles: ['polished_andesite', 'polished_andesite', 'polished_andesite'] },
  { id: 68, name: 'minecraft:deepslate_bricks', tiles: ['deepslate_bricks', 'deepslate_bricks', 'deepslate_bricks'] },
  { id: 69, name: 'minecraft:chiseled_deepslate', tiles: ['chiseled_deepslate', 'chiseled_deepslate', 'chiseled_deepslate'] },
  { id: 70, name: 'minecraft:bricks', tiles: ['bricks', 'bricks', 'bricks'] },
  { id: 71, name: 'minecraft:polished_deepslate', tiles: ['polished_deepslate', 'polished_deepslate', 'polished_deepslate'] },
];

/** 羊毛 id 起始值：16 种颜色连续排列，顺序与 DYE_COLORS 一致 */
export const WOOL_ID_START = 46;

const WOOL_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color, index) => ({
  id: WOOL_ID_START + index,
  name: `minecraft:${color.name}_wool`,
  tiles: [`wool_${color.name}`, `wool_${color.name}`, `wool_${color.name}`],
}));

// ---------------------------------------------------------------- 木材家族

/**
 * 除橡木之外的 5 种木材，每种派生 5 个方块：原木 / 木板 / 树叶 / 台阶 / 楼梯。
 *
 * id 从 102 起按「每种木头连续 5 个」分配；橡木（5/6/7 以及已有的台阶楼梯）保持原 id 不动。
 * 这种**追加式布局**的意义在于：以后再加木材只需要往 WOOD_TYPES 加一行，不会打乱既有编号。
 */
export const WOOD_BLOCK_ID_START = 102;

export interface WoodBlockIds {
  readonly log: number;
  readonly planks: number;
  readonly leaves: number;
  readonly slab: number;
  readonly stairs: number;
}

const EXTRA_WOODS = WOOD_TYPES.filter((wood) => wood.name !== 'oak');

const WOOD_ID_MAP = new Map<string, WoodBlockIds>();
const WOOD_SPECS: readonly BlockSpec[] = EXTRA_WOODS.flatMap((wood, index) => {
  const base = WOOD_BLOCK_ID_START + index * 5;
  const ids: WoodBlockIds = {
    log: base,
    planks: base + 1,
    leaves: base + 2,
    slab: base + 3,
    stairs: base + 4,
  };
  WOOD_ID_MAP.set(wood.name, ids);

  const plankTile = `${wood.name}_planks`;
  return [
    {
      id: ids.log,
      name: `minecraft:${wood.name}_log`,
      tiles: [`${wood.name}_log_top`, `${wood.name}_log_top`, `${wood.name}_log_side`],
    },
    { id: ids.planks, name: `minecraft:${wood.name}_planks`, tiles: [plankTile, plankTile, plankTile] },
    {
      id: ids.leaves,
      name: `minecraft:${wood.name}_leaves`,
      tiles: [`${wood.name}_leaves`, `${wood.name}_leaves`, `${wood.name}_leaves`],
      lightOpacity: 1,
      // 与橡树树叶同一条：不透明但**不致窒息**
      suffocates: false,
    },
    {
      id: ids.slab,
      name: `minecraft:${wood.name}_planks_slab`,
      tiles: [plankTile, plankTile, plankTile],
      shape: 'slab' as const,
      opaque: false,
      lightOpacity: 0,
    },
    {
      id: ids.stairs,
      name: `minecraft:${wood.name}_planks_stairs`,
      tiles: [plankTile, plankTile, plankTile],
      shape: 'stairs' as const,
      opaque: false,
      lightOpacity: 0,
    },
  ];
});

/** 取某种木材的 5 个方块 id；未知木材返回 undefined */
export function woodBlocks(name: string): WoodBlockIds | undefined {
  return WOOD_ID_MAP.get(name);
}

/** 木材方块 id 的具名入口（配方与测试用；与 WOOD_SPECS 同源，不会写错） */
export const Wood: Readonly<Record<string, WoodBlockIds>> = Object.fromEntries(
  EXTRA_WOODS.map((wood) => [wood.name, WOOD_ID_MAP.get(wood.name)!]),
);

// ---------------------------------------------------------------- 木制方块族（栅栏 / 栅栏门 / 门 / 活板门）

/**
 * 木制方块族：每种木材的**栅栏 / 栅栏门 / 门 / 活板门**。
 *
 * 橡木那四件是历史方块（栅栏 96、门 99、活板门 289、栅栏门 290），保持原 id 不动；
 * 其余 5 种木材接在**当前最大 id 之后**（313 起，每种连续 4 个）。
 * 与 `WOOD_BLOCK_ID_START` 同样的理由：追加式布局，加木材不会打乱既有编号
 * （存档里存的就是这些数字）。
 *
 * ⚠️ 这四件**形状全部是现成的**（`fence` / `fence_gate` / `door` / `trapdoor`），
 * 贴图也只有门 / 活板门 / 栅栏门三张需要按木材配色生成（栅栏直接复用木板贴图）——
 * 所以"补一族的其它木材"是纯表驱动的工作量，这也是 B16 批量推进的意义所在。
 */
export const WOOD_SHAPED_ID_START = 313;

export interface WoodShapedIds {
  readonly fence: number;
  readonly fenceGate: number;
  readonly door: number;
  readonly trapdoor: number;
}

/** 橡木四件的历史 id（与 `Block` 枚举同源，这里写常量是为了在枚举定义之前就能用） */
const OAK_WOOD_SHAPED: WoodShapedIds = { fence: 96, fenceGate: 290, door: 99, trapdoor: 289 };

const WOOD_SHAPED_MAP = new Map<string, WoodShapedIds>();

const WOOD_SHAPED_SPECS: readonly BlockSpec[] = (() => {
  const specs: BlockSpec[] = [];
  let base = WOOD_SHAPED_ID_START;
  for (const wood of WOOD_TYPES) {
    if (wood.name === 'oak') {
      // 橡木沿用历史 id，不占新段
      WOOD_SHAPED_MAP.set(wood.name, OAK_WOOD_SHAPED);
      continue;
    }
    const ids: WoodShapedIds = { fence: base, fenceGate: base + 1, door: base + 2, trapdoor: base + 3 };
    base += 4;
    WOOD_SHAPED_MAP.set(wood.name, ids);

    const plankTile = `${wood.name}_planks`;
    const gateTile = `${wood.name}_fence_gate`;
    const doorTile = `${wood.name}_door`;
    const trapdoorTile = `${wood.name}_trapdoor`;
    specs.push(
      {
        id: ids.fence,
        name: `minecraft:${wood.name}_fence`,
        tiles: [plankTile, plankTile, plankTile],
        shape: 'fence',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.fenceGate,
        name: `minecraft:${wood.name}_fence_gate`,
        tiles: [gateTile, gateTile, gateTile],
        shape: 'fence_gate',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.door,
        name: `minecraft:${wood.name}_door`,
        tiles: [doorTile, doorTile, doorTile],
        shape: 'door',
        opaque: false,
        lightOpacity: 0,
      },
      {
        id: ids.trapdoor,
        name: `minecraft:${wood.name}_trapdoor`,
        tiles: [trapdoorTile, trapdoorTile, trapdoorTile],
        shape: 'trapdoor',
        opaque: false,
        lightOpacity: 0,
      },
    );
  }
  return specs;
})();

/** 某种木材的 4 件木制方块 id；未知木材返回 undefined */
export function woodShaped(name: string): WoodShapedIds | undefined {
  return WOOD_SHAPED_MAP.get(name);
}

/**
 * 全部木材的木制方块 id（可燃表 / 工具加速表 / 创造分类 / 配方批量遍历用）。
 * 含橡木——它的 id 是历史值，但"这一族"必须一起走，否则又会出现
 * "云杉栅栏可燃、橡木栅栏不可燃"这种半残状态。
 */
export const WoodShaped: Readonly<Record<string, WoodShapedIds>> = Object.fromEntries(WOOD_SHAPED_MAP);

// ---------------------------------------------------------------- 陶瓦与混凝土

export const TERRACOTTA_ID_START = 127;
export const CONCRETE_ID_START = 144;
/**
 * 混凝土粉末（批次 131）：**挨到水就变成上面那 16 个混凝土**（颜色一一对应）。
 *
 * 放在 557 之后（那是当时的末尾）：方块 id 一路是"新族追加在末尾"，
 * 往中间插会让存档里的 id 全部错位。
 */
export const CONCRETE_POWDER_ID_START = 558;

/**
 * 陶瓦与混凝土：都是 16 色 + 陶瓦多一个原色。
 * 陶瓦偏土、有颗粒感；混凝土是纯色 + 极细的杂点，两者观感差异明显。
 */
const COLORED_SPECS: readonly BlockSpec[] = [
  {
    id: TERRACOTTA_ID_START,
    name: 'minecraft:terracotta',
    tiles: ['terracotta', 'terracotta', 'terracotta'],
  },
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: TERRACOTTA_ID_START + 1 + index,
      name: `minecraft:${color.name}_terracotta`,
      tiles: [`terracotta_${color.name}`, `terracotta_${color.name}`, `terracotta_${color.name}`],
    }),
  ),
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: CONCRETE_ID_START + index,
      name: `minecraft:${color.name}_concrete`,
      tiles: [`concrete_${color.name}`, `concrete_${color.name}`, `concrete_${color.name}`],
    }),
  ),
  // 混凝土**粉末**（批次 131）：16 色，挨到水就凝固成上面那种混凝土（见 `world/Concrete.ts`）。
  // 它的贴图是"沙砾感的粉"，与混凝土那种纯色一眼分得开——原版也是这样区分这两兄弟的
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: CONCRETE_POWDER_ID_START + index,
      name: `minecraft:${color.name}_concrete_powder`,
      tiles: [
        `concrete_powder_${color.name}`,
        `concrete_powder_${color.name}`,
        `concrete_powder_${color.name}`,
      ],
    }),
  ),
];

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

export const STONE_EXTRA_ID_START = 160;
export const STAINED_GLASS_ID_START = 168;
export const GLASS_PANE_ID = 184;
export const STAINED_GLASS_PANE_ID_START = 185;

/** 第 index 种颜色的染色玻璃 id */
export function stainedGlassId(colorIndex: number): number {
  return STAINED_GLASS_ID_START + colorIndex;
}

/** 第 index 种颜色的染色玻璃板 id */
export function stainedGlassPaneId(colorIndex: number): number {
  return STAINED_GLASS_PANE_ID_START + colorIndex;
}

const GLASS_AND_STONE_SPECS: readonly BlockSpec[] = [
  // ---- 石材补全（苔石 / 裂纹变体）
  { id: 160, name: 'minecraft:mossy_cobblestone', tiles: ['mossy_cobblestone', 'mossy_cobblestone', 'mossy_cobblestone'] },
  { id: 161, name: 'minecraft:mossy_stone_bricks', tiles: ['mossy_stone_bricks', 'mossy_stone_bricks', 'mossy_stone_bricks'] },
  { id: 162, name: 'minecraft:cracked_stone_bricks', tiles: ['cracked_stone_bricks', 'cracked_stone_bricks', 'cracked_stone_bricks'] },
  { id: 163, name: 'minecraft:cracked_deepslate_bricks', tiles: ['cracked_deepslate_bricks', 'cracked_deepslate_bricks', 'cracked_deepslate_bricks'] },
  { id: 164, name: 'minecraft:cobbled_deepslate', tiles: ['cobbled_deepslate', 'cobbled_deepslate', 'cobbled_deepslate'] },

  // ---- 砂岩变体
  { id: 165, name: 'minecraft:chiseled_sandstone', tiles: ['chiseled_sandstone', 'sandstone', 'chiseled_sandstone'] },
  { id: 166, name: 'minecraft:cut_sandstone', tiles: ['cut_sandstone', 'sandstone', 'cut_sandstone'] },
  { id: 167, name: 'minecraft:smooth_sandstone', tiles: ['smooth_sandstone', 'smooth_sandstone', 'smooth_sandstone'] },

  // ---- 染色玻璃（半透明整块）+ 玻璃板（薄片，连接方向由邻居实时决定）
  { id: GLASS_PANE_ID, name: 'minecraft:glass_pane', tiles: ['glass', 'glass', 'glass'], shape: 'pane' as const, opaque: false, translucent: true },
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: STAINED_GLASS_ID_START + index,
      name: `minecraft:${color.name}_stained_glass`,
      tiles: [`stained_glass_${color.name}`, `stained_glass_${color.name}`, `stained_glass_${color.name}`],
      opaque: false,
      translucent: true,
    }),
  ),
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: STAINED_GLASS_PANE_ID_START + index,
      name: `minecraft:${color.name}_stained_glass_pane`,
      tiles: [`stained_glass_${color.name}`, `stained_glass_${color.name}`, `stained_glass_${color.name}`],
      shape: 'pane' as const,
      opaque: false,
      translucent: true,
    }),
  ),

  // ---- 粗金属块（1.18 大矿脉里的稀有伴生方块）
  { id: 201, name: 'minecraft:raw_copper_block', tiles: ['raw_copper_block', 'raw_copper_block', 'raw_copper_block'] },
  { id: 202, name: 'minecraft:raw_iron_block', tiles: ['raw_iron_block', 'raw_iron_block', 'raw_iron_block'] },
];

// ---------------------------------------------------------------- 台阶 / 楼梯

/**
 * 有台阶与楼梯变体的母方块：[母方块 id, 命名前缀]。
 * 顺序决定 slabId / stairsId 的取值，改动顺序会导致存档不兼容。
 */
export const SHAPED_PARENTS: readonly (readonly [number, string])[] = [
  [1, 'stone'],
  [8, 'cobblestone'],
  [7, 'oak_planks'],
  [20, 'sandstone'],
  [62, 'stone_bricks'],
  [64, 'smooth_stone'],
  [65, 'polished_granite'],
  [66, 'polished_diorite'],
  [67, 'polished_andesite'],
  [68, 'deepslate_bricks'],
  [70, 'bricks'],
  [71, 'polished_deepslate'],
];

export const SLAB_ID_START = 72;
export const STAIRS_ID_START = 84;

export function slabId(parentIndex: number): number {
  return SLAB_ID_START + parentIndex;
}

export function stairsId(parentIndex: number): number {
  return STAIRS_ID_START + parentIndex;
}

/**
 * 从**基础定义**里取母方块的贴图（此时 `BLOCKS` 还没构建，只能查 `SPECS`）。
 *
 * ⚠️ 只查 `BASE_SPECS`，而且**查不到就抛错**：早先这里回退成 `['stone','stone','stone']`，
 * 于是"母方块不在 BASE_SPECS 里"会变成"台阶/墙长着石头的贴图"——
 * 方块表、名称、配方全都正常，只有外观错，属于最难查的一类。
 * 需要查 160 号之后的方块用下面的 `tilesOfDefined`。
 */
function baseTiles(id: number): readonly [string, string, string] {
  const spec = BASE_SPECS.find((candidate) => candidate.id === id);
  if (!spec?.tiles) throw new Error(`baseTiles: 母方块 ${id} 不在 BASE_SPECS 里（该用 tilesOfDefined）`);
  return spec.tiles;
}

/**
 * 台阶与楼梯同母方块共用贴图，且都是**非完整方块**：
 * opaque=false 让相邻方块的面正常渲染（台阶上方是空的），lightOpacity=0 让光自由通过。
 */
const SHAPED_SPECS: readonly BlockSpec[] = SHAPED_PARENTS.flatMap(([parentId, name], index) => {
  const tiles = baseTiles(parentId);
  return [
    {
      id: SLAB_ID_START + index,
      name: `minecraft:${name}_slab`,
      tiles,
      shape: 'slab' as const,
      opaque: false,
      lightOpacity: 0,
    },
    {
      id: STAIRS_ID_START + index,
      name: `minecraft:${name}_stairs`,
      tiles,
      shape: 'stairs' as const,
      opaque: false,
      lightOpacity: 0,
    },
  ];
});

// ---------------------------------------------------------------- 栅栏 / 墙 / 门 / 火把 / 梯子

const FUNCTIONAL_SHAPED_SPECS: readonly BlockSpec[] = [
  {
    id: 96,
    name: 'minecraft:oak_fence',
    tiles: baseTiles(7),
    shape: 'fence',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 97,
    name: 'minecraft:cobblestone_wall',
    tiles: baseTiles(8),
    shape: 'wall',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 98,
    name: 'minecraft:stone_brick_wall',
    tiles: baseTiles(62),
    shape: 'wall',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 99,
    name: 'minecraft:oak_door',
    tiles: ['oak_door', 'oak_door', 'oak_door'],
    shape: 'door',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 100,
    name: 'minecraft:torch',
    tiles: ['torch', 'torch', 'torch'],
    shape: 'torch',
    solid: false,
    opaque: false,
    light: 14,
    lightOpacity: 0,
  },
  {
    id: 101,
    name: 'minecraft:ladder',
    tiles: ['ladder', 'ladder', 'ladder'],
    shape: 'ladder',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 自然装饰（地物）
//
// 植物统一用 `cross` 形状（两片交叉薄面、无碰撞），仙人掌用 `cactus` 形状（内缩 1 像素的立方体）。
// 它们都是**不遮挡**的（opaque=false）——否则长在草方块上的花会把脚下的草地剔掉一面。

export const DECORATION_ID_START = 203;

/**
 * 植物方块。
 * @param id 方块 id
 * @param name 名称（不含命名空间）
 * @param tile 贴图名（三面同一个）
 */
function plantSpec(id: number, name: string, tile: string): BlockSpec {
  return {
    id,
    name: `minecraft:${name}`,
    tiles: [tile, tile, tile],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    shape: 'cross',
  };
}

const DECORATION_SPECS: readonly BlockSpec[] = [
  plantSpec(203, 'short_grass', 'short_grass'),
  plantSpec(204, 'fern', 'fern'),
  plantSpec(205, 'dandelion', 'dandelion'),
  plantSpec(206, 'poppy', 'poppy'),
  plantSpec(207, 'blue_orchid', 'blue_orchid'),
  plantSpec(208, 'oxeye_daisy', 'oxeye_daisy'),
  plantSpec(209, 'cornflower', 'cornflower'),
  plantSpec(210, 'red_mushroom', 'red_mushroom'),
  plantSpec(211, 'brown_mushroom', 'brown_mushroom'),
  plantSpec(212, 'sugar_cane', 'sugar_cane'),
  plantSpec(216, 'dead_bush', 'dead_bush'),
  plantSpec(217, 'bamboo', 'bamboo'),
  {
    id: 213,
    name: 'minecraft:pumpkin',
    tiles: ['pumpkin_top', 'pumpkin_top', 'pumpkin_side'],
  },
  {
    id: 214,
    name: 'minecraft:melon',
    tiles: ['melon_top', 'melon_top', 'melon_side'],
  },
  {
    id: 215,
    name: 'minecraft:cactus',
    tiles: ['cactus_top', 'cactus_top', 'cactus_side'],
    opaque: false,
    lightOpacity: 0,
    shape: 'cactus' as const,
  },
];

/** 海晶石家族（海底神殿用） */
const PRISMARINE_SPECS: readonly BlockSpec[] = [
  { id: 218, name: 'minecraft:prismarine', tiles: ['prismarine', 'prismarine', 'prismarine'] },
  { id: 219, name: 'minecraft:prismarine_bricks', tiles: ['prismarine_bricks', 'prismarine_bricks', 'prismarine_bricks'] },
  { id: 220, name: 'minecraft:dark_prismarine', tiles: ['dark_prismarine', 'dark_prismarine', 'dark_prismarine'] },
  {
    id: 221,
    name: 'minecraft:sea_lantern',
    tiles: ['sea_lantern', 'sea_lantern', 'sea_lantern'],
    light: 15,
  },
];

// ---------------------------------------------------------------- 下界
//
// 下界方块全部走同一竖列 id，下界地形生成器按这些 id 直接写方块。
// 菌柄（stem）与主世界原木结构一致，只是配色偏紫红 / 青蓝。

const NETHER_SPECS: readonly BlockSpec[] = [
  { id: 222, name: 'minecraft:netherrack', tiles: ['netherrack', 'netherrack', 'netherrack'] },
  { id: 223, name: 'minecraft:soul_sand', tiles: ['soul_sand', 'soul_sand', 'soul_sand'] },
  { id: 224, name: 'minecraft:soul_soil', tiles: ['soul_soil', 'soul_soil', 'soul_soil'] },
  { id: 225, name: 'minecraft:basalt', tiles: ['basalt_top', 'basalt_top', 'basalt_side'] },
  { id: 226, name: 'minecraft:smooth_basalt', tiles: ['smooth_basalt', 'smooth_basalt', 'smooth_basalt'] },
  { id: 227, name: 'minecraft:blackstone', tiles: ['blackstone', 'blackstone', 'blackstone'] },
  {
    id: 228,
    name: 'minecraft:magma_block',
    tiles: ['magma', 'magma', 'magma'],
    light: 3,
  },
  { id: 229, name: 'minecraft:crimson_nylium', tiles: ['crimson_nylium', 'netherrack', 'crimson_nylium_side'] },
  { id: 230, name: 'minecraft:warped_nylium', tiles: ['warped_nylium', 'netherrack', 'warped_nylium_side'] },
  { id: 231, name: 'minecraft:crimson_stem', tiles: ['crimson_stem_top', 'crimson_stem_top', 'crimson_stem_side'] },
  { id: 232, name: 'minecraft:warped_stem', tiles: ['warped_stem_top', 'warped_stem_top', 'warped_stem_side'] },
  { id: 233, name: 'minecraft:crimson_planks', tiles: ['crimson_planks', 'crimson_planks', 'crimson_planks'] },
  { id: 234, name: 'minecraft:warped_planks', tiles: ['warped_planks', 'warped_planks', 'warped_planks'] },
  plantSpec(235, 'crimson_fungus', 'crimson_fungus'),
  plantSpec(236, 'warped_fungus', 'warped_fungus'),
  { id: 237, name: 'minecraft:nether_wart_block', tiles: ['nether_wart_block', 'nether_wart_block', 'nether_wart_block'] },
  {
    id: 238,
    name: 'minecraft:warped_wart_block',
    tiles: ['warped_wart_block', 'warped_wart_block', 'warped_wart_block'],
  },
  {
    id: 239,
    name: 'minecraft:shroomlight',
    tiles: ['shroomlight', 'shroomlight', 'shroomlight'],
    light: 15,
  },
  { id: 240, name: 'minecraft:nether_bricks', tiles: ['nether_bricks', 'nether_bricks', 'nether_bricks'] },
  {
    id: 241,
    name: 'minecraft:nether_quartz_ore',
    tiles: ['nether_quartz_ore', 'nether_quartz_ore', 'nether_quartz_ore'],
  },
  { id: 242, name: 'minecraft:ancient_debris', tiles: ['ancient_debris', 'ancient_debris', 'ancient_debris'] },
  plantSpec(243, 'crimson_roots', 'crimson_roots'),
  plantSpec(244, 'warped_roots', 'warped_roots'),
  plantSpec(245, 'nether_sprouts', 'nether_sprouts'),
];

// ---------------------------------------------------------------- 末地
//
// 末地的方块数不多（末地石 / 末地石砖 / 紫珀家族 / 紫颂 / 末地烛 / 龙蛋 / 传送门），
// 但紫颂植株与紫颂花是末地独有的"树"，末地城与末地船则全靠紫珀和末地石砖搭。
//
// ⚠️ 紫珀与末地石砖**没有台阶/楼梯变体**：SHAPED_PARENTS 的 slab/stairs id 区间
// 与后面的栅栏/装饰 id 紧挨着，追加母方块会撞 id（见 blocks.ts 里 SHAPED_PARENTS 的注释）。
// 末地城因此用整块搭建，已在 TASKS.md 记录这个取舍。

const END_SPECS: readonly BlockSpec[] = [
  { id: 246, name: 'minecraft:end_stone', tiles: ['end_stone', 'end_stone', 'end_stone'] },
  { id: 247, name: 'minecraft:end_stone_bricks', tiles: ['end_stone_bricks', 'end_stone_bricks', 'end_stone_bricks'] },
  { id: 248, name: 'minecraft:purpur_block', tiles: ['purpur_block', 'purpur_block', 'purpur_block'] },
  {
    id: 249,
    name: 'minecraft:purpur_pillar',
    tiles: ['purpur_pillar_top', 'purpur_pillar_top', 'purpur_pillar_side'],
  },
  plantSpec(250, 'chorus_plant', 'chorus_plant'),
  plantSpec(251, 'chorus_flower', 'chorus_flower'),
  {
    id: 252,
    name: 'minecraft:end_rod',
    tiles: ['end_rod', 'end_rod', 'end_rod'],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 14,
    shape: 'cross',
  },
  { id: 253, name: 'minecraft:dragon_egg', tiles: ['dragon_egg', 'dragon_egg', 'dragon_egg'] },
  {
    id: 254,
    name: 'minecraft:end_portal_frame',
    // 插了眼的那一格**顶面换一张**（凹槽里亮起一颗眼睛）。侧/底面始终是石框：
    // 眼睛只画在顶面上——原版就是这样（框架是一块"朝上的凹槽"）
    tiles: ['end_portal_frame', 'end_portal_frame', 'end_portal_frame'],
    stateTiles: (state) =>
      hasEndPortalEye(state)
        ? ['end_portal_frame_eye', 'end_portal_frame', 'end_portal_frame']
        : ['end_portal_frame', 'end_portal_frame', 'end_portal_frame'],
  },
  {
    id: 255,
    name: 'minecraft:end_portal',
    tiles: ['end_portal', 'end_portal', 'end_portal'],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 15,
  },
];

// ---------------------------------------------------------------- 红石元件
//
// 红石方块分两类：
//  - **电源与传输**：红石粉（贴地薄板）、红石火把、红石块、拉杆、按钮、压力板、中继器、比较器
//  - **执行器**：红石灯（亮/灭两套贴图 + 发光等级）、活塞 / 粘性活塞（伸出时在前方放一个活塞头）
//
// 信号强度**不存在方块状态里**，而是由 `core/redstone/RedstoneEngine.ts` 在运行时维护
// （方块状态只有 8 位，还要留给朝向与延迟；强度是易变的中间量，没必要落盘）。
// 状态位只用来记"元件的持久状态"：通电/按下（bit3）、朝向（bit1-2）、中继器延迟（bit4-5）。

const REDSTONE_SPECS: readonly BlockSpec[] = [
  {
    id: 256,
    name: 'minecraft:redstone_wire',
    tiles: ['redstone_wire', 'redstone_wire', 'redstone_wire'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 257,
    name: 'minecraft:redstone_torch',
    tiles: ['redstone_torch', 'redstone_torch', 'redstone_torch'],
    shape: 'torch',
    solid: false,
    opaque: false,
    lightOpacity: 0,
    light: 7,
  },
  { id: 258, name: 'minecraft:redstone_block', tiles: ['redstone_block', 'redstone_block', 'redstone_block'] },
  {
    id: 259,
    name: 'minecraft:lever',
    tiles: ['lever', 'lever', 'lever'],
    shape: 'torch',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 260,
    name: 'minecraft:stone_button',
    tiles: ['stone_button', 'stone_button', 'stone_button'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 261,
    name: 'minecraft:oak_button',
    tiles: ['oak_button', 'oak_button', 'oak_button'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 262,
    name: 'minecraft:stone_pressure_plate',
    tiles: ['stone_pressure_plate', 'stone_pressure_plate', 'stone_pressure_plate'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 263,
    name: 'minecraft:oak_pressure_plate',
    tiles: ['oak_pressure_plate', 'oak_pressure_plate', 'oak_pressure_plate'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 264,
    name: 'minecraft:repeater',
    tiles: ['repeater', 'repeater', 'repeater'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 265,
    name: 'minecraft:comparator',
    tiles: ['comparator', 'comparator', 'comparator'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 266,
    name: 'minecraft:redstone_lamp',
    tiles: ['redstone_lamp', 'redstone_lamp', 'redstone_lamp'],
    // 亮起的红石灯换成发光贴图，并把方块光拉到 15——这是"红石能点亮房间"的关键
    stateTiles: (state) =>
      isPowered(state)
        ? ['redstone_lamp_on', 'redstone_lamp_on', 'redstone_lamp_on']
        : ['redstone_lamp', 'redstone_lamp', 'redstone_lamp'],
    stateLight: (state) => (isPowered(state) ? 15 : 0),
  },
  {
    id: 267,
    name: 'minecraft:piston',
    // 批次 65：推板（`piston_top`）只贴在**推出方向那一面**，其余五面是活塞身。
    // 在此之前推板同时贴在顶面与底面（那时没有朝向贴图能力，只能"上下都画一个"）
    tiles: ['piston_side', 'piston_side', 'piston_side'],
    faceTile: nozzleTile('piston_top'),
    // 批次 66：活塞支持上下（引擎侧也补齐了），所以用"潜行指定六向"这条规则
    facesSneak: true,
  },
  {
    id: 268,
    name: 'minecraft:piston_head',
    tiles: ['piston_head', 'piston_head', 'piston_head'],
    // 批次 68：活塞头是**技术方块**（活塞伸出时才出现），原版**没有对应物品**——
    // 不给它物品，背包里就不会出现"一个孤零零的活塞头"、也无法凭空放出来。
    // 朝向由活塞写进去（六向，见 B40），贴图/几何都跟着它走。
    itemless: true,
  },
  {
    id: 269,
    name: 'minecraft:sticky_piston',
    tiles: ['piston_side', 'piston_side', 'piston_side'],
    faceTile: nozzleTile('sticky_piston_top'),
    facesSneak: true,
  },
  {
    id: 270,
    name: 'minecraft:observer',
    // 批次 65：**眼**贴在"看的那一面"（引擎里 `facing` 指的就是它）、
    // **红点**贴在对面的"输出面"（`componentOutput` 给的正是 `facing + 2`），其余四面是石壳。
    // 在此之前那只眼贴在顶面与底面——而侦测器看哪边完全看不出来
    tiles: ['observer_side', 'observer_side', 'observer_side'],
    faceTile: observerFace,
    facesSneak: true,
  },
  // ---- 附魔与书架（H9）
  {
    // 附魔台：原版只有 0.75 格高（底部一圈黑曜石 + 上面一本书）。
    // ⚠️ 简化成**整格方块**：新增一种"矮方块"形状要同时改碰撞盒、网格化与放置逻辑，
    // 与它带来的收益不成比例（见 TASKS H9 的说明）
    id: 271,
    name: 'minecraft:enchanting_table',
    tiles: ['enchanting_table_top', 'obsidian', 'enchanting_table_side'],
  },
  {
    id: 272,
    name: 'minecraft:bookshelf',
    tiles: ['oak_planks', 'oak_planks', 'bookshelf'],
  },
  // ---- 铁砧（H8）
  {
    // 铁砧原版有朝向与"落地受损"两种状态（受损后第三次使用会毁掉），
    // 这里只做**单一方块**：朝向要用方块状态（B4 的旋转变体那套），
    // 落地受损则要方块状态里再存一个"损伤度"，都留给后续。
    id: 273,
    name: 'minecraft:anvil',
    tiles: ['anvil_top', 'iron_block', 'anvil_side'],
  },
  {
    // 铁块：铁砧的配方材料。此前项目里只有"粗铁块"，而铁块是原版最基础的储物方块之一
    id: 274,
    name: 'minecraft:iron_block',
    tiles: ['iron_block', 'iron_block', 'iron_block'],
  },
  // ---- 农业（H13）：耕地与小麦（4 个生长阶段各占一个 id）
  // 用"一个阶段一个 id"而不是方块状态：贴图是按 id 静态查的（`blockDef(id).tiles`），
  // 状态化就要改网格化与图集两处；而 id 在这套代码里本来就充裕（台阶/楼梯/16 色都是批量生成）。
  {
    id: 275,
    name: 'minecraft:farmland',
    tiles: ['farmland', 'dirt', 'farmland_side'],
    // ⚠️ 原版耕地是 15/16 高、而且踩上去会"退化"回泥土；这里先做成整格、不退化
    solid: true,
    opaque: true,
  },
  plantSpec(276, 'wheat_stage0', 'wheat_stage0'),
  plantSpec(277, 'wheat_stage1', 'wheat_stage1'),
  plantSpec(278, 'wheat_stage2', 'wheat_stage2'),
  plantSpec(279, 'wheat_stage3', 'wheat_stage3'),
  {
    id: 288,
    name: 'minecraft:brewing_stand',
    // 三段贴图：顶面（放药水的台面）/ 底面 / 侧面（石座 + 一根烈焰棒）
    tiles: ['brewing_stand_top', 'brewing_stand_bottom', 'brewing_stand_side'],
    solid: true,
    opaque: true,
  },
  plantSpec(280, 'carrots_stage0', 'carrots_stage0'),
  plantSpec(281, 'carrots_stage1', 'carrots_stage1'),
  plantSpec(282, 'carrots_stage2', 'carrots_stage2'),
  plantSpec(283, 'carrots_stage3', 'carrots_stage3'),
  plantSpec(284, 'potatoes_stage0', 'potatoes_stage0'),
  plantSpec(285, 'potatoes_stage1', 'potatoes_stage1'),
  plantSpec(286, 'potatoes_stage2', 'potatoes_stage2'),
  plantSpec(287, 'potatoes_stage3', 'potatoes_stage3'),
];



/**
 * 全部方块定义。
 * ⚠️ 必须按 id 升序排列：BLOCKS 是按数组下标索引的，顺序错位会让 blockDef(id) 取到别的方块。
 */
/**
 * 活板门与栅栏门（批次 30）。
 *
 * 两者都是"非立方体形状"家族的最后两块（见 B7）：形状定义在 `blockShapes.ts` 里，
 * 渲染与碰撞**共用同一份几何**（免得画一片板、撞在另一处）。
 * 状态位与门共用"开/关"那一位（见 `blockState.ts` 的说明）。
 */
const OPENABLE_SPECS: readonly BlockSpec[] = [
  {
    id: 289,
    name: 'minecraft:oak_trapdoor',
    tiles: ['oak_trapdoor', 'oak_trapdoor', 'oak_trapdoor'],
    shape: 'trapdoor',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 290,
    name: 'minecraft:oak_fence_gate',
    tiles: ['oak_fence_gate', 'oak_fence_gate', 'oak_fence_gate'],
    shape: 'fence_gate',
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 火焰（I12）。
 *
 * 形状借用了植物那套 `cross`（两片交叉薄面、无碰撞）——原版火焰其实有 4 张朝向不同的面，
 * 但 `cross` 已经能表达"站在草/木板上的火苗"，而新增一种形状要同时改网格化与碰撞两处。
 *
 * - **自发光 15**：火把是 14，火焰比火把更亮，这一点在夜里看得很明显
 * - **不生成物品**（见 `itemless`）：只能靠打火石点燃，背包里拿不到"一叠火"
 * - **硬度 0**：徒手一拍即灭（与原版一致——打火是瞬间的，灭也是）
 */
const FIRE_SPECS: readonly BlockSpec[] = [
  {
    id: 291,
    name: 'minecraft:fire',
    tiles: ['fire', 'fire', 'fire'],
    shape: 'cross',
    solid: false,
    opaque: false,
    light: 15,
    lightOpacity: 0,
    itemless: true,
  },
];

/**
 * 下界传送门方块（K8）。
 *
 * 形状上它就是一块"整格"，但**没有任何碰撞**（可以走进去）、**不遮挡**邻居、
 * 走**半透明渲染层**（紫色门面是半透明的，且两个门方块之间的内部面会被剔除，
 * 于是 2×3 的门面最终只是一面 1 格厚的紫色墙——与原版观感一致）。
 *
 * - **自发光 11**（原版数值）：门自己会照亮周围，夜里一眼就能看见
 * - **不生成物品**（见 `itemless`）：只能由黑曜石框点燃，背包里拿不到
 * - 状态位记"门面沿哪个水平轴"（见 `blockState.ts#portalAxis`），
 *   与状态无关的渲染（贴图滚动）在材质里做
 */
const PORTAL_SPECS: readonly BlockSpec[] = [
  {
    id: 292,
    name: 'minecraft:nether_portal',
    tiles: ['nether_portal', 'nether_portal', 'nether_portal'],
    solid: false,
    opaque: false,
    translucent: true,
    light: 11,
    lightOpacity: 0,
    itemless: true,
  },
];

/**
 * 下界合金（K8 尾巴）。
 *
 * - **下界合金块**：9 个下界合金锭合成的储物方块（与铁块/金块同一档硬度）
 * - **锻造台**：把钻石装备升级成下界合金装备的工作台。原版它有 `facing` 状态与
 *   "把物品放在台面上"的模型；这里和铁砧/附魔台一样**简化成整格方块**
 *   （理由同 H9：新增矮方块形状要同时改碰撞盒、网格化与放置逻辑，收益不成比例）
 */
const NETHERITE_SPECS: readonly BlockSpec[] = [
  { id: 293, name: 'minecraft:netherite_block', tiles: ['netherite_block', 'netherite_block', 'netherite_block'] },
  {
    id: 294,
    name: 'minecraft:smithing_table',
    tiles: ['smithing_table_top', 'oak_planks', 'smithing_table_side'],
  },
];

/**
 * 睡莲（B16）：水面上的薄叶片。
 *
 * 形状是 `lily_pad`（1/16 薄板 + **有碰撞**，见 `blockShapes.ts`）——
 * 与红石粉那批 `flat` 的唯一区别就是能站上去。
 * 走**半透明层**：贴图四角是透明的（叶片是个圆盘），必须 alpha 混合而不是 alphaTest，
 * 否则叶片边缘会出现硬锯齿；它也只有 1/16 高，与水面挨着时不会有明显的排序问题。
 */
const LILY_PAD_SPECS: readonly BlockSpec[] = [
  {
    id: 295,
    name: 'minecraft:lily_pad',
    tiles: ['lily_pad', 'lily_pad', 'lily_pad'],
    shape: 'lily_pad',
    solid: false,
    opaque: false,
    translucent: true,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 地毯与雪层（批次 37）
//
// 这一批是"方块族批量推进"（B16）的第一块：地毯按 16 色配色表生成，
// 雪层则给"雪原＝一片白"这件事补上真正的地表装饰（D14 / K11 的尾巴）。

/** 地毯 id 起始值：16 色连续排列，顺序与 DYE_COLORS 一致 */
export const CARPET_ID_START = 296;

/** 雪层（1~8 层，层数存在方块状态里；见 `blockState.ts#snowLayers`） */
export const SNOW_LAYER_ID = 312;

/**
 * 地毯（16 色）。
 *
 * 形状**直接复用"贴地薄板" `flat`**（1/16 高、无碰撞）：原版地毯本来就不挡路，
 * 与红石粉 / 压力板是同一套几何与同一套物理，所以不必新开形状。
 * ——与睡莲那条经验正好相反：睡莲"几何相同但能站上去"，物理不同，才必须拆成 `lily_pad`。
 *
 * `solid: false` 是必须的：`World.collisionAt` 见到 `!def.solid` 直接返回 null，
 * 而地毯在原版确实踩得过去（它的碰撞盒本来就是空的）。
 */
const CARPET_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color, index) => ({
  id: CARPET_ID_START + index,
  name: `minecraft:${color.name}_carpet`,
  tiles: [`carpet_${color.name}`, `carpet_${color.name}`, `carpet_${color.name}`],
  shape: 'flat' as const,
  solid: false,
  opaque: false,
  lightOpacity: 0,
}));
/** 带釉陶瓦（批次 385）：16 色，由同色陶瓦烧制 */
const GLAZED_TERRACOTTA_SPECS: readonly BlockSpec[] = DYE_COLORS.map(
  (color, index): BlockSpec => ({
    id: 624 + index,
    name: `minecraft:${color.name}_glazed_terracotta`,
    tiles: [
      `glazed_terracotta_${color.name}`,
      `glazed_terracotta_${color.name}`,
      `glazed_terracotta_${color.name}`,
    ] as const,
  }),
);

/** 蜡烛（批次 382）：17 色，扁平、可放在地面上，光照 3 */
const CANDLE_SPECS: readonly BlockSpec[] = [
  {
    id: 607,
    name: 'minecraft:candle',
    tiles: ['candle', 'candle', 'candle'] as const,
    shape: 'flat' as const,
    solid: false,
    opaque: false,
    light: 3,
    lightOpacity: 0,
  },
  ...DYE_COLORS.map(
    (color, index): BlockSpec => ({
      id: 608 + index,
      name: `minecraft:${color.name}_candle`,
      tiles: [`candle_${color.name}`, `candle_${color.name}`, `candle_${color.name}`] as const,
      shape: 'flat' as const,
      solid: false,
      opaque: false,
      light: 3,
      lightOpacity: 0,
    }),
  ),
];


/**
 * 雪层（B11 / K11）。
 *
 * 与"一个生长阶段一个 id"的小麦不同，雪层是**一个方块 + 状态位**：
 * 8 个阶段共用同一张贴图（`snow`），变的只有几何高度，
 * 而几何本来就吃状态（`meshBoxes(shape, state)`）——不需要为了 8 种高度多出 8 个 id。
 *
 * - **有碰撞**（所以 `solid` 保持默认 true，`collisionAt` 才会去算形状盒），
 *   高度 = 层数/8：1 层只有 1/8 格（直接走上去），8 层正好整格
 * - 不遮挡邻居（`opaque: false`、`lightOpacity: 0`）：雪层压在地上不该让草皮变暗
 * - 破坏掉落 **1 个雪球**（原版：不精准采集就掉雪球，与层数无关），精准采集掉自身
 */
const SNOW_SPECS: readonly BlockSpec[] = [
  {
    id: SNOW_LAYER_ID,
    name: 'minecraft:snow',
    tiles: ['snow', 'snow', 'snow'],
    shape: 'snow' as const,
    opaque: false,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 锁链与藤蔓（B11 收口）

/**
 * 锁链（B11）：3/16 粗的细柱，**轴向存在状态里**（竖着挂 / 沿 X / 沿 Z）。
 *
 * - **有碰撞**：原版 `ChainBlock` 的盒子是 3/16 见方（`box(6.5,0,6.5,9.5,16,9.5)`），照抄
 * - 不遮挡邻居、不挡光（挂在天花板上的锁链不该让下面变暗）
 * - **可以攀爬**（基岩版特性——本项目复刻的是基岩版，见 `PlayerPhysics` 的攀爬分支）
 * - 硬度 5、**必须用镐**（原版 `requiresCorrectToolForDrops`：徒手挖得动但什么都不掉）
 */
const CHAIN_SPECS: readonly BlockSpec[] = [
  {
    id: 333,
    name: 'minecraft:chain',
    tiles: ['chain', 'chain', 'chain'],
    shape: 'chain',
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 藤蔓（B11）：贴在方块侧面或天花板底下的薄片，**一个方块能同时挂 5 面**。
 *
 * - **没有碰撞**（原版穿得过去）、不遮挡邻居、不挡光
 * - **可以攀爬**（与梯子一样：按跳跃往上、按潜行往下）
 * - 硬度 0.2；**只有剪刀或精准采集才掉自身**，徒手/斧头打掉什么都不掉（原版规则）
 * - 可燃（原版藤蔓会烧）
 */
const VINE_SPECS: readonly BlockSpec[] = [
  {
    id: 334,
    name: 'minecraft:vine',
    tiles: ['vine', 'vine', 'vine'],
    shape: 'vine',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 铜的氧化（批次 40）

/**
 * 铜的四档氧化（原版 1.17 那条"铜会锈"的机制）。
 *
 * 每档 4 个方块：**铜块 / 切制铜 / 切制铜台阶 / 切制铜楼梯**，四档共 16 个。
 * id 从 `COPPER_ID_START` 起**每档连续 4 个**，档内顺序固定为
 * `[铜块, 切制铜, 台阶, 楼梯]`（见 `copperId(stage, kind)`）。
 *
 * ⚠️ **顺序即氧化顺序**：`core/world/Copper.ts` 就是按这张表的**下标**推进氧化的，
 * 往中间插一行会打乱既有的存档方块（老存档里的"斑驳铜块"会变成别的档），只能往末尾加。
 * 涂蜡变体（16 个）还没做——它要**蜜蜡**，而蜜蜡唯一的来源是蜂巢（蜜蜂没做），
 * 于是记进了 TASKS：要么等蜜蜂，要么先不做（"第一件原料从哪来"那条老经验）。
 */
export const COPPER_ID_START = 335;

/** 每档的贴图名与中文前缀（贴图、名字、配方都由它展开） */
export const COPPER_STAGES = [
  { blockTile: 'copper_block', cutTile: 'cut_copper' },
  { blockTile: 'exposed_copper', cutTile: 'exposed_cut_copper' },
  { blockTile: 'weathered_copper', cutTile: 'weathered_cut_copper' },
  { blockTile: 'oxidized_copper', cutTile: 'oxidized_cut_copper' },
] as const;

/** 档内四种形状的名字后缀（与 `copperId` 的第二维一一对应） */
const COPPER_SHAPES = [
  { suffix: '_block', cut: false },
  { suffix: '', cut: true },
  { suffix: '_slab', cut: true },
  { suffix: '_stairs', cut: true },
] as const;

/** 第 `stage` 档第 `kind` 种铜方块的 id：kind 0=铜块、1=切制铜、2=台阶、3=楼梯 */
export function copperId(stage: number, kind: 0 | 1 | 2 | 3): number {
  return COPPER_ID_START + stage * 4 + kind;
}

const COPPER_SPECS: readonly BlockSpec[] = COPPER_STAGES.flatMap((stage, index) =>
  COPPER_SHAPES.map((shape, kind): BlockSpec => {
    const tile = shape.cut ? stage.cutTile : stage.blockTile;
    const name = shape.cut
      ? `${stage.cutTile}${shape.suffix}` // cut_copper / cut_copper_slab / cut_copper_stairs
      : `${stage.blockTile}`; // copper_block / exposed_copper / ...
    const base: BlockSpec = {
      id: copperId(index, kind as 0 | 1 | 2 | 3),
      name: `minecraft:${name}`,
      tiles: [tile, tile, tile],
    };
    // 台阶与楼梯是非完整方块：不遮挡邻居、不挡光（与石材家族同一套写法）
    if (name.endsWith('_slab')) return { ...base, shape: 'slab', opaque: false, lightOpacity: 0 };
    if (name.endsWith('_stairs')) return { ...base, shape: 'stairs', opaque: false, lightOpacity: 0 };
    return base;
  }),
);
/** 旗帜（批次 386）：16 色，`cross` 形状（没有布面朝向，先用薄片表示） */
const BANNER_SPECS: readonly BlockSpec[] = DYE_COLORS.map(
  (color, index): BlockSpec => ({
    id: 640 + index,
    name: `minecraft:${color.name}_banner`,
    tiles: [`banner_${color.name}`, `banner_${color.name}`, `banner_${color.name}`] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  }),
);


// ---------------------------------------------------------------- 石英与更多石材（批次 42）

/**
 * 第二批"石材家族"的母方块：**石英家族 + 深板岩瓦 + 红色下界砖**。
 *
 * 它们与批次 41 的 16 个母方块共用同一张变体表（`STONE_VARIANT_PARENTS`），
 * 所以下面的 id 段紧跟变体段：
 *
 *   id 351 ~ 386：批次 41 的 36 个变体
 *   id 387 ~ 403：批次 42 新增的 17 个变体（石英 / 平滑石英 / 深板岩瓦 / 红色下界砖 / 海晶石三兄弟）
 *   id 404 ~ 409：**本段的 6 个母方块**（石英块 / 錾制石英块 / 石英柱 / 平滑石英 / 深板岩瓦 / 红色下界砖）
 *
 * ⚠️ 母方块的 id 写成常量而不是"变体段末尾接着排"：变体段的长度会随表变化，
 * 用运行时计算的话，往变体表里加一项就会把母方块的 id 整体挪一格（存档里存的正是这些数字）。
 * 套件里有一条断言守着"变体段不许溢进母方块段"。
 */
export const MORE_STONE_ID_START = 404;

const MORE_STONE_SPECS: readonly BlockSpec[] = [
  {
    id: 404,
    name: 'minecraft:quartz_block',
    tiles: ['quartz_block_top', 'quartz_block_top', 'quartz_block_side'],
  },
  { id: 405, name: 'minecraft:chiseled_quartz_block', tiles: ['chiseled_quartz_block', 'chiseled_quartz_block', 'chiseled_quartz_block'] },
  // 石英柱在原版有轴向（横竖两种）；本项目与紫珀柱一样**不做轴向状态**（避免为一个方块加一条状态通道）
  { id: 406, name: 'minecraft:quartz_pillar', tiles: ['quartz_pillar_top', 'quartz_pillar_top', 'quartz_pillar_side'] },
  { id: 407, name: 'minecraft:smooth_quartz', tiles: ['smooth_quartz', 'smooth_quartz', 'smooth_quartz'] },
  { id: 408, name: 'minecraft:deepslate_tiles', tiles: ['deepslate_tiles', 'deepslate_tiles', 'deepslate_tiles'] },
  { id: 409, name: 'minecraft:red_nether_bricks', tiles: ['red_nether_bricks', 'red_nether_bricks', 'red_nether_bricks'] },
];

// ---------------------------------------------------------------- 切石机（批次 44）

/**
 * 切石机（H11）。
 *
 * 原版把它做成"整块方块 + 台面上一条锯片"，**没有状态**（没有朝向、没有开关），
 * 所以这里就是一个普通的 cube：id 接在最大 id（409）之后。
 *
 * id 写成常量、不用"末尾接着排"：方块总数每批都在涨，
 * 而存档里存的就是这个数字（与 `MORE_STONE_ID_START` 同一条理由）。
 */
export const STONECUTTER_ID = 410;

const STONECUTTER_SPECS: readonly BlockSpec[] = [
  {
    id: STONECUTTER_ID,
    name: 'minecraft:stonecutter',
    // 贴图顺序与 BlockSpec.tiles 一致：[顶面, 底面, 侧面]
    tiles: ['stonecutter_top', 'stonecutter_bottom', 'stonecutter_side'],
  },
];

// ---------------------------------------------------------------- 红沙与红砂岩（批次 45）

/**
 * 红沙与红砂岩家族（批次 45，B23 的收尾）。
 *
 * 批次 42 把红砂岩家族记进了"不做"清单，理由是**原料从哪来**那条老规矩：
 * 红砂岩要红沙，而红沙只长在恶地。当时判断"本项目没有恶地"——这句其实是错的：
 * 恶地（`Biome.BADLANDS`）从地貌批次起就在，连彩色陶瓦色带都铺好了，
 * 缺的只是**地表那一层红沙**（原版恶地地表是红沙，陶瓦在它下面）。
 *
 * 所以这一批先补红沙、再让它长在恶地地表，红砂岩家族才真正成立：
 *
 *   id 411      红沙（普通 cube，可以徒手铲）
 *   id 412~415  红砂岩 / 錾制红砂岩 / 切制红砂岩 / 平滑红砂岩（4 个母方块）
 *   id 416~421  它们的 6 个变体（3 + 1 + 2，见下面的变体表）
 *
 * ⚠️ 变体的 id **不能靠顺序排**：变体段从 351 起顺序分配，第一批 23 个家族正好排到 403，
 * 后面 404~410 是写死的母方块常量（石英家族 + 切石机）。再往变体表末尾追加家族，
 * 顺序分配就会**撞进那一段**。所以这里给变体表加了"显式起点"这一列
 * （`RED_SANDSTONE_VARIANT_ID_START`），追加家族时把下一段的起点写清楚即可。
 */
export const RED_SAND_ID_START = 411;

/** 红砂岩家族变体的显式起点（见上面的注解：顺序分配会撞进写死的母方块段） */
export const RED_SANDSTONE_VARIANT_ID_START = 416;

// ---------------------------------------------------------------- 烟熏炉与高炉（批次 46）

/**
 * 烟熏炉与高炉（H6，批次 46）。
 *
 * 它们是**熔炉的两个变体**：原版三者的界面、格子布局、燃料规则完全一样，
 * 区别只有两条——**只吃一类东西**（烟熏炉吃食物、高炉吃矿物与金属）
 * 与**速度 2 倍**（10 秒 → 5 秒）。所以这一批的"方块"部分很薄，
 * 真正的东西在 `crafting/Smelting.ts` 的站台过滤与 `container/Furnace.ts` 的站台上。
 *
 * ⚠️ 三种炉子的**点燃外观**都没做（本项目熔炉一直没有 LIT 状态位与点火贴图）：
 * 方块贴图是静态的两张（顶 + 侧），炉子烧起来时看不出在烧。这条差异记在 TASKS H6 里。
 */
export const SMOKER_ID = 422;
export const BLAST_FURNACE_ID = 423;

/**
 * 营火（H11，批次 47）。
 *
 * 它是"炉子的第三种站台"，但有三处与三座炉子不同（都对齐原版）：
 *  1. **不要燃料**——点着就一直烤；用锹右键熄灭、用打火石重新点燃；
 *  2. **一次烤 4 个**（4 个格子同时推进），烤好的东西**直接弹出来**（没有产物槽）；
 *  3. **慢**：原版 600 tick = 30 秒一个（熔炉的 3 倍），而且**只烤食物**。
 *
 * 形状单开一个 `campfire`（7/16 高的柴堆，能站上去），点燃时顶面变成火焰贴图并发光 15。
 */
export const CAMPFIRE_ID = 424;

/**
 * 甜菜（B17，批次 48）：第四种作物。
 *
 * 与小麦/胡萝卜/马铃薯共用同一套生长行为与阶段表（`CROP_STAGES`），
 * 所以新增一种作物要动的地方很少：**4 行 `plantSpec` + 一张阶段表 + 掉落表**。
 * 种子只从村庄与矿井的战利品里来（原版也只有这几条来源，见 `loot.ts`）。
 */
const BEETROOT_SPECS: readonly BlockSpec[] = [
  plantSpec(425, 'beetroots_stage0', 'beetroots_stage0'),
  plantSpec(426, 'beetroots_stage1', 'beetroots_stage1'),
  plantSpec(427, 'beetroots_stage2', 'beetroots_stage2'),
  plantSpec(428, 'beetroots_stage3', 'beetroots_stage3'),
];

// ---------------------------------------------------------------- 甜浆果丛与可可豆（批次 49）

/**
 * 甜浆果丛与可可豆（B17，批次 49）。
 *
 * 这两样是 B17 里最后两种"**能靠玩家自己走通**"的食物来源，
 * 也是同一种结构：**一个能种的植物 → 结出食物**。
 *
 * 甜浆果丛：4 个生长阶段（与小麦/甜菜同一套"一个阶段一个 id"的做法），
 * 长在草/泥土上，**不需要耕地**——所以它不走 `growCrop` 那套判定，
 * 自己有一条随机刻行为（见 `RandomTicks.ts` 的 `berryBehavior`）。
 *
 * 可可豆：原版是**挂在丛林原木侧面**的豆荚，所以它有朝向状态
 * （`facing` = 贴着哪一面），3 个生长阶段各占一个 id。
 */
export const SWEET_BERRY_BUSH_ID_START = 429;
export const COCOA_ID_START = 433;

const BERRY_AND_COCOA_SPECS: readonly BlockSpec[] = [
  plantSpec(429, 'sweet_berry_bush_stage0', 'sweet_berry_bush_stage0'),
  plantSpec(430, 'sweet_berry_bush_stage1', 'sweet_berry_bush_stage1'),
  plantSpec(431, 'sweet_berry_bush_stage2', 'sweet_berry_bush_stage2'),
  plantSpec(432, 'sweet_berry_bush_stage3', 'sweet_berry_bush_stage3'),
  // 可可豆荚：形状挂在原木侧面，朝向存在状态里
  {
    id: 433,
    name: 'minecraft:cocoa_stage0',
    tiles: ['cocoa_stage0', 'cocoa_stage0', 'cocoa_stage0'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 434,
    name: 'minecraft:cocoa_stage1',
    tiles: ['cocoa_stage1', 'cocoa_stage1', 'cocoa_stage1'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 435,
    name: 'minecraft:cocoa_stage2',
    tiles: ['cocoa_stage2', 'cocoa_stage2', 'cocoa_stage2'],
    shape: 'cocoa',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

// ---------------------------------------------------------------- 海带与海草（批次 50）

/**
 * 海带与海草（B17 的最后一样"要地物"的食物）。
 *
 * 这两样是 B17 里**唯一卡在"水里能长的植物"**的两件：本项目的水是流体方块
 * （水占着那一格），所以"种在水里"意味着**植物替换掉那一格水**——
 * 之前没有任何方块这么干过（睡莲是"水面正上方那一格空气"），
 * 于是需要一条新通道，见 `FeatureWriter#putInWater` 与 `BlockDef.waterPlant`。
 *
 * 三件东西的差别：
 *  - **海带**（`kelp`）：从海底往上长的一株（随机刻里由**顶端**长高，封顶 26 格——
 *    与甘蔗"只由顶端长高"同一套做法），**脱水即枯萎**（上方不再是水就整格毁掉并掉 1 个海带）。
 *    ⚠️ 原版是 `kelp`（顶端）与 `kelp_plant`（茎）两个方块，这里合成**一个 id**：
 *    "我是不是顶端"由"上方那一格是不是自己"现算（与甘蔗同一条判据），
 *    省掉一个 id 与一整套"顶端 vs 茎"的同步逻辑，代价是两者共用一张贴图。
 *  - **海草**（`seagrass`）：海底的草，不生长、**徒手拔不掉**（只有剪刀才会掉自身，
 *    与原版一致——原版海草的掉落判定就只认剪刀）。
 *  - **干海带块**（`dried_kelp_block`）：9 个干海带压成一块，**当燃料能烧 20 个东西**
 *    （200 秒，比煤炭的 80 秒还耐烧，这是原版数据）。
 */
export const KELP_ID = 436;
export const SEAGRASS_ID = 437;
export const DRIED_KELP_BLOCK_ID = 438;

/**
 * 海带的最高长度（原版 `KelpBlock` 的 `MAX_HEIGHT` 是 26）。
 *
 * ⚠️ 放在这里而不是 `RandomTicks.ts`（生长行为那一侧）或 `Features.ts`（生成那一侧）：
 * **两边都要用它**（随机刻封顶、世界生成时裁高度），而 `Features.ts` 会被 Web Worker 直接引用，
 * 让它 import `RandomTicks` 会把火焰/铜/物品注册表整包拖进 Worker。数据放注册表、
 * 两边各自引用，就不会有第二个 26 悄悄漂开。
 */
export const KELP_MAX_HEIGHT = 26;

/** 长在水里的植物统一用 `cross` 形状（两片交叉薄面、无碰撞），只是多一个 `waterPlant` 标记 */
function waterPlantSpec(id: number, name: string, tile: string): BlockSpec {
  return { ...plantSpec(id, name, tile), waterPlant: true };
}

const KELP_SPECS: readonly BlockSpec[] = [
  waterPlantSpec(KELP_ID, 'kelp', 'kelp'),
  waterPlantSpec(SEAGRASS_ID, 'seagrass', 'seagrass'),
  {
    id: DRIED_KELP_BLOCK_ID,
    name: 'minecraft:dried_kelp_block',
    // 顶面是编织纹、侧面是横着压出来的一层层（底面孔位复用侧面：整块方块，不必为底面再画一张）
    tiles: ['dried_kelp_top', 'dried_kelp_side', 'dried_kelp_side'],
  },
];

// ---------------------------------------------------------------- 珊瑚一族（批次 51）

/**
 * 珊瑚（1.13 海洋更新的主角，暖水海洋海底）。
 *
 * **五"种" × 三"形" × 活/失活 = 30 个方块**，全部由下面这一小段循环展开：
 *  - **珊瑚块**（`tube_coral_block`，固体方块）：珊瑚礁的主体
 *  - **珊瑚**（`tube_coral`，`cross` 形状的丛）：长在珊瑚块上/海底
 *  - **珊瑚扇**（`tube_coral_fan`，`coral_fan` 形状的薄片）：能贴墙、也能落在方块顶上
 *
 * 活珊瑚与失活珊瑚是**两套 id**（原版如此）。这一族最要紧的两条机制都在
 * `RandomTicks.ts` 里：**离开水就失活**、**挨着活珊瑚会复活**；
 * 掉落那条在 `items.ts`：**活珊瑚不用精准采集只掉失活版**。
 *
 * 为什么用循环展开而不是手抄 30 行：这一族的"三形 × 五色"必然要一起改
 * （贴图、掉落、失活映射、生成都用同一套名字），手抄的版本一定会漏掉某一格，
 * 而漏掉的那一格看起来与其他格子毫无区别（就像"少了一种木材的门"）。
 */
export const CORAL_BLOCK_ID_START = 439;
export const DEAD_CORAL_BLOCK_ID_START = 444;
export const CORAL_ID_START = 449;
export const DEAD_CORAL_ID_START = 454;
export const CORAL_FAN_ID_START = 459;
export const DEAD_CORAL_FAN_ID_START = 464;

/** 珊瑚的五"种"（原版顺序：管 / 脑 / 气泡 / 火 / 鹿角） */
export const CORAL_KINDS = ['tube', 'brain', 'bubble', 'fire', 'horn'] as const;
export type CoralKind = (typeof CORAL_KINDS)[number];

/** 五种珊瑚的中文译名（方块名与物品名共用同一套） */
export const CORAL_KIND_CN: Record<CoralKind, string> = {
  tube: '管',
  brain: '脑',
  bubble: '气泡',
  fire: '火',
  horn: '鹿角',
};

/** 珊瑚扇：能贴墙也能落地，几何与火把同一套状态（"贴哪一面"写在状态里） */
function coralFanSpec(id: number, name: string, tile: string): BlockSpec {
  return {
    id,
    name: `minecraft:${name}`,
    tiles: [tile, tile, tile],
    solid: false,
    opaque: false,
    lightOpacity: 0,
    shape: 'coral_fan',
    // 与海带/海草同一条：它占了那一格水，所以放置要落在水里、水也冲不走它
    waterPlant: true,
  };
}

const CORAL_SPECS: BlockSpec[] = [];
for (let i = 0; i < CORAL_KINDS.length; i++) {
  const kind = CORAL_KINDS[i]!;
  const blockTile = `${kind}_coral_block`;
  const deadBlockTile = `dead_${kind}_coral_block`;
  // 珊瑚块（活/失活）：固体方块，走默认 cube
  CORAL_SPECS.push({
    id: CORAL_BLOCK_ID_START + i,
    name: `minecraft:${blockTile}`,
    tiles: [blockTile, blockTile, blockTile],
  });
  CORAL_SPECS.push({
    id: DEAD_CORAL_BLOCK_ID_START + i,
    name: `minecraft:${deadBlockTile}`,
    tiles: [deadBlockTile, deadBlockTile, deadBlockTile],
  });
  // 珊瑚丛（活/失活）：与花草同一种 cross 植物，只是长在水里
  CORAL_SPECS.push({ ...waterPlantSpec(CORAL_ID_START + i, `${kind}_coral`, `${kind}_coral`) });
  CORAL_SPECS.push({ ...waterPlantSpec(DEAD_CORAL_ID_START + i, `dead_${kind}_coral`, `dead_${kind}_coral`) });
  // 珊瑚扇（活/失活）
  CORAL_SPECS.push(coralFanSpec(CORAL_FAN_ID_START + i, `${kind}_coral_fan`, `${kind}_coral_fan`));
  CORAL_SPECS.push(coralFanSpec(DEAD_CORAL_FAN_ID_START + i, `dead_${kind}_coral_fan`, `dead_${kind}_coral_fan`));
}

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

/**
 * 蛋糕（批次 52）：**一个能被一片片吃掉的方块**。
 *
 * 原版蛋糕是"放置后右键吃、共 7 片、吃完消失"，所以它既是方块又是食物——
 * 但**它的物品不是食物**（手里拿着蛋糕右键地面是"放下"，长按不会啃）。
 * 因此这里**不把 cake 登记进 `FOOD_TABLE`**，而是单独给一片的数值
 * （`CAKE_SLICE_FOOD`，见 `food.ts`）：一登记就会让"手持蛋糕长按"也能吃掉，
 * 那是与"放下去大家一起吃"完全不同的行为。
 */
export const CAKE_ID = 469;

/**
 * 花盆（批次 52）：盆 + 里面那株植物。
 *
 * 原版用**方块实体**记"里面装的是什么"，本项目没有方块实体，也没有物品 NBT，
 * 于是改用**状态位里的索引**（见 `POTTED_PLANTS`）：0 = 空盆，1..N = 第 N 种植物。
 * 5 个状态位够放 31 种，目前 18 种（草/蕨/五朵花/两种蘑菇/枯木/仙人掌/竹子/
 * 甜浆果丛/五色珊瑚扇——与原版花盆能放的那批一致）。
 */
export const FLOWER_POT_ID = 470;

// ---------------------------------------------------------------- 脚手架（批次 53）

/**
 * 脚手架（`scaffolding`，id 471）：**底部一块板 + 四角柱**，能站上去、也能**攀爬**。
 *
 * 它一次性把三件事凑齐（都是"形状框架"里现成的能力）：
 *  - **水平连接**：与栅栏/墙同一套"网格化时按邻居实时算"（四角柱在连成片时省略）
 *  - **可站上去**：底部 1/8 格高的板（走上去不用跳，原版也是 1/8）
 *  - **可攀爬**：`isClimbableBlock` 按**形状**判定 → 这里加一个形状就自动能爬
 *
 * ⚠️ 与原版的差异（已写进 TASKS B27）：原版脚手架的攀爬是"**往前走就往上爬**、松手停住"，
 * 这里复用的是梯子那套"跳跃上升 / 潜行下降 / 松手缓缓下滑"（物理侧目前只有一套攀爬实现）；
 * 原版"下方没有支撑就整体下落"也没做——改成**放置时就要求下方有支撑**
 * （不然会多出一套"方块自己下落"的机制，与本项目的"地物/摆放都是静态的"不一致）。
 */
export const SCAFFOLDING_ID = 471;

/**
 * 阳光传感器（`daylight_detector`，id 472）：**按天光强度输出红石信号**的电源。
 *
 * 它是本项目第一个"**强度可变**的电源"（拉杆/按钮/红石块都是 0 或 15）：
 * 输出 = 所在格的天光等级（0~15），反向模式 = 15 − 天光。
 * 强度**不写状态位**——每次重算时按天光现算（与红石粉强度同一个道理），
 * 状态位里只放"有没有输出"（渲染用）与"是不是反向模式"。
 *
 * ⚠️ 它需要一条新的世界能力：`RedstoneWorld.getSkyLight`（引擎本来只认方块与状态）。
 */
export const DAYLIGHT_DETECTOR_ID = 472;

/**
 * 绊线与绊线钩（批次 55）：一对**成对使用**的红石元件。
 *
 * 两根**朝向相对**的绊线钩 + 中间的若干格绊线 = 一条回路；任何实体踩到线上，
 * 两个钩子都会输出 15 级信号（这就是"矿车/生物踩到就开门"那套）。
 *
 * 三个关键点：
 *  - **绊线没有物品**（`itemless`）：原版是用**线**右键方块顶面放下来的，
 *    所以它的掉落也是 1 根线（见 `items.ts` 的掉落覆盖表）
 *  - **线的方向不写状态**：网格化时按邻居实时算（与栅栏同一套）
 *  - **剪断**（`disarmed`）：剪刀右键剪断之后线还在、还连着，但**不再触发**
 */
export const TRIPWIRE_ID = 473;
export const TRIPWIRE_HOOK_ID = 474;

/** 两个钩子之间最多隔多少格（原版 40） */
export const TRIPWIRE_MAX_LENGTH = 40;

/**
 * TNT（批次 56）：**引信 + 爆炸**，红石元件表里最"暴力"的一件。
 *
 * 三件要盯住的事：
 *  - **三种点燃方式**：打火石右键 / 红石信号 / 旁边的火与岩浆（随机刻）
 *  - **引信 4 秒**（原版），期间**一闪一闪**（状态位里翻一个"闪相位"）
 *  - **爆炸走既有的 `explodeAt`**（苦力怕那条路，威力 4，原版 TNT 就是这个数）
 *
 * ⚠️ 与原版的差异：原版引信中的 TNT 是一个**实体**（会掉下去、能被推动），
 * 这里仍然是**方块**（靠状态位 + 运行时引信表），所以它不会在半空中掉下去。
 * 理由：实体要走渲染那条路（新模型 + 实体渲染器），而"爆炸"这件事本身就是我们要的；
 * 这条差异记在 TASKS B30 里。
 */
export const TNT_ID = 475;

const TNT_SPECS: readonly BlockSpec[] = [
  {
    id: TNT_ID,
    name: 'minecraft:tnt',
    // 正常是红白相间的炸药块；"闪"的那一相位换成发白的那两张（原版引信中就是白闪）
    tiles: ['tnt_top', 'tnt_bottom', 'tnt_side'],
    // 引信中：`powered` = 已点燃（与红石系统共用同一位），`flash` = 这一相位要发白
    stateTiles: (state) =>
      isPowered(state) && isFlash(state)
        ? ['tnt_primed_top', 'tnt_primed_top', 'tnt_primed_side']
        : ['tnt_top', 'tnt_bottom', 'tnt_side'],
    shape: 'cube',
  },
];

/**
 * 漏斗（批次 58）：H14 里"容器类功能方块"的第一件，也是本项目**第一件会自己搬东西**的方块。
 *
 * 它同时是三件事的合体，这也是为什么它单独一批：
 *  1. 一个**五向朝向**的方块（朝下 + 四个水平方向，状态位见 `blockState.ts` 的
 *     `hopperOutput` 一段：第五个方向借用了 bit0）；
 *  2. 一个**容器**（5 格，走 `container/Hopper.ts`）；
 *  3. 一条**每 0.4 秒推/拉一件**的节奏，并在**通电时被锁定**（红石负载）。
 *
 * ⚠️ 三张贴图：顶面（碗口里那个洞）、底面（**管子内壁**）、侧面（外壳的铁皮）。
 * 底面用"内壁"是因为漏斗底下能看见的正是管子口——
 * 这与营火"底面用原木横截面"是同一类取舍。
 */
export const HOPPER_ID = 476;

const HOPPER_SPECS: readonly BlockSpec[] = [
  {
    id: HOPPER_ID,
    name: 'minecraft:hopper',
    tiles: ['hopper_top', 'hopper_inside', 'hopper_side'],
    shape: 'hopper',
    // 漏斗不是整格方块：上面的碗口 6/16 高，下面的管子不挡路（见 `blockShapes`）
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 投掷器（批次 59）：H14 的第二件，也是本项目**第一件"自己吐东西"**的方块。
 *
 * 与漏斗的分工（原版那套）：
 *  - 漏斗是**按节奏**搬（每 0.4 秒，先推后拉），投掷器是**按信号**搬（红石上升沿吐一件）；
 *  - 漏斗朝**被点的那个方块**，投掷器**朝玩家**（原版 `getStateForPlacement` 就是反过来取玩家朝向）；
 *  - 漏斗朝向是 5 向（没有朝上），投掷器是 **6 向**（可以朝上/朝下，只是手持放置只会给水平四向）。
 *
 * 它本身是整格铁壳（`opaque` 默认 true），朝向靠**几何上的小凸口**表示——
 * 见 `blockShapes.ts` 的 `dropperBoxes` 与 `blockState.ts` 的 `sixFacing` 一段。
 */
export const DROPPER_ID = 477;

const DROPPER_SPECS: readonly BlockSpec[] = [
  {
    id: DROPPER_ID,
    name: 'minecraft:dropper',
    // 五个非凸口面都是外壳铁皮，**凸口那一面**用"管子口"贴图（批次 64 面级贴图）。
    // 原先钉在顶/底两面：朝下放时碰巧对，朝侧面放就完全看不出管子口（管子口只存在于几何上）
    tiles: ['dropper_side', 'dropper_side', 'dropper_side'],
    faceTile: nozzleTile('dropper_top'),
    shape: 'dropper',
  },
];

/**
 * 发射器（批次 60）：投掷器的"表哥"——同一个容器、同一套触发、同一套朝向。
 *
 * 差别只有两处：
 *  1. **吐之前先看是什么**：认得的（箭/雪球/鸡蛋/药水/TNT/打火石/剪刀）就"用"它，
 *     不认得的才当掉落物吐出去（行为表见 `registry/dispense.ts`）；
 *  2. 长得不一样：凸口是一块**宽而扁的挡板**（而不是投掷器那根细管），
 *     贴图也是另一套（本项目网格化器按面朝向取贴图，做不出"只有正面不同"的效果，
 *     所以两兄弟的身份靠**几何 + 纹理**一起表示——见 `dispenserBoxes`）。
 */
export const DISPENSER_ID = 478;

const DISPENSER_SPECS: readonly BlockSpec[] = [
  {
    id: DISPENSER_ID,
    name: 'minecraft:dispenser',
    // 与投掷器同一条：**挡板那一面**用"挡板"贴图，其余五面是外壳
    tiles: ['dispenser_side', 'dispenser_side', 'dispenser_side'],
    faceTile: nozzleTile('dispenser_top'),
    shape: 'dispenser',
  },
];

/**
 * 木桶（批次 61）：与箱子同为 27 格的容器，差别有两条（都是原版规则）：
 *  1. **上面压着方块就打不开**（见 main 的右键判定）——这是它最常见的用法：
 *     把木桶塞进墙里、天花板上，只留一个侧面露出来；
 *  2. 箱子**只能水平成对**、木桶**不能**（本项目还没有双箱子，这条先记着）。
 *
 * 它是整格方块（走贪心网格化），三张面各用一张贴图：顶面是**带箍的盖子**、
 * 底面是普通木板、四个侧面是**竖板条 + 两道铁箍**——木桶的身份一眼看得出来。
 */
export const BARREL_ID = 479;

/**
 * 堆肥桶（批次 70，B43）：四面板条围一圈 + 2/16 厚的桶底（`shape: 'composter'`）。
 *
 * 它的"内容物"不是物品栏，而是一个 **0~8 的等级**（原版 8 级满），存在**方块状态**里
 * （低 4 位，见 `blockState` 的 `composterLevelOf`）——所以它不需要方块实体，
 * 也不进容器表；**满仓时顶面换成另一张贴图**（"这桶满没满"唯一看得见的地方）。
 */
export const COMPOSTER_ID = 480;

const COMPOSTER_SPECS: readonly BlockSpec[] = [
  {
    id: COMPOSTER_ID,
    name: 'minecraft:composter',
    tiles: ['composter_top', 'composter_bottom', 'composter_side'],
    // 满仓：顶面换成"堆肥满仓"那张（桶底与桶身不动）
    stateTiles: (state) =>
      isComposterReady(state)
        ? ['composter_ready', 'composter_bottom', 'composter_side']
        : ['composter_top', 'composter_bottom', 'composter_side'],
    shape: 'composter' as const,
  },
];

/**
 * 音符盒（批次 173，G9）。
 *
 * 它是一件**纯粹的玩具**：右击响一声，潜行右击把音高往上拨一档（0~24，最高音之后再点回到最低音）。
 * 两处刻意的取舍：
 *  1. 音高存在**方块状态低 5 位**里（`blockState.notePitchOf`），所以它不需要方块实体、
 *     不进容器表，也不进存档的另一条通道——与堆肥桶的等级完全同构；
 *  2. 贴图**不随音高变**（原版也是同一张贴图），因此网格化那边一行都不用改。
 *
 * 原版的"红石脉冲自动演奏"没做：那要接进 `core/tick/Redstone` 的边沿检测，
 * 而右击这一下已经能玩（差异记在 TASKS G9）。
 */
export const NOTE_BLOCK_ID = 574;

/**
 * 炼药锅（批次 176，G13）。
 *
 * 水位 0~3 存在**方块状态低 2 位**（`blockState.cauldronLevelOf`），
 * 所以它同样不需要方块实体。形状**借用堆肥桶那一副**（四面板条 + 薄桶底）：
 * 原版炼药锅是铁皮三格高的锅，在 16×16 里与"木桶"的轮廓几乎一样，
 * 单独写一套几何只是在重复同四条板条——差异记在 TASKS G13。
 */
export const CAULDRON_ID = 575;

const CAULDRON_SPECS: readonly BlockSpec[] = [
  {
    id: CAULDRON_ID,
    name: 'minecraft:cauldron',
    tiles: ['cauldron_top', 'cauldron_bottom', 'cauldron_side'],
    // 有水时顶面换成"水面"那张（空锅是"看得到桶底"的暗口）；装了岩浆时是橙红的那张
    stateTiles: (state) =>
      isLavaCauldron(state)
        ? ['cauldron_lava', 'cauldron_bottom', 'cauldron_side']
        : cauldronLevelOf(state) > 0
          ? ['cauldron_water', 'cauldron_bottom', 'cauldron_side']
          : ['cauldron_top', 'cauldron_bottom', 'cauldron_side'],
    shape: 'composter' as const,
  },
];

const NOTE_BLOCK_SPECS: readonly BlockSpec[] = [
  {
    id: NOTE_BLOCK_ID,
    name: 'minecraft:note_block',
    tiles: ['note_block', 'note_block', 'note_block'],
  },
];

/**
 * 末影箱（批次 71，B44）：**27 格、跟着玩家走**的容器。
 *
 * 它与前面几件容器最大的不同是"内容不在这格方块上"：世界里的末影箱打开的都是
 * **同一份属于玩家的内容**（原版也是），所以它**不进容器表**（那是按坐标存的），
 * 内容存在玩家存档里（见 `PlayerSave.enderChest`）。
 * 外观用**面级贴图**（批次 64）：那张"眼睛"贴在朝向那一面，放置时朝你。
 */
export const ENDER_CHEST_ID = 481;

const ENDER_CHEST_SPECS: readonly BlockSpec[] = [
  {
    id: ENDER_CHEST_ID,
    name: 'minecraft:ender_chest',
    tiles: ['ender_chest_top', 'ender_chest_top', 'ender_chest_side'],
    faceTile: nozzleTile('ender_chest_front'),
    facesPlayer: true,
    // 原版末影箱自己发亮 7（黑曜石底 + 那一圈末影气息）
    light: 7,
  },
];

/**
 * 潜影盒（批次 72，B45）：27 格，**内容物跟着物品走**。
 *
 * 与箱子/木桶的区别不在格数，而在"内容住在哪"：这三者的内容都在方块上，
 * 但潜影盒**挖下来时会把内容一起带走**（装进掉落的物品里）、放下时再倒回方块里，
 * 所以它是这一族里唯一"内容物进物品数据"的那一件（走 `ItemStack.contents`）。
 * 外观是整格方块 + 紫贝色的上下两半（见三张贴图）。
 */
export const SHULKER_BOX_ID = 482;

/** 海绵 / 湿海绵（批次 449，接在六种压力板 693 之后） */
export const SPONGE_ID = 694;
export const WET_SPONGE_ID = 695;
/** 蜂蜜块（批次 450，接在海绵之后） */
export const HONEY_BLOCK_ID = 696;

const SHULKER_BOX_SPECS: readonly BlockSpec[] = [
  {
    id: SHULKER_BOX_ID,
    name: 'minecraft:shulker_box',
    tiles: ['shulker_top', 'shulker_bottom', 'shulker_side'],
  },
];

/**
 * 16 色潜影盒（批次 451，B54 里"16 色族"那条缺口）。
 *
 * 无色那一个（482）**保持原 id 不动**：存档里存的就是它，重排会让老存档里的
 * 潜影盒变成别的颜色。16 色接在蜂蜜块（696）之后，顺序与 `DYE_COLORS` 一致。
 *
 * 三张贴图每色一套（顶/底/侧）——不共用调色板是因为渲染层没有"方块 tint"这一层，
 * 而给潜影盒单独加一套染色通道的成本远高于多 48 张 16×16 的图集格子。
 */
export const SHULKER_BOX_COLOR_START = 697;

const COLORED_SHULKER_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color, index) => ({
  id: SHULKER_BOX_COLOR_START + index,
  name: `minecraft:${color.name}_shulker_box`,
  tiles: [`shulker_top_${color.name}`, `shulker_bottom_${color.name}`, `shulker_side_${color.name}`],
}));

/** 全部潜影盒（无色 + 16 色）：容器登记、掉落带内容、活塞推不动都认这一张表 */
export const SHULKER_BOX_IDS: readonly number[] = [
  SHULKER_BOX_ID,
  ...COLORED_SHULKER_SPECS.map((spec) => spec.id),
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

/**
 * 一棵树苗能长成哪种树（**这是 B47 唯一一处"树苗 → 树"的映射**）。
 *
 * 键是木材名（与 `Wood` 同源），值是 `Features.ts` 里的树种名。
 * ⚠️ 原版还有两处"2×2 才能长"的规矩（深色橡木与巨型丛林）：本项目的树苗**一格就能长**，
 * 树形仍按各木材的 Planter 长（深色橡木会长成一棵单干的"大树"）——这条差异写在 TASKS B47。
 */
const SAPLING_TREES: Readonly<Record<string, TreeKind>> = {
  oak: 'oak',
  birch: 'birch',
  spruce: 'spruce',
  jungle: 'jungle',
  acacia: 'acacia',
  dark_oak: 'dark_oak',
};

/** 树苗族从 483 起（接在潜影盒 482 之后，每种木材一个，与 `WOOD_TYPES` 同序） */
export const WOOD_SAPLING_ID_START = 483;

const SAPLING_ID_MAP = new Map<string, number>();
const SAPLING_TREE_MAP = new Map<number, TreeKind>();

const SAPLING_SPECS: readonly BlockSpec[] = WOOD_TYPES.map((wood, index) => {
  const id = WOOD_SAPLING_ID_START + index;
  SAPLING_ID_MAP.set(wood.name, id);
  const kind = SAPLING_TREES[wood.name];
  if (!kind) throw new Error(`composter: 木材 ${wood.name} 没有对应的树种（见 SAPLING_TREES）`);
  SAPLING_TREE_MAP.set(id, kind);
  return plantSpec(id, `${wood.name}_sapling`, `${wood.name}_sapling`);
});

/** 某种木材的树苗 id（未知木材返回 undefined） */
export function saplingId(woodName: string): number | undefined {
  return SAPLING_ID_MAP.get(woodName);
}

/** 这一格树苗会长成哪种树；不是树苗返回 null */
export function saplingTreeOf(blockId: number): TreeKind | null {
  return SAPLING_TREE_MAP.get(blockId) ?? null;
}

/** 全部树苗 id（断言与遍历用，不手抄一份） */
export const SAPLING_IDS: readonly number[] = [...SAPLING_ID_MAP.values()];


// ---------------------------------------------------------------- 瓜藤与果实（批次 77，B48）

/**
 * 南瓜与西瓜的**茎**（原版 `pumpkin_stem` / `melon_stem`）。
 *
 * 与小麦那四种作物有三处不同，所以**不进** `CROP_STAGES`：
 *  1. **八个阶段**（原版 0~7，作物只有 4 个）；
 *  2. **成熟不等于收获**：第 7 阶段之后它还要在随机刻里"结果"——在**旁边**的土上放一个
 *     南瓜/西瓜，自己变成**结果的茎**（`attached_*_stem`，朝向存在状态位里）；
 *  3. **打掉给种子**（不是给果实）：果实是另外一格方块，自己去收。
 */
export const PUMPKIN_STEM_ID_START = 489;
export const MELON_STEM_ID_START = 497;
/** 结果的茎（各一个 id，朝向存在状态位里） */
export const PUMPKIN_STEM_ATTACHED_ID = 505;
export const MELON_STEM_ATTACHED_ID = 506;

/** 茎最多长到第几阶段（原版 7，即 0~7 共 8 个） */
export const STEM_MAX_STAGE = 7;

export const STEM_STAGES: Readonly<Record<string, readonly number[]>> = {
  pumpkin: Array.from({ length: STEM_MAX_STAGE + 1 }, (_, stage) => PUMPKIN_STEM_ID_START + stage),
  melon: Array.from({ length: STEM_MAX_STAGE + 1 }, (_, stage) => MELON_STEM_ID_START + stage),
};

/** 结果的茎 → 它属于哪种瓜 */
const ATTACHED_STEMS = new Map<number, string>([
  [PUMPKIN_STEM_ATTACHED_ID, 'pumpkin'],
  [MELON_STEM_ATTACHED_ID, 'melon'],
]);

const STEM_SPECS: readonly BlockSpec[] = [
  ...STEM_STAGES.pumpkin!.map((id, stage) =>
    plantSpec(id, `pumpkin_stem_stage${stage}`, `pumpkin_stem_stage${stage}`),
  ),
  ...STEM_STAGES.melon!.map((id, stage) =>
    plantSpec(id, `melon_stem_stage${stage}`, `melon_stem_stage${stage}`),
  ),
  // 结果的茎：形状仍是十字面片，**朝向存在状态位里**（原版会朝果实弯，这里暂时只有一张贴图——
  // 差异写进 TASKS B48：模型弯曲要另加一条"按朝向旋转的面片"渲染路径）
  plantSpec(PUMPKIN_STEM_ATTACHED_ID, 'attached_pumpkin_stem', 'attached_pumpkin_stem'),
  plantSpec(MELON_STEM_ATTACHED_ID, 'attached_melon_stem', 'attached_melon_stem'),
];

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

const BARREL_SPECS: readonly BlockSpec[] = [
  {
    id: BARREL_ID,
    name: 'minecraft:barrel',
    // 批次 65：盖子（`barrel_top`）贴在**朝向那一面**（原版木桶的盖子可以朝任意一面），
    // 底面是 `barrel_bottom`、其余四面是木桶身。放置时盖子"远离你点的那一面"（六向）。
    // ⚠️ 木桶的朝向**只影响外观**：它不吃红石、也不按面限制漏斗（原版允许任意面取放）。
    tiles: ['barrel_side', 'barrel_side', 'barrel_side'],
    faceTile: barrelFace,
    facesNormal: true,
  },
];

const TRIPWIRE_SPECS: readonly BlockSpec[] = [
  {
    id: TRIPWIRE_ID,
    name: 'minecraft:tripwire',
    tiles: ['tripwire', 'tripwire', 'tripwire'],
    shape: 'tripwire',
    opaque: false,
    lightOpacity: 0,
    // 原版绊线**没有物品**：只能拿线右键方块顶面放下来（见 main 的交互）
    itemless: true,
  },
  {
    id: TRIPWIRE_HOOK_ID,
    name: 'minecraft:tripwire_hook',
    // 通电时换一张（原版钩子"拉起来"的样子，这里用颜色区分）
    tiles: ['tripwire_hook', 'tripwire_hook', 'tripwire_hook'],
    stateTiles: (state) =>
      isPowered(state)
        ? ['tripwire_hook_powered', 'tripwire_hook_powered', 'tripwire_hook_powered']
        : ['tripwire_hook', 'tripwire_hook', 'tripwire_hook'],
    shape: 'tripwire_hook',
    opaque: false,
    lightOpacity: 0,
  },
];

const DAYLIGHT_DETECTOR_SPECS: readonly BlockSpec[] = [
  {
    id: DAYLIGHT_DETECTOR_ID,
    name: 'minecraft:daylight_detector',
    // 反向模式换的是**顶面**那张（原版就是同一块板、顶面换个颜色）
    tiles: ['daylight_detector_top', 'daylight_detector_side', 'daylight_detector_side'],
    stateTiles: (state) =>
      isInverted(state)
        ? ['daylight_detector_inverted_top', 'daylight_detector_side', 'daylight_detector_side']
        : ['daylight_detector_top', 'daylight_detector_side', 'daylight_detector_side'],
    shape: 'daylight_detector',
    opaque: false,
    lightOpacity: 0,
  },
];

const SCAFFOLDING_SPECS: readonly BlockSpec[] = [
  {
    id: SCAFFOLDING_ID,
    name: 'minecraft:scaffolding',
    // 顶面是站人的木板、底面是木条、侧面是"带柱子的那一圈"
    tiles: ['scaffolding_top', 'scaffolding_bottom', 'scaffolding_side'],
    shape: 'scaffolding',
    opaque: false,
    lightOpacity: 0,
  },
];

const CAKE_AND_POT_SPECS: readonly BlockSpec[] = [
  {
    id: CAKE_ID,
    name: 'minecraft:cake',
    // 顶面奶油、底面蛋糕底、侧面那一圈（原版蛋糕就是这三张）
    tiles: ['cake_top', 'cake_bottom', 'cake_side'],
    shape: 'cake',
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: FLOWER_POT_ID,
    name: 'minecraft:flower_pot',
    tiles: ['flower_pot_top', 'flower_pot', 'flower_pot'],
    shape: 'flower_pot',
    opaque: false,
    lightOpacity: 0,
  },
];

const CAMPFIRE_SPECS: readonly BlockSpec[] = [
  {
    id: CAMPFIRE_ID,
    name: 'minecraft:campfire',
    // 底面用原木的**横截面**（oak_log_top）：营火底下看到的就是木头的断面
    tiles: ['campfire_top', 'oak_log_top', 'campfire_side'],
    shape: 'campfire',
    opaque: false,
    lightOpacity: 0,
    // 点燃时**顶面**变成火焰（三座炉子亮的是侧面——营火是"敞口"的，火光从上面看最明显）
    stateTiles: (state) =>
      isLitState(state)
        ? ['campfire_fire', 'oak_log_top', 'campfire_side']
        : ['campfire_top', 'oak_log_top', 'campfire_side'],
    // 原版营火是 15 级光源（比炉子的 13 更亮：它是明火）
    stateLight: (state) => (isLitState(state) ? 15 : 0),
  },
];

const FURNACE_STATION_SPECS: readonly BlockSpec[] = [
  {
    id: SMOKER_ID,
    name: 'minecraft:smoker',
    tiles: ['smoker_top', 'smoker_top', 'smoker_side'],
    // 点燃时的火光贴图与发光（批次 47，与熔炉同一套）
    faceTile: frontTile('smoker_front', 'smoker_front_on'),
    facesPlayer: true,
    stateLight: (state) => (isLitState(state) ? 13 : 0),
  },
  {
    id: BLAST_FURNACE_ID,
    name: 'minecraft:blast_furnace',
    tiles: ['blast_furnace_top', 'blast_furnace_top', 'blast_furnace_side'],
    faceTile: frontTile('blast_furnace_front', 'blast_furnace_front_on'),
    facesPlayer: true,
    stateLight: (state) => (isLitState(state) ? 13 : 0),
  },
];

const RED_SAND_SPECS: readonly BlockSpec[] = [
  { id: 411, name: 'minecraft:red_sand', tiles: ['red_sand', 'red_sand', 'red_sand'] },
  {
    id: 412,
    name: 'minecraft:red_sandstone',
    // 贴图顺序 [顶面, 底面, 侧面]：与普通砂岩同一套结构，只是换成红砂岩那三张
    tiles: ['red_sandstone_top', 'red_sandstone_top', 'red_sandstone'],
  },
  { id: 413, name: 'minecraft:chiseled_red_sandstone', tiles: ['chiseled_red_sandstone', 'red_sandstone', 'chiseled_red_sandstone'] },
  { id: 414, name: 'minecraft:cut_red_sandstone', tiles: ['cut_red_sandstone', 'red_sandstone', 'cut_red_sandstone'] },
  { id: 415, name: 'minecraft:smooth_red_sandstone', tiles: ['smooth_red_sandstone', 'smooth_red_sandstone', 'smooth_red_sandstone'] },
];

// ---------------------------------------------------------------- 石材家族的变体（批次 41）

/**
 * 石材家族的"台阶 / 楼梯 / 墙"补齐（B16 的 A 档批量）。
 *
 * 这一族最能体现"表驱动"的威力：**形状全部现成**（`slab` / `stairs` / `wall` 三种形状
 * 早在批次 30 之前就有了）、**贴图全部复用母方块**（`baseTiles(parent)`），
 * 所以新增一个变体只需要在下面这张表里加一个词——方块、贴图、硬度、工具、分类、
 * 中文名、配方七处会一起跟上（一处漏了都有断言兜着）。
 *
 * ⚠️ 为什么不用 `SHAPED_PARENTS` 那条现成的路：它的 slab/stairs id 区间（72~95）已经被
 * 12 个母方块排满，再加一个母方块就会撞到后面的栅栏/装饰 id（见那边的注释）。
 * 所以这一族**自己排一段 id**（351 起，追加式，不许往中间插）。
 *
 * ⚠️ 表里只列**原版确实有的**变体：原版对"錾制 / 裂纹"类不出变体，`cut_sandstone` 只有台阶、
 * `smooth_sandstone` 没有墙、`purpur` 没有墙、`stone` 没有墙。**多造一个方块比少造一个更难查**
 * （它看起来就是个正经方块），所以测试里专门有一条"这些变体不应该存在"。
 */
export const STONE_VARIANT_ID_START = 351;

/**
 * 黑石家族的变体段起点（批次 85，B50）。
 *
 * ⚠️ 为什么必须写死：变体段是**追加式**的（不许往中间插），而这一族是**最后加的**——
 * 它的位置在告示牌（523）与避雷针（532）之后，只能显式指定起点。
 * 用"游标接着排"会让 id 落到 422 附近，与烟熏炉那一批撞车（存档里存的就是这些数字）。
 */
export const BLACKSTONE_VARIANT_ID_START = 533;

/**
 * 铁轨（批次 245，G12 载具层的第二件）。
 *
 * 复用 `flat` 形状（1/16 厚的贴地薄板，与红石粉/压力板同一套几何）——
 * **不需要新 shape、也不改碰撞盒与网格化**，这是铁轨能在一批里落地的关键。
 *
 * ⚠️ 只做**直轨**：原版的直/弯/坡三种朝向与充能状态都没做（见 TASKS G12）。
 * 玩家与矿车都能直接走过去（`solid: false`），与原版一样不会挡路。
 */
export const RAIL_ID = 578;
/** 动力铁轨（批次 246）：通电时换成"亮起的金轨"贴图，并由红石引擎把状态位写上 */
export const POWERED_RAIL_ID = 579;
/** 探测铁轨（批次 246）：轨上有实体时点亮，并向相邻红石输出 15 */
export const DETECTOR_RAIL_ID = 580;
/** 激活铁轨（批次 247）：通电时把矿车里的乘客弹下来 */
export const ACTIVATOR_RAIL_ID = 581;
/** 轻质测重压力板（批次 247）：每多 1 个实体 +1 强度 */
export const LIGHT_WEIGHTED_PRESSURE_PLATE_ID = 582;
/** 重质测重压力板（批次 247）：每多 10 个实体 +1 强度 */
export const HEAVY_WEIGHTED_PRESSURE_PLATE_ID = 583;
/** 标靶（批次 248）：被投掷物打中时发一秒红石信号 */
export const TARGET_ID = 584;
export const RAIL_SPECS: readonly BlockSpec[] = [
  {
    id: RAIL_ID,
    name: 'minecraft:rail',
    tiles: ['rail', 'rail', 'rail'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: POWERED_RAIL_ID,
    name: 'minecraft:powered_rail',
    tiles: ['powered_rail', 'powered_rail', 'powered_rail'],
    // 通电状态换贴图：红石引擎在 `recompute` 里写 `powered` 位，渲染层照它取图
    stateTiles: (state) =>
      isPowered(state)
        ? ['powered_rail_on', 'powered_rail_on', 'powered_rail_on']
        : ['powered_rail', 'powered_rail', 'powered_rail'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: DETECTOR_RAIL_ID,
    name: 'minecraft:detector_rail',
    tiles: ['detector_rail', 'detector_rail', 'detector_rail'],
    stateTiles: (state) =>
      isPowered(state)
        ? ['detector_rail_on', 'detector_rail_on', 'detector_rail_on']
        : ['detector_rail', 'detector_rail', 'detector_rail'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: ACTIVATOR_RAIL_ID,
    name: 'minecraft:activator_rail',
    tiles: ['activator_rail', 'activator_rail', 'activator_rail'],
    stateTiles: (state) =>
      isPowered(state)
        ? ['activator_rail_on', 'activator_rail_on', 'activator_rail_on']
        : ['activator_rail', 'activator_rail', 'activator_rail'],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 测重压力板（批次 247）：与普通压力板同样几何，区别只在**输出强度随实体数量变化**
 * （轻质 1 个/点、重质 10 个/点），所以它们走红石引擎里"可变强度电源"那条路。
 */
/**
 * 标靶（批次 248）：整格方块，中箭时发一秒信号。
 *
 * ⚠️ 原版按命中位置给 15/7/3 三档强度；这里只做"中/不中"两档（15/0）——
 * 要按位置分档，得让投掷物报出精确命中点，而现在的钩子只报"哪一格"。
 */
export const TARGET_SPECS: readonly BlockSpec[] = [
  {
    id: TARGET_ID,
    name: 'minecraft:target',
    tiles: ['target_top', 'target_top', 'target_side'],
    stateTiles: (state) =>
      isPowered(state)
        ? ['target_top_on', 'target_top_on', 'target_side_on']
        : ['target_top', 'target_top', 'target_side'],
  },
];

/**
 * 霜冰（批次 263）：**冰霜行者**踩过的水面变成它，5 秒后再化回水。
 *
 * 不新增形状：整格方块，与冰同款几何，只是贴图偏白、带裂纹。
 * 它没有物品形态（原版也挖不到），所以只进 `BLOCKS`、不进创造/物品表。
 */
export const FROSTED_ICE_ID = 586;
export const FROSTED_ICE_SPECS: readonly BlockSpec[] = [
  {
    id: FROSTED_ICE_ID,
    name: 'minecraft:frosted_ice',
    tiles: ['frosted_ice', 'frosted_ice', 'frosted_ice'],
    // 原版挖不到霜冰（挖掉直接碎），所以它**没有物品形态**——
    // 不标这一条，方块物品自动生成会往背包里塞一个"霜冰"，各路审计立刻报缺名字/缺配方
    itemless: true,
  },
];

export const WEIGHTED_PLATE_SPECS: readonly BlockSpec[] = [
  {
    id: LIGHT_WEIGHTED_PRESSURE_PLATE_ID,
    name: 'minecraft:light_weighted_pressure_plate',
    tiles: [
      'light_weighted_pressure_plate',
      'light_weighted_pressure_plate',
      'light_weighted_pressure_plate',
    ],
    stateTiles: (state) =>
      isPowered(state)
        ? [
            'light_weighted_pressure_plate_on',
            'light_weighted_pressure_plate_on',
            'light_weighted_pressure_plate_on',
          ]
        : [
            'light_weighted_pressure_plate',
            'light_weighted_pressure_plate',
            'light_weighted_pressure_plate',
          ],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: HEAVY_WEIGHTED_PRESSURE_PLATE_ID,
    name: 'minecraft:heavy_weighted_pressure_plate',
    tiles: [
      'heavy_weighted_pressure_plate',
      'heavy_weighted_pressure_plate',
      'heavy_weighted_pressure_plate',
    ],
    stateTiles: (state) =>
      isPowered(state)
        ? [
            'heavy_weighted_pressure_plate_on',
            'heavy_weighted_pressure_plate_on',
            'heavy_weighted_pressure_plate_on',
          ]
        : [
            'heavy_weighted_pressure_plate',
            'heavy_weighted_pressure_plate',
            'heavy_weighted_pressure_plate',
          ],
    shape: 'flat',
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

/** 截至这里已经建好的全部规格段（按定义顺序）——下面 `tilesOfDefined` 用它查母方块贴图 */
const DEFINED_SPECS: readonly (readonly BlockSpec[])[] = [
  BASE_SPECS,
  WOOL_SPECS,
  WOOD_SPECS,
  WOOD_SHAPED_SPECS,
  COLORED_SPECS,
  GLASS_AND_STONE_SPECS,
  SHAPED_SPECS,
  FUNCTIONAL_SHAPED_SPECS,
  DECORATION_SPECS,
  PRISMARINE_SPECS,
  NETHER_SPECS,
  END_SPECS,
  REDSTONE_SPECS,
  OPENABLE_SPECS,
  FIRE_SPECS,
  PORTAL_SPECS,
  NETHERITE_SPECS,
  LILY_PAD_SPECS,
  CARPET_SPECS,
  SNOW_SPECS,
  // 红沙与红砂岩（批次 45）：红砂岩家族的变体要按 `tilesOfDefined(412)` 查母方块贴图，
  // 所以这一段必须在 `DEFINED_SPECS` 里（漏了会直接抛"找不到贴图"，这正是想要的效果）
  RED_SAND_SPECS,
  CHAIN_SPECS,
  VINE_SPECS,
  COPPER_SPECS,
  MORE_STONE_SPECS,
  // 铁轨（批次 245）：也进"已定义"表，`tilesOfDefined` 查得到它
  RAIL_SPECS,
  // 测重压力板（批次 247）与标靶（批次 248）
  WEIGHTED_PLATE_SPECS,
  TARGET_SPECS,
  // 霜冰（批次 263）
  FROSTED_ICE_SPECS,
];

/**
 * 在**所有已经定义好的**规格段里找母方块的贴图。
 *
 * 石材变体表的母方块横跨三段（`GLASS_AND_STONE_SPECS` 的 160~167、
 * `NETHER_SPECS` 的 227/240、`END_SPECS` 的 247/248），所以不能只查 `BASE_SPECS`
 * ——那会静默回退成石头贴图（"苔石墙长得像石头墙"）。
 * 查不到直接抛错：注册期的错误就该在启动时炸。
 */
function tilesOfDefined(id: number): readonly [string, string, string] {
  for (const specs of DEFINED_SPECS) {
    const spec = specs.find((candidate) => candidate.id === id);
    if (spec?.tiles) return spec.tiles;
  }
  throw new Error(`tilesOfDefined: 找不到方块 ${id} 的贴图（石材变体表里的 id 写错了？）`);
}

export type StoneVariantKind = 'slab' | 'stairs' | 'wall';

/**
 * [母方块 id, 命名前缀, 原版有的变体, 显式起点?]。
 *
 * 母方块 id 这里只能写数字：本文件在 `Block` 枚举**之前**就要把这些方块拼进 `SPECS`。
 * 代价是数字可能打错——所以套件里有一条断言核对"id 对应的方块名 == 登记名"。
 *
 * **第 4 列（显式起点）只写在每一段的第一行**：写了它就把分配器的游标跳到那个 id，
 * 后面的家族继续往后排。批次 45 的红砂岩家族就是这么接在 416 上的
 * （不写的话会从 404 接着排，直接撞进写死的石英家族与切石机）。
 */
const STONE_VARIANT_FAMILIES: readonly (
  readonly [
    number,
    string,
    readonly StoneVariantKind[],
    (number | undefined)?,
    (readonly [string, string, string] | undefined)?,
  ]
)[] = [
  [13, 'granite', ['slab', 'stairs', 'wall']],
  [14, 'diorite', ['slab', 'stairs', 'wall']],
  [15, 'andesite', ['slab', 'stairs', 'wall']],
  [20, 'sandstone', ['wall']],
  [68, 'deepslate_bricks', ['wall']],
  [70, 'bricks', ['wall']],
  [71, 'polished_deepslate', ['wall']],
  [160, 'mossy_cobblestone', ['slab', 'stairs', 'wall']],
  [161, 'mossy_stone_bricks', ['slab', 'stairs', 'wall']],
  [164, 'cobbled_deepslate', ['slab', 'stairs', 'wall']],
  [166, 'cut_sandstone', ['slab']],
  [167, 'smooth_sandstone', ['slab', 'stairs']],
  [227, 'blackstone', ['slab', 'stairs', 'wall']],
  [240, 'nether_bricks', ['slab', 'stairs', 'wall']],
  [247, 'end_stone_bricks', ['slab', 'stairs', 'wall']],
  [248, 'purpur_block', ['slab', 'stairs']],
  // ---- 批次 42 追加（id 387 起）：石英家族、深板岩瓦、红色下界砖、海晶石三兄弟。
  // 石英只有台阶与楼梯（原版没有石英墙）；錾制石英块与石英柱没有任何变体。
  [404, 'quartz_block', ['slab', 'stairs']],
  [407, 'smooth_quartz', ['slab', 'stairs']],
  [408, 'deepslate_tiles', ['slab', 'stairs', 'wall']],
  [409, 'red_nether_bricks', ['slab', 'stairs', 'wall']],
  [218, 'prismarine', ['slab', 'stairs', 'wall']],
  [219, 'prismarine_bricks', ['slab', 'stairs']],
  [220, 'dark_prismarine', ['slab', 'stairs']],
  // ---- 批次 45 追加（id 416 起）：红砂岩家族（红沙长在恶地地表，原料链在这里闭合）。
  // 原版的变体分布与普通砂岩**完全一致**（砂岩那三行就在上面几行，可以对着看）：
  // 红砂岩三件套、切制只有台阶、平滑有台阶与楼梯、錾制没有变体。
  [412, 'red_sandstone', ['slab', 'stairs', 'wall'], RED_SANDSTONE_VARIANT_ID_START],
  [414, 'cut_red_sandstone', ['slab']],
  [415, 'smooth_red_sandstone', ['slab', 'stairs']],
  // ---- 批次 85 追加（B50）：黑石家族的装饰性补齐。这两行就是全部改动——
  // 台阶/楼梯/墙的方块、硬度、工具、中文名、分类、配方都会自动跟上。
  //
  // ⚠️ 贴图这一列**必须显式给**：黑石家族是批次 82 才加进来的，它的规格段
  // （`BLACKSTONE_FAMILY_SPECS`）声明在 `DEFINED_SPECS` **之后**，
  // 而这张表在 `STONE_VARIANT_SPECS` 那个 IIFE 里就被求值了——按 id 去查会拿到 undefined
  // （症状是"找不到方块 529 的贴图"）。贴图就是三个字符串，直接写下来最省事也最清楚
  [529, 'polished_blackstone', ['slab', 'stairs', 'wall'], BLACKSTONE_VARIANT_ID_START, ['polished_blackstone', 'polished_blackstone', 'polished_blackstone']],
  [530, 'polished_blackstone_bricks', ['slab', 'stairs', 'wall'], undefined, ['polished_blackstone_bricks', 'polished_blackstone_bricks', 'polished_blackstone_bricks']],
];

const STONE_VARIANT_MAP = new Map<string, number>();

const STONE_VARIANT_SPECS: readonly BlockSpec[] = (() => {
  const specs: BlockSpec[] = [];
  let next = STONE_VARIANT_ID_START;
  for (const [parent, name, kinds, explicitStart, explicitTiles] of STONE_VARIANT_FAMILIES) {
    // 显式起点：把游标跳到这一段该在的位置（批次 45 的红砂岩家族用它避开写死的母方块段）
    if (explicitStart !== undefined) next = explicitStart;
    // 母方块横跨好几段规格，所以查"全部已定义的段"而不是 `baseTiles`（它只认 BASE_SPECS）；
    // 晚定义的那几族直接把贴图写在表里（见上面那段的注记）
    const tiles = explicitTiles ?? tilesOfDefined(parent);
    for (const kind of kinds) {
      const id = next++;
      STONE_VARIANT_MAP.set(`${name}_${kind}`, id);
      // 三种变体都是非完整方块：不遮挡邻居、不挡光（与 `SHAPED_SPECS` 同一套写法）
      specs.push({ id, name: `minecraft:${name}_${kind}`, tiles, shape: kind, opaque: false, lightOpacity: 0 });
    }
  }
  return specs;
})();

/**
 * 母方块与它的变体（硬度表 / 工具表"跟随母方块"要用）。
 *
 * ⚠️ 这里**故意只暴露前 3 列**：显式起点是"分配 id"用的实现细节，
 * 下游（硬度 / 工具 / 配方 / 切石表）只关心"谁的变体有哪些"。
 */
export const STONE_VARIANT_PARENTS: readonly (readonly [number, string, readonly StoneVariantKind[]])[] =
  STONE_VARIANT_FAMILIES.map(([parent, name, kinds]) => [parent, name, kinds] as const);

/** 某个"母方块 + 变体"的 id；表里没有这个变体时返回 undefined */
export function stoneVariantId(parentName: string, kind: StoneVariantKind): number | undefined {
  return STONE_VARIANT_MAP.get(`${parentName}_${kind}`);
}

/** 全部石材变体的 id（套件、创造分类、配方批量遍历用） */
export const STONE_VARIANT_IDS: readonly number[] = [...STONE_VARIANT_MAP.values()];

// ---------------------------------------------------------------- 床（B13，批次 79）

/**
 * 16 色床：**横跨两格**的一件家具，能躺在上面睡觉（跳过夜晚 + 设置重生点）。
 *
 * id 从 507 起（接在瓜藤结果的茎 506 之后），顺序与 `DYE_COLORS` 一致——
 * 与羊毛/地毯/陶瓦同一条规矩：颜色顺序就是 id 顺序，改动顺序会让存档错位。
 * 所以"第 i 种颜色的床"就是 `BED_ID_START + i`（`bedId(i)`），
 * 想按 id 反查颜色用 `bedColorIndex(id)`。
 *
 * 贴图只有两张（顶面 / 侧面），16 色各一对：床头那端的"枕头"是**几何**
 * （见 `blockShapes.ts` 的 `bedPillowBox`），所以不必为"朝向"多做一套贴图。
 */
export const BED_ID_START = 507;

const BED_ID_MAP = new Map<string, number>();

const BED_SPECS: readonly BlockSpec[] = DYE_COLORS.map((color, index) => {
  const id = BED_ID_START + index;
  BED_ID_MAP.set(color.name, id);
  const top = `bed_${color.name}_top`;
  const side = `bed_${color.name}_side`;
  return {
    id,
    name: `minecraft:${color.name}_bed`,
    // [顶面, 底面, 侧面]：床头/床脚共用同一张顶面贴图（枕头是几何，不是贴图）
    tiles: [top, top, side] as const,
    shape: 'bed' as const,
    // 9/16 高的家具：不遮挡邻居、不挡光（与台阶/活板门同一条），但**有碰撞**（能站上去）
    opaque: false,
    lightOpacity: 0,
  };
});

/** 第 index 种颜色的床（顺序与 `DYE_COLORS` 一致） */
export function bedId(colorIndex: number): number {
  return BED_ID_START + colorIndex;
}

/** 某种颜色的床 id；未知颜色返回 undefined */
export function bedIdOfColor(name: string): number | undefined {
  return BED_ID_MAP.get(name);
}

/** 这张床是第几种颜色；不是床返回 -1（存档里出现越界 id 时也返回 -1） */
export function bedColorIndex(blockId: number): number {
  const index = blockId - BED_ID_START;
  return index >= 0 && index < DYE_COLORS.length ? index : -1;
}

/** 这一格是不是床 */
export function isBed(blockId: number): boolean {
  return bedColorIndex(blockId) >= 0;
}

/** 全部床的 id（断言与创造分类遍历用，不手抄 16 行） */
export const BED_IDS: readonly number[] = DYE_COLORS.map((_color, index) => BED_ID_START + index);

// ---------------------------------------------------------------- 告示牌（B12，批次 80）

/**
 * 告示牌：6 种木材各一个方块，**落地 / 挂墙共用同一个 id**（与火把、珊瑚扇同一套状态：
 * `wallMounted` 记"是不是挂在墙上"、`facing` 记"字朝哪边"）。
 *
 * 原版把 `oak_sign` 与 `oak_wall_sign` 做成两个方块，而本项目从火把起就是
 * "一个方块 + 一个贴墙位"——照做会白白多出一倍的 id、物品与配方
 * （而且原版那两件的掉落物还是同一个）。
 *
 * 贴图**复用该木材的木板**：牌面与立柱都是同一张（原版的牌子本来就是木板做的），
 * 所以这一批**一张新贴图都不用画**，与木制方块族"栅栏复用木板贴图"同一条做法。
 */
export const SIGN_ID_START = 523;

const SIGN_ID_MAP = new Map<string, number>();

const SIGN_SPECS: readonly BlockSpec[] = WOOD_TYPES.map((wood, index) => {
  const id = SIGN_ID_START + index;
  SIGN_ID_MAP.set(wood.name, id);
  const plank = `${wood.name}_planks`;
  return {
    id,
    name: `minecraft:${wood.name}_sign`,
    tiles: [plank, plank, plank] as const,
    shape: 'sign' as const,
    // 牌子**不挡路**（原版能从牌子里走过去）：没有碰撞盒（见 `blockShapes`），
    // 也不算"支撑面"（不能拿它当垫脚去种花）——所以 `solid: false`
    solid: false,
    opaque: false,
    lightOpacity: 0,
  };
});

/** 某种木材的告示牌 id；未知木材返回 undefined */
export function signId(woodName: string): number | undefined {
  return SIGN_ID_MAP.get(woodName);
}

/** 这一格是不是告示牌（落地 / 挂墙都算） */
export function isSign(blockId: number): boolean {
  const index = blockId - SIGN_ID_START;
  return index >= 0 && index < WOOD_TYPES.length;
}

/** 全部告示牌的 id（断言与创造分类遍历用） */
export const SIGN_IDS: readonly number[] = WOOD_TYPES.map((_wood, index) => SIGN_ID_START + index);

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
export const POLISHED_BLACKSTONE_ID = 529;
/**
 * 磨制黑石砖（批次 82 落地，**批次 85 改名**）。
 *
 * ⚠️ 原版**没有** `blackstone_bricks` 这个方块——那一条是批次 82 起名时按"黑石砖"直译的，
 * 而原版的 id 与中文名都是**磨制黑石砖**（`polished_blackstone_bricks`）。
 * 这一批（B50）要给它补台阶/楼梯/墙，名字对不上会让"变体复用母方块贴图/配方"
 * 那套表驱动**找不到母方块**（`stoneVariantId('polished_blackstone_bricks', 'slab')` 返回 undefined），
 * 所以顺手改回原版的名字。**id 530 没动**（存档里存的就是它）。
 */
export const POLISHED_BLACKSTONE_BRICKS_ID = 530;
export const GILDED_BLACKSTONE_ID = 531;
/** 錾制磨制黑石（批次 85，B50）：接在黑石变体段（533~538）之后 */
export const CHISELED_POLISHED_BLACKSTONE_ID = 539;
/** 裂纹磨制黑石砖（批次 85，B50）：**只能烧出来**（原版如此，没有合成配方） */
export const CRACKED_POLISHED_BLACKSTONE_BRICKS_ID = 540;

const BLACKSTONE_FAMILY_SPECS: readonly BlockSpec[] = [
  {
    id: POLISHED_BLACKSTONE_ID,
    name: 'minecraft:polished_blackstone',
    tiles: ['polished_blackstone', 'polished_blackstone', 'polished_blackstone'],
  },
  {
    id: POLISHED_BLACKSTONE_BRICKS_ID,
    name: 'minecraft:polished_blackstone_bricks',
    tiles: ['polished_blackstone_bricks', 'polished_blackstone_bricks', 'polished_blackstone_bricks'],
  },
  {
    // 鎏金黑石：深色石头里嵌着金块。**它是一件"矿石"而不是装饰**——
    // 拆掉掉 2~5 个金粒（见 `items.ts` 的 `COUNT_RANGE_DROPS`），
    // 所以堡垒遗迹里它是玩家真正会去撬的那几块
    id: GILDED_BLACKSTONE_ID,
    name: 'minecraft:gilded_blackstone',
    tiles: ['gilded_blackstone', 'gilded_blackstone', 'gilded_blackstone'],
  },
];

/**
 * 避雷针（批次 83，B15 的一部分 + 红石元件表收口）。
 *
 * 它是"红石元件表里最后一件纯机制件"：**输出不由玩家开关决定，而由天气决定**——
 * 前面两种"外部世界决定输出"的电源是阳光传感器（看天光）与绊线（看实体），
 * 这是第三种（看打雷）。所以它的朝向必须精确记下来：**闪电打在它身上**，
 * 而"打在哪儿"要按它伸出那一面算（见 `world/Lightning.ts`）。
 *
 * 六向朝向走共享编码 `sixFacing`（与漏斗/投掷器/木桶同一套），
 * 放置规则复用 `facesNormal`（贴在命中的那一面上）。
 * ⚠️ 原版的避雷针会**氧化**（四档铜）——本项目不做（记在 TASKS B15）。
 */
export const LIGHTNING_ROD_ID = 532;

const LIGHTNING_ROD_SPEC: BlockSpec = {
  id: LIGHTNING_ROD_ID,
  name: 'minecraft:lightning_rod',
  shape: 'lightning_rod',
  tiles: ['lightning_rod', 'lightning_rod', 'lightning_rod'],
  // 贴在命中的那一面上（六向），与木桶同一条规则
  facesNormal: true,
  // 铜做的、不挡光、不算实心（2/16 细杆）
  lightOpacity: 0,
  solid: false,
  opaque: false,
};

/**
 * 黑石家族的"装饰性补齐"（批次 85，B50）：錾制与裂纹两块。
 *
 * ⚠️ 裂纹磨制黑石砖**没有合成配方**——原版只有"把黑石砖丢进熔炉烧"这一条路
 * （见 `Smelting.ts`），所以它的说明里写的是"烧出来"，而断言里专门钉住
 * "它不出现在任何合成配方的产物里"。
 */
const BLACKSTONE_DECOR_SPECS: readonly BlockSpec[] = [
  {
    id: CHISELED_POLISHED_BLACKSTONE_ID,
    name: 'minecraft:chiseled_polished_blackstone',
    tiles: ['chiseled_polished_blackstone', 'chiseled_polished_blackstone', 'chiseled_polished_blackstone'],
  },
  {
    id: CRACKED_POLISHED_BLACKSTONE_BRICKS_ID,
    name: 'minecraft:cracked_polished_blackstone_bricks',
    tiles: [
      'cracked_polished_blackstone_bricks',
      'cracked_polished_blackstone_bricks',
      'cracked_polished_blackstone_bricks',
    ],
  },
];

/**
 * 物品展示框与画（B14，批次 86）——"墙上挂东西"的两件套。
 *
 * 两者都是**贴墙的薄板**，都不挡路、都不遮光，而且都用同一套状态语义
 * （`facing` 指向贴着的那一面墙，见 `blockState.ts` 的 `'item_frame'` 注释）。
 * 它们的不同只在"中间有没有洞、贴图怎么来"：
 *
 *  - **展示框**：整面板子 + 一张**中间镂空**的贴图（框环画在贴图里），
 *    框里那件物品由 `render/ItemFrameRenderer.ts` 单独画（那是运行时数据）；
 *  - **画**：整面薄板，贴图按**状态位里的变体号**换（7 幅，走 `stateTiles`）。
 *
 * ⚠️ id 接着 540 往下排（541 / 542）：方块表要求 id 从 0 起连续
 * （`buildBlockTable` 会在启动时当场拦下错位），所以**不能挑空档**。
 */
export const ITEM_FRAME_ID = 541;
export const PAINTING_ID = 542;

const HANGING_SPECS: readonly BlockSpec[] = [
  {
    id: ITEM_FRAME_ID,
    name: 'minecraft:item_frame',
    shape: 'item_frame',
    tiles: ['item_frame', 'item_frame', 'item_frame'],
    // 框里能不能挂东西与方块无关（挂在墙上的是一块空心板），所以没有额外状态位
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: PAINTING_ID,
    name: 'minecraft:painting',
    shape: 'painting',
    // 默认贴图（状态为 0 时用）就是第一幅画；其余在 `stateTiles` 里按变体号换
    tiles: [paintingTile(0), paintingTile(0), paintingTile(0)],
    stateTiles: (state) => {
      const tile = paintingTile(paintingVariantOf(state));
      return [tile, tile, tile];
    },
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 村民的"工作站"方块（J23，批次 90）：讲台 / 制箭台 / 砂轮 / 织布机。
 *
 * 这四个与切石机、锻造台、木桶、堆肥桶是**同一类东西**：一个实心方块，
 * 村民认领它就得到对应职业（`registry/villagerTrades.ts` 的 `PROFESSIONS`）。
 * 所以它们的"存在理由"是**给村子里的职业开门**——村庄里摆什么，住的就是谁
 * （批次 89 的人口规则会自己把它们摆进屋里，见 `WORKSTATION_BLOCKS`）。
 *
 * ⚠️ 四个都**只是工作站，还没有自己的界面**（原版各自的界面是另一条活）：
 * 讲台能放书读、砂轮能修装备、织布机能做旗帜图案——都记在 TASKS J25。
 * 制箭台在原版**本来就没有功能**（纯装饰 + 认领），所以它不需要补。
 *
 * ⚠️ id 接着 542（画）往下排：方块表要求 id 从 0 起连续，
 * `buildBlockTable` 会在启动时当场拦下错位，所以**不能挑空档**。
 */
export const LECTERN_ID = 543;
export const FLETCHING_TABLE_ID = 544;
export const GRINDSTONE_ID = 545;
export const LOOM_ID = 546;

const WORKSTATION_SPECS: readonly BlockSpec[] = [
  {
    id: LECTERN_ID,
    name: 'minecraft:lectern',
    // 顶面：摊开的书；侧面：木框 + 书脊
    tiles: ['lectern_top', 'lectern_top', 'lectern_side'],
  },
  {
    id: FLETCHING_TABLE_ID,
    name: 'minecraft:fletching_table',
    tiles: ['fletching_table_top', 'fletching_table_top', 'fletching_table_side'],
  },
  {
    id: GRINDSTONE_ID,
    name: 'minecraft:grindstone',
    tiles: ['grindstone_top', 'grindstone_top', 'grindstone_side'],
  },
  {
    id: LOOM_ID,
    name: 'minecraft:loom',
    tiles: ['loom_top', 'loom_bottom', 'loom_side'],
  },
];

/**
 * 下界疣（批次 92，J26 的断环之一）。
 *
 * 它是**唯一长在灵魂沙上的作物**，也是整条酿造链的**第一件原料**
 * （原版：水瓶 + 下界疣 = 粗制的药水，其余每一瓶都从粗制的那瓶出发）。
 * 在此之前它只是一件"登记了但拿不到"的物品——见 O14 的可达性审计：
 * 那次审计量出"整族 112 件药水/药水箭在生存里一瓶都拿不到"，
 * 根因就是这里（外加烈焰粉那半条）。
 *
 * 与小麦/甜菜那四种作物的三处不同：
 *  1. **地基是灵魂沙**，不是耕地（所以它不进 `CROP_STAGES`——那张表的三处判定
 *     都假设"下面是耕地"：`cropOf` / `growCrop` / `extraCropDrop`）；
 *  2. **不需要光照**（原版在下界的洞里照样长），也不看"旁边有没有水"；
 *  3. 形状单开一个 `nether_wart`：放置要求下方**必须是灵魂沙**（比 `cross` 的
 *     "下方实心就行"更严），见 `interaction/Placement.ts`。
 *
 * 贴图 4 张、id 接着 546（织布机）往下排——方块表要求 id 从 0 起连续，
 * `buildBlockTable` 会在启动时当场拦下错位。
 */
export const NETHER_WART_ID_START = 547;

const NETHER_WART_SPECS: readonly BlockSpec[] = [0, 1, 2, 3].map((stage) => ({
  id: NETHER_WART_ID_START + stage,
  name: `minecraft:nether_wart_stage${stage}`,
  tiles: [`nether_wart_stage${stage}`, `nether_wart_stage${stage}`, `nether_wart_stage${stage}`],
  solid: false,
  opaque: false,
  lightOpacity: 0,
  shape: 'nether_wart' as const,
}));

/**
 * 刷怪笼（批次 92）：下界要塞里那一格"会自己出烈焰人"的笼子。
 *
 * 它是 K6"刷怪笼与刷怪规则"里一直缺的那一半（**方块本身**）：规则侧（主线程按
 * 坐标定期生成生物）在 `core/world/SpawnerTicking.ts`，而"这一格出什么"写在
 * `registry/spawners.ts` 那张表里（目前只有一行：刷怪笼 → 烈焰人）。
 *
 * ⚠️ 与原版的差距：笼子里**没有**那只旋转的小生物（E14 只覆盖了生物与掉落物），
 * 也没有"玩家靠近才转"那套细节——外观是一张"铁栏杆"贴图。
 * 贴图走半透明层（`translucent`）：笼子是**镂空**的，能透过它看见里面。
 */
export const SPAWNER_ID = 551;

export const WITHER_SKELETON_SKULL_ID = 552;

/**
 * 凋灵骷髅头（批次 115，J14 的前置）。
 *
 * 它有两个身份，这里都实现了：
 *  - **战利品**：凋灵骷髅 2.5% 掉一个（原版数值），可以放在地上当装饰；
 *  - **召唤材料**：4 块灵魂沙摆成 T + 顶上 3 个头 = 凋灵（仪式那一半在下一批）。
 *
 * 形状是 `head`（8/16 立方体贴在顶面正中，能站上去也能从旁边走过），
 * 所以它**不是** `cube`——原版那颗头占不满一格。
 *
 * ⚠️ 与原版的差异：**不存朝向**（原版会按放置方向把脸转过来）。本项目的状态位
 * 已被 `TOP_MASK` 那套"不同形状族共用位"的约定占着，而"头朝哪"这件事只影响观感，
 * 不值得为它占一位——脸朝 -Z，四个侧面共用同一张贴图，从哪边看都是那张脸。
 */
const SKULL_SPECS: readonly BlockSpec[] = [
  {
    id: WITHER_SKELETON_SKULL_ID,
    name: 'minecraft:wither_skeleton_skull',
    tiles: ['wither_skull_top', 'wither_skull', 'wither_skull'],
    shape: 'head',
    opaque: false,
    lightOpacity: 0,
  },
];

/** 金块 / 钻石块 / 绿宝石块（批次 117）：信标金字塔要用的三种"矿物块" */
export const GOLD_BLOCK_ID = 553;
export const DIAMOND_BLOCK_ID = 554;
export const EMERALD_BLOCK_ID = 555;
/** 信标（批次 117，K5） */
export const BEACON_ID = 556;
/** 粘液块（批次 120，J16 的史莱姆那一族） */
export const SLIME_BLOCK_ID = 557;
/**
 * 灵魂火把（批次 200，B20）：蓝色火焰的火把，亮度 10（普通火把是 14）。
 *
 * ⚠️ id 接在**炼药锅（575）**之后——`558~573` 是 16 色混凝土粉末、
 * 574/575 是音符盒与炼药锅。方块表要求 id 从 0 起连续，随便挑一个"看起来空着"的号会当场报错。
 */
export const SOUL_TORCH_ID = 576;
/** 灵魂灯笼（批次 200，B20）：落地的小灯，亮度 10；新形状 `lantern` */
export const SOUL_LANTERN_ID = 577;

/**
 * 粘液块（批次 120）：绿色半透明的一整块，**落在上面会被弹起来**（弹跳那一段在
 * `world/Slime.ts` + 主程序的落地判定里）。
 *
 * ⚠️ 与原版的差异：**活塞推它不会带走相邻方块**（原版那套"粘性方块"要活塞推动时
 * 连带检查六个面，本项目还没做——记在 TASKS J16）。所以它的说明里只写了"能弹跳"。
 */
/**
 * 灵魂火把 / 灵魂灯笼（批次 200，B20 的三件之一）。
 *
 * 它们的存在理由不是"再来两个光源"：**灵魂沙谷**与**灵魂沙**早就在（下界生成），
 * 但做出来的东西只有"烧"这一条用途。这两件把灵魂沙接进了"照明"这条链，
 * 而且亮度 **10**（普通火把 14）——比火把暗一档，在灵魂沙谷里反而更耐看。
 */
const SOUL_LIGHT_SPECS: readonly BlockSpec[] = [
  {
    id: SOUL_TORCH_ID,
    name: 'minecraft:soul_torch',
    tiles: ['soul_torch', 'soul_torch', 'soul_torch'],
    shape: 'torch',
    solid: false,
    opaque: false,
    light: 10,
    lightOpacity: 0,
  },
  {
    id: SOUL_LANTERN_ID,
    name: 'minecraft:soul_lantern',
    tiles: ['soul_lantern', 'soul_lantern', 'soul_lantern'],
    shape: 'lantern',
    solid: false,
    opaque: false,
    light: 10,
    lightOpacity: 0,
  },
];

const SLIME_BLOCK_SPECS: readonly BlockSpec[] = [
  {
    id: SLIME_BLOCK_ID,
    name: 'minecraft:slime_block',
    tiles: ['slime_block', 'slime_block', 'slime_block'],
    // 它挡光但不像石头那样遮住邻居（原版粘液块是半透明的）
    opaque: false,
    lightOpacity: 0,
  },
];

/**
 * 矿物块与信标（批次 117，K5 信标那一批）。
 *
 * 为什么**这一批才补三种矿物块**：信标的金字塔底座要用它们（原版底座可以是
 * 铁块 / 金块 / 钻石块 / 绿宝石块 / 下界合金块，还能混着摆）——而在此之前本项目
 * 只有铁块与下界合金块，**金/钻石/绿宝石连储物方块都没有**（也没有"9 锭换 1 块"的配方）。
 * 所以它们不是"顺手加的装饰"，是信标的前置。
 *
 * 信标本身是完整立方体（`cube`）：原版它由"黑曜石底盘 + 玻璃身 + 里面的星"三截组成，
 * 本项目按既有画法把这三截画进 16×16 贴图（见 `TextureAtlas` 的 `beacon`）——
 * 不额外做几何，观感与其它方块一致，网格化那边也少一个分支。
 * 它是**光源**（原版信标亮度 15）而且不挡光（那圈玻璃）。
 */
const MINERAL_AND_BEACON_SPECS: readonly BlockSpec[] = [
  { id: GOLD_BLOCK_ID, name: 'minecraft:gold_block', tiles: ['gold_block', 'gold_block', 'gold_block'] },
  {
    id: DIAMOND_BLOCK_ID,
    name: 'minecraft:diamond_block',
    tiles: ['diamond_block', 'diamond_block', 'diamond_block'],
  },
  {
    id: EMERALD_BLOCK_ID,
    name: 'minecraft:emerald_block',
    tiles: ['emerald_block', 'emerald_block', 'emerald_block'],
  },
  {
    id: BEACON_ID,
    name: 'minecraft:beacon',
    tiles: ['beacon_top', 'beacon_top', 'beacon'],
    opaque: false,
    lightOpacity: 0,
    light: 15,
  },
];

const SPAWNER_SPECS: readonly BlockSpec[] = [
  {
    id: SPAWNER_ID,
    name: 'minecraft:spawner',
    tiles: ['spawner', 'spawner', 'spawner'],
    solid: true,
    // 不透光但**不遮挡邻居**：这样隔着笼子能看见里面的方块，与原版观感一致
    opaque: false,
    lightOpacity: 0,
  },
];

const SPECS: readonly BlockSpec[] = [
  ...BASE_SPECS,
  ...WOOL_SPECS,
  ...WOOD_SPECS,
  ...COLORED_SPECS,
  ...GLASS_AND_STONE_SPECS,
  ...SHAPED_SPECS,
  ...FUNCTIONAL_SHAPED_SPECS,
  ...DECORATION_SPECS,
  ...PRISMARINE_SPECS,
  ...NETHER_SPECS,
  ...END_SPECS,
  ...REDSTONE_SPECS,
  ...OPENABLE_SPECS,
  ...FIRE_SPECS,
  ...PORTAL_SPECS,
  ...NETHERITE_SPECS,
  ...LILY_PAD_SPECS,
  ...CARPET_SPECS,
  ...SNOW_SPECS,
  ...WOOD_SHAPED_SPECS,
  ...CHAIN_SPECS,
  ...VINE_SPECS,
  ...COPPER_SPECS,
  ...MORE_STONE_SPECS,
  // 铁轨（批次 245/247）：flat 薄板，注册进主表
  ...RAIL_SPECS,
  ...WEIGHTED_PLATE_SPECS,
  ...TARGET_SPECS,
  ...FROSTED_ICE_SPECS,
  ...STONE_VARIANT_SPECS,
  ...STONECUTTER_SPECS,
  ...RED_SAND_SPECS,
  ...FURNACE_STATION_SPECS,
  ...CAMPFIRE_SPECS,
  ...BEETROOT_SPECS,
  ...BERRY_AND_COCOA_SPECS,
  ...KELP_SPECS,
  ...CORAL_SPECS,
  ...CAKE_AND_POT_SPECS,
  ...SCAFFOLDING_SPECS,
  ...DAYLIGHT_DETECTOR_SPECS,
  ...TRIPWIRE_SPECS,
  ...TNT_SPECS,
  ...HOPPER_SPECS,
  ...DROPPER_SPECS,
  ...DISPENSER_SPECS,
  ...BARREL_SPECS,
  ...COMPOSTER_SPECS,
  ...NOTE_BLOCK_SPECS,
  ...CAULDRON_SPECS,
  ...ENDER_CHEST_SPECS,
  ...SHULKER_BOX_SPECS,
  ...COLORED_SHULKER_SPECS,
  ...SAPLING_SPECS,
  ...STEM_SPECS,
  ...BED_SPECS,
  ...SIGN_SPECS,
  ...BLACKSTONE_FAMILY_SPECS,
  LIGHTNING_ROD_SPEC,
  ...BLACKSTONE_DECOR_SPECS,
  ...HANGING_SPECS,
  ...WORKSTATION_SPECS,
  ...NETHER_WART_SPECS,
  ...SPAWNER_SPECS,
  ...SKULL_SPECS,
  ...MINERAL_AND_BEACON_SPECS,
  ...SLIME_BLOCK_SPECS,
  ...SOUL_LIGHT_SPECS,
  ...CANDLE_SPECS,
  ...GLAZED_TERRACOTTA_SPECS,
  ...BANNER_SPECS,

  // 繁茂洞穴植物（批次 397）：小型 / 大型垂滴叶
  {
    id: 665,
    name: 'minecraft:small_dripleaf',
    tiles: ['small_dripleaf', 'small_dripleaf', 'small_dripleaf'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 666,
    name: 'minecraft:big_dripleaf',
    tiles: ['big_dripleaf', 'big_dripleaf', 'big_dripleaf'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },

  // 缠根泥土（批次 395）：洞穴顶部的泥土变体
  {
    id: 664,
    name: 'minecraft:rooted_dirt',
    tiles: ['rooted_dirt', 'rooted_dirt', 'rooted_dirt'] as const,
  },

  // 洞穴顶部的两件（批次 392）：孢子花 / 垂根
  {
    id: 662,
    name: 'minecraft:spore_blossom',
    tiles: ['spore_blossom', 'spore_blossom', 'spore_blossom'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    light: 15,
    lightOpacity: 0,
  },
  {
    id: 663,
    name: 'minecraft:hanging_roots',
    tiles: ['hanging_roots', 'hanging_roots', 'hanging_roots'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },

  // 洞穴装饰（批次 391）：发光地衣 / 发光浆果 / 尖滴石 / 滴水石
  {
    id: 658,
    name: 'minecraft:glow_lichen',
    tiles: ['glow_lichen', 'glow_lichen', 'glow_lichen'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    light: 7,
    lightOpacity: 0,
  },
  {
    id: 659,
    name: 'minecraft:glow_berries',
    tiles: ['glow_berries', 'glow_berries', 'glow_berries'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    light: 14,
    lightOpacity: 0,
  },
  {
    id: 660,
    name: 'minecraft:pointed_dripstone',
    tiles: ['pointed_dripstone', 'pointed_dripstone', 'pointed_dripstone'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 661,
    name: 'minecraft:dripstone_block',
    tiles: ['dripstone_block', 'dripstone_block', 'dripstone_block'] as const,
  },

  // 哭泣的黑曜石（批次 390）：猪灵以物易物的产物，发 10 级光
  {
    id: 657,
    name: 'minecraft:crying_obsidian',
    tiles: ['crying_obsidian', 'crying_obsidian', 'crying_obsidian'] as const,
    light: 10,
  },

  // 遮光玻璃（批次 387）：1.17 的"不透光玻璃"，4 紫水晶碎片 + 1 玻璃
  {
    id: 656,
    name: 'minecraft:tinted_glass',
    tiles: ['tinted_glass', 'tinted_glass', 'tinted_glass'] as const,
    opaque: false,
    lightOpacity: 15,
  },
  // 骨块（批次 349，D21 化石）：9 骨粉压成一块，化石结构也用它
  {
    id: 587,
    name: 'minecraft:bone_block',
    tiles: ['bone_block_top', 'bone_block_top', 'bone_block_side'] as const,
  },
  // 紫水晶族（批次 351，D21 收尾）：紫晶洞的三层壳
  {
    id: 588,
    name: 'minecraft:amethyst_block',
    tiles: ['amethyst_block', 'amethyst_block', 'amethyst_block'] as const,
  },
  {
    id: 589,
    name: 'minecraft:budding_amethyst',
    tiles: ['budding_amethyst', 'budding_amethyst', 'budding_amethyst'] as const,
  },
  {
    id: 590,
    name: 'minecraft:amethyst_cluster',
    tiles: ['amethyst_cluster', 'amethyst_cluster', 'amethyst_cluster'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    light: 5,
  },
  // 分物种刷怪笼（批次 365）：同一张贴图、不同方块 id —— 与原版 K6 的
  // "一种生物一个 id"取舍一致（方块状态只有 1 字节，装不下 NBT）
  {
    id: 595,
    name: 'minecraft:zombie_spawner',
    tiles: ['spawner', 'spawner', 'spawner'] as const,
    solid: true,
    opaque: false,
    lightOpacity: 0,
    itemless: true,
  },
  {
    id: 596,
    name: 'minecraft:cave_spider_spawner',
    tiles: ['spawner', 'spawner', 'spawner'] as const,
    solid: true,
    opaque: false,
    lightOpacity: 0,
    itemless: true,
  },
  {
    id: 597,
    name: 'minecraft:silverfish_spawner',
    tiles: ['spawner', 'spawner', 'spawner'] as const,
    solid: true,
    opaque: false,
    lightOpacity: 0,
    itemless: true,
  },
  // 苔藓族（批次 367）：沼泽里的苔藓块与苔藓地毯
  {
    id: 598,
    name: 'minecraft:moss_block',
    tiles: ['moss_block', 'moss_block', 'moss_block'] as const,
  },
  {
    id: 599,
    name: 'minecraft:moss_carpet',
    tiles: ['moss_block', 'moss_block', 'moss_block'] as const,
    shape: 'flat' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  // 杜鹃族（批次 369）：苔藓斑块上长出来的三种
  {
    id: 600,
    name: 'minecraft:azalea',
    tiles: ['azalea', 'azalea', 'azalea'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  {
    id: 601,
    name: 'minecraft:flowering_azalea',
    tiles: ['flowering_azalea', 'flowering_azalea', 'flowering_azalea'] as const,
    shape: 'cross' as const,
    solid: false,
    opaque: false,
    lightOpacity: 0,
  },
  // 蜂巢（批次 374）：繁花森林里的蜜蜂巢
  {
    id: 602,
    name: 'minecraft:bee_nest',
    tiles: ['bee_nest_top', 'bee_nest_top', 'bee_nest_side'] as const,
  },
  // 涂蜡铜（批次 375）：四种氧化度的整块，贴图与未涂蜡版完全一致
  {
    id: 603,
    name: 'minecraft:waxed_copper_block',
    tiles: ['copper_block', 'copper_block', 'copper_block'] as const,
  },
  {
    id: 604,
    name: 'minecraft:waxed_exposed_copper',
    tiles: ['exposed_copper', 'exposed_copper', 'exposed_copper'] as const,
  },
  {
    id: 605,
    name: 'minecraft:waxed_weathered_copper',
    tiles: ['weathered_copper', 'weathered_copper', 'weathered_copper'] as const,
  },
  {
    id: 606,
    name: 'minecraft:waxed_oxidized_copper',
    tiles: ['oxidized_copper', 'oxidized_copper', 'oxidized_copper'] as const,
  },
  // 蘑菇岛族（批次 352）：菌丝 + 巨型蘑菇的柄与两种菌盖
  {
    id: 591,
    name: 'minecraft:mycelium',
    tiles: ['mycelium_top', 'dirt', 'mycelium_side'] as const,
  },
  {
    id: 592,
    name: 'minecraft:mushroom_stem',
    tiles: ['mushroom_stem', 'mushroom_stem', 'mushroom_stem'] as const,
  },
  {
    id: 593,
    name: 'minecraft:brown_mushroom_block',
    tiles: ['brown_mushroom_block_top', 'brown_mushroom_block_top', 'brown_mushroom_block_side'] as const,
  },
  {
    id: 594,
    name: 'minecraft:red_mushroom_block',
    tiles: ['red_mushroom_block_top', 'red_mushroom_block_top', 'red_mushroom_block_side'] as const,
  },
].sort((a, b) => a.id - b.id);

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
 */
function buildBlockTable(): readonly BlockDef[] {
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
      stateTiles: spec.stateTiles,
      faceTile: spec.faceTile,
      facesPlayer: spec.facesPlayer ?? false,
      facesSneak: spec.facesSneak ?? false,
      facesNormal: spec.facesNormal ?? false,
      stateLight: spec.stateLight,
      itemless: spec.itemless ?? false,
      waterPlant: spec.waterPlant ?? false,
    });
  }
  return table;
}

export const BLOCKS: readonly BlockDef[] = buildBlockTable();

export function blockDef(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[0]!;
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
 * 与 `isClimbableBlock` 同一个口径，别在这里写 `blockDef(...).name === 'minecraft:cobweb'`。
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
