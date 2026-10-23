/**
 * RU 文案·提示（与 `locales/zh/notice.ts` **键集必须相同**）
 *
 * `satisfies Pick<Messages, keyof typeof zhNotice>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { notice as zhNotice } from '../zh/notice.ts';

export const notice = {
  "notice.damage.cause.poison": "Отравление (урон со временем)",
  "notice.damage.cause.wither": "Иссушение (урон со временем, смертельно)",
  "notice.damage.cause.freeze": "Замерзание (слишком долго в рыхлом снегу)",
  "notice.damage.cause.fall": "Урон от падения (упал с высоты)",
  "notice.damage.cause.drown": "Утопление (кончился воздух)",
  "notice.damage.cause.lava": "Лава (уходи немедленно — водой не потушить)",
  "notice.damage.cause.fire": "Горишь (стоишь в огне/на магме или подожгли)",
  "notice.damage.cause.cactus": "Кактус (колючий блок)",
  "notice.damage.cause.sweetBerry": "Куст сладких ягод (укололся)",
  "notice.damage.cause.suffocate": "Удушье (голова застряла в блоке)",
  "notice.damage.cause.starve": "Голод (закончилась сытость)",
  "notice.damage.cause.void": "Пустота (выпал из мира)",
  "notice.damage.cause.explosion": "Взрыв (ТНТ / крипер / кровать)",
  "notice.damage.cause.projectile": "Попадание снаряда",
  "notice.damage.cause.lightning": "Попадание молнии",
  "notice.damage.cause.generic": "Получен урон (источник не записан)",
  "notice.damage.from": "От {source}",
  "notice.damage.shotBy": "Попадание от {source}",
  "notice.damage.explosionOf": "Взрыв от {source}",
  "notice.damage.fireOf": "Урон огнём от {source}",
  "notice.damage.poisonOf": "Отравление от {source}",
  "notice.damage.witherOf": "Иссушение от {source}",
  "notice.damage.withSource": "{cause} (источник: {source})",
} satisfies Pick<Messages, keyof typeof zhNotice>;
