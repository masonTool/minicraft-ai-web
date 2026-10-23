/**
 * 中文文案·设置页（`settings.*`：分组名、每一行、档位标签、外观预览）
 *
 * ⚠️ 这个文件是**源语言**（多语言 P0-2）：其余语言按同一套键翻译，键由 `index.ts` 的
 * `as const` 推导出 `MessageKey`，所以这里**加一条键**就等于给所有语言加一条待翻译项。
 * 搬运规则：只搬不改——中文一个字都没动，`test:i18n` 的断言一条也没改。
 */

export const settings = {
  // ---- 设置页
  'settings.title': '设置',
  'settings.back': '返回',
  'settings.group.game': '游戏',
  'settings.group.controls': '控制',
  'settings.group.appearance': '外观',
  'settings.group.sound': '音频',
  'settings.language': '界面语言',
  // 多语言 P0-5：下拉里的"跟随系统"——括号里写出它当前解析成了哪种语言，
  // 否则玩家不知道"跟随系统"在**这台设备**上到底等于什么
  'settings.language.autoWith': '跟随系统（{language}）',
  // ---- 设置行（"游戏"组那几行：进世界后最常改的）
  'settings.row.daylightCycle': '昼夜循环',
  'settings.row.showDebug': '调试信息',
  'settings.row.flying': '飞行',
  'settings.row.gameMode': '游戏模式',
  // ---- 设置行（"控制"组：视角、手感与触屏按钮）
  'settings.row.cameraMode': '视角',
  'settings.row.handedness': '惯用手',
  'settings.row.aimMode': '瞄准',
  'settings.row.touchStick': '摇杆',
  'settings.row.invertY': '反转视角',
  'settings.row.autoJump': '自动跳跃',
  'settings.row.fastEat': '快速进食',
  'settings.row.fov': '视野',
  'settings.row.touchScale': '按钮大小',
  'settings.row.sensitivity': '灵敏度',
  // ---- 设置行（"音频"组 + 外观里的两个视角按钮）
  'settings.row.volume': '主音量',
  'settings.row.volumeBlocks': '方块音效',
  'settings.row.volumeMobs': '生物音效',
  'settings.row.volumePlayer': '玩家音效',
  'settings.row.volumeUi': '界面音效',
  'settings.row.volumeAmbient': '雨声',
  'settings.row.volumeMusic': '音乐',
  'settings.avatar.full': '全身',
  'settings.avatar.face': '面部',
  // ---- 设置界面的残留文案（批次 1355 / T5）：外观页、帮助行、诊断日志、资源包、底部按钮
  'settings.backArrow': '‹ 返回',
  'settings.backLayer': '返回上一层',
  'settings.hintApplies': '改动立即生效',
  'settings.escResume': '按 Esc 继续游戏',
  'settings.touchBack': '点「{label}」或系统返回键返回',
  'settings.groupUndefined': '未定义的分组：{group}',
  'settings.helpDesktop':
    '<kbd>WASD</kbd> 移动 · <kbd>Space</kbd> 跳跃 · <kbd>Shift</kbd> 潜行/下降 · <kbd>Ctrl</kbd> 疾跑<br /><kbd>左键</kbd> 破坏 · <kbd>右键</kbd> 放置 · <kbd>1-9</kbd> 换方块 · <kbd>F</kbd> 飞行 · <kbd>V</kbd> 视角 · <kbd>Esc/E</kbd> 菜单与背包',
  'settings.helpTouch':
    '左摇杆移动 · 拖动转视角 · 轻点放置 · 长按破坏<br />右下角是跳跃与潜行 · 背包在快捷栏右边、聊天在顶部<br />双击跳跃起飞（创造模式）· 视角与飞行在「设置」里',
  'settings.reset': '恢复默认设置',
  'settings.resetDone': '已恢复默认设置',
  'settings.row.brightness': '亮度',
  'settings.row.hairStyle': '发型',
  'settings.row.hairColor': '发色',
  'settings.row.beard': '胡须',
  'settings.row.eyes': '眼型',
  'settings.row.eyeColor': '瞳色',
  'settings.row.build': '年龄',
  'settings.row.frame': '身架',
  'settings.row.skinTone': '肤色',
  'settings.row.shirtColor': '上衣',
  'settings.row.pantsColor': '裤子',
  'settings.row.cape': '披风',
  'settings.appearance.title': '角色形象',
  'settings.appearance.preview': '角色形象预览（可拖动旋转）',
  'settings.appearance.dragTip': '拖动旋转',
  'settings.appearance.edit': '编辑',
  'settings.appearance.close': '关闭角色形象',
  'settings.diagnostics': '日志',
  'settings.export': '导出',
  'settings.exportTitle': '下载 JSON（最近两次会话，最多 500KB）',
  'settings.exported': '已导出',
  'settings.exportFailed': '导出失败',
  'settings.exportMarked': ' · 已打点',
  'settings.exportStats': '{events} 条 · {kb}KB{marked}',
  'settings.resourcePack': '资源包',
  'settings.import': '导入',
  'settings.importTitle': '选择 .mcpack / .zip 资源包',
  'settings.notChosen': '未选择',
  // ---- 档位标签（这五组原来是导出给断言看的常量表，现在改成查表函数）
  'settings.opt.unlimited': '不限',
  'settings.opt.fps30': '30 帧',
  'settings.opt.fps60': '60 帧',
  'settings.opt.off': '关闭',
  'settings.opt.reduced': '减少',
  'settings.opt.all': '全部',
  'settings.opt.finger': '手指',
  'settings.opt.center': '屏幕中心',
  'settings.opt.sec30': '30 秒',
  'settings.opt.sec60': '60 秒',
  'settings.opt.sec120': '120 秒',
  "settings.cameraMode.first": "第一人称",
  "settings.cameraMode.thirdBack": "第三人称（背后）",
  "settings.cameraMode.thirdFront": "第三人称（正面）"
} as const;
