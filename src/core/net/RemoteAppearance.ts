/**
 * 远端玩家的外观状态（联机17）。
 *
 * 网络每 100ms 才来一条 `move`，而"挥手"只要 0.25 秒、"受伤闪红"只有 0.3 秒——
 * 如果渲染直接看最新那条消息里的布尔值，这两个动作要么完全看不见（一条消息就过去了），
 * 要么在网络照旧发 `swing: true` 时一直亮着（手一直在挥）。
 *
 * 所以这里做两件事：
 *  1. **边沿触发**：`swing` 从 false 变 true 时才开始计时，连续 true 不会续期；
 *  2. **本地计时**：`tick(dt)` 递减，渲染只看"还剩多少秒"。
 *
 * 纯逻辑、不碰渲染与网络，`tests/net-player-state.test.ts` 直接断言。
 */

/**
 * `move.look` 的长度（**协议契约**，只能追加不能插队）。
 *
 * 字段顺序：`[skinTone, shirtColor, pantsColor, hairColor, hairStyle, beard, eyes, eyeColor, build, frame]`，
 * 与 `AppearanceSettings` 的下标一一对应。定义在这里而不是 `RemoteSkin`，是为了让
 * 本模块保持"零依赖"（它被纯逻辑测试直接引用）。
 */
export const REMOTE_LOOK_LENGTH = 10;

/** 挥一次手亮多久（秒）；与本地攻击动画同一个量级 */
export const REMOTE_SWING_SECONDS = 0.25;
/** 受伤闪红亮多久（秒） */
export const REMOTE_HURT_SECONDS = 0.3;

/** 盔甲四件的槽位顺序（与 `MobEquipment` 的字段一一对应） */
export const REMOTE_ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const;

/** 远端玩家这一帧上报的外观（字段都可缺省：老客户端不带就按默认） */
export interface RemoteAppearanceInput {
  /** 主手物品 id（0 = 空手） */
  held?: number;
  /** 副手物品 id（0 = 空） */
  offhand?: number;
  /** 盔甲四件：head / chest / legs / feet（0 = 空） */
  armor?: readonly number[];
  /** 潜行 */
  sneak?: boolean;
  /** 这一帧是否正在挥手 */
  swing?: boolean;
  /** 这一帧是否刚受伤 */
  hurt?: boolean;
  /** 是否着火 */
  fire?: boolean;
  /** 是否骑乘 */
  ride?: boolean;
  /** 是否在睡觉 */
  sleep?: boolean;
  /**
   * 玩家自己捏的外观下标（`REMOTE_LOOK_LENGTH` 个，顺序见 `RemoteSkin.ts`）。
   *
   * 老客户端不带这个字段 → 渲染层回退到"按昵称派生"，至少每个人都不一样。
   */
  look?: readonly number[];
  /**
   * 这位玩家此刻**死了没**（用户 2026-10-26）。
   *
   * 以前死亡没有任何上行：对端只知道"他在原位不动"，于是尸体一直站着，直到他复活、
   * 位置变了才更新。现在死亡/复活都会立刻在 `move` 里带一位出来。
   */
  dead?: boolean;
  /** 生命（0~20 点）：瞄准队友时画一条红条（用户 2026-10-26） */
  hp?: number;
  /** 饥饿（0~20 点）：瞄准队友时画一条黄条 */
  food?: number;
}

/** 渲染侧读的状态（计时用"还剩几秒"而不是布尔） */
export interface RemoteAppearanceState {
  held: number;
  offhand: number;
  armor: [number, number, number, number];
  /** 对端发来的外观下标；`null` = 没带（回退到昵称派生） */
  look: number[] | null;
  sneaking: boolean;
  riding: boolean;
  sleeping: boolean;
  onFire: boolean;
  swingLeft: number;
  hurtLeft: number;
  /** 对端是否已死亡（渲染层据此隐藏模型） */
  dead: boolean;
  /** 对端生命（0~20）；`null` = 他还没报过，UI 不画 */
  hp: number | null;
  /** 对端饥饿（0~20）；`null` = 还没报过 */
  food: number | null;
}

/** 生命/饥饿点数收口：非有限数当 0，夹到 0~20 的整数（与 `move.hp/food` 契约一致） */
export function normalizePoints(value: unknown): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(20, Math.max(0, n));
}

/** 物品 id 收口：0/负数/NaN 一律当空手 */
export function normalizeItemId(value: unknown): number {
  const id = Math.trunc(Number(value));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function normalizeArmor(raw: readonly number[] | undefined): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  if (!raw) return out;
  for (let i = 0; i < out.length; i++) out[i] = normalizeItemId(raw[i]);
  return out;
}

/**
 * 外观下标收口（`move.look`）。
 *
 * 长度不够就当作"没带"（老客户端）→ 渲染层回退到昵称派生；多余的部分直接截掉，
 * 免得以后协议加字段时把不认识的值带进 `paletteOf`。下标越界的回退在 `paletteOf` 里。
 */
function normalizeLook(raw: readonly number[] | undefined): number[] | null {
  if (!Array.isArray(raw) || raw.length < REMOTE_LOOK_LENGTH) return null;
  const out: number[] = [];
  for (let i = 0; i < REMOTE_LOOK_LENGTH; i++) {
    const value = Math.trunc(Number(raw[i]));
    out.push(Number.isFinite(value) ? value : 0);
  }
  return out;
}

/** 一份"什么都没有"的状态（新玩家进来、或者对端老客户端不带这些字段） */
export function emptyAppearance(): RemoteAppearanceState {
  return {
    held: 0,
    offhand: 0,
    armor: [0, 0, 0, 0],
    look: null,
    sneaking: false,
    riding: false,
    sleeping: false,
    onFire: false,
    swingLeft: 0,
    hurtLeft: 0,
    dead: false,
    hp: null,
    food: null,
  };
}

export class RemoteAppearance {
  private current: RemoteAppearanceState = emptyAppearance();
  /** 上一帧的挥手/受伤布尔：判断"边沿"用 */
  private lastSwing = false;
  private lastHurt = false;

  get state(): RemoteAppearanceState {
    return this.current;
  }

  get swinging(): boolean {
    return this.current.swingLeft > 0;
  }

  get hurt(): boolean {
    return this.current.hurtLeft > 0;
  }

  /**
   * 收到一条网络状态。
   *
   * ⚠️ **没带的字段一律保持原值**（用户 2026-10-26）：以前这里是"整份覆盖"，
   * 而对端 99% 的 `move` 不带 `look`（只在变化/2 秒兜底时带）——于是每一条不带皮肤
   * 的消息都会把皮肤清空、退回"按昵称派生"，2 秒后再纠正回来，表现为**每隔几秒闪一次**。
   * 服务端现在会合并，这里再兜一层：老服务端/老客户端混着用也不会闪。
   */
  update(input: RemoteAppearanceInput): void {
    if (input.held !== undefined) this.current.held = normalizeItemId(input.held);
    if (input.offhand !== undefined) this.current.offhand = normalizeItemId(input.offhand);
    if (input.armor !== undefined) this.current.armor = normalizeArmor(input.armor);
    // 外观（皮肤）：只收前 REMOTE_LOOK_LENGTH 个下标，坏的当"没带"
    if (input.look !== undefined) this.current.look = normalizeLook(input.look);
    if (input.sneak !== undefined) this.current.sneaking = input.sneak === true;
    if (input.ride !== undefined) this.current.riding = input.ride === true;
    if (input.sleep !== undefined) this.current.sleeping = input.sleep === true;
    if (input.fire !== undefined) this.current.onFire = input.fire === true;
    if (input.dead !== undefined) this.current.dead = input.dead === true;
    if (input.hp !== undefined) this.current.hp = normalizePoints(input.hp);
    if (input.food !== undefined) this.current.food = normalizePoints(input.food);

    // 边沿触发：网络会连续几条都带 swing:true，续期的话手就一直举着
    const swing = input.swing === true;
    if (swing && !this.lastSwing) this.current.swingLeft = REMOTE_SWING_SECONDS;
    this.lastSwing = swing;

    const hurt = input.hurt === true;
    if (hurt && !this.lastHurt) this.current.hurtLeft = REMOTE_HURT_SECONDS;
    this.lastHurt = hurt;
  }

  /** 每帧递减两个动作计时 */
  tick(dt: number): void {
    const step = Math.max(0, dt);
    this.current.swingLeft = Math.max(0, this.current.swingLeft - step);
    this.current.hurtLeft = Math.max(0, this.current.hurtLeft - step);
  }

  /** 远端玩家离开时整份清掉 */
  reset(): void {
    this.current = emptyAppearance();
    this.lastSwing = false;
    this.lastHurt = false;
  }
}
