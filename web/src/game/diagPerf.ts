/**
 * 诊断导出的**性能结论**（批次 283，B283-8 的落地方式）
 *
 * ## 为什么要有它
 *
 * 批次 283 的四处改动（撤销流体补排、生成期水连续、光照快路径、流体模拟窗口）
 * 全都是"看不见的"：改完以后帧时间是不是真的回来了，只能靠新导出的诊断日志判断。
 * 而一份诊断里有 4000 条事件、十几类字段，肉眼看不出"哪个数说明窗口生效了"。
 *
 * 所以这里把判据固定成**一段代码 + 一句话结论**：
 *  - `fluidFar` 远大于 `fluid`      → 模拟窗口生效（远处的水被冻结了）；
 *  - `lightSkipped ≈ writes`        → 光照快路径命中（液面变化不再跑 BFS）；
 *  - `cpu / frameMs ≥ 0.7`          → CPU 卡，降分辨率无效（策略已按这条停手）；
 *  - `pending` 还在 5 万以上 / `dropped > 0` → 光照仍被灌爆。
 *
 * 判据写在这里而不是 CLI 里，是为了能被离线断言（`test:diag`）——
 * 否则"分析脚本说没问题"本身就是一件不可验证的事。
 */

import { FRAME_TIME_DROP } from '../core/world/PerfPolicy.ts';

/**
 * 采样窗口长度（秒）。
 *
 * `main.perfSampleTimer` 固定每 5 秒记一条 `perf/sample`，每条里的 `writes/fluid/...`
 * 都是**这 5 秒的增量**。算速率时只能按"带计数的窗口数 × 5 秒"折算——
 * 拿整局秒数当分母会把"只在光照积压时才记"的旧版导出算小一半以上。
 */
const SAMPLE_WINDOW_SECONDS = 5;

/** 一条 `perf/sample` 里与时序/降档有关的字段（缺的字段按 undefined） */
export interface PerfWindow {
  /** 会话内毫秒 */
  t: number;
  frameAvgMs: number;
  cpu: number;
  cpuBound?: boolean;
  res?: number;
  view?: number;
  decor?: number;
  writes?: number;
  fluid?: number;
  fluidFar?: number;
  fluidDeferred?: number;
  lightSkipped?: number;
  rt?: number;
  noop?: number;
  chunks?: number;
  mobs?: number;
  calls?: number;
  tris?: number;
  /** 背板像素数（从 `buffer: "1584×720"` 解析） */
  pixels?: number;
}

/** 一条 `perf/light`（光照队列积压时才有） */
export interface LightWindow {
  t: number;
  pending: number;
  dropped: number;
  readded: number;
  spread: number;
  change: number;
  /**
   * 旧版导出（批次 283 之前）把写入计数只放在 `perf/light` 里，
   * 而且只在光照积压时才记。这几项是当时的**唯一**来源，所以要跟着收。
   */
  writes?: number;
  fluid?: number;
  rt?: number;
  noop?: number;
}

export interface PerfSummary {
  windows: number;
  /** 采样窗口覆盖的时长（秒，按首尾采样时间估算） */
  seconds: number;
  frameMs: { first: number; last: number; avg: number; max: number };
  cpu: { avg: number; share: number };
  res: { start: number; end: number; min: number };
  view: { start: number; end: number; min: number };
  decor: { start: number; end: number; max: number };
  totals: {
    writes: number;
    fluid: number;
    lightSkipped: number;
    fluidFar: number;
    fluidDeferred: number;
    rt: number;
    noop: number;
  };
  /** 每秒的流体改动数（与批次 283 之前的真机基线 3000+/秒 对照） */
  fluidPerSecond: number;
  /** 写入计数的来源：`sample`（批次 283+）或 `light`（旧版导出只有它带） */
  writeSource: 'sample' | 'light' | 'none';
  /** 方块写入里流体占的比例 */
  fluidShare: number;
  /** 写入里"跳过光照"的比例（快路径命中率） */
  lightSkipRate: number;
  light: { pendingPeak: number; dropped: number; readded: number; spread: number };
  verdict: 'ok' | 'cpu-bound' | 'gpu-bound';
  findings: string[];
}

/** 原始事件（结构性最小接口，测试可以手写） */
export interface RawDiagEvent {
  t: number;
  cat: string;
  name: string;
  data?: Record<string, unknown>;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `"1584×720"` → 1140480 */
function parseBuffer(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+)\s*[×x]\s*(\d+)$/.exec(value.trim());
  if (!m) return undefined;
  return Number(m[1]) * Number(m[2]);
}

/** 从导出的事件流里挑出性能采样（两个数组按时间顺序） */
export function collectPerfEvents(events: readonly RawDiagEvent[]): {
  windows: PerfWindow[];
  lights: LightWindow[];
} {
  const windows: PerfWindow[] = [];
  const lights: LightWindow[] = [];
  for (const event of events) {
    if (event.cat !== 'perf') continue;
    const data = event.data ?? {};
    if (event.name === 'sample') {
      const frameAvgMs = num(data.frameAvgMs);
      const cpu = num(data.cpu);
      if (frameAvgMs === undefined || cpu === undefined) continue;
      windows.push({
        t: event.t,
        frameAvgMs,
        cpu,
        cpuBound: data.cpuBound === true,
        res: num(data.res),
        view: num(data.view),
        decor: num(data.decor),
        writes: num(data.writes),
        fluid: num(data.fluid),
        fluidFar: num(data.fluidFar),
        fluidDeferred: num(data.fluidDeferred),
        lightSkipped: num(data.lightSkipped),
        rt: num(data.rt),
        noop: num(data.noop),
        chunks: num(data.chunks),
        mobs: num(data.mobs),
        calls: num(data.calls),
        tris: num(data.tris),
        pixels: parseBuffer(data.buffer),
      });
    } else if (event.name === 'light') {
      const pending = num(data.pending);
      if (pending === undefined) continue;
      lights.push({
        t: event.t,
        pending,
        dropped: num(data.dropped) ?? 0,
        readded: num(data.readded) ?? 0,
        spread: num(data.spread) ?? 0,
        change: num(data.change) ?? 0,
        writes: num(data.writes),
        fluid: num(data.fluid),
        rt: num(data.rt),
        noop: num(data.noop),
      });
    }
  }
  return { windows, lights };
}

/** 把一批采样压成结论（纯函数，`test:diag` 逐条断言） */
export function summarizePerf(windows: readonly PerfWindow[], lights: readonly LightWindow[] = []): PerfSummary {
  const first = windows[0];
  const last = windows[windows.length - 1];
  if (!first || !last) {
    return {
      windows: 0,
      seconds: 0,
      frameMs: { first: 0, last: 0, avg: 0, max: 0 },
      cpu: { avg: 0, share: 0 },
      res: { start: 1, end: 1, min: 1 },
      view: { start: 0, end: 0, min: 0 },
      decor: { start: 0, end: 0, max: 0 },
      totals: { writes: 0, fluid: 0, lightSkipped: 0, fluidFar: 0, fluidDeferred: 0, rt: 0, noop: 0 },
      fluidPerSecond: 0,
      fluidShare: 0,
      lightSkipRate: 0,
      light: { pendingPeak: 0, dropped: 0, readded: 0, spread: 0 },
      writeSource: 'none',
      verdict: 'ok',
      findings: ['没有性能采样（这份导出里没有 perf/sample 事件）'],
    };
  }

  const totals = {
    writes: 0,
    fluid: 0,
    lightSkipped: 0,
    fluidFar: 0,
    fluidDeferred: 0,
    rt: 0,
    noop: 0,
  };
  let frameSum = 0;
  let frameMax = 0;
  let cpuSum = 0;
  for (const w of windows) {
    totals.writes += w.writes ?? 0;
    totals.fluid += w.fluid ?? 0;
    totals.lightSkipped += w.lightSkipped ?? 0;
    totals.fluidFar += w.fluidFar ?? 0;
    totals.fluidDeferred += w.fluidDeferred ?? 0;
    totals.rt += w.rt ?? 0;
    totals.noop += w.noop ?? 0;
    frameSum += w.frameAvgMs;
    cpuSum += w.cpu;
    if (w.frameAvgMs > frameMax) frameMax = w.frameAvgMs;
  }

  const frameAvg = frameSum / windows.length;
  const cpuAvg = cpuSum / windows.length;
  const share = frameAvg > 0 ? cpuAvg / frameAvg : 0;
  const seconds = Math.max(0, (last.t - first.t) / 1000);

  const resStart = first.res ?? 1;
  const resEnd = last.res ?? resStart;
  const viewStart = first.view ?? 0;
  const viewEnd = last.view ?? viewStart;
  const decorStart = first.decor ?? 0;
  const decorEnd = last.decor ?? decorStart;

  let resMin = resStart;
  let viewMin = viewStart;
  let decorMax = decorStart;
  for (const w of windows) {
    if (w.res !== undefined) resMin = Math.min(resMin, w.res);
    if (w.view !== undefined) viewMin = Math.min(viewMin, w.view);
    if (w.decor !== undefined) decorMax = Math.max(decorMax, w.decor);
  }

  let pendingPeak = 0;
  let dropped = 0;
  let readded = 0;
  let spread = 0;
  for (const l of lights) {
    pendingPeak = Math.max(pendingPeak, l.pending);
    dropped += l.dropped;
    readded += l.readded;
    spread += l.spread;
  }

  /**
   * 写入计数的来源（批次 283 的导出才在 `sample` 里带）。
   *
   * 旧版导出只在 `perf/light`（光照积压时才会出现）里带 writes/fluid/rt，
   * 所以"复验改动之前那份日志"必须走这条兜底，否则会打印出一排 0 ——
   * 那比不打印更容易误导（"没有写入"和"没记"是两件完全不同的事）。
   */
  let writeSource: PerfSummary['writeSource'] = 'none';
  let counterWindows = windows.filter((w) => w.writes !== undefined).length;
  if (totals.writes > 0) {
    writeSource = 'sample';
  } else {
    counterWindows = lights.filter((l) => l.writes !== undefined).length;
    for (const l of lights) {
      totals.writes += l.writes ?? 0;
      totals.fluid += l.fluid ?? 0;
      totals.rt += l.rt ?? 0;
      totals.noop += l.noop ?? 0;
    }
    if (totals.writes > 0) writeSource = 'light';
  }

  const fluidShare = totals.writes > 0 ? totals.fluid / totals.writes : 0;
  const lightSkipRate = totals.writes > 0 ? totals.lightSkipped / totals.writes : 0;
  const coveredSeconds = counterWindows * SAMPLE_WINDOW_SECONDS;
  const fluidPerSecond = coveredSeconds > 0 ? totals.fluid / coveredSeconds : 0;
  /** 这份导出是不是批次 283 之后的版本（有 fluidFar/lightSkipped 这两组新计数） */
  const hasWindowCounters = windows.some((w) => w.fluidFar !== undefined || w.fluidDeferred !== undefined);

  const verdict: PerfSummary['verdict'] = share >= 0.7 ? 'cpu-bound' : frameAvg > 22 ? 'gpu-bound' : 'ok';
  const findings: string[] = [];

  if (verdict === 'cpu-bound') {
    findings.push(
      `CPU 卡：JS 每帧 ${cpuAvg.toFixed(1)}ms / 帧间距 ${frameAvg.toFixed(1)}ms（占比 ${(share * 100).toFixed(0)}%）` +
        '——降分辨率没有用，策略已按这条停手',
    );
  } else if (verdict === 'gpu-bound') {
    findings.push(
      `GPU 卡：JS 每帧 ${cpuAvg.toFixed(1)}ms 远小于帧间距 ${frameAvg.toFixed(1)}ms——降分辨率/装饰层才是有效手段`,
    );
  } else {
    findings.push(`帧时间正常：平均 ${frameAvg.toFixed(1)}ms（CPU ${cpuAvg.toFixed(1)}ms）`);
  }

  if (totals.writes > 0) {
    findings.push(
      `流体占方块写入 ${(fluidShare * 100).toFixed(0)}%（${totals.fluid} / ${totals.writes} 次，` +
        `≈${Math.round(fluidPerSecond)} 次/秒，按 ${coveredSeconds} 秒折算）` +
        (fluidPerSecond > 1500
          ? hasWindowCounters
            ? '——仍然偏高，窗口或生成期规则没完全生效'
            : '——旧版导出（还没有模拟窗口），这批改动之后应当明显下降'
          : ''),
    );
  }

  if (!hasWindowCounters) {
    findings.push('这份导出没有 fluidFar/fluidDeferred（批次 283 之前的版本）——无法判断模拟窗口是否生效');
  } else if (totals.fluidFar > 0) {
    findings.push(
      `模拟窗口生效：冻结了 ${totals.fluidFar} 个远处流体刻（推迟 ${totals.fluidDeferred} 个）` +
        (totals.fluidFar < totals.fluid ? '；窗口内的流仍然在跑，属预期' : ''),
    );
  } else if (totals.fluid > 0) {
    findings.push('窗口外的流体刻为 0：水流全在玩家附近（或窗口没接上），单看这一项分不出来');
  }

  if (lightSkipRate > 0) {
    findings.push(
      `光照快路径命中 ${(lightSkipRate * 100).toFixed(0)}%（${totals.lightSkipped} / ${totals.writes} 次写入跳过 BFS）`,
    );
  }

  if (pendingPeak > 50_000) {
    findings.push(`光照仍在积压：队列峰值 ${pendingPeak} 格（>5 万会让网格化不等光照收敛）`);
  }
  if (dropped > 0) {
    findings.push(`光照在丢任务：${dropped} 次（光照会暂时不准，需要再收一刀）`);
  }
  if (readded + spread > 0) {
    findings.push(`窗口内光照入队：readded ${readded} / spread ${spread}（对照基线：旧日志 40 万 / 55 万 每 5 秒）`);
  }

  // 判据看**峰值**而不是平均：真机日志里平均只有 21.5ms，但单窗峰值 26.1ms ——
  // 玩家感觉到的卡是峰值那几秒，平均会把它们摊平。
  if (resMin < 1 && frameMax > FRAME_TIME_DROP) {
    findings.push(
      `画质被压低：分辨率最低 ${resMin.toFixed(2)}、视距最低 ${viewMin}、装饰最高 ${decorMax}` +
        `（峰值帧 ${round1(frameMax)}ms > ${FRAME_TIME_DROP}ms，降档是被这些长帧触发的）`,
    );
  }

  return {
    windows: windows.length,
    seconds,
    frameMs: { first: first.frameAvgMs, last: last.frameAvgMs, avg: round1(frameAvg), max: round1(frameMax) },
    cpu: { avg: round1(cpuAvg), share: round2(share) },
    res: { start: resStart, end: resEnd, min: resMin },
    view: { start: viewStart, end: viewEnd, min: viewMin },
    decor: { start: decorStart, end: decorEnd, max: decorMax },
    totals,
    fluidPerSecond: Math.round(fluidPerSecond),
    fluidShare: round2(fluidShare),
    lightSkipRate: round2(lightSkipRate),
    light: { pendingPeak, dropped, readded, spread },
    writeSource,
    verdict,
    findings,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 一段可读报告（CLI 直接打印；测试只断言字段，不比对长文本） */
export function formatPerfReport(summary: PerfSummary, meta?: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (meta) {
    const world = meta.world as Record<string, unknown> | undefined;
    const perf = meta.perf as Record<string, unknown> | undefined;
    lines.push(
      `设备：${String(meta.gpu ?? '?')} · ${String(meta.viewport ?? '?')} @DPR ${String(meta.dpr ?? '?')}` +
        ` · 世界「${String(world?.name ?? '?')}」${String(world?.mode ?? '')}`,
    );
    if (perf) {
      lines.push(
        `导出时：fps ${String(perf.fps ?? '?')} · frameMs ${String(perf.frameMs ?? '?')} · ` +
          `res ${String(perf.res ?? '?')} · view ${String(perf.view ?? '?')} · decor ${String(perf.decor ?? '?')} · ` +
          `calls ${String(perf.calls ?? '?')} · tris ${String(perf.tris ?? '?')} · heap ${String(perf.heapMb ?? '?')}MB`,
      );
    }
  }
  lines.push(
    `采样 ${summary.windows} 个窗口 / ${summary.seconds.toFixed(0)} 秒：帧时间 ${summary.frameMs.first} → ` +
      `${summary.frameMs.last}ms（平均 ${summary.frameMs.avg}，峰值 ${summary.frameMs.max}），CPU 平均 ${summary.cpu.avg}ms`,
  );
  lines.push(
    `降档轨迹：分辨率 ${summary.res.start} → ${summary.res.end}（最低 ${summary.res.min}）· ` +
      `视距 ${summary.view.start} → ${summary.view.end}（最低 ${summary.view.min}）· ` +
      `装饰 ${summary.decor.start} → ${summary.decor.end}（最高 ${summary.decor.max}）`,
  );
  const writeSourceLabel =
    summary.writeSource === 'light' ? '（来自 perf/light，旧版导出）' : summary.writeSource === 'none' ? '（这份导出没有写入计数）' : '';
  lines.push(
    `写入 ${summary.totals.writes} 次${writeSourceLabel}（流体 ${summary.totals.fluid}、随机刻 ${summary.totals.rt}、` +
      `跳过光照 ${summary.totals.lightSkipped}、远处冻结 ${summary.totals.fluidFar}、预算推迟 ${summary.totals.fluidDeferred}）`,
  );
  lines.push(
    `光照：队列峰值 ${summary.light.pendingPeak} 格 · 丢弃 ${summary.light.dropped} · ` +
      `readded ${summary.light.readded} · spread ${summary.light.spread}`,
  );
  lines.push(`结论：${summary.verdict}`);
  for (const finding of summary.findings) lines.push(`  · ${finding}`);
  return lines;
}
