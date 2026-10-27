# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

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

## 批次 20261027-1153 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1153

> 用户 2026-10-27：「继续」—— 接着做**阶段 2 的第一块**：状态栏四行（生命 / 饥饿 / 护甲 / 氧气）
> 与经验条。它们和快捷栏一样"每帧都在眼前"，而且**全是纯展示**（没有命中测试），
> 是整条底栏里最后两块 DOM。做完之后打开 `?ui2dtint=1`，屏幕底部会整排变黄。

- [x] [V1] 抽出图标真源 + `src/ui2d/Vitals2D.ts`：`vitalsArt.ts`（心/鸡腿/护甲/气泡的 SVG 路径与色值，`ui/VitalsHud.ts` 改成 import 它）；`Vitals2D` 用 Path2D 画四行、离屏快照、低血量脉冲按帧外挂变换 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`ui2d/vitalsArt.ts` 收下四条 SVG 路径 / 七个色值 / 两个三态判据（`vitalIconState`、`bubbleIconState`），`ui/VitalsHud.ts` 删掉本地常量改为 import（依赖方向 `ui/ → ui2d/`）。`ui2d/Vitals2D.ts` 用 `Path2D` 填同一份 `d`，半颗在 **9×9 坐标系**里裁 `rect(0,0,4.5,9)`；整块画进离屏快照（签名不含脉冲），低血量脉冲在 blit 时套 `1→1.06` 变换。
  - 为什么：图标两边都要画，路径抄两份必然漂，而"DOM 的心胖一点"没有任何断言抓得到；三态判据分家更糟（会出现一半整颗一半半颗）。脉冲写进签名就等于每帧重画 20 个图标、而它每秒一个来回（见决策 D7、D9）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **46 passed**（新增 6 条：三态 / 气泡分档 / 行内等距 / 包围盒 / 脉冲曲线 / 签名不含脉冲）。
  - 批次：20261027-1153

- [x] [V2] `src/ui2d/Xp2D.ts`：经验条（轨道 / 渐变填充 / 柔光）+ 等级牌（黑描边绿字，压在条中间），快照按 1% 取整 → 同上
  - 做了什么：轨道 `#14150f` 圆角 3 + 顶部暗线近似内阴影 + 外侧一圈淡黑边；填充 `#c2ff7a→#63c335` 竖向渐变、顶 1px 高光、右端 2px 柔光；等级牌宽 = 文字宽 + 10、高 18、圆角 4、半透明黑底，绿字四向黑描边。签名把进度**取整到 1%**。
  - 为什么：DOM 版自己就是 `Math.round(ratio*100)%`，canvas 按同一粒度重建才既跟得上又不会因浮点每帧重建。柔光只在快照里付一次（`shadowBlur` 在手机上是真开销）。
  - 验证：同上 46 条（其中 4 条打在这里：百分比取整/夹取、填充宽度、等级牌居中、签名 1% 粒度）。
  - 批次：20261027-1153

- [x] [V3] `src/main.ts` 接线 `?ui2d=1`：状态栏与经验条 DOM 让位（纯展示，用 `visibility: hidden`）、几何量 DOM、按 key 变脏才量 → `npm run check:fast && npm run build:fast`
  - 做了什么：`applyVitalsDomFallback()` 把 `#vitals` / `#xp-bar` 设 `visibility: hidden`（保留布局，canvas 才能量到随断点变化的 18/14/22px 图标）；`syncVitals2D(noVitals)` 每帧拼一个 key（生命/饥饿/氧气/护甲/等级/经验百分比/模式/`epoch`），变了才量 40 个 `svg.vital-icon` 与 `#xp-bar` 并喂给 `Hud2D`；resize 时 `vitals2dEpoch += 1` 强制重量。
  - 为什么：DOM 版内部本来就按 key 早退，但"每帧量 40 个 rect"是强制布局，必须挡在 key 后面；`epoch` 解决"数值没变、转屏后矩形变了"这件 key 看不见的事。`visibility` 而非 `opacity`：这两块没有命中测试，`visibility` 还能让浏览器跳过这层绘制（决策 D8）。
  - 验证：`npm run check:fast` 绿（46 条单测 + typecheck）；`npm run build:fast` 出包成功；`npx tsc --noEmit` 干净。⚠️ 真机观感未验（本会话没有浏览器进世界）。
  - 批次：20261027-1153

- [x] [V4] 预览页 `tools/preview/vitals.html` + `shoot-all.mjs` 补图，重拍 `.tmp/canvas-version/` 并更新其 README → `node tools/preview/shoot-all.mjs`
  - 做了什么：新页 `vitals.html` 用**真的** `VitalsHud` / `XpHud` 建 DOM（只为测量，设 `visibility: hidden`），再把矩形喂给 `Hud2D`，所以它走的与游戏里同一条路；参数 `?health&food&air&armor&level&xp&tint&pulse`。`SHOTS` 加 3 张（`09-vitals` / `09b-vitals-low` / `09c-vitals-tinted`），累计 14 张，README 的进度表与"URL → 看到什么"同步更新。
  - 为什么：截图是这一批的唯一"凭证"——用户上一轮的原话就是"截图发我"。顺带踩到一个真实的坑：预览页把 `MAX_AIR` 写成 30，而真值是 300（10 颗气泡、每颗 30 点），结果"氧气是否满""每颗几点"全算错；改成 import 真源后立刻对上了。
  - 验证：`node tools/preview/shoot-all.mjs` 14 张全出；逐张看过：13 点生命 = 6 整 + 1 半 + 3 空、17 饥饿 = 8 整 + 1 半 + 1 空、5 护甲 = 2 整 + 1 半、180/300 氧气 = 6 颗；残血版护甲/气泡两行整行不显示；遮罩版底部整块黄。
  - 批次：20261027-1153

- [x] [V5] 文档：`notes/canvas-ui.md` 加 §5.4（阶段 2 已落地部分与"哪些还没搬"）、决策 D7~D9 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段表把 2 标成 🟡（血条/饥饿/护甲/氧气/经验条 ✅，只剩提示条）；新增 §5.4（Path2D 与 9×9 裁剪、量 DOM 的理由、`visibility` vs `opacity`、脉冲不重建快照、断言清单、预览页与三张截图、以及"阶段 2 还剩什么"表）；决策 D7（图标真源上移）、D8（`visibility: hidden` 的适用边界）、D9（脉冲走变换）。
  - 为什么：这三条决策都不是"随手这么写"——尤其 D8，它和快捷栏的结论**相反**，不写清边界，下一个人会给快捷栏套 `visibility` 然后点不动。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1153

## 批次 20261027-1143 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1143

> 用户 2026-10-27：「现在看的还是不太清楚。要不然这样，如果是 canvas 画的，统一先加一层黄色遮罩，
> 这样就容易区分了。」—— 对，这是"改造进度"最省事的一种可视化：不靠肉眼比对像素，
> 而是让 canvas 产出的每一块像素自己"亮明身份"。

- [x] [U5] 加调试遮罩：`src/ui2d/debug.ts` 的 `applyDebugTint()`（`source-atop` 整层刷）+ `Hud2D.setDebugTint()` + `main.ts` 解析 `?ui2dtint=1` + 两个预览页支持 `?tint=1` → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：新增 `ui2d/debug.ts`（`applyDebugTint(ctx,w,h)`：`save` → `globalCompositeOperation='source-atop'` → 整块刷 `rgba(255,214,0,.52)` → `restore`）；`Hud2D` 加 `setDebugTint()`，在**所有绘制之后**刷遮罩；`main.ts` 把 `readUi2DFlag()` 拆成通用 `readFlag(name)`，新增 `UI2D_TINT_ENABLED = UI2D_ENABLED && readFlag('ui2dtint')`；两个预览页加 `?tint=1`。
  - 为什么：`source-atop` 让**合成器**替我们判断"哪些地方有像素" —— 不用维护"这一帧画了哪些矩形"的账，将来新增控件自动被覆盖。遮罩单独一个参数、不跟 `ui2d=1` 绑定：多一次全屏填充会让帧率 A/B 失真，颜色不对也容易被当成 bug（见决策 D5/D6）。
  - 验证：`tests/ui2d.test.ts` **36 passed**（新增 2 条：假 ctx 断言调用序列 = `save → op source-atop → fill → fillRect 0,0,w,h → restore`；尺寸非法时一笔不画）；`tsc` 干净；`npm run check` exit=0。
  - 批次：20261027-1143

- [x] [U6] `tools/preview/shoot-all.mjs` 补遮罩版截图并重拍全部；更新 `.tmp/canvas-version/README.md` 的进度表 → `node tools/preview/shoot-all.mjs`
  - 做了什么：`SHOTS` 加 4 张遮罩版（`06-hotbar-tinted`、`06b-hotbar-tinted-dom-vs-canvas`、`07-boss-tinted`、`08-all-tinted`），重拍共 11 张；README 的表格补上四行，并加一张"URL → 看到什么"的表（不带参数 / `?ui2d=1` / `?ui2d=1&ui2dtint=1` / 关掉）。
  - 为什么：用户要的是"一眼能判断实现到哪"，那截图里就必须有**同一份数据的染色/不染色对照** —— `06b` 那张（上排 DOM 不染色、下排 canvas 全黄）比任何文字说明都直接。
  - 验证：`node tools/preview/shoot-all.mjs --base http://localhost:5199` 11 张全出，逐张看过：快捷栏整条染黄、DOM 那排原色；Boss 条只有那条被染、周围画面原色；红闪那版整屏偏黄（符合预期，红闪本身就是全屏填充）。
  - 批次：20261027-1143

- [x] [U7] 文档：`notes/canvas-ui.md` 记下这个调试开关与用法；决策写进 `doing/9f2dcf-decision.md` D5/D6 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：`notes/canvas-ui.md` 新增 §5.3（实现一句话、为什么需要它、三条边界、以及"红闪打开时整屏都黄"这个反直觉现象）；决策 D5（`source-atop` 整层刷而非逐块算矩形）、D6（开关独立成 `ui2dtint=1`）。
  - 为什么：这个开关的价值不在代码而在**验收方式**——以后每迁一块界面，只要拍一张带遮罩的图就能说明"这块换了"，不必再靠肉眼比像素。不写下来，下一批会重新发明一遍。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过；`npm run check` exit=0。
  - 批次：20261027-1143

## 批次 20261027-1009 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1009

> 用户 2026-10-27：「你改的这几个地方都不太明显，看不出来效果如何。要不把快捷栏改一下？」
> 阶段 0 那三样（红闪 / Boss 条 / 破坏与进食进度）本来就是为了"不打扰任何人"才挑的纯展示 HUD，
> 结果也确实没人能看出差别。这一批换成**每帧都在眼前、9 格 + 图标 + 数量 + 耐久 + 选中框**的
> 快捷栏 —— 它才是"一眼就能对比出 DOM 与 canvas"的那块。

- [x] [U1] 新建 `src/ui2d/Hotbar2D.ts`：几何纯函数 + 状态签名 + 离屏快照；`tests/ui2d.test.ts` 加断言 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：新增 `ui2d/Hotbar2D.ts` —— 面板（`#c6c6c6` + 3px 斜面 + 2px 黑描边）、9 个格子（`#8b8b8b` + 2px 斜面）、图标 blit、数量（12px 四向描边）、序号（10px，选中时不透明）、耐久条（3px 三档）、选中格（白框 + 半透明白底 + 上抬 2px + 放大 1.08 + 柔光）；8 个几何纯函数（内容盒 / 图标居中 / 序号与数量锚点 / 耐久轨道与比例 / 选中矩形 / 快照原点）+ `hotbarSignature()`；`Hotbar2D` 类把整条栏画进一张离屏快照，签名不变时每帧只 `drawImage`。`Hud2D` 收下 `setHotbar()` 并最后画它（红闪在 DOM 里在它下面，不该给它上色）。`index.ts` 补导出。
  - 为什么：几何**不抄 CSS 常量**，输入是 `getBoundingClientRect()` 量出来的矩形 —— `--hotbar-slot` 跟断点走、底部还有 `env(safe-area-inset-bottom)`，抄一份常量就是埋一个"转屏错几像素"的回归面。快照缓存是因为 9 格每帧重画要付二十几次填充 + 十几次文字，而快捷栏的变化率极低（见决策 D1、D3）。图标不自己实现，沿用现成的 `.slot canvas`（`ui/ItemIcon` 是唯一入口，见 D4）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **34 passed**（新增 12 条）；`npx tsc --noEmit` 干净。
  - 批次：20261027-1009

- [x] [U2] `src/main.ts` 接线 `?ui2d=1`：DOM 快捷栏让位（保留布局与命中），pixels 全由 canvas 画；`?ui2d=0` 完全回退 → `npm run check:fast && npm run build:fast`
  - 做了什么：`refreshHotbar()` 末尾只做两件事——`hotbar2dRevision += 1` 与置脏（**不量 DOM**：它被十几个事件路径调用，量 10 个 `getBoundingClientRect()` 每次都会强制布局）；真正测量与喂状态在每帧的 `updateHotbar2D()` 里，一帧最多一次。`applyHotbar2DDomFallback()` 把 `#hotbar` 的底/斜角/描边设成透明（**边框宽度保留**，否则两侧背包按钮位移 3px），9 个 `.slot` 设 `opacity: 0`。`#hotbar` 被 `visibility: hidden` 藏起来时（打开携带版背包）每 8 帧复查一次。
  - 为什么：**命中继续借 DOM**（见决策 D2）。覆盖层的 `pointer-events` 是元素级、铺满全屏，打开就吃掉 `#touch-look` 的视角手势；而 `visibility: hidden` / `display: none` 会让格子退出命中，连 `bindHotbarTouch` 与长按看物品一起失效 —— 所以只能用 `opacity: 0`。
  - 验证：`npm run check:fast` 绿（655 条单测）；`npm run check` 全量 **exit=0**（181 套离线 + 三张台账 + 文档体量）；`npm run build:fast` 出包成功；`npx tsc --noEmit` 干净。⚠️ **真机观感未验**：本会话没有浏览器，dev 模式下 `__host/core.bin` 缺失会停在落地页 —— A/B 步骤写在 `notes/canvas-ui.md` 的 §5.1。
  - 批次：20261027-1009

- [x] [U4] 加 `tools/preview/hotbar.html` 对照页：不用进世界就能把 DOM 版与 canvas 版摆在一起看；顺手把数量字重对齐 CSS → `node tools/screenshot.mjs --url http://localhost:5173/tools/preview/hotbar.html --out hotbar-preview.png`
  - 做了什么：一页 HTML —— 上半是照抄 `index.html` 那几条 CSS 的 DOM 版，下半是 `Hotbar2D` 画进 canvas 的版本，同一份假数据（空槽 / 数量 / 选中格 / 黄耐久 / 红耐久）。几何照样用 `getBoundingClientRect()` 量 DOM 再喂给 canvas，与 `main.ts` 走同一条路。数量字号原来是 700，改成跟 CSS 一致（`.count` 没写 `font-weight`）——迁移期两边并存，字重不同在 A/B 里就是"像素不一致"。
  - 为什么：用户说的"看不出来效果"有一部分是**验收成本**问题 —— `?ui2d=1` 得先能进世界才看得到，而 dev 缺 `__host/core.bin` 会停在落地页。有了这一页，"画得对不对"不再被"能不能进世界"卡住；阶段 1 的控件库、阶段 2 的血条也能往这里加。
  - 验证：`npx vite --port 5199` + `node tools/screenshot.mjs --url .../tools/preview/hotbar.html --out hotbar-preview.png` → 截图已存 `.tmp/shots/hotbar-preview.png`，逐项对照两排：格子尺寸/斜面、图标位置、数量与序号锚点、耐久条位置与长度、选中格的白色边框与上抬都对得上（唯一剩下的差异是文字抗锯齿）。⚠️ 页面自带 1 条 `console.error`：favicon 404，与页面无关。
  - 批次：20261027-1009

- [x] [U3] 更新 `.continue/notes/canvas-ui.md`：把"阶段 1.5 快捷栏"的判据、命中仍借 DOM 的理由、A/B 步骤写进去 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：阶段表加 `1.5 快捷栏 ✅` 一行；新增 §5.1（做法 + 四条 A/B 步骤 + "这一版不能用来量省了多少 DOM 开销"的警告）与 §5.2（复盘阶段 0 为什么证明不了任何东西：三样都低频、都在屏幕边缘，选样品的判据从"最不打扰"改成"最容易对比"）；§6 判定表补一行"快捷栏的点击/长按：画在 canvas、命中仍走 DOM"。
  - 为什么：这次的教训是**选样品的方式**，不是某个函数写错了。不写下来，下一批还会有人挑"最安全的三样"去证明"改造值不值"。
  - 验证：`npm run check` exit=0（`audit:docs` 与文档体量检查都在里面）；决策写在 `doing/9f2dcf-decision.md` D1~D4。
  - 批次：20261027-1009

