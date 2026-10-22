/**
 * 创造模式的**撤销 / 重做栈**（创造1，批次 20261022-1954）
 *
 * 这一层只有数据与规则：记录"哪一格从什么变成了什么"，撤销时把 `before` 吐出来、
 * 重做时把 `after` 吐出来。**它不碰 World**——写回由主程序做，所以"写回失败怎么办"
 * 不会污染这里的断言（`tools/buildtools-test.ts`）。
 *
 * 五条口径（都有断言守着）：
 *
 *  1. **一条 = 一次玩家动作**，不是一次方块写入：放一扇门是两格、拆一张床是两格、
 *     将来框选填充是几百格——它们都是**一个** entry，一次撤销全撤掉。
 *     这就是 `begin()` / `end()` 那对"事务"存在的理由。
 *  2. **同一格在一条里被改多次时只留两端**：保留**第一次**的 `before` 与**最后**的
 *     `after`（中间过程对撤销没有意义）；如果首尾相同（放了又拆），这一格整条抹掉——
 *     否则会出现"撤销一次什么都没变"的空步。
 *  3. **新动作清空重做栈**（与所有编辑器一致）：撤销两步之后又放了一块，原来的重做分支就作废了。
 *  4. **栈上限按 entry 数算**（默认 64）：超了丢最旧的。低龄玩家的"撤销"是后悔药，
 *     不是历史记录，64 步够用且内存可控（框选 32³ 一格一条也只有几 MB）。
 *  5. **纯函数、无时间、无随机**：`undo()` 的结果完全由入栈顺序决定，可逐条断言。
 *
 * ⚠️ 已知边界（写在这里，免得以后当成 bug）：
 *  - 只记录**方块 id + 状态**，不记录方块实体内容（箱子里的东西、告示牌上的字、
 *    命令方块里的命令）。撤销一次"拆箱子"会恢复一个**空箱子**——掉落物已经进了背包，
 *    要连内容一起恢复得另做一套快照；
 *  - 流体/重力方块的连带变化（水回流、沙子下落）**不进栈**：它们不是玩家直接改的那一格，
 *    记进来会让"撤销一次"变成"撤销一片"，反而看不懂。
 */

/** 一次方块改动：某一格的 before / after */
export interface BlockEdit {
  /** 维度（`overworld` / `nether` / `end`）：坐标只在维度内有意义 */
  readonly dimension: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly beforeId: number;
  readonly beforeState: number;
  readonly afterId: number;
  readonly afterState: number;
}

/** 一次撤销/重做要写回的格子（**已按应用顺序排好**） */
export interface UndoStep {
  readonly direction: 'undo' | 'redo';
  readonly edits: readonly BlockEdit[];
}

/** 默认保留多少步 */
export const DEFAULT_UNDO_LIMIT = 64;

function keyOf(edit: BlockEdit): string {
  return `${edit.dimension}|${edit.x},${edit.y},${edit.z}`;
}

function isNoop(edit: BlockEdit): boolean {
  return edit.beforeId === edit.afterId && edit.beforeState === edit.afterState;
}

/** 把一批改动归并成"每格只有一条、且首尾不同"（顺序按首次出现的先后） */
function normalize(batch: readonly BlockEdit[]): BlockEdit[] {
  const merged = new Map<string, BlockEdit>();
  for (const edit of batch) {
    // 单条就是 no-op（before == after）时直接丢：`record` 那条路有同样的检查，
    // 但 `push` 走的是这里，漏了会留下"撤销一次但世界没变"的空步
    if (isNoop(edit)) continue;
    const key = keyOf(edit);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, edit);
      continue;
    }
    const next: BlockEdit = {
      ...existing,
      afterId: edit.afterId,
      afterState: edit.afterState,
    };
    if (isNoop(next)) merged.delete(key);
    else merged.set(key, next);
  }
  return [...merged.values()];
}

export class UndoStack {
  /** 撤销栈（栈顶是最后一次动作） */
  private readonly undoEntries: BlockEdit[][] = [];
  /** 重做栈 */
  private readonly redoEntries: BlockEdit[][] = [];
  /** 当前未闭合的事务：`null` 表示没有（单条改动直接入栈） */
  private open: Map<string, BlockEdit> | null = null;
  private readonly limit: number;

  constructor(limit: number = DEFAULT_UNDO_LIMIT) {
    this.limit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : DEFAULT_UNDO_LIMIT;
  }

  /** 栈上限（测试与界面提示用） */
  get maxSteps(): number {
    return this.limit;
  }

  /** 还能撤销几步（**不含**尚未闭合的事务） */
  get undoCount(): number {
    return this.undoEntries.length;
  }

  /** 还能重做几步 */
  get redoCount(): number {
    return this.redoEntries.length;
  }

  get canUndo(): boolean {
    return this.undoEntries.length > 0 || (this.open?.size ?? 0) > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  /**
   * 开一个事务：接下来的 `record` 都归到同一条 entry。
   *
   * 已经在事务里时**不嵌套**（直接复用）：门/床这些"两格"已经在函数内部记录，
   * 外层再开一次只会把两条不同动作合在一起。
   */
  begin(): void {
    this.open ??= new Map();
  }

  /** 记一格改动（自动并入当前事务；没有事务时自成一个 entry） */
  record(edit: BlockEdit): void {
    if (isNoop(edit)) return;
    if (!this.open) {
      this.commit([edit]);
      return;
    }
    const key = keyOf(edit);
    const existing = this.open.get(key);
    if (!existing) {
      this.open.set(key, edit);
      return;
    }
    const next: BlockEdit = { ...existing, afterId: edit.afterId, afterState: edit.afterState };
    if (isNoop(next)) this.open.delete(key);
    else this.open.set(key, next);
  }

  /** 闭合事务并提交（空的直接丢掉——"开了一次但什么都没改"不该占一步） */
  end(): void {
    const open = this.open;
    this.open = null;
    if (!open || open.size === 0) return;
    this.commit([...open.values()]);
  }

  /** 一步到位地记一条（等价于 begin + record... + end） */
  push(batch: readonly BlockEdit[]): void {
    if (this.open) {
      for (const edit of batch) this.record(edit);
      return;
    }
    this.commit(normalize(batch));
  }

  /** 撤销一步：返回要写回的 `before`（没有可撤的返回 null） */
  undo(): UndoStep | null {
    // 事务没闭合就撤销：先收口，别把玩家刚做的动作丢掉
    if (this.open) this.end();
    const entry = this.undoEntries.pop();
    if (!entry) return null;
    this.redoEntries.push(entry);
    // 逆序应用：同一条里若同一格出现两次（理论上已被归并），后记的 before 才是原状
    return { direction: 'undo', edits: [...entry].reverse() };
  }

  /** 重做一步：返回要写回的 `after`（没有可重做的返回 null） */
  redo(): UndoStep | null {
    if (this.open) this.end();
    const entry = this.redoEntries.pop();
    if (!entry) return null;
    // ⚠️ 这里**不能**走 `commit`：它会清空重做栈，重做一步就再也回不去了
    this.undoEntries.push(entry);
    if (this.undoEntries.length > this.limit) this.undoEntries.shift();
    return { direction: 'redo', edits: [...entry] };
  }

  clear(): void {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
    this.open = null;
  }

  private commit(entry: BlockEdit[]): void {
    if (entry.length === 0) return;
    this.undoEntries.push(entry);
    if (this.undoEntries.length > this.limit) this.undoEntries.shift();
    // 新动作之后，原来的重做分支作废
    this.redoEntries.length = 0;
  }
}
