/**
 * PT 文案·提示（与 `locales/zh/notice.ts` **键集必须相同**）
 *
 * `satisfies Pick<Messages, keyof typeof zhNotice>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { notice as zhNotice } from '../zh/notice.ts';

export const notice = {
  "notice.damage.cause.poison": "Veneno (dano contínuo)",
  "notice.damage.cause.wither": "Definhamento (dano contínuo, fatal)",
  "notice.damage.cause.freeze": "Congelamento (muito tempo na neve fofa)",
  "notice.damage.cause.fall": "Queda (caiu de altura)",
  "notice.damage.cause.drown": "Afogamento (sem ar)",
  "notice.damage.cause.lava": "Lava (saia já — água não apaga)",
  "notice.damage.cause.fire": "Em chamas (no fogo/magma ou incendiado)",
  "notice.damage.cause.cactus": "Cacto (um bloco espinhoso)",
  "notice.damage.cause.sweetBerry": "Arbusto de bagas doces (espetou-se)",
  "notice.damage.cause.suffocate": "Sufocamento (cabeça presa num bloco)",
  "notice.damage.cause.starve": "Fome (fome esgotada)",
  "notice.damage.cause.void": "Vazio (caiu fora do mundo)",
  "notice.damage.cause.explosion": "Explosão (TNT / Creeper / cama)",
  "notice.damage.cause.projectile": "Atingido por um projétil",
  "notice.damage.cause.lightning": "Atingido por um raio",
  "notice.damage.cause.generic": "Dano sofrido (fonte não registrada)",
  "notice.damage.from": "De {source}",
  "notice.damage.shotBy": "Atingido por {source}",
  "notice.damage.explosionOf": "Explosão causada por {source}",
  "notice.damage.fireOf": "Dano de fogo de {source}",
  "notice.damage.poisonOf": "Envenenamento por {source}",
  "notice.damage.witherOf": "Definhamento por {source}",
  "notice.damage.withSource": "{cause} (fonte: {source})",
} satisfies Pick<Messages, keyof typeof zhNotice>;
