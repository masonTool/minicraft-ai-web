/**
 * 小游戏宿主（小游戏1，批次 20261022-1954）
 *
 * 管一局小游戏的**生命周期与那层 DOM**：进入（转场）/ 每帧更新 / 退出（清层）/ 异常兜底。
 * 它**不认任何具体游戏**，只认 `MiniGame` 接口——推箱子、打砖块都从这里挂上去。
 *
 * 五条口径：
 *
 *  1. **退出必须可重入**：`stop()` 可以被按钮、Esc、异常三条路同时触发，第二次是空操作。
 *  2. **异常只毁这一局**：`update` / `onPointer` / `mount` 全包在 try/catch 里，
 *     出错 → 提示 → 退出，绝不把主循环带崩（主世界还等着这一帧结束）。
 *  3. **退出时清空舞台**：`unmount()` 之后 `replaceChildren()`，防止游戏忘了删自己的 DOM。
 *     几何/材质由游戏自己 `dispose()`（验收比对 `renderer.info.memory`）。
 *  4. **指针坐标归一化**：宿主算好 0~1 再交给游戏，游戏里不出现 `clientX`。
 *  5. **转场只是视觉**：一层黑幕淡入淡出，不阻塞挂载（挂载是同步的，没有"等待 60ms"的坑）。
 */

import type * as THREE from 'three';
import { t } from '../core/i18n/I18n.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import type { MiniGame, MiniGameContext, MiniGamePointer } from './types.ts';

export interface MiniGameHostOptions {
  readonly renderer: THREE.WebGLRenderer;
  readonly atlas: TextureAtlas;
  /** 退出后由主程序恢复输入层（宿主不碰 App 的状态） */
  readonly onExit: () => void;
}

export class MiniGameHost {
  readonly layer: HTMLDivElement;

  private readonly stage: HTMLDivElement;
  private readonly fade: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly toastEl: HTMLDivElement;
  private game: MiniGame | null = null;
  private toastTimer: number | null = null;
  /** 正在走"出错 → 退出"的流程：期间的 update/pointer 一律丢弃 */
  private failing = false;

  constructor(
    host: HTMLElement,
    private readonly options: MiniGameHostOptions,
  ) {
    this.layer = document.createElement('div');
    this.layer.id = 'minigame-layer';
    this.layer.className = 'hidden';

    this.stage = document.createElement('div');
    this.stage.className = 'minigame-stage';

    const topbar = document.createElement('div');
    topbar.className = 'minigame-topbar';

    const exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'minigame-exit';
    exit.textContent = t('minigame.exit');
    exit.addEventListener('click', (event) => {
      event.stopPropagation();
      this.stop();
    });

    this.titleEl = document.createElement('span');
    this.titleEl.className = 'minigame-title';

    topbar.append(exit, this.titleEl);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'minigame-toast hidden';

    this.fade = document.createElement('div');
    this.fade.className = 'minigame-fade';

    this.layer.append(this.stage, topbar, this.toastEl, this.fade);
    host.appendChild(this.layer);
    this.bindPointer();
  }

  get active(): boolean {
    return this.game !== null;
  }

  get currentId(): string | null {
    return this.game?.id ?? null;
  }

  /** 舞台里现在的子节点数（验收"退出后不留 DOM"用） */
  get stageChildren(): number {
    return this.stage.childElementCount;
  }

  /** 进入一局（已经在跑的话先退掉） */
  start(game: MiniGame): void {
    if (this.game) this.stop(false);
    this.game = game;
    this.failing = false;
    this.layer.classList.remove('hidden');
    this.titleEl.textContent = t(game.titleKey);

    try {
      game.mount(this.context());
    } catch (error) {
      this.fail(error);
      return;
    }

    // 转场：先压全黑，强制一次重排让浏览器记住"黑色"这个起点，再淡出
    this.fade.classList.add('show');
    void this.fade.offsetWidth;
    this.fade.classList.remove('show');
  }

  /** 每帧调用（主循环在小游戏激活时只调这里） */
  update(dt: number): void {
    const game = this.game;
    if (!game || this.failing) return;

    // 主世界那一套 render 状态不一定适合小游戏：每帧重置一次，
    // 游戏自己只管 `render(scene, camera)`，不必关心上一次是谁改的 autoClear
    const renderer = this.options.renderer;
    renderer.autoClear = true;
    renderer.setScissorTest(false);

    try {
      game.update(Math.min(0.1, Math.max(0, dt)));
    } catch (error) {
      this.fail(error);
    }
  }

  /** 退出（按钮 / Esc / 异常三条路共用；重复调用是空操作） */
  stop(notify = true): void {
    const game = this.game;
    if (!game) return;
    this.game = null;
    this.failing = false;

    try {
      game.unmount();
    } catch (error) {
      // 卸载失败也要继续往下走：层必须收掉，否则玩家卡在一个死界面上
      console.error('[minigame] unmount 失败', error);
    }

    this.stage.replaceChildren();
    this.toastEl.classList.add('hidden');
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.layer.classList.add('hidden');

    if (notify) this.options.onExit();
  }

  /** 顶部一句话提示（1.6 秒后自己消失） */
  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.add('hidden');
      this.toastTimer = null;
    }, 1600);
  }

  dispose(): void {
    this.stop(false);
    this.layer.remove();
  }

  // ---------------------------------------------------------------- 内部

  private context(): MiniGameContext {
    return {
      renderer: this.options.renderer,
      atlas: this.options.atlas,
      layer: this.stage,
      exit: () => this.stop(),
      toast: (text) => this.toast(text),
    };
  }

  private fail(error: unknown): void {
    if (this.failing) return;
    this.failing = true;
    console.error('[minigame] 运行出错，已退出', error);
    this.toast(t('minigame.crashed'));
    // 停 600ms 再退：否则玩家只看到界面闪一下，不知道发生了什么
    window.setTimeout(() => this.stop(), 600);
  }

  private bindPointer(): void {
    const send = (type: MiniGamePointer['type'], event: PointerEvent): void => {
      const game = this.game;
      if (!game || this.failing) return;
      const rect = this.stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      try {
        game.onPointer({
          type,
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        });
      } catch (error) {
        this.fail(error);
      }
    };

    this.stage.addEventListener('pointerdown', (event) => {
      // 触摸端要抓住这一根手指，否则滑出 layer 就收不到 up（项目里踩过同类坑）
      try {
        this.stage.setPointerCapture(event.pointerId);
      } catch {
        // 指针已失效时直接调用会抛错：忽略即可，up 仍有 pointercancel 兜底
      }
      send('down', event);
    });
    this.stage.addEventListener('pointermove', (event) => send('move', event));
    this.stage.addEventListener('pointerup', (event) => send('up', event));
    this.stage.addEventListener('pointercancel', (event) => send('up', event));
  }
}
