/**
 * 生命 / 饥饿 / 氧气 / 护甲 HUD
 *
 * 用内联 SVG 画图标（而不是贴图图集）：这几个图标需要"整 / 半 / 空"三态，
 * 用 SVG 的填色 + clip 表达最直接，也能跟着 CSS 缩放适配手机。
 *
 * 只在数值变化时重建一次状态，避免每帧操作 DOM。
 */

import { MAX_AIR, MAX_HEALTH, type PlayerStats } from '../core/survival/PlayerStats.ts';
/*
 * 图标形状、色值、三态判据都从 `ui2d/vitalsArt.ts` 来 —— canvas 版
 * （`ui2d/Vitals2D.ts`）与这里画的是同一组图标，抄两份必然漂（见该文件头）。
 */
import {
  ARMOR_PATH,
  ARMOR_PER_ICON,
  BUBBLE,
  FOOD_PATH,
  HEART_PATH,
  VITAL_COLORS,
  bubbleIconState,
  vitalIconState,
} from '../ui2d/vitalsArt.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 半颗心 / 半只鸡腿的裁剪（只显示左半边） */
const HALF_CLIP_ID = 'vitals-half-clip';

interface IconState {
  readonly foreground: SVGElement;
}

function createSvg(viewBox = '0 0 9 9'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', 'vital-icon');
  return svg;
}

function createPath(d: string, fill: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', fill);
  return path;
}

/** 应用"整 / 半 / 空"三态 */
function applyState(icon: IconState, state: 'full' | 'half' | 'empty'): void {
  if (state === 'empty') {
    icon.foreground.style.display = 'none';
    return;
  }
  icon.foreground.style.display = '';
  if (state === 'half') icon.foreground.setAttribute('clip-path', `url(#${HALF_CLIP_ID})`);
  else icon.foreground.removeAttribute('clip-path');
}

export class VitalsHud {
  private readonly hearts: IconState[] = [];
  private readonly foods: IconState[] = [];
  private readonly bubbles: IconState[] = [];
  private readonly armors: IconState[] = [];
  private readonly airRow: HTMLElement;
  private readonly armorRow: HTMLElement;
  private lastKey = '';

  constructor(private readonly container: HTMLElement) {
    // 批次 183：退出世界再进入时会 new 一个实例，而 `#vitals` 是**静态容器**。
    // 不先清掉上一个实例挂的行，血条/饥饿/护甲会叠成两三套（真机日志里的"双血条"）。
    container.replaceChildren();
    // 半颗心的裁剪定义只放一份，所有图标共用
    const defs = createSvg();
    defs.setAttribute('class', 'vital-defs');
    defs.innerHTML = `<defs><clipPath id="${HALF_CLIP_ID}"><rect x="0" y="0" width="4.5" height="9"/></clipPath></defs>`;
    container.append(defs);

    this.airRow = document.createElement('div');
    this.airRow.className = 'vital-row';
    this.airRow.id = 'vital-air';

    this.armorRow = document.createElement('div');
    this.armorRow.className = 'vital-row';
    this.armorRow.id = 'vital-armor';

    const healthRow = document.createElement('div');
    healthRow.className = 'vital-row';
    healthRow.id = 'vital-health';

    const foodRow = document.createElement('div');
    foodRow.className = 'vital-row';
    foodRow.id = 'vital-food';

    const iconCount = MAX_HEALTH / 2;
    for (let i = 0; i < iconCount; i++) {
      const svg = createSvg();
      svg.append(createPath(HEART_PATH, VITAL_COLORS.heartEmpty));
      const fg = createPath(HEART_PATH, VITAL_COLORS.heart);
      svg.append(fg);
      healthRow.append(svg);
      this.hearts.push({ foreground: fg });

      const foodSvg = createSvg();
      foodSvg.append(createPath(FOOD_PATH, VITAL_COLORS.foodEmpty));
      const foodFg = createPath(FOOD_PATH, VITAL_COLORS.food);
      foodSvg.append(foodFg);
      foodRow.append(foodSvg);
      this.foods.push({ foreground: foodFg });

      const armorSvg = createSvg();
      armorSvg.append(createPath(ARMOR_PATH, VITAL_COLORS.armorEmpty));
      const armorFg = createPath(ARMOR_PATH, VITAL_COLORS.armor);
      armorSvg.append(armorFg);
      this.armorRow.append(armorSvg);
      this.armors.push({ foreground: armorFg });
    }

    for (let i = 0; i < 10; i++) {
      const svg = createSvg();
      const bg = document.createElementNS(SVG_NS, 'circle');
      bg.setAttribute('cx', String(BUBBLE.cx));
      bg.setAttribute('cy', String(BUBBLE.cy));
      bg.setAttribute('r', String(BUBBLE.r));
      bg.setAttribute('fill', 'none');
      bg.setAttribute('stroke', VITAL_COLORS.heartEmpty);
      bg.setAttribute('stroke-width', String(BUBBLE.strokeWidth));
      const fg = document.createElementNS(SVG_NS, 'circle');
      fg.setAttribute('cx', String(BUBBLE.cx));
      fg.setAttribute('cy', String(BUBBLE.cy));
      fg.setAttribute('r', String(BUBBLE.r));
      fg.setAttribute('fill', VITAL_COLORS.air);
      svg.append(bg, fg);
      this.airRow.append(svg);
      this.bubbles.push({ foreground: fg });
    }

    // 批次 222（用户："生命值和饥饿值放在快捷栏的两端，不要挡住进度按钮"）：
    // 左列＝护甲 + 生命，右列＝气泡 + 饥饿；两列底边对齐，中间整块留给经验条。
    // 顺序就是 DOM 顺序：护甲在心上、气泡在鸡腿上（与原版一致）。
    const leftSide = document.createElement('div');
    leftSide.className = 'vital-side left';
    const rightSide = document.createElement('div');
    rightSide.className = 'vital-side right';
    leftSide.append(this.armorRow, healthRow);
    rightSide.append(this.airRow, foodRow);
    container.append(leftSide, rightSide);
  }

  /** 拆局：把这一套行从静态容器里摘掉 */
  dispose(): void {
    this.container.replaceChildren();
    this.container.classList.remove('low-health', 'creative-mode');
    this.lastKey = '';
  }

  /**
   * @param creative 创造模式：原版不显示生命 / 饥饿 / 护甲 / 氧气（它们对玩家没有信息量，
   *   手机上还占着快捷栏上方的空间），整条收起交给 CSS
   */
  update(stats: PlayerStats, creative = false): void {
    const armorPoints = stats.armorPoints;
    // ⚠️ creative 必须进 key：切模式时各项数值不变，漏了它就会 early return，类名永远不更新
    const key = `${stats.health}|${stats.food}|${stats.air}|${stats.dead}|${armorPoints}|${creative}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.container.classList.toggle('creative-mode', creative);

    for (let i = 0; i < this.hearts.length; i++) {
      applyState(this.hearts[i]!, vitalIconState(stats.health - i * 2));
    }
    for (let i = 0; i < this.foods.length; i++) {
      applyState(this.foods[i]!, vitalIconState(stats.food - i * 2));
    }

    // 护甲条只在穿着盔甲时出现；一点护甲值 = 半颗图标（与原版的半片甲一致）
    this.armorRow.classList.toggle('on', armorPoints > 0);
    if (armorPoints > 0) {
      for (let i = 0; i < this.armors.length; i++) {
        applyState(this.armors[i]!, vitalIconState(armorPoints - i * ARMOR_PER_ICON));
      }
    }

    // 低血量脉冲（批次 28）：血量掉到 4 点（两颗心）以下时整条状态栏自己"跳"起来，
    // 提醒玩家该退了——原来只有数字变小，战斗中很容易没注意到。
    // 创造模式不给脉冲：切进去时常常带着残血，而血条已经藏起来了（批次 230）
    this.container.classList.toggle('low-health', !creative && !stats.dead && stats.health > 0 && stats.health <= 4);

    // 氧气条只在没吸满时出现（与原版一致）
    const showAir = stats.air < MAX_AIR;
    this.airRow.classList.toggle('on', showAir);
    if (showAir) {
      const perBubble = MAX_AIR / this.bubbles.length;
      for (let i = 0; i < this.bubbles.length; i++) {
        applyState(this.bubbles[i]!, bubbleIconState(stats.air - i * perBubble, perBubble));
      }
    }
  }
}
