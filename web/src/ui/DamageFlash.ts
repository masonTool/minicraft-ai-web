/**
 * 受伤红闪（批次 234）
 *
 * 原版掉血时屏幕边缘会闪一下红（中心基本透明，越靠边越红）。它不是"滤镜"，
 * 而是**一次很短的事件反馈**：0.3 秒内衰减完，玩家能注意到"我挨打了"，
 * 但不会把画面糊住。
 *
 * 为什么放 DOM 里而不是 `ScreenEffects`（那个 WebGL 色罩）：
 *  - 色罩同一时刻只能表达**一种环境**（水/岩浆/传送门），红闪是叠加在它们之上的**事件**；
 *  - DOM 层的 `opacity` 变化只走合成器，掉血那几帧几乎没有开销；
 *  - 手机上 DOM 与画布的层叠关系已经排好，镇在 HUD 下面即可。
 *
 * 这一层只做三件事：算强度、按帧衰减、写 `opacity`。判定（"这次到底掉没掉血"）
 * 不在这里——伤害流水只有 `PlayerStats` 说了算。
 */

/**
 * 衰减速度（每秒）。
 *
 * 批次 236 从 3.4 降到 2.6：3.4 的时候 1 点伤害只闪 0.14 秒，
 * 手机上一眨眼就没了（用户："效果太不明显"）。现在最短也有 0.25 秒左右。
 */
export const DAMAGE_FLASH_DECAY = 2.6;

/**
 * 基础强度：哪怕只掉半点血也要看得见。
 *
 * 批次 236 从 0.32 提到 0.6——0.32 在明亮的户外几乎看不出来。
 */
const BASE_STRENGTH = 0.6;

/**
 * 伤害点数 → 红闪强度（0~1）。
 *
 * 5 点（两格半心）就接近满强度，8 点封顶。不做线性 1:1：8 点与 20 点看起来应该一样"红"，
 * 否则被苦力怕炸一下会整屏发黑红、什么都看不见。
 */
export function damageFlashStrength(amount: number): number {
  if (!(amount > 0)) return 0;
  return Math.min(1, BASE_STRENGTH + amount / 6);
}

/** 一帧之后的强度（下限 0） */
export function decayDamageFlash(value: number, dt: number): number {
  if (!(value > 0)) return 0;
  return Math.max(0, value - DAMAGE_FLASH_DECAY * Math.max(0, dt));
}

export class DamageFlash {
  private value = 0;
  /** 上一次写进 DOM 的值：只在变化时写 style（每帧写一次也不算贵，但没必要） */
  private written = -1;

  constructor(private readonly element: HTMLElement | null) {}

  /** 当前强度（测试与调试用） */
  get intensity(): number {
    return this.value;
  }

  /** 记一次受伤。同一帧挨好几下只按"总伤害"闪一次（由调用方汇总后传进来） */
  hit(amount: number): void {
    const next = damageFlashStrength(amount);
    if (next > this.value) this.value = next;
  }

  /** 按帧衰减并写回 DOM；强度归零时把元素彻底收掉（不再产生任何样式写入） */
  update(dt: number): void {
    if (this.value <= 0) return;
    this.value = decayDamageFlash(this.value, dt);
    const rounded = Math.round(this.value * 100) / 100;
    if (rounded === this.written) return;
    this.written = rounded;
    if (this.element) this.element.style.opacity = String(rounded);
  }

  /** 重生 / 退出世界：立刻收掉（不带淡出） */
  reset(): void {
    this.value = 0;
    if (this.written === 0) return;
    this.written = 0;
    if (this.element) this.element.style.opacity = '0';
  }
}
