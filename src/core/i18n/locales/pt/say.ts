/**
 * 葡语（巴西）文案·say（与 `locales/zh/say.ts` **键集必须相同**）
 *
 * ⚠️ `satisfies Pick<Messages, keyof typeof zhSay>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { say as zhSay } from '../zh/say.ts';

export const say = {
  'say.damage.taken': '{amount} de dano: {reasons} · Vida {health}/20',
  'say.damage.reason': '{cause} ({amount})',
  'say.damage.sep': '; ',
  'say.health.gain': 'Vida +{amount} (regeneração natural ou cura) · Agora {health}/20',
  'say.food.loss': 'Fome -{amount} (correr / pular / lutar / minerar) · Restam {food}/20{hint}',
  'say.food.lowHint': ' · Coma algo logo, senão você vai perder vida',
  'say.food.gain': 'Fome +{amount} (comer / saturação) · Agora {food}/20',
  'say.health.low': 'Vida baixa ({health}/20): saia do perigo, comer recupera vida',
  'say.food.starving': 'Fome esgotada: você perde vida continuamente e não regenera; coma agora',
  'say.air.low': 'Pouco ar (debaixo d’água, {air} restante): suba para respirar',
  'say.air.empty': 'Sem ar: você está se afogando, suba imediatamente',
  'say.air.back': 'De volta à superfície: o ar está voltando',
  'say.burning': 'Você está em chamas (no fogo / lava ou incendiado): perde vida a cada segundo, pule na água',
  'say.shield.axeBreak': 'Escudo quebrado por um machado ({seconds} s)',
  'say.shield.broken': 'Seu escudo quebrou',
  'say.totem.saved': 'Um Totem da Imortalidade salvou sua vida',
  'say.hardcore.dead': 'Hardcore: você morreu e só pode continuar como espectador',
  'say.respawn.anchorEmpty': 'A âncora de renascimento está sem carga; renascendo no ponto inicial do mundo',
  'say.respawn.bedGone': 'Sua cama sumiu; renascendo no ponto inicial do mundo',
} satisfies Pick<Messages, keyof typeof zhSay>;
