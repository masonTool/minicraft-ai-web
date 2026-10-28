/**
 * 读档时"看不懂的东西"的记账本（批次 20261025-0117，合规 5）
 *
 * 背景：存档里的方块 / 物品都是**数字 id**（不是名字），所以"改命名空间"本身不会让老档
 * 读不回来；真正会丢掉东西的是**这个 id 在当前版本里不存在了**（删过物品、调过注册表顺序、
 * 或者玩家手改过存档）。三种读档路径原本都是**静默**处理的：
 *   · 方块：`blockDef()` 回退成空气 → 那一片变成空洞，玩家以为"我的房子没了"；
 *   · 物品：`restoreStack()` 返回 null → 背包里少一件，没有任何提示；
 *   · 多格画：`restorePaintings()` 跳过 → 墙上空一片。
 *
 * 静默是**对的**（绝不能因为一个坏 id 让整档打不开），但"发生了什么"必须留痕：
 * 这里只记**种类 + 一句细节 + 次数**，随诊断日志一起导出（见 `game/diagnosticsRuntime.ts`）。
 *
 * 为什么不做成"写日志到 console"：读档发生在世界加载时，控制台在手机上根本看不到；
 * 而这个项目的诊断入口就是「设置 → 日志 → 导出」，把它接在那里才对得上玩家的取日志路径。
 *
 * ⚠️ 纯数据、不碰 DOM / IndexedDB，`test:save` 里能直接断言。
 */

/** 哪一类东西丢了 */
export type SaveIssueKind = 'block' | 'item' | 'painting';

export interface SaveIssueBucket {
  readonly kind: SaveIssueKind;
  /** 一句足以定位的细节（例如 `id=1024`、`name=donkey_kong`） */
  readonly detail: string;
  /** 出现了多少次 */
  readonly count: number;
}

/**
 * 最多记多少种不同的"问题"。
 *
 * 一个坏存档可能有上千个不同的坏 id（比如整体偏移），全记下来只会让导出文件失控；
 * 32 种足够覆盖"删过几样东西"这种真实情况，超出的部分只累加计数（`saveIssueOverflow`）。
 */
const MAX_BUCKETS = 32;

const buckets = new Map<string, { kind: SaveIssueKind; detail: string; count: number }>();
/** 超出 `MAX_BUCKETS` 之后没单独记账的总次数 */
let overflow = 0;

/** 记一笔：同一个 (kind, detail) 累加，不重复占位 */
export function noteSaveIssue(kind: SaveIssueKind, detail: string): void {
  const key = `${kind}|${detail}`;
  const existing = buckets.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  if (buckets.size >= MAX_BUCKETS) {
    overflow += 1;
    return;
  }
  buckets.set(key, { kind, detail, count: 1 });
}

/** 按次数从多到少列出（导出用；只读快照，外部改不动内部状态） */
export function saveIssueReport(): readonly SaveIssueBucket[] {
  return [...buckets.values()]
    .map((bucket) => ({ kind: bucket.kind, detail: bucket.detail, count: bucket.count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.detail.localeCompare(b.detail));
}

/** 一共丢了多少件/格（含溢出部分） */
export function saveIssueTotal(): number {
  let total = overflow;
  for (const bucket of buckets.values()) total += bucket.count;
  return total;
}

/** 溢出（没单独记账）的次数 */
export function saveIssueOverflow(): number {
  return overflow;
}

/** 清空（新建世界 / 测试用；读档前也该清，否则上一次的账会挂在新世界上） */
export function resetSaveIssues(): void {
  buckets.clear();
  overflow = 0;
}
