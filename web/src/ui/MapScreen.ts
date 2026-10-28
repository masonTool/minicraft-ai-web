/**
 * 地图阅读界面（批次 196，H16）
 *
 * 一块 `<canvas>` 把 32×32 的区块位图画出来，再叠三个标记：
 *  - **绿色地块** = 去过的区块（色相按格子下标做一点抖动，免得整片一个色）；
 *  - **中心 ✦** = 这张图绑定的位置（第一次用空地图的地方）；
 *  - **红色三角** = 玩家自己，尖端朝向你面朝的方向（-Z 是地图上方 = 北）。
 *
 * 三处与本项目其它面板一致的做法：
 *  1. 挂在 `<body>` 上（与告示牌、书一样），层叠层 12；
 *  2. 不自己动输入权——`onClose` 交给主程序的 `handleInventoryOpen(false)`；
 *  3. **只画、不改数据**：数据由主程序在"走到新区域"时写回物品，
 *     所以打开地图期间地图不会变（也就不会出现"看着看着自己长出一块"的怪事）。
 */

import { t } from '../core/i18n/I18n.ts';
import { MAP_GRID, exploredCount, isExplored, mapOffset, mapSpanOf, type MapData } from '../core/items/Map.ts';

/** 画布内部边长（CSS 会把它缩到面板上；固定值让绘制逻辑与屏幕无关） */
const CANVAS_SIZE = 320;
const CELL = CANVAS_SIZE / MAP_GRID;

export class MapScreen {
  readonly root: HTMLDivElement;

  /** 关闭时回调（主程序用它把输入权交回去） */
  onClose: (() => void) | null = null;

  private readonly titleEl: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly footerEl: HTMLDivElement;
  private readonly context: CanvasRenderingContext2D | null;
  private open = false;

  constructor(host: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'map-screen';
    this.root.className = 'map-screen hidden';

    const panel = document.createElement('div');
    panel.className = 'map-panel';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'map-title';

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.canvas.className = 'map-canvas';
    this.context = this.canvas.getContext('2d');

    this.footerEl = document.createElement('div');
    this.footerEl.className = 'map-footer';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'map-button';
    closeButton.textContent = t('map.close');
    closeButton.addEventListener('click', () => this.close());

    panel.append(this.titleEl, this.canvas, this.footerEl, closeButton);
    this.root.appendChild(panel);
    host.appendChild(this.root);

    // Esc 只收自己这一层（stopPropagation：否则主程序那条会跟着打开暂停菜单）
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * 打开一张地图。
   *
   * @param player 玩家的世界坐标与朝向（朝向只用来转那个红色三角）
   */
  show(map: MapData, player: { x: number; z: number; yaw: number }, title = t('map.title')): void {
    this.titleEl.textContent = title;
    this.draw(map, player);
    const explored = exploredCount(map);
    // 批次 505：一格覆盖多少方块随缩放翻倍（scale 0 = 1 区块、1 = 2、2 = 4）
    const chunksPerCell = 1 << map.scale;
    const lockText = map.locked ? t('map.locked') : '';
    this.footerEl.textContent =
      `探索 ${explored} / ${MAP_GRID * MAP_GRID} 格（${Math.round((explored / (MAP_GRID * MAP_GRID)) * 100)}%）` +
      ` · 1 格 = ${chunksPerCell} 个区块 · 北在上${lockText}`;
    this.open = true;
    this.root.classList.remove('hidden');
    this.root.tabIndex = -1;
    this.root.focus();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  dispose(): void {
    this.root.remove();
  }

  private draw(map: MapData, player: { x: number; z: number; yaw: number }): void {
    const ctx = this.context;
    if (!ctx) return;

    // 底：未探索的羊皮纸色
    ctx.fillStyle = '#cbbd9c';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // 缩放（批次 505）：一格覆盖的方块数随 scale 翻倍，画格子与玩家位置都要用它
    const span = mapSpanOf(map);

    // 已探索的格子：绿色 + 按下标做一点色相抖动（同一片不会看起来像一块塑料板）
    for (let cz = 0; cz < MAP_GRID; cz++) {
      for (let cx = 0; cx < MAP_GRID; cx++) {
        // 取"这一格的左上角"去问位图：`isExplored` 自己会按区块取整，
        // 所以这里不需要再关心半格偏移
        const worldX = map.originX + (cx - MAP_GRID / 2) * span;
        const worldZ = map.originZ + (cz - MAP_GRID / 2) * span;
        if (!isExplored(map, worldX, worldZ)) continue;
        const tint = ((cx * 7 + cz * 13) % 5) * 6;
        ctx.fillStyle = `rgb(${96 + tint}, ${140 + tint}, ${72 + tint})`;
        ctx.fillRect(cx * CELL, cz * CELL, CELL, CELL);
      }
    }

    // 细网格：只在探索过的区域上画淡线，否则整张图会像方格纸
    ctx.strokeStyle = 'rgba(60, 50, 30, .12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < MAP_GRID; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, CANVAS_SIZE);
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(CANVAS_SIZE, i * CELL);
      ctx.stroke();
    }

    // 中心 ✦
    const center = (MAP_GRID / 2) * CELL;
    ctx.fillStyle = 'rgba(70, 55, 30, .85)';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦', center, center);

    // 玩家：红三角，尖端朝前
    const offset = mapOffset(map, player.x, player.z);
    const px = center + (offset.dx / span) * CELL;
    const pz = center + (offset.dz / span) * CELL;
    if (px > -CELL && px < CANVAS_SIZE + CELL && pz > -CELL && pz < CANVAS_SIZE + CELL) {
      ctx.save();
      ctx.translate(px, pz);
      // 朝向约定：forward = (-sin yaw, -cos yaw)；地图上 +Z 朝下，所以旋转 -yaw
      ctx.rotate(-player.yaw);
      ctx.fillStyle = '#d0342c';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    // 边框
    ctx.strokeStyle = 'rgba(60, 45, 25, .9)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, CANVAS_SIZE - 4, CANVAS_SIZE - 4);
  }
}

