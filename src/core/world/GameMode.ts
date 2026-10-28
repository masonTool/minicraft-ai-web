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

import { t } from '../i18n/I18n.ts';

export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator';

export const GAME_MODES: readonly GameMode[] = ['survival', 'creative', 'adventure', 'spectator'];

/**
 * **新建世界**时可选的三项（2026-10-28）。
 *
 * 旁观不在这里：一个"建出来就只能看"的世界没有任何下一步动作，玩家进去第一件事
 * 就是改模式（基岩版的创建页同样不提供旁观，只能进世界后用 `/gamemode spectator`）。
 * 编辑世界仍然用 `GAME_MODES`——那要看得到"死亡后已转旁观"的极限存档。
 */
export const CREATION_MODES: readonly GameMode[] = ['survival', 'creative', 'adventure'];

/**
 * 模式的中文名（批次 20261024-0020 之前这里是中文常量表）。
 *
 * ⚠️ 现在**只有一个入口** `gameModeLabel()`，值来自语言表的 `cmd.label.gamemode.*`：
 * 新建世界 / 编辑世界 / 设置 / 调试 HUD / `/gamemode` 回执全都走它。
 * 之前那张 `GAME_MODE_LABELS` 中文常量在德语界面里会直接蹦出「创造」——
 * 用户报「难度与游戏模式没改」时抓的就是这处。
 */
export function gameModeLabel(mode: GameMode): string {
  return t(`cmd.label.gamemode.${mode}`);
}

/**
 * 英文名（批次 617）。
 *
 * ⚠️ 不能只留一张中文表：`/gamemode` 的回执是 `已将游戏模式设置为 ${GAME_MODE_LABELS[mode]}`，
 * 命令文案走 i18n 之后，句式变英文、里面蹦出一个"创造" —— 比不翻更糟。
 * 两张表分开存，`gameModeLabel()` 按当前语言取。
 */

export function isGameMode(value: unknown): value is GameMode {
  return value === 'survival' || value === 'creative' || value === 'adventure' || value === 'spectator';
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

/** 菜单里点一下换下一个模式（四态循环：生存 → 创造 → 冒险 → 旁观） */
export function nextGameMode(mode: GameMode): GameMode {
  if (mode === 'survival') return 'creative';
  if (mode === 'creative') return 'adventure';
  if (mode === 'adventure') return 'spectator';
  return 'survival';
}

/**
 * 冒险模式（批次 549）：能走、能打、能交互，但**不能破坏/放置方块**。
 *
 * 原版的冒险模式还允许用 `CanDestroy` / `CanPlaceOn` 标签给特定方块开口子，
 * 本项目没有物品标签/NBT，所以这一条暂不做（差异记在 TASKS B21）。
 */
export function isAdventureMode(mode: GameMode): boolean {
  return mode === 'adventure';
}

/** 能不能破坏方块：创造与生存可以，冒险与旁观不行 */
export function canBreakBlocks(mode: GameMode): boolean {
  return mode === 'creative' || mode === 'survival';
}

/** 能不能放置方块：口径与破坏一致 */
export function canPlaceBlocks(mode: GameMode): boolean {
  return mode === 'creative' || mode === 'survival';
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

/** 会不会受伤：创造与旁观都免伤；冒险与生存一样会受伤 */
export function canTakeDamage(mode: GameMode): boolean {
  return mode === 'survival' || mode === 'adventure';
}

/** 能不能捡起地上的物品：旁观者不能（原版同口径）；创造可以 */
export function canPickUpItems(mode: GameMode): boolean {
  return mode !== 'spectator';
}
