/**
 * 玩家物理
 *
 * 数值对齐原版（换算成"每秒"单位；原版以 1/20 秒为 1 tick）：
 *   走路 4.317 m/s · 疾跑 5.612 m/s · 潜行 1.295 m/s · 游泳 2.2 m/s
 *   重力 32 m/s²（原版 0.08/tick²）· 起跳初速 8.95 m/s（跳跃高度约 1.25 格）
 *   终端速度 78 m/s
 *
 * 碰撞解析：逐轴移动 + 立即推出；水平被挡时尝试抬高 0.6 格（自动上台阶），
 * 与"直接走过去就能上台阶"的原版行为一致。
 */

import { boxAt, collides, intersects, makeAABB, resolveVertical, translate, type CollisionWorld } from './AABB.ts';

export const WALK_SPEED = 4.317;
export const SPRINT_SPEED = 5.612;
export const SNEAK_SPEED = 1.295;
export const SWIM_SPEED = 2.2;
/** 水中按住潜行的下潜速度（格/秒） */
export const SWIM_DIVE_SPEED = 1.6;
/** 下潜速度的收敛加速度（让"松手"平滑一点，不要一下子停住） */
const SWIM_DIVE_ACCEL = 10;
/** 水里什么都不按时**被动下沉**的速度（格/秒）——比主动下潜慢，否则"下潜"没有意义 */
const PASSIVE_SINK_SPEED = -0.8;
export const FLY_SPEED = 10.9;
export const FLY_SPRINT_SPEED = 21.8;

const GRAVITY = 32;
const JUMP_VELOCITY = 8.95;
const TERMINAL_VELOCITY = 78;
/**
 * 冲刺跳的额外水平初速（格/秒，F3 尾巴）。
 *
 * 原版是"在起跳那一 tick 把水平速度顶到 0.2 格/tick 以上"（≈ 4 格/秒），
 * 这里取 2.2：叠加在疾跑速度（5.6）上会瞬间到 7.8，随后按空气阻力收敛回 5.6——
 * 观感就是"跳出去那一下明显更远"，但不至于像被弹射。
 */
export const SPRINT_JUMP_BOOST = 2.2;
/** 潜行防掉落的探测深度（格）：比一帧的重力位移小，又能探到半砖 */
const SNEAK_PROBE = 0.08;

// ---- 攀爬（B11：梯子 / 藤蔓 / 锁链）
/** 按住跳跃时的上升速度（格/秒，≈ 原版爬梯） */
const CLIMB_UP_SPEED = 2.35;
/** 按住潜行时的下降速度 */
const CLIMB_DOWN_SPEED = 1.2;
/** 什么都不按时的下滑速度（原版是"慢慢往下溜"，不是自由落体） */
const CLIMB_SLIDE_SPEED = 0.6;
/** 攀爬时竖直速度的收敛加速度 */
const CLIMB_ACCEL = 30;

/** 单次步进的最大位移，超过就拆成多步，避免高速穿透薄墙 */
const MAX_STEP = 0.4;
/** 蛛网里的水平速度系数（批次 441） */
export const COBWEB_SPEED_FACTOR = 0.25;
/** 爬行的前瞻距离（格）：比半个身位略远一点，走到洞口前一两帧就开始爬 */
const CRAWL_PROBE = 0.45;

export interface PlayerInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface PhysicsWorld extends CollisionWorld {
  isLiquid(x: number, y: number, z: number): boolean;
  /**
   * 这一格能不能攀爬（梯子 / 藤蔓 / 锁链）。
   *
   * 做成**可选**成员：老的 stub 世界（各种离线测试）不必为它改动，
   * 不提供时一律按"不能攀爬"处理——与 `TickWorld` 的 `skyLightAt` / `raining` 同一个套路。
   */
  isClimbable?(x: number, y: number, z: number): boolean;
  /**
   * 这一格是不是蛛网（批次 441）：能穿过去，但**水平速度只剩 1/4**。
   * 可选——不给就是不减速（假世界不必都实现它）。
   */
  isCobweb?(x: number, y: number, z: number): boolean;
  /**
   * 这一格是不是"贴上去会掉血"的方块（目前只有仙人掌，批次 222）。
   *
   * 自动跳跃用它避让：默认开着的自动跳跃会把 1 格高的障碍当台阶跳上去，
   * 而仙人掌是**踩不得**的——跳上去/掉下来这一套动作会让视角一格一格地上下弹，
   * 玩家看到的就是"顶着仙人掌一直抖"。同样做成可选成员，老 stub 世界不用改。
   */
  isHazardous?(x: number, y: number, z: number): boolean;
  /**
   * 这一格的水把实体往哪推（F9 尾巴，批次 447）。
   *
   * 可选成员：老的 stub 世界不必实现，不给就是"水不推人"。
   * 判据收在 `world/FluidFlow.ts`（纯函数），物理层只负责把返回的
   * **目标速度偏移**折进这一帧的速度里。
   */
  waterFlow?(x: number, y: number, z: number): { x: number; y: number; z: number } | null;
}

function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

export class PlayerPhysics {
  x = 0;
  y = 80;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;

  onGround = false;
  inWater = false;
  /**
   * 这一帧是不是刚触发了**自动跳跃**（批次 222，给诊断日志用）。
   *
   * 每帧开头复位：主程序读它就能在"视角莫名其妙上下弹"时确认是不是自动跳跃
   * 在反复起跳（真机日志里 `input/autoJump` 连成一串就是这个原因）。
   */
  autoJumped = false;
  /** 是否正贴着可攀爬方块（梯子 / 藤蔓 / 锁链，B11） */
  onClimbable = false;
  /** 摔落起始高度；落地时用于计算摔落伤害（生存系统接入后使用） */
  fallStartY: number | null = null;
  /**
   * 上一次落地时的**下落速度**（正数，格/秒；批次 120）。
   *
   * 存在的理由很具体：粘液块要按"撞上去有多快"决定弹多高，而落地那一瞬间
   * `vy` 会被清零（见 `moveY`），所以只能在清之前记一份。
   * 只有主程序读它（弹跳那一段），别的地方别拿它当"当前速度"。
   */
  lastLandingSpeed = 0;

  readonly width = 0.6;
  readonly stepHeight = 0.6;

  /**
   * 站立高度与潜行高度（F9，批次 404）。原版分别是 1.8 与 1.5。
   *
   * 为什么这 0.3 格值得单独做：它决定"能不能钻进 1.5 格高的缝"——
   * 矿洞里那些"上面一格是半砖/楼梯"的通道，站立态是过不去的，
   * 而原版玩家蹲一下就过去了。之前这里写死 1.8，表现是"蹲着也钻不过去"。
   */
  readonly standHeight = 1.8;
  readonly sneakHeight = 1.5;

  /** 脚下到眼睛的高度：站立 1.62、潜行 1.27（原版数值；视角跟着一起降才像蹲着） */
  readonly standEyeHeight = 1.62;
  readonly sneakEyeHeight = 1.27;

  /**
   * 当前是否蹲着。
   *
   * 两个来源：**按住潜行**，或**头顶空间不够、站不起来**
   * （原版也是这个行为——钻进 1.5 格的洞之后松开潜行不会穿进天花板）。
   * 每帧在 `update()` 开头重算，别的地方只读。
   */
  crouching = false;

  /**
   * 爬行高度（F9，批次 430）：0.6 格，能钻**一格高**的洞。
   *
   * 与潜行的区别不是"再矮一点"：潜行是**主动姿态**，爬行是**被迫姿态**
   * （头顶连 1.5 都放不下时才有），而且它要能"从外面钻进 1 格高的洞"——
   * 所以判定里带了**前瞻**：想往哪走就看那一格站不站得下 1.5，站不下但放得下 0.6 就爬。
   */
  readonly crawlHeight = 0.6;
  readonly crawlEyeHeight = 0.6;

  /** 当前是否在爬（比潜行更矮；只能从"头顶放不下 1.5"或"前方洞口太矮"两种情况进入） */
  crawling = false;

  /** 碰撞盒高度（跟着姿态走）。所有碰撞/挤缝判定都读这里，不要各自取常量 */
  get height(): number {
    if (this.crawling) return this.crawlHeight;
    return this.crouching ? this.sneakHeight : this.standHeight;
  }

  get eyeHeight(): number {
    if (this.crawling) return this.crawlEyeHeight;
    return this.crouching ? this.sneakEyeHeight : this.standEyeHeight;
  }

  get eyeY(): number {
    return this.y + this.eyeHeight;
  }

  box(): ReturnType<typeof makeAABB> {
    return boxAt(this.x, this.y, this.z, this.width, this.height);
  }

  /** 相机所处的水平方向（yaw 为弧度，0 表示朝向 -Z） */
  /**
   * @param speedMultiplier 移速倍率（状态效果：速度/缓慢）
   * @param jumpMultiplier 起跳倍率（状态效果：跳跃提升）
   */
  update(
    world: PhysicsWorld,
    input: PlayerInput,
    yaw: number,
    dt: number,
    flying: boolean,
    speedMultiplier = 1,
    jumpMultiplier = 1,
    autoJump = false,
  ): void {
    this.autoJumped = false;

    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    // 朝向向量：前 = (-sin, 0, -cos)
    let dirX = -sin * input.forward + cos * input.strafe;
    let dirZ = -cos * input.forward - sin * input.strafe;
    const dirLength = Math.hypot(dirX, dirZ);
    if (dirLength > 1e-6) {
      dirX /= dirLength;
      dirZ /= dirLength;
    } else {
      dirX = 0;
      dirZ = 0;
    }

    this.inWater = world.isLiquid(Math.floor(this.x), Math.floor(this.y + 0.4), Math.floor(this.z));

    // 姿态（F9，批次 404 / 430）：三层判定，顺序不能换。
    //  ① 头顶放得下 1.8 吗？放不下 → 站起来会卡进天花板，必须蹲着；
    //  ② 头顶放得下 1.5 吗？放不下 → 只能爬（0.6）；
    //  ③ **前瞻**：想往前走、但前方那一格连 1.5 都放不下而 0.6 放得下
    //     （按住潜行时才生效）→ 现在就开始爬，否则人会被洞口挡在外面永远进不去。
    const canStand = this.hasRoom(world, this.standHeight);
    const canSneak = this.hasRoom(world, this.sneakHeight);
    let aheadCrawl = false;
    if (input.sneak && dirLength > 1e-6) {
      const probeX = this.x + dirX * CRAWL_PROBE;
      const probeZ = this.z + dirZ * CRAWL_PROBE;
      aheadCrawl = !this.hasRoomAt(world, probeX, probeZ, this.sneakHeight) && this.hasRoomAt(world, probeX, probeZ, this.crawlHeight);
    }
    this.crawling = !canSneak || aheadCrawl;
    this.crouching = input.sneak || !canStand || this.crawling;

    // 攀爬（B11）：脚下那一格或身体中段那一格是梯子/藤蔓/锁链，就算"贴住了"。
    // 采两个点是为了照顾"人站在梯子底部、身体只有上半段挨着"的情况。
    const px = Math.floor(this.x);
    const pz = Math.floor(this.z);
    this.onClimbable =
      !flying &&
      !this.inWater &&
      (world.isClimbable?.(px, Math.floor(this.y + 0.1), pz) === true ||
        world.isClimbable?.(px, Math.floor(this.y + 1.0), pz) === true);

    const baseSpeed = flying
      ? input.sprint
        ? FLY_SPRINT_SPEED
        : FLY_SPEED
      : this.inWater
        ? SWIM_SPEED
        : input.sneak
          ? SNEAK_SPEED
          : input.sprint
            ? SPRINT_SPEED
            : WALK_SPEED;
    // 蛛网（批次 441）：原版是"陷在里面动不了"，这里退化成**水平速度 ×0.25**——
    // 真按原版做需要"每 tick 把速度清零"，那样玩家在网里会完全推不动，
    // 在没有"挖掉网"这条交互之前会显得像卡死。×0.25 已经能明显感觉到"被粘住"。
    const inCobweb =
      !flying && world.isCobweb?.(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z)) === true;
    const speed = baseSpeed * speedMultiplier * (inCobweb ? COBWEB_SPEED_FACTOR : 1);

    const accelerate = flying ? 90 : this.onGround ? 48 : 10;
    /**
     * 水流推动（F9 尾巴，批次 447）。
     *
     * 折进**目标速度**而不是每帧加一个增量：`approach` 下一帧就会把增量拉回去，
     * 那样"站在水流里"的表现会和静水一模一样（这一条在实现时先写错过一次）。
     * 逆流时玩家的游泳速度仍然大于它，所以还能前进——与原版一致。
     */
    const flow = this.inWater && !flying ? (world.waterFlow?.(this.x, this.y + 0.4, this.z) ?? null) : null;
    this.vx = approach(this.vx, dirX * speed + (flow?.x ?? 0), accelerate * dt);
    this.vz = approach(this.vz, dirZ * speed + (flow?.z ?? 0), accelerate * dt);

    if (flying) {
      const vertical = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      this.vy = approach(this.vy, vertical * speed * 0.85, 90 * dt);
      this.onGround = false;
      this.fallStartY = null;
    } else if (this.onClimbable) {
      // 攀爬：按跳跃往上、按潜行往下、什么都不按就慢慢往下滑（原版手感）
      const target = input.jump ? CLIMB_UP_SPEED : input.sneak ? -CLIMB_DOWN_SPEED : -CLIMB_SLIDE_SPEED;
      this.vy = approach(this.vy, target, CLIMB_ACCEL * dt);
      // 贴在梯子上往下滑**不算摔落**：否则从梯子上溜下来会摔伤
      this.fallStartY = null;
    } else if (this.inWater) {
      // 被动下沉：**收敛到 -0.8**，不是按重力一直加速。
      // 原来这里是 `vy -= GRAVITY * 0.25 * dt`，60 帧能掉到 -4——比"主动下潜"还快，
      // 于是"按潜行往下去"反而比"不动"更慢，一测就露馅（批次 428 的断言抓到的）。
      // 水柱（上方也是水）把目标下沉速度再压低一点，"站在瀑布下"才看得出来
      this.vy = approach(this.vy, PASSIVE_SINK_SPEED + (flow?.y ?? 0), 6 * dt);
      if (input.jump) {
        // 上浮（原版：水里按跳跃=往上划）
        this.vy = 3.4 * jumpMultiplier;
      } else if (input.sneak) {
        // **下潜**（F9，批次 428）：按住潜行往下划。原版就是这个键位，
        // 之前没接，表现是"在水里只能往上、想潜下去只能等慢慢沉"（0.25 重力，很慢）。
        // 用 `approach` 而不是直接赋速度：松手时不会突然停住，手感与攀爬那段一致。
        this.vy = approach(this.vy, -SWIM_DIVE_SPEED, SWIM_DIVE_ACCEL * dt);
      }
      if (this.vy < -4) this.vy = -4;
      this.fallStartY = null;
    } else {
      // 自动跳跃（设置项，批次 206）：走路顶到一格高的台阶时自己起跳。
      // 与"上台阶"（0.6 格）互补：0.6 以内的雪层/台阶仍由 `tryStepUp` 悄悄走上去，
      // 这里只负责整格高的那一档；两格高的墙不会触发（跳上去也站不住）。
      if (autoJump && this.onGround && input.jump === false && dirLength > 1e-6) {
        if (this.canAutoJump(world, dirX, dirZ)) {
          this.vy = JUMP_VELOCITY * jumpMultiplier;
          this.onGround = false;
          this.autoJumped = true;
        }
      }
      if (input.jump && this.onGround) {
        this.vy = JUMP_VELOCITY * jumpMultiplier;
        // 冲刺跳（F3 尾巴）：起跳那一帧沿**输入方向**再补一点水平速度。
        // 用输入方向而不是当前速度方向：贴着墙起跳时速度可能已经被撞没了，
        // 但玩家想要的仍然是"朝我按的方向跳出去"。
        if (input.sprint && dirLength > 1e-6) {
          this.vx += dirX * SPRINT_JUMP_BOOST;
          this.vz += dirZ * SPRINT_JUMP_BOOST;
        }
        this.onGround = false;
      }
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL_VELOCITY) this.vy = -TERMINAL_VELOCITY;
    }

    // 潜行防掉落（F3 尾巴）：贴着边缘时不许把自己走出去。
    // 分轴判断，所以"沿着边缘横着走"仍然可以（原版手感：能贴着坑边挪）。
    // ⚠️ 只在"当前有支撑"时生效：否则从半空潜行下落时会被莫名其妙钉住。
    if (!flying && !this.inWater && input.sneak && this.onGround && this.hasSupportAt(world, this.x, this.z)) {
      const stepX = this.vx * dt;
      const stepZ = this.vz * dt;
      if (stepX !== 0 && !this.hasSupportAt(world, this.x + stepX, this.z)) this.vx = 0;
      if (stepZ !== 0 && !this.hasSupportAt(world, this.x, this.z + stepZ)) this.vz = 0;
    }

    this.move(world, this.vx * dt, this.vy * dt, this.vz * dt);
  }

  /**
   * 站直所需的空间够不够（F9，批次 404）。
   *
   * 判据是"用**站立高度**造一个盒子，看它现在会不会撞进方块"：
   * 蹲在 1.5 格高的洞里时，站立盒子必然顶到天花板 → 站不起来 → 保持蹲姿。
   *
   * 两个数值上的讲究（都是踩过的坑）：
   *  - 起点抬 `+0.02`：站在地面上时 `y` 常常是 `2.99999…`，直接 `floor` 会把
   *    脚下那块地当成"挡住了"，于是人永远站不起来；
   *  - 终点收 `-0.02`：贴着天花板时同理，会把"刚好 1.5 格"判成过不去，
   *    而原版那 0.3 格的余量本来就该容得下。
   */
  private hasRoom(world: PhysicsWorld, height: number): boolean {
    return this.hasRoomAt(world, this.x, this.z, height);
  }

  /**
   * (x, z) 这一列、从脚底往上 `height` 的空间够不够。
   * 交给共享的 `collides`（它认台阶/楼梯那种非完整方块），自己写体素枚举
   * 会漏掉"天花板是半砖"的情况——而半砖天花板正是最常见的 1.5 格缝。
   */
  private hasRoomAt(world: PhysicsWorld, x: number, z: number, height: number): boolean {
    const box = boxAt(x, this.y + 0.02, z, this.width, height - 0.04);
    return !collides(world, box);
  }

  /**
   * 站在 (x, z) 时脚下有没有支撑（潜行防掉落的判据）。
   *
   * **四个角都要有**，而不是"整体框和地面有重叠就算"：后者会让玩家一直走到
   * 身体几乎全部悬空（框只剩一角压着方块）才停——那不是"防掉落"，是"延迟掉落"。
   * 四角探针让玩家停在"脚尖还在台上"的位置（中心约在方块边缘内 0.25 格）。
   */
  private hasSupportAt(world: PhysicsWorld, x: number, z: number): boolean {
    const half = this.width / 2 - 0.05;
    const probe = 0.05;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = x + sx * half;
        const cz = z + sz * half;
        const box = makeAABB(cx - probe, this.y - SNEAK_PROBE, cz - probe, cx + probe, this.y - 0.001, cz + probe);
        if (!collides(world, box)) return false;
      }
    }
    return true;
  }

  /**
   * 自动跳跃的判据（设置项，批次 206）：正前方半格处是不是"刚好一格、且上面站得下"。
   *
   * 只看**一列**（前方 0.6 格的方块坐标）就够了：
   *  - 顶面高出脚底 0.6 以内的（雪层 / 台阶）不算障碍，交给上台阶那条路；
   *  - 高出 1 格左右、且头顶（站上去之后 1.8 格）没有方块 → 值得跳；
   *  - 两格墙 / 一格高的洞 → 跳了也上不去，不跳（否则贴墙站着会一直原地蹦）；
   *  - **贴着会掉血的方块（仙人掌）→ 不跳**（批次 222）：跳上去/掉下来会来回弹。
   */
  private canAutoJump(world: PhysicsWorld, dirX: number, dirZ: number): boolean {
    const bx = Math.floor(this.x + dirX * 0.6);
    const bz = Math.floor(this.z + dirZ * 0.6);
    const base = Math.floor(this.y + 0.02);
    let top: number | null = null;
    let hazard = false;

    for (let vy = base; vy <= base + 1; vy++) {
      const collision = world.collisionAt(bx, vy, bz);
      if (collision === null) continue;
      let blockTop = vy + 1;
      if (collision !== 'full') {
        blockTop = -Infinity;
        for (const local of collision) blockTop = Math.max(blockTop, vy + local[4]);
        if (!Number.isFinite(blockTop)) continue;
      }
      if (blockTop > this.y + this.stepHeight + 0.02 && blockTop <= this.y + 1.15) {
        top = Math.max(top ?? -Infinity, blockTop);
        if (world.isHazardous?.(bx, vy, bz) === true) hazard = true;
      }
    }
    if (top === null || hazard) return false;

    // 站上去之后身体占的那几格必须是空的
    const headFrom = Math.floor(top + 0.02);
    const headTo = Math.floor(top + this.height - 0.02);
    for (let vy = headFrom; vy <= headTo; vy++) {
      if (world.collisionAt(bx, vy, bz) !== null) return false;
    }
    return true;
  }

  private move(world: PhysicsWorld, dx: number, dy: number, dz: number): void {
    const distance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.max(1, Math.ceil(distance / MAX_STEP));
    const stepX = dx / steps;
    const stepY = dy / steps;
    const stepZ = dz / steps;

    for (let i = 0; i < steps; i++) {
      this.moveY(world, stepY);

      if (this.onGround && (stepX !== 0 || stepZ !== 0)) {
        const beforeX = this.x;
        const beforeZ = this.z;
        this.moveX(world, stepX);
        this.moveZ(world, stepZ);

        const wantedX = Math.abs(stepX);
        const wantedZ = Math.abs(stepZ);
        const blockedX = wantedX > 1e-6 && Math.abs(this.x - beforeX) < wantedX * 0.5;
        const blockedZ = wantedZ > 1e-6 && Math.abs(this.z - beforeZ) < wantedZ * 0.5;

        if (blockedX || blockedZ) {
          this.tryStepUp(world, beforeX, beforeZ, stepX, stepZ);
        }
      } else {
        this.moveX(world, stepX);
        this.moveZ(world, stepZ);
      }
    }
  }

  /** 水平被挡时：抬高一个台阶再尝试，成功则整体位移到台阶上 */
  private tryStepUp(world: PhysicsWorld, beforeX: number, beforeZ: number, stepX: number, stepZ: number): void {
    const savedY = this.y;

    this.y += this.stepHeight;
    if (collides(world, this.box())) {
      this.y = savedY;
      return;
    }

    // 抬高后重新尝试水平移动
    this.x = beforeX;
    this.z = beforeZ;
    this.moveX(world, stepX);
    this.moveZ(world, stepZ);

    if (Math.abs(this.x - beforeX) < 1e-6 && Math.abs(this.z - beforeZ) < 1e-6) {
      this.x = beforeX;
      this.z = beforeZ;
      this.y = savedY;
      return;
    }

    // 向下吸附到台阶面
    this.snapDown(world);
  }

  /** 从当前位置向下微调，直到踩到地面（最多 stepHeight） */
  private snapDown(world: PhysicsWorld): void {
    const limit = this.y - this.stepHeight - 0.05;
    const probe = 0.05;
    while (this.y > limit) {
      const next = translate(this.box(), 0, -probe, 0);
      if (collides(world, next)) {
        this.onGround = true;
        this.vy = 0;
        return;
      }
      this.y -= probe;
    }
  }

  private moveX(world: PhysicsWorld, amount: number): void {
    if (amount === 0) return;
    this.x += amount;
    if (!collides(world, this.box())) return;

    if (amount > 0) {
      this.x = Math.floor(this.x + this.width / 2) - this.width / 2 - 1e-4;
    } else {
      this.x = Math.floor(this.x - this.width / 2) + 1 + this.width / 2 + 1e-4;
    }
    this.vx = 0;
  }

  private moveZ(world: PhysicsWorld, amount: number): void {
    if (amount === 0) return;
    this.z += amount;
    if (!collides(world, this.box())) return;

    if (amount > 0) {
      this.z = Math.floor(this.z + this.width / 2) - this.width / 2 - 1e-4;
    } else {
      this.z = Math.floor(this.z - this.width / 2) + 1 + this.width / 2 + 1e-4;
    }
    this.vz = 0;
  }

  private moveY(world: PhysicsWorld, amount: number): void {
    if (amount === 0) return;
    const fromY = this.y;
    this.y += amount;

    if (!collides(world, this.box())) {
      if (amount < 0) this.onGround = false;
      return;
    }

    // ⚠️ 不能再用 `floor(y) + 1`：那只对**整格方块**成立。雪层（1/8）、台阶（1/2）、
    // 地毯、耕地这些非整格顶面会被顶到整格高度，下一帧重力又拉回来 ——
    // 玩家看到的就是"站在雪地上一直跳"（批次 206 修的）。这里二分找真实碰撞面。
    this.y = resolveVertical(
      world,
      (y) => boxAt(this.x, y, this.z, this.width, this.height),
      fromY,
      this.y,
    );

    if (amount < 0) {
      // 落地：**先记下落速度再清零**（批次 120）——粘液块要按"撞上去有多快"决定弹多高，
      // 而清零之后这一帧就再也读不到它了（`lastLandingSpeed` 只有主程序读）
      this.lastLandingSpeed = -this.vy;
      this.onGround = true;
    }
    this.vy = 0;
  }

  /** 传送到指定位置并清空速度（出生点、调试用） */
  teleport(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.onGround = false;
    this.fallStartY = null;
  }

  /** 视线方向（由 yaw/pitch 推出） */
  static lookDirection(yaw: number, pitch: number): [number, number, number] {
    const cosPitch = Math.cos(pitch);
    return [-Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];
  }

  /**
   * 指定方块是否与玩家碰撞体相交。
   * 用于阻止"把方块放在自己身上"导致卡住。
   */
  blockIntersects(x: number, y: number, z: number): boolean {
    return intersects(this.box(), makeAABB(x, y, z, x + 1, y + 1, z + 1));
  }
}
