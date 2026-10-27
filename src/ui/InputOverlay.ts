/**
 * 输入浮条（用户 2026-10-27 定稿）。
 *
 * 解决的问题只有一个：**手机上系统键盘会盖住输入框本身**，而表单的输入框大多在下半屏，
 * 玩家看不见自己在打什么。
 *
 * 做法（用户原话）：点输入框 → 键盘照常弹出 → 内容搬到**屏幕左上角的一条细条**里
 * （那里永远不会被键盘盖住），在里面打字，键盘上的「完成」按下就写回原输入框；
 * 键盘一收起，这条也跟着消失。**没有标题、没有取消/确定按钮、没有遮罩**——
 * 它不是一个对话框，只是给输入框临时换了个"看得见的位置"。
 *
 * 三个实现上的要点：
 *  - **边打边同步**：每输入一个字就写回原输入框并派发 `input`，所以中途收键盘
 *    （等于取消）也不会丢已输入的内容；`change` 只在「完成」时补发一次。
 *  - **全选**：进去就是全选状态，一打字整体替换（改 IP / 改名字是主要场景）。
 *  - **跟着键盘走**：`visualViewport` 高度恢复（键盘收起）或浮条失焦 → 立即收起。
 *
 * 不接管：只读、禁用、非文本类型（range / checkbox / radio / file / color…）。
 */
import { t } from '../core/i18n/I18n.ts';

const SKIP_TYPES = new Set(['range', 'checkbox', 'radio', 'file', 'color', 'submit', 'button', 'reset']);

let bar: HTMLDivElement | null = null;
let field: HTMLInputElement | null = null;
let editing: HTMLInputElement | HTMLTextAreaElement | null = null;
/** 正在写回：此时触发的 blur 不该被当成"取消" */
let committing = false;
/**
 * 键盘"确实弹起过"才有资格判定"收起"。
 *
 * 桌面上 `visualViewport.height` 恒等于 `innerHeight`——不加这个门，任何一次 resize
 * （窗口变化、滚动条出现）都会被当成"键盘收起"，浮条刚打开就被关掉。
 */
let sawShrink = false;

function build(): void {
  if (bar !== null && field !== null) return;
  bar = document.createElement('div');
  bar.className = 'inp-bar';

  field = document.createElement('input');
  field.className = 'inp-bar-field';
  field.type = 'text';
  field.autocomplete = 'off';
  field.spellcheck = false;
  // 让手机键盘右下角那颗键显示成「完成」而不是「换行」
  field.enterKeyHint = 'done';
  field.setAttribute('aria-label', t('mp.inputBar'));

  /*
   * 边打边同步：写回原框并派发 `input`，所以实时校验 / 搜索过滤 / 依赖这个值的界面
   * 都照旧更新。`change` 留到「完成」时再发——那是"这次编辑结束"的信号。
   */
  field.addEventListener('input', () => {
    if (editing === null || field === null) return;
    editing.value = field.value;
    editing.dispatchEvent(new Event('input', { bubbles: true }));
  });

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  // 失焦（点了别处 / 键盘被收起）→ 直接收起：值已经实时同步，不需要再写一次
  field.addEventListener('blur', () => {
    if (!committing) close();
  });

  // 点遮罩空白处 = 结束输入：值已经实时同步过，直接收起即可（不补 change）
  bar.addEventListener('click', (event) => {
    if (event.target === bar) close();
  });

  bar.append(field);
  document.body.append(bar);
}

/** 「完成」：补发 change（表示这次编辑结束）再收起 */
function commit(): void {
  if (editing !== null && field !== null) {
    committing = true;
    editing.value = field.value;
    editing.dispatchEvent(new Event('change', { bubbles: true }));
    committing = false;
  }
  close();
}

function close(): void {
  if (bar === null) return;
  // 只隐藏：`bar` / `field` 留着复用（清空 `field` 会让下一次 build 误判"已建好"）
  bar.classList.remove('visible');
  editing = null;
}

function open(element: HTMLInputElement | HTMLTextAreaElement): void {
  build();
  if (bar === null || field === null) return;
  editing = element;
  field.value = element.value;
  field.inputMode = element.inputMode;
  /*
   * `maxLength` 在没设上限时是 **-1**，直接赋给 input 会抛 `IndexSizeError`
   * （"value provided (-1) is not positive or 0"）——那样整个 open 就中断在
   * "显示浮条"之前，表现是"点了输入框什么都不发生"。
   */
  if (element.maxLength >= 0) {
    field.maxLength = element.maxLength;
  } else {
    field.removeAttribute('maxlength');
  }
  sawShrink = false;
  bar.classList.add('visible');
  field.focus();
  // 全选：改 IP / 改名字这类"整体替换"的场景最常见，一打字就盖掉旧值
  field.select();
}

/** 键盘收起时把浮条一起收掉（`visualViewport` 高度回到接近全屏就说明键盘下去了） */
function watchKeyboard(): void {
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined) return;
  viewport.addEventListener('resize', () => {
    if (bar === null || !bar.classList.contains('visible')) return;
    // 先出现"明显变矮"（键盘弹起）才记为一次；留 120px 余量，避开地址栏那几十像素
    if (viewport.height < window.innerHeight - 120) {
      sawShrink = true;
      return;
    }
    // 变矮过又恢复了 = 键盘收起
    if (sawShrink) close();
  });
}

/** 装一次就够（幂等）：在 `main.ts` 启动时调用 */
export function installInputOverlay(): void {
  if (typeof document === 'undefined') return;
  watchKeyboard();
  document.addEventListener(
    'focusin',
    (event) => {
      if (committing) return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target.closest('.inp-bar') !== null) return;
      if (target.readOnly || target.disabled) return;
      if (target instanceof HTMLInputElement && SKIP_TYPES.has(target.type)) return;
      /*
       * 把焦点让给浮条：原框 blur → 键盘收起 → 浮条 focus → 键盘再弹出。
       * 这一步在手机上会有一次很短的收放，但换来的是"输入的地方永远在屏幕上方"。
       */
      target.blur();
      open(target);
    },
    true,
  );
}
