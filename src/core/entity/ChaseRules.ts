/**
 * "要不要追玩家"的判据（J3 第三批，批次 515）
 *
 * 这段逻辑原来直接写在 `Mob.updateAi` 里：一个 `pacified` 布尔 + 一个五条件的 `chasing`。
 * 它同时管着四件互不相干的事——敌对性、亮处中立、记仇计时、隐身与距离——
 * 于是"为什么这只怪不追我"只能靠读那五行、或者跑游戏猜。
 *
 * 抽成纯函数之后：
 *  - **每一条件都能单独断言**（敌对/中立/亮处/记仇/隐身/距离六个维度）；
 *  - `Mob.updateAi` 只负责取数（光照、距离、记仇剩余），不再自己拼条件；
 *  - 以后加"和平难度不追""和平模式不主动"这类规则，只改这一处。
 *
 * ⚠️ 与批次 471 的分工：**谁算"被打"由 `hurt()` 的 `HurtSource` 决定**（环境伤害不记仇），
 * 这里只消费"记仇还剩几秒"。两者不要互相补判——否则摔一下也会翻脸。
 */

export interface ChaseInput {
  /** 这一族是不是敌对生物（僵尸/骷髅…） */
  readonly hostile: boolean;
  /** 亮处中立（蜘蛛）：不记仇时白天不主动攻击 */
  readonly neutral: boolean;
  /** 亮度达到这个值就中立（蜘蛛 11）；没有这个字段的族不适用 */
  readonly neutralInLight: number | undefined;
  /** 记仇剩余秒数（> 0 = 被打过，压过中立） */
  readonly angerRemaining: number;
  /** 这只生物眼睛附近的光照（0~15） */
  readonly lightLevel: number;
  /** 玩家在不在场（旁观者也算玩家，但不该被追——见 `playerInvisible`） */
  readonly playerPresent: boolean;
  /** 玩家隐身（隐身药水/旁观模式）：不主动追 */
  readonly playerInvisible: boolean;
  /** 与玩家的水平距离平方 */
  readonly distanceSq: number;
  /** 这一族的索敌半径（`MobType.followRange`） */
  readonly followRange: number;
}

/**
 * 是不是"此刻不想打人"。
 *
 * 注意顺序：**记仇优先于中立**——蜘蛛被打过之后白天也会还手；
 * 而"亮处中立"只对配了 `neutralInLight` 的族生效。
 */
export function isPacified(input: ChaseInput): boolean {
  if (input.angerRemaining > 0) return false;
  if (input.neutral) return true;
  if (input.neutralInLight !== undefined) return input.lightLevel >= input.neutralInLight;
  return false;
}

/** 这一帧要不要把玩家当追击目标 */
export function shouldChasePlayer(input: ChaseInput): boolean {
  if (!input.hostile || !input.playerPresent || input.playerInvisible) return false;
  if (isPacified(input)) return false;
  return input.distanceSq <= input.followRange * input.followRange;
}
