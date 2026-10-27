# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-27
> 批次：20261027-1922

> 用户 2026-10-27：「继续啊，把任务都放到任务列表里去，一件一件去做吧」。
> 这一件是 **M35 + M36**：把"能滚"补成"看得出能滚 + 松手继续滑"。

- [x] [W1] `src/ui2d/menuScreen.ts`：`scrollBarRects()` + 自绘滚动条 → `npx vitest run tests/ui2d-scroll.test.ts`
  - 做了什么：`refresh()` 里遍历镜像子树，找出真的能滚的容器，按 `scrollBarRects()` 画 4px 半透明圆角拇指（右缩 2px，最小 18px）；`draw()` 里在文字之后画（压在内容右侧）。
  - 为什么：DOM 的滚动条是 UA 画的，canvas 里没有 —— 不补就是"能滚但看不出能滚"。
  - 验证：`tests/ui2d-scroll.test.ts` **9 passed**（装得下不画、比例、贴顶/贴底、极长内容用最小长度、越界与 NaN 夹住）。
  - 批次：20261027-1922

- [x] [W2] 惯性：采样最近 5 次移动算速度、`decayVelocity()` 衰减、`stepInertia()` 每帧推进 → 合成 touch 事件实测
  - 做了什么：`drag.samples` 只留 5 个；`onDragEnd` 用 `(first.y - last.y)/dt*16.67` 算 px/帧；`stepInertia()` 每帧 `scrollTop += v` 并按 `0.94^frames`（dt 归一）衰减，`|v| < 0.25` 停；重新按下立刻停住惯性。
  - 为什么：松手即停的手感很硬；而"按帧衰减 + dt 归一"能在掉帧时不至于冲很远。
  - 验证：Playwright 合成 touch 向上拖 60px 松手 → `scrollTop` **60 → 73 → 109 → 129 → 144 → 162 → 168**（到底停住）；`decayVelocity` 4 条断言（单帧/多帧归一、阈值、方向、NaN）。
  - 批次：20261027-1922

- [x] [W3] 截图 `28-inventory-scrollbar.png` + `shoot-all` + 文档 §5.26 / 决策 D38 + TASKS 的 M35 改 `[~]`、M36 标完成 → `node .continue/hooks/check.mjs --fast`
  - 做了什么：滚动 48px 的截图里能看到细拇指在轨道上约 1/3 处；§5.26 记下两件事的做法与断言清单，并明确"滚动条还不能拖"。
  - 为什么：M35 只做了一半（不能拖），如果不写清楚，下一批会以为它已完成。
  - 验证：`node .continue/hooks/check.mjs --fast` 六项全过。
  - 批次：20261027-1922
