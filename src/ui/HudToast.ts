/**
 * 游戏内的一行提示（批次 181）
 *
 * 位置固定在**快捷栏上方**：那里不会挡住准星、也不压住摇杆与按钮，
 * 是手机上唯一一块"必然在视线里、又不会误触"的地方。
 *
 * 与 `#inv-pick-toast` 的区别：那一块属于背包界面（要显示稀有度与物品说明），
 * 这一块属于游戏内（视角切换、模式切换、全屏状态这类一条文字就够的反馈）。
 * 两者共用同一套位置与配色，但生命周期互不干扰。
 */

/** 停留时间（毫秒）：用户要求"大概两秒，然后淡出" */
export const HUD_TOAST_MS = 2000;
/** 淡出时长，与 CSS 的 transition 保持一致 */
const FADE_MS = 200;

export class HudToast {
  private readonly root: HTMLDivElement;
  private stayTimer: number | null = null;
  private fadeTimer: number | null = null;

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'hud-toast';
    this.root.className = 'hidden';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    host.appendChild(this.root);
  }

  /** 显示一条提示；连续调用时后一条直接覆盖前一条（不排队，避免积压） */
  show(text: string): void {
    this.clearTimers();
    this.root.textContent = text;
    this.root.classList.remove('hidden');
    // 先摘掉 visible 再加回来，保证连续提示时过渡会重新触发
    this.root.classList.remove('visible');
    void this.root.offsetWidth;
    this.root.classList.add('visible');
    this.stayTimer = window.setTimeout(() => {
      this.stayTimer = null;
      this.root.classList.remove('visible');
      this.fadeTimer = window.setTimeout(() => {
        this.fadeTimer = null;
        this.root.classList.add('hidden');
      }, FADE_MS);
    }, HUD_TOAST_MS);
  }

  get text(): string {
    return this.root.classList.contains('hidden') ? '' : this.root.textContent ?? '';
  }

  dispose(): void {
    this.clearTimers();
    this.root.remove();
  }

  private clearTimers(): void {
    if (this.stayTimer !== null) {
      clearTimeout(this.stayTimer);
      this.stayTimer = null;
    }
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}
