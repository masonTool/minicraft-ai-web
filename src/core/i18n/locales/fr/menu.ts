/**
 * 法语文案·menu（与 `locales/zh/menu.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-3：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 * ⚠️ 值里的撇号统一写成排版撇号 `’`（`l’eau`），避免转义且符合法语排版。
 */

import type { Messages } from '../zh/index.ts';
import type { menu as zhMenu } from '../zh/menu.ts';

export const menu = {
  "menu.tagline": "Survie et création natives, sauvegardes multi-mondes",
  "menu.play": "Jouer",
  "menu.settings": "Réglages",
  "menu.footer": "Portage web non officiel · les sauvegardes restent sur cet appareil",
  "menu.newWorld": "＋ Nouveau monde",
  "menu.empty": "Aucune sauvegarde — touchez « ＋ Nouveau monde » ci-dessus pour commencer.",
  "menu.back": "‹ Retour",
  "menu.cancel": "Annuler",
  "menu.reroll": "Aléatoire",
  "menu.create": "Créer et entrer",
  "world.list": "Mondes",
  "world.name": "Nom du monde",
  "world.seed": "Graine",
  "world.type": "Type de monde",
  "world.biome": "Biome",
  "world.difficulty": "Difficulté",
  "world.gameMode": "Mode de jeu",
  "world.hardcore": "Mode hardcore",
  "world.hardcoreOff": "Normal",
  "world.hardcoreOn": "Hardcore",
  "world.namePlaceholder": "Laissez vide pour un nom automatique",
  "world.seedPlaceholder": "Vide = aléatoire",
  "world.hint": "La même graine donne le même terrain ; un monde superflat n’a qu’une couche d’herbe.",
  "world.createTitle": "Créer un monde",
  "world.enter": "Entrer",
  "world.edit": "Modifier",
  "world.editTitle": "Modifier le monde",
  "world.save": "Enregistrer",
  "world.editHint": "Le mode et la difficulté s’appliqueront à la prochaine entrée dans le monde.",
  "world.delete": "Supprimer",
  "world.export": "Exporter",
  "world.import": "Importer une sauvegarde",
  "menu.minigames": "Mini-jeux",
} satisfies Pick<Messages, keyof typeof zhMenu>;
