/**
 * 通用容器界面
 *
 * 五种模式共用一块面板，下方永远是玩家自己的主背包 + 快捷栏，
 * 上方区域随模式切换（与原版一致：打开不同容器时只是上半部分在变）：
 *
 *   inventory：2×2 合成 + 结果槽 + 创造物品栏
 *   crafting ：3×3 合成 + 结果槽
 *   furnace  ：原料 / 燃料 / 产物 三格 + 火焰与进度
 *   chest    ：3×9 容器格
 *
 * 拖拽语义：
 *   左键 → 整叠拿起 / 放下 / 合并 / 交换
 *   右键 → 拿起一半 / 放下一个
 *   合成结果槽、熔炉产物槽为"只取不放"
 * 关闭界面时手上的物品、合成网格里的材料都会自动收回背包，不会丢失。
 */

import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { drawItemIcon } from './ItemIcon.ts';
import {
  ARMOR_SIZE,
  ARMOR_START,
  HOTBAR_SIZE,
  HOTBAR_START,
  Inventory,
  MAIN_SIZE,
  MAIN_START,
  type ItemStack,
  type SlotSource,
} from '../core/container/Inventory.ts';
import { CraftingGrid } from '../core/crafting/CraftingGrid.ts';
import { CHEST_SIZE } from '../core/container/Chest.ts';
import {
  ENCHANT_ITEM_SLOT,
  ENCHANT_LAPIS_SLOT,
  EnchantTable,
} from '../core/container/EnchantTable.ts';
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, Furnace } from '../core/container/Furnace.ts';
import { UI_HINT_UNIMPLEMENTED, optionLabel, type EnchantOption } from '../core/crafting/Enchanting.ts';
import { Chest } from '../core/container/Chest.ts';
import {
  CATEGORY_LABELS,
  ITEM_CATEGORIES,
  CREATIVE_ITEMS,
  categoryOf,
  itemName,
  maxStackOf,
  type ItemCategory,
} from '../core/registry/items.ts';
import { itemLabel, itemTooltip, type ItemTooltip } from '../core/registry/itemNames.ts';
import { Tooltip } from './Tooltip.ts';

export type InventoryPanelMode = 'inventory' | 'crafting' | 'furnace' | 'chest' | 'enchanting';

export interface InventoryScreenHooks {
  onOpenChange?: (open: boolean) => void;
  /** 打开配方书（背包标题栏上的按钮） */
  onOpenRecipes?: () => void;
  /**
   * 从熔炉里取走产物、且产物槽被取空时结算烧炼经验（I5）。
   * 界面只负责"发现这件事发生了"，攒了多少、给谁加由主程序决定。
   */
  onFurnaceXp?: (amount: number) => void;
  /**
   * 附魔台要用到的"玩家侧信息"（H9）：当前等级、书架加成、以及扣等级的出口。
   * 界面不持有 `Experience`，所以询问式地取——一次刷新只问一次。
   */
  enchantContext?: () => {
    playerLevel: number;
    bookshelfPower: number;
    consumeLevels: (levels: number) => boolean;
  };
}

interface SlotBinding {
  element: HTMLDivElement;
  source: SlotSource;
  index: number;
  /** 只取不放（合成结果、熔炉产物） */
  takeOnly?: boolean;
}

/** 容器类界面的 UI 刷新节流间隔（秒）：熔炉每帧都在烧，但界面不需要每帧重绘 */
const CONTAINER_REFRESH_INTERVAL = 0.1;

/**
 * 触摸端的"长按"手势参数。
 *
 * 触摸屏没有右键，所以把原版的右键语义（取一半 / 放一个）映射到长按上：
 *   短按抬起 → 左键（拿起整叠 / 放下整叠）
 *   按住超过 260ms → 右键（取一半 / 放一个），并且**按住不放每 170ms 重复一次**，
 *     于是在合成格上按住不动就是"连续放材料"（批量放置），在箱子里按住就是"连续取一个"。
 * 桌面鼠标完全不走这条路径，行为与原来一致。
 */
const TOUCH_LONG_PRESS_MS = 260;
const TOUCH_REPEAT_MS = 170;

export class InventoryScreen {
  /** 触摸长按的定时器（长按判定 + 连发），桌面端始终为 null */
  private touchPressTimer: number | null = null;
  private touchRepeatTimer: number | null = null;

  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly topArea: HTMLDivElement;
  private readonly creativeSection: HTMLDivElement;
  private readonly heldElement: HTMLDivElement;
  private readonly heldCanvas: HTMLCanvasElement;
  private readonly heldCount: HTMLSpanElement;
  private readonly resultElement: HTMLDivElement;
  private readonly chestGrid: HTMLDivElement;
  private readonly furnaceLayout: HTMLDivElement;
  private readonly furnaceInputSlot: HTMLDivElement;
  private readonly furnaceFuelSlot: HTMLDivElement;
  private readonly furnaceOutputSlot: HTMLDivElement;
  private readonly flameEl: HTMLDivElement;
  /** 附魔台（H9） */
  private readonly enchantLayout: HTMLDivElement;
  private readonly enchantItemSlot: HTMLDivElement;
  private readonly enchantLapisSlot: HTMLDivElement;
  private readonly enchantStatusEl: HTMLDivElement;
  private readonly enchantButtons: HTMLButtonElement[] = [];
  private readonly cookFillEl: HTMLElement;

  // 创造物品栏的分类与搜索状态。
  // 这几个元素在 buildCreativeSection() 里创建（构造函数中调用），
  // 因此不能用 readonly —— TS 无法跨方法验证"只赋值一次"。
  private creativeGrid!: HTMLDivElement;
  private creativeTabs!: HTMLDivElement;
  private creativeSearch!: HTMLInputElement;
  private creativeCountEl!: HTMLSpanElement;
  private creativeCategory: ItemCategory = 'all';
  private creativeQuery = '';

  /** key → 槽位绑定；key 形如 "inv:12" / "craft:3" / "furnace:1" / "chest:5" */
  private readonly bindings = new Map<string, SlotBinding>();
  /** 每个槽位当前显示的物品（提示框按元素反查；槽位会被反复重建，所以用 WeakMap 不占内存） */
  private readonly tooltipStacks = new WeakMap<HTMLElement, ItemStack>();
  private readonly grids: Record<2 | 3, CraftingGrid>;

  private mode: InventoryPanelMode = 'inventory';
  private activeContainer: Furnace | Chest | EnchantTable | null = null;
  private containerDirty = false;
  private containerRefreshTimer = 0;

  private held: ItemStack | null = null;
  private open = false;

  constructor(
    private readonly atlas: TextureAtlas,
    private readonly inventory: Inventory,
    private readonly hooks: InventoryScreenHooks = {},
    /** 物品提示框；不传就自己建一个（验收脚本里单独构造界面时用得上） */
    private readonly tooltip: Tooltip = new Tooltip(),
  ) {
    this.grids = { 2: new CraftingGrid(2), 3: new CraftingGrid(3) };
    for (const grid of Object.values(this.grids)) grid.onChange = () => this.refresh();

    this.root = document.createElement('div');
    this.root.id = 'inventory-screen';
    this.root.className = 'hidden';

    // 一个委托监听覆盖所有槽位（含后面动态重建的创造物品栏）
    this.tooltip.delegate(this.root, (target) => this.tooltipFor(target));

    this.panel = document.createElement('div');
    this.panel.className = 'inv-panel';

    const header = document.createElement('div');
    header.className = 'inv-header';
    this.titleEl = document.createElement('b');
    this.titleEl.textContent = '物品栏';
    const hint = document.createElement('span');
    // 触摸端没有左右键之分，提示改成"轻点"的说法，免得玩家找不到右键
    const touchDevice = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    hint.innerHTML = touchDevice
      ? '点空白处关闭 · 轻点拿起 / 再轻点放下，点空槽可放下一个'
      : '按 <kbd>E</kbd> 或 <kbd>Esc</kbd> 关闭 · 左键整叠 / 右键单个';
    header.append(this.titleEl, hint);
    if (this.hooks.onOpenRecipes) {
      const recipes = document.createElement('button');
      recipes.type = 'button';
      recipes.className = 'inv-recipes-btn';
      recipes.textContent = '配方书 (R)';
      recipes.addEventListener('click', () => this.hooks.onOpenRecipes?.());
      header.appendChild(recipes);
    }
    this.panel.appendChild(header);

    // ---- 上半部分：随模式切换
    this.topArea = document.createElement('div');
    this.topArea.className = 'inv-top';
    this.panel.appendChild(this.topArea);

    // 2×2 / 3×3 合成区的结果槽（点击行为由 createSlot 内的统一监听按 key 分发）
    this.resultElement = this.createSlot();
    this.resultElement.dataset.key = 'craft:result';

    // 箱子 3×9
    this.chestGrid = document.createElement('div');
    this.chestGrid.className = 'inv-grid inv-chest';

    // 熔炉
    this.furnaceLayout = document.createElement('div');
    this.furnaceLayout.className = 'furnace-layout';
    this.furnaceInputSlot = this.createSlot();
    this.furnaceFuelSlot = this.createSlot();
    this.furnaceOutputSlot = this.createSlot();
    this.furnaceFuelSlot.dataset.key = 'furnace:fuel';
    this.furnaceInputSlot.dataset.key = 'furnace:input';
    this.furnaceOutputSlot.dataset.key = 'furnace:output';
    // 附魔台（H9）：物品槽 + 青金石槽 + 三个候选按钮
    this.enchantLayout = document.createElement('div');
    this.enchantLayout.className = 'enchant-layout';
    this.enchantItemSlot = this.createSlot();
    this.enchantLapisSlot = this.createSlot();
    this.enchantItemSlot.dataset.key = 'enchant:item';
    this.enchantLapisSlot.dataset.key = 'enchant:lapis';
    this.enchantStatusEl = document.createElement('div');
    this.enchantStatusEl.className = 'enchant-status';

    this.flameEl = document.createElement('div');
    this.flameEl.className = 'furnace-flame';
    const flameFill = document.createElement('i');
    this.flameEl.appendChild(flameFill);
    this.cookFillEl = document.createElement('i');
    const cookTrack = document.createElement('div');
    cookTrack.className = 'furnace-cook';
    cookTrack.appendChild(this.cookFillEl);

    // ---- 玩家背包
    this.panel.appendChild(this.buildLabel('主背包'));
    this.panel.appendChild(this.buildGrid(MAIN_START, MAIN_SIZE, 'inv-grid', 'inv'));

    this.panel.appendChild(this.buildLabel('快捷栏'));
    this.panel.appendChild(this.buildGrid(HOTBAR_START, HOTBAR_SIZE, 'inv-grid inv-hotbar', 'inv'));

    // ---- 玩家装备（4 格盔甲 + 1 格副手）；空槽显示部位提示字，触摸端才知道该放哪
    this.panel.appendChild(this.buildLabel('盔甲与副手'));
    this.panel.appendChild(this.buildArmorGrid());

    this.creativeSection = document.createElement('div');
    this.buildCreativeSection();
    this.panel.appendChild(this.creativeSection);

    this.root.appendChild(this.panel);

    this.heldElement = document.createElement('div');
    this.heldElement.id = 'inv-held';
    this.heldCanvas = document.createElement('canvas');
    this.heldCount = document.createElement('span');
    this.heldElement.append(this.heldCanvas, this.heldCount);
    this.root.appendChild(this.heldElement);

    document.body.appendChild(this.root);

    this.bindEvents();
    this.inventory.onChange = () => this.refresh();
    this.rebuildTopArea();
    this.refresh();
  }

  // ---------------------------------------------------------------- DOM 构建

  private get crafting(): CraftingGrid {
    return this.grids[this.mode === 'crafting' ? 3 : 2];
  }

  private buildLabel(text: string): HTMLDivElement {
    const label = document.createElement('div');
    label.className = 'inv-label';
    label.textContent = text;
    return label;
  }

  private buildGrid(start: number, size: number, className: string, prefix: string): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = className;
    for (let i = 0; i < size; i++) {
      const index = start + i;
      grid.appendChild(this.registerSlot(`${prefix}:${index}`, this.inventory, index));
    }
    return grid;
  }

  /** 盔甲 4 格 + 副手 1 格（槽位号 36-40，与原版一致） */
  private buildArmorGrid(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'inv-grid inv-armor';
    const hints = ['头', '胸', '腿', '靴', '副'];
    for (let i = 0; i < ARMOR_SIZE + 1; i++) {
      const index = ARMOR_START + i;
      const slot = this.registerSlot(`inv:${index}`, this.inventory, index);
      const hint = document.createElement('span');
      hint.className = 'inv-slot-hint';
      hint.textContent = hints[i]!;
      slot.appendChild(hint);
      grid.appendChild(slot);
    }
    return grid;
  }

  /** 创造物品栏：分类标签 + 搜索框 + 物品网格 */
  private buildCreativeSection(): void {
    const header = document.createElement('div');
    header.className = 'inv-label';
    header.append('创造物品栏');
    this.creativeCountEl = document.createElement('span');
    this.creativeCountEl.className = 'inv-count-label';
    header.appendChild(this.creativeCountEl);

    const controls = document.createElement('div');
    controls.className = 'inv-creative-controls';

    this.creativeTabs = document.createElement('div');
    this.creativeTabs.className = 'inv-tabs';
    for (const category of ITEM_CATEGORIES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inv-tab';
      button.textContent = CATEGORY_LABELS[category];
      button.dataset.category = category;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.creativeCategory = category;
        this.updateTabHighlight();
        this.renderCreativeGrid();
      });
      this.creativeTabs.appendChild(button);
    }

    this.creativeSearch = document.createElement('input');
    this.creativeSearch.type = 'text';
    this.creativeSearch.className = 'inv-search';
    this.creativeSearch.placeholder = '搜索物品…';
    this.creativeSearch.addEventListener('input', () => {
      this.creativeQuery = this.creativeSearch.value.trim().toLowerCase();
      this.renderCreativeGrid();
    });

    controls.append(this.creativeTabs, this.creativeSearch);

    this.creativeGrid = document.createElement('div');
    this.creativeGrid.className = 'inv-grid inv-creative';

    this.creativeSection.append(header, controls, this.creativeGrid);
    this.updateTabHighlight();
    this.renderCreativeGrid();
  }

  private updateTabHighlight(): void {
    for (const child of Array.from(this.creativeTabs.children)) {
      const element = child as HTMLElement;
      element.classList.toggle('active', element.dataset.category === this.creativeCategory);
    }
  }

  /** 按当前分类与搜索词重建创造网格 */
  private renderCreativeGrid(): void {
    const query = this.creativeQuery;
    const items = CREATIVE_ITEMS.filter((itemId) => {
      if (this.creativeCategory !== 'all' && categoryOf(itemId) !== this.creativeCategory) return false;
      // 中文名与英文 id 都能搜：写"石头"或写 stone 都能找到（原来只认英文 id）
      if (query.length > 0 && !matchesQuery(itemId, query)) return false;
      return true;
    });

    this.creativeGrid.replaceChildren();
    for (const itemId of items) {
      const slot = this.createSlot();
      slot.classList.add('creative-slot');
      this.tooltipStacks.set(slot, { id: itemId, count: 1 });
      drawItemIcon(slot.querySelector('canvas')!, this.atlas, itemId, 28);
      slot.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.inventory.add(itemId, event.button === 2 ? 1 : maxStackOf(itemId));
      });
      this.creativeGrid.appendChild(slot);
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '没有匹配的物品';
      this.creativeGrid.appendChild(empty);
    }

    this.creativeCountEl.textContent = `  ${items.length} / ${CREATIVE_ITEMS.length}`;
  }

  /** 清掉某一前缀的旧绑定 */
  private clearBindings(prefix: string): void {
    for (const key of [...this.bindings.keys()]) {
      if (key.startsWith(prefix)) this.bindings.delete(key);
    }
  }

  /** 重建上半部分 */
  private rebuildTopArea(): void {
    this.topArea.replaceChildren();
    this.clearBindings('craft:');
    this.clearBindings('furnace:');
    this.clearBindings('chest:');
    this.clearBindings('enchant:');

    if (this.mode === 'furnace') {
      const input = this.registerExisting(this.furnaceInputSlot, 'furnace:input', this.activeContainer!, FURNACE_INPUT);
      const fuel = this.registerExisting(this.furnaceFuelSlot, 'furnace:fuel', this.activeContainer!, FURNACE_FUEL);
      const output = this.registerExisting(
        this.furnaceOutputSlot,
        'furnace:output',
        this.activeContainer!,
        FURNACE_OUTPUT,
        true,
      );

      const left = document.createElement('div');
      left.className = 'furnace-col';
      left.append(input, this.flameEl, fuel);

      const middle = document.createElement('div');
      middle.className = 'furnace-middle';
      middle.appendChild(this.cookTrackElement());

      this.furnaceLayout.replaceChildren(left, middle, output);
      this.topArea.appendChild(this.furnaceLayout);
      return;
    }

    if (this.mode === 'enchanting') {
      const table = this.activeContainer instanceof EnchantTable ? this.activeContainer : null;
      const item = this.registerExisting(this.enchantItemSlot, 'enchant:item', table!, ENCHANT_ITEM_SLOT);
      const lapis = this.registerExisting(this.enchantLapisSlot, 'enchant:lapis', table!, ENCHANT_LAPIS_SLOT);

      const left = document.createElement('div');
      left.className = 'enchant-col';
      left.append(this.buildLabel('物品'), item, this.buildLabel('青金石'), lapis);

      const right = document.createElement('div');
      right.className = 'enchant-options';
      this.enchantButtons.length = 0;
      for (let slot = 0; slot < 3; slot++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'enchant-option';
        button.dataset.slot = String(slot);
        button.addEventListener('click', () => this.handleEnchantClick(slot));
        this.enchantButtons.push(button);
        right.appendChild(button);
      }
      const hint = document.createElement('div');
      hint.className = 'enchant-hint';
      hint.textContent = UI_HINT_UNIMPLEMENTED;
      right.append(this.enchantStatusEl, hint);

      this.enchantLayout.replaceChildren(left, right);
      this.topArea.appendChild(this.enchantLayout);
      return;
    }

    if (this.mode === 'chest') {
      this.chestGrid.replaceChildren();
      for (let i = 0; i < CHEST_SIZE; i++) {
        this.chestGrid.appendChild(this.registerSlot(`chest:${i}`, this.activeContainer!, i));
      }
      this.topArea.appendChild(this.buildLabel('箱子'));
      this.topArea.appendChild(this.chestGrid);
      return;
    }

    // ---- 合成模式（物品栏 2×2 / 工作台 3×3）
    const grid = this.crafting;
    const material = document.createElement('div');
    material.className = `inv-grid inv-craft-grid size-${grid.size}`;
    for (let i = 0; i < grid.size * grid.size; i++) {
      material.appendChild(this.registerSlot(`craft:${i}`, grid, i));
    }

    const arrow = document.createElement('div');
    arrow.className = 'inv-arrow';
    arrow.textContent = '→';

    const layout = document.createElement('div');
    layout.className = 'inv-craft';
    layout.append(material, arrow, this.resultElement);
    this.topArea.appendChild(layout);
  }

  private cachedCookTrack: HTMLDivElement | null = null;

  private cookTrackElement(): HTMLDivElement {
    if (this.cachedCookTrack) return this.cachedCookTrack;
    const track = document.createElement('div');
    track.className = 'furnace-cook';
    track.appendChild(this.cookFillEl);
    this.cachedCookTrack = track;
    return track;
  }

  /**
   * 槽位元素只在创建时挂一次监听，点击时从 dataset.key 反查绑定。
   * 这样重建上半部分（切模式/换容器）时直接复用元素即可，不会重复绑定监听器。
   */
  private createSlot(): HTMLDivElement {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    // 提示框靠这个属性认出"指针下面是可悬停的东西"（见 Tooltip.delegate）
    slot.dataset.tooltip = '';
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const count = document.createElement('span');
    count.className = 'inv-count';
    slot.append(canvas, count);

    slot.addEventListener('pointerdown', (event) => {
      const key = slot.dataset.key;
      if (!key) return;
      event.preventDefault();

      // 鼠标：左键 / 右键语义保持不变
      if (event.pointerType === 'mouse') {
        this.activateSlot(key, event.button);
        return;
      }

      // 触摸：短按 = 左键，长按 = 右键（并支持连发批量放置）
      this.beginTouchPress(slot, key, event.pointerId);
    });
    return slot;
  }

  private registerSlot(key: string, source: SlotSource, index: number, takeOnly = false): HTMLDivElement {
    return this.registerExisting(this.createSlot(), key, source, index, takeOnly);
  }

  private registerExisting(
    slot: HTMLDivElement,
    key: string,
    source: SlotSource,
    index: number,
    takeOnly = false,
  ): HTMLDivElement {
    slot.dataset.key = key;
    this.bindings.set(key, { element: slot, source, index, takeOnly });
    return slot;
  }

  // ---------------------------------------------------------------- 交互

  private bindEvents(): void {
    document.addEventListener('pointermove', (event) => {
      if (!this.open) return;
      this.heldElement.style.left = `${event.clientX}px`;
      this.heldElement.style.top = `${event.clientY}px`;
    });

    this.root.addEventListener('pointerdown', (event) => {
      if (event.target !== this.root) return;
      event.preventDefault();
      this.returnHeldToInventory();
    });

    document.addEventListener('keydown', (event) => {
      if (event.code !== 'Escape') return;
      this.close();
    });
  }

  /** 统一的槽位激活入口（左键 = 0，右键 = 2） */
  private activateSlot(key: string, button: number): void {
    if (key === 'craft:result') this.handleResultClick();
    else this.handleSlotClick(key, button);
  }

  /**
   * 触摸端的槽位手势：短按抬起算左键，按住超过阈值算长按（右键 + 连发）。
   *
   * 用 `setPointerCapture` 把后续事件绑到同一个槽位元素上，
   * 这样手指稍微滑出槽位再抬起也能正确收尾（否则 pointerup 会丢，定时器一直跑）。
   */
  private beginTouchPress(slot: HTMLDivElement, key: string, pointerId: number): void {
    this.clearTouchPress();
    try {
      slot.setPointerCapture(pointerId);
    } catch {
      // 指针已经失效时调用会抛错，直接忽略：没有捕获也不影响短按
    }

    this.touchPressTimer = window.setTimeout(() => {
      this.touchPressTimer = null;
      // 长按：右键行为 + 连发（合成网格批量放置、箱子连续取一个都靠它）
      this.activateSlot(key, 2);
      this.touchRepeatTimer = window.setInterval(() => this.activateSlot(key, 2), TOUCH_REPEAT_MS);
    }, TOUCH_LONG_PRESS_MS);

    const finish = (): void => {
      const wasQuickTap = this.touchPressTimer !== null;
      this.clearTouchPress();
      if (wasQuickTap) this.activateSlot(key, 0);
    };

    slot.addEventListener('pointerup', finish, { once: true });
    slot.addEventListener('pointercancel', () => this.clearTouchPress(), { once: true });
  }

  /** 清掉长按相关的定时器（抬起 / 取消 / 开始新手势时调用） */
  private clearTouchPress(): void {
    if (this.touchPressTimer !== null) {
      window.clearTimeout(this.touchPressTimer);
      this.touchPressTimer = null;
    }
    if (this.touchRepeatTimer !== null) {
      window.clearInterval(this.touchRepeatTimer);
      this.touchRepeatTimer = null;
    }
  }

  /**
   * 这个槽位收不收这件物品。
   * 只有玩家背包有"部位限制"（36-39 是盔甲槽），合成网格/箱子/熔炉一律放行。
   */
  private accepts(binding: SlotBinding, itemId: number): boolean {
    // 附魔台的青金石槽只吃青金石（放别的进去会把"点不动"的原因藏起来）
    if (binding.source instanceof EnchantTable) {
      return binding.index !== ENCHANT_LAPIS_SLOT || EnchantTable.acceptsLapis(itemId);
    }
    if (binding.source !== this.inventory) return true;
    return this.inventory.canPlace(binding.index, itemId);
  }

  /** 触摸端没有"指针变禁止符"这种提示，用一次短促的抖动告诉玩家"这里放不下" */
  private rejectSlot(element: HTMLElement): void {
    element.classList.remove('inv-reject');
    // 读一次布局属性强制重排，否则连续两次拒绝不会重播动画
    void element.offsetWidth;
    element.classList.add('inv-reject');
    window.setTimeout(() => element.classList.remove('inv-reject'), 220);
  }

  private handleSlotClick(key: string, button: number): void {
    const binding = this.bindings.get(key);
    if (!binding) return;
    const { source, index, takeOnly } = binding;
    const slot = source.get(index);

    if (this.held && !takeOnly) {
      // 盔甲槽只吃对应部位：不匹配就整次操作作废（既不放下也不交换）
      if (!this.accepts(binding, this.held.id)) {
        this.rejectSlot(binding.element);
        return;
      }
      if (button === 2) {
        if (!slot) {
          source.set(index, { id: this.held.id, count: 1 });
          this.held.count -= 1;
        } else if (slot.id === this.held.id && slot.count < maxStackOf(slot.id)) {
          slot.count += 1;
          this.held.count -= 1;
          this.inventory.notify();
        }
      } else if (!slot) {
        source.set(index, this.held);
        this.held = null;
      } else if (slot.id === this.held.id) {
        const room = maxStackOf(slot.id) - slot.count;
        const moved = Math.min(room, this.held.count);
        slot.count += moved;
        this.held.count -= moved;
        this.inventory.notify();
      } else {
        source.set(index, this.held);
        this.held = slot;
      }
    } else if (slot) {
      // 只取不放的槽位：右键拿一半同样允许
      if (button === 2 && slot.count > 1) {
        const half = Math.ceil(slot.count / 2);
        this.held = { id: slot.id, count: half };
        slot.count -= half;
        this.inventory.notify();
      } else if (!this.held || takeOnly) {
        if (this.held && takeOnly) {
          // 手上有东西时点只取不放的槽：合并同类
          if (this.held.id === slot.id) {
            const room = maxStackOf(slot.id) - slot.count;
            const moved = Math.min(room, this.held.count);
            slot.count += moved;
            this.held.count -= moved;
            this.inventory.notify();
          }
        } else {
          this.held = slot;
          source.set(index, null);
        }
      }
    }

    // 熔炉产物被取空 → 结算攒下的烧炼经验（原版也是"整槽取走才给"）
    if (takeOnly && source instanceof Furnace && source.get(FURNACE_OUTPUT) === null) {
      const xp = source.takeExperience();
      if (xp > 0) this.hooks.onFurnaceXp?.(xp);
    }

    if (this.held && this.held.count <= 0) this.held = null;
    this.crafting.recompute();
    this.refresh();
  }

  /** 点合成结果槽：合成一次，产物优先放到光标上 */
  private handleResultClick(): void {
    const grid = this.crafting;
    const product = grid.result;
    if (!product) return;

    const taken: ItemStack = { id: product.id, count: product.count };
    if (!grid.takeResult()) return;

    if (!this.held) this.held = taken;
    else if (this.held.id === taken.id && this.held.count + taken.count <= maxStackOf(taken.id)) {
      this.held.count += taken.count;
    } else {
      this.inventory.add(taken.id, taken.count);
    }
    this.refresh();
  }

  private returnHeldToInventory(): void {
    if (this.held) {
      const leftover = this.inventory.add(this.held.id, this.held.count);
      this.held = leftover > 0 ? { id: this.held.id, count: leftover } : null;
    }
    for (const grid of Object.values(this.grids)) grid.drainTo(this.inventory);
    this.refresh();
  }

  // ---------------------------------------------------------------- 显示

  get isOpen(): boolean {
    return this.open;
  }

  get currentMode(): InventoryPanelMode {
    return this.mode;
  }

  /** 打开为指定模式；容器模式必须传入容器实例 */
  openWith(mode: InventoryPanelMode, container?: Furnace | Chest | EnchantTable): void {
    if (this.mode !== mode || this.activeContainer !== container) {
      for (const grid of Object.values(this.grids)) grid.drainTo(this.inventory);
      this.mode = mode;
      this.activeContainer = container ?? null;

      if (this.activeContainer) {
        this.activeContainer.onChange = () => {
          this.containerDirty = true;
        };
      }
      this.rebuildTopArea();
    }

    this.titleEl.textContent = MODE_TITLES[mode];
    this.creativeSection.style.display = mode === 'inventory' ? '' : 'none';
    this.openPanel();
  }

  toggle(): void {
    if (this.open && this.mode === 'inventory') this.close();
    else this.openWith('inventory');
  }

  openPanel(): void {
    if (this.open) return;
    this.open = true;
    this.root.classList.remove('hidden');
    this.refresh();
    this.hooks.onOpenChange?.(true);
  }

  close(): void {
    this.clearTouchPress();
    if (!this.open) return;
    this.returnHeldToInventory();
    if (this.activeContainer) this.activeContainer.onChange = null;
    this.open = false;
    this.root.classList.add('hidden');
    this.hooks.onOpenChange?.(false);
  }

  /** 容器内容变化后的节流刷新（由主循环调用） */
  tickUi(dt: number): void {
    if (!this.open || !this.containerDirty) return;
    this.containerRefreshTimer += dt;
    if (this.containerRefreshTimer < CONTAINER_REFRESH_INTERVAL) return;
    this.containerRefreshTimer = 0;
    this.containerDirty = false;
    this.refresh();
  }

  refresh(): void {
    for (const binding of this.bindings.values()) {
      this.renderInto(binding.element, binding.source.get(binding.index));
      if (binding.takeOnly) binding.element.classList.add('take-only');
    }

    if (this.mode === 'inventory' || this.mode === 'crafting') {
      const result = this.crafting.result;
      this.renderInto(this.resultElement, result ? { id: result.id, count: result.count } : null);
      this.resultElement.classList.toggle('ready', result !== null);
      this.resultElement.classList.add('take-only');
    }

    if (this.mode === 'furnace' && this.activeContainer instanceof Furnace) {
      const furnace = this.activeContainer;
      const flameFill = this.flameEl.firstElementChild as HTMLElement | null;
      if (flameFill) flameFill.style.height = `${Math.round(furnace.burnRatio * 100)}%`;
      this.flameEl.classList.toggle('lit', furnace.isLit);
      this.cookFillEl.style.width = `${Math.round(furnace.cookRatio * 100)}%`;
    }

    if (this.mode === 'enchanting') this.refreshEnchantOptions();

    if (this.held) {
      drawItemIcon(this.heldCanvas, this.atlas, this.held.id, 32);
      this.heldElement.classList.add('on');
      this.heldCount.textContent = this.held.count > 1 ? String(this.held.count) : '';
    } else {
      this.heldElement.classList.remove('on');
      this.heldCount.textContent = '';
    }
  }

  /** 指针底下的槽位当前是什么物品 */
  private tooltipFor(element: HTMLElement): ItemTooltip | null {
    const stack = this.tooltipStacks.get(element);
    if (!stack) return null;
    return itemTooltip(stack.id, stack.count, stack.damage, stack.enchants);
  }

  /** 点第 slot 个候选：校验 → 扣等级与青金石 → 附魔 */
  private handleEnchantClick(slot: number): void {
    const table = this.activeContainer;
    if (!(table instanceof EnchantTable)) return;
    const context = this.hooks.enchantContext?.();
    if (!context) return;

    const result = table.applySlot(slot, context.playerLevel, context.consumeLevels);
    this.enchantStatusEl.textContent = result.ok ? `已附上 ${optionLabel(result.enchants)}` : result.reason;
    this.enchantStatusEl.classList.toggle('bad', !result.ok);
    this.refresh();
  }

  /**
   * 重掷候选槽并刷新三个按钮。
   * 掷点放在容器里（`EnchantTable.refresh`）而不是这里：切换模式会重建上半区，
   * 状态留在界面里会被丢掉；只有"局面指纹"变了才重掷，否则每帧刷新都会换一批附魔。
   */
  private refreshEnchantOptions(): void {
    const table = this.activeContainer;
    if (!(table instanceof EnchantTable)) return;
    const context = this.hooks.enchantContext?.();
    if (!context) return;

    table.refresh(context.playerLevel, context.bookshelfPower, Math.random);

    for (let slot = 0; slot < this.enchantButtons.length; slot++) {
      const button = this.enchantButtons[slot]!;
      const option: EnchantOption | undefined = table.options[slot];
      const check = table.checkSlot(slot, context.playerLevel);
      const cost = option?.cost ?? 0;
      const label = option && option.enchants.length > 0 ? optionLabel(option.enchants) : '—';
      button.textContent = cost > 0 ? `${label}　${cost} 级` : label;
      button.classList.toggle('on', check.ok);
      button.title = check.ok ? `消耗 ${cost} 级经验与 ${option!.lapis} 个青金石` : check.reason;
      button.disabled = !check.ok;
    }
  }

  private renderInto(element: HTMLElement, stack: ItemStack | null): void {
    const canvas = element.querySelector('canvas') as HTMLCanvasElement;
    const count = element.querySelector('.inv-count') as HTMLSpanElement;
    // 空槽的"头/胸/腿/靴/副"提示字靠这个类名隐藏（有东西时就不该再显示）
    element.classList.toggle('has-item', stack !== null);
    if (stack) {
      drawItemIcon(canvas, this.atlas, stack.id);
      canvas.style.visibility = 'visible';
      count.textContent = stack.count > 1 ? String(stack.count) : '';
      // 悬停提示交给托管的 Tooltip（浏览器自带的 title 只有一行、手机上还弹不出来）
      this.tooltipStacks.set(element, stack);
    } else {
      canvas.style.visibility = 'hidden';
      count.textContent = '';
      this.tooltipStacks.delete(element);
    }
  }

  dispose(): void {
    this.inventory.onChange = null;
    for (const grid of Object.values(this.grids)) grid.onChange = null;
    this.root.remove();
  }
}

const MODE_TITLES: Record<InventoryPanelMode, string> = {
  inventory: '物品栏',
  crafting: '工作台',
  furnace: '熔炉',
  chest: '箱子',
  enchanting: '附魔台',
};

/** 创造物品栏的搜索匹配：中文名、英文 id、数字 id 都认 */
function matchesQuery(itemId: number, query: string): boolean {
  const lower = query.toLowerCase();
  if (itemLabel(itemId).includes(query)) return true;
  if (itemName(itemId).toLowerCase().includes(lower)) return true;
  return String(itemId) === query;
}
