/**
 * 游戏模式（批次 181）
 *
 * ⚠️ 这个文件存在的理由是**把"模式"和"飞行"拆开**：
 * 以前本项目用 `flying === true` 直接表示创造模式，于是
 * "双击跳跃切飞行"顺带把玩家切成了创造——生存里瞬间破坏、免伤、不掉耐久、
 * 创造物品栏全都是它的副作用。用户明确要求：模式只能在暂停菜单/新建世界里选，
 * 双击跳跃只负责"在创造模式里起降"。
 *
 * 纯数据 + 纯函数：主程序、存档、主菜单与命令层都从这里取口径。
 */

export type GameMode = 'survival' | 'creative';

export const GAME_MODES: readonly GameMode[] = ['survival', 'creative'];

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  survival: '生存',
  creative: '创造',
};

export function isGameMode(value: unknown): value is GameMode {
  return value === 'survival' || value === 'creative';
}

/**
 * 读档/读清单时的容错：不认识的值一律回落到 `fallback`。
 *
 * 老存档没有 `gameMode` 字段，迁移在 `App.loadSaveState` 里做
 *（`flying === true` 视为创造），这里只负责"字段本身是不是合法"。
 */
export function normalizeGameMode(value: unknown, fallback: GameMode = 'survival'): GameMode {
  return isGameMode(value) ? value : fallback;
}

/** 菜单里点一下换下一个模式 */
export function nextGameMode(mode: GameMode): GameMode {
  return mode === 'survival' ? 'creative' : 'survival';
}

/** 创造模式的能力口径（免伤、瞬间破坏、不耗耐久、无限物品…） */
export function isCreativeMode(mode: GameMode): boolean {
  return mode === 'creative';
}
