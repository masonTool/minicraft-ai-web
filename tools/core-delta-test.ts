/**
 * 方块表增量（批次 20261025-1032）
 *
 * 这份测试守的是"**增量套错基线**"这一类灾难：套错了不是报错，而是整张表错位——
 * 存档里存的是数字 id，错一位玩家世界里所有方块都变成别的东西。
 * 所以重点不是"能不能加方块"，而是"对不上时会不会**坚决拒绝**"。
 *
 * 运行：npm run test:coredelta
 */

import { BLOCKS, buildBlockTable, installBlockTable } from '../src/core/registry/blocks.ts';
import {
  CORE_DELTA_VERSION,
  applyCoreDelta,
  buildDelta,
  fingerprint,
  isEmptyDelta,
  parseCoreDelta,
  type CoreDelta,
} from '../src/core/registry/coreDelta.ts';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? `  →  ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

function throws(label: string, run: () => unknown): void {
  let ok = false;
  let message = '';
  try {
    run();
  } catch (error) {
    ok = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check(label, ok, ok ? '' : '没有抛异常');
  if (ok) console.log(`      （拒绝理由：${message.slice(0, 60)}）`);
}

const base = buildBlockTable();

console.log('\n[一、差分的三种情况]');
{
  const same = buildDelta(base, base);
  check('没变化 → 空增量', isEmptyDelta(same), JSON.stringify(same).slice(0, 80));
  equal('空增量的 baseCount 等于基线条数', same.baseCount, base.length);

  // 改一条属性
  const patched = base.map((b) => (b.name === 'minicraft:stone' ? { ...b, light: 3 } : b));
  const d1 = buildDelta(base, patched);
  equal('改一条属性 → 1 条 patch', d1.patches.length, 1);
  equal('patch 指向被改的方块', d1.patches[0]!.name, 'minicraft:stone');
  equal('patch 只带改动的字段', Object.keys(d1.patches[0]!.set).join(','), 'light');

  // 追加两个方块（顺序即 id）
  const extra = [
    ...base,
    { ...base[1]!, id: base.length, name: 'minicraft:test_a', tiles: ['a', 'a', 'a'] as const },
    { ...base[1]!, id: base.length + 1, name: 'minicraft:test_b', tiles: ['b', 'b', 'b'] as const },
  ];
  const d2 = buildDelta(base, extra);
  equal('追加两个 → 2 条 append', d2.appends.length, 2);
  equal('append 顺序保持', d2.appends.map((a) => a.name).join(','), 'minicraft:test_a,minicraft:test_b');
}

console.log('\n[二、应用增量]');
{
  const next = [
    ...base.map((b) => (b.name === 'minicraft:stone' ? { ...b, light: 3 } : b)),
    { ...base[1]!, id: base.length, name: 'minicraft:test_a', tiles: ['a', 'a', 'a'] as const },
  ];
  // 走一遍"真实路径"：算差分 → 存成 JSON → 读回来 → 应用
  const json = JSON.stringify(buildDelta(base, next));
  const delta = parseCoreDelta(JSON.parse(json));
  const applied = applyCoreDelta(base, delta);

  equal('应用后方块数正确', applied.length, next.length);
  equal('patch 生效（stone 的 light）', applied[1]!.light, 3);
  equal('patch 没动的字段保持原值（stone 的 lightOpacity）', applied[1]!.lightOpacity, base[1]!.lightOpacity);
  equal('append 的 id 接在末尾', applied[applied.length - 1]!.id, base.length);
  equal('append 的名字正确', applied[applied.length - 1]!.name, 'minicraft:test_a');
  equal('append 的贴图正确', applied[applied.length - 1]!.tiles[0], 'a');
  check(
    '应用后的表能被 installBlockTable 接受（id 连续）',
    (() => {
      const snapshot = BLOCKS;
      try {
        installBlockTable(applied);
        return BLOCKS.length === applied.length;
      } finally {
        installBlockTable(snapshot);
      }
    })(),
  );
}

console.log('\n[三、对不上基线必须拒绝]');
{
  const delta = buildDelta(base, base);
  throws('数量不符 → 抛', () => applyCoreDelta(base.slice(0, 10), delta));

  const forged: CoreDelta = { ...delta, baseFingerprint: 'deadbeef' };
  throws('指纹不符 → 抛（数量相同但内容漂了）', () => applyCoreDelta(base, forged));

  const missing: CoreDelta = {
    ...delta,
    patches: [{ name: 'minicraft:not_a_block', set: { light: 1 } }],
  };
  throws('patch 目标不存在 → 抛', () => applyCoreDelta(base, missing));

  const dup: CoreDelta = {
    ...delta,
    appends: [{ name: 'minicraft:stone', tiles: ['x', 'x', 'x'] }],
  };
  throws('append 与已有方块重名 → 抛', () => applyCoreDelta(base, dup));
}

console.log('\n[四、删除方块必须靠发版，不能走增量]');
{
  const removed = base.filter((b) => b.name !== 'minicraft:stone');
  throws('buildDelta 遇到删除 → 抛（会让存档 id 全错位）', () => buildDelta(base, removed));
}

console.log('\n[五、解析层要严格]');
{
  const ok = buildDelta(base, base);
  throws('版本号不对 → 抛', () => parseCoreDelta({ ...ok, version: CORE_DELTA_VERSION + 1 }));
  throws('缺 baseFingerprint → 抛', () => parseCoreDelta({ ...ok, baseFingerprint: undefined }));
  throws('patches 不是数组 → 抛', () => parseCoreDelta({ ...ok, patches: {} }));
  throws(
    'light 越界 → 抛',
    () => parseCoreDelta({ ...ok, patches: [{ name: 'minicraft:stone', set: { light: 99 } }] }),
  );
  throws(
    'tiles 不是三段 → 抛',
    () => parseCoreDelta({ ...ok, appends: [{ name: 'minicraft:x', tiles: ['a', 'b'] }] }),
  );
  throws(
    '不认识的字段 → 抛（跨版本时宁可整体忽略）',
    () => parseCoreDelta({ ...ok, patches: [{ name: 'minicraft:stone', set: { hardness: 3 } }] }),
  );
  throws(
    'set 为空 → 抛',
    () => parseCoreDelta({ ...ok, patches: [{ name: 'minicraft:stone', set: {} }] }),
  );
}

console.log('\n[六、指纹本身]');
{
  equal('同一张表指纹稳定', fingerprint(base), fingerprint(base));
  const tweaked = base.map((b, i) => (i === 0 ? { ...b, name: 'minicraft:not_air' } : b));
  check('改一个名字 → 指纹变化', fingerprint(base) !== fingerprint(tweaked));
  equal('指纹是 8 位十六进制', fingerprint(base).length, 8);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
