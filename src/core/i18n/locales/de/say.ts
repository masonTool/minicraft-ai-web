/**
 * 德语文案·say（与 `locales/zh/say.ts` **键集必须相同**）
 *
 * ⚠️ `satisfies Pick<Messages, keyof typeof zhSay>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { say as zhSay } from '../zh/say.ts';

export const say = {
  'say.damage.taken': '{amount} Schaden erlitten: {reasons} · Leben {health}/20',
  'say.damage.reason': '{cause} ({amount})',
  'say.damage.sep': '; ',
  'say.health.gain': 'Leben +{amount} (natürliche Regeneration oder Heilung) · Jetzt {health}/20',
  'say.food.loss': 'Hunger -{amount} (Laufen / Springen / Kämpfen / Graben) · Noch {food}/20{hint}',
  'say.food.lowHint': ' · Iss bald etwas, sonst verlierst du Leben',
  'say.food.gain': 'Hunger +{amount} (Essen / Sättigung) · Jetzt {food}/20',
  'say.health.low': 'Wenig Leben ({health}/20): geh aus der Gefahr, Essen stellt Leben wieder her',
  'say.food.starving': 'Hunger erschöpft: Du verlierst ständig Leben und regenerierst nicht mehr; iss jetzt etwas',
  'say.air.low': 'Wenig Luft (unter Wasser, noch {air}): auftauchen zum Atmen',
  'say.air.empty': 'Keine Luft mehr: Du ertrinkst, sofort auftauchen',
  'say.air.back': 'Wieder an der Oberfläche: die Luft füllt sich auf',
  'say.burning': 'Du brennst (im Feuer / in Lava oder entzündet): jede Sekunde Schaden, spring ins Wasser',
  'say.shield.axeBreak': 'Schild durch einen Axttreffer durchbrochen ({seconds} s)',
  'say.shield.broken': 'Dein Schild ist zerbrochen',
  'say.totem.saved': 'Ein Totem der Unsterblichkeit hat dich gerettet',
  'say.hardcore.dead': 'Hardcore: Du bist gestorben und kannst nur noch als Zuschauer zusehen',
  'say.respawn.anchorEmpty': 'Der Seelenanker ist entladen; du erscheinst am Weltspawn',
  'say.respawn.bedGone': 'Dein Bett ist weg; du erscheinst am Weltspawn',
} satisfies Pick<Messages, keyof typeof zhSay>;
