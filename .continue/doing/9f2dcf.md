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
