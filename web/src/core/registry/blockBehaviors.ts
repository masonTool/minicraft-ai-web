/**
 * 方块行为表（批次 20261025-0329 · 宿主3）
 *
 * 为什么要有这个文件：方块的**数据**（名字、贴图名、碰撞/发光/形状）要搬到二进制里，
 * 而行为（`stateTiles` / `faceTile` / `stateLight`）是闭包，二进制里放不下——它们必须留在代码里。
 * 所以按**方块名**索引：装表时对每个方块查一次这张表，查到就把行为合上去。
 *
 * 用名字而不是 id 索引：id 由 SPECS 的顺序决定，插一个方块就会整体后移；
 * 名字是稳定的，搬动/插入方块不会让某块的行为悄悄挂到邻居身上。
 *
 * 表内容是**逐字节从 SPECS 里搬过来的**（不是重写的）：搬家是否等价由
 * `tests/fixtures/block-behaviors.golden.json` + `npm run test:behaviors` 判定。
 * 改行为时先跑那条测试看是哪几块变了，再决定要不要 `npm run gen:behaviors`。
 */

import {
  bannerPatternOf,
  caveVinesHaveBerries,
  cauldronLevelOf,
  hasEndPortalEye,
  isComposterReady,
  isFlash,
  isInverted,
  isLavaCauldron,
  isLitState,
  isPowderSnowCauldron,
  isPowered,
  paintingVariantOf,
  sixFacingOf,
  sixFacingOffset,
  sixFacingOpposite,
} from './blockState.ts';
import { bannerPatternTile, railTileFor } from './blocks.ts';
import { DYE_COLORS } from './colors.ts';
import { paintingTile } from './paintings.ts';
import { anchorLight } from '../world/RespawnAnchor.ts';

/**
 * ⚠️ 本文件与 `blocks.ts` 是**循环引用**（`blocks.ts` 要 import 本文件的表来建表）。
 * 这是安全的，但成立的前提很窄：本模块在**求值期只构造闭包**，绝不在模块顶层调用
 * `bannerPatternTile` / `railTileFor` / `anchorLight` 这些来自 `blocks.ts` 的函数。
 * 新增条目时请守住这一条——在顶层"先算个结果出来"会拿到未初始化的绑定。
 */

// ---------------------------------------------------------------- 行为工厂
//
// 这几个是"面级贴图"的工厂（批次 64/65 引入），只在行为里用，随行为一起搬过来。

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

export interface BlockBehavior {
  readonly stateTiles?: (state: number) => readonly [string, string, string];
  readonly faceTile?: (state: number, faceDir: readonly [number, number, number]) => string | undefined;
  readonly stateLight?: (state: number) => number;
}

const ENTRIES: readonly (readonly [string, BlockBehavior])[] = [
  [
    'minicraft:activator_rail',
    {
      stateTiles: (state) => {
        // 通电仍用统一亮图（批次 482：形状 × 通断会翻成 40 张图，而亮轨看不出弯直）
        if (isPowered(state)) return ['activator_rail_on', 'activator_rail_on', 'activator_rail_on'];
        const key = railTileFor(state, 'activator_rail');
        return [key, key, key];
      },
    },
  ],
  [
    'minicraft:barrel',
    {
      faceTile: barrelFace,
    },
  ],
  [
    'minicraft:blast_furnace',
    {
      faceTile: frontTile('blast_furnace_front', 'blast_furnace_front_on'),
      stateLight: (state) => (isLitState(state) ? 13 : 0),
    },
  ],
  [
    'minicraft:campfire',
    {
      stateLight: (state) => (isLitState(state) ? 15 : 0),
      stateTiles: (state) =>
        isLitState(state)
          ? ['campfire_fire', 'oak_log_top', 'campfire_side']
          : ['campfire_top', 'oak_log_top', 'campfire_side'],
    },
  ],
  [
    'minicraft:cauldron',
    {
      stateTiles: (state) =>
        isLavaCauldron(state)
          ? ['cauldron_lava', 'cauldron_bottom', 'cauldron_side']
          : isPowderSnowCauldron(state)
            ? ['powder_snow', 'cauldron_bottom', 'cauldron_side']
            : cauldronLevelOf(state) > 0
              ? ['cauldron_water', 'cauldron_bottom', 'cauldron_side']
              : ['cauldron_top', 'cauldron_bottom', 'cauldron_side'],
    },
  ],
  [
    'minicraft:cave_vines',
    {
      stateTiles: (state) => {
        const tile = caveVinesHaveBerries(state) ? 'cave_vines_berries' : 'cave_vines';
        return [tile, tile, tile];
      },
    },
  ],
  [
    'minicraft:composter',
    {
      stateTiles: (state) =>
        isComposterReady(state)
          ? ['composter_ready', 'composter_bottom', 'composter_side']
          : ['composter_top', 'composter_bottom', 'composter_side'],
    },
  ],
  [
    'minicraft:daylight_detector',
    {
      stateTiles: (state) =>
        isInverted(state)
          ? ['daylight_detector_inverted_top', 'daylight_detector_side', 'daylight_detector_side']
          : ['daylight_detector_top', 'daylight_detector_side', 'daylight_detector_side'],
    },
  ],
  [
    'minicraft:deepslate_redstone_ore',
    {
      stateLight: (state) => (isPowered(state) ? 9 : 0),
      stateTiles: (state) =>
        isPowered(state)
          ? ['deepslate_redstone_ore_lit', 'deepslate_redstone_ore_lit', 'deepslate_redstone_ore_lit']
          : ['deepslate_redstone_ore', 'deepslate_redstone_ore', 'deepslate_redstone_ore'],
    },
  ],
  [
    'minicraft:detector_rail',
    {
      stateTiles: (state) => {
        // 通电仍用统一亮图（批次 482：形状 × 通断会翻成 40 张图，而亮轨看不出弯直）
        if (isPowered(state)) return ['detector_rail_on', 'detector_rail_on', 'detector_rail_on'];
        const key = railTileFor(state, 'detector_rail');
        return [key, key, key];
      },
    },
  ],
  [
    'minicraft:dispenser',
    {
      faceTile: nozzleTile('dispenser_top'),
    },
  ],
  [
    'minicraft:dropper',
    {
      faceTile: nozzleTile('dropper_top'),
    },
  ],
  [
    'minicraft:end_portal_frame',
    {
      stateTiles: (state) =>
        hasEndPortalEye(state)
          ? ['end_portal_frame_eye', 'end_portal_frame', 'end_portal_frame']
          : ['end_portal_frame', 'end_portal_frame', 'end_portal_frame'],
    },
  ],
  [
    'minicraft:ender_chest',
    {
      faceTile: nozzleTile('ender_chest_front'),
    },
  ],
  [
    'minicraft:furnace',
    {
      faceTile: frontTile('furnace_front', 'furnace_front_on'),
      stateLight: (state) => (isLitState(state) ? 13 : 0),
    },
  ],
  [
    'minicraft:heavy_weighted_pressure_plate',
    {
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
    },
  ],
  [
    'minicraft:light_weighted_pressure_plate',
    {
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
    },
  ],
  [
    'minicraft:observer',
    {
      faceTile: observerFace,
    },
  ],
  [
    'minicraft:painting',
    {
      stateTiles: (state) => {
        const tile = paintingTile(paintingVariantOf(state));
        return [tile, tile, tile];
      },
    },
  ],
  [
    'minicraft:piston',
    {
      faceTile: nozzleTile('piston_top'),
    },
  ],
  [
    'minicraft:powered_rail',
    {
      stateTiles: (state) => {
        // 通电仍用统一亮图（批次 482：形状 × 通断会翻成 40 张图，而亮轨看不出弯直）
        if (isPowered(state)) return ['powered_rail_on', 'powered_rail_on', 'powered_rail_on'];
        const key = railTileFor(state, 'powered_rail');
        return [key, key, key];
      },
    },
  ],
  [
    'minicraft:rail',
    {
      stateTiles: (state) => {
        const key = railTileFor(state);
        return [key, key, key];
      },
    },
  ],
  [
    'minicraft:redstone_lamp',
    {
      stateLight: (state) => (isPowered(state) ? 15 : 0),
      stateTiles: (state) =>
        isPowered(state)
          ? ['redstone_lamp_on', 'redstone_lamp_on', 'redstone_lamp_on']
          : ['redstone_lamp', 'redstone_lamp', 'redstone_lamp'],
    },
  ],
  [
    'minicraft:redstone_ore',
    {
      stateLight: (state) => (isPowered(state) ? 9 : 0),
      stateTiles: (state) =>
        isPowered(state)
          ? ['redstone_ore_lit', 'redstone_ore_lit', 'redstone_ore_lit']
          : ['redstone_ore', 'redstone_ore', 'redstone_ore'],
    },
  ],
  [
    'minicraft:respawn_anchor',
    {
      stateLight: (state) => anchorLight(state),
    },
  ],
  [
    'minicraft:smoker',
    {
      faceTile: frontTile('smoker_front', 'smoker_front_on'),
      stateLight: (state) => (isLitState(state) ? 13 : 0),
    },
  ],
  [
    'minicraft:sticky_piston',
    {
      faceTile: nozzleTile('sticky_piston_top'),
    },
  ],
  [
    'minicraft:target',
    {
      stateTiles: (state) =>
        isPowered(state)
          ? ['target_top_on', 'target_top_on', 'target_side_on']
          : ['target_top', 'target_top', 'target_side'],
    },
  ],
  [
    'minicraft:tnt',
    {
      stateTiles: (state) =>
        isPowered(state) && isFlash(state)
          ? ['tnt_primed_top', 'tnt_primed_top', 'tnt_primed_side']
          : ['tnt_top', 'tnt_bottom', 'tnt_side'],
    },
  ],
  [
    'minicraft:tripwire_hook',
    {
      stateTiles: (state) =>
        isPowered(state)
          ? ['tripwire_hook_powered', 'tripwire_hook_powered', 'tripwire_hook_powered']
          : ['tripwire_hook', 'tripwire_hook', 'tripwire_hook'],
    },
  ],
];

/**
 * 16 面旗帜（脚本搬不动的模板名，单独在这里按颜色生成）：
 * 底色决定贴图名，状态位只存"烫了哪种图案"（批次 497）。
 */
const BANNER_BEHAVIORS: readonly (readonly [string, BlockBehavior])[] = DYE_COLORS.map((color) => [
  `minicraft:${color.name}_banner`,
  {
    stateTiles: (state: number) => {
      const tile = bannerPatternTile(color.name, bannerPatternOf(state));
      return [tile, tile, tile];
    },
  },
]);

export const BLOCK_BEHAVIORS: ReadonlyMap<string, BlockBehavior> = new Map([
  ...ENTRIES,
  ...BANNER_BEHAVIORS,
]);
