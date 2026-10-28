/**
 * 极限模式的**唯一判据**（2026-10-28）
 *
 * 为什么单独一个文件：极限会同时改写"难度"和"游戏模式"两件事，而这两件事
 * 在创建表单、世界清单、存档、暂停菜单、`/gamemode`、联机广播里各有一处判断。
 * 以前每处各写一次 `hardcore ? ... : ...`，于是漂成了"创建时锁、运行时不锁"——
 * 极限世界在设置里还能切成创造，创造免伤 → 永不死亡 → 极限名存实亡。
 *
 * 现在：**任何地方要知道"极限下应当是什么"，都只能调这里**。
 * 纯数据 + 纯函数，Node 里可以直接断言（`tools/gamemode-test.ts`）。
 */

import type { GameMode } from './GameMode.ts';
import type { Difficulty } from './Rules.ts';

/** 极限世界固定的模式（新建时写死这个值） */
export const HARDCORE_MODE: GameMode = 'survival';
/** 极限世界固定的难度 */
export const HARDCORE_DIFFICULTY: Difficulty = 'hard';

/**
 * 极限世界里**允许存在**的模式只有两个：
 *  - `survival`：还活着；
 *  - `spectator`：已经死了（原版就是"死亡后只能旁观"，而且这个状态要跨重启保留）。
 *
 * 其余（创造 / 冒险）一律不算数——它们只可能来自"被改坏"的路径。
 */
export function hardcoreAllowsMode(mode: GameMode): boolean {
  return mode === 'survival' || mode === 'spectator';
}

/**
 * 新建世界 / 卡片展示用的有效模式。
 *
 * 极限世界**一律显示生存**：死亡后的旁观是"这名玩家的状态"，不是"这个世界的模式"，
 * 所以清单卡片上仍应写"极限 · 生存"（原版 Java 也是这么显示）。
 */
export function effectiveGameMode(hardcore: boolean, mode: GameMode): GameMode {
  return hardcore ? HARDCORE_MODE : mode;
}

/**
 * 读档用的有效模式（与上面那条的差别只在"旁观"）。
 *
 * 存档里的 `spectator` 必须保住，否则每重启一次就复活一次，"一命"完全不存在；
 * 而 `creative` / `adventure` 只可能来自旧版本的漏洞，一律拉回生存。
 */
export function restoredGameMode(hardcore: boolean, mode: GameMode): GameMode {
  if (!hardcore) return mode;
  return hardcoreAllowsMode(mode) ? mode : HARDCORE_MODE;
}

/** 有效难度：极限恒为困难 */
export function effectiveDifficulty(hardcore: boolean, difficulty: Difficulty): Difficulty {
  return hardcore ? HARDCORE_DIFFICULTY : difficulty;
}

/**
 * 玩家能不能自己改模式。
 *
 * 极限世界不能——`/gamemode`、暂停菜单、编辑世界、联机广播全都问这一条。
 * 内部路径（死亡转旁观、读档恢复）不走这里，它们由 `setGameMode(mode, true)` 放行。
 */
export function canChangeGameMode(hardcore: boolean): boolean {
  return !hardcore;
}
