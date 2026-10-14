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
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, Furnace } from '../core/container/Furnace.ts';
import { Chest } from '../core/container/Chest.ts';
import { PLACEABLE_ITEMS, itemName, maxStackOf } from '../core/registry/items.ts';

export type InventoryPanelMode = 'inventory' | 'crafting' | 'furnace' | 'chest';

export interface InventoryScreenHooks {
  onOpenChange?: (open: boolean) => void;
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

export class InventoryScreen {
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
  private readonly cookFillEl: HTMLElement;

  /** key → 槽位绑定；key 形如 "inv:12" / "craft:3" / "furnace:1" / "chest:5" */
  private readonly bindings = new Map<string, SlotBinding>();
  private readonly grids: Record<2 | 3, CraftingGrid>;

  private mode: InventoryPanelMode = 'inventory';
  private activeContainer: Furnace | Chest | null = null;
  private containerDirty = false;
  private containerRefreshTimer = 0;

  private held: ItemStack | null = null;
  private open = false;

  constructor(
    private readonly atlas: TextureAtlas,
    private readonly inventory: Inventory,
    private readonly hooks: InventoryScreenHooks = {},
  ) {
    this.grids = { 2: new CraftingGrid(2), 3: new CraftingGrid(3) };
    for (const grid of Object.values(this.grids)) grid.onChange = () => this.refresh();

    this.root = document.createElement('div');
    this.root.id = 'inventory-screen';
    this.root.className = 'hidden';

    this.panel = document.createElement('div');
    this.panel.className = 'inv-panel';

    const header = document.createElement('div');
    header.className = 'inv-header';
    this.titleEl = document.createElement('b');
    this.titleEl.textContent = '物品栏';
    const hint = document.createElement('span');
    hint.innerHTML = '按 <kbd>E</kbd> 或 <kbd>Esc</kbd> 关闭 · 左键整叠 / 右键单个';
    header.append(this.titleEl, hint);
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

    this.creativeSection = document.createElement('div');
    this.creativeSection.append(this.buildLabel('创造物品栏（左键取一整叠 / 右键取一个）'), this.buildCreativeGrid());
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

  private buildCreativeGrid(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'inv-grid inv-creative';
    for (const itemId of PLACEABLE_ITEMS) {
      const slot = this.createSlot();
      slot.title = itemName(itemId);
      drawItemIcon(slot.querySelector('canvas')!, this.atlas, itemId, 28);
      slot.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.inventory.add(itemId, event.button === 2 ? 1 : maxStackOf(itemId));
      });
      grid.appendChild(slot);
    }
    return grid;
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
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const count = document.createElement('span');
    count.className = 'inv-count';
    slot.append(canvas, count);

    slot.addEventListener('mousedown', (event) => {
      const key = slot.dataset.key;
      if (!key) return;
      event.preventDefault();
      if (key === 'craft:result') this.handleResultClick();
      else this.handleSlotClick(key, event.button);
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
    document.addEventListener('mousemove', (event) => {
      if (!this.open) return;
      this.heldElement.style.left = `${event.clientX}px`;
      this.heldElement.style.top = `${event.clientY}px`;
    });

    this.root.addEventListener('mousedown', (event) => {
      if (event.target !== this.root) return;
      event.preventDefault();
      this.returnHeldToInventory();
    });

    document.addEventListener('keydown', (event) => {
      if (event.code !== 'Escape') return;
      this.close();
    });
  }

  private handleSlotClick(key: string, button: number): void {
    const binding = this.bindings.get(key);
    if (!binding) return;
    const { source, index, takeOnly } = binding;
    const slot = source.get(index);

    if (this.held && !takeOnly) {
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
  openWith(mode: InventoryPanelMode, container?: Furnace | Chest): void {
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

    if (this.held) {
      drawItemIcon(this.heldCanvas, this.atlas, this.held.id, 32);
      this.heldElement.classList.add('on');
      this.heldCount.textContent = this.held.count > 1 ? String(this.held.count) : '';
    } else {
      this.heldElement.classList.remove('on');
      this.heldCount.textContent = '';
    }
  }

  private renderInto(element: HTMLElement, stack: ItemStack | null): void {
    const canvas = element.querySelector('canvas') as HTMLCanvasElement;
    const count = element.querySelector('.inv-count') as HTMLSpanElement;
    if (stack) {
      drawItemIcon(canvas, this.atlas, stack.id);
      canvas.style.visibility = 'visible';
      count.textContent = stack.count > 1 ? String(stack.count) : '';
      element.title = itemName(stack.id);
    } else {
      canvas.style.visibility = 'hidden';
      count.textContent = '';
      element.title = '';
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
};
