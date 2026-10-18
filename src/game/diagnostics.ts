/**
 * 操作日志（诊断用）
 *
 * 由来：用户在手机上遇到"切模式后摇杆反向、视角卡死"这类问题时，只能靠嘴描述，
 * 而这类 bug 的根因往往在**输入状态机**里（哪个指针没释放、手势计时器还在不在）。
 * 静态看代码只能猜，跑起来一看日志就明白。
 *
 * 设计三条：
 *  1. **结构化事件**（不是自由文本）：`cat` + `name` + 少量 `data`，既能给人读，
 *     也能让 AI 顺着 `seq` / `frame` 还原操作顺序；
 *  2. **有界**：环形缓冲 + 落盘预算（默认 500KB），超出只丢**最旧**的，
 *     永远保留最近一次现场；
 *  3. **纯逻辑**：本文件不碰 DOM，Node 里可以直接断言；
 *     浏览器胶水在 `diagnosticsRuntime.ts`。
 */

export type LogCategory =
  | 'app'
  | 'input'
  | 'gesture'
  | 'ui'
  | 'inventory'
  | 'world'
  | 'mode'
  | 'perf'
  | 'error'
  | 'mark';

export interface LogEvent {
  /** 单调序号（一次会话内唯一） */
  seq: number;
  /** 相对会话开始的毫秒数（保留 1 位小数） */
  t: number;
  /** 第几帧（主循环递增；不在循环里的事件沿用当前值） */
  frame: number;
  cat: LogCategory;
  name: string;
  data?: Record<string, unknown>;
}

export interface LogSession {
  id: string;
  /** 会话开始的绝对时间（epoch ms） */
  startedAt: number;
  events: LogEvent[];
}

/** 单条字符串的上限：堆栈可以很长，但不能让它一条吃掉整个预算 */
const MAX_STRING = 240;
/**
 * 对象/数组最多保留多少项。
 *
 * ⚠️ 批次 210：原来是 **16**，而 `perf/sample` 已经有 **29 个键**（`perfSnapshot` 23 个
 * + 实体构成 3 个 + 帧间距/cpu/phases 3 个），`sanitizeData` 是**按插入顺序保留前面
 * 若干项**，于是后面那些键被**静默丢掉**——丢的还正好是后来才加在末尾的：
 * 批次 202 的 `calls/tris/heapMb`、批次 205 的 `cpu/phases` 从来没进过日志，
 * "卡在 CPU 还是 GPU"查了两批都没答案，就是因为这个上限。
 * 放宽的代价只有几十字节/条（预算按字符算，见 `trimSessions`），
 * 而"悄悄少一个键"没人会发现。**给 `data` 加键加到接近这个数时，这里要一起调。**
 */
const MAX_ITEMS = 32;
/** 数据最多展开几层 */
const MAX_DEPTH = 2;

/**
 * 把任意值裁成"可安全落盘"的形状。
 *
 * 三件事：去掉函数/undefined、截断超长字符串、限制深度与宽度。
 * 不做这一步的话，一个 DOM 事件对象就能把 500KB 预算一次吃光。
 */
export function sanitizeData(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value.slice(0, MAX_ITEMS)) {
      const clean = sanitizeData(item, depth + 1);
      if (clean !== undefined) out.push(clean);
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (n >= MAX_ITEMS) break;
      const clean = sanitizeData(item, depth + 1);
      if (clean === undefined) continue;
      out[key] = clean;
      n++;
    }
    return out;
  }
  return String(value);
}

/**
 * 环形缓冲。
 *
 * 用 `shift()` 也能写，但它在 4000 条时每次都要搬整个数组；
 * 触摸端一次手势可能连着记十几条，搬数组的开销会正好落在"卡不卡"上。
 */
export class DiagnosticsLog {
  private readonly ring: Array<LogEvent | undefined>;
  private head = 0;
  private count = 0;
  private seq = 0;
  frame = 0;

  constructor(
    readonly capacity = 4000,
    private readonly clock: () => number = defaultClock,
  ) {
    if (capacity <= 0) throw new Error('DiagnosticsLog 的容量必须大于 0');
    this.ring = new Array<LogEvent | undefined>(capacity);
  }

  log(cat: LogCategory, name: string, data?: Record<string, unknown>): LogEvent {
    const event: LogEvent = {
      seq: ++this.seq,
      t: Math.round(this.clock() * 10) / 10,
      frame: this.frame,
      cat,
      name,
    };
    if (data !== undefined) {
      const clean = sanitizeData(data);
      // sanitizeData 对纯函数/undefined 会返回 undefined：那就干脆不挂 data
      if (clean !== undefined) event.data = clean as Record<string, unknown>;
    }
    this.ring[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    return event;
  }

  /** 打一个"从这里开始看"的标记（用户点"记录问题"时用） */
  mark(label: string, data?: Record<string, unknown>): LogEvent {
    return this.log('mark', label, data);
  }

  /** 按时间顺序取出现有事件（最旧 → 最新） */
  events(): LogEvent[] {
    const out: LogEvent[] = [];
    const start = this.count === this.capacity ? this.head : 0;
    for (let i = 0; i < this.count; i++) {
      const event = this.ring[(start + i) % this.capacity];
      if (event) out.push(event);
    }
    return out;
  }

  get size(): number {
    return this.count;
  }

  get lastSeq(): number {
    return this.seq;
  }

  clear(): void {
    this.ring.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}

function defaultClock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 单条事件的大致字符数（用于预算裁剪，不必精确到字节） */
function eventChars(event: LogEvent): number {
  return JSON.stringify(event).length + 1;
}

function sessionChars(session: LogSession): number {
  // id / startedAt / 括号逗号等固定开销
  return 64 + session.events.reduce((sum, event) => sum + eventChars(event), 0);
}

/**
 * 把会话裁到预算内：**从最旧的开始丢**。
 *
 * 规则：
 *  1. 先丢整段旧会话（至少留一段）；
 *  2. 还不够就丢最旧会话里最旧的事件（至少留 1 条，否则导出时什么都看不到）。
 *
 * 不修改入参：调用方可能还要拿原数组做别的事。
 */
export function trimSessions(sessions: readonly LogSession[], budgetChars: number): LogSession[] {
  const copy = sessions.map((session) => ({ ...session, events: [...session.events] }));
  let total = copy.reduce((sum, session) => sum + sessionChars(session), 0);
  const safeBudget = Math.max(1024, Math.floor(budgetChars));

  while (copy.length > 1 && total > safeBudget) {
    const removed = copy.shift();
    if (!removed) break;
    total -= sessionChars(removed);
  }
  while (copy.length === 1) {
    const only = copy[0];
    if (!only || only.events.length <= 1 || total <= safeBudget) break;
    const removed = only.events.shift();
    if (!removed) break;
    total -= eventChars(removed);
  }
  return copy;
}

/** 存盘用的稳定形状（版本号留给以后迁移） */
export interface StoredLog {
  v: 1;
  sessions: LogSession[];
}

export function encodeSessions(sessions: readonly LogSession[]): StoredLog {
  return { v: 1, sessions: sessions.map((session) => ({ ...session, events: [...session.events] })) };
}

/** 解析落盘内容；坏数据一律当成"没有日志"，不要让它把启动打断 */
export function decodeSessions(raw: string | null): LogSession[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredLog> | null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.sessions)) return [];
    const out: LogSession[] = [];
    for (const session of parsed.sessions) {
      if (!session || typeof session !== 'object') continue;
      const candidate = session as Partial<LogSession>;
      if (typeof candidate.id !== 'string' || !Array.isArray(candidate.events)) continue;
      const events: LogEvent[] = [];
      for (const event of candidate.events) {
        if (!event || typeof event !== 'object') continue;
        const e = event as Partial<LogEvent>;
        if (typeof e.seq !== 'number' || typeof e.t !== 'number' || typeof e.name !== 'string') continue;
        events.push({
          seq: e.seq,
          t: e.t,
          frame: typeof e.frame === 'number' ? e.frame : 0,
          cat: (typeof e.cat === 'string' ? e.cat : 'app') as LogCategory,
          name: e.name,
          data: e.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : undefined,
        });
      }
      out.push({
        id: candidate.id,
        startedAt: typeof candidate.startedAt === 'number' ? candidate.startedAt : 0,
        events,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 人能读的时间线：一行一条，直接贴给 AI 就能顺着读。
 *
 * 时间用**相对第一条**的秒数：绝对时间戳对"复现路径"没有意义，
 * 而 `+1.234s` 能直接看出"点完之后 1.2 秒才卡住"。
 */
export function formatTimeline(events: readonly LogEvent[]): string {
  if (events.length === 0) return '（没有事件）';
  const base = events[0]?.t ?? 0;
  return events
    .map((event) => {
      const delta = ((event.t - base) / 1000).toFixed(3).padStart(8);
      const data = event.data ? ` ${formatData(event.data)}` : '';
      return `+${delta}s f${event.frame} [${event.cat}] ${event.name}${data}`;
    })
    .join('\n');
}

function formatData(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    let text: string;
    if (typeof value === 'string') text = value;
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) text = String(value);
    else text = JSON.stringify(value);
    // 空格会破坏"一行一条"的可读性
    parts.push(`${key}=${text.replace(/\s+/g, '_')}`);
  }
  return parts.join(' ');
}
