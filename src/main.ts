/**
 * 入口：流式世界 + 光照 + 玩家物理 + 方块交互
 *
 * 每帧流程：
 *   输入 → PlayerPhysics 更新（逐轴碰撞 / 自动上台阶）→ 相机跟随
 *   → 视线射线选取方块 → 描边 → 破坏/放置 → 区块流式加载 → 光照收敛 → 网格化 → 渲染
 *
 * 方块被修改后会先做增量光照修正，等光照队列排空再重刷网格，
 * 避免出现"光还没传过去就把顶点烘焙下来"的脏数据。
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
import { bookshelfPower } from './core/crafting/Enchanting.ts';
import { isDrinkable, potionById, potionTint, type PotionEntry } from './core/registry/potions.ts';
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
import { PLAYER_THROW_SPEED, Throwable, type ThrowableKind } from './core/entity/Throwable.ts';
import { pickArrowAmmo } from './core/entity/ArrowAmmo.ts';
import { applyMending } from './core/crafting/Repair.ts';
import { enchantLevel } from './core/registry/enchantments.ts';
import { Sky } from './render/Sky.ts';
import { Weather, type WeatherKind } from './render/Weather.ts';
import { MobRenderer } from './render/MobRenderer.ts';
import { MATE_SEARCH_RANGE, Mob } from './core/entity/Mob.ts';
import { entityIntersectsBox } from './core/entity/Entity.ts';
import { mobTypeById } from './core/entity/mobs.ts';
import { DRAGON_CRUISE_Y, DRAGON_TYPE, Dragon, EndCrystal } from './core/entity/EndBoss.ts';
import { endPillarTops } from './core/gen/EndGenerator.ts';
import { RedstoneEngine, wirePowerOf, type RedstoneWorld } from './core/redstone/RedstoneEngine.ts';
import { GamepadInput } from './ui/GamepadInput.ts';
import { SettingsScreen, loadSettings, saveSettings, type GameSettings } from './ui/SettingsScreen.ts';
import { WorldScreen } from './ui/WorldScreen.ts';
import { Tooltip } from './ui/Tooltip.ts';
import { ChatInput } from './ui/ChatInput.ts';
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
import { RecipeBook } from './ui/RecipeBook.ts';
import { craftFromInventory } from './core/crafting/RecipeBook.ts';
import type { Recipe } from './core/crafting/Recipes.ts';
import { itemTooltip, resolveItemId } from './core/registry/itemNames.ts';
import { LEGACY_WORLD_ID, WorldRegistry, type WorldSummary } from './core/save/WorldRegistry.ts';
import type { WorldType } from './core/gen/WorldType.ts';
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
import { AudioEngine, type SoundKind } from './core/audio/AudioEngine.ts';
import { applyResourcePack, packNameFromFile, type ResourcePackResult } from './core/resourcepack/ResourcePack.ts';
import { SaveGame, type PlayerSave } from './core/save/SaveGame.ts';
import { ChunkEdits } from './core/save/ChunkEdits.ts';
import { restoreContainers, serializeContainers } from './core/save/ContainerSave.ts';
import { NetClient, defaultServerUrl } from './net/NetClient.ts';
import { REMOTE_PLAYER_TYPE } from './core/entity/mobs.ts';
import type { NetPlayerState } from './net/NetClient.ts';
import {
  delayOf,
  isFenceGateOpen,
  isTrapdoorOpen,
  portalAxis,
  withDelay,
  withFenceGateOpen,
  withTrapdoorOpen,
} from './core/registry/blockState.ts';
import { MobSpawner, MOB_DESPAWN_DISTANCE, type SpawnContext } from './core/entity/MobSpawner.ts';
import { raycastEntities } from './core/interaction/EntityRaycast.ts';
import { VoxelMaterial } from './render/VoxelMaterial.ts';
import { BlockOutline } from './render/BlockOutline.ts';
import { BlockOverlay, DAMAGE_STAGES } from './render/BlockOverlay.ts';
import { ParticleSystem } from './render/ParticleSystem.ts';
import { HandRenderer } from './render/HandRenderer.ts';
import { PlayerRenderer } from './render/PlayerRenderer.ts';
import { ScreenEffects, type ScreenEffect } from './render/ScreenEffects.ts';
import { World, toChunkCoord } from './core/world/World.ts';
import { Chunk } from './core/world/Chunk.ts';
import { DIMENSION_CYCLE, DIMENSION_LABELS, Dimension, isDimension, type DimensionId } from './core/gen/Dimension.ts';
import { Block, BLOCKS, blockDef, woolId } from './core/registry/blocks.ts';
import {
  ARMOR_SLOT_BASE,
  ARMOR_SLOT_COUNT,
  ARMOR_TYPES,
  armorInfoById,
  armorItemId,
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
  toolItemId,
  type ToolInfo,
  canTill,
  tillableTo,
} from './core/registry/tools.ts';
import { SEA_LEVEL } from './core/gen/OverworldGenerator.ts';
import { PlayerPhysics, type PlayerInput } from './core/physics/PlayerPhysics.ts';
import { raycastVoxels, type RayHit } from './core/interaction/Raycast.ts';
import { planPlacement } from './core/interaction/Placement.ts';
import {
  isDoorOpen,
  isDoorUpper,
  isSlabDouble,
  withDoorOpen,
  withDoorUpper,
} from './core/registry/blockState.ts';
import {
  TOTAL_SLOTS, HOTBAR_SIZE, Inventory, type ItemStack } from './core/container/Inventory.ts';
import { BrewingStand } from './core/container/BrewingStand.ts';
import { Furnace } from './core/container/Furnace.ts';
import { stationOfBlock } from './core/crafting/Smelting.ts';
import {
  JUNGLE_LOG_ID,
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
  CAKE_SLICES,
  cakeBites,
  flowerPotPlant,
  hopperOutputOffset,
  hopperOutputOf,
  isHopperLocked,
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

/** 渲染距离（区块） */
/** 视距默认值（玩家可在设置里改，见 `App.viewDistance`） */
const VIEW_DISTANCE = 12;
/** 每帧最多网格化的区块数，用于把加载耗时摊到多帧 */
const MESH_BUDGET_PER_FRAME = 3;

/** 游戏逻辑 tick（原版 20 次/秒），生存机制按这个节奏结算 */
const TICK_SECONDS = 0.05;
/** 随机刻的作用半径（区块）：原版是 128 格，这里取 3 个区块以免每 tick 做太多事 */
const RANDOM_TICK_RADIUS = 3;

/** 死亡后自动重生的等待时间（秒） */
const RESPAWN_DELAY = 3;

/**
 * 传送后等目的地区块加载的上限（帧；60fps 下 5 秒）。
 * 超时就把玩家直接放在目标坐标上——宁可落在地形里，也不要一直冻着出不来。
 */
const PORTAL_ARRIVAL_TIMEOUT_FRAMES = 300;

/** 玩家近战距离（原版约 3 格） */
const ATTACK_RANGE = 3.2;
/** 攻击冷却（原版满蓄力为 0.625 秒） */
const ATTACK_COOLDOWN = 0.5;
/**
 * 首次进入（没有存档、也没有世界清单）时用的默认种子。
 * 平时的种子由主菜单里的世界决定，见 `WorldConfig`。
 */
const DEFAULT_WORLD_SEED = 20261014;
/** 原版触及距离：生存 4.5 格 */
const REACH = 4.5;
/** 鼠标视角灵敏度（弧度/像素） */
const MOUSE_SENSITIVITY = 0.0022;
/**
 * 触摸视角灵敏度（弧度/像素）。
 * 比鼠标高：手指在屏幕上的一次拖动行程通常只有鼠标的 1/3 左右，
 * 用同样的系数会转得很吃力。
 */
const TOUCH_SENSITIVITY = 0.0034;

/**
 * 下界的雾颜色与视距。
 * 下界是被岩层包住的密闭空间，原版用很短的视距 + 暗红雾气表现"闷热的地下"，
 * 这里同样把雾拉近并换成暗红，同时关掉天空穹顶（那里没有天空）。
 */
const NETHER_FOG = 0x3a1010;
const NETHER_FOG_NEAR = 18;
const NETHER_FOG_FAR = 84;
/** 下界没有天光，场景亮度固定（岩浆与荧光石才是主要光源） */
const NETHER_SKY_BRIGHTNESS = 0.38;
/**
 * 末地的天空与雾。
 * 末地同样是"没有天光"的维度，但它不像下界那样密闭：外岛之间是开阔的虚空，
 * 所以雾拉得比下界远得多，背景是带紫的星空黑。
 */
const END_SKY = 0x0a0714;
const END_FOG = 0x140b22;
const END_FOG_NEAR = 48;
const END_FOG_FAR = 190;
const END_SKY_BRIGHTNESS = 0.42;
const END_MIN_BRIGHTNESS = 0.2;

/**
 * 视线介质的雾与色罩（E16）。
 * 水下能看清十几格、颜色偏青蓝；岩浆里只能看清贴脸的两三格，橙红一片。
 */
const WATER_FOG = 0x1b4a7a;
const WATER_FOG_NEAR = 0.6;
const WATER_FOG_FAR = 22;
const LAVA_FOG = 0x8a2a05;
const LAVA_FOG_NEAR = 0.2;
const LAVA_FOG_FAR = 2.6;
/** 粒子的最低亮度：夜里挖方块也要看得见碎块 */
const PARTICLE_MIN_BRIGHTNESS = 0.3;
/** 末影龙的出生点：盘旋圆上的一点（主岛在原点） */
const DRAGON_SPAWN_X = 0;
const DRAGON_SPAWN_Z = 46;
/**
 * 下界的最低亮度下限。
 * 下界光照全靠方块光，而方块光的传播范围有限，远离光源就是纯黑；
 * 原版下界靠"维度环境光"把整片空间托起来，这里用同一个手段（抬高亮度下限）。
 */
const NETHER_MIN_BRIGHTNESS = 0.24;

/** 连续破坏/放置的最小间隔（秒） */
const BREAK_COOLDOWN = 0.25;
const PLACE_COOLDOWN = 0.22;
/** 进食时的咀嚼间隔（秒）：每嚼一口晃一下手臂、响一声咀嚼音 */
const CHEW_INTERVAL = 0.4;

/**
 * 开发期初始物资：补齐各色基础方块，便于立刻验证玩法。
 * 生存模式（I1）接入后这里应当清空，改为从世界采集。
 */
/** 界面打开时喂给物理的空输入，让玩家原地停住而不是保持上一帧的速度 */
const IDLE_INPUT: PlayerInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

/** 把多路输入相加后夹到 -1~1（键盘 + 触摸 + 手柄可能同时给出分量） */
function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/**
 * 当前正在玩的世界（由主菜单选定）。
 * 没有它就没法知道该用哪个种子、哪种地形、往哪个存档库里存。
 */
export interface WorldConfig {
  id: string;
  name: string;
  seed: number;
  worldType: WorldType;
  /** 新建这个世界时选的难度（进世界后还能用 /difficulty 改） */
  difficulty: Difficulty;
}

const STARTING_HOTBAR: readonly number[] = [
  Block.GRASS_BLOCK,
  Block.DIRT,
  Block.STONE,
  Block.COBBLESTONE,
  Block.OAK_PLANKS,
  Block.OAK_LOG,
  Block.OAK_LEAVES,
  Block.GLASS,
  Block.GLOWSTONE,
  // 开发期工具：木镐/石镐/铁镐/钻石镐 + 斧/锹/剑，方便直接验收挖掘等级与伤害
  toolItemId('pickaxe', 'wooden'),
  toolItemId('pickaxe', 'stone'),
  toolItemId('pickaxe', 'iron'),
  toolItemId('pickaxe', 'diamond'),
  toolItemId('axe', 'iron'),
  toolItemId('shovel', 'iron'),
  toolItemId('sword', 'iron'),
  // 开发期盔甲：皮革/铁/钻石各一套，方便对比护甲条的档位与减伤
  ...(['leather', 'iron', 'diamond'] as const).flatMap((material) => ARMOR_TYPES.map((type) => armorItemId(type, material))),
  // 开发期下界合金（K8 尾巴）：锻造台 + 材料 + 远古残骸，配合上面的钻石装备就能走通"升级"这条链
  Block.SMITHING_TABLE,
  Item.NETHERITE_INGOT,
  Block.ANCIENT_DEBRIS,
  Block.NETHERITE_BLOCK,
  // 开发期切石机（H11，批次 44）：本体 + 几种"能切出东西"的石料，
  // 放下就能右键试"一进多选"（石板/楼梯/墙/深板岩瓦都在它的候选里）
  Block.STONECUTTER,
  Block.STONE,
  Block.POLISHED_DEEPSLATE,
  Block.QUARTZ_BLOCK,
  // 开发期红沙与红砂岩（批次 45）：红沙是恶地地表那一层，也是红砂岩家族的唯一起点
  Block.RED_SAND,
  Block.RED_SANDSTONE,
  // 开发期烟熏炉与高炉（批次 46）：旁边就有生肉与粗铁，放下就能对比"2 倍速"与"只吃什么"
  Block.SMOKER,
  Block.BLAST_FURNACE,
  // 开发期营火（批次 47）：放下就点着，塞几块生肉就能看"30 秒弹一个"的节奏
  Block.CAMPFIRE,
  // 开发期食物与作物（批次 48）：种子 + 一碗一锅，落地就能试"种甜菜 → 煮汤"这条链
  Item.BEETROOT_SEEDS,
  Item.BEETROOT,
  Item.BOWL,
  Item.MUSHROOM_STEW,
  Item.PUMPKIN_PIE,
  // 开发期甜浆果与可可豆（批次 49）：对着**草方块**种浆果、对着**丛林原木侧面**种可可豆，
  // 再把手里的曲奇喂给自己——一条链在三步之内能走完
  Item.SWEET_BERRIES,
  Item.COCOA_BEANS,
  Item.COOKIE,
  JUNGLE_LOG_ID,
  // 开发期附魔与铁砧一条链：铁砧本体 + 修它要用的铁块/铁锭 + 附魔台要用的书/青金石
  Block.ANVIL,
  Block.IRON_BLOCK,
  Item.IRON_INGOT,
  Item.BOOK,
  Block.ENCHANTING_TABLE,
  Block.BOOKSHELF,
  Item.LAPIS_LAZULI,
  // 开发期弓与箭（J9）：一拉就能射
  Item.BOW,
  Item.ARROW,
  Item.STRING,
  Item.FLINT,
  // 开发期铜的四档（批次 40）：四档铜块 + 切制铜，右键几下就能看到氧化与刮锈
  Block.COPPER_BLOCK,
  Block.EXPOSED_COPPER_BLOCK,
  Block.WEATHERED_COPPER_BLOCK,
  Block.OXIDIZED_COPPER_BLOCK,
  Block.CUT_COPPER,
];

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
    // 阳光传感器（批次 54）：红石引擎里唯一一个要看**光照**的元件
    getSkyLight: (x, y, z) => this.world.getSkyLight(x, y, z),
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
   * 传送途中：维度已经切过去了、正在等目的地的区块加载。
   *
   * 不为 null 时**冻结玩家物理**——新区块还没生成出来，`getBlock` 一律返回空气，
   * 不冻住的话玩家会在"空"世界里一直往下掉。加载完就把玩家放进目的地那座门里。
   */
  private pendingArrival: (PortalTarget & { axis: PortalAxis; frames: number }) | null = null;

  /** 传送门逻辑看到的世界（`PortalWorld` 接口） */
  private readonly portalWorld: PortalWorld = {
    getBlock: (x, y, z) => this.world.getBlock(x, y, z),
    getState: (x, y, z) => this.world.getBlockState(x, y, z),
    // 走 setBlockAndUpdate：光照、网格与增量存档都会跟着更新
    setBlock: (x, y, z, id, state) => this.world.setBlockAndUpdate(x, y, z, id, state),
  };
  /** 生物渲染 */
  private readonly mobRenderer: MobRenderer;
  /** 生物生成规则 */
  private readonly mobSpawner = new MobSpawner();
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
  /** 背包界面是否打开；打开时暂停移动、视角与方块交互 */
  private uiOpen = false;
  private readonly hotbarSlots: HTMLDivElement[] = [];
  /** 聊天与命令输入（左下角消息栏 + 命令输入行） */
  private readonly chat = new ChatInput();
  /** 玩家名（联机时用服务端给的，单机固定"玩家"） */
  private playerName = '玩家';
  /** 难度（I7）：保存在世界里 */
  private difficulty: Difficulty = 'normal';
  /** 难度被命令改动时的回调（主菜单用它回写世界清单） */
  onDifficultyChanged: ((value: Difficulty) => void) | null = null;
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

  /** 自动保存间隔（秒）：与原版的自动保存节奏接近 */
  private readonly autoSaveInterval = 30;
  private autoSaveTimer = 0;
  /** 上次保存的结果（调试面板与验收脚本用） */
  private lastSaveAt = 0;
  private lastSaveMs = 0;
  private saveCount = 0;
  /** 末影龙是否已被击败（会写进存档，决定重进末地要不要再生成 boss） */
  private dragonDefeated = false;

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
  private frameTimeAvg = 16.7;
  /** 调试用：把帧时间固定成这个值（毫秒），0 表示用真实值。验收脚本靠它稳定复现"掉帧" */
  private simulatedFrameTime = 0;
  /** 自适应视距的冷却倒计时（秒）：避免帧率在阈值附近抖动时反复升降 */
  private adaptiveCooldown = 3;
  private netStatus = '未连接（按 L 联机）';
  private chatLine = '';
  private chatUntil = 0;

  private yaw = 0;
  private pitch = -0.22;
  private readonly keys = new Set<string>();
  private locked = false;
  private flying = false;
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
  private loadingCleared = false;

  constructor(
    container: HTMLElement,
    private readonly debugEl: HTMLElement,
    private readonly overlayEl: HTMLElement,
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
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.skyColor = new THREE.Color(0x8fc7ff);
    this.scene.background = this.skyColor;

    const fogFar = this.viewDistance * 16;
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, fogFar + 32);
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
    this.applyEnvironment();

    // 网格化放在独立 Worker 池里：地形生成的 Worker 忙于长任务，混在一起会互相拖慢。
    // 留 2 个核心给主线程（渲染 + 物理），最多用 2 个做网格化。
    const meshWorkers = Math.max(1, Math.min(2, (navigator.hardwareConcurrency ?? 4) - 2));
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

    this.world.events = {
      onChunkLoaded: (chunk) => {
        // 结构箱的战利品（K8 尾巴）：方块状态里写着"哪张表"，在这里按表掷点填进容器。
        // 放在网格化之前也没关系——箱子内容不影响渲染
        fillLootChests(chunk, this.dimension, this.world.seed, this.world.containers);
        this.chunkRenderer.onChunkLoaded(chunk.cx, chunk.cz);
        this.refreshLoadingState();
      },
      onChunkUnloaded: (cx, cz) => {
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
        onOpenRecipes: () => this.openRecipeBook(),
        // 熔炉产物被取空时结算烧炼经验（I5）
        onFurnaceXp: (amount) => this.awardXp(amount),
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
    // 放进 #app 就会被 DOM 更靠后的遮罩（#overlay / #death）盖住
    this.recipeBook = new RecipeBook(document.body, atlas, this.inventory, {
      onCraft: (recipe) => this.craftFromBook(recipe),
    });

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
    };

    // 护甲：把背包（36-39 号槽）当作护甲提供者接给生存系统。
    // 走这道接口而不是直接在伤害入口算，是为了让**环境伤害也自动吃到减伤**
    this.stats.armor = createArmorWearer(this.inventory);

    // 设置 / 暂停菜单（K3）：应用后立即生效，不必重开局
    this.viewDistance = this.settings.viewDistance;
    this.audio.volume = this.settings.volume;
    this.lastStepX = this.physics.x;
    this.lastStepZ = this.physics.z;
    this.settingsScreen = new SettingsScreen(document.body, this.settings, {
      onResume: () => this.closeSettings(),
      onExitToMenu: () => void this.exitToMenu(),
      onDeleteWorld: () => void this.deleteCurrentWorld(),
      onChange: (settings) => this.applySettings(settings),
      onResourcePack: (file) => void this.loadResourcePack(file),
    });

    // 开发期初始物资（见 STARTING_HOTBAR 注释）
    for (const blockId of STARTING_HOTBAR) this.inventory.add(blockId, 64);

    // 触摸操作层：只在手势设备上创建，桌面端完全不引入这套 DOM
    this.touch = isTouchDevice() ? this.createTouchControls() : null;

    this.bindEvents();
    // 没有存档时直接按出生点请求区块；
    // 有存档时先不请求 —— 读档要先装载"方块增量"，否则先加载进来的区块
    // 会以未修改的自然地形生成，之后还要回炉重算光照与网格（会在玩家眼前闪一下）
    if (!this.save?.hasSave) this.refreshWorld(0, 0, true);
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
      // 轻点：放置方块，或与工作台/熔炉/箱子/门交互（与鼠标右键同一套逻辑）
      onTap: () => {
        this.touchPlaceRequest = true;
      },
      // 长按：等价于按住左键破坏
      onBreakStart: () => {
        this.leftDown = true;
      },
      onBreakEnd: () => {
        this.leftDown = false;
      },
      onToggleInventory: () => this.inventoryScreen.toggle(),
      onCycleView: () => this.cycleCameraMode(),
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
  private applySettings(settings: GameSettings): void {
    this.cameraMode = settings.cameraMode;
    this.viewDistance = settings.viewDistance;
    // 玩家手动改视距时把自适应冷却重置：否则刚拖完滑块又要等几秒才允许升降
    this.adaptiveCooldown = 3;
    this.camera.fov = settings.fov;
    this.camera.far = settings.viewDistance * 16 + 32;
    this.camera.updateProjectionMatrix();
    this.audio.volume = settings.volume;
    this.particles.setDensity(PARTICLE_DENSITY[settings.particles]);
    this.sky.setCloudsVisible(settings.clouds);
    this.debugEl.style.display = settings.showDebug ? '' : 'none';
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
        ? `存档：${save.hasSave ? '已保存' : '新世界'} · 改动 ${save.edits} 格 / ${save.editedChunks} 区块 · 自动保存每 30 秒`
        : '存档：不可用（浏览器未提供 IndexedDB）',
    );
    this.settingsScreen.show();
    // 能按 Esc 说明玩家已经在玩了，"点击进入游戏"的遮罩没必要再挡着菜单
    this.overlayEl.classList.add('hidden');
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

  /** 背包开关：打开时释放指针锁并停用移动/交互，关闭时重新锁定视角 */
  private handleInventoryOpen(open: boolean): void {
    this.uiOpen = open;
    this.keys.clear();
    this.leftDown = false;
    this.rightDown = false;
    // 触摸端：界面打开时收起操作层，避免界面开着人还在走
    if (this.touch) this.touch.visible = !open;

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
    this.setFlying(data.flying);
    this.timeOfDay = data.timeOfDay;
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
    this.selectSlot(data.selectedSlot);
    this.refreshHotbar();
    this.inventoryScreen.refresh();

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
      timeOfDay: this.timeOfDay,
      health: this.stats.health,
      food: this.stats.food,
      saturation: this.stats.saturation,
      air: this.stats.air,
      exhaustion: this.stats.exhaustion,
      inventory: this.inventory.serialize(),
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
      this.save.addPlayTime(this.autoSaveInterval);
      await this.save.saveMeta(this.save.buildMeta(this.worldConfig.seed, this.world.edits.totalEdits));
      this.save.resetSessionTime();
      this.world.edits.markSaved();

      this.lastSaveAt = Date.now();
      this.lastSaveMs = performance.now() - started;
      this.saveCount++;
      // 通知主菜单刷新"上次游玩 / 游玩时长 / 改动数"（没接就什么都不做）
      this.onSaved?.({
        playTime: this.save.meta?.playTime ?? 0,
        edits: this.world.edits.totalEdits,
      });
      return true;
    } catch (error) {
      console.warn(`[save] ${reason} 保存失败`, error);
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

  /** 删除存档并重载页面（"新世界"入口） */
  /**
   * 保存并回到主菜单。
   *
   * 直接 `location.reload()` 最省心：启动流程本来就会先出主菜单，
   * 重载之后所有渲染资源、Worker、世界状态都干净重建，不必手写一套"卸载世界"的流程。
   */
  async exitToMenu(): Promise<void> {
    await this.saveNow('exit');
    window.location.reload();
  }

  /** 删除当前世界：连存档库一起删掉，再回主菜单 */
  async deleteCurrentWorld(): Promise<void> {
    await SaveGame.deleteWorld(this.worldConfig.id);
    this.onWorldDeleted?.(this.worldConfig.id);
    window.location.reload();
  }

  /** 世界被删掉时由 boot 注入的回调（App 本身不认识世界清单） */
  onWorldDeleted: ((worldId: string) => void) | null = null;

  // ---------------------------------------------------------------- 环境

  /**
   * 把时间换算成天空亮度与天空颜色，推给材质与场景。
   * 因为光照等级是烘焙在顶点属性里的，这里每帧只改 uniform，开销可以忽略。
   */
  private applyEnvironment(): void {
    this.applyDimensionEnvironment();
    this.applyMediumEnvironment();
  }

  private applyDimensionEnvironment(): void {
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

    const fogFar = (this.viewDistance * 16 - 6) * (1 - overcast * 0.45);
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
    // 原版门的紫色是盖在一切之上的，否则在门里看水面会变成一片青色
    const effect =
      this.pendingArrival !== null || this.playerInPortal() ? 'portal' : this.eyeMedium();
    this.screenEffects.set(effect);

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
    }

    this.particles.update(dt);
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
    this.world.update(centerCx, centerCz, this.viewDistance);
  }

  /**
   * 只要第一块地形完成网格化就撤掉加载遮罩。
   * 注意：必须在主循环里检查——区块"加载完成"时还没有网格，只监听加载事件会永远等不到。
   */
  private refreshLoadingState(): void {
    if (this.loadingCleared) return;
    if (this.chunkRenderer.chunkMeshCount === 0) return;
    this.loadingCleared = true;
    document.getElementById('loading')?.remove();
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

    if (!this.hotbarTooltipBound) {
      this.hotbarTooltipBound = true;
      this.tooltip.delegate(container, (element) => {
        const index = Number(element.dataset.index);
        if (!Number.isFinite(index)) return null;
        const stack = this.inventory.get(index);
        return stack ? itemTooltip(stack.id, stack.count, stack.damage, stack.enchants, stack.name) : null;
      });
    }

    // 触摸端点快捷栏切换（鼠标路径走键盘 1-9）
    bindHotbarTouch(container, (index) => {
      this.hotbarIndex = index;
      this.refreshHotbar();
    });

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
   * 所有来源都走这里：击杀生物（`EntityContext.awardXp`）、挖矿、熔炉取出产物。
   * 经验球实体还没做，所以是**直接进账**；`Experience.add` 自己处理连升多级与小数余数。
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
    if (this.flying || amount <= 0) return;
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
    const toolName = { pickaxe: '镐', axe: '斧', shovel: '锹', hoe: '锄', sword: '剑', shears: '剪刀' }[required.tool];
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
      // Esc：打开/关闭暂停菜单（内含设置）。原版也是 Esc 唤出菜单而不是直接退出
      if (e.code === 'Escape' && !this.inventoryScreen.isOpen) {
        e.preventDefault();
        this.toggleSettings();
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
          this.hotbarIndex = digit - 1;
          this.refreshHotbar();
        }
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));

    if (this.touch) {
      // 触摸端不用指针锁：点一下遮罩就开始玩
      this.overlayEl.addEventListener('pointerdown', () => this.overlayEl.classList.add('hidden'));
    } else {
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === this.renderer.domElement;
        this.overlayEl.classList.toggle('hidden', this.locked);
        if (!this.locked) {
          this.keys.clear();
          this.leftDown = false;
          this.rightDown = false;
        }
      });

      const requestLock = () => void this.renderer.domElement.requestPointerLock();
      this.overlayEl.addEventListener('click', requestLock);
      this.renderer.domElement.addEventListener('click', requestLock);

      document.addEventListener('mousemove', (e) => {
        if (!this.locked) return;
        // 灵敏度是设置项（0.5~2 倍）：鼠标、触摸、手柄三条路径都要乘上，不然调了没感觉
        const gain = this.settings.sensitivity;
        this.applyLook(e.movementX * MOUSE_SENSITIVITY * gain, e.movementY * MOUSE_SENSITIVITY * gain);
      });

      document.addEventListener('mousedown', (e) => {
        if (!this.locked) return;
        if (e.button === 0) this.leftDown = true;
        if (e.button === 2) this.rightDown = true;
      });
      document.addEventListener('mouseup', (e) => {
        if (e.button === 0) this.leftDown = false;
        if (e.button === 2) this.rightDown = false;
      });
      document.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
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
    return this.setCameraMode(nextCameraMode(this.cameraMode));
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
    if (this.selectedBlock !== Block.LILY_PAD) return false;
    if (this.world.getBlock(x, y, z) !== Block.WATER) return false;
    return this.world.getBlock(x, y + 1, z) === Block.AIR;
  }

  private updateInteraction(dt: number): void {
    if (this.uiOpen) {
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
    if (held === undefined) return false;
    if (held === Item.SHEARS && this.shearMob(mob)) return true;
    if (held === Item.BUCKET && this.milkMob(mob)) return true;
    return this.feedMob(mob, held);
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
    // 牛羊猪鸡都吃这几样，用各自家族的叫声最贴切；没有的用通用的"吃掉"音
    this.audio.play(result === 'grow' ? 'mob_sheep' : 'eat', { x: mob.x, y: mob.y, z: mob.z });
    this.refreshHotbar();
    return true;
  }

  /** 用剪刀剪一只羊的毛 */
  private shearMob(mob: Mob): boolean {
    const count = mob.shear();
    if (count <= 0) return false;

    this.spawnDrop(woolId(mob.woolColor), count, mob.x, mob.y + 0.6, mob.z);
    this.audio.play('shear');
    this.particles.spawnSmoke(mob.x, mob.y + 0.7, mob.z, 8, 0.22);
    // 剪刀也要掉耐久（原版每剪一次 -1）
    this.damageHeldTool();
    this.refreshHotbar();
    return true;
  }

  private updateAttacking(dt: number): void {
    this.suppressBreaking = false;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (!this.leftDown || this.uiOpen || this.attackCooldown > 0) return;

    const context = this.lastEntityContext;
    if (!context) return;

    const mob = this.mobUnderCrosshair();
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
    const damage = this.flying ? 100 : critical ? base * 1.5 : base;
    // 抢夺只影响掉落数量（在 mob.hurt 内部结算）
    mob.hurt(damage, mob.x - this.physics.x, mob.z - this.physics.z, context, lootingBonus(this.heldEnchants));
    this.hand.swing();
    // 攻击也要消耗耐久（原版剑/斧砍怪掉耐久）
    this.damageHeldTool();
    if (mob.dead) {
      // 死亡的烟：原版生物死时会冒一团烟
      this.particles.spawnSmoke(mob.x, mob.y + 0.5, mob.z, 10, 0.32);
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
    const required = this.flying ? 0 : breakSeconds(id, tool, this.heldEnchants) / this.effects.miningSpeedMultiplier();
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

    this.dropContainerContents(this.hit.x, this.hit.y, this.hit.z);
    this.world.setBlockAndUpdate(this.hit.x, this.hit.y, this.hit.z, Block.AIR);
    // 敲掉黑曜石 → 检查旁边的传送门还立不立得住（K8）：框一破，那一整片门方块跟着熄灭
    if (brokenId === Block.OBSIDIAN) this.breakPortalsBeside(this.hit.x, this.hit.y, this.hit.z);
    this.particles.spawnBlockBreak(
      this.hit.x + 0.5,
      this.hit.y + 0.5,
      this.hit.z + 0.5,
      this.blockParticleColor(brokenId),
    );

    // 创造模式不产生掉落（与原版一致）
    // G4：还需要"手上工具够格"——石镐挖不动钻石矿（挖得动但一无所获）
    if (!this.flying && canHarvest(brokenId, tool)) {
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
        this.spawnDrop(drop.id, drop.count, this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5);
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
    // 与掉落无关——铁矿挖出来有粗铁但**不给**经验，与原版一致；创造模式不给
    if (!this.flying) this.awardXp(rollBlockXp(brokenId, Math.random()));

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
    this.audio.play('door', { x: x + 0.5, y: baseY + 0.5, z: z + 0.5 });
  }

  /**
   * 活板门 / 栅栏门的开合（批次 30；批次 38 起按形状判定，不再写死橡木）。
   *
   * 两者都是**单格**方块，只需要翻自己的开关位（与门共用同一个位，见 `blockState.ts`）。
   * 与门一样播 `door` 音效——原版这三种的开合音是同一套木质声。
   */
  private toggleOpenable(x: number, y: number, z: number, id: number): void {
    const state = this.world.getBlockState(x, y, z);
    const next =
      blockDef(id).shape === 'trapdoor'
        ? withTrapdoorOpen(state, !isTrapdoorOpen(state))
        : withFenceGateOpen(state, !isFenceGateOpen(state));
    this.world.setBlockAndUpdate(x, y, z, id, next);
    this.audio.play('door', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
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
    if (!this.flying) {
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
      if (this.flying) continue;
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
      if (this.flying || dy !== 0) continue;
      // 掉落**这一种**门（原来写死 `dropFor(Block.OAK_DOOR)`，加别的木材就会掉错东西）
      const drop = dropFor(id);
      if (drop) this.spawnDrop(drop.id, drop.count, x + 0.5, baseY + 0.5, z + 0.5);
    }
  }

  /** 生成一堆掉落物 */
  private spawnDrop(itemId: number, count: number, x: number, y: number, z: number): void {
    this.entities.spawn(new ItemEntity(itemId, count, x, y, z));
  }

  /**
   * 生物生成与消失。
   * 生成只发生在已加载区块（未加载时 getBlock 返回空气，规则会自然拒绝），
   * 因此不需要额外的"是否加载"判断也不会刷到虚空中。
   */
  private updateMobSpawning(dt: number): void {
    let hostileCount = 0;
    let passiveCount = 0;
    const player = { x: this.physics.x, y: this.physics.y, z: this.physics.z };

    for (const entity of this.entities.all) {
      if (!(entity instanceof Mob)) continue;
      if (entity.type.hostile) {
        hostileCount++;
        // 敌对生物离玩家太远就消失，避免远处无限堆积
        if (Math.hypot(entity.x - player.x, entity.z - player.z) > MOB_DESPAWN_DISTANCE) {
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
      spawn: (type, x, y, z) => {
        this.entities.spawn(new Mob(type, x, y, z));
      },
      hostileCount,
      passiveCount,
    };
    this.mobSpawner.update(dt, ctx);
  }

  /**
   * 生物对玩家造成伤害：结算生命值并施加击退。
   * 创造模式（飞行）免疫；无敌帧由 PlayerStats 判断。
   */
  private damagePlayer(amount: number, sourceX: number, sourceZ: number, cause: DamageCause = 'generic'): void {
    // 触觉反馈：受击用"双短震"区分于放方块的轻震
    if (amount > 0) this.vibrate([18, 40, 18]);
    if (amount > 0) this.audio.play(this.stats.health <= 0 ? 'death' : 'hurt');
    if (this.flying) return;
    // 难度倍率：和平难度下生物不造成伤害（原版和平难度敌对生物根本不生成）
    const damage = amount * difficultyProfile(this.difficulty).mobDamage;
    if (damage <= 0) return;
    // 状态效果（抗性提升）在统一入口里叠加
    const before = this.stats.health;
    this.applyIncomingDamage(damage, cause);
    const result = { applied: before - this.stats.health };
    if (result.applied <= 0) return;

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
      pickup: (itemId, count) => this.inventory.add(itemId, count),
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      player: { x: this.physics.x, y: this.physics.y, z: this.physics.z },
      hurtPlayer: (amount, sourceX, sourceZ, cause) => this.damagePlayer(amount, sourceX, sourceZ, cause),
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
        const baby = new Mob(type, x, y, z);
        baby.makeBaby();
        this.entities.spawn(baby);
        // 原版生小动物有"噗"的一声，这里用一个短促的烟雾 + 移动音效代替
        this.audio.play('step', { x, y, z });
        this.particles.spawnSmoke(x, y + 0.3, z, 6, 0.28);
      },
      spawnHearts: (x, y, z, scale) => this.particles.spawnHearts(x, y, z, scale),
      awardXp: (amount) => this.awardXp(amount),
      // 鸡蛋砸出小鸡（K4 尾巴）：与 `spawnBaby` 同一个套路，只是不走求爱那一套
      hatchChicken: (x, y, z) => {
        const chicken = mobTypeById('chicken');
        if (!chicken) return;
        const baby = new Mob(chicken, x, y, z);
        baby.makeBaby();
        this.entities.spawn(baby);
        this.particles.spawnSmoke(x, y + 0.2, z, 6, 0.24);
      },
      // 喷溅药水的范围结算（K4 尾巴）：实体层只报"在哪炸了"，周围有谁得问这里
      applySplash: (potionId, x, y, z) => this.applySplash(potionId, x, y, z),
      // 滞留药水摔碎 → 原地留一片云；末影龙吐息 → 吐一团血息云
      spawnLingering: (potionId, x, y, z) => this.spawnLingeringCloud(potionId, x, y, z),
      spawnDragonBreath: (x, y, z) => this.spawnDragonBreathCloud(x, y, z),
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
        if (!entity.dead && this.mobInFire(entity)) entity.ignite(FIRE_IGNITE_SECONDS);
        mobs.push(entity);
      }
    }
    // 联机队友也交给同一个渲染器（只是不进 EntityManager，不跑 AI 与物理）
    for (const mob of this.remotePlayers.values()) mobs.push(mob);
    this.mobRenderer.update(mobs, this.camera, dt, sampleLight);
    this.updateEndBoss();
    this.updateMobSpawning(dt);
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
      setCreative: (on) => this.setFlying(on),
      isCreative: () => this.flying,
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
      summon: (name, x, y, z) => {
        const type = mobTypeById(name);
        if (!type) return false;
        this.entities.spawn(new Mob(type, x + 0.5, y, z + 0.5));
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
  }

  /**
   * 玩家改动方块之后唤醒周围的流体（放水、挖掉水底会让水重新流）。
   * 放在破坏/放置的公共出口上，避免每个调用点都写一遍。
   */
  private wakeFluidsAround(x: number, y: number, z: number): void {
    wakeFluidAt(this.fluidWorld, x, y, z);
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

  /** 打开配方书（背包里的按钮与 R 键都走这里） */
  private openRecipeBook(): void {
    this.inventoryScreen.close();
    this.recipeBook.show();
    this.handleInventoryOpen(true);
    // 与暂停菜单一样：能打开界面说明玩家已经在玩了，"点击进入游戏"的遮罩没必要再挡着
    this.overlayEl.classList.add('hidden');
  }

  /** R 键：开/关配方书。关掉时要把 uiOpen 交回给背包（背包可能还开着） */
  private toggleRecipeBook(): void {
    if (this.recipeBook.isOpen) {
      this.recipeBook.hide();
      this.handleInventoryOpen(this.inventoryScreen.isOpen);
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
      this.inventoryScreen.openWith('chest', this.world.containers.getOrCreateChest(this.dimension, x, y, z));
      return true;
    }
    // 漏斗（批次 58）：右键打开 5 格。⚠️ 打开界面时**不暂停搬运**（原版也照搬）——
    // 所以能看着东西一格一格往里进，这也是调试搬运逻辑最直观的方式
    if (hitBlock === Block.HOPPER) {
      this.inventoryScreen.openWith('hopper', this.world.containers.getOrCreateHopper(this.dimension, x, y, z));
      return true;
    }
    // 投掷器（批次 59）：右键打开 9 格（3×3）。它的"动作"是红石脉冲，界面里只看存货
    if (hitBlock === Block.DROPPER) {
      const dropper = this.world.containers.getOrCreateDropper(this.dimension, x, y, z);
      dropper.facing = sixFacingOf(this.world.getBlockState(x, y, z));
      this.inventoryScreen.openWith('dropper', dropper);
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

    // ---- 红石元件：拉杆开关、按钮按下
    if (hitBlock === Block.LEVER) return this.redstone.toggleLever(this.redstoneWorld, x, y, z);
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
      return this.redstone.pressButton(this.redstoneWorld, x, y, z);
    }
    if (hitBlock === Block.REPEATER) {
      // 右键循环切换延迟档位（原版行为：0.1 / 0.2 / 0.3 / 0.4 秒）
      const state = this.world.getBlockState(x, y, z);
      this.world.setStateAndUpdate(x, y, z, withDelay(state, (delayOf(state) + 1) & 3));
      return true;
    }

    return false;
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

    // 血条
    if (this.bossBarEl && this.bossFillEl) {
      const dragon = this.endDragon;
      const show = this.dimension === Dimension.END && dragon !== null && !dragon.dead;
      this.bossBarEl.classList.toggle('on', show);
      if (show && dragon) {
        const ratio = Math.max(0, Math.min(1, dragon.health / DRAGON_TYPE.health));
        this.bossFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
      }
    }
  }

  /**
   * 在末地主岛上方生成末影龙，并在 10 根黑曜石柱顶生成末地水晶。
   * 柱顶坐标由 `endPillarTops` 给出——与 Worker 里生成柱子的算法同源，位置必然对得上。
   */
  private spawnEndBoss(): void {
    if (this.endDragon && !this.endDragon.dead) return;

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
    if (blockId === Block.DROPPER) this.world.containers.getOrCreateDropper(target, x, y, z);
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
      this.spawnDrop(stack.id, stack.count, x + 0.5, y + 0.5, z + 0.5);
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
    if (block === Block.HOPPER) return store.getOrCreateHopper(dimension, x, y, z);
    if (block === Block.DROPPER) return store.getOrCreateDropper(dimension, x, y, z);
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
      return { id: entity.itemId, count: 1 };
    }
    return null;
  }

  /**
   * 投掷器收到一个红石**上升沿**：吐一件（批次 59）。
   *
   * 只在这一次调用里做完三件事——确认方块还在、拿到容器、`serve` 一次。
   * 抽成独立方法而不是写在回调里，是为了让"信号 → 吐东西"这条链在调试面板/断言
   * 里也能直接调（自动化脚本不必真去搭一条红石钟）。
   */
  dispenseFrom(x: number, y: number, z: number): void {
    // 位置被换掉了（信号在队列里排队期间方块没了）——静默跳过
    if (!this.world.isLoaded(x, z) || this.world.getBlock(x, y, z) !== Block.DROPPER) return;
    const container = this.world.containers.getOrCreateDropper(this.dimension, x, y, z);
    // 朝向缓存进容器，界面才写得出"朝北"（见 `Dropper.facing`）
    container.facing = sixFacingOf(this.world.getBlockState(x, y, z));
    container.serve(this.dropperEnv(x, y, z));
  }

  /** 投掷器吐一次要问外界的两个问题：朝向那一格是不是容器、不是容器时往哪扔 */
  private dropperEnv(x: number, y: number, z: number): DropperEnv {
    const [dx, dy, dz] = sixFacingOffset(sixFacingOf(this.world.getBlockState(x, y, z)));
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
   * ⚠️ 已知缺口（记在 TASKS H16）：掉落物实体只带"物品 id + 数量"，
   * 所以带耐久/附魔/改名的东西吐出来之后会掉这些字段——破坏容器时的掉落
   * （`spawnDrop`）也是同一条限制，一起在"物品 NBT 收尾"里解决。
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
          : potion?.splash === true
            ? 'splash_potion'
            : potion?.lingering === true
              ? 'lingering_potion'
              : null;
    if (kind === null) return false;

    // 先扣再扔：扔不出去（背包里其实没有）时什么都不该发生
    if (!this.inventory.consume(held, 1)) return false;

    const cosPitch = Math.cos(this.pitch);
    const dirX = -Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = -Math.cos(this.yaw) * cosPitch;

    // 出手点在眼睛前下方一点（与射箭一致），避免刚出手就撞上自己脚边的方块
    this.entities.spawn(
      new Throwable(
        this.physics.x + dirX * 0.4,
        this.physics.eyeY - 0.1,
        this.physics.z + dirZ * 0.4,
        { x: dirX * PLAYER_THROW_SPEED, y: dirY * PLAYER_THROW_SPEED, z: dirZ * PLAYER_THROW_SPEED },
        {
          kind,
          itemId: held,
          potionId: kind === 'splash_potion' || kind === 'lingering_potion' ? held : undefined,
        },
      ),
    );

    this.audio.play('bow_shoot');
    this.hand.swing();
    this.vibrate(8);
    this.refreshHotbar();
    return true;
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
    // 触摸端是"一次性轻点"，鼠标是"按住不放"，这里统一成一个待执行标记
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

    // 没有命中方块就没什么可放/可交互的（投掷在上面已经处理过了）
    if (!this.hit) return;

    // 右键功能方块：潜行时仍然走放置逻辑（与原版一致）
    const sneak = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (!sneak && this.useFunctionalBlock(this.hit.x, this.hit.y, this.hit.z)) {
      this.placeCooldown = PLACE_COOLDOWN * 2;
      return;
    }

    // 触摸端只有一次轻点，放完就要清掉，否则会一直放
    this.touchPlaceRequest = false;

    // 对生物使用物品（剪羊毛）：看在功能方块之后、放置之前——
    // 玩家准星对着羊时，那一下应该剪羊毛而不是把方块放到羊身上
    if (this.useOnEntity()) {
      this.placeCooldown = PLACE_COOLDOWN * 2;
      this.touchPlaceRequest = false;
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
      }
      return;
    }

    // 藤蔓"再挂一面"：改的是**落点那一格**（它已经是同一种藤蔓了）
    if (plan.mergeIntoTarget) {
      if (this.world.setBlockAndUpdate(x, y, z, blockId, plan.mergeIntoTarget.state)) {
        this.placeCooldown = PLACE_COOLDOWN;
        this.inventory.consume(blockId, 1);
        this.net.sendBlock(x, y, z, blockId, plan.mergeIntoTarget.state, this.dimension);
      }
      return;
    }

    if (this.world.setBlockAndUpdate(x, y, z, blockId, plan.state)) {
      if (plan.extra) {
        const { dx, dy, dz, id, state } = plan.extra;
        this.world.setBlockAndUpdate(x + dx, y + dy, z + dz, id, state);
      }
      this.placeCooldown = PLACE_COOLDOWN;
      this.inventory.consume(blockId, 1);

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

  /** 玩家脚下或身体所在的那一格是不是传送门方块 */
  private playerInPortal(): boolean {
    const p = this.physics;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    if (this.world.getBlock(x, Math.floor(p.y + 0.2), z) === Block.NETHER_PORTAL) return true;
    return this.world.getBlock(x, Math.floor(p.y + 1), z) === Block.NETHER_PORTAL;
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

    // 本项目的"飞行"开关就是创造模式（见 `survivalEnvironment`），
    // 原版对创造/旁观玩家的 `getPortalWaitTime` 返回 1
    const wait = this.flying ? PORTAL_CREATIVE_IGNITE_TICKS : PORTAL_IGNITE_TICKS;
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
    this.pendingArrival = { ...target, axis, frames: 0 };
    this.setDimension(target.dimension, target);
  }

  /**
   * 目的地落地：区块加载完之后调用（每帧一次）。
   *
   * 优先找**已有的门**（16 格半径），找不到就照着目标点**新建一座 2×3 的门**。
   * 两者都不成（比如目标点整根柱子都是实心岩石）时就直接把人放在目标坐标上——
   * 宁可落在地形里，也不要让人卡在"传送中"出不来。
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
      this.physics.teleport(pending.x, pending.y, pending.z);
      this.portalCooldownTicks = PORTAL_COOLDOWN_TICKS;
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
   * 在世界刚加载出一片区域时，就近寻找一块高于海平面的陆地作为出生点，
   * 避免玩家出生在深海里。
   */
  private tryResolveSpawn(): void {
    if (this.spawnResolved) return;
    if (this.world.chunks.size < 9) return;

    for (let radius = 0; radius <= 96; radius += 4) {
      const candidates: Array<[number, number]> =
        radius === 0
          ? [[0, 0]]
          : [
              [radius, 0],
              [-radius, 0],
              [0, radius],
              [0, -radius],
              [radius, radius],
              [-radius, -radius],
              [radius, -radius],
              [-radius, radius],
            ];
      for (const [dx, dz] of candidates) {
        const ground = this.groundHeight(dx, dz);
        if (ground >= SEA_LEVEL + 1) {
          this.physics.teleport(dx + 0.5, ground + 1.2, dz + 0.5);
          this.spawnPoint = [dx + 0.5, ground + 1.2, dz + 0.5];
          this.lastPlayerX = dx + 0.5;
          this.lastPlayerZ = dz + 0.5;
          this.lastCenterCx = Number.NaN;
          this.lastCenterCz = Number.NaN;
          this.spawnResolved = true;
          return;
        }
      }
    }
  }

  /** 该列最高固体（跳过水）的 y 坐标 */
  private groundHeight(x: number, z: number): number {
    for (let y = 200; y >= 0; y--) {
      const id = this.world.getBlock(x, y, z);
      if (id !== 0 && id !== Block.WATER) return y;
    }
    return -999;
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

    return {
      eyeInWater: eye === Block.WATER,
      inLava: feet === Block.LAVA || body === Block.LAVA,
      // 站在火里（I12）：脚或身体所在格是火焰 → 被点燃 + 每秒掉血。
      // 批次 48 起也包含**点着的营火**（熄灭的不算）——它同样会烫脚
      inFire:
        feet === Block.FIRE ||
        body === Block.FIRE ||
        burnsOnContact(feet, this.world.getBlockState(feetX, feetY, feetZ)),
      // 仙人掌还没进方块表，先保持关闭（加了之后这里改成四邻检测）
      onCactus: false,
      suffocating: body !== Block.AIR && blockDef(body).opaque,
      fallDistance: this.pendingFallDistance,
      y: p.y,
      // 创造模式就是飞行状态（P1 的模式切换定义如此）
      creative: this.flying,
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
   * 死亡掉经验（I5）。
   *
   * 原版是掉一地经验球、可以跑回去捡；本项目还没有经验球实体，
   * 所以这里**只是清零**（`keepInventory` 打开时连经验一起保留，与原版一致）。
   * 这不是 bug，是"经验球"那一项还没做——见 TASKS I5 的待补说明。
   */
  private dropExperienceOnDeath(): void {
    if (this.rules.keepInventory) return;
    this.experience.reset();
  }

  private respawnPlayer(): void {
    const [sx, sy, sz] = this.spawnPoint;
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
   * 自适应视距（K6）。
   *
   * 手机长时间游玩会发热降频，帧率掉下去之后如果什么都不做，就只会越来越卡。
   * 这里用帧时间滑动平均做迟滞控制：
   *   平均帧时间 > 22ms（约 45fps）→ 降 1 区块，冷却 4 秒
   *   平均帧时间 < 17ms（约 59fps）→ 升 1 区块，冷却 8 秒（升比降保守，避免抖动）
   * 玩家设定的视距是上限：自适应只会往下调，不会超过玩家想要的范围。
   */
  private updateAdaptiveViewDistance(dt: number): void {
    // 平滑系数 0.05：约 20 帧的时间常数，半秒内的抖动会被抹平
    const frameTime = this.simulatedFrameTime > 0 ? this.simulatedFrameTime : dt * 1000;
    this.frameTimeAvg += (frameTime - this.frameTimeAvg) * 0.05;
    if (!this.settings.adaptiveViewDistance) return;

    this.adaptiveCooldown -= dt;
    if (this.adaptiveCooldown > 0) return;

    const max = this.settings.viewDistance;
    if (this.frameTimeAvg > 22 && this.viewDistance > 4) {
      this.setViewDistance(this.viewDistance - 1);
      this.adaptiveCooldown = 4;
      console.info(`[perf] 帧时间 ${this.frameTimeAvg.toFixed(1)}ms，视距降到 ${this.viewDistance}`);
    } else if (this.frameTimeAvg < 17 && this.viewDistance < max) {
      this.setViewDistance(this.viewDistance + 1);
      this.adaptiveCooldown = 8;
    }
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
    this.camera.far = distance * 16 + 32;
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

    const feetLight = this.world.getBlockLight(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z));
    const target = this.hit
      ? `${blockDef(this.world.getBlock(this.hit.x, this.hit.y, this.hit.z)).name.replace('minecraft:', '')} (${this.hit.x}, ${this.hit.y}, ${this.hit.z})${this.targetToolHint(this.world.getBlock(this.hit.x, this.hit.y, this.hit.z))}`
      : '无';

    const armorPoints = this.stats.armorPoints;

    // 手机上屏幕小：只保留最关键的几行，免得调试面板盖住半个屏幕
    if (this.touch) {
      this.debugEl.textContent =
        `${this.fps} fps   ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n` +
        `${this.flying ? '创造(飞行)' : '生存'}   ${clock}   ${DIMENSION_LABELS[this.dimension]}   朝向 ${facing.slice(0, 1)}\n` +
        `持有 ${this.heldName}${armorPoints > 0 ? `   护甲 ${armorPoints}` : ''}`;
      return;
    }

    this.debugEl.textContent =
      `Bedrock 1.18 Web  ·  P1 物理 + 方块交互\n` +
      `${this.fps} fps   ${this.chunkRenderer.triangles.toLocaleString()} 三角形\n` +
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}   区块: ${cx}, ${cz}\n` +
      `朝向: ${facing}   时间: ${clock}   难度: ${DIFFICULTY_LABELS[this.difficulty]}   模式: ${this.flying ? '创造(飞行)' : '生存'}   维度: ${DIMENSION_LABELS[this.dimension]}   视角: ${CAMERA_MODE_LABELS[this.cameraMode]}\n` +
      `在地面: ${p.onGround ? '是' : '否'}   在水中: ${p.inWater ? '是' : '否'}   脚下方块光: ${feetLight}\n` +
      `指向: ${target}${this.breakProgress > 0 ? `   破坏 ${Math.round(this.breakProgress * 100)}%` : ''}\n` +
      `持有: ${this.heldName}\n` +
      `视距: ${this.viewDistance}${this.settings.adaptiveViewDistance && this.viewDistance < this.settings.viewDistance ? `（自适应，上限 ${this.settings.viewDistance}）` : ''} 区块   已渲染: ${this.chunkRenderer.chunkMeshCount}   待网格化: ${this.chunkRenderer.queueLength}   在途: ${this.chunkRenderer.inFlightCount}   待生成: ${this.world.pendingCount}\n` +
      `生命: ${this.stats.health.toFixed(1)}/20   饥饿: ${this.stats.food}/20   饱和: ${this.stats.saturation.toFixed(1)}   氧气: ${this.stats.air}/300   疲劳: ${this.stats.exhaustion.toFixed(2)}   护甲: ${armorPoints}\n` +
      `经验: ${this.experience.level} 级 ${this.experience.progress}/${this.experience.toNext}（累计 ${this.experience.total}）\n` +
      `光照队列: ${this.world.lightWorkCount}   待重刷: ${this.pendingSettle.length / 3}\n` +
      `联机: ${this.netStatus}${this.net.selfId > 0 ? `（#${this.net.selfId} · 在线 ${this.net.playerCount} 人）` : ''}` +
      (this.chatLine && performance.now() < this.chatUntil ? `\n${this.chatLine}` : '');
  }

  start(): void {
    // 读档是异步的：先让世界跑起来（玩家看到创建中的世界），读完再恢复位置与背包
    if (this.save?.hasSave) {
      void this.loadSaveState().then((restored) => {
        if (restored) console.info('[save] 已恢复上次的进度');
      });
    }

    // 切后台/关页面前补一次保存：移动端切走随时可能被系统回收
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saveNow('hidden');
    });

    // 浏览器要求音频必须由用户手势解锁：第一次点击/按键时创建 AudioContext
    const unlockAudio = (): void => {
      this.audio.resume();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    const loop = () => {
      const now = performance.now();
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

      const survivalInput = this.uiOpen ? IDLE_INPUT : this.collectInput();
      const wasOnGround = this.physics.onGround;
      if (this.pendingArrival) {
        // 传送途中：目的地的区块还没流出来，`getBlock` 一律返回空气。
        // 这里把玩家"冻"在原地（速度清零、不跑物理），等 `resolvePortalArrival` 把人放进门里
        this.physics.vx = 0;
        this.physics.vy = 0;
        this.physics.vz = 0;
      } else {
        this.physics.update(this.world, survivalInput, this.yaw, dt, this.flying, this.effects.moveSpeedMultiplier(), this.effects.jumpMultiplier());
      }
      this.updateSurvival(dt, survivalInput, wasOnGround);
      this.resolvePortalArrival();

      this.updateCamera(dt);

      this.updateInteraction(dt);

      // 昼夜循环可以在设置里关掉（时间停在当前时刻，截图对比/搭建筑时有用）
      if (this.settings.daylightCycle) this.timeOfDay = (this.timeOfDay + dt / this.dayLengthSeconds) % 1;

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
      this.applyEnvironment();

      this.updateGamepad(dt);
      this.tickAutoSave(dt);
      this.updateAdaptiveViewDistance(dt);
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

      const lightBusy = this.world.processLighting(6000);

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

  dispose(): void {
    this.recipeBook.dispose();
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
  }

  // ---------------------------------------------------------------- 开发调试接口
  // 供开发/自动化验收使用：精确定位相机、设置时间，便于复现与截图对比。

  teleport(x: number, y: number, z: number): void {
    this.physics.teleport(x, y, z);
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
  }

  /** 是否正在挖掘（按住左键/长按屏幕且对着可破坏方块）——验收脚本用 */
  get isBreaking(): boolean {
    return this.breakProgress > 0 && this.breakingKey !== '';
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
    if (dimension === this.dimension) return;
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
    if (dimension === Dimension.END) this.spawnEndBoss();
    this.applyEnvironment();
    this.refreshWorld(toChunkCoord(this.physics.x), toChunkCoord(this.physics.z), true);
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

  /** 切换创造飞行（键盘 F、触摸按钮与调试入口共用） */
  setFlying(value: boolean): void {
    this.flying = value;
    // 触摸端的"飞"按钮需要跟着亮/灭
    this.touch?.setFlying(value);
  }

  selectSlot(index: number): void {
    if (index < 0 || index >= HOTBAR_SIZE) return;
    this.hotbarIndex = index;
    this.refreshHotbar();
  }

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

    this.entities.spawn(new Mob(type, x + 0.5, spawnY, z + 0.5));
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
    /** 手持物品 id（空手为 null，E15 验收用） */
    handItem: number | null;
    /** 当前的视野色罩（E16 验收用） */
    screenEffect: ScreenEffect;
    /** 配方书是否打开（验收用） */
    recipeBookOpen: boolean;
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
  } {
    return {
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
      handItem: this.hand.item ?? null,
      screenEffect: this.screenEffects.effect,
      recipeBookOpen: this.recipeBook.isOpen,
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
  } {
    return {
      open: this.settingsScreen.isOpen,
      settings: this.settingsScreen.snapshot(),
      viewDistance: this.viewDistance,
      fov: this.camera.fov,
      frameTimeAvg: Number(this.frameTimeAvg.toFixed(2)),
    };
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

const DAY_SKY = new THREE.Color(0x8fc7ff);
const NIGHT_SKY = new THREE.Color(0x040814);
/** 阴天：天空整体压成灰蓝 */
const OVERCAST_SKY = new THREE.Color(0x5d6773);
/** 闪电：瞬间的冷白 */
const FLASH_SKY = new THREE.Color(0xd8e6ff);
const WHITE_SKY = new THREE.Color(0xffffff);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

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
  const container = document.getElementById('app');
  const debugEl = document.getElementById('debug');
  const overlayEl = document.getElementById('overlay');
  const vitalsEl = document.getElementById('vitals');
  const deathEl = document.getElementById('death');
  if (!container || !debugEl || !overlayEl || !vitalsEl || !deathEl) throw new Error('缺少必要的 DOM 节点');

  const atlas = new TextureAtlas();
  const registry = new WorldRegistry();
  await adoptLegacyWorld(registry);

  const startWorld = async (world: WorldSummary): Promise<void> => {
    menu.hide();
    // 先开存档库再建世界：存档里有玩家位置与维度，世界要先知道该从哪生成
    // （打开失败会返回 null，游戏照常可玩，只是不保存）
    const save = await SaveGame.open(world.id);
    registry.update(world.id, { lastPlayed: Date.now() });
    const app = new App(container, debugEl, overlayEl, atlas, vitalsEl, deathEl, save, {
      id: world.id,
      name: world.name,
      seed: world.seed,
      worldType: world.worldType,
      difficulty: world.difficulty,
    });
    // 存档后把统计回写到世界清单，主菜单下次打开就是最新的
    app.onSaved = (info) => registry.update(world.id, { lastPlayed: Date.now(), ...info });
    app.onWorldDeleted = (id) => registry.remove(id);
    // 难度改了就回写世界清单（下次从主菜单进来还是这个难度）
    app.onDifficultyChanged = (value) => registry.update(world.id, { difficulty: value });
    app.start();
    // 开发调试入口：控制台或自动化脚本可通过 window.__mc 精确定位与取样
    (window as unknown as { __mc: App }).__mc = app;
  };

  /**
   * 主菜单里的设置面板。
   * 懒创建：直接复用同一个 `SettingsScreen`，只是不给它"回主菜单/删世界"两个按钮
   * （那两个动作只在游戏里有意义），改动只写 localStorage，进世界时会被读走。
   */
  let menuSettings: SettingsScreen | null = null;
  const openMenuSettings = (): void => {
    if (!menuSettings) {
      const settings = loadSettings();
      menuSettings = new SettingsScreen(document.body, settings, {
        onResume: () => menuSettings?.hide(),
        onChange: (next) => saveSettings(next),
      });
      menuSettings.setTitle('设置', 'Esc 或点面板外关闭；这些设置存在这台设备上，进世界后直接生效', '返回');
      menuSettings.setMeta('');
    }
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
  menu.show();
}

void boot();
