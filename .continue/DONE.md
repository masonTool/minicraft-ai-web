# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261024-0344 · 2026-10-24 · 会话 f639d350

> 主题：建造工具条改造（方案 A 抽屉面板 + 两字标签）。全部改动集中在 `src/ui/BuildToolbar.ts`、
> `src/ui/buildToolbarLayout.ts`、`index.html`、6 份语言包的 `editor.ts`、`src/main.ts`、
> `tools/buildtools-test.ts` 与两张台账。**玩法语义零改动**：左键在建造模式下仍是"点选区角"，
> 选区/填充/复制/粘贴/镜像/模板/撤销/重做八条能力的判断与数值一条都不许动。

- [x] [B1] 几何纯函数换成「总开关盒 + 抽屉盒 + 格子尺寸」：`src/ui/buildToolbarLayout.ts` → `npm run test:buildtools` 全绿
  - 做了什么：`buildToolbarLayout.ts` 整份重写——`buildToggleBox()`（44×56，贴右缘 8px、垂直居中）、
    `buildDrawerSize(scale)` / `buildDrawerBox(w,h,scale)`（基准 360×196，屏幕居中，四周夹进 8px，顶边 ≥ `8 + 22*scale`）、
    `buildCellSize(w,h,scale)`（上限 84×68 随 scale、下限 44 恒定）、`drawerFits()`、`pauseBarBottom()`；
    删掉 `buildToolbarSize/Box/OverlapsPauseBar`。`tools/buildtools-test.ts` 的「工具条几何」段整段改到新函数：
    5 种视口 × 3 种缩放逐条量四边/暂停条/格子热区，加 844×390 的具体落点与两个"装不下"的反例。
  - 为什么：抽屉是居中的，旧的"右缘双列竖排 92×236 + 装不下就折叠"口径整段失效；但"不出界 / 不压暂停条 /
    热区 ≥44"这三条必须继续能离线量。`drawerFits()` 的语义从"保持折叠"改成"给网格加滚动"，所以判据是
    "基准尺寸不打折 + 格子 ≥44"，而不是"基准尺寸塞得进视口"——只有基准都塞不下时（如 320×240 宽度不足、
    844×200 高度不足）才判 false。
  - 验证：`npm run test:buildtools` → 通过 309 / 失败 0（原有 261 条全部保留语义，几何段从 13 条扩到 61 条）；
    `npm run typecheck` 通过；`npm run check:fast` 全绿（172 套里命中 6 套）。
  - 批次：20261024-0344

- [x] [B2] 文案：8 条短标签 + 8 条短语 + 2 条面板文案，**6 种语言全加**：`src/core/i18n/locales/{zh,en,fr,de,pt,ru}/editor.ts` → `npm run audit:i18n` 与 `npm run test:i18n` 全绿
  - 做了什么：6 份 `editor.ts` 各加 18 条键——`buildtools.tool.<8 个>.short`、`buildtools.tool.<8 个>.hint`
    与 `buildtools.panel.title` / `buildtools.panel.endBuild`（原计划的 `.back` 没加，复用已有的 `editor.back`）；
    位置紧跟在 `buildtools.fill.noBlock` 之后，每种语言都带一行本语言的注释标题。
  - 为什么：`title` 在触摸屏永远不显示、`aria-label` 只给读屏，这就是"只有图标、没有文字"的根因；
    六种语言一起加是因为 `audit:i18n` 按语言报覆盖率，只补 zh/en 等于给自己留半套。
    拉丁语系的两字标签只能给"一个短词"（`Remplir` / `Rückgängig` / `Шаблоны`），这是词长差异不是漏翻。
  - 验证：`npm run audit:i18n` → ✓ 通过，六语言 2843/2843（100%）；这 18 条暂时被报成"没人引用"
    （B3 用完就消失，不是错误）。`npm run test:i18n` → 547 通过 / 0 失败。
  - 批次：20261024-0344

- [x] [B3] 工具条 DOM/CSS 改成「单按钮 + 居中抽屉」：`src/ui/BuildToolbar.ts` + `index.html` → `npm run typecheck` 通过且 `npm run test:buildtools` 无回归
  - 做了什么：`BuildToolbar` 整份重写——`#build-toolbar` 变成"开关 + 遮罩 + 抽屉"三层；抽屉 = 头部
    （标题 / 「结束建造」/ ×）+ 两页（8 格工具，4 列 × 2 行；模板第二页 4 张卡 + ← 返回）；
    对外接口保留 `setMode/setAvailable/setUndoState/setSelectionArmed/isOpen`，新增 `openPanel/closePanel/isPanelOpen`
    与 `onEndBuild` 回调（main.ts 里接上：清 `buildMode` + 清选区 + 刷新）。`.extra` / `.collapsed` /
    `.build-templates` 那套"9 个按钮挤一条 + 左侧浮层"的 DOM 与 CSS 全删。
    `index.html` 新增 `#build-toolbar` 覆盖层、`.build-toggle`、`.build-backdrop`、`.build-drawer`、
    `.build-cell`（图标 + 两字标签 + 一句短语，标签与短语都 `text-overflow: ellipsis`）。
  - 为什么：抽屉是**模态**的，遮罩吃掉点击就不会出现"面板开着却挖了方块"；而 44px 双列竖条在 360 高横屏里必然撞跳跃键
    （实测重叠 32×76，且工具条 `z-index: 9` 会**抢走**跳跃键的点击，`#hud` 没有 z-index）。
    尺寸**只在 `buildToolbarLayout.ts` 算一份**，由 `applyLayout()` 写成 `--build-pad/--build-head/--build-gap/
    --build-cell-w/--build-cell-h` 内联变量，CSS 只负责长相——上一版 CSS 写死 92×236、常量里再写一遍，两处已经漂过一次。
  - 验证：`npm run typecheck` 通过；`npm run test:buildtools` 309 通过 / 0 失败（静态断言里的
    `new BuildToolbar(document.body` 与左键三处互斥一条没动）；`npm run audit:i18n` ✓（新增的 `buildtools.toggle.short`
    六语言齐、不再是孤儿）；`npm run check:fast` 161/161 套全绿。真机（844×390 / 640×360、80%~140% 缩放）未测，按用户口径不主动测。
  - 批次：20261024-0344

- [x] [B4] 抽屉的输入隔离：面板开着时键盘只认 Esc：`src/main.ts` → `npm run typecheck` 通过 + `npm run test:buildtools` 无回归
  - 做了什么：`keydown` 里加一段 `if (this.buildToolbar.isPanelOpen)`——Esc `preventDefault()` 后收面板，其余按键直接 `return`；
    位置在小游戏/睡觉判断之后、告示牌/地图/书那三层之前。`onToggleMode(true)` 里补 `this.keys.clear()`。
  - 为什么：遮罩只挡鼠标与触摸，键盘完全不受影响——面板开着按 W 会一边走一边把左键当"点选区角"，
    按 E 会在抽屉上面再叠一层背包，按 Esc 会先弹暂停菜单（书与地图那两处踩过同一个坑）。
  - 验证：`npm run typecheck` 通过；`npm run test:buildtools` 309 通过 / 0 失败。
  - 批次：20261024-0344

- [x] [B5] 主程序接线（含两处旧隐患）：`src/main.ts` → `npm run test:buildtools` 的静态断言全绿 + `npm run test:buildtools` 手工核对 `buildToolbarStateForTest`
  - 做了什么：① 打开抽屉自动开建造模式（`openPanel()` 里 `setMode(true, true)`）；② `closePanel()` 不动模式；
    ③「结束建造」= 收面板 + 关模式 + `onEndBuild()`（主程序清 `buildMode` 与选区）；
    ④ `refreshBuildToolbar()` 里 `!isCreative && buildMode` → `this.buildMode = false`（顺手让工具条自己 `setMode(false)`）；
    ⑤ 新增 `onPanelChange(open)`：开着时 `exitPointerLock()`，关掉后 `!uiOpen && !touch` 才重新锁；
    ⑥ `buildToolbarStateForTest` 加 `panelOpen`。
  - 为什么：④ 是现存的真 bug——旧实现只把工具条藏起来，`buildMode` 仍是 true，左键继续被当"点选区角"吞掉，
    玩家会觉得"挖不动、工具也不见了"；⑤ 的取舍见 `decision.md` D4（不走 `uiOpen`，避免开关面板抖一下）。
  - 验证：`npm run typecheck` 通过；`npm run test:buildtools` 309 通过 / 0 失败。**不跑浏览器自动化**（用户口径：不主动测）。
  - 批次：20261024-0344

- [x] [B6] 测试补齐：`tools/buildtools-test.ts` → `npm run test:buildtools` 309 条 → ≥325 条全绿
  - 做了什么：新增三段 32 条——① 折叠态总开关与跳跃键：2 视口 × 3 缩放量横向间隙与四边（跳跃键几何按 `#touch-ui`
    的 `76` / `40` / `28` 公式现算，注释里写明出处）；② 抽屉形态静态断言 12 条：几何真的被工具条引用、
    `drawerFits` 被调用、旧的 `extra`/`build-templates`/双列 grid 已删干净、`z-index: 9`、遮罩 `pointer-events: auto`、
    开面板开模式 / 收面板不退模式 / 结束建造三件事、格子三层结构、模板第二页；③ 接线 5 条：非创造清零
    `buildMode`、`onEndBuild` / `onPanelChange` / `isPanelOpen` 键盘隔离 / 验收 API 的 `panelOpen`；
    ④ 文案 4 条：zh/en 的 8 组 short+hint 齐全、中文短标签都是 2 字、面板三条文案入表。
  - 为什么：`buildToolbarFits()` 上一版就是"只被测试引用"，等于设计只活在测试里——这次把"被引用"本身也钉成断言；
    跳跃键那条盯的正是用户报的那一下（重叠 + 抢点击），量出来比截图可靠。
  - 验证：`npm run test:buildtools` → 通过 341 / 失败 0（≥325）；`npm run typecheck` 通过。
  - 批次：20261024-0344

- [x] [B7] 文档与全量门禁：`.continue/OVERVIEW.md`（建造工具条目改一行）+ `.continue/TIPS.md`（补一条坑）→ `npm run check` 全绿
  - 做了什么：OVERVIEW「界面与音频」补一条建造工具的形态（单开关 + 居中模态抽屉 + 几何只在 `buildToolbarLayout` 算一份），
    坑区补一行「挡住常常已经是按不动」；TIPS 增一节「固定 px 的竖排工具条在横屏必压操作键——而且会抢走它的点击」
    （症状 / 根因 / 处置 / 判据 / 适用面）；顺带跑 `npm run audit:tasks` 把 HANDOFF 的进度口径（286/6 → 287/5）
    与提交总数（1526 → 1599）、README 路线图状态列改回与 `TASKS.md` 一致（它们是派生数字，之前已经漂了）。
  - 为什么：坑的门槛刚好够（量了很久才定位："只是挡住"其实已经是"按不动"）；文档里留着旧形态会误导下一批。
    `TASKS.md` 里**没有**创造5 的条目（上一批在 `notes/batches.md` 记为"会话队列，无 T 号"），所以没有"右侧竖排"的描述要改；
    本批的落地留到收尾第③步写进「队列落地 · 当场任务」。
  - 验证：`npm run check` 全绿（退出码 0、0 条 ✗）：typecheck + audit:i18n + 172 套离线 + 三张台账 + audit:docs + check:browser(跳过)。
  - 批次：20261024-0344

- [x] [自审] 这一批的三层自审 → 结论写进条目下方
  - L1：抽屉的"不出界 / 不压暂停条 / 不压跳跃键 / 热区 ≥44"全部有会红的检查——几何 61 条（5 视口 × 3 缩放
    逐条量四边与格子下限）+ 折叠态开关对跳跃键 12 条（2 视口 × 3 缩放，间隙 > 0、四边在视口内）+ 静态 16 条
    （几何真被 `BuildToolbar` 引用、`drawerFits` 被调用、旧类名已删、层级 9、遮罩吃点击、状态机三件事、主程序四处接线）。
  - L2：真做了两次破坏性实验。① 把 `buildDrawerBox()` 的居中改成贴底 → 2 条红（顶边 97→194、底边 293→390），
    改回即绿；② 把 `applyVisibility()` 里的 `setMode(false)` 删掉 → **原本 341 条全绿**（盲区），当场补一条
    「不可用时工具条自己也会退建造模式」，再删一次变红、恢复变绿（342 条）。
  - L3：判断依据里 **2 条来自真实使用者**（"工具条展开盖住跳跃键"、"完全没有文字提示，难用不如没有"），
    其余 6 条是我按项目既有约定推的（4 列 × 2 行排版、360×196 基准、`drawerFits()` 改成滚动降级、指针锁走
    `onPanelChange`、键盘隔离、Esc 收面板）。真机观感（844×390 / 640×360、按钮 80%~140%、左右手模式）**没测**——
    用户口径是不主动测，这几项留给用户过一眼。
  - 改进：当场修了一条（上面 L2 ②），其余没有新 `T` 号（这批的问题都能在本批内收口）。
  - 批次：20261024-0344

---

## 批次 20261023-2351 · 2026-10-24 · 会话 974b5553

> 本批 44 条、说明很长（原队列 60KB），这里只保留每条的一行验证；**完整说明（做了什么 / 为什么 / 未验证）见 `.continue/.logs/974b55/queue.md`**。

- [x] [联机1] 补协议文档：新增 `docs/NET-PROTOCOL.md`（现有 16 条消息的方向/字段/校验），`server/index.mjs` 头注释改指它 → `npm run audit:docs` 通过
  - 验证：`npm run audit:docs` 通过；`npm run check:fast` 全绿
- [x] [联机2] 握手校验：`join` 带 `{v, name, clientId}`，服务端校验版本/名字长度/重复 clientId，不兼容回 `error{code:'version'}` 并关闭 → `npm run test:net` 新增“旧版本被拒 / 脏名字被截断”
  - 验证：`npm run test:net` **35 通过 / 0 失败**；新增 `tests/net-client-id.test.ts`（8 条）+ `tests/net-protocol-version.test.ts`（4 条），单测全量 314 → **326**；`npm run check:fast` 全绿
- [x] [联机3] 加入即上报位置与维度，远端玩家按维度过滤：`NetPlayerState` 保留 `dimension`，`main.ts` 渲染远端前比对当前维度 → `npm run test:unit` 新增 `tests/net-remote-dimension.test.ts`
  - 验证：`npm run test:net` 35 → **39 通过**；新增 `tests/net-remote-dimension.test.ts` **6 条全过**；主树单测 **163 → 169**；`npm run check:fast` 全绿
- [x] [联机4] 未加载区块的远端方块改动不再丢：`main.ts onNetBlock` 先 `world.edits.record` 进缓冲，区块加载回调再应用 → `npm run test:unit` 新增 `tests/net-block-buffer.test.ts`
  - 验证：`npx vitest run tests/net-block-buffer.test.ts` **9 条全过**；主树单测 **169 → 178**（24 文件）；`npm run typecheck` 通过
- [x] [联机5] 种子对齐：以服务端种子为准，不一致时提示并提供“用该种子新建多人世界 / 重载当前世界”；含世界重载路径（清 chunk/实体/edits/时间/玩家位置）→ `npm run test:unit` 新增 `tests/net-seed.test.ts` + `npm run test:save`
  - 验证：`npx vitest run tests/net-seed.test.ts` **8 条全过**；主树单测 **178 → 186**（25 文件）；`npm run test:commands` 435 → **440 通过**；`npm run test:save` **111 通过**；`npm run test:net` **39 通过**；`npm run audit:i18n` 六语言 2831/2831 100%、无孤儿键
- [x] [联机6] 多人存档隔离：联机世界按 roomId 派生独立库，服务器 edits/容器不写进单机档；退出联机回原单机世界 → `npm run test:save`
  - 验证：新增 `tests/net-mp-save.test.ts` **7 条全过**；主树单测 **186 → 193**（26 文件）；`npm run test:save` **111 通过**；`npm run typecheck` 通过
- [x] [联机7] 心跳、超时与会话状态机：服务端 5s ping / 20s 无 pong 断开；客户端 `connecting|connected|reconnecting|offline` 收进纯逻辑 `core/net/NetSession.ts` → `npm run test:unit` 新增 `tests/net-session.test.ts` + `npm run test:net`
  - 验证：`npx vitest run tests/net-session.test.ts` **8 条全过**；`npm run test:net` 39 → **40 通过**；主树单测 **193 → 201**；`npm run typecheck` 通过
- [x] [联机8] 断线重连会话恢复：服务端 30s grace 按 clientId 保留 id 与掉落物，重连复用 id；客户端保留 localId 不重发 → `npm run test:net` 新增“3 秒内重连复用 id”
  - 验证：`npm run test:net` 40 → **43 通过**；客户端 `localId` 由 `main.ts` 分配、重连时不重置，因此重新冒出的掉落物不会与旧的撞键；`npm run typecheck` 通过；`check:fast` 全绿
- [x] [联机9] 最小连接入口（不是大厅）：地址/昵称/连接/断开/状态，主菜单与暂停菜单各一个入口，横屏可点；新增 `src/ui/MultiplayerScreen.ts` + 六语言文案 → `npm run test:ui` + `npm run test:i18n` + `npm run shot`
  - 验证：`npm run test:ui` **934 通过 / 0 失败**；`npm run test:i18n` **547 通过**（六语言新键齐全、分组文件同构）；`npm run typecheck` 通过；`npm run check:fast` 全绿
- [x] [联机10] 时间与天气权威：服务端维护 `timeOfDay`/`weather`，join 下发 + 每 2s 校正广播，客户端按 dt 推算只做插值 → `npm run test:net` + `npm run test:weather`
  - 验证：新增 `tests/net-time.test.ts` **12 条全过**；`npm run test:net` 43 → **45 通过**；主树单测 **201 → 213**；`npm run typecheck` 通过
- [x] [联机11] 睡眠与跳夜广播：任一玩家睡满即跳夜（先按本项目口径），服务端广播时间跳变并清天气，差异记台账 → `npm run test:net` + `npm run test:bed`
  - 验证：`npm run test:net` 45 → **48 通过**；`npm run test:bed` **117 通过 / 0 失败**（单机睡眠逻辑没动）；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 191 注意），新注记已进 `TASKS.md` 第 5686 行
- [x] [联机12] 方块写入统一出口：在 `World.events.onBlockChanged` 上挂广播（覆盖红石/流体/火焰/作物/漏斗/爆炸），远端应用时抑制回声，100ms 合帧批量发 → `npm run test:unit` 新增 `tests/net-block-funnel.test.ts` + `npm run test:net`
  - 验证：新增 `tests/net-block-funnel.test.ts` **9 条全过**；`npm run test:net` 48 → **50 通过**；主树单测 **213 → 222**；`redstone`/`hopper`/`furnace`/`net` 四套离线全绿；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 192 注意）
- [x] [联机13] 服务端持久化：新增 `server/store.mjs`，edits/容器/时间/天气落盘，启动加载、定时 + 退出保存、损坏文件回退备份 → `npm run test:net` 新增“重启后快照仍在”
  - 验证：`npm run test:net` 50 → **58 通过**（新增 8 条：重启前的客户端能加入 / 重启后服务端能再起来 / 重启后拿到 welcome / **重启后方块改动还在** / **重启后容器内容还在** / 坏快照下服务端仍能起来 / 坏快照被备份/ 坏快照之后从空世界开始）；测试用 `mkdtempSync` 的临时 `DATA_DIR`，不碰开发者自己的 `server/.data/`；`npm run typecheck` 通过；`npm…
- [x] [联机14] 快照裁剪与容量策略：welcome 只发玩家附近 edits，`MAX_EDITS` 满时淘汰最旧并告警（不再静默丢）→ `npm run test:net` 新增大快照裁剪断言
  - 验证：新增 `tests/net-snapshot-policy.test.ts` **10 条全过**；`npm run test:net` 58 → **60 通过**；主树单测 **222 → 232**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 194 注意）
- [x] [联机15] 容器同步扩展到全部工作站：箱子/木桶/熔炉/高炉/烟熏炉/酿造台/发射器/投掷器/漏斗，统一“变更出口”而非打开时才挂 → `npm run test:net` + `npm run test:furnace` + `npm run test:hopper`
  - 验证：新增 `tests/net-container-sync.test.ts` **9 条全过**；`npm run test:net` 60 → **63 通过**；主树单测 **232 → 241**；`npm run check:fast` 全绿，命中 **40 套**离线
- [x] [联机16] 告示牌文字与展示框内容同步（B12/B14 现在写着“联机不广播”），更新差异台账 → `npm run test:net` + `npm run test:sign` + `npm run test:frame`
  - 验证：`npm run test:net` 63 → **67 通过**；`sign` / `frame` / `net` 三套离线全绿；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 196 注意）
- [x] [联机17] 玩家外观状态：手持物/副手/盔甲/潜行/挥手/受伤/着火/骑乘/睡觉，扩展 `NetPlayerState` 并接到渲染 → `npm run test:unit` 新增 `tests/net-player-state.test.ts`
  - 验证：新增 `tests/net-player-state.test.ts` **12 条全过**；`npm run test:net` 67 → **69 通过**；主树单测 **241 → 253**；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 197 注意）
- [x] [联机18] 队友名字牌：`main.ts` 现在明确跳过远程玩家，改成显示昵称 + 距离衰减 → `npm run test:nametag`
  - 验证：`npm run test:nametag` 143 → **149 通过 / 0 失败**；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 198 注意）
- [x] [联机19] 生物同步：位置/血量/状态广播 + 远端插值/降频，AI 仍各端跑（差异记台账）→ `npm run test:unit` 新增 `tests/net-mob-sync.test.ts` + `npm run test:net`
  - 验证：新增 `tests/net-mob-sync.test.ts` **7 条全过**；`npm run test:net` 69 → **73 通过**；主树单测 **253 → 260**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 199 注意）
- [x] [联机20] 远端实体 AOI 与分级降频：16 格每 100ms、32 格每 250ms、更远不发 → 单测分级函数 + `npm run test:perf`
  - 验证：新增 `tests/net-aoi.test.ts` **11 条全过**；`npm run test:perf` 40 → **44 通过**；主树单测 **260 → 271**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 200 注意）
- [x] [联机21] 掉落物拾取仲裁：服务端 first-come 锁 + 扣减广播，镜像可捡；解决 L7“远端堆拿不到” → `npm run test:net` 新增“双客户端抢同一堆只有一边拿到”
  - 验证：`npm run test:net` 73 → **78 通过**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 201 注意）
- [x] [联机22] PvP 与队伍免伤：伤害来源接 `Teams.sameTeam()`，`/team friendlyfire` 真正生效（M23 卡住的两项）→ `npm run test:commands` + `npm run test:net`
  - 验证：`npm run test:commands` 440 → **444 通过**；`npm run test:net` 78 → **82 通过**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 203 注意）
- [x] [联机23] 其余实体同步：箭/TNT/经验球/船与矿车按优先级；不做的写进差异台账 → `npm run test:net` + `npm run test:entity`
  - 验证：`npm run test:net` 82 → **86 通过**；`npm run test:entity` **199 通过 / 0 失败**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 204 注意）
- [x] [联机24] 消息校验：方块 id 白名单、y 范围、state 位宽、与玩家距离上限（block/container 都校验）→ `npm run test:net` 新增脏消息用例
  - 验证：新增 `tests/net-block-validation.test.ts` **9 条全过**；`npm run test:net` 86 → **92 通过**；主树单测 **271 → 280**；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 206 注意）
- [x] [联机25] 限频与体积：全局令牌桶（block/container/chat）、`maxPayload` 64KB、名字字符清洗 → `npm run test:net` 新增“刷屏被限”
  - 验证：新增 `tests/net-ratelimit.test.ts` **8 条全过**；`npm run test:net` 92 → **95 通过**；主树单测 **280 → 288**；`npm run audit:diffs` 重建台账（66 差异 / 208 注意）
- [x] [联机26] 房间码、可选密码、Origin/Token 校验：一房一世界，拒绝跨站连接 → `npm run test:net` 新增“错 origin 被拒 / 两个房间互不串”
  - 验证：新增 `tests/net-server-url.test.ts` **6 条全过**；`npm run test:net` 95 → **105 通过**；主树单测 **288 → 294**；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 210 注意）
- [x] [联机27] 广播 AOI：玩家/方块/实体按 8 区块 + 维度过滤，O(n²) → O(n·k) → 单测过滤函数 + `npm run test:net`（不该收到的收不到）
  - 验证：新增 `tests/net-aoi-broadcast.test.ts` **5 条全过**（半径内外边界 / 对角 128,128 收到而 144,144 不收（切比雪夫语意）/ 维度不同不收 / 负坐标按区块取整 / 非法坐标与缺玩家）；`npm run test:net` 105 → **110 通过**；主树单测 **294 → 299**；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / …
- [x] [联机28] wss 与部署：`ws` 从 devDependencies 移到 dependencies、`defaultServerUrl` 支持同源 `/ws` 与 `wss://`、补 Dockerfile/反代/健康检查、更新 README 与 `notes/ops.md` → `npm run build` + 生产依赖下 `node server/index.mjs` 能起
  - 验证：`tests/net-server-url.test.ts` **6 → 9 通过**；`npm run test:net` 110 → **113 通过**；`npm run build:fast` 出包成功；`npm run typecheck` 通过；`npm run check:fast` **172 套全量绿**（改了配置文件 → 走全量）；`npm run audit:diffs` 重建台账（66 差异 / 212 注意）
- [x] [联机29] 观测与诊断：服务端人数/带宽/TPS 日志与 `/healthz`，客户端 F3 面板加 ping/丢包/上下行 → `npm run check` 全绿
  - 验证：新增 `tests/net-stats.test.ts` **11 条全过**；`npm run test:net` 113 → **115 通过**；`npm run typecheck:tools` **0 错误**；**`npm run check` EXIT=0 全绿**
- [x] [联机30] 修聊天重复回显（写协议文档时发现）：服务端 `chat` 广播包含发送者，客户端又本地回显一次；改成服务端不再回传给发送者 → `npm run test:net` 新增“发送者只收到一份”
  - 验证：`npm run test:net` 115 → **117 通过**；`npm run audit:diffs` 台账与条目一致（66 差异 / 213 注意）
- [x] [联机31] 远端掉落物镜像补维度（做联机3 时发现）：`NetItemState` 与 `item` / `item-remove` 广播都不带 `dimension`，队友在下界掉的东西会画在主世界同坐标；加字段并在 `main.ts` 建镜像与渲染时按维度过滤 → `npm run test:net` 新增“跨维度掉落物不通告”
  - 验证：`npm run test:net` 117 → **119 通过**；`npm run typecheck` 通过；`npm run audit:diffs` 重建台账（66 差异 / 214 注意）
- [x] [联机32] 单测别把工作树副本跑进去（做联机3 时发现）：`vitest run tests` 会把 `.continue/doing/.worktree/*/tests/` 一起收集，45 文件 / 332 条里一半是副本，计数虚高一倍且工作树的红会污染主树门禁 → 在 `vite.config.ts` 加 `test.exclude` 排除 `.continue/**`，之后主树应回到 23 文件 / 169 条 → `npx vitest run` 输出 23 个文件 + `npm run check:fast` 全绿
  - 验证：`npx vitest run` 与 `npm run test:unit` 都变成 **24 文件 / 178 条**；`npm run typecheck` 通过；`npm run check:fast` 全绿
- [x] [联机33] 区块加载后才补上的远端容器要建实体（做联机4 时发现）：`ensureBlockEntityAt` 只在 `block`/`welcome` 的「已加载」分支调，经增量表补上的漏斗/箱子/发射器只有方块、没有容器表项（打开是空的、漏斗不搬东西）；在 `World.events.onChunkLoaded` 里按增量表里该区块的容器类方块补建 → `npm run test:unit` 新增“补上的漏斗能打开”
  - 验证：新增 `tests/net-container-spawn.test.ts` **5 条全过**；主树单测 **313 → 318**（40 个文件）；`npm run typecheck` 通过；`npm run check:fast` 全绿；`npm run audit:diffs` 重建台账（66 差异 / 215 注意）
- [x] [联机34] 世界原地重载（做联机5/6 时拆出来的硬骨头）：`resetWorld(seed)` 重建 `World` 与渲染侧缓存、清实体/掉落物/TNT/漏斗定时器/时间/位置/维度，再从指定存档库把 edits/容器/牌子/展示框/进度叠回去
  - 验证：`tests/world-reset.test.ts` **7 条全过**；`npm run typecheck` 通过；`npm run check:fast` 全绿（6 套命中，含 `render`）；主树单测 **318 → 325**
- [x] [联机35] 天气权威（做联机10 时拆出来的另一半）：服务端维护 `weather`（晴/雨/雷），join 下发 + 切换时广播，客户端联机时**不再自己掷骰子**（`WeatherState.ts` 的自动切换要让位），只负责渲染降水 → `npm run test:weather` + `npm run test:net` 新增「天气广播与客户端接管」
  - 验证：`tests/net-weather.test.ts` **4 条全过**（下一段种类 / 持续时长 / 推进（未到点与到点）/ 雨与雷暴一律转晴）——**它当场抓到一处抄错**：`STORM_SECONDS_*` 我写成 180~420，客户端实际是 120~300；`npm run test:weather` **58 通过 / 0 失败**（客户端规则没动）；`npm run test:net` 119 → **120 通过**；主树单测 **325 → 32…
- [x] [发现] `net` 套件并发下偶发超时红：`tools/run-tests.mjs --changed` 里 `net` 与 `guard` 同时跑时，`net` 偶发跑满 10.5s 被判失败（本轮撞见两次：联机11、联机12 提交前守卫各拦下一次，重跑即过；单跑稳定 4.8s）→ 怀疑是固定端口 8787 加 5s 心跳等待叠加，改成随机空闲端口（或让 `run-tests` 把它标成独占），连续 10 次 `--changed` 不再出现 10s 红
  - 验证：`npm run test:net` **69 通过 / 0 失败**；`node tools/run-tests.mjs --changed` **连跑 5 次全绿**
- [x] [联机37] 外观剩下的三件事（做联机17 时拆出来）：① 远端模型的**下蹲/骑乘/睡觉姿势**（要动 `MobRenderer` 骨架）；② 玩家**盔甲**数据源（现在只有 `armorColors` 简化模型，没有逐槽物品）；③ **副手槽**（同上，且要进存档与背包界面）→ 批次按用户裁决**只做 ①**，②③ 拆成 `联机40` / `联机41`
  - 验证：`tests/mob-pose.test.ts` **5 条全过**；主树单测 **329 → 334**；`npm run typecheck` 通过；`npm run check:fast` 命中 **30 套全绿**
- [x] [联机38] 生物**位置**同步的前置（联机19 只做了命中事件）：① 定"谁权威"——最省的是"离这只生物最近的玩家上报"，其余端只收；② 定全局实体 id（服务端按 `ownerId:localId` 记，与 `items` 同一套）；③ 定**影子抑制**规则（收到远端生物时本地 AI 不能再生成一份同名同类型的怪，否则玩家看到双份）→ 产出：`core/net/MobAuthority.ts` 纯函数（谁该上报 / id 是否新鲜）+ 单测；做完后可以给联机19 补上位置与插值
  - 验证：`tests/mob-authority.test.ts` **12 条** + `tests/mob-shadows.test.ts` **9 条**，全过；主树单测 **334 → 355**；`npm run typecheck` 通过
- [x] [发现] `net` 套件已跑满 14s，并发下偶发红：`check:fast` 里它与 `guard` 并发时本轮又红了一次（单独跑 95 通过、连跑 `--changed` 三次全绿；证据：`tools/run-tests.mjs --changed` 的 `最慢：net 14.08s`）→ 把套件里重复的 join/固定 `sleep` 抽成公共夹具、限频用例改小规模或挪到独立的慢速套件，让 `net` 回到 6~8s，并连跑 5 次 `--changed` 不再出现并发红
  - 验证：`npm run test:net` **120 通过 / 0 失败**、耗时 **18.53s → 12.61s**（-32%）；`node tools/run-tests.mjs --only net --only guard` **连跑 5 次全绿**（改前并发下两次红）；全量 `check:fast` **172/172 套全绿**，`最慢：structure 17.07s · net 13.52s · guard 11.10s`
- [x] [联机39] 让世界可换（做联机34 时卡住的前置）：`main.ts` 的 `world` 去掉 readonly、`ChunkRenderer`（以及之后任何 `private readonly world` 的渲染器）改成 `setWorld(world)` 或可重建；配套一个 `npm run shot` 的验收步骤（换世界后画面正常、旧区块不残留）→ 先只有这一层，接通过之后再回 `联机34` 写执行路径
  - 验证：结论由 `联机34` 的实现反向验证——`World.reset()` + `reloadWorld()` 在 `3451c264` 落地，`tests/world-reset.test.ts` **7 条全过**、`npm run check:fast` 全绿；本条自己没有代码产出（当初判断"必须换实例"是错的，`readonly world` 与 `ChunkRenderer` 的绑定一直没动）
- [x] [联机40] 玩家盔甲改成逐槽数据源（做联机17/37 时拆出来）：现在只有 `armorColors` 简化模型（渲染用颜色，不知道是什么甲），要改成"头盔/胸甲/护腿/靴子"四槽的真实物品 id，跟随存档（`联机13` 的玩家快照）与 `move` 外观一起传 → **要改存档格式（旧档迁移）**，等用户拍；做完后 `联机37` 的 `armor[]` 字段才有真实含义
  - 验证：`tests/net-remote-armor.test.ts` **8 条全过**；主树单测 **355 → 363**；`npm run typecheck` 通过；`npm run check:fast` 全绿（5 套）
- [x] [联机41] 副手槽（做联机17/37 时拆出来）：背包多一个副手槽（盾牌/火把/食物），要进存档、背包界面、`F` 键交换、以及 `move` 的 `offhand` 字段真正生效 → **同样要改存档格式**，与 `联机40` 一起拍板
  - 验证：`tests/offhand.test.ts` **6 条全过**；主树单测 **363 → 369**；`npm run typecheck` 通过；`npm run check:fast` 全绿（5 套）
- [x] [发现] 远端看不到副手的物品：`core/entity/MobEquipment.ts` 的接口只有 `mainHand/head/chest/legs/feet`，`MobRenderer` 也只按 `equipment.mainHand` 画手持物 —— 于是联机41 传上去的 `offhand` 目前只存不用 → 给 `MobEquipment` 加 `offHand` 并在 `MobRenderer` 画第二个手持部件（左手位置），做完后队友举盾你能看见
  - 验证：`tests/net-remote-armor.test.ts` **8 → 11 条全过**；`npm run typecheck` 通过；`npm run check:fast` 命中 **45 / 172 套全绿**（含 `equipment` / `mob` / `render`，说明改装备槽没打破既有断言）
- [x] [自审] 全批收口自审：三层目标逐层给结论与证据，勾成 `[x]` 时下方必须有 `- L1：` / `- L2：` / `- L3：` 三行 → 收尾时补齐
  - 验证：见 L1——369 条单测 / 47 文件、`test:net` 120 通过、守卫 6 项全绿都是本轮实际跑过的（`check:fast` 45/172 与全量 172/172 各跑过一次）；L2/L3 的证据是各功能条目自己的测试与文档，不是推断

## 批次 20261024-0257 · 2026-10-24 · 会话 4024a9d4

- [x] [E1] 界面文案收口：`WORLD_TYPE_HINTS`（5 条世界类型说明）→ `world.typeHint.*`；`main.ts` 的 **25 处 HUD toast**（名字/驯服/装鞍/牵绳/猪灵交易/袭击/图腾…）→ `misc.toast.*`；`WorldScreen` 的种子提示与生存警告 → `world.seedHint` / `world.survivalWarn`；告示牌编辑器标题 → `misc.signEditorHint`；外观预设 4 条 → `label.appearance.preset.*`
  - 做了什么：新增 **34 条键 × 6 语言 = 204 条**（27 条 `misc.toast.*` + 2 条 `world.*` + 5 条 `world.typeHint.*` + 4 条 `label.appearance.preset.*` + 1 条 `misc.signEditorHint`），表 2786 → **2825**
  - 做法：`WORLD_TYPE_HINTS` 常量表改成 `worldTypeHint(type)` 函数（模板字面量让审计认键）；`main.ts` 25 处 toast 全部改成 `t()` / `tp()`，其中 12 处带 `{kind}`（生物名）、1 处带 `{item}`/`{count}`、1 处带 `{mode}`
  - ⚠️ 这是**上一轮我判断错的地方**：我说 `CHARACTER_PRESETS[].label` "没有 UI 读它"，其实 `SettingsScreen.ts:1598` 就是 `button.textContent = preset.label` —— 外观设置的四个预设按钮直接显示它。这次是按 `textContent =` 这个出口反查才发现的
  - ⚠️ 又一条同类：`WORLD_TYPE_HINTS`（世界类型下面的说明文字，玩家创建世界时看）也是中文常量表，且它和 `worldTypeLabel()`（已 i18n）**不是同一张表**，之前几轮一直没被发现
  - 改了 3 条既有 `ui` 断言（判据锚点从中文字面量改成键/函数）：世界类型说明、四个角色预设、拴绳提示；另改 `tests/appearance.test.ts` 一条（`preset.label` → `preset.id`）
  - 新增 5 条断言：de/ru/fr/pt 各一条「界面文案不含中文、不露键名」（取样 10 条：预设 2 / 世界类型 2 / 种子提示 / toast 3 / 告示牌）+ 中文下仍是原说法
  - 验证：浏览器实测 `?lang=de` → 创建世界界面显示 `Volle Welt: Biome, Bäume, Erze, Dörfer, Festungen… für Überleben empfohlen`（世界类型说明已是德语）；`test:i18n` **547 / 0**；`ui` **926 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2825 条、0 缺口 / 0 孤儿
  - 批次：20261024-0257

- [x] [E2] 清理两处**没人读的**中文 label 字段 + 复查全仓
  - 做了什么：`Rules.ts` 的 `DifficultyProfile.label`（和平/简单/普通/困难）与接口字段**删除** —— 使用点全是 `.mobDamage` / `.starveRate` / `.spawnCap`，没有一处读 `.label`；`Difficulty` 的显示名仍由 `difficultyLabel()` 走 `cmd.label.difficulty.*`
  - 复查结论（`textContent=` / `.show(` / `label:` / `placeholder:` / `aria-label` 反查）：全仓**只剩 `GenerationSources.ts` 的 19 条**中文 label，其读者只有 `tools/genregistry-test.ts`，**玩家不可见** → 保留（与 `diagPerf.ts` 同类，属开发者数据）
  - 顺带确认**深链已经好了**：`?lang=de` → `html lang=de` + 正文德语、`?lang=pt` → `pt-BR`、`fr` / `ru` 同样正确（之前 P4-5 记的"深链不生效"是旧状态，P5-2 已修，本批实测通过）
  - 验证：`grep` 确认 `DIFFICULTY_PROFILES` 无 `.label` 读者；`test:offline` 172 / 172 套全绿；`test:i18n` 547 / 0
  - 批次：20261024-0257

---

## 批次 20261024-0245 · 2026-10-24 · 会话 4024a9d4

- [x] [D1] 第 ⑤ 类真遗漏：`BeaconScreen` 的 6 个效果按钮（`power.label` = 速度/急迫/抗性提升/跳跃提升/力量/生命恢复）复用 `effectLabel()`；`WorldScreen` 的 `aria-label='关闭'` 与 `error.textContent='保存失败，请重试'` 入表
  - 做了什么：`BeaconScreen` 的 **6 个效果按钮**（速度/急迫/抗性提升/跳跃提升/力量/生命恢复）不再读 `power.label`，改用 **`effectLabel(power.effect)`** —— 复用状态效果已有的 `label.effect.*`（30 条），**零新键**；`WorldScreen` 的 `aria-label='关闭'` 与 `error.textContent='保存失败，请重试'` → `misc.close` / `world.saveFailed`（**2 条新键** × 6 语言）
  - 顺手删掉了 `BeaconPower.label` 字段（5 处 UI + `beacon-test` 的 1 条断言改用 `effectLabel()`），`Beacon.ts` 里再无中文；`BEACON_POWERS` 的顺序注释与存档语义**没动**（顺序即下标，只删了 label）
  - ⚠️ 侦察结论修正了我上一轮的估计：说"约 20 条"，实际只有 **8 处**。两处被排除的是：① `game/appearance.ts` 的 `CHARACTER_PRESETS[].label`（成年男性等 4 条）—— `grep` 全仓**没有任何 UI 读它**，是纯数据字段；② `Rules.ts` 的 `DIFFICULTIES[].label`（和平/简单/普通/困难）—— `WorldScreen` 用的是 `difficultyLabel()`（已走 i18n），那个 label 没人读
  - 验证：`test:i18n` **542 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2786 条、0 缺口 / 0 孤儿；`beacon-test` 通过（断言改成"每个 power 都有效果 id 且 `effectLabel()` 能解析出名字"）
  - 批次：20261024-0245
- [x] [D2] 兜底语义改成英文：确认 `t()` 的回落链是「本语言 → 英文 → 键名」，并加**可复现断言**（人为删一条 de 键 → 必须显示英文、不得显示中文原文）；同时说明 `advancementTitle` / `itemDescription` 里的中文原文兜底现在是否还必要
  - 结论先说：`t()` 的回落链本来就是「**本语言表 → 英文表 → 键名**」，所以"某语言缺翻时显示英文"**已经成立**，不需要改实现。本轮把它变成**可复现的断言**
  - 新增 3 条断言：① 造一个假语言 `yy`，只装 `pause.title` 一条键 → 查 `pause.resume` 必须等于**英文**且**不等于中文**（这正是"新增文案只加了 zh/en 就上线"的真实场景）；② `yy` 里有的那条照常取本语言；③ `advancementTitle()` 在德语下取德语（不缺翻时不落到中文原文）
  - `advancementTitle` / `itemDescription` 里那层"中文原文兜底"**只在连英文都没有时才触发** —— 也就是**键漏了**（`satisfies Messages` 会在编译期先报）。保留它当最后一道保险；真要删，得连着回落链一起改，收益不抵风险
  - 数据层现状（本轮复测）：四语言 2786 键 **0 缺键 / 0 含中文 / 0 空值** —— 也就是说中文原文兜底在六语言上**一次都不会触发**
  - 验证：`test:i18n` **542 / 0**（含新增 3 条）；`test:offline` **172 / 172 套全绿**
  - 批次：20261024-0245

---

