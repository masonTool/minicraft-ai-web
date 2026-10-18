/**
 * 入口：流式世界 + 光照 + 玩家物理 + 方块交互
 *
 * 每帧流程：
 *   输入 → PlayerPhysics 更新（逐轴碰撞 / 自动上台阶）→ 相机跟随
 *   → 视线射线选取方块 → 描边 → 破坏/放置 → 区块流式加载 → 光照收敛 → 网格化 → 渲染
 *
 * 方块被修改后会先做增量光照修正，等光照队列排空再重刷网格，
 * 避免出现"光还没传过去就把顶点烘焙下来"的脏数据。
 *
 * **怎么读这个文件**（批次 101 把能搬走的都搬走了，剩下它就是"入口 + App 类"）：
 *   · 调参常量 / 世界配置 / 纯工具 → `game/tuning.ts`
 *   · 开发期初始物资两张表 → `game/startupKit.ts`
 *   · 天空调色板 → `render/SkyPalette.ts`
 *   · 其余全在下面的 `class App` 里，**按段落名 grep 定位，不要整份读**
 *     （段落目录写在 `class App` 前面）
 * ⚠️ 本文件是纯入口，**没有任何模块 import 它**（末尾 `void boot()`）——
 * 所以往外搬东西不会牵动别处；反过来，要给别人用的东西也不该留在这里。
 */

import * as THREE from 'three';
import { TextureAtlas } from './render/TextureAtlas.ts';
import { ChunkRenderer } from './render/ChunkRenderer.ts';
import { MeshWorkerPool } from './render/MeshWorkerPool.ts';
import {
  MAX_FOOD,
  MAX_HEALTH,
  PlayerStats,
  type DamageCause,
  type SurvivalEnvironment,
} from './core/survival/PlayerStats.ts';
import { VitalsHud } from './ui/VitalsHud.ts';
import { XpHud } from './ui/XpHud.ts';
import { Experience, rollBlockXp } from './core/survival/Experience.ts';
import { bookshelfPower, pickEnchants } from './core/crafting/Enchanting.ts';
import {
  isDrinkable,
  potionById,
  potionTint,
  tippedArrowById,
  type PotionEntry,
} from './core/registry/potions.ts';
// 发射器的**发射行为表**（批次 60）：投掷器与发射器只差这一张表
import { dispenseBehaviorFor } from './core/registry/dispense.ts';
// 发射行为的**执行器**：判定抽出去才能离线断言（见该模块文件头）
import { runDispenseAction, type DispenseContext } from './core/world/Dispense.ts';
// 骨粉（批次 69）：判定在 `BoneMeal.ts` 里（纯函数），这里只负责把它接到世界与背包上
import { fertilizeAt, type BoneMealWorld } from './core/world/BoneMeal.ts';
// 树苗与树（批次 75）：树的形状复用区块生成那套 Planter，这里只提供"写进活世界"的 writer
import { growTreeAt, type TreeWorld } from './core/world/TreeGrowth.ts';
// 支撑没了、该掉的就掉（批次 78，B49）：判据在 `Support.ts`（纯函数 + 注入世界）
import { sweepHangingsAround, sweepUnsupported, type SupportWorld } from './core/world/Support.ts';
import type { TreeKind } from './core/gen/Features.ts';
// 堆肥（批次 70）：什么能堆肥、几分概率在 `registry/compost.ts`（纯数据 + 纯函数）
import { compostStep } from './core/registry/compost.ts';
import { splashEffectsAt } from './core/survival/SplashPotion.ts';
import {
  DRAGON_BREATH_COLLECT_SHRINK,
  DRAGON_BREATH_DAMAGE,
  canCollectDragonBreath,
  cloudEffectsAt,
  createDragonBreathCloud,
  createLingeringCloud,
  tickCloud,
  type PotionCloud,
} from './core/survival/PotionCloud.ts';
import {
  ENDER_EYE_RISE,
  ENDER_EYE_SPEED,
  ENDER_PEARL_FALL_DAMAGE,
  PLAYER_THROW_SPEED,
  Throwable,
  type ThrowableKind,
} from './core/entity/Throwable.ts';
import { pickArrowAmmo } from './core/entity/ArrowAmmo.ts';
import { applyMending } from './core/crafting/Repair.ts';
import { enchantLevel } from './core/registry/enchantments.ts';
import { Sky, cameraFarFor } from './render/Sky.ts';
import { Weather, type WeatherKind } from './render/Weather.ts';
import { MobRenderer } from './render/MobRenderer.ts';
import { MATE_SEARCH_RANGE, Mob, provokedBy } from './core/entity/Mob.ts';
import { entityIntersectsBox, type DroppedExtras } from './core/entity/Entity.ts';
import { mobTypeById } from './core/entity/mobs.ts';
// 村民（J11，批次 88）：造生物的工厂 + 实体本体 + 那一层的纯数据（职业 / 交易表）
import { createMob } from './core/entity/MobFactory.ts';
import { Villager } from './core/entity/Villager.ts';
import { isVillagerFood, levelName, tradeBlocker, tradeSettlement } from './core/registry/villagerTrades.ts';
// 村庄的人口（J22，批次 89）：房子里的每张床招一个村民——规则是纯函数，可离线断言
import { planVillagePopulation, type VillageWorldView } from './core/world/VillagePopulation.ts';
import { planSpawnerSpawn, type SpawnerWorldView } from './core/world/SpawnerTicking.ts';
import { spawnerDefFor } from './core/registry/spawners.ts';
import { DRAGON_CRUISE_Y, DRAGON_TYPE, Dragon, EndCrystal } from './core/entity/EndBoss.ts';
import { endPillarTops } from './core/gen/EndGenerator.ts';
import { RedstoneEngine, wirePowerOf, type RedstoneWorld } from './core/redstone/RedstoneEngine.ts';
import { GamepadInput } from './ui/GamepadInput.ts';
import { SettingsScreen, loadSettings, saveSettings, type GameSettings } from './ui/SettingsScreen.ts';
import { WorldScreen } from './ui/WorldScreen.ts';
import { hideLoading, showLoading, WORLD_LOADING_TEXT } from './ui/LoadingOverlay.ts';
import {
  armAutoFullscreen,
  armPresentOnTap,
  enterFullscreenOnBoot,
  enterMobilePresentation,
  installRotateHint,
  isFullscreen,
  preferInstalledLandscape,
  syncRotateHint,
  toggleFullscreen,
} from './ui/Fullscreen.ts';
import { hideInstallHint, installInstallHint } from './ui/InstallHint.ts';
import { HudToast } from './ui/HudToast.ts';
import { TOUCH_TOOLTIP_MS, Tooltip } from './ui/Tooltip.ts';
import { BackButton } from './ui/BackButton.ts';
import { StartupRamp } from './core/world/StartupRamp.ts';
import { devicePixelRatioValue } from './ui/Device.ts';
import { ChatInput } from './ui/ChatInput.ts';
import { installKeyboardGuards } from './ui/Keyboard.ts';
import { executeCommand, type CommandContext, type CommandFeedback } from './core/commands/Commands.ts';
import {
  TickScheduler,
  randomTickChunk,
  type ScheduledTick,
  type TickWorld,
} from './core/tick/RandomTicks.ts';
import { fluidTick, wakeFluidAt, type FluidWorld } from './core/world/Fluids.ts';
import { scrapeResult } from './core/world/Copper.ts';
import { PrimedTnt, type TntWorld } from './core/world/PrimedTnt.ts';
import { fillLootChests } from './core/world/LootFill.ts';
// 雷电与避雷针（批次 83）：规则（落点选择 / 杆头坐标 / 脉冲表）在 `world/Lightning.ts`，
// 主程序只做"世界里的副作用"（伤害、点火、粒子、给电路重算）
import {
  MOON_PHASE_COUNT,
  moonPhaseFor,
  moonPhaseName,
  slimeSpawnFactor,
} from './core/world/MoonPhase.ts';
// 史莱姆（批次 120）：史莱姆区块与粘液块的弹跳，两条都是纯函数
import { isSlimeChunk, slimeBounceVelocity } from './core/world/Slime.ts';
import {
  LIGHTNING_DAMAGE,
  LIGHTNING_DAMAGE_RADIUS,
  RodPulses,
  STRIKE_INTERVAL_MAX,
  STRIKE_INTERVAL_MIN,
  pickStrike,
  rodTipPoint,
  shouldIgnite,
} from './core/world/Lightning.ts';
import { FIRE_IGNITE_SECONDS, burnsOnContact, igniteAt } from './core/world/Fire.ts';
import {
  PORTAL_COOLDOWN_TICKS,
  PORTAL_CREATIVE_IGNITE_TICKS,
  PORTAL_IGNITE_TICKS,
  buildPortal,
  clearBrokenPortalsAround,
  findPortalNear,
  findPortalSite,
  ignitePortal,
  portalCenter,
  portalInterior,
  portalFrame,
  portalTarget,
  shapeAt,
  type PortalAxis,
  type PortalShape,
  type PortalTarget,
  type PortalWorld,
} from './core/world/NetherPortal.ts';
import {
  END_PORTAL_RING,
  END_PORTAL_WAIT_TICKS,
  activateEndPortalAt,
  buildEndArrivalPlatform,
  clearBrokenEndPortalsAround,
  endPortalCells,
  endPortalTarget,
} from './core/world/EndPortal.ts';
import {
  StatusEffects,
  effectLabel,
  effectTone,
  resolveEffect,
  romanLevel,
} from './core/survival/StatusEffects.ts';
import {
  DEFAULT_GAME_RULES,
  DIFFICULTY_LABELS,
  difficultyProfile,
  normalizeDifficulty,
  normalizeGameRules,
  type Difficulty,
  type GameRules,
} from './core/world/Rules.ts';
import {
  GAME_MODE_LABELS,
  isCreativeMode,
  nextGameMode,
  normalizeGameMode,
  type GameMode,
} from './core/world/GameMode.ts';
import { RecipeBook } from './ui/RecipeBook.ts';
import { craftFromInventory, type RecipeBookTab } from './core/crafting/RecipeBook.ts';
import type { Recipe } from './core/crafting/Recipes.ts';
import { blockLabel, itemLabel, itemTooltip, resolveItemId } from './core/registry/itemNames.ts';
import { LEGACY_WORLD_ID, WorldRegistry, type WorldSummary } from './core/save/WorldRegistry.ts';
import { PARTICLE_DENSITY } from './ui/SettingsScreen.ts';
import {
  CAMERA_MODE_LABELS,
  THIRD_PERSON_DISTANCE,
  CAMERA_CLEARANCE,
  cameraPlacement,
  clampedCameraDistance,
  nextCameraMode,
  type CameraMode,
} from './core/viewMode.ts';
import { AudioEngine, doorSoundFor, type SoundKind } from './core/audio/AudioEngine.ts';
import { applyResourcePack, packNameFromFile, type ResourcePackResult } from './core/resourcepack/ResourcePack.ts';
import { SaveGame, type PlayerSave } from './core/save/SaveGame.ts';
import { ChunkEdits } from './core/save/ChunkEdits.ts';
import { restoreContainers, serializeContainers } from './core/save/ContainerSave.ts';
import { NetClient, defaultServerUrl } from './net/NetClient.ts';
import { REMOTE_PLAYER_TYPE } from './core/entity/mobs.ts';
import type { NetPlayerState } from './net/NetClient.ts';
import {
  NOTE_BLOCK_MAX_PITCH,
  beaconPrimary,
  beaconRegen,
  delayOf,
  hasEndPortalEye,
  isFenceGateOpen,
  isTrapdoorOpen,
  nextNotePitch,
  noteFrequency,
  notePitchOf,
  portalAxis,
  withBeaconPrimary,
  withBeaconRegen,
  withDelay,
  withEndPortalEye,
  withFenceGateOpen,
  withNotePitch,
  withTrapdoorOpen,
} from './core/registry/blockState.ts';
// 信标（K5，批次 117）：等级/范围/效果是纯逻辑（`world/Beacon.ts`），
// 界面与光柱各自一份（与告示牌的"文字表 / 编辑框 / 渲染器"三件套同构）
import {
  BEACON_REGEN_MIN_LEVEL,
  beaconEffects,
  beaconLevel,
  beaconRange,
} from './core/world/Beacon.ts';
import { BeaconScreen } from './ui/BeaconScreen.ts';
import { BeaconBeamRenderer } from './render/BeaconBeamRenderer.ts';
import { BorderRenderer } from './render/BorderRenderer.ts';
// 世界边界（K12，批次 175）：判定/夹取/伤害都是纯函数，主程序只负责接进去
import {
  DEFAULT_BORDER_SIZE,
  borderDamagePerSecond,
  clampToBorder,
  defaultBorder,
  describeBorder,
  normalizeBorder,
  type WorldBorder,
} from './core/world/WorldBorder.ts';
import { MobSpawner, MOB_DESPAWN_DISTANCE, type SpawnContext } from './core/entity/MobSpawner.ts';
import { raycastEntities } from './core/interaction/EntityRaycast.ts';
import { VoxelMaterial } from './render/VoxelMaterial.ts';
import { BlockOutline } from './render/BlockOutline.ts';
import { BlockOverlay, DAMAGE_STAGES } from './render/BlockOverlay.ts';
import { ParticleSystem } from './render/ParticleSystem.ts';
import { HandRenderer } from './render/HandRenderer.ts';
import { PlayerRenderer } from './render/PlayerRenderer.ts';
// 平色（浮标那种）一律走 `srgbColor`：`new THREE.Color(hex)` 会做一次 sRGB→线性，
// 而自定义 ShaderMaterial 是原样写帧缓冲的（见经验表 E15）
import { srgbColor } from './render/srgb.ts';
import { ScreenEffects, type ScreenEffect } from './render/ScreenEffects.ts';
import { World, toChunkCoord } from './core/world/World.ts';
import { Chunk, SECTION_COUNT, WORLD_MAX_Y, WORLD_MIN_Y } from './core/world/Chunk.ts';
import { DIMENSION_CYCLE, DIMENSION_LABELS, Dimension, isDimension, type DimensionId } from './core/gen/Dimension.ts';
import { Block, BLOCKS, blockDef, woolId,
  isBed,
  isSign,
  saplingTreeOf,
} from './core/registry/blocks.ts';
import {
  ARMOR_SLOT_BASE,
  ARMOR_SLOT_COUNT,
  armorInfoById,
  armorTile,
  createArmorWearer,
} from './core/registry/armor.ts';
import {
  breakSeconds,
  canHarvest,
  durabilityLabel,
  harvestRequirement,
  lootingBonus,
  meleeDamage,
  toolInfoById,
  type ToolInfo,
  canTill,
  tillableTo,
} from './core/registry/tools.ts';
import { OverworldGenerator } from './core/gen/OverworldGenerator.ts';
import { findSafeSpawn, planSpawnRegion } from './core/world/SpawnPoint.ts';
// 凋灵骷髅"只要塞里面刷"（批次 115）：要塞的位置要算，而算它需要下界的洞顶/地板/群系
import { NetherGenerator } from './core/gen/NetherGenerator.ts';
import { fortressAt, type FortressWorld } from './core/gen/NetherFortress.ts';
// 凋灵（批次 116，J14）：召唤仪式（纯逻辑）+ boss 本体
import { Wither, WITHER_TYPE } from './core/entity/Wither.ts';
import {
  consumeSummonSkulls,
  witherPatternAt,
  type WitherSummonWorld,
} from './core/world/WitherSummon.ts';
// 村庄的坐标（J22 验收用）：与 Worker 里同一份确定性放置逻辑，不必扫地形找房子。
// `nearestStronghold`（批次 114）是"最近的要塞"的**轻量**版本：要塞是地下结构，
// 位置不看地形，所以末影之眼每次出手都算得起（见那个函数的注释）
import { nearestStronghold, structureInstanceForTest } from './core/gen/Structures.ts';
import { PlayerPhysics, type PlayerInput } from './core/physics/PlayerPhysics.ts';
import { raycastVoxels, type RayHit } from './core/interaction/Raycast.ts';
// 中键拾取方块（批次 129）：三条规则是纯函数（`test:pickblock` 逐条钉住）
import { applyPickBlock, pickItemFor, planPickBlock } from './core/interaction/PickBlock.ts';
// 快捷栏的起点与大小：`planPickBlock` 返回的是**背包下标**，切选中格要减掉起点
import { HOTBAR_START } from './core/container/Inventory.ts';
import { planPlacement } from './core/interaction/Placement.ts';
// 刷怪蛋（批次 174）：手里那件是蛋就生成对应生物（`spawnEggMobOf` 查不到就返回 undefined）
import { spawnEggMobOf } from './core/registry/spawnEggs.ts';
// 炼药锅与桶装水（批次 176，G13）：规则是纯函数，"改方块 + 换手里的东西"在主程序
import {
  bucketFluidAt,
  drainCauldronToBottle,
  drainCauldronToBucket,
  fillCauldron,
  fillCauldronWithLava,
  isBucketSource,
  isLavaCauldronState,
} from './core/world/Cauldron.ts';
import {
  isDoorOpen,
  isDoorUpper,
  isSlabDouble,
  withDoorOpen,
  withDoorUpper,
} from './core/registry/blockState.ts';
// 床的两半（B13，批次 79）：`bedOtherHalf` / `bedFootPos` 都是纯函数，
// 主程序只负责照它们找另一半、拆对与定重生点
import { bedFootPos, bedOtherHalf } from './core/registry/blockState.ts';
import {
  TOTAL_SLOTS, HOTBAR_SIZE, Inventory, stackExtras, type ItemStack } from './core/container/Inventory.ts';
import { BrewingStand } from './core/container/BrewingStand.ts';
// 末影箱（批次 71）：它**不进容器表**（那张表按坐标存），这里直接持有一份共享的 27 格
import { EnderChest } from './core/world/EnderChest.ts';
// 潜影盒（批次 72）：内容跟着物品走——"取成物品能带的形式"与"倒回方块"两个口
import { fillShulkerBox, shulkerContentsOf } from './core/container/ShulkerBox.ts';
import { Furnace } from './core/container/Furnace.ts';
import { stationOfBlock } from './core/crafting/Smelting.ts';
import {
  flowerPotIndexFor,
  pottedPlantItem,
  pottedPlantName,
} from './core/registry/blocks.ts';
import { collisionBoxes } from './core/registry/blockShapes.ts';
import { Campfire } from './core/container/Campfire.ts';
import type { DropperEnv } from './core/container/Dropper.ts';
import { Hopper, type HopperEnv } from './core/container/Hopper.ts';
import { containerSlotCount } from './core/container/Transfer.ts';
import type { BlockContainer } from './core/world/BlockEntityStore.ts';
import { PrecipitationTicker } from './core/tick/Precipitation.ts';
import {
  DAWN_TIME,
  SLEEP_SECONDS,
  isNight,
  monstersNearBed,
  sleepRefusal,
  type SleepMob,
} from './core/survival/Sleep.ts';
// 亡灵被太阳晒（批次 124）：判据是纯函数（露天 + 白天 + 没下雨），
// 而"哪些生物会烧"是每种生物自己的一位数据（`MobType.burnsInDaylight`）
import { DAYLIGHT_BURN_SECONDS, FULL_SKY_LIGHT, sunBurns } from './core/world/Daylight.ts';
// 混凝土（批次 131）：粉末遇水凝固——规则是纯函数（`test:concrete` 逐条钉住）
import { hardenAround } from './core/world/Concrete.ts';
// 移动端降级策略（批次 130，TASKS N7）：动态分辨率 / 自适应视距 / 限帧 / 粒子总量。
// 策略本身是**纯函数**（`test:perfpolicy` 逐条钉住），这里只负责把结果落到渲染器与粒子上
import {
  DESKTOP_PIXEL_RATIO_CAP,
  MOBILE_INITIAL_RESOLUTION,
  MOBILE_PIXEL_RATIO_CAP,
  MOBILE_RESOLUTION_MIN,
  MOBILE_VIEW_DISTANCE,
  RESOLUTION_MIN,
  decorCloudsVisible,
  decorParticleBudget,
  decorRainFraction,
  effectivePixelRatio,
  fogRadiusStep,
  frameIntervalMs,
  initialPerfState,
  perfPolicyStep,
  viewDistanceCapFor,
  type PerfState,
} from './core/world/PerfPolicy.ts';
// 失眠与幻翼（批次 126，"连续三天不睡"才来的那只）：判据是纯逻辑，
// 但它只跟**玩家自己的状态**有关（与地形无关），所以不走 `MobSpawner`
import { PHANTOM_SPAWN_INTERVAL, phantomNightIsComing, phantomSpawnCount } from './core/survival/Insomnia.ts';
import { PHANTOM_TYPE } from './core/entity/Phantom.ts';
// 钓鱼（批次 81，G11）：规则（等待时间/咬钩窗口/状态机）在 survival，
// 战利品表在 registry，这里只做"世界怎么飞、钓上来的东西怎么进背包"
import {
  advanceFishing,
  beginCast,
  castVelocity,
  fishingBonuses,
  reelFishing,
  CAST_GRAVITY,
  IDLE_FISHING,
  MAX_CAST_DISTANCE,
  type FishingLanding,
  type FishingState,
} from './core/survival/Fishing.ts';
import { rollFishing } from './core/registry/fishing.ts';
// 告示牌上的文字（B12，批次 80）：表格 + 编辑界面 + 渲染三件，
// 都在主程序这一层接线（存储与规则在 `world/SignText.ts`，本身不碰 DOM/渲染）
import {
  SignTextStore,
  restoreSigns,
  serializeSigns,
  signKey,
} from './core/world/SignText.ts';
import { SignEditor } from './ui/SignEditor.ts';
// 设备不支持时的整屏提示（A10，批次 85）：判定在 core/render/webglSupport.ts（纯逻辑、可断言）
import { UnsupportedScreen } from './ui/UnsupportedScreen.ts';
import { probeBrowserGl, rendererFailure, type GlSupportFail } from './core/render/webglSupport.ts';
import { SignRenderer, type SignRenderItem } from './render/SignRenderer.ts';
// 物品展示框里挂着的东西（B14，批次 86）：与告示牌上的字同一条结构——
// 表 + 渲染器两件，主程序只做"右键放/取/转、定期对账、随存档走"
import {
  ItemFrameStore,
  frameKey,
  restoreFrames,
  serializeFrames,
  type FrameEntry,
} from './core/world/ItemFrame.ts';
import { ItemFrameRenderer, type FrameRenderItem } from './render/ItemFrameRenderer.ts';
// 成就 / 进度（M7，批次 87）：数据与判定在 core/progress/*（纯逻辑），
// 这里只做"在事件处报一声 + 弹提示 + 面板入口 + 随存档走"四件事
import { AdvancementTracker } from './core/progress/AdvancementTracker.ts';
import type { AdvancementDef, ProgressEvent } from './core/progress/advancements.ts';
import { AdvancementScreen } from './ui/AdvancementScreen.ts';
import { AdvancementToast } from './ui/AdvancementToast.ts';
import {
  CAKE_SLICES,
  cakeBites,
  flowerPotPlant,
  composterLevelOf,
  COMPOSTER_MAX_LEVEL,
  hopperOutputOffset,
  hopperOutputOf,
  isHopperLocked,
  withComposterLevel,
  sixFacingOf,
  sixFacingOffset,
  isLitState,
  withCakeBites,
  withFlowerPotPlant,
  withLitState,
} from './core/registry/blockState.ts';
import { EntityManager } from './core/entity/EntityManager.ts';
import { Arrow, type ArrowOptions } from './core/entity/Arrow.ts';
import {
  FLAME_SECONDS,
  arrowDamageAt,
  arrowSpeedAt,
  arrowsConsumed,
  bowEffects,
  canFire,
  canShoot,
  chargeAfter,
  knockbackStrength,
} from './core/entity/Bow.ts';
import { ItemEntity } from './core/entity/ItemEntity.ts';
import { XpOrb, splitXpOrbs } from './core/entity/XpOrb.ts';
import type { EntityContext } from './core/entity/Entity.ts';
import { EntityRenderer } from './render/EntityRenderer.ts';
import { InventoryScreen } from './ui/InventoryScreen.ts';
import { TouchControls, bindHotbarTouch, isTouchDevice } from './ui/TouchControls.ts';
import { drawItemIcon } from './ui/ItemIcon.ts';
import { updateDurabilityBar } from './ui/SlotVisuals.ts';
import {
  blockForItem,
  dropFor,
  EAT_SECONDS,
  blockDrops,
  durabilityOf,
  foodInfoById,
  itemName,
  saturationFrom,
  type FoodInfo,
  Item,
  extraCropDrop,
} from './core/registry/items.ts';
import { CAKE_SLICE_FOOD, canEat } from './core/registry/food.ts';
// 调参常量 / 世界配置 / 纯工具：**批次 101 从本文件搬出去的**（详见各文件头）
import {
  ATTACK_COOLDOWN,
  ATTACK_RANGE,
  BREAK_COOLDOWN,
  CHEW_INTERVAL,
  DEFAULT_WORLD_SEED,
  DRAGON_SPAWN_X,
  DRAGON_SPAWN_Z,
  END_FOG,
  END_FOG_FAR,
  END_FOG_NEAR,
  END_MIN_BRIGHTNESS,
  END_SKY,
  END_SKY_BRIGHTNESS,
  IDLE_INPUT,
  LAVA_FOG,
  LAVA_FOG_FAR,
  LAVA_FOG_NEAR,
  MESH_BUDGET_PER_FRAME,
  MOUSE_SENSITIVITY,
  NETHER_FOG,
  NETHER_FOG_FAR,
  NETHER_FOG_NEAR,
  NETHER_MIN_BRIGHTNESS,
  NETHER_SKY_BRIGHTNESS,
  PARTICLE_MIN_BRIGHTNESS,
  PLACE_COOLDOWN,
  PORTAL_ARRIVAL_TIMEOUT_FRAMES,
  RANDOM_TICK_RADIUS,
  REACH,
  RESPAWN_DELAY,
  TICK_SECONDS,
  TOUCH_SENSITIVITY,
  VIEW_DISTANCE,
  WATER_FOG,
  WATER_FOG_FAR,
  WATER_FOG_NEAR,
  lightBudgetForFrame,
  clampUnit,
  rodKey,
  spawnerKey,
  type WorldConfig,
} from './game/tuning.ts';
// 开发期初始物资（批次 181 起默认不发，只有 `?devkit=1` 才发）
import { devKitRequested, grantDevKit } from './game/startupKit.ts';
// 启动耗时台账（N8 的判据，批次 103）：量"首次访问等多久"与"进世界等多久"两个数
import { STARTUP_PHASES, startupTrace } from './game/startupTrace.ts';
// 诊断日志（批次 181）：平时常开、500KB 封顶；设置里有入口，`window.__mc.diag` 给自动化取
import { diag } from './game/diagnosticsRuntime.ts';
// 天空调色板与缓动（只被下面的"环境"一段用）
import {
  DAY_SKY,
  FLASH_SKY,
  NIGHT_SKY,
  OVERCAST_SKY,
  WHITE_SKY,
  smoothstep,
} from './render/SkyPalette.ts';

/**
 * "设备不支持 WebGL2"的约定错误消息（A10，批次 85）。
 *
 * 为什么不定义一个错误类：这个信号只在一处产生、一处消费（`boot` 里捕获），
 * 用消息字符串就够了；**但必须是常量**——两处各写一遍字符串，改一处就失效，
 * 而症状是"白屏"（最难查的那一类）。
 */
const UNSUPPORTED_GL_ERROR = 'unsupported-gl';

/**
 * 渲染器创建失败的原因（A10，批次 85）：构造函数里记下、`boot` 里读出来显示。
 *
 * ⚠️ 为什么放在模块级而不是实例字段上：**构造函数抛异常时实例根本不存在**，
 * 上层拿不到任何东西——只能靠这个"最后一份失败原因"。
 */
let lastRendererFailure: GlSupportFail | null = null;

/**
 * ---------------------------------------------------------------- App 类的段落目录
 *
 * 这个类很长（约 7000 行），**不要整份读**。它内部按职责分了段，每段的开头都有一行
 * `  // ---------------------------------------------------------------- <段落名>`
 * 的标记，按名字 grep 就能定位（行号会漂，所以这里只列名字）：
 *
 *   下界传送门（K8） · 联机（K2） · 存档（K1） · 环境 · 快捷栏 · 输入 · 视角（F7） ·
 *   方块交互 · 床与睡觉 · 告示牌上的字 · 物品展示框 · 成就 / 进度 · 村庄的人口 ·
 *   雷电与避雷针 · 刷怪笼 · 钓鱼 · 聊天与命令 · 下界传送门（K8） · 出生点 · 生存 ·
 *   主循环 · 开发调试接口
 *
 * ⚠️ 两个"下界传送门（K8）"是**故意的**（一处是门的状态与坐标换算、一处是交互），
 * grep 会命中两处，两个都看一眼。
 * ⚠️ 段落名是**导航用的锚点**：改动时别把标记行删掉，也别把内容搬到另一段不改标记——
 * 那会让"按名字定位"这条路失效（比文件长更糟，因为没人知道该信谁）。
 *
 * 长度参考：`方块交互` 与 `聊天与命令` 两段加起来约占全类的一半。
 * 真要动它们，先按段读；要**改结构**（拆类/拆模块）请当独立一批来做，别顺手拆。
 */

/**
 * 传送途中的三种"到达"（批次 111）——见 `pendingArrival` 的说明。
 * 放在类外：`resolvePortalArrival` 是唯一的分派处，类型也应当摆在能被它读到的位置。
 */
type PortalArrivalKind = 'nether' | 'end' | 'spawn';

/**
 * "准星压在它身上"的视线锥余弦（约 5°），批次 112 的末影人被注视激怒用。
 *
 * 原版用的是"头部包围盒与视线射线相交"，等价于一个**随距离收窄角度**的锥；
 * 这里用固定 5°（64 格外的横向误差约 5.6 格）——对"盯着它看"这件事够用，
 * 而且不必为了一个判定去算包围盒求交。
 */
const GAZE_CONE_COS = Math.cos((5 * Math.PI) / 180);

class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: World;
  private readonly chunkRenderer: ChunkRenderer;
  private readonly meshPool: MeshWorkerPool;
  /** 生命 / 饥饿 / 氧气 */
  readonly stats = new PlayerStats();
  /** 经验值与等级（I5） */
  readonly experience = new Experience();
  /** 当前维度（与 world.dimension 同步，供渲染与环境使用） */
  private dimension: DimensionId = Dimension.OVERWORLD;
  /** 末影龙（进入末地时生成；HUD 血条与水晶回血都要用它） */
  private endDragon: Dragon | null = null;
  /** 红石电路引擎（信号传播、元件状态、活塞推拉） */
  private readonly redstone = new RedstoneEngine();
  /** 手柄输入（Gamepad API）：与键盘/触摸翻译成同一套 PlayerInput */
  private readonly gamepad = new GamepadInput();
  /** 手柄的破坏/放置（按住持续，与鼠标的 leftDown/rightDown 等效） */
  private padAttack = false;
  private padUse = false;
  /** 本帧的手柄输入（collectInput 与视角更新共用；没连接手柄时为 null） */
  private gamepadState: ReturnType<GamepadInput['poll']> = null;
  /** 给红石引擎的"世界适配器"：把 World 与玩家/实体查询包成引擎需要的形状 */
  private readonly redstoneWorld: RedstoneWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    getState: (x, y, z) => this.world.getBlockState(x, y, z),
    setBlock: (x, y, z, id, state) => this.world.setBlockAndUpdate(x, y, z, id, state),
    setState: (x, y, z, state) => this.world.setStateAndUpdate(x, y, z, state),
    isLoaded: (x, z) => this.world.isLoaded(x, z),
    hasEntityAt: (x, y, z) => this.hasEntityAt(x, y, z),
    // 阳光传感器（批次 54）：红石引擎里唯二要看**外部世界的量**的元件之一
    getSkyLight: (x, y, z) => this.world.getSkyLight(x, y, z),
    // 避雷针（批次 83）：另一个——"被雷劈中的那 0.4 秒"由上面的脉冲表拿着，
    // 引擎每轮问一句就够了（与阳光传感器问天光完全同一条）
    isRodPowered: (x, y, z) => this.rodPulses.isPowered(x, y, z),
  };
  /**
   * TNT 的引信（批次 56）：点燃之后"闪 4 秒再炸"，这份状态跨帧存在这里。
   * 它需要一个很小的世界接口（读写方块与状态），爆炸本身是回调 → 走既有的 `explodeAt`。
   */
  private readonly primedTnt = new PrimedTnt();
  private readonly tntWorld: TntWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    getState: (x, y, z) => this.world.getBlockState(x, y, z),
    setBlock: (x, y, z, id, state) => this.world.setBlockAndUpdate(x, y, z, id, state),
    setState: (x, y, z, state) => this.world.setStateAndUpdate(x, y, z, state),
  };
  /** 末影龙血条（触摸端也共用；元素不存在时为 null） */
  private bossBarEl: HTMLElement | null = null;
  private bossFillEl: HTMLElement | null = null;
  /** 血条上那行字（末影龙 / 凋灵共用一条，见 `updateBossBar`） */
  private bossTitleEl: HTMLElement | null = null;
  /** 下界的背景色（暗红雾） */
  private readonly netherBackground = new THREE.Color(NETHER_FOG);
  /** 末地的背景色（星空黑） */
  private readonly endBackground = new THREE.Color(END_SKY);
  private readonly vitalsHud: VitalsHud;
  private readonly xpHud: XpHud;
  /** 天空：渐变穹顶 / 太阳月亮 / 星空 / 云 */
  private readonly sky: Sky;
  /** 天气：晴 / 雨 / 雷暴 */
  private readonly weather: Weather;
  /** 粒子：破坏碎块、水花、烟雾、火焰（E13） */
  private readonly particles = new ParticleSystem();
  /** 第一人称手持物品与手臂（E15） */
  private readonly hand: HandRenderer;
  /** 第三人称的玩家模型（F7）：只有第三人称才可见 */
  private readonly playerRenderer: PlayerRenderer;
  /** 当前视角模式（F7）；`V` 键循环，也写进设置持久化 */
  private cameraMode: CameraMode = 'first';
  /** 走路相位（弧度）：驱动玩家模型摆腿，按水平速度累加 */
  private walkPhase = 0;
  /** 走路摆动幅度 0~1（平滑过渡，避免停下时双腿一下子立正） */
  private walkAmount = 0;
  /** 全屏视野效果：水下 / 岩浆色罩（E16） */
  private readonly screenEffects = new ScreenEffects();
  /** 挖掘碎屑与挥手动画的节拍（秒） */
  private particleTimer = 0;
  /** 上一帧是否在水里（用来捕捉"入水那一瞬间"并溅水花） */
  private wasInWater = false;
  /** 岩浆里冒火焰粒子的节拍（秒） */
  private flameTimer = 0;

  // ---------------------------------------------------------------- 下界传送门（K8）

  /** 站在传送门里的累计 tick（20Hz 结算，普通 80 tick = 4 秒） */
  private portalTicks = 0;
  /** 传送后的冷却（tick）：300 = 15 秒，免得一落地就被传回去 */
  private portalCooldownTicks = 0;
  /**
   * 末地传送门的落地计时（K9，批次 111）：末地传送门是**碰到就传**
   * （原版如此，不像下界门要站 4 秒），所以只等 1 tick 让物理先站定。
   */
  private endPortalTicks = 0;
  /**
   * 传送途中：维度已经切过去了、正在等目的地的区块加载。
   *
   * 不为 null 时**冻结玩家物理**——新区块还没生成出来，`getBlock` 一律返回空气，
   * 不冻住的话玩家会在"空"世界里一直往下掉。加载完就把玩家放进目的地那座门里。
   *
   * `kind` 区分三种"到达"（批次 111 起）：
   *  - `nether`：另一头找一座旧门、没有就照着原样新建一座（K8 那一套）
   *  - `end`：末地那一侧先补出 5×5 黑曜石到达平台，再把人放上去
   *  - `spawn`：从末地回主世界，落在**世界出生点**（末地传送门只有一个方向的"正门"）
   */
  private pendingArrival: (PortalTarget & {
    axis: PortalAxis;
    frames: number;
    kind: PortalArrivalKind;
  }) | null = null;

  /** 传送门逻辑看到的世界（`PortalWorld` 接口） */
  private readonly portalWorld: PortalWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    getState: (x, y, z) => this.world.getBlockState(x, y, z),
    // 走 setBlockAndUpdate：光照、网格与增量存档都会跟着更新
    setBlock: (x, y, z, id, state) => this.world.setBlockAndUpdate(x, y, z, id, state),
  };

  /** 凋灵召唤仪式看到的世界（批次 116，与 `portalWorld` 同一个适配器写法） */
  private readonly witherSummonWorld: WitherSummonWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    setBlock: (x, y, z, id, state) => this.world.setBlockAndUpdate(x, y, z, id, state),
  };
  /** 生物渲染 */
  private readonly mobRenderer: MobRenderer;
  /** 生物生成规则 */
  private readonly mobSpawner = new MobSpawner();
  /**
   * 下界那套"锚点查询"（批次 115）：只用来回答"这一列在不在要塞里"（见 `inStructure`）。
   *
   * 懒建——主世界/末地玩一整天都不会用到它；也不用留生成器本身的引用，
   * 那几个闭包已经把生成器拴住了。
   */
  private netherStructureWorld: FortressWorld | null = null;
  private readonly domeTop = new THREE.Color();
  private readonly domeHorizon = new THREE.Color();
  /** 玩家所在地表是否为寒冷群系（决定下雪还是下雨），每秒复查一次 */
  private snowyHere = false;
  private snowCheckTimer = 0;
  private readonly deathEl: HTMLElement;
  /** 帧时间累积成 20Hz 游戏 tick */
  private tickAccumulator = 0;
  /** 本次下落起始高度（用于摔落伤害） */
  private fallStartY: number | null = null;
  private pendingFallDistance = 0;
  private respawnCountdown = 0;
  /** 这一条命是否已经结算过死亡掉落（避免每帧都掉一次） */
  private deathHandled = false;
  /** 水面动画的累计时间（秒）：与昼夜时间分开，/time 不影响它 */
  private waterTime = 0;
  /** 验收脚本用：强制显示的破坏阶段（-1 = 走正常逻辑） */
  private forcedDamageStage = -1;
  /** 计划刻队列（流体等"延迟若干 tick 再处理"的方块） */
  private readonly scheduler = new TickScheduler();
  /** 随机刻看到的世界（掉落回调接到掉落物系统上） */
  private readonly tickWorld: TickWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    setBlock: (x, y, z, id) => this.world.setBlockAndUpdate(x, y, z, id),
    // 藤蔓（B11）：读"挂了哪几面"、写"新的一节挂在哪一面"
    getState: (x, y, z) => this.world.getBlockState(x, y, z),
    setBlockWithState: (x, y, z, id, state) => this.world.setBlockAndUpdate(x, y, z, id, state),
    drop: (id, count, x, y, z) => this.spawnDrop(id, count, x, y, z),
    // 作物生长要判光照（H13）：取天光与方块光的较大者，与原版"作物看最亮的那一项"一致
    lightAt: (x, y, z) =>
      Math.max(this.world.getSkyLight(x, y, z), this.world.getBlockLight(x, y, z)),
    // 火焰被雨浇灭要判"露不露天"（I12）：这里必须是**天光**，
    // 方块光会被火焰自己的 15 级照满，拿它当判据等于"在洞里也在下雨"
    skyLightAt: (x, y, z) => this.world.getSkyLight(x, y, z),
    // 雪层融化只看**方块光**（K11）：白天的天光不会把雪晒化
    blockLightAt: (x, y, z) => this.world.getBlockLight(x, y, z),
    // "这里正在下雪吗"＝正在降水 **且** 这一列是寒冷群系（原版就是按列判的）
    snowingAt: (x, _y, z) => this.weather.raining && this.isSnowyColumn(x, z),
    // TNT（批次 56）：火或岩浆挨着就要点着（随机刻里判，点燃走引信表）
    igniteTnt: (x, y, z) => {
      this.primedTnt.prime(this.tntWorld, x, y, z);
    },
    // `raining` 每 tick 现写（见 `tickWorldBlocks`）——天气是变量，
    // 用 getter 会拿到 `this` 指向对象本身而不是 App 实例
    raining: false,
  };
  /**
   * 流体看到的世界：读写方块与状态 + 把后续流动排进计划刻队列。
   * 写方块走 `setBlockAndUpdate`（会触发光照与重网格化），状态一并带上液面等级。
   */
  private readonly fluidWorld: FluidWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    getState: (x, y, z) => this.world.getBlockState(x, y, z),
    setFluid: (x, y, z, id, state) => this.world.setBlockAndUpdate(x, y, z, id, state),
    schedule: (x, y, z, delay) => {
      this.scheduler.schedule(x, y, z, this.dimension, delay);
    },
  };
  /**
   * 区块级降水刻（批次 47）：下雪时**空气里自己长出第一层雪**。
   * 它是独立的一刻（每 0.5 秒 6 个点），不走随机刻——理由见 `core/tick/Precipitation.ts`。
   */
  private readonly precipitation = new PrecipitationTicker({
    snowingAt: (x, _y, z) => this.weather.raining && this.isSnowyColumn(x, z),
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    skyLightAt: (x, y, z) => this.world.getSkyLight(x, y, z),
    setBlockWithState: (x, y, z, id, state) => this.world.setBlockAndUpdate(x, y, z, id, state),
  });

  /** 随机刻改动世界的累计次数（调试面板与验收用） */
  private randomTickChanges = 0;
  /** 流体流动改动的累计次数（验收用） */
  private fluidChanges = 0;
  /** 爆炸炸掉的方块数（验收用） */
  private explosionBlocks = 0;
  /** 状态效果 HUD（右上角）与它的内容签名（内容没变就不重建 DOM） */
  private readonly effectsHudEl = document.getElementById('effects-hud');
  private effectsHudSignature = '';
  private spawnPoint: [number, number, number] = [0.5, 80, 0.5];
  /**
   * 睡出来的**重生点**（B13 / I13，批次 79）。
   *
   * 与 `spawnPoint`（世界的出生点，用于"床没了"时的兜底）分开记：
   *  - `x/y/z` 是**床脚**那一格（原版重生点在床脚）；
   *  - `dimension` 一起记：在下界睡觉、回主世界死掉，要能回到那张床所在的世界；
   *  - 死亡时先校验"那张床还在不在"，不在就回退到世界出生点（原版行为）。
   */
  private bedSpawn: { x: number; y: number; z: number; dimension: DimensionId } | null = null;
  /** 正在睡觉：非 null 时冻结移动与交互，只推进睡觉计时 */
  private sleeping: { x: number; y: number; z: number } | null = null;
  /** 已经躺了多久（秒），到 `SLEEP_SECONDS` 就天亮 */
  private sleepTimer = 0;
  /** 睡觉遮罩（index.html 的 `#sleep`；没接上就什么都不显示，逻辑照旧） */
  private readonly sleepEl = document.getElementById('sleep');
  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  /** 近战冷却 */
  private attackCooldown = 0;
  /** 本帧打中了生物，就不再破坏方块（否则会连脚下的方块一起挖掉） */
  private suppressBreaking = false;
  /** 上一帧的实体上下文（攻击生物时要把掉落物交回给世界） */
  private lastEntityContext: EntityContext | null = null;
  private readonly solidMaterial: VoxelMaterial;
  private readonly translucentMaterial: VoxelMaterial;
  private readonly skyColor: THREE.Color;
  private readonly outline = new BlockOutline();
  /** 破坏裂纹与命中面高亮（G2 / G3） */
  private readonly blockOverlay: BlockOverlay;
  private readonly physics = new PlayerPhysics();
  private readonly inventory = new Inventory();
  private readonly inventoryScreen: InventoryScreen;
  private readonly entities = new EntityManager();
  private readonly entityRenderer: EntityRenderer;
  /**
   * 触摸操作层。只有手势设备才创建——桌面端不创建，
   * 这样键盘/鼠标路径完全不受影响，也不会多出一层挡事件的 DOM。
   */
  private touch: TouchControls | null;
  /** 触摸端"轻点"产生的一次性放置/交互请求，由 updatePlacing 消费 */
  private touchPlaceRequest = false;
  /**
   * 触摸端轻点落在生物上（批次 181）：这一下是攻击，不是放置。
   *
   * 为什么不在 `onTap` 里直接结算：攻击要走 `updateAttacking` 里那条统一路径
   *（冷却、暴击、附魔、耐久、进度上报都在那儿），拆成两份迟早分叉。
   */
  private tapAttackRequest = false;
  /**
   * 轻点那一下**在屏幕上点到**的生物（批次 185）。
   *
   * 用户："即使准星没有在动物身上，我用手机触摸到它，只要在攻击范围内也应该打到。"
   * 触摸端拿不到"鼠标位置"，但 `onTap` 会带手指坐标，于是这里记下"点中的那只"，
   * 由 `updateAttacking` 统一结算（与准星那条路共用冷却/伤害/耐久）。
   */
  private tapAttackMob: Mob | null = null;
  /** 背包界面是否打开；打开时暂停移动、视角与方块交互 */
  private uiOpen = false;
  /**
   * 从后台回来时那层"游戏已暂停 · 点击继续"的遮罩（批次 184）。
   *
   * 用户要求："从后台返回时，先不显示游戏页面，显示暂停页面；点击页面自动横屏全屏恢复游戏。"
   * 手机上切出去再回来，浏览器可能已经退出了全屏、或者方向被系统转回去了；
   * 直接把运行中的画面摆到玩家面前，既容易被吓一跳，也常常是"一回来看见小窗/竖屏"。
   */
  private resumeGateEl: HTMLDivElement | null = null;
  /** 刚刚切到过后台：下一次回到前台要先落到暂停页（见 `handleReturnFromBackground`） */
  private wasHidden = false;
  /**
   * 启动期的渐进视距（批次 100）：开局先只请求 3 格半径，之后每 0.5 秒往外涨一格。
   *
   * 见 `core/world/StartupRamp.ts` 的文件头：开新世界原来是一次性把整个视距
   * （半径 12 ≈ 440 个区块）全派出去，那几秒的 CPU 就是"创建世界很慢"的来源。
   */
  private readonly startupRamp = new StartupRamp();
  /**
   * Android 返回键 / 侧滑返回 = 关界面（批次 96，对齐基岩版）。
   *
   * 手机上**没有 Esc**：原来关界面只有"点空白处"，而系统的返回手势会直接退出页面
   * （PWA 里等于退出游戏）——想关背包反而把游戏关了。
   */
  private readonly backButton = new BackButton({
    pushState: () => {
      try {
        window.history.pushState({ mcUi: true }, '');
      } catch {
        // 某些内嵌浏览器禁用 history（隐私模式/iframe），忽略：退回"只能点空白处关"
      }
    },
    back: () => {
      try {
        window.history.back();
      } catch {
        /* 同上 */
      }
    },
    closeTopUi: () => this.closeTopUi(),
  });
  private readonly hotbarSlots: HTMLDivElement[] = [];
  /** 聊天与命令输入（左下角消息栏 + 命令输入行） */
  private readonly chat = new ChatInput();
  /**
   * 告示牌上的文字（B12，批次 80）：一张"按坐标存"的表 + 编辑器 + 渲染器。
   *
   * 三件分开的理由与容器那一族一致：**规则**（几行、几个字、空牌子不写）在
   * `world/SignText.ts`（纯逻辑、可离线断言），**界面**在 `ui/SignEditor.ts`，
   * **画字**在 `render/SignRenderer.ts`——主程序只做三件事：右键打开、写进表、定期对账。
   */
  private readonly signText = new SignTextStore();
  private readonly signEditor = new SignEditor();
  /** 信标界面（K5，批次 117）：右键信标打开 */
  private readonly beaconScreen = new BeaconScreen();
  /** 信标的光柱（K5）：运行时实体，不烘进区块网格 */
  private readonly beaconBeamRenderer = new BeaconBeamRenderer();
  /** 世界边界的蓝墙（K12，批次 175）：四道跟着玩家平移的半透明面 */
  private readonly borderRenderer = new BorderRenderer();
  /** 世界边界状态（中心 + 边长）：进存档，`/worldborder` 改它 */
  private border: WorldBorder = defaultBorder();
  /** 越界伤害的结算计时（边界伤害是**每秒一次**，不是每帧） */
  private borderDamageTimer = 0;
  /**
   * 场上已知的信标（K5，批次 117）：键是 `beaconKey(维度, x, y, z)`。
   *
   * 与避雷针/刷怪笼那两张索引同一套：**区块加载时扫出来、卸载时忘掉**，
   * 放置/破坏时随手登记——因为光柱得逐帧画、效果得每秒挂，
   * 而这些都要先知道"附近哪儿有信标"。
   *
   * 里面存的 `level` 是**金字塔等级缓存**（每秒重算一次：最贵的四级要读 164 格，
   * 不能每帧算），`beams` 那一份则按维度过滤后逐帧同步给渲染器。
   */
  private readonly beacons = new Map<string, { level: number; refresh: number }>();
  /** 信标效果的节拍（秒）：攒够 1 秒给范围内的玩家挂一次 */
  private beaconEffectTimer = 0;
  private readonly signRenderer = new SignRenderer();
  /** 正在编辑哪一块牌子（编辑器是模态，一次只会有一个） */
  private editingSign: { x: number; y: number; z: number } | null = null;
  /** 文字对账的节拍器（每 0.25 秒一次：区块加载/卸载、光照变化都会在这里被吸收） */
  private signSyncTimer = 0;
  /**
   * 物品展示框（B14，批次 86）：一张"按坐标存挂着什么"的表 + 一个渲染器。
   *
   * 与告示牌同构，只是**装的是一整件物品**（id + 数量 + 耐久 + 附魔 + 名字），
   * 规则在 `world/ItemFrame.ts`（纯逻辑、可离线断言），这里只做接线。
   * 渲染器要图集（物品图标从图集取 UV），所以在构造函数里建。
   */
  private readonly itemFrames = new ItemFrameStore();
  private readonly itemFrameRenderer: ItemFrameRenderer;
  /**
   * 成就 / 进度（M7，批次 87）。
   *
   * 判定全在 `core/progress/AdvancementTracker.ts`（纯逻辑、可离线断言）；
   * 这里只做四件事：**在事件处报一声**、**弹提示**、**面板入口**、**随存档走**。
   */
  private readonly advancements = new AdvancementTracker();
  private readonly advancementScreen: AdvancementScreen;
  private readonly advancementToast: AdvancementToast;
  /** 游戏内一行提示（批次 181）：视角/模式切换、全屏状态… */
  private readonly hudToast = new HudToast(document.getElementById('hud') ?? document.body);
  /** 准星下方那行"这是什么"（批次 181） */
  private readonly targetInfoEl: HTMLDivElement;
  /** 目标信息的刷新节拍（5Hz，别每帧写 DOM） */
  private targetInfoTimer = 0;
  private targetInfoText = '';
  /**
   * 进度系统"上岗"了没有（世界与存档都读完）。
   *
   * ⚠️ 进世界之前背包里已经塞着**开发期初始物资**（见 `STARTING_HOTBAR`）：
   * 上岗时会对着背包对一次账（"已经拿在手里的算已达成"），而那一趟**不弹卡片**
   * ——否则创建世界的一瞬间会噼里啪啦跳出六七张"进度已达成"，
   * 看着像出了 bug。之后的每一次达成都会正常弹。
   */
  private progressReady = false;
  /** 进世界那一趟对账时不弹卡片（只写一条汇总的聊天记录） */
  private suppressProgressToasts = false;
  /** 背包对账的节拍器（每 1 秒一次，见 `reconcileObtainProgress`） */
  private progressReconcileTimer = 0;
  /**
   * 钓鱼（批次 81，G11）。
   *
   * 浮标**不做成实体**：它没有碰撞、不参与战斗、也不需要联机同步，
   * 只是"玩家手里这一竿的过程状态"——与 TNT 的引信（`PrimedTnt`）同一条取舍。
   * 做成实体的话要动 `EntityManager` / 渲染器 / 存档三处，收益只有"别人能看见我的浮标"。
   */
  private fishing: FishingState = IDLE_FISHING;
  /** 浮标的当前位置与速度（`flying` 阶段用；落水后位置固定） */
  private bobber: { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null = null;
  /** 世界过了几天（批次 84，月相按它取模）；随存档走，老存档按第 0 天算 */
  private dayCount = 0;
  /**
   * **连续多少天没睡**（批次 126，幻翼的依据）。睡着归零、每天日出 +1。
   * 存进存档：它是"跨会话"的状态（睡了三天没睡的存档，进来当晚就该有幻翼）。
   */
  private daysWithoutSleep = 0;
  /** 这一夜已经派过幻翼没有（一夜只派一批，免得刷成灾难） */
  private phantomSpawnedTonight = false;
  /** 派幻翼的节拍（秒）：攒够 `PHANTOM_SPAWN_INTERVAL` 才试一次 */
  private phantomTimer = 0;
  /** 浮标的小方块（第一次抛竿时懒建） */
  private bobberMesh: THREE.Mesh | null = null;
  /**
   * 避雷针的位置索引（批次 83）与它们的脉冲表。
   *
   * 为什么要索引：打雷时要问"玩家 128 格内有没有避雷针"，而**按区块扫一遍**
   * （16×16×384 ≈ 10 万次读）每打一次雷做一次太贵。索引在**区块加载时建**（一次 10 万次读，
   * 摊掉）、放下/拆掉时维护，于是打雷那一瞬间的查询是常数级的。
   * 键是 `x,y,z`（与脉冲表同一套写法）。
   */
  private readonly lightningRods = new Set<string>();
  /**
   * 刷怪笼索引（批次 92）：键 `x,y,z`，值 = 距离下次生成还有几秒。
   *
   * 与避雷针同一套做法（区块加载时扫一遍、卸载时忘掉、放下/拆掉时维护），
   * 理由是同一个：**每个笼子每帧去扫区块太贵**，而扫描只在"这一格刚变成笼子"时做一次。
   * 倒计时直接放进 Map 的值里（而不是另开一张表）：两者永远同时存在，
   * 分成两张表迟早会有一张忘了清。
   */
  private readonly spawners = new Map<string, number>();
  private readonly rodPulses = new RodPulses();
  /** 下一次打雷的倒计时（只在雷暴里走） */
  private strikeTimer = 0;
  /** 玩家名（联机时用服务端给的，单机固定"玩家"） */
  private playerName = '玩家';
  /** 难度（I7）：保存在世界里 */
  private difficulty: Difficulty = 'normal';
  /** 难度被命令改动时的回调（主菜单用它回写世界清单） */
  onDifficultyChanged: ((value: Difficulty) => void) | null = null;
  /** 游戏模式改了（批次 181）：主菜单用它回写世界清单 */
  onGameModeChanged: ((mode: GameMode) => void) | null = null;
  /** 状态效果（I4）：随身携带，死亡后清空 */
  private readonly effects = new StatusEffects();
  /** 游戏规则（I11）：保存在世界里 */
  private rules: GameRules = { ...DEFAULT_GAME_RULES };
  /** 配方书：列出所有配方，材料够就能一键合成 */
  private readonly recipeBook: RecipeBook;
  /** 物品提示框（快捷栏与背包共用同一个，位置跟着指针走） */
  private readonly tooltip = new Tooltip();
  /** 快捷栏的提示委托只挂一次：buildHotbar 可能被重复调用 */
  private hotbarTooltipBound = false;

  /** 一天中的时刻 [0,1)：0 = 日出，0.25 = 正午，0.5 = 日落，0.75 = 午夜 */
  private timeOfDay = 0.12;
  /** 一个游戏日为 20 分钟（与原版一致） */
  private readonly dayLengthSeconds = 1200;

  /**
   * 自动保存间隔（秒）。批次 172 起可调（TASKS M20，30 / 60 / 120），
   * 默认 30——与原版的自动保存节奏接近；`applySettings()` 会按设置覆盖它。
   */
  private autoSaveInterval = 30;
  private autoSaveTimer = 0;
  /** 上次保存的结果（调试面板与验收脚本用） */
  private lastSaveAt = 0;
  private lastSaveMs = 0;
  private saveCount = 0;
  /** 末影龙是否已被击败（会写进存档，决定重进末地要不要再生成 boss） */
  private dragonDefeated = false;

  /**
   * 末影箱（批次 71）：**一份 27 格，跟着玩家走**。
   *
   * ⚠️ 它**不进 `world.containers`**（那张表按坐标存），存档走玩家存档
   * （`PlayerSave.enderChest`）——"跨坐标共享"这条规矩收在 `EnderChest` 里（可离线断言）。
   */
  private readonly enderChest = new EnderChest();

  /**
   * 联机（K2）：服务端只发种子与方块增量，地形各算各的。
   * 远程玩家借用生物渲染器的模型，位置完全由网络驱动，不进 EntityManager（不跑 AI/物理）。
   */
  private readonly net = new NetClient({
    onWelcome: (seed, selfId, players, edits) => this.onNetWelcome(seed, selfId, players, edits),
    onPlayer: (player) => this.onNetPlayer(player),
    onLeave: (id) => this.onNetLeave(id),
    onBlock: (x, y, z, id, state, dimension) => this.onNetBlock(x, y, z, id, state, dimension),
    onChat: (id, name, text) => {
      this.chat.push(`<${name}> ${text}`, 'player');
      this.chatLine = `<${name}> ${text}`;
      this.chatUntil = performance.now() + 8000;
      void id;
    },
    onStatus: (connected, detail) => {
      this.netStatus = detail;
      if (!connected) this.remotePlayers.clear();
    },
  });
  private readonly remotePlayers = new Map<number, Mob>();

  /**
   * 活着的药水云（K4 尾巴）：滞留药水摔出来的 + 末影龙吐出来的血息。
   *
   * **不是实体**：原版的药水云只有"效果 + 粒子"，没有碰撞盒也不参与物理，
   * 做成实体反而要多接线渲染、存档、联机三处。这里就是主程序自己维护的一小串状态，
   * 生命周期与范围都走 `survival/PotionCloud.ts` 里的纯函数。
   */
  private readonly clouds: PotionCloud[] = [];
  /** 音效引擎（程序化合成，不依赖音频文件） */
  private readonly audio = new AudioEngine();
  /** 脚步音的距离累积器（走满一格半响一声） */
  private stepDistance = 0;
  private lastStepX = 0;
  private lastStepZ = 0;
  /** 本机设置（视距/视野/音量/灵敏度/调试信息），存在 localStorage */
  private readonly settings: GameSettings = loadSettings();
  private readonly settingsScreen: SettingsScreen;
  /** 当前生效的视距（区块）；自适应会在这个值上浮动，玩家设置的是上限 */
  private viewDistance = VIEW_DISTANCE;
  /**
   * 帧时间的指数滑动平均（毫秒）。
   * 用滑动平均而不是"上一帧耗时"：偶发的一次卡顿（GC、区块上传）不该触发降视距。
   */
  /**
   * 降级策略的状态：帧时间滑动平均 / 分辨率倍率 / 当前视距 / 冷却（批次 130）。
   *
   * 之前这三样是**散在三个字段里**（`frameTimeAvg` / `viewDistance` / `adaptiveCooldown`），
   * 而策略本身写在主循环里——只能靠浏览器跑七秒才看得到。现在状态归 `PerfState`、
   * 策略归 `perfPolicyStep`（纯函数），主程序只负责"把结果落下去"。
   */
  private perf: PerfState = initialPerfState(12);
  /** 手机背板画到 1.5 而不是 2：填充率大约少一半，自适应仍可在这顶下面升降 */
  private readonly pixelRatioCap = isTouchDevice() ? MOBILE_PIXEL_RATIO_CAP : DESKTOP_PIXEL_RATIO_CAP;
  /** 调试用：把帧时间固定成这个值（毫秒），0 表示用真实值。验收脚本靠它稳定复现"掉帧" */
  private simulatedFrameTime = 0;
  // ⚠️ 自适应视距的冷却（`adaptiveCooldown`）在**批次 130** 并进了 `this.perf.cooldown`：
  // 分辨率与视距共用同一个冷却倒计时，这样"先降分辨率、再降视距"之间的间隔是统一的
  private netStatus = '未连接（按 L 联机）';
  private chatLine = '';
  private chatUntil = 0;

  private yaw = 0;
  private pitch = -0.22;
  private readonly keys = new Set<string>();
  private locked = false;
  /** 在飞（**只在创造模式里**有意义；批次 181 起它与"模式"分开） */
  private flying = false;
  /** 游戏模式（生存/创造）：免伤、瞬间破坏、无限物品这些能力看它，不看 `flying` */
  private gameMode: GameMode = 'survival';
  private hotbarIndex = 0;

  private hit: RayHit | null = null;
  private breakingKey = '';
  private breakProgress = 0;
  private breakCooldown = 0;
  private placeCooldown = 0;
  private leftDown = false;
  private rightDown = false;

  /** 盔甲外观：装备 id 串成的 key（变了才重算颜色）与四个部位的甲片颜色 */
  private armorKey = 'init';
  private readonly armorColors: (number | null)[] = [null, null, null, null];

  /** 当前打开的附魔台坐标（数周围书架用） */
  private enchantTablePos: { x: number; y: number; z: number } | null = null;

  /** 拉弓蓄力 0~1（J9）与"这一次拉弓是否还在进行"的标记 */
  private bowCharge = 0;
  private bowDrawing = false;

  /** 进食进度（0~1）与"距离下一次咀嚼"的计时 */
  private eatProgress = 0;
  private chewTimer = 0;

  /** 方块改动后等待光照收敛、需要再次重刷网格的坐标 */
  private readonly pendingSettle: number[] = [];

  private frames = 0;
  private fpsTimer = 0;
  private fps = 0;
  private lastTime = performance.now();
  private lastCenterCx = Number.NaN;
  private lastCenterCz = Number.NaN;
  private spawnResolved = false;
  private spawnSearchX = 0;
  private spawnSearchZ = 0;
  /** 读档完成前不能让“新世界出生点”抢先覆盖存档坐标。 */
  private waitingForSaveRestore = false;
  private loadingCleared = false;
  /**
   * 已经销毁（批次 181）。
   *
   * 三处要认它：主循环不再排下一帧、异步读档回来不要往旧世界写、
   * 退出流程本身不要重入。
   */
  private disposed = false;
  /** 全局监听（window / document）的解绑开关 */
  private readonly listeners = new AbortController();
  /** 应用内退出到主菜单之后的回调（由 `boot()` 挂上：把菜单拉回来） */
  onExitToMenu: (() => void) | null = null;

  constructor(
    /** 渲染画布的挂载点；`dispose()` 要把画布从这里摘掉 */
    private readonly container: HTMLElement,
    private readonly debugEl: HTMLElement,
    private readonly atlas: TextureAtlas,
    vitalsEl: HTMLElement,
    deathEl: HTMLElement,
    /** 存档（打开失败时为 null —— 无痕模式/配额满时游戏照常可玩，只是不保存） */
    private readonly save: SaveGame | null = null,
    /** 本局玩的是哪个世界（主菜单选出来的）；缺省时用一个固定种子的默认世界 */
    private readonly worldConfig: WorldConfig = {
      id: LEGACY_WORLD_ID,
      name: '默认世界',
      seed: DEFAULT_WORLD_SEED,
      worldType: 'default',
      difficulty: 'normal',
    },
  ) {
    this.world = new World(this.worldConfig.seed, this.worldConfig.worldType);
    this.gameMode = normalizeGameMode(this.worldConfig.gameMode);
    this.waitingForSaveRestore = Boolean(save?.hasSave);
    // TNT（批次 56）：红石引擎只负责"判定这里通电了"，点火交给拿着引信表的那一方
    this.redstone.onTntIgnite = (x, y, z) => {
      this.primedTnt.prime(this.tntWorld, x, y, z);
    };
    // 投掷器（批次 59）：引擎只负责"判定这里来了一个上升沿"，吐什么、
    // 吐到哪去（塞进对面的容器还是掉在地上）都在容器与实体那一侧
    this.redstone.onDispense = (x, y, z) => {
      this.dispenseFrom(x, y, z);
    };
    this.deathEl = deathEl;
    this.vitalsHud = new VitalsHud(vitalsEl);
    // 经验条挂在 HUD 根上而不是 #vitals 里：它是绝对定位的独立一行，
    // 塞进 #vitals 那个 flex 列会被挤到别的地方
    this.xpHud = new XpHud(document.getElementById('hud') ?? container);
    // 准星下方的目标名称（批次 181）：手机上"这是什么东西"原来只能靠猜
    this.targetInfoEl = document.createElement('div');
    this.targetInfoEl.id = 'target-info';
    this.targetInfoEl.className = 'hidden';
    (document.getElementById('hud') ?? container).appendChild(this.targetInfoEl);
    // 渲染器创建兜底（A10，批次 85）：即使前面探测到了 WebGL2，真正创建时也可能失败
    // （显存不足、上下文数量到顶——手机上真实发生过）。失败时**给一块能看懂的界面**，
    // 而不是让 `new WebGLRenderer` 那行红字把整页留成白屏
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
        // 手机上 high-performance 会钉在大核/高功耗 GPU，几分钟后降频，帧时间反而更差
        powerPreference: isTouchDevice() ? 'default' : 'high-performance',
        alpha: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastRendererFailure = rendererFailure(message);
      throw new Error(UNSUPPORTED_GL_ERROR);
    }
    if (isTouchDevice()) this.perf = { ...this.perf, resolutionScale: MOBILE_INITIAL_RESOLUTION };
    this.renderer.setPixelRatio(effectivePixelRatio(devicePixelRatioValue(), this.perf.resolutionScale, this.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.skyColor = new THREE.Color(0x8fc7ff);
    this.scene.background = this.skyColor;

    // 远裁面用 `cameraFarFor`：它保证罩得住天空层（穹顶半径 180）。
    // 只按"视距×16+32"算的话，手机上（视距 6~8）会小于穹顶半径，
    // 结果屏幕正中会被裁出一个颜色不同的圆洞
    this.camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.1,
      cameraFarFor(this.viewDistance),
    );
    this.camera.rotation.order = 'YXZ';

    // 贴图尺寸与内缩交给着色器：贪心网格化合并出的大四边形要沿面平铺贴图
    const atlasShape = { tileSpan: atlas.tileSpan, tileInset: atlas.tileInset };
    this.solidMaterial = new VoxelMaterial(atlas.texture, atlasShape);
    this.translucentMaterial = new VoxelMaterial(atlas.texture, { translucent: true, ...atlasShape });
    // 必须在 applyEnvironment() 之前创建：环境函数会把昼夜亮度推给它
    this.entityRenderer = new EntityRenderer(this.scene, atlas);
    // 天空与天气同样要先建好：applyEnvironment 会按天气压暗天空、拉近雾
    this.sky = new Sky();
    this.scene.add(this.sky.object);
    this.weather = new Weather();
    this.scene.add(this.weather.object);
    // 手持物品与粒子都要在 applyEnvironment() 之前建好：环境函数会推亮度给它们
    this.hand = new HandRenderer(atlas);
    this.scene.add(this.particles.object);
    // 生物亮度直接用方块材质的天光倍率，保证与地形明暗一致
    this.mobRenderer = new MobRenderer(this.scene, () => this.solidMaterial.skyBrightnessValue);
    // 玩家模型与生物用同一套亮度口径，第三人称下才可见
    this.playerRenderer = new PlayerRenderer(this.scene, () => this.solidMaterial.skyBrightnessValue);
    this.bossBarEl = document.getElementById('boss-bar');
    this.bossFillEl = document.getElementById('boss-fill');
    this.bossTitleEl = document.querySelector('#boss-bar b');
    this.applyEnvironment();

    // 网格化放在独立 Worker 池里：地形生成的 Worker 忙于长任务，混在一起会互相拖慢。
    // 留 2 个核心给主线程（渲染 + 物理），最多用 2 个做网格化。
    // 手机核心又小又挤：再开两个网格化 Worker 会跟主线程抢同一颗大核，表现为一卡一卡
    const meshWorkers = isTouchDevice()
      ? 1
      : Math.max(1, Math.min(2, (navigator.hardwareConcurrency ?? 4) - 2));
    this.meshPool = new MeshWorkerPool(meshWorkers);
    this.chunkRenderer = new ChunkRenderer(
      this.scene,
      atlas,
      this.world,
      this.solidMaterial.material,
      this.translucentMaterial.material,
      this.meshPool,
    );
    this.scene.add(this.outline.object);
    this.blockOverlay = new BlockOverlay(atlas);
    this.scene.add(this.blockOverlay.object);
    // 告示牌上的字（B12）：单独一个 Group，里面每块有字的牌子一个平面
    this.scene.add(this.signRenderer.group);
    // 展示框里挂着的东西（B14）：同样单独一个 Group，里面每个框一个子节点
    // （外层节点管框面朝哪边、子节点管物品自己的 45° 旋转）
    this.itemFrameRenderer = new ItemFrameRenderer(atlas);
    this.scene.add(this.itemFrameRenderer.group);
    this.signEditor.onSave = (lines) => this.applySignText(lines);
    this.signEditor.onClose = () => {
      this.editingSign = null;
      // 与背包/配方书一样：关掉界面要把输入权交回去（重新锁指针、收起触摸层）
      this.handleInventoryOpen(false);
    };

    // 信标（K5，批次 117）：界面里点一下就把那条效果写进**方块状态**（见
    // `applyBeaconChoice`），关掉时把输入权交回去；光柱的组挂在场景里、逐帧 sync
    this.beaconScreen.onChoose = (primary, regen) => this.applyBeaconChoice(primary, regen);
    this.beaconScreen.onClose = () => {
      this.editingBeacon = null;
      this.handleInventoryOpen(false);
    };
    this.scene.add(this.beaconBeamRenderer.group);
    this.scene.add(this.borderRenderer.group);

    this.world.events = {
      onChunkLoaded: (chunk) => {
        // 结构箱的战利品（K8 尾巴）：方块状态里写着"哪张表"，在这里按表掷点填进容器。
        // 放在网格化之前也没关系——箱子内容不影响渲染
        fillLootChests(chunk, this.dimension, this.world.seed, this.world.containers);
        // 避雷针索引（批次 83）：区块一加载就扫出里面的避雷针，打雷时查询就是常数级
        this.scanRodsInChunk(chunk.cx, chunk.cz);
        // 刷怪笼索引（批次 92）：同一个道理——下界要塞里的笼子在加载时登记，之后按倒计时生成
        this.scanSpawnersInChunk(chunk.cx, chunk.cz);
        // 信标索引（K5，批次 117）：光柱要逐帧画、效果要每秒挂，所以先知道"哪儿有信标"
        this.scanBeaconsInChunk(chunk.cx, chunk.cz);
        // 村庄的人口（J22，批次 89）：房子里的每张床招一个村民。
        // 与上面两件事同一个位置、同一条理由：**方块已经在了，但还需要有人管一下**
        // （结构生成在 Worker 里，而 Worker 造不了实体）
        this.populateVillage(chunk.cx, chunk.cz);
        this.chunkRenderer.onChunkLoaded(chunk.cx, chunk.cz);
        this.refreshLoadingState();
      },
      onChunkUnloaded: (cx, cz) => {
        // 区块走了，里面的避雷针也跟着忘掉（不然索引会一直长）
        this.forgetRodsInChunk(cx, cz);
        // 刷怪笼同理：区块卸载之后就不该再对着它生成（也没法生成——方块读不到了）
        this.forgetSpawnersInChunk(cx, cz);
        // 信标（K5，批次 117）：区块走了就别再画它的光柱（下次加载会重新扫出来）
        this.forgetBeaconsInChunk(cx, cz);
        this.chunkRenderer.onChunkUnloaded(cx, cz);
        // 区块卸载时一并清掉落在该区块里的掉落物，避免未加载区域实体无限堆积
        this.entities.removeInChunk(cx, cz);
        this.refreshLoadingState();
      },
      onBlockChanged: (x, y, z) => {
        this.chunkRenderer.enqueueAround(x, z);
        this.pendingSettle.push(x, y, z);
        // 红石：方块一变就重算受影响的电路（放粉、开关、活塞推拉都走这条路径）
        this.redstone.onBlockChanged(this.redstoneWorld, x, y, z);
      },
    };

    this.buildHotbar();
    this.inventoryScreen = new InventoryScreen(
      atlas,
      this.inventory,
      {
        onOpenChange: (open) => this.handleInventoryOpen(open),
        onOpenRecipes: (tab) => this.openRecipeBook(tab),
        onCloseRecipes: () => this.closeRecipeBook(),
        // 左栏是不是正被配方书占着（决定显示"我的物品"还是"配方列表"）
        isRecipesOpen: () => this.isRecipeBookOpen(),
        // 左轨那排分类图标要点亮当前分类
        currentRecipeTab: () => this.currentRecipeTab(),
        // 「只显示我拥有的」：开着 = 筛掉不拥有的；关着 = 全部列出、不拥有的红底
        isRecipeOwnedOnly: () => this.isRecipeOwnedOnly(),
        onSetRecipeOwnedOnly: (on) => this.setRecipeOwnedOnly(on),
        // 把配方书搬进背包的左栏（或还回整屏那一层）
        onRecipeHost: (host) => this.attachRecipeBook(host),
        // 成就（M7）：背包标题栏上的按钮——手机上没有 Esc，这条是唯一的入口
        onOpenAdvancements: () => this.openAdvancements(),
        // 村民交易（J11）：界面只管"点了第几条"，扣材料/给东西/经验/音效全在这儿
        onTrade: (villager, index) => void this.performTrade(villager, index),
        // 熔炉产物被取空时结算烧炼经验（I5）
        // 熔炉经验（原版取出产物时给）：炉子就在身旁，掉在玩家脚下即可
        onFurnaceXp: (amount) => this.spawnXpOrbs(amount, this.physics.x, this.physics.y + 0.5, this.physics.z),
        // 背包里搬动东西的一声"咔"（H19 ⑪，批次 138）：界面只报"动过了"，
        // 播不播、多大声由音频引擎那边统一按音量设置决定
        onMove: () => this.audio.play('item_move'),
        // 创造物品栏门控（批次 181 起看**模式**，不再看"在不在飞"）
        isCreative: () => this.isCreative,
        // 丢出（批次 128）：Q / Ctrl+Q / 点界面外 —— 界面只报"丢哪件、丢几件"，
        // 真正造掉落物的是这里（它才知道玩家站在哪）
        onDrop: (itemId, count) => this.dropInFrontOfPlayer(itemId, count),
        // 铁砧（H8）：同样只需要等级与扣等级的出口
        anvilContext: () => ({
          playerLevel: this.experience.level,
          consumeLevels: (levels) => this.experience.consumeLevels(levels),
        }),
        // 附魔台（H9）：等级、书架加成、扣等级的出口都由主程序提供
        enchantContext: () => ({
          playerLevel: this.experience.level,
          bookshelfPower: bookshelfPower(this.enchantTablePos ? this.countBookshelves(this.enchantTablePos.x, this.enchantTablePos.y, this.enchantTablePos.z) : 0),
          consumeLevels: (levels) => this.experience.consumeLevels(levels),
        }),
      },
      this.tooltip,
    );
    // 挂到 <body> 上而不是 #app：面板的 z-index 只在同一个层叠上下文里比较，
    // 放进 #app 就会被 DOM 更靠后的遮罩（#death / #sleep）盖住
    this.recipeBook = new RecipeBook(document.body, atlas, this.inventory, {
      gridSize: () => (this.inventoryScreen.currentMode === 'crafting' ? 3 : 2),
      onCraft: (recipe) => this.craftFromBook(recipe),
      onFill: (recipe) => this.fillFromBook(recipe),
      // 配方书自己那颗 ✕：背包要把左栏还回"我的物品"
      onHidden: () => this.inventoryScreen.syncRecipePane(),
    });
    // 成就面板与达成提示（M7，批次 87）：同样挂 <body>（见上面那条 z-index 的注记），
    // 点外框关闭；提示卡是 HUD 性质的东西，挂 body 才不会被打包进 #app 的层叠上下文
    this.advancementScreen = new AdvancementScreen(document.body, atlas, this.advancements);
    this.advancementToast = new AdvancementToast(document.body, atlas);

    // 难度先按"新建世界时选的"来；如果存档里有玩家数据，loadPlayer 会再用存档的覆盖
    this.difficulty = this.worldConfig.difficulty;

    // 水面动画：告诉材质"哪些贴图要做波浪与滚动"（水与岩浆）
    const fluidTiles: Array<readonly [number, number]> = [
      atlas.tileOrigin('water'),
      atlas.tileOrigin('lava'),
    ];
    this.solidMaterial.setFluidTiles(fluidTiles);
    this.translucentMaterial.setFluidTiles(fluidTiles);
    // 下界传送门（K8）：只滚动、不起伏，所以走单独的槽位（门在半透明层，
    // 但两个材质共用同一套 uniform 布局，两个都登记才不会在别的材质里看到静止的门）
    const portalTile = atlas.tileOrigin('nether_portal');
    this.solidMaterial.setPortalTile(portalTile);
    this.translucentMaterial.setPortalTile(portalTile);

    this.chat.onSubmit = (text) => this.handleChatSubmit(text);
    this.chat.onOpenChange = (open) => this.handleChatOpen(open);
    this.inventory.onChange = () => {
      this.refreshHotbar();
      this.inventoryScreen.refresh();
      // 背包一变就对一次进度的账（M7）：**大部分进度看的是"背包里有没有过"**，
      // 挖到/合成/烧出/从箱子里取出/钓上来全都走这一条通道——
      // 于是主程序不需要在五个地方各报一次"玩家拿到了什么"
      this.reconcileObtainProgress();
    };

    // 护甲：把背包（36-39 号槽）当作护甲提供者接给生存系统。
    // 走这道接口而不是直接在伤害入口算，是为了让**环境伤害也自动吃到减伤**
    this.stats.armor = createArmorWearer(this.inventory);

    // 设置 / 暂停菜单（K3）：应用后立即生效，不必重开局
    this.viewDistance = this.settings.viewDistance;
    // 装饰层（批次 158）：**启动时也要应用一次**——`applySettings` 只在"玩家改设置"
    // 时被调用，不在这里补一刀的话，存档里那个"粒子效果：减半"要等玩家开一次设置才生效。
    // 云、粒子上限、雨量三样一起落（档位 0 时等于"完全按设置来"）
    this.applyDecorLevel();
    this.perf = { ...this.perf, viewDistance: this.settings.viewDistance };
    // 手机开局按"保守的视距 + 满分辨率"起步：
    //  · 视距先只给 6（有余量时自适应会加到手机上限 8，`viewDistanceCapFor` 封顶）；
    //  · **分辨率不预折**（批次 158 起 `MOBILE_INITIAL_RESOLUTION` = 1.0）——
    //    降级顺序已经是"视距优先"，先把近处画清楚，压力交给视距。
    if (isTouchDevice()) {
      const view = Math.min(this.viewDistance, MOBILE_VIEW_DISTANCE);
      this.viewDistance = view;
      this.perf = { ...this.perf, viewDistance: view, resolutionScale: MOBILE_INITIAL_RESOLUTION };
      this.camera.far = cameraFarFor(view);
      this.camera.updateProjectionMatrix();
      this.applyEnvironment();
      this.applyResolutionScale();
    }
    this.audio.volume = this.settings.volume;
    this.lastStepX = this.physics.x;
    this.lastStepZ = this.physics.z;
    this.settingsScreen = new SettingsScreen(document.body, this.settings, {
      onResume: () => this.closeSettings(),
      onExitToMenu: () => void this.exitToMenu(),
      onDeleteWorld: () => void this.deleteCurrentWorld(),
      onChange: (settings) => this.applySettings(settings),
      onResourcePack: (file) => void this.loadResourcePack(file),
      // 成就（M7）：暂停菜单里点"成就"→ 面板叠在它上面（面板自己会接管 uiOpen）
      onOpenAdvancements: () => this.toggleAdvancements(),
      // 创造模式（飞行）搬进设置（批次 107）：触摸端右下那一簇不再有"飞行"键
      onToggleFly: () => this.setFlying(!this.flying),
      isFlying: () => this.flying,
      // 模式（批次 181）：唯一的入口在暂停菜单；双击跳只切飞行
      onToggleGameMode: () => this.setGameMode(nextGameMode(this.gameMode)),
      gameMode: () => this.gameMode,
      // 诊断日志（批次 181）：打点 / 导出 / 复制，读数由 runtime 自己算
      onDiagnosticsMark: () => diag.mark('用户记录问题'),
      onDiagnosticsExport: () => diag.download(),
      onDiagnosticsCopy: () => diag.copy(),
      diagnosticsStats: () => diag.stats(),
      // 全屏 / 横屏：被系统踢出全屏、或第一次手势错过时的兜底入口
      onToggleFullscreen: () => {
        toggleFullscreen();
        syncRotateHint();
      },
      isFullscreen: () => isFullscreen(),
    });

    // 开发期初始物资（批次 181）：**默认不再发放**。
    //
    // 用户的原话是"生存模式开局应当空手"，而创造模式本来就能从分类里随时拿，
    // 往仓库里塞 70 多件既没用、又正好把 36 格挤爆（铁镐那一堆就是这么来的）。
    // 现在只有显式打开调试开关才发；开关见 `startupKit.devKitRequested`。
    let storedDevKit: string | null = null;
    try {
      storedDevKit = localStorage.getItem('mc.devkit');
    } catch {
      // 无痕模式：读不到就当没开
    }
    if (devKitRequested(location.search, storedDevKit)) {
      const kit = grantDevKit(this.inventory);
      console.info(
        `[dev] 开发期物资：${kit.granted} 件已放入` +
          (kit.skipped.length > 0 ? `，${kit.skipped.length} 件放不下（36 格）：${kit.skipped.join('、')}` : ''),
      );
      diag.event('app', 'devkit', { granted: kit.granted, skipped: kit.skipped.length });
    }

    // 触摸操作层：只在手势设备上创建，桌面端完全不引入这套 DOM
    // `createTouchControls()` 里会给 <body> 挂 `touch-mode`（CSS 靠它切提示文案，
    // 批次 95 起也靠它决定"快捷栏能不能点、槽位要不要放大"）——
    // 用类名而不是 `@media (pointer: coarse)`，是为了与"操作层是否存在"共用**同一个判据**
    this.touch = isTouchDevice() ? this.createTouchControls() : null;
    // 返回键守卫（批次 96）：手机上"返回"先关界面，界面全关完才轮到浏览器（= 退出页面）。
    // 挂在 `popstate` 上而不是 `beforeunload`：前者能拿到"用户想后退"这件事，
    // 又不至于把"刷新/关标签页"也拦下来
    window.addEventListener(
      'popstate',
      () => {
        if (this.disposed) return;
        // 批次 181：**游戏内没有面板时，返回 = 打开暂停菜单**。
        // 以前这里交给浏览器（PWA 里等于直接退出游戏）——玩家只是想关个界面，
        // 结果把整局退了，这是手机上最容易被劝退的一处。
        if (!this.isAnyUiOpen()) {
          diag.event('input', 'back.root', {});
          this.openSettings();
          // 弹掉的那条历史要补回来，否则第二次返回又会被交给浏览器
          this.backButton.rearm();
          return;
        }
        this.backButton.onBrowserBack();
      },
      { signal: this.listeners.signal },
    );

    this.bindEvents();
    // 没有存档时直接按出生点请求区块；
    // 有存档时先不请求 —— 读档要先装载"方块增量"，否则先加载进来的区块
    // 会以未修改的自然地形生成，之后还要回炉重算光照与网格（会在玩家眼前闪一下）
    if (!this.save?.hasSave) this.prepareNewWorldSpawn();
  }

  /**
   * 创建触摸操作层。
   *
   * 抽成方法是为了让桌面端也能临时启用触摸 UI——验收触摸布局、量触控响应
   * 都不必真的拿一台手机（调试接口 `mc.enableTouchControls()`）。
   */
  private createTouchControls(): TouchControls {
    // 触屏设备给 <body> 挂一个标记：CSS 靠它切换"键盘提示 / 手势提示"
    // （开始遮罩上的提示文字在手机上写 <kbd>W</kbd> 只会误导）
    document.body.classList.add('touch-mode');
    return new TouchControls(document.getElementById('hud') ?? document.body, {
      // 轻点抬起（批次 181）：**先看准星下有没有生物**——
      // 有就是攻击（生物不是可放置面），没有才走"交互 / 放置一次"那条老路
      onTap: (clientX: number, clientY: number) => {
        // 批次 185：先按**手指落点**找生物（点哪打哪），准星那条路作兜底
        const tapped = this.mobAtScreen(clientX, clientY);
        this.tapAttackMob = tapped;
        if (tapped) this.tapAttackRequest = true;
        else this.touchPlaceRequest = true;
      },
      // 长按：等价于按住左键破坏 / 持续攻击
      onBreakStart: () => {
        this.leftDown = true;
      },
      onBreakEnd: () => {
        this.leftDown = false;
      },
      onToggleInventory: () => this.inventoryScreen.toggle(),
      // 暂停 / 设置（批次 104）：手机上原来没有入口，只能按 Esc（手机没有）或退出页面
      onOpenPause: () => this.toggleSettings(),
      // 顶部视角键（批次 181）：与键盘 V 同一条循环
      onCycleCamera: () => {
        this.cycleCameraMode();
      },
      // 飞行仍然可以被"双击跳跃"触发；"视角"与"创造飞行"的显式开关都搬进了
      // 设置面板（批次 107：右下那一簇只留跳/潜，见 ui/TouchControls.ts）
      onToggleFly: () => this.setFlying(!this.flying),
      // 潜行状态由操作层自己维护并出现在 input 里，这里只做一次提示同步
      onToggleSneak: () => undefined,
      // 聊天与命令：手机上原来只有键盘 T 与 /，等于没有入口
      onOpenChat: () => this.chat.openWith(''),
    });
  }

  /** 调试/验收用：桌面端也能把触摸 UI 打开（手机上本来就是自动创建的） */
  enableTouchControls(): boolean {
    if (this.touch) return true;
    this.touch = this.createTouchControls();
    return true;
  }

  /**
   * 应用设置项。
   *
   * 视距会影响相机的远裁剪面与雾的距离，改完必须 `updateProjectionMatrix()`，
   * 否则会出现"看得更远了但远处被裁掉"的割裂感。
   */
  /**
   * 现在有没有界面开着（返回键守卫与"逐层关"共用）。
   *
   * 只算**游戏内**的面板：主菜单（`WorldScreen`）与宽高比提示（`UnsupportedScreen`）
   * 不算——在那两个界面上按返回，玩家想干的正是"退出页面"。
   */
  private isAnyUiOpen(): boolean {
    return (
      this.signEditor.isOpen ||
      this.beaconScreen.isOpen ||
      this.chat.isOpen ||
      this.recipeBook.isOpen ||
      this.advancementScreen.isOpen ||
      this.inventoryScreen.isOpen ||
      this.settingsScreen.isOpen
    );
  }

  /**
   * 关掉**最上面那一层**界面，返回"关掉之后还有没有界面开着"。
   *
   * 顺序按"谁盖在谁上面"排（后开的在上面）：告示牌 → 聊天 → 配方书 → 成就 → 背包 → 设置。
   * 与 `uiOpen` 那套不同，这里必须一次只关一层——不然"按一下返回"会把界面全关掉。
   */
  private closeTopUi(): boolean {
    if (this.signEditor.isOpen) this.signEditor.close();
    else if (this.beaconScreen.isOpen) this.beaconScreen.close();
    else if (this.chat.isOpen) this.chat.close();
    else if (this.recipeBook.isOpen) this.recipeBook.hide();
    else if (this.advancementScreen.isOpen) this.advancementScreen.hide();
    else if (this.inventoryScreen.isOpen) this.inventoryScreen.close();
    // 暂停菜单分两层（批次 108）：先"设置页 → 菜单页"，回到菜单页时它**还开着**，
    // 所以这里不能直接 closeSettings()——`goBack` 会自己决定（必要时才真关）
    else if (this.settingsScreen.isOpen) this.settingsScreen.goBack();
    return this.isAnyUiOpen();
  }

  private applySettings(settings: GameSettings): void {
    this.cameraMode = settings.cameraMode;
    this.viewDistance = settings.viewDistance;
    // 玩家手动改视距时把自适应冷却重置：否则刚拖完滑块又要等几秒才允许升降
    // ⚠️ 分辨率的当前值**不重置**：它是"这台设备现在扛不扛得住"的记忆，
    // 改一次视距就把它弹回 1.0 的话，弱机每次调设置都要重新掉一轮帧
    this.perf = { ...this.perf, viewDistance: settings.viewDistance, cooldown: 3 };
    this.camera.fov = settings.fov;
    // ⚠️ 这一处也要走 `cameraFarFor`：它是最容易被漏掉的一处（改设置时重算远裁面）
    this.camera.far = cameraFarFor(settings.viewDistance);
    this.camera.updateProjectionMatrix();
    this.audio.volume = settings.volume;
    // 四组音量（批次 178，M20）：与主音量相乘，各自独立
    this.audio.setGroupVolume('blocks', settings.volumeBlocks);
    this.audio.setGroupVolume('mobs', settings.volumeMobs);
    this.audio.setGroupVolume('player', settings.volumePlayer);
    this.audio.setGroupVolume('ui', settings.volumeUi);
    // 自动保存间隔（批次 172，M20）：改完立刻按新节奏走（下一轮从这里读）
    this.autoSaveInterval = settings.autosaveSeconds;
    this.particles.setDensity(PARTICLE_DENSITY[settings.particles]);
    // 云 / 粒子上限 / 雨量一起按"设置 × 当前装饰层档位"落下去（见 `applyDecorLevel`）：
    // 设置里关掉的，档位回到 0 也不会自作主张打开
    this.applyDecorLevel();
    // 触摸摇杆模式（批次 96）：没有触摸层时静默忽略（桌面端这个设置项不该报错）
    this.touch?.setStickMode(settings.touchStick);
    // 触摸按钮/摇杆大小（批次 97）：改一个 CSS 变量，摇杆与按钮一起缩放
    document.documentElement.style.setProperty('--touch-scale', String(settings.touchScale));
    this.debugEl.style.display = settings.showDebug ? '' : 'none';
    if (this.inventoryScreen.isOpen) this.inventoryScreen.refresh();
    if (this.recipeBook.isOpen) this.recipeBook.render();
    this.applyEnvironment();
    // 视距变化后立刻按新的范围请求/卸载区块
    this.refreshWorld(toChunkCoord(this.physics.x), toChunkCoord(this.physics.z), true);
  }

  /** 打开暂停菜单 */
  openSettings(): void {
    if (this.settingsScreen.isOpen) return;
    const save = this.saveStatus;
    this.settingsScreen.setMeta(
      save.enabled
        ? `存档：${save.hasSave ? '已保存' : '新世界'} · 改动 ${save.edits} 格 / ${save.editedChunks} 区块 · 自动保存每 ${this.autoSaveInterval} 秒`
        : '存档：不可用（浏览器未提供 IndexedDB）',
    );
    this.settingsScreen.show();
    this.handleInventoryOpen(true);
    // 打开界面时释放指针锁，否则鼠标被锁住点不到按钮
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** 关闭暂停菜单 */
  closeSettings(): void {
    this.settingsScreen.hide();
    this.handleInventoryOpen(false);
    // 指针锁必须由用户手势触发，非手势下调用会被拒绝——吞掉异常，别让它打断关闭流程
    try {
      void this.renderer.domElement.requestPointerLock?.();
    } catch {
      // 忽略：玩家点一下画面就会重新锁定
    }
  }

  toggleSettings(): void {
    if (this.settingsScreen.isOpen) this.closeSettings();
    else this.openSettings();
  }

  /**
   * 从后台回来（批次 184，用户要求）：
   * **先不显示游戏页面，显示暂停页面；点一下才横屏全屏回到游戏。**
   *
   * 两件事分开做是有意的：
   *  1. 暂停菜单照常打开（Esc / 返回键那条路也在用它），玩家能看见"游戏已暂停"；
   *  2. 上面再压一层不透明的 `#resume-gate`——它同时挡住画面与暂停菜单上的按钮：
   *     从后台回来时浏览器往往已经**退出了全屏、方向也被系统转回去了**，
   *     直接让玩家点"继续游戏"只会得到一个竖屏小窗里的游戏。
   *     那一层自己吃掉第一下点击：请求全屏 + 锁横屏，再关掉它自己与暂停菜单。
   */
  private handleReturnFromBackground(): void {
    if (this.disposed) return;
    this.wasHidden = false;
    diag.event('app', 'resume.background', { fullscreen: isFullscreen() });
    // 回来先落到暂停页：其它面板（背包/聊天/告示牌）一律先收起
    if (this.chat.isOpen) this.chat.close();
    if (this.signEditor.isOpen) this.signEditor.close();
    if (this.beaconScreen.isOpen) this.beaconScreen.close();
    if (this.inventoryScreen.isOpen) this.inventoryScreen.close();
    if (this.advancementScreen.isOpen) this.advancementScreen.hide();
    if (!this.settingsScreen.isOpen) this.openSettings();
    this.showResumeGate();
  }

  /** 挂出"点击继续"那一层（已经挂着就不重复建） */
  private showResumeGate(): void {
    if (this.resumeGateEl) return;
    const gate = document.createElement('div');
    gate.id = 'resume-gate';
    gate.dataset.role = 'resume-gate';
    const panel = document.createElement('div');
    panel.className = 'resume-gate-panel';
    const title = document.createElement('b');
    title.textContent = '游戏已暂停';
    const hint = document.createElement('span');
    hint.textContent = '点击任意处继续 · 自动横屏全屏';
    panel.append(title, hint);
    gate.appendChild(panel);
    // pointerdown 而不是 click：全屏必须在用户手势的调用栈里发出
    gate.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      enterMobilePresentation();
      this.dismissResumeGate();
    });
    document.body.appendChild(gate);
    this.resumeGateEl = gate;
  }

  /** 收掉"点击继续"那一层，并把暂停菜单一起关掉（回到游戏） */
  private dismissResumeGate(): void {
    this.resumeGateEl?.remove();
    this.resumeGateEl = null;
    if (this.settingsScreen.isOpen) this.closeSettings();
    syncRotateHint();
  }

  /** 背包开关：打开时释放指针锁并停用移动/交互，关闭时重新锁定视角 */
  private handleInventoryOpen(open: boolean): void {
    diag.event('ui', 'ui.open.changed', { open, touch: this.touch?.debugState });
    this.uiOpen = open;
    this.keys.clear();
    this.leftDown = false;
    this.rightDown = false;
    // 界面开着/刚关掉时，上一帧排队的轻点请求一律作废（别让"点关闭键"变成放方块）
    this.touchPlaceRequest = false;
    this.tapAttackRequest = false;
    this.tapAttackMob = null;
    // 触摸端：界面打开时收起操作层；关闭时显式清一次手势状态，
    // 否则关面板那一瞬间按在屏幕上的手指会带着旧基准继续转视角
    if (this.touch) {
      this.touch.resetInput(open ? 'ui.open' : 'ui.close');
      this.touch.visible = !open;
    }

    if (open) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.outline.hide();
    } else if (this.touch) {
      // 触摸端没有指针锁，关掉界面直接继续玩
      this.outline.hide();
    } else {
      const result = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch(() => {
        /* 浏览器可能拒绝自动重新锁定，玩家点击画面即可 */
      });
    }
  }

  // ---------------------------------------------------------------- 联机（K2）

  /** 连上服务器：拿到种子与已有玩家/方块改动 */
  private onNetWelcome(seed: number, selfId: number, players: NetPlayerState[], edits: number[][]): void {
    console.info(`[net] 已加入服务器 #${selfId}，种子 ${seed}，在线 ${players.length} 人，已有方块改动 ${edits.length} 条`);

    // 种子不一致：地形会对不上（两边看到的是不同的大陆），只提示不强行切换
    if (seed !== this.worldConfig.seed) {
      console.warn(`[net] 服务端种子 ${seed} 与本地 ${this.worldConfig.seed} 不同，地形可能与队友不一致`);
    }

    // 服务端的方块改动并进增量表：这样它们也会被 K1 的存档保存下来
    for (const entry of edits) {
      const [x, y, z, id, state, dimension] = entry as [number, number, number, number, number, string];
      this.world.edits.record(
        dimension ?? 'overworld',
        toChunkCoord(x),
        toChunkCoord(z),
        Chunk.index(x & 15, y, z & 15),
        id,
        state ?? 0,
      );
      // 已经加载出来的区块立即生效
      if (this.world.isLoaded(x, z)) {
        this.world.setBlockAndUpdate(x, y, z, id, state ?? 0);
        // 队友放下的漏斗也要有容器，否则"看着是漏斗、就是不搬东西"（见 `ensureBlockEntityAt`）
        this.ensureBlockEntityAt(x, y, z, id, dimension);
      }
    }

    for (const player of players) {
      if (player.id === selfId) continue;
      this.onNetPlayer(player);
    }
  }

  /** 其它玩家的位置更新 */
  private onNetPlayer(player: NetPlayerState): void {
    let mob = this.remotePlayers.get(player.id);
    if (!mob) {
      mob = new Mob(REMOTE_PLAYER_TYPE, player.x, player.y, player.z);
      mob.yaw = player.yaw;
      this.remotePlayers.set(player.id, mob);
      console.info(`[net] ${player.name}#${player.id} 加入了游戏`);
    }
    // 远程玩家不跑物理：每帧直接对齐网络位置（插值会让模型在低速更新下抖动）
    mob.x = player.x;
    mob.y = player.y;
    mob.z = player.z;
    mob.yaw = player.yaw;
    // 俯仰不参与人形模型渲染（原版的其它玩家也是只转身体朝向），因此不入模型
  }

  private onNetLeave(id: number): void {
    // 渲染器每帧会回收"这一帧没出现"的模型，所以这里只要从表里删掉就够了
    this.remotePlayers.delete(id);
  }

  /** 队友改了方块：直接写进世界（也会进增量存档） */
  private onNetBlock(x: number, y: number, z: number, id: number, state: number, dimension: string): void {
    if (!this.world.isLoaded(x, z)) return;
    // 走 setBlockAndUpdate：光照与网格会跟着更新，也会被记进增量存档
    this.world.setBlockAndUpdate(x, y, z, id, state);
    // 队友放的漏斗：这里补建容器（维度按消息里带的那个，不是"我当前所在的维度"）
    this.ensureBlockEntityAt(x, y, z, id, dimension);
  }

  /** 连接服务器（也可以在控制台直接调：mc.connect('ws://192.168.1.5:8787', '小明')） */
  connect(url = defaultServerUrl(), name = '玩家'): string {
    this.net.connect(url, name);
    return this.netStatus;
  }

  disconnect(): void {
    this.net.disconnect();
  }

  sendChat(text: string): void {
    this.net.sendChat(text);
  }

  get netState(): {
    status: string;
    selfId: number;
    seed: number | null;
    players: number;
    remote: Array<{ id: number; x: number; y: number; z: number }>;
    chat: string;
  } {
    return {
      status: this.netStatus,
      selfId: this.net.selfId,
      seed: this.net.worldSeed,
      players: this.net.playerCount,
      remote: [...this.remotePlayers.entries()].map(([id, mob]) => ({ id, x: mob.x, y: mob.y, z: mob.z })),
      chat: this.chatLine,
    };
  }

  // ---------------------------------------------------------------- 存档（K1）

  /**
   * 读档：把上次的玩家状态恢复到世界里。
   *
   * 时机很重要——**必须等存档读完再让玩家落地**，否则会出现
   * "先按出生点落在 (0,80)，一秒后被存档传送到别处"的跳动。
   * 因此这里在恢复位置前先设 `spawnResolved`，跳过自动出生点定位。
   */
  async loadSaveState(): Promise<boolean> {
    if (!this.save || !this.save.hasSave) return false;
    if (!this.save.matchesSeed(this.worldConfig.seed)) {
      console.warn('[save] 存档种子与当前世界不一致，按新世界处理');
      return false;
    }

    // 先把全部区块增量装进内存：之后任何区块生成都会自动叠加它们
    const records = await this.save.loadAllChunkEdits();
    for (const record of records) {
      this.world.edits.restore(record.dimension, record.cx, record.cz, record.edits);
    }
    if (records.length > 0) {
      console.info(`[save] 已装载 ${records.length} 个区块的增量改动，共 ${this.world.edits.totalEdits} 格`);
    }

    // 容器内容（C7 尾巴）：箱子/熔炉/附魔台/铁砧/酿造台的东西不能丢
    const containers = await this.save.loadContainers();
    const restoredContainers = restoreContainers(this.world.containers, containers);
    if (restoredContainers > 0) console.info(`[save] 已还原 ${restoredContainers} 个容器的内容`);

    // 告示牌上的字（B12）：与容器同一条口径（整份一次读，脏数据逐条跳过）。
    // 读到的字不会立刻显示——`syncSigns` 那趟对账要求"区块已加载 + 那一格还是牌子"
    this.signText.clear();
    const signs = await this.save.loadSigns();
    const restoredSigns = restoreSigns(this.signText, signs);
    if (restoredSigns > 0) console.info(`[save] 已还原 ${restoredSigns} 块告示牌上的文字`);

    // 展示框里挂着的东西（B14）：与告示牌同一条（整份一次读、脏数据逐条跳过）。
    // 读到的不会立刻显示——`syncFrames` 那趟对账要求"区块已加载 + 那一格还是框"
    this.itemFrames.clear();
    const frames = await this.save.loadFrames();
    const restoredFrames = restoreFrames(this.itemFrames, frames);
    if (restoredFrames > 0) console.info(`[save] 已还原 ${restoredFrames} 个展示框里挂着的东西`);

    // 成就 / 进度（M7）：它不属于任何坐标，是纯玩家状态，所以**读的时机比别的紧**——
    // 必须在 `inventory.restore`（下面）**之前**读进来，否则"读档回填背包"那一串
    // `add` 会先跑一遍 `onChange`（虽然有 `progressReady` 挡着，但顺序清楚更好读）。
    // 真正开放报事件是在 `armProgress()`（背包回填完、基线扫过之后）
    const progress = await this.save.loadAdvancements();
    const restoredProgress = this.advancements.restore(progress);
    if (restoredProgress > 0) console.info(`[save] 已还原 ${restoredProgress} 条成就进度`);

    const data = await this.save.loadPlayer();
    if (!data) {
      // 只有区块增量、没有玩家数据（异常存档）：至少把世界放出来
      this.refreshWorld(0, 0, true);
      return false;
    }

    // 维度：存档在哪个维度就回哪个维度（区块会重新流式加载）
    if (data.dimension !== this.dimension) {
      this.setDimension(data.dimension === 'nether' ? Dimension.NETHER : data.dimension === 'end' ? Dimension.END : Dimension.OVERWORLD);
    }

    this.physics.teleport(data.x, data.y, data.z);
    this.yaw = data.yaw;
    this.pitch = data.pitch;
    // 批次 181 迁移：老存档没有 `gameMode`，`flying === true` 视为创造模式
    if (data.gameMode) this.setGameMode(data.gameMode);
    else if (data.flying) this.setGameMode('creative');
    // 生存模式不允许飞：`setFlying` 自己也会挡，这里把条件写清楚
    this.setFlying(data.flying === true && this.isCreative);
    this.timeOfDay = data.timeOfDay;
    // 月相（批次 84）：老存档没有 dayCount → 第 0 天（满月），与 `moonPhaseFor(0)` 一条口径
    this.dayCount = Number.isFinite(data.dayCount) && (data.dayCount ?? 0) >= 0 ? Math.floor(data.dayCount!) : 0;
    // 失眠（批次 126）：老存档没有这一项 → 0 天（刚睡过，不会立刻招来幻翼）
    this.daysWithoutSleep =
      Number.isFinite(data.daysWithoutSleep) && (data.daysWithoutSleep ?? 0) >= 0
        ? Math.floor(data.daysWithoutSleep!)
        : 0;
    this.sky.setMoonPhase(moonPhaseFor(this.dayCount));
    // 天气（L6，批次 85）：老存档没有这个字段 → `restoreWeather` 回退默认晴天
    this.weather.restore(data.weather);
    // 世界边界（K12，批次 175）：老存档没有这个字段 → 默认 3 千万格（等于"没有边界"）
    this.border = normalizeBorder(data.border);
    this.stats.health = data.health;
    this.stats.food = data.food;
    this.stats.saturation = data.saturation;
    this.stats.air = data.air;
    this.stats.exhaustion = data.exhaustion;
    this.dragonDefeated = data.dragonDefeated;
    // 难度与游戏规则按世界存：旧存档没有这两个字段时回退默认值
    // 难度优先用存档里的（玩家可能在游戏里改过），没有就用世界清单里新建时选的
    this.difficulty = data.difficulty ? normalizeDifficulty(data.difficulty) : this.worldConfig.difficulty;
    this.rules = normalizeGameRules(data.gameRules);
    this.effects.restore(data.effects);
    // 旧存档没有 xp 字段：视为 0 级，而不是 NaN
    this.experience.restore(data.xp);

    this.inventory.restore(data.inventory);
    // 末影箱（批次 71）：旧存档没有这个字段 → 空箱子（与 xp/effects 同一条处理）
    this.enderChest.restore(data.enderChest);
    // 床重生点（批次 79）：旧存档没有 → 没有床重生点；坐标非法（NaN）也当没有，
    // 否则死亡时会把人"传送"到 NaN 位置（与本文件开头那条"别把 NaN 传给物理"同源）
    this.bedSpawn =
      data.bedSpawn &&
      Number.isFinite(data.bedSpawn.x) &&
      Number.isFinite(data.bedSpawn.y) &&
      Number.isFinite(data.bedSpawn.z) &&
      isDimension(data.bedSpawn.dimension)
        ? {
            x: data.bedSpawn.x,
            y: data.bedSpawn.y,
            z: data.bedSpawn.z,
            dimension: data.bedSpawn.dimension,
          }
        : null;
    this.selectSlot(data.selectedSlot);
    this.refreshHotbar();
    this.inventoryScreen.refresh();

    // 进度系统上岗：背包已经回填完，此刻的东西记成基线（不补发），再点亮根条目
    this.armProgress();

    // 跳过自动出生点定位，否则会被拉回默认出生点
    this.spawnResolved = true;
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.refreshWorld(toChunkCoord(data.x), toChunkCoord(data.z), true);
    return true;
  }

  /** 打包当前玩家状态 */
  private snapshotPlayer(): PlayerSave {
    return {
      x: this.physics.x,
      y: this.physics.y,
      z: this.physics.z,
      yaw: this.yaw,
      pitch: this.pitch,
      dimension: this.dimension,
      flying: this.flying,
      gameMode: this.gameMode,
      timeOfDay: this.timeOfDay,
      dayCount: this.dayCount,
      daysWithoutSleep: this.daysWithoutSleep,
      // 天气（L6，批次 85）：重开之后接着下，而不是每次重掷
      weather: this.weather.snapshot(),
      // 世界边界（K12，批次 175）：中心与边长都跟着存档走
      border: { ...this.border },
      health: this.stats.health,
      food: this.stats.food,
      saturation: this.stats.saturation,
      air: this.stats.air,
      exhaustion: this.stats.exhaustion,
      inventory: this.inventory.serialize(),
      // 末影箱跟着玩家走（批次 71）：与背包同一层，但它是"跨坐标"的那一份
      enderChest: this.enderChest.slots(),
      // 床重生点（批次 79）：没睡过床就写成 undefined（不缺字段，省得老存档迁移）
      ...(this.bedSpawn ? { bedSpawn: { ...this.bedSpawn } } : {}),
      selectedSlot: this.hotbarIndex,
      dragonDefeated: this.dragonDefeated,
      difficulty: this.difficulty,
      gameRules: { ...this.rules },
      effects: this.effects.serialize(),
      xp: this.experience.serialize(),
    };
  }

  /**
   * 保存：玩家状态 + 自上次保存以来被改动的区块（增量）。
   *
   * 增量从 `world.edits` 里取——它记录的是"玩家动过的格子"，
   * 因此一次保存通常只有几十 KB，30 秒一次也不会卡顿。
   */
  async saveNow(reason = 'auto'): Promise<boolean> {
    if (!this.save) return false;
    const started = performance.now();
    try {
      const dirty = this.world.edits.dirtyKeys();
      const records = [];
      for (const key of dirty) {
        const { dimension, cx, cz } = ChunkEdits.parseKey(key);
        const edits = this.world.edits.serialize(dimension, cx, cz);
        if (edits) records.push({ dimension, cx, cz, edits });
      }

      await this.save.savePlayer(this.snapshotPlayer());
      await this.save.saveChunks(records);
      // 容器内容（C7 尾巴）：整份覆盖写，几十个容器而已，比维护"哪些脏了"省心
      await this.save.saveContainers(serializeContainers(this.world.containers));
      // 告示牌上的字（B12）：同样整份覆盖写（空牌子不进表，所以通常只有几条）
      await this.save.saveSigns(serializeSigns(this.signText));
      // 展示框里挂着的东西（B14）：同一条（空框不进表）
      await this.save.saveFrames(serializeFrames(this.itemFrames));
      // 成就 / 进度（M7）：整份覆盖写（`serialize` 按表的顺序排，diff 稳定）
      await this.save.saveAdvancements(this.advancements.serialize());
      this.save.addPlayTime(this.autoSaveInterval);
      await this.save.saveMeta(this.save.buildMeta(this.worldConfig.seed, this.world.edits.totalEdits));
      this.save.resetSessionTime();
      this.world.edits.markSaved();

      this.lastSaveAt = Date.now();
      this.lastSaveMs = performance.now() - started;
      this.saveCount++;
      diag.event('app', 'save', {
        reason,
        ms: Math.round(this.lastSaveMs),
        chunks: records.length,
        ok: true,
      });
      // 通知主菜单刷新"上次游玩 / 游玩时长 / 改动数"（没接就什么都不做）
      this.onSaved?.({
        playTime: this.save.meta?.playTime ?? 0,
        edits: this.world.edits.totalEdits,
      });
      return true;
    } catch (error) {
      console.warn(`[save] ${reason} 保存失败`, error);
      diag.event('error', 'save.failed', {
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** 保存成功后的回调（主菜单用） */
  onSaved: ((info: { playTime: number; edits: number }) => void) | null = null;

  /** 每帧推进自动保存计时 */
  private tickAutoSave(dt: number): void {
    if (!this.save) return;
    this.autoSaveTimer += dt;
    if (this.autoSaveTimer < this.autoSaveInterval) return;
    this.autoSaveTimer = 0;
    void this.saveNow('auto');
  }

  /** 存档状态（调试面板与验收脚本用） */
  get saveStatus(): {
    enabled: boolean;
    hasSave: boolean;
    lastSaveAt: number;
    lastSaveMs: number;
    saveCount: number;
    edits: number;
    editedChunks: number;
    pendingChunks: number;
  } {
    return {
      enabled: this.save !== null,
      hasSave: this.save?.hasSave ?? false,
      lastSaveAt: this.lastSaveAt,
      lastSaveMs: Number(this.lastSaveMs.toFixed(1)),
      saveCount: this.saveCount,
      edits: this.world.edits.totalEdits,
      editedChunks: this.world.edits.chunkCount,
      pendingChunks: this.world.edits.dirtyKeys().length,
    };
  }

  /**
   * 回到主菜单（批次 181：**应用内返回**，不再 `location.reload()`）。
   *
   * 以前这里直接刷新页面，代价是：全屏被浏览器收走 → 重新 boot → 竖屏时被
   * "请横屏"黑幕盖住 → 玩家还得再点一次。体感上就像"退出了另一个游戏"。
   *
   * 现在拆成三步：落盘 → `dispose()` 把这一局彻底拆掉 → 由 boot 挂的回调
   * 把主菜单拉回来。**全程不退出全屏**。
   *
   * @param save 是否先落盘。删除世界那条路已经删库了，不能再往里写。
   */
  private async returnToMenu(save: boolean): Promise<void> {
    if (this.disposed) return;
    const saved = save ? await this.saveNow('exit') : false;
    diag.event('app', 'exitToMenu', { saved, save });
    this.dispose();
    this.onExitToMenu?.();
  }

  /** 保存并回到主菜单 */
  async exitToMenu(): Promise<void> {
    await this.returnToMenu(true);
  }

  /** 删除当前世界：连存档库一起删掉，再回主菜单 */
  async deleteCurrentWorld(): Promise<void> {
    await SaveGame.deleteWorld(this.worldConfig.id);
    this.onWorldDeleted?.(this.worldConfig.id);
    await this.returnToMenu(false);
  }

  /** 世界被删掉时由 boot 注入的回调（App 本身不认识世界清单） */
  onWorldDeleted: ((worldId: string) => void) | null = null;

  // ---------------------------------------------------------------- 环境

  /**
   * 把时间换算成天空亮度与天空颜色，推给材质与场景。
   * 因为光照等级是烘焙在顶点属性里的，这里每帧只改 uniform，开销可以忽略。
   *
   * @param dt 秒。只有主循环会传（用来推进雾的平滑）；其它调用点（换维度 / 传送 /
   *           改时间 / 改天气）传 0，表示"只是重算一次，不推进动画"。
   */
  private applyEnvironment(dt = 0): void {
    this.applyDimensionEnvironment(dt);
    this.applyMediumEnvironment();
  }

  private applyDimensionEnvironment(dt = 0): void {
    if (this.dimension === Dimension.NETHER) {
      // 下界：没有昼夜与天气，只有暗红雾气 + 固定亮度
      //
      // ⚠️ 必须同时改 scene.background：它优先于 clearColor，
      // 只改 clearColor 的话下界的"天空"仍然是主世界那抹蓝色。
      this.sky.object.visible = false;
      this.scene.background = this.netherBackground;
      this.renderer.setClearColor(NETHER_FOG, 1);
      this.solidMaterial.skyBrightness = NETHER_SKY_BRIGHTNESS;
      this.translucentMaterial.skyBrightness = NETHER_SKY_BRIGHTNESS;
      this.entityRenderer.skyBrightness = NETHER_SKY_BRIGHTNESS;
      this.syncRenderBrightness(NETHER_SKY_BRIGHTNESS);
      this.solidMaterial.setFog(NETHER_FOG, NETHER_FOG_NEAR, NETHER_FOG_FAR);
      this.translucentMaterial.setFog(NETHER_FOG, NETHER_FOG_NEAR, NETHER_FOG_FAR);
      this.solidMaterial.setMinBrightness(NETHER_MIN_BRIGHTNESS);
      this.translucentMaterial.setMinBrightness(NETHER_MIN_BRIGHTNESS);
      this.weather.object.visible = false;
      return;
    }

    if (this.dimension === Dimension.END) {
      // 末地：星空黑背景 + 紫色雾，视距比下界远（外岛之间是开阔虚空）
      this.sky.object.visible = false;
      this.scene.background = this.endBackground;
      this.renderer.setClearColor(END_SKY, 1);
      this.solidMaterial.skyBrightness = END_SKY_BRIGHTNESS;
      this.translucentMaterial.skyBrightness = END_SKY_BRIGHTNESS;
      this.entityRenderer.skyBrightness = END_SKY_BRIGHTNESS;
      this.syncRenderBrightness(END_SKY_BRIGHTNESS);
      this.solidMaterial.setFog(END_FOG, END_FOG_NEAR, END_FOG_FAR);
      this.translucentMaterial.setFog(END_FOG, END_FOG_NEAR, END_FOG_FAR);
      this.solidMaterial.setMinBrightness(END_MIN_BRIGHTNESS);
      this.translucentMaterial.setMinBrightness(END_MIN_BRIGHTNESS);
      this.weather.object.visible = false;
      return;
    }

    this.sky.object.visible = true;
    this.weather.object.visible = true;
    this.scene.background = this.skyColor;
    this.solidMaterial.setMinBrightness(this.solidMaterial.defaultMinBrightness);
    this.translucentMaterial.setMinBrightness(this.translucentMaterial.defaultMinBrightness);
    this.renderer.setClearColor(0x000000, 0);
    // 约定：t=0 日出(06:00)、t=0.25 正午、t=0.5 日落(18:00)、t=0.75 午夜
    const sunHeight = Math.sin(this.timeOfDay * Math.PI * 2);
    const daylight = smoothstep(-0.25, 0.35, sunHeight);

    // 天气：雨天压暗天空、拉近雾；雷暴更暗，并叠上闪电的瞬时提亮
    const overcast = this.weather.raining ? (this.weather.current === 'thunder' ? 0.8 : 0.55) : 0;
    const flash = this.weather.flash;
    // 夜晚天光倍率下限 0.2，对应原版夜间天光被大幅压暗
    const skyBrightness = Math.min(1.25, (0.2 + 0.8 * daylight) * (1 - overcast * 0.42) + flash * 0.55);

    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, daylight);
    if (overcast > 0) this.skyColor.lerp(OVERCAST_SKY, overcast);
    if (flash > 0) this.skyColor.lerp(FLASH_SKY, flash * 0.65);

    // 夜视：把天光倍率抬到最低 0.75（原版夜视在洞穴里也能看清），并抬高亮度下限
    const nightVision = this.effects.nightVision;
    const effectiveSky = nightVision ? Math.max(0.75, skyBrightness) : skyBrightness;
    this.solidMaterial.setMinBrightness(
      nightVision ? 0.45 : this.solidMaterial.defaultMinBrightness,
    );
    this.translucentMaterial.setMinBrightness(
      nightVision ? 0.5 : this.translucentMaterial.defaultMinBrightness,
    );

    this.solidMaterial.skyBrightness = effectiveSky;
    this.translucentMaterial.skyBrightness = effectiveSky;
    // 掉落物的天光贡献跟着昼夜变化（逐实体采样在 updateEntities 里做）
    this.entityRenderer.skyBrightness = effectiveSky;
    this.syncRenderBrightness(effectiveSky);

    // 穹顶：顶部略深、地平线略亮；日出日落时给太阳附近加霞光
    this.domeTop.copy(this.skyColor).multiplyScalar(0.86);
    this.domeHorizon.copy(this.skyColor).lerp(WHITE_SKY, 0.32);
    this.sky.setDomeColors(this.domeTop, this.domeHorizon);
    this.sky.setSunGlow(Math.max(0, 1 - Math.abs(sunHeight) * 3.2) * (1 - overcast) * 0.9);
    this.sky.setCloudAppearance(daylight, overcast);

    // 雾不再直接等于视距，而是**滞后于**它（见 `updateFogRadius`）：
    // 雾推过去之前，那一圈的区块早就画好了，于是新地形是"从雾里浮出来"，
    // 而不是在空地上一块块长出来。启动期的渐进视距走的也是同一条路。
    this.updateFogRadius(dt);
    const fogFar = this.fogRadius * 16 * (1 - overcast * 0.45);
    const fogNear = fogFar * 0.72;
    this.solidMaterial.setFog(this.skyColor, fogNear, fogFar);
    this.translucentMaterial.setFog(this.skyColor, fogNear, fogFar);
  }

  /**
   * 同步"非体素"渲染物（粒子、手持物品）的亮度。
   *
   * 它们不走烘焙进顶点的光照，但仍然要跟着昼夜与维度变暗，
   * 否则夜里挖方块会看到一簇亮得发光的碎块、洞里举着方块像自发光。
   */
  private syncRenderBrightness(value: number): void {
    const brightness = Math.max(PARTICLE_MIN_BRIGHTNESS, value);
    this.particles.setBrightness(brightness);
    this.hand.setBrightness(brightness);
  }

  /**
   * 视线介质（水下 / 岩浆）：整屏色罩 + 更近的雾。
   *
   * 必须放在维度环境**之后**：雾是每帧重算的，介质要覆盖维度给的远雾，
   * 否则在水下还能看清远处地形（原版水下只能看清十几格）。
   */
  private applyMediumEnvironment(): void {
    // 站在传送门里（或正在传送的等待期）时，紫色色罩**优先于**水下/岩浆色罩：
    // 原版门的紫色是盖在一切之上的，否则在门里看水面会变成一片青色。
    // 末地传送门（批次 111）走同一条色罩：原版两扇门都是那片紫。
    const effect =
      this.pendingArrival !== null || this.playerInPortal() || this.playerInEndPortal()
        ? 'portal'
        : this.eyeMedium();
    this.screenEffects.set(effect);
    // 音效跟着一起"闷"（批次 138）：水下听什么都该是低通之后的
    this.audio.underwater = effect === 'water';

    if (effect === 'water') {
      this.solidMaterial.setFog(WATER_FOG, WATER_FOG_NEAR, WATER_FOG_FAR);
      this.translucentMaterial.setFog(WATER_FOG, WATER_FOG_NEAR, WATER_FOG_FAR);
    } else if (effect === 'lava') {
      this.solidMaterial.setFog(LAVA_FOG, LAVA_FOG_NEAR, LAVA_FOG_FAR);
      this.translucentMaterial.setFog(LAVA_FOG, LAVA_FOG_NEAR, LAVA_FOG_FAR);
    } else if (effect === 'blindness' || effect === 'darkness') {
      // 失明/黑暗：雾拉到很近，远处的方块直接看不见（原版失明就是这个观感）
      const near = effect === 'blindness' ? 1.5 : 6;
      const far = effect === 'blindness' ? 5 : 18;
      this.solidMaterial.setFog(0x000000, near, far);
      this.translucentMaterial.setFog(0x000000, near, far);
    }
  }

  /**
   * 当前应该显示哪种整屏色罩。
   *
   * 优先级：岩浆 > 失明 > 黑暗 > 水下。
   * 理由是"越看不见越优先"——泡在岩浆里当然是岩浆色，失明时即使在水下也几乎全黑。
   * （原版这几种效果是叠乘的，这里用单个色罩近似，视觉差别很小但代码简单得多。）
   */
  private eyeMedium(): ScreenEffect {
    const p = this.physics;
    const eye = this.world.getBlock(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    if (eye === Block.LAVA) return 'lava';
    if (this.effects.blinded) return 'blindness';
    if (this.effects.darkened) return 'darkness';
    if (eye === Block.WATER) return 'water';
    return 'none';
  }

  /**
   * 粒子总更新（E13）：推进已有粒子，再按玩家所处位置补"环境粒子"。
   *  - 入水那一瞬间溅一片水花（靠上一帧的 inWater 判定跳变）
   *  - 泡在岩浆里持续冒火焰
   */
  private updateParticles(dt: number): void {
    const p = this.physics;

    if (p.inWater && !this.wasInWater) {
      this.particles.spawnSplash(p.x, p.y + 0.25, p.z);
    }
    this.wasInWater = p.inWater;

    this.flameTimer -= dt;
    if (this.flameTimer <= 0) {
      this.flameTimer = 0.07;
      const feet = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z));
      // 站在火里、被点燃（离开火之后还会烧一会儿）或泡在岩浆里都冒火焰粒子——
      // 这是"我着火了"唯一的视觉反馈，没有它玩家只会看到血量莫名其妙地掉
      const onFire = this.stats.burning || feet === Block.FIRE;
      if (feet === Block.LAVA || this.eyeMedium() === 'lava' || onFire) {
        this.particles.spawnFlame(
          p.x + (Math.random() - 0.5) * 0.6,
          p.y + 0.5 + Math.random() * 0.7,
          p.z + (Math.random() - 0.5) * 0.6,
        );
      }
      // 站在传送门里：紫色光点从门里往上飘（原版门前一直飘着这样的粒子）
      if (this.playerInPortal()) {
        this.particles.spawnPortal(
          p.x + (Math.random() - 0.5) * 0.7,
          p.y + 0.4 + Math.random() * 0.8,
          p.z + (Math.random() - 0.5) * 0.7,
          1,
          0.15,
        );
      }
      // 气泡柱（E22）：眼睛泡在水里时，身边一直往上冒小气泡（原版潜到水里就是这个观感）
      if (this.eyeMedium() === 'water') {
        this.particles.spawnBubble(
          p.x + (Math.random() - 0.5) * 0.9,
          p.y + 0.3 + Math.random() * 0.9,
          p.z + (Math.random() - 0.5) * 0.9,
          1,
        );
      }
      // 雨滴溅落（E22）：露天淋雨时脚边地面上一颗颗小水星（雪地是白的）。
      // 与"天气效果"开关同一个判据（批次 172）：关掉雨点却还在溅雨花，那开关就是坏的
      if (
        this.settings.weatherEffects &&
        this.weather.raining &&
        this.dimension === Dimension.OVERWORLD &&
        this.eyeMedium() !== 'water'
      ) {
        this.spawnRainSplashNear(p.x, p.y, p.z);
      }
    }

    this.particles.update(dt);
  }

  /**
   * 雨滴溅落（E22）：在玩家周围试两个点，只对"那一层是空气、下面一格是实心"的位置溅。
   *
   * ⚠️ 判据用**玩家脚下那一层**（`floor(y)`），不是每列各自去算地表：
   * 算地表要逐列扫方块，一秒几十次会把"下雨时的帧率"吃光——而雨花本来就是
   * "打在你正踩着的那片地上"最容易被看见。坡地上会少溅几颗，这个取舍是划算的。
   */
  private spawnRainSplashNear(x: number, y: number, z: number): void {
    for (let i = 0; i < 2; i++) {
      const bx = Math.floor(x + (Math.random() - 0.5) * 8);
      const bz = Math.floor(z + (Math.random() - 0.5) * 8);
      const by = Math.floor(y);
      if (this.world.getBlock(bx, by, bz) !== Block.AIR) continue;
      if (this.world.getBlock(bx, by - 1, bz) === Block.AIR) continue;
      const snowy = this.isSnowyColumn(bx, bz);
      this.particles.spawnRainSplash(bx + 0.5, by + 0.05, bz + 0.5, 2, snowy ? 0xffffff : 0xa8c8e0);
    }
  }

  /** 走路时手臂轻微上下摆动（静止时归零，避免站着也在抖） */
  private isPlayerMoving(): boolean {
    const p = this.physics;
    return p.onGround && Math.hypot(p.vx, p.vz) > 0.6;
  }

  /**
   * 方块碎块的颜色：取顶面与侧面贴图的平均色。
   * 只取一张容易失真 —— 草方块侧面大半是土色，只用侧面会把"挖草"画成"挖土"。
   */
  private blockParticleColor(blockId: number): number {
    const tiles = blockDef(blockId).tiles;
    const top = this.atlas.averageColor(tiles[0]);
    const side = this.atlas.averageColor(tiles[2]);
    const r = (((top >> 16) & 0xff) + ((side >> 16) & 0xff)) >> 1;
    const g = (((top >> 8) & 0xff) + ((side >> 8) & 0xff)) >> 1;
    const b = ((top & 0xff) + (side & 0xff)) >> 1;
    return (r << 16) | (g << 8) | b;
  }

  private refreshWorld(centerCx: number, centerCz: number, force = false): void {
    if (!force && centerCx === this.lastCenterCx && centerCz === this.lastCenterCz) return;
    this.lastCenterCx = centerCx;
    this.lastCenterCz = centerCz;
    // 启动期用**渐进视距**（批次 100）：`startupRamp` 涨到玩家设定的视距之前，
    // 只按当前那一圈请求区块——先把"脚下这一片"做出来，别让玩家等整个视距
    this.world.update(centerCx, centerCz, this.viewDistanceNow);
  }

  /** 预选一片值得加载的陆地；读档失败时也走这里，不能把玩家留在空世界。 */
  private prepareNewWorldSpawn(): void {
    // 原点恰在大海时，小视距永远加载不到陆地，安全出生点也就无从复核。
    this.biomeGenerator = new OverworldGenerator(this.worldConfig.seed, this.worldConfig.worldType);
    const region = planSpawnRegion(
      (x, z) => this.biomeGenerator!.surfaceY(x, z),
      (x, z) => this.biomeGenerator!.biomeAt(x, z).name,
    );
    this.spawnSearchX = region.x;
    this.spawnSearchZ = region.z;
    this.physics.teleport(region.x + 0.5, 80, region.z + 0.5);
    this.refreshWorld(toChunkCoord(region.x), toChunkCoord(region.z), true);
  }

  /** 这一帧的生效视距（区块）：启动期是逐格涨的，涨到位之后就是玩家的设置值 */
  private get viewDistanceNow(): number {
    return Math.min(this.viewDistance, this.startupRamp.radius);
  }

  /**
   * 雾的当前半径（区块，**连续量**）。
   *
   * 区块请求半径是整数、一跳就是一整圈（16 格），而雾是连续的。让连续量**滞后于**
   * 离散量，"视距变了"就从"跳一格"变成"雾涌上来 / 雾散开"。0 表示还没初始化。
   */
  private fogRadius = 0;
  /** 雾在等"远处区块就绪"上已经耗了多久（秒），用于 `FOG_GROW_WAIT_LIMIT` 那个兜底 */
  private fogWait = 0;

  /**
   * 雾半径平滑跟随视距（批次 158 的第二件事：别让地形一块一块地弹出来）。
   *
   * 两个方向**刻意不对称**：
   *  - **收缩要快**：掉帧时立刻把远处收进雾里，玩家看到的是"雾涌上来"；
   *    随后被卸载的那一圈此刻已经在雾里了，所以看不见它消失；
   *  - **扩张要慢、而且要等**：视距变大时先发区块请求，等那一圈真的画好了才推雾——
   *    新地形于是"从雾里浮出来"，而不是在空地上逐块长出来。
   *
   * ⚠️ 就绪门控必须配一个等待上限：玩家一直在挖方块时网格队列几乎永远非空，
   * 只认就绪的话雾会**永远**推不出去（表现为"视距变大了但一直灰蒙蒙"）。
   *
   * ⚠️ 构造顺序：构造函数里的 `applyEnvironment()` 比 `chunkRenderer` **还早**跑一次
   * （它要到 1203 行才建）。那一趟只是"把环境算一遍"，谈不上"远处画好了没"，
   * 所以必须先确认渲染层在——否则每一局的第一帧就崩在 `queueLength` 上
   * （`Cannot read properties of undefined`）。这类回归离线断言看不到，只有真跑才现形。
   */
  private updateFogRadius(dt: number): void {
    if (!this.chunkRenderer) {
      if (this.fogRadius <= 0) this.fogRadius = this.viewDistanceNow;
      return;
    }

    // "就绪"的判据：目标那一圈既没有待生成的、也没有待网格化的。
    // 网格队列在挖方块时几乎永远非空，所以 `fogRadiusStep` 里配了等待上限。
    const ready = this.world.pendingCount === 0 && this.chunkRenderer.queueLength === 0;
    const next = fogRadiusStep(this.fogRadius, this.viewDistanceNow, dt, ready, this.fogWait);
    this.fogRadius = next.radius;
    this.fogWait = next.waited;
  }

  /**
   * 第一块地形完成网格化、且玩家已经放到安全地面后才撤掉加载遮罩。
   * 注意：必须在主循环里检查——区块"加载完成"时还没有网格，只监听加载事件会永远等不到。
   *
   * 批次 167：遮罩不再写在 HTML 里（那样首屏就会显示"正在生成世界…"），
   * 它由 `showLoading()` 在**进世界那一刻**挂出来，这里只负责撤掉。
   */
  private refreshLoadingState(): void {
    if (this.loadingCleared) return;
    if (!this.spawnResolved) return;
    if (this.chunkRenderer.chunkMeshCount === 0) return;
    this.loadingCleared = true;
    startupTrace.mark(STARTUP_PHASES.worldPlayable);
    hideLoading();
  }

  // ---------------------------------------------------------------- 快捷栏

  private buildHotbar(): void {
    const container = document.getElementById('hotbar');
    if (!container) return;
    container.replaceChildren();
    this.hotbarSlots.length = 0;

    for (let index = 0; index < HOTBAR_SIZE; index++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.index = String(index);
      // 悬停提示：Tooltip 靠这个属性认出可悬停元素
      slot.dataset.tooltip = '';

      const icon = document.createElement('canvas');
      icon.className = 'icon';
      icon.width = 32;
      icon.height = 32;
      slot.appendChild(icon);

      const count = document.createElement('span');
      count.className = 'count';
      slot.appendChild(count);

      const label = document.createElement('span');
      label.className = 'index';
      label.textContent = String(index + 1);
      slot.appendChild(label);

      // 耐久条（批次 28）：受损的工具/盔甲在格子底部显示一条，快坏了会变红
      const durability = document.createElement('i');
      durability.className = 'dur-bar hidden';
      const fill = document.createElement('b');
      durability.appendChild(fill);
      slot.appendChild(durability);

      container.appendChild(slot);
      this.hotbarSlots.push(slot);
    }

    // 物品名浮标（批次 95）：挂在快捷栏**外面**（它自己不吃手势，且不该被槽位重建带走）
    if (!this.selectedItemName) {
      const label = document.createElement('div');
      label.id = 'selected-item-name';
      // 父元素是 HUD（pointer-events: none），这里不需要再关一次；显式写出来免得以后挪位置踩坑
      label.style.pointerEvents = 'none';
      document.getElementById('hud')?.appendChild(label);
      this.selectedItemName = label;
    }

    if (!this.hotbarTooltipBound) {
      this.hotbarTooltipBound = true;
      this.tooltip.delegate(
        container,
        (element) => {
        const index = Number(element.dataset.index);
        if (!Number.isFinite(index)) return null;
        const stack = this.inventory.get(index);
        return stack ? itemTooltip(stack.id, stack.count, stack.damage, stack.enchants, stack.name) : null;
        },
        // 触摸端：长按 600ms 看详情（批次 95）。快捷栏上一次长按没有别的含义，
        // 所以这里是最安全的"看物品详情"入口——手机上原来根本看不到耐久与附魔
        { touchLongPressMs: TOUCH_TOOLTIP_MS },
      );
    }

    // 触摸端点快捷栏切换（鼠标路径走键盘 1-9）。
    // ⚠️ 这条绑定以前**从来没被触发过**：`#hud` 是 pointer-events: none，
    // 而触摸层的视角面铺满全屏且排在快捷栏之后（见 index.html 的 body.touch 规则）
    bindHotbarTouch(container, (index) => this.selectSlot(index));

    this.refreshHotbar();
  }

  /** 快捷栏直接反映背包的 0-8 号槽位 */
  private refreshHotbar(): void {
    for (let index = 0; index < this.hotbarSlots.length; index++) {
      const slot = this.hotbarSlots[index]!;
      const stack = this.inventory.get(index);
      const icon = slot.querySelector('canvas') as HTMLCanvasElement;
      const count = slot.querySelector('.count') as HTMLSpanElement;
      const durability = slot.querySelector('.dur-bar') as HTMLElement;

      if (stack) {
        drawItemIcon(icon, this.atlas, stack.id, 32);
        icon.style.visibility = 'visible';
        count.textContent = stack.count > 1 ? String(stack.count) : '';
        // 不用浏览器自带的 title：会和我们的提示框重复弹两次（内容也少）
        slot.title = '';
      } else {
        icon.style.visibility = 'hidden';
        count.textContent = '';
        slot.title = '';
      }
      // 耐久条：满耐久的工具不显示（原版也只在受损后显示）
      updateDurabilityBar(durability, stack);
      slot.classList.toggle('active', index === this.hotbarIndex);
    }
  }

  /** 当前手持方块；手上不是可放置物品时返回 undefined */
  private get selectedBlock(): number | undefined {
    const stack = this.inventory.get(this.hotbarIndex);
    if (!stack) return undefined;
    return blockForItem(stack.id);
  }

  /** 当前手持物品的附魔（配合 `heldTool` 用；手上没东西时为空对象） */
  private get heldEnchants(): Readonly<Record<string, number>> | undefined {
    return this.inventory.get(this.hotbarIndex)?.enchants;
  }

  /** 当前手持的工具属性；手上不是工具时返回 null（徒手） */
  private get heldTool(): ToolInfo | null {
    const stack = this.inventory.get(this.hotbarIndex);
    return stack ? toolInfoById(stack.id) ?? null : null;
  }

  /**
   * 手上拿着的东西能不能吃；能的话连物品 id 一起返回。
   * 手里是食物时**不是**可放置方块，所以放置那条路径会自己走空。
   */
  private get heldFood(): { id: number; food: FoodInfo } | null {
    const stack = this.inventory.get(this.hotbarIndex);
    if (!stack) return null;
    const food = foodInfoById(stack.id);
    return food ? { id: stack.id, food } : null;
  }

  /**
   * 手上的药水（H10）。
   *
   * 药水**不走 `FOOD_TABLE`**：它不回饥饿也不回饱和度，唯一的作用是挂状态效果，
   * 而且种类是 id 枚举（见 `potions.ts`）。但"按住 1.6 秒才喝下去"这套状态机
   * 与进食完全一样，所以复用它、只换最后那一步结算。
   */
  private get heldPotion(): PotionEntry | null {
    const stack = this.inventory.get(this.hotbarIndex);
    if (!stack) return null;
    const potion = potionById(stack.id);
    // **喷溅型不能喝**（K4 尾巴）：它在手上点按是扔出去（见 `throwHeld`），
    // 长按也不该变成"喝掉一瓶要扔的药水"
    return isDrinkable(potion) ? potion : null;
  }

  /**
   * 是否正在"按住使用"。
   *
   * 鼠标右键与手柄的"使用"键直接算按住；触摸端没有独立的"使用"按钮，
   * 于是借用手势里唯一还没被用掉的空档：**长按空处**（准星没对着任何方块）。
   * 长按方块仍然是破坏，长按空处以前什么都不做。
   */
  private get usingItem(): boolean {
    if (this.rightDown || this.padUse) return true;
    return this.touch !== null && this.leftDown && this.hit === null;
  }

  /**
   * 数附魔台周围的书架（H9）。
   *
   * 照抄原版的判定（`EnchantmentTableBlock#getEnchantPowerBonus` 那一段）：
   *  - 只看**以附魔台为中心 5×5 的外圈**（内 3×3 不算），且与附魔台同一高度；
   *  - 书架与附魔台之间那一格必须是空气——这条是关键：
   *    少了它，玩家把书架贴着附魔台堆一圈也能满级，与"围一圈留空"的常识不符；
   *  - 附魔台上方两格必须是空的（站不下人就没法附魔）。
   */
  private countBookshelves(x: number, y: number, z: number): number {
    if (this.world.getBlock(x, y + 1, z) !== Block.AIR || this.world.getBlock(x, y + 2, z) !== Block.AIR) return 0;

    let count = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        // 内圈跳过，只数外圈
        if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
        if (this.world.getBlock(x + dx, y, z + dz) !== Block.BOOKSHELF) continue;
        // 中间那格（dx/2, dz/2）要是空气
        const midX = x + Math.trunc(dx / 2);
        const midZ = z + Math.trunc(dz / 2);
        if (this.world.getBlock(midX, y, midZ) !== Block.AIR) continue;
        count++;
      }
    }
    return count;
  }

  /**
   * 记账一处经验（I5）。
   *
   * ⚠️ 批次 170（I16）起这里是**记账**那一半：只有在玩家把经验球吸到手时才调它
   * （`EntityContext.awardXp` → 由 `XpOrb` 触发）。"经验从哪掉出来"是另一个钩子
   * `spawnXpOrbs`——两个分开，否则"死亡要掉球"这件事就没法断定了。
   * `Experience.add` 自己处理连升多级与小数余数。
   */
  private awardXp(amount: number): void {
    if (amount <= 0) return;
    // 「经验修补」（K3）：身上带这条附魔的装备没修满时，经验先被拿去修它，
    // 剩下的才进经验条（原版就是这样——球直接被消耗掉，不进条）
    const used = applyMending(this.mendingCandidates(), amount);
    const remaining = amount - used;
    if (remaining > 0) this.experience.add(remaining);
    if (used > 0) this.refreshHotbar();
  }

  /**
   * 把一团经验**掉成几个球**（批次 170，I16）。
   *
   * 拆档是纯函数（`splitXpOrbs`：10 → 7+3、龙的 12000 → 3073+3073+…+247…），
   * 这里只负责建实体。调用点给的都是"这件事发生在哪"：
   * 挖矿是那一格的格心、熔炉与钓鱼是玩家脚下（它们本来就没有明确的掉落点）。
   */
  private spawnXpOrbs(amount: number, x: number, y: number, z: number): void {
    if (amount <= 0) return;
    for (const size of splitXpOrbs(amount)) {
      this.entities.spawn(new XpOrb(size, x, y, z));
    }
  }

  /**
   * 能被「经验修补」修到的物品：整个背包 0-40 号槽（含盔甲与副手）。
   * 每次现取一份快照而不是缓存——背包随时在变，缓存一份迟早会修到已经丢掉的物品上。
   */
  private mendingCandidates(): (ItemStack | null)[] {
    const stacks: (ItemStack | null)[] = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) stacks.push(this.inventory.get(i));
    return stacks;
  }

  /**
   * 把身上这套盔甲"长"到模型上（E14）。
   *
   * 甲片颜色取**该件装备图标贴图的平均色**（`TextureAtlas.averageColor` 自带缓存），
   * 于是"背包里看到的图标"和"第三人称身上甲片的颜色"同源，换套甲不会出现颜色对不上；
   * 渲染层因此也不需要认识"盔甲材质"这个概念，加一种材质不必改渲染代码。
   *
   * 装备没变时 `setArmor` 只做几次比较，所以逐帧调用不会产生垃圾。
   */
  private applyArmorAppearance(): void {
    let key = '';
    for (let slot = 0; slot < ARMOR_SLOT_COUNT; slot++) {
      key += `${this.inventory.get(ARMOR_SLOT_BASE + slot)?.id ?? 0},`;
    }
    if (key === this.armorKey) return;
    this.armorKey = key;

    for (let slot = 0; slot < ARMOR_SLOT_COUNT; slot++) {
      const stack = this.inventory.get(ARMOR_SLOT_BASE + slot);
      const info = stack ? armorInfoById(stack.id) : undefined;
      // 部位与槽位对不上（坏存档）时不画，与 `armor.ts#equippedArmor` 保持同一口径
      this.armorColors[slot] = info && info.slot === slot ? this.atlas.averageColor(armorTile(info)) : null;
    }
    this.playerRenderer.setArmor(this.armorColors);
    // 第一人称只看得到胸甲（袖套），其余三件在镜头盲区
    this.hand.setArmorColor(this.armorColors[1] ?? null);
  }

  /**
   * 消耗手持工具 1 点耐久；耐久耗尽就整件消失。
   * 创造模式（飞行中）不掉耐久，与原版一致。
   */
  private damageHeldTool(amount = 1): void {
    if (this.isCreative || amount <= 0) return;
    const index = this.hotbarIndex;
    const stack = this.inventory.get(index);
    if (!stack) return;
    // 用统一的 `durabilityOf`：工具、盔甲、弓都在里面。
    // 注意**不能**只看 `toolInfoById`——那样弓永远不掉耐久
    const max = durabilityOf(stack.id);
    if (max <= 0) return;
    // 耐久附魔：每级有 level/(level+1) 的概率**不**消耗这次耐久（原版 `random.nextInt(level+1) > 0`）
    const unbreaking = enchantLevel(stack.enchants, 'unbreaking');
    if (unbreaking > 0 && Math.random() < unbreaking / (unbreaking + 1)) return;
    const damage = (stack.damage ?? 0) + amount;
    if (damage >= max) {
      // 耐久耗尽：工具直接消失（原版行为，不掉落残骸）
      this.inventory.set(index, null);
      this.audio.play('break_wood');
    } else {
      this.inventory.set(index, { ...stack, damage });
    }
    this.refreshHotbar();
  }

  private get heldName(): string {
    const stack = this.inventory.get(this.hotbarIndex);
    if (!stack) return '空';
    const tool = toolInfoById(stack.id);
    const durability = tool ? ` (${durabilityLabel(tool, stack.damage ?? 0)})` : '';
    return `${itemName(stack.id)} ×${stack.count}${durability}`;
  }

  /** 调试面板：手上工具挖不挖得动准星指向的方块（挖得动但采不到时给出提示） */
  private targetToolHint(blockId: number): string {
    const required = harvestRequirement(blockId);
    if (!required || canHarvest(blockId, this.heldTool)) return '';
    const toolName = {
      pickaxe: '镐',
      axe: '斧',
      shovel: '锹',
      hoe: '锄',
      sword: '剑',
      shears: '剪刀',
      // 三叉戟（批次 123）：它的采集档位与徒手相同，所以这句话基本不会出现——
      // 但类型上它是 `ToolType` 的一员，得有个名字
      trident: '三叉戟',
    }[required.tool];
    const tierName = ['木', '石', '铁', '钻石', '下界合金'][required.tier] ?? '';
    return `   ⚠ 需要${tierName}${toolName}才掉落`;
  }

  // ---------------------------------------------------------------- 输入

  private bindEvents(): void {
    document.addEventListener('keydown', (e) => {
      // 正在界面里输入文字（创造物品栏搜索框）时不要抢按键，否则输入 e 会把界面关掉
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (e.code !== 'Escape') return;
      }
      // 睡觉期间（B13）：只留跳跃键（提前起床），其余按键一律不处理——
      // 否则会在睡觉遮罩下面打开背包/配方书/聊天，而时间已经跳到天亮了
      if (this.sleeping && e.code !== 'Space') return;
      // 告示牌编辑中（B12）：按键归输入框（Esc 由编辑器自己处理）——
      // 输入框失焦时（玩家点了别处）按 E 不该把背包也打开
      if (this.signEditor.isOpen && e.code !== 'Escape') return;
      // Esc：**先关成就面板**（它可能叠在暂停菜单上面），再轮到暂停菜单
      if (e.code === 'Escape' && this.advancementScreen.isOpen) {
        e.preventDefault();
        this.closeAdvancements();
        return;
      }
      // Esc：打开/关闭暂停菜单（内含设置）。原版也是 Esc 唤出菜单而不是直接退出。
      // ⚠️ 批次 108 起暂停菜单分两层（菜单页 / 设置页）：Esc 是"退一层"，
      // 在设置页先回菜单、再按一次才回到游戏（`goBack` 把这条判断收在一处）。
      if (e.code === 'Escape' && !this.inventoryScreen.isOpen) {
        e.preventDefault();
        if (this.settingsScreen.isOpen) this.settingsScreen.goBack();
        else this.openSettings();
        return;
      }
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyE') {
        e.preventDefault();
        this.inventoryScreen.toggle();
        return;
      }
      // R：配方书（原版是 E 里的一个页签，这里给个独立热键更顺手）。
      // 放在 uiOpen 判断**之前**：书开着的时候也要能按 R 关掉。
      if (e.code === 'KeyR') {
        e.preventDefault();
        this.toggleRecipeBook();
        return;
      }
      // J：成就 / 进度面板。原版把它放在暂停菜单里（本项目的暂停菜单里也有一个按钮），
      // 这里另给一个热键——它是个"随时想看"的东西，翻菜单太绕。
      // 同样放在 uiOpen 判断之前：面板开着的时候也要能按 J 关掉
      if (e.code === 'KeyJ') {
        e.preventDefault();
        this.toggleAdvancements();
        return;
      }
      // T / 斜杠：打开聊天与命令输入（原版就是这两个键）
      if (e.code === 'KeyT' || e.code === 'Slash') {
        e.preventDefault();
        this.chat.openWith(e.code === 'Slash' ? '/' : '');
        return;
      }
      if (this.uiOpen) return;
      if (e.code === 'KeyF') this.setFlying(!this.flying);
      // V：切换人称视角（第一人称 → 背后 → 正面 → …）。
      // 不用原版的 F5：浏览器里 F5 是刷新，拦不住。
      if (e.code === 'KeyV') this.cycleCameraMode();
      // N：在主世界与下界之间切换（临时的维度入口；下界传送门要等火焰方块与打火石做完）
      if (e.code === 'KeyN') this.toggleDimension();
      // L：连接/断开联机服务器（服务端见 server/index.mjs）
      if (e.code === 'KeyL') {
        if (this.net.connected) this.disconnect();
        else this.connect();
      }
      if (e.code.startsWith('Digit')) {
        const digit = Number(e.code.slice(5));
        if (digit >= 1 && digit <= HOTBAR_SIZE) {
          this.selectSlot(digit - 1);
          this.refreshHotbar();
        }
      }
    }, { signal: this.listeners.signal });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code), {
      signal: this.listeners.signal,
    });

    // 批次 159：**长按属于我们的手势**（取一半 / 看详情 / 选数量），
    // 必须先屏蔽 HTML 自带的那一套长按效果——否则手机上长按物品图标会弹出
    // "保存图片 / 下载图片"，长按文字会选中并弹出选择菜单。
    // ⚠️ 原来这句话写在下面 `if (!this.touch)` 那一段里（那是给指针锁用的），
    //    于是**触摸端一直没屏蔽**——这正是"长按总是弹出保存图片"的原因。
    //    输入框要留着：聊天与搜索还得能粘贴、全选。
    document.addEventListener(
      'contextmenu',
      (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.('input, textarea')) return;
        event.preventDefault();
      },
      { signal: this.listeners.signal },
    );

    // 触摸端不需要指针锁（拖动即转视角），所以只有桌面端接这套
    // ⚠️ 批次 111 把"点击进入游戏"那层遮罩删掉之后，PC 进世界的第一步就是**点一下画面**
    // ——`requestPointerLock()` 必须在用户手势的调用栈里，这一下点击就是那个手势。
    if (!this.touch) {
      document.addEventListener(
        'pointerlockchange',
        () => {
          this.locked = document.pointerLockElement === this.renderer.domElement;
          if (!this.locked) {
            this.keys.clear();
            this.leftDown = false;
            this.rightDown = false;
          }
        },
        { signal: this.listeners.signal },
      );

      const requestLock = () => void this.renderer.domElement.requestPointerLock();
      this.renderer.domElement.addEventListener('click', requestLock, { signal: this.listeners.signal });

      document.addEventListener(
        'mousemove',
        (e) => {
          if (!this.locked) return;
          // 灵敏度是设置项（0.5~2 倍）：鼠标、触摸、手柄三条路径都要乘上，不然调了没感觉
          const gain = this.settings.sensitivity;
          this.applyLook(e.movementX * MOUSE_SENSITIVITY * gain, e.movementY * MOUSE_SENSITIVITY * gain);
        },
        { signal: this.listeners.signal },
      );

      document.addEventListener(
        'mousedown',
        (e) => {
          if (!this.locked) return;
          // **中键拾取方块**（批次 129）：按一下就结算，不需要按住（原版也如此）
          if (e.button === 1) {
            e.preventDefault();
            this.pickBlock();
            return;
          }
          if (e.button === 0) this.leftDown = true;
          if (e.button === 2) this.rightDown = true;
        },
        { signal: this.listeners.signal },
      );
      document.addEventListener(
        'mouseup',
        (e) => {
          if (e.button === 0) this.leftDown = false;
          if (e.button === 2) this.rightDown = false;
        },
        { signal: this.listeners.signal },
      );
    }

    window.addEventListener(
      'resize',
      () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        // 转屏也走动态分辨率的唯一同步入口：保留 DPR×档位，且不让 three 改写 CSS 尺寸。
        this.applyResolutionScale();
        // 快捷栏在手机断点由 32px 变 36px，重新按实际 CSS 尺寸分配清晰背板。
        this.refreshHotbar();
        if (this.inventoryScreen.isOpen) this.inventoryScreen.refresh();
      },
      { signal: this.listeners.signal },
    );
    // 窗口失焦（切 App / 下拉通知栏）时手指的抬起可能永远收不到：
    // 清零输入，回来不会出现"摇杆一直朝某个方向"或"视角还在转"
    window.addEventListener('blur', () => this.touch?.resetInput('blur'), {
      signal: this.listeners.signal,
    });
  }

  /**
   * 施加视角增量（像素）。鼠标与触摸共用同一套，只是灵敏度不同。
   * 触摸端手指行程比鼠标短，所以灵敏度调高一些，手感才接近。
   */
  private applyLook(dxPixels: number, dyPixels: number): void {
    this.yaw -= dxPixels;
    // 反转上下视角（设置项）：把纵向增量取反即可，水平方向不受影响
    this.pitch -= this.settings.invertY ? -dyPixels : dyPixels;
    const limit = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  private collectInput(): PlayerInput {
    // 键盘 / 触摸 / 手柄三路输入取"较大者"而不是相加：
    // 外接键盘 + 手柄同时用时也不会速度翻倍
    const touch = this.touch?.input;
    const pad = this.gamepadState;

    let forward = 0;
    let strafe = 0;
    if (this.keys.has('KeyW')) forward += 1;
    if (this.keys.has('KeyS')) forward -= 1;
    if (this.keys.has('KeyD')) strafe += 1;
    if (this.keys.has('KeyA')) strafe -= 1;

    const keyboardSprint = this.keys.has('ControlLeft') || this.keys.has('ControlRight');

    return {
      forward: clampUnit(forward + (touch?.forward ?? 0) + (pad?.forward ?? 0)),
      strafe: clampUnit(strafe + (touch?.strafe ?? 0) + (pad?.strafe ?? 0)),
      jump: this.keys.has('Space') || (touch?.jump ?? false) || (pad?.jump ?? false),
      sneak: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (touch?.sneak ?? false) || (pad?.sneak ?? false),
      sprint: keyboardSprint || (touch?.sprint ?? false) || (pad?.sprint ?? false),
    };
  }

  // ---------------------------------------------------------------- 视角（F7）

  /**
   * 每帧摆好相机与玩家模型。
   *
   * 第一人称：相机就架在眼睛上，朝向 = (pitch, yaw)，手上显示手臂 + 手持物品。
   * 第三人称：相机沿视线方向前后挪一段距离，并且**先做一次体素射线检测**——
   * 贴墙时如果不检测，镜头会退到方块内部，看到的是一片黑。
   * 这时显示玩家模型、藏起第一人称的手臂（否则会有一只手飘在镜头前）。
   */
  private updateCamera(dt: number): void {
    // 走路相位：按水平速度推进，停下时摆动幅度平滑衰减回 0（不然会突然"立正"）
    const speed = Math.hypot(this.physics.vx, this.physics.vz);
    const target = this.physics.onGround && speed > 0.6 ? Math.min(1, speed / 4.3) : 0;
    this.walkAmount += (target - this.walkAmount) * Math.min(1, dt * 8);
    if (this.walkAmount > 0.01) this.walkPhase += dt * (5 + speed * 1.4);

    const eye = { x: this.physics.x, y: this.physics.eyeY, z: this.physics.z };
    const [dirX, dirY, dirZ] = PlayerPhysics.lookDirection(this.yaw, this.pitch);
    const dir = { x: dirX, y: dirY, z: dirZ };

    const distance =
      this.cameraMode === 'first'
        ? 0
        : this.cameraDistance(eye, dir, this.cameraMode === 'third-back' ? -1 : 1);
    const placement = cameraPlacement(eye, dir, this.yaw, this.pitch, this.cameraMode, distance);
    this.camera.position.set(placement.x, placement.y, placement.z);
    this.camera.rotation.set(placement.pitch, placement.yaw, 0);

    const thirdPerson = this.cameraMode !== 'first';
    // 隐身（K4 尾巴）：第三人称看不到自己；第一人称的手仍然照画（原版也是这样）
    this.playerRenderer.setVisible(thirdPerson && !this.effects.invisible);
    this.hand.setVisible(!thirdPerson);
    // 盔甲：第三人称画甲片、第一人称只画胸甲袖套，但取色是同一份
    this.applyArmorAppearance();
    if (thirdPerson) {
      this.playerRenderer.update(
        {
          x: this.physics.x,
          y: this.physics.y,
          z: this.physics.z,
          yaw: this.yaw,
          pitch: this.pitch,
          walkPhase: this.walkPhase,
          walkAmount: this.walkAmount,
          swing: this.hand.swingProgress,
          flying: this.flying,
        },
        (x, y, z) => {
          if (!this.world.isLoaded(x, z)) return null;
          return { sky: this.world.getSkyLight(x, y, z), block: this.world.getBlockLight(x, y, z) };
        },
      );
    }
  }

  /**
   * 第三人称相机到眼睛的距离：撞到方块就停在撞点之前。
   * @param sign +1 = 沿视线方向（正面视角），-1 = 反方向（背后视角）
   */
  private cameraDistance(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, sign: number): number {
    const hit = raycastVoxels(
      (x, y, z) => this.world.isSelectable(x, y, z),
      eye.x,
      eye.y,
      eye.z,
      dir.x * sign,
      dir.y * sign,
      dir.z * sign,
      THIRD_PERSON_DISTANCE + CAMERA_CLEARANCE,
    );
    return clampedCameraDistance(hit ? hit.distance : null);
  }

  /** 切换视角模式（写进设置，下次进游戏保持） */
  setCameraMode(mode: CameraMode): CameraMode {
    this.cameraMode = mode;
    this.settings.cameraMode = mode;
    saveSettings(this.settings);
    this.updateCamera(0);
    return mode;
  }

  /** 循环切换视角（`V` 键）：第一人称 → 背后 → 正面 → 第一人称 */
  cycleCameraMode(): CameraMode {
    const mode = this.setCameraMode(nextCameraMode(this.cameraMode));
    // 顶部按钮点完给一句反馈：图标变化在手机上不够明显
    this.hudToast.show(`视角：${CAMERA_MODE_LABELS[mode]}`);
    return mode;
  }

  // ---------------------------------------------------------------- 方块交互

  /**
   * 准星射线要"挡住"哪些体素。
   *
   * 默认与 `World.isSelectable` 一致（水与岩浆可穿过）——这正是一般情况下想要的行为：
   * 站在水里也能选中水下的石头。
   *
   * **例外是手上拿着睡莲**（B16）：水面没有任何"实体面"可以贴，而睡莲只能放在水面上。
   * 所以拿着睡莲时，**只把"水面那一格水"（上方是空气）算作可命中**——
   * 玩家从任何角度看都能选中水面，落点就是水面正上方那一格空气。
   * 只认最上面那一格是关键：否则准星会钻进水里选中底下几格，
   * 落点算出来会是一片水，反而放不下去（见 `updatePlacing` 里的 `onWaterSurface`）。
   */
  private isCrosshairTarget(x: number, y: number, z: number): boolean {
    if (this.world.isSelectable(x, y, z)) return true;
    // 两件事要"选中水面"（水本身是可以穿过的，默认选不中）：
    //  - 放睡莲（B16）：落点是"水面正上方那一格空气"，所以要求上面是空气；
    //  - 抛竿（批次 81）：只要那一格是水就够（浮标就落在这里）
    if (this.heldItemId === Item.FISHING_ROD) return this.world.getBlock(x, y, z) === Block.WATER;
    if (this.selectedBlock !== Block.LILY_PAD) return false;
    if (this.world.getBlock(x, y, z) !== Block.WATER) return false;
    return this.world.getBlock(x, y + 1, z) === Block.AIR;
  }

  /**
   * 玩家是不是**正看着**这一点（批次 112，末影人被注视激怒用）。
   *
   * 两条判据（原版也是这两条）：
   *  1. **视线锥**：这一点与视线方向的夹角 ≤ 5°（`GAZE_CONE_COS`）——大致就是"准星在它身上"；
   *  2. **视线无遮挡**：眼睛到那一点之间没有实心方块——隔着墙瞪着它不该把它惹毛
   *     （`raycastVoxels` 是选取方块用的那一支，这里把"实心"换成"挡视线"来问它）。
   *
   * ⚠️ 开着界面 / 躺着睡觉时一律返回 false：那不算"在看它"。
   */
  private playerGazeAt(x: number, y: number, z: number): boolean {
    if (this.uiOpen || this.sleeping) return false;
    const dx = x - this.physics.x;
    const dy = y - this.physics.eyeY;
    const dz = z - this.physics.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-3) return true;

    const [lookX, lookY, lookZ] = PlayerPhysics.lookDirection(this.yaw, this.pitch);
    if ((dx * lookX + dy * lookY + dz * lookZ) / distance < GAZE_CONE_COS) return false;

    const blocked = raycastVoxels(
      (bx, by, bz) => blockDef(this.world.getBlock(bx, by, bz)).solid,
      this.physics.x,
      this.physics.eyeY,
      this.physics.z,
      dx,
      dy,
      dz,
      distance,
    );
    return blocked === null;
  }

  private updateInteraction(dt: number): void {
    // 开着界面、或者躺着睡觉时：准星与各种交互一律收起
    // （睡觉时必须挡住破坏/放置：不然躺着还能拆自家床）
    if (this.uiOpen || this.sleeping) {
      this.hit = null;
      this.outline.hide();
      this.blockOverlay.hide();
      return;
    }

    const [dx, dy, dz] = PlayerPhysics.lookDirection(this.yaw, this.pitch);
    this.hit = raycastVoxels(
      (x, y, z) => this.isCrosshairTarget(x, y, z),
      this.physics.x,
      this.physics.eyeY,
      this.physics.z,
      dx,
      dy,
      dz,
      REACH,
    );

    if (this.hit) {
      const id = this.world.getBlock(this.hit.x, this.hit.y, this.hit.z);
      const state = this.world.getBlockState(this.hit.x, this.hit.y, this.hit.z);
      this.outline.show(id, state, blockDef(id).shape, this.hit.x, this.hit.y, this.hit.z);

      // 破坏裂纹：进度 0~1 映射到 0~(DAMAGE_STAGES-1) 段（原版 10 段）
      const shape = blockDef(id).shape;
      if (this.forcedDamageStage >= 0) {
        // 验收脚本强制指定的阶段（截图对比用，与真实挖掘解耦）
        this.blockOverlay.showDamage(this.hit.x, this.hit.y, this.hit.z, shape, state, this.forcedDamageStage);
      } else if (this.breakProgress > 0) {
        const stage = Math.min(DAMAGE_STAGES - 1, Math.floor(this.breakProgress * DAMAGE_STAGES));
        this.blockOverlay.showDamage(this.hit.x, this.hit.y, this.hit.z, shape, state, stage);
      } else {
        this.blockOverlay.hideDamage();
      }
      // 命中面高亮：让玩家看清这一下打在哪一面
      this.blockOverlay.showHighlight(this.hit.x, this.hit.y, this.hit.z, [this.hit.nx, this.hit.ny, this.hit.nz]);
    } else {
      this.outline.hide();
      this.blockOverlay.hide();
    }

    // 准星目标名称（批次 181）：5Hz 刷新，避免每帧写 DOM
    this.updateTargetInfo(dt);

    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);

    this.updateAttacking(dt);
    this.updateBreaking(dt);
    this.updatePlacing();
    // 进食放在放置之后：准星对着功能方块时右键的那一下归方块（开箱子/开门），
    // UI 一开 `uiOpen` 就是 true，这一帧的进食自然被挡掉
    this.updateEating(dt);
    // 拉弓也放在放置之后：准星对着功能方块时右键那一下归方块
    this.updateBow(dt);
    this.hand.setDrawPull(this.bowCharge);
  }

  /**
   * 准星下方那行"这是什么"（批次 181）。
   *
   * 手机上没有鼠标悬停，玩家指着方块时无从判断它是什么；这里把
   * 方块的**中文名**、或生物的**名字 + 血量**放在准星正下方。
   * 5Hz 刷新：准星扫过一片方块时不会每帧重建文本节点。
   */
  private updateTargetInfo(dt: number): void {
    this.targetInfoTimer -= dt;
    if (this.targetInfoTimer > 0) return;
    this.targetInfoTimer = 0.2;

    if (this.uiOpen || this.sleeping || this.stats.dead) {
      this.setTargetInfo('');
      return;
    }
    const mob = this.mobUnderCrosshair();
    if (mob && !mob.dead) {
      const health = Math.max(0, Math.ceil(mob.health));
      this.setTargetInfo(`${mob.type.name}  ${health}/${mob.type.health}`);
      return;
    }
    if (this.hit) {
      this.setTargetInfo(blockLabel(this.world.getBlock(this.hit.x, this.hit.y, this.hit.z)));
      return;
    }
    this.setTargetInfo('');
  }

  private setTargetInfo(text: string): void {
    if (text === this.targetInfoText) return;
    this.targetInfoText = text;
    this.targetInfoEl.textContent = text;
    this.targetInfoEl.classList.toggle('hidden', text.length === 0);
  }

  /**
   * 进食。
   *
   * 原版是"按住使用键 1.6 秒"，中途松手、换物品、开界面都会作废；
   * 这里照搬那套状态机——进度只在真正按住且手里还是那份食物时累加，别的任何情况清零。
   */
  private updateEating(dt: number): void {
    const held = this.heldFood;
    const potion = this.heldPotion;
    // 药水随时都能喝（不像食物要"没吃饱"），其余条件与进食完全一致
    const edible = potion !== null || (held !== null && canEat(held.food, this.stats.food, MAX_FOOD));
    if (!edible || !this.usingItem || this.uiOpen || this.stats.dead) {
      this.eatProgress = 0;
      this.chewTimer = 0;
      return;
    }

    this.eatProgress += dt / EAT_SECONDS;
    // 每 0.4 秒"嚼一口"：手臂晃一下 + 一声咀嚼，让玩家看得出正在吃（原版也有咀嚼音）
    this.chewTimer -= dt;
    if (this.chewTimer <= 0) {
      this.chewTimer = CHEW_INTERVAL;
      this.hand.swing();
      this.audio.play('eat');
    }
    if (this.eatProgress < 1) return;

    this.eatProgress = 0;
    this.chewTimer = 0;
    if (potion) {
      this.drinkPotion(potion);
      return;
    }
    this.eatFood(held!.id, held!.food);
  }

  /**
   * 喝下药水（H10）：扣掉一瓶、空瓶退回背包、把效果挂上。
   *
   * 空瓶**必须退回**——原版喝完会留下玻璃瓶，否则酿一瓶就永久少一个瓶子，
   * 玩家会觉得"越喝越亏"却不知道原因。
   */
  private drinkPotion(potion: PotionEntry): void {
    if (!this.inventory.consume(potion.id, 1)) return;
    for (const effect of potion.effects) {
      this.effects.apply(effect.id, effect.seconds, effect.amplifier);
    }
    const leftover = this.inventory.add(Item.GLASS_BOTTLE, 1);
    if (leftover > 0) this.spawnDrop(Item.GLASS_BOTTLE, leftover, this.physics.x, this.physics.y + 1, this.physics.z);

    this.chat.push(
      `喝下${potion.name}：${potion.effects.map((e) => effectLabel(e.id)).join('、') || '无效果'}`,
      'system',
    );
    this.audio.play('eat');
    this.hand.swing();
    this.refreshHotbar();
  }

  /** 咽下这一份：扣 1 个、补饥饿与饱和度、结算附加效果（腐肉的饥饿就靠这里） */
  private eatFood(itemId: number, food: FoodInfo): void {
    if (!this.inventory.consume(itemId, 1)) return;
    // 进度（M7）：吃下的是**哪一件**（"均衡饮食"数的是种类，所以必须把 id 报上去）
    this.reportProgress({ kind: 'eat', item: itemId });
    // 牛奶的回饥饿是 0，但**清效果**才是它的正事，所以照走同一条路
    this.stats.eat(food.hunger, saturationFrom(food));
    // 汤类食物喝完**退回空碗**（批次 57 补上；原版把这件事做成"物品的容器剩余物"）。
    // 背包满了就掉在地上——与"空瓶退回"那条同一条规矩，不能凭空消失
    if (food.returnsBowl === true) {
      const leftover = this.inventory.add(Item.BOWL, 1);
      if (leftover > 0) {
        this.spawnDrop(Item.BOWL, leftover, this.physics.x, this.physics.y + 1, this.physics.z);
      }
    }
    if (food.clearsEffects === true) {
      this.effects.clear();
      this.chat.push('喝下牛奶，身上的状态效果被清除', 'system');
    }
    for (const effect of food.effects ?? []) {
      // 概率效果要在这里掷点：表里存的是"触发概率"（腐肉 80%、生鸡肉 30%）
      if (effect.chance !== undefined && Math.random() >= effect.chance) continue;
      this.effects.apply(effect.id, effect.seconds, effect.amplifier);
    }
    this.audio.play('eat');
    this.hand.swing();
    this.refreshHotbar();
  }

  /** 当前手持物品 id（空手为 undefined） */
  private get heldItemId(): number | undefined {
    return this.inventory.get(this.hotbarIndex)?.id;
  }

  /**
   * 拉弓与放箭（J9）。
   *
   * 与进食同一套状态机（按住累加、别的情况清零），但多一步：
   * **松手那一下要把箭射出去**。所以不能"没按住就无脑清零"——
   * 得先用 `bowDrawing` 记住"这一次拉弓正在进行"，等它结束时再判断：
   *  - 松手 → 射（这是正常路径）
   *  - 换物品 / 开界面 / 死亡 → 取消（原版也是直接作废，不白送一箭）
   */
  private updateBow(dt: number): void {
    const holding = this.heldItemId === Item.BOW;
    const active = holding && this.usingItem && !this.uiOpen && !this.stats.dead;

    if (active) {
      this.bowCharge = chargeAfter(this.bowCharge, dt);
      this.bowDrawing = true;
      return;
    }

    if (!this.bowDrawing) {
      this.bowCharge = 0;
      return;
    }
    this.bowDrawing = false;
    const charge = this.bowCharge;
    this.bowCharge = 0;

    // 只有"手还拿着弓、而且没开界面"才算正常松手
    if (!holding || this.uiOpen || this.stats.dead) return;
    if (canFire(charge)) this.fireBow(charge);
  }

  /** 放出一支箭：扣箭、算伤害与附魔、给弓扣耐久 */
  private fireBow(charge: number): void {
    const effects = bowEffects(this.heldEnchants);
    // 普通箭与药水箭都能射：按槽位顺序（快捷栏在前）取第一堆箭，
    // 想射药水箭就把它摆在普通箭前面（`core/entity/ArrowAmmo.ts`）
    const ammo = pickArrowAmmo(this.inventory.serialize());
    const arrows = ammo?.total ?? 0;
    if (!canShoot(true, charge, arrows, effects)) {
      // 拉了半天没箭，得说一声——不然玩家只会觉得"弓坏了"
      if (arrows < 1) this.chat.push('没有箭了', 'error');
      return;
    }
    if (!ammo) return;

    const used = arrowsConsumed(effects);
    if (used > 0) this.inventory.consume(ammo.itemId, used);

    const cosPitch = Math.cos(this.pitch);
    const dirX = -Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = -Math.cos(this.yaw) * cosPitch;
    const speed = arrowSpeedAt(charge);

    this.spawnArrow(
      this.physics.x + dirX * 0.4,
      this.physics.eyeY - 0.12,
      this.physics.z + dirZ * 0.4,
      { x: dirX * speed, y: dirY * speed, z: dirZ * speed },
      {
        fromPlayer: true,
        damage: arrowDamageAt(charge, effects.power),
        knockback: knockbackStrength(effects.punch),
        fireSeconds: effects.flame > 0 ? FLAME_SECONDS : 0,
        // 无限附魔射出的箭不能捡（否则等于无限刷箭）
        pickable: effects.infinity === 0,
        // 这一箭是哪件物品 + 带没带药水（药水箭命中时按 1/8 时长挂效果）
        itemId: ammo.itemId,
        ...(ammo.potionId === undefined ? {} : { potionId: ammo.potionId }),
      },
    );

    this.audio.play('bow_shoot');
    this.hand.swing();
    this.damageHeldTool();
    this.refreshHotbar();
  }

  /**
   * 近战攻击：左键按下时先看准星有没有对着生物。
   * 生物比方块更靠前就优先攻击，并且这一帧不再破坏方块。
   */
  /**
   * 找一只愿意配对的同类（J8）。
   *
   * 只认"同种 + 成年 + 也在求爱"的，取最近的一只。
   * 顺带把"离得太远的"排除掉，否则两只隔着半张地图的牛会一直朝对方走。
   */
  private findMate(mob: Mob): Mob | null {
    let best: Mob | null = null;
    let bestDistance = MATE_SEARCH_RANGE * MATE_SEARCH_RANGE;
    for (const entity of this.entities.all) {
      if (!(entity instanceof Mob) || entity === mob || entity.dead) continue;
      if (entity.type !== mob.type || entity.baby || !entity.inLove) continue;
      const dx = entity.x - mob.x;
      const dy = entity.y - mob.y;
      const dz = entity.z - mob.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = entity;
    }
    return best;
  }

  /**
   * 准星指向的生物（方块更近时返回 null —— 说明玩家其实在挖方块）。
   *
   * 抽出来是因为**左键攻击**与**右键对生物使用物品**（剪羊毛、后面的喂食/挤奶）
   * 需要完全一样的判定，写两份迟早会一边改了另一边没改。
   */
  private mobUnderCrosshair(): Mob | null {
    const cosPitch = Math.cos(this.pitch);
    const hit = raycastEntities(
      this.entities.all,
      this.physics.x,
      this.physics.eyeY,
      this.physics.z,
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
      ATTACK_RANGE,
    );
    if (!hit || !(hit.entity instanceof Mob)) return null;
    if (this.hit && this.hit.distance < hit.distance) return null;
    return hit.entity;
  }

  /**
   * 屏幕坐标 → 射线 → 生物（批次 185）。
   *
   * 用户："看到一只动物想打它，得先把准星对上去；手机点到它就应该能打到。"
   * 实现就是把"手指落点"反投影成一条射线，再从**眼睛**沿这个方向找生物：
   *  - 用 `unproject` 而不是自己算三角函数，第三人称（相机在身后）也自动正确；
   *  - 距离仍用 `ATTACK_RANGE`，所以"点得着但够不着"不会隔空打；
   *  - 找不到就返回 null，调用方退回"放置方块/交互"那条路。
   */
  private mobAtScreen(clientX: number, clientY: number): Mob | null {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
      0.5,
    );
    // 射线**从相机**发出：屏幕上的那一点本来就是相机看到的。
    // ⚠️ 不能从眼睛发：第三人称时相机在玩家身后 4 格，方向与屏幕像素对不上，
    // 连"准星正对"都会打不中（批次 185 实测踩过）。
    const origin = this.camera.position.clone();
    const dir = ndc.unproject(this.camera).sub(origin).normalize();
    // 相机在身后时把射程补上这段距离，最后再用"玩家到生物"的距离卡攻击范围
    const reach = ATTACK_RANGE + origin.distanceTo(new THREE.Vector3(this.physics.x, this.physics.eyeY, this.physics.z));
    const hit = raycastEntities(
      this.entities.all,
      origin.x,
      origin.y,
      origin.z,
      dir.x,
      dir.y,
      dir.z,
      reach,
    );
    if (!hit || !(hit.entity instanceof Mob) || hit.entity.dead) return null;
    // 隔着屏幕点得着、但人离得远 → 不算（第三人称的相机在身后，不能白送射程）
    const dx = hit.entity.x - this.physics.x;
    const dz = hit.entity.z - this.physics.z;
    if (Math.hypot(dx, dz) > ATTACK_RANGE + 1) return null;
    return hit.entity;
  }

  /**
   * 对生物右键使用手上的物品（J8）。
   *
   * 目前只有"用剪刀剪羊毛"，但这正是后面喂食繁殖、挤奶要挂的同一个入口，
   * 所以先把它单独抽出来，而不是塞进放置逻辑里。
   *
   * @returns 是否发生了交互（发生了就把这一次右键吃掉，不再放置方块）
   */
  private useOnEntity(): boolean {
    const mob = this.mobUnderCrosshair();
    if (!mob || mob.dead) return false;
    const held = this.heldItemId;
    // 村民（J11）：空手也**有交互**（打开交易界面）——所以它必须排在
    // "手上没东西就返回 false"那一条之前
    if (mob instanceof Villager) return this.useOnVillager(mob, held);
    if (held === undefined) return false;
    if (held === Item.SHEARS && this.shearMob(mob) > 0) {
      // 剪刀也要掉耐久（原版每剪一次 -1）
      this.damageHeldTool();
      return true;
    }
    if (held === Item.BUCKET && this.milkMob(mob)) return true;
    return this.feedMob(mob, held);
  }

  /**
   * 对村民右键（J11，批次 88）：**喂饭**还是**做买卖**，看手上拿的是什么。
   *
   * 与原版一致：手上有他爱吃的东西（面包/胡萝卜/马铃薯/甜菜根）→ 喂他（进入求爱，
   * 幼崽则加速长大）；**其余情况**（空手、拿着别的东西）→ 打开交易界面。
   * 这两条的顺序不能反：拿着面包却弹交易界面，玩家就永远喂不上。
   */
  private useOnVillager(villager: Villager, held: number | undefined): boolean {
    // 喂饭：走的是**与牛羊完全同一条** `feedMob`（爱心、音效、扣物品都在那儿）
    if (held !== undefined && isVillagerFood(held)) {
      if (this.feedMob(villager, held)) {
        this.hand.swing();
        return true;
      }
    }
    // 做买卖：主程序只负责"开界面"，扣与给全在 `performTrade` 里
    this.inventoryScreen.openTrade(villager);
    return true;
  }

  /**
   * 成交一条交易（J11）。
   *
   * 顺序与原版一致：**先扣材料、再给东西、最后记经验**。
   * 扣与给都是"全有或全无"：`tradeBlocker` 先挡一道（材料不够就不动手），
   * 所以不会出现"扣了一半发现有一样不够"的半途状态。
   *
   * ⚠️ 产物放不进背包时**掉在村民脚边**（原版是留在产物格里等你腾地方）——
   * 本项目没有收货格，所以宁可"掉出来"，也不能凭空吞掉
   * （与"空瓶退回""汤碗退回"同一条规矩）。
   */
  private performTrade(villager: Villager, index: number): boolean {
    const offer = villager.offers[index];
    if (!offer || villager.dead) return false;
    const blocker = tradeBlocker(offer, this.inventory);
    if (blocker) {
      this.chat.push(`交易不成：${blocker}`, 'system');
      return false;
    }

    const settlement = tradeSettlement(offer);
    for (const cost of settlement.take) {
      if (!this.inventory.consume(cost.id, cost.count)) return false;
    }
    const leftover = this.inventory.add(settlement.give.id, settlement.give.count);
    if (leftover > 0) {
      this.spawnDrop(
        settlement.give.id,
        leftover,
        villager.x,
        villager.y + villager.type.height * 0.5,
        villager.z,
      );
    }

    offer.uses++;
    const levels = villager.addTradeXp(offer.xp);
    this.audio.play('trade', { x: villager.x, y: villager.y, z: villager.z });
    this.particles.spawnHearts(villager.x, villager.y + villager.type.height, villager.z, 0.5);
    if (levels > 0) {
      // 升级：新交易已经在 `addTradeXp` 里追加进 `offers`，这里只报喜
      const profession = villager.profession;
      this.chat.push(
        `村民升级了：${profession?.name ?? '村民'} → ${levelName(villager.level)}（解锁了新的交易）`,
        'system',
      );
      this.audio.play('achievement', { x: villager.x, y: villager.y, z: villager.z });
      this.particles.spawnSmoke(villager.x, villager.y + 1.2, villager.z, 6, 0.3);
    }

    this.refreshHotbar();
    this.inventoryScreen.refresh();
    // 进度（M7）：与村民交易（原版 `adventure/trade`）
    this.reportProgress({ kind: 'trade' });
    return true;
  }

  /**
   * 锄头耕地（H13）。
   *
   * 判定顺序与原版一致：**手上是锄头**且**准星对着土类方块**才耕；
   * 上方必须是空气（原版也是这样，否则会把方块塞进作物里）。
   * 判定本身抽成了 `tools.ts#tillableTo` / `canTill` 两个纯函数，好离线断言。
   */
  private tillSoil(x: number, y: number, z: number): boolean {
    if (!canTill(this.heldTool)) return false;
    const target = tillableTo(this.world.getBlock(x, y, z));
    if (target === undefined) return false;
    // 上方有东西就不耕（原版行为：不然耕地会"长出"方块里）
    if (this.world.getBlock(x, y + 1, z) !== Block.AIR) return false;

    this.world.setBlockAndUpdate(x, y, z, target);
    this.audio.play('break_grass', { x, y, z });
    this.damageHeldTool();
    return true;
  }

  /**
   * 刮铜（批次 40）：手上是**斧头**、准星对着氧化过的铜方块 → 退一档（刮掉一层锈）。
   *
   * 判定与原版一致：
   *  - 必须是斧头（镐/锹没用）；
   *  - 目标得是**能退档**的铜（新铜、以及已经刮干净的新铜都刮不动）；
   *  - 成功时消耗 1 点斧头耐久。
   * 判定本身是纯函数（`Copper.ts#scrapeResult`），所以能离线断言。
   */
  private scrapeCopper(x: number, y: number, z: number): boolean {
    if (this.heldTool?.type !== 'axe') return false;
    const target = this.world.getBlock(x, y, z);
    const scraped = scrapeResult(target);
    if (scraped === undefined) return false;

    this.world.setBlockAndUpdate(x, y, z, scraped);
    this.net.sendBlock(x, y, z, scraped, 0, this.dimension);
    this.audio.play('break_stone', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    this.damageHeldTool();
    this.hand.swing();
    return true;
  }

  /**
   * 打火石（I12 / K8）：手上是打火石、准星对着方块 → 先试着**点门**，再试着**点火**。
   *
   * 顺序与原版一致（命中黑曜石先试 `PortalShape`，成了就 `return SUCCESS`）：
   *  - **点燃传送门**（框是黑曜石、框内是空的连片空气）：填满门方块。
   *    这一步**不消耗耐久**——原版在 `FlintAndSteelItem` 里提前返回，走不到后面的
   *    `hurtAndBreak`，是个容易改错的怪癖，所以在这里显式写明
   *  - 否则在**命中面的外侧**点一格火（判定见 `Fire.ts#canPlaceFire`）；
   *    点不着就返回 `false`——不消耗耐久、不播音效，也不阻断后面的放置逻辑
   */
  private igniteWithFlint(): boolean {
    if (this.heldItemId !== Item.FLINT_AND_STEEL || !this.hit) return false;
    const x = this.hit.x + this.hit.nx;
    const y = this.hit.y + this.hit.ny;
    const z = this.hit.z + this.hit.nz;

    // ---- 0) TNT（批次 56）：对着 TNT 用打火石 = 点燃引信（原版行为）
    if (this.world.getBlock(this.hit.x, this.hit.y, this.hit.z) === Block.TNT) {
      if (this.primedTnt.prime(this.tntWorld, this.hit.x, this.hit.y, this.hit.z)) {
        this.damageHeldTool();
        this.hand.swing();
        this.refreshHotbar();
        return true;
      }
    }

    // ---- 1) 先试传送门（只有对着黑曜石点才有意义）
    if (this.world.getBlock(this.hit.x, this.hit.y, this.hit.z) === Block.OBSIDIAN) {
      const result = ignitePortal(this.portalWorld, x, y, z);
      if (result !== 'none') {
        this.hand.swing();
        if (result === 'exists') return true;
        // 联机：门方块要广播，否则队友那边框里是空的。
        // 点燃之后框里已经填满了门方块，所以用 `shapeAt`（认门方块）而不是 `findPortalShape`（认空气）
        const lit = shapeAt(this.portalWorld, x, y, z);
        if (lit) {
          for (const [px, py, pz] of portalInterior(lit)) {
            this.net.sendBlock(px, py, pz, Block.NETHER_PORTAL, this.world.getBlockState(px, py, pz), this.dimension);
          }
        }
        this.audio.play('portal', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
        this.particles.spawnPortal(x + 0.5, y + 0.5, z + 0.5, 10, 0.5);
        this.refreshHotbar();
        return true;
      }
    }

    // ---- 1.5) 营火重新点燃（批次 47）：原版就是拿打火石对着熄灭的营火点
    if (this.world.getBlock(this.hit.x, this.hit.y, this.hit.z) === Block.CAMPFIRE) {
      const campfire = this.world.containers.getOrCreateCampfire(this.dimension, this.hit.x, this.hit.y, this.hit.z);
      if (!campfire.lit) {
        campfire.lit = true;
        this.world.setStateAndUpdate(this.hit.x, this.hit.y, this.hit.z, withLitState(this.world.getBlockState(this.hit.x, this.hit.y, this.hit.z), true));
        this.damageHeldTool();
        this.audio.play('flint', { x, y, z });
        this.hand.swing();
        return true;
      }
    }

    // ---- 2) 普通火焰
    if (!igniteAt(this.world, x, y, z)) return false;
    this.damageHeldTool();
    this.audio.play('flint', { x, y, z });
    this.hand.swing();
    // 联机：把这一格火广播给队友（否则只有自己这边在烧）
    this.net.sendBlock(x, y, z, Block.FIRE, 0, this.dimension);
    this.refreshHotbar();
    return true;
  }

  /**
   * 空玻璃瓶装水（H10）：手上是玻璃瓶、准星对着水，就换成一瓶水。
   *
   * 严格照原版："手上必须是玻璃瓶"，不是玻璃瓶时返回 `false`，
   * 让这次右键继续往下走（不然"对着水用锄头"这种操作会被无声吃掉）。
   */
  private fillWaterBottle(): boolean {
    if (this.heldItemId !== Item.GLASS_BOTTLE) return false;
    if (!this.inventory.consume(Item.GLASS_BOTTLE, 1)) return false;
    const leftover = this.inventory.add(Item.WATER_BOTTLE, 1);
    // 背包满了就掉在脚边（水瓶不可堆叠，一装满就得有地方放）
    if (leftover > 0) this.spawnDrop(Item.WATER_BOTTLE, leftover, this.physics.x, this.physics.y + 1, this.physics.z);
    this.audio.play('splash');
    this.refreshHotbar();
    return true;
  }

  /**
   * 挤奶（J8）：拿空桶对着成年牛右键。
   * 幼体挤不出奶（原版也挤不出来），所以先判成年。
   */
  private milkMob(mob: Mob): boolean {
    if (mob.type.milk !== true || mob.baby) return false;
    // 空桶换牛奶桶：先扣掉一个空桶，再给一个牛奶桶（背包满了就掉在地上）
    if (!this.inventory.consume(Item.BUCKET, 1)) return false;
    const leftover = this.inventory.add(Item.MILK_BUCKET, 1);
    if (leftover > 0) this.spawnDrop(Item.MILK_BUCKET, leftover, mob.x, mob.y + 0.5, mob.z);

    this.audio.play('mob_cow', { x: mob.x, y: mob.y, z: mob.z });
    this.particles.spawnHearts(mob.x, mob.y + mob.type.height, mob.z, 0.4);
    this.refreshHotbar();
    return true;
  }

  /**
   * 喂食（J8）：手里拿着这种动物爱吃的东西，右键就喂。
   * 成年体进入求爱、幼体加速成长；两样都不是就当作没发生（不吃的东西不消耗）。
   */
  private feedMob(mob: Mob, itemId: number): boolean {
    const result = mob.feed(itemId);
    if (result === null) return false;
    if (!this.inventory.consume(itemId, 1)) return false;

    this.particles.spawnHearts(mob.x, mob.y + mob.type.height, mob.z, result === 'grow' ? 0.6 : 1);
    // 牛羊猪鸡都吃这几样，用各自家族的叫声最贴切；没有的用通用的"吃掉"音。
    // 村民（J11）用它自己的"嗯…"——喂他面包却听见羊叫会很出戏
    const sound = mob instanceof Villager ? 'mob_villager' : result === 'grow' ? 'mob_sheep' : 'eat';
    this.audio.play(sound, { x: mob.x, y: mob.y, z: mob.z });
    this.refreshHotbar();
    return true;
  }

  /**
   * 用一次堆肥桶（批次 70）：没满就塞一件、满了就收骨粉。
   *
   * 两种情形共用这一条入口，因为原版就是"右键同一个方块，看它满没满决定做什么"：
   *  - **没满**：手里那件是可堆肥的 → 掷一次（`compostStep`）。掷失败也算吃掉了这一件
   *    （原版如此——不然玩家可以拿一件反复试），掷成功涨一级；
   *    手里那件不能堆肥 → 什么都不做（**不吃**，也不出音效）。
   *  - **满了**：收 1 份骨粉、桶清零。背包放不下就掉在桶边（原版也是掉出来）。
   *
   * ⚠️ 为什么不做成"界面"：原版堆肥桶没有界面，全部交互就是右键——做成界面会让
   * "往里扔东西"变成"开箱再拖"，与手感不符，也白白多一套 UI。
   */
  private useComposter(x: number, y: number, z: number): boolean {
    const state = this.world.getBlockState(x, y, z);
    const level = composterLevelOf(state);

    // ---- 满了：收骨粉（手里拿什么都能收，原版如此）
    if (level >= COMPOSTER_MAX_LEVEL) {
      this.setComposterLevel(x, y, z, withComposterLevel(state, 0));
      const leftover = this.inventory.addStack({ id: Item.BONE_MEAL, count: 1 });
      // 背包满了就掉出来（与合成/烧炼那几处的口径一致：不给玩家凭空吞掉）
      if (leftover > 0) this.spawnDrop(Item.BONE_MEAL, leftover, x + 0.5, y + 1.05, z + 0.5);
      this.audio.play('place', { x: x + 0.5, y: y + 0.9, z: z + 0.5 });
      this.particles.spawnSplash(x + 0.5, y + 1.0, z + 0.5, 0xc8f0a0, 8);
      this.hand.swing();
      this.refreshHotbar();
      return true;
    }

    // ---- 没满：手里那件能堆肥吗
    const held = this.heldItemId;
    if (held === undefined) return false;
    const next = compostStep(level, held, Math.random);
    if (next === null) return false; // 不能堆肥（或桶满了）：什么都不做，也不吃掉
    this.inventory.consume(held, 1);
    this.setComposterLevel(x, y, z, withComposterLevel(state, next));
    // 成功的粒子/音效与"没涨"分开：玩家能一眼看出这次成没成（原版也有反馈）
    const grew = next > level;
    this.audio.play('place', { x: x + 0.5, y: y + 0.9, z: z + 0.5 });
    this.particles.spawnBlockBreak(x, y + 0.9, z, this.blockParticleColor(Block.COMPOSTER), grew ? 6 : 3);
    this.hand.swing();
    this.refreshHotbar();
    return true;
  }

  /** 写堆肥等级：走带光照/网格/增量存档的那条路，并广播给队友 */
  private setComposterLevel(x: number, y: number, z: number, state: number): void {
    this.world.setBlockAndUpdate(x, y, z, Block.COMPOSTER, state);
    this.net.sendBlock(x, y, z, Block.COMPOSTER, state, this.dimension);
  }

  /**
   * 收支撑只要"读一格、写一格"，加上**读状态**（B14 起）：
   * 展示框与画的支撑是"朝向那一侧的墙"，不看 `facing` 就不知道墙在哪一格。
   */
  private readonly supportWorld: SupportWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    setBlock: (x, y, z, blockId) => this.world.setBlockAndUpdate(x, y, z, blockId),
    getState: (x, y, z) => this.world.getBlockState(x, y, z),
  };

  /**
   * 把"立不住"的东西收掉（批次 78，B49）：掉落走与玩家挖掘同一条 `spawnDrop`、
   * 每一格都广播给队友（否则队友那边看到的是"沙子没了、甘蔗还在"）。
   *
   * ⚠️ 起点是**被移除那一格的上面**（见 `sweepUnsupported` 的注释）。
   */
  private sweepUnsupportedAbove(x: number, y: number, z: number): void {
    sweepUnsupported(this.supportWorld, x, y, z, (cx, cy, cz, id) => {
      const drop = dropFor(id);
      if (drop) this.spawnDrop(drop.id, drop.count, cx + 0.5, cy + 0.5, cz + 0.5);
      this.net.sendBlock(cx, cy, cz, Block.AIR, 0, this.dimension);
      this.particles.spawnBlockBreak(cx + 0.5, cy + 0.5, cz + 0.5, this.blockParticleColor(id), 4);
    });
  }

  /**
   * 墙没了，挂在它上面的东西跟着掉（B14，批次 86）：展示框与画。
   *
   * 与 `sweepUnsupportedAbove` 是一对（一个管"站着的"、一个管"贴着的"），
   * 调用点也在一起：玩家破坏与爆炸之后各来一次。
   *
   * 展示框要多做一件事：**先把框里挂着的东西还回去**（它不在方块状态里，
   * 掉方块不会自动带走它），否则"拆了框，里面那把附魔剑凭空消失"。
   */
  private sweepHangings(x: number, y: number, z: number): void {
    sweepHangingsAround(this.supportWorld, x, y, z, (hx, hy, hz, id) => {
      // 框里那件东西（画没有内容，这个调用对它自然为空转）
      this.dropFrameContents(hx, hy, hz);
      const drop = dropFor(id);
      if (drop) this.spawnDrop(drop.id, drop.count, hx + 0.5, hy + 0.5, hz + 0.5);
      this.net.sendBlock(hx, hy, hz, Block.AIR, 0, this.dimension);
      this.particles.spawnBlockBreak(hx + 0.5, hy + 0.5, hz + 0.5, this.blockParticleColor(id), 4);
    });
  }

  /**
   * 把某一格里展示框挂着的东西**取出来**（掉在地上）并清掉表里的那条。
   *
   * 调用点有三处：拆框、墙没了导致框掉下来、以及定期对账发现"那一格已经不是框了"。
   * 三处走同一个方法，才不会出现"某一条路径把物品吞了"。
   */
  private dropFrameContents(x: number, y: number, z: number): void {
    const entry = this.itemFrames.get(this.dimension, x, y, z);
    if (!entry) return;
    this.itemFrames.remove(this.dimension, x, y, z);
    // `stackExtras` 把耐久/附魔/改名/累积惩罚/内容物原样搬过去——
    // 于是"挂着的那把附魔剑"掉出来还是那一把（与容器倒空走同一个出处）
    this.spawnDrop(entry.item.id, entry.item.count, x + 0.5, y + 0.5, z + 0.5, stackExtras(entry.item));
  }

  /**
   * 骨粉要写世界：`setBlock` 必须走**带光照/网格/增量存档**的那条路
   * （直接写区块数据的话，作物长高了但画面与存档都不动）。
   */
  private readonly boneMealWorld: BoneMealWorld = {
    getBlock: (bx, by, bz) => this.world.getBlock(bx, by, bz),
    setBlock: (bx, by, bz, blockId) => this.world.setBlockAndUpdate(bx, by, bz, blockId),
  };

  /**
   * 给一格施肥（批次 69）：玩家右键作物、发射器对着作物，走的都是这一条。
   *
   * @returns 成功了吗（false = 那一格不能催：不是作物 / 已经成熟）
   */
  fertilizeBlockAt(x: number, y: number, z: number): boolean {
    // ---- 树苗（批次 75）：骨粉把它**直接长成一棵树**（与随机刻走同一套种树代码）。
    // 这一段必须在 `fertilizeAt` 之前：树的生长要写几十格，而 `BoneMeal.ts` 只会"读一格写一格"，
    // 它是刻意保持纯净的（那是它能被离线断言的原因）
    const treeKind = saplingTreeOf(this.world.getBlock(x, y, z));
    if (treeKind) return this.growSaplingNow(x, y, z, treeKind);

    // ⚠️ 改动的那一格**不一定是我们点的那一格**：对着草方块撒骨粉长出来的是**旁边**的草/花。
    // 所以广播与粒子都按返回的坐标走——按"点的那一格"发的话，队友那边什么都看不到
    const changed = fertilizeAt(this.boneMealWorld, x, y, z, Math.random);
    if (!changed) return false;
    const { x: cx, y: cy, z: cz } = changed;
    // 世界改动要广播（与放方块走同一条），否则队友那边作物还在原来的阶段
    this.net.sendBlock(cx, cy, cz, this.world.getBlock(cx, cy, cz), this.world.getBlockState(cx, cy, cz), this.dimension);
    // 淡绿的碎屑（原版骨粉那圈粒子）
    this.particles.spawnSplash(cx + 0.5, cy + 0.4, cz + 0.5, 0xc8f0a0, 10);
    this.audio.play('place', { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 });
    return true;
  }

  /** 种树只要"读一格、写一格"（`TreeGrowth` 的 writer 要求） */
  private readonly treeWorld: TreeWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    setBlock: (x, y, z, blockId, state) => this.world.setBlockAndUpdate(x, y, z, blockId, state ?? 0),
  };

  /**
   * 让一格树苗立刻长成树（骨粉）。@returns 长出来了吗（没长出来时**不消耗**这一份骨粉）
   *
   * ⚠️ 一棵树是几十格一起变的：**每一格都要广播**（`TreeGrowth` 返回改动清单）。
   * 只广播"树苗那一格"的话，队友那边看到的是"树苗没了、树没有"。
   */
  private growSaplingNow(x: number, y: number, z: number, kind: TreeKind): boolean {
    const changes = growTreeAt(this.treeWorld, x, y, z, this.world.getBlock(x, y, z), kind, 1);
    if (!changes) return false;
    for (const change of changes) {
      this.net.sendBlock(change.x, change.y, change.z, change.blockId, change.state, this.dimension);
    }
    this.particles.spawnSplash(x + 0.5, y + 0.5, z + 0.5, 0xa8e08a, 14);
    this.audio.play('place', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    this.refreshWorld(toChunkCoord(x), toChunkCoord(z), true);
    return true;
  }

  /**
   * 手上的骨粉对着作物右键：催长并把这一份**消耗掉**。
   *
   * ⚠️ 失败时**不消耗**（对着石头、对着已经成熟的小麦用，什么都不发生）——
   * 原版也是这个口径，玩家不会因为"点到旁边的方块"白扔一份。
   */
  private fertilizeWithBoneMeal(): boolean {
    if (this.heldItemId !== Item.BONE_MEAL || !this.hit) return false;
    if (!this.fertilizeBlockAt(this.hit.x, this.hit.y, this.hit.z)) return false;
    this.inventory.consume(Item.BONE_MEAL, 1);
    this.hand.swing();
    this.refreshHotbar();
    return true;
  }

  /**
   * 用剪刀剪一只羊的毛，@returns 剪下来几份（0 = 这只剪不动：猪/牛，或者刚剪过还没长）。
   *
   * ⚠️ 这里**不碰工具耐久**：玩家是手上的剪刀、发射器（批次 60）是容器里那把，
   * 两条路径各自结算（原版每剪一次 -1，两边都掉）。把它们混进这个函数里，
   * 发射器剪羊毛就会去磨玩家手上的东西。
   */
  private shearMob(mob: Mob): number {
    const count = mob.shear();
    if (count <= 0) return 0;

    this.spawnDrop(woolId(mob.woolColor), count, mob.x, mob.y + 0.6, mob.z);
    this.audio.play('shear');
    this.particles.spawnSmoke(mob.x, mob.y + 0.7, mob.z, 8, 0.22);
    this.refreshHotbar();
    return count;
  }

  private updateAttacking(dt: number): void {
    this.suppressBreaking = false;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    // 触摸"轻点生物"是一次性请求（批次 181）；按住（leftDown）仍然持续攻击
    const tapped = this.tapAttackRequest;
    // 批次 185：轻点那一下点中的生物优先（点哪打哪），没有才回退到准星
    const tappedMob = tapped ? this.tapAttackMob : null;
    this.tapAttackRequest = false;
    this.tapAttackMob = null;
    if ((!this.leftDown && !tapped) || this.uiOpen || this.attackCooldown > 0) return;

    const context = this.lastEntityContext;
    if (!context) return;

    const mob = tappedMob && !tappedMob.dead ? tappedMob : this.mobUnderCrosshair();
    if (!mob) return;

    this.attackCooldown = ATTACK_COOLDOWN;
    this.suppressBreaking = true;
    this.breakProgress = 0;
    this.breakingKey = '';

    // 下落中攻击算暴击（原版 ×1.5）；创造模式一击必杀
    const critical = !this.physics.onGround && this.physics.vy < -0.1;
    // 徒手 1 点；手持武器按 tools.ts 的伤害表（剑 4~7、斧 7~9…），
    // 锋利每级 +0.5 且只要有一级就额外 +0.5（原版就是这个式子），力量/虚弱在这里加减；暴击 ×1.5
    // 亡灵杀手/节肢杀手只对对应家族的生物生效，所以要把家族传进去
    const weapon = meleeDamage(this.heldTool?.attack ?? 1, this.heldEnchants, mob.type.family);
    const base = Math.max(0, weapon + this.effects.attackBonus());
    const damage = this.isCreative ? 100 : critical ? base * 1.5 : base;
    // 抢夺只影响掉落数量（在 mob.hurt 内部结算）
    mob.hurt(damage, mob.x - this.physics.x, mob.z - this.physics.z, context, lootingBonus(this.heldEnchants));
    this.hand.swing();
    // 攻击也要消耗耐久（原版剑/斧砍怪掉耐久）
    this.damageHeldTool();
    if (mob.dead) {
      // 死亡的烟：原版生物死时会冒一团烟
      this.particles.spawnSmoke(mob.x, mob.y + 0.5, mob.z, 10, 0.32);
      // 进度（M7）：击杀。报的是**生物种类 id**而不是这一只——
      // 计数型进度（"怪物猎人"要三种）靠它去重，报成个体就永远凑不齐三种
      this.reportProgress({ kind: 'kill', mob: mob.type.id });
    } else {
      // 暴击火花（原版暴击是星星状的白色粒子）
      this.particles.spawnCrit(mob.x, mob.y + 0.7, mob.z, critical ? 8 : 4);
    }
  }

  private updateBreaking(dt: number): void {
    if (this.suppressBreaking) {
      this.breakingKey = '';
      this.breakProgress = 0;
      return;
    }
    if ((!this.leftDown && !this.padAttack) || !this.hit || this.breakCooldown > 0) {
      this.breakingKey = '';
      this.breakProgress = 0;
      return;
    }

    const key = `${this.hit.x},${this.hit.y},${this.hit.z}`;
    if (key !== this.breakingKey) {
      this.breakingKey = key;
      this.breakProgress = 0;
    }

    const id = this.world.getBlock(this.hit.x, this.hit.y, this.hit.z);
    // 手持工具决定挖掘速度与能否采到（G4）；先取一份快照，
    // 免得后面工具刚好用坏时用 null 去判断掉落
    const tool = this.heldTool;
    // 状态效果：急迫加快、挖掘疲劳减慢（倍率在 StatusEffects 里算好）
    const required = this.isCreative ? 0 : breakSeconds(id, tool, this.heldEnchants) / this.effects.miningSpeedMultiplier();
    if (!Number.isFinite(required)) return;

    this.breakProgress += required <= 0 ? 1 : dt / required;

    // 挖掘途中持续掉碎屑 + 挥手臂（原版每挖一下挥一次）
    this.particleTimer -= dt;
    if (this.particleTimer <= 0) {
      this.particleTimer = 0.12;
      this.particles.spawnDigging(this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5, this.blockParticleColor(id));
      this.hand.swing();
    }

    if (this.breakProgress < 1) return;

    const brokenId = this.world.getBlock(this.hit.x, this.hit.y, this.hit.z);
    const brokenState = this.world.getBlockState(this.hit.x, this.hit.y, this.hit.z);

    // 工具耐久 -1（挖掉一格算一次；创造模式不掉，见 damageHeldTool）
    this.damageHeldTool();

    // 门是两格高的整体：拆一半就把另一半一起带走（且整扇门只掉落一次）
    // 批次 38 起按形状判定（原来写死橡木门 → 云杉门拆一半会留下半扇悬空的门）
    if (blockDef(brokenId).shape === 'door') {
      this.breakDoorPair(this.hit.x, this.hit.y, this.hit.z);
      this.breakProgress = 0;
      this.breakingKey = '';
      this.breakCooldown = BREAK_COOLDOWN;
      return;
    }

    // 床（批次 79）同理，只是它横着占两格：拆一半必须带走另一半，
    // 否则会留下一张**半张床**（站上去只剩 9/16 的一半，看着像 bug）
    if (blockDef(brokenId).shape === 'bed') {
      this.breakBedPair(this.hit.x, this.hit.y, this.hit.z);
      this.breakProgress = 0;
      this.breakingKey = '';
      this.breakCooldown = BREAK_COOLDOWN;
      return;
    }

    // 海带 / 甘蔗 / 脚手架都是"一整柱往上叠"的东西：拆掉任意一节，上面那几节跟着断
    // （原版行为，脚手架是"哗啦一下全掉"）。
    // 不这么做的话，水里会留一截从半空中长出来的海带、地上会立着一段悬空的甘蔗、
    // 半空中会挂着一片脚手架——而方块本身看起来毫无问题。
    if (brokenId === Block.KELP || brokenId === Block.SUGAR_CANE || brokenId === Block.SCAFFOLDING) {
      this.breakColumn(this.hit.x, this.hit.y, this.hit.z, brokenId);
      this.breakProgress = 0;
      this.breakingKey = '';
      this.breakCooldown = BREAK_COOLDOWN;
      return;
    }

    // 避雷针（批次 83）：拆掉就从索引里去掉（不然打雷还会往一个空格子上劈）
    if (brokenId === Block.LIGHTNING_ROD) this.noteRodBroken(this.hit.x, this.hit.y, this.hit.z);
    if (brokenId === Block.SPAWNER) this.noteSpawnerBroken(this.hit.x, this.hit.y, this.hit.z);

    // 告示牌（批次 80）：牌子没了，上面的字也要清掉——不清的话
    // "在同一个位置重新放一块牌子"会凭空继承上一块的字（而且存档里留着一份没有方块的文字）。
    // 火焰/爆炸把牌子烧掉时走不到这里，由 `syncSigns` 那趟对账兜底（发现不是牌子就丢掉）
    if (isSign(brokenId)) this.clearSignText(this.hit.x, this.hit.y, this.hit.z);

    // 展示框（B14）：框拆了，**里面挂着的那件东西也要还给玩家**——
    // 它不在方块状态里，不管的话就是"拆一个框，里面那把附魔剑凭空消失"
    // （框本身掉不掉由下面的常规掉落管；这里只管里面的东西）
    //
    // ⚠️ 创造模式**不掉**（与原版一致，也与下面"创造模式不产生掉落"那一条同源）：
    // 直接把条目清掉即可，否则创造模式拆几个框就能刷出一堆东西
    if (brokenId === Block.ITEM_FRAME) {
      if (this.isCreative) this.itemFrames.remove(this.dimension, this.hit.x, this.hit.y, this.hit.z);
      else this.dropFrameContents(this.hit.x, this.hit.y, this.hit.z);
    }

    // 潜影盒（批次 72）：内容**不**原地倒出来，而是跟着掉落的物品走（下一步用得上）。
    // 顺序要紧：先把内容取出来、再把容器从表里删掉，最后掉落时挂到物品上。
    const shulkerContents = brokenId === Block.SHULKER_BOX ? shulkerContentsOf(this.world.containers.getShulkerBox(this.dimension, this.hit.x, this.hit.y, this.hit.z)) : undefined;
    if (brokenId === Block.SHULKER_BOX) this.world.containers.remove(this.dimension, this.hit.x, this.hit.y, this.hit.z);
    this.dropContainerContents(this.hit.x, this.hit.y, this.hit.z);
    this.world.setBlockAndUpdate(this.hit.x, this.hit.y, this.hit.z, Block.AIR);
    // 批次 185（用户："水旁边的方块挖掉之后水不会流"）：
    // 挖掉的一格可能是"水底/水侧"的塞子——必须唤醒它周围的液体重新评估流向。
    // 原来只有爆炸、拔海带/甘蔗那几条路会唤醒，**玩家手挖这条主路漏了**。
    this.wakeFluidsAround(this.hit.x, this.hit.y, this.hit.z);
    // 支撑没了，该掉的就掉（批次 78，B49）：从这一格的**上面**一路往上收——
    // 拆掉甘蔗下面那格沙子，整根甘蔗要一节节掉完（只收一格的话上面几节会悬空）
    this.sweepUnsupportedAbove(this.hit.x, this.hit.y + 1, this.hit.z);
    // 墙没了，挂在它上面的展示框与画跟着掉（B14；与上面那条一对）
    this.sweepHangings(this.hit.x, this.hit.y, this.hit.z);
    // 敲掉黑曜石 → 检查旁边的传送门还立不立得住（K8）：框一破，那一整片门方块跟着熄灭
    if (brokenId === Block.OBSIDIAN) this.breakPortalsBeside(this.hit.x, this.hit.y, this.hit.z);
    // 敲掉末地传送门框架（K9，批次 111）：圈破了，中间那 3×3 跟着灭
    //（框架在原版是"不可破坏"的，所以这条只在创造模式/爆炸这类路径上走得到）
    if (brokenId === Block.END_PORTAL_FRAME) this.breakEndPortalsBeside(this.hit.x, this.hit.y, this.hit.z);
    this.particles.spawnBlockBreak(
      this.hit.x + 0.5,
      this.hit.y + 0.5,
      this.hit.z + 0.5,
      this.blockParticleColor(brokenId),
    );

    // 创造模式不产生掉落（与原版一致）
    // G4：还需要"手上工具够格"——石镐挖不动钻石矿（挖得动但一无所获）
    if (!this.isCreative && canHarvest(brokenId, tool)) {
      const enchants = this.heldEnchants;
      // 七件事的先后顺序（精准采集 / 剪刀 / 替换 / 常规 / 额外 / 双层台阶 / 时运）
      // 整体收在 `items.blockDrops` 里，那里写了注释，也才能离线断言
      const drop = blockDrops(brokenId, {
        shears: this.heldTool?.type === 'shears',
        silkTouch: enchantLevel(enchants, 'silk_touch') > 0,
        fortune: enchantLevel(enchants, 'fortune'),
        doubleSlab: isSlabDouble(brokenState),
        roll: Math.random,
      });
      if (drop) {
        // 潜影盒（批次 72）：掉出来的**那一份物品带着内容物**——捡起来再放下，东西还在
        const extras = drop.id === Block.SHULKER_BOX && shulkerContents ? { contents: shulkerContents } : undefined;
        this.spawnDrop(drop.id, drop.count, this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5, extras);
        // 花盆（批次 52）：拆盆时**里面那株植物也掉出来**（原版如此）——
        // 不这么做，玩家会看到"拆一个盆，辛苦种的花没了"，而方块本身看不出问题
        if (brokenId === Block.FLOWER_POT) {
          const potted = pottedPlantItem(flowerPotPlant(brokenState));
          if (potted !== undefined) this.spawnDrop(potted, 1, this.hit.x + 0.5, this.hit.y + 0.6, this.hit.z + 0.5);
        }
        // 收成熟作物还会额外掉一份（小麦是种子、胡萝卜/马铃薯是果实）
        const extra = extraCropDrop(brokenId, Math.random);
        if (extra) {
          this.spawnDrop(extra.id, extra.count, this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5);
        }
      }
    }

    // 挖矿经验（I5）：只有部分矿石给（煤 0~2、钻石/绿宝石 3~7…），
    // 与掉落无关——铁矿挖出来有粗铁但**不给**经验，与原版一致；创造模式不给。
    // 批次 170 起掉成球（I16）：位置就是刚挖掉那一格的格心
    if (!this.isCreative) {
      const xp = rollBlockXp(brokenId, Math.random());
      this.spawnXpOrbs(xp, this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5);
    }

    // 挖掘消耗疲劳值（原版 0.005/方块）
    this.stats.addExhaustion(0.005);

    this.breakProgress = 0;
    this.breakingKey = '';
    this.breakCooldown = BREAK_COOLDOWN;
    // 触觉反馈：方块被挖掉的那一下
    this.vibrate(12);
    // 音效：按方块材质挑（石头/木头/草/沙/玻璃/羊毛）
    this.audio.playBreakForBlock(blockDef(brokenId).name, { x: this.hit.x + 0.5, y: this.hit.y + 0.5, z: this.hit.z + 0.5 });
    // 联机：告诉队友这里被挖空了
    this.net.sendBlock(this.hit.x, this.hit.y, this.hit.z, Block.AIR, 0, this.dimension);
  }

  /**
   * 射出一支箭（J9）。玩家拉弓与骷髅射箭都走这里，
   * 于是"箭怎么飞"只有一份实现，两边不会各自漂移。
   */
  spawnArrow(
    x: number,
    y: number,
    z: number,
    velocity: { x: number; y: number; z: number },
    options: ArrowOptions,
  ): Arrow {
    return this.entities.spawn(new Arrow(x, y, z, velocity, options));
  }

  /**
   * 开门/关门（批次 38 起按**形状**判定，不再写死橡木）。
   *
   * 门是两格高的整体：上下两半必须是**同一种**门，且必须同步切换，
   * 否则会出现"半扇门"。按形状判定之后，往木材表加一种木头、或以后加铁门，
   * 这里都不用再动。
   */
  private toggleDoor(x: number, y: number, z: number): void {
    const state = this.world.getBlockState(x, y, z);
    const baseY = isDoorUpper(state) ? y - 1 : y;
    const doorId = this.world.getBlock(x, baseY, z);
    if (blockDef(doorId).shape !== 'door') return;
    if (this.world.getBlock(x, baseY + 1, z) !== doorId) return;

    const baseState = this.world.getBlockState(x, baseY, z);
    const next = withDoorOpen(baseState, !isDoorOpen(baseState));
    this.world.setBlockAndUpdate(x, baseY, z, doorId, next);
    this.world.setBlockAndUpdate(x, baseY + 1, z, doorId, withDoorUpper(next, true));
    // 开门/关门是两种声音（批次 138）：`door` 是那声"吱呀"，`door_close` 是"咔嗒"
    this.audio.play(doorSoundFor('door', isDoorOpen(next)), { x: x + 0.5, y: baseY + 0.5, z: z + 0.5 });
  }

  /**
   * 活板门 / 栅栏门的开合（批次 30；批次 38 起按形状判定，不再写死橡木）。
   *
   * 两者都是**单格**方块，只需要翻自己的开关位（与门共用同一个位，见 `blockState.ts`）。
   * ⚠️ 音效在批次 138 之后**按形状分**（原来三种门共用 `door`，于是
   * "关活板门听着像在推开一扇吱呀作响的大门"）。
   */
  private toggleOpenable(x: number, y: number, z: number, id: number): void {
    const state = this.world.getBlockState(x, y, z);
    const shape = blockDef(id).shape;
    const opened = shape === 'trapdoor' ? !isTrapdoorOpen(state) : !isFenceGateOpen(state);
    const next = shape === 'trapdoor' ? withTrapdoorOpen(state, opened) : withFenceGateOpen(state, opened);
    this.world.setBlockAndUpdate(x, y, z, id, next);
    this.audio.play(doorSoundFor(shape, opened), { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  }

  /**
   * 手持**线**右键方块顶面 → 在那一格铺一段绊线（批次 55）。
   *
   * 原版绊线**没有物品**（`itemless`），只能用线放下来——所以这条交互不在"放置方块"那条路上
   * （线不是方块物品，`selectedBlock` 是 undefined），必须和点火一样单独接一处。
   */
  private placeTripwire(): boolean {
    if (this.heldItemId !== Item.STRING) return false;
    if (!this.hit || this.hit.ny <= 0) return false;
    const x = this.hit.x;
    const y = this.hit.y + 1;
    const z = this.hit.z;
    if (this.world.getBlock(x, y, z) !== Block.AIR) return false;
    if (!this.world.setBlockAndUpdate(x, y, z, Block.TRIPWIRE)) return false;
    // 创造模式不扣线（与"创造不掉落"同一条规矩）
    if (!this.isCreative) {
      this.inventory.consume(Item.STRING, 1);
      this.refreshHotbar();
    }
    this.net.sendBlock(x, y, z, Block.TRIPWIRE, 0, this.dimension);
    this.audio.play('place', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    this.hand.swing();
    return true;
  }

  /**
   * 吃一片蛋糕（批次 52）。
   *
   * 原版：一共 7 片，**每片回 2 点饥饿 / 0.4 点饱和度**，吃完第 7 片方块消失；
   * 饥饿满了就吃不下去（连"咬一口"都没有）。
   *
   * ⚠️ 数值取自 `CAKE_SLICE_FOOD`（food.ts），**不能**把 cake 登记进 `FOOD_TABLE`——
   * 那会让"手持蛋糕长按"也能啃掉自己，而原版蛋糕物品是不能吃的（只能放下）。
   */
  private eatCakeSlice(x: number, y: number, z: number): boolean {
    if (!canEat(CAKE_SLICE_FOOD, this.stats.food, MAX_FOOD)) return false;
    const state = this.world.getBlockState(x, y, z);
    const bites = cakeBites(state) + 1;

    this.stats.eat(CAKE_SLICE_FOOD.hunger, saturationFrom(CAKE_SLICE_FOOD));
    this.audio.play('eat');
    this.hand.swing();
    this.particles.spawnDigging(x + 0.5, y + 0.4, z + 0.5, this.blockParticleColor(Block.CAKE));
    this.vibrate(8);

    if (bites >= CAKE_SLICES) {
      // 最后一片：整块蛋糕消失（原版吃完就没）
      this.world.setBlockAndUpdate(x, y, z, Block.AIR);
      this.net.sendBlock(x, y, z, Block.AIR, 0, this.dimension);
    } else {
      const next = withCakeBites(state, bites);
      this.world.setStateAndUpdate(x, y, z, next);
      this.net.sendBlock(x, y, z, Block.CAKE, next, this.dimension);
    }
    this.refreshHotbar();
    return true;
  }

  /**
   * 花盆的两种右键（批次 52）：**种进去** / **取出来**。
   *
   * 原版：手里拿着能种的植物右键 → 种进去（消耗 1 个）；空手右键 → 把里面的花取出来。
   * 两种都不做时返回 false，让那一下回到"放置方块"的常规逻辑（原版也允许往花盆上摞方块）。
   */
  private useFlowerPot(x: number, y: number, z: number): boolean {
    const state = this.world.getBlockState(x, y, z);
    const plant = flowerPotPlant(state);
    const held = this.heldItemId;

    if (held !== undefined) {
      const index = flowerPotIndexFor(held);
      // 手里那个东西种不进花盆（比如一块石头）→ 交给放置逻辑
      if (index === 0) return false;
      // 盆里已经有花了：原版不许"换花"，得先取出来
      if (plant !== 0) return false;
      if (!this.inventory.consume(held, 1)) return false;
      const next = withFlowerPotPlant(state, index);
      this.world.setStateAndUpdate(x, y, z, next);
      this.net.sendBlock(x, y, z, Block.FLOWER_POT, next, this.dimension);
      this.audio.play('place', { x, y, z });
      this.hand.swing();
      this.refreshHotbar();
      return true;
    }

    // 空手：把盆里的那株取出来（空盆空手什么都不做，但算"交互过了"）
    if (plant === 0) return true;
    const item = pottedPlantItem(plant);
    if (item !== undefined) {
      const leftover = this.inventory.add(item, 1);
      if (leftover > 0) this.spawnDrop(item, leftover, x + 0.5, y + 0.6, z + 0.5);
      this.chat.push(`从花盆里取出${pottedPlantName(plant)}`, 'system');
    }
    const next = withFlowerPotPlant(state, 0);
    this.world.setStateAndUpdate(x, y, z, next);
    this.net.sendBlock(x, y, z, Block.FLOWER_POT, next, this.dimension);
    this.audio.play('break_grass', { x, y, z });
    this.hand.swing();
    this.refreshHotbar();
    return true;
  }

  // ---------------------------------------------------------------- 床与睡觉（B13 / I13，批次 79）

  /**
   * 右键床：躺下睡觉。
   *
   * 判定全部在 `Sleep.ts`（纯函数），这里只做三件事：凑环境快照、显示提示、进入睡觉状态。
   * @returns 是否消费了这次右键（床总是消费：不然"白天点床"会掉进放置分支）
   */
  private trySleep(x: number, y: number, z: number): boolean {
    // 已经在睡了：别叠一层（触屏上连点很容易触发）
    if (this.sleeping) return true;

    // 重生点与"附近有没有怪物"都按**床脚**那一格算（原版的重生点也在床脚）
    const [fx, fy, fz] = bedFootPos(x, y, z, this.world.getBlockState(x, y, z));
    const refusal = sleepRefusal({
      timeOfDay: this.timeOfDay,
      // 雷暴时白天也能睡（原版规则）
      thundering: this.weather.current === 'thunder',
      dead: this.stats.dead,
      monstersNear: this.hostileMobsNear(fx, fy, fz),
    });
    if (refusal !== null) {
      this.chat.push(refusal, 'system');
      return true;
    }

    this.sleeping = { x: fx, y: fy, z: fz };
    this.sleepTimer = 0;
    this.sleepEl?.classList.remove('hidden');
    this.chat.push('你躺下了…（跳跃键 / 点击遮罩可以提前起床）', 'system');
    return true;
  }

  /** 床附近有没有敌对生物（把实体表转成 `Sleep.ts` 要的那个形状） */
  private hostileMobsNear(x: number, y: number, z: number): boolean {
    const mobs: SleepMob[] = [];
    for (const entity of this.entities.all) {
      if (!(entity instanceof Mob)) continue;
      mobs.push({
        x: entity.x,
        y: entity.y,
        z: entity.z,
        hostile: entity.type.hostile,
        dead: entity.dead,
      });
    }
    return monstersNearBed(x, y, z, mobs);
  }

  /**
   * 睡觉的每帧推进。
   *
   * 演出时长 `SLEEP_SECONDS` 之后结算：**再看一眼床边有没有怪物**——
   * 这时有怪就是原版的"被怪物惊醒"（天不亮、重生点也不设）；
   * 没有就跳到黎明、清掉天气、把重生点记在这张床上。
   */
  private updateSleep(dt: number, input: PlayerInput): void {
    const bed = this.sleeping;
    if (!bed) return;

    // 被怪物打死在床上的极端情况：静默收摊（死亡界面已经盖住了屏幕，不用再弹提示）
    if (this.stats.dead) {
      this.sleeping = null;
      this.sleepTimer = 0;
      this.sleepEl?.classList.add('hidden');
      return;
    }

    // 提前起床：跳跃键（键盘 Space / 触屏"跳" / 手柄 A）——原版基岩版也能自己起身。
    // ⚠️ 前 0.25 秒不认这个键：玩家点床那一下可能正按着跳跃键，
    // 不挡的话会"刚点下去就立刻起床"，看起来像床坏了
    if (input.jump && this.sleepTimer > 0.25) {
      this.wakeUp('你起来了。');
      return;
    }

    this.sleepTimer += dt;
    if (this.sleepTimer < SLEEP_SECONDS) return;

    // 醒来之前再看一眼：怪物在这几秒里靠近了床 → 被惊醒（原版"被怪物打扰而惊醒"）
    if (this.hostileMobsNear(bed.x, bed.y, bed.z)) {
      this.wakeUp('你被怪物惊醒了！');
      return;
    }

    this.timeOfDay = DAWN_TIME;
    // 睡到天亮 = 又过了一天（批次 84）：不推进的话"靠睡觉过日子"的玩家永远停在满月
    this.advanceDay();
    // 但**睡过了就不算失眠**（批次 126）：先推进一天、再归零，所以"睡一觉"净效果是 0
    this.daysWithoutSleep = 0;
    // 原版睡一觉会放晴（雷暴与雨一起停）
    this.weather.setKind('clear');
    this.bedSpawn = { x: bed.x, y: bed.y, z: bed.z, dimension: this.dimension };
    this.applyEnvironment();
    // 睡醒回血在原版是"睡觉直接回满"以外的效果（1.18 只有饥饿够时自然回复），
    // 这里不额外加血——只做"跳过夜晚 + 重生点"，避免凭空多一条回血规则
    this.wakeUp('天亮了。重生点已设置在这张床上。');
    // 进度（M7）：睡到天亮才算"甜美的梦"（被怪物惊醒、提前起床都不算——
    // 报事件的位置就在这个"真的跳到了黎明"的分支里）
    this.reportProgress({ kind: 'sleep' });
  }

  /**
   * 新的一天（批次 84）：天数 +1、月相推进一格。
   *
   * 月相是"**8 天一个循环**"的纯函数（`moonPhaseFor(dayCount)`），所以这里不存"当前相"，
   * 只存天数——存档里存派生值迟早会与天数不同步（"第 10 天显示新月"这种）。
   */
  private advanceDay(): void {
    this.dayCount++;
    this.sky.setMoonPhase(moonPhaseFor(this.dayCount));
    // 失眠（批次 126）：又一天没睡；新的一夜可以再派一批幻翼
    this.daysWithoutSleep++;
    this.phantomSpawnedTonight = false;
    this.phantomTimer = 0;
  }

  /** 收起睡觉遮罩、恢复行动 */
  private wakeUp(message: string): void {
    this.sleeping = null;
    this.sleepTimer = 0;
    this.sleepEl?.classList.add('hidden');
    this.chat.push(message, 'system');
  }

  /**
   * 拆掉整张床（两半一起），整张只掉落一次。
   *
   * 与门一样是"占两格的一件东西"：只拆一半会留下半张悬空的床，
   * 而方块本身看不出问题（这正是门那批踩过的坑）。
   * 顺带：如果拆的是**当前重生点**那张床，重生点作废（回退到世界出生点）。
   */
  private breakBedPair(x: number, y: number, z: number): void {
    const state = this.world.getBlockState(x, y, z);
    const [ox, oy, oz] = bedOtherHalf(x, y, z, state);

    for (const [bx, by, bz] of [[x, y, z], [ox, oy, oz]] as const) {
      const id = this.world.getBlock(bx, by, bz);
      // 另一半必须是**同一种**床（脏存档里可能只剩一半）
      if (!isBed(id)) continue;
      this.world.setBlockAndUpdate(bx, by, bz, Block.AIR);
      this.net.sendBlock(bx, by, bz, Block.AIR, 0, this.dimension);
      this.particles.spawnBlockBreak(bx + 0.5, by + 0.5, bz + 0.5, this.blockParticleColor(id));
      // 整张床只掉一次（在床脚那一格的位置掉）
      if (this.isCreative || [bx, by, bz].join() !== [x, y, z].join()) continue;
      const drop = dropFor(id);
      if (drop) this.spawnDrop(drop.id, drop.count, bx + 0.5, by + 0.5, bz + 0.5);
    }

    // 重生点的那张床被拆了 → 作废（死亡时回退到世界出生点，与原版一致）
    if (
      this.bedSpawn &&
      ((this.bedSpawn.x === x && this.bedSpawn.y === y && this.bedSpawn.z === z) ||
        (this.bedSpawn.x === ox && this.bedSpawn.y === oy && this.bedSpawn.z === oz))
    ) {
      this.bedSpawn = null;
      this.chat.push('你的重生点（床）被拆掉了', 'system');
    }
  }

  /**
   * 坐在床上时被打了：起床（原版也会把人从床上拽起来）。
   * 返回是否因此中断了睡觉。
   */
  private interruptSleep(): boolean {
    if (!this.sleeping) return false;
    this.wakeUp('你被惊醒了。');
    return true;
  }

  // ---------------------------------------------------------------- 告示牌上的字（B12，批次 80）

  /**
   * 右键牌子：打开编辑框。
   *
   * 标题里带上木料名（"橡木告示牌"），玩家才知道自己在改哪一块；
   * 已有文字一次性填进去，改完点"完成"就写回同一格（原版也是这样反复编辑的）。
   */
  private openSignEditor(x: number, y: number, z: number, blockId: number): void {
    this.editingSign = { x, y, z };
    const existing = this.signText.get(this.dimension, x, y, z);
    this.signEditor.show(existing, { title: `${itemLabel(blockId)}（右键可再改）` });
    // 与背包/配方书同一个入口：释放指针锁、收起触摸层，打字不会被当成操作
    this.handleInventoryOpen(true);
  }

  /**
   * 编辑器点"完成"：写进表里（四行全空 = 擦掉），并立刻重画那一块牌子。
   *
   * ⚠️ 这里**不等**那 0.25 秒的对账节拍：玩家刚敲完字就应当看见字出现在牌子上。
   */
  private applySignText(lines: string[]): void {
    const target = this.editingSign;
    if (!target) return;
    // ⚠️ 文字**不广播**给队友：联机协议目前只同步"哪一格变成了什么方块"
    // （容器内容也不在协议里），要同步它得给协议加一条消息 + 服务端存一份。
    // 这条差异写进了 TASKS B12（与"容器内容不同步"是同一个口径）。
    this.signText.set(this.dimension, target.x, target.y, target.z, lines);
    this.syncSigns();
  }

  /**
   * 牌子被拆/被替换时清掉上面的字（返回是否真的清掉了一条）。
   *
   * 除了玩家破坏，爆炸与方块更新也会走到这里；即使某一处漏了，
   * `syncSigns` 那趟对账也会发现"那一格已经不是牌子了"并补上（自愈）。
   */
  private clearSignText(x: number, y: number, z: number): void {
    if (!this.signText.remove(this.dimension, x, y, z)) return;
    this.syncSigns();
  }

  /**
   * 文字与世界的**对账**（每 0.25 秒一次）。
   *
   * 三件事一起做，所以调用方只需要"定期喊一声"：
   *  1. 这一维度、**区块已加载**、那一格还是牌子的 → 交给渲染器显示；
   *  2. 那一格已经不是牌子了（被火烧掉、被 TNT 炸掉、被指令改掉）→ **丢掉文字**；
   *  3. 其余（换维度、区块卸载）→ 渲染器自己会把多余的平面释放掉。
   *
   * 亮度取天光与方块光的较大者（屋里的牌子靠火把照亮，不能只算天光）。
   */
  private syncSigns(): void {
    const items: SignRenderItem[] = [];
    const stale: { x: number; y: number; z: number }[] = [];
    this.signText.forEach((entry) => {
      if (entry.dimension !== this.dimension) return;
      const cx = toChunkCoord(entry.x);
      const cz = toChunkCoord(entry.z);
      // 区块没加载：这一刻既看不出牌子在不在，也没必要显示 → 跳过（下次对账再说）
      if (!this.world.getChunk(cx, cz)) return;
      if (!isSign(this.world.getBlock(entry.x, entry.y, entry.z))) {
        stale.push({ x: entry.x, y: entry.y, z: entry.z });
        return;
      }
      items.push({
        key: signKey(entry.dimension, entry.x, entry.y, entry.z),
        x: entry.x,
        y: entry.y,
        z: entry.z,
        lines: entry.lines,
        light: Math.max(
          this.world.getSkyLight(entry.x, entry.y, entry.z),
          this.world.getBlockLight(entry.x, entry.y, entry.z),
        ),
        state: this.world.getBlockState(entry.x, entry.y, entry.z),
      });
    });
    for (const pos of stale) this.signText.remove(this.dimension, pos.x, pos.y, pos.z);
    this.signRenderer.sync(items);
  }

  // ---------------------------------------------------------------- 物品展示框（B14，批次 86）

  /**
   * 右键展示框（三种用法，与原版同一套手感）：
   *  - **空框 + 手上有东西** → 挂上去（消耗 1 个）；
   *  - **有东西 + 空手** → 转 45°（转 8 次回到原位）；
   *  - **有东西 + 手上有别的东西** → 换一件（旧的还给你，放不下就掉在框下）。
   *
   * ⚠️ 第三条是**本项目定的口径**（原版对"手上有东西"的框只做旋转）——
   * 手机上想换一幅"挂着的画/挂着的剑"只有拆框重放这一条路太别扭，
   * 所以把"换"接上；这条差异记在 TASKS B14。
   *
   * @returns 是否消费了这次右键（展示框**总是**消费：不然点框会把方块放到框那一格上）
   */
  private useItemFrame(x: number, y: number, z: number): boolean {
    const held = this.inventory.get(this.hotbarIndex);
    const entry = this.itemFrames.get(this.dimension, x, y, z);

    // 空手：有东西就转一格；空框空手什么也不做（但这一次右键算用掉了）
    if (!held) {
      if (!entry) return true;
      this.itemFrames.rotate(this.dimension, x, y, z);
      this.audio.play('click', { x, y, z });
      this.hand.swing();
      this.syncFrames();
      return true;
    }

    // 手上有东西：先把旧的取下来（还给你），再把手上这一件挂上去。
    // ⚠️ 顺序要紧：`consume` 之后手上那一份就没了，所以快照要在它之前取
    const snapshot: ItemStack = { ...stackExtras(held), id: held.id, count: 1 };
    if (!this.inventory.consume(held.id, 1)) return false;
    if (entry) {
      const leftover = this.inventory.addStack(entry.item);
      if (leftover > 0) this.spawnDrop(entry.item.id, leftover, x + 0.5, y - 0.2, z + 0.5, stackExtras(entry.item));
    }
    this.itemFrames.set(this.dimension, x, y, z, snapshot, entry?.rotation ?? 0);
    this.audio.play('place', { x, y, z });
    this.hand.swing();
    this.refreshHotbar();
    this.syncFrames();
    return true;
  }

  /**
   * 框里挂着什么与世界的**对账**（每 0.25 秒一次，与牌子的文字同一拍）。
   *
   * 三件事：
   *  1. 这一维度、**区块已加载**、那一格还是展示框的 → 交给渲染器画；
   *  2. 那一格已经不是框了（被火烧掉 / 被指令改掉 / 脏存档）→ **把挂着的东西还回去**再清掉条目；
   *  3. 其余（换维度、区块卸载）→ 渲染器自己把多余的子节点释放掉。
   *
   * ⚠️ 第 2 条的"还回去"与告示牌不同：牌子上的字丢了就是丢了，
   * 而框里可能挂着一把附魔剑——**宁可掉在地上，也不能静默吞掉**。
   * 玩家自己拆框走的是破坏那条路（那里已经取过一次），条目早没了，所以不会掉两份。
   */
  private syncFrames(): void {
    const items: FrameRenderItem[] = [];
    const stale: FrameEntry[] = [];
    this.itemFrames.forEach((entry) => {
      if (entry.dimension !== this.dimension) return;
      // 区块没加载：这一刻既看不出框在不在，也没必要显示 → 跳过（下次对账再说）
      if (!this.world.getChunk(toChunkCoord(entry.x), toChunkCoord(entry.z))) return;
      if (this.world.getBlock(entry.x, entry.y, entry.z) !== Block.ITEM_FRAME) {
        stale.push(entry);
        return;
      }
      items.push({
        key: frameKey(entry.dimension, entry.x, entry.y, entry.z),
        x: entry.x,
        y: entry.y,
        z: entry.z,
        itemId: entry.item.id,
        rotation: entry.rotation,
        light: Math.max(
          this.world.getSkyLight(entry.x, entry.y, entry.z),
          this.world.getBlockLight(entry.x, entry.y, entry.z),
        ),
        state: this.world.getBlockState(entry.x, entry.y, entry.z),
      });
    });
    for (const entry of stale) this.dropFrameContents(entry.x, entry.y, entry.z);
    this.itemFrameRenderer.sync(items);
  }

  // ---------------------------------------------------------------- 成就 / 进度（M7，批次 87）

  /**
   * 进度系统**上岗**（世界与存档都读完、玩家落位之后）。三件事：
   *
   *  1. 进度已经在读档时进了 `AdvancementTracker`（脏数据逐条跳过由它自己管）；
   *  2. **对着背包对一次账**：已经拿在手里的东西算已达成（自愈——
   *     存档丢了、或者这条进度是本批新加的，都能靠背包把自己补回来）；
   *     这一趟不弹卡片（见字段注释），只写一条汇总；
   *  3. 点亮根条目（`story/root`，`kind: 'auto'`）。原版也是进世界就点亮它。
   *
   * **只在这里**开启 `progressReady`：在那之前背包变动一律不报事件
   * （读档回填背包的那一串 `add` 会走同一条 `onChange` 通道）。
   */
  private armProgress(): void {
    this.progressReady = true;
    this.suppressProgressToasts = true;
    const before = this.advancements.earnedCount;
    this.reportProgress({ kind: 'auto' });
    this.reconcileObtainProgress();
    // 进世界那一趟不弹卡片（否则"创建世界"会当场跳出好几张）——
    // 但**要留一句话**，不然玩家在面板里看到一堆"已达成"会以为是 bug
    const gained = this.advancements.earnedCount - before;
    if (gained > 0) this.chat.push(`对了一次背包：已达成 ${gained} 条进度（详情按 J 看）`, 'system');
    this.suppressProgressToasts = false;
  }

  /**
   * **背包对账**：把此刻背包里的东西各报一次 `obtain`。
   *
   * 为什么把"拿到东西"收在这一条通道上：原版的大半进度用的就是 `inventory_changed`
   * 触发器，而本项目的"挖到 / 合成 / 烧出 / 从箱子里取 / 钓上来 / 从生物身上掉"
   * 六条路最后都会落到背包上，所以**一处就够**——不必在六个地方各报一次，
   * 那样迟早漏一处（"漏斗搬进来的不算数"这种）。
   *
   * 三个调用点：背包变化时（立刻，手感要紧）、**每秒一次**（兜底：
   * "东西早就在背包里、但它的父条目刚刚才达成"这种顺序也能自己长回来）、
   * 以及进世界那一趟（见 `armProgress`）。
   *
   * 重复报没有代价：`handle` 对已达成的条目直接跳过，而带附魔的那一条
   * **本来就要每次报**（判据是"手里有没有一件附魔过的"，与"见没见过这种物品"无关）。
   */
  private reconcileObtainProgress(): void {
    if (!this.progressReady) return;
    const events: ProgressEvent[] = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = this.inventory.get(i);
      if (!stack) continue;
      events.push(
        stack.enchants
          ? { kind: 'obtain', item: stack.id, enchanted: true }
          : { kind: 'obtain', item: stack.id },
      );
    }
    if (events.length > 0) this.reportProgress(...events);
  }

  /**
   * 报一批"发生了什么"：能达成的达成，然后**三处一起给反馈**——
   * 弹提示卡、写一条聊天记录、播一声铃。
   *
   * ⚠️ 写聊天栏不是冗余：手机上玩家可能正低头挖矿，弹窗错过就永远看不到了
   * （提示卡 4.5 秒后自己消失），聊天记录会留着。
   */
  private reportProgress(...events: ProgressEvent[]): void {
    if (!this.progressReady) return;
    const unlocked: AdvancementDef[] = [];
    for (const event of events) unlocked.push(...this.advancements.handle(event));
    if (unlocked.length === 0) return;

    for (const def of unlocked) {
      if (!this.suppressProgressToasts) {
        this.advancementToast.push(def);
        this.chat.push(`${def.challenge ? '挑战完成' : '进度已达成'}：${def.title}——${def.desc}`, 'system');
        this.audio.play('achievement');
      }
    }
    // 面板开着就当场重画（不然玩家会看到"列表里还是灰的"）
    this.advancementScreen.refresh();
  }

  /** 打开成就面板（暂停菜单/背包标题栏/`J` 键都走这里） */
  private openAdvancements(): void {
    if (this.advancementScreen.isOpen) return;
    this.advancementScreen.show();
    this.handleInventoryOpen(true);
  }

  private closeAdvancements(): void {
    this.advancementScreen.hide();
    // uiOpen 交回给"还在开着的那个界面"（与配方书同一条：两个面板可以叠着开）。
    // ⚠️ 暂停菜单（设置面板）也要算进来：从暂停菜单里点开成就、关掉之后
    // 人还站在暂停菜单上，这时候把 uiOpen 交成 false 会顺手把指针锁回去、
    // 玩家就在菜单背后继续走动了
    this.handleInventoryOpen(
      this.inventoryScreen.isOpen || this.recipeBook.isOpen || this.settingsScreen.isOpen,
    );
  }

  private toggleAdvancements(): void {
    if (this.advancementScreen.isOpen) this.closeAdvancements();
    else this.openAdvancements();
  }

  // ---------------------------------------------------------------- 村庄的人口（J22，批次 89）

  /**
   * 区块加载之后：把这一片村庄里的**床**变成村民（一张床 = 一个村民）。
   *
   * 规则与判据在 `core/world/VillagePopulation.ts`（纯函数、可离线断言），
   * 这里只做三件它做不了的事：读真世界、看**活着的实体**（防重复刷）、造实体。
   *
   * ⚠️ 只在主世界刷：下界/末地的区块里不会有床，但**别把这条依赖留在"碰巧"上**
   * （以后加个"下界的床"或者编辑器的指令方块，就会在主线程造出不该有的村民）。
   */
  private populateVillage(cx: number, cz: number): void {
    if (this.dimension !== Dimension.OVERWORLD) return;
    const view: VillageWorldView = {
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      getState: (x, y, z) => this.world.getBlockState(x, y, z),
      villagerNear: (x, y, z, radius) => this.villagerNear(x, y, z, radius),
    };
    for (const plan of planVillagePopulation(view, cx, cz)) {
      const villager = new Villager(plan.x + 0.5, plan.y, plan.z + 0.5);
      // 身边有工作站就直接认领（村庄里"这栋房子摆什么，住的就是谁"）——
      // 认领的是**哪一格**也一并记下来，与 J11 那套"认领工作站"是同一份数据
      if (plan.professionId !== null) villager.assignProfession(plan.professionId, plan.workstation);
      this.entities.spawn(villager);
    }
  }

  /** 这一格附近有没有活着的村民（`planVillagePopulation` 的"别刷第二遍"用） */
  private villagerNear(x: number, y: number, z: number, radius: number): boolean {
    for (const entity of this.entities.all) {
      if (!(entity instanceof Villager) || entity.dead) continue;
      if (Math.abs(entity.x - (x + 0.5)) > radius || Math.abs(entity.z - (z + 0.5)) > radius) continue;
      if (Math.abs(entity.y - y) > radius) continue;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 雷电与避雷针（批次 83）

  /** 把一个区块里的避雷针扫进索引（区块加载时调一次，摊掉 10 万次读） */
  private scanRodsInChunk(cx: number, cz: number): void {
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk) return;
    // ⚠️ 这里是**每加载一个区块**都要跑的（开新世界时一次 400+ 个区块），
    // 所以它必须便宜。原来写的是三重循环 + 每格一次 `Chunk.index()` 调用：
    // 16×16×384 = **98304 次**带函数调用的读取，一个区块都嫌多，一次开局就是四千万次。
    // 现在改成对扁平数组做**一趟线性扫描**（下标换算直接按位算，见 `Chunk.index` 的公式：
    // `i = ((y - MIN_Y) << 8) | (z << 4) | x`），并且**只在主世界扫**
    // （避雷针只为闪电服务，而下界与末地根本不打雷）。
    if (this.dimension !== Dimension.OVERWORLD) return;
    const originX = cx * 16;
    const originZ = cz * 16;
    const blocks = chunk.blocks;
    // 再借一手 `fillLootChests` 的做法：**空的 section 直接跳过**。
    // 自然地形里大多数 section 是空的（16³ 一格都没有），跳过它们之后
    // 这趟扫描只在"真的有方块的那几段"上跑（一个 section 4096 格）
    for (let section = 0; section < SECTION_COUNT; section++) {
      if (chunk.sectionIsEmpty(section)) continue;
      const from = Chunk.index(0, Math.max(WORLD_MIN_Y, Chunk.sectionMinY(section)), 0);
      const to = Math.min(blocks.length, from + 16 * 16 * 16);
      for (let i = from; i < to; i++) {
        if (blocks[i] !== Block.LIGHTNING_ROD) continue;
        this.lightningRods.add(rodKey(originX + (i & 15), (i >> 8) + WORLD_MIN_Y, originZ + ((i >> 4) & 15)));
      }
    }
  }

  /** 区块卸载：忘掉里面的避雷针（不然索引会一直长） */
  private forgetRodsInChunk(cx: number, cz: number): void {
    const minX = cx * 16;
    const minZ = cz * 16;
    for (const key of [...this.lightningRods]) {
      const [x, , z] = key.split(',').map(Number);
      if (x! >= minX && x! < minX + 16 && z! >= minZ && z! < minZ + 16) this.lightningRods.delete(key);
    }
  }

  /** 放下/拆掉避雷针时维护索引（不必等区块重载） */
  private noteRodPlaced(x: number, y: number, z: number): void {
    this.lightningRods.add(rodKey(x, y, z));
  }

  private noteRodBroken(x: number, y: number, z: number): void {
    this.lightningRods.delete(rodKey(x, y, z));
  }

  // ---------------------------------------------------------------- 信标（K5，批次 117）

  /** 信标索引的键（**带维度**：三个维度共用同一套坐标，见 `BlockEntityStore` 那条教训） */
  private beaconKey(x: number, y: number, z: number): string {
    return `${this.dimension},${x},${y},${z}`;
  }

  /**
   * 把一个区块里的信标扫进索引（区块加载时调一次）。
   *
   * 与避雷针 / 刷怪笼那两趟同一个手法：**对扁平数组做一趟线性扫描、空的 section 跳过**
   * （三重循环 + `Chunk.index()` 在开局那 400 个区块上是四千万次调用）。
   * 唯一不同的是**不限定维度**：信标主世界 / 下界 / 末地都能摆
   * （避雷针只为闪电服务，所以那趟只在主世界跑）。
   */
  private scanBeaconsInChunk(cx: number, cz: number): void {
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk) return;
    const originX = cx * 16;
    const originZ = cz * 16;
    const blocks = chunk.blocks;
    for (let section = 0; section < SECTION_COUNT; section++) {
      if (chunk.sectionIsEmpty(section)) continue;
      const from = Chunk.index(0, Math.max(WORLD_MIN_Y, Chunk.sectionMinY(section)), 0);
      const to = Math.min(blocks.length, from + 16 * 16 * 16);
      for (let i = from; i < to; i++) {
        if (blocks[i] !== Block.BEACON) continue;
        this.noteBeacon(originX + (i & 15), (i >> 8) + WORLD_MIN_Y, originZ + ((i >> 4) & 15));
      }
    }
  }

  /** 区块卸载：忘掉里面的信标（光柱不必再画，效果也没法算——方块读不到了） */
  private forgetBeaconsInChunk(cx: number, cz: number): void {
    const minX = cx * 16;
    const minZ = cz * 16;
    for (const key of [...this.beacons.keys()]) {
      const [, sx, , sz] = key.split(',');
      const x = Number(sx);
      const z = Number(sz);
      if (x >= minX && x < minX + 16 && z >= minZ && z < minZ + 16) this.beacons.delete(key);
    }
  }

  /** 记下一座信标（区块扫描与"放下信标"两条路径都走这里），顺手算一次等级 */
  private noteBeacon(x: number, y: number, z: number): void {
    this.beacons.set(this.beaconKey(x, y, z), { level: beaconLevel(this.world, x, y, z), refresh: 0 });
  }

  /**
   * 每帧推进信标（K5，批次 117）：**光柱逐帧同步、效果每秒挂一次**。
   *
   * 金字塔等级每秒重算一次——最贵的四级要读 164 格，不能每帧算；光柱按缓存画，
   * 所以"刚搭好的金字塔"最多一秒后亮起来（可以接受）。
   * 效果的范围判据走**三维距离**（原版是球），离开范围后效果还能留几秒
   * （时长 3 秒、每秒刷一次，见 `beaconEffects`）。
   */
  private updateBeacons(dt: number): void {
    const beams: { x: number; y: number; z: number }[] = [];
    const px = this.physics.x + 0.5;
    const py = this.physics.y;
    const pz = this.physics.z + 0.5;

    this.beaconEffectTimer -= dt;
    const refresh = this.beaconEffectTimer <= 0;
    if (refresh) this.beaconEffectTimer = 1;

    for (const [key, entry] of [...this.beacons]) {
      const [dimension, sx, sy, sz] = key.split(',');
      if (dimension !== this.dimension) continue;
      const x = Number(sx);
      const y = Number(sy);
      const z = Number(sz);
      // 那一格已经不是信标了（被挖掉/被炸掉）→ 直接忘掉
      if (this.world.getBlock(x, y, z) !== Block.BEACON) {
        this.beacons.delete(key);
        continue;
      }
      if (refresh) entry.level = beaconLevel(this.world, x, y, z);
      if (entry.level <= 0) continue;

      // 光柱：只要它亮着就画——**远处的光柱也该看得见**，所以不看玩家在不在范围内
      beams.push({ x, y, z });

      if (!refresh) continue;
      if (Math.hypot(px - x, py - y, pz - z) > beaconRange(entry.level)) continue;
      const state = this.world.getBlockState(x, y, z);
      for (const spec of beaconEffects(entry.level, beaconPrimary(state), beaconRegen(state))) {
        this.effects.apply(spec.effect, spec.seconds, spec.amplifier);
      }
    }

    this.beaconBeamRenderer.sync(beams);
  }

  /**
   * 世界边界（K12，批次 175）：蓝墙摆位 + 越界伤害 + 硬推回。
   *
   * 三件事的次序是有讲究的：**先摆墙**（用这一帧的位置，视觉上不滞后）、
   * **再判伤害**（按"推回之前"的位置算，否则玩家永远站在边界内侧、永远不会掉血）、
   * **最后推回**（把位置夹到软区里侧，物理层下一帧就从这里继续）。
   *
   * ⚠️ 传送途中与"落地解析之前"一律跳过：那时坐标是临时值，按它判越界会把玩家
   * 传送到一个还没加载的地方（与 `spawnResolved` 那套保护同一条理由）。
   */
  private updateWorldBorder(dt: number): void {
    this.borderRenderer.sync(
      this.border,
      { x: this.physics.x, y: this.physics.y, z: this.physics.z },
      this.viewDistanceNow,
    );

    if (!this.spawnResolved || this.pendingArrival || this.sleeping || this.stats.dead) {
      this.borderDamageTimer = 0;
      return;
    }

    const damage = borderDamagePerSecond(this.border, this.physics.x, this.physics.z);
    if (damage > 0) {
      this.borderDamageTimer += dt;
      if (this.borderDamageTimer >= 1) {
        this.borderDamageTimer -= 1;
        this.damagePlayer(damage, this.physics.x, this.physics.z);
      }
    } else {
      this.borderDamageTimer = 0;
    }

    const clamped = clampToBorder(this.border, this.physics.x, this.physics.z);
    if (clamped.clamped) {
      // 推回时顺手把水平速度清零：否则会被墙"吸"着抖动（一帧推回、一帧又冲出去）
      this.physics.teleport(clamped.x, this.physics.y, clamped.z);
      this.physics.vx = 0;
      this.physics.vz = 0;
    }
  }

  /** 右键信标：打开界面（把金字塔等级与当前选择读给它） */
  private openBeaconScreen(x: number, y: number, z: number): void {
    const state = this.world.getBlockState(x, y, z);
    this.editingBeacon = { x, y, z };
    this.beaconScreen.show({
      level: beaconLevel(this.world, x, y, z),
      primary: beaconPrimary(state),
      regen: beaconRegen(state),
    });
    // 与背包/告示牌同一个入口：释放指针锁、收起触摸层
    this.handleInventoryOpen(true);
  }

  /**
   * 界面里选了效果（K5，批次 117）：写进信标那一格的**方块状态**。
   *
   * 写状态而不是"记在内存里"：状态跟着区块数据一起存档（见 `blockState.ts` 的注记），
   * 于是"退出重进信标还记得你选了什么"不需要另开一条存档通道——与箱子记战利品表同一套路。
   *
   * ⚠️ 够不到的能力**在这里也拦一道**（界面会把按钮置灰，但传进来的是外部数据）：
   * 没有金字塔时选主效果会写成"选了也没用"（等级 0 不挂效果），三级以下要生命恢复会被丢掉。
   */
  private applyBeaconChoice(primary: number, regen: boolean): void {
    const target = this.editingBeacon;
    if (!target) return;
    const { x, y, z } = target;
    if (this.world.getBlock(x, y, z) !== Block.BEACON) return;

    const level = beaconLevel(this.world, x, y, z);
    const current = this.world.getBlockState(x, y, z);
    const next = withBeaconRegen(
      withBeaconPrimary(current, primary),
      regen && level >= BEACON_REGEN_MIN_LEVEL,
    );
    this.world.setStateAndUpdate(x, y, z, next);
    this.net.sendBlock(x, y, z, Block.BEACON, next, this.dimension);

    const entry = this.beacons.get(this.beaconKey(x, y, z));
    if (entry) entry.level = level;
    this.audio.play('place', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    // 立刻按新状态刷一遍界面：选中的那一条要马上变绿（否则玩家会以为没点上）
    this.beaconScreen.show({ level, primary: beaconPrimary(next), regen: beaconRegen(next) });
  }

  /** 正在编辑的那座信标（界面点"效果"时要写哪一格） */
  private editingBeacon: { x: number; y: number; z: number } | null = null;

  // ---------------------------------------------------------------- 刷怪笼（批次 92）

  /**
   * 把一个区块里的刷怪笼扫进索引（区块加载时调一次）。
   *
   * ⚠️ **只在下界扫**：刷怪笼目前只出现在下界要塞里，而这一趟是全高度扫描
   * （16×16×384 ≈ 10 万次读），主世界每加载一个区块白扫一遍不值当。
   * 与 `populateVillage` 只在主世界跑是同一条讲究——**别把"碰巧没有"当成"不会发生"**。
   */
  private scanSpawnersInChunk(cx: number, cz: number): void {
    if (this.dimension !== Dimension.NETHER) return;
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk) return;
    const originX = cx * 16;
    const originZ = cz * 16;
    for (let y = WORLD_MIN_Y; y <= WORLD_MAX_Y; y++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          if (chunk.blocks[Chunk.index(lx, y, lz)] !== Block.SPAWNER) continue;
          this.noteSpawner(originX + lx, y, originZ + lz);
        }
      }
    }
  }

  /** 区块卸载：忘掉里面的刷怪笼（不然索引会一直长，而且会对着空洞刷怪） */
  private forgetSpawnersInChunk(cx: number, cz: number): void {
    const minX = cx * 16;
    const minZ = cz * 16;
    for (const key of [...this.spawners.keys()]) {
      const [x, , z] = key.split(',').map(Number);
      if (x! >= minX && x! < minX + 16 && z! >= minZ && z! < minZ + 16) this.spawners.delete(key);
    }
  }

  /** 记下一个刷怪笼（区块扫描与"放下笼子"两条路径都走这里） */
  private noteSpawner(x: number, y: number, z: number): void {
    const def = spawnerDefFor(this.world.getBlock(x, y, z));
    if (!def) return;
    // 首次生成等半个周期：玩家刚走到笼子跟前就有一只飘出来，比"死等满 8 秒"更像原版
    this.spawners.set(spawnerKey(x, y, z), def.interval * 0.5);
  }

  private noteSpawnerBroken(x: number, y: number, z: number): void {
    this.spawners.delete(spawnerKey(x, y, z));
  }

  /**
   * 每帧：给每个刷怪笼走倒计时，到点就按规则生成一只。
   *
   * "生成规则"全在 `core/world/SpawnerTicking.ts`（纯函数），这里只做三件它做不了的事：
   * 读真世界、数**活着的实体**、造实体——与村民人口那一套完全同构。
   */
  private updateSpawners(dt: number): void {
    if (this.spawners.size === 0) return;
    const view: SpawnerWorldView = {
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      player: { x: this.physics.x, y: this.physics.y, z: this.physics.z },
      mobsNear: (x, y, z, radius, mobId) => this.mobsNear(x, y, z, radius, mobId),
    };

    for (const [key, timer] of [...this.spawners]) {
      const [x, y, z] = key.split(',').map(Number);
      // 那一格已经不是笼子了（被拆掉/被炸掉）→ 直接忘掉
      const def = spawnerDefFor(this.world.getBlock(x!, y!, z!));
      if (!def) {
        this.spawners.delete(key);
        continue;
      }
      const next = timer - dt;
      if (next > 0) {
        this.spawners.set(key, next);
        continue;
      }
      this.spawners.set(key, def.interval);

      const plan = planSpawnerSpawn(view, def, { x: x!, y: y!, z: z! });
      if (!plan) continue;
      const type = mobTypeById(def.mobId);
      if (!type) continue;
      this.entities.spawn(createMob(type, plan.x + 0.5, plan.y, plan.z + 0.5));
    }
  }

  /** 这一带已经有几只这种生物了（刷怪笼的"别越刷越多"用；与 `villagerNear` 同一个套路） */
  private mobsNear(x: number, y: number, z: number, radius: number, mobId: string): number {
    let count = 0;
    for (const entity of this.entities.all) {
      if (!(entity instanceof Mob) || entity.dead) continue;
      if (entity.type.id !== mobId) continue;
      if (Math.abs(entity.x - (x + 0.5)) > radius) continue;
      if (Math.abs(entity.z - (z + 0.5)) > radius) continue;
      if (Math.abs(entity.y - y) > radius) continue;
      count++;
    }
    return count;
  }

  /**
   * 每帧：脉冲倒计时 + 雷暴里的打雷节奏。
   *
   * ⚠️ 脉冲**熄灭的那一刻**要主动喊一次重算——电路不会自己知道"外部世界的量变了"
   * （与阳光传感器每秒复查是同一条经验：`外部世界会变的量必须有人主动去看`）。
   */
  private updateLightning(dt: number): void {
    for (const pos of this.rodPulses.tick(dt)) {
      this.redstone.onBlockChanged(this.redstoneWorld, pos.x, pos.y, pos.z);
    }

    // 只在雷暴里打雷（下雨不打）
    if (this.weather.current !== 'thunder') {
      this.strikeTimer = 0;
      return;
    }
    this.strikeTimer -= dt;
    if (this.strikeTimer > 0) return;
    this.strikeTimer = STRIKE_INTERVAL_MIN + Math.random() * (STRIKE_INTERVAL_MAX - STRIKE_INTERVAL_MIN);
    this.strikeLightning();
  }

  /**
   * 打一次雷。
   *
   * 落点由 `pickStrike` 决定（128 格内有避雷针就打它），y 由这里补：
   * 避雷针那格就是它自己，否则按那一列找地表（**打地表**是原版的观感）。
   */
  private strikeLightning(): void {
    const player = { x: this.physics.x, y: this.physics.y, z: this.physics.z };
    const rods = [...this.lightningRods].map((key) => {
      const [x, y, z] = key.split(',').map(Number);
      return { x: x!, y: y!, z: z! };
    });
    const target = pickStrike(Math.random, player, rods);
    if (!target) return;

    let y = target.y;
    if (!target.rod) {
      const surface = this.surfaceYAt(target.x, target.z);
      if (surface === null) return; // 那一列还没加载：这一雷就当没打（不要凭空落到虚空里）
      y = surface;
    }

    const state = this.world.getBlockState(target.x, target.y, target.z);
    const tip = target.rod
      ? rodTipPoint(target.x, target.y, target.z, state)
      : { x: target.x + 0.5, y: y + 1, z: target.z + 0.5 };

    // ---- 演出：一道竖直的亮柱 + 雷声（原版是分叉模型，这里用粒子柱近似）
    this.spawnLightningBolt(tip);
    this.audio.play('thunder', { x: tip.x, y: tip.y, z: tip.z });

    // ---- 避雷针：给 0.4 秒的红石脉冲（原版 8 tick），并**立刻**让电路重算一次
    if (target.rod) {
      this.rodPulses.pulse(target.x, target.y, target.z);
      this.redstone.onBlockChanged(this.redstoneWorld, target.x, target.y, target.z);
    } else {
      // ---- 地面被劈中：点火（只有"空气 + 下面是实心"那一格才点，与 `Fire.ts` 同一条判据）
      const below = this.world.getBlock(target.x, y - 1, target.z);
      const here = this.world.getBlock(target.x, y, target.z);
      if (shouldIgnite(here, below)) {
        this.world.setBlockAndUpdate(target.x, y, target.z, Block.FIRE);
        this.net.sendBlock(target.x, y, target.z, Block.FIRE, 0, this.dimension);
      }
    }

    // ---- 伤害：以落点为中心 ±3 格（玩家与生物都算，**无视护甲**——原版如此）
    const radius = LIGHTNING_DAMAGE_RADIUS;
    const px = this.physics.x;
    const py = this.physics.y + 0.9;
    const pz = this.physics.z;
    if (
      Math.abs(px - tip.x) <= radius + 0.5 &&
      Math.abs(py - tip.y) <= radius + 0.5 &&
      Math.abs(pz - tip.z) <= radius + 0.5
    ) {
      // `'lightning'` 是这张表里**唯一无视护甲**的伤害（原版雷击不受护甲减免）
      this.damagePlayer(LIGHTNING_DAMAGE, tip.x, tip.z, 'lightning');
    }
    const context = this.lastEntityContext;
    if (context) {
      for (const entity of this.entities.all) {
        if (entity.dead) continue;
        if (Math.abs(entity.x - tip.x) > radius) continue;
        if (Math.abs(entity.y - tip.y) > radius) continue;
        if (Math.abs(entity.z - tip.z) > radius) continue;
        if (!(entity instanceof Mob)) continue;
        entity.hurt(LIGHTNING_DAMAGE, entity.x - tip.x, entity.z - tip.z, context);
      }
    }
  }

  /** 一道闪电的观感：从落点往上拉起一根粒子柱（越高越稀） */
  private spawnLightningBolt(tip: { x: number; y: number; z: number }): void {
    for (let i = 0; i < 14; i++) {
      const y = tip.y + i * 1.2;
      this.particles.spawnFlame(tip.x, y, tip.z, 0xdfe8ff, 2);
    }
    this.particles.spawnSmoke(tip.x, tip.y, tip.z, 10, 0.5);
  }

  /** 某一列的地表方块高度（没加载返回 null）——雷要打在地上，不能打进虚空 */
  private surfaceYAt(x: number, z: number): number | null {
    if (!this.world.isLoaded(x, z)) return null;
    for (let y = WORLD_MAX_Y; y >= WORLD_MIN_Y; y--) {
      const id = this.world.getBlock(x, y, z);
      if (id === Block.AIR || id === Block.WATER) continue;
      return y;
    }
    return null;
  }

  // ---------------------------------------------------------------- 钓鱼（批次 81，G11）

  /**
   * 右键：还没抛竿就抛，已经抛了就收。
   *
   * ⚠️ **不需要准星对着方块**（原版也不要求）：浮标朝你看的方向飞出去，
   * 落在水里才有下文、落在岸上就自己收回来。若要求"准星必须指着水面"，
   * 就会撞上那个 4.5 格的交互距离——而钓鱼本来就要往远处抛。
   */
  private useFishingRod(): void {
    if (this.uiOpen || this.stats.dead) return;

    // 已经抛出去了：这一下是收杆
    if (this.fishing.phase !== 'idle') {
      const { caught } = reelFishing(this.fishing);
      this.fishing = IDLE_FISHING;
      this.bobber = null;
      this.hideBobber();
      // 原版每次**收杆**都扣 1 点耐久——不管是钓到了还是空手（所以钓竿也是耗材）
      this.damageHeldTool();
      this.hand.swing();
      if (caught) this.catchFish();
      else this.audio.play('click');
      return;
    }

    const bonuses = fishingBonuses(this.heldEnchants);
    this.fishing = beginCast(Math.random, bonuses.lure);
    const velocity = castVelocity(this.yaw, this.pitch);
    this.bobber = {
      x: this.physics.x,
      y: this.physics.eyeY - 0.12,
      z: this.physics.z,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
    };
    this.showBobber();
    this.audio.play('bow_shoot');
    this.hand.swing();
  }

  /** 每帧推进浮标与状态机（flying → waiting → biting → 收杆或跑掉） */
  private updateFishing(dt: number): void {
    if (this.fishing.phase === 'idle' || !this.bobber) return;

    // 手上换了东西 / 开了界面 / 死了 → 直接收回浮标（原版也会收回来）
    if (this.heldItemId !== Item.FISHING_ROD || this.uiOpen || this.stats.dead) {
      this.fishing = IDLE_FISHING;
      this.bobber = null;
      this.hideBobber();
      return;
    }

    const bobber = this.bobber;
    let landing: FishingLanding = null;

    if (this.fishing.phase === 'flying') {
      // 抛物线与投掷物同一组数（初速 30 格/秒、重力 12 格/秒²）
      bobber.vy -= CAST_GRAVITY * dt;
      bobber.x += bobber.vx * dt;
      bobber.y += bobber.vy * dt;
      bobber.z += bobber.vz * dt;

      const bx = Math.floor(bobber.x);
      const by = Math.floor(bobber.y);
      const bz = Math.floor(bobber.z);
      const id = this.world.getBlock(bx, by, bz);
      if (id === Block.WATER) {
        landing = 'water';
        // 落在水面上：浮标停在这一格水的上表面（4/16 高的小方块露出水面一半）
        bobber.x = bx + 0.5;
        bobber.z = bz + 0.5;
        bobber.y = by + 0.94;
        bobber.vx = 0;
        bobber.vy = 0;
        bobber.vz = 0;
      } else if (id !== Block.AIR) {
        landing = 'blocked';
      } else {
        const dx = bobber.x - this.physics.x;
        const dy = bobber.y - this.physics.eyeY;
        const dz = bobber.z - this.physics.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > MAX_CAST_DISTANCE) landing = 'blocked';
      }
    }

    const before = this.fishing;
    this.fishing = advanceFishing(this.fishing, dt, landing);
    const phase = this.fishing.phase;

    if (before.phase !== phase) {
      if (phase === 'waiting') {
        this.audio.play('splash');
        this.particles.spawnSplash(bobber.x, bobber.y, bobber.z, 0x4d84c8, 8);
      } else if (phase === 'biting') {
        // 咬钩：水花 + 提示（浮标同时会往下沉一点，见下面那段）
        this.audio.play('splash');
        this.particles.spawnSplash(bobber.x, bobber.y, bobber.z, 0x9fd4ff, 14);
        this.chat.push('咬钩了！快收杆（2 秒内）', 'system');
      } else if (phase === 'idle') {
        this.bobber = null;
        this.hideBobber();
        if (before.phase === 'flying') this.chat.push('浮标没落在水里', 'error');
        else if (before.phase === 'biting') this.chat.push('鱼跑了…', 'system');
      }
    }

    if (this.bobber && this.bobberMesh) {
      // 咬钩时浮标往下沉 0.12 格——这是玩家唯一的"该收杆了"的视觉信号
      const dip = phase === 'biting' ? -0.12 : 0;
      this.bobberMesh.position.set(this.bobber.x, this.bobber.y + dip, this.bobber.z);
    }
  }

  /** 钓上来了：掷战利品、进背包（满了掉地上）、给经验、报一条消息 */
  private catchFish(): void {
    const bonuses = fishingBonuses(this.heldEnchants);
    const caught = rollFishing(Math.random, bonuses.luck);
    const stack: ItemStack = { id: caught.id, count: caught.count };
    if (caught.enchantedBook) {
      // 附魔书（宝藏池）：**现掷一条附魔**装进书里——原版钓上来的也是带附魔的书。
      // 复用附魔台那套掷点（`kind: 'book'` 时它只出一条、且排除宝藏附魔）
      const rolled = pickEnchants('book', 30, Math.random);
      const enchants: Record<string, number> = {};
      for (const entry of rolled) enchants[entry.id] = entry.level;
      if (rolled.length > 0) stack.enchants = enchants;
    }

    const leftover = this.inventory.addStack(stack);
    if (leftover > 0) this.spawnDrop(caught.id, leftover, this.physics.x, this.physics.y + 1, this.physics.z);

    // 进度（M7）：钓上来（"腥味十足"）。报的是**钓上来那件东西**，
    // 所以以后要加"用桶钓一条鱼"这类条目，只要在表里写 ids 就行
    this.reportProgress({ kind: 'fish', item: caught.id });

    // 原版每次钓上来给 1~6 点经验（批次 170 起掉成球，落在玩家脚下）
    this.spawnXpOrbs(1 + Math.floor(Math.random() * 6), this.physics.x, this.physics.y + 0.5, this.physics.z);
    this.audio.play('click');
    const where = this.bobber;
    if (where) this.particles.spawnSplash(where.x, where.y, where.z, 0x9fd4ff, 10);
    this.refreshHotbar();

    const label = itemLabel(caught.id);
    const extra = Object.keys(stack.enchants ?? {}).length > 0 ? '（附魔书）' : '';
    this.chat.push(`钓到了 ${label}${caught.count > 1 ? ` ×${caught.count}` : ''}${extra}`, 'system');
  }

  /** 建（或复用）浮标那个小方块：上白下红，与原版浮标同一个配色 */
  private showBobber(): void {
    if (!this.bobberMesh) {
      const geometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
      // 盒子六个面：`BoxGeometry` 的顺序是 +x / −x / +y / −y / +z / −z，
      // 所以"白顶"是第 3 个材质（其余五面红）——原版浮标就是红身白顶
      const red = new THREE.MeshBasicMaterial({ color: srgbColor(0xd0403a) });
      const white = new THREE.MeshBasicMaterial({ color: srgbColor(0xeceff2) });
      this.bobberMesh = new THREE.Mesh(geometry, [red, red, white, red, red, red]);
      this.scene.add(this.bobberMesh);
    }
    this.bobberMesh.visible = true;
  }

  private hideBobber(): void {
    if (this.bobberMesh) this.bobberMesh.visible = false;
  }

  /**
   * 拆掉一整"柱"往上叠的植物（批次 50 的海带 + 批次 51 顺带接上甘蔗）。
   *
   * 从被拆的那一格往上，凡是**同一种**方块都一起变成空气——原版拆海带/甘蔗的任意一节
   * 都会让上面几节断掉。与门"整扇只掉一次"不同，这里**每一节各掉 1 个**
   * （原版如此，所以高海带/高甘蔗一次能收一把）。
   *
   * 顺带唤醒流体：海带占的那一格本来是水，拔掉之后水里多了一个洞，
   * 不唤醒的话那一格会一直空着（原版里海水会立刻合上）。甘蔗不在水里，唤醒了也无害。
   */
  private breakColumn(x: number, y: number, z: number, id: number): void {
    for (let oy = y; oy < 320; oy++) {
      if (this.world.getBlock(x, oy, z) !== id) break;
      this.world.setBlockAndUpdate(x, oy, z, Block.AIR);
      this.net.sendBlock(x, oy, z, Block.AIR, 0, this.dimension);
      this.particles.spawnBlockBreak(x + 0.5, oy + 0.5, z + 0.5, this.blockParticleColor(id));
      // 创造模式不产生掉落（与原版一致）
      if (this.isCreative) continue;
      const drop = dropFor(id);
      if (drop) this.spawnDrop(drop.id, drop.count, x + 0.5, oy + 0.5, z + 0.5);
    }
    this.wakeFluidsAround(x, y, z);
  }

  /** 拆掉整扇门（上下两半一起），整扇只掉落一次 */
  private breakDoorPair(x: number, y: number, z: number): void {
    const state = this.world.getBlockState(x, y, z);
    const baseY = isDoorUpper(state) ? y - 1 : y;

    for (let dy = 0; dy < 2; dy++) {
      const oy = baseY + dy;
      const id = this.world.getBlock(x, oy, z);
      // 上半格必须是同一种门（脏存档里可能只剩半扇）
      if (blockDef(id).shape !== 'door') continue;
      this.world.setBlockAndUpdate(x, oy, z, Block.AIR);
      this.net.sendBlock(x, oy, z, Block.AIR, 0, this.dimension);
      this.particles.spawnBlockBreak(x + 0.5, oy + 0.5, z + 0.5, this.blockParticleColor(id));
      if (this.isCreative || dy !== 0) continue;
      // 掉落**这一种**门（原来写死 `dropFor(Block.OAK_DOOR)`，加别的木材就会掉错东西）
      const drop = dropFor(id);
      if (drop) this.spawnDrop(drop.id, drop.count, x + 0.5, baseY + 0.5, z + 0.5);
    }
  }

  /** 生成一堆掉落物 */
  /**
   * 生成一堆掉落物。
   *
   * `extras`（批次 63）供"带着耐久/附魔/改名掉下来"的路径用（破坏容器、投掷器吐出）——
   * 不传就是普通白板（矿物、木棍、种子这些绝大多数掉落）。
   */
  private spawnDrop(
    itemId: number,
    count: number,
    x: number,
    y: number,
    z: number,
    extras?: DroppedExtras,
  ): void {
    this.entities.spawn(new ItemEntity(itemId, count, x, y, z, undefined, extras));
  }

  /** 丢出物品时离玩家多远（格）：要大于拾取范围（碰撞盒 0.6 + 0.7 ≈ 1.0） */
  private static readonly DROP_AHEAD = 1.5;

  /**
   * 把物品丢在**玩家身前一点**（批次 161）。
   *
   * ⚠️ 原来丢的位置就是玩家自己脚下（`physics.x / y+1.2 / z`）：掉落物有 0.5 秒
   * 拾取冷却，一过就被"站在原地的自己"吸回背包——玩家的观感是"点了丢出，东西没了"。
   * 往前推 1.5 格就落到了拾取范围之外（那圈范围是碰撞盒外扩 0.7）。
   * 朝向用视角那条唯一口径（`lookDirection` 的水平分量），不另抄一份三角函数。
   */
  private dropInFrontOfPlayer(itemId: number, count: number): void {
    const [dirX, , dirZ] = PlayerPhysics.lookDirection(this.yaw, this.pitch);
    // 只取水平分量并归一：抬头/低头时水平长度会变短，不归一的话丢不远
    const length = Math.hypot(dirX, dirZ) || 1;
    const ahead = App.DROP_AHEAD;
    const x = this.physics.x + (dirX / length) * ahead;
    const z = this.physics.z + (dirZ / length) * ahead;
    this.spawnDrop(itemId, count, x, this.physics.y + 1.0, z);
  }

  /**
   * 生物生成与消失。
   * 生成只发生在已加载区块（未加载时 getBlock 返回空气，规则会自然拒绝），
   * 因此不需要额外的"是否加载"判断也不会刷到虚空中。
   */
  /**
   * 失眠与幻翼（批次 126）。
   *
   * 判据全在 `survival/Insomnia.ts`（纯函数）：**连着三天没睡 + 夜里 + 这一夜还没派过**。
   * 满足之后每 25 秒试一次，而且要求玩家**头顶见天**（天光 15）——
   * 原版幻翼是从天上下来的，所以"躲在洞里挖矿"是安全的，"在地表搭棚子"不是
   * （它们会俯冲下来，棚子挡不住）。
   *
   * ⚠️ 这是本项目**第一条"与地形无关、只跟玩家状态有关"的刷怪**，所以它没有走
   * `MobSpawner`（那套是按列扫地表找落脚点）——直接由主程序在玩家上方放几只。
   */
  private updateInsomnia(dt: number): void {
    if (this.dimension !== Dimension.OVERWORLD) return;
    if (!phantomNightIsComing(this.daysWithoutSleep, isNight(this.timeOfDay), this.phantomSpawnedTonight)) {
      return;
    }
    // 头顶见天才会来：洞里、棚子下都不是 15
    const headY = Math.floor(this.physics.y + 1.2);
    if (this.world.getSkyLight(Math.floor(this.physics.x), headY, Math.floor(this.physics.z)) < FULL_SKY_LIGHT) {
      return;
    }

    this.phantomTimer += dt;
    if (this.phantomTimer < PHANTOM_SPAWN_INTERVAL) return;
    this.phantomTimer = 0;
    this.phantomSpawnedTonight = true;

    const count = phantomSpawnCount(this.daysWithoutSleep);
    for (let i = 0; i < count; i++) {
      // 围着玩家摆一圈（它们一开场就在你头顶盘旋，见 `Phantom` 的 AI）
      const angle = (i / count) * Math.PI * 2;
      const x = this.physics.x + Math.cos(angle) * 6;
      const z = this.physics.z + Math.sin(angle) * 6;
      const y = Math.min(WORLD_MAX_Y - 4, this.physics.y + 22);
      this.entities.spawn(createMob(PHANTOM_TYPE, x, y, z));
    }
    this.chat.push(`你已经连着 ${this.daysWithoutSleep} 天没合眼了……天上有东西在叫。`, 'system');
  }

  private updateMobSpawning(dt: number): void {
    let hostileCount = 0;
    let passiveCount = 0;
    const player = { x: this.physics.x, y: this.physics.y, z: this.physics.z };

    for (const entity of this.entities.all) {
      if (!(entity instanceof Mob)) continue;
      if (entity.type.hostile) {
        hostileCount++;
        // 敌对生物离玩家太远就消失，避免远处无限堆积。
        // ⚠️ **boss 不消失**（批次 116）：玩家跑远一趟回来发现凋灵没了、星星也拿不到，
        // 那是事故（末影龙一直也有这个问题，这条顺手一起修了，见 `MobType.boss`）
        if (
          entity.type.boss !== true &&
          Math.hypot(entity.x - player.x, entity.z - player.z) > MOB_DESPAWN_DISTANCE
        ) {
          entity.dead = true;
        }
      } else {
        passiveCount++;
      }
    }

    // doMobSpawning 关掉后连刷怪逻辑都不跑（刷怪笼与 /summon 不受影响）
    if (!this.rules.doMobSpawning) return;

    const ctx: SpawnContext = {
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      // 天光要按昼夜折算：我们的光照引擎里地表天光恒为 15，
      // 不折算的话夜晚地表永远刷不出怪（原版夜里是会刷的）
      getSkyLight: (x, y, z) => this.world.getSkyLight(x, y, z) * this.solidMaterial.skyBrightnessValue,
      getBlockLight: (x, y, z) => this.world.getBlockLight(x, y, z),
      // 地表高度走高度图（C6）：被动刷怪原来每 2 秒要扫掉几千次 getBlock
      getSurfaceBlockY: (x, z) => this.world.getSurfaceBlockY(x, z),
      player,
      // 维度（批次 94）：只刷"这个维度会刷"的生物（恶魂只在下界、村民不刷……）
      dimension: this.dimension,
      spawn: (type, x, y, z) => {
        this.entities.spawn(createMob(type, x, y, z));
      },
      hostileCount,
      passiveCount,
      // "这一列在不在某个区域里"（批次 115 要塞 / 批次 120 史莱姆区块）：
      // 两者都是"算出来的"，只有主程序答得上来，见 `inZone`
      inZone: (kind, x, z) => this.inZone(kind, x, z),
      // "这一列是什么群系"（批次 124，尸壳只要沙漠）：同样是"算出来的"，
      // 只有主程序答得上来（它拿着种子与生成器，见 `biomeNameAt`）
      biomeAt: (x, z) => this.biomeNameAt(x, z),
      // 月亮相位影响史莱姆的刷怪密度（批次 120）：`MoonPhase` 里那个函数一直等着史莱姆
      spawnWeightScale: (type) =>
        type.spawnZone === 'slime_chunk' ? this.slimeSpawnFactorNow() : 1,
    };
    this.mobSpawner.update(dt, ctx);
  }

  /**
   * 这一列在不在某种结构里（批次 115，凋灵骷髅只要塞）。
   *
   * 要塞的位置是**算出来**的（与 Worker 用同一份公式），而"算"需要下界的
   * 洞顶/地板/群系——只有 `NetherGenerator` 答得上来。所以这里**懒建一个并留着**：
   * 本模块里带状态的东西越少越好，但每 2 秒 new 一个生成器显然是更糟的选择。
   *
   * ⚠️ 只在"真的抽到了那只会结构限定的生物"时才走到这里（`MobSpawner` 里先筛维度、
   * 再抽种类、最后才问结构），所以那点噪声开销落在每两秒一次的概率上。
   */
  /**
   * 脚下是粘液块吗、该弹多高（批次 120）。
   *
   * 三个容易踩的地方，都写在这里：
   *  1. **读 `lastLandingSpeed` 而不是 `p.vy`**：落地那一瞬间物理层已经把 `vy` 清零了，
   *     读 `p.vy` 会永远得到 0（"看起来对、其实永远不弹"）；
   *  2. **它是一次性的**：读完就清掉——站在粘液块上不动时，`onGround` 每帧都真，
   *     不清的话会拿同一份旧速度反复弹（人会在原地抖）；
   *  3. **弹跳的数值算在 `world/Slime.ts`**（`slimeBounceVelocity` 是纯函数，
   *     所以"多高会弹、多慢就不弹"能在离线测试里断言）。
   */
  private slimeBounce(): number {
    const p = this.physics;
    if (p.lastLandingSpeed <= 0) return 0;
    const speed = p.lastLandingSpeed;
    p.lastLandingSpeed = 0;
    const below = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    if (below !== Block.SLIME_BLOCK) return 0;
    return slimeBounceVelocity(-speed);
  }

  private inZone(kind: string, x: number, z: number): boolean {
    if (kind === 'slime_chunk') return isSlimeChunk(this.worldConfig.seed, x, z);
    if (kind !== 'nether_fortress') return false;
    this.netherStructureWorld ??= new NetherGenerator(this.worldConfig.seed).structureWorld();
    return fortressAt(x, z, this.worldConfig.seed, this.netherStructureWorld) !== null;
  }

  /** 当前月相的史莱姆刷怪倍率（批次 120）：`MoonPhase` 里那个函数一直等着史莱姆 */
  private slimeSpawnFactorNow(): number {
    return slimeSpawnFactor(moonPhaseFor(this.dayCount));
  }

  /**
   * 生物对玩家造成伤害：结算生命值并施加击退。
   * 创造模式（飞行）免疫；无敌帧由 PlayerStats 判断。
   */
  private damagePlayer(amount: number, sourceX: number, sourceZ: number, cause: DamageCause = 'generic'): void {
    // 触觉反馈：受击用"双短震"区分于放方块的轻震
    if (amount > 0) this.vibrate([18, 40, 18]);
    if (amount > 0) this.audio.play(this.stats.health <= 0 ? 'death' : 'hurt');
    if (this.isCreative) return;
    // 难度倍率：和平难度下生物不造成伤害（原版和平难度敌对生物根本不生成）
    const damage = amount * difficultyProfile(this.difficulty).mobDamage;
    if (damage <= 0) return;
    // 状态效果（抗性提升）在统一入口里叠加
    const before = this.stats.health;
    this.applyIncomingDamage(damage, cause);
    const result = { applied: before - this.stats.health };
    if (result.applied <= 0) return;

    // 挨打就会被从床上拽起来（原版：睡觉时受伤会惊醒）
    this.interruptSleep();

    // 沿"伤害来源 → 玩家"方向击退
    const dx = this.physics.x - sourceX;
    const dz = this.physics.z - sourceZ;
    const length = Math.hypot(dx, dz) || 1;
    this.physics.vx += (dx / length) * 6;
    this.physics.vz += (dz / length) * 6;
    this.physics.vy = Math.max(this.physics.vy, 4.2);
    this.physics.onGround = false;
  }

  /**
   * 爆炸（苦力怕、将来的 TNT 都走这里）。
   *
   * 三件事：伤害与击退玩家（按距离衰减）、粒子与音效、炸掉范围内的方块。
   * **炸地形受 `mobGriefing` 规则控制**：关掉之后爆炸只伤人、不留坑。
   * 基岩与黑曜石免疫（原版行为）。
   */
  private explodeAt(x: number, y: number, z: number, power: number): void {
    this.audio.play('explode', { x, y, z });
    this.particles.spawnSmoke(x, y + 0.5, z, Math.round(40 * (power / 3)), 0.7);
    // 橙白色的闪光碎片（E22）：只有灰烟的话，爆炸看起来像"冒了一团烟"，没有"炸"的那一下
    this.particles.spawnExplosion(x, y + 0.5, z, power);

    // ---- 玩家伤害：半径 = power * 1.4，越远越轻
    const radius = power * 1.4;
    const px = this.physics.x;
    const py = this.physics.y + 0.9;
    const pz = this.physics.z;
    const distance = Math.hypot(px - x, py - y, pz - z);
    if (distance < radius) {
      const falloff = 1 - distance / radius;
      // 贴脸约 20 点（原版普通难度苦力怕在同距离差不多是这个量级）
      this.damagePlayer(Math.max(1, Math.round(20 * falloff * falloff)), x, z, 'explosion');
    }

    if (!this.rules.mobGriefing) return;

    // ---- 炸方块：球形范围，只炸得动"能被炸掉"的方块
    const r = Math.ceil(power);
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const cz = Math.floor(z);
    let broken = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy + dz * dz > power * power) continue;
          const bx = cx + dx;
          const by = cy + dy;
          const bz = cz + dz;
          const id = this.world.getBlock(bx, by, bz);
          if (id === Block.AIR) continue;
          if (id === Block.BEDROCK || id === Block.OBSIDIAN) continue;
          // TNT（批次 56）：爆炸范围内的 TNT 是**被点燃**而不是被炸掉的（原版行为），
          // 于是"一片 TNT"会像多米诺骨牌一样挨个炸开（串联反应）
          if (id === Block.TNT) {
            this.primedTnt.prime(this.tntWorld, bx, by, bz);
            continue;
          }
          if (this.world.setBlockAndUpdate(bx, by, bz, Block.AIR)) {
            broken++;
            // 炸掉脚下那格，上面的植物同样该掉（批次 78，B49）：与玩家破坏走同一个收尾
            this.sweepUnsupportedAbove(bx, by + 1, bz);
            // 墙被炸掉时，挂在上面的展示框与画也跟着掉（B14，批次 86）
            this.sweepHangings(bx, by, bz);
            // 炸完要唤醒周围的水（挖掉水底会让水重新流）
            this.wakeFluidsAround(bx, by, bz);
          }
        }
      }
    }
    this.explosionBlocks += broken;
  }

  /** 推进所有实体并同步到渲染层 */
  private updateEntities(dt: number): void {
    const context: EntityContext = {
      world: this.world,
      playerBox: this.physics.box(),
      // 批次 63：拾取要连附加数据一起收（原先只收 id + 数量 → "附魔镐掉地上捡起来变白板"）
      pickup: (itemId, count, extras) => this.inventory.addStack({ id: itemId, count, ...extras }),
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      player: { x: this.physics.x, y: this.physics.y, z: this.physics.z },
      hurtPlayer: (amount, sourceX, sourceZ, cause) => this.damagePlayer(amount, sourceX, sourceZ, cause),
      // 蜘蛛在亮处中立（批次 93）：亮度取"方块光与折算后的天光"的较大者，
      // 与刷怪判据同一套折算（天光要按昼夜折算，否则夜里也算 15 → 蜘蛛永不打人）
      lightAt: (x, y, z) =>
        Math.max(
          this.world.getBlockLight(x, y, z),
          Math.round(this.world.getSkyLight(x, y, z) * this.solidMaterial.skyBrightnessValue),
        ),
      // 洞穴蜘蛛的中毒（批次 93）：实体层只报"该中毒了"，时长与免疫归生存模块。
      // 走的是玩家状态效果那一套（`/effect` 与药水同一条路），所以"中毒不掉到死"
      // 与"蜘蛛眼/牛奶能解"这些既有规则自动生效
      afflictPlayer: (effect, seconds) => {
        this.effects.apply(effect, seconds, 0);
      },
      // 末影人被注视激怒（批次 112）：实体层拿不到相机，所以由这里回答"玩家在看哪"
      playerGazeAt: (x, y, z) => this.playerGazeAt(x, y, z),
      // 末影人淋雨（批次 112）：天光是"露天"的判据，与火焰被雨浇灭同源
      skyLightAt: (x, y, z) => this.world.getSkyLight(x, y, z),
      // 末影珍珠落地（批次 113）：实体层只报"珍珠落在哪"，传人 + 摔落伤害在这里做
      teleportPlayer: (x, y, z) => this.teleportByEnderPearl(x, y, z),
      // 末影之眼碎掉（批次 114）：紫色涡旋（与传送门/末影箱/珍珠传送同一套粒子）
      spawnPortalParticles: (x, y, z, count, spread) => this.particles.spawnPortal(x, y, z, count, spread),
      // 僵尸猪灵的**群体激怒**（批次 122）：同类挨打，半径内的同伴一起翻脸。
      // 这一扫必须由主程序做——实体层没有"周围有谁"的视野（见 `EntityContext.provokeNearby`）
      provokeNearby: (x, y, z, radius, typeId) => {
        // "该惊动谁"是纯函数（`provokedBy`）：只算同种、按三维距离、跳过已死的——
        // 那三条都值得离线断言，写在主程序里就只能靠肉眼看了
        const mobs = this.entities.all.filter((entity): entity is Mob => entity instanceof Mob);
        for (const mob of provokedBy(mobs, x, y, z, radius, typeId)) mob.provoke();
      },
      // 史莱姆分裂（批次 120）：按**种类 id** 放一只出来——实体层不能引生物表（会成环），
      // 所以由这里查表；不与 `spawnBaby` 合用是因为那个会 `makeBaby()`（分裂出的不是幼崽）
      spawnMob: (typeId, x, y, z) => {
        const type = mobTypeById(typeId);
        if (!type) return;
        this.entities.spawn(createMob(type, x, y, z));
        this.particles.spawnFlame(x, y + 0.2, z, 0x8fdc5a, 6);
        this.audio.play('step', { x, y, z });
      },
      // 凋灵吐骷髅头（批次 116）：与火球走同一条通道（它也是 `Throwable` 里的一档）
      //（`itemId` 给的是那颗头的方块 id：渲染器会按 kind 换成骷髅头那两张贴图，
      //  这个 id 只是"万一走到通用分支时别渲染成一团空白"的兜底，与小火球传烈焰粉同一条）
      spawnWitherSkull: (x, y, z, velocity, blue) =>
        this.spawnThrowable(
          x,
          y,
          z,
          velocity,
          blue ? 'wither_skull_blue' : 'wither_skull',
          Block.WITHER_SKELETON_SKULL,
        ),
      // 下雨（下雪也算）：原版的雨只下在主世界，所以这里带上维度
      raining: this.weather.raining && this.dimension === Dimension.OVERWORLD,
      // 箭矢命中生物：实体层不持有生物列表，所以由这里从实体管理器里查
      hitMob: (box) => {
        for (const entity of this.entities.all) {
          if (entity instanceof Mob && !entity.dead && entityIntersectsBox(entity, box)) return entity;
        }
        return null;
      },
      playSound: (kind, x, y, z) => this.audio.play(kind, { x, y, z }),
      explode: (x, y, z, power) => this.explodeAt(x, y, z, power),
      spawnDrop: (itemId, count, x, y, z) => this.spawnDrop(itemId, count, x, y, z),
      // 骷髅射箭与玩家走完全同一条路径，两边不会各自漂移
      // 骷髅射箭走与玩家完全同一条路径，两边不会各自漂移
      spawnArrow: (x, y, z, velocity, options) => {
        this.spawnArrow(x, y, z, velocity, options);
      },
      // 繁殖（J8）：找配偶与生成幼体都由主程序操刀——生物不持有实体列表
      findMate: (mob) => this.findMate(mob),
      // 拿着食物能把动物引过来（传函数，不传值：上下文是缓存住的）
      heldItemId: () => this.heldItemId,
      spawnBaby: (type, x, y, z) => {
        const baby = createMob(type, x, y, z);
        baby.makeBaby();
        this.entities.spawn(baby);
        // 原版生小动物有"噗"的一声，这里用一个短促的烟雾 + 移动音效代替
        this.audio.play('step', { x, y, z });
        this.particles.spawnSmoke(x, y + 0.3, z, 6, 0.28);
        // 进度（M7）：繁殖（喂两只同类生幼崽）
        this.reportProgress({ kind: 'breed', mob: type.id });
      },
      spawnHearts: (x, y, z, scale) => this.particles.spawnHearts(x, y, z, scale),
      // 记账（球吸到手时）与生成（生物死亡）是两个钩子，见 `XpOrb` / `EntityContext`
      awardXp: (amount) => this.awardXp(amount),
      spawnXpOrbs: (amount, x, y, z) => this.spawnXpOrbs(amount, x, y, z),
      // 鸡蛋砸出小鸡（K4 尾巴）：与 `spawnBaby` 同一个套路，只是不走求爱那一套
      hatchChicken: (x, y, z) => {
        const chicken = mobTypeById('chicken');
        if (!chicken) return;
        const baby = createMob(chicken, x, y, z);
        baby.makeBaby();
        this.entities.spawn(baby);
        this.particles.spawnSmoke(x, y + 0.2, z, 6, 0.24);
      },
      // 喷溅药水的范围结算（K4 尾巴）：实体层只报"在哪炸了"，周围有谁得问这里
      applySplash: (potionId, x, y, z) => this.applySplash(potionId, x, y, z),
      // 滞留药水摔碎 → 原地留一片云；末影龙吐息 → 吐一团血息云
      spawnLingering: (potionId, x, y, z) => this.spawnLingeringCloud(potionId, x, y, z),
      spawnDragonBreath: (x, y, z) => this.spawnDragonBreathCloud(x, y, z),
      // 烈焰人的小火球（批次 92）：与投掷物走同一条通道（它就是 `Throwable` 里的一档），
      // `itemId` 只用于兜底贴图（有专门的渲染分支，见 `EntityRenderer`）
      spawnSmallFireball: (x, y, z, velocity) =>
        this.spawnThrowable(x, y, z, velocity, 'small_fireball', Item.BLAZE_POWDER),
      // 恶魂的大火球（批次 94）：同一个通道，另一档。它与小火球的区别在**结算**那一层
      // （命中要炸开一片，见 `Throwable.impact`），所以是两个钩子而不是一个带参数的
      spawnLargeFireball: (x, y, z, velocity) =>
        this.spawnThrowable(x, y, z, velocity, 'large_fireball', Item.BLAZE_POWDER),
      // 溺尸扔三叉戟（批次 123）：与玩家扔的是**同一档**投掷物（`'trident'`），
      // 差别只在 `fromPlayer: false`——于是它砸玩家而不是砸生物
      spawnTrident: (x, y, z, velocity) =>
        this.spawnThrowable(x, y, z, velocity, 'trident', Item.TRIDENT, undefined, false),
      // 火球命中 → 点着玩家（伤害在投掷物那一层结算，点火是另一条路，见 `EntityContext`）
      ignitePlayer: (seconds) => this.stats.ignite(seconds),
      // 隐身（K4 尾巴）：敌对生物看不见你就不追（原版隐形后 8 格内还是会被发现，
      // 这里简化成"完全不追"，见 TASKS K4 的差异记录）
      playerInvisible: this.effects.invisible,
    };
    this.lastEntityContext = context;
    this.entities.update(context, dt);
    // 药水云在主循环里推进（不是实体）：`lastEntityContext` 刚更新过，
    // 所以云结算里伤到生物时用得上"掉落物要交给谁"这些回调
    this.updateClouds(dt);
    // 逐实体采样光照：洞里暗、火把旁亮
    const sampleLight = (x: number, y: number, z: number): { sky: number; block: number } | null => {
      if (!this.world.isLoaded(x, z)) return null;
      return { sky: this.world.getSkyLight(x, y, z), block: this.world.getBlockLight(x, y, z) };
    };
    this.entityRenderer.update(this.entities.all, this.camera, dt, sampleLight);

    const mobs: Mob[] = [];
    for (const entity of this.entities.all) {
      if (entity instanceof Mob) {
        // 站在火里的生物会被点燃（I12）：原版生物走进火里同样会烧起来。
        // 放在这一层（而不是 Mob 内部）是因为"当前这一格是不是火"要读世界
        if (!entity.dead) {
          if (this.mobInFire(entity)) entity.ignite(FIRE_IGNITE_SECONDS);
          // **亡灵被太阳晒**（批次 124）：露天（头顶天光 15）+ 白天 + 没下雨 → 点着 8 秒。
          // 判据在纯函数里（`world/Daylight.ts`），而**尸壳故意没写** `burnsInDaylight`
          // ——它就是这么在沙漠里白天活动的（这一条是尸壳那一批的前置）
          if (
            sunBurns(entity.type.burnsInDaylight, {
              skyLight: this.world.getSkyLight(
                Math.floor(entity.x),
                Math.floor(entity.y + entity.height),
                Math.floor(entity.z),
              ),
              isDay: !isNight(this.timeOfDay),
              raining: this.weather.raining,
            })
          ) {
            entity.ignite(DAYLIGHT_BURN_SECONDS);
          }
          // 岩浆块（批次 121）：站在上面每秒 1 点火焰伤害——原版如此，
          // 所以岩浆块能当刷怪塔里那把"刀"（抗火的岩浆怪反而不掉血）
          entity.tickMagmaBlock(context, this.standsOnMagmaBlock(entity.x, entity.y, entity.z), dt);
        }
        mobs.push(entity);
      }
    }
    // 联机队友也交给同一个渲染器（只是不进 EntityManager，不跑 AI 与物理）
    for (const mob of this.remotePlayers.values()) mobs.push(mob);
    this.mobRenderer.update(mobs, this.camera, dt, sampleLight);
    this.updateEndBoss();
    this.updateMobSpawning(dt);
    // 失眠（批次 126）：连着几夜不睡，天上就会有东西开始叫
    this.updateInsomnia(dt);
    // 红石：按钮回弹、中继器延迟、压力板轮询都由它推进
    //
    // ⚠️ 引信推进（TNT）用**真实 dt**（不夹到 0.1）：卡顿一下就要真的少 4 秒引信，
    // 否则一次长卡顿会让 TNT 多闪好一会儿（红石那边夹 dt 是因为它是逻辑结算，
    // 而这里是"时间流逝"。两条不同的取舍，写在各自旁边）
    const tntDt = Math.min(dt, 0.5);
    this.primedTnt.update(tntDt, this.tntWorld, (x, y, z, power) => this.explodeAt(x, y, z, power));
    this.redstone.tick(this.redstoneWorld, Math.min(dt, 0.1));
  }

  /**
   * 验收脚本用：执行一行命令或发言，并返回消息栏里的全部文字。
   * 走的是与输入框完全相同的路径（`handleChatSubmit`），因此测到的就是真实行为。
   */
  runCommand(text: string): string[] {
    this.handleChatSubmit(text);
    return this.chat.messageLines;
  }

  /**
   * 验收脚本用：强制显示某个阶段的破坏裂纹（-1 = 恢复正常逻辑）。
   * 有了它就能在不真正挖掘的情况下截图对比"有裂纹/没裂纹"。
   */
  forceDamageStage(stage: number): void {
    this.forcedDamageStage = stage;
  }

  /** 验收脚本用：打开聊天输入框（模拟按 T） */
  openChatForTest(prefill = ''): boolean {
    this.chat.openWith(prefill);
    return this.chat.isOpen;
  }

  /** 验收脚本用：直接打开/关闭配方书 */
  toggleRecipeBookForTest(): boolean {
    this.toggleRecipeBook();
    return this.recipeBook.isOpen;
  }

  /**
   * 验收脚本用：打开/关闭成就面板（M7）。
   *
   * 手机上没有键盘，所以脚本要能绕开按键直接开面板——与 `toggleRecipeBookForTest`
   * 一个道理：**验收要能测到那条路径，就得有个不依赖键鼠的入口**。
   */
  toggleAdvancementsForTest(): boolean {
    this.toggleAdvancements();
    return this.advancementScreen.isOpen;
  }

  /**
   * 验收脚本用（J11）：最近的村民是谁、现在能做什么。
   *
   * 手机上的验收脚本没法"用准星对准村民再点一下"，所以要有一个**不依赖瞄头**的入口
   * （与 `toggleRecipeBookForTest` 同一个理由）。
   */
  villagerNearby(maxDistance = 16): {
    id: number;
    distance: number;
    profession: string | null;
    level: number;
    xp: number;
    offers: Array<{ result: number; count: number; uses: number; maxUses: number }>;
  } | null {
    let best: Villager | null = null;
    let bestDistance = Infinity;
    for (const entity of this.entities.all) {
      if (!(entity instanceof Villager) || entity.dead) continue;
      const distance = Math.hypot(entity.x - this.physics.x, entity.z - this.physics.z);
      if (distance > maxDistance || distance >= bestDistance) continue;
      best = entity;
      bestDistance = distance;
    }
    if (!best) return null;
    return { id: best.id, distance: bestDistance, ...best.tradeSummary };
  }

  /** 验收脚本用（J11）：打开最近那个村民的交易界面（不必瞄准） */
  openTradeNearbyForTest(maxDistance = 16): boolean {
    for (const entity of this.entities.all) {
      if (!(entity instanceof Villager) || entity.dead) continue;
      if (Math.hypot(entity.x - this.physics.x, entity.z - this.physics.z) > maxDistance) continue;
      this.inventoryScreen.openTrade(entity);
      return this.inventoryScreen.currentMode === 'trade';
    }
    return false;
  }

  /** 验收脚本用（J11）：替最近的村民成交第 `index` 条交易（返回是否成交） */
  tradeNearbyForTest(index: number, maxDistance = 16): boolean {
    for (const entity of this.entities.all) {
      if (!(entity instanceof Villager) || entity.dead) continue;
      if (Math.hypot(entity.x - this.physics.x, entity.z - this.physics.z) > maxDistance) continue;
      return this.performTrade(entity, index);
    }
    return false;
  }

  /** 验收脚本用（J11）：直接让最近的村民认领某一种职业（省掉"摆工作站再等他扫"） */
  employNearbyVillagerForTest(professionId: string, maxDistance = 16): boolean {
    for (const entity of this.entities.all) {
      if (!(entity instanceof Villager) || entity.dead) continue;
      if (Math.hypot(entity.x - this.physics.x, entity.z - this.physics.z) > maxDistance) continue;
      const ok = entity.assignProfession(professionId as Parameters<Villager['assignProfession']>[0], null);
      if (ok) {
        this.inventoryScreen.refresh();
        this.chat.push(`（调试）村民已认领职业：${levelName(entity.level)}`, 'system');
      }
      return ok;
    }
    return false;
  }

  /**
   * 验收脚本用：**直接授予**某条进度（不走触发条件）。
   *
   * 用途有两个：把面板的三种状态（已达成/可达成/未解锁）都摆出来看一眼；
   * 以及"读档之后进度还在不在"这类断言（授予 → `saveNow()` → 读档 → 再查）。
   * 返回是否真的授予了（没这条 id 或已经达成过都是 false）。
   */
  grantAdvancementForTest(id: string): boolean {
    const granted = this.advancements.grant(id);
    if (granted) {
      const def = this.advancements.defs.find((item) => item.id === id);
      if (def) {
        this.advancementToast.push(def);
        this.chat.push(`进度已达成：${def.title}——${def.desc}`, 'system');
      }
      this.advancementScreen.refresh();
    }
    return granted;
  }

  /**
   * 验收脚本用（J22）：离玩家最近的那个村庄在哪。
   *
   * 村庄每 32 个区块（512 格）才有一个，手机上"自己走到一个村庄"可能要走十几分钟，
   * 所以给验收留一个"直接告诉你坐标"的口子——拿到坐标就能 `/tp` 过去看村民。
   *
   * ⚠️ 村庄的**坐标是算出来的**（`structureInstanceForTest`，与 Worker 里用的是同一份
   * 确定性放置逻辑），所以它和世界里真的有的那个村庄一定对得上；
   * 不这么做的话就要"扫一片地形找房子"，那是几十万次读方块。
   *
   * ⚠️ 试过把它改成动态 import（想让首屏少下一点）：**没省下来**——整个结构生成模块
   * 本来就在主包里（`OverworldGenerator` 那一路），切成动态反而多出一个小的分片。
   * 记在这里，免得下一个人再试一遍（体积的真实增量来自村庄内容本身，不是这个入口）。
   */
  nearestVillageForTest(maxCells = 4): { x: number; y: number; z: number; distance: number } | null {
    const generator = new OverworldGenerator(this.worldConfig.seed);
    // 单元网格的间距是 32 **区块** = 512 格
    const cellX = Math.floor(this.physics.x / 512);
    const cellZ = Math.floor(this.physics.z / 512);
    let best: { x: number; y: number; z: number; distance: number } | null = null;
    for (let dz = -maxCells; dz <= maxCells; dz++) {
      for (let dx = -maxCells; dx <= maxCells; dx++) {
        const instance = structureInstanceForTest(
          'village',
          cellX + dx,
          cellZ + dz,
          generator,
          this.worldConfig.seed,
        );
        if (!instance) continue;
        const distance = Math.hypot(instance.x - this.physics.x, instance.z - this.physics.z);
        if (!best || distance < best.distance) {
          best = { x: instance.x, y: instance.y, z: instance.z, distance };
        }
      }
    }
    return best;
  }

  /**
   * 验收脚本用（批次 114）：离玩家最近的那座**要塞**在哪。
   *
   * 与 `nearestVillageForTest` 是同一个用途、同一个理由（"找到它"这件事本身要走上
   * 十几分钟，验收等不起）——区别是要塞的坐标**不必起生成器**：它是地下结构，
   * 位置不看地形（见 `nearestStronghold`）。末影之眼飞的就是这一个点。
   */
  nearestStrongholdForTest(): { x: number; y: number; z: number; distance: number } | null {
    return nearestStronghold(this.worldConfig.seed, this.physics.x, this.physics.z);
  }

  /**
   * 验收脚本用（批次 116）：直接放一只凋灵出来。
   *
   * 走一遍真流程要"下界要塞里打凋灵骷髅凑 3 颗头（2.5% 掉率）"——自动化等不起，
   * 所以与"搭一座点亮的末地传送门"同一个用途。**召唤仪式**那条路另有
   * `buildWitherAltarForTest()`（它走的是与玩家摆放完全同源的那条判定）。
   */
  summonWitherForTest(distance = 8): { x: number; y: number; z: number } {
    const wither = createMob(WITHER_TYPE, this.physics.x + distance, this.physics.y + 6, this.physics.z);
    this.entities.spawn(wither);
    return { x: wither.x, y: wither.y, z: wither.z };
  }

  /** 验收脚本用：场上那只凋灵的状态（不在场时 null）——血条、阶段与护盾都读得到 */
  get witherState(): { health: number; phase: number; shielded: boolean } | null {
    const wither = this.aliveWither();
    if (!wither) return null;
    return { health: wither.health, phase: wither.phase, shielded: wither.shielded };
  }

  /**
   * 验收脚本用：在玩家旁边摆一套 **4 块灵魂沙 + 3 颗头**（摆完就会召唤）。
   *
   * ⚠️ 最后一颗头走的是"与玩家放置完全同一条路"（`trySummonWither`），
   * 所以它验的是真的那套判定，而不是脚本自己另判一遍。
   */
  buildWitherAltarForTest(): { x: number; y: number; z: number } {
    const x = Math.floor(this.physics.x) + 3;
    const y = Math.floor(this.physics.y);
    const z = Math.floor(this.physics.z);
    // T 形：横向三块沙 + 中间下面再一块
    for (let i = -1; i <= 1; i++) this.world.setBlockAndUpdate(x + i, y - 1, z, Block.SOUL_SAND, 0);
    this.world.setBlockAndUpdate(x, y - 2, z, Block.SOUL_SAND, 0);
    // 前两颗头直接写，最后一颗走召唤判定那条路（于是它会真的触发召唤）
    for (let i = -1; i <= 0; i++) this.world.setBlockAndUpdate(x + i, y, z, Block.WITHER_SKELETON_SKULL, 0);
    this.world.setBlockAndUpdate(x + 1, y, z, Block.WITHER_SKELETON_SKULL, 0);
    this.trySummonWither(x + 1, y, z);
    return { x, y, z };
  }

  /**
   * 验收脚本用（K5，批次 117）：在玩家旁边搭一座信标 + **指定等级**的金字塔。
   *
   * 走一遍真流程要凑 5 块玻璃 + 3 块黑曜石 + 1 颗下界之星（先打凋灵）+ 若干矿物块，
   * 自动化验收等不起；而"光柱亮不亮、界面能不能选、效果挂没挂上"正是要人看的地方。
   * @param level 金字塔几级（0 = 只放信标，用来验"没有底座时不工作"）
   */
  buildBeaconForTest(level = 4): { x: number; y: number; z: number } {
    const x = Math.floor(this.physics.x) + 4;
    const y = Math.floor(this.physics.y) + 6;
    const z = Math.floor(this.physics.z);
    for (let layer = 1; layer <= level; layer++) {
      for (let dz = -layer; dz <= layer; dz++) {
        for (let dx = -layer; dx <= layer; dx++) {
          this.world.setBlockAndUpdate(x + dx, y - layer, z + dz, Block.IRON_BLOCK, 0);
        }
      }
    }
    this.world.setBlockAndUpdate(x, y, z, Block.BEACON, 0);
    // 登记进索引：光柱下一刻就会亮（走的是与"玩家自己放下"同一条路）
    this.noteBeacon(x, y, z);
    return { x, y, z };
  }

  /** 验收脚本用：某座信标现在的等级与选中的效果（那一格不是信标时 null） */
  beaconStateAt(x: number, y: number, z: number): { level: number; primary: number; regen: boolean } | null {
    if (this.world.getBlock(x, y, z) !== Block.BEACON) return null;
    const state = this.world.getBlockState(x, y, z);
    return {
      level: beaconLevel(this.world, x, y, z),
      primary: beaconPrimary(state),
      regen: beaconRegen(state),
    };
  }

  /** 验收脚本用：信标索引与光柱的现状（索引里几个、这一帧画了几根） */
  get beaconDebug(): { known: number; beams: number } {
    return { known: this.beacons.size, beams: this.beaconBeamRenderer.count };
  }

  /**
   * 验收脚本用（批次 126）：把"几天没睡"直接设成 N。
   *
   * 走一遍真流程要**连着三个游戏日不睡觉**（每个游戏日 20 分钟），自动化等不起；
   * 而"天上会不会下来东西"正是要人看着的东西。
   */
  setInsomniaForTest(days: number): void {
    this.daysWithoutSleep = Math.max(0, Math.floor(days));
    this.phantomSpawnedTonight = false;
    this.phantomTimer = 0;
  }

  /** 验收脚本用：失眠现状（几天没睡 / 这一夜派过没有 / 场上几只幻翼） */
  get insomniaState(): { days: number; spawnedTonight: boolean; phantoms: number } {
    let phantoms = 0;
    for (const entity of this.entities.all) {
      if (entity instanceof Mob && entity.type.id === PHANTOM_TYPE.id && !entity.dead) phantoms++;
    }
    return { days: this.daysWithoutSleep, spawnedTonight: this.phantomSpawnedTonight, phantoms };
  }

  /** 验收脚本用：清空全部进度（做完验收别把"考试答案"留在存档里） */
  resetAdvancementsForTest(): void {
    this.advancements.clear();
    this.advancementScreen.refresh();
  }

  /** 验收脚本用：模拟鼠标悬停在某个快捷栏槽位上，检查提示框内容 */
  hoverHotbarForTest(pointerX: number, pointerY: number, slotIndex: number): string {
    const slot = this.hotbarSlots[slotIndex];
    if (!slot) return '';
    const rect = slot.getBoundingClientRect();
    slot.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: pointerX || rect.left + rect.width / 2,
        clientY: pointerY || rect.top + rect.height / 2,
      }),
    );
    return this.tooltip.text;
  }

  // ---------------------------------------------------------------- 聊天与命令

  /** 聊天栏/命令输入共用的提交入口 */
  private handleChatSubmit(text: string): void {
    // 以 / 开头 = 命令；否则是普通发言
    if (text.startsWith('/')) {
      executeCommand(text, this.commandContext(), this.commandFeedback());
      return;
    }
    if (this.net.connected) this.net.sendChat(text);
    this.chat.push(`<${this.playerName}> ${text}`, 'player');
    this.chatLine = `<${this.playerName}> ${text}`;
    this.chatUntil = performance.now() + 8000;
  }

  /** 输入框打开/关闭：借背包那套"界面打开就停用移动与交互"的逻辑 */
  private handleChatOpen(open: boolean): void {
    this.handleInventoryOpen(open);
    // 打字时释放指针锁，否则鼠标动不了、点不到输入框
    if (open && document.pointerLockElement) document.exitPointerLock();
  }

  private commandFeedback(): CommandFeedback {
    return {
      info: (text) => this.chat.push(text, 'system'),
      error: (text) => this.chat.push(text, 'error'),
    };
  }

  /**
   * 命令的上下文实现。
   *
   * 命令逻辑本身在 `core/commands/Commands.ts`（不碰 DOM、可离线测），
   * 这里只把"玩家/世界/规则"这些真实对象包成它要的接口。
   */
  private commandContext(): CommandContext {
    return {
      playerName: () => this.playerName,
      position: () => ({
        x: this.physics.x,
        y: this.physics.y,
        z: this.physics.z,
        dimension: this.dimension,
      }),
      teleport: (x, y, z, dimension) => {
        if (dimension && dimension !== this.dimension) {
          if (dimension !== 'overworld' && dimension !== 'nether' && dimension !== 'end') return false;
          // setDimension 会清空区块并重新流式加载，之后再落坐标
          this.setDimension(dimension as DimensionId);
        }
        this.physics.teleport(x, y, z);
        this.physics.vx = 0;
        this.physics.vy = 0;
        this.physics.vz = 0;
        this.fallStartY = null;
        this.pendingFallDistance = 0;
        this.refreshWorld(toChunkCoord(x), toChunkCoord(z), true);
        return true;
      },
      give: (name, count) => {
        const id = resolveItemId(name);
        if (id === undefined) return -1;
        const remaining = this.inventory.add(id, count);
        this.refreshHotbar();
        this.inventoryScreen.refresh();
        return count - remaining;
      },
      clearInventory: () => {
        let slots = 0;
        for (let i = 0; i < TOTAL_SLOTS; i++) if (this.inventory.get(i)) slots++;
        this.inventory.clear();
        this.refreshHotbar();
        this.inventoryScreen.refresh();
        return slots;
      },
      setFlying: (on) => this.setFlying(on),
      isFlying: () => this.flying,
      setCreative: (on) => this.setGameMode(on ? 'creative' : 'survival'),
      isCreative: () => this.isCreative,
      killPlayer: () => {
        this.stats.damage(MAX_HEALTH * 10, 'generic');
      },
      seed: () => this.world.seed,
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      setBlock: (x, y, z, id) => {
        const ok = this.world.setBlockAndUpdate(x, y, z, id);
        if (ok) this.wakeFluidsAround(x, y, z);
        return ok;
      },
      fillBlocks: (x1, y1, z1, x2, y2, z2, id) => {
        let placed = 0;
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
          for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
              if (this.world.setBlockAndUpdate(x, y, z, id)) {
                placed++;
                this.wakeFluidsAround(x, y, z);
              }
            }
          }
        }
        return placed;
      },
      setTimeOfDay: (t) => {
        this.timeOfDay = ((t % 1) + 1) % 1;
      },
      timeOfDay: () => this.timeOfDay,
      setWeather: (kind) => this.weather.setKind(kind),
      difficulty: () => this.difficulty,
      setDifficulty: (value) => {
        this.difficulty = value;
        // 回写世界清单：下次进这个世界（还没保存过玩家数据时）也能拿到新难度
        this.onDifficultyChanged?.(value);
      },
      gameRules: () => this.rules,
      setGameRule: (key, value) => {
        this.rules[key] = value;
        // 昼夜循环这类规则同时写回设置（设置是"这台设备的默认"，规则是"这个世界的当前值"）
        if (key === 'doDaylightCycle') this.settings.daylightCycle = value as boolean;
      },
      // 世界边界（K12，批次 175）：改完立刻生效（蓝墙下一帧就在新位置），并进存档
      worldBorder: () => ({ ...this.border }),
      setWorldBorder: (patch) => {
        this.border = normalizeBorder({ ...this.border, ...patch });
        return { ...this.border };
      },
      summon: (name, x, y, z) => {
        const type = mobTypeById(name);
        if (!type) return false;
        this.entities.spawn(createMob(type, x + 0.5, y, z + 0.5));
        return true;
      },
      killNearby: (radius) => {
        let killed = 0;
        for (const entity of [...this.entities.all]) {
          if (!(entity instanceof Mob)) continue;
          if (Math.hypot(entity.x - this.physics.x, entity.z - this.physics.z) > radius) continue;
          entity.dead = true;
          killed++;
        }
        return killed;
      },
      applyEffect: (name, seconds, amplifier) => this.applyEffectByName(name, seconds, amplifier),
      clearEffects: () => this.effects.clear(),
      addXp: (amount) => this.experience.add(amount),
      setXpLevel: (level) => this.experience.setLevel(level),
      xpState: () => ({
        level: this.experience.level,
        progress: this.experience.progress,
        toNext: this.experience.toNext,
        total: this.experience.total,
      }),
      onlinePlayers: () => {
        const names = [`${this.playerName}(你)`];
        for (const player of this.net.remote.values()) names.push(player.name);
        return names;
      },
    };
  }

  /** `/effect` 的入口：按名字施加状态效果 */
  private applyEffectByName(name: string, seconds: number, amplifier: number): boolean {
    const id = resolveEffect(name);
    if (!id) return false;
    this.effects.apply(id, seconds, amplifier, true);
    this.resolveInstantEffects();
    this.chat.push(`获得效果：${effectLabel(id)}${amplifier > 0 ? ` ${romanLevel(amplifier)}` : ''}`, 'system');
    return true;
  }

  /** 瞬间效果（瞬间治疗/瞬间伤害）立即结算 */
  private resolveInstantEffects(): void {
    for (const instant of this.effects.takeInstant()) {
      if (instant.id === 'instant_health') {
        this.stats.heal(4 * (instant.amplifier + 1));
      } else if (instant.id === 'instant_damage') {
        this.applyIncomingDamage(6 * (instant.amplifier + 1), 'generic');
      }
    }
  }

  /**
   * 统一的外部伤害入口：先把状态效果的减伤算进去（抗性提升），
   * 然后交给 `PlayerStats` 走无敌帧。生物攻击、中毒、瞬间伤害都从这里进。
   */
  private applyIncomingDamage(amount: number, cause: DamageCause): void {
    const scaled = amount * this.effects.incomingDamageMultiplier();
    if (scaled <= 0) return;
    this.stats.damage(scaled, cause);
  }

  /**
   * 每 tick 推进随机刻与计划刻（20Hz 调用）。
   *
   * 随机刻只跑玩家周围一圈区块：原版是 128 格半径内所有 section，
   * 而我们一次加载 489 个区块，全跑一遍（每段 3 次）会有上万次采样。
   * 半径取 3 个区块（7×7 = 49 个区块）已经足够让"视野内的世界活着"。
   */
  private tickWorldBlocks(dt: number): void {
    // 1) 计划刻：流体等延迟处理
    for (const pos of this.scheduler.advance()) this.runScheduledTick(pos);

    // 2) 随机刻：数量由游戏规则 randomTickSpeed 控制（0 = 关闭）
    const speed = this.rules.randomTickSpeed;
    // 火焰浇灭要用"现在下不下雨"（I12）。放在 speed 判定之前，
    // 否则关掉随机刻时火焰连"被雨浇灭"都做不到（那是随机刻行为的一部分）
    this.tickWorld.raining = this.weather.raining;

    // 3) 区块级降水刻（批次 47）：**与 randomTickSpeed 无关**——
    // 它是天气的效果，不是"随机刻"，关掉随机刻（`/gamerule randomTickSpeed 0`）时
    // 依然应该下雪（原版也是两套独立机制）
    this.precipitation.tick(dt, this.physics.x, this.physics.y, this.physics.z);

    if (speed <= 0) return;

    const centerCx = toChunkCoord(this.physics.x);
    const centerCz = toChunkCoord(this.physics.z);
    for (let dz = -RANDOM_TICK_RADIUS; dz <= RANDOM_TICK_RADIUS; dz++) {
      for (let dx = -RANDOM_TICK_RADIUS; dx <= RANDOM_TICK_RADIUS; dx++) {
        const chunk = this.world.getChunk(centerCx + dx, centerCz + dz);
        if (!chunk) continue;
        this.randomTickChanges += randomTickChunk(
          this.tickWorld,
          { originX: chunk.cx * 16, originZ: chunk.cz * 16, sectionCounts: chunk.sectionCounts },
          speed,
          Math.random,
        );
      }
    }
  }

  /**
   * 一次流体流动刻（计划刻到期时调用）。
   * 玻璃后面的水管、瀑布、岩浆流都靠它一点点摊开。
   */
  private updateFluid(x: number, y: number, z: number): void {
    if (fluidTick(this.fluidWorld, x, y, z)) this.fluidChanges++;
    // 混凝土粉末遇到水就凝固（批次 131）：**水刚流动过**，所以"自己和六邻域"都查一遍
    // （水摊开到的位置可能正好挨着粉末；粉末不会在水的正下方，所以两边都要看）
    this.hardenConcreteAround(x, y, z);
  }

  /**
   * 玩家改动方块之后唤醒周围的流体（放水、挖掉水底会让水重新流）。
   * 放在破坏/放置的公共出口上，避免每个调用点都写一遍。
   */
  private wakeFluidsAround(x: number, y: number, z: number): void {
    wakeFluidAt(this.fluidWorld, x, y, z);
    // 混凝土粉末遇水凝固（批次 131）：这里是"玩家放了/挖了方块"的公共出口，
    // 所以"把粉末放在水边"这条路也在这里结算（原版也是放下去就凝固）
    this.hardenConcreteAround(x, y, z);
  }

  /**
   * 把 `(x, y, z)` 自己与六邻域里**挨着水的混凝土粉末**换成混凝土（批次 131）。
   *
   * 规则（哪六格算挨着、颜色怎么对应）全在 `core/world/Concrete.ts` 里，
   * 这里只提供"怎么写回世界"：走 `setBlockAndUpdate`——它会重网格化并更新光照，
   * 直接改数组的话玩家要盯着**凝固前那块**看到区块被重新网格化（看起来像"水浇了没反应"）。
   */
  private hardenConcreteAround(x: number, y: number, z: number): void {
    const hardened = hardenAround(
      {
        getBlock: (bx, by, bz) => this.world.getBlock(bx, by, bz),
        harden: (bx, by, bz, concrete) => {
          this.world.setBlockAndUpdate(bx, by, bz, concrete, 0);
          // 一簇白汽：原版凝固时也有一下"哧"的效果（音效见 M21）
          this.particles.spawnSmoke(bx + 0.5, by + 0.5, bz + 0.5, 4, 0.3);
        },
      },
      x,
      y,
      z,
    );
    if (hardened > 0) {
      this.audio.play('splash', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    }
  }

  /**
   * 计划刻到期的单个方块。
   * 目前只有流体（B8）会往队列里塞东西，所以这里是流体流动的入口。
   */
  private runScheduledTick(pos: ScheduledTick): void {
    if (pos.dimension !== this.dimension) return;
    this.updateFluid(pos.x, pos.y, pos.z);
  }

  /**
   * 右上角的状态效果列表。
   * 每帧重建 DOM 太浪费（会有十几种效果同时挂着），因此只在文字变化时重画。
   */
  private updateEffectsHud(): void {
    if (!this.effectsHudEl) return;
    // 签名用"整秒"而不是 tick：不然每秒会重画 20 次 DOM
    const signature = this.effects.all
      .map((effect) => `${effect.id}:${effect.amplifier}:${Math.ceil(effect.ticks / 20)}`)
      .join('|');
    if (signature === this.effectsHudSignature) return;
    this.effectsHudSignature = signature;

    const container = this.effectsHudEl;
    container.replaceChildren();
    for (const effect of this.effects.all) {
      const chip = document.createElement('div');
      chip.className = `effect-chip ${effectTone(effect.id)}`;
      const totalSeconds = Math.ceil(effect.ticks / 20);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const level = effect.amplifier > 0 ? ` ${romanLevel(effect.amplifier)}` : '';
      chip.textContent = `${effect.label}${level} ${minutes}:${String(seconds).padStart(2, '0')}`;
      container.appendChild(chip);
    }
  }

  /** 每 tick 结算状态效果（中毒伤害 / 生命恢复 / 饥饿 / 到期） */
  private tickEffects(): void {
    const result = this.effects.tick();
    if (result.damage > 0) {
      if (result.damageCause === 'poison') {
        // 中毒不会致死（原版会停在半颗心）
        this.stats.poisonDamage(result.damage);
      } else {
        this.applyIncomingDamage(result.damage, 'generic');
      }
    }
    if (result.heal > 0) this.stats.heal(result.heal);
    if (result.exhaustion > 0) this.stats.addExhaustion(result.exhaustion);
    if (result.food > 0 || result.saturation > 0) this.stats.eat(result.food, result.saturation);
  }

  /**
   * 打开配方书（背包里的按钮与 R 键都走这里）。
   *
   * ⚠️ 批次 132 起**不再先把背包关掉**：原版的配方书就是背包界面的一部分
   *（中文 Wiki「物品栏 → 配方书」：点一条配方，材料被摆进合成格，
   * 抬起头就能看见摆法）。原来关掉背包有两个坏处：
   *  ① "摆进合成格"这件事玩家根本看不见；
   *  ② 关界面会把格子里的东西倒回背包——刚摆好的立刻被清掉。
   */
  /**
   * 背包比配方书先构造（配方书要问"现在是 2×2 还是 3×3"），
   * 所以构造期那一次排布还没有配方书可问——这两个小包裹就是给它兜底的。
   */
  private isRecipeBookOpen(): boolean {
    return this.recipeBook ? this.recipeBook.isOpen : false;
  }

  /**
   * 同上：构造期还没有配方书可问，这几个小包裹统一兜底。
   *
   * ⚠️ 批次 159 在这里踩过一次——`applyInventoryChrome()` 在 `InventoryScreen` 的
   *    构造函数里就会跑一次（建造创造栏时），那时 `this.recipeBook` 还是 `undefined`，
   *    直接读 `this.recipeBook.onlyOwned` 就是
   *    "Cannot read properties of undefined (reading 'onlyOwned')"。
   *    **新增钩子时必须走这里**，别在钩子里直接摸 `this.recipeBook`。
   */
  private currentRecipeTab(): RecipeBookTab {
    return this.recipeBook ? this.recipeBook.currentTab : 'all';
  }

  private isRecipeOwnedOnly(): boolean {
    return this.recipeBook ? this.recipeBook.onlyOwned : false;
  }

  private setRecipeOwnedOnly(on: boolean): void {
    this.recipeBook?.setOnlyOwned(on);
  }

  private attachRecipeBook(host: HTMLElement | null): void {
    this.recipeBook?.attach(host);
  }

  private openRecipeBook(tab?: RecipeBookTab): void {
    // 背包没开着就顺手打开（原版的配方书本来就在背包界面里）
    if (!this.inventoryScreen.isOpen) this.inventoryScreen.openWith('inventory');
    // 携带版左上分类图标会带上 tab（批次 140）
    this.recipeBook.show(tab);
    // 配方书是左栏的内容：开完要让背包把左栏换成它（面板几何不变）
    this.inventoryScreen.syncRecipePane();
    this.handleInventoryOpen(true);
  }

  /** 收起配方书：背包左栏还回"我的物品" */
  private closeRecipeBook(): void {
    if (!this.isRecipeBookOpen()) return;
    this.recipeBook.hide();
    this.inventoryScreen.syncRecipePane();
  }

  /** R 键：开/关配方书。关掉时要把 uiOpen 交回给背包（背包可能还开着） */
  private toggleRecipeBook(): void {
    // 批次 166：创造模式不提供配方（拥有所有方块，看配方没有意义），R 键也不该开它
    if (this.isCreative) return;
    if (this.recipeBook.isOpen) {
      this.closeRecipeBook();
      this.handleInventoryOpen(this.inventoryScreen.isOpen);
      return;
    }
    // 批次 159：配方书不再嵌进背包左栏（左栏是**物品分类**）。
    // 背包已经开着时，R 键切的是左栏的分类视图——不然按一下就顶出一整屏配方书。
    if (this.inventoryScreen.isOpen) {
      this.inventoryScreen.toggleCategoryPane();
      return;
    }
    this.openRecipeBook();
  }

  /**
   * 配方书里点"合成"：直接对背包扣材料、给产物（不经过合成台界面）。
   * 成功后要给玩家一点反馈：刷新快捷栏 + 播一声轻响。
   */
  private craftFromBook(recipe: Recipe): boolean {
    const result = craftFromInventory(this.inventory, recipe);
    if (!result) return false;
    this.refreshHotbar();
    this.inventoryScreen.refresh();
    this.audio.play('click');
    return true;
  }

  /**
   * 配方书里**点一条配方**：把材料摆进合成格（批次 132，对齐原版）。
   *
   * ⚠️ 批次 136：**并排（经典 UI）时配方书不关**。原版的配方书就一直摊在物品栏
   * 旁边，点一条配方只是"把材料摆进合成格"，玩家接着还能点下一条；
   * 只有整屏（携带版 UI）时它盖着背包，才必须收起来露出刚摆好的格子。
   * 原来两种形态都关，与截图那种"配方书常驻在左边"的观感对不上。
   *
   * 与上面 `craftFromBook` 的分工：**这个才是原版的主交互**，
   * 那个"一键合成"留着给"能做 5 次"这类批量场景。
   */
  private fillFromBook(recipe: Recipe): boolean {
    if (!this.inventoryScreen.fillFromRecipe(recipe)) return false;
    // 背包还开着就让配方书留着（经典侧栏 / 携带版合成页都是并排，关掉会看不见摆法）
    if (this.inventoryScreen.isOpen) {
      this.recipeBook.render();
    } else {
      this.recipeBook.hide();
      this.handleInventoryOpen(false);
    }
    this.audio.play('click');
    return true;
  }

  /**
   * 手里那一件换成另一件（桶 ⇄ 装满的桶、瓶子 ⇄ 水瓶）。
   *
   * ⚠️ 与"消耗一个"不是一回事：这里要求**同类物品**，并且**数量要正确**——
   * 拿 16 个空桶去舀水，结果必须是"1 个水桶 + 15 个空桶"，而不是把 16 个都变成水桶。
   * 多出来的那件先塞回背包，塞不下就掉脚边（与拾取失败同一条处理）。
   */
  private exchangeHeld(consumeId: number, giveId: number): void {
    const slot = this.hotbarIndex;
    const stack = this.inventory.get(slot);
    if (!stack || stack.id !== consumeId) return;
    if (stack.count > 1) {
      this.inventory.set(slot, { ...stack, count: stack.count - 1 });
      const leftover = this.inventory.addStack({ id: giveId, count: 1 });
      if (leftover > 0) {
        this.spawnDrop(giveId, leftover, this.physics.x, this.physics.y + 1, this.physics.z);
      }
    } else {
      this.inventory.set(slot, { id: giveId, count: 1 });
    }
    this.refreshHotbar();
  }

  /**
   * 拿空桶对着**水源**右击：装成水桶 / 岩浆桶（批次 176，G13）。
   *
   * ⚠️ 只认**水源**（`fluidLevel === 0` 且不是瀑布那一节）——流水装不起来，这是原版规则，
   * 也是"拿桶舀河"与"拿桶舀流水"手感不同的根源（见 `world/Cauldron.ts` 的 `isBucketSource`）。
   */
  private fillBucketFrom(): boolean {
    if (this.heldItemId !== Item.BUCKET || !this.hit) return false;
    const { x, y, z } = this.hit;
    const blockId = this.world.getBlock(x, y, z);
    if (!isBucketSource(blockId, this.world.getBlockState(x, y, z))) return false;
    const fluid = bucketFluidAt(blockId);
    if (!fluid) return false;

    this.exchangeHeld(Item.BUCKET, fluid === 'water' ? Item.WATER_BUCKET : Item.LAVA_BUCKET);
    this.audio.play(fluid === 'water' ? 'splash' : 'flint', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    if (fluid === 'water') this.particles.spawnSplash(x + 0.5, y + 1, z + 0.5, 0x9fd4ff, 8);
    this.hand.swing();
    return true;
  }

  /**
   * 拿水桶 / 岩浆桶对着方块右击：在**贴着的那一格**放一格**水源**，桶变回空桶。
   *
   * 目标格沿用放置方块那套"命中面法线"（`hit.nx/ny/nz`），所以倒水的落点和放方块完全一致。
   * 只往**空气或液体**里倒（往石头里倒水没有意义，原版也会拒绝）。
   */
  private pourBucket(): boolean {
    const held = this.heldItemId;
    if ((held !== Item.WATER_BUCKET && held !== Item.LAVA_BUCKET) || !this.hit) return false;

    const target = {
      x: this.hit.x + this.hit.nx,
      y: this.hit.y + this.hit.ny,
      z: this.hit.z + this.hit.nz,
    };
    const existing = this.world.getBlock(target.x, target.y, target.z);
    const replaceable = existing === Block.AIR || existing === Block.WATER || existing === Block.LAVA;
    if (!replaceable) return false;

    const liquid = held === Item.WATER_BUCKET ? Block.WATER : Block.LAVA;
    // 状态 0 = **水源**：倒出去的永远是源头，不是"接着流"
    if (!this.world.setBlockAndUpdate(target.x, target.y, target.z, liquid, 0)) return false;

    // 创造模式不回收桶（原版也是"桶还在手里"），生存里变回空桶
    if (!this.isCreative) this.exchangeHeld(held, Item.BUCKET);
    this.audio.play(liquid === Block.WATER ? 'splash' : 'flint', {
      x: target.x + 0.5,
      y: target.y + 0.5,
      z: target.z + 0.5,
    });
    if (liquid === Block.WATER) this.particles.spawnSplash(target.x + 0.5, target.y + 1, target.z + 0.5, 0x9fd4ff, 10);
    else this.particles.spawnFlame(target.x + 0.5, target.y + 1, target.z + 0.5, 0xff9a1f, 4);
    this.hand.swing();
    return true;
  }

  /**
   * 炼药锅（批次 176，G13）：**水桶灌满 / 空桶从满锅舀 / 玻璃瓶舀一瓶**。
   *
   * 三条规则的判定全在 `world/Cauldron.ts`（纯函数），这里只负责"改方块 + 换手里的东西"。
   */
  private useCauldron(x: number, y: number, z: number): boolean {
    const state = this.world.getBlockState(x, y, z);
    const held = this.heldItemId;

    // ① 水桶 → 灌满（原版：一桶就是一整锅，不按"量"折算）
    if (held === Item.WATER_BUCKET) {
      this.world.setStateAndUpdate(x, y, z, fillCauldron(state));
      if (!this.isCreative) this.exchangeHeld(Item.WATER_BUCKET, Item.BUCKET);
      this.audio.play('splash', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      this.particles.spawnSplash(x + 0.5, y + 0.9, z + 0.5, 0x9fd4ff, 6);
      this.hand.swing();
      return true;
    }

    // ①b 岩浆桶 → 倒成岩浆锅（批次 177）：与水锅同一个锅，靠状态位区分内容物
    if (held === Item.LAVA_BUCKET) {
      this.world.setStateAndUpdate(x, y, z, fillCauldronWithLava(state));
      if (!this.isCreative) this.exchangeHeld(Item.LAVA_BUCKET, Item.BUCKET);
      this.audio.play('flint', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      this.particles.spawnFlame(x + 0.5, y + 0.9, z + 0.5, 0xff9a1f, 6);
      this.hand.swing();
      return true;
    }

    // ② 空桶 → 从**满锅**里舀回一桶（不满舀不出来，见 `drainCauldronToBucket`）。
    // 岩浆锅舀出来的是岩浆桶（原版也是这样），水锅舀出来的是水桶。
    if (held === Item.BUCKET) {
      const lava = isLavaCauldronState(state);
      const drained = drainCauldronToBucket(state);
      if (drained === null) return false;
      this.world.setStateAndUpdate(x, y, z, drained);
      this.exchangeHeld(Item.BUCKET, lava ? Item.LAVA_BUCKET : Item.WATER_BUCKET);
      this.audio.play(lava ? 'flint' : 'splash', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      this.hand.swing();
      return true;
    }

    // ③ 玻璃瓶 → 舀一瓶水（每舀一瓶掉一级；这也是"水瓶"在生存里的第一条路）
    if (held === Item.GLASS_BOTTLE) {
      const drained = drainCauldronToBottle(state);
      if (drained === null) return false;
      this.world.setStateAndUpdate(x, y, z, drained);
      this.exchangeHeld(Item.GLASS_BOTTLE, Item.WATER_BOTTLE);
      this.audio.play('splash', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      this.hand.swing();
      return true;
    }

    return false;
  }

  /**
   * 音符盒（批次 173，G9）：**潜行右击换音高、普通右击演奏**。
   *
   * 单独一个方法（而不是塞进 `useFunctionalBlock`）是因为它要**知道有没有潜行**：
   * 主循环里"潜行右键"一律走放置方块，功能方块那条路根本收不到潜行。原版也正是
   * "潜行右击换音高"，所以这一段必须排在放置之前（调用点见 `rightClick`）。
   */
  private playNoteBlock(x: number, y: number, z: number, sneaking: boolean): void {
    const state = this.world.getBlockState(x, y, z);
    if (sneaking) {
      const pitch = nextNotePitch(state);
      this.world.setStateAndUpdate(x, y, z, withNotePitch(state, pitch));
      this.chat.push(`音符盒：第 ${pitch + 1} 档 / 共 ${NOTE_BLOCK_MAX_PITCH + 1} 档`, 'system');
      this.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      return;
    }
    this.audio.playNote(noteFrequency(notePitchOf(state)), { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    this.hand.swing();
  }

  /**
   * 对"功能方块"执行右键行为：门 / 工作台 / 熔炉 / 箱子 / 红石元件。
   *
   * 抽成一个方法同时给玩家右键与自动化脚本用——两条路径共用同一套逻辑，
   * 避免"脚本能开箱子但拉杆按下没反应"这类只在调试接口上出现的不一致。
   *
   * @returns 是否消费了这次右键（false 表示应当继续走"放置方块"）
   */
  useFunctionalBlock(x: number, y: number, z: number): boolean {
    const hitBlock = this.world.getBlock(x, y, z);
    const hitShape = blockDef(hitBlock).shape;

    // 门 / 活板门 / 栅栏门：右键开合（按形状判定，批次 38 起覆盖全部 6 种木材）
    if (hitShape === 'door') {
      this.toggleDoor(x, y, z);
      return true;
    }
    if (hitShape === 'trapdoor' || hitShape === 'fence_gate') {
      this.toggleOpenable(x, y, z, hitBlock);
      return true;
    }
    // 告示牌（B12，批次 80）：右键打开编辑框（按形状判定，落地/挂墙都算）
    if (hitShape === 'sign') {
      this.openSignEditor(x, y, z, hitBlock);
      return true;
    }
    // 物品展示框（B14，批次 86）：右键 = 挂上去 / 转 45° / 换一件。
    // 画（`painting`）没有交互：右键点它继续走放置逻辑（原版画也没有交互）
    if (hitShape === 'item_frame') return this.useItemFrame(x, y, z);
    // 信标（K5，批次 117）：右键打开效果面板（**没有物品格**，见 `ui/BeaconScreen.ts`）
    if (hitBlock === Block.BEACON) {
      this.openBeaconScreen(x, y, z);
      return true;
    }
    if (hitBlock === Block.CRAFTING_TABLE) {
      this.inventoryScreen.openWith('crafting');
      return true;
    }
    if (hitBlock === Block.FURNACE) {
      this.inventoryScreen.openWith('furnace', this.world.containers.getOrCreateFurnace(this.dimension, x, y, z));
      return true;
    }
    // 营火（批次 47）：右键打开放食物；手里拿着**锹**时右键是"熄灭"（原版行为）
    if (hitBlock === Block.CAMPFIRE) {
      const campfire = this.world.containers.getOrCreateCampfire(this.dimension, x, y, z);
      if (this.heldTool?.type === 'shovel' && campfire.lit) {
        campfire.lit = false;
        this.world.setStateAndUpdate(x, y, z, withLitState(this.world.getBlockState(x, y, z), false));
        this.damageHeldTool();
        this.audio.play('break_grass', { x, y, z });
        this.hand.swing();
        return true;
      }
      this.inventoryScreen.openWith('campfire', campfire);
      return true;
    }
    // 蛋糕（批次 52）：**右键啃一片**（原版是"地上放一块，大家分着吃"）。
    // 吃饱了返回 false —— 那一下照旧交给"放置"逻辑（可以往蛋糕上面放方块），
    // 而不是白白吃掉一次右键
    if (hitBlock === Block.CAKE) {
      return this.eatCakeSlice(x, y, z);
    }

    // 花盆（批次 52）：手里拿着能种的植物 → 种进去；空手 → 把花取出来
    if (hitBlock === Block.FLOWER_POT) {
      return this.useFlowerPot(x, y, z);
    }

    // 床（批次 79）：右键躺下睡觉——按**形状**判定（16 色床共用一条规则），
    // 所以这里不看 id、不看颜色
    if (hitShape === 'bed') {
      return this.trySleep(x, y, z);
    }

    // 烟熏炉与高炉（批次 46）：同一套界面与容器，站台从**方块**决定
    const station = stationOfBlock(hitBlock);
    if (station) {
      const furnace = this.world.containers.getOrCreateFurnace(this.dimension, x, y, z, station);
      // 自愈：方块与容器记录的站台不一致时以**方块**为准
      // （旧存档缺这个字段、或者同一格被换成另一种炉子）
      if (furnace.station !== station) furnace.station = station;
      this.inventoryScreen.openWith(station === 'smoker' ? 'smoker' : 'blast_furnace', furnace);
      return true;
    }
    if (hitBlock === Block.CHEST) {
      // 原版规则（`ChestBlock#isBlockedChestByBlock`）：**头顶若是"挡满光"的方块就打不开**。
      // 判据用 `lightOpacity >= 15` 而不是 `opaque`：树叶（opaque 但只挡 1 级光）与玻璃
      // （0 级）在原版都不挡箱子，用 opaque 会误伤它们。
      if (this.isCoveredAbove(x, y, z)) {
        this.chat.push('箱子上面压着方块，打不开（挪开它，或者换成**木桶**——木桶不怕压）', 'system');
        return true;
      }
      this.inventoryScreen.openWith('chest', this.world.containers.getOrCreateChest(this.dimension, x, y, z));
      return true;
    }
    // 潜影盒（批次 72）：与箱子同一条"头顶压着就打不开"的规矩，27 格
    if (hitBlock === Block.SHULKER_BOX) {
      if (this.isCoveredAbove(x, y, z)) {
        this.chat.push('潜影盒上面压着方块，打不开（挪开它）', 'system');
        return true;
      }
      this.inventoryScreen.openWith(
        'shulker_box',
        this.world.containers.getOrCreateShulkerBox(this.dimension, x, y, z),
      );
      return true;
    }

    // 末影箱（批次 71）：与箱子同一条"头顶压着就打不开"的规矩，但开的是**你自己的那一份**
    if (hitBlock === Block.ENDER_CHEST) {
      if (this.isCoveredAbove(x, y, z)) {
        this.chat.push('末影箱上面压着方块，打不开（挪开它）', 'system');
        return true;
      }
      // 开箱时冒一圈末影粒子（原版也有，而且是它唯一的"打开"反馈）
      this.particles.spawnPortal(x + 0.5, y + 0.9, z + 0.5, 12, 0.5);
      this.audio.play('portal', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      this.inventoryScreen.openWith('ender_chest', this.enderChest.open());
      return true;
    }

    // 木桶（批次 61）：与箱子同 27 格，但**头顶压着方块照样能开**（原版就是靠这一条
    // 成为"塞进墙里"的首选）；另外原版它允许漏斗从**任何一面**取放，本项目本来就不按面限制
    if (hitBlock === Block.BARREL) {
      this.inventoryScreen.openWith('barrel', this.world.containers.getOrCreateBarrel(this.dimension, x, y, z));
      return true;
    }
    // 堆肥桶（批次 70）：右键塞一件可堆肥的东西 / 满了右键收骨粉（**不打开界面**，原版也没有界面）
    if (hitBlock === Block.COMPOSTER) {
      return this.useComposter(x, y, z);
    }
    // 漏斗（批次 58）：右键打开 5 格。⚠️ 打开界面时**不暂停搬运**（原版也照搬）——
    // 所以能看着东西一格一格往里进，这也是调试搬运逻辑最直观的方式
    if (hitBlock === Block.HOPPER) {
      this.inventoryScreen.openWith('hopper', this.world.containers.getOrCreateHopper(this.dimension, x, y, z));
      return true;
    }
    // 投掷器（批次 59）：右键打开 9 格（3×3）。它的"动作"是红石脉冲，界面里只看存货
    if (hitBlock === Block.DROPPER || hitBlock === Block.DISPENSER) {
      // 两兄弟同一套 9 格界面（标题不同），朝向都要缓存给提示行用
      const facing = sixFacingOf(this.world.getBlockState(x, y, z));
      if (hitBlock === Block.DROPPER) {
        const dropper = this.world.containers.getOrCreateDropper(this.dimension, x, y, z);
        dropper.facing = facing;
        this.inventoryScreen.openWith('dropper', dropper);
      } else {
        const dispenser = this.world.containers.getOrCreateDispenser(this.dimension, x, y, z);
        dispenser.facing = facing;
        this.inventoryScreen.openWith('dispenser', dispenser);
      }
      return true;
    }
    if (hitBlock === Block.BREWING_STAND) {
      this.inventoryScreen.openWith('brewing', this.world.containers.getOrCreateBrewingStand(this.dimension, x, y, z));
      return true;
    }
    if (hitBlock === Block.ANVIL) {
      this.inventoryScreen.openWith('anvil', this.world.containers.getOrCreateAnvil(this.dimension, x, y, z));
      return true;
    }
    if (hitBlock === Block.SMITHING_TABLE) {
      this.inventoryScreen.openWith('smithing', this.world.containers.getOrCreateSmithingTable(this.dimension, x, y, z));
      return true;
    }
    if (hitBlock === Block.STONECUTTER) {
      this.inventoryScreen.openWith('stonecutter', this.world.containers.getOrCreateStonecutter(this.dimension, x, y, z));
      return true;
    }
    if (hitBlock === Block.ENCHANTING_TABLE) {
      // 记下位置：书架加成要围着**这一台**数，而 `enchantContext` 是每次刷新时问的
      this.enchantTablePos = { x, y, z };
      this.inventoryScreen.openWith('enchanting', this.world.containers.getOrCreateEnchantTable(this.dimension, x, y, z));
      return true;
    }

    // ---- 装水：拿空玻璃瓶对着水右键（H10 的起点）
    // 没有这一步，酿造链在生存模式下根本走不通：水瓶只能在创造模式里拿。
    // ⚠️ 桶装水与炼药锅还没做，所以"水桶"那条路仍然不通。
    if (hitBlock === Block.WATER) return this.fillWaterBottle();

    // ---- 炼药锅（批次 176，G13）：倒水 / 舀水 / 舀一瓶
    if (hitBlock === Block.CAULDRON) return this.useCauldron(x, y, z);

    // ---- 红石元件：拉杆开关、按钮按下
    if (hitBlock === Block.LEVER) {
      const toggled = this.redstone.toggleLever(this.redstoneWorld, x, y, z);
      // 红石尘（E22）：开关红石元件时掉几粒红粉，是"它真的动了"最直接的反馈
      if (toggled) this.particles.spawnRedstoneDust(x + 0.5, y + 0.5, z + 0.5);
      return toggled;
    }
    // 阳光传感器（批次 54）：右键在"白天通电"与"反向（天黑通电）"之间切换（原版行为）
    if (hitBlock === Block.DAYLIGHT_DETECTOR) {
      return this.redstone.toggleInverted(this.redstoneWorld, x, y, z);
    }
    // 绊线（批次 55）：拿**剪刀**右键把它剪断（剪断后不再触发，但回路还连着）
    if (hitBlock === Block.TRIPWIRE && this.heldTool?.type === 'shears') {
      if (!this.redstone.disarmTripwire(this.redstoneWorld, x, y, z)) return true;
      this.damageHeldTool();
      this.hand.swing();
      return true;
    }
    if (hitBlock === Block.STONE_BUTTON || hitBlock === Block.OAK_BUTTON) {
      const pressed = this.redstone.pressButton(this.redstoneWorld, x, y, z);
      if (pressed) this.particles.spawnRedstoneDust(x + 0.5, y + 0.5, z + 0.5, 3);
      return pressed;
    }
    if (hitBlock === Block.REPEATER) {
      // 右键循环切换延迟档位（原版行为：0.1 / 0.2 / 0.3 / 0.4 秒）
      const state = this.world.getBlockState(x, y, z);
      this.world.setStateAndUpdate(x, y, z, withDelay(state, (delayOf(state) + 1) & 3));
      this.particles.spawnRedstoneDust(x + 0.5, y + 0.5, z + 0.5, 3);
      return true;
    }

    // 末地传送门框架（K9，批次 111）：手上是**末影之眼**就按一只进去；
    // 空了手/别的东西时什么也不做（返回 false 让"往框架顶上放方块"照旧可行）。
    // 放在最后一条是因为它只在"手上正好是末影之眼"时才截胡
    if (hitBlock === Block.END_PORTAL_FRAME && this.heldItemId === Item.ENDER_EYE) {
      return this.insertEnderEye(x, y, z);
    }

    return false;
  }

  /**
   * 往末地传送门框架里按一只末影之眼（K9，批次 111）。
   *
   * 三件事，顺序都有理由：
   *  1. **已经插着眼睛的框架**：不消耗、不报错，但顺手跑一次"圈齐了没"——
   *     这是一条**自愈**路径（老存档、结构生成时随机预置满了一圈、被别的手段改过状态的），
   *     逻辑本身与"按下最后一只眼睛"完全同源（`activateEndPortalAt`）；
   *  2. 插眼睛：改**这一格**的方块状态（`withEndPortalEye`），并广播给队友；
   *  3. 插完再问一次圈齐了没：齐了就把中间 3×3 点亮（9 格逐个广播）。
   *
   * ⚠️ 眼睛**只进不出**：原版拿不回框架里的眼睛（想拿回来只能把框架敲掉，
   * 而框架在原版是"不可破坏"的）——所以这里不做"空手取出"。
   */
  private insertEnderEye(x: number, y: number, z: number): boolean {
    const state = this.world.getBlockState(x, y, z);
    if (hasEndPortalEye(state)) {
      // 自愈：圈齐了却没亮（理论上只有脏存档会遇到），顺手点亮
      this.lightEndPortalIfComplete(x, y, z);
      return false;
    }
    if (!this.inventory.consume(Item.ENDER_EYE, 1)) return false;

    const next = withEndPortalEye(state, true);
    this.world.setStateAndUpdate(x, y, z, next);
    this.net.sendBlock(x, y, z, Block.END_PORTAL_FRAME, next, this.dimension);
    this.audio.play('portal', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    this.particles.spawnPortal(x + 0.5, y + 1.1, z + 0.5, 8, 0.4);
    this.hand.swing();
    this.refreshHotbar();
    this.lightEndPortalIfComplete(x, y, z);
    return true;
  }

  /** 这一格框架所在的圈如果齐了就点亮中间的 3×3（并把那 9 格广播出去） */
  private lightEndPortalIfComplete(x: number, y: number, z: number): void {
    const activation = activateEndPortalAt(this.portalWorld, x, y, z);
    if (!activation || activation.filled === 0) return;
    const [cx, cy, cz] = activation.center;
    for (const [px, py, pz] of endPortalCells(cx, cy, cz)) {
      this.net.sendBlock(px, py, pz, Block.END_PORTAL, 0, this.dimension);
    }
    this.audio.play('portal', { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 });
    this.particles.spawnPortal(cx + 0.5, cy + 0.6, cz + 0.5, 40, 1.2);
    // 进度（M7）不在这里报：`story/enter_the_end` 由 `setDimension` 的维度事件给
    //（人真的踏进去才算——原版也是"进去"才算，不是"点亮"）
  }

  /**
   * 轮询手柄并把它接进游戏：视角、破坏/放置、开背包。
   * 移动与跳跃在 collectInput 里合并，这里只处理"需要每帧推进"的部分。
   */
  private updateGamepad(dt: number): void {
    const pad = this.gamepad.poll(Math.min(dt, 0.1));
    this.gamepadState = pad;
    if (!pad) {
      this.padAttack = false;
      this.padUse = false;
      return;
    }

    // 视角：右摇杆按帧速率转（与触摸拖动共用 applyLook，因此灵敏度表现一致）
    if (pad.lookDx !== 0 || pad.lookDy !== 0) {
      const gain = this.settings.sensitivity;
      this.applyLook(pad.lookDx * 0.0035 * gain, pad.lookDy * 0.0035 * gain);
    }

    this.padAttack = pad.attack;
    this.padUse = pad.use;

    if (pad.openInventoryPressed && !this.uiOpen) this.inventoryScreen.openWith('crafting');
  }

  /**
   * 触觉反馈（移动端）。
   *
   * 只在与触摸设备同一会话里调用：桌面浏览器没有振动马达，
   * 而且部分浏览器对 vibrate 的调用会打印警告。
   */
  private vibrate(pattern: number | number[]): void {
    if (!this.touch) return;
    if (typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // 某些环境（如跨域 iframe）会直接抛错，忽略即可
    }
  }

  /**
   * 该方块格里是否有玩家或生物（压力板触发用）。
   * 用 AABB 与方块格相交判定——与碰撞检测同一套几何，不需要额外的实体事件。
   */
  private hasEntityAt(x: number, y: number, z: number): boolean {
    const minX = x;
    const maxX = x + 1;
    const minY = y;
    const maxY = y + 1;
    const minZ = z;
    const maxZ = z + 1;

    // 玩家（半宽 0.3、身高 1.8）
    const px = this.physics.x;
    const py = this.physics.y;
    const pz = this.physics.z;
    if (px + 0.3 > minX && px - 0.3 < maxX && py < maxY && py + 1.8 > minY && pz + 0.3 > minZ && pz - 0.3 < maxZ) {
      return true;
    }

    for (const entity of this.entities.all) {
      const half = entity.width / 2;
      if (
        entity.x + half > minX &&
        entity.x - half < maxX &&
        entity.y < maxY &&
        entity.y + entity.height > minY &&
        entity.z + half > minZ &&
        entity.z - half < maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 这只生物的脚下或身体所在格是不是火（I12）。
   * 只有两格要查（原版也是判实体 AABB 覆盖到的方块），不必扫整个包围盒。
   */
  /**
   * (x, y, z) 处的实体**脚底下那一格**是不是岩浆块（批次 121）。
   *
   * 玩家与生物**共用这一个算式**：两处各写一遍的话，哪天"站在哪一格算踩着岩浆块"改了，
   * 就会变成"玩家掉血、怪不掉"这种**半对**的状态——它不会报错、也没人会报 bug，
   * 只会让人以为"岩浆块怎么不烫怪"（末影之眼那批在位置公式上踩过同一条，见
   * `structureCellOrigin` 的注记）。
   */
  private standsOnMagmaBlock(x: number, y: number, z: number): boolean {
    return this.world.getBlock(Math.floor(x), Math.floor(y - 0.1), Math.floor(z)) === Block.MAGMA_BLOCK;
  }

  private mobInFire(entity: { x: number; y: number; z: number; height: number }): boolean {
    const bx = Math.floor(entity.x);
    const bz = Math.floor(entity.z);
    const fy = Math.floor(entity.y + 0.1);
    // 火、岩浆、以及**点着的营火**（批次 48）：生物踩上去同样会烧起来
    if (burnsOnContact(this.world.getBlock(bx, fy, bz), this.world.getBlockState(bx, fy, bz))) return true;
    return this.world.getBlock(bx, Math.floor(entity.y + entity.height * 0.5), bz) === Block.FIRE;
  }

  /**
   * 末地 boss 的生成与状态同步。
   *
   * 生成时机放在"进入末地"而不是世界初始化：龙与水晶只属于末地，
   * 主世界/下界不该白白维护这两个实体（也会被区块卸载逻辑来回清理）。
   */
  private updateEndBoss(): void {
    // 水晶数量决定龙是否回血（原版机制）
    if (this.endDragon && !this.endDragon.dead) {
      let crystals = 0;
      for (const entity of this.entities.all) {
        if (entity instanceof EndCrystal && !entity.dead) crystals++;
      }
      this.endDragon.crystalCount = crystals;
    }

    // 龙倒地（M7 批次 87 顺手接上的）：`dragonDefeated` 这个字段**一直在存档里躺着，
    // 却从来没有人写过它**——症状是"打完龙，退出重进末地，龙又回来了"。
    // 这里在"上一帧还活着、这一帧死了"的瞬间记一次账（进度也要一条，所以顺手修掉）。
    if (this.endDragon?.dead && !this.dragonDefeated) {
      this.dragonDefeated = true;
      this.reportProgress({ kind: 'dragon' });
    }

    // 血条：龙与凋灵**共用一条**（同一时刻只可能有一个人在用：龙在末地、
    // 凋灵在主世界/下界，而它们在各自的维度里才显示）
    this.updateBossBar();
  }

  /**
   * boss 血条（批次 116：从"只认末影龙"改成"龙与凋灵共用一条"）。
   *
   * 三种状态各有各的样子：末影龙是紫色、凋灵是暗红、凋灵的**护盾期**闪蓝
   * （那 5 秒打它不掉血，玩家必须看得出来，否则会以为"打不动是 bug"）。
   */
  private updateBossBar(): void {
    if (!this.bossBarEl || !this.bossFillEl) return;
    const dragon = this.endDragon;
    const wither = this.aliveWither();
    const showDragon = this.dimension === Dimension.END && dragon !== null && !dragon.dead;
    const showWither = wither !== null;
    const show = showDragon || showWither;
    this.bossBarEl.classList.toggle('on', show);
    this.bossBarEl.classList.toggle('wither', showWither);
    this.bossBarEl.classList.toggle('shielded', showWither && wither!.shielded);
    if (!show) return;

    const maxHealth = showWither ? WITHER_TYPE.health : DRAGON_TYPE.health;
    const health = showWither ? wither!.health : dragon!.health;
    const ratio = Math.max(0, Math.min(1, health / maxHealth));
    this.bossFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;

    const title = showWither ? WITHER_TYPE.name : DRAGON_TYPE.name;
    if (this.bossTitleEl && this.bossTitleEl.textContent !== title) this.bossTitleEl.textContent = title;
  }

  /** 场上活着的凋灵（血条与调试接口用；一只就够——原版可以同时有好多只，这里取第一只） */
  private aliveWither(): Wither | null {
    for (const entity of this.entities.all) {
      if (entity instanceof Wither && !entity.dead) return entity;
    }
    return null;
  }

  /**
   * 在末地主岛上方生成末影龙，并在 10 根黑曜石柱顶生成末地水晶。
   * 柱顶坐标由 `endPillarTops` 给出——与 Worker 里生成柱子的算法同源，位置必然对得上。
   */
  private spawnEndBoss(): void {
    if (this.endDragon && !this.endDragon.dead) return;
    // 已经打过了就不再长回来（`dragonDefeated` 随存档走；原版是"复活要重新放水晶"）
    if (this.dragonDefeated) return;

    const dragon = new Dragon(DRAGON_SPAWN_X, DRAGON_CRUISE_Y, DRAGON_SPAWN_Z, 0);
    this.entities.spawn(dragon);
    this.endDragon = dragon;

    for (const top of endPillarTops(this.world.seed)) {
      this.entities.spawn(new EndCrystal(top.x + 0.5, top.y + 0.5, top.z + 0.5));
    }
  }

  /**
   * 方块被放进世界之后，把**跟着方块走的容器**补建出来（批次 58）。
   *
   * 为什么要单独一个入口：漏斗这类方块**必须**在"放下"那一刻就进容器表
   * （tick 循环是按容器表推进的），而"方块出现"有几条路径——玩家放置、联机同步、
   * 控制台调试 API。只在玩家放置那条路径上建容器的话，另外两条会得到
   * "看着是漏斗、其实永远不会搬东西"的**假漏斗**（方块本身完全正常，最难查）。
   *
   * 目前只有漏斗需要它：其余容器都是"打开界面时按需创建"的。
   */
  private ensureBlockEntityAt(x: number, y: number, z: number, blockId: number, dimension?: string): void {
    const target: DimensionId = isDimension(dimension) ? dimension : this.dimension;
    if (blockId === Block.HOPPER) {
      this.world.containers.getOrCreateHopper(target, x, y, z);
      return;
    }
    // 投掷器（批次 59）同样在放下时就建容器：它的**界面**与"被别的容器推东西进来"
    // 都要求这一格在容器表里看得见（它自己不靠容器表 tick，所以少建一次也不会停摆——
    // 但"放下就能打开界面"这条手感与漏斗保持一致）
    if (blockId === Block.DROPPER) {
      this.world.containers.getOrCreateDropper(target, x, y, z);
      return;
    }
    if (blockId === Block.DISPENSER) this.world.containers.getOrCreateDispenser(target, x, y, z);
    // 潜影盒（批次 72）：放下时也要建（物品里可能带着内容，见放置路径）
    if (blockId === Block.SHULKER_BOX) this.world.containers.getOrCreateShulkerBox(target, x, y, z);
  }

  /**
   * 破坏容器方块时把内容物倒出来（原地生成掉落物）。
   */
  private dropContainerContents(x: number, y: number, z: number): void {
    const container = this.world.containers.get(this.dimension, x, y, z);
    if (!container) return;
    // 各容器自己的格数收在 `Transfer.containerSlotCount` 一处
    // （批次 58 之前这里是一条 8 层的三元链，加一种容器就得再嵌一层——
    //  漏斗这种"一加就是新容器"的方块迟早会漏）
    const size = containerSlotCount(container);
    for (let i = 0; i < size; i++) {
      const stack = container.get(i);
      if (!stack) continue;
      this.spawnDrop(stack.id, stack.count, x + 0.5, y + 0.5, z + 0.5, stackExtras(stack));
      container.set(i, null);
    }
    this.world.containers.remove(this.dimension, x, y, z);
  }

  /**
   * 推进附近的熔炉与酿造台。
   * 只 tick 玩家周围 64 格内的容器，避免容器多了以后每帧全量遍历。
   *
   * 两种容器都**自己会通知 `onChange`**（见各自的 `tick`），所以这里不需要看返回值：
   * 界面开着的容器会因此被标脏、按节流重绘进度条。
   */
  private tickContainers(dt: number): void {
    const { x: px, y: py, z: pz } = this.physics;
    const rangeSq = 64 * 64;
    this.world.containers.forEach((container, x, y, z, dimension) => {
      const tickable =
        container instanceof Furnace ||
        container instanceof BrewingStand ||
        container instanceof Campfire ||
        container instanceof Hopper;
      if (!tickable) return;
      // 只 tick 当前维度的：另一个维度同坐标的熔炉不该在这里被推进
      if (dimension !== this.dimension) return;
      const dx = x + 0.5 - px;
      const dy = y + 0.5 - py;
      const dz = z + 0.5 - pz;
      if (dx * dx + dy * dy + dz * dz > rangeSq) return;

      if (container instanceof Hopper) {
        // 锁定状态从**方块状态**读（红石引擎负责写它），缓存进容器供界面显示
        const block = this.world.getBlock(x, y, z);
        if (block !== Block.HOPPER) return;
        container.locked = isHopperLocked(this.world.getBlockState(x, y, z));
        container.tick(dt, this.hopperEnv(x, y, z));
        return;
      }

      if (container instanceof Campfire) {
        const result = container.tick(dt);
        // 烤好的东西**弹出来**（原版如此：营火没有产物槽，成品掉在柴堆上）
        for (const entry of result.cooked) {
          this.spawnDrop(entry.output.id, entry.output.count, x + 0.5, y + 0.7, z + 0.5);
        }
        this.syncLitState(x, y, z, container.lit, result.litChanged);
        return;
      }

      const furnace = container as Furnace;
      const furnaceResult = furnace.tick(dt);
      // 烧起来/熄灭了就把方块状态同步过去：点火贴图与 13 级光都靠这一位（批次 47）
      this.syncLitState(x, y, z, furnace.isLit, furnaceResult.litChanged);
    });
  }

  /**
   * 漏斗搬东西时要问外界的三个问题（批次 58）。
   *
   * 为什么走回调而不是让 `Hopper` 直接拿世界：容器与方块表都在主线程这一侧，
   * 而 `Hopper` 是纯数据 + 规则（离线测试直接喂假环境就能钉住搬运顺序），
   * 这与"引擎只判定通电、点火交给引信表"是同一条分工。
   */
  private hopperEnv(x: number, y: number, z: number): HopperEnv {
    const [dx, dy, dz] = hopperOutputOffset(hopperOutputOf(this.world.getBlockState(x, y, z)));
    return {
      target: () => this.containerOfBlockAt(x + dx, y + dy, z + dz),
      above: () => this.containerOfBlockAt(x, y + 1, z),
      suck: () => this.suckItemAbove(x, y, z),
    };
  }

  /**
   * 这一格的容器（**没有就建出来**）。
   *
   * "建出来"这条很关键：箱子/熔炉的容器本来是**打开界面时才懒创建**的，
   * 于是"漏斗往一个从没打开过的箱子里推东西"会找不到目标、整条自动化哑掉。
   * 空容器几乎没有代价（面板打开时用的就是同一个实例），所以这里一律按需创建。
   *
   * @returns 不是容器方块时返回 null
   */
  private containerOfBlockAt(x: number, y: number, z: number): BlockContainer | null {
    // ⚠️ 新增一种容器方块时，**两处**要一起改：这里（按方块取容器）与
    // `BlockEntityStore.CONTAINER_BLOCKS`（活塞推不动的名单）。
    // 漏了后者的表现是"活塞把一整箱东西推走一格，东西全留在原地不见了"。
    // 未加载的区块不建容器：那会让区块一卸载就漏出一堆"看不见的容器"
    if (!this.world.isLoaded(x, z)) return null;
    const block = this.world.getBlock(x, y, z);
    const store = this.world.containers;
    const dimension = this.dimension;

    if (block === Block.CHEST) return store.getOrCreateChest(dimension, x, y, z);
    if (block === Block.BARREL) return store.getOrCreateBarrel(dimension, x, y, z);
    if (block === Block.HOPPER) return store.getOrCreateHopper(dimension, x, y, z);
    if (block === Block.DROPPER) return store.getOrCreateDropper(dimension, x, y, z);
    if (block === Block.DISPENSER) return store.getOrCreateDispenser(dimension, x, y, z);
    // 潜影盒：漏斗**可以**往里塞（原版也是如此，与末影箱相反）
    if (block === Block.SHULKER_BOX) return store.getOrCreateShulkerBox(dimension, x, y, z);
    if (block === Block.BREWING_STAND) return store.getOrCreateBrewingStand(dimension, x, y, z);
    if (block === Block.ANVIL) return store.getOrCreateAnvil(dimension, x, y, z);
    if (block === Block.SMITHING_TABLE) return store.getOrCreateSmithingTable(dimension, x, y, z);
    if (block === Block.STONECUTTER) return store.getOrCreateStonecutter(dimension, x, y, z);
    if (block === Block.ENCHANTING_TABLE) return store.getOrCreateEnchantTable(dimension, x, y, z);
    if (block === Block.CAMPFIRE) return store.getOrCreateCampfire(dimension, x, y, z);
    // 三种炉子：站台由**方块**决定（与右键打开界面时同一套，避免同一个炉子两种结论）
    const station = stationOfBlock(block);
    if (station) return store.getOrCreateFurnace(dimension, x, y, z, station);
    return null;
  }

  /**
   * 吸走漏斗**头顶那一格**里的一件掉落物（返回取到的物品；没有就 null）。
   *
   * 判定盒 = 头顶那一格，但下沿放宽到碗口（+6/16）：东西落在漏斗口上时也该被吸走，
   * 否则"扔在漏斗上不管用、得扔进旁边那一格"这种手感与原版对不上。
   */
  private suckItemAbove(x: number, y: number, z: number): ItemStack | null {
    for (const entity of this.entities.all) {
      if (!(entity instanceof ItemEntity) || entity.dead) continue;
      const inside = entityIntersectsBox(entity, {
        minX: x,
        minY: y + 0.375,
        minZ: z,
        maxX: x + 1,
        maxY: y + 2,
        maxZ: z + 1,
      });
      if (!inside) continue;
      entity.count -= 1;
      if (entity.count <= 0) entity.dead = true;
      // 批次 63：整份栈吸进去（耐久/附魔/改名一起走）
      return { id: entity.itemId, count: 1, ...entity.extras };
    }
    return null;
  }

  /**
   * 红石**上升沿**：投掷器吐一件 / 发射器"用"一件（批次 59、60）。
   *
   * 两者共用这一条入口，因为**触发方式完全一样**（见 `RedstoneEngine` 里那两行 case）。
   * 抽成独立方法而不是写在回调里，是为了让"信号 → 动作"这条链在调试面板/断言
   * 里也能直接调（自动化脚本不必真去搭一条红石钟）。
   */
  dispenseFrom(x: number, y: number, z: number): void {
    // 位置被换掉了（信号在队列里排队期间方块没了）——静默跳过
    if (!this.world.isLoaded(x, z)) return;
    const block = this.world.getBlock(x, y, z);
    if (block !== Block.DROPPER && block !== Block.DISPENSER) return;

    const facing = sixFacingOf(this.world.getBlockState(x, y, z));
    const [dx, dy, dz] = sixFacingOffset(facing);

    // 投掷器：闭着眼吐一件（对面是容器就塞进去、不是就吐成掉落物）
    if (block === Block.DROPPER) {
      const container = this.world.containers.getOrCreateDropper(this.dimension, x, y, z);
      // 朝向缓存进容器，界面才写得出"朝北"（见 `Dropper.facing`）
      container.facing = facing;
      container.serve(this.dropperEnv(x, y, z, dx, dy, dz));
      return;
    }

    // 发射器：先看手里是什么，再决定"用它"还是"吐出去"
    const container = this.world.containers.getOrCreateDispenser(this.dimension, x, y, z);
    container.facing = facing;
    const pick = container.peekRandom();
    if (!pick) return; // 空的：什么也不做（原版连音效都没有）

    const behavior = dispenseBehaviorFor(pick.stack.id);
    if (!behavior) {
      // 表里没有这一件：与投掷器**逐字一样**（同一个 `serve`，两条出口不必各写一遍）
      container.serve(this.dropperEnv(x, y, z, dx, dy, dz));
      return;
    }

    // ⚠️ 次序：**先确认用得出去，再扣东西**。用不出去（对面不是 TNT、那一格点不着火…）
    // 就整件事取消，物品留在原地——原版也是"失败就什么都不发生"。
    if (!runDispenseAction(behavior, pick.stack, x, y, z, dx, dy, dz, this.dispenseContext())) return;
    // 工具类（打火石/剪刀）是"磨一点耐久"，其余是"少一件"
    if (behavior.wear) container.wearAt(pick.slot, behavior.wear, durabilityOf(pick.stack.id));
    else container.takeAt(pick.slot);
    container.servedCount++;
  }

  /**
   * 把主程序的能力交给发射执行器（`core/world/Dispense.ts`）。
   *
   * 这一层只做"翻译"：把世界、实体、音效包成执行器认得的那几个方法。
   * 判定逻辑（射/扔/点燃/点火/剪、失败时留不留东西）都在执行器里，
   * 所以它能在离线测试里被逐条钉住——这里是唯一需要"真世界"的地方。
   */
  private dispenseContext(): DispenseContext {
    return {
      blockAt: (bx, by, bz) => this.world.getBlock(bx, by, bz),
      shootArrow: (ax, ay, az, velocity, options) => {
        // 药水箭：命中时挂 1/8 时长效果的依据（普通箭没有这个字段）
        const potionId = tippedArrowById(options.itemId)?.potionId;
        this.spawnArrow(ax, ay, az, velocity, {
          // ⚠️ `fromPlayer: false`：发射器射出的箭**会打到玩家**（只有玩家自己射的箭才不打自己）
          fromPlayer: false,
          damage: options.damage,
          pickable: options.pickable,
          itemId: options.itemId,
          ...(potionId === undefined ? {} : { potionId }),
        });
      },
      throwProjectile: (ax, ay, az, velocity, kind, itemId) => {
        this.spawnThrowable(ax, ay, az, velocity, kind, itemId);
      },
      primeTnt: (bx, by, bz) => this.primedTnt.prime(this.tntWorld, bx, by, bz),
      igniteFire: (bx, by, bz) => {
        if (!igniteAt(this.world, bx, by, bz)) return false;
        // 联机：火也要广播（与玩家拿打火石点火走同一条）
        this.net.sendBlock(bx, by, bz, Block.FIRE, 0, this.dimension);
        return true;
      },
      shearAt: (bx, by, bz) => {
        const mob = this.shearableMobAt(bx, by, bz);
        return mob ? this.shearMob(mob) : 0;
      },
      // 骨粉（批次 69）：与玩家右键走**同一个**方法，两条路径不会各自漂
      fertilizeAt: (bx, by, bz) => this.fertilizeBlockAt(bx, by, bz),
      playSound: (kind, sx, sy, sz) => this.audio.play(kind, { x: sx, y: sy, z: sz }),
    };
  }

  /**
   * 这一格的**头顶**是不是被"挡满光的方块"压住了（原版箱子打不开的判据）。
   *
   * 用 `lightOpacity >= 15`（而不是 `opaque`）：树叶在原版带 `opaque` 标记但只挡 1 级光，
   * 玻璃挡 0 级——这两个在原版都**不挡**箱子，用 `opaque` 会误伤。
   */
  private isCoveredAbove(x: number, y: number, z: number): boolean {
    return blockDef(this.world.getBlock(x, y + 1, z)).lightOpacity >= 15;
  }

  /** 某一格里有没有可以剪的生物（原版发射器剪的就是凸口那一格里的羊） */
  private shearableMobAt(x: number, y: number, z: number): Mob | null {
    const box = { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
    for (const entity of this.entities.all) {
      if (entity instanceof Mob && !entity.dead && entityIntersectsBox(entity, box)) return entity;
    }
    return null;
  }

  /** 吐一件要问外界的两个问题：朝向那一格是不是容器、不是容器时往哪扔 */
  private dropperEnv(x: number, y: number, z: number, dx: number, dy: number, dz: number): DropperEnv {
    return {
      target: () => this.containerOfBlockAt(x + dx, y + dy, z + dz),
      eject: (stack) => this.ejectItem(stack, x, y, z, dx, dy, dz),
    };
  }

  /**
   * 把一件东西从投掷器的凸口**吐出来**（朝向那一格不是容器时）。
   *
   * 落点取朝向那一格的**中心、再往回收 0.4 格**：正好放在那一格中心的话，
   * 那一格若是实心方块（比如投掷器贴着墙），掉落物会卡在方块里、永远捡不到。
   * 初速朝朝向推一把，所以"吐出去"看得出来是往哪个方向飞的。
   *
   * ⚠️ 批次 63 起，掉落物实体**带的是整份栈**：耐久/附魔/改名跟着一起掉出去、捡回来还在
   * （原先只带"物品 id + 数量"，这个"已知缺口"已经收掉）。
   */
  private ejectItem(
    stack: ItemStack,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
  ): void {
    this.entities.spawn(
      new ItemEntity(
        stack.id,
        stack.count,
        x + 0.5 + dx * 0.4,
        y + 0.5 + dy * 0.4,
        z + 0.5 + dz * 0.4,
        { x: dx * 2, y: 1.2 + dy * 2, z: dz * 2 },
        stackExtras(stack),
      ),
    );
  }

  /**
   * 把"这座炉子/营火在不在烧"同步到方块状态（批次 47）。
   *
   * 两条触发路径：
   *  1. `litChanged`——刚刚点燃或刚熄灭（正常路径）；
   *  2. **状态与容器对不上**——读档后的第一次 tick：容器里 `burnTimeLeft > 0`
   *     （火还在烧）而方块还是"没点燃"的样子，这时要把状态补上。
   *
   * 只读写一次方块状态，且对不上的情况极少，所以这里是"每 tick 检查、几乎不写"。
   */
  private syncLitState(x: number, y: number, z: number, lit: boolean, litChanged: boolean): void {
    const block = this.world.getBlock(x, y, z);
    // 方块被换掉了（例如玩家把熔炉挖了但容器还在）就别写
    if (stationOfBlock(block) === null && block !== Block.CAMPFIRE) return;
    const state = this.world.getBlockState(x, y, z);
    if (!litChanged && isLitState(state) === lit) return;
    this.world.setStateAndUpdate(x, y, z, withLitState(state, lit));
  }

  /** 破坏进度条：只在真正挖掘时显示，创造模式瞬间破坏不显示 */
  private updateBreakProgressUi(): void {
    const container = document.getElementById('break-progress');
    const bar = container?.firstElementChild as HTMLElement | null;
    if (!container || !bar) return;
    const active = this.breakProgress > 0 && this.breakProgress < 1;
    container.classList.toggle('on', active);
    if (active) bar.style.width = `${Math.round(this.breakProgress * 100)}%`;
  }

  /**
   * 扔出手上的东西（K4 尾巴）：雪球 / 鸡蛋 / 喷溅药水。
   *
   * 为什么是"点按即投"而不是像吃喝那样长按：扔东西时瞄准的就是正前方
   * （对着生物，或者对着天空抛），而触摸端"长按空处 = 使用"的前提是
   * **准星没对着方块**——那恰好把"瞄准生物"这个最主要的情况排除了。
   * 所以投掷挂在轻点/右键那一路，和放置方块抢同一个手势（手里拿着投掷物时优先扔）。
   *
   * @returns 是否真的扔出去了（没扔出去就让这次点击继续走原本的放置逻辑）
   */
  private throwHeld(): boolean {
    const held = this.heldItemId;
    if (held === undefined) return false;

    const potion = potionById(held);
    const kind: ThrowableKind | null =
      held === Item.SNOWBALL
        ? 'snowball'
        : held === Item.EGG
          ? 'egg'
          : // 末影珍珠（批次 113）：扔出去，落地时**把自己传过去**（代价 5 点摔落伤害）
            held === Item.ENDER_PEARL
            ? 'ender_pearl'
            : // 末影之眼（批次 114）：朝最近的要塞飞，用来**找要塞**
              held === Item.ENDER_EYE
              ? 'ender_eye'
              : // 三叉戟（批次 123）：右键扔出去（8 点伤害，落地会掉回地上——所以能捡回来）。
                // 它同时是**近战武器**（9 点），那条走的是 `heldTool`（见 `TRIDENT_INFO`）
                held === Item.TRIDENT
                ? 'trident'
                : potion?.splash === true
                ? 'splash_potion'
                : potion?.lingering === true
                  ? 'lingering_potion'
                  : null;
    if (kind === null) return false;

    // 末影之眼有两件事要做（批次 114）：**按进末地传送门框架**（K9 的正门）与
    // **扔出去找要塞**。投掷这一层排在"功能方块"之前，所以对着框架时必须**让位**——
    // 否则同一个手势会把想按下去的那只眼睛扔出去（玩家第一下就会踩到）。
    // 判据只有"准星在框架上"：手里拿着眼睛又对着框架时，"按下去"是唯一说得通的意图
    // （想扔就朝别处扔）——所以这里连潜行都不必判。
    if (
      kind === 'ender_eye' &&
      this.hit !== null &&
      this.world.getBlock(this.hit.x, this.hit.y, this.hit.z) === Block.END_PORTAL_FRAME
    ) {
      return false;
    }

    // 先扣再扔：扔不出去（背包里其实没有）时什么都不该发生
    if (!this.inventory.consume(held, 1)) return false;

    const cosPitch = Math.cos(this.pitch);
    const dirX = -Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = -Math.cos(this.yaw) * cosPitch;

    // 末影之眼要飞向哪儿（只有主世界有答案；见 `nearestStrongholdTarget`）
    const target = kind === 'ender_eye' ? this.nearestStrongholdTarget() : undefined;

    // 出手点在眼睛前下方一点（与射箭一致），避免刚出手就撞上自己脚边的方块
    this.spawnThrowable(
      this.physics.x + dirX * 0.4,
      this.physics.eyeY - 0.1,
      this.physics.z + dirZ * 0.4,
      // 末影之眼：**初速朝要塞**（原版就是这样——扔出去它自己拐向要塞，
      // 手上的朝向只决定出手的那一刻位置）；其余投掷物照旧沿视线飞
      target
        ? this.eyeLaunchVelocity(target)
        : { x: dirX * PLAYER_THROW_SPEED, y: dirY * PLAYER_THROW_SPEED, z: dirZ * PLAYER_THROW_SPEED },
      kind,
      held,
      target,
    );

    this.audio.play('bow_shoot');
    this.hand.swing();
    this.vibrate(8);
    this.refreshHotbar();
    return true;
  }

  /**
   * 扔出一件投掷物（玩家投掷与**发射器**共用同一条实现，批次 60）。
   *
   * 抽出来的理由与 `spawnArrow` 一样：投掷物的种类、药水 id 与"初速从哪来"只有一份，
   * 玩家与发射器不会各自漂移（发射器那一路只是初速方向不同）。
   */
  spawnThrowable(
    x: number,
    y: number,
    z: number,
    velocity: { x: number; y: number; z: number },
    kind: ThrowableKind,
    itemId: number,
    target?: { x: number; y: number; z: number },
    fromPlayer = true,
  ): void {
    this.entities.spawn(
      new Throwable(x, y, z, velocity, {
        kind,
        itemId,
        potionId: kind === 'splash_potion' || kind === 'lingering_potion' ? itemId : undefined,
        // ⚠️ 发射器那一档**没有目标**：它不放末影之眼（连珍珠都不放，见 `test:dispenser`）
        target,
        // 三叉戟靠它分流（玩家扔的砸生物、溺尸扔的砸玩家，见 `ThrowableOptions.fromPlayer`）
        fromPlayer,
      }),
    );
  }

  /**
   * 末影之眼的出手方向（批次 114）：**朝要塞**，再带一点上升。
   *
   * 原版把"投掷点 → 要塞"的归一化方向（含竖直分量）直接当初始速度，再叠一个每 tick
   * +0.15 的上升；这里只取**水平方向**，竖直那一下由 `ENDER_EYE_RISE` 固定——
   * 因为本项目的要塞都在地下（-35~20 格），照原版那个归一化方向会先一头扎进土里。
   */
  private eyeLaunchVelocity(target: { x: number; y: number; z: number }): {
    x: number;
    y: number;
    z: number;
  } {
    const dx = target.x - this.physics.x;
    const dz = target.z - this.physics.z;
    const length = Math.max(1e-4, Math.hypot(dx, dz));
    return { x: (dx / length) * ENDER_EYE_SPEED, y: ENDER_EYE_RISE, z: (dz / length) * ENDER_EYE_SPEED };
  }

  /**
   * 末影之眼该飞向哪儿（批次 114）：**最近的要塞**。
   *
   * @returns 不在主世界时 undefined——要塞是主世界的结构，在下界/末地扔眼睛是白扔
   *          （那种情况下眼睛按普通投掷物落下，与原版"找不到目标就掉在地上"一致）
   */
  private nearestStrongholdTarget(): { x: number; y: number; z: number } | undefined {
    if (this.dimension !== Dimension.OVERWORLD) return undefined;
    return nearestStronghold(this.worldConfig.seed, this.physics.x, this.physics.z) ?? undefined;
  }

  /**
   * 末影珍珠落地（批次 113，B18/J13 的收尾）：把玩家放到落点，再结算那 5 点摔落伤害。
   *
   * 三件事，顺序与原版一致：
   *  1. **先传过去**：落点已经由 `Throwable.pearlLanding` 吸附到"站得下人的一格"，
   *     这里不再动坐标（实体层拿着 `getBlock`，判断适合它做）；
   *  2. **再算伤害**：原版那 5 点走的是 `DamageSource.FALL`，所以这里也走**摔落**这一路
   *     （`applyIncomingDamage(..., 'fall')`）——摔落保护附魔与抗性提升都能减它，
   *     而创造模式（`flying`）**完全免疫**，与其它伤害同一个口径；
   *  3. 音效与粒子：原版那一下有一声很特别的"啪"，我们借用传送门那一档
   *     （`AudioEngine` 的 kind 是白名单，多编一个不存在的名字只会静默无声）。
   */
  private teleportByEnderPearl(x: number, y: number, z: number): void {
    this.physics.teleport(x, y, z);
    // 传过去可能一头扎进水里/岩浆/传送门：色罩与环境立刻重算一次（与传送门落地同一条）
    this.applyEnvironment();
    this.screenEffects.snap();
    this.audio.play('portal');
    this.particles.spawnPortal(x, y + 0.6, z, 16, 0.5);
    this.vibrate(12);
    // 创造模式免疫伤害——与 `damagePlayer` 的口径一致
    if (this.isCreative) return;
    this.applyIncomingDamage(ENDER_PEARL_FALL_DAMAGE, 'fall');
  }

  /**
   * 一次喷溅药水的范围结算（K4 尾巴）。
   *
   * 范围与"离得越远越短"的缩放都在 `survival/SplashPotion.ts`（纯函数），
   * 这里只负责回答"谁在范围内"：**玩家自己 + 四周的生物**。
   * ⚠️ 喷溅药水是**不分敌我**的（原版如此）：往脚下砸虚弱药水，自己也一样中招。
   */
  applySplash(potionId: number, x: number, y: number, z: number): void {
    const potion = potionById(potionId);
    if (!potion) return;

    this.audio.play('splash', { x, y, z });
    this.particles.spawnSmoke(x, y + 0.2, z, 10, 0.4);

    // 玩家：按"身体中心"算距离（生物那边同样取身体中心，两边口径一致）
    const playerDistance = Math.hypot(this.physics.x - x, this.physics.y + 0.9 - y, this.physics.z - z);
    for (const effect of splashEffectsAt(potion, playerDistance)) {
      this.effects.apply(effect.id, effect.seconds, effect.amplifier);
    }

    for (const entity of this.entities.all) {
      if (!(entity instanceof Mob) || entity.dead) continue;
      const distance = Math.hypot(entity.x - x, entity.y + entity.height / 2 - y, entity.z - z);
      for (const effect of splashEffectsAt(potion, distance)) {
        entity.effects.apply(effect.id, effect.seconds, effect.amplifier);
      }
    }

    // 直接命中的目标不需要特殊处理：它的距离≈0，`splashScale` 本来就是 1（满时长）。
    // 也不往消息栏里写一行——原版砸药水是没有提示的，扔一排在手机上会被刷屏
  }

  /** 摔出一片滞留药水的云（K4 尾巴）：只登记，结算交给 `updateClouds` 按节奏推进 */
  private spawnLingeringCloud(potionId: number, x: number, y: number, z: number): void {
    const cloud = createLingeringCloud(potionId, x, y, z);
    this.clouds.push(cloud);
    this.audio.play('splash', { x, y, z });
    this.puffCloud(cloud);
  }

  /** 末影龙吐出一团血息云（K4 尾巴） */
  private spawnDragonBreathCloud(x: number, y: number, z: number): void {
    const cloud = createDragonBreathCloud(x, y, z);
    this.clouds.push(cloud);
    this.puffCloud(cloud);
  }

  /**
   * 给一片云撒一把粒子。
   * 药水云在视觉上**就是一团彩烟**（原版也没有实心模型），所以不建 mesh；
   * 颜色与瓶子贴图同源（`potionTint`），不会出现"云是绿的、瓶子是黄的"。
   */
  private puffCloud(cloud: PotionCloud): void {
    if (cloud.kind === 'dragon_breath') {
      this.particles.spawnFlame(cloud.x, cloud.y, cloud.z, 0xa070e0, 3);
      return;
    }
    const potion = cloud.potionId === undefined ? undefined : potionById(cloud.potionId);
    this.particles.spawnSplash(cloud.x, cloud.y, cloud.z, potion ? potionTint(potion) : 0x8a6ab0, 8);
  }

  /** 推进所有药水云：存活、收缩、结算节奏全部由 `survival/PotionCloud.ts` 决定 */
  private updateClouds(dt: number): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const cloud = this.clouds[i]!;
      const { alive, pulse } = tickCloud(cloud, dt);
      if (!alive) {
        this.clouds.splice(i, 1);
        continue;
      }
      if (!pulse) continue;
      this.puffCloud(cloud);
      this.pulseCloud(cloud);
    }
  }

  /**
   * 云的一次结算（每 `CLOUD_PULSE_INTERVAL` 秒一次）。
   * ⚠️ 与喷溅药水一样**不分敌我**：站在自己的毒云里一样会中毒。
   * 龙息云是固定伤害、不按距离缩；药水云沿用喷溅那套"离云心越远越短"的缩放。
   */
  private pulseCloud(cloud: PotionCloud): void {
    const playerDistance = Math.hypot(
      this.physics.x - cloud.x,
      this.physics.y + 0.9 - cloud.y,
      this.physics.z - cloud.z,
    );

    if (cloud.kind === 'dragon_breath') {
      // 同一秒里被好几片云罩住也只掉一次：玩家的无敌帧会挡掉重复的伤害
      if (playerDistance <= cloud.radius) this.applyIncomingDamage(DRAGON_BREATH_DAMAGE, 'generic');
    } else {
      for (const effect of cloudEffectsAt(cloud, playerDistance)) {
        this.effects.apply(effect.id, effect.seconds, effect.amplifier);
      }
    }

    for (const entity of this.entities.all) {
      if (!(entity instanceof Mob) || entity.dead) continue;
      const distance = Math.hypot(entity.x - cloud.x, entity.y + entity.height / 2 - cloud.y, entity.z - cloud.z);
      if (distance > cloud.radius) continue;
      if (cloud.kind === 'dragon_breath') {
        entity.hurt(DRAGON_BREATH_DAMAGE, 0, 0, this.lastEntityContext ?? undefined);
        continue;
      }
      for (const effect of cloudEffectsAt(cloud, distance)) {
        entity.effects.apply(effect.id, effect.seconds, effect.amplifier);
      }
    }
  }

  /**
   * 空玻璃瓶接龙息（K4 尾巴）：站在**血息云**里右键。
   * 接一次会让云缩小一圈（原版 `radiusOnUse`），所以一片云能接的量是有限的。
   */
  private collectDragonBreath(): boolean {
    if (this.heldItemId !== Item.GLASS_BOTTLE) return false;
    const cloud = this.dragonBreathCloudInReach();
    if (!cloud) return false;
    if (!this.inventory.consume(Item.GLASS_BOTTLE, 1)) return false;

    const leftover = this.inventory.add(Item.DRAGON_BREATH, 1);
    if (leftover > 0) this.spawnDrop(Item.DRAGON_BREATH, leftover, this.physics.x, this.physics.y + 1, this.physics.z);
    cloud.radius = Math.max(0, cloud.radius - DRAGON_BREATH_COLLECT_SHRINK);

    this.audio.play('splash');
    this.refreshHotbar();
    return true;
  }

  /** 眼睛够得着的血息云：判定用**云自己的半径**（原版是"站进云里"才接得到） */
  private dragonBreathCloudInReach(): PotionCloud | null {
    for (const cloud of this.clouds) {
      if (cloud.kind !== 'dragon_breath') continue;
      const distance = Math.hypot(cloud.x - this.physics.x, cloud.y - this.physics.eyeY, cloud.z - this.physics.z);
      if (canCollectDragonBreath(cloud, distance)) return cloud;
    }
    return null;
  }

  private updatePlacing(): void {
    // 触摸：轻点一次；鼠标：按住右键。统一成"本帧要不要放"
    //（批次 181 删掉了"按住连放"：它在 140ms 就触发，抢在长按破坏之前）
    const tapped = this.touchPlaceRequest;
    if ((!this.rightDown && !tapped && !this.padUse) || this.placeCooldown > 0) return;

    // 投掷物优先于放置：手里拿着雪球/鸡蛋/喷溅药水时，这一下是"扔"而不是"放"
    if (this.throwHeld()) {
      this.touchPlaceRequest = false;
      this.placeCooldown = PLACE_COOLDOWN * 2;
      return;
    }

    // 空玻璃瓶接龙息（K4 尾巴）：血息云飘在空气里，所以和投掷一样**不需要准星对着方块**
    if (this.collectDragonBreath()) {
      this.touchPlaceRequest = false;
      this.placeCooldown = PLACE_COOLDOWN * 2;
      return;
    }

    // 钓竿（批次 81，G11）：手里拿着钓竿时这一下是"抛竿 / 收杆"。
    // 与投掷同一条理由放在这里——收杆那一刻玩家往往正看着浮标（准星对着水面），
    // 而这种状态下"准星必须对着可交互方块"的老规矩会把它挡掉
    if (this.heldItemId === Item.FISHING_ROD) {
      this.touchPlaceRequest = false;
      this.placeCooldown = PLACE_COOLDOWN * 2;
      this.useFishingRod();
      return;
    }

    // 没有命中方块就没什么可放/可交互的（投掷在上面已经处理过了）
    if (!this.hit) return;

    // 右键功能方块：潜行时仍然走放置逻辑（与原版一致）
    // 触摸潜行也要算进来，否则手机上无法"潜行对着箱子放方块"
    const sneak =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      (this.touch?.input.sneak ?? false) ||
      (this.gamepadState?.sneak ?? false);
    // ---- 音符盒（批次 173，G9）：**普通右击演奏、潜行右击换音高**（原版行为）。
    // ⚠️ 必须排在下面那道"潜行时不走功能方块"的判断**之前**：原版就是"潜行右击换音高"，
    //    而我们的潜行右键被"放置方块"占着——不特判的话音高永远换不了（这一条是写代码时才发现的）。
    if (this.world.getBlock(this.hit.x, this.hit.y, this.hit.z) === Block.NOTE_BLOCK) {
      this.playNoteBlock(this.hit.x, this.hit.y, this.hit.z, sneak);
      this.touchPlaceRequest = false;
      this.placeCooldown = PLACE_COOLDOWN;
      return;
    }

    // ---- 刷怪蛋（批次 174，J17）：对着方块右击生成一只生物。
    // 排在功能方块之前：拿着蛋点箱子时，那一下应该是"生出生物"而不是"打开箱子"。
    // 创造模式（= 会飞）不消耗，与原版一致。
    const eggMob = spawnEggMobOf(this.heldItemId ?? -1);
    if (eggMob) {
      if (this.spawnMob(eggMob, this.hit.x, this.hit.y + 1, this.hit.z)) {
        if (!this.isCreative) {
          this.inventory.take(this.hotbarIndex, 1);
          this.refreshHotbar();
        }
        this.audio.play('place', { x: this.hit.x + 0.5, y: this.hit.y + 1, z: this.hit.z + 0.5 });
        this.hand.swing();
      }
      this.touchPlaceRequest = false;
      this.placeCooldown = PLACE_COOLDOWN * 2;
      return;
    }

    // ---- 装桶（批次 176，G13）：拿空桶对着**水源**右击就装满。
    // 排在功能方块之前：对着炼药锅/水面都不该先被"功能方块"截走（锅自己那条在下面处理）。
    if (this.fillBucketFrom()) {
      this.touchPlaceRequest = false;
      this.placeCooldown = PLACE_COOLDOWN * 2;
      return;
    }

    if (!sneak && this.useFunctionalBlock(this.hit.x, this.hit.y, this.hit.z)) {
      this.touchPlaceRequest = false;
      this.placeCooldown = PLACE_COOLDOWN * 2;
      return;
    }

    // 轻点只消费一次
    this.touchPlaceRequest = false;

    // 对生物使用物品（剪羊毛）：看在功能方块之后、放置之前——
    // 玩家准星对着羊时，那一下应该剪羊毛而不是把方块放到羊身上
    if (this.useOnEntity()) {
      this.placeCooldown = PLACE_COOLDOWN * 2;
      this.touchPlaceRequest = false;
      return;
    }

    // 倒水 / 倒岩浆（批次 176，G13）：水桶不是方块物品，落到下面的放置分支只会什么都不做
    if (this.pourBucket()) {
      this.placeCooldown = PLACE_COOLDOWN * 2;
      return;
    }

    // 手上是弓时右键是"拉弓"，不放置也不使用（功能方块在上面已经处理过了）
    if (this.heldItemId === Item.BOW) return;

    // 锄头耕地（H13）：拿着锄头右键泥土/草方块 → 变成耕地，不放置方块
    if (this.tillSoil(this.hit.x, this.hit.y, this.hit.z)) {
      this.placeCooldown = PLACE_COOLDOWN;
      return;
    }

    // 斧头刮铜（批次 40）：手上是斧头、准星对着锈了的铜 → 刮掉一层
    if (this.scrapeCopper(this.hit.x, this.hit.y, this.hit.z)) {
      this.placeCooldown = PLACE_COOLDOWN;
      return;
    }

    // 打火石点火（I12）：放在放置之前——它本身不是方块物品，`selectedBlock` 是 undefined，
    // 落到下面的放置分支就什么都不做
    if (this.igniteWithFlint()) {
      this.placeCooldown = PLACE_COOLDOWN;
      return;
    }

    // 骨粉（批次 69）：对着作物右键 → 催长 2~5 个阶段。
    // 放在放置之前：骨粉不是方块物品，落到下面的放置分支只会什么都不做
    if (this.fertilizeWithBoneMeal()) {
      this.placeCooldown = PLACE_COOLDOWN;
      return;
    }

    // 手持**线**右键方块顶面 → 铺一段绊线（批次 55）。原版绊线没有物品，
    // 只能这么放；所以它和点火一样，必须在"放置方块"那条路**之前**单独接一处
    if (this.placeTripwire()) {
      this.placeCooldown = PLACE_COOLDOWN;
      return;
    }

    const blockId = this.selectedBlock;
    if (blockId === undefined) return;

    // 睡莲（B16）：命中水面时一律按**上表面**算落点。
    // 水面没有可贴的实体面，玩家从侧面看水面时命中的是水面那一格的侧面，
    // 按原法线算出来的落点会落到旁边那一格水里（不是空气 → 被下面拒掉，
    // 症状是"怎么点都放不下去"）；统一按上表面算，玩家从哪个角度都能放下。
    const onWaterSurface =
      blockId === Block.LILY_PAD && this.world.getBlock(this.hit.x, this.hit.y, this.hit.z) === Block.WATER;
    const nx = onWaterSurface ? 0 : this.hit.nx;
    const ny = onWaterSurface ? 1 : this.hit.ny;
    const nz = onWaterSurface ? 0 : this.hit.nz;

    const x = this.hit.x + nx;
    const y = this.hit.y + ny;
    const z = this.hit.z + nz;

    const existing = this.world.getBlock(x, y, z);

    // 按方块形状与命中面推导状态（台阶上下半、楼梯朝向、火把挂墙、门轴……）
    const plan = planPlacement({
      blockId,
      normal: [nx, ny, nz],
      hitX: this.hit.hitX,
      hitY: this.hit.hitY,
      hitZ: this.hit.hitZ,
      yaw: this.yaw,
      sneaking: sneak,
      blockAt: (dx, dy, dz) => this.world.getBlock(x + dx, y + dy, z + dz),
      stateAt: (dx, dy, dz) => this.world.getBlockState(x + dx, y + dy, z + dz),
      hitBlock: this.world.getBlock(this.hit.x, this.hit.y, this.hit.z),
      hitState: this.world.getBlockState(this.hit.x, this.hit.y, this.hit.z),
    });
    if (!plan) return;

    // 落点必须可写。两种例外：
    //  - `mergeInto`：改的是**命中方块自身**（台阶叠双层、雪层叠高），不碰 (x,y,z)
    //  - `mergeIntoTarget`：改的是**落点那一格**，而那一格本来就长着同一种藤蔓
    //    （"再挂一面"），所以"必须是空气"这条不适用
    if (!plan.mergeInto && !plan.mergeIntoTarget && existing !== Block.AIR && !blockDef(existing).liquid) return;

    // "与玩家碰撞"这条同样要在**拿到放置方案之后**才判：合并类放置不往空格里放东西，
    // 低头给脚下的雪层加一层时 `(x,y,z)` 正好是玩家站着的格子，
    // 先判就会得到"站着的时候永远叠不上去"（原版是能叠的）。
    //
    // ⚠️ 但对**完全没有碰撞体的方块**（花、火把、藤蔓、水里的海带……）这一条不适用：
    // 它们放下去也挡不住人，原版同样允许把它们放进自己站着的那一格。
    // 海带正是这种情形——玩家多半是"浮在海底上方那一格、往脚下种"，先判会得到
    // "怎么点都种不下去"，而放置规则本身没有任何问题（判据用形状的碰撞盒，不看 id）。
    const collides = collisionBoxes(blockDef(blockId).shape, plan.state).length > 0;
    if (!plan.mergeInto && !plan.mergeIntoTarget && collides && this.physics.blockIntersects(x, y, z)) return;

    // 台阶叠成双层 / 雪层叠高：改的是**命中方块自身**，不是命中面外侧那一格
    if (plan.mergeInto) {
      const { x: hx, y: hy, z: hz } = this.hit;
      if (this.world.setBlockAndUpdate(hx, hy, hz, blockId, plan.mergeInto.state)) {
        this.placeCooldown = PLACE_COOLDOWN;
        this.inventory.consume(blockId, 1);
        // 进度（M7）：合并类放置也算"放下了这个方块"（雪层叠高、台阶叠双层）
        this.reportProgress({ kind: 'place', block: blockId });
      }
      return;
    }

    // 藤蔓"再挂一面"：改的是**落点那一格**（它已经是同一种藤蔓了）
    if (plan.mergeIntoTarget) {
      if (this.world.setBlockAndUpdate(x, y, z, blockId, plan.mergeIntoTarget.state)) {
        this.placeCooldown = PLACE_COOLDOWN;
        this.inventory.consume(blockId, 1);
        this.net.sendBlock(x, y, z, blockId, plan.mergeIntoTarget.state, this.dimension);
        // 进度（M7）：藤蔓"再挂一面"同样是放下
        this.reportProgress({ kind: 'place', block: blockId });
      }
      return;
    }

    // 手上那一份完整栈（放置**之前**取：潜影盒的内容就在它身上，consume 之后就拿不到了）
    const held = this.inventory.get(this.hotbarIndex);

    if (this.world.setBlockAndUpdate(x, y, z, blockId, plan.state)) {
      if (plan.extra) {
        const { dx, dy, dz, id, state } = plan.extra;
        this.world.setBlockAndUpdate(x + dx, y + dy, z + dz, id, state);
      }
      this.placeCooldown = PLACE_COOLDOWN;
      this.inventory.consume(blockId, 1);

      // 避雷针（批次 83）：放下就进索引（不必等区块重载——它在**当前**加载的区块里）
      if (blockId === Block.LIGHTNING_ROD) this.noteRodPlaced(x, y, z);
      if (blockId === Block.SPAWNER) this.noteSpawner(x, y, z);
      // 信标（K5，批次 117）：放下就登记（顺手算一次等级，光柱下一刻就亮）
      if (blockId === Block.BEACON) this.noteBeacon(x, y, z);
      // 凋灵骷髅头（批次 116）：摆上去之后看看"4 块灵魂沙 + 3 颗头"齐了没有
      if (blockId === Block.WITHER_SKELETON_SKULL) this.trySummonWither(x, y, z);

      // 进度（M7）：放下方块。"种下一颗种子"也走这条——种子是**方块物品**
      // （`Item.WHEAT_SEEDS` 的 `block` 就是 `WHEAT_STAGE0`），所以它本来就落在放置这条路上
      this.reportProgress({ kind: 'place', block: blockId });

      // 潜影盒（批次 72）：物品里带着的内容**倒回方块**（原版如此）。
      // 空盒子也照样建一个容器——放着不管的话，第一次打开界面才建，
      // 而"被漏斗塞东西"这条路径会先撞上"这一格没有容器"
      if (blockId === Block.SHULKER_BOX) {
        const box = this.world.containers.getOrCreateShulkerBox(this.dimension, x, y, z);
        fillShulkerBox(box, held?.contents);
      }

      // 营火（批次 47）：**放下就是点着的**（原版如此）。
      // 这里要把容器建出来、并把点燃位写进方块状态——不建容器的话 tick 循环
      // 根本不知道这一格存在（营火不烤东西、方块也一直显示成"没点着"）。
      if (blockId === Block.CAMPFIRE) {
        this.world.containers.getOrCreateCampfire(this.dimension, x, y, z);
        this.world.setStateAndUpdate(x, y, z, withLitState(plan.state, true));
      }

      // 漏斗（批次 58）：放下就必须把容器建出来（tick 循环是按容器表推的）。
      // 与联机同步、控制台 API 那两条路径共用同一个入口，免得只有手动放置能用
      this.ensureBlockEntityAt(x, y, z, blockId);

      // 触觉反馈：放下一块方块的轻震
      this.vibrate(6);
      this.audio.play('place', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      this.hand.swing();
      // 联机：把这次改动广播给队友
      this.net.sendBlock(x, y, z, blockId, this.world.getBlockState(x, y, z), this.dimension);
      if (plan.extra) {
        const { dx, dy, dz, id, state } = plan.extra;
        this.net.sendBlock(x + dx, y + dy, z + dz, id, state, this.dimension);
      }
    }
  }

  // ---------------------------------------------------------------- 下界传送门（K8）

  /**
   * 摆上一颗凋灵骷髅头之后，看看这套仪式齐了没有（批次 116，J14）。
   *
   * 三行摆法都在 `core/world/WitherSummon.ts`（纯逻辑，可离线断言）；
   * 这里只做它做不了的三件事：**把三颗头清掉**（原版召唤成功时头会消失）、
   * 广播给队友、造出凋灵。
   *
   * ⚠️ "头没清干净就不召唤"是**故意的**：清不掉只有一种可能——那几格所在的区块
   * 没加载好。这种时候宁可这次不算数（玩家再戳一下），也不要把凋灵放出来而头还在，
   * 那样下一次摆头会再造一只。
   */
  private trySummonWither(x: number, y: number, z: number): void {
    const layout = witherPatternAt(this.witherSummonWorld, x, y, z);
    if (!layout) return;
    if (consumeSummonSkulls(this.witherSummonWorld, layout) !== layout.skulls.length) return;

    for (const skull of layout.skulls) {
      this.net.sendBlock(skull.x, skull.y, skull.z, Block.AIR, 0, this.dimension);
      this.particles.spawnSmoke(skull.x + 0.5, skull.y + 0.3, skull.z + 0.5, 8, 0.3);
    }
    this.audio.play('explode', { x, y, z });
    this.particles.spawnSmoke(layout.center.x + 0.5, layout.center.y + 0.5, layout.center.z + 0.5, 40, 0.8);
    // 凋灵生成在**中间那颗头**刚刚让出来的那一格（原版也是"从 T 形里长出来"）
    const wither = createMob(WITHER_TYPE, layout.center.x + 0.5, layout.center.y, layout.center.z + 0.5);
    this.entities.spawn(wither);
    this.chat.push('凋灵被唤醒了', 'system');
  }

  /** 玩家脚下或身体所在的那一格是不是传送门方块 */
  private playerInPortal(): boolean {
    const p = this.physics;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (this.world.getBlock(x, Math.floor(p.y + 0.2), z) === Block.NETHER_PORTAL) return true;
    return this.world.getBlock(x, Math.floor(p.y + 1), z) === Block.NETHER_PORTAL;
  }

  /**
   * 玩家脚下或身体所在的那一格是不是**末地传送门**方块（K9，批次 111）。
   *
   * 与 `playerInPortal` 是同一套判据、只换了方块——**不复用**它是因为两者的
   * 后续行为完全不同（一个是站 4 秒建门，一个是碰到就传）。
   */
  private playerInEndPortal(): boolean {
    const p = this.physics;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (this.world.getBlock(x, Math.floor(p.y + 0.2), z) === Block.END_PORTAL) return true;
    return this.world.getBlock(x, Math.floor(p.y + 1), z) === Block.END_PORTAL;
  }

  /** 玩家正站在哪座门上（用来让目的地的新门与它同朝向）；找不到就当沿 X 轴 */
  private currentPortalAxis(): PortalAxis {
    const p = this.physics;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    for (const y of [Math.floor(p.y + 0.2), Math.floor(p.y + 1)]) {
      if (this.world.getBlock(x, y, z) === Block.NETHER_PORTAL) {
        return portalAxis(this.world.getBlockState(x, y, z));
      }
    }
    return 'x';
  }

  /**
   * 站门计时（K8）。按 20Hz 结算：普通模式 80 tick（4 秒）、创造模式 1 tick（原版数值）。
   * 传送后的 300 tick 冷却期内不再计时，否则一落地就被立刻传回去。
   */
  private tickPortal(): void {
    if (this.portalCooldownTicks > 0) {
      this.portalCooldownTicks--;
      this.portalTicks = 0;
      return;
    }
    if (this.pendingArrival) return;
    if (!this.playerInPortal()) {
      this.portalTicks = 0;
      return;
    }

    // 创造模式（批次 181 起与"在飞"分开）走瞬发，原版对创造/旁观返回 1
    const wait = this.isCreative ? PORTAL_CREATIVE_IGNITE_TICKS : PORTAL_IGNITE_TICKS;
    this.portalTicks++;
    if (this.portalTicks >= wait) this.travelThroughPortal();
  }

  /** 传送：算出另一边的坐标，切维度，然后把落地交给 `resolvePortalArrival` */
  private travelThroughPortal(): void {
    const p = this.physics;
    const target = portalTarget(this.dimension, p.x, p.y, p.z);
    const axis = this.currentPortalAxis();
    this.portalTicks = 0;
    this.audio.play('portal');
    this.particles.spawnPortal(p.x, p.y + 0.6, p.z, 14, 0.5);

    // 先记下这次传送（落地要等目的地的区块加载出来），再切维度：
    // `setDimension` 会清空区块并按新位置重新流式加载
    this.pendingArrival = { ...target, axis, frames: 0, kind: 'nether' };
    this.setDimension(target.dimension, target);
  }

  /**
   * 末地传送门（K9，批次 111）的落地计时。
   *
   * 原版末地传送门是**碰到就传**（不像下界门要站 4 秒、也没有"点燃"这回事），
   * 所以这里只等 `END_PORTAL_WAIT_TICKS`（1 tick）——留这一 tick 是为了让它与下界门
   * 共用同一套"传送冷却 + 落地区块等待"的机制，而不是另起一条路。
   */
  private tickEndPortal(): void {
    if (this.portalCooldownTicks > 0) {
      this.endPortalTicks = 0;
      return;
    }
    if (this.pendingArrival) return;
    if (!this.playerInEndPortal()) {
      this.endPortalTicks = 0;
      return;
    }
    this.endPortalTicks++;
    if (this.endPortalTicks >= END_PORTAL_WAIT_TICKS) this.travelThroughEndPortal();
  }

  /**
   * 踏进末地传送门：去哪由 `endPortalTarget` 算
   * （**末地 → 世界出生点**，其它 → 末地的 5×5 到达平台）。
   *
   * 落地不在这里做：先切维度、由 `resolvePortalArrival` 等区块到了再放人
   * （与下界门同一条路——新区块没加载出来时 `getBlock` 一律是空气，人会在"空世界"里往下掉）。
   */
  private travelThroughEndPortal(): void {
    const p = this.physics;
    const [sx, sy, sz] = this.spawnPoint;
    const target = endPortalTarget(this.dimension, { x: sx, y: sy, z: sz });
    const toEnd = target.dimension === Dimension.END;
    this.endPortalTicks = 0;
    this.audio.play('portal');
    this.particles.spawnPortal(p.x, p.y + 0.6, p.z, 14, 0.5);
    this.pendingArrival = { ...target, axis: 'x', frames: 0, kind: toEnd ? 'end' : 'spawn' };
    this.setDimension(target.dimension, target);
    // 末地传送门只有"主世界 → 末地"这一侧是正门，回来时落的是**世界出生点**：
    // 与原版一致，但玩家第一次遇到会意外，所以给一句话
    if (!toEnd) this.chat.push('末地传送门把你送回了世界出生点', 'system');
  }

  /**
   * 目的地落地：区块加载完之后调用（每帧一次）。
   *
   * 三种到达（`pendingArrival.kind`，批次 111 起）：
   *  - `nether`：优先找**已有的门**（16 格半径），找不到就照着目标点**新建一座 2×3 的门**。
   *    两者都不成（比如目标点整根柱子都是实心岩石）时就直接把人放在目标坐标上——
   *    宁可落在地形里，也不要让人卡在"传送中"出不来；
   *  - `end`：把末地那一侧的 5×5 黑曜石**到达平台**补出来，再把人放在正中；
   *  - `spawn`：从末地回主世界，直接落在**世界出生点**（没有门要找、也没有门要建）。
   */
  private resolvePortalArrival(): void {
    const pending = this.pendingArrival;
    if (!pending) return;
    pending.frames++;

    // 中途玩家又自己切了维度（N 键 / 命令）：放弃这次落地
    if (this.dimension !== pending.dimension) {
      this.pendingArrival = null;
      return;
    }

    if (!this.world.isLoaded(pending.x, pending.z)) {
      // 区块迟迟不来也不能永远等着（否则玩家会一直被冻住）
      if (pending.frames < PORTAL_ARRIVAL_TIMEOUT_FRAMES) return;
      this.pendingArrival = null;
      // 末地那一侧就算区块没来也先补平台：那块平台悬在虚空上，不补的话人一落地就掉下去
      if (pending.kind === 'end') buildEndArrivalPlatform(this.portalWorld);
      this.physics.teleport(pending.x, pending.y, pending.z);
      this.portalCooldownTicks = PORTAL_COOLDOWN_TICKS;
      return;
    }

    if (pending.kind === 'end' || pending.kind === 'spawn') {
      this.pendingArrival = null;
      this.portalCooldownTicks = PORTAL_COOLDOWN_TICKS;
      this.portalTicks = 0;
      this.endPortalTicks = 0;
      // 末地那一侧先补平台：玩家站在虚空上方落地会直接掉下去
      if (pending.kind === 'end') buildEndArrivalPlatform(this.portalWorld);
      this.physics.teleport(pending.x, pending.y, pending.z);
      this.particles.spawnPortal(pending.x, pending.y + 0.6, pending.z, 12, 0.4);
      this.applyEnvironment();
      this.screenEffects.snap();
      return;
    }

    const shape =
      findPortalNear(this.portalWorld, pending.x, pending.y, pending.z) ?? this.buildArrivalPortal(pending);
    this.pendingArrival = null;
    this.portalCooldownTicks = PORTAL_COOLDOWN_TICKS;
    this.portalTicks = 0;

    if (shape) {
      const center = portalCenter(shape);
      this.physics.teleport(center.x, center.y, center.z);
      this.particles.spawnPortal(center.x, center.y + 0.6, center.z, 12, 0.4);
    } else {
      this.physics.teleport(pending.x, pending.y, pending.z);
    }
    // 换维度与传送都会让"视野色罩"变一下（水下/岩浆/门），立刻重算一次
    this.applyEnvironment();
    this.screenEffects.snap();
  }

  /**
   * 敲掉门框上的一块黑曜石之后清场（K8）。
   *
   * 原版是门方块自己在邻居变化时重算 `canSurvive`；这里反过来做：
   * 破坏方块时主动查一次相邻的门方块（最多几十次读方块），逻辑集中在一处，也好断言。
   */
  private breakPortalsBeside(x: number, y: number, z: number): void {
    const removed = clearBrokenPortalsAround(this.portalWorld, x, y, z);
    if (removed.length === 0) return;

    for (const [px, py, pz] of removed) {
      this.net.sendBlock(px, py, pz, Block.AIR, 0, this.dimension);
      this.particles.spawnPortal(px + 0.5, py + 0.5, pz + 0.5, 4, 0.3);
    }
    this.audio.play('portal', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  }

  /**
   * 拆掉一格末地传送门框架之后清场（K9，批次 111）。
   *
   * 与 `breakPortalsBeside` 同一条做法：破坏方块时主动查一次附近还留着的门方块，
   * 圈不完整就整片清掉，并把改动广播给队友。
   */
  private breakEndPortalsBeside(x: number, y: number, z: number): void {
    const removed = clearBrokenEndPortalsAround(this.portalWorld, x, y, z);
    if (removed.length === 0) return;
    for (const [px, py, pz] of removed) {
      this.net.sendBlock(px, py, pz, Block.AIR, 0, this.dimension);
      this.particles.spawnPortal(px + 0.5, py + 0.5, pz + 0.5, 4, 0.3);
    }
    this.audio.play('portal', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
  }

  /** 目的地没有现成的门：新建一座（黑曜石框 + 门方块），并把它们广播给队友 */
  private buildArrivalPortal(pending: PortalTarget & { axis: PortalAxis }): PortalShape | null {
    const site = findPortalSite(
      this.portalWorld,
      pending.x,
      pending.y,
      pending.z,
      pending.axis,
      pending.dimension,
    );
    if (!site) return null;
    if (!buildPortal(this.portalWorld, site)) return null;

    for (const [x, y, z] of [...portalFrame(site), ...portalInterior(site)]) {
      this.net.sendBlock(x, y, z, this.world.getBlock(x, y, z), this.world.getBlockState(x, y, z), this.dimension);
    }
    return site;
  }

  // ---------------------------------------------------------------- 出生点

  /**
   * 在已加载区域寻找一块自然、平坦、头顶无阻挡的陆地。
   * 平整度优先，其次偏向平原 / 草甸 / 森林 / 丛林，避免出生在树冠、悬崖和裸山尖。
   */
  private tryResolveSpawn(): void {
    if (this.spawnResolved || this.waitingForSaveRestore) return;
    if (this.world.chunks.size < 21) return;

    const radius = Math.max(16, Math.min(96, this.viewDistanceNow * 16 - 4));
    const spawn = findSafeSpawn(
      this.world,
      (x, z) => this.biomeNameAt(x, z),
      this.spawnSearchX,
      this.spawnSearchZ,
      radius,
    );
    if (!spawn) return;

    this.physics.teleport(spawn.x, spawn.y, spawn.z);
    this.spawnPoint = [spawn.x, spawn.y, spawn.z];
    this.lastPlayerX = spawn.x;
    this.lastPlayerZ = spawn.z;
    this.fallStartY = null;
    this.pendingFallDistance = 0;
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.spawnResolved = true;
    this.refreshWorld(toChunkCoord(spawn.x), toChunkCoord(spawn.z), true);
  }

  // ---------------------------------------------------------------- 生存

  /**
   * 每帧调用：跟踪下落高度与疲劳值，并把帧时间累积成 20Hz 的游戏 tick。
   *
   * 生存机制必须按原版的 20 tick/秒 结算 —— 直接用帧时间会在高帧率下把
   * 饥饿与回血速度放大好几倍。
   */
  private updateSurvival(dt: number, input: PlayerInput, wasOnGround: boolean): void {
    const p = this.physics;

    // ---- 下落高度：离开地面时记录最高点，落地那一 tick 结算摔落伤害
    //
    // ⚠️ 攀爬（B11：梯子/藤蔓/锁链）必须一起清掉：贴着梯子往下滑**不算摔落**，
    // 否则从梯子上溜下来会莫名其妙摔伤（`p.onClimbable` 就是为此加的状态）。
    if (this.flying || p.inWater || p.onClimbable) {
      this.fallStartY = null;
    } else if (p.onGround) {
      // 粘液块（批次 120）：落在它上面**不摔伤、还会弹起来**，所以这里排在"记摔落高度"
      // 之前——弹了就当场清掉高度，`pendingFallDistance` 也一并归零（不摔伤）
      const bounce = this.slimeBounce();
      if (bounce > 0) {
        p.vy = bounce;
        p.onGround = false;
        this.fallStartY = null;
        this.pendingFallDistance = 0;
        // 那一下"啪"：用一簇绿色的火花代替（原版有专门的粘液音效，本项目还没有，
        // 见 TASKS M21）
        this.particles.spawnFlame(p.x, p.y + 0.1, p.z, 0x8fdc5a, 6);
        this.audio.play('step', { x: p.x, y: p.y, z: p.z });
        this.vibrate(8);
        return;
      }
      if (this.fallStartY !== null) {
        const distance = this.fallStartY - p.y;
        if (distance > 3) this.pendingFallDistance = distance;
      }
      this.fallStartY = null;
    } else if (p.vy < -0.2) {
      this.fallStartY = this.fallStartY === null ? p.y : Math.max(this.fallStartY, p.y);
    }

    // ---- 疲劳值：走路每格 0.01、疾跑每格 0.1、跳跃 0.05（疾跑跳 0.2）
    const distance = Math.hypot(p.x - this.lastPlayerX, p.z - this.lastPlayerZ);
    this.lastPlayerX = p.x;
    this.lastPlayerZ = p.z;
    if (distance > 0 && !this.flying) {
      this.stats.addExhaustion(distance * (input.sprint ? 0.1 : 0.01));
    }
    if (input.jump && wasOnGround && !this.flying) {
      this.stats.addExhaustion(input.sprint ? 0.2 : 0.05);
    }

    // ---- 20Hz 游戏 tick（一帧最多补 4 个，避免卡顿后追帧雪崩）
    this.tickAccumulator = Math.min(this.tickAccumulator + dt, 1);
    let ticks = 0;
    while (this.tickAccumulator >= TICK_SECONDS && ticks < 4) {
      this.tickAccumulator -= TICK_SECONDS;
      ticks++;
      this.tickEffects();
      this.stats.tick(this.survivalEnvironment());
      this.tickPortal();
      this.tickEndPortal();
      this.tickWorldBlocks(TICK_SECONDS);
      // 摔落伤害只结算一次，避免同一帧的多个 tick 重复扣血
      this.pendingFallDistance = 0;
    }

    this.vitalsHud.update(this.stats);
    this.xpHud.update(this.experience);
    this.chat.update();
    this.updateEffectsHud();
    // 水面动画的时间（与昼夜时间分开：调 /time 不该让水面跳一下）
    this.waterTime += dt;
    this.solidMaterial.setTime(this.waterTime);
    this.translucentMaterial.setTime(this.waterTime);

    // ---- 死亡与重生
    if (this.stats.dead) {
      // 死亡只结算一次：把背包里的东西掉在原地（keepInventory 打开时保留）
      if (!this.deathHandled) {
        this.deathHandled = true;
        this.dropInventoryOnDeath();
        this.dropExperienceOnDeath();
      }
      this.deathEl.classList.remove('hidden');
      this.respawnCountdown += dt;
      if (this.respawnCountdown >= RESPAWN_DELAY) this.respawnPlayer();
    } else {
      if (this.respawnCountdown !== 0) this.respawnCountdown = 0;
      this.deathEl.classList.add('hidden');
      this.deathHandled = false;
    }
  }

  /** 采集一帧的环境快照（水 / 岩浆 / 窒息 / 虚空） */
  private survivalEnvironment(): SurvivalEnvironment {
    const p = this.physics;
    const eye = this.world.getBlock(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    const feetX = Math.floor(p.x);
    const feetY = Math.floor(p.y + 0.15);
    const feetZ = Math.floor(p.z);
    const feet = this.world.getBlock(feetX, feetY, feetZ);
    const body = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 1.0), Math.floor(p.z));
    // 岩浆锅（批次 177，G13 收尾）：站在里面等同泡岩浆——原版也烫脚
    const feetLavaCauldron =
      feet === Block.CAULDRON && isLavaCauldronState(this.world.getBlockState(feetX, feetY, feetZ));
    const bodyLavaCauldron =
      body === Block.CAULDRON &&
      isLavaCauldronState(this.world.getBlockState(Math.floor(p.x), Math.floor(p.y + 1.0), Math.floor(p.z)));

    return {
      eyeInWater: eye === Block.WATER,
      inLava: feet === Block.LAVA || body === Block.LAVA || feetLavaCauldron || bodyLavaCauldron,
      // 站在火里（I12）：脚或身体所在格是火焰 → 被点燃 + 每秒掉血。
      // 批次 48 起也包含**点着的营火**（熄灭的不算）——它同样会烫脚
      inFire:
        feet === Block.FIRE ||
        body === Block.FIRE ||
        burnsOnContact(feet, this.world.getBlockState(feetX, feetY, feetZ)),
      // 仙人掌还没进方块表，先保持关闭（加了之后这里改成四邻检测）
      onCactus: false,
      // 岩浆块（批次 121）：脚底下那一格是岩浆块 → 每秒 1 点火焰伤害。
      // 与生物那边**共用同一个算式**（`standsOnMagmaBlock`），见那里的注记
      onMagma: this.standsOnMagmaBlock(p.x, p.y, p.z),
      suffocating: body !== Block.AIR && blockDef(body).opaque,
      fallDistance: this.pendingFallDistance,
      y: p.y,
      // 批次 181：能力看模式，不再看"在不在飞"
      creative: this.isCreative,
      // 难度与游戏规则影响饥饿/回复（和平难度饿不死、回血更快）
      naturalRegeneration: this.rules.naturalRegeneration,
      starveRate: difficultyProfile(this.difficulty).starveRate,
      regenRate: difficultyProfile(this.difficulty).regenRate,
      // 水下呼吸效果：氧气不掉；抗火效果：岩浆不掉血
      waterBreathing: this.effects.waterBreathing,
      fireImmune: this.effects.fireResistant,
    };
  }

  /**
   * 死亡时把背包掉在原地。
   * `keepInventory` 打开时物品留在背包里（原版行为）。
   */
  private dropInventoryOnDeath(): void {
    if (this.rules.keepInventory) return;
    const x = this.physics.x;
    const y = this.physics.y + 0.5;
    const z = this.physics.z;

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const stack = this.inventory.get(i);
      if (!stack) continue;
      this.spawnDrop(stack.id, stack.count, x, y, z);
    }
    this.inventory.clear();
    this.refreshHotbar();
    this.inventoryScreen.refresh();
  }

  /**
   * 死亡掉经验（I5 + I16）。
   *
   * 原版是**掉一地经验球、可以跑回去捡**；批次 170 之前本项目只是清零
   * （那时没有经验球实体）。现在按原版那条公式掉：`min(等级 × 7, 100)` 点，
   * 散在死亡点；`keepInventory` 打开时连经验一起保留（与原版一致）。
   */
  private dropExperienceOnDeath(): void {
    if (this.rules.keepInventory) return;
    const dropped = Math.min(this.experience.level * 7, 100);
    this.experience.reset();
    if (dropped > 0) this.spawnXpOrbs(dropped, this.physics.x, this.physics.y + 0.5, this.physics.z);
  }

  /**
   * 重生点：优先用**床**（睡过才有），床没了/对不上就回退世界出生点。
   *
   * 为什么要校验"床还在不在"：原版重生前会检查重生点那个方块还是不是床
   * （床被拆掉、被爆掉之后死亡不该回到虚空中）。校验同时覆盖两件事：
   *  ① 那一格还是不是**床**（同一个形状族就够了，颜色可能被换过）；
   *  ② 另一半还在不在（半张床是个脏状态，不该拿它当重生点）。
   */
  private resolveRespawnPoint(): { x: number; y: number; z: number; dimension: DimensionId } {
    const bed = this.bedSpawn;
    if (bed) {
      if (bed.dimension === this.dimension) {
        const id = this.world.getBlock(bed.x, bed.y, bed.z);
        const other = bedOtherHalf(bed.x, bed.y, bed.z, this.world.getBlockState(bed.x, bed.y, bed.z));
        if (isBed(id) && isBed(this.world.getBlock(other[0], other[1], other[2]))) {
          return { x: bed.x + 0.5, y: bed.y + 1.2, z: bed.z + 0.5, dimension: bed.dimension };
        }
        // 床没了：这一份重生点作废，下次睡觉才会重新记
        this.bedSpawn = null;
        this.chat.push('你的床不在了，回世界出生点复活', 'system');
      } else {
        // ⚠️ 床在**别的维度**：切维度会把区块重新流式加载，这一刻 `getBlock` 一律返回空气，
        // 所以**没法在校验**"那张床还在不在"——直接把落点交给 `setDimension`（与传送门同一条路），
        // 人一到那边就站在床边。床被拆掉的话会在那边自然暴露（差异记在 TASKS B13）
        const landing = { x: bed.x + 0.5, y: bed.y + 1.2, z: bed.z + 0.5 };
        this.setDimension(bed.dimension, landing);
        return { ...landing, dimension: bed.dimension };
      }
    }
    // 没有床（或者床没了）：回**世界出生点**——它在主世界，所以要连维度一起切。
    // 顺手修掉一个老问题：在下界死掉时，原来只把坐标换成主世界出生点的坐标、
    // 维度却还停在下界（表现为"重生后被埋在下界的石头里"）
    if (this.dimension !== Dimension.OVERWORLD) this.setDimension(Dimension.OVERWORLD);
    const [sx, sy, sz] = this.spawnPoint;
    return { x: sx, y: sy, z: sz, dimension: Dimension.OVERWORLD };
  }

  private respawnPlayer(): void {
    // 死亡界面上的点击/长按不该带进重生后的第一帧
    this.touch?.resetInput('respawn');
    const point = this.resolveRespawnPoint();
    const [sx, sy, sz] = [point.x, point.y, point.z];
    // 床重生点可能在世界出生点之外的维度（在下界死掉、床在主世界）：
    // `resolveRespawnPoint` 已经切好了维度，这里只负责把人放上去
    this.physics.teleport(sx, sy, sz);
    this.physics.vx = 0;
    this.physics.vy = 0;
    this.physics.vz = 0;
    this.stats.respawn();
    // 死亡会清空状态效果（原版行为）
    this.effects.clear();
    this.fallStartY = null;
    this.pendingFallDistance = 0;
    this.respawnCountdown = 0;
    this.lastPlayerX = sx;
    this.lastPlayerZ = sz;
    this.deathEl.classList.add('hidden');
    // 重生点与传送门无关：站门计时、冷却与"传送途中"一律清掉，
    // 免得死在下界的门里、重生回主世界之后还顶着 15 秒冷却
    this.portalTicks = 0;
    this.portalCooldownTicks = 0;
    this.pendingArrival = null;
  }

  // ---------------------------------------------------------------- 主循环

  /**
   * 移动端降级策略（K6 的视距 + N7 的分辨率 / 限帧 / 粒子总量，批次 130）。
   *
   * 每帧推进一步：帧时间滑动平均超过 22ms（约 45fps）就**先降分辨率**
   * （0.5~1 倍，一次 0.1），分辨率到底了才继续降视距；有余量时**反过来**升
   * （先把视距还回去，最后才把分辨率升满）。所有阈值、冷却、优先级都在
   * `core/world/PerfPolicy.ts` 里，这里只把结果落下去。
   *
   * ⚠️ 玩家设定的视距是**上限**：自适应只在这个值以下活动，不会超过玩家的选择。
   */
  private updatePerfPolicy(dt: number): void {
    // `simulateFrameTime` 会把帧时间固定成一个高值（验收脚本用它复现"掉帧"）
    const frameTime = this.simulatedFrameTime > 0 ? this.simulatedFrameTime : dt * 1000;
    const before = this.perf;
    const mobile = isTouchDevice();
    // 视距上限：手机另有一个更小的上限（屏幕小，不需要展示那么远），见 `viewDistanceCapFor`
    const cap = viewDistanceCapFor(this.settings.viewDistance, mobile);
    const { state, action } = perfPolicyStep(before, dt, frameTime, {
      adaptiveResolution: this.settings.adaptiveResolution,
      adaptiveViewDistance: this.settings.adaptiveViewDistance,
      viewDistanceCap: cap,
      // 分辨率是最后手段：手机只降到 0.75，桌面才允许到 0.5
      resolutionFloor: mobile ? MOBILE_RESOLUTION_MIN : RESOLUTION_MIN,
    });
    this.perf = state;
    if (action === null) return;

    if (state.viewDistance !== before.viewDistance) {
      this.setViewDistance(state.viewDistance);
      console.info(
        `[perf] 帧时间 ${state.frameTimeAvg.toFixed(1)}ms，视距 ${state.viewDistance}（上限 ${cap}）`,
      );
    }
    if (state.decorLevel !== before.decorLevel) {
      this.applyDecorLevel();
      console.info(`[perf] 装饰层 → ${state.decorLevel}（关掉天上与远处的，近处不变）`);
    }
    if (state.resolutionScale !== before.resolutionScale) {
      this.applyResolutionScale();
      console.info(`[perf] 渲染分辨率 ×${state.resolutionScale}（视距与装饰层都让完了，才轮到它）`);
    }
  }

  /**
   * 把分辨率倍率落到渲染器上（批次 130，N7 的"动态分辨率"）。
   *
   * ⚠️ `setSize` 的第三个参数是 `updateStyle`，**必须传 `false`**：传 true 的话 canvas 的
   * CSS 尺寸也会被乘上倍率，画面会跟着缩放——那就不是"降分辨率省填充率"，
   * 而是"把整个画面缩小了"（看起来像改了视口，不是像降了画质）。
   */
  private applyResolutionScale(): void {
    const scale = this.perf.resolutionScale;
    this.renderer.setPixelRatio(effectivePixelRatio(devicePixelRatioValue(), scale, this.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    // 粒子的点尺寸是按"设备像素"算的（`setViewport` 拿的就是缓冲区高度），
    // 所以分辨率一变要重新告诉它一次，否则粒子会跟着分辨率一起变大或变小
    this.particles.setViewport(this.camera.fov, this.renderer.domElement.height);
  }

  /**
   * 把装饰层档位落到三个渲染对象上（批次 158 的第三档降级）。
   *
   * 这三项的共同点是：**都不在近处**——云在天上、粒子是一瞬、雨是满屏的透明点。
   * 关掉它们省的是填充率与 draw call，而玩家手里的方块、脚下的地面一点都不变，
   * 所以它排在"降分辨率"**之前**（分辨率是全局的，会把近处一起糊掉）。
   *
   * ⚠️ 云与粒子仍然尊重玩家自己的设置：设置里关掉的，档位回到 0 也不会打开。
   */
  private applyDecorLevel(): void {
    const decor = this.perf.decorLevel;
    this.sky.setCloudsVisible(decorCloudsVisible(decor) && this.settings.clouds);
    this.particles.setBudget(decorParticleBudget(this.settings.particles, decor));
    // 天气效果（批次 172，M20）：关掉就一个雨点都不画，但**天气本身照旧**
    // （火焰照样被雨浇灭、炼药锅照样接水）——它关的只是"画出来的那一层"
    this.weather.setIntensity(this.settings.weatherEffects ? decorRainFraction(decor) : 0);
  }

  /**
   * 脚步与听觉位置（K5）。
   *
   * 脚步按**水平位移**累积而不是按时间：走动时约每 1.6 格一声（与原版节奏接近），
   * 站着不动不会响，蹲行（速度慢）自然也就稀疏了。
   */
  private updateAudio(dt: number): void {
    this.audio.setListener(this.physics.x, this.physics.eyeY, this.physics.z);

    const dx = this.physics.x - this.lastStepX;
    const dz = this.physics.z - this.lastStepZ;
    this.lastStepX = this.physics.x;
    this.lastStepZ = this.physics.z;

    if (!this.physics.onGround) {
      this.stepDistance = 0;
      return;
    }
    this.stepDistance += Math.hypot(dx, dz);
    const stride = this.physics.inWater ? 2.2 : 1.6;
    if (this.stepDistance < stride) return;
    this.stepDistance = 0;
    // 踩水是水声；陆地上按脚下方块材质挑脚步音
    if (this.physics.inWater) {
      this.audio.play('splash');
    } else {
      const belowId = this.world.getBlock(
        Math.floor(this.physics.x),
        Math.floor(this.physics.y - 0.2),
        Math.floor(this.physics.z),
      );
      const name = blockDef(belowId).name.replace('minecraft:', '');
      if (name.includes('sand') || name.includes('gravel')) this.audio.play('break_sand');
      else if (name.includes('grass') || name.includes('leaves')) this.audio.play('break_grass');
      else if (name.includes('planks') || name.includes('log')) this.audio.play('break_wood');
      else this.audio.play('step');
    }
    void dt;
  }

  /** 改视距：相机远裁剪面、雾、区块流式范围一起更新 */
  private setViewDistance(distance: number): void {
    if (distance === this.viewDistance) return;
    this.viewDistance = distance;
    this.camera.far = cameraFarFor(distance);
    this.camera.updateProjectionMatrix();
    this.applyEnvironment();
    this.refreshWorld(toChunkCoord(this.physics.x), toChunkCoord(this.physics.z), true);
  }

  /**
   * 验收用：把帧时间固定成给定值（毫秒），0 表示恢复真实值。
   * 真机上没法稳定复现"掉帧"，但对自适应逻辑来说只需要一个持续的高帧时间输入。
   */
  simulateFrameTime(milliseconds: number): void {
    this.simulatedFrameTime = milliseconds;
  }

  private updateDebug(dt: number): void {
    this.frames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }

    const p = this.physics;
    const cx = toChunkCoord(p.x);
    const cz = toChunkCoord(p.z);
    // yaw=0 时朝向 (-sin, 0, -cos) = -Z，即原版定义的"北"
    const facing = ['北 (-Z)', '东 (+X)', '南 (+Z)', '西 (-X)'][Math.round(-this.yaw / (Math.PI / 2)) & 3]!;
    const clockHours = (this.timeOfDay * 24 + 6) % 24;
    const clock = `${String(Math.floor(clockHours)).padStart(2, '0')}:${String(Math.floor((clockHours % 1) * 60)).padStart(2, '0')}`;
    // 月相（批次 84）：第 N 天（满月起步，8 天一轮）
    const moon = `${moonPhaseName(moonPhaseFor(this.dayCount))}(第 ${this.dayCount} 天)`;

    const feetLight = this.world.getBlockLight(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z));
    const target = this.hit
      ? `${blockDef(this.world.getBlock(this.hit.x, this.hit.y, this.hit.z)).name.replace('minecraft:', '')} (${this.hit.x}, ${this.hit.y}, ${this.hit.z})${this.targetToolHint(this.world.getBlock(this.hit.x, this.hit.y, this.hit.z))}`
      : '无';

    const armorPoints = this.stats.armorPoints;

    // 手机上屏幕小：只保留最关键的几行，免得调试面板盖住半个屏幕
    if (this.touch) {
      this.debugEl.textContent =
        `${this.fps} fps   ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n` +
        `${GAME_MODE_LABELS[this.gameMode]}${this.flying ? '(飞行)' : ''}   ${clock}   ${moon}\n` +
        `持有 ${this.heldName}${armorPoints > 0 ? `   护甲 ${armorPoints}` : ''}`;
      return;
    }

    this.debugEl.textContent =
      `Bedrock 1.18 Web  ·  P1 物理 + 方块交互\n` +
      `${this.fps} fps   ${this.chunkRenderer.triangles.toLocaleString()} 三角形\n` +
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}   区块: ${cx}, ${cz}\n` +
      `朝向: ${facing}   时间: ${clock}   月相: ${moon}   难度: ${DIFFICULTY_LABELS[this.difficulty]}   模式: ${GAME_MODE_LABELS[this.gameMode]}${this.flying ? '(飞行)' : ''}   维度: ${DIMENSION_LABELS[this.dimension]}   视角: ${CAMERA_MODE_LABELS[this.cameraMode]}\n` +
      `在地面: ${p.onGround ? '是' : '否'}   在水中: ${p.inWater ? '是' : '否'}   脚下方块光: ${feetLight}\n` +
      `指向: ${target}${this.breakProgress > 0 ? `   破坏 ${Math.round(this.breakProgress * 100)}%` : ''}\n` +
      `持有: ${this.heldName}\n` +
      `视距: ${this.viewDistance}${this.settings.adaptiveViewDistance && this.viewDistance < this.settings.viewDistance ? `（自适应，上限 ${this.settings.viewDistance}）` : ''} 区块   雾: ${this.fogRadius.toFixed(1)}   已渲染: ${this.chunkRenderer.chunkMeshCount}   待网格化: ${this.chunkRenderer.queueLength}   在途: ${this.chunkRenderer.inFlightCount}   待生成: ${this.world.pendingCount}\n` +
      `生命: ${this.stats.health.toFixed(1)}/20   饥饿: ${this.stats.food}/20   饱和: ${this.stats.saturation.toFixed(1)}   氧气: ${this.stats.air}/300   疲劳: ${this.stats.exhaustion.toFixed(2)}   护甲: ${armorPoints}\n` +
      `经验: ${this.experience.level} 级 ${this.experience.progress}/${this.experience.toNext}（累计 ${this.experience.total}）\n` +
      `光照队列: ${this.world.lightWorkCount}   待重刷: ${this.pendingSettle.length / 3}\n` +
      // 世界边界（K12，批次 175）：只在"不是默认的 3 千万格"时才占一行，
      // 否则每个玩家的调试面板都会多一句永远不变的话
      (this.border.size < DEFAULT_BORDER_SIZE ? `${describeBorder(this.border)}\n` : '') +
      `联机: ${this.netStatus}${this.net.selfId > 0 ? `（#${this.net.selfId} · 在线 ${this.net.playerCount} 人）` : ''}` +
      (this.chatLine && performance.now() < this.chatUntil ? `\n${this.chatLine}` : '');
  }

  start(): void {
    // 批次 181：局内常驻一条返回守卫——**没有面板时按返回也要先落到我们手里**
    //（以前无面板时没有任何守卫，浏览器会直接退出页面，PWA 里等于退游戏）
    this.backButton.armRoot();
    // 读档是异步的：先让世界跑起来（玩家看到创建中的世界），读完再恢复位置与背包
    if (this.save?.hasSave) {
      void this.loadSaveState()
        .then((restored) => {
          // 读档还没回来玩家就退出了：不要再往已经销毁的世界里写
          if (this.disposed) return;
          this.waitingForSaveRestore = false;
          if (restored) console.info('[save] 已恢复上次的进度');
          else {
            // 种子不匹配、缺玩家数据：当新世界安全进入，而不是停在未请求任何区块的临时坐标。
            this.prepareNewWorldSpawn();
            this.armProgress();
          }
        })
        .catch((error: unknown) => {
          if (this.disposed) return;
          console.error('[save] 读档失败，按新世界进入', error);
          this.waitingForSaveRestore = false;
          this.prepareNewWorldSpawn();
          this.armProgress();
        });
    } else {
      // 新世界：没有存档要读，进度系统直接上岗（背包里此刻是开发期初始物资 → 记账为基线）
      this.armProgress();
    }

    // 切后台/关页面前补一次保存：移动端切走随时可能被系统回收
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') {
          // 切后台时手指的按下/抬起可能收不到：把输入清零，回来不会"自己一直走"
          this.wasHidden = true;
          this.touch?.resetInput('hidden');
          void this.saveNow('hidden');
        } else {
          // 批次 183：从后台回来偶尔会拿到 clientX/Y=0 的触摸；先重排一次
          this.touch?.recover('visible');
          // 批次 184：先落到暂停页，点一下才横屏全屏回到游戏
          if (this.wasHidden) this.handleReturnFromBackground();
        }
      },
      { signal: this.listeners.signal },
    );
    // 退出/重进全屏之后同样可能坐标异常（真机日志里正是这一段之后开始拖不动）
    document.addEventListener(
      'fullscreenchange',
      () => {
        this.touch?.recover('fullscreen');
      },
      { signal: this.listeners.signal },
    );

    // 浏览器要求音频必须由用户手势解锁：第一次点击/按键时创建 AudioContext
    const unlockAudio = (): void => {
      this.audio.resume();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio, { signal: this.listeners.signal });
    window.addEventListener('keydown', unlockAudio, { signal: this.listeners.signal });

    // 诊断日志（批次 181）：导出时把这些"现场参数"一起带上，
    // 否则一份日志只能看出"点了什么"，看不出"在哪个世界、什么设置下点的"
    diag.setMetaProvider(() => ({
      world: {
        id: this.worldConfig.id,
        name: this.worldConfig.name,
        seed: this.worldConfig.seed,
        type: this.worldConfig.worldType,
        difficulty: this.difficulty,
        dimension: this.dimension,
        mode: this.gameMode,
      },
      settings: {
        viewDistance: this.settings.viewDistance,
        fov: this.settings.fov,
        maxFps: this.settings.maxFps,
        touchScale: this.settings.touchScale,
        touchStick: this.settings.touchStick,
      },
      runtime: {
        uiOpen: this.uiOpen,
        flying: this.flying,
        sleeping: this.sleeping,
        entities: this.entities.all.length,
      },
    }));
    diag.event('app', 'world.start', {
      id: this.worldConfig.id,
      type: this.worldConfig.worldType,
      seed: this.worldConfig.seed,
      difficulty: this.worldConfig.difficulty,
      save: this.save?.hasSave === true,
    });

    const loop = () => {
      // 退出世界后不再排下一帧（否则旧 App 会继续画一个已经拆掉的世界）
      if (this.disposed) return;
      // 帧号进日志：复现时能对上"第几帧开始卡"
      diag.log.frame++;
      const now = performance.now();
      // 限帧（批次 130，N7）：上限只决定"这一帧来得太早就不画"。
      // ⚠️ 跳过时必须**继续排下一帧**（`requestAnimationFrame` 后再 return）——
      // 直接 return 会让循环停住，画面就此冻住（最容易写错的一处）
      const interval = frameIntervalMs(this.settings.maxFps);
      if (interval > 0 && now - this.lastTime < interval) {
        requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      this.tryResolveSpawn();

      // 触摸视角：在物理与射线之前应用，保证同一帧里"看到的"和"走到的"是一致的
      if (this.touch) {
        this.touch.setEnabled(!this.uiOpen);
        if (!this.uiOpen) {
          const look = this.touch.consumeLook();
          if (look.x !== 0 || look.y !== 0) {
            const gain = this.settings.sensitivity;
            this.applyLook(look.x * TOUCH_SENSITIVITY * gain, look.y * TOUCH_SENSITIVITY * gain);
          }
        } else {
          this.touch.consumeLook();
        }
      }

      const rawInput = this.uiOpen ? IDLE_INPUT : this.collectInput();
      const wasOnGround = this.physics.onGround;
      if (!this.spawnResolved || this.pendingArrival) {
        // 传送途中：目的地的区块还没流出来，`getBlock` 一律返回空气。
        // 新世界安全落点解析前也一样：玩家还在临时高度，绝不能先累计摔落或环境伤害。
        this.physics.vx = 0;
        this.physics.vy = 0;
        this.physics.vz = 0;
      } else if (this.sleeping) {
        // 睡觉（B13）：与传送途中同一条做法——把玩家冻在原地。
        // 我们不把玩家"摆进床里"（床只有 9/16 高、玩家 1.8 高，摆进去要另写一套姿态），
        // 所以睡觉期间人不动物理、只推遮罩，醒来还站在原地（差异记在 TASKS B13）
        this.physics.vx = 0;
        this.physics.vy = 0;
        this.physics.vz = 0;
      } else {
        this.physics.update(this.world, rawInput, this.yaw, dt, this.flying, this.effects.moveSpeedMultiplier(), this.effects.jumpMultiplier());
      }
      if (this.spawnResolved && !this.pendingArrival) {
        this.updateSurvival(dt, this.sleeping ? IDLE_INPUT : rawInput, wasOnGround);
      }
      // 床（B13）：睡觉的计时与结算。用**真实输入**是为了让"跳跃键提前起床"能被读到
      this.updateSleep(dt, rawInput);
      // 钓鱼（批次 81）：浮标飞行 / 等待咬钩 / 咬钩窗口，全在状态机里
      this.updateFishing(dt);
      // 雷电与避雷针（批次 83）：脉冲倒计时 + 雷暴里的打雷节奏
      this.updateLightning(dt);
      // 刷怪笼（批次 92）：下界要塞里的笼子按倒计时生成烈焰人
      this.updateSpawners(dt);
      // 信标（K5，批次 117）：光柱逐帧同步、效果每秒挂一次
      this.updateBeacons(dt);
      // 世界边界（K12，批次 175）：蓝墙逐帧摆位、越界判推回与伤害
      this.updateWorldBorder(dt);
      // 启动期的渐进视距（批次 100）：涨一格就重新按新的范围请求区块。
      // 帧率吃紧时先不涨（自适应视距那一套会把视距往下压，边卡边涨只会雪上加霜）
      if (!this.startupRamp.done) {
        const before = this.viewDistanceNow;
        // 帧时间吃紧（与自适应视距收缩同一条阈值 22ms）就先别往外涨：
        // 一边卡一边扩大范围，只会把"能玩"推得更远
        this.startupRamp.advance(dt, this.viewDistance, this.perf.frameTimeAvg > 22);
        if (this.viewDistanceNow !== before) {
          this.refreshWorld(toChunkCoord(this.physics.x), toChunkCoord(this.physics.z), true);
        }
        if (this.startupRamp.done) startupTrace.mark(STARTUP_PHASES.worldRampFull);
      }
      // 返回键守卫（批次 96）：界面开/关是**每帧对账**的——面板有六个、关闭路径更多
      //（点空白、点按钮、被别处挤掉），在每处各调一次迟早漏掉一个（漏掉就是"返回键突然失灵"）。
      // 与告示牌/展示框那两处"定期对账"同一个理由：**判据只有一处，就不会漂**
      this.backButton.sync(this.isAnyUiOpen());
      // 告示牌上的字（B12）：每 0.25 秒对一次账。
      // 为什么要定期对账而不是"事件驱动"：会改变这趟结果的三件事里有两件**没有事件**——
      // ① 区块流式加载/卸载（玩家走过去）；② 那格的光照变了（太阳落了、旁边点了火把）。
      this.signSyncTimer -= dt;
      if (this.signSyncTimer <= 0) {
        this.signSyncTimer = 0.25;
        this.syncSigns();
        // 展示框里挂着的东西（B14）：同一个节拍对账（两件事的"必须重新看世界一眼"
        // 的理由完全一样：区块流式加载/卸载、光照变化都没有事件）
        this.syncFrames();
      }
      // 背包对账（M7）：每秒一次。**不是**为了"发现新东西"（那个由 `onChange` 立刻管），
      // 而是兜底"东西早就在背包里、而它的父条目刚刚才达成"这类顺序问题——
      // 这类问题不改背包，所以逐条事件驱动的写法会永远错过
      this.progressReconcileTimer -= dt;
      if (this.progressReconcileTimer <= 0) {
        this.progressReconcileTimer = 1;
        this.reconcileObtainProgress();
      }
      this.resolvePortalArrival();

      this.updateCamera(dt);

      this.updateInteraction(dt);

      // 昼夜循环可以在设置里关掉（时间停在当前时刻，截图对比/搭建筑时有用）
      if (this.settings.daylightCycle) {
        const before = this.timeOfDay;
        this.timeOfDay = (this.timeOfDay + dt / this.dayLengthSeconds) % 1;
        // 跨过午夜 = 新的一天：月相往前推一格（批次 84）。判据就是"取模之后变小了"
        if (this.timeOfDay < before) this.advanceDay();
      }

      // 寒冷群系下雪：每秒复查一次地表方块即可
      this.snowCheckTimer -= dt;
      if (this.snowCheckTimer <= 0) {
        this.snowCheckTimer = 1;
        this.snowyHere = this.isSnowyColumn(Math.floor(this.physics.x), Math.floor(this.physics.z));
      }
      if (this.dimension === Dimension.OVERWORLD) {
        this.weather.update(dt, this.camera.position, this.snowyHere);
        this.sky.update(this.timeOfDay, this.camera.position, dt);
      }
      // 只有主循环传 dt：雾的平滑要按真实时间推进（其它调用点只是"重算一次"）
      this.applyEnvironment(dt);

      this.updateGamepad(dt);
      this.tickAutoSave(dt);
      this.updatePerfPolicy(dt);
      this.updateAudio(dt);
      this.net.tick(
        this.physics.x,
        this.physics.y,
        this.physics.z,
        this.yaw,
        this.pitch,
        this.dimension,
      );

      const centerCx = toChunkCoord(this.physics.x);
      const centerCz = toChunkCoord(this.physics.z);
      this.refreshWorld(centerCx, centerCz);

      // 光照预算：遮罩还在时开大（批次 103，桌面把"能玩"从 16s 压到 1s 内）。
      // 桌面：遮罩还在、或视距还没涨完，都用启动预算（那时候多花 CPU 换"早能玩"）。
      // 手机：只有遮罩还在才用较大的预算。视距没涨完如果也走 12 万步，
      // 帧时间下不去，视距永远涨不完，"启动期"就再也不会结束。
      const startupLighting = isTouchDevice() ? !this.loadingCleared : !this.loadingCleared || !this.startupRamp.done;
      const lightBusy = this.world.processLighting(lightBudgetForFrame(startupLighting, isTouchDevice()));

      // 光照收敛后再重刷一次方块改动过的区块，避免烘焙进未收敛的光照
      if (!lightBusy && this.pendingSettle.length > 0) {
        for (let i = 0; i < this.pendingSettle.length; i += 3) {
          this.chunkRenderer.enqueueAround(this.pendingSettle[i]!, this.pendingSettle[i + 2]!);
        }
        this.pendingSettle.length = 0;
      }

      if (!lightBusy) this.chunkRenderer.processQueue(MESH_BUDGET_PER_FRAME, centerCx, centerCz);

      this.tickContainers(dt);
      this.updateEntities(dt);
      this.updateParticles(dt);
      this.inventoryScreen.tickUi(dt);

      // 手持物品：跟快捷栏选中项同步，并按走路/挥动做动画。
      // 第三人称看的是玩家模型（手里没有画方块），所以第一人称的手臂要藏起来。
      this.hand.setItem(this.inventory.get(this.hotbarIndex)?.id);
      this.hand.update(dt, this.isPlayerMoving(), this.camera.fov, this.camera.aspect);
      this.particles.setViewport(this.camera.fov, this.renderer.domElement.height);
      this.screenEffects.update(dt);

      this.refreshLoadingState();
      this.updateBreakProgressUi();
      this.renderer.render(this.scene, this.camera);
      // 世界之后叠画"贴在屏幕上的两件事"：手持物品与视野色罩。
      // ⚠️ 必须先关掉 autoClear，否则第二次 render 会把刚画好的世界清掉。
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.hand.render(this.renderer);
      this.screenEffects.render(this.renderer);
      this.renderer.autoClear = true;
      this.updateDebug(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /**
   * 销毁整局（批次 181：应用内退出到主菜单）。
   *
   * 三件事缺一不可：
   *  1. **停止一切还会回调的行为**：主循环、全局监听、返回键守卫、手势计时器；
   *  2. **拆掉局内 DOM**：背包/设置/聊天/告示牌/信标/触摸层，否则再进世界会出现重复 id；
   *  3. **释放 GPU/Worker**：渲染器、网格池、世界、音频上下文。
   *
   * 幂等：重复调用直接返回（`exitToMenu` 与页面卸载钩子都可能走到这里）。
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // 从后台回来那一层遮罩挂在 body 上（不在 App 的容器里），要自己摘掉
    this.resumeGateEl?.remove();
    this.resumeGateEl = null;
    this.wasHidden = false;
    diag.event('app', 'dispose', { world: this.worldConfig.id });
    this.listeners.abort();
    this.backButton.reset();
    this.hudToast.dispose();
    this.targetInfoEl.remove();
    // 静态 HUD 容器（#vitals / #hud）要清干净：不清的话重进世界会叠出第二套血条与经验条
    this.vitalsHud.dispose();
    this.xpHud.dispose();
    // 触摸层：先清手势计时器，再摘 DOM
    this.touch?.dispose();
    this.touch = null;
    this.inventoryScreen.dispose();
    this.settingsScreen.destroy();
    this.chat.dispose();
    this.signEditor.dispose();
    this.beaconScreen.dispose();
    this.deathEl.classList.add('hidden');
    this.audio.dispose();

    this.recipeBook.dispose();
    this.advancementScreen.dispose();
    this.tooltip.dispose();
    this.mobRenderer.dispose();
    this.playerRenderer.dispose();
    this.particles.dispose();
    this.hand.dispose();
    this.screenEffects.dispose();
    this.sky.dispose();
    this.weather.dispose();
    this.chunkRenderer.disposeAll();
    this.meshPool.dispose();
    this.world.dispose();
    this.outline.dispose();
    this.blockOverlay.dispose();
    // 告示牌的文字平面与画布贴图（B12）：每块牌子一份材质，得逐块释放
    this.signRenderer.dispose();
    this.itemFrameRenderer.dispose();
    this.beaconBeamRenderer.dispose();
    this.borderRenderer.dispose();
    // 浮标（批次 81）：懒建的，可能一次都没抛过竿
    this.bobberMesh?.geometry.dispose();
    const bobberMaterial = this.bobberMesh?.material;
    if (Array.isArray(bobberMaterial)) for (const item of bobberMaterial) item.dispose();
    else bobberMaterial?.dispose();
    // 画布必须摘掉：WebGL 上下文有上限，反复进出世界不能靠 GC
    this.renderer.dispose();
    this.renderer.domElement.remove();
    // #app 里只该有这一张画布；清一次兜底，避免下次进世界时残留旧节点
    this.container.replaceChildren();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------------------------------------------------------- 开发调试接口
  // 供开发/自动化验收使用：精确定位相机、设置时间，便于复现与截图对比。

  /**
   * 诊断日志入口（批次 181）。
   *
   * 浏览器控制台里可以 `__mc.diag.exportText()` 直接拿到可读时间线，
   * 或 `__mc.diag.download()` 下载 JSON——不必让玩家手抄。
   */
  get diag(): typeof diag {
    return diag;
  }

  teleport(x: number, y: number, z: number): void {
    this.physics.teleport(x, y, z);
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
  }

  /** 是否正在挖掘（按住左键/长按屏幕且对着可破坏方块）——验收脚本用 */
  get isBreaking(): boolean {
    return this.breakProgress > 0 && this.breakingKey !== '';
  }

  /**
   * 避雷针与雷电的状态（批次 83）——验收脚本用。
   *
   * `rods` 是索引里记着几根避雷针、`pulsing` 是此刻在输出信号的根数、
   * `strikeIn` 是下一次打雷还有几秒（只在雷暴里走）。
   */
  get lightningState(): { rods: number; pulsing: number; strikeIn: number; thunder: boolean } {
    return {
      rods: this.lightningRods.size,
      pulsing: this.rodPulses.activeCount,
      strikeIn: Number(Math.max(0, this.strikeTimer).toFixed(2)),
      thunder: this.weather.current === 'thunder',
    };
  }

  /**
   * 月相（批次 84）——验收脚本与调试面板用：天数、相号、名字、亮面比例。
   * 读它就不必去猜"第几天该是什么月亮"。
   */
  get moonState(): { day: number; phase: number; name: string; cycle: number } {
    const phase = moonPhaseFor(this.dayCount);
    return { day: this.dayCount, phase, name: moonPhaseName(phase), cycle: MOON_PHASE_COUNT };
  }

  /** 直接跳到第 N 天（验收脚本用，省掉"等 20 分钟"） */
  setDayCount(day: number): void {
    this.dayCount = Math.max(0, Math.floor(day));
    this.sky.setMoonPhase(moonPhaseFor(this.dayCount));
  }

  /** 立刻在这里打一道雷（验收脚本用，省掉"等雷暴"） */
  strikeLightningNow(): void {
    this.strikeLightning();
  }

  /**
   * 末地传送门的状态（批次 111，K9）——验收脚本用。
   *
   * `inPortal` 是"脚下那一格是不是末地传送门方块"、`ticks` 是已经站了几 tick
   * （碰到就传：攒到 `END_PORTAL_WAIT_TICKS` 就送走）。
   */
  get endPortalState(): { inPortal: boolean; ticks: number } {
    return { inPortal: this.playerInEndPortal(), ticks: this.endPortalTicks };
  }

  /**
   * 在玩家**北边 6 格**搭一座已经点亮的末地传送门（验收脚本用）。
   *
   * 为什么要有它：走一遍真流程要"找到要塞 → 翻出 12 颗珍珠 → 合成 12 只眼睛"，
   * 自动化验收等不起；而这一段正好是**唯一**需要人工才能验证的地方。
   * 返回圈心坐标（中心那 3×3 就在这一层）——脚本 `teleport` 过去就会被送进末地。
   *
   * ⚠️ 它会**直接改方块**（不消耗任何物品），是给开发与验收用的后门，不是玩法。
   */
  buildEndPortalForTest(): { x: number; y: number; z: number } {
    const cx = Math.floor(this.physics.x);
    const cy = Math.floor(this.physics.y);
    const cz = Math.floor(this.physics.z) - 6;
    for (const [dx, dz] of END_PORTAL_RING) {
      this.world.setBlockAndUpdate(cx + dx, cy, cz + dz, Block.END_PORTAL_FRAME, withEndPortalEye(0, true));
    }
    activateEndPortalAt(this.portalWorld, cx, cy, cz - 2);
    return { x: cx + 0.5, y: cy, z: cz + 0.5 };
  }

  /**
   * 钓鱼的状态（批次 81，G11）——验收脚本用。
   *
   * `phase` 是那四个状态之一（`idle` / `flying` / `waiting` / `biting`），
   * `waitFor` 是这一竿要等多久、`timer` 是已经过去多久——"等到了没有"
   * 不必靠盯着屏幕猜。
   */
  get fishingState(): {
    phase: string;
    timer: number;
    waitFor: number;
    bobber: { x: number; y: number; z: number } | null;
  } {
    return {
      phase: this.fishing.phase,
      timer: Number(this.fishing.timer.toFixed(3)),
      waitFor: Number(this.fishing.waitFor.toFixed(3)),
      bobber: this.bobber ? { x: this.bobber.x, y: this.bobber.y, z: this.bobber.z } : null,
    };
  }

  /** 直接把浮标推到"咬钩"（验收脚本用，省掉 5~30 秒的等待） */
  forceBite(): void {
    if (this.fishing.phase !== 'waiting') return;
    this.fishing = { phase: 'biting', timer: 0, waitFor: this.fishing.waitFor };
  }

  /**
   * 告示牌的状态（B12，批次 80）——验收脚本用。
   *
   * `stored` 是存着的牌子数、`visible` 是**这一刻真的画在世界里**的平面数
   * （两者不等很正常：远处区块没加载、或者玩家站得离牌子很远）。
   */
  get signState(): { stored: number; visible: number; editing: boolean } {
    return { stored: this.signText.size, visible: this.signRenderer.count, editing: this.signEditor.isOpen };
  }

  /** 读某一块牌子上的字（验收脚本用；没写过返回 null） */
  signLinesAt(x: number, y: number, z: number): readonly string[] | null {
    return this.signText.get(this.dimension, Math.floor(x), Math.floor(y), Math.floor(z));
  }

  /**
   * 展示框的状态（B14，批次 86）——验收脚本用。
   *
   * `stored` 是挂着东西的框数、`visible` 是**这一刻真的画在世界里**的框数
   * （两者不等很正常：远处区块没加载）。
   */
  get frameState(): { stored: number; visible: number } {
    return { stored: this.itemFrames.size, visible: this.itemFrameRenderer.count };
  }

  /** 读某一格里展示框挂着的东西（验收脚本用；空框返回 null） */
  frameItemAt(
    x: number,
    y: number,
    z: number,
  ): { id: number; count: number; rotation: number } | null {
    const entry = this.itemFrames.get(this.dimension, Math.floor(x), Math.floor(y), Math.floor(z));
    if (!entry) return null;
    return { id: entry.item.id, count: entry.item.count, rotation: entry.rotation };
  }

  /**
   * 床与睡觉的状态（B13，批次 79）——验收脚本用。
   * 读它就不必去扒 `#sleep` 的 class，也不必猜"重生点是不是设上了"。
   */
  get bedState(): {
    sleeping: boolean;
    sleepSeconds: number;
    /** 重生点（床脚那一格 + 维度）；没睡过床时为 null */
    respawn: { x: number; y: number; z: number; dimension: DimensionId } | null;
  } {
    return {
      sleeping: this.sleeping !== null,
      sleepSeconds: Number(this.sleepTimer.toFixed(3)),
      respawn: this.bedSpawn ? { ...this.bedSpawn } : null,
    };
  }

  /** 当前视角（度）：验收脚本用它判断"拖动有没有真的转视角" */
  get lookAngles(): { yaw: number; pitch: number } {
    return { yaw: (this.yaw * 180) / Math.PI, pitch: (this.pitch * 180) / Math.PI };
  }

  /** 单位：度。yaw 0 = 看向 -Z（北），pitch 为正表示向上看 */
  look(yawDeg: number, pitchDeg: number): void {
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
  }

  /** 允许自动化脚本传送到某个坐标（会跳过自动出生点定位） */
  teleportForce(x: number, y: number, z: number): void {
    // 防呆：坐标里只要有一个不是有限数就直接忽略。
    // 之前用调试脚本传进过 NaN，物理位置一旦变成 NaN **就再也回不来**
    // （后面每一次位移运算的结果都是 NaN），整个浏览器会话看起来就像"卡死"了——
    // 排查时完全看不出是脚本把玩家传走的。
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this.spawnResolved = true;
    this.teleport(x, y, z);
  }

  /**
   * 切换维度。
   *
   * ⚠️ 切换后玩家脚下是空的：区块要重新生成，因此先把玩家抬到该维度的"空中高度"
   * 让物理自己落下，避免卡在地形里或掉进虚空。
   *
   * @param landing 指定的落点（传送门用：直接把玩家放在目的地坐标上；
   *   不传就按维度挑一个"空中高度"，等物理自己落地）
   */
  setDimension(dimension: DimensionId, landing?: { x: number; y: number; z: number }): void {
    // 换维度按"重新开局"处理：目标维度的区块一个都没加载过，
    // 一次性请求整个视距会同样卡住（批次 100 的渐进视距在这儿也要生效）
    this.startupRamp.reset();
    if (dimension === this.dimension) return;
    // 传送那一刻的按键不该带到另一片地形里（尤其是"按住前进"）
    this.touch?.resetInput('dimension');
    this.dimension = dimension;
    this.world.setDimension(dimension);
    // 掉落物实体属于旧维度，直接清掉
    this.entities.clear();
    this.particles.clear();
    // 落点：下界在洞窟上方、末地在主岛上方（岛面在 y≈66），主世界回高空
    const landingY = dimension === Dimension.NETHER ? 96 : dimension === Dimension.END ? 96 : 140;
    this.physics.teleport(landing?.x ?? this.physics.x, landing?.y ?? landingY, landing?.z ?? this.physics.z);
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.weather.setKind('clear');
    // 换维度等于"换一片全新的地形"，雾要重新从近处散开（否则会先看见一片空白再逐块弹出）。
    // ⚠️ 下界与末地用的是各自的固定雾，这一处只影响回到主世界时那一下。
    this.fogRadius = Math.min(this.fogRadius, 1);
    this.fogWait = 0;
    if (dimension === Dimension.END) this.spawnEndBoss();
    this.applyEnvironment();
    this.refreshWorld(toChunkCoord(this.physics.x), toChunkCoord(this.physics.z), true);
    // 进度（M7）：进入某维度。"第一次踏进下界/末地"这类条目全靠它——
    // 放在**这个方法里**而不是"按 N 键"那处：传送门、命令、调试接口全都走这里，
    // 少一处就漏一种进法（本项目的"两条路径共用同一套逻辑"）
    this.reportProgress({ kind: 'dimension', dimension });
  }

  /**
   * 末影龙状态（调试与自动化验收用）；没有龙时为 null。
   * 血条的宽度、阶段、位置都能从这里读到，不必去扒 DOM。
   */
  get dragon(): { health: number; max: number; stage: string; x: number; y: number; z: number; crystals: number } | null {
    const dragon = this.endDragon;
    if (!dragon || dragon.dead) return null;
    return {
      health: dragon.health,
      max: DRAGON_TYPE.health,
      stage: dragon.stage,
      x: dragon.x,
      y: dragon.y,
      z: dragon.z,
      crystals: dragon.crystalCount,
    };
  }

  /** 按「主世界 → 下界 → 末地 → 主世界」循环切维度（N 键与调试脚本共用） */
  toggleDimension(): DimensionId {
    const index = DIMENSION_CYCLE.indexOf(this.dimension);
    this.setDimension(DIMENSION_CYCLE[(index + 1) % DIMENSION_CYCLE.length]!);
    return this.dimension;
  }

  /** 直接切到指定维度（调试脚本用） */
  setDimensionById(dimension: DimensionId): DimensionId {
    this.setDimension(dimension);
    return this.dimension;
  }

  setTimeOfDay(t: number): void {
    this.timeOfDay = ((t % 1) + 1) % 1;
    this.applyEnvironment();
  }

  /**
   * 当前是不是创造模式（**能力口径**）。
   *
   * 免伤、瞬间破坏、不掉耐久、物品不消耗、创造物品栏都看它；
   * "在不在飞"是另一件事（创造模式也可以走路）。
   */
  get isCreative(): boolean {
    return isCreativeMode(this.gameMode);
  }

  /**
   * 切游戏模式（批次 181）。
   *
   * 入口只有三处：新建世界、暂停菜单、`/gamemode`。双击跳跃**不再**走这里。
   * 切回生存时强制落地，否则会出现"生存模式在飞"——既不受重力也不掉血。
   */
  setGameMode(mode: GameMode): void {
    const next = normalizeGameMode(mode);
    if (next === this.gameMode) return;
    diag.event('mode', 'gameMode.change', { from: this.gameMode, to: next, flying: this.flying });
    this.gameMode = next;
    if (next === 'survival' && this.flying) this.setFlying(false);
    // 回写世界清单（暂停菜单里改的，下次从主菜单进来还是这个模式）
    this.onGameModeChanged?.(next);
    this.hudToast.show(`游戏模式：${GAME_MODE_LABELS[next]}`);
    // 背包开着时创造区要立刻显隐；设置面板开着时"飞行"那一行要显隐
    if (this.inventoryScreen.isOpen) this.inventoryScreen.refresh();
    if (this.settingsScreen.isOpen) this.settingsScreen.refreshGameModeRows();
  }

  /** 切换创造飞行（键盘 F、双击跳跃、设置里的"飞行"共用；生存模式会被拒绝） */
  setFlying(value: boolean): void {
    // 先记日志再改状态：D2 那种"切完就卡"的问题要靠 before/after 对比定位
    diag.event('mode', 'setFlying', {
      value,
      allowed: !value || this.isCreative,
      before: this.flying,
      gameMode: this.gameMode,
      uiOpen: this.uiOpen,
      touch: this.touch?.debugState,
    });
    if (value && !this.isCreative) {
      // 生存不能飞：把调用方（双击跳/F/命令）静默挡掉，状态保持一致
      return;
    }
    // 切飞行先清手势（批次 181）：另一根手指的旧基准不能带到切换之后
    this.touch?.resetInput('flying');
    this.flying = value;
    // 触摸端的"飞"按钮需要跟着亮/灭
    this.touch?.setFlying(value);
    // 创造物品栏跟着显隐（批次 139）：背包开着时按 F 起飞，创造区要立刻出现
    if (this.inventoryScreen.isOpen) this.inventoryScreen.refresh();
  }

  /**
   * **中键拾取方块**（批次 129，对齐原版）：把准星指着的方块塞进快捷栏。
   *
   * 三条规则（在哪儿找、找不到怎么办）全在 `core/interaction/PickBlock.ts` 里，
   * 这里只做三件事：读出准星那一格、把结果落到背包、必要时**切选中格**。
   *
   * ⚠️ 创造模式的门径是本项目的口径：**能飞 = 创造**（`isCreative` 那个钩子也是这么写的），
   * 所以"凭空给一份"只在飞行时发生。
   */
  private pickBlock(): void {
    const hit = this.hit;
    if (!hit) return;
    const itemId = pickItemFor(this.world.getBlock(hit.x, hit.y, hit.z));
    if (itemId === null) return;

    const plan = planPickBlock(this.inventory, itemId, this.hotbarIndex, this.isCreative);
    if (!plan) return;
    applyPickBlock(this.inventory, plan);
    // `'select'` 与另外两档都要"把手移到那一格"——原版拾取之后手上就是它
    if (plan.kind === 'select') this.selectSlot(plan.slot - HOTBAR_START);
    else this.selectSlot(plan.to - HOTBAR_START);
    this.inventory.notify();
  }

  selectSlot(index: number): void {
    if (index < 0 || index >= HOTBAR_SIZE) return;
    const changed = this.hotbarIndex !== index;
    this.hotbarIndex = index;
    this.refreshHotbar();
    // 换槽时浮一下物品名（批次 95，对齐基岩版）：手机上"手上是什么"只能靠图标，
    // 而图标在 44px 的格子里看不太清（尤其是同名不同材质的工具）
    if (changed) this.showSelectedItemName();
  }

  /**
   * 快捷栏上方的物品名浮标（批次 95）。
   *
   * 走 `selectedItemName` 这个元素而不是每帧重画：它是"换槽时的一次提示"，
   * 2 秒后自己淡出（`#selected-item-name.show` 的过渡）。
   */
  private showSelectedItemName(): void {
    const label = this.selectedItemName;
    if (!label) return;
    const stack = this.inventory.get(this.hotbarIndex);
    if (!stack) {
      label.classList.remove('show');
      return;
    }
    const name = itemLabel(stack.id);
    label.textContent = stack.count > 1 ? `${name} ×${stack.count}` : name;
    label.classList.add('show');
    if (this.itemNameTimer !== null) clearTimeout(this.itemNameTimer);
    this.itemNameTimer = window.setTimeout(() => {
      this.itemNameTimer = null;
      label.classList.remove('show');
    }, 2000);
  }

  private selectedItemName: HTMLDivElement | null = null;
  private itemNameTimer: number | null = null;

  /** 查看/操作背包（自动化测试用） */
  get items(): Inventory {
    return this.inventory;
  }

  toggleInventory(): void {
    this.inventoryScreen.toggle();
  }

  /** 直接打开工作台界面（自动化测试用） */
  openCrafting(): void {
    this.inventoryScreen.openWith('crafting');
  }

  get craftingScreen(): InventoryScreen {
    return this.inventoryScreen;
  }

  get isInventoryOpen(): boolean {
    return this.uiOpen;
  }

  /** 模拟按住左键（用于自动化测试破坏方块） */
  setLeftButton(down: boolean): void {
    this.leftDown = down;
  }

  setRightButton(down: boolean): void {
    this.rightDown = down;
  }

  /** 该列地表是否为雪 / 冰（决定降水形态） */
  /**
   * 这一列是什么群系（批次 124，尸壳的"只在沙漠刷"用）；非主世界返回 null。
   *
   * ⚠️ 生成器**惰性建一次就留着**：`new OverworldGenerator(seed)` 要铺一整套噪声，
   * 而刷怪每 2 秒就会问几次（`biomeAt` 本身只是一次气候噪声查询，很便宜）。
   * 与 `nearestVillageForTest` 那种"一次性算个坐标"的用法不同——那个只跑一次，可以现场建。
   */
  private biomeNameAt(x: number, z: number): string | null {
    if (this.dimension !== Dimension.OVERWORLD) return null;
    this.biomeGenerator ??= new OverworldGenerator(this.worldConfig.seed, this.worldConfig.worldType);
    return this.biomeGenerator.biomeAt(x, z).name;
  }

  /** 群系查询用的生成器（批次 124；见 `biomeNameAt`） */
  private biomeGenerator: OverworldGenerator | null = null;

  private isSnowyColumn(x: number, z: number): boolean {
    for (let y = 200; y >= 0; y--) {
      const id = this.world.getBlock(x, y, z);
      if (id === Block.AIR || id === Block.WATER) continue;
      return id === Block.SNOW_BLOCK || id === Block.ICE || id === Block.PACKED_ICE;
    }
    return false;
  }

  /**
   * 调试用：在指定位置生成一只生物。
   * 会自动把生成高度吸附到该列的地表 —— 直接按调用方给的 y 放，
   * 很容易把生物生成在方块内部（表现为"生成了但看不见"）。
   */
  spawnMob(typeId: string, x: number, y: number, z: number): boolean {
    const type = mobTypeById(typeId);
    if (!type) return false;

    let spawnY = Math.floor(y);
    for (let dy = 6; dy >= -2; dy--) {
      const candidate = Math.floor(y) + dy;
      if (this.world.isSolid(x, candidate - 1, z) && !this.world.isSolid(x, candidate, z) && !this.world.isSolid(x, candidate + 1, z)) {
        spawnY = candidate;
        break;
      }
    }

    this.entities.spawn(createMob(type, x + 0.5, spawnY, z + 0.5));
    return true;
  }

  /** 调试用：清空所有生物（掉落物保留） */
  clearMobs(): number {
    let removed = 0;
    for (const entity of this.entities.all) {
      if (entity instanceof Mob) {
        entity.dead = true;
        removed++;
      }
    }
    return removed;
  }

  /** 调试用：生物统计 */
  /** 调试用：清空攻击冷却，让下一次按下左键立刻生效（自动化验收用） */
  resetAttackCooldown(): void {
    this.attackCooldown = 0;
  }

  /** 调试用：生成器统计 */
  get spawnerStats(): { hostile: number; passive: number } {
    return { hostile: this.mobSpawner.spawnedHostile, passive: this.mobSpawner.spawnedPassive };
  }

  get mobStats(): { total: number; hostile: number; passive: number; byType: Record<string, number> } {
    let hostile = 0;
    let passive = 0;
    const byType: Record<string, number> = {};
    for (const entity of this.entities.all) {
      if (!(entity instanceof Mob)) continue;
      byType[entity.type.id] = (byType[entity.type.id] ?? 0) + 1;
      if (entity.type.hostile) hostile++;
      else passive++;
    }
    return { total: hostile + passive, hostile, passive, byType };
  }

  /** 调试 / 命令用：切换天气 */
  setWeather(kind: WeatherKind): void {
    this.weather.setKind(kind);
    this.applyEnvironment();
  }

  /** 调试用：天气状态快照 */
  get weatherState(): { kind: WeatherKind; raining: boolean; snowy: boolean; flash: number } {
    return {
      kind: this.weather.current,
      raining: this.weather.raining,
      snowy: this.snowyHere,
      flash: Number(this.weather.flash.toFixed(3)),
    };
  }

  /** 调试用：生存状态快照 */
  get survivalState(): {
    health: number;
    food: number;
    saturation: number;
    air: number;
    armor: number;
    xpLevel: number;
    xpProgress: number;
    xpToNext: number;
    dead: boolean;
    invulnerable: boolean;
    totalDamage: number;
    /** 是否着火（I12）：验收脚本靠它确认"站在火里真的被点燃了" */
    burning: boolean;
    /** 是否站在传送门里（K8） */
    inPortal: boolean;
    /** 站门计时的进度（0~1）与冷却剩余 tick：验收脚本靠它们确认传送真的在计时 */
    portalProgress: number;
    portalCooldown: number;
  } {
    return {
      health: this.stats.health,
      food: this.stats.food,
      saturation: this.stats.saturation,
      air: this.stats.air,
      armor: this.stats.armorPoints,
      xpLevel: this.experience.level,
      xpProgress: this.experience.progress,
      xpToNext: this.experience.toNext,
      dead: this.stats.dead,
      invulnerable: this.stats.invulnerable,
      totalDamage: this.stats.totalDamage,
      burning: this.stats.burning,
      inPortal: this.playerInPortal(),
      portalProgress: Math.min(1, this.portalTicks / PORTAL_IGNITE_TICKS),
      portalCooldown: this.portalCooldownTicks,
    };
  }

  /** 调试用：直接造成伤害（自动化验收用） */
  hurtPlayer(amount: number, cause: DamageCause = 'generic'): void {
    this.stats.damage(amount, cause);
  }

  get info(): {
    fps: number;
    chunks: number;
    lit: number;
    triangles: number;
    position: [number, number, number];
    onGround: boolean;
    flying: boolean;
    entities: number;
    /** 射线命中的方块坐标；没有命中时为 null */
    hit: [number, number, number] | null;
    /** 当前维度 */
    dimension: DimensionId;
    /** 天空穹顶是否可见（下界应为 false） */
    skyVisible: boolean;
    /** 当前存活的粒子数（E13 验收用） */
    particles: number;
    /** 粒子的硬上限（批次 130，N7；0 = 粒子关了） */
    particleBudget: number;
    /** 当前渲染分辨率倍率（批次 130，N7；1 = 基准） */
    resolutionScale: number;
    /** 手持物品 id（空手为 null，E15 验收用） */
    handItem: number | null;
    /** 当前的视野色罩（E16 验收用） */
    screenEffect: ScreenEffect;
    /** 配方书是否打开（验收用） */
    recipeBookOpen: boolean;
    /** 成就面板是否打开、以及与它相关的四个数（M7 验收用） */
    /** 村民交易（J11）的验收读数：界面开没开 + 最近的村民是谁 */
    trade: {
      open: boolean;
      villager: ReturnType<App['villagerNearby']>;
    };
    advancements: {
      open: boolean;
      /** 面板里当前画了多少行（DOM 里真的有多少行） */
      rows: number;
      earned: number;
      total: number;
      /** 已达成的 id（验收脚本直接对表） */
      ids: string[];
    };
    /** 聊天/命令输入框是否打开（验收用） */
    chatOpen: boolean;
    /** 当前难度与游戏规则（验收用） */
    difficulty: string;
    gameRules: GameRules;
    /** 当前状态效果的文字描述（验收用） */
    effects: string[];
    /** 随机刻累计改动的方块数（验收用） */
    randomTicks: number;
    /** 计划刻队列长度（验收用） */
    scheduledTicks: number;
    /** 流体流动改动的累计次数（验收用） */
    fluidChanges: number;
    /** 爆炸累计炸掉的方块数（验收用） */
    explosionBlocks: number;
    /** 当前破坏裂纹阶段（-1 = 没在挖；验收用） */
    damageStage: number;
    /** 命中面高亮是否可见（验收用） */
    faceHighlight: boolean;
    /** 物品提示框当前显示的文字（验收用） */
    tooltip: string;
    /** 当前视角模式（F7 验收用） */
    cameraMode: CameraMode;
    /** 第三人称的玩家模型是否可见（F7 验收用） */
    playerModelVisible: boolean;
    /** 相机与玩家的距离（第一人称恒为 0，F7 验收用） */
    cameraDistance: number;
    /**
     * 启动耗时台账（N8 的判据，批次 103）：两个玩家真正等得着的数字
     * —— 首次访问到主菜单 `bootMs`、点进世界到能玩 `playableMs`。
     */
    startup: {
      bootMs: number | null;
      playableMs: number | null;
      marks: readonly { name: string; at: number }[];
    };
  } {
    return {
      startup: {
        bootMs: startupTrace.bootMs,
        playableMs: startupTrace.playableMs,
        marks: startupTrace.marks,
      },
      cameraMode: this.cameraMode,
      playerModelVisible: this.playerRenderer.visible,
      cameraDistance: Math.hypot(
        this.camera.position.x - this.physics.x,
        this.camera.position.y - this.physics.eyeY,
        this.camera.position.z - this.physics.z,
      ),
      dimension: this.dimension,
      skyVisible: this.sky.object.visible,
      particles: this.particles.active,
      /** 粒子的**硬上限**（批次 130，N7）：与 `particles` 一起看才知道"到顶了没有" */
      particleBudget: this.particles.budget,
      /** 当前渲染分辨率倍率（批次 130，N7）：掉帧时它会先降 */
      resolutionScale: this.perf.resolutionScale,
      handItem: this.hand.item ?? null,
      screenEffect: this.screenEffects.effect,
      recipeBookOpen: this.recipeBook.isOpen,
      advancements: {
        open: this.advancementScreen.isOpen,
        rows: this.advancementScreen.renderedRowCount,
        earned: this.advancements.earnedCount,
        total: this.advancements.totalCount,
        ids: this.advancements.serialize().earned,
      },
      // 村民交易（J11）：界面开着没有、最近的村民是谁、他能做什么
      trade: {
        open: this.inventoryScreen.currentMode === 'trade',
        villager: this.villagerNearby(64),
      },
      chatOpen: this.chat.isOpen,
      difficulty: this.difficulty,
      gameRules: { ...this.rules },
      effects: this.effects.describe(),
      randomTicks: this.randomTickChanges,
      scheduledTicks: this.scheduler.size,
      fluidChanges: this.fluidChanges,
      explosionBlocks: this.explosionBlocks,
      damageStage: this.blockOverlay.damageStage,
      faceHighlight: this.blockOverlay.highlightVisible,
      tooltip: this.tooltip.text,
      fps: this.fps,
      chunks: this.world.chunks.size,
      lit: this.world.litChunkCount,
      triangles: this.chunkRenderer.triangles,
      position: [this.physics.x, this.physics.y, this.physics.z],
      onGround: this.physics.onGround,
      flying: this.flying,
      entities: this.entities.count,
      hit: this.hit ? [this.hit.x, this.hit.y, this.hit.z] : null,
    };
  }

  /** 调试用：图集尺寸与某个贴图的 UV / 像素起点（排查贴图错位） */
  atlasDebug(tile: string): {
    columns: number;
    rows: number;
    width: number;
    height: number;
    uv: [number, number, number, number];
    source: { x: number; y: number };
  } {
    return {
      columns: this.atlas.columns,
      rows: this.atlas.rows,
      width: this.atlas.canvas.width,
      height: this.atlas.canvas.height,
      uv: this.atlas.uv(tile),
      source: this.atlas.tileSource(tile),
    };
  }

  /** 调试用：抽样某区块网格顶点里的光照值（可限定世界 Y 区间） */
  sampleMeshLight(
    cx: number,
    cz: number,
    minWorldY?: number,
    maxWorldY?: number,
  ): ReturnType<ChunkRenderer['sampleMeshLight']> {
    return this.chunkRenderer.sampleMeshLight(cx, cz, minWorldY, maxWorldY);
  }

  /** 当前天空亮度倍率（昼夜） */
  get skyBrightness(): number {
    return this.solidMaterial.skyBrightnessValue;
  }

  /** 调试用：实体渲染当前用到的光照档位（确认逐实体光照生效） */
  get entityLightBuckets(): number[] {
    return this.entityRenderer.createdLightLevels;
  }

  /** 当前所有实体的概览（自动化验收用） */
  get entityList(): Array<{ kind: string; item: string; count: number; x: number; y: number; z: number }> {
    return this.entities.all.map((entity) => {
      if (entity instanceof ItemEntity) {
        return {
          kind: 'item',
          item: itemName(entity.itemId),
          count: entity.count,
          x: entity.x,
          y: entity.y,
          z: entity.z,
        };
      }
      return { kind: 'unknown', item: '', count: 0, x: entity.x, y: entity.y, z: entity.z };
    });
  }

  /** 单点取样：方块名 + 天光/方块光 */
  probe(x: number, y: number, z: number): { block: string; sky: number; blockLight: number } {
    const id = this.world.getBlock(x, y, z);
    return {
      block: BLOCKS[id]?.name ?? `unknown(${id})`,
      sky: this.world.getSkyLight(x, y, z),
      blockLight: this.world.getBlockLight(x, y, z),
    };
  }

  /** 逐列扫描：返回最高非空气方块（可能是水）与最高固体（地面） */
  column(x: number, z: number): { top: number; block: string; ground: number; groundBlock: string } {
    let top = -999;
    let topBlock = 'none';
    let ground = -999;
    let groundBlock = 'none';
    for (let y = 319; y >= -64; y--) {
      const id = this.world.getBlock(x, y, z);
      if (id === 0) continue;
      if (top === -999) {
        top = y;
        topBlock = BLOCKS[id]?.name ?? `${id}`;
      }
      if (id !== Block.WATER) {
        ground = y;
        groundBlock = BLOCKS[id]?.name ?? `${id}`;
        break;
      }
    }
    return { top, block: topBlock, ground, groundBlock };
  }

  /** 一片区域的地表高度统计（跳过水面，看真实地面） */
  sampleColumns(x0: number, z0: number, step: number): string {
    const rows: string[] = [];
    for (let dz = 0; dz < 6; dz++) {
      const cells: string[] = [];
      for (let dx = 0; dx < 8; dx++) {
        const c = this.column(x0 + dx * step, z0 + dz * step);
        cells.push(String(c.ground).padStart(4));
      }
      rows.push(cells.join(' '));
    }
    return rows.join('\n');
  }

  /**
   * 查询某格的红石粉强度（0~15；非红石粉返回 0）。
   * 自动化验收靠它判断"电有没有传到"，不必盯着画面看。
   */
  redstonePower(x: number, y: number, z: number): number {
    return wirePowerOf(this.redstone, x, y, z);
  }

  /** 红石引擎已经算过多少轮（调试用） */
  get redstoneUpdates(): number {
    return this.redstone.updates;
  }

  /** 界面是否打开（暂停菜单/背包都算）——验收脚本用 */
  get isUiOpen(): boolean {
    return this.uiOpen;
  }

  /**
   * 导入资源包（K4）。
   *
   * 这是图集方案的一个红利：网格顶点里存的是**图集内的 tile 索引**，
   * 因此替换贴图内容后不需要重建任何区块网格，只要把纹理重新上传一次——
   * 在设置里换材质包，画面下一帧就变了。
   */
  async loadResourcePack(file: File): Promise<ResourcePackResult | null> {
    try {
      const result = await applyResourcePack(file, this.atlas, packNameFromFile(file.name));
      this.resourcePack = { name: packNameFromFile(file.name), replaced: result.replaced.length, skipped: result.skipped.length };
      return result;
    } catch (error) {
      console.warn('[pack] 资源包加载失败（文件可能不是有效的 zip）', error);
      this.resourcePack = { name: packNameFromFile(file.name), replaced: 0, skipped: 0, error: true };
      return null;
    }
  }

  /** 已加载的资源包状态（验收脚本用） */
  private resourcePack: { name: string; replaced: number; skipped: number; error?: boolean } | null = null;

  get resourcePackState(): { name: string; replaced: number; skipped: number; error: boolean } | null {
    if (!this.resourcePack) return null;
    return {
      name: this.resourcePack.name,
      replaced: this.resourcePack.replaced,
      skipped: this.resourcePack.skipped,
      error: this.resourcePack.error ?? false,
    };
  }

  /**
   * 渲染层的"可绘制对象"明细（验收用）。
   * draw call 的增量到底来自哪一块，看这个比看总数可靠。
   */
  get renderBreakdown(): {
    chunkMeshes: number;
    itemMeshes: number;
    mobInstancedMeshes: number;
    mobInstances: number;
    mobParts: number;
  } {
    const mobParts = this.mobInstanceCount;
    return {
      chunkMeshes: this.chunkRenderer.chunkMeshCount,
      itemMeshes: this.entityRenderer.drawableCount,
      // 实例化后生物只占 1 个可绘制对象（就是那个 InstancedMesh）
      mobInstancedMeshes: 1,
      mobInstances: mobParts,
      mobParts,
    };
  }

  /** 生物渲染占用的实例数（实例化改造后用于验收：部件数应远大于 draw call 增量） */
  get mobInstanceCount(): number {
    return this.mobRenderer.usedInstances;
  }

  /**
   * 渲染统计（验收用）：draw call 数是"实例化改造"这类优化的直接指标。
   * three 的 info 是每帧重置的，这里读的是上一帧的结果。
   */
  get renderStats(): { calls: number; triangles: number; geometries: number; textures: number; programs: number } {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    };
  }

  /** 音效状态（验收脚本用） */
  get audioState(): { enabled: boolean; context: string; volume: number; played: number } {
    return {
      enabled: this.audio.enabled,
      context: this.audio.contextState,
      volume: this.audio.volume,
      played: this.audio.played,
    };
  }

  /** 验收用：直接播一个音效（可选坐标用于距离衰减验证） */
  playSound(kind: SoundKind, x?: number, y?: number, z?: number): void {
    this.audio.play(kind, x === undefined ? undefined : { x, y: y ?? 0, z: z ?? 0 });
  }

  /** 当前设置与设置界面的状态（验收脚本用） */
  get settingsState(): {
    open: boolean;
    settings: GameSettings;
    viewDistance: number;
    fov: number;
    frameTimeAvg: number;
    resolutionScale: number;
    perfCooldown: number;
  } {
    return {
      open: this.settingsScreen.isOpen,
      settings: this.settingsScreen.snapshot(),
      viewDistance: this.viewDistance,
      fov: this.camera.fov,
      frameTimeAvg: Number(this.perf.frameTimeAvg.toFixed(2)),
      // 降级策略的现状（批次 130）：验收脚本据此断言"掉帧时分辨率先降"
      resolutionScale: this.perf.resolutionScale,
      perfCooldown: Number(this.perf.cooldown.toFixed(2)),
    };
  }

  /**
   * 验收脚本用（批次 130）：在玩家旁边撒一批粒子，返回撒完之后的存活数。
   *
   * 存在的理由很具体：**粒子总量那个上限只有在"爆量"时才看得出来**，
   * 而"爆炸 + 一堆方块被拆"在脚本里不好构造（要摆 TNT、要等引信）。
   * 给一个直接撒的口子，`perf-acceptance.js` 就能真的压到上限。
   */
  spawnTestParticles(offsetX = 0): number {
    const x = this.physics.x + offsetX;
    const y = this.physics.y + 1;
    const z = this.physics.z;
    this.particles.spawnBlockBreak(x, y, z, 0xffffff, 24);
    this.particles.spawnSmoke(x, y, z, 24, 0.4);
    this.particles.spawnFlame(x, y, z, 1);
    return this.particles.active;
  }

  /** 以编程方式改设置（等同于拖滑块） */
  updateSettings(patch: Partial<GameSettings>): GameSettings {
    Object.assign(this.settings, patch);
    this.applySettings(this.settings);
    saveSettings(this.settings);
    return this.settingsScreen.snapshot();
  }

  /** 直接放置方块（自动化测试用）；可带状态 */
  place(x: number, y: number, z: number, blockId: number, state = 0): boolean {
    const ok = this.world.setBlockAndUpdate(x, y, z, blockId, state);
    // 与玩家放置走同一条收尾：漏斗在这里也必须把容器建出来（否则脚本摆的漏斗是死的）
    if (ok) this.ensureBlockEntityAt(x, y, z, blockId);
    return ok;
  }

  /**
   * 按名字取方块 id（自动化验收用）。
   * 脚本里硬编码数字 id 很容易写错（实测把 24 当成玻璃、其实是黑曜石），
   * 按名字取可以避免这类笔误，也让方块 id 变动时脚本不用跟着改。
   */
  blockId(name: string): number {
    const full = name.includes(':') ? name : `minecraft:${name}`;
    return BLOCKS.findIndex((def) => def.name === full);
  }

  /** 查询某处方块的状态与形状（自动化验收用） */
  probeState(x: number, y: number, z: number): { block: string; shape: string; state: number } {
    const id = this.world.getBlock(x, y, z);
    return {
      block: BLOCKS[id]?.name ?? `unknown(${id})`,
      shape: blockDef(id).shape,
      state: this.world.getBlockState(x, y, z),
    };
  }

  /** 直接在指定位置生成掉落物（自动化测试用） */
  dropItem(itemId: number, count: number, x: number, y: number, z: number): void {
    this.spawnDrop(itemId, count, x, y, z);
  }

  /**
   * 直接给玩家背包塞物品（自动化测试用）。
   * 等价于在创造物品栏里点一下 —— 浏览器验收脚本靠它把"手持物品"摆出来。
   * @returns 没塞进去的数量（0 表示全部塞下）
   */
  giveItem(itemId: number, count = 1): number {
    const left = this.inventory.add(itemId, count);
    this.refreshHotbar();
    return left;
  }
}

// ---------------------------------------------------------------- 启动与环境色


/**
 * 认领旧版单存档。
 *
 * 多世界之前的版本只有一个库（`bedrock-118-web`），里面可能有玩家辛苦搭的房子。
 * 升级后如果清单是空的、而旧库里确实有存档，就把它直接登记成第一个世界——
 * 库名沿用旧库名（见 `dbNameFor`），一个字节都不用搬。
 */
async function adoptLegacyWorld(registry: WorldRegistry): Promise<void> {
  if (registry.get(LEGACY_WORLD_ID)) return;
  const legacy = await SaveGame.open(LEGACY_WORLD_ID);
  if (!legacy?.hasSave) return;
  const meta = legacy.meta!;
  registry.adopt(LEGACY_WORLD_ID, meta.seed, { name: '我的世界', edits: meta.edits });
  registry.update(LEGACY_WORLD_ID, { playTime: meta.playTime, lastPlayed: meta.lastPlayed });
}

async function boot(): Promise<void> {
  startupTrace.mark(STARTUP_PHASES.bootBegin);
  // 诊断日志先开：启动期的错误（图集/Worker/WebGL）也要能被带出来
  diag.start();
  diag.event('app', 'boot', { href: location.href });
  // 主菜单阶段还没有 App；先挂一个全局入口，出事时控制台/自动化脚本能直接取日志
  (window as unknown as { __diag: typeof diag }).__diag = diag;
  // 批次 184：键盘不挤压布局 + 点输入框以外的地方先 blur（菜单与游戏内共用）
  installKeyboardGuards();
  // 批次 185：竖屏浮层要**尽早**挂上——它现在是不透明的一整层，
  // 晚挂的话玩家会先看见竖屏菜单、再被盖住（"闪一下"）。
  installRotateHint();
  const container = document.getElementById('app');
  const debugEl = document.getElementById('debug');
  const vitalsEl = document.getElementById('vitals');
  const deathEl = document.getElementById('death');
  if (!container || !debugEl || !vitalsEl || !deathEl) throw new Error('缺少必要的 DOM 节点');

  // ---- 设备能力预检（A10，批次 85）：**在生成图集/地形之前**就问一句。
  // 图集要画上百张画布、地形要起 worker 池——这些在不支持的设备上全是白做的，
  // 而且它们失败起来五花八门（比"直接告诉玩家 WebGL2 不可用"难查得多）
  const unsupported = new UnsupportedScreen();
  const support = probeBrowserGl();
  if (!support.ok) {
    console.warn(`[gl] 设备不支持：${support.kind} —— ${support.reason}`);
    hideLoading();
    unsupported.show(support);
    return;
  }

  startupTrace.mark(STARTUP_PHASES.bootGl);
  const atlas = new TextureAtlas();
  startupTrace.mark(STARTUP_PHASES.bootAtlas);
  const registry = new WorldRegistry();
  await adoptLegacyWorld(registry);

  /** 主菜单里的设置面板是临时实例；进入世界前销毁，局内 App 会建立自己的设置面板。 */
  let menuSettings: SettingsScreen | null = null;

  /**
   * 主菜单的返回键守卫（批次 181）。
   *
   * 没有这条时，玩家在世界列表/新建世界里按返回会**直接退出页面**（PWA 里等于退出游戏）。
   * 压一条状态之后，返回先落到我们手里：二级页 → 首页，首页再返回才交给浏览器。
   */
  const pushMenuGuard = (): void => {
    try {
      window.history.pushState({ mcMenu: true }, '');
    } catch {
      // 某些内嵌浏览器禁用 history：退回"只能点‹返回"
    }
  };

  const startWorld = async (world: WorldSummary): Promise<void> => {
    startupTrace.mark(STARTUP_PHASES.worldBegin);
    diag.event('app', 'world.enter', {
      id: world.id,
      name: world.name,
      type: world.worldType,
      difficulty: world.difficulty,
      seed: world.seed,
    });
    menu.hide();
    // 主菜单设置即使当前隐藏，也仍占着 `#settings-screen`；不移除会与 App 内实例重复 id。
    menuSettings?.destroy();
    menuSettings = null;
    // ⚠️ 遮罩**只在这一刻**挂出来（批次 167）：从这一行起才真的在"生成世界"。
    // 放得这么早是有意的——`SaveGame.open()` 要等 IndexedDB，手机上可能是几百毫秒的空白。
    showLoading(WORLD_LOADING_TEXT);
    // 安装引导只在主菜单上有意义；进世界之后它会压在触摸按钮上
    hideInstallHint();
    // 先开存档库再建世界：存档里有玩家位置与维度，世界要先知道该从哪生成
    // （打开失败会返回 null，游戏照常可玩，只是不保存）
    const save = await SaveGame.open(world.id);
    startupTrace.mark(STARTUP_PHASES.worldSave);
    registry.update(world.id, { lastPlayed: Date.now() });
    let app: App;
    try {
      app = new App(container, debugEl, atlas, vitalsEl, deathEl, save, {
        id: world.id,
        name: world.name,
        seed: world.seed,
        worldType: world.worldType,
        difficulty: world.difficulty,
        gameMode: world.gameMode,
      });
    } catch (error) {
      // 预检过了、但真正创建渲染器时还是失败（显存不足/上下文到顶）：
      // 走同一块界面，别把白屏留给玩家（A10，批次 85）
      if (error instanceof Error && error.message === UNSUPPORTED_GL_ERROR) {
        hideLoading();
        unsupported.show(
          lastRendererFailure ?? rendererFailure('无法创建 WebGL2 绘图上下文'),
        );
        return;
      }
      throw error;
    }
    startupTrace.mark(STARTUP_PHASES.worldConstructed);
    // 存档后把统计回写到世界清单，主菜单下次打开就是最新的
    app.onSaved = (info) => registry.update(world.id, { lastPlayed: Date.now(), ...info });
    app.onWorldDeleted = (id) => registry.remove(id);
    // 难度改了就回写世界清单（下次从主菜单进来还是这个难度）
    app.onDifficultyChanged = (value) => registry.update(world.id, { difficulty: value });
    // 游戏模式同理（批次 181）：暂停菜单里改了，主菜单卡片与下次进入都跟着变
    app.onGameModeChanged = (mode) => registry.update(world.id, { gameMode: mode });
    // 应用内退出（批次 181）：App 拆完自己之后把菜单拉回来。
    // ⚠️ 这里**不碰全屏**——全屏是页面级的，退出世界不该把它一起退掉。
    app.onExitToMenu = () => {
      hideLoading();
      // 局内实例已经拆掉：调试入口也要跟着清掉，否则自动化会对着一个死对象操作
      (window as unknown as { __mc?: App }).__mc = undefined;
      menu.setView('home');
      menu.render();
      menu.show();
      // 局内那条守卫已经被 `dispose()` 收走；主菜单自己要重新压一条，
      // 否则玩家在菜单里按返回会直接退出页面
      pushMenuGuard();
      diag.event('app', 'menu.show', { from: 'world' });
    };
    app.start();
    // 开发调试入口：控制台或自动化脚本可通过 window.__mc 精确定位与取样
    (window as unknown as { __mc: App }).__mc = app;
  };

  /**
   * 主菜单里的设置面板。
   * 懒创建：直接复用同一个 `SettingsScreen`，只是不给它"回主菜单/删世界"两个按钮
   * （那两个动作只在游戏里有意义），改动只写 localStorage，进世界时会被读走。
   */
  const openMenuSettings = (): void => {
    if (!menuSettings) {
      const settings = loadSettings();
      menuSettings = new SettingsScreen(document.body, settings, {
        onResume: () => menuSettings?.hide(),
        onChange: (next) => saveSettings(next),
        onToggleFullscreen: () => {
          toggleFullscreen();
          syncRotateHint();
        },
        isFullscreen: () => isFullscreen(),
      });
      menuSettings.setTitle('设置', '设置保存在此设备，进入世界后立即生效', '返回');
      menuSettings.setMeta('');
    }
    // 打开菜单里的设置也压一条：返回键先关设置，而不是退出页面
    pushMenuGuard();
    menuSettings.show();
  };

  const menu = new WorldScreen(document.body, registry, {
    onEnter: (world) => void startWorld(world),
    onDelete: (world) => void deleteWorld(world),
    onSettings: openMenuSettings,
  });

  /** 删除世界：先删库再删清单项（顺序反了会留下没人认领的库） */
  const deleteWorld = async (world: WorldSummary): Promise<void> => {
    await SaveGame.deleteWorld(world.id);
    registry.remove(world.id);
  };

  // 开发调试入口：验收脚本用它建世界、看列表
  (window as unknown as { __worldMenu: WorldScreen }).__worldMenu = menu;
  // 启动耗时台账也挂出去：它是一个**读数的入口**（与 `__worldMenu` 同一类）
  (window as unknown as { __startup: typeof startupTrace }).__startup = startupTrace;
  menu.show();
  pushMenuGuard();
  // 主菜单的返回层级（批次 181）：设置 → 关掉；二级页 → 首页；首页 → 交给浏览器退出
  window.addEventListener('popstate', () => {
    if (!menu.isOpen) return; // 游戏内由 App 自己的守卫处理
    if (menuSettings?.isOpen) {
      menuSettings.hide();
      pushMenuGuard();
      return;
    }
    if (menu.view !== 'home') {
      menu.setView('home');
      pushMenuGuard();
      return;
    }
    // 首页：不再补守卫，让下一次返回真的退出页面
  });
  // 进游戏首页就"默认全屏 + 横屏"（用户要求）。浏览器不允许页面一加载就全屏，
  // 所以这里分三层（批次 167，用户："能不能在加载的时候自动进入"）：
  //  ① 已装成 PWA 立刻锁横屏；② 立刻**试着**进全屏（PWA / X5 内核里真能成）；
  //  ③ 被拒时把"第一次交互"挂到 document 上（点任意地方、按键都算），
  //     竖屏手机会先盖一层提示，点它就是那一次手势。
  preferInstalledLandscape();
  enterFullscreenOnBoot();
  armAutoFullscreen([document]);
  // 批次 184：竖屏下**任何时候点任何区域**都再试一次（不是一次性）——
  // 手机上第一次请求常见被拒（要等全屏完成后才允许锁方向），
  // 一次性的网摘掉之后玩家就会觉得"点半天才横过来"。
  armPresentOnTap(document);
  // 全屏进出都记一笔：手机上的"全屏忽然没了"常常是系统手势/切后台造成的
  document.addEventListener('fullscreenchange', () => {
    const full = isFullscreen();
    syncRotateHint();
    diag.event('app', 'fullscreen.change', { full });
  });
  // 没装成 PWA 时引导一次"添加到主屏幕"——那是标签页里唯一零点击全屏的路径
  installInstallHint();
  startupTrace.mark(STARTUP_PHASES.bootMenu);
}

void boot();
