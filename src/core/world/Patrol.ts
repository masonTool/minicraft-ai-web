/**
 * 掠夺者巡逻队（批次 476，J24 的最后一块）
 *
 * 原版规则（本项目取主干）：
 *  - 3~5 只掠夺者成组，在**地表**随机游荡（不围村、不进袭击）；
 *  - 组长（带旗帜的那只）被击杀会掉"不祥之兆"——这是袭击的**正常来源**；
 *  - 有概率夹一只卫道士。
 *
 * 与袭击的分工：袭击是"围绕一个村庄的状态机"（`world/Raid.ts`），
 * 巡逻队没有状态机——它只是一组怪，生成之后就交给普通的敌对生物 AI。
 *
 * 这里只放**纯判据**（数量、队长、要不要生成、环上取点），
 * 造实体与计时都在 main 里。
 */

/** 一组巡逻队的数量范围 */
export const PATROL_MIN = 3;
export const PATROL_MAX = 5;
/** 两次"尝试生成"之间的间隔（秒）。原版约 10 分钟一次尝试，这里压到 90 秒 */
export const PATROL_INTERVAL_SECONDS = 90;
/** 生成距离：玩家周围的一圈（原版 24~48） */
export const PATROL_MIN_DISTANCE = 24;
export const PATROL_MAX_DISTANCE = 48;

export interface PatrolMember {
  readonly kind: 'pillager' | 'vindicator';
  /** 组长（击杀它才掉不祥之兆） */
  readonly leader: boolean;
}

/**
 * 排一组巡逻队。
 *
 * @param roll 0~1 的随机源（`Math.random` 或测试里的固定序列）
 */
export function planPatrol(roll: () => number): PatrolMember[] {
  const size = PATROL_MIN + Math.floor(roll() * (PATROL_MAX - PATROL_MIN + 1));
  const hasVindicator = roll() < 0.25;
  const members: PatrolMember[] = [];
  for (let i = 0; i < size; i++) {
    // 有卫道士时，把它排在最后一只——组长永远是第一只掠夺者
    const isLast = i === size - 1;
    members.push({
      kind: hasVindicator && isLast ? 'vindicator' : 'pillager',
      leader: i === 0,
    });
  }
  return members;
}

/**
 * 这一帧要不要尝试生成巡逻队。
 *
 * 三条"不"：和平难度不刷（原版也是）、已经有一组活着的不再刷（否则会叠成一群）、
 * 间隔没到不刷。
 */
export function shouldTryPatrol(options: {
  readonly elapsed: number;
  readonly interval: number;
  readonly peaceful: boolean;
  readonly activePatrol: number;
}): boolean {
  if (options.peaceful) return false;
  if (options.activePatrol > 0) return false;
  return options.elapsed >= options.interval;
}

/**
 * 巡逻队的落点：以玩家为圆心、半径 24~48 的一圈上（角度与距离都随机）。
 *
 * 取整到方块：实体落点是浮点，但"找可站立格"那一步是按整数格查的，
 * 不取整会让探针落在两个方块之间（探针查的是 floor，结果差一格）。
 */
export function patrolSpawnPoint(
  centerX: number,
  centerZ: number,
  roll: () => number,
): { x: number; z: number } {
  const angle = roll() * Math.PI * 2;
  const distance = PATROL_MIN_DISTANCE + roll() * (PATROL_MAX_DISTANCE - PATROL_MIN_DISTANCE);
  return {
    x: Math.round(centerX + Math.cos(angle) * distance),
    z: Math.round(centerZ + Math.sin(angle) * distance),
  };
}
