/**
 * 村民的作息（J11 尾巴，批次 510）
 *
 * 原版村民有一套 POI（兴趣点）系统：白天去工作站"上班"、傍晚去钟/床附近聚，
 * 夜里回家睡觉。本项目没有那套索引，所以**用一条最简规则**把"像活的"这件事做出来：
 *
 *  - **白天**（`timeOfDay` 0.02 ~ 0.45）：有工作站就往工作站走；到了就停住；
 *  - **其它时间**：有家（床）就往床边走；到了就停住；
 *  - 没有目标（无业又没床）就交给 `Mob` 原有的游荡 AI。
 *
 * 三个刻意的取舍（都写进 TASKS J11）：
 *  1. **不做寻路**：走位复用 `Mob.guardToward`（直线朝目标），村里地面平整，够用；
 *     遇到墙会贴着蹭，不会绕路——那要 A* 的每帧预算，村里十几只村民时不合算。
 *  2. **不睡觉**：到床边只是站着（床上躺下要一套姿态与相机，见 I13 的差异）。
 *  3. **每天一个作息切换点**：不是原版精确到 tick 的时间表；20 分钟一天的节奏下，
 *     玩家看到的是"白天在铺子里、晚上回家"，这就够了。
 *
 * 纯函数、离线可断言：边界时刻、负时间、超过 1 的 timeOfDay 都有确定结果。
 */

export interface RoutinePoint {
  x: number;
  y: number;
  z: number;
}

export type VillagerRoutine = 'work' | 'home' | 'idle';

/** 上班开始/结束（`timeOfDay` 0 = 日出、0.25 = 正午、0.5 = 日落） */
export const VILLAGER_WORK_START = 0.02;
export const VILLAGER_WORK_END = 0.45;

/** 到点多近算"到了"（格）：小于它就不再推 moveDir，免得在目标点上来回抖 */
export const VILLAGER_ARRIVE_RADIUS = 1.6;

/** 把 `timeOfDay` 规整到 [0,1)；脏数据（NaN）按正午算（至少不会让全村同时回家） */
export function normalizeTimeOfDay(timeOfDay: number): number {
  if (!Number.isFinite(timeOfDay)) return 0.25;
  const wrapped = timeOfDay % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

/** 这一刻该干什么（没有对应目标就 `idle`） */
export function villagerRoutine(
  timeOfDay: number,
  hasWorkstation: boolean,
  hasHome: boolean,
): VillagerRoutine {
  const t = normalizeTimeOfDay(timeOfDay);
  const workTime = t >= VILLAGER_WORK_START && t < VILLAGER_WORK_END;
  if (workTime) return hasWorkstation ? 'work' : 'idle';
  return hasHome ? 'home' : 'idle';
}

/** 这一档作息的目的地（没有就是 null） */
export function routineTarget(
  routine: VillagerRoutine,
  home: RoutinePoint | null,
  workstation: RoutinePoint | null,
): RoutinePoint | null {
  if (routine === 'work') return workstation;
  if (routine === 'home') return home;
  return null;
}

/** 离目标够近了吗（按水平距离；村民不会被"在楼上"这种情况卡住） */
export function villagerArrived(
  x: number,
  z: number,
  target: RoutinePoint,
  radius = VILLAGER_ARRIVE_RADIUS,
): boolean {
  return Math.hypot(target.x + 0.5 - x, target.z + 0.5 - z) <= radius;
}
