/**
 * 中文文案·文本编辑类面板（`book.*` / `sign.*` / `nameTag.*` / `commandBlock.*`：书与笔 / 告示牌 / 命名 / 命令方块）
 *
 * ⚠️ 这个文件是**源语言**（多语言 P0-2）：其余语言按同一套键翻译，键由 `index.ts` 的
 * `as const` 推导出 `MessageKey`，所以这里**加一条键**就等于给所有语言加一条待翻译项。
 * 搬运规则：只搬不改——中文一个字都没动，`test:i18n` 的断言一条也没改。
 */

export const editor = {
  'book.noPages': '一页都没写，没法署名',
  'sign.done': '完成',

  // ---- 四个编辑器面板的框架文案（多语言 P3-2）
  "editor.ok": "确定",
  "editor.cancel": "取消",
  "editor.done": "完成",
  "editor.close": "关闭",
  "editor.back": "返回",
  "editor.sign": "署名",
  "book.writePlaceholder": "在这一页写点什么…",
  "book.titlePlaceholder": "书名",
  "book.writingTitle": "书与笔",
  "book.emptyPage": "（这一页什么也没写）",
  "book.pageOf": "第 {current} / {total} 页",
  "sign.linePlaceholder": "第 {n} 行",
  "sign.hint": "每行最多 {n} 字 · 全部留空＝擦掉牌子上的字",
  "nameTag.placeholder": "给它起个名字",
  "nameTag.hint": "最多 {n} 个字 · 留空则不修改",
  "commandBlock.title": "命令方块",
} as const;
