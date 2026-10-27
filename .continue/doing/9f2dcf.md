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
