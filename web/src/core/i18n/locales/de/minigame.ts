/**
 * 德语文案·minigame（与 `locales/zh/minigame.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-1：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { minigame as zhMinigame } from '../zh/minigame.ts';

export const minigame = {
  "tutorial.progress": "Schritt {current} von {total}",
  "tutorial.collapse": "Einklappen",
  "tutorial.expand": "Ausklappen",
  "tutorial.dismiss": "Nicht mehr zeigen",
  "tutorial.finish": "Einführung abgeschlossen! Jetzt frei bauen",
  "minigame.exit": "Beenden",
  "minigame.crashed": "Minispiel abgestürzt und beendet",
  "minigame.smoke.title": "Selbsttest",
  "minigame.smoke.hint": "Antippen wechselt den Zustand (Selbsttest)",
  "minigame.smoke.won": "Geschafft!",
  "minigame.smoke.playing": "Weiter",
  "minigame.menu.title": "Minispiele",
  "minigame.menu.back": "‹ Zurück",
  "minigame.menu.best": "Bestwert {best}",
  "minigame.jump.title": "Hüpf",
  "minigame.jump.desc": "Halten zum Aufladen, loslassen zum Springen",
  "minigame.jump.best": "Bestwert {best}",
  "minigame.jump.over": "Punkte",
  "minigame.jump.retry": "Nochmal",
  "minigame.jump.record": "Neuer Rekord!",
  "tutorial.survival.log.title": "Zuerst einen Baum fällen",
  "tutorial.survival.log.desc": "Zum Stamm gehen und mit Linksklick (oder Finger) abbauen",
  "tutorial.survival.table.title": "Eine Werkbank bauen",
  "tutorial.survival.table.desc": "Im Inventar aus 4 Brettern herstellen",
  "tutorial.survival.woodPickaxe.title": "Eine Holzspitzhacke bauen",
  "tutorial.survival.woodPickaxe.desc": "3 Bretter + 2 Stöcke",
  "tutorial.survival.stonePickaxe.title": "Stein abbauen und zur Steinspitzhacke wechseln",
  "tutorial.survival.stonePickaxe.desc": "Mit der Holzspitzhacke Bruchstein abbauen und eine Steinspitzhacke bauen (ein paar Blöcke nach unten ist Stein)",
  "tutorial.creative.place10.title": "Setze zuerst 10 Blöcke",
  "tutorial.creative.place10.desc": "Unten im Inventar einen Block wählen und auf den Boden tippen",
  "tutorial.creative.layers.title": "Baue 3 Schichten nach oben",
  "tutorial.creative.layers.desc": "Stapel ein paar Blöcke, um zu sehen, wie hoch du kommst",
  "tutorial.creative.colors.title": "Wechsle 3 Farben",
  "tutorial.creative.colors.desc": "Probiere Blöcke in anderen Farben aus",
  "tutorial.creative.door.title": "Setze eine Tür ein",
  "tutorial.creative.door.desc": "Eine Tür in die Wand setzen – schon kommst du rein und raus",
} satisfies Pick<Messages, keyof typeof zhMinigame>;
