/**
 * canvas 界面的**调试**工具（不参与产品外观）
 *
 * 为什么需要"整层黄色遮罩"：迁到 canvas 的东西如果画得与 DOM 一模一样，
 * 看的人**分不出哪块换了**（第一批试点就栽在这上面：用户的原话是
 * "改的这几个地方都不太明显"）。黄色的作用不是好看，而是把"这块像素是谁画的"
 * 变成肉眼一秒能判断的事。
 */

/** 遮罩色（半透明黄；太实会看不清内容，太淡又看不出来） */
export const DEBUG_TINT_COLOR = 'rgba(255, 214, 0, .52)';

/**
 * 把"canvas 已经画过的像素"统一染黄。
 *
 * 实现只有一步：切到 `source-atop` 再整块填充 —— 合成器会把填充**只落在
 * 已经有像素的地方**，于是不用维护"这一帧画了哪些矩形"的账，将来新增控件
 * 也自动被覆盖（见决策 D5）。调用时机必须是**所有绘制之后**，且要还原合成模式。
 *
 * @param width/height 覆盖层的 CSS px 尺寸（ctx 已按 DPR 缩放，别自己乘）
 */
export function applyDebugTint(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  if (!(width > 0) || !(height > 0)) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = DEBUG_TINT_COLOR;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
