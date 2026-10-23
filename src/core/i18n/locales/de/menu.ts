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
  "world.seedHint": "Gib eine Zahl als Seed ein oder lass das Feld leer für einen zufälligen.",
  "world.survivalWarn": "{base} — im Überleben besser die Standardwelt wählen oder in den Kreativmodus wechseln.",
  "world.typeHint.default": "Volle Welt: Biome, Bäume, Erze, Dörfer, Festungen… für Überleben empfohlen",
  "world.typeHint.amplified": "Alles wie in der Standardwelt, nur mit größeren Höhenunterschieden und höheren Bergen",
  "world.typeHint.flat": "Nur drei flache Schichten: keine Bäume, Dörfer oder Erze (gut zum Bauen/Kreativ)",
  "world.typeHint.large_biomes": "Eine volle Welt wie die Standardwelt, aber Biome sind etwa ×4 größer",
  "world.typeHint.single_biome": "Gleiches Gelände wie Standard, aber die ganze Welt ist ein Biom (unten wählen)",
} satisfies Pick<Messages, keyof typeof zhMenu>;
