/**
 * 船（批次 244，G12 载具层的第一件）
 *
 * 为什么先做船再做马/矿车：**"控制权从玩家交给载具"这一层只有一份**。
 * 船把它跑通之后，矿车（沿铁轨）与马（自己会走）都只是在同一套"驾驶 + 上下车"上换运动模型。
 *
 * 运动模型（比原版简化，但手感对齐）：
 *  - **水里**：浮力把船吸到水面（找这一列最高的水格），水的阻力让它滑行很远；
 *  - **岸上**：重力 + 强摩擦（原版船在陆地上又慢又涩，不像车）；
 *  - **有人驾驶**：按玩家的前进/横移加速，方向跟着玩家视角（主程序每帧写 `yaw`）；
 *  - **没人**：照样浮着、慢慢停下。
 *
 * ⚠️ 与实体层的分工：`EntityContext.vehicleInput` 只提供"玩家按了什么"，
 * "谁坐在上面、玩家位置怎么跟"全在主程序——实体层不持有玩家。
 */

import { Entity, type EntityContext } from './Entity.ts';
import { moveBody } from '../physics/EntityMotion.ts';

/** 碰撞盒（格）：原版船约 1.375 宽、0.5625 高，取整到这套方格世界里够用的尺寸 */
export const BOAT_WIDTH = 1.3;
export const BOAT_HEIGHT = 0.6;

/** 水里朝水面收敛的强度（越大越"弹"，越小越"沉"） */
const WATER_BUOYANCY = 10;
/** 水的水平阻力（每秒衰减比例） */
const WATER_DRAG = 2.2;
/** 岸上的阻力：船在陆地上几乎推不动 */
const LAND_DRAG = 7;
/** 驾驶加速度（格/秒²）：水里全速、岸上打折 */
const DRIVE_ACCEL = 11;
const LAND_ACCEL_SCALE = 0.4;
/** 冲刺倍率 */
const SPRINT_SCALE = 1.5;
/** 有人驾驶时的最大水平速度（格/秒） */
export const BOAT_MAX_SPEED = 7;
/** 空船自己漂的速度上限 */
const EMPTY_MAX_SPEED = 3;
/** 水面高度：水源方块顶面约 0.875，船底吃水 0.22，于是停在 `y ≈ 水面 + 0.65` */
const WATER_SURFACE = 0.875;
const DRAFT = 0.22;

export class Boat extends Entity {
  /** 朝向（与玩家视角同一个口径：`yaw` 的 -Z 方向是船头） */
  yaw = 0;
  /**
   * 谁坐在上面（本项目只有玩家能上；`null` = 空船）。
   * 实体层只用它决定"要不要吃驾驶输入"，玩家的位置同步在主程序。
   */
  passenger: 'player' | null = null;

  constructor(x: number, y: number, z: number) {
    super(x, y, z, BOAT_WIDTH, BOAT_HEIGHT);
  }

  tick(ctx: EntityContext, dt: number): void {
    this.age += dt;

    const inWater = this.isInWater(ctx);
    if (inWater) {
      // 浮到水面：往上找这一列最高的水格（最多 3 格，够覆盖岸边/浪里）
      const surfaceY = this.waterSurfaceY(ctx);
      const target = surfaceY + WATER_SURFACE - DRAFT;
      this.vy += (target - this.y) * WATER_BUOYANCY * dt;
      // 垂直阻尼：不然会像弹簧一样上下弹
      this.vy *= Math.max(0, 1 - 5 * dt);
      this.vx *= Math.max(0, 1 - WATER_DRAG * dt);
      this.vz *= Math.max(0, 1 - WATER_DRAG * dt);
    } else {
      this.vy -= 22 * dt;
      if (this.vy < -40) this.vy = -40;
      this.vx *= Math.max(0, 1 - LAND_DRAG * dt);
      this.vz *= Math.max(0, 1 - LAND_DRAG * dt);
    }

    // 驾驶：只有玩家坐着、且主程序给了输入才加速
    const input = ctx.vehicleInput;
    if (this.passenger !== null && input) {
      const forward = input.forward;
      const strafe = input.strafe;
      if (forward !== 0 || strafe !== 0) {
        const scale = (inWater ? 1 : LAND_ACCEL_SCALE) * (input.sprint ? SPRINT_SCALE : 1);
        // 船头方向：yaw 的 -Z 是前方（与 `PlayerPhysics.lookDirection` 同一个口径）
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw);
        const rz = -Math.sin(this.yaw);
        this.vx += (fx * forward + rx * strafe) * DRIVE_ACCEL * scale * dt;
        this.vz += (fz * forward + rz * strafe) * DRIVE_ACCEL * scale * dt;
      }
    }

    // 限速：有人驾驶能开快，空船只是随波漂
    const max = this.passenger !== null ? BOAT_MAX_SPEED : EMPTY_MAX_SPEED;
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > max) {
      this.vx = (this.vx / speed) * max;
      this.vz = (this.vz / speed) * max;
    }

    moveBody(ctx.world, this, this.vx * dt, this.vy * dt, this.vz * dt);

    // 落到地面/水面之后把残余的竖直速度收掉，免得"站着还在抖"
    if (this.onGround && this.vy < 0) this.vy = 0;
  }

  /** 船体（脚所在的格到中段）有没有水：判定与"玩家泡在水里"同一个口径 */
  private isInWater(ctx: EntityContext): boolean {
    const x = Math.floor(this.x);
    const z = Math.floor(this.z);
    return (
      ctx.world.isLiquid(x, Math.floor(this.y + 0.1), z) ||
      ctx.world.isLiquid(x, Math.floor(this.y + 0.4), z)
    );
  }

  /**
   * 这一列最高的水格（从船底往上找）。
   * 只往上找 3 格：再高就是瀑布/水柱，船不该一路爬上去。
   */
  private waterSurfaceY(ctx: EntityContext): number {
    const x = Math.floor(this.x);
    const z = Math.floor(this.z);
    let top = Math.floor(this.y + 0.1);
    for (let i = 0; i < 3; i++) {
      if (!ctx.world.isLiquid(x, top + 1, z)) break;
      top++;
    }
    return top;
  }
}
