/**
 * 中文文案·文本编辑类面板（`book.*` / `sign.*` / `template.*` / `buildtools.*`：书与笔 / 告示牌 / 建造模板）
 *
 * ⚠️ 这个文件是**源语言**（多语言 P0-2）：其余语言按同一套键翻译，键由 `index.ts` 的
 * `as const` 推导出 `MessageKey`，所以这里**加一条键**就等于给所有语言加一条待翻译项。
 * 搬运规则：只搬不改——中文一个字都没动，`test:i18n` 的断言一条也没改。
 */

export const editor = {
  'book.noPages': '一页都没写，没法署名',
  'sign.done': '完成',
  // ---- 创造工具（创造1）
  'buildtools.undo.creativeOnly': '只有创造模式能撤销',
  'buildtools.undo.onlineOnly': '联机时不能撤销',
  'buildtools.undo.empty': '没有可以撤销的操作',
  'buildtools.redo.empty': '没有可以重做的操作',
  'buildtools.select.first': '已选第一个角，再点一个角',
  'buildtools.select.done': '选区共 {volume} 格',
  'buildtools.select.tooLarge': '选区太大（最多 32768 格）',
  'buildtools.select.outOfWorld': '选区不在世界内',
  'buildtools.fill.noSelection': '先点两个角框选一块区域',
  'buildtools.fill.done': '已填 {count} 格',
  'buildtools.fill.cancelled': '填充已取消',
  'buildtools.copy.done': '已复制 {count} 格',
  'buildtools.copy.none': '还没有复制任何东西',
  'buildtools.copy.empty': '选区里没有方块',
  'buildtools.paste.done': '已粘贴 {count} 格',
  'buildtools.paste.cancelled': '粘贴已取消',
  'buildtools.paste.outOfWorld': '粘贴位置超出世界',
  // ---- 建筑模板（创造4）
  'template.smallHouse': '小屋',
  'template.bridge': '小桥',
  'template.tree': '大树',
  'template.tower': '石塔',
  'buildtools.template.blocked': '这里放不下，有方块挡着',
  'buildtools.template.unsupported': '下面没有支撑，放不了',
  'buildtools.template.outOfWorld': '超出世界范围',
  'buildtools.template.placed': '正在放置：{name}',
  // ---- 建造工具条（创造5）
  'buildtools.toggle': '建造模式',
  'buildtools.tool.select': '选区',
  'buildtools.tool.fill': '填充',
  'buildtools.tool.copy': '复制',
  'buildtools.tool.paste': '粘贴',
  'buildtools.tool.mirror': '镜像粘贴',
  'buildtools.tool.undo': '撤销',
  'buildtools.tool.redo': '重做',
  'buildtools.tool.template': '建筑模板',
  'buildtools.tool.selectHint': '点一个方块，选第一个角',
  'buildtools.fill.noBlock': '先拿一块方块',
} as const;
