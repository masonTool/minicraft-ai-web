# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-1654 · 镜像补上 overflow 裁剪

## D34 · 镜像必须自己复刻 `overflow` 语义（裁剪 + 跳过），不能只按元素矩形画
- 决定：`makeClipQuery(root, origin)` 把每个祖先（`overflow-x/y !== 'visible'`）的 **padding-box** 与已有裁剪求交；`readTextRuns`/`readTextBlocks`/`readCanvasBlits` 每条记录带 `clip`、完全在框外的直接跳过；绘制时 `paintClipped` 做 `save → clip → paint → restore`。
- 为什么：DOM 的"看不见"有两套来源——**位图**（`<canvas>`，第一批补的）和**裁剪**（`overflow`）。镜像只按 `getBoundingClientRect()` 画，等于假定所有内容都可见；一旦遇到滚动容器（创造物品栏 96 格、滚动的世界列表、`overflow: hidden` 的面板），滚出去的、溢出的内容就全被画出来 —— 用户看到的就是"所有物品平铺、伸出弹窗"。
- 影响：① 多的开销是"每个元素往上走一遍祖先并读计算样式"，做了按元素的缓存，只在重读时付一次；② **滚动仍由 DOM 处理**（覆盖层 `pointer-events: none`，滚轮/触摸照旧落到下面），canvas 只负责可见部分，所以将来做自绘版时滚动条与惯性要自己实现；③ padding-box 用 `clientLeft/Top/Width/Height`，天然排除边框与滚动条宽度。
