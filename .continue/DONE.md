# 完成档案 · DONE

> 本文件是**已完成工作的唯一档案**，只回答"这批做了什么、怎么验的"——时间线，最近的在最上面。
> 按模块看现状与坑 → `OVERVIEW.md`；下次怎么避开 → `TIPS.md`；机制与格式 → `README.md`。
> **一条内容只写一个地方**，别在三份文档里各抄一遍。
>
> 收尾时**整份队列原样搬进来**（含每条任务下方的完成说明与 `[阻塞]`），标题格式
> `## 批次 <号> · 日期 · 会话 <前 8 位>`。

---

## 批次 20261027-1706 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1706

> 用户 2026-10-27：「首页三个按钮的**显示位置**是错的，**点击位置**也是错的」。
> 用真 `WorldScreen` 复现：首页在字体/排版稳定后按钮整体上移（y 483 → 309），
> 而镜像只在第一帧量过一次，之后再也不重量 —— 画在旧位置、点在新位置。

- [x] [S1] 复现页 `tools/preview/world-real.html`：真 `WorldScreen` + `fetch('/index.html')` 搬真样式 → 截图
  - 做了什么：页面构造真的 `WorldScreen`（空存档表 + no-op actions），把 `index.html` 里那段 `<style>` 整段注入，再镜像 `.world-panel`；`?plain=1` 出 DOM 基准；报告晚 1.2s 再打（早期的数字是布局稳定前的旧值）。
  - 为什么：手写假 DOM 测不出定位问题（第一版就是：没有游戏 CSS，元素全是裸节点，什么也没复现）。
  - 验证：`node` 里读同一个按钮在不同时刻的 `y`：**150ms 时 483，1650ms 时 309** —— 差 174px，根因坐实。
  - 批次：20261027-1706

- [x] [S2] `MenuScreen2D`：签名带上几何；`main.ts` 给所有镜像开 `pollMs` 并在 `document.fonts.ready` 后重量 → `npm run check:fast`
  - 做了什么：`computeSignature` 加 `getBoundingClientRect()` + `scrollWidth/scrollHeight`；主菜单 `pollMs: 200`、聊天输入行 `pollMs: 250`（原来 0）；主菜单挂载处加 `document.fonts.ready.then(sync)`。
  - 为什么：几何不在签名里 → 第一帧的旧位置会被永久沿用；而"盒子尺寸没变、内部按钮却动了"的情况签名也抓不到，所以要定期重读兜底。
  - 验证：`tsc` 干净；`npm run check:fast` 绿；镜像版截图（`26-world-mirror.png`）与 DOM 基准（`26b-world-dom.png`）位置一致。
  - 批次：20261027-1706

- [x] [S3] `textPanel`：`letter-spacing` 补偿（大标题不再被截成 `Minicra…`）+ 2 条断言 → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：`readTextRuns` 读 `letter-spacing`，负值按 `-spacing × 字数` 记进 `TextRun.widthSlack`（上限 64）；`drawTextRuns` 把补偿加到 `maxWidth`。
  - 为什么：`world-logo` 是 48px + 负字距，盒子比 canvas 量出来的字窄，`maxWidth` 一夹就出省略号。
  - 验证：`tests/ui2d.test.ts` → **73 passed**（新增 2 条：补偿生效、补偿为 0 时行为不变）。
  - 批次：20261027-1706


## 批次 20261027-1654 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1654

> 用户 2026-10-27：「点左侧分类按钮时，会把所有内容平铺出来、伸出弹窗；应该收在弹框内、物品滚动显示」。
> 根因是**镜像不知道 `overflow`**：`readTextRuns`/`readTextBlocks`/`readCanvasBlits` 全按
> `getBoundingClientRect()` 画，而 DOM 是靠 `overflow: hidden/auto` 裁的。

- [x] [R1] `src/ui2d/textPanel.ts`：裁剪 —— `makeClipQuery`（祖先 padding-box 求交 + 缓存）、记录带 `clip`、裁空的跳过、绘制 `paintClipped` → `npx vitest run tests/ui2d.test.ts`
  - 做了什么：新增 `intersectRect` / `makeClipQuery` / `outsideClip` / `paintClipped`；三个读取函数给 `TextRun`/`TextBlock`/`CanvasBlit` 带上 `clip` 并跳过完全在框外的；三个绘制函数按 `clip` 做 `save→clip→paint→restore`。
  - 为什么：`overflow` 是 DOM 才有的语义，canvas 不裁就会把滚出去、溢出面板的内容全画出来（用户报的正是这个）。
  - 验证：`tests/ui2d.test.ts` → **71 passed**（新增 3 条：相交取公共部分、包含取小的、只贴边返回 null）。
  - 批次：20261027-1654

- [x] [R2] 预览页复现 + 修复验证：`inventory-mirror.html?creative=1&scroll=80`（96 项 / 150px 高滚动区）→ 截图
  - 做了什么：预览页加"创造物品栏"模式：12 列 96 格塞进 `max-height: 150px; overflow-y: auto` 的网格并滚 80px，网格外面还有一行翻页条；截图 `25-inventory-scroll.png`。
  - 为什么：这个 bug 只在"内容比容器高"的时候出现，普通背包（27 格）复现不了。
  - 验证：截图里只画出滚动区里看得见的 4 行（最后一行在容器边缘被裁开），翻页条留在面板内，没有任何东西伸出面板。
  - 批次：20261027-1654

- [x] [R3] 文档：`notes/canvas-ui.md` §5.22、决策 D34 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.22 写清根因、修法三段（求交 / 跳过 / 裁剪绘制）与"滚动仍归 DOM"的边界；决策 D34 记下"镜像必须复刻 overflow 语义"。
  - 为什么：这是**第二条**"DOM 有、canvas 没有"的语义（第一条是位图），不记下来还会再踩。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1654


## 批次 20261027-1650 · 2026-10-27 · 会话 9f2dcf81

# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1650

> 用户 2026-10-27：「继续实现，不要停」—— 把**阶段 3 的最后一块**（多人面板）收掉。
> 它不在 `#world-screen` 那棵树里，所以单开一个镜像；面板里全是 `<input>`，
> 正好检验上一批补的"值 + 光标"能不能用。

- [x] [Q1] `src/main.ts`：`mountMultiplayerMirror()`（`#multiplayer-screen .mp-panel`，zIndex 65、`pollMs: 200`）→ `npm run check:fast`
  - 做了什么：在 `mountMenuMirror(menu)` 之后挂 `mountMultiplayerMirror(multiplayerUi)`；200ms 轮询 `screen.isOpen`，开着就 `engage(.mp-panel)`、关了就 `disengage()`。
  - 为什么：`#multiplayer-screen` 的 z-index 是 60，主菜单镜像（45）盖不到；而面板里是输入框，正好验证"镜像能画值与光标、输入仍归 DOM"这条路。
  - 验证：`npx tsc --noEmit` 干净；`npm run check:fast` 绿。⚠️ 游戏内未实测。
  - 批次：20261027-1650

- [x] [Q2] 预览页 `tools/preview/multiplayer-mirror.html` + 2 张截图 → `node tools/preview/shoot-all.mjs`
  - 做了什么：按 `index.html` 的 `.mp-*` 搭一块真面板（标题 + ✕ + 三行输入框带值 + 红色状态行 + 取消/加入），`MenuScreen2D.engage(panel)`；把焦点放进"房间号"并置于末尾，让镜像画出光标；`?tint=1` 加遮罩；`shoot-all` 累计 46 张。
  - 为什么：`<input>` 的值与光标是这一批唯一"新东西"，必须在能看见的页面上验一次（而不是只在代码里相信它）。
  - 验证：`node tools/preview/shoot-all.mjs` 46 张全出；截图里三个输入框的值、红色状态行、两颗按钮都由 canvas 画出；遮罩版整块面板变黄。
  - 批次：20261027-1650

- [x] [Q3] 文档：`notes/canvas-ui.md` §5.21（镜像根的另一棵树 + 阶段 3 的账）、决策 D33 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：§5.21 记下"独立一棵树要单开镜像、z-index 按它给"，并列出阶段 3 六块界面的完成账；决策 D33 记下"镜像没有"统一一个大根"，而是每个 z-index 层一个实例"。
  - 为什么：镜像的 z-index 判据已经踩过一次（主菜单用默认 1 → 游戏里整块消失），这次要写清"按被镜像那一层的 z-index 往上给"。
  - 验证：`node .continue/hooks/check.mjs --fast` 绿。
  - 批次：20261027-1650


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


