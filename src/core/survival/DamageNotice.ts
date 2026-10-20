/**
 * 伤害原因的文案（批次 207）
 *
 * 用户反馈："掉血时不知道是什么原因。" 光写"受到 3 点伤害"不够，
 * 左上角那条必须同时给出**现象**（扣了多少）与**原因**（被谁 / 被什么扣的）。
 *
 * 放成纯函数而不是写死在主循环里：
 *  - 这是一张需要和 `DamageCause` 一一对应的表，漏一档 TypeScript 会当场报错；
 *  - 测试可以逐档断言"没有一档是空的、没有一档只有'受伤'两个字"。
 */

import type { DamageCause } from './PlayerStats.ts';

/**
 * 每一档伤害的原因描述。
 *
 * 写法要求：**说清"碰到什么"**，不要只写"受伤/环境伤害"——
 * 玩家看到"窒息"还得自己猜是头卡在方块里还是在水里，那就等于没说。
 */
const CAUSE_REASON: Record<DamageCause, string> = {
  poison: '中毒（持续扣血）',
  // 与中毒的区别必须说清：中毒停在半颗心，凋零会把人打死（批次 218）
  wither: '凋零（持续扣血，会致死）',
  // 批次 548：细雪冻伤，7 秒后开始每 2 秒 1 点
  freeze: '冰冻（陷在细雪里太久）',
  fall: '摔落（从高处落地）',
  drown: '溺水（氧气耗尽）',
  lava: '碰到岩浆（要立刻离开，水浇不灭）',
  fire: '着火（站在火/岩浆块上，或被点燃）',
  cactus: '碰到仙人掌（带刺方块）',
  suffocate: '窒息（头卡在方块里）',
  starve: '饥饿（饥饿值耗尽）',
  void: '掉出世界（虚空）',
  explosion: '爆炸（TNT / 苦力怕 / 床）',
  projectile: '被弹射物击中',
  lightning: '被雷击中',
  generic: '受到伤害（没有记录到来源）',
};

/**
 * 一条伤害原因的短句（不含"受到 X 点"那半句）。
 *
 * @param cause  伤害类型
 * @param source 更具体的来源（生物名 / "世界边界" / "末影龙吐息"…）
 */
export function damageReason(cause: DamageCause, source?: string): string {
  const from = source?.trim() ?? '';
  if (from.length === 0) return CAUSE_REASON[cause];
  // 有具体来源时按类型换个说法，别出现"被世界边界攻击"这种别扭句子
  switch (cause) {
    case 'generic':
      // "来自僵尸"比"僵尸造成的伤害"短，配上后半句"（3 点）"也不会重复"伤害"两个字
      return `来自${from}`;
    case 'projectile':
      return `被${from}射中`;
    case 'explosion':
      return `${from}的爆炸`;
    case 'fire':
      return `${from}造成的火焰伤害`;
    case 'poison':
      return `${from}导致的中毒`;
    // 凋零也可能带来源（"凋灵骷髅导致的凋零"），句式与中毒保持一致
    case 'wither':
      return `${from}导致的凋零`;
    default:
      return `${CAUSE_REASON[cause]}（来源：${from}）`;
  }
}
