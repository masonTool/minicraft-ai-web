import type { CraftingGrid } from '../core/crafting/CraftingGrid.ts';
import type { Inventory } from '../core/container/Inventory.ts';
import type { ShapedRecipe, ShapelessRecipe } from '../core/crafting/Recipes.ts';

export type AnyRecipe = ShapedRecipe | ShapelessRecipe;

export function recipeFits(recipe: AnyRecipe, size: 2 | 3): boolean {
  if (recipe.kind === 'shapeless') return recipe.ingredients.length <= size * size;
  return recipe.pattern.length <= size && recipe.pattern.every((row) => row.length <= size);
}

export function takeOne(inventory: Inventory, id: number): boolean {
  for (let i = 0; i < 36; i++) {
    const stack = inventory.get(i);
    if (!stack || stack.id !== id) continue;
    stack.count -= 1;
    inventory.set(i, stack.count > 0 ? stack : null);
    return true;
  }
  return false;
}

export interface FillResult {
  crafting: CraftingGrid;
  hint: string;
}

/**
 * 按配方从背包取 1 份材料填入合成格。
 * 尺寸变化时重建 CraftingGrid；返回新网格由调用方持有。
 */
export function fillRecipe(
  recipe: AnyRecipe,
  size: 2 | 3,
  inventory: Inventory,
  current: CraftingGrid,
): FillResult {
  let crafting = current;
  if (crafting.size !== size) {
    crafting.drainTo(inventory);
    // 这里需要构造器；由调用方传入工厂避免 recipe-book 依赖具体类。
    throw new Error('fillRecipe requires matching crafting grid size');
  }
  crafting.drainTo(inventory);
  let hint = '';
  if (recipe.kind === 'shapeless') {
    for (let i = 0; i < recipe.ingredients.length; i++) {
      const id = recipe.ingredients[i]!;
      if (!takeOne(inventory, id)) {
        hint = '材料不足';
        break;
      }
      crafting.set(i, { id, count: 1 });
    }
  } else {
    for (let row = 0; row < recipe.pattern.length; row++) {
      const line = recipe.pattern[row]!;
      for (let col = 0; col < line.length; col++) {
        const char = line[col]!;
        if (char === ' ') continue;
        const id = recipe.key[char];
        if (id === undefined) continue;
        if (!takeOne(inventory, id)) {
          hint = '材料不足';
          continue;
        }
        crafting.set(row * size + col, { id, count: 1 });
      }
    }
  }
  return { crafting, hint };
}
