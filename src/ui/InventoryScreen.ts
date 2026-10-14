/**
 * 背包界面
 *
 * 布局对齐原版：主背包 3×9 + 快捷栏 1×9，另加一个"创造物品栏"面板
 * （生存模式的物品获取要等合成与采集完善，现阶段用它方便取物与验证）。
 *
 * 拖拽语义与原版一致：
 *   左键  → 整叠拿起 / 放下 / 合并 / 交换
 *   右键  → 拿起一半 / 放下一个
 *   关闭界面时手上的物品自动收回背包，不会丢失
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
} from '../core/container/Inventory.ts';
import { PLACEABLE_ITEMS, itemName, maxStackOf } from '../core/registry/items.ts';

export interface InventoryScreenHooks {
  onOpenChange?: (open: boolean) => void;
}

export class InventoryScreen {
  private readonly root: HTMLDivElement;
  private readonly heldElement: HTMLDivElement;
  private readonly heldCanvas: HTMLCanvasElement;
  private readonly heldCount: HTMLSpanElement;
  private readonly slotElements = new Map<number, HTMLDivElement>();

  private held: ItemStack | null = null;
  private open = false;

  constructor(
    private readonly atlas: TextureAtlas,
    private readonly inventory: Inventory,
    private readonly hooks: InventoryScreenHooks = {},
  ) {
    this.root = document.createElement('div');
    this.root.id = 'inventory-screen';
    this.root.className = 'hidden';

    const panel = document.createElement('div');
    panel.className = 'inv-panel';

    const header = document.createElement('div');
    header.className = 'inv-header';
    header.innerHTML = '<b>物品栏</b><span>按 <kbd>E</kbd> 关闭 · 左键整叠 / 右键单个</span>';
    panel.appendChild(header);

    panel.appendChild(this.buildLabel('主背包'));
    panel.appendChild(this.buildInventoryGrid(MAIN_START, MAIN_SIZE, 'inv-grid'));

    panel.appendChild(this.buildLabel('快捷栏'));
    panel.appendChild(this.buildInventoryGrid(HOTBAR_START, HOTBAR_SIZE, 'inv-grid inv-hotbar'));

    panel.appendChild(this.buildLabel('创造物品栏（左键取一整叠 / 右键取一个）'));
    panel.appendChild(this.buildCreativeGrid());

    this.root.appendChild(panel);

    this.heldElement = document.createElement('div');
    this.heldElement.id = 'inv-held';
    this.heldCanvas = document.createElement('canvas');
    this.heldCount = document.createElement('span');
    this.heldElement.append(this.heldCanvas, this.heldCount);
    this.root.appendChild(this.heldElement);

    document.body.appendChild(this.root);

    this.bindEvents();
    this.inventory.onChange = () => this.refresh();
    this.refresh();
  }

  // ---------------------------------------------------------------- DOM 构建

  private buildLabel(text: string): HTMLDivElement {
    const label = document.createElement('div');
    label.className = 'inv-label';
    label.textContent = text;
    return label;
  }

  private buildInventoryGrid(start: number, size: number, className: string): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = className;
    for (let i = 0; i < size; i++) {
      const index = start + i;
      const slot = this.createSlot();
      slot.dataset.index = String(index);
      slot.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.handleSlotClick(index, event.button);
      });
      this.slotElements.set(index, slot);
      grid.appendChild(slot);
    }
    return grid;
  }

  private buildCreativeGrid(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'inv-grid inv-creative';
    for (const itemId of PLACEABLE_ITEMS) {
      const slot = this.createSlot();
      slot.title = itemName(itemId);
      const canvas = slot.querySelector('canvas')!;
      drawItemIcon(canvas, this.atlas, itemId, 28);
      slot.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const amount = event.button === 2 ? 1 : maxStackOf(itemId);
        this.inventory.add(itemId, amount);
      });
      grid.appendChild(slot);
    }
    return grid;
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
  }

  private handleSlotClick(index: number, button: number): void {
    const slot = this.inventory.get(index);

    if (this.held) {
      if (button === 2) {
        // 右键：放下一个
        if (!slot) {
          this.inventory.set(index, { id: this.held.id, count: 1 });
          this.held.count -= 1;
        } else if (slot.id === this.held.id && slot.count < maxStackOf(slot.id)) {
          slot.count += 1;
          this.held.count -= 1;
        }
      } else if (!slot) {
        this.inventory.set(index, this.held);
        this.held = null;
      } else if (slot.id === this.held.id) {
        const room = maxStackOf(slot.id) - slot.count;
        const moved = Math.min(room, this.held.count);
        slot.count += moved;
        this.held.count -= moved;
      } else {
        this.inventory.set(index, this.held);
        this.held = slot;
      }
    } else if (slot) {
      if (button === 2 && slot.count > 1) {
        // 右键：拿一半（向上取整，与原版一致）
        const half = Math.ceil(slot.count / 2);
        this.held = { id: slot.id, count: half };
        slot.count -= half;
      } else {
        this.held = slot;
        this.inventory.set(index, null);
      }
    }

    if (this.held && this.held.count <= 0) this.held = null;
    // 由 inventory.set / 直接改 count 触发刷新，这里再兜一次保证 held 变化也重绘
    this.inventory.notify();
    this.refresh();
  }

  private returnHeldToInventory(): void {
    if (!this.held) return;
    const leftover = this.inventory.add(this.held.id, this.held.count);
    this.held = leftover > 0 ? { id: this.held.id, count: leftover } : null;
    this.refresh();
  }

  // ---------------------------------------------------------------- 显示

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openPanel();
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
    for (const [index, element] of this.slotElements) {
      const slot = this.inventory.get(index);
      const canvas = element.querySelector('canvas')!;
      const count = element.querySelector('.inv-count')!;
      if (slot) {
        drawItemIcon(canvas, this.atlas, slot.id);
        canvas.style.visibility = 'visible';
        count.textContent = slot.count > 1 ? String(slot.count) : '';
      } else {
        canvas.style.visibility = 'hidden';
        count.textContent = '';
      }
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

  dispose(): void {
    this.inventory.onChange = null;
    this.root.remove();
  }
}
