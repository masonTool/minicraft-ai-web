/**
 * 掉落物实体
 *
 * 行为对齐原版：
 *  - 被丢出时带一点随机水平初速，落地后受摩擦迅速停下；
 *  - 落在水里会缓慢上浮；
 *  - 存在 5 分钟（原版 6000 tick）后自然消失；
 *  - 掉落后有 0.5 秒拾取冷却，避免刚丢出去就被自己吸回来；
 *  - 玩家走近即被吸进背包，背包放不下时留在原地；
 *  - **掉进岩浆当场销毁、泡在火里 1.5 秒销毁**（批次 168，TASKS J18），
 *    但下界合金那一族（`isFireproofItem`）不怕火——"熔岩边捞合金锭"才成立。
 *
 * ⚠️ 它携带的是**整份 `ItemStack`**（批次 63）：物品 id、数量，以及耐久/附魔/改名这些
 * 附加数据。原先只存 id + 数量，于是"带着附魔的镐掉在地上 → 捡起来变成白板"
 * （投掷器吐出来、破坏箱子掉落、落地再捡起，三条路径都中招）。
 */

import { Entity, entityIntersectsBox, type DroppedExtras, type EntityContext } from './Entity.ts';
import { moveBody, type MovingBody } from '../physics/EntityMotion.ts';
import { Block } from '../registry/blocks.ts';
import { isFireproofItem } from '../registry/items.ts';
import { flowPush, waterFlowAt } from '../world/FluidFlow.ts';

/** 老离线桩不传 `getState` 时的兜底（与 Mob 同一口径） */
const NO_BLOCK_STATE = (): number => 0;

const GRAVITY = 32;
const MAX_FALL_SPEED = 20;
/** 存在时长上限（秒） */
export const ITEM_LIFETIME = 300;
/** 拾取冷却（秒） */
const PICKUP_DELAY = 0.5;
/**
 * 泡在**火方块**里多久会被烧掉（秒，批次 168 / TASKS J18）。
 *
 * 原版掉进岩浆是"当场没了"，掉进火里还有一两秒的余地（够玩家伸手捡回来）。
 * 这里就把那个余地定成 1.5 秒；`fireproof`（下界合金那一族）两种都不怕。
 */
export const ITEM_FIRE_SECONDS = 1.5;

export class ItemEntity extends Entity implements MovingBody {
  /** 渲染用的上下浮动相位，让每堆掉落物错开 */
  readonly bobPhase: number;

  /**
   * 附加数据（耐久/附魔/改名/累积惩罚）。没有就省略——绝大多数掉落物都是"白板"。
   *
   * 放在构造函数最后一个可选参数上，是为了**不破坏**那二十来个
   * `new ItemEntity(id, count, x, y, z, velocity)` 的调用点（测试里用得最多）。
   */
  readonly extras: DroppedExtras;

  /**
   * 联机镜像（L7 第一刀）：只用于"看见队友那边的掉落物"。
   *
   * 镜像不跑物理、不参与拾取与合并——位置由生成方广播的那一条决定。
   * 这一批**不做拾取仲裁**，所以远端那一堆在本地是拿不到的（写进 TASKS L7 的差异）。
   */
  ghost = false;

  /** 连续泡在火里的秒数（离开火焰立刻清零，见 `burnAway`） */
  private fireSeconds = 0;

  constructor(
    readonly itemId: number,
    public count: number,
    x: number,
    y: number,
    z: number,
    initialVelocity?: { x: number; y: number; z: number },
    extras?: DroppedExtras,
  ) {
    super(x, y, z, 0.25, 0.25);
    this.extras = extras ?? {};
    this.bobPhase = Math.random() * Math.PI * 2;

    if (initialVelocity) {
      this.vx = initialVelocity.x;
      this.vy = initialVelocity.y;
      this.vz = initialVelocity.z;
    } else {
      // 原版丢出时的随机初速：向四周弹一点并向上抛
      this.vx = (Math.random() - 0.5) * 1.2;
      this.vy = 2.2;
      this.vz = (Math.random() - 0.5) * 1.2;
    }
  }

  override tick(ctx: EntityContext, dt: number): void {
    // 已被标记移除的实体不再推进：EntityManager 会在同一帧内移除它，
    // 但直接调用 tick 的场合（测试、未来的实体复用池）需要这道防线。
    if (this.dead) return;
    // 联机镜像：位置与数量都归生成方，本地既不模拟也不拾取（见 `ghost` 的注释）
    if (this.ghost) return;

    this.age += dt;
    if (this.age > ITEM_LIFETIME) {
      this.dead = true;
      return;
    }

    const inWater = ctx.world.isLiquid(Math.floor(this.x), Math.floor(this.y + 0.12), Math.floor(this.z));

    if (inWater) {
      // 上浮，并受到比空气大得多的阻尼
      this.vy = Math.min(this.vy + 22 * dt, 0.7);
      const waterDrag = Math.pow(0.8, dt * 20);
      this.vx *= waterDrag;
      this.vz *= waterDrag;
      // 水流推动（B8 尾巴）：与生物共用 `flowPush`，只叠水平加速度；
      // 竖直不接（掉落物本来就有浮力，再叠下压会把水里的东西按到底）
      const flow = waterFlowAt(
        { getBlock: ctx.getBlock, getState: ctx.getState ?? NO_BLOCK_STATE },
        this.x,
        this.y + 0.12,
        this.z,
      );
      if (flow) {
        const pushed = flowPush(this.vx, this.vz, flow, dt);
        this.vx = pushed.x;
        this.vz = pushed.z;
      }
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -MAX_FALL_SPEED) this.vy = -MAX_FALL_SPEED;
      // 摩擦：贴地时衰减很快，空中几乎保持惯性
      const friction = Math.pow(this.onGround ? 0.55 : 0.98, dt * 20);
      this.vx *= friction;
      this.vz *= friction;
    }

    moveBody(ctx.world, this, this.vx * dt, this.vy * dt, this.vz * dt);

    if (this.onGround && Math.abs(this.vx) < 0.02 && Math.abs(this.vz) < 0.02) {
      this.vx = 0;
      this.vz = 0;
    }

    if (this.burnAway(ctx, dt)) return;

    this.tryPickup(ctx);
  }

  /**
   * 岩浆 / 火焰销毁（批次 168，TASKS J18）。
   *
   * 对齐原版：**岩浆当场销毁**、**火里烧 1.5 秒**再销毁；下界合金那一族
   * （`isFireproofItem`）两种都不怕，所以"熔岩边捞合金锭"这件事才成立。
   *
   * ⚠️ 判据读的是**脚所在的那一格**（与上面那道水流检测同一个口径）：火没有碰撞盒，
   * 所以掉在火上的物体会落进火那一格，正好读到它。
   *
   * @returns 这一帧是不是已经被销毁（调用方直接 return，别再拿它做拾取）
   */
  private burnAway(ctx: EntityContext, dt: number): boolean {
    if (isFireproofItem(this.itemId)) return false;
    const inside = ctx.getBlock(Math.floor(this.x), Math.floor(this.y + 0.12), Math.floor(this.z));
    if (inside === Block.LAVA) {
      this.dead = true;
      return true;
    }
    if (inside !== Block.FIRE) {
      // 离开火焰就清零：原版那 1.5 秒要求"连续"泡在火里，跳进跳出不该累计
      this.fireSeconds = 0;
      return false;
    }
    this.fireSeconds += dt;
    if (this.fireSeconds < ITEM_FIRE_SECONDS) return false;
    this.dead = true;
    return true;
  }

  /** 把这一堆还原成一个物品栈（主程序拾取/渲染文案都用它） */
  toStack(): { id: number; count: number } & DroppedExtras {
    return { id: this.itemId, count: this.count, ...this.extras };
  }

  /** 这一堆与另一堆是不是**同一件东西**（同 id + 同附加数据）——合并判定要用 */
  sameAs(other: ItemEntity): boolean {
    if (other.itemId !== this.itemId) return false;
    const a = this.extras;
    const b = other.extras;
    if ((a.damage ?? 0) !== (b.damage ?? 0)) return false;
    if ((a.repairCost ?? 0) !== (b.repairCost ?? 0)) return false;
    if ((a.name ?? '') !== (b.name ?? '')) return false;
    const keys = new Set([...Object.keys(a.enchants ?? {}), ...Object.keys(b.enchants ?? {})]);
    for (const key of keys) if ((a.enchants?.[key] ?? 0) !== (b.enchants?.[key] ?? 0)) return false;
    return true;
  }

  private tryPickup(ctx: EntityContext): void {
    if (this.age < PICKUP_DELAY || !ctx.playerBox) return;

    // 玩家的拾取范围比自身碰撞盒略大，手感更接近原版
    const box = ctx.playerBox;
    const reach = {
      minX: box.minX - 0.7,
      minY: box.minY - 0.5,
      minZ: box.minZ - 0.7,
      maxX: box.maxX + 0.7,
      maxY: box.maxY + 0.5,
      maxZ: box.maxZ + 0.7,
    };
    if (!entityIntersectsBox(this, reach)) return;

    const leftover = ctx.pickup(this.itemId, this.count, this.extras);
    if (leftover <= 0) this.dead = true;
    else this.count = leftover;
  }
}
