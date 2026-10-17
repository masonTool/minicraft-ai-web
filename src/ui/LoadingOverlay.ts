/**
 * 加载遮罩（批次 160）
 *
 * 用户反馈："我在首次加载这个页面的时候，它会显示一个'地图生成中'的东西，
 * 这个能不能在一开始的时候不需要？因为地图生成是在创建游戏的时候才生成的。"
 *
 * 这条反馈指出的其实是**语义错位**：`#loading` 原来是 `index.html` 里写死的一个节点，
 * 从 `boot()` 第一行就在屏幕上（那时只是在做 GL 预检、画图集、读存档库），
 * 而它的文案写着"正在生成世界…"——**一件当时还没发生的事**。它会一直挂到
 * 玩家真的进了世界、第一块地形画出来为止（`App.refreshLoadingState()`）。
 *
 * 所以这里把它从"写死的 DOM"改成"按需创建的一件事"：
 *  - 没有任何人调用 `showLoading()` 时，页面上**根本不存在**这个节点
 *    （主菜单、设置、世界列表全程都看不到它）；
 *  - `hideLoading()` 直接 `remove()` 而不是加 `.hidden`：验收脚本与
 *    `startup-acceptance.js` 都是按 `document.getElementById('loading')` 判"撤没撤掉"，
 *    留着节点会让那条判据永远为假。
 *
 * ⚠️ 样式留在 `index.html`（`#loading` 与 `loading-sweep` 关键帧）：
 * 那是"长什么样"的事，和"什么时候挂上去"分开；`test:theme` 还有断言盯着那段 CSS。
 */

/** 遮罩的 id（与 `index.html` 里那段 CSS 的选择器一一对应） */
export const LOADING_ID = 'loading';

/** 进世界时那句文案（原版也是"正在生成世界"，因为这一步真的在生成地形） */
export const WORLD_LOADING_TEXT = '正在生成世界…';

function doc(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

/**
 * 挂出遮罩（已经挂着就只换文案）。
 *
 * 只在"真的要生成/加载一个世界"时调用；`boot()` 里**一次都不要调**。
 */
export function showLoading(text: string = WORLD_LOADING_TEXT): void {
  const document_ = doc();
  if (!document_) return;
  let element = document_.getElementById(LOADING_ID);
  if (!element) {
    element = document_.createElement('div');
    element.id = LOADING_ID;
    document_.body.appendChild(element);
  }
  element.textContent = text;
}

/** 撤掉遮罩（没有就什么都不做；重复调用是安全的） */
export function hideLoading(): void {
  doc()?.getElementById(LOADING_ID)?.remove();
}

/** 现在是不是挂着遮罩（调试接口与断言用） */
export function isLoadingVisible(): boolean {
  const document_ = doc();
  if (!document_) return false;
  return document_.getElementById(LOADING_ID) !== null;
}
