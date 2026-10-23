#!/usr/bin/env node
/**
 * 钩子离线自检：在临时副本里灌事件 JSON，断言每个钩子的退出码与输出。
 *
 * 为什么存在（挡的是哪次事故）：
 *   钩子坏了的症状是隐蔽的——要么悄悄不生效，要么无限循环（见 README §0 原理 3）。
 *   本项目真踩过：改完 `auto-continue.mjs` 后 `node --check` 全绿，实跑却
 *   `ReferenceError: firstPick is not defined`（TIPS「编号机制」）。当时的处置是
 *   "改完手工喂一条"，那是决心不是约束；这个脚本把它变成会红的检查。
 *
 * 隔离：把 `hooks/*.mjs` 拷进系统临时目录的 `<tmp>/.continue/hooks/`，钩子靠
 * `import.meta.url` 反推项目根，于是读写的全是临时目录，**不碰真实工作区**。
 * 子进程环境去掉所有 `GIT_*`：经 pre-commit 调用时 git 会注入 `GIT_DIR` /
 * `GIT_INDEX_FILE`，不去掉的话临时目录里的 git 命令会落到**外层真实仓库**上。
 *
 * 退出码：0 全过 / 1 有断言失败。幂等：临时目录用完即删。
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'continue-selftest-'));
const HOOKS = join(ROOT, '.continue', 'hooks');
const DOING = join(ROOT, '.continue', 'doing');

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !k.startsWith('GIT_') && !k.startsWith('CONTINUE_') && !k.startsWith('AUTO_COMMIT_') && k !== 'QUEUE_INIT_STYLE',
  ),
);

function sh(cmd, args) {
  return spawnSync(cmd, args, { cwd: ROOT, env: baseEnv, encoding: 'utf8' });
}

function hook(script, payload, env = {}, args = []) {
  const res = spawnSync(process.execPath, [join(HOOKS, script), ...args], {
    cwd: ROOT,
    env: { ...baseEnv, ...env },
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, out: res.stdout ?? '', err: res.stderr ?? '' };
}

const stop = (sid) => ({ hook_event_name: 'Stop', session_id: sid });
const prompt = (sid, text = 'hi') => ({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: text });
const queue = (sid, body, head = '> 状态：执行中') =>
  writeFileSync(join(DOING, `${sid}.md`), `# 队列\n\n${head}\n> 批次：19990101-0000\n\n${body}\n`);
/**
 * 带里程碑的队列：结尾的节点写成
 *
 *   ## 里程碑 MS1 · 名
 *   - 验收：`cmd`
 *   - 确认：已验收 · 批次 `x`     ← 只在人工验收后才有
 */
const msQueue = (sid, before, after, { accept = '`true`', confirm = null } = {}) =>
  writeFileSync(
    join(DOING, `${sid}.md`),
    [
      '# 队列',
      '',
      '> 状态：执行中',
      '> 创建：1999-01-01',
      '> 批次：19990101-0000',
      '',
      ...before,
      '',
      '## 里程碑 MS1 · 测试',
      accept ? `- 验收：${accept}` : null,
      confirm ? `- 确认：${confirm}` : null,
      '',
      ...after,
      '',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  );
const config = (fast, extra = {}) =>
  writeFileSync(
    join(ROOT, '.continue', 'config.json'),
    JSON.stringify({ checks: { fast, timeoutSec: 20 }, ...extra }),
  );

const results = [];
function check(name, fn) {
  try {
    const why = fn();
    results.push({ name, ok: why === true, why: why === true ? '' : String(why) });
  } catch (err) {
    results.push({ name, ok: false, why: `抛异常：${err.message}` });
  }
}
/** 断言工具：条件不成立时返回说明（附上实际输出，失败时才看得懂）。 */
function expect(cond, msg, r) {
  if (cond) return true;
  return `${msg}；实际 exit=${r?.code} stdout=${(r?.out ?? '').slice(0, 120)} stderr=${(r?.err ?? '').slice(0, 200)}`;
}

try {
  // ---------------------------------------------------------------- 准备临时项目
  mkdirSync(HOOKS, { recursive: true });
  mkdirSync(DOING, { recursive: true });
  for (const name of readdirSync(HERE)) {
    if (name.endsWith('.mjs')) cpSync(join(HERE, name), join(HOOKS, name));
  }
  // doing/ 也忽略：队列用例会写队列文件，不忽略的话"工作区干净"那条永远不成立
  writeFileSync(join(ROOT, '.continue', '.gitignore'), 'logs/\nauto.off\ndoing/\n');
  config('');
  sh('git', ['init', '-q']);
  sh('git', ['add', '-A']);
  sh('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'init']);

  // ---------------------------------------------------------------- auto-continue
  check('auto-continue · 没有队列 → 放行', () => {
    const r = hook('auto-continue.mjs', stop('s-none'));
    return expect(r.code === 0 && r.out.includes('"continue":true'), '应 exit 0', r);
  });

  check('auto-continue · 纯问答会话不凭空造日志文件', () => {
    const file = join(ROOT, '.continue', 'logs', 's-none', 'run.md');
    return expect(!existsSync(file), `不应创建 ${file}`, null);
  });

  check('日志留痕 · 递任务与空转可区分且 stopSeen 累加', () => {
    queue('s-trace', '- [ ] 甲');
    hook('auto-continue.mjs', stop('s-trace'));
    const first = readFileSync(join(ROOT, '.continue', 'logs', 's-trace', 'run.md'), 'utf8');
    rmSync(join(DOING, 's-trace.md'));
    hook('auto-continue.mjs', stop('s-trace'));
    const second = readFileSync(join(ROOT, '.continue', 'logs', 's-trace', 'run.md'), 'utf8');
    if (!(first.includes('递任务') && !first.includes('空转') && first.includes('"stopSeen":1'))) {
      return expect(false, `首轮应只有"递任务"且 stopSeen=1，实际：${first.split('\n').slice(-4).join(' / ')}`, null);
    }
    return expect(
      second.includes('空转 · 本会话没有队列') && second.includes('"stopSeen":2'),
      `次轮应记"空转 · 本会话没有队列"且 stopSeen=2，实际：${second.split('\n').slice(-4).join(' / ')}`,
      null,
    );
  });

  check('auto-continue · 有待办 → 拦住并递第 1 条', () => {
    queue('s-todo', '- [ ] 甲\n- [ ] 乙');
    const r = hook('auto-continue.mjs', stop('s-todo'));
    return expect(r.code === 2 && r.err.includes('第 1/2 条') && r.err.includes('甲'), '应 exit 2 且递"第 1/2 条 甲"', r);
  });

  check('auto-continue · commit message 模板带批次号与需求号', () => {
    queue('s-tid', '- [ ] [T7] 甲');
    const r = hook('auto-continue.mjs', stop('s-tid'));
    return expect(r.err.includes('commit message：批次 19990101-0000 · [T7] '), '提交模板应含"批次 … · [T7]"', r);
  });

  check('auto-continue · [~] 优先于 [ ]', () => {
    queue('s-doing', '- [ ] 甲\n- [~] 乙');
    const r = hook('auto-continue.mjs', stop('s-doing'));
    return expect(r.code === 2 && r.err.includes('第 2/2 条'), '应续做第 2 条', r);
  });

  check('auto-continue · 讨论中但空队列 → 拦住，要求填条目', () => {
    queue('s-hold-empty', '', '> 状态：讨论中');
    const r = hook('auto-continue.mjs', stop('s-hold-empty'));
    return expect(
      r.code === 2 && r.err.includes('还是空的'),
      '脚本建的空队列必须被提醒去填，否则会一直停在讨论中',
      r,
    );
  });

  check('auto-continue · 队列名恰好是完整会话 ID → 自动认领改名', () => {
    // 完整 ID 全局唯一，文件名叫它一定是本会话写的 → 直接改名，不用等人
    const full = 'a'.repeat(32);
    writeFileSync(join(DOING, `${full}.md`), '# 队列\n\n> 批次：19990101-0000\n\n- [ ] 甲\n  - 验证：x\n');
    const r = hook('auto-continue.mjs', stop(full));
    const renamed = existsSync(join(DOING, 'aaaaaa.md'));
    const gone = !existsSync(join(DOING, `${full}.md`));
    rmSync(join(DOING, 'aaaaaa.md'), { force: true });
    return expect(
      r.code === 2 && renamed && gone,
      `应把 ${full.slice(0, 6)}…${full.slice(-2)}.md 改名成 aaaaaa.md 并照常递任务（renamed=${renamed} gone=${gone}）`,
      r,
    );
  });

  check('auto-continue · 队列文件名写错（完整会话 ID）→ 拦住要求改名', () => {
    // 实测形态：模型把文件名写成完整会话 ID，钩子按 6 位找不到 → 机制静默失效
    writeFileSync(join(DOING, 's-stray-full-id.md'), '# 队列 · 会话 s-stray-full-id\n\n- [ ] 甲\n');
    const r = hook('auto-continue.mjs', stop('s-stray'));
    rmSync(join(DOING, 's-stray-full-id.md'), { force: true });
    return expect(
      r.code === 2 && r.err.includes('队列文件名不对'),
      '名字写错必须拦住；静默放行等于整套机制失效',
      r,
    );
  });

  check('auto-continue · 讨论中 → 放行', () => {
    queue('s-hold', '- [ ] 甲', '> 状态：讨论中');
    const r = hook('auto-continue.mjs', stop('s-hold'));
    return expect(r.code === 0, '应 exit 0', r);
  });

  check('auto-continue · 围栏代码块里的模板不算任务', () => {
    queue('s-fence', '```\n- [ ] 模板\n```');
    const r = hook('auto-continue.mjs', stop('s-fence'));
    return expect(r.code === 0 && r.out.includes('没有任何条目'), '应视为空队列', r);
  });

  check('auto-continue · 全部完成且都有验证 → 自动收尾，不弹窗', () => {
    queue('s-done', '- [x] 甲\n  - 验证：`npm test` 3 条通过');
    const first = hook('auto-continue.mjs', stop('s-done'));
    const second = hook('auto-continue.mjs', stop('s-done'));
    if (!(first.code === 2 && first.err.includes('自动收尾'))) return expect(false, '第一次应下令自动收尾', first);
    if (first.err.includes('ask_followup_question')) return expect(false, '自动收尾不应要求弹窗', first);
    return expect(second.code === 0, '第二次应放行（指令只下发一次）', second);
  });

  check('auto-continue · 有 [阻塞] → 请用户拍板，不自动收尾', () => {
    queue('s-ask', '- [x] 甲\n  - 验证：通过\n- [阻塞] 乙');
    const r = hook('auto-continue.mjs', stop('s-ask'));
    return expect(
      r.code === 2 && r.err.includes('等用户拍板') && r.err.includes('ask_followup_question') && r.err.includes('乙'),
      '有卡住条目时应请用户拍板',
      r,
    );
  });

  check('auto-continue · 打了勾却缺验证说明 → 请用户拍板', () => {
    queue('s-noverify', '- [x] 甲');
    const r = hook('auto-continue.mjs', stop('s-noverify'));
    return expect(
      r.code === 2 && r.err.includes('缺「验证」说明'),
      '缺验证说明时应请用户拍板',
      r,
    );
  });

  check('auto-continue · 验证行里的"默认跳过"不算未验证', () => {
    // 本项目 check:browser 默认跳过，诚实的验证行会带这四个字——
    // 旧正则把"跳过"当未验证，会让每次自动收尾都被弹窗打断。
    queue('s-skipok', '- [x] 甲\n  - 验证：`npm run check` 绿（check:browser 默认跳过）');
    const r = hook('auto-continue.mjs', stop('s-skipok'));
    return expect(
      r.code === 2 && r.err.includes('自动收尾') && !r.err.includes('ask_followup_question'),
      '应自动收尾，不因"默认跳过"弹窗',
      r,
    );
  });

  check('auto-continue · 验证行自述"没跑" → 请用户拍板', () => {
    queue('s-unrun', '- [x] 甲\n  - 验证：命令没跑起来');
    const r = hook('auto-continue.mjs', stop('s-unrun'));
    return expect(
      r.code === 2 && r.err.includes('等用户拍板') && r.err.includes('没跑'),
      '自述没跑时应请用户拍板',
      r,
    );
  });

  // ---------------------------------------------------------------- 里程碑（写在队列里）
  /**
   * 里程碑是**队列里的一个节点**（不再有独立的计划文件）：
   *
   *   ## 里程碑 MS1 · 名
   *   - 验收：`cmd`
   *   - 确认：已验收 · 批次 `x`     ← 只在人工验收后才有
   *
   * 关卡判据：没写确认行，且它**前面**的条目全部 `[x]` / `[阻塞]`。
   */
  check('auto-continue · 走到里程碑 → 硬停，列出验收命令并要求先问人', () => {
    msQueue('s-ms-gate', ['- [x] 甲', '  - 验证：`true`'], ['- [ ] 乙']);
    const r = hook('auto-continue.mjs', stop('s-ms-gate'));
    return expect(
      r.code === 2 &&
        r.err.includes('到达里程碑 MS1') &&
        r.err.includes('`true`') &&
        r.err.includes('弹窗问用户') &&
        r.err.includes('不要替用户写') &&
        !r.err.includes('这一轮做这一条'),
      '到里程碑应硬停：跑验收 → 问人 → 答复后才动队列',
      r,
    );
  });

  check('auto-continue · 里程碑前面的条目还没做完 → 不触发关卡，正常递任务', () => {
    msQueue('s-ms-early', ['- [ ] 甲'], ['- [ ] 乙']);
    const r = hook('auto-continue.mjs', stop('s-ms-early'));
    return expect(
      r.code === 2 && r.err.includes('这一轮做这一条') && !r.err.includes('到达里程碑'),
      '里程碑前面还有待办时不该停',
      r,
    );
  });

  check('auto-continue · 里程碑前面只剩 [发现] → 仍到点硬停（发现条目不挡关卡）', () => {
    msQueue('s-ms-found', ['- [ ] [发现] 顺手记的一条：x → `true`'], ['- [ ] 乙']);
    const r = hook('auto-continue.mjs', stop('s-ms-found'));
    return expect(
      r.code === 2 && r.err.includes('到达里程碑') && !r.err.includes('这一轮做这一条'),
      '[发现] 排在后面，不该让它把关卡绕过去',
      r,
    );
  });

  check('auto-continue · 里程碑关卡只提醒一次，第二轮放行', () => {
    msQueue('s-ms-once', ['- [x] 甲', '  - 验证：`true`'], ['- [ ] 乙']);
    const first = hook('auto-continue.mjs', stop('s-ms-once'));
    const second = hook('auto-continue.mjs', stop('s-ms-once'));
    if (first.code !== 2) return expect(false, '第一轮应硬停', first);
    return expect(second.code === 0, '第二轮应放行（不重复弹窗）', second);
  });

  check('auto-continue · 里程碑已写「确认：已验收」→ 继续递后面的条目', () => {
    msQueue('s-ms-ok', ['- [x] 甲', '  - 验证：`true`'], ['- [ ] 乙'], {
      confirm: '已验收 · 批次 `19990101-0000`',
    });
    const r = hook('auto-continue.mjs', stop('s-ms-ok'));
    return expect(
      r.code === 2 && r.err.includes('乙') && !r.err.includes('到达里程碑'),
      '确认行是"人验收过"的凭证：写了就该放行到下一段',
      r,
    );
  });

  check('auto-continue · 全做完但里程碑没确认 → 不整体收尾', () => {
    msQueue('s-ms-open', ['- [x] 甲', '  - 验证：`true`'], []);
    const r = hook('auto-continue.mjs', stop('s-ms-open'));
    return expect(
      r.code === 2 &&
        r.err.includes('到达里程碑 MS1') &&
        !r.err.includes('[auto-continue · 自动收尾]'),
      '没人验收过的里程碑不该被当成"已完成"归档',
      r,
    );
  });

  check('auto-continue · 全做完且里程碑已确认 → 自动收尾（含归档）', () => {
    msQueue('s-ms-done', ['- [x] 甲', '  - 验证：`true`'], [], {
      confirm: '已验收 · 批次 `19990101-0000`',
    });
    const r = hook('auto-continue.mjs', stop('s-ms-done'));
    return expect(
      r.code === 2 &&
        r.err.includes('[auto-continue · 自动收尾]') &&
        r.err.includes('归档队列文件') &&
        r.err.includes('archive-queue.mjs'),
      '最后一个里程碑验收完之后应走正常五步（含归档）',
      r,
    );
  });

  check('auto-continue · 里程碑没写「验收」→ 关卡照停但明确要补命令', () => {
    msQueue('s-ms-noaccept', ['- [x] 甲', '  - 验证：`true`'], ['- [ ] 乙'], { accept: null });
    const r = hook('auto-continue.mjs', stop('s-ms-noaccept'));
    return expect(
      r.code === 2 && r.err.includes('到达里程碑') && r.err.includes('没写 `- 验收：`'),
      '缺验收命令不能被当成"验收通过"',
      r,
    );
  });

  check('auto-continue · 关卡连续 N 轮没推进 → 升级成「卡住了」告警', () => {
    msQueue('s-ms-stuck', ['- [x] 甲', '  - 验证：`true`'], ['- [ ] 乙']);
    const env = { CONTINUE_BLOCK_AFTER: '2' };
    const first = hook('auto-continue.mjs', stop('s-ms-stuck'), env);
    const second = hook('auto-continue.mjs', stop('s-ms-stuck'), env);
    const third = hook('auto-continue.mjs', stop('s-ms-stuck'), env);
    if (first.code !== 2 || !first.err.includes('到达里程碑')) {
      return expect(false, '第一轮应硬停', first);
    }
    if (second.code !== 0) return expect(false, '第二轮应只放行（不重复弹）', second);
    return expect(
      third.code === 2 && third.err.includes('里程碑关卡卡住了'),
      '连续 N 轮没推进必须升级成告警；否则关卡会永久空转且不隔离',
      third,
    );
  });

  check('auto-continue · 收尾第五步是"归档队列"（不再直接删）', () => {
    queue('s-noplan', '- [x] 甲\n  - 验证：`npm test` 通过');
    const r = hook('auto-continue.mjs', stop('s-noplan'));
    return expect(
      r.code === 2 && r.err.includes('归档队列文件') && r.err.includes('archive-queue.mjs'),
      '收尾第五步应是归档（`archive-queue.mjs`），不是 `rm`',
      r,
    );
  });

  /**
   * 归档改成**累积式**：一个会话一个 `queue.md` / `decision.md`，
   * 新批次插到最上面，批次之间 `----------` 分隔。`doing/` 的规则不变（一批一文件）。
   */
  check('archive-queue · 归档成 logs/<会话ID>/queue.md（累积，不按批次新建）', () => {
    queue('s-arch', '- [x] 甲\n  - 验证：`npm test` 通过');
    const r = hook('archive-queue.mjs', null, {}, ['s-arch']);
    if (r.code !== 0) return expect(false, '归档脚本应 exit 0', r);
    if (existsSync(join(DOING, 's-arch.md'))) return expect(false, '队列文件应已移出 doing/', r);
    const dest = join(ROOT, '.continue', 'logs', 's-arch', 'queue.md');
    if (!existsSync(dest)) return expect(false, '应有 logs/s-arch/queue.md', r);
    const text = readFileSync(dest, 'utf8');
    return expect(
      /^## 批次 \S+ · /m.test(text) && text.includes('- [x] 甲'),
      '归档文件应带 `## 批次 <号> · <时间>` 标题并保留原文',
      r,
    );
  });

  check('archive-queue · 第二批插到最上面，两节用 ---------- 分隔', () => {
    queue('s-arch2', '- [x] 甲\n  - 验证：`npm test` 通过');
    hook('archive-queue.mjs', null, {}, ['s-arch2']);
    writeFileSync(
      join(DOING, 's-arch2.md'),
      '# 队列 · 会话 s-arch2\n\n> 状态：执行中\n> 批次：20260101-0002\n\n- [ ] 乙\n  - 验证：`true`\n',
    );
    const r = hook('archive-queue.mjs', null, {}, ['s-arch2']);
    if (r.code !== 0) return expect(false, '第二次归档应 exit 0', r);
    const text = readFileSync(join(ROOT, '.continue', 'logs', 's-arch2', 'queue.md'), 'utf8');
    const first = text.indexOf('## 批次 20260101-0002');
    const second = text.indexOf('## 批次 19990101-0000');  // 夹具 queue() 固定写这个号
    const seps = (text.match(/^-{10}$/gm) ?? []).length;
    /**
     * 还要钉住**文件头没被切坏**：头里的说明本身写着 `## 批次 <号>`，
     * 一旦插入点用裸子串匹配，就会把这一行从中间劈开（真踩过，靠这条才防得住）。
     */
    const headOk = text.includes('> 按 `## 批次 <号>` 可定位某一批');
    return expect(
      first >= 0 && second > first && seps === 1 && headOk,
      `新批次在上、旧批次在下、一条分隔线，且文件头完整（first=${first} second=${second} seps=${seps} headOk=${headOk}）`,
      r,
    );
  });

  check('archive-queue --decision · 决策记录也归档成 <会话ID>/decision.md', () => {
    queue('s-archdec', '- [x] 甲\n  - 验证：`npm test` 通过');
    writeFileSync(
      join(DOING, 's-archdec-decision.md'),
      '# 决策\n\n## D1 · 甲\n- 决定：x\n- 为什么：y\n',
    );
    const r = hook('archive-queue.mjs', null, {}, ['s-archdec', '--decision']);
    if (r.code !== 0) return expect(false, '归档脚本应 exit 0', r);
    if (existsSync(join(DOING, 's-archdec-decision.md'))) return expect(false, '决策记录应已移出 doing/', r);
    const dest = join(ROOT, '.continue', 'logs', 's-archdec', 'decision.md');
    return expect(existsSync(dest), `应有 ${dest}`, r);
  });

  check('archive-queue · 不带 flag 时把决策记录一起搬走', () => {
    queue('s-archall', '- [x] 甲\n  - 验证：`npm test` 通过');
    writeFileSync(join(DOING, 's-archall-decision.md'), '# 决策\n\n## D1 · 甲\n- 决定：x\n');
    const r = hook('archive-queue.mjs', null, {}, ['s-archall']);
    return expect(
      r.code === 0 && !existsSync(join(DOING, 's-archall-decision.md')),
      '归档队列时应把决策记录一并搬走（否则会留在 doing/ 成孤儿）',
      r,
    );
  });

  check('auto-continue · 硬停：先问人，拿到答复后才动队列（顺序不许反）', () => {
    msQueue('s-ms-order', ['- [x] 甲', '  - 验证：`true`'], ['- [ ] 乙']);
    const r = hook('auto-continue.mjs', stop('s-ms-order'));
    if (r.code !== 2) return expect(false, '应硬停', r);
    const ask = r.err.indexOf('弹窗问用户');
    const act = r.err.indexOf('只有用户选了');
    // 第 5 步（归档并移走队列）在关卡中场收尾时**整体不出现**：队列还要接着用
    return expect(
      ask > 0 && act > ask && !r.err.includes('5. **归档队列文件**'),
      '硬停必须先问人、拿到答复后才动队列；中场收尾不该归档队列',
      r,
    );
  });

  // ---------------------------------------------------------------- 包装器
  /**
   * 这一组挡的是那次真实事故：`lib.mjs` 删了导出、`auto-continue.mjs` 还在 import，
   * 钩子 import 阶段 SyntaxError → node 以 1 退出 → 宿主当"未阻止"→ **静默放行**，
   * 队列停摆、收尾指令也不发，对话里一声不吭。
   */
  check('run.mjs · 钩子 import 崩溃 → exit 2 + 告警（绝不放行）', () => {
    const broken = join(HOOKS, '_selftest-broken.mjs');
    writeFileSync(broken, "import { definitelyNotExported } from './lib.mjs';\n");
    const r = hook('run.mjs', stop('s-broken'), {}, ['_selftest-broken.mjs', '--event=Stop']);
    rmSync(broken);
    return expect(
      r.code === 2 && r.err.includes('框架自己坏了') && r.err.includes('SyntaxError'),
      '崩溃必须翻译成拦截；放行等于把"看得见的红"换成"看不见的停"',
      r,
    );
  });

  check('run.mjs · 正常钩子的退出码与 stdout 原样透传', () => {
    const r = hook('run.mjs', stop('s-passthru'), {}, ['auto-continue.mjs', '--event=Stop']);
    return expect(
      r.code === 0 && r.out.includes('"continue":true'),
      '包装器不能改写子进程的输出（0 放行 / 2 拦截都要逐字保留）',
      r,
    );
  });

  check('auto-continue · 正文提到"验证"但没有凭证行 → 仍算缺说明', () => {
    queue('s-noverifyline', '- [x] 甲\n  - 做了什么：按验证方式跑了一遍，应该没问题');
    const r = hook('auto-continue.mjs', stop('s-noverifyline'));
    return expect(
      r.code === 2 && r.err.includes('缺「验证」说明'),
      '只有 `验证：` 开头的行才算凭证',
      r,
    );
  });

  check('auto-continue · 递任务时把该条标成 [~]（不等 AI 改）', () => {
    queue('s-mark', '- [ ] 甲\n- [ ] 乙');
    const r = hook('auto-continue.mjs', stop('s-mark'));
    const text = readFileSync(join(DOING, 's-mark.md'), 'utf8');
    return expect(
      r.code === 2 && text.includes('- [~] 甲') && text.includes('- [ ] 乙'),
      `第 1 条应被标成 [~]、第 2 条保持 [ ]（实际：${text.replace(/\n/g, '⏎')}）`,
      r,
    );
  });

  check('auto-continue · 连续 N 轮没做完 → 标 [阻塞] 并递下一条', () => {
    queue('s-block', '- [ ] 甲\n- [ ] 乙');
    const env = { CONTINUE_BLOCK_AFTER: '2' };
    hook('auto-continue.mjs', stop('s-block'), env);
    const r = hook('auto-continue.mjs', stop('s-block'), env);
    const text = readFileSync(join(DOING, 's-block.md'), 'utf8');
    return expect(
      // 递"乙"时钩子会把它标成 `[~]`（进行中），所以这里断言 `[~]` 而不是 `[ ]`
      text.includes('- [阻塞] 甲') && text.includes('- [~] 乙') && r.err.includes('乙'),
      `应隔离"甲"、把"乙"标成进行中并递出去（队列现为：${text.replace(/\n/g, '⏎')}）`,
      r,
    );
  });

  check('auto-continue · 续跑轮次写进日志（分辨"宿主丢了反馈"与"AI 不动"）', () => {
    queue('s-cont', '- [ ] 甲\n- [ ] 乙');
    const r = hook('auto-continue.mjs', {
      hook_event_name: 'Stop',
      session_id: 's-cont',
      stop_hook_active: true,
      loop_count: 2,
    });
    const log = readFileSync(join(ROOT, '.continue', 'logs', 's-cont', 'run.md'), 'utf8');
    return expect(
      r.code === 2 && log.includes('续跑第2次'),
      `应递任务且日志带"续跑第2次"，实际：${log.split('\n').slice(-3).join(' / ')}`,
      r,
    );
  });

  check('auto-continue · 刹车 → 放行', () => {
    queue('s-brake', '- [ ] 甲');
    writeFileSync(join(ROOT, '.continue', 'auto.off'), '');
    const r = hook('auto-continue.mjs', stop('s-brake'));
    rmSync(join(ROOT, '.continue', 'auto.off'));
    return expect(r.code === 0 && r.out.includes('刹车'), '应放行并提示刹车', r);
  });

  // ---------------------------------------------------------------- queue-init
  check('queue-init · 首条消息注入会话信息，第二条静默', () => {
    const first = hook('queue-init.mjs', prompt('s-init'));
    const second = hook('queue-init.mjs', prompt('s-init'));
    let ctx = '';
    try {
      ctx = JSON.parse(first.out).hookSpecificOutput?.additionalContext ?? '';
    } catch {
      /* 下面断言会报 */
    }
    if (!(first.code === 0 && ctx.includes('s-init') && /批次：\d{8}-\d{4}/.test(ctx))) {
      // 解析失败时 ctx 是空的，光看"断言不成立"分不清是"没注入"还是"JSON 坏了"——
      // 所以把解析出来的长度和原始输出尾巴一起带上（这两条踩过一次才加）。
      return expect(
        false,
        `首条应注入会话 ID 与时间戳批次号（ctx 长 ${ctx.length}，原始输出尾 ${JSON.stringify(first.out.slice(-160))}）`,
        first,
      );
    }
    return expect(second.code === 0 && !second.out.includes('additionalContext'), '第二条应静默', second);
  });

  check('queue-init · 已有队列沿用原批次号（不另生成新号）', () => {
    queue('s-batch', '- [ ] 甲');
    const r = hook('queue-init.mjs', prompt('s-batch'));
    let ctx = '';
    try {
      ctx = JSON.parse(r.out).hookSpecificOutput?.additionalContext ?? '';
    } catch {
      /* 下面断言会报 */
    }
    return expect(
      r.code === 0 && ctx.includes('19990101-0000'),
      `注入的批次号应沿用队列头部的 19990101-0000，实际：${ctx.slice(0, 200)}`,
      r,
    );
  });

  check('queue-init · 注入里写了里程碑协议（队列内节点 + 硬停 + 不许替用户确认）', () => {
    const r = hook('queue-init.mjs', prompt('s-init-ms'));
    let ctx = '';
    try {
      ctx = JSON.parse(r.out).hookSpecificOutput?.additionalContext ?? '';
    } catch {
      /* 下面断言会报 */
    }
    return expect(
      r.code === 0 &&
        ctx.includes('## 里程碑 MS1') &&
        ctx.includes('硬停') &&
        ctx.includes('自己给自己验收'),
      `注入里必须有里程碑协议（ctx 长 ${ctx.length}）`,
      r,
    );
  });

  check('queue-init · 旧版计划文件被归档到 logs/（机制已移除，不留在 doing/）', () => {
    writeFileSync(join(DOING, 's-legacy-plan.md'), '# 计划\n\n## MS1 · 甲\n- [ ] `MS1.1` 一\n');
    const r = hook('queue-init.mjs', prompt('s-legacy'));
    const dest = join(ROOT, '.continue', 'logs', 's-legacy', 'plan.md');
    return expect(
      r.code === 0 && !existsSync(join(DOING, 's-legacy-plan.md')) && existsSync(dest),
      `旧计划应搬进 ${dest}（归档、不删）`,
      r,
    );
  });

  check('queue-init · --new-batch 打印一个未被占用的新号', () => {
    queue('s-newbatch', '- [ ] 甲'); // 这份队列头已占用 19990101-0000
    const r = hook('queue-init.mjs', stop('s-newbatch'), {}, ['--new-batch']);
    const out = r.out.trim();
    if (!/^\d{8}-\d{4}$/.test(out)) return expect(false, `应打印 YYYYMMDD-HHmm 格式的号，实际：${out}`, r);
    return expect(r.code === 0 && out !== '19990101-0000', '不能返回已被占用的号', r);
  });

  check('auto-continue · 队列还很长时提醒分阶段（--new-batch）', () => {
    const body = Array.from({ length: 12 }, (_, i) => `- [ ] 任务${i + 1}`).join('\n');
    queue('s-long', body);
    const r = hook('auto-continue.mjs', stop('s-long'));
    return expect(
      r.code === 2 && r.err.includes('--new-batch') && r.err.includes('还剩 12 条'),
      '超过长队列阈值应提示分阶段',
      r,
    );
  });

  check('queue-init · 钩子回灌的消息不触发注入', () => {
    const r = hook('queue-init.mjs', prompt('s-echo', '[auto-continue 第3轮 · 会话 x]'));
    return expect(r.code === 0 && !r.out.includes('additionalContext'), '不应注入', r);
  });

  check('日志留痕 · UserPromptSubmit 也记一行并累计 promptSeen', () => {
    hook('queue-init.mjs', prompt('s-ups'));
    hook('auto-continue.mjs', prompt('s-ups'));
    hook('auto-continue.mjs', prompt('s-ups'));
    const log = readFileSync(join(ROOT, '.continue', 'logs', 's-ups', 'run.md'), 'utf8');
    if (!log.includes('收到用户消息 · 第 1 次') || !log.includes('收到用户消息 · 第 2 次')) {
      return expect(false, `应记两次"收到用户消息"，实际：${log.split('\n').slice(-5).join(' / ')}`, null);
    }
    return expect(log.includes('"promptSeen":2'), 'promptSeen 应累加到 2', null);
  });

  check('日志留痕 · 事件来源取自 --event，并覆盖 payload 推断', () => {
    queue('s-event', '- [ ] 甲');
    // payload 说这是 Stop，参数说这是 UserPromptSubmit → 以参数为准（走"收到用户消息"分支）
    const r = hook('auto-continue.mjs', stop('s-event'), {}, ['--event=UserPromptSubmit']);
    const log = readFileSync(join(ROOT, '.continue', 'logs', 's-event', 'run.md'), 'utf8');
    return expect(
      r.code === 0 && log.includes('[auto-continue · UserPromptSubmit]') && log.includes('收到用户消息'),
      `参数应覆盖 payload 推断并写进日志行首，实际：${log.split('\n').slice(-3).join(' / ')}`,
      r,
    );
  });

  check('日志留痕 · 没有 --event 时退回 payload 推断', () => {
    queue('s-event2', '- [ ] 甲');
    hook('auto-continue.mjs', stop('s-event2'));
    const log = readFileSync(join(ROOT, '.continue', 'logs', 's-event2', 'run.md'), 'utf8');
    return expect(log.includes('[auto-continue · Stop]'), '无参数时应按 payload 写出 Stop', null);
  });

  // ---------------------------------------------------------------- auto-commit
  check('auto-commit · 工作区干净 → 放行', () => {
    const r = hook('auto-commit.mjs', stop('c-clean'));
    return expect(r.code === 0, '应 exit 0', r);
  });

  check('auto-commit · 干净时也留一行并累计 stopSeen', () => {
    hook('auto-commit.mjs', stop('c-trace'));
    const log = readFileSync(join(ROOT, '.continue', 'logs', 'c-trace', 'run.md'), 'utf8');
    return expect(
      /空转 · 工作区干净|就绪 · 工作区干净|放行 · 工作区已干净/.test(log) && log.includes('"stopSeen":1'),
      `应留痕且 stopSeen=1，实际：${log.split('\n').slice(-3).join(' / ')}`,
      null,
    );
  });

  check('提交守卫日志 · 事件来源同样写进行首', () => {
    hook('auto-commit.mjs', stop('c-event'));
    const log = readFileSync(join(ROOT, '.continue', 'logs', 'c-event', 'run.md'), 'utf8');
    return expect(log.includes('[auto-commit · Stop]'), '日志行首应带事件名', null);
  });

  check('auto-commit · 有改动 + 检查失败 → 要求先修', () => {
    config('node -e "process.exit(1)"');
    const r = hook('auto-commit.mjs', stop('c-fail'));
    return expect(r.code === 2 && r.err.includes('自测没通过'), '应 exit 2 且提示自测没通过', r);
  });

  check('auto-commit · config.git.push=false → 只提交、不 push', () => {
    config('', { git: { push: false } });
    const file = join(ROOT, 'dirty-push.txt');
    writeFileSync(file, 'x');
    const r = hook('auto-commit.mjs', stop('c-nopush'), { AUTO_COMMIT_MAX_BLOCKS: '1' });
    rmSync(file);
    return expect(r.code === 2 && r.err.includes('不要 push'), '关闭后提交要求里应明确"不要 push"', r);
  });

  check('auto-commit · config.git.push=true（模板默认）→ 要求推送', () => {
    config('', { git: { push: true } });
    const file = join(ROOT, 'dirty-push2.txt');
    writeFileSync(file, 'x');
    const r = hook('auto-commit.mjs', stop('c-push'), { AUTO_COMMIT_MAX_BLOCKS: '1' });
    rmSync(file);
    return expect(r.code === 2 && r.err.includes('push 到当前分支'), '默认应要求推送', r);
  });

  check('auto-commit · 同一份改动拦满上限后放行', () => {
    config('node -e "process.exit(0)"');
    writeFileSync(join(ROOT, 'dirty.txt'), 'x');
    const env = { AUTO_COMMIT_MAX_BLOCKS: '2' };
    const codes = [1, 2, 3].map(() => hook('auto-commit.mjs', stop('c-cap'), env).code);
    return expect(codes.join(',') === '2,2,0', `退出码应为 2,2,0，实际 ${codes.join(',')}`);
  });

  // ---------------------------------------------------------------- 一次提交一条（T17）
  // 另起一个仓库：主仓库把 doing/ 忽略掉了（否则"工作区干净"那条测不出来），
  // 而这条规则恰恰要看**已跟踪**队列文件的修改。
  const REPO2 = mkdtempSync(join(tmpdir(), 'continue-selftest-q-'));
  try {
    const hooks2 = join(REPO2, '.continue', 'hooks');
    const queue2 = join(REPO2, '.continue', 'doing', 's-q.md');
    mkdirSync(hooks2, { recursive: true });
    mkdirSync(dirname(queue2), { recursive: true });
    for (const name of readdirSync(HERE)) {
      if (name.endsWith('.mjs')) cpSync(join(HERE, name), join(hooks2, name));
    }
    writeFileSync(join(REPO2, '.continue', 'config.json'), JSON.stringify({ checks: {} }));
    const writeQueue = (states) =>
      writeFileSync(
        queue2,
        `# 队列\n\n> 状态：执行中\n> 批次：19990101-0000\n\n${states.map((s, i) => `- [${s}] 第${i + 1}条`).join('\n')}\n`,
      );
    const git2 = (args) => spawnSync('git', args, { cwd: REPO2, env: baseEnv, encoding: 'utf8' });
    const run2 = () =>
      spawnSync(process.execPath, [join(hooks2, 'pre-commit.mjs')], {
        cwd: REPO2,
        env: baseEnv,
        encoding: 'utf8',
      });

    writeQueue([' ', ' ', ' ']);
    git2(['init', '-q']);
    git2(['add', '-A']);
    git2(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'init']);

    check('pre-commit · 一次勾掉 2 条队列条目 → 拒绝', () => {
      writeQueue(['x', 'x', ' ']);
      git2(['add', '-A']);
      const r = run2();
      return expect(
        r.status === 1 && r.stderr.includes('勾掉了 2 条'),
        '应 exit 1 并指出勾掉了 2 条',
        { code: r.status, out: r.stdout, err: r.stderr },
      );
    });

    check('pre-commit · 一次只勾 1 条 → 放行', () => {
      git2(['checkout', '--', '.']);
      writeQueue(['x', ' ', ' ']);
      git2(['add', '-A']);
      const r = run2();
      return expect(r.status === 0, '应 exit 0', { code: r.status, out: r.stdout, err: r.stderr });
    });

    check('pre-commit · 新加的队列文件带多条 [x] 不误报', () => {
      const fresh = join(REPO2, '.continue', 'doing', 's-new.md');
      writeFileSync(fresh, '# 队列\n\n- [x] 甲\n- [x] 乙\n');
      git2(['add', '-A']);
      const r = run2();
      return expect(r.status === 0, '应 exit 0（新增文件不算"勾掉"）', { code: r.status, out: r.stdout, err: r.stderr });
    });
  } finally {
    if (existsSync(REPO2)) rmSync(REPO2, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------- pre-commit
  check('pre-commit · 检查失败 → exit 1；通过 → exit 0', () => {
    config('node -e "process.exit(1)"');
    const bad = hook('pre-commit.mjs', '');
    config('node -e "process.exit(0)"');
    const good = hook('pre-commit.mjs', '');
    if (bad.code !== 1) return expect(false, '失败时应 exit 1', bad);
    return expect(good.code === 0, '通过时应 exit 0', good);
  });
} finally {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 输出（契约 4：一单元一行，失败才展开）
let failed = 0;
for (const r of results) {
  if (r.ok) continue;
  failed += 1;
  console.error(`  ✗ ${r.name}\n      ${r.why}`);
}
if (failed > 0) {
  console.error(`\n钩子自检未通过：${failed}/${results.length} 项。`);
  process.exit(1);
}
console.log(`钩子自检通过：${results.length} 项。`);
