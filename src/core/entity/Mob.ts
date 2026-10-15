/**
 * 生物基类
 *
 * 一个生物 = 属性表（MobType）+ 一套通用行为：
 *  - 重力与逐轴碰撞（复用掉落物那套 moveBody）
 *  - **敌对生物**：发现玩家 → 每 0.5 秒重新寻路 → 沿路径靠近 → 进入攻击距离就出手
 *  - **被动生物**：每几秒随机换个方向游荡，并主动避开 ≥3 格的落差（不会成片跳崖自杀）
 *  - 受伤：0.5 秒无敌帧 + 击退 + 短暂红闪；生命归零后掉落物品
 *
 * 生物的高低不同（鸡 0.7 格、牛 1.4 格），寻路的"身体高度"因此按体型算格数，
 * 矮生物能钻过 1 格高的洞，高生物必须要 2 格。
 */

import { Entity, type EntityContext } from './Entity.ts';
import { moveBody } from '../physics/EntityMotion.ts';
import { woolId } from '../registry/blocks.ts';
import { Item } from '../registry/items.ts';
import { StatusEffects } from '../survival/StatusEffects.ts';
import { Pathfinder, type PathPoint } from './Pathfinder.ts';

/** 与玩家一致的常量（原版数值） */
/** 苦力怕引信时长（秒） */
/**
 * 剪过之后羊毛长回来的时间（秒）。
 * 原版是"吃草长回来"，我们没有啃草皮这件事，用计时器代替。
 */
export const WOOL_REGROW_SECONDS = 30;

export const CREEPER_FUSE_TIME = 1.5;

/** 手上的食物能把动物引过来的距离（格，原版约 8 格） */
export const TEMPT_RANGE = 8;
/** 引到这么近就停下来（否则动物会一直顶着玩家推） */
export const TEMPT_FOLLOW_STOP = 1.6;

/** 幼体的体型比例（原版大约是一半） */
export const BABY_SCALE = 0.55;
/**
 * 幼体长成成年需要的时间（秒）。
 * ⚠️ 原版是 20 分钟，这里缩到 5 分钟——单机验收场景下 20 分钟太久，
 * 而"能不能长大"这件事本身没有别的观测手段。
 */
export const BABY_GROW_SECONDS = 300;
/** 求爱持续时长（秒，原版 30 秒） */
export const LOVE_SECONDS = 30;
/** 繁殖后的冷却（秒，原版 5 分钟，这里同样缩短） */
export const BREED_COOLDOWN_SECONDS = 60;
/** 求爱时靠多近才能配对（格） */
export const MATE_RANGE = 2.5;
/** 求爱时能"看见"配偶的距离（格） */
export const MATE_SEARCH_RANGE = 8;

/**
 * 鸡下蛋的间隔（秒）：原版是 5~10 分钟一个蛋（`6000~12000` tick）。
 * 鸡蛋在生存里的**唯一来源**就是这里，所以这个节奏不能"为了好测"改短——
 * 改了就等于凭空提高产蛋率。
 */
export const EGG_LAY_INTERVAL_MIN = 300;
export const EGG_LAY_INTERVAL_MAX = 600;
/** 状态效果的结算频率（秒）：与玩家的状态效果同频（20Hz） */
const EFFECT_STEP = 0.05;

const GRAVITY = 32;
const JUMP_SPEED = 8.95;
/** 受击后的无敌时间（秒） */
const HURT_COOLDOWN = 0.5;

export interface MobDrop {
  itemId: number;
  min: number;
  max: number;
  /** 掉落概率 0-1（不填视为 1） */
  chance?: number;
}

/**
 * 生物家族：只用于附魔的分流（亡灵杀手 / 节肢杀手）。
 * 原版是给每种生物打 `#undead` / `#arthropod` 标签，这里在种类表上写一个字段就够了。
 */
export type MobFamily = 'undead' | 'arthropod';

/** 生物种类定义（数据表在 mobs.ts） */
export interface MobType {
  id: string;
  name: string;
  health: number;
  /** 碰撞盒（宽 = 深） */
  width: number;
  height: number;
  /** 常规移动速度（格/秒） */
  speed: number;
  /** 敌对生物会主动追玩家并攻击 */
  hostile: boolean;
  attackDamage: number;
  /** 发现玩家的距离（格） */
  followRange: number;
  drops: readonly MobDrop[];
  /** 击杀经验（原版数值：敌对 5 点、被动 1~3 点） */
  xp: number;
  /**
   * 喂什么能繁殖（J8）。留空表示这种生物不参与繁殖（敌对生物都是空的）。
   *
   * ⚠️ 与原版的差异：原版是小麦（牛羊）/胡萝卜（猪）/种子（鸡），
   * 但**耕作系统还没做**，这些作物在游戏里根本不存在（连小麦物品都没有）。
   * 所以先用现有的植物性物品代替，等 H6/H7 耕作落地后把这里换回原版即可——
   * 换的只是这一行数据，繁殖逻辑不用动。
   */
  feed?: number;
  /**
   * 死亡时按**自己身上的颜色**掉羊毛（J8，羊用）。
   * 羊毛不在 `drops` 表里，因为颜色是每只动物各自的——写死在表里就只能掉白色的。
   * 被剪过的羊不掉羊毛（原版行为）。
   */
  wool?: boolean;
  /** 能不能挤奶（J8，牛用）。原版只有牛与山羊可以 */
  milk?: boolean;
  /** 会不会下蛋（K4 尾巴，鸡用）。鸡蛋在生存里的唯一来源 */
  laysEggs?: boolean;
  /** 生物家族（亡灵 / 节肢）；蜘蛛还没做，所以目前只有亡灵有成员 */
  family?: MobFamily;
  /**
   * 远程攻击配置（J9，骷髅用）。不填就是近战。
   *
   * 有它的生物**不再贴身近战**：进入 `range` 就放箭，同时保持 `keepDistance` 以上的距离
   * （原版骷髅就是这样——贴脸它反而会后退）。
   */
  ranged?: {
    /** 有效射程（格） */
    range: number;
    /** 两箭之间的间隔（秒，实际会再加一点随机抖动） */
    cooldown: number;
    /** 箭的初速（格/秒） */
    speed: number;
    /** 保持的最小距离（格），太近就后退 */
    keepDistance: number;
    /** 射击散布（弧度，0 = 百发百中） */
    spread: number;
  };
  /** 渲染用的主色 / 点缀色 */
  bodyColor: number;
  accentColor: number;
  /** 眼睛高度（渲染用） */
  eyeHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class Mob extends Entity {
  readonly type: MobType;

  health: number;
  /** 朝向（渲染用） */
  yaw = 0;
  /** 受击红闪剩余时间 */
  hitFlash = 0;
  /**
   * 幼体（J8）：体型按 `BABY_SCALE` 缩小、**不产出任何掉落与经验**、`BABY_GROW_SECONDS` 后长大。
   */
  baby = false;

  /** 求爱剩余秒数（>0 表示正在找配偶）与两次繁殖之间的冷却 */
  private loveTimer = 0;
  private breedCooldown = 0;
  /** 幼体的成长计时 */
  private growTimer = BABY_GROW_SECONDS;
  /** 被喂食加速成长的次数（原版喂食能缩短 10% 的成长时间） */
  private fedCount = 0;

  /**
   * 羊毛颜色（`DYE_COLORS` 的下标）与"是否已被剪"（J8，目前只有羊用）。
   *
   * 与原版的差异：原版羊要**吃草**才长回羊毛，我们没有"啃草皮"这件事，
   * 用 30 秒计时器代替——不然剪完一次这只羊就废了。
   */
  woolColor = 0;
  sheared = false;
  private woolTimer = 0;

  /**
   * 着火剩余秒数（J9 的火矢用它）。
   *
   * 着火伤害**不走 `hurt()`**：那样会被 0.5 秒的无敌帧卡成"每 0.5 秒掉 1 点"，
   * 而原版是每 20 tick（1 秒）掉 1 点、且不吃击退。所以单独攒一个计时器。
   */
  burnTime = 0;

  private burnTick = 0;
  /** 远程生物的移动方向（保持距离用）与"正在拉开"标记 */
  private moveDirX = 0;
  private moveDirZ = 0;
  private retreating = false;
  /** 距离下一次放箭还有多久 */
  private rangedTimer = 0;
  private hurtTime = 0;
  private attackCooldown = 0;
  /** 苦力怕的引信（秒）：贴到玩家身上开始点燃，1.5 秒后炸 */
  private fuse = 0;
  private jumpCooldown = 0;

  /**
   * 身上的状态效果（K4 尾巴：喷溅药水的对象）。
   *
   * 直接复用玩家那套 `StatusEffects`（它不依赖任何其它模块），于是
   * "缓慢 -15%/级""中毒每 25 tick 掉 1 点""力量 +3 点""瞬间伤害 6 点"这些数值**只有一份**——
   * 否则同一瓶药水砸玩家和砸僵尸会是两种效果。
   */
  readonly effects = new StatusEffects();
  /** 效果按 20Hz 推进，这里攒时间片（与玩家那边的结算频率一致） */
  private effectAccumulator = 0;
  /** 下蛋倒计时（秒，仅 `type.laysEggs` 用）；初值随机是为了让一群鸡不要齐刷刷下蛋 */
  private eggTimer = EGG_LAY_INTERVAL_MIN + Math.random() * (EGG_LAY_INTERVAL_MAX - EGG_LAY_INTERVAL_MIN);

  private path: PathPoint[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private wanderTimer = 0;
  private wanderYaw = 0;
  /** 游荡时是否停下（一部分时间站着不动，比一直乱走自然） */
  private idle = false;

  private readonly pathfinder: Pathfinder;
  private sampleBlock: ((x: number, y: number, z: number) => number) | null = null;

  constructor(type: MobType, x: number, y: number, z: number) {
    super(x, y, z, type.width, type.height);
    this.type = type;
    this.health = type.health;
    // 寻路器只需要"读方块"这一点能力，直接转发给每帧传入的上下文
    this.pathfinder = new Pathfinder({ getBlock: (bx, by, bz) => this.sampleBlock?.(bx, by, bz) ?? 0 });
  }

  /** 寻路用的身体高度（格） */
  private get bodyBlocks(): number {
    return this.type.height > 1.2 ? 2 : 1;
  }

  tick(ctx: EntityContext, dt: number): void {
    this.age += dt;
    this.sampleBlock = ctx.getBlock;

    if (this.hurtTime > 0) this.hurtTime -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.sheared) {
      this.woolTimer -= dt;
      if (this.woolTimer <= 0) this.sheared = false;
    }
    if (this.baby) {
      this.growTimer -= dt;
      if (this.growTimer <= 0) {
        this.baby = false;
        // 长大后体型回到成年：碰撞盒也得跟着换，否则会卡在方块里
        this.width = this.type.width;
        this.height = this.type.height;
      }
    }
    if (this.loveTimer > 0) this.loveTimer -= dt;
    if (this.breedCooldown > 0) this.breedCooldown -= dt;
    this.tickBurning(dt);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    // 效果要在 AI 之前结算：缓慢/速度影响的正是这一帧的移动速度
    this.tickEffects(ctx, dt);
    this.tickEggLaying(ctx, dt);

    this.updateAi(ctx, dt);

    this.vy -= GRAVITY * dt;
    if (this.vy < -60) this.vy = -60;

    moveBody(ctx.world, this, this.vx * dt, this.vy * dt, this.vz * dt);

    // 掉出世界
    if (this.y < -80) this.dead = true;

    // 朝向跟着实际速度走
    if (Math.abs(this.vx) > 0.05 || Math.abs(this.vz) > 0.05) {
      this.yaw = Math.atan2(this.vx, this.vz);
    }

    // 被烧死的情况在 tickBurning 里只标了 dead，掉落要在这里补上——
    // 否则"用火矢烧死"会变成怪物凭空消失（比被砍死少一条掉落路径）
    if (this.dead && !this.lootDropped) {
      this.lootDropped = true;
      this.dropLoot(ctx);
    }
  }

  /** 掉落是否已结算（防止死亡与着火两条路径重复掉一份） */
  private lootDropped = false;

  /**
   * 状态效果结算（K4 尾巴）。
   *
   * 顺序与原版一致：**瞬间效果先结算**（瞬间治疗/伤害不进持续列表），
   * 之后每 0.05 秒推一次持续效果（中毒/凋零掉血、生命恢复回血、时长递减）。
   * ⚠️ **中毒不会致死**（原版停在 1 点血），凋零会——两者在 `StatusEffects` 里靠
   * `damageCause` 区分，这里不能只看 `damage > 0` 一刀切。
   */
  private tickEffects(ctx: EntityContext, dt: number): void {
    for (const instant of this.effects.takeInstant()) {
      // 瞬间治疗 I 回 4 点、II 回 8 点；瞬间伤害 I 打 6 点、II 打 12 点（原版数值）
      if (instant.id === 'instant_health') this.heal(4 * (instant.amplifier + 1));
      else this.hurt(6 * (instant.amplifier + 1), 0, 0, ctx);
    }

    if (this.effects.count === 0) {
      this.effectAccumulator = 0;
      return;
    }

    this.effectAccumulator += dt;
    while (this.effectAccumulator >= EFFECT_STEP) {
      this.effectAccumulator -= EFFECT_STEP;
      const result = this.effects.tick();
      if (result.damage > 0) {
        if (result.damageCause === 'poison') this.health = Math.max(1, this.health - result.damage);
        else this.hurt(result.damage, 0, 0, ctx);
      }
      if (result.heal > 0) this.heal(result.heal);
      if (this.dead) return;
    }
  }

  /** 回血（上限是本种生物的生命值；幼体的体型变小但生命上限不变，与原版不同，已在 K4 记档） */
  heal(amount: number): void {
    if (this.dead || amount <= 0) return;
    this.health = Math.min(this.type.health, this.health + amount);
  }

  /**
   * 只推一下、不造成伤害（雪球用）。
   *
   * 为什么不走 `hurt(0)`：`hurt` 对 `amount <= 0` 直接早退（那是"没造成伤害"的语义），
   * 连挨打动画都不会有。原版雪球是 0 伤害 + 有击退，所以需要这条独立路径。
   */
  push(knockbackX: number, knockbackZ: number): void {
    if (this.dead) return;
    const length = Math.hypot(knockbackX, knockbackZ);
    if (length <= 1e-4) return;
    this.vx += (knockbackX / length) * 3;
    this.vz += (knockbackZ / length) * 3;
    this.vy = Math.max(this.vy, 2.2);
    this.onGround = false;
  }

  /** 鸡下蛋（K4 尾巴）：鸡蛋的生存来源，原版节奏 5~10 分钟一个 */
  private tickEggLaying(ctx: EntityContext, dt: number): void {
    if (this.type.laysEggs !== true || this.baby || this.dead) return;
    this.eggTimer -= dt;
    if (this.eggTimer > 0) return;
    this.eggTimer = EGG_LAY_INTERVAL_MIN + Math.random() * (EGG_LAY_INTERVAL_MAX - EGG_LAY_INTERVAL_MIN);
    ctx.spawnDrop(Item.EGG, 1, this.x, this.y + this.height * 0.5, this.z);
  }

  private updateAi(ctx: EntityContext, dt: number): void {
    const player = ctx.player;
    const dx = player ? player.x - this.x : 0;
    const dz = player ? player.z - this.z : 0;
    const distanceSq = dx * dx + dz * dz;

    // 隐身的玩家不会被盯上（K4 尾巴）：已经追到一半的会停下来（下一帧就不满足条件了）
    const chasing =
      this.type.hostile &&
      player !== null &&
      ctx.playerInvisible !== true &&
      distanceSq <= this.type.followRange * this.type.followRange;

    // 被手里的食物吸引：玩家拿着它爱吃的东西走近，它会跟着走（原版行为）。
    // 放在"求爱"之前：正在被引的时候不会乱跑，但求爱仍然优先（毕竟那是在办事）
    // 幼体也认食物（原版小牛一样会跟，而且喂了能快点长大）
    if (!chasing && player && this.type.feed !== undefined) {
      const bait = ctx.heldItemId?.();
      const distance = Math.sqrt(distanceSq);
      if (bait !== undefined && bait === this.type.feed && distance < TEMPT_RANGE) {
        const length = Math.max(1e-4, distance);
        // 挨到 1.6 格以内就停下（否则会一直顶着玩家推）
        if (distance > TEMPT_FOLLOW_STOP) {
          this.moveDirX = dx / length;
          this.moveDirZ = dz / length;
        }
        this.yaw = Math.atan2(dx, dz);
        this.move(true, dt);
        return;
      }
    }

    // 求爱优先：在找配偶的这段时间里它只想找对象，别的行为都让位
    if (this.loveTimer > 0 && !this.baby && ctx.findMate && ctx.spawnBaby) {
      const mate = ctx.findMate(this);
      if (mate) {
        const dxm = mate.x - this.x;
        const dzm = mate.z - this.z;
        const distance = Math.hypot(dxm, dzm);
        if (distance <= MATE_RANGE) {
          // 两只都在求爱、而且挨够了近 → 生一只幼体
          this.breedWith();
          mate.breedWith();
          const bx = (this.x + mate.x) / 2;
          const bz = (this.z + mate.z) / 2;
          ctx.spawnBaby(this.type, bx, Math.min(this.y, mate.y), bz);
          ctx.spawnHearts?.(bx, Math.max(this.y, mate.y) + this.type.height, bz);
          return;
        }
        // 朝配偶走过去（直线，不走寻路：就几格距离，够用且不会抖）
        this.moveDirX = dxm / Math.max(1e-4, distance);
        this.moveDirZ = dzm / Math.max(1e-4, distance);
        this.yaw = Math.atan2(dxm, dzm);
        this.move(true, dt);
        return;
      }
      // 没找到对象：原地冒一会儿爱心再回去游荡（原版也会边冒边等）
      ctx.spawnHearts?.(this.x, this.y + this.type.height, this.z, 0.4);
    }

    // 远程生物走自己那套（保持距离 + 放箭），不参与近战的寻路追击
    if (chasing && player && this.type.ranged) {
      this.updateRangedAi(ctx, distanceSq, player, dt);
      this.move(true, dt);
      return;
    }

    if (chasing && player) {
      this.repathTimer -= dt;
      if (this.repathTimer <= 0 || this.path.length === 0) {
        this.repathTimer = 0.5 + Math.random() * 0.4;
        this.path =
          this.pathfinder.find(this.x, this.y, this.z, player.x, player.y, player.z, {
            heightBlocks: this.bodyBlocks,
          }) ?? [];
        this.pathIndex = 0;
      }

      if (this.type.id === 'creeper') {
        // 苦力怕不近战：贴到 3 格内点燃引信，1.5 秒后自爆（原版行为）
        // 已经炸过的就不再点火（实体通常立刻被移除，但测试里会继续 tick）
        if (this.dead) return;
        if (distanceSq < 9) {
          const wasIdle = this.fuse === 0;
          this.fuse += dt;
          if (wasIdle) {
            // 点燃的瞬间给个声响提示，否则玩家来不及跑
            ctx.playSound?.('fuse', this.x, this.y, this.z);
          }
          if (this.fuse >= CREEPER_FUSE_TIME) {
            ctx.explode?.(this.x, this.y + 0.5, this.z, 3);
            this.fuse = 0;
            this.dead = true;
          }
        } else if (this.fuse > 0) {
          // 玩家跑远了 → 引信熄灭（原版会回缩）
          this.fuse = Math.max(0, this.fuse - dt * 2);
        }
      } else if (distanceSq < 4 && this.attackCooldown <= 0) {
        // 贴脸就打（原版僵尸的触及距离约 2 格）
        this.attackCooldown = 1;
        // 力量/虚弱影响出手伤害（数值与玩家同源）；虚弱不能把伤害打成负数
        const damage = Math.max(0, this.type.attackDamage + this.effects.attackBonus());
        ctx.hurtPlayer(damage, this.x, this.z);
      }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2 + Math.random() * 4;
        this.wanderYaw = Math.random() * Math.PI * 2;
        // 四分之一的概率原地站一会儿
        this.idle = Math.random() < 0.25;
      }
    }

    this.move(chasing, dt);
  }

  /**
   * 远程生物的 AI（J9）。
   *
   * 三件事：**保持距离**（太近后退、太远靠近、射程内站住）、**定期放箭**、**朝向玩家**。
   * 不走 `pathfinder`：远程生物的目标不是"贴上去"，用直线方向就够了；
   * 而寻路每 0.5 秒重算一次，对"保持距离"这种小范围来回反而会抖。
   */
  private updateRangedAi(
    ctx: EntityContext,
    distanceSq: number,
    player: { x: number; y: number; z: number },
    dt: number,
  ): void {
    const ranged = this.type.ranged!;
    const distance = Math.sqrt(distanceSq);
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const length = Math.max(1e-4, Math.hypot(dx, dz));

    // 前进 / 后退 / 站住
    const approaching = distance > ranged.range * 0.9;
    this.retreating = distance < ranged.keepDistance;
    if (this.retreating) {
      this.moveDirX = -dx / length;
      this.moveDirZ = -dz / length;
    } else if (approaching) {
      this.moveDirX = dx / length;
      this.moveDirZ = dz / length;
    } else {
      this.moveDirX = 0;
      this.moveDirZ = 0;
    }

    // 朝向始终对着玩家（渲染与射击方向都靠它）
    this.yaw = Math.atan2(dx, dz);

    this.rangedTimer -= dt;
    if (this.rangedTimer > 0 || distance > ranged.range) return;
    this.rangedTimer = ranged.cooldown + Math.random() * 0.5;

    // 从眼睛朝玩家胸口射，带一点散布
    const eyeY = this.y + this.type.eyeHeight;
    const targetY = player.y + 1.2;
    const aimX = dx / length;
    const aimZ = dz / length;
    const aimY = (targetY - eyeY) / length;
    const spread = (Math.random() - 0.5) * ranged.spread;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);

    ctx.spawnArrow?.(
      this.x,
      eyeY,
      this.z,
      {
        x: (aimX * cos - aimZ * sin) * ranged.speed,
        y: aimY * ranged.speed,
        z: (aimX * sin + aimZ * cos) * ranged.speed,
      },
      // 力量/虚弱同样作用于远程伤害（原版也如此）
      { fromPlayer: false, damage: Math.max(0, this.type.attackDamage + this.effects.attackBonus()) },
    );
    ctx.playSound?.('bow_shoot', this.x, this.y, this.z);
  }

  private move(chasing: boolean, dt: number): void {
    // 状态效果直接乘在速度上：缓慢 -15%/级、速度 +20%/级（数值来自 `StatusEffects`，与玩家同源）
    const speed = (chasing ? this.type.speed * 1.12 : this.type.speed * 0.5) * this.effects.moveSpeedMultiplier();
    let targetVx = 0;
    let targetVz = 0;

    if (this.type.ranged || this.moveDirX !== 0 || this.moveDirZ !== 0) {
      // 远程生物（保持距离）与求爱中的生物（走向配偶）：方向由 AI 直接给，不走寻路
      targetVx = this.moveDirX * speed;
      targetVz = this.moveDirZ * speed;
      this.moveDirX = 0;
      this.moveDirZ = 0;
    } else if (chasing) {
      while (this.pathIndex < this.path.length) {
        const node = this.path[this.pathIndex]!;
        const dx = node.x + 0.5 - this.x;
        const dz = node.z + 0.5 - this.z;
        const distance = Math.hypot(dx, dz);

        if (distance < 0.45) {
          this.pathIndex++;
          continue;
        }

        targetVx = (dx / distance) * speed;
        targetVz = (dz / distance) * speed;

        // 需要跳上台阶时起跳
        if (node.y > this.y + 0.2 && this.onGround && this.jumpCooldown <= 0) {
          this.vy = JUMP_SPEED;
          this.jumpCooldown = 0.45;
          this.onGround = false;
        }
        break;
      }
      if (this.pathIndex >= this.path.length) this.path = [];
    } else if (!this.idle) {
      targetVx = Math.cos(this.wanderYaw) * speed;
      targetVz = Math.sin(this.wanderYaw) * speed;

      // 前方是悬崖就掉头，避免被动生物成群跳崖
      if (this.onGround && this.wouldFall(targetVx, targetVz)) {
        this.wanderYaw += Math.PI * (0.6 + Math.random() * 0.8);
        targetVx = 0;
        targetVz = 0;
      }
    }

    // 平滑加减速（空中转向更迟钝）
    const accel = this.onGround ? 10 : 2.5;
    const factor = Math.min(1, accel * dt);
    this.vx += (targetVx - this.vx) * factor;
    this.vz += (targetVz - this.vz) * factor;
  }

  /** 沿 (vx, vz) 方向走出 0.7 格后是否会踏空 */
  private wouldFall(vx: number, vz: number): boolean {
    const length = Math.hypot(vx, vz);
    if (length < 1e-4) return false;
    const fx = Math.floor(this.x + (vx / length) * 0.7);
    const fz = Math.floor(this.z + (vz / length) * 0.7);
    const feetY = Math.floor(this.y) - 1;
    for (let drop = 0; drop <= 3; drop++) {
      if (this.pathfinder.canStandAt(fx, feetY + 1 - drop, fz, this.bodyBlocks)) return false;
    }
    return true;
  }

  /**
   * 剪羊毛（J8）。
   * @returns 剪下来的羊毛数量（1~3，原版）；剪不动（已经剪过/幼体以外的原因）返回 0
   */
  shear(): number {
    if (this.dead || this.sheared) return 0;
    this.sheared = true;
    this.woolTimer = WOOL_REGROW_SECONDS;
    return 1 + Math.floor(Math.random() * 3);
  }

  /** 羊毛长回来了没有（渲染层与测试用） */
  get woolGrowing(): boolean {
    return this.sheared;
  }

  /** 是否在求爱（渲染层可以据此冒爱心；测试也用它读状态） */
  get inLove(): boolean {
    return this.loveTimer > 0;
  }

  /**
   * 喂食（J8）。
   *
   * @returns `'grow'` = 喂的是幼体、加速成长；`'love'` = 喂的是成年体、进入求爱；
   *          `null` = 这东西它不吃 / 已经吃饱了 / 刚繁殖完还在冷却
   */
  feed(itemId: number): 'grow' | 'love' | null {
    if (this.dead || this.type.feed === undefined || this.type.feed !== itemId) return null;

    if (this.baby) {
      // 原版每喂一次缩短 10% 的成长时间；这里改成固定减少 1/10 的总额
      this.fedCount++;
      this.growTimer = Math.max(0, this.growTimer - BABY_GROW_SECONDS / 10);
      return 'grow';
    }
    if (this.loveTimer > 0 || this.breedCooldown > 0) return null;
    this.loveTimer = LOVE_SECONDS;
    return 'love';
  }

  /**
   * 变成幼体（生成时调）。
   *
   * 碰撞盒一起缩小——不然小小的身体配着成年的碰撞盒，会出现"隔着半格就撞上"的怪手感。
   */
  makeBaby(): void {
    this.baby = true;
    this.width = this.type.width * BABY_SCALE;
    this.height = this.type.height * BABY_SCALE;
    this.growTimer = BABY_GROW_SECONDS;
    this.fedCount = 0;
  }

  /** 直接让这只生物进入求爱（测试与命令用，省得先喂一遍） */
  startLove(): void {
    if (!this.baby) this.loveTimer = LOVE_SECONDS;
  }

  /**
   * 生下一只幼体：两只亲本各自进入冷却，幼体由上层生成（`ctx.spawnBaby`）。
   * @returns 幼体的初始状态（位置与朝向由上层决定）
   */
  breedWith(): void {
    this.loveTimer = 0;
    this.breedCooldown = BREED_COOLDOWN_SECONDS;
  }

  /** 是否正在燃烧（渲染层用它上色） */
  get burning(): boolean {
    return this.burnTime > 0;
  }

  /**
   * 点燃（火矢用）。取"更长的那个持续时间"，重复命中不会把火越点越短。
   * 原版火矢是 5 秒。
   */
  ignite(seconds: number): void {
    if (seconds <= 0) return;
    this.burnTime = Math.max(this.burnTime, seconds);
  }

  /** 着火伤害：每满 1 秒扣 1 点（原版 20 tick 一次），不参与无敌帧与击退 */
  private tickBurning(dt: number): void {
    if (this.burnTime <= 0) return;
    this.burnTime -= dt;
    this.burnTick += dt;
    while (this.burnTick >= 1) {
      this.burnTick -= 1;
      this.health -= 1;
      this.hitFlash = 0.2;
      if (this.health <= 0) {
        this.health = 0;
        this.dead = true;
        return;
      }
    }
    if (this.burnTime <= 0) this.burnTick = 0;
  }

  /**
   * 受到伤害：无敌帧内无效；否则扣血 + 击退 + 红闪，生命归零则标记死亡并把掉落物交给上层。
   * @param looting 击杀者的「抢夺」等级，只影响掉落数量（伤害加成在 `tools.ts#meleeDamage` 里算好）
   * @returns 是否真的受到了伤害
   */
  hurt(amount: number, knockbackX: number, knockbackZ: number, ctx?: EntityContext, looting = 0): boolean {
    if (this.dead || this.hurtTime > 0 || amount <= 0) return false;

    this.hurtTime = HURT_COOLDOWN;
    this.hitFlash = 0.3;
    this.health -= amount;

    const length = Math.hypot(knockbackX, knockbackZ);
    if (length > 1e-4) {
      this.vx += (knockbackX / length) * 5;
      this.vz += (knockbackZ / length) * 5;
    }
    this.vy = Math.max(this.vy, 3.6);
    this.onGround = false;

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.lootDropped = true;
      this.dropLoot(ctx, looting);
    }
    return true;
  }

  /**
   * @param looting 「抢夺」等级：原版把每种掉落的数量上限抬高这么多（`uniform(min, max + level)`）
   */
  private dropLoot(ctx?: EntityContext, looting = 0): void {
    if (!ctx) return;
    // 幼体不掉落也不给经验（原版行为：小动物杀了白杀）
    if (this.baby) return;
    for (const drop of this.type.drops) {
      if (drop.chance !== undefined && Math.random() > drop.chance) continue;
      const max = drop.max + Math.max(0, looting);
      const count = drop.min + Math.floor(Math.random() * (max - drop.min + 1));
      if (count > 0) ctx.spawnDrop(drop.itemId, count, this.x, this.y + this.height * 0.5, this.z);
    }

    // 羊毛按**自己身上的颜色**掉，所以进不了 drops 表；
    // 剪过的羊不掉羊毛（原版行为，这样"剪"与"杀"才是两条路）
    if (this.type.wool && !this.sheared) {
      ctx.spawnDrop(woolId(this.woolColor), 1, this.x, this.y + this.height * 0.5, this.z);
    }
    // 击杀经验（原版数值）；经验球实体还没做，直接进账
    if (this.type.xp > 0) ctx.awardXp?.(this.type.xp);
  }

  /** 与玩家的水平距离（战斗判定用） */
  distanceToPlayerSq(ctx: EntityContext): number {
    const player = ctx.player;
    if (!player) return Number.POSITIVE_INFINITY;
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    return dx * dx + dz * dz;
  }

  /** 调试用：当前是否在追击 */
  get chasingPath(): number {
    return this.path.length;
  }

  clampToWorld(): void {
    this.vx = clamp(this.vx, -20, 20);
    this.vz = clamp(this.vz, -20, 20);
  }
}
