#!/usr/bin/env node
/**
 * 生成六语言 `manifest.webmanifest`（多语言 P5-3）。
 *
 * 为什么要生成而不是手写六份：六个文件里 **只有 `description` 与 `lang` 不同**，
 * 其余（start_url / scope / display / orientation / 图标 / 分类）必须完全一致 ——
 * 手抄六份迟早会有某一份漏改一个字段，而漏改的后果是"某个语言装出来的 App 转不了屏"。
 *
 * 基准文件是 `public/manifest.webmanifest`（中文那份，也是 `index.html` 里默认指向的）：
 * 其它五份从它复制，只替换 `description` 与 `lang`（`lang` 用与 `<html lang>` 同一套值，
 * 带地区的写在 `lang` 里，例如 `pt-BR`）。
 *
 * 用法：
 *   node tools/gen-manifests.mjs          # 重新生成 5 份（中文那份不动）
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
 * 除 `description` / `lang` 之外，其余字段必须与基准逐字相同。
 *
 * 为什么单独列：这几个字段决定"装成 App 之后长什么样"——
 * `display_override` 少了 `fullscreen` 就变成带地址栏，`orientation` 变成 portrait 就转不了屏。
 */
const FROZEN_KEYS = ['name', 'short_name', 'start_url', 'scope', 'display', 'display_override', 'orientation', 'background_color', 'theme_color', 'categories', 'icons'];

const base = JSON.parse(readFileSync(basePath, 'utf8'));
const isCheck = process.argv.includes('--check');
const problems = [];
const written = [];

for (const locale of LOCALES) {
  const manifest = { ...base, description: locale.description, lang: locale.lang };
  // 键顺序与基准一致：把 description / lang 挪回原位，避免 diff 里到处是位移
  const ordered = {};
  for (const key of Object.keys(base)) {
    ordered[key] = key === 'description' ? locale.description : key === 'lang' ? locale.lang : base[key];
  }
  const text = `${JSON.stringify(ordered, null, 2)}\n`;
  const target = join(publicDir, locale.file);

  if (isCheck) {
    let existing = '';
    try {
      existing = readFileSync(target, 'utf8');
    } catch {
      problems.push(`${locale.file} 不存在`);
      continue;
    }
    if (existing !== text) problems.push(`${locale.file} 与基准不一致（重跑 gen-manifests 即可）`);
    const parsed = JSON.parse(existing);
    for (const key of FROZEN_KEYS) {
      if (JSON.stringify(parsed[key]) !== JSON.stringify(base[key])) problems.push(`${locale.file} 的 ${key} 与基准不同`);
    }
    if (parsed.lang !== locale.lang) problems.push(`${locale.file} 的 lang 应为 ${locale.lang}，实际 ${parsed.lang}`);
    if (parsed.description !== locale.description) problems.push(`${locale.file} 的 description 不是该语言的文案`);
    continue;
  }

  writeFileSync(target, text);
  written.push(locale.file);
}

if (isCheck) {
  if (problems.length > 0) {
    console.error(`manifest 校验失败（${problems.length} 项）：`);
    for (const item of problems) console.error(`  · ${item}`);
    process.exit(1);
  }
  console.log(`manifest 校验通过：${LOCALES.length} 份语言文件与基准一致（字段冻结 ${FROZEN_KEYS.length} 个）`);
} else {
  console.log(`已生成 ${written.length} 份：${written.join(', ')}`);
}
