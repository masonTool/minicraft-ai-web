/**
 * 小游戏的通关进度（小游戏3，批次 20261022-1954）
 *
 * 存在 `localStorage` 里，**不进世界存档**：小游戏与世界无关，换世界不该丢进度，
 * 而世界存档也不该为了小游戏升级结构版本（那会牵连迁移链与导出格式）。
 *
 * 四条口径：
 *
 *  1. **只记"通关 + 最佳步数"**：不记"玩到第几步""用了多久"——那些是过程数据，
 *     存了就会有人拿它做排行榜，而排行榜需要账号体系（这一期不做）。
 *  2. **坏数据一律当空进度**：localStorage 是外部数据（玩家能改、旧版本能写），
 *     一个坏字段不该让"打开小游戏"直接抛错。
 *  3. **`recordClear` 是纯函数**：只保留更少的步数，方便断言与"重玩不进反退"。
 *  4. **键名带版本**（`mc.minigame.v1`）：以后改结构时换键名，老数据自然失效，
 *     不需要写迁移（这点数据丢了也不心疼）。
 */

/** localStorage 键（带版本：改结构时换 v2，老数据自动失效） */
export const MINIGAME_PROGRESS_KEY = 'mc.minigame.v1';

export interface MiniGameProgress {
  readonly version: 1;
  /** `${gameId}:${level}` → 最佳步数（越小越好） */
  readonly cleared: Readonly<Record<string, number>>;
}

export const EMPTY_PROGRESS: MiniGameProgress = { version: 1, cleared: {} };

/** 关卡键：`sokoban:3`（关卡从 0 起） */
export function levelKey(gameId: string, level: number): string {
  return `${gameId}:${Math.max(0, Math.floor(level))}`;
}

export function isCleared(progress: MiniGameProgress, gameId: string, level: number): boolean {
  return Object.prototype.hasOwnProperty.call(progress.cleared, levelKey(gameId, level));
}

/** 最佳步数；没通关过返回 null */
export function bestSteps(progress: MiniGameProgress, gameId: string, level: number): number | null {
  const value = progress.cleared[levelKey(gameId, level)];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 记一次通关（纯函数）：只保留更少的步数。
 *
 * 重玩一次用了更多步不该把记录改回去；步数非法（NaN / ≤0）按 1 记，
 * 不让脏值进存档。
 */
export function recordClear(
  progress: MiniGameProgress,
  gameId: string,
  level: number,
  steps: number,
): MiniGameProgress {
  const normalized = Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 1;
  const previous = bestSteps(progress, gameId, level);
  if (previous !== null && previous <= normalized) return progress;
  return {
    version: 1,
    cleared: { ...progress.cleared, [levelKey(gameId, level)]: normalized },
  };
}

/** 某个游戏已通关多少关（界面显示"3/10"） */
export function clearedCount(progress: MiniGameProgress, gameId: string, levelCount: number): number {
  let count = 0;
  for (let level = 0; level < levelCount; level++) {
    if (isCleared(progress, gameId, level)) count += 1;
  }
  return count;
}

/** 取存储（隐私模式下 `localStorage` 访问本身就可能抛错） */
function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 读进度：坏数据一律当空进度。
 *
 * 逐条过一遍 `cleared`：键必须是 `字符串:非负整数`，值必须是有限正数。
 * 不这么做的话，一个手改的 `{"cleared":{"x":"abc"}}` 会让 `bestSteps` 返回字符串，
 * 界面上就是 `undefined` 或者更糟的 `NaN`。
 */
export function loadProgress(storage: Storage | null = defaultStorage()): MiniGameProgress {
  if (!storage) return EMPTY_PROGRESS;
  let raw: string | null = null;
  try {
    raw = storage.getItem(MINIGAME_PROGRESS_KEY);
  } catch {
    return EMPTY_PROGRESS;
  }
  if (!raw) return EMPTY_PROGRESS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_PROGRESS;
  }
  if (!parsed || typeof parsed !== 'object') return EMPTY_PROGRESS;
  const record = parsed as { version?: unknown; cleared?: unknown };
  if (record.version !== 1) return EMPTY_PROGRESS;
  if (!record.cleared || typeof record.cleared !== 'object') return EMPTY_PROGRESS;

  const cleared: Record<string, number> = {};
  for (const [key, value] of Object.entries(record.cleared as Record<string, unknown>)) {
    if (!/^[a-z_]+:\d+$/.test(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    cleared[key] = Math.floor(value);
  }
  return { version: 1, cleared };
}

/** 写进度：写失败（配额满 / 隐私模式）静默忽略——进度丢了下局重玩即可 */
export function saveProgress(progress: MiniGameProgress, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(MINIGAME_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // 写不进去就算了，不要因为小游戏进度把主流程打断
  }
}
