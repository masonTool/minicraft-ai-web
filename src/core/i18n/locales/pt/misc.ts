/**
 * 葡语文案·misc（与 `locales/zh/misc.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-4：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`。
 */

import type { Messages } from '../zh/index.ts';
import type { misc as zhMisc } from '../zh/misc.ts';

export const misc = {
  "pause.title": "Jogo pausado",
  "pause.resume": "Continuar",
  "pause.settings": "Configurações",
  "pause.achievements": "Conquistas",
  "pause.statistics": "Estatísticas",
  "pause.exit": "Salvar e sair para o menu",
  "unit.item": "unidade",
  "unit.bottle": "frasco",
  "fullscreen.rotateTitle": "Jogue na horizontal",
  "fullscreen.rotateDetail": "Toque para entrar em tela cheia na horizontal · girar o celular também começa",
  "fullscreen.rotateIosDetail": "Basta girar o celular; para tela cheia use « Compartilhar → Adicionar à Tela de Início »",
  "install.hint": "Adicionado à Tela de Início, o jogo abre em tela cheia na horizontal",
  "install.add": "Adicionar",
  "install.later": "Depois",
  "install.iosHint": "O Safari não coloca uma página em tela cheia: toque em « Compartilhar » → « Adicionar à Tela de Início » e abra pelo ícone.",
  "install.iosOk": "Entendi",
  "death.title": "Você morreu!",
  "death.respawning": "Renascendo…",
  "sleep.dawn": "Amanhecendo",
  "sleep.hint": "A tecla de pulo levanta mais cedo",
  "sleep.lieDown": "Você se deitou… (pulo ou toque na tela para levantar)",
  "touch.sneak": "Agachar",
  "touch.flyUp": "Subir",
  "touch.flyDown": "Descer",
  "touch.hint": "Analógico para andar · toque duplo para agachar · arraste para olhar · toque para colocar · segure para minerar/usar · toque duplo no pulo para voar",
  "touch.icon.jump": "Pular",
  "touch.icon.sneak": "Agachar",
  "touch.icon.inventory": "Inventário",
  "touch.icon.chat": "Bate-papo e comandos",
  "touch.icon.pause": "Pausa e configurações",
  "touch.icon.view": "Trocar de câmera",
  "tooltip.unstackable": "Não empilhável",
  "tooltip.maxStack": "Até {n} por slot",
  "loading.world": "Gerando mundo…",
  "loading.failed": "Falha ao carregar, recarregue a página",
  "unsupported.title": "Este aparelho não consegue abrir o jogo por enquanto",
  "unsupported.reload": "Recarregar página",
  "unsupported.code": "Código de diagnóstico: {code}",
  "time.lastPlayed": "Última partida {when} · {played} de jogo",
  "time.underMinute": "menos de 1 minuto",
  "time.minutes": "{n} minutos",
  "time.hoursMinutes": "{h} h {m} min",
  "time.minutesSeconds": "{m} min {s} s",
  "time.seconds": "{n} s",
  "loading.boot": "Carregando…",
  "loading.bootSub": "Preparando texturas e saves",
  "misc.cameraModeToast": "Câmera: {mode}",
  "misc.close": "Fechar",
} satisfies Pick<Messages, keyof typeof zhMisc>;
