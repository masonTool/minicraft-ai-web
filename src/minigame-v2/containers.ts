import { Block } from '../core/registry/blocks.ts';
import { Item } from '../core/registry/items.ts';
import { Chest } from '../core/container/Chest.ts';
import { Furnace } from '../core/container/Furnace.ts';
import type { Inventory } from '../core/container/Inventory.ts';
import type { RayHit } from '../core/interaction/Raycast.ts';
import type { World } from '../core/world/World.ts';
import { UiLayer, box, button, slot, text, type UiElement } from './ui-kit/index.ts';

export interface ContainerDeps {
  ui: UiLayer;
  uiHeight: number;
  getWorld(): World;
  inventory: Inventory;
  getSelectedSlot(): number;
  showHud(): void;
}

/**
 * 箱子/熔炉的容器状态、面板 UI 与熔炉 tick。
 * 组合根只负责方块交互分流（床/工作台留在 index）。
 */
export class ContainerSystem {
  private opened: Chest | Furnace | null = null;
  private title = '';
  private lastUi = 0;

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
    if (!this.opened) return 0;
    return this.opened instanceof Chest ? 27 : 3;
  }

  get slotIds(): number[] {
    if (!this.opened) return [];
    const size = this.opened instanceof Chest ? 27 : 3;
    return Array.from({ length: size }, (_, index) => this.opened?.get(index)?.id ?? 0);
  }

  openAt(hit: RayHit): boolean {
    const world = this.deps.getWorld();
    const id = world.getBlock(hit.x, hit.y, hit.z);
    if (id === Block.CHEST) {
      this.opened = world.containers.getOrCreateChest('overworld', hit.x, hit.y, hit.z);
      this.title = '箱子';
    } else if (id === Block.FURNACE) {
      this.opened = world.containers.getOrCreateFurnace('overworld', hit.x, hit.y, hit.z);
      this.title = '熔炉';
    } else {
      return false;
    }
    this.show();
    return true;
  }

  openChestAt(x: number, y: number, z: number): void {
    this.opened = this.deps.getWorld().containers.getOrCreateChest('overworld', x, y, z);
    this.title = '箱子';
    this.show();
  }

  openFurnaceAt(x: number, y: number, z: number): void {
    this.opened = this.deps.getWorld().containers.getOrCreateFurnace('overworld', x, y, z);
    this.title = '熔炉';
    this.show();
  }

  close(): void {
    this.opened = null;
    this.deps.showHud();
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
    const slots = isFurnace ? 3 : 27;
    const cols = isFurnace ? 3 : 9;
    const slotSize = 50;
    const gap = 5;
    const panelW = 620;
    const panelH = 390;
    const panelX = (1024 - panelW) / 2;
    const panelY = (uiHeight - panelH) / 2;
    const gridW = cols * slotSize + (cols - 1) * gap;
    const gridX = panelX + (panelW - gridW) / 2;
    const gridY = panelY + 92;
    const inventory = this.deps.inventory;
    const elements: UiElement[] = [
      text(panelX + 26, panelY + 20, 420, 40, this.title, { fontSize: 28, color: '#ffffff' }),
      button(panelX + panelW - 68, panelY + 20, 42, 42, 'X', () => this.close(), {
        background: 'rgba(30,38,46,0.95)',
        border: 'rgba(180,215,235,0.35)',
        radius: 8,
      }),
      text(gridX, gridY - 28, gridW, 24, isFurnace ? '材料 / 燃料 / 产物' : '点击取出；空槽可放入当前快捷栏物品', {
        fontSize: 13,
        color: 'rgba(200,220,235,0.7)',
      }),
      ...(isFurnace
        ? [
            text(panelX + 26, panelY + 62, panelW - 52, 24, `熔炼进度 ${Math.round(opened.cookRatio * 100)}%`, {
              fontSize: 14,
              color: '#9fe0ff',
            }),
          ]
        : []),
    ];
    for (let i = 0; i < slots; i++) {
      const stack = opened.get(i);
      elements.push(
        slot(
          gridX + (i % cols) * (slotSize + gap),
          gridY + Math.floor(i / cols) * (slotSize + gap),
          slotSize,
          400 + i,
          stack?.id ?? 0,
          stack?.count ?? 0,
          false,
          () => {
            const current = opened.get(i);
            if (current) {
              const remaining = inventory.add(current.id, current.count);
              opened.set(i, remaining > 0 ? { id: current.id, count: remaining } : null);
            } else {
              const held = inventory.get(this.deps.getSelectedSlot());
              if (held) {
                opened.set(i, held);
                inventory.set(this.deps.getSelectedSlot(), null);
              }
            }
            this.show();
          },
        ),
      );
    }
    const hotbarSize = 42;
    const hotbarGap = 5;
    const hotbarW = 9 * hotbarSize + 8 * hotbarGap;
    const hotbarX = panelX + (panelW - hotbarW) / 2;
    const hotbarY = gridY + (isFurnace ? 1 : 3) * (slotSize + gap) + 18;
    elements.push(text(hotbarX, hotbarY - 24, hotbarW, 20, '背包快捷栏 · 点击存入', {
      fontSize: 12,
      color: 'rgba(200,220,235,0.7)',
    }));
    for (let i = 0; i < 9; i++) {
      const stack = inventory.get(i);
      elements.push(
        slot(
          hotbarX + i * (hotbarSize + hotbarGap),
          hotbarY,
          hotbarSize,
          500 + i,
          stack?.id ?? 0,
          stack?.count ?? 0,
          false,
          () => {
            const held = inventory.get(i);
            if (!held) return;
            for (let j = 0; j < slots; j++) {
              if (opened.get(j)) continue;
              opened.set(j, held);
              inventory.set(i, null);
              break;
            }
            this.show();
          },
        ),
      );
    }
    this.deps.ui.setRoot(
      box(0, 0, 1024, uiHeight, [
        box(0, 0, 1024, uiHeight, [], { background: 'rgba(0,0,0,0.55)' }),
        box(panelX, panelY, panelW, panelH, elements, {
          background: 'rgba(16,22,28,0.97)',
          border: 'rgba(170,205,230,0.45)',
          borderWidth: 2,
          radius: 12,
        }),
      ]),
    );
  }
}
