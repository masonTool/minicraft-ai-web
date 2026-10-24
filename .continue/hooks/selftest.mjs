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
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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

function hook(script, payload, env = {}, args = [], cwd = ROOT) {
  const res = spawnSync(process.execPath, [join(cwd, '.continue', 'hooks', script), ...args], {
    cwd,
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
  // .worktree/ 同理：交接用例会在里面建树、写收件箱
  writeFileSync(join(ROOT, '.continue', '.gitignore'), '.logs/\nauto.off\ndoing/\n.worktree/\n');
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
    const file = join(ROOT, '.continue', '.logs', 's-none', 'run.md');
    return expect(!existsSync(file), `不应创建 ${file}`, null);
  });

  check('日志留痕 · 递任务与空转可区分且 stopSeen 累加', () => {
    queue('s-trace', '- [ ] 甲');
    hook('auto-continue.mjs', stop('s-trace'));
    const first = readFileSync(join(ROOT, '.continue', '.logs', 's-trace', 'run.md'), 'utf8');
    rmSync(join(DOING, 's-trace.md'));
    hook('auto-continue.mjs', stop('s-trace'));
    const second = readFileSync(join(ROOT, '.continue', '.logs', 's-trace', 'run.md'), 'utf8');
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
  check('archive-queue · 归档成 .logs/<会话ID>/queue.md（累积，不按批次新建）', () => {
    queue('s-arch', '- [x] 甲\n  - 验证：`npm test` 通过');
    const r = hook('archive-queue.mjs', null, {}, ['s-arch']);
    if (r.code !== 0) return expect(false, '归档脚本应 exit 0', r);
    if (existsSync(join(DOING, 's-arch.md'))) return expect(false, '队列文件应已移出 doing/', r);
    const dest = join(ROOT, '.continue', '.logs', 's-arch', 'queue.md');
    if (!existsSync(dest)) return expect(false, '应有 .logs/s-arch/queue.md', r);
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
    const text = readFileSync(join(ROOT, '.continue', '.logs', 's-arch2', 'queue.md'), 'utf8');
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
    const dest = join(ROOT, '.continue', '.logs', 's-archdec', 'decision.md');
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
    const log = readFileSync(join(ROOT, '.continue', '.logs', 's-cont', 'run.md'), 'utf8');
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

  /**
   * 待接管队列（`worktree.mjs` 建树时写的 `doing/worktree.md`）：改名 + 补头部会话 ID
   * 必须由钩子做，而且「已接管 / 冲突 / 失败」三种结果都不能静默——这是"换棵树继续干活"
   * 的唯一交接通道，静默一次就等于任务丢了。
   */
  check('queue-init · 待接管队列被改名接管，头部会话 ID 补全', () => {
    const sid = 'wt-adopt';
    writeFileSync(
      join(DOING, 'worktree.md'),
      '# 队列 · 会话 worktree（待接管）\n\n> 状态：执行中\n> 批次：19990101-0000\n\n- [ ] 甲\n- [ ] [自审] 占位\n',
    );
    const r = hook('queue-init.mjs', prompt(sid));
    const adopted = existsSync(join(DOING, `${sid}.md`)) ? readFileSync(join(DOING, `${sid}.md`), 'utf8') : '';
    if (existsSync(join(DOING, 'worktree.md'))) {
      return expect(false, 'worktree.md 应已改名（留着的话下次会话还会把它当待接管队列）', r);
    }
    if (!adopted.startsWith(`# 队列 · 会话 ${sid}\n`)) {
      return expect(false, `第一行应补成完整会话 ID，实际：${JSON.stringify(adopted.split('\n')[0])}`, r);
    }
    return expect(r.out.includes('已接管交接队列'), '注入里应说明"已接管"（否则 AI 会再建一份队列）', r);
  });

  check('queue-init · 目标队列已存在时不覆盖待接管文件', () => {
    const sid = 'wt-conflict';
    writeFileSync(
      join(DOING, 'worktree.md'),
      '# 队列 · 会话 worktree（待接管）\n\n> 状态：执行中\n> 批次：19990101-0001\n\n- [ ] 乙\n- [ ] [自审] 占位\n',
    );
    queue(sid, '- [ ] 已有任务');
    const before = readFileSync(join(DOING, `${sid}.md`), 'utf8');
    const r = hook('queue-init.mjs', prompt(sid));
    const after = readFileSync(join(DOING, `${sid}.md`), 'utf8');
    if (!existsSync(join(DOING, 'worktree.md'))) return expect(false, '冲突时不该动 worktree.md', r);
    if (after !== before) return expect(false, '冲突时不该改写已有队列（那就是丢进度）', r);
    rmSync(join(DOING, 'worktree.md'));
    return expect(r.out.includes('同时存在'), '注入里应告警"两份都在，人工合并"', r);
  });

  /**
   * 「别的会话的队列」这一段的三态：本会话有队列 → 不提；别人活跃 → 给建树指引；
   * 别人已停 → 只列出来，走"接管/忽略"。
   * 分档的意义：对**活着**的会话开工作树并行，对**死掉**的才谈接管——旧版把两者
   * 写成同一句"先问用户"，于是"正在跑"的场景被引导成"要不要接管"（实测就是这个后果）。
   */
  const touchLog = (stem, ageMin = 0) => {
    const dir = join(ROOT, '.continue', '.logs', stem);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'run.md');
    writeFileSync(file, '# 会话日志\n');
    if (ageMin > 0) {
      const at = new Date(Date.now() - ageMin * 60 * 1000);
      utimesSync(file, at, at);
    }
  };
  const clearDoing = () => {
    for (const name of readdirSync(DOING)) rmSync(join(DOING, name));
  };
  const injectText = (r) => {
    try {
      return JSON.parse(r.out).hookSpecificOutput?.additionalContext ?? '';
    } catch {
      return '';
    }
  };

  check('queue-init · 别的会话活跃 → 标注"可能还在跑"并给出建树指引', () => {
    clearDoing();
    queue('s-active', '- [ ] 甲');
    touchLog('s-active');
    const r = hook('queue-init.mjs', prompt('s-quiet-1'));
    const ctx = injectText(r);
    if (!ctx.includes('可能还在跑')) return expect(false, `应标注"可能还在跑"，实际：${ctx.slice(0, 300)}`, r);
    return expect(
      ctx.includes('worktree.mjs') && ctx.includes('--task='),
      '活跃会话应给出建树指引（否则又退化成"要不要接管"）',
      r,
    );
  });

  check('queue-init · 本会话已有队列 → 不再提别的会话队列', () => {
    queue('s-quiet-2', '- [ ] 自己的活');
    const r = hook('queue-init.mjs', prompt('s-quiet-2'));
    const ctx = injectText(r);
    return expect(!ctx.includes('其他会话还有未完成队列'), '有自己的队列时不该再提别人（会诱导接管）', r);
  });

  check('queue-init · 别的会话已停 → 只列出，不给建树指引', () => {
    clearDoing();
    queue('s-stale', '- [ ] 乙');
    touchLog('s-stale', 60);
    const r = hook('queue-init.mjs', prompt('s-quiet-3'));
    const ctx = injectText(r);
    if (!ctx.includes('已停（可接管）')) return expect(false, `应标注"已停（可接管）"，实际：${ctx.slice(0, 300)}`, r);
    clearDoing();
    return expect(!ctx.includes('--task='), '已停会话不该给建树指引（该谈接管）', r);
  });

  /**
   * 树里不列父树的队列：树是从 HEAD 检出的，父树 `doing/` 里已入库的队列会一起跟过来，
   * 照旧列出就会诱发"要不要接管"的假决策——正确答案是"那些跟你无关"。
   */
  check('queue-init · 并行树里不列父树的队列，并说明原因', () => {
    clearDoing();
    queue('s-parent', '- [ ] 父树的活');
    const wt = join(ROOT, '.continue', '.worktree', 'selftest-wt');
    const added = sh('git', ['worktree', 'add', '-b', 'worktree_selftest_19990101', wt, 'HEAD']);
    if (added.status !== 0) return expect(false, `建树失败：${(added.stderr || '').slice(0, 200)}`, null);
    // `doing/` 在临时项目里是 gitignore 的，HEAD 带不过来——手工放一份"别人的队列"
    mkdirSync(join(wt, '.continue', 'doing'), { recursive: true });
    writeFileSync(
      join(wt, '.continue', 'doing', 's-foreign.md'),
      '# 队列\n\n> 状态：执行中\n> 批次：19990101-0002\n\n- [ ] 别人的\n',
    );
    const r = hook('queue-init.mjs', prompt('s-in-tree'), {}, [], wt);
    const ctx = injectText(r);
    sh('git', ['worktree', 'remove', '--force', wt]);
    sh('git', ['branch', '-D', 'worktree_selftest_19990101']);
    if (ctx.includes('其他会话还有未完成队列')) {
      return expect(false, '树里不该列父树 / 祖先树的队列', r);
    }
    return expect(ctx.includes('这是一棵并行工作树'), '应说明"这些队列不是本树的任务，已忽略"', r);
  });

  /**
   * 工作树里的收尾**不再多一步**（2026-10-24 取消自动 rebase / merge）。
   *
   * 为什么单独钉：那一套逻辑是靠"注入里点名命令"驱动的；文案里还留着 `worktree-sync`，
   * AI 就会去跑一条已经删掉的脚本（或者更糟：自己手搓 `git merge` 合回父分支）。
   * 用户要的语义是"做完就结束，后面的事我自己处理"，所以这里既查"没提同步"，也查"明说不合并"。
   */
  check('auto-continue · 工作树里收尾也是五步，明说不合并、不点名已删的 worktree-sync', () => {
    const wt = join(ROOT, '.continue', '.worktree', 'selftest-wrap-hint');
    const added = sh('git', ['worktree', 'add', '-b', 'worktree-wrap-hint_19990101', wt, 'HEAD']);
    if (added.status !== 0) return expect(false, `建树失败：${(added.stderr || '').slice(0, 200)}`, null);
    const sid = 's-tree-wrap';
    mkdirSync(join(wt, '.continue', 'doing'), { recursive: true });
    writeFileSync(
      join(wt, '.continue', 'doing', `${sid}.md`),
      '# 队列\n\n> 状态：执行中\n> 批次：19990101-0002\n\n' +
        '- [x] 甲\n  - 做了什么：x\n  - 验证：`true`\n' +
        '- [x] [自审] 占位\n  - L1：x\n  - L2：y\n  - L3：z\n',
    );
    const r = hook('auto-continue.mjs', stop(sid), {}, ['--event=Stop'], wt);
    sh('git', ['worktree', 'remove', '--force', wt]);
    sh('git', ['branch', '-D', 'worktree-wrap-hint_19990101']);
    const text = `${r.err}${r.out}`;
    if (/worktree-sync/.test(text)) {
      return expect(false, '注入不该再点名 worktree-sync（脚本已删）', r);
    }
    return expect(/不合并/.test(text), '注入应明说收尾不合并、由用户处理', r);
  });

  /**
   * 树名里的"单词"必须是英文：AI 顺手写成中文时，**当场拒绝**比悄悄建一棵 `worktree_导出_…` 好。
   * 中文进分支名要多一层编码，且和"完整树名可以照抄重跑"的解析规则混在一起会有歧义。
   */
  check('worktree.mjs · 非英文单词直接拒绝（exit 2，不建树）', () => {
    const r = hook('worktree.mjs', '', {}, ['导出', '--no-window']);
    return expect(
      r.code === 2 && /单词不合法/.test(r.err),
      `应 exit 2 并说明单词规则（实际 exit=${r.code}）`,
      { err: r.err },
    );
  });

  /**
   * `git.push=false` 必须同时管住"建树顺手推分支"：那是同一个开关，
   * 用户说"不要替我推"，建树却偷偷推一条，等于绕过他的选择。
   */
  check('worktree.mjs · config.git.push=false 时不推远程', () => {
    const cfgPath = join(ROOT, '.continue', 'config.json');
    const before = readFileSync(cfgPath, 'utf8');
    let parsed = {};
    try {
      parsed = JSON.parse(before);
    } catch {
      parsed = {};
    }
    writeFileSync(cfgPath, JSON.stringify({ ...parsed, git: { ...(parsed.git ?? {}), push: false } }, null, 2));
    const r = hook('worktree.mjs', '', {}, ['export', '--dry-run']);
    writeFileSync(cfgPath, before);
    return expect(
      /git\.push=false/.test(r.out) && !/git push -u origin/.test(r.out),
      '应打印"不推远程：config.json 的 git.push=false"，且计划里没有 push',
      r,
    );
  });

  /**
   * 协议指纹：会话开着的时候框架被换掉 → **必须重新注入一次**并声明旧协议作废。
   *
   * 为什么钉这条（2026-10-24 用户实测的事故）：老会话升级后，上下文里还是旧协议，
   * AI 把队列写到新钩子不读的位置，全程没有报错。指纹没变时仍然只注入一次（不能每轮都刷屏）。
   */
  check('queue-init · 协议变了就重新注入并声明旧协议作废', () => {
    const sid = 's-upgrade';
    const first = hook('queue-init.mjs', prompt(sid));
    if (!JSON.parse(first.out || '{}')?.hookSpecificOutput) {
      return expect(false, '首次应注入', first);
    }
    const quiet = hook('queue-init.mjs', prompt(sid));
    if (quiet.out.includes('additionalContext')) {
      return expect(false, '协议没变时第二条消息应静默', quiet);
    }
    // 模拟"技能升级 + 重装"：hooks 内容一变，指纹就变
    const libFile = join(HOOKS, 'lib.mjs');
    const original = readFileSync(libFile, 'utf8');
    writeFileSync(libFile, `${original}\n// protocol bump for selftest\n`);
    const again = hook('queue-init.mjs', prompt(sid));
    writeFileSync(libFile, original);
    const ctx = injectText(again);
    return expect(
      ctx.includes('框架已升级') && ctx.includes('以本次注入为准'),
      `协议变了应重新注入并声明旧协议作废（ctx 长 ${ctx.length}）`,
      again,
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

  /**
   * 旧版交接目录 `.continue/worktree/todo/` 自动并进 `doing/.worktree/todo/`。
   *
   * 挡的是"老会话还在用旧路径"：升级后它照样往旧路径写，新钩子只读新路径——
   * 文件在、钩子看不见，表现成"队列生成了却不动"，而且没有任何报错。
   */
  check('queue-init · 旧版收件箱目录自动并进 doing/.worktree/todo', () => {
    const legacyTodo = join(ROOT, '.continue', 'worktree', 'todo');
    mkdirSync(legacyTodo, { recursive: true });
    writeFileSync(join(legacyTodo, 'queue.md'), '# 队列\n\n> 状态：执行中\n> 批次：19990101-0005\n\n- [ ] 甲\n');
    const r = hook('queue-init.mjs', prompt('s-legacy-wt'));
    const moved = join(ROOT, '.continue', 'doing', '.worktree', 'todo', 'queue.md');
    const ok = existsSync(moved) && !existsSync(legacyTodo);
    // 收尾：把搬过去的收件箱删掉，后面的派生用例不该看到它
    rmSync(moved, { force: true });
    return expect(ok, '旧路径的待派发队列应搬到 doing/.worktree/todo/，旧目录应消失', r);
  });

  check('queue-init · 旧版计划文件被归档到 .logs/（机制已移除，不留在 doing/）', () => {
    writeFileSync(join(DOING, 's-legacy-plan.md'), '# 计划\n\n## MS1 · 甲\n- [ ] `MS1.1` 一\n');
    const r = hook('queue-init.mjs', prompt('s-legacy'));
    const dest = join(ROOT, '.continue', '.logs', 's-legacy', 'plan.md');
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
    const log = readFileSync(join(ROOT, '.continue', '.logs', 's-ups', 'run.md'), 'utf8');
    if (!log.includes('收到用户消息 · 第 1 次') || !log.includes('收到用户消息 · 第 2 次')) {
      return expect(false, `应记两次"收到用户消息"，实际：${log.split('\n').slice(-5).join(' / ')}`, null);
    }
    return expect(log.includes('"promptSeen":2'), 'promptSeen 应累加到 2', null);
  });

  /**
   * 上一条先跑 `queue-init`（它建了日志文件），所以掩盖了一个时序问题：
   * 两个钩子挂在**同一个 UserPromptSubmit 事件**上、并发执行，谁先跑到不保证。
   * 这条**只**跑 auto-continue——判据若依赖"文件已存在"，这一行就会时有时无（T46）。
   */
  check('日志留痕 · 只跑 auto-continue 也必须写"收到用户消息"（不依赖 queue-init 的时序）', () => {
    const r = hook('auto-continue.mjs', prompt('s-ups-alone'));
    const log = readFileSync(join(ROOT, '.continue', '.logs', 's-ups-alone', 'run.md'), 'utf8');
    return expect(
      r.code === 0 && log.includes('收到用户消息 · 第 1 次'),
      `不依赖另一个钩子也要留痕，实际：${log.split('\n').slice(-3).join(' / ')}`,
      r,
    );
  });

  check('日志留痕 · 事件来源取自 --event，并覆盖 payload 推断', () => {
    queue('s-event', '- [ ] 甲');
    // payload 说这是 Stop，参数说这是 UserPromptSubmit → 以参数为准（走"收到用户消息"分支）
    const r = hook('auto-continue.mjs', stop('s-event'), {}, ['--event=UserPromptSubmit']);
    const log = readFileSync(join(ROOT, '.continue', '.logs', 's-event', 'run.md'), 'utf8');
    return expect(
      r.code === 0 && log.includes('[auto-continue · UserPromptSubmit]') && log.includes('收到用户消息'),
      `参数应覆盖 payload 推断并写进日志行首，实际：${log.split('\n').slice(-3).join(' / ')}`,
      r,
    );
  });

  check('日志留痕 · 没有 --event 时退回 payload 推断', () => {
    queue('s-event2', '- [ ] 甲');
    hook('auto-continue.mjs', stop('s-event2'));
    const log = readFileSync(join(ROOT, '.continue', '.logs', 's-event2', 'run.md'), 'utf8');
    return expect(log.includes('[auto-continue · Stop]'), '无参数时应按 payload 写出 Stop', null);
  });

  // ---------------------------------------------------------------- auto-commit
  check('auto-commit · 工作区干净 → 放行', () => {
    const r = hook('auto-commit.mjs', stop('c-clean'));
    return expect(r.code === 0, '应 exit 0', r);
  });

  check('auto-commit · 干净时也留一行并累计 stopSeen', () => {
    hook('auto-commit.mjs', stop('c-trace'));
    const log = readFileSync(join(ROOT, '.continue', '.logs', 'c-trace', 'run.md'), 'utf8');
    return expect(
      /空转 · 工作区干净|就绪 · 工作区干净|放行 · 工作区已干净/.test(log) && log.includes('"stopSeen":1'),
      `应留痕且 stopSeen=1，实际：${log.split('\n').slice(-3).join(' / ')}`,
      null,
    );
  });

  check('提交守卫日志 · 事件来源同样写进行首', () => {
    hook('auto-commit.mjs', stop('c-event'));
    const log = readFileSync(join(ROOT, '.continue', '.logs', 'c-event', 'run.md'), 'utf8');
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

  // ---------------------------------------------------------------- 队列写回（原子 + 换行风格）
  /**
   * 钩子对队列只有两处写：递任务时 `[ ]`→`[~]`、连续 N 轮没做完 `[ ]`/`[~]`→`[阻塞]`。
   * 这两处写的是**唯一事实源**，所以钉三件事：
   *   · 换行风格跟原文件（CRLF 队列不能被整体改写成 LF，否则 diff 全红）；
   *   · 落盘是 tmp+rename（不留 `.tmp`；中途被杀也不会留半截文件）；
   *   · 行号对得上（`markEntryDoing` 与 `parseQueue` 必须同一套切分，否则标到别的条目）。
   */
  check('队列写回 · CRLF 原样保留、无 .tmp 残留、按序号改对条目', () => {
    const file = join(DOING, 's-crlf.md');
    mkdirSync(DOING, { recursive: true });
    writeFileSync(file, '# 队列\r\n\r\n> 状态：执行中\r\n\r\n- [ ] 甲\r\n- [ ] 乙\r\n');
    const script = [
      `import { markBlocked, markEntryDoing, parseQueue } from ${JSON.stringify(join(HOOKS, 'lib.mjs'))};`,
      "import { readFileSync } from 'node:fs';",
      `const p = ${JSON.stringify(file)};`,
      'markBlocked(p, 1);',
      "const q = parseQueue(readFileSync(p, 'utf8'));",
      'markEntryDoing(p, q.entries.find((e) => e.kind === "todo"));',
      "process.stdout.write(readFileSync(p, 'utf8'));",
    ].join('\n');
    const r = sh(process.execPath, ['--input-type=module', '-e', script]);
    const text = r.stdout ?? '';
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const strayLf = (text.replace(/\r\n/g, '').match(/\n/g) ?? []).length;
    return expect(
      r.status === 0 &&
        crlf === 6 &&
        strayLf === 0 &&
        !existsSync(`${file}.tmp`) &&
        text.includes('- [阻塞] 甲') &&
        text.includes('- [~] 乙'),
      '应保持 6 个 CRLF、无裸 LF、无 .tmp、且两条各按序号改对',
      { code: r.status, crlf, strayLf, err: (r.stderr || '').slice(0, 300), text: text.slice(0, 200) },
    );
  });

// ---------------------------------------------------------------- 交接派发（dispatch / 收件箱接管）
/**
 * 一条完整链路：主工作区写 `todo/queue.md` + `context.md` → Stop 派发成工作树 →
 * 新树里第一条消息接管成 `doing/<新 sid>.md`。
 *
 * 临时项目本来就是 git repo（上面 `git init` 过），所以 `git worktree add` 能真跑；
 * `--no-window` 保证无 GUI 环境不会弹窗——CI 里弹一个指向临时目录的 IDE 窗口是灾难。
 *
 * 每一步都单独断言（建树 / 状态 / 幂等 / 接管 / 递任务），失败时能一眼看出断在哪一环。
 */
const TODO_DIR = join(ROOT, '.continue', 'doing', '.worktree', 'todo');
/** 树名里的日期（`worktree_<单词>_<YYYYMMDD>`）：按本地今天算，和钩子同一口径。 */
const today = new Date();
const DAY_STAMP = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
const PARENT_SID = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1';
const CHILD_SID = 'd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2';
const OTHER_SID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
let dispatchedTree = null;

/**
 * 交接的**前提**：`doing/` 里已经有别的会话在跑。
 * 空树时只该在本会话干——`dispatch` 有守卫挡着，用例里必须先造出这个前提。
 */
function writeOtherQueue() {
  mkdirSync(DOING, { recursive: true });
  writeFileSync(
    join(DOING, 'bbbbbb.md'),
    `# 队列 · 会话 ${OTHER_SID}\n\n> 状态：执行中\n> 批次：19990101-0009\n\n- [ ] 别人的活\n`,
  );
}

function writeTodo() {
  mkdirSync(TODO_DIR, { recursive: true });
  writeFileSync(
    join(TODO_DIR, 'queue.md'),
    `# 队列 · 会话 ${PARENT_SID}\n\n> 状态：执行中\n> 批次：19990101-0000\n> 树名：auth\n\n- [ ] 甲任务\n- [ ] [自审] 收尾前三层自审\n`,
  );
  writeFileSync(join(TODO_DIR, 'context.md'), '# 上下文\n\n把甲任务做完，验证方式是看 a.txt。\n');
  rmSync(join(TODO_DIR, 'state.json'), { force: true });
  writeOtherQueue();
}

check('交接 · 主工作区不接管收件箱，只提示待派发', () => {
  writeTodo();
  const r = hook('queue-init.mjs', prompt('c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0'), {}, ['--event=UserPromptSubmit']);
  if (!existsSync(join(TODO_DIR, 'queue.md'))) return expect(false, '主工作区把收件箱抢走了', r);
  if (existsSync(join(DOING, 'c0c0c0.md'))) return expect(false, '主工作区不应生成本会话队列', r);
  return expect(r.out.includes('待派发队列'), '注入应提示收件箱有待派发队列', r);
});

check('交接 · dispatch 按 queue.md 的树名建树并记录状态', () => {
  const r = hook('dispatch.mjs', stop(PARENT_SID), {}, ['--event=Stop', '--no-window']);
  const stateFile = join(TODO_DIR, 'state.json');
  if (!existsSync(stateFile)) return expect(false, '应写 state.json', r);
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  dispatchedTree = state.tree;
  if (r.code !== 0) return expect(false, '应 exit 0（失败也不拦会话）', r);
  if (state.branch !== `worktree_auth_${DAY_STAMP}` || state.treeName !== state.branch) {
    return expect(false, `树名/分支应为 worktree_auth_${DAY_STAMP}，实际 ${state.branch}`, r);
  }
  return expect(
    existsSync(join(state.tree, '.continue', 'hooks', 'queue-init.mjs')),
    '新树应检出 HEAD（含钩子）',
    r,
  );
});

check('交接 · 已派发且树还在 → 不重复建树', () => {
  const r = hook('dispatch.mjs', stop(PARENT_SID), {}, ['--event=Stop', '--no-window']);
  const state = JSON.parse(readFileSync(join(TODO_DIR, 'state.json'), 'utf8'));
  return expect(
    r.code === 0 && state.tree === dispatchedTree && r.out.includes('已有待接管'),
    `应提示已有执行树、不重建（tree=${state.tree} 期望=${dispatchedTree}）`,
    r,
  );
});

check('交接 · 新树第一条消息接管 todo（批次沿用 + 上下文附上）', () => {
  const r = hook('queue-init.mjs', prompt(CHILD_SID), {}, ['--event=UserPromptSubmit'], dispatchedTree);
  const target = join(dispatchedTree, '.continue', 'doing', 'd2d2d2.md');
  if (!existsSync(target)) return expect(false, `应在树里生成 ${target}`, r);
  const text = readFileSync(target, 'utf8');
  if (!text.startsWith(`# 队列 · 会话 ${CHILD_SID}`)) return expect(false, '首行应换成新会话完整 ID', r);
  if (!text.includes('19990101-0000')) return expect(false, '批次号应沿用', r);
  if (existsSync(join(TODO_DIR, 'queue.md'))) return expect(false, '接管后应收件箱清空', r);
  if (existsSync(join(TODO_DIR, 'context.md'))) return expect(false, '接管后 context 也应清空', r);
  if (!r.out.includes('把甲任务做完')) return expect(false, '注入应附上 context 原文', r);
  const archived = join(dispatchedTree, '.continue', '.logs', 'd2d2d2', 'handoff.md');
  return expect(existsSync(archived), 'context 应存档到 .logs/<sid>/handoff.md', r);
});

check('交接 · 新树里 Stop 正常递任务', () => {
  const r = hook('auto-continue.mjs', stop(CHILD_SID), {}, ['--event=Stop'], dispatchedTree);
  return expect(r.code === 2 && /1\/2 条/.test(`${r.err}${r.out}`), '应递第 1/2 条', r);
});

/**
 * 同一会话派发第二批：树 1 还在，但 `queue.md` 内容变了。
 * 只看"树还在"会把它当成"已派发"放行，第二批永远不派发且不报错——
 * 这是**静默丢活**，比多建一棵树严重得多。
 */
check('交接 · 收件箱内容变了 → 允许再派发一棵（同名单词加 -2）', () => {
  writeFileSync(
    join(TODO_DIR, 'queue.md'),
    `# 队列 · 会话 ${PARENT_SID}\n\n> 状态：执行中\n> 批次：19990101-0001\n> 树名：auth\n\n- [ ] 乙任务\n- [ ] [自审] 自审\n`,
  );
  writeFileSync(join(TODO_DIR, 'context.md'), '# 上下文\n\n第二批。\n');
  const r = hook('dispatch.mjs', stop(PARENT_SID), {}, ['--event=Stop', '--no-window']);
  const state = JSON.parse(readFileSync(join(TODO_DIR, 'state.json'), 'utf8'));
  return expect(
    state.treeName === `worktree_auth_${DAY_STAMP}-2` && existsSync(state.tree),
    `内容变了应再派发一棵（实际 treeName=${state.treeName}）`,
    r,
  );
});

/**
 * `queue.md` 没写 `> 树名：` 时**仍然要能派发**：树名退回 `worktree_task_<日期>`。
 *
 * 为什么不能"没树名就报错"：接管的是一份合法队列，名字只是标识；
 * 因为少一行头信息就停下，等于让整条交接链卡在一个非关键字段上。
 */
check('交接 · queue.md 没写树名 → 退回 worktree_task_<日期>', () => {
  writeFileSync(
    join(TODO_DIR, 'queue.md'),
    `# 队列 · 会话 ${PARENT_SID}\n\n> 状态：执行中\n> 批次：19990101-0003\n\n- [ ] 丙任务\n- [ ] [自审] 自审\n`,
  );
  writeFileSync(join(TODO_DIR, 'context.md'), '# 上下文\n\n第三批（没写树名）。\n');
  const r = hook('dispatch.mjs', stop(PARENT_SID), {}, ['--event=Stop', '--no-window']);
  const state = JSON.parse(readFileSync(join(TODO_DIR, 'state.json'), 'utf8'));
  return expect(
    state.treeName === `worktree_task_${DAY_STAMP}` && existsSync(state.tree),
    `没写树名应退回 worktree_task_${DAY_STAMP}（实际 ${state.treeName}）`,
    r,
  );
});

/**
 * 树被删了、但收件箱内容一个字没变 → **不重建**（2026-10-24 起）。
 *
 * 挡的是"做完了、树被清掉，收件箱忘了删"的情况：那时再建一棵只会多一个同名 `-2` 目录，
 * 甚至把已经做完的活重做一遍。要重跑必须显式删 `state.json`。
 */
check('交接 · 树没了但内容没变 → 不重建，提示删 state.json 才能重跑', () => {
  const stateBefore = JSON.parse(readFileSync(join(TODO_DIR, 'state.json'), 'utf8'));
  rmSync(stateBefore.tree, { recursive: true, force: true });
  sh('git', ['worktree', 'prune']);
  const r = hook('dispatch.mjs', stop(PARENT_SID), {}, ['--event=Stop', '--no-window']);
  const stateAfter = JSON.parse(readFileSync(join(TODO_DIR, 'state.json'), 'utf8'));
  return expect(
    stateAfter.tree === stateBefore.tree &&
      !existsSync(stateAfter.tree) &&
      /已经派发过/.test(r.out) &&
      /state\.json/.test(r.out),
    `应保留原 state、不重建、并给出删 state.json 的出路（实际 tree=${stateAfter.tree}）`,
    r,
  );
});

/**
 * 反向：`doing/` 里一个人都没有时**不该派发**。
 * 这条链最容易犯的错是"因为收件箱有内容就建树"——空树建树等于把
 * "一条命令能做完的事"拆成"建树 + 新窗口 + 接管"，用户每次都得关一个多余窗口。
 */
check('交接 · doing/ 里没人在跑 → 不派发', () => {
  for (const name of readdirSync(DOING)) {
    if (name.endsWith('.md')) rmSync(join(DOING, name), { force: true });
  }
  mkdirSync(TODO_DIR, { recursive: true });
  writeFileSync(
    join(TODO_DIR, 'queue.md'),
    `# 队列 · 会话 ${PARENT_SID}\n\n> 状态：执行中\n> 批次：19990101-0002\n\n- [ ] 丙任务\n- [ ] [自审] 自审\n`,
  );
  rmSync(join(TODO_DIR, 'state.json'), { force: true });
  const r = hook('dispatch.mjs', stop(PARENT_SID), {}, ['--event=Stop', '--no-window']);
  return expect(
    r.code === 0 && !existsSync(join(TODO_DIR, 'state.json')) && /没有别的会话队列/.test(r.out),
    '应放行并说明交接不触发（不建树、不写 state）',
    r,
  );
});

/**
 * 反向的另一半：`doing/` 里那份队列**就是本会话的**。
 * 拿文件名（sid 前 6 位）去跟完整会话 ID 比会永远不等，于是注入说"有别人在跑、
 * Stop 会建树"，而 `dispatch` 的守卫说"本会话已在干、不派发"——两边打架。
 */
check('交接 · 只有本会话的队列时，不说"有别人在跑"', () => {
  const own = 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0';
  for (const name of readdirSync(DOING)) {
    if (name.endsWith('.md')) rmSync(join(DOING, name), { force: true });
  }
  writeFileSync(
    join(DOING, 'e0e0e0.md'),
    `# 队列 · 会话 ${own}\n\n> 状态：执行中\n> 批次：19990101-0003\n\n- [ ] 自己的活\n`,
  );
  writeFileSync(
    join(TODO_DIR, 'queue.md'),
    `# 队列 · 会话 ${own}\n\n> 状态：执行中\n> 批次：19990101-0004\n\n- [ ] 草稿\n`,
  );
  rmSync(join(TODO_DIR, 'state.json'), { force: true });
  const r = hook('queue-init.mjs', prompt(own), {}, ['--event=UserPromptSubmit']);
  return expect(
    /没有\**别的会话队列/.test(r.out),
    '注入应说"没有别的会话队列"（自己的队列不算别人）',
    r,
  );
});

// ---------------------------------------------------------------- version
/**
 * 版本项三态：一致 / 落后 / 没有技能目录。
 *
 * 关键断言是"**永远 exit 0**"——它是提示不是门禁：技能目录常常不在版本库里
 * （被当成本地工具），CI 上根本没有它；把它判红等于给所有 CI 提一个无解要求。
 */
const versionFixtures = (installedVersion, skillVersion) => {
  writeFileSync(
    join(ROOT, '.continue', '.installed.json'),
    JSON.stringify({ version: installedVersion, installedAt: '2000-01-01T00:00:00.000Z', files: {} }),
  );
  const dir = join(ROOT, '.codebuddy', 'skills', 'continue-task');
  if (skillVersion === null) {
    rmSync(join(ROOT, '.codebuddy'), { recursive: true, force: true });
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'VERSION'), `${skillVersion}\n`);
};

check('version · 实例与技能目录一致 → 报一致且 exit 0', () => {
  versionFixtures('1.2.3', '1.2.3');
  const r = hook('audit-version.mjs', {});
  return expect(r.code === 0 && /1\.2\.3/.test(r.out) && /=\s*技能/.test(r.out), '应报"实例 vX = 技能 vX"', r);
});

check('version · 实例落后 → 提示重跑安装器，但仍 exit 0', () => {
  versionFixtures('1.2.3', '1.2.4');
  const r = hook('audit-version.mjs', {});
  if (r.code !== 0) return expect(false, '版本落后不该判红（技能目录可能不在版本库里）', r);
  return expect(/≠/.test(r.out) && /install\.mjs/.test(r.out), '应提示重跑安装器', r);
});

check('version · 没有技能目录 → 跳过比对，exit 0', () => {
  versionFixtures('1.2.3', null);
  const r = hook('audit-version.mjs', {});
  return expect(r.code === 0 && /跳过/.test(r.out), '应提示"技能目录不在，跳过比对"', r);
});

// ---------------------------------------------------------------- 布局迁移（logs → .logs）
/**
 * 改名类改动最怕"代码读新路径、老归档留在旧路径"：功能全绿，历史却静默丢了。
 * 这里直接删掉新目录、造一份旧的，验的是**整体 rename**，不是"读不到就算了"。
 */
check('布局迁移 · 旧的 logs/ 自动改名 .logs/（归档跟着走）', () => {
  rmSync(join(ROOT, '.continue', '.logs'), { recursive: true, force: true });
  const legacy = join(ROOT, '.continue', 'logs');
  mkdirSync(join(legacy, 'oldsid'), { recursive: true });
  writeFileSync(join(legacy, 'oldsid', 'queue.md'), '# 旧归档\n');
  const r = hook('queue-init.mjs', prompt('f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0'), {}, ['--event=UserPromptSubmit']);
  return expect(
    existsSync(join(ROOT, '.continue', '.logs', 'oldsid', 'queue.md')) && !existsSync(legacy),
    '旧 logs/ 应整体改名成 .logs/（内容不丢）',
    r,
  );
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
