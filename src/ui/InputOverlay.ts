/**
 * 全站输入浮层（用户 2026-10-27）。
 *
 * 问题：手机上点输入框，系统输入法会从底部弹起来**盖住**那个框本身，玩家看不见
 * 自己在打什么（越靠下的框被盖得越彻底，而表单的框往往就在下半屏）。
 *
 * 做法：点任何文本输入框都不在原地编辑，而是把值拷到**一个固定的浮层**里——浮层
 * 在屏幕上方、输入法压不到；确认后写回原框，并补发 `input` / `change`，
 * 所以原有的事件监听（校验、实时预览、搜索过滤）都照旧工作。
 *
 * 为什么用**事件委托**而不是逐个改：全站输入框太多（联机、世界、设置、搜索、聊天…），
 * 逐个改等于永远漏一个；在 `document` 上拦 `focusin`，一处覆盖全部。
 *
 * 不接管的情况：只读 / 禁用 / 非文本类型（range、checkbox、radio、file、color…）。
 */
import { t } from '../core/i18n/I18n.ts';

const SKIP_TYPES = new Set(['range', 'checkbox', 'radio', 'file', 'color', 'submit', 'button', 'reset']);

let layer: HTMLDivElement | null = null;
let field: HTMLInputElement | null = null;
let editing: HTMLInputElement | HTMLTextAreaElement | null = null;
/** 写回时派发事件会再次触发 `focusin`，用它挡住重入 */
let guard = false;

/** 浮层里显示的标题：优先 aria-label，其次 placeholder，最后退回「输入」 */
function titleOf(element: HTMLInputElement | HTMLTextAreaElement): string {
  const aria = element.getAttribute('aria-label');
  if (aria !== null && aria.length > 0) return aria;
  if (element.placeholder.length > 0) return element.placeholder;
  const labelled = element.closest('label');
  if (labelled !== null) return (labelled.textContent ?? '').trim().slice(0, 24);
  return '';
}

function build(): void {
  if (layer !== null) return;
  layer = document.createElement('div');
  layer.className = 'inp-layer';

  const card = document.createElement('div');
  card.className = 'inp-card';

  const title = document.createElement('div');
  title.className = 'inp-title';

  field = document.createElement('input');
  field.className = 'inp-field';
  field.type = 'text';
  field.autocomplete = 'off';
  field.spellcheck = false;

  const actions = document.createElement('div');
  actions.className = 'inp-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'inp-button';
  cancel.textContent = t('menu.cancel');
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'inp-button primary';
  ok.textContent = t('server.confirm');
  actions.append(cancel, ok);

  card.append(title, field, actions);
  layer.append(card);
  // 点空白处 = 取消（与其它弹层一致）
  layer.addEventListener('click', (event) => {
    if (event.target === layer) close();
  });

  const commit = (): void => {
    if (editing === null || field === null) return;
    guard = true;
    editing.value = field.value;
    /*
     * 补发两个事件：现有逻辑大多监听 `input`（实时校验/过滤）或 `change`（提交时读值）。
     * 不派发的话，浮层确认了但界面上的联动不更新——表现为"改了但没生效"。
     */
    editing.dispatchEvent(new Event('input', { bubbles: true }));
    editing.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    guard = false;
  };

  ok.addEventListener('click', commit);
  cancel.addEventListener('click', close);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  document.body.append(layer);
}

function close(): void {
  if (layer === null) return;
  layer.remove();
  layer = null;
  field = null;
  editing = null;
}

function open(element: HTMLInputElement | HTMLTextAreaElement): void {
  build();
  if (layer === null || field === null) return;
  editing = element;
  const title = layer.querySelector('.inp-title');
  if (title !== null) title.textContent = titleOf(element);
  field.value = element.value;
  field.type = element instanceof HTMLInputElement && element.type === 'password' ? 'password' : 'text';
  field.inputMode = element.inputMode;
  field.maxLength = element.maxLength > 0 ? element.maxLength : -1;
  field.placeholder = element.placeholder;
  field.focus();
  field.select();
}

/** 装一次就够（幂等）：在 `main.ts` 启动时调用 */
export function installInputOverlay(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener(
    'focusin',
    (event) => {
      if (guard) return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target.closest('.inp-layer') !== null) return;
      if (target.readOnly || target.disabled) return;
      if (target instanceof HTMLInputElement && SKIP_TYPES.has(target.type)) return;
      // 先 blur 再开浮层：不 blur 的话系统键盘已经弹起来，浮层会被压在下半屏
      target.blur();
      open(target);
    },
    true,
  );
}
