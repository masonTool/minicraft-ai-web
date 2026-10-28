/**
 * 药水云（K4 尾巴）：滞留药水砸出来的云，以及末影龙吐出来的血息云
 *
 * 与原版对齐的四条：
 *  - **半径 3 格**（喷溅是 4 格）、**原地停留 30 秒**、**每 0.5 秒结算一次**
 *  - 半径随时间收缩（原版 `-0.005 格/tick` = `-0.1 格/秒`，30 秒正好缩没了）
 *  - 云里的实体被反复挂效果，时长按 **`1 - 距离/半径`** 缩
 *    （与喷溅共用 `SplashPotion.splashEffectsAt`，只是半径换成云半径）
 *  - 龙息云特殊：每 0.5 秒对云里的实体直接造成 **6 点伤害**（原版数值），**不按距离缩**
 *
 * 为什么**不做成实体**：原版的药水云只有"效果 + 粒子"，没有碰撞盒、不参与物理，
 * 做成实体反而要接线渲染、存档、联机三处。这里就是主程序持有的一个小状态对象；
 * "谁在云里"依旧由主程序回答（与 `applySplash` 同一个分工），于是范围与节奏都能离线断言。
 */

import { splashEffectsAt, type SplashEffect } from './SplashPotion.ts';
import { potionById } from '../registry/potions.ts';

/** 滞留药水的云半径（格，原版 3） */
export const LINGERING_RADIUS = 3;
/** 云的存活时长（秒，原版 600 tick） */
export const CLOUD_DURATION = 30;
/** 结算间隔（秒，原版 `reapplicationDelay` 0.5 秒） */
export const CLOUD_PULSE_INTERVAL = 0.5;
/** 半径收缩速度（格/秒，原版 `-0.005 格/tick`） */
export const CLOUD_RADIUS_SHRINK = 0.1;
/** 龙息云的半径（格，原版同样是 3） */
export const DRAGON_BREATH_RADIUS = 3;
/** 龙息每次结算的伤害（原版 6 点，不按距离缩） */
export const DRAGON_BREATH_DAMAGE = 6;
/**
 * 接一瓶龙息会让云缩小多少（格，原版 `radiusOnUse = -0.5`）。
 * 不做这一步的话，一片云能被无限接，龙息立刻变得一文不值。
 */
export const DRAGON_BREATH_COLLECT_SHRINK = 0.5;

export type CloudKind = 'lingering' | 'dragon_breath';

export interface PotionCloud {
  readonly kind: CloudKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly duration: number;
  /** 药水云对应的药水（龙息云没有） */
  readonly potionId?: number;
  /** 当前半径（随时间收缩） */
  radius: number;
  /** 已经存在多久（秒） */
  age: number;
  /** 距离下一次结算还有多久（秒） */
  pulseTimer: number;
  /** 已经结算过的次数（调试与断言用） */
  pulses: number;
}

function cloudBase(kind: CloudKind, radius: number, x: number, y: number, z: number, potionId?: number): PotionCloud {
  return {
    kind,
    x,
    y,
    z,
    duration: CLOUD_DURATION,
    potionId,
    radius,
    age: 0,
    // 第一口立刻结算：砸下去就见效，与原版"云一出现就开始作用"一致
    pulseTimer: 0,
    pulses: 0,
  };
}

/** 滞留药水砸出来的云 */
export function createLingeringCloud(potionId: number, x: number, y: number, z: number): PotionCloud {
  return cloudBase('lingering', LINGERING_RADIUS, x, y, z, potionId);
}

/** 末影龙吐出来的血息云（里面能接龙息，见主程序的"空瓶接龙息"） */
export function createDragonBreathCloud(x: number, y: number, z: number): PotionCloud {
  return cloudBase('dragon_breath', DRAGON_BREATH_RADIUS, x, y, z);
}

/**
 * 推进一片云。
 * @returns `alive` 为 false 时主程序应把它丢掉；`pulse` 为 true 表示这一帧要结算一次
 */
export function tickCloud(cloud: PotionCloud, dt: number): { alive: boolean; pulse: boolean } {
  cloud.age += dt;
  if (cloud.age >= cloud.duration) return { alive: false, pulse: false };

  // 收缩：半径线性减小，但不小于 0（0 半径的云已经什么都罩不住了）
  cloud.radius = Math.max(0, cloud.radius - CLOUD_RADIUS_SHRINK * dt);

  cloud.pulseTimer -= dt;
  if (cloud.pulseTimer > 0) return { alive: true, pulse: false };
  // 用"加上间隔"而不是"归零"：帧率低的时候也不会漏结算（否则 dt 一大就少算几次）
  cloud.pulseTimer += CLOUD_PULSE_INTERVAL;
  cloud.pulses += 1;
  return { alive: true, pulse: true };
}

/**
 * 某处会拿到什么效果（`distance` 是到云心的距离）。
 * 半径已经缩到 0、超出半径、或者这瓶药水不存在时返回空数组。
 */
export function cloudEffectsAt(cloud: PotionCloud, distance: number): SplashEffect[] {
  if (cloud.radius <= 0) return [];
  const potion = cloud.potionId === undefined ? undefined : potionById(cloud.potionId);
  if (!potion) return [];
  return splashEffectsAt(potion, distance, cloud.radius);
}

/** 龙息云的"接一瓶龙息"判定：站在云里、手上有空瓶就能接（原版就是这么收集的） */
export function canCollectDragonBreath(cloud: PotionCloud, distance: number): boolean {
  return cloud.kind === 'dragon_breath' && cloud.radius > 0 && distance <= cloud.radius;
}
