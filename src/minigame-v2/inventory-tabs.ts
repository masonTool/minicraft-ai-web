import { RECIPES, type ShapelessRecipe, type ShapedRecipe } from '../core/crafting/Recipes.ts';
import type { CraftingGrid } from '../core/crafting/CraftingGrid.ts';
import type { Inventory } from '../core/container/Inventory.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import { creativeTabFor, type V2CreativeCategory } from './inventory-catalog.ts';
import { recipeFits } from './recipe-book.ts';
import { button, box, MC, slot, text, type SlotButton, type UiElement } from './ui-kit/index.ts';

/**
 * 面板里每个格子的"身份"。
 *
 * ⚠️ 这已经不是"一个下标"了：玩家背包的 9 号与合成格的 9 号是两格（INV-007），
 * 所以回调统一带上 `kind`，由组合根去解析成 `SlotBinding` 再交给 `applyClick`。
 */
export type PanelSlotKind = 'inventory' | 'crafting' | 'creative';

export interface PanelSlotHandlers {
  /** 短按 = left / 长按 = right */
  onSlot(kind: PanelSlotKind, index: number, button: SlotButton): void;
  /** 跨格拖拽（从哪一格拖到哪一格） */
  onSlotDrop(from: { kind: PanelSlotKind; index: number }, to: { kind: PanelSlotKind; index: number }): void;
}

export interface CreativeTabContext extends PanelSlotHandlers {
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
  /**
   * 把"这一页实际画出来的物品"回写给组合根。
   *
   * ⚠️ 必须回写：点击索引是**页内下标**，如果组合根自己再筛一遍（分类/搜索/分页
   * 三处任何一处算法不同），点第 3 格会拿走第 4 格的方块——这种错在真机上
   * 只会表现为"拿错了东西"，查起来非常费劲。
   */
  setPageList(list: readonly number[]): void;
}

export function buildCreativeTab(ctx: CreativeTabContext): UiElement[] {
  const elements: UiElement[] = [];
  const query = ctx.query.trim().toLowerCase();
  const filtered = ctx.items.filter((id) => {
    if (ctx.category !== 'all' && creativeTabFor(id) !== ctx.category) return false;
    return !query || itemLabel(id).toLowerCase().includes(query);
  });

  // 顶部一行：搜索 + 整理（**没有分类按钮**——分类在左轨上，重复一遍就是两套入口）
  const barY = ctx.gridY - 26;
  const btn = (x: number, w: number, label: string, onClick: () => void): UiElement =>
    button(x, barY, w, 22, label, onClick, {
      background: MC.button,
      bevel: [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
      color: MC.text,
      fontSize: 12,
      borderWidth: 2,
    });
  elements.push(
    btn(ctx.gridX, 78, ctx.query ? `搜索：${ctx.query}` : '搜索', () => ctx.onSearch()),
    btn(ctx.gridX + 84, 54, '整理', () => {
      const stacks: { id: number; count: number }[] = [];
      for (let i = 0; i < 36; i++) {
        const stack = ctx.inventory.get(i);
        if (stack) stacks.push({ id: stack.id, count: stack.count });
      }
      stacks.sort((a, b) => a.id - b.id);
      for (let i = 0; i < 36; i++) ctx.inventory.set(i, stacks[i] ?? null);
      ctx.setPage(0);
      ctx.refresh();
    }),
  );

  // 网格：行数按**可用高度**算（顶部工具条 26 + 底部分页 26）
  const avail = ctx.panelH - (ctx.gridY - ctx.panelY) - 26 - 30;
  const rows = Math.max(2, Math.min(5, Math.floor(avail / (ctx.slotSize + ctx.gap))));
  const pageSize = rows * 9;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.max(0, Math.min(ctx.page, pages - 1));
  const startIndex = page * pageSize;
  const list = filtered.slice(startIndex, startIndex + pageSize);
  ctx.setPageList(list);

  for (let i = 0; i < list.length; i++) {
    const id = list[i]!;
    elements.push(
      slot(
        ctx.gridX + (i % 9) * (ctx.slotSize + ctx.gap),
        ctx.gridY + Math.floor(i / 9) * (ctx.slotSize + ctx.gap),
        ctx.slotSize,
        i,
        id,
        0,
        false,
        (button) => ctx.onSlot('creative', i, button),
      ),
    );
  }

  // 底部一行：`共 N 项 · 第 x/y 页` + 两颗翻页键（全部在面板内，不横向溢出）
  const footerY = ctx.gridY + rows * (ctx.slotSize + ctx.gap) + 4;
  elements.push(
    text(ctx.gridX, footerY + 3, 240, 20, `共 ${filtered.length} 项 · ${page + 1}/${pages}`, {
      fontSize: 11,
      color: MC.textMuted,
    }),
    btn(ctx.gridX + ctx.slotSize * 6, 54, '上一页', () => {
      ctx.setPage(Math.max(0, page - 1));
      ctx.refresh();
    }),
    btn(ctx.gridX + ctx.slotSize * 6 + 60, 54, '下一页', () => {
      ctx.setPage(Math.min(pages - 1, page + 1));
      ctx.refresh();
    }),
  );
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

export interface ItemTabContext extends PanelSlotHandlers {
  gridX: number;
  gridY: number;
  slotSize: number;
  gap: number;
  inventory: Inventory;
  selectedSlot: number;
}

/**
 * 物品页：27 主背包 + 独立 9 格快捷栏。
 *
 * ⚠️ 快捷栏那 9 格**点击不切选中**——选中（`selectedSlot`）是"手上拿哪一格"，
 * 属于 HUD 的语义；背包界面里点它应当和点主背包一样地搬东西（原版如此）。
 */
export function buildItemTab(ctx: ItemTabContext): UiElement[] {
  const elements: UiElement[] = [];
  const drop = (to: number) => (from: { index: number }) => ctx.onSlotDrop({ kind: 'inventory', index: from.index }, { kind: 'inventory', index: to });
  for (let j = 0; j < 27; j++) {
    const i = j + 9;
    const stack = ctx.inventory.get(i);
    elements.push(
      slot(
        ctx.gridX + (j % 9) * (ctx.slotSize + ctx.gap),
        ctx.gridY + Math.floor(j / 9) * (ctx.slotSize + ctx.gap),
        ctx.slotSize,
        i,
        stack?.id ?? 0,
        stack?.count ?? 0,
        false,
        (button) => ctx.onSlot('inventory', i, button),
        drop(i),
      ),
    );
  }
  const hotbarY = ctx.gridY + 3 * (ctx.slotSize + ctx.gap) + 14;
  elements.push(text(ctx.gridX, hotbarY - 22, 300, 20, '快捷栏', { fontSize: 12, color: 'rgba(200,220,235,0.65)' }));
  for (let i = 0; i < 9; i++) {
    const stack = ctx.inventory.get(i);
    elements.push(
      slot(
        ctx.gridX + i * (ctx.slotSize + ctx.gap),
        hotbarY,
        ctx.slotSize,
        i,
        stack?.id ?? 0,
        stack?.count ?? 0,
        i === ctx.selectedSlot,
        (button) => ctx.onSlot('inventory', i, button),
        drop(i),
      ),
    );
  }
  return elements;
}

export interface CraftingPanelContext extends PanelSlotHandlers {
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
        (button) => ctx.onSlot('crafting', i, button),
        (from) => ctx.onSlotDrop({ kind: 'crafting', index: from.index - 100 }, { kind: 'crafting', index: i }),
      ),
    );
  }
  const result = ctx.crafting.result;
  elements.push(text(ctx.outputX, ctx.craftY + 2, 100, 24, '产物', { fontSize: 13, color: 'rgba(210,230,240,0.7)' }));
  // 产物槽 **只取不放**（INV-015）：`takeOnly` 既管着"点它只取产物"，也管着画成金色的边
  elements.push(
    slot(
      ctx.outputX,
      ctx.craftY + 26,
      ctx.craftSlot,
      200,
      result?.id ?? 0,
      result?.count ?? 0,
      false,
      () => ctx.onOutput(),
      undefined,
      true,
    ),
  );
  return elements;
}

// ---------------------------------------------------------------------------
// 外壳：左右两条竖轨（对齐 Web 版 .inv-shell / .inv-rail-left / .inv-rail-right）
// ---------------------------------------------------------------------------

/**
 * 左轨的 5 颗配方分类（对齐 Web 版 `RECIPE_BOOK_TABS_POCKET`）。
 *
 * ⚠️ 这是 Web 版最重要的结构：**分类直接挂在左轨上**，点一下就换面板内容，
 * 不需要"先点创造、再点分类"两级跳。v2 之前就是两级，所以用起来"一脸蒙"。
 */
export const RAIL_CATEGORIES: ReadonlyArray<{ key: V2CreativeCategory; label: string; glyph: string }> = [
  { key: 'all', label: '全部', glyph: '⌕' },
  { key: 'building', label: '建筑', glyph: '▤' },
  { key: 'equipment', label: '装备', glyph: '⚔' },
  { key: 'items', label: '物品', glyph: '◆' },
  { key: 'nature', label: '自然', glyph: '❦' },
];

/** 右轨的模式键（对齐 Web 版 `.inv-pocket-side` 那 3 颗） */
export type PanelMode = 'crafting' | 'armor' | 'creative';

export const RAIL_MODES: ReadonlyArray<{ key: PanelMode; label: string; glyph: string }> = [
  { key: 'creative', label: '创造', glyph: '✦' },
  { key: 'crafting', label: '合成', glyph: '▦' },
  { key: 'armor', label: '盔甲', glyph: '⛨' },
];

export interface RailContext {
  /** 左轨左上角 */
  x: number;
  y: number;
  /** 轨道宽度（Web 版是 40） */
  w: number;
  h: number;
  tab: IconTab;
  onTab(tab: IconTab): void;
  /** 右轨（同一函数画两条轨，右轨靠 x 定位） */
  side: 'left' | 'right';
  /** 左轨专用：当前选中的配方分类（只有左轨前 5 颗用得到） */
  category?: V2CreativeCategory;
  onCategory?(category: V2CreativeCategory): void;
  /** 右轨专用：当前面板模式 */
  mode?: PanelMode;
  onMode?(mode: PanelMode): void;
}

/** 左轨的"物品栏"（回到普通背包，不带分类） */
export type IconTab = 'inventory' | 'category' | 'creative' | 'recipes';

const RAIL_BTN = 36;
const RAIL_GAP = 4;

/** 一颗轨道按钮：灰底 + 斜角；选中 = 淡黄绿 + 凹进去（`.inv-pocket-tab.active`） */
function railButton(
  x: number,
  y: number,
  size: number,
  label: string,
  glyph: string,
  active: boolean,
  onClick: () => void,
): UiElement {
  return button(x, y, size, size, `${glyph}`, onClick, {
    background: active ? MC.tabActive : MC.button,
    bevel: active
      ? [MC.bevelDark, MC.bevelLight, MC.bevelLight, MC.bevelDark]
      : [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
    color: MC.text,
    fontSize: 17,
    borderWidth: 2,
    // 无障碍/测试用：把中文名塞进 label 的 tooltip 位置不现实（canvas 没有 title），
    // 所以界面上用小图标 + 面板内标题来标识当前分类
    ...(label ? { radius: 0 } : {}),
  });
}

export function buildRail(ctx: RailContext): UiElement[] {
  const els: UiElement[] = [];
  const inner = ctx.x;
  if (ctx.side === 'left') {
    // 上：5 颗配方分类
    for (let i = 0; i < RAIL_CATEGORIES.length; i++) {
      const cat = RAIL_CATEGORIES[i]!;
      const active = ctx.tab === 'category' && ctx.category === cat.key;
      els.push(
        railButton(
          inner,
          ctx.y + i * (RAIL_BTN + 2),
          RAIL_BTN,
          cat.label,
          cat.glyph,
          active,
          () => ctx.onCategory?.(cat.key),
        ),
      );
    }
    // 下：一颗"物品栏"（贴轨道底部，对齐 Web 版的 `inv-pocket-inv-tab`）
    //
    // ⚠️ 必须**夹在分类下方**：5 颗分类已经占掉 5×36+4×2 = 188，而面板高度
    // 只有 194 左右时，"贴底"那颗会正好压在最后一颗分类上（第一版就是这样）。
    const catsBottom = ctx.y + RAIL_CATEGORIES.length * (RAIL_BTN + 2);
    const wantY = ctx.y + ctx.h - RAIL_BTN;
    const invY = Math.max(catsBottom + 2, Math.min(wantY, ctx.y + ctx.h - RAIL_BTN));
    els.push(
      railButton(inner, invY, RAIL_BTN, '物品栏', '🎒', ctx.tab === 'inventory', () => ctx.onTab('inventory')),
    );
    return els;
  }
  // 右轨：3 颗模式键，垂直居中（Web 版也是居中偏下）
  const totalH = RAIL_MODES.length * RAIL_BTN + (RAIL_MODES.length - 1) * RAIL_GAP;
  const top = ctx.y + (ctx.h - totalH) / 2;
  for (let i = 0; i < RAIL_MODES.length; i++) {
    const mode = RAIL_MODES[i]!;
    const active = (mode.key === 'creative' && ctx.tab === 'creative') || (mode.key === ctx.mode && ctx.tab !== 'creative');
    els.push(
      railButton(inner, top + i * (RAIL_BTN + RAIL_GAP), RAIL_BTN, mode.label, mode.glyph, active, () =>
        ctx.onMode?.(mode.key),
      ),
    );
  }
  return els;
}

export interface PanelHeaderContext {
  x: number;
  y: number;
  w: number;
  /** 面板内标题（Web 版是"没有标题"，这里保留一行小字说明当前分类，方便定位） */
  title: string;
  hint?: string;
  onClose(): void;
  /** 配方书开关（只在物品栏模式显示，对齐 `.inv-pocket-recipe-toggle`） */
  onRecipes?: () => void;
}

/**
 * 面板顶栏（对齐 `.inv-header`，高 24）。
 *
 * Web 版这一行**没有标题字**，只有右边两颗小键（配方书 / 关闭）。
 * v2 之前是 30px 的"背包"大字 + X，占掉一整行——那个也是"不像原版"的一部分。
 */
export function buildPanelHeader(ctx: PanelHeaderContext): UiElement[] {
  const els: UiElement[] = [
    text(ctx.x, ctx.y + 3, 300, 20, ctx.title, { fontSize: 13, color: MC.text }),
  ];
  if (ctx.hint) {
    els.push(text(ctx.x, ctx.y + 3, ctx.w - 100, 20, ctx.hint, { fontSize: 11, color: MC.textMuted, align: 'right' }));
  }
  const btnH = 20;
  els.push(
    button(ctx.x + ctx.w - 58, ctx.y, 54, btnH, '关闭', () => ctx.onClose(), {
      background: MC.button,
      bevel: [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
      color: MC.text,
      fontSize: 12,
      borderWidth: 2,
    }),
  );
  if (ctx.onRecipes) {
    els.push(
      button(ctx.x + ctx.w - 58 - 58, ctx.y, 54, btnH, '配方书', () => ctx.onRecipes?.(), {
        background: MC.button,
        bevel: [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
        color: MC.text,
        fontSize: 12,
        borderWidth: 2,
      }),
    );
  }
  // 标题栏下面一道浅缝（`.inv-header` 的 border-bottom）
  els.push(box(ctx.x, ctx.y + btnH + 4, ctx.w, 2, [], { background: '#a9a9a9' }));
  return els;
}

/**
 * 底部独立快捷栏（对齐 `.inv-hotbar-dock`）。
 *
 * ⚠️ 这是与 v2 现状**最大的一处差别**：v2 把 9 格快捷栏塞在面板内部，
 * 而原版（Web 版）里它**在面板之外**、贴屏幕底边，面板开关时它一直在。
 */
export interface HotbarDockContext {
  /** 屏幕宽（用于居中） */
  screenW: number;
  screenH: number;
  slotSize: number;
  gap: number;
  inventory: Inventory;
  selectedSlot: number;
  onSlot(index: number, button: SlotButton): void;
  onDrop(from: number, to: number): void;
}

export function buildHotbarDock(ctx: HotbarDockContext): UiElement[] {
  const totalW = 9 * ctx.slotSize + 8 * ctx.gap;
  const x = (ctx.screenW - totalW) / 2;
  const y = ctx.screenH - ctx.slotSize - 8;
  const els: UiElement[] = [];
  // 灰色底板（原版快捷栏是一整条凹槽，不是 9 个散格）
  els.push(
    box(x - 3, y - 3, totalW + 6, ctx.slotSize + 6, [], {
      background: MC.panel,
      bevel: [MC.bevelLight, MC.bevelDark, MC.bevelDark, MC.bevelLight],
      borderWidth: 2,
    }),
  );
  for (let i = 0; i < 9; i++) {
    const stack = ctx.inventory.get(i);
    els.push(
      slot(
        x + i * (ctx.slotSize + ctx.gap),
        y,
        ctx.slotSize,
        i,
        stack?.id ?? 0,
        stack?.count ?? 0,
        i === ctx.selectedSlot,
        (button) => ctx.onSlot(i, button),
        (from) => ctx.onDrop(from.index, i),
      ),
    );
  }
  return els;
}

/**
 * 护甲列（对齐 `.inv-grid.inv-armor`：**竖排** 4 格 + 下面一格副手）。
 *
 * v2 之前是"护甲 4 格横排 + 副手另起一行"，原版是竖着一条。
 */
export interface ArmorColumnContext {
  x: number;
  y: number;
  slotSize: number;
  inventory: Inventory;
  onTap(slotIndex: number, button: SlotButton): void;
  onDrop(from: number, to: number): void;
}

export function buildArmorColumn(ctx: ArmorColumnContext): UiElement[] {
  const els: UiElement[] = [];
  for (let i = 0; i < 4; i++) {
    const index = 36 + i;
    const stack = ctx.inventory.get(index);
    els.push(
      slot(
        ctx.x,
        ctx.y + i * ctx.slotSize,
        ctx.slotSize,
        index,
        stack?.id ?? 0,
        stack?.count ?? 0,
        false,
        (button) => ctx.onTap(index, button),
        (from) => ctx.onDrop(from.index, index),
      ),
    );
  }
  // 副手放在盔甲下面空一行（原版就是这样，靠位置区分）
  const offhand = ctx.inventory.get(40);
  els.push(
    slot(
      ctx.x,
      ctx.y + 5 * ctx.slotSize,
      ctx.slotSize,
      40,
      offhand?.id ?? 0,
      offhand?.count ?? 0,
      false,
      (button) => ctx.onTap(40, button),
      (from) => ctx.onDrop(from.index, 40),
    ),
  );
  return els;
}
