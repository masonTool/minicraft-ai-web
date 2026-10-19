/**
 * 刷怪笼（批次 92，K6 里"缺刷怪笼方块本身"的那一半）
 *
 * 与村民职业表、战利品表同一个思路：**"这一格出什么"是数据**，
 * 判定与生成逻辑（`core/world/SpawnerTicking.ts` + 主线程）都不认识具体的生物。
 * 表里现在只有一行——下界要塞里的那个笼子出**烈焰人**——但以后要加
 * "僵尸刷怪笼 / 骷髅刷怪笼 / 蠹虫刷怪笼"就是加一行。
 *
 * ⚠️ 与原版的差距（记在 TASKS K6/J26）：
 *  - 笼子里的**生物种类**在状态里（原版是方块实体的 NBT）：本项目一个方块只有
 *    一个字节状态，所以干脆按"哪一方块"来分（一种生物一个方块 id 才装得下），
 *    现在只有一种，先不做；
 *  - 原版"玩家 16 格内才工作"、"生成上限与每个笼子各自的计时"这些细节都收成了表里的几个数。
 */

import { Block } from './blocks.ts';

export interface SpawnerDef {
  /** 哪一种方块是"笼子" */
  readonly block: number;
  /** 出哪种生物（`MobType.id`） */
  readonly mobId: string;
  /**
   * 附近有这么多只同种生物就不再生成（原版是"6 格内 6 只同种"，
   * 这里收成"8 格内 2 只"：单机验收时"笼子里一直有 2 只"就够热闹了，
   * 而 6 只会让下界要塞变成绞肉机）
   */
  readonly maxNearby: number;
  /** 数"附近有几只"的半径（格） */
  readonly radius: number;
  /** 两次生成之间隔多久（秒） */
  readonly interval: number;
  /** 在笼子周围多大范围内找落点（格） */
  readonly spawnRange: number;
  /** 玩家离得多远就不工作（原版 16 格；太远就别浪费计算） */
  readonly activeRadius: number;
}

/** 全部刷怪笼（批次 365 起：下界要塞的烈焰人 + 地牢/矿井/要塞三种） */
export const SPAWNER_DEFS: readonly SpawnerDef[] = [
  {
    block: Block.SPAWNER,
    mobId: 'blaze',
    maxNearby: 2,
    radius: 8,
    interval: 8,
    spawnRange: 4,
    activeRadius: 16,
  },
  {
    block: Block.ZOMBIE_SPAWNER,
    mobId: 'zombie',
    maxNearby: 2,
    radius: 8,
    interval: 10,
    spawnRange: 3,
    activeRadius: 16,
  },
  {
    block: Block.CAVE_SPIDER_SPAWNER,
    mobId: 'cave_spider',
    maxNearby: 2,
    radius: 8,
    interval: 12,
    spawnRange: 3,
    activeRadius: 16,
  },
  {
    block: Block.SILVERFISH_SPAWNER,
    mobId: 'silverfish',
    maxNearby: 2,
    radius: 8,
    interval: 12,
    spawnRange: 3,
    activeRadius: 16,
  },
];

/** 这一格方块是不是刷怪笼；是的话返回它的规则 */
export function spawnerDefFor(blockId: number): SpawnerDef | undefined {
  return SPAWNER_DEFS.find((def) => def.block === blockId);
}
