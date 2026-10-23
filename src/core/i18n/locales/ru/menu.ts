/**
 * 俄语文案·menu（与 `locales/zh/menu.ts` **键集必须相同**）
 *
 * ⚠️ 多语言 P4-2：`satisfies Pick<Messages, keyof typeof zhXxx>` 把键集卡在 `typecheck`，
 * 中文加一条、这边没跟上就编译不过。
 */

import type { Messages } from '../zh/index.ts';
import type { menu as zhMenu } from '../zh/menu.ts';

export const menu = {
  "menu.tagline": "Оригинальное выживание, творчество и сохранения миров",
  "menu.play": "Играть",
  "menu.settings": "Настройки",
  "menu.footer": "Неофициальный веб-ремейк · сохранения остаются на этом устройстве",
  "menu.newWorld": "+ Новый мир",
  "menu.empty": "Миров пока нет — нажмите сверху «+ Новый мир».",
  "menu.back": "‹ Назад",
  "menu.cancel": "Отмена",
  "menu.reroll": "Случайно",
  "menu.create": "Создать и войти",
  "world.list": "Мир",
  "world.name": "Название мира",
  "world.seed": "Сид мира",
  "world.type": "Тип мира",
  "world.biome": "Биом",
  "world.difficulty": "Сложность",
  "world.gameMode": "Режим игры",
  "world.hardcore": "Хардкор",
  "world.hardcoreOff": "Обычный",
  "world.hardcoreOn": "Хардкор",
  "world.namePlaceholder": "Пусто — имя создастся само",
  "world.seedPlaceholder": "Пусто = случайно",
  "world.hint": "Один и тот же сид даёт одинаковый рельеф; у суперплоского мира только один слой травы.",
  "world.createTitle": "Создание нового мира",
  "world.enter": "Войти",
  "world.edit": "Изменить",
  "world.editTitle": "Изменение мира",
  "world.save": "Сохранить",
  "world.editHint": "Режим и сложность применятся при следующем входе в мир.",
  "world.delete": "Удалить",
  "world.export": "Экспорт",
  "world.import": "Импорт сохранения",
  "menu.minigames": "Мини-игры",
} satisfies Pick<Messages, keyof typeof zhMenu>;
