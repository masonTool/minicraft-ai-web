/**
 * 中文文案·其余全局文案（`pause.*` / `death.*` / `sleep.*` / `fullscreen.*` / `install.*` / `unit.*`）
 *
 * ⚠️ 这个文件是**源语言**（多语言 P0-2）：其余语言按同一套键翻译，键由 `index.ts` 的
 * `as const` 推导出 `MessageKey`，所以这里**加一条键**就等于给所有语言加一条待翻译项。
 * 搬运规则：只搬不改——中文一个字都没动，`test:i18n` 的断言一条也没改。
 */

export const misc = {
  // ---- 暂停菜单
  'pause.title': '游戏已暂停',
  'pause.resume': '继续游戏',
  'pause.settings': '设置',
  'pause.achievements': '成就',
  'pause.statistics': '统计',
  'pause.exit': '保存并退出到主菜单',
  'unit.item': '个',
  'unit.bottle': '瓶',
  'fullscreen.rotateTitle': '请横屏游玩',
  'fullscreen.rotateDetail': '点一下进入全屏并横屏 · 把手机横过来也会自动开始',
  'fullscreen.rotateIosDetail': '把手机横过来即可；想要全屏请用「分享 → 添加到主屏幕」',
  'install.hint': '添加到主屏幕后，打开即全屏横屏',
  'install.add': '添加',
  'install.later': '以后',
  'install.iosHint': 'Safari 不能把网页直接全屏：点「分享」→「添加到主屏幕」，再从桌面图标打开即可全屏横屏。',
  'install.iosOk': '知道了',
  'death.title': '你死了！',
  'death.respawning': '正在重生…',
  'sleep.dawn': '天快亮了',
  'sleep.hint': '跳跃键可以提前起床',
  'sleep.lieDown': '你躺下了…（跳跃键 / 点击遮罩可以提前起床）',
  "touch.sneak": "潜行",
  "touch.flyUp": "向上飞",
  "touch.flyDown": "向下飞",
  "touch.hint": "摇杆走 · 双击摇杆潜行 · 拖动看 · 轻点放 · 按住挖/用 · 双击跳起飞（飞时出升降键）",
  "touch.icon.jump": "跳跃",
  "touch.icon.sneak": "潜行",
  "touch.icon.inventory": "背包",
  "touch.icon.chat": "聊天与命令",
  "touch.icon.pause": "暂停与设置",
  "touch.icon.view": "切换视角",
  "tooltip.unstackable": "不可堆叠",
  "tooltip.maxStack": "最多 {n} 个/格",
  "loading.world": "正在生成世界…",
  "loading.failed": "加载失败，请刷新页面重试",
  "unsupported.title": "这台设备暂时打不开这个游戏",
  "unsupported.reload": "刷新页面",
  "unsupported.code": "诊断码：{code}",

  // ---- 时间文案（多语言 P3-4）：相对时间交给 Intl，时长走模板
  "time.lastPlayed": "上次游玩 {when} · 已玩 {played}",
  "time.underMinute": "不到 1 分钟",
  "time.minutes": "{n} 分钟",
  "time.hoursMinutes": "{h} 小时 {m} 分",
  "time.minutesSeconds": "{m} 分 {s} 秒",
  "time.seconds": "{n} 秒",
  "loading.boot": "加载中…",
  "loading.bootSub": "正在准备材质与存档",
} as const;
