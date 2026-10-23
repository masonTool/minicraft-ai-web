/**
 * 葡语文案·minigame（与 `locales/zh/minigame.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-4：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { minigame as zhMinigame } from '../zh/minigame.ts';

export const minigame = {
  "tutorial.progress": "Passo {current} de {total}",
  "tutorial.collapse": "Recolher",
  "tutorial.expand": "Expandir",
  "tutorial.dismiss": "Não mostrar mais",
  "tutorial.finish": "Tutorial concluído! Agora construa à vontade",
  "minigame.exit": "Sair",
  "minigame.crashed": "O minijogo deu erro e foi encerrado",
  "minigame.smoke.title": "Autoteste da engine",
  "minigame.smoke.hint": "Toque para alternar o estado (autoteste)",
  "minigame.smoke.won": "Passou!",
  "minigame.smoke.playing": "Continuar",
  "minigame.menu.title": "Minijogos",
  "minigame.menu.back": "‹ Voltar",
  "minigame.menu.best": "Recorde {best}",
  "minigame.jump.title": "Pulo",
  "minigame.jump.desc": "Segure para carregar, solte para pular",
  "minigame.jump.hint": "Segure para carregar, solte para pular",
  "minigame.jump.best": "Recorde {best}",
  "minigame.jump.over": "{score} pontos nesta partida",
  "minigame.jump.retry": "Jogar de novo",
  "minigame.jump.record": "Novo recorde!",
  "tutorial.survival.log.title": "Corte uma árvore primeiro",
  "tutorial.survival.log.desc": "Chegue perto do tronco e segure (clique esquerdo ou dedo) para quebrar",
  "tutorial.survival.table.title": "Faça uma bancada",
  "tutorial.survival.table.desc": "4 tábuas no inventário",
  "tutorial.survival.woodPickaxe.title": "Faça uma picareta de madeira",
  "tutorial.survival.woodPickaxe.desc": "3 tábuas + 2 gravetos",
  "tutorial.survival.stonePickaxe.title": "Minere pedra e troque para a picareta de pedra",
  "tutorial.survival.stonePickaxe.desc": "Minere pedregulho com a picareta de madeira e faça uma de pedra (alguns blocos abaixo já é pedra)",
  "tutorial.creative.place10.title": "Coloque 10 blocos",
  "tutorial.creative.place10.desc": "Escolha um bloco na barra de baixo e toque no chão",
  "tutorial.creative.layers.title": "Suba 3 camadas",
  "tutorial.creative.layers.desc": "Empilhe alguns blocos para ver até onde dá",
  "tutorial.creative.colors.title": "Troque 3 cores",
  "tutorial.creative.colors.desc": "Experimente blocos de outras cores",
  "tutorial.creative.door.title": "Coloque uma porta",
  "tutorial.creative.door.desc": "Uma porta na parede e você entra e sai à vontade",
} satisfies Pick<Messages, keyof typeof zhMinigame>;
