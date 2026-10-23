/**
 * TNT 的引信（批次 56）。
 *
 * 点燃之后 TNT 要"闪 4 秒再炸"，这件事需要**跨帧的运行时状态**。
 * 原版把它做成了一个**实体**（`PrimedTnt`：会掉下去、能被推动、渲染时叠白）；
 * 本项目这里选择**仍然是方块 + 一张引信表**：
 *
 *  - 好处：不用给实体渲染器加一个新模型，也不会牵动"方块变实体"那条链
 *    （我们要的是"爆炸"这件事本身，它已经有现成的 `explodeAt`）
 *  - 代价（已记进 TASKS B30）：引信中的 TNT **不会掉下去**，
 *    也不会被活塞推动（原版会）
 *
 * 闪烁用**状态位翻相位**实现：每 0.2 秒翻一次 `flash` 位，
 * `stateTiles` 据此在"正常贴图"与"发白贴图"之间换——原版是渲染时叠白，观感一致。
 *
 * 这个模块**不依赖 main**（只依赖方块表），所以能离线测：
 * 世界能力收在一个 `TntWorld` 接口里，爆炸本身是**回调**（main 传 `explodeAt` 进来）。
 */

import { Block, blockDef } from '../registry/blocks.ts';
import { isFlash, isPowered, withFlash, withPowered } from '../registry/blockState.ts';

/** 引信时长（秒）：原版 TNT 就是 4 秒（80 tick） */
export const TNT_FUSE_SECONDS = 4;

/** 闪烁的相位间隔（秒）：原版大约是每 4 tick 翻一次，取个看得清的 0.2 */
export const TNT_FLASH_INTERVAL = 0.2;

/** 爆炸威力：原版 TNT 是 4（苦力怕是 3） */
export const TNT_POWER = 4;

/** 引信模块需要的世界能力（离线测试塞 stub） */
export interface TntWorld {
  getBlock(x: number, y: number, z: number): number;
  getState(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number, state: number): boolean;
  setState(x: number, y: number, z: number, state: number): boolean;
}

function keyOf(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function parseKey(key: string): [number, number, number] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

export class PrimedTnt {
  /** 每个已点燃的 TNT 还剩多少秒（key = 坐标） */
  private readonly fuses = new Map<string, number>();
  /** 每个已点燃的 TNT 距离下次翻相位还有多少秒 */
  private readonly flashTimers = new Map<string, number>();
  /** 统计：本次会话引爆过多少个（调试面板与断言用） */
  ignited = 0;
  /**
   * 真的点燃了一格（联机23 的联机同步出口）。
   *
   * 放在这里而不是每个点燃入口各写一遍：点燃 TNT 的路径有玩家点、红石、爆炸波及等
   * 四处，逐处挂钩必然漏；而 `prime` 本身是幂等的，接在它后面最稳。
   */
  onPrime: ((x: number, y: number, z: number) => void) | null = null;

  /**
   * 点燃一格 TNT（**幂等**：已经点着的返回 false，不会把引信重置）。
   *
   * @returns 这一次是不是真的点燃了
   */
  prime(world: TntWorld, x: number, y: number, z: number): boolean {
    if (world.getBlock(x, y, z) !== Block.TNT) return false;
    const key = keyOf(x, y, z);
    if (this.fuses.has(key)) return false;
    this.fuses.set(key, TNT_FUSE_SECONDS);
    this.flashTimers.set(key, TNT_FLASH_INTERVAL);
    // 立刻把 `powered` 位点亮（渲染与红石调试都看它："这一格已经被点燃了"）
    world.setState(x, y, z, withPowered(world.getState(x, y, z), true));
    // 联机23：真的点燃了才通知（幂等返回 false 的那些不会重复发）
    this.onPrime?.(x, y, z);
    return true;
  }

  /** 这一格是不是正在引信中 */
  isPrimed(x: number, y: number, z: number): boolean {
    return this.fuses.has(keyOf(x, y, z));
  }

  /** 还剩多少秒（没点燃返回 -1）——调试面板与断言的抓手 */
  fuseOf(x: number, y: number, z: number): number {
    return this.fuses.get(keyOf(x, y, z)) ?? -1;
  }

  /** 正在引信中的 TNT 个数 */
  count(): number {
    return this.fuses.size;
  }

  /** 清空（换维度/重开世界时用） */
  clear(): void {
    this.fuses.clear();
    this.flashTimers.clear();
  }

  /**
   * 推进所有引信。
   *
   * @param explode 到点了就调它（main 传的是 `explodeAt`）——本模块不认识"爆炸"是什么
   * @returns 这一帧炸了几个
   */
  update(
    dt: number,
    world: TntWorld,
    explode: (x: number, y: number, z: number, power: number) => void,
  ): number {
    let fired = 0;
    for (const [key, remaining] of [...this.fuses]) {
      const [x, y, z] = parseKey(key);
      // 方块被挖掉/炸掉/换成了别的东西：引信作废（否则会凭空炸一格空气）
      if (world.getBlock(x, y, z) !== Block.TNT) {
        this.fuses.delete(key);
        this.flashTimers.delete(key);
        continue;
      }
      const left = remaining - dt;
      if (left <= 0) {
        this.fuses.delete(key);
        this.flashTimers.delete(key);
        // 先把这一格清掉：爆炸本身会处理周围的方块（不清的话会留下一格"炸不掉的 TNT"）
        world.setBlock(x, y, z, Block.AIR, 0);
        explode(x + 0.5, y + 0.5, z + 0.5, TNT_POWER);
        this.ignited++;
        fired++;
        continue;
      }
      this.fuses.set(key, left);

      // 闪烁：每 0.2 秒翻一次相位
      const flashLeft = (this.flashTimers.get(key) ?? TNT_FLASH_INTERVAL) - dt;
      if (flashLeft <= 0) {
        this.flashTimers.set(key, TNT_FLASH_INTERVAL);
        const state = world.getState(x, y, z);
        world.setState(x, y, z, withFlash(state, !isFlash(state)));
      } else {
        this.flashTimers.set(key, flashLeft);
      }
    }
    return fired;
  }
}

/**
 * 引信中的 TNT 该显示成什么样（贴图按状态取）。
 * 导出是为了让断言能直接验"闪的相位真的会换贴图"，而不必去构造图集。
 */
export function tntTiles(state: number): readonly [string, string, string] {
  const def = blockDef(Block.TNT);
  return def.stateTiles ? def.stateTiles(state) : def.tiles;
}

/** 这一格 TNT 是不是"已点燃"（`powered` 位；红石引擎与渲染共用它） */
export function isTntPrimed(state: number): boolean {
  return isPowered(state);
}
