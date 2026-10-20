import type * as THREE from 'three';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { createHud } from './hud.ts';
import { createHotbar } from './hotbar.ts';
import { createInventory } from './inventory.ts';
import { createPauseMenu, type PauseAction } from './pause.ts';
import { createSettingsMenu, type SettingsValues } from './settings.ts';

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
  togglePause(): void;
  isPauseOpen(): boolean;
  handlePauseTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): PauseAction;
  openSettings(): void;
  isSettingsOpen(): boolean;
  handleSettingsTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): boolean;
  render(renderer: THREE.WebGLRenderer): void;
}

export function createCanvasUi(
  atlas: TextureAtlas,
  blocks: readonly number[],
  screenWidth: number,
  screenHeight: number,
  onSettingsChange?: (values: SettingsValues) => void,
): MiniGameUi {
  const hud = createHud();
  const hotbar = createHotbar(atlas, blocks);
  const inventory = createInventory(atlas, blocks, screenWidth, screenHeight);
  const pause = createPauseMenu(screenWidth, screenHeight);
  const settings = createSettingsMenu(
    screenWidth,
    screenHeight,
    { fov: 72, renderDistance: 3, sound: true, invertLook: false },
    (values) => onSettingsChange?.(values),
  );

  return {
    updateStatus(lines: readonly string[]): void {
      hud.update(lines);
    },
    setSelectedSlot(index: number): void {
      hotbar.setSelected(index);
      inventory.setSelected(index);
    },
    toggleInventory(): void {
      if (pause.isOpen() || settings.isOpen()) return;
      inventory.toggle();
    },
    isInventoryOpen(): boolean {
      return inventory.isOpen();
    },
    handleInventoryTap(clientX, clientY, sw, sh): boolean {
      return inventory.isOpen() ? inventory.handleTap(clientX, clientY, sw, sh) : false;
    },
    togglePause(): void {
      if (settings.isOpen()) settings.close();
      if (inventory.isOpen()) inventory.close();
      pause.toggle();
    },
    isPauseOpen(): boolean {
      return pause.isOpen();
    },
    handlePauseTap(clientX, clientY, sw, sh): PauseAction {
      return pause.isOpen() ? pause.handleTap(clientX, clientY, sw, sh) : null;
    },
    openSettings(): void {
      inventory.close();
      pause.close();
      settings.open();
    },
    isSettingsOpen(): boolean {
      return settings.isOpen();
    },
    handleSettingsTap(clientX, clientY, sw, sh): boolean {
      if (!settings.isOpen()) return false;
      const action = settings.handleTap(clientX, clientY, sw, sh);
      if (action === 'back') pause.toggle();
      return true;
    },
    render(renderer: THREE.WebGLRenderer): void {
      hud.render(renderer);
      hotbar.render(renderer);
      inventory.render(renderer);
      pause.render(renderer);
      settings.render(renderer);
    },
  };
}
