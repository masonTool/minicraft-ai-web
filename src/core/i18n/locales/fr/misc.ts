/**
 * 法语文案·misc（与 `locales/zh/misc.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-3：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 * ⚠️ 值里的撇号统一写成排版撇号 `’`（`l’eau`），避免转义且符合法语排版。
 */

import type { Messages } from '../zh/index.ts';
import type { misc as zhMisc } from '../zh/misc.ts';

export const misc = {
  "pause.title": "Jeu en pause",
  "pause.resume": "Reprendre",
  "pause.settings": "Réglages",
  "pause.achievements": "Succès",
  "pause.statistics": "Statistiques",
  "pause.exit": "Enregistrer et quitter vers le menu",
  "unit.item": "unité",
  "unit.bottle": "flacon",
  "fullscreen.rotateTitle": "Passez en mode paysage",
  "fullscreen.rotateDetail": "Touchez pour passer en plein écran paysage · tourner le téléphone suffit aussi",
  "fullscreen.rotateIosDetail": "Tournez le téléphone ; pour le plein écran, utilisez « Partager → Sur l’écran d’accueil »",
  "install.hint": "Ajouté à l’écran d’accueil, le jeu s’ouvre en plein écran paysage",
  "install.add": "Ajouter",
  "install.later": "Plus tard",
  "install.iosHint": "Safari ne peut pas mettre une page en plein écran : touchez « Partager » → « Sur l’écran d’accueil », puis ouvrez depuis l’icône.",
  "install.iosOk": "Compris",
  "death.title": "Vous êtes mort !",
  "death.respawning": "Réapparition…",
  "sleep.dawn": "Le jour se lève",
  "sleep.hint": "La touche saut permet de se lever plus tôt",
  "sleep.lieDown": "Vous êtes allongé… (saut ou toucher l’écran pour vous lever)",
  "touch.sneak": "S’accroupir",
  "touch.flyUp": "Monter",
  "touch.flyDown": "Descendre",
  "touch.hint": "Joystick pour marcher · double-tap pour s’accroupir · glisser pour regarder · tap pour poser · maintenir pour miner/utiliser · double-tap saut pour voler",
  "touch.icon.jump": "Sauter",
  "touch.icon.sneak": "S’accroupir",
  "touch.icon.inventory": "Inventaire",
  "touch.icon.chat": "Chat et commandes",
  "touch.icon.pause": "Pause et réglages",
  "touch.icon.view": "Changer de vue",
  "tooltip.unstackable": "Non empilable",
  "tooltip.maxStack": "Jusqu’à {n} par case",
  "loading.world": "Génération du monde…",
  "loading.failed": "Échec du chargement, rafraîchissez la page",
  "unsupported.title": "Cet appareil ne peut pas ouvrir le jeu pour le moment",
  "unsupported.reload": "Rafraîchir la page",
  "unsupported.code": "Code de diagnostic : {code}",
  "time.lastPlayed": "Dernière partie {when} · {played} de jeu",
  "time.underMinute": "moins d’une minute",
  "time.minutes": "{n} minutes",
  "time.hoursMinutes": "{h} h {m} min",
  "time.minutesSeconds": "{m} min {s} s",
  "time.seconds": "{n} s",
  "loading.boot": "Chargement…",
  "loading.bootSub": "Préparation des textures et des sauvegardes",
  "misc.cameraModeToast": "Caméra : {mode}"
} satisfies Pick<Messages, keyof typeof zhMisc>;
