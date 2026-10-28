/**
 * 动力矿车（批次 252，G12 最后一件）
 *
 * 与普通矿车同一套运动（继承 `Minecart`），多的是**燃料**：
 * 烧一块煤推 60 秒，沿车头方向持续加速（原版是推自己 + 顶着的车，这里只做自己）。
 *
 * 燃料从哪来：主程序在"右键/轻点矿车"那条路上判断——手里拿煤就加燃料，
 * 否则才上车（见 `main` 的载具交互分支）。实体层只回答"还有没有燃料、推不推得动"。
 *
 * ⚠️ 与原版差异（写进 TASKS G12）：
 *  - 不会推动连着的其他矿车（本项目没有"矿车互相顶"的物理）；
 *  - 燃料只认煤（原版还认木炭/煤炭块），也不显示"剩余燃料"的烟粒子。
 */

import { Minecart } from './Minecart.ts';

/** 一块煤能烧多少秒（原版 1 煤 ≈ 60 秒） */
export const FURNACE_CART_FUEL_PER_COAL = 60;
/** 燃料上限（秒）：与原版一样能囤几块，不至于一加就顶满 */
export const FURNACE_CART_MAX_FUEL = 300;
/** 有燃料时的推力（格/秒²）：比手动驾驶略小，胜在不需要人坐着 */
const FURNACE_PUSH = 6;

export class FurnaceMinecart extends Minecart {
  /** 剩余燃料（秒） */
  fuelSeconds = 0;

  /** 现在烧着吗（渲染/验收用） */
  get fueled(): boolean {
    return this.fuelSeconds > 0;
  }

  /** 加燃料（秒），封顶 `FURNACE_CART_MAX_FUEL` */
  addFuel(seconds: number): void {
    this.fuelSeconds = Math.min(FURNACE_CART_MAX_FUEL, this.fuelSeconds + Math.max(0, seconds));
  }

  override tick(ctx: Parameters<Minecart['tick']>[0], dt: number): void {
    if (this.fuelSeconds > 0) {
      this.fuelSeconds = Math.max(0, this.fuelSeconds - dt);
      // 沿车头方向推（yaw 的 -Z 是前方，与玩家视角同一个口径）
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      this.vx += fx * FURNACE_PUSH * dt;
      this.vz += fz * FURNACE_PUSH * dt;
    }
    // 阻力、限速、碰撞全部交给父类——动力车不该有第二套运动模型
    super.tick(ctx, dt);
  }
}
