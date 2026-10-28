/**
 * 伤害原因的文案（批次 207；多语言 P6-5 起走 i18n 表）。
 *
 * 用户反馈：“掉血时不知道是什么原因。” 光写“受到 3 点伤害”不够，
 * 左上角那条必须同时给出**现象**（扣了多少）与**原因**（被谁 / 被什么扣的）。
 *
 * 放成纯函数而不是写死在主循环里：
 *  - 这是一张需要和 `DamageCause` 一一对应的表，漏一档 TypeScript 会当场报错；
 *  - 测试可以逐档断言“没有一档是空的、没有一档只有‘受伤’两个字”。
 *
 * ⚠️ P6-5（批次 20261024-0020）：原来这张表是 16 条中文常量 + 6 条中文句式，
 * 德语/俄语界面上会直接露中文。现在改成**键**（`notice.damage.cause.*` 与
 * `notice.damage.*` 句式），取值在**调用这一刻**做 —— 名字跟着当前语言走。
 * 表里只留 `DamageCause → 键后缀` 的映射，键由类型系统卡住（`Record<DamageCause, string>`
 * 保证漏一档就编译错误，与原来那张表同一个保护）。
 */

import { t, tp } from '../i18n/I18n.ts';
import type { DamageCause } from './PlayerStats.ts';

/**
 * 每一档伤害原因对应的**键后缀**。
 *
 * 写法要求（对译文同样成立）：**说清“碰到什么”**，不要只写“受伤/环境伤害”——
 * 玩家看到“窒息”还得自己猜是头卡在方块里还是在水里，那就等于没说。
 *
 * ⚠️ 必须写成模板字面量（`notice.damage.cause.${...}`）：`audit:i18n` 靠这个形态
 * 认出“这一族键是数据驱动取的”，拼成变量会让 16 条键全被判成孤儿。
 */
const CAUSE_KEY: Record<DamageCause, string> = {
  poison: 'poison',
  // 与中毒的区别必须说清：中毒停在半颗心，凋零会把人打死（批次 218）
  wither: 'wither',
  // 批次 548：细雪冻伤，7 秒后开始每 2 秒 1 点
  freeze: 'freeze',
  fall: 'fall',
  drown: 'drown',
  lava: 'lava',
  fire: 'fire',
  cactus: 'cactus',
  sweetBerry: 'sweetBerry',
  suffocate: 'suffocate',
  starve: 'starve',
  void: 'void',
  explosion: 'explosion',
  projectile: 'projectile',
  lightning: 'lightning',
  generic: 'generic',
};

/** 某一档伤害原因的短句（不含“受到 X 点”那半句） */
function causeText(cause: DamageCause): string {
  const suffix = CAUSE_KEY[cause];
  return t(`notice.damage.cause.${suffix}`);
}

/**
 * 一条伤害原因的短句（不含“受到 X 点”那半句）。
 *
 * @param cause  伤害类型
 * @param source 更具体的来源（生物名 / “世界边界” / “末影龙吐息”…）
 */
export function damageReason(cause: DamageCause, source?: string): string {
  const from = source?.trim() ?? '';
  if (from.length === 0) return causeText(cause);
  // 有具体来源时按类型换个说法，别出现“被世界边界攻击”这种别扭句子
  switch (cause) {
    case 'generic':
      // “来自僵尸”比“僵尸造成的伤害”短，配上后半句“（3 点）”也不会重复“伤害”两个字
      return tp('notice.damage.from', { source: from });
    case 'projectile':
      return tp('notice.damage.shotBy', { source: from });
    case 'explosion':
      return tp('notice.damage.explosionOf', { source: from });
    case 'fire':
      return tp('notice.damage.fireOf', { source: from });
    case 'poison':
      return tp('notice.damage.poisonOf', { source: from });
    // 凋零也可能带来源（“凋灵骷髅导致的凋零”），句式与中毒保持一致
    case 'wither':
      return tp('notice.damage.witherOf', { source: from });
    default:
      return tp('notice.damage.withSource', { cause: causeText(cause), source: from });
  }
}
