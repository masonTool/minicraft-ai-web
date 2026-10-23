/**
 * 英文文案·物品与方块名（`item.*`）
 *
 * 与 `locales/zh/item.ts` 键集必须相同（`satisfies` 卡住）。
 * 模板里的语序按英文给：`{color} Wool`；德语会是 `{color} Wolle`，俄语还要变格 ——
 * 这正是"模板放表里、拼接留代码里"的理由。
 */

import type { Messages } from '../zh/index.ts';
import type { item as zhItem } from '../zh/item.ts';

export const item = {
  // ---- 颜色（16 种染料色，凡"颜色 + 名词"的族都从这里取）
  "item.color.white": "White",
  "item.color.orange": "Orange",
  "item.color.magenta": "Magenta",
  "item.color.light_blue": "Light Blue",
  "item.color.yellow": "Yellow",
  "item.color.lime": "Lime",
  "item.color.pink": "Pink",
  "item.color.gray": "Gray",
  "item.color.light_gray": "Light Gray",
  "item.color.cyan": "Cyan",
  "item.color.purple": "Purple",
  "item.color.blue": "Blue",
  "item.color.brown": "Brown",
  "item.color.green": "Green",
  "item.color.red": "Red",
  "item.color.black": "Black",
  // ---- 染料族模板（多语言 P2-1a）：{color} 由 item.color.* 填，语序由模板决定
  "item.dye": "{color} Dye",
  "item.wool": "{color} Wool",
  "item.carpet": "{color} Carpet",
  "item.bed": "{color} Bed",
  "item.terracottaColored": "{color} Terracotta",
  "item.concrete": "{color} Concrete",
  "item.concrete_powder": "{color} Concrete Powder",
  "item.stained_glass": "{color} Stained Glass",
  "item.stained_glass_pane": "{color} Stained Glass Pane",
  "item.shulker_box": "{color} Shulker Box",
  // ---- 染料族的三个"无色"底座
  "item.terracotta": "Terracotta",
  "item.glass": "Glass",
  "item.glass_pane": "Glass Pane",
} satisfies Pick<Messages, keyof typeof zhItem>;
