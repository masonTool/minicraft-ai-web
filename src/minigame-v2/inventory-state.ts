import { stackExtras, type ItemStack } from '../core/container/Inventory.ts';
import {
  EMPTY_CURSOR,
  applyClick,
  type ClickButton,
  type ClickResult,
  type CursorState,
  type SlotBinding,
  type SlotRef,
} from './inventory-click.ts';

export type { SlotRef } from './inventory-click.ts';

/** 兼容旧名字（SPEC §2.3 里叫 `SlotSource`，这里保留一个别名便于文档对照） */
export type SlotSourceKind = SlotRef['kind'];

export interface CursorSnapshot {
  held: ItemStack | null;
  fromCreative: boolean;
  origin: SlotRef | null;
}

/**
 * 背包光标状态。
 *
 * Phase 1 只建立状态模型；Phase 2 起所有点击都通过 `applyClick` 结算——
 * 这一层只负责"把状态存住 + 通知界面重画"，规则一律留在 `inventory-click.ts`。
 */
export class InventoryCursor {
  private state: CursorState = { ...EMPTY_CURSOR };

  get held(): ItemStack | null {
    return this.state.held;
  }

  get fromCreative(): boolean {
    return this.state.fromCreative;
  }

  get origin(): SlotRef | null {
    return this.state.origin;
  }

  get heldId(): number {
    return this.state.held?.id ?? 0;
  }

  /** 点击一格（短按 = left，长按 = right），返回这次点击的结果 */
  click(binding: SlotBinding, button: ClickButton = 'left'): ClickResult {
    const result = applyClick(this.state, binding, button);
    if (result.changed) this.state = result.state;
    return result;
  }

  /** 直接设定状态（关闭界面的回收、测试注入用） */
  restore(state: CursorState): void {
    // 附加数据必须跟着走：只复制 id/count 会把附魔/改名弄丢（INV-005）
    this.state = {
      held: state.held ? { id: state.held.id, count: state.held.count, ...stackExtras(state.held) } : null,
      fromCreative: state.fromCreative,
      origin: state.origin ? { ...state.origin } : null,
    };
  }

  hold(stack: ItemStack, origin: SlotRef | null = null, fromCreative = false): void {
    this.restore({ held: stack, fromCreative, origin });
  }

  setCount(count: number): void {
    if (!this.state.held) return;
    this.restore({
      held: count > 0 ? { id: this.state.held.id, count } : null,
      fromCreative: count > 0 ? this.state.fromCreative : false,
      origin: count > 0 ? this.state.origin : null,
    });
  }

  clear(): void {
    this.state = { ...EMPTY_CURSOR };
  }

  snapshot(): CursorSnapshot {
    return {
      held: this.state.held ? { ...this.state.held } : null,
      fromCreative: this.state.fromCreative,
      origin: this.state.origin,
    };
  }
}
