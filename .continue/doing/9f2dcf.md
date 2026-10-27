# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1732

> 用户 2026-10-27：「滑动物品滚动的能力不行，世界列表也滑不动；就应该是手贴着列表上下移动，它跟手」。
> 根因：游戏把 `html, body` 的 `touch-action` 设成 `none`（为了拖动视角），内层滚动容器
> 每家 WebView 处理不一致 → 手指贴着列表滑，列表纹丝不动。
> 同时把用户点名要做的后续都写进 `TASKS.md`（M32~M36）。

- [x] [U1] `src/ui2d/menuScreen.ts`：`bindDragScroll` —— 接管触摸拖拽滚动（找可滚祖先 / 8px 阈值 / 跟手 / 立刻重画）→ 合成指针事件验证
  - 做了什么：`pointerdown`（非鼠标）→ 从命中元素往上找第一个真的能滚的祖先（`scrollHeight > clientHeight + 2` 且 `overflow-y: auto/scroll`）；纵向位移超过 8px 才劫持；之后每次 `pointermove` 设 `scrollTop = startScroll - dy` 并立刻 `refresh(true)`；`pointerup/cancel` 结束；`input/textarea/select` 不劫持。
  - 为什么：`html, body { touch-action: none }` 让内层滚动容器在部分 WebView 上完全不响应滑动；镜像既然已经在画这一屏，就顺手把"跟手"这件事做掉，不依赖 UA 的滚动实现。
  - 验证：Playwright 合成 touch 指针事件，在 `inventory-mirror.html?creative=1` 里向上拖 60px → `grid.scrollTop` 从 **0 → 60**，画面同步重画；`tsc` 干净。
  - 批次：20261027-1732

- [x] [U2] `TASKS.md`：把用户点名的后续拆成 M32~M36（立栏上 canvas / 触控控件 / 暂停弹窗验收 / 自绘滚动条 / 拖拽惯性）→ `node tools/audit-tasks.mjs`
  - 做了什么：新增五条待办，并把进度口径与差异台账重算（HANDOFF 303/6/12、共 324 项）。
  - 为什么：用户明确说过"后面要做的事都加到任务列表里，不用一个个确认"。
  - 验证：`npm run check` exit=0。
  - 批次：20261027-1732

- [x] [U3] 文档：`notes/canvas-ui.md` §5.24（为什么自己做拖拽滚动、三条边界、验证方式）→ `node .continue/hooks/check.mjs --fast`
  - 做了什么：记下根因（`touch-action: none`）、8px 阈值的理由（别把点击/物品拖拽/横向拖动一起劫持）、以及"滚动条（M35）与惯性（M36）还没做"。
  - 为什么：这一层最容易被后来的人当成"我也可以顺手加个平滑滚动"，结果把点击阈值改坏。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-1732
