/**
 * 存档字段迁移框架（C8）
 *
 * 在这之前，`SaveGame.open` 的判断是"版本号不一致就当没有存档"——每加一次字段含义变化，
 * 玩家要么丢档、要么那条老路径得在 `main` 里手写一遍（批次 181 的 `flying → gameMode`
 * 就是那么写的：一段只认那一个字段的 if，散落在读档流程中间）。
 *
 * 这个模块把"迁移"收成**一条按版本号串起来的链**：
 *
 *   v1 ──(migration 1)──▶ v2 ──(migration 2)──▶ v3 …
 *
 * 每条规则只做"从 N 升到 N+1"这一小步，于是：
 *  1. 旧存档总能一步一步走到最新（跳版本也不用写 N² 条规则）；
 *  2. 规则是**纯函数**（输入输出都是普通对象），所以能离线断言；
 *  3. 遇到**比程序还新**的版本（玩家在别的设备上玩过新版本）就明确拒绝，
 *     而不是硬读一半字段把存档写坏——这条比"能读就尽量读"更重要。
 *
 * ⚠️ 迁移只碰**玩家存档**：容器/告示牌/展示框/成就那几份是"按坐标或按 id 存的原始数据"，
 * 它们的字段变化一直靠"读的时候逐项校验、缺了就用默认值"来兼容（见 `ContainerSave`），
 * 不需要版本号。等哪一天它们的**含义**也变了（不是加字段），再往这里加一条 `containers` 的迁移。
 */

import type { GameMode } from '../world/GameMode.ts';

/**
 * 存档结构版本：改了字段**含义**就要 +1，并在这里补一条 `N → N+1` 的规则。
 *
 * 版本史：
 *  - **1**：初版（种子、玩家、区块增量、容器、告示牌、展示框、成就）
 *  - **2**（批次 193）：玩家存档补 `gameMode`（批次 181 引入，但当时只在读档时临时推断）
 */
export const SAVE_VERSION = 2;

/** 迁移能看到的"玩家存档"形状：故意用宽松的记录类型，脏数据不该让迁移抛异常 */
type PlayerRecord = Record<string, unknown>;

export interface PlayerMigration {
  /** 这条规则把存档从哪一版升到哪一版 */
  readonly from: number;
  readonly to: number;
  /** 一句话说明（读档日志里会打出来，出问题时能对上） */
  readonly note: string;
  apply: (player: PlayerRecord) => void;
}

/**
 * 迁移链（按 `from` 升序）。
 *
 * ⚠️ 加规则时**只加新的一条**，不要改旧的：旧规则是"历史如何变成现在"的存档，
 * 改了它会让已经升过级的存档再升一次时行为变样（迁移必须是幂等的）。
 */
export const PLAYER_MIGRATIONS: readonly PlayerMigration[] = [
  {
    from: 1,
    to: 2,
    note: '老存档没有 gameMode：flying === true 视为创造，否则生存',
    apply: (player) => {
      // 已经有 gameMode 的（手改过的存档、或从 2 版回退再升上来）就不动它
      if (typeof player.gameMode === 'string' && player.gameMode.length > 0) return;
      const mode: GameMode = player.flying === true ? 'creative' : 'survival';
      player.gameMode = mode;
    },
  },
];

export interface PlayerMigrationResult {
  player: PlayerRecord;
  /** 实际跑过的规则说明（空数组 = 本来就是最新版） */
  applied: string[];
  from: number;
  to: number;
}

/**
 * 把一份玩家存档从 `fromVersion` 一路迁到 `targetVersion`。
 *
 * @returns 迁移后的对象；**版本比程序新**、或链上缺了某一步时返回 null
 *          （调用方应当按"读不出玩家"处理，而不是拿半份数据去覆盖）
 */
export function migratePlayer(
  raw: unknown,
  fromVersion: number,
  targetVersion: number = SAVE_VERSION,
): PlayerMigrationResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // 存档里写的版本号必须是正整数；脏数据（NaN、字符串、负数）一律当作读不出来
  const from = Number.isFinite(fromVersion) ? Math.floor(fromVersion) : Number.NaN;
  if (!Number.isFinite(from) || from < 1) return null;
  if (from > targetVersion) return null;

  // 拷一份再改：迁移失败时调用方手里那份不该被动过
  const player: PlayerRecord = { ...(raw as PlayerRecord) };
  const applied: string[] = [];
  let version = from;
  while (version < targetVersion) {
    const step = PLAYER_MIGRATIONS.find((migration) => migration.from === version);
    // 链断了：说明代码里漏了一条规则（比"硬读"更安全的是明确失败）
    if (!step) {
      console.warn(`[save] 缺少 v${version} → v${version + 1} 的迁移规则`);
      return null;
    }
    try {
      step.apply(player);
    } catch (error) {
      console.warn(`[save] 迁移 v${step.from} → v${step.to} 失败`, error);
      return null;
    }
    applied.push(`v${step.from}→v${step.to}：${step.note}`);
    version = step.to;
  }

  return { player, applied, from, to: version };
}
