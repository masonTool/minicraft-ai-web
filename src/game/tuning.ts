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
import type { GameMode } from '../core/world/GameMode.ts';

// ---------------------------------------------------------------- 世界与帧

/** 渲染距离（区块） */
/** 视距默认值（玩家可在设置里改，见 `App.viewDistance`） */
export const VIEW_DISTANCE = 12;
/** 每帧最多网格化的区块数，用于把加载耗时摊到多帧 */
export const MESH_BUDGET_PER_FRAME = 3;
/**
 * 每帧最多跑几次生物 A* 寻路（批次 500）。
 *
 * 一次搜索 = 几百个节点 × 每个节点十几次 `getBlock`，手机上约 1~3ms。
 * 二十几只怪各按 0.5~0.9 秒重算，平均每秒 ~35 次——不设预算时它们会**同一帧撞在一起**，
 * 单帧就是几十毫秒（真机日志里 `phases.ent` 35ms 的主因）。
 * 2 次/帧 @ 24fps = 48 次/秒，够用且不会把一帧吃掉。
 */
export const PATH_SEARCH_BUDGET_PER_FRAME = 2;

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

/**
 * 玩家近战距离（格）。
 *
 * 批次 276 从 3.2 → 4.2；批次 336 用户反馈"只能操作四五格，正式版能到 10 格左右"，
 * 于是整体拉到远距离手感：**放置/破坏 10 格、近战 7.5 格**。
 * 近战仍比放置短一截——否则会变成"隔着好几格空气打怪"，而方块交互本来就更依赖瞄准。
 */
export const ATTACK_RANGE = 7.5;
/** 攻击冷却（原版满蓄力为 0.625 秒） */
export const ATTACK_COOLDOWN = 0.5;
/**
 * 首次进入（没有存档、也没有世界清单）时用的默认种子。
 * 平时的种子由主菜单里的世界决定，见 `WorldConfig`。
 */
export const DEFAULT_WORLD_SEED = 20261014;
/**
 * 方块触及距离（格）：放置 / 破坏 / 开箱子 / 装桶 / 点载具都用它。
 *
 * 批次 276 从 4.5 → 5.5；批次 336 用户明确要"离角色 10 格左右"的操作范围，
 * 于是调到 **10**：手机屏幕上手指落点与准星都有误差，距离太近会频繁"差半步"。
 * 代价是能隔着几格空气放置/挖掘——这是用户明确要的手感，不再按原版 4.5 收着。
 */
export const REACH = 10;
/**
 * 鼠标视角灵敏度（弧度/像素）。
 *
 * 批次 539（PC 反馈）：默认 4 档 × 0.0022 时约 0.5°/像素，1440p 下轻轻一动
 * 就甩出很远，观感像"卡/跳"。再降到 0.0008：默认 4 档约 0.18°/像素，
 * 最低 1 档约 0.09°/像素，PC 玩家不必再被"最低档还太快"困住。
 * 触摸端走 `TOUCH_SENSITIVITY`，不受影响。
 */
export const MOUSE_SENSITIVITY = 0.0008;
/**
 * 触摸视角灵敏度（弧度/像素）。
 * 比鼠标高：手指在屏幕上的一次拖动行程通常只有鼠标的 1/3 左右，
 * 用同样的系数会转得很吃力。
 */
export const TOUCH_SENSITIVITY = 0.0034;

/**
 * 光照引擎**每帧**消费多少步（`LightEngine.process(budget)`）。
 *
 * ⚠️ 这个数是"开新世界要等多久"的**真正瓶颈**（批次 103 实测，N8）：
 * 主循环里网格化被 `if (!lightBusy)` 挡着（本意是"别把没收敛的光照烘焙进网格"），
 * 而渐进视距一开局就把半径开到 12 —— 489 个区块的光照队列有约 **450 万步**。
 * 6000 步/帧（60fps）意味着要 **12.5 秒**才排空，期间**网格化一个都不派**，
 * 加载遮罩就一直挂着：实测 `world:constructed 270ms → world:playable 16218ms`。
 * 而这 450 万步的纯 CPU 只有 **0.4 秒左右** —— 99% 的时间是"每帧只肯做 6000 步"浪费掉的。
 *
 * 所以启动期用大预算、进游戏后回到小预算：加载遮罩还在（或渐进视距还没涨到设定值）时
 * 玩家看不到世界，多花点 CPU 换"早十几秒能玩"是划算的；进了游戏就必须让出帧时间。
 */
export const LIGHT_BUDGET_PER_FRAME = 6000;
/** 启动期的光照预算（见上）。实测把它开到 12 万步能把"到第一块地形"从 16.2s 压到 ~1s */
export const STARTUP_LIGHT_BUDGET_PER_FRAME = 120000;
/**
 * 手机上的光照预算。
 *
 * 12 万步在桌面大约 10ms，在手机上是一整帧甚至更久。更糟的是：视距还在涨时
 * 如果一直用这笔预算，帧时间永远过不了 22ms，渐进视距就停在半路，
 * "还在启动"这个判断也就永远为真——于是每一帧都做 12 万步，越玩越卡。
 * 遮罩还在时可以多做一点（玩家还没看见世界）；遮罩一撤必须回到游玩预算。
 */
export const MOBILE_LIGHT_BUDGET_PER_FRAME = 4000;
export const MOBILE_STARTUP_LIGHT_BUDGET_PER_FRAME = 24000;

/** 这一帧光照引擎该走多少步。`startup` 只表示"加载遮罩还在"（手机）或"视距还没涨完"（桌面）。 */
export function lightBudgetForFrame(startup: boolean, mobile: boolean): number {
  if (!mobile) return startup ? STARTUP_LIGHT_BUDGET_PER_FRAME : LIGHT_BUDGET_PER_FRAME;
  return startup ? MOBILE_STARTUP_LIGHT_BUDGET_PER_FRAME : MOBILE_LIGHT_BUDGET_PER_FRAME;
}

/**
 * 光照积压到多少格之后，**网格化不再等它**（批次 238）。
 *
 * 主循环里网格化的门闩是 `if (!lightBusy)`，本意是"别把没收敛的光照烘焙进网格"。
 * 但 2026-10-18 的真机日志里光照队列涨到 308 万格之后这个条件**永远为假**：
 * `meshQueue` 卡在 142、`drawn` 从 128 掉到 69，玩家看到的是"世界停在旧画面上"——
 * 一个光照 bug 直接把整局游戏的画面连坐了。
 *
 * 积压超过这个数就退让：照常用**当前**光照烘焙，等队列排空后 `pendingSettle` 会再刷一遍。
 * 50k 大约相当于"正常游玩时队列的 2~3 倍"，够区分"真的排不空"与"加载期的正常积压"。
 */
export const LIGHT_BACKLOG_MESH_PATIENCE = 50_000;

/**
 * `pendingSettle`（等光照收敛后要重刷的坐标）最多攒多少**格**（批次 238）。
 *
 * 它只在 `!lightBusy` 时被消费；光照一旦长期不收敛就会只进不出
 * （每次改方块 push 3 个数），等于第二份无界队列。超出就丢最旧的：
 * 每个改动区块在 `onBlockChanged` 里本来就走过一次 `enqueueAround`，
 * 这里只是"光照收敛后再刷一次"的补充，丢了不会让画面不更新。
 */
export const PENDING_SETTLE_LIMIT = 3 * 4096;

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
  /** 游戏模式（批次 181）：生存/创造；缺省按生存处理 */
  gameMode?: GameMode;
  /** 单一群系世界的群系注册名（批次 533） */
  singleBiome?: string;
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
