/**
 * 生物同步的两个前置（联机38）：**全局 id** 与 **谁说了算**。
 *
 * 联机19 只做了"命中事件"（谁打了谁、掉多少血），生物本身的位置从没同步过——
 * 队友那边看到的羊永远站在原地。要补位置同步，动手前必须先答两个问题：
 *
 * 1. **这只生物是谁的？** 客户端各自生成、各自有本地递增 id（`1,2,3...`），
 *    两个人说的"3 号羊"根本不是同一只。所以得像掉落物那样用 `ownerId:localId`
 *    拼一个全局键（`items` 已经是这套，见 `NetItemState` 的注释）。
 * 2. **谁模拟它？** 每端都跑一套 AI 会得到两份互不相同的轨迹。最省的做法是
 *    **离它最近的玩家单方面模拟并上报**，其余端只收——不用引入服务端物理，
 *    也不用"锁定 / 交还"那套握手。
 *
 * ⚠️ **2026-10-25 更新（MS2 之后）**：架构定成"房主唯一模拟"，所以 `pickAuthority` /
 * `isAuthority` 那套"最近玩家当权威"**不再参与决策**（留着是因为它们描述了一个还能用的
 * 判定，将来做"分片模拟"会回来找它）。真正在用的一半只有 `mobKey` / `parseMobKey` /
 * `assignMobKey`——全局键，让两端说的是同一只怪。
 *
 * 这里只放纯函数：主程序要 WebGL 起不来，判定不抽出来就只能靠手测。
 */

/**
 * 生物的全局键（`ownerId:localId`）。
 *
 * 用冒号而不是下划线/短横：两种 id 都是整数，冒号不可能出现在它们里面，
 * 解析时 `split(':')` 永远不会歧义。
 */
export function mobKey(ownerId: number, localId: number): string {
  return `${ownerId}:${localId}`;
}

/** 反解全局键；格式不对返回 null（网络来的东西一律当不可信） */
export function parseMobKey(key: string): { ownerId: number; localId: number } | null {
  const at = key.indexOf(':');
  if (at <= 0 || at === key.length - 1) return null;
  const ownerId = Number(key.slice(0, at));
  const localId = Number(key.slice(at + 1));
  if (!Number.isInteger(ownerId) || !Number.isInteger(localId)) return null;
  if (ownerId < 0 || localId < 0) return null;
  return { ownerId, localId };
}

/** 一个在线玩家的位置（只关心"谁离生物最近"） */
export interface AuthorityCandidate {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 距离平方：开方只为比较大小没有意义，还能少一次 `Math.sqrt` */
export function distanceSquared(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * 这只生物该由谁模拟：**离它最近的玩家**。
 *
 * 平局按 id 小的赢——否则两个人在同一格的极端情况下，两端会各自认为"我是最近"，
 * 于是两份轨迹；id 是全序，用它做 tie-break 两端算出来的结果一定相同。
 *
 * 候选为空（没人在线）时返回 null：没人模拟，生物就停在原地。
 */
export function pickAuthority(
  mob: { x: number; y: number; z: number },
  candidates: readonly AuthorityCandidate[],
): number | null {
  let best: AuthorityCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    // 坐标里混进 NaN（老客户端/坏包）会污染整个比较：直接跳过这个人
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || !Number.isFinite(candidate.z)) continue;
    const distance = distanceSquared(mob, candidate);
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate.id < best.id)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best === null ? null : best.id;
}

/** 我是不是这只生物的权威（权威端才跑 AI 并上报，其余只插值） */
export function isAuthority(myId: number, mob: { x: number; y: number; z: number }, candidates: readonly AuthorityCandidate[]): boolean {
  return pickAuthority(mob, candidates) === myId;
}

/**
 * 给一只生物分配全局键（L8 · MS3）。**幂等**：已经有键就原样返回。
 *
 * `ownerId` 是**分配者**的服务端 id（联机时就是房主）——同一只怪在房主那端与从属端的
 * 镜像共用这一个键，于是"3 号羊"不会再是两只不同的羊。
 *
 * `ownerId` 不是非负整数时不分配（返回空串）：宁可这只生物不同步，也不要造出一个
 * 谁都对不上的键。
 */
export function assignMobKey(mob: { netKey: string; id: number }, ownerId: number): string {
  if (mob.netKey.length > 0) return mob.netKey;
  if (!Number.isInteger(ownerId) || ownerId < 0) return '';
  if (!Number.isInteger(mob.id) || mob.id < 0) return '';
  mob.netKey = mobKey(ownerId, mob.id);
  return mob.netKey;
}
