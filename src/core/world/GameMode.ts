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

export type GameMode = 'survival' | 'creative' | 'spectator';

export const GAME_MODES: readonly GameMode[] = ['survival', 'creative', 'spectator'];

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  survival: '生存',
  creative: '创造',
  spectator: '旁观',
};

export function isGameMode(value: unknown): value is GameMode {
  return value === 'survival' || value === 'creative' || value === 'spectator';
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

/** 菜单里点一下换下一个模式（三态循环：生存 → 创造 → 旁观） */
export function nextGameMode(mode: GameMode): GameMode {
  if (mode === 'survival') return 'creative';
  if (mode === 'creative') return 'spectator';
  return 'survival';
}

/** 创造模式的能力口径（免伤、瞬间破坏、不耗耐久、无限物品…） */
export function isCreativeMode(mode: GameMode): boolean {
  return mode === 'creative';
}

/**
 * 旁观模式（批次 491，M22）。
 *
 * 三件事与创造**不同**，所以不能用 `isCreative` 顶替：
 *  1. **能穿过方块**（创造也会被墙挡住）；
 *  2. **不能破坏/放置/攻击**（创造什么都能）；
 *  3. **不掉血、也不显示生命条**（这一条与创造相同，但要单独判，否则旁观者会被饿死）。
 */
export function isSpectatorMode(mode: GameMode): boolean {
  return mode === 'spectator';
}

/**
 * 能不能飞：创造与旁观都能。
 *
 * ⚠️ 与 `isCreativeMode` 分开：飞行是**能力**，创造是**权限**。
 * 这两件事混在一起过一次（用 `flying` 当创造模式的判据），代价是"双击跳跃切到了创造模式"。
 */
export function canFly(mode: GameMode): boolean {
  return mode === 'creative' || mode === 'spectator';
}

/** 进入世界时默认是否在飞：旁观必须飞（否则无碰撞 + 重力会穿地）；创造从地面开始 */
export function startsFlying(mode: GameMode): boolean {
  return isSpectatorMode(mode);
}

/** 能不能与方块/实体交互（破坏、放置、右键、攻击）：旁观者一律不行 */
export function canInteract(mode: GameMode): boolean {
  return mode !== 'spectator';
}

/** 会不会被方块挡住：旁观者穿墙 */
export function hasBlockCollision(mode: GameMode): boolean {
  return mode !== 'spectator';
}

/** 会不会受伤：创造与旁观都免伤 */
export function canTakeDamage(mode: GameMode): boolean {
  return mode === 'survival';
}
