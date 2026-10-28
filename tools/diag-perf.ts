/**
 * 诊断导出 → 性能结论（批次 283，B283-8）
 *
 * 用法：
 *   npm run diag:perf -- ~/Downloads/minicraft-diag-2026-10-19T02-32-46-618Z.json
 *
 * 这是一个**人看的**复盘工具，不参与 `npm run check`（它需要玩家给的导出文件）。
 * 判据在 `src/game/diagPerf.ts` 里、由 `test:diag` 逐条断言——
 * 脚本本身只负责读文件、打印。判据如果写在脚本里，"分析结论"就没人验证了。
 */

import { readFileSync } from 'node:fs';
import { collectPerfEvents, formatPerfReport, summarizePerf, type RawDiagEvent } from '../web/src/game/diagPerf.ts';

interface DiagExport {
  meta?: Record<string, unknown>;
  sessions?: { id?: string; events?: RawDiagEvent[] }[];
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('用法：npm run diag:perf -- <诊断 JSON 路径>');
    process.exit(2);
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`读不到文件：${path}\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  let parsed: DiagExport;
  try {
    parsed = JSON.parse(raw) as DiagExport;
  } catch (error) {
    console.error(`不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const sessions = parsed.sessions ?? [];
  if (sessions.length === 0) {
    console.error('这份导出里没有 sessions（不是游戏导出的诊断文件？）');
    process.exit(2);
  }

  // 只分析**最后一次会话**：玩家"现在这一局"才是要复验的对象；
  // 更早的会话（改动之前）只在标题里报一句条数，免得把两局混在一起平均。
  const last = sessions[sessions.length - 1]!;
  const events = last.events ?? [];
  const { windows, lights } = collectPerfEvents(events);
  const summary = summarizePerf(windows, lights);

  console.log(`\n[诊断复盘] 会话 ${last.id ?? '?'}（第 ${sessions.length} 局，共 ${events.length} 条事件）`);
  for (const line of formatPerfReport(summary, parsed.meta)) console.log(line);

  if (windows.length > 0) {
    console.log('\n[逐窗口]  t(s)  frameMs  cpu   cpuBound  res   view  decor  writes  fluid  far  skipped');
    const t0 = windows[0]!.t;
    for (const w of windows) {
      const seconds = ((w.t - t0) / 1000).toFixed(0).padStart(5);
      console.log(
        `           ${seconds}  ${w.frameAvgMs.toFixed(1).padStart(6)}  ${w.cpu.toFixed(1).padStart(4)}  ` +
          `${w.cpuBound ? '是' : '否'}      ${(w.res ?? 1).toFixed(2)}  ${String(w.view ?? '?').padStart(4)}  ` +
          `${String(w.decor ?? '?').padStart(5)}  ${String(w.writes ?? 0).padStart(6)}  ` +
          `${String(w.fluid ?? 0).padStart(5)}  ${String(w.fluidFar ?? 0).padStart(3)}  ${String(w.lightSkipped ?? 0).padStart(7)}`,
      );
    }
  }

  if (sessions.length > 1) {
    console.log(`\n（更早的 ${sessions.length - 1} 局未参与统计：它们是改动之前的现场，混在一起会冲淡对比）`);
  }
  console.log('');
}

main();
