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
import { PlayerStats, type DamageCause, type SurvivalEnvironment } from './core/survival/PlayerStats.ts';
import { VitalsHud } from './ui/VitalsHud.ts';
import { Sky } from './render/Sky.ts';
import { Weather, type WeatherKind } from './render/Weather.ts';
import { MobRenderer } from './render/MobRenderer.ts';
import { Mob } from './core/entity/Mob.ts';
import { mobTypeById } from './core/entity/mobs.ts';
import { DRAGON_CRUISE_Y, DRAGON_TYPE, Dragon, EndCrystal } from './core/entity/EndBoss.ts';
import { endPillarTops } from './core/gen/EndGenerator.ts';
import { RedstoneEngine, wirePowerOf, type RedstoneWorld } from './core/redstone/RedstoneEngine.ts';
import { GamepadInput } from './ui/GamepadInput.ts';
import { SettingsScreen, loadSettings, saveSettings, type GameSettings } from './ui/SettingsScreen.ts';
import { WorldScreen } from './ui/WorldScreen.ts';
import { LEGACY_WORLD_ID, WorldRegistry, type WorldSummary } from './core/save/WorldRegistry.ts';
import type { WorldType } from './core/gen/WorldType.ts';
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
import { NetClient, defaultServerUrl } from './net/NetClient.ts';
import { REMOTE_PLAYER_TYPE } from './core/entity/mobs.ts';
import type { NetPlayerState } from './net/NetClient.ts';
import { delayOf, withDelay } from './core/registry/blockState.ts';
import { MobSpawner, MOB_DESPAWN_DISTANCE, type SpawnContext } from './core/entity/MobSpawner.ts';
import { raycastEntities } from './core/interaction/EntityRaycast.ts';
import { VoxelMaterial } from './render/VoxelMaterial.ts';
import { BlockOutline } from './render/BlockOutline.ts';
import { ParticleSystem } from './render/ParticleSystem.ts';
import { HandRenderer } from './render/HandRenderer.ts';
import { PlayerRenderer } from './render/PlayerRenderer.ts';
import { ScreenEffects, type ScreenEffect } from './render/ScreenEffects.ts';
import { World, toChunkCoord } from './core/world/World.ts';
import { Chunk } from './core/world/Chunk.ts';
import { DIMENSION_CYCLE, DIMENSION_LABELS, Dimension, type DimensionId } from './core/gen/Dimension.ts';
import { Block, BLOCKS, breakSeconds, blockDef } from './core/registry/blocks.ts';
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
import { HOTBAR_SIZE, Inventory } from './core/container/Inventory.ts';
import { CHEST_SIZE } from './core/container/Chest.ts';
import { FURNACE_SIZE, Furnace } from './core/container/Furnace.ts';
import { EntityManager } from './core/entity/EntityManager.ts';
import { ItemEntity } from './core/entity/ItemEntity.ts';
import type { EntityContext } from './core/entity/Entity.ts';
import { EntityRenderer } from './render/EntityRenderer.ts';
import { InventoryScreen } from './ui/InventoryScreen.ts';
import { TouchControls, bindHotbarTouch, isTouchDevice } from './ui/TouchControls.ts';
import { drawItemIcon } from './ui/ItemIcon.ts';
import { blockForItem, dropFor, itemName } from './core/registry/items.ts';

/** 渲染距离（区块） */
/** 视距默认值（玩家可在设置里改，见 `App.viewDistance`） */
const VIEW_DISTANCE = 12;
/** 每帧最多网格化的区块数，用于把加载耗时摊到多帧 */
const MESH_BUDGET_PER_FRAME = 3;

/** 游戏逻辑 tick（原版 20 次/秒），生存机制按这个节奏结算 */
const TICK_SECONDS = 0.05;
/** 死亡后自动重生的等待时间（秒） */
const RESPAWN_DELAY = 3;

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
  };
  /** 末影龙血条（触摸端也共用；元素不存在时为 null） */
  private bossBarEl: HTMLElement | null = null;
  private bossFillEl: HTMLElement | null = null;
  /** 下界的背景色（暗红雾） */
  private readonly netherBackground = new THREE.Color(NETHER_FOG);
  /** 末地的背景色（星空黑） */
  private readonly endBackground = new THREE.Color(END_SKY);
  private readonly vitalsHud: VitalsHud;
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
      console.info(`[chat] <${name}> ${text}`);
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
    },
  ) {
    this.world = new World(this.worldConfig.seed, this.worldConfig.worldType);
    this.deathEl = deathEl;
    this.vitalsHud = new VitalsHud(vitalsEl);
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

    this.world.events = {
      onChunkLoaded: (chunk) => {
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
    this.inventoryScreen = new InventoryScreen(atlas, this.inventory, {
      onOpenChange: (open) => this.handleInventoryOpen(open),
    });
    this.inventory.onChange = () => {
      this.refreshHotbar();
      this.inventoryScreen.refresh();
    };

    // 设置 / 暂停菜单（K3）：应用后立即生效，不必重开局
    this.viewDistance = this.settings.viewDistance;
    this.audio.volume = this.settings.volume;
    this.lastStepX = this.physics.x;
    this.lastStepZ = this.physics.z;
    this.settingsScreen = new SettingsScreen(container, this.settings, {
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
      if (this.world.isLoaded(x, z)) this.world.setBlockAndUpdate(x, y, z, id, state ?? 0);
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
    void dimension;
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

    this.solidMaterial.skyBrightness = skyBrightness;
    this.translucentMaterial.skyBrightness = skyBrightness;
    // 掉落物的天光贡献跟着昼夜变化（逐实体采样在 updateEntities 里做）
    this.entityRenderer.skyBrightness = skyBrightness;
    this.syncRenderBrightness(skyBrightness);

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
    const effect = this.eyeMedium();
    this.screenEffects.set(effect);

    if (effect === 'water') {
      this.solidMaterial.setFog(WATER_FOG, WATER_FOG_NEAR, WATER_FOG_FAR);
      this.translucentMaterial.setFog(WATER_FOG, WATER_FOG_NEAR, WATER_FOG_FAR);
    } else if (effect === 'lava') {
      this.solidMaterial.setFog(LAVA_FOG, LAVA_FOG_NEAR, LAVA_FOG_FAR);
      this.translucentMaterial.setFog(LAVA_FOG, LAVA_FOG_NEAR, LAVA_FOG_FAR);
    }
  }

  /** 玩家眼睛泡在什么介质里（决定色罩与雾） */
  private eyeMedium(): ScreenEffect {
    const p = this.physics;
    const eye = this.world.getBlock(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    if (eye === Block.WATER) return 'water';
    if (eye === Block.LAVA) return 'lava';
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
      if (feet === Block.LAVA || this.eyeMedium() === 'lava') {
        this.particles.spawnFlame(
          p.x + (Math.random() - 0.5) * 0.6,
          p.y + 0.5 + Math.random() * 0.7,
          p.z + (Math.random() - 0.5) * 0.6,
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

      container.appendChild(slot);
      this.hotbarSlots.push(slot);
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

      if (stack) {
        drawItemIcon(icon, this.atlas, stack.id, 32);
        icon.style.visibility = 'visible';
        count.textContent = stack.count > 1 ? String(stack.count) : '';
        slot.title = itemName(stack.id);
      } else {
        icon.style.visibility = 'hidden';
        count.textContent = '';
        slot.title = '';
      }
      slot.classList.toggle('active', index === this.hotbarIndex);
    }
  }

  /** 当前手持方块；手上不是可放置物品时返回 undefined */
  private get selectedBlock(): number | undefined {
    const stack = this.inventory.get(this.hotbarIndex);
    if (!stack) return undefined;
    return blockForItem(stack.id);
  }

  private get heldName(): string {
    const stack = this.inventory.get(this.hotbarIndex);
    return stack ? `${itemName(stack.id)} ×${stack.count}` : '空';
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
        this.applyLook(e.movementX * MOUSE_SENSITIVITY, e.movementY * MOUSE_SENSITIVITY);
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
    this.pitch -= dyPixels;
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
    this.playerRenderer.setVisible(thirdPerson);
    this.hand.setVisible(!thirdPerson);
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

  private updateInteraction(dt: number): void {
    if (this.uiOpen) {
      this.hit = null;
      this.outline.hide();
      return;
    }

    const [dx, dy, dz] = PlayerPhysics.lookDirection(this.yaw, this.pitch);
    this.hit = raycastVoxels(
      (x, y, z) => this.world.isSelectable(x, y, z),
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
      this.outline.show(
        id,
        this.world.getBlockState(this.hit.x, this.hit.y, this.hit.z),
        blockDef(id).shape,
        this.hit.x,
        this.hit.y,
        this.hit.z,
      );
    } else {
      this.outline.hide();
    }

    this.breakCooldown = Math.max(0, this.breakCooldown - dt);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);

    this.updateAttacking(dt);
    this.updateBreaking(dt);
    this.updatePlacing();
  }

  /**
   * 近战攻击：左键按下时先看准星有没有对着生物。
   * 生物比方块更靠前就优先攻击，并且这一帧不再破坏方块。
   */
  private updateAttacking(dt: number): void {
    this.suppressBreaking = false;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (!this.leftDown || this.uiOpen || this.attackCooldown > 0) return;

    const context = this.lastEntityContext;
    if (!context) return;

    const cosPitch = Math.cos(this.pitch);
    const dirX = -Math.sin(this.yaw) * cosPitch;
    const dirY = Math.sin(this.pitch);
    const dirZ = -Math.cos(this.yaw) * cosPitch;

    const hit = raycastEntities(
      this.entities.all,
      this.physics.x,
      this.physics.eyeY,
      this.physics.z,
      dirX,
      dirY,
      dirZ,
      ATTACK_RANGE,
    );
    if (!hit || !(hit.entity instanceof Mob)) return;
    // 方块比生物更近，说明玩家其实在挖方块
    if (this.hit && this.hit.distance < hit.distance) return;

    this.attackCooldown = ATTACK_COOLDOWN;
    this.suppressBreaking = true;
    this.breakProgress = 0;
    this.breakingKey = '';

    const mob = hit.entity;
    // 下落中攻击算暴击（原版 ×1.5）；创造模式一击必杀
    const critical = !this.physics.onGround && this.physics.vy < -0.1;
    const damage = this.flying ? 100 : critical ? 1.5 : 1;
    mob.hurt(damage, mob.x - this.physics.x, mob.z - this.physics.z, context);
    this.hand.swing();
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
    const required = this.flying ? 0 : breakSeconds(id);
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

    // 门是两格高的整体：拆一半就把另一半一起带走（且整扇门只掉落一次）
    if (brokenId === Block.OAK_DOOR) {
      this.breakDoorPair(this.hit.x, this.hit.y, this.hit.z);
      this.breakProgress = 0;
      this.breakingKey = '';
      this.breakCooldown = BREAK_COOLDOWN;
      return;
    }

    this.dropContainerContents(this.hit.x, this.hit.y, this.hit.z);
    this.world.setBlockAndUpdate(this.hit.x, this.hit.y, this.hit.z, Block.AIR);
    this.particles.spawnBlockBreak(
      this.hit.x + 0.5,
      this.hit.y + 0.5,
      this.hit.z + 0.5,
      this.blockParticleColor(brokenId),
    );

    // 创造模式不产生掉落（与原版一致）
    if (!this.flying) {
      const drop = dropFor(brokenId);
      if (drop) {
        // 双层台阶是两块叠起来的，破坏时按 2 个掉落
        const count = isSlabDouble(brokenState) ? drop.count * 2 : drop.count;
        this.spawnDrop(drop.id, count, this.hit.x + 0.5, this.hit.y + 0.5, this.hit.z + 0.5);
      }
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

  /** 开门/关门：上下两半必须同步切换，否则会出现"半扇门" */
  private toggleDoor(x: number, y: number, z: number): void {
    const state = this.world.getBlockState(x, y, z);
    const baseY = isDoorUpper(state) ? y - 1 : y;
    if (this.world.getBlock(x, baseY, z) !== Block.OAK_DOOR) return;
    if (this.world.getBlock(x, baseY + 1, z) !== Block.OAK_DOOR) return;

    const baseState = this.world.getBlockState(x, baseY, z);
    const next = withDoorOpen(baseState, !isDoorOpen(baseState));
    this.world.setBlockAndUpdate(x, baseY, z, Block.OAK_DOOR, next);
    this.world.setBlockAndUpdate(x, baseY + 1, z, Block.OAK_DOOR, withDoorUpper(next, true));
    this.audio.play('door', { x: x + 0.5, y: baseY + 0.5, z: z + 0.5 });
  }

  /** 拆掉整扇门（上下两半一起），整扇只掉落一次 */
  private breakDoorPair(x: number, y: number, z: number): void {
    const state = this.world.getBlockState(x, y, z);
    const baseY = isDoorUpper(state) ? y - 1 : y;

    for (let dy = 0; dy < 2; dy++) {
      const oy = baseY + dy;
      if (this.world.getBlock(x, oy, z) !== Block.OAK_DOOR) continue;
      this.world.setBlockAndUpdate(x, oy, z, Block.AIR);
      this.net.sendBlock(x, oy, z, Block.AIR, 0, this.dimension);
      this.particles.spawnBlockBreak(x + 0.5, oy + 0.5, z + 0.5, this.blockParticleColor(Block.OAK_DOOR));
      if (this.flying || dy !== 0) continue;
      const drop = dropFor(Block.OAK_DOOR);
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

    const ctx: SpawnContext = {
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      // 天光要按昼夜折算：我们的光照引擎里地表天光恒为 15，
      // 不折算的话夜晚地表永远刷不出怪（原版夜里是会刷的）
      getSkyLight: (x, y, z) => this.world.getSkyLight(x, y, z) * this.solidMaterial.skyBrightnessValue,
      getBlockLight: (x, y, z) => this.world.getBlockLight(x, y, z),
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
  private damagePlayer(amount: number, sourceX: number, sourceZ: number): void {
    // 触觉反馈：受击用"双短震"区分于放方块的轻震
    if (amount > 0) this.vibrate([18, 40, 18]);
    if (amount > 0) this.audio.play(this.stats.health <= 0 ? 'death' : 'hurt');
    if (this.flying) return;
    const result = this.stats.damage(amount, 'generic');
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

  /** 推进所有实体并同步到渲染层 */
  private updateEntities(dt: number): void {
    const context: EntityContext = {
      world: this.world,
      playerBox: this.physics.box(),
      pickup: (itemId, count) => this.inventory.add(itemId, count),
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      player: { x: this.physics.x, y: this.physics.y, z: this.physics.z },
      hurtPlayer: (amount, sourceX, sourceZ) => this.damagePlayer(amount, sourceX, sourceZ),
      spawnDrop: (itemId, count, x, y, z) => this.spawnDrop(itemId, count, x, y, z),
    };
    this.lastEntityContext = context;
    this.entities.update(context, dt);
    // 逐实体采样光照：洞里暗、火把旁亮
    const sampleLight = (x: number, y: number, z: number): { sky: number; block: number } | null => {
      if (!this.world.isLoaded(x, z)) return null;
      return { sky: this.world.getSkyLight(x, y, z), block: this.world.getBlockLight(x, y, z) };
    };
    this.entityRenderer.update(this.entities.all, this.camera, dt, sampleLight);

    const mobs: Mob[] = [];
    for (const entity of this.entities.all) {
      if (entity instanceof Mob) mobs.push(entity);
    }
    // 联机队友也交给同一个渲染器（只是不进 EntityManager，不跑 AI 与物理）
    for (const mob of this.remotePlayers.values()) mobs.push(mob);
    this.mobRenderer.update(mobs, this.camera, dt, sampleLight);
    this.updateEndBoss();
    this.updateMobSpawning(dt);
    // 红石：按钮回弹、中继器延迟、压力板轮询都由它推进
    this.redstone.tick(this.redstoneWorld, Math.min(dt, 0.1));
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

    if (hitBlock === Block.OAK_DOOR) {
      this.toggleDoor(x, y, z);
      return true;
    }
    if (hitBlock === Block.CRAFTING_TABLE) {
      this.inventoryScreen.openWith('crafting');
      return true;
    }
    if (hitBlock === Block.FURNACE) {
      this.inventoryScreen.openWith('furnace', this.world.containers.getOrCreateFurnace(x, y, z));
      return true;
    }
    if (hitBlock === Block.CHEST) {
      this.inventoryScreen.openWith('chest', this.world.containers.getOrCreateChest(x, y, z));
      return true;
    }

    // ---- 红石元件：拉杆开关、按钮按下
    if (hitBlock === Block.LEVER) return this.redstone.toggleLever(this.redstoneWorld, x, y, z);
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
      this.applyLook(pad.lookDx * 0.0035, pad.lookDy * 0.0035);
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
   * 破坏容器方块时把内容物倒出来（原地生成掉落物）。
   */
  private dropContainerContents(x: number, y: number, z: number): void {
    const container = this.world.containers.get(x, y, z);
    if (!container) return;
    const size = container instanceof Furnace ? FURNACE_SIZE : CHEST_SIZE;
    for (let i = 0; i < size; i++) {
      const stack = container.get(i);
      if (!stack) continue;
      this.spawnDrop(stack.id, stack.count, x + 0.5, y + 0.5, z + 0.5);
      container.set(i, null);
    }
    this.world.containers.remove(x, y, z);
  }

  /**
   * 推进附近的熔炉。
   * 只 tick 玩家周围 64 格内的熔炉，避免容器多了以后每帧全量遍历。
   */
  private tickContainers(dt: number): void {
    const { x: px, y: py, z: pz } = this.physics;
    const rangeSq = 64 * 64;
    this.world.containers.forEach((container, x, y, z) => {
      if (!(container instanceof Furnace)) return;
      const dx = x + 0.5 - px;
      const dy = y + 0.5 - py;
      const dz = z + 0.5 - pz;
      if (dx * dx + dy * dy + dz * dz > rangeSq) return;
      container.tick(dt);
    });
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

  private updatePlacing(): void {
    // 触摸端是"一次性轻点"，鼠标是"按住不放"，这里统一成一个待执行标记
    const tapped = this.touchPlaceRequest;
    if ((!this.rightDown && !tapped && !this.padUse) || !this.hit || this.placeCooldown > 0) return;

    // 右键功能方块：潜行时仍然走放置逻辑（与原版一致）
    const sneak = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (!sneak && this.useFunctionalBlock(this.hit.x, this.hit.y, this.hit.z)) {
      this.placeCooldown = PLACE_COOLDOWN * 2;
      return;
    }

    // 触摸端只有一次轻点，放完就要清掉，否则会一直放
    this.touchPlaceRequest = false;

    const blockId = this.selectedBlock;
    if (blockId === undefined) return;

    const x = this.hit.x + this.hit.nx;
    const y = this.hit.y + this.hit.ny;
    const z = this.hit.z + this.hit.nz;

    const existing = this.world.getBlock(x, y, z);
    if (existing !== Block.AIR && !blockDef(existing).liquid) return;
    if (this.physics.blockIntersects(x, y, z)) return;

    // 按方块形状与命中面推导状态（台阶上下半、楼梯朝向、火把挂墙、门轴……）
    const plan = planPlacement({
      blockId,
      normal: [this.hit.nx, this.hit.ny, this.hit.nz],
      hitX: this.hit.hitX,
      hitY: this.hit.hitY,
      hitZ: this.hit.hitZ,
      yaw: this.yaw,
      sneaking: sneak,
      blockAt: (dx, dy, dz) => this.world.getBlock(x + dx, y + dy, z + dz),
      hitBlock: this.world.getBlock(this.hit.x, this.hit.y, this.hit.z),
      hitState: this.world.getBlockState(this.hit.x, this.hit.y, this.hit.z),
    });
    if (!plan) return;

    // 台阶叠成双层：改的是**命中方块自身**，不是命中面外侧那一格
    if (plan.mergeInto) {
      const { x: hx, y: hy, z: hz } = this.hit;
      if (this.world.setBlockAndUpdate(hx, hy, hz, blockId, plan.mergeInto.state)) {
        this.placeCooldown = PLACE_COOLDOWN;
        this.inventory.consume(blockId, 1);
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
      // 触觉反馈：放下一块方块的轻震
      this.vibrate(6);
      this.audio.play('place', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
      this.hand.swing();
      // 联机：把这次改动广播给队友
      this.net.sendBlock(x, y, z, blockId, plan.state, this.dimension);
      if (plan.extra) {
        const { dx, dy, dz, id, state } = plan.extra;
        this.net.sendBlock(x + dx, y + dy, z + dz, id, state, this.dimension);
      }
    }
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
    if (this.flying || p.inWater) {
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
      this.stats.tick(this.survivalEnvironment());
      // 摔落伤害只结算一次，避免同一帧的多个 tick 重复扣血
      this.pendingFallDistance = 0;
    }

    this.vitalsHud.update(this.stats);

    // ---- 死亡与重生
    if (this.stats.dead) {
      this.deathEl.classList.remove('hidden');
      this.respawnCountdown += dt;
      if (this.respawnCountdown >= RESPAWN_DELAY) this.respawnPlayer();
    } else if (this.respawnCountdown !== 0) {
      this.respawnCountdown = 0;
      this.deathEl.classList.add('hidden');
    }
  }

  /** 采集一帧的环境快照（水 / 岩浆 / 窒息 / 虚空） */
  private survivalEnvironment(): SurvivalEnvironment {
    const p = this.physics;
    const eye = this.world.getBlock(Math.floor(p.x), Math.floor(p.eyeY), Math.floor(p.z));
    const feet = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.15), Math.floor(p.z));
    const body = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 1.0), Math.floor(p.z));

    return {
      eyeInWater: eye === Block.WATER,
      inLava: feet === Block.LAVA || body === Block.LAVA,
      // 仙人掌还没进方块表，先保持关闭（加了之后这里改成四邻检测）
      onCactus: false,
      suffocating: body !== Block.AIR && blockDef(body).opaque,
      fallDistance: this.pendingFallDistance,
      y: p.y,
      // 创造模式就是飞行状态（P1 的模式切换定义如此）
      creative: this.flying,
    };
  }

  private respawnPlayer(): void {
    const [sx, sy, sz] = this.spawnPoint;
    this.physics.teleport(sx, sy, sz);
    this.physics.vx = 0;
    this.physics.vy = 0;
    this.physics.vz = 0;
    this.stats.respawn();
    this.fallStartY = null;
    this.pendingFallDistance = 0;
    this.respawnCountdown = 0;
    this.lastPlayerX = sx;
    this.lastPlayerZ = sz;
    this.deathEl.classList.add('hidden');
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
      ? `${blockDef(this.world.getBlock(this.hit.x, this.hit.y, this.hit.z)).name.replace('minecraft:', '')} (${this.hit.x}, ${this.hit.y}, ${this.hit.z})`
      : '无';

    // 手机上屏幕小：只保留最关键的几行，免得调试面板盖住半个屏幕
    if (this.touch) {
      this.debugEl.textContent =
        `${this.fps} fps   ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n` +
        `${this.flying ? '创造(飞行)' : '生存'}   ${clock}   ${DIMENSION_LABELS[this.dimension]}   朝向 ${facing.slice(0, 1)}\n` +
        `持有 ${this.heldName}`;
      return;
    }

    this.debugEl.textContent =
      `Bedrock 1.18 Web  ·  P1 物理 + 方块交互\n` +
      `${this.fps} fps   ${this.chunkRenderer.triangles.toLocaleString()} 三角形\n` +
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}   区块: ${cx}, ${cz}\n` +
      `朝向: ${facing}   时间: ${clock}   模式: ${this.flying ? '创造(飞行)' : '生存'}   维度: ${DIMENSION_LABELS[this.dimension]}   视角: ${CAMERA_MODE_LABELS[this.cameraMode]}\n` +
      `在地面: ${p.onGround ? '是' : '否'}   在水中: ${p.inWater ? '是' : '否'}   脚下方块光: ${feetLight}\n` +
      `指向: ${target}${this.breakProgress > 0 ? `   破坏 ${Math.round(this.breakProgress * 100)}%` : ''}\n` +
      `持有: ${this.heldName}\n` +
      `视距: ${this.viewDistance}${this.settings.adaptiveViewDistance && this.viewDistance < this.settings.viewDistance ? `（自适应，上限 ${this.settings.viewDistance}）` : ''} 区块   已渲染: ${this.chunkRenderer.chunkMeshCount}   待网格化: ${this.chunkRenderer.queueLength}   在途: ${this.chunkRenderer.inFlightCount}   待生成: ${this.world.pendingCount}\n` +
      `生命: ${this.stats.health.toFixed(1)}/20   饥饿: ${this.stats.food}/20   饱和: ${this.stats.saturation.toFixed(1)}   氧气: ${this.stats.air}/300   疲劳: ${this.stats.exhaustion.toFixed(2)}\n` +
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
            this.applyLook(look.x * TOUCH_SENSITIVITY, look.y * TOUCH_SENSITIVITY);
          }
        } else {
          this.touch.consumeLook();
        }
      }

      const survivalInput = this.uiOpen ? IDLE_INPUT : this.collectInput();
      const wasOnGround = this.physics.onGround;
      this.physics.update(this.world, survivalInput, this.yaw, dt, this.flying);
      this.updateSurvival(dt, survivalInput, wasOnGround);

      this.updateCamera(dt);

      this.updateInteraction(dt);

      this.timeOfDay = (this.timeOfDay + dt / this.dayLengthSeconds) % 1;

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
    this.spawnResolved = true;
    this.teleport(x, y, z);
  }

  /**
   * 切换维度。
   *
   * ⚠️ 切换后玩家脚下是空的：区块要重新生成，因此先把玩家抬到该维度的"空中高度"
   * 让物理自己落下，避免卡在地形里或掉进虚空。
   */
  setDimension(dimension: DimensionId): void {
    if (dimension === this.dimension) return;
    this.dimension = dimension;
    this.world.setDimension(dimension);
    // 掉落物实体属于旧维度，直接清掉
    this.entities.clear();
    this.particles.clear();
    // 落点：下界在洞窟上方、末地在主岛上方（岛面在 y≈66），主世界回高空
    const landingY = dimension === Dimension.NETHER ? 96 : dimension === Dimension.END ? 96 : 140;
    this.physics.teleport(this.physics.x, landingY, this.physics.z);
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
    dead: boolean;
    invulnerable: boolean;
    totalDamage: number;
  } {
    return {
      health: this.stats.health,
      food: this.stats.food,
      saturation: this.stats.saturation,
      air: this.stats.air,
      dead: this.stats.dead,
      invulnerable: this.stats.invulnerable,
      totalDamage: this.stats.totalDamage,
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
    return this.world.setBlockAndUpdate(x, y, z, blockId, state);
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
    });
    // 存档后把统计回写到世界清单，主菜单下次打开就是最新的
    app.onSaved = (info) => registry.update(world.id, { lastPlayed: Date.now(), ...info });
    app.onWorldDeleted = (id) => registry.remove(id);
    app.start();
    // 开发调试入口：控制台或自动化脚本可通过 window.__mc 精确定位与取样
    (window as unknown as { __mc: App }).__mc = app;
  };

  const menu = new WorldScreen(document.body, registry, {
    onEnter: (world) => void startWorld(world),
    onDelete: (world) => void deleteWorld(world),
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
