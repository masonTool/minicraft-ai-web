/**
 * 生命 / 饥饿 / 氧气 / 护甲 HUD
 *
 * 用内联 SVG 画图标（而不是贴图图集）：这几个图标需要"整 / 半 / 空"三态，
 * 用 SVG 的填色 + clip 表达最直接，也能跟着 CSS 缩放适配手机。
 *
 * 只在数值变化时重建一次状态，避免每帧操作 DOM。
 */

import { MAX_AIR, MAX_HEALTH, type PlayerStats } from '../core/survival/PlayerStats.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 9×9 坐标下的心形 */
const HEART_PATH =
  'M4.5 8 C4.5 8 1 5.4 1 3.4 C1 2 2.1 1 3.4 1 C4 1 4.5 1.3 4.5 1.6 C4.5 1.3 5 1 5.6 1 C6.9 1 8 2 8 3.4 C8 5.4 4.5 8 4.5 8 Z';
/** 鸡腿（饥饿） */
const FOOD_PATH =
  'M6.4 1.1 A2.9 2.9 0 1 0 3.2 5.6 L1.5 7.3 a1.2 1.2 0 1 0 1.7 1.7 L4.9 7.3 A2.9 2.9 0 0 0 6.4 1.1 Z';
/** 护甲片（胸甲：顶部中间留出领口） */
const ARMOR_PATH = 'M1 1.5 H3.5 V3 H5.5 V1.5 H8 V7.5 H1 Z';

const EMPTY_COLOR = '#3a1414';
const HEALTH_COLOR = '#e03b3b';
const FOOD_EMPTY_COLOR = '#33281a';
const FOOD_COLOR = '#b1742f';
const AIR_COLOR = '#9fd8ff';
const ARMOR_EMPTY_COLOR = '#2c3138';
const ARMOR_COLOR = '#dfe2ea';

/** 一颗护甲图标代表 2 点护甲值（满护甲 20 点 = 10 颗，与 10 颗心同宽） */
const ARMOR_PER_ICON = 2;

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

function stateOf(value: number): 'full' | 'half' | 'empty' {
  return value >= 2 ? 'full' : value >= 1 ? 'half' : 'empty';
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
      svg.append(createPath(HEART_PATH, EMPTY_COLOR));
      const fg = createPath(HEART_PATH, HEALTH_COLOR);
      svg.append(fg);
      healthRow.append(svg);
      this.hearts.push({ foreground: fg });

      const foodSvg = createSvg();
      foodSvg.append(createPath(FOOD_PATH, FOOD_EMPTY_COLOR));
      const foodFg = createPath(FOOD_PATH, FOOD_COLOR);
      foodSvg.append(foodFg);
      foodRow.append(foodSvg);
      this.foods.push({ foreground: foodFg });

      const armorSvg = createSvg();
      armorSvg.append(createPath(ARMOR_PATH, ARMOR_EMPTY_COLOR));
      const armorFg = createPath(ARMOR_PATH, ARMOR_COLOR);
      armorSvg.append(armorFg);
      this.armorRow.append(armorSvg);
      this.armors.push({ foreground: armorFg });
    }

    for (let i = 0; i < 10; i++) {
      const svg = createSvg();
      const bg = document.createElementNS(SVG_NS, 'circle');
      bg.setAttribute('cx', '4.5');
      bg.setAttribute('cy', '4.5');
      bg.setAttribute('r', '3.6');
      bg.setAttribute('fill', 'none');
      bg.setAttribute('stroke', EMPTY_COLOR);
      bg.setAttribute('stroke-width', '1.2');
      const fg = document.createElementNS(SVG_NS, 'circle');
      fg.setAttribute('cx', '4.5');
      fg.setAttribute('cy', '4.5');
      fg.setAttribute('r', '3.6');
      fg.setAttribute('fill', AIR_COLOR);
      svg.append(bg, fg);
      this.airRow.append(svg);
      this.bubbles.push({ foreground: fg });
    }

    container.append(this.airRow, this.armorRow, healthRow, foodRow);
  }

  /** 拆局：把这一套行从静态容器里摘掉 */
  dispose(): void {
    this.container.replaceChildren();
    this.container.classList.remove('low-health');
    this.lastKey = '';
  }

  update(stats: PlayerStats): void {
    const armorPoints = stats.armorPoints;
    const key = `${stats.health}|${stats.food}|${stats.air}|${stats.dead}|${armorPoints}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    for (let i = 0; i < this.hearts.length; i++) {
      applyState(this.hearts[i]!, stateOf(stats.health - i * 2));
    }
    for (let i = 0; i < this.foods.length; i++) {
      applyState(this.foods[i]!, stateOf(stats.food - i * 2));
    }

    // 护甲条只在穿着盔甲时出现；一点护甲值 = 半颗图标（与原版的半片甲一致）
    this.armorRow.classList.toggle('on', armorPoints > 0);
    if (armorPoints > 0) {
      for (let i = 0; i < this.armors.length; i++) {
        applyState(this.armors[i]!, stateOf(armorPoints - i * ARMOR_PER_ICON));
      }
    }

    // 低血量脉冲（批次 28）：血量掉到 4 点（两颗心）以下时整条状态栏自己"跳"起来，
    // 提醒玩家该退了——原来只有数字变小，战斗中很容易没注意到
    this.container.classList.toggle('low-health', !stats.dead && stats.health > 0 && stats.health <= 4);

    // 氧气条只在没吸满时出现（与原版一致）
    const showAir = stats.air < MAX_AIR;
    this.airRow.classList.toggle('on', showAir);
    if (showAir) {
      const perBubble = MAX_AIR / this.bubbles.length;
      for (let i = 0; i < this.bubbles.length; i++) {
        const value = stats.air - i * perBubble;
        const state = value >= perBubble ? 'full' : value > 0 ? 'half' : 'empty';
        applyState(this.bubbles[i]!, state);
      }
    }
  }
}
