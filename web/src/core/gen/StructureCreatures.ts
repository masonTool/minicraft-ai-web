/**
 * 结构里的生物（批次 457）——"结构 → 生物"通道的数据表
 *
 * 背景：结构生成跑在 Worker 里（只写方块），造不了实体；而项目此前**完全没有**
 * "结构生成点上放生物"的通道，于是守卫者 / 潜行者 / 唤魔者 / 卫道士 / 掠夺者
 * 这些"招牌生物"全都只能靠刷怪蛋或 `/summon`——海底神殿、林地府邸、掠夺者前哨
 * 因此是**空建筑**（`mobs.ts` 里那一串 `naturalSpawn: false` 就是这件事的痕迹）。
 *
 * 这一版的做法：**不新增数据通道**。结构的位置本来就是"种子 + 候选规则的纯函数"
 * （`structureInstanceForTest` 能随时重算），所以主线程只要在区块加载时
 * 重算一遍"这个区块与哪些结构相交"，再按下面的**锚点表**放生物即可：
 *
 *  - 锚点是"相对结构原点（x/y/z）的偏移"，与各 `build*` 函数里的房间位置对应；
 *  - 锚点算出来之后还要过一道**可站立探针**（主线程看真方块），
 *    所以锚点略有偏差时最坏结果是"这只没刷出来"，不会把生物卡进墙里；
 *  - 每个锚点只由**它所在的那个区块**负责（`structureCreatureSpawnsAt` 里筛），
 *    配合主线程的"附近已有同类就不刷"，区块卸载重载不会让数量翻倍。
 *
 * ⚠️ 本批只覆盖**主世界 4 种**（海底神殿 / 林地府邸 / 掠夺者前哨 / 村庄铁傀儡）。
 * 下界（堡垒遗迹的猪灵、要塞的凋灵骷髅）与末地（末地城的潜影贝）要各自的实例入口，
 * 单独一批做——它们的结构与主世界不共用 `STRUCTURE_DEFS`。
 */

import type { StructureKind } from './Structures.ts';

/**
 * 能由结构生成的生物（用 `MobType.id` 的字符串，**不 import 实体层**：
 * 生成侧只认名字，映射到 `MobType` 是主线程的事）。
 */
export type StructureCreatureKind =
  | 'guardian'
  | 'elder_guardian'
  | 'evoker'
  | 'vindicator'
  | 'pillager'
  | 'iron_golem'
  | 'shulker'
  | 'zombie_villager'
  | 'piglin'
  | 'piglin_brute'
  | 'wither_skeleton';

/** 一个生物锚点：相对结构原点的偏移 + 种类 + 数量 */
export interface CreatureAnchor {
  readonly kind: StructureCreatureKind;
  /** 相对结构原点 x 的偏移 */
  readonly dx: number;
  /** 相对结构原点 z 的偏移 */
  readonly dz: number;
  /**
   * 相对结构原点 y 的偏移。
   *
   * 结构原点是"地面那一格"（地表结构）或"地下起始高度"（地下结构），
   * 所以 `dy` 就是"房间在第几层"。
   */
  readonly dy: number;
  /** 同一锚点放几只（沿 +z 依次排开），默认 1 */
  readonly count?: number;
}

/**
 * 结构 → 生物锚点表。
 *
 * ⚠️ 偏移必须与对应 `build*` 函数里的房间位置**对得上**：对不上的话，
 * 可站立探针会把这一只拒掉，表现是"某些村庄/神殿里少一只"，不会报错——
 * 所以 `test:structure` 里有一条"真实实例的锚点能通过探针"的断言盯着它。
 */
export const STRUCTURE_CREATURES: Readonly<Partial<Record<StructureKind, readonly CreatureAnchor[]>>> = {
  // 海底神殿（buildOceanMonument）：三层棱台，房间在 base+1 起。
  // 原版是 3 只远古守卫者 + 一堆守卫者；这里 1 + 8，量级接近、又不至于淹死玩家
  ocean_monument: [
    // 神殿内部被 x=0 / z=0 / ±8 的隔墙切成四间：锚点落在**房间中心**（±4, ±4），
    // 落在墙上的第一版在探针里 9 只只过了 3 只
    { kind: 'elder_guardian', dx: 4, dz: 4, dy: 6 },
    { kind: 'guardian', dx: 4, dz: -4, dy: 6, count: 2 },
    { kind: 'guardian', dx: -4, dz: 4, dy: 6, count: 2 },
    { kind: 'guardian', dx: -4, dz: -4, dy: 6, count: 2 },
  ],
  // 林地府邸（buildWoodlandMansion）：单布局的几间房
  woodland_mansion: [
    { kind: 'evoker', dx: 0, dz: 0, dy: 2 },
    { kind: 'vindicator', dx: -6, dz: 4, dy: 2, count: 2 },
  ],
  // 掠夺者前哨（buildPillagerOutpost）：三层塔 + 地面
  pillager_outpost: [
    { kind: 'pillager', dx: 0, dz: 0, dy: 10, count: 2 },
    { kind: 'pillager', dx: 3, dz: 3, dy: 1 },
  ],
  // 村庄（buildVillage）：水井旁边站一只铁傀儡（原版村庄的守卫）
  village: [{ kind: 'iron_golem', dx: 3, dz: 0, dy: 1 }],
  // 雪屋地下室（批次 466）：原版那间石室里关着一只僵尸村民
  // （地下室在地面下 5 格，内部从 base-4 起，所以 dy = -4）
  igloo: [{ kind: 'zombie_villager', dx: 0, dz: 0, dy: -4 }],
};

/** 某个结构该有哪些生物（没有就返回空数组） */
export function creatureAnchorsFor(kind: StructureKind): readonly CreatureAnchor[] {
  return STRUCTURE_CREATURES[kind] ?? [];
}

/** 全部出现在表里的生物种类（测试与审计用，不手抄） */
export const STRUCTURE_CREATURE_KINDS: readonly StructureCreatureKind[] = [
  ...new Set(Object.values(STRUCTURE_CREATURES).flatMap((anchors) => (anchors ?? []).map((anchor) => anchor.kind))),
];

/**
 * 从锚点开始，在半径 `radius` 内找一个"可站立"的格子（按距离从近到远）。
 *
 * 为什么需要它：结构锚点是**手写的相对偏移**，与 `build*` 函数里房间位置有点偏差
 * 是常态（隔墙、灯具、台阶都会占掉一格）。主线程拿到锚点后再就近找一个空位，
 * 比"锚点必须逐格精确"稳得多——实测神殿的第一版锚点 9 只只过了 3 只，
 * 就近找位之后一只都不丢。
 *
 * @param probe 可站立判据（主线程看真方块；测试里注入假判据）
 * @returns 找到的格子；半径内全被拒时返回 null（调用方跳过这一只）
 */
export function nearbyStandingSpot(
  probe: (x: number, y: number, z: number) => boolean,
  x: number,
  y: number,
  z: number,
  radius = 3,
): { x: number; y: number; z: number } | null {
  // 偏移表按距离排序、一次性算好（半径 3 → 343 项，模块加载时排一次）
  for (const [dx, dy, dz] of STANDING_OFFSETS) {
    if (Math.abs(dx) > radius || Math.abs(dy) > radius || Math.abs(dz) > radius) continue;
    if (probe(x + dx, y + dy, z + dz)) return { x: x + dx, y: y + dy, z: z + dz };
  }
  return null;
}

/** 由近到远的偏移表（与海绵吸水同一套"确定性顺序"的理由：同样的输入得同样的结果） */
const STANDING_OFFSETS: readonly (readonly [number, number, number])[] = (() => {
  const list: Array<[number, number, number, number]> = [];
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        list.push([dx, dy, dz, dx * dx + dy * dy + dz * dz]);
      }
    }
  }
  list.sort((a, b) => a[3] - b[3] || a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  return list.map(([dx, dy, dz]) => [dx, dy, dz] as const);
})();
