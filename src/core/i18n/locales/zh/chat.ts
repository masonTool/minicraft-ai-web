/**
 * 中文文案·聊天与命令界面（`chat.*` / `command.*`）
 *
 * ⚠️ 这个文件是**源语言**（多语言 P0-2）：其余语言按同一套键翻译，键由 `index.ts` 的
 * `as const` 推导出 `MessageKey`，所以这里**加一条键**就等于给所有语言加一条待翻译项。
 * 搬运规则：只搬不改——中文一个字都没动，`test:i18n` 的断言一条也没改。
 */

export const chat = {
  // ---- 其余小界面（批次 434）：聊天 / 横屏提示 / 安装提示 / 地图 / 配方书 / 牌子
  'chat.send': '发送',
  'command.usagePrefix': '用法：',
  'command.unknown': '未知的命令：/{name}（输入 /help 查看全部）',
  'command.unknownHelp': '未知的命令：{name}',
  'command.creativeOnly': '/{name} 只能在创造模式下使用',
  'command.empty': '请输入命令，例如 /help',
  'command.failed': '命令执行出错：{message}',
  'command.listTitle': '可用命令（{count} 条）：',
  'chat.sendLabel': '发送',
  'chat.collapse': '点击收起',
  'chat.expandBadge': '展开',
  'chat.expand': '点击展开',
  'chat.hintIdle': '输入命令（/help 查看全部）或直接发言，点"发送"提交',
  'chat.hintIdleKeyboard': '输入命令（/help 查看全部）或直接发言，Enter 提交，Esc 取消',
  'chat.hintCommand': '点"发送"提交（手机上没有 Tab 补全，参数要打全）',
  'chat.hintCommandKeyboard': 'Tab 补全参数 · Enter 提交 · ↑↓ 翻历史',
  'chat.candidates': '候选：{list}{suffix}',
  'chat.tabComplete': '（Tab 补全）',
  'chat.noCommandMatch': '没有匹配的命令，输入 /help 查看全部',
} as const;
