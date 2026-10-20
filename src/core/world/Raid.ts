/**
 * 村庄袭击（批次 475，J24 的后半）
 *
 * 原版规则（本项目只取主干）：
 *  1. 玩家带着**不祥之兆**走进村庄 → 袭击开始，效果被消耗；
 *  2. 一共 3 波（原版 3~7，随难度），每波从村庄**边缘**刷出一批劫掠者；
 *  3. 当前波清空 → 隔 5 秒下一波；三波全清 → 胜利，给"村庄英雄"；
 *  4. 4 分钟没打完 → 失败（原版也是这样：守不住就散）。
 *
 * 为什么做成**独立的纯逻辑类**：波次推进、击杀计数、超时这三件事全是"状态机"，
 * 放在 main 里会跟实体表、渲染、HUD 缠在一起，一条断言都写不了。
 * 这里只吐"该生成什么 / 该结束了"，谁去造实体、谁去发效果由调用方决定。
 *
 * ⚠️ 与原版的差异（写进 TASKS J24）：
 *  - 只有 3 波、每波 2~4 只，没有"随难度加波"；
 *  - 不刷劫掠兽（没有那个生物）、不刷"女巫骑着劫掠兽"那种组合；
 *  - 掠夺者的**队长旗帜**与"击杀队长才给不祥之兆"没接（见 main 里的简化）。
 */

/** 一波里会出现哪些劫掠者（纯数据；生成实体是调用方的事） */
export interface RaidRaiderSpec {
  readonly kind: 'pillager' | 'vindicator' | 'evoker';
  readonly count: number;
}

/** 袭击的三种状态：进行中 / 守住了 / 散了 */
export type RaidState = 'active' | 'won' | 'lost';

/** 一共几波（原版 3~7，这里固定 3——难度系统还没做） */
export const RAID_TOTAL_WAVES = 3;
/** 两波之间的空档（秒） */
export const RAID_WAVE_DELAY = 5;
/** 整场袭击的时限（秒）：原版 4 分钟 */
export const RAID_TIMEOUT_SECONDS = 240;
/** 袭击的半径：生成与"还算在村里"都用它 */
export const RAID_RADIUS = 48;

/** 第 n 波（1 起）的清单 */
export function raidWaveSpec(wave: number): RaidRaiderSpec[] {
  if (wave <= 1) return [{ kind: 'pillager', count: 3 }];
  if (wave === 2) {
    return [
      { kind: 'pillager', count: 3 },
      { kind: 'vindicator', count: 1 },
    ];
  }
  return [
    { kind: 'pillager', count: 2 },
    { kind: 'vindicator', count: 1 },
    { kind: 'evoker', count: 1 },
  ];
}

/** 这一波一共几只 */
export function waveSize(specs: readonly RaidRaiderSpec[]): number {
  return specs.reduce((sum, spec) => sum + spec.count, 0);
}

export class Raid {
  /** 当前第几波（1 起；0 = 还没开始） */
  wave = 0;
  state: RaidState = 'active';
  /** 已经打了多少秒 */
  elapsed = 0;
  /** 当前波还活着几只 */
  private alive = 0;
  /** 当前波清空的时刻（用来算波间隔） */
  private clearedAt = -1;

  constructor(
    readonly centerX: number,
    readonly centerZ: number,
    readonly totalWaves = RAID_TOTAL_WAVES,
  ) {}

  /** 已经干掉几只（只统计本次袭击里的） */
  kills = 0;

  /** 开第一波；返回要生成的清单 */
  start(): RaidRaiderSpec[] {
    this.wave = 1;
    const specs = raidWaveSpec(1);
    this.alive = waveSize(specs);
    return specs;
  }

  /**
   * 一只劫掠者死了。
   *
   * 只认"当前波数的减少"——主程序可能在袭击结束后才处理掉死亡的实体，
   * 那时 `alive` 已经归零，再减就成了负数（胜利判定会永远差一只）。
   */
  onRaiderKilled(): void {
    if (this.state !== 'active') return;
    this.kills++;
    if (this.alive > 0) this.alive--;
    if (this.alive === 0) this.clearedAt = this.elapsed;
  }

  /**
   * 推进一帧。
   *
   * @returns
   *  - `'spawn-next'`：该开下一波了（调用方调 `nextWave()` 拿清单）
   *  - `'won'` / `'lost'`：结束（调用方负责发效果、清理）
   *  - `null`：还在打
   */
  tick(dt: number): 'spawn-next' | 'won' | 'lost' | null {
    if (this.state !== 'active') return null;
    this.elapsed += dt;
    if (this.elapsed >= RAID_TIMEOUT_SECONDS) {
      this.state = 'lost';
      return 'lost';
    }
    if (this.alive > 0) return null;
    // 当前波清空
    if (this.wave >= this.totalWaves) {
      this.state = 'won';
      return 'won';
    }
    if (this.clearedAt >= 0 && this.elapsed - this.clearedAt >= RAID_WAVE_DELAY) {
      return 'spawn-next';
    }
    return null;
  }

  /** 开下一波（由 `tick` 返回 `'spawn-next'` 之后调用）；返回该波的清单 */
  nextWave(): RaidRaiderSpec[] {
    this.wave = Math.min(this.totalWaves, this.wave + 1);
    const specs = raidWaveSpec(this.wave);
    this.alive = waveSize(specs);
    this.clearedAt = -1;
    return specs;
  }

  /** 立刻结束（玩家跑远 / 死亡 / 主动取消） */
  abandon(): void {
    if (this.state === 'active') this.state = 'lost';
  }

  /** 当前波还剩几只（HUD 用） */
  get remaining(): number {
    return this.alive;
  }

  /** 剩余秒数（HUD 用） */
  get remainingSeconds(): number {
    return Math.max(0, RAID_TIMEOUT_SECONDS - this.elapsed);
  }
}

/**
 * 这次击杀该不该记进袭击（批次 475）。
 *
 * 判据两条：是一只**劫掠者**，且**在袭击半径内**——后者很重要：
 * 玩家在别处顺手打了只掠夺者，不该让远处的袭击少一只。
 */
export function countsAsRaidKill(kind: string, x: number, z: number, raid: Raid | null): boolean {
  if (!raid || raid.state !== 'active') return false;
  if (kind !== 'pillager' && kind !== 'vindicator' && kind !== 'evoker') return false;
  return Math.hypot(x - raid.centerX, z - raid.centerZ) <= RAID_RADIUS;
}
