/**
 * 生物的目标规则（J3 的第一批，批次 512）
 *
 * 在此之前"谁打谁"只有一条硬编码在 `main.tickGuardians` 里的规则：铁傀儡打敌对生物。
 * 这一批把它抽成**一张表**，并接上第二种消费者（狼），于是：
 *
 *  - 铁傀儡：敌对生物（行为与批次 474 完全一致，只是从"写死的 if"变成"查表"）；
 *  - 野狼：羊 / 兔 / 鸡（原版野狼会捕猎这些小动物）；
 *  - 驯服的狼：敌对生物（帮主人打架；原版还会打主人打的那只，这里用"附近敌对"近似）。
 *
 * 判据全在纯函数里：`targetRuleFor` 给出这一只的攻击参数，`ruleAccepts` 判"这一目标算不算"。
 * 主程序只负责遍历、下指令、结算伤害——**不要再往 `Mob.tick` 的"追玩家"分支里塞**。
 *
 * 雪傀儡（批次 513）也在这张表里：远程扔雪球（0 伤害 + 击退），射程 10、1.5 秒一颗。
 */

export interface TargetRule {
  /** 索敌半径（格，水平距离） */
  readonly range: number;
  /** 近战触及（格） */
  readonly attackRange: number;
  /** 出手间隔（秒） */
  readonly cooldown: number;
  /** 一次伤害（点） */
  readonly damage: number;
  /** 只认这些生物 id；`null` = 不按 id 白名单，改用 `hostileOnly` */
  readonly ids: ReadonlySet<string> | null;
  /** 只打 `hostile` 生物（铁傀儡/驯服狼/雪傀儡） */
  readonly hostileOnly: boolean;
  /** 远程攻击（雪傀儡扔雪球）：不近战，到了射程就投 */
  readonly ranged: boolean;
}

/** 雪傀儡的雪球初速与抬升（格/秒）：抬升用来补偿重力，不然十格外一定打空 */
export const SNOW_GOLEM_THROW_SPEED = 12;
export const SNOW_GOLEM_THROW_ARC = 2.4;

/** 野狼的猎物：原版会捕猎的小动物 */
const WOLF_PREY: ReadonlySet<string> = new Set(['sheep', 'rabbit', 'chicken']);

const IRON_GOLEM_RULE: TargetRule = {
  range: 16,
  attackRange: 2.2,
  cooldown: 1.2,
  damage: 7,
  ids: null,
  hostileOnly: true,
  ranged: false,
};

const WILD_WOLF_RULE: TargetRule = {
  range: 16,
  attackRange: 2,
  cooldown: 1,
  damage: 4,
  ids: WOLF_PREY,
  hostileOnly: false,
  ranged: false,
};

const TAMED_WOLF_RULE: TargetRule = {
  ...WILD_WOLF_RULE,
  ids: null,
  hostileOnly: true,
  ranged: false,
};

/**
 * 雪傀儡（批次 513）：**远程扔雪球**（0 伤害 + 击退，与原版一致）。
 *
 * 射程 10 格、1.5 秒一颗；它不会近战——到了射程就投，被贴脸也只会后退着扔。
 */
const SNOW_GOLEM_RULE: TargetRule = {
  range: 10,
  attackRange: 10,
  cooldown: 1.5,
  damage: 0,
  ids: null,
  hostileOnly: true,
  ranged: true,
};

/**
 * 这一只生物有没有攻击规则；没有就返回 null（交给 `Mob.tick` 原有一套）。
 *
 * @param tamed 狼要分"野生/驯服"两套规则；其它生物忽略这个参数
 */
export function targetRuleFor(typeId: string, tamed: boolean): TargetRule | null {
  if (typeId === 'iron_golem') return IRON_GOLEM_RULE;
  if (typeId === 'wolf') return tamed ? TAMED_WOLF_RULE : WILD_WOLF_RULE;
  if (typeId === 'snow_golem') return SNOW_GOLEM_RULE;
  return null;
}

/** 这一目标算不算这条规则要打的（调用方负责先把"自己"与尸体剔掉） */
export function ruleAccepts(
  rule: TargetRule,
  candidate: { type: { id: string; hostile: boolean } },
): boolean {
  if (rule.ids !== null) return rule.ids.has(candidate.type.id);
  if (rule.hostileOnly) return candidate.type.hostile;
  return false;
}
