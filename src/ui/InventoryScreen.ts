/**
 * 物品栏 / 工作台界面
 *
 * 两种模式共用同一块面板（与原版一致：工作台只是把 2×2 换成 3×3）：
 *   inventory：2×2 合成 + 主背包 3×9 + 快捷栏 1×9 + 创造物品栏
 *   crafting ：3×3 合成 + 主背包 + 快捷栏
 *
 * 拖拽语义：
 *   左键 → 整叠拿起 / 放下 / 合并 / 交换
 *   右键 → 拿起一半 / 放下一个
 *   合成结果槽 → 左键取出一次产物（自动消耗每格材料各 1 个）
 * 关闭界面时手上的物品与合成网格里的材料都会自动收回背包，不会丢失。
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
import { PLACEABLE_ITEMS, itemName, maxStackOf } from '../core/registry/items.ts';

export type InventoryPanelMode = 'inventory' | 'crafting';

export interface InventoryScreenHooks {
  onOpenChange?: (open: boolean) => void;
}

interface SlotBinding {
  element: HTMLDivElement;
  source: SlotSource;
  index: number;
}

const RESULT_KEY = 'craft:result';

export class InventoryScreen {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly craftArea: HTMLDivElement;
  private readonly creativeSection: HTMLDivElement;
  private readonly heldElement: HTMLDivElement;
  private readonly heldCanvas: HTMLCanvasElement;
  private readonly heldCount: HTMLSpanElement;
  private readonly resultElement: HTMLDivElement;

  /** key → 槽位绑定；key 形如 "inv:12" / "craft:3"；结果槽用 RESULT_KEY */
  private readonly bindings = new Map<string, SlotBinding>();
  private readonly grids: Record<2 | 3, CraftingGrid>;

  private mode: InventoryPanelMode = 'inventory';
  private held: ItemStack | null = null;
  private open = false;

  constructor(
    private readonly atlas: TextureAtlas,
    private readonly inventory: Inventory,
    private readonly hooks: InventoryScreenHooks = {},
  ) {
    this.grids = { 2: new CraftingGrid(2), 3: new CraftingGrid(3) };
    for (const grid of Object.values(this.grids)) {
      grid.onChange = () => this.refresh();
    }

    this.root = document.createElement('div');
    this.root.id = 'inventory-screen';
    this.root.className = 'hidden';

    this.panel = document.createElement('div');
    this.panel.className = 'inv-panel';

    const header = document.createElement('div');
    header.className = 'inv-header';
    this.titleEl = document.createElement('b');
    this.titleEl.textContent = '物品栏';
    this.hintEl = document.createElement('span');
    this.hintEl.innerHTML = '按 <kbd>E</kbd> 关闭 · 左键整叠 / 右键单个 · 点结果槽取出产物';
    header.append(this.titleEl, this.hintEl);
    this.panel.appendChild(header);

    // ---- 合成区
    this.craftArea = document.createElement('div');
    this.craftArea.className = 'inv-craft';
    this.panel.appendChild(this.craftArea);

    this.resultElement = this.createSlot();
    this.resultElement.dataset.key = RESULT_KEY;
    // 结果槽在模式切换时会重新挂载，监听器只注册一次
    this.resultElement.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.handleResultClick(event.button);
    });

    // ---- 主背包 / 快捷栏
    this.panel.appendChild(this.buildLabel('主背包'));
    this.panel.appendChild(this.buildGrid(MAIN_START, MAIN_SIZE, 'inv-grid', 'inv'));

    this.panel.appendChild(this.buildLabel('快捷栏'));
    this.panel.appendChild(this.buildGrid(HOTBAR_START, HOTBAR_SIZE, 'inv-grid inv-hotbar', 'inv'));

    // ---- 创造物品栏（仅物品栏模式显示）
    this.creativeSection = document.createElement('div');
    const creativeLabel = this.buildLabel('创造物品栏（左键取一整叠 / 右键取一个）');
    this.creativeSection.append(creativeLabel, this.buildCreativeGrid());
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
    this.rebuildCraftArea();
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
        const amount = event.button === 2 ? 1 : maxStackOf(itemId);
        this.inventory.add(itemId, amount);
      });
      grid.appendChild(slot);
    }
    return grid;
  }

  /** 合成区随模式重建：2×2 或 3×3 + 结果槽 */
  private rebuildCraftArea(): void {
    this.craftArea.replaceChildren();
    const grid = this.crafting;

    // 先清理旧的合成槽绑定
    for (const key of [...this.bindings.keys()]) {
      if (key.startsWith('craft:')) this.bindings.delete(key);
    }

    const material = document.createElement('div');
    material.className = `inv-grid inv-craft-grid size-${grid.size}`;
    for (let i = 0; i < grid.size * grid.size; i++) {
      material.appendChild(this.registerSlot(`craft:${i}`, grid, i));
    }

    const arrow = document.createElement('div');
    arrow.className = 'inv-arrow';
    arrow.textContent = '→';

    this.craftArea.append(material, arrow, this.resultElement);
  }

  private createSlot(): HTMLDivElement {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const count = document.createElement('span');
    count.className = 'inv-count';
    slot.append(canvas, count);
    return slot;
  }

  private registerSlot(key: string, source: SlotSource, index: number): HTMLDivElement {
    const slot = this.createSlot();
    slot.dataset.key = key;
    slot.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.handleSlotClick(key, event.button);
    });
    this.bindings.set(key, { element: slot, source, index });
    return slot;
  }

  // ---------------------------------------------------------------- 交互

  private bindEvents(): void {
    document.addEventListener('mousemove', (event) => {
      if (!this.open) return;
      this.heldElement.style.left = `${event.clientX}px`;
      this.heldElement.style.top = `${event.clientY}px`;
    });

    // 点击面板空白处：把手上的物品放回背包
    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root) {
        event.preventDefault();
        this.returnHeldToInventory();
      }
    });

    // 关闭时把合成材料也还回去
    document.addEventListener('keydown', (event) => {
      if (event.code !== 'Escape') return;
      this.close();
    });
  }

  private handleSlotClick(key: string, button: number): void {
    const binding = this.bindings.get(key);
    if (!binding) return;
    const { source, index } = binding;
    const slot = source.get(index);

    if (this.held) {
      if (button === 2) {
        if (!slot) {
          source.set(index, { id: this.held.id, count: 1 });
          this.held.count -= 1;
        } else if (slot.id === this.held.id && slot.count < maxStackOf(slot.id)) {
          slot.count += 1;
          this.held.count -= 1;
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
      if (button === 2 && slot.count > 1) {
        const half = Math.ceil(slot.count / 2);
        this.held = { id: slot.id, count: half };
        slot.count -= half;
        this.inventory.notify();
      } else {
        this.held = slot;
        source.set(index, null);
      }
    }

    if (this.held && this.held.count <= 0) this.held = null;
    this.crafting.recompute();
    this.refresh();
  }

  /** 点结果槽：合成一次，产物优先放到光标上 */
  private handleResultClick(button: number): void {
    void button;
    const grid = this.crafting;
    const product = grid.result;
    if (!product) return;

    const taken: ItemStack = { id: product.id, count: product.count };
    if (!grid.takeResult()) return;

    if (!this.held) {
      this.held = taken;
    } else if (this.held.id === taken.id && this.held.count + taken.count <= maxStackOf(taken.id)) {
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

  /** 打开为物品栏模式，或工作台模式 */
  openWith(mode: InventoryPanelMode): void {
    const changed = this.mode !== mode;
    this.mode = mode;
    if (changed) {
      // 切换模式前把旧网格的材料收回，避免物品卡在隐藏的网格里
      for (const grid of Object.values(this.grids)) grid.drainTo(this.inventory);
      this.rebuildCraftArea();
    }
    this.titleEl.textContent = mode === 'crafting' ? '工作台' : '物品栏';
    this.creativeSection.style.display = mode === 'crafting' ? 'none' : '';
    this.openPanel();
  }

  toggle(): void {
    if (this.open && this.mode === 'inventory') {
      this.close();
      return;
    }
    this.openWith('inventory');
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
    this.open = false;
    this.root.classList.add('hidden');
    this.hooks.onOpenChange?.(false);
  }

  refresh(): void {
    for (const binding of this.bindings.values()) {
      this.renderInto(binding.element, binding.source.get(binding.index));
    }

    // 结果槽
    const result = this.crafting.result;
    this.renderInto(this.resultElement, result ? { id: result.id, count: result.count } : null);
    this.resultElement.classList.toggle('ready', result !== null);

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
