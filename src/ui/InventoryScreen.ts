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
import {
  ARMOR_SIZE,
  ARMOR_START,
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
import type { Recipe } from '../core/crafting/Recipes.ts';
// 配方的**摆放位置**（批次 29）：左栏点一件物品要把它怎么摆画进合成格
import { recipeLayout } from '../core/crafting/RecipeLayout.ts';
// 快速移动（批次 127）：Shift+左键的规则是纯逻辑（`core/container/QuickMove.ts`），
// 界面只负责把"哪一格 / 开着哪个容器 / 容器多少格"交给它
import { PLAYER_FILL_ORDER, fitCount, quickMove } from '../core/container/QuickMove.ts';
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
import { FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT, Furnace } from '../core/container/Furnace.ts';
import { UI_HINT_UNIMPLEMENTED, optionLabel, type EnchantOption } from '../core/crafting/Enchanting.ts';
import {
  BREW_BOTTLE_SLOTS,
  BREW_FUEL_SLOT,
  BREW_INGREDIENT_SLOT,
  BrewingStand,
} from '../core/container/BrewingStand.ts';
import type { BlockContainer } from '../core/world/BlockEntityStore.ts';
import {
  CREATIVE_ITEMS,
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

export interface InventoryScreenHooks {
  onOpenChange?: (open: boolean) => void;
  /**
   * 打开配方书（背包标题栏 / 携带版左上分类图标）。
   * @param tab 携带版点某个分类图标时带上，配方书直接切到那一栏
   */
  onOpenRecipes?: (tab?: RecipeBookTab) => void;
  /** 关掉配方书（携带版离开合成页时） */
  onCloseRecipes?: () => void;
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
export const PICK_TOAST_MS = 3500;

/** 携带版物品栏的三个内容页（批次 140；Wiki「携带版 UI」） */
export type PocketInventoryTab = 'crafting' | 'armor' | 'inventory';

/**
 * 双栏壳里**左栏**现在显示哪一份内容（批次 157 → 159）。
 *
 * 三份内容占的是同一个网格格子（同样的位置、同样的尺寸），切换只换内容——
 * 这是"点左边按钮时界面不该跳"的落点。
 *
 * - `items`    ：我的物品（3×9 仓库）
 * - `category` ：**物品分类**（批次 159 的重点）——左栏的主要职责是"按分类找东西"，
 *   不是"看配方"。默认只列出**我拥有的**；配方开关打开时把该分类下的**所有物品**
 *   都列出来，我没有的那些用红底标出（用来找"不知道怎么组装"的东西）。
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
  /** 分类物品网格 */
  private categoryGrid!: HTMLDivElement;
  /** 分类物品那一栏的搜索框（只在"全部"那一栏出现） */
  private categorySearch!: HTMLInputElement;
  private categoryPrev!: HTMLButtonElement;
  private categoryNext!: HTMLButtonElement;
  private categoryPageLabel!: HTMLSpanElement;
  private categoryPager!: HTMLDivElement;
  /** 左栏当前是"我的物品"还是"物品分类" */
  private leftPaneKind: 'items' | 'category' = 'items';
  /** 当前分类（全部 / 建筑 / 装备 / 物品 / 自然） */
  private categoryTab: RecipeBookTab = 'all';
  private categoryQuery = '';
  private categoryPage = 0;
  /** 分类栏上一次渲染的指纹（没变就不重建，见 `renderCategoryGrid`） */
  private categoryStamp = '';
  /** 创造栏上一次渲染的指纹（内容只跟分类 / 搜索词 / 页码有关，见 `renderCreativeGrid`） */
  private creativeStamp = '';
  /**
   * 「把所有物品都列出来」（批次 159）：开着 = 该分类下的**所有**物品都出现，
   * 我没有的那些用红底标出——为的是"找一件不知道怎么组装的东西"。
   * 关着 = 只列我拥有的，这就是"物品分类"本身的能力。
   */
  private showUnowned = false;
  /**
   * 材料不齐时把配方"画"进合成格（批次 159）：格子里是**预览**不是实物，
   * 缺的那件用红底标出来。点任何合成格就收掉。
   */
  private craftGhost: Array<{ id: number; have: boolean } | null> | null = null;
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
  /** 创造分类条的父节点（挪到左轨后要能归还） */
  private creativeControls!: HTMLDivElement;
  /** 盔甲页标题（Wiki「盔甲」） */
  private readonly armorTitleEl: HTMLDivElement;
  /**
   * 携带版**右栏**当前显示什么（批次 140 → 157）。
   * 左栏见 `leftPane`：`items` / `creative` / `recipes` 三选一。
   */
  private pocketTab: PocketInventoryTab = 'crafting';
  /** 上一次排布时左栏显示的是哪一份（用来判断要不要给淡入） */
  private lastLeftPane: PocketLeftPane | '' = '';
  /** 上一次排布时右栏是不是"合成"（盔甲 ↔ 合成切换才淡入） */
  private lastRightCrafting = true;
  /**
   * 创造模式里正在看「生存背包」而不是创造物品网格（批次 142）。
   * 基岩版创造栏与生存栏是两套界面，用按钮互切。
   */
  private creativeSurvival = false;
  /** 创造 ↔ 生存背包 的切换按钮 */
  private creativeToggleBtn: HTMLButtonElement | null = null;
  /** 关闭键：触摸层挂上之后文案要从「关闭 (E)」改成 ✕ */
  private closeBtn: HTMLButtonElement | null = null;
  /** 关面板动画进行中，避免连点重复结算 */
  private closing = false;
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
  private readonly furnaceOutputSlot: HTMLDivElement;
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
  private readonly cookFillEl: HTMLElement;

  /** 锻造台（K8 尾巴）：装备格 + 材料格 + 产物格 + 提示行 */
  private readonly smithingLayout: HTMLDivElement;
  private readonly smithingEquipmentSlot: HTMLDivElement;
  private readonly smithingMaterialSlot: HTMLDivElement;
  private readonly smithingResultSlot: HTMLDivElement;
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
  private creativeDestroySlot!: HTMLDivElement;
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
      this.creativeSurvival = !this.creativeSurvival;
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
      // 批次 159：它有两态，但**不再切换分类**——
      //   左栏还在"我的物品"时：点它 = 打开上次那个分类（沿用 `lastRecipeTab`）；
      //   左栏已经是某个分类时：点它 = 切"是否显示自己没有的那些"。
      //     开着（active）→ 本分类全部列出，不拥有的用红底标出来；
      //     关着       → 只显示自己拥有的（红的自然就不见了）。
      // 原来的写法是"关 = 退回我的物品 + 切回全部"，分类白选了，所以改成这样。
      recipes.addEventListener('click', () => {
        // 左栏已经在某一分类里 → 切"要不要把我没有的那些也列出来（红底）"
        if (this.leftPaneKind === 'category') {
          this.showUnowned = !this.showUnowned;
          this.categoryPage = 0;
        } else {
          // 左栏还在"我的物品" → 进入分类视图，沿用上次那一栏（不切分类）
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
    this.furnaceOutputSlot = this.createSlot();
    this.furnaceFuelSlot.dataset.key = 'furnace:fuel';
    this.furnaceInputSlot.dataset.key = 'furnace:input';
    this.furnaceOutputSlot.dataset.key = 'furnace:output';
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

    // 锻造台（K8 尾巴）：装备格 + 材料格 + 产物格（比铁砧少一个改名输入框）
    this.smithingLayout = document.createElement('div');
    this.smithingLayout.className = 'anvil-layout';
    this.smithingEquipmentSlot = this.createSlot();
    this.smithingEquipmentSlot.dataset.key = 'smithing:equipment';
    this.smithingMaterialSlot = this.createSlot();
    this.smithingMaterialSlot.dataset.key = 'smithing:material';
    this.smithingResultSlot = this.createSlot();
    this.smithingResultSlot.dataset.key = 'smithing:result';
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
    this.pocketSideEl.append(
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

    this.creativeSection = document.createElement('div');
    this.creativeSection.className = 'inv-creative-section';
    this.buildCreativeSection();
    // 携带版统一双栏：左栏在“玩家物品 / 创造物品”之间切换，右栏始终是合成或装备。
    // 放进 playerBody 才能与 mainColumn / gear 共用同一套两栏网格。
    this.playerBody.append(this.creativeSection, this.categoryHostEl);

    // 顺序：左轨（配方+箱子）| 灰框 | 右轨（合成/盔甲）——页签在 panel 外
    this.shellEl.append(this.railLeft, this.panel, this.railRight, this.pocketTabsEl);
    this.root.append(this.shellEl, this.hotbarDock);

    // 转屏会改视口尺寸（面板宽高里有 100vw/100dvh）：重排一次把尺寸对齐
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.applyPocketLayout());
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
    const hints = ['头', '胸', '腿', '靴', '副'];
    for (let i = 0; i < ARMOR_SIZE + 1; i++) {
      const index = ARMOR_START + i;
      const slot = this.registerSlot(`inv:${index}`, this.inventory, index);
      const hint = document.createElement('span');
      hint.className = 'inv-slot-hint';
      hint.textContent = hints[i]!;
      slot.appendChild(hint);
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
        if (this.creativeSurvival) {
          this.creativeSurvival = false;
          this.applyInventoryChrome();
        }
        this.updateTabHighlight();
        this.renderCreativeGrid();
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

    // 销毁格（批次 139，对齐创造 HCI）：把手上的东西清掉，而不是丢进世界。
    // 左键整叠、右键一个——与点界面外丢物的按键分工一致，只是结果是「没了」。
    const destroyRow = document.createElement('div');
    destroyRow.className = 'inv-creative-destroy-row';
    this.creativeDestroySlot = this.createSlot();
    this.creativeDestroySlot.classList.add('creative-destroy');
    this.creativeDestroySlot.dataset.role = 'creative-destroy';
    this.creativeDestroySlot.title = '销毁（左键整叠 / 右键一个）';
    const destroyHint = document.createElement('span');
    destroyHint.className = 'inv-slot-hint';
    destroyHint.textContent = '销';
    this.creativeDestroySlot.appendChild(destroyHint);
    this.creativeDestroySlot.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.destroyHeld(event.button === 2 ? 1 : null);
    });
    destroyRow.appendChild(this.creativeDestroySlot);

    this.creativeSection.append(header, this.creativeControls, this.creativeGrid, this.creativePager, destroyRow);
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
    this.categorySearch.placeholder = '搜索物品…';
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

    this.categoryHostEl.append(this.categorySearch, this.categoryGrid, this.categoryPager);
  }

  /**
   * 分类栏里的物品：按分类 + 搜索词筛。
   *
   * ⚠️ "我拥有的"这一路是**从背包格子本身**取的，不是"在全部物品里挑我有多少"：
   *    只要有一件东西不在 `CREATIVE_ITEMS` 里（特殊物品、旧 id），后一种写法就会
   *    把它悄悄漏掉——玩家看到的就是"我明明有，分类里却没有"。
   */
  private categoryItems(): number[] {
    const query = this.categoryQuery;
    const byCategory = (id: number): boolean => {
      if (this.categoryTab !== 'all' && recipeBookTab(id) !== this.categoryTab) return false;
      if (query.length > 0 && !matchesQuery(id, query)) return false;
      return true;
    };
    if (this.showUnowned) return CREATIVE_ITEMS.filter(byCategory);
    return this.ownedItemIds().filter(byCategory);
  }

  /** 背包里出现过的物品 id（去重；按槽位 0-40 的顺序，快捷栏在前） */
  private ownedItemIds(): number[] {
    const owned: number[] = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = this.inventory.get(i);
      if (!stack || owned.includes(stack.id)) continue;
      owned.push(stack.id);
    }
    return owned;
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
      this.categoryTab,
      this.categoryQuery,
      this.showUnowned ? 'all' : 'owned',
      this.categoryPage,
      this.inventoryStamp(),
    ].join('|');
    // ⚠️ 不因为"手上有东西"就整栏冻住：宁可重建完再按 id 把选中那一格找回来。
    //    冻住的话，一旦某次渲染结果是空的（比如刚合成完、背包一时为空），
    //    这一栏就会**一直空着**——那正是"合成一次就全空了"的来源。
    if (key === this.categoryStamp && this.categoryGrid.childElementCount > 0) return;
    this.categoryStamp = key;

    // 搜索框只在"全部"那一栏出现（与创造栏、配方书同一口径）
    this.categorySearch.style.display = this.categoryTab === 'all' ? '' : 'none';
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
    for (const itemId of visible) {
      const owned = this.inventory.countOf(itemId);
      const slot = this.createSlot();
      slot.classList.add('category-slot');
      // 取消选中 / 换选之后要能按 id 找回这一格（重建会把元素换掉）
      slot.dataset.itemId = String(itemId);
      if (owned <= 0) slot.classList.add('locked');
      // 提示框（悬停 / 长按）与"点击弹说明"都靠这份数据
      this.tooltipStacks.set(slot, { id: itemId, count: owned > 0 ? owned : 1 });
      drawItemIcon(slot.querySelector('canvas')!, this.atlas, itemId, 28);
      const count = slot.querySelector('.inv-count') as HTMLSpanElement | null;
      if (count && owned > 1) count.textContent = String(owned);
      slot.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.pickCategoryItem(itemId);
      });
      fragment.appendChild(slot);
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      // 空列表要说清"为什么空"：是这一栏本来就没有，还是筛掉了。
      // 顺带把"背包里一共有几件不同的东西"报出来——这一栏被弄成过"永远空"，
      // 有这行数字就能一眼分清"背包空"还是"过滤坏了"。
      empty.textContent = this.showUnowned
        ? '这一栏里没有匹配的物品'
        : `这一栏里你还没有东西（背包里共 ${this.ownedItemIds().length} 件不同的东西 · 打开配方按钮可以看全部）`;
      fragment.appendChild(empty);
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
   * 点分类里的一件物品（批次 159）。
   *
   * ① 说明一律弹在快捷栏上方（那条由委托的 `showPickToast` 负责，固定位置）；
   * ② 右栏在合成状态时，把这件东西的**配方**摆出来——可组装就以它为目标，
   *    材料够就直接摆进合成格；不够就把配方**画**进合成格，缺的那件红底。
   */
  private pickCategoryItem(itemId: number): void {
    // ① **再点同一件 = 取消选中**（批次 159 补）；点另一件 = 先把手上那叠放回去再选新的。
    //    ⚠️ 取消/放回会让分类栏重建，所以格子元素要按 id **重新找**，不能沿用旧引用。
    if (this.held) {
      const same =
        this.heldOriginEl !== null &&
        this.heldOriginEl.dataset.itemId === String(itemId) &&
        this.categoryGrid.contains(this.heldOriginEl);
      this.cancelHeldSelection();
      if (same || this.held) return; // 同一格：取消就结束；放不下：也别继续
    }
    // ② **选中**：红底那种"我没有的"选不了。
    //    选中的就是这一格——之后点窗口外丢弃、点可放置处放置、点别的物品栏换位。
    const owned = this.inventory.countOf(itemId);
    if (owned > 0) {
      const index = this.inventory.find(itemId);
      const stack = index >= 0 ? this.inventory.get(index) : null;
      if (stack) {
        this.held = stack;
        this.inventory.set(index, null);
        // notify 会触发一次 refresh：那时 held 已经在了，分类栏被冻结、元素不会被换掉
        this.inventory.notify();
        // 记来源：点窗口外是丢弃，点不可放置区域是原位退回
        this.touchOrigin = { source: this.inventory, index, itemId };
        this.heldFromCreative = false;
        this.heldOriginEl =
          this.categoryGrid.querySelector<HTMLElement>(`.category-slot[data-item-id="${itemId}"]`) ?? null;
      }
    }
    // ③ 右栏在合成 → 把这件东西"由什么组成"摆出来
    this.showRecipeFor(itemId);
    this.refresh();
  }

  /** 把一件东西的配方摆进右栏的合成格（材料够就摆实物，不够就画出来、缺的红底） */
  private showRecipeFor(itemId: number): void {
    if (this.pocketTab !== 'crafting') return;
    const recipe = recipesForResult(itemId)[0];
    this.clearCraftGhost();
    if (!recipe || recipeGridSize(recipe) > this.crafting.size) return;
    if (canCraft(this.inventory, recipe).ok) {
      fillCraftingGrid(this.inventory, this.crafting, recipe);
      return;
    }
    this.showRecipeGhost(recipe);
  }

  /** 材料不齐：把配方"画"进合成格（缺的红底），让人一眼看出差什么 */
  private showRecipeGhost(recipe: Recipe): void {
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
    this.refresh();
  }

  private clearCraftGhost(): void {
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
        // 左下箱子只切左栏：生存时从"物品分类"回到玩家物品，创造时在无限物品与玩家物品间切换。
        if (this.mode === 'inventory' && (this.hooks.isCreative?.() ?? false)) {
          this.creativeSurvival = true;
        }
        // 批次 159：左栏回到"我的物品"（分类视图是玩家自己点开的，这里就是退出它）
        this.leftPaneKind = 'items';
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
    this.pocketTab = tab;
    this.applyInventoryChrome();
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
    if (this.leftPaneKind === 'category') this.leftPaneKind = 'items';
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
    this.pocketTab = 'crafting';
    this.categoryTab = tab;
    this.categoryPage = 0;
    this.lastRecipeTab = tab;
    this.leftPaneKind = 'category';
    // ⚠️ 换到不显示搜索框的分类时清掉搜索词：否则那是个**看不见的过滤器**，
    //    列表会一直空着，而玩家已经没有输入框可以取消它（"分类栏怎么全空了"）。
    if (tab !== 'all') {
      this.categoryQuery = '';
      this.categorySearch.value = '';
    }
    this.applyInventoryChrome();
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
    //   `creative` = 当前这一屏是不是"创造物品栏"（只有玩家背包那一屏有）。
    // 批次 164：原来只按 `creative` 判，于是创造模式的工作台里配方分类又冒出来了。
    const creativePlayer = this.hooks.isCreative?.() ?? false;
    const creative = this.mode === 'inventory' && creativePlayer;
    if (!creative) this.creativeSurvival = false;
    // 创造模式没有"按分类看配方"这件事（入口全藏了），左栏只可能是物品
    if (creativePlayer) this.leftPaneKind = 'items';
    const showCreativeItems = creative && !this.creativeSurvival;
    // 玩家背包与世界里的工作台共用同一副双栏壳；其余（箱子/熔炉/铁砧…）走单栏
    const workbench = this.mode === 'crafting';
    const dual = this.mode === 'inventory' || workbench;

    this.panel.classList.toggle('workbench-ui', workbench);
    if (this.creativeToggleBtn) {
      this.creativeToggleBtn.classList.toggle('hidden', !creative || dual);
      this.creativeToggleBtn.textContent = this.creativeSurvival ? '创造物品' : '生存背包';
    }

    // —— 容器类界面：单栏通用面板，页签 / 左右轨 / 配方书落脚点都不参与 ——
    if (!dual) {
      this.panel.classList.remove('pocket-ui', 'pocket-dual');
      this.panel.classList.remove('creative-ui');
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
      this.panel.dataset.pocketTab = '';
      this.placeHotbar(false);
      this.syncPocketBodyClass(false);
      this.syncCraftArrow(false);
      this.restoreInvTabToRail();
      // 容器界面照旧给这颗按钮；创造模式下不要（同一口径，见下面那条注释）
      if (this.recipesBtn) this.recipesBtn.classList.toggle('hidden', creativePlayer);
      this.lastLeftPane = '';
      return;
    }

    // —— 双栏壳 ——
    if (this.pocketTab === 'inventory') this.pocketTab = 'crafting';
    if (workbench) this.pocketTab = 'crafting';

    // 左栏三选一：**位置与尺寸完全一致**（同一个网格格子），换的只是内容。
    // ⚠️ 批次 159：左栏的主要职责是**物品分类**（`category`），配方书不再嵌进来
    // ——"配方"只是分类栏上"要不要把我没有的也列出来"那一颗开关。
    const leftPane: PocketLeftPane =
      showCreativeItems ? 'creative' : this.leftPaneKind === 'category' ? 'category' : 'items';

    this.panel.classList.add('pocket-ui', 'pocket-dual');
    this.panel.classList.toggle('creative-ui', showCreativeItems);
    this.panel.dataset.pocketLeft = leftPane;
    this.panel.dataset.pocketTab = this.pocketTab;
    this.shellEl.classList.add('pocket-chrome');
    this.pocketTabsEl.classList.remove('hidden');
    this.playerBody.style.display = '';

    this.creativeSection.style.display = leftPane === 'creative' ? '' : 'none';
    this.categoryHostEl.style.display = leftPane === 'category' ? 'flex' : 'none';
    if (leftPane === 'category') this.renderCategoryGrid();
    // 批次 159：左栏是物品分类时，右栏只留合成区——合成区**下方那片 3×9 仓库不显示**
    //（分类栏已经把"我有什么"列出来了）。工作台界面例外：它本来就是 3×3 + 3×9 的排法。
    const hideMainGrid = leftPane === 'creative' || (leftPane === 'category' && !workbench);
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

    // 生存左轨是物品分类 + 箱子；创造左轨复用创造物品分类
    this.syncCreativeRails(leftPane === 'creative');
    if (leftPane !== 'creative') {
      // 批次 163：创造模式下**连左轨那排配方分类也不给**——与标题栏那颗按钮同一口径。
      // 创造模式左栏是无限物品（或"生存背包"），配方书在这儿没有意义。
      this.pocketRecipeBar.classList.toggle('hidden', !this.hooks.onOpenRecipes || creativePlayer);
      this.railLeft.classList.remove('hidden');
      // 批次 159：点亮当前分类（点了哪一颗要看得出来）
      this.syncRecipeRail(leftPane === 'category' ? this.categoryTab : null);
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
    }

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
    if (arrow) arrow.textContent = vertical ? '↓' : '→';
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

  /**
   * 销毁光标上的物品（创造销毁格）。
   * @param count 要销几个；`null` = 整叠
   */
  private destroyHeld(count: number | null): void {
    if (!this.held) return;
    if (count === null || count >= this.held.count) this.held = null;
    else this.held = { ...this.held, count: this.held.count - count };
    this.hooks.onMove?.();
    this.refresh();
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
    this.clearBindings('craft:');
    this.clearBindings('furnace:');
    this.clearBindings('chest:');
    this.clearBindings('barrel:');
    this.clearBindings('ender_chest:');
    this.clearBindings('shulker_box:');
    this.clearBindings('enchant:');
    this.clearBindings('anvil:');
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
      const output = this.registerExisting(
        this.furnaceOutputSlot,
        'furnace:output',
        this.activeContainer!,
        FURNACE_OUTPUT,
        true,
      );

      const left = document.createElement('div');
      left.className = 'furnace-col';
      left.append(input, this.flameEl, fuel);

      const middle = document.createElement('div');
      middle.className = 'furnace-middle';
      middle.appendChild(this.cookTrackElement());

      // 烟熏炉/高炉要写清"它只吃什么"：原版靠玩家自己知道，我们的界面里直接说明，
      // 免得玩家把石头塞进烟熏炉、看着它不动以为是坏了
      this.furnaceHintEl.textContent = '';
      const right = document.createElement('div');
      right.className = 'furnace-col';
      right.append(this.buildLabel('产物'), output, this.furnaceHintEl);

      this.furnaceLayout.replaceChildren(left, middle, right);
      this.topArea.appendChild(this.furnaceLayout);
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
      side.append(this.buildLabel('放上最多 4 样食物（烤好会自己弹出来）'), this.campfireHintEl);
      // 复用"左一块右一列"那条布局（与切石机同一套样式，窄屏会自动上下堆叠）
      const layout = document.createElement('div');
      layout.className = 'stonecutter-layout';
      layout.append(this.campfireLayout, side);
      this.topArea.appendChild(layout);
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

      const middle = document.createElement('div');
      middle.className = 'brewing-middle';
      const track = document.createElement('div');
      track.className = 'furnace-cook';
      track.appendChild(this.brewProgressEl);
      middle.append(track, this.brewFuelTextEl);

      this.brewingLayout.replaceChildren(bottleCol, middle, materialCol, fuelCol);
      this.topArea.appendChild(this.brewingLayout);
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

    if (this.mode === 'smithing') {
      const table = this.activeContainer instanceof SmithingTable ? this.activeContainer : null;
      const equipment = this.registerExisting(this.smithingEquipmentSlot, 'smithing:equipment', table!, SMITHING_EQUIPMENT);
      const material = this.registerExisting(this.smithingMaterialSlot, 'smithing:material', table!, SMITHING_MATERIAL);
      // 产物槽：只能取不能放（与铁砧一样，产物是两格算出来的）
      const result = this.registerExisting(this.smithingResultSlot, 'smithing:result', table!, SMITHING_RESULT, true);
      this.smithingHintEl.textContent = '';

      const row = document.createElement('div');
      row.className = 'anvil-row';
      row.append(
        this.buildLabel('钻石装备'),
        equipment,
        this.buildLabel('下界合金锭'),
        material,
        this.buildLabel('产物'),
        result,
      );
      const side = document.createElement('div');
      side.className = 'anvil-side';
      side.append(this.smithingHintEl);
      this.smithingLayout.replaceChildren(row, side);
      this.topArea.appendChild(this.smithingLayout);
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
    arrow.textContent = '→';

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
    document.addEventListener('pointermove', (event) => {
      if (!this.open) return;
      this.heldElement.style.left = `${event.clientX}px`;
      this.heldElement.style.top = `${event.clientY}px`;
    });

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
        // 合成格里那套是"配方预览"（材料不齐时画的）：一碰就收掉，换成真实内容
        if (this.craftGhost && slot?.closest('.inv-craft')) this.clearCraftGhost();
        if (slot) {
          this.showPickToast(slot);
          // 批次 159：**按下就沉下去**。触摸端一次轻点要到 `pointerup` 才结算
          //（要跟长按区分），等结算完再给反馈就成了"点了要等一下才选中"。
          // ⚠️ 空槽不给：空槽本来就不可选中，给它"沉下去"会让人以为选中了。
          if (this.tooltipStacks.has(slot)) this.markPressing(slot);
        }
      },
      true,
    );
    // 抬手 / 取消就摘掉"按下去"那一层：真正的选中（`.selected`）由刷新接着接上
    for (const type of ['pointerup', 'pointercancel'] as const) {
      document.addEventListener(type, () => this.markPressing(null));
    }

    // 松手：把这一趟拖过的槽位结算掉（批次 128）
    document.addEventListener('pointerup', () => {
      const button = this.dragButton;
      const slots = this.dragSlots;
      this.dragButton = null;
      this.dragSlots = [];
      // 只经过起点那一格 = 普通点击，已经由 `pointerdown` 处理过了
      if (button === null || slots.length <= 1) return;
      this.held = button === 0 ? distributeEvenly(this.held, slots) : placeOneEach(this.held, slots);
      this.refresh();
    });

    // 点面板里的非槽位区域 = 取消当前选取，不移动任何物品。
    // “窗口外”仍由下面 root 的监听处理为丢弃；两块区域的语义必须分开。
    this.panel.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      if (!this.held) return;
      if (target.closest('.inv-slot, button, input, .recipe-cell')) return;
      event.preventDefault();
      event.stopPropagation();
      this.cancelHeldSelection();
    });

    // 点界面外：**把手上的东西丢进世界**（批次 128，对齐原版；
    // 原来是"放回背包"，那与原版不符——原版是直接丢出去）。
    // ⚠️ 批次 132 按 Wiki「物品管理」补上按键之分：**左键全部丢出、右键只丢一个**
    //（原文："左键点击物品栏界面中暗色的无内容处会将鼠标上的物品全部丢出。
    // 按右键则只会丢出一个。"）
    this.root.addEventListener('pointerdown', (event) => {
      // 面板与快捷栏 dock 之外的**空处**都算"界面外"（含 shell 自己的留白）：
      // 只认 `event.target === root` 时，点两栏之间的缝什么都不发生，
      // 玩家就会以为"丢弃没做"。
      if (event.target !== this.root && event.target !== this.shellEl) return;
      event.preventDefault();
      if (this.held) {
        const count = event.button === 2 ? 1 : this.held.count;
        this.hooks.onDrop?.(this.held.id, count);
        this.held = count >= this.held.count ? null : { ...this.held, count: this.held.count - count };
      }
      this.refresh();
    });

    document.addEventListener('keydown', (event) => {
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
    });
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
    this.hooks.onDrop(stack.id, count);
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

  private handleSlotClick(key: string, button: number): void {
    const binding = this.bindings.get(key);
    if (!binding) return;
    // 铁砧产物：不是普通搬运——要先查等级、扣等级、扣材料再重算（H8）
    if (binding.source instanceof Anvil && binding.index === ANVIL_RESULT) {
      this.handleAnvilTake();
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
          this.held = slot;
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
        this.held = slot;
      }
    } else if (slot) {
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
        this.inventory.add(next.id, next.count);
        crafted++;
        // 保底：正经配方都到不了 64 次，只为防"产物又能当原料"那种配方死循环
        if (crafted >= 64) break;
      }
      if (crafted > 0) this.inventory.notify();
      this.refresh();
      return;
    }

    // 批次 160：产物**直接进背包**，不再挂到光标上。
    //
    // 用户的场景是"把材料摆进工作台 → 点产物"：这时想要的不是"手上多一叠再找地方放"，
    // 而是"做好就收起来"。`Inventory.addStack` 的填充顺序就是**快捷栏 → 主仓库**
    // （`AUTO_FILL_SLOTS` 按槽位下标走，0-8 是快捷栏、9-35 是主仓库）；
    // 两边都满了就丢在脚边——与"背包放不下"的处理一致（`onDrop` = 主程序那边造掉落物）。
    const taken: ItemStack = { id: product.id, count: product.count };
    if (!grid.takeResult()) return;
    const leftover = this.inventory.addStack(taken);
    if (leftover > 0) this.hooks.onDrop?.(taken.id, leftover);
    this.inventory.notify();
    this.refresh();
  }

  private returnHeldToInventory(): void {
    if (this.held) {
      const leftover = this.inventory.add(this.held.id, this.held.count);
      this.held = leftover > 0 ? { id: this.held.id, count: leftover } : null;
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
    if (this.mode !== mode || this.activeContainer !== container) {
      for (const grid of Object.values(this.grids)) grid.drainTo(this.inventory);
      this.mode = mode;
      this.activeContainer = container ?? null;
      // 打开别的界面就不再"与这个村民交易"了（他是一个实体，不是容器）
      this.activeVillager = null;

      if (this.activeContainer) {
        this.activeContainer.onChange = () => {
          this.containerDirty = true;
        };
      }
      this.rebuildTopArea();
    }

    this.titleEl.textContent = MODE_TITLES[mode];
    // 每次从快捷栏打开玩家背包：落到「物品栏」页（Wiki 左下箱子），左栏是"我的物品"
    if (mode === 'inventory') {
      this.pocketTab = 'inventory';
      this.leftPaneKind = 'items';
      this.hooks.onCloseRecipes?.();
    }
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
    if (this.open) return;
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
    if (!this.open || this.closing) return;
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
      this.panel.classList.remove('panel-out');
      this.finishClose();
    };
    this.panel.addEventListener('animationend', finish);
    window.setTimeout(finish, 400);
  }

  private finishClose(): void {
    this.closing = false;
    this.open = false;
    this.root.classList.add('hidden');
    document.body.classList.remove('inv-pocket-open');
    // 配方书是从背包左栏借来的位置，背包关了就得还回去
    this.detachRecipeBook();
    this.hidePickToast();
    this.clearCraftGhost();
    this.markPressing(null);
    this.lastLeftPane = '';
    this.restoreInvTabToRail();
    this.hooks.onOpenChange?.(false);
  }

  /** 容器内容变化后的节流刷新（由主循环调用） */
  tickUi(dt: number): void {
    if (!this.open || !this.containerDirty) return;
    this.containerRefreshTimer += dt;
    if (this.containerRefreshTimer < CONTAINER_REFRESH_INTERVAL) return;
    this.containerRefreshTimer = 0;
    this.containerDirty = false;
    this.refresh();
  }

  refresh(): void {
    for (const binding of this.bindings.values()) {
      this.renderInto(binding.element, binding.source.get(binding.index));
      if (binding.takeOnly) binding.element.classList.add('take-only');
    }

    if (this.mode === 'inventory' || this.mode === 'crafting') {
      const result = this.crafting.result;
      this.renderInto(this.resultElement, result ? { id: result.id, count: result.count } : null);
      this.resultElement.classList.toggle('ready', result !== null);
      this.resultElement.classList.add('take-only');
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
    }

    if (this.mode === 'brewing' && this.activeContainer instanceof BrewingStand) {
      const stand = this.activeContainer;
      this.brewProgressEl.style.width = `${Math.round(stand.brewRatio * 100)}%`;
      // 燃料库存必须显示出来：烈焰粉是 1 份 20 次，"还剩 17 次"与"还剩 3 次"对玩家是两件事
      const left = stand.fuelRemaining;
      this.brewFuelTextEl.textContent = left > 0 ? `还能酿 ${left} 次` : '需要烈焰粉';
      this.brewFuelTextEl.classList.toggle('bad', left <= 0);
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
    if (this.mode === 'smithing') this.refreshSmithing();
    if (this.mode === 'stonecutter') this.refreshStonecutter();
    if (this.mode === 'trade') this.refreshTrade();

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
  }

  /** 供主程序 / 验收：当前携带版页签（经典 UI 下也会返回上次值，但不影响布局） */
  get currentPocketTab(): PocketInventoryTab {
    return this.pocketTab;
  }

  /** 按当前盔甲槽重画预览剪影（批次 141） */
  private refreshPlayerPreview(): void {
    drawPlayerPreview(
      this.playerPreviewEl,
      {
        helmet: this.inventory.get(ARMOR_START)?.id ?? null,
        chest: this.inventory.get(ARMOR_START + 1)?.id ?? null,
        legs: this.inventory.get(ARMOR_START + 2)?.id ?? null,
        boots: this.inventory.get(ARMOR_START + 3)?.id ?? null,
      },
      this.atlas,
      48,
    );
  }

  /** 指针底下的槽位当前是什么物品 */
  private tooltipFor(element: HTMLElement): ItemTooltip | null {
    // 正在长按选数量时不弹提示框（批次 137）：那个手势的反馈是**指示条**，
    // 再糊一块提示框上去会正好盖住玩家要看的那个数字
    if (this.split) return null;
    const stack = this.tooltipStacks.get(element);
    if (!stack) return null;
    return itemTooltip(stack.id, stack.count, stack.damage, stack.enchants, stack.name);
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
    const data = itemTooltip(stack.id, stack.count, stack.damage, stack.enchants, stack.name);

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
    this.pickToastEl.classList.remove('hidden');
    this.placePickToast();
    window.clearTimeout(this.pickToastTimer);
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

  /** 收起说明浮层（超时 / 关界面） */
  private hidePickToast(): void {
    window.clearTimeout(this.pickToastTimer);
    this.pickToastTimer = 0;
    this.pickToastEl.classList.add('hidden');
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
      this.rejectSlot(this.smithingResultSlot);
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
    this.smithingResultSlot.classList.toggle('ready', outcome !== null);
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
    this.inventory.onChange = null;
    for (const grid of Object.values(this.grids)) grid.onChange = null;
    this.root.remove();
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
