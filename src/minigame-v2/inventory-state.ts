import type { ItemStack } from '../core/container/Inventory.ts';

export type SlotSourceKind = 'inventory' | 'crafting' | 'creative' | 'container';

export interface SlotRef {
  kind: SlotSourceKind;
  index: number;
}

export interface CursorSnapshot {
  held: ItemStack | null;
  fromCreative: boolean;
  origin: SlotRef | null;
}

/**
 * 背包光标状态。
 * Phase 1 只建立状态模型；Phase 2 起所有点击/拖拽都通过它结算。
 */
export class InventoryCursor {
  private heldStack: ItemStack | null = null;
  private creative = false;
  private from: SlotRef | null = null;

  get held(): ItemStack | null {
    return this.heldStack;
  }

  get fromCreative(): boolean {
    return this.creative;
  }

  get origin(): SlotRef | null {
    return this.from;
  }

  hold(stack: ItemStack, origin: SlotRef | null = null, fromCreative = false): void {
    this.heldStack = { id: stack.id, count: stack.count };
    this.from = origin;
    this.creative = fromCreative;
  }

  setCount(count: number): void {
    if (!this.heldStack) return;
    this.heldStack = count > 0 ? { id: this.heldStack.id, count } : null;
    if (!this.heldStack) this.from = null;
  }

  clear(): void {
    this.heldStack = null;
    this.creative = false;
    this.from = null;
  }

  snapshot(): CursorSnapshot {
    return {
      held: this.heldStack ? { ...this.heldStack } : null,
      fromCreative: this.creative,
      origin: this.from,
    };
  }
}
