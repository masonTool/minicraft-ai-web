# 决策记录 · 会话 0a9f50455e4c4bc9beab90e5c768d9b8

## D1 · PC 按钮层做成独立模块，而不是把 `TouchControls` 改成两端共用
- 决定：新增 `src/ui/PcControls.ts`，只复用手机那套 `.touch-button` 样式与 `TouchIcons` 图标。
- 为什么：`TouchControls` 里每一个字段都围着多指手势转（摇杆、视角面、白圈、死区、坐标异常恢复），
  鼠标+指针锁一条都用不上；混进去之后每次手势修复都要先判断"这是不是鼠标"，两条输入路径迟早互相污染。
  按钮视觉是**类级**选择器，复用不需要抄样式。
- 影响：桌面端多一层 `#pc-ui` DOM（仅非触摸设备创建，`dispose()` 里随 App 一起拆）；
  想退回"PC 上只有准星"只需不再创建这个模块。

## D2 · 键帽文案不走翻译表，只有"疾跑/飞行"两个动作名走 i18n
- 决定：`Esc` / `Space` / `Shift` / `Ctrl` / `WASD` 用常量直出（`PC_KEY_HINTS`），
  新增两条文案键 `pc.sprint` / `pc.fly` 给动作名。
- 为什么：`settings.helpDesktop` 在六种语言里键名本来就是原样保留的；把 "Space" 翻成"空格"之后
  玩家反而要先猜这是哪个键。动作名则需要翻译（六语言各补一条）。
- 影响：新增两条 i18n 键（六语言齐），没有改动既有键；键帽文字不会随语言变化，这是刻意的。

## D3 · PC 的"全屏"只收口在 manifest：桌面装成 App 时不再全屏
- 决定：`tools/gen-manifests.mjs` 额外生成六份桌面变体（`display_override` 只留 `standalone`、
  不写 `orientation`），运行时按设备切换 `<link rel="manifest">`。
- 为什么：代码侧 `enterFullscreen()` / `enterMobilePresentation()` 早就用 `isCoarsePointer()` 挡住了自动全屏，
  普通标签页里 PC 根本不会全屏；剩下的唯一入口是"桌面上把网页装成 App"——Chrome 桌面端会照
  `display_override: ["fullscreen"]` 直接全屏启动，代码拦不住（PWA 的显示模式不是 Fullscreen API，
  `exitFullscreen()` 对它无效）。手机那份 manifest 一个字不动，避免"装完打开不是全屏"的回归。
- 影响：手机上仍是原来的 fullscreen 启动；桌面上装成 App 变成普通窗口（浏览器标签页行为不变）。
  撤回方法：删掉桌面变体文件并去掉运行时切换，回到原来六份 manifest。
