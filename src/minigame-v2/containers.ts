import { Block } from '../core/registry/blocks.ts';
import { Item } from '../core/registry/items.ts';
import { Chest } from '../core/container/Chest.ts';
import { Furnace } from '../core/container/Furnace.ts';
import type { Inventory, SlotSource } from '../core/container/Inventory.ts';
import type { RayHit } from '../core/interaction/Raycast.ts';
import type { World } from '../core/world/World.ts';
import { TOTAL_SLOTS } from '../core/container/Inventory.ts';
import { quickMove } from '../core/container/QuickMove.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import { UiLayer, box, button, MC, slot, text, type SlotButton, type UiElement } from './ui-kit/index.ts';
import { buildHotbarDock } from './inventory-tabs.ts';
import { verdictOnLeave, verdictOnOpen, verdictOnStart } from './furnace-station.ts';
import { FURNACE_STATIONS, fuelSeconds, smeltingRecipeFor } from '../core/crafting/Smelting.ts';
import { maxStackOf } from '../core/registry/items.ts';
import {
  clampStationPage,
  hasFuelAvailable,
  stationCardHint,
  stationCards,
  stationPageSize,
  type StationCard,
} from './station-cards.ts';
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

/**
 * 熔炉左栏"可做列表"的尺寸。
 *
 * 卡片是三列小格（每格 34），所以 `3 * 34 + 2 * 2 = 106`；
 * 面板 670 宽、9 列网格 412，两者加起来 106 + 12 + 412 = 530，还有 140 的余量。
 */
const STATION_COL_W = 3 * 34 + 2 * 2;
const STATION_COL_GAP = 12;
const STATION_CARD = 34;

/** 配方卡的节点编号起点（容器格是 100~126，这里从 200 起，避开） */
const STATION_NODE_BASE = 200;

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
  /** 这一轮有没有点过目标框开工（`started` 的界面侧副本，关界面时按它决定解不解冻） */
  private stationStarted = false;
  /** 目标框那一行的提示（"开始制作" / "燃料槽是空的……"） */
  private stationHint = '';
  /** 左栏配方卡当前页（换炉子/换站台时归零） */
  private stationPage = 0;

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
      this.stationPage = 0;
      this.prepareFurnaceOnOpen();
    } else {
      return false;
    }
    this.show();
    return true;
  }

  /**
   * 打开熔炉时的第一件事：**判断该冻还是该继续烧**。
   *
   * 规则在 `furnace-station.ts` 的 `verdictOnOpen`（有 26 条离线断言）：
   * 正在烧的不冻（否则"外面在烧、一打开就停"），没在烧的冻住等玩家点目标框。
   */
  private prepareFurnaceOnOpen(): void {
    if (!(this.opened instanceof Furnace)) return;
    const furnace = this.opened;
    const verdict = verdictOnOpen({
      hasInput: furnace.get(0) !== null,
      hasFuel: furnace.get(1) !== null,
      burnTimeLeft: furnace.burnTimeLeft,
      cookProgress: furnace.cookProgress,
      cookTimeTotal: furnace.cookTimeTotal,
      paused: furnace.paused,
      started: furnace.started,
    });
    furnace.paused = verdict.paused;
    this.stationStarted = furnace.started && !verdict.paused;
    this.stationHint = verdict.reason;
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
    // 换一座炉子 = 换一份可做列表，页码必须归零（否则会停在"第 3 页"而列表只有 1 页）
    this.stationPage = 0;
    this.prepareFurnaceOnOpen();
    this.show();
  }

  close(): void {
    // **先解除冻结**：点过目标框的炉子关掉界面后要继续烧。
    // 漏了这一步 = 玩家点开看一眼再关掉，炉子就再也不烧了（永久冻住）。
    this.releaseStationPause();
    // ⚠️ 光标上的东西**先收回背包**再摘容器：`opened` 一置空，
    // `bindingFor('container', …)` 就再也找不到那一格了，东西会凭空消失。
    this.deps.onClosed();
    this.opened = null;
    this.containerSize = 0;
    this.stationStarted = false;
    this.stationHint = '';
    this.deps.showHud();
  }

  /**
   * 离开容器前把冻结状态收尾。
   *
   * 规则在 `furnace-station.ts` 的 `verdictOnLeave`：`started` 的解除冻结继续烧，
   * 没开工的保持冻结（玩家没选配方，不该自己烧）。
   */
  private releaseStationPause(): void {
    if (!(this.opened instanceof Furnace)) return;
    const furnace = this.opened;
    const verdict = verdictOnLeave({
      hasInput: furnace.get(0) !== null,
      hasFuel: furnace.get(1) !== null,
      burnTimeLeft: furnace.burnTimeLeft,
      cookProgress: furnace.cookProgress,
      cookTimeTotal: furnace.cookTimeTotal,
      paused: furnace.paused,
      started: this.stationStarted || furnace.started,
    });
    furnace.paused = verdict.paused;
    furnace.started = !verdict.paused;
  }

  /**
   * **点目标框开工** —— 熔炉界面上那颗"产物格"就是目标框。
   *
   * 规则在 `verdictOnStart`：没原料 / 没燃料 / 产物槽满 各有各的拒绝话术。
   *
   * @returns 有没有真的开工
   */
  startStation(): boolean {
    if (!(this.opened instanceof Furnace)) return false;
    const furnace = this.opened;
    const input = furnace.get(0);
    const fuel = furnace.get(1);
    const output = furnace.get(2);
    // 产物槽能不能装下：空的能装；同一种且没满也能装；其余都不行
    const product = input ? smeltingRecipeFor(input.id, furnace.station) : undefined;
    const outputFits = product
      ? !output || (output.id === product.output.id && output.count + product.output.count <= maxStackOf(output.id))
      : false;

    const verdict = verdictOnStart({
      inputReady: input !== null,
      fuelReady: fuel !== null && fuelSeconds(fuel.id) > 0,
      outputFits,
    });
    this.stationHint = verdict.reason;
    if (!verdict.ok) {
      this.show();
      return false;
    }
    furnace.paused = false;
    furnace.started = true;
    this.stationStarted = true;
    this.show();
    return true;
  }

  /** 点目标框收取成品（熔炉的产物槽只取不放，所以"取"走这条） */
  takeStationOutput(): boolean {
    if (!(this.opened instanceof Furnace)) return false;
    const furnace = this.opened;
    const output = furnace.get(2);
    if (!output) return false;
    // 先进背包（背包满了就留在产物槽里，不凭空消失）
    const leftover = this.deps.inventory.addStack(output);
    if (leftover >= output.count) {
      this.stationHint = '背包满了，先腾出空间';
      this.show();
      return false;
    }
    furnace.set(2, leftover > 0 ? { ...output, count: leftover } : null);
    if (leftover === 0) furnace.takeExperience();
    this.stationHint = '';
    this.show();
    return true;
  }

  /**
   * 左栏可做列表的统计（验收脚本读它，不猜像素）。
   *
   * `shown` 是当前页实际画出来的条数，`total` 是全量——分页有没有生效看这两个。
   */
  get stationCardInfo(): {
    station: string;
    total: number;
    craftable: number;
    shown: number;
    page: number;
    hint: string;
  } | null {
    const furnace = this.opened;
    if (!(furnace instanceof Furnace)) return null;
    const inputInSlot = furnace.get(0);
    const countOf = (itemId: number) => {
      const inBag = this.deps.inventory.countOf(itemId);
      return inBag + (inputInSlot?.id === itemId ? inputInSlot.count : 0);
    };
    const bagIds: number[] = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = this.deps.inventory.get(i);
      if (stack && stack.id > 0) bagIds.push(stack.id);
    }
    const fuel = hasFuelAvailable(furnace.burnTimeLeft, furnace.get(1)?.id ?? 0, bagIds);
    const cards = stationCards(furnace.station, countOf, fuel);
    const pageSize = stationPageSize(STATION_CARD * 4 + 20, STATION_CARD + 4);
    const page = clampStationPage(this.stationPage, cards.length, pageSize);
    const slice = cards.slice(page * pageSize, page * pageSize + pageSize);
    return {
      station: furnace.station,
      total: cards.length,
      craftable: cards.filter((c) => c.available).length,
      shown: slice.length,
      page,
      hint: this.stationHint,
    };
  }

  /** 左栏那份列表（`buildStationColumn` 与三个验收钩子共用，避免逻辑写两遍） */
  private currentCards(): StationCard[] {
    const furnace = this.opened;
    if (!(furnace instanceof Furnace)) return [];
    const inputInSlot = furnace.get(0);
    const countOf = (itemId: number): number => {
      const inBag = this.deps.inventory.countOf(itemId);
      return inBag + (inputInSlot?.id === itemId ? inputInSlot.count : 0);
    };
    const bagIds: number[] = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = this.deps.inventory.get(i);
      if (stack && stack.id > 0) bagIds.push(stack.id);
    }
    const fuel = hasFuelAvailable(furnace.burnTimeLeft, furnace.get(1)?.id ?? 0, bagIds);
    return stationCards(furnace.station, countOf, fuel);
  }

  /** 验收：点第一张"能做"的卡 */
  pickFirstCraftable(): { ok: boolean; resultId: number; hint: string } {
    const card = this.currentCards().find((c) => c.available);
    if (!card) return { ok: false, resultId: 0, hint: '没有可做的配方' };
    this.pickStationCard(card);
    return { ok: true, resultId: card.resultId, hint: this.stationHint };
  }

  /** 验收：点第一张"缺料"的卡 */
  pickFirstLocked(): { ok: boolean; resultId: number; hint: string } {
    const card = this.currentCards().find((c) => !c.available);
    if (!card) return { ok: false, resultId: 0, hint: '没有缺料的配方' };
    this.pickStationCard(card);
    return { ok: false, resultId: card.resultId, hint: this.stationHint };
  }

  /** 验收：三种熔炉站台各能列几条（站台过滤有没有生效） */
  stationCountsByStation(): { furnace: number; smoker: number; blast_furnace: number } {
    const furnace = this.opened;
    const inputInSlot = furnace instanceof Furnace ? furnace.get(0) : null;
    const countOf = (itemId: number): number => {
      const inBag = this.deps.inventory.countOf(itemId);
      return inBag + (inputInSlot?.id === itemId ? inputInSlot.count : 0);
    };
    return {
      furnace: stationCards('furnace', countOf, true).length,
      smoker: stationCards('smoker', countOf, true).length,
      blast_furnace: stationCards('blast_furnace', countOf, true).length,
    };
  }

  /** 熔炉状态（验收脚本读它判断"有没有在烧"） */
  get furnaceState():
    | { paused: boolean; started: boolean; burning: boolean; burnPct: number; cookPct: number; hint: string }
    | null {
    const furnace = this.opened;
    if (!(furnace instanceof Furnace)) return null;
    return {
      paused: furnace.paused,
      started: furnace.started,
      burning: furnace.isLit,
      burnPct: Math.round(furnace.burnRatio * 100),
      cookPct: Math.round(furnace.cookRatio * 100),
      hint: this.stationHint,
    };
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

  /**
   * **全局**推进所有熔炉 —— 不只是开着的那个。
   *
   * ⚠️ 之前只有"界面开着"才 tick（`if (containers.isOpen) containers.tick(...)`），
   * 于是关掉界面炉子就停住了。外部端（`main.ts: tickContainers`）是**所有熔炉都推进**，
   * 注释写得很清楚："熔炉与酿造台离开玩家视野也要继续跑"。
   *
   * 这里只推进熔炉（v2 目前只有箱子与熔炉两种容器），
   * 而且**跳过正在看的那个**——它由 `tick()` 按 500ms 节流重绘，
   * 两处一起推进会让 `dt` 被算两遍、烧得比正常快一倍。
   */
  tickAll(dt: number): void {
    if (!(dt > 0)) return;
    const world = this.deps.getWorld();
    world.containers.forEach((container) => {
      if (!(container instanceof Furnace)) return;
      if (container === this.opened) return; // 开着的那个由 tick() 管
      container.tick(dt);
    });
  }

  /**
   * 熔炉左栏的"可做列表" —— 三列小卡，白底=能开工、红底=缺料。
   *
   * 点一张卡 = **把原料和燃料摆进炉子**（外部端 `fillStationRecipe` 的语义），
   * 不直接开工：原版配方列表就是这个行为，直接开工会让玩家看不见摆了什么。
   *
   * 规则全在 `station-cards.ts`（60 条离线断言），这里只负责画。
   */
  private buildStationColumn(f: Furnace, x: number, y: number): UiElement[] {
    const els: UiElement[] = [];
    const station = f.station;
    const pageSize = stationPageSize(STATION_CARD * 4 + 20, STATION_CARD + 4);
    const cards = this.currentCards();
    if (cards.length === 0) {
      els.push(
        text(x, y, STATION_COL_W, 14, `${FURNACE_STATIONS[station].cn}没有可做的`, {
          fontSize: 10,
          color: MC.textMuted,
        }),
      );
      return els;
    }

    const page = clampStationPage(this.stationPage, cards.length, pageSize);
    this.stationPage = page;
    const slice = cards.slice(page * pageSize, page * pageSize + pageSize);

    els.push(
      text(x, y, STATION_COL_W, 14, `可做 ${cards.length}`, { fontSize: 10, color: MC.text }),
    );
    const top = y + 18;
    slice.forEach((card, i) => {
      const cx = x + (i % 3) * (STATION_CARD + 2);
      const cy = top + Math.floor(i / 3) * (STATION_CARD + 4);
      els.push(
        slot(
          cx,
          cy,
          STATION_CARD,
          // 配方卡不参与容器格的点击通道，用独立的高位编号（避免与 `CONTAINER_NODE_BASE` 撞）
          STATION_NODE_BASE + page * pageSize + i,
          card.resultId,
          card.resultCount,
          false,
          () => this.pickStationCard(card),
          undefined,
          // 不是产物槽：产物槽的金边是"只能取"，配方卡缺料是"现在用不了"，
          // 两者视觉必须分开（否则 45 张卡里 44 张都亮金边）。
          false,
          undefined,
          // 做不出来的压暗
          !card.available,
        ),
      );
    });

    // 底部一句：页码 + 缺什么（只显示当前页第一张缺料的原因，够用且不挤）
    const hintParts: string[] = [];
    if (cards.length > pageSize) {
      hintParts.push(`${page + 1}/${Math.ceil(cards.length / pageSize)}`);
    }
    const missing = slice.find((c) => !c.available);
    if (missing) hintParts.push(stationCardHint(missing));
    if (hintParts.length > 0) {
      els.push(
        text(x, top + 4 * (STATION_CARD + 4) + 2, STATION_COL_W, 14, hintParts.join(' · '), {
          fontSize: 10,
          color: MC.textMuted,
        }),
      );
    }
    return els;
  }

  /**
   * 点一张配方卡 = **把原料和燃料摆进炉子**（不直接开工）。
   *
   * 材料不够时说清缺什么，不要静默 —— 静默会让玩家以为卡坏了。
   */
  private pickStationCard(card: StationCard): void {
    const furnace = this.opened;
    if (!(furnace instanceof Furnace)) return;

    // 1) 原料：先看背包够不够
    if (this.deps.inventory.countOf(card.inputId) < card.inputCount) {
      this.stationHint = `材料不足：缺 ${itemLabel(card.inputId)}`;
      this.show();
      return;
    }
    // 2) 原料槽被别的物品占着 → 不硬塞（那会把玩家摆好的东西吃掉）
    const inSlot = furnace.get(0);
    if (inSlot && inSlot.id !== card.inputId) {
      this.stationHint = '原料槽里是别的东西，先取走';
      this.show();
      return;
    }
    // 3) 燃料：炉子里/槽里/背包里，三处都没有就先别摆
    const bagIds: number[] = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = this.deps.inventory.get(i);
      if (stack && stack.id > 0) bagIds.push(stack.id);
    }
    if (!hasFuelAvailable(furnace.burnTimeLeft, furnace.get(1)?.id ?? 0, bagIds)) {
      this.stationHint = '没有燃料，先放点能烧的东西';
      this.show();
      return;
    }

    // 摆料：从背包取到原料槽（同类补满，不覆盖）
    this.fillSlotFromBag(furnace, 0, card.inputId, card.inputCount);
    // 燃料槽空着就顺手放一份燃料进去（原版配方书也是这么做的）
    if (!furnace.get(1)) this.fillFirstFuelFromBag(furnace);

    this.stationHint = `已摆好：${itemLabel(card.resultId)}，点产物框开工`;
    this.show();
  }

  /** 从背包往某个槽位补货（同类补满；槽里是别的东西就什么都不做） */
  private fillSlotFromBag(furnace: Furnace, slot: number, itemId: number, wanted: number): void {
    const current = furnace.get(slot);
    if (current && current.id !== itemId) return;
    let remaining = wanted - (current?.count ?? 0);
    if (remaining <= 0) return;
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const stack = this.deps.inventory.get(i);
      if (!stack || stack.id !== itemId) continue;
      const moved = Math.min(remaining, stack.count);
      remaining -= moved;
      const left = stack.count - moved;
      this.deps.inventory.set(i, left > 0 ? { ...stack, count: left } : null);
      const now = furnace.get(slot);
      furnace.set(slot, { ...(now ?? { id: itemId }), id: itemId, count: (now?.count ?? 0) + moved });
    }
  }

  /** 从背包找第一件可燃物放进燃料槽 */
  private fillFirstFuelFromBag(furnace: Furnace): void {
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = this.deps.inventory.get(i);
      if (!stack || fuelSeconds(stack.id) <= 0) continue;
      // 只搬 1 个：玩家可能只想要"先烧一轮"
      this.deps.inventory.set(i, stack.count > 1 ? { ...stack, count: stack.count - 1 } : null);
      furnace.set(1, { id: stack.id, count: 1 });
      return;
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
    //
    // 熔炉例外：它多了一列"可做列表"，两列合起来一起居中（左边配方卡、右边炉子本体）。
    const bodyW = isFurnace ? STATION_COL_W + STATION_COL_GAP + GRID_W : GRID_W;
    const bodyX = panelX + (panelW - bodyW) / 2;
    /** 配方卡列的左上角 */
    const stationX = bodyX;
    /** 炉子本体（9 列）的左上角 */
    const contentX = isFurnace ? bodyX + STATION_COL_W + STATION_COL_GAP : bodyX;
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

      // ---- 左栏：可做列表（对齐外部端 `inv-station-recipes`） ----
      els.push(...this.buildStationColumn(f, stationX, contentY));

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
      // 冻结时进度条一律 0%（炉子真的不烧），并用文字说明"点目标框开工"
      const idle = f.paused;
      els.push(
        text(arrowX, arrowY, 26, 20, '→', { fontSize: 16, color: MC.text, align: 'center' }),
        text(arrowX + 26, arrowY - 2, 96, 14, idle ? '待开工' : `火焰 ${Math.round(f.burnRatio * 100)}%`, {
          fontSize: 10,
          color: idle ? MC.textMuted : MC.text,
        }),
        text(
          arrowX + 26,
          arrowY + 16,
          96,
          14,
          idle ? '点产物框' : `熔炼 ${Math.round(f.cookRatio * 100)}%`,
          { fontSize: 10, color: MC.textMuted },
        ),
      );
      // 产物槽 = **目标框**：有成品就取走，没成品就开工（对齐外部端 `clickStationTarget`）
      //
      // ⚠️ 不额外画高亮：`takeOnly` 的槽位本身就会画一圈 `MC.outputAccent` 描边
      // （`ui-kit` 里管这个），再叠一层只会变成两圈黄框。
      // "现在该点这里"这件事由左边那两行小字表达（"待开工 / 点产物框"）。
      const outX = arrowX + 26 + 100;
      const product = f.get(2);
      els.push(
        text(outX, labelY, 60, labelH, '产物', { fontSize: 10, color: MC.textMuted }),
        slot(
          outX,
          y + (2 * slotSize + gap - slotSize) / 2,
          slotSize,
          CONTAINER_NODE_BASE + 2,
          product?.id ?? 0,
          product?.count ?? 0,
          false,
          () => {
            // 有成品 → 取走；没成品 → 点目标框开工
            if (f.get(2)) this.takeStationOutput();
            else this.startStation();
          },
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
    //
    // ⚠️ 两条来源要合成一条：`deps.getHint()` 是背包那一层的话（"拿起 8 个"），
    // `stationHint` 是熔炉目标框的话（"燃料槽是空的"）。
    // 只显示前者的话，玩家点了目标框被拒，界面上**什么都不说** —— 那正是第一版的样子。
    const hint = this.stationHint || this.deps.getHint();
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
