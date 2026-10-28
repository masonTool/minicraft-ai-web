#!/usr/bin/env node
/**
 * iOS 侧 Swift 源码的**语法门禁**（`npm run check:swift`）。
 *
 * 为什么单独一条：`server/ios/check.sh` 要先用 cargo 编出 xcframework，而本机常常没有 cargo
 * （`cargo: command not found`），于是 Swift 那半边**从来没被任何门禁检查过** —— 改错一个括号
 * 也要等到上机才发现。`swiftc -parse` 不需要 SDK、不需要链接，几百毫秒就能把语法错误挡在提交前。
 *
 * 它挡不住什么：类型错误、缺失的 ObjC 声明、平台 API 用法 —— 那些要 `check.sh`（真机 SDK
 * `-typecheck`）或真机。
 *
 * 没装 Xcode（没有 `swiftc`）时跳过并 exit 0，与截图/浏览器类门禁同一契约。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'server/ios/Sources';

function hasSwiftc() {
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(DIR)) {
  console.log(`  · 跳过：没有 ${DIR}`);
  process.exit(0);
}
if (!hasSwiftc()) {
  console.log('  · 跳过：没有 swiftc（装 Xcode 命令行工具后自动生效）');
  process.exit(0);
}

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.swift'))
  .map((name) => join(DIR, name));

if (files.length === 0) {
  console.log(`  · 跳过：${DIR} 里没有 .swift`);
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync('swiftc', ['-parse', file], { stdio: 'pipe' });
    console.log(`  ✓ ${file}`);
  } catch (error) {
    failed += 1;
    const detail = String(error.stderr ?? error.message).split('\n').slice(0, 6).join('\n');
    console.error(`  ✗ ${file}\n${detail}`);
  }
}

if (failed > 0) {
  console.error(`\nSwift 语法检查失败：${failed} / ${files.length} 个文件`);
  process.exit(1);
}
console.log(`\nSwift 语法检查通过：${files.length} 个文件`);
