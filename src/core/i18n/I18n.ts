/**
 * 界面语言（M8）—— 框架层。
 *
 * 为什么先做框架而不是"直接把中文换成英文"：这个仓库里用户可见的文案散在
 * 3 万行 UI 里（`SettingsScreen.ts` 一个文件就 2020 行），如果一边抽一边改行为，
 * 一次改动会同时动"文案"与"逻辑"两件互不相干的事，出问题时不知道是哪边坏的。
 * 所以这里只做三件事：**一张表、一个查表函数、一个当前语言**。
 *
 * 三条约定（都是踩过坑之后定的）：
 *  1. **键名点分、按界面分组**（`settings.group.game`），不写 `设置_游戏` 这种
 *     把中文当键的写法——那样改文案就会把键改掉，两处引用立刻失联。
 *  2. **查不到的键返回键名本身**，不返回空串、也不抛异常：
 *     界面上显示 `settings.group.game` 一眼就能看出漏了文案，
 *     而空串会变成"按钮是空的"，玩家只会以为是渲染坏了。
 *  3. **中英两张表必须键集一致**，`keyParity()` 就是给断言用的入口——
 *     "加了一条中文忘了加英文"是 i18n 最常见的回归，靠人眼查不住。
 */

import { COMMAND_MESSAGES_EN } from '../commands/commandMessages.data.ts';
// 中文文案本体（多语言 P0-2）：按界面分组，`index.ts` 是合并入口
import { zh } from './locales/zh/index.ts';

export const LANGUAGES = ['zh', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

/** 语言自称（语言选择器里显示的就是这两串，不随当前语言变） */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  zh: '简体中文',
  en: 'English',
};

/** 默认语言：中文（本项目最初的文案全是中文，英文是后来补的） */
export const DEFAULT_LANGUAGE: Language = 'zh';

/**
 * 中文表本体已搬到 `locales/zh/`（多语言 P0-2）；这里只留一个别名，
 * 让下面 `ZH_MERGED` / `t()` 那几处不必改写——这一步只搬不改。
 */
const ZH: Readonly<Record<string, string>> = zh;

const EN: Readonly<Record<string, string>> = {
  'pause.title': 'Game Paused',
  'pause.resume': 'Resume Game',
  'pause.settings': 'Settings',
  'pause.achievements': 'Advancements',
  'pause.statistics': 'Statistics',
  'statistics.title': 'World Statistics',
  'statistics.playTime': 'Play Time',
  'statistics.blocksMined': 'Blocks Mined',
  'statistics.blocksPlaced': 'Blocks Placed',
  'statistics.mobsKilled': 'Mobs Killed',
  'statistics.deaths': 'Deaths',
  'statistics.distance': 'Distance Walked',
  'pause.exit': 'Save & Quit to Title',
  'settings.title': 'Settings',
  'settings.back': 'Back',
  'settings.group.game': 'Game',
  'settings.group.controls': 'Controls',
  'settings.group.appearance': 'Appearance',
  'settings.group.sound': 'Audio',
  'settings.language': 'Language',
  'settings.language.hint': 'Takes effect after reopening this panel',
  'settings.row.daylightCycle': 'Daylight Cycle',
  'settings.row.showDebug': 'Debug Info',
  'settings.row.autosave': 'Autosave',
  'settings.row.flying': 'Flying',
  'settings.row.gameMode': 'Game Mode',
  'settings.row.cameraMode': 'Camera',
  'settings.row.handedness': 'Handedness',
  'settings.row.aimMode': 'Aiming',
  'settings.row.touchStick': 'Joystick',
  'settings.row.invertY': 'Invert Y',
  'settings.row.autoJump': 'Auto Jump',
  'settings.row.fastEat': 'Fast Eat',
  'settings.row.fov': 'Field of View',
  'settings.row.touchScale': 'Button Size',
  'settings.row.sensitivity': 'Sensitivity',
  'settings.row.volume': 'Master Volume',
  'settings.row.volumeBlocks': 'Block Sounds',
  'settings.row.volumeMobs': 'Mob Sounds',
  'settings.row.volumePlayer': 'Player Sounds',
  'settings.row.volumeUi': 'UI Sounds',
  'settings.row.volumeAmbient': 'Weather Sounds',
  'settings.row.volumeMusic': 'Music',
  'settings.avatar.full': 'Full Body',
  'settings.avatar.face': 'Face',
  // ---- leftover settings strings (batch 1355 / T5)
  'settings.backArrow': '‹ Back',
  'settings.backLayer': 'Back one level',
  'settings.hintApplies': 'Changes apply immediately',
  'settings.escResume': 'Press Esc to resume',
  'settings.touchBack': 'Tap "{label}" or the system back key to return',
  'settings.groupUndefined': 'Undefined settings group: {group}',
  'settings.helpDesktop':
    '<kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>Shift</kbd> sneak / descend · <kbd>Ctrl</kbd> sprint<br /><kbd>LMB</kbd> break · <kbd>RMB</kbd> place · <kbd>1-9</kbd> select · <kbd>F</kbd> fly · <kbd>V</kbd> camera · <kbd>Esc/E</kbd> menu and inventory',
  'settings.helpTouch':
    'Left stick moves · drag to look · tap to place · hold to break<br />Jump and sneak are bottom right · inventory right of the hotbar, chat on top<br />Double-tap jump to fly (creative) · camera and flight live in Settings',
  'settings.reset': 'Restore defaults',
  'settings.resetDone': 'Defaults restored',
  'settings.row.brightness': 'Brightness',
  'settings.row.hairStyle': 'Hair style',
  'settings.row.hairColor': 'Hair color',
  'settings.row.beard': 'Beard',
  'settings.row.eyes': 'Eyes',
  'settings.row.eyeColor': 'Eye color',
  'settings.row.build': 'Age',
  'settings.row.frame': 'Build',
  'settings.row.skinTone': 'Skin tone',
  'settings.row.shirtColor': 'Shirt',
  'settings.row.pantsColor': 'Pants',
  'settings.row.cape': 'Cape',
  'settings.appearance.title': 'Character',
  'settings.appearance.preview': 'Character preview (drag to rotate)',
  'settings.appearance.dragTip': 'Drag to rotate',
  'settings.appearance.edit': 'Edit',
  'settings.appearance.close': 'Close character editor',
  'settings.diagnostics': 'Log',
  'settings.export': 'Export',
  'settings.exportTitle': 'Download JSON (last two sessions, up to 500KB)',
  'settings.exported': 'Exported',
  'settings.exportFailed': 'Export failed',
  'settings.exportMarked': ' · marked',
  'settings.exportStats': '{events} entries · {kb}KB{marked}',
  'settings.resourcePack': 'Resource pack',
  'settings.import': 'Import',
  'settings.importTitle': 'Pick a .mcpack / .zip resource pack',
  'settings.notChosen': 'None selected',
  'settings.opt.unlimited': 'Unlimited',
  'settings.opt.fps30': '30 fps',
  'settings.opt.fps60': '60 fps',
  'settings.opt.off': 'Off',
  'settings.opt.reduced': 'Reduced',
  'settings.opt.all': 'All',
  'settings.opt.finger': 'Finger',
  'settings.opt.center': 'Screen center',
  'settings.opt.sec30': '30 s',
  'settings.opt.sec60': '60 s',
  'settings.opt.sec120': '120 s',
  'menu.tagline': 'Survival, Creative and Multiple Worlds',
  'menu.play': 'Play',
  'menu.settings': 'Settings',
  'menu.footer': 'Unofficial web remake · saves live on this device',
  'menu.newWorld': '+ New World',
  'menu.empty': 'No worlds yet — use “+ New World” above to create one.',
  'menu.back': '‹ Back',
  'menu.cancel': 'Cancel',
  'menu.reroll': 'Random',
  'menu.create': 'Create & Enter',
  'world.list': 'Worlds',
  'world.name': 'World Name',
  'world.seed': 'Seed',
  'world.type': 'World Type',
  'world.biome': 'Biome',
  'world.difficulty': 'Difficulty',
  'world.gameMode': 'Game Mode',
  'world.hardcore': 'Hardcore',
  'world.hardcoreOff': 'Normal',
  'world.hardcoreOn': 'Hardcore',
  'world.namePlaceholder': 'Leave blank to auto-name',
  'world.seedPlaceholder': 'Blank = random',
  'world.hint': 'Same seed means same terrain; a superflat world is a single grass layer.',
  'world.createTitle': 'Create World',
  'world.enter': 'Enter',
  'world.edit': 'Edit',
  'world.editTitle': 'Edit World',
  'world.save': 'Save',
  'world.editHint': 'Mode and difficulty take effect next time you enter.',
  'world.delete': 'Delete',
  'world.export': 'Export',
  'world.import': 'Import Save',
  'inventory.title': 'Inventory',
  'inventory.armor': 'Armor',
  'inventory.returnToStorage': 'Return to Storage',
  'inventory.noMatch': 'No matching items',
  'inventory.noRecipes': 'Nothing craftable in this tab right now',
  'inventory.material': 'Input',
  'inventory.fuel': 'Fuel',
  'inventory.fuelOptions': 'Other Fuels',
  'inventory.product': 'Output',
  'inventory.target': 'Target',
  'inventory.searchItems': 'Search items…',
  'inventory.searchCraftable': 'Search craftable items…',
  'inventory.renamePlaceholder': 'Rename to… (optional)',
  'inventory.tab.craftable': 'Craftable',
  'inventory.tab.items': 'Inventory',
  'inventory.returnFurnaceHint': 'Move every input, fuel and output back to storage',
  'inventory.returnBrewHint': 'Move every potion, ingredient and fuel back to storage',
  // ---- 背包界面（批次 617，Q12）
  'inventory.playerPreview': 'Character',
  'inventory.creativeTitle': 'Creative Inventory',
  'inventory.crafting': 'Crafting',
  'inventory.itemsTab': 'Inventory',
  'inventory.searchTab': 'Search',
  'inventory.survivalTab': 'Survival Inventory',
  'inventory.creativeTab': 'Creative Items',
  'inventory.creativeCategory': 'Creative category: ',
  'creative.tab.all': 'All',
  'creative.tab.building': 'Building',
  'creative.tab.equipment': 'Equipment',
  'creative.tab.items': 'Items',
  'creative.tab.nature': 'Nature',
  'pager.summary': 'Page {current}/{pages} · {total} items',
  'inventory.armor.helmet': 'Head',
  'inventory.armor.chestplate': 'Chest',
  'inventory.armor.leggings': 'Legs',
  'inventory.armor.boots': 'Feet',
  'inventory.armor.offhand': 'Offhand',
  'inventory.offhandHint': 'Offhand: shield / torch / totem…',
  'inventory.recipeBook': 'Recipe Book',
  'inventory.recipeBookKey': 'Recipe Book (R)',
  'inventory.achievements': 'Advancements',
  'inventory.achievementsKey': 'Advancements (J)',
  'inventory.close': 'Close Inventory',
  'inventory.closeKey': 'Close (E)',
  'inventory.craft': 'Craft',
  'inventory.hintTouch': 'Tap to pick up, tap again to place · long-press and drag to choose an amount · tap an empty slot to drop one',
  'inventory.hintKeyboard': 'Press <kbd>E</kbd> or <kbd>Esc</kbd> to close · left click for the whole stack, right click for one',
  'inventory.prevPage': '‹ Previous',
  'inventory.nextPage': 'Next ›',
  'inventory.noCompleteRecipes': 'No recipe has every ingredient yet · open the Recipe Book to see everything this station can make',
  'station.tradeHint': 'Tap an offer to trade straight from your inventory (bring the goods)',
  'station.smithingDone': 'Upgraded: enchantments and durability are kept',
  'station.villagerIdle': 'He has no job yet — place a workstation nearby (composter / blast furnace / smoker / brewing stand / stonecutter / barrel / smithing table) and he will claim it in a few seconds.',
  'station.stonecutterHint': 'Add stone-type blocks (stone / sandstone / deepslate / quartz / copper…) to list what can be cut',
  'station.fuelHint': 'Coal, charcoal, planks, dried kelp blocks and other burnables all work; pick below or drag one in',
  'station.startMaking': 'Tap to start crafting',
  'station.startMakingWithCount': 'Tap to start crafting (about {count} {unit})',
  'station.notEnough': 'Not enough materials or fuel to start',
  // ---- station names / reasons (batch 617 / Q13)
  'station.name.furnace': 'Furnace',
  'station.name.smokerOrFurnace': 'Smoker (or Furnace)',
  'station.name.blastFurnaceOrFurnace': 'Blast Furnace (or Furnace)',
  'station.name.campfire': 'Campfire',
  'station.name.smithing': 'Smithing Table',
  'station.name.brewing': 'Brewing Stand',
  'station.reason.missingInput': 'Missing input',
  'station.reason.missingFuel': 'Missing fuel',
  'station.reason.missingEquipment': 'Missing equipment to upgrade',
  'station.reason.missingMaterial': 'Missing material',
  'station.reason.slotOccupied': 'Slot occupied by something else',
  'station.reason.notAvailable': 'Cannot craft it right now',
  // ---- in-panel slot labels (batch 617 / Q13)
  'slot.target': 'Target',
  'slot.potion': 'Potion',
  'slot.potionHint': 'Up to 3 potions at a time',
  'slot.material': 'Ingredient',
  'slot.fuel': 'Fuel',
  'slot.input': 'Item',
  'slot.rename': 'Rename',
  'slot.enchantMaterial': 'Item / Enchanted Book',
  'slot.crafting': 'Crafting',
  'slot.campfireHint': 'Place up to 4 foods here (they pop out when done)',
  'slot.anvilRename': 'Rename',
  'slot.anvilWash': 'Item to repair',
  'slot.anvilSameGear': 'Same kind of gear (optional)',
  'slot.product': 'Output',
  // ---- leftover panel/station strings (batch 1355 / M8)
  'inventory.rightArmorHint': 'The right column is armor — switch to crafting to see recipes',
  'inventory.rightArmor': 'Right column: armor',
  'inventory.rightCrafting': 'Right column: crafting',
  'inventory.fuelEmptyPick': 'Fuel: empty · pick one below',
  'inventory.fuelEmptyPut': 'Fuel: empty · add some fuel',
  'inventory.fuelLabel': 'Fuel: {item} ×{count}',
  'station.tradeXpMaster': 'Trade XP {xp} (already a master)',
  'station.tradeXpNext': 'Trade XP {xp} ({need} more to level up)',
  'inventory.slotBlocked': 'No room — clear the station slots first',
  'inventory.recipeUnavailable': 'That recipe cannot be made right now',
  'inventory.furnaceFull': 'Ingredient or fuel does not fit — clear the furnace slots first',
  'inventory.noUsableRecipe': 'No usable recipe',
  'inventory.notInRecipeTable': 'That item is not in the furnace / smithing / brewing recipe tables',
  'inventory.bookAllStations': 'Recipe book: showing every station · tap to show only what this station can make',
  'inventory.bookThisStation': 'Only what this station can make · tap to show every station',
  'inventory.bookAllItems': 'Recipe book: showing every item in this category · tap to show only craftable ones',
  'inventory.bookCraftable': 'Only craftable items (used-up ingredients included) · tap to show the whole category',
  'inventory.bindingCurse': 'Curse of Binding: this piece cannot be taken off',
  'inventory.selectedBack': 'Selected · tap again to send it back to storage',
  'slot.productTarget': 'Output / Target',
  'slot.diamondGear': 'Diamond gear',
  'slot.netheriteIngot': 'Netherite Ingot',
  'slot.lapis': 'Lapis Lazuli',
  'slot.hopper5': 'Hopper (5 slots)',
  'slot.dispenser9': 'Dispenser (9 slots)',
  'slot.dropper9': 'Dropper (9 slots)',
  'slot.villager': 'Villager',
  'station.stoneToCut': 'Stone to cut',
  'station.stoneResults': 'What it cuts into (tap to cut one)',
  'station.loomBanner': 'Banner to pattern',
  'station.loomDyes': 'Dyes (one per pattern)',
  'station.loomResult': 'Result (take it out and put it back to become a real banner)',
  'station.loomPatterns': 'Pick a pattern (tap to apply one)',
  'station.loomFirstBanner': 'Place a banner first',
  'station.loomNextDye': 'Now place a dye',
  'station.loomCanApply': '{count} more can be patterned (each costs 1 banner + 1 dye)',
  'station.cartoMap': 'Filled map',
  'station.cartoMaterials': 'Materials: paper / empty map / glass pane',
  'station.cartoModes': 'Paper=zoom · Empty map=copy · Glass pane=lock',
  'station.cartoZoom': 'Zoom out one level: doubles the covered area (costs 1 paper)',
  'station.cartoCopy': 'Copy: identical bitmap (costs 1 empty map, the original is kept)',
  'station.cartoLock': 'Lock: explored chunks stop updating (costs 1 glass pane)',
  'station.tradeActions': 'What they offer (tap to trade)',
  'station.tradeUnemployed': 'Unemployed',
  'station.tradeClaimHint': 'Claim a workstation nearby and they will start trading',
  'station.campfireOut': 'The campfire is out (right-click with flint and steel to relight)',
  'station.brewLeft': '{count} more brews',
  'station.brewReady': 'Blaze powder ready',
  'station.brewNeed': 'Needs blaze powder',
  'station.brewPowderTitle': 'One blaze powder covers 20 brews',
  'station.brewPowderSlot': 'Put blaze powder in the fuel slot',
  'station.hopperLocked': 'Locked by a redstone signal: neither pushes nor pulls (cut the signal to resume)',
  'station.hopperCycle': 'Moves one item every 0.4s: pushes into the facing block, then pulls one from a container or item above',
  'station.grindstoneXp': 'Removes enchantments and returns {count} XP',
  'station.grindstoneTaken': 'Taken',
  // ---- templated sentences (batch 1355)
  'inventory.recipeBookAria': 'Recipe book · {tab}',
  'inventory.categoryInfo': '{tab} · craftable {count}',
  'inventory.categorySwitched': 'Category: {tab}',
  'inventory.dropped': 'Dropped {item} ×{count}',
  'station.collectTitle': 'Tap to collect {item}',
  'station.putMaterials': '{item} · tap to add the ingredients',
  'station.startCrafting': 'Started crafting: {item}',
  'station.startBrewing': 'Started brewing: {item}',
  'station.startCooking': 'Started cooking: {item}',
  'station.finished': 'Finished: {item}',
  'station.craftableSummary': '{station} · craftable {available} / {total} (white = ready to start)',
  'station.needLabel': 'Needs {label}',
  'station.needOtherStation': 'You have {current} open; craft {item} at the {label}',
  'slot.cargo': 'Cargo ({count} slots)',
  'station.dropperEmpty': 'Drops {facing} · it is empty: a redstone pulse does nothing',
  'station.dropperCycle':
    'Drops {facing}: each redstone **pulse** (lever twice, button, clock) drops one item; a container in front receives it, otherwise it falls on the ground',
  'station.dispenserEmpty': 'Uses {facing} · it is empty: a redstone pulse does nothing',
  'station.dispenserHead': 'Uses {facing}: each pulse consumes one item',
  'station.dispenserKnown':
    '{head} — {count} slots hold things it understands (shoot / throw / ignite / shear); the rest are dropped',
  'station.dispenserUnknown': '{head} — it understands none of them: everything is dropped ({list})',
  'station.fuelTooltip': 'Fuel · burns for {seconds}s (about {count} items in a furnace)',
  'station.anvilCost': 'Costs {cost} levels',
  'station.stoneOffer': '1 {item} → {count} {output}',
  'station.stoneNone': '{item} has no stone variants to cut',
  'station.stoneEach': 'Each cut uses 1 {item} (you have {count})',
  'station.stoneResult': 'Cuts {count} {item}',
  'station.patternFallback': 'Pattern {index}',
  'station.smithingCost': 'Costs {count} netherite ingots (no XP)',
  'station.anvilNeed': 'Needs {need} levels (you have {have}){penalty}',
  'station.enchantApplied': 'Applied {list}',
  'station.enchantButton': '{label}　{cost} levels',
  'station.enchantCostTitle': 'Costs {cost} levels and {lapis} lapis lazuli',
  // ---- panel titles (22 stations, `MODE_TITLES`)
  'panel.inventory': 'Inventory',
  'panel.crafting': 'Crafting Table',
  'panel.furnace': 'Furnace',
  'panel.smoker': 'Smoker',
  'panel.blastFurnace': 'Blast Furnace',
  'panel.campfire': 'Campfire',
  'panel.chest': 'Chest',
  'panel.barrel': 'Barrel',
  'panel.enderChest': 'Ender Chest',
  'panel.shulkerBox': 'Shulker Box',
  'panel.mobInventory': 'Cargo',
  'panel.enchanting': 'Enchanting Table',
  'panel.anvil': 'Anvil',
  'panel.grindstone': 'Grindstone',
  'panel.smithing': 'Smithing Table',
  'panel.stonecutter': 'Stonecutter',
  'panel.loom': 'Loom',
  'panel.cartography': 'Cartography Table',
  'panel.brewing': 'Brewing Stand',
  'panel.hopper': 'Hopper',
  'panel.trade': 'Trade with Villager',
  'panel.dropper': 'Dropper',
  'panel.dispenser': 'Dispenser',
  'unit.item': 'items',
  'unit.bottle': 'bottles',
  'inventory.searchAllFor': 'Search all {station} recipes…',
  'inventory.searchUsableFor': 'Search what {station} can make right now…',
  'inventory.statAll': '{label} · {total} total (white = {available} craftable now)',
  'inventory.statAvailable': '{label} · {available} craftable now (open the recipe book for all)',
  'inventory.burnTime': '{item} (burns for {seconds}s)',
  'advancement.title': 'Advancements',
  'advancement.empty': 'Nothing in this branch yet',
  'beacon.title': 'Beacon',
  'book.noPages': 'Nothing written yet — cannot sign it',
  'chat.send': 'Send',
  'command.usagePrefix': 'Usage: ',
  'command.unknown': "Unknown command: /{name} (type /help for the list)",
  'command.unknownHelp': 'Unknown command: {name}',
  'command.creativeOnly': '/{name} can only be used in creative mode',
  'command.empty': 'Type a command, e.g. /help',
  'command.failed': 'Command failed: {message}',
  'command.listTitle': 'Available commands ({count}):',
  // ---- 命令运行时反馈（批次 617 后续）：直接由 src/core/commands/messages.ts 生成 ----
  'chat.sendLabel': 'Send',
  'chat.collapse': 'Click to collapse',
  'chat.expand': 'Click to expand',
  'chat.hintIdle': 'Type a command (/help for the list) or just talk; tap Send to post',
  'chat.hintIdleKeyboard': 'Type a command (/help for the list) or just talk; Enter to post, Esc to cancel',
  'chat.hintCommand': 'Tap Send to post (no Tab completion on phones — type arguments in full)',
  'chat.hintCommandKeyboard': 'Tab fills arguments · Enter posts · ↑↓ history',
  'chat.candidates': 'Matches: {list}{suffix}',
  'chat.tabComplete': ' (Tab to fill)',
  'chat.noCommandMatch': 'No matching command — type /help to see all',
  'fullscreen.rotateTitle': 'Please rotate your device',
  'fullscreen.rotateDetail': 'Tap to go fullscreen · rotating the phone starts it too',
  'fullscreen.rotateIosDetail': 'Rotate the phone; for fullscreen use Share → Add to Home Screen',
  'install.hint': 'Add to Home Screen to launch straight into fullscreen landscape',
  'install.add': 'Add',
  'install.later': 'Later',
  'install.iosHint': 'Safari cannot fullscreen a web page directly: tap Share → Add to Home Screen, then open from the Home Screen icon.',
  'install.iosOk': 'Got it',
  'map.close': 'Close',
  'map.title': 'Map',
  'map.locked': ' · locked',
  'advancement.close': 'Close',
  'advancement.closeLabel': 'Close advancements',
  'advancement.filterAll': 'All',
  'advancement.lockedHint': 'Complete the earlier entries to reveal it',
  'advancement.earned': 'Earned',
  'advancement.summary': 'Earned {earned} / {total}',
  'advancement.challengeDone': 'Challenge complete',
  'advancement.locked': 'Locked',
  'advancement.challenge': 'Challenge',
  'advancement.available': 'Available',
  'advancement.toastDone': 'Advancement made!',
  'advancement.toastChallenge': 'Challenge complete!',
  'death.title': 'You died!',
  'death.respawning': 'Respawning…',
  'sleep.dawn': 'Dawn is coming',
  'sleep.hint': 'Press jump to get up early',
  'sleep.lieDown': 'You lie down… (press jump or tap the overlay to get up early)',
  'recipeBook.title': 'Recipe Book',
  'recipeBook.detail': 'Tap a cell: its ingredients go into the grid on the right',
  'sign.done': 'Done',
  // ---- first-run guide (batch 20261022-1954)
  'tutorial.title': 'Getting Started',
  'tutorial.progress': 'Step {current} of {total}',
  'tutorial.collapse': 'Collapse',
  'tutorial.expand': 'Expand',
  'tutorial.dismiss': "Don't show again",
  'tutorial.finish': 'All done — go build something!',
  // ---- build tools (batch 20261022-1954)
  'buildtools.undo.creativeOnly': 'Undo is only available in Creative mode',
  'buildtools.undo.onlineOnly': "You can't undo while connected to a server",
  'buildtools.undo.empty': 'Nothing to undo',
  'buildtools.redo.empty': 'Nothing to redo',
  'buildtools.select.first': 'First corner set — tap another corner',
  'buildtools.select.done': 'Selected {volume} blocks',
  'buildtools.select.tooLarge': 'Selection too large (max 32768 blocks)',
  'buildtools.select.outOfWorld': 'Selection is outside the world',
  'buildtools.fill.noSelection': 'Pick two corners to select an area first',
  'buildtools.fill.done': 'Filled {count} blocks',
  'buildtools.fill.cancelled': 'Fill cancelled',
  'buildtools.copy.done': 'Copied {count} blocks',
  'buildtools.copy.none': 'Nothing copied yet',
  'buildtools.copy.empty': 'The selection is empty',
  'buildtools.paste.done': 'Pasted {count} blocks',
  'buildtools.paste.cancelled': 'Paste cancelled',
  'buildtools.paste.outOfWorld': 'Paste target is outside the world',
  // ---- build templates (batch 20261022-1954)
  'template.smallHouse': 'Cottage',
  'template.bridge': 'Bridge',
  'template.tree': 'Tree',
  'template.tower': 'Stone Tower',
  'buildtools.template.blocked': "Can't place here — blocks in the way",
  'buildtools.template.unsupported': "Can't place here — nothing underneath",
  'buildtools.template.outOfWorld': 'Outside the world',
  'buildtools.template.placed': 'Placing: {name}',
  // ---- build toolbar (batch 20261022-1954)
  'buildtools.toggle': 'Build mode',
  'buildtools.tool.select': 'Select',
  'buildtools.tool.fill': 'Fill',
  'buildtools.tool.copy': 'Copy',
  'buildtools.tool.paste': 'Paste',
  'buildtools.tool.mirror': 'Mirror paste',
  'buildtools.tool.undo': 'Undo',
  'buildtools.tool.redo': 'Redo',
  'buildtools.tool.template': 'Templates',
  'buildtools.tool.selectHint': 'Tap a block to set the first corner',
  'buildtools.fill.noBlock': 'Hold a block first',
  // ---- mini-games (batch 20261022-1954)
  'minigame.exit': 'Exit',
  'minigame.crashed': 'The mini-game hit an error and closed',
  'minigame.smoke.title': 'Framework check',
  'minigame.smoke.hint': 'Tap to toggle (framework check)',
  'minigame.smoke.won': 'Cleared!',
  'minigame.smoke.playing': 'Continue',
  // ---- mini-game menu (batch 20261022-1954)
  'menu.minigames': 'Mini-games',
  'minigame.menu.title': 'Mini-games',
  'minigame.menu.back': '‹ Back',
  'minigame.menu.best': 'Best {best}',
  // ---- jump (batch 20261022-2220)
  'minigame.jump.title': 'Jump',
  'minigame.jump.desc': 'Hold to charge, release to jump',
  'minigame.jump.hint': 'Hold to charge, release to jump',
  'minigame.jump.best': 'Best {best}',
  'minigame.jump.over': 'Score {score}',
  'minigame.jump.retry': 'Play again',
  'minigame.jump.record': 'New best!',
  'tutorial.survival.log.title': 'Chop a tree first',
  'tutorial.survival.log.desc': 'Walk up to a trunk and hold to break it',
  'tutorial.survival.table.title': 'Craft a crafting table',
  'tutorial.survival.table.desc': 'Combine 4 planks in your inventory',
  'tutorial.survival.woodPickaxe.title': 'Craft a wooden pickaxe',
  'tutorial.survival.woodPickaxe.desc': '3 planks + 2 sticks',
  'tutorial.survival.stonePickaxe.title': 'Mine stone, craft a stone pickaxe',
  'tutorial.survival.stonePickaxe.desc': 'Mine cobblestone with the wooden pickaxe, then craft (stone is a few blocks down)',
  'tutorial.creative.place10.title': 'Place 10 blocks',
  'tutorial.creative.place10.desc': 'Pick a block from the hotbar and tap the ground',
  'tutorial.creative.layers.title': 'Stack 3 layers high',
  'tutorial.creative.layers.desc': 'Build upward and see how tall it gets',
  'tutorial.creative.colors.title': 'Use 3 different blocks',
  'tutorial.creative.colors.desc': 'Try blocks in different colours',
  'tutorial.creative.door.title': 'Add a door',
  'tutorial.creative.door.desc': 'Put a door in a wall so you can get in and out',
};

/**
 * 命令运行时反馈的英文（批次 617）。
 *
 * 这批文案的**键就是中文原文**（见 `core/commands/messages.ts` 的说明），所以这里做两层：
 *   · `ZH` 侧原样并入 `COMMAND_MESSAGES_EN` 的键（值就是中文原文）；
 *   · `EN` 侧并入键 → 英文值。
 *
 * 放这里而不是手写进两张静态表：129 条一句话一条，手写会和中文原文**悄悄不一致**
 * ——改了一个字就再也对不上，而 `t()` 找不到键时原样返回，看起来"只是没翻译"。
 * 由同一个对象生成，两边天然对齐；`test:i18n` 另有一条断言查"每条中文都有英文"。
 */
const ZH_MERGED: Readonly<Record<string, string>> = {
  ...ZH,
  ...Object.fromEntries(Object.keys(COMMAND_MESSAGES_EN).map((zh) => [zh, zh])),
};
const EN_MERGED: Readonly<Record<string, string>> = { ...EN, ...COMMAND_MESSAGES_EN };

export const TABLES: Readonly<Record<Language, Readonly<Record<string, string>>>> = {
  zh: ZH_MERGED,
  en: EN_MERGED,
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * 从浏览器语言标签推断（`navigator.language`，形如 `zh-CN` / `en-US`）。
 * 分辨不出来的按中文处理——本项目的中文文案最全，英文是子集时也不至于一半中文一半英文。
 */
export function detectLanguage(tag: string | undefined | null): Language {
  if (typeof tag !== 'string') return DEFAULT_LANGUAGE;
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('en')) return 'en';
  return DEFAULT_LANGUAGE;
}

/**
 * 当前语言。
 *
 * ⚠️ 做成模块级状态而不是"到处传参数"：文案散在几十个渲染函数里，
 * 每处都多一个 `lang` 参数会把函数签名改一遍（那才是真正的大改）。
 * 代价是**它不参与依赖追踪**——所以切语言之后要显式刷新界面
 * （`SettingsScreen.applyLanguage()` 就是干这个的）。
 */
let current: Language = DEFAULT_LANGUAGE;

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  current = language;
  if (typeof document !== 'undefined') {
    // `<html lang>` 不是装饰：手机上的朗读/断行规则、以及浏览器的"翻译此页"提示都看它
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }
}

/** 测试用：把模块状态恢复成默认，避免用例之间互相污染 */
export function resetLanguageForTest(): void {
  current = DEFAULT_LANGUAGE;
}

/**
 * 查一条文案。`language` 省略时用当前语言。
 * 查不到就**返回键名**（见文件头第 2 条约定）。
 */
export function t(key: string, language: Language = current): string {
  const table = TABLES[language] ?? ZH;
  const value = table[key];
  if (typeof value === 'string' && value.length > 0) return value;
  // 当前语言缺这一条时退到中文：英文表漏一条不该让界面出现空白
  const fallback = ZH[key];
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  return key;
}

/**
 * 带占位符的查表：`tp('station.expected', { count: 3, unit: '个' })`。
 *
 * 为什么单独一个函数而不是给 `t()` 加参数：`t()` 的第二个参数已经是**语言**
 * （`t('pause.resume', 'en')`），再塞一个 params 会变成"第二个参数既可能是语言
 * 也可能是对象"——那种签名在运行时只能靠类型猜，出错时报的是别的字段。
 *
 * 两条约定：
 *  1. **占位符是 `{name}`**，不是 `${}` / `%s`：前者不会和模板字符串打架；
 *  2. **缺参数时保留占位符原文**（不替换成空串、也不抛错）——
 *     界面上显示 `{count}` 一眼能看出漏传了，空串则像"排版坏了"。
 */
export function tp(key: string, params: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * 把几个词连成一句（枚举清单用）。
 *
 * 为什么需要它：中文用顿号、英文用逗号加 and，**分隔符本身就是语言相关的**。
 * 直接把 `items.join('、')` 写在界面里，英文模式下会变成
 * "Oak Planks、Cobblestone、Stick" —— 语法上不算错，但一眼就是机翻。
 */
export function joinList(items: readonly string[], language: Language = current): string {
  const list = items.filter((item) => item.length > 0);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0]!;
  if (language === 'en') {
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
  }
  return list.join('、');
}

/**
 * 两张表的键集差异（给断言用）。
 * 正常情况下两个数组都为空——不空就是"漏翻了一条"。
 */
export function keyParity(): { missingInEn: string[]; missingInZh: string[] } {
  const zhKeys = Object.keys(ZH_MERGED);
  const enKeys = Object.keys(EN_MERGED);
  return {
    missingInEn: zhKeys.filter((key) => !(key in EN_MERGED)),
    missingInZh: enKeys.filter((key) => !(key in ZH_MERGED)),
  };
}

/** 所有已定义的键（断言"界面用到的键都在表里"时拿它当白名单） */
export function allKeys(): string[] {
  return Object.keys(ZH_MERGED);
}
