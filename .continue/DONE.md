# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261027-1618 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1618

> 用户 2026-10-27：「继续实现，不要停」—— 按任务表推进 M26：**把背包整页接进游戏**。
> 这一批先落"整页镜像"（19 种工作站一次全覆盖、零回归），自绘版继续在预览页演进。

- [x] [P1] `src/ui2d/textPanel.ts` + `menuScreen.ts`：新增 `readCanvasBlits` / `drawCanvasBlits`，镜像绘制顺序定为 底 → 位图 → 文字 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`CanvasBlit` + `readCanvasBlits(root, origin, view)`（读范围内所有 `<canvas>` 的矩形与位图）+ `drawCanvasBlits`（关掉平滑按原位贴）；`MenuScreen2D` 多存一份 `blits` 并在 `blocks` 与 `runs` 之间画；同时新增 `pollMs` 选项。
  - 为什么：背包的图标不是文字也不是底色，而是 DOM 里已经画好的位图；不搬只能得到"有边框、没图标"的背包。顺序必须与 DOM 一致（槽位底 → 图标 → 数量）。
  - 验证：`tests/ui2d.test.ts` → **68 passed**（新增 2 条：按原位贴并关平滑、空列表不画）。
  - 批次：20261027-1618

- [x] [P2] `src/main.ts`：背包改成整页镜像（`invMirror`，zIndex 12 + `pollMs: 120`），`#inv-held` 单独藏 → `npm run check:fast`
  - 做了什么：把上一批的 `Inventory2D`（逐槽位读 DOM）换成 `MenuScreen2D` 镜像 `.inv-panel`；`syncInventory2d()` 简化为"开着就 `engage(panel)`、关了就 `disengage()`"；`#inv-held` 用 `html.ui2d-inv #inv-held { opacity: 0 }` 藏掉；`pollMs: 120` 兜住"只换图标不换字"的变化。
  - 为什么：`Inventory2D` 只画槽位、面板底与标题仍是 DOM，遮罩版看得出来"只有格子黄"；整页镜像之后**面板里每一像素都是 canvas**。而 19 种工作站共用同一批 `.inv-slot`，镜像一次全覆盖。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测（dev 缺 `core.bin`）。
  - 批次：20261027-1618

- [x] [P3] 预览页 `tools/preview/inventory-mirror.html` + 2 张截图（含遮罩版）→ `node tools/preview/shoot-all.mjs`
  - 做了什么：按 `index.html` 的 `.inv-*` 搭一块 27+9 格的真 DOM（每格含真 `<canvas>` 图标、数量、耐久条、红底格、选择态），`MenuScreen2D.engage(panel)` 镜像它；`?tint=1` 加遮罩；`shoot-all` 累计 43 张。
  - 为什么：镜像的卖点是"面板里每一像素都由 canvas 产出"，遮罩版一张就能证明（整块黄、背景不黄）。
  - 验证：`node tools/preview/shoot-all.mjs` 43 张全出；截图看过：面板底/斜面/图标/64·12·3·32 数量/黄色耐久条/红底格都在，遮罩版整块面板变黄。
  - 批次：20261027-1618

- [x] [P4] 文档：`notes/canvas-ui.md` §5.20（整页镜像 + 位图搬运 + `pollMs` 的坑）、决策 D32 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.20 记下"为什么先镜像"、"位图必须一起搬"、`pollMs` 兜底的原因，以及三条边界（悬停、tooltip、`#inv-held`）；决策 D32 记下"背包分两步：先镜像覆盖全部，再自绘替换"。
  - 为什么：`pollMs` 那条尤其反直觉——"只换图不换字"的镜像会静默显示旧图标，不写清楚下一次会当成渲染 bug 查半天。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1618


## 批次 20261027-1548 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1548

> 用户 2026-10-27：「好的，你的建议处理。后面所有要做的事加到任务列表里，不用一个个找我确认。
> 我们的目标是把背包完全复原」。
> 所以先把**背包完全复原**拆成 M25~M31 写进 `TASKS.md`（M25 本批做完），然后执行 M25：
> 补齐双击收集 / 右键拖拽逐格 / 长按分堆这三条规则。

- [x] [N1] `src/ui2d/inventoryModel.ts`：`rightDragDistribute` / `doubleClickGather` / `splitTake` + 断言 → `npx vitest run tests/ui2d-inventory-model.test.ts`
  - 做了什么：右键拖拽每格放一个（重复经过只放一次）；双击收集（先拿起那一格，再把同类凑到上限；光标本来就有货时把被点那格也并进来）；长按分堆取指定数量（异类拒绝、受上限）。测试从 19 条增到 **31 条**。
  - 为什么：这是"逻辑一模一样"的核心 —— 之前只有左键/右键/Shift/左键拖拽四种，DOM 版还有这三种。
  - 验证：`npx vitest run tests/ui2d-inventory-model.test.ts` → **31 passed**（新增 12 条：右键拖拽 4、双击收集 4、长按分堆 4）；`tsc` 干净。
  - 批次：20261027-1548

- [x] [N2] 对照页接上三种新操作 + **像素探针**验收 → 截图
  - 做了什么：`inventory-compare.html` 双击（400ms 内同格）、右键拖拽（按下时放一个，之后每经过新格放一个）、触摸长按（500ms 取一半）；另外用 Playwright 读 `getImageData` 验证"点 canvas 第 0 格后该格中心从图标色变槽位底色，且 DOM 侧也空了"。
  - 为什么：截图会骗人 —— 第一版两张截图看起来"没变化"，实际是**手上那叠浮在被点的那格上盖住了**；读像素才是硬证据。
  - 验证：像素探针 `before=[139,90,43]` → `after=[139,139,139]`（槽位底色），DOM 侧 `.inv-count` 变空；截图 `22b-inventory-held.png`（手上那叠跟随指针）。
  - 批次：20261027-1548

- [x] [N3] `TASKS.md`：把"背包完全复原"拆成 M25~M31（含验收判据），M25 标记完成；文档 §5.19 + 决策 D31
  - 做了什么：M25 交互规则（本批完成）、M26 接进游戏、M27 视觉对齐、M28 合成、M29 容器工作站、M30 重配方块、M31 触摸 UI 全套；§5.19 记录六种鼠标操作与像素探针手法。
  - 为什么：用户要求"后面要做的事都进任务列表，不用逐个确认" —— 所以把整条路线写死在 TASKS 里，后续批次直接照着做。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1548


## 批次 20261027-1531 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1531

> 用户 2026-10-27：「重点把背包逻辑和界面用 canvas 来复原实现……最好能跟 DOM 实现的一模一样」。
> 这一批先把**逻辑**与**面板**自己写一份（不再镜像），并做成 DOM/canvas 并排对照页：
> 同一份数据、同一套逻辑，点哪边两边都变 —— "是否一样"不用我说，你自己点。

- [x] [M1] `src/ui2d/inventoryModel.ts`：左键/右键/Shift 快速移动/拖拽均分的纯逻辑 → `npx vitest run tests/ui2d-inventory-model.test.ts`
  - 做了什么：`leftClick` / `rightClick` / `quickMove` / `distributeDrag`，四个函数只操作 `SlotAccess(get/set)` 与 `Cursor`，堆叠上限与"同种物品"由调用方注入 `MoveRules`。
  - 为什么：要做到"一模一样"，规则就不能散在绘制代码里；抽成纯逻辑之后，同一份逻辑可以套在真实 `Inventory` 上，也能被逐条断言钉住。
  - 验证：`npx vitest run tests/ui2d-inventory-model.test.ts` → **19 passed**（左键 7 条、右键 5 条、Shift 3 条、拖拽 4 条）；`tsc` 干净。
  - 批次：20261027-1531

- [x] [M2] `src/ui2d/InventoryPanel2D.ts`：自己排版（面板/标题/36 格/光标叠）+ 命中 + 绘制 → 对照页 `tools/preview/inventory-compare.html` + 截图
  - 做了什么：`layoutInventoryPanel()`（`INV_LAYOUT` 照抄 `.inv-*` 的 px）、`drawInventoryPanel()`（面板底 + 3px 斜面 + 标题 + 逐格用 `drawInvSlot` + 光标上那一叠）、`slotIndexAt()`；对照页左边 DOM、右边 canvas，共用同一份 `slots` 与 `cursor`，两边都绑了指针事件（左键/右键/Shift/拖拽均分）。
  - 为什么：用户要"界面也复原"，而镜像的天花板是"DOM 长什么样就是什么样"；自己排版之后 `ui2d` 只有一份几何。对照页则把"一样不一样"变成可肉眼验证的东西。
  - 验证：`node tools/preview/shoot-all.mjs` 41 张全出；截图 `22-inventory-compare.png` 里两边的格子位置、数量（64/12/3/28/7/41/10）、快捷栏行位置都一致；`tsc` 干净。
  - 批次：20261027-1531

- [x] [M3] 文档：`notes/canvas-ui.md` §5.18（规则表 + 未做的三件事）、决策 D30 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.18 记下"逻辑与排版都自己写"的理由、四条规则的对照表、以及下一批必须补的（接进游戏 / 双击收集 / 右键拖拽每格一个 / 长按分堆 / 专用槽位）；决策 D30 记下"逻辑纯函数化 + 规则注入"的分层。
  - 为什么：DOM 版还有**双击收集、右键拖拽逐格放一个、触摸长按分堆**这些规则没搬 —— 不写清楚，"一模一样"会被误认为已经达成。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1531


## 批次 20261027-1517 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1517

> 用户 2026-10-27：「请直接处理背包」—— 进阶段 4。
> 背包是整个迁移里最大的一块（7564 行），但它有个有利结构：**每格槽位就是 42×42 盒子 +
> 一张 36×36 图标 canvas + 一个数量文本**，与快捷栏几乎同构。所以先做「槽位像素」，
> 交互（拖拽/分堆/连发）**一行都不动**。

- [x] [L1] `src/ui2d/Inventory2D.ts`：槽位几何与绘制（底/斜面/图标/数量/耐久/红底/白框）+ 签名 + 读 DOM → `npx vitest run tests/ui2d-inventory.test.ts`
  - 做了什么：`Inventory2D.ts`（约 330 行）—— `invContentRect` / `invIconRect`（等比居中）/ `invCountAnchor` / `invDurabilityRect` / `invSignature` / `drawInvSlot`；`readInvSlots()` 从 DOM 读每格的矩形、图标 canvas、数量、耐久条比例与档位、`:hover`/`:active`、`.locked`/`.held`；`readSlotSkin()` 从 CSS 变量读底面与四边斜面颜色（不抄常量）；`Inventory2D` 自带一层覆盖层（zIndex 12）+ 签名缓存，`update()` 每帧读 DOM、变了才重画。
  - 为什么：槽位与快捷栏同构，直接复用那套结论（量 DOM、像素换手不换输入）；`#inv-held`（拿在手上的那一叠）也一起画，否则拖动时图标会消失。
  - 验证：`npx vitest run tests/ui2d-inventory.test.ts` → **9 passed**（内容盒、图标居中与收窄、数量/耐久锚点、自定义边框宽度、签名稳定性与各字段变化）；`tsc` 干净。
  - 批次：20261027-1517

- [x] [K2→L2] `src/main.ts`：打开背包时接管（让位用挂在 `<html>` 上的类，扛得住槽位重建）→ `npm run check:fast`
  - 做了什么：新增 `inventory2d`（`Inventory2D`，zIndex 12）与 `syncInventory2d()`：`inventoryScreen.isOpen` 变化时开关，开着时每帧 `update()`；让位靠 `<style>` 里一条 `html.ui2d-inv #inventory-screen .inv-slot, html.ui2d-inv #inv-held { opacity: 0 }` + 切换 `<html>` 上的类（**不用逐元素内联样式**：背包切模式/换容器会重建槽位 DOM）。
  - 为什么：`opacity: 0` 保住了命中测试，于是拖拽分配、长按分堆、连发、悬停提示全都不用改；而"逐元素设 opacity"在重建后失效 —— 槽位会闪回 DOM 原样。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测（dev 缺 `core.bin`）。
  - 批次：20261027-1517

- [x] [L3] 预览页 `tools/preview/inventory.html`（27 格 + 快捷栏行 + 红底格 + 选择白框）+ 2 张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：造了 27 格 + 9 格假槽位（图标用纯色块代替真实图集裁切、数量 64/12/3/32、两格带耐久条、一格红底、一格选择态），`Inventory2D` 接管绘制；`?tint=1` 加遮罩；`shoot-all` 加 2 张（累计 40 张）。
  - 为什么：背包的槽位在各种工作台上数量不同（27/36/45），但**绘制代码只有一份**；预览页用 27 格就能看清底、斜面、图标、数量、耐久、红底、白框是否都对。
  - 验证：`node tools/preview/shoot-all.mjs` 40 张全出；截图看过：格子斜面方向（上/左暗、下/右亮）、64/12/3/32 数字贴右下、黄/红耐久条、红底格、白框选择态都对。
  - 批次：20261027-1517

- [x] [L4] 文档：`notes/canvas-ui.md` §5.17（两条沿用 + 两个专坑 + "还没做的"表）、决策 D29 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.17 记下"槽位与快捷栏同构"的判断、`<html>` 类让位的原因、z-index 12 的理由，并明确列出"布局与交互仍是 DOM"的边界；决策 D29 记下"背包只换像素不换交互"。
  - 为什么：背包最容易被误解成"整个界面都要重画"。写清楚"槽位是像素、交互是 DOM"这条线，才不会被后来的人越改越多。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1517


## 批次 20261027-1404 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1404

> 用户 2026-10-27：「继续继续」—— 接着把**聊天输入行**交给 canvas（上一批补的输入框
> 取值 + 焦点光标正好能复用），并顺手修一个只在游戏里才会炸的层叠问题。

- [x] [K1] `src/main.ts`：聊天输入行接入 `MenuScreen2D`（`.chat-entry` 让位像素，打开时才接管）→ `npm run check:fast`
  - 做了什么：新增 `chatEntry2d`（`MenuScreen2D`，`zIndex: 12`）与 `syncChatEntry2d()`（每帧看 `.chat-entry` 的 `offsetParent` 是否非空，出现就 `engage`、收起就 `disengage`），在帧循环里排在 `syncTextPanels2d()` 之后；`dispose()` 里一起销毁。
  - 为什么：输入本身一行都不用改（历史、命令补全、回车发送、发送键的 `pointerdown` 都留在 DOM），只需要"谁产像素"换人 —— 这正是镜像路线的价值。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。
  - 批次：20261027-1404

- [x] [K2] `src/ui2d/menuScreen.ts`：新增 `MenuScreenOptions.zIndex`，并给主菜单镜像补上 45 → 预览页 + 截图
  - 做了什么：`MenuScreen2D` 建覆盖层时按选项设 `zIndex`；主菜单传 45（`#world-screen` 是 40）、聊天传 12（`#chat` 是 8）。预览页 `tools/preview/chat.html`（`?value=`、`?tint=1`），截图 `20-chat-entry.png`。
  - 为什么：`Ui2DOverlay` 默认 `zIndex` 是 1 —— 上一批主菜单镜像**在预览页看着正常、在游戏里会被 `#world-screen` 的背景整个盖住**（表现是"开了 `?ui2d=1` 主菜单直接没了"）。这类层叠问题离线断言查不到、预览页也照不出来。
  - 验证：`node tools/preview/shoot-all.mjs` 38 张全出；截图看过：输入框有值「你好，有人在吗」、绿色发送键有斜面边框、提示行仍在（它是 DOM）。
  - 批次：20261027-1404

- [x] [K3] 文档：`notes/canvas-ui.md` §5.16（含 z-index 判据表）、决策 D28 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.16 记下聊天输入行的做法与"镜像哪棵树、覆盖层就要在它之上"的判据表；决策 D28 记下"覆盖层 z-index 必须按被镜像目标的层叠顺序给"。
  - 为什么：这个坑的形态很隐蔽 —— 预览页正常、游戏里整块消失，很容易被当成"`?ui2d=1` 又坏了"。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1404


## 批次 20261027-1354 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1354

> 用户 2026-10-27：「继续继续继续」—— 把**新建世界表单**也交给 canvas，
> 让"整页镜像"覆盖主菜单的第三个视图。上一批说过：`<input>` 的值不在 `textContent` 里，
> 所以镜像一直绕开这个视图；这一批就把这个缺口补上。

- [x] [J1] `src/ui2d/textPanel.ts`：输入框取值（`textFieldValue` / `inputDisplayText`，占位提示 0.55 不透明度）+ `TextRun.alpha` → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`readTextRuns` 现在优先认 `<input>` / `<textarea>`（`type` 只认 text/search/number，密码与隐藏框跳过），值为空时用 `placeholder` 并标为占位；`TextRun` 加 `alpha`，占位提示画成 0.55 透明（`::placeholder` 的计算样式读不到）；签名里带上 alpha。
  - 为什么：`<input>` 的**当前值不在 `textContent` 里** —— 这是"整页镜像"最初不敢碰新建世界的原因，也是这一批的唯一硬缺口。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **66 passed**（新增 4 条：有值画值 / 空值画占位并标记 / 没有占位就不画 / 单个空格算有值）；`tsc` 干净。
  - 批次：20261027-1354

- [x] [J2] `src/ui2d/menuScreen.ts`：`drawFieldCaret()` 画焦点框的光标与选区；**签名补上 input 的 value** → 预览页 + 截图
  - 做了什么：`drawFieldCaret()` 在镜像画完文字之后，检查 `document.activeElement` 是否属于被镜像的子树，是就按 `selectionStart/End` + `visibleSlice`/`rangeRect`/`caretRect` 画选区与光标（DOM 那份插入符被 `opacity: 0` 一起藏了）。同时修了签名：原来只比 `scrollTop` + `textContent`，**而敲字时 `textContent` 一点没变** → canvas 永远不重画、输入框一直显示占位提示（第一版截图就是这样）。
  - 为什么：镜像路线下"输入"仍归 DOM，但"看得见"归 canvas —— 光标和选区不画，玩家打字时完全看不到自己在哪。
  - 验证：预览页 `menu-mirror.html?view=create` 里把光标真的放进输入框，截图 `19-create-form.png` 显示出"我的世界"（值而非占位）与输入框边框。
  - 批次：20261027-1354

- [x] [J3] `src/main.ts`：镜像白名单加 `create`（`home` / `worlds` / `create`），更新注释 → `npm run check:fast`
  - 做了什么：`mountMenuMirror()` 的视图白名单从两个扩到三个；注释写清"`create` 为什么现在能进来"（取值 + 光标都补上了）以及"多人面板是另一棵树，不在本批范围"。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测（dev 缺 `core.bin`）。
  - 批次：20261027-1354

- [x] [J4] 文档：`notes/canvas-ui.md` §5.15（含"签名要看输入框的值"这个坑）、决策 D27 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.15 记录输入框取值与焦点光标的两处实现、"签名要看 value"的坑，以及"阶段 3 还剩多人面板"的清单；决策 D27 记下"镜像路线里输入仍归 DOM、光标归 canvas"的分工。
  - 为什么：那个签名坑**只在真人敲字时才出现**（截图、静态页面都正常），不写清楚下一个人会当成"输入框不刷新"的玄学。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1354


## 批次 20261027-1345 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1345

> 用户 2026-10-27：「去完成」—— 做上一轮说的**输入法定型**。
> 这是新建世界、多人面板、聊天三条线共同的前置件：canvas 自己收不到输入法组合态，
> 唯一正路是"屏幕外放一个看不见但可聚焦的 `<input>` 收字，canvas 只画"。

- [x] [H1] `src/ui2d/textInput.ts`：`CanvasTextInput`（隐藏 input 收字 + 画光标/选区/组合态下划线）+ 一组纯几何/编辑函数 → `npx vitest run tests/ui2d-textinput.test.ts`
  - 做了什么：`textInput.ts`（约 420 行）—— 隐藏 `<input>`（`opacity: 0` + 1×1 + 固定视口内 + `pointer-events: none`）承接输入；`metricsFor` / `caretXOf` / `clampCaret` / `applyInsert` / `backspaceAt`（按码点）/ `visibleSlice`（超宽滚动窗口）/ `rangeRect` / `caretRect` / `caretBlinkOn`；`CanvasTextInput` 负责 `open/close/focus/render/dispose`，Enter 提交、Esc 取消（两者都先看 `isComposing`）。
  - 为什么：canvas 没有输入框，也收不到组合态。三条约束见 §5.14 —— 尤其"不能用 `display: none`"（拿不到焦点、移动端不弹键盘）和"组合态靠事件不靠 value"（拼音阶段 `value` 里已经有字母了）。
  - 验证：`npx vitest run tests/ui2d-textinput.test.ts` → **18 passed**；`tsc` 干净。
  - 批次：20261027-1345

- [x] [H2] 预览页 `tools/preview/textinput.html`：能**真的打字**（含中文输入法）、可预填内容与选区；两张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：一页"新建世界"面板，两块 `CanvasTextInput`（世界名称 / 种子），点一下就能打字；`?value=我的世界&sel=1,3` 预填并选中一段（截图用），`?tint=1` 加遮罩。`shoot-all` 加 2 张（累计 36 张）。
  - 为什么：这一层的正确性一半只能靠"真的敲一遍"——组合态下划线、光标闪烁、选区宽度都只有在动起来时才看得出问题；截图至少能把"中文 + 选区"这一幕定住。
  - 验证：`node tools/preview/shoot-all.mjs` 36 张全出；截图看过：`18b` 里"我的世界"四个字、第 2~3 个字上有蓝色选区、种子框是未聚焦空框 + 占位提示。
  - 批次：20261027-1345

- [x] [H3] 文档：`notes/canvas-ui.md` §5.14（三条约束 + 未接线的边界）、决策 D26 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.14 把三条约束做成表格（每条都写"为什么"），并明确写了**还没接进游戏**；决策 D26 记下"为什么用隐藏 input 而不是自己实现键盘"。
  - 为什么：这一层最容易被后来的人"简化"——把 `opacity: 0` 改成 `display: none`、或者干脆用 `value` 判组合态。两种改法在桌面 Chrome 上**都能跑**，只在移动端输入法下坏掉，不写清楚就会被改回去。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1345


## 批次 20261027-1334 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1334

> 用户 2026-10-27：「继续继续」—— 接着做**主菜单 / 世界列表**。
> 这一块与前面都不同：菜单在 `App` 之外（**没有覆盖层、没有主循环**），而且它是个
> **静态整页**。所以不再"自己排版"，改走**整页镜像**：DOM 把 `opacity` 设 0 让位像素，
> canvas 把每段文字、每块底色与边框按原位重画 —— 加按钮、改文案、换语言都自动跟上。

- [x] [G1] `src/ui2d/textPanel.ts`：底块支持**边框**（`readSurface`），并给 `drawTextRuns` 加 `slack` → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`readTextBlocks` 现在读 `borderTopWidth/TopColor` 与圆角，绘制时"先底后边"（描边画在内侧半像素上，与 `border-box` 对齐）；只有边框没有底色的元素也会被画。`drawTextRuns(ctx, runs, slack)` 给 `maxWidth` 留余量。
  - 为什么：MC 风格的按钮靠边框出"凸起"感，没有边框整页就是一堆灰块；`slack` 是因为 DOM 的 `letter-spacing`（标题常写负值）会让元素盒子比 canvas 量出的字**窄**，不给余量 "MINICRAFT" 会被截成 "MINICRA…"（第一版截图就是这样）。
  - 验证：`npx vitest run tests/ui2d.test.ts` → **62 passed**（新增 2 条：不给余量按盒子截断、给余量完整画出）；`tsc` 干净。
  - 批次：20261027-1334

- [x] [G2] `src/ui2d/menuScreen.ts`：`MenuScreen2D` —— 独立覆盖层 + `engage/disengage`（`opacity: 0` 让位）+ rAF 循环 + 签名比对
  - 做了什么：`engage(el)` 建（或复用）一个 `Ui2DOverlay`、把元素的 `opacity` 设 0、起一个 `requestAnimationFrame` 循环；每 4 帧比一次签名（视口尺寸 + 所有可滚动元素的 `scrollTop` + 整块 `textContent`），变了才重读计算样式并重画；`disengage()` 还原 opacity 并停止循环。
  - 为什么：菜单是静态的，每帧读整棵树的计算样式纯属浪费；而 `WorldScreen` 没有"打开/切视图/滚动"事件，只能靠签名自己发现变化。
  - 验证：预览页 `tools/preview/menu-mirror.html` 跑通（首页与世界列表两种视图），`tsc` 干净。
  - 批次：20261027-1334

- [x] [G3] `src/main.ts`：主菜单接线 `?ui2d=1`（`mountMenuMirror`，200ms 轮询 + resize），只镜像 `home` / `worlds` → `npm run check:fast`
  - 做了什么：`boot()` 里在 `installInstallHint()` 之后调 `mountMenuMirror(menu)`；它建一个 `MenuScreen2D`，每 200ms 检查"菜单是否开着且停在 `home`/`worlds`"，是就 `engage(.world-panel)`，否则 `disengage()`；`resize` 时立刻同步一次。
  - 为什么：**只镜像这两个视图**——`create` 与多人面板里有 `<input>`，而 `<input>` 的当前值不在 `textContent` 里（镜像过去是空框），输入法那一摊要单独做。轮询是因为 `WorldScreen` 不暴露事件，而菜单静态、200ms 的代价可忽略。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ **游戏内未实测**（dev 缺 `__host/core.bin` 停在落地页），镜像效果由预览页与截图验证。
  - 批次：20261027-1334

- [x] [G4] 预览页 `tools/preview/menu-mirror.html` + 3 张截图 + 文档（§5.13、决策 D25）→ `node tools/preview/shoot-all.mjs`
  - 做了什么：预览页按 `index.html` 的配色搭了一块"世界面板"（首页 / 世界列表两个视图），用 `MenuScreen2D` 镜像它；`?view=worlds`、`?tint=1`；`shoot-all` 加 3 张（累计 34 张）；`notes/canvas-ui.md` 新增 §5.13，决策 D25 记下"整页镜像"的适用边界。
  - 为什么：镜像的卖点是"一像素不自己排"，那就必须能一眼看出**它画出来的和 DOM 完全一致**——预览页里 DOM 面板被设成 `opacity: 0`，屏幕上看到的每一块都是 canvas 画的。
  - 验证：`node tools/preview/shoot-all.mjs` 34 张全出；截图看过：首页标题完整（`MINICRAFT` 不再被截）、四颗按钮有边框与文字、世界列表三张卡片 + 每张两个小按钮 + 新建/返回；遮罩版整块黄。
  - 批次：20261027-1334


