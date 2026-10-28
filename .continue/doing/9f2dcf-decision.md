# 决策记录 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 批次 20261028-1009 · 版面跟容器切

## D63 · 跨层的"名字表"要用类型钉住；规格对象要可变
- 决定：`stationLayouts` 的键与 `InventoryPanelMode` 逐字一致（`shulker_box`），并加 `satisfies readonly InventoryPanelMode[]` 的断言；版面规格用**可变对象**、闭包读字段。
- 为什么：① 名字差一个字母不会报错，只会静默退回"纯背包"——`shulker` vs `shulker_box` 就是现成的例子；② 若每次换容器都新建规格对象，`SlotAccess` 的闭包还指着旧的，症状是"打开熔炉后玩家背包错位"，看起来像映射函数算错，极难定位。
- 影响：容器里的格子仍无数据源（需 `activeContainer` 只读访问器）；接上后只需在 `SlotAccess` 里加一个"extra 区读容器"的分支。
