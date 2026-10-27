# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261027-2324 · 自绘面板接管输入

## D53 · 接管用 `visibility: hidden` + "同帧让开"的点击转发
- 决定：`?ui2dinv=1` 下 `.inv-shell` 与 `#inv-held` 用 `visibility: hidden` 退场；画布 `pointer-events: auto` 吃指针；落在面板外的点击由 `forwardClickAt()` 临时让开画布、`elementFromPoint` 找到 DOM 元素并派发 `click`。
- 为什么：① 用 `display: none` 会让 `elementFromPoint` 找不到里面的按钮/输入框，转发直接失效，而且 `input.value` 也读不到；② 关闭 ×、左右立栏在面板外面，这一批不重画它们，转发是唯一不丢功能的做法；③ 只在"没有拖动过"时转发 —— 拖动是操作槽位的手势，松手不该顺手点别的东西。
- 影响：① **只转发 `click`**：按钮/页签够用，需要 `pointerdown/move/up` 序列的控件（拖拽抽屉、滑杆）不在此列，那些要么重画要么单独接；② 接管是**可选开关**，`?ui2d=1` 默认仍走镜像，真机验收通过后再谈默认切换。
