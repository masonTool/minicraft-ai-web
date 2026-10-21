/**
 * 记分板（M23）——目标（objective）+ 持有者的分数 + 显示槽位。
 *
 * 为什么单独一个纯类：记分板的规则**一条都不依赖世界**（加目标、加减分、查分、
 * 哪个目标显示在侧边栏），而它又是 `/scoreboard` 与 `/execute if score` 的共同底座。
 * 做成纯类之后，"分数越界回夹""删目标时分数怎么办"这类判定都能在 Node 里钉死。
 *
 * ⚠️ 与原版/基岩版的差异（都写在这里）：
 *  - **没有队伍（team）**：队伍要做队友免伤、碰撞开关、名字颜色、前缀后缀
 *    四套东西，是另一条活的量级；`/execute if score` 与侧边栏不需要它。
 *  - **准则只有 `dummy` 一种**：原版的 `health` / `killed` / `food` 这些统计型准则
 *    依赖"事件计数器"那条通道（本项目只有进度系统里有类似的东西）。
 *    写别的准则会被拒绝，而不是假装接受（假接受会让 `/scoreboard list` 显示一个
 *    永远不动的分数，玩家会以为是 bug）。
 *  - **分数范围按原版的整数范围夹取**（-2147483648 ~ 2147483647）：
 *    不夹的话 `/scoreboard players set 甲 目标 1e12` 会让侧边栏排版崩掉。
 *  - **持有人 16 字符上限**（原版如此）：超长的拒绝，而不是截断——
 *    截断会让两个长名字撞成同一个分数。
 */

/** 显示槽位（原版有 4 个，`list`（Tab 列表）本项目没有 Tab 列表，先留位） */
export type ScoreboardSlot = 'sidebar' | 'list' | 'below_name';

export const SCOREBOARD_SLOTS: readonly ScoreboardSlot[] = ['sidebar', 'list', 'below_name'];

/** 槽位的中文名（命令回执用） */
export const SLOT_LABELS: Readonly<Record<ScoreboardSlot, string>> = {
  sidebar: '侧边栏',
  list: '玩家列表',
  below_name: '名字下方',
};

/** 英文名（批次 617）：理由同 `GAME_MODE_LABELS_EN` */
export const SLOT_LABELS_EN: Readonly<Record<ScoreboardSlot, string>> = {
  sidebar: 'Sidebar',
  list: 'Player list',
  below_name: 'Below name',
};

/** 目前只支持 dummy（见文件头的差异说明） */
export const SUPPORTED_CRITERIA: readonly string[] = ['dummy'];

/** 原版分数是 32 位有符号整数 */
export const SCORE_MIN = -2147483648;
export const SCORE_MAX = 2147483647;

/** 持有人（目标名）最长 16 字符（原版） */
export const HOLDER_MAX_LENGTH = 16;

export interface Objective {
  name: string;
  criterion: string;
  /** 显示名：没写就用目标名本身 */
  displayName: string;
}

export interface ScoreEntry {
  holder: string;
  value: number;
}

/**
 * `/scoreboard players operation` 的运算符（批次 467）。
 *
 * 原版一共 9 个：赋值、四则、取余、取小、取大、交换。
 * 除法/取余的除数为 0 时**分数保持不变**（原版行为，不是报错）。
 */
export type ScoreOperation = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '<' | '>' | '><';

export const SCORE_OPERATIONS: readonly ScoreOperation[] = ['=', '+=', '-=', '*=', '/=', '%=', '<', '>', '><'];

/** 侧边栏最多显示多少行（原版也是 15） */
export const SIDEBAR_MAX_ROWS = 15;

/** 侧边栏视图（纯数据；HUD 只负责画） */
export interface SidebarView {
  title: string;
  rows: ScoreEntry[];
}

/** 存读档用的扁平快照（Map 不能直接进 JSON） */
export interface ScoreboardSnapshot {
  objectives: Array<{ name: string; criterion: string; displayName: string; scores: Array<[string, number]> }>;
  displays: Array<[ScoreboardSlot, string]>;
}

/**
 * **目标名**的合法性（原版：字母/数字/下划线一类，1~16 字符）。
 *
 * ⚠️ 只给目标名用：持有人（玩家昵称）可以是中文，用这个判会把人名全判成非法
 * ——本项目默认昵称就是"玩家"，那会让整张记分板读档后为空。
 */
export function isValidScoreName(text: string, maxLength = HOLDER_MAX_LENGTH): boolean {
  if (text.length === 0 || text.length > maxLength) return false;
  return /^[A-Za-z0-9_.+-]+$/.test(text) && !text.startsWith('.') && !text.startsWith('-');
}

/**
 * **持有人**的合法性：只禁空、超长（16）与空白字符，中文与标点都允许。
 * 空白必须禁：命令是按空格切参数的，"两个人的名字"会被切成两个持有人。
 */
export function isValidHolderName(text: string): boolean {
  if (text.length === 0 || text.length > HOLDER_MAX_LENGTH) return false;
  return !/\s/.test(text);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < SCORE_MIN) return SCORE_MIN;
  if (rounded > SCORE_MAX) return SCORE_MAX;
  return rounded;
}

export class Scoreboard {
  private readonly objectives = new Map<string, Objective>();
  /** 目标名 → (持有人 → 分数)。持有人大小写不敏感，存的时候保留第一次写下的写法 */
  private readonly scores = new Map<string, Map<string, number>>();
  /** 原版第一次写下的大小写就是显示用的写法 */
  private readonly holderCase = new Map<string, string>();
  private readonly displays = new Map<ScoreboardSlot, string>();

  // ------------------------------------------------------------ 目标

  /** 加一个目标；重名返回 false（原版也是"已存在"） */
  addObjective(name: string, criterion: string, displayName?: string): boolean {
    if (this.objectives.has(name)) return false;
    if (!SUPPORTED_CRITERIA.includes(criterion)) return false;
    this.objectives.set(name, { name, criterion, displayName: displayName && displayName.length > 0 ? displayName : name });
    // 分数表必须**在这里就建出来**：`setScore` 靠"这张表在不在"判断目标是否存在，
    // 缺了这一步会表现成"目标建好了但一分都写不进去"（最容易被当成命令解析的 bug）
    this.scores.set(name, new Map());
    return true;
  }

  /** 删目标：连带它的分数与显示槽位一起清掉（原版如此） */
  removeObjective(name: string): boolean {
    if (!this.objectives.delete(name)) return false;
    this.scores.delete(name);
    for (const [slot, value] of [...this.displays]) {
      if (value === name) this.displays.delete(slot);
    }
    return true;
  }

  objective(name: string): Objective | null {
    return this.objectives.get(name) ?? null;
  }

  objectiveNames(): string[] {
    return [...this.objectives.keys()];
  }

  get objectiveCount(): number {
    return this.objectives.size;
  }

  // ------------------------------------------------------------ 槽位

  /** 设置显示槽位；`objective` 传 null 表示清空这个槽位 */
  setDisplay(slot: ScoreboardSlot, objective: string | null): boolean {
    if (objective === null) {
      this.displays.delete(slot);
      return true;
    }
    if (!this.objectives.has(objective)) return false;
    this.displays.set(slot, objective);
    return true;
  }

  display(slot: ScoreboardSlot): string | null {
    return this.displays.get(slot) ?? null;
  }

  /**
   * 侧边栏要显示的内容（批次 456）：标题 + 按分数降序的行（最多 15 行，原版如此）。
   *
   * 抽成纯数据而不是让 HUD 自己去问：`ui/ScoreboardHud` 只负责画，
   * "显示哪个目标、按什么顺序、截到几行"这三条都能离线断言。
   * 没有 sidebar 槽位时返回 null（HUD 整块收起）。
   */
  sidebarView(): SidebarView | null {
    const name = this.displays.get('sidebar');
    if (!name) return null;
    const objective = this.objectives.get(name);
    return {
      title: objective?.displayName ?? name,
      rows: this.listScores(name).slice(0, SIDEBAR_MAX_ROWS),
    };
  }

  // ------------------------------------------------------------ 分数

  /** 直接设值；目标不存在或持有人名非法返回 false */
  setScore(holder: string, objective: string, value: number): boolean {
    const table = this.scores.get(objective);
    if (!table) return false;
    if (!isValidHolderName(holder)) return false;
    this.rememberHolder(holder);
    table.set(holder.toLowerCase(), clampScore(value));
    return true;
  }

  /** 加分（可负）；返回加完之后的值，目标不存在返回 null */
  addScore(holder: string, objective: string, delta: number): number | null {
    const table = this.scores.get(objective);
    if (!table) return null;
    if (!isValidHolderName(holder)) return null;
    this.rememberHolder(holder);
    const key = holder.toLowerCase();
    const next = clampScore((table.get(key) ?? 0) + clampScore(delta));
    table.set(key, next);
    return next;
  }

  /** 减分；返回减完之后的值 */
  removeScore(holder: string, objective: string, delta: number): number | null {
    return this.addScore(holder, objective, -Math.abs(clampScore(delta)));
  }

  /**
   * `/scoreboard players operation`（批次 467）：把 target 的分数变成
   * `target op source`。两边缺分数都按 0 算（原版如此）。
   *
   * @returns 运算后的分数；目标不存在或名字非法返回 null
   */
  operate(
    targetHolder: string,
    targetObjective: string,
    op: ScoreOperation,
    sourceHolder: string,
    sourceObjective: string,
  ): number | null {
    const table = this.scores.get(targetObjective);
    const sourceTable = this.scores.get(sourceObjective);
    if (!table || !sourceTable) return null;
    if (!isValidHolderName(targetHolder) || !isValidHolderName(sourceHolder)) return null;
    this.rememberHolder(targetHolder);
    this.rememberHolder(sourceHolder);
    const key = targetHolder.toLowerCase();
    const sourceKey = sourceHolder.toLowerCase();
    const left = table.get(key) ?? 0;
    const right = sourceTable.get(sourceKey) ?? 0;

    if (op === '><') {
      // 交换：target 拿 source 的值，source 拿 target 的值。两边可能在不同目标里，
      // 所以**先读两个值再写**（就地交换会读到已经改过的那一份）
      table.set(key, clampScore(right));
      sourceTable.set(sourceKey, clampScore(left));
      return table.get(key) ?? null;
    }

    let next: number;
    switch (op) {
      case '=':
        next = right;
        break;
      case '+=':
        next = left + right;
        break;
      case '-=':
        next = left - right;
        break;
      case '*=':
        next = left * right;
        break;
      case '/=':
        next = right === 0 ? left : Math.trunc(left / right);
        break;
      case '%=':
        next = right === 0 ? left : left % right;
        break;
      case '<':
        next = Math.min(left, right);
        break;
      case '>':
        next = Math.max(left, right);
        break;
      default:
        return null;
    }
    table.set(key, clampScore(next));
    return table.get(key) ?? null;
  }

  /** 查分；没有这条记录返回 null（与"分数是 0"区分开：原版 `/get` 也会说"没有"） */
  getScore(holder: string, objective: string): number | null {
    return this.scores.get(objective)?.get(holder.toLowerCase()) ?? null;
  }

  /** 清掉某个持有人的全部分数；返回清了几条 */
  resetHolder(holder: string): number {
    const key = holder.toLowerCase();
    let removed = 0;
    for (const table of this.scores.values()) {
      if (table.delete(key)) removed++;
    }
    this.holderCase.delete(key);
    return removed;
  }

  /** 某个目标的全部分数（按分数降序；侧边栏按这个顺序显示） */
  listScores(objective: string): ScoreEntry[] {
    const table = this.scores.get(objective);
    if (!table) return [];
    return [...table.entries()]
      .map(([key, value]) => ({ holder: this.holderCase.get(key) ?? key, value }))
      .sort((a, b) => (b.value - a.value) || a.holder.localeCompare(b.holder));
  }

  /** 某个持有人出现在哪些目标里（`/scoreboard players list <目标>`） */
  objectivesOf(holder: string): string[] {
    const key = holder.toLowerCase();
    const result: string[] = [];
    for (const [objective, table] of this.scores) {
      if (table.has(key)) result.push(objective);
    }
    return result;
  }

  /**
   * 原版第一次写下的大小写就是显示写法。
   * 不做这一步的话，`/scoreboard players set Alice x 1` 之后侧边栏会显示 `alice`。
   */
  private rememberHolder(holder: string): void {
    const key = holder.toLowerCase();
    if (!this.holderCase.has(key)) this.holderCase.set(key, holder);
  }

  // ------------------------------------------------------------ 存读档

  snapshot(): ScoreboardSnapshot {
    return {
      objectives: [...this.objectives.values()].map((objective) => ({
        name: objective.name,
        criterion: objective.criterion,
        displayName: objective.displayName,
        scores: [...(this.scores.get(objective.name)?.entries() ?? [])].map(([key, value]) => [
          this.holderCase.get(key) ?? key,
          value,
        ]),
      })),
      displays: [...this.displays.entries()],
    };
  }

  /**
   * 从快照恢复。**逐条校验**：读档是最容易把坏数据带进运行时的地方，
   * 一个名字非法的目标就整份丢掉太粗暴，但让它进来又会让侧边栏排版崩掉，
   * 所以"坏的跳过、好的收下"，返回值是跳过的条数（存档迁移的测试会盯这个数）。
   */
  restore(snapshot: ScoreboardSnapshot | null | undefined): number {
    this.reset();
    if (!snapshot) return 0;
    let skipped = 0;
    for (const entry of snapshot.objectives ?? []) {
      if (!isValidScoreName(entry.name) || !SUPPORTED_CRITERIA.includes(entry.criterion)) {
        skipped++;
        continue;
      }
      this.addObjective(entry.name, entry.criterion, entry.displayName);
      for (const [holder, value] of entry.scores ?? []) {
        if (!isValidHolderName(holder || '') || !Number.isFinite(value)) {
          skipped++;
          continue;
        }
        this.setScore(holder, entry.name, value);
      }
    }
    for (const [slot, objective] of snapshot.displays ?? []) {
      if (!SCOREBOARD_SLOTS.includes(slot) || !this.objectives.has(objective)) {
        skipped++;
        continue;
      }
      this.displays.set(slot, objective);
    }
    return skipped;
  }

  reset(): void {
    this.objectives.clear();
    this.scores.clear();
    this.holderCase.clear();
    this.displays.clear();
  }
}
