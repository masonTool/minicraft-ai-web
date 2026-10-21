import { RECIPES, type ShapelessRecipe, type ShapedRecipe } from '../core/crafting/Recipes.ts';
import type { CraftingGrid } from '../core/crafting/CraftingGrid.ts';
import type { Inventory } from '../core/container/Inventory.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import { CREATIVE_CATEGORIES, creativeTabFor, type V2CreativeCategory } from './inventory-catalog.ts';
import { recipeFits } from './recipe-book.ts';
import { button, slot, text, type UiElement } from './ui-kit/index.ts';

export interface CreativeTabContext {
  gridX: number;
  gridY: number;
  panelY: number;
  panelH: number;
  slotSize: number;
  gap: number;
  inventory: Inventory;
  items: readonly number[];
  category: V2CreativeCategory;
  query: string;
  page: number;
  setCategory(category: V2CreativeCategory): void;
  setQuery(query: string): void;
  setPage(page: number): void;
  refresh(): void;
  onSearch(): void;
}

export function buildCreativeTab(ctx: CreativeTabContext): UiElement[] {
  const elements: UiElement[] = [];
  const query = ctx.query.trim().toLowerCase();
  const filtered = ctx.items.filter((id) => {
    if (ctx.category !== 'all' && creativeTabFor(id) !== ctx.category) return false;
    return !query || itemLabel(id).toLowerCase().includes(query);
  });
  const rows = Math.max(2, Math.min(5, Math.floor((ctx.panelH - 150) / (ctx.slotSize + ctx.gap))));
  const pageSize = rows * 9;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.max(0, Math.min(ctx.page, pages - 1));
  const startIndex = page * pageSize;
  const list = filtered.slice(startIndex, startIndex + pageSize);
  for (let index = 0; index < CREATIVE_CATEGORIES.length; index++) {
    const category = CREATIVE_CATEGORIES[index]!;
    elements.push(
      button(ctx.gridX + index * 74, ctx.panelY + 50, 70, 28, category.label, () => {
        ctx.setCategory(category.key);
        ctx.setPage(0);
        ctx.refresh();
      }, {
        background: ctx.category === category.key ? 'rgba(80,120,105,0.95)' : 'rgba(32,44,52,0.95)',
        border: 'rgba(180,215,235,0.35)',
        radius: 6,
        fontSize: 12,
      }),
    );
  }
  elements.push(
    button(ctx.gridX + 5 * 74, ctx.panelY + 50, 95, 28, ctx.query ? '搜索中' : '搜索', () => {
      ctx.onSearch();
    }, { background: 'rgba(32,44,52,0.95)', border: 'rgba(180,215,235,0.35)', radius: 6, fontSize: 12 }),
    button(ctx.gridX + 5 * 74 + 101, ctx.panelY + 50, 85, 28, '整理', () => {
      const stacks = [];
      for (let i = 0; i < 36; i++) {
        const stack = ctx.inventory.get(i);
        if (stack) stacks.push({ id: stack.id, count: stack.count });
      }
      stacks.sort((a, b) => a.id - b.id);
      for (let i = 0; i < 36; i++) ctx.inventory.set(i, stacks[i] ?? null);
      ctx.setPage(0);
      ctx.refresh();
    }, { background: 'rgba(32,44,52,0.95)', border: 'rgba(180,215,235,0.35)', radius: 6, fontSize: 12 }),
  );
  for (let i = 0; i < list.length; i++) {
    const id = list[i]!;
    elements.push(
      slot(ctx.gridX + (i % 9) * (ctx.slotSize + ctx.gap), ctx.gridY + Math.floor(i / 9) * (ctx.slotSize + ctx.gap), ctx.slotSize, i, id, 0, false, () => {
        ctx.inventory.add(id, 64);
        ctx.refresh();
      }),
    );
  }
  const footerY = ctx.gridY + rows * (ctx.slotSize + ctx.gap) + 10;
  elements.push(text(ctx.gridX, footerY, 420, 24, `${filtered.length} 项 · ${page + 1}/${pages}`, {
    fontSize: 13,
    color: 'rgba(200,220,235,0.65)',
  }));
  elements.push(button(ctx.gridX + 420, footerY - 4, 75, 28, '上一页', () => {
    ctx.setPage(Math.max(0, page - 1));
    ctx.refresh();
  }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6, fontSize: 12 }));
  elements.push(button(ctx.gridX + 505, footerY - 4, 75, 28, '下一页', () => {
    ctx.setPage(Math.min(pages - 1, page + 1));
    ctx.refresh();
  }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6, fontSize: 12 }));
  return elements;
}

export interface RecipeTabContext {
  gridX: number;
  gridY: number;
  panelY: number;
  panelH: number;
  query: string;
  size: 2 | 3;
  page: number;
  setQuery(query: string): void;
  setSize(size: 2 | 3): void;
  setPage(page: number): void;
  fillRecipe(recipe: ShapedRecipe | ShapelessRecipe): void;
  refresh(): void;
  onSearch(): void;
}

export function buildRecipeTab(ctx: RecipeTabContext): UiElement[] {
  const elements: UiElement[] = [];
  const query = ctx.query.trim().toLowerCase();
  const recipes = RECIPES.filter((recipe) => recipeFits(recipe, ctx.size)).filter((recipe) => {
    if (!query) return true;
    return itemLabel(recipe.result.id).toLowerCase().includes(query);
  });
  const rows = Math.max(1, Math.min(3, Math.floor((ctx.panelH - 190) / 86)));
  const perPage = rows * 3;
  const pages = Math.max(1, Math.ceil(recipes.length / perPage));
  const page = Math.max(0, Math.min(ctx.page, pages - 1));
  elements.push(button(ctx.gridX, ctx.panelY + 52, 150, 30, ctx.query ? `搜索：${ctx.query}` : '搜索配方', () => {
    ctx.onSearch();
  }, { background: 'rgba(32,44,52,0.95)', border: 'rgba(180,215,235,0.35)', radius: 6 }));
  elements.push(button(ctx.gridX + 160, ctx.panelY + 52, 110, 30, `${ctx.size}x${ctx.size}`, () => {
    ctx.setSize(ctx.size === 2 ? 3 : 2);
    ctx.setPage(0);
    ctx.refresh();
  }, { background: 'rgba(32,44,52,0.95)', border: 'rgba(180,215,235,0.35)', radius: 6 }));
  const start = page * perPage;
  for (let i = 0; i < Math.min(perPage, recipes.length - start); i++) {
    const recipe = recipes[start + i]!;
    const result = recipe.result;
    const x = ctx.gridX + (i % 3) * 160;
    const y = ctx.gridY + Math.floor(i / 3) * 86;
    elements.push(slot(x, y, 50, 300 + i, result.id, result.count, false, () => ctx.fillRecipe(recipe)));
    elements.push(text(x + 58, y + 4, 96, 26, itemLabel(result.id), { fontSize: 14, color: '#dcecf5' }));
    elements.push(text(x + 58, y + 30, 96, 20, `x${result.count}`, { fontSize: 12, color: 'rgba(190,215,230,0.65)' }));
  }
  const footerY = ctx.gridY + rows * 86 + 4;
  elements.push(text(ctx.gridX, footerY, 400, 26, `配方 ${page + 1}/${pages} · ${recipes.length} 条`, {
    fontSize: 13,
    color: 'rgba(200,220,235,0.65)',
  }));
  elements.push(button(ctx.gridX, footerY + 28, 90, 34, '上一页', () => {
    ctx.setPage(Math.max(0, page - 1));
    ctx.refresh();
  }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6 }));
  elements.push(button(ctx.gridX + 100, footerY + 28, 90, 34, '下一页', () => {
    ctx.setPage(Math.min(pages - 1, page + 1));
    ctx.refresh();
  }, { background: 'rgba(32,42,50,0.95)', border: 'rgba(190,220,240,0.35)', radius: 6 }));
  return elements;
}

export interface ItemTabContext {
  gridX: number;
  gridY: number;
  slotSize: number;
  gap: number;
  inventory: Inventory;
  selectedSlot: number;
  onSelect(slot: number): void;
  onQuickMove(slot: number): void;
  onSecondaryTap(slot: number): void;
  onDrop(from: number, to: number): void;
  refresh(): void;
}

export function buildItemTab(ctx: ItemTabContext): UiElement[] {
  const elements: UiElement[] = [];
  for (let j = 0; j < 27; j++) {
    const i = j + 9;
    const stack = ctx.inventory.get(i);
    elements.push(
      slot(ctx.gridX + (j % 9) * (ctx.slotSize + ctx.gap), ctx.gridY + Math.floor(j / 9) * (ctx.slotSize + ctx.gap), ctx.slotSize, i, stack?.id ?? 0, stack?.count ?? 0, false, () => ctx.onQuickMove(i), (from, to) => ctx.onDrop(from.index, to.index), () => ctx.onSecondaryTap(i)),
    );
  }
  const hotbarY = ctx.gridY + 3 * (ctx.slotSize + ctx.gap) + 14;
  elements.push(text(ctx.gridX, hotbarY - 22, 300, 20, '快捷栏', { fontSize: 12, color: 'rgba(200,220,235,0.65)' }));
  for (let i = 0; i < 9; i++) {
    const stack = ctx.inventory.get(i);
    elements.push(
      slot(ctx.gridX + i * (ctx.slotSize + ctx.gap), hotbarY, ctx.slotSize, i, stack?.id ?? 0, stack?.count ?? 0, i === ctx.selectedSlot, () => ctx.onSelect(i), (from, to) => ctx.onDrop(from.index, to.index), () => ctx.onSecondaryTap(i)),
    );
  }
  return elements;
}

export interface CraftingPanelContext {
  craftX: number;
  craftY: number;
  craftSlot: number;
  craftGap: number;
  outputX: number;
  panelY: number;
  crafting: CraftingGrid;
  inventory: Inventory;
  fixedSize?: boolean;
  onToggleSize(): void;
  onDrop(from: number, to: number): void;
  onTapSlot(craftIndex: number): void;
  onSecondaryTap(craftIndex: number): void;
  onOutput(): void;
  refresh(): void;
}

export function buildCraftingPanel(ctx: CraftingPanelContext): UiElement[] {
  const elements: UiElement[] = [];
  elements.push(
    button(ctx.craftX, ctx.panelY + 22, 110, 28, ctx.fixedSize ? '工作台 3x3' : `${ctx.crafting.size}x${ctx.crafting.size}`, () => ctx.onToggleSize(), {
      background: 'rgba(32, 44, 52, 0.95)',
      border: 'rgba(180, 215, 235, 0.35)',
      radius: 6,
    }),
  );
  for (let i = 0; i < ctx.crafting.size * ctx.crafting.size; i++) {
    const stack = ctx.crafting.get(i);
    elements.push(
      slot(
        ctx.craftX + (i % ctx.crafting.size) * (ctx.craftSlot + ctx.craftGap),
        ctx.craftY + Math.floor(i / ctx.crafting.size) * (ctx.craftSlot + ctx.craftGap),
        ctx.craftSlot,
        100 + i,
        stack?.id ?? 0,
        stack?.count ?? 0,
        false,
        () => ctx.onTapSlot(i),
        (from, to) => ctx.onDrop(from.index, to.index),
        () => ctx.onSecondaryTap(i),
      ),
    );
  }
  const result = ctx.crafting.result;
  elements.push(text(ctx.outputX, ctx.craftY + 2, 100, 24, '产物', { fontSize: 13, color: 'rgba(210,230,240,0.7)' }));
  elements.push(
    slot(ctx.outputX, ctx.craftY + 26, ctx.craftSlot, 200, result?.id ?? 0, result?.count ?? 0, false, () => ctx.onOutput()),
  );
  return elements;
}


export interface InventoryChromeContext {
  panelX: number;
  panelY: number;
  panelW: number;
  railW: number;
  tab: 'items' | 'creative' | 'recipes';
  title?: string;
  onTab(tab: 'items' | 'creative' | 'recipes'): void;
  onClose(): void;
}

export function buildInventoryChrome(ctx: InventoryChromeContext): UiElement[] {
  const tabStyle = (active: boolean): Record<string, unknown> => ({
    background: active ? 'rgba(80, 120, 105, 0.95)' : 'rgba(30, 38, 46, 0.92)',
    border: 'rgba(180, 215, 235, 0.35)',
    radius: 8,
  });
  return [
    text(ctx.panelX + 24, ctx.panelY + 20, 300, 42, ctx.title ?? '背包', { fontSize: 30, color: '#ffffff' }),
    button(ctx.panelX + 24, ctx.panelY + 86, ctx.railW - 24, 52, '物品', () => ctx.onTab('items'), tabStyle(ctx.tab === 'items')),
    button(ctx.panelX + 24, ctx.panelY + 150, ctx.railW - 24, 52, '创造', () => ctx.onTab('creative'), tabStyle(ctx.tab === 'creative')),
    button(ctx.panelX + 24, ctx.panelY + 214, ctx.railW - 24, 52, '配方', () => ctx.onTab('recipes'), tabStyle(ctx.tab === 'recipes')),
    button(ctx.panelX + ctx.panelW - 72, ctx.panelY + 20, 44, 44, 'X', () => ctx.onClose(), {
      background: 'rgba(30, 38, 46, 0.95)',
      border: 'rgba(180, 215, 235, 0.35)',
      radius: 8,
    }),
  ];
}

export interface EquipmentRowContext {
  x: number;
  y: number;
  slotSize: number;
  gap: number;
  inventory: Inventory;
  onTap(slotIndex: number): void;
}

/** 护甲 36-39 + 副手 40。 */
export function buildEquipmentRow(ctx: EquipmentRowContext): UiElement[] {
  const elements: UiElement[] = [];
  elements.push(text(ctx.x, ctx.y - 20, 180, 18, '护甲', { fontSize: 12, color: 'rgba(200,220,235,0.7)' }));
  elements.push(text(ctx.x + 5 * (ctx.slotSize + ctx.gap), ctx.y - 20, 80, 18, '副手', { fontSize: 12, color: 'rgba(200,220,235,0.7)' }));
  for (let i = 0; i < 4; i++) {
    const index = 36 + i;
    const stack = ctx.inventory.get(index);
    elements.push(
      slot(ctx.x + i * (ctx.slotSize + ctx.gap), ctx.y, ctx.slotSize, index, stack?.id ?? 0, stack?.count ?? 0, false, () => ctx.onTap(index)),
    );
  }
  const offhand = ctx.inventory.get(40);
  elements.push(
    slot(ctx.x + 5 * (ctx.slotSize + ctx.gap), ctx.y, ctx.slotSize, 40, offhand?.id ?? 0, offhand?.count ?? 0, false, () => ctx.onTap(40)),
  );
  return elements;
}
