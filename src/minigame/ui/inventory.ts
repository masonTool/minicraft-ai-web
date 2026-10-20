import * as THREE from 'three';
import type { ItemStack } from '../../core/container/Inventory.ts';
import { CraftingGrid } from '../../core/crafting/CraftingGrid.ts';
import { buildRecipeEntries, type RecipeEntry } from '../../core/crafting/RecipeBook.ts';
import type { Recipe } from '../../core/crafting/Recipes.ts';
import { Block, blockDef } from '../../core/registry/blocks.ts';
import { itemName } from '../../core/registry/items.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { drawBlockIcon } from './icons.ts';
import { contains, drawButton, drawPanel, drawText, type Rect } from './widgets.ts';

export type InventoryAction =
  | { type: 'select'; index: number }
  | { type: 'swap'; index: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'give'; id: number }
  | { type: 'quick' }
  | { type: 'drop' }
  | { type: 'craftRecipe'; recipe: Recipe }
  | null;

export interface InventoryCallbacks {
  /** 从当前快捷栏取 1 个材料；没有则返回 null */
  takeSelectedOne?: () => ItemStack | null;
  /** 把合成格/产物放回真实背包 */
  addStack?: (stack: ItemStack) => void;
  /** 3×3 工作台是否可用（附近有工作台方块） */
  canUseWorkbench?: () => boolean;
  showToast?: (message: string) => void;
}

export interface Inventory {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  setSelected(index: number): void;
  setSlots(slots: readonly (ItemStack | null)[]): void;
  handleDown(clientX: number, clientY: number, screenWidth: number, screenHeight: number): boolean;
  handleMove(clientX: number, clientY: number, screenWidth: number, screenHeight: number): void;
  handleUp(clientX: number, clientY: number, screenWidth: number, screenHeight: number): InventoryAction;
  render(renderer: THREE.WebGLRenderer): void;
}

/**
 * 真实 41 格背包面板（WX-023/028 第一版）
 *
 * 9×5 网格：0-8 快捷栏、9-35 主背包、36-40 盔甲/副手（先当普通槽显示）。
 * 点快捷栏槽位 = 选中；点其他有物品的槽位 = 与当前快捷栏槽位交换。
 */
export function createInventory(
  atlas: TextureAtlas,
  slots: readonly (ItemStack | null)[],
  screenWidth: number,
  screenHeight: number,
  callbacks: InventoryCallbacks = {},
): Inventory {
  const doc = (globalThis as unknown as { document: Document }).document;
  const canvas = doc.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(320, Math.round((1024 * screenHeight) / Math.max(1, screenWidth)));
  const context = canvas.getContext('2d');
  if (context) context.imageSmoothingEnabled = false;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, (2 * canvas.height) / canvas.width),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  scene.add(mesh);

  const cols = 9;
  const rows = 5;
  const slot = 48;
  const gap = 6;
  const gridWidth = cols * slot + (cols - 1) * gap;
  const gridHeight = rows * slot + (rows - 1) * gap;
  const craftWidth = 270;
  const panelWidth = gridWidth + 40 + craftWidth;
  const panelHeight = gridHeight + 136;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const panelRect: Rect = { x: panelX, y: panelY, w: panelWidth, h: panelHeight };
  const closeRect: Rect = { x: panelX + panelWidth - 50, y: panelY + 12, w: 36, h: 36 };
  const creativeButton: Rect = { x: panelX + 20, y: panelY + panelHeight - 48, w: 150, h: 36 };
  const quickButton: Rect = { x: panelX + 190, y: panelY + panelHeight - 48, w: 110, h: 36 };
  const dropButton: Rect = { x: panelX + 312, y: panelY + panelHeight - 48, w: 90, h: 36 };
  const workbenchButton: Rect = { x: panelX + 420, y: panelY + panelHeight - 48, w: 130, h: 36 };
  const recipesButton: Rect = { x: panelX + 560, y: panelY + panelHeight - 48, w: 120, h: 36 };
  const gridX = panelX + 20;
  const gridY = panelY + 70;
  const craftX = gridX + gridWidth + 24;
  const craftY = gridY + 38;
  const craftGap = 6;
  const crafting2 = new CraftingGrid(2);
  const crafting3 = new CraftingGrid(3);
  let craftSize: 2 | 3 = 2;

  const activeGrid = (): CraftingGrid => (craftSize === 2 ? crafting2 : crafting3);
  const craftOutputRect = (): Rect => ({
    x: craftX + craftSize * (slot + craftGap) + 18,
    y: craftY + (craftSize * slot + (craftSize - 1) * craftGap - slot) / 2,
    w: slot,
    h: slot,
  });
  const creativeBlocks = Object.values(Block).filter(
    (value): value is number => typeof value === 'number' && value > 0,
  ).slice(0, 45);

  let open = false;
  let selected = 0;
  let mode: 'inventory' | 'creative' | 'recipes' = 'inventory';
  let pendingGive: number | null = null;
  let pendingCraft: number | null = null;
  let pendingCommand: 'quick' | 'drop' | null = null;
  let pendingRecipe: Recipe | null = null;
  let recipeRows: RecipeEntry[] = [];
  let tooltip: { text: string; index: number } | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let tooltipTimer: ReturnType<typeof setTimeout> | null = null;
  let currentSlots: readonly (ItemStack | null)[] = slots;
  let drag: { from: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null =
    null;

  const slotRect = (index: number): { x: number; y: number } => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return { x: gridX + col * (slot + gap), y: gridY + row * (slot + gap) };
  };

  const redraw = (): void => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!open) {
      texture.needsUpdate = true;
      return;
    }

    context.fillStyle = 'rgba(0, 0, 0, 0.58)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawPanel(context, panelRect);
    drawText(
      context,
      mode === 'recipes' ? 'RECIPES' : mode === 'creative' ? 'CREATIVE' : 'INVENTORY',
      panelX + 20,
      panelY + 16,
      24,
      '#ffffff',
    );
    drawText(
      context,
      mode === 'recipes'
        ? 'TAP A CRAFTABLE RECIPE'
        : mode === 'creative'
          ? 'TAP A BLOCK = GET 64'
          : 'TAP HOTBAR = SELECT · TAP ITEM = SWAP',
      panelX + 20,
      panelY + 56,
      12,
      'rgba(170, 210, 235, 0.65)',
      'left',
      panelWidth - 100,
    );
    drawButton(context, closeRect, 'X', 'normal', 24);

    if (mode === 'recipes') {
      const source = {
        countOf: (itemId: number): number =>
          currentSlots.reduce((total, stack) => total + (stack?.id === itemId ? stack.count : 0), 0),
      };
      recipeRows = buildRecipeEntries(source)
        .filter((entry) => entry.craftable)
        .slice(0, 6);
      if (recipeRows.length === 0) {
        drawText(context, 'NO CRAFTABLE RECIPES', gridX, gridY + 20, 18, 'rgba(255, 255, 255, 0.55)');
      }
      recipeRows.forEach((entry, index) => {
        const y = gridY + index * 42;
        context.fillStyle = 'rgba(0, 0, 0, 0.36)';
        context.fillRect(gridX, y, gridWidth, 38);
        drawText(
          context,
          `${itemName(entry.result.id)}${entry.result.count > 1 ? ` x${entry.result.count}` : ''}`,
          gridX + 10,
          y + 10,
          16,
          '#ffffff',
          'left',
          gridWidth - 20,
        );
      });
    }

    for (let i = 0; i < cols * rows && mode !== 'recipes'; i++) {
      const { x, y } = slotRect(i);
      const slotGradient = context.createLinearGradient(0, y, 0, y + slot);
      slotGradient.addColorStop(0, 'rgba(52, 64, 74, 0.62)');
      slotGradient.addColorStop(1, 'rgba(8, 12, 16, 0.68)');
      context.fillStyle = slotGradient;
      context.fillRect(x, y, slot, slot);
      context.fillStyle = 'rgba(255, 255, 255, 0.07)';
      context.fillRect(x + 2, y + 2, slot - 4, 3);
      context.strokeStyle =
        mode === 'inventory' && i === selected
          ? '#9fe0ff'
          : i < 9
            ? 'rgba(150, 205, 235, 0.48)'
            : 'rgba(180, 210, 230, 0.22)';
      context.lineWidth = mode === 'inventory' && i === selected ? 4 : 2;
      context.strokeRect(x + 1, y + 1, slot - 2, slot - 2);

      if (mode === 'creative') {
        const id = creativeBlocks[i];
        if (id) drawBlockIcon(context, atlas, id, x, y, slot);
        continue;
      }

      const stack = i < 41 ? currentSlots[i] : null;
      if (stack && stack.count > 0) {
        drawBlockIcon(context, atlas, stack.id, x, y, slot);
        if (stack.count > 1) {
          drawText(context, `${stack.count}`, x + slot - 4, y + slot - 18, 14, '#ffffff', 'right', 34);
        }
      }
    }

    if (mode === 'inventory') {
      const grid = activeGrid();
      const output = craftOutputRect();
      drawText(context, `CRAFTING ${craftSize}x${craftSize}`, craftX, panelY + 18, 18, '#ffffff');
      for (let i = 0; i < craftSize * craftSize; i++) {
        const x = craftX + (i % craftSize) * (slot + craftGap);
        const y = craftY + Math.floor(i / craftSize) * (slot + craftGap);
        context.fillStyle = 'rgba(0, 0, 0, 0.42)';
        context.fillRect(x, y, slot, slot);
        context.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        context.lineWidth = 2;
        context.strokeRect(x + 1, y + 1, slot - 2, slot - 2);
        const stack = grid.get(i);
        if (stack) {
          drawBlockIcon(context, atlas, stack.id, x, y, slot);
          if (stack.count > 1) {
            drawText(context, `${stack.count}`, x + slot - 4, y + slot - 18, 14, '#ffffff', 'right', 34);
          }
        }
      }

      drawText(
        context,
        '>',
        output.x - 20,
        output.y + slot / 2 - 14,
        28,
        'rgba(255, 255, 255, 0.7)',
        'center',
      );
      context.fillStyle = 'rgba(0, 0, 0, 0.42)';
      context.fillRect(output.x, output.y, output.w, output.h);
      context.strokeStyle = 'rgba(255, 220, 140, 0.8)';
      context.lineWidth = 2;
      context.strokeRect(output.x + 1, output.y + 1, output.w - 2, output.h - 2);
      if (grid.result) {
        drawBlockIcon(context, atlas, grid.result.id, output.x, output.y, output.w);
        if (grid.result.count > 1) {
          drawText(
            context,
            `${grid.result.count}`,
            output.x + output.w - 4,
            output.y + output.h - 18,
            14,
            '#ffffff',
            'right',
            34,
          );
        }
      }
    }

    drawButton(
      context,
      creativeButton,
      mode === 'creative' ? 'BACK TO BAG' : 'CREATIVE',
      'normal',
      16,
    );
    drawButton(
      context,
      recipesButton,
      mode === 'recipes' ? 'BACK TO BAG' : 'RECIPES',
      'normal',
      15,
    );
    if (mode === 'inventory') {
      drawButton(context, quickButton, 'QUICK', 'normal', 16);
      drawButton(context, dropButton, 'DROP 1', 'normal', 15);
      drawButton(
        context,
        workbenchButton,
        craftSize === 2 ? '3x3 TABLE' : '2x2 BAG',
        'normal',
        15,
      );
    }

    if (tooltip) {
      const rect = slotRect(tooltip.index);
      const width = Math.min(panelWidth - 20, tooltip.text.length * 9 + 24);
      const x = Math.min(rect.x, panelX + panelWidth - width - 10);
      const y = rect.y - 38 < panelY + 50 ? rect.y + slot + 6 : rect.y - 38;
      drawPanel(context, { x, y, w: width, h: 30 });
      drawText(context, tooltip.text, x + 10, y + 7, 14, '#ffffff', 'left', width - 20);
    }

    // 拖拽中的物品跟随手指
    if (drag?.moved) {
      const stack = currentSlots[drag.from];
      if (stack) {
        context.globalAlpha = 0.82;
        drawBlockIcon(context, atlas, stack.id, drag.x - slot / 2, drag.y - slot / 2, slot);
        context.globalAlpha = 1;
        if (stack.count > 1) {
          drawText(
            context,
            `${stack.count}`,
            drag.x + slot / 2 - 4,
            drag.y + slot / 2 - 18,
            14,
            '#ffffff',
            'right',
            34,
          );
        }
      }
    }

    texture.needsUpdate = true;
  };

  const setOpen = (value: boolean): void => {
    open = value;
    redraw();
  };

  const slotAt = (x: number, y: number): number | null => {
    for (let i = 0; i < Math.min(41, cols * rows); i++) {
      const rect = slotRect(i);
      if (x >= rect.x && x <= rect.x + slot && y >= rect.y && y <= rect.y + slot) return i;
    }
    return null;
  };

  const craftCellRect = (index: number): { x: number; y: number } => ({
    x: craftX + (index % craftSize) * (slot + craftGap),
    y: craftY + Math.floor(index / craftSize) * (slot + craftGap),
  });

  const drainCrafting = (): void => {
    for (const grid of [crafting2, crafting3]) {
      for (let i = 0; i < grid.size * grid.size; i++) {
        const stack = grid.get(i);
        if (stack) callbacks.addStack?.(stack);
        grid.set(i, null);
      }
    }
  };

  const clearHold = (): void => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const clearTooltip = (): void => {
    clearHold();
    tooltip = null;
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = null;
    }
    redraw();
  };

  redraw();

  return {
    toggle(): void {
      if (open) drainCrafting();
      clearTooltip();
      drag = null;
      pendingGive = null;
      pendingCraft = null;
      pendingCommand = null;
      pendingRecipe = null;
      mode = 'inventory';
      setOpen(!open);
    },
    close(): void {
      if (open) drainCrafting();
      clearTooltip();
      drag = null;
      pendingGive = null;
      pendingCraft = null;
      pendingCommand = null;
      pendingRecipe = null;
      mode = 'inventory';
      setOpen(false);
    },
    isOpen(): boolean {
      return open;
    },
    setSelected(index: number): void {
      selected = Math.max(0, Math.min(8, index));
      redraw();
    },
    setSlots(next: readonly (ItemStack | null)[]): void {
      currentSlots = next;
      redraw();
    },
    handleDown(clientX: number, clientY: number, sw: number, sh: number): boolean {
      if (!open) return false;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;

      if (contains(closeRect, x, y)) {
        drag = null;
        setOpen(false);
        return true;
      }
      if (contains(creativeButton, x, y)) {
        mode = mode === 'creative' ? 'inventory' : 'creative';
        drag = null;
        pendingGive = null;
        pendingRecipe = null;
        redraw();
        return true;
      }
      if (contains(recipesButton, x, y)) {
        mode = mode === 'recipes' ? 'inventory' : 'recipes';
        drag = null;
        pendingGive = null;
        pendingRecipe = null;
        redraw();
        return true;
      }
      if (mode === 'creative') {
        const index = slotAt(x, y);
        pendingGive = index === null ? null : (creativeBlocks[index] ?? null);
        redraw();
        return true;
      }
      if (mode === 'recipes') {
        if (x >= gridX && x <= gridX + gridWidth && y >= gridY) {
          const index = Math.floor((y - gridY) / 42);
          if (index >= 0 && index < recipeRows.length) {
            pendingRecipe = recipeRows[index]!.recipe;
            redraw();
          }
        }
        return true;
      }

      if (contains(quickButton, x, y)) {
        pendingCommand = 'quick';
        redraw();
        return true;
      }
      if (contains(dropButton, x, y)) {
        pendingCommand = 'drop';
        redraw();
        return true;
      }
      if (contains(workbenchButton, x, y)) {
        if (craftSize === 2 && callbacks.canUseWorkbench && !callbacks.canUseWorkbench()) {
          callbacks.showToast?.('STAND NEAR CRAFTING TABLE');
          return true;
        }
        craftSize = craftSize === 2 ? 3 : 2;
        pendingCraft = null;
        redraw();
        return true;
      }

      for (let i = 0; i < craftSize * craftSize; i++) {
        const cell = craftCellRect(i);
        if (contains({ x: cell.x, y: cell.y, w: slot, h: slot }, x, y)) {
          pendingCraft = i;
          redraw();
          return true;
        }
      }
      if (contains(craftOutputRect(), x, y)) {
        pendingCraft = 9;
        redraw();
        return true;
      }

      const index = slotAt(x, y);
      if (index === null) {
        drag = null;
        setOpen(false);
        return true;
      }
      const stack = currentSlots[index];
      if (!stack) {
        drag = null;
        setOpen(false);
        return true;
      }
      clearTooltip();
      drag = { from: index, startX: x, startY: y, x, y, moved: false };
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!drag || drag.from !== index || drag.moved) return;
        tooltip = { text: blockDef(stack.id).name.replace('minecraft:', ''), index };
        redraw();
        if (tooltipTimer) clearTimeout(tooltipTimer);
        tooltipTimer = setTimeout(() => {
          tooltip = null;
          tooltipTimer = null;
          redraw();
        }, 1200);
      }, 500);
      redraw();
      return true;
    },
    handleMove(clientX: number, clientY: number, sw: number, sh: number): void {
      if (!open || !drag) return;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;
      drag.x = x;
      drag.y = y;
      if (Math.hypot(x - drag.startX, y - drag.startY) > 8) {
        drag.moved = true;
        clearHold();
        tooltip = null;
      }
      redraw();
    },
    handleUp(clientX: number, clientY: number, sw: number, sh: number): InventoryAction {
      if (!open) return null;
      if (pendingRecipe !== null) {
        const recipe = pendingRecipe;
        pendingRecipe = null;
        return { type: 'craftRecipe', recipe };
      }
      if (pendingCommand !== null) {
        const command = pendingCommand;
        pendingCommand = null;
        return { type: command };
      }
      if (pendingGive !== null) {
        const id = pendingGive;
        pendingGive = null;
        redraw();
        return { type: 'give', id };
      }
      if (pendingCraft !== null) {
        const slotIndex = pendingCraft;
        pendingCraft = null;
        const grid = activeGrid();
        if (slotIndex === 9) {
          if (grid.result) {
            callbacks.addStack?.(grid.result);
            grid.takeResult();
          }
        } else {
          const stack = grid.get(slotIndex);
          if (stack) {
            callbacks.addStack?.(stack);
            grid.set(slotIndex, null);
          } else {
            const one = callbacks.takeSelectedOne?.();
            if (one) grid.set(slotIndex, one);
          }
        }
        redraw();
        return null;
      }
      if (!drag) return null;
      clearHold();
      const current = drag;
      drag = null;
      const x = (clientX / Math.max(1, sw)) * canvas.width;
      const y = (clientY / Math.max(1, sh)) * canvas.height;

      if (!current.moved) {
        setOpen(false);
        if (current.from < 9) {
          selected = current.from;
          return { type: 'select', index: current.from };
        }
        return { type: 'swap', index: current.from };
      }

      const target = slotAt(x, y);
      setOpen(false);
      if (target !== null && target !== current.from) {
        return { type: 'move', from: current.from, to: target };
      }
      return null;
    },
    render(renderer: THREE.WebGLRenderer): void {
      if (!open) return;
      renderer.clearDepth();
      renderer.render(scene, camera);
    },
  };
}
