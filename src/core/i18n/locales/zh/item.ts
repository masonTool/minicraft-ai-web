/**
 * 中文文案·物品与方块名（`item.*`，多语言 P2 数据层）
 *
 * ⚠️ 这一族是**构件 + 模板**，不是 800 条平铺的名字：
 * 物品名几乎都是"颜色 + 名词"或"材质 + 名词"拼出来的（`白色羊毛` / `橡木木板` / `铁镐`），
 * 平铺成 800 条会让 6 种语言各写 800 条，而德语/俄语的语序与变格根本套不进去。
 * 所以表里放**构件**（`item.color.white`）与**模板**（`item.wool` = `{color}羊毛`），
 * 由 `itemNames.ts` 在取值时拼装。
 */

export const item = {
  // ---- 颜色（16 种染料色，凡"颜色 + 名词"的族都从这里取）
  "item.color.white": "白色",
  "item.color.orange": "橙色",
  "item.color.magenta": "品红色",
  "item.color.light_blue": "淡蓝色",
  "item.color.yellow": "黄色",
  "item.color.lime": "黄绿色",
  "item.color.pink": "粉红色",
  "item.color.gray": "灰色",
  "item.color.light_gray": "淡灰色",
  "item.color.cyan": "青色",
  "item.color.purple": "紫色",
  "item.color.blue": "蓝色",
  "item.color.brown": "棕色",
  "item.color.green": "绿色",
  "item.color.red": "红色",
  "item.color.black": "黑色",
  // ---- 染料族模板（多语言 P2-1a）：{color} 由 item.color.* 填，语序由模板决定
  "item.dye": "{color}染料",
  "item.wool": "{color}羊毛",
  "item.carpet": "{color}地毯",
  "item.bed": "{color}床",
  "item.terracottaColored": "{color}陶瓦",
  "item.concrete": "{color}混凝土",
  "item.concrete_powder": "{color}混凝土粉末",
  "item.stained_glass": "{color}染色玻璃",
  "item.stained_glass_pane": "{color}染色玻璃板",
  "item.shulker_box": "{color}潜影盒",
  // ---- 染料族的三个"无色"底座
  "item.terracotta": "陶瓦",
  "item.glass": "玻璃",
  "item.glass_pane": "玻璃板",
} as const;
