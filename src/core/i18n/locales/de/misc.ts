/**
 * 德语文案·misc（与 `locales/zh/misc.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-1：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { misc as zhMisc } from '../zh/misc.ts';

export const misc = {
  "pause.title": "Spiel pausiert",
  "pause.resume": "Weiterspielen",
  "pause.settings": "Einstellungen",
  "pause.achievements": "Erfolge",
  "pause.statistics": "Statistiken",
  "pause.exit": "Speichern und zum Hauptmenü",
  "unit.item": "Stk.",
  "unit.bottle": "Fl.",
  "fullscreen.rotateTitle": "Bitte im Querformat spielen",
  "fullscreen.rotateDetail": "Tippe für Vollbild im Querformat · Handy drehen startet ebenfalls",
  "fullscreen.rotateIosDetail": "Einfach das Handy drehen; für Vollbild „Teilen → Zum Home-Bildschirm\"",
  "install.hint": "Zum Home-Bildschirm hinzufügen – danach startet es im Vollbild-Querformat",
  "install.add": "Hinzufügen",
  "install.later": "Später",
  "install.iosHint": "Safari kann Webseiten nicht direkt im Vollbild zeigen: „Teilen\" → „Zum Home-Bildschirm\", dann über das Symbol starten.",
  "install.iosOk": "Verstanden",
  "death.title": "Du bist gestorben!",
  "death.respawning": "Wiederbelebung…",
  "sleep.dawn": "Es wird hell",
  "sleep.hint": "Springen weckt dich früher",
  "sleep.lieDown": "Du legst dich hin… (Springen oder Overlay antippen weckt dich)",
  "touch.sneak": "Schleichen",
  "touch.flyUp": "Hochfliegen",
  "touch.flyDown": "Runterfliegen",
  "touch.hint": "Stick zum Laufen · doppelt tippen zum Schleichen · ziehen zum Umsehen · tippen zum Setzen · halten zum Abbauen/Benutzen · doppelt springen zum Fliegen (dann erscheinen Hoch/Runter)",
  "touch.icon.jump": "Springen",
  "touch.icon.sneak": "Schleichen",
  "touch.icon.inventory": "Inventar",
  "touch.icon.chat": "Chat & Befehle",
  "touch.icon.pause": "Pause & Einstellungen",
  "touch.icon.view": "Perspektive wechseln",
  "tooltip.unstackable": "Nicht stapelbar",
  "tooltip.maxStack": "Bis zu {n} pro Feld",
  "loading.world": "Welt wird erzeugt…",
  "loading.failed": "Laden fehlgeschlagen – Seite neu laden",
  "unsupported.title": "Dieses Spiel läuft auf diesem Gerät gerade nicht",
  "unsupported.reload": "Seite neu laden",
  "unsupported.code": "Diagnosecode: {code}",
  "time.lastPlayed": "Zuletzt gespielt {when} · Gespielt {played}",
  "time.underMinute": "Unter 1 Minute",
  "time.minutes": "{n} Min.",
  "time.hoursMinutes": "{h} Std. {m} Min.",
  "time.minutesSeconds": "{m} Min. {s} Sek.",
  "time.seconds": "{n} Sek.",
  "loading.boot": "Lädt…",
  "loading.bootSub": "Texturen und Spielstand werden vorbereitet",
  "misc.cameraModeToast": "Ansicht: {mode}"
} satisfies Pick<Messages, keyof typeof zhMisc>;
