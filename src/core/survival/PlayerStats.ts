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
 *  - **创造模式**：除**虚空**外免疫全部伤害（原版同口径：掉出世界仍会致死），
 *    饥饿 / 氧气 / 着火每 tick 复位成满值
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
/** 每 tick 的秒数（20Hz），着火计时用它 */
const TICK_SECONDS = 1 / 20;
/**
 * 站在火里被点燃的秒数（原版 `setSecondsOnFire(8)`）与伤害节奏（每 20 tick 1 点）。
 *
 * ⚠️ `core/world/Fire.ts` 里有同名的一份：生存模块不该反向依赖世界模块
 * （`Fire` 要用方块表与 `TickWorld`），所以两个数各写一份。
 * 两边必须一致——`tools/fire-test.ts` 用 `Fire.ts` 的常量去驱动 `PlayerStats`，
 * 改了一边不改另一边会当场失败。
 */
export const FIRE_IGNITE_SECONDS = 8;
export const FIRE_DAMAGE_INTERVAL_TICKS = 20;

export type DamageCause =
  | 'poison'
  /**
   * 凋零（批次 218）：与中毒同为"状态效果持续扣血"，但**能致死**、**无视护甲**。
   *
   * 以前它借用 `'generic'` 上报，左上角只能显示"受到伤害（没有记录到来源）"——
   * 用户"站在草地上突然一直掉血到死、提示查不出原因"就是这么来的。
   */
  | 'wither'
  | 'fall'
  | 'drown'
  | 'lava'
  | 'fire'
  | 'cactus'
  | 'suffocate'
  | 'starve'
  | 'void'
  /** 爆炸（苦力怕/TNT）：火焰保护与爆炸保护要靠它区分 */
  | 'explosion'
  /** 弹射物（箭矢）：弹射物保护要靠它区分；骷髅目前还是近战，暂时没有来源 */
  | 'projectile'
  /**
   * 雷击（批次 83）：**无视护甲**（原版 `#bypasses_armor` 里有 lightning_bolt），
   * 所以它同时是"第一个进了 `ARMOR_BYPASS_CAUSES` 的外部伤害"。
   */
  | 'lightning'
  | 'generic';

/** 每 tick 从主循环传入的环境快照 */
export interface SurvivalEnvironment {
  /** 眼睛在水里（决定是否消耗氧气） */
  eyeInWater: boolean;
  /** 身体泡在岩浆里 */
  inLava: boolean;
  /** 身体所在格是火方块（会被点燃，见 I12） */
  inFire?: boolean;
  /** 身体贴着仙人掌 */
  onCactus: boolean;
  /**
   * **脚底下踩着岩浆块**（批次 121，原版：每秒 1 点**火焰伤害**）。
   *
   * 与 `onCactus` 分开写，因为两者的判据不同：仙人掌是"身体**贴着**它"，
   * 岩浆块是"**站在它上面**"（它自己就是那一格地面）。也不同于 `inFire`：
   * 岩浆块**不会把人点着**，只是持续烫——所以"抗火"能挡它（走 `'fire'` 那条 source）。
   */
  onMagma?: boolean;
  /** 身体被不透明方块压住（窒息） */
  suffocating: boolean;
  /** 本 tick 的落地高度（未落地为 0） */
  fallDistance: number;
  y: number;
  /** 创造模式：不受伤、不消耗饥饿、不会饿死、不溺水（**虚空除外**，原版同口径） */
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
  /**
   * 摔落保护附魔等级（批次 243，0~4）：每级少受 12% 摔落伤害（封顶 48%）。
   * 由主程序从**靴子**上读，生存模块不认识背包。
   */
  featherFalling?: number;
  /** 水下呼吸附魔等级（批次 243，0~3）：每级把氧气消耗速度降到 1/(1+0.5·等级) */
  respiration?: number;
}

/**
 * 摔落伤害（批次 243，把"摔落保护"接上）。
 *
 * 原版公式：`⌊(落差 - 3) × (1 - 12% × 等级)⌋`，等级封顶 4（48%）。
 * 抽成纯函数是因为有两个入口——普通落地（这里）与末影珍珠那 5 点
 * （`main.teleportByEnderPearl`）——两处各写一遍公式迟早会漂。
 */
export function fallDamageFor(distance: number, featherFalling = 0): number {
  if (!(distance > 3)) return 0;
  return featherFallDamage(distance - 3, featherFalling);
}

/** 蜜块减伤系数（批次 450）：落在蜜块上只受 20% 摔落伤害（原版减 80%） */
export const HONEY_FALL_FACTOR = 0.2;

/**
 * 落在蜜块上的"等效下落高度"（批次 450）。
 *
 * 为什么不直接乘伤害：伤害公式里有那个 **3 格免伤门槛**（`distance - 3`），
 * 先乘伤害会把门槛也一起缩掉（4 格摔落本该免伤，乘完反而不足 1 点）。
 * 所以缩的是"门槛以上的那一段高度"：`3 + (d-3)×0.2`——
 * 于是 10 格摔落按 4.4 格算，伤害从 7 点降到 1 点，与原版量级一致。
 */
export function honeyFallDistance(distance: number): number {
  if (!(distance > 3)) return distance;
  return 3 + (distance - 3) * HONEY_FALL_FACTOR;
}

/** 一次摔落伤害经过摔落保护之后的数值（已取整） */
/**
 * 深海探索者的水下移速倍率（批次 262）。
 *
 * 原版每级把"水的阻力"削掉三分之一，等价于游泳速度 ×(1 + 等级/3)，
 * 封顶 2 倍（III 级正好封顶）。
 */
export function depthStriderMultiplier(level: number): number {
  const clamped = Math.max(0, Math.min(3, Math.floor(level)));
  return clamped <= 0 ? 1 : Math.min(2, 1 + clamped / 3);
}

/**
 * 灵魂疾行的移速倍率（批次 262）。
 *
 * 原版在灵魂沙/灵魂土上是 1.3 / 1.6 / 1.9 倍，这里直接用 `1 + 0.3 × 等级`。
 */
/**
 * 冰霜行者的结冰半径（批次 263）。
 *
 * 原版 I 级 2 格、II 级 3 格（以玩家为中心的正方形半径），0 级不结冰。
 * 抽成纯函数是为了让"II 级比 I 级宽一格"这条能离线断言。
 */
/**
 * 荆棘的反伤数值（批次 264）。
 *
 * ⚠️ 与原版的差异：原版是**任意等级都随机 1~4 点**，这里改成"等级 = 伤害"
 * （I/II/III = 1/2/3）——固定值才能离线断言，也不会让 I 级荆棘突然打出 4 点。
 */
export function thornsDamage(level: number): number {
  const clamped = Math.max(0, Math.min(3, Math.floor(level)));
  return clamped;
}

export function frostWalkerRadius(level: number): number {
  const clamped = Math.max(0, Math.min(2, Math.floor(level)));
  return clamped <= 0 ? 0 : clamped + 1;
}

export function soulSpeedMultiplier(level: number): number {
  const clamped = Math.max(0, Math.min(3, Math.floor(level)));
  return clamped <= 0 ? 1 : 1 + clamped * 0.3;
}

export function featherFallDamage(amount: number, featherFalling = 0): number {
  const reduction = Math.min(0.48, 0.12 * Math.max(0, Math.floor(featherFalling)));
  return Math.max(0, Math.floor(amount * (1 - reduction)));
}

export interface DamageResult {
  /** 实际扣掉的生命值（护甲减伤后的净值） */
  applied: number;
  cause: DamageCause;
  /** 更具体的来源（生物名 / 弹射物名 / "世界边界"…）；环境伤害通常为空 */
  source?: string;
  /** 是否致死 */
  fatal: boolean;
}

/**
 * 一次已经结算的伤害（批次 207：左上角要写清"为什么掉血"）。
 *
 * `DamageResult` 只保留**最后一次**，而一帧里可能同时挨两下（僵尸 + 岩浆）；
 * 主循环用这份队列把"这一帧到底发生了什么"逐条播出来，不会再张冠李戴。
 */
export interface DamageEvent {
  cause: DamageCause;
  /** 净值（护甲减伤后） */
  applied: number;
  source?: string;
}

/**
 * 护甲吸收器。由 `main` 启动时注入（实现见 `core/registry/armor.ts`）。
 *
 * 这个接口声明在**消费方**（生存模块）而不是 `armor.ts`：
 * 生存模块不该反向依赖物品注册表，`armor.ts` 只要结构上满足它就能接上。
 * 走这一层的好处是**环境伤害（岩浆/仙人掌）也自动被护甲减伤**——
 * 否则得在摔落、岩浆、仙人掌、生物攻击、爆炸每个入口各写一遍减伤。
 */
export interface ArmorAbsorber {
  /** 当前总护甲值（HUD 与调试面板用） */
  readonly points: number;
  /** 返回减伤后的伤害；同时结算盔甲的耐久损耗 */
  absorb(amount: number, cause: DamageCause): number;
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

  /** 护甲吸收器：`main` 启动时注入。为 null 时所有伤害原样结算（离线测试里就是这样） */
  armor: ArmorAbsorber | null = null;

  /** 当前总护甲值（没穿盔甲就是 0） */
  get armorPoints(): number {
    return this.armor?.points ?? 0;
  }

  private hurtResistantTime = 0;
  private foodTickTimer = 0;
  private drownTickTimer = 0;
  /** 氧气的小数消耗累积（批次 243：水下呼吸附魔让每 tick 扣不满 1 点） */
  private airDrain = 0;
  private lavaTickTimer = 0;
  private fireTickTimer = 0;
  /** 岩浆块的烫伤计时（批次 121）：攒够 20 tick（= 1 秒）掉 1 点 */
  private magmaBlockTimer = 0;

  /**
   * 着火剩余秒数（站在火里 / 被点燃后持续掉血）。
   *
   * 原版是"**站在火里**会持续受伤，离开后还会再烧一会儿"，两者共用同一个计时器：
   * 只要计时器没走完就每秒掉 1 点，期间再站进火里会把计时器续上（`ignite` 取更长的那个）。
   */
  fireSeconds = 0;

  /** 最近一次受伤（HUD 抖动 / 调试面板用） */
  lastDamage: DamageResult | null = null;
  /** 累计受到的伤害，用于测试与统计 */
  totalDamage = 0;
  /**
   * 自上次被主循环取走以来的所有伤害（批次 207）。
   *
   * 为什么不用 `lastDamage`：一帧内可能既被僵尸打又被岩浆烫，只留最后一次
   * 就会把"3 点僵尸伤害 + 2 点岩浆伤害"全算到岩浆头上。这里逐条记。
   */
  private damageLog: DamageEvent[] = [];

  /** 取走这一帧的伤害记录（取完即清空；主循环负责播报） */
  takeDamageLog(): DamageEvent[] {
    if (this.damageLog.length === 0) return [];
    const events = this.damageLog;
    this.damageLog = [];
    return events;
  }

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

  /** 是否正在着火（渲染与 HUD 用） */
  get burning(): boolean {
    return this.fireSeconds > 0;
  }

  /**
   * 点燃：取"更长的那个持续时间"，重复被点燃不会把火越点越短（与 `Mob.ignite` 同一口径）。
   * 抗火效果下不生效（原版免疫火焰）。
   */
  ignite(seconds: number): void {
    if (seconds <= 0 || this.dead) return;
    this.fireSeconds = Math.max(this.fireSeconds, seconds);
  }

  /**
   * 施加伤害。受无敌帧限制：无敌期间只有更高的伤害才能覆盖。
   *
   * 护甲在这里统一减伤——**环境伤害（摔落/岩浆/仙人掌）与生物攻击走的是同一条路**，
   * 不必在每个伤害来源各写一遍。哪些伤害类型无视护甲由 `armor.ts` 判定。
   *
   * @returns 实际结算的伤害（被无敌帧挡下时为 0）
   */
  damage(amount: number, cause: DamageCause, source?: string): DamageResult {
    const result: DamageResult = { applied: 0, cause, source, fatal: false };
    if (this.dead || amount <= 0) return result;

    if (this.hurtResistantTime > 0 && amount <= this.lastDamageAmount) return result;

    const afterArmor = this.armor ? this.armor.absorb(amount, cause) : amount;
    if (afterArmor <= 0) return result;

    this.hurtResistantTime = HURT_RESISTANT_TICKS;
    // 记录的是"减伤前"的伤害：原版也这样比，否则穿透伤害会被无敌帧误挡
    this.lastDamageAmount = amount;
    this.health = Math.max(0, this.health - afterArmor);
    this.totalDamage += afterArmor;
    result.applied = afterArmor;
    result.fatal = this.health <= 0;
    this.lastDamage = result;
    this.damageLog.push({ cause, applied: afterArmor, source });
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
      // 创造模式：饱食度、氧气都保持满值，也不会受伤（着火也一并清掉，否则 HUD 会一直显示在烧）
      this.food = MAX_FOOD;
      this.saturation = MAX_SATURATION;
      this.air = MAX_AIR;
      this.fireSeconds = 0;
      this.fireTickTimer = 0;
      // 虚空是创造模式**唯一**还会受伤的自然伤害（原版同口径）：
      // 掉出世界必须有反馈，否则玩家会在虚空里无限下坠，只能靠飞回来
      if (env.y <= VOID_DAMAGE_Y) {
        this.hurtResistantTime = 0;
        this.lastDamageAmount = 0;
        this.damage(4, 'void');
      }
      return;
    }

    this.tickAir(env);
    this.tickDamageSources(env);
    this.tickFire(env);
    this.tickHunger(env);
  }

  /**
   * 着火结算（I12）。
   *
   * - 站在火里：把计时器续到 8 秒（原版行为）
   * - 计时器没走完：每 20 tick 掉 1 点 `'fire'` 伤害。**无视无敌帧**——
   *   否则被岩浆/怪物打一下之后火焰就有 0.5 秒白烧，与原版"每秒稳定 1 点"不符
   * - 抗火（`fireImmune`）：火直接灭掉、不进伤害
   */
  private tickFire(env: SurvivalEnvironment): void {
    if (env.fireImmune) {
      this.fireSeconds = 0;
      this.fireTickTimer = 0;
      return;
    }

    if (env.inFire) this.ignite(FIRE_IGNITE_SECONDS);
    if (this.fireSeconds <= 0) {
      this.fireTickTimer = 0;
      return;
    }

    this.fireSeconds = Math.max(0, this.fireSeconds - TICK_SECONDS);
    this.fireTickTimer++;
    if (this.fireTickTimer >= FIRE_DAMAGE_INTERVAL_TICKS) {
      this.fireTickTimer = 0;
      this.hurtResistantTime = 0;
      this.lastDamageAmount = 0;
      this.damage(1, 'fire');
    }
  }

  /** 氧气：水下缓慢耗尽，耗尽后周期性溺水伤害 */
  private tickAir(env: SurvivalEnvironment): void {
    // 水下呼吸效果：氧气不掉（甚至回满）
    if (env.waterBreathing) {
      this.drownTickTimer = 0;
      this.airDrain = 0;
      this.air = MAX_AIR;
      return;
    }

    if (env.eyeInWater) {
      // 水下呼吸**附魔**（批次 243）：每级把氧气消耗降到 1/(1+0.5·等级)。
      // 原版是"每级多 15 秒憋气 + 有概率免掉溺水伤害"，这里折算成"扣得更慢"——
      // HUD 上的那 300 点氧气也就实打实地撑得更久，不必给界面加第二根条。
      const level = Math.max(0, Math.floor(env.respiration ?? 0));
      this.airDrain += 1 / (1 + 0.5 * level);
      if (this.airDrain < 1) return;
      this.airDrain -= 1;
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

    this.airDrain = 0;
    this.drownTickTimer = 0;
    if (this.air < MAX_AIR) this.air = Math.min(MAX_AIR, this.air + 4);
  }

  /** 环境伤害：摔落 / 岩浆 / 仙人掌 / 窒息 / 虚空 */
  private tickDamageSources(env: SurvivalEnvironment): void {
    // 摔落保护（批次 243）：每级 -12%，见 `fallDamageFor`
    const fall = fallDamageFor(env.fallDistance, env.featherFalling ?? 0);
    if (fall > 0) this.damage(fall, 'fall');

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

    // 岩浆块（批次 121）：站在上面**每秒 1 点火焰伤害**。
    // ⚠️ 与岩浆那条的差别是"节奏"：岩浆是每 0.5 秒 4 点，岩浆块是每秒 1 点；
    // 走 `'fire'` 这条 source，所以**抗火能挡**（原版也如此）——
    // 也正因为如此，这里不能像岩浆那样每 tick 直接扣，得自己数 20 tick
    if (env.onMagma && !env.fireImmune) {
      this.magmaBlockTimer++;
      if (this.magmaBlockTimer >= 20) {
        this.magmaBlockTimer = 0;
        this.damage(1, 'fire');
      }
    } else {
      this.magmaBlockTimer = 0;
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
  poisonDamage(amount: number, source?: string): DamageResult {
    const result: DamageResult = { applied: 0, cause: 'poison', source, fatal: false };
    if (this.dead || amount <= 0) return result;
    if (this.health <= 1) return result;
    const applied = Math.min(amount, this.health - 1);
    this.health -= applied;
    this.totalDamage += applied;
    result.applied = applied;
    this.lastDamage = result;
    this.damageLog.push({ cause: 'poison', applied, source });
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
    this.airDrain = 0;
    this.lavaTickTimer = 0;
    this.hurtResistantTime = 0;
    this.lastDamageAmount = 0;
    this.lastDamage = null;
    this.damageLog = [];
    this.fireSeconds = 0;
    this.fireTickTimer = 0;
  }
}
