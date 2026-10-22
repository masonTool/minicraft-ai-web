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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS = join(SKILL_DIR, 'assets');
const INSTALLER = join(SKILL_DIR, 'scripts', 'install.mjs');

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

// ------------------------------------------------------------------ 4. 注册命令必须带 --event
/**
 * 挡的是：注册命令退回成 `node .continue/hooks/xxx.mjs`（老版本形态）。
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
