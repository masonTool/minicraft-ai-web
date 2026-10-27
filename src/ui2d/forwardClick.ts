/**
 * 把"画布吃掉的那一次点击"转发给下面的 DOM
 *
 * 自绘背包接管输入之后，覆盖层是 `pointer-events: auto` 且盖在最上面 ——
 * 于是 DOM 面板里的**关闭 ×、左右立栏（分类/仓库/人物/成就）**全都点不到了。
 * 这些控件这一批还不打算重画（它们是"外壳"，不是槽位），所以需要一条转发通道：
 *
 * 做法是**同步地**把画布的 `pointer-events` 临时关掉，`elementFromPoint` 找到真正的元素，
 * 派发一次 `click`，然后立刻恢复。全程同一帧内完成，用户看不出闪烁。
 *
 * ⚠️ 只转发 `click`：按钮、链接、页签都够用；需要 `pointerdown/move/up` 序列的控件
 * （例如拖拽立栏抽屉）不在这一批的范围内，硬转发只会得到半截手势。
 */

/**
 * 把点击转发给画布下面那一层的元素。
 *
 * @param canvas 覆盖层画布（调用方保证它此刻是 `pointer-events: auto`）
 * @param clientX 视口坐标
 * @param clientY 视口坐标
 * @returns 真的派发了 click 的那个元素（没找到就是 `null`）
 */
export function forwardClickAt(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): Element | null {
  const previous = canvas.style.pointerEvents;
  canvas.style.pointerEvents = 'none';
  const target = document.elementFromPoint(clientX, clientY);
  canvas.style.pointerEvents = previous;
  if (!target || target === canvas) return null;
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY }));
  return target;
}
