/**
 * 世界统计（批次 552）
 *
 * 只记**玩家实际做过的动作**，不做排行榜、不做成就判定：
 *  - 挖掉的方块 / 放下的方块；
 *  - 击杀的生物 / 死亡次数；
 *  - 水平移动距离；
 *  - 游玩秒数。
 *
 * 值都进世界存档（`PlayerSave.statistics`），所以换设备/重进世界还接着算。
 * 纯数据 + 纯函数，主程序只负责在事件点调 `add`，面板只负责画。
 */

import { tp } from '../i18n/I18n.ts';

export interface StatisticsData {
  blocksMined: number;
  blocksPlaced: number;
  mobsKilled: number;
  deaths: number;
  /** 水平移动距离（格） */
  distance: number;
  /** 游玩秒数（本世界累计） */
  playSeconds: number;
}

export function emptyStatistics(): StatisticsData {
  return { blocksMined: 0, blocksPlaced: 0, mobsKilled: 0, deaths: 0, distance: 0, playSeconds: 0 };
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 读档清洗：缺字段/脏数据一律归 0，不让一条坏记录把整个存档读崩 */
export function normalizeStatistics(raw: unknown): StatisticsData {
  const data = (raw ?? {}) as Partial<StatisticsData>;
  return {
    blocksMined: finiteNonNegative(data.blocksMined),
    blocksPlaced: finiteNonNegative(data.blocksPlaced),
    mobsKilled: finiteNonNegative(data.mobsKilled),
    deaths: finiteNonNegative(data.deaths),
    distance: finiteNonNegative(data.distance),
    playSeconds: finiteNonNegative(data.playSeconds),
  };
}

export class Statistics {
  readonly data: StatisticsData = emptyStatistics();

  add(key: Exclude<keyof StatisticsData, 'distance' | 'playSeconds'>, amount = 1): void {
    if (!(amount > 0)) return;
    this.data[key] += amount;
  }

  /** 按实际水平位移累加（不做开方，避免每帧一次 hypot 的开销） */
  addDistance(dx: number, dz: number): void {
    const distance = Math.hypot(dx, dz);
    if (Number.isFinite(distance) && distance > 0) this.data.distance += distance;
  }

  addPlayTime(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.data.playSeconds += seconds;
  }

  serialize(): StatisticsData {
    return { ...this.data };
  }

  restore(raw: unknown): void {
    Object.assign(this.data, normalizeStatistics(raw));
  }

  reset(): void {
    Object.assign(this.data, emptyStatistics());
  }
}

/** 面板用：把秒数格式化成“x 小时 y 分” */
export function formatPlayTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  // 单位与语序进表（多语言 P3-4）：英文是 "1 h 2 min"、中文是 "1 小时 2 分"，
  // 缩写与语序都不该写死在代码里
  if (hours > 0) return tp('time.hoursMinutes', { h: hours, m: minutes });
  if (minutes > 0) return tp('time.minutesSeconds', { m: minutes, s: total % 60 });
  return tp('time.seconds', { n: total });
}
