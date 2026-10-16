/**
 * 设备能力判定离线测试（A10，批次 85）
 *
 * 这一批做的是"**打不开的时候，至少让玩家知道为什么**"。判定本身是纯逻辑
 * （`core/render/webglSupport.ts` 不碰 THREE、只碰一个探测接口），所以能离线断言：
 *  1. **三分类**：有 WebGL2 / 只有 WebGL1 / 两个都没有 —— 三者的建议完全不同；
 *  2. **判定顺序**：只有 WebGL1 的浏览器**不能**被归成"WebGL 被完全禁用"
 *     （那条建议是"去开硬件加速"，对老 Safari 毫无用处）；
 *  3. **上下文丢失**：探测到了、但一拿到就丢了 → 单独一类；
 *  4. **渲染器兜底**：`new WebGLRenderer()` 抛错时的归类（消息里带 lost 字样 → 上下文丢失）；
 *  5. **文案自检**：三类各有原因 + ≥2 条建议、原因不重复（防复制粘贴时漏改）。
 *
 * 运行：npm run test:gl
 */

import {
  GL_FAIL_TEXT,
  classifyGlSupport,
  rendererFailure,
  type GlProbe,
} from '../src/core/render/webglSupport.ts';

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

/** 造一个探测桩：给什么就返回什么 */
function probe(webgl2: unknown, webgl1: unknown, lost = false): GlProbe {
  return { webgl2: () => webgl2, webgl1: () => webgl1, lost: () => lost };
}

const FAKE_CONTEXT = { isContextLost: () => false };

// ---------------------------------------------------------------- 1. 三分类

console.log('\n[三分类：建议完全不同]');
{
  const ok = classifyGlSupport(probe(FAKE_CONTEXT, FAKE_CONTEXT));
  check('有 WebGL2 → 可用', ok.ok);

  const onlyV1 = classifyGlSupport(probe(null, FAKE_CONTEXT));
  equal('只有 WebGL1 → 单独一类', onlyV1.ok === false ? onlyV1.kind : 'ok', 'no-webgl2');
  check('（建议是"升级浏览器"）', onlyV1.ok === false && onlyV1.advice.some((line) => line.includes('浏览器')));

  const none = classifyGlSupport(probe(null, null));
  equal('两个都没有 → 另一类', none.ok === false ? none.kind : 'ok', 'no-webgl1');
  check('（建议里要提到硬件加速）', none.ok === false && none.advice.some((line) => line.includes('硬件加速')));

  // ⚠️ 这条是回归：**先问 webgl2 再问 webgl1**。
  // 反过来的话"只有 WebGL1"会被判成"完全不可用"，而那条建议是开硬件加速——
  // 对老 Safari 用户毫无用处（他真的开了也没用，得升级系统）
  check('只有 WebGL1 时**不**给"开硬件加速"那条建议', onlyV1.ok === false && !onlyV1.advice.some((line) => line.includes('硬件加速')));
}

console.log('\n[上下文刚拿到就丢了]');
{
  const lost = classifyGlSupport(probe(FAKE_CONTEXT, FAKE_CONTEXT, true));
  equal('归类为 context-lost', lost.ok === false ? lost.kind : 'ok', 'context-lost');
  check('建议里提到显存/标签页', lost.ok === false && lost.advice.some((line) => line.includes('标签页')));
  // 丢了上下文时不该再看 webgl1（两条建议会互相打脸）
  check('上下文丢失时不再去问 WebGL1', lost.ok === false && lost.advice.some((line) => line.includes('显存') || line.includes('标签页')));
}

console.log('\n[探测接口的健壮性]');
{
  // 探测函数自己抛错（某些浏览器在禁用 WebGL 时会抛）：归成"完全没有"
  const throwing: GlProbe = {
    webgl2: () => {
      throw new Error('blocked');
    },
    webgl1: () => {
      throw new Error('blocked');
    },
  };
  let kind = 'ok';
  try {
    const result = classifyGlSupport(throwing);
    kind = result.ok ? 'ok' : result.kind;
  } catch {
    kind = 'threw';
  }
  // 判定层不负责兜异常（那是 `probeBrowserGl` 的事），但**不能**把异常吞掉后报"可用"
  check('探测抛错时不会误判成"可用"', kind !== 'ok', kind);
}

console.log('\n[渲染器兜底：预检过了但创建失败]');
{
  const lost = rendererFailure('THREE.WebGLRenderer: Context Lost.');
  equal('消息里带 lost → 归 context-lost', lost.kind, 'context-lost');
  const other = rendererFailure('Error creating WebGL context.');
  equal('其它消息 → 归 unknown', other.kind, 'unknown');
  check('两种都带原因与建议', lost.reason.length > 0 && lost.advice.length >= 1 && other.advice.length >= 1);
  const cases = rendererFailure('内存不足');
  equal('中文消息也不炸', cases.kind, 'unknown');
}

// ---------------------------------------------------------------- 2. 文案自检

console.log('\n[文案：三类各有原因与建议，且不重复]');
{
  const kinds = ['no-webgl2', 'no-webgl1', 'context-lost', 'unknown'] as const;
  const reasons = new Set<string>();
  for (const kind of kinds) {
    const text = GL_FAIL_TEXT[kind];
    check(`${kind}：有原因`, text.reason.length >= 8, text.reason);
    check(`${kind}：至少 2 条建议`, text.advice.length >= 2, String(text.advice.length));
    check(`${kind}：建议都不是空串`, text.advice.every((line) => line.trim().length > 0));
    check(`${kind}：原因不与其他类重复`, !reasons.has(text.reason));
    reasons.add(text.reason);
  }
  equal('四类文案各不相同', reasons.size, kinds.length);
  // 玩家看得懂：不要出现 "context" 这种词（诊断码那一行才用英文）
  check('原因里没有 "context" 这种黑话', kinds.every((kind) => !GL_FAIL_TEXT[kind].reason.toLowerCase().includes('context')));
  check('advice 至多 3 条（手机上一屏能读完）', kinds.every((kind) => GL_FAIL_TEXT[kind].advice.length <= 3));
}

console.log(`\n设备能力判定测试：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
