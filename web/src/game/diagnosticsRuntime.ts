/**
 * 诊断日志的浏览器胶水层
 *
 * `diagnostics.ts` 只负责"记什么、怎么裁"；这里负责：
 *  - 装错误钩子与页面生命周期钩子；
 *  - 把日志落进 localStorage（**平时就开着**，预算 500KB，超出丢最旧的）；
 *  - 导出 JSON / 可读文本给玩家或 AI。
 *
 * 单例叫 `diag`。刻意做成"任何环境都能构造"：Node 里没有 localStorage 时
 * 它退化成只在内存里记，测试可以直接用 `new DiagnosticsRuntime(null)`。
 */

import {
  DiagnosticsLog,
  decodeSessions,
  encodeSessions,
  formatTimeline,
  trimSessions,
  type LogCategory,
  type LogEvent,
  type LogSession,
} from './diagnostics.ts';
import { saveIssueReport } from '../core/save/SaveIssues.ts';

/** localStorage 的键（换版本就换键，旧的留着也不影响启动） */
export const DIAG_STORAGE_KEY = 'mc.diag.v1';
/** 落盘预算：用户拍板 500KB（按 JSON 字符数近似） */
export const DIAG_BUDGET_CHARS = 500_000;
/** 每这么多条事件落一次盘；错误与标记会立刻落盘 */
const FLUSH_EVERY = 100;
/** 最长多久落一次盘（毫秒） */
const FLUSH_INTERVAL_MS = 5_000;

export interface DiagnosticsMeta {
  [key: string]: unknown;
}

export interface DiagnosticsStats {
  /** 当前会话在内存里的事件数 */
  events: number;
  /** 导出的 JSON 大致字符数（用来判断离 500KB 还有多远） */
  chars: number;
  sessions: number;
  /** 有没有打过"从这里开始看"的标记 */
  marked: boolean;
  /** 已占用 KB（四舍五入） */
  kb: number;
}

function storageOrNull(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    // 无痕模式/被禁时，**访问** localStorage 本身就会抛
    const probe = '__mc_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export class DiagnosticsRuntime {
  readonly log: DiagnosticsLog;
  private sessions: LogSession[] = [];
  private readonly current: LogSession;
  private started = false;
  private dirty = 0;
  private lastFlush = 0;
  private markedAt: number | null = null;
  private metaProvider: () => DiagnosticsMeta = () => ({});
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly storage: Storage | null,
    private readonly epoch: () => number = () => Date.now(),
  ) {
    this.log = new DiagnosticsLog();
    const startedAt = this.epoch();
    this.current = { id: `s${startedAt}`, startedAt, events: [] };
    this.sessions = decodeSessions(this.read());
  }

  // ---------------------------------------------------------------- 记录

  /** 记一条事件（组件都走这个入口，顺便做节流落盘） */
  event(cat: LogCategory, name: string, data?: Record<string, unknown>): LogEvent {
    const event = this.log.log(cat, name, data);
    this.dirty++;
    if (cat === 'error') {
      this.flush();
    } else if (this.dirty >= FLUSH_EVERY) {
      this.flush();
    }
    return event;
  }

  /** 用户点"记录问题"时打一个标记：导出时能一眼找到现场起点 */
  mark(label: string, data?: Record<string, unknown>): LogEvent {
    const event = this.log.mark(label, data);
    this.markedAt = event.seq;
    this.flush();
    return event;
  }

  setMetaProvider(provider: () => DiagnosticsMeta): void {
    this.metaProvider = provider;
  }

  // ---------------------------------------------------------------- 生命周期

  /** 装错误钩子与落盘钩子；重复调用无副作用，Node 里直接返回 */
  start(): void {
    if (this.started || typeof window === 'undefined' || typeof document === 'undefined') return;
    this.started = true;

    const onError = (event: ErrorEvent): void => {
      this.event('error', 'window.error', {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      this.event('error', 'unhandledrejection', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };
    const onHide = (): void => this.flush();

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') this.flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(
      () => window.removeEventListener('error', onError),
      () => window.removeEventListener('unhandledrejection', onRejection),
      () => window.removeEventListener('pagehide', onHide),
      () => window.removeEventListener('beforeunload', onHide),
      () => document.removeEventListener('visibilitychange', onVisibility),
    );

    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.event('app', 'diag.start', {
      sessions: this.sessions.length,
      capacity: this.log.capacity,
      budget: DIAG_BUDGET_CHARS,
    });
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.flush();
    this.started = false;
  }

  // ---------------------------------------------------------------- 导出

  /** 当前会话 + 之前会话（按预算裁过），导出与统计共用 */
  sessionsForExport(): LogSession[] {
    return trimSessions(
      [...this.sessions, { ...this.current, events: this.log.events() }],
      DIAG_BUDGET_CHARS,
    );
  }

  payload(extra: DiagnosticsMeta = {}): Record<string, unknown> {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      // 批次 20261025-0117（合规 5）：读档时被跳过的方块 / 物品 / 画，随日志一起导出——
      // 玩家报"我的东西没了"时，这份账是唯一能对照的线索（控制台在手机上根本看不到）。
      meta: { ...this.baseMeta(), ...this.metaProvider(), saveIssues: saveIssueReport(), ...extra },
      sessions: this.sessionsForExport(),
    };
  }

  exportJson(extra: DiagnosticsMeta = {}): string {
    return JSON.stringify(this.payload(extra), null, 2);
  }

  exportText(extra: DiagnosticsMeta = {}): string {
    const payload = this.payload(extra);
    const meta = payload.meta as Record<string, unknown>;
    const lines: string[] = ['# Minicraft 诊断日志', `导出时间: ${String(payload.exportedAt)}`];
    for (const [key, value] of Object.entries(meta)) {
      lines.push(`${key}: ${typeof value === 'string' ? value : safeStringify(value)}`);
    }
    const sessions = payload.sessions as LogSession[];
    sessions.forEach((session, index) => {
      lines.push('', `## 会话 ${index + 1} · ${session.id} · ${session.events.length} 条`);
      lines.push(formatTimeline(session.events));
    });
    return lines.join('\n');
  }

  /** 触发一次下载；Node 里返回 false */
  download(extra: DiagnosticsMeta = {}): boolean {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
    try {
      const blob = new Blob([this.exportJson(extra)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `minicraft-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // 立刻 revoke 在部分内核上会让下载拿到空文件；给一帧之后
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.event('app', 'diag.export.download');
      return true;
    } catch {
      return false;
    }
  }

  /** 复制可读时间线；成功返回 true */
  async copy(extra: DiagnosticsMeta = {}): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(this.exportText(extra));
      this.event('app', 'diag.export.copy');
      return true;
    } catch {
      return false;
    }
  }

  stats(): DiagnosticsStats {
    const sessions = this.sessionsForExport();
    const chars = safeStringify({ version: 1, sessions }).length;
    return {
      events: this.log.size,
      chars,
      sessions: sessions.length,
      marked: this.markedAt !== null,
      kb: Math.round(chars / 1024),
    };
  }

  clear(): void {
    this.log.clear();
    this.sessions = [];
    this.markedAt = null;
    try {
      this.storage?.removeItem(DIAG_STORAGE_KEY);
    } catch {
      /* 存不进去也不影响继续玩 */
    }
  }

  // ---------------------------------------------------------------- 内部

  private baseMeta(): DiagnosticsMeta {
    if (typeof window === 'undefined') return {};
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    return {
      userAgent: nav?.userAgent,
      language: nav?.language,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      dpr: window.devicePixelRatio,
      screen: typeof screen === 'undefined' ? undefined : `${screen.width}×${screen.height}`,
      standalone:
        window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (nav as (Navigator & { standalone?: boolean }) | undefined)?.standalone === true,
    };
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(DIAG_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private flush(): void {
    if (!this.storage) return;
    this.dirty = 0;
    this.lastFlush = this.epoch();
    const sessions = this.sessionsForExport();
    try {
      this.storage.setItem(DIAG_STORAGE_KEY, JSON.stringify(encodeSessions(sessions)));
    } catch {
      // 配额满了：把最旧的一段再丢掉重试一次（仍然失败就放弃这一次，别打断游戏）
      try {
        const fallback = sessions.length > 1 ? sessions.slice(1) : sessions;
        this.storage.setItem(DIAG_STORAGE_KEY, JSON.stringify(encodeSessions(fallback)));
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 供测试观察节流状态 */
  get pendingEvents(): number {
    return this.dirty;
  }

  /** 上次落盘的时间（epoch ms） */
  get lastFlushAt(): number {
    return this.lastFlush;
  }
}

/**
 * 全局单例。
 *
 * ⚠️ 它**不是**懒加载：`new DiagnosticsRuntime` 只读一次 localStorage，
 * 而且读写都包了 try/catch，不会因为无痕模式把启动卡住。
 */
export const diag = new DiagnosticsRuntime(storageOrNull());
