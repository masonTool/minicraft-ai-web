/**
 * EN 文案·提示（与 `locales/zh/notice.ts` **键集必须相同**）
 *
 * `satisfies Pick<Messages, keyof typeof zhNotice>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { notice as zhNotice } from '../zh/notice.ts';

export const notice = {
  "notice.damage.cause.poison": "Poison (damage over time)",
  "notice.damage.cause.wither": "Wither (damage over time, lethal)",
  "notice.damage.cause.freeze": "Freezing (too long in powder snow)",
  "notice.damage.cause.fall": "Fall damage (landing from a height)",
  "notice.damage.cause.drown": "Drowning (out of air)",
  "notice.damage.cause.lava": "Lava (get out now — water will not put it out)",
  "notice.damage.cause.fire": "On fire (standing in fire/magma, or set alight)",
  "notice.damage.cause.cactus": "Cactus (a spiky block)",
  "notice.damage.cause.sweetBerry": "Sweet berry bush (got pricked)",
  "notice.damage.cause.suffocate": "Suffocation (head stuck in a block)",
  "notice.damage.cause.starve": "Starvation (hunger ran out)",
  "notice.damage.cause.void": "Void (fell out of the world)",
  "notice.damage.cause.explosion": "Explosion (TNT / Creeper / bed)",
  "notice.damage.cause.projectile": "Hit by a projectile",
  "notice.damage.cause.lightning": "Struck by lightning",
  "notice.damage.cause.generic": "Took damage (no source recorded)",
  "notice.damage.from": "From {source}",
  "notice.damage.shotBy": "Shot by {source}",
  "notice.damage.explosionOf": "Explosion caused by {source}",
  "notice.damage.fireOf": "Fire damage from {source}",
  "notice.damage.poisonOf": "Poisoning from {source}",
  "notice.damage.witherOf": "Withering from {source}",
  "notice.damage.withSource": "{cause} (source: {source})",
} satisfies Pick<Messages, keyof typeof zhNotice>;
