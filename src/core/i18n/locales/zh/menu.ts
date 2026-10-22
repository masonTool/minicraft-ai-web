/**
 * 中文文案·主菜单与世界列表（`menu.*` / `world.*`）
 *
 * ⚠️ 这个文件是**源语言**（多语言 P0-2）：其余语言按同一套键翻译，键由 `index.ts` 的
 * `as const` 推导出 `MessageKey`，所以这里**加一条键**就等于给所有语言加一条待翻译项。
 * 搬运规则：只搬不改——中文一个字都没动，`test:i18n` 的断言一条也没改。
 */

export const menu = {
  // ---- 主菜单（M8：启动时构建，切语言后要刷新页面才全变，见 TASKS M8 的注记）
  'menu.tagline': '原生生存、创造与多世界存档',
  'menu.play': '游戏',
  'menu.settings': '设置',
  'menu.footer': '非官方 Web 复刻 · 存档保存在此设备',
  'menu.newWorld': '＋ 新建世界',
  'menu.empty': '还没有存档——点上面「＋ 新建世界」开一个。',
  'menu.back': '‹ 返回',
  'menu.cancel': '取消',
  'menu.reroll': '随机',
  'menu.create': '创建并进入',
  // ---- 世界列表与新建表单
  'world.list': '世界',
  'world.name': '世界名称',
  'world.seed': '世界种子',
  'world.type': '世界类型',
  'world.biome': '群系',
  'world.difficulty': '难度',
  'world.gameMode': '游戏模式',
  'world.hardcore': '极限模式',
  'world.hardcoreOff': '普通',
  'world.hardcoreOn': '极限',
  'world.namePlaceholder': '留空则自动命名',
  'world.seedPlaceholder': '留空 = 随机',
  'world.hint': '相同的种子会生成相同的地形；超平坦世界只有一层草地。',
  'world.createTitle': '创建新世界',
  'world.enter': '进入',
  'world.edit': '编辑',
  'world.editTitle': '编辑世界',
  'world.save': '保存',
  'world.editHint': '模式与难度会在下次进入世界时生效。',
  'world.delete': '删除',
  'world.export': '导出',
  'world.import': '导入存档',
  // ---- 小游戏选择页（小游戏3）
  'menu.minigames': '小游戏',
} as const;
