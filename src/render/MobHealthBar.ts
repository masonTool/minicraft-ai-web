/**
 * 生物头顶生命条（批次 280）
 *
 * 取代批次 277 的"信息面板"：用户反馈"太重了，就普通的一条就行"，
 * 而且名字/攻击来自**目标**，被僵尸偷袭时如果准星恰好锁着旁边的猫，
 * 会显示成"猫、攻击 0"，看起来像数据错了。现在只画一条生命，不再有文字：
 * 谁头顶上的条归谁，不会再把另一只生物的名字带过来。
 *
 * 做法：一张固定尺寸的 CanvasTexture + `THREE.Sprite`（永远面向相机）。
 * ⚠️ 画布尺寸**固定**，不再按敌对/被动切换高度：批次 277 在运行中改
 * `canvas.height` 后，部分 WebGL 实现会继续显示旧尺寸的纹理（表现为
 * "僵尸头顶挂着猫的条"）。固定尺寸从根上避开这个坑。
 *
 * 性能：只在血量变化时重画（`ceil(health)`），每帧只更新 Sprite 的位置/缩放。
 */

import * as THREE from 'three';
import type { Mob } from '../core/entity/Mob.ts';

/** 画布尺寸（固定）：40px 高、中间 24px 是条，读起来刚好 */
const CANVAS_W = 256;
const CANVAS_H = 40;
/** 条的世界宽度（格）：按生物宽度放大，但夹住，别挡住身体/半个屏幕 */
const BAR_MIN_WIDTH = 1.1;
const BAR_MAX_WIDTH = 2.4;
/** 条离头顶的高度（格） */
const BAR_LIFT = 0.12;

const COLORS = {
  track: 'rgba(10, 12, 14, 0.78)',
  outline: 'rgba(255, 255, 255, 0.42)',
  fill: '#d94b4b',
  fillLow: '#8f2f2f',
  shine: 'rgba(255, 255, 255, 0.18)',
};

export class MobHealthBar {
  readonly object: THREE.Sprite;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  /** 上一次画的血量（只在这两个数变化时重画） */
  private lastKey = '';

  /**
   * @param canvas 只为离线测试注入一个假画布；浏览器里不传，默认自己建一个。
   */
  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('无法获取 2D 绘图上下文');
    this.context = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    // Sprite 走 three 的内置材质：标成 sRGB，颜色不会被再做一次线性化
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    const material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this.object = new THREE.Sprite(material);
    this.object.visible = false;
    // 半透明层在主场景之后画：renderOrder 提高一点，避免被水/玻璃的排序盖住
    this.object.renderOrder = 3;
  }

  /** 套在某只生物身上（每帧调一次：生物会走；只有血量变化才重画画布） */
  show(mob: Mob): void {
    const width = Math.min(BAR_MAX_WIDTH, Math.max(BAR_MIN_WIDTH, mob.width * 1.6));
    const height = width * (CANVAS_H / CANVAS_W);
    this.object.scale.set(width, height, 1);
    this.object.position.set(mob.x, mob.y + mob.height + BAR_LIFT + height / 2, mob.z);

    const health = Math.max(0, Math.ceil(mob.health));
    const maxHealth = Math.max(1, Math.ceil(mob.type.health));
    const key = `${health}|${maxHealth}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.drawFace(health / maxHealth);
    }
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.texture.dispose();
    (this.object.material as THREE.Material).dispose();
  }

  private drawFace(ratio: number): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const x = 2;
    const y = 8;
    const width = CANVAS_W - 4;
    const height = 24;
    const radius = height / 2;

    // 底槽 + 描边：不用面板，只靠一圈深色/浅色边把条从草地/雪地里分出来
    roundRect(ctx, x, y, width, height, radius);
    ctx.fillStyle = COLORS.track;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.outline;
    ctx.stroke();

    const clamped = Math.max(0, Math.min(1, ratio));
    if (clamped > 0) {
      // 留 3px 内边距，条不会贴到描边上
      const innerX = x + 3;
      const innerY = y + 3;
      const innerW = width - 6;
      const innerH = height - 6;
      // 血量很低时颜色更暗：不给数字，也能靠颜色看出"快死了"
      const fill = clamped <= 0.25 ? COLORS.fillLow : COLORS.fill;
      roundRect(ctx, innerX, innerY, Math.max(innerH, innerW * clamped), innerH, innerH / 2);
      ctx.fillStyle = fill;
      ctx.fill();
      // 顶部一条很淡的高光：像素风里也有一点体积感
      ctx.fillStyle = COLORS.shine;
      ctx.fillRect(innerX + innerH / 2, innerY + 2, Math.max(0, innerW * clamped - innerH), 2);
    }

    this.texture.needsUpdate = true;
  }
}

/** 圆角矩形路径（不用 `ctx.roundRect`：老 WebView 不一定有） */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
