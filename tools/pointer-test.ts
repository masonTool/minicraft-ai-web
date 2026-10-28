/**
 * 触摸坐标兜底（批次 183）
 *
 * 真机日志里出现过连续二十多次 `pointerdown clientX=0 clientY=0`：
 * 视角拖不动、摇杆还会算出巨大反向输入。这里钉住"按来源解析"的规则：
 *  - client 可用 → 用 client（桌面/绝大多数触摸）；
 *  - client 双双为 0 → 退到 screen，再退到 page；
 *  - 三个都不可用 → `none`，调用方应判这次手势无效并重排；
 *  - 同一手势内**不混用**坐标系。
 *
 * 运行：npm run test:pointer
 */

import { pointFromEventWithSource, resolvePointerPoint } from '../web/src/core/input/PointerPoint.ts';

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

console.log('\n[一、按来源解析]');
{
  const client = resolvePointerPoint(120, 240, 0, 0, 0, 0);
  equal('client 可用就用 client', `${client.x},${client.y},${client.source}`, '120,240,client');

  const screen = resolvePointerPoint(0, 0, 500, 300, 510, 310);
  equal('client 双双为 0 → 退到 screen', `${screen.x},${screen.y},${screen.source}`, '500,300,screen');

  const page = resolvePointerPoint(0, 0, 0, 0, 700, 400);
  equal('screen 也不可用 → 退到 page', `${page.x},${page.y},${page.source}`, '700,400,page');

  const none = resolvePointerPoint(0, 0, 0, 0, 0, 0);
  equal('三个都不可用 → none', none.source, 'none');

  const corner = resolvePointerPoint(0, 5, 0, 0, 0, 0);
  equal('只有 clientY 非 0 也算 client（左上边缘是合法位置）', corner.source, 'client');
}

console.log('\n[二、同一手势锁定来源]');
{
  // 用一个最小的假事件对象：只实现本函数会用到的字段
  const event = (values: Record<string, number>): PointerEvent =>
    values as unknown as PointerEvent;

  const e = event({ clientX: 1, clientY: 2, screenX: 100, screenY: 200, pageX: 10, pageY: 20 });
  for (const source of ['client', 'screen', 'page'] as const) {
    const point = pointFromEventWithSource(e, source);
    equal(`锁定 ${source} 时只读 ${source}`, `${point.x},${point.y},${point.source}`,
      source === 'client' ? '1,2,client' : source === 'screen' ? '100,200,screen' : '10,20,page');
  }
  const none = pointFromEventWithSource(e, 'none');
  equal('锁定 none 永远返回 0（调用方据此丢弃手势）', `${none.x},${none.y},${none.source}`, '0,0,none');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
