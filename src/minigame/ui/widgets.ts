/**
 * canvas UI 基础件（WX-021）
 *
 * 不解析 CSS，只接受明确的矩形/样式参数；所有小游戏界面共用这一套，
 * 保证像素风边框、按钮三态、文字截断的行为一致。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ButtonState = 'normal' | 'pressed' | 'disabled';

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 像素风面板：深色渐变 + 冷色双边框 + 四角高光 */
export function drawPanel(context: CanvasRenderingContext2D, rect: Rect): void {
  const gradient = context.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  gradient.addColorStop(0, 'rgba(30, 38, 46, 0.97)');
  gradient.addColorStop(0.55, 'rgba(18, 23, 28, 0.97)');
  gradient.addColorStop(1, 'rgba(12, 16, 20, 0.98)');
  context.fillStyle = gradient;
  context.fillRect(rect.x, rect.y, rect.w, rect.h);

  context.strokeStyle = 'rgba(150, 205, 235, 0.62)';
  context.lineWidth = 3;
  context.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3);

  context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  context.lineWidth = 1;
  context.strokeRect(rect.x + 5.5, rect.y + 5.5, rect.w - 11, rect.h - 11);

  // 四角像素装饰
  context.fillStyle = 'rgba(180, 225, 245, 0.9)';
  const c = 5;
  context.fillRect(rect.x + 2, rect.y + 2, c, c);
  context.fillRect(rect.x + rect.w - 2 - c, rect.y + 2, c, c);
  context.fillRect(rect.x + 2, rect.y + rect.h - 2 - c, c, c);
  context.fillRect(rect.x + rect.w - 2 - c, rect.y + rect.h - 2 - c, c, c);
}

/** 按钮三态：正常/按下/禁用；按下时整体下移 2px */
export function drawButton(
  context: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  state: ButtonState = 'normal',
  fontSize = 22,
): void {
  const offset = state === 'pressed' ? 2 : 0;
  const x = rect.x;
  const y = rect.y + offset;
  const disabled = state === 'disabled';

  context.globalAlpha = disabled ? 0.42 : 1;
  const gradient = context.createLinearGradient(0, y, 0, y + rect.h);
  if (state === 'pressed') {
    gradient.addColorStop(0, 'rgba(44, 54, 64, 0.98)');
    gradient.addColorStop(1, 'rgba(28, 36, 44, 0.98)');
  } else {
    gradient.addColorStop(0, 'rgba(82, 98, 112, 0.98)');
    gradient.addColorStop(1, 'rgba(42, 52, 62, 0.98)');
  }
  context.fillStyle = gradient;
  context.fillRect(x, y, rect.w, rect.h);
  context.fillStyle = state === 'pressed' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.12)';
  context.fillRect(x + 2, y + 2, rect.w - 4, 3);
  context.strokeStyle = state === 'pressed' ? 'rgba(150, 205, 235, 0.8)' : 'rgba(180, 225, 245, 0.8)';
  context.lineWidth = 2;
  context.strokeRect(x + 1, y + 1, rect.w - 2, rect.h - 2);

  drawText(context, label, x + rect.w / 2, y + (rect.h - fontSize) / 2 - 1, fontSize, '#ffffff', 'center');
  context.globalAlpha = 1;
}

/** 页签：active 用亮底/黑字，非 active 用暗底/白字 */
export function drawTab(
  context: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  active: boolean,
): void {
  context.fillStyle = active ? 'rgba(150, 220, 245, 0.95)' : 'rgba(42, 50, 58, 0.95)';
  context.fillRect(rect.x, rect.y, rect.w, rect.h);
  context.fillStyle = active ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.1)';
  context.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, 3);
  context.strokeStyle = active ? 'rgba(220, 250, 255, 0.95)' : 'rgba(150, 205, 235, 0.45)';
  context.lineWidth = 2;
  context.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  drawText(
    context,
    label,
    rect.x + rect.w / 2,
    rect.y + (rect.h - 20) / 2,
    20,
    active ? '#08131a' : '#ffffff',
    'center',
  );
}

/** 水平滑块：value01 为 0..1 */
export function drawSlider(
  context: CanvasRenderingContext2D,
  rect: Rect,
  value01: number,
  label: string,
  valueText: string,
): void {
  const value = Math.max(0, Math.min(1, value01));
  drawText(context, label, rect.x, rect.y - 28, 18, 'rgba(255, 255, 255, 0.78)');
  drawText(
    context,
    valueText,
    rect.x + rect.w,
    rect.y - 28,
    18,
    '#ffffff',
    'right',
  );

  const trackY = rect.y + rect.h / 2 - 4;
  context.fillStyle = 'rgba(0, 0, 0, 0.6)';
  context.fillRect(rect.x, trackY, rect.w, 8);
  context.fillStyle = 'rgba(180, 220, 255, 0.9)';
  context.fillRect(rect.x, trackY, rect.w * value, 8);

  const knobX = rect.x + rect.w * value;
  context.fillStyle = '#ffffff';
  context.fillRect(knobX - 8, trackY - 8, 16, 24);
}

/** 开关：左侧标签，右侧 64×28 轨道 */
export function drawSwitch(
  context: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  on: boolean,
): void {
  drawText(context, label, rect.x, rect.y + 4, 18, 'rgba(255, 255, 255, 0.78)');
  const x = rect.x + rect.w - 64;
  const y = rect.y;
  context.fillStyle = on ? 'rgba(110, 200, 140, 0.95)' : 'rgba(0, 0, 0, 0.6)';
  context.fillRect(x, y, 64, 28);
  context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  context.lineWidth = 2;
  context.strokeRect(x + 1, y + 1, 62, 26);
  context.fillStyle = '#ffffff';
  context.fillRect(on ? x + 38 : x + 6, y + 4, 20, 20);
}

/** 水平进度条，value 为 0..1 */
export function drawProgressBar(
  context: CanvasRenderingContext2D,
  rect: Rect,
  value: number,
): void {
  const v = Math.max(0, Math.min(1, value));
  context.fillStyle = 'rgba(0, 0, 0, 0.65)';
  context.fillRect(rect.x, rect.y, rect.w, rect.h);
  context.fillStyle = 'rgba(130, 210, 255, 0.95)';
  context.fillRect(rect.x, rect.y, rect.w * v, rect.h);
  context.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  context.lineWidth = 2;
  context.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
}

/** 等宽文字；按 maxWidth 截断并补省略号 */
export function drawText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color = '#ffffff',
  align: CanvasTextAlign = 'left',
  maxWidth?: number,
): void {
  context.font = `${size}px monospace`;
  context.textBaseline = 'top';
  context.textAlign = align;
  context.fillStyle = color;

  let text = value;
  if (maxWidth && maxWidth > 0) {
    while (text.length > 0 && context.measureText(text).width > maxWidth) {
      text = text.slice(0, -1);
    }
    if (text.length < value.length) text = `${text.slice(0, Math.max(0, text.length - 1))}…`;
  }
  context.fillText(text, x, y);
  context.textAlign = 'left';
}
