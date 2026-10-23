/**
 * 俄语文案·minigame（与 `locales/zh/minigame.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-2：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { minigame as zhMinigame } from '../zh/minigame.ts';

export const minigame = {
  "tutorial.progress": "Шаг {current} из {total}",
  "tutorial.collapse": "Свернуть",
  "tutorial.expand": "Развернуть",
  "tutorial.dismiss": "Больше не показывать",
  "tutorial.finish": "Обучение пройдено! Теперь стройте свободно",
  "minigame.exit": "Выйти",
  "minigame.crashed": "Мини-игра сломалась и закрыта",
  "minigame.smoke.title": "Самопроверка",
  "minigame.smoke.hint": "Нажмите, чтобы переключить состояние (самопроверка)",
  "minigame.smoke.won": "Пройдено!",
  "minigame.smoke.playing": "Дальше",
  "minigame.menu.title": "Мини-игры",
  "minigame.menu.back": "‹ Назад",
  "minigame.menu.best": "Лучший {best}",
  "minigame.jump.title": "Прыжки",
  "minigame.jump.desc": "Удерживайте для накопления силы, отпустите для прыжка",
  "minigame.jump.hint": "Удерживайте для накопления силы, отпустите для прыжка",
  "minigame.jump.best": "Лучший {best}",
  "minigame.jump.over": "В этой игре {score} очков",
  "minigame.jump.retry": "Ещё раз",
  "minigame.jump.record": "Новый рекорд!",
  "tutorial.survival.log.title": "Сначала срубите дерево",
  "tutorial.survival.log.desc": "Подойдите к стволу и удерживайте левую кнопку (или палец), чтобы сломать его",
  "tutorial.survival.table.title": "Сделайте верстак",
  "tutorial.survival.table.desc": "В инвентаре из 4 досок",
  "tutorial.survival.woodPickaxe.title": "Сделайте деревянную кирку",
  "tutorial.survival.woodPickaxe.desc": "3 доски + 2 палки",
  "tutorial.survival.stonePickaxe.title": "Добудьте камень и смените кирку",
  "tutorial.survival.stonePickaxe.desc": "Деревянной киркой добудьте булыжник и сделайте каменную кирку (несколько блоков вниз — уже камень)",
  "tutorial.creative.place10.title": "Поставьте 10 блоков",
  "tutorial.creative.place10.desc": "Выберите блок на панели снизу и нажмите на землю",
  "tutorial.creative.layers.title": "Постройте 3 слоя вверх",
  "tutorial.creative.layers.desc": "Складывайте блоки друг на друга, чтобы понять, как высоко можно забраться",
  "tutorial.creative.colors.title": "Смените 3 цвета",
  "tutorial.creative.colors.desc": "Попробуйте блоки других цветов",
  "tutorial.creative.door.title": "Поставьте дверь",
  "tutorial.creative.door.desc": "Поставьте дверь в стене — и сможете входить и выходить",
} satisfies Pick<Messages, keyof typeof zhMinigame>;
