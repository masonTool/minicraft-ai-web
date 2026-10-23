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

## 批次 20261024-0223 · 2026-10-24 · 会话 4024a9d4

- [x] [C1] 品牌收尾：六语言 `advancement.story_root.title`（现在是「Minecraft」，zh 是「我的世界」）→ `Minicraft`；`package.json` 的 `name`（`bedrock-118-web`）→ `minicraft`；注释里残留的 `MINECRAFT` / `Bedrock 1.18 Web` 一并改；**副标题 `1.18 · WEB EDITION` 删掉**（`BRAND_EDITION` 连同首页 `edition` 元素）
  - 做了什么：① 六语言 `advancement.story_root.title` —— en/de/ru/fr/pt 原来是 `Minecraft`、zh 是「我的世界」，全部改成 **`Minicraft`**；② `package.json` 的 `name`：`bedrock-118-web` → **`minicraft`**；③ 注释里残留的 `MINECRAFT`（`WorldScreen` 与 `index.html` 的布局说明）改成"品牌名的字母"，`index.html` 那条历史注释里的 `Bedrock 1.18 Web` 改成 `Minicraft`；④ **副标题删除**：`WorldScreen` 不再创建 `world-edition` 元素，`BRAND_EDITION` 置空并写明原因
  - 实测（浏览器，起 vite 5207 + 本机 Chrome）：`document.title = Minicraft`、`.world-logo = Minicraft`、`.world-edition` **已删除**，首页正文变成 `Minicraft WebGL2! 原生生存、创造与多世界存档 …` —— 只剩品牌名一行
  - ⚠️ 改了 4 条既有断言的判据（都是"用户要求变了"的直接后果）：① `i18n`「中文模式下标题与说明原样不动」→ 排除 `minecraft:story/root`（它现在**故意**等于品牌名）；② 「首页品牌块从 BRAND / BRAND_EDITION 取值」→ 改成「首页只显示品牌名（副标题已删）」；③ 「副标题是版本身份」→ 改成「副标题已删除（`BRAND_EDITION === ''`）」；④ 「中文成就标题与原文逐条一致」→ 排除 story_root；⑤ `ui`「首页品牌块取唯一真值」→ 改成验 `logo.textContent = BRAND` 且**不含** `world-edition`
  - 验证：`test:i18n` **523 / 0**；`ui` **926 / 0**；`test:offline` **172 / 172 套全绿**；`grep` 旧品牌名在 `src` / `public` / `index.html` / `docs` / `README.md` / `package.json` 里**只剩 `brand.ts` 的注释**（说明为什么删副标，属历史陈述）
  - 批次：20261024-0223
- [x] [C2] 全局语言遗漏复查：数据层面（2701 键 × 4 语言）已确认 0 缺键 / 0 含中文 / 0 空值；**源码层面 906 处硬编码中文**需要分类甄别（命令错误信息 28 处是玩家可见的、成就与物品说明 297 处是**回退原文**设计如此、diagPerf 32 处开发者面板）——调研结论写进说明，是否继续做由用户拍板
  - 做了什么：两条口径各扫一遍 —— ① **数据层**：2701 个键 × de/ru/fr/pt，查缺键 / 含中文 / 空值 / 占位符 / 与英文同形；② **源码层**：扫 `src` 下所有 `.ts` 的非注释字符串字面量里的中文，按文件计数并抽样看上下文
  - ✅ 数据层结论：**缺键 0 · 含中文 0 · 空值 0**（四语言全绿）；占位符不一致只有 5 处且全是**少用**（俄/法/葡的 `woodLog`/`woodPlanks`/`stemStage` 不提第二个 `{wood}`/`{crop}`、`armor` 不提 `{material}`），语义无损；与英文同形 de 78 / ru 9 / fr 102 / pt 55，**无整组可疑**（最大的 `label` 也只有 4/226）
  - ⚠️ 源码层结论：**906 处**硬编码中文，但绝大多数**不是遗漏** —— `advancements.ts`（205 条）与 `itemNames.ts`（92 条）是**中文原文回退值**（`advancementTitle()` / `itemDescription()` 先查表、缺键才回落，设计如此）；`diagPerf.ts`（32 条）是 `?debug=1` 的开发者面板
  - 🔴 **真遗漏（玩家可见，已立条目）**：① `Rules.ts` 的 `GAME_RULE_LABELS`（35 条规则描述，注释写明"**命令帮助的下拉用**"—— 与 P6-1 修的难度/模式同一类毛病）；② `Commands.ts` 里仍写死的中文回执（`/clone` 的「已复制 N / M 格到 …」、`（masked：跳过 N 格非空气）`、`(空)`）与 `Selectors.ts` 的 14 条选择器错误信息；③ `loot.ts` 的 30 条结构名（`村庄小屋` / `废弃矿井` …）可见性待确认
  - 验证：巡查脚本实测四语言「缺键 0 / 含中文 0 / 空值 0」；源码扫描 906 处、73 个文件，按文件排序前几位为 `advancements.ts 205 / main.ts 154 / itemNames.ts 92 / Rules.ts 35 / diagPerf.ts 32 / loot.ts 30`；`test:i18n` 523 / 0、`test:offline` 172 / 172 套全绿
  - 批次：20261024-0223


- [x] [C3] `GAME_RULE_LABELS`（35 条规则描述）多语言 —— 命令帮助里的 gamerule 下拉直接显示它，与 P6-1 的难度/模式同一类；改 `gameRuleLabel(rule)` 走 `cmd.label.gamerule.*`
  - 做了什么：`GAME_RULE_LABELS`（31 条中文规则名）→ **`gameRuleLabel(rule)`** 走 `cmd.label.gamerule.*`（31 × 6 = **186 条**），表 2701 → **2732**；使用点 `CommandHelp.ts` 的 gamerule 下拉改为 `${gameRuleLabel(rule)}（${rule}）`
  - 为什么是真遗漏：那张表的注释写着"命令帮助的下拉用" —— 玩家在 `/help gamerule` 的候选列表里直接看到它，与 P6-1 修的 `DIFFICULTY_LABELS` / `GAME_MODE_LABELS` 完全同类（中文常量给界面用，绕过了语言表）
  - 术语照原版：`Inventar behalten` / `Kreaturen spawnen` / `Kreaturen zerstören Blöcke`、`Сохранять инвентарь` / `Разрушение блоков мобами`、`Conserver l’inventaire` / `Créatures qui cassent des blocs`、`Manter inventário` / `Criaturas quebrando blocos`；`doInsomnia` 用 `Schlaflosigkeit` / `Бессонница` / `Insomnie` / `Insônia`（幻翼失眠）
  - ⚠️ 改了 2 条既有断言（都是"标签搬走"的直接后果）：① `ui`「`/gamerule` 的帮助里列出了新规则」原来还检查 `Rules.ts` 里存在 `doImmediateRespawn: '立即重生'` 这个中文字面量 —— 改成只验默认值还在、且**不再**有那个字面量（标签是否翻好交给 `test:i18n`）；② `command-test`「每条规则都有中文名」改成「每条都有显示名且不是键名本身」
  - 新增 6 条断言：规则标签覆盖 31 条 + de/ru/fr/pt 各一条「不含中文、不露英文 id」+ 中文下仍是原说法（`死亡后保留物品` / `昼夜循环`）
  - 验证：五语言渲染 `keepInventory` → de `Inventar behalten` / ru `Сохранять инвентарь` / fr `Conserver l’inventaire` / pt `Manter inventário`；`test:i18n` **529 / 0**；`command-test` **435 / 0**；`ui` **926 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2732 条、0 缺口 / 0 孤儿
  - 批次：20261024-0223
- [x] [C4] 命令域剩余硬编码：`Commands.ts` 的 `/clone` `/fill` 回执与 `(空)`、`Selectors.ts` 的 14 条错误信息 → `cmdMessages.*`（约 28 条）
  - 做了什么：`Selectors.ts` 的 **14 条**选择器错误 + `Commands.ts` 的 **13 处**回执（`/clone` 的「已复制 N / M 格」「（masked：跳过 N 格）」、`(空)` 两处、授予/收回、execute 三条、scoreboard/队伍摘要四条）全部走 `cmd.error.selector.*` / `cmd.reply.*` —— 共 **30 条键 × 6 语言 = 180 条**，表 2732 → **2762**；两个文件里**再无硬编码中文**（只剩一行行尾注释）
  - ⚠️ 坑 1（会静默覆盖）：`cmd.reply.team.prefix` / `suffix` 这两个键**已经存在**（P4 法语批时加的，值是「前缀」/「后缀」两个字，用在 `msg(key, …)` 里）。我新写的是「，前缀「{prefix}」」（带前导逗号、给队伍摘要拼串用）→ `TS1117: duplicate property` 当场拦下。改成 `prefixAffix` / `suffixAffix` 两个新键，旧键保持不动
  - ⚠️ 坑 2（变量遮蔽）：`/time` 那段有 `const t = parseTime(args[1])`，把 i18n 的 `t` **遮蔽**了 → `t('cmd.reply.emptyValue')` 变成"调用 parseTime 的返回值"（可能为 null），`TS2721: Cannot invoke an object which is possibly null` 抓到。改用同文件里的本地辅助 `msg('cmd.reply.emptyValue')`（它本来就是"键 + 参数"的简写），语义更贴合
  - 新增 5 条断言：四语言各一条「命令错误与回执不含中文」（取样 6 条：选择器未知 / limit / 过滤参数缺等号 / clone 回执 / 队伍摘要 / execute 未知子命令）+ 中文下仍是原说法（`type 后面没有种类`）
  - 验证：`test:i18n` **534 / 0**；`command-test` **435 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2762 条、0 缺口 / 0 孤儿；`node .tmp/list-c4.mjs` 复查两个文件的中文只剩注释
  - 批次：20261024-0223
- [x] [C5] `loot.ts` 的 30 条结构名（`村庄小屋` 等）多语言 —— 先确认它在界面上是否可见，再决定键化还是保留
  - 侦察结论（先确认可见性）：`LOOT_TABLES[].name` **确实上界面** —— `CommandHelp.ts:426` 的 `/loot` 帮助下拉写的是 `${table.name}（${table.key}）`，与 C3 的 gamerule 下拉完全同一个模式；所以判为**真遗漏、要键化**，不是保留
  - 做了什么：22 条战利品表名（村庄小屋 / 废弃矿井 / 地牢 / 要塞图书馆与三个要塞点 / 两处沉船 / 林地府邸 / 末地城 / 两处堡垒遗迹 / 沙漠神殿 / 丛林神庙 / 女巫小屋 / 掠夺者前哨 / 雪屋 / 废弃传送门 / 埋藏的宝藏 / 下界要塞 / 海底废墟）→ `cmd.label.lootTable.*`（22 × 6 = **132 条**），表 2762 → **2784**；`CommandHelp` 的下拉改用 `t(...)`
  - ⚠️ 条目写的"30 条"实际是 **22 条**（`LOOT_TABLES` 就 22 张表）；另 8 条差额是我当初按 `loot.ts` 里中文字面量数量估的，含注释与函数名
  - 一个刻意的取舍：`loot.ts` 的 `name` 字段**保留**（数据字段，调试与 `tools/*-test.ts` 在用），只在注释里写明"界面走 `cmd.label.lootTable.*`"。把字段删掉会动 `LootTable` 接口与 22 条数据表，收益不抵风险；玩家可见处已经全部走语言表
  - 顺带核对了 `/structure` 那一支（担心同类问题）：它**已经在走** `cmd.label.structure.*`（多语言 P1-7 时改的），不是遗漏
  - 新增 5 条断言：de/ru/fr/pt 各一条「战利品表名不含中文、也不露键名」（22 条全量扫）+ 中文下仍是原说法（`村庄小屋`）
  - 验证：`test:i18n` **539 / 0**；`test:offline` **172 / 172 套全绿**；`audit:i18n` 2784 条、0 缺口 / 0 孤儿；`check.mjs --fast` 5 项全绿
  - 批次：20261024-0223

---

