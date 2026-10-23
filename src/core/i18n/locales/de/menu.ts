/**
 * 德语文案·menu（与 `locales/zh/menu.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-1：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { menu as zhMenu } from '../zh/menu.ts';

export const menu = {
  "menu.tagline": "Echtes Survival, Kreativmodus und Welten mit Speicherung",
  "menu.play": "Spielen",
  "menu.settings": "Einstellungen",
  "menu.footer": "Inoffizieller Web-Nachbau · Spielstände bleiben auf diesem Gerät",
  "menu.newWorld": "+ Neue Welt",
  "menu.empty": "Noch keine Welt – tippe oben auf „+ Neue Welt\".",
  "menu.back": "‹ Zurück",
  "menu.cancel": "Abbrechen",
  "menu.reroll": "Zufällig",
  "menu.create": "Erstellen und betreten",
  "world.list": "Welt",
  "world.name": "Weltname",
  "world.seed": "Weltseed",
  "world.type": "Welttyp",
  "world.biome": "Biom",
  "world.difficulty": "Schwierigkeit",
  "world.gameMode": "Spielmodus",
  "world.hardcore": "Hardcore",
  "world.hardcoreOff": "Normal",
  "world.hardcoreOn": "Hardcore",
  "world.namePlaceholder": "Leer lassen für automatischen Namen",
  "world.seedPlaceholder": "Leer = zufällig",
  "world.hint": "Gleicher Seed erzeugt gleiches Gelände; eine Superflach-Welt hat nur eine Grasschicht.",
  "world.createTitle": "Neue Welt erstellen",
  "world.enter": "Betreten",
  "world.edit": "Bearbeiten",
  "world.editTitle": "Welt bearbeiten",
  "world.save": "Speichern",
  "world.editHint": "Modus und Schwierigkeit gelten beim nächsten Betreten.",
  "world.delete": "Löschen",
  "world.export": "Exportieren",
  "world.import": "Spielstand importieren",
  "menu.minigames": "Minispiele",
  "world.saveFailed": "Speichern fehlgeschlagen, bitte erneut versuchen",
} satisfies Pick<Messages, keyof typeof zhMenu>;
