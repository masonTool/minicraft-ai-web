/**
 * 法语文案·minigame（与 `locales/zh/minigame.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-3：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 * ⚠️ 值里的撇号统一写成排版撇号 `’`（`l’eau`），避免转义且符合法语排版。
 */

import type { Messages } from '../zh/index.ts';
import type { minigame as zhMinigame } from '../zh/minigame.ts';

export const minigame = {
  "tutorial.progress": "Étape {current} / {total}",
  "tutorial.collapse": "Réduire",
  "tutorial.expand": "Déplier",
  "tutorial.dismiss": "Ne plus afficher",
  "tutorial.finish": "Tutoriel terminé ! À vous de construire",
  "minigame.exit": "Quitter",
  "minigame.crashed": "Le mini-jeu a planté, retour au jeu",
  "minigame.smoke.title": "Auto-test du moteur",
  "minigame.smoke.hint": "Touchez pour changer d’état (auto-test)",
  "minigame.smoke.won": "Réussi !",
  "minigame.smoke.playing": "Continuer",
  "minigame.menu.title": "Mini-jeux",
  "minigame.menu.back": "‹ Retour",
  "minigame.menu.best": "Record {best}",
  "minigame.jump.title": "Saut",
  "minigame.jump.desc": "Maintenez pour charger, relâchez pour sauter",
  "minigame.jump.best": "Record {best}",
  "minigame.jump.over": "Score",
  "minigame.jump.retry": "Rejouer",
  "minigame.jump.record": "Nouveau record !",
  "tutorial.survival.log.title": "Coupez d’abord un arbre",
  "tutorial.survival.log.desc": "Approchez du tronc et maintenez (clic gauche ou doigt) pour le casser",
  "tutorial.survival.table.title": "Fabriquez un établi",
  "tutorial.survival.table.desc": "4 planches dans l’inventaire",
  "tutorial.survival.woodPickaxe.title": "Fabriquez une pioche en bois",
  "tutorial.survival.woodPickaxe.desc": "3 planches + 2 bâtons",
  "tutorial.survival.stonePickaxe.title": "Minez de la pierre, passez à la pioche en pierre",
  "tutorial.survival.stonePickaxe.desc": "Minez du caillou avec la pioche en bois, puis fabriquez une pioche en pierre (quelques blocs plus bas, c’est de la pierre)",
  "tutorial.creative.place10.title": "Posez 10 blocs",
  "tutorial.creative.place10.desc": "Choisissez un bloc dans la barre du bas, puis touchez le sol",
  "tutorial.creative.layers.title": "Montez sur 3 niveaux",
  "tutorial.creative.layers.desc": "Empilez quelques blocs pour voir jusqu’où vous montez",
  "tutorial.creative.colors.title": "Changez 3 couleurs",
  "tutorial.creative.colors.desc": "Essayez des blocs d’autres couleurs",
  "tutorial.creative.door.title": "Posez une porte",
  "tutorial.creative.door.desc": "Une porte dans un mur et vous entrez et sortez librement",
} satisfies Pick<Messages, keyof typeof zhMinigame>;
