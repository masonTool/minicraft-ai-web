#!/usr/bin/env node
/**
 * 生成六语言 `manifest.webmanifest`（多语言 P5-3）+ 六份**桌面变体**（2026-10-25）。
 *
 * 为什么要生成而不是手写六份：六个文件里 **只有 `description` 与 `lang` 不同**，
 * 其余（start_url / scope / display / orientation / 图标 / 分类）必须完全一致 ——
 * 手抄六份迟早会有某一份漏改一个字段，而漏改的后果是"某个语言装出来的 App 转不了屏"。
 *
 * 基准文件是 `public/manifest.webmanifest`（中文那份，也是 `index.html` 里默认指向的）：
 * 其它五份从它复制，只替换 `description` 与 `lang`（`lang` 用与 `<html lang>` 同一套值，
 * 带地区的写在 `lang` 里，例如 `pt-BR`）。
 *
 * ## 桌面变体（用户要求 2026-10-25："PC 版不需要全屏"）
 *
 * 桌面那一份只改两处：
 *   · `display_override` 只留 `standalone`（去掉 `fullscreen`）——否则在桌面上"安装"
 *     之后 Chrome 会**直接全屏启动**，而那不是 Fullscreen API 的全屏，`exitFullscreen()`
 *     关不掉，游戏里没有任何入口能退出；
 *   · 去掉 `orientation` —— 桌面窗口不该被页面锁方向。
 * 文件名规则：`manifest.webmanifest` → `manifest.desktop.webmanifest`，
 * `manifest.en.webmanifest` → `manifest.en.desktop.webmanifest`（`src/ui/ManifestLink.ts` 按同一规则拼）。
 *
 * 用法：
 *   node tools/gen-manifests.mjs          # 重新生成 5 份语言文件 + 6 份桌面变体
 *   node tools/gen-manifests.mjs --check  # 只校验：不写文件，字段不一致时退出码 1
 *
 * ⚠️ 产物是**仓库里的静态文件**（提交进 git），不参与打包构建；`public/` 会被原样复制进 `dist/`。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(projectRoot, 'public');
const basePath = join(publicDir, 'manifest.webmanifest');

/** 语言码 → manifest 文件名 + 该语言的 `lang` + 描述（与 `docs/store/` 的短描述一致） */
const LOCALES = [
  {
    code: 'en',
    file: 'manifest.en.webmanifest',
    lang: 'en',
    description: 'A blocky sandbox in your browser: infinite terrain, survival and creative.',
  },
  {
    code: 'de',
    file: 'manifest.de.webmanifest',
    lang: 'de',
    description: 'Blockwelt im Browser: unendliches Gelände, Überleben und Kreativ.',
  },
  {
    code: 'ru',
    file: 'manifest.ru.webmanifest',
    lang: 'ru',
    description: 'Блочная песочница в браузере: бесконечный мир, выживание и творчество.',
  },
  {
    code: 'fr',
    file: 'manifest.fr.webmanifest',
    lang: 'fr',
    description: 'Bac à sable de blocs dans le navigateur : terrain infini, survie et créatif.',
  },
  {
    code: 'pt',
    file: 'manifest.pt.webmanifest',
    lang: 'pt-BR',
    description: 'Sandbox de blocos no navegador: terreno infinito, sobrevivência e criativo.',
  },
];

/**
 * 除 `description` / `lang` 之外，其余字段必须与**各自那一份基准**逐字相同
 * （手机比手机基准、桌面比桌面基准）。
 *
 * 为什么单独列：这几个字段决定"装成 App 之后长什么样"——
 * 手机那份 `display_override` 少了 `fullscreen` 就变成带地址栏，`orientation` 变成 portrait 就转不了屏；
 * 桌面那份反过来，多出 `fullscreen` 就会全屏启动且退不出来（见文件头）。
 */
const FROZEN_KEYS = ['name', 'short_name', 'start_url', 'scope', 'display', 'display_override', 'orientation', 'background_color', 'theme_color', 'categories', 'icons'];

const base = JSON.parse(readFileSync(basePath, 'utf8'));
const isCheck = process.argv.includes('--check');
const problems = [];
const written = [];

/** 桌面变体：手机那份的副本，只去 `fullscreen` 与 `orientation`（理由见文件头） */
function desktopVariantOf(source) {
  const desktop = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'orientation') continue;
    desktop[key] = key === 'display_override' ? ['standalone'] : value;
  }
  // 基准以后若删掉 display_override，桌面这份也得显式写：缺省会继承 display，
  // 而 display 一旦改成 fullscreen 就又回到"桌面全屏"那条路上
  if (!('display_override' in desktop)) desktop.display_override = ['standalone'];
  return desktop;
}

/** `manifest.en.webmanifest` → `manifest.en.desktop.webmanifest`；`manifest.webmanifest` → `manifest.desktop.webmanifest` */
const desktopFileName = (file) => file.replace(/\.webmanifest$/, '.desktop.webmanifest');

const desktopBase = desktopVariantOf(base);

/**
 * 中文那份**不重写**（它就是基准本身，也是已装好的 PWA 正在用的地址），
 * 但它的桌面变体照样要生成——`index.html` 默认指向的就是中文。
 */
const BASE_FILE = 'manifest.webmanifest';
const localeList = [...LOCALES, { code: 'zh', file: BASE_FILE, lang: base.lang, description: base.description }];

for (const locale of localeList) {
  const manifest = { ...base, description: locale.description, lang: locale.lang };
  // 键顺序与基准一致：把 description / lang 挪回原位，避免 diff 里到处是位移
  const ordered = {};
  for (const key of Object.keys(base)) {
    ordered[key] = key === 'description' ? locale.description : key === 'lang' ? locale.lang : base[key];
  }
  const desktop = desktopVariantOf(ordered);
  const variants = [
    { file: desktopFileName(locale.file), expected: desktop, frozenAgainst: desktopBase },
  ];
  // 基准文件本身不重写（`index.html` 一加载就指向它，历史安装也还挂在上面）
  if (locale.file !== BASE_FILE) variants.unshift({ file: locale.file, expected: ordered, frozenAgainst: base });

  for (const variant of variants) {
    const text = `${JSON.stringify(variant.expected, null, 2)}\n`;
    const target = join(publicDir, variant.file);

    if (isCheck) {
      let existing = '';
      try {
        existing = readFileSync(target, 'utf8');
      } catch {
        problems.push(`${variant.file} 不存在`);
        continue;
      }
      if (existing !== text) problems.push(`${variant.file} 与基准不一致（重跑 gen-manifests 即可）`);
      const parsed = JSON.parse(existing);
      for (const key of FROZEN_KEYS) {
        if (!(key in variant.frozenAgainst)) {
          // 桌面变体刻意不带 `orientation`（桌面窗口不锁方向）
          if (key in parsed) problems.push(`${variant.file} 不该有 ${key}`);
          continue;
        }
        if (JSON.stringify(parsed[key]) !== JSON.stringify(variant.frozenAgainst[key])) {
          problems.push(`${variant.file} 的 ${key} 与基准不同`);
        }
      }
      if (parsed.lang !== locale.lang) problems.push(`${variant.file} 的 lang 应为 ${locale.lang}，实际 ${parsed.lang}`);
      if (parsed.description !== locale.description) problems.push(`${variant.file} 的 description 不是该语言的文案`);
      continue;
    }

    writeFileSync(target, text);
    written.push(variant.file);
  }
}

if (isCheck) {
  if (problems.length > 0) {
    console.error(`manifest 校验失败（${problems.length} 项）：`);
    for (const item of problems) console.error(`  · ${item}`);
    process.exit(1);
  }
  console.log(
    `manifest 校验通过：${localeList.length} 种语言 ×（手机 + 桌面）与基准一致（字段冻结 ${FROZEN_KEYS.length} 个）`,
  );
} else {
  console.log(`已生成 ${written.length} 份：${written.join(', ')}`);
}
