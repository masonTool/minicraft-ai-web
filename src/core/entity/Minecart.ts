/**
 * 矿车（批次 245，G12 载具层第二件）
 *
 * 与船共用同一套"载具"语义：`vehicleInput` 给输入、主程序负责上下车与贴位置
 * （见 `main.syncRiderToVehicle`），实体自己只管**怎么动**。
 *
 * 运动模型（比原版简化，够玩）：
 *  - **在铁轨上**：阻力极小（0.4/s）、加速度大（8 格/秒²），能滑很远；
 *  - **离开铁轨**：阻力极大（8/s）、加速度只剩 1/4，推两下就停（原版在草地上也寸步难行）；
 *  - **没人驾驶**：不吃输入，只在轨道上靠残余速度滑行；
 *  - 重力照常，落地后竖直速度归零。
 *
 * ⚠️ 已知简化（写进 TASKS G12）：
 *  - **不做弯道/坡道的轨道约束**：车是"贴着轨道滑的方块车"，走直线、不吸附到轨道中线；
 *  - 不做动力铁轨/探测铁轨，也不做矿车里的界面。
 */

import { Entity, type EntityContext } from './Entity.ts';
import { Block } from '../registry/blocks.ts';
import { isPowered } from '../registry/blockState.ts';
import { moveBody } from '../physics/EntityMotion.ts';

/** 矿车碰撞盒（格）：比一格窄一点，过门/过洞不容易卡 */
export const MINECART_WIDTH = 0.9;
export const MINECART_HEIGHT = 0.7;

/** 轨道上的阻力/加速度 */
const RAIL_DRAG = 0.4;
const RAIL_ACCEL = 8;
/** 离开轨道之后 */
const GROUND_DRAG = 8;
const GROUND_ACCEL = 2;
/** 有人驾驶时的水平速度上限（格/秒） */
export const MINECART_MAX_SPEED = 8;
/** 空车滑行的上限：比有人开时慢，避免"空车自己跑丢" */
const EMPTY_MAX_SPEED = 5;
/** 动力铁轨通电时的上限：比手动快一截（原版动力轨能一直加速） */
export const MINECART_BOOST_SPEED = 12;
/** 动力铁轨的推力（格/秒²） */
const BOOST_ACCEL = 10;

export class Minecart extends Entity {
  /** 朝向（与船同一个口径：`yaw` 的 -Z 是车头） */
  yaw = 0;
  /** 谁坐在上面（本项目只有玩家能上） */
  passenger: 'player' | null = null;

  constructor(x: number, y: number, z: number) {
    super(x, y, z, MINECART_WIDTH, MINECART_HEIGHT);
  }

  tick(ctx: EntityContext, dt: number): void {
    this.age += dt;

    // 脚下那一格（车底在 y，格子取 y+0.05 避开台阶边缘的浮点误差）
    const railX = Math.floor(this.x);
    const railY = Math.floor(this.y + 0.05);
    const railZ = Math.floor(this.z);
    const railId = ctx.getBlock(railX, railY, railZ);
    const onRail =
      railId === Block.RAIL || railId === Block.POWERED_RAIL || railId === Block.DETECTOR_RAIL;
    // 动力铁轨（批次 246）：通电才推车。状态位由红石引擎写（见 `RedstoneEngine.recompute`）
    const powered = railId === Block.POWERED_RAIL && isPowered(ctx.getState?.(railX, railY, railZ) ?? 0);

    // 重力（车不浮）
    this.vy -= 22 * dt;
    if (this.vy < -40) this.vy = -40;

    const drag = onRail ? RAIL_DRAG : GROUND_DRAG;
    this.vx *= Math.max(0, 1 - drag * dt);
    this.vz *= Math.max(0, 1 - drag * dt);

    // 驾驶：只有玩家坐着、且主程序给了输入才加速
    const input = ctx.vehicleInput;
    if (this.passenger !== null && input) {
      const forward = input.forward;
      const strafe = input.strafe;
      if (forward !== 0 || strafe !== 0) {
        const accel = (onRail ? RAIL_ACCEL : GROUND_ACCEL) * (input.sprint ? 1.4 : 1);
        // 车头方向：yaw 的 -Z 是前方（与 `PlayerPhysics.lookDirection` 同一个口径）
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw);
        const rz = -Math.sin(this.yaw);
        this.vx += (fx * forward + rx * strafe) * accel * dt;
        this.vz += (fz * forward + rz * strafe) * accel * dt;
      }
    }

    // 动力铁轨：沿当前运动方向持续加速（还没速度就沿车头）
    if (powered) {
      const speed = Math.hypot(this.vx, this.vz);
      const fx = speed > 0.3 ? this.vx / speed : -Math.sin(this.yaw);
      const fz = speed > 0.3 ? this.vz / speed : -Math.cos(this.yaw);
      this.vx += fx * BOOST_ACCEL * dt;
      this.vz += fz * BOOST_ACCEL * dt;
    }

    const max = powered
      ? MINECART_BOOST_SPEED
      : this.passenger !== null
        ? MINECART_MAX_SPEED
        : EMPTY_MAX_SPEED;
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > max) {
      this.vx = (this.vx / speed) * max;
      this.vz = (this.vz / speed) * max;
    }

    moveBody(ctx.world, this, this.vx * dt, this.vy * dt, this.vz * dt);
    if (this.onGround && this.vy < 0) this.vy = 0;
  }

}
