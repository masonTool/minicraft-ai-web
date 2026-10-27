/**
 * 手机端的输入浮层（用户 2026-10-27 定稿）。
 *
 * **PC 端完全没有这套逻辑**：鼠标没有"键盘遮挡"的问题，点输入框就是原生行内编辑。
 * 只有手机 / 触屏设备才接管。
 *
 * 结构（用户原话）：不是把原输入框挪走，而是**在界面上再加一整层黑色半透明遮罩**，
 * 输入框作为那一层的子元素放在**左上角**：
 *
 *     ┌─────────────────────────────┐
 *     │ 输入内容                     │  ← 无边框，只有下方一条线
 *     │                             │
 *     │      黑色半透明（75%）        │  ← 全屏，盖住下面所有内容
 *     │      点这里 = 结束输入         │
 *     └─────────────────────────────┘
 *
 * 交互：点原输入框 → 遮罩层出现 + 键盘弹出 + 全选 → 打字（**边打边写回**原框）
 *      → 点遮罩任意处（或键盘收起）→ 原框拿到最终值 → 遮罩消失。
 *
 * 遮罩本身是拦截层：它全屏覆盖，所以下面的点击/滑动都落不到。
 */
import { t } from '../core/i18n/I18n.ts';

const SKIP_TYPES = new Set(['range', 'checkbox', 'radio', 'file', 'color', 'submit', 'button', 'reset', 'hidden']);

let layer: HTMLDivElement | null = null;
let field: HTMLInputElement | null = null;
let editing: HTMLInputElement | HTMLTextAreaElement | null = null;

/**
 * 要不要接管（用户 2026-10-27：**PC 端没有这套逻辑**）。
 *
 * 判据按"是否明确是桌面"来写：有鼠标式精确指针 + 一个触摸点都没有 → 桌面，让路；
 * 其余（手机/平板/触屏本）一律接管。反过来写是因为有些手机浏览器把
 * `maxTouchPoints` 报 0，那样"只在触屏启用"会直接失效。
 */
function shouldLift(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  // 显式开关：调试 / 桌面自检（用户可在手机地址后加 ?lift=1 强制启用）
  const search = typeof location !== 'undefined' ? location.search : '';
  if (search.indexOf('lift=1') >= 0) return true;
  /*
   * 三项**任一为真**就算触屏：不同浏览器报的不一样（有的只给 maxTouchPoints，
   * 有的只给 ontouchstart，有的只认 pointer: coarse）。取并集才不会漏。
   */
  if (navigator.maxTouchPoints > 0) return true;
  if ('ontouchstart' in window) return true;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    return true;
  }
  /*
   * 三项都假时：只要**不是**"有鼠标精确指针"的桌面，也接管。
   * 反过来写是为了不漏——真机上"漏掉"的代价是整个功能没反应，而桌面多接管
   * 一次只是看起来多一层，用户能立刻感知并反馈。
   */
  const precisePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  return !precisePointer;
}

function build(): void {
  if (layer !== null && field !== null) return;

  layer = document.createElement('div');
  layer.className = 'inp-layer';

  field = document.createElement('input');
  field.type = 'text';
  field.className = 'inp-field';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.setAttribute('aria-label', t('mp.inputBar'));

  /*
   * 边打边写回（用户 2026-10-27 确认）：每个字符都同步回原框并派发 `input`，
   * 所以中途收键盘（等于结束编辑）也不会丢内容；`change` 只在结束时补一次。
   */
  field.addEventListener('input', () => {
    if (editing === null || field === null) return;
    editing.value = field.value;
    editing.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /*
   * 结束编辑的统一入口：**先落值再收层**。
   * 点遮罩、键盘上的「完成」、系统收起键盘，最后都会走到这里。
   */
  const finish = (): void => {
    if (editing !== null && field !== null) {
      editing.value = field.value;
      editing.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
  };

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  // 失焦 = 丢焦点 → 键盘收起 → 层消失（用户 2026-10-27）
  field.addEventListener('blur', () => finish());

  // 点遮罩任意位置：让它失焦，走的还是同一条收尾路径
  layer.addEventListener('pointerdown', (event) => {
    if (event.target === layer) {
      event.preventDefault();
      field?.blur();
    }
  });
  // 手指滑动不能滚到下层
  layer.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
  layer.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });

  layer.append(field);
  document.body.append(layer);
}

function close(): void {
  if (layer === null) return;
  layer.classList.remove('visible');
  editing = null;
}

function open(element: HTMLInputElement | HTMLTextAreaElement): void {
  build();
  if (layer === null || field === null) return;
  editing = element;
  field.value = element.value;
  field.inputMode = element.inputMode;
  /*
   * `maxLength` 在没设上限时是 **-1**，直接赋值会抛 `IndexSizeError`，
   * 异常会打断整个 open（表现：点了输入框什么都不发生）。
   */
  if (element.maxLength >= 0) {
    field.maxLength = element.maxLength;
  } else {
    field.removeAttribute('maxlength');
  }
  layer.classList.add('visible');
  field.focus();
  // 全选：改 IP / 改名字这类"整体替换"最常见，一打字就盖掉旧值
  field.select();
}

/** 装一次就够（幂等）：在 `main.ts` 启动时调用 */
/**
 * 在**捕获阶段**把所有输入类事件吞掉（用户 2026-10-27："遮罩没挡住下层触摸"）。
 *
 * 为什么不能只靠遮罩是 `position: fixed; inset: 0`：
 *  - 遮罩确实盖在最上层，`elementFromPoint` 也返回它，但事件**照样会冒泡到 document**；
 *  - 页面里大量交互是 document 级事件委托（列表点击、键盘、游戏输入），
 *    它们不看坐标、只看事件流——于是"点遮罩"会被当成"点了下层某处"。
 *
 * 所以在 window 的捕获阶段就掐断：浮层可见时，凡是落在浮层之外的事件一律
 * `stopPropagation + preventDefault`。输入框自身的事件放行（否则打不了字）。
 * `keydown` 不吞——吞了就没法输入；但仍要求它只来自浮层里的输入框。
 */
function installEventShield(): void {
  const swallow = (event: Event): void => {
    if (layer === null || !layer.classList.contains('visible')) return;
    const target = event.target as Node | null;
    if (target === null) return;
    if (field !== null && (target === field || field.contains(target))) return;
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    /*
     * 点遮罩 = 结束输入。
     * ⚠️ 必须在这里做：`stopPropagation` 之后事件不会再传到遮罩自己的监听器，
     * 那边写的收起逻辑永远收不到（改成捕获拦截后踩到过一次）。
     */
    if (event.type === 'pointerdown' && target === layer) field?.blur();
  };
  for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'touchmove', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    window.addEventListener(type, swallow, { capture: true, passive: false });
  }
  window.addEventListener(
    'keydown',
    (event) => {
      if (layer === null || !layer.classList.contains('visible')) return;
      const target = event.target as Node | null;
      if (field !== null && (target === field || field.contains(target))) return;
      event.stopPropagation();
    },
    { capture: true },
  );
}

export function installInputOverlay(): void {
  if (typeof document === 'undefined') return;
  if (!shouldLift()) return;
  installEventShield();

  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
      if (target.closest('.inp-layer') !== null) return;
      if (target.readOnly === true || target.disabled === true) return;
      if (target instanceof HTMLInputElement && SKIP_TYPES.has(target.type)) return;
      /*
       * 把焦点让给遮罩里的输入框（同一手势的同步栈内，移动端仍然会弹键盘）。
       * 原框先失焦，避免两个框同时"活着"导致写回打架。
       */
      target.blur();
      open(target);
    },
    true,
  );
}
