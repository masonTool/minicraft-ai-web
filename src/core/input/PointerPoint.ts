/**
 * 触摸坐标的兜底解析（批次 183）
 *
 * 由来（真机日志）：Android Chrome 在"关掉面板 / 从后台回来 / 全屏切换"之后，
 * 偶发把后续 `pointerdown` 的 `clientX/clientY` 都报成 **0**（连续二十多次），
 * 于是拖动增量恒为 0 —— 表现就是"视角卡住，拖不动"；摇杆同时也会被当成按在 (0,0)，
 * 算出巨大的负方向偏移（"摇杆方向反了"）。开关一次背包之所以能恢复，
 * 是因为它强制了一次布局重排，浏览器重新给出正确坐标。
 *
 * 这里做两件事：
 *  1. **按来源解析**：client 正常就用 client；双双为 0 时依次退到 screen / page；
 *  2. 一次手势**锁定同一个来源**：若 pointerdown 来自 screen，后续 move 也只用 screen，
 *     绝不混用两种坐标系（混用会算出一个巨大的跳变）。
 *
 * 纯函数，Node 可测。
 */

export type PointerSource = 'client' | 'screen' | 'page' | 'none';

export interface PointerPoint {
  x: number;
  y: number;
  /** 这一组坐标来自哪里；`none` = 三个来源全是 0，无法用于拖动 */
  source: PointerSource;
}

/** 从任意一组坐标里挑出可用的那一组（优先级 client → screen → page） */
export function resolvePointerPoint(
  clientX: number,
  clientY: number,
  screenX: number,
  screenY: number,
  pageX: number,
  pageY: number,
): PointerPoint {
  if (clientX !== 0 || clientY !== 0) return { x: clientX, y: clientY, source: 'client' };
  if (screenX !== 0 || screenY !== 0) return { x: screenX, y: screenY, source: 'screen' };
  if (pageX !== 0 || pageY !== 0) return { x: pageX, y: pageY, source: 'page' };
  return { x: 0, y: 0, source: 'none' };
}

/** 取一个 PointerEvent 的坐标（只用于 pointerdown 时决定来源） */
export function pointFromEvent(event: PointerEvent): PointerPoint {
  return resolvePointerPoint(event.clientX, event.clientY, event.screenX, event.screenY, event.pageX, event.pageY);
}

/**
 * 按已锁定的来源读取后续事件坐标。
 *
 * `none` 永远返回 0 —— 调用方应把这次手势视为无效（并在 down 时触发一次布局重排）。
 */
export function pointFromEventWithSource(event: PointerEvent, source: PointerSource): PointerPoint {
  switch (source) {
    case 'client':
      return { x: event.clientX, y: event.clientY, source };
    case 'screen':
      return { x: event.screenX, y: event.screenY, source };
    case 'page':
      return { x: event.pageX, y: event.pageY, source };
    default:
      return { x: 0, y: 0, source: 'none' };
  }
}
