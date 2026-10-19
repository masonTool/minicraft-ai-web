/**
 * 世界生成登记表（B52，批次 118）
 *
 * 存在的理由很具体：**可达性审计（O14）判不了方块**。
 * 它判物品时很硬气——"掉自己"那条捷径只对物品成立；而方块一旦把"`dropFor` 等于自己"
 * 当成来源，**一个配方都没有的方块也能自证拿得到**（染色玻璃、混凝土、彩色陶瓦
 * 就是这么藏的，见 TASKS B52/B53）。要把判据换成"**生成 + 配方 + 掉落**"，
 * 先得有这张表：**哪些方块是世界里长出来的**。
 *
 * 三种来源、两种写法（`origin` 把这件事写在数据里）：
 *  - `derived`：**从生成表直接算出来**——群系地表规则（`columnSurface` ×23 个群系 ×
 *    干燥/浅水/深水三档）、地物（`BIOME_FEATURES` 的树/花/草/蘑菇/睡莲/雪/海带/海草/珊瑚/
 *    浆果/特殊地物，树的木料走 `woodFor`）、矿石（`ORE_BLOCKS`）。
 *    这几张表本来就是数据，所以"算"比"抄"可靠；
 *  - `declared`：**手写**——地形主干（基岩/石头/深板岩/水/岩浆）、洞穴与含水层、
 *    下界与末地的地形与地物、以及**结构**（结构生成器里是一行行 `w.fill(..., Block.X)`，
 *    没有可算的表）。手写的部分靠 `test:genregistry` 的**采样对账**兜底：
 *    每个群系各生成一片区块、每种结构各生成一个实例，采样到的方块必须都在表里
 *    ——**漏一个就红**（这是这张表唯一能自动化的正确性保证）。
 *
 * ⚠️ 这张表**只回答"会不会生成"**，不回答"能不能拿到"：
 * 矿石在地下、末地城在外岛，都是"能生成但要走很远"——那是审计的下一层（白名单）。
 * 反过来，表里**没有**的方块就是"世界里长不出来"，那才是审计要找的东西。
 */

import { Block, bedId, stairsId, stoneVariantId, Wood } from '../registry/blocks.ts';
import { BIOMES } from './Biome.ts';
import { BIOME_FEATURES, SEA_LEVEL, woodFor } from './Features.ts';
import { ORE_BLOCKS, ORE_VEIN_HOST_BLOCKS } from './OreGenerator.ts';
import { columnSurface } from './SurfaceRules.ts';

export interface GenSource {
  /** 稳定的小写键（审计与测试按它取用） */
  readonly key: string;
  /** 给人看的名字（审计报"拿不到"时会指出"这一族本来是它生成的"） */
  readonly label: string;
  /** `derived` = 从生成表算出来；`declared` = 手写（见各自注记） */
  readonly origin: 'derived' | 'declared';
  /** **写它的地方**：报缺口时要能指过去（模块 + 函数/表名） */
  readonly where: string;
  readonly blocks: readonly number[];
}

// ---------------------------------------------------------------- 派生：群系地表规则

/**
 * 群系地表规则能铺出来的方块。
 *
 * 每个群系取三档高度各算一列：**干燥**（地表 70，海平面 63 以上）、**浅水**（60）、
 * **深水**（50，会换成砾石）——`columnSurface` 里那三条分支必须都走到，
 * 否则"冰冻海洋的冰""深海的砾石"这类会漏（批次 91 的采样就是因为没覆盖群系才漏的）。
 */
function surfaceBlocks(): number[] {
  const ids = new Set<number>();
  for (const biome of BIOMES) {
    for (const groundY of [70, 60, 50]) {
      const column = columnSurface(biome, groundY, SEA_LEVEL, 8, 8);
      ids.add(column.surface);
      ids.add(column.subSurface);
      for (const band of column.deepBands ?? []) ids.add(band);
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------- 派生：地物

/** 特殊地物（`BiomeFeature.special` 那六个）各自长出来的方块 */
const SPECIAL_BLOCKS: Record<string, readonly number[]> = {
  cactus: [Block.CACTUS],
  pumpkin: [Block.PUMPKIN],
  melon: [Block.MELON],
  sugar_cane: [Block.SUGAR_CANE],
  dead_bush: [Block.DEAD_BUSH],
  bamboo: [Block.BAMBOO],
  huge_mushroom: [Block.MUSHROOM_STEM, Block.BROWN_MUSHROOM_BLOCK, Block.RED_MUSHROOM_BLOCK],
  ice_spike: [Block.PACKED_ICE],
  moss_patch: [Block.MOSS_BLOCK, Block.MOSS_CARPET, Block.AZALEA, Block.FLOWERING_AZALEA],
  bee_nest: [Block.BEE_NEST],
};

/**
 * 地物（树 / 花 / 草 / 蘑菇 / 睡莲 / 雪层 / 海带 / 海草 / 珊瑚 / 浆果 ……）能长出来的方块。
 *
 * 全部从 `BIOME_FEATURES` 那张表推：**密度为 0 的不算**（表里靠"省略字段"表示 0，
 * 所以这里一律先判有值再收方块），树按 `woodFor(kind)` 取那一套木料。
 */
function featureBlocks(): number[] {
  const ids = new Set<number>();
  const add = (id: number): void => {
    ids.add(id);
  };

  for (const feature of Object.values(BIOME_FEATURES)) {
    // 树：原木 + 木板 + 树叶（`woodFor` 就是那一套，别自己按 kind 拼 id）
    for (const [kind] of feature.trees) {
      // 竹是"第 11 种树"，但它的计划器只写 BAMBOO（`woodFor('bamboo')` 返回橡木只是为了
      // 满足类型）——这里必须单独收，否则竹林会被判成"生成了未登记的方块"（批次 339）
      if (kind === 'bamboo') {
        add(Block.BAMBOO);
        continue;
      }
      const wood = woodFor(kind);
      add(wood.log);
      add(wood.planks);
      add(wood.leaves);
    }
    for (const flower of feature.flowerKinds) add(flower);
    // 草与蕨（成片长的，密度 > 0 就会铺满）
    if (feature.grass > 0) {
      add(Block.SHORT_GRASS);
      add(Block.FERN);
    }
    if (feature.mushrooms > 0) {
      add(Block.RED_MUSHROOM);
      add(Block.BROWN_MUSHROOM);
    }
    if ((feature.lilyPads ?? 0) > 0) add(Block.LILY_PAD);
    if ((feature.snowCover ?? 0) > 0) add(Block.SNOW);
    if ((feature.berries ?? 0) > 0) {
      // 甜浆果丛四阶（`SWEET_BERRY_BUSH_STAGE0..3` 是连续的四个 id；
      // 采样对账抓到过 stage3 —— 结果的丛是第四阶，批次 118）
      for (let stage = 0; stage < 4; stage++) add(Block.SWEET_BERRY_BUSH_STAGE0 + stage);
    }
    if ((feature.kelp ?? 0) > 0) add(Block.KELP);
    if ((feature.seagrass ?? 0) > 0) add(Block.SEAGRASS);
    if ((feature.coral ?? 0) > 0) {
      // 珊瑚礁：珊瑚块 + 珊瑚（丛）+ 珊瑚扇——五种珊瑚各一套（`CORAL_KINDS` 那一族）。
      // ⚠️ "珊瑚"（`Block.CORAL`）是**植物**那一族，与"珊瑚块"`Block.CORAL_BLOCK` 是两族——
      // 采样对账抓到过：只写珊瑚块与扇时，暖水海洋里那片珊瑚丛会漏（批次 118）
      for (let i = 0; i < CORAL_KIND_COUNT; i++) {
        add(Block.CORAL_BLOCK + i);
        add(Block.CORAL + i);
        add(Block.CORAL_FAN + i);
      }
    }
    const special = feature.special;
    if (special) for (const id of SPECIAL_BLOCKS[special] ?? []) add(id);
    // 藤蔓与可可豆挂在树上（`TREE_VINE_CHANCE` / `COCOA_CHANCE`）：只要这个群系有树就可能出现
    if (feature.trees.length > 0) {
      add(Block.VINE);
      add(Block.COCOA_STAGE0);
      add(Block.COCOA_STAGE1);
      add(Block.COCOA_STAGE2);
    }
  }
  return [...ids];
}

/** 珊瑚有五种（`CORAL_KINDS`：管/脑/气泡/火/角），方块/丛/扇各一套连续 id */
const CORAL_KIND_COUNT = 5;

/**
 * 矿脉除矿石本身之外还会写下的方块：**脉体的母岩**（铜脉嵌在花岗岩里、另一条嵌在凝灰岩里，
 * 见 `OreGenerator` 的 `ORES` 表）与**粗铜块**（铜脉里成块出现）。
 *
 * ⚠️ `ORE_BLOCKS` 只收了每个矿种自己的 `ore`/`deepslate` 两格，母岩不在里面——
 * 采样对账抓到过（花岗岩/凝灰岩/粗铜块只在含矿脉的区块里出现，批次 118）。
 * **这批再修一次**：原来这里是手写的 `[GRANITE, TUFF, RAW_COPPER_BLOCK]`，
 * 漏了粗铁块；改成从 `ORES` 表派生（`ORE_VEIN_HOST_BLOCKS`），以后加矿脉不会再漏。
 */
const ORE_VEIN_BLOCKS: readonly number[] = [...ORE_VEIN_HOST_BLOCKS];

// ---------------------------------------------------------------- 手写：地形、下界、末地

/** 地形主干（`OverworldGenerator` + `CaveCarver` + `Aquifer`） */
const TERRAIN_BLOCKS: readonly number[] = [
  Block.BEDROCK,
  Block.STONE,
  Block.DEEPSLATE,
  Block.WATER,
  Block.LAVA,
];

/** 下界的地形与地物（`NetherGenerator`） */
const NETHER_BLOCKS: readonly number[] = [
  Block.NETHERRACK,
  Block.SOUL_SAND,
  Block.SOUL_SOIL,
  Block.BASALT,
  Block.BLACKSTONE,
  Block.MAGMA_BLOCK,
  Block.GLOWSTONE,
  Block.LAVA,
  Block.ANCIENT_DEBRIS,
  Block.NETHER_QUARTZ_ORE,
  // 菌菇树与它那一族（绯红/诡异）
  Block.CRIMSON_STEM,
  Block.WARPED_STEM,
  Block.CRIMSON_NYLIUM,
  Block.WARPED_NYLIUM,
  Block.NETHER_WART_BLOCK,
  Block.WARPED_WART_BLOCK,
  Block.SHROOMLIGHT,
  Block.CRIMSON_FUNGUS,
  Block.WARPED_FUNGUS,
  Block.CRIMSON_ROOTS,
  Block.WARPED_ROOTS,
];

/** 末地（`EndGenerator` + `EndStructures`） */
const END_BLOCKS: readonly number[] = [
  Block.END_STONE,
  Block.OBSIDIAN,
  Block.CHORUS_PLANT,
  Block.CHORUS_FLOWER,
  Block.END_PORTAL,
  Block.TORCH,
];

// ---------------------------------------------------------------- 结构（手写，逐种）

// 黑橡木那三件由 `woodTrio('dark_oak')` 取（本项目**没有深色森林群系**，
// 所以那一族方块只在林地府邸里出现；哪天补了深色森林，`features` 那一档会自动带上它）
// 下界砖的台阶与半砖：**用生成器同一个函数取**（`stoneVariantId`），
// 取不到时退回下界砖本身——与 `NetherFortress.ts` 里那两行的兜底完全一致
const NETHER_BRICK_STAIRS = stoneVariantId('nether_bricks', 'stairs') ?? Block.NETHER_BRICKS;
const NETHER_BRICK_SLAB = stoneVariantId('nether_bricks', 'slab') ?? Block.NETHER_BRICKS;
/**
 * 某种木材的"原木 + 木板 + 台阶"三件。
 *
 * 橡木从常量取（`Wood` 那张表**不含橡木**，见 `woodBlocks` 的由来），其余五种走 `Wood`；
 * 台阶用 `stairsId`（与生成器同一个函数，取不到就退回母方块）。
 */
function woodTrio(name: string): number[] {
  if (name === 'oak') return [Block.OAK_LOG, Block.OAK_PLANKS, stairsId(2)];
  const wood = Wood[name];
  return wood ? [wood.log, wood.planks, wood.stairs] : [];
}

/** 六种木材的名字（沉船按群系换船体木料、村庄按群系换建材，两边都用它） */
const WOOD_NAMES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'] as const;
/** 六种木材的"原木 + 木板 + 台阶" */
const ALL_WOOD_BLOCKS = WOOD_NAMES.flatMap((name) => woodTrio(name));

/**
 * 村庄：**按群系换木料**（`villagePalette`：雪原/针叶林用云杉、热带草原用金合欢、
 * 白桦林用白桦、其余用橡木），沙漠那一种用砂岩家族。加上砾石路、耕地、箱子、
 * 门、火把与 **16 色床**（村民睡的那张，`bedId`）。
 */
const VILLAGE = [
  Block.COBBLESTONE,
  Block.SANDSTONE,
  Block.CUT_SANDSTONE,
  Block.SMOOTH_SANDSTONE,
  stairsId(3), // 砂岩台阶（沙漠村庄的屋顶）
  // 木屋的木料：雪原/针叶林用云杉、热带草原用金合欢、白桦林用白桦、其余用橡木
  ...[...woodTrio('oak'), ...woodTrio('spruce'), ...woodTrio('acacia'), ...woodTrio('birch')],
  Block.OAK_DOOR,
  Block.GLASS,
  Block.WATER,
  Block.GRAVEL,
  Block.TORCH,
  Block.CHEST,
  ...Array.from({ length: 16 }, (_unused, i) => bedId(i)),
];

const MINESHAFT = [Block.OAK_LOG, Block.OAK_PLANKS, Block.OAK_FENCE, Block.CHEST, Block.TORCH, Block.CAVE_SPIDER_SPAWNER];
const STRONGHOLD = [
  Block.STONE_BRICKS,
  Block.MOSSY_STONE_BRICKS,
  Block.CRACKED_STONE_BRICKS,
  Block.OAK_PLANKS,
  Block.TORCH,
  Block.WATER,
  Block.SEA_LANTERN,
  Block.LAVA,
  Block.END_PORTAL_FRAME,
  Block.CHEST,
  Block.SILVERFISH_SPAWNER,
];
const DUNGEON = [Block.MOSSY_COBBLESTONE, Block.COBBLESTONE, Block.CHEST, Block.ZOMBIE_SPAWNER];
// 沉船：船体木料按群系换（六种都可能），箱子里是战利品表
const SHIPWRECK = [...ALL_WOOD_BLOCKS, Block.CHEST];
const OCEAN_MONUMENT = [
  Block.PRISMARINE,
  Block.PRISMARINE_BRICKS,
  Block.DARK_PRISMARINE,
  Block.SEA_LANTERN,
  Block.STONE,
  Block.WATER,
];
// 林地府邸：深色橡木那一族（本项目没有深色森林群系，所以这批方块**只有府邸里能见到**）
const WOODLAND_MANSION = [Block.COBBLESTONE, Block.GLASS, ...woodTrio('dark_oak'), Block.CHEST];
const BASTION = [
  Block.BLACKSTONE,
  Block.POLISHED_BLACKSTONE,
  Block.POLISHED_BLACKSTONE_BRICKS,
  Block.GILDED_BLACKSTONE,
  // 黑石台阶：生成器用 `stoneVariantId('blackstone','stairs')`（见 `Bastion.ts` 的 `STAIRS`）
  stoneVariantId('blackstone', 'stairs') ?? Block.BLACKSTONE,
  Block.CHEST,
];
const NETHER_FORTRESS = [
  Block.NETHER_BRICKS,
  Block.RED_NETHER_BRICKS,
  NETHER_BRICK_STAIRS,
  NETHER_BRICK_SLAB,
  Block.SOUL_SAND,
  Block.NETHER_WART_STAGE0,
  Block.NETHER_WART_STAGE1,
  Block.NETHER_WART_STAGE2,
  Block.NETHER_WART_STAGE3,
  Block.SPAWNER,
  Block.TORCH,
  Block.CHEST,
];
const END_CITY = [Block.PURPUR_BLOCK, Block.PURPUR_PILLAR, Block.END_STONE_BRICKS, Block.END_ROD, Block.CHEST];

// （黑橡木板与下界砖台阶的常量定义在结构那一段之前，见上面"结构（手写，逐种）"的开头）

// ---------------------------------------------------------------- 登记表

export const GENERATION_SOURCES: readonly GenSource[] = [
  {
    key: 'terrain',
    label: '地形主干（基岩/石头/深板岩/水/岩浆）',
    origin: 'declared',
    where: 'gen/OverworldGenerator.ts + gen/CaveCarver.ts + gen/Aquifer.ts',
    blocks: TERRAIN_BLOCKS,
  },
  {
    key: 'surface',
    label: '群系地表规则',
    origin: 'derived',
    where: 'gen/SurfaceRules.ts 的 columnSurface（23 个群系 × 干燥/浅水/深水）',
    blocks: surfaceBlocks(),
  },
  {
    key: 'features',
    label: '地物（树/花/草/蘑菇/睡莲/雪/海带/海草/珊瑚/浆果）',
    origin: 'derived',
    where: 'gen/Features.ts 的 BIOME_FEATURES + woodFor',
    blocks: featureBlocks(),
  },
  {
    key: 'ores',
    label: '矿石与矿脉的母岩',
    origin: 'derived',
    where: 'gen/OreGenerator.ts 的 ORES 表（`ORE_BLOCKS` + 脉体母岩/粗铜块）',
    blocks: [...ORE_BLOCKS, ...ORE_VEIN_BLOCKS],
  },
  {
    key: 'nether',
    label: '下界地形与地物',
    origin: 'declared',
    where: 'gen/NetherGenerator.ts',
    blocks: NETHER_BLOCKS,
  },
  {
    key: 'end',
    label: '末地主岛（末地石/黑曜石柱/紫颂植物）',
    origin: 'declared',
    where: 'gen/EndGenerator.ts',
    blocks: END_BLOCKS,
  },
  { key: 'village', label: '村庄', origin: 'declared', where: 'gen/Structures.ts 的 buildVillage', blocks: VILLAGE },
  { key: 'mineshaft', label: '废弃矿井', origin: 'declared', where: 'gen/Structures.ts 的 buildMineshaft', blocks: MINESHAFT },
  { key: 'stronghold', label: '要塞', origin: 'declared', where: 'gen/Structures.ts 的 buildStronghold', blocks: STRONGHOLD },
  { key: 'dungeon', label: '地牢', origin: 'declared', where: 'gen/Structures.ts 的 buildDungeon', blocks: DUNGEON },
  {
    key: 'spawners',
    label: '刷怪笼（批次 365：烈焰人 / 僵尸 / 洞穴蜘蛛 / 蠹虫）',
    origin: 'declared',
    where: 'gen/Structures.ts 与 gen/NetherFortress.ts',
    blocks: [Block.SPAWNER, Block.ZOMBIE_SPAWNER, Block.CAVE_SPIDER_SPAWNER, Block.SILVERFISH_SPAWNER],
  },
  { key: 'shipwreck', label: '沉船', origin: 'declared', where: 'gen/Structures.ts 的 buildShipwreck', blocks: SHIPWRECK },
  {
    key: 'ocean_monument',
    label: '海底神殿',
    origin: 'declared',
    where: 'gen/Structures.ts 的 buildOceanMonument',
    blocks: OCEAN_MONUMENT,
  },
  {
    key: 'woodland_mansion',
    label: '林地府邸',
    origin: 'declared',
    where: 'gen/Structures.ts 的 buildWoodlandMansion',
    blocks: WOODLAND_MANSION,
  },
  {
    key: 'cave_decor',
    label: '洞穴装饰（发光地衣 / 发光浆果 / 尖滴石 / 滴水石）',
    origin: 'declared',
    where: 'gen/OverworldGenerator.ts 的 decorateCaves',
    blocks: [
      Block.GLOW_LICHEN,
      Block.GLOW_BERRIES,
      Block.POINTED_DRIPSTONE,
      Block.DRIPSTONE_BLOCK,
      Block.SPORE_BLOSSOM,
      Block.HANGING_ROOTS,
    ],
  },
  {
    key: 'amethyst_geode',
    label: '紫晶洞（批次 351）',
    origin: 'declared',
    where: 'gen/Structures.ts 的 buildAmethystGeode',
    blocks: [
      Block.SMOOTH_BASALT,
      Block.CALCITE,
      Block.AMETHYST_BLOCK,
      Block.BUDDING_AMETHYST,
      Block.AMETHYST_CLUSTER,
    ],
  },
  {
    key: 'bastion_remnant',
    label: '堡垒遗迹',
    origin: 'declared',
    where: 'gen/Bastion.ts 的 buildBastion',
    blocks: BASTION,
  },
  {
    key: 'nether_fortress',
    label: '下界要塞',
    origin: 'declared',
    where: 'gen/NetherFortress.ts 的 buildFortress',
    blocks: NETHER_FORTRESS,
  },
  { key: 'end_city', label: '末地城与末地船', origin: 'declared', where: 'gen/EndStructures.ts', blocks: END_CITY },
];

/**
 * 生成能写出的**全部**方块（去重）。
 *
 * ⚠️ 不含**空气**：它不是方块物品，审计与"拿不拿得到"无关
 * （水与岩浆留着——它们是方块，虽然拿到的方式是桶）。
 */
export function generatedBlockIds(): Set<number> {
  const ids = new Set<number>();
  for (const source of GENERATION_SOURCES) {
    for (const id of source.blocks) if (id !== Block.AIR) ids.add(id);
  }
  return ids;
}

/** 这一族方块是谁生成的（审计报"拿得到"时给出出处）；没有任何一处生成它时返回 null */
export function generationSourcesOf(blockId: number): readonly GenSource[] {
  if (blockId === Block.AIR) return [];
  return GENERATION_SOURCES.filter((source) => source.blocks.includes(blockId));
}

/** 调试/自检用：几段来源、去重后多少个方块 */
export function generationStats(): { stages: number; blocks: number } {
  return { stages: GENERATION_SOURCES.length, blocks: generatedBlockIds().size };
}
