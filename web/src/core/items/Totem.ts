/**
 * 不死图腾（批次 498，B18）
 *
 * 原版的规则很短，但**触发时机**是它全部的意义：**这一下会致死时**才救——
 * 半血挨打不能白烧一个图腾。
 *
 * 所以这里把"该不该救"抽成一个纯函数，而不是在 `applyIncomingDamage` 里写一串 if：
 * 那个函数是所有扣血路径（近战/摔落/着火/溺水/饥饿/爆炸）的唯一入口，
 * 在里面加分支很容易在某条路径上漏掉（比如"着火致死时不救"这种）。
 *
 * 与原版的差异：
 *  - 原版救完之后给 40 秒**生命恢复 II + 伤害吸收 II**；本项目没有伤害吸收，
 *    只给生命恢复（数值见 `TOTEM_REGENERATION`）；
 *  - 原版图腾可以放在**副手**；本项目没有副手，只看背包里有没有（生存模式）。
 */

import type { DamageCause } from '../survival/PlayerStats.ts';
import type { SoundSpec } from '../audio/AudioEngine.ts';

/** 救完之后留几滴血（原版是 1 点） */
export const TOTEM_RESCUE_HEALTH = 1;

/** 救完之后给的生命恢复（与原版同一条：40 秒、II 级） */
export const TOTEM_REGENERATION = { seconds: 40, amplifier: 1 } as const;

/**
 * 这一下要不要用图腾救？
 *
 * @param healthAfter 这一下**结算之后**的血量（<= 0 才算致死）
 * @param hasTotem 背包里还有没有图腾
 * @param cause 伤害来源（只为可读性保留：原版所有死因都能救，包括 `/kill`）
 */
export function shouldRescueWithTotem(healthAfter: number, hasTotem: boolean, cause: DamageCause): boolean {
  void cause;
  return hasTotem && healthAfter <= 0;
}

/**
 * 图腾触发时的声音：三个上行音（C5 → E5 → G5）。
 *
 * 为什么自己造而不复用现成音效：这是全游戏**唯一一次**"你本来该死"的时刻，
 * 用拾取音或受伤音都听不出区别；三个上行的三角波足够"仪式感"，
 * 又不需要新的音频素材。
 */
export function totemSoundSpec(): SoundSpec {
  const notes = [523.25, 659.25, 783.99];
  return {
    layers: notes.map((hz, index) => ({
      t: 'tone' as const,
      at: index * 0.12,
      dur: 0.55,
      gain: 0.7 - index * 0.12,
      env: [
        [0, 0],
        [0.08, 1],
        [0.5, 0.6],
        [1, 0],
      ] as const,
      wave: 'triangle' as const,
      hz,
    })),
    gain: 0.8,
    pitchJitter: 0,
  };
}
