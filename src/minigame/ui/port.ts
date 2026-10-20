import type * as THREE from 'three';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { createHud } from './hud.ts';
import { createHotbar } from './hotbar.ts';
import { createInventory } from './inventory.ts';

/**
 * 小游戏 UI 端口（WX-020B）
 *
 * world-boot 只依赖这层，不直接碰 HUD/快捷栏/背包的画布细节；
 * 后续换 Layout 插件或补暂停/设置页时，只需要扩展这个接口。
 */
export interface MiniGameUi {
  updateStatus(lines: readonly string[]): void;
  setSelectedSlot(index: number): void;
  toggleInventory(): void;
  isInventoryOpen(): boolean;
  /** 返回 true 表示这次点击被 UI 消费 */
  handleInventoryTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): boolean;
  render(renderer: THREE.WebGLRenderer): void;
}

export function createCanvasUi(
  atlas: TextureAtlas,
  blocks: readonly number[],
  screenWidth: number,
  screenHeight: number,
): MiniGameUi {
  const hud = createHud();
  const hotbar = createHotbar(atlas, blocks);
  const inventory = createInventory(atlas, blocks, screenWidth, screenHeight);

  return {
    updateStatus(lines: readonly string[]): void {
      hud.update(lines);
    },
    setSelectedSlot(index: number): void {
      hotbar.setSelected(index);
      inventory.setSelected(index);
    },
    toggleInventory(): void {
      inventory.toggle();
    },
    isInventoryOpen(): boolean {
      return inventory.isOpen();
    },
    handleInventoryTap(clientX, clientY, sw, sh): boolean {
      return inventory.isOpen() ? inventory.handleTap(clientX, clientY, sw, sh) : false;
    },
    render(renderer: THREE.WebGLRenderer): void {
      hud.render(renderer);
      hotbar.render(renderer);
      inventory.render(renderer);
    },
  };
}
