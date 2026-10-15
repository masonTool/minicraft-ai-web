/**
 * 配方书（界面）
 *
 * 一个覆盖式面板：列出所有配方、每条显示"产物 + 需要的材料"，材料够就能一键合成。
 * 与原版"配方书"的区别：原版是把它摆在背包旁边、点了只**填充**合成格；
 * 这里直接一步做出来（扣材料、给产物），因为本项目的背包界面本来就复杂，
 * 再叠一层"填充格子"的交互不如一键来得直接。
 *
 * 数据都在 `core/crafting/RecipeBook.ts` 里（纯函数，可离线测），这里只管画。
 */

import type { Inventory } from '../core/container/Inventory.ts';
import { buildRecipeEntries, matchesRecipe, type RecipeEntry } from '../core/crafting/RecipeBook.ts';
import { SMELTING_RECIPES, SMELTING_TIME } from '../core/crafting/Smelting.ts';
import { itemLabel } from '../core/registry/itemNames.ts';
import type { Recipe } from '../core/crafting/Recipes.ts';
import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { drawItemIcon } from './ItemIcon.ts';

export interface RecipeBookActions {
  /** 合成一次；返回是否成功（材料不够时返回 false） */
  onCraft: (recipe: Recipe) => boolean;
}

export class RecipeBook {
  readonly root: HTMLDivElement;

  private readonly listEl: HTMLDivElement;
  private readonly searchEl: HTMLInputElement;
  private readonly summaryEl: HTMLSpanElement;
  private readonly smeltingEl: HTMLDivElement;
  private open = false;
  private query = '';
  /** 上次画出来的条目数（验收脚本用） */
  private entryCount = 0;

  constructor(
    host: HTMLElement,
    private readonly atlas: TextureAtlas,
    private readonly inventory: Inventory,
    private readonly actions: RecipeBookActions,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'recipe-book';
    this.root.classList.add('hidden');

    const panel = document.createElement('div');
    panel.className = 'recipe-panel';

    // ---- 标题栏
    const header = document.createElement('div');
    header.className = 'recipe-header';

    const title = document.createElement('b');
    title.textContent = '配方书';

    this.summaryEl = document.createElement('span');
    this.summaryEl.className = 'recipe-hint';

    this.searchEl = document.createElement('input');
    this.searchEl.type = 'text';
    this.searchEl.className = 'recipe-search';
    this.searchEl.placeholder = '搜索物品或材料（中文/英文都行）';
    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value;
      this.render();
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'recipe-close';
    close.textContent = '关闭 (R)';
    close.addEventListener('click', () => this.hide());

    header.append(title, this.summaryEl, this.searchEl, close);

    // ---- 配方列表
    this.listEl = document.createElement('div');
    this.listEl.className = 'recipe-list';

    // ---- 熔炼
    this.smeltingEl = document.createElement('div');
    this.smeltingEl.className = 'recipe-smelting';

    panel.append(header, this.listEl, this.smeltingEl);
    this.root.append(panel);
    host.appendChild(this.root);

    // 点面板外关闭
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.hide();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 当前列出的配方条数（验收脚本用） */
  get count(): number {
    return this.entryCount;
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  /** 重建配方列表（打开、搜索、合成之后都要调：合成会改变"能不能做"） */
  render(): void {
    const entries = buildRecipeEntries(this.inventory).filter((entry) => matchesRecipe(entry.recipe, this.query));
    this.entryCount = entries.length;

    const craftable = entries.filter((entry) => entry.craftable).length;
    this.summaryEl.textContent = `共 ${entries.length} 条 · 现在能做 ${craftable} 条`;

    this.listEl.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recipe-empty';
      empty.textContent = '没有匹配的配方';
      this.listEl.appendChild(empty);
    } else {
      for (const entry of entries) this.listEl.appendChild(this.makeCard(entry));
    }

    this.renderSmelting();
  }

  private makeCard(entry: RecipeEntry): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    // 记下产物 id：验收脚本靠它找到"某条配方"的卡片（界面里没有别的稳定标识）
    card.dataset.resultId = String(entry.result.id);
    if (entry.craftable) card.classList.add('craftable');

    // ---- 产物
    const result = document.createElement('div');
    result.className = 'recipe-result';
    const icon = document.createElement('canvas');
    icon.width = 32;
    icon.height = 32;
    drawItemIcon(icon, this.atlas, entry.result.id, 28);
    const name = document.createElement('span');
    name.textContent = entry.result.count > 1
      ? `${itemLabel(entry.result.id)} ×${entry.result.count}`
      : itemLabel(entry.result.id);
    result.append(icon, name);

    // ---- 材料
    const ingredients = document.createElement('div');
    ingredients.className = 'recipe-ingredients';
    for (const ingredient of entry.ingredients) {
      const chip = document.createElement('span');
      chip.className = 'recipe-chip';
      chip.dataset.itemId = String(ingredient.id);
      const have = this.inventory.countOf(ingredient.id);
      if (have < ingredient.count) chip.classList.add('missing');
      const chipIcon = document.createElement('canvas');
      chipIcon.width = 20;
      chipIcon.height = 20;
      drawItemIcon(chipIcon, this.atlas, ingredient.id, 18);
      const text = document.createElement('i');
      // 不够的材料直接把"有/需要"写出来，玩家不用自己去数背包
      text.textContent = `${itemLabel(ingredient.id)} ×${ingredient.count}${
        have < ingredient.count ? `（有 ${have}）` : ''
      }`;
      chip.append(chipIcon, text);
      ingredients.appendChild(chip);
    }

    // ---- 合成按钮
    const craft = document.createElement('button');
    craft.type = 'button';
    craft.className = 'recipe-craft';
    craft.textContent = entry.craftable
      ? entry.maxCraftable > 1
        ? `合成（可做 ${entry.maxCraftable} 次）`
        : '合成'
      : '材料不足';
    craft.disabled = !entry.craftable;
    craft.addEventListener('click', () => {
      if (this.actions.onCraft(entry.recipe)) {
        // 合成会改变背包，"能不能做"要重算
        this.render();
      }
    });

    const main = document.createElement('div');
    main.className = 'recipe-main';
    main.append(result, ingredients);

    card.append(main, craft);
    return card;
  }

  /** 熔炼表：输入 → 产物（熔炼要时间，这里只做展示，真正的烧炼在熔炉界面里） */
  private renderSmelting(): void {
    this.smeltingEl.replaceChildren();

    const title = document.createElement('div');
    title.className = 'recipe-hint';
    title.textContent = `熔炼（每个约 ${SMELTING_TIME} 秒，需要熔炉与燃料）`;
    this.smeltingEl.appendChild(title);

    const row = document.createElement('div');
    row.className = 'recipe-smelt-row';
    for (const recipe of SMELTING_RECIPES) {
      const chip = document.createElement('span');
      chip.className = 'recipe-chip';
      const from = document.createElement('canvas');
      from.width = 20;
      from.height = 20;
      drawItemIcon(from, this.atlas, recipe.input, 18);
      const arrow = document.createElement('i');
      arrow.textContent = `${itemLabel(recipe.input)} → ${itemLabel(recipe.output.id)}`;
      const to = document.createElement('canvas');
      to.width = 20;
      to.height = 20;
      drawItemIcon(to, this.atlas, recipe.output.id, 18);
      chip.append(from, arrow, to);
      row.appendChild(chip);
    }
    this.smeltingEl.appendChild(row);
  }

  /** 验收脚本用：设置搜索词并重画 */
  setQuery(query: string): void {
    this.query = query;
    this.searchEl.value = query;
    this.render();
  }

  dispose(): void {
    this.root.remove();
  }
}
