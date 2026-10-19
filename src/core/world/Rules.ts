/**
 * 难度与游戏规则（I7 / I11）
 *
 * 单独放一个模块的原因：**存档要用它、命令系统要用它、主循环也要用它**，
 * 放在命令模块里会让 `core/save` 反过来依赖命令（层次就乱了）。
 * 这里只有数据与判定，没有任何副作用。
 */

/** 难度（与原版一致的四档） */
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  peaceful: '和平',
  easy: '简单',
  normal: '普通',
  hard: '困难',
};

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
};

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
      (rules[key] as number) = Math.max(0, Math.min(100, Math.round(value)));
    }
  }
  return rules;
}

/** 从散装数据里取出难度（非法值回退普通） */
export function normalizeDifficulty(raw: unknown): Difficulty {
  return typeof raw === 'string' && isDifficulty(raw) ? raw : 'normal';
}
