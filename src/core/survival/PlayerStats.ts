/**
 * 玩家生存状态：生命 / 饥饿 / 饱和度 / 疲劳值 / 氧气
 *
 * 数值与节奏对齐原版（普通难度）：
 *  - 生命上限 20（10 颗心，1 点 = 半颗心）、饥饿上限 20、饱和度上限 5（浮点）
 *  - **疲劳值**（exhaustion）是隐藏的"饥饿预算"：走路每格 0.01、疾跑每格 0.1、
 *    跳跃 0.05（疾跑跳 0.2）、挖掘 0.005、攻击 0.1、受伤 0.1；
 *    攒满 4.0 就扣 1 点饥饿（先扣饱和度，再扣饥饿值）
 *  - **自然回复**：饥饿 ≥ 18 且未满血时，有饱和度每 10 tick 回 1 点（并扣 6 疲劳），
 *    没饱和度每 80 tick 回 1 点
 *  - **饿死**：饥饿为 0 时每 80 tick 掉 1 点生命
 *  - **溺水**：水下氧气 300 tick（15 秒），耗尽后每 20 tick 受 1 点伤害；出水每 tick 回 4
 *  - **摔落**：下落超过 3 格后落地，伤害 = 下落格数 - 3
 *  - **岩浆**：每 10 tick 4 点（受无敌帧限制）；仙人掌 1 点；窒息 1 点；虚空每 tick 4 点
 *  - **无敌帧**：受伤后 10 tick 内不再受伤（除非新伤害更大）
 *
 * 该模块不依赖 DOM，可直接在离线脚本里测。
 */

export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;
export const MAX_SATURATION = 5;
export const MAX_AIR = 300;

/** 受伤后的无敌帧（tick） */
const HURT_RESISTANT_TICKS = 10;
/** 虚空伤害的起始高度（原版 y=-64 以下开始掉血） */
export const VOID_DAMAGE_Y = -70;

export type DamageCause =
  | 'poison'
  | 'fall'
  | 'drown'
  | 'lava'
  | 'fire'
  | 'cactus'
  | 'suffocate'
  | 'starve'
  | 'void'
  | 'generic';

/** 每 tick 从主循环传入的环境快照 */
export interface SurvivalEnvironment {
  /** 眼睛在水里（决定是否消耗氧气） */
  eyeInWater: boolean;
  /** 身体泡在岩浆里 */
  inLava: boolean;
  /** 身体贴着仙人掌 */
  onCactus: boolean;
  /** 身体被不透明方块压住（窒息） */
  suffocating: boolean;
  /** 本 tick 的落地高度（未落地为 0） */
  fallDistance: number;
  y: number;
  /** 创造模式：不受伤、不消耗饥饿、不会饿死 */
  creative: boolean;
  /** 饥饿值高时是否自然回血（游戏规则 naturalRegeneration，缺省开） */
  naturalRegeneration?: boolean;
  /** 自然回复的间隔倍率（难度；越小回得越快，缺省 1） */
  regenRate?: number;
  /** 饿死的速率倍率（难度；0 = 饿不死，缺省 1） */
  starveRate?: number;
  /** 水下呼吸（状态效果，缺省 false）：有它就不消耗氧气 */
  waterBreathing?: boolean;
  /** 抗火（状态效果，缺省 false）：岩浆不造成伤害 */
  fireImmune?: boolean;
}

export interface DamageResult {
  /** 实际扣掉的生命值 */
  applied: number;
  cause: DamageCause;
  /** 是否致死 */
  fatal: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class PlayerStats {
  health = MAX_HEALTH;
  food = MAX_FOOD;
  saturation = MAX_SATURATION;
  air = MAX_AIR;

  /** 疲劳值（隐藏数值，攒满 4 扣 1 饥饿） */
  exhaustion = 0;

  private hurtResistantTime = 0;
  private foodTickTimer = 0;
  private drownTickTimer = 0;
  private lavaTickTimer = 0;

  /** 最近一次受伤（HUD 抖动 / 调试面板用） */
  lastDamage: DamageResult | null = null;
  /** 累计受到的伤害，用于测试与统计 */
  totalDamage = 0;

  get dead(): boolean {
    return this.health <= 0;
  }

  get healthRatio(): number {
    return clamp(this.health / MAX_HEALTH, 0, 1);
  }

  /** 是否处于无敌帧 */
  get invulnerable(): boolean {
    return this.hurtResistantTime > 0;
  }

  /** 吃下食物（恢复饥饿与饱和度） */
  eat(food: number, saturation: number): void {
    this.food = clamp(this.food + food, 0, MAX_FOOD);
    this.saturation = clamp(this.saturation + saturation, 0, MAX_SATURATION);
  }

  heal(amount: number): void {
    if (this.dead) return;
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  /**
   * 施加伤害。受无敌帧限制：无敌期间只有更高的伤害才能覆盖。
   * @returns 实际结算的伤害（被无敌帧挡下时为 0）
   */
  damage(amount: number, cause: DamageCause): DamageResult {
    const result: DamageResult = { applied: 0, cause, fatal: false };
    if (this.dead || amount <= 0) return result;

    if (this.hurtResistantTime > 0 && amount <= this.lastDamageAmount) return result;

    this.hurtResistantTime = HURT_RESISTANT_TICKS;
    this.lastDamageAmount = amount;
    this.health = Math.max(0, this.health - amount);
    this.totalDamage += amount;
    result.applied = amount;
    result.fatal = this.health <= 0;
    this.lastDamage = result;
    // 受伤本身也消耗疲劳值（原版 0.1）
    this.addExhaustion(0.1);
    return result;
  }

  private lastDamageAmount = 0;

  /**
   * 疲劳值累积。攒满 4 点就消耗 1 点饱和度；饱和度空了才开始扣饥饿值。
   * 这是原版"吃饱了也能跑很久"的手感来源。
   */
  addExhaustion(amount: number): void {
    if (amount <= 0) return;
    this.exhaustion += amount;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
  }

  /** 每 tick 更新（20 次/秒） */
  tick(env: SurvivalEnvironment): void {
    if (this.dead) return;
    if (this.hurtResistantTime > 0) this.hurtResistantTime--;

    if (env.creative) {
      // 创造模式：饱食度、氧气都保持满值，也不会受伤
      this.food = MAX_FOOD;
      this.saturation = MAX_SATURATION;
      this.air = MAX_AIR;
      return;
    }

    this.tickAir(env);
    this.tickDamageSources(env);
    this.tickHunger(env);
  }

  /** 氧气：水下缓慢耗尽，耗尽后周期性溺水伤害 */
  private tickAir(env: SurvivalEnvironment): void {
    // 水下呼吸效果：氧气不掉（甚至回满）
    if (env.waterBreathing) {
      this.drownTickTimer = 0;
      this.air = MAX_AIR;
      return;
    }

    if (env.eyeInWater) {
      if (this.air > 0) {
        this.air--;
        this.drownTickTimer = 0;
      } else {
        this.drownTickTimer++;
        if (this.drownTickTimer >= 20) {
          this.drownTickTimer = 0;
          this.damage(1, 'drown');
        }
      }
      return;
    }

    this.drownTickTimer = 0;
    if (this.air < MAX_AIR) this.air = Math.min(MAX_AIR, this.air + 4);
  }

  /** 环境伤害：摔落 / 岩浆 / 仙人掌 / 窒息 / 虚空 */
  private tickDamageSources(env: SurvivalEnvironment): void {
    if (env.fallDistance > 3) {
      this.damage(Math.floor(env.fallDistance - 3), 'fall');
    }

    if (env.y <= VOID_DAMAGE_Y) {
      // 虚空伤害无视无敌帧（原版就是这样，掉出去必死）
      this.hurtResistantTime = 0;
      this.lastDamageAmount = 0;
      this.damage(4, 'void');
    }

    if (env.inLava && !env.fireImmune) {
      this.lavaTickTimer++;
      if (this.lavaTickTimer >= 10) {
        this.lavaTickTimer = 0;
        this.hurtResistantTime = 0;
        this.lastDamageAmount = 0;
        this.damage(4, 'lava');
      }
    } else {
      this.lavaTickTimer = 0;
    }

    if (env.onCactus) this.damage(1, 'cactus');
    if (env.suffocating) this.damage(1, 'suffocate');
  }

  /** 饥饿：自然回复 / 饿死 / 疲劳值结算（受游戏规则与难度影响） */
  private tickHunger(env: SurvivalEnvironment): void {
    const regenEnabled = env.naturalRegeneration ?? true;
    const regenRate = env.regenRate ?? 1;
    const starveRate = env.starveRate ?? 1;

    if (regenEnabled && this.food >= 18 && this.health < MAX_HEALTH) {
      this.foodTickTimer++;
      const base = this.saturation > 0 ? 10 : 80;
      const interval = Math.max(1, Math.round(base * regenRate));
      if (this.foodTickTimer >= interval) {
        this.foodTickTimer = 0;
        this.heal(1);
        this.addExhaustion(6);
      }
      return;
    }

    if (this.food <= 0 && starveRate > 0) {
      this.foodTickTimer++;
      const interval = Math.max(1, Math.round(80 / starveRate));
      if (this.foodTickTimer >= interval) {
        this.foodTickTimer = 0;
        // 饿死不受无敌帧保护（否则血量会在 10 tick 内不再下降）
        this.hurtResistantTime = 0;
        this.lastDamageAmount = 0;
        this.damage(1, 'starve');
      }
      return;
    }

    this.foodTickTimer = 0;
  }

  /**
   * 中毒伤害：**不会致死**（原版会把人打到剩半颗心就停）。
   * 凋零等其它持续伤害走普通 `damage`。
   */
  poisonDamage(amount: number): DamageResult {
    const result: DamageResult = { applied: 0, cause: 'poison', fatal: false };
    if (this.dead || amount <= 0) return result;
    if (this.health <= 1) return result;
    const applied = Math.min(amount, this.health - 1);
    this.health -= applied;
    this.totalDamage += applied;
    result.applied = applied;
    this.lastDamage = result;
    return result;
  }

  /** 重生：清空状态并回到满血 */
  respawn(): void {
    this.health = MAX_HEALTH;
    this.food = MAX_FOOD;
    this.saturation = MAX_SATURATION;
    this.air = MAX_AIR;
    this.exhaustion = 0;
    this.foodTickTimer = 0;
    this.drownTickTimer = 0;
    this.lavaTickTimer = 0;
    this.hurtResistantTime = 0;
    this.lastDamageAmount = 0;
    this.lastDamage = null;
  }
}
