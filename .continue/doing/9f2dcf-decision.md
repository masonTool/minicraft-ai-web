# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261028-1027 · 创造栏面板

## D67 · 状态归谁：canvas 只读、改状态走 DOM 那颗按钮
- 决定：`CreativePanel2D` 自己管 `tab`/`page`（纯展示态），但**不复制**"切分类"那套副作用；`InventoryScreen.creativeState` 只读暴露，换页签走 `forwardClickAt()` 点真按钮。
- 为什么：切分类会连带做一串事（按分类存滚动位置、按分类存搜索词、重置页码、重排 chrome、把 pane 切回 creative）。复制到 canvas 侧必然与 DOM 漂移，而漂移的表现是"用 canvas 点分类之后，切回 DOM 时滚动位置丢了"——很难归因。
- 影响：最后一步接线只需按 `creativeState.showing` 切换面板；翻页与取用（`onPick` → `creativePick`）已在 canvas 侧闭环。
