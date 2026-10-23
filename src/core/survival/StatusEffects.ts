/**
 * 状态效果（药水效果，I4）
 *
 * 与原版对齐的要点：
 *  - 时长按 **tick** 记（20 tick = 1 秒），剩余时长每秒减 20
 *  - 等级用 `amplifier` 表示（0 = I 级），数值随等级线性增长
 *  - 同一种效果重复施加时**取更强的**：等级更高就换成新的，等级相同则刷新时长
 *  - 中毒伤害**不会致死**（原版会把人打到半颗心就停），凋零会致死
 *  - 全部逻辑不依赖 DOM，可直接离线测
 *
 * 数值口径（普通难度、1 级）：
 *  速度 +20% 移速 · 缓慢 -15% · 急迫 +20% 挖掘速度 · 挖掘疲劳 -30%
 *  跳跃提升 +约 0.42 格起跳 · 力量 +3 点伤害（每级 +1.3）
 *  抗性提升 -20% 受伤（每级 +20%，IV 级免疫）
 *  生命恢复每 50 tick 回 1 点 · 伤害吸收每级 +4 点"黄心"
 *  中毒每 25 tick 1 点（不致死）· 凋零每 40 tick 1 点
 */

/** 全部效果（名称与原版一致，命令与 UI 都用它） */
// 多语言 P2-3c3：效果名走 `label.effect.*`（原来是一张中文常量表）
import { t } from '../i18n/I18n.ts';

export const EFFECTS = [
  'speed',
  'slowness',
  'haste',
  'mining_fatigue',
  'strength',
  'instant_health',
  'instant_damage',
  'jump_boost',
  'nausea',
  'regeneration',
  'resistance',
  'fire_resistance',
  'water_breathing',
  'invisibility',
  'blindness',
  'night_vision',
  'hunger',
  'weakness',
  'poison',
  'wither',
  'health_boost',
  'absorption',
  'saturation',
  'levitation',
  'slow_falling',
  'conduit_power',
  'dolphins_grace',
  'bad_omen',
  'hero_of_the_village',
  'darkness',
] as const;

export type EffectId = (typeof EFFECTS)[number];

/** 效果的"好/坏"标签（HUD 上区分配色，也让玩家一眼看出这是debuff） */
export type EffectTone = 'good' | 'bad';

const BAD_EFFECTS: readonly EffectId[] = [
  'slowness',
  'mining_fatigue',
  'poison',
  'wither',
  'hunger',
  'weakness',
  'blindness',
  'darkness',
  'nausea',
  'bad_omen',
  'instant_damage',
  'levitation',
];

export function effectTone(id: EffectId): EffectTone {
  return BAD_EFFECTS.includes(id) ? 'bad' : 'good';
}

/** 命令里常用的别名（原版有 `/effect give minecraft:speed` 这种写法） */
const ALIASES: Record<string, EffectId> = {
  // 中文名直接可用。
  // ⚠️ **固定取中文表**（`t(..., 'zh')`），不跟界面语言走：玩家在英文界面下照样可能输入
  // `/effect give @s 夜视`，这是既有行为，不能因为切了语言就解析不出来。
  ...Object.fromEntries(EFFECTS.map((id) => [t(`label.effect.${id}`, 'zh'), id as EffectId])),
  // 常见别名
  swiftness: 'speed',
  jump: 'jump_boost',
  regen: 'regeneration',
  absorb: 'absorption',
  fire_resist: 'fire_resistance',
  water_breathing: 'water_breathing',
  instant_damage_harm: 'instant_damage',
  dark: 'darkness',
  night: 'night_vision',
};

/** 立即生效（不进入持续时间列表）的效果 */
const INSTANT: readonly EffectId[] = ['instant_health', 'instant_damage'];

export interface ActiveEffect {
  id: EffectId;
  label: string;
  /** 0 = I 级 */
  amplifier: number;
  /** 剩余 tick */
  ticks: number;
  /** 是否由命令/管理员施加（HUD 上标记一下） */
  ambient: boolean;
}

/** 一条持续伤害（一次 tick 里中毒与凋零可能各来一条） */
export interface EffectDamageHit {
  /** 这次要扣多少血 */
  amount: number;
  /** 类别：中毒不致死、凋零能致死（两者在结算层走不同的路） */
  cause: 'poison' | 'wither';
}

/** 每 tick 的结算结果（由调用方落到玩家身上） */
export interface EffectTickResult {
  /**
   * 中毒/凋零造成的伤害，**按效果分开记**。
   *
   * ⚠️ 以前是"一个 `damage` + 一个 `damageCause`"：两种效果同时挂着时，后处理的
   * 那个会覆盖 `damageCause`，于是凋零被当成中毒（卡在剩 1 点血、永远打不死），
   * 或者中毒被当成凋零（能致死）。分裂成数组后两边各自按 `cause` 分流。
   */
  damageHits: EffectDamageHit[];
  /** 生命恢复回的血 */
  heal: number;
  /** 饥饿效果消耗的疲劳值 */
  exhaustion: number;
  /** 饱和效果补的饥饿与饱和度 */
  food: number;
  saturation: number;
  /** 本 tick 到期的效果 */
  expired: EffectId[];
}

const EMPTY_TICK: EffectTickResult = {
  damageHits: [],
  heal: 0,
  exhaustion: 0,
  food: 0,
  saturation: 0,
  expired: [],
};

/** 解析效果名（英文 id / 中文名 / 常见别名） */
export function resolveEffect(name: string): EffectId | undefined {
  const raw = name.trim().toLowerCase().replace(/^minecraft:/, '');
  if ((EFFECTS as readonly string[]).includes(raw)) return raw as EffectId;
  if (name.trim() in ALIASES) return ALIASES[name.trim()];
  return ALIASES[raw];
}

/**
 * 效果名（多语言 P2-3c3）：HUD、药水说明、药箭说明、`/effect` 下拉共用一条键。
 * 查不到返回 id —— 宁可露出 `speed`，也不要空串（空串在 HUD 上就是一块空白）。
 */
export function effectLabel(id: EffectId): string {
  const key = `label.effect.${id}`;
  const text = t(`label.effect.${id}`);
  return text === key ? id : text;
}

/** 等级显示：0 → I、1 → II … */
export function romanLevel(amplifier: number): string {
  const table = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return table[Math.min(amplifier, table.length - 1)] ?? String(amplifier + 1);
}

export class StatusEffects {
  private readonly active = new Map<EffectId, ActiveEffect>();

  /** 当前所有效果（按施加顺序） */
  get all(): readonly ActiveEffect[] {
    return [...this.active.values()];
  }

  get count(): number {
    return this.active.size;
  }

  has(id: EffectId): boolean {
    return this.active.has(id);
  }

  get(id: EffectId): ActiveEffect | undefined {
    return this.active.get(id);
  }

  get amplifierOf(): (id: EffectId) => number {
    return (id) => this.active.get(id)?.amplifier ?? -1;
  }

  /**
   * 施加效果。
   * @param seconds 持续秒数（瞬间效果忽略它）
   * @param amplifier 0 = I 级
   * @returns 是否成功（名字不认识返回 false）
   */
  apply(id: EffectId, seconds: number, amplifier = 0, ambient = false): boolean {
    if (!(EFFECTS as readonly string[]).includes(id)) return false;
    const level = Math.max(0, Math.min(255, Math.floor(amplifier)));

    if (INSTANT.includes(id)) {
      // 瞬间效果不进列表，调用方读 `pendingInstant` 结算
      this.pendingInstant.push({ id, amplifier: level });
      return true;
    }

    const current = this.active.get(id);
    if (current && current.amplifier > level) return true; // 更弱的顶不掉更强的
    const ticks = Math.max(1, Math.round(seconds * 20));
    // 同等级是"刷新时长"，更高等级是"覆盖并刷新"
    this.active.set(id, { id, label: effectLabel(id), amplifier: level, ticks, ambient });
    return true;
  }

  /** 瞬间效果（瞬间治疗/伤害）排队等待结算 */
  readonly pendingInstant: Array<{ id: EffectId; amplifier: number }> = [];

  /** 取走瞬间效果（调用方结算后应清空） */
  takeInstant(): Array<{ id: EffectId; amplifier: number }> {
    if (this.pendingInstant.length === 0) return [];
    const list = [...this.pendingInstant];
    this.pendingInstant.length = 0;
    return list;
  }

  /** 移除单个效果（批次 475：袭击开始时消耗"不祥之兆"） */
  remove(id: EffectId): boolean {
    return this.active.delete(id);
  }

  clear(): void {
    this.active.clear();
    this.pendingInstant.length = 0;
  }

  /** 每 tick 推进：时长递减、到期移除，并给出本 tick 的结算 */
  tick(): EffectTickResult {
    if (this.active.size === 0) return EMPTY_TICK;

    // ⚠️ `damageHits`/`expired` 必须各给一个新数组：展开 `EMPTY_TICK` 会把那两个
    // 共享数组的**引用**带过来，`push` 一下就永久污染 `EMPTY_TICK`。
    const result: EffectTickResult = { ...EMPTY_TICK, damageHits: [], expired: [] };

    for (const effect of [...this.active.values()]) {
      effect.ticks--;
      if (effect.ticks <= 0) {
        this.active.delete(effect.id);
        result.expired.push(effect.id);
        continue;
      }
      this.accumulate(effect, result);
    }
    return result;
  }

  /**
   * 把一种效果的持续结算累加进结果。
   * 节奏都换算成"每 N tick 一次"，与原版的 1.25 秒 / 2 秒 / 2.5 秒对齐。
   */
  private accumulate(effect: ActiveEffect, result: EffectTickResult): void {
    const level = effect.amplifier + 1;
    switch (effect.id) {
      case 'poison':
        // 每 25 tick 掉 1 点，等级越高掉得越勤
        if (effect.ticks % Math.max(5, 25 - (level - 1) * 5) === 0) {
          result.damageHits.push({ amount: 1, cause: 'poison' });
        }
        break;
      case 'wither':
        if (effect.ticks % Math.max(10, 40 - (level - 1) * 10) === 0) {
          result.damageHits.push({ amount: 1, cause: 'wither' });
        }
        break;
      case 'regeneration':
        // 每 50 tick 回 1 点，每级提速
        if (effect.ticks % Math.max(10, 50 - (level - 1) * 10) === 0) result.heal += 1;
        break;
      case 'hunger':
        result.exhaustion += 0.005 * level;
        break;
      case 'saturation':
        if (effect.ticks % 10 === 0) {
          result.food += 1;
          result.saturation += 0.5 * level;
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- 数值查询

  /** 移动速度倍率（速度 +20%/级，缓慢 -15%/级，两者会叠加） */
  moveSpeedMultiplier(): number {
    let multiplier = 1;
    multiplier *= 1 + 0.2 * (this.amplifierOf('speed') + 1) * (this.has('speed') ? 1 : 0);
    if (this.has('slowness')) multiplier *= Math.max(0, 1 - 0.15 * (this.amplifierOf('slowness') + 1));
    return multiplier;
  }

  /** 起跳速度倍率（跳跃提升每级约 +0.4 格，折算成速度约 +12%） */
  jumpMultiplier(): number {
    if (!this.has('jump_boost')) return 1;
    return 1 + 0.12 * (this.amplifierOf('jump_boost') + 1);
  }

  /** 挖掘速度倍率（急迫 +20%/级，挖掘疲劳 -30%/级） */
  miningSpeedMultiplier(): number {
    let multiplier = 1;
    if (this.has('haste')) multiplier *= 1 + 0.2 * (this.amplifierOf('haste') + 1);
    if (this.has('mining_fatigue')) multiplier *= Math.max(0.1, 1 - 0.3 * (this.amplifierOf('mining_fatigue') + 1));
    return multiplier;
  }

  /** 攻击伤害加成（力量 +3 点，每级 +1.3；虚弱 -4 点） */
  attackBonus(): number {
    let bonus = 0;
    if (this.has('strength')) bonus += 3 + 1.3 * this.amplifierOf('strength');
    if (this.has('weakness')) bonus -= 4 * (this.amplifierOf('weakness') + 1);
    return bonus;
  }

  /** 受伤倍率（抗性提升 -20%/级，IV 级直接免疫） */
  incomingDamageMultiplier(): number {
    if (!this.has('resistance')) return 1;
    const level = this.amplifierOf('resistance') + 1;
    if (level >= 4) return 0;
    return Math.max(0, 1 - 0.2 * level);
  }

  /** 伤害吸收给的"黄心"数量 */
  absorption(): number {
    if (!this.has('absorption')) return 0;
    return 4 * (this.amplifierOf('absorption') + 1);
  }

  /** 生命提升给的上限加成 */
  healthBonus(): number {
    if (!this.has('health_boost')) return 0;
    return 4 * (this.amplifierOf('health_boost') + 1);
  }

  // 布尔查询（供渲染与物理用）
  get nightVision(): boolean {
    return this.has('night_vision');
  }

  get blinded(): boolean {
    return this.has('blindness');
  }

  get darkened(): boolean {
    return this.has('darkness');
  }

  get waterBreathing(): boolean {
    return this.has('water_breathing') || this.has('conduit_power');
  }

  get fireResistant(): boolean {
    return this.has('fire_resistance');
  }

  get invisible(): boolean {
    return this.has('invisibility');
  }

  get levitating(): boolean {
    return this.has('levitation');
  }

  get slowFalling(): boolean {
    return this.has('slow_falling');
  }

  get nauseated(): boolean {
    return this.has('nausea');
  }

  /**
   * 剩余时长的文字（HUD 用）：`19:59`；瞬间效果显示"瞬间"
   */
  describe(): string[] {
    return this.all.map((effect) => {
      const totalSeconds = Math.ceil(effect.ticks / 20);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const time = `${minutes}:${String(seconds).padStart(2, '0')}`;
      const level = effect.amplifier > 0 ? ` ${romanLevel(effect.amplifier)}` : '';
      return `${effect.label}${level} ${time}`;
    });
  }

  /** 存档用（`ticks` 一并存，读档后剩余时长接着走） */
  serialize(): Array<{ id: EffectId; amplifier: number; ticks: number; ambient: boolean }> {
    return this.all.map((effect) => ({
      id: effect.id,
      amplifier: effect.amplifier,
      ticks: effect.ticks,
      ambient: effect.ambient,
    }));
  }

  restore(data: unknown): void {
    this.clear();
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as { id?: unknown; amplifier?: unknown; ticks?: unknown; ambient?: unknown };
      if (typeof record.id !== 'string') continue;
      if (!(EFFECTS as readonly string[]).includes(record.id)) continue;
      const amplifier = typeof record.amplifier === 'number' ? Math.max(0, Math.floor(record.amplifier)) : 0;
      const ticks = typeof record.ticks === 'number' ? Math.max(1, Math.floor(record.ticks)) : 20;
      this.active.set(record.id as EffectId, {
        id: record.id as EffectId,
        label: effectLabel(record.id as EffectId),
        amplifier,
        ticks,
        ambient: record.ambient === true,
      });
    }
  }
}
