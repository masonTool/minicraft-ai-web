/**
 * 难度与游戏规则（I7 / I11）
 *
 * 单独放一个模块的原因：**存档要用它、命令系统要用它、主循环也要用它**，
 * 放在命令模块里会让 `core/save` 反过来依赖命令（层次就乱了）。
 * 这里只有数据与判定，没有任何副作用。
 */

import { t } from '../i18n/I18n.ts';

/** 难度（与原版一致的四档） */
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** 难度的显示名：与 `gameModeLabel()` 同一个口径，值来自 `cmd.label.difficulty.*` */
export function difficultyLabel(difficulty: Difficulty): string {
  return t(`cmd.label.difficulty.${difficulty}`);
}

/** 游戏规则。布尔与数值混在一起，读取时按类型判断 */
export interface GameRules {
  /** 死亡不掉落 */
  keepInventory: boolean;
  /** 是否自然刷怪（关掉后只有刷怪笼/召唤还会出怪） */
  doMobSpawning: boolean;
  /** 生物是否破坏方块（苦力怕炸地形、末影人搬方块） */
  mobGriefing: boolean;
  /** 昼夜是否推进 */
  doDaylightCycle: boolean;
  /** 饥饿值高时是否自然回血 */
  naturalRegeneration: boolean;
  /** 每区块每 tick 的随机刻数量（原版默认 3，0 = 关闭随机刻） */
  randomTickSpeed: number;
  /** 生物死亡是否掉东西（批次 255） */
  doMobLoot: boolean;
  /** 玩家挖方块是否掉东西（批次 255；创造模式本来就不掉） */
  doTileDrops: boolean;
  /** 天气是否自然变化（批次 255；关掉后一直保持当前天气） */
  doWeatherCycle: boolean;
  /** 失眠是否招来幻翼（批次 255） */
  doInsomnia: boolean;
  /** 死亡后是否跳过死亡界面立即重生（批次 255） */
  doImmediateRespawn: boolean;
  /** 摔落是否造成伤害（批次 360） */
  fallDamage: boolean;
  /** 火焰是否造成伤害（批次 360） */
  fireDamage: boolean;
  /** 溺水是否造成伤害（批次 360） */
  drowningDamage: boolean;
  /** 达成进度时是否播提示卡/聊天/音效（批次 361） */
  announceAdvancements: boolean;
  /** 命令执行成功时是否把结果写进聊天栏（批次 361；错误始终显示） */
  sendCommandFeedback: boolean;
  /** 死亡卡片上是否写死因（批次 388；本项目没有聊天死亡消息） */
  showDeathMessages: boolean;
  /** 是否禁用村庄保卫战进度（批次 388） */
  disableRaids: boolean;
  /** 世界出生点的散布半径（批次 393；没有床时的重生位置） */
  spawnRadius: number;
  /**
   * 是否隐藏调试信息（批次 409）。原版是"多人里不让玩家读坐标"的防作弊规则。
   * 本项目退化成**整块收起调试面板**（面板每一行都带坐标，逐行裁剪不如直接收起）。
   */
  reducedDebugInfo: boolean;
  /**
   * 火是否蔓延与熄灭（批次 433）。原版这条规则叫 `doFireTick`。
   *
   * ⚠️ 关掉之后**已经点着的火还在**（也还会伤人），只是不再蔓延、不再烧掉方块、
   * 不会自己熄灭——这与原版一致（原版关掉的是"火被随机刻处理"，不是"删掉所有火"）。
   */
  doFireTick: boolean;
  /**
   * 实体类的掉落（批次 435）：载具被敲坏时掉不掉东西。
   *
   * 与 `doTileDrops`（挖方块）、`doMobLoot`（生物战利品）是三件事：
   * 原版分这三条，是因为"关掉掉落"常常是为了**不留垃圾**，
   * 而载具掉落是玩家最常想关的那一类（矿车掉一地会卡在轨道上）。
   */
  doEntityDrops: boolean;
  /**
   * 是否生成掠夺者**巡逻队**（批次 488）。原版 1.14 起就有这一条。
   *
   * 巡逻队是批次 476 加的，但这条规则一直没跟上——也就是说"做了功能、
   * 玩家却关不掉它"。与 `disableRaids` 是两件事：那条管袭击，这条管地表游荡的小队。
   */
  doPatrolSpawning: boolean;
  /**
   * 命令方块执行命令时是否把结果写进聊天栏（批次 488）。原版 1.9 起就有。
   *
   * 与 `sendCommandFeedback` 分开：命令方块常常接在红石钟上，
   * 每 0.2 秒刷一屏输出正是玩家想关掉的东西。
   */
  commandBlockOutput: boolean;
  /**
   * 细雪是否造成冰冻伤害（批次 625 / Q23）。原版 1.17 起就有。
   *
   * ⚠️ 关掉的是**伤害**，不是"冻住"：玩家照样会在细雪里下沉、视线结霜，
   * 只是不掉血。与 `fireDamage` 是同一个口径（关的是那一条伤害来源）。
   */
  freezeDamage: boolean;
  /**
   * 藤蔓是否蔓延（批次 625 / Q23）。原版 1.19 起才有这条，
   * 但我们的藤蔓蔓延（`tick/RandomTicks.ts` 的 `vineBehavior`）批次 50 就做了 ——
   * 也就是说"做了功能、玩家却关不掉它"，与本条目的动机一致。
   *
   * 关掉后**已经长出来的藤蔓还在**（也还能被拆），只是不再往下长、不再往旁边爬。
   */
  doVinesSpread: boolean;
  /**
   * 雪层最多堆到几层（批次 625 / Q23）。0 = 不再积雪，8 = 整格。
   *
   * ⚠️ 原版这条叫 `snowAccumulationHeight`，**只影响"新雪堆多高"**，
   * 不影响已有雪层的融化，也不影响"光秃秃的地面自己长出第一层雪"
   * （那是区块级降水刻，本项目还没有，见 TASKS K11）。
   */
  snowAccumulationHeight: number;
  /**
   * 是否允许**自然生成流浪商人**（批次 625 / Q23）。
   *
   * ⚠️ **这条现在不生效**（用户已确认"只登记不接行为"）。
   * 原因：流浪商人有种类、刷怪蛋、音色、交易界面（未做），但 `MobSpawner` 里
   * **没有"按周期自发刷新"那套逻辑** —— 它跟村民一样是 `naturalSpawn: false`，
   * 只能靠刷怪蛋/命令见到。没有刷新逻辑，这条规则就没有可挂的行为。
   *
   * 为什么仍然登记：① 原版默认是 `true`，登记后值与原版一致，不会误导；
   * ② 以后补自发刷新时，判据已经在这里了（`SpawnContext.rules.doTraderSpawning`），
   * 不用再想起"是不是还有一条规则"。
   * 等子系统落地后要接的位置写在 TASKS 的 M17 备注里。
   */
  doTraderSpawning: boolean;
  /**
   * 睡眠跳过夜晚需要**多少比例**的玩家在睡（批次 625 / Q23）。
   *
   * ⚠️ **这条现在不改变行为**（用户已确认"只登记不接行为"）。
   * 本项目是单人，`main` 的睡觉流程（`world/Sleep.ts` + 那只床的演出）里
   * **只有你一个人**，"躺下就睡" —— 比例 ≤ 100 全都成立，
   * 而 > 100 在原版里意味着"谁也睡不着"，但我们的睡觉入口不判这条规则。
   *
   * 为什么仍然登记：联机落地后（`net.remote` 已经有人了）这个值就是
   * "要凑够几个人"，判据直接读它即可。
   */
  playersSleepingPercentage: number;
  /**
   * 一次红石脉冲下**命令方块最多连锁执行几个**（批次 625 / Q23）。
   *
   * ⚠️ **这条现在不改变行为**（用户已确认"只登记不接行为"）。
   * 本项目只做**脉冲**命令方块（见 `world/CommandBlocks.ts` 的文件头），
   * 没有循环方块、没有连锁方块，一次脉冲就执行**一条**命令 ——
   * 所以任何 ≥ 1 的值都等价。
   *
   * 为什么仍然登记：原版默认 65536，这条与"有没有命令方块"是两件事；
   * 等连锁命令方块落地时，读的就是这个值（不用再补一条规则、再改一次存档格式）。
   */
  maxCommandChainLength: number;
  /**
   * 是否允许**旁观者加载区块**（批次 625 / Q23）。
   *
   * 本项目的区块流式加载按玩家位置算，旁观者也走同一套循环，所以默认 `true`
   * （对齐原版）。设成 `false` 时，**旁观的玩家不再请求新区块**：
   * 已经加载的照常渲染，走过去也不会让世界继续长。
   *
   * 实现见 `main.ts` 的 `viewDistanceNow`（旁观 + 规则关 → 请求半径压到 0）。
   * ⚠️ 关掉的是"**新**区块生成"，不是"卸载已有区块"——那样会让人眼前一黑。
   */
  spectatorsGenerateChunks: boolean;
}

/**
 * 规则的显示名（批次 20261024-0223）。
 *
 * 原来是 `GAME_RULE_LABELS` 一张中文常量表 —— 与 P6-1 修的 `DIFFICULTY_LABELS` /
 * `GAME_MODE_LABELS` 同一个毛病：命令帮助的 gamerule 下拉在德语/俄语界面上会直接显示中文。
 * 现在走 `cmd.label.gamerule.*`（31 条 × 6 语言）。
 *
 * ⚠️ 键写成模板字面量，`audit:i18n` 才认得出这一族被引用了。
 */
export function gameRuleLabel(rule: keyof GameRules): string {
  return t(`cmd.label.gamerule.${rule}`);
}

export const DEFAULT_GAME_RULES: GameRules = {
  keepInventory: false,
  doMobSpawning: true,
  mobGriefing: true,
  doDaylightCycle: true,
  naturalRegeneration: true,
  randomTickSpeed: 3,
  doMobLoot: true,
  doTileDrops: true,
  doWeatherCycle: true,
  doInsomnia: true,
  doImmediateRespawn: false,
  fallDamage: true,
  fireDamage: true,
  drowningDamage: true,
  announceAdvancements: true,
  sendCommandFeedback: true,
  showDeathMessages: true,
  disableRaids: false,
  spawnRadius: 10,
  reducedDebugInfo: false,
  doFireTick: true,
  doEntityDrops: true,
  doPatrolSpawning: true,
  commandBlockOutput: true,
  // ---- 批次 625 / Q23：6 条新规则（逐条核对过依赖的子系统）----
  freezeDamage: true,
  doVinesSpread: true,
  snowAccumulationHeight: 8,
  doTraderSpawning: true,
  playersSleepingPercentage: 100,
  // 原版默认 65536；本项目一次脉冲只跑一条，取 256 纯粹是"够用且不会让人误以为是 65536"
  maxCommandChainLength: 256,
  spectatorsGenerateChunks: true,
};

/**
 * 命令的执行结果该不该写进聊天栏（批次 488，纯函数）。
 *
 * 两条规则分工：命令方块看 `commandBlockOutput`，玩家手打看 `sendCommandFeedback`。
 * 抽成纯函数是为了能离线断言——main 里只剩"调它一下"。
 */
export function shouldEchoCommandResult(rules: GameRules, fromCommandBlock: boolean): boolean {
  return fromCommandBlock ? rules.commandBlockOutput : rules.sendCommandFeedback;
}

/** 难度的具体系数（伤害倍率、刷怪上限倍率等） */
export interface DifficultyProfile {
  label: string;
  /** 生物对玩家的伤害倍率 */
  mobDamage: number;
  /** 玩家饥饿耗尽时的饿死速率倍率 */
  starveRate: number;
  /** 自然回复的间隔倍率（越小回得越快） */
  regenRate: number;
  /** 是否会生成敌对生物 */
  hostileSpawning: boolean;
  /** 敌对生物上限倍率 */
  spawnCap: number;
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  // 和平：不刷敌对生物、饿不死、回血最快（原版和平难度回血是"饥饿不为 0 就回"）
  peaceful: { label: '和平', mobDamage: 0, starveRate: 0, regenRate: 0.5, hostileSpawning: false, spawnCap: 0 },
  easy: { label: '简单', mobDamage: 0.5, starveRate: 0.5, regenRate: 1, hostileSpawning: true, spawnCap: 0.5 },
  normal: { label: '普通', mobDamage: 1, starveRate: 1, regenRate: 1, hostileSpawning: true, spawnCap: 1 },
  hard: { label: '困难', mobDamage: 1.5, starveRate: 1.5, regenRate: 1, hostileSpawning: true, spawnCap: 1.5 },
};

export function difficultyProfile(difficulty: Difficulty): DifficultyProfile {
  return DIFFICULTY_PROFILES[difficulty] ?? DIFFICULTY_PROFILES.normal;
}

/** 是否是可用的难度名 */
export function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}

/**
 * 每条**数值**规则的取值范围（批次 625 / Q23）。
 *
 * 为什么要分表而不是统一夹到 0~100：以前只有一个 `randomTickSpeed` 与 `spawnRadius`，
 * 一个 100 的上限顺手就够了。`maxCommandChainLength` 一来（原版 65536），
 * 统一夹取会把它悄悄压成 100 —— "设了 256 却生效 100"，这种静默夹取最难查。
 *
 * ⚠️ 加一条数值规则时**必须在这里补一行**：`normalizeGameRules` 与 `/gamerule`
 * 都从这张表取范围。漏了的表现是"命令说设成功、实际被夹回默认上限"。
 */
export const GAME_RULE_RANGES: Readonly<Record<'randomTickSpeed' | 'spawnRadius' | 'snowAccumulationHeight' | 'playersSleepingPercentage' | 'maxCommandChainLength', { min: number; max: number }>> = {
  // 原版默认 3；上限按"每区块每 tick 抽几次"给一个不至于卡死的数
  randomTickSpeed: { min: 0, max: 100 },
  // 原版默认 10；再大就会把人扔到看不见的地形外
  spawnRadius: { min: 0, max: 100 },
  // 8 = 整格（原版上限也是 8）
  snowAccumulationHeight: { min: 0, max: 8 },
  // 原版允许 0~1000，>100 就等于"谁也睡不着"（服务器用它禁止跳夜）
  playersSleepingPercentage: { min: 0, max: 1000 },
  // 原版默认 65536；这里给到同一个量级（本项目一次脉冲本来只跑一条）
  maxCommandChainLength: { min: 0, max: 65536 },
};

/** 把一条数值规则夹进它自己的范围（认不出的规则名按 0~100 兜底） */
export function clampRuleNumber(key: keyof GameRules, value: number): number {
  const range = (GAME_RULE_RANGES as Record<string, { min: number; max: number }>)[key] ?? { min: 0, max: 100 };
  return Math.max(range.min, Math.min(range.max, Math.round(value)));
}

/**
 * 把（可能来自旧存档的）散装数据补齐成一份完整规则。
 * 逐项判断类型：旧存档没有这些字段时全部回退默认值，
 * 有人在存档里写了脏数据也不会把游戏带崩。
 */
export function normalizeGameRules(raw: unknown): GameRules {
  const rules = { ...DEFAULT_GAME_RULES };
  if (!raw || typeof raw !== 'object') return rules;
  const source = raw as Record<string, unknown>;

  for (const key of Object.keys(DEFAULT_GAME_RULES) as Array<keyof GameRules>) {
    const value = source[key];
    if (typeof DEFAULT_GAME_RULES[key] === 'boolean') {
      if (typeof value === 'boolean') (rules[key] as boolean) = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      (rules[key] as number) = clampRuleNumber(key, value);
    }
  }
  return rules;
}

/** 从散装数据里取出难度（非法值回退普通） */
export function normalizeDifficulty(raw: unknown): Difficulty {
  return typeof raw === 'string' && isDifficulty(raw) ? raw : 'normal';
}
