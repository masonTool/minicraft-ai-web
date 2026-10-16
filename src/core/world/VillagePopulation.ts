/**
 * 村庄的人口（J22，批次 89）
 *
 * 背景：**村庄结构早就有**（水井 + 4~7 栋房子 + 道路 + 战利品箱，K10 那批做的），
 * 但它一直是**空村**——村民是直到批次 88 才出现的生物，而结构生成跑在 Worker 里
 * （Worker 不能造实体，也不认识主线程的实体表）。所以"让房子住上人"这件事，
 * 只能由主线程在**区块加载之后**做一次。
 *
 * 这里定一条**确定的规则**，而不是"随机撒几个"：
 *
 *   **一张床 = 一个村民。**
 *
 * 判据只有两条：那一格是床（`isBed`，且是**床脚**那一半，免得一张床算两次），
 * 床边上有一格能站人（空气 + 脚下实心）。职业也**不是随机发的**：
 * 在他旁边找工作站（`findWorkstationNear`），找到什么就是什么
 * ——于是"这栋房子摆的是酿造台，住的就是牧师"，与"认领工作站"那套机制同源，
 * 不需要另开一条"村庄职业分配"的通道。
 *
 * ⚠️ 三个刻意的取舍（都写进了 TASKS J22 的差异记录）：
 *  - **只按床，不按房**：没有床的建筑（以后要加的钟楼、岗楼）不会住人；
 *  - **不持久化**（生物本身就不存档，见 J2）：区块卸载再回来会**照着同一条规则重造**
 *    ——位置与职业是同一个人，但**等级与"今天卖了几次"会重置**；
 *  - **不生成铁傀儡**（那是 J24，而且它要"村民恐慌"那套状态）。
 *
 * 这个模块是**纯函数 + 注入世界视图**，所以"会不会多刷/漏刷"能离线断言
 * （村庄在 Worker 里生成，主线程这边只做"读方块 + 排位置"）。
 */

import { Block, blockDef, isBed } from '../registry/blocks.ts';
import { isBedHead } from '../registry/blockState.ts';
import {
  findWorkstationNear,
  professionForWorkstation,
  type VillagerProfessionId,
} from '../registry/villagerTrades.ts';
import { WORLD_MAX_Y, WORLD_MIN_Y } from './Chunk.ts';

/** 主线程那一侧要提供的东西（方块 + "这一带已经有人了吗"） */
export interface VillageWorldView {
  getBlock(x: number, y: number, z: number): number;
  getState(x: number, y: number, z: number): number;
  /**
   * 这一格附近**已经**有村民了吗。
   *
   * ⚠️ 这条是"区块被反复加载时人口不会翻倍"的唯一防线：村民活着的时候走近再走远，
   * 区块卸载又加载，`planVillagePopulation` 会被再调一次——没有这道检查，
   * 村里的村民会一次比一次多（而且**不报错**，只是越玩越卡）。
   * 不传就按"没人"处理（离线测试用）。
   */
  villagerNear?(x: number, y: number, z: number, radius: number): boolean;
}

/** 一个"这里该站一个村民"的计划 */
export interface VillagerSpawn {
  /** 整数格坐标（调用方负责 +0.5 落到格心） */
  x: number;
  y: number;
  z: number;
  /** 认领到的职业（身边没有工作站就是 null = 无业游民） */
  professionId: VillagerProfessionId | null;
  /** 他认领的是哪一格工作站（与 J11 的"认领"同一份数据，没有就是 null） */
  workstation: { x: number; y: number; z: number } | null;
  /** 是哪张床把他招来的（调试与断言用） */
  bedX: number;
  bedY: number;
  bedZ: number;
}

/** 村民到多远去认领工作站——与 `Villager` 的扫描范围同一个口径 */
export const POPULATION_WORKSTATION_RANGE = 8;

/** 这一带（半径）已经有村民就不再刷：与"认领工作站"的范围同量级 */
export const POPULATION_DUPLICATE_RADIUS = 12;

/** 一个区块最多刷几个（房挨着房的区块可能有两三张床，留一点余量） */
export const POPULATION_MAX_PER_CHUNK = 4;

/**
 * 床边的落脚点（没有就返回 null）。
 *
 * 顺序是**固定的**（按朝向的四个方向，然后才是床上方）：于是同一张床每次算出来的
 * 位置都一样——"区块卸载再回来，村民还站在原来的地方"。
 * 只挑"空气 + 脚下实心"的格子，所以不会把村民塞进墙里或者悬在半空
 * （悬空会被物理立刻往下扔，看着像"村民从天上掉下来"）。
 */
export function villagerSpotNearBed(
  view: VillageWorldView,
  footX: number,
  footY: number,
  footZ: number,
): { x: number; y: number; z: number } | null {
  const candidates: ReadonlyArray<readonly [number, number, number]> = [
    [footX - 1, footY, footZ],
    [footX + 1, footY, footZ],
    [footX, footY, footZ - 1],
    [footX, footY, footZ + 1],
    // 床上：原版村民也睡床，这里只是"站上去"（他下一秒就会走开）
    [footX, footY + 1, footZ],
  ];
  for (const [x, y, z] of candidates) {
    if (view.getBlock(x, y, z) !== Block.AIR) continue;
    if (!blockDef(view.getBlock(x, y - 1, z))?.solid) continue;
    return { x, y, z };
  }
  return null;
}

/**
 * 排一遍"这个区块里该站着哪些村民"。
 *
 * 调用时机：区块**加载之后**（主线程），与"填充战利品箱""扫避雷针"同一个位置
 * （那两件事也在这儿，因为它们是"方块已经在了，但还需要有人管一下"的那一类）。
 */
export function planVillagePopulation(
  view: VillageWorldView,
  cx: number,
  cz: number,
): VillagerSpawn[] {
  const originX = cx * 16;
  const originZ = cz * 16;
  const plans: VillagerSpawn[] = [];

  for (let y = WORLD_MIN_Y; y <= WORLD_MAX_Y; y++) {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = originX + lx;
        const z = originZ + lz;
        // 一张床只算一次：认**床脚**那一半（`facing` 指向床头，所以另一半是床头）
        if (!isBed(view.getBlock(x, y, z))) continue;
        if (isBedHead(view.getState(x, y, z))) continue;
        if (plans.length >= POPULATION_MAX_PER_CHUNK) return plans;

        const spot = villagerSpotNearBed(view, x, y, z);
        if (!spot) continue;
        // 这一带已经有人了：多半是"区块卸载又加载"，别把人越刷越多
        if (view.villagerNear?.(spot.x, spot.y, spot.z, POPULATION_DUPLICATE_RADIUS)) continue;

        const station = findWorkstationNear(view.getBlock, spot.x + 0.5, spot.y, spot.z + 0.5);
        plans.push({
          x: spot.x,
          y: spot.y,
          z: spot.z,
          professionId: station ? (professionForWorkstation(station.block)?.id ?? null) : null,
          workstation: station ? { x: station.x, y: station.y, z: station.z } : null,
          bedX: x,
          bedY: y,
          bedZ: z,
        });
      }
    }
  }
  return plans;
}
