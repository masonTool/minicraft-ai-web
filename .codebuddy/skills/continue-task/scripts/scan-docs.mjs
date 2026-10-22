#!/usr/bin/env node
/**
 * 项目已有文档扫描：给出「该并进 `.continue/` 的哪一份」的建议（**只读，不写文件**）。
 *
 * 为什么存在（挡的是哪次事故）：
 *   装到存量项目时，用户手上已经有一堆文档：TODO / ROADMAP / CHANGELOG / 架构说明 / 踩坑笔记。
 *   框架装完如果不理它们，结果是**两套事实源并存**——AI 只读 `.continue/`，
 *   用户的需求和踩坑还躺在原来的文件里，等于装上就有一半失忆。
 *   而"哪个文件该并到哪"靠人翻目录，翻漏一个不会有任何提示。
 *
 * 但**判断内容语义、决定怎么合并**仍然只能由 AI 做：脚本负责"发现 + 分类建议 + 是否已登记"，
 * 合并动作与格式约束写在 `SKILL.md` 的「集成已有文档」里。
 *
 * 用法：
 *   node <skill>/scripts/scan-docs.mjs          # 人读的表格
 *   node <skill>/scripts/scan-docs.mjs --json   # 机器读（安装器与 AI 用）
 *   node <skill>/scripts/scan-docs.mjs --all    # 连"无法归类"的也列出来
 *
 * 退出码：0 正常（没找到文档也算正常）/ 2 用法错误。只读、幂等。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.continue', '.codebuddy', '.github', '.idea', '.vscode',
  'dist', 'build', 'out', 'coverage', 'vendor', 'target', '.venv', 'venv',
  '__pycache__', '.next', '.nuxt', '.cache', 'tmp', 'temp', '.turbo',
]);

const DOC_EXT = /\.(md|markdown|mdx|txt)$/i;
const MAX_BYTES = 200 * 1024;
const MAX_FILES = 800;
const MAX_DEPTH = 5;

/**
 * 文件名 / 路径 → 建议目标。**按顺序匹配，先命中先算**。
 *
 * 顺序不是随手排的：`CHANGELOG.md` 也含 "LOG"，`ARCHITECTURE.md` 也可能被 README 规则吃掉，
 * 所以具体词放前面、宽泛词放后面。
 */
const RULES = [
  {
    re: /(^|\/)(changelog|changes|history|release[-_]?notes|done)(\.[^/]*)?$/i,
    target: 'DONE',
    reason: '文件名像变更 / 发布历史',
  },
  {
    re: /(^|\/)(todo|todos|task|tasks|roadmap|backlog|issues?|plan|milestones?)(\.[^/]*)?$/i,
    target: 'TASKS',
    reason: '文件名像待办 / 计划 / 需求',
  },
  {
    re: /(^|\/)(tips?|troubleshooting|gotchas?|faq|notes?|experience|lessons)(\.[^/]*)?$/i,
    target: 'TIPS',
    reason: '文件名像踩坑 / 经验笔记',
  },
  {
    re: /(^|\/)(architecture|design|overview|modules?|structure|internals)(\.[^/]*)?$/i,
    target: 'OVERVIEW',
    reason: '文件名像架构 / 模块说明',
  },
  {
    re: /(^|\/)(readme|contributing|agents?|development|conventions?|styleguide)(\.[^/]*)?$/i,
    target: 'README',
    reason: '文件名像项目说明 / 开发约定',
  },
];

/** 内容兜底：文件名认不出来时，看正文特征。 */
function classifyByContent(text) {
  const todo = (text.match(/^[ \t]*[-*][ \t]+\[ \][ \t]+\S/gm) ?? []).length;
  if (todo >= 3) return { target: 'TASKS', reason: `正文有 ${todo} 条未勾选任务` };
  if (/^#{1,3}[^\n]*(架构|模块|设计|结构)/m.test(text)) {
    return { target: 'OVERVIEW', reason: '正文有架构 / 模块类小节' };
  }
  if (/(踩坑|坑点|根因|troubleshooting|gotcha|pitfall)/i.test(text)) {
    return { target: 'TIPS', reason: '正文像踩坑记录' };
  }
  if (/(changelog|变更记录|版本历史|release notes)/i.test(text)) {
    return { target: 'DONE', reason: '正文像变更历史' };
  }
  return null;
}

/** 已经合并过的文档会被写成 `> 来源：路径`，扫到就不再列为待迁移。 */
function registeredSources(root) {
  const dir = join(root, '.continue');
  const found = new Set();
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    let text;
    try {
      text = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('来源')) continue;
      // 排除中文标点：`> 来源：docs/a.md，见…` 不能把",见…"也当成路径的一部分
      const m = /来源[：:]\s*`?([^`\s|）)，,。；;、]+)/.exec(line);
      if (!m) continue;
      const path = m[1].replace(/^\.\//, '').replace(/#.*$/, '').split(sep).join('/');
      found.add(path);
    }
  }
  return found;
}

/**
 * 扫描 `root` 下的文档。返回结构给安装器和 JSON 输出共用，所以字段都保持稳定：
 *   { root, scanned, truncated, candidates: [{path, lines, target, reason, registered}],
 *     unclassified: [path], registered: [path] }
 */
export function scanProjectDocs(root = process.cwd()) {
  const files = [];
  let truncated = false;

  (function walk(dir, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      // 不跟符号链接：可能指到仓库外，扫描范围就失控了
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !DOC_EXT.test(entry.name)) continue;
      // `*.continue-do.md` 是本框架冲突时生成的备份，不是用户文档
      if (/\.continue-do\.md$/i.test(entry.name)) continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      // 空文件 / 只有一行标题的残片没有集成价值；阈值压到 10 字节，
      // 免得把 `# 变更\n\n## 1.0\n` 这种短 CHANGELOG 漏掉
      if (stat.size > MAX_BYTES || stat.size < 10) continue;
      files.push(full);
    }
  })(root, 0);

  const rel = (full) => relative(root, full).split(sep).join('/');
  const known = registeredSources(root);
  const candidates = [];
  const unclassified = [];

  for (const full of files) {
    const path = rel(full);
    // 安装器自己写的入口文件不是"用户的已有文档"
    if (path === 'AGENTS.md') continue;
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const byName = RULES.find((rule) => rule.re.test(path));
    const hit = byName
      ? { target: byName.target, reason: byName.reason }
      : classifyByContent(text);
    if (!hit) {
      unclassified.push(path);
      continue;
    }
    candidates.push({
      path,
      lines: text.replace(/\r?\n$/, '').split(/\r?\n/).length,
      target: hit.target,
      reason: hit.reason,
      registered: known.has(path),
    });
  }

  candidates.sort((a, b) => {
    if (a.registered !== b.registered) return a.registered ? 1 : -1;
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    return a.path.localeCompare(b.path);
  });

  return {
    root,
    scanned: files.length,
    truncated,
    candidates,
    unclassified: unclassified.sort(),
    registered: candidates.filter((item) => item.registered).map((item) => item.path),
  };
}

// ------------------------------------------------------------------ CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => !['--json', '--all'].includes(a));
  if (unknown.length > 0) {
    console.error(`不认识的参数：${unknown.join(' ')}`);
    console.error('用法：node scan-docs.mjs [--json] [--all]');
    process.exit(2);
  }

  const result = scanProjectDocs(process.cwd());

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  }

  const pending = result.candidates.filter((item) => !item.registered);
  console.log(`已有文档扫描：${result.scanned} 份${result.truncated ? '（目录过大，已截断）' : ''}`);
  if (pending.length === 0) {
    console.log('  没有待集成的文档。');
  } else {
    console.log(`\n待集成（${pending.length} 份）：`);
    console.log('  目标       行数   路径');
    for (const item of pending) {
      console.log(
        `  ${item.target.padEnd(9)} ${String(item.lines).padStart(5)}   ${item.path}  · ${item.reason}`,
      );
    }
  }
  if (result.registered.length > 0) {
    console.log(`\n已登记来源（${result.registered.length} 份，不再重复提示）：`);
    for (const path of result.registered) console.log(`  ${path}`);
  }
  if (argv.includes('--all') && result.unclassified.length > 0) {
    console.log(`\n无法归类（${result.unclassified.length} 份，自行判断要不要并）：`);
    for (const path of result.unclassified) console.log(`  ${path}`);
  }
  console.log('\n只读扫描，未写任何文件。合并规则见 SKILL.md「集成已有文档」。');
}
