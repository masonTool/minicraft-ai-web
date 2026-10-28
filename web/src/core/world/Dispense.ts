/**
 * 发射行为的**执行器**（批次 60）。
 *
 * 为什么单独成一个模块：行为的判定（"箭要射出去""对面不是 TNT 就什么都不做"）
 * 是本批最该被断言的东西，而它原先要写在 `main.ts` 里——那里有世界、实体、音效、联机，
 * 离线测试搭不动。所以照项目里 `TickWorld` / `RedstoneWorld` / `EntityContext` 那一套，
 * 把"外界能力"收成一个**接口**：主程序注入真货，测试注入假货，
 * 于是"**哪件物品做什么、失败时留不留东西、出膛点与初速是多少**"全都能离线钉住。
 *
 * 容器与触发都不在这里：
 *  - 挑哪一格、取一件、磨耐久 → `container/Dispenser.ts`（继承 `Dropper`）；
 *  - 什么时候调用 → `RedstoneEngine` 的上升沿回调（与投掷器同一套）。
 * 这里只管"给定一件东西与一个凸口方向，这一次发射成不成功"。
 */

import type { ItemStack } from '../container/Inventory.ts';
import { Block } from '../registry/blocks.ts';
import type { DispenseBehavior, DispenseProjectile } from '../registry/dispense.ts';

/** 发射器射出箭/雪球/鸡蛋的初速（格/秒）。原版 1.1 格/刻 ≈ 22（玩家满弓是 60） */
export const DISPENSER_SHOOT_SPEED = 22;
/** 发射器扔药水的初速：比箭慢一些（原版也是） */
export const DISPENSER_THROW_SPEED = 15;
/** 发射器扔药水的抬头量（免得砸在自己脚下） */
export const DISPENSER_THROW_LIFT = 1.5;
/** 发射器射出的箭的伤害（原版按 1.1 的功率射，低于满弓的 6） */
export const DISPENSER_ARROW_DAMAGE = 4;
/**
 * 出膛点离方块中心的距离（格）。
 *
 * 1.2 = 格子中心 + 0.7，也就是凸口外面一点：正好从中心出手的话，
 * 投射物会先撞上**自己这一格的铁壳**（逐段命中判定可不管"谁发射的"）。
 */
export const DISPENSER_NOSE = 1.2;

export interface DispenseArrowOptions {
  damage: number;
  /** 能不能捡回来（发射器射出的箭**不能**，否则搭一台就是刷箭机） */
  pickable: boolean;
  /** 这一箭是哪件物品（药水箭要记住自己，捡回来不能"降级"成普通箭） */
  itemId: number;
}

/**
 * 执行一次发射需要的外界能力（主程序实现，测试注入假货）。
 *
 * 只列**真的会用到**的那些：不需要 `setBlock`（点火由 `igniteFire` 代劳）、
 * 也不需要实体管理器（射/扔都由主程序包成"生成一个实体"）。
 */
export interface DispenseContext {
  /** 某一格是什么方块（TNT 要判它） */
  blockAt(x: number, y: number, z: number): number;
  /** 射出一支箭 */
  shootArrow(x: number, y: number, z: number, velocity: Vec3, options: DispenseArrowOptions): void;
  /** 扔出一件投掷物（雪球 / 鸡蛋 / 药水） */
  throwProjectile(
    x: number,
    y: number,
    z: number,
    velocity: Vec3,
    kind: DispenseProjectile,
    itemId: number,
  ): void;
  /** 点燃那一格的 TNT（引信表在主程序手里）；点不着返回 false */
  primeTnt(x: number, y: number, z: number): boolean;
  /** 在那一格点火；点不着返回 false */
  igniteFire(x: number, y: number, z: number): boolean;
  /** 剪那一格里的生物；@returns 剪下来几份（0 = 那里没有能剪的） */
  shearAt(x: number, y: number, z: number): number;
  /** 给那一格施肥（骨粉，批次 69）；那一格不是生长期的作物就返回 false */
  fertilizeAt(x: number, y: number, z: number): boolean;
  /** 音效（`bow_shoot` = 射/扔出去、`flint` = 打火石那两下） */
  playSound(kind: 'bow_shoot' | 'flint', x: number, y: number, z: number): void;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 执行一次发射行为。
 *
 * @returns 用成功了吗（false = 卡住：**这一件不消耗**，留在发射器里——原版也是"失败就什么都不发生"）
 */
export function runDispenseAction(
  behavior: DispenseBehavior,
  stack: ItemStack,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  ctx: DispenseContext,
): boolean {
  // 凸口**正对的那一格**（TNT / 火焰 / 羊都看它）
  const fx = x + dx;
  const fy = y + dy;
  const fz = z + dz;
  // 出膛点：凸口外面一点
  const ox = x + 0.5 + dx * DISPENSER_NOSE;
  const oy = y + 0.5 + dy * DISPENSER_NOSE;
  const oz = z + 0.5 + dz * DISPENSER_NOSE;

  switch (behavior.action) {
    case 'shoot-arrow': {
      ctx.shootArrow(
        ox,
        oy,
        oz,
        {
          x: dx * DISPENSER_SHOOT_SPEED,
          y: dy * DISPENSER_SHOOT_SPEED,
          z: dz * DISPENSER_SHOOT_SPEED,
        },
        { damage: DISPENSER_ARROW_DAMAGE, pickable: false, itemId: stack.id },
      );
      ctx.playSound('bow_shoot', x, y, z);
      return true;
    }

    case 'throw-projectile': {
      const kind = behavior.projectile;
      if (!kind) return false;
      ctx.throwProjectile(
        ox,
        oy,
        oz,
        {
          x: dx * DISPENSER_THROW_SPEED,
          // 略微上抬：药水砸在自己脚下就很荒唐（原版也给了抬头量）
          y: dy * DISPENSER_THROW_SPEED + DISPENSER_THROW_LIFT,
          z: dz * DISPENSER_THROW_SPEED,
        },
        kind,
        stack.id,
      );
      ctx.playSound('bow_shoot', x, y, z);
      return true;
    }

    case 'prime-tnt': {
      // 原版：只有凸口正对 **TNT 方块** 时才点燃（对面不是 TNT 就什么都不做，物品留着）
      if (ctx.blockAt(fx, fy, fz) !== Block.TNT) return false;
      if (!ctx.primeTnt(fx, fy, fz)) return false;
      ctx.playSound('flint', fx, fy, fz);
      return true;
    }

    case 'ignite-fire': {
      if (!ctx.igniteFire(fx, fy, fz)) return false;
      ctx.playSound('flint', fx, fy, fz);
      return true;
    }

    case 'shear-entity': {
      // 剪不动（那一格没有羊 / 是只猪）也算失败：东西留着，玩家自己去腾地方
      return ctx.shearAt(fx, fy, fz) > 0;
    }

    case 'fertilize': {
      // 骨粉（批次 69）：催凸口**正对的那一格**里的作物。
      // 那一格不是生长期的作物（石头、成熟的小麦…）就整件事取消、**这一份骨粉不消耗**——
      // 与"对面不是 TNT 时点不着火"同一个口径（原版也是失败就什么都不发生）。
      return ctx.fertilizeAt(fx, fy, fz);
    }
  }
}
