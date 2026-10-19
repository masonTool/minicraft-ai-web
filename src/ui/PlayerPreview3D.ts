/**
 * 背包里的**可旋转 3D 角色预览**（批次 185，替代原来的 2D 剪影）
 *
 * 用户："点开背包展示角色的时候，这个角色是一个纯平面的，我没有办法让他转一圈、
 * 装个披风 / 装个盾牌。"
 *
 * 做法：复用第三人称那个方块小人（`PlayerRenderer`），给它单独一个场景、
 * 一个透视相机和一块小 WebGL 画布——
 *  - 不碰主世界场景（预览随背包开合，不该出现在世界里）；
 *  - 只渲染一个小人（约 15 个 draw call），掉帧风险可以忽略；
 *  - 拖动画布改 `yaw` 就能转一圈；披风/副手由 `PlayerRenderer` 的两个开关控制。
 *
 * 画布就是原来那张 `.inv-player-preview`（宽高由 CSS 给，48×100 / 盔甲页 72×148）。
 * 为什么不用 RenderTarget 塞进主画布：预览是一块独立 UI，走独立上下文
 * 不会让背包开合牵扯主渲染循环，也方便以后做"角色创建"实时预览。
 *
 * ⚠️ 一个 canvas 一旦拿过 2d 上下文就再也拿不到 webgl；所以调用方必须**先试 3D、
 * 失败再退回 2D 剪影**（见 `InventoryScreen.refreshPlayerPreview`）。
 */

import * as THREE from 'three';
import { PlayerRenderer } from '../render/PlayerRenderer.ts';
import type { AppearancePalette } from '../game/appearance.ts';

export class PlayerPreview3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly model: PlayerRenderer;
  /** 绕 Y 轴的旋转（拖动画布累加）；默认正面偏 25°（脸朝相机，带一点侧面） */
  private yaw = Math.PI - 0.45;
  private cape = false;
  private offhand = false;
  private armor: readonly (number | null)[] = [null, null, null, null];
  private palette: AppearancePalette | null = null;
  /**
   * 画布尺寸变化时自动补一帧（批次 272）。
   *
   * 盔甲页的预览比物品栏页大一号（CSS 改宽高），而切换页签只改布局、不一定会
   * 走到 `refresh()`。没有这个观察器时，画布会保留"隐藏时"那套后备尺寸，
   * 被 CSS 拉伸之后就是用户看到的"人扁了，拖一下才恢复"。
   */
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(30, 0.5, 0.1, 20);
    // 视点略高于腰、稍微俯视：小人 0~2 格高，留一点上下边距
    // 距离按"要装下 2.1 格高的小人"反算：2.36 / (2·tan15°) ≈ 4.4
    this.camera.position.set(0, 1.05, 4.4);
    this.camera.lookAt(0, 1.0, 0);
    this.model = new PlayerRenderer(this.scene, () => 1);
    this.model.setVisible(true);
    // 页签切换 / 转屏 / 面板尺寸变化都会改 CSS 尺寸，观察器负责补渲染
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(this.canvas);
    }
  }

  /** 当前朝向（弧度），验收脚本用 */
  get rotation(): number {
    return this.yaw;
  }

  /** 拖动：像素 → 弧度 */
  rotateBy(deltaX: number): void {
    this.yaw += deltaX * 0.02;
    this.render();
  }

  /** 装备 / 外观变化时调用；`armor` 是四个部位的平均色（null = 空槽） */
  update(
    armor: readonly (number | null)[],
    cape: boolean,
    offhand: boolean,
    palette: AppearancePalette | null = null,
  ): void {
    this.armor = armor;
    this.cape = cape;
    this.offhand = offhand;
    if (palette) this.palette = palette;
    this.render();
  }

  /** 按当前画布的 CSS 尺寸渲染一帧 */
  render(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    // 批次 272：面板隐藏时 clientWidth/Height 是 0。以前拿 24×48 兜底写进后备缓冲，
    // 于是"隐藏时渲染过"的那一帧会把画布变成 24×48，显示出来后就被 CSS 拉扁。
    // 隐藏期间直接不画，等 ResizeObserver / 切页后的显式 refresh 再补。
    if (width <= 0 || height <= 0) return;
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    // `false`：不动内联样式（尺寸归 CSS 管），只改后备缓冲
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // 画布很窄（盔甲页 56×118）：把相机往后拉一点，避免手臂被裁掉
    this.camera.position.z = 4.4 * Math.max(1, 0.62 / this.camera.aspect);
    this.camera.updateProjectionMatrix();

    // 外观（批次 187）：肤色 / 上衣 / 裤子；没传过就用模型出厂配色
    if (this.palette) this.model.setAppearance(this.palette);
    this.model.setArmor(this.armor);
    this.model.setCape(this.cape);
    this.model.setOffhand(this.offhand);
    this.model.update(
      {
        x: 0,
        y: 0,
        z: 0,
        yaw: this.yaw,
        pitch: 0,
        walkPhase: 0,
        walkAmount: 0,
        swing: 0,
        flying: false,
        sneaking: false,
      },
      // 预览不看世界光照：给一个恒定的"白天"，否则背包里的小人会黑掉
      () => ({ sky: 15, block: 0 }),
    );
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.model.dispose();
    this.renderer.dispose();
  }
}
