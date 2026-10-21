import { Block } from '../core/registry/blocks.ts';
import { Item } from '../core/registry/items.ts';
import { Chest } from '../core/container/Chest.ts';
import { Furnace } from '../core/container/Furnace.ts';
import type { Inventory, SlotSource } from '../core/container/Inventory.ts';
import type { RayHit } from '../core/interaction/Raycast.ts';
import type { World } from '../core/world/World.ts';
import { quickMove } from '../core/container/QuickMove.ts';
import { UiLayer, box, button, MC, slot, text, type SlotButton, type UiElement } from './ui-kit/index.ts';
import { buildHotbarDock } from './inventory-tabs.ts';
import {
  BODY_PAD,
  CONTAINER_PANEL_NEED,
  DESIGN_WIDTH,
  DOCK_H,
  GRID_W,
  HEADER_H,
  PANEL_PAD,
  PANEL_W,
  SLOT_GAP,
  SLOT_SIZE,
  panelHeight,
} from './panel-metrics.ts';

/**
 * 容器格子在 `UiSlotNode.index` 里占的偏移。
 *
 * `UiSlotNode.index` 是**一个数字**，但同屏现在有两套格子（容器 0..26 / 背包 9..35），
 * 数字撞在一起分不清"从哪儿拖到哪儿"。给容器整段加一个偏移，
 * 拖拽回调就能按区间反推来源（背包 0~99 原样保留，与背包面板同一套）。
 */
const CONTAINER_NODE_BASE = 100;

export interface ContainerDeps {
  ui: UiLayer;
  uiHeight: number;
  getWorld(): World;
  inventory: Inventory;
  getSelectedSlot(): number;
  setSelectedSlot(index: number): void;
  showHud(): void;
  /** 点一格（与背包面板同一条唯一入口：短按左键、长按右键） */
  clickSlot(kind: 'inventory' | 'container', index: number, button: SlotButton): void;
  /** 拖拽换格 */
  dropSlot(
    from: { kind: 'inventory' | 'container'; index: number },
    to: { kind: 'inventory' | 'container'; index: number },
  ): void;
  /** 长按选数量（基岩版绿色指示条）；与背包面板同一条通道 */
  splitSlot(kind: 'inventory' | 'container', index: number, count: number): void;
  /** 面板底部那行提示（与背包面板同一套措辞，由 `index.ts` 提供） */
  getHint(): string;
  /** 容器已关闭（`opened` 已经是 null）——把光标上的东西收回背包、回到 HUD */
  onClosed(): void;
  /** 每次重画回写一份几何（验收脚本按它点击，不猜像素） */
  onGeo?(geo: ContainerGeo): void;
}

/** 容器面板的几何（`index.ts` 里给验收脚本读） */
export interface ContainerGeo {
  panelX: number;
  panelY: number;
  panelW: number;
  panelH: number;
  slotSize: number;
  /** 容器区左上角（第一个容器格） */
  containerX: number;
  containerY: number;
  /** 玩家 27 格左上角 */
  inventoryX: number;
  inventoryY: number;
  /** 容器格数（箱子 27 / 熔炉 3） */
  containerSize: number;
  /** 是否熔炉（产物槽在 2 号、只取不放） */
  furnace: boolean;
}

/**
 * 容器界面（箱子 / 熔炉）—— **与背包共用同一副壳**。
 *
 * 参照外部端 `InventoryScreen`：所有模式共用一块面板，
 * **上方区域随容器切换、下方永远是玩家自己的 27 格 + 底部 dock 快捷栏**。
 *
 * ⚠️ 这里之前是**孤立的小窗**（620×390、28px"箱子"大字、自己再画一行快捷栏），
 * 与背包面板完全是两套东西 —— 打开箱子像换了个游戏。现在统一成一个壳：
 *
 * ```
 * ┌ 面板（灰底 + 像素斜角，与背包同宽）────────────┐
 * │ 顶栏：<容器名>                          [关闭] │
 * │ ───────────────────────────────────────────── │
 * │ 上方：容器自己的格子（箱子 3×9 / 熔炉原料·燃料·产物）│
 * │ ───────────────────────────────────────────── │
 * │ 下方：玩家 27 格（3×9）                        │
 * └────────────────────────────────────────────────┘
 *    ┌ 底部 dock：9 格快捷栏（面板外） ┐
 * ```
 */
export class ContainerSystem {
  private opened: Chest | Furnace | null = null;
  private title = '';
  private lastUi = 0;
  /** 容器格数（箱子 27 / 熔炉 3）——`QuickMove` 与外部读状态都要它 */
  private containerSize = 0;

  constructor(private readonly deps: ContainerDeps) {}

  get isOpen(): boolean {
    return this.opened !== null;
  }

  /**
   * 当前打开的那个容器（没开就是 `null`）。
   *
   * 给"Shift 快速移动 / 双击退化成快速移动"用：`core/container/QuickMove.ts`
   * 要拿到"开着哪个容器 + 多少格"才能决定搬去哪边（那套规则不在这里重写）。
   */
  get openSource(): (Chest | Furnace) | null {
    return this.opened;
  }

  /** 打开的容器有多少格（箱子 27、熔炉 3；没开是 0） */
  get openSize(): number {
    return this.containerSize;
  }

  /**
   * 开着的是不是熔炉（决定产物槽 2 号"只取不放"）。
   *
   * ⚠️ 不用 `constructor.name` 判：打包压缩之后类名会被改写，那条判断静默失效、
   * 产物槽就变成"能放东西进去"——一旦放进去就被 `tick` 覆盖掉，东西直接没了。
   */
  get isFurnace(): boolean {
    return this.opened instanceof Furnace;
  }

  /** 给"点一格"统一入口用的数据源（容器格） */
  get source(): SlotSource | null {
    return this.opened;
  }

  get slotIds(): number[] {
    if (!this.opened) return [];
    return Array.from({ length: this.containerSize }, (_, index) => this.opened?.get(index)?.id ?? 0);
  }

  openAt(hit: RayHit): boolean {
    const world = this.deps.getWorld();
    const id = world.getBlock(hit.x, hit.y, hit.z);
    if (id === Block.CHEST) {
      this.opened = world.containers.getOrCreateChest('overworld', hit.x, hit.y, hit.z);
      this.title = '箱子';
      this.containerSize = 27;
    } else if (id === Block.FURNACE) {
      this.opened = world.containers.getOrCreateFurnace('overworld', hit.x, hit.y, hit.z);
      this.title = '熔炉';
      this.containerSize = 3;
    } else {
      return false;
    }
    this.show();
    return true;
  }

  openChestAt(x: number, y: number, z: number): void {
    this.opened = this.deps.getWorld().containers.getOrCreateChest('overworld', x, y, z);
    this.title = '箱子';
    this.containerSize = 27;
    this.show();
  }

  openFurnaceAt(x: number, y: number, z: number): void {
    this.opened = this.deps.getWorld().containers.getOrCreateFurnace('overworld', x, y, z);
    this.title = '熔炉';
    this.containerSize = 3;
    this.show();
  }

  close(): void {
    // ⚠️ 光标上的东西**先收回背包**再摘容器：`opened` 一置空，
    // `bindingFor('container', …)` 就再也找不到那一格了，东西会凭空消失。
    this.deps.onClosed();
    this.opened = null;
    this.containerSize = 0;
    this.deps.showHud();
  }

  /** 外部（`index.ts` 的唯一入口）改完数据后叫它重画 */
  refresh(): void {
    this.show();
  }

  fillFirst(id: number, count: number): void {
    this.opened?.set(0, { id, count });
    this.show();
  }

  smeltTest(): { output: number } {
    if (!(this.opened instanceof Furnace)) return { output: 0 };
    this.opened.set(0, { id: Item.RAW_IRON, count: 1 });
    this.opened.set(1, { id: Item.COAL, count: 1 });
    this.opened.tick(20);
    this.show();
    return { output: this.opened.get(2)?.id ?? 0 };
  }

  /**
   * 快速移动一格（Shift 语义）——容器 ⇄ 背包。
   *
   * 规则在 `core/container/QuickMove.ts`（有离线断言），这里只交"哪一格、哪个容器、多少格"。
   */
  quickMoveSlot(kind: 'inventory' | 'container', index: number): { moved: boolean; count: number } {
    const container = this.opened;
    if (!container) return { moved: false, count: 0 };
    const source = kind === 'container' ? container : this.deps.inventory;
    const result = quickMove(this.deps.inventory, container, this.containerSize, source, index);
    if (result.moved) this.show();
    return { moved: result.moved, count: result.count };
  }

  /**
   * 拖拽落格：按节点 `index` 反推"从哪儿来"。
   *
   * 容器格整段加了 `CONTAINER_NODE_BASE`，所以这里能把两套格子分开 ——
   * 否则"容器第 3 格拖到背包第 3 格"会被当成"同一格挪到自己身上"，什么都不发生。
   */
  private dropFrom(from: { index: number }, toIndex: number): void {
    const fromContainer = from.index >= CONTAINER_NODE_BASE;
    const fromRef = fromContainer
      ? ({ kind: 'container', index: from.index - CONTAINER_NODE_BASE } as const)
      : ({ kind: 'inventory', index: from.index } as const);
    const toRef = toIndex < CONTAINER_NODE_BASE
      ? ({ kind: 'inventory', index: toIndex } as const)
      : ({ kind: 'container', index: toIndex - CONTAINER_NODE_BASE } as const);
    this.deps.dropSlot(fromRef, toRef);
  }

  tick(dt: number, now: number): void {
    if (!(this.opened instanceof Furnace)) return;
    this.opened.tick(dt);
    if (now - this.lastUi > 500) {
      this.lastUi = now;
      this.show();
    }
  }

  private show(): void {
    const opened = this.opened;
    if (!opened) return;
    const uiHeight = this.deps.uiHeight;
    const isFurnace = opened instanceof Furnace;
    const inventory = this.deps.inventory;

    // ---- 尺寸：**与背包面板共用同一份常量**（`panel-metrics.ts`） ----
    //
    // ⚠️ 之前这里自己算了一套：`gridW + pad*2 + 24` = 460，而背包是 670。
    // 打开箱子/熔炉时面板会突然缩窄 210px —— 用户看到的就是"换了个界面"。
    // 容器只是**内容**少一些（没有左右轨、没有合成列），壳子必须一样大。
    const gap = SLOT_GAP;
    const pad = PANEL_PAD;
    const headerH = HEADER_H;
    const dockH = DOCK_H;
    const slotSize = SLOT_SIZE;

    // 容器区行数：箱子 3 行、熔炉 **2 行**（原料/燃料是竖着叠的，产物在右边同一行）
    //
    // ⚠️ 熔炉第一版写成 1 行 → 背包区按 1 行的位置往下排，直接把"燃料"格和
    // "熔炼 0%"那行字压在背包格下面（截图里能看出来）。熔炉占的高度是
    // `y` 到 `y + 2*slot + gap`，就是 2 行。
    const containerRows = isFurnace ? 2 : 3;
    const containerH = containerRows * slotSize + (containerRows - 1) * gap;

    /**
     * 容器区**实际占用的高度**（含标签行）。
     *
     * ⚠️ 不能用 `containerH` 直接排背包：熔炉的格子是从"标签行下面"开始的，
     * 少算这 16px 会让"背包"小标题贴到燃料格上（第一版就是这样，截图上两者叠一起）。
     */
    const containerBlockH = isFurnace ? 16 + containerH : 4 + containerH;

    const panelW = PANEL_W;
    // ⚠️ 高度用 `CONTAINER_PANEL_NEED`（箱子/熔炉**共用同一档**），
    // 不按各自行数算：否则箱子和熔炉之间切一次，面板高度就跳一次。
    const panelH = panelHeight(uiHeight, CONTAINER_PANEL_NEED);
    const panelX = (DESIGN_WIDTH - panelW) / 2;
    const panelY = Math.max(6, (uiHeight - dockH - panelH) / 2);

    // 9 列网格在面板内**水平居中**（面板与背包同宽 670，网格只有 412，
    // 贴着左边会看起来偏——原版是居中的）。
    const contentX = panelX + (panelW - GRID_W) / 2;
    // 内容从顶栏下面开始摆；余下的空间留给底部（熔炉只有 1 行，下面会空一截，
    // 但那是**固定壳**的代价，比"切一次跳一次"好）。
    const contentY = panelY + headerH + BODY_PAD;

    const els: UiElement[] = [];

    // ---- 顶栏：容器名 + 关闭（与背包同款小字 + 小键） ----
    els.push(
      text(panelX + pad + 4, panelY + 8, 300, 20, this.title, { fontSize: 13, color: MC.text }),
      button(panelX + panelW - pad - 50, panelY + 6, 50, 20, '关闭', () => this.close(), {
        background: MC.button,
        bevel: [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
        color: MC.text,
        fontSize: 12,
        borderWidth: 2,
      }),
      box(panelX + pad, panelY + headerH - 4, panelW - pad * 2, 2, [], { background: '#a9a9a9' }),
    );

    // ---- 上方：容器自己的格子 ----
    if (isFurnace) {
      const f = opened as Furnace;
      // 熔炉排版（对齐原版）：左列 原料/燃料 竖着叠，右边箭头，最右产物槽。
      // 三个标签都写在**各自格子的正上方**，不再靠 `+16` 的魔法偏移。
      const labelH = 14;
      const leftX = contentX;
      const labelY = contentY;
      const y = contentY + labelH + 2; // 格子上沿（标签下方）

      els.push(
        // 原料（0 号）
        text(leftX, labelY, 60, labelH, '原料', { fontSize: 10, color: MC.textMuted }),
        slot(
          leftX + 28,
          y,
          slotSize,
          CONTAINER_NODE_BASE + 0,
          f.get(0)?.id ?? 0,
          f.get(0)?.count ?? 0,
          false,
          (b) => this.deps.clickSlot('container', 0, b),
          (from) => this.dropFrom(from, 0),
          false,
          (count) => this.deps.splitSlot('container', 0, count),
        ),
        // 燃料（1 号）—— 标签写在这一格左边（下面那行没有空间写标题）
        text(leftX, y + slotSize + gap + slotSize / 2 - 7, 60, labelH, '燃料', {
          fontSize: 10,
          color: MC.textMuted,
        }),
        slot(
          leftX + 28,
          y + slotSize + gap,
          slotSize,
          CONTAINER_NODE_BASE + 1,
          f.get(1)?.id ?? 0,
          f.get(1)?.count ?? 0,
          false,
          (b) => this.deps.clickSlot('container', 1, b),
          (from) => this.dropFrom(from, 1),
          false,
          (count) => this.deps.splitSlot('container', 1, count),
        ),
      );
      // 箭头 + 两条进度（火焰在上、熔炼在下，都夹在原料/燃料与产物之间）
      const arrowX = leftX + 28 + slotSize + 14;
      const arrowY = y + (2 * slotSize + gap - 20) / 2;
      els.push(
        text(arrowX, arrowY, 26, 20, '→', { fontSize: 16, color: MC.text, align: 'center' }),
        text(arrowX + 26, arrowY - 2, 96, 14, `火焰 ${Math.round(f.burnRatio * 100)}%`, {
          fontSize: 10,
          color: MC.text,
        }),
        text(arrowX + 26, arrowY + 16, 96, 14, `熔炼 ${Math.round(f.cookRatio * 100)}%`, {
          fontSize: 10,
          color: MC.textMuted,
        }),
      );
      // 产物槽（只取不放）
      const outX = arrowX + 26 + 100;
      els.push(
        text(outX, labelY, 60, labelH, '产物', { fontSize: 10, color: MC.textMuted }),
        slot(
          outX,
          y + (2 * slotSize + gap - slotSize) / 2,
          slotSize,
          CONTAINER_NODE_BASE + 2,
          f.get(2)?.id ?? 0,
          f.get(2)?.count ?? 0,
          false,
          (b) => this.deps.clickSlot('container', 2, b),
          undefined,
          true,
        ),
      );
      // 这座炉子吃不吃这件东西（按站台过滤：烟熏炉只吃食物、高炉只吃矿物）
      if (f.rejectReason) {
        els.push(
          text(leftX, y + 2 * slotSize + gap + 6, GRID_W, 14, f.rejectReason, {
            fontSize: 10,
            color: '#8a3a3a',
          }),
        );
      }
    } else {
      // 箱子：3×9 = 27 格
      for (let i = 0; i < 27; i++) {
        const stack = opened.get(i);
        els.push(
          slot(
            contentX + (i % 9) * (slotSize + gap),
            contentY + 4 + Math.floor(i / 9) * (slotSize + gap),
            slotSize,
            CONTAINER_NODE_BASE + i,
            stack?.id ?? 0,
            stack?.count ?? 0,
            false,
            (b) => this.deps.clickSlot('container', i, b),
            (from) => this.dropFrom(from, i),
            false,
            (count) => this.deps.splitSlot('container', i, count),
          ),
        );
      }
    }

    // ---- 下方：玩家 27 格（3×9）—— **"统一面板"的关键就是这一块** ----
    // 位置按容器区**实际占用**的高度往下排（含标签行），再加 26px 放"背包"小标题
    const invY = contentY + containerBlockH + 26;
    els.push(text(contentX, invY - 16, 120, 14, '背包', { fontSize: 10, color: MC.textMuted }));
    for (let j = 0; j < 27; j++) {
      const index = j + 9;
      const stack = inventory.get(index);
      els.push(
        slot(
          contentX + (j % 9) * (slotSize + gap),
          invY + Math.floor(j / 9) * (slotSize + gap),
          slotSize,
          index,
          stack?.id ?? 0,
          stack?.count ?? 0,
          false,
          (b) => this.deps.clickSlot('inventory', index, b),
          (from) => this.dropFrom(from, index),
          false,
          (count) => this.deps.splitSlot('inventory', index, count),
        ),
      );
    }

    // ---- 底部提示（与背包面板同一行小字，位置也一致） ----
    const hint = this.deps.getHint();
    if (hint) els.push(text(contentX, panelY + panelH - 22, panelW - pad * 2, 18, hint, { fontSize: 11, color: '#8a3a3a' }));

    this.deps.onGeo?.({
      panelX,
      panelY,
      panelW,
      panelH,
      slotSize,
      containerX: contentX,
      containerY: isFurnace ? contentY + 16 : contentY + 4,
      inventoryX: contentX,
      inventoryY: invY,
      containerSize: isFurnace ? 3 : 27,
      furnace: isFurnace,
    });

    const panelBox = box(panelX, panelY, panelW, panelH, els, {
      background: MC.panel,
      bevel: [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
      borderWidth: 3,
    });
    const outline = box(panelX - 2, panelY - 2, panelW + 4, panelH + 4, [], {
      bevel: [MC.outline, MC.outline, MC.outline, MC.outline],
      borderWidth: 2,
    });

    this.deps.ui.setRoot(
      box(0, 0, 1024, uiHeight, [
        box(0, 0, 1024, uiHeight, [], { background: 'rgba(0, 0, 0, 0.45)' }),
        outline,
        panelBox,
        // 底部 dock：与背包界面**同一个**快捷栏（面板外）
        ...buildHotbarDock({
          screenW: 1024,
          screenH: uiHeight,
          slotSize: Math.round(slotSize * 0.96),
          gap,
          inventory,
          selectedSlot: this.deps.getSelectedSlot(),
          onSlot: (index, b) => {
            this.deps.setSelectedSlot(index);
            this.deps.clickSlot('inventory', index, b);
          },
          onDrop: (from, to) =>
            this.deps.dropSlot({ kind: 'inventory', index: from }, { kind: 'inventory', index: to }),
          onSplit: (index, count) => this.deps.splitSlot('inventory', index, count),
        }),
      ]),
    );
  }
}
