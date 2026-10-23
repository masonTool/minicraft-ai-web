/**
 * 葡语文案·menu（与 `locales/zh/menu.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-4：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { menu as zhMenu } from '../zh/menu.ts';

export const menu = {
  "menu.tagline": "Survival e criativo nativos, vários mundos salvos",
  "menu.play": "Jogar",
  "menu.settings": "Configurações",
  "menu.footer": "Recriação web não oficial · os saves ficam neste aparelho",
  "menu.newWorld": "＋ Novo mundo",
  "menu.empty": "Nenhum save ainda — toque em « ＋ Novo mundo » acima para começar.",
  "menu.back": "‹ Voltar",
  "menu.cancel": "Cancelar",
  "menu.reroll": "Aleatório",
  "menu.create": "Criar e entrar",
  "world.list": "Mundos",
  "world.name": "Nome do mundo",
  "world.seed": "Semente",
  "world.type": "Tipo de mundo",
  "world.biome": "Bioma",
  "world.difficulty": "Dificuldade",
  "world.gameMode": "Modo de jogo",
  "world.hardcore": "Modo hardcore",
  "world.hardcoreOff": "Normal",
  "world.hardcoreOn": "Hardcore",
  "world.namePlaceholder": "Deixe vazio para nomear automaticamente",
  "world.seedPlaceholder": "Vazio = aleatório",
  "world.hint": "A mesma semente gera o mesmo terreno; um mundo superplano tem só uma camada de grama.",
  "world.createTitle": "Criar novo mundo",
  "world.enter": "Entrar",
  "world.edit": "Editar",
  "world.editTitle": "Editar mundo",
  "world.save": "Salvar",
  "world.editHint": "O modo e a dificuldade valem na próxima vez que você entrar no mundo.",
  "world.delete": "Excluir",
  "world.export": "Exportar",
  "world.import": "Importar save",
  "menu.minigames": "Minijogos",
  "world.saveFailed": "Falha ao salvar, tente novamente",
  "world.seedHint": "Digite um número como semente, ou deixe vazio para uma aleatória.",
  "world.survivalWarn": "{base} — no survival, escolha o mundo padrão ou mude para o criativo.",
  "world.typeHint.default": "Mundo completo: biomas, árvores, minérios, vilas, fortalezas… recomendado no survival",
  "world.typeHint.amplified": "Tudo igual ao mundo padrão, mas com relevo maior e montanhas mais altas",
  "world.typeHint.flat": "Só três camadas planas: sem árvores, vilas ou minérios (bom para construir/criativo)",
  "world.typeHint.large_biomes": "Um mundo completo como o padrão, mas os biomas são cerca de ×4 maiores",
  "world.typeHint.single_biome": "O mesmo terreno do padrão, mas o mundo inteiro é um bioma (escolha abaixo)",
} satisfies Pick<Messages, keyof typeof zhMenu>;
