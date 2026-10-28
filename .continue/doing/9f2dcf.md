# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-1017

> 用户 2026-10-28：「请继续」——装备列接数据源。

- [x] [R1] `panelIndexing` 支持装备列落点
  - 做了什么：`armorSlotBase` / `offhandSlot` 注入；side 区换算 + 反查。
  - 为什么：盔甲住在 `Inventory` 36..39、副手 40，但 `ui2d` 不该知道这几个常量。
  - 验证：`test:ui2d-indexing` 15/15（含与熔炉共存的串区断言）。
  - 批次：20261028-1017

- [x] [R2] `syncInventory2dStation()` 计入 sideCount
  - 做了什么：`mode === 'inventory' ? 5 : 0`，与 extra 一起 retarget。
  - 为什么：工作站右栏没有盔甲列，DOM 也是这样。
  - 验证：`tsc` 干净、`npm run check` exit=0。
  - 批次：20261028-1017

- [x] [R3] `canPlace` 接 `armorSlotForItem`
  - 做了什么：非装备进不了盔甲格、副手什么都收；容器区交给 `extraSlotWritable`。
  - 为什么：规则不接就等于没有（第一批就踩过）。
  - 验证：`test:ui2d-place-rules` 6/6、`test:ui2d-armor` 7/7。
  - 批次：20261028-1017
