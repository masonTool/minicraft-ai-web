/**
 * 水流对实体的推动（F9 尾巴，批次 447）
 *
 * 本项目的水是**静态方块 + 液面等级**（见 `Fluids.ts`）：等级 0 = 水源，
 * 1~7 越流越薄。原版的水流推力就是从这个等级差里来的，所以这里也只用它：
 *
 *  - 实体所在格是水、且**四邻里有一个更薄的水格**（等级更大）→ 朝那个方向推；
 *    这就是"水从水源流向远处"的方向，与客户端看到的液面高低一致；
 *  - 四邻都是同厚度或实心（一潭静水）→ 不推。池子里站着不该被推着走；
 *  - 上方也是水（瀑布/水柱）→ 向下推一点点，表达"被水柱按下去"。
 *
 * 纯函数：只要求"读方块 + 读状态"两件事，因此能离线断言。
 *
 * 玩家、生物、掉落物现在都走这一条：
 *  - 玩家用 `FLOW_DRIFT_SPEED` 作为**目标速度**（他有一套完整的水中移动）；
 *  - 生物/掉落物用 `flowPush()` 作为**加速度**——它们各自已经有 AI / 浮力在改速度，
 *    直接覆盖会把"逆流游动"变成"只能顺流"。
 */

import { Block } from '../registry/blocks.ts';
import { fluidLevel } from '../registry/blockState.ts';

export interface FlowWorld {
  getBlock(x: number, y: number, z: number): number;
  getState(x: number, y: number, z: number): number;
}

/** 推动向量的三个分量（水平是**目标速度偏移**，竖直是加速度） */
export interface FluidFlow {
  x: number;
  y: number;
  z: number;
}

/**
 * 被水流带着走时，水平目标速度能加多少（格/秒）。
 *
 * 定成 1.2：正常游泳是 2.2 上下，所以**逆流还能前进**（原版也游得动），
 * 但松手时会被水带出明显的位移。定太大就变成"水里只能顺流"。
 */
export const FLOW_DRIFT_SPEED = 1.2;

/** 瀑布（上方也是水）向下的加速度（格/秒²） */
export const FLOW_DOWN_ACCEL = 6;

/**
 * 水流给**生物/掉落物**的横向加速度（格/秒²）。
 *
 * 玩家是"目标速度 1.2"（他的输入直接决定速度），生物不是：AI 每帧会写 vx/vz，
 * 用目标速度会把"逆流游"压成"只能顺流"。这里只加一份小加速度，
 * 顺流时明显被带走、逆流时仍然游得动。
 */
export const FLOW_ENTITY_ACCEL = 4;

/** 四个水平方向：与网格坐标一致，方便断言 */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 这一格的水会往哪推（不是水就返回 null）。
 *
 * @param x/y/z 实体的**世界坐标**（内部取 floor；传身体中段更稳）
 */
export function waterFlowAt(world: FlowWorld, x: number, y: number, z: number): FluidFlow | null {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  if (world.getBlock(bx, by, bz) !== Block.WATER) return null;

  const level = fluidLevel(world.getState(bx, by, bz));

  // 水柱：上方也是水 → 向下按。横向那一份由下面继续算（瀑布落地后会四散）
  let down = 0;
  if (world.getBlock(bx, by + 1, bz) === Block.WATER) down = -FLOW_DOWN_ACCEL;

  // 下游 = 四邻里**液面最低（等级最大）**的那一格。
  // 只看水格：旁边是空气时水"应该"还在流过去，但那一格此刻还没有水，
  // 按它推会让溺水的人被推向岸上空的一格——那种位置由流体刻去补，不归实体推力管。
  let bestLevel = level;
  let dx = 0;
  let dz = 0;
  for (const [ox, oz] of DIRECTIONS) {
    if (world.getBlock(bx + ox, by, bz + oz) !== Block.WATER) continue;
    const neighbor = fluidLevel(world.getState(bx + ox, by, bz + oz));
    if (neighbor <= bestLevel) continue;
    bestLevel = neighbor;
    dx = ox;
    dz = oz;
  }

  if (dx === 0 && dz === 0 && down === 0) return null;
  return { x: dx * FLOW_DRIFT_SPEED, y: down, z: dz * FLOW_DRIFT_SPEED };
}

/**
 * 把水流加速度叠到生物/掉落物的水平速度上（纯函数）。
 *
 * 不覆盖原速度：顺流时被带得更快，逆流时只是稍微被顶回来，
 * 这样 `SwimRules` 与 AI 的移动意图仍然说话。
 */
export function flowPush(
  vx: number,
  vz: number,
  flow: FluidFlow | null,
  dt: number,
): { x: number; z: number } {
  if (!flow || !(dt > 0)) return { x: vx, z: vz };
  return {
    x: vx + flow.x * FLOW_ENTITY_ACCEL * dt,
    z: vz + flow.z * FLOW_ENTITY_ACCEL * dt,
  };
}
