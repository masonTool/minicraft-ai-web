/**
 * 生物头顶的名字牌（批次 615，M23 的前置）
 *
 * 命名牌起过名字的生物，名字一直显示在头顶。
 *
 * 做法与生命条（`MobHealthBar.ts`，批次 280）**同一套**：一张固定尺寸的
 * CanvasTexture + `THREE.Sprite`（永远面向相机）。为什么不再造一套：
 * 批次 277 在这里踩过一个坑——运行中改 `canvas.height` 之后，部分 WebGL 实现
 * 会继续显示旧尺寸的纹理（表现为"僵尸头顶挂着猫的条"）。固定尺寸从根上避开它。
 * 名字牌也照这个规矩：**画布尺寸固定**，不同长度的名字靠 `drawText` 里按宽度
 * 自适应字号 + Sprite 的 `scale` 缩放，而不是改画布。
 *
 * 性能：只在名字或**颜色**变化时重画画布（`lastName` / `lastColor`），每帧只更新位置/缩放。
 *
 * ⚠️ 颜色也是判据的一部分（批次 616）：只比 `lastName` 的话，
 * 玩家 `/team modify red color blue` 之后名字还是红的，直到他改一次名字或重进世界。
 * 判据本身在 `NameTagColor#nameTagNeedsRedraw`，那边有断言盯着。
 */

import * as THREE from 'three';
import type { Mob } from '../core/entity/Mob.ts';
import { NAME_TAG_HEIGHT, nameTagWidthFor } from '../core/entity/NameTag.ts';
import { DEFAULT_NAME_COLOR, nameTagNeedsRedraw } from '../core/entity/NameTagColor.ts';

/**
 * 画布字体。
 *
 * 与界面同一族（`index.html` 里的 `--font-ui`）：名字牌是"世界里的文字"，
 * 用一套与界面无关的字体反而会让同一个名字在两处长得不一样。
 * 末尾的回退链照顾没有该字体的系统；中文靠系统默认中文字体接上。
 */
const NAME_FONT = '600 {size}px -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif';

/**
 * 画布尺寸：宽 512、高 64。
 *
 * 宽高比 8:1 对应 `nameTagWidthFor` 的典型比例（一次名字大约 3 格宽、0.26 格高）。
 * 极限长名字（32 字）在画布里会被缩到很小，此时靠 Sprite 的世界宽度上限兜住。
 */
const CANVAS_W = 512;
const CANVAS_H = 64;

const COLORS = {
  /** 半透明黑底：名字压在草地/雪地/水面上都要读得出来 */
  background: 'rgba(0, 0, 0, 0.55)',
  /** 描边：固定深色，不跟队伍色走（否则 gray / brown 这类深色队伍会糊成一片） */
  outline: '#1a1a1a',
};

export class MobNameTag {
  readonly object: THREE.Sprite;

  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  /** 上一次画的名字（与颜色一起决定要不要重画） */
  private lastName: string | null = null;
  /** 上一次画的颜色（`null` = 默认白） */
  private lastColor: string | null = null;

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('无法获取 2D 绘图上下文');
    this.context = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    // 与生命条一致：标成 sRGB，颜色不会被再做一次线性化
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
    this.object.renderOrder = 3;
  }

  /**
   * 把名字牌套在生物头顶。
   *
   * @param topLift 名字牌底边离生物头顶的高度（格）。生命条也要占位置，
   *   由调用方决定谁在上面——见主程序里两处 `show()` 的 `lift` 参数。
   * @param color 名字的颜色（`#rrggbb`），由 `NameTagColor#colorForMob` 算好传进来。
   *   传 `null` 表示"没有队伍" → 用默认白。**这里不查队伍**：
   *   渲染层不该知道 `Teams` 长什么样，否则同一条规则会在两个地方各写一遍。
   */
  show(mob: Mob, topLift: number, color: string | null = null): void {
    const name = mob.customName;
    if (!name) {
      this.hide();
      return;
    }

    const width = nameTagWidthFor(name);
    const height = NAME_TAG_HEIGHT;
    this.object.scale.set(width, height, 1);
    this.object.position.set(mob.x, mob.y + mob.height + topLift + height / 2, mob.z);

    const next = { name, color };
    if (nameTagNeedsRedraw({ name: this.lastName, color: this.lastColor }, next)) {
      this.lastName = name;
      this.lastColor = color;
      this.drawName(name, color);
    }
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  /**
   * 让下一帧一定重画画布。
   *
   * 与生命条 `invalidate()` 同一个理由：切后台回来时系统可能已把 2D 画布清空，
   * 而"只在名字变化时重画"会让它永远停在空白（看起来像"名字丢了"）。
   */
  invalidate(): void {
    this.lastName = null;
    this.lastColor = null;
  }

  dispose(): void {
    this.texture.dispose();
    (this.object.material as THREE.Material).dispose();
  }

  private drawName(name: string, color: string | null): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // 字号自适应：短名字给足字号，长名字缩到能塞进画布。
    // 用 `measureText` 而不是"按字数估"，因为中英混排宽度差一倍。
    const fontOf = (size: number) => NAME_FONT.replace('{size}', String(size));
    let fontSize = 40;
    ctx.font = fontOf(fontSize);
    const maxTextWidth = CANVAS_W - 24;
    const measured = ctx.measureText(name).width;
    if (measured > maxTextWidth) {
      fontSize = Math.max(18, Math.floor((fontSize * maxTextWidth) / measured));
      ctx.font = fontOf(fontSize);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 底：一块贴着文字的半透明黑条。宽度取实测宽度 + 内边距，
    // 这样"短名字不拖一条大白条、长名字也不会溢出画布"。
    const textWidth = Math.min(maxTextWidth, ctx.measureText(name).width);
    const paddingX = 14;
    const boxWidth = Math.min(CANVAS_W, textWidth + paddingX * 2);
    const boxHeight = Math.min(CANVAS_H, fontSize + 14);
    ctx.fillStyle = COLORS.background;
    roundRect(ctx, (CANVAS_W - boxWidth) / 2, (CANVAS_H - boxHeight) / 2, boxWidth, boxHeight, 8);
    ctx.fill();

    // 文字 + 深色描边：先描边再填字，笔画内侧不会被描边吃掉。
    // 描边颜色固定深色（不跟着队伍色走）：`gray` / `brown` 这类深色队伍
    // 如果拿自己的颜色描边，和黑底、和自己都会糊在一起。
    ctx.lineWidth = Math.max(2, Math.floor(fontSize / 8));
    ctx.strokeStyle = COLORS.outline;
    ctx.strokeText(name, CANVAS_W / 2, CANVAS_H / 2);
    ctx.fillStyle = color ?? DEFAULT_NAME_COLOR;
    ctx.fillText(name, CANVAS_W / 2, CANVAS_H / 2);
  }
}

/** 圆角矩形路径（与生命条同一份实现，它那边是私有的，这里不硬引） */
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
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
