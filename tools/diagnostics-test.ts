/**
 * 诊断日志的离线测试
 *
 * 运行：npm run test:diag
 *
 * 这套日志是"事后破案"用的，所以它自己必须先可靠：
 *  - 环形缓冲不能乱序、不能越界；
 *  - 落盘预算必须真的把最旧的丢掉，而不是把现场一起丢光；
 *  - 坏存档不能让下一次启动崩掉。
 */

import {
  DiagnosticsLog,
  decodeSessions,
  encodeSessions,
  formatTimeline,
  sanitizeData,
  trimSessions,
  type LogEvent,
  type LogSession,
} from '../src/game/diagnostics.ts';
import { DiagnosticsRuntime, DIAG_STORAGE_KEY } from '../src/game/diagnosticsRuntime.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

console.log('\n[一、环形缓冲]');

{
  let clock = 0;
  const log = new DiagnosticsLog(5, () => clock);
  for (let i = 0; i < 8; i++) {
    clock += 100;
    log.log('input', `e${i}`, { i });
  }
  const events = log.events();
  equal('容量 5 只留最近 5 条', events.length, 5);
  equal('最旧的一条是 e3', events[0]?.name, 'e3');
  equal('最新的一条是 e7', events[4]?.name, 'e7');
  check(
    '序号严格递增',
    events.every((event, index) => index === 0 || event.seq > (events[index - 1]?.seq ?? 0)),
  );
  equal('size 与 events 一致', log.size, events.length);
  log.clear();
  equal('clear 之后为 0 条', log.size, 0);
  equal('clear 之后 events 为空', log.events().length, 0);
}

{
  const log = new DiagnosticsLog(4);
  log.frame = 42;
  const event = log.log('ui', 'inventory.open', { mode: 'inventory' });
  equal('事件带上当前帧号', event.frame, 42);
  equal('事件分类正确', event.cat, 'ui');
  check('事件带 data', event.data?.['mode'] === 'inventory');
  const mark = log.mark('复现开始');
  equal('mark 的分类是 mark', mark.cat, 'mark');
}

console.log('\n[二、data 裁剪]');

{
  const long = 'x'.repeat(10_000);
  const clean = sanitizeData({ long, nested: { deep: { deeper: 1 } }, fn: () => 1, none: undefined }) as Record<string, unknown>;
  equal('超长字符串被截断到 240 字', String(clean['long']).length, 241);
  check('字符串以省略号结尾', String(clean['long']).endsWith('…'));
  check('函数被丢掉', !('fn' in clean));
  check('undefined 被丢掉', !('none' in clean));
  equal('深度超过 2 层变成占位符', (clean['nested'] as Record<string, unknown>)['deep'], '[…]');
}

{
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  const clean = sanitizeData(cyclic) as Record<string, unknown>;
  check('循环引用不会炸', clean !== undefined && JSON.stringify(clean).length < 200);
}

{
  const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
  const clean = sanitizeData(wide) as Record<string, unknown>;
  equal('对象最多保留 16 个键', Object.keys(clean).length, 16);
}

console.log('\n[三、落盘预算]');

{
  const makeSession = (id: string, count: number, pad: number): LogSession => ({
    id,
    startedAt: 0,
    events: Array.from({ length: count }, (_, i) => ({
      seq: i + 1,
      t: i,
      frame: i,
      cat: 'input' as const,
      name: 'pointer.move',
      data: { pad: 'x'.repeat(pad) },
    })),
  });

  const sessions = [makeSession('a', 20, 100), makeSession('b', 20, 100), makeSession('c', 20, 100)];
  const trimmed = trimSessions(sessions, 3000);
  check('预算很小时会丢掉旧会话', trimmed.length < sessions.length);
  equal('永远保留最新会话', trimmed[trimmed.length - 1]?.id, 'c');
  check(
    '至少留 1 条事件',
    trimmed.every((session) => session.events.length >= 1),
  );
  check('裁完的总字符数接近预算', JSON.stringify(encodeSessions(trimmed)).length <= 3200);

  const generous = trimSessions(sessions, 10_000_000);
  equal('预算充足时一条不丢', generous.reduce((n, s) => n + s.events.length, 0), 60);
}

{
  // 用接近真实规模的日志跑一次：1000 条 × 300 字 ≈ 300KB，预算 200KB
  const session: LogSession = {
    id: 'big',
    startedAt: 0,
    events: Array.from({ length: 1000 }, (_, i) => ({
      seq: i + 1,
      t: i,
      frame: i,
      cat: 'inventory' as const,
      name: 'held.change',
      data: { note: 'y'.repeat(280) },
    })),
  };
  const trimmed = trimSessions([session], 200_000);
  const chars = JSON.stringify(encodeSessions(trimmed)).length;
  check('大日志被压到预算以内', chars <= 200_000, `${chars} 字符`);
  check('保留的是最新的那一段', trimmed[0]?.events[trimmed[0].events.length - 1]?.seq === 1000);
  check('旧事件确实被丢掉了', (trimmed[0]?.events[0]?.seq ?? 0) > 1);
}

console.log('\n[四、存档解析]');

{
  const sessions: LogSession[] = [
    {
      id: 's1',
      startedAt: 123,
      events: [{ seq: 1, t: 0, frame: 0, cat: 'app', name: 'boot' }],
    },
  ];
  const raw = JSON.stringify(encodeSessions(sessions));
  const decoded = decodeSessions(raw);
  equal('往返后会话数一致', decoded.length, 1);
  equal('往返后事件数一致', decoded[0]?.events.length, 1);
  equal('往返后名字一致', decoded[0]?.events[0]?.name, 'boot');
  equal('坏 JSON 当空日志', decodeSessions('{oops').length, 0);
  equal('版本不对当空日志', decodeSessions('{"v":2,"sessions":[]}').length, 0);
  equal('null 当空日志', decodeSessions(null).length, 0);
  equal(
    '事件缺字段时那一条被跳过',
    decodeSessions('{"v":1,"sessions":[{"id":"s","startedAt":0,"events":[{"name":"x"},{"seq":2,"t":2,"name":"ok"}]}]}')[0]
      ?.events.length,
    1,
  );
}

console.log('\n[五、可读时间线]');

{
  const events: LogEvent[] = [
    { seq: 1, t: 1000, frame: 10, cat: 'input', name: 'pointer.down', data: { x: 12, y: 34 } },
    { seq: 2, t: 1600, frame: 40, cat: 'mode', name: 'mode.change', data: { to: 'creative' } },
  ];
  const text = formatTimeline(events);
  const lines = text.split('\n');
  equal('一行一条', lines.length, 2);
  check('相对时间从 0 开始', lines[0]?.includes('+   0.000s'));
  check('第二条是 +0.600s', lines[1]?.includes('+   0.600s'));
  check('带分类与名字', lines[1]?.includes('[mode] mode.change'));
  check('带 data', lines[1]?.includes('to=creative'));
  equal('空日志有明确提示', formatTimeline([]), '（没有事件）');
}

console.log('\n[六、运行时：落盘 / 导出 / 预算]');

class FakeStorage {
  readonly map = new Map<string, string>();
  failNext = false;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('QuotaExceeded');
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

{
  const storage = new FakeStorage();
  const runtime = new DiagnosticsRuntime(storage as unknown as Storage, () => 1000);
  runtime.event('app', 'boot', { version: 'test' });
  runtime.event('input', 'pointer.down', { x: 1 });
  equal('未到阈值不急着落盘', storage.map.size, 0);
  runtime.mark('复现开始');
  check('mark 会立刻落盘', storage.map.has(DIAG_STORAGE_KEY));
  const stats = runtime.stats();
  equal('统计里能看到 3 条事件（含 mark）', stats.events, 3);
  check('统计里标记为已打点', stats.marked);
  check('统计里有占用大小', stats.kb >= 0);

  const payload = runtime.payload({ world: { seed: 1 } });
  equal('导出带版本号', payload['version'], 1);
  check('导出带 meta', (payload['meta'] as Record<string, unknown>)['world'] !== undefined);
  const exported = runtime.sessionsForExport();
  equal('导出包含当前会话', exported.length, 1);
  check('当前会话里有 mark', exported[0]?.events.some((event) => event.cat === 'mark'));

  const text = runtime.exportText();
  check('可读文本包含表头', text.includes('# Minicraft 诊断日志'));
  check('可读文本包含会话', text.includes('## 会话 1'));

  runtime.clear();
  equal('clear 之后事件为 0', runtime.stats().events, 0);
  check('clear 之后存储也清掉', !storage.map.has(DIAG_STORAGE_KEY));
}

{
  const storage = new FakeStorage();
  // 预置一段旧会话：构造时应当读进来，导出时保留
  storage.setItem(
    DIAG_STORAGE_KEY,
    JSON.stringify(
      encodeSessions([
        {
          id: 'old',
          startedAt: 1,
          events: [{ seq: 1, t: 0, frame: 0, cat: 'app', name: 'old.boot' }],
        },
      ]),
    ),
  );
  const runtime = new DiagnosticsRuntime(storage as unknown as Storage, () => 2000);
  runtime.event('app', 'new.boot');
  const sessions = runtime.sessionsForExport();
  equal('旧会话被保留', sessions.length, 2);
  equal('旧会话在最前面', sessions[0]?.id, 'old');
}

{
  const storage = new FakeStorage();
  const runtime = new DiagnosticsRuntime(storage as unknown as Storage, () => 3000);
  for (let i = 0; i < 120; i++) runtime.event('input', 'pointer.move', { i, pad: 'z'.repeat(20) });
  check('到阈值会落盘', storage.map.has(DIAG_STORAGE_KEY));
  const stored = decodeSessions(storage.getItem(DIAG_STORAGE_KEY));
  check('落盘内容能解析回来', stored.length === 1 && stored[0]!.events.length > 0);
  check('落盘不会超过 500KB', (storage.getItem(DIAG_STORAGE_KEY) ?? '').length <= 500_000);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
