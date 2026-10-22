/**
 * 中文文案·成就、统计与地图（`advancement.*` / `statistics.*` / `map.*`）
 *
 * ⚠️ 这个文件是**源语言**（多语言 P0-2）：其余语言按同一套键翻译，键由 `index.ts` 的
 * `as const` 推导出 `MessageKey`，所以这里**加一条键**就等于给所有语言加一条待翻译项。
 * 搬运规则：只搬不改——中文一个字都没动，`test:i18n` 的断言一条也没改。
 */

export const progress = {
  'statistics.title': '世界统计',
  'statistics.playTime': '游玩时间',
  'statistics.blocksMined': '挖掉的方块',
  'statistics.blocksPlaced': '放下的方块',
  'statistics.mobsKilled': '击杀生物',
  'statistics.deaths': '死亡次数',
  'statistics.distance': '移动距离',
  // ---- 小面板（批次 427）
  'advancement.title': '成就',
  'advancement.empty': '这一支还没有条目',
  'map.close': '关闭',
  'map.title': '地图',
  'map.locked': ' · 已锁定',
  'advancement.close': '关闭',
  'advancement.closeLabel': '关闭成就',
  'advancement.filterAll': '全部',
  'advancement.lockedHint': '达成前面的条目才会看到它',
  'advancement.earned': '已达成',
  'advancement.summary': '已达成 {earned} / {total}',
  'advancement.challengeDone': '挑战完成',
  'advancement.locked': '未解锁',
  'advancement.challenge': '挑战',
  'advancement.available': '可达成',
  'advancement.toastDone': '进度已达成！',
  'advancement.toastChallenge': '挑战完成！',
} as const;
