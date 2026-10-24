#!/usr/bin/env node
/**
 * 配置一致性审计：**开关表 ↔ 代码**、**config.json 的键 ↔ 文档**。
 *
 * 为什么存在（挡的是哪次事故）：README 的「可调开关」表是手写的，而真正生效的是
 * 钩子里的 `process.env.X`。两处一旦不同步，症状是"照文档设了变量，一点效果都没有"，
 * 或者"代码里有个开关，文档根本没提"——两种都不会报错，只能靠人记得去看代码。
 * 这就是"派生数字不手写"那条原理在配置上的翻版（README §0 原理 2）。
 *
 * 查两个方向：
 *   1. 文档写了、代码没读 → 用户设了没用；
 *   2. 代码读了、文档没写 → 没人知道有这个东西。
 *
 * 退出码：0 通过 / 1 有问题。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTINUE_DIR, README_FILE } from './lib.mjs';

const problems = [];
const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

// ------------------------------------------------------------------ 1. README 的开关表
/**
 * 只在「可调开关」那一节里取，取到下一个标题为止——README 里还有别的表格
 * （检查清单等），第一列也是反引号包着的名字，不加范围就会把 `ids` 当成环境变量。
 */
function documentedEnvVars(text) {
  const lines = text.split(/\r?\n/);
  const names = new Set();
  let inSection = false;
  for (const line of lines) {
    // 开关表挂在加粗小标题下（不是 markdown 标题），两种都要认
    if (/^#{2,4}\s/.test(line) || /^\*\*[^*]+\*\*/.test(line)) {
      inSection = /可调开关|环境变量/.test(line);
      continue;
    }
    if (!inSection || !line.trim().startsWith('|')) continue;
    const first = line.trim().slice(1).split('|')[0].trim();
    const m = /^`([A-Z][A-Z0-9_]{2,})`$/.exec(first);
    if (m) names.add(m[1]);
  }
  return names;
}

const readme = read(README_FILE);
if (readme === null) {
  console.error('  ✗ 没有 .continue/README.md，无法核对开关表');
  process.exit(1);
}
const documented = documentedEnvVars(readme);

// ------------------------------------------------------------------ 2. 代码里真正读的开关
const hooksDir = join(CONTINUE_DIR, 'hooks');
const used = new Map(); // 变量名 → 第一次出现的文件
if (existsSync(hooksDir)) {
  for (const name of readdirSync(hooksDir)) {
    if (!name.endsWith('.mjs')) continue;
    const text = readFileSync(join(hooksDir, name), 'utf8');
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) {
      if (!used.has(m[1])) used.set(m[1], name);
    }
  }
}

for (const name of documented) {
  if (!used.has(name)) {
    problems.push(
      `README 的开关表列了 \`${name}\`，但 .continue/hooks/ 里没有任何代码读它——照文档设置不会有任何效果`,
    );
  }
}
for (const [name, file] of used) {
  if (!documented.has(name)) {
    problems.push(
      `代码里读 \`${name}\`（${file}），但 README 的「可调开关」表里没写——没人知道有这个开关`,
    );
  }
}

// ------------------------------------------------------------------ 3. config.json 的键都有文档
const CONFIG_KEYS = {
  fast: '每次提交前跑的聚合命令',
  full: '完整体检命令（钩子不读，给人 / CI 留位置）',
  timeoutSec: '单条检查命令的超时秒数',
  project: '项目自己的快检查命令（字符串或数组），由 check.mjs 依次执行',
  projectSlow: '项目自己的慢检查命令：只在全档跑，--fast（pre-commit / Stop 守卫）跳过',
};
const configFile = join(CONTINUE_DIR, 'config.json');
if (existsSync(configFile)) {
  let config = {};
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch (err) {
    problems.push(`.continue/config.json 不是合法 JSON（${err.message}）`);
  }
  const keys = Object.keys(config?.checks ?? {});
  for (const key of keys) {
    if (!(key in CONFIG_KEYS)) {
      problems.push(`config.json 的 checks.${key} 没有文档（README 里没说明它是干什么的）`);
    } else if (!readme.includes(key)) {
      problems.push(`config.json 用了 checks.${key}，但 README 里没有提到它`);
    }
  }

  /**
   * 已知的慢检查**不许**待在 `checks.project`（快档）。
   *
   * 挡的是本仓库自己踩的坑（T44）：三份文档都写着"project 必须秒级"，还是把 13 秒的
   * 安装器回归放回了快档——每次 `git commit` 多等 13 秒，而**没有任何东西会红**。
   * 只认本技能自带的两个慢脚本：它们不是"项目测试"，出现在快档里一定是配置错了；
   * 别的命令快不快，框架没法猜，也不该猜。
   */
  const SLOW_SCRIPTS = ['scripts/test-install.mjs', 'scripts/e2e.mjs'];
  for (const cmd of [].concat(config?.checks?.project ?? [])) {
    const hit = SLOW_SCRIPTS.find((name) => String(cmd).includes(name));
    if (hit) {
      problems.push(
        `checks.project（快档）里有慢检查 \`${hit}\`：它该放进 checks.projectSlow，` +
          '否则每次 git commit（pre-commit）都要等它跑完',
      );
    }
  }
}

// ------------------------------------------------------------------ 输出
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`\n配置一致性未通过：${problems.length} 个问题。`);
  process.exit(1);
}
console.log(`配置一致性通过：${documented.size} 个开关、代码与文档一致。`);
