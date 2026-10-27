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
