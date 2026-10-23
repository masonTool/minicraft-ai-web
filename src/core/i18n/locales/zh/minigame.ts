/**
 * 中文文案·小游戏与新手引导（`minigame.*` / `tutorial.*`）
 *
 * ⚠️ 这个文件是**源语言**（多语言 P0-2）：其余语言按同一套键翻译，键由 `index.ts` 的
 * `as const` 推导出 `MessageKey`，所以这里**加一条键**就等于给所有语言加一条待翻译项。
 * 搬运规则：只搬不改——中文一个字都没动，`test:i18n` 的断言一条也没改。
 */

export const minigame = {
  // ---- 新手引导（引导2，批次 20261022-1954）
  'tutorial.progress': '第 {current} 步 / 共 {total} 步',
  'tutorial.collapse': '收起',
  'tutorial.expand': '展开',
  'tutorial.dismiss': '不再提示',
  'tutorial.finish': '新手引导完成！去自由建造吧',
  // ---- 单机小游戏（小游戏1）
  'minigame.exit': '退出',
  'minigame.crashed': '小游戏出错了，已退出',
  'minigame.smoke.title': '框架自检',
  'minigame.smoke.hint': '点一下切换状态（框架自检用）',
  'minigame.smoke.won': '过关！',
  'minigame.smoke.playing': '继续',
  'minigame.menu.title': '小游戏',
  'minigame.menu.back': '‹ 返回',
  'minigame.menu.best': '最高 {best}',
  // ---- 跳一跳（J0，批次 20261022-2220）
  'minigame.jump.title': '跳一跳',
  'minigame.jump.desc': '按住蓄力，松手起跳',
  'minigame.jump.hint': '按住蓄力，松手起跳',
  'minigame.jump.best': '最高 {best}',
  'minigame.jump.over': '本局 {score} 分',
  'minigame.jump.retry': '再来一局',
  'minigame.jump.record': '新记录！',
  'tutorial.survival.log.title': '先去砍一棵树',
  'tutorial.survival.log.desc': '走近树干，按住左键（或手指）把它挖掉',
  'tutorial.survival.table.title': '做一个工作台',
  'tutorial.survival.table.desc': '背包里用 4 块木板合成',
  'tutorial.survival.woodPickaxe.title': '做一把木镐',
  'tutorial.survival.woodPickaxe.desc': '3 块木板 + 2 根木棍',
  'tutorial.survival.stonePickaxe.title': '挖石头，换石镐',
  // 最后一步（2026-10-22 用户：生存做到石镐就够）——顺手说清"石头在哪"，
  // 免得新手在地表转圈：地下 5 格往下挖就是石头层
  'tutorial.survival.stonePickaxe.desc': '用木镐挖圆石，再合一把石镐（往下挖几格就是石头）',
  'tutorial.creative.place10.title': '先放 10 个方块',
  'tutorial.creative.place10.desc': '从下方物品栏选一块，点地面放下',
  'tutorial.creative.layers.title': '往上搭 3 层',
  'tutorial.creative.layers.desc': '把方块叠高一点，看看能搭多高',
  'tutorial.creative.colors.title': '换 3 种颜色',
  'tutorial.creative.colors.desc': '试试不同颜色的方块',
  'tutorial.creative.door.title': '装一扇门',
  'tutorial.creative.door.desc': '找一扇门放在墙上，就能进出了',
} as const;
