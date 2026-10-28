/**
 * 从属端的影子实体（L8 · MS3）
 *
 * 从属端不跑生物 AI（`SimMode` 里 `mobs` 为 false），它看到的每一只怪都是**别人算出来的**：
 * 房主每 100ms 推一份快照，这里维护一份"影子表"，每帧插值出该画在哪。
 *
 * 三条口径（都是踩过或必然会踩的）：
 *
 *  1. **插值而不是赋值**：100ms 一条快照直接赋值，模型会一格一格跳（远端玩家早就这么干了，
 *     见 `RemoteInterpolation`）。瞬移（> 8 格）例外——那是真跳，插值会拖出一条长线。
 *  2. **消失要留宽限**：快照是按 AOI 裁的，实体走到边界会"这一帧在、下一帧不在"。
 *     立刻删会让远处的怪一闪一闪；连丢 `graceSnapshots` 次才算真没了。
 *  3. **死亡不是"消失"**：真死由房主的 `entity-remove` 事件驱动（`remove()` 立刻删），
 *     否则"走到边界"和"被打死"会混成同一种表现（掉落的最后一下也会被吞掉）。
 *
 * 纯逻辑：不引 Three.js、不读时钟（dt 由调用方给），影子只交出渲染需要的数值，
 * 主程序再把它映射成真正的 `Mob`。
 */

import { RemotePlayerSmoother } from '../../core/net/RemoteInterpolation.ts';
import { decodeEntities, type EntitySnapshot } from '../../core/net/EntitySnapshot.ts';

/** 连续丢几次快照才算"真的没了"（3 次 ≈ 300ms，够熬过 AOI 边界的抖动） */
export const SHADOW_GRACE_SNAPSHOTS = 3;

/** 影子实体的渲染状态（主程序据此摆 `Mob`） */
export interface ShadowRenderState {
  readonly key: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly health: number;
  readonly flags: number;
}

/** 一条影子（对外不可见的内部状态） */
interface Shadow {
  key: string;
  type: string;
  health: number;
  flags: number;
  smoother: RemotePlayerSmoother;
  /** 连续几次快照里没出现 */
  missed: number;
}

export interface SimApplyOptions {
  /** 按类型给最大血量（解码时夹住血条；不给就不夹） */
  maxHealthOf?: (type: string) => number | undefined;
  /** 宽限次数，默认 `SHADOW_GRACE_SNAPSHOTS` */
  graceSnapshots?: number;
}

export class SimApply {
  private readonly shadows = new Map<string, Shadow>();
  private readonly grace: number;

  constructor(private readonly options: SimApplyOptions = {}) {
    this.grace = Math.max(1, options.graceSnapshots ?? SHADOW_GRACE_SNAPSHOTS);
  }

  get size(): number {
    return this.shadows.size;
  }

  /** 当前所有影子的键（调试 / 单测用） */
  keys(): string[] {
    return [...this.shadows.keys()];
  }

  /**
   * 吃一份快照：新的建影子、旧的更新目标、没出现的累计"缺席"。
   *
   * @returns 这一帧新出现的影子（主程序据此真正 `spawn` 一个 `Mob`）
   */
  apply(raw: unknown): ShadowRenderState[] {
    const entities = decodeEntities(raw);
    const seen = new Set<string>();
    const created: ShadowRenderState[] = [];

    for (const entity of entities) {
      seen.add(entity.key);
      const existing = this.shadows.get(entity.key);
      if (!existing) {
        const smoother = new RemotePlayerSmoother({
          x: entity.x,
          y: entity.y,
          z: entity.z,
          yaw: entity.yaw,
        });
        this.shadows.set(entity.key, {
          key: entity.key,
          type: entity.type,
          health: this.clampHealth(entity),
          flags: entity.flags,
          smoother,
          missed: 0,
        });
        created.push(this.stateOf(entity.key));
        continue;
      }
      // 老影子：位置只当新目标（插值负责平滑），血量/状态位直接覆盖
      existing.smoother.setTarget({ x: entity.x, y: entity.y, z: entity.z, yaw: entity.yaw });
      existing.health = this.clampHealth(entity);
      existing.flags = entity.flags;
      existing.missed = 0;
    }

    // 缺席计数：超过宽限才真的删（AOI 边界会抖）
    for (const [key, shadow] of this.shadows) {
      if (seen.has(key)) continue;
      shadow.missed += 1;
      if (shadow.missed > this.grace) this.shadows.delete(key);
    }
    return created;
  }

  /**
   * 推进一帧，交出所有影子此刻该画在哪。
   *
   * 顺序按 key 排：调用方拿它去 `forEach` 摆模型时顺序稳定，不会因为 Map 顺序变化
   * 让相邻两帧的渲染顺序抖动（那种抖动在阴影/透明排序上看得出来）。
   */
  step(dt: number): ShadowRenderState[] {
    const out: ShadowRenderState[] = [];
    for (const key of [...this.shadows.keys()].sort()) {
      const shadow = this.shadows.get(key);
      if (!shadow) continue;
      shadow.smoother.step(dt);
      out.push(this.stateOf(key));
    }
    return out;
  }

  /**
   * 立刻删掉一个影子（死亡 / 被 `entity-remove` 点名）。
   *
   * @returns 之前有没有这只（调用方据此决定要不要把本地那个 `Mob` 也销毁）
   */
  remove(key: string): boolean {
    return this.shadows.delete(key);
  }

  /** 清空（退联机时用） */
  clear(): void {
    this.shadows.clear();
  }

  private clampHealth(entity: EntitySnapshot): number {
    const max = this.options.maxHealthOf?.(entity.type);
    if (max === undefined) return entity.health;
    return Math.min(Math.max(entity.health, 0), max);
  }

  private stateOf(key: string): ShadowRenderState {
    const shadow = this.shadows.get(key)!;
    const point = shadow.smoother.step(0);
    return {
      key,
      type: shadow.type,
      x: point.x,
      y: point.y,
      z: point.z,
      yaw: point.yaw,
      health: shadow.health,
      flags: shadow.flags,
    };
  }
}
