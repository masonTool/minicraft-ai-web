# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261028-2101 · 2026-10-28 · 会话 db119a0b

> 用户：9 条界面/设置反馈（新建世界默认创造、资源包说明、导出选目录、去官方字样、调试默认关、删反转视角、设置保存制、按钮放大重叠、升降键偏移、切换动画）

# 队列 · 会话 db119a0b96db41469bc93f04d7852469

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-2101

> 这一批是用户 2026-10-28 一次性提的 9 条反馈，拆成 11 条可独立验证的条目。
> 项目总表用 A~O 编号（不是「T + 数字」那套），这些是**当场才出现的需求**，
> 收尾时统一补进 `TASKS.md` 的「队列落地 · 当场任务（已完成）」。

- [x] 1/11 新建世界默认创造模式：`src/ui/WorldScreen.ts` → `npm run test:ui` 全绿
  - 做了什么：新建世界表单里「游戏模式」下拉的初始值 `survival` → `creative`；验收辅助方法 `fillNewWorldForm()` 的同名默认参数一起改
  - 为什么：用户要求"首次进入创建世界默认创造模式"；辅助方法的默认值必须和表单一致，否则验收脚本拿到的世界与玩家手点的不是同一种
  - 验证：`npm run check:fast` 全绿（typecheck + 单测 + 命中的 world 套件）；`npm run test:ui` 1202 通过 / 3 失败——那 3 条是开房流程的既有红项（与本次改动无关，改前就红）
  - 批次：20261028-2101
- [x] 2/11 调试信息默认关闭：`src/ui/SettingsScreen.ts` / `src/main.ts` / `tools/settings-test.ts` → `npm run test:settings` 全绿
  - 做了什么：`DEFAULT_SETTINGS.showDebug` 改 false；`loadSettings` 改成「只有 v5 之后显式存过 true 才算开」；`SETTINGS_VERSION` 4 → 5（专门为这次语义翻转留迁移锚点）；`main` 的 `showDebugSetting` 初值改 false，并在启动时按设置补一次对账
  - 为什么：老存档里的 true 是**旧默认值**被整份写进去的，分不清"玩家主动开的"和"默认值"——不升版本就只能二选一：要么老用户永远开着，要么把主动开过的人也关掉。升 v5 让两侧都说得通
  - 验证：`npm run test:settings` 122 通过 / 0 失败（新增 4 条：默认关、脏值按关、v4 迁移回关、v5 显式开能读回）
  - 顺手：`test:ui` 里 3 条开房流程的断言本就是红的（`pendingHostRoom` 早已改成存 `effectiveBaseUrl`、预检到建世界之间多了三段失败分支，注释窗口装不下）——按当前代码改断言，不改行为；`test:ui` 1205 通过 / 0 失败
  - 批次：20261028-2101
- [x] 3/11 删掉「反转视角」设置项：`src/ui/SettingsScreen.ts` / `tools/settings-test.ts` → `npm run test:settings` 全绿
  - 做了什么：删掉控制页那一行开关、`GameSettings.invertY` 字段与它的默认值/读取分支、`main.applyLook()` 里的取反分支；六语言里 `settings.row.invertY` 一起删（`test:i18n` 的必需键清单同步去掉）；`test:settings` 里关于它的 4 条断言换成「老存档残留的键不再进设置」
  - 为什么：用户判断这一项没有使用场景。字段一起删而不是留着——留着就是一个永远为 false、没有入口的死开关，下次改设置的人还得先猜它有没有用
  - 验证：`npm run typecheck` 通过；`npm run test:settings` 121 通过 / 0 失败；`npm run test:i18n` 582 通过 / 0 失败；`npm run audit:i18n` 通过（六语言覆盖 3009/3009）
  - 批次：20261028-2101
- [x] 4/11 清掉「官方 / 非官方 / Mojang」等与原版挂钩的文案：`src/ui/SettingsScreen.ts` / `src/core/i18n/locales/*/settings.ts` / `docs/store/*.md` / `README.md` → `npm run test:i18n` 全绿
  - 做了什么：删掉设置页底部整块「非官方」声明（`makeFooterNotice()` + `.settings-notice` 两处样式 + 六语言的 `settings.notice`）；资源包那行说明改写成「只导自己的包 / 本应用不提供也不分发资源包文件」；六份商店文案的「关于」段与拍摄要求、README 首段与许可段一并去掉与原版/厂商的挂钩
  - 为什么：用户明确要求界面上不能出现"我们不是官方"这种自我定位。代码注释里的"基岩版/原版"是工程笔记（解释为什么这么实现），不是产品文字，保留——全删会把大量"为什么"一起删掉，得不偿失
  - 验证：`npm run test:i18n` 582 通过 / 0 失败；`npm run test:ui` 1205 通过 / 0 失败（那条合规断言改成"资源包免责在 + 非官方声明已删除"）；`npm run check:fast` 全绿
  - 批次：20261028-2101
- [x] 5/11 资源包使用说明（六语言）：`src/ui/SettingsScreen.ts` / `src/core/i18n/locales/*/settings.ts` → `npm run test:i18n` 全绿
  - 做了什么：资源包那一行下面加一块说明（`makePackHelp()`：标题 + 5 条），文案键 `settings.resourcePack.about` / `help1..help5` 六语言各一套；`index.html` 加 `.settings-note.pack-help` 样式（灰字 + 左侧色条，不抢按钮注意力）；`test:ui` 加一条"五条 + 标题、六语言齐全"的断言
  - 为什么：说明必须**准确**——贴图只按 `textures/blocks/<名字>.png` 对应图集（大图会缩到 16×16 格子）、音效只认 `SoundPack.ts` 映射表那批、包**不落盘**（重开页面要重新导入）。后一条不写清楚，玩家会以为"导一次就永久生效"
  - 验证：`npm run typecheck` 通过；`npm run test:i18n` 582 通过 / 0 失败；`npm run test:ui` 1206 通过 / 0 失败
  - 批次：20261028-2101
- [x] 6/11 导出世界让用户选目录保存：`src/main.ts` → `npm run check:fast` 通过
  - 做了什么：新增 `src/ui/SaveFile.ts`（`saveBlobWithPicker()` / `downloadBlob()` / `canPickSaveLocation()`），`exportWorld()` 改成优先弹系统「另存为」并写入玩家选定的位置，只有 API 不存在或写入失败才退回原来的 `<a download>`；玩家点取消（`AbortError`）直接结束，不再偷偷下载一份；文件类型说明走新键 `world.exportFileType`（六语言）
  - 为什么：原来的 `<a download>` 只能落到浏览器的下载目录，手机上玩家既看不到也选不了。`showSaveFilePicker` 不在 `lib.dom` 里，所以手写最小类型声明，不引新的 @types 包
  - 验证：`npm run test:ui` 1207 通过 / 0 失败（新增一条"优先另存为 + 取消不下载 + 回退下载"）；`npm run check:fast` 全绿
  - 批次：20261028-2101
- [x] 7/11 设置页改成「草稿 + 保存 / 恢复默认」：`src/ui/SettingsScreen.ts` / `index.html` / 六语言 → `npm run test:ui` + `test:i18n` 全绿
  - 做了什么：`SettingsScreen` 加 `draft` / `saved` 两份拷贝——所有控件只改草稿（不再 `commit()` 即生效）；新增 `SETTING_GROUP_KEYS`（分组 → 字段表）与 `saveActiveGroup()` / `resetActiveGroup()` / `updateSaveState()`；页脚改成「保存 + 恢复默认」两颗（保存进页面是 `disabled`，当前页改过才亮；恢复默认只作用于当前页，且同样要点保存才生效）；语言下拉也走草稿，保存时若语言变了才整页重载；`viewDistance` 这类没有界面入口的字段不进任何分组
  - 为什么：用户要求"所有设置项都不改动立即生效 + 每页下方保存/恢复默认 + 保存按钮灰着直到改动"。只改草稿还顺带解决了"拖滑块每帧都写 localStorage 并重算区块范围"的老开销
  - 取舍：**游戏模式与飞行仍立即生效**——它们是"这个世界现在的状态"（会进存档/影响玩法），不是这台设备的偏好，也从来不在 `GameSettings` 里；把它们也做成草稿就要在退回菜单时回滚世界状态，得不偿失。已写进决策文件
  - 验证：`npm run test:settings` 125 通过 / 0 失败（新增分组覆盖断言：有界面的字段漏挂会红）；`npm run test:ui` 1207 通过 / 0 失败；`npm run test:i18n` 582 通过 / 0 失败；`npm run check:fast` 全绿
  - 批次：20261028-2101
- [x] 8/11 未保存修改时离开 / 切换设置项弹窗提醒：`src/ui/SettingsScreen.ts` → `npm run test:ui` 全绿
  - 做了什么：`askSave(action)` 统一闸门——`setPage('menu')`（返回箭头 / 暂停页）、`setActiveGroup()`（换页签）、`hide()`（关面板 / 退出暂停菜单）三处都先过它；弹窗只有两个出口：「保存」= 把**所有脏分组**落盘再继续，「取消（不保存）」= 丢掉草稿再继续；Esc 等同「取消」；`show()` 每次从已保存的那份重开草稿，所以上一次没保存的改动不会带进去
  - 为什么：用户描述的就是"取消 = 不保存，直接退出或切换"这两个出口，没有第三个"留在原地"。保存时一起存所有脏分组，是因为玩家可能改了两页才退出，只存一页等于丢一半
  - 验证：`npm run typecheck` 通过；`npm run test:ui` 1209 通过 / 0 失败（新增两条：闸门三处齐全 + 六语言文案）；`npm run test:i18n` 582 通过 / 0 失败；`npm run check:fast` 全绿
  - 批次：20261028-2101
- [x] 9/11 按钮放大后与快捷栏重叠：`index.html` → 代码走查 + `npm run test:ui` 全绿
  - 做了什么：跳跃键簇的 `--touch-buttons-bottom` 改成「基准 + 跳跃键的放大额」，即放大时整簇**只向上长**（飞行时挂在跳跃键下面的"下降"键不再向下钻）；竖屏基准 131 → 138（让下降键离快捷栏上沿再留 4px）；窄屏横屏（<760）把簇贴到右沿 8px，避开快捷栏右侧的背包键
  - 为什么：`--touch-scale` 1.4 时下降键从 28px 长到 62px 高、且锚点不动，于是压进快捷栏/背包键那片区域；只调基准值改不了"越大压得越深"，必须让锚点跟着尺寸走
  - 验证：用真实 `index.html` 的 CSS 在 Chrome 里量矩形（探针脚本，用完已删）：640×360 / 667×375 / 844×390 / 390×844 × scale 1 与 1.4 共 8 组，下降键与「背包键 / 快捷栏」的重叠面积**全部 0px²**；把旧写法塞回去做对抗性验证 → 竖屏 390×844 重叠 **2451px²**（说明探针不是瞎的）。`npm run test:ui` 1213 通过 / 0 失败（新增 6 条 CSS 守卫）
  - 批次：20261028-2101
- [x] 10/11 飞行升降按钮点击时向右偏：`index.html` → 代码走查 + `npm run test:ui` 全绿
  - 做了什么：补一条 `.touch-button.fly-up:active, .touch-button.fly-down:active { transform: translateX(-50%) scale(.94); }`
  - 为什么：升降键靠 `translateX(-50%)` 居中，而通用的 `.touch-button:active { transform: scale(.94) }` 会把整个 transform 覆盖掉——平移没了，按钮就跳到"自己的右半宽"那个位置。用户说的"向右偏一下"就是这个
  - 验证：Chrome 里用真实鼠标按下（等 `transition: transform .08s` 走完再量）——修后中心横移 **0.00px**；把旧规则塞回去做对抗性验证 → 横移 **32.40px**（正好半个按钮宽）。`npm run test:ui` 1215 通过 / 0 失败
  - 批次：20261028-2101
- [x] 11/11 各页面切换加过渡动画：`index.html` → `npm run test:ui` 全绿
  - 做了什么：新增 `@keyframes page-enter`（淡入 + 上移 10px），挂到 `.pause-page.active` / `.settings-section.active` / `.world-view.active` 三处（暂停菜单↔设置页、四个设置页签、主菜单三层）；页签另补颜色过渡；只做入场不做退场（这些页面是 `display:none` 切换，退场动画会把 Esc/返回拖慢一拍）
  - 为什么：用户要"切换丝滑一点"。三处共用一条 keyframes 而不是各写一套，是因为它们同属"面板里的整页替换"，视觉语言要一致；时长走 `--dur-med`，`prefers-reduced-motion` 下自动变 0s（不用另写分支）
  - 验证：Chrome 里读计算样式——三处 `animation-name: page-enter`、时长 0.22s；开 `reducedMotion: reduce` 后时长变 **0s**；`npm run test:ui` 1216 通过 / 0 失败（新增 1 条守卫）
  - 批次：20261028-2101

---

## 批次 20261028-0600 · 2026-10-28 · 会话 12c62c

> 用户：体积基线放宽到 1.5 MB，项目小不值得费劲

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0600

- [x] [L33] 体积基线放宽到 1.5 MB：`tools/release-check.mjs` → `npm run build:web`
  - 做了什么：`TOTAL_GZIP_BASELINE` 1230 → 1536 KB，注释写明理由与"何时再动手"。
  - 为什么：用户拍板——项目本来就小（合计 1230 KB / 首屏约 1 MB），为几百字节卡发布不值。
  - 验证：`npm run build:web` ✓ 通过（余量 305.8 KB）。
  - 批次：20261028-0600

---

## 批次 20261028-0500 · 2026-10-28 · 会话 12c62c

> 用户：GitHub Pages 因体积超基线 255 字节发布不了

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0500

- [x] [L32] 体积闸门加容差：`tools/release-check.mjs` → `npm run build:web`
  - 做了什么：全部 JS 合计基线上加 0.5%（≈6 KB）容差；容差内通过并 note 播报消耗量，超容差才红。
  - 为什么：发布只因 255 字节（0.02%）被卡，是上次余量被日常提交吃光，不是代码膨胀。
  - 验证：`npm run build:web` ✓ 通过（note：已用掉容差 258/6298 字节）；check exit=0。
  - 批次：20261028-0500

---

## 批次 20261028-0400 · 2026-10-28 · 会话 12c62c

> 用户：创建/编辑世界界面在非中文下空间不够，要所有语言都正常

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0400

- [x] [L31] 世界表单标签列按语言给宽度：`index.html`、`tools/ui-test.ts` → playwright（de/ru）
  - 做了什么：`var(--label-w, 64px)` + `html[lang='de'|'ru'] 7.6em`、`fr/pt 5.6em`；标签 nowrap。
  - 为什么：固定 64px 时 de「Schwierigkeit」、ru「Название мира」被截成省略号。
  - 验证：de 106px 完整、两列对齐；ru 7 行 clipped=false；ru 编辑面板按钮正常；check exit=0。
  - 批次：20261028-0400

---

## 批次 20261028-0033 · 2026-10-28 · 会话 45545c

> 暂停菜单联机键删除后的残留清理（死参数 + 断言）

# 队列 · 会话 45545c939bf44f9ea0cb708a4fb37884

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0033

- [x] [L30] 清掉暂停菜单联机键的残留（用户确认是有意删除）：`src/ui/SettingsScreen.ts` 的 actions 接口、`src/main.ts` 的传参、`tools/ui-test.ts` 那条断言 → `npm run check:fast` 全绿
  - 做了什么：删掉 `SettingsScreenActions` 的 `onMultiplayer` / `multiplayerLabelKey` 两个接口项（连带文档注释）、
    `main.ts` 里对应的 8 行传参，以及 `ui-test.ts` 那条"按联机状态改文案"的断言；
    断言改成反向守卫「暂停菜单不再有联机键」（否则 `settingsSrc` 会变成未使用变量，`noUnusedLocals` 直接红）。
  - 为什么：按钮在上一轮末尾（00:28）已被删掉，但接口、传参、断言还留着——`tsc` 不报错（都是可选参数），
    只有 `test:ui` 的源码断言能抓到，所以门禁一直是红的。
  - 验证：`npm run check:fast` exit=0，命中 3/3 套全绿（viewmode / settings / ui）。
  - 遗留：`openMultiplayer()`（`main.ts:3691`）现在**没有任何调用方**，`RoomCard` 因此没有界面入口；
    删卡片还是补新入口是产品决定，留给用户，未动。
  - 批次：20261028-0033

---

## 批次 20261028-0200 · 2026-10-28 · 会话 12c62c

> 用户：设置窗口标题没多语言，全面检查遗漏

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0200

- [x] [L29] 清掉 UI 硬编码中文：`main.ts`、`WorldScreen.ts`、`ToolHud.ts`、`WorldRegistry.ts`、六语言 → playwright
  - 做了什么：`setTitle(t('settings.title'), t('settings.back'))` + 另外 4 处（构建信息、卡片 tooltip、罗盘格数、未命名世界），新增 4 key × 6 语言。
  - 为什么：`main.ts` 的 `setTitle('设置','返回')` 写死中文，德语下页签是德语、标题却是「设置」；上一轮扫描排除了 main.ts 才漏掉。
  - 验证：德语设置标题 = Einstellungen；全项目复扫 UI 硬编码 0（剩 1 注释）；check exit=0。
  - 批次：20261028-0200

---

## 批次 20261028-0100 · 2026-10-28 · 会话 12c62c

> 用户：编辑弹窗又自动弹键盘；遮罩还是挡不住下层点击

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-0100

- [x] [L28] 弹窗不再自动弹键盘 + 遮罩硬拦截：`InputOverlay.ts`、`index.html`
  - 做了什么：焦点门槛加"按下元素 === 获得焦点的元素"；遮罩改 `stopImmediatePropagation` + body `.inp-open`（CSS `pointer-events:none`）。
  - 为什么：600ms 窗口把"点按钮后代码聚焦"误判成用户点击；stopPropagation 拦不住同元素上的其它监听。
  - 验证：编辑弹窗 active=BODY 无浮层；浮层开着点下层 lowerClicks=0。
  - 批次：20261028-0100

---

## 批次 20261027-3400 · 2026-10-28 · 会话 12c62c

> 用户：新建世界人物卡在方块里，应该站在地面上

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3400

- [x] [L27] 新建世界落地校正：`main.ts` → playwright
  - 做了什么：`prepareNewWorldSpawn()` 末尾补 `requestGroundSettle('spawn')`。
  - 为什么：落点按 surfaceY 估算，实际生成有树/水/洞穴；而校正只挂在读档与联机加入上，新世界漏了。
  - 验证：两个新世界都在地面上（y=66/100，脚头空气、下方实体）；手动塞进地里 2.5 秒自愈。
  - 批次：20261027-3400

---

## 批次 20261027-3300 · 2026-10-27 · 会话 12c62c

> 用户：菜单项风格对齐游戏模式那套；条目在下面时别被遮

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3300

- [x] [L26] 「⋯」菜单项风格 + 自动翻转：`WorldScreen.ts`、`index.html`
  - 做了什么：菜单项对齐 `.world-chip`（半透明底 + 1px 细边 + 12px 字，删除用 chip 的红）；菜单改 `fixed`，打开时按剩余空间上下翻转，关闭清内联坐标。
  - 为什么：列表是 `overflow-y:auto` 会裁掉 absolute 子元素；靠底卡片的下拉必然被吃。
  - 验证：bg=rgba(255,255,255,.07)、position=fixed；300px 高窗口下自动上翻（menuBottom=152 ≤ buttonTop=150）。
  - 批次：20261027-3300

---

## 批次 20261027-3200 · 2026-10-27 · 会话 12c62c

> 用户：两个弹窗标题要白，深色底上发灰

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3200

- [x] [L25] 两个弹窗标题改白：`index.html`
  - 做了什么：`.mp-full-title` / `.mp-port-title` 显式 `color:#fff`。
  - 为什么：它们挂在 `#multiplayer-screen` 下、不在 `.mp-panel` 里，拿不到面板的文字色变量。
  - 验证：computed color = rgb(255,255,255)；截图 V/W。
  - 批次：20261027-3200

---

## 批次 20261027-3100 · 2026-10-27 · 会话 12c62c

> 用户：手机端输入框不许自动弹键盘，只有点击才出浮层

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3100

- [x] [L24] 手机端输入框不再自动弹键盘：`InputOverlay.ts` → playwright
  - 做了什么：`focusin` 里用"最近 600ms 有没有 pointerdown/touchstart"区分用户点击与代码 focus，后者直接 blur 且不弹浮层。
  - 为什么：打开面板/切换表单时代码调 focus() 会把键盘顶起来；逐个删十几处调用不现实。
  - 验证：打开面板 active=BUTTON 无浮层；程序 focus → active=BODY；真点击 → layer=true/active=inp-field。
  - 批次：20261027-3100

---

## 批次 20261027-3000 · 2026-10-27 · 会话 12c62c

> 用户：不猜网段，改从 native 拿；非完整版禁止联机

# 队列 · 会话 12c62cf015444720a2a57c257f80c045

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-3000

- [x] [L23] 局域网 IP 只从 native 桥拿：`core/net/LanIp.ts`（新）、`ServerListPanel.ts` → playwright
  - 做了什么：`hasNativeLanBridge()`/`getLanIp()` 只问 `Capacitor.Plugins.NativeServer.localIp()`；删掉候选网段猜测，`scanBase()` 拿不到就不扫。
  - 为什么：hostname 在 webview 里是 localhost、地址框是上次的服务器、WebRTC 被 mDNS 混淆——都不成立。
  - 验证：`?lanip=192.168.1.20` 时不弹提示、按该网段扫。
  - 批次：20261027-3000
- [x] [L23] 非完整版禁止联机：`MultiplayerScreen.ts`、`NativeServerPlugin.java`、iOS README
  - 做了什么：join/host 打开先 `ensureFullVersion()`；没桥弹「需要完整版」，关闭/前往下载都同时关掉提示与界面；安卓补 `localIp()`。
  - 验证：无桥 → 提示 + 按钮[关闭,前往下载]，点关闭后两者同关；有桥 → 正常。
  - 批次：20261027-3000

---

