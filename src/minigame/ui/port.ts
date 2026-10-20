import type * as THREE from 'three';
import type { ItemStack } from '../../core/container/Inventory.ts';
import type { Recipe } from '../../core/crafting/Recipes.ts';
import type { TextureAtlas } from '../../render/TextureAtlas.ts';
import { createHud } from './hud.ts';
import { createHotbar } from './hotbar.ts';
import { createInventory } from './inventory.ts';
import { createPauseMenu, type PauseAction } from './pause.ts';
import { createSettingsMenu, type SettingsValues } from './settings.ts';
import { createChestScreen, type ChestAction } from './chest.ts';
import { createFurnaceScreen, type FurnaceAction } from './furnace.ts';
import { createOverlay } from './overlay.ts';
import { createMainMenu, type MainMenuAction, type MainMenuInfo } from './main-menu.ts';
import { createStats, type PlayerStats } from './stats.ts';
import { createTouchControls } from './touch-controls.ts';

/**
 * 小游戏 UI 端口（WX-020B）
 *
 * world-boot 只依赖这层，不直接碰 HUD/快捷栏/背包的画布细节；
 * 后续换 Layout 插件或补暂停/设置页时，只需要扩展这个接口。
 */
export interface MiniGameUi {
  updateStatus(lines: readonly string[]): void;
  setSelectedSlot(index: number): void;
  syncInventory(slots: readonly (ItemStack | null)[], selectedSlot: number): void;
  toggleInventory(): void;
  openCraftingTable(): void;
  isInventoryOpen(): boolean;
  handleInventoryDown(clientX: number, clientY: number, screenWidth: number, screenHeight: number): boolean;
  handleInventoryMove(clientX: number, clientY: number, screenWidth: number, screenHeight: number): void;
  handleInventoryUp(clientX: number, clientY: number, screenWidth: number, screenHeight: number): boolean;
  togglePause(): void;
  isPauseOpen(): boolean;
  handlePauseTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): PauseAction;
  openSettings(): void;
  isSettingsOpen(): boolean;
  handleSettingsTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): boolean;
  handleSettingsScrollMove(clientX: number, clientY: number, screenWidth: number, screenHeight: number): void;
  handleSettingsScrollUp(): void;
  openChest(name: string, chest: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void;
  closeChest(): void;
  isChestOpen(): boolean;
  setChest(chest: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void;
  handleChestTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): ChestAction;
  openFurnace(name: string, slots: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void;
  closeFurnace(): void;
  isFurnaceOpen(): boolean;
  setFurnace(
    slots: readonly (ItemStack | null)[],
    player: readonly (ItemStack | null)[],
    burn: number,
    cook: number,
  ): void;
  handleFurnaceTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): FurnaceAction;
  isMainMenuOpen(): boolean;
  setWorldInfo(info: MainMenuInfo): void;
  handleMainMenuTap(clientX: number, clientY: number, screenWidth: number, screenHeight: number): MainMenuAction;
  setStats(stats: PlayerStats): void;
  setBoss(name: string | null, health: number, max: number): void;
  setTarget(name: string | null): void;
  setMining(progress: number | null): void;
  showError(message: string | null): void;
  setFlying(active: boolean): void;
  setSneaking(active: boolean): void;
  showToast(message: string): void;
  setLoading(progress: number | null, text?: string): void;
  render(renderer: THREE.WebGLRenderer): void;
}

export interface CanvasUiCallbacks {
  onSelectSlot?: (index: number) => void;
  onSwapSlot?: (index: number) => void;
  onMoveItem?: (from: number, to: number) => void;
  onGiveBlock?: (id: number) => void;
  onTakeSelectedItem?: () => ItemStack | null;
  onTakeItem?: (id: number, count: number) => number;
  onAddStack?: (stack: ItemStack) => void;
  onToast?: (message: string) => void;
  onQuickMove?: () => void;
  onDropItem?: () => void;
  onCraftRecipe?: (recipe: Recipe) => void;
  onSettingsChange?: (values: SettingsValues) => void;
  onRequestText?: (current: string) => Promise<string | null>;
}

export function createCanvasUi(
  atlas: TextureAtlas,
  blocks: readonly number[],
  slots: readonly (ItemStack | null)[],
  selectedSlot: number,
  screenWidth: number,
  screenHeight: number,
  callbacks: CanvasUiCallbacks = {},
): MiniGameUi {
  const hud = createHud(screenWidth, screenHeight);
  const hotbar = createHotbar(atlas, blocks, screenWidth, screenHeight);
  const inventory = createInventory(atlas, slots, screenWidth, screenHeight, {
    takeSelectedOne: callbacks.onTakeSelectedItem,
    takeItem: callbacks.onTakeItem,
    addStack: callbacks.onAddStack,
    showToast: callbacks.onToast,
  });
  inventory.setSelected(selectedSlot);
  const pause = createPauseMenu(screenWidth, screenHeight);
  const settings = createSettingsMenu(
    screenWidth,
    screenHeight,
    { fov: 72, renderDistance: 3, sound: true, invertLook: false },
    (values) => callbacks.onSettingsChange?.(values),
    callbacks.onRequestText,
  );
  const overlay = createOverlay(screenWidth, screenHeight);
  const mainMenu = createMainMenu(screenWidth, screenHeight);
  const chestScreen = createChestScreen(atlas, screenWidth, screenHeight);
  const furnaceScreen = createFurnaceScreen(atlas, screenWidth, screenHeight);
  const stats = createStats(screenWidth, screenHeight);
  const touchControls = createTouchControls(screenWidth, screenHeight);
  let settingsFromMenu = false;

  return {
    updateStatus(lines: readonly string[]): void {
      hud.update(lines);
    },
    setSelectedSlot(index: number): void {
      hotbar.setSelected(index);
      inventory.setSelected(index);
    },
    syncInventory(next: readonly (ItemStack | null)[], selectedSlot: number): void {
      hotbar.setBlocks(next.slice(0, 6).map((stack) => stack?.id ?? 0));
      hotbar.setSelected(selectedSlot);
      inventory.setSlots(next);
      inventory.setSelected(selectedSlot);
    },
    toggleInventory(): void {
      if (pause.isOpen() || settings.isOpen() || chestScreen.isOpen() || furnaceScreen.isOpen()) return;
      inventory.toggle();
    },
    openCraftingTable(): void {
      pause.close();
      settings.close();
      chestScreen.close();
      furnaceScreen.close();
      inventory.openCraftingTable();
    },
    isInventoryOpen(): boolean {
      return inventory.isOpen();
    },
    handleInventoryDown(clientX, clientY, sw, sh): boolean {
      return inventory.isOpen() ? inventory.handleDown(clientX, clientY, sw, sh) : false;
    },
    handleInventoryMove(clientX, clientY, sw, sh): void {
      if (inventory.isOpen()) inventory.handleMove(clientX, clientY, sw, sh);
    },
    handleInventoryUp(clientX, clientY, sw, sh): boolean {
      if (!inventory.isOpen()) return false;
      const action = inventory.handleUp(clientX, clientY, sw, sh);
      if (action?.type === 'select') callbacks.onSelectSlot?.(action.index);
      if (action?.type === 'swap') callbacks.onSwapSlot?.(action.index);
      if (action?.type === 'move') callbacks.onMoveItem?.(action.from, action.to);
      if (action?.type === 'give') callbacks.onGiveBlock?.(action.id);
      if (action?.type === 'quick') callbacks.onQuickMove?.();
      if (action?.type === 'drop') callbacks.onDropItem?.();
      if (action?.type === 'craftRecipe') callbacks.onCraftRecipe?.(action.recipe);
      return true;
    },
    togglePause(): void {
      if (settings.isOpen()) settings.close();
      if (inventory.isOpen()) inventory.close();
      if (chestScreen.isOpen()) chestScreen.close();
      if (furnaceScreen.isOpen()) furnaceScreen.close();
      pause.toggle();
    },
    isPauseOpen(): boolean {
      return pause.isOpen();
    },
    handlePauseTap(clientX, clientY, sw, sh): PauseAction {
      return pause.isOpen() ? pause.handleTap(clientX, clientY, sw, sh) : null;
    },
    openSettings(): void {
      settingsFromMenu = mainMenu.isOpen();
      mainMenu.close();
      inventory.close();
      chestScreen.close();
      furnaceScreen.close();
      pause.close();
      settings.open();
    },
    isSettingsOpen(): boolean {
      return settings.isOpen();
    },
    handleSettingsTap(clientX, clientY, sw, sh): boolean {
      if (!settings.isOpen()) return false;
      const action = settings.handleTap(clientX, clientY, sw, sh);
      if (action === 'back') {
        if (settingsFromMenu) {
          settingsFromMenu = false;
          mainMenu.open();
        } else {
          pause.toggle();
        }
      }
      return true;
    },
    handleSettingsScrollMove(clientX, clientY, sw, sh): void {
      if (settings.isOpen()) settings.handleScrollMove(clientX, clientY, sw, sh);
    },
    handleSettingsScrollUp(): void {
      if (settings.isOpen()) settings.handleScrollUp();
    },
    openChest(name: string, chest: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void {
      inventory.close();
      pause.close();
      settings.close();
      furnaceScreen.close();
      chestScreen.open(name, chest, player);
    },
    closeChest(): void {
      chestScreen.close();
    },
    isChestOpen(): boolean {
      return chestScreen.isOpen();
    },
    setChest(chest: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void {
      chestScreen.setSlots(chest, player);
    },
    handleChestTap(clientX: number, clientY: number, sw: number, sh: number): ChestAction {
      return chestScreen.isOpen() ? chestScreen.handleTap(clientX, clientY, sw, sh) : null;
    },
    openFurnace(name: string, slots: readonly (ItemStack | null)[], player: readonly (ItemStack | null)[]): void {
      inventory.close();
      pause.close();
      settings.close();
      chestScreen.close();
      furnaceScreen.open(name, slots, player);
    },
    closeFurnace(): void {
      furnaceScreen.close();
    },
    isFurnaceOpen(): boolean {
      return furnaceScreen.isOpen();
    },
    setFurnace(slots, player, burn, cook): void {
      furnaceScreen.setSlots(slots, player, burn, cook);
    },
    handleFurnaceTap(clientX: number, clientY: number, sw: number, sh: number): FurnaceAction {
      return furnaceScreen.isOpen() ? furnaceScreen.handleTap(clientX, clientY, sw, sh) : null;
    },
    isMainMenuOpen(): boolean {
      return mainMenu.isOpen();
    },
    setWorldInfo(info: MainMenuInfo): void {
      mainMenu.setInfo(info);
    },
    handleMainMenuTap(clientX, clientY, sw, sh): MainMenuAction {
      return mainMenu.isOpen() ? mainMenu.handleTap(clientX, clientY, sw, sh) : null;
    },
    setStats(next: PlayerStats): void {
      stats.setStats(next);
    },
    setBoss(name: string | null, health: number, max: number): void {
      stats.setBoss(name, health, max);
    },
    setTarget(name: string | null): void {
      stats.setTarget(name);
    },
    setMining(progress: number | null): void {
      stats.setMining(progress);
    },
    showError(message: string | null): void {
      stats.setError(message);
    },
    setFlying(active: boolean): void {
      touchControls.setFlying(active);
    },
    setSneaking(active: boolean): void {
      touchControls.setSneaking(active);
    },
    showToast(message: string): void {
      overlay.showToast(message);
    },
    setLoading(progress: number | null, text?: string): void {
      overlay.setLoading(progress, text);
    },
    render(renderer: THREE.WebGLRenderer): void {
      // 主菜单/从主菜单进入的设置页：只画菜单，不把 HUD/快捷栏透出来
      if (mainMenu.isOpen()) {
        mainMenu.render(renderer);
        return;
      }
      if (settings.isOpen() && settingsFromMenu) {
        settings.render(renderer);
        return;
      }
      if (stats.hasError()) {
        stats.render(renderer);
        return;
      }
      if (chestScreen.isOpen()) {
        chestScreen.render(renderer);
        return;
      }
      if (furnaceScreen.isOpen()) {
        furnaceScreen.render(renderer);
        return;
      }
      touchControls.render(renderer);
      stats.render(renderer);
      hud.render(renderer);
      hotbar.render(renderer);
      inventory.render(renderer);
      overlay.render(renderer);
      chestScreen.render(renderer);
      pause.render(renderer);
      settings.render(renderer);
    },
  };
}
