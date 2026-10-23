/**
 * 制图台（批次 505，K7 的尾巴）
 *
 * 原版是"地图格 + 材料格 → 产物格"，三种用法：
 *  - **纸**：放大一格（scale +1，覆盖范围翻倍）；
 *  - **空地图**：复制一张（位图完全一样，原件不消耗）；
 *  - **玻璃板**：锁定（之后走过的地方不再记）。
 *
 * 本项目按**触屏优先**的口径把它做成"两格 + 一个制作按钮"（与切石机、村民交易同源）：
 * 原版要玩家把产物从产物格拖走，而手机上"点一下直接进背包"少一步、也不会出现
 * "产物掉在光标上把手里的东西顶掉"。
 *
 * 判据全在 `planCartography`（纯函数）里：
 *  - 地图格必须是**已填好的地图**（`Item.FILLED_MAP` 且带 `map` 数据）；
 *  - 材料只认纸 / 空地图 / 玻璃板；
 *  - 四种拒绝各有**人话原因**（界面直接显示）。
 */

import { Item } from '../registry/items.ts';
import { reason, type ReasonRef } from './reason.ts';
import { GLASS_PANE_ID } from '../registry/blocks.ts';
import {
  MAP_MAX_SCALE,
  copyMap,
  lockMap,
  zoomOutMap,
  type MapData,
} from '../items/Map.ts';
import type { ItemStack, SlotSource } from './Inventory.ts';

export const CARTO_MAP = 0;
export const CARTO_MATERIAL = 1;
export const CARTO_SIZE = 2;

export type CartographyAction = 'zoom' | 'copy' | 'lock';

export interface CartographyPlan {
  action: CartographyAction;
  /** 产物（放进背包的那一份） */
  result: ItemStack;
  /** 是否消耗地图本身（复制不消耗、放大与锁定消耗） */
  consumesMap: boolean;
}

/** 玻璃板既是方块也是物品，这里用方块 id 认（`GLASS_PANE` 的 item id 与方块一致） */
const GLASS_PANE_ITEM = GLASS_PANE_ID;

/**
 * 这一次能做出什么；做不了就返回**给人看的原因**。
 *
 * 顺序：先看地图，再看材料是哪一种，最后看这种材料当前能不能用
 * （纸在地图已到最大缩放时不能再用——这条比"材料不对"更具体，所以排在后面）。
 */
export function planCartography(
  mapStack: ItemStack | null,
  material: ItemStack | null,
): { ok: true; plan: CartographyPlan } | { ok: false; reason: ReasonRef } {
  if (!mapStack) return { ok: false, reason: reason('station.reason.cartographyNeedMap') };
  if (mapStack.id !== Item.FILLED_MAP || !mapStack.map) return { ok: false, reason: reason('station.reason.cartographyOnlyFilledMap') };
  if (!material) return { ok: false, reason: reason('station.reason.cartographyNeedMaterial') };

  const data: MapData = mapStack.map;

  if (material.id === Item.PAPER) {
    const zoomed = zoomOutMap(data);
    if (!zoomed) return { ok: false, reason: reason('station.reason.maxZoom', { max: MAP_MAX_SCALE + 1 }) };
    return {
      ok: true,
      plan: { action: 'zoom', result: { id: Item.FILLED_MAP, count: 1, map: zoomed }, consumesMap: true },
    };
  }

  if (material.id === Item.MAP) {
    return {
      ok: true,
      plan: { action: 'copy', result: { id: Item.FILLED_MAP, count: 1, map: copyMap(data) }, consumesMap: false },
    };
  }

  if (material.id === GLASS_PANE_ITEM) {
    if (data.locked) return { ok: false, reason: reason('station.reason.mapLocked') };
    return {
      ok: true,
      plan: { action: 'lock', result: { id: Item.FILLED_MAP, count: 1, map: lockMap(data) }, consumesMap: true },
    };
  }

  return { ok: false, reason: reason('station.reason.cartographyMaterialHint') };
}

export class CartographyTable implements SlotSource {
  private readonly slots: (ItemStack | null)[] = new Array<ItemStack | null>(CARTO_SIZE).fill(null);

  onChange: (() => void) | null = null;

  get(index: number): ItemStack | null {
    if (index < 0 || index >= CARTO_SIZE) return null;
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    if (index < 0 || index >= CARTO_SIZE) return;
    this.slots[index] = stack && stack.count > 0 ? stack : null;
    this.onChange?.();
  }

  get map(): ItemStack | null {
    return this.get(CARTO_MAP);
  }

  get material(): ItemStack | null {
    return this.get(CARTO_MATERIAL);
  }

  /** 当前两格能做出什么（界面用它决定按钮的可用状态与提示） */
  plan(): { ok: true; plan: CartographyPlan } | { ok: false; reason: ReasonRef } {
    return planCartography(this.map, this.material);
  }

  /**
   * 制作一次：**先校验、再扣材料**（铁砧/切石机那条经验）。
   *
   * 复制只扣空地图、不扣原件；放大与锁定连地图一起扣（产物就是新的那张）。
   */
  craft(): { ok: true; plan: CartographyPlan } | { ok: false; reason: ReasonRef } {
    const planned = this.plan();
    if (!planned.ok) return planned;

    const material = this.material!;
    material.count -= 1;
    if (material.count <= 0) this.slots[CARTO_MATERIAL] = null;

    if (planned.plan.consumesMap) {
      const map = this.map!;
      map.count -= 1;
      if (map.count <= 0) this.slots[CARTO_MAP] = null;
    }

    this.onChange?.();
    return planned;
  }
}
