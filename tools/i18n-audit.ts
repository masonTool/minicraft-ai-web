/**
 * 文案表审计（多语言 P0-8）
 *
 * 运行：`npm run audit:i18n`（已接进 `check:fast` 与 `check`）
 *
 * 它回答三个问题，都是**跑测试不容易发现**的那类：
 *  1. **用了但表里没有**：源码里 `t('x.y')` 的键在中文表里查不到 —— 界面上会原样
 *     显示 `x.y`。这类是硬错误，`exit 1`。
 *  2. **表里有但没人引用**：多半是死文案，也可能是"数据驱动取键"（`t(entry.titleKey)`）。
 *     所以只报告、不失败——判死是人的事，脚本只负责把账翻出来。
 *  3. **各语言覆盖率**：哪种语言还没表、哪种语言缺多少条。
 *
 * 三条刻意的做法：
 *   · **先剥注释再扫**：这个仓库的注释里大量出现键名（`见 station.startMaking`），
 *     不剥的话"没人用"会被注释算成"有人用"。
 *   · **"引用"用宽判据**（源码里出现过这个字符串字面量就算），"缺失"用窄判据
 *     （只有 `t()` / `tp()` / `tn()` / `msg()` 的直接参数才算）。窄判据才不会漏报真错误，
 *     宽判据才不会把 `titleKey: 'minigame.jump.title'` 这种数据驱动误报成死文案。
 *   · **不自动删键**：删文案是不可逆的，且 P1/P2 会重构键空间，现在删等于白删。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { allKeys, availableLanguages, loadLocale, tableOf } from '../src/core/i18n/I18n.ts';
import { LOCALES } from '../src/core/i18n/locale.ts';

const ROOT = 'src';
/** 文案表自己的目录：里面的字符串**就是**文案，不能算"引用" */
const LOCALE_DIR = join('src', 'core', 'i18n', 'locales');

interface Hit {
  readonly key: string;
  readonly file: string;
  readonly line: number;
}

/**
 * 逐行剥注释。
 *
 * ⚠️ **保留行号**：注释行换成空行而不是删掉——否则报出来的 `file:line` 是剥完之后的
 * 行号，指到别的地方去（第一版就这样把 `Commands.ts:572` 报成了 `:406`）。
 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const t = line.trim();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : line;
    })
    .join('\n');
}

/**
 * 把源码里的字面量还原成**运行时的字符串**。
 *
 * 必须做：`msg('当前游戏规则：\n{rules}')` 扫出来是反斜杠 + n 两个字符，
 * 而表里的键是**真正的换行**，不还原就会把已存在的键误报成缺失。
 */
function decodeLiteral(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_whole, escape: string) => {
    if (escape.length > 1) return String.fromCharCode(parseInt(escape.slice(1), 16));
    switch (escape) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '0':
        return '\0';
      default:
        return escape;
    }
  });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === LOCALE_DIR) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** `t('x')` / `tp('x', …)` / `tn('x', …)` / `msg('x')` 的第一参数（**整串写死**的那些） */
const CALL_RE = /\b(?:t|tp|tn|msg)\(\s*'((?:[^'\\]|\\.)+)'/g;
/** 模板拼键：`t(`settings.opt.fps${n}`)` → 前缀 `settings.opt.fps` */
const DYNAMIC_RE = /\b(?:t|tp|tn)\(\s*`([^`]*?)\$\{/g;

const keys = new Set(allKeys());
const files = walk(ROOT);

const calls: Hit[] = [];
/** 每个文件剥完注释的源码：引用判据要拿它做子串查找 */
const sourceByFile = new Map<string, string>();
const dynamicPrefixes = new Set<string>();

for (const file of files) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const rel = relative('.', file);
  sourceByFile.set(rel, code);
  const lineOf = (index: number): number => code.slice(0, index).split('\n').length;

  for (const match of code.matchAll(CALL_RE)) {
    calls.push({ key: decodeLiteral(match[1]!), file: rel, line: lineOf(match.index ?? 0) });
  }
  for (const match of code.matchAll(DYNAMIC_RE)) {
    const prefix = match[1]!;
    // 太短的前缀等于"整片放行"（`settings.` 会把 settings.* 全洗白），宁可漏报也不这么干
    if (prefix.length >= 4) dynamicPrefixes.add(prefix);
  }
}

const missing = calls.filter((call) => !keys.has(call.key));
const usedKeys = new Set(calls.map((call) => call.key));

/**
 * "这个键被引用过吗"——三条判据（多语言 P0-8 修订）：
 *  ① 直接调用过（`usedKeys`）；
 *  ② **源码里出现过这个字符串**（子串查找，不解析引号配对）；
 *  ③ 命中某个模板前缀（`settings.opt.fps` → `settings.opt.fps30`）。
 *
 * 为什么不再用"成对单引号"切字面量：一行里反引号模板与单引号混排时配对会错位，
 * 后面整段都被切乱。实测 `inventory.recipeBook` 明明写在 `InventoryScreen.ts:1038`，
 * 却被报成孤儿。子串判据不会错位；代价是"注释里提到也算引用"，而这一栏本来就只报警告。
 */
function isReferenced(key: string): boolean {
  if (usedKeys.has(key)) return true;
  for (const code of sourceByFile.values()) if (code.includes(key)) return true;
  for (const prefix of dynamicPrefixes) if (key.startsWith(prefix)) return true;
  return false;
}

const unused = [...keys].filter((key) => !isReferenced(key));

// ---------------------------------------------------------------- 报告

console.log('[i18n 审计]');
console.log(`  扫描 ${files.length} 个文件 · ${calls.length} 处直接调用 · 表里 ${keys.size} 条键`);
if (dynamicPrefixes.size > 0) {
  // 把前缀打出来：哪天出现 `settings.` 这种过宽前缀，一眼就能看见（它等于把整片键放行）
  console.log(`  模板拼键前缀 ${dynamicPrefixes.size} 个：${[...dynamicPrefixes].map((p) => `${p}…`).join(' · ')}`);
}

if (missing.length > 0) {
  console.log(`\n  ✗ 用了但表里没有（${missing.length}）——这些会在界面上原样显示键名：`);
  for (const hit of missing) console.log(`    · ${hit.key}   ← ${hit.file}:${hit.line}`);
} else {
  console.log('\n  ✓ 源码里所有 t() / tp() / tn() / msg() 的键都在表里');
}

if (unused.length > 0) {
  // 只报告，不失败：`t(entry.titleKey)`、`bindLabel(el, \`settings.group.${g}\`)` 这类
  // 取键是数据驱动的，脚本判不出来；判死是人的事。
  const shown = unused.slice(0, 25);
  console.log(`\n  ⚠ 表里有但没被直接引用（${unused.length} 条，仅供参考——数据驱动取键也算"没引用"）`);
  for (const key of shown) console.log(`    · ${key}`);
  if (unused.length > shown.length) console.log(`    … 还有 ${unused.length - shown.length} 条`);
} else {
  console.log('\n  ✓ 没有孤儿键');
}

// 按需加载的语言先就位：否则覆盖率会把"表还没加载"报成"没有表"（很误导）
for (const locale of LOCALES) await loadLocale(locale.code);

console.log('\n[覆盖率]');
for (const locale of LOCALES) {
  const table = tableOf(locale.code);
  const have = Object.keys(table).length;
  if (have === 0) {
    console.log(`  ${locale.code.padEnd(3)} —（还没有表${availableLanguages().includes(locale.code) ? '' : '，也不可选'}）`);
    continue;
  }
  const pct = ((have / keys.size) * 100).toFixed(1);
  const lack = keys.size - have;
  // 多语言 P4-1：**"键齐"不等于"翻完"** —— 占位值逐字等于英文的那些单独报出来，
  // 免得看 100% 以为已经译好（德语第一批就是这样：表齐了，但 7 个分组还是英文）
  let untranslated = 0;
  if (locale.code !== 'zh' && locale.code !== 'en') {
    const enTable = tableOf('en');
    const zhTable = tableOf('zh');
    untranslated = Object.keys(table).filter(
      (key) => table[key] === enTable[key] && zhTable[key] !== enTable[key],
    ).length;
  }
  // 名字改准一点：这部分是"与英文写了同一种东西"（`Sand` / `Steak` / `OK` / `30 fps` / `{label} ({value})`），
  // 不一定是没翻。早期叫"疑似未翻"，德语收口时发现 64 条全是专名、单位与纯符号。
  const extra = untranslated > 0 ? `  已翻 ${have - untranslated} · 与英文写法相同 ${untranslated}` : '';
  console.log(`  ${locale.code.padEnd(3)} ${have}/${keys.size}  ${pct}%${lack > 0 ? `  缺 ${lack}` : ''}${extra}`);
}

if (missing.length > 0) {
  console.log(`\n✗ 审计失败：${missing.length} 个键用了但表里没有。`);
  process.exit(1);
}
console.log('\n✓ 审计通过');
