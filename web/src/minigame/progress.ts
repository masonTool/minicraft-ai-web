/**
 * 小游戏的最高分（J0，批次 20261022-2220）
 *
 * 存在 `localStorage` 里，**不进世界存档**：小游戏与世界无关，换世界不该丢记录，
 * 而世界存档也不该为了小游戏升级结构版本（那会牵连迁移链与导出格式）。
 *
 * 四条口径：
 *
 *  1. **只记最高分**：不记"玩了多久""跳了多少次"——那些是过程数据，
 *     存了就会有人拿它做排行榜，而排行榜需要账号体系（这一期不做）。
 *  2. **坏数据一律当空进度**：localStorage 是外部数据（玩家能改、旧版本能写），
 *     一个坏字段不该让"打开小游戏"直接抛错。
 *  3. **`recordScore` 是纯函数**：只保留更高的分数，方便断言与"重玩不进反退"。
 *  4. **键名带版本**（`mc.minigame.v2`）：v1 是旧关卡进度（那两个已下线的游戏），
 *     这一期直接丢弃——那点数据丢了也不心疼，不写迁移。
 */

/** localStorage 键（带版本：改结构时换 v3，老数据自动失效） */
export const MINIGAME_PROGRESS_KEY = 'mc.minigame.v2';

export interface MiniGameProgress {
  readonly version: 2;
  /** gameId → 最高分 */
  readonly best: Readonly<Record<string, number>>;
}

export const EMPTY_PROGRESS: MiniGameProgress = { version: 2, best: {} };

/** 某个游戏的最高分；没玩过返回 0（界面上不显示"暂无"两套状态） */
export function bestScore(progress: MiniGameProgress, gameId: string): number {
  const value = progress.best[gameId];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * 记一局得分（纯函数）：只保留更高的分数。
 *
 * 重玩一局分数更低不该把记录改回去；分数非法（NaN / ≤0）按 1 记，
 * 不让脏值进存储——但 0 分是合法的一局（一开局就掉下去），只是不覆盖任何记录。
 */
export function recordScore(progress: MiniGameProgress, gameId: string, score: number): MiniGameProgress {
  const normalized = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
  if (normalized <= bestScore(progress, gameId)) return progress;
  return { version: 2, best: { ...progress.best, [gameId]: normalized } };
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
 * 逐条过一遍 `best`：键必须是游戏 id 的形状，值必须是有限正数。
 * 不这么做的话，一个手改的 `{"best":{"jump":"abc"}}` 会让界面显示 `NaN`。
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
  const record = parsed as { version?: unknown; best?: unknown };
  if (record.version !== 2) return EMPTY_PROGRESS;
  if (!record.best || typeof record.best !== 'object') return EMPTY_PROGRESS;

  const best: Record<string, number> = {};
  for (const [key, value] of Object.entries(record.best as Record<string, unknown>)) {
    if (!/^[a-z_]+$/.test(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    best[key] = Math.floor(value);
  }
  return { version: 2, best };
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
