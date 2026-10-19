/**
 * 生物头顶信息条（批次 277，替代原来的 `MobOutline` 光环）
 *
 * 用户："别展示头顶圈儿了，直接展示生命条吧。如果遇到主动攻击的怪物，
 * 也可以展示一些它的攻击力、防御之类的信息，在角色顶部以条的形式显示。"
 *
 * 做法：一张 CanvasTexture + `THREE.Sprite`（永远面向相机）：
 *  - 名字（敌对偏红、被动偏青）；
 *  - 生命条（红/黄/绿按比例变色）+ 当前/上限；
 *  - 敌对生物多两行小条：**攻击力**与**警戒范围**（两个都是 `MobType` 里真实存在的数值）。
 *
 * ⚠️ 为什么没有"防御"：本项目的生物**没有护甲/防御属性**，伤害在 `Mob.hurt` 里直接扣血。
 * 硬画一条防御条只能是假数据，所以这里展示两个真实可用的项；以后真加了护甲机制，
 * 在 `drawFace` 里多一行即可。
 *
 * 性能：Canvas 只在"目标或血量变化"时重画（换目标、挨打），每帧只更新 Sprite 的
 * 位置与缩放；不会跟着渲染帧重绘文字。
 */

import * as THREE from 'three';
import type { Mob } from '../core/entity/Mob.ts';

/** 画布尺寸（像素）：文字用 18px/13px，256 宽在 1.2~3.2 格的世界尺寸下足够清楚 */
const CANVAS_W = 256;
const CANVAS_H = 96;
/** 条的世界宽度（格）：按生物宽度放大，但夹在 1.2~3.2 之间 */
const BAR_MIN_WIDTH = 1.2;
const BAR_MAX_WIDTH = 3.2;
/** 条离头顶的高度（格） */
const BAR_LIFT = 0.14;
/** 敌对生物额外两条小条的最大值（归一化用）：攻击 10 点、警戒 35 格 */
const ATTACK_MAX = 10;
const FOLLOW_MAX = 35;

const COLORS = {
  panel: 'rgba(12, 16, 20, 0.72)',
  panelBorder: 'rgba(255, 255, 255, 0.18)',
  nameHostile: '#ffb0a4',
  namePassive: '#d8f6ff',
  hpTrack: 'rgba(0, 0, 0, 0.55)',
  hpRed: '#e14b4b',
  hpYellow: '#e3b341',
  hpGreen: '#5fbf6a',
  text: '#f2fbff',
  muted: 'rgba(242, 251, 255, 0.72)',
  attack: '#f0a04b',
  follow: '#79b8e8',
};

export class MobInfoBar {
  readonly object: THREE.Sprite;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  /** 上一次画的关键字（换目标 / 掉血才重画） */
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

  /** 套在某只生物身上（每帧调一次：生物会走；内容只在变化时重画） */
  show(mob: Mob): void {
    const width = Math.min(BAR_MAX_WIDTH, Math.max(BAR_MIN_WIDTH, mob.width * 1.6));
    const height = width * (CANVAS_H / CANVAS_W);
    this.object.scale.set(width, height, 1);
    this.object.position.set(mob.x, mob.y + mob.height + BAR_LIFT + height / 2, mob.z);

    const health = Math.max(0, Math.ceil(mob.health));
    const maxHealth = Math.max(1, Math.ceil(mob.type.health));
    const key = `${mob.id}|${mob.type.id}|${health}|${maxHealth}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.drawFace(mob, health, maxHealth);
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

  private drawFace(mob: Mob, health: number, maxHealth: number): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // 面板：圆角 + 细描边，压住背后的草地/雪地
    roundRect(ctx, 1, 1, CANVAS_W - 2, CANVAS_H - 2, 10);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.strokeStyle = COLORS.panelBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    const hostile = mob.type.hostile;
    // 名字
    ctx.font = 'bold 18px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = hostile ? COLORS.nameHostile : COLORS.namePassive;
    ctx.fillText(mob.type.name, 12, 19);

    // 生命条
    const hpY = 34;
    const hpH = 11;
    const hpX = 36;
    // 右侧留 56px 给数值，条不要压到文字下面
    const hpW = CANVAS_W - 56 - hpX;
    bar(ctx, hpX, hpY, hpW, hpH, health / maxHealth, healthColor(health / maxHealth));
    ctx.font = 'bold 13px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    ctx.fillText(`${health}/${maxHealth}`, CANVAS_W - 12, hpY + hpH / 2 + 1);

    // 左列小标签：与条对齐
    smallLabel(ctx, '生命', 12, hpY + hpH / 2);

    if (!hostile) {
      this.texture.needsUpdate = true;
      return;
    }

    // 敌对：攻击力 / 警戒范围（都是真实数据）
    const atk = Math.max(0, mob.type.attackDamage);
    const follow = Math.max(0, mob.type.followRange);
    const rowY = 58;
    const rowGap = 19;
    smallLabel(ctx, '攻击', 12, rowY + 4);
    bar(ctx, hpX, rowY, hpW, 8, atk / ATTACK_MAX, COLORS.attack);
    ctx.font = '12px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${atk.toFixed(1)}`, CANVAS_W - 12, rowY + 4);

    smallLabel(ctx, '警戒', 12, rowY + rowGap + 4);
    bar(ctx, hpX, rowY + rowGap, hpW, 8, follow / FOLLOW_MAX, COLORS.follow);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(follow)}格`, CANVAS_W - 12, rowY + rowGap + 4);

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

/** 一条带底槽的进度条：底色深、填充按比例 */
function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  ratio: number,
  color: string,
): void {
  const clamped = Math.max(0, Math.min(1, ratio));
  roundRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = COLORS.hpTrack;
  ctx.fill();
  if (clamped <= 0) return;
  // 最小留一点圆角宽度，血量极低时也看得见"还有一丝"
  const filled = Math.max(height, width * clamped);
  roundRect(ctx, x, y, filled, height, height / 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** 血量比例 → 颜色：>50% 绿、>25% 黄、否则红（与原版血量条的直觉一致） */
function healthColor(ratio: number): string {
  if (ratio > 0.5) return COLORS.hpGreen;
  if (ratio > 0.25) return COLORS.hpYellow;
  return COLORS.hpRed;
}

/** 左侧的小字标签（生命 / 攻击 / 警戒） */
function smallLabel(ctx: CanvasRenderingContext2D, text: string, x: number, centerY: number): void {
  ctx.font = 'bold 12px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText(text, x, centerY + 1);
}
