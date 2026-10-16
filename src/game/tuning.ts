/**
 * 调参常量与纯工具（**批次 101** 从 `src/main.ts` 里搬出来的）
 *
 * 为什么单独一份：`main.ts` 原来 8359 行，其中 `class App` 一个类占 7600 行，
 * 剩下那 700 多行里有一半是**与 App 实例无关的东西**——调参常量、世界配置接口、
 * 几个纯函数。它们混在入口文件里有两个代价：
 *   ① 想改"视距"或"灵敏度"要先在 8000 行里找到它；
 *   ② AI 每轮读文件的成本按行数算。
 *
 * 搬出来之后 `main.ts` 只留"入口 + App 类"，这一类常量集中在这里。
 * ⚠️ **这里只放常量与纯函数**：不要往这个文件里加需要 App 实例的东西
 * （那会把依赖绕回去，就白拆了）。
 */

import type { PlayerInput } from '../core/physics/PlayerPhysics.ts';
import type { WorldType } from '../core/gen/WorldType.ts';
import type { Difficulty } from '../core/world/Rules.ts';

// ---------------------------------------------------------------- 世界与帧

/** 渲染距离（区块） */
/** 视距默认值（玩家可在设置里改，见 `App.viewDistance`） */
export const VIEW_DISTANCE = 12;
/** 每帧最多网格化的区块数，用于把加载耗时摊到多帧 */
export const MESH_BUDGET_PER_FRAME = 3;

/** 游戏逻辑 tick（原版 20 次/秒），生存机制按这个节奏结算 */
export const TICK_SECONDS = 0.05;
/** 随机刻的作用半径（区块）：原版是 128 格，这里取 3 个区块以免每 tick 做太多事 */
export const RANDOM_TICK_RADIUS = 3;

/** 死亡后自动重生的等待时间（秒） */
export const RESPAWN_DELAY = 3;

/**
 * 传送后等目的地区块加载的上限（帧；60fps 下 5 秒）。
 * 超时就把玩家直接放在目标坐标上——宁可落在地形里，也不要一直冻着出不来。
 */
export const PORTAL_ARRIVAL_TIMEOUT_FRAMES = 300;

// ---------------------------------------------------------------- 交互

/** 玩家近战距离（原版约 3 格） */
export const ATTACK_RANGE = 3.2;
/** 攻击冷却（原版满蓄力为 0.625 秒） */
export const ATTACK_COOLDOWN = 0.5;
/**
 * 首次进入（没有存档、也没有世界清单）时用的默认种子。
 * 平时的种子由主菜单里的世界决定，见 `WorldConfig`。
 */
export const DEFAULT_WORLD_SEED = 20261014;
/** 原版触及距离：生存 4.5 格 */
export const REACH = 4.5;
/** 鼠标视角灵敏度（弧度/像素） */
export const MOUSE_SENSITIVITY = 0.0022;
/**
 * 触摸视角灵敏度（弧度/像素）。
 * 比鼠标高：手指在屏幕上的一次拖动行程通常只有鼠标的 1/3 左右，
 * 用同样的系数会转得很吃力。
 */
export const TOUCH_SENSITIVITY = 0.0034;

/** 连续破坏/放置的最小间隔（秒） */
export const BREAK_COOLDOWN = 0.25;
export const PLACE_COOLDOWN = 0.22;
/** 进食时的咀嚼间隔（秒）：每嚼一口晃一下手臂、响一声咀嚼音 */
export const CHEW_INTERVAL = 0.4;

// ---------------------------------------------------------------- 维度外观

/**
 * 下界的雾颜色与视距。
 * 下界是被岩层包住的密闭空间，原版用很短的视距 + 暗红雾气表现"闷热的地下"，
 * 这里同样把雾拉近并换成暗红，同时关掉天空穹顶（那里没有天空）。
 */
export const NETHER_FOG = 0x3a1010;
export const NETHER_FOG_NEAR = 18;
export const NETHER_FOG_FAR = 84;
/** 下界没有天光，场景亮度固定（岩浆与荧光石才是主要光源） */
export const NETHER_SKY_BRIGHTNESS = 0.38;
/**
 * 末地的天空与雾。
 * 末地同样是"没有天光"的维度，但它不像下界那样密闭：外岛之间是开阔的虚空，
 * 所以雾拉得比下界远得多，背景是带紫的星空黑。
 */
export const END_SKY = 0x0a0714;
export const END_FOG = 0x140b22;
export const END_FOG_NEAR = 48;
export const END_FOG_FAR = 190;
export const END_SKY_BRIGHTNESS = 0.42;
export const END_MIN_BRIGHTNESS = 0.2;

/**
 * 视线介质的雾与色罩（E16）。
 * 水下能看清十几格、颜色偏青蓝；岩浆里只能看清贴脸的两三格，橙红一片。
 */
export const WATER_FOG = 0x1b4a7a;
export const WATER_FOG_NEAR = 0.6;
export const WATER_FOG_FAR = 22;
export const LAVA_FOG = 0x8a2a05;
export const LAVA_FOG_NEAR = 0.2;
export const LAVA_FOG_FAR = 2.6;
/** 粒子的最低亮度：夜里挖方块也要看得见碎块 */
export const PARTICLE_MIN_BRIGHTNESS = 0.3;
/** 末影龙的出生点：盘旋圆上的一点（主岛在原点） */
export const DRAGON_SPAWN_X = 0;
export const DRAGON_SPAWN_Z = 46;
/**
 * 下界的最低亮度下限。
 * 下界光照全靠方块光，而方块光的传播范围有限，远离光源就是纯黑；
 * 原版下界靠"维度环境光"把整片空间托起来，这里用同一个手段（抬高亮度下限）。
 */
export const NETHER_MIN_BRIGHTNESS = 0.24;

// ---------------------------------------------------------------- 世界配置

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

/** 界面打开时喂给物理的空输入，让玩家原地停住而不是保持上一帧的速度 */
export const IDLE_INPUT: PlayerInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

// ---------------------------------------------------------------- 纯工具

/** 把多路输入相加后夹到 -1~1（键盘 + 触摸 + 手柄可能同时给出分量） */
export function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/**
 * 避雷针索引与脉冲表共用的键（批次 83）：`x,y,z`。
 *
 * 放在模块级而不是类里：`RodPulses`（`world/Lightning.ts`）用的是同一套写法，
 * 两边必须逐字一致——写成两个地方，早晚会出现"索引里有、脉冲表里没有"这种错位。
 */
export function rodKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** 刷怪笼索引的键（与避雷针同一套写法；分开取名是为了让日志里看得出是哪一张索引） */
export function spawnerKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}
