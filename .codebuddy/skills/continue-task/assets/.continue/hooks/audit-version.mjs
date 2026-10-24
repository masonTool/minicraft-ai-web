#!/usr/bin/env node
/**
 * 版本检查：实例装的版本 vs 技能目录的 `VERSION`，**并且**逐文件比哈希。
 *
 * 为什么要有这一项：技能目录被新版本整个覆盖之后，**钩子还是旧的**——覆盖文件不等于生效，
 * 要重跑安装器才会把 `.continue/hooks/*` 刷成新版。这件事没有任何报错：
 * AI 会以为新规则已经在跑，实际执行的是旧逻辑，症状是"新功能明明装了却没生效"。
 *
 * 为什么**不能只比版本号**（T25，挡的是本仓库自己踩的坑）：
 *   开发期大量批次落地时版本号常常不动，于是"实例 v1.0.0 = 技能 v1.0.0"永远成立——
 *   这一项就成了摆设，恰好漏掉它唯一要抓的场景。真正的判据是**文件内容**：
 *   `.installed.json` 记着安装那一刻每个托管文件的哈希，技能模板就在 `assets/` 下面，两边一比就知道。
 *
 * 三类差异，只有第一类算"落后"：
 *   · 实例当前 == 记录哈希，但 != 模板哈希 → **没人动过，只是模板变了 = 落后**（要重跑安装器）；
 *   · 实例当前 != 记录哈希 → 有人改过（或文档被填充），**不是落后**，不判红、也不催；
 *   · 文档类（TASKS / DONE / OVERVIEW / TIPS / README / AGENTS）与 `config.json` 天生会被填改，
 *     它们的差异**不报**——报出来只是噪音，噪音会让真落后被忽略。
 *
 * 为什么只提示不判红：
 *   · 技能目录常常不在版本库里（用户把它当本地工具），CI 上根本没有它——
 *     把"没有技能目录"判成失败只会让所有 CI 红掉；
 *   · "落后"不是错误状态，是"还没重跑安装器"，它该被看见，但不该拦住提交。
 *
 * 退出码：**永远 0**（这一项不是门禁）。真正要拦的事由别项负责。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTINUE_DIR, PROJECT_ROOT } from './lib.mjs';

/** 技能目录的可能位置：项目内标准位置优先（安装器就是从这里拷的）。 */
const SKILL_DIRS = [join(PROJECT_ROOT, '.codebuddy', 'skills', 'continue-task')];

const readText = (file) => {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
};

/** 文件哈希；读不到返回 null（文件被删了不算"落后"，那是另一类问题，由安装器自检管）。 */
const sha256 = (file) => {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

const state = (() => {
  try {
    return JSON.parse(readText(join(CONTINUE_DIR, '.installed.json')) ?? '');
  } catch {
    return null;
  }
})();
const installed = state?.version ?? null;

const skillDir = SKILL_DIRS.find((dir) => existsSync(join(dir, 'VERSION'))) ?? null;
const skill = skillDir ? readText(join(skillDir, 'VERSION')) : null;

/**
 * `installed.json` 里的相对路径 → 技能模板路径。
 * `AGENTS.md` 在 `assets/` 根下，其余（`.continue/...`）在 `assets/.continue/...`。
 */
const templatePath = (rel) =>
  rel === 'AGENTS.md' ? join(skillDir, 'assets', 'AGENTS.md') : join(skillDir, 'assets', rel);

/**
 * 天生会被填充/手改的文件：它们的差异是**预期内**的，报出来只会盖住真落后。
 * `config.json` 只补缺失键（`checks.project` 必然与模板不同），数据文档（TASKS / DONE /
 * OVERVIEW / TIPS）里是项目自己的进度，`AGENTS.md` 常被项目改写——它们的实例内容
 * **本来就该与模板不同**，判"落后"只会永远报红，一律跳过。
 *
 * **不在**这里的是"安装器总是覆盖"的那些：`hooks/*.mjs`、`.continue/.gitignore` 与
 * `.continue/README.md`（机制文档，T43 起）。它们与模板不同 = 真的没跟上，正是这一项要报的。
 * 把 README 放进跳过名单的代价实测过一次：模板改了三处、实例没跟，而三处检查全绿。
 */
const FILLED_REL = new Set([
  '.continue/config.json',
  '.continue/TASKS.md',
  '.continue/DONE.md',
  '.continue/OVERVIEW.md',
  '.continue/TIPS.md',
  'AGENTS.md',
]);

const brief = (list, n = 3) =>
  `${list
    .slice(0, n)
    .map((rel) => rel.replace('.continue/', ''))
    .join('、')}${list.length > n ? ` 等 ${list.length} 个` : ''}`;

if (!installed) {
  console.log('没有 .continue/.installed.json（跑一次安装器就会写）');
} else if (!skill) {
  console.log(`实例 v${installed}；技能目录不在，跳过比对`);
} else {
  const files = state.files ?? {};
  const stale = []; // 没人动过，但模板变了 → 落后
  const changed = []; // 框架代码被本地改过 → 只告知，不催
  let compared = 0; // 真的比过的文件数（模板缺失的文件不算"一致"）
  for (const [rel, recorded] of Object.entries(files)) {
    if (FILLED_REL.has(rel)) continue; // 天生会被填改，差异是预期内的
    const current = sha256(join(PROJECT_ROOT, rel));
    const template = sha256(templatePath(rel));
    if (!current || !template) continue;
    compared += 1;
    if (current === template) continue;
    // 与记录相同 = 装完之后没人碰过，是模板变了（落后）；否则是本地改过（只告知）
    if (current === recorded) stale.push(rel);
    else changed.push(rel);
  }

  // 结论里必须带**可照抄的命令**：只说"重跑安装器"，人还得回来翻文档找路径（selftest 钉着这条）
  const INSTALL_CMD = 'node .codebuddy/skills/continue-task/scripts/install.mjs';
  if (stale.length > 0) {
    console.log(`实例 v${installed}：${stale.length} 个框架文件落后于技能模板（${brief(stale)}）→ 重跑 ${INSTALL_CMD} 才会生效`);
  } else if (skill !== installed) {
    console.log(`实例 v${installed} ≠ 技能 v${skill} → 重跑 ${INSTALL_CMD}（文件可能已一致，版本号仍要刷新）`);
  } else if (changed.length > 0) {
    console.log(`实例 v${installed} = 技能 v${skill} · ${changed.length} 个框架文件被本地改过（${brief(changed)}，重跑安装器会覆盖成模板版）`);
  } else if (compared > 0) {
    console.log(`实例 v${installed} = 技能 v${skill} · ${compared} 个框架文件与模板一致`);
  } else {
    console.log(`实例 v${installed} = 技能 v${skill} · 技能模板里没有可比的文件，未判落后`);
  }
}

process.exit(0);
