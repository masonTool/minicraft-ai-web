/**
 * 俄语文案·misc（与 `locales/zh/misc.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-2：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { misc as zhMisc } from '../zh/misc.ts';

export const misc = {
  "pause.title": "Игра приостановлена",
  "pause.resume": "Продолжить",
  "pause.settings": "Настройки",
  "pause.achievements": "Достижения",
  "pause.statistics": "Статистика",
  "pause.exit": "Сохранить и выйти в меню",
  "unit.item": "шт.",
  "unit.bottle": "фл.",
  "fullscreen.rotateTitle": "Играйте в горизонтальной ориентации",
  "fullscreen.rotateDetail": "Нажмите, чтобы перейти в полноэкранный режим · поворот телефона тоже запускает игру",
  "fullscreen.rotateIosDetail": "Просто поверните телефон; для полного экрана — «Поделиться → На экран «Домой»»",
  "install.hint": "Добавьте на экран «Домой» — и игра откроется на весь экран горизонтально",
  "install.add": "Добавить",
  "install.later": "Позже",
  "install.iosHint": "Safari не умеет открывать страницы в полном экране: «Поделиться» → «На экран «Домой»», затем запускайте с иконки.",
  "install.iosOk": "Понятно",
  "death.title": "Вы погибли!",
  "death.respawning": "Возрождение…",
  "sleep.dawn": "Скоро рассвет",
  "sleep.hint": "Клавиша прыжка разбудит раньше",
  "sleep.lieDown": "Вы легли… (прыжок или нажатие на затемнение разбудят вас)",
  "touch.sneak": "Красться",
  "touch.flyUp": "Вверх",
  "touch.flyDown": "Вниз",
  "touch.hint": "Стик — идти · двойное нажатие — красться · провести — осмотреться · короткое — поставить · удержание — сломать/использовать · двойной прыжок — полёт (появятся кнопки вверх/вниз)",
  "touch.icon.jump": "Прыжок",
  "touch.icon.sneak": "Красться",
  "touch.icon.inventory": "Инвентарь",
  "touch.icon.chat": "Чат и команды",
  "touch.icon.pause": "Пауза и настройки",
  "touch.icon.view": "Сменить вид",
  "tooltip.unstackable": "Не складывается",
  "tooltip.maxStack": "До {n} в слоте",
  "loading.world": "Мир создаётся…",
  "loading.failed": "Не удалось загрузить — обновите страницу",
  "unsupported.title": "На этом устройстве игра пока не открывается",
  "unsupported.reload": "Обновить страницу",
  "unsupported.code": "Код диагностики: {code}",
  "time.lastPlayed": "Последний раз {when} · Сыграно {played}",
  "time.underMinute": "Меньше минуты",
  "time.minutes": "{n} мин",
  "time.hoursMinutes": "{h} ч {m} мин",
  "time.minutesSeconds": "{m} мин {s} с",
  "time.seconds": "{n} с",
  "loading.boot": "Загрузка…",
  "loading.bootSub": "Подготовка текстур и сохранения",
} satisfies Pick<Messages, keyof typeof zhMisc>;
