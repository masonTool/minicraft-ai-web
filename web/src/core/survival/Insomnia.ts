/**
 * 失眠与幻翼（J15 的最后一只，批次 126）
 *
 * 原版幻翼的生成条件**与地形无关**，只跟玩家自己有关：**连续三个游戏日没有睡觉**，
 * 夜里就会有幻翼从天上俯冲下来。所以这一条不能走"地形刷怪"那套
 * （`MobSpawner` 是按列扫地表找落脚点的），它的判据全是**玩家的状态**——
 * 于是写成纯逻辑放这里，由主程序在每天结算时喂它"几天没睡了"。
 *
 * 这个模块要回答三件事：
 *  1. **够不够久**（`phantomNightIsComing`：≥ 3 天没睡）；
 *  2. **来几只**（`phantomSpawnCount`：3 天 1 只、每多一天 +1、封顶 7 只）；
 *  3. **间隔**（`PHANTOM_SPAWN_INTERVAL`：夜里每隔一会儿来一批）。
 *
 * ⚠️ 与原版的差异（记在 TASKS J15）：
 *  - **不做"睡觉会立刻清空当前这一批幻翼"**（原版睡一觉它们就散了）；
 *  - 幻翼**不拆窗户**（原版它会撞碎玻璃）；
 *  - 生成时**不看月亮相位**（原版也不看，这里只是记一笔"别顺手加"）。
 */

/** 连续几天没睡就会招来幻翼（原版 3 天） */
export const PHANTOM_MIN_DAYS = 3;

/** 一批最多几只（原版封顶 7） */
export const PHANTOM_MAX_COUNT = 7;

/** 夜里每隔多少秒试一次（够玩家"听到声音抬头看"） */
export const PHANTOM_SPAWN_INTERVAL = 25;

/** 幻翼在玩家上方多高盘旋（格；原版它们在 20~30 格上绕圈） */
export const PHANTOM_CIRCLE_HEIGHT = 18;
/** 盘旋半径（格） */
export const PHANTOM_CIRCLE_RADIUS = 9;

/**
 * 这一晚会来幻翼吗（纯函数）。
 *
 * @param daysWithoutSleep 连续没睡的天数（睡着后归零，每天日出 +1）
 * @param isNight 现在是不是夜里（白天它们会烧起来，见 `world/Daylight.ts`）
 * @param alreadySpawned 这一夜已经来过没有（一夜只来一批，免得刷成灾难）
 */
export function phantomNightIsComing(
  daysWithoutSleep: number,
  isNight: boolean,
  alreadySpawned: boolean,
): boolean {
  if (alreadySpawned) return false;
  if (!isNight) return false;
  return daysWithoutSleep >= PHANTOM_MIN_DAYS;
}

/**
 * 这一批来几只：**3 天 1 只，每多一天 +1，封顶 7 只**。
 *
 * 原版就是"越不睡越多"——它是"逼玩家去睡觉"的机制，所以数量必须随天数涨，
 * 否则"失眠三天"与"失眠十天"没有区别。
 */
export function phantomSpawnCount(daysWithoutSleep: number): number {
  if (daysWithoutSleep < PHANTOM_MIN_DAYS) return 0;
  return Math.min(PHANTOM_MAX_COUNT, daysWithoutSleep - PHANTOM_MIN_DAYS + 1);
}
