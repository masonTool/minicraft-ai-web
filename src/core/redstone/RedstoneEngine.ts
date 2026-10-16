/**
 * 红石电路引擎
 *
 * 复刻的是"信号强度 0~15 + 逐格衰减 + 元件按输入改变状态"这一套核心机制：
 *
 *   电源（拉杆 / 按钮 / 压力板 / 红石火把 / 红石块 / 中继器 / 比较器 / 侦测器）
 *     → 红石粉逐格衰减 1 传播
 *     → 负载（红石灯 / 活塞 / 粘性活塞）按输入强度改变状态
 *
 * 与原件版的区别（已记录到 TASKS.md）：
 *  - 不做"方块充能强度"的完整模型（原版准连接、充能等级那一套），
 *    这里只做"相邻电源/粉 → 元件"的一层充能；
 *  - 更新顺序不是原版的深度优先 + 调度队列，而是"变化点洪泛 + 整体重算 + 迭代到稳定"，
 *    对常见电路（开关点灯、拉杆推活塞、中继器延时、侦测器脉冲）结果一致，
 *    但对依赖更新顺序的极端电路（BUD、瞬时脉冲）会有差异；
 *  - 比较器只做"输入强度直通"，不实现容器读取与减法模式。
 *
 * 红石粉的强度是**运行时状态**（Map），不写进方块状态：方块状态只有 8 位，
 * 还要留给朝向与延迟；强度是易变的中间量，没必要占位。
 */

import { Block, blockDef } from '../registry/blocks.ts';
import { TRIPWIRE_MAX_LENGTH } from '../registry/blocks.ts';
import {
  FACING_OFFSET,
  facingOf,
  isDisarmed,
  isDoorOpen,
  isDoorUpper,
  isFenceGateOpen,
  isInverted,
  isPowered,
  isTrapdoorOpen,
  isTripwireAttached,
  tripwireWireDirection,
  withDisarmed,
  withDoorOpen,
  withDoorUpper,
  withFacing,
  withFenceGateOpen,
  withInverted,
  withPowered,
  withTrapdoorOpen,
  withTripwireAttached,
} from '../registry/blockState.ts';
import { WORLD_MAX_Y, WORLD_MIN_Y } from '../world/Chunk.ts';

/** 引擎需要的世界能力（便于离线测试时替换成 stub） */
export interface RedstoneWorld {
  getBlock(x: number, y: number, z: number): number;
  getState(x: number, y: number, z: number): number;
  /** 写入方块（会触发光照与重网格化） */
  setBlock(x: number, y: number, z: number, id: number, state: number): boolean;
  /** 只改状态（红石灯亮灭、拉杆开关、活塞伸出标记） */
  setState(x: number, y: number, z: number, state: number): boolean;
  /** 该列是否已加载（跨区块的红石需要注意别改到未加载区域） */
  isLoaded(x: number, z: number): boolean;
  /** 该格是否有玩家/生物（压力板用） */
  hasEntityAt(x: number, y: number, z: number): boolean;
  /**
   * 该格的天光等级（0~15）。**只有阳光传感器用**（批次 54）：
   * 它是唯一一个"输出强度取决于天气/时间"的电源。
   * 不传就当 0（室内/夜里）——离线测试不必为了它搭一套光照。
   */
  getSkyLight?(x: number, y: number, z: number): number;
}

/**
 * 参与红石计算的方块（洪泛时只走这些，避免把整片地形都搜一遍）。
 *
 * 导出是为了让"红石元件有多少种"这个数**量得出来**（`tools/coverage-report.ts` 扫全表），
 * 而不是在文档里手抄一个迟早会漂的数字。
 */
export function isRedstoneComponent(id: number): boolean {
  // 门 / 活板门 / 栅栏门（批次 30 接进红石）：它们是红石**负载**（通电即开）。
  // 批次 38 起按**形状**判定 —— 6 种木材的同一种门是同一件东西，
  // 按 id 逐个列举必然漏（加一种木材就多 4 个方块）。
  if (isOpenableShape(blockDef(id).shape)) return true;
  switch (id) {
    case Block.REDSTONE_WIRE:
    case Block.REDSTONE_TORCH:
    case Block.REDSTONE_BLOCK:
    case Block.LEVER:
    case Block.STONE_BUTTON:
    case Block.OAK_BUTTON:
    case Block.STONE_PRESSURE_PLATE:
    case Block.OAK_PRESSURE_PLATE:
    case Block.REPEATER:
    case Block.COMPARATOR:
    case Block.REDSTONE_LAMP:
    case Block.PISTON:
    case Block.STICKY_PISTON:
    case Block.PISTON_HEAD:
    case Block.OBSERVER:
    // 阳光传感器（批次 54）：按天光强度输出的**可变量电源**
    case Block.DAYLIGHT_DETECTOR:
    // 绊线与绊线钩（批次 55）：两者都要是元件，洪泛才能把一条回路连成一片
    case Block.TRIPWIRE:
    case Block.TRIPWIRE_HOOK:
    // TNT（批次 56）：通电就点燃（它是"负载"，但点燃的后果在引信表那边）
    case Block.TNT:
    // 漏斗（批次 58）：通电就**锁定**（不推也不吸）——这是原版的"漏斗闸门"玩法
    case Block.HOPPER:
      return true;
    default:
      return false;
  }
}

/** 这三种形状都是"能开合"的（通电即开、右键也能开） */
export function isOpenableShape(shape: string): boolean {
  return shape === 'door' || shape === 'trapdoor' || shape === 'fence_gate';
}

/** 红石粉的最大传播距离（原版 15 格） */
const WIRE_RANGE = 15;
/** 洪泛的搜索上限（防止在异常电路上卡死） */
const MAX_NODES = 4096;
/** 一次重算最多迭代几轮（元件状态改变可能引发连锁） */
const MAX_ITERATIONS = 8;
/** 按钮自动弹起的时间（秒）：石 1 秒、木 1.5 秒，与原版一致 */
const BUTTON_DURATION = { stone: 1, oak: 1.5 } as const;
/** 侦测器脉冲宽度（秒，原版 2 红石刻） */
const OBSERVER_PULSE = 0.2;

/**
 * 阳光传感器的输出强度（批次 54）：白天 = 天光等级，反向模式 = 15 − 天光。
 *
 * 抽成纯函数是为了能被离线测试直接钉住（原版这两条就是全部规则：
 * 晴天正午 15、夜里 0；反向模式刚好反过来）。
 */
export function daylightOutput(skyLight: number, inverted: boolean): number {
  const level = Math.max(0, Math.min(15, skyLight));
  return inverted ? 15 - level : level;
}

/** 一个节点的坐标 */
interface Node {
  x: number;
  y: number;
  z: number;
}

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export class RedstoneEngine {
  /** 红石粉的当前强度，key = "x,y,z"（调试面板与测试可以直接读） */
  readonly wirePower = new Map<string, number>();
  /** 按钮的弹起倒计时，key = "x,y,z"（值 = 剩余秒数） */
  private readonly buttonTimers = new Map<string, number>();
  /** 侦测器脉冲的剩余时间 */
  private readonly observerPulses = new Map<string, number>();
  /** 中继器的延迟倒计时（输入已到达、等待输出） */
  private readonly repeaterTimers = new Map<string, number>();
  /** 中继器当前是否在输出 */
  private readonly repeaterOutput = new Map<string, boolean>();
  /** 压力板的状态缓存（避免每帧都改状态触发重网格化） */
  private readonly plateState = new Map<string, boolean>();
  /**
   * 阳光传感器：位置 → 上次算出的输出强度（批次 54）。
   *
   * 为什么要记下来：它的输出取决于**外部世界**（天光随时间与天气变），
   * 而不是取决于电路——所以得每隔一秒主动复查一次"强度变了没有"，
   * 变了才登记重算（不然每个传感器每秒都要拉着整片电路重算一遍）。
   */
  private readonly daylightOutputs = new Map<string, number>();
  /**
   * 绊线回路上的每格绊线：位置 → 上次看到的"有没有实体"（批次 55）。
   * 与压力板同一套路：实体踩线**不会**产生方块变化事件，只能每 0.1 秒主动看一次。
   */
  private readonly tripwireEntity = new Map<string, boolean>();
  /** 待重新计算的位置（tick 里批量处理，避免一次改动触发多次全量重算） */
  private readonly dirty: string[] = [];
  private readonly dirtySet = new Set<string>();
  /** 统计：本次会话算过多少次电路（调试面板用） */
  updates = 0;

  /** 已经"因为通电而点燃"的 TNT（上升沿判定用） */
  private readonly tntPrimed = new Set<string>();

  /**
   * TNT 被红石点燃时的回调（批次 56）。
   *
   * ⚠️ 为什么是回调而不是引擎自己点燃：**引信不在方块状态里**——它是一张运行时表
   * （`core/world/PrimedTnt.ts`），写那张表的只能是拿着它的人（main）。
   * 引擎只负责"判定这里通电了"，点火这件事交给外面。
   */
  onTntIgnite?: (x: number, y: number, z: number) => void;

  /** 玩家右键拉杆：开 ↔ 关 */
  toggleLever(world: RedstoneWorld, x: number, y: number, z: number): boolean {
    if (world.getBlock(x, y, z) !== Block.LEVER) return false;
    const state = world.getState(x, y, z);
    if (!world.setState(x, y, z, withPowered(state, !isPowered(state)))) return false;
    this.markDirty(x, y, z);
    this.flush(world);
    return true;
  }

  /**
   * 玩家拿**剪刀右键绊线**（批次 55）：把它剪断（`disarmed`）。
   * 剪断之后线还在、回路也还连着，但踩上去不再触发——原版就是用剪刀剪的。
   */
  disarmTripwire(world: RedstoneWorld, x: number, y: number, z: number): boolean {
    if (world.getBlock(x, y, z) !== Block.TRIPWIRE) return false;
    const state = world.getState(x, y, z);
    if (isDisarmed(state)) return false;
    if (!world.setState(x, y, z, withDisarmed(state, true))) return false;
    this.markDirty(x, y, z);
    this.flush(world);
    return true;
  }

  /**
   * 玩家右键阳光传感器（批次 54）：在"白天通电"与"反向（天黑通电）"之间切换。
   *
   * 与拉杆同一套（改状态 + 登记重算），区别是这里改的是 `inverted` 位，
   * 而输出强度是**重算时按天光现算**的，所以改完必须立刻重算一次。
   */
  toggleInverted(world: RedstoneWorld, x: number, y: number, z: number): boolean {
    if (world.getBlock(x, y, z) !== Block.DAYLIGHT_DETECTOR) return false;
    const state = world.getState(x, y, z);
    if (!world.setState(x, y, z, withInverted(state, !isInverted(state)))) return false;
    this.markDirty(x, y, z);
    this.flush(world);
    return true;
  }

  /** 玩家右键按钮：按下并在 1 秒（石）/ 1.5 秒（木）后自动弹起 */
  pressButton(world: RedstoneWorld, x: number, y: number, z: number): boolean {
    const id = world.getBlock(x, y, z);
    if (id !== Block.STONE_BUTTON && id !== Block.OAK_BUTTON) return false;
    const state = world.getState(x, y, z);
    if (isPowered(state)) return false;
    if (!world.setState(x, y, z, withPowered(state, true))) return false;
    this.buttonTimers.set(keyOf(x, y, z), id === Block.STONE_BUTTON ? BUTTON_DURATION.stone : BUTTON_DURATION.oak);
    this.markDirty(x, y, z);
    this.flush(world);
    return true;
  }

  /** 是否正在求解（求解过程中会写方块，写方块又会回调 onBlockChanged，需要防重入） */
  private flushing = false;

  /** 方块发生变化（放置/破坏/状态改变）时调用 */
  onBlockChanged(world: RedstoneWorld, x: number, y: number, z: number): void {
    // 变化点自身与其 6 邻域都可能影响电路
    this.markDirty(x, y, z);
    for (const [dx, dy, dz] of NEIGHBORS) this.markDirty(x + dx, y + dy, z + dz);
    // 侦测器：盯着这一格的侦测器会被触发
    this.triggerObservers(world, x, y, z);
    // 求解过程中（比如活塞推方块）只登记，等本次求解结束后由 tick 统一处理
    if (this.flushing) return;
    this.flush(world);
  }

  private markDirty(x: number, y: number, z: number): void {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    const key = keyOf(x, y, z);
    if (this.dirtySet.has(key)) return;
    this.dirtySet.add(key);
    this.dirty.push(key);
  }

  /** 每帧推进定时器；有到期的元件就重算一次 */
  tick(world: RedstoneWorld, dt: number): void {
    let changed = false;

    // 按钮弹起
    for (const [key, remaining] of [...this.buttonTimers]) {
      const next = remaining - dt;
      if (next > 0) {
        this.buttonTimers.set(key, next);
        continue;
      }
      this.buttonTimers.delete(key);
      const [x, y, z] = parseKey(key);
      const state = world.getState(x, y, z);
      if (isPowered(state)) {
        world.setState(x, y, z, withPowered(state, false));
        this.markDirty(x, y, z);
        changed = true;
      }
    }

    // 侦测器脉冲结束
    for (const [key, remaining] of [...this.observerPulses]) {
      const next = remaining - dt;
      if (next > 0) {
        this.observerPulses.set(key, next);
        continue;
      }
      this.observerPulses.delete(key);
      const [x, y, z] = parseKey(key);
      const state = world.getState(x, y, z);
      if (isPowered(state)) {
        world.setState(x, y, z, withPowered(state, false));
        this.markDirty(x, y, z);
        changed = true;
      }
    }

    // 中继器延迟输出
    for (const [key, remaining] of [...this.repeaterTimers]) {
      const next = remaining - dt;
      if (next > 0) {
        this.repeaterTimers.set(key, next);
        continue;
      }
      this.repeaterTimers.delete(key);
      const [x, y, z] = parseKey(key);
      this.repeaterOutput.set(key, true);
      this.markDirty(x, y, z);
      changed = true;
    }

    // 压力板：按 10Hz 检查实体（每帧做太浪费）
    this.plateTimer -= dt;
    if (this.plateTimer <= 0) {
      this.plateTimer = 0.1;
      if (this.pollPressurePlates(world)) changed = true;
      // 绊线（批次 55）：与压力板同一节奏看"线上有没有实体"
      if (this.pollTripwires(world)) changed = true;
    }

    // 阳光传感器：每秒复查（原版 20 tick）。天光随时间与天气变，
    // 而这件事**不会**产生任何方块变化事件，所以只能主动看
    this.daylightTimer -= dt;
    if (this.daylightTimer <= 0) {
      this.daylightTimer = 1;
      if (this.pollDaylight(world)) changed = true;
    }

    if (this.dirty.length > 0 || changed) this.flush(world);
  }

  private plateTimer = 0;
  /**
   * 阳光传感器的复查倒计时（秒）。
   * 初值是 **1**（而不是 0）：引擎刚建好时不必立刻复查一次——
   * 传感器第一次被算到（放置时就走重算）就已经把强度记下来了。
   * 从 0 开始的话"进游戏第一帧"就会多跑一次全量求解。
   */
  private daylightTimer = 1;

  /** 处理所有待重算的位置 */
  private flush(world: RedstoneWorld): void {
    const seeds = this.dirty.splice(0, this.dirty.length);
    this.dirtySet.clear();
    if (seeds.length === 0) return;
    this.flushing = true;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      let changed = false;
      for (const key of seeds) {
        const [x, y, z] = parseKey(key);
        if (this.recompute(world, x, y, z)) changed = true;
      }
      // 元件状态变化会引入新的待算位置（连锁），下一轮再处理
      if (!changed || this.dirty.length === 0) break;
      seeds.push(...this.dirty.splice(0, this.dirty.length));
      this.dirtySet.clear();
    }
    this.flushing = false;
    this.updates++;
  }

  /**
   * 扫一条绊线回路（批次 55）：从这根钩子出发，沿着"线延伸的方向"往前走。
   *
   * @returns `path` 沿途的绊线格、`attached` 是不是接到了**另一根朝向相对的钩子**、
   *          `powered` 有没有被触发（接上了 + 至少有一格**没被剪断**的线上有实体）
   *
   * ⚠️ 三个容易漏的判据：
   *  1. 对面的钩子必须**朝向相对**——朝向一致的两根钩子不算一条回路（原版如此）
   *  2. 中间**必须全是绊线**：中间夹了别的方块就断了（原版不会"隔空触发"）
   *  3. **被剪断的那一格不算触发**，但也不打断回路（原版剪断的是"这一格的触发"）
   */
  private scanTripwire(
    world: RedstoneWorld,
    x: number,
    y: number,
    z: number,
    state: number,
  ): { path: Node[]; attached: boolean; powered: boolean } {
    const [dx, dz] = FACING_OFFSET[tripwireWireDirection(state)]!;
    const path: Node[] = [];
    let attached = false;
    let cx = x + dx;
    let cz = z + dz;
    for (let step = 0; step < TRIPWIRE_MAX_LENGTH; step++) {
      const id = world.getBlock(cx, y, cz);
      if (id === Block.TRIPWIRE) {
        path.push({ x: cx, y, z: cz });
        cx += dx;
        cz += dz;
        continue;
      }
      if (id === Block.TRIPWIRE_HOOK) {
        // 对面的钩子要朝回来（朝向 = 贴着的那一面，所以正好相差 180°）
        const other = tripwireWireDirection(world.getState(cx, y, cz));
        attached = other === ((tripwireWireDirection(state) + 2) & 3);
      }
      break;
    }
    const powered =
      attached &&
      path.some((node) => !isDisarmed(world.getState(node.x, node.y, node.z)) && world.hasEntityAt(node.x, node.y, node.z));
    return { path, attached, powered };
  }

  /**
   * 绊线的实体轮询（批次 55）：与压力板同一节奏（10Hz）。
   *
   * 为什么必须轮询：实体踩到线**不会**产生方块变化事件，电路没有别的机会知道。
   * 只有"这一格的实体状态变了"才登记重算——而重算会顺着洪泛把整条回路（含两根钩子）
   * 重新算一遍，于是两个钩子都会跟着亮。
   */
  private pollTripwires(world: RedstoneWorld): boolean {
    let changed = false;
    for (const [key, previous] of [...this.tripwireEntity]) {
      const [x, y, z] = parseKey(key);
      if (world.getBlock(x, y, z) !== Block.TRIPWIRE || !world.isLoaded(x, z)) {
        this.tripwireEntity.delete(key);
        continue;
      }
      const pressed = world.hasEntityAt(x, y, z);
      if (pressed === previous) continue;
      this.tripwireEntity.set(key, pressed);
      this.markDirty(x, y, z);
      changed = true;
    }
    return changed;
  }

  /**
   * 阳光传感器的周期性复查（批次 54）。
   *
   * 只有"输出强度真的变了"的位置才登记重算——否则一个传感器每秒都会把整片电路重算一遍
   * （原版也是"强度变了才发更新"）。方块被挖掉/换成别的、或所在区块已卸载时，
   * 顺手把记录清掉（这就是这份名单的"垃圾回收"）。
   */
  private pollDaylight(world: RedstoneWorld): boolean {
    let changed = false;
    for (const [key, previous] of [...this.daylightOutputs]) {
      const [x, y, z] = parseKey(key);
      if (world.getBlock(x, y, z) !== Block.DAYLIGHT_DETECTOR || !world.isLoaded(x, z)) {
        this.daylightOutputs.delete(key);
        continue;
      }
      const strength = daylightOutput(world.getSkyLight?.(x, y, z) ?? 0, isInverted(world.getState(x, y, z)));
      if (strength === previous) continue;
      this.daylightOutputs.set(key, strength);
      this.markDirty(x, y, z);
      changed = true;
    }
    return changed;
  }

  /** 压力板轮询：踩上去就通电（原版是实体碰撞事件，这里用 AABB 查询近似） */
  private pollPressurePlates(world: RedstoneWorld): boolean {
    let changed = false;
    for (const [key, on] of [...this.plateState]) {
      const [x, y, z] = parseKey(key);
      const id = world.getBlock(x, y, z);
      if (id !== Block.STONE_PRESSURE_PLATE && id !== Block.OAK_PRESSURE_PLATE) {
        this.plateState.delete(key);
        continue;
      }
      const pressed = world.hasEntityAt(x, y, z);
      if (pressed === on) continue;
      this.plateState.set(key, pressed);
      world.setState(x, y, z, withPowered(world.getState(x, y, z), pressed));
      this.markDirty(x, y, z);
      changed = true;
    }
    return changed;
  }

  /** 注册一块压力板（recompute 发现压力板时自动登记，之后 tick 里轮询实体） */
  private trackPlate(world: RedstoneWorld, x: number, y: number, z: number): void {
    const key = keyOf(x, y, z);
    if (!this.plateState.has(key)) this.plateState.set(key, isPowered(world.getState(x, y, z)));
  }

  // ---------------------------------------------------------------- 核心求解

  /**
   * 重算以 (x,y,z) 为中心的红石网络。
   * @returns 是否有元件状态发生了变化
   */
  recompute(world: RedstoneWorld, x: number, y: number, z: number): boolean {
    const nodes = this.collect(world, x, y, z);
    if (nodes.size === 0) return false;

    // ---- 1. 收集电源强度（每个电源贡献"自身格 = 15"）
    const strengths = new Map<string, number>();
    const sources: Node[] = [];

    for (const key of nodes) {
      const [nx, ny, nz] = parseKey(key);
      const id = world.getBlock(nx, ny, nz);
      const state = world.getState(nx, ny, nz);

      switch (id) {
        case Block.LEVER:
        case Block.STONE_BUTTON:
        case Block.OAK_BUTTON:
        case Block.STONE_PRESSURE_PLATE:
        case Block.OAK_PRESSURE_PLATE:
          if (id === Block.STONE_PRESSURE_PLATE || id === Block.OAK_PRESSURE_PLATE) this.trackPlate(world, nx, ny, nz);
          if (isPowered(state)) {
            strengths.set(key, 15);
            sources.push({ x: nx, y: ny, z: nz });
          }
          break;
        case Block.REDSTONE_TORCH:
        case Block.REDSTONE_BLOCK:
          strengths.set(key, 15);
          sources.push({ x: nx, y: ny, z: nz });
          break;
        case Block.TRIPWIRE_HOOK: {
          // 绊线钩（批次 55）：两根**朝向相对**的钩子 + 中间若干格绊线 = 一条回路；
          // 线上有实体时两个钩子都输出 15。判定全在 `scanTripwire` 里（纯读世界）
          const scan = this.scanTripwire(world, nx, ny, nz, state);
          // 状态位写回：`attached`（线接上了没）与 `powered`（触发没）都要给渲染看
          if (isTripwireAttached(state) !== scan.attached || isPowered(state) !== scan.powered) {
            world.setState(
              nx,
              ny,
              nz,
              withPowered(withTripwireAttached(state, scan.attached), scan.powered),
            );
          }
          // 登记进"要看实体"的名单（每 0.1 秒复查一次），并顺手把当前状态记下来
          for (const node of scan.path) this.tripwireEntity.set(keyOf(node.x, node.y, node.z), world.hasEntityAt(node.x, node.y, node.z));
          // 顺带把链上每一格绊线的 `powered` 位也写上（原版绊线自己也有 POWERED 状态）
          for (const node of scan.path) {
            const wireState = world.getState(node.x, node.y, node.z);
            if (isPowered(wireState) !== scan.powered) {
              world.setState(node.x, node.y, node.z, withPowered(wireState, scan.powered));
            }
          }
          if (scan.powered) {
            strengths.set(key, 15);
            sources.push({ x: nx, y: ny, z: nz });
          }
          break;
        }
        case Block.DAYLIGHT_DETECTOR: {
          // 阳光传感器（批次 54）：**输出强度按天光现算**，并把结果写进 strengths，
          // 于是"贴在它旁边的粉"与"紧贴的负载"都按这个强度走（与红石块同一条路，
          // 只是强度不是 15）。
          const strength = daylightOutput(world.getSkyLight?.(nx, ny, nz) ?? 0, isInverted(state));
          this.daylightOutputs.set(key, strength);
          if (strength > 0) {
            strengths.set(key, strength);
            sources.push({ x: nx, y: ny, z: nz });
          }
          // `powered` 位跟着输出走（渲染与调试要看"现在有没有输出"）。
          // ⚠️ 这里改的是**自己**的状态，所以**不能** markDirty 自己——
          // 那会让下一轮迭代又重算一次自己，白转一圈（强度已经算完了）
          if (isPowered(state) !== (strength > 0)) {
            world.setState(nx, ny, nz, withPowered(state, strength > 0));
          }
          break;
        }
        case Block.REPEATER:
        case Block.COMPARATOR:
        case Block.OBSERVER: {
          const output = this.componentOutput(world, nx, ny, nz, id, state);
          if (output.strength > 0) {
            strengths.set(keyOf(nx + output.dx, ny, nz + output.dz), output.strength);
            sources.push({ x: nx + output.dx, y: ny, z: nz + output.dz });
          }
          break;
        }
        default:
          break;
      }
    }

    // ---- 2. 从电源出发传播到红石粉（逐格 -1）
    const queue = [...sources];
    for (const source of sources) {
      const startKey = keyOf(source.x, source.y, source.z);
      const startStrength = strengths.get(startKey) ?? 0;
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = source.x + dx;
        const ny = source.y + dy;
        const nz = source.z + dz;
        if (world.getBlock(nx, ny, nz) !== Block.REDSTONE_WIRE) continue;
        const value = startStrength - 1;
        if (value <= 0) continue;
        const nk = keyOf(nx, ny, nz);
        if ((strengths.get(nk) ?? -1) >= value) continue;
        strengths.set(nk, value);
        queue.push({ x: nx, y: ny, z: nz });
      }
    }

    while (queue.length > 0) {
      const node = queue.pop()!;
      const current = strengths.get(keyOf(node.x, node.y, node.z)) ?? 0;
      if (current <= 0) continue;
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nx = node.x + dx;
        const ny = node.y + dy;
        const nz = node.z + dz;
        if (world.getBlock(nx, ny, nz) !== Block.REDSTONE_WIRE) continue;
        const value = current - 1;
        if (value <= 0) continue;
        const nk = keyOf(nx, ny, nz);
        if ((strengths.get(nk) ?? -1) >= value) continue;
        strengths.set(nk, value);
        queue.push({ x: nx, y: ny, z: nz });
      }
    }

    // ---- 3. 写回粉的强度（只保留粉；其它只是中间量）
    for (const [key, value] of strengths) {
      const [nx, ny, nz] = parseKey(key);
      if (world.getBlock(nx, ny, nz) === Block.REDSTONE_WIRE) {
        const previous = this.wirePower.get(key) ?? 0;
        if (value > WIRE_RANGE) continue;
        this.wirePower.set(key, value);
        if (previous === 0 && value > 0) void 0;
      }
    }
    // 没有强度记录的粉清零
    for (const key of [...this.wirePower.keys()]) {
      if (strengths.has(key)) continue;
      if (!nodes.has(key)) continue;
      this.wirePower.delete(key);
    }

    // ---- 4. 用强度场驱动负载
    let changed = false;
    for (const key of nodes) {
      const [nx, ny, nz] = parseKey(key);
      const id = world.getBlock(nx, ny, nz);
      const state = world.getState(nx, ny, nz);
      const input = this.inputStrength(world, strengths, nx, ny, nz);

      // 门类负载（批次 30 接进红石；批次 38 起按形状覆盖全部木材：
      // 原来写死 3 种橡木方块，云杉门通上红石根本不开）
      if (isOpenableShape(blockDef(id).shape)) {
        if (this.applyOpenableLoad(world, nx, ny, nz, id, state, blockDef(id).shape, input)) changed = true;
        continue;
      }

      switch (id) {
        case Block.REDSTONE_LAMP: {
          const shouldLight = input > 0;
          if (isPowered(state) !== shouldLight) {
            world.setState(nx, ny, nz, withPowered(state, shouldLight));
            this.markDirty(nx, ny, nz);
            changed = true;
          }
          break;
        }
        case Block.PISTON:
        case Block.STICKY_PISTON: {
          const shouldExtend = input > 0;
          if (isPowered(state) !== shouldExtend) {
            const ok = shouldExtend
              ? this.extendPiston(world, nx, ny, nz, id, state)
              : this.retractPiston(world, nx, ny, nz, id, state);
            if (ok) {
              world.setState(nx, ny, nz, withPowered(world.getState(nx, ny, nz), shouldExtend));
              this.markDirty(nx, ny, nz);
              changed = true;
            }
          }
          break;
        }
        case Block.HOPPER: {
          // 漏斗（批次 58）：**通电即锁定**。引擎只把"锁没锁"写进状态位
          // （`isHopperLocked` 与红石灯共用 POWERED 位），搬运本身在容器那边——
          // 两者以方块状态为界，与"引擎只判定通电、点火交给引信表"是同一条分工。
          const shouldLock = input > 0;
          if (isPowered(state) !== shouldLock) {
            world.setState(nx, ny, nz, withPowered(state, shouldLock));
            this.markDirty(nx, ny, nz);
            changed = true;
          }
          break;
        }
        case Block.TNT: {
          // TNT（批次 56）：通电就点燃。⚠️ 用**上升沿**判定（与中继器同一套路）——
          // 每轮重算都调一次的话，`markDirty` 会把自己反复排进队列，
          // 一路烧到 `MAX_ITERATIONS`（点燃本身是幂等的，所以表现只是"白算 8 轮"）
          const tntKey = keyOf(nx, ny, nz);
          const wasPrimed = this.tntPrimed.has(tntKey);
          if (input > 0 && !wasPrimed) {
            this.tntPrimed.add(tntKey);
            this.onTntIgnite?.(nx, ny, nz);
          } else if (input <= 0 && wasPrimed) {
            // 断电后允许再点一次（比如玩家又放了一块 TNT 在那个位置）
            this.tntPrimed.delete(tntKey);
          }
          break;
        }
        case Block.REPEATER: {
          // 中继器：输入来了 → 延迟后输出 15
          //
          // ⚠️ 中继器的"输入"必须只看**背面**那一侧：它的输出就写在自己朝向的那一格上，
          // 若沿用六邻域输入，输出会被自己当成输入，形成自锁——断开电源后永远不停。
          const k = keyOf(nx, ny, nz);
          const wanted = this.backInput(world, strengths, nx, ny, nz, state) > 0;
          const outputting = this.repeaterOutput.get(k) ?? false;
          if (wanted && !outputting && !this.repeaterTimers.has(k)) {
            const delay = (delayTicksOf(state) + 1) * 0.1;
            this.repeaterTimers.set(k, delay);
          } else if (!wanted && outputting) {
            this.repeaterOutput.set(k, false);
            this.repeaterTimers.delete(k);
            this.markDirty(nx, ny, nz);
            changed = true;
          } else if (!wanted) {
            this.repeaterTimers.delete(k);
          }
          break;
        }
        default:
          break;
      }
    }

    void WIRE_RANGE;
    return changed;
  }

  /**
   * 门类负载：通电即开、断电即关（门 / 活板门 / 栅栏门共用）。
   *
   * ⚠️ 门是**两格**的：红石通常只贴在下半格旁边，上半格自己的 `input` 是 0，
   * 分开判就会得到"上半开着、下半关着"的半扇门。所以：
   *  - 上半格直接跳过（由下半格负责改写两格）
   *  - 下半格依据自己的输入决定开合，然后把上半格设成同一个开合状态
   * 上半格还必须与下半格是**同一种门**，否则会出现"云杉门配橡木门"这种脏数据。
   *
   * @returns 是否改了东西（调用方据此置 `changed`）
   */
  private applyOpenableLoad(
    world: RedstoneWorld,
    x: number,
    y: number,
    z: number,
    id: number,
    state: number,
    shape: string,
    input: number,
  ): boolean {
    const wantOpen = input > 0;

    if (shape === 'door') {
      if (isDoorUpper(state)) return false;
      const paired = world.getBlock(x, y + 1, z) === id;
      if (isDoorOpen(state) === wantOpen) return false;
      world.setState(x, y, z, withDoorOpen(state, wantOpen));
      if (paired) {
        // 上半格：保持"上"位、跟随下半格的开合
        const upperState = withDoorOpen(world.getState(x, y + 1, z), wantOpen);
        world.setState(x, y + 1, z, withDoorUpper(upperState, true));
      }
      this.markDirty(x, y, z);
      return true;
    }

    if (shape === 'trapdoor') {
      if (isTrapdoorOpen(state) === wantOpen) return false;
      world.setState(x, y, z, withTrapdoorOpen(state, wantOpen));
      this.markDirty(x, y, z);
      return true;
    }

    if (isFenceGateOpen(state) === wantOpen) return false;
    world.setState(x, y, z, withFenceGateOpen(state, wantOpen));
    this.markDirty(x, y, z);
    return true;
  }

  /**
   * 中继器 / 比较器 / 侦测器的输出：方向 + 强度（0 表示没有输出）。
   *
   * ⚠️ 三者的输出方向**不一样**：
   *  - 中继器、比较器：朝向那一侧输出（输入在背面）
   *  - 侦测器：**背面输出**（脸朝前检测方块变化，信号从背后出来）——原版如此
   */
  private componentOutput(
    world: RedstoneWorld,
    x: number,
    y: number,
    z: number,
    id: number,
    state: number,
  ): { dx: number; dz: number; strength: number } {
    const key = keyOf(x, y, z);
    const facing = facingOf(state);
    const front = FACING_OFFSET[facing]!;
    const back = FACING_OFFSET[(facing + 2) & 3]!;

    switch (id) {
      case Block.REPEATER: {
        const strength = (this.repeaterOutput.get(key) ?? false) ? 15 : 0;
        return { dx: front[0], dz: front[1], strength };
      }
      case Block.COMPARATOR: {
        // 简化：比较器把背面的输入强度直通到正面输出
        const strength = this.inputStrength(world, this.wirePower, x + back[0], y, z + back[1]);
        return { dx: front[0], dz: front[1], strength };
      }
      case Block.OBSERVER: {
        const strength = (this.observerPulses.get(key) ?? 0) > 0 ? 15 : 0;
        return { dx: back[0], dz: back[1], strength };
      }
      default:
        return { dx: 0, dz: 0, strength: 0 };
    }
  }

  /** 中继器/比较器的输入：只看朝向的反方向那一格（避免把自己的输出当输入） */
  private backInput(world: RedstoneWorld, strengths: Map<string, number>, x: number, y: number, z: number, state: number): number {
    const back = FACING_OFFSET[(facingOf(state) + 2) & 3]!;
    return this.inputStrength(world, strengths, x + back[0], y, z + back[1]);
  }

  /** 某个位置的输入强度：相邻粉的强度、相邻电源的 15、相邻中继器输出 */
  private inputStrength(world: RedstoneWorld, strengths: Map<string, number>, x: number, y: number, z: number): number {
    let best = strengths.get(keyOf(x, y, z)) ?? 0;
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const value = strengths.get(keyOf(nx, ny, nz));
      if (value !== undefined && value > best) best = value;
      // 相邻的红石块/火把/开着的拉杆可以直接充能（原版的"电源贴脸"）
      const id = world.getBlock(nx, ny, nz);
      if (id === Block.REDSTONE_BLOCK || id === Block.REDSTONE_TORCH) {
        if (best < 15) best = 15;
        continue;
      }
      if (id === Block.LEVER || id === Block.STONE_BUTTON || id === Block.OAK_BUTTON) {
        if (isPowered(world.getState(nx, ny, nz)) && best < 15) best = 15;
      }
      // 中继器/比较器的输出面紧贴负载时也算输入
      if (id === Block.REPEATER && (this.repeaterOutput.get(keyOf(nx, ny, nz)) ?? false)) {
        const facing = facingOf(world.getState(nx, ny, nz));
        const [fx, fz] = FACING_OFFSET[facing]!;
        if (nx + fx === x && nz + fz === z && best < 15) best = 15;
      }
    }
    return best;
  }

  /** 从 (x,y,z) 洪泛收集连通的红石元件 */
  private collect(world: RedstoneWorld, x: number, y: number, z: number): Set<string> {
    const visited = new Set<string>();
    const start: Node[] = [{ x, y, z }];
    // 起点可能不是红石元件（比如只是旁边的方块被挖了），先把邻域加进来
    for (const [dx, dy, dz] of NEIGHBORS) start.push({ x: x + dx, y: y + dy, z: z + dz });

    while (start.length > 0 && visited.size < MAX_NODES) {
      const node = start.pop()!;
      if (node.y < WORLD_MIN_Y || node.y >= WORLD_MAX_Y) continue;
      const key = keyOf(node.x, node.y, node.z);
      if (visited.has(key)) continue;
      const id = world.getBlock(node.x, node.y, node.z);
      if (!isRedstoneComponent(id)) continue;
      visited.add(key);
      for (const [dx, dy, dz] of NEIGHBORS) {
        const next = { x: node.x + dx, y: node.y + dy, z: node.z + dz };
        if (visited.has(keyOf(next.x, next.y, next.z))) continue;
        start.push(next);
      }
    }
    return visited;
  }

  // ---------------------------------------------------------------- 活塞

  /** 活塞伸出：把前方方块推走一格，然后放上活塞头 */
  private extendPiston(world: RedstoneWorld, x: number, y: number, z: number, _id: number, state: number): boolean {
    const [dx, dz] = FACING_OFFSET[facingOf(state)]!;
    const fx = x + dx;
    const fz = z + dz;
    const frontId = world.getBlock(fx, y, fz);

    if (frontId === Block.AIR) {
      world.setBlock(fx, y, fz, Block.PISTON_HEAD, withFacing(0, facingOf(state)));
      return true;
    }
    if (!canPush(frontId)) return false;

    const fx2 = fx + dx;
    const fz2 = fz + dz;
    if (world.getBlock(fx2, y, fz2) !== Block.AIR) return false;

    // 先把被推的方块搬到前面，再放活塞头
    world.setBlock(fx2, y, fz2, frontId, world.getState(fx, y, fz));
    world.setBlock(fx, y, fz, Block.PISTON_HEAD, withFacing(0, facingOf(state)));
    this.markDirty(fx2, y, fz2);
    return true;
  }

  /** 活塞收回：撤掉活塞头；粘性活塞会把前方的方块拉回来 */
  private retractPiston(world: RedstoneWorld, x: number, y: number, z: number, id: number, state: number): boolean {
    const [dx, dz] = FACING_OFFSET[facingOf(state)]!;
    const hx = x + dx;
    const hz = z + dz;
    if (world.getBlock(hx, y, hz) !== Block.PISTON_HEAD) return false;

    world.setBlock(hx, y, hz, Block.AIR, 0);

    if (id === Block.STICKY_PISTON) {
      const px = hx + dx;
      const pz = hz + dz;
      const pulled = world.getBlock(px, y, pz);
      if (pulled !== Block.AIR && canPush(pulled)) {
        world.setBlock(hx, y, hz, pulled, world.getState(px, y, pz));
        world.setBlock(px, y, pz, Block.AIR, 0);
        this.markDirty(px, y, pz);
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- 侦测器

  /** 有方块变化时，通知朝向它的侦测器发一个短脉冲 */
  private triggerObservers(world: RedstoneWorld, x: number, y: number, z: number): void {
    for (const [dx, dy, dz] of NEIGHBORS) {
      const ox = x + dx;
      const oy = y + dy;
      const oz = z + dz;
      if (world.getBlock(ox, oy, oz) !== Block.OBSERVER) continue;
      const state = world.getState(ox, oy, oz);
      const [fx, fz] = FACING_OFFSET[facingOf(state)]!;
      // 侦测器的"脸"朝向被观察的方块
      if (ox + fx !== x || oz + fz !== z) continue;
      const key = keyOf(ox, oy, oz);
      this.observerPulses.set(key, OBSERVER_PULSE);
      world.setState(ox, oy, oz, withPowered(state, true));
      this.markDirty(ox, oy, oz);
    }
  }
}

// ---------------------------------------------------------------- 工具

const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function parseKey(key: string): [number, number, number] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** 活塞能推动的方块：实心整方块，且不是基岩/黑曜石/活塞自身 */
export function canPush(id: number): boolean {
  if (id === Block.AIR) return false;
  if (
    id === Block.BEDROCK ||
    id === Block.OBSIDIAN ||
    id === Block.PISTON ||
    id === Block.STICKY_PISTON ||
    id === Block.PISTON_HEAD
  ) {
    return false;
  }
  const def = blockDef(id);
  return def.solid && def.shape === 'cube' && !def.liquid;
}

/** 中继器延迟档位（0~3 → 1~4 红石刻） */
function delayTicksOf(state: number): number {
  return (state >> 4) & 0b11;
}

/** 查询某格红石粉的强度（0 表示没电；调试面板与测试用） */
export function wirePowerOf(engine: RedstoneEngine, x: number, y: number, z: number): number {
  return engine.wirePower.get(keyOf(x, y, z)) ?? 0;
}
