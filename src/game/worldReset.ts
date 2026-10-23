/**
 * 世界原地重载的**清单**（联机34）。
 *
 * 为什么先有清单、而不是直接写 `resetWorld()`：这条要求"不闪回主菜单就把世界换掉"，
 * 而一局里持有世界数据的地方有二十多处（实体表、掉落物镜像、红石定时器、联机 AOI 表、
 * 时间/天气/位置…）。**漏清一项的表现都很难查**：旧实体站在新地形里、旧 TNT 在新世界炸、
 * 远端玩家镜像停在旧坐标。清单的作用是"执行时逐项打勾"，以及**加新子系统时提醒自己补一行**。
 *
 * 用法（未来接执行路径时）：
 *
 * ```ts
 * const handled: WorldResetTarget[] = [];
 * handled.push('world'); handled.push('entities'); // …
 * const missing = missingResetTargets(handled);    // 少了一项就报出来
 * ```
 *
 * 纯数据 + 纯函数，`tests/world-reset.test.ts` 直接断言。
 */

/**
 * 重载时必须处理的对象。**加新子系统时在这里补一行**——单测会检查清单无重复、非空。
 *
 * 分四组（注释标出），便于执行时按顺序清：先拆世界，再清镜像，最后重置时间与位置。
 */
export const WORLD_RESET_TARGETS = [
  // ① 世界本体：`World` 里装着区块、光照、增量存档、容器表、Worker 池
  'world',
  // `ChunkRenderer` 构造时 `world` 是 readonly 绑定的，换世界必须重建它
  'chunkRenderer',
  // ② 实体与定时器：都直接引用世界里的方块/坐标
  'entities',
  'fallingBlocks',
  'primedTnt',
  'conduits',
  'scheduler',
  // ③ 方块实体表（按坐标存）：牌子 / 展示框
  'signText',
  'itemFrames',
  // ④ 联机镜像与缓冲：全是"另一局/另一处"的数据
  'remotePlayers',
  'remoteSmoothers',
  'remotePresence',
  'remoteAppearance',
  'remoteAoi',
  'remoteTeams',
  'remoteItems',
  'pendingContainers',
  'pendingItemTakes',
  'blockFunnel',
  'netTime',
  // ⑤ 时间、天气、玩家位置与维度：换世界之后这些都不再成立
  'timeOfDay',
  'dayCount',
  'weather',
  'physics',
  'dimension',
  'bedSpawn',
] as const;

export type WorldResetTarget = (typeof WORLD_RESET_TARGETS)[number];

/**
 * 检查"已经处理过哪些"，返回**漏掉的**。
 *
 * 传进来的通常是执行路径里逐项 push 的数组；返回非空就说明有一项没清。
 */
export function missingResetTargets(handled: Iterable<string>): WorldResetTarget[] {
  const done = new Set(handled);
  return WORLD_RESET_TARGETS.filter((target) => !done.has(target));
}

/** 清单是否全处理过了（执行路径收尾时断言一次） */
export function isResetPlanComplete(handled: Iterable<string>): boolean {
  return missingResetTargets(handled).length === 0;
}
