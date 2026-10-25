/**
 * 生产构建用的**空**方块表（批次 20261025-1032 · 宿主9）
 *
 * 线上产物里**不能有**那 2191 行数据：它既是复制者最想拿的东西，也是主包里最肥的一块。
 * 所以生产构建时 `vite.config.ts` 的 `hostSpecsStub` 插件会把所有 `./blockSpecs.ts`
 * 的引用改指向本文件——于是 `BLOCKS` 初始为空，真正的表由 `core/hostCore.ts` 从
 * `core.bin` 装进来（那个文件在小游戏里由安卓宿主注入，浏览器拿不到）。
 *
 * ⚠️ 本文件必须与 `blockSpecs.ts` 导出**同名同类型**的 `SPECS`，否则 `blocks.ts` 编译不过。
 */

import type { BlockSpec } from './blockIds.ts';

export const SPECS: readonly BlockSpec[] = [];
