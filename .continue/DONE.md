# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261027-1319 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1319

> 用户 2026-10-27：「继续继续」—— 把上一批那条「原位重画」的路子用到**剩下的纯展示 HUD**上：
> 状态效果胶囊（`#effects-hud`）与聊天消息列表（`.chat-log`）。
> 这两块本来就要重排一遍才好看，但它们的版式（胶囊/分行）已经在 CSS 里写好了，
> 直接原位重画既省事又不会漂。

- [x] [E1] `src/main.ts`：`#effects-hud` 与 `.chat-log` 纳入纯文字面板（让位 + 每帧签名同步）→ `npm run check:fast`
  - 做了什么：`applyTextPanelsDomFallback()` 加上 `#effects-hud`，并**只藏 `.chat-log`**（输入行/提示/发送键仍是 DOM —— 那是阶段 3 输入法那一摊）；`syncTextPanels2d()` 把这两块一起纳入"文字内容 + 视口"签名与读取，根节点列表化（`roots[]` 逐个 `readTextRuns` + `readTextBlocks`）。
  - 为什么：聊天**不能整块藏**——`#chat` 里还挂着输入行，一藏就把打字界面也藏了（与快捷栏"容器不能整体透明"同一个道理）。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。
  - 批次：20261027-1319

- [x] [E2] `src/ui2d/textPanel.ts`：渐变底的近似（状态效果胶囊的 `--hud-bg` 是 `linear-gradient`，`backgroundColor` 是透明的）→ 预览页 + 截图
  - 做了什么：`hasBackground()` 在 `backgroundColor` 透明但 `backgroundImage !== 'none'` 时，退化成一块半透明深色 `HUD_GRADIENT_FALLBACK = rgba(16,17,21,.66)`；预览页 `textpanels.html` 加状态效果胶囊（3 个，好/坏两种边框）与聊天 4 行（系统黄 / 普通白 / 提示蓝 / 报错红），两张截图重拍。
  - 为什么：不退化的话这三个胶囊会**完全没有底**，白字直接压在世界画面上（截图里一眼就看出来）。复刻整条 CSS 渐变要解析 `linear-gradient(...)` 字符串，只为"上下差 2% 亮度"，不值得（决策 D22）。
  - 验证：`node tools/preview/shoot-all.mjs` 31 张全出；截图看过：三个胶囊有底、边框分好坏、文字不溢出；聊天四行颜色分别对（黄/白/蓝/红）。
  - 批次：20261027-1319

- [x] [E3] 文档：`notes/canvas-ui.md` §5.12 + 决策 D22 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.12 记下"纯展示 HUD 到此清零"、渐变底的近似，以及聊天只藏消息列表的理由；决策 D22（渐变底退化成半透明深色）。
  - 为什么：这是"纯展示 HUD 全部搬完"的收口，得写清**还剩什么**（聊天输入行、效果色点这类 pseudo 元素），否则下一批会以为还有活。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1319


## 批次 20261027-1307 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1307

> 用户 2026-10-27：「继续」—— 接着做**纯文字 HUD**：F3 调试信息与计分板侧边栏。
> 这两块没有控件、没有命中测试，内容就是"一块底 + 几行字"，正好试一条新路子：
> **不重排、按原位重画** —— 把 DOM 里直接带文字的元素连矩形/颜色/字号一起读出来画。

- [x] [P1] `src/ui2d/textPanel.ts`：`readTextRuns` / `readTextBlocks` / `drawTextRuns` / `drawTextBlocks` + 归一化字号与签名 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：读 DOM 里**直接带文字**的元素（叶子）→ 「矩形 + 文本 + 计算样式的颜色/字号/字重/对齐 + 有无阴影」；另外单独读"有色底"的元素（F3 的 `.35`、计分板的 `.45`）连同圆角。绘制时先画底块再按行画字（多行文本按 `\n` 拆开、行高 1.35 倍字号、竖直居中）。
  - 为什么：F3 那串文案是**拼出来的多行字符串**，计分板是"名字左、分数右"的 flex 行 —— 重排一遍就要把格式与对齐规则各抄一份；颜色字号还会随夜间/低血量/断点变（`ui2d/textPanel.ts` 顶部三条理由）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **60 passed**（新增 3 条：字重归一、基线、签名稳定性）；`tsc` 干净。
  - 批次：20261027-1307

- [x] [P2] `src/main.ts` 接线：`#debug` 与 `#scoreboard-hud` 让位，`syncTextPanels2d()` 按"文字内容 + 视口"签名决定要不要重读 → `npm run check:fast`
  - 做了什么：`applyTextPanelsDomFallback()` 把两块设 `visibility: hidden`（保留布局：F3 的换行、计分板两列对齐都要靠 DOM 量）；`syncTextPanels2d()` 每帧拼一个"文字内容 + 视口尺寸"的签名，**没变就不碰 `getComputedStyle`**（那是会触发样式重算的调用），变了才 `readTextRuns` + `readTextBlocks` 喂给 `Hud2D.setTextPanels`；`Hud2D` 在最上层画（先底色块再文字），resize 时把签名清空。
  - 为什么：F3 开着时每帧都变（帧率/坐标），那是它本来就该重画；**关着时一次都不读** —— 默认 F3 是关的，所以常态零成本。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测。
  - 批次：20261027-1307

- [x] [P3] 预览页 `tools/preview/textpanels.html`（真 DOM 当数据源）+ `shoot-all` 补图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：按 `index.html` 的 `#debug` / `.scoreboard-hud` CSS 建真 DOM（`visibility: hidden`），读 runs + blocks 后原位重画；两张截图（含遮罩版），`shoot-all` 累计 31 张。
  - 为什么：这一路线的卖点是"原位重画"，那就必须能一眼看出**位置/颜色/对齐都与 DOM 一致**——截图里 F3 五行等宽、计分板分数右对齐且是黄色（`#ffd75e` 来自计算样式）。
  - 验证：截图看过：F3 块左上带半透明底、计分板右上带圆角底，名字左/分数右、分数黄色；遮罩版两块都是黄的。
  - 批次：20261027-1307

- [x] [P4] 文档：`notes/canvas-ui.md` §5.11 + 决策 D21 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.11 记下"原位重画"这条路线的三条理由与代价（`getComputedStyle` 的门禁）；决策 D21（纯文字面板按原位重画，不重排版）。
  - 为什么：这是本项目**第一次**"不重排、只重画"的迁移，与前面"画法全部自己实现"的路线不同 —— 不写清楚，下一块（聊天栏 / 状态效果）会重新纠结用哪条路。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1307


## 批次 20261027-1258 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1258

> 用户 2026-10-27：「继续继续」—— 往**设置页**走一步。
> 这一批只做"能不能画对、点得着"：把 `.settings-row` 读成模型、用控件库画出来、
> 交互写回 DOM 控件（`click()` / 写 `value` 再派发事件），并在预览页用**真实 DOM 行**验证。
> ⚠️ **游戏里还没接线**（`?ui2d=1` 时设置页仍是 DOM）：接线要先把暂停菜单那套
> `engaged` 机制泛化成"菜单/设置两态"，混在一起改容易把上一批刚通的 Esc 弄坏。

- [x] [W1] `src/ui2d/form.ts`：`readFormRows()`（DOM → 模型）+ 行/控件几何纯函数 + `drawFormRow` + `writeRangeRatio` → `npx vitest run tests/ui2d-form.test.ts`
  - 做了什么：`form.ts`（约 210 行）—— `readFormRows(host)` 扫 `.settings-row`：有 `.settings-switch` → `switch`（读 `aria-checked`/`.on`）、有 `input[type=range]` → `range`（按 min/max 算 0~1）、有 `.settings-cycle` → `cycle`（`textContent` 当值）；`formRowRects` / `formContentHeight` / `formControlRect` / `formRatioFromX` / `drawFormRow` / `writeRangeRatio`（写 `value` + 派发 `input`/`change`，让原有设置逻辑照常跑）。
  - 为什么：与暂停菜单同一条思路（D18）——**DOM 是唯一真源**，这里不定义"有哪些设置项、什么范围、什么文案"，只负责画与转发；否则设置项一改，两套表必漂。
  - 验证：`tests/ui2d-form.test.ts` **4 passed**（行距、内容高、控件右贴边与小行收窄、滑杆比例的 0/0.5/1 与 NaN）；`tsc` 干净。
  - 批次：20261027-1258

- [x] [W2] `tools/preview/form.html`：用**隐藏的真实 DOM 行**当数据源（开关 / 循环按钮 / 滑杆），画出并支持点/拖/滚/键盘；`shoot-all` 补图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：页面里先建 13 行真的 `.settings-row`（`.settings-switch` / `.settings-cycle` / `input[type=range]`，开关点击会翻转、循环按钮点击会换值），`readFormRows()` 读成模型后画到 canvas；点开关/循环按钮 = `element.click()`、拖滑杆 = `writeRangeRatio()`，每次交互后**重新读模型重画**。加 `?tint=1`；`shoot-all` 累计 29 张。
  - 为什么：读取与写回靠 DOM，光看代码不算验证——这一页把"隐藏 DOM 当数据源"那条路真的跑通了（截图中四行开关/三行循环/三行滑杆的值都来自那些 DOM 元素）。
  - 验证：`node tools/preview/shoot-all.mjs` 29 张全出；截图 `15-settings-form.png` 里页签、开关（绿）、循环按钮（关闭/第一人称）、滑杆（读数 8 / 60 / 50 在轨道左侧）都对；`15b` 是遮罩版。
  - 批次：20261027-1258

- [x] [W3] 游戏里接线：`syncPauseCanvas2d()` 统一管"菜单 / 设置"两态（DOM 让位、遮罩、HUD、`pointer-events`、键盘路由），设置页滚轮与页签点击走 `form.ts` 的模型 → `npm run check && npm run build:fast`
  - 做了什么：把上一批的 `syncPauseMenu2d()` 泛化成 `syncPauseCanvas2d()`——每帧算一个模式（`null` / `'menu'` / `'settings'`），模式变了先 `teardownPauseCanvas2d()` 逐项还原、再按模式建状态。菜单页仍是 `CanvasMenu`（行来自 DOM 按钮）；设置页新增 `buildSettings2d()` / `refreshSettings2d()` / `renderSettings2d()`（标题栏 + 页签 + 行 + 滚动条）与 `handleSettingsPointer()` / `handleSettingsKey()`。键盘分两态路由（设置页自己吃 ↑↓/Enter/空格/Esc，并把焦点行滚进视口）；指针加了 `pointermove` / `pointerup`（滑杆要按下拖动）与 `wheel`（滚列表）。
  - 为什么：两种页面**共用一个覆盖层、一批 DOM 让位/还原**，所以必须由同一个地方决定"现在是谁在接管"——放在别处就会出现"菜单收了、设置页没接上"这种半状态。还原判据继续用 `pauseCanvasMode`（D17），不用 `menu.isOpen`。
  - 验证：`npx tsc --noEmit` 干净；`npm run check` 全量通过；`npm run build:fast` 出包。⚠️ **游戏内仍未实测**（dev 缺 `__host/core.bin` 只能停在落地页）：设置页的"读 DOM → 画 → 写回"链路在 `tools/preview/form.html` 里跑通过（同一份 `form.ts`），但 `main.ts` 这段接线只有类型检查与静态推演。
  - 批次：20261027-1258


## 批次 20261027-1235 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1235

> 用户 2026-10-27：「继续继续继续继续」—— 把上一批做好的**输入通道接进游戏**：
> `?ui2d=1` 时 Esc 唤出的暂停菜单页由 canvas 画、canvas 收输入。
> 关键取舍：**不给每个按钮重写动作**，而是把 DOM 里那排按钮的 `textContent` 当标签、
> `click()` 当动作 —— 文案（6 种语言）、条件显隐（联机按钮只在房里出现）、
> 删除世界的二次确认全都自动继承，一条都不用抄。

- [x] [Z1] `src/main.ts`：`syncPauseMenu2d()` 跟着 `settingsScreen.isOpen/page` 进出，DOM 面板让位（`visibility: hidden`）、HUD 让位、遮罩与面板都由 canvas 画 → `npm run check:fast`
  - 做了什么：新增 `syncPauseMenu2d()`（每帧一次边沿检测：面板开着且 `page === 'menu'` 就接管）与 `renderPauseMenu2d()`（canvas 自己画 45% 遮罩 + 面板）；让位三处 —— `.settings-panel` 设 `visibility: hidden`（不能用 `display`，会打乱它自己 130ms 的淡出时序）、`#settings-screen` 的遮罩背景改 `transparent`（它排在 canvas 之上，不透明会把面板一起压暗）、`#hud` 设 `visibility: hidden`（body 级定位元素，不藏就压在 canvas 上）。退出时逐项还原。
  - 为什么：三种转换（打开 / 从设置子页退回 / 关掉）都从这一处进出，就不必在 `SettingsScreen` 里埋钩子——埋了会分成两套时序。**还原判据用独立的 `pause2dEngaged` 而不是 `menu.isOpen`**（决策 D17）：激活时要先 `close()` 再点按钮，那时 `isOpen` 已经 false，用它当判据会漏还原（第一版就这么错，症状是"退出暂停后 HUD 永久消失"）。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。
  - 批次：20261027-1235

- [x] [Z2] 输入路由：Esc / ↑↓ / Home·End / Enter·空格 走 `CanvasMenu`，指针点击走 `handlePointer`，激活 = `button.click()`；关掉时恢复原样 → `npm run check && npm run build:fast`
  - 做了什么：keydown 监听开头加一段"菜单开着时整段键盘归它"（认 ↑↓/Home/End/Enter/空格/Esc，其余键 `preventDefault` 后 return）；覆盖层 canvas 上绑 `pointerdown`（平时 `pointer-events: none`，只有菜单打开时由 `syncPauseMenu2d` 打开），点击走 `handlePointer` → `dispatchPauseMenu`。激活时先 `menu.close()` 再 `button.click()`（按钮可能切页签或直接关面板），随后立刻 `syncPauseMenu2d()` 完成还原。
  - 为什么：菜单开着时按 W 不该让角色在面板后面走——DOM 版靠浏览器焦点挡住了这一层，canvas 版必须自己挡（`preventDefault` + return）。
  - 验证：`npm run check` 全量（含 181 套离线）通过；`npm run build:fast` 出包成功；`tsc` 干净。⚠️ **真机/浏览器没在游戏里跑过**：dev 模式缺 `__host/core.bin` 只能停在落地页，所以"Esc 打开→点设置→退回→再 Esc 关掉"这条链只有静态推演 + 预览页验证。
  - 批次：20261027-1235

- [x] [Z3] 预览页补一张"游戏里那一版"的对照（同一份 DOM 按钮 → canvas 行），`shoot-all` 补图并重拍 → `node tools/preview/shoot-all.mjs`
  - 做了什么：`menu.html` 加 `?from=dom`：真的建出四颗 `<button>`（标签走 `t('pause.resume')` 等真实 i18n 键），再把它们的 `textContent` 喂给 `CanvasMenu`，激活时 `button.click()` —— 与 `main.ts` 完全同一条路。截图 `14-pause-dom-driven.png`；`shoot-all` 累计 27 张。
  - 为什么：接线里最容易错的是"行与按钮的对应关系"，而这条关系在预览页里能一眼看出来（截图里四行就是真实那四颗按钮的文案）。
  - 验证：`node tools/preview/shoot-all.mjs` 27 张全出；截图里四行分别是「继续游戏 / 设置 / 统计 / 保存并退出到主菜单」——正是 `SettingsScreen` 菜单页当前那四颗（成就那颗已在批次 20261024-1152 删除，多人那颗单机时不显示）。
  - 批次：20261027-1235

- [x] [Z4] 文档：`notes/canvas-ui.md` 阶段 3 前进一格（暂停菜单已接线）、决策 D17/D18 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段 3 标 🟡（暂停菜单页 ✅，其余未开始）；新增 §5.9（边沿检测、不重写动作的代码骨架、三处让位的表、"还原判据不能用 isOpen"的警告、键盘整段接管）；决策 D17（独立标志）、D18（行来自 DOM）。
  - 为什么：D18 是这一批的核心取舍，也解释了一个反直觉的结论——"canvas 菜单的能力上限 = DOM 面板现有按钮"，这被当成优点写下来（避免两套 UI 各自长功能）。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿；`npm run check` 通过（TASKS 台账随收尾补齐）。
  - 批次：20261027-1235


## 批次 20261027-1226 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1226

> 用户 2026-10-27：「继续继续」—— 两件事：① 把**阶段 2 的最后一样**（指南针 / 时钟表盘）收掉，
> 阶段 2 就此完整；② 做**阶段 3 的前置**：canvas 面板的**输入通道**（焦点行 / 上下键 / 回车 /
> Esc / 指针点击），并在预览页里用它拼出一个能用的暂停菜单。
> ⚠️ 这一批**不动游戏里的暂停流程**：真正的接线（把 DOM 面板藏起来、canvas 接管输入）
> 单独一批做，因为那里一旦接错就是"Esc 打不开 / 关不掉"。

- [x] [Y1] `src/ui2d/ToolDial2D.ts`：表盘（圆 + 铜边 / 白边）+ 四个方位刻度 + 旋转指针 + 读数文字，`dialNeedlePoints` 等纯函数 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`ToolDial2D.ts`（约 210 行）—— 52×52 圆盘（径向渐变 + 铜色/铁蓝边框）、N/E/S/W 四个方位字母（只有指南针画）、上红下白的三角指针（时钟是一根细白针）、表盘下方一行 10px 读数；纯函数 `dialCenter` / `dialNeedlePoints`（按角度算三角三顶点）/ `dialTickAnchors` / `dialBorderColor`。
  - 为什么：**指针不用 `ctx.rotate` 而是算顶点**（决策 D15）—— 用 rotate 的话"指向哪"藏在变换栈里，没法离线断言；而顺/逆时针搞反在触摸端几乎发现不了。刻度锚点同理（随盘面尺寸变）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **57 passed**（本批 +6：圆心、0/90/180/270 尖端、底边对称、非法角度按 0°、四个刻度在盘内、两种边框色不同）；`tsc` 干净。
  - 批次：20261027-1226

- [x] [Y2] `src/ui2d/menu.ts`：`CanvasMenu` 输入通道（焦点行、`ArrowUp/Down/Home/End`、`Enter/Space` 激活、`Esc` 关闭、指针命中），纯状态机 + 绘制 → `npx vitest run tests/ui2d-menu.test.ts`
  - 做了什么：`menu.ts`（约 240 行）—— `menuPanelSize` / `menuRowRects` / `menuFocusAfterKey`（上下循环、Home/End、越界夹回）+ `CanvasMenu` 类（`open/close/isOpen/focus`、`handleKey`、`handlePointer`、`regions()`、`render()`）；面板复用 `drawModalFrame`，焦点行用按钮 hover 态 + 左侧 ▶，底部一行操作提示。
  - 为什么：**只返回"意图"不含游戏动作**（决策 D16）—— 写进动作就得 import 存档/网络/世界列表，这一层立刻变第二份真相，也没法在预览页里跑；"打开时游戏该不该暂停/还收不收其它键"同样留在主循环（否则重演"暂停时角色还在走"）。
  - 验证：新建 `tests/ui2d-menu.test.ts` → **14 passed**（布局随行数增高、行等距居中、焦点循环与 Home/End、未打开时不理输入、Enter/空格激活返回 id、Esc 关闭、点行激活并移焦点、点外面关闭可关掉、`regions()` 的 id 与层号）；`tsc` 干净。
  - 批次：20261027-1226

- [x] [Y3] 预览页 `tools/preview/menu.html`（整页暂停菜单，键盘可操作）、`tools/preview/dial.html`（指南针/时钟）；`shoot-all` 补图并重拍 → `node tools/preview/shoot-all.mjs`
  - 做了什么：`dial.html`（两块表盘并排、`?deg=&kind=&tint=1`）、`menu.html`（整页暂停菜单：↑↓ 移动焦点、Enter 激活、Esc 关、点行激活、点面板外关闭，底部一行实时显示"焦点/激活了什么"）；`SHOTS` 加 4 张（`12-tool-dial` / `12b-dial-tinted` / `13-menu` / `13b-menu-tinted`），累计 26 张；`.tmp/canvas-version/README.md` 同步。
  - 为什么：输入通道的正确性一半在断言里（14 条），另一半只能在**能按**的页面上验——键盘导航尤其如此，触摸端完全测不到。
  - 验证：`node tools/preview/shoot-all.mjs` 26 张全出；逐张看过：两块表盘（时钟蓝盘细针 210°、指南针米色盘红白针 45° + N/E/S/W）、暂停菜单四行 + 焦点 ▶ + 遮罩 + 底部提示。
  - 批次：20261027-1226

- [x] [Y4] 文档：`notes/canvas-ui.md` 阶段 2 标 ✅、新增 §5.7（表盘）与 §5.8（输入通道契约）、决策 D15/D16 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段 2 整行改 ✅（只剩准星判定不搬）；新增 §5.7（表盘两处自己算的东西）与 §5.8（"浏览器给的 vs 要自己做的"对照表 + 三条边界 + 明确写了"这一批没有接线"）；决策 D15（指针算顶点）、D16（只返回意图）。
  - 为什么：§5.8 那三条边界里，"Esc 一律先关菜单、调用方不要再判一遍"是最容易在接线时写错的——写下来才能防止"按一次 Esc 关两层"。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1226


## 批次 20261027-1218 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1218

> 用户 2026-10-27：「继续继续继续」—— 把**阶段 2 的最后一块**（提示条族）收掉：
> 目标名、攻击蓄力条、切槽时浮出的物品名。三样都是纯展示、都不吃事件，
> 做完之后「底部 HUD + 准星周围的东西」就全是 canvas 的了。

- [x] [X1] `src/ui2d/overlays.ts`：三样提示条的画法 + 纯函数（`attackChargeRect` / `attackChargePercent` / `itemNameAlpha`），`Hud2D.setTips()` 统一收口 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`overlays.ts`（约 200 行）—— `drawTargetLabel` / `drawAttackCharge` / `drawItemNamePop` / `drawTips` + `attackChargeRect`（44×3、准星下 16px）/ `attackChargePercent`（量化到 2%，与 DOM 版同口径）/ `itemNameAlpha`（350ms 淡入 → 保持 2000ms → 350ms 淡出）；`Hud2D.setTips()` 在**所有绘制之后**画（提示条在原 DOM 里就是最上面那层）。
  - 为什么：**不做快照缓存**（决策 D13）—— 三样加起来每帧就两次 `fillText` + 一块 44×3 小矩形，为它维护签名比直画还贵；缓存是按量级决定的，不是按"要不要优化"。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **51 passed**（本批 +5）；`npx tsc --noEmit` 干净。
  - 批次：20261027-1218

- [x] [X2] `src/main.ts` 接线 `?ui2d=1`：三样 DOM 让位（`visibility: hidden`），矩形仍从 DOM 量（文本长度/触摸 pinned 位置都在 CSS 里），alpha 按时间算 → `npm run check:fast && npm run build:fast`
  - 做了什么：`applyTipsDomFallback()` 把 `#target-info` / `#attack-cooldown` / `#selected-item-name` 设 `visibility: hidden`（保留布局，canvas 才能量到"随文本变宽、触摸时被 JS 挪位"的矩形）；`syncTips2D()` 每帧喂状态——目标名与物品名**只在文本/锚点/视口变时量 DOM**，蓄力条的几何直接由 `attackChargeRect(overlay.width, overlay.height)` 算；`showSelectedItemName()` 里记 `itemNameShownAt`，淡化交给 `itemNameAlpha`；resize 时 `tips2dEpoch += 1`。
  - 为什么：物品名的淡出 canvas 里没有 transition，要么按时间算要么每帧 `getComputedStyle`（更贵且不可断言）；按时间算还顺带解决了"暂停时不淡"（决策 D14）。
  - 验证：`npm run check:fast` 绿；`npm run check` exit=0；`npm run build:fast` 出包；`tsc` 干净。⚠️ 真机观感未验。
  - 批次：20261027-1218

- [x] [X3] 预览页 `tools/preview/tips.html` + `shoot-all` 补图，重拍 `.tmp/canvas-version/` 并更新 README → `node tools/preview/shoot-all.mjs`
  - 做了什么：`tips.html` 按 `index.html` 那几条 CSS 建真 DOM（`visibility: hidden`）只为测量，再把矩形喂给 `Hud2D.setTips()`；参数 `?target=&item=&charge=&age=&tint=1`。`SHOTS` 加 3 张（`11-tips` / `11b-tips-fade` / `11c-tips-tinted`），累计 22 张；`.tmp/canvas-version/README.md` 的进度表与 URL 表同步。
  - 为什么：提示条是"一闪而过"的东西（物品名 2 秒、蓄力条不到 1 秒），截图必须能把状态定住；`age=2175` 那张专门展示"淡出到一半"。
  - 验证：`node tools/preview/shoot-all.mjs` 22 张全出；逐张看过：目标名贴在准星下方、蓄力条 44px 在它上面不远、物品名胶囊在快捷栏上方；`charge=100` 那版条确实消失；`age=2175` 那版半透明。
  - 批次：20261027-1218

- [x] [X4] 文档：`notes/canvas-ui.md` §5.6（阶段 2 收尾 + 还剩表盘）、决策 D13/D14 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段 2 行改成"只剩指南针·时钟表盘"；新增 §5.6（三处与前面不同的做法 + "阶段 2 还剩什么"表）；决策 D13（不做快照缓存）、D14（淡出按时间算）。
  - 为什么：D13 容易被误解成"偷懒"——所以写清了判据是**量级**；D14 的代价（低帧率跳格）也写在正面，免得以后有人当成 bug 去修。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1218

## 批次 20261027-1209 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1209

> 用户 2026-10-27：「继续继续」—— 接着做**阶段 1：控件库**。
> 这是"整页搬走"的前提：设置页 / 主菜单 / 背包里的每一个交互，拆开都是这几个控件
> （开关、滑块、下拉、页签、滚动列表、提示框、弹窗）。控件库一天，整页才有资格谈。

- [x] [W1] `src/ui2d/controls.ts`：七个控件的**画法 + 纯状态机**（开关 / 滑块 / 下拉 / 页签 / 滚动列表 / 提示框 / 弹窗），几何与命中全部做成可断言的纯函数 → `npx vitest run tests/ui2d-controls.test.ts`
  - 做了什么：`controls.ts`（约 470 行）—— 七个 `draw*` + 一组纯函数：`toggleNext`、`sliderTrackRange`/`sliderRatioFromX`/`sliderRatioStep`、`dropdownMenuRect`/`dropdownIndexAt`、`tabRects`/`tabIndexAt`、`listMaxScroll`/`clampListScroll`/`listScrollByWheel`/`listVisibleRange`、`tooltipRect`、`modalRect`；另有 `controlRegion`（矩形登记命中）与 `insetRect`。色值延续 `PALETTE`，新增 `CONTROL_COLORS` / `MODAL_COLORS`。
  - 为什么：**状态留在调用方、控件只给画法与状态机**（决策 D10）。canvas 没有"元素自己记得自己开着没有"，混在一起就会长出第二份真相（DOM 那套 `class` 正是如此）；而纯函数能离线断言，绘制不能。
  - 验证：`npx tsc --noEmit` 干净；`npx vitest run tests/ui2d-controls.test.ts` → **21 passed**。
  - 批次：20261027-1209

- [x] [W2] `tests/ui2d-controls.test.ts`：每个控件"命中 → 状态 → 回调"的离线断言（滑块的 0/0.5/1、下拉的翻转与越界、列表的滚动夹取、提示框防溢出）→ `npm run test:unit`
  - 做了什么：21 条断言，分七组：控件命中区域（矩形 + 开区间边界）、开关翻转、滑块（可拖范围两端各留半钮 / 0-0.5-1 / 越界与 NaN / 键盘步进同一夹取）、下拉（默认向下 / 下方放不下翻上 / 上下都放不下选空间大的那侧 / 菜单项越界 -1）、页签（等分 / 左闭右开 / 最右边界算最后一个）、列表（内容高 / 最大滚动 / 夹取 / 滚轮按整行含"恰好半行向上取整" / 可见范围首尾）、提示框（下方 / 翻上 / 左右夹进视口）、弹窗（居中 / 小屏夹进视口）。
  - 为什么：这些错每一条都只表现为"手感不对"或"偶尔点不到"，真机上间歇出现、手指复现不出来 —— 只有纯函数断言能钉住。
  - 验证：`npm run test:unit` 绿（新增文件被 `vitest run tests` 自动收进去，不需要注册）。
  - 批次：20261027-1209

- [x] [W3] `tools/preview/controls.html`：把七个控件摆一排并能真的点/拖/滚（canvas 直接接指针事件），加 `?tint=1`；`shoot-all.mjs` 补图并重拍 `.tmp/canvas-version/` → `node tools/preview/shoot-all.mjs`
  - 做了什么：一页 900×560 的可交互画廊 —— 开关两枚、滑块（按住拖）、下拉（点开选中）、三页签、20 行滚动列表（滚轮 + 点行选中 + 右侧滚动条）、"?" 悬停提示框、"打开弹窗"（不透明深色面板 + 标题栏 + ✕ + Esc）。命中一律走 `hitRegionAt(regions(), x, y)`，就是将来设置页要用的那条路。`?state=dropdown|tooltip|modal` 把浮层固定打开（截图用），`?tint=1` 加遮罩。`shoot-all` 加 5 张，累计 19 张。
  - 为什么：阶段 1 的判据就是"能在调试面板里摆一排"；而且**交互只能靠手**验，截图不行 —— 所以这一页刻意打开 `pointer-events`（游戏里铺满全屏的覆盖层必须关着，否则吃掉视角手势）。
  - 验证：`node tools/preview/shoot-all.mjs` 19 张全出；逐张看过：下拉展开贴字段下方、已选项高亮；列表滚到 03~14 且滚动条在中段；提示框贴 "?" 下方两行；弹窗不透出底下列表；遮罩版整页黄。
  - 批次：20261027-1209

- [x] [W4] 文档：`notes/canvas-ui.md` 阶段表把 1 标成 ✅、新增 §5.5（七个控件的接口与"为什么状态留在调用方"）、决策 D10~D12 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段表补回 `1 控件库 ✅` 一行（上一批那次表格编辑把它整行替换掉了，这次顺手补回来）；新增 §5.5（七行接口表 + 三条经验：状态留调用方 / 翻转与避让必须自己算 / 弹窗要不透明）；决策 D10（画法与状态机分离）、D11（下拉与提示框自己避让）、D12（弹窗不复用 HUD 底板）。
  - 为什么：D12 是这一批唯一"踩到才改"的一条 —— 第一版弹窗用半透明 HUD 底板，截图里底下列表的字全透上来，像字叠字。不写下来，下一个人做设置页还会再踩一次。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1209

