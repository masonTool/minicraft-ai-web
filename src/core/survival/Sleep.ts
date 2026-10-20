/**
 * 睡觉与重生点（B13 / I13，批次 79）
 *
 * 为什么单独抽一个模块：睡觉的规则（什么时候能睡、什么挡住了你、醒来是哪一刻）
 * 全是**纯数据判断**，没有一条需要世界或 DOM。抽出来之后离线就能把每一条判据钉住
 * ——这与 `BoneMeal.ts` / `Dispense.ts` 是同一套做法：
 * "把判定从主循环里搬到能被断言的地方"。
 *
 * 数值全部对齐原版 1.18 的单人规则：
 *  - **只能在夜晚或雷暴时入睡**（雷暴时白天也能睡）；
 *  - **附近有敌对生物就不能睡**：以床为中心、水平 ±8 格、竖直 ±5 格
 *    （原版 `trySleep` 里那个 `expand(8, 5, 8)` 的检测盒）；
 *  - 睡醒的时刻是**黎明**（本项目 `timeOfDay` 语义下就是 0）。
 */

/** 敌对生物"打扰睡眠"的检测范围：水平 ±8 格 */
export const SLEEP_MONSTER_RADIUS = 8;
/** 敌对生物"打扰睡眠"的检测范围：竖直 ±5 格 */
export const SLEEP_MONSTER_HEIGHT = 5;

/**
 * 黎明：睡醒的时刻。
 *
 * 本项目 `timeOfDay` 的语义是 0 = 日出、0.25 = 正午、0.5 = 日落、0.75 = 午夜，
 * 所以"睡一觉到天亮"就是把它设回 0。
 */
export const DAWN_TIME = 0;

/** 从"睡下"到"天亮"的演出时长（秒）：这段时间里玩家动不了，遮罩渐显 */
export const SLEEP_SECONDS = 1.5;

/** 参与"附近有没有怪物"判定的实体（结构类型：不引实体层，离线测试塞假货即可） */
export interface SleepMob {
  x: number;
  y: number;
  z: number;
  /** 是不是敌对生物（僵尸/骷髅/苦力怕…） */
  hostile: boolean;
  dead: boolean;
}

/** 现在是不是夜晚（0.5 日落之后、1.0 日出之前） */
export function isNight(timeOfDay: number): boolean {
  const t = ((timeOfDay % 1) + 1) % 1;
  return t >= 0.5;
}

/**
 * 床周围有没有敌对生物（原版那份检测盒）。
 *
 * ⚠️ 竖直方向也参与判定：站在床上、而洞顶上下 5 格里卡着一只僵尸，同样睡不着——
 * 原版就是 8×5×8 的一个长方体，不是圆柱。
 */
export function monstersNearBed(
  x: number,
  y: number,
  z: number,
  mobs: readonly SleepMob[],
): boolean {
  // 判定的是**方块坐标**与探测盒的相交：床占一整格，所以比较时用方块中心
  const cx = x + 0.5;
  const cy = y + 0.5;
  const cz = z + 0.5;
  for (const mob of mobs) {
    if (mob.dead || !mob.hostile) continue;
    if (Math.abs(mob.x - cx) > SLEEP_MONSTER_RADIUS) continue;
    if (Math.abs(mob.y - cy) > SLEEP_MONSTER_HEIGHT) continue;
    if (Math.abs(mob.z - cz) > SLEEP_MONSTER_RADIUS) continue;
    return true;
  }
  return false;
}

/** 睡觉判定要吃到的环境快照 */
export interface SleepContext {
  timeOfDay: number;
  /** 是否正在打雷（雷暴时白天也能睡） */
  thundering: boolean;
  /** 玩家是不是已经死了（死了不该能睡） */
  dead: boolean;
  /** 床附近有没有敌对生物（用 `monstersNearBed` 算好再传进来） */
  monstersNear: boolean;
  /** 床的上方是不是被实心方块挡住了（批次 556：原版床需要两格净空） */
  obstructed: boolean;
}

/**
 * 能不能睡；能睡返回 `null`，不能睡返回**给玩家看的那句话**。
 *
 * 提示按"最具体 → 最笼统"排序（这条经验在铁砧与锻造台上各踩过一次）：
 * 先报"附近有怪物"（玩家能立刻去解决），再报"时候不对"。
 */
export function sleepRefusal(context: SleepContext): string | null {
  if (context.dead) return '你正躺着，先起来再说';
  if (context.obstructed) return '床的上方被挡住了，先清出空间';
  if (context.monstersNear) return '你现在无法休息，附近有怪物';
  if (!isNight(context.timeOfDay) && !context.thundering) {
    return '你只能在夜晚或雷暴时入睡';
  }
  return null;
}
