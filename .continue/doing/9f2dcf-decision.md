# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261028-1045 · 创造栏接线与转发修复

## D68 · "让位"要用 `opacity: 0`，不能用 `visibility: hidden`
- 决定：接管模式下隐藏 DOM 面板改成 `opacity: 0`；创造栏用独立开关 `?ui2dcreative=1`；换页签走 `forwardClickAt()` 点真按钮。
- 为什么：`visibility: hidden` 的元素**不参与命中测试**，`elementFromPoint` 直接跳过整棵子树 —— 表现是"点关闭 × 没反应"，而画面正常、断言不响（转发函数只是返回 null）。这一条同时纠正了 §5.41 里"用 visibility 是为了还能命中"的错误说法。
- 影响：`forwardClickAt` 对页签/立栏/× 现在真的生效；创造栏面板自己画"手上那一叠"（接管下 `#inv-held` 已隐藏）。
