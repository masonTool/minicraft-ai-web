/**
 * 虚拟键盘的两条收口（批次 184，用户手机反馈）
 *
 * 用户原话：
 *  ① "游戏内的输入框，点击后不要挤压界面内容"；
 *  ② "当输入框获得焦点时，我点击其它按钮都会把键盘再次拉起来"。
 *
 * 两个现象是两件不同的事：
 *
 * **① 挤压**：`<meta name="viewport" ... interactive-widget=resizes-content>`
 * 会让浏览器在键盘弹出时把**布局视口**一起缩小——`100dvh`、`position: fixed; inset: 0`
 * 全都跟着变矮，3D 画面与 HUD 就被"压"了一下。改成 `resizes-visual` 之后布局不动，
 * 键盘只是盖在画面底部。代价是贴底的东西会被键盘挡住，所以这里把"键盘占了多少"
 * 写成一个 CSS 变量 `--kb-inset`，让聊天框/告示牌编辑框自己抬起来（见 index.html）。
 *
 * **② 键盘反复弹出**：游戏里的按钮大量用 `pointerdown + preventDefault()`
 * （为了"按下就响应"和不触发 canvas 的长按菜单），而 `preventDefault()` 同时
 * 也**阻止了输入框失焦**。于是输入框一直拿着焦点，玩家以为键盘收起来了，
 * 点下一颗按钮时系统又把它弹回来。做法很直接：**点到输入框以外的地方先 blur**。
 * 这一条挂在 `document` 的捕获阶段，菜单（新建世界）与游戏内共用。
 *
 * 为什么不做成"每个面板自己去 blur"：输入框分散在聊天、告示牌、铁砧、搜索框、
 * 新建世界表单五个地方，逐个接线一定会漏；而"点别处就失焦"本来就是浏览器的默认行为，
 * 这里只是把它被 `preventDefault()` 吃掉的那一半补回来。
 */

/** 这些元素拿到焦点时算"正在输入"（`<select>` 不算：点它自己就会收键盘） */
function isTextControl(element: Element | null): element is HTMLElement {
  if (!element) return false;
  const tag = element.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const type = (element as HTMLInputElement).type;
  return type !== 'checkbox' && type !== 'radio' && type !== 'range' && type !== 'button';
}

/**
 * 键盘占掉的高度（px）：`视觉视口高度 + 它的偏移` 与布局视口之间的差。
 * 没有 `visualViewport`（桌面旧内核）时一直是 0。
 */
function keyboardInset(): number {
  if (typeof window === 'undefined') return 0;
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  // `offsetTop` 在浏览器为了把输入框滚进可视区而平移视觉视口时不为 0
  return Math.max(0, Math.round(window.innerHeight - (viewport.height + viewport.offsetTop)));
}

function syncKeyboardInset(): void {
  if (typeof document === 'undefined') return;
  const inset = keyboardInset();
  document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
  // 供验收脚本读：`body.dataset.keyboardInset` 有值就说明键盘开着（或刚关）
  document.body.dataset.keyboardInset = String(inset);
}

/**
 * 装上两条守卫。**只装一次**（boot 里调用；换世界不重装）。
 *
 * 监听是页面级的、没有解绑：它跟着页面活，不跟着某一局 App 活。
 */
export function installKeyboardGuards(): void {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.keyboardGuards === '1') return;
  document.documentElement.dataset.keyboardGuards = '1';

  document.addEventListener(
    'pointerdown',
    (event) => {
      const active = document.activeElement;
      if (!isTextControl(active)) return;
      const target = event.target as Node | null;
      // 点在输入框自己身上（含输入框内部的按钮）：让它正常拿焦点/移动光标
      if (target && (target === active || active.contains(target))) return;
      active.blur();
    },
    true,
  );

  syncKeyboardInset();
  const viewport = typeof window === 'undefined' ? null : window.visualViewport;
  if (viewport) {
    viewport.addEventListener('resize', syncKeyboardInset);
    // iOS 在键盘弹出时还会滚动视觉视口；scroll 也要跟一次
    viewport.addEventListener('scroll', syncKeyboardInset);
  }
  // 转屏 / 地址栏收起时也会变，补一次（与上面两条幂等）
  window.addEventListener('resize', syncKeyboardInset);
}

/** 验收脚本/诊断用：当前键盘占掉的高度 */
export function currentKeyboardInset(): number {
  return keyboardInset();
}
