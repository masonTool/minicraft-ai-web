# 队列 · 会话 9f2dcf8178d4474f8c0f3f8f4e52851c

> 状态：执行中
> 创建：2026-10-28
> 批次：20261028-1006

> 用户 2026-10-28：「请继续」——把下标映射抽成纯函数并加断言。

- [x] [Z1] `ui2d/panelIndexing.ts` 四区划分 + 双向换算
  - 做了什么：`panelRegions` / `regionOfDisplayIndex` / `inventoryIndexAt` / `displayIndexForInventory`。
  - 为什么：老的一行三元表达式在加了工作站/装备列后会把格子映射错。
  - 验证：`test:ui2d-indexing` 8/8（含 11+5 格错位、越界、非整数、往返一致）。
  - 批次：20261028-1006

- [x] [Z2] `main.ts` 的 `SlotAccess` 接入
  - 做了什么：`get/set` 走 `inventoryIndexAt`，非玩家格子返回 null / 忽略写入。
  - 为什么：让"将来改规格"只需换一个常量，不必再改两处闭包。
  - 验证：`tsc` 干净；`npm run check` exit=0（规格 0/0 时行为与旧代码一致）。
  - 批次：20261028-1006
