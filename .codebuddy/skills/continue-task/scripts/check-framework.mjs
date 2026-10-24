#!/usr/bin/env node
/**
 * 技能自身的一致性检查（**只在框架仓库里跑**，不随框架安装到用户项目）。
 *
 * 为什么把它从 `assets/.continue/hooks/audit-ids.mjs` 里搬出来：那两段
 * （"技能完整性""模板不能被实例污染"）只在框架仓库里生效，却会跟着框架复制进
 * **每一个用户项目**——用户拿到的是永远不执行的死代码，排查时还会以为是自己的问题。
 * 技能自己的规矩，就该由技能自己的脚本查。
 *
 * 查什么：
 *   1. 模板里每个钩子都在安装器 `REQUIRED` 清单里（改模板忘改清单 = 装漏也不报）；
 *   2. 模板必备文档都在，且安装器确实会拷贝；
 *   3. `assets/` 里的模板文档是**空白骨架**，没有混入本项目的批次号 / 模块名；
 *   4. 注册命令都由 `commandFor()` 拼、且拼进了 `--event=`（少了它日志分不清事件来源）。
 *
 * 用法：`node .codebuddy/skills/continue-task/scripts/check-framework.mjs`
 * 退出码：0 通过 / 1 有问题。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS = join(SKILL_DIR, 'assets');
const INSTALLER = join(SKILL_DIR, 'scripts', 'install.mjs');
/** 仓库根（`<root>/.codebuddy/skills/continue-task` 往上三层）：查"文档里的仓库内路径"要用它。 */
const REPO_ROOT = resolve(SKILL_DIR, '..', '..', '..');

const problems = [];
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

if (!existsSync(INSTALLER)) {
  console.error(`  ✗ 找不到安装器：${INSTALLER}`);
  process.exit(1);
}
const installerText = read(INSTALLER) ?? '';

// ------------------------------------------------------------------ 1. 模板钩子 ↔ REQUIRED
const templateHooksDir = join(ASSETS, '.continue', 'hooks');
if (!existsSync(templateHooksDir)) {
  problems.push('assets/.continue/hooks 不存在');
} else {
  for (const name of readdirSync(templateHooksDir)) {
    if (!name.endsWith('.mjs')) continue;
    if (!installerText.includes(`.continue/hooks/${name}`)) {
      problems.push(
        `模板有 hooks/${name}，但 scripts/install.mjs 的 REQUIRED 清单里没有它——装漏了也不会报`,
      );
    }
  }
}

// ------------------------------------------------------------------ 2. 必备文档 ↔ 安装器
for (const name of ['TASKS.md', 'DONE.md', 'OVERVIEW.md', 'TIPS.md', 'README.md', 'config.json']) {
  if (!existsSync(join(ASSETS, '.continue', name))) problems.push(`技能模板缺少 .continue/${name}`);
  if (!installerText.includes(`'${name}'`) && !installerText.includes(`"${name}"`)) {
    problems.push(`scripts/install.mjs 没有拷贝 ${name}`);
  }
}

// ------------------------------------------------------------------ 3. 模板不能被实例污染
/**
 * 挡的是：改框架时很自然会把 `.continue/DONE.md` 直接 `cp` 到 `assets/` 去"同步模板"，
 * 而实例文档里带着本项目的历史（批次号、会话 ID、模块名）。装到别的项目就是凭空继承。
 * 这件事连续做错过两次，靠记性防不住。
 */
const TEMPLATE_DOCS = ['DONE.md', 'OVERVIEW.md', 'TASKS.md', 'TIPS.md', 'README.md'];
const INSTANCE_MARKERS = [
  { re: /\b\d{8}-\d{4}\b/, why: '具体批次号（时间戳形态）' },
  { re: /sample-text|队列机制自检|编号机制重构|文档机制|工具链/, why: '本项目的模块名 / 样本文件' },
];
for (const name of TEMPLATE_DOCS) {
  const text = read(join(ASSETS, '.continue', name));
  if (text === null) continue;
  for (const { re, why } of INSTANCE_MARKERS) {
    const hit = re.exec(text);
    if (hit) {
      problems.push(
        `模板 assets/.continue/${name} 混入了${why}（"${hit[0]}"）——模板必须是空白骨架，` +
          '别把实例文档直接 cp 过去',
      );
      break;
    }
  }
}

/**
 * 第二层：**所有** assets 文件都要干净，不只是上面那 5 份文档。
 *
 * 为什么扩到 `hooks/*.mjs`：`批次 1363`、`tools/diff-ledger.mjs`、另一个项目的示例路径
 * 就是这么活下来的——它们藏在 `lib.mjs` 的注释里，而旧扫描只看 md，于是自检一直输出
 * "模板无实例痕迹"。**检查没覆盖到的地方，说"干净"是没意义的。**
 *
 * 为什么用**显式清单**而不是正则：`批次 \d+`、`\d{8}-\d{4}` 在源码里到处是合法示例
 * （自检夹具、文档样例），正则一定误报；而"某个项目的名字 / 工具链"是有限的几个具体串，
 * 列出来既准确又能一眼看懂它挡的是什么。清单**不许为空**——空了这条检查就退化成空转。
 */
const INSTANCE_TOKENS = [
  '批次 1363',
  'diff-ledger',
  'coverage-report',
  'audit-tasks',
  'minicraft',
  'src/world/chunk.ts',
  'test:chunk',
  // `probe` 是本仓库 e2e 的场景名，模板里出现过一次（"一条先红后绿的用例 / probe 场景"），
  // 装到没有 e2e.mjs 的项目里就是一句无法兑现的证据形式。只收 `probe` 不收 `e2e.mjs`：
  // 后者在模板里是 `node scripts/e2e.mjs` 这类通用示例，收进来会误报。
  'probe',
];
if (INSTANCE_TOKENS.length === 0) {
  problems.push('INSTANCE_TOKENS 是空的——模板污染检查会静默失效（"没有痕迹"和"没查"长得一样）');
}
const ASSET_SCAN_EXT = new Set(['.md', '.mjs', '.json', '.yml']);
function scanAssetDir(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === '.e2e' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      scanAssetDir(full);
      continue;
    }
    if (!ASSET_SCAN_EXT.has(name.slice(name.lastIndexOf('.')))) continue;
    const text = readFileSync(full, 'utf8');
    for (const token of INSTANCE_TOKENS) {
      if (!text.includes(token)) continue;
      problems.push(
        `${relative(REPO_ROOT, full)} 里出现实例痕迹「${token}」——模板必须是空白骨架，` +
          '别把某个项目的名字 / 工具链 / 示例路径带进来',
      );
    }
  }
}
scanAssetDir(ASSETS);

// ------------------------------------------------------------------ 4. 注册命令必须带 --event
/**
 * 挡的是：注册命令退回成 `node .continue/hooks/<脚本>.mjs`（老版本形态）。
 * 这种注册**跑得起来、检查也绿**，只是日志行首只剩钩子名，排查时把"用户说了句话"
 * 当成"停下触发"——错得安静，只能靠这条静态检查提前发现。
 */
const commandForDef = /const commandFor = \(\{ event, script \}\) =>\s*`([^`]*)`/.exec(installerText);
if (!commandForDef) {
  problems.push('scripts/install.mjs 里找不到 commandFor()——注册命令的拼装必须只有这一个入口，check-framework 才能查');
} else if (!commandForDef[1].includes('--event=${event}')) {
  problems.push(`scripts/install.mjs 的 commandFor() 没拼 --event=（当前模板："${commandForDef[1]}"）`);
}
const hooksBlock = /const HOOKS = \[([\s\S]*?)\n\];/.exec(installerText);
if (!hooksBlock) {
  problems.push('scripts/install.mjs 里找不到 HOOKS 登记表');
} else {
  const entries = [...hooksBlock[1].matchAll(/\{\s*event:\s*'([^']+)',\s*script:\s*'([^']+)',\s*timeout:\s*\d+\s*\}/g)];
  if (entries.length === 0) {
    problems.push('HOOKS 登记表解析不出任何条目（格式变了就要同步改这条检查，别让它静默失效）');
  }
  // 每条都由 commandFor() 拼：有别的写法就意味着有命令可能绕过 --event=
  if (!/command:\s*commandFor\(hook\)/.test(installerText)) {
    problems.push('registerHooks() 里的 command 没有用 commandFor(hook) 拼装，可能绕过 --event=');
  }
  const literalCommand = /command:\s*`node \.continue\/hooks\/\$\{script\}/.exec(installerText);
  if (literalCommand) {
    problems.push(`install.mjs 里还有手拼的注册命令（"${literalCommand[0]}…"）——它不带 --event=，改用 commandFor()`);
  }

  /**
   * 三方核对：`HOOKS` ↔ 模板 `hooks/` ↔ 两份机制文档。
   *
   * 挡的是三种"跑得起来、检查也绿"的错：
   *   · 注册了模板里不存在的脚本 → 装出来指向空气；
   *   · 注册了但文档没写 → 用户 / 维护者不知道有这个东西；
   *   · 模板里明明是个事件钩子却没注册 → 它永远不会跑（症状是"机制某一半静默失效"）。
   *
   * 第三种不维护白名单：判据是**代码特征**（读 stdin 的 payload + 用 emit* 回答宿主）。
   * 白名单会随每次加钩子手抄一遍，漏抄的代价正是这条检查要挡的事。
   */
  const templateDocs = [join(ASSETS, '.continue', 'README.md'), join(SKILL_DIR, 'SKILL.md')];
  const registered = new Set();
  for (const [, , script] of entries) {
    registered.add(script);
    if (!existsSync(join(templateHooksDir, script))) {
      problems.push(
        `HOOKS 注册了 ${script}，但模板 assets/.continue/hooks/ 里没有这个文件——装出来会指向不存在的钩子`,
      );
    }
    // 文档里可能只写脚本名不带扩展名（"`auto-commit` 的 300s…"），按 stem 比
    const stem = script.replace(/\.mjs$/, '');
    for (const doc of templateDocs) {
      if (!(read(doc) ?? '').includes(stem)) {
        problems.push(`HOOKS 注册了 ${script}，但 ${relative(REPO_ROOT, doc)} 里没提到——加了钩子没人知道`);
      }
    }
  }
  if (existsSync(templateHooksDir)) {
    for (const name of readdirSync(templateHooksDir)) {
      if (!name.endsWith('.mjs') || registered.has(name)) continue;
      const src = read(join(templateHooksDir, name)) ?? '';
      // 排除**定义** `readPayload` 的 lib.mjs：它当然"用到了"这个名字
      const callsPayload = /readPayload\s*\(/.test(src) && !/export function readPayload/.test(src);
      if (callsPayload && /emitAllow|emitBlock/.test(src)) {
        problems.push(
          `模板 hooks/${name} 看起来是事件钩子（用了 readPayload + emit*），但 install.mjs 的 HOOKS 里没注册——它永远不会跑`,
        );
      }
    }
  }
}

// ------------------------------------------------------------------ 5. Stop 必须带续跑上限
/**
 * 挡的是：以后重构 `registerHooks()` 时把 `loop_limit` 弄丢。
 * 丢了不报错、检查也绿，症状只是"每条用户消息只推进一条任务"（宿主缺省为 1）——
 * 和"AI 不听话"长得一模一样，只能靠这条静态检查提前发现。
 */
if (!/const STOP_LOOP_LIMIT = \d+;/.test(installerText)) {
  problems.push('scripts/install.mjs 里找不到 STOP_LOOP_LIMIT 常量（Stop 的续跑上限，宿主缺省是 1）');
} else if (!/\.loop_limit\s*=\s*STOP_LOOP_LIMIT/.test(installerText)) {
  problems.push('scripts/install.mjs 没有把 STOP_LOOP_LIMIT 写进 Stop group——宿主缺省 1 时队列推不动');
}

// ------------------------------------------------------------------ 6. 模板默认值必须与文档一致
/**
 * 挡的是：同一个"默认值"在模板 `config.json` 和 README 各写一份，改一处忘另一处。
 *
 * 实测踩到过：模板里 `git.push: true`，而 README 写「默认 `false`」、SKILL 写
 * 「默认只提交不推送」。老项目看不出来——`mergeConfig` 只补缺键，已装的项目保留旧值；
 * **只有新装的项目**会被默认要求自动推送。错在最敏感的动作上（推送），而且是静默的。
 *
 * 现行约定：默认 `true`（提交后自动推送），三处（模板 / README / SKILL）必须一致；
 * 已装项目改过值的不受影响，因为安装器只补缺键。
 */
const templateConfigPath = join(ASSETS, '.continue', 'config.json');
let templateConfig = null;
if (!existsSync(templateConfigPath)) {
  problems.push('模板缺少 assets/.continue/config.json');
} else {
  try {
    templateConfig = JSON.parse(readFileSync(templateConfigPath, 'utf8'));
  } catch (err) {
    problems.push(`模板 config.json 不是合法 JSON：${err.message}`);
  }
}
if (templateConfig) {
  const push = templateConfig?.git?.push;
  const templateReadme = read(join(ASSETS, '.continue', 'README.md')) ?? '';
  if (typeof push !== 'boolean') {
    problems.push('模板 config.json 缺 `git.push` 布尔值——README 用它说明"默认是否自动推送"');
  } else {
    const claimed = /`git\.push`[^\n]*?默认\s*`(true|false)`/.exec(templateReadme);
    if (!claimed) {
      problems.push('模板 README 没写清 `git.push` 的默认值（应形如「默认 `false`」），无法核对');
    } else if ((claimed[1] === 'true') !== push) {
      problems.push(
        `模板 config.json 的 git.push=${push}，但 README 写的是「默认 ${claimed[1]}」——` +
          '新装项目会与文档不符（老项目只补缺键，看不出来）',
      );
    }
  }
}

// ------------------------------------------------------------------ 7. 脚本与开关都要在 SKILL.md 里有交代
/**
 * 挡的是两类"加了东西没人知道"：
 *   1. `scripts/` 下新增了脚本，但 SKILL.md 里一个字没提——维护者不知道它是干什么的，
 *      改规则时也没人知道该跑什么验证（`detect-tests.mjs` 就是这么加进来的）；
 *   2. `install.mjs` 认了新命令参数，但文档没写——用户永远发现不了，等于白加。
 *
 * 判据刻意宽松（只查"名字出现在 SKILL.md 里"），因为文档怎么写是人的事；
 * 但**出现**这件事可以机械检查，而漏掉它的代价是"功能存在但没人知道"。
 */
const skillDoc = read(join(SKILL_DIR, 'SKILL.md')) ?? '';
const scriptsDir = join(SKILL_DIR, 'scripts');
if (existsSync(scriptsDir)) {
  for (const name of readdirSync(scriptsDir)) {
    if (!name.endsWith('.mjs')) continue;
    if (!skillDoc.includes(name)) {
      problems.push(`scripts/${name} 在 SKILL.md 里没有任何交代——维护者不知道它做什么、该怎么验`);
    }
  }
}

/**
 * 命令行开关：从 `unknown` 那一行的白名单里取（那是唯一登记处，和 argv 解析挨着）。
 * 取不到就报——说明那行改了形状，这条检查正在静默失效。
 */
const flagList = /const unknown = argv\.filter\(\(a\) => !\[([^\]]*)\]\.includes\(a\)\);/.exec(installerText);
if (!flagList) {
  problems.push('install.mjs 里找不到 argv 白名单那一行，无法核对"开关是否都写进 SKILL.md"');
} else {
  for (const m of flagList[1].matchAll(/'(--[a-z-]+)'/g)) {
    if (!skillDoc.includes(m[1])) {
      problems.push(`install.mjs 支持 ${m[1]}，但 SKILL.md 里没写——用户不知道有这个开关`);
    }
  }
}

// ------------------------------------------------------------------ 8. 文档里的命令必须真能跑
/**
 * 挡的是：文档 / 钩子注入里教人跑一条**不存在**的命令或路径。
 *
 * 实测踩到三回，都是"静态检查全绿、照着做必失败"：
 *   · `npm run continue:worktree` —— 框架从不创建 package.json，非 npm 项目里必失败；
 *   · 仓库里那条 `skill:e2e` 别名 —— 演示项目清理时 package.json 被删，文档没跟着改；
 *   · `.continue/HANDOFF.md` —— 文件已并入 README，引用还挂着（散文路径，本检查管不到）。
 *
 * 前两类在这条检查的覆盖范围内（路径引用那一类在 §7 之外单独靠人，见下面的边界）。
 *
 * 只查**可机械判定**的两种形态，宁可窄也不误报：
 *   A. `node <路径>.mjs`：按 `.continue/` → 模板、`.codebuddy/skills/continue-task/` → 仓库、
 *      其余 → 技能目录的顺序找，**必须有一个真实存在**；
 *   B. `npm run <name>`：只认框架自己的命名空间 `continue:*` / `skill:*`——必须要么由
 *      安装器创建（install.mjs 里出现这个名字），要么仓库根 package.json 里真有这条 script。
 *      用户项目自己的 script（`npm run test:chunk` 这类示例）**不在范围内**，不判。
 *
 * 边界：`node <技能目录>/…` 这类带占位符的写法跳过（`<` `>` 不在路径字符集里，天然不匹配）；
 * 纯散文里的路径（如 `` `.continue/xxx.md` ``）不查——模板里有按需生成的文件（`DONE.archive.md`），
 * 硬查会误报。这条检查管的是"命令"，不是"所有反引号"。
 */
const DOC_SCAN_EXT = new Set(['.md', '.mjs']);
const docSources = [{ label: 'SKILL.md', text: skillDoc }];
function collectDocSources(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // `.e2e/` 是跑出来的现场（gitignore），里面是装好的旧副本，不能参与检查
      if (name === '.e2e' || name === 'node_modules') continue;
      collectDocSources(full);
      continue;
    }
    if (!DOC_SCAN_EXT.has(name.slice(name.lastIndexOf('.')))) continue;
    docSources.push({ label: relative(REPO_ROOT, full), text: readFileSync(full, 'utf8') });
  }
}
collectDocSources(ASSETS);
collectDocSources(scriptsDir);

const repoPkgPath = join(REPO_ROOT, 'package.json');
let repoScripts = {};
if (existsSync(repoPkgPath)) {
  try {
    repoScripts = JSON.parse(readFileSync(repoPkgPath, 'utf8'))?.scripts ?? {};
  } catch {
    repoScripts = {};
  }
}

/** 文档里的 `.mjs` 路径按三个根依次找；都不在就是死链。 */
function resolveDocScript(raw) {
  const p = raw.replace(/^\.\//, '');
  // 裸文件名（`node install.mjs`）：路径取决于 cwd，判不了，放过——写了目录的才判
  if (!p.includes('/')) return true;
  const candidates = [];
  if (p.startsWith('.continue/')) candidates.push(join(ASSETS, p));
  if (p.startsWith('.codebuddy/skills/continue-task/')) candidates.push(join(REPO_ROOT, p));
  candidates.push(join(SKILL_DIR, p));
  return candidates.some((c) => existsSync(c));
}

/**
 * 只查**框架自己的**路径：`.continue/…`（装进项目的）、`.codebuddy/skills/continue-task/…`（技能仓库的）、
 * 以及技能仓库自己的 `scripts/…`（只有 SKILL.md 和 scripts/ 下的源码这么写）。
 * 其它（`scripts/lint.mjs` 这类**用户项目**的示例）一概不判——那是人家仓库里的路径。
 */
function isFrameworkPath(token, label) {
  if (token.startsWith('.continue/') || token.startsWith('.codebuddy/')) return true;
  const frameworkFile = label === 'SKILL.md' || label.startsWith('scripts/') || label.includes('/scripts/');
  return frameworkFile && token.startsWith('scripts/');
}

const deadRefs = new Map();
const deadScripts = new Map();
for (const { label, text } of docSources) {
  for (const m of text.matchAll(/\bnode\s+((?:\.\/)?[A-Za-z0-9_.\-/]+\.mjs)/g)) {
    const token = m[1];
    if (!isFrameworkPath(token, label)) continue;
    if (!resolveDocScript(token)) deadRefs.set(`${label} → ${token}`, true);
  }
  for (const m of text.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
    const name = m[1];
    // 只认**完整**的框架脚本名：`npm run continue:*` 这种通配写法（说明性文字）不算引用，别误报
    if (!/^(continue|skill):[a-z0-9_-]+$/.test(name)) continue;
    const byInstaller = installerText.includes(`'${name}'`) || installerText.includes(`"${name}"`);
    const byRepoPkg = typeof repoScripts[name] === 'string';
    if (!byInstaller && !byRepoPkg) deadScripts.set(`${label} → npm run ${name}`, true);
  }
}
for (const where of deadRefs.keys()) {
  problems.push(`${where}：指向的脚本不存在（照着跑必失败）——改名或删掉这行引用`);
}
for (const where of deadScripts.keys()) {
  problems.push(
    `${where}：这条 npm script 既不由安装器创建、也不在仓库 package.json 里——` +
      '改成 `node .continue/hooks/…` 直跑，或让安装器真的把它写进 package.json',
  );
}

// ------------------------------------------------------------------ 9. 写进文档的数字必须等于实际
/**
 * 挡的是：SKILL.md 里"`test-install.mjs` 共 N 项"这类**手抄的数字**。
 * 实测原文写"共 11 项"，实际已经 19 项——数字只会越漂越远，而读它的人正是**维护者**
 * （他据此判断"回归覆盖面够不够"）。能算出来的就别手抄：这里直接数 `check('…')` 的条数。
 */
const testInstallText = read(join(scriptsDir, 'test-install.mjs')) ?? '';
const caseCount = (testInstallText.match(/^check\('/gm) ?? []).length;
if (caseCount === 0) {
  problems.push('读不到 test-install.mjs 的用例数（`check(\'…\')` 一条都没匹配到）——这条检查正在空转');
} else {
  const claimed = /`scripts\/test-install\.mjs`[^\n]*?共\s*(\d+)\s*项/.exec(skillDoc);
  if (!claimed) {
    problems.push('SKILL.md 没写 test-install 的用例数（应形如「共 N 项」），无法与代码核对');
  } else if (Number(claimed[1]) !== caseCount) {
    problems.push(`SKILL.md 写"共 ${claimed[1]} 项"，实际 ${caseCount} 项——数字要跟着用例走，别手抄`);
  }
}

// ------------------------------------------------------------------ 10. 版本号只有一个来源
/**
 * 挡的是：版本号写两份（`VERSION` 与 `SKILL.md`），改一处忘另一处；以及安装器某次重构后
 * 忘了读它——那时"我装的是哪一版"就永远答不上来（钩子是覆盖安装，git log 里看不出来）。
 *
 * 三条一起查：`VERSION` 存在且是 semver、`SKILL.md` 里写的与它一致、安装器确实读了它。
 */
const versionPath = join(SKILL_DIR, 'VERSION');
const versionText = read(versionPath);
if (versionText === null) {
  problems.push('缺少 VERSION 文件（框架版本号的唯一来源）');
} else {
  const version = versionText.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    problems.push(`VERSION 内容 "${version}" 不是 semver（应形如 1.2.3）`);
  }
  if (!skillDoc.includes(`版本：${version}`)) {
    problems.push(`SKILL.md 里没有「版本：${version}」这一行——两处版本号必须一致（改版本只改 VERSION）`);
  }
  if (!/readFileSync\(join\(HERE, '\.\.', 'VERSION'\)/.test(installerText)) {
    problems.push('install.mjs 没有读 VERSION——安装输出里就看不到装的是哪一版');
  }
}

// ------------------------------------------------------------------ 输出
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`\n技能自查未通过：${problems.length} 个问题。`);
  process.exit(1);
}
console.log(
  '技能自查通过：模板与安装器一致（含默认值 ↔ 文档）、注册命令带 --event=、' +
    '脚本与开关都在 SKILL.md 里有交代、模板无实例痕迹。',
);
