/**
 * 通用容器界面
 *
 * 七种模式共用一块面板，下方永远是玩家自己的主背包 + 快捷栏，
 * 上方区域随模式切换（与原版一致：打开不同容器时只是上半部分在变）：
 *
 *   inventory ：2×2 合成 + 结果槽 + 创造物品栏
 *   crafting  ：3×3 合成 + 结果槽
 *   furnace   ：原料 / 燃料 / 产物 三格 + 火焰与进度
 *   chest     ：3×9 容器格
 *   enchanting：物品 + 青金石 + 三个候选槽（H9）
 *   anvil     ：左 / 右 / 产物三格 + 改名与代价（H8）
 *   grindstone：左 / 右 / 产物三格，洗附魔与拼耐久，**返还**经验（H15）
 *   smithing  ：装备 / 下界合金锭 / 产物三格（K8 尾巴，不要经验）
 *   brewing   ：3 个药水槽 + 材料 + 燃料 + 20 秒进度（H10）
 *
 * 拖拽语义：
 *   左键 → 整叠拿起 / 放下 / 合并 / 交换
 *   右键 → 拿起一半 / 放下一个
 *   合成结果槽、熔炉产物槽为"只取不放"
 * 关闭界面时手上的物品、合成网格里的材料都会自动收回背包，不会丢失。
 */

import type { TextureAtlas } from '../render/TextureAtlas.ts';
import { drawItemIcon } from './ItemIcon.ts';
import { itemIconTile } from '../core/registry/items.ts';
import {
  ARMOR_SIZE,
  ARMOR_START,
  OFFHAND_SLOT,
  HOTBAR_SIZE,
  HOTBAR_START,
  Inventory,
  MAIN_SIZE,
  MAIN_START,
  TOTAL_SLOTS,
  type ItemStack,
  type SlotSource,
  stackExtras,
} from '../core/container/Inventory.ts';
import { CraftingGrid } from '../core/crafting/CraftingGrid.ts';
// 配方书点一条配方 = **把材料摆进合成格**（批次 132，对齐原版）。
// 规则在 `core/crafting/RecipeBook.ts` 里（纯逻辑、可断言），界面只负责"摆哪一格"。
import {
  RECIPE_BOOK_TAB_LABELS,
  RECIPE_BOOK_TABS_POCKET,
  canCraft,
  fillCraftingGrid,
  recipeBookTab,
  recipeGridSize,
  recipesForResult,
  type RecipeBookTab,
} from '../core/crafting/RecipeBook.ts';
import { RECIPES, type Recipe } from '../core/crafting/Recipes.ts';
// 熔炼表（批次 185）：判断"这件东西只能烧出来" → 合成箭头上面点亮熔炉图标
import {
  FURNACE_STATIONS,
  SMELTING_RECIPES,
  cookSeconds,
  fuelSeconds,
  smeltingRecipeFor,
} from '../core/crafting/Smelting.ts';
// 工作站"可做列表"（批次 277）：纯逻辑在 core，界面只画格子与填材料
import {
  STATION_LABELS,
  STATION_REASON_LABELS,
  brewingStationRecipes,
  furnaceStationRecipes,
  smithingStationRecipes,
  stationNeedFor,
  type StationNeed,
  type StationRecipeEntry,
  type StationRecipeStation,
} from '../core/crafting/StationRecipes.ts';
// 配方的**摆放位置**（批次 29）：左栏点一件物品要把它怎么摆画进合成格
import { recipeLayout } from '../core/crafting/RecipeLayout.ts';
// 快速移动（批次 127）：Shift+左键的规则是纯逻辑（`core/container/QuickMove.ts`），
// 界面只负责把"哪一格 / 开着哪个容器 / 容器多少格"交给它
import { PLAYER_FILL_ORDER, fitCount, quickMove } from '../core/container/QuickMove.ts';
// 绑定诅咒（批次 270）：装备槽里的绑定物品不能主动脱下
import { isBoundByCurse } from '../core/registry/enchantments.ts';
// 光标上那几件事（批次 128）：双击收集 / 拖拽分配 / 数字键换槽 / 丢出——
// 规则同样在纯模块里，界面只交坐标（见 `core/container/CursorActions.ts`）
import {
  distributeEvenly,
  dropCount,
  gatherSameItems,
  moveAllOfTypeBetween,
  placeOneEach,
  swapWithSlot,
} from '../core/container/CursorActions.ts';
import { CHEST_SIZE } from '../core/container/Chest.ts';
import { ANVIL_LEFT, ANVIL_RESULT, ANVIL_RIGHT, Anvil } from '../core/container/Anvil.ts';
import {
  GRINDSTONE_LEFT,
  GRINDSTONE_RESULT,
  GRINDSTONE_RIGHT,
  Grindstone,
} from '../core/container/Grindstone.ts';
import {
  SMITHING_EQUIPMENT,
  SMITHING_MATERIAL,
  SMITHING_RESULT,
  SmithingTable,
} from '../core/container/SmithingTable.ts';
import { STONECUTTER_INPUT, Stonecutter } from '../core/container/Stonecutter.ts';
// 村民交易（J11，批次 88）：职业/交易表在注册表那一层（纯数据），界面只读不算
import { Villager } from '../core/entity/Villager.ts';
import { levelName, tradeBlocker } from '../core/registry/villagerTrades.ts';
import { CAMPFIRE_SIZE, Campfire } from '../core/container/Campfire.ts';
import { Dispenser } from '../core/container/Dispenser.ts';
import { DROPPER_SIZE, Dropper } from '../core/container/Dropper.ts';
import { DEFAULT_DISPENSE_CN, dispenseBehaviorFor } from '../core/registry/dispense.ts';
import { HOPPER_SIZE, Hopper } from '../core/container/Hopper.ts';
import { smithingHint } from '../core/crafting/Smithing.ts';
import {
  ENCHANT_ITEM_SLOT,
  ENCHANT_LAPIS_SLOT,
  EnchantTable,
} from '../core/container/EnchantTable.ts';
import { anvilHint, repairCostLabel } from '../core/crafting/Anvil.ts';
import { grindstoneHint } from '../core/crafting/Grindstone.ts';
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, Furnace } from '../core/container/Furnace.ts';
import { UI_HINT_UNIMPLEMENTED, optionLabel, type EnchantOption } from '../core/crafting/Enchanting.ts';
import {
  BREW_BOTTLE_SLOTS,
  BREW_FUEL_SLOT,
  BREW_INGREDIENT_SLOT,
  BREW_SLOT_COUNT,
  BrewingStand,
} from '../core/container/BrewingStand.ts';
import { BREW_RECIPES } from '../core/crafting/Brewing.ts';
import type { BlockContainer } from '../core/world/BlockEntityStore.ts';
import {
  CREATIVE_ITEMS,
  Item,
  itemName,
  maxStackOf,
} from '../core/registry/items.ts';
import { itemLabel, itemTooltip, type ItemTooltip } from '../core/registry/itemNames.ts';
// 说明浮层的标题颜色与提示框同源（稀有度 → 类名，CSS 只认类名）
import { rarityClassName } from '../core/registry/itemVisuals.ts';
import { SIX_FACING_NAMES } from '../core/registry/blockState.ts';
import {
  NARROW_MAX_WIDTH,
  clampPage,
  pageCount,
  pageLabel,
  pageSizeFor,
  slicePage,
} from './ItemPager.ts';
import { TOUCH_TOOLTIP_MS, Tooltip } from './Tooltip.ts';
import { diag } from '../game/diagnosticsRuntime.ts';
import { Block } from '../core/registry/blocks.ts';
import {
  CREATIVE_TAB_ICONS,
  CREATIVE_TAB_LABELS,
  CREATIVE_TABS,
  RECIPE_TAB_ICONS,
  creativeTabFor,
  type CreativeTab,
} from './CreativeTabs.ts';
import { drawPlayerPreview } from './PlayerPreview.ts';
import { PlayerPreview3D } from './PlayerPreview3D.ts';
import { paletteOf, type AppearancePalette } from '../game/appearance.ts';
import { isTouchDevice, isTouchUi } from './TouchControls.ts';
import { updateDurabilityBar } from './SlotVisuals.ts';
import {
  canSplitStack,
  initialSplitCount,
  splitCountForDrag,
  splitFraction,
  splitStack,
} from '../core/container/TouchSplit.ts';

export type InventoryPanelMode =
  | 'inventory'
  | 'crafting'
  | 'furnace'
  | 'chest'
  /** 木桶（批次 61）：与箱子**同一套 27 格**，只是标题不同（方块规则不同：木桶不怕压） */
  | 'barrel'
  /** 末影箱（批次 71）：同一套 27 格；它的内容是**玩家的那一份**（跨坐标共享） */
  | 'ender_chest'
  /** 潜影盒（批次 72）：同一套 27 格；它的内容会**跟着物品走**（挖下来带走） */
  | 'shulker_box'
  | 'enchanting'
  | 'anvil'
  /** 砂轮（H15，批次 188）：与铁砧同构的两格输入，但**不收经验、返还经验** */
  | 'grindstone'
  | 'smithing'
  /** 烟熏炉与高炉（批次 46）：与 `furnace` 同一套布局，只是容器与标题不同 */
  | 'smoker'
  | 'blast_furnace'
  /** 营火（批次 47）：4 个格子各自推进，烤好直接弹出来（没有产物槽） */
  | 'campfire'
  /** 切石机（H11，批次 44）：一格输入 + 一列可选产物，点哪一项切哪一项 */
  | 'stonecutter'
  /** 漏斗（批次 58）：5 格排成一行，内容由方块自己每 0.4 秒搬一次 */
  | 'hopper'
  /** 投掷器（批次 59）：3×3 九格，内容由红石脉冲往外吐（界面里只存货与朝向） */
  | 'dropper'
  /** 发射器（批次 60）：与投掷器**同一套九宫格**，只是"动之前先看是什么" */
  | 'dispenser'
  | 'brewing'
  /**
   * 与村民交易（J11，批次 88）。
   *
   * ⚠️ 它是**唯一一个不需要容器**的"界面模式"：原版那套要玩家把两堆东西
   * 放进收货格、再从产物格拿走，而在触屏上拖两堆东西是最难受的一步
   * （本项目在手机上验收）。所以口径改成：**点一条交易直接从背包结算**
   * （与切石机"点一下切一件"同源），界面只带着一个 `activeVillager`。
   */
  | 'trade';

/**
 * 有"操作区"的工作站（批次 276）。
 *
 * 这些界面在手机上是"把材料放进去、从产物格取出来"，与工作台同一套双栏壳：
 * 左栏 = 玩家自己的 7×4 主背包 + 底部快捷栏，右栏 = 该工作站的操作区。
 *
 * ⚠️ 纯存储（箱子/木桶/潜影盒/漏斗/投掷器/发射器）不算：它们没有"操作区"，
 * 继续走原来的单栏面板，避免把这一批的回归面扩到所有容器。
 */
export function isWorkstationMode(mode: InventoryPanelMode): boolean {
  switch (mode) {
    case 'furnace':
    case 'smoker':
    case 'blast_furnace':
    case 'smithing':
    case 'anvil':
    case 'grindstone':
    case 'stonecutter':
    case 'brewing':
    case 'enchanting':
    case 'campfire':
      return true;
    default:
      return false;
  }
}

export interface InventoryScreenHooks {
  onOpenChange?: (open: boolean) => void;
  /**
   * 打开配方书（背包标题栏 / 携带版左上分类图标）。
   * @param tab 携带版点某个分类图标时带上，配方书直接切到那一栏
   */
  onOpenRecipes?: (tab?: RecipeBookTab) => void;
  /** 关掉配方书（携带版离开合成页时） */
  onCloseRecipes?: () => void;
  /**
   * 面板关闭（或换到另一个面板）时（批次 249）。
   *
   * 陷阱箱要靠它把"开箱中"的红石信号撤掉——容器本身不关心红石，
   * 界面层也不该认识方块，"关了"这件事只有这一处知道。
   */
  onPanelClosed?: () => void;
  /** 配方书现在开着吗（决定左栏显示"我的物品"还是"配方列表"） */
  isRecipesOpen?: () => boolean;
  /** 配方书当前停在哪一栏（左轨那排分类图标要点亮它） */
  currentRecipeTab?: () => RecipeBookTab;
  /** 「只显示我拥有的」开着吗（关着 = 全部列出、不拥有的红底） */
  isRecipeOwnedOnly?: () => boolean;
  /** 切「只显示我拥有的」（背包标题栏那颗配方开关，批次 159） */
  onSetRecipeOwnedOnly?: (on: boolean) => void;
  /**
   * 把配方书**搬进背包的左栏**（批次 157）。
   *
   * 传元素 = 嵌进去；传 `null` = 还回整屏那一层。以前配方书是"另一个窗口"，
   * 点一下就把背包挤成半屏（界面跳一次）；现在它占的是左栏，栏目对齐，
   * 换的只是栏目里的内容。
   */
  onRecipeHost?: (host: HTMLElement | null) => void;
  /**
   * 打开成就 / 进度面板（M7，批次 87）。
   *
   * 为什么挂在背包标题栏上：手机上**没有 Esc 键**，暂停菜单在触屏上只能靠
   * 别处进去（背包是唯一常开的入口），配方书当初也是这么挂上去的。
   */
  onOpenAdvancements?: () => void;
  /** 预览用：披风外观是否开启（批次 185） */
  isCapeVisible?: () => boolean;
  /** 预览用：肤色 / 上衣 / 裤子（批次 187） */
  appearance?: () => AppearancePalette;
  /**
   * 成交一条交易（J11，批次 88）。
   *
   * 界面只负责"点到了第几条"，扣材料、给东西、给村民经验、报进度、播声音
   * 全在主程序（它才是那个握着背包、进度与音频的人）。
   * 与切石机那条一样：**界面不碰物品**，避免"扣了没给"这种半途状态。
   */
  onTrade?: (villager: Villager, offerIndex: number) => void;
  /**
   * 从熔炉里取走产物、且产物槽被取空时结算烧炼经验（I5）。
   * 界面只负责"发现这件事发生了"，攒了多少、给谁加由主程序决定。
   */
  onFurnaceXp?: (amount: number) => void;
  /**
   * 附魔台要用到的"玩家侧信息"（H9）：当前等级、书架加成、以及扣等级的出口。
   * 界面不持有 `Experience`，所以询问式地取——一次刷新只问一次。
   */
  enchantContext?: () => {
    playerLevel: number;
    bookshelfPower: number;
    consumeLevels: (levels: number) => boolean;
  };
  /** 铁砧同样只需要"当前等级 + 扣等级的出口"（H8） */
  anvilContext?: () => {
    playerLevel: number;
    consumeLevels: (levels: number) => boolean;
  };
  /**
   * 砂轮洗掉附魔后**返还**的经验点数（H15，批次 188）。
   *
   * 与熔炉那条同一个口径：界面只报数字，攒成经验球、加给谁、在哪个位置冒出来
   * 全由主程序决定（它握着 `spawnXpOrbs` 与砂轮坐标）。
   */
  onGrindstoneXp?: (amount: number) => void;
  /**
   * **把手上/某一格的东西丢进世界**（批次 128，Q / Ctrl+Q / 点界面外）。
   *
   * 界面不知道玩家站在哪、也没法造掉落物实体，所以只报"丢哪件、丢几件"，
   * 真正生成掉落物的是主程序（它握着 `spawnDrop`）。
   */
  onDrop?: (itemId: number, count: number) => void;
  /**
   * **背包里真的搬动了东西**（H19 ⑪，批次 138）：主程序据此播一声很轻的"咔"。
   *
   * 界面不持有音频，也不知道音量设置——它只报"刚才那一下动过东西"。
   * ⚠️ 判据是"动过"而不是"点过"：点到空格、点到不接受的盔甲槽都**不该响**，
   * 否则玩家会以为东西放进去了（这一条与"点了没反应要抖一下"是同一个理由）。
   */
  onMove?: () => void;
  /**
   * **现在是不是创造模式**（H19，批次 139）：创造物品栏只能在创造模式打开。
   *
   * 本项目的口径是「能飞 = 创造」（与中键拾取、伤害免疫同一条）。
   * 没接这个钩子时当作生存——宁可多藏一块创造区，也不能让生存玩家拿到无限物资。
   */
  isCreative?: () => boolean;
}

interface SlotBinding {
  element: HTMLDivElement;
  source: SlotSource;
  index: number;
  /** 只取不放（合成结果、熔炉产物） */
  takeOnly?: boolean;
}

/** 容器类界面的 UI 刷新节流间隔（秒）：熔炉每帧都在烧，但界面不需要每帧重绘 */
const CONTAINER_REFRESH_INTERVAL = 0.1;

/**
 * 触摸端的"长按"手势参数。
 *
 * 触摸屏没有右键，所以长按要同时承担两件事，按**按下的那一格是什么**分流：
 *
 * | 按下的格子 | 长按的含义 |
 * | --- | --- |
 * | **有 2 个以上、且手上空着** | **选数量**（批次 137，基岩版那个绿色指示条）：左右划改数量，松手拿走那么多 |
 * | 其余（空格 / 手上拿着东西 / 只有 1 个 / 只取不放） | 右键语义（取一半 / 放一个）+ **每 170ms 重复**，即"连续放材料 / 连续取一个" |
 *
 * 短按抬起一律是左键（拿起整叠 / 放下整叠）。桌面鼠标完全不走这条路径。
 */
/** 双击的判定窗口（毫秒，批次 128）：同一格在这个窗口内点第二下 = 双击收集 */
const DOUBLE_CLICK_MS = 400;

export const TOUCH_LONG_PRESS_MS = 260;
const TOUCH_REPEAT_MS = 170;
/**
 * 点物品时那块小说明停留多久（毫秒，批次 159）。
 * 比"看一眼"长、比"碍事"短：3.5 秒够读完一行说明，又不至于一直压在快捷栏上。
 */
export const PICK_TOAST_MS = 2000;

/** 携带版物品栏的三个内容页（批次 140；Wiki「携带版 UI」） */
/** 右轨"成就"图标（图集里没有对应物品，用内联 SVG：奖杯） */
const ACHIEVEMENT_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">' +
  '<path d="M7 4h10v3a5 5 0 0 1-4 4.9V15h3v2H8v-2h3v-3.1A5 5 0 0 1 7 7V4zm-3 1h2v2H5a2 2 0 0 0 2 2v2a4 4 0 0 1-3-3.9V5zm16 0h-2v2h1a2 2 0 0 1-2 2v2a4 4 0 0 0 3-3.9V5z"/>' +
  '</svg>';

export type PocketInventoryTab = 'crafting' | 'armor' | 'inventory';

/**
 * 双栏壳里**左栏**现在显示哪一份内容（批次 157 → 159）。
 *
 * 三份内容占的是同一个网格格子（同样的位置、同样的尺寸），切换只换内容——
 * 这是"点左边按钮时界面不该跳"的落点。
 *
 * - `items`    ：我的物品（3×9 仓库）
 * - `category` ：**可合成的物品**（批次 159 引入、批次 206 按用户澄清改口径）——
 *   它列的不是"仓库里有什么"，而是"**仓库里的材料能做出什么**"：
 *   材料够的配方正常显示，之前真正做过、现在缺料的用红底保留；
 *   没有任何配方的原料（原木、矿石…）不出现。点一项 = 在右栏看它的配方。
 * - `creative` ：创造物品栏
 */
export type PocketLeftPane = 'items' | 'creative' | 'category';

/** 「全部」配方页签的放大镜（与 RecipeBook 同源；图集里没有这件物品） */
const POCKET_RECIPE_ALL_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path fill="currentColor" d="M10 2.6a7.4 7.4 0 1 0 4.4 13.35l4.32 4.32 1.7-1.7-4.32-4.32A7.4 7.4 0 0 0 10 2.6zm0 2.4a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>' +
  '</svg>';

export class InventoryScreen {
  /** 触摸长按的定时器（长按判定 + 连发），桌面端始终为 null */
  private touchPressTimer: number | null = null;
  private touchRepeatTimer: number | null = null;

  /**
   * 触摸端"长按选数量"的进行中状态（批次 137）：null = 没在选。
   *
   * 这一格**在被确认之前不动任何数据**——划动只改 `count`（纯界面），
   * 松手才真的按 `count` 拆开。所以划到一半取消（抬手被系统回收、关界面）
   * 什么都不会丢。
   */
  private split: {
    key: string;
    source: SlotSource;
    index: number;
    /** 这一格原本的总数（分母） */
    total: number;
    /** 按下那一刻选中的数量（划动映射的原点，见 `splitCountForDrag`） */
    startCount: number;
    /** 当前选中数量（分子） */
    count: number;
    /** 按下时手指的横坐标（划动的原点） */
    startX: number;
    /** 一格的宽度（像素）：划动映射要按它归一，见 `splitCountForDrag` */
    width: number;
    element: HTMLDivElement;
    bar: HTMLElement;
    fill: HTMLElement;
    label: HTMLElement;
  } | null = null;
  /** 解绑"选数量"期间的 pointermove / pointerup（抬手或取消时调用一次） */
  private splitDetach: (() => void) | null = null;

  private readonly root: HTMLDivElement;
  /** 携带版：左轨 + 面板 + 右轨（页签贴在灰框外侧，对齐 Wiki） */
  private readonly shellEl: HTMLDivElement;
  private readonly railLeft: HTMLDivElement;
  private readonly railRight: HTMLDivElement;
  /** 携带版：快捷栏停在屏幕底（面板外），经典 UI 仍在面板内 */
  private readonly hotbarDock: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLElement;
  /** 玩家那一块的两列：左=装备竖排，右=合成/容器 + 主背包 + 快捷栏 */
  private readonly playerBody: HTMLDivElement;
  private readonly mainColumn: HTMLDivElement;
  private readonly topArea: HTMLDivElement;
  /** 左栏盔甲 + 副手（携带版「盔甲」页只露这一块） */
  private readonly gearEl: HTMLDivElement;
  /** 玩家预览剪影（批次 141；占位，非真皮肤） */
  private readonly playerPreviewEl: HTMLCanvasElement;
  /** 主背包 3×9（携带版「物品栏」页） */
  private readonly mainGridEl: HTMLDivElement;
  /** 合成页里标清下半区是玩家自己的 3×9 仓库，不是配方候选区 */
  private readonly personalInventoryTitleEl: HTMLDivElement;
  /** 快捷栏：携带版**无论哪一页都可见**（Wiki 原文） */
  private readonly hotbarGridEl: HTMLDivElement;
  /**
   * **物品分类**那一栏的落脚点（批次 157 → 159）：**与"我的物品 / 创造物品"共用左栏**。
   *
   * 批次 159 之前这里放的是配方书，但用户要的是"左栏 = 物品分类"：
   * 点分类 → 列出该分类下的**物品**（默认只列我拥有的），配方开关只负责
   * "要不要把我没有的那些也列出来（红底）"。所以这里现在装的是分类物品网格。
   */
  private readonly categoryHostEl: HTMLDivElement;
  /**
   * 工作站左栏的两个页签（批次 277）：可做 / 背包。
   *
   * 配方驱动型工作站（熔炉系 / 锻造台 / 酿造台）默认列"白底能开工"的产物；
   * 想看自己背包时点「背包」——与工作台左下那颗箱子页签同一个语义。
   */
  private readonly stationTabsEl: HTMLDivElement;
  /** 可做列表的落脚点（网格 + 底部统计） */
  private readonly stationRecipeHostEl: HTMLDivElement;
  private stationRecipeGridEl!: HTMLDivElement;
  private stationRecipeInfoEl!: HTMLDivElement;
  /** 左栏当前显示 `recipes` 还是 `items` */
  private stationLeft: 'recipes' | 'items' = 'recipes';
  /** 可做列表的指纹：没变就不重建（否则每搬一件东西都重画整栏） */
  private stationRecipeStamp = '';
  /** 当前这一栏的条目（点击时按 dataset 下标回查） */
  private stationRecipeEntries: StationRecipeEntry[] = [];
  /** 工作区下方那块"需要xxx / 缺什么"的说明（批次 293） */
  private readonly stationHintEl: HTMLDivElement;
  /** 目标框（批次 295）：选配方后显示产物，点它才开始制作 */
  private readonly stationTargetEl: HTMLDivElement;
  /** 当前选中的工作站配方（目标框里画的就是它） */
  private stationTargetEntry: StationRecipeEntry | null = null;
  /** 目标条目属于哪个容器：A/B 两座熔炉来回切时，防止把 A 的目标画到 B 上 */
  private stationTargetOwner: BlockContainer | null = null;
  /** 这一轮熔炉是否已经点过目标开工；没点过时手动摆料只能暂停（批次 324） */
  private furnaceStarted = false;
  /** 工作站格子里实际摆的是哪条配方（换配方时据此清掉旧料） */
  private stationFilledResultId: number | null = null;
  /** 点过目标框、正在自动收货：产物直接进快捷栏 → 仓库 → 脚边 */
  private stationAutoCollect = false;
  /** 酿造台开始时的三瓶药水快照：变了就说明这一轮酿好了（自动收货用） */
  private stationBrewSnapshot: (number | undefined)[] | null = null;
  /** 自动填进工作站的物品来自哪个背包格（换配方时尽量放回原格） */
  private readonly stationOrigins = new Map<string, { bagIndex: number; itemId: number }>();
  /** `takeFromBag` 最近一次实际取件的背包下标 */
  private lastBagTakeIndex = -1;
  /** 分类物品网格 */
  private categoryGrid!: HTMLDivElement;
  /** 分类物品那一栏的搜索框（只在"全部"那一栏出现） */
  private categorySearch!: HTMLInputElement;
  /** 左栏分类底部那行统计（批次 185：当前分类我有几种 / 共几种） */
  private categoryInfo!: HTMLDivElement;
  private categoryPrev!: HTMLButtonElement;
  private categoryNext!: HTMLButtonElement;
  private categoryPageLabel!: HTMLSpanElement;
  private categoryPager!: HTMLDivElement;
  /**
   * 左栏当前显示哪一份（批次 181 收成**一个**状态）。
   *
   * 原来有 `leftPaneKind` + `creativeSurvival` 两套布尔，创造模式下
   * "切到生存背包再点分类"会被 `applyInventoryChrome` 里的
   * `if (creativePlayer) leftPaneKind = 'items'` 强行改回去——分类按钮看起来"失灵"。
   */
  private pane: 'creative' | 'category' | 'items' = 'items';
  /** 上一次排布时的模式：模式变了要把左栏重置回该模式的默认页 */
  private lastCreative = false;
  /** 当前分类（全部 / 建筑 / 装备 / 物品 / 自然） */
  private categoryTab: RecipeBookTab = 'all';
  private categoryQuery = '';
  private categoryPage = 0;
  /** 分类栏上一次渲染的指纹（没变就不重建，见 `renderCategoryGrid`） */
  private categoryStamp = '';
  /**
   * 分类栏的"按住滑动预览"（批次 211）。
   *
   * 用户要求："手按下去不抬起的时候，滑到哪一个物品上就查看哪一个的配方。"
   * 按下只做**预览**（不动背包、不动合成格），抬手且没滑动才真正填充材料；
   * 这样滑动过程中列表不会因为库存变化而重建，手指底下的格子保持稳定。
   */
  private categoryScrub: {
    pointerId: number;
    itemId: number;
    moved: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null = null;
  /** 创造栏上一次渲染的指纹（内容只跟分类 / 搜索词 / 页码有关，见 `renderCreativeGrid`） */
  private creativeStamp = '';
  /**
   * 「配方书开关」（批次 159 引入，批次 209 按用户澄清定稿）：
   *
   *  - **开**：列出该分类下的**全部物品**（相当于翻配方书，找你不知道怎么做的东西）；
   *  - **关**（默认）：只列**现在能合成**的 + **之前真正做过、现在缺料**的（红底）。
   *
   * 颜色与开关无关：白底一律表示"当前材料够、且当前格子放得下"，
   * 其余（缺料、需要 3×3、根本没有配方）都是红底。
   */
  private showUnowned = false;
  /**
   * **用过**的配方产物（批次 211；取代"看过的"）。
   *
   * 用户澄清：配方开关关着时"不再显示那些我看过的配方"，只留
   * ① 当前能合成的；② **真正做过**的（后来缺料了也红底留着，方便再凑材料）。
   * 所以只在**取出产物**时记录，点一下看看不再往列表里加东西。
   */
  private readonly usedRecipeIds = new Set<number>();
  /** 可合成产物集合的缓存（键是背包指纹，见 `craftableIds`） */
  private craftableCache: { stamp: string; ids: number[] } | null = null;
  /**
   * 材料不齐时把配方"画"进合成格（批次 159）：格子里是**预览**不是实物，
   * 缺的那件用红底标出来。点任何合成格就收掉。
   */
  private craftGhost: Array<{ id: number; have: boolean } | null> | null = null;
  /**
   * 缺料预览时**结果槽**里画什么（批次 206）。
   *
   * 用户："把材料以及生成物都要在工作台的槽内，现在工作台的槽只有材料。"
   * 材料够的时候走真实填充（结果由 `CraftingGrid` 算），材料不够时只有这份预览。
   */
  private previewResult: { id: number; count: number } | null = null;
  /**
   * 当前预览的配方"要什么工作台"（批次 185）：合成箭头上面那颗小图标。
   * `workbench` = 3×3 摆不下、`furnace` = 只能烧出来、`null` = 当前就能做。
   */
  private craftStation: 'workbench' | 'furnace' | null = null;
  private craftStationEl: HTMLDivElement | null = null;
  /** 经典 UI 标题栏上的「配方书」文字按钮；携带版改用左上图标条 */
  private recipesBtn: HTMLButtonElement | null = null;
  /** 携带版左上：配方书五个分类图标 */
  private readonly pocketRecipeBar: HTMLDivElement;
  /** 携带版底栏：合成 / 盔甲 / 物品栏 */
  private readonly pocketTabsEl: HTMLDivElement;
  /** 左下箱子页签（创造时也挂在左轨底） */
  private invTabEl!: HTMLButtonElement;
  /** 右轨：合成 / 盔甲 */
  private pocketSideEl!: HTMLDivElement;
  /** 3D 角色预览（批次 185）；WebGL 不可用时为 null，退回 2D 剪影 */
  private preview3d: PlayerPreview3D | null = null;
  private preview3dFailed = false;
  /** 拖拽预览用的指针（点击拖动 = 转一圈） */
  private previewDrag: { pointerId: number; x: number } | null = null;
  /** 标题栏那颗「成就」（容器界面用）与右轨那颗（双栏壳用），二选一显示 */
  private achievementsBtn: HTMLButtonElement | null = null;
  private railAchievementsEl: HTMLButtonElement | null = null;
  /** 创造分类条的父节点（挪到左轨后要能归还） */
  private creativeControls!: HTMLDivElement;
  /** 盔甲页标题（Wiki「盔甲」） */
  private readonly armorTitleEl: HTMLDivElement;
  /**
   * 携带版**右栏**当前显示什么（批次 140 → 157）。
   * 左栏见 `leftPane`：`items` / `creative` / `recipes` 三选一。
   */
  private pocketTab: PocketInventoryTab = 'crafting';
  /**
   * 右栏停在「盔甲」时，玩家在左栏点过的配方（批次 272）。
   *
   * 用户："右侧切到装备页时，左侧分类点击不要自动切回合成。"
   * 所以这里只记住"他想看哪条配方"，等他自己点回「合成」再显示；
   * 期间**不切页、不填格子**（隐藏的合成格一旦被填，关面板时材料会莫名回背包）。
   */
  private pendingRecipeId: number | null = null;
  /** 上一次排布时左栏显示的是哪一份（用来判断要不要给淡入） */
  private lastLeftPane: PocketLeftPane | '' = '';
  /** 上一次排布时右栏是不是"合成"（盔甲 ↔ 合成切换才淡入） */
  private lastRightCrafting = true;
  /** 创造 ↔ 生存背包 的切换按钮（容器界面里才出现；双栏左栏由 `pane` 管） */
  private creativeToggleBtn: HTMLButtonElement | null = null;
  /** 关闭键：触摸层挂上之后文案要从「关闭 (E)」改成 ✕ */
  private closeBtn: HTMLButtonElement | null = null;
  /** 关面板动画进行中，避免连点重复结算 */
  private closing = false;
  /** 关闭动画的 400ms 兜底定时器（批次 185：重新打开时要能取消它） */
  private closeTimer: number | null = null;
  /**
   * 全局监听（window / document）的解绑开关（批次 181）。
   *
   * 应用内退出世界会把整块面板销毁；不解绑的话，旧面板还在听 resize / pointerup /
   * keydown，回到主菜单后按 Q 仍会去丢一个已经不存在的光标物品。
   */
  private readonly listeners = new AbortController();
  /**
   * 触摸端最近一次"从哪一格拿起"（批次 142）：装不下时多余按 Wiki 回到来源格，
   * 而不是留在光标上。
   */
  private touchOrigin: { source: SlotSource; index: number; itemId: number } | null = null;
  /**
   * 手上那叠**是从哪个格子拿起来的**（批次 159）。
   *
   * 选中态原来是"画一个图标跟着光标飘"，但触摸端一次轻点根本不产生 `pointermove`，
   * 那块图标就停在居中容器的左上角（用户原话："物品图标会飘在左边"）。
   * 现在改成**把那叠画回来源格 + 底色变深**：既是"选中"，也顺带把
   * "两格都有东西 → 先后点两下 = 交换"这件事说清楚（换过来的那件就显示在来源格）。
   */
  private heldOriginEl: HTMLElement | null = null;
  /** 当前正被标记成"选中"的那一格（每次刷新先把旧的摘掉，避免高亮残留） */
  private selectedEl: HTMLElement | null = null;
  /** 熔炉原料/燃料的"选中"格：只高亮，不把物品拿起来（批次 305） */
  private selectedStationKey: string | null = null;
  /** 正被按下（还没抬手）的那一格：给它"沉下去"的样子，抬手就摘 */
  private pressingEl: HTMLElement | null = null;
  /**
   * 最近一次选中的配方分类（批次 159）。
   *
   * 标题栏那颗配方开关再点开时**沿用这一栏**——原来它写死成"全部"（放大镜），
   * 于是玩家在"建筑"里关掉再打开就被扔回"全部"，分类白选了。
   */
  private lastRecipeTab: RecipeBookTab = 'all';
  /**
   * 手上这叠是不是**从创造物品栏取出来的复制品**（批次 159）。
   *
   * 复制品没有来源格，所以它有专门的放置规则：放到已有物品的格子时
   * **直接覆盖、原来那件销毁**（基岩版创造就是这么做的），而不是把旧的那件
   * 换到手上——创造模式下"手上多出一叠"没有任何意义。
   */
  private heldFromCreative = false;
  /** 点物品时浮在快捷栏上方的那块小说明（批次 159）：几秒后自己消失 */
  private readonly pickToastEl: HTMLDivElement;
  /** 说明浮层的自动收起计时器 */
  private pickToastTimer = 0;
  /** 淡出动画结束后再挂 hidden 的计时器 */
  private pickToastFadeTimer = 0;
  private readonly creativeSection: HTMLDivElement;
  private readonly heldElement: HTMLDivElement;
  private readonly heldCanvas: HTMLCanvasElement;
  private readonly heldCount: HTMLSpanElement;
  private readonly resultElement: HTMLDivElement;
  private readonly chestGrid: HTMLDivElement;
  private readonly furnaceLayout: HTMLDivElement;
  /** 烟熏炉/高炉的"只吃什么"提示行（普通熔炉一直是空的） */
  private readonly furnaceHintEl: HTMLDivElement;
  /** 营火（批次 47）：4 个格子 + 各自的进度条 + 提示行 */
  private readonly campfireLayout: HTMLDivElement;
  private readonly campfireSlots: HTMLDivElement[] = [];
  private readonly campfireFills: HTMLElement[] = [];
  private readonly campfireHintEl: HTMLDivElement;
  private readonly furnaceInputSlot: HTMLDivElement;
  private readonly furnaceFuelSlot: HTMLDivElement;
  /** 真正的产物槽（批次 309）：与目标预览分开，生成物落在这里 */
  private readonly furnaceProductSlot: HTMLDivElement;
  /** 燃料说明（批次 300：显示当前燃料与手动更换提示） */
  private readonly furnaceFuelTextEl: HTMLSpanElement;
  /** 燃料备选区（批次 302）：背包里的可燃物直接列出来，点一下换上 */
  private readonly furnaceFuelOptionsEl: HTMLDivElement;
  private furnaceFuelOptionIds: number[] = [];
  /** 退还全部（批次 305）：把熔炉三格里的东西一次放回仓库 */
  private readonly furnaceReturnBtn: HTMLButtonElement;
  private readonly flameEl: HTMLDivElement;
  /** 附魔台（H9） */
  private readonly enchantLayout: HTMLDivElement;
  private readonly enchantItemSlot: HTMLDivElement;
  private readonly enchantLapisSlot: HTMLDivElement;
  private readonly enchantStatusEl: HTMLDivElement;
  private readonly enchantButtons: HTMLButtonElement[] = [];

  /** 铁砧（H8） */
  private readonly anvilLayout: HTMLDivElement;
  private readonly anvilLeftSlot: HTMLDivElement;
  private readonly anvilRightSlot: HTMLDivElement;
  private readonly anvilResultSlot: HTMLDivElement;
  private readonly anvilNameInput: HTMLInputElement;
  private readonly anvilCostEl: HTMLDivElement;
  private readonly anvilStatusEl: HTMLDivElement;
  private readonly grindstoneLayout: HTMLDivElement;
  private readonly grindstoneLeftSlot: HTMLDivElement;
  private readonly grindstoneRightSlot: HTMLDivElement;
  private readonly grindstoneResultSlot: HTMLDivElement;
  private readonly grindstoneHintEl: HTMLDivElement;
  private readonly grindstoneStatusEl: HTMLDivElement;
  private readonly cookFillEl: HTMLElement;

  /** 锻造台（K8 尾巴）：装备格 + 材料格 + 目标格 + 提示行 */
  private readonly smithingLayout: HTMLDivElement;
  private readonly smithingEquipmentSlot: HTMLDivElement;
  private readonly smithingMaterialSlot: HTMLDivElement;
  private readonly smithingHintEl: HTMLDivElement;

  /** 漏斗（批次 58）：5 格排成一行 + 一行动态提示（锁定/节奏） */
  private readonly hopperGrid: HTMLDivElement;
  private readonly hopperHintEl: HTMLDivElement;

  /**
   * 投掷器（批次 59）与发射器（批次 60）**共用**这一套九宫格：
   * 两者都是 9 格、都是红石脉冲触发，差别只在"吐之前看不看"——
   * 分成两个元素只会让两份布局代码慢慢漂开。
   */
  private readonly nineGrid: HTMLDivElement;
  private readonly nineHintEl: HTMLDivElement;

  /** 切石机（H11，批次 44）：一格输入 + 一列可选产物（按钮）+ 提示行 */
  private readonly stonecutterLayout: HTMLDivElement;
  private readonly stonecutterInputSlot: HTMLDivElement;
  private readonly stonecutterListEl: HTMLDivElement;
  private readonly stonecutterHintEl: HTMLDivElement;

  /**
   * 村民交易（J11，批次 88）：左边是他本人的状态（职业/等级/经验），右边是一列交易。
   *
   * 按钮里存着"这一条的价格与产物"两张小图标 + 一行说明，
   * 每次刷新**只更新文字与可用状态**（重建 DOM 会让手指点在已经被换掉的元素上——
   * 切石机那批踩过，见 `stonecutterInputId` 的注解）。
   */
  private readonly tradeLayout: HTMLDivElement;
  private readonly tradeInfoEl: HTMLDivElement;
  private readonly tradeLevelEl: HTMLDivElement;
  private readonly tradeListEl: HTMLDivElement;
  private readonly tradeHintEl: HTMLDivElement;

  /** 酿造台（H10）：3 个药水槽 + 材料槽 + 燃料槽 + 进度条 */
  private readonly brewingLayout: HTMLDivElement;
  private readonly brewBottleSlots: HTMLDivElement[] = [];
  private readonly brewIngredientSlot: HTMLDivElement;
  private readonly brewFuelSlot: HTMLDivElement;
  private readonly brewProgressEl: HTMLElement;
  private readonly brewFuelTextEl: HTMLDivElement;

  // 创造物品栏的分类与搜索状态。
  // 这几个元素在 buildCreativeSection() 里创建（构造函数中调用），
  // 因此不能用 readonly —— TS 无法跨方法验证"只赋值一次"。
  private creativeGrid!: HTMLDivElement;
  private creativeTabs!: HTMLDivElement;
  private creativeSearch!: HTMLInputElement;
  private creativeCountEl!: HTMLSpanElement;
  private creativeCategory: CreativeTab = 'all';
  private creativeQuery = '';
  /** 当前页（0 起）：换分类/改搜索词/屏幕变化时都要夹一次 */
  private creativePage = 0;
  /** 翻页条（上一页 / 页码 / 下一页）：只有一页时整条隐藏 */
  private creativePager!: HTMLDivElement;
  private creativePrev!: HTMLButtonElement;
  private creativeNext!: HTMLButtonElement;
  private creativePageLabel!: HTMLSpanElement;
  /** 创造销毁格（批次 139）：把手上那一叠清掉 */
  /** 页面尺寸变化（手机转屏）时重算每页条数：只在跨越窄屏阈值时才真的重渲染 */
  private readonly narrowQuery = typeof window === 'undefined' ? null : window.matchMedia(`(max-width: ${NARROW_MAX_WIDTH}px)`);

  /** key → 槽位绑定；key 形如 "inv:12" / "craft:3" / "furnace:1" / "chest:5" */
  private readonly bindings = new Map<string, SlotBinding>();
  /** 每个槽位当前显示的物品（提示框按元素反查；槽位会被反复重建，所以用 WeakMap 不占内存） */
  private readonly tooltipStacks = new WeakMap<HTMLElement, ItemStack>();
  private readonly grids: Record<2 | 3, CraftingGrid>;

  private mode: InventoryPanelMode = 'inventory';
  /**
   * 切石机上一次渲染按钮时的输入物品 id（-1 = 空）。
   * 用它决定"要不要重建那一列按钮"——见 `refreshStonecutter` 的注解。
   */
  private stonecutterInputId = -1;
  /**
   * 交易列表上一次渲染时的"指纹"（村民 id + 职业 + 等级）。
   *
   * 与 `stonecutterInputId` 同一条理由：**只有指纹变了才重建按钮**，
   * 其余刷新（背包变化、次数变化）只改文字与禁用状态——
   * 在触屏上重建 DOM 会让"手指刚落下、元素已经被换掉"变成一次空点击。
   */
  private tradeFingerprint = '';
  /** 交易列表里每个按钮的两个可变文字节点（剩余次数 / 材料提示） */
  private readonly tradeRows: Array<{ uses: HTMLElement; note: HTMLElement }> = [];
  /** 当前正在交易的村民（`trade` 模式专有；其余模式为 null） */
  private activeVillager: Villager | null = null;
  /** 当前打开的容器（熔炉/箱子/附魔台/铁砧/酿造台），类型由 `BlockEntityStore` 统一给出 */
  private activeContainer: BlockContainer | null = null;
  private containerDirty = false;
  private containerRefreshTimer = 0;
  /** 重入保护：自动收货会在 refresh 里 notify，不能递归重画造成进度/高亮错乱 */
  private refreshing = false;
  private refreshPending = false;

  private held: ItemStack | null = null;
  private open = false;
  /** 鼠标**悬停**在哪一格（批次 128：数字键 1-9 / F 作用在它上面） */
  private hovered: { key: string; source: SlotSource; index: number } | null = null;
  /** 这一次拖拽经过的槽位（批次 128：左键均分 / 右键每格一个） */
  private dragSlots: { source: SlotSource; index: number }[] = [];
  /** 拖拽用的按键（0 = 左、2 = 右；松手后应用分配） */
  private dragButton: 0 | 2 | null = null;
  /** 上一次点的是哪一格 + 什么时候（批次 128：双击收集） */
  private lastClick: { key: string; at: number } | null = null;

  constructor(
    private readonly atlas: TextureAtlas,
    private readonly inventory: Inventory,
    private readonly hooks: InventoryScreenHooks = {},
    /** 物品提示框；不传就自己建一个（验收脚本里单独构造界面时用得上） */
    private readonly tooltip: Tooltip = new Tooltip(),
  ) {
    this.grids = { 2: new CraftingGrid(2), 3: new CraftingGrid(3) };
    for (const grid of Object.values(this.grids)) grid.onChange = () => this.refresh();

    this.root = document.createElement('div');
    this.root.id = 'inventory-screen';
    this.root.className = 'hidden';

    // 一个委托监听覆盖所有槽位（含后面动态重建的创造物品栏）
    // 触摸端也开"长按看详情"（批次 95）：这里的长按**已经**被"右键"占着
    //（按住 ≥260ms = 取一半 / 放一个），所以按**时长分层**——260ms 起是右键，
    // 按住不放再到 600ms（`TOUCH_TOOLTIP_MS`）才是看详情。
    // 内容和位置都在**显示这一刻**重算，所以就算右键已经动过格子也不会显示过期数量
    this.tooltip.delegate(this.root, (target) => this.tooltipFor(target), {
      touchLongPressMs: TOUCH_TOOLTIP_MS,
    });

    this.shellEl = document.createElement('div');
    this.shellEl.className = 'inv-shell';
    this.railLeft = document.createElement('div');
    this.railLeft.className = 'inv-rail-left';
    this.railLeft.dataset.role = 'pocket-rail-left';
    this.railRight = document.createElement('div');
    this.railRight.className = 'inv-rail-right';
    this.railRight.dataset.role = 'pocket-rail-right';
    this.hotbarDock = document.createElement('div');
    this.hotbarDock.className = 'inv-hotbar-dock hidden';
    this.hotbarDock.dataset.role = 'pocket-hotbar-dock';

    this.panel = document.createElement('div');
    this.panel.className = 'inv-panel';

    const header = document.createElement('div');
    header.className = 'inv-header';
    this.titleEl = document.createElement('b');
    this.titleEl.textContent = '物品栏';
    const hint = document.createElement('span');
    hint.className = 'inv-header-hint';
    // 触摸端没有左右键之分，提示改成"轻点"的说法，免得玩家找不到右键
    // 构造时 body 可能还没挂 touch-mode（触摸层更晚才建），用 isTouchDevice 兜底
    const touchDevice = isTouchUi() || isTouchDevice();
    // ⚠️ 原来这里写着"点空白处关闭"——**那是错的**：面板外的 pointerdown 实际是
    // "把手上的东西丢出去"（批次 128 对齐原版），根本不会关界面（批次 111 顺手修掉）
    // 触摸端的提示要说出"长按能做两件事"里最反直觉的那一件（批次 137）：
    // 长按一格 = 出指示条选数量，左右划改数目——不说的话没人会去划
    hint.innerHTML = touchDevice
      ? '轻点拿起 / 再轻点放下 · 长按划动选数量 · 点空槽放下一个'
      : '按 <kbd>E</kbd> 或 <kbd>Esc</kbd> 关闭 · 左键整叠 / 右键单个';
    // 携带版：配方分类挂在左轨（Wiki 灰框外侧）；经典仍可塞进标题栏
    this.pocketRecipeBar = document.createElement('div');
    this.pocketRecipeBar.className = 'inv-pocket-recipes';
    this.pocketRecipeBar.dataset.role = 'pocket-recipes';
    if (this.hooks.onOpenRecipes) {
      for (const tab of RECIPE_BOOK_TABS_POCKET) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'inv-pocket-recipe-tab';
        button.dataset.tab = tab;
        button.title = RECIPE_BOOK_TAB_LABELS[tab];
        button.setAttribute('aria-label', `配方书 · ${RECIPE_BOOK_TAB_LABELS[tab]}`);
        if (tab === 'all') {
          button.innerHTML = POCKET_RECIPE_ALL_ICON;
        } else {
          const icon = document.createElement('canvas');
          icon.width = 18;
          icon.height = 18;
          drawItemIcon(icon, this.atlas, RECIPE_TAB_ICONS[tab], 16);
          button.appendChild(icon);
        }
        button.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          // 左上分类才打开配方书；右下工作台键只负责切换右栏。
          this.openPocketCategory(tab);
        });
        this.pocketRecipeBar.appendChild(button);
      }
    }
    header.append(this.titleEl, hint);
    // 创造模式：创造物品栏 ↔ 生存背包（批次 142；基岩版是两套界面）
    const creativeToggle = document.createElement('button');
    creativeToggle.type = 'button';
    creativeToggle.className = 'inv-recipes-btn inv-creative-toggle hidden';
    creativeToggle.dataset.role = 'creative-toggle';
    creativeToggle.addEventListener('click', () => {
      this.pane = this.pane === 'creative' ? 'items' : 'creative';
      this.applyInventoryChrome();
    });
    this.creativeToggleBtn = creativeToggle;
    header.appendChild(creativeToggle);
    if (this.hooks.onOpenRecipes) {
      const recipes = document.createElement('button');
      recipes.type = 'button';
      recipes.className = 'inv-recipes-btn inv-pocket-recipe-toggle';
      recipes.dataset.role = 'recipe-toggle';
      // 键盘热键的括注只在 PC 上给：手机上没有 R 这个键，写成"配方书 (R)"
      // 只会让人以为"要按 R 才能打开"（批次 104）
      recipes.textContent = touchDevice ? '配方书' : '配方书 (R)';
      // 批次 209：它就是"配方书"开关。
      //   左栏还在"我的物品"时：点它 = 进入上次那个分类（沿用 `lastRecipeTab`）；
      //   左栏已经是某个分类时：点它 = 在「只看能合成的」与「列出该分类全部物品」之间切。
      // 颜色始终按"现在能不能合成"区分（白 = 能做，红 = 缺料/要 3×3/没配方）。
      recipes.addEventListener('click', () => {
        if (this.pane === 'category') {
          this.showUnowned = !this.showUnowned;
          this.categoryPage = 0;
        } else {
          this.openPocketCategory(this.lastRecipeTab);
        }
        this.applyInventoryChrome();
      });
      this.recipesBtn = recipes;
      header.appendChild(recipes);
    }
    // 成就（M7）：与配方书并排。手机上这条是**唯一**的入口（没有 Esc、也没有暂停键）
    if (this.hooks.onOpenAdvancements) {
      const achievements = document.createElement('button');
      achievements.type = 'button';
      achievements.className = 'inv-recipes-btn';
      achievements.dataset.role = 'advancements';
      achievements.textContent = touchDevice ? '成就' : '成就 (J)';
      achievements.addEventListener('click', () => this.hooks.onOpenAdvancements?.());
      this.achievementsBtn = achievements;
      header.appendChild(achievements);
    }
    // 关闭键（批次 111，用户："不要点击空白关闭，就用关闭按钮"）。
    // ⚠️ 背包原来**根本没有关闭键**：手机上的出口只有"再点一次快捷栏旁边那颗背包键"
    // （没人猜得到）或 Android 返回手势。与配方书/成就的关闭键同一套外观、同样在右上。
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'inv-close';
    closeButton.textContent = touchDevice ? '✕' : '关闭 (E)';
    closeButton.setAttribute('aria-label', '关闭背包');
    closeButton.addEventListener('click', () => this.close());
    this.closeBtn = closeButton;
    header.appendChild(closeButton);
    this.panel.appendChild(header);

    // ---- 玩家那一块（批次 111，对齐原版）：**装备竖排在左、其余在右**
    //
    // 原版（Java 与基岩版手机都是）物品栏的左栏是"盔甲 4 格竖排 + 副手"，
    // 右栏才是"合成 / 容器 + 3×9 主背包 + 9 快捷栏"。原来我们是竖着堆成五段、
    // 还各带一行文字标签（「主背包 / 快捷栏 / 盔甲与副手」）——原版没有这些字，
    // 靠位置与间距就能分清。这里改成"两列 + 无标签"。
    // ⚠️ 两列用固定的 grid-column 定位，而不是靠 DOM 顺序：`topArea`（随模式切换的
    // 合成/箱子/熔炉）是在下面几行里建的，顺序上先于装备列。
    this.playerBody = document.createElement('div');
    this.playerBody.className = 'inv-body';
    this.mainColumn = document.createElement('div');
    this.mainColumn.className = 'inv-main';
    this.playerBody.appendChild(this.mainColumn);

    // ---- 上半部分：随模式切换
    this.topArea = document.createElement('div');
    this.topArea.className = 'inv-top';
    this.mainColumn.appendChild(this.topArea);

    // 2×2 / 3×3 合成区的结果槽（点击行为由 createSlot 内的统一监听按 key 分发）
    this.resultElement = this.createSlot();
    this.resultElement.dataset.key = 'craft:result';

    // 箱子 3×9
    this.chestGrid = document.createElement('div');
    this.chestGrid.className = 'inv-grid inv-chest';

    // 漏斗（批次 58）：5 格排成一行（原版界面也是一排 5 个）
    this.hopperGrid = document.createElement('div');
    this.hopperGrid.className = 'inv-grid inv-hopper';
    this.hopperHintEl = document.createElement('div');
    this.hopperHintEl.className = 'anvil-cost';

    // 投掷器（批次 59）与发射器（批次 60）：3×3（原版这两兄弟的界面都是九宫格）
    this.nineGrid = document.createElement('div');
    this.nineGrid.className = 'inv-grid inv-nine';
    this.nineHintEl = document.createElement('div');
    this.nineHintEl.className = 'anvil-cost';

    // 熔炉
    this.furnaceLayout = document.createElement('div');
    this.furnaceLayout.className = 'furnace-layout';
    this.furnaceHintEl = document.createElement('div');
    this.furnaceHintEl.className = 'anvil-cost';

    // 营火：4 个"格子 + 进度条"的列（烤好的东西会自己弹出来，所以没有产物槽）
    this.campfireLayout = document.createElement('div');
    this.campfireLayout.className = 'campfire-grid';
    for (let i = 0; i < CAMPFIRE_SIZE; i++) {
      const slot = this.createSlot();
      slot.dataset.key = `campfire:${i}`;
      const track = document.createElement('div');
      track.className = 'furnace-cook campfire-cook';
      const fill = document.createElement('i');
      track.appendChild(fill);
      const col = document.createElement('div');
      col.className = 'campfire-col';
      col.append(slot, track);
      this.campfireSlots.push(slot);
      this.campfireFills.push(fill);
      this.campfireLayout.appendChild(col);
    }
    this.campfireHintEl = document.createElement('div');
    this.campfireHintEl.className = 'anvil-cost';
    this.furnaceInputSlot = this.createSlot();
    this.furnaceFuelSlot = this.createSlot();
    this.furnaceProductSlot = this.createSlot();
    this.furnaceFuelSlot.dataset.key = 'furnace:fuel';
    this.furnaceInputSlot.dataset.key = 'furnace:input';
    this.furnaceProductSlot.dataset.key = 'furnace:product';
    this.furnaceFuelTextEl = document.createElement('span');
    this.furnaceFuelTextEl.className = 'furnace-fuel-text';
    this.furnaceFuelOptionsEl = document.createElement('div');
    this.furnaceFuelOptionsEl.className = 'furnace-fuel-options';
    this.furnaceReturnBtn = document.createElement('button');
    this.furnaceReturnBtn.type = 'button';
    this.furnaceReturnBtn.className = 'furnace-return hidden';
    this.furnaceReturnBtn.textContent = '退还仓库';
    this.furnaceReturnBtn.title = '把熔炉里的原料、燃料和产物全部放回仓库';
    this.furnaceReturnBtn.addEventListener('click', () => this.returnFurnaceContents());
    // 铁砧（H8）：左格 + 右格 + 产物格 + 改名输入框
    this.anvilLayout = document.createElement('div');
    this.anvilLayout.className = 'anvil-layout';
    this.anvilLeftSlot = this.createSlot();
    this.anvilLeftSlot.dataset.key = 'anvil:left';
    this.anvilRightSlot = this.createSlot();
    this.anvilRightSlot.dataset.key = 'anvil:right';
    this.anvilResultSlot = this.createSlot();
    this.anvilResultSlot.dataset.key = 'anvil:result';
    this.anvilNameInput = document.createElement('input');
    this.anvilNameInput.type = 'text';
    this.anvilNameInput.className = 'anvil-name';
    this.anvilNameInput.maxLength = 40;
    this.anvilNameInput.placeholder = '重命名为……（可留空）';
    this.anvilNameInput.addEventListener('input', () => {
      const anvil = this.activeContainer;
      if (anvil instanceof Anvil) anvil.setName(this.anvilNameInput.value);
    });
    this.anvilCostEl = document.createElement('div');
    this.anvilCostEl.className = 'anvil-cost';
    this.anvilStatusEl = document.createElement('div');
    this.anvilStatusEl.className = 'enchant-status';

    // 砂轮（H15，批次 188）：与铁砧同一套 "左 + 右 → 产物" 布局，少一个改名输入框
    this.grindstoneLayout = document.createElement('div');
    this.grindstoneLayout.className = 'anvil-layout';
    this.grindstoneLeftSlot = this.createSlot();
    this.grindstoneLeftSlot.dataset.key = 'grindstone:left';
    this.grindstoneRightSlot = this.createSlot();
    this.grindstoneRightSlot.dataset.key = 'grindstone:right';
    this.grindstoneResultSlot = this.createSlot();
    this.grindstoneResultSlot.dataset.key = 'grindstone:result';
    this.grindstoneHintEl = document.createElement('div');
    this.grindstoneHintEl.className = 'anvil-cost';
    this.grindstoneStatusEl = document.createElement('div');
    this.grindstoneStatusEl.className = 'enchant-status';

    // 锻造台（K8 尾巴）：装备格 + 材料格 + 产物格（比铁砧少一个改名输入框）
    this.smithingLayout = document.createElement('div');
    this.smithingLayout.className = 'anvil-layout';
    this.smithingEquipmentSlot = this.createSlot();
    this.smithingEquipmentSlot.dataset.key = 'smithing:equipment';
    this.smithingMaterialSlot = this.createSlot();
    this.smithingMaterialSlot.dataset.key = 'smithing:material';
    this.smithingHintEl = document.createElement('div');
    this.smithingHintEl.className = 'anvil-cost';

    // 切石机（H11，批次 44）：一格输入 + 一列"能切出什么"的按钮
    this.stonecutterLayout = document.createElement('div');
    this.stonecutterLayout.className = 'stonecutter-layout';
    this.stonecutterInputSlot = this.createSlot();
    this.stonecutterInputSlot.dataset.key = `stonecutter:${STONECUTTER_INPUT}`;
    this.stonecutterListEl = document.createElement('div');
    this.stonecutterListEl.className = 'stonecutter-list';
    this.stonecutterHintEl = document.createElement('div');
    this.stonecutterHintEl.className = 'anvil-cost';

    // 村民交易（J11，批次 88）：左边是他的状态，右边是一列交易（没有收货格）
    this.tradeLayout = document.createElement('div');
    this.tradeLayout.className = 'stonecutter-layout';
    this.tradeInfoEl = document.createElement('div');
    this.tradeInfoEl.className = 'trade-info';
    this.tradeLevelEl = document.createElement('div');
    this.tradeLevelEl.className = 'trade-level';
    this.tradeListEl = document.createElement('div');
    this.tradeListEl.className = 'stonecutter-list trade-list';
    this.tradeHintEl = document.createElement('div');
    this.tradeHintEl.className = 'anvil-cost';

    // 附魔台（H9）：物品槽 + 青金石槽 + 三个候选按钮
    this.enchantLayout = document.createElement('div');
    this.enchantLayout.className = 'enchant-layout';
    this.enchantItemSlot = this.createSlot();
    this.enchantLapisSlot = this.createSlot();
    this.enchantItemSlot.dataset.key = 'enchant:item';
    this.enchantLapisSlot.dataset.key = 'enchant:lapis';
    this.enchantStatusEl = document.createElement('div');
    this.enchantStatusEl.className = 'enchant-status';

    // 酿造台（H10）：药水槽是**三格**，材料与燃料分开两格（原版 3 + 1 + 1）
    this.brewingLayout = document.createElement('div');
    this.brewingLayout.className = 'brewing-layout';
    for (const slot of BREW_BOTTLE_SLOTS) {
      const element = this.createSlot();
      element.dataset.key = `brewing:${slot}`;
      this.brewBottleSlots.push(element);
    }
    this.brewIngredientSlot = this.createSlot();
    this.brewIngredientSlot.dataset.key = `brewing:${BREW_INGREDIENT_SLOT}`;
    this.brewFuelSlot = this.createSlot();
    this.brewFuelSlot.dataset.key = `brewing:${BREW_FUEL_SLOT}`;
    this.brewProgressEl = document.createElement('i');
    this.brewFuelTextEl = document.createElement('div');
    this.brewFuelTextEl.className = 'brewing-fuel-text';

    this.flameEl = document.createElement('div');
    this.flameEl.className = 'furnace-flame';
    const flameFill = document.createElement('i');
    this.flameEl.appendChild(flameFill);
    this.cookFillEl = document.createElement('i');
    const cookTrack = document.createElement('div');
    cookTrack.className = 'furnace-cook';
    cookTrack.appendChild(this.cookFillEl);

    // ---- 玩家背包（右栏）：3×9 主背包 + 9 快捷栏。
    // 平常仍靠位置区分；合成双窗里要显式写「物品栏」，否则左侧配方候选与
    // 右侧玩家仓库的语义很容易看反（尤其触摸端没有悬停提示）。
    // 携带版分页（批次 140）要单独显隐主背包，快捷栏则**始终留下**
    this.personalInventoryTitleEl = document.createElement('div');
    this.personalInventoryTitleEl.className = 'inv-personal-title';
    this.personalInventoryTitleEl.textContent = '物品栏';
    this.mainGridEl = this.buildGrid(MAIN_START, MAIN_SIZE, 'inv-grid', 'inv');
    this.hotbarGridEl = this.buildGrid(HOTBAR_START, HOTBAR_SIZE, 'inv-grid inv-hotbar', 'inv');
    // 经典：快捷栏在面板内；携带版由 applyInventoryChrome 挪到 hotbarDock
    this.mainColumn.append(this.personalInventoryTitleEl, this.mainGridEl, this.hotbarGridEl);

    // ---- 玩家装备（左栏，4 格盔甲 + 1 格副手）竖排；
    // 空槽显示部位提示字（头/胸/腿/靴/副），触摸端才知道该放哪
    this.gearEl = document.createElement('div');
    this.gearEl.className = 'inv-gear';
    // Wiki 盔甲页右栏标题「盔甲」
    this.armorTitleEl = document.createElement('div');
    this.armorTitleEl.className = 'inv-armor-title';
    this.armorTitleEl.textContent = '盔甲';
    // 玩家预览（批次 141）：盔甲列旁边那块小人，原版有、我们也要有位置
    this.playerPreviewEl = document.createElement('canvas');
    this.playerPreviewEl.className = 'inv-player-preview';
    this.playerPreviewEl.dataset.role = 'player-preview';
    // 拖一下 = 转一圈（批次 185）。`touch-action: none` 在 CSS 里，避免拖动被当成滚动
    this.playerPreviewEl.addEventListener('pointerdown', (event) => {
      if (!this.preview3d) return;
      event.preventDefault();
      this.previewDrag = { pointerId: event.pointerId, x: event.clientX };
      try {
        this.playerPreviewEl.setPointerCapture(event.pointerId);
      } catch {
        // 某些浏览器在合成事件上会拒绝，拖不动就算了
      }
    });
    this.playerPreviewEl.addEventListener('pointermove', (event) => {
      const drag = this.previewDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      drag.x = event.clientX;
      this.preview3d?.rotateBy(dx);
    });
    const endPreviewDrag = (event: PointerEvent): void => {
      if (this.previewDrag?.pointerId === event.pointerId) this.previewDrag = null;
    };
    this.playerPreviewEl.addEventListener('pointerup', endPreviewDrag);
    this.playerPreviewEl.addEventListener('pointercancel', endPreviewDrag);
    this.playerPreviewEl.setAttribute('aria-label', '玩家预览');
    const gearRow = document.createElement('div');
    gearRow.className = 'inv-gear-row';
    gearRow.append(this.buildArmorGrid(), this.playerPreviewEl);
    this.gearEl.append(this.armorTitleEl, gearRow);
    this.playerBody.appendChild(this.gearEl);
    this.panel.appendChild(this.playerBody);

    // 携带版页签（批次 146）：贴在灰框**外侧**左右轨（Wiki 图），不再塞进 panel 里负偏移
    this.pocketTabsEl = document.createElement('div');
    this.pocketTabsEl.className = 'inv-pocket-tabs';
    this.pocketTabsEl.dataset.role = 'pocket-tabs';

    this.pocketSideEl = document.createElement('div');
    this.pocketSideEl.className = 'inv-pocket-side';
    // 批次 185（用户）：成就挪到右轨、**在合成/盔甲上面**——与那两颗同属"右栏的入口"，
    // 比挤在 18px 高的标题栏里合理。容器界面没有右轨，那边仍用标题栏那颗（见 applyInventoryChrome）。
    this.railAchievementsEl = this.makeRailAction('成就', ACHIEVEMENT_ICON, () => this.hooks.onOpenAdvancements?.());
    this.pocketSideEl.append(
      this.railAchievementsEl,
      this.makePocketIconTab('crafting', '合成', Block.CRAFTING_TABLE),
      this.makePocketIconTab('armor', '盔甲', null),
    );
    this.invTabEl = this.makePocketIconTab('inventory', '物品栏', Block.CHEST);
    this.invTabEl.classList.add('inv-pocket-inv-tab');
    // 页签挂在左右轨（Wiki：贴灰框外侧）；pocketTabsEl 只挂 role + .hidden（不参与布局）
    this.railLeft.append(this.pocketRecipeBar, this.invTabEl);
    this.railRight.appendChild(this.pocketSideEl);
    this.pocketTabsEl.setAttribute('aria-hidden', 'true');

    // 物品分类落脚点：与"我的物品 / 创造物品"同属左栏，位置由 CSS 网格固定
    this.categoryHostEl = document.createElement('div');
    this.categoryHostEl.className = 'inv-category-section';
    this.categoryHostEl.dataset.role = 'pocket-category-host';
    this.buildCategorySection();


    // 工作站左栏（批次 277）：可做 / 背包 两个页签 + 可做列表。
    // ⚠️ 必须在 `buildCreativeSection()` 之前建好：后者会调 `updateCreativeVisibility()`
    // → `applyInventoryChrome()`，而那里会直接写这两个元素的 display。
    this.stationTabsEl = document.createElement('div');
    this.stationTabsEl.className = 'inv-station-tabs';
    this.stationTabsEl.dataset.role = 'station-tabs';
    for (const [key, label] of [
      ['recipes', '可做'],
      ['items', '背包'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inv-station-tab';
      button.dataset.stationLeft = key;
      button.textContent = label;
      button.addEventListener('click', () => this.setStationLeft(key));
      this.stationTabsEl.appendChild(button);
    }
    this.stationRecipeHostEl = document.createElement('div');
    this.stationRecipeHostEl.className = 'inv-station-recipes';
    this.stationRecipeHostEl.dataset.role = 'station-recipes';
    this.stationRecipeGridEl = document.createElement('div');
    this.stationRecipeGridEl.className = 'inv-grid inv-station-grid';
    this.stationRecipeInfoEl = document.createElement('div');
    this.stationRecipeInfoEl.className = 'inv-category-info';
    this.stationRecipeHostEl.append(this.stationRecipeGridEl, this.stationRecipeInfoEl);

    // 工作区下方的"需要xxx / 缺什么"（批次 293）：每个工作站重建上半区时挂到 topArea 里
    this.stationHintEl = document.createElement('div');
    this.stationHintEl.className = 'inv-station-hint hidden';
    this.stationHintEl.dataset.role = 'station-hint';

    // 目标框：外观与普通槽位一致，但**不绑定容器槽**——它只负责"预览产物 + 点一下开始"
    this.stationTargetEl = this.createSlot();
    this.stationTargetEl.classList.add('station-target');
    this.stationTargetEl.dataset.role = 'station-target';
    this.stationTargetEl.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.clickStationTarget();
    });

    this.creativeSection = document.createElement('div');
    this.creativeSection.className = 'inv-creative-section';
    this.buildCreativeSection();

    // 携带版统一双栏：左栏在“玩家物品 / 创造物品 / 可做列表”之间切换，右栏是合成/装备/工作站。
    // 放进 playerBody 才能与 mainColumn / gear 共用同一套两栏网格。
    this.playerBody.append(
      this.creativeSection,
      this.categoryHostEl,
      this.stationTabsEl,
      this.stationRecipeHostEl,
    );

    // 顺序：左轨（配方+箱子）| 灰框 | 右轨（合成/盔甲）——页签在 panel 外
    this.shellEl.append(this.railLeft, this.panel, this.railRight, this.pocketTabsEl);
    this.root.append(this.shellEl, this.hotbarDock);

    // 转屏会改视口尺寸（面板宽高里有 100vw/100dvh）：重排一次把尺寸对齐
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.applyPocketLayout(), { signal: this.listeners.signal });
    }

    this.heldElement = document.createElement('div');
    this.heldElement.id = 'inv-held';
    this.heldCanvas = document.createElement('canvas');
    this.heldCount = document.createElement('span');
    this.heldElement.append(this.heldCanvas, this.heldCount);
    this.root.appendChild(this.heldElement);

    // 点物品时那块小说明（批次 159）：挂在 root 上，跟着界面一起显隐
    this.pickToastEl = document.createElement('div');
    this.pickToastEl.id = 'inv-pick-toast';
    this.pickToastEl.className = 'hidden';
    // 批次 211：点一下立刻收起（不必等 2 秒），并拦住这次点击（不要顺手丢东西）
    this.pickToastEl.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hidePickToast(true);
    });
    this.root.appendChild(this.pickToastEl);

    document.body.appendChild(this.root);

    this.bindEvents();
    this.inventory.onChange = () => this.refresh();
    this.rebuildTopArea();
    this.applyInventoryChrome();
    this.refresh();
  }

  // ---------------------------------------------------------------- DOM 构建

  private get crafting(): CraftingGrid {
    return this.grids[this.mode === 'crafting' ? 3 : 2];
  }

  private buildLabel(text: string): HTMLDivElement {
    const label = document.createElement('div');
    label.className = 'inv-label';
    label.textContent = text;
    return label;
  }

  private buildGrid(start: number, size: number, className: string, prefix: string): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = className;
    for (let i = 0; i < size; i++) {
      const index = start + i;
      grid.appendChild(this.registerSlot(`${prefix}:${index}`, this.inventory, index));
    }
    return grid;
  }

  /** 盔甲 4 格 + 副手 1 格（槽位号 36-40，与原版一致） */
  private buildArmorGrid(): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'inv-grid inv-armor';
    const hints = ['头', '胸', '腿', '靴', '副手'];
    for (let i = 0; i < ARMOR_SIZE + 1; i++) {
      const index = ARMOR_START + i;
      const slot = this.registerSlot(`inv:${index}`, this.inventory, index);
      const hint = document.createElement('span');
      hint.className = i === ARMOR_SIZE ? 'inv-slot-hint inv-slot-hint-wide' : 'inv-slot-hint';
      hint.textContent = hints[i]!;
      slot.appendChild(hint);
      // 批次 275：副手原来只写「副」，玩家联想不到盾牌。触摸端没有悬停提示，
      // 所以文案写全 + 槽位 title 也说清能放什么。
      if (i === ARMOR_SIZE) slot.title = '副手：盾牌 / 火把 / 图腾等';
      grid.appendChild(slot);
    }
    return grid;
  }

  /** 创造物品栏：分类标签 + 搜索框 + 物品网格 */
  private buildCreativeSection(): void {
    const header = document.createElement('div');
    header.className = 'inv-label';
    header.append('创造物品栏');
    this.creativeCountEl = document.createElement('span');
    this.creativeCountEl.className = 'inv-count-label';
    header.appendChild(this.creativeCountEl);

    this.creativeControls = document.createElement('div');
    this.creativeControls.className = 'inv-creative-controls';

    this.creativeTabs = document.createElement('div');
    this.creativeTabs.className = 'inv-tabs';
    this.creativeTabs.dataset.role = 'creative-tabs';
    for (const category of CREATIVE_TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inv-tab';
      button.dataset.category = category;
      // 图标 + 文字（批次 98，对齐基岩版）：图标是**注册表里的真实物品**
      // （砖块/镐/工作台/草方块），窄屏可以只留图标；五个顶层分类与基岩版一致。
      // 文字用 span 包着是为了能在窄屏单独隐藏它
      const icon =
        category === 'all'
          ? this.makeSearchTabIcon()
          : document.createElement('canvas');
      icon.classList.add('inv-tab-icon');
      if (icon instanceof HTMLCanvasElement) {
        drawItemIcon(icon, this.atlas, CREATIVE_TAB_ICONS[category], 18);
      }
      const label = document.createElement('span');
      label.className = 'inv-tab-label';
      label.textContent = category === 'all' ? '搜索' : CREATIVE_TAB_LABELS[category];
      button.title = label.textContent;
      button.setAttribute('aria-label', label.textContent);
      button.append(icon, label);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.creativeCategory = category;
        // 换分类回到第 1 页：停在"第 7 页"而新分类只有 2 页会显示空网格
        this.creativePage = 0;
        // ⚠️ 换到不显示搜索框的分类时**把搜索词清掉**，否则那是个看不见的过滤器：
        //    列表会一直空着，而玩家已经没有输入框可以取消它（"分类栏怎么全空了"）
        if (category !== 'all') {
          this.creativeQuery = '';
          this.creativeSearch.value = '';
        }
        // Wiki：创造模式下点左侧分类 = 回到创造物品网格（离开生存背包）
        // 批次 181：分类条现在**常驻左轨**，所以这里只要把 pane 切回去，
        // 不再有"按钮被搬走、点了没反应"的情况
        this.pane = 'creative';
        this.applyInventoryChrome();
        this.updateTabHighlight();
        // 批次 185：换分类要**回到这一类的最上面**——原来沿用上一类的滚动位置，
        // 玩家切过去看到的是"从中间开始"的列表，得自己滑回顶部。
        this.creativeGrid.scrollTop = 0;
        this.renderCreativeGrid();
        // 批次 181：任何点击都在快捷栏上方说一句"刚才点了什么"
        this.showMessage(`创造分类：${CREATIVE_TAB_LABELS[category]}`);
        if (category === 'all') this.creativeSearch.focus();
      });
      this.creativeTabs.appendChild(button);
    }

    this.creativeSearch = document.createElement('input');
    this.creativeSearch.type = 'text';
    this.creativeSearch.className = 'inv-search';
    this.creativeSearch.placeholder = '搜索物品…';
    this.creativeSearch.addEventListener('input', () => {
      this.creativeQuery = this.creativeSearch.value.trim().toLowerCase();
      // 搜索是从头筛一遍，页码当然要回到第 1 页
      this.creativePage = 0;
      this.renderCreativeGrid();
    });

    this.creativeControls.append(this.creativeTabs, this.creativeSearch);

    this.creativeGrid = document.createElement('div');
    this.creativeGrid.className = 'inv-grid inv-creative';

    // 翻页条：只渲染当前页之后，"全部"分类也不会一次性塞进 495 个图标
    this.creativePager = document.createElement('div');
    this.creativePager.className = 'inv-pager';
    this.creativePrev = this.makePagerButton('‹ 上一页', () => this.flipCreativePage(-1));
    this.creativeNext = this.makePagerButton('下一页 ›', () => this.flipCreativePage(1));
    this.creativePageLabel = document.createElement('span');
    this.creativePageLabel.className = 'inv-page-label';
    this.creativePrev.dataset.role = 'prev';
    this.creativeNext.dataset.role = 'next';
    this.creativePageLabel.dataset.role = 'label';
    this.creativePager.append(this.creativePrev, this.creativePageLabel, this.creativeNext);

    // 批次 185（用户要求）：创造栏下面那颗「销毁」格**去掉**。
    // 它占掉了一整行高度，而且和"拖到界面外丢弃"是同一件事的两种入口；
    // 现在统一走"点界面外丢弃"（`dropFromCursor` / root 空白区）。
    this.creativeSection.append(header, this.creativeControls, this.creativeGrid, this.creativePager);
    this.updateTabHighlight();
    this.renderCreativeGrid();
    this.updateCreativeVisibility();

    // 转屏（竖屏 ↔ 横屏）会改变每页条数：跨过阈值时按新页大小重排
    this.narrowQuery?.addEventListener('change', () => this.renderCreativeGrid());
  }

  /**
   * 创造搜索框只跟「搜索」那一栏走（批次 159）。
   *
   * 与生存模式同一个口径：那边是 `.recipe-panel:not([data-tab='all']) .recipe-controls`
   * 把搜索行整条藏掉——点放大镜才有搜索框，点别的分类直接从物品格开始。
   */
  private syncCreativeSearch(): void {
    this.creativeSearch.style.display = this.creativeCategory === 'all' ? '' : 'none';
  }

  /**
   * 左栏的**物品分类**（批次 159）。
   *
   * 这一栏的职责是"按分类找东西"，不是"看配方"：
   *  - 默认只列**我拥有的**（`showUnowned = false`）——泥土在我仓库里，
   *    点"自然"就应该看到它；
   *  - 配方开关打开时把该分类下的**所有物品**都列出来，我没有的用红底标出，
   *    这样才知道"还有什么可以做、大概要什么"。
   */
  private buildCategorySection(): void {
    this.categorySearch = document.createElement('input');
    this.categorySearch.type = 'text';
    this.categorySearch.className = 'inv-search';
    // 批次 206：这一栏列的是"能合成什么"，搜索的也是产物名（不是仓库里的东西）
    this.categorySearch.placeholder = '搜索可合成的物品…';
    this.categorySearch.addEventListener('input', () => {
      this.categoryQuery = this.categorySearch.value.trim().toLowerCase();
      this.renderCategoryGrid();
    });

    this.categoryGrid = document.createElement('div');
    this.categoryGrid.className = 'inv-grid inv-category';

    this.categoryPager = document.createElement('div');
    this.categoryPager.className = 'inv-pager';
    this.categoryPrev = this.makePagerButton('‹ 上一页', () => this.flipCategoryPage(-1));
    this.categoryNext = this.makePagerButton('下一页 ›', () => this.flipCategoryPage(1));
    this.categoryPageLabel = document.createElement('span');
    this.categoryPageLabel.className = 'inv-page-label';
    this.categoryPrev.dataset.role = 'prev';
    this.categoryNext.dataset.role = 'next';
    this.categoryPageLabel.dataset.role = 'label';
    this.categoryPager.append(this.categoryPrev, this.categoryPageLabel, this.categoryNext);

    // 底部一行小字（批次 185，用户："分类下面还有空间，加一条信息栏"）：
    // 这一栏是"按分类找东西"，玩家最常问的两件事就是**这一类我有几种**、
    // **总共有几种**（差额就是配方开关打开后那些红底的）。
    this.categoryInfo = document.createElement('div');
    this.categoryInfo.className = 'inv-category-info';
    this.categoryInfo.dataset.role = 'category-info';

    this.categoryHostEl.append(this.categorySearch, this.categoryGrid, this.categoryPager, this.categoryInfo);
  }

  /**
   * **当前背包材料能合成出来的产物 id**（批次 206）。
   *
   * 用户澄清："分类项以及搜索，不是为了分类查看仓库的物品，而是展示仓库内的物品
   * 可以合成的物品。"——所以这一栏的数据源从"我有什么"换成了"我能做出什么"。
   *
   * 配方表 550+ 条，每条要遍历一遍材料；`refresh()` 每搬一件东西就会调到这里，
   * 所以按**背包指纹**缓存（同一个指纹下材料分布没变，结果一定一样）。
   */
  private craftableIds(): number[] {
    const stamp = `${this.inventoryStamp()}|${this.crafting.size}|${this.craftingStamp()}`;
    if (this.craftableCache?.stamp === stamp) return this.craftableCache.ids;
    // ⚠️ 材料要连**合成格里已摆好的**一起算：点一条配方时材料会从仓库挪进格子，
    // 只看仓库的话，刚点完那一下这条配方就变成"缺料"（列表立刻红掉，像出错了）。
    const counts = { countOf: (id: number) => this.craftCount(id) };
    const ids: number[] = [];
    for (const recipe of RECIPES) {
      if (ids.includes(recipe.result.id)) continue;
      // ⚠️ "能合成"要连**当前工作台放不放得下**一起算：
      // 3×3 配方在背包的 2×2 里做不出来，不能标白（用户看到"白底却做不了"就是这条）。
      if (recipeGridSize(recipe) > this.crafting.size) continue;
      if (canCraft(counts, recipe).ok) ids.push(recipe.result.id);
    }
    this.craftableCache = { stamp, ids };
    return ids;
  }

  /** 仓库 + 当前合成格里的某件材料总数（可合成列表的判据） */
  private craftCount(itemId: number): number {
    let count = this.inventory.countOf(itemId);
    const size = this.crafting.size;
    for (let i = 0; i < size * size; i++) {
      const stack = this.crafting.get(i);
      if (stack && stack.id === itemId) count += stack.count;
    }
    return count;
  }

  /** 合成格内容的指纹（材料进出格子时也要重算"能合成什么"） */
  private craftingStamp(): string {
    const size = this.crafting.size;
    let stamp = `${size}:`;
    for (let i = 0; i < size * size; i++) {
      const stack = this.crafting.get(i);
      stamp += stack ? `${stack.id}x${stack.count},` : '-,';
    }
    return stamp;
  }

  /**
   * 分类栏里的物品：**能合成的产物**，按分类 + 搜索词筛。
   *
   * - 材料够的配方一定出现（不管仓库里有没有成品）；
   * - 之前真正做过、现在缺料的配方也留着（红底），否则"差一点材料"的东西
   *   会在用掉某件材料的一瞬间从列表里消失，玩家再也找不到它；
   * - 没有任何配方的物品（原木、矿石…）不列——它们不是"能合成的东西"。
   */
  private categoryItems(): number[] {
    const query = this.categoryQuery;
    const byCategory = (id: number): boolean => {
      if (this.categoryTab !== 'all' && recipeBookTab(id) !== this.categoryTab) return false;
      return query.length === 0 || matchesQuery(id, query);
    };
    // 批次 293：工作站左栏列"配方产物"而不是合成产物。
    // 关 = 本工作站的全部产物（含红底缺料）；开 = 所有工作站的产物（点错站台会提示需要xxx）。
    if (this.stationHasRecipes()) {
      // 批次 295（用户："按当前工作站逐条产物，不按品类，也不列别的站台"）：
      // 关 = 当前站台材料齐全的具体条目；开 = 当前站台能处理的全部条目（缺料红底）。
      const entries = this.currentStationEntries();
      const source = entries
        .filter((entry) => this.showUnowned || entry.available)
        .map((entry) => entry.resultId);
      return [...new Set(source)].filter(byCategory);
    }
    // 配方书按钮打开 = **列举该分类的全部物品**（用户明确要求保留这条）。
    // 颜色仍按"现在能不能合成"来分：白底 = 当前材料够且格子放得下，其余红底。
    if (this.showUnowned) return CREATIVE_ITEMS.filter(byCategory);
    // 关闭 = **只列现在能做的**（批次 299：不再保留"用过的缺料"红底项）
    return [...new Set(this.craftableIds())].filter(byCategory);
  }

  /**
   * 背包格子的一份廉价指纹：分类栏要不要重建就看它变了没。
   *
   * ⚠️ 这一栏最多要画 800 个 `<canvas>`（"全部物品"打开时），而 `refresh()`
   * 每次都会走到排布——不缓存就是"每搬一件东西重画八百个图标"。
   */
  private inventoryStamp(): string {
    let stamp = '';
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = this.inventory.get(i);
      stamp += stack ? `${stack.id}x${stack.count},` : '-,';
    }
    return stamp;
  }

  private renderCategoryGrid(): void {
    // ⚠️ 只有"分类 / 搜索词 / 开关 / 页码 / 背包内容"真的变了才重建：
    //    `refresh()` 每次都会走到这里，而无脑重建等于每次搬东西都重画上百个图标。
    const key = [
      this.mode,
      this.categoryTab,
      this.categoryQuery,
      this.showUnowned ? 'all' : 'owned',
      this.categoryPage,
      this.inventoryStamp(),
      this.craftingStamp(),
      // 工作站格子里的东西也会影响白红（批次 293）
      this.stationHasRecipes() ? this.stationContainerStamp() : '',
      // 用过的配方集合也会影响列表（缺料那一批红底项）
      [...this.usedRecipeIds].sort((a, b) => a - b).join(','),
    ].join('|');
    // ⚠️ 不因为"手上有东西"就整栏冻住：宁可重建完再按 id 把选中那一格找回来。
    //    冻住的话，一旦某次渲染结果是空的（比如刚合成完、背包一时为空），
    //    这一栏就会**一直空着**——那正是"合成一次就全空了"的来源。
    if (key === this.categoryStamp && this.categoryGrid.childElementCount > 0) return;
    this.categoryStamp = key;

    // 搜索框只在"全部"那一栏出现（与创造栏、配方书同一口径）
    this.categorySearch.style.display = this.categoryTab === 'all' ? '' : 'none';
    this.categorySearch.placeholder = this.stationHasRecipes()
      ? this.showUnowned
        ? `搜索${STATION_LABELS[this.stationRecipeKey()]}的全部配方…`
        : `搜索${STATION_LABELS[this.stationRecipeKey()]}现在能做的物品…`
      : '搜索可合成的物品…';
    // 底部统计：开关打开时报"这一栏共多少 / 其中现在能做多少"，
    // 关闭时报"现在能做多少 / 用过的缺料多少"。**不受搜索词影响**。
    if (this.stationHasRecipes()) {
      const inTab = (id: number): boolean => this.categoryTab === 'all' || recipeBookTab(id) === this.categoryTab;
      const entries = this.currentStationEntries();
      const available = entries.filter((entry) => entry.available && inTab(entry.resultId)).length;
      const total = entries.filter((entry) => inTab(entry.resultId)).length;
      const label = STATION_LABELS[this.stationRecipeKey()];
      this.categoryInfo.textContent = this.showUnowned
        ? `${label} · 全部 ${total} 项（白底 ${available} 项现在能做）`
        : `${label} · 现在能做 ${available} 项（点配方书看全部）`;
    } else {
      const inTab = (id: number): boolean => this.categoryTab === 'all' || recipeBookTab(id) === this.categoryTab;
      const craftable = this.craftableIds();
      const craftableInTab = craftable.filter(inTab).length;
      if (this.showUnowned) {
        const allInTab = CREATIVE_ITEMS.filter(inTab).length;
        this.categoryInfo.textContent =
          `${RECIPE_BOOK_TAB_LABELS[this.categoryTab]} · 全部 ${allInTab} 项（白底 ${craftableInTab} 项现在能做）`;
      } else {
        this.categoryInfo.textContent = `${RECIPE_BOOK_TAB_LABELS[this.categoryTab]} · 可合成 ${craftableInTab}`;
      }
    }
    const items = this.categoryItems();
    // 触摸端整表滚动、PC 底部翻页（与创造栏同一条判据）
    const scrollMode = isTouchUi();
    const pageSize = pageSizeFor(this.viewportWidth);
    const pages = pageCount(items.length, pageSize);
    this.categoryPage = scrollMode ? 0 : clampPage(this.categoryPage, items.length, pageSize);
    const visible = scrollMode ? items : slicePage(items, this.categoryPage, pageSize);
    // 有内容却"这一页是空的"：宁可保留旧内容，也不要换成一整栏空白
    if (items.length > 0 && visible.length === 0) return;

    // 先在 fragment 里搭好再一次性换上去：中途抛错时旧内容还在（不会留一栏空白）
    const fragment = document.createDocumentFragment();
    // 红底的判据是**材料齐不齐**，不是"仓库里有没有成品"：
    // 能做但还没做出来的东西是正常项（点击看配方），只有缺料的才红。
    // 工作站：白底 = 当前站台 + 原料 + 燃料都够（批次 293）。
    const craftable = this.stationHasRecipes()
      ? new Set(this.currentStationEntries().filter((entry) => entry.available).map((entry) => entry.resultId))
      : new Set(this.craftableIds());
    for (const itemId of visible) {
      const owned = this.inventory.countOf(itemId);
      const slot = this.createSlot();
      slot.classList.add('category-slot');
      // 取消选中 / 换选之后要能按 id 找回这一格（重建会把元素换掉）
      slot.dataset.itemId = String(itemId);
      if (!craftable.has(itemId)) slot.classList.add('locked');
      // 提示框（悬停 / 长按）与"点击弹说明"都靠这份数据
      this.tooltipStacks.set(slot, { id: itemId, count: owned > 0 ? owned : 1 });
      drawItemIcon(slot.querySelector('canvas')!, this.atlas, itemId, 28);
      // 批次 299（用户）：分类栏只表示"能做/不能做"，不再显示拥有数量
      slot.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.beginCategoryScrub(event, itemId, slot);
      });
      fragment.appendChild(slot);
    }

    if (items.length === 0) {
      // 批次 184（用户要求）：**配方开关关着时，空栏就留空白**。
      // 原来这里会写一段"你还没有东西 + 背包里共 N 件"的说明——那行字在手机上
      // 又长又容易让人以为"背包坏了"，用户明确说"显示空白区域就行了"。
      // 只有在"确实有筛选条件"（搜索词 / 显示全部）时，才需要解释为什么空着。
      if (this.categoryQuery.length > 0 || this.showUnowned || this.stationHasRecipes()) {
        const empty = document.createElement('div');
        empty.className = 'inv-empty';
        empty.textContent =
          this.stationHasRecipes() && !this.showUnowned && this.categoryQuery.length === 0
            ? '没有材料齐全的配方 · 点「配方书」看本工作站全部'
            : '这一栏里没有匹配的物品';
        fragment.appendChild(empty);
      }
    }

    for (const child of Array.from(this.categoryGrid.children)) this.tooltipStacks.delete(child as HTMLElement);
    this.categoryGrid.replaceChildren(fragment);
    // 重建之后把"手上那叠"的落点按 id 找回来并补上选中态（刷新尾部不会再给分类栏补）
    if (this.held) {
      const cell = this.categoryGrid.querySelector<HTMLElement>(`.category-slot[data-item-id="${this.held.id}"]`);
      if (cell) {
        this.heldOriginEl = cell;
        this.renderInto(cell, this.held);
        cell.classList.add('selected');
        this.selectedEl = cell;
      } else {
        this.heldOriginEl = null;
      }
    }

    this.categoryPageLabel.textContent = pageLabel(this.categoryPage, items.length, pageSize);
    this.categoryPrev.disabled = this.categoryPage <= 0;
    this.categoryNext.disabled = this.categoryPage >= pages - 1;
    this.categoryPager.classList.toggle('hidden', scrollMode || pages <= 1);
  }

  private flipCategoryPage(delta: number): void {
    this.categoryPage += delta;
    this.renderCategoryGrid();
  }

  /**
   * 点左栏里的一件**可合成产物**（批次 159 → 206 改语义）。
   *
   * 用户："生存模式下，不管是红底还是非红底，都不能有选中效果，但可以有点击效果；
   * 点击后右侧工作台页要显示其合成配方，材料与生成物都要在槽内。"
   *
   * 所以生存模式这里**不再把仓库里的成品拿到手上**（那是"选中"，会跟着手指走），
   * 只做两件事：记下"真正做过它"（缺料后仍留在列表里）+ 把配方画到右栏。
   * 创造模式保留原来的"拿一件复制品"（那一栏本来就是无限物品）。
   */
  private pickCategoryItem(itemId: number, mode: 'preview' | 'fill' = 'fill'): void {
    diag.event('inventory', 'category.pick', {
      itemId,
      mode,
      owned: this.inventory.countOf(itemId),
      held: this.held?.id ?? null,
      heldCount: this.held?.count ?? 0,
    });

    // 批次 293：工作站左栏点产物 = 把配方填进右栏（或提示需要哪个站台）。
    // 不能走下面"创造模式拿到手上"那条路——工作站里拿在手上没有意义。
    if (this.stationHasRecipes()) {
      this.showStationRecipeFor(itemId, mode);
      this.refresh();
      return;
    }

    if (mode === 'fill' && (this.hooks.isCreative?.() ?? false)) {
      // 创造：再点同一件 = 取消选中；否则把仓库里那叠拿到手上（复制品语义另说）
      if (this.held) {
        const same =
          this.heldOriginEl !== null &&
          this.heldOriginEl.dataset.itemId === String(itemId) &&
          this.categoryGrid.contains(this.heldOriginEl);
        this.cancelHeldSelection();
        if (same || this.held) return;
      }
      const owned = this.inventory.countOf(itemId);
      if (owned > 0) {
        const index = this.inventory.find(itemId);
        const stack = index >= 0 ? this.inventory.get(index) : null;
        if (stack) {
          this.held = stack;
          this.inventory.set(index, null);
          this.inventory.notify();
          this.touchOrigin = { source: this.inventory, index, itemId };
          this.heldFromCreative = false;
          this.heldOriginEl =
            this.categoryGrid.querySelector<HTMLElement>(`.category-slot[data-item-id="${itemId}"]`) ?? null;
        }
      }
    }

    this.showRecipeFor(itemId, mode);
    this.refresh();
  }

  /** 按下分类格：进入"按住滑动预览"，只做预览，不动物品（批次 211） */
  private beginCategoryScrub(event: PointerEvent, itemId: number, slot: HTMLElement): void {
    this.categoryScrub = {
      pointerId: event.pointerId,
      itemId,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    this.showPickToast(slot);
    this.pickCategoryItem(itemId, 'preview');
  }

  /** 按住移动：手指底下换成哪一格就预览哪一格 */
  private updateCategoryScrub(event: PointerEvent): void {
    const scrub = this.categoryScrub;
    if (!scrub || event.pointerId !== scrub.pointerId) return;
    scrub.lastX = event.clientX;
    scrub.lastY = event.clientY;
    if (!scrub.moved && Math.hypot(event.clientX - scrub.startX, event.clientY - scrub.startY) > 8) {
      scrub.moved = true;
    }
    this.previewCategoryAt(scrub.lastX, scrub.lastY);
  }

  /** 手指/列表滚动之后，取当前落点下面的分类格（滚动时也要跟着换） */
  private previewCategoryAt(x: number, y: number): void {
    const scrub = this.categoryScrub;
    if (!scrub) return;
    const element = document.elementFromPoint(x, y);
    const slot = element instanceof Element ? element.closest<HTMLElement>('.category-slot') : null;
    if (!slot) return;
    const itemId = Number(slot.dataset.itemId);
    if (!Number.isFinite(itemId) || itemId === scrub.itemId) return;
    scrub.itemId = itemId;
    this.showPickToast(slot);
    // 手指滑到哪一格，哪一格就闪一下（和单独点击的反馈一致）
    this.flashLocked(slot);
    this.pickCategoryItem(itemId, 'preview');
  }

  /** 抬手：没滑动过 = 一次正常点击（这时才真正把材料摆进格子） */
  private endCategoryScrub(cancel = false): void {
    const scrub = this.categoryScrub;
    if (!scrub) return;
    this.categoryScrub = null;
    if (!cancel && !scrub.moved) this.pickCategoryItem(scrub.itemId, 'fill');
  }

  /**
   * 把一件东西的配方摆进右栏（批次 206：材料与**生成物**都要看得见）。
   *
   *  - 材料够：真实摆进合成格（结果由 `CraftingGrid` 算，点结果就能取）；
   *  - 材料不够：材料画成预览（缺的红底），**结果槽也画出产物**（只读预览）；
   *  - 3×3 配方在 2×2 背包里摆不下：点亮"需要工作台"小图标，不硬塞；
   *  - 只能烧出来的：点亮"熔炉"小图标。
   */
  private showRecipeFor(itemId: number, mode: 'preview' | 'fill' = 'fill'): void {
    // 批次 293：工作站有自己的一套"填进操作区"逻辑，不走合成格。
    if (this.stationHasRecipes()) {
      this.showStationRecipeFor(itemId, mode);
      return;
    }
    // 批次 272（用户）：右栏停在「盔甲」时，左栏怎么点都不许把它切回合成。
    // 配方只记下来，等玩家自己点回「合成」再画——否则等于"左栏在偷偷改右栏"。
    if (this.pocketTab !== 'crafting') {
      if (!(this.hooks.isCreative?.() ?? false)) {
        this.pendingRecipeId = itemId;
        // 按住滑动时每滑过一件都提示一次会很吵：只在抬手确认那一下提示
        if (mode === 'fill') this.showMessage('右栏是盔甲，切到合成查看配方');
      }
      return;
    }
    this.pendingRecipeId = null;
    this.clearCraftGhost();
    // 批次 166：创造模式不显示配方（拥有所有方块，看配方没有意义）
    if (this.hooks.isCreative?.() ?? false) return;
    const recipe = this.bestRecipeFor(itemId);
    if (!recipe) {
      if (SMELTING_RECIPES.some((entry) => entry.output.id === itemId)) this.craftStation = 'furnace';
      return;
    }
    if (recipeGridSize(recipe) > this.crafting.size) {
      this.craftStation = 'workbench';
      return;
    }
    // 只有"抬手确认"那一下才真正把材料摆进格子；按住滑动只做预览，
    // 否则每滑过一件就动物品/重建列表，手指底下的格子会被换掉。
    if (mode === 'fill' && fillCraftingGrid(this.inventory, this.crafting, recipe)) {
      this.previewResult = null;
      return;
    }
    this.showRecipeGhost(recipe);
    // 材料不齐时结果槽也画出来（用户："工作台的槽只有材料，这是不对的"）
    this.previewResult = { id: recipe.result.id, count: recipe.result.count };
  }

  /**
   * 选一条**当前站点真能做/最接近能做**的配方（批次 209）。
   *
   * 同一件东西可能有多条配方（不同木材、不同形状）。原来直接取 `[0]`：
   * 列表把它标成白底（另一条 2×2 配方材料够），点开却显示一条 3×3 的
   * ——"白底却做不了"的观感就是这么来的。
   *
   * 优先级：放得下且材料够 → 放得下 → 随便一条（用来点亮"要工作台/要熔炉"）。
   */
  private bestRecipeFor(itemId: number): Recipe | undefined {
    const all = recipesForResult(itemId);
    const fits = all.filter((recipe) => recipeGridSize(recipe) <= this.crafting.size);
    const counts = { countOf: (id: number) => this.craftCount(id) };
    return fits.find((recipe) => canCraft(counts, recipe).ok) ?? fits[0] ?? all[0];
  }

  /**
   * 箭头上面那颗小图标（批次 185）：这件东西"要工作台"还是"要熔炉"。
   *
   * 用户的原话是"在箭头那个上方，会显示小小的一个工作台图标"——放在箭头里而不是
   * 另外占一行，是为了不把 2×2 合成区撑高（横屏高度本来就紧张）。
   */
  private syncCraftStation(): void {
    const el = this.craftStationEl;
    if (!el) return;
    const station = this.mode === 'inventory' || this.mode === 'crafting' ? this.craftStation : null;
    el.classList.toggle('hidden', !station);
    if (!station) return;
    const icon = el.firstElementChild;
    if (icon instanceof HTMLCanvasElement) {
      drawItemIcon(icon, this.atlas, station === 'workbench' ? Block.CRAFTING_TABLE : Block.FURNACE, 16);
    } else {
      el.textContent = station === 'workbench' ? '台' : '炉';
    }
    el.title = station === 'workbench' ? '需要工作台（3×3）' : '需要在熔炉里烧炼';
  }

  /** 材料不齐：把配方"画"进合成格（缺的红底），让人一眼看出差什么 */
  private showRecipeGhost(recipe: Recipe): void {
    // ⚠️ 批次 211：**不再把格子里已有的材料倒回背包**。
    // 用户要求"点材料区不要清空，保持当前状态"——预览只是一层画在格子上的
    // 只读信息，底下的实物（如果有）原样留着；要摆材料时再手动点格子。
    // 这也避免了"点一下红底、材料回到背包后那件东西突然变成能合成"的副作用。
    const size = this.crafting.size;
    const layout = recipeLayout(recipe);
    const wanted: Array<number | null> =
      layout.kind === 'shaped'
        ? [...layout.cells]
        : [...layout.items];
    const used = new Map<number, number>();
    const ghost: Array<{ id: number; have: boolean } | null> = new Array(size * size).fill(null);
    for (let i = 0; i < wanted.length && i < ghost.length; i++) {
      const id = wanted[i]!;
      if (id === null || id === undefined) continue;
      const taken = (used.get(id) ?? 0) + 1;
      used.set(id, taken);
      ghost[i] = { id, have: taken <= this.inventory.countOf(id) };
    }
    this.craftGhost = ghost;
    // 刷新由调用方统一做（它还要把结果槽的预览一起摆好）
  }

  private clearCraftGhost(): void {
    // 预览收了，"要工作台/要熔炉"的标记与结果槽预览也一起收（批次 185 / 206）
    this.craftStation = null;
    this.previewResult = null;
    if (!this.craftGhost) return;
    this.craftGhost = null;
    for (const [key, binding] of this.bindings) {
      if (key.startsWith('craft:')) binding.element.classList.remove('ghost-missing');
    }
  }

  /** 把"配方预览"画到合成格上（格子里是预览，不是实物） */
  private renderCraftGhost(): void {
    const ghost = this.craftGhost;
    if (!ghost) return;
    for (let i = 0; i < ghost.length; i++) {
      const binding = this.bindings.get(`craft:${i}`);
      if (!binding) continue;
      const cell = ghost[i] ?? null;
      const element = binding.element;
      this.renderInto(element, cell ? { id: cell.id, count: 1 } : null);
      element.classList.toggle('ghost-missing', cell !== null && !cell.have);
    }
  }

  private makeSearchTabIcon(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML =
      '<circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
      '<path d="M14.5 14.5L21 21" fill="none" stroke="currentColor" stroke-width="2.5"/>';
    return svg;
  }

  /** 携带版图标页签（批次 144）：右缘合成/盔甲，左下物品栏 */
  /** 右轨上的"动作键"（不是页签）：成就这类一按就开面板的入口 */
  private makeRailAction(label: string, svg: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inv-pocket-tab inv-rail-action';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = svg;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  private makePocketIconTab(
    tab: PocketInventoryTab,
    label: string,
    itemId: number | null,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inv-pocket-tab';
    button.dataset.tab = tab;
    button.title = label;
    button.setAttribute('aria-label', label);
    if (itemId === null) {
      // 盔甲页：基岩用玩家剪影，图集里没有对应物品
      button.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
        '<circle cx="12" cy="7" r="3.2" fill="currentColor"/>' +
        '<path d="M6.5 20c0-3.6 2.4-5.5 5.5-5.5s5.5 1.9 5.5 5.5z" fill="currentColor"/>' +
        '</svg>';
    } else {
      const icon = document.createElement('canvas');
      icon.width = 22;
      icon.height = 22;
      drawItemIcon(icon, this.atlas, itemId, 20);
      button.appendChild(icon);
    }
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (tab === 'inventory') {
        // 左下箱子只切左栏：生存时从"物品分类"回到玩家物品；
        // 创造时在"无限物品"与"个人仓库"之间切换（批次 181：只动 pane）
        this.pane = 'items';
        this.clearStationHint();
        this.hooks.onCloseRecipes?.();
        this.restoreInvTabToRail();
        this.applyInventoryChrome();
        return;
      }
      // 合成/装备只切右栏，不应顺手把左侧创造物品换成玩家背包。
      this.setPocketTab(tab);
    });
    return button;
  }

  /**
   * 携带版切右栏（批次 140 → 157 → 159）：**只换右栏**，左栏一动不动。
   *
   * 批次 159 把"切到盔甲页就关掉配方书"这条去掉了：那是右栏的按钮在改左栏，
   * 左栏当前的分类（以及格子里的选中）会被打掉。左栏是什么就是什么——
   * 想穿背包里的东西，左下那颗"我的物品"页签才是该动的那一颗。
   */
  private setPocketTab(tab: PocketInventoryTab): void {
    if (this.pocketTab === tab) return;
    diag.event('inventory', 'tab.change', { from: this.pocketTab, to: tab, mode: this.mode });
    this.pocketTab = tab;
    this.applyInventoryChrome();
    // 批次 272：切页会改预览画布的 CSS 尺寸（盔甲页更大）。这里**立刻重绘一帧**，
    // 否则画布还停在隐藏时那套后备尺寸，显示出来就是被拉扁的。
    this.refreshPlayerPreview();
    // 批次 272：刚才在盔甲页点过的配方，切回合成时补显示（只画预览，不动物品）
    if (tab === 'crafting') {
      const pending = this.pendingRecipeId;
      this.pendingRecipeId = null;
      if (pending !== null) {
        this.showRecipeFor(pending, 'preview');
        this.refresh();
      }
    }
    this.showMessage(tab === 'armor' ? '右栏：盔甲' : '右栏：合成');
  }

  /**
   * 左轨那排分类图标（批次 157）：**把配方书搬进左栏**，不是再开一个窗口。
   *
   * 以前这里是"打开配方书 → 背包被挤到半屏"，点一下整个界面跳一次。
   * 现在配方书占的就是左栏那格，栏目对齐、面板尺寸不变，
   * 只是左栏里的内容从"我的物品"换成了"配方列表"。
   */
  /**
   * 从外面（R 键）在"我的物品 ↔ 物品分类"之间切（批次 159）。
   *
   * 配方书已经不再嵌进左栏了，所以 R 键开着背包时切的是**分类栏**——
   * 否则按一下 R 会顶出一整屏配方书盖在背包上，那又是"另一个窗口"。
   */
  toggleCategoryPane(): void {
    if (this.pane === 'category') this.pane = 'items';
    else this.openPocketCategory(this.lastRecipeTab);
    this.applyInventoryChrome();
  }

  /**
   * 左轨那排分类图标（批次 157 → 159）：**左栏换成该分类下的物品**。
   *
   * 批次 159 之前这里会打开配方书；现在左栏的职责是"物品分类"——
   * 点"自然"就该看到仓库里那组泥土，配方只是"要不要把没有的也列出来"。
   */
  private openPocketCategory(tab: RecipeBookTab): void {
    diag.event('inventory', 'category.open', {
      tab,
      mode: this.mode,
      creative: this.hooks.isCreative?.() ?? false,
      pane: this.pane,
    });
    // 批次 272（用户）：这里**不再写 `pocketTab`**。
    // 左栏换分类是左栏自己的事，右栏停在「盔甲」就继续停在盔甲；
    // 工作台的右栏由 `applyInventoryChrome` 强制回合成，不靠这一行。
    this.categoryTab = tab;
    this.categoryPage = 0;
    this.lastRecipeTab = tab;
    this.pane = 'category';
    this.clearStationHint();
    // ⚠️ 换到不显示搜索框的分类时清掉搜索词：否则那是个**看不见的过滤器**，
    //    列表会一直空着，而玩家已经没有输入框可以取消它（"分类栏怎么全空了"）。
    if (tab !== 'all') {
      this.categoryQuery = '';
      this.categorySearch.value = '';
    }
    this.applyInventoryChrome();
    // 批次 185：切分类回到顶部（与创造栏同一条口径）。
    // 必须放在 applyInventoryChrome 之后——里面会 renderCategoryGrid() 重建格子。
    this.categoryGrid.scrollTop = 0;
    this.showMessage(`分类：${RECIPE_BOOK_TAB_LABELS[tab]}`);
  }

  // ---------------------------------------------------------------- 工作站可做列表（批次 277）

  /** 这个工作站有没有"配方表"可列（铁砧/砂轮/附魔台没有固定产物表，仍显示背包） */
  private stationHasRecipes(mode: InventoryPanelMode = this.mode): boolean {
    return (
      mode === 'furnace' ||
      mode === 'smoker' ||
      mode === 'blast_furnace' ||
      mode === 'campfire' ||
      mode === 'smithing' ||
      mode === 'brewing'
    );
  }

  /** 当前模式对应的纯逻辑站台名（用于"需要xxx"与目录） */
  private stationRecipeKey(): StationRecipeStation {
    switch (this.mode) {
      case 'smoker':
      case 'blast_furnace':
      case 'campfire':
      case 'smithing':
      case 'brewing':
        return this.mode;
      default:
        return 'furnace';
    }
  }

  /** 当前工作站的全部可做条目（含红底）；分类栏与点击填充共用同一份 */
  private currentStationEntries(): StationRecipeEntry[] {
    if (!this.stationHasRecipes()) return [];
    this.stationRecipeEntries = this.computeStationRecipes();
    return this.stationRecipeEntries;
  }

  /** 工作站格子内容的指纹（放进/取出一件东西后分类栏要重算白红） */
  private stationContainerStamp(): string {
    const container = this.activeContainer;
    if (!container) return '';
    const size = this.stationSlotCount(container);
    let stamp = `${this.mode}:`;
    for (let i = 0; i < size; i++) {
      const stack = container.get(i);
      stamp += stack ? `${stack.id}x${stack.count},` : '-,';
    }
    return stamp;
  }

  private setStationLeft(left: 'recipes' | 'items'): void {
    if (this.stationLeft === left) return;
    this.stationLeft = left;
    this.stationRecipeStamp = '';
    this.applyInventoryChrome();
    this.refresh();
  }

  /** 手上那叠是不是从玩家背包拿起来的（选中不影响"背包里还有"的判断） */
  private heldFromInventory(): boolean {
    return this.held !== null && this.touchOrigin?.source === this.inventory;
  }

  /** 主背包 + 快捷栏里的数量（工作站只从这里拿材料，盔甲/副手不算） */
  private bagCountOf(itemId: number): number {
    let total = 0;
    for (let i = HOTBAR_START; i < MAIN_START + MAIN_SIZE; i++) {
      const stack = this.inventory.get(i);
      if (stack && stack.id === itemId) total += stack.count;
    }
    // 从背包选中（拿在手上）仍算背包拥有：燃料备选区不能因为选中就少一种
    if (this.heldFromInventory() && this.held!.id === itemId) total += this.held!.count;
    return total;
  }

  /** 容器里某一格是否放得下（不消耗背包） */
  private canPut(container: BlockContainer, slot: number, itemId: number, count: number): boolean {
    const current = container.get(slot);
    if (!current) return true;
    return current.id === itemId && current.count + count <= maxStackOf(itemId);
  }

  /** 从主背包拿走 count 件（附加数据一起带走）；不够就不动，返回 null */
  private takeFromBag(itemId: number, count: number): ItemStack | null {
    if (this.bagCountOf(itemId) < count) return null;
    let remaining = count;
    let first: ItemStack | null = null;
    for (let i = HOTBAR_START; i < MAIN_START + MAIN_SIZE && remaining > 0; i++) {
      const stack = this.inventory.get(i);
      if (!stack || stack.id !== itemId) continue;
      const taken = this.inventory.take(i, remaining);
      if (!taken) continue;
      this.lastBagTakeIndex = i;
      remaining -= taken.count;
      if (first) first.count += taken.count;
      else first = taken;
    }
    return remaining === 0 ? first : null;
  }

  /** 放进容器某一格；放不下返回 false（调用方先 `canPut` 就不会有半途状态） */
  private putIntoContainer(
    container: BlockContainer,
    slot: number,
    itemId: number,
    count: number,
  ): boolean {
    if (!this.canPut(container, slot, itemId, count)) return false;
    const taken = this.takeFromBag(itemId, count);
    if (!taken) return false;
    // 记下来源格：换配方时优先放回玩家原来那一格（批次 300）
    const key = `${this.mode}:${slot}`;
    const current = container.get(slot);
    if (this.lastBagTakeIndex >= 0 && (!current || !this.stationOrigins.has(key))) {
      this.stationOrigins.set(key, { bagIndex: this.lastBagTakeIndex, itemId });
    }
    if (current) {
      current.count += taken.count;
      container.set(slot, current);
    } else {
      container.set(slot, taken);
    }
    return true;
  }

  /**
   * 保证某一格里有该物品（批次 277）：格子里已经有一件同种物品时**不再从背包拿**。
   *
   * 场景：原料已经放进熔炉/锻造台，玩家点白底配方只是"开始烧/确认"——
   * 这时背包里可能一件都不剩，不能因此报"放不进去"。
   */
  private ensureInSlot(
    container: BlockContainer,
    slot: number,
    itemId: number,
    count: number,
  ): boolean {
    const current = container.get(slot);
    if (current && current.id === itemId) {
      const target = Math.min(count, maxStackOf(itemId));
      if (current.count >= target) return true;
      return this.putIntoContainer(container, slot, itemId, target - current.count);
    }
    return this.putIntoContainer(container, slot, itemId, count);
  }

  /**
   * 把工作站某一格的东西放回背包（批次 300）。
   *
   * 优先放回自动填充时的来源格；来源格被占了再走 `addStack`，绝不覆盖玩家别的东西。
   */
  private returnStationStack(container: BlockContainer, slot: number): void {
    const stack = container.get(slot);
    const key = `${this.mode}:${slot}`;
    const origin = this.stationOrigins.get(key);
    this.stationOrigins.delete(key);
    if (!stack) return;
    container.set(slot, null);
    let remaining = stack.count;
    if (origin && origin.itemId === stack.id) {
      const current = this.inventory.get(origin.bagIndex);
      if (!current) {
        this.inventory.set(origin.bagIndex, { ...stack, count: remaining });
        remaining = 0;
      } else if (current.id === stack.id) {
        const room = maxStackOf(current.id) - current.count;
        const moved = Math.min(room, remaining);
        if (moved > 0) {
          current.count += moved;
          remaining -= moved;
          this.inventory.set(origin.bagIndex, current);
        }
      }
    }
    if (remaining > 0) {
      const leftover = this.inventory.addStack({ ...stack, count: remaining });
      if (leftover > 0) this.hooks.onDrop?.(stack.id, leftover);
    }
    this.inventory.notify();
  }

  /** 退还全部：熔炉里的原料、燃料、产物一次放回仓库（批次 305） */
  private returnFurnaceContents(): void {
    const furnace = this.activeContainer;
    if (!(furnace instanceof Furnace)) return;
    furnace.paused = true;
    this.returnStationStack(furnace, FURNACE_INPUT);
    this.returnStationStack(furnace, FURNACE_FUEL);
    this.returnStationStack(furnace, FURNACE_OUTPUT);
    const xp = furnace.takeExperience();
    if (xp > 0) this.hooks.onFurnaceXp?.(xp);
    furnace.burnTimeLeft = 0;
    furnace.burnTimeTotal = 0;
    furnace.cookProgress = 0;
    furnace.cookTimeTotal = 0;
    this.selectedStationKey = null;
    this.stationFilledResultId = null;
    this.furnaceStarted = false;
    this.inventory.notify();
    this.refresh();
  }

  /** 换一条配方：先把上一套材料/燃料/产物清出来，放回背包 */
  private clearStationSlotsForNewRecipe(): void {
    const container = this.activeContainer;
    if (!container) return;
    if (isFurnaceMode(this.mode) && container instanceof Furnace) {
      container.paused = true;
      this.furnaceStarted = false;
      this.returnStationStack(container, FURNACE_INPUT);
      this.returnStationStack(container, FURNACE_FUEL);
      this.returnStationStack(container, FURNACE_OUTPUT);
      const xp = container.takeExperience();
      if (xp > 0) this.hooks.onFurnaceXp?.(xp);
      // 换配方不再沿用上一轮的烧炼进度；已经烧掉的燃料时间保留
      container.cookProgress = 0;
      container.cookTimeTotal = 0;
      return;
    }
    if (this.mode === 'smithing' && container instanceof SmithingTable) {
      this.returnStationStack(container, SMITHING_EQUIPMENT);
      this.returnStationStack(container, SMITHING_MATERIAL);
      container.refresh();
      return;
    }
    if (this.mode === 'brewing' && container instanceof BrewingStand) {
      container.paused = true;
      for (const slot of BREW_BOTTLE_SLOTS) this.returnStationStack(container, slot);
      this.returnStationStack(container, BREW_INGREDIENT_SLOT);
      this.returnStationStack(container, BREW_FUEL_SLOT);
      container.brewProgress = 0;
      container.brewing = false;
      return;
    }
    if (this.mode === 'campfire' && container instanceof Campfire) {
      container.paused = true;
      for (let i = 0; i < CAMPFIRE_SIZE; i++) this.returnStationStack(container, i);
    }
  }

  /** 燃料偏好：煤/木炭优先，实在没有再考虑木板/箱子这类可燃方块 */
  private fuelRank(itemId: number): number {
    if (itemId === Item.COAL || itemId === Item.CHARCOAL) return 0;
    if (itemId === Block.DRIED_KELP_BLOCK) return 1;
    if (itemId === Block.OAK_LOG || itemId === Block.OAK_PLANKS) return 2;
    if (itemId === Item.STICK || itemId === Block.OAK_LEAVES) return 3;
    // 箱子/工作台也能烧，但优先度最低：避免"点个配方把仓库箱子烧了"
    if (itemId === Block.CHEST || itemId === Block.CRAFTING_TABLE) return 5;
    return 4;
  }

  /** 背包里所有可燃物（去重，按偏好排序）；「换燃料」按钮也用它 */
  private bagFuelOptions(): number[] {
    const ids = new Set<number>();
    for (let i = HOTBAR_START; i < MAIN_START + MAIN_SIZE; i++) {
      const id = this.inventory.get(i)?.id;
      if (id !== undefined && fuelSeconds(id) > 0) ids.add(id);
    }
    // 选中的燃料也还"存在"：不能因为拿在手上就从备选区消失
    if (this.held && fuelSeconds(this.held.id) > 0) ids.add(this.held.id);
    // 燃烧效率优先（干海带块 200s > 煤 80s > 木板 15s）；同效率再按偏好排序
    return [...ids].sort(
      (a, b) => fuelSeconds(b) - fuelSeconds(a) || this.fuelRank(a) - this.fuelRank(b) || a - b,
    );
  }

  /** 主背包里燃烧效率最高的可燃物 */
  private findBagFuel(): number | null {
    return this.bagFuelOptions()[0] ?? null;
  }

  /** 点备选区里的某种燃料：换进燃料格（尽量装满），不自动开工 */
  private selectFurnaceFuel(itemId: number): void {
    const furnace = this.activeContainer;
    if (!(furnace instanceof Furnace)) return;
    this.showFuelToast(itemId);
    const current = furnace.get(FURNACE_FUEL);
    if (current?.id === itemId) return;
    // 先确认这种燃料确实还有，避免换失败后把原来的燃料也弄丢
    const available = this.bagCountOf(itemId) + (this.held?.id === itemId ? this.held.count : 0);
    if (available < 1) return;
    if (current) this.returnStationStack(furnace, FURNACE_FUEL);
    if (!this.canPut(furnace, FURNACE_FUEL, itemId, 1)) return;
    this.fillSlotFromBag(furnace, FURNACE_FUEL, itemId);
    this.inventory.notify();
    this.refresh();
  }

  /** 燃料备选区：把背包里的可燃物直接列在燃料格下方，点一下换上 */
  private renderFurnaceFuelOptions(furnace: Furnace): void {
    const current = furnace.get(FURNACE_FUEL);
    // 固定按燃烧效率从高到低排；不把"当前燃料"挪到最前面，否则点一下顺序就变了
    const ids = [...new Set([...this.bagFuelOptions(), ...(current ? [current.id] : [])])].sort(
      (a, b) => fuelSeconds(b) - fuelSeconds(a) || this.fuelRank(a) - this.fuelRank(b) || a - b,
    );
    if (ids.length === 0 || (current !== null && ids.length <= 1)) {
      this.furnaceFuelOptionsEl.classList.add('hidden');
      this.furnaceFuelOptionsEl.replaceChildren();
      this.furnaceFuelOptionIds = [];
      return;
    }
    const counts = ids.map((id) => {
      const inBag = this.bagCountOf(id);
      const heldHere = !this.heldFromInventory() && this.held?.id === id ? this.held.count : 0;
      return inBag + heldHere + (current?.id === id ? current.count : 0);
    });
    // 顺序没变就原地更新高亮/数量，绝不重建 DOM——否则点击时看起来像图标在换位
    const sameOrder =
      ids.length === this.furnaceFuelOptionIds.length &&
      ids.every((id, index) => id === this.furnaceFuelOptionIds[index]);
    if (sameOrder && this.furnaceFuelOptionsEl.childElementCount === ids.length) {
      const buttons = Array.from(this.furnaceFuelOptionsEl.children) as HTMLElement[];
      ids.forEach((id, index) => {
        const button = buttons[index]!;
        button.classList.toggle('active', current?.id === id);
        const count = button.querySelector<HTMLElement>('.furnace-fuel-count');
        if (count) count.textContent = counts[index]! > 1 ? String(counts[index]) : '';
      });
      return;
    }
    this.furnaceFuelOptionIds = ids;
    this.furnaceFuelOptionsEl.classList.remove('hidden');
    const fragment = document.createDocumentFragment();
    ids.forEach((id, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'furnace-fuel-option';
      if (current?.id === id) button.classList.add('active');
      button.title = `${itemLabel(id)}（可烧 ${fuelSeconds(id)} 秒）`;
      const canvas = document.createElement('canvas');
      canvas.width = 22;
      canvas.height = 22;
      drawItemIcon(canvas, this.atlas, id, 20);
      // 批次 305（用户）：只放小图标，不写名字；数量可有可无
      const count = document.createElement('span');
      count.className = 'furnace-fuel-count';
      count.textContent = counts[index]! > 1 ? String(counts[index]) : '';
      button.append(canvas, count);
      button.addEventListener('click', () => this.selectFurnaceFuel(id));
      fragment.appendChild(button);
    });
    this.furnaceFuelOptionsEl.replaceChildren(fragment);
  }

  /** 燃料栏说明：当前燃料名/数量；空格子明确写"空"，不要写成"燃烧中" */
  private refreshFurnaceFuelHint(furnace: Furnace): void {
    const fuel = furnace.get(FURNACE_FUEL);
    const hasOptions = this.bagFuelOptions().length > 0;
    this.furnaceFuelTextEl.textContent = fuel
      ? `燃料：${itemName(fuel.id)} ×${fuel.count}`
      : hasOptions
        ? '燃料：空 · 请选择下方燃料'
        : '燃料：空 · 请放燃料';
    this.furnaceFuelTextEl.title = '煤 / 木炭 / 木板 / 干海带块等可燃物都能当燃料；点下方备选或手动拖入';
    this.renderFurnaceFuelOptions(furnace);
  }

  private furnaceFuelAvailable(furnace: Furnace | null): boolean {
    if (furnace && furnace.burnTimeLeft > 0) return true;
    const fuel = furnace?.get(FURNACE_FUEL);
    if (fuel && fuelSeconds(fuel.id) > 0) return true;
    return this.findBagFuel() !== null;
  }

  /**
   * 燃料格里"实际有燃料"（批次 303）：选中燃料格里的物品时，它只是拿在手上，
   * 仍然算在燃料格里；从背包选中的燃料不算（必须点下方备选放进去）。
   */
  private furnaceHasSlotFuel(furnace: Furnace): boolean {
    const fuel = furnace.get(FURNACE_FUEL);
    if (fuel && fuelSeconds(fuel.id) > 0) return true;
    return (
      this.held !== null &&
      fuelSeconds(this.held.id) > 0 &&
      this.touchOrigin?.source === furnace &&
      this.touchOrigin.index === FURNACE_FUEL
    );
  }

  private brewingFuelAvailable(stand: BrewingStand | null): boolean {
    if (stand && stand.fuelLeft > 0) return true;
    if (stand?.get(BREW_FUEL_SLOT)?.id === Item.BLAZE_POWDER) return true;
    return this.bagCountOf(Item.BLAZE_POWDER) > 0;
  }

  private stationSlotCount(container: BlockContainer | null): number {
    if (container instanceof Furnace) return 3;
    if (container instanceof Campfire) return CAMPFIRE_SIZE;
    if (container instanceof SmithingTable) return 3;
    if (container instanceof BrewingStand) return BREW_SLOT_COUNT;
    return 0;
  }

  /** 背包 + 工作站格子里某件东西的总数（原料已经放进格子时不该标"缺料"） */
  private stationCountOf(itemId: number, container: BlockContainer | null): number {
    // 手上拿着的那叠也算"拥有"：从熔炉材料格选中时不应该把配方变红（批次 302）
    // 从背包选中的已经算进 `bagCountOf`，别重复加
    let total = this.bagCountOf(itemId);
    if (!this.heldFromInventory() && this.held?.id === itemId) total += this.held.count;
    const size = this.stationSlotCount(container);
    if (container) {
      for (let i = 0; i < size; i++) {
        const stack = container.get(i);
        if (stack && stack.id === itemId) total += stack.count;
      }
    }
    return total;
  }

  /** 原料槽被别的物品占着 / 产物槽放不下 → 白底也要变红 */
  private withFurnaceSlotState(entry: StationRecipeEntry, furnace: Furnace): StationRecipeEntry {
    if (!entry.available) return entry;
    const input = entry.inputs[0]!;
    const current = furnace.get(FURNACE_INPUT);
    // 只看"是不是同一种"：格子装满 64 个仍然可以继续烧，不能因此标红
    if (current && current.id !== input.id) {
      return { ...entry, available: false, reason: 'slot_occupied' };
    }
    // 燃料槽里塞了不可燃的东西 → 白底也点不动，先标出来
    if (furnace.burnTimeLeft <= 0) {
      const fuel = furnace.get(FURNACE_FUEL);
      if (fuel && fuelSeconds(fuel.id) <= 0) {
        return { ...entry, available: false, reason: 'slot_occupied' };
      }
    }
    const output = furnace.get(FURNACE_OUTPUT);
    if (output) {
      if (output.id !== entry.resultId) return { ...entry, available: false, reason: 'slot_occupied' };
      if (output.count + entry.resultCount > maxStackOf(output.id)) {
        return { ...entry, available: false, reason: 'slot_occupied' };
      }
    }
    return entry;
  }

  private withCampfireSlotState(entry: StationRecipeEntry, fire: Campfire): StationRecipeEntry {
    if (!entry.available) return entry;
    const input = entry.inputs[0]!;
    for (let i = 0; i < CAMPFIRE_SIZE; i++) {
      const stack = fire.get(i);
      if (!stack || stack.id === input.id) return entry;
    }
    return { ...entry, available: false, reason: 'slot_occupied' };
  }

  private withSmithingSlotState(entry: StationRecipeEntry, table: SmithingTable): StationRecipeEntry {
    if (!entry.available) return entry;
    const [equipment, material] = entry.inputs;
    const currentEquipment = table.get(SMITHING_EQUIPMENT);
    if (currentEquipment && currentEquipment.id !== equipment!.id) {
      return { ...entry, available: false, reason: 'slot_occupied' };
    }
    const currentMaterial = table.get(SMITHING_MATERIAL);
    if (currentMaterial && currentMaterial.id !== material!.id) {
      return { ...entry, available: false, reason: 'slot_occupied' };
    }
    return entry;
  }

  private withBrewingSlotState(entry: StationRecipeEntry, stand: BrewingStand): StationRecipeEntry {
    if (!entry.available) return entry;
    const [bottle, ingredient] = entry.inputs;
    const currentIngredient = stand.get(BREW_INGREDIENT_SLOT);
    if (currentIngredient && currentIngredient.id !== ingredient!.id) {
      return { ...entry, available: false, reason: 'slot_occupied' };
    }
    // 燃料槽里塞了别的东西（且不是在酿的状态）→ 填不进去
    if (stand.fuelLeft <= 0) {
      const fuel = stand.get(BREW_FUEL_SLOT);
      if (fuel && fuel.id !== Item.BLAZE_POWDER) {
        return { ...entry, available: false, reason: 'slot_occupied' };
      }
    }
    // 药水不可堆叠：已经有一瓶同种药水在槽里就算"有"；
    // 否则至少要有一个空槽（已经有别的药水的那一槽放不进第二瓶）。
    if (BREW_BOTTLE_SLOTS.some((slot) => stand.get(slot)?.id === bottle!.id)) return entry;
    for (const slot of BREW_BOTTLE_SLOTS) {
      const stack = stand.get(slot);
      if (!stack || (stack.id === bottle!.id && stack.count < maxStackOf(bottle!.id))) return entry;
    }
    return { ...entry, available: false, reason: 'slot_occupied' };
  }

  /** 生成当前工作站的"可做列表"（纯逻辑在 core，界面只做容器态的后置判定） */
  private computeStationRecipes(): StationRecipeEntry[] {
    if (isFurnaceMode(this.mode)) {
      const furnace = this.activeContainer instanceof Furnace ? this.activeContainer : null;
      const station =
        furnace?.station ??
        (this.mode === 'smoker' ? 'smoker' : this.mode === 'blast_furnace' ? 'blast_furnace' : 'furnace');
      const entries = furnaceStationRecipes(
        station,
        (id) => this.stationCountOf(id, furnace),
        this.furnaceFuelAvailable(furnace),
      );
      return furnace ? entries.map((entry) => this.withFurnaceSlotState(entry, furnace)) : entries;
    }
    if (this.mode === 'campfire') {
      const fire = this.activeContainer instanceof Campfire ? this.activeContainer : null;
      const entries = furnaceStationRecipes('campfire', (id) => this.stationCountOf(id, fire), true);
      return fire ? entries.map((entry) => this.withCampfireSlotState(entry, fire)) : entries;
    }
    if (this.mode === 'smithing') {
      const table = this.activeContainer instanceof SmithingTable ? this.activeContainer : null;
      const entries = smithingStationRecipes((id) => this.stationCountOf(id, table));
      return table ? entries.map((entry) => this.withSmithingSlotState(entry, table)) : entries;
    }
    if (this.mode === 'brewing') {
      const stand = this.activeContainer instanceof BrewingStand ? this.activeContainer : null;
      let countOf = (id: number): number => this.bagCountOf(id);
      if (stand) {
        const ingredient = stand.get(BREW_INGREDIENT_SLOT);
        const fuel = stand.get(BREW_FUEL_SLOT);
        countOf = (id) =>
          this.bagCountOf(id) +
          (ingredient?.id === id ? ingredient.count : 0) +
          (fuel?.id === id ? fuel.count : 0);
      }
      const bottleIds = BREW_BOTTLE_SLOTS.map((slot) => stand?.get(slot)?.id);
      const entries = brewingStationRecipes(countOf, bottleIds, this.brewingFuelAvailable(stand));
      return stand ? entries.map((entry) => this.withBrewingSlotState(entry, stand)) : entries;
    }
    return [];
  }

  /** 点一条可做配方：把材料（和燃料）从背包填进工作站 */
  private takeStationRecipe(index: number): void {
    const entry = this.stationRecipeEntries[index];
    if (!entry) return;
    if (!entry.available) {
      const reason = entry.reason ? STATION_REASON_LABELS[entry.reason] : '现在做不了';
      this.showMessage(`${itemName(entry.resultId)}：${reason}`);
      return;
    }
    if (!this.fillStationRecipe(entry)) {
      this.showMessage('放不进去：先清一下工作站里的格子');
      return;
    }
    this.inventory.notify();
    this.refresh();
  }

  /**
   * 从背包往某一格尽量装满（上限默认 64）：点一条配方时用户要求"能放多少放多少"。
   * 返回实际放进去的数量。
   */
  private fillSlotFromBag(container: BlockContainer, slot: number, itemId: number): number {
    const current = container.get(slot);
    let room = maxStackOf(itemId) - (current?.id === itemId ? current.count : 0);
    let placed = 0;
    // 材料格里的东西被"选中"到手上了：点目标时先把它放回格子，不能因此做不了
    if (room > 0 && this.held?.id === itemId) {
      const move = Math.min(room, this.held.count);
      if (move > 0) {
        if (current && current.id === itemId) {
          current.count += move;
          container.set(slot, current);
        } else {
          container.set(slot, { ...this.held, count: move });
        }
        this.held.count -= move;
        if (this.held.count <= 0) this.held = null;
        room -= move;
        placed += move;
      }
    }
    if (room <= 0) return placed;
    const take = Math.min(room, this.bagCountOf(itemId));
    if (take <= 0) return placed;
    return this.ensureInSlot(container, slot, itemId, take) ? placed + take : placed;
  }

  private fillStationRecipe(entry: StationRecipeEntry): boolean {
    if (isFurnaceMode(this.mode)) {
      const furnace = this.activeContainer instanceof Furnace ? this.activeContainer : null;
      if (!furnace) return false;
      const input = entry.inputs[0]!;
      const currentInput = furnace.get(FURNACE_INPUT);
      if (currentInput && currentInput.id !== input.id) return false;
      // 原料已在格子里（哪怕满 64）就不要再"加 1 个"：上限判断会误报失败
      if (!currentInput) {
        if (!this.canPut(furnace, FURNACE_INPUT, input.id, 1)) return false;
        this.fillSlotFromBag(furnace, FURNACE_INPUT, input.id);
      }
      if (!furnace.get(FURNACE_INPUT)) return false;

      // 燃料：**尊重玩家已经选好的燃料**；只有空格子才从背包取最高效的
      const currentFuel = furnace.get(FURNACE_FUEL);
      if (currentFuel && fuelSeconds(currentFuel.id) > 0) {
        // 同种燃料还有空间就补满；满 64 也不报错
        this.fillSlotFromBag(furnace, FURNACE_FUEL, currentFuel.id);
      } else {
        const best = this.findBagFuel();
        if (best === null) return false;
        if (!this.canPut(furnace, FURNACE_FUEL, best, 1)) return false;
        this.fillSlotFromBag(furnace, FURNACE_FUEL, best);
      }
      return furnace.get(FURNACE_FUEL) !== null;
    }
    if (this.mode === 'campfire') {
      const fire = this.activeContainer instanceof Campfire ? this.activeContainer : null;
      if (!fire) return false;
      const input = entry.inputs[0]!;
      // 点目标框会再调一次这里；已经摆过同样的东西就不要再抓一份
      for (let i = 0; i < CAMPFIRE_SIZE; i++) {
        if (fire.get(i)?.id === input.id) return true;
      }
      for (let i = 0; i < CAMPFIRE_SIZE; i++) {
        if (this.putIntoContainer(fire, i, input.id, input.count)) return true;
      }
      return false;
    }
    if (this.mode === 'smithing') {
      const table = this.activeContainer instanceof SmithingTable ? this.activeContainer : null;
      if (!table) return false;
      const [equipment, material] = entry.inputs;
      if (!this.canPut(table, SMITHING_EQUIPMENT, equipment!.id, equipment!.count)) return false;
      if (!this.canPut(table, SMITHING_MATERIAL, material!.id, material!.count)) return false;
      if (!this.ensureInSlot(table, SMITHING_EQUIPMENT, equipment!.id, equipment!.count)) return false;
      return this.ensureInSlot(table, SMITHING_MATERIAL, material!.id, material!.count);
    }
    if (this.mode === 'brewing') {
      const stand = this.activeContainer instanceof BrewingStand ? this.activeContainer : null;
      if (!stand) return false;
      const [bottle, ingredient] = entry.inputs;
      const alreadyBottled = BREW_BOTTLE_SLOTS.some((slot) => stand.get(slot)?.id === bottle!.id);
      if (!alreadyBottled) {
        const empty = BREW_BOTTLE_SLOTS.find((slot) => !stand.get(slot));
        if (empty === undefined) return false;
        if (!this.canPut(stand, empty, bottle!.id, bottle!.count)) return false;
        if (!this.putIntoContainer(stand, empty, bottle!.id, bottle!.count)) return false;
      }
      if (!this.canPut(stand, BREW_INGREDIENT_SLOT, ingredient!.id, ingredient!.count)) return false;
      let fuelNeeded = false;
      if (stand.fuelLeft <= 0 && stand.get(BREW_FUEL_SLOT)?.id !== Item.BLAZE_POWDER) {
        if (this.bagCountOf(Item.BLAZE_POWDER) < 1) return false;
        if (!this.canPut(stand, BREW_FUEL_SLOT, Item.BLAZE_POWDER, 1)) return false;
        fuelNeeded = true;
      }
      if (!this.ensureInSlot(stand, BREW_INGREDIENT_SLOT, ingredient!.id, ingredient!.count)) return false;
      if (fuelNeeded) this.ensureInSlot(stand, BREW_FUEL_SLOT, Item.BLAZE_POWDER, 1);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 工作站提示（批次 293）

  private clearStationHint(): void {
    this.stationHintEl.classList.add('hidden');
    this.stationHintEl.replaceChildren();
  }

  /** 离开工作站/关界面：把"选配方后暂停"的容器恢复，避免炉子/酿造台被永久冻住 */
  private releaseStationPause(): void {
    if (this.activeContainer instanceof Furnace) this.activeContainer.paused = false;
    if (this.activeContainer instanceof BrewingStand) this.activeContainer.paused = false;
    if (this.activeContainer instanceof Campfire) this.activeContainer.paused = false;
  }

  /** 打开工作站先冻住：从"材料一放就自动烧"改成"点目标框才开工"（批次 299） */
  private pauseStationContainer(): void {
    if (this.activeContainer instanceof Furnace) {
      // 批次 314：炉子正在烧（还有燃烧时间/烧炼进度）时，重开界面**不能暂停**，
      // 否则会出现"关着在烧、一打开进度停住"的现象。
      const running = this.activeContainer.burnTimeLeft > 0 || this.activeContainer.cookProgress > 0;
      this.activeContainer.paused = !running;
    }
    if (this.activeContainer instanceof BrewingStand) this.activeContainer.paused = true;
    if (this.activeContainer instanceof Campfire) this.activeContainer.paused = true;
  }

  /** 写入目标条目时一并记录所属容器，切换容器后旧目标自动失效（批次 315） */
  private setStationTargetEntry(entry: StationRecipeEntry | null): void {
    this.stationTargetEntry = entry;
    this.stationTargetOwner = entry ? this.activeContainer : null;
  }

  /**
   * 手动往格子里放了东西、但还没选配方时，按现有材料反推一个目标。
   * 这样"完全改成点目标框开始"之后，手动摆料也有目标可点，不会卡住。
   */
  private syncStationTargetFromSlots(): void {
    if (this.stationTargetEntry && this.stationTargetOwner !== this.activeContainer) {
      this.setStationTargetEntry(null);
    }
    if (this.stationTargetEntry) return;
    const container = this.activeContainer;
    if (isFurnaceMode(this.mode) && container instanceof Furnace) {
      const input = container.get(FURNACE_INPUT);
      if (!input) return;
      const recipe = smeltingRecipeFor(input.id, container.station);
      if (!recipe) return;
      this.setStationTargetEntry(
        this.currentStationEntries().find((entry) => entry.resultId === recipe.output.id) ?? null,
      );
      return;
    }
    if (this.mode === 'campfire' && container instanceof Campfire) {
      for (let i = 0; i < CAMPFIRE_SIZE; i++) {
        const stack = container.get(i);
        if (!stack) continue;
        const recipe = smeltingRecipeFor(stack.id, 'campfire');
        if (!recipe) continue;
        this.setStationTargetEntry(
          this.currentStationEntries().find((entry) => entry.resultId === recipe.output.id) ?? null,
        );
        return;
      }
      return;
    }
    if (this.mode === 'brewing' && container instanceof BrewingStand) {
      const ingredient = container.get(BREW_INGREDIENT_SLOT)?.id;
      if (ingredient === undefined) return;
      const bottles = BREW_BOTTLE_SLOTS.map((slot) => container.get(slot)?.id).filter(
        (id): id is number => id !== undefined,
      );
      const recipe = BREW_RECIPES.find(
        (candidate) => candidate.ingredient === ingredient && bottles.includes(candidate.from),
      );
      if (!recipe) return;
      this.setStationTargetEntry(
        this.currentStationEntries().find((entry) => entry.resultId === recipe.to) ?? null,
      );
    }
  }

  /** 目标框支持哪些站台 */
  private stationTargetSupported(): boolean {
    return (
      isFurnaceMode(this.mode) ||
      this.mode === 'smithing' ||
      this.mode === 'brewing' ||
      this.mode === 'campfire'
    );
  }

  /**
   * 目标框上显示的"预计制作数量"（批次 303）：
   * 取原料数量、燃料还能烧的次数、产物 64 上限三者最小。
   */
  private expectedFurnaceOutput(entry: StationRecipeEntry): number {
    const furnace = this.activeContainer;
    if (!(furnace instanceof Furnace)) return entry.resultCount;
    const input = entry.inputs[0]!;
    const recipe = smeltingRecipeFor(input.id, furnace.station);
    if (!recipe) return entry.resultCount;

    let inputCount = 0;
    const inSlot = furnace.get(FURNACE_INPUT);
    if (inSlot?.id === input.id) inputCount += inSlot.count;
    inputCount += this.bagCountOf(input.id);
    if (
      this.held?.id === input.id &&
      this.touchOrigin?.source === furnace &&
      this.touchOrigin.index === FURNACE_INPUT
    ) {
      inputCount += this.held.count;
    }

    const cook = cookSeconds(recipe, furnace.station);
    let fuelTime = furnace.burnTimeLeft;
    const fuel = furnace.get(FURNACE_FUEL);
    if (fuel && fuelSeconds(fuel.id) > 0) {
      fuelTime += fuel.count * fuelSeconds(fuel.id) * FURNACE_STATIONS[furnace.station].timeScale;
    }
    if (
      this.held &&
      fuelSeconds(this.held.id) > 0 &&
      this.touchOrigin?.source === furnace &&
      this.touchOrigin.index === FURNACE_FUEL
    ) {
      fuelTime += this.held.count * fuelSeconds(this.held.id) * FURNACE_STATIONS[furnace.station].timeScale;
    }
    const batches = cook > 0 ? Math.floor(fuelTime / cook) : 0;
    return Math.max(
      0,
      Math.min(maxStackOf(entry.resultId), Math.min(inputCount, batches) * entry.resultCount),
    );
  }

  /**
   * 目标框（批次 299）：**产物槽与目标槽合并成一格**。
   *
   *  - 容器里已有成品（熔炉烧好了 / 锻造台两格齐了）→ 画成品，点一下收取/升级；
   *  - 否则画选中配方的产物预览：白底 = 点一下开工，红底 = 缺料不可点。
   */
  private renderStationTarget(): void {
    const container = this.activeContainer;
    // A/B 熔炉切换后，旧容器的目标一律作废，绝不再按 resultId 套到新容器上
    if (this.stationTargetEntry && this.stationTargetOwner !== container) {
      this.stationTargetEntry = null;
      this.stationTargetOwner = null;
    }
    // 熔炉产物改为独立产物槽；目标框只画预览/开始（批次 309）
    let actual: ItemStack | null = null;
    if (this.mode === 'smithing' && container instanceof SmithingTable) {
      actual = container.get(SMITHING_RESULT);
    }
    // 每次重画都按当前槽位/背包重算一遍可用性：材料用完后目标要变红，而不是保留旧白底
    let entry = this.stationTargetEntry;
    if (entry) {
      const fresh = this.currentStationEntries().find((candidate) => candidate.resultId === entry!.resultId);
      if (fresh) {
        this.stationTargetEntry = fresh;
        entry = fresh;
      }
    }
    // 燃料格空 = 目标红且不可点（即使背包里有燃料，也要先点左栏配方把它放进去）
    if (entry?.available && isFurnaceMode(this.mode) && container instanceof Furnace) {
      if (!this.furnaceHasSlotFuel(container)) {
        entry = { ...entry, available: false, reason: 'missing_fuel' };
        this.stationTargetEntry = entry;
      }
    }
    const show = this.stationTargetSupported() && (actual !== null || entry !== null);
    const wrap = this.stationTargetEl.parentElement;
    wrap?.classList.toggle('hidden', !show);
    this.stationTargetEl.classList.remove('preview-result', 'locked', 'ready');
    if (!show) {
      this.renderInto(this.stationTargetEl, null);
      return;
    }
    if (actual) {
      this.renderInto(this.stationTargetEl, actual);
      this.stationTargetEl.classList.add('ready');
      this.stationTargetEl.title = `点一下收取 ${itemName(actual.id)}`;
      return;
    }
    if (!entry) {
      this.renderInto(this.stationTargetEl, null);
      return;
    }
    // 炉子显示"预计能做多少个"；其他工作站仍按配方产物数量
    const expected =
      isFurnaceMode(this.mode) && container instanceof Furnace
        ? this.expectedFurnaceOutput(entry)
        : entry.resultCount;
    const previewCount = expected > 0 ? expected : entry.resultCount;
    this.renderInto(this.stationTargetEl, { id: entry.resultId, count: previewCount });
    this.stationTargetEl.classList.add('preview-result');
    this.stationTargetEl.classList.toggle('locked', !entry.available);
    this.stationTargetEl.classList.toggle('ready', entry.available);
    this.stationTargetEl.title = entry.available
      ? `点一下开始制作${expected > 0 ? `（预计 ${expected} 个）` : ''}`
      : '材料或燃料不足，不能开始';
  }

  /** 点目标框：已有成品先收取；否则白底开始、红底只提示缺什么 */
  private clickStationTarget(): void {
    const container = this.activeContainer;
    if (this.mode === 'smithing' && container instanceof SmithingTable && container.get(SMITHING_RESULT)) {
      this.takeSmithingToInventory(true);
      return;
    }
    const selected = this.stationTargetEntry;
    if (!selected) return;
    // 点之前按容器现状再算一次：材料被拿走/槽位被占时不能白点
    let entry = this.currentStationEntries().find((candidate) => candidate.resultId === selected.resultId);
    if (!entry) {
      this.setStationTargetEntry(null);
      this.renderStationTarget();
      this.showMessage('这条配方现在做不了');
      return;
    }
    // 燃料槽空 = 红底不可点（背包里有燃料也不行，要先点左栏配方把它放进去）
    if (entry.available && isFurnaceMode(this.mode) && container instanceof Furnace) {
      if (!this.furnaceHasSlotFuel(container)) {
        entry = { ...entry, available: false, reason: 'missing_fuel' };
      }
    }
    this.setStationTargetEntry(entry);
    if (!entry.available) {
      this.renderStationTarget();
      this.showStationEntryHint(entry);
      return;
    }
    // 已经在格子里的材料/燃料不要为了"补满"再动一次：
    // 目标点击只负责开工，不能把玩家选好的第三种燃料换回第一种（批次 307）
    const furnace = this.activeContainer instanceof Furnace ? this.activeContainer : null;
    const readyToStart =
      furnace !== null &&
      furnace.get(FURNACE_INPUT)?.id === entry.inputs[0]!.id &&
      this.furnaceHasSlotFuel(furnace);
    if (!readyToStart && !this.fillStationRecipe(entry)) {
      this.renderStationTarget();
      this.showMessage('原料或燃料放不进去，先清一下熔炉格子');
      return;
    }
    // 已经能开工：只把原料/当前燃料补满，绝不换掉玩家选的燃料
    if (furnace && readyToStart) {
      this.fillSlotFromBag(furnace, FURNACE_INPUT, entry.inputs[0]!.id);
      const fuel = furnace.get(FURNACE_FUEL);
      if (fuel && fuelSeconds(fuel.id) > 0) {
        this.fillSlotFromBag(furnace, FURNACE_FUEL, fuel.id);
      }
    }
    if (this.activeContainer instanceof Furnace) {
      this.activeContainer.paused = false;
      this.furnaceStarted = true;
      // 批次 312：产物默认留在产物槽，不再自动收进快捷栏/仓库
      this.stationAutoCollect = false;
      this.stationBrewSnapshot = null;
      this.clearStationHint();
      this.showMessage(`开始制作：${itemLabel(entry.resultId)}`);
      this.refresh();
      return;
    }
    if (this.activeContainer instanceof BrewingStand) {
      this.activeContainer.paused = false;
      this.stationAutoCollect = true;
      this.stationBrewSnapshot = BREW_BOTTLE_SLOTS.map((slot) => this.activeContainer?.get(slot)?.id);
      this.clearStationHint();
      this.showMessage(`开始酿造：${itemLabel(entry.resultId)}`);
      this.refresh();
      return;
    }
    if (this.activeContainer instanceof Campfire) {
      this.activeContainer.paused = false;
      this.stationAutoCollect = true;
      this.stationBrewSnapshot = null;
      this.clearStationHint();
      this.showMessage(`开始烤制：${itemLabel(entry.resultId)}`);
      this.refresh();
      return;
    }
    if (this.activeContainer instanceof SmithingTable) {
      this.takeSmithingToInventory(true);
    }
  }

  /** 点目标框收取熔炉成品：快捷栏 → 仓库 → 脚边，并结算经验 */
  private takeFurnaceOutput(refreshAfter: boolean): void {
    const furnace = this.activeContainer;
    if (!(furnace instanceof Furnace)) return;
    const output = furnace.get(FURNACE_OUTPUT);
    if (!output) return;
    furnace.set(FURNACE_OUTPUT, null);
    const leftover = this.inventory.addStack(output);
    if (leftover > 0) this.hooks.onDrop?.(output.id, leftover);
    const xp = furnace.takeExperience();
    if (xp > 0) this.hooks.onFurnaceXp?.(xp);
    // 批次 302：点过目标框后连续制作；这里不再暂停，产物出来就收走
    this.inventory.notify();
    if (refreshAfter) this.refresh();
  }

  /** 点目标框升级锻造台成品：直接进背包，不再经过光标 */
  private takeSmithingToInventory(refreshAfter: boolean): boolean {
    const table = this.activeContainer;
    if (!(table instanceof SmithingTable)) return false;
    const result = table.take();
    if (!result.ok) {
      this.smithingHintEl.textContent = result.reason;
      this.smithingHintEl.classList.add('bad');
      if (refreshAfter) this.refresh();
      return false;
    }
    const leftover = this.inventory.addStack(result.output);
    if (leftover > 0) this.hooks.onDrop?.(result.output.id, leftover);
    // 目标框保留：装备/锭用完后会按当前材料变红，而不是整条配方消失
    this.inventory.notify();
    this.showMessage(`完成：${itemName(result.output.id)}`);
    if (refreshAfter) this.refresh();
    return true;
  }

  /** 制作完成自动收货：快捷栏 → 主仓库 → 脚边（批次 295） */
  private collectStationOutput(): void {
    if (!this.stationAutoCollect) return;
    if (this.mode === 'brewing' && this.activeContainer instanceof BrewingStand) {
      const stand = this.activeContainer;
      const snapshot = this.stationBrewSnapshot;
      if (!snapshot) return;
      let changed = false;
      for (const slot of BREW_BOTTLE_SLOTS) {
        const current = stand.get(slot);
        if (!current || current.id === snapshot[slot]) continue;
        stand.set(slot, null);
        const leftover = this.inventory.addStack(current);
        if (leftover > 0) this.hooks.onDrop?.(current.id, leftover);
        snapshot[slot] = undefined;
        changed = true;
      }
      if (changed) this.inventory.notify();
      // 目标框保留：三瓶收走后按当前材料变红，不整条消失
    }
  }

  /**
   * 营火烤好一件时由主程序调用（批次 295）。
   *
   * 营火没有产物槽，成品原本会掉在柴堆上；如果这一屏正是"点了目标框"的
   * 营火，就改成快捷栏 → 仓库 → 脚边。返回 true 表示已接手，主程序不要再掉物品。
   */
  collectCampfireOutput(campfire: Campfire, output: ItemStack): boolean {
    if (!this.stationAutoCollect || this.mode !== 'campfire' || this.activeContainer !== campfire) {
      return false;
    }
    const leftover = this.inventory.addStack(output);
    if (leftover > 0) this.hooks.onDrop?.(output.id, leftover);
    this.inventory.notify();
    return true;
  }

  /**
   * 红底配方：把缺的那几件用"红底预览"画进格子里（批次 295）。
   *
   * 用户要求"缺的也放进去但是红底"——实际物品不能凭空出现，所以只画图标 + 红底；
   * 已经有实物的格子不动，避免把真实材料盖成预览。
   */
  private renderStationGhost(): void {
    const entry = this.stationTargetEntry;
    if (!entry || entry.available) return;
    const container = this.activeContainer;
    if (!container) return;
    const ghost = (key: string, itemId: number): void => {
      const binding = this.bindings.get(key);
      if (!binding || binding.source.get(binding.index)) return;
      this.renderInto(binding.element, { id: itemId, count: 1 });
      binding.element.classList.add('ghost-missing');
    };

    if (isFurnaceMode(this.mode) && container instanceof Furnace) {
      const input = entry.inputs[0]!;
      if (!container.get(FURNACE_INPUT)) ghost('furnace:input', input.id);
      const fuel = container.get(FURNACE_FUEL);
      if (!fuel) ghost('furnace:fuel', this.findBagFuel() ?? Item.COAL);
      return;
    }
    if (this.mode === 'smithing' && container instanceof SmithingTable) {
      const [equipment, material] = entry.inputs;
      if (!container.get(SMITHING_EQUIPMENT)) ghost('smithing:equipment', equipment!.id);
      if (!container.get(SMITHING_MATERIAL)) ghost('smithing:material', material!.id);
      return;
    }
    if (this.mode === 'brewing' && container instanceof BrewingStand) {
      const [bottle, ingredient] = entry.inputs;
      if (!BREW_BOTTLE_SLOTS.some((slot) => container.get(slot)?.id === bottle!.id)) {
        const empty = BREW_BOTTLE_SLOTS.find((slot) => !container.get(slot));
        if (empty !== undefined) ghost(`brewing:${empty}`, bottle!.id);
      }
      if (!container.get(BREW_INGREDIENT_SLOT)) ghost(`brewing:${BREW_INGREDIENT_SLOT}`, ingredient!.id);
      if (!this.brewingFuelAvailable(container)) ghost(`brewing:${BREW_FUEL_SLOT}`, Item.BLAZE_POWDER);
      return;
    }
    if (this.mode === 'campfire' && container instanceof Campfire) {
      const input = entry.inputs[0]!;
      if (!Array.from({ length: CAMPFIRE_SIZE }, (_, i) => container.get(i)).some((stack) => stack?.id === input.id)) {
        for (let i = 0; i < CAMPFIRE_SIZE; i++) {
          if (!container.get(i)) {
            ghost(`campfire:${i}`, input.id);
            break;
          }
        }
      }
    }
  }

  /** 红底配方：只摆现有材料，缺的留空；不启动 */
  private fillStationRecipePartial(entry: StationRecipeEntry): void {
    if (isFurnaceMode(this.mode) && this.activeContainer instanceof Furnace) {
      const furnace = this.activeContainer;
      const input = entry.inputs[0]!;
      if (this.canPut(furnace, FURNACE_INPUT, input.id, 1)) {
        this.fillSlotFromBag(furnace, FURNACE_INPUT, input.id);
      }
      const currentFuel = furnace.get(FURNACE_FUEL);
      const fuelId =
        currentFuel && fuelSeconds(currentFuel.id) > 0 ? currentFuel.id : this.findBagFuel();
      if (
        fuelId !== null &&
        (!currentFuel || currentFuel.id === fuelId) &&
        this.canPut(furnace, FURNACE_FUEL, fuelId, 1)
      ) {
        this.fillSlotFromBag(furnace, FURNACE_FUEL, fuelId);
      }
      furnace.paused = true;
      return;
    }
    if (this.mode === 'smithing' && this.activeContainer instanceof SmithingTable) {
      const table = this.activeContainer;
      const [equipment, material] = entry.inputs;
      if (this.stationCountOf(equipment!.id, table) >= equipment!.count) {
        this.ensureInSlot(table, SMITHING_EQUIPMENT, equipment!.id, equipment!.count);
      }
      if (this.stationCountOf(material!.id, table) >= material!.count) {
        this.ensureInSlot(table, SMITHING_MATERIAL, material!.id, material!.count);
      }
      return;
    }
    if (this.mode === 'brewing' && this.activeContainer instanceof BrewingStand) {
      const stand = this.activeContainer;
      const [bottle, ingredient] = entry.inputs;
      if (!BREW_BOTTLE_SLOTS.some((slot) => stand.get(slot)?.id === bottle!.id)) {
        const empty = BREW_BOTTLE_SLOTS.find((slot) => !stand.get(slot));
        if (empty !== undefined && this.bagCountOf(bottle!.id) >= bottle!.count) {
          this.ensureInSlot(stand, empty, bottle!.id, bottle!.count);
        }
      }
      if (this.stationCountOf(ingredient!.id, stand) >= ingredient!.count) {
        this.ensureInSlot(stand, BREW_INGREDIENT_SLOT, ingredient!.id, ingredient!.count);
      }
      if (!this.brewingFuelAvailable(stand)) {
        // 缺燃料就留空；有烈焰粉才补
        if (this.bagCountOf(Item.BLAZE_POWDER) >= 1) {
          this.ensureInSlot(stand, BREW_FUEL_SLOT, Item.BLAZE_POWDER, 1);
        }
      }
      stand.paused = true;
      return;
    }
    // 营火暂时没有目标框，但红底点击也要把现有材料摆进去
    if (this.mode === 'campfire' && this.activeContainer instanceof Campfire) {
      const fire = this.activeContainer;
      const input = entry.inputs[0]!;
      if (this.stationCountOf(input.id, fire) >= input.count) {
        for (let i = 0; i < CAMPFIRE_SIZE; i++) {
          if (this.putIntoContainer(fire, i, input.id, input.count)) break;
        }
      }
      fire.paused = true;
    }
  }

  /**
   * 工作区下方的说明：站台图标 + "需要xxx" + 原料/产物图标与名字。
   *
   * 用户要求："如果打开的不是对应的工作台，右侧则显示需要xxx，把图标和名字说明
   * 显示在工作区下方。" 所以标题给站台，下面一行给"原料 → 产物"，最后一行给原因。
   */
  private renderStationHint(
    _title: string,
    _station: StationRecipeStation,
    _inputs: readonly { id: number; count: number }[],
    _resultId: number,
    _resultCount: number,
    _detail: string,
  ): void {
    // 批次 302（用户）：工作区下方不再写"缺什么/需要xxx"，红底与空格已经说明问题
    this.stationHintEl.replaceChildren();
    this.stationHintEl.classList.add('hidden');
    return;
  }

  /** 当前站台缺料/缺燃料/槽位占用：把原因和原料画在下面 */
  private showStationEntryHint(entry: StationRecipeEntry): void {
    const reason = entry.reason ? STATION_REASON_LABELS[entry.reason] : '现在做不了';
    this.renderStationHint(
      reason,
      this.stationRecipeKey(),
      entry.inputs,
      entry.resultId,
      entry.resultCount,
      `${reason} · ${itemName(entry.resultId)}`,
    );
  }

  /** 当前站台做不了这件产物：告诉玩家该去哪个站台 */
  private showStationNeed(need: StationNeed): void {
    const current = STATION_LABELS[this.stationRecipeKey()];
    this.renderStationHint(
      `需要${need.label}`,
      need.station,
      need.inputs,
      need.resultId,
      1,
      `当前打开的是${current}；在${need.label}里制作 ${itemName(need.resultId)}`,
    );
  }

  /**
   * 工作站左栏点产物（批次 293）：
   *  - 当前站台有这条配方且能做 → 把原料 + 燃料填进右栏；
   *  - 有配方但缺东西 → 在工作区下方说清缺什么；
   *  - 当前站台做不了 → 显示"需要xxx"与原料/产物图标。
   */
  private showStationRecipeFor(itemId: number, mode: 'preview' | 'fill'): void {
    const entry = this.currentStationEntries().find((candidate) => candidate.resultId === itemId);
    // 换目标：先把上一套材料/燃料/产物清回背包，再摆新配方（批次 300）
    if (entry && mode === 'fill' && this.stationFilledResultId !== itemId) {
      this.clearStationSlotsForNewRecipe();
      this.stationFilledResultId = null;
    }
    if (entry) {
      // 按住滑动只把目标框切过去，不动物品；抬手确认（fill）才真正摆料
      if (mode === 'preview') {
        this.setStationTargetEntry(entry);
        this.stationAutoCollect = false;
        this.renderStationTarget();
        if (!entry.available) this.showStationEntryHint(entry);
        else this.clearStationHint();
        return;
      }
      if (entry.available) {
        this.setStationTargetEntry(entry);
        if (!this.fillStationRecipe(entry)) {
          this.renderStationTarget();
          this.showStationEntryHint(entry);
          return;
        }
        // 摆好先冻住；点目标框才恢复（熔炉/烟熏炉/高炉/酿造台）
        if (
          this.activeContainer instanceof Furnace ||
          this.activeContainer instanceof BrewingStand ||
          this.activeContainer instanceof Campfire
        ) {
          this.activeContainer.paused = true;
        }
        this.stationFilledResultId = itemId;
        this.setStationTargetEntry(entry);
        this.stationAutoCollect = false;
        this.renderStationTarget();
        this.clearStationHint();
        this.inventory.notify();
        return;
      }
      // 红底：已有材料摆进去，缺的留空；目标框红、不可点开始
      this.fillStationRecipePartial(entry);
      const after = this.currentStationEntries().find((candidate) => candidate.resultId === entry.resultId) ?? entry;
      this.stationFilledResultId = itemId;
      this.setStationTargetEntry(after);
      this.stationAutoCollect = false;
      this.renderStationTarget();
      if (after.available) this.clearStationHint();
      else this.showStationEntryHint(after);
      return;
    }

    const need = stationNeedFor(itemId, this.stationRecipeKey());
    if (need) {
      this.showStationNeed(need);
      return;
    }
    this.renderStationHint(
      '没有可用的配方',
      this.stationRecipeKey(),
      [],
      itemId,
      1,
      '这个物品不在熔炉 / 锻造台 / 酿造台的配方表里',
    );
  }

  /** 画工作站左栏的可做列表（白 = 现在能开工，红 = 缺东西/槽位占着） */
  private renderStationRecipes(): void {
    if (!this.open || !isWorkstationMode(this.mode) || !this.stationHasRecipes()) return;
    if (this.stationLeft !== 'recipes') return;
    const entries = this.computeStationRecipes();
    this.stationRecipeEntries = entries;
    const key = [
      this.mode,
      this.inventoryStamp(),
      ...entries.map((entry) => `${entry.resultId}x${entry.resultCount}:${entry.available ? 1 : 0}:${entry.reason ?? ''}`),
    ].join('|');
    if (key === this.stationRecipeStamp && this.stationRecipeGridEl.childElementCount > 0) return;
    this.stationRecipeStamp = key;

    const fragment = document.createDocumentFragment();
    entries.forEach((entry, index) => {
      const slot = this.createSlot();
      slot.classList.add('station-recipe-slot');
      slot.dataset.recipeIndex = String(index);
      if (!entry.available) slot.classList.add('locked');
      this.tooltipStacks.set(slot, { id: entry.resultId, count: entry.resultCount });
      drawItemIcon(slot.querySelector('canvas')!, this.atlas, entry.resultId, 28);
      const count = slot.querySelector('.inv-count') as HTMLSpanElement | null;
      if (count && entry.resultCount > 1) count.textContent = String(entry.resultCount);
      slot.title = entry.available
        ? `${itemName(entry.resultId)} · 点一下放入材料`
        : `${itemName(entry.resultId)}：${entry.reason ? STATION_REASON_LABELS[entry.reason] : '现在做不了'}`;
      slot.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.takeStationRecipe(index);
      });
      fragment.appendChild(slot);
    });
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '这一栏暂时没有可做的配方';
      fragment.appendChild(empty);
    }
    this.stationRecipeGridEl.replaceChildren(fragment);
    const available = entries.filter((entry) => entry.available).length;
    this.stationRecipeInfoEl.textContent =
      entries.length === 0
        ? ''
        : `${MODE_TITLES[this.mode]} · 可做 ${available} / ${entries.length}（白底 = 点一下就能开工）`;
  }

  /**
   * 统一排布（批次 157）：**只有携带版这一副壳**。
   *
   * ⚠️ 以前界面有两套（≥1280 走"经典 UI"，否则"携带版"），后果就是用户说的那句
   * "手机上明明有摇杆、右侧也有物品栏入口，点开却是 PC 的布局"。现在：
   *   - 玩家背包 / 工作台 → **双栏壳**（左栏 = 我的物品 / 创造物品 / 配方书，
   *     右栏 = 合成 / 盔甲），左右两栏的格子位置**恒定**，切的是栏目里的内容；
   *   - 箱子 / 熔炉那些容器界面 → 单栏通用面板（它们本来就没有"分页"这回事）。
   */
  private applyInventoryChrome(): void {
    // 触摸层可能比背包更晚挂 touch-mode：每次排布时把关闭键文案对齐
    if (this.closeBtn) {
      this.closeBtn.textContent = isTouchUi() || isTouchDevice() ? '✕' : '关闭 (E)';
    }
    // ⚠️ 两个口径要分开：
    //   `creativePlayer` = **玩家在创造模式**（与当前开着哪个界面无关）——"有没有配方书"
    //     这类"模式能力"要按它判，工作台界面里人也还在创造模式；
    //   `creative` = 这一屏能不能显示"创造物品栏"。
    // 批次 164：原来只按 `creative` 判，于是创造模式的工作台里配方分类又冒出来了。
    // 批次 185：`creative` 不能再要求 `mode === 'inventory'`——创造模式打开 3×3 工作台时，
    //   左轨那排分类点了之后 `leftPane` 永远退回 'items'（只看见仓库），
    //   玩家体感就是"分类没反应、搜索也没反应"。工作台同样是双栏壳，
    //   左栏放创造物品栏完全放得下。
    const creativePlayer = this.hooks.isCreative?.() ?? false;
    const creative = creativePlayer;
    // 模式变了（暂停菜单 / /gamemode）→ 工作台状态要**立刻**切到新模式：
    // 创造工作站只留仓库；生存配方工作站回分类。批次 312。
    if (creativePlayer !== this.lastCreative) {
      this.lastCreative = creativePlayer;
      if (isWorkstationMode(this.mode)) {
        this.pane = !creativePlayer && this.stationHasRecipes() ? 'category' : 'items';
      } else {
        this.pane = creativePlayer ? 'creative' : 'items';
      }
      this.categoryPage = 0;
    }
    // 批次 311（用户）：创造模式打开工作模块时，左栏只留仓库（items），
    // 不显示分类/搜索，也不挂创造分类或配方分类。
    const creativeWorkstation = creativePlayer && isWorkstationMode(this.mode);
    if (creativeWorkstation && this.pane === 'category') this.pane = 'items';
    else if (creativePlayer && this.pane === 'category') this.pane = 'creative';
    if (!creativePlayer && this.pane === 'creative') this.pane = 'items';
    const showCreativeItems = creative && this.pane === 'creative';
    // 玩家背包 / 工作台 / 有操作区的工作站共用同一副双栏壳；
    // 纯存储容器（箱子/木桶/潜影盒…）仍走单栏面板。
    const workbench = this.mode === 'crafting';
    const workstation = isWorkstationMode(this.mode);
    const dual = this.mode === 'inventory' || workbench || workstation;

    this.panel.classList.toggle('workbench-ui', workbench);
    if (this.creativeToggleBtn) {
      this.creativeToggleBtn.classList.toggle('hidden', !creative || dual);
      this.creativeToggleBtn.textContent = this.pane === 'creative' ? '生存背包' : '创造物品';
    }

    // —— 容器类界面：单栏通用面板，页签 / 左右轨 / 配方书落脚点都不参与 ——
    if (!dual) {
      this.panel.classList.remove('pocket-ui', 'pocket-dual');
      this.panel.classList.remove('creative-ui', 'station-ui');
      this.panel.dataset.pocketLeft = '';
      this.shellEl.classList.remove('pocket-chrome');
      this.pocketTabsEl.classList.add('hidden');
      this.pocketRecipeBar.classList.add('hidden');
      this.railLeft.classList.add('hidden');
      this.railRight.classList.add('hidden');
      // 容器界面没有左栏可给配方书落脚；留着它就会整屏盖上来
      this.hooks.onCloseRecipes?.();
      this.detachRecipeBook();
      this.gearEl.style.display = '';
      this.topArea.style.display = '';
      this.mainGridEl.style.display = '';
      this.hotbarGridEl.style.display = '';
      this.personalInventoryTitleEl.style.display = 'none';
      this.creativeSection.style.display = 'none';
      this.stationTabsEl.style.display = 'none';
      this.stationRecipeHostEl.style.display = 'none';
      this.panel.dataset.pocketTab = '';
      this.placeHotbar(false);
      this.syncPocketBodyClass(false);
      this.syncCraftArrow(false);
      this.restoreInvTabToRail();
      // 容器界面照旧给这颗按钮；创造模式下不要（同一口径，见下面那条注释）
      if (this.recipesBtn) this.recipesBtn.classList.toggle('hidden', creativePlayer);
      // 容器界面没有右轨 → 成就用标题栏那颗；右轨那颗跟着藏
      this.achievementsBtn?.classList.remove('hidden');
      this.railAchievementsEl?.classList.add('hidden');
      this.lastLeftPane = '';
      return;
    }

    // —— 工作站双栏壳（批次 276）——
    // 左栏固定是玩家自己的主背包（7×4），右栏是该工作站的操作区。
    // 与工作台同一副壳、同一套几何；区别只在右栏内容，以及没有左右轨页签。
    if (workstation) {
      const hasRecipes = this.stationHasRecipes();
      // 批次 293（用户）：配方驱动型工作站与工作台同一套左栏——物品分类 + 配方书按钮。
      // 点分类里的产物时，右栏要么把配方填进去，要么在下方提示"需要xxx"。
      // 创造模式工作模块：只给仓库，不给分类/搜索（批次 311）
      const showCategory = hasRecipes && !creativePlayer && this.pane === 'category';
      this.panel.classList.add('pocket-ui', 'pocket-dual', 'station-ui');
      this.panel.classList.remove('creative-ui');
      this.panel.dataset.pocketLeft = showCategory ? 'category' : 'items';
      // `station` 不是一个可点的页签：它只用来让 CSS 的 armor/crafting 规则不命中
      this.panel.dataset.pocketTab = 'station';
      this.shellEl.classList.add('pocket-chrome');
      this.pocketTabsEl.classList.add('hidden');
      this.railRight.classList.add('hidden');
      // 右轨被藏了 → 成就退到标题栏那颗
      this.achievementsBtn?.classList.remove('hidden');
      this.railAchievementsEl?.classList.add('hidden');
      this.creativeToggleBtn?.classList.add('hidden');
      this.playerBody.style.display = '';
      this.personalInventoryTitleEl.style.display = 'none';
      this.creativeSection.style.display = 'none';
      // 旧版「可做 / 背包」两页签不再承担左栏；分类栏与 7×4 背包二选一
      this.stationTabsEl.style.display = 'none';
      this.stationRecipeHostEl.style.display = 'none';
      this.categoryHostEl.style.display = showCategory ? 'flex' : 'none';
      this.mainGridEl.style.display = showCategory ? 'none' : '';
      this.hotbarGridEl.style.display = '';
      if (showCategory) this.renderCategoryGrid();
      if (hasRecipes && !creativePlayer) {
        // 从创造物品栏切回来后，railLeft 里可能还是创造分类条：
        // pocketRecipeBar 已经脱离 DOM，必须重新挂回去，否则分类按钮消失（批次 316）
        if (this.pocketRecipeBar.parentElement !== this.railLeft) {
          this.railLeft.replaceChildren(this.pocketRecipeBar, this.invTabEl);
        } else if (this.invTabEl.parentElement !== this.railLeft) {
          this.railLeft.appendChild(this.invTabEl);
        }
        this.pocketRecipeBar.classList.remove('hidden');
        this.railLeft.classList.remove('hidden');
        // 批次 320：恢复 e3503c3 之前的标题栏配方书按钮
        this.recipesBtn?.classList.remove('hidden');
        if (this.recipesBtn) {
          this.recipesBtn.classList.toggle('active', showCategory && this.showUnowned);
          this.recipesBtn.title = this.showUnowned
            ? '配方书：正在列出所有工作站的配方 · 点一下只看本工作站现在能做的'
            : '只看本工作站现在能做的 · 点一下列出所有工作站的配方';
        }
        this.syncRecipeRail(showCategory ? this.categoryTab : null);
        this.invTabEl.classList.toggle('active', !showCategory);
      } else {
        this.pocketRecipeBar.classList.add('hidden');
        this.railLeft.classList.add('hidden');
        this.recipesBtn?.classList.add('hidden');
      }
      this.gearEl.style.display = 'none';
      this.topArea.style.display = '';
      this.syncCraftArrow(false);
      this.detachRecipeBook();
      this.hooks.onCloseRecipes?.();
      this.restoreInvTabToRail();
      this.placeHotbar(true);
      this.syncPocketBodyClass(true);
      // 量一下左栏实际宽度，供标题栏配方书定位到分隔线左侧（批次 321）
      const leftEl = showCategory ? this.categoryHostEl : this.mainGridEl;
      const leftWidth = leftEl.getBoundingClientRect().width;
      if (leftWidth > 0) {
        this.panel.style.setProperty('--station-left-width', `${Math.round(leftWidth)}px`);
      }
      this.lastLeftPane = showCategory ? 'category' : 'items';
      this.lastRightCrafting = true;
      return;
    }

    // —— 双栏壳 ——
    this.panel.classList.remove('station-ui');
    this.stationTabsEl.style.display = 'none';
    this.stationRecipeHostEl.style.display = 'none';
    if (this.pocketTab === 'inventory') this.pocketTab = 'crafting';
    if (workbench) this.pocketTab = 'crafting';

    // 左栏三选一：**位置与尺寸完全一致**（同一个网格格子），换的只是内容。
    // ⚠️ 批次 159：左栏的主要职责是**物品分类**（`category`），配方书不再嵌进来
    // ——"配方"只是分类栏上"要不要把我没有的也列出来"那一颗开关。
    const leftPane: PocketLeftPane =
      showCreativeItems ? 'creative' : !creativePlayer && this.pane === 'category' ? 'category' : 'items';

    this.panel.classList.add('pocket-ui', 'pocket-dual');
    // 双栏壳：成就放右轨（合成/盔甲上面），标题栏那颗收起——标题栏只有 18px，
    // 再塞三颗键就挤成一排了。
    this.achievementsBtn?.classList.add('hidden');
    this.railAchievementsEl?.classList.remove('hidden');
    this.panel.classList.toggle('creative-ui', showCreativeItems);
    this.panel.dataset.pocketLeft = leftPane;
    this.panel.dataset.pocketTab = this.pocketTab;
    this.shellEl.classList.add('pocket-chrome');
    this.pocketTabsEl.classList.remove('hidden');
    this.playerBody.style.display = '';

    this.creativeSection.style.display = leftPane === 'creative' ? '' : 'none';
    this.categoryHostEl.style.display = leftPane === 'category' ? 'flex' : 'none';
    if (leftPane === 'category') this.renderCategoryGrid();
    // 批次 159/206：左栏是物品分类时，那片 3×9 仓库必须一起藏掉。
    // ⚠️ 以前工作台是"例外"（`leftPane === 'category' && !workbench`），但两者在
    // `pocket-dual` 网格里**占的是同一格**（col 1 / row 2）——工作台 + 分类栏时
    // 3×9 会直接盖在分类列表上，就是用户说的"多一个浮层"。
    // 想搬仓库里的东西时切到左下那颗"物品栏"页签即可（那才是 3×9 的入口）。
    const hideMainGrid = leftPane === 'creative' || leftPane === 'category';
    this.mainGridEl.style.display = hideMainGrid ? 'none' : '';
    // 左栏上方那行「物品栏」也不要（基岩版左栏没有这行字）
    this.personalInventoryTitleEl.style.display = 'none';
    this.hotbarGridEl.style.display = '';

    // 右栏：合成 / 盔甲二选一，同样占同一个格子
    const rightShowsCrafting = this.pocketTab === 'crafting';
    this.topArea.style.display = rightShowsCrafting ? '' : 'none';
    this.gearEl.style.display = rightShowsCrafting ? 'none' : '';
    this.syncCraftArrow(false);

    // 批次 159：配方书不再嵌进左栏（左栏是物品分类），它只作为整屏那一层存在
    this.detachRecipeBook();

    // 生存左轨是物品分类 + 箱子；创造左轨**始终**是创造物品分类（批次 181）
    // ⚠️ 判据是 `creativePlayer` 而不是 `leftPane === 'creative'`：
    //    切到"个人仓库"时那一排分类按钮也必须留在轨道上，否则点了当然没反应。
    this.syncCreativeRails(creativePlayer);
    if (!creativePlayer) {
      this.pocketRecipeBar.classList.toggle('hidden', !this.hooks.onOpenRecipes);
      this.railLeft.classList.remove('hidden');
      // 批次 159：点亮当前分类（点了哪一颗要看得出来）
      this.syncRecipeRail(leftPane === 'category' ? this.categoryTab : null);
    } else {
      this.syncRecipeRail(null);
      this.updateTabHighlight();
    }
    // 工作台只有"合成"这一件事，右轨那两颗（合成/盔甲）没有意义
    this.railRight.classList.toggle('hidden', workbench);
    this.restoreInvTabToRail();
    this.placeHotbar(true);
    this.syncPocketBodyClass(true);
    this.renderCreativeGrid();
    // 配方书开关：生存双栏时**留在标题栏**（与关闭键同一行，排在左栏右上角那一带），
    // 创造模式左栏是物品分类，用不上它。
    // ⚠️ active = "该分类下的所有物品都列出来（没有的红底）"；
    //    关着 = 只列自己拥有的，这就是"物品分类"本身的能力。
    if (this.recipesBtn) {
      // 批次 163：**创造模式整个不要这颗按钮**（不只是"创造物品"那一栏）。
      // 创造模式左栏是无限物品分类，配方开关在这儿没有意义；
      // 切到"生存背包"时也不该冒出来（人还在创造模式里）。
      this.recipesBtn.classList.toggle('hidden', creativePlayer);
      this.recipesBtn.classList.toggle('active', leftPane === 'category' && this.showUnowned);
      // 批次 209：开 = 配方书模式（列出该分类全部物品）；关 = 只看现在能做的
      this.recipesBtn.title = this.showUnowned
        ? '配方书：正在列出该分类的全部物品 · 点一下只看现在能合成的'
        : '只看现在能合成的（含用过的缺料）· 点一下列出该分类全部物品';
    }
    // 工作站专用的左栏配方书按钮离开工作站时必须收起（批次 316）

    // 换栏内容时给一下淡入：**位置不动**，只是让人看见"这一栏换了一份"
    if (this.open) {
      if (leftPane !== this.lastLeftPane) this.flashPane(this.leftPaneEl(leftPane));
      if (rightShowsCrafting !== this.lastRightCrafting) {
        this.flashPane(rightShowsCrafting ? this.topArea : this.gearEl);
      }
    }
    this.lastLeftPane = leftPane;
    this.lastRightCrafting = rightShowsCrafting;

    this.invTabEl.classList.toggle('active', leftPane === 'items');
    for (const button of this.root.querySelectorAll<HTMLElement>('.inv-pocket-tab')) {
      if (button.dataset.tab === 'inventory') continue;
      button.classList.toggle('active', button.dataset.tab === this.pocketTab);
    }
  }

  /** 左栏三种内容各自对应的元素（淡入要用） */
  private leftPaneEl(pane: PocketLeftPane): HTMLElement {
    if (pane === 'creative') return this.creativeSection;
    if (pane === 'category') return this.categoryHostEl;
    return this.mainGridEl;
  }

  /**
   * 换栏目内容时的短淡入（批次 157）。
   *
   * 只做 opacity 的一点变化：**不碰几何**（不 translate 布局盒），
   * 否则又变成"面板在动"。`prefers-reduced-motion` 下 CSS 会把时长压成 0。
   */
  private flashPane(element: HTMLElement): void {
    element.classList.remove('inv-pane-enter');
    // 强制重排一次：不然连续点同一个键时 animation 不会重跑
    void element.offsetWidth;
    element.classList.add('inv-pane-enter');
  }

  /**
   * 点亮左轨上当前那一颗分类（批次 159）。
   *
   * 传 `null`（左栏在"我的物品"）就把高亮全部摘掉——分类视图没开，就没有"当前分类"。
   * ⚠️ 只动 class，不换位、不重建：换高亮不该让那一排按钮动一下。
   */
  private syncRecipeRail(active: RecipeBookTab | null): void {
    for (const button of this.pocketRecipeBar.querySelectorAll<HTMLElement>('.inv-pocket-recipe-tab')) {
      button.classList.toggle('active', button.dataset.tab === active);
    }
  }

  /**
   * 把配方书还回整屏那一层（关背包 / 切到容器界面时）。
   *
   * ⚠️ 批次 165：**这里绝不能动 `categoryHostEl` 的 display**。
   * 这行是批次 157 留下的（那时这个元素还是"配方书的落脚点"，关掉时要连落脚点一起藏）。
   * 批次 159 把它改成了"物品分类"那一栏，显隐完全由 `leftPane` 决定——
   * 而 `applyInventoryChrome()` 里恰好先显示、后调这里，
   * 于是**分类栏刚显示出来就被它藏掉**：生存模式点分类永远是空的。
   */
  private detachRecipeBook(): void {
    this.hooks.onRecipeHost?.(null);
  }

  /**
   * 左轨挂哪一组分类：创造时挂创造物品分类，生存时挂配方书分类。
   *
   * ⚠️ `replaceChildren` 只换**轨道里的按钮**，不动灰框里的格子——
   * 换分类时左栏里那一格还是同一格（批次 157）。
   */
  private syncCreativeRails(onRail: boolean): void {
    if (onRail) {
      if (this.creativeTabs.parentElement !== this.railLeft) {
        this.railLeft.replaceChildren();
        this.railLeft.append(this.creativeTabs, this.invTabEl);
      } else if (this.invTabEl.parentElement !== this.railLeft) {
        this.railLeft.appendChild(this.invTabEl);
      }
      if (this.pocketSideEl.parentElement !== this.railRight) {
        this.railRight.replaceChildren(this.pocketSideEl);
      }
      this.railLeft.classList.remove('hidden');
      this.railRight.classList.remove('hidden');
      this.pocketRecipeBar.classList.add('hidden');
      return;
    }
    // 归还创造分类条
    if (this.creativeTabs.parentElement !== this.creativeControls) {
      this.creativeControls.insertBefore(this.creativeTabs, this.creativeSearch);
    }
    if (
      this.pocketRecipeBar.parentElement !== this.railLeft ||
      this.invTabEl.parentElement !== this.railLeft
    ) {
      this.railLeft.replaceChildren(this.pocketRecipeBar, this.invTabEl);
    }
    if (this.pocketSideEl.parentElement !== this.railRight) {
      this.railRight.replaceChildren(this.pocketSideEl);
    }
  }

  /** Wiki 合成页：2×2 在上、箭头朝下、产物在下 */
  private syncCraftArrow(vertical: boolean): void {
    const layout = this.topArea.querySelector('.inv-craft');
    const arrow = this.topArea.querySelector('.inv-arrow');
    layout?.classList.toggle('inv-craft-vertical', vertical);
    // ⚠️ 只改那一层字形，不能用 `arrow.textContent`——那会顺手删掉"要工作台"的小图标
    const glyph = arrow?.querySelector('.inv-arrow-glyph');
    if (glyph) glyph.textContent = vertical ? '↓' : '→';
  }

  /**
   * 箱子页签**始终留在左轨**（批次 157）。
   *
   * 以前配方书一打开就把它搬到配方书左下、顺手把左轨藏起来——那正是
   * "点左边的按钮，界面跳一下"的来源：按钮自己会跑，还会把一整条轨带走。
   */
  private restoreInvTabToRail(): void {
    if (this.invTabEl.parentElement !== this.railLeft) {
      this.railLeft.appendChild(this.invTabEl);
    }
  }

  /** 携带版：快捷栏挪到屏幕底；经典：回到面板内主列 */
  private placeHotbar(pocket: boolean): void {
    if (pocket) {
      if (this.hotbarGridEl.parentElement !== this.hotbarDock) {
        this.hotbarDock.appendChild(this.hotbarGridEl);
      }
      this.hotbarDock.classList.remove('hidden');
    } else {
      if (this.hotbarGridEl.parentElement !== this.mainColumn) {
        this.mainColumn.appendChild(this.hotbarGridEl);
      }
      this.hotbarDock.classList.add('hidden');
    }
  }

  /** 打开携带版时藏 HUD `#hotbar`，避免与 dock 叠两层 */
  private syncPocketBodyClass(pocketChrome: boolean): void {
    const on = pocketChrome && this.open;
    document.body.classList.toggle('inv-pocket-open', on);
  }

  /** @deprecated 用 applyInventoryChrome；保留别名以免漏改 */
  private applyPocketLayout(): void {
    this.applyInventoryChrome();
  }

  private updateCreativeVisibility(): void {
    this.applyInventoryChrome();
  }

  /** 翻页条上的按钮：触摸端热区要够大（与 CSS 里的 44px 下限配套） */
  private makePagerButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inv-page-button';
    button.textContent = label;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (button.disabled) return;
      onClick();
    });
    return button;
  }

  private flipCreativePage(delta: number): void {
    this.creativePage += delta;
    this.renderCreativeGrid();
    // 翻页后把网格滚回顶部：留在底部会让人以为"这一页是空的"
    this.creativeGrid.scrollTop = 0;
  }

  private updateTabHighlight(): void {
    for (const child of Array.from(this.creativeTabs.children)) {
      const element = child as HTMLElement;
      element.classList.toggle('active', element.dataset.category === this.creativeCategory);
    }
  }

  /** 按当前分类与搜索词重建创造网格；触摸端整表滚动，PC 底部翻页。 */
  private renderCreativeGrid(): void {
    // 搜索框只在「搜索」那一栏出现（与生存模式同一个口径，见 `syncCreativeSearch`）
    this.syncCreativeSearch();

    // 批次 159：**触摸端整表滚动、PC 底部翻页**——手指滑一格是本能，
    // 手机上那两颗"上一页/下一页"既难点也反直觉；PC 才用翻页条。
    // （原来是按"是不是携带版布局"判的，统一成携带版之后 PC 也误伤成了滚动。）
    const scrollMode = isTouchUi();
    // ⚠️ 这一栏有 **800 多个格子**，而 `refresh()` 每次都会走到这里（搬一次东西一次）。
    //    原来是无脑重建：每次都要先 `replaceChildren()` 再画 800 个 canvas，
    //    手机上那几十毫秒里**整栏是空的**——连点几下就是"分类栏怎么全空了"。
    //    内容只跟"分类 / 搜索词 / 页码"有关（创造格不显示数量），所以按它们缓存。
    const key = [
      this.creativeCategory,
      this.creativeQuery,
      scrollMode ? 0 : this.creativePage,
      scrollMode ? 'scroll' : pageSizeFor(this.viewportWidth),
    ].join('|');
    // ⚠️ 缓存之外再加一条"自愈"：万一这一栏被别处清空过（DOM 空了但指纹没变），
    //    也必须重画——否则就是"一次意外之后永远空白"。
    if (key === this.creativeStamp && this.creativeGrid.childElementCount > 0) return;
    this.creativeStamp = key;

    const query = this.creativeQuery;
    const items = CREATIVE_ITEMS.filter((itemId) => {
      if (this.creativeCategory !== 'all' && creativeTabFor(itemId) !== this.creativeCategory) return false;
      // 中文名与英文 id 都能搜：写"石头"或写 stone 都能找到（原来只认英文 id）
      if (query.length > 0 && !matchesQuery(itemId, query)) return false;
      return true;
    });

    const pageSize = pageSizeFor(this.viewportWidth);
    // 夹一次页码：换分类、改搜索词、转屏之后原来的页码都可能越界
    this.creativePage = scrollMode ? 0 : clampPage(this.creativePage, items.length, pageSize);
    const visible = scrollMode ? items : slicePage(items, this.creativePage, pageSize);
    // 有内容却"这一页是空的"：宁可保留旧内容，也不要换成一整栏空白
    if (items.length > 0 && visible.length === 0) return;

    // 批次 159：先在 fragment 里搭好再一次性换上去——
    // 中途抛错时旧内容还在，不会留下一栏空白。
    const fragment = document.createDocumentFragment();
    // "选中的那一格"重建后会跟着被丢掉：记下手上的 id，重建后按 id 搬回去。
    const restoreId = this.held ? this.held.id : null;

    for (const itemId of visible) {
      const slot = this.createSlot();
      slot.classList.add('creative-slot');
      slot.dataset.itemId = String(itemId);
      this.tooltipStacks.set(slot, { id: itemId, count: 1 });
      drawItemIcon(slot.querySelector('canvas')!, this.atlas, itemId, 28);
      slot.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        // 批次 159：**再点同一格 = 取消选中**（创造取的是复制品，取消就是清掉它）
        if (this.held && this.heldOriginEl === slot) {
          this.cancelHeldSelection();
          return;
        }
        // 创造选取 = **先拿到光标**（批次 142，对齐基岩/Java 创造）：
        // 左键/中键满组、右键 1 个（同类可累加到堆叠上限）。不再直接 inventory.add。
        const max = maxStackOf(itemId);
        if (event.button === 2) {
          if (this.held?.id === itemId) {
            this.held = { ...this.held, count: Math.min(max, this.held.count + 1) };
          } else {
            this.held = { id: itemId, count: 1 };
          }
        } else {
          this.held = { id: itemId, count: max };
        }
        // 批次 159：创造格同样"就地选中"——点中的那一格变深，手上那叠就显示在那儿
        this.heldOriginEl = slot;
        // 这是**复制品**（没有来源格）：放到已有物品的格子上时直接覆盖、旧的销毁
        this.heldFromCreative = true;
        // 创造模式下点一件东西也要看到"它由什么组成"（右栏在合成时）
        this.showRecipeFor(itemId);
        this.hooks.onMove?.();
        this.refresh();
      });
      fragment.appendChild(slot);
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = '没有匹配的物品';
      fragment.appendChild(empty);
    }

    // 换掉整批格子时把它们在 `tooltipStacks` 里的条目一起删掉：
    // 不删的话每重建一次就多留 800 条指向旧元素的记录（只增不减）。
    for (const child of Array.from(this.creativeGrid.children)) this.tooltipStacks.delete(child as HTMLElement);
    this.creativeGrid.replaceChildren(fragment);

    // 把"手上那叠"的落点搬回重建后的新格子，并把选中态补上
    // （`refresh()` 里那一步在上面的重建之前就做完了）
    if (restoreId !== null) {
      const cell = this.creativeGrid.querySelector<HTMLElement>(`.creative-slot[data-item-id="${restoreId}"]`);
      if (cell && this.held) {
        this.heldOriginEl = cell;
        this.renderInto(cell, this.held);
        cell.classList.add('selected');
        this.selectedEl = cell;
      } else {
        this.heldOriginEl = null;
      }
    }

    const pages = pageCount(items.length, pageSize);
    this.creativeCountEl.textContent = `  ${items.length} / ${CREATIVE_ITEMS.length}`;
    this.creativePageLabel.textContent = pageLabel(this.creativePage, items.length, pageSize);
    this.creativePrev.disabled = this.creativePage <= 0;
    this.creativeNext.disabled = this.creativePage >= pages - 1;
    // 触摸端整表滚动不需要翻页条；PC 只有一页时也隐藏（翻不动的按钮没有意义）
    this.creativePager.classList.toggle('hidden', scrollMode || pages <= 1);
  }

  /** 当前视口宽度（窄屏判定用；不在浏览器里时按宽屏处理） */
  private get viewportWidth(): number {
    if (typeof window === 'undefined') return Number.POSITIVE_INFINITY;
    return window.innerWidth;
  }

  /** 清掉某一前缀的旧绑定 */
  private clearBindings(prefix: string): void {
    for (const key of [...this.bindings.keys()]) {
      if (key.startsWith(prefix)) this.bindings.delete(key);
    }
  }

  /** 重建上半部分 */
  private rebuildTopArea(): void {
    this.topArea.replaceChildren();
    this.clearStationHint();
    this.clearBindings('craft:');
    this.clearBindings('furnace:');
    this.clearBindings('chest:');
    this.clearBindings('barrel:');
    this.clearBindings('ender_chest:');
    this.clearBindings('shulker_box:');
    this.clearBindings('enchant:');
    this.clearBindings('anvil:');
    this.clearBindings('grindstone:');
    this.clearBindings('smithing:');
    this.clearBindings('stonecutter:');
    this.clearBindings('campfire:');
    this.clearBindings('brewing:');
    this.clearBindings('hopper:');
    this.clearBindings('dropper:');
    this.clearBindings('dispenser:');

    // 熔炉 / 烟熏炉 / 高炉（批次 46）共用同一套布局：格子与燃料规则完全一样，
    // 区别只有"只吃哪一类东西"和"快一倍"——那两条由容器负责，界面只是标题与提示不同
    if (isFurnaceMode(this.mode)) {
      const input = this.registerExisting(this.furnaceInputSlot, 'furnace:input', this.activeContainer!, FURNACE_INPUT);
      const fuel = this.registerExisting(this.furnaceFuelSlot, 'furnace:fuel', this.activeContainer!, FURNACE_FUEL);
      const product = this.registerExisting(
        this.furnaceProductSlot,
        'furnace:product',
        this.activeContainer!,
        FURNACE_OUTPUT,
        true,
      );

      const fuelHint = document.createElement('div');
      fuelHint.className = 'furnace-fuel-hint';
      const optionsLabel = document.createElement('div');
      optionsLabel.className = 'furnace-options-label';
      optionsLabel.textContent = '备选燃料';
      fuelHint.append(optionsLabel, this.furnaceFuelOptionsEl);

      // 批次 312（用户）：材料/燃料槽左侧加文字说明
      const inputWrap = document.createElement('div');
      inputWrap.className = 'furnace-slot-with-label';
      const inputLabel = document.createElement('span');
      inputLabel.className = 'furnace-slot-side-label';
      inputLabel.textContent = '材料';
      inputWrap.append(inputLabel, input);

      const fuelWrap = document.createElement('div');
      fuelWrap.className = 'furnace-slot-with-label';
      const fuelLabel = document.createElement('span');
      fuelLabel.className = 'furnace-slot-side-label';
      fuelLabel.textContent = '燃料';
      fuelWrap.append(fuelLabel, fuel);

      // 批次 309（用户）：进度箭头垂直居中于原料/燃料，左边缘贴原料槽右边缘；
      // 右边是「目标」槽与「产物」槽，两个文字都在槽上方。
      const core = document.createElement('div');
      core.className = 'furnace-core';
      core.append(inputWrap, this.flameEl, fuelWrap);

      const progress = document.createElement('div');
      progress.className = 'furnace-progress';
      progress.append(this.cookTrackElement());

      const targetLabel = document.createElement('div');
      targetLabel.className = 'furnace-slot-label';
      targetLabel.textContent = '目标';
      const targetCol = document.createElement('div');
      targetCol.className = 'furnace-slot-col';
      targetCol.append(targetLabel, this.stationTargetEl);

      const productLabel = document.createElement('div');
      productLabel.className = 'furnace-slot-label';
      productLabel.textContent = '产物';
      const productCol = document.createElement('div');
      productCol.className = 'furnace-slot-col';
      productCol.append(productLabel, product);

      const slotRow = document.createElement('div');
      slotRow.className = 'furnace-slot-row';
      // 退还仓库绝对定位在目标/产物下方，不占布局行（批次 316）
      slotRow.append(targetCol, productCol, this.furnaceReturnBtn);

      const stage = document.createElement('div');
      stage.className = 'furnace-stage';
      stage.append(core, progress, slotRow);

      // 烟熏炉/高炉要写清"它只吃什么"：原版靠玩家自己知道，我们的界面里直接说明，
      // 免得玩家把石头塞进烟熏炉、看着它不动以为是坏了
      this.furnaceHintEl.textContent = '';
      const bottom = document.createElement('div');
      bottom.className = 'furnace-bottom';
      bottom.append(fuelHint, this.furnaceHintEl);

      this.furnaceLayout.replaceChildren(stage, bottom);
      this.topArea.append(this.furnaceLayout, this.stationHintEl);
      return;
    }

    if (this.mode === 'campfire') {
      const campfire = this.activeContainer instanceof Campfire ? this.activeContainer : null;
      for (let i = 0; i < CAMPFIRE_SIZE; i++) {
        this.registerExisting(this.campfireSlots[i]!, `campfire:${i}`, campfire!, i);
      }
      this.campfireHintEl.textContent = '';
      const side = document.createElement('div');
      side.className = 'campfire-side';
      const targetWrap = document.createElement('div');
      targetWrap.className = 'furnace-col';
      targetWrap.append(this.buildLabel('目标'), this.stationTargetEl);
      side.append(this.buildLabel('放上最多 4 样食物（烤好会自己弹出来）'), this.campfireHintEl, targetWrap);
      // 复用"左一块右一列"那条布局（与切石机同一套样式，窄屏会自动上下堆叠）
      const layout = document.createElement('div');
      layout.className = 'stonecutter-layout';
      layout.append(this.campfireLayout, side);
      this.topArea.append(layout, this.stationHintEl);
      return;
    }

    if (this.mode === 'brewing') {
      const stand = this.activeContainer instanceof BrewingStand ? this.activeContainer : null;
      for (const slot of BREW_BOTTLE_SLOTS) {
        this.registerExisting(this.brewBottleSlots[slot]!, `brewing:${slot}`, stand!, slot);
      }
      this.registerExisting(this.brewIngredientSlot, `brewing:${BREW_INGREDIENT_SLOT}`, stand!, BREW_INGREDIENT_SLOT);
      this.registerExisting(this.brewFuelSlot, `brewing:${BREW_FUEL_SLOT}`, stand!, BREW_FUEL_SLOT);

      const bottles = document.createElement('div');
      bottles.className = 'brewing-bottles';
      bottles.append(...this.brewBottleSlots);
      const bottleCol = document.createElement('div');
      bottleCol.className = 'brewing-col';
      bottleCol.append(this.buildLabel('药水（最多 3 瓶同时酿）'), bottles);

      const materialCol = document.createElement('div');
      materialCol.className = 'brewing-col';
      materialCol.append(this.buildLabel('材料'), this.brewIngredientSlot);

      const fuelCol = document.createElement('div');
      fuelCol.className = 'brewing-col';
      fuelCol.append(this.buildLabel('燃料'), this.brewFuelSlot);

      const targetCol = document.createElement('div');
      targetCol.className = 'brewing-col';
      targetCol.append(this.buildLabel('目标'), this.stationTargetEl);

      const middle = document.createElement('div');
      middle.className = 'brewing-middle';
      const track = document.createElement('div');
      track.className = 'furnace-cook';
      track.appendChild(this.brewProgressEl);
      middle.append(track, this.brewFuelTextEl);

      this.brewingLayout.replaceChildren(bottleCol, middle, materialCol, fuelCol, targetCol);
      this.topArea.append(this.brewingLayout, this.stationHintEl);
      return;
    }

    if (this.mode === 'anvil') {
      const anvil = this.activeContainer instanceof Anvil ? this.activeContainer : null;
      const left = this.registerExisting(this.anvilLeftSlot, 'anvil:left', anvil!, ANVIL_LEFT);
      const right = this.registerExisting(this.anvilRightSlot, 'anvil:right', anvil!, ANVIL_RIGHT);
      const result = this.registerExisting(this.anvilResultSlot, 'anvil:result', anvil!, ANVIL_RESULT, true);
      // 名字输入框跟着容器状态走：切换模式会重建上半区，不重新同步会把玩家输的字丢掉
      this.anvilNameInput.value = anvil?.name ?? '';
      this.anvilStatusEl.textContent = '';

      const row = document.createElement('div');
      row.className = 'anvil-row';
      row.append(this.buildLabel('物品'), left, this.buildLabel('材料 / 附魔书'), right, this.buildLabel('产物'), result);
      const side = document.createElement('div');
      side.className = 'anvil-side';
      side.append(this.buildLabel('重命名'), this.anvilNameInput, this.anvilCostEl, this.anvilStatusEl);
      this.anvilLayout.replaceChildren(row, side);
      this.topArea.appendChild(this.anvilLayout);
      return;
    }

    if (this.mode === 'grindstone') {
      const grindstone = this.activeContainer instanceof Grindstone ? this.activeContainer : null;
      const left = this.registerExisting(this.grindstoneLeftSlot, 'grindstone:left', grindstone!, GRINDSTONE_LEFT);
      const right = this.registerExisting(
        this.grindstoneRightSlot,
        'grindstone:right',
        grindstone!,
        GRINDSTONE_RIGHT,
      );
      // 产物槽只能取不能放（与铁砧一样，产物是两格算出来的）
      const result = this.registerExisting(
        this.grindstoneResultSlot,
        'grindstone:result',
        grindstone!,
        GRINDSTONE_RESULT,
        true,
      );
      this.grindstoneStatusEl.textContent = '';

      const row = document.createElement('div');
      row.className = 'anvil-row';
      row.append(
        this.buildLabel('要洗的物品'),
        left,
        this.buildLabel('同种装备（可选）'),
        right,
        this.buildLabel('产物'),
        result,
      );
      const side = document.createElement('div');
      side.className = 'anvil-side';
      side.append(this.grindstoneHintEl, this.grindstoneStatusEl);
      this.grindstoneLayout.replaceChildren(row, side);
      this.topArea.appendChild(this.grindstoneLayout);
      return;
    }

    if (this.mode === 'smithing') {
      const table = this.activeContainer instanceof SmithingTable ? this.activeContainer : null;
      const equipment = this.registerExisting(this.smithingEquipmentSlot, 'smithing:equipment', table!, SMITHING_EQUIPMENT);
      const material = this.registerExisting(this.smithingMaterialSlot, 'smithing:material', table!, SMITHING_MATERIAL);
      this.smithingHintEl.textContent = '';

      const row = document.createElement('div');
      row.className = 'anvil-row';
      // 批次 299：产物槽与目标槽合并（预览与"点一下升级"都在这一格）
      const targetWrap = document.createElement('div');
      targetWrap.className = 'furnace-col';
      targetWrap.append(this.buildLabel('产物 / 目标'), this.stationTargetEl);
      row.append(
        this.buildLabel('钻石装备'),
        equipment,
        this.buildLabel('下界合金锭'),
        material,
        targetWrap,
      );
      const side = document.createElement('div');
      side.className = 'anvil-side';
      side.append(this.smithingHintEl);
      this.smithingLayout.replaceChildren(row, side);
      this.topArea.append(this.smithingLayout, this.stationHintEl);
      return;
    }

    if (this.mode === 'stonecutter') {
      const cutter = this.activeContainer instanceof Stonecutter ? this.activeContainer : null;
      const input = this.registerExisting(
        this.stonecutterInputSlot,
        `stonecutter:${STONECUTTER_INPUT}`,
        cutter!,
        STONECUTTER_INPUT,
      );
      this.stonecutterHintEl.textContent = '';

      const left = document.createElement('div');
      left.className = 'stonecutter-col';
      left.append(this.buildLabel('要切的石料'), input, this.stonecutterHintEl);

      // 右侧那一列按钮由 `refreshStonecutter` 填：产物清单随输入格变化，
      // 所以不能在重建上半区时一次性写死
      this.stonecutterListEl.replaceChildren();
      const right = document.createElement('div');
      right.className = 'stonecutter-right';
      right.append(this.buildLabel('能切出什么（点一下切一件）'), this.stonecutterListEl);

      this.stonecutterLayout.replaceChildren(left, right);
      this.topArea.appendChild(this.stonecutterLayout);
      return;
    }

    if (this.mode === 'trade') {
      // 左侧：他本人的信息（职业 / 等级 / 还差多少经验）+ 一句操作方法
      this.tradeInfoEl.replaceChildren();
      this.tradeInfoEl.append(this.buildLabel('村民'), this.tradeLevelEl, this.tradeHintEl);
      this.tradeHintEl.textContent = '点一条交易直接从背包结算（材料要带在身上）';
      this.tradeHintEl.classList.remove('bad');

      // 右侧：一列交易。按钮由 `refreshTrade` 填——
      // 它们随职业与等级变化，而且**只在指纹变了时重建**
      this.tradeListEl.replaceChildren();
      this.tradeRows.length = 0;
      this.tradeFingerprint = '';
      const right = document.createElement('div');
      right.className = 'stonecutter-right';
      right.append(this.buildLabel('他能做什么（点一下成交）'), this.tradeListEl);

      this.tradeLayout.replaceChildren(this.tradeInfoEl, right);
      this.topArea.appendChild(this.tradeLayout);
      return;
    }

    if (this.mode === 'enchanting') {
      const table = this.activeContainer instanceof EnchantTable ? this.activeContainer : null;
      const item = this.registerExisting(this.enchantItemSlot, 'enchant:item', table!, ENCHANT_ITEM_SLOT);
      const lapis = this.registerExisting(this.enchantLapisSlot, 'enchant:lapis', table!, ENCHANT_LAPIS_SLOT);

      const left = document.createElement('div');
      left.className = 'enchant-col';
      left.append(this.buildLabel('物品'), item, this.buildLabel('青金石'), lapis);

      const right = document.createElement('div');
      right.className = 'enchant-options';
      this.enchantButtons.length = 0;
      for (let slot = 0; slot < 3; slot++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'enchant-option';
        button.dataset.slot = String(slot);
        button.addEventListener('click', () => this.handleEnchantClick(slot));
        this.enchantButtons.push(button);
        right.appendChild(button);
      }
      const hint = document.createElement('div');
      hint.className = 'enchant-hint';
      hint.textContent = UI_HINT_UNIMPLEMENTED;
      right.append(this.enchantStatusEl, hint);

      this.enchantLayout.replaceChildren(left, right);
      this.topArea.appendChild(this.enchantLayout);
      return;
    }

    if (this.mode === 'hopper') {
      this.hopperGrid.replaceChildren();
      for (let i = 0; i < HOPPER_SIZE; i++) {
        this.hopperGrid.appendChild(this.registerSlot(`hopper:${i}`, this.activeContainer!, i));
      }
      this.hopperHintEl.textContent = '';
      this.topArea.appendChild(this.buildLabel('漏斗（5 格）'));
      this.topArea.appendChild(this.hopperGrid);
      this.topArea.appendChild(this.hopperHintEl);
      return;
    }

    if (this.mode === 'dropper' || this.mode === 'dispenser') {
      const isDispenser = this.mode === 'dispenser';
      this.nineGrid.replaceChildren();
      for (let i = 0; i < DROPPER_SIZE; i++) {
        this.nineGrid.appendChild(this.registerSlot(`${this.mode}:${i}`, this.activeContainer!, i));
      }
      this.nineHintEl.textContent = '';
      this.topArea.appendChild(this.buildLabel(isDispenser ? '发射器（9 格）' : '投掷器（9 格）'));
      this.topArea.appendChild(this.nineGrid);
      this.topArea.appendChild(this.nineHintEl);
      return;
    }

    if (
      this.mode === 'chest' ||
      this.mode === 'barrel' ||
      this.mode === 'ender_chest' ||
      this.mode === 'shulker_box'
    ) {
      // 箱子 / 木桶 / 末影箱共用这一套 27 格（3×9），只有标题与提示不同
      this.chestGrid.replaceChildren();
      for (let i = 0; i < CHEST_SIZE; i++) {
        this.chestGrid.appendChild(this.registerSlot(`${this.mode}:${i}`, this.activeContainer!, i));
      }
      const title =
        this.mode === 'barrel'
          ? '木桶'
          : this.mode === 'ender_chest'
            ? '末影箱'
            : this.mode === 'shulker_box'
              ? '潜影盒'
              : '箱子';
      this.topArea.appendChild(this.buildLabel(title));
      this.topArea.appendChild(this.chestGrid);
      return;
    }

    // ---- 合成模式（物品栏 2×2 / 工作台 3×3）
    const grid = this.crafting;
    const material = document.createElement('div');
    material.className = `inv-grid inv-craft-grid size-${grid.size}`;
    for (let i = 0; i < grid.size * grid.size; i++) {
      material.appendChild(this.registerSlot(`craft:${i}`, grid, i));
    }

    const arrow = document.createElement('div');
    arrow.className = 'inv-arrow';
    // ⚠️ 箭头字符单独包一层：`syncCraftArrow` 每次排布都会改它的方向（→ / ↓），
    // 直接写 `arrow.textContent` 会把下面的小图标一起抹掉（批次 185 踩过）。
    const glyph = document.createElement('span');
    glyph.className = 'inv-arrow-glyph';
    glyph.textContent = '→';
    arrow.appendChild(glyph);
    // 箭头上面那颗"要工作台 / 要熔炉"的小图标（批次 185）。始终建、默认隐藏：
    // 只在"点了一件摆不下或烧出来的东西"时露出来，切换预览时由 `syncCraftStation` 收放。
    const station = document.createElement('div');
    station.className = 'inv-craft-station hidden';
    station.dataset.role = 'craft-station';
    const stationIcon = document.createElement('canvas');
    stationIcon.width = 16;
    stationIcon.height = 16;
    station.appendChild(stationIcon);
    arrow.appendChild(station);
    this.craftStationEl = station;

    const layout = document.createElement('div');
    layout.className = 'inv-craft';
    layout.append(material, arrow, this.resultElement);
    // 原版（截图纸质界面也一样）在合成区上方写着"合成"——它是**分组标题**。
    // ⚠️ 只补这一个：装备那一列、主背包与快捷栏在原版里都没有标题
    //（批次 132 刚把「主背包 / 快捷栏 / 盔甲与副手」三行字去掉，别又加回来）。
    this.topArea.appendChild(this.buildLabel('合成'));
    this.topArea.appendChild(layout);
  }

  private cachedCookTrack: HTMLDivElement | null = null;

  private cookTrackElement(): HTMLDivElement {
    if (this.cachedCookTrack) return this.cachedCookTrack;
    const track = document.createElement('div');
    track.className = 'furnace-cook';
    track.appendChild(this.cookFillEl);
    this.cachedCookTrack = track;
    return track;
  }

  /**
   * 槽位元素只在创建时挂一次监听，点击时从 dataset.key 反查绑定。
   * 这样重建上半部分（切模式/换容器）时直接复用元素即可，不会重复绑定监听器。
   */
  private createSlot(): HTMLDivElement {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    // 提示框靠这个属性认出"指针下面是可悬停的东西"（见 Tooltip.delegate）
    slot.dataset.tooltip = '';
    const canvas = document.createElement('canvas');
    canvas.width = 36;
    canvas.height = 36;
    const count = document.createElement('span');
    count.className = 'inv-count';
    // 耐久条（批次 28）：与快捷栏同一处实现，满耐久/无耐久时自己隐藏
    const durability = document.createElement('i');
    durability.className = 'dur-bar hidden';
    durability.appendChild(document.createElement('b'));
    // 长按选数量的指示条（批次 137）：绿色占比 = 选中数 / 这一格总数。
    // 默认 hidden，只有这一格正在被"选数量"时才露出来（`showSplitBar`）。
    const splitBar = document.createElement('i');
    splitBar.className = 'inv-split-bar hidden';
    const splitFill = document.createElement('b');
    splitBar.appendChild(splitFill);
    const splitLabel = document.createElement('span');
    splitLabel.className = 'inv-split-count hidden';
    slot.append(canvas, count, durability, splitBar, splitLabel);

    slot.addEventListener('pointerdown', (event) => {
      const key = slot.dataset.key;
      if (!key) return;
      event.preventDefault();

      // 鼠标：左键 / 右键语义保持不变
      if (event.pointerType === 'mouse') {
        // **拖拽分配**（批次 128，对齐原版）：按下先记起点，经过的槽位由 `mouseenter`
        // 收集，松手时统一结算。普通点击（没经过别的槽）什么都不多做
        if (event.button === 0 || event.button === 2) {
          const binding = this.bindings.get(key);
          if (binding) {
            this.dragButton = event.button === 0 ? 0 : 2;
            this.dragSlots = [{ source: binding.source, index: binding.index }];
          }
        }
        // Shift+左键 = 快速移动（批次 127）；触摸端没有 Shift，走下面的长按那套
        this.activateSlot(key, event.button, event.shiftKey);
        return;
      }

      // 触摸：短按 = 左键；长按 = 选数量（有物品且手空）或右键 + 连发，见 `beginTouchPress`
      this.beginTouchPress(slot, key, event.pointerId, event.clientX);
    });
    return slot;
  }

  private registerSlot(key: string, source: SlotSource, index: number, takeOnly = false): HTMLDivElement {
    return this.registerExisting(this.createSlot(), key, source, index, takeOnly);
  }

  private registerExisting(
    slot: HTMLDivElement,
    key: string,
    source: SlotSource,
    index: number,
    takeOnly = false,
  ): HTMLDivElement {
    slot.dataset.key = key;
    this.bindings.set(key, { element: slot, source, index, takeOnly });
    // 悬停（批次 128）：数字键 1-9 / F 作用在"鼠标悬停的那一格"上；
    // 拖拽时经过的槽位也在这里收集（松手时统一结算分配）
    slot.addEventListener('mouseenter', () => {
      this.hovered = { key, source, index };
      // ⚠️ 批次 136：**同一格只记一次**。Wiki「物品管理」："在此期间，每个格子只会
      // 被影响一次，原路返回无法取消操作对格子的波及。"——鼠标来回划过一个格子会
      // 触发多次 `mouseenter`，不去重的话同一格会被算成两个格子，均分的结果偏多
      //（10 个划过 A→B→A 会被分成 3 份而不是 2 份）。
      if (this.dragButton === null) return;
      if (this.dragSlots.some((slot) => slot.source === source && slot.index === index)) return;
      this.dragSlots.push({ source, index });
    });
    slot.addEventListener('mouseleave', () => {
      if (this.hovered?.key === key) this.hovered = null;
    });
    return slot;
  }

  // ---------------------------------------------------------------- 交互

  private bindEvents(): void {
    document.addEventListener(
      'pointermove',
      (event) => {
        if (!this.open) return;
        this.heldElement.style.left = `${event.clientX}px`;
        this.heldElement.style.top = `${event.clientY}px`;
        // 分类栏"按住滑动查看配方"（批次 209）
        this.updateCategoryScrub(event);
      },
      { signal: this.listeners.signal },
    );
    // 分类列表滚动时手指位置不变、格子却在换：照样跟到最新的格子上
    this.categoryGrid.addEventListener(
      'scroll',
      () => {
        if (this.categoryScrub) this.previewCategoryAt(this.categoryScrub.lastX, this.categoryScrub.lastY);
      },
      { signal: this.listeners.signal },
    );

    // 批次 159：**按下就记一次坐标**。
    // `#inv-held` 是 `position: fixed` 却没有初始 left/top，坐标只在 pointermove 里给；
    // 触摸端一次轻点不产生 pointermove，那块图标就停在居中容器的左上角——
    // 用户看到的正是"点中一个物品，它的图标会飘在左边"。
    // 同一处顺手接上"点物品弹说明"（捕获阶段：销毁格会 stopPropagation）。
    this.root.addEventListener(
      'pointerdown',
      (event) => {
        const pointer = event as PointerEvent;
        this.heldElement.style.left = `${pointer.clientX}px`;
        this.heldElement.style.top = `${pointer.clientY}px`;
        const slot = (event.target as HTMLElement | null)?.closest<HTMLElement>('.inv-slot');
        // ⚠️ 批次 181：合成格里的配方预览**不因为点一下就消失**。
        // 用户的原话："点合成区应该是显示那一格的名称，而不是把配方清空"。
        // 预览只是展示，不是真实材料；点它唯一的结果就是下面那条名称提示。
        if (slot) {
          this.showPickToast(slot);
          // 批次 159：**按下就沉下去**。触摸端一次轻点要到 `pointerup` 才结算
          //（要跟长按区分），等结算完再给反馈就成了"点了要等一下才选中"。
          // ⚠️ 空槽不给：空槽本来就不可选中，给它"沉下去"会让人以为选中了。
          // 批次 184：红底那种"我没有的"也**不选中**，所以不给"相框"，
          // 只给一下缩放（用户："点击应该只触发点击效果"）。
          if (this.tooltipStacks.has(slot)) {
            // 批次 209：**分类栏一律只给"点一下"的缩放**，绝不给 `.pressing`
            // （那套是"相框选中"的白色底，用户反复反馈"红底点一下变白"）。
            if (slot.classList.contains('category-slot') || slot.classList.contains('locked')) {
              this.flashLocked(slot);
            } else {
              this.markPressing(slot);
            }
          }
        }
      },
      true,
    );
    // 抬手 / 取消就摘掉"按下去"那一层：真正的选中（`.selected`）由刷新接着接上
    for (const type of ['pointerup', 'pointercancel'] as const) {
      document.addEventListener(
        type,
        () => {
          this.markPressing(null);
          // 抬手指才决定"是点击（填充）还是只滑动过（保持预览）"
          this.endCategoryScrub(type === 'pointercancel');
        },
        { signal: this.listeners.signal },
      );
    }

    // 松手：把这一趟拖过的槽位结算掉（批次 128）
    document.addEventListener(
      'pointerup',
      () => {
        const button = this.dragButton;
        const slots = this.dragSlots;
        this.dragButton = null;
        this.dragSlots = [];
        // 只经过起点那一格 = 普通点击，已经由 `pointerdown` 处理过了
        if (button === null || slots.length <= 1) return;
        this.held = button === 0 ? distributeEvenly(this.held, slots) : placeOneEach(this.held, slots);
        this.refresh();
      },
      { signal: this.listeners.signal },
    );

    // 点面板里的空白处 = **丢弃**（批次 206，用户反复提的那条）。
    //
    // 以前这里写的是"取消选中、原位退回"——理由是"面板内不属于窗口外"。
    // 但在手机上，面板背景几乎铺满整屏，玩家真正能点到的"窗口外"只有边缘一条缝；
    // 手指点在两栏之间/格子之外的空处时，看到的正是"外面"，期待的就是丢出去。
    // 这个项目里没有"点空白取消"的其它入口损失（Esc / ✕ 都能关、再点原格也能放回）。
    this.panel.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      if (!this.held) return;
      if (target.closest('.inv-slot, button, input, .recipe-cell')) return;
      event.preventDefault();
      event.stopPropagation();
      // 鼠标右键只丢一个（Wiki 原文），触摸/左键丢整叠
      this.dropHeldStack(event.button === 2 ? 1 : this.held.count);
    });

    // 点界面外（含 shell 留白、快捷栏 dock 以外的暗色区域）：同样丢进世界。
    // 判据从"target 必须是 root/shell"放宽成"**不在任何交互元素里**"——
    // 原来点两栏之间的缝、或某个装饰层什么都不发生，玩家就会以为"丢弃没做"。
    this.root.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      // 批次 209：快捷栏 dock 的**空白处**也算界面外（用户习惯点快捷栏左右两侧丢东西）。
      // 只排除真正的格子/按钮/输入框——dock 本身不能整块豁免。
      if (this.panel.contains(target)) return;
      if (target.closest('.inv-slot, button, input, .recipe-cell')) return;
      event.preventDefault();
      this.dropHeldStack(event.button === 2 ? 1 : (this.held?.count ?? 0));
    });

    document.addEventListener(
      'keydown',
      (event) => {
        if (!this.open) return;
        if (event.code === 'Escape') {
          this.close();
          return;
        }
        // 数字键 1-9 / F：与快捷栏 / 副手交换（批次 128，作用在悬停的那一格）
        const swapKey = swapKeyOf(event);
        if (swapKey !== null) {
          if (this.hovered && swapWithSlot(this.inventory, this.hovered, swapKey)) this.refresh();
          return;
        }
        // Q / Ctrl+Q：丢 1 件 / 丢整叠（批次 128）
        if (event.code === 'KeyQ') {
          event.preventDefault();
          this.dropFromCursor(event.ctrlKey || event.metaKey);
        }
      },
      { signal: this.listeners.signal },
    );
  }

  /**
   * 把光标上那一叠**整个丢进世界**（批次 206：点面板空白 / 窗口外）。
   *
   * 只报"丢哪件、丢几件"给主程序（它才知道玩家站哪、掉落物怎么生成）。
   * 主程序没接 `onDrop` 时退回"原位放回"——宁可放回去，也不能把东西凭空吃掉。
   */
  private dropHeldStack(count = this.held?.count ?? 0): void {
    if (!this.held) return;
    if (!this.hooks.onDrop) {
      this.cancelHeldSelection();
      return;
    }
    const stack = this.held;
    const drop = Math.min(Math.max(1, count), stack.count);
    diag.event('inventory', 'item.drop', {
      itemId: stack.id,
      count: drop,
      from: 'outside',
      creative: this.hooks.isCreative?.() ?? false,
    });
    this.hooks.onDrop(stack.id, drop);
    this.showMessage(`已丢弃 ${itemLabel(stack.id)} ×${drop}`);
    if (drop >= stack.count) {
      this.held = null;
      this.heldFromCreative = false;
      this.heldOriginEl = null;
    } else {
      this.held = { ...stack, count: stack.count - drop };
    }
    this.touchOrigin = null;
    this.refresh();
  }

  /**
   * **丢出**（批次 128，原版 Q / Ctrl+Q）：**悬停的那一格优先**，其次光标上拿着的那一叠。
   *
   * 真正生成掉落物的是主程序（`hooks.onDrop`）——界面不知道玩家站在哪。
   * ⚠️ 主程序没接这个钩子时**什么都不做**：宁可丢不出去，也不能把东西凭空吃掉。
   */
  private dropFromCursor(wholeStack: boolean): void {
    const binding = this.hovered ? this.bindings.get(this.hovered.key) : undefined;
    const stack = binding ? binding.source.get(binding.index) : this.held;
    const count = dropCount(stack, wholeStack);
    if (!stack || count <= 0 || !this.hooks.onDrop) return;
    diag.event('inventory', 'item.drop', {
      itemId: stack.id,
      count,
      from: binding ? (this.hovered?.key ?? 'slot') : 'cursor',
      held: this.held?.id ?? null,
    });
    this.hooks.onDrop(stack.id, count);
    // 丢完给一句确认：触摸端没有"东西掉在地上"的直接反馈
    this.showMessage(`已丢弃 ${itemLabel(stack.id)} ×${count}`);
    if (binding) {
      binding.source.set(binding.index, stack.count > count ? { ...stack, count: stack.count - count } : null);
    } else if (this.held) {
      this.held = this.held.count > count ? { ...this.held, count: this.held.count - count } : null;
    }
    this.refresh();
  }

  /**
   * **双击收集**（批次 128，原版）：把点中那一格**所在的那个容器**里的同类物品
   * 凑满一整堆抓到光标上（凑不满就凑多少算多少）。
   *
   * @returns 有没有真的收集到（false → 退回普通点击）
   */
  private gatherFrom(binding: SlotBinding): boolean {
    const source = binding.source;
    const first = source.get(binding.index);
    const itemId = this.held?.id ?? first?.id;
    if (itemId === undefined) return false;
    const extras = this.held ? stackExtras(this.held) : first ? stackExtras(first) : {};
    // 先像普通左键那样"把点中的那一叠拿起来"，再从整个容器里凑同类
    if (!this.held && first) {
      this.held = first;
      source.set(binding.index, null);
    }
    const before = this.held?.count ?? 0;
    this.held = gatherSameItems(source, this.slotCountFor(source), itemId, this.held, extras);
    if ((this.held?.count ?? 0) === before) return false;
    this.refresh();
    return true;
  }

  /** 某个来源一共有多少格（按注册进界面的绑定数一遍，与快速移动那边同一个做法） */
  private slotCountFor(source: SlotSource): number {
    let max = 0;
    for (const binding of this.bindings.values()) {
      if (binding.source === source) max = Math.max(max, binding.index + 1);
    }
    return max;
  }

  /**
   * 双击该不该退化成"快速移动"（批次 133，基岩版规则）。
   *
   * Wiki「物品管理 → 便捷鼠标操作」原文："在基岩版中，当双击的物品已满一组、
   * 没有其他物品来补充成一组或不可堆叠时，该物品将会快速移动至其他地方（若有），
   * 效果与按⇧ Shift+左键一致。"——三种情形都在下面这一处判完。
   */
  private shouldQuickMoveOnDouble(binding: SlotBinding): boolean {
    const stack = binding.source.get(binding.index);
    if (!stack) return false;
    const capacity = maxStackOf(stack.id);
    if (capacity <= 1) return true; // 不可堆叠（工具 / 盔甲）：双击就是搬运
    if (stack.count >= capacity) return true; // 已经满一组，没什么可补的
    // 同一个容器里还有没有同类：有 → 双击的语义是"凑满一整堆"，不能抢走去做快速移动
    const total = this.slotCountFor(binding.source);
    for (let index = 0; index < total; index++) {
      if (index === binding.index) continue;
      if (binding.source.get(index)?.id === stack.id) return false;
    }
    return true;
  }

  /**
   * 统一的槽位激活入口（左键 = 0，右键 = 2）。
   *
   * **Shift+左键 = 快速移动**（批次 127，对齐原版）：普通槽走 `quickMoveSlot`，
   * 合成结果走"一次做完"（`handleResultClick(true)`）。
   * 触摸端没有 Shift 键，所以长按那套（右键语义）完全不受影响。
   */
  private activateSlot(key: string, button: number, shift = false): void {
    // 搬运声（批次 138）：**动过才响**。判据放在这一层而不是散在十几个分支里——
    // 那些分支有一堆提前 return，逐个补一句"响一下"迟早漏掉一处（漏掉的表现是"点了没声"）
    const before = this.moveSignature();
    this.activateSlotInner(key, button, shift);
    if (this.moveSignature() !== before) this.hooks.onMove?.();
  }

  /**
   * 界面上"东西都在哪"的指纹：光标那一叠 + 每一个已注册槽位。
   *
   * 只在一次点击里取两次（前后各一次），所以不必省——几十个槽位拼一个字符串而已。
   * ⚠️ 槽位按 `bindings` 的插入顺序遍历，两次调用之间只要没重建面板就是稳定的。
   */
  private moveSignature(): string {
    const parts: string[] = [this.held ? `@${this.held.id}:${this.held.count}` : '@'];
    for (const [key, binding] of this.bindings) {
      const stack = binding.source.get(binding.index);
      parts.push(stack ? `${key}=${stack.id}:${stack.count}` : `${key}=`);
    }
    return parts.join('|');
  }

  private activateSlotInner(key: string, button: number, shift = false): void {
    // 只有"手里拿着东西去点合成格"（= 真的要摆材料）才收掉只读预览。
    // 空手点材料区**保持预览**（批次 211）：玩家就是来看"这条配方要什么"的，
    // 点一下就把预览清掉等于看不到组成材料。
    if (this.craftGhost && key !== 'craft:result' && key.startsWith('craft:')) {
      if (this.held) {
        this.clearCraftGhost();
        this.refresh();
      } else {
        // 预览盖住的可能是真实材料：空手这一下**什么都不做**，
        // 否则会把看不见的东西抓到手上（"我只是想看看配方"）。
        return;
      }
    }
    // 批次 325：熔炉原料/燃料的点击单独走"选中 / 再点取回"，
    // 不能被双击收集或 Shift 快速移动抢先处理。
    const furnaceBinding = this.bindings.get(key);
    if (
      furnaceBinding &&
      furnaceBinding.source instanceof Furnace &&
      (furnaceBinding.index === FURNACE_INPUT || furnaceBinding.index === FURNACE_FUEL) &&
      !shift
    ) {
      this.handleSlotClick(key, button);
      return;
    }
    // **双击收集**（批次 128）：同一格在 400ms 内点第二下 → 把容器里的同类凑满一整堆。
    // ⚠️ 放在最前面：双击的那一下不该再按"普通左键"走一遍（那会先把光标上的东西放下）
    const now = performance.now();
    const isDouble = this.lastClick?.key === key && now - this.lastClick.at <= DOUBLE_CLICK_MS;
    this.lastClick = { key, at: now };
    if (button === 0 && !shift && isDouble) {
      const binding = this.bindings.get(key);
      if (binding && !binding.takeOnly) {
        // **基岩版规则**（Wiki「物品管理 → 便捷鼠标操作」）：双击那一叠"已经满一组、
        // 没有同类可补、或根本不可堆叠"时，双击**退化成快速移动**（等同 Shift+左键）。
        // ⚠️ 必须在 `gatherFrom` **之前**判：它会先把那一叠抓到光标上，
        // 等它返回 false 时物品已经在鼠标上了，那时再改语义就晚了。
        if (this.shouldQuickMoveOnDouble(binding)) {
          this.quickMoveSlot(key);
          return;
        }
        if (this.gatherFrom(binding)) return;
      }
    }
    // **Shift+双击**（批次 129）：把点中那一格**所属的那一类**整批搬到另一边
    // （开着方块时是玩家背包 ↔ 方块，没开时是快捷栏 ↔ 主背包）
    if (button === 0 && shift && isDouble) {
      const binding = this.bindings.get(key);
      if (binding && !binding.takeOnly && this.moveAllOfTypeFrom(binding)) return;
    }
    if (shift && button === 0) {
      if (key === 'craft:result') this.handleResultClick(true);
      else this.quickMoveSlot(key);
      return;
    }
    if (key === 'craft:result') this.handleResultClick();
    else this.handleSlotClick(key, button);
  }

  /**
   * **Shift+左键**：把这一格整叠搬到"它该去的地方"（批次 127，对齐原版）。
   *
   * 规则全在 `core/container/QuickMove.ts`（纯逻辑、可断言）：背包 ↔ 容器、
   * 快捷栏 ↔ 主背包、盔甲直接穿上、装不下就不动。这里只做三件事：
   * **把"哪一格 / 开着哪个容器 / 容器多少格"交出去**、刷新界面、守住"只取不放"的槽位。
   */
  private quickMoveSlot(key: string): void {
    const binding = this.bindings.get(key);
    if (!binding) return;
    const { source, index, takeOnly } = binding;

    // 绑定诅咒（批次 270）：Shift+左键的"快速移动"同样不能把绑定装备挪走
    if (this.boundArmorAt(source, index)) {
      this.showMessage('绑定诅咒：这件装备取不下来');
      return;
    }

    // 只取不放的槽（熔炉/酿造台/切石机的产物）：原版 Shift 就是"整叠收走"。
    // 走既有那条路（它会结算烧炼经验），再把光标上的东西塞回背包
    if (takeOnly) {
      this.handleSlotClick(key, 0);
      this.storeHeld();
      return;
    }

    const { container, size } = this.activeContainerInfo();
    const result = quickMove(this.inventory, container, size, source, index);
    if (!result.moved) return;
    this.refresh();
  }

  /**
   * **Shift+双击**：把这一类整批搬到另一边（批次 129，对齐原版）。
   *
   * 规则在 `CursorActions.moveAllOfTypeBetween`（纯函数）：方向由"点的是哪一侧"决定
   * ——点容器里的东西就全搬进玩家背包，点玩家背包里的就全搬进容器；没开容器时两边都往对面搬。
   *
   * @returns 有没有真的搬动（false → 退回 Shift+单击那条路）
   */
  private moveAllOfTypeFrom(binding: SlotBinding): boolean {
    const { container, size } = this.activeContainerInfo();
    const moved = moveAllOfTypeBetween(this.inventory, container, size, binding.source, binding.index);
    if (moved <= 0) return false;
    this.refresh();
    return true;
  }

  /**
   * 当前开着哪个容器、它有多少格（快速移动与 Shift+双击都要用）。
   *
   * 格数是**按注册进界面的绑定数一遍**：各族容器格数不一样（箱子 27、熔炉 3、酿造台 5……），
   * 界面这边不用再抄一份常量表——抄一份就多一处会漂的地方。
   */
  private activeContainerInfo(): { container: SlotSource | null; size: number } {
    const container = this.mode === 'inventory' ? null : this.activeContainer;
    if (!container) return { container: null, size: 0 };
    let size = 0;
    for (const other of this.bindings.values()) if (other.source === container) size++;
    return { container, size };
  }

  /**
   * 把光标上拿着的东西放回背包（**只做这一件事**）。
   *
   * 与 `returnHeldToInventory` 的区别：那个是"关界面 / 点界面外"用的，
   * 顺带还会把合成网格里的东西倒回背包；这里不能那么干——
   * Shift+点一个槽位不该把工作台上的材料也一起收走。
   */
  private storeHeld(): void {
    if (!this.held) return;
    const leftover = this.inventory.addStack(this.held);
    this.held = leftover > 0 ? { id: this.held.id, count: leftover, ...stackExtras(this.held) } : null;
    this.refresh();
  }

  /**
   * 触摸端的槽位手势：短按抬起算左键，按住超过阈值算长按（右键 + 连发）。
   *
   * 用 `setPointerCapture` 把后续事件绑到同一个槽位元素上，
   * 这样手指稍微滑出槽位再抬起也能正确收尾（否则 pointerup 会丢，定时器一直跑）。
   */
  private beginTouchPress(slot: HTMLDivElement, key: string, pointerId: number, startX = 0): void {
    this.clearTouchPress();
    try {
      slot.setPointerCapture(pointerId);
    } catch {
      // 指针已经失效时调用会抛错，直接忽略：没有捕获也不影响短按
    }

    this.touchPressTimer = window.setTimeout(() => {
      this.touchPressTimer = null;
      // 长按的第一支：**选数量**（基岩版那个指示条）。它自己管划动与松手结算，
      // 所以连发不再启动——两者的手势是同一次"按住"，不该叠在一起。
      if (this.beginSplit(slot, key, startX)) return;
      // 长按的第二支：右键行为 + 连发（合成网格批量放置、箱子连续取一个都靠它）
      this.activateSlot(key, 2);
      this.touchRepeatTimer = window.setInterval(() => this.activateSlot(key, 2), TOUCH_REPEAT_MS);
    }, TOUCH_LONG_PRESS_MS);

    const finish = (): void => {
      // 正在选数量：抬手 = 按当前数量拆开（这才是这一支的"点击结算"）。
      // ⚠️ 必须在 `clearTouchPress` 之前判——它会把选数量的状态一起收掉。
      if (this.split) {
        this.commitSplit();
        return;
      }
      const wasQuickTap = this.touchPressTimer !== null;
      this.clearTouchPress();
      if (wasQuickTap) this.activateSlot(key, 0);
    };

    slot.addEventListener('pointerup', finish, { once: true });
    slot.addEventListener('pointercancel', () => this.clearTouchPress(), { once: true });
  }

  /**
   * 进入"长按选数量"（批次 137）。返回 false = 这一格不走这条路（走原来的右键 + 连发）。
   *
   * 判据全在 `canSplitStack` 里（有 ≥2 个且手上空着），这里只补"只取不放的槽位不参与"。
   */
  private beginSplit(slot: HTMLDivElement, key: string, startX: number): boolean {
    const binding = this.bindings.get(key);
    if (!binding || binding.takeOnly) return false;
    // 熔炉原料/燃料不支持拆数量：长按直接走右键“放回仓库”（批次 325）
    if (
      binding.source instanceof Furnace &&
      (binding.index === FURNACE_INPUT || binding.index === FURNACE_FUEL)
    ) {
      return false;
    }
    const stack = binding.source.get(binding.index);
    if (!canSplitStack(stack, this.held !== null)) return false;
    const bar = slot.querySelector<HTMLElement>('.inv-split-bar');
    const fill = bar?.firstElementChild as HTMLElement | null;
    const label = slot.querySelector<HTMLElement>('.inv-split-count');
    if (!bar || !fill || !label) return false;

    const total = stack!.count;
    this.split = {
      key,
      source: binding.source,
      index: binding.index,
      total,
      startCount: initialSplitCount(total),
      count: initialSplitCount(total),
      startX,
      // 一格的实际宽度：划动映射按它归一，所以三档尺寸（34/42/46px）不用各写一套
      width: slot.getBoundingClientRect().width || 42,
      element: slot,
      bar,
      fill,
      label,
    };

    const onMove = (event: PointerEvent): void => {
      if (!this.split) return;
      const dx = event.clientX - this.split.startX;
      this.split.count = splitCountForDrag(this.split.total, this.split.startCount, dx, this.split.width);
      this.paintSplit();
    };
    slot.addEventListener('pointermove', onMove);
    this.splitDetach = () => slot.removeEventListener('pointermove', onMove);

    slot.classList.add('splitting');
    bar.classList.remove('hidden');
    label.classList.remove('hidden');
    this.paintSplit();
    return true;
  }

  /** 指示条的绿色占比与数字（只改界面，不动数据） */
  private paintSplit(): void {
    const split = this.split;
    if (!split) return;
    split.fill.style.width = `${Math.round(splitFraction(split.count, split.total) * 100)}%`;
    split.label.textContent = String(split.count);
  }

  /** 收掉选数量的界面痕迹（数据不动） */
  private endSplit(): void {
    const split = this.split;
    if (!split) return;
    this.splitDetach?.();
    this.splitDetach = null;
    this.split = null;
    split.element.classList.remove('splitting');
    split.bar.classList.add('hidden');
    split.label.classList.add('hidden');
  }

  /**
   * 松手结算：按选中的数量把这一格拆开，**选中的那份放到光标上**。
   *
   * 记下 `touchOrigin`：目标格装不下时多余按 Wiki 回到来源格（批次 142）。
   */
  private commitSplit(): void {
    const split = this.split;
    if (!split) return;
    // 期间这一格可能已经变了（漏斗往里塞、另一个界面动过同一个容器）——以"现在"为准
    const stack = split.source.get(split.index);
    const count = split.count;
    this.endSplit();
    if (!stack || this.held) return;
    const { taken, rest } = splitStack(stack, count);
    if (!taken) return;
    split.source.set(split.index, rest);
    this.held = taken;
    this.touchOrigin = { source: split.source, index: split.index, itemId: taken.id };
    if (split.source === this.inventory) this.inventory.notify();
    this.refresh();
    this.hooks.onMove?.();
  }

  /**
   * 触摸端：把光标上装不下的同类送回来源格（Wiki「触摸操作」）。
   * 只在同类 / 来源空时动手；交换后光标上是别的东西则不动。
   */
  private returnHeldToTouchOrigin(): void {
    if (!this.held || !this.touchOrigin || !isTouchUi()) return;
    if (this.held.id !== this.touchOrigin.itemId) return;
    const { source, index } = this.touchOrigin;
    const there = source.get(index);
    if (!there) {
      source.set(index, this.held);
      this.held = null;
    } else if (there.id === this.held.id) {
      const room = maxStackOf(there.id) - there.count;
      const moved = Math.min(room, this.held.count);
      if (moved <= 0) return;
      there.count += moved;
      this.held.count -= moved;
      if (this.held.count <= 0) this.held = null;
      if (source === this.inventory) this.inventory.notify();
    }
    if (!this.held) this.touchOrigin = null;
  }

  /** 清掉长按相关的定时器（抬起 / 取消 / 开始新手势时调用） */
  private clearTouchPress(): void {
    if (this.touchPressTimer !== null) {
      window.clearTimeout(this.touchPressTimer);
      this.touchPressTimer = null;
    }
    if (this.touchRepeatTimer !== null) {
      window.clearInterval(this.touchRepeatTimer);
      this.touchRepeatTimer = null;
    }
    this.endSplit();
  }

  /**
   * 这个槽位收不收这件物品。
   * 只有玩家背包有"部位限制"（36-39 是盔甲槽），合成网格/箱子/熔炉一律放行。
   */
  private accepts(binding: SlotBinding, itemId: number): boolean {
    // 铁砧与锻造台的产物槽都由输入格算出来，不能手动放
    if (binding.source instanceof Anvil && binding.index === ANVIL_RESULT) return false;
    if (binding.source instanceof Grindstone && binding.index === GRINDSTONE_RESULT) return false;
    if (binding.source instanceof SmithingTable && binding.index === SMITHING_RESULT) return false;
    // 附魔台的青金石槽只吃青金石（放别的进去会把"点不动"的原因藏起来）
    if (binding.source instanceof EnchantTable) {
      return binding.index !== ENCHANT_LAPIS_SLOT || EnchantTable.acceptsLapis(itemId);
    }
    if (binding.source !== this.inventory) return true;
    return this.inventory.canPlace(binding.index, itemId);
  }

  /** 触摸端没有"指针变禁止符"这种提示，用一次短促的抖动告诉玩家"这里放不下" */
  private rejectSlot(element: HTMLElement): void {
    element.classList.remove('inv-reject');
    // 读一次布局属性强制重排，否则连续两次拒绝不会重播动画
    void element.offsetWidth;
    element.classList.add('inv-reject');
    window.setTimeout(() => element.classList.remove('inv-reject'), 220);
  }

  /**
   * 这一格是不是"脱不下来的装备"（批次 270，绑定诅咒）。
   *
   * 只拦**玩家背包的四个盔甲槽**：容器里的东西、创造模式、以及死亡掉落都不受这条限制
   * （死亡时背包整体清空，走的是另一条路，不会经过这里）。
   */
  private boundArmorAt(source: unknown, index: number): boolean {
    if (source !== this.inventory) return false;
    if (index < ARMOR_START || index >= ARMOR_START + 4) return false;
    if (this.hooks.isCreative?.() === true) return false;
    return isBoundByCurse(this.inventory.get(index)?.enchants);
  }

  private handleSlotClick(key: string, button: number): void {
    const binding = this.bindings.get(key);
    if (!binding) return;
    // 批次 324：手动往原料/燃料格放东西或取回时，只要还没点过目标开工，
    // 就强制保持暂停——不能因为操作槽位而自动开始烧。
    if (
      binding.source instanceof Furnace &&
      (binding.index === FURNACE_INPUT || binding.index === FURNACE_FUEL) &&
      !this.furnaceStarted
    ) {
      binding.source.paused = true;
    }
    // 熔炉产物槽：点一下直接进背包，不经过光标（批次 309）
    if (binding.source instanceof Furnace && binding.index === FURNACE_OUTPUT) {
      this.takeFurnaceOutput(true);
      return;
    }
    // 铁砧产物：不是普通搬运——要先查等级、扣等级、扣材料再重算（H8）
    if (binding.source instanceof Anvil && binding.index === ANVIL_RESULT) {
      this.handleAnvilTake();
      return;
    }
    // 砂轮产物：扣两格输入 + 返还经验（不查等级，H15）
    if (binding.source instanceof Grindstone && binding.index === GRINDSTONE_RESULT) {
      this.handleGrindstoneTake();
      return;
    }
    // 锻造台产物：同样要先扣材料再重算（不要经验，见 K8 尾巴）
    if (binding.source instanceof SmithingTable && binding.index === SMITHING_RESULT) {
      this.handleSmithingTake();
      return;
    }
    const { source, index, takeOnly } = binding;
    const slot = source.get(index);
    const hadHeld = this.held !== null;

    // 批次 323（用户）：熔炉原料/燃料仍可选中，但也要能放回仓库：
    //   - 右键直接放回仓库；
    //   - 左键第一次选中，再点同一格放回仓库；
    //   - 手里拿着东西点它仍然是正常放置（从仓库放进熔炉）。
    if (!this.held && slot && source instanceof Furnace && (index === FURNACE_INPUT || index === FURNACE_FUEL)) {
      this.selectedEl?.classList.remove('selected');
      if (button === 2 || this.selectedStationKey === key) {
        this.selectedStationKey = null;
        this.selectedEl = null;
        this.returnStationStack(source, index);
        this.refresh();
        return;
      }
      this.selectedStationKey = key;
      binding.element.classList.add('selected');
      this.selectedEl = binding.element;
      this.showMessage('已选中 · 再点一次放回仓库');
      return;
    }
    // 点了别的格子：熔炉原料/燃料的选中态取消
    this.selectedStationKey = null;

    // 产物槽等只取不放：手里拿着东西再点它属于“不可放置点”。
    // 不交换、不把物品塞进产物槽；只取消当前选取并把东西送回来源。
    if (this.held && takeOnly) {
      this.rejectSlot(binding.element);
      this.cancelHeldSelection();
      return;
    }

    if (this.held && !takeOnly) {
      // 盔甲槽只吃对应部位：不匹配就整次操作作废（既不放下也不交换）
      if (!this.accepts(binding, this.held.id)) {
        this.rejectSlot(binding.element);
        this.cancelHeldSelection();
        return;
      }
      // 绑定诅咒（批次 270）：已装备的绑定物品换不下来
      if (this.boundArmorAt(binding.source, index)) {
        this.showMessage('绑定诅咒：这件装备取不下来');
        this.rejectSlot(binding.element);
        this.cancelHeldSelection();
        return;
      }
      // 批次 159：**创造栏取出的复制品直接覆盖**（原来那件销毁）。
      // 复制品没有来源格，"换到手上"在创造模式里毫无意义（手上多一叠没处用），
      // 基岩版创造也是放到已有物品的格子上时直接盖掉。
      if (this.heldFromCreative && slot) {
        source.set(index, this.held);
        this.held = null;
        this.heldFromCreative = false;
        this.inventory.notify();
      } else if (button === 2) {
        if (!slot) {
          source.set(index, { id: this.held.id, count: 1 });
          this.held.count -= 1;
        } else if (slot.id === this.held.id && slot.count < maxStackOf(slot.id)) {
          slot.count += 1;
          this.held.count -= 1;
          this.inventory.notify();
        } else if (slot.id !== this.held.id) {
          // ⚠️ 批次 136 补这一支：Wiki「物品管理」原文是"点击**左右键**时，若目标格
          // 放有与鼠标上所带物品不同的物品，两者交换"——右键点异类格同样是交换。
          // 原来右键只有"空格放 1 个 / 同类 +1"两条分支，点在异类格上**什么都不发生**，
          // 而同一格用左键点就换了（同一次操作两种结果，最容易被当成"点击没生效"）。
          source.set(index, this.held);
          if (!this.completeSwapIntoOrigin(slot)) this.held = slot;
        }
      } else if (!slot) {
        source.set(index, this.held);
        this.held = null;
      } else if (slot.id === this.held.id) {
        const room = maxStackOf(slot.id) - slot.count;
        const moved = Math.min(room, this.held.count);
        slot.count += moved;
        this.held.count -= moved;
        this.inventory.notify();
      } else {
        source.set(index, this.held);
        if (!this.completeSwapIntoOrigin(slot)) this.held = slot;
      }
    } else if (slot) {
      // 绑定诅咒（批次 270）：空手点已装备的绑定物品也拿不下来
      if (this.boundArmorAt(binding.source, index)) {
        this.showMessage('绑定诅咒：这件装备取不下来');
        this.rejectSlot(binding.element);
        return;
      }
      // 只取不放的槽位：右键拿一半同样允许
      if (button === 2 && slot.count > 1) {
        const half = Math.ceil(slot.count / 2);
        this.held = { id: slot.id, count: half };
        slot.count -= half;
        this.inventory.notify();
        // 这一格自己还留着一半，"就地显示"会把剩下的那一半盖掉——
        // 没法就地表示就退回"跟着光标那一块"（它的坐标在 pointerdown 时就写好了）
        this.heldOriginEl = null;
      } else if (!this.held || takeOnly) {
        if (this.held && takeOnly) {
          // 手上有东西时点只取不放的槽：合并同类
          if (this.held.id === slot.id) {
            const room = maxStackOf(slot.id) - slot.count;
            const moved = Math.min(room, this.held.count);
            slot.count += moved;
            this.held.count -= moved;
            this.inventory.notify();
          }
        } else {
          this.held = slot;
          source.set(index, null);
          // 无论鼠标还是触摸都记来源：点到不可放置区域时要能“取消选中”并原位退回。
          this.touchOrigin = { source, index, itemId: slot.id };
          // 批次 159：整叠被拿走 → 那叠就**显示在来源格里**并变深（= 选中）。
          // 交换时也留意这一条：来源格空着，换过来的那件正好落在里面。
          // ⚠️ 只取不放的槽（熔炉产物等）除外：它们被取空是要"产出下一件"的，
          //   再把取走的那叠画回去会让人以为没取出来。
          this.heldOriginEl = takeOnly ? null : binding.element;
          // 从真实格子拿的：不是复制品，放到已有物品的格子上要按原版**交换**
          this.heldFromCreative = false;
        }
      }
    }

    // 触摸：放下后光标还有同类剩余 → 回源格（Wiki；桌面鼠标仍留光标）
    if (hadHeld && this.held && this.held.count > 0) this.returnHeldToTouchOrigin();
    if (!this.held) this.touchOrigin = null;

    // 熔炉产物被取空 → 结算攒下的烧炼经验（原版也是"整槽取走才给"）
    if (takeOnly && source instanceof Furnace && source.get(FURNACE_OUTPUT) === null) {
      const xp = source.takeExperience();
      if (xp > 0) this.hooks.onFurnaceXp?.(xp);
    }

    if (this.held && this.held.count <= 0) this.held = null;
    this.crafting.recompute();
    this.refresh();
  }

  /**
   * 交换成功后**取消选中**（批次 229，用户要求）。
   *
   * 原版鼠标语义是"换到手上的变成对方那叠"，于是可以连续换；但在手机上手一直
   * 举着一叠东西很碍事。这里把对方那叠放回**来源格**（A 离开后它正好空着），
   * 一次交换 = 两格真正对调，选中态清空。
   *
   * @param swapped 目标格里被换下来的那叠
   * @returns 是否已放回来源格（false 时调用方按旧逻辑把 swapped 拿到手上）
   */
  private completeSwapIntoOrigin(swapped: ItemStack): boolean {
    const origin = this.touchOrigin;
    if (!origin || origin.source.get(origin.index) !== null) return false;
    origin.source.set(origin.index, swapped);
    if (origin.source === this.inventory) this.inventory.notify();
    this.held = null;
    this.heldOriginEl = null;
    this.touchOrigin = null;
    return true;
  }

  /** 取消选中：优先原位退回；原位已被占时再放回玩家背包。创造复制出来的物品直接清掉。 */
  private cancelHeldSelection(): void {
    if (!this.held) return;
    const origin = this.touchOrigin;
    if (origin && this.held.id === origin.itemId) {
      const there = origin.source.get(origin.index);
      if (!there) {
        origin.source.set(origin.index, this.held);
        if (origin.source === this.inventory) this.inventory.notify();
        this.held = null;
      } else if (there.id === this.held.id) {
        const room = maxStackOf(there.id) - there.count;
        const moved = Math.min(room, this.held.count);
        there.count += moved;
        this.held.count -= moved;
        if (origin.source === this.inventory) this.inventory.notify();
        if (this.held.count <= 0) this.held = null;
      }
    }
    if (this.held) {
      // 创造栏选出来的是复制品，没有来源；取消时不能把复制品偷偷塞进玩家背包。
      const creativeCopy =
        this.mode === 'inventory' &&
        (this.hooks.isCreative?.() ?? false) &&
        origin === null;
      if (creativeCopy) this.held = null;
      else this.storeHeld();
    }
    this.touchOrigin = null;
    this.refresh();
  }

  /**
   * 点合成结果槽：合成一次，产物优先放到光标上。
   *
   * `shift = true`（批次 127）是原版的"**一次做完**"：一直取产物，
   * 直到**材料用完**或**背包塞不下**（原版就是这两条终止条件），产物直接进背包。
   *
   * ⚠️ 顺序要紧：**先问装不装得下、再取产物**——反过来的话，背包满时那一次
   * 会白吃掉一份材料而产物掉在地上。
   */
  private handleResultClick(shift = false): void {
    const grid = this.crafting;
    const product = grid.result;
    if (!product) return;

    // Shift：一次做完（材料用完 / 背包塞不下就停）
    if (shift) {
      let crafted = 0;
      while (grid.result) {
        const next = grid.result;
        if (fitCount(next, this.inventory, PLAYER_FILL_ORDER) < next.count) break;
        if (!grid.takeResult()) break;
        // 附加数据一起交出去（批次 192：烟花的颜色/档位就在 `next` 里）
        this.inventory.addStack({ id: next.id, count: next.count, ...stackExtras(next) });
        crafted++;
        // 保底：正经配方都到不了 64 次，只为防"产物又能当原料"那种配方死循环
        if (crafted >= 64) break;
      }
      if (crafted > 0) {
        // "用过的配方"：真正做出来才算（关闭配方开关时它会留在列表里）
        this.usedRecipeIds.add(product.id);
        this.inventory.notify();
      }
      this.refresh();
      return;
    }

    // 批次 160：产物**直接进背包**，不再挂到光标上。
    //
    // 用户的场景是"把材料摆进工作台 → 点产物"：这时想要的不是"手上多一叠再找地方放"，
    // 而是"做好就收起来"。`Inventory.addStack` 的填充顺序就是**快捷栏 → 主仓库**
    // （`AUTO_FILL_SLOTS` 按槽位下标走，0-8 是快捷栏、9-35 是主仓库）；
    // 两边都满了就丢在脚边——与"背包放不下"的处理一致（`onDrop` = 主程序那边造掉落物）。
    // 附加数据一起交出去：不然"合出来一枚蓝色烟花"到背包里会变成金色
    const taken: ItemStack = { id: product.id, count: product.count, ...stackExtras(product) };
    if (!grid.takeResult()) return;
    this.usedRecipeIds.add(product.id);
    const leftover = this.inventory.addStack(taken);
    if (leftover > 0) this.hooks.onDrop?.(taken.id, leftover);
    this.inventory.notify();
    this.refresh();
  }

  /**
   * 关界面 / 点面板外：把手上的东西与合成格里的残留还给背包。
   *
   * ⚠️ 批次 181：背包满了不能再把东西留在光标上（那就是"物品飘在屏幕外、
   * 跟手但没有归属"的来源）。放不下就按原版掉在玩家脚边。
   */
  private returnHeldToInventory(): void {
    if (this.held) {
      const stack = this.held;
      const leftover = this.inventory.add(stack.id, stack.count);
      if (leftover > 0) this.hooks.onDrop?.(stack.id, leftover);
      this.held = null;
      this.touchOrigin = null;
    }
    for (const grid of Object.values(this.grids)) grid.drainTo(this.inventory);
    this.refresh();
  }

  // ---------------------------------------------------------------- 显示

  get isOpen(): boolean {
    return this.open;
  }

  get currentMode(): InventoryPanelMode {
    return this.mode;
  }

  /**
   * 配方书开合之后重排左栏（批次 157）。
   *
   * 配方书是主程序开的（界面只提供落脚点），开完要回头告诉界面一声，
   * 界面才能把左栏从"我的物品"换成"配方列表"。
   */
  syncRecipePane(): void {
    if (this.open) this.applyInventoryChrome();
  }

  /** 打开为指定模式；容器模式必须传入容器实例 */
  openWith(mode: InventoryPanelMode, container?: BlockContainer): void {
    // 换面板（背包 → 箱子 → 工作台……）时把没结算完的"选数量"收掉：
    // 上半部分的槽位会被重建，留着它等于让一个已经不在屏幕上的格子继续吃手势
    this.endSplit();
    // 批次 295：离开上一个容器前先解除"选配方暂停"，否则炉子会永远冻住
    this.releaseStationPause();
    // 换面板时右栏的"待预览配方"也作废（批次 272）：它只属于刚才那一屏
    this.pendingRecipeId = null;
    this.stationTargetEntry = null;
    this.stationTargetOwner = null;
    this.stationFilledResultId = null;
    this.furnaceStarted = false;
    this.stationAutoCollect = false;
    this.stationBrewSnapshot = null;
    this.stationOrigins.clear();
    this.selectedStationKey = null;
    if (this.mode !== mode || this.activeContainer !== container) {
      // 换面板 = 上一个容器"关掉了"（陷阱箱据此撤信号，批次 249）
      if (this.open) this.hooks.onPanelClosed?.();
      for (const grid of Object.values(this.grids)) grid.drainTo(this.inventory);
      this.mode = mode;
      this.activeContainer = container ?? null;
      // 批次 311（用户）：创造模式下工作模块只留仓库，不摊分类/搜索；
      // 生存模式有配方表的工作站默认左栏仍是物品分类。
      if (isWorkstationMode(mode)) {
        const creativePlayer = this.hooks.isCreative?.() ?? false;
        this.pane = !creativePlayer && this.stationHasRecipes(mode) ? 'category' : 'items';
        this.categoryPage = 0;
        this.stationRecipeStamp = '';
        this.clearStationHint();
      }
      // 打开别的界面就不再"与这个村民交易"了（他是一个实体，不是容器）
      this.activeVillager = null;
      this.rebuildTopArea();
    }

    // 批次 313：close() 会把 activeContainer.onChange 清空；同一个容器重开时
    // 上面的 if 不会进来，必须在这里无条件重新挂上，否则炉子还在烧、界面进度不动。
    if (this.activeContainer) {
      this.activeContainer.onChange = () => {
        this.containerDirty = true;
      };
      this.containerDirty = true;
    }

    // 批次 312：熔炉产物默认留在产物槽；打开界面不再自动收进背包
    // 批次 299：每次打开工作站都先暂停（同容器重开也要），完全改成"点目标框才开始"
    if (isWorkstationMode(mode)) this.pauseStationContainer();
    // 打开时只有本来就在烧的炉子算"已开工"；否则必须重新点目标
    this.furnaceStarted =
      this.activeContainer instanceof Furnace &&
      (this.activeContainer.burnTimeLeft > 0 || this.activeContainer.cookProgress > 0);

    this.titleEl.textContent = MODE_TITLES[mode];
    // 每次从快捷栏打开玩家背包：落到「物品栏」页（Wiki 左下箱子），左栏是"我的物品"
    if (mode === 'inventory') {
      this.pocketTab = 'inventory';
      // 创造模式默认回到"无限物品"，生存回到"个人仓库"
      this.pane = (this.hooks.isCreative?.() ?? false) ? 'creative' : 'items';
    }
    // 打开背包 / 工作台前先收掉可能还挂着的配方书面板（批次 206）。
    // 以前只在 `inventory` 分支收，从配方书直接去开工作台时会留下"多一层浮层"。
    if (mode === 'inventory' || mode === 'crafting') this.hooks.onCloseRecipes?.();
    this.applyInventoryChrome();
    this.openPanel();
    // 基岩版工作台默认把左侧那一片摊开。必须等背包先 open，
    // 否则主程序的 openRecipeBook 会把模式改回普通 inventory。
    // 批次 164：**创造模式的工作台不用摊开配方分类**——它就是拿来合成的。
    // 生存模式才按基岩版把左侧摊成"按分类找东西"。
    if (mode === 'crafting' && !(this.hooks.isCreative?.() ?? false)) this.openPocketCategory('all');
  }

  toggle(): void {
    if (this.open && this.mode === 'inventory') this.close();
    else this.openWith('inventory');
  }

  openPanel(): void {
    // 批次 185：关闭动画（400ms）还没走完又要打开——例如快速点两下背包、
    // 或者程序在关掉背包的同时打开箱子。原来 `open` 还是 true，这里直接 return，
    // 随后 `finishClose` 把面板藏起来，结果是"界面打开了但屏幕上看不见"。
    if (this.closing) {
      this.closing = false;
      if (this.closeTimer !== null) {
        window.clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      this.panel.classList.remove('panel-out');
      this.open = false;
    }
    if (this.open) return;
    diag.event('inventory', 'open', {
      mode: this.mode,
      creative: this.hooks.isCreative?.() ?? false,
      leftPane: this.pane,
    });
    this.closing = false;
    this.open = true;
    this.root.classList.remove('hidden');
    // 重新触发底部滑入（关掉再开时 animation 不会自动重跑）
    this.panel.classList.remove('panel-out');
    this.panel.style.animation = 'none';
    void this.panel.offsetWidth;
    this.panel.style.animation = '';
    this.applyInventoryChrome();
    this.refresh();
    this.hooks.onOpenChange?.(true);
  }

  /**
   * 把一条配方**摆进合成格**（批次 132，对齐原版）。
   *
   * 原版配方书点一条配方做的事就是这个：材料从背包挪进格子、摆法看得见、还能自己改，
   * 最后由输出格取成品。摆的是**当前正显示的那个格子**（背包里 2×2、工作台前 3×3），
   * 所以站在工作台前时 2×2 的配方会摆到 3×3 的左上角——与原版一致。
   *
   * @returns 摆成功了没（材料不够 / 这条配方放不进当前格子 → false，界面上一动不动）
   */
  fillFromRecipe(recipe: Recipe): boolean {
    if (!fillCraftingGrid(this.inventory, this.crafting, recipe)) return false;
    this.refresh();
    // 配方书"摆进合成格"也是一次搬运（批次 138）：材料确实从背包挪到了格子
    this.hooks.onMove?.();
    return true;
  }

  /**
   * 自动恢复用：把面板淡到几乎看不见，但**副作用一条不少**（批次 214）。
   *
   * 为什么不是"换成一块透明 div"（批次 208 试过，失败）：真机日志证明，
   * "全屏面板出现又消失"能修好 Android 把触摸坐标报成 0,0 的毛病；
   * 而那块透明 div（透明背景 + `opacity:.01` + 无子节点）根本没被绘制，
   * 浏览器的坐标映射也就不会重算。所以要留的是**真的画出来的这一层**：
   * 保留 `body.inv-pocket-open`、面板的布局/子节点/滑入滑出动画与 DOM 重建，
   * 只把最终像素压到 0.4%（肉眼看不出来，但 `opacity ≠ 1` 仍会单独合成、仍然绘制）。
   *
   * ⚠️ 只在**自动恢复**里用；正常打开背包必须先把 ghost 摘掉，
   * 所以 `finishClose()` / `dispose()` 都会强制清掉这个类。
   */
  /**
   * 关界面时把**合成格里的残留**还给背包（批次 132，对齐原版）。
   *
   * 原版规则：关掉物品栏时，合成格里的东西自动回到背包，背包满了就掉到地上。
   * 我们这条路径上**没有"掉到地上"**（那要主程序知道玩家站在哪、朝向哪），
   * 所以放不下的那几格**留在格子里**——宁可玩家下次打开还看见它，
   * 也不能让它凭空消失。工作台/箱子那些界面由各自的容器负责，这里只动玩家自己的格子。
   */
  private returnCraftingToInventory(): void {
    const grid = this.grids[2];
    for (let index = 0; index < grid.size * grid.size; index++) {
      const stack = grid.get(index);
      if (!stack) continue;
      if (this.inventory.addStack(stack) > 0) continue;
      grid.set(index, null);
    }
  }

  close(): void {
    this.clearTouchPress();
    // 关界面 = 这一屏的"待预览配方"随之作废（批次 272）
    this.pendingRecipeId = null;
    // 批次 295：解除"选配方暂停"，否则关掉界面后炉子不再工作
    this.releaseStationPause();
    this.stationTargetEntry = null;
    this.stationTargetOwner = null;
    this.stationFilledResultId = null;
    this.furnaceStarted = false;
    this.stationAutoCollect = false;
    this.stationBrewSnapshot = null;
    this.stationOrigins.clear();
    this.selectedStationKey = null;
    if (!this.open || this.closing) return;
    this.hooks.onPanelClosed?.();
    // 携带版合成页的配方书是背包的左半页，不是独立窗口。
    // 直接点右上角关闭时必须一起收起，否则背包滑走后会留下一个孤立的配方面板。
    this.hooks.onCloseRecipes?.();
    this.returnHeldToInventory();
    this.returnCraftingToInventory();
    if (this.activeContainer) this.activeContainer.onChange = null;
    // 交易界面关掉之后不再抓着这个村民（他下一秒可能就走进怪堆里死了）
    this.activeVillager = null;
    this.touchOrigin = null;
    // 底部滑出（批次 142，对齐基岩版「屏幕动画」）；减弱动效时直接关
    const reduce =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !this.panel.isConnected) {
      this.finishClose();
      return;
    }
    this.closing = true;
    this.panel.classList.remove('panel-in-restart');
    this.panel.classList.add('panel-out');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.panel.removeEventListener('animationend', finish);
      if (this.closeTimer !== null) {
        window.clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      // 关闭被取消（`openPanel` 里重新打开）→ 不能再把面板藏起来
      if (!this.closing) return;
      this.panel.classList.remove('panel-out');
      this.finishClose();
    };
    this.panel.addEventListener('animationend', finish);
    this.closeTimer = window.setTimeout(finish, 400);
  }

  private finishClose(): void {
    diag.event('inventory', 'close', {
      mode: this.mode,
      held: this.held?.id ?? null,
      heldCount: this.held?.count ?? 0,
    });
    this.closing = false;
    this.open = false;
    this.root.classList.add('hidden');
    document.body.classList.remove('inv-pocket-open');
    // 配方书是从背包左栏借来的位置，背包关了就得还回去
    this.detachRecipeBook();
    this.hidePickToast();
    this.clearCraftGhost();
    this.markPressing(null);
    this.categoryScrub = null;
    this.lastLeftPane = '';
    this.restoreInvTabToRail();
    this.hooks.onOpenChange?.(false);
  }

  /** 容器内容变化后的节流刷新（由主循环调用） */
  tickUi(dt: number): void {
    if (!this.open) return;
    // 批次 314：炉子正在烧时即使 onDirty 漏了，也按 0.1s 主动刷新进度条/火焰，
    // 彻底避免"后台在烧、界面静止"。
    const runningFurnace =
      isFurnaceMode(this.mode) &&
      this.activeContainer instanceof Furnace &&
      !this.activeContainer.paused &&
      (this.activeContainer.burnTimeLeft > 0 || this.activeContainer.cookProgress > 0);
    if (!this.containerDirty && !runningFurnace) return;
    this.containerRefreshTimer += dt;
    if (this.containerRefreshTimer < CONTAINER_REFRESH_INTERVAL) return;
    this.containerRefreshTimer = 0;
    this.containerDirty = false;
    this.refresh();
  }

  refresh(): void {
    // 批次 307：自动收货会在 refresh 内 notify；重入会让进度/选中状态互相覆盖
    if (this.refreshing) {
      this.refreshPending = true;
      return;
    }
    this.refreshing = true;
    try {
      // 批次 295：点过目标框的炉子，产物一出来就直接收进背包（快捷栏 → 仓库 → 脚边）
      this.collectStationOutput();
    for (const [key, binding] of this.bindings) {
      if (/^(furnace|smithing|brewing):/.test(key)) binding.element.classList.remove('ghost-missing');
    }
    for (const binding of this.bindings.values()) {
      this.renderInto(binding.element, binding.source.get(binding.index));
      if (binding.takeOnly) binding.element.classList.add('take-only');
    }

    if (this.mode === 'inventory' || this.mode === 'crafting') {
      // 真实结果优先；只有"缺料预览"时才把预览产物画进结果槽（批次 206）
      const real = this.crafting.result;
      const result = real ?? (this.craftGhost ? this.previewResult : null);
      this.renderInto(this.resultElement, result ? { id: result.id, count: result.count } : null);
      this.resultElement.classList.toggle('ready', real !== null);
      // 预览产物是只读的：与真实产物不同的底色，避免玩家以为点了能拿
      this.resultElement.classList.toggle('preview-result', real === null && result !== null);
      this.resultElement.classList.add('take-only');
      // 批次 185：箭头上面那颗"要工作台/要熔炉"的小图标
      this.syncCraftStation();
    }

    if (isFurnaceMode(this.mode) && this.activeContainer instanceof Furnace) {
      const furnace = this.activeContainer;
      const flameFill = this.flameEl.firstElementChild as HTMLElement | null;
      if (flameFill) flameFill.style.height = `${Math.round(furnace.burnRatio * 100)}%`;
      this.flameEl.classList.toggle('lit', furnace.isLit);
      this.cookFillEl.style.width = `${Math.round(furnace.cookRatio * 100)}%`;
      // 原料槽里放的是"这座炉子不做的东西"时说明原因（烟熏炉里放石头、高炉里放沙子…）
      const reason = furnace.rejectReason;
      this.furnaceHintEl.textContent = reason;
      this.furnaceHintEl.classList.toggle('bad', reason !== '');
      const hasItems = [FURNACE_INPUT, FURNACE_FUEL, FURNACE_OUTPUT].some((slot) => furnace.get(slot));
      this.furnaceReturnBtn.classList.toggle('hidden', !hasItems);
      this.refreshFurnaceFuelHint(furnace);
      // 目标框不因槽位空而清掉：配方保留，材料不足时变红（批次 300）
      if (!this.stationTargetEntry) this.syncStationTargetFromSlots();
      this.renderStationTarget();
    }

    if (this.mode === 'campfire' && this.activeContainer instanceof Campfire) {
      const campfire = this.activeContainer;
      for (let i = 0; i < CAMPFIRE_SIZE; i++) {
        this.campfireFills[i]!.style.width = `${Math.round(campfire.ratio(i) * 100)}%`;
      }
      // 提示只显示"第一条有意见的"：一列 4 条同样的抱怨没有意义
      let reason = '';
      for (let i = 0; i < CAMPFIRE_SIZE && reason === ''; i++) reason = campfire.rejectReason(i);
      if (reason === '' && !campfire.lit) reason = '营火熄灭了（拿打火石右键可以重新点燃）';
      this.campfireHintEl.textContent = reason;
      this.campfireHintEl.classList.toggle('bad', reason !== '');
      // 目标框保留，材料不足时变红
      if (!this.stationTargetEntry) this.syncStationTargetFromSlots();
      this.renderStationTarget();
    }

    if (this.mode === 'brewing' && this.activeContainer instanceof BrewingStand) {
      const stand = this.activeContainer;
      this.brewProgressEl.style.width = `${Math.round(stand.brewRatio * 100)}%`;
      // 燃料库存必须显示出来：烈焰粉是 1 份 20 次，"还剩 17 次"与"还剩 3 次"对玩家是两件事
      const left = stand.fuelRemaining;
      this.brewFuelTextEl.textContent = left > 0 ? `还能酿 ${left} 次` : '需要烈焰粉';
      this.brewFuelTextEl.classList.toggle('bad', left <= 0);
      // 目标框保留，材料不足时变红
      if (!this.stationTargetEntry) this.syncStationTargetFromSlots();
      this.renderStationTarget();
    }

    if (this.mode === 'hopper' && this.activeContainer instanceof Hopper) {
      // 锁定时必须写出来：原版是"漏斗自己不动"，玩家看不到任何别的反馈，
      // 只会以为漏斗坏了（这是 H14 第一批必踩的困惑）
      const locked = this.activeContainer.locked;
      this.hopperHintEl.textContent = locked
        ? '被红石信号锁定：不推也不吸（断开信号就继续）'
        : '每 0.4 秒搬一件：推给朝向那一格，再从头顶的容器或掉落物吸一件';
      this.hopperHintEl.classList.toggle('bad', locked);
    }

    if (this.mode === 'dropper' && this.activeContainer instanceof Dropper) {
      // 空投掷器必须明说：玩家拿红石试半天，看不出"是空的"还是"坏了"
      const facing = SIX_FACING_NAMES[this.activeContainer.facing];
      this.nineHintEl.textContent = this.activeContainer.isEmpty
        ? `${facing}吐 · 里面是空的：红石脉冲不会吐任何东西`
        : `${facing}吐：每来一次红石**脉冲**（拉杆两次、按钮、红石钟）吐一件；对面是容器就塞进去，不是容器就掉在地上`;
      this.nineHintEl.classList.toggle('bad', this.activeContainer.isEmpty);
    }

    if (this.mode === 'dispenser' && this.activeContainer instanceof Dispenser) {
      // 发射器的提示要说清"哪几件会被用掉"：混装时玩家根本猜不到下一件是射出去还是掉地上
      const facing = SIX_FACING_NAMES[this.activeContainer.facing];
      if (this.activeContainer.isEmpty) {
        this.nineHintEl.textContent = `${facing}用 · 里面是空的：红石脉冲不会做任何事`;
        this.nineHintEl.classList.add('bad');
      } else {
        let recognized = 0;
        for (let i = 0; i < DROPPER_SIZE; i++) {
          const stack = this.activeContainer.get(i);
          if (stack && dispenseBehaviorFor(stack.id)) recognized++;
        }
        const head = `${facing}用：每来一次红石脉冲用掉一件`;
        this.nineHintEl.textContent =
          recognized > 0
            ? `${head}——里面 ${recognized} 格是它认得的（会射出去/砸出去/点燃/剪毛），其余当掉落物吐出去`
            : `${head}——这一箱它一样都不认得，全都当掉落物吐出去（${DEFAULT_DISPENSE_CN}）`;
        this.nineHintEl.classList.remove('bad');
      }
    }

    if (this.mode === 'enchanting') this.refreshEnchantOptions();
    if (this.mode === 'anvil') this.refreshAnvil();
    if (this.mode === 'grindstone') this.refreshGrindstone();
    if (this.mode === 'smithing') {
      this.refreshSmithing();
      this.renderStationTarget();
    }
    if (this.mode === 'stonecutter') this.refreshStonecutter();
    if (this.mode === 'trade') this.refreshTrade();
    // 批次 295：红底配方缺的那几件画成红底预览
    this.renderStationGhost();

    // 批次 159：手上那叠**画回来源格**并让底色变深（= 选中），
    // 不再画一个跟着光标飘的图标（触摸端没有 pointermove，那块图标会停在左上角）。
    // ⚠️ 交换时刻意**保留**同一个来源格：换过来的那件正好出现在你第一次点的那一格里，
    //   于是"先点第一个再点第二个 = 两格换位"看起来就是真的换了位。
    if (!this.held) {
      this.heldOriginEl = null;
      this.heldFromCreative = false;
    } else if (this.heldOriginEl && !this.heldOriginEl.isConnected) this.heldOriginEl = null;
    // 材料不齐时把配方"画"进合成格（预览，不是实物）
    if (this.craftGhost) this.renderCraftGhost();
    if (this.selectedEl && this.selectedEl !== this.heldOriginEl) {
      this.selectedEl.classList.remove('selected');
      this.selectedEl = null;
    }
    // 熔炉原料/燃料的选中态：刷新重绘后补回来（物品本身不动）
    if (this.held) this.selectedStationKey = null;
    if (this.selectedStationKey) {
      const selected = this.bindings.get(this.selectedStationKey);
      if (selected) {
        selected.element.classList.add('selected');
        this.selectedEl = selected.element;
      } else {
        this.selectedStationKey = null;
      }
    }
    if (this.held && this.heldOriginEl) {
      this.renderInto(this.heldOriginEl, this.held);
      this.heldOriginEl.classList.add('selected');
      this.selectedEl = this.heldOriginEl;
      this.heldElement.classList.remove('on');
      this.heldCount.textContent = '';
    } else if (this.held) {
      // 兜底：来源格自己还留着东西（右键取半数）时没法"就地表示"，仍用跟着光标那一块
      drawItemIcon(this.heldCanvas, this.atlas, this.held.id, 32);
      this.heldElement.classList.add('on');
      this.heldCount.textContent = this.held.count > 1 ? String(this.held.count) : '';
    } else {
      this.heldElement.classList.remove('on');
      this.heldCount.textContent = '';
    }

    // 飞行开关可能在背包开着时切换（F / 触摸起飞）——创造区要跟着显隐
    this.applyInventoryChrome();
    this.refreshPlayerPreview();
    // 工作站左栏的"可做列表"（批次 277）：模式/材料/槽位变化后重算
    this.renderStationRecipes();
    } finally {
      this.refreshing = false;
      if (this.refreshPending) {
        this.refreshPending = false;
        this.refresh();
      }
    }
  }

  /** 供主程序 / 验收：当前携带版页签（经典 UI 下也会返回上次值，但不影响布局） */
  get currentPocketTab(): PocketInventoryTab {
    return this.pocketTab;
  }

  /**
   * 重画预览（批次 141 的 2D 剪影 → 批次 185 的 3D 小人）。
   *
   * 先试 WebGL：一块 canvas 拿到 2d 上下文之后就再也拿不到 webgl，
   * 所以**不能**先画 2D 再升级——失败才退回剪影。
   */
  private refreshPlayerPreview(): void {
    const armorIds = [0, 1, 2, 3].map((offset) => this.inventory.get(ARMOR_START + offset)?.id ?? null);
    if (!this.preview3d && !this.preview3dFailed) {
      try {
        this.preview3d = new PlayerPreview3D(this.playerPreviewEl);
      } catch {
        this.preview3dFailed = true;
      }
    }
    const palette = this.hooks.appearance?.() ?? paletteOf(null);
    if (this.preview3d) {
      const colors = armorIds.map((id) =>
        id === null ? null : this.atlas.averageColor(itemIconTile(id)),
      );
      this.preview3d.update(
        colors,
        this.hooks.isCapeVisible?.() ?? false,
        // 批次 275：传物品 id，而不是"有没有东西"——只有盾牌会画成盾牌
        this.inventory.get(OFFHAND_SLOT)?.id ?? null,
        palette,
      );
      return;
    }
    drawPlayerPreview(
      this.playerPreviewEl,
      {
        helmet: armorIds[0],
        chest: armorIds[1],
        legs: armorIds[2],
        boots: armorIds[3],
      },
      this.atlas,
      48,
      palette,
    );
  }

  /** 指针底下的槽位当前是什么物品 */
  private tooltipFor(element: HTMLElement): ItemTooltip | null {
    // 正在长按选数量时不弹提示框（批次 137）：那个手势的反馈是**指示条**，
    // 再糊一块提示框上去会正好盖住玩家要看的那个数字
    if (this.split) return null;
    const stack = this.tooltipStacks.get(element);
    if (!stack) return null;
    return itemTooltip(stack.id, stack.count, stack.damage, stack.enchants, stack.name ?? stack.title);
  }

  /**
   * 点物品时把说明浮在快捷栏上方几秒（批次 159）。
   *
   * 手机上只有**长按 600ms** 才有提示框，轻点一下什么都没有——而轻点才是触摸端的主手势。
   * 悬停那条路在触摸端永远不成立（手指没有 hover），所以补这条"点击即弹"。
   * 位置锚在快捷栏上方：那里是屏幕上唯一一块不会挡住格子、又必然在视线里的地方。
   */
  private showPickToast(slot: HTMLElement): void {
    const stack = this.tooltipStacks.get(slot);
    if (!stack) return;
    const data = itemTooltip(stack.id, stack.count, stack.damage, stack.enchants, stack.name ?? stack.title);

    this.pickToastEl.textContent = '';
    const title = document.createElement('div');
    title.className = `tooltip-title ${rarityClassName(data.rarity)}`;
    title.textContent = data.count > 1 ? `${data.title} ×${data.count}` : data.title;
    this.pickToastEl.appendChild(title);
    // 说明为空就退回副标题（英文 id），总比一块只剩名字的浮层好
    const line = data.description.length > 0 ? data.description : data.subtitle;
    if (line.length > 0) {
      const description = document.createElement('div');
      description.className = 'tooltip-desc';
      description.textContent = line;
      this.pickToastEl.appendChild(description);
    }
    this.pickToastEl.classList.remove('hidden', 'leaving');
    this.placePickToast();
    window.clearTimeout(this.pickToastTimer);
    window.clearTimeout(this.pickToastFadeTimer);
    this.pickToastTimer = window.setTimeout(() => this.hidePickToast(), PICK_TOAST_MS);
  }

  /** 点燃料时在快捷栏上方显示它的介绍（批次 307） */
  private showFuelToast(itemId: number): void {
    const seconds = fuelSeconds(itemId);
    if (seconds <= 0) return;
    this.pickToastEl.textContent = '';
    const title = document.createElement('div');
    title.className = 'tooltip-title';
    title.textContent = itemLabel(itemId);
    const description = document.createElement('div');
    description.className = 'tooltip-desc';
    const items = Math.max(1, Math.floor(seconds / 10));
    description.textContent = `燃料 · 可燃烧 ${seconds} 秒（普通熔炉约 ${items} 个）`;
    this.pickToastEl.append(title, description);
    this.pickToastEl.classList.remove('hidden', 'leaving');
    this.placePickToast();
    window.clearTimeout(this.pickToastTimer);
    window.clearTimeout(this.pickToastFadeTimer);
    this.pickToastTimer = window.setTimeout(() => this.hidePickToast(), PICK_TOAST_MS);
  }

  /** 一条纯文字提示（丢弃、模式切换等）：复用同一块浮层与位置 */
  private showMessage(text: string): void {
    this.pickToastEl.textContent = '';
    const line = document.createElement('div');
    line.className = 'tooltip-title';
    line.textContent = text;
    this.pickToastEl.appendChild(line);
    this.pickToastEl.classList.remove('hidden', 'leaving');
    this.placePickToast();
    window.clearTimeout(this.pickToastTimer);
    window.clearTimeout(this.pickToastFadeTimer);
    this.pickToastTimer = window.setTimeout(() => this.hidePickToast(), PICK_TOAST_MS);
  }

  /** 说明浮层锚在快捷栏上沿（携带版 dock 在屏幕底；容器界面用面板内那一排） */
  private placePickToast(): void {
    if (this.pickToastEl.classList.contains('hidden')) return;
    const dockVisible = !this.hotbarDock.classList.contains('hidden');
    const anchor = dockVisible ? this.hotbarDock : this.hotbarGridEl;
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // 还没布局出来
    const height = this.pickToastEl.offsetHeight;
    const top = Math.max(6, rect.top - height - 10);
    // 夹在视口里：贴边的说明会有一半被切掉
    const half = Math.min(this.pickToastEl.offsetWidth / 2, 160);
    const left = Math.min(Math.max(rect.left + rect.width / 2, half + 6), window.innerWidth - half - 6);
    this.pickToastEl.style.top = `${Math.round(top)}px`;
    this.pickToastEl.style.left = `${Math.round(left)}px`;
  }

  /**
   * 给某一格加"按下去"的样子（批次 159），传 `null` 收掉。
   *
   * 触摸端一次轻点要到抬手才结算（要跟长按区分），所以**光靠 `.selected` 会慢半拍**；
   * 按下这一刻先沉一下，抬手时真正的选中（或什么都没发生）再接上。
   */
  private markPressing(slot: HTMLElement | null): void {
    if (this.pressingEl && this.pressingEl !== slot) this.pressingEl.classList.remove('pressing');
    this.pressingEl = slot;
    slot?.classList.add('pressing');
  }

  /**
   * 红底（我没有的）那一格的点击反馈（批次 184）。
   *
   * 它**不能选中**，所以没有 `.selected`；但也不能"点了完全没反应"——
   * 用户要求"点击应该只触发点击效果，响应配方及物品名称"。名称那条由
   * `showPickToast` 负责、配方由 `pickCategoryItem → showRecipeFor` 负责，
   * 这里只补 220ms 的缩放，和 `:active` 差不多的手感。
   */
  private flashLocked(slot: HTMLElement): void {
    slot.classList.remove('tapped');
    // 强制重排：连点同一格时动画要能重跑
    void slot.offsetWidth;
    slot.classList.add('tapped');
    window.setTimeout(() => slot.classList.remove('tapped'), 260);
  }

  /** 收起说明浮层（超时 / 关界面）：先淡出 200ms 再挂 hidden */
  private hidePickToast(immediate = false): void {
    window.clearTimeout(this.pickToastTimer);
    this.pickToastTimer = 0;
    if (this.pickToastEl.classList.contains('hidden')) return;
    if (immediate) {
      // 玩家自己点了提示：**立刻**收掉，别再走 200ms 淡出
      window.clearTimeout(this.pickToastFadeTimer);
      this.pickToastEl.classList.add('hidden');
      this.pickToastEl.classList.remove('leaving');
      return;
    }
    this.pickToastEl.classList.add('leaving');
    window.clearTimeout(this.pickToastFadeTimer);
    this.pickToastFadeTimer = window.setTimeout(() => {
      this.pickToastEl.classList.add('hidden');
      this.pickToastEl.classList.remove('leaving');
    }, 200);
  }

  /**
   * 取铁砧产物。
   *
   * 手上已经有同类物品时并上去（省得玩家先放下再捡），否则直接放到光标上。
   * 任何一步不满足都只提示、不改动东西——「扣了等级又没拿到东西」是最恼人的 bug。
   */
  private handleAnvilTake(): void {
    const anvil = this.activeContainer;
    if (!(anvil instanceof Anvil)) return;
    const context = this.hooks.anvilContext?.();
    if (!context) return;

    const preview = anvil.get(ANVIL_RESULT);
    if (!preview) return;
    if (this.held && (this.held.id !== preview.id || this.held.count + preview.count > maxStackOf(preview.id))) {
      this.rejectSlot(this.anvilResultSlot);
      return;
    }

    const result = anvil.take(context.playerLevel, context.consumeLevels);
    if (!result.ok) {
      this.anvilStatusEl.textContent = result.reason;
      this.anvilStatusEl.classList.add('bad');
      this.refresh();
      return;
    }
    this.held = this.held ? { id: this.held.id, count: this.held.count + result.output.count } : result.output;
    this.anvilStatusEl.textContent = `花费 ${result.cost} 级`;
    this.anvilStatusEl.classList.remove('bad');
    this.refresh();
  }

  /**
   * 取走砂轮的产物（H15，批次 188）。
   *
   * 与铁砧的差别有两条：**不查等级、不扣等级**（砂轮不要经验），
   * 以及**返还经验**（被洗掉的附魔折算成经验点，交给主程序变成经验球）。
   * 手上拿着别的东西时直接拒绝：砂轮的产物几乎都是装备，叠不上去。
   */
  private handleGrindstoneTake(): void {
    const grindstone = this.activeContainer;
    if (!(grindstone instanceof Grindstone)) return;
    const preview = grindstone.get(GRINDSTONE_RESULT);
    if (!preview) return;
    if (this.held) {
      this.rejectSlot(this.grindstoneResultSlot);
      return;
    }

    const result = grindstone.take();
    if (!result.ok) {
      this.grindstoneStatusEl.textContent = result.reason;
      this.grindstoneStatusEl.classList.add('bad');
      this.refresh();
      return;
    }
    this.held = result.output;
    if (result.xp > 0) this.hooks.onGrindstoneXp?.(result.xp);
    this.grindstoneStatusEl.textContent = result.xp > 0 ? `洗掉附魔，返还 ${result.xp} 点经验` : '已取出';
    this.grindstoneStatusEl.classList.remove('bad');
    this.refresh();
  }

  /**
   * 刷新砂轮的提示行（产物能不能拼、能返多少经验）。
   */
  private refreshGrindstone(): void {
    const grindstone = this.activeContainer;
    if (!(grindstone instanceof Grindstone)) return;
    const outcome = grindstone.outcome;
    this.grindstoneResultSlot.classList.toggle('ready', outcome !== null);
    this.grindstoneHintEl.textContent = grindstoneHint(grindstone.left, grindstone.right);
    this.grindstoneHintEl.classList.toggle('bad', outcome === null);
  }

  /**
   * 取走锻造台的产物（K8 尾巴）。
   *
   * 与铁砧的差别：**不查等级、不扣等级**（原版锻造台不要经验），
   * 只扣材料（左格整件 + 右格 1 个锭）。手上已经有同类物品时并上去，否则放到光标上。
   */
  private handleSmithingTake(): void {
    const table = this.activeContainer;
    if (!(table instanceof SmithingTable)) return;
    const preview = table.get(SMITHING_RESULT);
    if (!preview) return;
    // 产物永远不可堆叠（工具/盔甲），所以手上拿着任何东西都不能直接取
    if (this.held) {
      this.rejectSlot(this.stationTargetEl);
      return;
    }

    const result = table.take();
    if (!result.ok) {
      this.smithingHintEl.textContent = result.reason;
      this.smithingHintEl.classList.add('bad');
      this.refresh();
      return;
    }
    this.held = result.output;
    this.smithingHintEl.textContent = '升级完成：附魔与耐久损耗都保留';
    this.smithingHintEl.classList.remove('bad');
    this.refresh();
  }

  /**
   * 刷新切石机：把"这个输入能切出什么"渲染成一列按钮（H11，批次 44）。
   *
   * ⚠️ 按钮**只在输入格的物品 id 变化时重建**（`stonecutterInputId` 记着上一次的值）。
   * `refresh()` 会被背包/容器的每次变化触发，如果每次都重建 DOM，
   * 触摸端"点一下"很容易落在刚被替换掉的那个按钮上——点了没反应，看起来像卡了。
   */
  /**
   * 打开某个村民的交易界面（J11）。
   *
   * 与 `openWith` 分开写的原因：交易**不需要容器**（点一条直接从背包结算），
   * 所以这里只记一个 `activeVillager`，而不是往 `activeContainer` 里塞一个假容器
   * ——假容器会被存档那一层当成"这一格有东西"。
   */
  openTrade(villager: Villager): void {
    if (this.mode !== 'trade' || this.activeVillager !== villager) {
      for (const grid of Object.values(this.grids)) grid.drainTo(this.inventory);
      this.mode = 'trade';
      this.activeContainer = null;
      this.activeVillager = villager;
      this.rebuildTopArea();
    }
    this.titleEl.textContent = MODE_TITLES.trade;
    this.applyInventoryChrome();
    this.openPanel();
  }

  /**
   * 刷新交易列表（J11）。
   *
   * 两段：
   *  1. **指纹变了**（换村民 / 认领了职业 / 升级）→ 重建按钮与图标；
   *  2. 每次都做 → 更新"剩余次数"与"材料够不够"的文字与禁用状态。
   *
   * 这样"背包一变就刷新"不会把手指底下的按钮换掉（切石机那批的教训）。
   */
  private refreshTrade(): void {
    const villager = this.activeVillager;
    if (!villager) return;

    const fingerprint = `${villager.id}:${villager.professionId ?? '-'}:${villager.level}`;
    if (fingerprint !== this.tradeFingerprint) {
      this.tradeFingerprint = fingerprint;
      this.tradeListEl.replaceChildren();
      this.tradeRows.length = 0;

      if (villager.offers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'trade-note';
        empty.textContent = '他还没有工作——在他附近放一个工作站（堆肥桶 / 高炉 / 烟熏炉 / 酿造台 / 切石机 / 木桶 / 锻造台），他过几秒就会认领。';
        this.tradeListEl.appendChild(empty);
      }

      for (let index = 0; index < villager.offers.length; index++) {
        const offer = villager.offers[index]!;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'stonecutter-option trade-option';
        button.addEventListener('click', () => this.handleTradeClick(index));

        // 左半：他收的东西（1~2 样，逐样一个小图标 + 数量）
        const costs = document.createElement('span');
        costs.className = 'trade-cost';
        for (const cost of offer.cost) {
          const canvas = document.createElement('canvas');
          canvas.width = 24;
          canvas.height = 24;
          drawItemIcon(canvas, this.atlas, cost.id, 24);
          const label = document.createElement('span');
          label.textContent = `×${cost.count}`;
          costs.append(canvas, label);
        }

        const arrow = document.createElement('span');
        arrow.className = 'trade-arrow';
        arrow.textContent = '→';

        // 右半：他给的东西
        const gain = document.createElement('span');
        gain.className = 'trade-gain';
        const gainCanvas = document.createElement('canvas');
        gainCanvas.width = 24;
        gainCanvas.height = 24;
        drawItemIcon(gainCanvas, this.atlas, offer.result.id, 24);
        const gainLabel = document.createElement('span');
        gainLabel.textContent =
          offer.result.count > 1 ? `${itemLabel(offer.result.id)} ×${offer.result.count}` : itemLabel(offer.result.id);
        gain.append(gainCanvas, gainLabel);

        const uses = document.createElement('span');
        uses.className = 'trade-uses';
        const note = document.createElement('span');
        note.className = 'trade-note';

        button.append(costs, arrow, gain, uses, note);
        // 悬停提示：产物那一段显示它是什么（与背包槽位共用同一套 tooltip）
        button.dataset.tooltip = '';
        this.tooltipStacks.set(button, { id: offer.result.id, count: offer.result.count });
        this.tradeListEl.appendChild(button);
        this.tradeRows.push({ uses, note });
      }
    }

    // ---- 每次都更新：剩余次数 / 能不能做
    for (let index = 0; index < villager.offers.length; index++) {
      const offer = villager.offers[index]!;
      const row = this.tradeRows[index];
      const button = this.tradeListEl.children[index] as HTMLElement | undefined;
      if (!row || !button) continue;
      const blocker = tradeBlocker(offer, this.inventory);
      row.uses.textContent = `${offer.maxUses - offer.uses} / ${offer.maxUses}`;
      row.note.textContent = blocker ?? '';
      button.classList.toggle('blocked', blocker !== null);
      // 用 aria-disabled 而不是 disabled：禁用的按钮收不到悬停提示，
      // 而"为什么这条不能点"正是玩家最需要看到的东西
      button.setAttribute('aria-disabled', blocker !== null ? 'true' : 'false');
    }

    // ---- 左侧：职业与等级
    const profession = villager.profession;
    const progress = villager.tradeXpProgress;
    this.tradeLevelEl.replaceChildren();
    const who = document.createElement('div');
    who.className = 'trade-who';
    who.textContent = profession ? `${profession.name} · ${levelName(villager.level)}` : '无业游民';
    const xp = document.createElement('div');
    xp.className = 'trade-xp';
    xp.textContent =
      profession === null
        ? '认领一个工作站就能开始做生意'
        : progress.next === 0
          ? `交易经验 ${villager.tradeXp}（已经是大师）`
          : `交易经验 ${villager.tradeXp}（再 ${progress.next - progress.current} 点升级）`;
    this.tradeLevelEl.append(who, xp);
  }

  /** 点某一条交易：界面只做"能不能点"的即时反馈，成交由主程序执行 */
  private handleTradeClick(index: number): void {
    const villager = this.activeVillager;
    if (!villager) return;
    // 手上拿着东西时先拒绝（与切石机同一条：产物会与光标上的东西打架）
    if (this.held) {
      this.rejectSlot(this.tradeListEl);
      return;
    }
    const offer = villager.offers[index];
    if (!offer) return;
    const blocker = tradeBlocker(offer, this.inventory);
    if (blocker) {
      this.tradeHintEl.textContent = blocker;
      this.tradeHintEl.classList.add('bad');
      return;
    }
    this.tradeHintEl.textContent = '';
    this.tradeHintEl.classList.remove('bad');
    this.hooks.onTrade?.(villager, index);
    this.refresh();
  }

  private refreshStonecutter(): void {
    const cutter = this.activeContainer;
    if (!(cutter instanceof Stonecutter)) return;

    const input = cutter.input;
    const inputId = input?.id ?? -1;
    if (inputId !== this.stonecutterInputId) {
      this.stonecutterInputId = inputId;
      this.stonecutterListEl.replaceChildren();
      for (const offer of cutter.offers) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'stonecutter-option';
        const canvas = document.createElement('canvas');
        canvas.width = 28;
        canvas.height = 28;
        drawItemIcon(canvas, this.atlas, offer.output, 28);
        const label = document.createElement('span');
        label.textContent = offer.count > 1 ? `${itemLabel(offer.output)} ×${offer.count}` : itemLabel(offer.output);
        button.append(canvas, label);
        button.title = `1 个${itemLabel(inputId)} → ${offer.count} 个${itemLabel(offer.output)}`;
        button.addEventListener('click', () => this.handleStonecutterCut(offer.output));
        this.stonecutterListEl.appendChild(button);
        // 让产物按钮也有悬停提示（与背包槽位共用同一套：`Tooltip.delegate` 只认
        // 带 `data-tooltip` 的元素，所以这个属性必须设上，否则表里塞了数据也没人查）
        button.dataset.tooltip = '';
        this.tooltipStacks.set(button, { id: offer.output, count: offer.count });
      }
    }

    const hint = this.stonecutterHintEl;
    hint.classList.remove('bad');
    if (!input) {
      hint.textContent = '放进石料（石头 / 砂岩 / 深板岩 / 石英 / 铜块…）后会列出能切的东西';
      return;
    }
    if (cutter.offers.length === 0) {
      hint.textContent = `${itemLabel(input.id)} 切不出任何石头变体`;
      hint.classList.add('bad');
      return;
    }
    hint.textContent = `每次消耗 1 个${itemLabel(input.id)}（现有 ${input.count} 个）`;
  }

  /** 点某一项：切一件出来直接进背包（原版也是直接进背包，不用先拿到光标上） */
  private handleStonecutterCut(outputId: number): void {
    const cutter = this.activeContainer;
    if (!(cutter instanceof Stonecutter)) return;
    const offer = cutter.offers.find((candidate) => candidate.output === outputId);
    if (!offer) return;
    // 手上拿着东西时先拒绝：否则"背包满 → 产物落到光标 → 把手上的东西顶掉"会丢东西
    if (this.held) {
      this.rejectSlot(this.stonecutterListEl);
      return;
    }

    const result = cutter.cut(outputId);
    if (!result.ok) {
      this.stonecutterHintEl.textContent = result.reason;
      this.stonecutterHintEl.classList.add('bad');
      return;
    }
    // 背包放不下就放到光标上（`add` 返回没塞进去的数量，不会静默吞掉产物）
    const leftover = this.inventory.add(result.output.id, result.output.count);
    if (leftover > 0) this.held = { id: result.output.id, count: leftover };
    this.stonecutterHintEl.textContent = `切出 ${offer.count} 个${itemLabel(offer.output)}`;
    this.stonecutterHintEl.classList.remove('bad');
    this.refresh();
  }

  /** 刷新锻造台的提示行：没产物时解释为什么，有产物时把代价说清楚 */
  private refreshSmithing(): void {
    const table = this.activeContainer;
    if (!(table instanceof SmithingTable)) return;
    const outcome = table.outcome;
    if (outcome) {
      this.smithingHintEl.textContent = `消耗 ${outcome.cost} 个下界合金锭（不要经验）`;
      this.smithingHintEl.classList.remove('bad');
      return;
    }
    this.smithingHintEl.textContent = smithingHint(table.equipment, table.material);
    this.smithingHintEl.classList.add('bad');
  }

  /**
   * 刷新铁砧的代价与提示。
   * 代价里**含"积累惩罚"**，所以要顺手把它显示出来——不然玩家只会觉得"怎么越来越贵"。
   */
  private refreshAnvil(): void {
    const anvil = this.activeContainer;
    if (!(anvil instanceof Anvil)) return;
    const context = this.hooks.anvilContext?.();
    if (!context) return;

    const outcome = anvil.outcome;
    this.anvilResultSlot.classList.toggle('ready', outcome !== null);
    if (!outcome) {
      this.anvilCostEl.textContent = anvilHint(anvil.left, anvil.right, anvil.name);
      this.anvilCostEl.classList.add('bad');
      return;
    }
    const penalty = (anvil.left?.repairCost ?? 0) + (anvil.right?.repairCost ?? 0);
    this.anvilCostEl.textContent =
      `需要 ${outcome.cost} 级（你 ${context.playerLevel} 级）${repairCostLabel(penalty)}`;
    this.anvilCostEl.classList.toggle('bad', context.playerLevel < outcome.cost);
  }

  /** 点第 slot 个候选：校验 → 扣等级与青金石 → 附魔 */
  private handleEnchantClick(slot: number): void {
    const table = this.activeContainer;
    if (!(table instanceof EnchantTable)) return;
    const context = this.hooks.enchantContext?.();
    if (!context) return;

    const result = table.applySlot(slot, context.playerLevel, context.consumeLevels);
    this.enchantStatusEl.textContent = result.ok ? `已附上 ${optionLabel(result.enchants)}` : result.reason;
    this.enchantStatusEl.classList.toggle('bad', !result.ok);
    this.refresh();
  }

  /**
   * 重掷候选槽并刷新三个按钮。
   * 掷点放在容器里（`EnchantTable.refresh`）而不是这里：切换模式会重建上半区，
   * 状态留在界面里会被丢掉；只有"局面指纹"变了才重掷，否则每帧刷新都会换一批附魔。
   */
  private refreshEnchantOptions(): void {
    const table = this.activeContainer;
    if (!(table instanceof EnchantTable)) return;
    const context = this.hooks.enchantContext?.();
    if (!context) return;

    table.refresh(context.playerLevel, context.bookshelfPower, Math.random);

    for (let slot = 0; slot < this.enchantButtons.length; slot++) {
      const button = this.enchantButtons[slot]!;
      const option: EnchantOption | undefined = table.options[slot];
      const check = table.checkSlot(slot, context.playerLevel);
      const cost = option?.cost ?? 0;
      const label = option && option.enchants.length > 0 ? optionLabel(option.enchants) : '—';
      button.textContent = cost > 0 ? `${label}　${cost} 级` : label;
      button.classList.toggle('on', check.ok);
      button.title = check.ok ? `消耗 ${cost} 级经验与 ${option!.lapis} 个青金石` : check.reason;
      button.disabled = !check.ok;
    }
  }

  private renderInto(element: HTMLElement, stack: ItemStack | null): void {
    const canvas = element.querySelector('canvas') as HTMLCanvasElement;
    const count = element.querySelector('.inv-count') as HTMLSpanElement;
    // 空槽的"头/胸/腿/靴/副"提示字靠这个类名隐藏（有东西时就不该再显示）
    element.classList.toggle('has-item', stack !== null);
    if (stack) {
      drawItemIcon(canvas, this.atlas, stack.id);
      canvas.style.visibility = 'visible';
      count.textContent = stack.count > 1 ? String(stack.count) : '';
      // 悬停提示交给托管的 Tooltip（浏览器自带的 title 只有一行、手机上还弹不出来）
      this.tooltipStacks.set(element, stack);
    } else {
      canvas.style.visibility = 'hidden';
      count.textContent = '';
      this.tooltipStacks.delete(element);
    }
    updateDurabilityBar(element.querySelector('.dur-bar'), stack);
  }

  dispose(): void {
    // 批次 295：销毁前解除容器暂停，避免这个世界的炉子/酿造台永远冻住
    this.releaseStationPause();
    // 退出世界时面板可能正拿着东西：先结算（放回背包 / 掉脚边），再拆 DOM。
    // 不结算的话，那一叠会随着界面一起消失——这是最不该发生的"凭空丢东西"。
    if (this.held || this.open) this.returnHeldToInventory();
    this.listeners.abort();
    window.clearTimeout(this.pickToastTimer);
    this.pickToastTimer = 0;
    window.clearTimeout(this.pickToastFadeTimer);
    this.pickToastFadeTimer = 0;
    this.inventory.onChange = null;
    for (const grid of Object.values(this.grids)) grid.onChange = null;
    // 3D 预览有自己的 WebGL 上下文：拆局时要主动释放（上下文数量有上限）
    this.preview3d?.dispose();
    this.preview3d = null;
    this.previewDrag = null;
    this.root.remove();
    // 面板开着时退出世界：body 上那个"背包打开"的类也要一起摘掉，
    // 否则主菜单会继承一套背包布局约束
    document.body.classList.remove('inv-pocket-open');
  }
}

/** 三种炉子共用一套布局（格子、火焰、进度条完全一样，见 `rebuildTopArea`） */
function isFurnaceMode(mode: InventoryPanelMode): boolean {
  return mode === 'furnace' || mode === 'smoker' || mode === 'blast_furnace';
}

const MODE_TITLES: Record<InventoryPanelMode, string> = {
  inventory: '物品栏',
  crafting: '工作台',
  furnace: '熔炉',
  smoker: '烟熏炉',
  blast_furnace: '高炉',
  campfire: '营火',
  chest: '箱子',
  barrel: '木桶',
  ender_chest: '末影箱',
  shulker_box: '潜影盒',
  enchanting: '附魔台',
  anvil: '铁砧',
  grindstone: '砂轮',
  smithing: '锻造台',
  stonecutter: '切石机',
  brewing: '酿造台',
  hopper: '漏斗',
  trade: '与村民交易',
  dropper: '投掷器',
  dispenser: '发射器',
};

/** 创造物品栏的搜索匹配：中文名、英文 id、数字 id 都认 */
function matchesQuery(itemId: number, query: string): boolean {
  const lower = query.toLowerCase();
  if (itemLabel(itemId).includes(query)) return true;
  if (itemName(itemId).toLowerCase().includes(lower)) return true;
  return String(itemId) === query;
}

/** 数字键 / F：把 `KeyboardEvent` 归一成 `CursorActions.slotForKey` 认的键（批次 128） */
function swapKeyOf(event: KeyboardEvent): string | null {
  if (event.code === 'KeyF') return 'f';
  if (event.code.startsWith('Digit')) {
    const digit = event.code.slice('Digit'.length);
    if (digit >= '1' && digit <= '9') return digit;
  }
  return null;
}
