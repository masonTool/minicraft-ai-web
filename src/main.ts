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
import { MobSpawner, MOB_DESPAWN_DISTANCE, type SpawnContext } from './core/entity/MobSpawner.ts';
import { raycastEntities } from './core/interaction/EntityRaycast.ts';
import { VoxelMaterial } from './render/VoxelMaterial.ts';
import { BlockOutline } from './render/BlockOutline.ts';
import { World, toChunkCoord } from './core/world/World.ts';
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
const WORLD_SEED = 20261014;
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
  private readonly world = new World(WORLD_SEED);
  private readonly chunkRenderer: ChunkRenderer;
  private readonly meshPool: MeshWorkerPool;
  /** 生命 / 饥饿 / 氧气 */
  readonly stats = new PlayerStats();
  /** 当前维度（与 world.dimension 同步，供渲染与环境使用） */
  private dimension: DimensionId = Dimension.OVERWORLD;
  /** 下界的背景色（暗红雾） */
  private readonly netherBackground = new THREE.Color(NETHER_FOG);
  /** 末地的背景色（星空黑） */
  private readonly endBackground = new THREE.Color(END_SKY);
  private readonly vitalsHud: VitalsHud;
  /** 天空：渐变穹顶 / 太阳月亮 / 星空 / 云 */
  private readonly sky: Sky;
  /** 天气：晴 / 雨 / 雷暴 */
  private readonly weather: Weather;
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
  private readonly touch: TouchControls | null;
  /** 触摸端"轻点"产生的一次性放置/交互请求，由 updatePlacing 消费 */
  private touchPlaceRequest = false;
  /** 背包界面是否打开；打开时暂停移动、视角与方块交互 */
  private uiOpen = false;
  private readonly hotbarSlots: HTMLDivElement[] = [];

  /** 一天中的时刻 [0,1)：0 = 日出，0.25 = 正午，0.5 = 日落，0.75 = 午夜 */
  private timeOfDay = 0.12;
  /** 一个游戏日为 20 分钟（与原版一致） */
  private readonly dayLengthSeconds = 1200;

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
  ) {
    this.deathEl = deathEl;
    this.vitalsHud = new VitalsHud(vitalsEl);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.skyColor = new THREE.Color(0x8fc7ff);
    this.scene.background = this.skyColor;

    const fogFar = VIEW_DISTANCE * 16;
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
    // 生物亮度直接用方块材质的天光倍率，保证与地形明暗一致
    this.mobRenderer = new MobRenderer(this.scene, () => this.solidMaterial.skyBrightnessValue);
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

    // 开发期初始物资（见 STARTING_HOTBAR 注释）
    for (const blockId of STARTING_HOTBAR) this.inventory.add(blockId, 64);

    // 触摸操作层：只在手势设备上创建，桌面端完全不引入这套 DOM
    this.touch = isTouchDevice()
      ? new TouchControls(document.getElementById('hud') ?? container, {
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
          onToggleFly: () => this.setFlying(!this.flying),
          // 潜行状态由操作层自己维护并出现在 input 里，这里只做一次提示同步
          onToggleSneak: () => undefined,
        })
      : null;

    this.bindEvents();
    this.refreshWorld(0, 0, true);
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

  // ---------------------------------------------------------------- 环境

  /**
   * 把时间换算成天空亮度与天空颜色，推给材质与场景。
   * 因为光照等级是烘焙在顶点属性里的，这里每帧只改 uniform，开销可以忽略。
   */
  private applyEnvironment(): void {
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

    // 穹顶：顶部略深、地平线略亮；日出日落时给太阳附近加霞光
    this.domeTop.copy(this.skyColor).multiplyScalar(0.86);
    this.domeHorizon.copy(this.skyColor).lerp(WHITE_SKY, 0.32);
    this.sky.setDomeColors(this.domeTop, this.domeHorizon);
    this.sky.setSunGlow(Math.max(0, 1 - Math.abs(sunHeight) * 3.2) * (1 - overcast) * 0.9);
    this.sky.setCloudAppearance(daylight, overcast);

    const fogFar = (VIEW_DISTANCE * 16 - 6) * (1 - overcast * 0.45);
    const fogNear = fogFar * 0.72;
    this.solidMaterial.setFog(this.skyColor, fogNear, fogFar);
    this.translucentMaterial.setFog(this.skyColor, fogNear, fogFar);
  }

  private refreshWorld(centerCx: number, centerCz: number, force = false): void {
    if (!force && centerCx === this.lastCenterCx && centerCz === this.lastCenterCz) return;
    this.lastCenterCx = centerCx;
    this.lastCenterCz = centerCz;
    this.world.update(centerCx, centerCz, VIEW_DISTANCE);
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
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyE') {
        e.preventDefault();
        this.inventoryScreen.toggle();
        return;
      }
      if (this.uiOpen) return;
      if (e.code === 'KeyF') this.setFlying(!this.flying);
      // N：在主世界与下界之间切换（临时的维度入口；下界传送门要等火焰方块与打火石做完）
      if (e.code === 'KeyN') this.toggleDimension();
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
    // 键盘与触摸取"较大者"而不是相加：外接键盘时同时用也不会速度翻倍
    const touch = this.touch?.input;

    let forward = 0;
    let strafe = 0;
    if (this.keys.has('KeyW')) forward += 1;
    if (this.keys.has('KeyS')) forward -= 1;
    if (this.keys.has('KeyD')) strafe += 1;
    if (this.keys.has('KeyA')) strafe -= 1;

    const keyboardSprint = this.keys.has('ControlLeft') || this.keys.has('ControlRight');

    return {
      forward: Math.max(-1, Math.min(1, forward + (touch?.forward ?? 0))),
      strafe: Math.max(-1, Math.min(1, strafe + (touch?.strafe ?? 0))),
      jump: this.keys.has('Space') || (touch?.jump ?? false),
      sneak: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (touch?.sneak ?? false),
      sprint: keyboardSprint || (touch?.sprint ?? false),
    };
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
  }

  private updateBreaking(dt: number): void {
    if (this.suppressBreaking) {
      this.breakingKey = '';
      this.breakProgress = 0;
      return;
    }
    if (!this.leftDown || !this.hit || this.breakCooldown > 0) {
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
  }

  /** 拆掉整扇门（上下两半一起），整扇只掉落一次 */
  private breakDoorPair(x: number, y: number, z: number): void {
    const state = this.world.getBlockState(x, y, z);
    const baseY = isDoorUpper(state) ? y - 1 : y;

    for (let dy = 0; dy < 2; dy++) {
      const oy = baseY + dy;
      if (this.world.getBlock(x, oy, z) !== Block.OAK_DOOR) continue;
      this.world.setBlockAndUpdate(x, oy, z, Block.AIR);
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
    this.mobRenderer.update(mobs, this.camera, dt, sampleLight);
    this.updateMobSpawning(dt);
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
    if ((!this.rightDown && !tapped) || !this.hit || this.placeCooldown > 0) return;

    // 右键功能方块：潜行时仍然走放置逻辑（与原版一致）
    const sneak = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (!sneak) {
      const hitBlock = this.world.getBlock(this.hit.x, this.hit.y, this.hit.z);
      const { x, y, z } = this.hit;

      if (hitBlock === Block.OAK_DOOR) {
        this.toggleDoor(x, y, z);
        this.placeCooldown = PLACE_COOLDOWN * 2;
        return;
      }
      if (hitBlock === Block.CRAFTING_TABLE) {
        this.inventoryScreen.openWith('crafting');
        this.placeCooldown = PLACE_COOLDOWN * 2;
        return;
      }
      if (hitBlock === Block.FURNACE) {
        this.inventoryScreen.openWith('furnace', this.world.containers.getOrCreateFurnace(x, y, z));
        this.placeCooldown = PLACE_COOLDOWN * 2;
        return;
      }
      if (hitBlock === Block.CHEST) {
        this.inventoryScreen.openWith('chest', this.world.containers.getOrCreateChest(x, y, z));
        this.placeCooldown = PLACE_COOLDOWN * 2;
        return;
      }
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
      `朝向: ${facing}   时间: ${clock}   模式: ${this.flying ? '创造(飞行)' : '生存'}   维度: ${DIMENSION_LABELS[this.dimension]}\n` +
      `在地面: ${p.onGround ? '是' : '否'}   在水中: ${p.inWater ? '是' : '否'}   脚下方块光: ${feetLight}\n` +
      `指向: ${target}${this.breakProgress > 0 ? `   破坏 ${Math.round(this.breakProgress * 100)}%` : ''}\n` +
      `持有: ${this.heldName}\n` +
      `视距: ${VIEW_DISTANCE} 区块   已渲染: ${this.chunkRenderer.chunkMeshCount}   待网格化: ${this.chunkRenderer.queueLength}   在途: ${this.chunkRenderer.inFlightCount}   待生成: ${this.world.pendingCount}\n` +
      `生命: ${this.stats.health.toFixed(1)}/20   饥饿: ${this.stats.food}/20   饱和: ${this.stats.saturation.toFixed(1)}   氧气: ${this.stats.air}/300   疲劳: ${this.stats.exhaustion.toFixed(2)}\n` +
      `光照队列: ${this.world.lightWorkCount}   待重刷: ${this.pendingSettle.length / 3}`;
  }

  start(): void {
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

      this.camera.position.set(this.physics.x, this.physics.eyeY, this.physics.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0);

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
      this.inventoryScreen.tickUi(dt);

      this.refreshLoadingState();
      this.updateBreakProgressUi();
      this.renderer.render(this.scene, this.camera);
      this.updateDebug(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  dispose(): void {
    this.mobRenderer.dispose();
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
    // 落点：下界在洞窟上方、末地在主岛上方（岛面在 y≈66），主世界回高空
    const landingY = dimension === Dimension.NETHER ? 96 : dimension === Dimension.END ? 96 : 140;
    this.physics.teleport(this.physics.x, landingY, this.physics.z);
    this.lastCenterCx = Number.NaN;
    this.lastCenterCz = Number.NaN;
    this.weather.setKind('clear');
    this.applyEnvironment();
    this.refreshWorld(toChunkCoord(this.physics.x), toChunkCoord(this.physics.z), true);
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
  } {
    return {
      dimension: this.dimension,
      skyVisible: this.sky.object.visible,
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

  /** 直接放置方块（自动化测试用）；可带状态 */
  place(x: number, y: number, z: number, blockId: number, state = 0): boolean {
    return this.world.setBlockAndUpdate(x, y, z, blockId, state);
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

function boot(): void {
  const container = document.getElementById('app');
  const debugEl = document.getElementById('debug');
  const overlayEl = document.getElementById('overlay');
  const vitalsEl = document.getElementById('vitals');
  const deathEl = document.getElementById('death');
  if (!container || !debugEl || !overlayEl || !vitalsEl || !deathEl) throw new Error('缺少必要的 DOM 节点');

  const atlas = new TextureAtlas();
  const app = new App(container, debugEl, overlayEl, atlas, vitalsEl, deathEl);
  app.start();

  // 开发调试入口：控制台或自动化脚本可通过 window.__mc 精确定位与取样
  (window as unknown as { __mc: App }).__mc = app;
}

boot();
